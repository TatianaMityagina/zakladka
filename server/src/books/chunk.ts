import type { Book, Chunk } from '../types.js';

/** ~2–4 абзаца прозы: достаточно контекста для ответа и короткая цитата для показа */
const TARGET_CHARS = 900;
const MAX_CHARS = 1400;

/** Длинный абзац (у Толстого бывают на страницу) режем по предложениям */
function splitLong(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > MAX_CHARS) {
      parts.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * Фрагменты не пересекают границу главы — это основа защиты от спойлеров:
 * у каждого фрагмента ровно одна глава, и поиск фильтрует по ней.
 */
export function chunkBook(book: Book): Chunk[] {
  const chunks: Chunk[] = [];
  for (const ch of book.chapters) {
    let buf: string[] = [];
    let len = 0;
    let n = 0;
    const flush = () => {
      if (!buf.length) return;
      chunks.push({ id: `c${ch.index}.${n++}`, chapter: ch.index, chapterTitle: ch.title, text: buf.join('\n') });
      buf = [];
      len = 0;
    };
    for (const p of ch.paragraphs.flatMap(splitLong)) {
      if (len && len + p.length > MAX_CHARS) flush();
      buf.push(p);
      len += p.length;
      if (len >= TARGET_CHARS) flush();
    }
    flush();
  }
  return chunks;
}
