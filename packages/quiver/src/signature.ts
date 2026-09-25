/**
 * The leading bytes of what an artifact holds. A host answering a missing name with a
 * page of its own answers 200, and nothing else read here tells that page from a font.
 */
const FONT = ['\0\x01\0\0', 'OTTO', 'true', 'ttcf', 'wOFF', 'wOF2'];

const opens = (bytes: Uint8Array, magic: string): boolean =>
	bytes.length >= magic.length && [...magic].every((c, i) => bytes[i] === c.charCodeAt(0));

/** TrueType, OpenType, a collection of either, WOFF or WOFF2. */
export const isFont = (bytes: Uint8Array): boolean => FONT.some((magic) => opens(bytes, magic));

export const isZip = (bytes: Uint8Array): boolean => opens(bytes, 'PK\x03\x04');
