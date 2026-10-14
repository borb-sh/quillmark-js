import { QuiverError } from './errors.js';

/** Internal parsed representation of a quill reference. */
export interface ParsedQuillRef {
	/** The collection the ref names, the part before a `.`; absent on a bare name. */
	collection?: string;
	name: string;
	/** Undefined selects the highest version present. */
	selector?: string;
}

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SELECTOR_RE = /^\d+(\.\d+){0,2}$/;

/**
 * Whether `name` is a quill name: `[a-z][a-z0-9_]*`, at most 64 characters, the
 * engine's rule. A quiver's own name and every catalog row are held to it.
 */
export function isQuillName(name: string): boolean {
	return NAME_RE.test(name);
}

/**
 * Throws QuiverError('invalid_ref') on malformed input. The name is a quill name,
 * optionally prefixed `<collection>.`; the selector is `x`, `x.y` or `x.y.z`,
 * digits only, with no ranges or operators — a quiver resolves a prefix, it does
 * not solve a range.
 */
export function parseQuillRef(ref: string): ParsedQuillRef {
	if (!ref) {
		throw new QuiverError('invalid_ref', `Invalid ref: empty string`, { ref });
	}

	const atIndex = ref.indexOf('@');

	if (atIndex === 0) {
		throw new QuiverError('invalid_ref', `Invalid ref: missing name in "${ref}"`, { ref });
	}

	// Split once: the charset the name is held to is one rule, and a ref with a selector
	// is under it exactly as a bare one is.
	const fullName = atIndex === -1 ? ref : ref.slice(0, atIndex);
	const selector = atIndex === -1 ? undefined : ref.slice(atIndex + 1);

	if (selector === '') {
		throw new QuiverError('invalid_ref', `Invalid ref: missing selector after "@" in "${ref}"`, {
			ref
		});
	}

	const dot = fullName.indexOf('.');
	const collection = dot === -1 ? undefined : fullName.slice(0, dot);
	const name = dot === -1 ? fullName : fullName.slice(dot + 1);

	for (const segment of collection === undefined ? [name] : [collection, name]) {
		if (!NAME_RE.test(segment)) {
			throw new QuiverError(
				'invalid_ref',
				`Invalid ref: name "${fullName}" is not [collection.]name, each [a-z][a-z0-9_]* and at most 64 characters`,
				{ ref }
			);
		}
	}

	const parsed: ParsedQuillRef = collection === undefined ? { name } : { collection, name };

	if (selector === undefined) {
		return parsed;
	}

	if (!SELECTOR_RE.test(selector)) {
		throw new QuiverError(
			'invalid_ref',
			`Invalid ref: selector "${selector}" is not a valid semver selector (only x, x.y, x.y.z with digits allowed)`,
			{ ref }
		);
	}

	return { ...parsed, selector };
}
