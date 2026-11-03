import { describe, expect, it } from 'vitest';
import { createEmitter, createSimStore, createStore } from '../src/state/store';
import { pushMessage } from '../src/state/messages';

describe('store', () => {
  it('notifies subscribers after updates and unsubscribes', () => {
    const s = createStore({ n: 0 });
    let seen = -1;
    const off = s.subscribe((v) => (seen = v.n));
    s.update((v) => (v.n = 3));
    expect(seen).toBe(3);
    off();
    s.update((v) => (v.n = 5));
    expect(seen).toBe(3);
    expect(s.get().n).toBe(5);
  });

  it('emitter delivers typed events', () => {
    const e = createEmitter<{ ping: number }>();
    const got: number[] = [];
    const off = e.on('ping', (n) => got.push(n));
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(got).toEqual([1]);
  });

  it('the UI starts on the start screen in 3D with labels, sound and (wide) mentor open', () => {
    const s = createSimStore().get();
    expect(s.phase).toBe('start');
    expect(s.view).toBe('3d');
    expect(s.labels && s.sound && s.mentorOpen).toBe(true);
    expect(createSimStore(true).get().mentorOpen).toBe(false);
  });

  it('suppresses repeated messages within 4 s and keeps the last 4', () => {
    let list = pushMessage([], { text: 'a', level: 'info', time: 0 });
    list = pushMessage(list, { text: 'a', level: 'info', time: 2 });
    expect(list.length).toBe(1);
    list = pushMessage(list, { text: 'a', level: 'info', time: 5 });
    expect(list.length).toBe(2);
    for (const t of ['b', 'c', 'd', 'e']) list = pushMessage(list, { text: t, level: 'ok', time: 6 });
    expect(list.map((m) => m.text)).toEqual(['b', 'c', 'd', 'e']);
  });
});
