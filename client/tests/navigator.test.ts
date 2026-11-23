import { describe, expect, test } from "bun:test";

import { ancestorsOf, base64url, cursorOf, defaultPrefs, folderOrder, folderTree, holdsFolder, notePath, prefsOf, withOpen, withWide } from "../app/domain/navigator";

import type { NoteFolder, NoteMeta } from "../shared/types";

// The navigator's own reading (docs/design.md, 「The console surface」; docs/api.md, 「Notes」): the cursor a
// section's next page is read by in each order, the address a row opens at, and what the reader set for
// it in this browser, read back whatever was kept.

function note(over: Partial<NoteMeta> = {}): NoteMeta {
  return { id: "n1", owner: "1", title: "Plan: draft", version: 1, createdAt: 10, changedAt: 20, size: 3, deletedAt: null, access: "owner", icon: "", folder: null, ...over };
}

describe("the cursor", () => {
  test("carries the last row's key in the order named, and its owner in the shared view", () => {
    expect(cursorOf("changed", note(), false)).toBe("20:n1");
    expect(cursorOf("created", note(), false)).toBe("10:n1");
    expect(cursorOf("changed", note({ owner: "a:b" }), true)).toBe("20:n1:a:b");
  });

  test("carries a title as unpadded base64url of its UTF-8, so its colons part nothing", () => {
    const cursor = cursorOf("title", note(), false);

    expect(cursor).toBe(`${base64url("Plan: draft")}:n1`);
    expect(cursor.split(":")).toHaveLength(2);
    expect(base64url("ÿþ?")).not.toMatch(/[+/=]/);
    expect(Buffer.from(base64url("\uc608\uc0b0"), "base64url").toString("utf8")).toBe("\uc608\uc0b0");
  });
});

describe("the address a row opens at", () => {
  test("names the owner of another account's note, and the trash for a trashed one", () => {
    expect(notePath(note())).toBe("/note/n1");
    expect(notePath(note({ access: "read", owner: "2" }))).toBe("/note/n1?owner=2");
    expect(notePath(note({ deletedAt: 5 }))).toBe("/note/n1?trash=1");
  });
});

describe("the prefs", () => {
  test("read back what was kept, each part that does not read standing at its default", () => {
    expect(prefsOf(null)).toEqual(defaultPrefs());
    expect(prefsOf({ folded: { mine: true, shared: "yes" }, sorts: { mine: "title", shared: "size" }, wide: ["1/a", 3], open: ["f1", null] })).toEqual({
      folded: { bookmarks: false, mine: true, shared: false },
      sorts: { mine: "title", shared: "changed" },
      wide: ["1/a"],
      open: ["f1"]
    });
  });

  test("unfold and fold a folder", () => {
    const open = withOpen(defaultPrefs(), "f1", true);

    expect(open.open).toEqual(["f1"]);
    expect(withOpen(open, "f1", true).open).toEqual(["f1"]);
    expect(withOpen(open, "f1", false).open).toEqual([]);
  });

  test("turn a note's full width on and off", () => {
    const on = withWide(defaultPrefs(), "1/a", true);

    expect(on.wide).toEqual(["1/a"]);
    expect(withWide(on, "1/a", true).wide).toEqual(["1/a"]);
    expect(withWide(on, "1/a", false).wide).toEqual([]);
  });
});

function folder(id: string, parent: string | null, name = id): NoteFolder {
  return { id, parent, name, createdAt: 1 };
}

describe("the folder tree", () => {
  // As the service answers them: by name.
  const folders = [folder("a", null, "Alpha"), folder("c", "b", "Charlie"), folder("b", "a", "Bravo"), folder("z", null, "Zulu"), folder("o", "gone", "Orphan")];

  test("stands each folder under its parent, a folder whose parent is gone at the top", () => {
    const tree = folderTree(folders);

    expect(tree.map((node) => node.folder.id)).toEqual(["a", "z", "o"]);
    expect(folderOrder(tree).map((node) => `${node.folder.id}:${node.depth}`)).toEqual(["a:0", "b:1", "c:2", "z:0", "o:0"]);
  });

  test("names the folders one stands in, the top one first, and whether one holds another", () => {
    expect(ancestorsOf(folders, "c")).toEqual(["a", "b"]);
    expect(ancestorsOf(folders, "a")).toEqual([]);
    expect(holdsFolder(folders, "a", "c")).toBe(true);
    expect(holdsFolder(folders, "c", "c")).toBe(true);
    expect(holdsFolder(folders, "c", "a")).toBe(false);
  });

  test("never walks round a loop", () => {
    const looped = [folder("x", "y"), folder("y", "x")];

    expect(ancestorsOf(looped, "x")).toEqual(["y"]);
    expect(folderOrder(folderTree(looped))).toEqual([]);
  });
});
