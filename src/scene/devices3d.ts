import * as THREE from 'three';
import { GUIDE, WIRE } from '../config/anatomy';
import { Path } from '../anatomy/path';
import type { Vec3 } from '../anatomy/vec';
import { currentDiameter, inGuide, workingSpan } from '../physics/catheter';
import { guideTipPoints } from '../physics/guideTip';
import type { DeviceController } from '../tools/deviceController';
import { createTubeGeometry } from './tubeGeometry';
import type { View3D } from './view3d';

function stentStrutTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.beginPath();
  // One diamond cell, tiled along and around the tube.
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Rebuilds device tubes in the 3D scene from the controller state. */
export class Devices3D {
  private readonly guide = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: '#dfe8f2', roughness: 0.35 }));
  private readonly wire = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: '#3b4654', roughness: 0.3, metalness: 0.6 }));
  /** Radiopaque distal 30 mm of the wire (drawn separately so fluoro can show it darker). */
  private readonly wireTip = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: '#1f2731', roughness: 0.3, metalness: 0.7 }));
  private readonly shaft = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ color: '#9fb3c8', roughness: 0.4 }));
  private readonly balloon = new THREE.Mesh(
    undefined,
    new THREE.MeshStandardMaterial({ color: '#c9d4df', roughness: 0.25, transparent: true, opacity: 0.85 }),
  );
  private readonly markers = new THREE.Group();
  private readonly stentGroup = new THREE.Group();
  private readonly flaps = new THREE.Group();
  private readonly strut = stentStrutTexture();
  private readonly stentMat: THREE.MeshStandardMaterial;
  private readonly flapMat = new THREE.MeshStandardMaterial({ color: '#2a0d12', roughness: 0.9 });
  private readonly sealedFlapMat = new THREE.MeshStandardMaterial({ color: '#5b2a31', roughness: 0.9 });
  private readonly markerGeom = new THREE.SphereGeometry(0.5, 10, 8);
  private readonly markerMat = new THREE.MeshStandardMaterial({ color: '#1b2533', metalness: 0.5 });
  private lastKey = '';
  private lastTreatment = '';

  constructor(
    private readonly view: View3D,
    private readonly ctrl: DeviceController,
  ) {
    this.stentMat = new THREE.MeshStandardMaterial({
      color: '#d7dde4',
      metalness: 0.85,
      roughness: 0.3,
      alphaMap: this.strut,
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    view.scene.add(this.guide);
    for (const m of [this.wire, this.wireTip, this.shaft, this.balloon, this.markers, this.stentGroup, this.flaps]) view.beatInner.add(m);
    this.guide.visible = this.wire.visible = this.wireTip.visible = this.shaft.visible = this.balloon.visible = false;
    this.guide.userData.xray = 'guide';
    this.wire.userData.xray = 'wire';
    this.wireTip.userData.xray = 'wireTip';
    this.shaft.userData.xray = 'shaft';
    this.balloon.userData.xray = 'balloon';
  }

  private setTube(mesh: THREE.Mesh, path: Path | null, radius: (s: number) => number, spacing: number, segs: number): void {
    mesh.geometry.dispose();
    if (!path || path.length < 0.2) {
      mesh.visible = false;
      return;
    }
    mesh.geometry = createTubeGeometry(path, { ringSpacing: spacing, radialSegments: segs, radius });
    mesh.visible = true;
  }

  /** World position of the active device tip (for camera follow). */
  tipWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const c = this.ctrl;
    if (c.wire.out) {
      const p = c.route.pointAt(c.route.length);
      return this.view.beatInner.localToWorld(out.set(p[0], p[1], p[2]));
    }
    const pts = guideTipPoints(c.tree, c.guideRoute, c.guide, c.tree.setup.cusp);
    const p = pts[pts.length - 1]!;
    return out.set(p[0], p[1], p[2]);
  }

  update(): void {
    const c = this.ctrl;
    const cat = c.catheter;
    const key = JSON.stringify([
      c.guide.arc.toFixed(2), c.guide.rotationDeg.toFixed(1), c.guide.engaged,
      c.wire.out, c.wire.chain, c.wire.tipArc.toFixed(2), c.wire.buckle.toFixed(2),
      cat && [cat.kind, cat.advanced.toFixed(2), cat.pressure.toFixed(2), cat.diameter, cat.length, cat.deployed],
    ]);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.rebuildDevices();
    }
    const tkey = JSON.stringify([c.treatment.stents, c.treatment.dissections]);
    if (tkey !== this.lastTreatment) {
      this.lastTreatment = tkey;
      this.rebuildTreatment();
    }
  }

  private rebuildDevices(): void {
    const c = this.ctrl;
    // Guide: body along the rail plus the shaped tip.
    if (c.guide.arc > 0.5) {
      const route = c.guideRoute.path;
      const pts: Vec3[] = [];
      for (let s = 0; s < c.guide.arc; s += 3) pts.push(route.pointAt(s));
      pts.push(route.pointAt(c.guide.arc));
      pts.push(...guideTipPoints(c.tree, c.guideRoute, c.guide, c.tree.setup.cusp));
      this.setTube(this.guide, new Path(pts), () => GUIDE.outerDiameter / 2, 1.5, 12);
    } else this.guide.visible = false;

    // Wire: from the LM ostium to the tip, with a buckle near the tip when forcing.
    if (c.wire.out) {
      const route = c.route;
      const pts: Vec3[] = [];
      const b = c.wire.buckle;
      for (let s = 0; s <= route.length; s += 0.5) {
        const p = route.pointAt(s);
        const toTip = route.length - s;
        if (b > 0 && toTip < 6) {
          const k = Math.sin((toTip / 6) * Math.PI) * b * 1.2;
          const n = c.tree.frame.z;
          pts.push([p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k]);
        } else pts.push(p);
      }
      pts.push(route.pointAt(route.length));
      // Split at the radiopaque tip.
      const split = Math.max(0, Math.floor((route.length - WIRE.radiopaqueTipLength) / 0.5));
      const body = pts.slice(0, split + 1);
      const tip = pts.slice(split);
      const r = () => Math.max(0.22, WIRE.diameter / 2);
      this.setTube(this.wire, body.length > 1 ? new Path(body) : null, r, 0.5, 6);
      this.setTube(this.wireTip, tip.length > 1 ? new Path(tip) : null, r, 0.5, 6);
    } else this.wire.visible = this.wireTip.visible = false;

    // Balloon / stent catheter.
    const cat = c.catheter;
    for (const m of this.markers.children) if ((m as THREE.Mesh).geometry !== this.markerGeom) (m as THREE.Mesh).geometry.dispose();
    this.markers.clear();
    if (cat && !inGuide(cat) && c.wire.out) {
      const route = c.route;
      const w = workingSpan(cat);
      const shaftPts: Vec3[] = [];
      for (let s = 0; s <= Math.max(0, w.start); s += 1) shaftPts.push(route.pointAt(s));
      shaftPts.push(route.pointAt(Math.max(0.01, w.start)));
      this.setTube(this.shaft, shaftPts.length > 1 ? new Path(shaftPts) : null, () => 0.45, 1, 8);
      const balPts: Vec3[] = [];
      for (let s = Math.max(0, w.start - 1); s <= cat.advanced; s += 0.3) balPts.push(route.pointAt(s));
      balPts.push(route.pointAt(cat.advanced));
      const d = currentDiameter(cat);
      const inflated = cat.pressure > 0.2;
      const r = (s: number) => {
        const local = s + Math.max(0, w.start - 1);
        const inside = local >= w.start && local <= w.end;
        if (!inside) return 0.45;
        const edge = Math.min(local - w.start, w.end - local);
        return 0.45 + (d / 2 - 0.45) * Math.min(1, edge / 1.2);
      };
      this.setTube(this.balloon, balPts.length > 1 ? new Path(balPts) : null, r, 0.3, 18);
      const mat = this.balloon.material as THREE.MeshStandardMaterial;
      mat.color.set(inflated ? (cat.kind === 'balloon' ? '#f2c94c' : '#f2d77a') : cat.ruptured ? '#7a6b6b' : '#c9d4df');
      mat.opacity = inflated ? 0.95 : 0.85;
      if (cat.kind === 'stent' && !cat.deployed) {
        // Crimped stent on its delivery balloon.
        const sPts: Vec3[] = [];
        for (let s = w.start; s <= w.end; s += 0.3) sPts.push(route.pointAt(s));
        const crimp = new THREE.Mesh(createTubeGeometry(new Path(sPts), { ringSpacing: 0.3, radialSegments: 18, radius: () => d / 2 + 0.06 }), this.stentMat);
        crimp.userData.xray = 'stent';
        this.setStentUv(crimp.geometry);
        this.markers.add(crimp);
      }
      for (const s of [w.start, w.end]) {
        const p = route.pointAt(s);
        const m = new THREE.Mesh(this.markerGeom, this.markerMat);
        m.userData.xray = 'marker';
        m.position.set(p[0], p[1], p[2]);
        this.markers.add(m);
      }
    } else {
      this.shaft.visible = false;
      this.balloon.visible = false;
    }
  }

  /** Map the strut texture: one cell per ~1.5 mm along, 6 around. */
  private setStentUv(g: THREE.BufferGeometry): void {
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const arc = g.getAttribute('arc') as THREE.BufferAttribute;
    const a0 = arc.getX(0);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (arc.getX(i) - a0) / 1.5, uv.getY(i) * 6);
    uv.needsUpdate = true;
  }

  private rebuildTreatment(): void {
    const c = this.ctrl;
    for (const g of [this.stentGroup, this.flaps]) {
      g.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
      g.clear();
    }
    for (const s of c.treatment.stents) {
      const v = c.tree.vessels[s.vessel];
      const geom = createTubeGeometry(v.path, {
        from: s.from,
        to: s.to,
        ringSpacing: 0.3,
        radialSegments: 24,
        radius: (a) => Math.max(v.lumen.diameterAt(a), s.diameter * 0.97) / 2 + 0.05,
      });
      this.setStentUv(geom);
      const sm = new THREE.Mesh(geom, this.stentMat);
      sm.userData.xray = 'stent';
      this.stentGroup.add(sm);
    }
    for (const [index, d] of c.treatment.dissections.entries()) {
      const v = c.tree.vessels[d.vessel];
      const pts: Vec3[] = [];
      const side = c.tree.frame.z;
      for (let a = d.from; a <= d.to; a += 0.4) {
        const p = v.path.pointAt(a);
        const off = v.lumen.diameterAt(a) * 0.5 + 0.25;
        pts.push([p[0] + side[0] * off, p[1] + side[1] * off, p[2] + side[2] * off]);
      }
      if (pts.length < 2) continue;
      const flap = new THREE.Mesh(
        createTubeGeometry(new Path(pts), { ringSpacing: 0.4, radialSegments: 8, radius: (a) => 0.35 + 0.25 * Math.sin((a / (d.to - d.from)) * Math.PI) }),
        this.flapMat,
      );
      flap.material = d.sealed ? this.sealedFlapMat : this.flapMat;
      flap.userData.xray = 'flap';
      flap.userData.dissection = index;
      this.flaps.add(flap);
    }
  }
}
