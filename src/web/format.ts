import type { Config } from '../config.js';
import { formatAmount, parseAmount } from '../core/money.js';
import { Problem } from '../services/context.js';
import type { Form } from './env.js';

export function money(config: Config, minor: bigint | number): string {
  return formatAmount(minor, config.currency);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

export function day(config: Config, iso: string): string {
  let format = dateFormats.get(config.currency.locale);
  if (!format) {
    format = new Intl.DateTimeFormat(config.currency.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    dateFormats.set(config.currency.locale, format);
  }
  return format.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}

export function percent(config: Config, fraction: number): string {
  return new Intl.NumberFormat(config.currency.locale, {
    style: 'percent',
    maximumFractionDigits: fraction > 0 && fraction < 0.01 ? 2 : 1,
  }).format(fraction);
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
}

/** A single value from a submitted form. */
export function field(form: Form, name: string): string {
  const value = form[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** Every value of a field that can repeat, such as a set of checkboxes. */
export function fields(form: Form, name: string): string[] {
  const value = form[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function checked(form: Form, name: string): boolean {
  return field(form, name) !== '';
}

/** Reads an amount from a form, or explains what is wrong with it. */
export function amountField(config: Config, form: Form, name = 'amount'): bigint {
  const result = parseAmount(field(form, name), config.currency);
  if (!result.ok) throw new Problem(result.reason, 400, name);
  return result.amount;
}

/** Only ever redirect to a path on this site. */
export function safeNext(value: string | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
