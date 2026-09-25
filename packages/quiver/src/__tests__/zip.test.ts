import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { packFiles, unpackFiles } from '../zip.js';
import { QuiverError } from '../errors.js';
import { declaring } from './helpers/zip.js';

const enc = new TextEncoder();

const MIB = 1024 * 1024;

/** A zip `packFiles` would refuse, minted past it so the read side can be asked. */
function zipOf(files: Record<string, Uint8Array>): Uint8Array {
	return zipSync(files, { level: 1 });
}

describe('packFiles / unpackFiles', () => {
	it('roundtrips a single file', () => {
		const input = { 'a.txt': enc.encode('hello') };
		const zipped = packFiles(input);
		const output = unpackFiles(zipped).files;
		expect(output['a.txt']).toEqual(enc.encode('hello'));
	});

	it('roundtrips multiple files', () => {
		const input = {
			'a.txt': enc.encode('hello'),
			'b.txt': enc.encode('world')
		};
		const zipped = packFiles(input);
		const output = unpackFiles(zipped).files;
		expect(output['a.txt']).toEqual(enc.encode('hello'));
		expect(output['b.txt']).toEqual(enc.encode('world'));
		expect(Object.keys(output).sort()).toEqual(['a.txt', 'b.txt']);
	});

	it('roundtrips binary / Uint8Array content faithfully', () => {
		const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
		const input = { 'binary.bin': bytes };
		const output = unpackFiles(packFiles(input)).files;
		expect(output['binary.bin']).toEqual(bytes);
	});
});

describe('the artifact budget', () => {
	it('refuses a zip that inflates past the total, without inflating it', () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 9; i++) files[`f${i}`] = enc.encode('x');
		// Nine entries at 30 MiB apiece: each under the per-file ceiling, together over the
		// total. Refused off the directory, so nothing is allocated to find out.
		const zipped = declaring(zipOf(files), 30 * MIB);

		expect(() => unpackFiles(zipped)).toThrow(
			expect.objectContaining({
				code: 'quiver_invalid',
				message: expect.stringContaining('unpacks to over')
			})
		);
	});

	it('refuses one entry over the per-file ceiling, naming it', () => {
		const zipped = declaring(zipOf({ 'fat.bin': enc.encode('x') }), 33 * MIB);
		expect(() => unpackFiles(zipped)).toThrow(/"fat\.bin" is \d+ bytes/);
	});

	it('refuses more entries than the count allows', () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i <= 16384; i++) files[`f${i}`] = enc.encode('x');
		expect(() => unpackFiles(zipOf(files))).toThrow(/over 16384 files/);
	});

	it('is spent at the pack too, so no build writes what no read would take', () => {
		// Spent before a byte is compressed, so the nine share one buffer and cost nothing.
		const zeros = new Uint8Array(30 * MIB);
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 9; i++) files[`f${i}`] = zeros;
		expect(() => packFiles(files)).toThrow(QuiverError);
	});
});

describe('unpackFiles — what is kept', () => {
	it('names every entry and inflates only those kept', () => {
		const zipped = packFiles({ 'a.txt': enc.encode('a'), 'b.txt': enc.encode('b') });
		const { names, files } = unpackFiles(zipped, (name) => name === 'b.txt');
		expect(names.sort()).toEqual(['a.txt', 'b.txt']);
		expect(Object.keys(files)).toEqual(['b.txt']);
	});

	it('refuses bytes that are no zip as quiver_invalid', () => {
		expect(() => unpackFiles(enc.encode('not a zip'))).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});
});

describe('packFiles determinism', () => {
	it('packing the same record twice yields byte-identical output', () => {
		const input = {
			'a.txt': enc.encode('hello'),
			'b.txt': enc.encode('world')
		};
		const zip1 = packFiles(input);
		const zip2 = packFiles(input);
		expect(zip1).toEqual(zip2);
	});

	it('packing with swapped insertion order yields the same output (keys are sorted)', () => {
		const inputAB = {
			'a.txt': enc.encode('hello'),
			'b.txt': enc.encode('world')
		};
		const inputBA = {
			'b.txt': enc.encode('world'),
			'a.txt': enc.encode('hello')
		};
		const zip1 = packFiles(inputAB);
		const zip2 = packFiles(inputBA);
		expect(zip1).toEqual(zip2);
	});

	it('different content produces different output', () => {
		const input1 = { 'file.txt': enc.encode('hello') };
		const input2 = { 'file.txt': enc.encode('goodbye') };
		expect(packFiles(input1)).not.toEqual(packFiles(input2));
	});

	it('empty record packs and roundtrips', () => {
		const zipped = packFiles({});
		const output = unpackFiles(zipped).files;
		expect(Object.keys(output)).toHaveLength(0);
	});

	it('produces TZ-independent mtime bytes in zip header', () => {
		// fflate reads mtime via local-time getters. We anchor ZIP_EPOCH with the
		// local-time Date constructor so its components are 1980-01-01 00:00:00 in
		// every timezone. DOS encoding: time = 0x0000, date = 0x0021.
		const zipped = packFiles({ 'file.txt': enc.encode('x') });
		// Locate the local file header signature (PK\x03\x04 = 0x04034b50 little-endian).
		const sig = [0x50, 0x4b, 0x03, 0x04];
		let headerOffset = -1;
		for (let i = 0; i <= zipped.length - sig.length; i++) {
			if (sig.every((b, j) => zipped[i + j] === b)) {
				headerOffset = i;
				break;
			}
		}
		expect(headerOffset).toBeGreaterThanOrEqual(0);
		// Bytes 10–11 = last-mod time (DOS time), bytes 12–13 = last-mod date (DOS date).
		const dosTime = (zipped[headerOffset + 11]! << 8) | zipped[headerOffset + 10]!;
		const dosDate = (zipped[headerOffset + 13]! << 8) | zipped[headerOffset + 12]!;
		// 1980-01-01 00:00:00 → DOS time = 0x0000, DOS date = 0x0021.
		expect(dosTime).toBe(0x0000);
		expect(dosDate).toBe(0x0021);
	});
});
