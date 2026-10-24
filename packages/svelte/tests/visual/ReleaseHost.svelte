<!--
  A host that mounts the surface while it holds both handles and drops them from an
  effect, as one does that releases a document's handles on a store change: the
  surface unmounts inside the flush that effect runs in, its prop getters already
  answering null.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import VisualEditor from '$lib/visual/VisualEditor.svelte';
	import type { Document, Quill } from '@quillmark/wasm';

	let {
		doc: initialDoc,
		quill: initialQuill,
		released = false
	}: { doc: Document; quill: Quill; released?: boolean } = $props();

	let doc = $state<Document | null>(untrack(() => initialDoc));
	let quill = $state<Quill | null>(untrack(() => initialQuill));
	$effect(() => {
		if (!released) return;
		doc = null;
		quill = null;
	});
</script>

{#if doc && quill}
	<VisualEditor doc={doc!} quill={quill!} />
{/if}
