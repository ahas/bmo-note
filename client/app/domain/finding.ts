// The search dialog's state as the address carries it (`docs/design.md`, 「Search」): the words asked, the
// order, the views and the filters, written under the screen's query only where they differ from the
// defaults, so a search is linked whole and an address with no search opens none. What the service is
// asked is built from it here, and so is the one term the layer's list-search marking is handed.

import type { FoundNote, SearchAsk, SearchSort, SearchView } from "../../shared/types";

/** How far back a search's edits reach: any time, today, or the last 7 or 30 days. */
export type SearchSpan = "any" | "today" | "7d" | "30d";

export const SEARCH_SORTS: readonly SearchSort[] = ["best", "changed", "created"];
export const SEARCH_VIEWS: readonly SearchView[] = ["mine", "shared", "trash"];
export const SEARCH_SPANS: readonly SearchSpan[] = ["any", "today", "7d", "30d"];

/** The views searched where none are named. */
export const DEFAULT_VIEWS: readonly SearchView[] = ["mine", "shared"];

/** How many rows one search reads. */
export const FOUND_PAGE = 20;

/** The query keys a search stands under in the address. */
export const SEARCH_KEYS = ["search", "sort", "in", "title", "since"] as const;

/** A search as the dialog holds it. */
export interface Finding {
  words: string;
  sort: SearchSort;
  views: SearchView[];
  titleOnly: boolean;
  span: SearchSpan;
}

export function emptyFinding(): Finding {
  return { words: "", sort: "best", views: [...DEFAULT_VIEWS], titleOnly: false, span: "any" };
}

function first(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;

  return typeof one === "string" ? one : null;
}

/** The search an address's query names, or null where it names none. */
export function findingOf(query: Record<string, unknown>): Finding | null {
  const words = first(query.search);

  if (words === null) return null;

  const finding = emptyFinding();
  const sort = first(query.sort);
  const views = first(query.in);
  const span = first(query.since);

  finding.words = words;
  if (SEARCH_SORTS.includes(sort as SearchSort)) finding.sort = sort as SearchSort;
  if (views !== null) finding.views = SEARCH_VIEWS.filter((view) => views.split(",").includes(view));
  finding.titleOnly = first(query.title) === "1";
  if (SEARCH_SPANS.includes(span as SearchSpan)) finding.span = span as SearchSpan;

  return finding;
}

/** The query a search is written under, its defaults left out. */
export function queryOfFinding(finding: Finding): Record<string, string> {
  const query: Record<string, string> = { search: finding.words };
  const views = SEARCH_VIEWS.filter((view) => finding.views.includes(view));

  if (finding.sort !== "best") query.sort = finding.sort;
  if (views.join(",") !== DEFAULT_VIEWS.join(",")) query.in = views.join(",");
  if (finding.titleOnly) query.title = "1";
  if (finding.span !== "any") query.since = finding.span;

  return query;
}

/** An address's query, as a router reads and writes it. */
export type AddressQuery = Record<string, string | null | (string | null)[]>;

/** An address's query with every search key taken out, and the search's put in where one is given. */
export function withFinding(query: Readonly<AddressQuery>, finding: Finding | null): AddressQuery {
  const rest = Object.fromEntries(Object.entries(query).filter(([key]) => !(SEARCH_KEYS as readonly string[]).includes(key)));

  return finding === null ? rest : { ...rest, ...queryOfFinding(finding) };
}

/** The moment a span reaches back to from `now`: the start of today in the reader's own clock, or a count
 * of days; none for any time. */
export function sinceOf(span: SearchSpan, now: Date): number | null {
  if (span === "any") return null;

  if (span === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  return now.getTime() - (span === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
}

/** What the service is asked for a search, from row `after` on. */
export function askOf(finding: Finding, now: Date, after = 0): SearchAsk {
  return {
    q: finding.words.trim(),
    views: finding.views.length === 0 ? [...DEFAULT_VIEWS] : finding.views,
    titleOnly: finding.titleOnly,
    since: sinceOf(finding.span, now),
    sort: finding.sort,
    after,
    limit: FOUND_PAGE
  };
}

/** Whether a search names anything to look for. */
export function asksAnything(finding: Finding | null): boolean {
  return finding !== null && finding.words.replace(/"/g, "").trim() !== "";
}

/** The term a found row's marks are drawn for: the first run the service marked in its text, else in its
 * title. The layer's marking draws one phrase wherever it stands, so a row of several terms marks the
 * first one found. */
export function markedTerm(found: FoundNote): string | null {
  const place = found.snippet?.hits[0];

  if (place !== undefined && found.snippet !== null) return found.snippet.text.slice(place[0], place[1]);

  const title = found.titleHits[0];

  return title === undefined ? null : found.title.slice(title[0], title[1]);
}
