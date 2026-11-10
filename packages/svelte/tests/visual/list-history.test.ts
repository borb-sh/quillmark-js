import { describe, expect, it } from 'vitest';
import { listHistory, sameValues, undoChord, type ListStep } from '$lib/visual/listhistory.js';

const rows = (ids: string[], values: unknown[]) => ({ ids, values });
const step = (from: unknown[], to: unknown[]): ListStep => ({
	before: rows(from.map(String), from),
	after: rows(to.map(String), to)
});

describe('listHistory', () => {
	it('undoes a step only while the rows stand where it left them', () => {
		const h = listHistory((a, b) => sameValues(a, b));
		const s = step(['a'], ['a', 'b']);
		h.record(s);
		expect(h.take(false, ['a', 'c'])).toBeUndefined();
		expect(h.latest()).toBe(s);
		expect(h.take(false, ['a', 'b'])).toBe(s.before);
		expect(h.latest()).toBeUndefined();
	});

	it('redoes what it undid, and a new step drops the redo', () => {
		const h = listHistory((a, b) => sameValues(a, b));
		const s = step(['a'], ['a', 'b']);
		h.record(s);
		h.take(false, ['a', 'b']);
		expect(h.take(true, ['a'])).toBe(s.after);
		h.take(false, ['a', 'b']);
		h.record(step(['a'], ['z']));
		expect(h.take(true, ['z'])).toBeUndefined();
	});

	it('compares values through the norm it is given', () => {
		const blankless = (row: unknown) =>
			Object.fromEntries(Object.entries(row as object).filter(([, v]) => v !== ''));
		expect(sameValues([{ a: 1, b: '' }], [{ a: 1 }], blankless)).toBe(true);
		expect(sameValues([{ a: 1, b: '' }], [{ a: 1 }])).toBe(false);
	});
});

describe('undoChord', () => {
	const key = (init: KeyboardEventInit) =>
		({
			defaultPrevented: false,
			isComposing: false,
			altKey: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			key: '',
			...init
		}) as KeyboardEvent;

	it('reads undo, the two redos, and nothing else', () => {
		expect(undoChord(key({ key: 'z', metaKey: true }))).toBe('undo');
		expect(undoChord(key({ key: 'Z', metaKey: true, shiftKey: true }))).toBe('redo');
		expect(undoChord(key({ key: 'y', ctrlKey: true }))).toBe('redo');
		expect(undoChord(key({ key: 'y', metaKey: true }))).toBeUndefined();
		expect(undoChord(key({ key: 'z' }))).toBeUndefined();
		expect(undoChord(key({ key: 'z', ctrlKey: true, altKey: true }))).toBeUndefined();
	});
});
