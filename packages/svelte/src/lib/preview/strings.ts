// Every word the preview says: the surface is a canvas, and its only prose is the
// message states that stand in when there is nothing to paint.
//
// Separate from the visual surface's set rather than pooled with it: `/preview`
// reaches `/core` and nothing editor-side, which is what lets it promote to its own
// package, and a shared strings module would be an edge back across that line. The
// shape is the same, so a consumer wording both writes the same kind of object
// twice rather than learning two idioms.
//
// A plain options field rather than a context channel, unlike the visual surface's:
// they are read in one module by one function, so there is no tree to make them
// ambient for.

export interface PreviewStrings {
	/** A page the backend refused to raster. */
	renderFailed: string;
	/** A compile with zero pages: recoverable, and the commonest state of a fresh seed. */
	noPages: string;
}

/** The package's English. Every key, so the merge below is total. */
export const DEFAULT_PREVIEW_STRINGS: PreviewStrings = {
	renderFailed: 'Preview failed to render.',
	noPages: 'No pages to preview.'
};

/** A consumer's wording: any subset, the rest the package's. */
export type PreviewStringsInput = Partial<PreviewStrings>;

/** Fill a partial override to the whole key set. */
export function mergePreviewStrings(custom: PreviewStringsInput | undefined): PreviewStrings {
	return custom ? { ...DEFAULT_PREVIEW_STRINGS, ...custom } : DEFAULT_PREVIEW_STRINGS;
}
