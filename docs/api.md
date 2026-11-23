# The boundary API

Every route bmo-note answers, the events it publishes, and the calls it makes. The wire format is the
platform's (bmo-chat `docs/conventions.md`): camelCase keys, times in epoch milliseconds, ids as
strings, a failure a non-2xx status with `code` (kebab-case) and `error` (an English sentence), a list
`{items, more}` read with `after` and `limit`. A note document travels as a JSON object in the `doc`
field: the ProseMirror JSON of one TipTap document, a `doc` node holding a `title` node and the note's
blocks (`docs/design.md`, 「What a note is」).

## The control port

The service listens on the loopback at the address `env/note.toml` names (`[server] listen`, by
convention `127.0.0.1:13129`), under `Authorization: Bearer <token>`, one of two:

- The service token (`[server] token`), on every route but the console face's own (「Console」). A
  service-token call names the account it acts for with an `owner` query (or path-side query of the
  same name on the list).
- The console credential (`[console] token`), with the reader's headers the console sets on every call
  it relays. The console face's guard holds such a call to the manifest's role and owner key
  (「Console」); the route then reads the account from the `Owner-Key`, and one longer than 200
  characters is refused as one missing. On the routes of one note, such a call may name another
  account with the `owner` query: it then reaches that account's note as a member, as far as the
  share opens it (「Sharing」). An `owner` naming the reader is the reader's own note.

A call with no credential or a wrong one is 401 `unauthorized`; a console call the role or the owner
key refuses is 403 `forbidden`.

## Health

| Method | Path | Does |
|---|---|---|
| GET | `/health` | `ready`, `reason` (null when ready), `version` |

The service is ready once its store is open and every stored document is of the editor's format; while
any note still holds a document the earlier editor wrote, it answers `ready` false with a `reason`
naming how many, until the migration has converted them (`docs/design.md`, 「What a note is」). Agency, which the
Agent asks (「Agent」), is no part of its readiness: an ask answers for itself.

## Notes

| Method | Path | Does |
|---|---|---|
| GET | `/notes?deleted=&shared=&folder=&sort=&after=&limit=` | The caller's notes in the order `sort` names, newest changed first where it names none — `{items, more}`; `deleted=true` answers the trash, `shared=true` the live notes other accounts share with the caller, and `folder` the caller's live notes standing in the folder it names, or, empty, in none |
| POST | `/notes` | Makes a note: `id?`, `doc`, `folder?` — 201, or 200 with the note as it stands where the id is already held (idempotent by id; the stored document unchanged) |
| GET | `/notes/{noteId}?owner=&opened=&deleted=` | One note with its document; `opened=true` records that the caller opened it (「What was opened」); `deleted=true` answers the caller's own note where it rests in the trash |
| PATCH | `/notes/{noteId}?owner=` | Saves: `version` (required), `doc?`, `restore?` — 200, or 409 `version-conflict` answering the current metadata |
| DELETE | `/notes/{noteId}?purge=` | Moves the note to the trash, or, with `purge=true`, deletes it for good where it stands trashed, with everything kept beside it (`docs/design.md`, 「Storage」) — 204 |
| PUT | `/notes/{noteId}/icon?owner=` | Sets the note's icon: `icon` (empty clears it) — 200 the metadata. The version and `changedAt` stay as they stand |
| PUT | `/notes/{noteId}/folder` | Moves the caller's own note, live or trashed, into a folder: `folder` (a folder id, or null for none) — 200 the metadata. The version and `changedAt` stay as they stand |
| POST | `/notes/{noteId}/duplicate?owner=` | Makes a note of the caller's own from one the caller reads: `id?`, `title` — 201 the copy's metadata |
| PUT | `/notes/{noteId}/blobs/{blobId}?owner=` | Stores one image with the live note: the body is its bytes, `content-type` its image type — 204; an id already held keeps the bytes it was first given (a re-upload answers the same 204 whatever it carries) |
| GET | `/notes/{noteId}/blobs/{blobId}?owner=` | One stored image: its bytes with the type it was stored under, `cache-control: private, max-age=31536000, immutable`; 404 where none stands |
| GET | `/notes/{noteId}/backlinks?owner=` | The live notes the caller reads whose documents link to this note, newest changed first — `{items, more}`, `more` always false |

