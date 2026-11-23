// The migration (`docs/design.md`, 「What a note is」, 「Storage」): every note of a store whose document the
// earlier BlockSuite editor wrote, read headless by that editor's own store and transformer out of its Yjs
// bytes, converted to the TipTap document the note editor keeps, and written back in one transaction —
// the former bytes kept in `legacy_docs` beside the note, the version held up by one so a page open on the
// old document is refused rather than merged, and the note's search row marked for the service to derive
// again as it next opens. A note whose document is already of the new format is passed over, so the run
// is idempotent. Each note's words are compared before and after; a note whose words differ is reported
// and, unless `--force` is given, nothing at all is written.
//
//   migrate --store <path> [--dry-run] [--force]
//
// It reads and writes the store directly, so it runs while the service is stopped.

import { Database } from "bun:sqlite";
import { getInternalStoreExtensions } from "@blocksuite/affine/extensions/store";
import { StoreExtensionManager } from "@blocksuite/affine/ext-loader";
import { TestWorkspace } from "@blocksuite/affine/store/test";
import * as Y from "yjs";

import { comparable, convertSnapshot, documentWords, snapshotWords } from "./convert";

import type { SnapshotBlock } from "./convert";

/** The table the former documents are kept in, as the service makes it (`src/store.rs`). */
const LEGACY_TABLE = `CREATE TABLE IF NOT EXISTS legacy_docs (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  doc BLOB NOT NULL,
  migrated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, note)
)`;

interface Row {
  owner: string;
  id: string;
  doc: Uint8Array;
  deleted_at: number | null;
}

/** One note's outcome, as the report lists it: no words of a note stand in it. */
interface Outcome {
  owner: string;
  id: string;
  trashed: boolean;
  outcome: "converted" | "already" | "skipped";
  why?: string;
  /** How many characters of words the note held before and after, white space aside. */
  words?: [number, number];
  /** What changed shape on the way. */
  notes?: string[];
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);

  return at < 0 ? undefined : process.argv[at + 1];
}

/** Whether stored bytes already hold a TipTap document. */
function converted(bytes: Uint8Array): boolean {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { type?: unknown; content?: unknown };

    return doc.type === "doc" && Array.isArray(doc.content);
  } catch {
    return false;
  }
}

/** The editor's workspace, as the console bundle made it: every block's store extension, so every flavour
 * the fork knows reads. */
function workspace(): TestWorkspace {
  const made = new TestWorkspace({ id: "migration" });

  made.storeExtensions = new StoreExtensionManager(getInternalStoreExtensions()).get("store");
  made.meta.initialize();
  made.start();

  return made;
}

/** A note's snapshot, read by BlockSuite's own store and transformer out of its bytes. */
function snapshotOf(space: TestWorkspace, row: Row): SnapshotBlock {
  const doc = space.createDoc(`${row.owner}\u0000${row.id}`);

  Y.applyUpdate(doc.spaceDoc, row.doc);
  doc.load();

  const snapshot = doc.getStore().getTransformer().docToSnapshot(doc.getStore()) as { blocks?: SnapshotBlock } | undefined;

  if (snapshot?.blocks === undefined) throw new Error("the transformer read no blocks");

  return snapshot.blocks;
}

function main(): number {
  const path = argument("--store");
  const dry = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");

  if (path === undefined) {
    console.error("usage: migrate --store <path> [--dry-run] [--force]");

    return 2;
  }

  const store = new Database(path, { readwrite: true, create: false });
  const rows = store.query("SELECT owner, id, doc, deleted_at FROM notes ORDER BY owner, id").all() as Row[];
  const space = workspace();
  const outcomes: Outcome[] = [];
  const writes: Array<{ row: Row; doc: string }> = [];

  for (const row of rows) {
    const base = { owner: row.owner, id: row.id, trashed: row.deleted_at !== null };

    if (converted(row.doc)) {
      outcomes.push({ ...base, outcome: "already" });
      continue;
    }

    try {
      const snapshot = snapshotOf(space, row);
      const { doc, notes } = convertSnapshot(snapshot, { owner: row.owner });
      const before = comparable(snapshotWords(snapshot));
      const after = comparable(documentWords(doc));
      const outcome: Outcome = { ...base, outcome: "converted", words: [before.length, after.length], notes };

      if (before !== after) outcome.notes = [...notes, "words differ"];

      outcomes.push(outcome);
      writes.push({ row, doc: JSON.stringify(doc) });
    } catch (why) {
      outcomes.push({ ...base, outcome: "skipped", why: why instanceof Error ? why.message : String(why) });
    }
  }

  const differing = outcomes.filter((one) => one.notes?.includes("words differ") === true);
  const blocked = differing.length > 0 && !force;

  if (!dry && !blocked && writes.length > 0) {
    const at = Date.now();

    store.run("BEGIN IMMEDIATE");

    try {
      store.run(LEGACY_TABLE);

      for (const { row, doc } of writes) {
        // The note is converted only where it still holds the bytes this run read.
        const changed = store.run("UPDATE notes SET doc = ?3, version = version + 1 WHERE owner = ?1 AND id = ?2 AND doc = ?4", [row.owner, row.id, new TextEncoder().encode(doc), row.doc]);

        if (changed.changes !== 1) throw new Error(`note ${row.owner}/${row.id} changed while the run read it`);

        store.run("INSERT INTO legacy_docs (owner, note, doc, migrated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (owner, note) DO NOTHING", [row.owner, row.id, row.doc, at]);
        store.run("UPDATE texts SET indexed = 0 WHERE owner = ?1 AND note = ?2", [row.owner, row.id]);
      }

      store.run("COMMIT");
    } catch (why) {
      store.run("ROLLBACK");
      throw why;
    }
  }

  const count = (kind: Outcome["outcome"]): number => outcomes.filter((one) => one.outcome === kind).length;
  const report = {
    store: path,
    written: !dry && !blocked && writes.length > 0,
    dryRun: dry,
    notes: outcomes.length,
    converted: count("converted"),
    alreadyConverted: count("already"),
    skipped: count("skipped"),
    wordsDiffer: differing.length,
    outcomes
  };

  console.log(JSON.stringify(report, null, 2));

  if (blocked) console.error(`${differing.length} notes' words differ after the conversion; nothing was written (--force writes all the same).`);

  return count("skipped") > 0 || blocked ? 1 : 0;
}

// The editor's workspace keeps timers of its own, so the run ends the process itself.
process.exit(main());
