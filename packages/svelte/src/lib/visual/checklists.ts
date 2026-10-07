import type { QuillFieldSchema } from '@quillmark/wasm';

/** The value a matrix prints: the stored map, else a mapping `default:`. */
export function matrixPrinted(
	value: unknown,
	schema: QuillFieldSchema
): Record<string, unknown> | undefined {
	const map = (v: unknown) =>
		typeof v === 'object' && v !== null && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: undefined;
	return value == null ? map(schema.default) : map(value);
}
