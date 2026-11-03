import * as THREE from 'three';
import { beatContraction, beatScale } from '../anatomy/heartShape';
import { LABELS } from '../anatomy/labels';
import { lesionBounds } from '../anatomy/stenosis';
import type { VesselId } from '../anatomy/types';
import type { Vessel, VesselTree } from '../anatomy/vesselTree';
import type { LabelAnchor } from '../ui/labels';
import { createHeartGeometry } from './heartMesh';
import { OrbitCamera } from './orbitCamera';
import { createTubeGeometry, updateTubeGeometry, type TubeOptions } from './tubeGeometry';

const v3 = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);

/** Tube mesh for one vessel; `rebuild()` re-reads the lumen profile. */
export class VesselMesh {
  readonly mesh: THREE.Mesh;
  private readonly opts: TubeOptions;

  constructor(
    readonly vessel: Vessel,
    material: THREE.Material,
    ringSpacing: number,
    radialSegments: number,
  ) {
    const lumen = vessel.lumen;
    this.opts = { ringSpacing, radialSegments, radius: (s) => Math.max(0.08, lumen.diameterAt(s) / 2) };
    this.mesh = new THREE.Mesh(createTubeGeometry(vessel.path, this.opts), material);
    this.mesh.name = vessel.id;
    this.mesh.userData.xray = 'vessel';
    this.mesh.userData.vessel = vessel.id;
  }

  rebuild(): void {
    updateTubeGeometry(this.mesh.geometry, this.vessel.path, this.opts);
  }
}

const RING: Partial<Record<VesselId, [number, number]>> = {
  access: [3, 18],
  aorta: [2, 40],
};

