import type { Book, Chunk } from '../types.js';
import { chunkBook } from '../books/chunk.js';
import { cosine, embed } from './embed.js';
import { overlap, stems } from './lexical.js';

/** Вес совпадения слов: имена героев и редкие слова e5-small ловит хуже, чем точное совпадение */
const LEXICAL_WEIGHT = 0.4;

interface Indexed {
  chunk: Chunk;
  vec: number[];
  stems: Set<string>;
}

const indexes = new Map<string, Promise<Indexed[]>>();

/** Индекс строится один раз на книгу; векторы кэшируются на диске, повторный старт мгновенный */
export function indexBook(book: Book, onProgress?: (done: number, total: number) => void): Promise<Indexed[]> {
  let idx = indexes.get(book.id);
  if (!idx) {
    idx = (async () => {
      const chunks = chunkBook(book);
      const vecs = await embed(
        chunks.map((c) => `${c.chapterTitle}\n${c.text}`),
        'passage',
        onProgress,
      );
      return chunks.map((chunk, i) => ({ chunk, vec: vecs[i], stems: stems(chunk.text) }));
    })();
    indexes.set(book.id, idx);
    idx.catch(() => indexes.delete(book.id));
  }
  return idx;
}

/** Индекс больше не нужен (книгу удалили) */
export const dropIndex = (id: string) => indexes.delete(id);

export async function chaptersChunks(book: Book, chapter: number): Promise<Chunk[]> {
  return (await indexBook(book)).filter((x) => x.chunk.chapter === chapter).map((x) => x.chunk);
}

export async function chunkById(book: Book, id: string): Promise<Chunk | undefined> {
  return (await indexBook(book)).find((x) => x.chunk.id === id)?.chunk;
}

/**
 * Защита от спойлеров — на уровне поиска, а не промпта:
 * фрагменты глав ≥ upTo просто не участвуют, LLM их никогда не увидит.
 */
export async function search(book: Book, query: string, upTo: number, k = 8): Promise<Array<{ chunk: Chunk; score: number }>> {
  const index = (await indexBook(book)).filter((x) => x.chunk.chapter < upTo);
  const [qvec] = await embed([query], 'query');
  const qstems = stems(query);
  return index
    .map((x) => ({ chunk: x.chunk, score: cosine(qvec, x.vec) + LEXICAL_WEIGHT * overlap(qstems, x.stems) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Поиск по серии: текущий том — до закладки, предыдущие тома — целиком (их уже прочитали).
 * id фрагментов прошлых томов с префиксом книги — иначе «c3.12» из разных томов совпадут.
 */
export async function searchSeries(
  book: Book,
  prequels: Array<{ book: Book; volume: string }>,
  query: string,
  upTo: number,
  k = 8,
): Promise<Array<{ chunk: Chunk; score: number }>> {
  const [current, ...previous] = await Promise.all([
    search(book, query, upTo, k),
    ...prequels.map(async (p) =>
      (await search(p.book, query, p.book.chapters.length, k)).map((r) => ({
        score: r.score,
        chunk: { ...r.chunk, id: `${p.book.id}:${r.chunk.id}`, volume: p.volume },
      })),
    ),
  ]);
  return [...current, ...previous.flat()].sort((a, b) => b.score - a.score).slice(0, k);
}
