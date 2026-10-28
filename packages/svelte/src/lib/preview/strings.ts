// Separate from the visual surface's strings: `/preview` reaches `/core` and nothing editor-side.

export interface PreviewStrings {
	/** A page the backend refused to raster. */
	renderFailed: string;
	/** A compile with zero pages: recoverable, and the commonest state of a fresh seed. */
	noPages: string;
	/** The zoom pill's action, after the percentage it shows. */
	resetZoom: string;
}

/** The package's English. */
export const DEFAULT_PREVIEW_STRINGS: PreviewStrings = {
	renderFailed: 'Preview failed to render.',
	noPages: 'No pages to preview.',
	resetZoom: 'reset zoom'
};

/** A consumer's wording: any subset, the rest the package's. */
export type PreviewStringsInput = Partial<PreviewStrings>;

/** Fill a partial override to the whole key set. */
export function mergePreviewStrings(custom: PreviewStringsInput | undefined): PreviewStrings {
	return custom ? { ...DEFAULT_PREVIEW_STRINGS, ...custom } : DEFAULT_PREVIEW_STRINGS;
}
