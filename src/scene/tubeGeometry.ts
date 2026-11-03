import * as THREE from 'three';
import { transportFrames, type Path } from '../anatomy/path';

export interface TubeOptions {
  readonly from?: number;
  readonly to?: number;
  readonly ringSpacing: number;
  readonly radialSegments: number;
  readonly radius: (arc: number) => number;
}

function ringArcs(path: Path, o: TubeOptions): number[] {
  const from = Math.max(0, o.from ?? 0);
  const to = Math.min(path.length, o.to ?? path.length);
  const n = Math.max(1, Math.ceil((to - from) / o.ringSpacing));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

/**
 * Tube along a centreline with a radius profile. Each vertex carries its arc length in the
 * `arc` attribute (used by the contrast shader). Rebuild with `updateTubeGeometry`.
 */
export function createTubeGeometry(path: Path, o: TubeOptions): THREE.BufferGeometry {
  const arcs = ringArcs(path, o);
  const rings = arcs.length;
  const seg = o.radialSegments;
  const count = rings * (seg + 1);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const arcAttr = new Float32Array(count);
  const uv = new Float32Array(count * 2);
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k <= seg; k++) {
      const v = r * (seg + 1) + k;
      arcAttr[v] = arcs[r]!;
      uv[v * 2] = arcs[r]!;
      uv[v * 2 + 1] = k / seg;
    }
  }
  geom.setAttribute('arc', new THREE.BufferAttribute(arcAttr, 1));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < seg; k++) {
      const a = r * (seg + 1) + k;
      const b = a + seg + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geom.setIndex(index);
  geom.userData.arcs = arcs;
  updateTubeGeometry(geom, path, o);
  return geom;
}

export function updateTubeGeometry(geom: THREE.BufferGeometry, path: Path, o: TubeOptions): void {
  const arcs = geom.userData.arcs as number[];
  const frames = transportFrames(path, arcs);
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const nor = geom.getAttribute('normal') as THREE.BufferAttribute;
  const seg = o.radialSegments;
  frames.forEach((f, r) => {
    const rad = o.radius(arcs[r]!);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = f.normal[0] * c + f.binormal[0] * s;
      const ny = f.normal[1] * c + f.binormal[1] * s;
      const nz = f.normal[2] * c + f.binormal[2] * s;
      const v = r * (seg + 1) + k;
      pos.setXYZ(v, f.point[0] + nx * rad, f.point[1] + ny * rad, f.point[2] + nz * rad);
      nor.setXYZ(v, nx, ny, nz);
    }
  });
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geom.computeBoundingSphere();
}
