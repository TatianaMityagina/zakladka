<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { addDemo, deleteBook, listBooks, llmStatus, uploadBook, type BookMeta } from '../api';

const emit = defineEmits<{ open: [BookMeta] }>();
const books = ref<BookMeta[]>([]);
const busy = ref('');
const error = ref('');
const status = ref<Awaited<ReturnType<typeof llmStatus>> | null>(null);

onMounted(async () => {
  llmStatus().then((s) => (status.value = s)).catch(() => {});
  try {
    books.value = await listBooks();
  } catch (e) {
    error.value = (e as Error).message;
  }
});

async function add(fn: () => Promise<BookMeta>, label: string) {
  busy.value = label;
  error.value = '';
  try {
    emit('open', await fn());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function remove(b: BookMeta) {
  if (!confirm(`Удалить «${b.title}»? Удалятся и дневник, и прогресс по этой книге.`)) return;
  try {
    await deleteBook(b.id);
    books.value = books.value.filter((x) => x.id !== b.id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) add(() => uploadBook(file), `Читаю «${file.name}» и строю указатель…`);
}
</script>

<template>
  <main class="library">
    <section class="panel">
      <h2>Добавить книгу</h2>
      <p class="muted">FB2, FB2.zip или EPUB. Книга обрабатывается на вашем компьютере; в ИИ уходят только фрагменты прочитанных глав.</p>
      <div class="row">
        <label class="button">
          Выбрать файл
          <input type="file" accept=".fb2,.epub,.zip" hidden :disabled="!!busy" @change="onFile" />
        </label>
        <button class="secondary" :disabled="!!busy" @click="add(addDemo, 'Открываю «Капитанскую дочку»…')">
          Демо: «Капитанская дочка»
        </button>
      </div>
      <div v-if="busy" class="digest-progress">
        <p class="muted small">{{ busy }} Первый раз может занять минуту.</p>
        <span class="progress-bar indeterminate"><span style="width: 100%" /></span>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <p v-if="status" class="muted small llm-status">
      <template v-if="status.mock">ИИ: mock-режим (без настоящей модели)</template>
      <template v-else-if="!status.configured">⚠️ ИИ ({{ status.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter' }}) не настроен: {{ status.problem }}</template>
      <template v-else>ИИ: {{ status.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter' }} · {{ status.main }} · главы — {{ status.digest }}</template>
    </p>

    <section v-if="books.length" class="panel">
      <h2>Мои книги</h2>
      <TransitionGroup tag="ul" name="list" class="books">
        <li v-for="b in books" :key="b.id" @click="emit('open', b)">
          <span class="row">
            <b>{{ b.title }}</b>
            <button class="link small danger" title="Удалить книгу" @click.stop="remove(b)">Удалить</button>
          </span>
          <span class="muted">
            {{ b.author }}<template v-if="b.series"> · серия «{{ b.series.name }}»<template v-if="b.series.number">, том {{ b.series.number }}</template></template>
          </span>
          <span class="progress-bar"><span :style="{ width: `${(b.progress.upTo / b.chapters.length) * 100}%` }" /></span>
          <span class="muted">прочитано {{ b.progress.upTo }} из {{ b.chapters.length }} глав</span>
        </li>
      </TransitionGroup>
    </section>
  </main>
</template>
