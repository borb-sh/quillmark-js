// The body leaf's structural keymap: where the chains are composed, and the one
// place that fixes their precedence (INVARIANTS §Chrome).
//
// A body is a document, so its structural keys are structural; a surface nested in
// it that owns a key more locally joins the chain rather than rewriting the binding.
// Precedence is inner surface first: the `code_block` link, then the list links, then
// the block-atom link, which is about a neighbour rather than about the surface the
// caret is in and so answers last. Each link declines outside its surface, so the
// first link that claims the key gets it. Where none does, Tab and Shift-Tab are still
// the body's: a writer presses Tab to indent, and a Tab that left would carry the next
// keystrokes into whatever control took the focus. Escape is the way out instead
// (`leave.ts`).
//
// The block link is the exception to that order and comes ahead of them all: it is
// about the body itself — the one position no surface owns, its very start — or about
// the caret's own block, and a link reading a caret's own surface would answer there
// first and never let it run.
//
// The break link is no surface either: Shift-Enter is the caret's own line wherever it
// is pressed. It sits behind the code link, the one surface holding a nearer answer to
// that key — inside a fence the line is the newline Enter already takes — and no link
// below it binds the key at all.
//
// A table island's cell traversal is not a link here: it binds on the nested cell
// view (`table-view.ts`), a keymap over a different document, so a key a cell
// handled never reaches this map at all.
//
// The composition lives here rather than in either surface: `lists.ts` must not
// import the code-block commands to know it comes second.
import type { Schema } from 'prosemirror-model';
import { chainCommands } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import { atomKeymap } from './atoms.js';
import { blockKeymap } from './blocks.js';
import { breakKeymap } from './breaks.js';
import { codeKeymap } from './code.js';
import { listKeymap } from './lists.js';
import { listMoveKeymap } from './list-move.js';
import { armLeave, teachLeave } from './leave.js';
import { slashKeymap } from './slash.js';
import { BODY_KEYS } from './shortcuts.js';

/** One chain per key, the maps taken in precedence order: on a key several bind, an
 * earlier map's command runs first and the next runs only if it declines. A key one
 * map alone binds is its own. No input is mutated. */
function chainKeymaps(...maps: Record<string, Command>[]): Record<string, Command> {
	const out: Record<string, Command> = {};
	for (const map of maps) {
		for (const [key, cmd] of Object.entries(map)) {
			out[key] = out[key] ? chainCommands(out[key], cmd) : cmd;
		}
	}
	return out;
}

/** Whether a body over `schema` holds Tab: `false` over `plainSchema`, a form field whose
 *  Tab is field navigation. */
export function holdsTab(schema: Schema): boolean {
	return !!schema.nodes.list_item;
}

/** The last link of a document body: Tab and Shift-Tab held wherever no surface took
 *  them, each naming the way out, and Escape handing the next one to the browser
 *  (`leave.ts`). `{}` where the body does not hold Tab. */
function exitKeymap(schema: Schema): Record<string, Command> {
	if (!holdsTab(schema)) return {};
	const held: Command = (state, dispatch) => {
		teachLeave(state, dispatch);
		return true;
	};
	return { Tab: held, 'Shift-Tab': held, [BODY_KEYS.leave]: armLeave };
}

/** A multi-block leaf's structural keys, each link binding only what its schema
 * declares: over `plainSchema`, which holds neither lists nor code blocks nor islands,
 * the block link and the break link alone. The argument list is the precedence order
 * INVARIANTS §Chrome, so a new link is one more argument at its place in that
 * order rather than a nesting to read inside out.
 *
 * The slash menu is innermost of the three, and it is conditional rather than
 * schema-gated: the keys exist only where a menu can be drawn (`slash`), because Enter
 * and Escape claimed by a surface nobody can see is a body that swallows two keys for
 * no visible reason. */
export function bodyKeymap(schema: Schema, slash?: boolean): Record<string, Command> {
	const links = slash ? [slashKeymap()] : [];
	return chainKeymaps(
		...links,
		blockKeymap(schema),
		codeKeymap(schema),
		breakKeymap(schema),
		listKeymap(schema),
		listMoveKeymap(schema),
		atomKeymap(schema),
		exitKeymap(schema)
	);
}
