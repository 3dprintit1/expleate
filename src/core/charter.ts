/**
 * The charter's rules, and the automatic check that runs when someone
 * suggests a project.
 *
 * The check is deliberately humble. It looks for words that often mean a
 * project has strayed into politics, war, financial gain or charity, and when
 * it finds any it asks the proposer to explain. A project with an explanation
 * goes to a charter circle, a handful of people drawn at random, who decide.
 * Words alone never reject anything. The full prose of the charter lives in
 * CHARTER.md, and every rule title below must appear there (a test checks).
 *
 * The word lists are English only for now. Translations are very welcome.
 */

export const SPIRITS = ['creativity', 'adventure', 'joy'] as const;
export type Spirit = (typeof SPIRITS)[number];

export function isSpirit(value: string): value is Spirit {
  return (SPIRITS as readonly string[]).includes(value);
}

export type RuleId = 'spirit' | 'politics' | 'war' | 'gain' | 'charity' | 'harm';

export interface Rule {
  readonly id: RuleId;
  readonly title: string;
  /** What the rule is about, in a few words, such as "financial gain". */
  readonly topic: string;
  readonly summary: string;
  /** Words and phrases that suggest a project may break this rule. */
  readonly watch: readonly string[];
  /** Everyday phrases that contain a watched word but are fine. */
  readonly except: readonly string[];
}

