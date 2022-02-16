import { Task, TaskId } from "../../TickScheduler";
import {
  actionIdMask,
  GameAction,
  maxActionCount,
  onDespawn,
} from "../GameAction";
import { State } from "../State";
import { spawnBullets } from "./spawnBullet";

export function handleGameAction(state: State, task: Task<number>) {
  const action = task.task;
  const id = action & actionIdMask;

  if (id === GameAction.DespawnEntity) {
    const eid = action >> maxActionCount;
    triggerEvent(state, onDespawn(eid));
    state.ecs.destroyEntity(eid);
  } else if (id === GameAction.HandleBulletSpawner)
    spawnBullets(state, action >> maxActionCount);
  else if (id === GameAction.DebugLog) {
    console.log("Debug log!");
  }
}

export function triggerEvent(state: State, event: TaskId) {
  const tasks = state.tickScheduler.triggerEvent(event);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    handleGameAction(state, task);
  }
}