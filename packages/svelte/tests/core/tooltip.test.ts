// @vitest-environment jsdom
// The tip a glyph control raises, at the reach jsdom has: which gesture raises it, what it
// says, and what lowers it. Where it stands is layout, which is the playground's to show.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tooltips } from '$lib/core/tooltip.js';

let release: (() => void)[] = [];
afterEach(() => {
	for (const r of release) r();
	release = [];
	document.body.replaceChildren();
	vi.useRealTimers();
});

function mount(): { root: HTMLElement; named: HTMLElement; keyed: HTMLElement } {
	vi.useFakeTimers();
	const root = document.createElement('div');
	root.setAttribute('data-qm-root', '');
	root.innerHTML =
		'<button data-qm-tip="Move up"><svg></svg></button>' +
		'<button data-qm-tip="Bold" data-qm-tip-keys="Ctrl+B"></button>';
	document.body.appendChild(root);
	release.push(tooltips(root));
	const [named, keyed] = root.querySelectorAll<HTMLElement>('button');
	return { root, named, keyed };
}
const tip = (root: HTMLElement): HTMLElement | null => root.querySelector('.qm-tip');
const over = (el: Element): boolean =>
	el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
const out = (el: Element): boolean =>
	el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));

describe('tooltips', () => {
	it('raises a control’s name once the pointer has rested on it, from any part of it', () => {
		const { root, named } = mount();
		over(named.querySelector('svg')!);
		expect(tip(root)).toBeNull();
		vi.runAllTimers();
		expect(tip(root)?.textContent).toBe('Move up');
		expect(tip(root)?.getAttribute('aria-hidden')).toBe('true');
		expect(named.hasAttribute('aria-describedby')).toBe(false);
	});

	it('draws the shortcut as a keycap after the name', () => {
		const { root, keyed } = mount();
		over(keyed);
		vi.runAllTimers();
		expect(tip(root)?.firstChild?.textContent).toBe('Bold');
		expect(tip(root)?.querySelector('kbd')?.textContent).toBe('Ctrl+B');
	});

	it('raises nothing for a pointer that leaves before the wait is out', () => {
		const { root, named } = mount();
		over(named);
		out(named);
		vi.runAllTimers();
		expect(tip(root)).toBeNull();
	});

	it('raises at once under keyboard focus, and lowers as the focus leaves', () => {
		const { root, named } = mount();
		named.focus();
		expect(tip(root)?.textContent).toBe('Move up');
		named.blur();
		expect(tip(root)).toBeNull();
	});

	it('lowers on a press and stays down until the pointer comes back', () => {
		const { root, named } = mount();
		over(named);
		vi.runAllTimers();
		named.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		expect(tip(root)).toBeNull();
		over(named);
		vi.runAllTimers();
		expect(tip(root)).toBeNull();
		out(named);
		over(named);
		vi.runAllTimers();
		expect(tip(root)).not.toBeNull();
	});

	it('lowers on a key and on a scroll, wherever either lands', () => {
		const { root, named } = mount();
		for (const event of [new KeyboardEvent('keydown', { key: 'Escape' }), new Event('scroll')]) {
			over(named);
			vi.runAllTimers();
			expect(tip(root)).not.toBeNull();
			document.dispatchEvent(event);
			expect(tip(root)).toBeNull();
			out(named);
		}
	});

	it('is one install per root, standing until its last caller releases it', () => {
		const { root, named } = mount();
		const second = tooltips(root);
		second();
		over(named);
		vi.runAllTimers();
		expect(root.querySelectorAll('.qm-tip')).toHaveLength(1);
		out(named);
		release.pop()!();
		over(named);
		vi.runAllTimers();
		expect(tip(root)).toBeNull();
	});
});
