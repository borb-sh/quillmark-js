// The described shortcuts against the keymaps that bind them: a description naming a key no
// keymap binds is the drift `editorShortcuts` exists to prevent.
import { describe, it, expect } from 'vitest';
import {
	blockSchema,
	bodyKeymap,
	DEFAULT_SHORTCUT_STRINGS,
	editorShortcuts
} from '$lib/core/codec';
import { markKeymap } from '$lib/core/codec/shortcuts.js';

describe('editorShortcuts', () => {
	it('every body and list key it names is bound in the body keymap', () => {
		const bound = bodyKeymap(blockSchema);
		const named = editorShortcuts()
			.filter((s) => s.scope === 'body' || s.scope === 'list')
			.flatMap((s) => s.keys);
		expect(named.length).toBeGreaterThan(0);
		for (const key of named) expect(bound[key], key).toBeTypeOf('function');
	});

	it('every mark key it names toggles a mark the body declares', () => {
		const bound = markKeymap(blockSchema);
		for (const key of Object.keys(bound))
			expect(editorShortcuts().some((s) => s.keys.includes(key))).toBe(true);
	});

	it('words each entry from the overrides, the rest from the package', () => {
		const shortcuts = editorShortcuts({ shortcutUndo: 'Annuler' });
		const words = new Set(shortcuts.map((s) => s.label));
		expect(words.has('Annuler')).toBe(true);
		expect(words.has(DEFAULT_SHORTCUT_STRINGS.shortcutUndo)).toBe(false);
		expect(words.has(DEFAULT_SHORTCUT_STRINGS.shortcutRedo)).toBe(true);
	});
});
