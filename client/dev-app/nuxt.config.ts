// A host of one's own: the smallest Nuxt app that loads this bundle as a console would, for a worker's
// browser check of the screens before the platform console is told about the unit at all (the job report
// names what it stands in for and what it cannot). It is not the console: the frame, the sign-in and the
// owner headers the console sets stand here as fixed development values.
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineNuxtConfig({
  extends: [".."],
  compatibilityDate: "2025-09-01",
  devtools: { enabled: false },
  // A console bundle mounts in the browser; this host renders nothing of it on the server.
  ssr: false,

  app: {
    baseURL: "/"
  },
  appConfig: {
    bmoUi: {
      // The dev relay: every bundle call goes to /proxy/<service>/... and stands for the console's own
      // relay of the unit, answered by `server/routes/proxy/[...].ts`.
      relayBase: "/proxy",
      translator: { service: "", path: "", batch: 4, asksAtOnce: 1 }
    }
  },
  vite: {
    plugins: [vanillaExtractPlugin()],
    // The editor rides the same road the bundle build takes: its sources arrive decorator-free from
    // `bun run vendor` and transform file by file, never through the optimizer, which reads no
    // tsconfigs, and never by the plain Node import of the server renderer, which reads no TypeScript
    // either. The target is one every console browser speaks, as the bundle build's config states.
    oxc: { target: "chrome120" },
    build: { target: "chrome120" },
    optimizeDeps: {
      // Vite reads this list as package names, not patterns: the bare scope keeps every package under
      // it out of the optimizer, where a regular expression breaks the dev server's scan.
      exclude: ["@blocksuite"]
    },
    ssr: { noExternal: [/@blocksuite/] }
  },

});
