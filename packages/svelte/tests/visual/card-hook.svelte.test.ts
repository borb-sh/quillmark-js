// @vitest-environment jsdom
// `data-qm-card` is the one schema-named hook a host's stylesheet is promised
// (THEMING §"What a stylesheet may aim at"): each card's box carries its own kind, so a rule
// aimed at a kind lands on that kind's cards and on no other.
import { describe, it, expect, afterEach } from 'vitest';
import { quill } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

describe('the card hook', () => {
	it("names each card's box by the card's kind, in document order", () => {
		const q = quill('usaf_memo');
		const doc = q.seedDocument();
		const { target } = mountEditor(q, doc);

		const hooked = [...target.querySelectorAll<HTMLElement>('.qm-card')].map(
			(el) => el.dataset.qmCard
		);
		expect(hooked).toEqual([doc.main.kind, ...doc.cards.map((card) => card.kind)]);
		expect(target.querySelectorAll('[data-qm-card]').length).toBe(hooked.length);
	});
});
