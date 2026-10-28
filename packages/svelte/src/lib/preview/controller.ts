// `createPreview` composes paint.ts, bridge.ts and viewport.ts over one `LiveSession`. A pure view:
// it never calls `session.apply`; the consumer hands the resulting `ChangeSet` to `refresh`.
import type { LiveSession, ChangeSet } from '@quillmark/wasm';
import type { DocPath, Landing, Place } from '../core/address.js';
import { reportError, errorMessage, type EditorErrorHandler } from '../core/errors.js';
import { createPaintLoop, type PaintLoop } from './paint.js';
import { createBridge, type BridgeController, type HeldTrip } from './bridge.js';
import { createViewport } from './viewport.js';
import { mergePreviewStrings, type PreviewStringsInput } from './strings.js';

export interface PreviewOptions {
	/** The element the preview mounts into; becomes the scroll viewport. */
	container: HTMLElement;
	/** Pages kept painted beyond the visible band. Default 1. */
	margin?: number;
	/**
	 * A click resolved to an address ({@link Landing}): a caret where the compile tracks the
	 * content under the point, the field alone where it tracks only the placement. Does not fire
	 * where it tracks neither.
	 */
	onPick?(at: Landing): void;
	/**
	 * A page paint the backend refused ({@link EditorErrorHandler}); the error message state shows
	 * either way.
	 */
	onError?: EditorErrorHandler;
	/** The surface's strings; unset keys take the package's English. */
	strings?: PreviewStringsInput;
}

export interface PreviewController {
	/** Repaint `dirtyPages ∩ visible` and re-locate the followed caret; the only
	 *  apply-driven hop. */
	refresh(change: ChangeSet): void;
	/**
	 * Scroll `field`'s first box into view, and end any follow it outranks. `false` when this
	 * compile places nothing at that address; the preview has no schema to tell that from a
	 * misnamed field.
	 */
	scrollToField(field: DocPath): boolean;
	/**
	 * Bring the caret at `at` into view; the pane moves only when the caret has left the fold.
	 * Takes the editor's `onCaretMove` payload, so `onCaretMove={preview.focusPosition}` wires it.
	 */
	focusPosition(at: Place): void;
	/**
	 * End the follow: the pane stays where the user left it until the next `focusPosition`. Wire
	 * `onActiveLeafChange={preview.endFollow}`; a form control reports no caret, so unwired the
	 * follow keeps pulling the pane back to the leaf the focus left.
	 */
	endFollow(): void;
	/**
	 * Draw every page at `zoom`, a fraction of actual size (`1` is 100%), held between the pane's
	 * floor and 200%; `undefined` is the default, the widest page fitting the pane's width up to
	 * 125%.
	 */
	setZoom(zoom: number | undefined): void;
	destroy(): void;
}

const CONTAINER_CLASS = 'qm-preview';
const MESSAGE_CLASS = 'qm-preview-message';
const EMPTY_CLASS = 'qm-preview-empty';
const ERROR_CLASS = 'qm-preview-error';

export function createPreview(session: LiveSession, opts: PreviewOptions): PreviewController {
	const container = opts.container;
	const margin = opts.margin ?? 1;
	const t = mergePreviewStrings(opts.strings);
	container.classList.add(CONTAINER_CLASS);

	// One element, restamped: the message states are mutually exclusive.
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

	// A paint that throws is caught per slot and surfaced through the message rather than aborting
	// the observer callback mid-sweep.
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
	// Rebuilt whenever the page count changes: the listeners are per slot and slots are swapped on
	// reconcile.
	let bridge: BridgeController | undefined;
	// Outlives the bridge rebuild, so a trip held for a pane with no box crosses it.
	const held: HeldTrip = {};

	function attach(): void {
		bridge = createBridge(session, container, paintLoop.slots, opts.onPick, held);
	}
	function detach(): void {
		bridge?.destroy();
		bridge = undefined;
	}

	function render(pageCount: number, dirtyPages: readonly number[]): void {
		if (pageCount === 0) {
			paintLoop.refresh([], 0);
			detach();
			showMessage(t.noPages, EMPTY_CLASS);
			return;
		}
		// Clear the message before painting so an error from this paint is not clobbered.
		const countChanged = pageCount !== paintLoop.slots.length;
		hideMessage();
		paintLoop.refresh(dirtyPages, pageCount);
		if (countChanged || !bridge) {
			detach();
			attach();
		}
	}

	// Built before the first bridge so its ResizeObserver fires first: a re-shown pane re-fits
	// before the bridge runs a held trip.
	const viewport = createViewport(container, paintLoop.slots, paintLoop.setScale, t.resetZoom);
	render(session.pageCount, []);
	viewport.update();

	// The last caret the editor reported, re-located after every recompile: `session.locate`
	// answers against the last compiled layout, so a caret typed past it no-ops until the recompile
	// lands.
	let followed: Place | undefined;

	return {
		refresh(change) {
			render(change.pageCount, change.dirtyPages);
			viewport.update();
			if (followed) bridge?.focusPosition(followed.field, followed.pos);
		},
		scrollToField(field) {
			const placed = bridge?.scrollToField(field) ?? false;
			// The hop outranks the follow, which would otherwise pull the pane back at the next
			// recompile.
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
		setZoom(zoom) {
			viewport.setZoom(zoom);
		},
		destroy() {
			detach();
			viewport.destroy();
			paintLoop.destroy();
			hideMessage();
			container.classList.remove(CONTAINER_CLASS);
		}
	};
}
