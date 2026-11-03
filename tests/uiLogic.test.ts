import { describe, expect, it } from 'vitest';
import { MonitorAudio } from '../src/audio/monitor';
import { Input } from '../src/ui/input';
import { mmss } from '../src/ui/dom';

describe('monitor audio', () => {
  it('beep pitch falls with SpO2', () => {
    expect(MonitorAudio.beepFrequency(100)).toBe(880);
    expect(MonitorAudio.beepFrequency(96)).toBeLessThan(MonitorAudio.beepFrequency(98));
  });
});

describe('input', () => {
  it('merges keys, hold buttons and wheel, then clears the wheel', () => {
    const i = new Input();
    i.keys.add('w');
    i.holds.add('rotL');
    i.holds.add('inflate');
    i.wheel = 2;
    i.shift = true;
    const r = i.read();
    expect(r.device).toMatchObject({ advance: 1, rotate: -1, inflate: true, wheel: 2, fine: true });
    expect(r.pedal).toBe(false);
    expect(i.read().device.wheel).toBe(0);
  });

  it('an auto override (demo) drives the same input path', () => {
    const i = new Input();
    i.keys.add('s');
    i.auto = { advance: 1, fine: true, pedal: true };
    const r = i.read();
    expect(r.device.advance).toBe(1);
    expect(r.device.fine).toBe(true);
    expect(r.pedal).toBe(true);
  });

  it('formats times as m:ss', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(125.7)).toBe('2:05');
  });
});
