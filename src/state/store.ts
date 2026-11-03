import type { FeedbackMessage } from './messages';

export type Listener<T> = (value: T) => void;

/** Tiny typed event emitter. */
export function createEmitter<E extends Record<string, unknown>>() {
  const map = new Map<keyof E, Set<Listener<never>>>();
  return {
    on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn as Listener<never>);
      return () => set!.delete(fn as Listener<never>);
    },
    emit<K extends keyof E>(type: K, payload: E[K]): void {
      map.get(type)?.forEach((fn) => (fn as Listener<E[K]>)(payload));
    },
  };
}

/** Single mutable state object; `update` mutates then notifies subscribers once. */
export function createStore<S>(initial: S) {
  const state = initial;
  const listeners = new Set<Listener<S>>();
  return {
    get: (): S => state,
    update(fn: (s: S) => void): void {
      fn(state);
      listeners.forEach((l) => l(state));
    },
    subscribe(fn: Listener<S>): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Phase = 'start' | 'running' | 'paused' | 'debrief';

/**
 * UI state of the app. The simulation itself (devices, beam, patient, progress) lives in
 * the pure Session object; this holds what the interface shows and toggles.
 */
export interface SimState {
  phase: Phase;
  demo: boolean;
  view: '3d' | 'fluoro';
  labels: boolean;
  follow: boolean;
  mentorOpen: boolean;
  sound: boolean;
  help: boolean;
  messages: readonly FeedbackMessage[];
  /** The debrief opened automatically once (after stage 6). */
  autoDebriefShown: boolean;
  /** Exam mode: no mentor or hints, timed. */
  exam: boolean;
  /** Watching a recorded attempt. */
  replay: boolean;
}

export function createInitialState(narrow = false): SimState {
  return {
    phase: 'start',
    demo: false,
    view: '3d',
    labels: true,
    follow: false,
    mentorOpen: !narrow,
    sound: true,
    help: false,
    messages: [],
    autoDebriefShown: false,
    exam: false,
    replay: false,
  };
}

export type SimEvents = {
  stageComplete: { stage: number; time: number };
  caseComplete: { time: number };
};

export function createSimStore(narrow = false) {
  return { ...createStore(createInitialState(narrow)), events: createEmitter<SimEvents>() };
}
