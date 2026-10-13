# README.dev — для разработчиков и ИИ-агентов

## Стек
- npm workspaces: `server/` (Node 24, TS, Express 5, ESM) и `client/` (Vue 3 `<script setup>`, Vite, порт 5174)
- LLM: `ai/llm.ts` — переключатель `LLM_PROVIDER`; `ai/openrouter.ts` (OpenAI SDK → OpenRouter) и `ai/anthropic.ts` (`@anthropic-ai/sdk`). По две модели: основная и для разбора глав
- Эмбеддинги: `@huggingface/transformers`, `Xenova/multilingual-e5-small`

## Структура
```
server/src/
  types.ts            # контракт API — клиент импортирует типы отсюда
  index.ts            # маршруты /api/books/...
  books/parse.ts      # FB2 (+windows-1251, +zip), EPUB (OPF spine)
  books/chunk.ts      # фрагменты внутри главы
  books/store.ts      # .cache/books/<id>/{book.json, progress.json, digests/N.json}
  rag/                # embed.ts (кэш .cache/embeddings.json), lexical.ts, search.ts (фильтр upTo)
  ai/prompts.ts       # все промпты, общее правило NO_SPOILERS
  ai/features.ts      # digest, recap, ask (+заметки дневника), characters (склейка — код), quiz, grade
  ai/diary.ts         # запись сессии (пересказ + вопросы), отзыв из записей
  books/diary.ts      # .cache/books/<id>/diary.json, авто-запись при сдвиге закладки, статистика, поиск цитаты
  books/extra.ts      # служебные разделы (аннотация, глоссарий…) — не пересказываются
  books/series.ts     # серия (метаданные / «Том N»), предыдущие тома: series.json
  books/paths.ts      # корень кэша, CACHE_DIR для тестов
  scripts/check.ts    # парсинг + поиск без LLM
client/src/
  App.vue, api.ts, style.css (тема, адаптив, анимации)
  components/{Library,BookView,SeriesPanel,RecapTab,CharactersTab,AskTab,QuizTab,DiaryTab,Progress,Skeleton}.vue
demo-data/            # «Капитанская дочка» в FB2 (общественное достояние)
```

## Инварианты (не ломать)
- `upTo` = число прочитанных глав; доступны главы с `index < upTo`. Нумерация в UI и промптах — с 1.
- Фрагмент не пересекает главу (иначе фильтр спойлеров течёт).
- Разбор главы (`/digest/:n`) — только для `n < progress.upTo`.
- Любые id цитат и номера глав из ответа LLM проверяются кодом.
- Записи дневника с `toChapter > upTo` не показываются ИИ.
- Mock-режим ничего не пишет в кэш; для тестов — `CACHE_DIR=/tmp/...`.

## Команды
```
npm run dev | npm run build | npm run typecheck
npm run check -w server -- [книга] [прочитано глав] [вопрос]   # без LLM
```

## Переменные окружения (`.env` в корне)
```
OPENROUTER_API_KEY=
LLM_MODEL=
DIGEST_MODEL=
LLM_MAX_TOKENS=
LLM_PROVIDER=    # openrouter | anthropic (не задан — по наличию ключа)
ANTHROPIC_API_KEY= ANTHROPIC_MODEL= ANTHROPIC_DIGEST_MODEL= ANTHROPIC_EFFORT= ANTHROPIC_MAX_TOKENS=
LLM_MODE=        # mock — без LLM
CACHE_DIR=       # другая папка кэша (тесты)
PORT=
```
