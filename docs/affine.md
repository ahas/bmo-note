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

The page view is mounted as the preset registers it but for one provider: the phone's keyboard toolbar, which
the fork registers for the page view under a phone's user agent and draws behind a feature flag of its own. The
console bundle builds its view extensions without that provider, by the provider's own class, so the editor
never mounts the bar whatever the agent or the flag (`docs/design.md`, 「On a phone the format bar is the one
bar」). No source of the fork's is changed for it: a merge that keeps the provider needs nothing, and one that
renames or moves it fails the client's check at the import, where the choice is made again.

Beside the seams, the fork carries this unit's own placement of its slash menu, so the menu a phone reaches
the further kinds by stands inside the screen. The menu is held inside the page by the width of its drawn
panel, measured once the panel stands, since the element that holds it has no width of its own; and a menu of
its further items, placed beside it, goes under the item that opened it where the screen holds no room beside
it, clear of the finger that opened it, and is held inside the screen. Both are a few lines of the slash
menu's own placement. A merge that rewrites that placement drops them, and the phone's browser file, which
reads both menus inside a phone's screen and clear of the finger, fails where either stands past the edge.

What is not borrowed, and why: the AFFiNE server and its native addon (EE licence, and a stack this
platform does not run); the sync gateway (no realtime collaboration in the unit's v1, one writer per
note is the truth the design states); the GraphQL metadata API (this unit's routes state their own
shape); the app shells, Electron packaging and copilot paths (a console bundle is the surface).

The fork's tree is not untouched: it carries three seams of this unit's own, all in the preset's component
layer.

The first is the translator `docs/design.md` names 「The editor's own words follow the console's language」. It is a module of the preset's component
layer, read by the renderers of that layer and of the blocks and widgets the page view mounts, at the point
where a word of the editor's own chrome is drawn, and it answers nothing by itself: whoever mounts the
editor installs the answers, which is why the words live in the console bundle's own table of the editor's
words and not in the fork's sources. A word drawn out of a template cannot be asked at that point, so the hover room the fork draws asks
the lines of its own drawn content of the same seam, and a renderer that draws a room of the editor's own
chrome says so to it; a room that shows a reader's own words says nothing of the kind and is left alone. A
merge of `upstream/canary` keeps the module and those reads; a renderer the merge adds, or a word or a drawn
line it adds to a renderer the seam already reads, needs no change, and one the merge rebuilds elsewhere is
untranslated until it is read the same way. The words' browser file fails on exactly that case, and the
client's check builds the copy the same way the deployment does.

The second is the toast helper, the road by which most of the fork's blocks and widgets say a line of notice
beside the notification service its host may provide. Where the editor's host provides that service, the
helper hands the line to it as the fork wrote it and draws nothing; only where none is provided does it draw
its own box over the editor's viewport. So a mounter that provides the service hears every line the editor
says on one road, which is what `docs/design.md`, 「The editor speaks on the console's message pill」, stands
on. The seam is one branch at the head of the helper; a merge keeps it, and a call to the helper the merge
adds needs no change, while a line a merge says by some third road of its own is not heard until it is sent
down one of the two. The pill's browser file reads the lines of both roads on the pill and reads that the
helper's box never stands.

The third is a form's own refusal, a small module of the same layer: one line in the error colour, its
words asked of the translator, which a form of the editor's draws under the field it refuses and takes away
once the field is changed. The forms that refused through the toast helper — the link card's create form,
the card's edit form and the attachment's rename form — hold their refusal as a state of the form and draw
it with that module, so what `docs/design.md` says of a refusal (「The editor speaks on the console's message
pill」) holds. A merge keeps the module and those three reads; a form the merge adds that refuses through
the toast helper says its refusal on the pill until it is read the same way.

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
   editor's runtime refuses them), targeting a browser baseline every console browser speaks. The
   build runs bmo-ui's bundle build, which leaves the libraries the bundle shares with its console
   unbundled and writes the layer it was built on beside the module; the layer is the bmo-ui release
   file the shared versions pin, vendored under `client/vendor/` as its release verb wrote it.

The copy is a build step over the same working tree, never a second checkout; `client/blocksuite/` is
not tracked. Merging `upstream/canary` moves the editor the bundle builds with, and `bun run vendor`
refreshes the copy. `bun run check` runs the same chain whole, with the typecheck beside it and the tests
last, so a bundle the deployment's console-bundle step would refuse, a screen asking for a word the pack
does not answer among them, fails the client's check, and with it the change check and the close, first.
A fresh tree the testbed tests in (a bench copy, a gate's checkout, the daily run's tree) runs the chain up to the bundle as its declared setup, before any unit, since the screens' browser
tests drive a dev host that imports the copy and the installed packages.

The client installs `@nuxt/ui` at exactly the version the vendored bmo-ui release names, and carries
that release's patches for the same `@nuxt/ui` and for the `reka-ui` it brings under `client/patches/`,
each named in the manifest's `patchedDependencies`. A patch applies only to the exact version it names,
so a looser range, or a second copy of either package in the lock, installs the components without the
layer's fixes; a bmo-ui release that names other versions moves the pin and the patches with it. The
client also takes `zod` at the version bmo-ui resolves, which none of its own code imports: `@nuxt/ui`
names `zod` as an optional peer, and the installer links one `@nuxt/ui` for each `zod` its dependents
see, so the editor's older `zod`, standing at the top of the client, would give the screens and the
layer a `@nuxt/ui` each, whose portal and form keys do not meet. The editor's packages keep their own
`zod`. The lock holds one `@nuxt/icon`, at a version that writes an icon under the name it was loaded
for, so the client carries no icon patch.
