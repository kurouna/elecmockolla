# CLAUDE.md

elecmockolla is a mock Ollama server (`src/core`) with an Electron 44 + Svelte 5 dashboard.
MIT. Developed on Windows. Repository: github.com/kurouna/elecmockolla (branch `main`).

Area-specific guidance lives in `.claude/rules/` and loads when you open a matching file:
`core-server.md`, `builtin-rules.md` (the reply rules the mock serves), `main-ipc.md`,
`renderer-ui.md`, `tests.md`, `release.md`. Read `release.md` yourself before a release, a
dependency update or new screenshots: those start with a shell command, which loads nothing.

## Commands

```bash
npm install          # postinstall downloads Electron (install-electron)
npm start            # the app (electron-vite dev); creates .env and rules.json in the project
npm run serve        # the server alone, from source (node src/core/cli.ts serve)
npm run verify       # biome + typecheck (node, web) + vitest
npm run build        # out/ ; test:e2e and screenshots need it
npm run test:e2e     # Playwright drives the built app (tests/e2e)
npm run package      # installers into release/ (electron-builder)
npm run gen:icon     # build/icon.svg -> build/icon.png, resources/icons/icon.png
npm run gen:earlier-defaults  # after changing a built-in reply rule
npm run screenshots  # docs/screenshots, for the README and posts
```

Single test: `npx vitest run tests/unit/server.test.ts -t "<name>"`.

## Layout

```
src/core/      the server: pure Node, no dependencies, no Electron. The CLI runs it straight
               from source, so erasable TypeScript only and `.ts` import extensions
src/main/      Electron main: window and IPC (index.ts), the server's utility process
               (host.ts, server.worker.ts), playground and load generator (client.ts),
               screenshot mode (capture.ts)
src/preload/   window.mockolla, the only bridge
src/shared/    types and the IPC contract (type-only, except channels.ts)
src/renderer/  Svelte UI: lib/state.svelte.ts is the single store; pages/, components/
tests/unit/    vitest, one file per area; tests/e2e/ is Playwright on the built app
tests/fixtures/ rules files earlier releases wrote (upgrade tests)
scripts/       gen-icon, earlier-defaults, screenshots
.github/       ci.yml (lint, typecheck, unit + e2e on Windows/macOS/Linux, package),
               release.yml (tag vX.Y.Z -> verify -> GitHub pre-release)
```

## Invariants

These hold across the whole repository. The rule files add the details for their area and
do not repeat these lines.

- Wire compatibility first: a change to any response shape must keep the official `ollama`
  and `openai` client tests passing.
- Proxied replies are never rewritten. In proxy and mixed modes the reply reaches the client
  as the upstream sent it; faults cut a reply, they never edit it. On the way up, only the
  model map may change a request (its `model`).
- `.env` through `src/core/config.ts` is the only source of settings: the UI edits it, the CLI
  reads it.
- The renderer is untrusted and offline. Network and files live in main, which validates every
  IPC argument; never expose a generic channel.
- Requests are truly parallel: N requests on N slots take as long as one, so nothing may
  serialize request handling.
- Replies are reproducible: every random choice goes through an `Rng`, so a seed makes the same
  prompt give the same text.
- Two languages: every UI string goes through `t()` with a key in both locales. Server, CLI
  and `.env` comments stay English.

## Workflow

- Commit and push only when asked. Messages: `type(scope): English / 日本語`, body lines
  English / 日本語.
- Run `npm run verify` before a commit; after UI or main changes also `npm run build`, then
  `npm run test:e2e`.
- New code gets unit tests in the matching `tests/unit` file, including what must not happen.
