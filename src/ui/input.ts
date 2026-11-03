import { NO_INPUT, type DeviceInput } from '../tools/deviceController';

export interface AutoInput extends Partial<DeviceInput> {
  readonly pedal?: boolean;
}

/**
 * Collects keyboard, wheel and on-screen hold buttons into one DeviceInput per frame.
 * The demo drives the SAME path through `auto` (an override of these inputs).
 */
export class Input {
  readonly keys = new Set<string>();
  /** On-screen hold buttons: advance, retract, rotL, rotR, inflate, deflate, pedal. */
  readonly holds = new Set<string>();
  shift = false;
  fineToggle = false;
  wheel = 0;
  auto: AutoInput | null = null;

  read(): { device: DeviceInput; pedal: boolean } {
    const k = this.keys;
    const b = this.holds;
    const a = this.auto;
    const device: DeviceInput = {
      ...NO_INPUT,
      advance: (k.has('w') || b.has('advance') ? 1 : 0) - (k.has('s') || b.has('retract') ? 1 : 0),
      rotate: (k.has('d') || b.has('rotR') ? 1 : 0) - (k.has('a') || b.has('rotL') ? 1 : 0),
      fine: this.shift || this.fineToggle,
      wheel: this.wheel,
      inflate: k.has('e') || b.has('inflate'),
      deflate: k.has('q') || b.has('deflate'),
      ...(a ?? {}),
    };
    const pedal = a?.pedal ?? (k.has(' ') || k.has('6') || b.has('pedal'));
    this.wheel = 0;
    return { device, pedal };
  }

  clear(): void {
    this.keys.clear();
    this.holds.clear();
    this.wheel = 0;
  }
}

/** Wire a button so it is "held" while pressed (mouse or touch). */
export function holdButton(el: HTMLElement, input: Input, name: string): void {
  const on = (e: PointerEvent) => {
    e.preventDefault();
    input.holds.add(name);
    el.classList.add('held');
    el.setPointerCapture?.(e.pointerId);
  };
  const off = () => {
    input.holds.delete(name);
    el.classList.remove('held');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
}
