import type { Answer, Book, Character, Chunk, Digest, DiaryNoteRef, Grade, QuizQuestion, Recap, VolumeSummary } from '../types.js';
import { getDigest, getPrequels, saveDigest } from '../books/store.js';
import { volumeLabel } from '../books/series.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BOOKS_ROOT } from '../books/paths.js';
import { entryNotes, loadDiary, visibleEntries } from '../books/diary.js';
import { isExtra } from '../books/extra.js';
import { chaptersChunks, chunkById, searchSeries } from '../rag/search.js';
import { cosine, embed } from '../rag/embed.js';
import { overlap, stems } from '../rag/lexical.js';
import { mapLimit } from '../util.js';
import { completeJson, isMock } from './llm.js';
import { ASK_SYSTEM, DIGEST_SYSTEM, GRADE_SYSTEM, QUIZ_SYSTEM, RECAP_SYSTEM, VOLUME_SYSTEM } from './prompts.js';

/** Глава длиннее — режем на части, чтобы влезть в контекст и не платить за огромный запрос */
const MAX_DIGEST_INPUT = 40_000;

const chapterText = (book: Book, chapter: number) => book.chapters[chapter].paragraphs.join('\n');

function checkUpTo(book: Book, upTo: number) {
  if (!Number.isInteger(upTo) || upTo < 1 || upTo > book.chapters.length) {
    throw Object.assign(new Error(`Прочитано глав должно быть от 1 до ${book.chapters.length}`), { status: 400 });
  }
}

// --- Разбор главы: основа для пересказа и персонажей ---

const inflight = new Map<string, Promise<Digest>>();

