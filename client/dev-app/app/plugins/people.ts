// The dev host's stand-in for the console's people directory (bmo-ui `docs/console-bundles.md`, the
// people directory), offered under the same key, so the share dialog's member part stands here as it does
// in the console. Its people are made up; the reader is the one the dev host's reader cookie names.

import type { SharePerson } from "bmo-ui/app/domain/share-members";

import { CONSOLE_PEOPLE } from "../../../app/domain/share";

/** The made-up people of the stand-in company, each by an account key the relay may present. */
const PEOPLE: SharePerson[] = [
  { user: "1", name: "Owner Tester", organization: "QA", jobTitle: "Lead" },
  { user: "2", name: "Member Tester", organization: "QA", jobTitle: "Engineer" },
  { user: "3", name: "Stranger Tester", organization: "Support", jobTitle: "Agent" }
];

/** The most people one search answers, as the console's does. */
const FOUND_MAX = 20;

function holds(person: SharePerson, words: string): boolean {
  const asked = words.trim().toLowerCase();

  return [person.name, person.organization, person.jobTitle].some((field) => field.toLowerCase().includes(asked));
}

export default defineNuxtPlugin({
  name: "note-dev-people",
  setup(nuxtApp) {
    const reader = useCookie<string | null>("bmo-dev-reader");

    nuxtApp.vueApp.provide(CONSOLE_PEOPLE, {
      search: async (words: string) => (words.trim() === "" ? [] : PEOPLE.filter((person) => holds(person, words)).slice(0, FOUND_MAX)),
      person: async (user: string) => PEOPLE.find((person) => person.user === user) ?? null,
      me: async () => PEOPLE.find((person) => person.user === (reader.value ?? "1")) ?? null
    });
  }
});
