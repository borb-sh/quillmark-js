/**
 * `zip`, with every central-directory entry declaring `size` uncompressed bytes. The
 * budget reads what the directory declares, so a small zip claiming much is how a test
 * reaches a ceiling without packing what would trip it.
 */
export function declaring(zip: Uint8Array, size: number): Uint8Array {
	const out = zip.slice();
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	for (let at = 0; at + 46 <= out.length; at++) {
		// A central file header, `PK\x01\x02`; its uncompressed size sits 24 bytes in.
		if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, size, true);
	}
	return out;
}
