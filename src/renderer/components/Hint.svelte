<script lang="ts">
import type { Page } from '../lib/state.svelte.ts'
import GoTo from './GoTo.svelte'

/**
 * A translated sentence with links in it: "{a}" and "{b}" in the text become GoTo links,
 * so each language can put them where its word order wants them.
 */
type Link = { page: Page; section?: string; path: string[] }
let { text, links }: { text: string; links: Record<string, Link> } = $props()

const parts = $derived(text.split(/(\{[a-z]\})/))
</script>

{#each parts as part, i (i)}{#if /^\{[a-z]\}$/.test(part) && links[part.slice(1, -1)]}{@const l = links[part.slice(1, -1)]}{#if l}<GoTo page={l.page} path={l.path} {...l.section ? { section: l.section } : {}} />{/if}{:else}{part}{/if}{/each}
