// The view extensions the editor mounts with: the fork's own page view, held to one mode, with the
// services the preset asks the host for answered by the screen (docs/design.md, 「The console
// surface」). What the preset expects from its app shell, it gets here in the smallest shape.

import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import { DatabaseBlockSchema, DividerBlockSchema, LatexBlockSchema, TableBlockSchema } from "@blocksuite/affine/model";
import {
  copySelectedModelsCommand,
  deleteSelectedModelsCommand,
  draftSelectedModelsCommand,
  duplicateSelectedModelsCommand,
  getSelectedModelsCommand
} from "@blocksuite/affine/shared/commands";
import {
  ActionPlacement,
  CommunityCanvasTextFonts,
  DocModeProvider,
  FileSizeLimitProvider,
  FontConfigExtension,
  NotificationExtension,
  NotificationProvider,
  ToolbarModuleExtension
} from "@blocksuite/affine/shared/services";
import { BlockFlavourIdentifier, LifeCycleWatcher } from "@blocksuite/affine/std";
import { KeyboardToolbarViewExtension } from "@blocksuite/affine/widgets/keyboard-toolbar/view";
import { svg } from "lit";
import { Subscription } from "rxjs";

import { COPIED } from "./notices";

import type { Container } from "@blocksuite/affine/global/di";
import type { NotificationService, ToolbarAction, ToolbarContext } from "@blocksuite/affine/shared/services";
import type { ExtensionType } from "@blocksuite/affine/store";

/// The cap an image may carry, mirroring the store's own (`settings.toml`, `[notes] max_blob_bytes`).
/// The service refuses past its line whoever named what; this one only keeps the editor from
/// uploading a file it already knows the store will send back.
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** What the editor is given by the screen: the notification service its lines of notice and its questions
 * reach the screen by (`./notices`); and what the selection toolbar's Ask AI key opens, under the word it
 * wears, or none where the note stands read only and the key does not stand. */
export interface EditorNotice {
  messages: NotificationService;
  ask: (() => void) | null;
  askLabel: string;
  blockWords: BlockWords;
}

/** The words of the toolbar over a block selected whole that declares none of its own, in the console's
 * language: its three keys. */
export interface BlockWords {
  copy: string;
  duplicate: string;
  delete: string;
}

// The sparkle the Ask AI key wears, drawn as the format bar's own icon set draws it.
const ASK_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19 9l-1.25-2.75L15 5l2.75-1.25L19 1l1.25 2.75L23 5l-2.75 1.25L19 9Zm0 14l-1.25-2.75L15 19l2.75-1.25L19 15l1.25 2.75L23 19l-2.75 1.25L19 23ZM9 20l-2.5-5.5L1 12l5.5-2.5L9 4l2.5 5.5L17 12l-5.5 2.5L9 20Zm0-4.85L10 13l2.15-1L10 11L9 8.85L8 11l-2.15 1L8 13l1 2.15ZM9 12Z"/></svg>`;

// The keys of a block selected whole that declares no toolbar of its own, drawn as the format bar's own icon
// set draws them.
const COPY_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm0-2h9V4H9zm-4 6q-.825 0-1.412-.587T3 20V6h2v14h11v2zm4-6V4z"/></svg>`;
const DUPLICATE_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M13 14h2v-3h3V9h-3V6h-2v3h-3v2h3zm-5 4q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm0-2h12V4H8zm-4 6q-.825 0-1.412-.587T2 20V6h2v14h14v2zM8 4v12z"/></svg>`;
const DELETE_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z"/></svg>`;

/// The block kinds the fork raises no selection toolbar for once the drag handle selects them whole: each
/// declares no toolbar of its own and is not one the fork's note toolbar covers (`docs/design.md`, 「Every
/// block has its handle and its toolbar」).
const KINDS_WITHOUT_TOOLBAR = [TableBlockSchema, DividerBlockSchema, LatexBlockSchema, DatabaseBlockSchema].map((schema) => schema.model.flavour);

// The keys the fork raises over a line of words, by the ids it gives them. Where the editor's room has no
// place for that bar these fold away and the block's three keys stand in their place (`docs/design.md`,
// 「The selection toolbar never stands wider than the screen」). A key the fork adds, renames or moves is one
// more entry here.
const FORK_KEYS_OF_A_TEXT_BLOCK = ["a.conversions", "b.align", "b.inline-text", "c.highlight", "e.convert-to-database", "f.convert-to-linked-doc", "g.comment", "a.clipboard", "c.delete"];

