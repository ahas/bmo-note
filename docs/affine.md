# AFFiNE, studied and borrowed

This repository is a fork of AFFiNE Community Edition (upstream `toeverything/affine`, branch
`canary`, kept as the `upstream` remote for later merges). The fork exists so the note unit can study
AFFiNE's editor and document model at the source, borrow what its licences allow, and follow upstream
afterwards. This document records what was studied, what stands borrowed, and where the licence line
runs.

## The licence line

- The repository's root licence carries the split: everything is MIT (`LICENSE-MIT`) **except** the
  directories `packages/backend/**` and `packages/common/native`, which stand under the AFFiNE
  Enterprise Edition licence stated in the server package's own licence file. EE source may not be
  copied, merged, distributed, sublicensed, sold, or run in production without a paid subscription.
- The rule this unit holds to: **no code, and no derived code, of `packages/backend/**` or
  `packages/common/native` stands in bmo-note or in anything it builds.** AFFiNE's server is studied
  for its mechanism only, and the mechanism is re-implemented from the facts in this document rather
  than from its source.
- Editor-side, the vendored `blocksuite/**` tree and `packages/frontend/**` are MIT, as each package's
  own manifest declares.

## What was studied

- **The editor stack.** The vendored `blocksuite/` tree holds the editor: a framework layer
  (`@blocksuite/global`, `std`, `store`, `sync`, `inline`) and an AFFiNE preset layer (`@blocksuite/affine`
  with around sixty leaf packages for blocks, widgets, inlines, fragments, canvas elements, components,
  model, shared services). Every package declares MIT. The preset registers the block flavours, the
  view extensions and the widgets through `@blocksuite/affine/extensions/view`.
- **The document model.** A document is one BlockSuite `Store` over a Yjs document, its root an
  `affine:page` block with a `affine:surface`, a `affine:note` container and text blocks inside. Text is
  `Y.Text`; blocks are `Y.Map` entries. The serialised form is plain Yjs state: `encodeStateAsUpdate`
  out, `applyUpdate` in. A JSON snapshot form exists through the transformer layer and is not used here.
- **How AFFiNE stores and syncs notes** (its server, mechanism only, EE source unread for reuse): doc
  binaries travel over a Socket.IO gateway as base64 Yjs updates and are kept as Postgres byte
  columns, one row per live document with a state vector, an incremental update log merged on write,
  and expiring history rows per the plan's history period; attachment blobs keep metadata in a table
  and bytes in a pluggable storage driver. Self-hosting AFFiNE's server means PostgreSQL, Redis, mail
  and its native Rust addon.
- **The local-first client layer** (MIT): `packages/common/nbstore` is the storage and sync abstraction
  with IndexedDB, SQLite, disk and cloud sources; `packages/common/reader` renders a doc to HTML or
  Markdown offline. Neither runs in bmo-note: the console bundle talks to this unit's API directly.

## What stands borrowed

| What | From | Licence | Where it runs |
|---|---|---|---|
| The editor: the whole vendored `blocksuite/` tree as the console bundle builds it (framework layer plus the AFFiNE preset), at the fork's version | the fork's `blocksuite/**` | MIT | the client bundle served by this unit's `note` service |
| The shape of the editor mount: a custom-element container holding an `editor-host`, given a `Store` and the page view extensions, copied small and adapted to the unit | the fork's playground and integration-test editor containers | MIT | `client/app/components` |
| The storage mechanism: whole documents kept as binary Yjs state with metadata rows beside them | studied from AFFiNE server's stored shape, re-implemented | mechanism, not code | `src/store.rs` |
| The fork itself as the editor's source of truth, with `upstream/canary` for later merges | upstream | per path, as the split above | this repository |

What is not borrowed, and why: the AFFiNE server and its native addon (EE licence, and a stack this
platform does not run); the sync gateway (no realtime collaboration in the unit's v1, one writer per
note is the truth the design states); the GraphQL metadata API (this unit's routes state their own
shape); the app shells, Electron packaging and copilot paths (a console bundle is the surface).

## The client's build path to the vendored editor

The monorepo resolves its `@blocksuite/*` dependencies to each package's own `src`, and its package
manifests carry `workspace:` references, so the tree is consumable only in the shape the fork installs
it in. The console bundle therefore builds the editor through four ordered steps inside `client/`:

1. `bun run vendor` copies `blocksuite/framework`, `blocksuite/affine` and `blocksuite/integration-test`
   into `client/blocksuite/` (no tests, no `node_modules`), rewrites every copied package's tsconfig to
   extend the copy's own root, enumerates the packages into the client manifest's workspace list, and
   drops the type-level `override` modifier from accessor fields, which the bundle build's transform
   would otherwise misread.
2. `bun install --frozen-lockfile` links every copied package and the client's own dependencies.
3. `bun run decorators` transpiles, in place, every copied source file that carries decorators or an
   `accessor` field, with the TypeScript compiler — the one the fork's own settings name for them — at
   an ES2021 target, which lowers the decorators and the `accessor` keyword that travels with them (no
   browser parses that keyword today either, decorated or not). This lowering must happen here and not
   in the bundle build: the bundler has no lowering for standard (TC39) decorators and would leave
   them standing for a browser that reads them as a syntax error, and its only lowering, the legacy
   experimental form, breaks the fork's hand-written standard decorators (the peek view's `Peekable`
   and the gfx surface field decorators, which read the decorator context). The step names its
   candidates by text and decides each with the compiler's own parser, and refuses the build when a
   decorator or an `accessor` field survives a transpile.
4. `bun run bundle` builds the console plugin folder with the editor transpiled in, through the fork's
   own vanilla-extract plugin (the editor's stylesheets are compile-time files; without the plugin the
   editor's runtime refuses them), targeting a browser baseline every console browser speaks.

The copy is a build step over the same working tree, never a second checkout; `client/blocksuite/` is
not tracked. Merging `upstream/canary` moves the editor the bundle builds with, and `bun run vendor`
refreshes the copy. `bun run check` runs the same chain up to the tests; the deployment's console-bundle
step runs it whole.
