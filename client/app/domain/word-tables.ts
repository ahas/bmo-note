// The editor's word tables the bundle carries (`docs/design.md`, 「The editor's word table is the editor's own
// locale」): one for each file the editor's words folder holds, keyed by the code of the language the file is
// named for. The build reads the folder whole, so a table added there is carried with no line written here.

/** One table: the console's word for each word the fork says. */
export type WordTable = Record<string, string>;

/** Every table the bundle carries, by the code of the language its file is named for. */
export const TABLES: Record<string, WordTable> = Object.fromEntries(
  Object.entries(import.meta.glob<WordTable>("../../i18n/editor/*.json", { eager: true, import: "default" })).map(([path, table]) => [
    path.slice(path.lastIndexOf("/") + 1, -".json".length),
    table
  ])
);
