// @vitest-environment jsdom
// The `bodyPlaceholder` hook as the mounted editor asks it: once per card that
// renders a body, carrying that card's identity, and with nothing kept between
// calls. A consumer wanting two empty cards of one kind to read alike writes a
// function of `kind`; one wanting them to differ writes a function of `cardId`.
// Neither is the editor's to decide.
//
// The ghosts observed are the notes'. The reference quill seeds main's body from
// its `body.example`, and a body with content carries no placeholder decoration;
// main is asked all the same, which is what `seen` is read for. `note` is the kind
// declaring no body example, so every note in the stack mounts an empty leaf.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import type { VisualEditorProps } from '$lib/visual/props';
import type { BodyPlaceholderContext } from '$lib/visual/structure';
import { DEFAULT_VISUAL_STRINGS } from '$lib/visual/strings';
import { quill } from '../helpers/fixtures.js';

const BUILT_IN = DEFAULT_VISUAL_STRINGS.bodyGhost;

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

/** Mount over a document carrying one added note beyond the seed, so the kind
 *  appears more than once and per-card wording has something to distinguish. */
function mountEditor(props: Partial<VisualEditorProps> = {}) {
	const q = quill();
	const doc = q.seedDocument();
	const card = q.seedCard('note', doc.seedOverlay('note'));
	if (card) doc.insertCard(card, doc.cardCount);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q, ...props } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
		doc.free();
	};
	return target;
}

/** Every empty body's rendered ghost, in card order. The decoration stamps
 *  `data-placeholder` on the sole empty paragraph, which is what the CSS prints. */
function ghosts(target: HTMLElement): string[] {
	return [...target.querySelectorAll<HTMLElement>('.qm-body-leaf [data-placeholder]')].map(
		(el) => el.dataset.placeholder ?? ''
	);
}

describe('the hook is asked per card', () => {
	it('carries each card, so one kind can ghost two ways', () => {
		const seen: BodyPlaceholderContext[] = [];
		const target = mountEditor({
			strings: {
				bodyPlaceholder: (ctx) => {
					seen.push(ctx);
					// Keyed to the card: the answer depends on `cardId` alone, so no two
					// cards collide.
					return `Write ${ctx.cardId}…`;
				}
			}
		});

		// Two cards of one kind, wearing different words.
		const drawn = ghosts(target);
		expect(drawn.length).toBeGreaterThan(1);
		expect(new Set(drawn).size).toBe(drawn.length);
		expect(drawn.every((g) => /^Write .+…$/.test(g))).toBe(true);

		// The main card is asked too, naming itself; every other ask carries a distinct
		// session key.
		expect(seen.some((s) => s.cardId === 'main' && s.kind === 'main' && s.isMain)).toBe(true);
		const notes = seen.filter((s) => s.kind === 'note');
		expect(notes.length).toBeGreaterThan(1);
		expect(new Set(notes.map((s) => s.cardId)).size).toBe(notes.length);
	});

	it('reads as one invitation per kind when the hook is a function of kind', () => {
		// Same kind, same words, because the function says so: many empty bodies, one
		// invitation per kind that has one.
		const target = mountEditor({
			strings: { bodyPlaceholder: (ctx) => `Say something about the ${ctx.kind}…` }
		});

		const drawn = ghosts(target);
		expect(drawn.length).toBeGreaterThan(1);
		const kinds = [...new Set(drawn)].map((g) => /^Say something about the (.+)…$/.exec(g)?.[1]);
		expect(kinds.length).toBeLessThan(drawn.length);
		expect(kinds.every((k) => k && k !== 'main')).toBe(true);
	});

	it('ghosts the built-in when the hook declines', () => {
		// No hook set is the declining hook: the package's own `bodyPlaceholder` returns
		// `undefined`, so this is the same rung a consumer reaches by deferring. The
		// reference quill declares no body `default:` on any kind, so nothing above the
		// built-in answers either.
		const target = mountEditor();

		const drawn = ghosts(target);
		expect(drawn.length).toBeGreaterThan(1);
		expect(new Set(drawn)).toEqual(new Set([BUILT_IN]));
	});
});
