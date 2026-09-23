<script lang="ts">
/** Translated text with `code` and **bold** spans, rendered without {@html}. */
let { text }: { text: string } = $props()

const parts = $derived(
  text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((s) =>
      s.startsWith('`') && s.endsWith('`') && s.length > 1
        ? { kind: 'code', s: s.slice(1, -1) }
        : s.startsWith('**') && s.endsWith('**') && s.length > 3
          ? { kind: 'b', s: s.slice(2, -2) }
          : { kind: 'text', s },
    ),
)
</script>

{#each parts as p, i (i)}{#if p.kind === 'code'}<code>{p.s}</code>{:else if p.kind === 'b'}<b>{p.s}</b>{:else}{p.s}{/if}{/each}

<style>
  code {
    user-select: text;
  }
</style>
