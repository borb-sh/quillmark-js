// @vitest-environment jsdom
// The enum-option policy's two arms and the authored-value escape (VISUAL_EDITOR
// §"Enum policy"), driven the way a pointer opens the listbox and judged on the rows
// it draws. `status` is the case the distinction exists for, and the five stages the
// reference quill declares leave a deployment carrying two with both kinds of row
// in one list.
import { describe, it, expect, afterEach } from 'vitest';
import type { Addr, Document, Quill } from '@quillmark/wasm';
import type { VisualEditorProps } from '$lib/visual/props';
import { quill } from '../helpers/fixtures.js';
import { field, mountEditor, openList, pick, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** The stages this deployment does not carry, in the reference quill's own set. */
const WITHHELD = ['approved', 'final', 'withdrawn'];
const allowedStages = (_addr: Addr, value: string) => !WITHHELD.includes(value);

function open(props: Partial<VisualEditorProps> = {}, seed?: (q: Quill, doc: Document) => void) {
	const q = quill();
	const doc = q.seedDocument();
	seed?.(q, doc);
	return mountEditor(q, doc, props).target;
}

/** The schema options the open list draws, in order, each with whether it is offered.
 *  The unset sentinel is dropped: it is the clear-to-default affordance, exempt from
 *  policy. */
function options(target: HTMLElement): { text: string; disabled: boolean }[] {
	return [...target.querySelectorAll<HTMLElement>('.qm-select-item')]
		.filter((el) => !el.querySelector('.qm-select-ghost'))
		.map((el) => ({
			text: el.textContent?.trim() ?? '',
			disabled: el.hasAttribute('data-disabled')
		}));
}

const texts = (target: HTMLElement) => options(target).map((o) => o.text);

describe("enumDisallowed: 'disable'", () => {
	it('is the default, and draws a refused option greyed in place', () => {
		const target = open({ enumOptionAllowed: allowedStages });
		openList(field(target, 'Status'));

		// The whole schema set, order intact: nothing is stripped.
		expect(texts(target)).toEqual(['draft', 'in_review', ...WITHHELD]);
		expect(
			options(target)
				.filter((o) => o.disabled)
				.map((o) => o.text)
		).toEqual(WITHHELD);
	});

	it('offers every option when no hook is set', () => {
		const target = open();
		openList(field(target, 'Status'));

		expect(options(target).some((o) => o.disabled)).toBe(false);
	});
});

describe("enumDisallowed: 'hide'", () => {
	it('leaves a refused option out of the list', () => {
		const target = open({ enumOptionAllowed: allowedStages, enumDisallowed: 'hide' });
		openList(field(target, 'Status'));

		expect(texts(target)).toEqual(['draft', 'in_review']);
	});

	it('draws the authored value anyway, disabled, and no other out-of-policy row', () => {
		// Authored before the mount, the way a stored document arrives: the deployment
		// stopped carrying the stage after this document was written.
		const target = open({ enumOptionAllowed: allowedStages, enumDisallowed: 'hide' }, (q, doc) =>
			q.writer(doc).set('status', 'final')
		);
		const trigger = openList(field(target, 'Status'));

		expect(texts(target)).toEqual(['draft', 'in_review', 'final']);
		expect(
			options(target)
				.filter((o) => o.disabled)
				.map((o) => o.text)
		).toEqual(['final']);
		// The closed control says what the document says, under either policy.
		expect(trigger.textContent).toContain('final');
	});

	it('drops the row once the document no longer holds it', () => {
		const target = open({ enumOptionAllowed: allowedStages, enumDisallowed: 'hide' }, (q, doc) =>
			q.writer(doc).set('status', 'final')
		);
		pick(field(target, 'Status'), 'in_review');

		openList(field(target, 'Status'));
		expect(texts(target)).toEqual(['draft', 'in_review']);
	});
});

describe('the policy reaches a card field', () => {
	it('applies to a section enum, not only the main card', () => {
		const target = open({
			enumOptionAllowed: (_addr, value) => value !== 'aside',
			enumDisallowed: 'hide'
		});
		openList(field(target, 'Layout'));

		expect(texts(target)).toEqual(['prose', 'callout']);
	});
});

describe('the hook is asked per option, at the field it draws', () => {
	it('carries the field addr', () => {
		const seen: { addr: Addr; value: string }[] = [];
		const target = open({
			enumOptionAllowed: (addr, value) => {
				seen.push({ addr, value });
				return true;
			}
		});
		openList(field(target, 'Status'));

		const asked = seen.filter((s) => s.addr.field === 'status');
		expect(asked.map((s) => s.value)).toEqual(
			expect.arrayContaining(['draft', 'in_review', 'final'])
		);
	});
});
