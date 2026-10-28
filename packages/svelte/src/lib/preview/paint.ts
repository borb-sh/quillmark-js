// The paint + scroll-virtualization loop: one <canvas> per visible-plus-margin page, mounted and
// unmounted as the container scrolls (`session.paint` re-rasterizes in full every call, so a canvas
// is never pooled across pages). Builds the page slots bridge.ts listens on, caches `pageSize`, and
// reconciles the slot count across an `apply`. Every slot is drawn at the one scale `setScale`
// hands it, and a scale change or DPR change repaints mounted pages.
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
	 * Draw every page at `scale` CSS px per PDF pt and repaint the mounted ones on the next frame,
	 * or once `settle` ms pass without another call (a gesture's request, the stretched raster
	 * standing in).
	 */
	setScale(scale: number, settle?: number): void;
	destroy(): void;
}

const PAGE_GAP = 'var(--_qm-space-4)';

// The least raster density, in device pixels per CSS pixel: glyphs rasterize unhinted, so a 1× or
// fractional raster smears small text where a 2× one downsamples cleanly.
const MIN_DENSITY = 2;

export function createPaintLoop(
	session: LiveSession,
	container: HTMLElement,
	margin: number,
	// Notified when a slot's `session.paint` throws; the throw is swallowed so one bad page never
	// aborts the band sweep.
	onPaintError?: (page: number, err: unknown) => void
): PaintLoop {
	// The IntersectionObserver root must be a scrollable ancestor of the slots; a consumer's own
	// choice stands.
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
		// The paper edge is where `--_qm-surface` meets the container's `--_qm-surface-sunken`; no
		// stroke is drawn (ARCHITECTURE §Styling).
		const el = document.createElement('div');
		// Not `.qm-page`: that is the preset's page baseline, whose `color-scheme` a slot must not
		// take inside a mounted root (`core/theme.css`).
		el.className = 'qm-page-slot';
		el.dataset.page = String(page);
		// `flex: none` keeps the flex column from shrinking a page; auto inline margins centre a
		// narrower page and overflow a wider one to the scrollable side.
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
		// After the last slot: the zoom pill's dock is a child too.
		const last = slots.at(-1)?.el;
		if (last) last.after(el);
		else container.prepend(el);
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
		// Bail before registering so `updateBand` retries rather than keeping a blank page.
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
			// Unmount the half-mounted canvas so the page stays a retryable unmounted slot, and let
			// the sweep move on.
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

	// Mount pages newly inside [min(visible)-margin, max(visible)+margin] and unmount those outside
	// it; a mounted page in the band keeps its pixels.
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

	// Grow or shrink the slots to `pageCount`, then re-cache every page's geometry.
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
			// A recompile can change a page's dimensions without changing the count.
			slots[i].el.style.aspectRatio = `${size.widthPt} / ${size.heightPt}`;
			sizeSlot(slots[i].el, size);
		}
	}

	// Slots are built on the first `refresh`: `session.pageSize` throws for a page the count
	// excludes.

	// Repaint mounted pages whose raster scale moved; a canvas stretches with its slot and goes
	// soft otherwise.
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

	// A `devicePixelRatio` change never reaches `setScale`. A `(resolution: …dppx)` query pins the
	// current ratio, so it is re-armed on each change. Guarded for jsdom, which has no
	// `matchMedia`.
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
			// A page the band just painted is already post-apply.
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
