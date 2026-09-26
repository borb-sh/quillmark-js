// @vitest-environment jsdom
// The remount contract on `Preview`: every once-bound prop answers a swap, in one
// report naming whichever went stale. A guard covering part of a set is what teaches
// a consumer to read silence on the rest as reactivity, so the set is what is
// asserted, and the case that costs the guard its worth if it fails is the one where
// a mount that swaps nothing reports nothing.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { LiveSession } from '@quillmark/wasm';
import type { EditorError } from '$lib/core';
import Preview from '$lib/preview/Preview.svelte';
import RebindHost from './RebindHost.svelte';

// jsdom has no IntersectionObserver; the paint loop only observes visibility, and
// no page is ever scrolled into view here.
class NoopIO {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}
beforeAll(() => {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopIO;
});

/** A report-only session stub: the geometry verbs the loop calls at build. */
function mockSession(): LiveSession {
	return {
		pageCount: 1,
		pageSize: () => ({ widthPt: 612, heightPt: 792 }),
		paint: () => {},
		regions: () => [],
		fieldBoxes: () => [],
		positionAt: () => undefined,
		locate: () => undefined
	} as unknown as LiveSession;
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

/** Mount `Component` over a reactive prop bag the test swaps under it. */
function mountSurface<P extends Record<string, unknown>>(
	Component: unknown,
	initial: P
): { props: P & { onError: (e: EditorError) => void }; errors: EditorError[] } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const errors: EditorError[] = [];
	const props = $state({ ...initial, onError: (e: EditorError) => errors.push(e) });
	const app = mount(Component as Parameters<typeof mount>[0], { target, props });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { props, errors };
}

/** The `rebind-ignored` reports, which are the only ones these cases produce. */
function rebinds(errors: EditorError[]): EditorError[] {
	return errors.filter((e) => e.code === 'rebind-ignored');
}

/**
 * Flush, absorbing the dev throw the guard raises after it reports, and answer what it
 * threw. Vitest builds with `DEV`, so every swap below throws, and a case reading only
 * the reports still has to flush through it.
 */
function flushCatching(): Error | undefined {
	try {
		flushSync();
	} catch (e) {
		return e as Error;
	}
	return undefined;
}

describe('Preview', () => {
	it('reports nothing when no prop is swapped', () => {
		const { errors } = mountSurface(Preview, {
			session: mockSession(),
			margin: 16,
			strings: { noPages: 'Nothing to show' }
		});
		flushSync();
		expect(rebinds(errors)).toHaveLength(0);
	});

	it.each([
		['session', () => mockSession()],
		['margin', () => 48],
		['onPick', () => () => {}],
		['strings', () => ({ noPages: 'Rien à afficher' })]
	])('reports %s swapped in place, once, at dev severity', (prop, next) => {
		const { props, errors } = mountSurface(Preview, {
			session: mockSession(),
			margin: 16,
			onPick: () => {},
			strings: { noPages: 'Nothing to show' }
		});

		(props as Record<string, unknown>)[prop] = next();
		const thrown = flushCatching();
		(props as Record<string, unknown>)[prop] = next();
		flushCatching();

		const reported = rebinds(errors);
		expect(reported).toHaveLength(1);
		expect(reported[0].severity).toBe('dev');
		expect(reported[0].message).toContain(prop);
		// Reported and thrown: the throw is what reaches a consumer whose handler went
		// stale in the same swap, and it carries the same sentence.
		expect(thrown?.message).toContain('rebind-ignored');
		expect(thrown?.message).toContain(prop);
	});

	it('stays quiet under an inline `strings` literal, and reports when its value moves', () => {
		const { props, errors } = mountSurface(RebindHost, {
			session: mockSession(),
			label: 'Nothing to show'
		});
		// The literal is a prop expression, not a handle the host holds; a mount
		// that swapped nothing reports nothing.
		expect(rebinds(errors)).toHaveLength(0);

		props.label = 'Rien à afficher';
		flushCatching();

		// A language switch is a swap: the mounted preview keeps its English.
		expect(rebinds(errors)).toHaveLength(1);
		expect(rebinds(errors)[0].message).toContain('strings');
	});

	it('throws a swapped onError, whose report reaches only the handler it replaced', () => {
		const { props, errors } = mountSurface(Preview, { session: mockSession() });
		const replacement: EditorError[] = [];

		props.onError = (e: EditorError) => replacement.push(e);
		const thrown = flushCatching();

		// `onError` is once-bound like the rest, so the report of its own swap reaches
		// the handler that was replaced, not the one that took its place. The throw is
		// the half that arrives: it needs no handler.
		expect(rebinds(errors)).toHaveLength(1);
		expect(rebinds(errors)[0].message).toContain('onError');
		expect(rebinds(replacement)).toHaveLength(0);
		expect(thrown?.message).toContain('onError');
	});

	it('names every prop that went stale in the one report', () => {
		const { props, errors } = mountSurface(Preview, {
			session: mockSession(),
			margin: 16,
			onPick: () => {}
		});

		props.margin = 48;
		props.onPick = () => {};
		flushCatching();

		const reported = rebinds(errors);
		expect(reported).toHaveLength(1);
		expect(reported[0].message).toContain('margin');
		expect(reported[0].message).toContain('onPick');
	});

	it('goes on painting the session it bound, after the throw', () => {
		const { props } = mountSurface(Preview, { session: mockSession(), margin: 16 });

		props.margin = 48;
		expect(flushCatching()).toBeDefined();

		// The throw is the message escalating, not the surface failing: the tree still
		// renders and still flushes, which is what makes throwing affordable here.
		expect(document.querySelector('.qm-preview')).not.toBeNull();
		props.margin = 64;
		expect(flushCatching()).toBeUndefined();
	});
});
