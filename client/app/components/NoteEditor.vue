<script setup lang="ts">
// The note editor (`docs/design.md`, 「The console surface」): Nuxt UI's editor over the note's TipTap document,
// with the bundle's format bar over it, the selection toolbar over chosen words, the slash menu, the note-link
// menus `[[` and `@` open, the drag handle beside a block under a pointer, the Agent over a passage, the comment
// gap that parts the lines under a comment's words for its form or its thread, and the page head and the
// backlinks standing in the document's own scroll around it. A note opened read only — shared
// with the reader to read, or on its share page — stands with its edits refused, the bar's keys disabled and
// none of the writing chrome.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import UEditor from "@nuxt/ui/components/Editor.vue";
import UEditorDragHandle from "@nuxt/ui/components/EditorDragHandle.vue";
import UEditorMentionMenu from "@nuxt/ui/components/EditorMentionMenu.vue";
import UEditorSuggestionMenu from "@nuxt/ui/components/EditorSuggestionMenu.vue";
import { useIsland } from "bmo-ui/app/domain/island";

import NoteAgent from "./NoteAgent.vue";
import NoteSelectionBar from "./NoteSelectionBar.vue";
import NoteToolbar from "./NoteToolbar.vue";
import { ImageRefused } from "../domain/blobs";
import { countWords } from "../domain/count";
import { commentPlaces, dropComment, snapshotOf, writeDoc } from "../domain/document";
import { COMMENT_GAP, COMMENT_TINT, noteExtensions } from "../domain/extensions";
import { INSERTS, insertInto, KINDS, turnInto } from "../domain/format";
import { historyDirectionOf } from "../domain/history";
import { linesOfRun, patchedDoc, retitledDoc, rewrittenDoc, rowsOfDoc, runAt } from "../domain/rows";
import { opaqueRow } from "../domain/text";

import type { Editor, JSONContent } from "@tiptap/core";
import type { StarterKitOptions } from "@tiptap/starter-kit";
import type { EditorView } from "@tiptap/pm/view";
import type { DropdownMenuItem } from "@nuxt/ui";
import type { BlobSource } from "../domain/blobs";
import type { GapTarget } from "../domain/extensions";
import type { AgentCall } from "../domain/talk";
import type { Holding } from "../domain/count";
import type { InsertId, KindId } from "../domain/format";
import type { LinkTarget } from "../domain/links";
import type { Op } from "../domain/patch";
import type { DocNode, Rewrite } from "../domain/rows";

/** A note the link menus offer: the item Nuxt UI's mention menu draws and the attributes the link takes. */
export interface LinkCandidate {
  id: string;
  owner: string;
  label: string;
  icon?: string;
  description?: string;
}

const props = withDefaults(
  defineProps<{
    noteId: string;
    doc: DocNode;
    title: string;
    /** Where the note's images are read and stored. */
    blobs: BlobSource;
    readonly?: boolean;
    /** Whether the format bar stands over the document. */
    toolbar?: boolean;
    /** Whether the reader may lay comments. */
    comments?: boolean;
    /** The address a note link leads to. */
    href: (target: LinkTarget) => string;
    /** The notes the link menus offer for what follows the mark; recent notes for nothing. */
    findNotes?: (term: string) => Promise<LinkCandidate[]>;
    /** The threads whose words wear the comment tint, and the one standing open under its line. */
    openThreads?: readonly string[];
    chosenThread?: string | null;
    /** What the comment gap opens under, the screen's `gap` slot standing in it; null while it is closed. */
    gap?: GapTarget;
    /** The Agent the menu asks over a passage; none where the reader may not write. */
    agent?: AgentCall;
  }>(),
  { readonly: false, toolbar: true, comments: false, findNotes: undefined, openThreads: () => [], chosenThread: null, gap: null, agent: undefined }
);

const emit = defineEmits<{
  change: [];
  title: [title: string];
  ready: [];
  /** A note link pressed: the note it names, and whether it opens in a new tab. */
  link: [target: LinkTarget, newTab: boolean];
  /** Marked words pressed, or the comment key: the thread, or a new one over the words chosen. */
  thread: [thread: string];
  comment: [draft: { quote: string; range: { from: number; to: number } }];
}>();

const i18n = useI18n();
const island = useIsland((key: string) => i18n.t(key));

