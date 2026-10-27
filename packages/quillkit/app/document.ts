// A document landed in a quill: read as markdown, pinned to the canonical ref it opens in,
// and conformed against that quill's schema. One door for a record reopened, a retired
// document moved to the latest form, and nothing else, so what an update strands is named
// the way a reopen's would be.
import type { CoreSurface, Diagnostic, Document, Quill } from '@quillmark/wasm';

export function land(
	core: CoreSurface,
	quill: Quill,
	ref: string,
	markdown: string
): { doc: Document; stranded: Diagnostic[] } {
	const doc = core.Document.fromMarkdown(markdown);
	try {
		if (doc.quillRef !== ref) doc.setQuillRef(ref);
		return { doc, stranded: quill.conform(doc) };
	} catch (err) {
		doc.free();
		throw err;
	}
}
