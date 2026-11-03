import * as THREE from 'three';
import { CONTRAST, FLUORO, SKELETON } from '../config/anatomy';
import { skeletonLayout } from '../anatomy/skeleton';
import { Path } from '../anatomy/path';
import type { Projection, VesselId } from '../anatomy/types';
import type { VesselTree } from '../anatomy/vesselTree';
import { carmDirection } from '../physics/carm';
import { arrivalAt, NEVER, stainDensity, type ContrastPlan } from '../physics/contrast';
import type { DeviceController } from '../tools/deviceController';
import { createTubeGeometry } from './tubeGeometry';
import { blitMaterial, postMaterial, shellMaterial, solidMaterial, stainMaterial, vesselMaterial } from './xrayMaterials';

/** Kinds of 3D meshes that appear on fluoroscopy (set as `userData.xray`). */
export type XrayKind = 'heart' | 'vessel' | 'guide' | 'wire' | 'wireTip' | 'shaft' | 'balloon' | 'marker' | 'stent' | 'flap';

/**
 * Fluoroscopy: a separate scene of X-ray absorbers. Anatomy and devices are mirrored from
 * the 3D scene (same geometry, same world matrix, so the heartbeat carries over); the
 * skeleton and diaphragm exist only here. Frames are acquired in pulses and post-processed
 * into a held frame that is shown until the next pulse (LIH when the beam is off).
 */
