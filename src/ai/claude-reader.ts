/**
 * The charter reader, run on Claude through Anthropic's official SDK.
 *
 * Each reading is one request. The instructions are the same every time and
 * are cached, so only the text being read is new. The answer comes back as
 * JSON in a fixed shape, which src/core/reader.ts checks before anything
 * trusts it. If Claude's safety checks decline a request, Anthropic re-runs
 * it on a fallback model on its side; if every model declines, the reading
 * asks a person to look.
 *
 * A reading that fails for any other reason, such as a timeout, resolves to
 * null and the site carries on without it. Projects that could not be read
 * are read later by the daily round.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  type CharterReader,
  READER_INSTRUCTIONS,
  READING_SCHEMA,
  type ReaderSubject,
  type Reading,
  declinedReading,
  parseReading,
  readerMessage,
  subjectTexts,
} from '../core/reader.js';

export interface ClaudeReaderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Another address for the API, such as a Cloudflare AI Gateway that logs every request and its cost. */
  readonly baseURL?: string | undefined;
  /** How long one attempt may take. Someone is usually waiting for the answer. */
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Stands in for the network in tests. */
  readonly fetch?: typeof fetch;
}

/** Says what went wrong without repeating anything anyone wrote. */
function describe(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `${error.name}${error.status ? ` (${error.status})` : ''}`;
  if (error instanceof Error) return error.name;
  return 'an unknown error';
}

export function claudeReader(options: ClaudeReaderOptions): CharterReader {
  let client: Anthropic | undefined;
  // Made on first use: Cloudflare allows some work only while handling a request.
  const connect = () =>
    (client ??= new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: options.maxRetries ?? 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }));

  return {
    model: options.model,
    async read(subject: ReaderSubject): Promise<Reading | null> {
      try {
        const response = await connect().beta.messages.create({
          model: options.model,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: READING_SCHEMA } },
          system: [{ type: 'text', text: READER_INSTRUCTIONS, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: readerMessage(subject) }],
        });
        if (response.stop_reason === 'refusal') return declinedReading(response.model);
        const text = response.content.find((block) => block.type === 'text');
        if (!text || response.stop_reason === 'max_tokens') {
          console.error(`The charter reader gave no complete answer (stop reason: ${response.stop_reason}).`);
          return null;
        }
        return parseReading(JSON.parse(text.text), subjectTexts(subject), response.model);
      } catch (error) {
        console.error(`The charter reader could not read: ${describe(error)}.`);
        return null;
      }
    },
  };
}
