import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bindDocument, seedDocument } from '../src/index.js';
import { core, quill, snapshot, type FixtureName } from './helpers.js';

const STARTS: [string, FixtureName, 'example' | 'seed' | 'empty'][] = [
	['showcase example', 'showcase', 'example'],
	['showcase seeded', 'showcase', 'seed'],
	['showcase empty', 'showcase', 'empty'],
	['usaf_memo example', 'usaf_memo', 'example'],
	['usaf_memo seeded', 'usaf_memo', 'seed']
];

const open = (name: FixtureName, which: 'example' | 'seed' | 'empty') => {
	const q = quill(name);
	return which === 'example'
		? q.exampleDocument()!
		: which === 'seed'
			? q.seedDocument()
			: q.emptyDocument();
};

describe('the round trip through Y', () => {
	it.each(STARTS)('projects the %s document back unchanged', (_, name, which) => {
		const q = quill(name);
		const saved = open(name, which);
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, seedDocument(saved, q));
		const doc = q.emptyDocument();
		const errors: unknown[] = [];
		bindDocument({ doc, quill: q, ydoc, onError: (e) => errors.push(e) });
		expect(errors).toEqual([]);
		expect(snapshot(doc)).toBe(snapshot(saved));
	});

	it('seeds the same bytes from the same document', () => {
		const q = quill();
		const a = seedDocument(open('showcase', 'example'), q);
		const b = seedDocument(core.Document.fromStored(open('showcase', 'example').toStored()), q);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});
});
