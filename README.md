**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# bmo-note

The platform's editable notes as one service: each note a rich-text document of Nuxt UI's editor, kept as its
TipTap JSON with its own metadata in the unit's SQLite store; created, edited and found again from the web
console's sidebar, with notes linked to one another by `[[` or `@`, the notes linking to each listed under it,
comment threads laid on words, and Ask AI and the talk panel over a note; and the console plugin bundle that
shows them, built from this repository. `docs/design.md` states what it is and `docs/api.md` its boundary.

## Tests

`cargo test` (through the testbed) runs the crate's one harness, `tests/main.rs`, on a scratch SQLite file and a
loopback port: notes written, read, saved, conflicted, trashed, restored and purged, each account's own
(`notes.rs`); what the service reads of a document (`document.rs`); what stands beside a note's document — what
it says, its links, its icon, a copy of it (`beside.rs`) — and the images it holds (`blobs.rs`); its comment
threads (`comments.rs`); a note shared by link and with members (`sharing.rs`); each reader's own pins and record
of what was opened (`own.rs`); the search (`search.rs`); the stream the writes publish (`events.rs`); the console
face the service serves, its manifest read through bmo-ui's own reading on the vendored release (`console.rs`);
and the unit's own repository checks (`repository.rs`). The console bundle's check is `bun run check` inside
`client/`, which installs, typechecks, builds the bundle and runs its unit tests; its browser tests under
`client/tests/browser/` run in the suite's browser lane.

## Layout

| Folder | Holds |
|---|---|
| `src/` | The service and its command: the routes, the note store, the reading of a document, the comments, the event ring, the console face's declaration |
| `client/` | The console plugin bundle, a project of its own |
| `deploy/` | The service's user unit |
| `tests/` | The crate's one test harness and the stand-ins it runs over |
| `docs/` | The canonical statements of what the service is and its boundary |

At the root stand the Cargo manifest and lock, `testbed.toml`, `install.toml`, `rustfmt.toml`, `settings.toml` (the defaults
built into the binary), `CLAUDE.md`, `PERSONAL-DATA.md` and the licence.

## Commands

- `bmo-note serve` opens its store and answers the routes until it is told to stop.
- `bmo-note health` ends 0 where the service its settings name answers ready.
- `bmo-note console-reach` prints how a console reaches the service, for a deployment's console probe.

The settings are read from the binary's built-in `settings.toml`, then the deployment's `settings.toml` and
`settings.local.toml` beside the release (the data root's `env/note.toml`), then `BMO_NOTE_<TABLE>__<KEY>` in the
environment (`docs/api.md`, 「Settings」).

## Licence

MIT, as `LICENSE` states.
