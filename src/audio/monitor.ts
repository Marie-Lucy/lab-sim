/**
 * Monitor sounds with Web Audio: a short QRS beep whose pitch follows SpO2 (lower
 * saturation, lower pitch) and a two-tone alarm while the patient is unstable.
 * The context is created on the first user gesture (the start button).
 */
export class MonitorAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  enabled = true;
  private alarmClock = 0;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.18;
    this.gain.connect(this.ctx.destination);
  }

  /** Pitch: ~880 Hz at 100 %, about 12 Hz lower per percent of desaturation. */
  static beepFrequency(spo2: number): number {
    return 880 - (100 - spo2) * 12;
  }

  private tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.gain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.gain);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  beep(spo2: number, pvc = false): void {
    if (!this.enabled || !this.ctx) return;
    this.tone(MonitorAudio.beepFrequency(spo2) * (pvc ? 0.92 : 1), this.ctx.currentTime, 0.09, 0.5);
  }

  /** Call every frame; plays the two-tone pattern while `active`. */
  alarm(active: boolean, dt: number): void {
    if (!active) {
      this.alarmClock = 0;
      return;
    }
    this.alarmClock -= dt;
    if (this.alarmClock > 0 || !this.enabled || !this.ctx) return;
    this.alarmClock = 1.4;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      this.tone(960, t + i * 0.42, 0.18, 0.35, 'square');
      this.tone(770, t + i * 0.42 + 0.2, 0.18, 0.35, 'square');
    }
  }
}
