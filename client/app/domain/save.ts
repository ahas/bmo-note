// The autosave's states (`docs/design.md`, 「Editing and saving」): what the editor holds, whether a
// save is on its way, and what the last one answered. The machine is written apart from the screen so
// its transitions can be read and tested as they are. The version a save names is the machine's
// `version` whenever it holds one; a queue keeps the last answered version, and the screen hands the
// save what it read.

import type { NoteMeta } from "../../shared/types";

export type SaveState =
  /** Everything on screen is on the service. */
  | { kind: "saved"; version: number }
  /** The document changed; a save will go when the debounce or a leave asks it. */
  | { kind: "queued"; version: number }
  /** A save is out, named by the version it was made from. */
  | { kind: "saving"; version: number }
  /** A save would not land; the document stands changed, waiting to go again. */
  | { kind: "offline"; version: number }
  /** The service holds a newer version than the save was made from. */
  | { kind: "conflict"; note: NoteMeta }
  /** A save the service refused; the document stands changed. */
  | { kind: "refused"; code: string; version: number };

/** What may happen to the machine while the screen stands. */
export type SaveEvent =
  | { type: "edited" }
  | { type: "flush" }
  | { type: "answered"; meta: NoteMeta }
  | { type: "unreachable" }
  | { type: "conflict"; note: NoteMeta }
  | { type: "refused"; code: string }
  | { type: "reloaded"; meta: NoteMeta };

export function initialSaveState(meta: NoteMeta): SaveState {
  return { kind: "saved", version: meta.version };
}

/** Whether a save must go before the reader leaves: the document holds a change not on the service. */
export function holdsChange(state: SaveState): boolean {
  return state.kind !== "saved";
}

export function nextSaveState(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case "edited": {
      const version = versionOf(state);

      // A save already on its way will carry the change; the change itself must not be lost.
      if (state.kind === "saving") return state;

      return version === null ? state : { kind: "queued", version };
    }
    case "flush": {
      if (state.kind === "queued" || state.kind === "offline" || state.kind === "refused") return { kind: "saving", version: state.version };

      return state;
    }
    case "answered":
      return { kind: "saved", version: event.meta.version };
    case "unreachable": {
      const version = versionOf(state);

      return version === null ? state : { kind: "offline", version };
    }
    case "conflict":
      return { kind: "conflict", note: event.note };
    case "refused": {
      const version = versionOf(state);

      return version === null ? state : { kind: "refused", code: event.code, version };
    }
    case "reloaded":
      return { kind: "saved", version: event.meta.version };
  }
}

/** The version the screen would name on a save, where it knows one. */
export function versionOf(state: SaveState): number | null {
  switch (state.kind) {
    case "saved":
    case "queued":
    case "saving":
    case "offline":
    case "refused":
      return state.version;
    case "conflict":
      return state.note.version;
  }
}
