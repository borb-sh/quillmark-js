// @vitest-environment jsdom
// The raster is denser than the display where the display alone would leave small text
// soft, and exactly the display where it would not.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createPreview } from '$lib/preview/controller';
import type { LiveSession } from '@quillmark/wasm';
import { FakeIO, mockSession, stubPaintGlobals } from '../helpers/session.js';

beforeAll(stubPaintGlobals);

const dpr = window.devicePixelRatio;
afterEach(() => {
	Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
});

function densityAt(ratio: number): number {
	Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
	let density = 0;
	const session = {
		...mockSession(),
		// jsdom lays no box out, so the slot paints at a layout scale of 1 and the scale
		// is the density alone.
		paint: (_ctx: unknown, _page: number, scale: number) => {
			density = scale;
		}
	} as unknown as LiveSession;
	const container = document.createElement('div');
	document.body.appendChild(container);
	const preview = createPreview(session, { container });
	FakeIO.last!.report(true);
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
