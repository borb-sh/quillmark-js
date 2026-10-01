// @vitest-environment jsdom
// The trip that keeps a pressed control inside the fold across a disclosure's collapse
// (`visual/hold.ts`), and the wiring: which control each disclosure offers as the
// anchor, asked for against the change rather than the layout before it. jsdom lays
// nothing out and reports custom properties as empty, so the rung is stubbed where the
// chase is under test and what is asserted is the shape of the call, on the right
// element in the right state; the trip itself is the playground's to show.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { holdInView } from '$lib/visual/hold.js';
import { quill } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(() => {
	unmountAll();
	vi.restoreAllMocks();
});

function anchor(): HTMLElement {
	const el = document.createElement('button');
	el.scrollIntoView = vi.fn();
	document.body.append(el);
	return el;
}

/** A computed style carrying one rung, which jsdom's own reports as empty. */
function withRung(ms: string): void {
	const real = window.getComputedStyle.bind(window);
	vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
		const style = real(el);
		return { ...style, getPropertyValue: (p: string) => (p === '--_qm-duration-slow' ? ms : '') };
	});
}

describe('holdInView', () => {
	it('reveals the anchor by the minimum trip, instantly', () => {
		const el = anchor();
		holdInView(el, () => {});
		expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
	});

	it('reveals it against the change, not against the layout before it', () => {
		const el = anchor();
		let openAtReveal: string | null = null;
		(el.scrollIntoView as ReturnType<typeof vi.fn>).mockImplementation(() => {
			openAtReveal = el.getAttribute('aria-expanded');
		});
		holdInView(el, () => el.setAttribute('aria-expanded', 'true'));
		expect(openAtReveal).toBe('true');
	});

	it('runs the change with no anchor to hold', () => {
		let ran = false;
		holdInView(undefined, () => (ran = true));
		expect(ran).toBe(true);
	});

	it('chases the move for the length of the motion rung', () => {
		const el = anchor();
		withRung('200ms');
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
		const start = performance.now();

		holdInView(el, () => {});
		expect(el.scrollIntoView).toHaveBeenCalledTimes(1); // the one before the chase

		frames.pop()!(start + 100);
		expect(el.scrollIntoView).toHaveBeenCalledTimes(2);
		expect(frames).toHaveLength(1); // still inside the rung, so it re-arms

		frames.pop()!(start + 300);
		expect(el.scrollIntoView).toHaveBeenCalledTimes(3);
		expect(frames).toHaveLength(0); // past the rung, so it stops
	});

	it('takes the one trip where no rung reads, which is jsdom and an unstyled root', () => {
		const el = anchor();
		const rafs = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
		holdInView(el, () => {});
		expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
		expect(rafs).not.toHaveBeenCalled();
	});
});

/** Every reveal asked for, as the element that asked and what it said about itself at the
 *  time: the pair the wiring is judged on. */
function reveals(): { el: Element; expanded: string | null }[] {
	const seen: { el: Element; expanded: string | null }[] = [];
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
		seen.push({ el: this, expanded: this.getAttribute('aria-expanded') });
	});
	return seen;
}

describe('the control a disclosure holds in view', () => {
	it('is the section header pressed, in the state the press left it', () => {
		const q = quill('usaf_memo');
		const { target } = mountEditor(q, q.seedDocument());
		const headers = [
			...target.querySelector('.qm-card')!.querySelectorAll<HTMLElement>('.qm-group-header')
		];
		const seen = reveals();

		headers[2].click();
		flushSync();

		expect(seen.map((s) => s.el)).toEqual([headers[2]]);
		expect(seen[0].expanded).toBe('true');
		expect(headers[0].getAttribute('aria-expanded')).toBe('false');
	});

	it('is the header pressed when the press closes its own section', () => {
		const q = quill('usaf_memo');
		const { target } = mountEditor(q, q.seedDocument());
		const headers = [
			...target.querySelector('.qm-card')!.querySelectorAll<HTMLElement>('.qm-group-header')
		];
		const seen = reveals();

		headers[0].click(); // the group open on seed
		flushSync();

		expect(seen.map((s) => s.el)).toEqual([headers[0]]);
		expect(seen[0].expanded).toBe('false');
	});
});
