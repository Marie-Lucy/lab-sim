import * as THREE from 'three';
import { grooveFat, heartWorldPoint, type HeartFrame } from '../anatomy/heartShape';

const MYOCARDIUM = new THREE.Color('#9c3a3f');
const FAT = new THREE.Color('#e3c27a');

/** Epicardial surface as a (theta, phi) grid with vertex colours for groove fat. */
export function createHeartGeometry(frame: HeartFrame, thetaSeg = 96, phiSeg = 72): THREE.BufferGeometry {
  const count = (thetaSeg + 1) * (phiSeg + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= phiSeg; j++) {
    const phi = (j / phiSeg) * Math.PI;
    for (let i = 0; i <= thetaSeg; i++) {
      const theta = (i / thetaSeg) * Math.PI * 2 - Math.PI;
      const v = j * (thetaSeg + 1) + i;
      const p = heartWorldPoint(frame, theta, phi);
      pos.set(p, v * 3);
      c.copy(MYOCARDIUM).lerp(FAT, grooveFat(theta, phi));
      col.set([c.r, c.g, c.b], v * 3);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < phiSeg; j++) {
    for (let i = 0; i < thetaSeg; i++) {
      const a = j * (thetaSeg + 1) + i;
      const b = a + thetaSeg + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