export const RULES: readonly Rule[] = [
  {
    id: 'spirit',
    title: 'Creativity, adventure or joy',
    topic: 'something other than creativity, adventure or joy',
    summary:
      'Every project is something people can share in: making things, exploring, playing, celebrating.',
    watch: [],
    except: [],
  },
  {
    id: 'politics',
    title: 'No politics',
    topic: 'politics',
    summary:
      'Projects have nothing to do with politics. No parties, elections, campaigns, lobbying, protests or government.',
    watch: [
      'politic*',
      'election*',
      'electoral',
      'referendum*',
      'referenda',
      'parliament*',
      'congressional',
      'congressman',
      'congresswoman',
      'senate',
      'senator*',
      'prime minister',
      'cabinet minister',
      'presidential',
      'candidacy',
      'lobbying',
      'lobbyist*',
      'legislat*',
      'protest',
      'protests',
      'protester*',
      'protestor*',
      'protesting',
      'petition*',
      'activism',
      'activist*',
      'propaganda',
      'partisan*',
      'left-wing',
      'right-wing',
      'far-left',
      'far-right',
      'labour party',
      'conservative party',
      'tory',
      'tories',
      'democrat',
      'democrats',
      'republican',
      'republicans',
      'socialism',
      'socialist*',
      'communism',
      'communist*',
      'capitalism',
      'capitalist*',
      'fascism',
      'fascist*',
      'nazi*',
      'marxism',
      'marxist*',
      'nationalism',
      'nationalist*',
      'ideolog*',
      'dictator*',
      'human rights',
      'anti-government',
      'government policy',
      'campaigning',
      'campaign for',
      'campaign against',
      'voters',
      'vote against',
      'rally against',
      'march against',
      'protest march',
    ],
    except: ['no politics', 'not political'],
  },
  {
    id: 'war',
    title: 'No war',
    topic: 'war or the military',
    summary:
      'Projects have nothing to do with war or the military. That includes help for people caught up in a war, however good the cause.',
    watch: [
      'war',
      'wars',
      'warfare',
      'wartime',
      'warzone',
      'war zone',
      'warlord*',
      'warship*',
      'warplane*',
      'military',
      'militar*',
      'militia*',
      'army',
      'armies',
      'armed forces',
      'air force',
      'soldier*',
      'weapon*',
      'firearm*',
      'rifle',
      'rifles',
      'ammunition',
      'ammo',
      'missile*',
      'bombing',
      'bombings',
      'airstrike*',
      'air strike*',
      'drone strike*',
      'grenade*',
      'landmine*',
      'land mine*',
      'battlefield*',
      'invasion',
      'ceasefire',
      'armistice',
      'armed conflict*',
      'conflict zone*',
      'terrorism',
      'terrorist*',
      'genocide*',
      'massacre*',
      'ethnic cleansing',
      'mercenar*',
      'conscription',
      'arms trade',
      'arms dealer*',
      'arms race',
      'defence industry',
      'defense industry',
      'defence contractor*',
      'defense contractor*',
      'troops',
      'gun',
      'guns',
      'handgun*',
      'shotgun*',
      'bomb',
      'bombs',
      'bombed',
    ],
    except: [
      'tug of war',
      'swiss army',
      'soldier on',
      'soldiered on',
      'soldiering on',
      'an army of',
      'secret weapon',
      'water balloon war*',
      'water war*',
      'pillow war*',
      'snowball war*',
      'war paint',
      'glue gun*',
      'water gun*',
      'nerf gun*',
      'staple gun*',
      'heat gun*',
      'bubble gun*',
      'bath bomb*',
      'seed bomb*',
      'glitter bomb*',
      'yarn bomb*',
      'photo bomb*',
      'no war',
    ],
  },
  {
    id: 'gain',
    title: 'No financial gain',
    topic: 'financial gain',
    summary:
      'Nobody profits. No selling, no investing, no businesses, no wages or fees paid from a pool, no money prizes.',
    watch: [
      'profit',
      'profits',
      'profitable',
      'profitability',
      'profiting',
      'profited',
      'profiteer*',
      'revenue*',
      'income',
      'invest',
      'investing',
      'investment*',
      'investor*',
      'dividend*',
      'shareholder*',
      'equity stake*',
      'private equity',
      'stock market*',
      'stock exchange*',
      'return on investment',
      'financial return*',
      'financial gain',
      'crypto',
      'cryptocurrenc*',
      'bitcoin*',
      'ethereum',
      'blockchain',
      'nft',
      'nfts',
      'token sale*',
      'memecoin*',
      'sell',
      'sells',
      'selling',
      'for sale',
      'sales',
      'merchandise',
      'merch',
      'monetis*',
      'monetiz*',
      'business plan*',
      'business model*',
      'small business*',
      'my business',
      'our business',
      'new business',
      'salary',
      'salaries',
      'wage',
      'wages',
      'paid position*',
      'pay myself',
      'pay ourselves',
      'make money',
      'making money',
      'earn money',
      'earning money',
      'earn a living',
      'get rich',
      'passive income',
      'side hustle',
      'debt',
      'debts',
      'bank loan*',
      'interest rate*',
      'mortgage*',
      'cash prize*',
      'prize money',
      'prize fund*',
      'gambling',
      'betting',
      'casino*',
      'lottery',
      'lotteries',
      'sponsorship*',
      'sponsored by',
      'advertiser*',
      'advertising revenue',
      'ad revenue',
      'paid advertising',
      'brand deal*',
      'affiliate link*',
      'affiliate program*',
      'franchise*',
      'real estate',
      'property development',
      'day trading',
      'forex',
      'pyramid scheme*',
      'ponzi',
      'entry fee*',
      'admission fee*',
      'ticket price*',
      'charge admission',
      'startup',
      'startups',
    ],
    except: [
      'non-profit',
      'nonprofit',
      'not-for-profit',
      'not for profit',
      'no profit',
      'no entry fee',
      'nobody profits',
      'nobody profit*',
      'no profits',
      'no wage*',
      'no salar*',
      'nothing is for sale',
      'nothing for sale',
      'not for sale',
      'no ticket price*',
      'no selling',
      'not selling',
      'never sold',
      'no sales',
      'startup cost*',
    ],
  },
  {
    id: 'charity',
    title: 'Not charity',
    topic: 'charity',
    summary:
      'Expleate is not for charity or fundraising. Pools are for joyful things people want to share in, never for relief, aid or appeals.',
    watch: [
      'charity',
      'charities',
      'charitable',
      'donate',
      'donating',
      'donation*',
      'donor*',
      'fundrais*',
      'raise money',
      'raising money',
      'raise funds',
      'raising funds',
      'humanitarian*',
      'disaster relief',
      'famine relief',
      'relief effort*',
      'relief fund*',
      'aid worker*',
      'foreign aid',
      'victims',
      'those in need',
      'people in need',
      'families in need',
      'children in need',
      'the needy',
      'less fortunate',
      'underprivileged',
      'poverty',
      'good cause*',
      'worthy cause*',
      'food bank*',
      'soup kitchen*',
      'sponsored walk*',
      'sponsored run*',
      'sponsored swim*',
      'sponsor a child',
      'medical bills',
      'medical expenses',
      'hospital bills',
      'ngo',
      'ngos',
    ],
    except: [
      'charity shop',
      'charity shops',
      'murder mystery victim*',
      'fashion victim*',
      'not a charity',
      'not charity',
      'no donation*',
      'no fundraising',
    ],
  },
  {
    id: 'harm',
    title: 'Do no harm',
    topic: 'harm to people, animals or places',
    summary: 'Projects must not hurt people, animals or places, and must be lawful where they happen.',
    watch: [
      'illegal',
      'illegally',
      'unlawful',
      'vandalis*',
      'vandaliz*',
      'trespass*',
      'hate speech',
      'hate group*',
      'harass*',
      'cruelty',
      'trophy hunt*',
      'fox hunt*',
    ],
    except: ['cruelty-free', 'cruelty free'],
  },
];

