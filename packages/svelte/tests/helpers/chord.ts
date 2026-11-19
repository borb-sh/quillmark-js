/** The `KeyboardEventInit` of a binding in `prosemirror-keymap` notation, `Mod` as Ctrl: the
 *  suite runs off Apple's platforms. */
export function chordInit(binding: string): KeyboardEventInit & { key: string } {
	const parts = binding.split('-');
	const key = parts.pop()!;
	return {
		key,
		ctrlKey: parts.includes('Mod'),
		altKey: parts.includes('Alt'),
		shiftKey: parts.includes('Shift')
	};
}
