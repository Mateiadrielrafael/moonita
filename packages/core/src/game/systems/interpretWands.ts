import * as GameAction from "../GameAction";
import * as V from "../common/Vector";
import * as E from "wolf-ecs";

import { CircularBuffer } from "../../CircularBuffer";
import { settings } from "../common/Settings";
import { shootWand } from "../GameAction";
import {
  EntityId,
  LayerId,
  SimpleSystem,
  SimulationState,
  State,
  stateIsComplete,
} from "../State";
import {
  Card,
  CardId,
  CardRef,
  CastState,
  mergeStats,
  mergeStatsMut,
  noStats,
  ProjectileKind,
  Wand,
  WandId,
  WandState,
} from "../wand";
import { identityTransform } from "../common/Transform";
import { addSprite, createUiBar } from "./createEntity";
import { normalizeAngle, randomBetween } from "../../math";
import { Flag } from "../common/Flags";

function getCard(state: SimulationState, cardId: CardId): Card {
  const card = state.cards[cardId];

  if (card === undefined) throw new Error(`Cannot find card ${cardId}`);

  return card;
}

function getWand(state: SimulationState, wandId: WandId): Wand {
  const wand = state.wands[wandId];

  if (wand === undefined) throw new Error(`Cannot find wand ${wandId}`);

  return wand;
}

/** Create a cast state with nothing attached to it (yet) */
function emptyCastState(): CastState {
  return {
    accumulatedTransform: {
      direction: 0,
      position: V.origin(),
    },
    stats: noStats(),
    forceRecharge: false,
    projectiles: [],
    castDelay: 0,
  };
}

function resetWandState(wand: Wand, wandState: WandState) {
  // Clear all 3 piles
  wandState.deck.clear();
  wandState.discarded.clear();
  wandState.hand.clear();

  // Reset the accumulated delay
  wandState.rechargeDelay = wand.rechargeDelay;

  // Readd cards into the decks
  wandState.deck.pushMany(
    wand.cards.map((id, index) => ({
      index,
      id,
    }))
  );
}

function emptyWandState(state: SimulationState, wandId: WandId): WandState {
  const wand = getWand(state, wandId);

  const wandState: WandState = {
    discarded: new CircularBuffer(settings.maxDeckSize),
    hand: new CircularBuffer(settings.maxDeckSize),
    deck: new CircularBuffer(settings.maxDeckSize),
    mana: wand.maxMana,
    rechargeDelay: 0,
  };

  resetWandState(wand, wandState);

  return wandState;
}

function draw(wandState: WandState, castState: CastState): CardRef | null {
  const card = wandState.deck.tryPopFirst();

  // Wrapping:
  //
  // When a modifier/multicast/trigger/timer tries to
  // draw a card but there are no cards in the deck,
  // we add all the cards in the discard pile
  // (in the order they had in the original deck)
  //
  // This allows drawing from the "start" of the deck once the deck is empty,
  // which is why it's called "wrapping"
  //
  // A flag is set on the cast state so we recharge once this current cast is over
  // This ensures the recharge delay can't be straight up avoided
  // by endnig a wand with a draw-card
  //
  // This is the reason the hand is a thing -
  // we don't want to allow infinite recursion
  // were a spell keeps calling itself.
  if (card === null) {
    if (wandState.discarded.used === 0) return null; // Nothing to wrap!

    const discarded = wandState.discarded.toArray(); // Save discarded pile into array
    wandState.discarded.clear(); // Empty out discarded pile

    discarded.sort((a, b) => a.index - b.index); // Reorder the discard-pile in the order the cards were in in the original deck
    wandState.deck.pushMany(discarded); // Add the discarded pile to the deck in the correct order

    castState.forceRecharge = true; // Force the wand to automatically recharge once this cast is over

    return draw(wandState, castState);
  }

  wandState.hand.push(card);

  return card;
}

function drawAndUpdateCastState(
  state: SimulationState,
  castState: CastState,
  wandState: WandState,
  wand: Wand
) {
  const cardRef = draw(wandState, castState);

  if (cardRef === null) return; // If no more cards to draw, just halt execution

  const cardId = cardRef.id;
  const card = getCard(state, cardId);

  if (state.flags[Flag.DebugWandExecutionLogs])
    console.log(`Drew ${card.name}`);

  // Make sure mana cost can be paid
  if (wandState.mana >= card.manaCost) {
    // Pay mana cost
    wandState.mana -= card.manaCost;

    // Apply delays
    castState.castDelay += card.castDelay;
    wandState.rechargeDelay += card.rechargeDelay;

    for (const effect of card.effects) {
      if (effect.type === "multicast") {
        for (const cast of effect.formation) {
          // Save old transform
          const old = castState.accumulatedTransform;

          // Apply changes to current transform
          castState.accumulatedTransform = {
            position: V.add(
              old.position,
              V.rotate(cast.position, old.direction)
            ),
            direction: old.direction + cast.direction,
          };

          // Go deeper
          drawAndUpdateCastState(state, castState, wandState, wand);

          // Restore transform
          castState.accumulatedTransform = old;
        }
      } else if (effect.type === "projectile") {
        let continuation: ProjectileKind<CastState>;

        if (effect.kind.type === "normal") {
          continuation = effect.kind;
        } else {
          // Trigger and timer projectiles create an isolated cast state
          const innerCastState = emptyCastState();
          drawAndUpdateCastState(state, innerCastState, wandState, wand);

          continuation = {
            ...effect.kind,
            payload: innerCastState,
          };
        }

        castState.projectiles.push({
          position: V.origin(),
          direction: 0,
          blueprint: effect.blueprint,
          continuation: continuation!,
        });
      } else if (effect.type === "modifier") {
        mergeStatsMut(castState.stats, castState.stats, effect.stats);
        drawAndUpdateCastState(state, castState, wandState, wand);
      }
    }
  } else {
    if (state.flags[Flag.DebugWandExecutionLogs])
      console.log(`Not enough mana to cast ${card.name}:(`);
    drawAndUpdateCastState(state, castState, wandState, wand); // If not enough mana on the wand, skip to the next spell
  }
}

