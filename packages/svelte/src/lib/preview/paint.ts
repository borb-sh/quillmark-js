// The paint + scroll-virtualization loop: one <canvas> per visible-plus-margin
// page, mounted/unmounted as the container scrolls so live memory stays bounded
// (`session.paint` re-rasterizes in full every call; never pool a canvas across
// pages, per the paint contract). Builds the per-page slot elements bridge.ts
// attaches its own listeners to; owns `pageSize` caching and
// slot-count reconciliation across an `apply` (`ChangeSet.pageCount` can differ
// from the previous compile; pages can be added or removed). A ResizeObserver
// plus a DPR media-query listener repaint mounted pages when the container's CSS
// width or `devicePixelRatio` changes, so a frozen canvas never outlives the
// page box it fills.
import type { LiveSession, PageSize } from '@quillmark/wasm';

/** One page's DOM slot: the box bridge.ts measures against, plus its cached geometry. */
export interface PageSlot {
	readonly page: number;
	readonly size: PageSize;
	readonly el: HTMLElement;
}

export interface PaintLoop {
	/** Live view of the current per-page slots; same array identity for the loop's life. */
	readonly slots: readonly PageSlot[];
	/** Reconcile slot count to `pageCount`, re-cache geometry, repaint mounted `dirtyPages`. */
	refresh(dirtyPages: readonly number[], pageCount: number): void;
	/** Fold a density multiplier into every future paint; repaints mounted pages now. */
	setDensityZoom(zoom: number): void;
	destroy(): void;
}

// Vertical breathing room between stacked pages; cosmetic only, and a rung like
// any other gap: the stack breathes on the same rhythm the cards do.
const PAGE_GAP = 'var(--_qm-space-4)';

