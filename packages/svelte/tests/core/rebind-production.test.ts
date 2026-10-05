import { describe, it, expect, vi } from 'vitest';
import type { EditorError } from '$lib/core';
import { reportRebindIgnored } from '$lib/core/rebind.svelte.js';

vi.mock('esm-env', () => ({ DEV: false, BROWSER: true, NODE: false }));

describe('reportRebindIgnored outside a development build', () => {
	it('reports at dev severity, and does not throw', () => {
		const errors: EditorError[] = [];
		expect(() => reportRebindIgnored((e) => errors.push(e), 'margin swapped')).not.toThrow();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ code: 'rebind-ignored', severity: 'dev' });
		expect(errors[0].message).toContain('margin');
	});
});
