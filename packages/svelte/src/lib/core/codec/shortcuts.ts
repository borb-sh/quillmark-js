// The chords the prose leaf binds, named once: every keymap that binds one of these reads
// its key from here, and `editorShortcuts` describes them from the same tables, so a rebinding
// is one edit that moves the binding and the host's shortcut list together.
//
// A key a surface takes only to decline, hold or pass on (Backspace at a block edge, the
// body's Tab hold, a code fence's Tab) is not a shortcut a writer looks up, and stays a
// literal in its keymap.
import { toggleMark } from 'prosemirror-commands';
import type { Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

/** Every prose leaf, a table cell included: history and the marks. `link` binds in the
 *  formatting popover, which is the surface that prompts for the URL. */
export const FIELD_KEYS = {
	undo: 'Mod-z',
	redo: 'Mod-Shift-z',
	redoAlt: 'Mod-y',
	bold: 'Mod-b',
	italic: 'Mod-i',
	underline: 'Mod-u',
	strike: 'Mod-Shift-x',
	code: 'Mod-e',
	link: 'Mod-k'
} as const;

/** A multi-block body, outside any surface nested in it. */
export const BODY_KEYS = {
	lineBreak: 'Shift-Enter',
	leave: 'Escape'
} as const;

/** A list item (`lists.ts`, `list-move.ts`). */
export const LIST_KEYS = {
	numbered: 'Mod-Shift-7',
	bulleted: 'Mod-Shift-8',
	indent: 'Tab',
	outdent: 'Shift-Tab',
	task: 'Mod-Enter',
	moveUp: 'Alt-ArrowUp',
	moveDown: 'Alt-ArrowDown'
} as const;

/** A table island's cell (`table-view.ts`). */
export const TABLE_KEYS = {
	next: 'Tab',
	previous: 'Shift-Tab',
	nextRow: 'Enter',
	select: 'Escape',
	selectAll: 'Mod-a',
	moveUp: 'Alt-ArrowUp',
	moveDown: 'Alt-ArrowDown',
	moveLeft: 'Alt-ArrowLeft',
	moveRight: 'Alt-ArrowRight',
	alignLeft: 'Shift-ArrowLeft',
	alignRight: 'Shift-ArrowRight',
	erase: 'Backspace',
	eraseAlt: 'Delete'
} as const;

/** The mark toggles, each bound only where the schema declares its mark. */
export function markKeymap(schema: Schema): Record<string, Command> {
	const map: Record<string, Command> = {};
	if (schema.marks.strong) map[FIELD_KEYS.bold] = toggleMark(schema.marks.strong);
	if (schema.marks.em) map[FIELD_KEYS.italic] = toggleMark(schema.marks.em);
	if (schema.marks.underline) map[FIELD_KEYS.underline] = toggleMark(schema.marks.underline);
	if (schema.marks.strike) map[FIELD_KEYS.strike] = toggleMark(schema.marks.strike);
	if (schema.marks.code) map[FIELD_KEYS.code] = toggleMark(schema.marks.code);
	return map;
}

/** Where a shortcut answers: any prose field, a multi-block body, a list item, a table cell. */
export type ShortcutScope = 'field' | 'body' | 'list' | 'table';

/** One shortcut as a host lists it. `keys` are the alternatives in `prosemirror-keymap`
 *  notation (`Mod-Shift-7`, `Alt-ArrowUp`): `Mod` is ⌘ on Apple platforms and Ctrl
 *  elsewhere, and the host prints them. */
export interface EditorShortcut {
	keys: readonly string[];
	label: string;
	scope: ShortcutScope;
}

/** A shortcut's description, the gesture it names: a list's line, not a tooltip. */
export interface ShortcutStrings {
	shortcutUndo: string;
	shortcutRedo: string;
	shortcutBold: string;
	shortcutItalic: string;
	shortcutUnderline: string;
	shortcutStrikethrough: string;
	shortcutCode: string;
	shortcutLink: string;
	shortcutLineBreak: string;
	shortcutLeave: string;
	shortcutNumberedList: string;
	shortcutBulletedList: string;
	shortcutIndent: string;
	shortcutOutdent: string;
	shortcutTask: string;
	shortcutMoveItem: string;
	shortcutNextCell: string;
	shortcutPreviousCell: string;
	shortcutNextRow: string;
	shortcutSelectCells: string;
	shortcutSelectRow: string;
	shortcutMoveLine: string;
	shortcutAlignColumn: string;
	shortcutDeleteCells: string;
}

export const DEFAULT_SHORTCUT_STRINGS: ShortcutStrings = {
	shortcutUndo: 'Undo',
	shortcutRedo: 'Redo',
	shortcutBold: 'Bold',
	shortcutItalic: 'Italic',
	shortcutUnderline: 'Underline',
	shortcutStrikethrough: 'Strikethrough',
	shortcutCode: 'Code',
	shortcutLink: 'Link',
	shortcutLineBreak: 'Line break within a paragraph',
	shortcutLeave: 'Let Tab leave the editor',
	shortcutNumberedList: 'Numbered list',
	shortcutBulletedList: 'Bulleted list',
	shortcutIndent: 'Nest under the item above',
	shortcutOutdent: 'Move back up a level',
	shortcutTask: 'Check or uncheck a task',
	shortcutMoveItem: 'Move the item up or down',
	shortcutNextCell: 'Next cell, adding a row past the last',
	shortcutPreviousCell: 'Previous cell',
	shortcutNextRow: 'Next row, adding one past the last',
	shortcutSelectCells: "Select the cell's text, then its row, then the table",
	shortcutSelectRow: 'Select the row, then the table',
	shortcutMoveLine: 'Move a selected row or column',
	shortcutAlignColumn: 'Align a selected column',
	shortcutDeleteCells: 'Delete the selected cells, rows or columns'
};

const F = FIELD_KEYS;
const L = LIST_KEYS;
const T = TABLE_KEYS;

/** The described shortcuts, in the order a host lists them. */
const SHORTCUTS: readonly {
	keys: readonly string[];
	label: keyof ShortcutStrings;
	scope: ShortcutScope;
}[] = [
	{ scope: 'field', label: 'shortcutUndo', keys: [F.undo] },
	{ scope: 'field', label: 'shortcutRedo', keys: [F.redo, F.redoAlt] },
	{ scope: 'field', label: 'shortcutBold', keys: [F.bold] },
	{ scope: 'field', label: 'shortcutItalic', keys: [F.italic] },
	{ scope: 'field', label: 'shortcutUnderline', keys: [F.underline] },
	{ scope: 'field', label: 'shortcutStrikethrough', keys: [F.strike] },
	{ scope: 'field', label: 'shortcutCode', keys: [F.code] },
	{ scope: 'field', label: 'shortcutLink', keys: [F.link] },
	{ scope: 'body', label: 'shortcutLineBreak', keys: [BODY_KEYS.lineBreak] },
	{ scope: 'body', label: 'shortcutLeave', keys: [BODY_KEYS.leave] },
	{ scope: 'list', label: 'shortcutNumberedList', keys: [L.numbered] },
	{ scope: 'list', label: 'shortcutBulletedList', keys: [L.bulleted] },
	{ scope: 'list', label: 'shortcutIndent', keys: [L.indent] },
	{ scope: 'list', label: 'shortcutOutdent', keys: [L.outdent] },
	{ scope: 'list', label: 'shortcutTask', keys: [L.task] },
	{ scope: 'list', label: 'shortcutMoveItem', keys: [L.moveUp, L.moveDown] },
	{ scope: 'table', label: 'shortcutNextCell', keys: [T.next] },
	{ scope: 'table', label: 'shortcutPreviousCell', keys: [T.previous] },
	{ scope: 'table', label: 'shortcutNextRow', keys: [T.nextRow] },
	{ scope: 'table', label: 'shortcutSelectCells', keys: [T.selectAll] },
	{ scope: 'table', label: 'shortcutSelectRow', keys: [T.select] },
	{
		scope: 'table',
		label: 'shortcutMoveLine',
		keys: [T.moveUp, T.moveDown, T.moveLeft, T.moveRight]
	},
	{ scope: 'table', label: 'shortcutAlignColumn', keys: [T.alignLeft, T.alignRight] },
	{ scope: 'table', label: 'shortcutDeleteCells', keys: [T.erase, T.eraseAlt] }
];

/**
 * The rich editor's shortcuts, worded by `strings` (the package's English where a key is unset),
 * so a host's shortcut list is read off the bindings rather than copied from them.
 */
export function editorShortcuts(strings: Partial<ShortcutStrings> = {}): EditorShortcut[] {
	const words = { ...DEFAULT_SHORTCUT_STRINGS, ...strings };
	return SHORTCUTS.map(({ keys, label, scope }) => ({ keys, label: words[label], scope }));
}