const host = shallowRef<HTMLElement | null>(null);
const editor = shallowRef<Editor | null>(null);
const toolbarRef = shallowRef<InstanceType<typeof NoteToolbar> | null>(null);
const working = ref(false);

// The one element the comment gap stands in, which the editor places between the lines and the screen draws into.
const gapPlace = document.createElement("div");

gapPlace.className = "note-comment-gap";

const extensions = noteExtensions({
  href: (target) => props.href(target),
  untitled: i18n.t("note.label.untitled"),
  image: (blobId) => props.blobs.address(blobId),
  gap: gapPlace
});

// The starter kit as the note takes it: the document is the note's own (a title node first), every heading
// level stands, and a link is followed by the screen, never by a press inside the editor.
const starterKit: Partial<StarterKitOptions> = {
  document: false,
  heading: { levels: [1, 2, 3, 4, 5, 6] },
  link: { openOnClick: false, autolink: true, defaultProtocol: "https" }
};

// The title says untitled while it is empty; a line says how to reach the menus while the caret stands in it.
const placeholder = {
  showOnlyCurrent: false,
  includeChildren: false,
  placeholder: ({ node, hasAnchor }: { node: { type: { name: string } }; hasAnchor: boolean }) =>
    node.type.name === "title" ? i18n.t("note.label.untitled") : hasAnchor && node.type.name === "paragraph" ? i18n.t("note.editor.placeholder") : ""
};

// The caret is kept inside the note's scroll with room around it as the editor scrolls it into sight
// (`docs/design.md`, 「Editing and saving」).
const editorProps = {
  scrollMargin: 48,
  scrollThreshold: 48,
  handlePaste: (_view: EditorView, event: ClipboardEvent) => takeImages([...(event.clipboardData?.files ?? [])]),
  handleDrop: (_view: EditorView, event: DragEvent) => takeImages([...(event.dataTransfer?.files ?? [])])
};

// The editor Nuxt UI's component made, once it stands.
const editorRoot = shallowRef<{ editor?: Editor } | null>(null);

watch(
  () => editorRoot.value?.editor,
  (made) => {
    if (made === undefined || made === editor.value) return;

    editor.value = made;
    tint();
    placeGap();
    emit("ready");
  }
);

function onChanged(): void {
  const held = editor.value;

  if (held === null) return;

  emit("change");
  emit("title", snapshotOf(held).title);
}

// ---------------------------------------------------------------------------------------------------------
// Images: the bytes go to the service first and the block stands once they are held.

function takeImages(files: File[]): boolean {
  const images = files.filter((file) => file.type.startsWith("image/"));

  if (images.length === 0 || props.readonly) return false;

  void insertImages(images);

  return true;
}

