// Separate from the visual surface's strings: `/preview` reaches `/core` and nothing editor-side.

export interface PreviewStrings {
	/** A page the backend refused to raster. */
	renderFailed: string;
	/** A compile with zero pages: recoverable, and the commonest state of a fresh seed. */
	noPages: string;
	/** What a screen reader hears when pages stand again after it heard either of the two. */
	restored: string;
	/** The zoom pill's action, after the percentage it shows. */
	resetZoom: string;
	/** The pane's accessible name, where the container carries none of its own. */
	previewLabel: string;
	/** A page's text alternative, 1-based: the canvas is pixels to a screen reader. */
	pageLabel: (page: number, count: number) => string;
}

/** The package's English. */
export const DEFAULT_PREVIEW_STRINGS: PreviewStrings = {
	renderFailed: 'Preview failed to render.',
	noPages: 'No pages to preview.',
	restored: 'Preview restored.',
	resetZoom: 'reset zoom',
	previewLabel: 'Document preview',
	pageLabel: (page, count) => `Page ${page} of ${count}`
};

/** A consumer's wording: any subset, the rest the package's. */
export type PreviewStringsInput = Partial<PreviewStrings>;

/** Fill a partial override to the whole key set. */
export function mergePreviewStrings(custom: PreviewStringsInput | undefined): PreviewStrings {
	return custom ? { ...DEFAULT_PREVIEW_STRINGS, ...custom } : DEFAULT_PREVIEW_STRINGS;
}
