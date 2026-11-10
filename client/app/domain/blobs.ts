// The images of one note, held by the note unit (`docs/design.md`, 「Storage」). BlockSuite asks its
// blob engine for the bytes of an image block; this source answers that engine with the note's own
// blob routes on the service, so an upload lands before the block stands and a read-back finds the
// bytes wherever the note is opened. Deletes go with the note itself, as the store keeps them under
// it; the engine is never asked to drop one on its own (`docs/api.md`, 「Notes」).

import { relayAddress } from "bmo-ui/app/domain/relay";

import type { DocCollectionOptions } from "@blocksuite/affine/store/test";

type BlobSource = NonNullable<DocCollectionOptions["blobSources"]>["main"];

const SERVICE = "note";

function address(noteId: string, blobId = ""): string {
  return relayAddress(SERVICE, `/notes/${encodeURIComponent(noteId)}/blobs${blobId === "" ? "" : `/${encodeURIComponent(blobId)}`}`);
}

/** The blob source of one note: the same routes for every call, the id naming the note's own file. */
export function noteBlobSource(noteId: string): BlobSource {
  return {
    name: "note",
    readonly: false,

    get: async (key: string): Promise<Blob | null> => {
      const answer = await fetch(address(noteId, key), { credentials: "same-origin" }).catch(() => null);

      if (answer === null || answer.status === 404) return null;
      if (!answer.ok) throw new Error(`the note service refused the image: ${answer.status}`);

      return new Blob([await answer.arrayBuffer()], { type: answer.headers.get("content-type") ?? "application/octet-stream" });
    },

    set: async (key: string, value: Blob): Promise<string> => {
      const answer = await fetch(address(noteId, key), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": value.type || "application/octet-stream" },
        body: value,
      });

      if (!answer.ok) throw new Error(`the note service refused the image: ${answer.status}`);

      return key;
    },

    delete: async () => {
      // A blob stands with its note and goes when the note is purged; the editor drops none on its own.
    },

    list: async (): Promise<string[]> => {
      // The engine reads all blobs of a workspace only for sync, which this unit has none of.
      return [];
    }
  };
}