// The fork's bar over a text block stands 663 pixels wide; below this much room of the editor's own it has
// no place.
const ROOM_FOR_THE_FORK_BAR_PX = 720;

/** Whether the editor holds the room for the fork's bar over a text block. */
function forkBarHasRoom(ctx: ToolbarContext): boolean {
  return ctx.host.getBoundingClientRect().width >= ROOM_FOR_THE_FORK_BAR_PX;
}

/// The fork's page view, but for its phone keyboard bar: on a phone the format bar above the document is the
/// one bar the marks and the kinds stand on, so the fork's second row over the on-screen keyboard is never
/// mounted, whatever agent the browser names or flag the fork sets (`docs/design.md`, 「The console surface」).
const manager = new ViewExtensionManager(getInternalViewExtensions().filter((extension) => extension !== KeyboardToolbarViewExtension));

/** The page-mode view extensions, with the host services the preset reads overridden. */
export function pageExtensions(notice: EditorNotice): ExtensionType[] {
  const mode: DocModeProvider = {
    getPrimaryMode: () => "page",
    onPrimaryModeChange: () => new Subscription(),
    getEditorMode: () => "page",
    setEditorMode: () => {},
    setPrimaryMode: () => {},
    togglePrimaryMode: () => "page"
  };
  return [
    ...(manager.get("page") as ExtensionType[]),
    FontConfigExtension(CommunityCanvasTextFonts),
    textBlockModule(notice.askLabel, notice.ask, notice.blockWords),
    ...KINDS_WITHOUT_TOOLBAR.map((flavour) => blockModule(flavour, blockActions(notice.blockWords))),
    HandlePressKeepsBlock,
    ToolbarKeptOnScreen,
    // The fork's own wrapping of the service, which offers an undo with a notice that asks for one and takes
    // the notice back once the undo is taken another way.
    NotificationExtension(notice.messages),
    {
      setup: (di: Container) => {
        di.override(DocModeProvider, () => mode);
        di.override(FileSizeLimitProvider, () => ({ maxFileSize: MAX_BLOB_BYTES }));
      }
    }
  ];
}

/** The keys the toolbar raises over a line of words, or a run of them: Ask AI leading them where the note
 * answers; the fork's own keys standing while the editor holds room for that bar; and the block's three
 * keys of the bundle's own standing where it does not, since what the fork's keys reach for — the marks,
 * the kinds, a table — the format bar above the document already carries at every width (`docs/design.md`,
 * 「The selection toolbar never stands wider than the screen」). */
function textBlockModule(label: string, ask: (() => void) | null, words: BlockWords): ExtensionType {
  return ToolbarModuleExtension({
    id: BlockFlavourIdentifier("custom:affine:note"),
    config: {
      actions: [
        // Ask AI leads the toolbar, wearing the word it opens.
        ...(ask === null
          ? []
          : [
              {
                id: "A.ask",
                placement: ActionPlacement.Start,
                score: -1,
                label,
                showLabel: true,
                icon: ASK_ICON,
                run: () => ask()
              } satisfies ToolbarAction
            ]),
        ...FORK_KEYS_OF_A_TEXT_BLOCK.map((id): ToolbarAction => ({ id, when: forkBarHasRoom })),
        ...blockActions(words, (ctx) => !forkBarHasRoom(ctx))
      ]
    }
  });
}

// The blocks a toolbar key acts on: those selected whole, each counted once with what it holds.
const SELECTED_WHOLE = { types: ["block" as const], mode: "highest" as const };

/** The keys of a block selected whole that declares no toolbar of its own: copy, duplicate and delete, the
 * three every other block carries in its more menu, run through the same commands, named in `words` and
 * standing wherever `when` says. The delete is named apart from the fork's more-group of the same words, so
 * the two are never merged into one key. */
