import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** «Капитанская дочка» — общественное достояние, текст из Викисклада (издание 1960 г.) */
export const DEMO_BOOK = join(dirname(fileURLToPath(import.meta.url)), '../../demo-data/kapitanskaya-dochka.fb2');
