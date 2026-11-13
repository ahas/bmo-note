import { describe, expect, test } from "bun:test";

import { FIRST_SPAN, LINK_SPANS, linkRoad, memberRoad, sharePage } from "../app/domain/share";

import type { NoteApi } from "../app/domain/api";
import type { ConsolePeople } from "../app/domain/share";
import type { MemberPermission, NoteLink, NoteMember } from "../shared/types";

// The roads the share dialog is handed for one note (`docs/design.md`, 「Sharing on the screens」): the link
// read and made in the dialog's terms, and the members drawn by the people directory's names.

const NOW = 1_700_000_000_000;

/** A stand-in of the note service's sharing calls, keeping one note's link and members. */
function standIn(): { api: NoteApi; made: (number | null)[]; members: NoteMember[] } {
  let link: NoteLink | null = null;
  const made: (number | null)[] = [];
  const members: NoteMember[] = [];
  const sharing: Partial<NoteApi> = {
    link: async () => link,
    makeLink: async (id, expiresAt) => {
      made.push(expiresAt);
      link = { token: "tok", noteId: id, createdAt: NOW, expiresAt };

      return link;
    },
    endLink: async () => {
      link = null;
    },
    members: async () => [...members],
    share: async (_id, users, permission: MemberPermission) => {
      for (const user of users) members.push({ user, permission, sharedAt: NOW });

      return [...members];
    },
    changeMember: async (_id, user, permission) => {
      const member = members.find((one) => one.user === user)!;

      member.permission = permission;

      return member;
    },
    unshare: async (_id, user) => {
      members.splice(
        members.findIndex((one) => one.user === user),
        1
      );
    }
  };

  return { api: sharing as NoteApi, made, members };
}

const people: ConsolePeople = {
  search: async (words) => (words === "kim" ? [{ user: "2", name: "Kim", organization: "Lab", jobTitle: "Engineer" }] : []),
  person: async (user) => (user === "2" ? { user, name: "Kim", organization: "Lab", jobTitle: "Engineer" } : null)
};

describe("the link road", () => {
  test("makes a link for the span chosen and hands the dialog its end in seconds", async () => {
    const { api, made } = standIn();
    const road = linkRoad(api, "n1", () => NOW);

    expect(LINK_SPANS.some((span) => span.value === FIRST_SPAN)).toBe(true);
    expect(await road.read()).toBeNull();

    const link = await road.make("7d");

    expect(made).toEqual([NOW + 7 * 24 * 60 * 60 * 1000]);
    expect(link).toEqual({ token: "tok", expiresAt: (NOW + 7 * 24 * 60 * 60 * 1000) / 1000 });
    expect(road.page(link)).toBe(sharePage("tok"));
    expect(sharePage("tok")).toBe("/note/share/tok");

    await road.remove(link);

    expect(await road.read()).toBeNull();
    expect((await road.make("forever")).expiresAt).toBeNull();
  });
});

describe("the member road", () => {
  test("shares with people the directory finds and draws each member by the name it answers", async () => {
    const { api } = standIn();
    const road = memberRoad(api, people, "n1");

    expect((await road.search("kim")).map((person) => person.user)).toEqual(["2"]);

    await road.share(["2", "9"], "read");
    await road.change("2", "edit");

    expect(await road.read()).toEqual([
      { person: { user: "2", name: "Kim", organization: "Lab", jobTitle: "Engineer" }, permission: "edit" },
      { person: { user: "9", name: "9", organization: "", jobTitle: "" }, permission: "read" }
    ]);

    await road.remove("9");

    expect((await road.read()).map((member) => member.person.user)).toEqual(["2"]);
  });
});
