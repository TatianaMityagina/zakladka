import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Мультиязычная модель, работает локально: индексация книги бесплатна и не зависит от сети.
 * e5 требует префиксы «query: » / «passage: ».
 */
const MODEL = 'Xenova/multilingual-e5-small';
const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../../.cache/embeddings.json');

let extractor: Promise<FeatureExtractionPipeline> | undefined;
let cache: Record<string, number[]> | undefined;

async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache!;
}

async function saveCache() {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache));
}

const BATCH = 32;

export async function embed(
  texts: string[],
  mode: 'query' | 'passage',
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const store = await loadCache();
  const inputs = texts.map((t) => `${mode}: ${t}`);
  const keys = inputs.map((t) => createHash('sha1').update(MODEL + t).digest('hex'));
  const missing = [...new Set(inputs.filter((_, i) => !store[keys[i]]))];

  if (missing.length) {
    // Явный generic — иначе tsc падает на «union type too complex» у перегрузок pipeline()
    extractor ??= (pipeline as (task: 'feature-extraction', model: string, opts: object) => Promise<FeatureExtractionPipeline>)(
      'feature-extraction',
      MODEL,
      { dtype: 'q8' },
    );
    const model = await extractor;
    // Книга — сотни и тысячи фрагментов: батчами, чтобы не съесть память и показывать прогресс
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const vectors = (await model(batch, { pooling: 'mean', normalize: true })).tolist() as number[][];
      batch.forEach((text, j) => (store[createHash('sha1').update(MODEL + text).digest('hex')] = vectors[j]));
      onProgress?.(Math.min(i + BATCH, missing.length), missing.length);
    }
    await saveCache();
  }
  return keys.map((k) => store[k]);
}

/** Векторы нормализованы, поэтому косинус = скалярное произведение */
export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
