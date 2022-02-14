// ========== Asset imports
import textureBlueBullet from "/public/assets/blue_bullet.svg";
import textureYellowBase from "/public/assets/yellow_base.svg";
import textureBulletSpawner from "/public/assets/bullet_spawner.svg";
import texturePurpleBoid from "/public/assets/purple_boid.svg";
import textureOrangeBoid from "/public/assets/orange_boid.svg";

export const enum TextureId {
  BlueBullet,
  YellowBase,
  BulletSpawner,
  PurpleBoid,
  OrangeBoid,
}

const assetPaths: Record<TextureId, string> = {
  [TextureId.BlueBullet]: textureBlueBullet,
  [TextureId.YellowBase]: textureYellowBase,
  [TextureId.BulletSpawner]: textureBulletSpawner,
  [TextureId.PurpleBoid]: texturePurpleBoid,
  [TextureId.OrangeBoid]: textureOrangeBoid,
};

export interface Texture {
  image: HTMLImageElement;
  inherentRotation: number;
}

export const assets: ReadonlyArray<Texture> = Object.entries(assetPaths).reduce(
  (previous, current) => {
    const image = new Image(100, 100);
    image.src = current[1];

    previous[current[0] as unknown as number] = {
      image,
      inherentRotation: Math.PI / 2,
    };

    return previous;
  },
  [] as Array<Texture>
);

// ========== Constants
export const boidTextureByTeam = [TextureId.PurpleBoid, TextureId.OrangeBoid];
