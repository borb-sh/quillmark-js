// @vitest-environment jsdom
// The blank's label (VISUAL_EDITOR §"Enum policy"): a quill's `ui.blank_title` is what
// the control draws wherever it draws the blank, the ghost of a blank `default:` and a
// stored `""` alike, and the list still offers no row for it.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { init, type Quill, type Document } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';

const core = await init();

// jsdom implements no pointer-capture API, and the trigger probes for one before it
// opens (see enum-policy).
Element.prototype.hasPointerCapture ??= () => false;

const QUILL_YAML = `quill:
  name: blank_title
  version: 1.0.0
  backend: typst
  description: An enum whose blank the quill names.
typst:
  plate_file: plate.typ
main:
  fields:
    marking:
      type: enum
      values: [CUI, SECRET]
      default: ""
      ui:
        blank_title: (no marking)
`;

// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes from
// another realm and the boundary refuses it by identity.
const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
const blankTitled = (): Quill =>
	core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(QUILL_YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
		doc.free();
	};
	return target;
}

const trigger = (target: HTMLElement) => target.querySelector<HTMLElement>('.qm-select')!;

describe('ui.blank_title', () => {
	it('labels the ghost of a blank default, and the list offers no blank row', () => {
		const q = blankTitled();
		const target = mountEditor(q, q.seedDocument());

		expect(trigger(target).textContent?.trim()).toBe('(no marking)');
		expect(trigger(target).hasAttribute('data-ghosted')).toBe(true);

		trigger(target).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
		trigger(target).click();
		flushSync();
		const rows = [...target.querySelectorAll<HTMLElement>('.qm-select-item')];
		expect(
			rows.map((r) => r.querySelector('.qm-select-ghost')?.textContent ?? r.textContent?.trim())
		).toEqual(['(no marking)', 'CUI', 'SECRET']);
	});

	it('labels a stored blank, unghosted', () => {
		const doc = core.Document.fromMarkdown(
			['~~~', '$quill: blank_title@1.0.0', 'marking: ""', '~~~', ''].join('\n')
		);
		const target = mountEditor(blankTitled(), doc);

		expect(trigger(target).textContent?.trim()).toBe('(no marking)');
		expect(trigger(target).hasAttribute('data-ghosted')).toBe(false);
	});
});
