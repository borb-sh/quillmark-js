// Where a script reads the scale. The derivation declares every `--_qm-*` rung on `[data-qm-root]`
// and nowhere else (`core/theme.css`), so the root is the element to ask. Resolving off the root
// also costs less: `getComputedStyle` compounds with nesting depth under jsdom.

/**
 * The style of the element the scale is declared on for `node`: its root, or `node` where it stands
 * outside one.
 */
export function rungStyle(node: Element): CSSStyleDeclaration {
	return getComputedStyle(node.closest('[data-qm-root]') ?? node);
}

/**
 * A duration rung off `style`, in ms; `undefined` where the derivation is out of reach (an unstyled
 * root, or jsdom). No rung, no motion: a fallback would restate the scale where `check:style`
 * cannot read it.
 */
export function rungMs(style: CSSStyleDeclaration, rung: string): number | undefined {
	const raw = style.getPropertyValue(rung).trim();
	const n = Number.parseFloat(raw);
	if (!Number.isFinite(n)) return undefined;
	return raw.endsWith('ms') ? n : n * 1000;
}

/**
 * `steps` of the space rung off `node`'s root, in px: a floating surface's offset from its anchor.
 * `--_qm-space` is registered so it computes to px, unlike the rungs derived from it. `undefined`
 * where the derivation is out of reach, as for {@link rungMs}.
 */
export function spacePx(node: Element | undefined, steps = 1): number | undefined {
	if (!node) return undefined;
	const n = Number.parseFloat(rungStyle(node).getPropertyValue('--_qm-space'));
	return Number.isFinite(n) ? n * steps : undefined;
}
