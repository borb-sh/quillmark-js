// @vitest-environment jsdom
// The raster is denser than the display where the display alone would leave small text
// soft, and exactly the display where it would not.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession } from '@quillmark/wasm';

let report: ((isIntersecting: boolean) => void) | undefined;
class FakeIO {
	targets: Element[] = [];
	constructor(cb: IntersectionObserverCallback) {
		report = (isIntersecting) =>
			cb(
				this.targets.map((target) => ({ target, isIntersecting })) as IntersectionObserverEntry[],
				this as unknown as IntersectionObserver
			);
	}
	observe(el: Element): void {
		this.targets.push(el);
	}
	unobserve(): void {}
	disconnect(): void {}
}

beforeAll(() => {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
	HTMLCanvasElement.prototype.getContext =
		(() => ({})) as unknown as HTMLCanvasElement['getContext'];
});

const dpr = window.devicePixelRatio;
afterEach(() => {
	Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
});

function densityAt(ratio: number): number {
	Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
	let density = 0;
	const session = {
		pageCount: 1,
		pageSize: () => ({ widthPt: 612, heightPt: 792 }),
		paint: (_ctx: unknown, _page: number, opts: { densityScale: number }) => {
			density = opts.densityScale;
			return { layoutWidth: 612, layoutHeight: 792, pixelWidth: 612, pixelHeight: 792 };
		},
		regions: () => [],
		fieldBoxes: () => []
	} as unknown as LiveSession;
	const container = document.createElement('div');
	document.body.appendChild(container);
	const preview = createPreview(session, { container });
	report?.(true);
	preview.destroy();
	container.remove();
	return density;
}

describe('preview raster density', () => {
	it('supersamples a 1× or fractional display', () => {
		expect(densityAt(1)).toBeGreaterThan(1);
		expect(densityAt(1.25)).toBeGreaterThan(1.25);
		expect(densityAt(1)).toBe(densityAt(1.5));
	});

	it('paints a dense display at its own ratio', () => {
		expect(densityAt(3)).toBe(3);
	});
});
