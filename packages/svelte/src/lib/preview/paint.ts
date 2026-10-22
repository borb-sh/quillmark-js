// The paint + scroll-virtualization loop: one <canvas> per visible-plus-margin
// page, mounted/unmounted as the container scrolls so live memory stays bounded
// (`session.paint` re-rasterizes in full every call; never pool a canvas across
// pages, per the paint contract). Builds the per-page slot elements bridge.ts
// attaches its own listeners to; owns `pageSize` caching and
// slot-count reconciliation across an `apply` (`ChangeSet.pageCount` can differ
// from the previous compile; pages can be added or removed). Every slot is drawn at
// the one scale `setScale` hands it, and a canvas fills its slot, so its ink stays on
// the box the click and scroll geometry measure; a scale change and a DPR
// media-query listener repaint mounted pages, so the raster stays sharp.
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
	/**
	 * Draw every page at `scale` CSS px per PDF pt and repaint the mounted ones: on the
	 * next frame, or once `settle` has passed without another call, which is what a
	 * gesture asks for, the stretched raster standing in until it rests.
	 */
	setScale(scale: number, settle?: number): void;
	destroy(): void;
}

// Vertical breathing room between stacked pages; cosmetic only, and a rung like
// any other gap: the stack breathes on the same rhythm the cards do.
const PAGE_GAP = 'var(--_qm-space-4)';

// The least raster density, in device pixels per CSS pixel. Glyphs rasterize
// unhinted, so a raster at a 1× or fractional ratio (1.25, 1.5; browser zoom)
// is resampled nearly 1:1 and small text smears; a raster at least twice the
// box is downsampled instead, which keeps body text legible.
const MIN_DENSITY = 2;

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
	// The raster scale each mounted canvas was last painted at, so a repaint skips one
	// already sharp at the scale it would take.
	const rastered = new Map<number, number>();
	const visible = new Set<number>();
	// Unset until the pane has had a box to fit: a slot fills the pane's width meanwhile.
	let scale: number | undefined;

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
		// `flex: none` under the flex column `Preview.svelte` lays the desk out as, which
		// would otherwise shrink a page to fit the pane; auto inline margins centre a page
		// narrower than the pane and resolve to zero on one wider, so it overflows to the
		// scrollable side.
		Object.assign(el.style, {
			position: 'relative',
			boxSizing: 'border-box',
			flex: 'none',
			marginInline: 'auto',
			aspectRatio: `${size.widthPt} / ${size.heightPt}`,
			background: 'var(--_qm-surface)'
		});
		sizeSlot(el, size);
		if (page > 0) el.style.marginTop = PAGE_GAP;
		container.appendChild(el);
		pageByEl.set(el, page);
		observer.observe(el);
		return { page, size, el };
	}

	function sizeSlot(el: HTMLElement, size: PageSize): void {
		el.style.width = scale === undefined ? '100%' : `${size.widthPt * scale}px`;
	}

	// Device px per PDF pt: the layout scale, else the slot's own width, times density.
	function rasterScale(slot: PageSlot): number {
		const layoutScale = scale ?? (slot.el.clientWidth || slot.size.widthPt) / slot.size.widthPt;
		return layoutScale * Math.max(window.devicePixelRatio || 1, MIN_DENSITY);
	}

	// Rasterize `slot` into its canvas (creating the canvas if this is its first
	// paint since mounting).
	function paintSlot(slot: PageSlot): void {
		let canvas = canvases.get(slot.page);
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.className = 'qm-page-canvas';
			Object.assign(canvas.style, {
				position: 'absolute',
				inset: '0',
				display: 'block',
				width: '100%',
				height: '100%'
			});
		}
		// Contextless canvas: bail before registering, so `updateBand` still sees
		// the page as unmounted and retries instead of keeping a blank page.
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		if (!canvases.has(slot.page)) {
			slot.el.insertBefore(canvas, slot.el.firstChild);
			canvases.set(slot.page, canvas);
		}
		const at = rasterScale(slot);
		try {
			session.paint(ctx, slot.page, at);
			rastered.set(slot.page, at);
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
		rastered.delete(page);
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
			sizeSlot(slots[i].el, size);
		}
	}

	// Slots are built on the first `refresh` (the controller calls it immediately),
	// not here: reconcile → `session.pageSize` must run after the controller's
	// `pageCount` gate, since `pageSize` throws for a page the count excludes.

	// ── Keep mounted rasters sharp ──────────────────────────────────────────────
	// A canvas stretches with its slot, so a page that stays mounted while the scale
	// or `devicePixelRatio` shifts keeps its place and goes soft. Both repaint mounted
	// pages; canvases are `position:absolute`, so a repaint can't feed back into
	// layout.

	// Repaint mounted pages whose raster scale moved. A no-op for an unmounted page.
	function repaint(): void {
		for (const page of canvases.keys()) {
			const slot = slots[page];
			if (slot && rastered.get(page) !== rasterScale(slot)) paintSlot(slot);
		}
	}

	// One repaint for a burst: on the next frame, or once `settle` passes with no later
	// call, a settle superseding a frame not yet run.
	let rafId = 0;
	let settleId: ReturnType<typeof setTimeout> | undefined;
	function scheduleRepaint(settle = 0): void {
		clearTimeout(settleId);
		settleId = undefined;
		if (settle > 0) {
			cancelAnimationFrame(rafId);
			rafId = 0;
			settleId = setTimeout(() => {
				settleId = undefined;
				repaint();
			}, settle);
			return;
		}
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			repaint();
		});
	}

	// `devicePixelRatio` changes (window dragged to a different-DPI monitor, browser
	// zoom) leave the scale untouched, so `setScale` never hears of them; watch DPR
	// directly. A `(resolution: …dppx)` query pins the current ratio and
	// is therefore one-shot: re-arm it against the new ratio on each change. Guarded
	// for environments (jsdom) without `matchMedia`.
	let dprQuery: MediaQueryList | undefined;
	function onDprChange(): void {
		scheduleRepaint();
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
		setScale(next, settle) {
			if (next === scale) return;
			scale = next;
			for (const slot of slots) sizeSlot(slot.el, slot.size);
			scheduleRepaint(settle);
		},
		destroy() {
			if (rafId) cancelAnimationFrame(rafId);
			clearTimeout(settleId);
			dprQuery?.removeEventListener('change', onDprChange);
			observer.disconnect();
			for (const page of [...canvases.keys()]) unmountPage(page);
			for (const slot of slots) slot.el.remove();
			slots.length = 0;
			pageByEl.clear();
		}
	};
}
