import type { Context } from '../services/context.js';
import type { Member } from '../services/records.js';

export interface Flash {
  readonly kind: 'ok' | 'error';
  readonly text: string;
}

export type Form = Record<string, string | string[]>;

export interface AppEnv {
  Variables: {
    ctx: Context;
    member: Member | undefined;
    csrf: string;
    flash: Flash | undefined;
    form: Form;
  };
}
