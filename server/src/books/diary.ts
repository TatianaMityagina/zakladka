import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BOOKS_ROOT } from './paths.js';
import { overlap, stems } from '../rag/lexical.js';
import type { Book, Diary, DiaryEntry, DiaryQuote, DiaryStats, Review } from '../types.js';

const ROOT = BOOKS_ROOT;
const file = (id: string) => join(ROOT, id, 'diary.json');

interface DiaryFile {
  entries: DiaryEntry[];
  review?: Review;
}

/** Локальная дата: «сегодня» читателя, а не UTC (иначе вечернее чтение уедет на завтра) */
export function today(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function loadDiary(id: string): Promise<DiaryFile> {
  try {
    return JSON.parse(await readFile(file(id), 'utf8')) as DiaryFile;
  } catch {
    return { entries: [] };
  }
}

export async function saveDiary(id: string, d: DiaryFile) {
  await mkdir(dirname(file(id)), { recursive: true });
  await writeFile(file(id), JSON.stringify(d));
}

/**
 * Закладка сдвинулась вперёд → запись за сегодня создаётся или расширяется.
 * Если диапазон глав изменился — пересказ сбрасывается (его перегенерируют), мысли остаются.
 */
export async function recordProgress(id: string, prevUpTo: number, nextUpTo: number) {
  if (nextUpTo <= prevUpTo) return;
  const diary = await loadDiary(id);
  const date = today();
  const entry = diary.entries.find((e) => e.date === date);
  if (entry) {
    const from = Math.min(entry.fromChapter, prevUpTo + 1);
    const to = Math.max(entry.toChapter, nextUpTo);
    if (from !== entry.fromChapter || to !== entry.toChapter) {
      entry.fromChapter = from;
      entry.toChapter = to;
      entry.summary = undefined;
      // Вопросы без ответов — устарели вместе с пересказом; отвеченные сохраняем
      entry.reflections = entry.reflections.filter((r) => r.answer.trim());
    }
  } else {
    diary.entries.push({
      id: randomUUID(),
      date,
      fromChapter: prevUpTo + 1,
      toChapter: nextUpTo,
      reflections: [],
      thoughts: '',
      quotes: [],
    });
  }
  await saveDiary(id, diary);
}

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

/** Доля слов цитаты, начиная с которой абзац считаем «той самой» цитатой, запомненной неточно */
const APPROX_QUOTE_OVERLAP = 0.8;

/**
 * Ищем цитату в прочитанных главах — так у неё появляется «гл. 4».
 * Сначала дословно; если нет — абзац почти со всеми словами цитаты
 * («Береги честь смолоду» ↔ «береги платье снову, а честь смолоду»).
 */
export function locateQuote(book: Book, text: string, upTo: number): DiaryQuote {
  const q = normalize(text);
  if (q.length < 8) return { text };
  const chapters = book.chapters.slice(0, upTo);
  for (const ch of chapters) {
    if (normalize(ch.paragraphs.join(' ')).includes(q)) return { text, chapter: ch.index + 1 };
  }
  const qstems = stems(text);
  if (qstems.size < 2) return { text };
  let best = { score: 0, chapter: -1 };
  for (const ch of chapters) {
    for (const p of ch.paragraphs) {
      const score = overlap(qstems, stems(p));
      if (score > best.score) best = { score, chapter: ch.index };
    }
  }
  return best.score >= APPROX_QUOTE_OVERLAP ? { text, chapter: best.chapter + 1, approximate: true } : { text };
}

export function computeStats(book: Book, entries: DiaryEntry[], upTo: number): DiaryStats {
  const days = [...new Set(entries.map((e) => e.date))].sort();
  let streak = 0;
  const cursor = new Date();
  // Серия не теряется, пока сегодня ещё не читали: считаем от вчера
  if (!days.includes(today(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.includes(today(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  const chaptersThisWeek = entries
    .filter((e) => e.date >= today(weekAgo))
    .reduce((n, e) => n + e.toChapter - e.fromChapter + 1, 0);

  const total = book.chapters.reduce((n, c) => n + c.paragraphs.join('').length, 0);
  const read = book.chapters.slice(0, upTo).reduce((n, c) => n + c.paragraphs.join('').length, 0);

  return {
    readingDays: days.length,
    streak,
    chaptersThisWeek,
    percent: Math.round((read / total) * 100),
    startedAt: days[0],
  };
}

/** Записи, которые можно показывать ИИ: только про прочитанные главы (закладку могли откатить) */
export const visibleEntries = (entries: DiaryEntry[], upTo: number) => entries.filter((e) => e.toChapter <= upTo);

/** Текст записи от лица читателя — для поиска и для отзыва */
export function entryNotes(e: DiaryEntry): string {
  return [
    e.thoughts.trim() && `Мысли: ${e.thoughts.trim()}`,
    ...e.reflections.filter((r) => r.answer.trim()).map((r) => `${r.question} — ${r.answer.trim()}`),
    ...e.quotes.map((q) => `Понравилась цитата${q.chapter ? ` (гл. ${q.chapter})` : ''}: «${q.text}»`),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function diaryView(book: Book, upTo: number): Promise<Diary> {
  const d = await loadDiary(book.id);
  return {
    entries: [...d.entries].sort((a, b) => b.date.localeCompare(a.date)),
    review: d.review,
    stats: computeStats(book, d.entries, upTo),
  };
}
