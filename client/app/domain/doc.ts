// One note's document: the BlockSuite store the editor mounts on, made from the bytes the service
// holds or empty for a new note, with the title `domain/title` derives from it and the serialised
// state the save writes back (`docs/design.md`, 「What a note is」).

import { getInternalStoreExtensions } from "@blocksuite/affine/extensions/store";
import { StoreExtensionManager } from "@blocksuite/affine/ext-loader";
import { Text } from "@blocksuite/affine/store";
import { TestWorkspace } from "@blocksuite/affine/store/test";
import * as Y from "yjs";

import { noteBlobSource } from "./blobs";
import { noteTitle } from "./title";

import type { Titlable } from "./title";
import type { Doc, Store } from "@blocksuite/affine/store";
import { containEditorStyles } from "./contain";

/// The editor's container is a Lit custom element of the vendored preset; the effects module exports
/// the call that defines it (importing the module alone brings the preset's own elements and nothing
/// of the container). The Vue component mounts the element by hand once it stands defined.
let containerRegistered: Promise<void> | null = null;

/** Define the editor container element once per document (the bundle's own lifetime). */
export function ensureEditorRegistered(): Promise<void> {
  // The editor's stylesheets are held to its host from before its first one is laid.
  containEditorStyles();
  containerRegistered ??= import("@blocksuite/integration-test/effects").then((effects) => effects.effects());

  return containerRegistered;
}

export interface NoteDoc {
  readonly store: Store;
  /** The whole Yjs state, as the service stores it. */
  serialize: () => Uint8Array;
  /** The text of the note's title: the root block's own where it stands, else the first line of its
   * content, so the list names the note the way the editor shows it. */
  title: () => string;
  /** Run `work` for every change to the document, remote ones included (there are none: the unit has
   * no live sync; one writer per note is the truth, `docs/design.md`, 「Editing and saving」). */
  onChange: (work: () => void) => () => void;
  dispose: () => void;
}

function collection(id: string): TestWorkspace {
  // Each block's store extension carries its own schema; the store needs none named outright. The
  // meta must be initialized before a doc is made, or the added doc meta lands nowhere and the
  // document stands null — the order every use of this test workspace in the fork keeps. The blob
  // source is the note's own on the service, so an image block never stands on bytes no store holds
  // (`docs/design.md`, 「Storage」).
  const made = new TestWorkspace({ id, blobSources: { main: noteBlobSource(id) } });

  made.storeExtensions = new StoreExtensionManager(getInternalStoreExtensions()).get("store");
  made.meta.initialize();
  made.start();

  return made;
}

/** The first paragraph of an empty note, ready for the caret. */
function seed(doc: Doc): void {
  doc.load(() => {
    const store = doc.getStore();
    const rootId = store.addBlock("affine:page", { title: new Text() });

    store.addBlock("affine:surface", {}, rootId);

    const noteId = store.addBlock("affine:note", {}, rootId);

    store.addBlock("affine:paragraph", {}, noteId);
  });
  doc.getStore().resetHistory();
}

/** A new, empty document, standing where a note the service has never held stands. */
export function emptyNoteDoc(id: string): NoteDoc {
  const workspace = collection(id);
  const doc = workspace.createDoc(id);

  seed(doc);

  return hold(workspace, doc);
}

/** The document from the bytes the service answered, made empty where the bytes read nothing. */
export function openNoteDoc(id: string, bytes: Uint8Array): NoteDoc {
  const workspace = collection(id);
  const doc = workspace.createDoc(id);

  if (bytes.byteLength > 0) Y.applyUpdate(doc.spaceDoc, bytes);
  else seed(doc);

  return hold(workspace, doc);
}

function hold(workspace: TestWorkspace, doc: Doc): NoteDoc {
  const store = doc.getStore();

  // The store's own load arms its extensions, the history extension among them: the fork readies
  // undo and redo only from an extension's `loaded` hook, which the store's load dispatches and the
  // test workspace's doc load does not touch, so an unloaded store answers `canUndo` false forever
  // and the editor's undo keys stand dead (`docs/design.md`, 「Editing and saving」).
  store.load();

  return {
    store,
    serialize: () => Y.encodeStateAsUpdate(doc.spaceDoc),
    title: () => noteTitle(store.root as unknown as Titlable | null),
    onChange: (work) => {
      const listener = () => work();

      doc.spaceDoc.on("update", listener);

      return () => doc.spaceDoc.off("update", listener);
    },
    dispose: () => {
      doc.dispose();
      workspace.dispose();
    }
  };
}

/** Bytes as they travel on the wire, and back (`docs/api.md`, 「The boundary API」). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const chunk of chunksOf(bytes)) binary += String.fromCharCode(...chunk);

  return btoa(binary);
}

export function fromBase64(travel: string): Uint8Array {
  const binary = atob(travel);
  const bytes = new Uint8Array(binary.length);

  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);

  return bytes;
}

function chunksOf(bytes: Uint8Array, size = 0x8000): Uint8Array[] {
  const made: Uint8Array[] = [];

  for (let from = 0; from < bytes.length; from += size) made.push(bytes.subarray(from, from + size));

  return made;
}