function scheduleWandCast(
  state: SimulationState,
  delay: number,
  wid: EntityId
) {
  state.tickScheduler.schedule(state.tick + delay, shootWand(wid));
}

export function castWand(state: SimulationState, eid: EntityId) {
  const castState = emptyCastState();
  const wandState = state.components.wandHolder.wandState[eid];
  const wand = state.wands[state.components.wandHolder.wandId[eid]];

  castState.castDelay = wand.castDelay;

  drawAndUpdateCastState(state, castState, wandState, wand);

  wandState.hand.pushContentsInto(wandState.discarded);
  wandState.hand.clear();

  executeCastState(state, wand, castState, eid);

  if (state.flags[Flag.DebugWandExecutionLogs])
    console.log(`Remaining mana ${wandState.mana}`);

  if (wandState.deck.size === 0 || castState.forceRecharge) {
    if (state.flags[Flag.DebugWandExecutionLogs]) console.log("Recharge!!!");

    scheduleWandCast(
      state,
      // Require at least 1 tick of waiting. Else wait whatever accumulated delay is bigger
      Math.max(1, castState.castDelay, wandState.rechargeDelay),
      eid
    );

    resetWandState(wand, wandState);
  } else {
    scheduleWandCast(state, castState.castDelay, eid);
  }
}

export function spawnWand(
  state: SimulationState,
  wandId: WandId,
  wid = state.ecs.createEntity()
) {
  state.ecs.addComponent(wid, state.components.wandHolder);

  const wand = getWand(state, wandId);

  state.components.wandHolder.wandId[wid] = wandId;
  state.components.wandHolder.wandState[wid] = emptyWandState(state, wandId);

  state.tickScheduler.schedule(state.tick + wand.castDelay, shootWand(wid));

  if (stateIsComplete(state)) {
    state.ecs.addComponent(wid, state.components.wandStateIndicators);

    const barId = createUiBar(state, wid, {
      padding: V.create(1, 1),
      size: V.create(50, 10),
      backgroundColor: [0x222222, 0.4],
      barColor: [0x4444dd, 1],
    });

    state.components.positionOnlyChild.offset[barId].y += 40;
    state.components.wandStateIndicators[wid] = {
      manaIndicator: barId,
    };
  }

  return wid;
}

export function executeCastState(
  state: SimulationState,
  wand: Wand,
  castState: CastState,
  holderId: EntityId
) {
  for (const projectile of castState.projectiles) {
    const blueprint = state.projectileBlueprints[projectile.blueprint];
    const projectileId = state.ecs.createEntity();

    const stats = mergeStats(castState.stats, blueprint.stats);

    // Transform component
    const transform = identityTransform();

    V.cloneInto(
      transform.position,
      state.components.transform[holderId].position
    );
    V.scaleMut(transform.scale, transform.scale, 10);

    state.ecs.addComponent(projectileId, state.components.transform);
    state.components.transform[projectileId] = transform;

    // Projectile component
    state.ecs.addComponent(projectileId, state.components.projectile);
    state.components.projectile.damage[projectileId] = stats.damage;
    state.components.projectile.bounces[projectileId] = stats.bounces;

    // Velocity component
    const spread = wand.spread + stats.spread;
    const rotation = normalizeAngle(
      projectile.direction +
        state.components.transform[holderId].rotation +
        randomBetween(-spread, spread)
    );

    const velocity = V.xBasis();

    V.scaleMut(velocity, velocity, stats.speed);
    V.rotateMut(velocity, velocity, rotation);

    state.ecs.addComponent(projectileId, state.components.velocity);
    state.components.velocity[projectileId] = velocity;

    // Client only components
    if (stateIsComplete(state)) {
      // Sprite component
      addSprite(state, projectileId, LayerId.BulletLayer, blueprint.sprite);
    }

    // Randomize lifetimes so making infinite wisps isn't that easy
    const lifetime = Math.floor(
      randomBetween(stats.lifetime[0], stats.lifetime[1])
    );

    if (lifetime === -1) {
      if (state.flags[Flag.DebugWandExecutionLogs])
        console.log("Infinite wisp!");
    } else {
      // Kill projectile after a while
      state.tickScheduler.schedule(
        state.tick + lifetime,
        GameAction.despawnEntity(projectileId)
      );
    }
  }
}

export const updateWandTimers = SimpleSystem(
  (components) => E.all(components.wandHolder),
  (state, eid) => {
    const wandState = state.components.wandHolder.wandState[eid];
    const wand = getWand(state, state.components.wandHolder.wandId[eid]);

    // Recharge mana
    wandState.mana = Math.min(wandState.mana + wand.manaRecharge, wand.maxMana);
  }
);

export const updateWandVisualTimers = SimpleSystem<State>(
  (components) =>
    E.all<any>(components.wandHolder, components.wandStateIndicators),
  (state, eid) => {
    const indicators = state.components.wandStateIndicators[eid];
    const wandState = state.components.wandHolder.wandState[eid];
    const wand = getWand(state, state.components.wandHolder.wandId[eid]);

    state.components.uiBar[indicators.manaIndicator] = Math.floor(
      (255 * wandState.mana) / wand.maxMana
    );
  }
);
