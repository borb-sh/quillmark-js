import type { Quill } from '@quillmark/wasm';

type QuillSchema = Quill['schema'];

const schemas = new WeakMap<Quill, QuillSchema>();

/** `quill.schema`, built once per handle: the getter rebuilds and serializes the whole schema on
 *  every read, and a handle's schema never changes. Shared, so read-only. */
export function schemaOf(quill: Quill): QuillSchema {
	let schema = schemas.get(quill);
	if (!schema) schemas.set(quill, (schema = quill.schema));
	return schema;
}
