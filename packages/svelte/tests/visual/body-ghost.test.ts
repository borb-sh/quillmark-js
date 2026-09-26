// The empty body's ghost: the precedence `resolveBodyGhost` settles (resolved
// `default:` › the kind's `body.example` › consumer wording › the built-in
// invitation), and the fixture facts that reach it: the reference quill declares no
// body `default:` on any kind, so the resolved channel is empty for exactly the cards
// a user adds, and some kinds declare a `body.example` where `note` declares none.
// Here the pure resolution is pinned; that the hook feeding the consumer rung is asked
// once per card is `body-ghost.svelte.test.ts`.
import { describe, it, expect } from 'vitest';
import { resolveBodyGhost, ghostDefault, stringifyGhost } from '$lib/visual/structure';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import { quill } from '../helpers/fixtures.js';

// The flat built-in is a `strings` key, so the precedence takes it as an argument
// rather than reaching for a constant: what the editor passes is whatever the
// consumer's wording resolved it to.
const BUILT_IN = DEFAULT_VISUAL_STRINGS.bodyGhost;

describe('resolveBodyGhost', () => {
	it('prefers a resolved `default:` over every invitation', () => {
		// The default is the only ghost that describes the render, so wording never
		// displaces it; a consumer cannot hide what prints when nothing is written.
		expect(resolveBodyGhost('THE DEFAULT', 'e.g.', 'witty', BUILT_IN)).toBe('THE DEFAULT');
	});

	it('takes the kind’s `body.example` over the consumer’s wording', () => {
		// The quill's own invitation is the one an agent working from the blueprint
		// reads too, so it outranks wording the blueprint never carries.
		expect(resolveBodyGhost(undefined, 'Findings, in prose.', 'witty', BUILT_IN)).toBe(
			'Findings, in prose.'
		);
	});

	it('takes consumer wording where the kind declares no example', () => {
		expect(resolveBodyGhost(undefined, undefined, 'Say something unforgettable…', BUILT_IN)).toBe(
			'Say something unforgettable…'
		);
	});

	it('never yields empty — a body leaf always has something to invite into it', () => {
		// `undefined` is the documented "defer to the package" answer from a consumer
		// hook; an empty string is the same intent expressed badly, and an empty
		// resolved default or example falls through rather than winning. No combination
		// blanks the leaf.
		expect(resolveBodyGhost('', '', 'witty', BUILT_IN)).toBe('witty');
		for (const d of ['', undefined])
			for (const e of ['', undefined])
				for (const c of ['', undefined]) expect(resolveBodyGhost(d, e, c, BUILT_IN)).toBe(BUILT_IN);
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
		}
	});

	it('carries a `body.example` on the kinds that declare one, and none on `note`', () => {
		const kinds = quill().schema.card_kinds!;
		expect(kinds.section.body?.example).toBeTruthy();
		expect(kinds.note.body?.example).toBeUndefined();
		expect(resolveBodyGhost(undefined, kinds.note.body?.example, undefined, BUILT_IN)).toBe(
			BUILT_IN
		);
	});
});
