// The chrome's glyph geometry, as the element tuples an `<svg>` carries: a tag and
// its attributes, against the 24×24 frame `Icon.svelte` draws. Every glyph the
// Svelte chrome shows is here; `core/codec/table-view.ts` holds its own set, that
// being the one place chrome is built without Svelte.
//
// Verbatim from lucide 1.28.0 — the version is stated because a glyph that drifts
// from upstream is otherwise invisible, and because the notices in `NOTICE` are the
// ones that release carries (ISC, and MIT for the Feather-derived ten).

/** One `<svg>` child: the element to make, and the attributes to set on it. */
export type IconNode = readonly (readonly [string, Record<string, string>])[];

export const ICONS = {
	'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
	'arrow-right': [
		['path', { d: 'M5 12h14' }],
		['path', { d: 'm12 5 7 7-7 7' }]
	],
	'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
	'chevron-up': [['path', { d: 'm18 15-6-6-6 6' }]],
	bold: [['path', { d: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8' }]],
	italic: [
		['line', { x1: '19', x2: '10', y1: '4', y2: '4' }],
		['line', { x1: '14', x2: '5', y1: '20', y2: '20' }],
		['line', { x1: '15', x2: '9', y1: '4', y2: '20' }]
	],
	underline: [
		['path', { d: 'M6 4v6a6 6 0 0 0 12 0V4' }],
		['line', { x1: '4', x2: '20', y1: '20', y2: '20' }]
	],
	strikethrough: [
		['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4' }],
		['path', { d: 'M14 12a4 4 0 0 1 0 8H6' }],
		['line', { x1: '4', x2: '20', y1: '12', y2: '12' }]
	],
	code: [
		['path', { d: 'm16 18 6-6-6-6' }],
		['path', { d: 'm8 6-6 6 6 6' }]
	],
	link: [
		['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
		['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
	],
	hash: [
		['line', { x1: '4', x2: '20', y1: '9', y2: '9' }],
		['line', { x1: '4', x2: '20', y1: '15', y2: '15' }],
		['line', { x1: '10', x2: '8', y1: '3', y2: '21' }],
		['line', { x1: '16', x2: '14', y1: '3', y2: '21' }]
	],
	info: [
		['circle', { cx: '12', cy: '12', r: '10' }],
		['path', { d: 'M12 16v-4' }],
		['path', { d: 'M12 8h.01' }]
	],
	plus: [
		['path', { d: 'M5 12h14' }],
		['path', { d: 'M12 5v14' }]
	],
	x: [
		['path', { d: 'M18 6 6 18' }],
		['path', { d: 'm6 6 12 12' }]
	],
	'trash-2': [
		['path', { d: 'M10 11v6' }],
		['path', { d: 'M14 11v6' }],
		['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
		['path', { d: 'M3 6h18' }],
		['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
	],
	minus: [['path', { d: 'M5 12h14' }]],
	check: [['path', { d: 'M20 6 9 17l-5-5' }]]
} as const satisfies Record<string, IconNode>;

/** The closed set. A name that is not here is a compile error at the call site,
 *  which is what a string key buys over thirteen imported components. */
export type IconName = keyof typeof ICONS;
