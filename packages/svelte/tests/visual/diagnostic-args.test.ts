// The boundary facts `FormatDiagnostic` is written against: what a validation
// diagnostic carries beyond its English, and what the parse lane does not. Both are
// upstream's shape rather than this package's, so they are asserted rather than
// assumed: the doc on that hook tells a consumer which fields to word a sentence
// from, and it is only sound advice while these hold.
import { describe, it, expect } from 'vitest';
import { init, type Diagnostic } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import { routeAndResolve } from '$lib/visual/diagnostics';

const core = await init();

describe('what a Diagnostic carries', () => {
	it('hands the validation lane the offending value under `args`', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('status', 'NOT_AN_OPTION');
		doc.storeField('font_size', 'not a number');

		const byCode = new Map(q.validate(doc).map((d) => [d.code, d]));

		// The constraint and the value, keyed: what lets a formatter say "pick one of
		// these" in another language without parsing the English it was handed.
		const enumViolation = byCode.get('validation::enum_violation');
		expect(enumViolation?.args?.value).toBe('NOT_AN_OPTION');
		expect(enumViolation?.args?.allowed).toContain('in_review');

		// `sourceToken` is the authored token verbatim, which is the half the document
		// at `path` cannot supply: validation runs post-coercion.
		const typeMismatch = byCode.get('validation::type_mismatch');
		expect(typeMismatch?.args?.expected).toBe('number');
		expect(typeMismatch?.args?.actual).toBe('string');
		expect(typeMismatch?.args?.sourceToken).toContain('not a number');

		doc.free();
	});

	it('anchors an ERROR deeper than any commit address, which is what routing truncates for', () => {
		// The deep-anchor class is not obligation warnings alone: `validate` walks into
		// object properties and array elements, so a coercion failure inside a subform
		// anchors where `Addr` cannot reach. `nearestAddrForFieldPath` exists for this.
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('contact', { name: 'x', email: 'y', listed: 'not-a-boolean' });
		doc.storeField('revisions', [{ note: 'n', pages: 'not-an-integer' }]);

		const deep = q
			.validate(doc)
			.filter((d) => d.severity === 'error')
			.map((d) => d.path);
		expect(deep).toEqual(['main.contact.listed', 'main.revisions[0].pages']);

		// And they land, rather than dropping by shape: the property under its subform's
		// field, the element's property under its repeater's.
		expect(routeAndResolve(q.validate(doc), []).map((r) => r.key)).toEqual([
			{ field: 'contact' },
			{ field: 'revisions' }
		]);

		doc.free();
	});

	it('keeps the parse lane engine text out of `args`, which names the block only', () => {
		// The permanent fallback arm. `args` names the block and stops there, the failure
		// being placed on `location` in the document's own coordinates, so the parser's
		// own sentence is reachable only as `message` and returning `undefined` from a
		// formatter is the correct answer rather than a concession.
		let thrown: unknown;
		try {
			core.Document.fromMarkdown('~~~\n$quill: showcase@1.0.0\ntitle: [unclosed\n~~~\n\nBody.\n');
		} catch (e) {
			thrown = e;
		}
		const diagnostics = (thrown as { diagnostics?: Diagnostic[] } | undefined)?.diagnostics;
		expect(diagnostics?.length).toBeGreaterThan(0);
		const parse = diagnostics![0];
		expect(parse.message).toContain('unclosed bracket');
		expect(parse.path).toBeUndefined();
		expect(Object.keys(parse.args ?? {}).sort()).toEqual(['blockIndex']);
		// The document's own line, not the block's: the `title:` line of the source.
		expect(parse.location).toMatchObject({ file: 'input.md', line: 3 });
	});
});
