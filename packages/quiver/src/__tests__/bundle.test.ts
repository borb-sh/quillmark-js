import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { packFiles } from '../bundle.js';
import { QuiverError } from '../errors.js';

const enc = new TextEncoder();

const MIB = 1024 * 1024;

describe('packFiles', () => {
	it('packs every file, byte for byte', () => {
		const input = {
			'a.txt': enc.encode('hello'),
			'binary.bin': new Uint8Array([0, 1, 2, 255, 128, 64])
		};
		expect(unzipSync(packFiles(input))).toEqual(input);
	});

	it('spends the format budget, so no build writes what no read would take', () => {
		const zeros = new Uint8Array(15 * MIB);
		expect(() => packFiles({ a: zeros, b: zeros, c: zeros, d: zeros, e: zeros })).toThrow(
			QuiverError
		);
	});

	it.each(['../Quill.yaml', '/Quill.yaml', 'assets\\logo.svg', 'C:/plate.typ', 'assets//logo.svg'])(
		'refuses the entry name %s',
		(name) => {
			const files = { 'Quill.yaml': enc.encode('x'), [name]: enc.encode('y') };
			expect(() => packFiles(files)).toThrow(expect.objectContaining({ code: 'quiver_invalid' }));
		}
	);
});

describe('packFiles determinism', () => {
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
