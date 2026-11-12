// @vitest-environment jsdom
// What a screen reader hears of the diagnostics: one region that stands empty from the
// mount and takes the errors the page draws once they have changed and held still. The
// lists under the controls are not live regions, a list arriving with its text in it.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Diagnostic, Quill } from '@quillmark/wasm';
import { DEFAULT_VISUAL_STRINGS as S } from '$lib/visual';
import { fieldTitle } from '$lib/visual/structure';
import { quillFromYaml } from '../helpers/fixtures.js';
import { field, mountEditor, unmountAll } from '../helpers/surface.svelte.js';

const YAML = `quill:
  name: heard
  version: 1.0.0
  backend: typst
  description: Two fields a host flags.
typst:
  plate_file: plate.typ
main:
  fields:
    subject:
      type: text
      default: ""
    pages:
      type: integer
`;

const error = (name: string, message: string): Diagnostic => ({
	severity: 'error',
	path: `main.${name}`,
	message
});
const issue = (q: Quill, name: string, message: string) => ({
	field: fieldTitle(name, q.schema.main.fields[name]),
	message
});

function open(diagnostics?: Diagnostic[]) {
	const q = quillFromYaml(YAML);
	const m = mountEditor(q, q.seedDocument(), { diagnostics });
	const live = m.target.querySelector('.qm-diag-live')!;
	return {
		q,
		target: m.target,
		live,
		heard: () => live.textContent,
		flag(next: Diagnostic[] | undefined) {
			m.props.diagnostics = next;
			flushSync();
		}
	};
}
const rest = (): void => {
	vi.runOnlyPendingTimers();
	flushSync();
};

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
	unmountAll();
	vi.useRealTimers();
});

describe('the editor’s diagnostics region', () => {
	it('stands empty before any diagnostic arrives', () => {
		const e = open();
		expect(e.live.getAttribute('role')).toBe('status');
		expect(e.heard()).toBe('');
		rest();
		expect(e.heard()).toBe('');
	});

	it('says an error once it has held still, and never from the list it draws', () => {
		const e = open();
		e.flag([error('pages', 'too many')]);
		const list = field(e.target, fieldTitle('pages', e.q.schema.main.fields.pages)).querySelector(
			'.qm-diag-list'
		)!;
		expect(list.textContent).toContain('too many');
		expect(list.closest('[role="status"], [aria-live]')).toBeNull();
		expect(e.heard()).toBe('');
		rest();
		expect(e.heard()).toBe(S.diagAnnounced([issue(e.q, 'pages', 'too many')]));
	});

	it('says the set again as it changes, in the page’s order, and its clearing once', () => {
		const e = open();
		e.flag([error('pages', 'too many')]);
		rest();
		e.flag([error('pages', 'too many'), error('subject', 'too long')]);
		rest();
		expect(e.heard()).toBe(
			S.diagAnnounced([issue(e.q, 'subject', 'too long'), issue(e.q, 'pages', 'too many')])
		);
		e.flag(undefined);
		rest();
		expect(e.heard()).toBe(S.diagAnnounced([]));
	});

	it('says nothing of a set that returns to what was last said', () => {
		const e = open();
		e.flag([error('pages', 'too many')]);
		rest();
		const said = e.heard();
		e.flag([error('subject', 'too long')]);
		e.flag([error('pages', 'too many')]);
		rest();
		expect(e.heard()).toBe(said);
	});

	it('does not say the errors a mount starts from', () => {
		const e = open([error('pages', 'too many')]);
		rest();
		expect(e.heard()).toBe('');
	});
});
