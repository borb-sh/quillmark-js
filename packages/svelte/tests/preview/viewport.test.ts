// @vitest-environment jsdom
// One scale for every page, and the pill standing exactly while the zoom is not the
// default. jsdom lays out nothing, so the pane's box is stubbed and the scale is read
// back off the slots' widths.
import { describe, it, expect, beforeAll, beforeEach, afterEach, onTestFinished } from 'vitest';
import { createPreview, type PreviewController } from '$lib/preview/controller';
import type { LiveSession } from '@quillmark/wasm';
import { FakeIO, mockSession, stubPaintGlobals } from '../helpers/session.js';

beforeAll(stubPaintGlobals);

const portrait = { widthPt: 612, heightPt: 792 };
const landscape = { widthPt: 792, heightPt: 612 };

/** A memo with a landscape attachment between its two pages. */
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

	it('leaves the zoom keys to the browser over a pane without the focus', () => {
		container.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
		const key = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true });
		window.dispatchEvent(key);
		expect(key.defaultPrevented).toBe(false);
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
