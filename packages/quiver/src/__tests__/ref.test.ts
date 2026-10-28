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

	it('names the selector when a major stands alone', () => {
		for (const ref of ['showcase@1', 'showcase@0', 'borb.showcase@2']) {
			expect(() => parseQuillRef(ref), ref).toThrow(
				expect.objectContaining({
					code: 'invalid_ref',
					message: expect.stringContaining(`"${ref.split('@')[1]}"`)
				})
			);
		}
	});
	it.each([
		'',
		'@',
		'foo@',
		'@1.0',
		'foo@^1',
		'foo@~1',
		'foo@>=1',
		'foo@*',
		'foo@1.2.3-beta',
		'foo@1.2.3+build',
		'foo!bar',
		'foo@1.2.3.4',
		'a.b.c',
		'.foo',
		'foo.',
		'a-b',
		'MyQuill',
		'_memo',
		'2memo',
		'a'.repeat(65),
		'foo@1.x'
	])('rejects %j', (ref) => expectInvalidRef(ref));
});
