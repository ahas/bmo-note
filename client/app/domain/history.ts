// The note's own undo road (`docs/design.md`, 「Editing and saving」): which keys call undo and redo,
// the step taken on the document's history where it can go that way, and the one transaction a
// whole change lands in so the history holds it as one step. The screen answers the keys wherever
// its focus stands — the fork's editor binds them too but answers only while its own event flow is
// active — and yields the key to a plain text field, where an undo belongs to the words being
// typed. Nothing here reaches for the fork: the shapes below are the parts the code reads.

export type HistoryDirection = "undo" | "redo";

/** The parts of a key event the history reads. */
export interface HistoryKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** Which way the key asks the history to move, or `null` where it asks nothing of it. The chord is
 * the fork's own: Mod+z, shifted to redo, Control+y redoes too where the window is not the Mac's. */
export function historyDirectionOf(event: HistoryKeyEvent): HistoryDirection | null {
  // A dead key under a composing keyboard is the input method's, never the note's.
  if (event.isComposing === true) return null;
  if (event.altKey) return null;
  if (!event.ctrlKey && !event.metaKey) return null;

  const key = event.key.toLowerCase();

  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) return "redo";

  return null;
}

/** The document's history, in the shape the step reads — the store's own answers it. */
export interface Undoable {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** Steps the history one way where it can go that way; answers whether it moved. */
export function stepHistory(history: Undoable, direction: HistoryDirection): boolean {
  if (direction === "undo") {
    if (!history.canUndo) return false;
    history.undo();
    return true;
  }

  if (!history.canRedo) return false;
  history.redo();
  return true;
}

/** The document, in the one part the step reads it by. */
export interface TransactableDoc {
  readonly clientID: number;
  transact: <T>(work: () => T, origin: unknown) => T;
}

/**
 * Runs `work` as one tracked transaction, so the note's history holds the whole of it as one undo
 * step. The store's own `transact` swallows what the work throws, and the panels must see the
 * failure and say so; this rides the underlying document directly, where the error stands rethrown.
 * The origin is the document's own client id — the one the fork's history keeps.
 */
export function asOneStep<T>(doc: TransactableDoc, work: () => T): T {
  return doc.transact(work, doc.clientID);
}
