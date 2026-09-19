// Reading a rung off the surface, for the three places a script needs a number the
// scale owns: the arrival wash's dwell, the reorder trip's duration and curve, and the
// hold that keeps a pressed header in the fold. Here rather than beside any one of them
// because `core/bloom.ts` and `visual/motion.ts` both read, and a second copy of "which
// element carries the scale" is the drift no gate can see.

/**
 * The computed style a `--_qm-*` rung is read off: the surface root, else the node
 * itself for a component mounted outside one.
 *
 * The derivation mints every rung on `:where([data-qm-root])` and nowhere else
 * (`core/theme.css`), so a descendant's value is that one inherited: reading it at the
 * root is the same number, asked where it is declared rather than wherever the caller
 * happened to be standing. A leaf three containers deep is an arbitrary place to ask a
 * question about the surface.
 */
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
