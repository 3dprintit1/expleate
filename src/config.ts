import { DEFAULT_MAX_SHARE_PPM } from './core/costs.js';
import { makeCurrency, type Currency } from './core/money.js';

export interface Config {
  readonly siteName: string;
  /** The public address, such as https://expleat.ing, used for absolute links. */
  readonly siteUrl: string;
  /** Where the source code lives. The AGPL asks us to offer it to everyone who uses the site. */
  readonly sourceUrl: string;
  readonly currency: Currency;
  /**
   * While Expleate is a prototype, people add pretend resources with a button.
   * Switch this off once real money is connected.
   */
  readonly demoResources: boolean;
  /** How many people are drawn for a charter circle. Kept odd. */
  readonly circleSize: number;
  /** How many people must flag a project before a circle is drawn. */
  readonly flagThreshold: number;
  /** How long a circle has to decide. */
  readonly reviewDays: number;
  readonly sessionDays: number;
  /** Handles of the people who pay the running bills and record them publicly. */
  readonly caretakers: ReadonlySet<string>;
  /** The most of all pools that one running-cost share may take, in parts per million. */
  readonly maxCostSharePpm: number;
  /** The Claude model the charter reader asks for. */
  readonly readerModel: string;
  /** The most readings the charter reader makes in a day, across everyone, which caps what it costs. */
  readonly readerDailyReads: number;
  /** The most readings one person's writing can take up in a day. */
  readonly readerReadsPerPerson: number;
  /** How long someone must have been a member before they can flag projects or sit in a circle. */
  readonly standingDays: number;
  /** How many live projects one person can have suggested at once. */
  readonly maxLiveProjects: number;
}

export type Env = Readonly<Record<string, string | undefined>>;

function whole(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected a whole number from ${min} to ${max}, got "${value}"`);
  }
  return parsed;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function configFromEnv(env: Env): Config {
  const caretakers = (env.CARETAKERS ?? '')
    .split(',')
    .map((handle) => handle.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);

  return {
    siteName: env.SITE_NAME?.trim() || 'Expleate',
    siteUrl: (env.SITE_URL?.trim() || 'http://localhost:8787').replace(/\/+$/, ''),
    sourceUrl: env.SOURCE_URL?.trim() || 'https://github.com/3dprintit1/expleate',
    currency: makeCurrency(env.CURRENCY?.trim() || 'USD', env.LOCALE?.trim() || 'en-GB'),
    demoResources: flag(env.DEMO_RESOURCES, true),
    circleSize: whole(env.CIRCLE_SIZE, 5, 1, 99),
    flagThreshold: whole(env.FLAG_THRESHOLD, 3, 1, 1000),
    reviewDays: whole(env.REVIEW_DAYS, 7, 1, 90),
    sessionDays: whole(env.SESSION_DAYS, 30, 1, 365),
    caretakers: new Set(caretakers),
    maxCostSharePpm: whole(env.MAX_COST_SHARE_PPM, DEFAULT_MAX_SHARE_PPM, 0, 1_000_000),
    readerModel: env.READER_MODEL?.trim() || 'claude-opus-5',
    readerDailyReads: whole(env.READER_DAILY_READS, 200, 0, 1_000_000),
    readerReadsPerPerson: whole(env.READER_READS_PER_PERSON, 20, 0, 10_000),
    standingDays: whole(env.STANDING_DAYS, 7, 0, 365),
    maxLiveProjects: whole(env.MAX_LIVE_PROJECTS, 3, 1, 1000),
  };
}