A note metadata is `id`, `owner` (the account key the note belongs to), `title` (may be empty; the
screen names an empty one by its own word), `version` (a whole number from 1, held up on each save),
`createdAt`, `changedAt`, `size` (stored doc bytes), `deletedAt` (null while the note lives),
`access`, what the caller holds of it: `owner`, or the member's `edit` or `read`, `icon`, the note's
icon (a short string, empty where it has none), and `folder`, the id of the owner's folder it stands in,
null where it stands in none and always null to a member (「Folders」). A note read adds `doc`. A write's
`id` is 1 to 64 letters, digits, `-` and `_`, never one of the words `search` and `recent`, which name
routes under `/notes`; one is made where none is given (lowercase hexadecimal).

A `doc` is one JSON object whose `type` is `doc` and whose `content` is an array of nodes, each an object
with a string `type`; anything else is 422 `bad-doc`. The service stores it as it came and reads from it,
never from the caller, the note's title (the `title` node's words, else the first line of words the
blocks hold, at most 300 characters), its plain text for search (every block's words, one line a block,
a table's cells and a note link's title among them) and its links (each `mention` node's `id` and
`owner`, the note it links). A `doc` past `[notes] max_doc_bytes` as stored is 413 `too-large`; a
`version` below 1 or a body that is not one object is 400 `bad-request`; a note the account does not hold live is 404 `not-found`; a `restore` or `doc` write
on a trashed note is 422 `trashed`; a `purge` of a live note is 422 `not-trashed`. A `PATCH` whose
`version` is below the stored one answers 409 `version-conflict`; one at or above it saves (a writer
who read ahead of the service loses nothing it did not already hold). `restore=true` with no `doc`
moves a trashed note back to life and writes nothing else; on a live note it changes nothing.
`deleted=true` with `shared=true`, and `folder` beside either, is 400 `bad-request`. A `folder` on a
creation, a list or a move that names no folder of the caller's is 422 `no-folder`.

A list's `sort` is `changed` (newest changed first, the default), `created` (newest made first) or
`title` (by title, letters compared without regard to case, untitled notes last, then by id). Its
cursor is the last row's key in that order: `changedAt:id`, `createdAt:id`, or `<title>:id` with the
title written as unpadded base64url of its UTF-8, so a title's own colons never part the cursor; the
shared view's adds `:owner`, since two accounts may each hold a note at one id. A cursor that does not
read for the sort named is 400 `bad-request`.

A read with `deleted=true` answers the caller's own note where it rests in the trash and nothing else: a
live note, another account's note and one naming a member's `owner` are 404 `not-found`. A read with
`opened=true` answers as a read does and records the moment (「What was opened」); a trashed note's read
records nothing.

An `icon` is at most 16 characters with no control character, its ends trimmed; it needs the note live
and the caller's writes, and publishes `note.saved`. A duplicate is a new note of the caller's own: the
source's document copied with the call's `title` written into its title node and its comment marks
taken off, its images, icon, text and links copied (the screen marks the title as a copy in the reader's
language), and no threads; the source is any note the caller reads live, their own or one
shared with them at either permission, and anything else is 404 `not-found` as a read is. Its `id` is
chosen as a creation's is, and one the caller already holds is 400 `bad-request`; it publishes
`note.saved` to the caller, as a creation does. A copy of the caller's own note stands in the source's
folder; a copy of a note shared with the caller stands in none.

A move into a folder is the owner's alone (403 `forbidden` to a member), reaches the note live or in the
trash, and publishes `note.filed` to the owner; it writes nothing else of the note.

The blob routes stand under the note: a `PUT` needs the note live (a trashed note is 422 `trashed`, no
note 404), its `content-type` must name an image, its `blobId` must be 1 to 128 letters, digits, `-`,
`_` and `=` (the editor's ids, and the digests the earlier editor named its images by), and its bytes must not pass `[notes] max_blob_bytes` (413
`too-large`). A
`GET` answers wherever the note stands, live or trashed, to its owner, and to a member while the note
lives (「Sharing」); a purge has taken the blobs.

A backlink row is the linking note's metadata, as the caller holds it; a note linking from the trash, one
the caller does not read, and the note itself are never answered. The route needs the note live and read
by the caller.

