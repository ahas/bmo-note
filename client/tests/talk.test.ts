import { describe, expect, test } from "bun:test";

import { fencedAnswer, TALK_HEADING } from "../app/domain/talk";

// The talk's answer (`docs/design.md`, 「The AI talk panel」): one fenced block holds the whole edited
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

describe("the heading", () => {
  test("states the line grammar and the one fenced answer", () => {
    expect(TALK_HEADING).toContain("one fenced code block");
    expect(TALK_HEADING).toContain("[[image]]");
    expect(TALK_HEADING).toContain("two spaces per level");
  });
});
