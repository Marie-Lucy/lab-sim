import * as THREE from 'three';
import type { VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';

export interface ProbeReading {
  readonly vessel: VesselId;
  readonly arc: number;
  readonly diameter: number;
  readonly reference: number;
}

/** Hover picking of a coronary in the 3D view: the local lumen diameter under the cursor. */
export class HoverProbe {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly tree: VesselTree,
    private readonly camera: THREE.Camera,
    private readonly targets: () => THREE.Object3D[],
  ) {}

  read(clientX: number, clientY: number, rect: DOMRect): ProbeReading | null {
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.targets(), false)[0];
    if (!hit) return null;
    const id = hit.object.userData.vessel as VesselId;
    const local = hit.object.worldToLocal(hit.point.clone());
    const v = this.tree.vessels[id];
    const arc = v.path.closestArc([local.x, local.y, local.z]);
    return { vessel: id, arc, diameter: v.lumen.diameterAt(arc), reference: v.lumen.referenceAt(arc) };
  }
}
