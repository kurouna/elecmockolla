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

- Proxied bytes are never rewritten. In proxy and mixed modes the reply reaches the client
  exactly as Ollama sent it; `ReplyReader` parses a copy for the record. Faults cut a reply,
  they never edit it.
- Wire compatibility first: any change to a response shape must keep the `ollama` and
  `openai` client tests passing. Durations in Ollama replies are nanoseconds. Real Ollama
  semantics win - a conversation ending in a `tool` message gets words, not the same tool
  call again (`Prompt.afterTool`).
- Slots are truly parallel: N requests on N slots take as long as one, in mock and proxy
  modes, and `tests/unit/parallel.test.ts` measures it. Never serialize request handling
  behind a shared lock, a single shared timer or a capped HTTP agent.
- Reproducible replies: every random choice goes through an `Rng`, so a seed makes the same
  prompt give the same text.
- Regex speed is the user's responsibility: a catastrophic pattern can stall the rule tester
  and the server (the README says so). Do not add a regex sandbox.
- `.env` through `config.ts` is the only source of settings; `serializeEnv` keeps variables
  it does not manage.
- The upstream API key (`upstreamKey`) stays in main and the server process. The control API
  answers with `maskKey(config)`, and `KEY_MASK` sent back means "keep the key", so a client
  that reads the config and writes it back does not erase it.
