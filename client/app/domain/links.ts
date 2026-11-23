// Note links (`docs/design.md`, 「Note links」): where a link leads, as a path of the notes screen, and the
// notes the link menus offer — the reader's most recently opened while nothing follows the mark, else the
// notes whose title holds what is typed, as the service's search finds them across the reader's own notes and
// those shared with them.

import type { NoteApi } from "./api";
import type { NoteMeta } from "../../shared/types";

/** The note a link names: its id and its owner's key. */
export interface LinkTarget {
  id: string;
  owner: string;
}

/** How many notes a link menu offers. */
export const LINK_CHOICES = 8;

/** The notes screen's path of a linked note: the reader's own by its id, another account's naming its owner.
 * The reader is known by their own key where the screen knows it; a link naming the reader's own key with
 * no key known reads as another's, which the service answers as the reader's own all the same. */
export function linkPath(target: LinkTarget, readerKey: string | null): string {
  const id = encodeURIComponent(target.id);

  return target.owner === "" || target.owner === readerKey ? `/note/${id}` : `/note/${id}?owner=${encodeURIComponent(target.owner)}`;
}

/** One note as a link menu draws it: the note mark, its title (the untitled word where it has none), whose
 * note it is where it is another's, and the attributes the link takes. */
export function candidateOf(note: Pick<NoteMeta, "id" | "owner" | "title" | "access">, untitled: string, ownerName: (key: string) => string): { id: string; owner: string; label: string; icon: string; description?: string } {
  return {
    id: note.id,
    owner: note.owner,
    label: note.title.trim() === "" ? untitled : note.title,
    icon: "i-material-symbols-description-outline",
    ...(note.access === "owner" ? {} : { description: ownerName(note.owner) })
  };
}

/** The notes a link menu offers for `term`. */
export async function linkCandidates(api: NoteApi, term: string): Promise<NoteMeta[]> {
  if (term === "") return (await api.recent(LINK_CHOICES)).slice(0, LINK_CHOICES);

  const page = await api.search({ q: term, views: ["mine", "shared"], titleOnly: true, since: null, sort: "best", after: 0, limit: LINK_CHOICES });

  return page.items;
}
