import { MESSAGES } from '../config/anatomy';

export type MessageLevel = 'info' | 'ok' | 'warn' | 'danger';

export interface FeedbackMessage {
  readonly text: string;
  readonly level: MessageLevel;
  readonly time: number;
}

/**
 * Append a message unless the same text was shown within repeatSuppressS; keeps the newest
 * maxShown. Returns the same array when suppressed so callers can detect it.
 */
export function pushMessage(
  list: readonly FeedbackMessage[],
  msg: FeedbackMessage,
): readonly FeedbackMessage[] {
  const recent = list.some((m) => m.text === msg.text && msg.time - m.time < MESSAGES.repeatSuppressS);
  if (recent) return list;
  return [...list, msg].slice(-MESSAGES.maxShown);
}
