import { all, ECS, types } from "wolf-ecs";
import { Texture } from "./assets";
import { Camera as Camera2d } from "./common/Camera";
import { Flags } from "./common/Flags";
import type { Transform as Transform2d } from "./common/Transform";
import { Map } from "./Map";

export type ComponentMap = ReturnType<typeof createComponents>;
export type QueryMap = Record<keyof ReturnType<typeof createQueries>, Query>;
export type Query = ReturnType<ECS["createQuery"]>;

export const enum LayerId {
  BuildingLayer,
  UnitLayer,
  BulletLayer,
  DebugLayer,
  LastLayer,
}

export interface State {
  contexts: Array<CanvasRenderingContext2D>;
  ecs: ECS;
  tick: number;
  components: ComponentMap;
  queries: QueryMap;
  assets: ReadonlyArray<Texture>;
  map: Map;
  camera: Camera2d;
  screenTransform: Camera2d;
  flags: Flags;
}

// ========== Runtime type specs
export const Vector2 = {
  x: types.f32,
  y: types.f32,
};

export const Transform = {
  position: Vector2,
  scale: Vector2,
  rotation: types.f32,
};

export const createComponents = (ecs: ECS) => {
  const transform = ecs.defineComponent(Transform);
  const velocity = ecs.defineComponent(Vector2);
  const angularVelocity = ecs.defineComponent(types.f32);
  const bulletEmitter = ecs.defineComponent({
    frequency: types.u8,
  });
  const bullet = ecs.defineComponent();
  const mortal = ecs.defineComponent({
    lifetime: types.u16,
  });
  const created = ecs.defineComponent({
    createdAt: types.u32,
  });
  const texture = ecs.defineComponent({
    textureId: types.u8,
    width: types.u8,
    height: types.u8,
    layer: types.u8,
  });
  const teamBase = ecs.defineComponent({
    baseId: types.u8,
  });

  return {
    velocity,
    transform,
    bullet,
    bulletEmitter,
    mortal,
    texture,
    created,
    teamBase,
    angularVelocity,
  };
};

export const createQueries = (ecs: ECS, components: ComponentMap) => {
  return {
    kinematics: ecs.createQuery(
      all<any>(components.transform, components.velocity)
    ),
    rotating: ecs.createQuery(
      all<any>(components.transform, components.angularVelocity)
    ),
    bullets: ecs.createQuery(
      all<any>(components.transform, components.mortal, components.bullet)
    ),
    bulletEmitters: ecs.createQuery(
      all<any>(
        components.created,
        components.transform,
        components.bulletEmitter
      )
    ),
    mortal: ecs.createQuery(all(components.mortal)),
    textured: ecs.createQuery(
      all<any>(components.texture, components.transform)
    ),
    teamBase: ecs.createQuery(
      all<any>(components.teamBase, components.texture)
    ),
  };
};

// ========== Constants
export const layers = Array(LayerId.LastLayer)
  .fill(1)
  .map((_, i) => i);