async function insertImages(files: File[]): Promise<void> {
  const held = editor.value;

  if (held === null || working.value) return;

  working.value = true;

  try {
    for (const file of files) {
      const blob = await props.blobs.upload(file);

      held.chain().focus().insertContent({ type: "image", attrs: { blob, alt: file.name } }).run();
    }
  } catch (error) {
    island.say({ tone: "error", title: i18n.t(error instanceof ImageRefused && error.tooLarge ? "note.error.image_too_large" : "note.error.image_failed") });
  } finally {
    working.value = false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The slash menu and the drag handle's menu: the kinds and the inserts, each named in the console's language.

const handlers = {
  noteKind: {
    canExecute: () => true,
    execute: (held: Editor, item: { turn: KindId }) => turnInto(held.chain().focus(), item.turn),
    isActive: () => false,
    isDisabled: undefined
  },
  noteInsert: {
    canExecute: () => true,
    execute: (held: Editor, item: { insert: InsertId }) => {
      if (item.insert === "image") {
        toolbarRef.value?.pickImage();

        return held.chain();
      }

      return insertInto(held.chain().focus(), item.insert);
    },
    isActive: () => false,
    isDisabled: undefined
  }
};

const slashItems = computed(() => [
  [
    { type: "label" as const, label: i18n.t("note.slash.kinds") },
    ...KINDS.map((kind) => ({ kind: "noteKind", turn: kind.id, label: i18n.t(`note.kind.${kind.id}`), icon: kind.icon }))
  ],
  [
    { type: "label" as const, label: i18n.t("note.slash.inserts") },
    ...INSERTS.map((insert) => ({ kind: "noteInsert", insert: insert.id, label: i18n.t(`note.insert.${insert.id}`), icon: insert.icon }))
  ]
]);

// The block the drag handle stands beside, and its menu: turn into, duplicate, copy and delete.
const handled = shallowRef<{ node: JSONContent; pos: number } | null>(null);

function onHandleNode(chosen: { node: JSONContent; pos: number }): void {
  handled.value = chosen;
}

const handleItems = computed<DropdownMenuItem[][]>(() => {
  const held = editor.value;
  const chosen = handled.value;

  if (held === null || chosen === null) return [];

  const atBlock = () => held.chain().focus().setNodeSelection(chosen.pos);

  return [
    [
      {
        label: i18n.t("note.action.turn_into"),
        icon: "i-material-symbols-swap-horiz",
        children: KINDS.map((kind) => ({
          label: i18n.t(`note.kind.${kind.id}`),
          icon: kind.icon,
          onSelect: () => turnInto(held.chain().focus().setTextSelection(chosen.pos + 1), kind.id).run()
        }))
      }
    ],
    [
      { label: i18n.t("note.block.duplicate"), icon: "i-material-symbols-content-copy-outline", onSelect: () => duplicateBlock(chosen) },
      { label: i18n.t("note.block.copy"), icon: "i-material-symbols-file-copy-outline", onSelect: () => void copyBlock(chosen) },
      { label: i18n.t("note.block.delete"), icon: "i-material-symbols-delete-outline", color: "error" as const, onSelect: () => atBlock().deleteSelection().run() }
    ]
  ];
});

function duplicateBlock(chosen: { node: JSONContent; pos: number }): void {
  const held = editor.value;
  const node = held?.state.doc.nodeAt(chosen.pos);

  if (held === null || node === null || node === undefined) return;

  held.chain().focus().insertContentAt(chosen.pos + node.nodeSize, node.toJSON()).run();
}

async function copyBlock(chosen: { node: JSONContent; pos: number }): Promise<void> {
  const held = editor.value;
  const node = held?.state.doc.nodeAt(chosen.pos);

  if (held === null || node === null || node === undefined) return;

  try {
    await navigator.clipboard.writeText(node.textContent);
    island.say({ tone: "success", title: i18n.t("note.status.block_copied") });
  } catch {
    island.say({ tone: "error", title: i18n.t("note.error.copy_failed") });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The note-link menus: `[[` and `@` each open the reader's notes, those found for what follows the mark.

const linkItems = ref<LinkCandidate[]>([]);
const linkTerm = ref("");
let linkAsked = 0;

watch(linkTerm, async (term) => {
  const find = props.findNotes;

  if (find === undefined) return;

  const asked = (linkAsked += 1);

  try {
    const found = await find(term.trim());

    if (asked === linkAsked) linkItems.value = found.filter((one) => !(one.id === props.noteId));
  } catch {
    if (asked === linkAsked) linkItems.value = [];
  }
});

// ---------------------------------------------------------------------------------------------------------
// Presses inside the document: a note link opens its note; marked words open their thread.

function onPress(event: MouseEvent): void {
  const target = event.target as Element | null;
  const link = target?.closest<HTMLAnchorElement>("a[data-note-link]") ?? null;

  if (link !== null) {
    event.preventDefault();
    emit("link", { id: link.dataset.noteLink ?? "", owner: link.dataset.owner ?? "" }, event.ctrlKey || event.metaKey);

    return;
  }

  const marked = target?.closest<HTMLElement>("[data-thread]") ?? null;

  if (marked !== null && props.openThreads.includes(marked.dataset.thread ?? "")) emit("thread", marked.dataset.thread ?? "");
}

/** The comment key over chosen words: a new thread's draft, the words and the range they stand in. */
function askComment(held: Editor): void {
  const { from, to } = held.state.selection;

  if (from === to) return;

  emit("comment", { quote: held.state.doc.textBetween(from, to, " ").trim().slice(0, 1000), range: { from, to } });
}

// ---------------------------------------------------------------------------------------------------------
// The Agent (`docs/design.md`, 「Agent」): the passage is taken as the key is pressed — the rows the selection
// covers, the one under the caret, or the whole note where the caret stands in the title — and the result is
// placed over that run or below it.

const agentOpen = ref(false);
const passage = shallowRef<{ at: number; count: number; lines: string[]; opaque: boolean } | null>(null);
const anchor = shallowRef<{ getBoundingClientRect: () => DOMRect } | undefined>(undefined);

function openAgent(): void {
  const held = editor.value;

  if (held === null) return;

  const rows = rowsOfDoc(held.getJSON() as DocNode);
  const { from, to } = held.state.selection;
  const run = runAt(rows, from, to) ?? (rows.length > 0 ? { at: 0, count: rows.length } : null);

  if (run === null) return;

  const lastRow = rows[run.at + run.count - 1];
  const at = Math.min(lastRow === undefined ? to : lastRow.to - 1, held.state.doc.content.size);

  passage.value = { ...run, lines: linesOfRun(rows, run), opaque: rows.slice(run.at, run.at + run.count).some(opaqueRow) };
  anchor.value = {
    getBoundingClientRect: () => {
      const place = held.view.coordsAtPos(Math.max(0, at));

      return new DOMRect(place.left, place.top, 0, place.bottom - place.top);
    }
  };
  agentOpen.value = true;
}

// The selection toolbar stands down while the menu stands under the words, and back once it goes; a
// transaction that changes nothing asks the toolbar to read where it stands.
watch(agentOpen, async () => {
  await nextTick();

  const held = editor.value;

  if (held !== null && !held.isDestroyed) held.view.dispatch(held.state.tr.setMeta("addToHistory", false));
});

function placeAnswer(how: "replace" | "below", lines: string[]): void {
  const taken = passage.value;

  if (taken === null) return;

  const op: Op = how === "replace" ? { at: taken.at, del: taken.count, insert: lines } : { at: taken.at + taken.count, del: 0, insert: lines };

  if (!apply([op])) island.say({ tone: "error", title: i18n.t("note.talk.apply_failed") });
}

// ---------------------------------------------------------------------------------------------------------
// The talk's hand on the document, each change one transaction.

function apply(ops: Op[]): boolean {
  const held = editor.value;

  if (held === null) return false;

  try {
    writeDoc(held, patchedDoc(held.getJSON() as DocNode, ops));

    return true;
  } catch {
    return false;
  }
}

function replace(lines: string[]): Rewrite {
  const held = editor.value;

  if (held === null) return { ok: false, kinds: [] };

  const rewrite = rewrittenDoc(held.getJSON() as DocNode, lines);

  if (rewrite.ok) writeDoc(held, rewrite.doc);

  return rewrite;
}

function rename(title: string): boolean {
  const held = editor.value;

  return held !== null && writeDoc(held, retitledDoc(held.getJSON() as DocNode, title));
}

// ---------------------------------------------------------------------------------------------------------
// The history keys, caught on the way down: they answer wherever on the screen the focus stands, and a plain
// text field — the talk's, the Agent's and the comments' own inputs — keeps the key for its own undo.

function standsInTextField(target: EventTarget | null): boolean {
  const tag = (target as { tagName?: string } | null)?.tagName;

  return tag === "INPUT" || tag === "TEXTAREA";
}

function answerHistoryKey(event: KeyboardEvent): void {
  const direction = historyDirectionOf(event);
  const held = editor.value;

  if (direction === null || held === null || props.readonly || standsInTextField(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  if (direction === "undo") held.commands.undo();
  else held.commands.redo();
}

const selectionBar = shallowRef<InstanceType<typeof NoteSelectionBar> | null>(null);

// Ctrl+K (⌘K) over chosen words opens the link field, as the editor keeps that key for a link.
function answerLinkKey(event: KeyboardEvent): void {
  const held = editor.value;

  if (held === null || props.readonly || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
  if (held.state.selection.empty) return;

  event.preventDefault();
  event.stopPropagation();
  void selectionBar.value?.openLink();
}

onMounted(() => {
  addEventListener("keydown", answerHistoryKey, true);
  host.value?.addEventListener("keydown", answerLinkKey, true);
});

onBeforeUnmount(() => {
  removeEventListener("keydown", answerHistoryKey, true);
  host.value?.removeEventListener("keydown", answerLinkKey, true);
});

// The threads whose words wear the comment tint, handed to the editor's own tint as they change.
function tint(): void {
  const held = editor.value;

  if (held === null || held.isDestroyed) return;

  held.view.dispatch(held.state.tr.setMeta(COMMENT_TINT, { open: [...props.openThreads], chosen: props.chosenThread }).setMeta("addToHistory", false));
}

watch(() => [props.openThreads, props.chosenThread], tint, { deep: true });

// The comment gap, opened under the words the screen names and closed, then brought into the scroll.
function placeGap(): void {
  const held = editor.value;

  if (held === null || held.isDestroyed) return;

  held.view.dispatch(held.state.tr.setMeta(COMMENT_GAP, { target: props.gap }).setMeta("addToHistory", false));
}

watch(
  () => props.gap,
  async () => {
    placeGap();
    await nextTick();

    if (props.gap !== null && gapPlace.isConnected) gapPlace.scrollIntoView({ block: "nearest" });
  },
  { deep: true }
);

/** The range a new thread's words stand in now: the gap's own, which followed the edits made around them. */
function draftRange(fallback: { from: number; to: number }): { from: number; to: number } {
  const target = editor.value === null ? null : (COMMENT_GAP.getState(editor.value.state)?.target ?? null);

  return target !== null && "draft" in target ? target.draft : fallback;
}

defineExpose({
  /** The document as the save writes it, and the title it stands under. */
  snapshot: (): { doc: DocNode; title: string } | null => (editor.value === null ? null : snapshotOf(editor.value)),
  /** What the note holds now, for the bar's line. */
  holding: (): Holding => ({ words: editor.value === null ? 0 : countWords(editor.value.getJSON() as DocNode) }),
  /** The note's body as the talk asks over it: one line a row. */
  lines: (): string[] => (editor.value === null ? [] : linesOfRun(rowsOfDoc(editor.value.getJSON() as DocNode), { at: 0, count: Number.MAX_SAFE_INTEGER })),
  apply,
  replace,
  rename,
  /** Lays thread `thread`'s comment mark over the range that was chosen. */
  markComment: (thread: string, range: { from: number; to: number }): boolean =>
    editor.value?.chain().setTextSelection(draftRange(range)).setMark("comment", { thread }).run() ?? false,
  /** Takes thread `thread`'s comment marks off the document. */
  unmarkComment: (thread: string): void => {
    if (editor.value !== null) dropComment(editor.value, thread);
  },
  /** Where each thread's words first stand. */
  commentPlaces: (): Map<string, number> => (editor.value === null ? new Map() : commentPlaces(editor.value))
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <NoteToolbar v-if="props.toolbar" ref="toolbarRef" :editor="props.readonly ? null : editor" :agent="!props.readonly && props.agent !== undefined" :working="working" @agent="openAgent" @image="insertImages">
      <template v-if="$slots.barStart" #start>
        <slot name="barStart" />
      </template>
      <template v-if="$slots.barEnd" #end>
        <slot name="barEnd" />
      </template>
    </NoteToolbar>

    <!-- The note's one scroll: the page head, the document and the backlinks under it, in the editor's
         column. -->
    <div ref="host" data-note-editor class="note-editor-host min-h-0 flex-1 overflow-y-auto" @click="onPress">
      <div class="note-column mx-auto flex w-full flex-col px-4 pb-24 sm:px-0">
        <slot name="head" />
        <UEditor
          :model-value="props.doc as JSONContent"
          content-type="json"
          :editable="!props.readonly"
          :starter-kit="starterKit"
          :image="false"
          :mention="false"
          :placeholder="placeholder"
          :extensions="extensions"
          :handlers="handlers"
          :editor-props="editorProps"
          ref="editorRoot"
          @update:model-value="onChanged"
          :ui="{ base: 'pb-8' }"
          class="note-document"
        >
          <template #default="{ editor: held }">
            <template v-if="!props.readonly">
              <NoteSelectionBar
                ref="selectionBar"
                :editor="held"
                :comment="props.comments"
                :agent="props.agent !== undefined"
                :hidden="agentOpen || props.gap !== null"
                @agent="openAgent"
                @comment="askComment(held)"
              />
              <UEditorSuggestionMenu :editor="held" :items="slashItems" plugin-key="noteSlash" />
              <UEditorMentionMenu
                v-model:search-term="linkTerm"
                :editor="held"
                :items="linkItems"
                char="[["
                plugin-key="noteLinkBrackets"
                ignore-filter
                :suggestion="{ allowSpaces: true }"
              />
              <UEditorMentionMenu v-model:search-term="linkTerm" :editor="held" :items="linkItems" char="@" plugin-key="noteLinkAt" ignore-filter />
              <UEditorDragHandle :editor="held" class="pointer-coarse:hidden" @node-change="onHandleNode">
                <template #default="{ ui, onClick }">
                  <UDropdownMenu :items="handleItems" :content="{ side: 'left', align: 'start' }" :modal="false">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      square
                      icon="i-material-symbols-drag-indicator"
                      :aria-label="$t('note.block.menu')"
                      :class="ui.handle()"
                      data-drag-handle-key
                      @click="onClick()"
                    />
                  </UDropdownMenu>
                </template>
              </UEditorDragHandle>
            </template>
          </template>
        </UEditor>
        <slot name="foot" />
      </div>
    </div>

    <NoteAgent
      v-if="!props.readonly && props.agent !== undefined"
      v-model:open="agentOpen"
      :agent="props.agent"
      :passage="passage?.lines ?? null"
      :opaque="passage?.opaque ?? false"
      :anchor="anchor"
      @place="placeAnswer"
    />

    <Teleport v-if="props.gap !== null" :to="gapPlace">
      <slot name="gap" />
    </Teleport>
  </div>
</template>

<style scoped>
/* The note's column: a reading width, released where the note stands at full width. */
.note-column {
  max-width: var(--note-width, 52rem);
}

/* The title the editor draws as the page's own heading, large over the blocks. */
.note-editor-host :deep(h1[data-note-title]) {
  font-size: var(--text-4xl);
  line-height: 1.2;
  font-weight: 700;
  color: var(--ui-text-highlighted);
  margin-bottom: 1.5rem;
}

/* The words of an open thread wear the comment tint, the thread standing open under its line more strongly. */
.note-editor-host :deep(.note-comment-open) {
  background-color: color-mix(in oklab, var(--ui-warning) 22%, transparent);
  cursor: pointer;
}

/* The gap the comment's form or thread stands in, parted from the lines around it. */
.note-editor-host :deep(.note-comment-gap) {
  margin-block: 0.5rem;
}

.note-editor-host :deep(.note-comment-chosen) {
  background-color: color-mix(in oklab, var(--ui-warning) 45%, transparent);
}

/* A note link: the linked note's title in the link tone, the note mark before it. */
.note-editor-host :deep(a.note-link) {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25em;
  border-bottom: 0;
}

.note-editor-host :deep(.note-link-mark) {
  display: inline-block;
  width: 1em;
  height: 1em;
  align-self: center;
  background-color: currentColor;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M8 18h8v-2H8zm0-4h8v-2H8zm-2 8q-.825 0-1.412-.587T4 20V4q0-.825.588-1.412T6 2h8l6 6v12q0 .825-.587 1.413T18 22zm7-13V4H6v16h12V9zM6 4v5zv16z'/></svg>") center / contain no-repeat;
}

/* To-do items: the box beside the words, the words beside it. */
.note-editor-host :deep(ul[data-type="taskList"]) {
  list-style: none;
  padding-inline-start: 0.25rem;
}

.note-editor-host :deep(li[data-type="taskItem"]) {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.note-editor-host :deep(li[data-type="taskItem"] > label) {
  margin-top: 0.35rem;
  flex-shrink: 0;
}

.note-editor-host :deep(li[data-type="taskItem"] > div) {
  flex: 1;
  min-width: 0;
}

.note-editor-host :deep(li[data-checked="true"] > div) {
  color: var(--ui-text-muted);
  text-decoration: line-through;
}

/* Tables: ruled cells, wide tables scrolling inside their own box. */
.note-editor-host :deep(.tableWrapper) {
  overflow-x: auto;
}

.note-editor-host :deep(table) {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}

.note-editor-host :deep(td),
.note-editor-host :deep(th) {
  border: 1px solid var(--ui-border);
  padding: 0.375rem 0.5rem;
  vertical-align: top;
  min-width: 6rem;
}

.note-editor-host :deep(th) {
  background-color: var(--ui-bg-elevated);
  font-weight: 600;
}

.note-editor-host :deep(td > p),
.note-editor-host :deep(th > p) {
  margin: 0;
}

.note-editor-host :deep(.selectedCell) {
  background-color: color-mix(in oklab, var(--ui-primary) 15%, transparent);
}
</style>
