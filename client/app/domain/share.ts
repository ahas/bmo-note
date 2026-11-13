// The roads the share dialog is handed for one note (`docs/design.md`, 「Sharing on the screens」): the
// link road over the note's link on the service, and the member road over the console's people directory
// and the note's members on the service. The dialog calls nothing itself; these roads are the bundle's
// whole say in where a link and a share are kept.

import type { ShareLink, ShareRoad, ShareSpan } from "bmo-ui/app/domain/share-links";
import type { ShareMember, ShareMemberRoad, SharePerson } from "bmo-ui/app/domain/share-members";
import type { NoteApi } from "./api";
import type { NoteLink } from "../../shared/types";

/** The key the console offers its people directory under (bmo-ui `docs/console-bundles.md`, the people
 * directory). */
export const CONSOLE_PEOPLE = "bmo-console-people";

/** The console's people directory as a screen reads it: the people of the reader's company. */
export interface ConsolePeople {
  search: (words: string) => Promise<SharePerson[]>;
  person: (user: string) => Promise<SharePerson | null>;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The spans a link is offered for: each its value, the word it is chosen by, and how long it lives,
 * none for a link that never ends. */
export const LINK_SPANS = [
  { value: "1d", label: "note.share.span_day", ms: DAY_MS },
  { value: "7d", label: "note.share.span_week", ms: 7 * DAY_MS },
  { value: "30d", label: "note.share.span_month", ms: 30 * DAY_MS },
  { value: "forever", label: "note.share.span_forever", ms: null }
] as const;

/** The span offered first. */
export const FIRST_SPAN = "7d";

/** The spans as the dialog offers them, in the reader's words. */
export function linkSpans(t: (key: string) => string): ShareSpan[] {
  return LINK_SPANS.map((span) => ({ value: span.value, label: t(span.label) }));
}

/** The address a link's token opens: the note's share page under the console's own address. */
export function sharePage(token: string): string {
  return `/note/share/${encodeURIComponent(token)}`;
}

function dialogLink(link: NoteLink): ShareLink {
  return { token: link.token, expiresAt: link.expiresAt === null ? null : Math.floor(link.expiresAt / 1000) };
}

/** The link road of the reader's own note `id`. `now` is the clock a span is counted from. */
export function linkRoad(api: NoteApi, id: string, now: () => number = Date.now): ShareRoad {
  return {
    page: (link) => sharePage(link.token),
    read: async () => {
      const link = await api.link(id);

      return link === null ? null : dialogLink(link);
    },
    make: async (span) => {
      const ms = LINK_SPANS.find((one) => one.value === span)?.ms ?? null;

      return dialogLink(await api.makeLink(id, ms === null ? null : now() + ms));
    },
    remove: () => api.endLink(id)
  };
}

/** A person as the directory answers the key, or the key standing for them where it answers none. */
async function personOf(people: ConsolePeople, user: string): Promise<SharePerson> {
  const found = await people.person(user).catch(() => null);

  return found ?? { user, name: user, organization: "", jobTitle: "" };
}

/** The member road of the reader's own note `id`: people found in the console's directory, who the note
 * is shared with kept on the service. */
export function memberRoad(api: NoteApi, people: ConsolePeople, id: string): ShareMemberRoad {
  return {
    search: (words) => people.search(words),
    read: async () => {
      const members = await api.members(id);

      return Promise.all(members.map(async (member): Promise<ShareMember> => ({ person: await personOf(people, member.user), permission: member.permission })));
    },
    share: async (users, permission) => {
      await api.share(id, users, permission);
    },
    change: async (user, permission) => {
      await api.changeMember(id, user, permission);
    },
    remove: (user) => api.unshare(id, user)
  };
}
