<script setup lang="ts">
import { computed, ref } from 'vue';
import { getQuiz, gradeAnswer, type BookMeta, type Chunk, type Grade, type QuizQuestion } from '../api';
import Skeleton from './Skeleton.vue';

const props = defineProps<{ book: BookMeta; upTo: number }>();
const emit = defineEmits<{ quotes: [Chunk[], boolean?] }>();

interface Item {
  q: QuizQuestion;
  answer: string;
  grade?: Grade;
  checking?: boolean;
}

const readChapters = computed(() => props.book.chapters.slice(0, props.upTo).filter((c) => !c.extra));
const chapter = ref(readChapters.value.at(-1)?.index ?? 0);
const items = ref<Item[]>([]);
const loading = ref(false);
const error = ref('');
const mistakes = ref(props.book.progress.mistakes.length);
const source = ref<'chapter' | 'mistakes'>('chapter');


async function loadChapter() {
  source.value = 'chapter';
  loading.value = true;
  error.value = '';
  items.value = [];
  try {
    items.value = (await getQuiz(props.book.id, props.upTo, chapter.value)).map((q) => ({ q, answer: '' }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function loadMistakes() {
  source.value = 'mistakes';
  error.value = '';
  // Повторяем только по прочитанным главам — если читатель «откатил» закладку
  const fresh = await fetch(`/api/books/${props.book.id}`).then((r) => r.json());
  items.value = (fresh.progress.mistakes as QuizQuestion[])
    .filter((q) => q.chapter <= props.upTo)
    .map((q) => ({ q, answer: '' }));
}

async function check(item: Item) {
  item.checking = true;
  try {
    const res = await gradeAnswer(props.book.id, item.q, item.answer);
    item.grade = res;
    mistakes.value = res.mistakes;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    item.checking = false;
  }
}

const VERDICT = { correct: '✅ Верно', partial: '🟡 Почти', wrong: '❌ Не совсем' } as const;
const score = computed(() => items.value.filter((i) => i.grade?.verdict === 'correct').length);
</script>

<template>
  <div>
    <div class="row">
      <h3>Проверь себя</h3>
      <span class="row">
        <select v-model="chapter">
          <option v-for="c in readChapters" :key="c.index" :value="c.index">{{ c.index + 1 }}. {{ c.title }}</option>
        </select>
        <button :disabled="loading || !readChapters.length" @click="loadChapter">Вопросы по главе</button>
        <button class="secondary" :disabled="!mistakes" @click="loadMistakes">Повторить ошибки ({{ mistakes }})</button>
      </span>
    </div>

    <Skeleton v-if="loading" label="Придумываю вопросы…" />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!items.length && !loading && source === 'chapter'" class="muted">
      Выберите главу — ИИ задаст 4 вопроса по сюжету и проверит ответы. Ошибки сохраняются, чтобы повторить их позже.
    </p>
    <p v-if="items.some((i) => i.grade)" class="muted">Верно: {{ score }} из {{ items.length }}</p>

    <TransitionGroup name="list">
    <div v-for="item in items" :key="item.q.id" class="quiz-item">
      <p class="q"><span class="chip">гл. {{ item.q.chapter }}</span> {{ item.q.question }}</p>
      <form class="row" @submit.prevent="check(item)">
        <input v-model="item.answer" type="text" placeholder="Ваш ответ (или «не помню»)" :disabled="!!item.grade" />
        <button v-if="!item.grade" :disabled="item.checking">{{ item.checking ? '…' : 'Проверить' }}</button>
      </form>
      <div v-if="item.grade" :class="['grade', item.grade.verdict]">
        <b>{{ VERDICT[item.grade.verdict] }}</b> {{ item.grade.feedback }}
        <button v-if="item.q.quote" class="link small" @click="emit('quotes', [item.q.quote], true)">Где это в тексте</button>
      </div>
    </div>
    </TransitionGroup>
  </div>
</template>
