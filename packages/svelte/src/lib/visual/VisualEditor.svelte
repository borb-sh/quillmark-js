<!--
 The editor's door, and the whole of what it adds is the re-key: swapping the
 `doc` prop remounts the editor under it, so a consumer holding one mount across
 two documents gets a surface that names the live handle.

 It is a `{#key}`, not a reseed. The state a swap invalidates is not one field:
 composable cards key on session id, the main card is keyed on nothing, and each
 prose leaf mounts once per stable leaf key with `createField` closing over the
 `doc` it mounted against — so after an in-place swap the main card's leaves
 commit to the previous handle. Reseeding by hand means threading a generation
 token through every leaf key and resetting the id state, the commit-error map,
 the active address, the leaf registry, the card refs and any pending scroll,
 which is a remount spelled out one field at a time. This spells it as one.

 Teardown order is the one `core/teardown.ts` states: the outgoing mount
 unregisters, cancels its pending ticks, and only then releases, so a continuation
 awaiting a flush across the swap runs against nothing.

 `quill` is not part of the key: the schema is re-read on every derive, so a quill
 swap re-projects correctly on its own, and keying on it would throw away a card
 tree that did not need rebuilding. What it cannot do is re-mount the leaves, so a
 quill swapped without a doc swap reports `rebind-ignored` rather than passing
 silently.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { reportRebindIgnored } from '../core/rebind.svelte.js';
	import type { DocPath, Landing } from '../core/address.js';
	import type { Delta } from '@quillmark/wasm';
	import type { AnchorPos } from '../core/codec/index.js';
	import type { CardId, CardOp } from './signals.js';
	import type { VisualEditorProps } from './props.js';
	import { CommentSeat } from './comments.svelte.js';
	import VisualEditorInner from './VisualEditorInner.svelte';

	let props: VisualEditorProps = $props();

	// The seat outlives the re-key: a panel mounted over it keeps its threads and its active
	// id across a document swap, and the incoming mount binds fresh verbs onto it.
	const seat = new CommentSeat();

	let inner = $state<VisualEditorInner | undefined>();

	// The pair the current mount bound to. Re-read on each re-key rather than held
	// from the first mount: after a doc swap the incoming mount binds whatever quill
	// came with it, and comparing against the original would report a pairing that
	// is correct.
	let boundDoc: unknown = undefined;
	let boundQuill: unknown = undefined;
	let reported = false;
	$effect(() => {
		const { doc, quill } = props;
		untrack(() => {
			// A doc swap re-keys, and the new mount binds this quill: nothing is stale.
			if (doc !== boundDoc) {
				boundDoc = doc;
				boundQuill = quill;
				reported = false;
				return;
			}
			if (quill === boundQuill || reported) return;
			reported = true;
			reportRebindIgnored(
				props.onError,
				'quill swapped in place; the mounted leaves still commit against the quill this doc mounted with. Swap the doc with it, or remount the editor, to rebind.'
			);
		});
	});

	// The instance surface, every member a pass-through to the live mount: a call
	// landing between a swap and the incoming mount is a no-op rather than a throw,
	// which is what lets a host hold one `bind:this` across two documents.

	/** Land a preview pick: a caret where the payload carries one and the leaf can
	 *  spend it, an array element where the address names one, a focus otherwise. */
	export async function setCaret(at: Landing): Promise<void> {
		await inner?.setCaret(at);
	}
	/** Reveal and focus the field at `field` — any mounted one — without placing a
	 *  caret inside it. */
	export async function focusField(field: DocPath): Promise<void> {
		await inner?.focusField(field);
	}
	/** Wash the field at `field` where it is on show, without focusing or revealing it. */
	export function washField(field: DocPath): void {
		inner?.washField(field);
	}
	/** Seed a card of `kind` at `at` (default: the end); the new card's session key. */
	export function insertCard(kind: string, at?: number): CardId | undefined {
		return inner?.insertCard(kind, at);
	}
	export function removeCard(cardId: CardId): void {
		inner?.removeCard(cardId);
	}
	/** Move a card one slot; at either edge it is a no-op. */
	export function moveCard(cardId: CardId, dir: -1 | 1): void {
		inner?.moveCard(cardId, dir);
	}
	export function setKind(cardId: CardId, kind: string): void {
		inner?.setKind(cardId, kind);
	}
	/** Re-read the prose leaf at `field` after the host changed it in the document, as one
	 *  step outside its undo history; `delta` carries the caret. */
	export function applyExternal(field: DocPath, delta?: Delta): void {
		inner?.applyExternal(field, delta);
	}
	/** Re-read the cards' kinds, titles and form fields after the host changed them. */
	export function refresh(): void {
		inner?.refresh();
	}
	/** Move the card keys in step with card-list changes the host made in the document. */
	export function applyCardOps(ops: readonly CardOp[]): void {
		inner?.applyCardOps(ops);
	}
	/** The seat a `CommentPanel` mounts over: the index mirror, the active thread, the draft
	 *  and the verbs. One per editor, held across document swaps. */
	export function commentSeat(): CommentSeat {
		return seat;
	}
	/** Place an anchor over the active leaf's selection and open a draft on it, as the
	 *  popover's comment button does; false where no leaf could take it. */
	export function startComment(): boolean {
		return inner?.startComment() ?? false;
	}
	/** Select the thread's anchor and reveal the leaf holding it. */
	export async function focusThread(id: string): Promise<void> {
		await inner?.focusThread(id);
	}
	/** Place the thread's anchor over the active leaf's selection; false where none could. */
	export async function reanchorThread(id: string): Promise<boolean> {
		return (await inner?.reanchorThread(id)) ?? false;
	}
	/** Drop the thread and its anchor. */
	export async function removeThread(id: string): Promise<void> {
		await inner?.removeThread(id);
	}
	/** Every anchor the mounted leaves hold, with the path of the leaf holding it. */
	export function anchorRanges(): (AnchorPos & { field: DocPath })[] {
		return inner?.anchorRanges() ?? [];
	}
</script>

{#key props.doc}
	<VisualEditorInner bind:this={inner} {...props} commentSeat={seat} />
{/key}
