// The editor's lines of notice, said on the console's message pill (`docs/design.md`, 「The editor speaks
// on the console's message pill」). The fork says a line through the notification service its host
// provides, and its own toast helper hands its lines to that same service, so this service is the one road
// every line of the editor takes. It answers each line from the pack, as the seam answers the rest of the
// editor's words, and says it on the pill every console screen tells its news on.

import { render } from "lit";

import { answered } from "./words";

import type { NotificationService } from "@blocksuite/affine/shared/services";
import type { Island, IslandAction, IslandState, IslandTone } from "bmo-ui/app/domain/island";
import type { TemplateResult } from "lit";

/** How the screen hears a line the fork says: on the pill in a tone, or not at all. */
type Hearing = IslandTone | "held back";

// The fork's lines the screen hears other than in the info tone, keyed by the words the fork says them in.
// The pill tells whether an action went through or did not: a copy that went through is a success, a
// refusal or a failure an error, and a line narrating a step still under way — a download the browser
// already shows going — is held back. A line the fork adds later is said in the info tone, never lost.
const HEARINGS = new Map<string, Hearing>([
  ["Copied to clipboard", "success"],
  ["Copied link to clipboard", "success"],
  ["Copied image to clipboard", "success"],
  ["Copied failed, something went wrong", "error"],
  ["Failed to download image!", "error"],
  ["Failed to read image size, please try another image", "error"],
  ["Downloading image...", "held back"],
  ["Download in progress...", "held back"]
]);

/** The line the fork says when a copy went through, which the bundle's own copy keys say as well. */
export const COPIED = "Copied to clipboard";

// A line's name on the pill: the same line said again before the first has gone replaces it where it stands.
const keyOf = (said: string): string => `note-editor:${said}`;

/** What the screen hands the editor's notices: the pill, and the console's question dialog. */
export interface NoticeRoads {
  pill: Pick<Island, "say" | "settle">;
  ask: (title: string) => Promise<boolean>;
}

/** The service the editor is given, and what the screen tells it of the pill as the pill changes. */
export interface EditorMessages {
  service: NotificationService;
  /** Tells the fork of every notice it asked to hear the end of that no longer stands nor waits. */
  heard: (state: IslandState) => void;
}

/** The notification service the editor says its lines through, answered on the console's pill. */
export function editorMessages(roads: NoticeRoads): EditorMessages {
  // The notices whose end the fork asked to hear, by their name on the pill.
  const awaited = new Map<string, () => void>();

  const notify: NotificationService["notify"] = (options) => {
    if (options.abort?.aborted) return;

    const said = wordsOf(options.title);
    const hearing = HEARINGS.get(said);

    if (said === "" || hearing === "held back") return;

    const key = keyOf(said);
    const actions = (options.actions ?? []).map((action): IslandAction => ({ label: answered(wordsOf(action.label)), press: action.onClick }));

    roads.pill.say({
      key,
      tone: options.accent ?? hearing ?? "info",
      title: answered(said),
      description: options.message === undefined ? null : answered(wordsOf(options.message)),
      actions,
      // The fork asks a notice to stand until it is pressed with no time of its own; any other time is the
      // pill's own for its tone.
      ...(options.duration === 0 ? { duration: null } : {})
    });

    // The same notice said again: the one it replaces is done with.
    awaited.get(key)?.();
    awaited.delete(key);

    if (options.onClose !== undefined) awaited.set(key, options.onClose);

    options.abort?.addEventListener("abort", () => roads.pill.settle(key), { once: true });
  };

  const service: NotificationService = {
    toast: (message) => notify({ title: message }),
    confirm: async (options) => roads.ask(answered(wordsOf(options.title))),
    // No line of the editor asks for a typed answer on this screen; one that does is answered with none.
    prompt: async () => null,
    notify,
    notifyWithUndoAction: notify
  };

  return {
    service,
    heard: (state) => {
      const standing = new Set([state.standing, ...state.waiting].flatMap((message) => (message === null ? [] : [message.key])));

      for (const [key, closed] of awaited) {
        if (standing.has(key)) continue;

        awaited.delete(key);
        closed();
      }
    }
  };
}

/** The words a notice says, drawn out of its template where the fork wrote one, as one line. */
function wordsOf(said: string | TemplateResult): string {
  if (typeof said === "string") return said;

  const drawn = document.createElement("div");

  render(said, drawn);

  return (drawn.textContent ?? "").trim().replace(/\s+/g, " ");
}
