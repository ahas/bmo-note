**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# bmo-note

The platform's editable notes as one service: each note a BlockSuite document, the editor of AFFiNE,
kept as binary Yjs state with its own metadata in the unit's SQLite store; created, edited and found
again from the web console's sidebar; the console plugin bundle that shows them built from this
repository's own vendored editor. `docs/design.md` states what it is, `docs/api.md` its boundary and
`docs/affine.md` what was studied of AFFiNE and under which licence — the fork of AFFiNE Community
Edition this repository is, with `upstream` kept for later merges.

## Tests

`cargo test` (through the testbed) runs the crate's one harness, `tests/main.rs`, on a scratch SQLite
file and a loopback port: notes written, read, saved, conflicted, trashed, restored and purged, each
account's own (`notes.rs`); what stands beside a note's document (`beside.rs`) and the images it holds
(`blobs.rs`); a note shared by link and with members (`sharing.rs`); each reader's own pins and record of
what was opened (`own.rs`); the search (`search.rs`); the stream the writes publish (`events.rs`); the
console face the service serves, its manifest read through bmo-ui's own reading on the vendored release
(`console.rs`); and the unit's own repository checks (`repository.rs`). The console bundle's
check is `bun run check` inside `client/`, which copies the vendored editor, installs, transpiles its
decorated sources with the TypeScript compiler, typechecks and tests (`docs/affine.md`, 「The client's
build path to the vendored editor」).

## Layout

| Folder | Holds |
|---|---|
| `src/` | The service and its command: the routes, the note store, the event ring, the console face's declaration |
| `client/` | The console plugin bundle, a project of its own; `client/blocksuite/` (untracked) holds the build's copy of the editor |
| `deploy/` | The service's user unit |
| `tests/` | The crate's one test harness and the stand-ins it runs over, beside the fork's upstream end-to-end test folders |
| `docs/` | The canonical statements of what the service is and its boundary, the AFFiNE study record, and the fork's upstream book and blog content |
| `blocksuite/` | The forked BlockSuite editor, MIT, the source the client's build vendors |
| `packages/` | The forked AFFiNE packages: MIT frontend under `frontend/` and `common/` apart from `common/native`, and the Enterprise-licensed `backend/` and `common/native`, which this unit never builds or reads for reuse |
| `tools/`, `scripts/` | The fork's upstream tooling and release scripts, inactive for this unit |
| `.github/`, `.cargo/`, `.codesandbox/`, `.devcontainer/`, `.docker/`, `.husky/`, `.render/` | The fork's upstream configuration and CI folders, inactive for this unit |

At the root stand the Cargo manifest and lock, `testbed.toml`, `install.toml`, `rustfmt.toml`, `settings.toml` (the
defaults built into the binary), `CLAUDE.md`, `PERSONAL-DATA.md`, the licence files, and the fork's
own JavaScript manifests and tsconfigs.

## Commands

- `bmo-note serve` opens its store and answers the routes until it is told to stop.
- `bmo-note health` ends 0 where the service its settings name answers ready.
- `bmo-note console-reach` prints how a console reaches the service, for a deployment's console probe.

The settings are read from the binary's built-in `settings.toml`, then the deployment's `settings.toml`
and `settings.local.toml` beside the release (the data root's `env/note.toml`), then
`BMO_NOTE_<TABLE>__<KEY>` in the environment (`docs/api.md`, 「Settings」).
