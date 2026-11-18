<script setup lang="ts">
// The search dialog (`docs/design.md`, 「Search」): the component library's command palette in a modal,
// standing while the address carries a search. Before anything is typed it lists the notes the reader
// opened most recently; a moment after the typing stops it asks the service's search and lists what it
// found — the icon, the title, whose note it is where shared, when it was last edited, and one line of
// the text around the match, the match marked by the layer's list-search marking. A sort and a filter
// dropdown stand under the list. The arrow keys and Enter walk and open the rows; Ctrl or ⌘ held opens a
// row in a new tab and leaves the dialog standing. The dialog takes no step of the back gesture of its
// own: the address's step is its step (`OFF_HISTORY`).

import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceSelect from "bmo-ui/app/components/ChoiceSelect.vue";
import SearchText from "bmo-ui/app/components/SearchText.vue";
import { countLocale } from "bmo-ui/app/domain/numbers";
import { OFF_HISTORY } from "bmo-ui/app/domain/overlays";
import { hitSnippet } from "bmo-ui/shared/search";

import { askOf, asksAnything, emptyFinding, markedTerm, SEARCH_SORTS, SEARCH_SPANS } from "../domain/finding";
import { NOTE_MARK } from "../domain/icons";
import { asksNewTab } from "../domain/navigator";

import type { CommandPaletteGroup, CommandPaletteItem, DropdownMenuItem, ModalProps } from "@nuxt/ui";
import type { NoteApi } from "../domain/api";
import type { Finding, SearchSpan } from "../domain/finding";
import type { FoundNote, NoteMeta, SearchSort, SearchView } from "../../shared/types";

const props = defineProps<{
  finding: Finding | null;
  api: NoteApi;
  nameOf: (key: string) => string;
}>();

const emit = defineEmits<{ change: [finding: Finding]; close: []; open: [note: NoteMeta, newTab: boolean] }>();

const i18n = useI18n();

// How long the typing rests before the service is asked, and how many recent notes stand before it is.
const TYPING_REST_MS = 200;
const RECENT_SHOWN = 8;

const open = computed(() => props.finding !== null);
const content = { [OFF_HISTORY]: "" } as ModalProps["content"];

// The finding the dialog shows, held while it closes so its rows do not blink on the way out.
const held = shallowRef<Finding>(props.finding ?? emptyFinding());

watch(
  () => props.finding,
  (finding) => {
    if (finding !== null) held.value = finding;
  }
);

// The words in the field are the field's own while typing, and the address follows them; words the address
// brings from elsewhere — a step of the history, a linked search — are put in the field.
const words = ref(held.value.words);

watch(
  () => props.finding?.words,
  (given) => {
    if (given !== undefined && given !== words.value) words.value = given;
  }
);

watch(words, (typed) => {
  if (props.finding !== null && typed !== props.finding.words) emit("change", { ...props.finding, words: typed });
});

const recent = shallowRef<NoteMeta[]>([]);
const found = shallowRef<FoundNote[]>([]);
const more = ref(false);
const searching = ref(false);
const failed = ref(false);
// The finding the rows standing were found for; rows of an older one are not shown as the newer one's.
const answered = ref<string | null>(null);

let asked = 0;
let resting: ReturnType<typeof setTimeout> | null = null;

async function readRecent(): Promise<void> {
  try {
    recent.value = await props.api.recent(RECENT_SHOWN);
  } catch {
    recent.value = [];
  }
}

function fingerprint(finding: Finding): string {
  return JSON.stringify(finding);
}

async function search(finding: Finding, after = 0): Promise<void> {
  const turn = (asked += 1);

  searching.value = true;

  try {
    const page = await props.api.search(askOf(finding, new Date(), after));

    if (turn !== asked) return;

    found.value = after === 0 ? page.items : [...found.value, ...page.items];
    more.value = page.more;
    failed.value = false;
    answered.value = fingerprint(finding);
  } catch {
    if (turn === asked) {
      failed.value = true;
      answered.value = fingerprint(finding);
    }
  } finally {
    if (turn === asked) searching.value = false;
  }
}

