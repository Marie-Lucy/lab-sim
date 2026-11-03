import type { CaseInstance } from '../cases/cases';
import type { Session } from '../procedure/session';
import type { createSimStore } from '../state/store';
import type { ToolId } from '../tools/tools';
import type { Input } from './input';

export type SimStore = ReturnType<typeof createSimStore>;

export interface Actions {
  selectTool(t: ToolId): void;
  inject(): void;
  heparin(): void;
  /** Leave the lesion untreated after physiology. */
  defer(): void;
  /** IVUS or OCT pullback over the wire. */
  pullback(modality: 'ivus' | 'oct'): void;
  setSize(diameter: number, length: number): void;
  /** Semi-compliant (false) or non-compliant (true) balloon. */
  setBalloonType(nc: boolean): void;
  toggleView(): void;
  toggleSound(): void;
  togglePause(): void;
  toggleHelp(): void;
  toggleMentor(): void;
  nextPreset(): void;
  endCase(): void;
  keepExploring(): void;
  newCase(): void;
  retryCase(): void;
  watchReplay(): void;
  exportReplay(): void;
}

export interface UiContext {
  readonly session: Session;
  readonly store: SimStore;
  readonly input: Input;
  readonly actions: Actions;
  readonly caseInstance: CaseInstance;
}