A service-token call on these routes answers for the `owner` it names; one naming none is 422
`no-owner`.

### Comments

| Method | Path | Does |
|---|---|---|
| GET | `/notes/{noteId}/threads?owner=` | The note's threads, oldest first, each with its comments — `{items, more}`, `more` always false |
| POST | `/notes/{noteId}/threads?owner=` | Starts a thread: `id`, `quote`, `body` — 201 the thread; 200 the thread as it stands where the id is already held |
| PATCH | `/notes/{noteId}/threads/{threadId}?owner=` | Resolves or reopens: `resolved` — 200 the thread |
| DELETE | `/notes/{noteId}/threads/{threadId}?owner=` | Deletes the thread whole — 204, whether it stood or not |
| POST | `/notes/{noteId}/threads/{threadId}/comments?owner=` | Replies: `body` — 201 the comment |
| DELETE | `/notes/{noteId}/threads/{threadId}/comments/{commentId}?owner=` | Deletes one comment, and the thread with its last — 204, whether it stood or not |

- **A thread** is `id`, `quote` (the words it was laid on, as they read then), `author` (the account key
  that started it), `createdAt`, `resolvedAt` and `resolvedBy` (null while it is open), `anchored`
  (whether the note's stored document holds a comment mark of the thread's id), `comments`, oldest
  first, and `mine`, whether the caller started it. **A comment** is `id`, `author`, `body`, `createdAt` and
  `mine`, whether the caller wrote it. A thread id is chosen by the caller, 1
  to 64 letters, digits, `-` and `_`, and is the `thread` attribute of the `comment` marks laid for it;
  a comment id is made by the service. A `quote` is at most 1,000 characters and a `body` 1 to 10,000,
  its ends trimmed; outside those, 400 `bad-request`.
- **Who reaches them.** The reads answer the owner and every member while the note lives, and the
  owner's own trashed note. Starting, replying, resolving and reopening need the note live and the
  caller's writes — the owner, or a member holding `edit` (403 `forbidden` for `read`; 422 `trashed` for
  a note in the trash). A comment is deleted by its author or the owner, and a thread whole by its
  author or the owner; anyone else is 403 `forbidden`. A thread or comment that does not stand is 404
  `not-found` where a write names it, and a delete of one answers 204 as the deletes of a link and a
  member do.
- Each write publishes `note.commented`.

### Agent

| Method | Path | Does |
|---|---|---|
| POST | `/notes/{noteId}/agent?owner=` | One ask of the note assistant: `mode`, `lines`, `instruction`, `turns` — 200 `{answer}`, the agent's words, or null where it said nothing |

