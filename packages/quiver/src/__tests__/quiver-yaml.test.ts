import { describe, it, expect } from 'vitest';
import { parseQuiverYaml } from '../quiver-yaml.js';
import { QuiverError } from '../errors.js';

describe('parseQuiverYaml', () => {
	// --- Happy paths ---

	it('parses a valid Quiver.yaml with name only', () => {
		const result = parseQuiverYaml('name: my_quiver\n');
		expect(result).toEqual({ name: 'my_quiver' });
	});

	it('parses a valid Quiver.yaml with name and description', () => {
		const result = parseQuiverYaml('name: sample\ndescription: A cool quiver\n');
		expect(result).toEqual({ name: 'sample', description: 'A cool quiver' });
	});

	it('accepts Uint8Array input', () => {
		const raw = new TextEncoder().encode('name: my_quiver\n');
		const result = parseQuiverYaml(raw);
		expect(result).toEqual({ name: 'my_quiver' });
	});

	it('holds the name to the quill-name rule', () => {
		expect(parseQuiverYaml('name: quiver_123\n')).toEqual({ name: 'quiver_123' });
		expect(() => parseQuiverYaml('name: My-Quiver\n')).toThrow(QuiverError);
	});

	// --- Missing name ---

	it('throws quiver_invalid when name is missing', () => {
		expect(() => parseQuiverYaml('description: no name here\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// --- Non-string name ---

	it('throws quiver_invalid when name is a number', () => {
		expect(() => parseQuiverYaml('name: 42\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// --- Invalid name charset ---

	it('throws quiver_invalid when name contains a space', () => {
		expect(() => parseQuiverYaml('name: bad name\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('throws quiver_invalid when name contains @', () => {
		expect(() => parseQuiverYaml('name: bad@name\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// --- Unknown fields ---

	it('throws quiver_invalid for unknown field', () => {
		expect(() => parseQuiverYaml('name: ok\nunknown_field: something\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// --- Bad YAML syntax ---

	it('throws quiver_invalid on YAML parse failure', () => {
		// Indentation error / broken YAML
		expect(() => parseQuiverYaml('name: [\nbad yaml')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	it('throws quiver_invalid when top-level is an array', () => {
		expect(() => parseQuiverYaml('- name: foo\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});

	// --- Non-string description ---

	it('throws quiver_invalid when description is a number', () => {
		expect(() => parseQuiverYaml('name: ok\ndescription: 123\n')).toThrow(
			expect.objectContaining({ code: 'quiver_invalid' })
		);
	});
});
