// The guidance key: `Mod-/` on a control raises the description that control carries,
// the keyboard's way in to a `FieldHint` whose glyph is out of the tab order.

/** `Mod-/`, read off `key` so a layout that shifts to reach `/` still matches; either
 *  modifier stands for `Mod`. */
export function isGuidanceKey(e: KeyboardEvent): boolean {
	return e.key === '/' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing;
}

/**
 * The guidance trigger for the description nearest `from`: the innermost element
 * carrying `aria-describedby` whose ids name a parked description with a trigger
 * beside it. A trigger points at its own parked node through that same attribute,
 * which is the relation read here; ids that are not a description (an array's count,
 * a prose leaf's note) are skipped, and an undescribed property falls through to the
 * group around it.
 */
export function guidanceTrigger(from: Element, root: Element): HTMLElement | undefined {
	for (let el = from.closest('[aria-describedby]'); el;) {
		for (const id of el.getAttribute('aria-describedby')!.split(/\s+/)) {
			const trigger = root.querySelector<HTMLElement>(`.qm-field-hint[aria-describedby="${id}"]`);
			if (trigger) return trigger;
		}
		el = el.parentElement?.closest('[aria-describedby]') ?? null;
	}
	return undefined;
}

/** Root keydown: the key raises (or lowers) the nearest guidance. A trigger's `click()`
 *  is an activation with no pointer behind it, which `FieldHint` toggles on. */
export function raiseGuidance(e: KeyboardEvent): void {
	if (!isGuidanceKey(e) || !(e.target instanceof Element)) return;
	const trigger = guidanceTrigger(e.target, e.currentTarget as Element);
	if (!trigger) return;
	e.preventDefault();
	trigger.click();
}
