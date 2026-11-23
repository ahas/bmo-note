# Working in this repository

This repository is bmo-note: the platform's editable notes, each one a TipTap document of Nuxt UI's editor kept as
its JSON in the unit's own store, with its links and comment threads, and edited from the web console.
`docs/design.md` states what the unit is and `docs/api.md` is the boundary contract.

## Rules

- **`docs/` is canonical.** A change that would make a document wrong repairs the document first.
- **The service is the guard and the truth.** Every note belongs to the account of the `Owner-Key` the
  console relays; the service reads a note's TipTap JSON for its title, text and links, and the client
  alone writes it.
- **The console bundle builds its editor in.** Nuxt UI's editor components are taken from the installed
  library and built into the bundle with its own TipTap and ProseMirror, so the note's own extensions stand on
  the editor's one ProseMirror copy; every other component stays the console's shared copy
  (`client/console/vite.config.ts`, `docs/design.md`, 「The console surface」).
- **Tests live in `tests/`,** one harness `tests/main.rs`; checks: the testbed's own Cargo checks, which
  `bmo check` runs wherever a change marks the crate (the change check compiles it, the workspace check
  formats it and lints every target with warnings denied), so `testbed.toml` declares no Cargo step;
  `cargo test` through the testbed; the client's `bun run check`; the screens' browser tests under
  `client/tests/browser/`, which `client/package.json` declares to the suite's browser lane and the client's
  check leaves out.
- **English only** in code, documents, tests and commits; Korean in the bundle's `ko` words alone, besides
  the README's language line and its translations (`README.ko.md` and its siblings).
- **No personal data, no names of agents, owners or hosts** in code, documents or commits. A note
  document's *content* is user data that stands in the store at runtime, never in the repository.
- **Versions:** `0.1.0-rev.N` until a release the owner declares; no sibling version pins.
- Depend only on the shared crates this repository's manifests name and base libraries it is
  declared to take; other units through their documented APIs. The note service calls agency alone, for the
  Agent's asks (`docs/api.md`, 「Calls the note service makes」).
