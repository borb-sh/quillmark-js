// The leaf registry: what a landing verb resolves a `DocPath` to, and the seam the
// mounted tree registers itself into (VISUAL_EDITOR §"Focus and the preview bridge").
//
// Two lanes behind one lookup. Every mounted field registers a {@link FieldControl} —
// take the caret, and a box to bloom — which is the whole of what a reveal and a
// focus need, and the whole of what a form control has. A prose leaf registers its
// `FieldController` instead: a superset, carrying the codec seam (a caret at a USV
// offset, the formatting popover's observation) that no `<input>` answers. So
// `control` covers every field and `prose` covers the leaves that have one, and the
// verbs ask for the half they use: `focusField` never needs the codec, and
// `getActiveLeaf` returns nothing for a focused text input rather than raising a
// formatting toolbar over one.
//
// A registry rather than a DOM query, for the reason `Card.revealLeaf` is a call: a
// control's focus is its own (a PM view restores a selection, a date field lands on
// its first segment, an array lands on its first element or its add affordance), so
// the surface holds the answers it already gives a label click instead of re-deriving
// them from markup.
import type { PathStep } from '@quillmark/wasm';
import type { FieldController } from '../core/codec/index.js';

/**
 * A mounted field's landing handle: focus it, and the element the arrival wash blooms
 * inside ({@link import('../core/bloom.js').bloomInside}).
 *
 * A `FieldController` is one, which is what lets the two lanes share a lookup; `Field`
 * builds the same shape over a form control off the handoff a label click already
 * takes, so `focusField` and a label cannot land in different places.
 */
export interface FieldControl {
	focus(): void;
	/**
	 * Land at `path` inside a control that holds one — an element index, a property key,
	 * a variant's cell, a matrix member, and the same again at every rung below — at USV
	 * `pos` where the leaf it reaches can take one. Absent on every control with nothing
	 * inside it.
	 *
	 * Each container consumes its own first step and hands the rest down, resolving an
	 * index to its element's session id at the call; a step the live value no longer
	 * reaches falls back to {@link focus} at that rung. The place rides the call because
	 * the registry stays parent-keyed: a per-element key is positional, in a registry
	 * whose doctrine is dodging positional churn.
	 *
	 * A landing, not a focus: an absent `pos` is the placement rung, exactly as on
	 * `Landing`, and what a `pos` means is the reached control's, the same way focusing
	 * is.
	 *
	 * Returns the box the innermost rung settled in, which is what the wash blooms: the
	 * address named one row, and a wash over the repeater around it says the field where
	 * the click said the row. `undefined` is a rung that fell back, and reads as
	 * {@link el}.
	 */
	focusPath?(path: PathStep[], pos?: number): HTMLElement | undefined;
	readonly el: HTMLElement;
}

/**
 * The registry the editor holds and the mounted tree writes into.
 *
 * A lane is dropped by its own owner, which is what the symmetric pairs are for: a
 * card retyped to a kind that declares the same field name at another type swaps the
 * control under one leaf key without remounting `Field`, so the leaving control and
 * the arriving prose leaf both touch that key with no order between them to rely on.
 */
export interface LeafRegistry {
	/** A prose leaf, by its controller: the landing handle and the codec seam at once. */
	registerProse(key: string, controller: FieldController): void;
	unregisterProse(key: string): void;
	/** A form control: the landing lane only, having no codec half to offer. */
	registerControl(key: string, control: FieldControl): void;
	unregisterControl(key: string): void;
	/** The landing handle at `key`, whichever lane holds it. */
	control(key: string): FieldControl | undefined;
	/** The codec seam at `key`, `undefined` for a form control. */
	prose(key: string): FieldController | undefined;
	/** Drop everything: the surface going away as a whole, where a leaf's cleanup
	 *  order relative to the parent's is Svelte's business. */
	clear(): void;
}

export function createLeafRegistry(): LeafRegistry {
	const controls = new Map<string, FieldControl>();
	const proses = new Map<string, FieldController>();
	return {
		registerProse(key, controller) {
			proses.set(key, controller);
		},
		unregisterProse(key) {
			proses.delete(key);
		},
		registerControl(key, control) {
			controls.set(key, control);
		},
		unregisterControl(key) {
			controls.delete(key);
		},
		// The prose map is read second: a controller is a control, so a leaf answers a
		// landing without a second entry, and a key the two lanes overlap on during a
		// retype resolves to the form control the tree is currently rendering.
		control(key) {
			return controls.get(key) ?? proses.get(key);
		},
		prose(key) {
			return proses.get(key);
		},
		clear() {
			controls.clear();
			proses.clear();
		}
	};
}
