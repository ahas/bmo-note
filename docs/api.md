# The boundary API

Every route bmo-note answers, the events it publishes, and the calls it makes. The wire format is the
platform's (bmo-chat `docs/conventions.md`): camelCase keys, times in epoch milliseconds, ids as
strings, a failure a non-2xx status with `code` (kebab-case) and `error` (an English sentence), a list
`{items, more}` read with `after` and `limit`. A note document travels as a base64 string in the
`doc` field: the whole Yjs state of one BlockSuite document, opaque to this service
(`docs/design.md`, 「What a note is」).

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

The service is ready once its store is open. It calls no other unit; its screens speak to the receiver
directly through the console's relay, on the manifest's `calls` (below).

## Notes

| Method | Path | Does |
|---|---|---|
| GET | `/notes?deleted=&shared=&after=&limit=` | The caller's notes, newest changed first — `{items, more}`; `deleted=true` answers the trash, `shared=true` the live notes other accounts share with the caller |
| POST | `/notes` | Makes a note: `id?`, `title`, `doc` (base64) — 201, or 200 with the note as it stands where the id is already held (idempotent by id; stored bytes unchanged) |
| GET | `/notes/{noteId}?owner=` | One note with its document |
| PATCH | `/notes/{noteId}?owner=` | Saves: `version` (required), `title?`, `doc?`, `restore?` — 200, or 409 `version-conflict` answering the current metadata |
| DELETE | `/notes/{noteId}?purge=` | Moves the note to the trash, or, with `purge=true`, deletes it for good where it stands trashed, its stored images with it — 204 |
| PUT | `/notes/{noteId}/blobs/{blobId}?owner=` | Stores one image with the live note: the body is its bytes, `content-type` its image type — 204; an id already held keeps the bytes it was first given (a re-upload answers the same 204 whatever it carries) |
| GET | `/notes/{noteId}/blobs/{blobId}?owner=` | One stored image: its bytes with the type it was stored under, `cache-control: private, max-age=31536000, immutable`; 404 where none stands |

A note metadata is `id`, `owner` (the account key the note belongs to), `title` (may be empty; the
screen names an empty one by its own word), `version` (a whole number from 1, held up on each save),
`createdAt`, `changedAt`, `size` (stored doc bytes), `deletedAt` (null while the note lives), and
`access`, what the caller holds of it: `owner`, or the member's `edit` or `read`. A note read adds
`doc`. A write's `id` is 1 to 64
letters, digits, `-` and `_`; one is made where none is given (lowercase hexadecimal). A `doc` that is
not base64 for at least one byte is 422 `bad-doc`; a `title` over 300 characters, a `version` below 1
or a body that is not one object is 400 `bad-request`; a decoded `doc` over `[notes] max_doc_bytes` is
413 `too-large`; a note the account does not hold live is 404 `not-found`; a `restore` or `doc` write
on a trashed note is 422 `trashed`; a `purge` of a live note is 422 `not-trashed`. A `PATCH` whose
`version` is below the stored one answers 409 `version-conflict`; one at or above it saves (a writer
who read ahead of the service loses nothing it did not already hold). `restore=true` with no `doc`
moves a trashed note back to life and writes nothing else; on a live note it changes nothing.
`deleted=true` with `shared=true` is 400 `bad-request`. The shared view's cursor is
`changedAt:id:owner` of its last row, since two accounts may each hold a note at one id; the own
views' is `changedAt:id`.

The blob routes stand under the note: a `PUT` needs the note live (a trashed note is 422 `trashed`, no
note 404), its `content-type` must name an image, its `blobId` must be a BlockSuite blob key (1 to
128 letters, digits, `-`, `_` and `=`), and its bytes must not pass `[notes] max_blob_bytes` (413
`too-large`). A
`GET` answers wherever the note stands, live or trashed, to its owner, and to a member while the note
lives (「Sharing」); a purge has taken the blobs.

A service-token call on these routes answers for the `owner` it names; one naming none is 422
`no-owner`.

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

- with `read`: `GET /notes/{noteId}` and `GET /notes/{noteId}/blobs/{blobId}`;
- with `edit`: those, and `PATCH /notes/{noteId}` without `restore` and
  `PUT /notes/{noteId}/blobs/{blobId}`, as the owner's own;
- with either, nothing else: a write a `read` share does not open, a trash, a purge, a restore and the
  sharing routes are 403 `forbidden`.

A note not shared with the reader, one in the trash, and one whose share was taken back are 404
`not-found`, as a note that does not stand is.

### Share reads

The note's share page reads with the link's token alone, with no owner key and no role, under the
service token or the console credential (「Console」):

| Method | Path | Does |
|---|---|---|
| GET | `/shares/{token}` | The note the link opens: `id`, `title`, `changedAt`, `size`, `expiresAt` and `doc` |
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
  role `member` and the owner key, the event stream (below), no WebSocket, and under `calls` the
  receiver alone (the AI talk panel's `POST /talks`, on the receiver's own terms); under `shareReads`
  the two share reads (「Sharing」), which make the bundle's share page; no push kinds, relays or share
  head;
- the bundle build's folder (`[console] folder`), as bmo-ui's bundle build writes it: the module
  `bundle.js`, the stylesheet `bundle.css`, the words `words.json`, the layer `layer.json`, and the
  chunks and fonts the editor loads as it works, read once at start;
- the console credential (`[console] token`).

The note uses the contract's share page and its sharing with members; the people the dialog offers
are the console's people directory, which the bundle reads in the browser, so the service calls no
unit for them.

The screens' routes are the notes, their blobs, their sharing, the share reads and the event stream. Where the credential is empty, or
the folder cannot be served, no face stands, the reason is written to the service's log, and the
console's routes answer 404 `no-route`; the service's own routes are answered as ever.

`bmo-note console-reach` prints, as one JSON object, how a console reaches the service: `address`, the
base address its settings name, `consoleToken`, the console credential, and `token`, the service token,
which the console's routes refuse. A deployment's console probe runs it (bmo-testbed `docs/deploy.md`,
「The console probe」).

## Events the note service publishes

`GET /events` is a server-sent stream in the platform's shape (`after` or `Last-Event-ID`, `kinds`;
the same events as a page to `Accept: application/json`, with `after` and `limit`): `note.saved`,
`note.trashed`, `note.restored` and `note.purged`, each carrying `noteId` and `owner`; and
`note.shared` and `note.unshared`, carrying `noteId`, `owner` and `member`, the shared one
`permission` too. A console reader is given the events of its own notes and of the notes shared with
it when they were published, and a share's own two events where it is that share's owner or member;
the service token reads every one. The service keeps
the events since it started, at most the last 1000, numbered upward from its start's moment in
milliseconds times 1000; a resume from before them is 410 `gone`.

## Calls the note service makes

None. The unit holds its own truth in its own store and reaches no peer; the console reaches it, not
the other way round.

## Codes

Beside the common codes of bmo-chat's `docs/conventions.md` (`bad-request`, `unauthorized`, `forbidden`,
`no-route`, `not-found`, `gone`, `failed`), each answered as it stands there:

| Code | When |
|---|---|
| `too-large` | a document or an image past the stored byte cap (413) |
| `version-conflict` | a save made from behind the stored version (409, answering the current metadata) |
| `no-owner` | a service-token call naming no account (422) |
| `bad-doc` | a `doc` that is not base64 bytes (422) |
| `trashed` | a write on a note standing in the trash (422) |
| `not-trashed` | a purge of a note that does not stand in the trash (422) |

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
| `notes` | `max_doc_bytes` | the cap on one stored document, in bytes |
