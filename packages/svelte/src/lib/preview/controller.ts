// `createPreview` wires paint.ts + bridge.ts over one `LiveSession` and
// `opts.container`, and is the only thing that composes them: the paint loop
// owns the page slots; the bridge attaches its own listeners to those same
// slots. A pure view: never calls `session.apply`, never mutates the session;
// the consumer drives edits and hands the resulting `ChangeSet` to `refresh`.
import type { LiveSession, ChangeSet } from '@quillmark/wasm';
import type { DocPath, Landing, Place } from '../core/address.js';
import { reportError, errorMessage, type EditorErrorHandler } from '../core/errors.js';
import { createPaintLoop, type PaintLoop } from './paint.js';
import { createBridge, type BridgeController, type HeldTrip } from './bridge.js';
import { mergePreviewStrings, type PreviewStringsInput } from './strings.js';

export interface PreviewOptions {
	/** The element the preview mounts into; becomes the scroll viewport. */
	container: HTMLElement;
	/** Pages kept painted beyond the visible band. Default 1. */
	margin?: number;
	/** A click resolved to an address ({@link Landing}): a caret where the compile
	 *  tracks the content under the point, the field alone where it tracks only the
	 *  placement. The hook does not fire where the compile tracks neither. */
	onPick?(at: Landing): void;
	/** A page paint the backend refused ({@link EditorErrorHandler}). The preview
	 *  shows its error message state either way; this routes it to an app's sink. */
	onError?: EditorErrorHandler;
	/** The three message-state strings, keyed and partial: unset keys take the
	 *  package's English. */
	strings?: PreviewStringsInput;
}

export interface PreviewController {
	/** Repaint `dirtyPages ∩ visible` and re-locate the followed caret; the only
	 *  apply-driven hop. */
	refresh(change: ChangeSet): void;
	/**
	 * Scroll `field`'s first box into view, and end any follow it outranks. `false`
	 * when this compile places nothing at that address — an answer, not a failure: the
	 * plate places plenty it does not track, and the preview carries no schema to tell
	 * that from a field the host misnamed. The editor's `focusField` is what
	 * distinguishes them.
	 */
	scrollToField(field: DocPath): boolean;
	/**
	 * Bring the caret at `at` into view: the pane moves only when the caret has left
	 * the fold.
	 *
	 * Takes the editor's own `onCaretMove` payload, so the editor→preview half of
	 * the bridge is `onCaretMove={preview.focusPosition}` and translates nothing. A
	 * `ContentHit` carries both members and fits here too.
	 */
	focusPosition(at: Place): void;
	/**
	 * End the follow: the pane stays where the user left it until the next
	 * `focusPosition`. A `scrollToField` that placed its target ends one too.
	 *
	 * The editor's `onActiveLeafChange` is the signal, firing for a form control as for
	 * a prose leaf: `onActiveLeafChange={preview.endFollow}`. A control has no caret
	 * coordinate to report, so unwired the follow keeps naming the leaf the focus left
	 * and every recompile pulls the pane back there. A prose leaf restarts it with its
	 * own next caret.
	 */
	endFollow(): void;
	/** Fold a density multiplier into every future paint (crispness, not layout). */
	setZoom(scale: number): void;
	destroy(): void;
}

const CONTAINER_CLASS = 'qm-preview';
// The message states share one element; each carries `MESSAGE_CLASS` plus a state
// class, the hooks a consumer and the tests target.
const MESSAGE_CLASS = 'qm-preview-message';
const EMPTY_CLASS = 'qm-preview-empty';
const UNSUPPORTED_CLASS = 'qm-preview-unsupported';
const ERROR_CLASS = 'qm-preview-error';