export function createPaintLoop(
	session: LiveSession,
	container: HTMLElement,
	margin: number,
	// Notified when a slot's `session.paint` throws: the loop swallows the throw
	// (see `paintSlot`) so one bad page never aborts the band sweep; the caller
	// decides how to surface it.
	onPaintError?: (page: number, err: unknown) => void
): PaintLoop {
	// The IntersectionObserver root must be a scrollable ancestor of the slots;
	// respect a consumer's own choice if they already set one (computed style, so
	// a stylesheet rule counts as a choice, not just an inline style).
	const computed = getComputedStyle(container);
	if (computed.overflowY === 'visible') container.style.overflowY = 'auto';
	if (computed.position === 'static') container.style.position = 'relative';

	const slots: PageSlot[] = [];
	const pageByEl = new Map<Element, number>();
	const canvases = new Map<number, HTMLCanvasElement>();
	const visible = new Set<number>();
	let zoom = 1;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const idx = pageByEl.get(entry.target);
				if (idx === undefined) continue;
				if (entry.isIntersecting) visible.add(idx);
				else visible.delete(idx);
			}
			updateBand();
		},
		{ root: container, threshold: 0 }
	);

	function makeSlot(page: number): PageSlot {
		const size = session.pageSize(page);
		// The sheet is a plane and the desk is the one under it: paper sits at
		// `--_qm-surface` and the container paints `--_qm-surface-sunken`, so the
		// edge is where two tones meet and no stroke is drawn around it
		// (ARCHITECTURE §Styling). It leaves the no-ink rule untouched, since a
		// boundary that is not painted is not a mark on the page (PREVIEW §"Two
		// responsibilities"). `border-box` costs nothing here and keeps a slot a
		// consumer insets from measuring wider than its paper.
		const el = document.createElement('div');
		// Not `.qm-page`: that name is the preset's page baseline, an unlayered rule at
		// ordinary specificity a host puts on `<body>`, and a slot wearing it takes that
		// rule's `color-scheme` inside a mounted root, which the derivation leaves to the
		// host (`core/theme.css`).
		el.className = 'qm-page-slot';
		// The page's index, in the DOM. `pageByEl` is this module's and a consumer
		// drawing an overlay of its own needs the number: position among siblings is
		// the only handle without it, which is right today and is not a contract.
		el.dataset.page = String(page);
		Object.assign(el.style, {
			position: 'relative',
			boxSizing: 'border-box',
			width: '100%',
			aspectRatio: `${size.widthPt} / ${size.heightPt}`,
			background: 'var(--_qm-surface)'
		});
		if (page > 0) el.style.marginTop = PAGE_GAP;
		container.appendChild(el);
		pageByEl.set(el, page);
		observer.observe(el);
		return { page, size, el };
	}

	// Rasterize `slot` into its canvas (creating the canvas if this is its first
	// paint since mounting). `layoutScale` is derived from the slot's own current
	// CSS width, so layout width tracks the container per the zoom settled
	// decision; `canvas.style.*` is then set from the authoritative PaintResult,
	// never guessed.
	function paintSlot(slot: PageSlot): void {
		let canvas = canvases.get(slot.page);
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.className = 'qm-page-canvas';
			Object.assign(canvas.style, { position: 'absolute', inset: '0', display: 'block' });
		}
		// Contextless canvas: bail before registering, so `updateBand` still sees
		// the page as unmounted and retries instead of keeping a blank page.
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		if (!canvases.has(slot.page)) {
			slot.el.insertBefore(canvas, slot.el.firstChild);
			canvases.set(slot.page, canvas);
		}
		const layoutScale = (slot.el.clientWidth || slot.size.widthPt) / slot.size.widthPt;
		const densityScale = (window.devicePixelRatio || 1) * zoom;
		try {
			const result = session.paint(ctx, slot.page, { layoutScale, densityScale });
			canvas.style.width = `${result.layoutWidth}px`;
			canvas.style.height = `${result.layoutHeight}px`;
		} catch (err) {
			// A paint that throws must not abort the band loop; `updateBand` runs in
			// the IntersectionObserver callback and sweeps every entry, so an
			// uncaught throw would strand the rest of the band unpainted. Unmount the
			// half-mounted canvas (so the page is a retryable unmounted slot, not a
			// blank registered one) and surface the failure; the sweep moves on.
			unmountPage(slot.page);
			onPaintError?.(slot.page, err);
		}
	}

	function unmountPage(page: number): void {
		const canvas = canvases.get(page);
		if (!canvas) return;
		canvas.remove();
		canvases.delete(page);
	}

	// Mount pages newly inside [min(visible)-margin, max(visible)+margin], unmount
	// pages that fell outside it. Only touches pages changing band membership;
	// an already-mounted page in the band is left alone (paint contract: an idle
	// canvas keeps its pixels for free; repainting it here would be pure waste).
	function updateBand(): Set<number> {
		const painted = new Set<number>();
		if (visible.size === 0 || slots.length === 0) return painted;
		const min = Math.min(...visible);
		const max = Math.max(...visible);
		const lo = Math.max(0, min - margin);
		const hi = Math.min(slots.length - 1, max + margin);
		for (const slot of slots) {
			const inBand = slot.page >= lo && slot.page <= hi;
			if (inBand && !canvases.has(slot.page)) {
				paintSlot(slot);
				painted.add(slot.page);
			} else if (!inBand && canvases.has(slot.page)) unmountPage(slot.page);
		}
		return painted;
	}

	// Grow/shrink the slot array to `pageCount` (trailing add/remove; a recompile
	// reports the new count, and dirtyPages already covers any reflow), then
	// re-cache every page's geometry (cheap report-only reads; simplest way to
	// stay correct across any recompile, not just a count change).
	function reconcile(pageCount: number): void {
		while (slots.length > pageCount) {
			const slot = slots.pop();
			if (!slot) break;
			observer.unobserve(slot.el);
			pageByEl.delete(slot.el);
			unmountPage(slot.page);
			visible.delete(slot.page);
			slot.el.remove();
		}
		while (slots.length < pageCount) {
			slots.push(makeSlot(slots.length));
		}
		for (let i = 0; i < slots.length; i++) {
			const size = session.pageSize(i);
			slots[i] = { ...slots[i], size };
			// Keep the page box's shape in step with the re-read size: a recompile
			// can change a page's dimensions without changing the count, and every
			// %-space click/scroll transform assumes box shape matches PageSize.
			slots[i].el.style.aspectRatio = `${size.widthPt} / ${size.heightPt}`;
		}
	}

	// Slots are built on the first `refresh` (the controller calls it immediately),
	// not here: reconcile → `session.pageSize` must run after the controller's
	// `pageCount` gate, since `pageSize` throws for a page the count excludes.

	// ── Keep mounted rasters in step with the display ───────────────────────────
	// Every paint freezes `canvas.style.width/height` to the box width at that
	// paint (paintSlot). A page that stays mounted while the container's CSS width
	// or `devicePixelRatio` shifts would otherwise keep a stale raster the %-space
	// click/scroll math silently drifts off of: the box tracks the container, the
	// ink does not. Two observers close the gap by repainting mounted pages from
	// their current box; canvases are `position:absolute`, so a repaint can't feed
	// back into layout (and thus can't re-trigger the resize observer).

	// Repaint mounted pages (all, or a given subset) from their live geometry: the
	// one path resize, DPR, and zoom share; each `paintSlot` re-reads the slot's
	// current `clientWidth`. A no-op for an unmounted page.
	function repaint(pages?: Iterable<number>): void {
		for (const page of pages ?? canvases.keys()) {
			const slot = slots[page];
			if (slot && canvases.has(page)) paintSlot(slot);
		}
	}

	// Coalesce a burst of observer callbacks into one repaint on the next frame.
	// `force` (a DPR change) bypasses the width guard, since a DPR change moves no
	// CSS-px width; a plain resize repaints only when the width actually moved, so
	// a height-only or no-op tick costs nothing.
	let rafId = 0;
	let lastWidth = container.clientWidth;
	let forcePending = false;
	function scheduleRepaint(force: boolean): void {
		if (force) forcePending = true;
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			const width = container.clientWidth;
			// A pane the shell has hidden reports a 0×0 box, which is a width to paint
			// nothing at rather than a width that moved: `paintSlot` would take its
			// `clientWidth || widthPt` fallback and freeze every mounted canvas at the 1×
			// raster. The last real width and any pending force are held instead — the
			// observer fires again when the pane has a box, and a return at that same
			// width needs no raster, the pixels being the ones it was hidden with.
			if (width === 0) return;
			const forced = forcePending;
			forcePending = false;
			if (!forced && width === lastWidth) return;
			lastWidth = width;
			repaint();
		});
	}

	// Container CSS-width changes (drag the pane wider, resize the window). Guarded
	// for jsdom, which ships no ResizeObserver; the unit suite drives no resize, so
	// skipping it there is correct; a real browser takes the observed path.
	const resizeObserver =
		typeof ResizeObserver === 'undefined'
			? undefined
			: new ResizeObserver(() => scheduleRepaint(false));
	resizeObserver?.observe(container);

	// `devicePixelRatio` changes (window dragged to a different-DPI monitor, browser
	// zoom) leave CSS-px width untouched, so the ResizeObserver never sees them;
	// watch DPR directly. A `(resolution: …dppx)` query pins the current ratio and
	// is therefore one-shot: re-arm it against the new ratio on each change. Guarded
	// for environments (jsdom) without `matchMedia`.
	let dprQuery: MediaQueryList | undefined;
	function onDprChange(): void {
		scheduleRepaint(true);
		armDprListener();
	}
	function armDprListener(): void {
		if (typeof matchMedia === 'undefined') return;
		dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		dprQuery.addEventListener('change', onDprChange, { once: true });
	}
	armDprListener();

	return {
		get slots() {
			return slots;
		},
		refresh(dirtyPages, pageCount) {
			reconcile(pageCount);
			// Slot count may have moved the band (pages added/removed); a page the
			// band just painted is already post-apply, so a second full
			// rasterization from the dirty loop would add nothing.
			const painted = updateBand();
			for (const page of dirtyPages) {
				if (painted.has(page)) continue;
				const slot = slots[page];
				if (slot && canvases.has(page)) paintSlot(slot);
			}
		},
		setDensityZoom(z) {
			zoom = z;
			repaint();
		},
		destroy() {
			if (rafId) cancelAnimationFrame(rafId);
			resizeObserver?.disconnect();
			dprQuery?.removeEventListener('change', onDprChange);
			observer.disconnect();
			for (const page of [...canvases.keys()]) unmountPage(page);
			for (const slot of slots) slot.el.remove();
			slots.length = 0;
			pageByEl.clear();
		}
	};
}
