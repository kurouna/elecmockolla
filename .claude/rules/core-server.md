---
paths:
  - "src/core/**"
---

# src/core - the mock server

Pure Node: no dependencies, no Electron, no imports from `src/main` or `src/renderer`.
The CLI runs these files straight from source, so write erasable TypeScript only (no enums,
no parameter properties, no namespaces) and import with `.ts` extensions.

Files: `config.ts` (.env, presets, FAULT_MODES; no node imports, because the UI imports it),
`files.ts` (disk), `rules.ts` (built-in rules, validation), `default-rules.ts` (the chat,
test-word, kindergarten-fact and ELEC rules), `rules-merge.ts` (offering new and updated
built-in rules to an existing file; the UI imports it), `earlier-defaults.ts` (generated),
`engine.ts` (matching, templates, `{{calc}}`), `server.ts` (HTTP, pacing, faults, control
API), `writers.ts` (wire formats), `scheduler.ts` (slots + queue), `monitor.ts` (records,
series), `proxy.ts` (proxy/mixed modes: forwarding, reply parsing, upstream polling),
`recordings.ts` (recorded replies, matching keys), `export.ts` (JSON, HAR), `models.ts`,
`text.ts`, `random.ts`.

- A proxied reply is read from a copy: `ReplyReader` parses it for the record while the
  client gets the upstream's bytes.
- `upstreamUrl` decides where a path goes: `/v1/...` under `openaiBase` (the upstream URL,
  which need not end in /v1), anything else under `upstreamRoot`. `mapModel` renames the
  request's model for the upstream only; a request it leaves alone is forwarded byte for byte,
  and rules, records and recordings keep the app's model name.
- Durations in Ollama replies are nanoseconds. Real Ollama semantics win: a conversation
  ending in a `tool` message gets words, not the same tool call again (`Prompt.afterTool`).
- `tests/unit/parallel.test.ts` measures parallel slots in mock and proxy modes. A shared
  lock, a single shared timer or a capped HTTP agent would serialize them.
- `engine.ts` caches compiled patterns per rule object (a `WeakMap`), so a rule is replaced,
  never edited in place: an edited rule would keep matching with its old pattern.
- Regex speed is the user's responsibility: a catastrophic pattern can stall the rule tester
  and the server (the README says so). Do not add a regex sandbox.
- `serializeEnv` keeps the `.env` variables it does not manage.
- The upstream API key (`upstreamKey`) stays in main and the server process. The control API
  answers with `maskKey(config)`, and `KEY_MASK` sent back means "keep the key", so a client
  that reads the config and writes it back does not erase it.
