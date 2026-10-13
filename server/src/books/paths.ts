import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CACHE_DIR — для тестов, чтобы не трогать библиотеку читателя */
export const BOOKS_ROOT = process.env.CACHE_DIR
  ? join(process.env.CACHE_DIR, 'books')
  : join(dirname(fileURLToPath(import.meta.url)), '../../../.cache/books');
