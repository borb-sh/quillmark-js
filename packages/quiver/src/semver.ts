/** The lowest version a build packs. Below it is the draft space. */
export const MIN_PUBLISHED_VERSION = '0.1.0';

/** Returns true for exactly `x.y.z` with non-negative integer parts. */
export function isCanonicalSemver(version: string): boolean {
	return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

/**
 * Returns true if `version` (canonical) matches `selector` (`x.y` or `x.y.z`).
 * `parseQuillRef` owns selector validation; this is a prefix comparison over an
 * already-valid selector.
 */
export function matchesSemverSelector(version: string, selector: string): boolean {
	const selectorParts = selector.split('.');
	const versionParts = version.split('.');
	if (selectorParts.length > versionParts.length) return false;
	for (let i = 0; i < selectorParts.length; i++) {
		if (selectorParts[i] !== versionParts[i]) return false;
	}
	return true;
}

/** Compares two canonical semver strings. Returns <0, 0, or >0. Three positions,
 *  because `isCanonicalSemver` gates every entry point that reaches here. */
export function compareSemver(a: string, b: string): number {
	const partsA = a.split('.').map(Number);
	const partsB = b.split('.').map(Number);

	for (let i = 0; i < 3; i++) {
		if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
	}

	return 0;
}

/** Returns true for a canonical version below `MIN_PUBLISHED_VERSION`. */
export function isDraft(version: string): boolean {
	return compareSemver(version, MIN_PUBLISHED_VERSION) < 0;
}
