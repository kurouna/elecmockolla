---
paths:
  - "src/core/default-rules.ts"
  - "src/core/earlier-defaults.ts"
  - "src/core/rules-merge.ts"
  - "tests/unit/rule-cases.ts"
  - "tests/unit/chat-rules.test.ts"
  - "tests/unit/rule-coverage.test.ts"
  - "tests/unit/upgrade.test.ts"
---

# Built-in reply rules

`default-rules.ts` gives each intent a Japanese and an English rule. Patterns read the first
line only (`^[^\n]*`, no `m` flag).

Order matters, because the first match wins: exact inputs (test words, arithmetic, simple
facts) first, then requests with the most specific first, small talk last - that is what makes
"誕生日プレゼントのおすすめ" a recommendation rather than a birthday. A captured word must be
what the reply claims it is (明日 is not a city).

Every new rule needs a sample prompt in `tests/unit/rule-cases.ts`; `rule-coverage.test.ts`
fails for a built-in rule without one or for one an earlier rule shadows. Add prompts the new
rule must NOT catch to `chat-rules.test.ts`.

Changes reach existing rules.json files through the Rules page offer (`rules-merge.ts`): a new
id is offered as new, a changed built-in rule only to files that still hold an earlier version
unedited, matched by fingerprint. So after changing a built-in rule: commit, run
`npm run gen:earlier-defaults` (it reads the git history), then commit `earlier-defaults.ts`.
`upgrade.test.ts` checks a real v0.0.1 file; add a fixture for a release whose upgrade path
matters.
