// Типы общие с сервером — одна точка правды для контракта API
import type { Answer, BookMeta, Character, Diary, DiaryEntry, Grade, Progress, QuizQuestion, Recap, Review, VolumeSummary } from '../../server/src/types';

export type { Answer, BookMeta, Character, Chunk, Diary, DiaryEntry, Grade, PrequelRef, QuizQuestion, Recap, Review, VolumeSummary } from '../../server/src/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const post = <T>(url: string, data: unknown, method = 'POST') =>
  request<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const listBooks = () => request<BookMeta[]>('/api/books');
export const llmStatus = () =>
  request<{ provider: 'anthropic' | 'openrouter'; mock: boolean; configured: boolean; problem?: string; main: string; digest: string }>('/api/status');
export const getBook = (id: string) => request<BookMeta>(`/api/books/${id}`);
export const addDemo = () => request<BookMeta>('/api/books/demo', { method: 'POST' });

export const uploadBook = async (file: File) =>
  request<BookMeta>('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: await file.arrayBuffer(),
  });

export const setProgress = (id: string, upTo: number) => post<Progress>(`/api/books/${id}/progress`, { upTo }, 'PUT');

/**
 * Разбор глав 1..upTo по одной — чтобы показывать «читаю главу 3 из 8».
 * Уже разобранные пропускаются; параллельно до 3 глав.
 */
export async function ensureDigests(book: BookMeta, upTo: number, onProgress: (done: number, total: number) => void) {
  const done = new Set(book.digested);
  // Служебные разделы (аннотация, глоссарий) не пересказываются
  const story = book.chapters.slice(0, upTo).filter((c) => !c.extra).map((c) => c.index);
  const missing = story.filter((i) => !done.has(i));
  const total = story.length;
  let finished = total - missing.length;
  onProgress(finished, total);
  const queue = [...missing];
  const worker = async () => {
    for (let ch = queue.shift(); ch !== undefined; ch = queue.shift()) {
      await post(`/api/books/${book.id}/digest/${ch}`, {});
      book.digested.push(ch);
      onProgress(++finished, total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export const getRecap = (id: string, upTo: number, mode: 'short' | 'full') =>
  post<Recap>(`/api/books/${id}/recap`, { upTo, mode });
export const askBook = (id: string, upTo: number, question: string) =>
  post<Answer>(`/api/books/${id}/ask`, { upTo, question });
export const getCharacters = (id: string, upTo: number) =>
  request<Character[]>(`/api/books/${id}/characters?upTo=${upTo}`);
export const getQuiz = (id: string, upTo: number, chapter: number) =>
  post<QuizQuestion[]>(`/api/books/${id}/quiz`, { upTo, chapter });
export const gradeAnswer = (id: string, question: QuizQuestion, answer: string) =>
  post<Grade & { mistakes: number }>(`/api/books/${id}/grade`, { question, answer });

export const getDiary = (id: string) => request<Diary>(`/api/books/${id}/diary`);
export const fillEntry = (id: string, entryId: string) => post<DiaryEntry>(`/api/books/${id}/diary/${entryId}/fill`, {});
export const updateEntry = (
  id: string,
  entryId: string,
  patch: { thoughts?: string; answers?: string[]; quotes?: string[]; summary?: string },
) => post<DiaryEntry>(`/api/books/${id}/diary/${entryId}`, patch, 'PATCH');
export const writeReview = (id: string) => post<Review>(`/api/books/${id}/review`, {});

export const deleteBook = (id: string) => request<{ deleted: string }>(`/api/books/${id}`, { method: 'DELETE' });
export const setPrequels = (id: string, ids: string[]) => post<BookMeta>(`/api/books/${id}/prequels`, { ids }, 'PUT');
export const prequelSummaries = (id: string) => request<VolumeSummary[]>(`/api/books/${id}/prequel-summaries`);
export const volumeSummary = (id: string) => post<VolumeSummary>(`/api/books/${id}/volume-summary`, {});
