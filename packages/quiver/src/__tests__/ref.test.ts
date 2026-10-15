import { describe, it, expect } from 'vitest';
import { parseQuillRef } from '../ref.js';
import { QuiverError } from '../errors.js';

describe('parseQuillRef — valid refs', () => {
	it('parses bare name: showcase', () => {
		const result = parseQuillRef('showcase');
		expect(result.name).toBe('showcase');
		expect(result.selector).toBeUndefined();
	});

	it('parses name@major.minor: showcase@1.2', () => {
		const result = parseQuillRef('showcase@1.2');
		expect(result.name).toBe('showcase');
		expect(result.selector).toBe('1.2');
	});

	it('parses name@x.y.z: showcase@1.2.3', () => {
		const result = parseQuillRef('showcase@1.2.3');
		expect(result.name).toBe('showcase');
		expect(result.selector).toBe('1.2.3');
	});

	it('parses a collection-prefixed name: borb.usaf_memo@1.2', () => {
		const result = parseQuillRef('borb.usaf_memo@1.2');
		expect(result).toEqual({ collection: 'borb', name: 'usaf_memo', selector: '1.2' });
	});

	it('parses name with digits', () => {
		const result = parseQuillRef('quill2024');
		expect(result.name).toBe('quill2024');
		expect(result.selector).toBeUndefined();
	});
});

describe('parseQuillRef — invalid refs', () => {
	function expectInvalidRef(ref: string) {
		expect(() => parseQuillRef(ref), `expected "${ref}" to throw invalid_ref`).toThrow(QuiverError);
		try {
			parseQuillRef(ref);
		} catch (err) {
			expect(err).toBeInstanceOf(QuiverError);
			expect((err as QuiverError).code).toBe('invalid_ref');
		}
	}

	it('rejects empty string', () => expectInvalidRef(''));
	it('rejects bare @', () => expectInvalidRef('@'));
	it('rejects foo@ (missing selector)', () => expectInvalidRef('foo@'));
	it('rejects @1.0 (missing name)', () => expectInvalidRef('@1.0'));
	it('rejects showcase@1 (a major alone)', () => {
		for (const ref of ['showcase@1', 'showcase@0', 'borb.showcase@2']) {
			expect(() => parseQuillRef(ref), ref).toThrow(
				expect.objectContaining({
					code: 'invalid_ref',
					message: expect.stringContaining(`"${ref.split('@')[1]}"`)
				})
			);
		}
	});
	it('rejects foo@^1 (caret range)', () => expectInvalidRef('foo@^1'));
	it('rejects foo@~1 (tilde range)', () => expectInvalidRef('foo@~1'));
	it('rejects foo@>=1 (gte range)', () => expectInvalidRef('foo@>=1'));
	it('rejects foo@* (wildcard)', () => expectInvalidRef('foo@*'));
	it('rejects foo@1.2.3-beta (prerelease)', () => expectInvalidRef('foo@1.2.3-beta'));
	it('rejects foo@1.2.3+build (build metadata)', () => expectInvalidRef('foo@1.2.3+build'));
	it('rejects foo!bar (invalid name char)', () => expectInvalidRef('foo!bar'));
	it('rejects foo@1.2.3.4 (four-part selector)', () => expectInvalidRef('foo@1.2.3.4'));
	it('rejects a.b.c (two collections)', () => expectInvalidRef('a.b.c'));
	it('rejects .foo (empty collection)', () => expectInvalidRef('.foo'));
	it('rejects foo. (empty name)', () => expectInvalidRef('foo.'));
	it('rejects a-b (hyphen)', () => expectInvalidRef('a-b'));
	it('rejects MyQuill (uppercase)', () => expectInvalidRef('MyQuill'));
	it('rejects _memo (leading underscore)', () => expectInvalidRef('_memo'));
	it('rejects 2memo (leading digit)', () => expectInvalidRef('2memo'));
	it('rejects a name over 64 characters', () => expectInvalidRef('a'.repeat(65)));
	it('rejects foo@1.x (non-digit in selector)', () => expectInvalidRef('foo@1.x'));
});
