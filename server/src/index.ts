import express from 'express';
import { readFile } from 'node:fs/promises';
import type { QuizQuestion } from './types.js';
import { parseBook } from './books/parse.js';
import { allBooks, bookMeta, deleteBook, getBook, getProgress, listBooks, saveBook, saveProgress } from './books/store.js';
import { savePrequelIds } from './books/series.js';
import { dropIndex, indexBook } from './rag/search.js';
import { ask, characters, digestChapter, grade, prequelSummaries, quiz, recap, volumeSummary } from './ai/features.js';
import { assertLlmConfigured, llmStatus } from './ai/llm.js';
import { fillEntry, writeReview } from './ai/diary.js';
import { diaryView, loadDiary, locateQuote, recordProgress, saveDiary } from './books/diary.js';
import { DEMO_BOOK } from './demo.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

/** Обёртка: ошибка → JSON с понятным текстом для UI */
const handle =
  (fn: (req: express.Request) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (status >= 500) console.error(e);
      res.status(status).json({ error: (e as Error).message });
    }
  };

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const upToOf = (v: unknown) => Number(v);

async function addBook(buf: Buffer, filename: string) {
  // Не тот формат / битый файл — ошибка пользователя (400), а не сервера
  const book = await parseBook(buf, filename).catch((e: Error) => {
    throw Object.assign(e, { status: 400 });
  });
  await saveBook(book);
  const started = Date.now();
  await indexBook(book, (done, total) => console.log(`[${book.title}] эмбеддинги ${done}/${total}`));
  console.log(`[${book.title}] проиндексирована за ${((Date.now() - started) / 1000).toFixed(1)} с`);
  return bookMeta(book);
}

app.get('/api/status', handle(async () => llmStatus()));

app.get('/api/books', handle(() => listBooks()));

app.post(
  '/api/books',
  express.raw({ type: 'application/octet-stream', limit: '60mb' }),
  handle(async (req) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Пустой файл');
    return addBook(req.body, decodeURIComponent(String(req.headers['x-filename'] ?? 'book')));
  }),
);

app.post('/api/books/demo', handle(async () => addBook(await readFile(DEMO_BOOK), 'kapitanskaya-dochka.fb2')));

app.get('/api/books/:id', handle(async (req) => bookMeta(await getBook(String(req.params.id)))));

app.delete(
  '/api/books/:id',
  handle(async (req) => {
    const id = String(req.params.id);
    await deleteBook(id);
    dropIndex(id);
    return { deleted: id };
  }),
);

// --- Серия ---

/**
 * Подключение предыдущих томов. Они прочитаны целиком — ставим им закладку в конец
 * (без записи в дневник: это не сегодняшнее чтение).
 */
app.put(
  '/api/books/:id/prequels',
  handle(async (req) => {
    const book = await getBook(String(req.params.id));
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String) : [];
    const unique = [...new Set(ids)].filter((id) => id !== book.id);
    const prequels = await Promise.all(unique.map((id) => getBook(id)));
    for (const p of prequels) {
      const progress = await getProgress(p.id);
      if (progress.upTo < p.chapters.length) await saveProgress(p.id, { ...progress, upTo: p.chapters.length });
    }
    await savePrequelIds(book.id, unique);
    return bookMeta(book, await allBooks());
  }),
);

/** Краткое содержание тома (вызывается для предыдущего тома после разбора его глав) */
app.post(
  '/api/books/:id/volume-summary',
  handle(async (req) => {
    assertLlmConfigured();
    const book = await getBook(String(req.params.id));
    if ((await getProgress(book.id)).upTo < book.chapters.length) throw bad('Том ещё не дочитан');
    return volumeSummary(book);
  }),
);

app.get(
  '/api/books/:id/prequel-summaries',
  handle(async (req) => prequelSummaries(await getBook(String(req.params.id)))),
);

app.put(
  '/api/books/:id/progress',
  handle(async (req) => {
    const book = await getBook(String(req.params.id));
    const upTo = upToOf(req.body?.upTo);
    if (!Number.isInteger(upTo) || upTo < 1 || upTo > book.chapters.length) throw bad('Некорректная глава');
    const prev = await getProgress(book.id);
    const progress = { ...prev, upTo };
    await saveProgress(book.id, progress);
    // Сдвиг вперёд = сессия чтения → запись в дневнике за сегодня
    await recordProgress(book.id, prev.upTo, upTo);
    return progress;
  }),
);

