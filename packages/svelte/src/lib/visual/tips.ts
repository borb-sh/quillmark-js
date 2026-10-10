// The tips channel: `$ext.editor.tips`, a list of authoring hints a
// quill or consumer seeds, which the editor only ever renders and clears.
// Editor-only chrome; never reaches the render backend, never gates, absent when
// the channel is empty (VISUAL_EDITOR §"Card operations").
//
// The channel narrowing the derive reads and the render the card paints. The write
// is `patchEditorExt` (ext.ts), the one door into the namespace.
import { core } from '../core/lifecycle.js';
import { reportError, errorMessage, type EditorErrorHandler } from '../core/errors.js';
import { renderContent, inlineSchema } from '../core/codec/index.js';

/**
 * Narrow a raw `$ext.editor.tips` value to the renderable channel. The channel is
 * CONSUMER-authored and opaque to the schema (nothing validates it on the way in)
 * so anything unusable drops here rather than reaching the card: a non-array, a
 * non-string element, a blank string. `[]` reads as "no tips" everywhere downstream.
 */
export function tipsChannel(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
}

/**
 * One tip's markdown as DOM: `importMarkdown` → `Content` → the codec's
 * `renderContent`. The tip is written in the body's mark vocabulary
 * (`strong`/`emph`/`code`/`link`) rather than by a second markdown renderer that
 * would drift from it.
 *
 * The inline schema, not the block one: a tip is a one-line hint, and
 * `decodeInline` folds stray lines to a space and drops island slots, so any string
 * produces one paragraph: no tip can change the card's block structure as the
 * cursor advances.
 *
 * Raw HTML does not survive the round-trip, so this is not the injection seam an
 * `{@html}` of the same string would be. A throw degrades to the literal text:
 * chrome never breaks the editor. The gate is read outside that catch — an
 * uninitialized core is not a tip that failed to render, and would otherwise be
 * reported as one.
 */
export function renderTip(markdown: string, onError?: EditorErrorHandler): Node {
	const { importMarkdown } = core();
	try {
		return renderContent(importMarkdown(markdown).content, inlineSchema);
	} catch (e) {
		reportError(onError, {
			code: 'tip-render-failed',
			severity: 'error',
			message: `a tip's markdown did not render; showing it literally: ${errorMessage(e)}`,
			cause: e
		});
		return document.createTextNode(markdown);
	}
}
