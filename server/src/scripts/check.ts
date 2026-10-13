// Проверка без LLM: парсинг книги, нарезка, поиск с фильтром спойлеров.
// npm run check -w server -- [путь к книге] [прочитано глав] [вопрос]
import { readFile } from 'node:fs/promises';
import { parseBook } from '../books/parse.js';
import { chunkBook } from '../books/chunk.js';
import { search } from '../rag/search.js';
import { DEMO_BOOK } from '../demo.js';

const [path = DEMO_BOOK, upToArg = '3', ...q] = process.argv.slice(2);
const book = await parseBook(await readFile(path), path);
const chunks = chunkBook(book);
console.log(`${book.author} — «${book.title}» (${book.format}), глав: ${book.chapters.length}, фрагментов: ${chunks.length}`);
for (const c of book.chapters) console.log(`  ${c.index + 1}. ${c.title} — ${c.paragraphs.join('').length} симв.`);

const query = q.join(' ') || 'Кто такой Пугачёв?';
const upTo = Number(upToArg);
console.log(`\nПоиск «${query}», прочитано глав: ${upTo}`);
for (const r of await search(book, query, upTo, 5)) {
  console.log(`  ${r.score.toFixed(3)} [гл. ${r.chunk.chapter + 1}] ${r.chunk.text.slice(0, 110).replace(/\n/g, ' ')}…`);
}
