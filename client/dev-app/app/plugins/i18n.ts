// The dev host speaks to its screens with the bundle's own words and nothing else: vue-i18n stood up by
// hand, the pack read from the bundle's i18n folder. The console keeps a full language pack of its own;
// this host needs none beyond what the bundle shows.

import { createI18n } from "vue-i18n";

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";

export default defineNuxtPlugin({
  name: "note-dev-i18n",
  enforce: "pre",
  setup(nuxtApp) {
    nuxtApp.vueApp.use(createI18n({ legacy: false, globalInjection: true, locale: "en", fallbackLocale: "en", messages: { en, ko } }));
  }
});