/** Lit 3D anatomy: beating heart with coronaries, aorta and radial access. */
export class View3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitCamera;
  /** Scales about the pivot with each beat; holds the heart and coronaries. */
  readonly beat = new THREE.Group();
  /** Child of `beat`, offset so world-at-rest coordinates can be used inside. */
  readonly beatInner = new THREE.Group();
  readonly heart: THREE.Mesh;
  readonly vesselMeshes = new Map<VesselId, VesselMesh>();
  readonly plaque: THREE.Mesh;
  readonly homeTarget: THREE.Vector3;
  private phase = 0;

  constructor(
    readonly tree: VesselTree,
    dom: HTMLElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    this.orbit = new OrbitCamera(this.camera, dom);

    this.scene.add(new THREE.HemisphereLight(0xf2f7ff, 0x5b6f86, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-200, 300, 400);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe3ff, 0.9);
    rim.position.set(300, -100, -300);
    this.scene.add(rim);

    const pivot = v3(tree.pivot);
    this.beat.position.copy(pivot);
    this.beatInner.position.copy(pivot).negate();
    this.beat.add(this.beatInner);
    this.scene.add(this.beat);

    this.heart = new THREE.Mesh(
      createHeartGeometry(tree.frame),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
    );
    this.heart.name = 'heart';
    this.heart.userData.xray = 'heart';
    this.beatInner.add(this.heart);

    // Vessel walls are translucent so the devices inside them stay visible.
    const artery = new THREE.MeshStandardMaterial({ color: '#c8414b', roughness: 0.38, transparent: true, opacity: 0.55, depthWrite: false });
    const aorta = new THREE.MeshStandardMaterial({ color: '#c95a5f', roughness: 0.5, transparent: true, opacity: 0.42, depthWrite: false });
    for (const vessel of Object.values(tree.vessels)) {
      const [spacing, segs] = RING[vessel.id] ?? [0.4, 16];
      const vm = new VesselMesh(vessel, vessel.id === 'aorta' ? aorta : artery, spacing, segs);
      this.vesselMeshes.set(vessel.id, vm);
      (vessel.beats ? this.beatInner : this.scene).add(vm.mesh);
    }

    // Translucent plaque shell at the reference diameter over the case's lesion.
    const target = tree.vessels[tree.lesion.vessel];
    const { start, end } = lesionBounds(tree.lesion);
    this.plaque = new THREE.Mesh(
      createTubeGeometry(target.path, {
        from: start - 0.5,
        to: end + 0.5,
        ringSpacing: 0.3,
        radialSegments: 20,
        radius: (s) => this.plaqueRadius(s),
      }),
      new THREE.MeshStandardMaterial({ color: '#f6f0dc', emissive: '#3a3020', roughness: 0.85, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.plaque.name = 'plaque';
    this.beatInner.add(this.plaque);

    // Default view: AP, framing the heart and aortic root.
    this.homeTarget = v3(tree.frame.centre).lerp(v3(tree.valveCentre), 0.4);
    this.orbit.setView(this.homeTarget, this.homeDistance(1.6), 0, 0.12, true);
  }

  /** Distance that frames the heart and arch for a viewport aspect ratio (narrow → further). */
  homeDistance(aspect: number): number {
    return aspect >= 1.2 ? 330 : 330 * Math.pow(1.2 / aspect, 0.85);
  }

  /** Plaque shell: at the reference diameter, pushed outward when the lumen is dilated past it. */
  private plaqueRadius(s: number): number {
    const l = this.tree.vessels[this.tree.lesion.vessel].lumen;
    return Math.max(l.referenceAt(s) * 1.04, l.diameterAt(s) + 0.15) / 2;
  }

  /** Rebuild a vessel mesh after its lumen changed. */
  rebuildVessel(id: VesselId): void {
    this.vesselMeshes.get(id)?.rebuild();
    if (id === this.tree.lesion.vessel) {
      const { start, end } = lesionBounds(this.tree.lesion);
      updateTubeGeometry(this.plaque.geometry, this.tree.vessels[id].path, {
        from: start - 0.5,
        to: end + 0.5,
        ringSpacing: 0.3,
        radialSegments: 20,
        radius: (s) => this.plaqueRadius(s),
      });
    }
  }

  /**
   * Orbit to look at a vessel point from outside the heart: the camera goes to the side of
   * the heart where the point lies (posterior vessels such as the LCx and RCA included).
   */
  focusOn(id: VesselId, arc: number, distance: number): void {
    const p = this.vesselWorldPoint(id, arc);
    const c = v3(this.tree.frame.centre);
    const d = p.clone().sub(c).normalize();
    const yaw = Math.atan2(d.x, d.z);
    const pitch = THREE.MathUtils.clamp(Math.asin(d.y), -0.9, 0.9);
    this.orbit.setView(p, distance, yaw, pitch);
  }

  vesselObject(id: VesselId): THREE.Object3D {
    return this.vesselMeshes.get(id)!.mesh;
  }

  /** World point of a vessel at an arc length, including the heartbeat motion. */
  vesselWorldPoint(id: VesselId, arc: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.tree.vessels[id].path.pointAt(arc);
    return this.vesselObject(id).localToWorld(out.set(p[0], p[1], p[2]));
  }

  labelAnchors(): LabelAnchor[] {
    return LABELS.map((l) => {
      const vesselId = l.id === 'lesion' ? this.tree.lesion.vessel : l.vessel;
      const vessel = this.tree.vessels[vesselId];
      let arc = l.arc < 0 ? vessel.path.length + l.arc : l.arc;
      if (l.segment) {
        const seg = this.tree.accessSegments.find((s) => s.name === l.segment)!;
        arc = (seg.start + seg.end) / 2;
      }
      if (l.id === 'lesion') arc = this.tree.lesion.centreArc;
      const p = vessel.path.pointAt(arc);
      return { id: l.id, object: this.vesselObject(vesselId), local: v3(p) };
    });
  }

  /** Advance the heartbeat; returns the current contraction 0..1. */
  update(dt: number, heartRate: number): number {
    this.phase = (this.phase + (dt * heartRate) / 60) % 1;
    const c = beatContraction(this.phase);
    this.beat.scale.setScalar(beatScale(c));
    this.beat.updateMatrixWorld(true);
    this.orbit.update(dt);
    return c;
  }

  get beatPhase(): number {
    return this.phase;
  }
}
