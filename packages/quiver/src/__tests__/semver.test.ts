import { describe, it, expect } from 'vitest';
import {
	isCanonicalSemver,
	matchesSemverSelector,
	compareSemver,
	isDraft,
	MIN_PUBLISHED_VERSION
} from '../semver.js';

describe('isCanonicalSemver', () => {
	it.each(['1.0.0', '0.0.0', '10.20.30', '0.0.1'])('accepts %s', (v) =>
		expect(isCanonicalSemver(v)).toBe(true)
	);
	it.each([
		'1.0',
		'1.0.0-beta',
		'v1.0.0',
		'1.0.0.0',
		'',
		'1.0.0+build',
		'1.x.0',
		'01.0.0',
		'0.01.0',
		'0.0.01'
	])('rejects %j', (v) => expect(isCanonicalSemver(v)).toBe(false));
});

describe('matchesSemverSelector', () => {
	it.each([
		['1.2.3', '1.2', true],
		['1.2.3', '1.2.3', true],
		['10.20.30', '10.20', true],
		['1.2.3', '2.2', false],
		['1.2.3', '1.3', false],
		['1.2.3', '1.2.4', false],
		['10.20.30', '10.21', false]
	])('%s against %s is %s', (v, sel, want) => expect(matchesSemverSelector(v, sel)).toBe(want));
});

describe('compareSemver', () => {
	it('returns 0 for equal versions', () => expect(compareSemver('1.0.0', '1.0.0')).toBe(0));

	it.each([
		['2.0.0', '1.0.0'],
		['1.2.0', '1.1.0'],
		['1.0.2', '1.0.1'],
		['10.0.0', '9.0.0']
	])('%s outranks %s, numerically', (a, b) => {
		expect(compareSemver(a, b)).toBeGreaterThan(0);
		expect(compareSemver(b, a)).toBeLessThan(0);
	});
});

describe('isDraft', () => {
	it.each(['0.0.0', '0.0.9', '0.0.10'])('%s is a draft', (v) => expect(isDraft(v)).toBe(true));
	it.each(['0.1.0', '0.1.1', '1.0.0', MIN_PUBLISHED_VERSION])('%s is published', (v) =>
		expect(isDraft(v)).toBe(false)
	);
});
