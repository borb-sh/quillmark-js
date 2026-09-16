// The empty body's ghost: the three-way precedence `resolveBodyGhost` settles
// (resolved `default:` › consumer wording › the built-in invitation), and the
// fixture fact that motivates the fallback existing at all; the reference quill
// declares no body `default:` on any kind, so the resolved channel is empty for
// exactly the cards a user adds. Here the pure resolution is pinned; that the hook
// feeding its middle rung is asked once per card is `body-ghost.svelte.test.ts`.
import { describe, it, expect } from 'vitest';
import { resolveBodyGhost, ghostDefault, stringifyGhost } from '$lib/visual/structure';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';

// The flat built-in is a `strings` key now, so the three-way precedence takes it
// as an argument rather than reaching for a constant: what the editor passes is
// whatever the consumer's wording resolved it to.
const BUILT_IN = DEFAULT_VISUAL_STRINGS.bodyGhost;
import { quill } from '../helpers/fixtures.js';

describe('resolveBodyGhost', () => {
	it('prefers a resolved `default:` over both the consumer and the built-in', () => {
		// The default is the only ghost that describes the render, so wording never
		// displaces it; a consumer cannot hide what prints when nothing is written.
		expect(resolveBodyGhost('THE DEFAULT', 'witty', BUILT_IN)).toBe('THE DEFAULT');
	});

	it('takes consumer wording when there is no default', () => {
		expect(resolveBodyGhost(undefined, 'Say something unforgettable…', BUILT_IN)).toBe(
			'Say something unforgettable…'
		);
	});

	it('never yields empty — a body leaf always has something to invite into it', () => {
		// `undefined` is the documented "defer to the package" answer from a consumer
		// hook; an empty string is the same intent expressed badly, and an empty
		// resolved default falls through rather than winning. No combination blanks
		// the leaf.
		expect(resolveBodyGhost('', 'witty', BUILT_IN)).toBe('witty');
		for (const [d, c] of [
			['', ''],
			[undefined, ''],
			['', undefined],
			[undefined, undefined]
		] as const)
			expect(resolveBodyGhost(d, c, BUILT_IN)).toBe(BUILT_IN);
	});
});

describe('the reference quill body channel', () => {
	it('resolves no body default on main, nor on a freshly added note', () => {
		// The add path is the exact sequence `addCard` runs, against the real schema.
		const q = quill();
		const doc = q.seedDocument();
		const card = q.seedCard('note', doc.seedOverlay('note'));
		expect(card).toBeTruthy();
		doc.insertCard(card!, doc.cardCount);

		const resolved = q.reader(doc).resolve();
		expect(resolved.cards.at(-1)?.kind).toBe('note');
		for (const body of [resolved.main.body, resolved.cards.at(-1)?.body]) {
			const ghost = stringifyGhost(ghostDefault(body ?? undefined));
			expect(ghost).toBeUndefined();
			expect(resolveBodyGhost(ghost, undefined, BUILT_IN)).toBe(BUILT_IN);
		}
	});
});