const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function ruleById(id: string): Rule | undefined {
  return RULES_BY_ID.get(id as RuleId);
}

export function isRuleId(value: string): value is RuleId {
  return RULES_BY_ID.has(value as RuleId);
}

export interface Concern {
  readonly rule: RuleId;
  /** The words that matched, as the proposer wrote them. */
  readonly term: string;
  /** Which part of the proposal they appeared in. */
  readonly field: string;
  /** A little of the surrounding text, so people can see the context. */
  readonly excerpt: string;
}

const LETTER = '[\\p{L}\\p{M}\\p{N}]';
const SEPARATOR = '[\\s\\-\\u2010\\u2011\\u2013]+';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns a watch phrase into a regular expression fragment. A trailing * means
 * "and any letters after", and a space or hyphen matches any run of spaces or
 * hyphens, so "war zone" also finds "war-zone".
 */
function phrasePattern(phrase: string): string {
  const open = phrase.endsWith('*');
  const words = (open ? phrase.slice(0, -1) : phrase).split(/[\s-]+/).map(escapeRegExp);
  return words.join(SEPARATOR) + (open ? `${LETTER}*` : '');
}

function wholeWords(phrases: readonly string[]): RegExp | null {
  if (phrases.length === 0) return null;
  // Longest first, so "war zone" is reported as itself rather than as "war".
  const alternatives = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map(phrasePattern)
    .join('|');
  return new RegExp(`(?<!${LETTER})(?:${alternatives})(?!${LETTER})`, 'giu');
}

interface CompiledRule {
  readonly id: RuleId;
  readonly watch: RegExp;
  readonly except: RegExp | null;
}

const COMPILED: readonly CompiledRule[] = RULES.flatMap((rule) => {
  const watch = wholeWords(rule.watch);
  return watch ? [{ id: rule.id, watch, except: wholeWords(rule.except) }] : [];
});

function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 50);
  const to = Math.min(text.length, end + 50);
  const before = from > 0 ? '…' : '';
  const after = to < text.length ? '…' : '';
  return `${before}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${after}`;
}

/** Characters that take up no space, which could hide a word from the check. */
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0]/g;

/** Cyrillic and Greek letters that look like Latin ones, read as the Latin letter. */
const LOOK_ALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  ѕ: 's', і: 'i', ї: 'i', ј: 'j', ԁ: 'd', ӏ: 'l', ԛ: 'q', ԝ: 'w', ү: 'y',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  Ѕ: 'S', І: 'I', Ј: 'J',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};
const LOOK_ALIKE = new RegExp(`[${Object.keys(LOOK_ALIKES).join('')}]`, 'g');

/** The text as the check reads it: no invisible characters, and look-alike letters read as Latin. */
export function forScreening(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(LOOK_ALIKE, (letter) => LOOK_ALIKES[letter] ?? letter);
}

/**
 * Looks through the named fields of a proposal and returns anything that
 * might break the charter. Each rule and wording is reported once.
 */
export function screen(fields: Readonly<Record<string, string>>): Concern[] {
  const concerns: Concern[] = [];
  const seen = new Set<string>();

  for (const [field, raw] of Object.entries(fields)) {
    const text = forScreening(raw);
    for (const rule of COMPILED) {
      const excepted: Array<[number, number]> = [];
      if (rule.except) {
        for (const match of text.matchAll(rule.except)) {
          excepted.push([match.index, match.index + match[0].length]);
        }
      }
      for (const match of text.matchAll(rule.watch)) {
        const start = match.index;
        const end = start + match[0].length;
        if (excepted.some(([a, b]) => start >= a && end <= b)) continue;
        const key = `${rule.id}:${match[0].toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        concerns.push({ rule: rule.id, term: match[0], field, excerpt: excerptAround(text, start, end) });
      }
    }
  }
  return concerns;
}
