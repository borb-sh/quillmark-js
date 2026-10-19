// @vitest-environment jsdom
// The count on a capped prose value (`TextCount`): what it reads, when it draws, and
// what crossing the cap does. A by-value leaf (`ProseValue`) carries its own count, and
// a field's leaf (`ProseField`) reports its count up for `Field` to draw, so each is
// mounted on its own and driven the way its parent drives it: a `value` move for the
// one, a transaction into the controller's view for the other.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Content } from '@quillmark/wasm';
import ProseValue from '$lib/visual/ProseValue.svelte';
import ProseField from '$lib/visual/ProseField.svelte';
import { createLeafRegistry } from '$lib/visual/leaves.js';
import { quill, example } from '../helpers/fixtures.js';
import { viewOf } from '../codec/_util.js';

const content = (text: string): Content => ({
	text,
	lines: [{ containers: [], kind: 'para' }],
	marks: [],
	islands: []
});

const live: (() => void)[] = [];
afterEach(() => {
	for (const off of live.splice(0)) off();
});

function mountValue(initial: string, max: number) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({
		content: () => content(initial),
		value: initial as unknown,
		max,
		plaintext: true,
		label: 'Row 1',
		onChange: () => {}
	});
	const app = mount(ProseValue, { target, props });
	flushSync();
	live.push(() => {
		void unmount(app);
		target.remove();
	});
	/** Move the value as the parent's re-derive would: the leaf re-reads and recounts. */
	const move = (text: string) => {
		props.content = () => content(text);
		props.value = text;
		flushSync();
	};
	const count = () => target.querySelector<HTMLElement>('.qm-text-count')!;
	const live_ = () => target.querySelector<HTMLElement>('.qm-text-count-live')!;
	const editable = () => target.querySelector<HTMLElement>('.ProseMirror')!;
	return { target, move, count, live: live_, editable };
}

describe('TextCount on a by-value leaf', () => {
	it('reads the count against the cap and names it from the editable', () => {
		const m = mountValue('abc', 10);
		expect(m.count().textContent).toBe('3 / 10');
		expect(m.editable().getAttribute('aria-describedby')).toBe(m.count().id);
	});

	it('draws a short cap at every count, and a long one only near the cap', () => {
		const short = mountValue('a', 10);
		expect(short.count().classList.contains('hidden')).toBe(false);

		const long = mountValue('a', 1000);
		expect(long.count().classList.contains('hidden')).toBe(true);
		long.move('x'.repeat(800));
		expect(long.count().textContent).toBe('800 / 1000');
		expect(long.count().classList.contains('hidden')).toBe(false);
	});

	it('turns to danger over the cap, announces the crossing once, and cuts nothing', () => {
		const m = mountValue('abc', 3);
		expect(m.count().classList.contains('over')).toBe(false);
		expect(m.live().textContent).toBe('');

		m.move('abcd');
		expect(m.count().textContent).toBe('4 / 3');
		expect(m.count().classList.contains('over')).toBe(true);
		const announced = m.live().textContent;
		expect(announced).toContain('4');
		expect(m.editable().textContent).toBe('abcd');

		// A further keystroke over the cap moves the count and not the announcement.
		m.move('abcde');
		expect(m.count().textContent).toBe('5 / 3');
		expect(m.live().textContent).toBe(announced);

		m.move('abc');
		expect(m.count().classList.contains('over')).toBe(false);
		expect(m.live().textContent).toBe('');
	});

	it('draws no count without a cap', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(ProseValue, {
			target,
			props: { content: () => content('abc'), value: 'abc', onChange: () => {} }
		});
		flushSync();
		live.push(() => {
			void unmount(app);
			target.remove();
		});
		expect(target.querySelector('.qm-text-count')).toBeNull();
		expect(target.querySelector('.ProseMirror')!.hasAttribute('aria-describedby')).toBe(false);
	});
});

describe('ProseField reports its count', () => {
	it('at mount and after an edit, as the engine counts', () => {
		const q = quill();
		const doc = example();
		const leaves = createLeafRegistry();
		const counts: number[] = [];
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(ProseField, {
			target,
			props: {
				doc,
				quill: q,
				addr: { field: 'subtitle' },
				inline: true,
				plaintext: true,
				leafKey: 'subtitle',
				leaves,
				onCount: (n: number) => counts.push(n)
			}
		});
		flushSync();
		live.push(() => {
			void unmount(app);
			target.remove();
		});
		const controller = leaves.prose('subtitle')!;
		const initial = controller.getContent().text.trimEnd();
		expect(counts.at(-1)).toBe(Array.from(initial).length);

		const view = viewOf(controller);
		view.dispatch(view.state.tr.insertText('😀 ', view.state.doc.content.size - 1));
		expect(counts.at(-1)).toBe(Array.from(initial).length + 1);
	});
});
