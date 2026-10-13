<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { getBook, type BookMeta } from './api';
import Library from './components/Library.vue';
import BookView from './components/BookView.vue';

const book = ref<BookMeta | null>(null);
const restoring = ref(true);

// Открытая книга — в адресе (#book=<id>): обновление страницы не выкидывает в библиотеку
const hashParams = () => new URLSearchParams(location.hash.slice(1));

onMounted(async () => {
  const id = hashParams().get('book');
  if (id) book.value = await getBook(id).catch(() => null);
  restoring.value = false;
});

watch(book, (b) => {
  const p = hashParams();
  if (b) p.set('book', b.id);
  else {
    p.delete('book');
    p.delete('tab');
  }
  history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname);
});
</script>

<template>
  <header class="app-head">
    <h1 @click="book = null"><span class="logo" aria-hidden="true">🔖</span><span class="brand">Закладка</span></h1>
    <p>Помнить сюжет — без спойлеров дальше того места, где вы остановились</p>
  </header>
  <template v-if="!restoring">
    <BookView v-if="book" :key="book.id" :book="book" @back="book = null" />
    <Library v-else @open="book = $event" />
  </template>
</template>
