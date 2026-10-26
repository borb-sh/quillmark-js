/**
 * The readings the app takes off what it stores. A browser keeps a reader's documents across
 * releases, so `fixtures/` holds records as a shipped release wrote them, and each must
 * still open in this one.
 */

import { describe, it, expect } from 'vitest';
import v1 from './fixtures/records-v1.json';
import {
	fileName,
	latestFor,
	readRecord,
	standing,
	titleOf,
	toStored,
	type AppConfig,
	type DocRecord
} from '../records';

const app: AppConfig = {
	title: 'Forms',
	quills: [
		{ ref: 'memo@1.2.0', title: 'Memo' },
		{ ref: 'letter@0.3.0', title: 'Letter' }
	]
};
/** The pack the build laid: the versions it holds of each quill. */
const pack = {
	versionsOf: (name: string): string[] =>
		({ memo: ['1.2.0', '1.1.0'], letter: ['0.3.0'] })[name] ?? []
};

describe('a stored record', () => {
	it('reads back every record an earlier release wrote', () => {
		for (const raw of v1 as unknown[]) {
			const record = readRecord(raw);
			expect(record, JSON.stringify(raw)).toBeDefined();
			expect(readRecord(toStored(record!))).toEqual(record);
		}
	});

	it('reads back what this release stores', () => {
		const record: DocRecord = { id: 'a', title: 'T', quill: 'memo@1.2.0', edited: 1, markdown: '' };
		expect(readRecord(toStored(record))).toEqual(record);
	});

	it('declines a shape it cannot read, rather than opening half a document', () => {
		const [raw] = v1;
		const { v } = toStored({ id: '', title: '', quill: '', edited: 0, markdown: '' });
		for (const broken of [
			null,
			'text',
			{ ...raw, v: v + 1 },
			{ ...raw, markdown: undefined },
			{ ...raw, edited: Number.NaN }
		])
			expect(readRecord(broken), JSON.stringify(broken)).toBeUndefined();
	});
});

describe("a record's pin", () => {
	it('stands current, retired, or missing against the build', () => {
		expect(standing(app.quills[0]!.ref, app, pack)).toBe('current');
		expect(standing('memo@1.1.0', app, pack)).toBe('retired');
		expect(standing('memo@0.9.0', app, pack)).toBe('missing');
		expect(standing('notice@1.0.0', app, pack)).toBe('missing');
	});

	it("finds the same quill's current pin, and no other quill's", () => {
		expect(latestFor('memo@1.1.0', app)).toBe(app.quills[0]);
		expect(latestFor('memo@0.9.0', app)).toBe(app.quills[0]);
		expect(latestFor('notice@1.0.0', app)).toBeUndefined();
	});
});

describe("a document's title", () => {
	const fields = {
		date: { type: 'date' },
		to: { type: 'text' },
		subject: { type: 'text?' },
		closing: { type: 'enum' },
		body: { type: 'richtext' }
	};
	const main = (values: Record<string, unknown>) => ({
		payloadItems: Object.entries(values).map(([key, value]) => ({ type: 'field', key, value }))
	});

	it('reads a subject before the fields declared ahead of it', () => {
		expect(titleOf(main({ to: 'Ann', subject: 'Leave' }), fields, 'Memo')).toBe('Leave');
	});

	it('reads the next text field in schema order where the subject is blank', () => {
		expect(
			titleOf(main({ subject: '  ', closing: 'thanks', to: { text: 'Ann' } }), fields, 'Memo')
		).toBe('Ann');
	});

	it("falls back to the quill's title where no text is answered", () => {
		expect(titleOf(main({ date: '2026-01-01', closing: 'thanks' }), fields, 'Memo')).toBe('Memo');
	});

	it('is one line, and cut short with an ellipsis', () => {
		const long = 'word '.repeat(40);
		const title = titleOf(main({ subject: `two\nlines ${long}` }), fields, 'Memo');
		expect(title).not.toMatch(/\n/);
		expect(title.startsWith('two lines word')).toBe(true);
		expect(title.endsWith('…')).toBe(true);
		expect(title.length).toBeLessThan(long.length);
	});
});

describe('a download', () => {
	it('is named after the title, with what no platform takes left out', () => {
		expect(fileName('Leave: 3/4 days?', 'pdf')).toBe('Leave 3 4 days.pdf');
		expect(fileName('Report.', 'md')).toBe('Report.md');
		expect(fileName('***', 'pdf')).toBe('document.pdf');
	});
});
