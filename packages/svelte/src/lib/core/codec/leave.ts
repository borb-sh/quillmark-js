// The body's way out by the keyboard.
//
// A body holds Tab (`keymap.ts`), so a keyboard that walked into one cannot walk out by
// the key that brought it. Escape opens the way: the next Tab or Shift-Tab is the
// browser's, which moves the focus on from the leaf in either direction, and any other
// key, a press or an edit hands Tab back to the body. The focus stays in the leaf between
// the two keys, so the place is drawn and announced throughout, and Shift-Tab leaves
// backwards as Tab leaves forwards.
//
// The leaf says so at the point of need. A Tab the body held and did nothing with names
// the way out, and Escape names the key it now waits for. The words stand in a status
// region beside the editable, empty at rest, so a reader hears them as they arrive.
import { Plugin, PluginKey, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/** The hint's wording, in each of its two states. */
export interface LeaveStrings {
	/** After a Tab the body held to no effect: the way out, in keys. */
	leaveTaught: string;
	/** After Escape, while the next Tab leaves. */
	leaveArmed: string;
}

/** The package's English, beside the surface that draws it; the visual `strings` set extends it. */
export const DEFAULT_LEAVE_STRINGS: LeaveStrings = {
	leaveTaught: 'Esc, then Tab, to move on',
	leaveArmed: 'Tab to move on'
};

type Leave = 'idle' | 'taught' | 'armed';

const leaveKey = new PluginKey<Leave>('qm.leave');

/** Keys that are part of the chord still being pressed, or the key that arms. */
const KEPT = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Escape']);

const enter =
	(to: Leave): Command =>
	(state, dispatch) => {
		if (leaveKey.getState(state) === undefined) return false;
		dispatch?.(state.tr.setMeta(leaveKey, to));
		return true;
	};

/** Hand the next Tab to the browser. Declines in a state without {@link leavePlugin}. */
export const armLeave: Command = enter('armed');
/** Name the way out, after a Tab the body held. Declines as {@link armLeave}. */
export const teachLeave: Command = enter('taught');

export function leavePlugin(strings: () => LeaveStrings): Plugin<Leave> {
	const rest = (view: EditorView): boolean => {
		if (leaveKey.getState(view.state) !== 'idle')
			view.dispatch(view.state.tr.setMeta(leaveKey, 'idle' satisfies Leave));
		return false;
	};
	return new Plugin<Leave>({
		key: leaveKey,
		state: {
			init: () => 'idle',
			apply: (tr, prev) =>
				(tr.getMeta(leaveKey) as Leave | undefined) ??
				(tr.docChanged || tr.selectionSet ? 'idle' : prev)
		},
		props: {
			handleDOMEvents: {
				// Ahead of every keymap, and answering `true` without preventing the default:
				// the view then runs no binding for the key, a list's indent included, and the
				// browser moves the focus.
				keydown: (view, e) => {
					const at = leaveKey.getState(view.state);
					if (at === 'idle' || KEPT.has(e.key)) return false;
					if (e.key === 'Tab') return at === 'armed' && !e.ctrlKey && !e.altKey && !e.metaKey;
					return rest(view);
				},
				blur: rest,
				mousedown: rest
			}
		},
		view: (view) => {
			const note = document.createElement('span');
			note.className = 'qm-leave-hint';
			note.setAttribute('role', 'status');
			view.dom.after(note);
			const draw = (): void => {
				const at = leaveKey.getState(view.state);
				const words = strings();
				const text = at === 'armed' ? words.leaveArmed : at === 'taught' ? words.leaveTaught : '';
				if (note.textContent !== text) note.textContent = text;
			};
			draw();
			return { update: draw, destroy: () => note.remove() };
		}
	});
}
