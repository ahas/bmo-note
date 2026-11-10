// The view extensions the editor mounts with: the fork's own page view, held to one mode, with the
// services the preset asks the host for answered by the screen (docs/design.md, 「The console
// surface」). What the preset expects from its app shell, it gets here in the smallest shape.

import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import {
  CommunityCanvasTextFonts,
  DocModeProvider,
  FileSizeLimitProvider,
  FontConfigExtension,
  NotificationProvider
} from "@blocksuite/affine/shared/services";
import { Subscription } from "rxjs";

import type { Container } from "@blocksuite/affine/global/di";
import type { NotificationService } from "@blocksuite/affine/shared/services";
import type { ExtensionType } from "@blocksuite/affine/store";

/// The cap an image may carry, mirroring the store's own (`settings.toml`, `[notes] max_blob_bytes`).
/// The service refuses past its line whoever named what; this one only keeps the editor from
/// uploading a file it already knows the store will send back.
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** What the editor can ask the screen to say: a line, and a question with an answer. */
export interface EditorNotice {
  toast: (message: string) => void;
  confirm: (title: string) => Promise<boolean>;
}

const manager = new ViewExtensionManager(getInternalViewExtensions());

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
  const messages: NotificationService = {
    toast: (message) => notice.toast(String(message ?? "")),
    confirm: async (options) => notice.confirm(String(options.title ?? "")),
    prompt: async () => null,
    notify: (options) => notice.toast(String(options.title ?? "")),
    notifyWithUndoAction: (options) => notice.toast(String(options.title ?? ""))
  };

  return [
    ...(manager.get("page") as ExtensionType[]),
    FontConfigExtension(CommunityCanvasTextFonts),
    {
      setup: (di: Container) => {
        di.override(DocModeProvider, () => mode);
        di.override(NotificationProvider, () => messages);
        di.override(FileSizeLimitProvider, () => ({ maxFileSize: MAX_BLOB_BYTES }));
      }
    }
  ];
}
