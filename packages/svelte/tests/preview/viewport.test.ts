// @vitest-environment jsdom
// One scale for every page, and the pill standing exactly while the zoom is not the default. The
// pane's box is stubbed and the scale is read off the slots' widths.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createPreview, type PreviewController } from '$lib/preview/controller';
import type { LiveSession } from '@quillmark/wasm';
import { FakeIO, mockSession, stubPaintGlobals } from '../helpers/session.js';

beforeAll(stubPaintGlobals);

const portrait = { widthPt: 612, heightPt: 792 };
const landscape = { widthPt: 792, heightPt: 612 };

/** Two portrait pages with a landscape one between. */
function mixed(): LiveSession {
	const sizes = [portrait, landscape, portrait];
	return { ...mockSession(sizes.length), pageSize: (i: number) => sizes[i] } as LiveSession;
}

let container: HTMLDivElement;
let preview: PreviewController;
beforeEach(() => {
	container = document.createElement('div');
	Object.defineProperty(container, 'clientWidth', { value: 480, configurable: true });
	Object.defineProperty(container, 'clientHeight', { value: 720, configurable: true });
	document.body.appendChild(container);
	preview = createPreview(mixed(), { container });
	FakeIO.last!.report(true);
});
afterEach(() => {
	preview.destroy();
	container.remove();
});

const widths = (): number[] =>
	[...container.querySelectorAll<HTMLElement>('.qm-page-slot')].map((el) =>
		parseFloat(el.style.width)
	);
const pill = (): HTMLElement | null => container.querySelector('.qm-preview-zoom');
const zoomKey = (key: string): void => {
	window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true }));
};

describe('the preview zoom', () => {
	it('draws every page at one scale, the widest fitting the pane', () => {
		const [first, wide, last] = widths();
		expect(wide).toBeCloseTo(480, 6);
		expect(first / portrait.widthPt).toBeCloseTo(wide / landscape.widthPt, 6);
		expect(last).toBe(first);
	});

	it('shows the pill only while zoomed, and a click on it resets', () => {
		expect(pill()).toBeNull();
		const fit = widths();

		preview.setZoom(1);
		expect(pill()?.textContent).toBe('100%');
		expect(widths()).not.toEqual(fit);

		pill()!.click();
		expect(pill()).toBeNull();
		expect(widths()).toEqual(fit);
	});

	it('steps on the zoom keys of the pane holding the focus, and resets on Mod-0', () => {
		const fit = widths();
		zoomKey('=');
		expect(widths()).toEqual(fit);

		container.focus();
		zoomKey('=');
		expect(widths()[1]).toBeGreaterThan(fit[1]);
		expect(pill()).not.toBeNull();

		zoomKey('0');
		expect(widths()).toEqual(fit);
		expect(pill()).toBeNull();
	});

	it('zooms on a Ctrl-wheel and leaves a plain wheel to the scroll', () => {
		const fit = widths();
		container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
		expect(widths()).toEqual(fit);

		const zoom = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
		container.dispatchEvent(zoom);
		expect(zoom.defaultPrevented).toBe(true);
		expect(widths()[1]).toBeGreaterThan(fit[1]);
	});

	it('pans a diagonal wheel over pages overflowing both ways itself, and leaves the rest', () => {
		const at = { left: 0, top: 0 };
		for (const [axis, extent] of [
			['Left', 'Width'],
			['Top', 'Height']
		] as const) {
			const key = axis === 'Left' ? 'left' : 'top';
			Object.defineProperty(container, `scroll${extent}`, { value: 2000, configurable: true });
			Object.defineProperty(container, `scroll${axis}`, {
				get: () => at[key],
				set: (v: number) => (at[key] = Math.max(0, v)),
				configurable: true
			});
		}
		const wheel = (deltaX: number, deltaY: number): WheelEvent => {
			const e = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true });
			container.dispatchEvent(e);
			return e;
		};

		expect(wheel(30, 10).defaultPrevented).toBe(true);
		expect(at).toEqual({ left: 30, top: 10 });

		expect(wheel(0, 40).defaultPrevented).toBe(false);
		expect(wheel(-50, -20).defaultPrevented).toBe(true);
		expect(at).toEqual({ left: 0, top: 0 });
		expect(wheel(-5, -5).defaultPrevented).toBe(false);
	});

	it('is the default again once a step lands back on the fit', () => {
		const fit = widths();
		container.focus();
		zoomKey('=');
		zoomKey('-');
		expect(pill()).toBeNull();
		expect(widths()).toEqual(fit);
	});

	it('is the default again once a wheel crosses the fit', () => {
		const fit = widths();
		preview.setZoom(1);
		container.dispatchEvent(
			new WheelEvent('wheel', { deltaY: 1000, ctrlKey: true, cancelable: true })
		);
		expect(pill()).toBeNull();
		expect(widths()).toEqual(fit);
	});

	describe('under two fingers', () => {
		let top = 0;
		beforeEach(() => {
			top = 0;
			Object.defineProperty(container, 'scrollTop', {
				get: () => top,
				set: (v: number) => (top = Math.round(v)),
				configurable: true
			});
			// Each page laid out down the pane at its drawn width, moved by the scroll.
			container.querySelectorAll<HTMLElement>('.qm-page-slot').forEach((el, i) => {
				el.getBoundingClientRect = () => {
					const width = parseFloat(el.style.width);
					return new DOMRect(0, i * 1000 - top, width, width * 1.3);
				};
			});
		});
		const touch = (type: string, ...at: Array<[number, number]>): Event => {
			const e = new Event(type, { cancelable: true });
			const target = container.querySelector('.qm-page-slot');
			const touches = at.map(([clientX, clientY]) => ({ clientX, clientY, target }));
			Object.defineProperty(e, 'touches', { value: touches });
			container.dispatchEvent(e);
			return e;
		};

		it('pans with a drag that does not spread, a step under a pixel at a time', () => {
			touch('touchstart', [100, 300], [200, 300]);
			for (let y = 299.6; y >= 260; y -= 0.4) {
				expect(touch('touchmove', [100, y], [200, y]).defaultPrevented).toBe(true);
			}
			expect(top).toBe(40);
			expect(pill()).toBeNull();
		});

		it('zooms once the fingers part', () => {
			const fit = widths();
			touch('touchstart', [100, 300], [200, 300]);
			touch('touchmove', [80, 300], [220, 300]);
			touch('touchmove', [60, 300], [240, 300]);
			expect(widths()[1]).toBeGreaterThan(fit[1]);
		});
	});

	it('leaves the zoom keys to the browser over a pane without the focus', () => {
		container.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
		zoomKey('=');
		expect(pill()).toBeNull();
	});

	it('holds a zoom set while hidden for the box it comes back to', () => {
		Object.defineProperty(container, 'clientWidth', { value: 0, configurable: true });
		preview.setZoom(1);
		expect(pill()).toBeNull();

		Object.defineProperty(container, 'clientWidth', { value: 480, configurable: true });
		preview.refresh({ pageCount: 3, dirtyPages: [] });
		expect(pill()?.textContent).toBe('100%');
	});

	it('leaves the keys and the container as it found them once destroyed', () => {
		preview.destroy();
		expect(container.hasAttribute('tabindex')).toBe(false);
		container.focus();
		const key = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true });
		window.dispatchEvent(key);
		expect(key.defaultPrevented).toBe(false);
		preview = createPreview(mixed(), { container });
	});
});
