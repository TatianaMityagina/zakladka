import OpenAI from 'openai';
import type { CompleteOptions } from './llm.js';

/** OpenRouter (OpenAI-совместимый API): Claude и другие модели, доступ из РФ без VPN */

let client: OpenAI | undefined;

export const openrouterConfigured = () => Boolean(process.env.OPENROUTER_API_KEY);

export async function completeOpenRouter(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
  client ??= new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: { 'X-Title': 'Zakladka' },
  });
  const main = process.env.LLM_MODEL || 'anthropic/claude-sonnet-5.5';
  const model = opts.model === 'digest' ? process.env.DIGEST_MODEL || main : main;
  try {
    return await request(model, system, user, opts);
  } catch (e) {
    throw explain(e, model);
  }
}

const withStatus = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Ошибки OpenRouter — в понятный текст: что случилось и что сделать */
function explain(e: unknown, model: string): unknown {
  if (e instanceof OpenAI.APIConnectionError) return withStatus('Нет связи с openrouter.ai — проверьте интернет', 503);
  if (!(e instanceof OpenAI.APIError)) return e;
  switch (e.status) {
    case 401:
      return withStatus('OpenRouter: неверный OPENROUTER_API_KEY', 401);
    case 402:
      return withStatus(
        'OpenRouter: закончились кредиты или лимит ключа. Пополните баланс / поднимите лимит ключа на openrouter.ai, либо укажите бесплатную модель (…:free) в LLM_MODEL и DIGEST_MODEL',
        402,
      );
    case 403:
      return withStatus('OpenRouter: запрос отклонён политикой доступа (403) — проверьте ключ и модель на openrouter.ai', 403);
    case 404:
      return withStatus(`OpenRouter: модель «${model}» не найдена — проверьте LLM_MODEL / DIGEST_MODEL`, 400);
    case 429:
      return withStatus('OpenRouter: слишком много запросов (у бесплатных моделей строгие лимиты) — подождите минуту', 429);
    default:
      return withStatus(`OpenRouter ${e.status}: ${e.message}`, 502);
  }
}

async function request(model: string, system: string, user: string, opts: CompleteOptions): Promise<string> {
  const res = await client!.chat.completions.create({
    model,
    temperature: 0.2,
    // Без лимита OpenRouter резервирует максимум модели и отклоняет запрос с 402 при небольшом балансе
    max_tokens: opts.maxTokens ?? (Number(process.env.LLM_MAX_TOKENS) || 1500),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const choice = res.choices[0];
  // «Думающие» модели тратят лимит на рассуждения — JSON обрывается на полуслове
  if (choice?.finish_reason === 'length') {
    throw withStatus('Ответ модели не поместился в лимит — увеличьте LLM_MAX_TOKENS или выберите модель без рассуждений', 502);
  }
  return choice?.message?.content ?? '';
}