- **The ask.** `mode` is `passage`, one passage of the note, or `note`, the whole note (`docs/design.md`,
  「Agent」, 「The talk panel」); `lines` is that text in the note's line grammar, one string a line;
  `instruction` is what the reader asks now, 1 to 10,000 characters with its ends trimmed; `turns` is the
  rounds said before it over the same text, oldest first, each `owner` (true for the reader's) and `text`.
  Anything else is 400 `bad-request`.
- **Who asks.** It needs the note live and the caller's writes, as a save does: a member holding `read` is 403
  `forbidden`, and a note the caller does not reach live is 404 `not-found`. Agency is asked nothing then.
- **What it asks.** One slot of the role `[agent] role` names, `note-assistant`, under an owner of its own,
  asked under the reader's own BMO, `u<key>`, so it is let in on an agent of the reader's account alone; the
  platform administrator's — a console call whose `Owner-Role` is `administrator` — under the supervisor
  `[agent] supervisor` names, or under none where it names none, so it stands under the deployment's own
  account. A slot agency answers under another account than the one asked for is given back unused and the ask
  is 502 `unanswered`. A member's account that holds no agent of the role is first given one, named
  `<role>-u<key>`, on the road and the settings of the role's agent of no account. On the slot, once it is let
  in, one session on the `search` line with the service's own instructions for the mode as its `systemPrompt`
  and no tool allowed, and one turn starting afresh whose prompt is one JSON object: `noteId`, `title` (the
  stored note's), `lines`, `instruction` and `rounds`, each `by` (`person` or `assistant`) and `text`. Whatever
  the ask ends in, everything it held is given back by its owner. The service waits for the slot and the turn
  however long they take; a caller that lets go ends the ask, and what it held is given back all the same.
- **Refusals.** 503 `no-agent` where no agency is named or its token cannot be read; 502 `unanswered` where
  agency refused a step, could not be reached, or the turn ended with no answer, the `error` naming why.

### Folders

| Method | Path | Does |
|---|---|---|
| GET | `/folders` | The caller's folders, by name, letters compared without regard to case, then by id — `{items, more}`, `more` always false |
| POST | `/folders` | Makes a folder: `id?`, `name`, `parent?` — 201 the folder, or 200 the folder as it stands where the id is already held |
| PATCH | `/folders/{folderId}` | Renames or moves it: `name?`, `parent?` (a folder id, or null for the top; left out, it stays) — 200 the folder |
| DELETE | `/folders/{folderId}` | Deletes the folder: its notes and folders move up into its parent, or to the top, and its bookmarks go — 204, whether it stood or not |

- **A folder** is `id`, `parent` (the folder it stands in, null at the top), `name` and `createdAt`. It is
  the caller's own (`docs/design.md`, 「Folders」): every route here answers the caller's account alone, and
  no member reaches another's. An `id` is chosen as a note's is, 1 to 64 letters, digits, `-` and `_`; one is
  made where none is given. A `name` is 1 to 100 characters, one line, its ends trimmed; outside those, 400
  `bad-request`.
- **Where it stands.** A `parent` that names no folder of the caller's is 422 `no-folder`; one that is the
  folder itself or a folder it holds is 422 `folder-cycle`; one that would stand the folder, or the deepest
  folder it holds, past the eighth level is 422 `too-deep`. A rename or a move of a folder that does not
  stand is 404 `not-found`.
- Each write publishes `folder.changed` to the caller, with the folder's id.

### Bookmarks

| Method | Path | Does |
|---|---|---|
| GET | `/bookmarks` | The caller's bookmarks, first made first — `{items, more}`, `more` always false |
| POST | `/bookmarks` | Bookmarks a folder, a note or a line: `kind`, and `folderId`, or `noteId` and `noteOwner?`, and for a line `block` and `quote` — 201 the bookmark, or 200 the bookmark as it stands where the caller already holds one of the same |
| DELETE | `/bookmarks/{bookmarkId}` | Takes the bookmark off — 204, whether it stood or not |

- **A bookmark** is `id`, `kind` (`folder`, `note` or `line`), `createdAt`, `folder` (the folder, for a
  folder's), `note` (the note's metadata as the caller holds it, for a note's and a line's), `block` and
  `quote` (for a line's: the block id it is anchored to, and the words the block holds in the note's stored
  document, one line of at most 300 characters, or the words it held when it was made where no block of
  that id stands) and `anchored` (for a line's, whether a block of its id stands in the note's stored
  document; true for the others). What a kind does not name is null.
- **What it names.** A folder's names one of the caller's own folders (404 `not-found` otherwise). A note's
  and a line's name a note the caller reads live: their own, with `noteOwner` left out or naming
  themselves, or another account's shared with them, `noteOwner` naming that account (404 `not-found`
  otherwise, 422 `trashed` for the caller's own note in the trash). A line's `block` is 1 to 64 letters,
  digits, `-` and `_`, and its `quote` at most 300 characters; anything else is 400 `bad-request`. The
  block is not looked for when the bookmark is made: `anchored` says whether it stands.
- **Whose it is.** A bookmark is the caller's own, kept by their account, and neither the owner of a note
  nor its members see one another's. The list answers only what the caller reads live at the moment of the
  read: a bookmark of a note trashed, of a share taken back, or of a note purged drops out of it, and comes
  back with a restore or a new share while it stands. A purge takes every bookmark of the note and of its
  lines; a folder's deletion takes its bookmarks.
- Each write publishes `bookmark.changed` to the caller.

### What was opened

| Method | Path | Does |
|---|---|---|
| GET | `/notes/recent?limit=` | The notes the caller opened most recently, newest first — `{items, more}`, each row the note's metadata and `openedAt` |

A read with `opened=true` records, for the caller's account, the moment it opened the note; the store
keeps each account's latest 100 and lets older ones go. `limit` is 1 to 50, 20 where none is given. As
the bookmarks, the list answers only what the caller reads live at the moment of the read.

### Search

| Method | Path | Does |
|---|---|---|
| GET | `/notes/search?q=&in=&titleOnly=&since=&sort=&after=&limit=` | The notes the caller reads whose title or text holds what `q` asks — `{items, more}` |

- **What it finds.** `q` is 1 to 200 characters. It is read as terms parted by spaces, a run between two
  double quotes standing as one term, its spaces and all; every term must stand in the note, each as a
  run of characters inside a word or across words, letters compared without regard to case. A term
  that is a quoted phrase therefore matches exactly that run. The title and the plain text the client
  supplied (「Notes」) are searched; a note with no text supplied is found by its title alone. A `q`
  with no term is 400 `bad-request`.
- **The index and its least length.** The store indexes the title and the text with SQLite's full-text
  search under its trigram tokenizer, which finds a run of three characters or more anywhere in a word,
  Korean included. A term shorter than three characters cannot be read from that index: where every
  term is that short, the route finds the notes whose title holds each term as a plain substring, and
  reads no text; where a short term stands beside a longer one, the longer ones are read from the index
  and the short one must stand as a substring of the title or the text.
- **Where it looks.** `in` names the views searched, comma-separated: `mine`, the caller's own live
  notes; `shared`, the live notes shared with the caller; `trash`, the caller's own notes in the trash.
  `mine,shared` where none is given; any other word is 400 `bad-request`. Nothing else is ever answered:
  another account's note only while it lives and is shared with the caller, at the permission it is
  shared at, and a note in the trash to its owner alone.
- **Filters.** `titleOnly=true` searches the titles alone. `since` (epoch ms) keeps the notes changed at
  or after it.
- **Order.** `sort` is `best` (the default), `changed` (newest changed first) or `created` (newest made
  first). The best match ranks the index's relevance with a title match weighing ten times a text match,
  and a note changed in the last seven days ahead of one as relevant changed before; a search of short
  terms alone has no relevance and stands newest changed first.
- **Pages.** `limit` is 1 to 50, 20 where none is given; `after` is how many rows of the same search were
  already read, 0 where none is given.
- **A row** is the note's metadata — `owner` says whose note it is — with `titleHits`, the places in the
  title where a term stands, and `snippet`: a stretch of the text around the first place a term stands,
  `text`, with `hits`, the places a term stands in it; null where no term stands in the text, or where
  the search read titles alone. A place is `[start, end)` in UTF-16 code units, the way a browser's
  string counts, and the stretch is cut at most 40 characters before its first hit and runs to at most
  160 characters, its line breaks laid flat.

## Sharing

The owner shares a note by one link and with members (`docs/design.md`, 「Who owns a note, and who it
is shared with」), on the routes below, each answered to the note's owner alone: a member is refused as
「What a member reaches」 says, and a call reaching a note that is neither the caller's nor shared with
them is 404 `not-found`. A write on a note in the trash
(making a link, sharing, changing a permission) is 422 `trashed`; a read or a removal answers wherever
the note stands.

| Method | Path | Does |
|---|---|---|
| GET | `/notes/{noteId}/link` | The note's live link — 404 `not-found` where none stands |
| POST | `/notes/{noteId}/link` | Makes the link: `expiresAt?` (epoch ms, in the future; none for a link that never ends) — 201 the link made, or 200 the live link that already stands |
| DELETE | `/notes/{noteId}/link` | Ends the live link — 204, whether one stood or not |
| GET | `/notes/{noteId}/members` | Who the note is shared with, oldest share first — `{items, more}`, `more` always false |
| POST | `/notes/{noteId}/members` | Shares with people: `users` (1 to 100 account keys), `permission` (`read` or `edit`) — 200 the members as they now stand; a member already standing is given the permission |
| PATCH | `/notes/{noteId}/members/{user}` | Changes one member's permission: `permission` — 200 the member, 404 where the note is not shared with that key |
| DELETE | `/notes/{noteId}/members/{user}` | Takes one member off — 204, whether they stood or not |

- **A link** is `token`, `noteId`, `createdAt`, `expiresAt` (null where it never ends). Its token is
  random, 32 letters, digits, `-` and `_`. A note has at most one live link; one past its end opens
  nothing and is swept away when the note's link is next read or made. An `expiresAt` that is not in the
  future is 400 `bad-request`.
- **A member** is `user` (the account key), `permission` and `sharedAt`. A key is 1 to 200 characters;
  the owner's own key is 400 `bad-request`, as is a permission other than `read` and `edit`.

### What a member reaches

A console call naming the owner with `owner` on the routes of one note reaches a live note shared with
the reader:

- with `read`: `GET /notes/{noteId}` (without `deleted`), `GET /notes/{noteId}/blobs/{blobId}`, its
  backlinks, its threads, the reader's own bookmarks of it and of its lines, and a duplicate of it;
- with `edit`: those, and `PATCH /notes/{noteId}` without `restore`,
  `PUT /notes/{noteId}/blobs/{blobId}` and `PUT /notes/{noteId}/icon`, as the owner's own, and the
  comment writes as 「Comments」 opens them;
- with either, nothing else: a write a `read` share does not open, a trash, a purge, a restore, a move into
  a folder and the sharing routes are 403 `forbidden`.

A note not shared with the reader, one in the trash, and one whose share was taken back are 404
`not-found`, as a note that does not stand is.

### Share reads

The note's share page reads with the link's token alone, with no owner key and no role, under the
service token or the console credential (「Console」):

| Method | Path | Does |
|---|---|---|
| GET | `/shares/{token}` | The note the link opens: `id`, `title`, `changedAt`, `size`, `expiresAt` and `doc`, the document with its comment marks taken off |
| GET | `/shares/{token}/blobs/{blobId}` | One of that note's images, as the note's own image route answers it |

A token that opens nothing, an ended link's, an unknown one's, or one whose note stands in the trash, is
404 `not-found`.

## Console

The note brings its screens to a console under bmo-ui's console plugin contract (bmo-ui
`docs/console-bundles.md`), which is the one statement of what a console asks and a service answers. Its
console face is bmo-chat's `bmo-console-face` (bmo-chat `docs/console-face.md`), which answers
`GET /console-manifest` and every file of the bundle under `GET /console/{file}`, guards them, and lays
the same guard over the routes the screens call. The note supplies the face what the contract leaves to
it:

- its declaration of the manifest fields it decides: name `note`, title `note.title`, icon
  `i-material-symbols-edit-note-outline`, screen path `/note`, service name `note`, API prefix `/`,
  role `member` and the owner key, the event stream (below), no WebSocket, and nothing under `calls`, the
  screens calling the note service alone, the Agent among it (「Agent」); under `shareReads`
  the two share reads (「Sharing」), which make the bundle's share page; no push kinds, relays or share
  head;
- the bundle build's folder (`[console] folder`), as bmo-ui's bundle build writes it: the module
  `bundle.js`, the stylesheet `bundle.css`, the words `words.json`, the layer `layer.json`, and the
  chunks and fonts the editor loads as it works, read once at start;
- the console credential (`[console] token`).

The service name `note` is the key of the Notes app the screens are, which a person's settings switch on and
off on the account service's delegation chain. The note ships no tool, so its deployment publishes the app from
`deploy/app.toml`, the `[app]` table alone, offered and on by default, with `bmo pocket app` once the service
answers ready (bmo-pocket's `docs/api.md`, 「An app on the delegation chain」).

The note uses the contract's share page and its sharing with members; the people the dialog offers
are the console's people directory, which the bundle reads in the browser, so the service calls no
unit for them.

The screens' routes are the notes, their blobs, their icon, their folder, their backlinks, their threads, the
Agent, the folders, the bookmarks, what was opened, the search, their sharing, the share reads and the event stream. Where the credential is empty, or
the folder cannot be served, no face stands, the reason is written to the service's log, and the
console's routes answer 404 `no-route`; the service's own routes are answered as ever.

`bmo-note console-reach` prints, as one JSON object, how a console reaches the service: `address`, the
base address its settings name, `consoleToken`, the console credential, and `token`, the service token,
which the console's routes refuse. A deployment's console probe runs it (bmo-testbed `docs/deploy.md`,
「The console probe」).

## Events the note service publishes

`GET /events` is a server-sent stream in the platform's shape (`after` or `Last-Event-ID`, `kinds`;
the same events as a page to `Accept: application/json`, with `after` and `limit`): `note.saved`,
`note.trashed`, `note.restored` and `note.purged`, each carrying `noteId` and `owner`; `note.shared` and
`note.unshared`, carrying `noteId`, `owner` and `member`, the shared one `permission` too;
`note.commented`, carrying `noteId`, `owner` and `thread`; `note.filed`, carrying `noteId`, `owner` and
`folder` (null for none); `folder.changed`, carrying `owner` and `folderId`; and `bookmark.changed`,
carrying `owner`, the account whose bookmarks changed. A console reader is given the events of its own
notes and of the notes shared with it when they were published, a share's own two events where it is that
share's owner or member, and `note.filed`, `folder.changed` and `bookmark.changed` where they are its own;
the service token reads every one. The service keeps
the events since it started, at most the last 1000, numbered upward from its start's moment in
milliseconds times 1000; a resume from before them is 410 `gone`.

## Calls the note service makes

The unit holds its own truth in its own store; the console reaches it, and it reaches one peer, agency, for the
Agent's asks alone (「Agent」), on its control port at `[agent] address` with the token the file `[agent]
token_file` holds:

| Unit | Route | Why |
|---|---|---|
| agency | `GET /role-agents?role=`, `POST /role-agents` | the reader's account's agent of the role, given one where it holds none |
| agency | `POST /slot-requests`, `PATCH /slot-requests/{token}`, `DELETE /slot-requests?owner=` | the ask's slot, waited for and given back |
| agency | `POST /sessions`, `POST /sessions/{sessionId}/turns` | the ask's session on the slot and its one turn |

## Codes

Beside the common codes of bmo-chat's `docs/conventions.md` (`bad-request`, `unauthorized`, `forbidden`,
`no-route`, `not-found`, `gone`, `failed`), each answered as it stands there:

| Code | When |
|---|---|
| `too-large` | a document or an image past the stored byte cap (413) |
| `version-conflict` | a save made from behind the stored version (409, answering the current metadata) |
| `no-owner` | a service-token call naming no account (422) |
| `bad-doc` | a `doc` that is not a TipTap document (422) |
| `trashed` | a write on a note standing in the trash (422) |
| `not-trashed` | a purge of a note that does not stand in the trash (422) |
| `no-folder` | a folder named for a note or a folder that is not one of the caller's (422) |
| `folder-cycle` | a folder moved under itself or under a folder it holds (422) |
| `too-deep` | a folder that would stand past the eighth level (422) |
| `unanswered` | an Agent ask agency refused, could not answer, or whose agent said nothing it could read (502) |
| `no-agent` | an Agent ask where no agency is named or its token cannot be read (503) |

## Settings

The settings are read at start in layers, each overriding the one before: the defaults built into the
binary (the repository's `settings.toml`); then `settings.toml` and `settings.local.toml` in the
settings folder, the one `BMO_NOTE_SETTINGS` names, else the folder above the one holding the binary (a
deployment's root, where `settings.local.toml` links to the data root's `env/note.toml`); then
`BMO_NOTE_<TABLE>__<KEY>` in the environment.

| Table | Key | What it is |
|---|---|---|
| `server` | `listen` | where the service answers, `host:port` |
| `server` | `token` | the service token; an empty one lets no caller in |
| `server` | `data_root` | the data root; under it the store's folder stands where the store path is relative |
| `console` | `token` | the console credential; empty, the console reaches nothing |
| `console` | `folder` | the console bundle's built folder (`client/dist` where none is set; a relative one read from where the process starts) |
| `store` | `path` | the SQLite file; a relative one is read under the data root's `note/` folder |
| `notes` | `max_doc_bytes` | the cap on one stored document, in bytes, as its JSON is stored |
| `notes` | `max_blob_bytes` | the cap on one stored image, in bytes |
| `agent` | `address` | agency's control address; empty, the Agent answers `no-agent` |
| `agent` | `token_file` | the file holding agency's token (`agency.token` where none is set); a relative one is read under the data root's `env/` folder |
| `agent` | `role` | the role whose agents answer, `note-assistant` where none is set |
| `agent` | `supervisor` | the supervisor the platform administrator's asks are asked under; empty where none is set, so they stand under the deployment's own account |
