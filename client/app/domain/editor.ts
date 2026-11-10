// The view extensions the editor mounts with: the fork's own page view, held to one mode, with the
// services the preset asks the host for answered by the screen (docs/design.md, 「The console
// surface」). What the preset expects from its app shell, it gets here in the smallest shape.

import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import { CommunityCanvasTextFonts, DocModeProvider, FontConfigExtension, NotificationProvider } from "@blocksuite/affine/shared/services";
import { Subscription } from "rxjs";

import type { Container } from "@blocksuite/affine/global/di";
import type { NotificationService } from "@blocksuite/affine/shared/services";
import type { ExtensionType } from "@blocksuite/affine/store";

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
      }
    }
  ];
}
