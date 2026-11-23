// The images of one note, held by the note unit (`docs/design.md`, 「Storage」, 「The console surface」): an
// image block names its stored image by its blob id, and this source answers where the screen reads it — the
// note's own blob route, or a link's share read on the share page — and uploads a picked or pasted image to
// the note's route under a fresh id before the block stands. Deletes go with the note itself.

import { relayAddress } from "bmo-ui/app/domain/relay";

const SERVICE = "note";

/// The cap an image may carry, mirroring the store's own (`settings.toml`, `[notes] max_blob_bytes`). The
/// service refuses past its line whoever named what; this one only keeps the screen from uploading a file it
/// already knows the store will send back.
export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** Where a note's images are read and stored. */
export interface BlobSource {
  /** The address an image block is drawn from. */
  address: (blobId: string) => string;
  /** Stores one image and answers its blob id; refused where the source is read only. */
  upload: (file: Blob) => Promise<string>;
}

/** Why an image did not stand: past the cap, or refused on the way. */
export class ImageRefused extends Error {
  constructor(readonly tooLarge: boolean) {
    super(tooLarge ? "the image is past the store's cap" : "the note service refused the image");
  }
}

/** A fresh blob id: letters and digits the blob routes take. */
export function freshBlobId(): string {
  return crypto.randomUUID().replace(/-/gu, "");
}

function blobSource(address: (blobId: string) => string, readonly: boolean): BlobSource {
  return {
    address,
    upload: async (file: Blob): Promise<string> => {
      if (readonly) throw new ImageRefused(false);
      if (file.size > MAX_BLOB_BYTES) throw new ImageRefused(true);

      const id = freshBlobId();
      const answer = await fetch(address(id), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file
      }).catch(() => null);

      if (answer === null || !answer.ok) throw new ImageRefused(answer?.status === 413);

      return id;
    }
  };
}

/** The images of one note: its own image routes, naming the owner where the note is another account's shared
 * with the reader, read only where the share opens no writes. */
export function noteBlobSource(noteId: string, owner?: string, readonly = false): BlobSource {
  const query = owner === undefined ? "" : `?owner=${encodeURIComponent(owner)}`;

  return blobSource((blobId) => relayAddress(SERVICE, `/notes/${encodeURIComponent(noteId)}/blobs/${encodeURIComponent(blobId)}${query}`), readonly);
}

/** The images of the note a link opens: its share read, read only (`docs/api.md`, 「Share reads」). */
export function sharedBlobSource(token: string): BlobSource {
  return blobSource((blobId) => relayAddress(SERVICE, `/shares/${encodeURIComponent(token)}/blobs/${encodeURIComponent(blobId)}`), true);
}
