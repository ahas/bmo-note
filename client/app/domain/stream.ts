// The note service's event stream as the screen reads it (`docs/api.md`, 「Events the note service
// publishes」), through the console's relay. The browser resumes it after the last event it read; where
// the service no longer keeps the events since then it refuses the stream, and the screen opens it afresh
// and reads what it shows again.

import { onBeforeUnmount, onMounted } from "vue";
import { relayAddress } from "bmo-ui/app/domain/relay";

export type NoteStreamEvent = { kind: string; data: { noteId: string; owner: string } };

// The kinds the screen reads, each `note.<event>`. They are put together from the event's name, since the
// bundle build reads a dotted string the screen writes whole under the bundle's name as a key of its words.
const STREAM_EVENTS = ["saved", "trashed", "restored", "purged", "shared", "unshared"] as const;

export const STREAM_KINDS = STREAM_EVENTS.map((event) => `note.${event}` as const);

// How long a stream the service refused waits before it is opened afresh.
const REOPEN_MS = 3_000;

/** Calls `onEvent` with each event while the screen holding it stands, and `onReset` each time it is opened afresh. */
export function useNoteStream(service: string, onEvent: (event: NoteStreamEvent) => void, onReset: () => void): void {
  let source: EventSource | null = null;
  let reopening: ReturnType<typeof setTimeout> | null = null;
  let standing = false;

  function read(message: MessageEvent<string>): void {
    try {
      const envelope = JSON.parse(message.data) as { kind?: string; data?: unknown };

      onEvent({ kind: (envelope.kind ?? message.type) as string, data: envelope.data as NoteStreamEvent["data"] } as NoteStreamEvent);
    } catch {
      // An event that does not read is passed over; the next one says where things stand.
    }
  }

  function open(): void {
    source = new EventSource(relayAddress(service, `/events?kinds=${STREAM_KINDS.join(",")}`));

    for (const kind of STREAM_KINDS) source.addEventListener(kind, read);

    source.onerror = () => {
      if (source?.readyState !== EventSource.CLOSED || !standing) return;

      source = null;
      reopening = setTimeout(() => {
        reopening = null;

        if (!standing) return;

        open();
        onReset();
      }, REOPEN_MS);
    };
  }

  onMounted(() => {
    standing = true;
    open();
  });

  onBeforeUnmount(() => {
    standing = false;

    if (reopening !== null) clearTimeout(reopening);

    reopening = null;
    source?.close();
    source = null;
  });
}
