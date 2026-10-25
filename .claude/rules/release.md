---
paths:
  - "package.json"
  - "README.md"
  - ".github/**"
  - "scripts/**"
---

# Releasing, dependencies and screenshots

Release: `npm version X.Y.Z --no-git-tag-version`, update the version note at the top of the
README, commit, push, wait for CI to pass, then tag `vX.Y.Z` and push the tag. `release.yml`
checks the tag against package.json, runs verify, and creates a pre-release (unsigned-build
notes in English and Japanese, then the generated changes) with every build; a person promotes
it to a full release. `ci.yml` runs lint, typecheck, unit + e2e on Windows/macOS/Linux, and
package.

Dependencies: `npx npm-check-updates`, then `npm install` and `npm update`. Held back on
purpose: vite 8 and @sveltejs/vite-plugin-svelte 7 (electron-vite 5 supports vite up to 7),
TypeScript 7 (svelte-check supports up to 6), @types/node above 24 (Electron 44 runs Node 24).
Close any running copy of the app first, or Windows keeps Electron's files locked (EBUSY).

README screenshots come from `npm run screenshots` after a build - a docs tool, not a user
feature. Screenshot mode hides the settings folder path and types `hello` into the rule tester.
`npm run gen:icon` turns `build/icon.svg` into `build/icon.png` and `resources/icons/icon.png`.
