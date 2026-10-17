// @vitest-environment jsdom
// A card-level object's properties, and those of an object nested in it, are placed as a
// card's fields are, so a field moved into a group keeps its row; a record's cells pack
// wherever they are short.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { core, quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, summaries, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: object_placement
  version: 1.0.0
  backend: typst
  description: A card-level object beside a record list.
typst:
  plate_file: plate.typ
main:
  fields:
    addressing:
      type: object
      properties:
        subject: { type: text }
        issued: { type: date }
        due: { type: date }
        office: { type: text }
        rank: { type: text, ui: { compact: true } }
        grade: { type: text, ui: { compact: true } }
        branch:
          type: object
          properties:
            street: { type: text }
            opened: { type: date }
    jobs:
      type: array
      items:
        type: object
        properties:
          title: { type: text }
          started: { type: date }
      default: []
`;

const wide = (scope: HTMLElement) =>
	Object.fromEntries(
		[...scope.querySelectorAll<HTMLElement>('[data-qm-prop]')].map((p) => [
			p.dataset.qmProp,
			p.classList.contains('qm-prop-wide')
		])
	);

describe('object properties', () => {
	it('place as card fields in a card-level object, and pack in a record', () => {
		const doc = core.Document.fromMarkdown(
			['~~~', '$quill: object_placement@1.0.0', 'jobs:', '  - title: Archives', '~~~', ''].join(
				'\n'
			)
		);
		const { target } = mountEditor(quillFromYaml(YAML), doc);

		expect(wide(field(target, 'Addressing'))).toEqual({
			subject: true,
			issued: false,
			due: false,
			office: true,
			rank: false,
			grade: false,
			branch: false,
			street: true,
			opened: true
		});

		const jobs = field(target, 'Jobs');
		summaries(jobs)[0].click();
		flushSync();
		expect(wide(jobs)).toEqual({ title: false, started: false });
	});
});
