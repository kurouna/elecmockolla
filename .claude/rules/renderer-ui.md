---
paths:
  - "src/renderer/**"
---

# src/renderer - the Svelte 5 UI

Sandboxed, with CSP `connect-src 'self'`: everything outside the page goes through
`window.mockolla`. Paths below are relative to `src/renderer`.

- `lib/state.svelte.ts` is the single store. Server snapshots arrive every 200 ms as
  `$state.raw` - replace them, never mutate.
- Of `src/core`, import only `config.ts` and `rules-merge.ts`: neither touches Node or holds
  rule text. `core/rules.ts` or `core/default-rules.ts` would bundle every built-in rule, so
  main sends those instead.
- Long lists draw a bounded number of rows; recordings arrive as summaries, and one full
  recording is fetched when it is shown.
- Leaving a page with unsaved edits: the page sets `store.leaveGuard`, and the shell
  (`App.svelte`) asks in its own dialog. Not `window.confirm`: Chromium can suppress repeated
  dialogs, and the click would then do nothing with no reason on screen. An action the app
  refuses always says why. (Deleting all recordings in `components/Recordings.svelte` still
  uses `confirm`; there a suppressed dialog only cancels the deletion.)
- Whether a draft differs from what main stored is `sameData` (`lib/equal.ts`), not
  `JSON.stringify`: key order and an absent-versus-undefined field are not edits.
- `t()` is in `lib/i18n.svelte.ts`; each key goes in both `lib/locales/en.ts` and
  `lib/locales/ja.ts`, and the typecheck enforces both. `code` and **bold** inside a string
  need `<Rich>`.
- Point to places as the UI names them, and link them: a hint about another page writes the
  path with the UI's own labels ("Chaos › Load generator" / "障害注入 › 負荷ジェネレーター").
  `<Hint>` puts `<GoTo>` links at `{a}`, `{b}` in the translated text, and
  `store.goto(page, sectionId)` opens the page, scrolls to the section and highlights it.
  Plain text such as a tooltip still writes the path: 設定 › 接続.
