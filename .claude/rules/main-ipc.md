---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/shared/**"
---

# Electron main, preload and the IPC contract

`src/main/index.ts` owns the window and IPC, `host.ts` + `server.worker.ts` run the server in
a utility process, `client.ts` holds the playground and load generator, `capture.ts` the
screenshot mode. `src/preload` exposes `window.mockolla`, the only bridge. `src/shared` is the
IPC contract, type-only except `channels.ts`.

- The renderer is untrusted, so main validates every IPC argument (`toPlayground`,
  `normalizeRules`, `patchConfig`). Never expose a generic channel.
- Every config main sends to the renderer goes through `maskKey`: the UI never holds the
  upstream API key, only the mask.
- The server never blocks the UI: it runs in the utility process and sends a snapshot every
  200 ms.
- Keep what crosses IPC small, and expect it to grow. Rules and recordings keep growing, so
  the UI gets recording summaries (pushed at most every 500 ms) and fetches one recording when
  it is shown.
- Compiled rule patterns are cached per rule object, so rules are replaced, never edited in
  place.
