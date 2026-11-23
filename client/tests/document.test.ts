import { describe, expect, test } from "bun:test";

import { orderedThreads } from "../app/composables/useComments";
import { changedRange, emptyDoc } from "../app/domain/document";
import { activeKind } from "../app/domain/format";
import { candidateOf, linkPath } from "../app/domain/links";

import type { NoteThread } from "../shared/types";

// The open document written back block by block, the comments panel's order, the note links' paths and the
// format bar's reading of the block under the caret (`docs/design.md`, 「Editing and saving」, 「Comments」,
// 「Note links」, 「The console surface」).

describe("changedRange", () => {
  test("names the blocks the same at the front and at the end", () => {
    const a = { type: "paragraph", content: [{ type: "text", text: "a" }] };
    const b = { type: "paragraph", content: [{ type: "text", text: "b" }] };
    const c = { type: "paragraph", content: [{ type: "text", text: "c" }] };

    expect(changedRange([a, b, c], [a, c])).toEqual({ front: 1, back: 1 });
    expect(changedRange([a, b], [a, b])).toEqual({ front: 2, back: 0 });
    expect(changedRange([a], [b])).toEqual({ front: 0, back: 0 });
  });

  test("a new note is an empty title and one paragraph", () => {
    expect(emptyDoc()).toEqual({ type: "doc", content: [{ type: "title" }, { type: "paragraph" }] });
  });
});

describe("orderedThreads", () => {
  const thread = (id: string, resolved = false): NoteThread => ({
    id,
    quote: id,
    author: "1",
    createdAt: 1,
    resolvedAt: resolved ? 2 : null,
    resolvedBy: resolved ? "1" : null,
    anchored: true,
    mine: true,
    comments: []
  });

  test("open threads by where their words stand, then those whose words went, then the resolved", () => {
    const places = new Map([
      ["late", 40],
      ["early", 3],
      ["done", 10]
    ]);
    const ordered = orderedThreads([thread("late"), thread("gone"), thread("done", true), thread("early")], places);

    expect(ordered.open.map((one) => one.id)).toEqual(["early", "late"]);
    expect(ordered.detached.map((one) => one.id)).toEqual(["gone"]);
    expect(ordered.resolved.map((one) => one.id)).toEqual(["done"]);
  });
});

describe("linkPath", () => {
  test("the reader's own note by its id, another's naming its owner", () => {
    expect(linkPath({ id: "n 1", owner: "7" }, "7")).toBe("/note/n%201");
    expect(linkPath({ id: "n1", owner: "8" }, "7")).toBe("/note/n1?owner=8");
    expect(linkPath({ id: "n1", owner: "8" }, null)).toBe("/note/n1?owner=8");
  });

  test("a candidate names an untitled note by the untitled word and another's by its owner", () => {
    const named = (key: string) => `person ${key}`;

    expect(candidateOf({ id: "a", owner: "1", title: "", access: "owner" }, "Untitled", named)).toEqual({ id: "a", owner: "1", label: "Untitled", icon: "i-material-symbols-description-outline" });
    expect(candidateOf({ id: "b", owner: "2", title: "Plan", access: "read" }, "Untitled", named).description).toBe("person 2");
  });
});

describe("activeKind", () => {
  test("reads the innermost kind first", () => {
    const active = (names: string[], level?: number) => ({
      isActive: (name: string, attrs?: Record<string, unknown>) => names.includes(name) && (attrs?.level === undefined || attrs.level === level)
    });

    expect(activeKind(active(["bulletList", "paragraph"]))).toBe("bulleted");
    expect(activeKind(active(["heading"], 2))).toBe("h2");
    expect(activeKind(active(["paragraph"]))).toBe("text");
    expect(activeKind(active([]))).toBeNull();
  });
});
