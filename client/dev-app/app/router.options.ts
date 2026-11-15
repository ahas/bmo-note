// The dev host stands the bundle's own routes, as a console adds them, in place of the routes Nuxt would make
// from the pages folder, so the screens stand here under the same names, paths and keys they stand under in
// a console.

import bundle from "../../console/routes";

import type { RouterConfig } from "@nuxt/schema";

export default {
  routes: () => bundle.routes
} satisfies RouterConfig;
