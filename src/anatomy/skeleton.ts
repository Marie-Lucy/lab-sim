import { SKELETON as S } from '../config/anatomy';
import type { Vec3 } from './vec';

export interface Box {
  readonly centre: Vec3;
  readonly size: Vec3;
}

export interface SkeletonLayout {
  readonly vertebrae: readonly Box[];
  /** Rib centrelines (left and right of each level). */
  readonly ribs: readonly Vec3[][];
  readonly diaphragm: readonly { readonly centre: Vec3; readonly radii: Vec3 }[];
}

/** Procedural thoracic spine, ribs and diaphragm domes, placed around the aortic root. */
export function skeletonLayout(valve: Vec3): SkeletonLayout {
  const mx = valve[0] + S.midlineOffsetX;
  const sz = valve[2] + S.spineOffsetZ;
  const vertebrae: Box[] = [];
  for (let i = 0; i < S.vertebraCount; i++) {
    const y = valve[1] + S.vertebraTopY - i * S.vertebraPitch;
    const grow = 1 + i * 0.02;
    vertebrae.push({
      centre: [mx, y, sz],
      size: [S.vertebraSize.width * grow, S.vertebraSize.height, S.vertebraSize.depth * grow],
    });
  }
  const ribs: Vec3[][] = [];
  const cz = sz + S.chestRadius.z * 0.75;
  for (let i = 0; i < S.ribCount; i++) {
    const y0 = valve[1] + S.ribTopY - i * S.ribPitch;
    const widen = 0.75 + 0.25 * Math.min(1, i / 4);
    for (const side of [-1, 1]) {
      const pts: Vec3[] = [];
      for (let k = 0; k <= 24; k++) {
        // From the spine (back) around the side to the front.
        const t = k / 24;
        const ang = -Math.PI / 2 + t * (Math.PI * 0.85);
        const x = mx + side * Math.cos(ang) * S.chestRadius.x * widen;
        const z = cz + Math.sin(ang) * S.chestRadius.z;
        pts.push([x + side * 8 * (1 - t), y0 - S.ribSlope * t * t, z]);
      }
      ribs.push(pts);
    }
  }
  const r = S.diaphragmRadius;
  const diaphragm = [
    { centre: [mx - 60, valve[1] + S.diaphragmRightTopY - r.y, sz + 70] as Vec3, radii: [r.x, r.y, r.z] as Vec3 },
    { centre: [mx + 60, valve[1] + S.diaphragmLeftTopY - r.y, sz + 70] as Vec3, radii: [r.x, r.y, r.z] as Vec3 },
  ];
  return { vertebrae, ribs, diaphragm };
}
