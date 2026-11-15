// @vitest-environment jsdom
// The enum-option policy's two arms and the authored-value escape (INVARIANTS
// §Enums), driven the way a pointer opens the listbox and judged on the rows
// it draws. `status` is the case the distinction exists for, and the five stages the
// reference quill declares leave a deployment carrying two with both kinds of row
// in one list.
import { describe, it, expect, afterEach } from 'vitest';
import type { Addr, Document, Quill } from '@quillmark/wasm';
import type { VisualEditorProps } from '$lib/visual/props';
import { quill, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	openList,
	pick,
	unmountAll
} from '../helpers/surface.svelte.js';

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
		.filter((el) => !el.classList.contains('qm-select-unset'))
		.map((el) => ({
			text: el.querySelector('.qm-select-label')?.textContent?.trim() ?? '',
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

/** A marking inside a group, as a plain enum, a variant, and one object further in. */
const grouped = () =>
	quillFromYaml(`quill:
  name: enum_policy
  version: 1.0.0
  backend: typst
  description: Enums inside a top-level object.
typst:
  plate_file: plate.typ
main:
  fields:
    classification:
      type: object
      properties:
        level:
          type: enum
          values: [UNCLASSIFIED, CUI, SECRET]
          variants:
            CUI:
              controlled_by:
                type: text
        dissemination:
          type: text
        handling:
          type: object
          properties:
            caveat:
              type: enum
              values: [NONE, NOFORN]
`);

/** The enum a subform's property label names, by the label's `for`. */
function property(target: HTMLElement, label: string): HTMLElement {
	const named = [...target.querySelectorAll<HTMLLabelElement>('label')].find(
		(l) => l.textContent?.trim() === label
	);
	const control = named?.htmlFor && document.getElementById(named.htmlFor);
	if (!control) throw new Error(`no property labelled ${label}`);
	return control;
}

describe('the policy reaches an enum inside an object', () => {
	function mounted(allowed: VisualEditorProps['enumOptionAllowed']) {
		const q = grouped();
		const { target } = mountEditor(q, q.seedDocument(), {
			enumOptionAllowed: allowed,
			enumDisallowed: 'hide'
		});
		openGroup(target, 'Classification');
		return target;
	}

	it('asks with the steps from the field down to the enum', () => {
		const seen = new Set<string>();
		const target = mounted((addr, _value, steps) => {
			seen.add([addr.field, ...(steps ?? [])].join('.'));
			return true;
		});
		openList(property(target, 'Level'));
		openList(property(target, 'Caveat'));

		expect(seen).toEqual(new Set(['classification.level', 'classification.handling.caveat']));
	});

	it('leaves a refused member out of a variant inside the object', () => {
		const target = mounted(
			(addr, value, steps) =>
				!(addr.field === 'classification' && steps?.[0] === 'level' && value === 'SECRET')
		);
		openList(property(target, 'Level'));

		expect(texts(target)).toEqual(['UNCLASSIFIED', 'CUI']);
	});

	it('leaves a refused option out of an enum two objects in', () => {
		const target = mounted(
			(_addr, value, steps) => !(steps?.at(-1) === 'caveat' && value === 'NOFORN')
		);
		openList(property(target, 'Caveat'));

		expect(texts(target)).toEqual(['NONE']);
	});
});
