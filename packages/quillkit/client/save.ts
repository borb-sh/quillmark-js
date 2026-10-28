// Both doors out of the document end here (STUDIO §"The document has doors").

/** Hand `content` to the browser as a download named `name`. `click` dispatches
 *  synchronously, so the URL is revoked on the same turn. */
export function save(content: string | Uint8Array, name: string, type: string): void {
	// `BlobPart` takes an `ArrayBuffer`-backed view; wasm output is one.
	const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}
