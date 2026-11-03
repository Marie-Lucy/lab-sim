import { tk } from '../i18n';
import * as THREE from 'three';

export interface LabelAnchor {
  readonly id: string;
  /** Object whose local space holds `local` (moves with the heartbeat if it beats). */
  readonly object: THREE.Object3D;
  readonly local: THREE.Vector3;
}

/**
 * Anatomy labels as HTML tags projected from 3D anchors. Labels behind the heart are
 * dimmed (ray test against the heart, a few per frame). Hover shows the description.
 */
export class Labels {
  private readonly root: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly items: { anchor: LabelAnchor; el: HTMLDivElement; behind: boolean }[] = [];
  private readonly ray = new THREE.Raycaster();
  private cursor = 0;
  private visible = true;
  private readonly v = new THREE.Vector3();
  private readonly cam = new THREE.Vector3();

  constructor(
    parent: HTMLElement,
    anchors: readonly LabelAnchor[],
    private readonly camera: THREE.Camera,
    private readonly occluder: THREE.Object3D,
    /** Values quoted in label texts (the lesion's % and length). */
    private readonly params: () => Record<string, string | number> = () => ({}),
  ) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    parent.appendChild(this.root);
    this.tip = document.createElement('div');
    this.tip.className = 'label-tip';
    this.root.appendChild(this.tip);
    for (const anchor of anchors) {
      const el = document.createElement('div');
      el.className = 'label';
      el.innerHTML = '<span class="dot"></span><span class="txt"></span>';
      const txt = el.querySelector<HTMLElement>('.txt')!;
      txt.addEventListener('pointerenter', () => this.showTip(anchor, el));
      txt.addEventListener('pointerleave', () => this.tip.classList.remove('show'));
      this.root.appendChild(el);
      this.items.push({ anchor, el, behind: false });
    }
    this.translate();
  }

  /** Re-read the label titles in the current language. */
  translate(): void {
    for (const it of this.items) it.el.querySelector('.txt')!.textContent = tk(`label.${it.anchor.id}`, this.params());
    this.tip.classList.remove('show');
  }

  private showTip(a: LabelAnchor, el: HTMLElement): void {
    this.tip.innerHTML = `<b></b><span></span>`;
    this.tip.querySelector('b')!.textContent = tk(`label.${a.id}`, this.params());
    this.tip.querySelector('span')!.textContent = tk(`label.${a.id}.desc`, this.params());
    const r = el.getBoundingClientRect();
    const w = Math.min(260, window.innerWidth - 24);
    this.tip.style.width = `${w}px`;
    this.tip.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left))}px`;
    this.tip.style.top = `${r.bottom + 6}px`;
    this.tip.classList.add('show');
  }

  get shown(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  update(width: number, height: number): void {
    if (!this.visible) return;
    this.camera.getWorldPosition(this.cam);
    for (let k = 0; k < 3 && this.items.length; k++) {
      const it = this.items[this.cursor++ % this.items.length]!;
      const p = it.anchor.object.localToWorld(this.v.copy(it.anchor.local));
      const dir = p.clone().sub(this.cam);
      const dist = dir.length();
      this.ray.set(this.cam, dir.normalize());
      this.ray.far = dist;
      const hit = this.ray.intersectObject(this.occluder, false)[0];
      it.behind = !!hit && hit.distance < dist - 4;
    }
    for (const it of this.items) {
      const p = it.anchor.object.localToWorld(this.v.copy(it.anchor.local)).project(this.camera);
      if (p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) {
        it.el.style.opacity = '0';
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height;
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      it.el.style.opacity = it.behind ? '0.35' : '1';
      it.el.classList.toggle('behind', it.behind);
      // Labels near the right edge extend to the left of their dot.
      it.el.classList.toggle('flip', x > width - 130);
    }
  }
}
