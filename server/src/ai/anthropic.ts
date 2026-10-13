import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOptions } from './llm.js';

/**
 * Прямой доступ к Claude через официальный SDK (LLM_PROVIDER=anthropic).
 * Ключ — console.anthropic.com → API Keys (это не подписка claude.ai: баланс отдельный).
 */

/** Основная модель — пересказ, ответы, тесты; дешёвая — массовый разбор глав */
const MAIN_MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const DIGEST_MODEL = () => process.env.ANTHROPIC_DIGEST_MODEL || 'claude-haiku-5-5';

/**
 * У текущих моделей мышление включено всегда и тратит тот же max_tokens, что и ответ.
 * Маленький лимит (как для OpenRouter) обрежет JSON на полуслове — даём запас.
 */
const MAX_TOKENS = () => Number(process.env.ANTHROPIC_MAX_TOKENS) || 16000;

/** Глубина рассуждений: low | medium | high. У Opus 5.5 и Haiku 5.5 по умолчанию medium — задаём явно */
const EFFORT = () => (process.env.ANTHROPIC_EFFORT || 'medium') as 'low' | 'medium' | 'high';

let client: Anthropic | undefined;

export const anthropicConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Частая ошибка — вставить ID ключа из консоли вместо самого секрета.
 * Секрет показывается один раз при создании и начинается с sk-ant-.
 */
export function anthropicKeyProblem(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return process.env.ANTHROPIC_AUTH_TOKEN ? undefined : 'не задан ANTHROPIC_API_KEY в .env';
  if (!key.startsWith('sk-ant-')) {
    return 'ANTHROPIC_API_KEY должен начинаться с «sk-ant-». Похоже, скопирован ID ключа, а не сам ключ: создайте новый в console.anthropic.com → API Keys и скопируйте значение сразу (оно показывается один раз)';
  }
  return undefined;
}

const withStatus = (message: string, status: number) => Object.assign(new Error(message), { status });

function textOf(content: Anthropic.Beta.BetaContentBlock[] | Anthropic.ContentBlock[]): string {
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

export async function completeAnthropic(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
  client ??= new Anthropic();
  const digest = opts.model === 'digest';
  const model = digest ? DIGEST_MODEL() : MAIN_MODEL();

  try {
    // temperature не передаём: у Opus 5.5 / Haiku 5.5 параметры сэмплинга убраны (400)
    const base = {
      model,
      max_tokens: MAX_TOKENS(),
      system,
      messages: [{ role: 'user' as const, content: user }],
      output_config: { effort: EFFORT() },
    };

    // Если классификатор безопасности отклонит запрос (бывает и на безобидном тексте — например,
    // сцены насилия в романе), Anthropic сам повторит его на рекомендованной модели.
    // У Haiku 5.5 серверного fallback нет — для разбора глав обычный запрос.
    const response = digest
      ? await client.messages.create(base)
      : await client.beta.messages.create({
          ...base,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });

    if (response.stop_reason === 'refusal') {
      const category = response.stop_details?.category;
      throw withStatus(`Claude отказался обрабатывать этот фрагмент${category ? ` (${category})` : ''}. Попробуйте другую главу или вопрос.`, 422);
    }
    if (response.stop_reason === 'max_tokens') {
      throw withStatus('Ответ Claude не поместился в лимит — увеличьте ANTHROPIC_MAX_TOKENS', 502);
    }
    return textOf(response.content);
  } catch (e) {
    // От конкретного к общему: так в интерфейсе понятно, что делать
    if (e instanceof Anthropic.AuthenticationError) throw withStatus('Anthropic: неверный ANTHROPIC_API_KEY', 401);
    if (e instanceof Anthropic.PermissionDeniedError) throw withStatus('Anthropic: у ключа нет доступа к этой модели', 403);
    if (e instanceof Anthropic.NotFoundError) throw withStatus(`Anthropic: модель «${model}» не найдена — проверьте ANTHROPIC_MODEL`, 400);
    if (e instanceof Anthropic.RateLimitError) throw withStatus('Anthropic: слишком много запросов, подождите минуту', 429);
    if (e instanceof Anthropic.BadRequestError) {
      // Нулевой баланс приходит как 400 с текстом про credit balance
      if (/credit balance/i.test(e.message)) {
        throw withStatus('Anthropic: на балансе нет средств — пополните в console.anthropic.com → Billing', 402);
      }
      throw withStatus(`Anthropic: ${e.message}`, 400);
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw withStatus('Нет связи с api.anthropic.com. Из РФ может понадобиться VPN — или используйте LLM_PROVIDER=openrouter', 503);
    }
    if (e instanceof Anthropic.APIError) throw withStatus(`Anthropic ${e.status}: ${e.message}`, 502);
    throw e;
  }
}
