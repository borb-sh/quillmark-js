// @vitest-environment jsdom
// The vendored glyph set. What is worth holding is the renderer against its own
// table rather than any number in the frame: a doctrine value asserted here is a
// second place it lives, and the stroke and the viewBox are the component's.
//
// So the set is walked and each render compared to the entry that produced it — the
// one failure mode a copied table has is an entry the renderer cannot draw — plus the
// two things a call site depends on and neither TypeScript nor a render of one icon
// would catch: `class` reaching the `<svg>`, which is what the card's open/closed
// rotation hangs off, and decorative-by-default, which is what keeps thirteen glyphs
// out of the a11y tree inside buttons that already carry the name.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, type ComponentProps } from 'svelte';
import Icon from '$lib/visual/icons/Icon.svelte';
import { ICONS, type IconName } from '$lib/visual/icons/nodes.js';

const mounted: Record<string, unknown>[] = [];
afterEach(() => {
	for (const c of mounted.splice(0)) unmount(c);
});

/** Mount one glyph and hand back the `<svg>` it drew. */
function draw(props: ComponentProps<typeof Icon>): SVGSVGElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mounted.push(mount(Icon, { target, props }));
	return target.querySelector('svg')!;
}

const NAMES = Object.keys(ICONS) as IconName[];

describe('Icon', () => {
	it('draws every name in the set as the table spells it', () => {
		// Every entry, against its own row: the child elements in order, by tag and by
		// the attributes the row sets. An entry the renderer drops or reorders fails
		// here whatever the geometry says.
		for (const name of NAMES) {
			const svg = draw({ name });
			const nodes = ICONS[name];
			expect(
				[...svg.children].map((el) => [
					el.tagName,
					Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]))
				]),
				name
			).toEqual(nodes.map(([tag, attrs]) => [tag, { ...attrs }]));
		}
	});

	it('sizes the frame, and defaults to a square the card controls override in CSS', () => {
		const sized = draw({ name: 'x', size: 14 });
		expect([sized.getAttribute('width'), sized.getAttribute('height')]).toEqual(['14', '14']);

		const bare = draw({ name: 'x' });
		expect(bare.getAttribute('width')).toBeTruthy();
		expect(bare.getAttribute('height')).toBe(bare.getAttribute('width'));
	});

	it('forwards `class` to the svg', () => {
		expect(draw({ name: 'chevron-right', class: 'qm-group-chevron' }).getAttribute('class')).toBe(
			'qm-group-chevron'
		);
	});

	it('hides itself from the a11y tree unless the call site says otherwise', () => {
		expect(draw({ name: 'info' }).getAttribute('aria-hidden')).toBe('true');
		expect(draw({ name: 'info', 'aria-hidden': 'false' }).getAttribute('aria-hidden')).toBe(
			'false'
		);
	});
});