export function digestChapter(book: Book, chapter: number): Promise<Digest> {
  const key = `${book.id}:${chapter}`;
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      const cached = await getDigest(book.id, chapter);
      if (cached) return cached;
      const ch = book.chapters[chapter];
      if (!ch) throw Object.assign(new Error('Нет такой главы'), { status: 400 });

      if (isExtra(ch)) throw Object.assign(new Error('Служебный раздел не пересказывается'), { status: 400 });

      let digest: Digest;
      if (isMock()) {
        // Mock не сохраняем: иначе заглушки останутся в кэше, когда включат настоящую LLM
        return { chapter, summary: `[mock] ${ch.paragraphs[0]?.slice(0, 200) ?? ''}`, events: [], characters: [] };
      } else {
        const text = chapterText(book, chapter);
        const parts: string[] = [];
        for (let i = 0; i < text.length; i += MAX_DIGEST_INPUT) parts.push(text.slice(i, i + MAX_DIGEST_INPUT));
        const partials = await Promise.all(
          parts.map((part, i) =>
            completeJson<Omit<Digest, 'chapter'>>(
              DIGEST_SYSTEM,
              `Книга: «${book.title}», ${book.author}\n${ch.title}${parts.length > 1 ? ` (часть ${i + 1} из ${parts.length})` : ''}\n\n${part}`,
              { model: 'digest' },
            ),
          ),
        );
        digest = {
          chapter,
          summary: partials.map((d) => d.summary).join(' '),
          events: partials.flatMap((d) => d.events ?? []),
          characters: partials.flatMap((d) => d.characters ?? []),
        };
      }
      await saveDigest(book.id, digest);
      return digest;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Номера сюжетных глав (без служебных) из диапазона [from, to) */
export const storyChapters = (book: Book, from: number, to: number) =>
  book.chapters.slice(from, to).filter((c) => !isExtra(c)).map((c) => c.index);

export const digestUpTo = (book: Book, upTo: number) =>
  mapLimit(storyChapters(book, 0, upTo), 3, (i) => digestChapter(book, i));

// --- Пересказ «что было до этого» ---

export async function recap(book: Book, upTo: number, mode: 'short' | 'full'): Promise<Recap> {
  checkUpTo(book, upTo);
  const digests = await digestUpTo(book, upTo);
  if (isMock()) {
    return { upTo, paragraphs: digests.map((d) => ({ text: d.summary, chapters: [d.chapter + 1] })), openThreads: [] };
  }
  const input = digests
    .map((d) => `## Глава ${d.chapter + 1}. ${book.chapters[d.chapter].title}\n${d.summary}\nСобытия: ${d.events.join('; ')}`)
    .join('\n\n');
  const notes = visibleEntries((await loadDiary(book.id)).entries, upTo)
    .map((e) => ({ e, text: entryNotes(e) }))
    .filter((n) => n.text)
    .map((n) => `- гл. ${n.e.fromChapter}–${n.e.toChapter}: ${n.text.replace(/\n/g, '; ')}`)
    .join('\n');
  const volumes = (await prequelSummaries(book)).map((v) => `- ${v.volume}: ${v.text}`).join('\n');
  const res = await completeJson<Omit<Recap, 'upTo'>>(
    RECAP_SYSTEM,
    `Книга: «${book.title}», ${book.author}. Прочитано глав: ${upTo} из ${book.chapters.length}.\nmode: ${mode}\n\n${volumes ? `## Прошлые тома серии (кратко)\n${volumes}\n\n` : ''}${input}${notes ? `\n\n## Заметки читателя\n${notes}` : ''}`,
  );
  // Ссылки только на прочитанные главы — защита от «галлюцинаций в номерах»
  return {
    upTo,
    paragraphs: (res.paragraphs ?? []).map((p) => ({
      text: p.text,
      chapters: (p.chapters ?? []).filter((c) => Number.isInteger(c) && c >= 1 && c <= upTo),
    })),
    openThreads: res.openThreads ?? [],
  };
}

// --- Вопрос по книге ---

export async function ask(book: Book, upTo: number, question: string): Promise<Answer> {
  checkUpTo(book, upTo);
  const q = question.trim();
  if (!q) throw Object.assign(new Error('Пустой вопрос'), { status: 400 });

  const prequels = (await getPrequels(book.id)).map((p) => ({ book: p, volume: volumeLabel(p) }));
  const [found, notes] = await Promise.all([searchSeries(book, prequels, q, upTo, 8), searchNotes(book, q, upTo)]);
  if (isMock()) {
    return { found: true, answer: '[mock] Найденные фрагменты — справа.', quotes: found.slice(0, 3).map((f) => f.chunk), notes };
  }
  const blocks = [
    ...found.map(
      (f) =>
        `<fragment id="${f.chunk.id}" chapter="${f.chunk.chapter + 1}"${f.chunk.volume ? ` volume="${f.chunk.volume}"` : ''}>\n${f.chunk.text}\n</fragment>`,
    ),
    ...notes.map((n) => `<note id="${n.entryId}" date="${n.date}">\n${n.text}\n</note>`),
  ].join('\n');
  const res = await completeJson<{ found: boolean; answer: string; quotes: string[]; notes?: string[] }>(
    ASK_SYSTEM,
    `Книга: «${book.title}», ${book.author}. Прочитано глав: ${upTo}.\n\nФрагменты:\n${blocks}\n\nВопрос: ${q}`,
  );
  // Цитаты и заметки — только из того, что реально передали (LLM может выдумать id)
  const byId = new Map(found.map((f) => [f.chunk.id, f.chunk]));
  const quotes = [...new Set(res.quotes ?? [])].map((id) => byId.get(id)).filter((c): c is Chunk => !!c);
  const usedNotes = notes.filter((n) => (res.notes ?? []).includes(n.entryId));
  const dropped = (res.quotes ?? []).filter((id) => !byId.has(id));
  if (dropped.length) console.warn(`[ask] LLM сослалась на несуществующие фрагменты: ${dropped.join(', ')}`);
  const sourced = quotes.length + usedNotes.length > 0;
  return {
    found: Boolean(res.found),
    answer: res.answer,
    quotes,
    notes: usedNotes,
    // Ответ есть, а источников нет — показываем с предупреждением, а не прячем и не выдаём за проверенный
    unverified: Boolean(res.found) && !sourced,
  };
}

/** Поиск по дневнику: записей мало, индекс не нужен — эмбеддинги считаются на лету (и кэшируются) */
const MIN_NOTE_SCORE = 0.83;

async function searchNotes(book: Book, q: string, upTo: number, k = 3): Promise<DiaryNoteRef[]> {
  const notes = visibleEntries((await loadDiary(book.id)).entries, upTo)
    .map((e) => ({ entryId: e.id, date: e.date, text: entryNotes(e) }))
    .filter((n) => n.text);
  if (!notes.length) return [];
  const [[qvec], vecs] = await Promise.all([embed([q], 'query'), embed(notes.map((n) => n.text), 'passage')]);
  const qstems = stems(q);
  return notes
    .map((n, i) => ({ n, score: cosine(qvec, vecs[i]) + 0.4 * overlap(qstems, stems(n.text)) }))
    .filter((x) => x.score >= MIN_NOTE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.n);
}

// --- Персонажи ---

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я\s-]/g, '').trim();

