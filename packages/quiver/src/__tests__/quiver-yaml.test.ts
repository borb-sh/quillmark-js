import { describe, it, expect } from 'vitest';
import { parseQuiverYaml } from '../quiver-yaml.js';

describe('parseQuiverYaml', () => {
	it.each([
		['name only', 'name: my_quiver\n', { name: 'my_quiver' }],
		[
			'name and description',
			'name: sample\ndescription: A cool quiver\n',
			{ name: 'sample', description: 'A cool quiver' }
		],
		['a quill-name-shaped name', 'name: quiver_123\n', { name: 'quiver_123' }]
	])('parses %s', (_, yaml, want) => expect(parseQuiverYaml(yaml)).toEqual(want));

	it('accepts Uint8Array input', () => {
		expect(parseQuiverYaml(new TextEncoder().encode('name: my_quiver\n'))).toEqual({
			name: 'my_quiver'
		});
	});

	it.each([
		['a missing name', 'description: no name here\n'],
		['a numeric name', 'name: 42\n'],
		['a name outside the quill-name rule', 'name: My-Quiver\n'],
		['a name with a space', 'name: bad name\n'],
		['a name with @', 'name: bad@name\n'],
		['an unknown field', 'name: ok\nunknown_field: something\n'],
		['broken YAML', 'name: [\nbad yaml'],
		['a top-level array', '- name: foo\n'],
		['a numeric description', 'name: ok\ndescription: 123\n']
	])('throws quiver_invalid on %s', (_, yaml) =>
		expect(() => parseQuiverYaml(yaml)).toThrow(expect.objectContaining({ code: 'quiver_invalid' }))
	);
});
