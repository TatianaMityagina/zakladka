<script setup lang="ts">
import { ref } from 'vue';
import { askBook, type Answer, type BookMeta, type Chunk } from '../api';
import Skeleton from './Skeleton.vue';

const props = defineProps<{ book: BookMeta; upTo: number }>();
const emit = defineEmits<{ quotes: [Chunk[], boolean?] }>();

const question = ref('');
const history = ref<Array<{ q: string; a?: Answer; error?: string }>>([]);
const loading = ref(false);

const EXAMPLES = ['Почему герой оказался здесь?', 'Кто главные герои?', 'Что я думала о главном герое?'];

async function send(q = question.value) {
  if (!q.trim() || loading.value) return;
  question.value = '';
  history.value.unshift({ q });
  loading.value = true;
  try {
    const a = await askBook(props.book.id, props.upTo, q);
    history.value[0].a = a;
    emit('quotes', a.quotes);
  } catch (e) {
    history.value[0].error = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h3>Спросить о прочитанном</h3>
    <form class="row" @submit.prevent="send()">
      <input v-model="question" type="text" placeholder="Например: почему они поссорились?" :disabled="loading" />
      <button :disabled="loading || !question.trim()">Спросить</button>
    </form>
    <p v-if="!history.length" class="muted small">
      Попробуйте:
      <button v-for="e in EXAMPLES" :key="e" class="link" @click="send(e)">«{{ e }}»</button>
    </p>

    <TransitionGroup name="list">
    <div v-for="h in history" :key="h.q + history.indexOf(h)" class="qa">
      <p class="q">{{ h.q }}</p>
      <p v-if="h.error" class="error">{{ h.error }}</p>
      <Skeleton v-else-if="!h.a" label="Ищу в прочитанных главах…" :lines="2" />
      <template v-else>
        <p :class="{ muted: !h.a.found }">{{ h.a.answer }}</p>
        <p v-if="h.a.unverified" class="unverified small">⚠️ ИИ не привёл цитату из книги — ответ может быть неточным.</p>
        <div v-for="n in h.a.notes" :key="n.entryId" class="note-ref">
          📔 Из вашего дневника, {{ n.date.split('-').reverse().join('.') }}: <i>{{ n.text.split('\n')[0] }}</i>
        </div>
        <button v-if="h.a.quotes.length" class="link small" @click="emit('quotes', h.a.quotes, true)">
          Цитаты: {{ h.a.quotes.map((q) => `${q.volume ? `${q.volume}, ` : ''}гл. ${q.chapter + 1}`).join('; ') }}
        </button>
      </template>
    </div>
    </TransitionGroup>
  </div>
</template>
