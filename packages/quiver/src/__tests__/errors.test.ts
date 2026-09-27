import { describe, it, expect } from 'vitest';
import { QuiverError } from '../errors.js';
import type { QuiverErrorCode } from '../errors.js';

const allCodes: QuiverErrorCode[] = [
	'invalid_ref',
	'quill_not_found',
	'quiver_invalid',
	'transport_error'
];

describe('QuiverError', () => {
	it('is instanceof Error and QuiverError for each code', () => {
		for (const code of allCodes) {
			const err = new QuiverError(code, `test message for ${code}`);
			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(QuiverError);
			expect(err.code).toBe(code);
			expect(err.message).toBe(`test message for ${code}`);
		}
	});

	it('has name QuiverError', () => {
		const err = new QuiverError('invalid_ref', 'bad ref');
		expect(err.name).toBe('QuiverError');
	});

	it('preserves all payload fields together', () => {
		const cause = new Error('root');
		const err = new QuiverError('quiver_invalid', 'full payload', {
			ref: 'showcase@1.2.3',
			version: '1.2.3',
			quiverName: 'fixtures',
			cause
		});
		expect(err.ref).toBe('showcase@1.2.3');
		expect(err.version).toBe('1.2.3');
		expect(err.quiverName).toBe('fixtures');
		expect(err.cause).toBe(cause);
	});
});
