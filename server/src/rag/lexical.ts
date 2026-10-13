const STOP = new Set(['если', 'чтобы', 'когда', 'теперь', 'нужно', 'сейчас', 'всем', 'этот', 'есть', 'пока', 'только', 'после']);

/**
 * Грубый стемминг: нижний регистр, ё→е, слова от 4 букв, первые 5 символов.
 * «повторяющиеся» и «повторов» → «повто». Для русского этого хватает, чтобы ловить совпадения.
 */
export function stems(text: string): Set<string> {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{4,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)));
}

/** Доля основ запроса, встретившихся в тексте */
export function overlap(query: Set<string>, text: Set<string>): number {
  if (!query.size) return 0;
  let hit = 0;
  for (const s of query) if (text.has(s)) hit++;
  return hit / query.size;
}
