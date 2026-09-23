# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

elecmockolla is a mock Ollama server (`src/core`) with an Electron 44 + Svelte 5 dashboard.
MIT. Developed on Windows.

## Commands

```bash
npm install          # postinstall downloads Electron (install-electron)
npm start            # the app (electron-vite dev); creates .env and rules.json in the project
npm run serve        # the server alone, from source (node src/core/cli.ts serve)
npm run verify       # biome + typecheck (node, web) + vitest
npm run build        # out/ ; `npm run screenshots` needs it
```

Single test: `npx vitest run tests/unit/server.test.ts -t "<name>"`.

## Layout

```
src/core/      the server. Pure Node, no dependencies, no Electron. Run by the CLI straight
               from source, so: erasable TypeScript only, `.ts` import extensions.
               config.ts (.env, presets; no node imports - the UI uses it), files.ts (disk),
               rules.ts (defaults, validation), engine.ts (matching, templates), server.ts
               (HTTP, pacing, faults, control API), writers.ts (wire formats), scheduler.ts
               (slots + queue), monitor.ts (records, series), proxy.ts (proxy/mixed modes:
               forwarding, reply parsing, upstream polling), models.ts, text.ts, random.ts
src/main/      Electron main: index.ts (window, IPC), host.ts (utility process),
               server.worker.ts (the utility process entry), client.ts (playground, load
               generator), capture.ts (screenshot mode)
src/preload/   window.mockolla, the only bridge
src/shared/    types and the IPC contract (type-only, except channels.ts)
src/renderer/  Svelte UI: lib/state.svelte.ts is the single store; pages/, components/
tests/unit/    vitest; server tests use the official ollama and openai clients
```

## Rules

- **Proxied bytes are never rewritten.** In proxy and mixed modes the reply goes to the client
  as Ollama sent it; `ReplyReader` parses a copy for the record. Faults cut a reply, they do
  not edit it.
- **Wire compatibility first.** Any change to a response shape must keep the `ollama` and
  `openai` client tests passing. Durations in Ollama replies are nanoseconds.
- **The renderer is untrusted and offline**: sandboxed, CSP `connect-src 'self'`. Network and
  files live in main; main validates every IPC argument (`toPlayground`, `normalizeRules`,
  `patchConfig`). Never expose a generic channel.
- **One source of settings**: `.env` via `core/config.ts`. The UI edits it, the CLI reads it.
  `serializeEnv` keeps variables it does not manage.
- **The server never blocks the UI**: it runs in a utility process and sends a snapshot every
  200 ms. Snapshots are `$state.raw` in the renderer - replace, never mutate.
- **Two languages**: every UI string goes through `t()` (`renderer/lib/i18n.svelte.ts`); add
  the key to `locales/en.ts` and `locales/ja.ts` (the typecheck enforces both). `code` and
  **bold** in a string need `<Rich>`. Server, CLI and `.env` comments stay English.
- **Reproducible replies**: every random choice in replies goes through a `Rng`; with a seed the
  same prompt must give the same text.
