// @vitest-environment jsdom
// A run of commits to one field is typing in a by-value cell: its commits past the
// first rebuild the one card from the one field, and the whole-document derive, the
// validation with it, lands once the run rests.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, type, unmountAll } from '../helpers/surface.svelte.js';

const QUILL_YAML = `quill:
  name: run
  version: 1.0.0
  backend: typst
  description: Two numbers.
typst:
  plate_file: plate.typ
main:
  fields:
    count:
      type: integer
    pages:
      type: integer
`;

let q: Quill;
let doc: Document;
let validate: ReturnType<typeof vi.spyOn>;
function open(): HTMLElement {
	q = quillFromYaml(QUILL_YAML);
	doc = q.parse(
		['~~~', '$quill: run@1.0.0', '$kind: main', 'count: 1', 'pages: 2', '~~~', ''].join('\n')
	);
	validate = vi.spyOn(q, 'validate');
	return mountEditor(q, doc).target;
}
const input = (target: HTMLElement, label: string): HTMLInputElement =>
	field(target, label).querySelector<HTMLInputElement>('input')!;
const rest = (): void => {
	vi.runOnlyPendingTimers();
	flushSync();
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
	unmountAll();
	vi.useRealTimers();
});

describe('a run of commits to one field', () => {
	it('writes and draws each commit, and validates once it rests', () => {
		const target = open();
		type(input(target, 'Count'), '12');
		const first = validate.mock.calls.length;
		type(input(target, 'Count'), '123');
		type(input(target, 'Count'), '1234');
		expect(q.reader(doc).get('count')).toBe(1234);
		expect(input(target, 'Count').value).toBe('1234');
		expect(validate.mock.calls.length).toBe(first);
		rest();
		expect(validate.mock.calls.length).toBeGreaterThan(first);
	});

	it('derives at once on a commit to another field', () => {
		const target = open();
		type(input(target, 'Count'), '12');
		type(input(target, 'Count'), '123');
		const before = validate.mock.calls.length;
		type(input(target, 'Pages'), '3');
		expect(validate.mock.calls.length).toBeGreaterThan(before);
	});

	it('derives at once on the commit that unsets the field, and on the one that sets it again', () => {
		const target = open();
		type(input(target, 'Count'), '12');
		let before = validate.mock.calls.length;
		type(input(target, 'Count'), '');
		expect(q.reader(doc).get('count')).toBeUndefined();
		expect(validate.mock.calls.length).toBeGreaterThan(before);
		before = validate.mock.calls.length;
		type(input(target, 'Count'), '7');
		expect(validate.mock.calls.length).toBeGreaterThan(before);
	});
});
