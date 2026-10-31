/**
 * Internal parser/validator for Quiver.yaml: two fields, `name` and
 * `description`, strict about everything else. Parsed through the `yaml`
 * package, so quoting, escaping and multi-line strings behave as YAML.
 */

import { parse as parseYaml } from 'yaml';
import { QuiverError } from './errors.js';
import { isQuillName } from './ref.js';

export interface QuiverMeta {
	name: string;
	description?: string;
}

const KNOWN_FIELDS = new Set(['name', 'description']);

/**
 * Parses and validates Quiver.yaml contents.
 *
 * Throws `QuiverError('quiver_invalid')` on:
 *   - YAML parse failure
 *   - Missing or non-string `name`
 *   - `name` is not a quill name, `[a-z][a-z0-9_]*`
 *   - Unknown fields (strict)
 *   - `description` present but not a string
 */
export function parseQuiverYaml(raw: string | Uint8Array): QuiverMeta {
	const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

	let parsed: unknown;
	try {
		parsed = parseYaml(text);
	} catch (err) {
		throw new QuiverError(
			'quiver_invalid',
			`Quiver.yaml: YAML parse failure — ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err }
		);
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new QuiverError(
			'quiver_invalid',
			`Quiver.yaml: expected a mapping at the top level, got ${Array.isArray(parsed) ? 'array' : String(parsed)}`
		);
	}

	const doc = parsed as Record<string, unknown>;

	for (const key of Object.keys(doc)) {
		if (!KNOWN_FIELDS.has(key)) {
			throw new QuiverError(
				'quiver_invalid',
				`Quiver.yaml: unknown field "${key}" — only "name" and "description" are valid`
			);
		}
	}

	if (!('name' in doc)) {
		throw new QuiverError('quiver_invalid', `Quiver.yaml: required field "name" is missing`);
	}

	if (typeof doc['name'] !== 'string') {
		throw new QuiverError(
			'quiver_invalid',
			`Quiver.yaml: "name" must be a string, got ${typeof doc['name']}`
		);
	}

	const name = doc['name'];

	if (!isQuillName(name)) {
		throw new QuiverError(
			'quiver_invalid',
			`Quiver.yaml: "name" value "${name}" is not a quill name — a name is [a-z][a-z0-9_]*, at most 64 characters`
		);
	}

	const meta: QuiverMeta = { name };

	if (doc['description'] !== undefined) {
		if (typeof doc['description'] !== 'string') {
			throw new QuiverError(
				'quiver_invalid',
				`Quiver.yaml: "description" must be a string if present, got ${typeof doc['description']}`
			);
		}
		meta.description = doc['description'];
	}

	return meta;
}