export function createPreview(session: LiveSession, opts: PreviewOptions): PreviewController {
	const container = opts.container;
	const margin = opts.margin ?? 1;
	const t = mergePreviewStrings(opts.strings);
	container.classList.add(CONTAINER_CLASS);

	// One element, restamped: the non-paint states (empty, unsupported, a paint that
	// threw) are mutually exclusive.
	let message: HTMLElement | undefined;
	function showMessage(text: string, state: string): void {
		if (!message) {
			message = document.createElement('div');
			container.appendChild(message);
		}
		message.className = `${MESSAGE_CLASS} ${state}`;
		message.textContent = text;
	}
	function hideMessage(): void {
		message?.remove();
		message = undefined;
	}

	// The paint loop is safe at any page count: zero pages reconciles to zero
	// slots and never calls the `paint`/`pageSize` verbs the boundary refuses
	// there. A paint that unexpectedly throws is caught per-slot and surfaced
	// through the shared message rather than aborting the observer callback
	// mid-sweep.
	const paintLoop: PaintLoop = createPaintLoop(session, container, margin, (page, err) => {
		reportError(opts.onError, {
			code: 'paint-failed',
			severity: 'error',
			message: `painting page ${page} failed: ${errorMessage(err)}`,
			cause: err,
			page
		});
		showMessage(t.renderFailed, ERROR_CLASS);
	});
	// The bridge lives and dies with the slot set, so it is held until `render` finds
	// a compile paintable. Rebuilt rather than patched whenever the count changes: the
	// slots array is a stable identity but its members are swapped on reconcile, and
	// the listeners are per slot.
	let bridge: BridgeController | undefined;
	// Outlives that rebuild, so a trip held for a pane with no box crosses it. Only the
	// follow is re-asserted after a recompile, and a `scrollToField` the pane could not
	// run has nothing else that would ask again for it.
	const held: HeldTrip = {};

	function attach(): void {
		bridge = createBridge(session, container, paintLoop.slots, opts.onPick, held);
	}
	function detach(): void {
		bridge?.destroy();
		bridge = undefined;
	}

	/** Whether page 0 paints. There is no capability left to probe — a session paints
	 *  by construction, and `pageSize` refuses only a page the compile does not have —
	 *  so this asks the compile in hand rather than the backend, and the throw is what
	 *  it answers with. Kept over a bare `pageCount > 0` because the refusal is the
	 *  whole contract now: a compile that counts pages it cannot size states so here
	 *  rather than at the first slot's paint. */
	function paints(): boolean {
		try {
			session.pageSize(0);
			return true;
		} catch {
			return false;
		}
	}

	// Called at construction and after every `apply`, so the answer is re-read per
	// compile and a 0-page compile that later gains paintable pages recovers.
	function render(pageCount: number, dirtyPages: readonly number[]): void {
		if (pageCount === 0 || !paints()) {
			// A 0-page compile is a recoverable empty; pages the boundary cannot
			// raster are a genuine unsupported.
			paintLoop.refresh([], 0);
			detach();
			showMessage(
				pageCount === 0 ? t.noPages : t.unsupported,
				pageCount === 0 ? EMPTY_CLASS : UNSUPPORTED_CLASS
			);
			return;
		}
		// Read the count against the current slots before reconcile moves it, and
		// clear any prior message before painting so a paint that throws mid-refresh
		// leaves its error surfaced rather than have `hideMessage` clobber it.
		const countChanged = pageCount !== paintLoop.slots.length;
		hideMessage();
		paintLoop.refresh(dirtyPages, pageCount);
		// The slot set moved under the bridge's feet, or we are leaving a message state.
		if (countChanged || !bridge) {
			detach();
			attach();
		}
	}

	render(session.pageCount, []);

	// The last place the editor put the caret, re-located after every recompile and
	// dropped on a focus change or a discrete hop. `session.locate` answers against the
	// last compiled layout and a consumer debounces `update`, so a caret typed past that
	// layout's content is off-content for the whole burst: `focusPosition` no-ops and
	// the pane sits still, and a caret event is otherwise the only thing that asks
	// again. The re-locate is the preview's, not the consumer's: the staleness sits
	// between two session queries this module owns both ends of.
	let followed: Place | undefined;

	return {
		refresh(change) {
			render(change.pageCount, change.dirtyPages);
			// Guarded like any other caret hop, so a caret already clear of the fold
			// leaves a pane the user scrolled where they left it.
			if (followed) bridge?.focusPosition(followed.field, followed.pos);
		},
		scrollToField(field) {
			const placed = bridge?.scrollToField(field) ?? false;
			// The discrete hop outranks the follow: a caret re-asserted at the next
			// recompile would pull the pane straight off the field a host just asked
			// for. A hop that placed nothing moved nothing, so the follow stands.
			if (placed) followed = undefined;
			return placed;
		},
		focusPosition(at) {
			followed = at;
			bridge?.focusPosition(at.field, at.pos);
		},
		endFollow() {
			followed = undefined;
		},
		setZoom(scale) {
			paintLoop.setDensityZoom(scale);
		},
		destroy() {
			detach();
			paintLoop.destroy();
			hideMessage();
			container.classList.remove(CONTAINER_CLASS);
		}
	};
}
