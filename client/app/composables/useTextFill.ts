// The quiet fill of a note's plain text (`docs/design.md`, 「What a note is」): a note the service holds no
// text for — saved before the text was asked for — has it read out of its stored document and written for
// the version stored, one note at a time, behind whatever the reader is doing. Only a note the reader may
// write is filled, and each is tried once a visit: a note saved meanwhile carries its own text, so a fill
// refused for its version is let go.

import { keyOfNote } from "../domain/api";
import { readRows } from "../domain/apply";
import { noteBlobSource } from "../domain/blobs";
import { fromBase64, openNoteDoc } from "../domain/doc";
import { noteKeyOf } from "../domain/navigator";
import { plainText } from "../domain/plain";
import { linesOf } from "../domain/text";

import type { NoteApi } from "../domain/api";
import type { NoteMeta } from "../../shared/types";

/** The plain text of a note's stored document, read with no editor standing. */
function storedText(id: string, doc: string): string {
  const held = openNoteDoc(id, fromBase64(doc), noteBlobSource(id), true);

  try {
    return plainText(linesOf(readRows(held.store)));
  } finally {
    held.dispose();
  }
}

export function useTextFill(api: NoteApi) {
  const tried = new Set<string>();
  const waiting: NoteMeta[] = [];
  let running = false;

  async function run(): Promise<void> {
    if (running) return;

    running = true;

    try {
      for (let note = waiting.shift(); note !== undefined; note = waiting.shift()) {
        try {
          const read = await api.read(keyOfNote(note));

          if (!read.indexed) await api.text(keyOfNote(note), { version: read.version, text: storedText(read.id, read.doc) });
        } catch {
          // A note moved, saved or refused meanwhile is let go; its own save carries its text.
        }
      }
    } finally {
      running = false;
    }
  }

  /** Takes the notes among `rows` that hold no text and that the reader may write, to fill each once. */
  function offer(rows: readonly NoteMeta[]): void {
    for (const note of rows) {
      const key = noteKeyOf(note);

      if (note.indexed || note.access === "read" || note.deletedAt !== null || tried.has(key)) continue;

      tried.add(key);
      waiting.push(note);
    }

    void run();
  }

  /** Writes the open note's text from the lines its editor holds, where the service holds none. */
  async function fillOpen(note: NoteMeta, lines: readonly string[]): Promise<NoteMeta | null> {
    const key = noteKeyOf(note);

    if (note.indexed || note.access === "read") return null;

    tried.add(key);

    try {
      return await api.text(keyOfNote(note), { version: note.version, text: plainText(lines) });
    } catch {
      return null;
    }
  }

  return { offer, fillOpen };
}
