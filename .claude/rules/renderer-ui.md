---
paths:
  - "src/renderer/**"
---

# src/renderer - the Svelte 5 UI

The renderer is untrusted and offline: sandboxed, CSP `connect-src 'self'`. Network and files
live in main, reached only through `window.mockolla`.

- `lib/state.svelte.ts` is the single store. Server snapshots arrive every 200 ms as
  `$state.raw` - replace them, never mutate.
- Do not import `core/rules.ts` or `core/default-rules.ts` here: that would bundle every
  built-in rule. Main sends them instead. `core/config.ts` is safe (no node imports).
- Long lists draw a bounded number of rows; recordings arrive as summaries, and one full
  recording is fetched when it is shown.
- Two languages: every UI string goes through `t()` (`lib/i18n.svelte.ts`) with the key added
  to both `locales/en.ts` and `locales/ja.ts` - the typecheck enforces both. `code` and
  **bold** inside a string need `<Rich>`.
- Point to places as the UI names them, and link them: a hint about another page writes the
  path with the UI's own labels ("Chaos › Load generator" / "障害注入 › 負荷ジェネレーター").
  `<Hint>` puts `<GoTo>` links at `{a}`, `{b}` in the translated text, and
  `store.goto(page, sectionId)` opens the page, scrolls to the section and highlights it.
  Plain text such as a tooltip still writes the path: 設定 › 接続.
