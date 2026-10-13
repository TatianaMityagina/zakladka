<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ensureDigests, getBook, getRecap, prequelSummaries, volumeSummary, type BookMeta, type Recap, type VolumeSummary } from '../api';
import Progress from './Progress.vue';
import Skeleton from './Skeleton.vue';

const props = defineProps<{ book: BookMeta; upTo: number }>();
const mode = ref<'short' | 'full'>('short');
const recap = ref<Recap | null>(null);
const progress = ref<{ done: number; total: number } | null>(null);
const loading = ref(false);
const error = ref('');
const volumes = ref<VolumeSummary[]>([]);
const volumeProgress = ref<{ label: string; done: number; total: number } | null>(null);

const missingVolumes = () => props.book.prequels.filter((p) => !volumes.value.some((v) => v.bookId === p.id));

/** Каждый прошлый том: разбор глав (с прогрессом) → краткое содержание. Один раз, потом из кэша */
async function rememberVolumes() {
  error.value = '';
  try {
    for (const p of missingVolumes()) {
      const meta = await getBook(p.id);
      const label = p.number ? `Том ${p.number}: глава` : `«${p.title}»: глава`;
      await ensureDigests(meta, meta.chapters.length, (done, total) => (volumeProgress.value = { label, done, total }));
      volumeProgress.value = { label: `${label.replace(': глава', '')}: собираю краткое содержание…`, done: 0, total: 0 };
      volumes.value.push(await volumeSummary(p.id));
    }
    volumeProgress.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
    volumeProgress.value = null;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await ensureDigests(props.book, props.upTo, (done, total) => (progress.value = { done, total }));
    progress.value = null;
    recap.value = await getRecap(props.book.id, props.upTo, mode.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
    progress.value = null;
  }
}

function switchMode(m: 'short' | 'full') {
  mode.value = m;
  load();
}

onMounted(async () => {
  if (props.book.prequels.length) volumes.value = await prequelSummaries(props.book.id).catch(() => []);
  load();
});
</script>

<template>
  <div>
    <div class="row">
      <h3>Что было в главах 1–{{ upTo }}</h3>
      <span class="seg">
        <button :class="{ active: mode === 'short' }" :disabled="loading" @click="switchMode('short')">Коротко</button>
        <button :class="{ active: mode === 'full' }" :disabled="loading" @click="switchMode('full')">Подробно</button>
      </span>
    </div>

    <section v-if="book.prequels.length" class="volumes">
      <div class="row">
        <h4>📚 Прошлые тома</h4>
        <button v-if="missingVolumes().length && !volumeProgress" class="secondary" @click="rememberVolumes">
          Напомнить {{ missingVolumes().length === book.prequels.length ? 'прошлые тома' : 'остальные тома' }}
        </button>
      </div>
      <p v-if="missingVolumes().length && !volumeProgress" class="muted small">
        Один раз разберу главы {{ missingVolumes().length }} {{ missingVolumes().length === 1 ? 'тома' : 'томов' }} — это несколько минут и несколько десятков запросов к ИИ.
      </p>
      <Progress
        v-if="volumeProgress && volumeProgress.total"
        :done="volumeProgress.done"
        :total="volumeProgress.total"
        :label="volumeProgress.label"
      />
      <p v-else-if="volumeProgress" class="muted">{{ volumeProgress.label }}</p>
      <details v-for="v in volumes" :key="v.bookId">
        <summary>{{ v.volume }}</summary>
        <p v-for="(t, i) in v.text.split(/\n+/)" :key="i" class="recap-p">{{ t }}</p>
      </details>
    </section>

    <Progress v-if="progress && progress.done < progress.total" v-bind="progress" label="Читаю главу" />
    <Skeleton v-else-if="loading" label="Вспоминаю, что было…" :lines="5" />
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="recap && !loading">
      <p v-for="(p, i) in recap.paragraphs" :key="i" class="recap-p">
        {{ p.text }}
        <span v-for="c in p.chapters" :key="c" class="chip">гл. {{ c }}</span>
      </p>
      <div v-if="recap.openThreads.length" class="threads">
        <h4>Что пока не ясно</h4>
        <ul>
          <li v-for="t in recap.openThreads" :key="t">{{ t }}</li>
        </ul>
      </div>
    </template>
  </div>
</template>
