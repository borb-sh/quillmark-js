// Hand-written typings for `browser.mjs`, which quillkit's suite imports from TypeScript.
// Signatures only: the prose is the script's, and a second copy of it here would drift
// against the one a reader of the implementation sees.

export interface Viewport {
	width: number;
	height: number;
}

export function chrome(): string;
export function load<T>(url: string, expression: string, viewport: Viewport): Promise<T>;
