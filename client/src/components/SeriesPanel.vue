<script setup lang="ts">
import { computed, ref } from 'vue';
import { listBooks, setPrequels, uploadBook, type BookMeta, type PrequelRef } from '../api';

const props = defineProps<{ book: BookMeta }>();
const emit = defineEmits<{ changed: [BookMeta] }>();

const editing = ref(false);
const library = ref<BookMeta[]>([]);
const selected = ref<Set<string>>(new Set());
const busy = ref('');
const error = ref('');

const label = (p: PrequelRef) => (p.number ? `Том ${p.number}` : `«${p.title}»`);

async function save(ids: string[]) {
  busy.value = 'Сохраняю…';
  error.value = '';
  try {
    emit('changed', await setPrequels(props.book.id, ids));
    editing.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

const acceptSuggestions = () =>
  save([...props.book.prequels.map((p) => p.id), ...props.book.prequelSuggestions.map((p) => p.id)]);

async function openPicker() {
  editing.value = true;
  selected.value = new Set(props.book.prequels.map((p) => p.id));
  library.value = (await listBooks()).filter((b) => b.id !== props.book.id);
}

function toggle(id: string) {
  const s = new Set(selected.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  selected.value = s;
}

/** Загрузить том прямо отсюда — сразу отмечается как предыдущий */
async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = `Читаю «${file.name}»…`;
  error.value = '';
  try {
    const meta = await uploadBook(file);
    library.value = [...library.value.filter((b) => b.id !== meta.id), meta];
    toggle(meta.id);
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = '';
  }
}

const sortedLibrary = computed(() =>
  [...library.value].sort((a, b) => (a.series?.number ?? 999) - (b.series?.number ?? 999) || a.title.localeCompare(b.title)),
);
</script>

<template>
  <div class="series">
    <p v-if="book.series" class="small">
      📚 Серия «{{ book.series.name }}»<template v-if="book.series.number">, том {{ book.series.number }}</template>
    </p>

    <p v-if="book.prequels.length" class="small">
      Прочитаны раньше: {{ book.prequels.map(label).join(', ') }} — ИИ их учитывает.
    </p>

    <div v-if="book.prequelSuggestions.length && !editing" class="suggest small">
      В библиотеке есть {{ book.prequelSuggestions.map(label).join(', ') }} этой серии.
      <button class="link small" :disabled="!!busy" @click="acceptSuggestions">Учитывать как прочитанные</button>
    </div>

    <button v-if="!editing" class="link small" @click="openPicker">
      {{ book.prequels.length ? 'Изменить предыдущие тома' : 'Это не первый том? Добавить предыдущие' }}
    </button>

    <div v-else class="picker">
      <p class="small"><b>Какие книги вы уже прочитали до этой?</b></p>
      <label v-for="b in sortedLibrary" :key="b.id" class="check small">
        <input type="checkbox" :checked="selected.has(b.id)" @change="toggle(b.id)" />
        {{ b.title }}
      </label>
      <p v-if="!library.length" class="muted small">В библиотеке больше нет книг — загрузите предыдущий том.</p>
      <label class="button small-btn">
        + Загрузить том
        <input type="file" accept=".fb2,.epub,.zip" hidden :disabled="!!busy" @change="onFile" />
      </label>
      <div class="row">
        <button class="small-btn" :disabled="!!busy" @click="save([...selected])">Сохранить</button>
        <button class="link small" @click="editing = false">Отмена</button>
      </div>
    </div>
    <p v-if="busy" class="muted small">{{ busy }}</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>