watch(open, (standing) => {
  if (standing) void readRecent();
});

watch(
  () => (props.finding === null ? null : fingerprint(props.finding)),
  (now) => {
    if (resting !== null) clearTimeout(resting);

    resting = null;

    const finding = props.finding;

    if (now === null || finding === null || !asksAnything(finding)) {
      asked += 1;
      searching.value = false;

      return;
    }

    resting = setTimeout(() => {
      resting = null;
      void search(finding);
    }, TYPING_REST_MS);
  },
  { immediate: true }
);

if (open.value) void readRecent();

const typing = computed(() => asksAnything(held.value));

function chosen(note: NoteMeta, event: Event): void {
  const pressed = (event as CustomEvent<{ originalEvent?: MouseEvent | KeyboardEvent }>).detail?.originalEvent ?? (event as MouseEvent);
  const newTab = asksNewTab(pressed);

  if (newTab) event.preventDefault();

  emit("open", note, newTab);
}

function editedOf(note: NoteMeta): string {
  return new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric" }).format(note.changedAt);
}

// How much of the found stretch stands before its mark, and after it, in the row's one line: little before,
// so the mark is in sight on a phone's width as on a desktop's.
const LEAD_CHARS = 12;
const TRAIL_CHARS = 120;

/** The row's line of text around its mark, read by the layer's list search. */
function lineOf(found: FoundNote): string {
  const text = found.snippet?.text ?? "";
  const term = markedTerm(found);

  return term === null ? text : hitSnippet(text, term, TRAIL_CHARS, LEAD_CHARS, countLocale()) || text;
}

function titleOf(note: NoteMeta): string {
  return note.title === "" ? i18n.t("note.label.untitled") : note.title;
}

// Every group lists what it was handed as it stands: the service did the finding, so the palette filters
// nothing of its own.

// A row carries the note it opens, and what the search found of it.
type Row = CommandPaletteItem & { note: NoteMeta; found?: FoundNote };

function rowOf(item: CommandPaletteItem): Row {
  return item as Row;
}

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  if (!typing.value) {
    return [
      {
        id: "recent",
        label: i18n.t("note.search.recent"),
        ignoreFilter: true,
        items: recent.value.map((note) => ({ label: titleOf(note), note, onSelect: (event: Event) => chosen(note, event) }))
      }
    ];
  }

  if (answered.value !== fingerprint(held.value) && found.value.length === 0) return [];

  const rows: Row[] = found.value.map((hit) => ({ label: titleOf(hit), note: hit, found: hit, onSelect: (event: Event) => chosen(hit, event) }));

  return [{ id: "results", label: i18n.t("note.search.results"), items: rows, ignoreFilter: true }];
});

const empty = computed(() => {
  if (!typing.value || searching.value) return "";

  return failed.value ? i18n.t("note.search.failed") : i18n.t("note.search.none");
});

const sortChoices = computed(() => SEARCH_SORTS.map((sort) => ({ label: i18n.t(`note.sort.${sort}`), value: sort })));

function toggledView(view: SearchView, on: boolean): Finding {
  const views = held.value.views.filter((one) => one !== view);

  return { ...held.value, views: on ? [...views, view] : views };
}

const SPAN_WORDS: Record<SearchSpan, string> = { any: "note.search.span_any", today: "note.search.span_today", "7d": "note.search.span_7d", "30d": "note.search.span_30d" };

const filterItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: i18n.t("note.search.title_only"),
      type: "checkbox" as const,
      checked: held.value.titleOnly,
      onUpdateChecked: (checked: boolean) => emit("change", { ...held.value, titleOnly: checked }),
      onSelect: (event: Event) => event.preventDefault()
    }
  ],
  (
    [
      ["mine", "note.search.in_mine"],
      ["shared", "note.search.in_shared"],
      ["trash", "note.search.in_trash"]
    ] as const
  ).map(([view, word]) => ({
    label: i18n.t(word),
    type: "checkbox" as const,
    checked: held.value.views.includes(view),
    onUpdateChecked: (checked: boolean) => emit("change", toggledView(view, checked)),
    onSelect: (event: Event) => event.preventDefault()
  })),
  SEARCH_SPANS.map((span) => ({
    label: i18n.t(SPAN_WORDS[span]),
    type: "checkbox" as const,
    checked: held.value.span === span,
    onSelect: () => emit("change", { ...held.value, span })
  }))
]);

// How many of the filters stand away from their defaults, said on the filter key.
const filtersOn = computed(() => {
  const finding = held.value;
  const views = [...finding.views].sort().join(",");

  return Number(finding.titleOnly) + Number(views !== "mine,shared") + Number(finding.span !== "any");
});

function readMore(): void {
  void search(held.value, found.value.length);
}
</script>

<template>
  <UModal
    :open="open"
    :content="content"
    :title="$t('note.action.search')"
    :ui="{ content: 'max-w-2xl sm:max-h-[min(36rem,80dvh)]', header: 'sr-only' }"
    @update:open="(standing) => { if (!standing) emit('close'); }"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="words"
        :groups="groups"
        :loading="searching"
        icon="i-material-symbols-search"
        :placeholder="$t('note.search.placeholder')"
        :close="false"
        class="min-h-0 flex-1"
        :ui="{ item: 'items-start', itemLeadingIcon: 'size-5' }"
        data-note-search
      >
        <template #item-leading="{ item }">
          <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
            <span v-if="rowOf(item).note.icon !== ''" class="text-base leading-none">{{ rowOf(item).note.icon }}</span>
            <UIcon v-else :name="NOTE_MARK" class="size-4.5 text-dimmed" />
          </span>
        </template>

        <template #item-label="{ item }">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate" :class="rowOf(item).note.title === '' ? 'text-dimmed' : 'text-highlighted'">
              <SearchText v-if="rowOf(item).found !== undefined" :text="titleOf(rowOf(item).note)" :query="markedTerm(rowOf(item).found!)" />
              <template v-else>{{ titleOf(rowOf(item).note) }}</template>
            </span>
            <span v-if="rowOf(item).note.access !== 'owner'" class="shrink-0 truncate text-sm text-muted">{{ props.nameOf(rowOf(item).note.owner) }}</span>
          </span>
        </template>

        <template #item-description="{ item }">
          <span v-if="rowOf(item).found?.snippet" class="block min-w-0 truncate text-sm text-muted">
            <SearchText :text="lineOf(rowOf(item).found!)" :query="markedTerm(rowOf(item).found!)" />
          </span>
        </template>

        <template #item-trailing="{ item }">
          <span class="shrink-0 text-sm tabular-nums text-dimmed">{{ editedOf(rowOf(item).note) }}</span>
        </template>

        <template #empty>
          <p v-if="empty !== ''" class="px-4 py-6 text-center text-sm" :class="failed ? 'text-error' : 'text-muted'">{{ empty }}</p>
          <span v-else />
        </template>

        <template #footer>
          <div class="flex items-center gap-2">
            <ChoiceSelect
              :model-value="held.sort"
              :items="sortChoices"
              value-key="value"
              variant="ghost"
              size="sm"
              icon="i-material-symbols-sort"
              :aria-label="$t('note.action.sort')"
              @update:model-value="(sort: SearchSort) => emit('change', { ...held, sort })"
            />
            <UDropdownMenu :items="filterItems" :content="{ align: 'start', side: 'top' }">
              <UButton color="neutral" variant="ghost" size="sm" icon="i-material-symbols-filter-list" :label="filtersOn > 0 ? `${$t('note.action.filter')} ${filtersOn}` : $t('note.action.filter')" />
            </UDropdownMenu>
            <UButton v-if="typing && more" color="neutral" variant="ghost" size="sm" class="ms-auto" :loading="searching" :label="$t('note.action.more')" @click="readMore" />
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
