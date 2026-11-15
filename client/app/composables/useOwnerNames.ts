// The names of the accounts whose notes the reader is shown, as the console's people directory answers
// each key once (bmo-ui `docs/console-bundles.md`, the people directory); a key it answers none for, and
// every key where the console offers no directory, stands as itself.

import { inject, ref } from "vue";

import { CONSOLE_PEOPLE } from "../domain/share";

import type { ConsolePeople } from "../domain/share";

export function useOwnerNames() {
  const people = inject<ConsolePeople | null>(CONSOLE_PEOPLE, null);
  const names = ref<Record<string, string>>({});

  const asked = new Set<string>();

  /** The name of the account `key`, asked of the directory the first time it is named; the key itself until
   * the directory answers. The ask waits for the drawing that named it to end. */
  function nameOf(key: string): string {
    if (people !== null && !asked.has(key)) {
      asked.add(key);
      queueMicrotask(() => {
        void people
          .person(key)
          .then((person) => {
            if (person !== null) names.value = { ...names.value, [key]: person.name };
          })
          .catch(() => {});
      });
    }

    return names.value[key] ?? key;
  }

  return { people, nameOf };
}
