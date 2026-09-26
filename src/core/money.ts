/**
 * Amounts are always whole numbers of the currency's smallest unit (cents for
 * US dollars), held as bigint in the pooling maths and as plain numbers in
 * storage. MAX_AMOUNT keeps every stored amount exact as a JavaScript number.
 */

export interface Currency {
  /** ISO 4217 code, such as USD. */
  readonly code: string;
  /** How many digits the smallest unit has after the decimal point. */
  readonly digits: number;
  readonly locale: string;
  readonly formatter: Intl.NumberFormat;
}

export const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

export function makeCurrency(code: string, locale: string): Currency {
  const upper = code.trim().toUpperCase();
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: upper,
    currencyDisplay: 'narrowSymbol',
    trailingZeroDisplay: 'stripIfInteger',
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return { code: upper, digits, locale, formatter };
}

/** Writes an amount in the smallest unit as a plain decimal string, such as "1234.50". */
export function toDecimalString(minor: bigint, currency: Currency): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const sign = negative ? '-' : '';
  if (currency.digits === 0) return `${sign}${abs}`;
  const scale = 10n ** BigInt(currency.digits);
  const fraction = (abs % scale).toString().padStart(currency.digits, '0');
  return `${sign}${abs / scale}.${fraction}`;
}

export function formatAmount(minor: bigint | number, currency: Currency): string {
  const decimal = toDecimalString(BigInt(minor), currency) as `${number}`;
  return currency.formatter.format(decimal);
}

export type ParseResult = { ok: true; amount: bigint } | { ok: false; reason: string };

const UNREADABLE: ParseResult = { ok: false, reason: 'That amount is not written in a way we can read.' };

/** Checks digit groups such as ["1", "250", "000"] and joins them. */
function joinGroups(groups: readonly string[]): string | null {
  const [first, ...rest] = groups;
  if (!first || !/^[1-9]\d{0,2}$/.test(first)) return null;
  if (rest.some((group) => !/^\d{3}$/.test(group))) return null;
  return groups.join('');
}

/**
 * Reads an amount someone typed, such as "20", "20.5", "1,250.00" or
 * "1.250,00". When both "." and "," appear, the later one is the decimal
 * point. A single separator followed by exactly three digits, as in "1.234",
 * could mean either, so we ask rather than guess: with money, a wrong guess
 * could be a thousand times out.
 */
export function parseAmount(input: string, currency: Currency): ParseResult {
  let text = input.normalize('NFKC').replace(/[\s_'  ]/g, '');
  // Allow a currency symbol or code before or after the number.
  text = text.replace(/^[^\d.,-]+/, '').replace(/[^\d.,]+$/, '');

  if (text === '') return { ok: false, reason: 'Enter an amount.' };
  if (text.startsWith('-')) return { ok: false, reason: 'The amount must be more than zero.' };
  if (!/^[\d.,]+$/.test(text)) return { ok: false, reason: 'Use only digits and a decimal point.' };

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let whole: string | null;
  let fraction = '';

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalAt = Math.max(lastDot, lastComma);
    const groupChar = decimalAt === lastDot ? ',' : '.';
    whole = joinGroups(text.slice(0, decimalAt).split(groupChar));
    fraction = text.slice(decimalAt + 1);
  } else if (lastDot !== -1 || lastComma !== -1) {
    const parts = text.split(lastDot !== -1 ? '.' : ',');
    if (parts.length > 2) {
      whole = joinGroups(parts);
    } else {
      const [head = '', tail = ''] = parts;
      if (tail.length === 3 && currency.digits === 0) {
        // Currencies with no decimal places can only mean thousands here.
        whole = joinGroups(parts);
      } else if (tail.length === 3 && currency.digits < 3 && /^[1-9]\d{0,2}$/.test(head)) {
        return {
          ok: false,
          reason: 'Is that a thousands separator or a decimal point? Please write it like 1234 or 1234.50.',
        };
      } else {
        whole = head;
        fraction = tail;
      }
    }
  } else {
    whole = text;
  }

  if (whole === null) return UNREADABLE;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (whole === '' && fraction === '')) {
    return UNREADABLE;
  }
  if (fraction.length > currency.digits) {
    return {
      ok: false,
      reason:
        currency.digits === 0
          ? `${currency.code} amounts have no decimal places.`
          : `Use at most ${currency.digits} digits after the decimal point.`,
    };
  }

  const scale = 10n ** BigInt(currency.digits);
  const amount = BigInt(whole || '0') * scale + BigInt((fraction || '0').padEnd(currency.digits, '0') || '0');
  if (amount <= 0n) return { ok: false, reason: 'The amount must be more than zero.' };
  if (amount > MAX_AMOUNT) return { ok: false, reason: 'That amount is too large.' };
  return { ok: true, amount };
}

/** Converts a bigint amount to a number for storage, refusing anything that would lose precision. */
export function toStored(amount: bigint): number {
  if (amount < 0n || amount > MAX_AMOUNT) {
    throw new RangeError(`Amount out of range: ${amount}`);
  }
  return Number(amount);
}
