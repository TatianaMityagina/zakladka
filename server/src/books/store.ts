import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BOOKS_ROOT } from './paths.js';
import type { Book, BookMeta, Digest, Progress } from '../types.js';
import { isExtra, leadingExtras } from './extra.js';
import { byVolume, getPrequelIds, savePrequelIds, seriesOf, suggestPrequels, toRef } from './series.js';

/**
 * Простое файловое хранилище: .cache/books/<id>/{book.json, progress.json, digests/<глава>.json}.
 * Для локального приложения одного читателя БД избыточна.
 */
const ROOT = BOOKS_ROOT;
const dir = (id: string) => join(ROOT, id);

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

const books = new Map<string, Book>();

export async function saveBook(book: Book) {
  books.set(book.id, book);
  await writeJson(join(dir(book.id), 'book.json'), book);
}

export async function getBook(id: string): Promise<Book> {
  if (!/^[a-f0-9]{12}$/.test(id)) throw Object.assign(new Error('Некорректный id книги'), { status: 400 });
  const cached = books.get(id) ?? (await readJson<Book>(join(dir(id), 'book.json')));
  if (!cached) throw Object.assign(new Error('Книга не найдена'), { status: 404 });
  books.set(id, cached);
  return cached;
}

export const getDigest = (id: string, chapter: number) =>
  readJson<Digest>(join(dir(id), 'digests', `${chapter}.json`));

export const saveDigest = (id: string, d: Digest) => writeJson(join(dir(id), 'digests', `${d.chapter}.json`), d);

export async function digestedChapters(id: string): Promise<number[]> {
  try {
    return (await readdir(join(dir(id), 'digests')))
      .map((f) => Number(f.replace('.json', '')))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function getProgress(id: string): Promise<Progress> {
  const saved = await readJson<Progress>(join(dir(id), 'progress.json'));
  if (saved) return saved;
  const book = await getBook(id).catch(() => undefined);
  return { upTo: Math.max(1, book ? leadingExtras(book.chapters) : 1), mistakes: [] };
}

export const saveProgress = (id: string, p: Progress) => writeJson(join(dir(id), 'progress.json'), p);

export async function allBooks(): Promise<Book[]> {
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    return [];
  }
  const list = await Promise.all(ids.map((id) => getBook(id).catch(() => undefined)));
  return list.filter((b): b is Book => !!b);
}

/** Предыдущие тома по порядку чтения; удалённые из библиотеки — пропускаются */
export async function getPrequels(id: string): Promise<Book[]> {
  const ids = await getPrequelIds(id);
  const list = await Promise.all(ids.map((p) => getBook(p).catch(() => undefined)));
  return byVolume(list.filter((b): b is Book => !!b).map((b) => ({ b, number: seriesOf(b)?.number }))).map((x) => x.b);
}

export async function bookMeta(book: Book, library?: Book[]): Promise<BookMeta> {
  const prequels = await getPrequels(book.id);
  const linked = new Set(prequels.map((p) => p.id));
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    chapters: book.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      chars: c.paragraphs.join('').length,
      extra: isExtra(c),
    })),
    digested: await digestedChapters(book.id),
    progress: await getProgress(book.id),
    series: seriesOf(book),
    prequels: prequels.map(toRef),
    prequelSuggestions: suggestPrequels(book, library ?? (await allBooks())).filter((s) => !linked.has(s.id)),
  };
}

/** Удаление книги: папка с текстом, разборами, дневником и прогрессом; ссылки из других томов */
export async function deleteBook(id: string) {
  await getBook(id);
  books.delete(id);
  await rm(dir(id), { recursive: true, force: true });
  for (const other of await allBooks()) {
    const ids = await getPrequelIds(other.id);
    if (ids.includes(id)) await savePrequelIds(other.id, ids.filter((p) => p !== id));
  }
}

export async function listBooks(): Promise<BookMeta[]> {
  const library = await allBooks();
  return Promise.all(library.map((b) => bookMeta(b, library)));
}
