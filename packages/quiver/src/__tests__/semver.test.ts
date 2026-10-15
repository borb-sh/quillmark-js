import { describe, it, expect } from 'vitest';
import {
	isCanonicalSemver,
	matchesSemverSelector,
	compareSemver,
	isDraft,
	MIN_PUBLISHED_VERSION
} from '../semver.js';

describe('isCanonicalSemver', () => {
	it('accepts 1.0.0', () => expect(isCanonicalSemver('1.0.0')).toBe(true));
	it('accepts 0.0.0', () => expect(isCanonicalSemver('0.0.0')).toBe(true));
	it('accepts 10.20.30', () => expect(isCanonicalSemver('10.20.30')).toBe(true));
	it('accepts 0.0.1', () => expect(isCanonicalSemver('0.0.1')).toBe(true));

	it('rejects 1.0 (missing patch)', () => expect(isCanonicalSemver('1.0')).toBe(false));
	it('rejects 1.0.0-beta (prerelease)', () => expect(isCanonicalSemver('1.0.0-beta')).toBe(false));
	it('rejects v1.0.0 (v prefix)', () => expect(isCanonicalSemver('v1.0.0')).toBe(false));
	it('rejects 1.0.0.0 (four parts)', () => expect(isCanonicalSemver('1.0.0.0')).toBe(false));
	it('rejects empty string', () => expect(isCanonicalSemver('')).toBe(false));
	it('rejects 1.0.0+build (build metadata)', () =>
		expect(isCanonicalSemver('1.0.0+build')).toBe(false));
	it('rejects non-numeric parts', () => expect(isCanonicalSemver('1.x.0')).toBe(false));
	it('rejects 01.0.0 (leading zero in major)', () =>
		expect(isCanonicalSemver('01.0.0')).toBe(false));
	it('rejects 0.01.0 (leading zero in minor)', () =>
		expect(isCanonicalSemver('0.01.0')).toBe(false));
	it('rejects 0.0.01 (leading zero in patch)', () =>
		expect(isCanonicalSemver('0.0.01')).toBe(false));
	it('rejects 01.02.03 (leading zeros in all parts)', () =>
		expect(isCanonicalSemver('01.02.03')).toBe(false));
});

describe('matchesSemverSelector', () => {
	it('1.2.3 matches selector 1.2', () => expect(matchesSemverSelector('1.2.3', '1.2')).toBe(true));
	it('1.2.3 matches selector 1.2.3 (exact)', () =>
		expect(matchesSemverSelector('1.2.3', '1.2.3')).toBe(true));

	it('1.2.3 does not match selector 2.2', () =>
		expect(matchesSemverSelector('1.2.3', '2.2')).toBe(false));
	it('1.2.3 does not match selector 1.3', () =>
		expect(matchesSemverSelector('1.2.3', '1.3')).toBe(false));
	it('1.2.3 does not match selector 1.2.4', () =>
		expect(matchesSemverSelector('1.2.3', '1.2.4')).toBe(false));

	it('2.0.0 matches selector 2.0', () => expect(matchesSemverSelector('2.0.0', '2.0')).toBe(true));
	it('2.0.0 does not match selector 1.0', () =>
		expect(matchesSemverSelector('2.0.0', '1.0')).toBe(false));

	it('10.20.30 matches selector 10.20', () =>
		expect(matchesSemverSelector('10.20.30', '10.20')).toBe(true));
	it('10.20.30 does not match selector 10.21', () =>
		expect(matchesSemverSelector('10.20.30', '10.21')).toBe(false));
});

describe('compareSemver', () => {
	it('returns 0 for equal versions', () => expect(compareSemver('1.0.0', '1.0.0')).toBe(0));

	it('returns positive when a > b (major)', () =>
		expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0));
	it('returns negative when a < b (major)', () =>
		expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0));

	it('returns positive when a > b (minor)', () =>
		expect(compareSemver('1.2.0', '1.1.0')).toBeGreaterThan(0));
	it('returns negative when a < b (minor)', () =>
		expect(compareSemver('1.1.0', '1.2.0')).toBeLessThan(0));

	it('returns positive when a > b (patch)', () =>
		expect(compareSemver('1.0.2', '1.0.1')).toBeGreaterThan(0));
	it('returns negative when a < b (patch)', () =>
		expect(compareSemver('1.0.1', '1.0.2')).toBeLessThan(0));

	it('correctly ranks 10.0.0 > 9.0.0 (numeric not lexicographic)', () => {
		expect(compareSemver('10.0.0', '9.0.0')).toBeGreaterThan(0);
	});
});

describe('isDraft', () => {
	it('0.0.0 is a draft', () => expect(isDraft('0.0.0')).toBe(true));
	it('0.0.9 is a draft', () => expect(isDraft('0.0.9')).toBe(true));
	it('0.0.10 is a draft (numeric, not lexicographic)', () => expect(isDraft('0.0.10')).toBe(true));

	it('0.1.0 is the floor, not below it', () => expect(isDraft('0.1.0')).toBe(false));
	it('0.1.1 is published', () => expect(isDraft('0.1.1')).toBe(false));
	it('0.2.0 is published', () => expect(isDraft('0.2.0')).toBe(false));
	it('1.0.0 is published', () => expect(isDraft('1.0.0')).toBe(false));

	it('agrees with the exported floor', () => expect(isDraft(MIN_PUBLISHED_VERSION)).toBe(false));
});