/** Разбор одной главы — клиент вызывает по главам и показывает прогресс «читаю главу 3 из 8» */
app.post(
  '/api/books/:id/digest/:chapter',
  handle(async (req) => {
    assertLlmConfigured();
    const book = await getBook(String(req.params.id));
    const chapter = Number(req.params.chapter);
    // Разбираем только прочитанные главы: разбор непрочитанной — уже спойлер на диске
    if (chapter >= (await getProgress(book.id)).upTo) throw bad('Эта глава ещё не прочитана');
    await digestChapter(book, chapter);
    return { chapter };
  }),
);

app.post(
  '/api/books/:id/recap',
  handle(async (req) => {
    assertLlmConfigured();
    const mode = req.body?.mode === 'full' ? 'full' : 'short';
    return recap(await getBook(String(req.params.id)), upToOf(req.body?.upTo), mode);
  }),
);

app.post(
  '/api/books/:id/ask',
  handle(async (req) => {
    assertLlmConfigured();
    return ask(await getBook(String(req.params.id)), upToOf(req.body?.upTo), String(req.body?.question ?? ''));
  }),
);

app.get(
  '/api/books/:id/characters',
  handle(async (req) => {
    assertLlmConfigured();
    return characters(await getBook(String(req.params.id)), upToOf(req.query.upTo));
  }),
);

app.post(
  '/api/books/:id/quiz',
  handle(async (req) => {
    assertLlmConfigured();
    return quiz(await getBook(String(req.params.id)), upToOf(req.body?.upTo), Number(req.body?.chapter));
  }),
);

/** Проверка ответа + учёт ошибок: неверные вопросы попадают в «Повторить», верный — уходит оттуда */
app.post(
  '/api/books/:id/grade',
  handle(async (req) => {
    assertLlmConfigured();
    const book = await getBook(String(req.params.id));
    const question = req.body?.question as QuizQuestion | undefined;
    if (!question?.question || !question.answer) throw bad('Нет вопроса');
    const result = await grade(book, question, String(req.body?.answer ?? ''));
    const progress = await getProgress(book.id);
    const rest = progress.mistakes.filter((m) => m.id !== question.id);
    progress.mistakes = result.verdict === 'correct' ? rest : [...rest, question];
    await saveProgress(book.id, progress);
    return { ...result, mistakes: progress.mistakes.length };
  }),
);

// --- Дневник чтения ---

app.get(
  '/api/books/:id/diary',
  handle(async (req) => {
    const book = await getBook(String(req.params.id));
    return diaryView(book, (await getProgress(book.id)).upTo);
  }),
);

/** ИИ-часть записи: что произошло за сессию + вопросы для размышления */
app.post(
  '/api/books/:id/diary/:entry/fill',
  handle(async (req) => {
    assertLlmConfigured();
    const book = await getBook(String(req.params.id));
    return fillEntry(book, String(req.params.entry), (await getProgress(book.id)).upTo);
  }),
);

/** Правки читателя: мысли, ответы на вопросы, цитаты (цитата ищется в тексте → номер главы) */
app.patch(
  '/api/books/:id/diary/:entry',
  handle(async (req) => {
    const book = await getBook(String(req.params.id));
    const diary = await loadDiary(book.id);
    const entry = diary.entries.find((e) => e.id === String(req.params.entry));
    if (!entry) throw Object.assign(new Error('Запись не найдена'), { status: 404 });
    const body = req.body as { thoughts?: string; answers?: string[]; quotes?: string[]; summary?: string };
    if (typeof body.thoughts === 'string') entry.thoughts = body.thoughts.slice(0, 10_000);
    // Пересказ ИИ читатель может исправить — это его дневник
    if (typeof body.summary === 'string') entry.summary = body.summary.trim().slice(0, 5000) || undefined;
    if (Array.isArray(body.answers)) entry.reflections.forEach((r, i) => (r.answer = String(body.answers![i] ?? r.answer).slice(0, 5000)));
    if (Array.isArray(body.quotes)) {
      const upTo = (await getProgress(book.id)).upTo;
      entry.quotes = body.quotes
        .map((q) => String(q).trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((q) => entry.quotes.find((old) => old.text === q) ?? locateQuote(book, q, upTo));
    }
    await saveDiary(book.id, diary);
    return entry;
  }),
);

app.post(
  '/api/books/:id/review',
  handle(async (req) => {
    assertLlmConfigured();
    const book = await getBook(String(req.params.id));
    return writeReview(book, (await getProgress(book.id)).upTo);
  }),
);

const port = Number(process.env.PORT) || 3002;
app.listen(port, () => console.log(`Закладка API: http://localhost:${port}`));
