<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { setProgress, type BookMeta, type Chunk } from '../api';
import RecapTab from './RecapTab.vue';
import CharactersTab from './CharactersTab.vue';
import AskTab from './AskTab.vue';
import QuizTab from './QuizTab.vue';
import DiaryTab from './DiaryTab.vue';
import SeriesPanel from './SeriesPanel.vue';

const props = defineProps<{ book: BookMeta }>();
const emit = defineEmits<{ back: [] }>();

// reactive-копия: ensureDigests дописывает в digested, вкладки это видят
const book = reactive(props.book);
const upTo = ref(book.progress.upTo);
type Tab = 'recap' | 'characters' | 'ask' | 'quiz' | 'diary';
const TAB_KEYS: Tab[] = ['recap', 'characters', 'ask', 'quiz', 'diary'];
const fromHash = new URLSearchParams(location.hash.slice(1)).get('tab') as Tab | null;
const tab = ref<Tab>(fromHash && TAB_KEYS.includes(fromHash) ? fromHash : 'recap');
watch(tab, (t) => {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('tab', t);
  history.replaceState(null, '', `#${p}`);
});
const quotes = ref<Chunk[]>([]);
/** Шторка цитат на планшете/мобильном; на десктопе колонка видна всегда */
const quotesOpen = ref(false);

const TABS = [
  { key: 'recap', label: 'Что было' },
  { key: 'characters', label: 'Персонажи' },
  { key: 'ask', label: 'Спросить' },
  { key: 'quiz', label: 'Проверь себя' },
  { key: 'diary', label: 'Дневник' },
] as const;

const progressError = ref('');

/**
 * Сначала сохраняем закладку на сервере, потом переключаем вкладки:
 * сервер разбирает только главы до сохранённой закладки, и если вкладка
 * успеет запросить разбор раньше — получит «Эта глава ещё не прочитана».
 */
async function onUpTo(e: Event) {
  const select = e.target as HTMLSelectElement;
  const next = Number(select.value);
  progressError.value = '';
  try {
    await setProgress(book.id, next);
    book.progress.upTo = next;
    upTo.value = next;
    quotes.value = [];
  } catch (err) {
    select.value = String(upTo.value);
    progressError.value = (err as Error).message;
  }
}

// Esc закрывает шторку цитат (планшет с клавиатурой, десктоп в узком окне)
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') quotesOpen.value = false;
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** open — пользователь сам нажал «Цитаты»; после ответа просто обновляем и мигаем кнопкой */
function showQuotes(q: Chunk[], open = false) {
  quotes.value = q;
  if (open) quotesOpen.value = true;
}
</script>

<template>
  <main class="book">
    <section class="panel book-head">
      <button class="link" @click="emit('back')">← Все книги</button>
      <h2>{{ book.title }}</h2>
      <p class="muted">{{ book.author }}</p>
      <label class="field">
        <span>Я прочитала</span>
        <select :value="upTo" @change="onUpTo">
          <option v-for="c in book.chapters" :key="c.index" :value="c.index + 1">
            {{ c.index + 1 }}. {{ c.title }}{{ c.extra ? ' (вступление/служебное)' : '' }}
          </option>
        </select>
      </label>
      <p v-if="progressError" class="error">{{ progressError }}</p>
      <p class="muted small">🔒 ИИ видит только главы 1–{{ upTo }}. Дальше — ни слова.</p>
      <SeriesPanel :book="book" @changed="Object.assign(book, $event)" />
    </section>

    <section class="panel main-col">
      <nav class="tabs">
        <button v-for="t in TABS" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">
          {{ t.label }}
        </button>
      </nav>
      <Transition name="tab" mode="out-in">
      <KeepAlive>
        <RecapTab v-if="tab === 'recap'" :key="`r${upTo}:${book.prequels.length}`" :book="book" :up-to="upTo" />
        <CharactersTab v-else-if="tab === 'characters'" :key="`c${upTo}:${book.prequels.length}`" :book="book" :up-to="upTo" />
        <AskTab v-else-if="tab === 'ask'" :key="`a${upTo}`" :book="book" :up-to="upTo" @quotes="showQuotes" />
        <QuizTab v-else-if="tab === 'quiz'" :key="`q${upTo}`" :book="book" :up-to="upTo" @quotes="showQuotes" />
        <DiaryTab v-else :key="`d${upTo}`" :book="book" :up-to="upTo" />
      </KeepAlive>
      </Transition>
    </section>

    <button v-if="quotes.length && !quotesOpen" :key="quotes[0].id" class="quotes-fab" @click="quotesOpen = true">
      ❝ Цитаты · {{ quotes.length }}
    </button>
    <div v-if="quotesOpen" class="backdrop" @click="quotesOpen = false" />
    <aside class="panel quotes" :class="{ open: quotesOpen }">
      <button class="secondary sheet-close" aria-label="Закрыть" @click="quotesOpen = false">✕</button>
      <h2>Цитаты из книги</h2>
      <p v-if="!quotes.length" class="muted">Здесь появятся фрагменты текста, на которых основан ответ.</p>
      <TransitionGroup name="list">
      <article v-for="q in quotes" :key="q.id" class="quote">
        <header>{{ q.volume ? `${q.volume} · ` : '' }}{{ q.chapterTitle }}</header>
        <p v-for="(line, i) in q.text.split('\n')" :key="i">{{ line }}</p>
      </article>
      </TransitionGroup>
    </aside>
  </main>
</template>
