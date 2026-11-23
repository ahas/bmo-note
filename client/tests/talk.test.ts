import { describe, expect, test } from "bun:test";

import { fencedAnswer, noteAnswer } from "../app/domain/talk";

// The talk's answer (`docs/design.md`, 「The talk panel」): one fenced block holds the whole edited
// note; an answer without a closed one changes nothing.

describe("fencedAnswer", () => {
  test("the block's lines answer, the words around it do not", () => {
    expect(fencedAnswer("Here it is.\n```\n# Budget\n- milk\n```\nAnything else?")).toEqual(["# Budget", "- milk"]);
  });

  test("a language after the opening fence still opens the block", () => {
    expect(fencedAnswer("```text\nfirst\nsecond\n```")).toEqual(["first", "second"]);
  });

  test("the answer may end on the closing fence", () => {
    expect(fencedAnswer("```\nonly line\n```")).toEqual(["only line"]);
  });

  test("an unclosed block changes nothing", () => {
    expect(fencedAnswer("```\na line\n")).toBeNull();
  });

  test("words alone change nothing", () => {
    expect(fencedAnswer("I would change the second line.")).toBeNull();
  });

  test("a code line inside the block does not close it", () => {
    expect(fencedAnswer("```\n```\tlet a = 1;\n```")).toEqual(["```\tlet a = 1;"]);
  });

  test("a blank line inside the block stands as its own line", () => {
    expect(fencedAnswer("```\na\n\nb\n```")).toEqual(["a", "", "b"]);
  });

  test("Windows line endings read the same", () => {
    expect(fencedAnswer("```\r\na\r\nb\r\n```")).toEqual(["a", "b"]);
  });
});

describe("noteAnswer", () => {
  test("a block with no title line answers as lines alone", () => {
    expect(noteAnswer("```\n# T\n- a\n```")).toEqual({ lines: ["# T", "- a"], title: null });
  });

  test("a title line rides above the lines and comes off them", () => {
    expect(noteAnswer("```\n[[title]] Weekly log\n# T\n- a\n```")).toEqual({ lines: ["# T", "- a"], title: "Weekly log" });
  });

  test("a title is the answer's first line only, and a word with marks around it", () => {
    expect(noteAnswer("```\n# T\n[[title]] late\n```")).toEqual({ lines: ["# T", "[[title]] late"], title: null });
    expect(noteAnswer("```\n[[title]]   spaced   \n```")).toEqual({ lines: [], title: "spaced" });
  });

  test("a title line carrying nothing renames nothing and stands off the lines", () => {
    expect(noteAnswer("```\n[[title]] \na\n```")).toEqual({ lines: ["a"], title: null });
  });

  test("an escaped title mark reads as the paragraph it is", () => {
    expect(noteAnswer("```\n\\[[title]] not a rename\n```")).toEqual({ lines: ["\\[[title]] not a rename"], title: null });
  });

  test("a rename alone is an answer with no lines", () => {
    expect(noteAnswer("```\n[[title]] Renamed\n```")).toEqual({ lines: [], title: "Renamed" });
  });

  test("an unclosed block changes nothing, title included", () => {
    expect(noteAnswer("```\n[[title]] cut off\n")).toBeNull();
  });
});