/**
 * Склейка персонажей из разборов глав. Один и тот же герой — если совпало любое имя/обращение
 * или короткое имя совпадает с фамилией полного («Гринёв» ↔ «Пётр Андреевич Гринёв»).
 */
export function mergeCharacters(items: Array<{ digest: Digest; volume?: string }>): Character[] {
  const result: Array<Character & { keys: Set<string> }> = [];
  // items уже в порядке чтения: тома по порядку, внутри — главы
  for (const { digest: d, volume } of items) {
    for (const c of d.characters) {
      const names = [c.name, ...(c.aliases ?? [])].map(norm).filter(Boolean);
      const surnames = names.filter((n) => n.includes(' ')).map((n) => n.split(/\s+/).at(-1)!);
      const match = result.find(
        (r) =>
          names.some((n) => r.keys.has(n)) ||
          surnames.some((s) => r.keys.has(s)) ||
          [...r.keys].some((k) => k.includes(' ') && names.includes(k.split(/\s+/).at(-1)!)),
      );
      if (match) {
        names.forEach((n) => match.keys.add(n));
        for (const a of [c.name, ...(c.aliases ?? [])]) if (!match.aliases.includes(a) && a !== match.name) match.aliases.push(a);
        if (c.name.length > match.name.length) {
          match.aliases = [match.name, ...match.aliases.filter((a) => a !== c.name)];
          match.name = c.name;
        }
        match.notes.push({ chapter: d.chapter + 1, note: c.note, volume });
      } else {
        result.push({
          name: c.name,
          aliases: (c.aliases ?? []).filter((a) => a !== c.name),
          firstChapter: d.chapter + 1,
          firstVolume: volume,
          notes: [{ chapter: d.chapter + 1, note: c.note, volume }],
          keys: new Set(names),
        });
      }
    }
  }
  const order = new Map(result.map((c, i) => [c, i]));
  return result
    .sort((a, b) => b.notes.length - a.notes.length || order.get(a)! - order.get(b)!)
    .map(({ keys: _keys, ...c }) => c);
}

export async function characters(book: Book, upTo: number): Promise<Character[]> {
  checkUpTo(book, upTo);
  // Персонажи прошлых томов — из уже готовых разборов (их делает «Напомнить прошлые тома»)
  const previous: Array<{ digest: Digest; volume: string }> = [];
  for (const p of await getPrequels(book.id)) {
    const volume = volumeLabel(p);
    for (const ch of storyChapters(p, 0, p.chapters.length)) {
      const d = await getDigest(p.id, ch);
      if (d) previous.push({ digest: d, volume });
    }
  }
  const current = (await digestUpTo(book, upTo)).sort((a, b) => a.chapter - b.chapter).map((digest) => ({ digest }));
  return mergeCharacters([...previous, ...current]);
}

// --- Предыдущие тома ---

const volumeFile = (id: string) => join(BOOKS_ROOT, id, 'volume.json');

