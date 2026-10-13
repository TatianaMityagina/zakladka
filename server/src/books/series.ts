import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Book, PrequelRef, SeriesInfo } from '../types.js';
import { BOOKS_ROOT } from './paths.js';

/**
 * Запасной способ, если в метаданных нет серии: номер тома в названии.
 * «Монолог фармацевта Том 5», «Ведьмак. Книга 2», «Dune, vol. 3».
 */
export function seriesFromTitle(title: string): SeriesInfo | undefined {
  const m = title.match(/^(.*?)[\s.,:;—–-]*(?:том|книга|часть|vol\.?|volume|book)\s*(\d+)\b/i);
  if (!m || !m[1].trim()) return undefined;
  return { name: m[1].trim(), number: Number(m[2]) };
}

export const normalizeSeries = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

/** Серия книги: из файла, иначе из названия (для книг, загруженных до появления поддержки серий) */
export const seriesOf = (book: Book) => book.series ?? seriesFromTitle(book.title);

/** Подпись тома для цитат и персонажей: «Том 3» или название книги */
export function volumeLabel(book: Book): string {
  const s = seriesOf(book);
  return s?.number ? `Том ${s.number}` : `«${book.title}»`;
}

const file = (id: string) => join(BOOKS_ROOT, id, 'series.json');

export async function getPrequelIds(id: string): Promise<string[]> {
  try {
    return (JSON.parse(await readFile(file(id), 'utf8')) as { prequels: string[] }).prequels;
  } catch {
    return [];
  }
}

export async function savePrequelIds(id: string, ids: string[]) {
  await mkdir(dirname(file(id)), { recursive: true });
  await writeFile(file(id), JSON.stringify({ prequels: ids }));
}

export const toRef = (b: Book): PrequelRef => ({ id: b.id, title: b.title, number: seriesOf(b)?.number });

/** По порядку чтения: по номеру тома, без номера — в конце в исходном порядке */
export const byVolume = <T extends { number?: number }>(list: T[]) =>
  [...list].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));

/** Кандидаты в предыдущие тома: та же серия и меньший номер (или номер неизвестен) */
export function suggestPrequels(book: Book, library: Book[]): PrequelRef[] {
  const s = seriesOf(book);
  if (!s) return [];
  const name = normalizeSeries(s.name);
  return byVolume(
    library
      .filter((b) => b.id !== book.id)
      .filter((b) => {
        const bs = seriesOf(b);
        return bs && normalizeSeries(bs.name) === name && (!s.number || !bs.number || bs.number < s.number);
      })
      .map(toRef),
  );
}
