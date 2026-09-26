import type { Config } from '../config.js';
import type { Sql } from '../store/sql.js';

/** Everything a service needs. Tests pass their own clock and randomness. */
export interface Context {
  readonly sql: Sql;
  readonly config: Config;
  now(): Date;
  randomInt(maxExclusive: number): number;
}

/**
 * Something the person can fix or should know about, such as a handle that is
 * taken or an amount larger than their portion. The message is shown to them
 * as written, so it should be plain and kind.
 */
export class Problem extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409;
  /** The form field the problem is about, if any. */
  readonly field: string | undefined;

  constructor(message: string, status: 400 | 401 | 403 | 404 | 409 = 400, field?: string) {
    super(message);
    this.name = 'Problem';
    this.status = status;
    this.field = field;
  }
}

export function nowIso(ctx: Context): string {
  return ctx.now().toISOString();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

interface TextRules {
  readonly label: string;
  readonly field: string;
  readonly min?: number;
  readonly max: number;
}

// Control characters other than tab and newline have no place in what people
// write, and nor do characters that are invisible and could hide words, such
// as soft hyphens, zero-width spaces and direction overrides. Joiners that
// some scripts and emoji need are kept.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u200b\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Tidies a piece of writing and checks its length. Line breaks are kept. */
export function cleanText(raw: unknown, rules: TextRules): string {
  const text = String(raw ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const min = rules.min ?? 1;
  if ([...text].length < min) {
    throw new Problem(
      min === 1 ? `${rules.label} is needed.` : `${rules.label} needs at least ${min} characters.`,
      400,
      rules.field,
    );
  }
  if ([...text].length > rules.max) {
    throw new Problem(`${rules.label} can be at most ${rules.max} characters.`, 400, rules.field);
  }
  return text;
}

/** Like cleanText, for things that belong on one line, such as a title. */
export function cleanLine(raw: unknown, rules: TextRules): string {
  return cleanText(String(raw ?? '').replace(/\s+/g, ' '), rules);
}
