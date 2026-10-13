import JSZip from 'jszip';
import { parse, type HTMLElement } from 'node-html-parser';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { Book, Chapter, SeriesInfo } from '../types.js';
import { seriesFromTitle } from './series.js';

/** Короче этого «глава» — скорее обложка, оглавление или посвящение */
const MIN_CHAPTER_CHARS = 300;

const clean = (s: string) =>
  s
    .replace(/&nbsp;| /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * FB2 часто лежит в windows-1251 (старые библиотеки). Кодировку берём из XML-декларации,
 * иначе кириллица превратится в «Ð¡Ð°Ð²ÐµÐ»ÑŒÐ¸Ñ‡».
 */
function decodeXml(buf: Buffer): string {
  const head = buf.subarray(0, 200).toString('latin1');
  const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase() ?? 'utf-8';
  return new TextDecoder(enc).decode(buf);
}

function text(el: HTMLElement | null | undefined) {
  return el ? clean(el.textContent) : '';
}

const childrenByTag = (el: HTMLElement, tag: string) =>
  el.childNodes.filter((n): n is HTMLElement => (n as HTMLElement).tagName === tag);

/** dc:title / dc:creator: двоеточие в CSS-селекторе node-html-parser не понимает */
const firstByTag = (root: HTMLElement, ...tags: string[]) =>
  tags.map((t) => root.getElementsByTagName(t)[0]).find(Boolean);

// --- FB2 ---

function parseFb2(xml: string): Omit<Book, 'id'> {
  const root = parse(xml, { lowerCaseTagName: true });
  const info = root.querySelector('title-info');
  const author = info?.querySelector('author');
  const authorName = [author?.querySelector('first-name'), author?.querySelector('last-name')]
    .map(text)
    .filter(Boolean)
    .join(' ');

  // Первый body без name — основной текст; body name="notes" — сноски
  const body = root.querySelectorAll('body').find((b) => !b.getAttribute('name')) ?? root.querySelector('body');
  const chapters: Chapter[] = [];

  /**
   * Главы — «листовые» секции (без вложенных). Заголовки родителей добавляем
   * («Часть первая · Глава I»), иначе в «Войне и мире» будет 15 разных «Глава I».
   */
  const walk = (section: HTMLElement, parents: string[]) => {
    const title = text(childrenByTag(section, 'TITLE')[0]);
    const children = childrenByTag(section, 'SECTION');
    const path = title ? [...parents, title] : parents;
    if (children.length) {
      children.forEach((c) => walk(c, path));
      return;
    }
    const paragraphs = section
      .querySelectorAll('p, v, subtitle, text-author')
      .filter((p) => !p.closest('title'))
      .map(text)
      .filter(Boolean);
    chapters.push({ index: chapters.length, title: path.join(' · ') || `Глава ${chapters.length + 1}`, paragraphs });
  };
  (body ? childrenByTag(body, 'SECTION') : []).forEach((s) => walk(s, []));

  // <sequence name="Монолог фармацевта" number="5"/>
  const seq = info?.querySelector('sequence');
  const series: SeriesInfo | undefined = seq?.getAttribute('name')
    ? { name: seq.getAttribute('name')!.trim(), number: Number(seq.getAttribute('number')) || undefined }
    : undefined;

  return {
    title: text(info?.querySelector('book-title')) || 'Без названия',
    author: authorName || 'Неизвестный автор',
    format: 'fb2',
    series,
    chapters,
  };
}

// --- EPUB ---

async function parseEpub(zip: JSZip): Promise<Omit<Book, 'id'>> {
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('EPUB повреждён: нет META-INF/container.xml');
  const opf = parse((await zip.file(opfPath)?.async('string')) ?? '', { lowerCaseTagName: true });
  const base = posix.dirname(opfPath);

  const manifest = new Map(
    opf.querySelectorAll('manifest > item').map((i) => [i.getAttribute('id'), i.getAttribute('href') ?? '']),
  );
  const spine = opf.querySelectorAll('spine > itemref').map((r) => manifest.get(r.getAttribute('idref')) ?? '');

  const chapters: Chapter[] = [];
  for (const href of spine) {
    const path = posix.normalize(posix.join(base, decodeURIComponent(href.split('#')[0])));
    const html = await zip.file(path)?.async('string');
    if (!html) continue;
    const doc = parse(html, { lowerCaseTagName: true });
    const paragraphs = doc
      .querySelectorAll('p, blockquote, li')
      .filter((p) => !p.querySelector('p'))
      .map(text)
      .filter(Boolean);
    if (paragraphs.join('').length < MIN_CHAPTER_CHARS) continue;
    const title = text(doc.querySelector('h1, h2, h3')) || text(doc.querySelector('title')) || `Глава ${chapters.length + 1}`;
    chapters.push({ index: chapters.length, title, paragraphs });
  }

  return {
    title: text(firstByTag(opf, 'dc:title', 'title')) || 'Без названия',
    author: text(firstByTag(opf, 'dc:creator', 'creator')) || 'Неизвестный автор',
    format: 'epub',
    series: epubSeries(opf),
    chapters,
  };
}

/** Серия в EPUB: calibre:series (EPUB2) или belongs-to-collection + group-position (EPUB3) */
function epubSeries(opf: HTMLElement): SeriesInfo | undefined {
  const metas = opf.getElementsByTagName('meta');
  const byName = (n: string) => metas.find((m) => m.getAttribute('name') === n)?.getAttribute('content')?.trim();
  const calibre = byName('calibre:series');
  if (calibre) return { name: calibre, number: Number(byName('calibre:series_index')) || undefined };
  const coll = metas.find((m) => m.getAttribute('property') === 'belongs-to-collection');
  if (coll) {
    const id = coll.getAttribute('id');
    const pos = metas.find((m) => m.getAttribute('property') === 'group-position' && m.getAttribute('refines') === `#${id}`);
    return { name: text(coll), number: Number(text(pos)) || undefined };
  }
  return undefined;
}

/** FB2, FB2 в zip (.fb2.zip — так раздают многие библиотеки) или EPUB */
export async function parseBook(buf: Buffer, filename: string): Promise<Book> {
  const isZip = buf.subarray(0, 2).toString('latin1') === 'PK';
  let parsed: Omit<Book, 'id'>;

  if (isZip) {
    const zip = await JSZip.loadAsync(buf);
    if (zip.file('META-INF/container.xml')) {
      parsed = await parseEpub(zip);
    } else {
      const fb2 = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.fb2'));
      if (!fb2) throw new Error('В архиве нет ни EPUB, ни FB2');
      parsed = parseFb2(decodeXml(await fb2.async('nodebuffer')));
    }
  } else if (/<FictionBook/i.test(buf.subarray(0, 2000).toString('latin1'))) {
    parsed = parseFb2(decodeXml(buf));
  } else {
    throw new Error(`Не похоже на FB2 или EPUB: ${filename}. Поддерживаются .fb2, .fb2.zip, .epub`);
  }

  parsed.chapters = parsed.chapters
    .filter((c) => c.paragraphs.join('').length >= MIN_CHAPTER_CHARS)
    .map((c, index) => ({ ...c, index }));
  if (!parsed.chapters.length) throw new Error('Не удалось найти главы с текстом');

  parsed.series ??= seriesFromTitle(parsed.title);

  // id от содержимого: та же книга, загруженная повторно, не индексируется заново
  const id = createHash('sha1').update(buf).digest('hex').slice(0, 12);
  return { id, ...parsed };
}
