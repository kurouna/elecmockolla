---
paths:
  - "tests/**"
---

# Tests

`tests/unit` is vitest; the server tests drive the official `ollama` and `openai` clients, so
they catch wire-shape regressions. Areas: server, api (model management, control API, OpenAI
extras, test commands), parallel (slots really run at once), proxy, recordings, engine,
chat-rules and rule-coverage, defaults, upgrade, config, files, cli (spawns
`src/core/cli.ts`), client (main's playground and load generator), export, elec, renderer
(the renderer's dependency-free helpers, such as `lib/equal.ts`).

`tests/e2e` is Playwright driving the built app, so run `npm run build` first; each spec
starts the app with its own folder and port. `tests/fixtures/rules-v0.0.1.json` is a rules
file a released version wrote, for the upgrade tests.

New code gets tests in the matching file, including what must NOT happen. To find gaps:
`npm i --no-save @vitest/coverage-v8@<vitest version>` then
`npx vitest run --coverage --coverage.provider=v8 --coverage.include='src/core/**'`.
