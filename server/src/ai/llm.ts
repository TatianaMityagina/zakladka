import { anthropicConfigured, anthropicKeyProblem, completeAnthropic } from './anthropic.js';
import { completeOpenRouter, openrouterConfigured } from './openrouter.js';

export const isMock = () => process.env.LLM_MODE === 'mock';

export type Provider = 'anthropic' | 'openrouter';

/**
 * LLM_PROVIDER=anthropic | openrouter. Не задан — берём тот, для которого есть ключ
 * (если есть оба — OpenRouter, как было до появления переключателя).
 */
export function provider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === 'anthropic' || explicit === 'openrouter') return explicit;
  return !openrouterConfigured() && anthropicConfigured() ? 'anthropic' : 'openrouter';
}

/** Что сейчас работает — для подписи в интерфейсе */
export function llmStatus() {
  const p = provider();
  const models =
    p === 'anthropic'
      ? { main: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', digest: process.env.ANTHROPIC_DIGEST_MODEL || 'claude-haiku-5-5' }
      : {
          main: process.env.LLM_MODEL || 'anthropic/claude-sonnet-5.5',
          digest: process.env.DIGEST_MODEL || process.env.LLM_MODEL || 'anthropic/claude-sonnet-5.5',
        };
  const problem = isMock() ? undefined : p === 'anthropic' ? anthropicKeyProblem() : openrouterConfigured() ? undefined : 'не задан OPENROUTER_API_KEY в .env';
  return { provider: p, mock: isMock(), configured: !problem, problem, ...models };
}

export function assertLlmConfigured() {
  if (isMock()) return;
  const fail = (m: string) => {
    throw Object.assign(new Error(m), { status: 400 });
  };
  if (provider() === 'anthropic') {
    const problem = anthropicKeyProblem();
    if (problem) fail(`Anthropic: ${problem}`);
  } else if (!openrouterConfigured()) {
    fail('Не задан OPENROUTER_API_KEY в .env (или LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY, или LLM_MODE=mock)');
  }
}

export interface CompleteOptions {
  /** 'main' — ответы и пересказы, 'digest' — массовый разбор глав (можно дешевле) */
  model?: 'main' | 'digest';
  /** Лимит ответа для OpenRouter (там он резервирует баланс). Anthropic использует ANTHROPIC_MAX_TOKENS */
  maxTokens?: number;
}

export function complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
  return provider() === 'anthropic' ? completeAnthropic(system, user, opts) : completeOpenRouter(system, user, opts);
}

/** Модели иногда оборачивают JSON в ```json … ``` или добавляют текст — берём первый объект */
export function parseJsonObject<T>(raw: string): T {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`LLM вернула не JSON: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export async function completeJson<T>(system: string, user: string, opts?: CompleteOptions): Promise<T> {
  return parseJsonObject<T>(await complete(system, user, opts));
}
