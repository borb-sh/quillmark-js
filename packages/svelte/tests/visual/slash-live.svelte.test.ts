// @vitest-environment jsdom
// The slash menu's highlight moves while the caret stays in the text, so the region beside
// it is what a screen reader hears of the move. Driven on `SlashMenu`, mounted bare over a
// menu state the test steps the way the leaf's keymap does.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import SlashMenu from '$lib/visual/SlashMenu.svelte';
import { DEFAULT_SLASH_STRINGS as S, type SlashState } from '$lib/core/codec';

// jsdom lays nothing out, so it has no `scrollIntoView` for the highlight's follow.
beforeAll(() => {
	Element.prototype.scrollIntoView ??= () => {};
});

const mounted: (() => void)[] = [];
afterEach(() => {
	for (const off of mounted.splice(0)) off();
});

function menu() {
	let state = $state.raw<SlashState | undefined>(undefined);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(SlashMenu, {
		target,
		props: {
			get menu() {
				return state;
			},
			leaf: () => undefined,
			label: S.slashLabel,
			name: S.slashName,
			position: S.slashPosition
		}
	});
	flushSync();
	mounted.push(() => {
		void unmount(app);
		target.remove();
	});
	const live = target.querySelector('[aria-live="polite"]')!;
	return {
		live,
		set(next: Omit<SlashState, 'anchor'> | undefined) {
			state = next && ({ ...next, anchor: null } as unknown as SlashState);
			flushSync();
		}
	};
}

describe('the slash menu’s live region', () => {
	it('is mounted empty before the menu opens, so its first words are announced', () => {
		const m = menu();
		expect(m.live.textContent).toBe('');
	});

	it('speaks the highlighted row and its place as the index moves, and falls silent on close', () => {
		const m = menu();
		const items = ['heading', 'list', 'table'];
		m.set({ items, index: 0, query: '' });
		expect(m.live.textContent).toBe(S.slashPosition(S.slashName('heading'), 1, 3));
		m.set({ items, index: 2, query: '' });
		expect(m.live.textContent).toBe(S.slashPosition(S.slashName('table'), 3, 3));
		m.set(undefined);
		expect(m.live.textContent).toBe('');
	});
});
