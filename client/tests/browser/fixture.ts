// The notes the screens' browser test stands its screens on: realistic notes of a Korean-speaking team, each a
// TipTap document of its title and its lines, saved through the dev host's relay with its icon. The words are
// written as escapes, so the code holds no Hangul of its own (the bundle's check, 「the code」).

import type { Page } from "playwright-core";
import type { DocNode } from "../../shared/types";

/** One note of the fixture: its id, icon, title and the lines of its text. */
export interface FixtureNote {
  id: string;
  icon: string;
  title: string;
  text: string;
}

export const FIXTURE: {
  notes: FixtureNote[];
  trashed: FixtureNote;
  sharedByOther: FixtureNote;
  words: { search: string; none: string };
} = {
  "notes": [
    {
      "id": "kr-weekly",
      "icon": "\ud83d\udcc5",
      "title": "\uc8fc\uac04 \ud68c\uc758\ub85d \u00b7 11\uc6d4 \uc14b\uc9f8 \uc8fc",
      "text": "\ucc38\uc11d: \uae30\ud68d\ud300, \uac1c\ubc1c\ud300, \ub514\uc790\uc778\ud300\n\uacb0\uc815 \uc0ac\ud56d: \ubaa8\ubc14\uc77c \uc571 \ucd9c\uc2dc \uc77c\uc815\uc744 12\uc6d4 \uccab\uc9f8 \uc8fc\ub85c \ud655\uc815\n\ub2e4\uc74c \ud68c\uc758 \uc804\uae4c\uc9c0 \ub9c8\ucf00\ud305 \uc608\uc0b0\uc548 \ucd08\uc548\uc744 \uacf5\uc720\ud558\uae30\ub85c \ud568"
    },
    {
      "id": "kr-budget",
      "icon": "\ud83d\udcca",
      "title": "2027\ub144 \ub9c8\ucf00\ud305 \uc608\uc0b0\uc548",
      "text": "\ubd84\uae30\ubcc4 \uad11\uace0 \uc9d1\ud589 \uacc4\ud68d\uacfc \ucc44\ub110\ubcc4 \uc608\uc0b0 \ubc30\ubd84\n1\ubd84\uae30\ub294 \uac80\uc0c9 \uad11\uace0 \ube44\uc911\uc744 \ub298\ub9ac\uace0 2\ubd84\uae30\uc5d0\ub294 \uc624\ud504\ub77c\uc778 \ud589\uc0ac\ub97c \uc900\ube44"
    },
    {
      "id": "kr-launch",
      "icon": "\ud83d\ude80",
      "title": "\ubaa8\ubc14\uc77c \uc571 \ucd9c\uc2dc \uccb4\ud06c\ub9ac\uc2a4\ud2b8",
      "text": "\uc2a4\ud1a0\uc5b4 \uc2ec\uc0ac \uc81c\ucd9c, \ud478\uc2dc \uc54c\ub9bc \ubb38\uad6c \uac80\ud1a0, \uace0\uac1d\uc13c\ud130 \uc548\ub0b4\ubb38 \uc900\ube44\n\ucd9c\uc2dc \ub2f9\uc77c \ubaa8\ub2c8\ud130\ub9c1 \ub2f4\ub2f9\uc790 \uc9c0\uc815"
    },
    {
      "id": "kr-reading",
      "icon": "\ud83d\udcda",
      "title": "\uc77d\uc744\uac70\ub9ac: \ud300 \uc628\ubcf4\ub529 \uc790\ub8cc \uc815\ub9ac",
      "text": "\uc2e0\uaddc \uc785\uc0ac\uc790\uac00 \uccab \uc8fc\uc5d0 \uc77d\uc5b4\uc57c \ud560 \ubb38\uc11c \ubaa9\ub85d\n\uac1c\ubc1c \ud658\uacbd \uc124\uc815 \uac00\uc774\ub4dc\uc640 \ucf54\ub4dc \ub9ac\ubdf0 \uc6d0\uce59"
    },
    {
      "id": "kr-idea",
      "icon": "",
      "title": "\uc544\uc774\ub514\uc5b4 \uba54\ubaa8",
      "text": "\uac80\uc0c9 \uacb0\uacfc\uc5d0 \ucd5c\uadfc \uc5f0 \ub178\ud2b8\ub97c \uba3c\uc800 \ubcf4\uc5ec \uc8fc\uba74 \uc88b\uaca0\ub2e4"
    },
    {
      "id": "kr-untitled",
      "icon": "",
      "title": "",
      "text": "\uc81c\ubaa9 \uc5c6\uc774 \uc801\uc5b4 \ub454 \uc9e7\uc740 \uba54\ubaa8"
    },
    {
      "id": "kr-trip",
      "icon": "\u2708\ufe0f",
      "title": "\ubd80\uc0b0 \ucd9c\uc7a5 \uc77c\uc815\uacfc \uc219\uc18c \uc815\ub9ac",
      "text": "KTX \uc624\uc804 7\uc2dc \ucd9c\ubc1c, \ud574\uc6b4\ub300 \uadfc\ucc98 \uc219\uc18c 2\ubc15\n\uac70\ub798\ucc98 \ubbf8\ud305\uc740 \ub458\uc9f8 \ub0a0 \uc624\ud6c4 2\uc2dc"
    }
  ],
  "trashed": {
    "id": "kr-old",
    "icon": "\ud83d\uddc2\ufe0f",
    "title": "\uc9c0\ub09c \ubd84\uae30 \ud68c\uace0 \ucd08\uc548",
    "text": "\uc791\ub144 4\ubd84\uae30 \ud68c\uace0 \ucd08\uc548, \uc0c8 \ubb38\uc11c\ub85c \uc62e\uae40"
  },
  "sharedByOther": {
    "id": "kr-shared",
    "icon": "\ud83d\udcac",
    "title": "\ub514\uc790\uc778 \uc2dc\uc2a4\ud15c \uac1c\ud3b8 \ub17c\uc758",
    "text": "\ubc84\ud2bc\uacfc \uc785\ub825\ucc3d\uc758 \ubaa8\uc11c\ub9ac \uaddc\uce59\uc744 \ud1b5\uc77c\ud558\ub294 \uc548\uac74\n\ub2e4\ud06c \ubaa8\ub4dc \ub300\ube44 \uae30\uc900 \uac80\ud1a0"
  },
  "words": {
    "search": "\uc608\uc0b0\uc548",
    "none": "\uc874\uc7ac\ud558\uc9c0\uc54a\ub294\uac80\uc0c9\uc5b4"
  }
};

/** A note's document as the editor writes one: its title node and one paragraph a line. */
export function docOf(title: string, lines: string[]): DocNode {
  const text = (words: string): DocNode[] | undefined => (words === "" ? undefined : [{ type: "text", text: words }]);

  return { type: "doc", content: [{ type: "title", content: text(title) }, ...lines.map((line) => ({ type: "paragraph", content: text(line) }))] };
}

/** Saves each note through the relay as the reader the page's cookie names, with its icon; answers once every
 * one stands. */
export async function seeded(page: Page, notes: FixtureNote[]): Promise<void> {
  const made = notes.map((note) => ({ id: note.id, icon: note.icon, doc: docOf(note.title, note.text.split("\n")) }));

  await page.evaluate(async (made) => {
    const call = async (method: string, path: string, body?: unknown): Promise<void> => {
      const answer = await fetch(`/proxy/note${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

      if (!answer.ok) throw new Error(`${method} ${path}: ${answer.status} ${await answer.text()}`);
    };

    for (const note of made) {
      await call("POST", "/notes", { id: note.id, doc: note.doc });

      if (note.icon !== "") await call("PUT", `/notes/${note.id}/icon`, { icon: note.icon });
    }
  }, made);
}
