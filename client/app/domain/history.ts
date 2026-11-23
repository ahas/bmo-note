// The note's own undo road (`docs/design.md`, 「Editing and saving」): which keys call undo and redo. The
// screen answers the keys wherever its focus stands — the editor binds them too, but only while it holds the
// focus — and yields the key to a plain text field, where an undo belongs to the words being typed.

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

/** Which way the key asks the history to move, or `null` where it asks nothing of it: Mod+z, shifted to
 * redo, and Control+y redoes too where the window is not the Mac's. */
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
