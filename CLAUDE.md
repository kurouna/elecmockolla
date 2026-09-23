# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

elecmockolla is a mock Ollama server (`src/core`) with an Electron 44 + Svelte 5 dashboard.
MIT. Developed on Windows. Repository: github.com/kurouna/elecmockolla (branch `main`).

## Commands

```bash
npm install          # postinstall downloads Electron (install-electron)
npm start            # the app (electron-vite dev); creates .env and rules.json in the project
npm run serve        # the server alone, from source (node src/core/cli.ts serve)
npm run verify       # biome + typecheck (node, web) + vitest - run before every commit
npm run build        # out/ ; test:e2e and screenshots need it
npm run test:e2e     # Playwright drives the built app (tests/e2e)
npm run package      # installers into release/ (electron-builder)
npm run gen:icon     # build/icon.svg -> build/icon.png, resources/icons/icon.png
npm run gen:earlier-defaults  # after changing a built-in rule (see Rules)
npm run screenshots  # docs/screenshots, for the README and posts only - not a user feature
```

Single test: `npx vitest run tests/unit/server.test.ts -t "<name>"`.

## Layout

```
src/core/      the server. Pure Node, no dependencies, no Electron. Run by the CLI straight
               from source, so: erasable TypeScript only, `.ts` import extensions.
               config.ts (.env, presets, FAULT_MODES; no node imports - the UI uses it),
               files.ts (disk), rules.ts (built-in rules, validation), default-rules.ts (the
               chat, test-word, kindergarten-fact and ELEC rules), rules-merge.ts (offering
               new and updated built-in rules to an existing file; the UI uses it),
               earlier-defaults.ts (generated), engine.ts (matching, templates, {{calc}}),
               server.ts (HTTP, pacing, faults, control API), writers.ts (wire formats),
               scheduler.ts (slots + queue), monitor.ts (records, series), proxy.ts
               (proxy/mixed modes: forwarding, reply parsing, upstream polling),
               recordings.ts (recorded replies, matching keys), export.ts (JSON, HAR),
               models.ts, text.ts, random.ts
src/main/      Electron main: index.ts (window, IPC), host.ts (utility process),
               server.worker.ts (the utility process entry), client.ts (playground, load
               generator), capture.ts (screenshot mode)
src/preload/   window.mockolla, the only bridge
src/shared/    types and the IPC contract (type-only, except channels.ts)
src/renderer/  Svelte UI: lib/state.svelte.ts is the single store; pages/, components/
tests/unit/    vitest; server tests use the official ollama and openai clients
tests/e2e/     Playwright + Electron; each spec starts the app with its own folder and port
tests/fixtures/ rules-v0.0.1.json: the rules file a released version wrote (upgrade tests)
scripts/       gen-icon, earlier-defaults, screenshots
.github/       ci.yml (lint, typecheck, unit + e2e on Windows/macOS/Linux, package),
               release.yml (tag vX.Y.Z -> verify -> GitHub pre-release with every build)
```

## Rules

- **Proxied bytes are never rewritten.** In proxy and mixed modes the reply goes to the client
  as Ollama sent it; `ReplyReader` parses a copy for the record. Faults cut a reply, they do
  not edit it.
- **Wire compatibility first.** Any change to a response shape must keep the `ollama` and
  `openai` client tests passing. Durations in Ollama replies are nanoseconds. Real Ollama
  semantics win: e.g. a conversation ending in a `tool` message gets words, not the same tool
  call again (`Prompt.afterTool`).
- **The renderer is untrusted and offline**: sandboxed, CSP `connect-src 'self'`. Network and
  files live in main; main validates every IPC argument (`toPlayground`, `normalizeRules`,
  `patchConfig`). Never expose a generic channel.
- **One source of settings**: `.env` via `core/config.ts`. The UI edits it, the CLI reads it.
  `serializeEnv` keeps variables it does not manage.
- **The server never blocks the UI**: it runs in a utility process and sends a snapshot every
  200 ms. Snapshots are `$state.raw` in the renderer - replace, never mutate.
- **Keep what crosses IPC small, and expect it to grow.** Rules and recordings will keep
  growing: the UI gets recording summaries (pushed at most every 500 ms) and fetches one
  recording when it is shown; long lists draw a bounded number of rows. The renderer must not
  import `core/rules.ts` or `default-rules.ts` (it would bundle every built-in rule) - it gets
  them from main. Compiled rule patterns are cached per rule object, so rules are replaced,
  never edited in place.
- **Built-in rules** (`default-rules.ts`): each intent is a Japanese and an English rule;
  patterns read the first line only (`^[^\n]*`, no `m` flag). Order matters: exact inputs
  (test words, arithmetic, simple facts) first, then requests (most specific first), small
  talk last, so "誕生日プレゼントのおすすめ" is a recommendation, not a birthday. A captured
  word must be what the reply claims it is (明日 is not a city). Every new intent gets cases
  in `tests/unit/chat-rules.test.ts`, including prompts it must NOT catch.
- **Built-in rule changes reach existing files through the Rules page offer**
  (`rules-merge.ts`): a new id is offered as new; a changed built-in rule is offered as an
  update only to files that still hold an earlier version unedited (by fingerprint). After
  changing a built-in rule: commit, run `npm run gen:earlier-defaults` (it reads the git
  history), commit `earlier-defaults.ts`. `tests/unit/upgrade.test.ts` checks a real v0.0.1
  file; add a fixture for a release when an upgrade path matters.
- **Two languages**: every UI string goes through `t()` (`renderer/lib/i18n.svelte.ts`); add
  the key to `locales/en.ts` and `locales/ja.ts` (the typecheck enforces both). `code` and
  **bold** in a string need `<Rich>`. Server, CLI and `.env` comments stay English.
- **Reproducible replies**: every random choice in replies goes through a `Rng`; with a seed the
  same prompt must give the same text.
- **Regex speed is the user's responsibility**: a catastrophic pattern can stall the rule
  tester and the server (documented in the README); do not add a regex sandbox.

## Workflow

- Commit and push only when asked. Messages: `type(scope): English / 日本語`, body lines
  English / 日本語.
- Before a commit: `npm run verify`; after UI or main changes also `npm run build` and
  `npm run test:e2e`. CI must be green before a release.
- Release: set `version` in package.json, commit, push, then tag `vX.Y.Z` and push the tag.
  The workflow creates a pre-release (unsigned-build notes in English and Japanese, then the
  generated changes); a person promotes it to a full release.
- README screenshots come from `npm run screenshots` (build first). Screenshot mode hides the
  settings folder path and types `hello` into the rule tester.
