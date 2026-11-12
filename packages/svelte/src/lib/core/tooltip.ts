// The name of a control that draws only a glyph, raised beside it: one surface per root, where the
// native `title` reaches no dial, waits a second, answers a pointer alone and cannot be dismissed.
//
// A control opts in by attribute rather than by a wrapper, so chrome built without a framework
// (the table island's) and chrome built with one are served by the same listeners on the root
// they stand in, and a control costs no listener of its own:
//
//   data-qm-tip        the control's name
//   data-qm-tip-keys   its shortcut, as the platform prints it
//   data-qm-tip-side   on the control or an ancestor: the box the tip stands clear of, and
//                      `bottom` to stand under it. A floating row of controls names itself here,
//                      so its tips fall on the side away from what the row is about.
//
// The tip is decoration for a reader who can see it. It is `aria-hidden` and nothing points at it:
// the control's `aria-label` is its name and `aria-keyshortcuts` its shortcut. It takes no pointer
// and holds nothing to press.
//
// It comes up once the pointer has rested on the control (`--_qm-hint-wait`), at once under
// keyboard focus, and at once and without its fade on the control after one that just showed its
// own, so a tip carried along a row of glyphs reads as one tip moving. A press, a key or
// a scroll lowers it until the pointer or the focus comes back to the control: each can move the
// control, and the tip is placed once, from where the control stood.

import { rungMs, rungStyle, spacePx } from './rungs.js';
import './tooltip.css';

const TIP = 'data-qm-tip';
const KEYS = 'data-qm-tip-keys';
const SIDE = 'data-qm-tip-side';

const installed = new WeakMap<HTMLElement, { users: number; remove: () => void }>();

/**
 * Serve the tips of every control under `root`, the `[data-qm-root]` a tip is appended to and
 * kept inside. One install per root however many callers ask; the returned function releases this
 * caller's.
 */
export function tooltips(root: HTMLElement): () => void {
	let entry = installed.get(root);
	if (!entry) installed.set(root, (entry = { users: 0, remove: install(root) }));
	entry.users++;
	const held = entry;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--held.users > 0) return;
		held.remove();
		installed.delete(root);
	};
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

function install(root: HTMLElement): () => void {
	const doc = root.ownerDocument;
	const tip = doc.createElement('div');
	tip.className = 'qm-tip';
	tip.setAttribute('aria-hidden', 'true');

	/** The control the pointer or the focus is on, whether or not its tip is up. */
	let anchor: Element | undefined;
	let by: 'pointer' | 'focus' = 'pointer';
	let pending: ReturnType<typeof setTimeout> | undefined;
	/** Until when the next control's tip skips the wait: a reader moving along a row of
	 *  glyphs is reading them, not resting. */
	let warm = 0;

	const wait = (): number => rungMs(rungStyle(root), '--_qm-hint-wait') ?? 0;

	function place(control: Element): void {
		const holder = control.closest(`[${SIDE}]`) ?? control;
		const across = control.getBoundingClientRect();
		const along = holder.getBoundingClientRect();
		const frame = root.getBoundingClientRect();
		// The root is positioned wherever the editor mounts it; a leaf mounted on its own may
		// stand in one that is not, and the tip is then placed in whatever is.
		const origin = tip.offsetParent ?? root;
		const from = origin.getBoundingClientRect();
		const view = doc.defaultView;
		const top = Math.max(frame.top, 0);
		const bottom = Math.min(frame.bottom, view?.innerHeight ?? frame.bottom);
		const left = Math.max(frame.left, 0);
		const right = Math.min(frame.right, view?.innerWidth ?? frame.right);
		const gap = spacePx(root) ?? 0;
		const w = tip.offsetWidth;
		const h = tip.offsetHeight;
		const over = along.top - gap - h;
		const under = along.bottom + gap;
		const overFits = over >= top;
		const underFits = under + h <= bottom;
		const below =
			holder.getAttribute(SIDE) === 'bottom' ? underFits || !overFits : !overFits && underFits;
		const x = clamp(across.left + (across.width - w) / 2, left + gap, right - gap - w);
		const y = clamp(below ? under : over, top, bottom - h);
		tip.style.left = `${x - from.left - origin.clientLeft + origin.scrollLeft}px`;
		tip.style.top = `${y - from.top - origin.clientTop + origin.scrollTop}px`;
	}

	function raise(control: Element, arriving = true): void {
		pending = undefined;
		const name = control.getAttribute(TIP);
		if (!name || !control.isConnected) return;
		const keys = control.getAttribute(KEYS);
		tip.replaceChildren(name);
		if (keys) {
			const cap = doc.createElement('kbd');
			cap.textContent = keys;
			tip.appendChild(cap);
		}
		tip.toggleAttribute('data-arriving', arriving);
		root.appendChild(tip);
		place(control);
	}

	/** Take the tip down, the control still the one attended to, so it stays down. */
	function lower(): void {
		clearTimeout(pending);
		pending = undefined;
		if (tip.isConnected) warm = performance.now() + wait();
		tip.remove();
		doc.removeEventListener('scroll', lower, true);
		doc.removeEventListener('keydown', lower, true);
	}

	function leave(): void {
		lower();
		anchor = undefined;
	}

	function attend(control: Element, from: 'pointer' | 'focus'): void {
		leave();
		anchor = control;
		by = from;
		doc.addEventListener('scroll', lower, { capture: true, passive: true });
		doc.addEventListener('keydown', lower, true);
		if (performance.now() < warm) raise(control, false);
		else if (from === 'focus') raise(control);
		else pending = setTimeout(() => raise(control), wait());
	}

	const tipped = (target: EventTarget | null): Element | undefined =>
		(target instanceof Element && target.closest(`[${TIP}]`)) || undefined;

	function onOver(e: PointerEvent): void {
		if (e.pointerType === 'touch') return;
		const control = tipped(e.target);
		if (control === anchor) return;
		if (control) attend(control, 'pointer');
		else if (by === 'pointer') leave();
	}
	function onOut(e: PointerEvent): void {
		if (by !== 'pointer' || !anchor) return;
		if (e.relatedTarget instanceof Node && anchor.contains(e.relatedTarget)) return;
		leave();
	}
	function onFocusIn(e: FocusEvent): void {
		const control = tipped(e.target);
		if (control && control.matches(':focus-visible')) attend(control, 'focus');
	}
	function onFocusOut(): void {
		if (by === 'focus') leave();
	}

	root.addEventListener('pointerover', onOver);
	root.addEventListener('pointerout', onOut);
	root.addEventListener('pointerdown', lower, true);
	root.addEventListener('focusin', onFocusIn);
	root.addEventListener('focusout', onFocusOut);
	return () => {
		leave();
		root.removeEventListener('pointerover', onOver);
		root.removeEventListener('pointerout', onOut);
		root.removeEventListener('pointerdown', lower, true);
		root.removeEventListener('focusin', onFocusIn);
		root.removeEventListener('focusout', onFocusOut);
	};
}