async function cachedVolume(book: Book): Promise<VolumeSummary | undefined> {
  try {
    return JSON.parse(await readFile(volumeFile(book.id), 'utf8')) as VolumeSummary;
  } catch {
    return undefined;
  }
}

/** Краткое содержание целого тома — из разборов всех его глав; один раз, кэш */
export async function volumeSummary(book: Book): Promise<VolumeSummary> {
  const cached = await cachedVolume(book);
  if (cached) return cached;
  const digests = await digestUpTo(book, book.chapters.length);
  const volume = volumeLabel(book);
  if (isMock()) return { bookId: book.id, volume, text: `[mock] ${digests.length} глав` };
  const res = await completeJson<{ text: string }>(
    VOLUME_SYSTEM,
    `${volume}: «${book.title}», ${book.author}\n\n${digests
      .sort((a, b) => a.chapter - b.chapter)
      .map((d) => `## Глава ${d.chapter + 1}. ${book.chapters[d.chapter].title}\n${d.summary}`)
      .join('\n\n')}`,
    { maxTokens: 800 },
  );
  const summary = { bookId: book.id, volume, text: res.text };
  await writeFile(volumeFile(book.id), JSON.stringify(summary));
  return summary;
}

/** Готовые содержания предыдущих томов (не запускает LLM) */
export async function prequelSummaries(book: Book): Promise<VolumeSummary[]> {
  const out: VolumeSummary[] = [];
  for (const p of await getPrequels(book.id)) {
    const v = await cachedVolume(p);
    if (v) out.push(v);
  }
  return out;
}

// --- Проверь себя ---

export async function quiz(book: Book, upTo: number, chapter: number): Promise<QuizQuestion[]> {
  checkUpTo(book, upTo);
  if (chapter < 0 || chapter >= upTo) throw Object.assign(new Error('Можно проверить только прочитанную главу'), { status: 400 });
  if (isExtra(book.chapters[chapter])) throw Object.assign(new Error('Это служебный раздел, а не глава'), { status: 400 });
  const chunks = await chaptersChunks(book, chapter);
  if (isMock()) {
    return chunks.slice(0, 2).map((c, i) => ({
      id: `${c.id}:q${i}`,
      chapter: chapter + 1,
      question: `[mock] О чём фрагмент ${c.id}?`,
      answer: c.text.slice(0, 120),
      quote: c,
    }));
  }
  const blocks = chunks.map((c) => `<fragment id="${c.id}">\n${c.text}\n</fragment>`).join('\n');
  const res = await completeJson<{ questions: Array<{ question: string; answer: string; quote: string }> }>(
    QUIZ_SYSTEM,
    `Книга: «${book.title}», ${book.author}\n${book.chapters[chapter].title}\n\n${blocks}`,
  );
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return (res.questions ?? []).map((q, i) => ({
    id: `${book.id}:${chapter}:${i}:${q.question.slice(0, 20)}`,
    chapter: chapter + 1,
    question: q.question,
    answer: q.answer,
    quote: byId.get(q.quote),
  }));
}

export async function grade(book: Book, q: QuizQuestion, userAnswer: string): Promise<Grade> {
  const a = userAnswer.trim();
  if (!a) return { verdict: 'wrong', feedback: `Правильный ответ: ${q.answer}` };
  if (isMock()) return { verdict: 'partial', feedback: `[mock] Эталон: ${q.answer}` };
  const quote = q.quote ? (await chunkById(book, q.quote.id))?.text : undefined;
  const res = await completeJson<Grade>(
    GRADE_SYSTEM,
    `Вопрос: ${q.question}\nЭталонный ответ: ${q.answer}\n${quote ? `Цитата из книги:\n${quote}\n` : ''}\nОтвет читателя: ${a}`,
    { maxTokens: 700 },
  );
  const verdict = (['correct', 'partial', 'wrong'] as const).find((v) => v === res.verdict) ?? 'partial';
  return { verdict, feedback: res.feedback };
}
