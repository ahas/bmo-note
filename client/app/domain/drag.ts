// A row of the navigator dragged under a pointer onto a folder (`docs/design.md`, 「The console surface」): what
// is held — one of the reader's own notes, or one of their folders — and where it may land. A browser does not
// let a drop target read what is dragged until the drop, so the row held is kept here as the drag starts.

import { ref } from "vue";

/** What a dragged row carries. */
export type HeldRow = { kind: "note"; id: string } | { kind: "folder"; id: string };

/** The type a dragged row's data is set under, so a drag from elsewhere lands nowhere. */
export const ROW_TYPE = "application/x-bmo-note-row";

/** The row held now, or null with no drag under way. */
export const heldRow = ref<HeldRow | null>(null);

export function rowWord(row: HeldRow): string {
  return `${row.kind}:${row.id}`;
}

export function rowOf(word: string): HeldRow | null {
  const [kind, ...rest] = word.split(":");
  const id = rest.join(":");

  return (kind === "note" || kind === "folder") && id !== "" ? { kind, id } : null;
}

/** Starts a drag of a row: its data set under the row type, the drag a move. */
export function startDrag(event: DragEvent, row: HeldRow): void {
  if (event.dataTransfer === null) return;

  event.dataTransfer.setData(ROW_TYPE, rowWord(row));
  event.dataTransfer.effectAllowed = "move";
  heldRow.value = row;
}

export function endDrag(): void {
  heldRow.value = null;
}

/** The row a drag over a target carries, where it is one of the navigator's own. */
export function draggedRow(event: DragEvent): HeldRow | null {
  return event.dataTransfer?.types.includes(ROW_TYPE) === true ? heldRow.value : null;
}
