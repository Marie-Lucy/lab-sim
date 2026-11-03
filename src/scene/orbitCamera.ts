import * as THREE from 'three';

/**
 * Orbit camera: drag to rotate, right-drag / Shift-drag to pan, Ctrl+wheel or pinch to zoom.
 * Plain wheel is left to the device controls. Moves are eased toward goal values.
 */
export class OrbitCamera {
  readonly target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  yaw = 0;
  pitch = 0.15;
  distance = 330;
  private goal = { yaw: 0, pitch: 0.15, distance: 330 };
  minDistance = 25;
  maxDistance = 1500;
  private drag: { x: number; y: number; pan: boolean } | null = null;
  private pinch: number | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly dom: HTMLElement,
  ) {
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    dom.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  setView(target: THREE.Vector3, distance: number, yaw = this.goal.yaw, pitch = this.goal.pitch, immediate = false): void {
    this.goalTarget.copy(target);
    this.goal = { yaw, pitch, distance: THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance) };
    if (immediate) {
      this.target.copy(target);
      this.yaw = yaw;
      this.pitch = pitch;
      this.distance = this.goal.distance;
    }
  }

  /** Move the orbit centre (and optionally distance) without changing the angles. */
  focus(target: THREE.Vector3, distance?: number): void {
    this.setView(target, distance ?? this.goal.distance);
  }

  zoomBy(factor: number): void {
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
  }

  private down(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.drag = null;
    }
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch !== null && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0) this.zoomBy(this.pinch / d);
      this.pinch = d;
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    if (this.drag.pan) {
      const k = (this.distance * 0.0016);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.goalTarget.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    } else {
      this.goal.yaw -= dx * 0.006;
      this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.006, -1.45, 1.45);
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.drag = null;
  }

  private wheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.zoomBy(Math.exp(e.deltaY * 0.0015));
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.yaw += (this.goal.yaw - this.yaw) * k;
    this.pitch += (this.goal.pitch - this.pitch) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.target.lerp(this.goalTarget, k);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
  }
}
