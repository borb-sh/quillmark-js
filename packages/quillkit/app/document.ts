// A document landed in a quill: read as markdown, pinned to the canonical ref it opens in,
// and conformed against that quill's schema. A reopen and an update to the latest form
// both come through here, so what either strands is named the same way.
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
