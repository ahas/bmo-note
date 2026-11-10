import { describe, expect, test } from "bun:test";

import { holdsChange, initialSaveState, nextSaveState, versionOf } from "../app/domain/save";

import type { NoteMeta } from "../shared/types";

// The autosave machine (`app/domain/save.ts`): a change never stands lost, a save on its way carries
// what came after it, and a conflict keeps the standing version for the reader to act on.

function held(over: Partial<NoteMeta> = {}): NoteMeta {
  return { id: "a1", title: "Groceries", version: 3, createdAt: 1, changedAt: 2, size: 10, deletedAt: null, ...over };
}

describe("the save machine", () => {
  test("a change queues behind a save that is already on its way", () => {
    const saved = initialSaveState(held());

    expect(holdsChange(saved)).toBe(false);

    const queued = nextSaveState(saved, { type: "edited" });

    expect(queued).toEqual({ kind: "queued", version: 3 });

    const saving = nextSaveState(queued, { type: "flush" });

    expect(saving).toEqual({ kind: "saving", version: 3 });
    expect(nextSaveState(saving, { type: "edited" })).toBe(saving);
  });

  test("an answered save makes the screen clean at the answered version", () => {
    const saving = nextSaveState(nextSaveState(initialSaveState(held()), { type: "edited" }), { type: "flush" });
    const answered = nextSaveState(saving, { type: "answered", meta: held({ version: 4 }) });

    expect(answered).toEqual({ kind: "saved", version: 4 });
    expect(holdsChange(answered)).toBe(false);
  });

  test("a change after an answer queues again at the answered version", () => {
    const clean = nextSaveState(initialSaveState(held()), { type: "answered", meta: held({ version: 4 }) });

    expect(nextSaveState(clean, { type: "edited" })).toEqual({ kind: "queued", version: 4 });
  });

  test("a call that never landed keeps the change and names the version to save at", () => {
    const queued = nextSaveState(initialSaveState(held()), { type: "edited" });
    const saving = nextSaveState(queued, { type: "flush" });
    const offline = nextSaveState(saving, { type: "unreachable" });

    expect(offline).toEqual({ kind: "offline", version: 3 });
    expect(versionOf(offline)).toBe(3);
    expect(holdsChange(offline)).toBe(true);
    expect(nextSaveState(offline, { type: "flush" }).kind).toBe("saving");
  });

  test("a conflict stands on the service's version, not the writer's", () => {
    const conflict = nextSaveState(nextSaveState(initialSaveState(held()), { type: "flush" }), { type: "conflict", note: held({ version: 9 }) });

    expect(conflict.kind).toBe("conflict");
    expect(versionOf(conflict)).toBe(9);
    expect(holdsChange(conflict)).toBe(true);
    expect(nextSaveState(conflict, { type: "flush" })).toBe(conflict);
  });

  test("a refusal keeps the change, and a reload clears the screen", () => {
    const refused = nextSaveState(nextSaveState(initialSaveState(held()), { type: "edited" }), { type: "refused", code: "too-large" });

    expect(refused).toEqual({ kind: "refused", code: "too-large", version: 3 });

    const reloaded = nextSaveState(refused, { type: "reloaded", meta: held({ version: 4 }) });

    expect(reloaded).toEqual({ kind: "saved", version: 4 });
  });
});
