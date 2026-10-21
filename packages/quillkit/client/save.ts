// The one thing on this client that leaves the tab: bytes, named, handed to the browser.
// Both doors onto the document end here — its source as markdown, and the file it renders
// to (STUDIO §"The document has doors").

/**
 * Hand `content` to the browser as a download named `name`.
 *
 * The object URL is revoked on the same turn: `click` dispatches synchronously, and the
 * browser has taken the URL by the time it returns.
 */
export function save(content: string | Uint8Array, name: string, type: string): void {
	// Rendered bytes cross the wasm boundary as `Uint8Array<ArrayBufferLike>`, where
	// `BlobPart` takes an `ArrayBuffer`-backed view alone; the engine's memory is one.
	const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
