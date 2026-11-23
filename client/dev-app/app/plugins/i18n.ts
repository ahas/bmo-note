// The dev host speaks to its screens with the bundle's own words and nothing else: vue-i18n stood up by
// hand, the pack read from the bundle's i18n folder. The console keeps a full language pack of its own;
// this host needs none beyond what the bundle shows. A browser may ask for Korean, Japanese or
// Simplified Chinese by the dev host's own cookie.

import { createI18n } from "vue-i18n";

import en from "../../../i18n/en.json";
import ja from "../../../i18n/ja.json";
import ko from "../../../i18n/ko.json";
import zhCN from "../../../i18n/zh-CN.json";

/** The cookie a browser names the dev host's language by, English where none is set. */
const LOCALE_COOKIE = "bmo-dev-locale";

/** The packs by the locale code the cookie names. */
const MESSAGES = { en, ko, ja, "zh-CN": zhCN };

export default defineNuxtPlugin({
  name: "note-dev-i18n",
  enforce: "pre",
  setup(nuxtApp) {
    const asked = useCookie<string | null>(LOCALE_COOKIE).value ?? "";
    const locale = Object.hasOwn(MESSAGES, asked) ? asked : "en";

    nuxtApp.vueApp.use(createI18n({ legacy: false, globalInjection: true, locale, fallbackLocale: "en", messages: MESSAGES }));
  }
});
