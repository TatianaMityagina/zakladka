import type { Book, DiaryEntry, Review } from '../types.js';
import { entryNotes, loadDiary, saveDiary, visibleEntries } from '../books/diary.js';
import { digestChapter, storyChapters } from './features.js';
import { completeJson, isMock } from './llm.js';
import { DIARY_ENTRY_SYSTEM, REVIEW_SYSTEM } from './prompts.js';

/** Пересказ сессии + вопросы для размышления — по разборам сегодняшних глав */
export async function fillEntry(book: Book, entryId: string, upTo: number): Promise<DiaryEntry> {
  const diary = await loadDiary(book.id);
  const entry = diary.entries.find((e) => e.id === entryId);
  if (!entry) throw Object.assign(new Error('Запись не найдена'), { status: 404 });
  // Запись про главы дальше закладки (закладку откатили) — не трогаем: это уже спойлер
  if (entry.toChapter > upTo) throw Object.assign(new Error('Запись про главы дальше закладки'), { status: 400 });

  const chapters = storyChapters(book, entry.fromChapter - 1, entry.toChapter);
  if (!chapters.length) {
    entry.summary = 'Прочитаны вступительные разделы — сюжет ещё впереди.';
    await saveDiary(book.id, diary);
    return entry;
  }
  const today = await Promise.all(chapters.map((c) => digestChapter(book, c)));

  if (isMock()) {
    // Mock не сохраняем в дневник — только показываем
    return { ...entry, summary: `[mock] ${today.map((d) => d.summary.slice(0, 80)).join(' ')}`, reflections: [{ question: '[mock] Что вас удивило?', answer: '' }] };
  } else {
    const before = await Promise.all(storyChapters(book, 0, entry.fromChapter - 1).map((c) => digestChapter(book, c)));
    const res = await completeJson<{ summary: string; questions: string[] }>(
      DIARY_ENTRY_SYSTEM,
      [
        `Книга: «${book.title}», ${book.author}`,
        before.length ? `## Раньше (кратко)\n${before.map((d) => `гл. ${d.chapter + 1}: ${d.summary}`).join('\n')}` : '',
        `## Сегодня прочитано: главы ${entry.fromChapter}–${entry.toChapter}`,
        ...today.map((d) => `### Глава ${d.chapter + 1}. ${book.chapters[d.chapter].title}\n${d.summary}\nСобытия: ${d.events.join('; ')}`),
      ]
        .filter(Boolean)
        .join('\n\n'),
      { maxTokens: 700 },
    );
    entry.summary = res.summary;
    const answered = entry.reflections.filter((r) => r.answer.trim());
    entry.reflections = [...answered, ...(res.questions ?? []).slice(0, 2).map((question) => ({ question, answer: '' }))];
  }
  await saveDiary(book.id, diary);
  return entry;
}

/** Отзыв — из мыслей читателя, а не из «мнения» модели о книге */
export async function writeReview(book: Book, upTo: number): Promise<Review> {
  const diary = await loadDiary(book.id);
  const entries = visibleEntries(diary.entries, upTo).sort((a, b) => a.date.localeCompare(b.date));
  const notes = entries.map((e) => ({ e, text: entryNotes(e) })).filter((n) => n.text);
  if (!notes.length) {
    throw Object.assign(new Error('В дневнике пока нет ваших мыслей и цитат — отзыв не из чего собрать'), { status: 400 });
  }
  const final = upTo === book.chapters.length;
  let text: string;
  if (isMock()) {
    return { text: `[mock] Отзыв из ${notes.length} записей.`, final, createdAt: new Date().toISOString() };
  } else {
    const digests = await Promise.all(storyChapters(book, 0, upTo).map((c) => digestChapter(book, c)));
    const res = await completeJson<{ text: string; enough: boolean }>(
      REVIEW_SYSTEM,
      [
        `Книга: «${book.title}», ${book.author}. ${final ? 'Книга дочитана.' : `Промежуточный отзыв: прочитано ${upTo} из ${book.chapters.length} глав.`}`,
        `## Сюжет (для контекста, кратко)\n${digests.map((d) => `гл. ${d.chapter + 1}: ${d.summary}`).join('\n')}`,
        `## Записи читателя\n${notes.map((n) => `### ${n.e.date}, гл. ${n.e.fromChapter}–${n.e.toChapter}\n${n.text}`).join('\n\n')}`,
      ].join('\n\n'),
      { maxTokens: 1200 },
    );
    text = res.text;
  }
  diary.review = { text, final, createdAt: new Date().toISOString() };
  await saveDiary(book.id, diary);
  return diary.review;
}
