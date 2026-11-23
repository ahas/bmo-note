import { describe, expect, test } from "bun:test";

import { base64url, cursorOf, defaultPrefs, notePath, prefsOf, withWide } from "../app/domain/navigator";

import type { NoteMeta } from "../shared/types";

// The navigator's own reading (docs/design.md, 「The console surface」; docs/api.md, 「Notes」): the cursor a
// section's next page is read by in each order, the address a row opens at, and what the reader set for
// it in this browser, read back whatever was kept.

function note(over: Partial<NoteMeta> = {}): NoteMeta {
  return { id: "n1", owner: "1", title: "Plan: draft", version: 1, createdAt: 10, changedAt: 20, size: 3, deletedAt: null, access: "owner", icon: "", ...over };
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
    expect(prefsOf({ folded: { mine: true, shared: "yes" }, sorts: { mine: "title", shared: "size" }, wide: ["1/a", 3] })).toEqual({
      folded: { pinned: false, mine: true, shared: false },
      sorts: { mine: "title", shared: "changed" },
      wide: ["1/a"]
    });
  });

  test("turn a note's full width on and off", () => {
    const on = withWide(defaultPrefs(), "1/a", true);

    expect(on.wide).toEqual(["1/a"]);
    expect(withWide(on, "1/a", true).wide).toEqual(["1/a"]);
    expect(withWide(on, "1/a", false).wide).toEqual([]);
  });
});