export class FluoroView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly isocentre: THREE.Vector3;
  private readonly mirrors = new Map<THREE.Mesh, THREE.Mesh>();
  private readonly vesselMats = new Map<VesselId, THREE.ShaderMaterial>();
  private readonly mats = {
    heart: solidMaterial(FLUORO.tissue.heart, 0.8),
    guide: solidMaterial(FLUORO.device.guide, 0.4),
    wire: solidMaterial(FLUORO.device.wireBody, 0.2),
    wireTip: solidMaterial(FLUORO.device.wireTip, 0.2),
    shaft: solidMaterial(0.12, 0.4),
    balloon: solidMaterial(0.1, 0.5),
    marker: solidMaterial(FLUORO.device.marker, 0.2),
    stent: shellMaterial(FLUORO.device.stentShell),
  };
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly frameRT: THREE.WebGLRenderTarget;
  private readonly post = postMaterial();
  private readonly blit = blitMaterial();
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private plan: ContrastPlan | null = null;
  private planStart = 0;
  private hasFrame = false;

  constructor(
    private readonly tree: VesselTree,
    private readonly ctrl: DeviceController,
    private readonly sources: readonly THREE.Object3D[],
  ) {
    const f = SKELETON;
    this.camera = new THREE.PerspectiveCamera((2 * Math.atan(f.fieldHalf / f.sourceDistance) * 180) / Math.PI, 1, 100, 3000);
    const c = tree.frame.centre;
    const v = tree.valveCentre;
    this.isocentre = new THREE.Vector3(c[0], c[1], c[2]).lerp(new THREE.Vector3(v[0], v[1], v[2]), 0.35);
    this.buildSkeleton();
    this.sceneRT = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false });
    this.frameRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.setProjection({ lao: 0, cranial: 0 });
  }

  private buildSkeleton(): void {
    const layout = skeletonLayout(this.tree.valveCentre);
    const bone = solidMaterial(FLUORO.tissue.spine, 0.5);
    const rib = solidMaterial(FLUORO.tissue.ribs, 0.5);
    const dia = solidMaterial(FLUORO.tissue.diaphragm, 0.35);
    for (const b of layout.vertebrae) {
      // Vertebral bodies as flattened ellipsoids: soft edges, visible disc spaces between.
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), bone);
      m.scale.set(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2);
      m.position.set(...b.centre);
      this.scene.add(m);
    }
    for (const r of layout.ribs) {
      this.scene.add(new THREE.Mesh(createTubeGeometry(new Path(r), { ringSpacing: 4, radialSegments: 8, radius: () => SKELETON.ribRadius }), rib));
    }
    for (const d of layout.diaphragm) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), dia);
      m.scale.set(...d.radii);
      m.position.set(...d.centre);
      this.scene.add(m);
    }
  }

  setProjection(p: Projection): void {
    const d = carmDirection(p);
    this.camera.position.copy(this.isocentre).addScaledVector(new THREE.Vector3(...d), SKELETON.sourceDistance);
    // Keep the head toward the top of the image.
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(...d);
    up.addScaledVector(dir, -up.dot(dir)).normalize();
    if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
    this.camera.up.copy(up);
    this.camera.lookAt(this.isocentre);
    this.camera.updateMatrixWorld();
  }

  /** Start showing an injection: per-vertex arrival times come from the plan. */
  setPlan(plan: ContrastPlan | null, start: number): void {
    this.plan = plan;
    this.planStart = start;
    this.refreshAttributes();
  }

  /** Re-write arrival and diameter attributes (after a new plan or a lumen change). */
  refreshAttributes(): void {
    for (const src of this.mirrors.keys()) if (src.userData.xray === 'vessel') this.writeVesselAttributes(src);
  }

  private writeVesselAttributes(src: THREE.Mesh): void {
    const id = src.userData.vessel as VesselId;
    const g = src.geometry;
    const arcs = g.getAttribute('arc') as THREE.BufferAttribute;
    let arrival = g.getAttribute('arrival') as THREE.BufferAttribute | undefined;
    let diam = g.getAttribute('diam') as THREE.BufferAttribute | undefined;
    if (!arrival || arrival.count !== arcs.count) {
      arrival = new THREE.BufferAttribute(new Float32Array(arcs.count), 1);
      diam = new THREE.BufferAttribute(new Float32Array(arcs.count), 1);
      g.setAttribute('arrival', arrival);
      g.setAttribute('diam', diam);
    }
    const lumen = this.tree.vessels[id].lumen;
    for (let i = 0; i < arcs.count; i++) {
      const s = arcs.getX(i);
      arrival.setX(i, this.plan ? arrivalAt(this.plan, this.tree, id, s) : NEVER);
      diam!.setX(i, lumen.diameterAt(s));
    }
    arrival.needsUpdate = true;
    diam!.needsUpdate = true;
  }

  private materialFor(src: THREE.Mesh): THREE.Material | null {
    const kind = src.userData.xray as XrayKind | undefined;
    if (!kind) return null;
    if (kind === 'vessel') {
      const id = src.userData.vessel as VesselId;
      let m = this.vesselMats.get(id);
      if (!m) this.vesselMats.set(id, (m = vesselMaterial()));
      return m;
    }
    if (kind === 'flap') return stainMaterial();
    return this.mats[kind];
  }

  /** Mirror every tagged mesh of the 3D scene (geometry, visibility, world matrix). */
  private sync(): void {
    const seen = new Set<THREE.Mesh>();
    for (const root of this.sources) {
      root.traverseVisible((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh || !src.userData.xray) return;
        seen.add(src);
        let m = this.mirrors.get(src);
        if (!m) {
          const mat = this.materialFor(src);
          if (!mat) return;
          m = new THREE.Mesh(src.geometry, mat);
          m.matrixAutoUpdate = false;
          m.matrixWorldAutoUpdate = false;
          m.frustumCulled = false;
          this.scene.add(m);
          this.mirrors.set(src, m);
          if (src.userData.xray === 'vessel') this.writeVesselAttributes(src);
        }
        if (m.geometry !== src.geometry) m.geometry = src.geometry;
        m.matrixWorld.copy(src.matrixWorld);
        m.visible = true;
      });
    }
    for (const [src, m] of this.mirrors) {
      if (seen.has(src)) continue;
      m.visible = false;
      if (!src.parent) {
        this.scene.remove(m);
        if (src.userData.xray === 'flap') (m.material as THREE.Material).dispose();
        this.mirrors.delete(src);
      }
    }
  }

  private updateUniforms(time: number): void {
    const t = this.plan ? time - this.planStart : -1;
    for (const [id, m] of this.vesselMats) {
      m.uniforms.uT!.value = t;
      m.uniforms.uDur!.value = this.plan?.duration ?? CONTRAST.selectiveInjectionS;
      m.uniforms.uIntensity!.value = this.plan?.intensity[id] ?? 0;
    }
    const c = this.ctrl.catheter;
    this.mats.balloon.uniforms.uAtt!.value = c && c.pressure > 0.2 ? FLUORO.device.inflatedBalloon : 0.1;
    for (const [src, m] of this.mirrors) {
      if (src.userData.xray !== 'flap') continue;
      const d = this.ctrl.treatment.dissections[src.userData.dissection as number];
      const a = this.plan && d ? arrivalAt(this.plan, this.tree, d.vessel, d.from) : NEVER;
      (m.material as THREE.ShaderMaterial).uniforms.uDensity!.value = stainDensity(a, t, this.plan?.duration ?? 1);
    }
  }

  /** Acquire a new frame (one X-ray pulse). */
  acquire(renderer: THREE.WebGLRenderer, time: number): void {
    this.sync();
    this.updateUniforms(time);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.frameRT.width !== size.x || this.frameRT.height !== size.y) this.frameRT.setSize(size.x, size.y);
    renderer.setRenderTarget(this.sceneRT);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.quad.material = this.post;
    this.post.uniforms.tScene!.value = this.sceneRT.texture;
    this.post.uniforms.uRes!.value.set(size.x, size.y);
    this.post.uniforms.uSquare!.value = Math.min(size.x, size.y);
    this.post.uniforms.uSeed!.value = Math.random() * 100;
    renderer.setRenderTarget(this.frameRT);
    renderer.render(this.quadScene, this.quadCamera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    this.hasFrame = true;
  }

  /** Show the held frame (black before the first pulse). */
  display(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    renderer.setClearColor(0x050607, 1);
    renderer.clear();
    renderer.setClearColor(0x000000, 0);
    if (!this.hasFrame) return;
    this.quad.material = this.blit;
    this.blit.uniforms.tFrame!.value = this.frameRT.texture;
    this.blit.uniforms.uRes!.value.set(size.x, size.y);
    renderer.render(this.quadScene, this.quadCamera);
  }

  /** The held frame is stale after a resize (it was sized for the old viewport). */
  invalidate(): void {
    this.hasFrame = false;
  }
}
