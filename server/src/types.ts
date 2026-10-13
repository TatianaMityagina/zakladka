// --- Книга ---

export interface Chapter {
  /** 0-based порядковый номер; «прочитано N глав» = доступны главы с index < N */
  index: number;
  title: string;
  paragraphs: string[];
}

export interface SeriesInfo {
  name: string;
  /** Номер тома, если известен */
  number?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  format: 'fb2' | 'epub';
  /** Из метаданных файла (FB2 sequence, calibre:series, EPUB3 collection) */
  series?: SeriesInfo;
  chapters: Chapter[];
}

export interface PrequelRef {
  id: string;
  title: string;
  number?: number;
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  format: Book['format'];
  /** extra — служебный раздел (аннотация, глоссарий…): не пересказывается */
  chapters: Array<{ index: number; title: string; chars: number; extra: boolean }>;
  /** Главы, для которых уже есть разбор (пересказ + персонажи) */
  digested: number[];
  progress: Progress;
  series?: SeriesInfo;
  /** Подключённые предыдущие тома — прочитаны целиком, ИИ их учитывает */
  prequels: PrequelRef[];
  /** Книги из библиотеки, похожие на предыдущие тома той же серии */
  prequelSuggestions: PrequelRef[];
}

/** Фрагмент текста для поиска. id вида c3.12 — глава 3, фрагмент 12 */
export interface Chunk {
  id: string;
  chapter: number;
  chapterTitle: string;
  text: string;
  /** Для фрагментов из предыдущих томов: «Том 3» / название книги */
  volume?: string;
}

// --- Разбор главы (LLM, один раз на главу, кэшируется) ---

export interface ChapterCharacter {
  name: string;
  aliases: string[];
  note: string;
}

export interface Digest {
  chapter: number;
  summary: string;
  events: string[];
  characters: ChapterCharacter[];
}

// --- Ответы API ---

export interface Recap {
  upTo: number;
  paragraphs: Array<{ text: string; chapters: number[] }>;
  openThreads: string[];
}

export interface Answer {
  found: boolean;
  answer: string;
  /** Цитаты, на которых основан ответ (только из прочитанных глав) */
  quotes: Chunk[];
  /** Записи дневника читателя, на которые опирается ответ */
  notes: DiaryNoteRef[];
  /** ИИ ответил, но не сослался ни на один реальный фрагмент — ответ может быть неточным */
  unverified?: boolean;
}

export interface Character {
  name: string;
  aliases: string[];
  firstChapter: number;
  /** Том, где персонаж появился впервые (если из предыдущих томов) */
  firstVolume?: string;
  /** Что известно о персонаже по главам — только прочитанным */
  notes: Array<{ chapter: number; note: string; volume?: string }>;
}

export interface QuizQuestion {
  id: string;
  chapter: number;
  question: string;
  answer: string;
  quote?: Chunk;
}

export interface Grade {
  verdict: 'correct' | 'partial' | 'wrong';
  feedback: string;
}

export interface Progress {
  /** Сколько глав прочитано */
  upTo: number;
  /** Вопросы, на которые ответили неверно, — для повторения */
  mistakes: QuizQuestion[];
}

// --- Дневник чтения ---

export interface DiaryQuote {
  text: string;
  /** Глава (с 1), где цитата нашлась в тексте; нет — не нашлась */
  chapter?: number;
  /** Дословно не нашлась, но есть абзац почти со всеми её словами — читатель запомнил неточно */
  approximate?: boolean;
}

export interface DiaryEntry {
  id: string;
  /** YYYY-MM-DD — одна запись на день чтения */
  date: string;
  /** Главы, прочитанные в этот день (с 1, включительно) */
  fromChapter: number;
  toChapter: number;
  /** ИИ: что произошло в этих главах */
  summary?: string;
  /** ИИ задаёт вопросы, читатель отвечает */
  reflections: Array<{ question: string; answer: string }>;
  thoughts: string;
  quotes: DiaryQuote[];
}

export interface DiaryStats {
  readingDays: number;
  /** Дней подряд по сегодня (или по вчера — серия ещё не потеряна) */
  streak: number;
  chaptersThisWeek: number;
  percent: number;
  startedAt?: string;
}

export interface Review {
  text: string;
  /** true — книга дочитана; false — промежуточный */
  final: boolean;
  createdAt: string;
}

export interface Diary {
  entries: DiaryEntry[];
  review?: Review;
  stats: DiaryStats;
}

export interface DiaryNoteRef {
  entryId: string;
  date: string;
  text: string;
}

export interface VolumeSummary {
  bookId: string;
  volume: string;
  text: string;
}
