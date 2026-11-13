// The images of one note, held by the note unit (`docs/design.md`, 「Storage」). BlockSuite asks its
// blob engine for the bytes of an image block; this source answers that engine with the note's own
// blob routes on the service, or a link's share read on the share page, so an upload lands before the
// block stands and a read-back finds the bytes wherever the note is opened. Deletes go with the note
// itself, as the store keeps them under it; the engine is never asked to drop one on its own
// (`docs/api.md`, 「Notes」).

import { relayAddress } from "bmo-ui/app/domain/relay";

import type { DocCollectionOptions } from "@blocksuite/affine/store/test";

type BlobSource = NonNullable<DocCollectionOptions["blobSources"]>["main"];

const SERVICE = "note";

/** Where the image `blobId` of a note is read and stored. */
type BlobAddress = (blobId: string) => string;

/** The blob source of a note's images at `address`; a read-only one refuses every upload. */
function blobSource(address: BlobAddress, readonly: boolean): BlobSource {
  return {
    name: "note",
    readonly,

    get: async (key: string): Promise<Blob | null> => {
      const answer = await fetch(address(key), { credentials: "same-origin" }).catch(() => null);

      if (answer === null || answer.status === 404) return null;
      if (!answer.ok) throw new Error(`the note service refused the image: ${answer.status}`);

      return new Blob([await answer.arrayBuffer()], { type: answer.headers.get("content-type") ?? "application/octet-stream" });
    },

    set: async (key: string, value: Blob): Promise<string> => {
      if (readonly) throw new Error("the note is open to read only");

      const answer = await fetch(address(key), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": value.type || "application/octet-stream" },
        body: value
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

/** The blob source of one note: its own image routes, naming the owner where the note is another
 * account's shared with the reader, read only where the share opens no writes. */
export function noteBlobSource(noteId: string, owner?: string, readonly = false): BlobSource {
  const query = owner === undefined ? "" : `?owner=${encodeURIComponent(owner)}`;

  return blobSource((blobId) => relayAddress(SERVICE, `/notes/${encodeURIComponent(noteId)}/blobs/${encodeURIComponent(blobId)}${query}`), readonly);
}

/** The blob source of the note a link opens: its share read, read only (`docs/api.md`, 「Share reads」). */
export function sharedBlobSource(token: string): BlobSource {
  return blobSource((blobId) => relayAddress(SERVICE, `/shares/${encodeURIComponent(token)}/blobs/${encodeURIComponent(blobId)}`), true);
}

export type { BlobSource };
