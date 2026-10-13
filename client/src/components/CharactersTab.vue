<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ensureDigests, getCharacters, type BookMeta, type Character } from '../api';
import Progress from './Progress.vue';
import Skeleton from './Skeleton.vue';

const props = defineProps<{ book: BookMeta; upTo: number }>();
const list = ref<Character[]>([]);
const progress = ref<{ done: number; total: number } | null>(null);
const loading = ref(true);
const error = ref('');
const filter = ref('');
const open = ref<string | null>(null);

onMounted(async () => {
  try {
    await ensureDigests(props.book, props.upTo, (done, total) => (progress.value = { done, total }));
    list.value = await getCharacters(props.book.id, props.upTo);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
    progress.value = null;
  }
});

const shown = computed(() => {
  const f = filter.value.trim().toLowerCase().replace(/ё/g, 'е');
  if (!f) return list.value;
  return list.value.filter((c) =>
    [c.name, ...c.aliases].some((n) => n.toLowerCase().replace(/ё/g, 'е').includes(f)),
  );
});
</script>

<template>
  <div>
    <div class="row">
      <h3>Кто есть кто (главы 1–{{ upTo }})</h3>
      <input v-model="filter" type="search" placeholder="Найти по имени…" />
    </div>
    <Progress v-if="progress && progress.done < progress.total" v-bind="progress" label="Читаю главу" />
    <Skeleton v-else-if="loading" label="Собираю персонажей…" />
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!loading && !shown.length && !error" class="muted">Никого не нашлось.</p>
    <p v-if="book.prequels.length && !loading" class="muted small">
      Персонажи прошлых томов появятся после «Напомнить прошлые тома» во вкладке «Что было».
    </p>

    <TransitionGroup tag="ul" name="list" class="characters">
      <li v-for="c in shown" :key="c.name" :class="{ open: open === c.name }" @click="open = open === c.name ? null : c.name">
        <div class="char-head">
          <b>{{ c.name }}</b>
          <span class="muted small">
            с {{ c.firstVolume ? `${c.firstVolume.toLowerCase()}, ` : '' }}гл. {{ c.firstChapter }} · упоминаний: {{ c.notes.length }}
          </span>
        </div>
        <p v-if="c.aliases.length" class="muted small">Также: {{ c.aliases.join(', ') }}</p>
        <p>{{ c.notes[c.notes.length - 1].note }}</p>
        <ol v-if="open === c.name" class="timeline">
          <li v-for="n in c.notes" :key="(n.volume ?? '') + n.chapter + n.note">
            <span class="chip">{{ n.volume ? `${n.volume}, ` : '' }}гл. {{ n.chapter }}</span> {{ n.note }}
          </li>
        </ol>
      </li>
    </TransitionGroup>
  </div>
</template>
