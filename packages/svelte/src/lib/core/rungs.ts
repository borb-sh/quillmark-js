// Where a script reads the scale. The derivation declares every `--_qm-*` rung on
// `[data-qm-root]` and nowhere else (`core/theme.css`), so a descendant's value is that
// one inherited and the root is the element the question is about: asking a leaf three
// containers deep is asking an arbitrary element what the surface is set to.
//
// The read is also the cost. `getComputedStyle` compounds with nesting depth under jsdom,
// so a suite that resolves rungs off landed elements pays the depth of whatever it landed
// on; resolving them off the root pays the root's.

/** The element the scale is declared on, for `node`: its root, or `node` where it stands
 *  outside one (a detached surface, a consumer's own mount). */
export function rungStyle(node: Element): CSSStyleDeclaration {
	return getComputedStyle(node.closest('[data-qm-root]') ?? node);
}

/** A duration rung off `style`, in ms; `undefined` where the derivation is out of reach
 *  (an unstyled root, or jsdom, where `getComputedStyle` reports custom properties as
 *  empty). No rung, no motion: a fallback here would be the scale restated in the one
 *  place `check:style` cannot read. */
export function rungMs(style: CSSStyleDeclaration, rung: string): number | undefined {
	const raw = style.getPropertyValue(rung).trim();
	const n = Number.parseFloat(raw);
	if (!Number.isFinite(n)) return undefined;
	return raw.endsWith('ms') ? n : n * 1000;
}

/** `steps` of the space rung off `node`'s root, in px: a floating surface's offset from
 *  its anchor. `--_qm-space` is registered, so it computes to px where the rungs derived
 *  from it compute to their expressions; hence the multiple rather than a read of
 *  `--_qm-space-2`. `undefined` where the derivation is out of reach, as for
 *  {@link rungMs}. */
export function spacePx(node: Element | undefined, steps = 1): number | undefined {
	if (!node) return undefined;
	const n = Number.parseFloat(rungStyle(node).getPropertyValue('--_qm-space'));
	return Number.isFinite(n) ? n * steps : undefined;
}
