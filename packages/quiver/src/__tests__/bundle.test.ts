import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import { packFiles, unpackFiles } from '../bundle.js';
import { QuiverError } from '../errors.js';

const enc = new TextEncoder();

const MIB = 1024 * 1024;

/** A zip `packFiles` would refuse, minted past it so the read side can be asked. */
function zipOf(files: Record<string, Uint8Array>): Uint8Array {
	return zipSync(files, { level: 1 });
}

/**
 * `names` zipped one byte each, every central-directory record then declaring `size`:
 * the header a bomb carries, without the seconds a real one takes to deflate.
 */
function declaring(size: number, ...names: string[]): Uint8Array {
	const zip = zipOf(Object.fromEntries(names.map((name) => [name, enc.encode('x')])));
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	for (let at = 0; at + 4 <= zip.length; at++)
		if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, size, true);
	return zip;
}

describe('packFiles / unpackFiles', () => {
	it('roundtrips every file, byte for byte', () => {
		const input = {
			'a.txt': enc.encode('hello'),
			'binary.bin': new Uint8Array([0, 1, 2, 255, 128, 64])
		};
		expect(unpackFiles(packFiles(input))).toEqual(input);
	});
});

describe('the bundle budget', () => {
	it('refuses a zip that declares past the total, without inflating it', () => {
		// Refused off the central directory: inflated, each entry would come back one byte
		// and the total would never be reached.
		expect(() => unpackFiles(declaring(15 * MIB, 'a', 'b', 'c', 'd', 'e'))).toThrow(
			expect.objectContaining({
				code: 'quiver_invalid',
				message: expect.stringContaining('unpacks to over')
			})
		);
	});

	it('refuses one entry over the per-file ceiling, naming it', () => {
		expect(() => unpackFiles(declaring(17 * MIB, 'fat.bin'))).toThrow(/"fat\.bin" is \d+ bytes/);
	});

	it('refuses more entries than the count allows', () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i <= 2048; i++) files[`f${i}`] = enc.encode('x');
		expect(() => unpackFiles(zipOf(files))).toThrow(/over 2048 files/);
	});

	it('is spent at the pack too, so no build writes what no read would take', () => {
		const zeros = new Uint8Array(15 * MIB);
		expect(() => packFiles({ a: zeros, b: zeros, c: zeros, d: zeros, e: zeros })).toThrow(
			QuiverError
		);
	});
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

	it('empty record packs and roundtrips', () => {
		const zipped = packFiles({});
		const output = unpackFiles(zipped);
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
