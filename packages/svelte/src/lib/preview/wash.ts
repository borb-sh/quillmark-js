// The arrival wash on the page: a plane over each of a field's boxes, played by `core/bloom.ts` and
// removed once it has decayed, so the preview is left with no ink of its own.
import type { LiveSession } from '@quillmark/wasm';
import { bloom } from '../core/bloom.js';
import { applyPercentRect, boxesForField, rectToPercent } from './geometry.js';
import type { PageSlot } from './paint.js';

const WASH_CLASS = 'qm-preview-wash';

/**
 * Wash every box this compile places at `field`; `false` when it places none. A wash still playing
 * on the same address is cut first, so two quick washes do not stack alphas.
 */
export function washField(
	session: LiveSession,
	slots: readonly PageSlot[],
	field: string
): boolean {
	const boxes = boxesForField(field, session.fieldBoxes(field), () => session.regions());
	for (const { el } of slots) {
		for (const plane of el.querySelectorAll<HTMLElement>(`.${WASH_CLASS}`)) {
			if (plane.dataset.field === field) plane.remove();
		}
	}
	let placed = false;
	for (const box of boxes) {
		const slot = slots[box.page];
		if (!slot) continue;
		placed = true;
		const plane = document.createElement('div');
		plane.className = WASH_CLASS;
		plane.dataset.field = field;
		applyPercentRect(plane, rectToPercent(box.rect, slot.size));
		slot.el.appendChild(plane);
		const run = bloom(plane);
		if (run) run.onfinish = run.oncancel = () => plane.remove();
		else plane.remove();
	}
	return placed;
}