function blockActions(words: BlockWords, when?: (ctx: ToolbarContext) => boolean): ToolbarAction[] {
  return [
    {
      id: "a.copy",
      when,
      tooltip: words.copy,
      icon: COPY_ICON,
      run: ({ chain, std }) => {
        const [copied] = chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(draftSelectedModelsCommand).pipe(copySelectedModelsCommand).run();

        if (copied) std.get(NotificationProvider).toast(COPIED);
      }
    },
    {
      id: "b.duplicate",
      when,
      tooltip: words.duplicate,
      icon: DUPLICATE_ICON,
      run: ({ chain, store }) => {
        store.captureSync();
        chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(duplicateSelectedModelsCommand).run();
      }
    },
    {
      id: "d.delete",
      when,
      tooltip: words.delete,
      icon: DELETE_ICON,
      run: ({ chain }) => {
        chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(deleteSelectedModelsCommand).run();
      }
    }
  ];
}

/** The toolbar of a block of `flavour` selected whole, holding `actions`. */
function blockModule(flavour: string, actions: ToolbarAction[]): ExtensionType {
  return ToolbarModuleExtension({
    id: BlockFlavourIdentifier(flavour),
    config: { actions }
  });
}

/** The sheet the bundle lays in the fork's toolbar widget, which holds the bar to the screen: past the
 * room the screen leaves it, the bar takes a second row rather than stand past the edge, and grows as tall
 * as its rows need, since the fork drew it one row tall (`docs/design.md`, 「The selection toolbar never
 * stands wider than the screen」). The 40 pixels are the room the bar keeps clear of the screen's edge
 * besides its own padding and edge, which stand outside the width the cap holds. */
const FITTING_SHEET = "editor-toolbar[data-open] { flex-wrap: wrap; justify-content: center; height: auto; min-height: 36px; max-width: calc(100vw - 40px); }";

/** Over a text block the fork's toolbar is wider than a phone, and its more menu and the delete in it
 * stand past the screen's edge. The bar stands in the shadow room of the fork's own widget, which no rule
 * of the bundle reaches from outside, so the bundle lays a sheet of its own in that room. The editor draws
 * its widgets after the watchers it mounts have run, so the widget is followed rather than read once, and
 * the sheet goes in beside the fork's own only once the widget has drawn. */
class ToolbarKeptOnScreen extends LifeCycleWatcher {
  static override readonly key = "note-toolbar-kept-on-screen";

  override mounted(): void {
    const host = this.std.host;

    // The fork's own sheet is laid with the widget's first draw; the bundle's goes beside it after.
    const fit = (widget: ToolbarWidget): void => {
      void widget.updateComplete.then(() => {
        const room = widget.shadowRoot;

        if (room === null) return;

        const sheet = new CSSStyleSheet();

        sheet.replaceSync(FITTING_SHEET);
        room.adoptedStyleSheets = [...room.adoptedStyleSheets, sheet];
      });
    };

    const shown = host.querySelector<ToolbarWidget>("affine-toolbar-widget");

    if (shown !== null) {
      fit(shown);

      return;
    }

    const watch = new MutationObserver(() => {
      const widget = host.querySelector<ToolbarWidget>("affine-toolbar-widget");

      if (widget === null) return;

      watch.disconnect();
      fit(widget);
    });

    watch.observe(host, { childList: true, subtree: true });
    host.disposables.add(() => watch.disconnect());
  }
}

/** The fork's toolbar widget, as far as this bundle reaches into it: its drawing room and its draw. */
interface ToolbarWidget extends Element {
  readonly shadowRoot: ShadowRoot | null;
  readonly updateComplete: Promise<unknown>;
}

/** A press on the drag handle selects its block whole, but the press lands inside the editable page, so the
 * browser also lays a caret in the nearest line; the editor turns that caret into a text selection a moment
 * later, over the block. The caret is dropped as the press is let go, before the editor reads it, so the block
 * stays selected whole however long the press was held (`docs/design.md`, 「Every block has its handle and its
 * toolbar」). A drag from the handle is not touched: its press goes down as the browser has it. */
class HandlePressKeepsBlock extends LifeCycleWatcher {
  static override readonly key = "note-handle-press-keeps-block";

  override mounted(): void {
    const host = this.std.host;

    host.disposables.addFromEvent(
      host,
      "pointerup",
      (event: PointerEvent) => {
        const onHandle = event.composedPath().some((target) => target instanceof Element && target.localName === "affine-drag-handle-widget");

        if (onHandle) host.ownerDocument.getSelection()?.removeAllRanges();
      },
      { capture: true }
    );
  }
}
