# Working in this repository

This repository is bmo-note: the platform's editable notes, each one a BlockSuite document kept as
binary Yjs state in the unit's own store and edited from the web console. It is also a fork of AFFiNE
Community Edition, kept so the unit can follow upstream. `docs/design.md` states what the unit is,
`docs/api.md` is the boundary contract, and `docs/affine.md` records the licence line and the study.

## Rules

- **`docs/` is canonical.** A change that would make a document wrong repairs the document first.
- **The licence line holds.** Nothing under `packages/backend/` or `packages/common/native` (Enterprise
  Edition) is built, read for reuse, copied or derived into the unit's code. The unit's Rust crate and
  its console bundle touch `blocksuite/` (MIT) only.
- **The service is the guard and the truth.** Every note belongs to the account of the `Owner-Key` the
  console relays; a note document is opaque bytes to the service.
- **The fork's tree stands for upstream merges.** The unit's own folders are `src/`, `tests/` (its
  harness files), `client/`, `deploy/`, `docs/` (its own documents), and the root Rust manifests and
  declaration files; the rest of the root keeps its upstream shape, unbuilt.
- **The console bundle vendors the editor by copying it** into `client/blocksuite/` with
  `bun run vendor` before install, transpiles every decorated copied source in place with
  `bun run decorators` after install, and builds with `bun run bundle`; the copy is never tracked
  (`docs/affine.md`, 「The client's build path to the vendored editor」).
- **Tests live in `tests/`,** one harness `tests/main.rs`; checks: `cargo check --workspace --all-targets`,
  `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all --check`, `cargo test` through
  the testbed; the client's `bun run check`.
- **English only** in code, documents, tests and commits; Korean in the bundle's `ko` words alone.
- **No personal data, no names of agents, owners or hosts** in code, documents or commits. A note
  document's *content* is user data that stands in the store at runtime, never in the repository.
- **Versions:** `0.1.0-rev.N` until a release the owner declares; no sibling version pins.
- Depend only on the shared crates this repository's manifests name and base libraries it is
  declared to take; other units through their documented APIs. The note service calls no unit.
