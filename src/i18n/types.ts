import type en from './en';

export type Key = keyof typeof en;
/** Every language must provide exactly the English keys. */
export type Dictionary = Record<Key, string>;
