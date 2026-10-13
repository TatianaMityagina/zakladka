<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fillEntry, getDiary, updateEntry, writeReview, type BookMeta, type Diary, type DiaryEntry } from '../api';
import Skeleton from './Skeleton.vue';

const props = defineProps<{ book: BookMeta; upTo: number }>();
const diary = ref<Diary | null>(null);
const error = ref('');
const filling = ref<Set<string>>(new Set());
const reviewing = ref(false);
const newQuote = ref<Record<string, string>>({});
const saved = ref<Record<string, boolean>>({});
/** Пересказ ИИ, который читатель сейчас правит: id записи → черновик */
const editing = ref<Record<string, string>>({});

async function saveSummary(e: DiaryEntry) {
  await save(e, { summary: editing.value[e.id] });
  delete editing.value[e.id];
}

const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const range = (e: DiaryEntry) => (e.fromChapter === e.toChapter ? `глава ${e.fromChapter}` : `главы ${e.fromChapter}–${e.toChapter}`);

async function load() {
  try {
    diary.value = await getDiary(props.book.id);
    // ИИ-часть дописываем сами для свежей записи — читатель сразу видит, что было
    const latest = diary.value.entries.find((e) => e.toChapter <= props.upTo);
    if (latest && !latest.summary) fill(latest);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function fill(entry: DiaryEntry) {
  filling.value.add(entry.id);
  try {
    Object.assign(entry, await fillEntry(props.book.id, entry.id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    filling.value.delete(entry.id);
  }
}

async function save(entry: DiaryEntry, patch: Parameters<typeof updateEntry>[2]) {
  try {
    Object.assign(entry, await updateEntry(props.book.id, entry.id, patch));
    saved.value[entry.id] = true;
    setTimeout(() => (saved.value[entry.id] = false), 1200);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const saveText = (e: DiaryEntry) => save(e, { thoughts: e.thoughts, answers: e.reflections.map((r) => r.answer) });

function addQuote(e: DiaryEntry) {
  const q = newQuote.value[e.id]?.trim();
  if (!q) return;
  newQuote.value[e.id] = '';
  save(e, { quotes: [...e.quotes.map((x) => x.text), q] });
}

const removeQuote = (e: DiaryEntry, i: number) => save(e, { quotes: e.quotes.filter((_, j) => j !== i).map((x) => x.text) });

async function review() {
  reviewing.value = true;
  error.value = '';
  try {
    diary.value!.review = await writeReview(props.book.id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    reviewing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="diary">
    <div class="stats">
      <div><b>{{ diary.stats.percent }}%</b><span>прочитано</span></div>
      <div><b>{{ diary.stats.readingDays }}</b><span>дней чтения</span></div>
      <div><b>{{ diary.stats.streak }}</b><span>🔥 дней подряд</span></div>
      <div><b>{{ diary.stats.chaptersThisWeek }}</b><span>глав за неделю</span></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="!diary.entries.length" class="muted">
      Записей пока нет. Передвиньте закладку «Я прочитала» вперёд — запись за сегодня появится сама.
    </p>

    <article v-for="e in diary.entries" :key="e.id" class="entry" :class="{ future: e.toChapter > upTo }">
      <header class="row">
        <h3>{{ fmt(e.date) }} · {{ range(e) }}</h3>
        <span v-if="saved[e.id]" class="muted small">сохранено ✓</span>
      </header>

      <p v-if="e.toChapter > upTo" class="muted small">Закладка сейчас раньше этих глав — запись скрыта от ИИ.</p>
      <template v-else>
        <template v-if="e.summary">
          <div v-if="editing[e.id] !== undefined" class="summary-edit">
            <textarea v-model="editing[e.id]" rows="4" />
            <div class="row">
              <button class="small-btn" @click="saveSummary(e)">Сохранить</button>
              <button class="link small" @click="delete editing[e.id]">Отмена</button>
            </div>
          </div>
          <template v-else>
            <p class="summary">{{ e.summary }}</p>
            <p class="summary-actions">
              <button class="link small" @click="editing[e.id] = e.summary ?? ''">✏️ Исправить</button>
              <button class="link small" :disabled="filling.has(e.id)" @click="fill(e)">↻ Переписать</button>
            </p>
          </template>
        </template>
        <Skeleton v-else-if="filling.has(e.id)" label="Вспоминаю, что было в этих главах…" :lines="3" />
        <button v-else class="link small" @click="fill(e)">✨ Написать, что произошло</button>

        <div v-for="(r, i) in e.reflections" :key="i" class="reflection">
          <label>💭 {{ r.question }}</label>
          <textarea v-model="r.answer" rows="2" placeholder="Ваш ответ…" @blur="saveText(e)" />
        </div>
      </template>

      <label class="field">
        <span>Мои мысли</span>
        <textarea v-model="e.thoughts" rows="3" placeholder="Впечатления, догадки, что зацепило…" @blur="saveText(e)" />
      </label>

      <div class="field">
        <span>Цитаты</span>
        <blockquote v-for="(q, i) in e.quotes" :key="i">
          «{{ q.text }}»
          <span class="chip" :title="q.approximate ? 'Дословно не нашлась — похожее место в этой главе' : ''">
            {{ q.chapter ? `${q.approximate ? '≈ ' : ''}гл. ${q.chapter}` : 'не нашлась в тексте' }}
          </span>
          <button class="link small" @click="removeQuote(e, i)">убрать</button>
        </blockquote>
        <form class="row" @submit.prevent="addQuote(e)">
          <input v-model="newQuote[e.id]" type="text" placeholder="Вставьте фразу из книги" />
          <button class="secondary">Добавить</button>
        </form>
      </div>
    </article>

    <section class="review">
      <div class="row">
        <h3>{{ upTo === book.chapters.length ? 'Отзыв о книге' : 'Промежуточный отзыв' }}</h3>
        <button :disabled="reviewing || !diary.entries.length" @click="review">
          {{ reviewing ? 'Собираю из ваших записей…' : diary.review ? 'Пересобрать' : 'Собрать отзыв' }}
        </button>
      </div>
      <p class="muted small">ИИ собирает отзыв только из ваших мыслей, ответов и цитат — не придумывает мнение за вас.</p>
      <div v-if="diary.review" class="review-text">
        <p v-for="(p, i) in diary.review.text.split(/\n+/)" :key="i">{{ p }}</p>
      </div>
    </section>
  </div>
  <p v-else-if="error" class="error">{{ error }}</p>
  <Skeleton v-else label="Открываю дневник…" />
</template>
