<script lang="ts">
import type { Page } from '../lib/state.svelte.ts'
import { store } from '../lib/state.svelte.ts'

/**
 * A link to another place in the app, named as the UI names it: "Chaos › Load generator".
 * Every hint that points somewhere else uses this, so the user can see where and go there.
 */
let { page, section, path }: { page: Page; section?: string; path: string[] } = $props()
</script>

<button class="goto" onclick={() => store.goto(page, section)}>{path.join(' › ')}</button>

<style>
  .goto {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .goto:hover {
    text-decoration-thickness: 2px;
  }
  .goto:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
</style>
