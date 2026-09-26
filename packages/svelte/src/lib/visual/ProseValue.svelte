<!--
 A prose leaf the parent commits by value: an element of a `richtext` (fixture
 `keywords`) or `plaintext` (`errata`) array, and a content cell of a subform — an
 `object`'s property, a variant's cell ({@link ObjectField}). None of them is
 `applyChange`-addressable: `Addr.field` is a flat name, so `keywords[0]` and
 `contact.note` have no op address. So this is not a `createField` leaf: it mounts a
 minimal PM view over the codec's decode/encode and a leaf schema, and on every edit
 hands the re-encoded `Content` up to the parent — {@link ArrayField}, which commits
 the whole array, or {@link ObjectField}, which commits the whole container
 (`writer.set(field, next)`). Anchors inside a value are dropped on that write.
 Mounts once per stable key (an element's session id, a property's name), so the
 parent's re-derive leaves the caret where it is.

 The content is read, not passed: `reader.getContentAt(addr, path)` decodes through
 the codec the leaf's own declared type names, so what it rests as — the content
 object, a `plaintext` literal, the authored string a transport door left — stops
 being the row's or the cell's business. Read once, at mount, since that is when this
 leaf takes its state.

 The schema is the declared type's where the parent has room for it: a subform cell
 declaring no `inline` takes the full row ({@link ObjectField}), a `richtext` one on the
 block schema and a `plaintext` one on the plain schema, paragraphs and hard breaks.
 An array element is one textblock whatever it declares, since Enter there is the
 repeater's. There is no slash menu at either width, and an island draws as its
 placeholder: an atom a keystroke can delete and no view edits.

 A leaf over content its schema cannot hold is held: a narrowed one over anything but
 one plain paragraph (`fitsInline`), a plain one over anything but plain lines
 (`fitsPlain`). Its decode would join or drop what is left over, and the first
 keystroke would write that loss back, so a held leaf draws its content on the block
 schema, read-only, with a note inside its box, and commits nothing.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorState, Selection } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import {
		blockSchema,
		decode,
		fitsInline,
		fitsPlain,
		leafSchema,
		pmToContent,
		proseAttributes,
		proseLeafPlugins,
		buildLineIndex,
		usvToPM
	} from '../core/codec/index.js';
	import { wording } from './strings.js';
	import './controls.css';
	import type { Content } from '@quillmark/wasm';

	interface Props {
		/** This leaf's content, read at mount (the parent's boundary read). A thunk
		 * rather than a value: the parent re-derives per revision and this leaf takes
		 * its state once, so a value prop would be a boundary read per leaf per render,
		 * all but one of them discarded. */
		content: () => Content;
		/** The mark-free schema (a `plaintext` leaf): literal text, no formatting,
		 * exactly as the scalar field of that type mounts. */
		plaintext?: boolean;
		/** A multi-block schema, for a cell the parent draws at full width: the block
		 * schema, or the plain one with `plaintext`. Absent, the leaf is one textblock. */
		block?: boolean;
		/** Accessible name for the editable region, where nothing else names it: an
		 * array has no per-element label. A cell with a label element takes
		 * `labelledBy`. */
		label?: string;
		/** The label's own id → `aria-labelledby`. `for` cannot reach a
		 * `contenteditable`, so a subform cell's label associates the other way and
		 * hands its click back through {@link focus}. */
		labelledBy?: string;
		/** The parked `description` (FieldLabel) → `aria-describedby`. */
		describedBy?: string;
		/** The empty leaf's ghosts, a subform cell's: what it prints unset, until the
		 *  leaf's first edit, and the `example:` drawn in its stead while the leaf holds
		 *  the focus (`createField`'s pair). Read per decoration pass. */
		placeholder?: string;
		example?: string;
		onChange: (rt: Content) => void;
		/** Raw keydown, for a container whose own keys run through this leaf: the
		 * array repeater's Enter/Backspace (`ArrayField`). Fires before the view's own
		 * keymap, so the state it reads is the one this keystroke has yet to change. */
		onKey?: (e: KeyboardEvent) => void;
	}
	let {
		content,
		plaintext = false,
		block = false,
		label,
		labelledBy,
		describedBy,
		placeholder,
		example,
		onChange,
		onKey
	}: Props = $props();

	const t = wording();
	const uid = $props.id();
	const heldId = `${uid}-held`;
	let editorEl: HTMLDivElement | undefined = $state();
	let held = $state(false);
	let view: EditorView | undefined;
	/** Take the caret: what a parent placing focus on this leaf calls. The view's
	 * focus, not the element's: a PM view restores its selection, where a bare DOM
	 * focus on a contenteditable leaves the caret unplaced. And the reveal beside it,
	 * since PM's focus prevents the scroll a `string` element's input takes by
	 * default — an array whose two item types revealed differently is one row of it
	 * landing off screen. */
	export function focus(): void {
		if (!view) return;
		view.focus();
		view.dom.scrollIntoView({ block: 'nearest' });
	}
	/** Take the caret to USV `pos` in this leaf's own content: what a landing on an
	 * element address resolves to when the compile answered a cluster-exact offset
	 * (`leaves.ts`). `createField`'s body over the view this component owns.
	 *
	 * The index is built here rather than held: a landing is a discrete act, and one
	 * doc walk per click is cheaper than a cache to invalidate per keystroke. `usvToPM`
	 * clamps, so an offset past a value the compile has moved on from lands the end.
	 *
	 * `Selection.near`, not `TextSelection.create`: the mapped position can be
	 * non-inline. Focus first, then the caret, flagged for scroll — the order and the
	 * reasons are `FieldController.setCaret`'s (`codec/field.ts`). */
	export function setCaret(pos: number): void {
		if (!view) return;
		const pm = usvToPM(buildLineIndex(view.state.doc), pos);
		const sel = Selection.near(view.state.doc.resolve(pm));
		view.focus();
		view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
	}

	onMount(() => {
		if (!editorEl) return;
		// The same keymap and plugin stack a `createField` leaf mounts (shared
		// `proseLeafPlugins`), minus the anchor-position plugin: anchors are dropped on
		// the parent's value write, per the header.
		const inline = !block;
		const rt = content();
		held = inline ? !fitsInline(rt) : plaintext && !fitsPlain(rt);
		const schema = held ? blockSchema : leafSchema({ plaintext, inline });
		const state = EditorState.create({
			doc: decode(rt, schema),
			plugins: held
				? []
				: proseLeafPlugins(schema, {
						inline,
						placeholder: () => placeholder,
						placeholderUntilEdit: true,
						example: () => example
					})
		});
		const attributes = proseAttributes({
			label,
			labelledBy,
			describedBy: [describedBy, held ? heldId : undefined].filter(Boolean).join(' ') || undefined
		});
		const mounted = new EditorView(
			{ mount: editorEl },
			{
				state,
				editable: () => !held,
				// Which of `aria-label` / `aria-labelledby` wins is the codec's one answer
				// (`proseAttributes`), so a cell carrying a label element and a row carrying
				// none cannot name their regions by different rules. A non-editable view is
				// no textbox to assistive tech or to Tab, so a held leaf states both itself.
				attributes: held
					? {
							...attributes,
							role: 'textbox',
							'aria-readonly': 'true',
							'aria-multiline': 'true',
							tabindex: '0'
						}
					: attributes,
				dispatchTransaction(tr) {
					const next = mounted.state.apply(tr);
					mounted.updateState(next);
					if (tr.docChanged && !held) onChange(pmToContent(next.doc));
				},
				handleDOMEvents: {
					keydown: (_v, e) => {
						onKey?.(e);
						return false;
					}
				}
			}
		);
		view = mounted;
		return () => {
			view = undefined;
			mounted.destroy();
		};
	});
</script>

<!-- `.qm-control-box` (controls.css) is the whole box, so an array of `richtext` and
 an array of `string` render rows of equal height, and a subform's prose cell measures
 like the text cell beside it. No floor: the reset in `core/codec/prose.css` makes one
 line of prose measure one line. Width is the row's or the cell's to give: the leaf
 fills the track it is placed in. -->
<div class="qm-prose-value qm-control-box qm-focus-ring-within">
	<div bind:this={editorEl}></div>
	<!-- Inside the box, so the cell or row holds one child either way: a subform cell's
	     subgrid has a row for the label and one for the box, and an array row's slabs
	     stand the box's height. -->
	{#if held}
		<span id={heldId} class="qm-prose-held-note">{t.strings.proseHeld}</span>
	{/if}
</div>

<style>
	/* Caret-primary, matching ProseField: the contenteditable's own outline is
	   dropped and the ring rides the wrapper (`qm-focus-ring-within`,
	   controls.css), which is where the box is. */
	.qm-prose-value :global(.ProseMirror) {
		outline: none;
	}
	.qm-prose-held-note {
		display: block;
		font-size: var(--_qm-text-label);
		color: var(--_qm-ink-label);
	}
</style>
