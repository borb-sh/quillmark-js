# @quillmark/svelte

Editor + live-preview components for [Quillmark](https://github.com/borb-sh/quillmark) WASM consumers. A WYSIWYG **VisualEditor**, and a canvas **Preview** that paints the compiled document and round-trips clicks to the editor, over one `@quillmark/wasm` session. Vanilla-TS cores with thin Svelte 5 wrappers.

## Install

```sh
npm install @quillmark/svelte
```

`svelte@^5.33` and `@quillmark/wasm` are peer dependencies: the session's handles cross the package boundary, so the consumer supplies the one copy both sides mint them from.

## Subpaths

Each subpath is its own module root; a bundler pulls only what the entry you import reaches.

| Import                      | Surface                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@quillmark/svelte/core`    | What the surfaces share: the `DocPath`/`Place` address vocabulary, the `EditorError` channel, `init`. No UI framework. |
| `@quillmark/svelte/preview` | The live preview: `createPreview` + `<Preview>`. Reaches nothing editor-side.                                          |
| `@quillmark/svelte/visual`  | The federated WYSIWYG: `<VisualEditor>`, the codec's `createField` prose leaf.                                         |
| `@quillmark/svelte`         | Re-exports `/core`.                                                                                                    |
| `@quillmark/svelte/preset`  | The opt-in stylesheet for the page around a surface ([THEMING.md](THEMING.md)).                                        |

## Open a session

The **consumer** owns the session and the handles, and drives every edit; the surfaces are views over it. The handles come from the `@quillmark/wasm` peer, never re-exported here.

```ts
import { Engine } from '@quillmark/wasm';
import { init } from '@quillmark/svelte/core';

// Quill and Document are exported only through init().
const { Quill, Document } = await init();

const quill = Quill.fromTree(tree); // tree: Map<string, Uint8Array> of the quill dir

// A NEW document: seeded from the quill's schema.
const doc = quill.seedDocument();

// An EXISTING document: parsed back from what you stored.
const doc = Document.parse(markdown); // canonical Quillmark markdown
const doc = Document.fromStored(json); // the versioned storage DTO (`doc.toStored()`)

const session = await new Engine().open(quill, doc);
// free() on teardown the handles you MINTED: this quill, this doc, this session.
```

`<VisualEditor>` needs no session, and the first `open` loads the render build, so a host that mounts the editor over `doc` and `quill` first shows it without waiting on that load. The session opens behind it: `await engine.load(quill)`, then `engine.open(quill, doc)`, so its first compile reads what was typed meanwhile ([INVARIANTS.md](prose/INVARIANTS.md#hosting)).

## The quill resolves from the document

A stored document carries none of its quill's bytes, only a reference: `doc.quillRef` is `name@version`, persisted in the markdown itself. Resolution is **host code**: read the ref, map it to a `Quill`, open. No surface resolves, so one resolution per document holds by construction.

```ts
const doc = Document.parse(stored); // Document, from the gate above
const quill = await registry.getQuill(doc.quillRef); // your ref → Quill mapping
const session = await new Engine().open(quill, doc);
```

`@quillmark/quiver` is one such registry, and the quill it hands back is **borrowed**: it is cached per ref and shared with every caller, so freeing it strands the next one.

Opening a document that names a **different** quill is the same sequence, in order: resolve the new ref, swap the editor's props, free the replaced handles that were yours to free, then open the next session behind the editor. `<VisualEditor>` re-keys itself on the new `doc` (see below); `<Preview>` swaps by remount (`{#key session}`).

## What a document is trusted to be

**A `Document` may be one its reader did not write** — an import, a shared file, a row from a multi-tenant store — and two properties hold over one regardless. Markdown becomes typed nodes and then DOM, never a markup string: this package has no `{@html}`, no `innerHTML` and no `eval`, so a document's text cannot become tags. And a link renders as one only for `http`, `https`, `mailto`, `tel`, `ftp`, or a value naming no scheme at all; every other scheme draws as an inert span, on the editable surface and in the tips card that paints `$ext.editor.tips` outside any `contenteditable`. That gate is the render's rather than the model's, so a refused href stays on the mark and round-trips: opening a document never edits it.

What stays yours is the text edge and the ref. The markdown is the host's at both ends, and `doc.quillRef` is the **document's** own — a stored file names the quill that opens it, so the ref → `Quill` mapping above is what bounds which templates it can reach.

## Preview

`createPreview` supplies the layer the session omits: viewport, DOM, DPR, click mapping. It is a pure view: it never calls `session.apply`; you drive the edit and hand it the resulting `ChangeSet`.

```ts
import { createPreview } from '@quillmark/svelte/preview';

const preview = createPreview(session, {
	container: document.querySelector('#preview')!,
	onPick: (at) => {
		/* a click resolved to an address, with a caret where the compile has one */
	},
	onError: (err) => {
		/* a page paint the backend refused; the preview shows its error state either way */
	}
});

// after an edit lands on `doc`, from any source:
preview.refresh(session.update(doc)); // repaint dirtyPages ∩ visible
```

In Svelte, `<Preview {session} onPick={…} />` exposes the same verbs (`refresh`, `scrollToField`, `focusPosition`, `endFollow`, `setZoom`) via `bind:this`.

`<Preview>` binds **once**, at mount: swapping `session`, `margin`, `onPick`, `onError` or `strings` in place changes nothing on screen and reports `rebind-ignored` through `onError` at `dev` severity, naming the prop. Swap by remounting (`{#key session}`); drive in-place edits through `refresh(change)`. `class` and `style` are the exceptions, landing on the root element and staying live.

## Visual editor

`<VisualEditor>` is a federated composition of many small editors over one document: each content leaf a ProseMirror prose surface, each scalar a form control, cards the editor's own. It commits directly to the `doc` handle.

```svelte
<script lang="ts">
	import { VisualEditor } from '@quillmark/svelte/visual';
</script>

<VisualEditor
	{doc}
	{quill}
	onChange={(change) => {
		/* an edit LANDED; `change.source` is 'prose' | 'field' | 'structure' */
	}}
	onActiveLeafChange={(active) => {
		/* the active leaf: `active.field` (a DocPath), and `active.cardId` for its card */
	}}
	onCaretMove={(at) => {
		/* the caret moved to `at.field` (a DocPath) at `at.pos` (UTF-16) */
	}}
	onError={(err) => {
		/* a failure the editor recovered from; editing continues */
	}}
	diagnostics={external}
/>
```

Hand it a different `doc` and the editor **re-keys itself**: every leaf remounts against the new handle, and the id state, the commit-error map and the active address seed fresh. `quill` is not part of that key — the schema is re-read on every derive, so a quill swap re-projects on its own; swapping it _without_ the doc reports `rebind-ignored`.

### Driving it from outside

`bind:this` reaches the same verbs the card header calls, so a toolbar, command palette or shortcut needs no second path into the document. Every one reports through `onChange` exactly as the click does.

```svelte
<script lang="ts">
	let editor: ReturnType<typeof VisualEditor> | undefined = $state();
	let activeCard = $state<string | undefined>();
</script>

<VisualEditor
	bind:this={editor}
	{doc}
	{quill}
	onActiveLeafChange={(a) => (activeCard = a.cardId)}
/>

<button onclick={() => editor?.insertCard('indorsement')}>Add indorsement</button>
<button onclick={() => activeCard && editor?.moveCard(activeCard, -1)}>Move up</button>
<button onclick={() => editor?.focusField('main.subject')}>Jump to subject</button>
```

`insertCard` hands back the new card's `cardId`; `removeCard`, `moveCard` and `setKind` take one. `focusField` reaches any mounted field: a prose leaf takes its view's focus, a form control the same handoff a click on its label takes, and either way the group holding it is revealed first. `washField` plays the same arrival wash over a field and nothing else, for a change the host wrote: focus, scroll and closed groups stay as they are, and a field in a closed group washes nothing. A card key or a path the surface does not hold is a no-op that reports `target-unknown` through `onError` at `dev` severity.

### Review

`review` is a list of what someone other than the reader, an assistant or a collaborator, changed in the document and what they propose to change. The editor draws each item where it is, in its own flow, and reports the reader's answers. The list is plain data, the host's to keep: an item is drawn while it is on the list.

```svelte
<VisualEditor
	bind:this={editor}
	{doc}
	{quill}
	review={items}
	onReview={({ id, action }) => {
		/* 'dismiss' | 'revert': take the item off the list; 'accept': leave it on while its
		   change should stay marked; 'reopen': put it back */
	}}
	onReviewFocus={(id) => {
		/* the item under the reader's attention, or undefined */
	}}
/>
```

An item names its place by the **blocks** of a rich text field or a body, by the ids `doc.blocks(addr)` reads; by an **anchor** in one; or by a **field**'s path:

```ts
type ReviewItem =
	| {
			id: string;
			state: 'proposed';
			field: DocPath;
			replace: string[];
			before?: string;
			after: string;
	  }
	| {
			id: string;
			state: 'proposed';
			field: DocPath;
			insert: { after: string } | { before: string } | 'end';
			after: string;
	  }
	| { id: string; state: 'changed'; anchor: string; before?: string }
	| { id: string; state: 'proposed'; anchor: string; after: string }
	| { id: string; state: 'changed'; field: DocPath; before?: unknown }
	| { id: string; state: 'proposed'; field: DocPath; before?: unknown; after?: unknown };
```

- **A change in text** is a line under the words that were written, or a small wedge where words were only removed (a point anchor). The pointer or the caret resting on it raises a card with `before`, the words it replaced, and **Undo**; Escape lowers the card and leaves the caret.
- **A proposal in text** reads the blocks `replace` names, or the paragraphs its anchor touches, as rewritten to `after`, Markdown: the words that would go are struck, the words that would come are tinted, and blocks it adds stand in flow where they would land, with **Accept** and **Dismiss** at the end of its last line. `''` proposes the blocks' removal. `insert` proposes new blocks after or before the block it names, or at the field's end, as a point anchor does after the paragraph holding it. A paragraph takes one proposal that rewrites it and one that adds after it, the first of each, whole. A word the proposal keeps and formats anew is drawn as a word it changes. The proposal is an edit of `before`, the blocks as its writer read them, or without one of the paragraph as it stood when the item arrived: what the reader writes in the paragraph meanwhile and while it stands is theirs, neither struck nor lost when the proposal is taken. Where the reader's writing meets the proposal's own words, the chip says **Edited since** and `onReviewDrawn` names the item `outdated`; where it reaches past them, the proposal reads as the whole paragraph as it now stands giving way to the whole of `after`. A block `replace` names that is gone, or that `before` does not read as, makes the proposal outdated too. A proposal that would write nothing, its paragraph already reading as proposed, draws nothing.
- **A change to a field** is a line along the foot of its control, with the same card. **A proposal for a field** stands under the control as the value that would go and the value that would come, with the same two answers, and is outdated where the field no longer holds its `before`. Two lines of words differ by their words. Two lists differ by their members: a member both hold is kept, one that goes is struck, one that comes is tinted. A record differs by the keys that change, each as `key:` with its old and new value, and in a list of records only the records that differ show, each named by its first value when that stays. Accept writes the whole value. A `text` field holds no anchors, so its review is its field's.
- An item in a closed group marks the group's header.

The host lays an anchor with the document's own `apply`, in the write that changes the text or on its own, and tells the editor the field moved. An id prefixed `~` is transient and never reaches the stored value.

```ts
const at = doc.read(addr).text.indexOf('disjoint');
doc.apply(addr, {
	steps: [
		{ splice: { at, delete: 'disjoint', insert: 'separate' } },
		{ anchor: { id: '~r1', start: at, end: at + 'separate'.length } }
	]
});
editor.applyExternal(doc.pathFor(addr));
items = [...items, { id: 'r1', state: 'changed', anchor: '~r1', before: 'disjoint' }];
```

Who writes an answer follows who holds the words:

| `action`  | What the reader did             | Who writes                                                                                                     |
| --------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `accept`  | Took a proposal.                | The editor, before the event: the proposal as it was drawn, as an edit of the reader's. `onChange` reports it. |
| `dismiss` | Turned a proposal down.         | No one.                                                                                                        |
| `revert`  | Asked for a change back.        | The host, which alone knows the inverse of what it wrote, followed by `applyExternal` or `refresh`.            |
| `reopen`  | Undid an accept or a dismissal. | The editor, before the event: what an accept wrote is taken back. The item is open again.                      |

An accepted proposal the list still holds is drawn as the change it made: the words it wrote underlined, a wedge where it only removed words, and a field's control marked along its foot, each with the card that shows what stood there and **Undo**. Undo takes back what the accept wrote, the old words with their formatting or the old value, as an edit of the reader's, out of order and past whatever the reader has typed beside it, and reports `reopen`: the item is a proposal again. Words the reader typed inside the accepted ones go with them, and a mark whose words are all gone, or a field set to another value since, drops without a report. With the caret in the mark, ⌘/Ctrl+. does what Undo does. The marks are the mounted editor's and are not stored: a leaf that mounts again shows the text as it stands, and the item reports as `applied`.

A dismissed item is drawn no more from the moment of the answer. ⌘Z/Ctrl+Z from anywhere in the editor takes back the answers given since the reader's last edit, newest first, one answer or one `answerReview` call at a time, and each comes back as `reopen`; past that edit a taken proposal is still undone in its own text field, with its `reopen`, and a field's value and a dismissal are final. A field's accept and a batch stand on the toast with their way back. So the host's side of a round is: on `dismiss`, take the item off the list and leave its anchor where it is; on `accept`, leave it on to keep its change marked, and take it off to keep the change unmarked; on `reopen`, put the item back; when the round ends, the reader keeping the changes, a new answer arriving or the document closing, take the items off and lift the anchors (`{ anchor: { id, remove: true } }`). A `~` anchor never reaches the stored value, so one left standing costs nothing, and a host that ignores `reopen` keeps the text the undo brought back. A field's proposal the schema refuses stays, unanswered, and the field says why as it does for any refused value.

`onReviewDrawn` reports what the editor draws of the list, on each change once the leaves have drawn: `order`, the items drawn in document order; `accepted`, those of them drawn as accepted changes; `outdated`, the open proposals the reader's own writing meets, which a host accepting on arrival leaves open; and `undrawn`, every listed item it does not draw, each with why: `anchor` (no mounted leaf holds it), `block` (no block it names stands in its field), `field` (the path names no field the editor holds, or a proposal names a place inside one), `parse` (`after` is not Markdown the leaf reads), `taken` (an earlier item has the paragraph or the field) or `applied` (the text already reads as proposed). A host's count and its next and previous read `order`, so they agree with the page.

The verbs complete it. `answerReview(ids | 'all', 'accept' | 'dismiss' | 'reopen')` answers items as their buttons would, in document order, and returns the ids answered: `onReview` hears each, an accept and a dismissal pass over a change and over a proposal already accepted, `'reopen'` takes back each accepted one as its Undo does, an item that cannot be answered stands, and neither the focus nor the caret moves. A host that accepts on arrival sets `review`, awaits Svelte's `tick()`, and calls `answerReview('all', 'accept')`: the list has reached the leaves by then and the browser has not painted it, so no proposal shows on the way to its change. One that leaves an outdated proposal open accepts the ids of `order` that are not `outdated`, from the first `onReviewDrawn` the list raises, which arrives before the paint too. `stepReview(1 | -1)` brings the next or previous drawn item to the reader, round from either end, with the caret in it or the focus in its field (`{ focus: false }` only lights it), and resolves its id. `revealReview(id)` brings one item to the reader: it opens the group holding the item, scrolls it to the middle of the pane, lights it and raises its card, and resolves `false` for an item the editor does not draw; `{ focus: true }` also puts the caret in it. `offerUndo(notice, undo)` offers one step back from a write the host just made, such as an assistant's whole answer: `notice` on the toast a removal's undo takes, and ⌘Z/Ctrl+Z anywhere in the editor until the reader's next edit lands. It returns the offer's withdrawal.

With the caret in an item, or the focus in its field, `REVIEW_KEYS` answer it: ⌘/Ctrl+Enter accepts a proposal, and ⌘/Ctrl+. dismisses one or asks for a change back. From anywhere in the editor ⌘/Ctrl+⌥/Alt+↓ and ↑ step to the next and previous item, as `stepReview` does. An answer given by a chord goes on to the next item, so ⌘/Ctrl+Enter pressed down a batch walks it; `reviewAdvance={false}` keeps the caret where the answer was given, and an answer by pointer never moves it. The caret is in the item that holds it closest, so in a changed word inside a proposal's paragraph ⌘/Ctrl+. asks for the change back, and ⌘/Ctrl+Enter takes the proposal still. A proposal that only adds blocks answers from anywhere in the paragraph it adds after; where a proposal also rewrites that paragraph, the caret answers the rewrite, and `revealReview(id, { focus: true })` puts it in the one asked for. Every word the review draws is a `strings` key, and its one hue is `--qm-review` ([THEMING.md](THEMING.md)).

### Wording

The package ships English and a seam to replace it. `strings` is keyed and **partial**: set what you have translations for, and the rest stay the package's. Several keys are **accessible names** rather than decoration (the card controls, the add trigger), so an untranslated surface reads the wrong language to a screen reader. `DEFAULT_VISUAL_STRINGS` is the English, exported so you can compose against it. `<Preview>` takes its own `strings`: the states it shows when there is nothing to paint, the zoom pill's action, and the names a screen reader hears for the pane and each page.

```svelte
<VisualEditor
	{doc}
	{quill}
	strings={{
		cardDelete: 'Supprimer la carte',
		addCard: '+ Ajouter une carte'
	}}
	formatDiagnostic={(d) =>
		d.code === 'validation::type_mismatch' ? `${d.path} : type incorrect` : undefined}
/>
```

`formatDiagnostic` gets the whole `Diagnostic` and returns `undefined` to take its own message. Validation and edit diagnostics re-word from `code`, `path` and `args`; parse errors and render warnings carry their detail inside English text and stand as they are ([INVARIANTS.md](prose/INVARIANTS.md#diagnostics)).

### Fonts

A run of text can be set in a font family the **host** supplies, spelled `<qm-span family="…">` in markdown. Build the engine with the font files (`.ttf`, `.otf`, `.ttc`, `.otc`) and hand the editor the faces it lists: the format popover then offers each family, and the editor registers the faces with the page so a run draws in the face the preview sets it in.

```ts
const carlito = new Uint8Array(await (await fetch('/fonts/Carlito-Regular.ttf')).arrayBuffer());
const engine = new Engine({ fonts: [carlito] });
```

```svelte
<script lang="ts">
	let fonts = $state<FontFace[]>([]);
	engine.fontFaces(quill).then((faces) => (fonts = faces));
</script>

<VisualEditor {doc} {quill} {fonts} />
```

[`@quillmark/fonts`](../fonts) is the library every Quillmark client builds its engine over, so a family a document names sets the same way in each; a host's own files go after it. `fontFaces` loads the render build, as `open` does, so mount the editor first and let the faces arrive behind it. A family the document already sets edits with no library at all, and the picker offers it so it can be cleared.

### Recompiling

`onChange` is the signal to recompile, and it covers **all three lanes**: a prose keystroke, a scalar write, a card operation. `onCaretMove` is a _selection_ signal, not a change signal: it fires on a bare arrow key, so a recompile hung off it recompiles on every one.

```ts
let timer: ReturnType<typeof setTimeout> | undefined;

onChange: (change) => {
	// a structure op happens once per gesture, so it applies at once;
	// prose and field edits arrive per keystroke, so they debounce.
	if (change.source === 'structure') recompileNow();
	else {
		clearTimeout(timer);
		timer = setTimeout(recompileNow, 120);
	}
};

function recompileNow() {
	timer = undefined;
	const change = session.update(doc);
	preview.refresh(change);
	source.refresh();
	diagnostics = [...session.warnings]; // → the editor's `diagnostics` prop
}
```

`session.warnings` is a **getter on a handle Svelte does not track**: pull it per apply, or the editor shows the previous compile's errors.

The schedule is host policy, so the package ships no scheduler. Obligations: an edit of your own (an import, an undo, a direct `doc` write) recompiles by the same calls, since nothing polls the document; a compile re-reads the diagnostics; and teardown clears the timer **before** freeing the handles.

## The caret bridge

The bridge lives at the **consumer** layer and is opt-in; the editor is unaware of the preview, the preview unaware of the editor. Both hops are pass-throughs: the two surfaces already speak one address grammar, the canonical `DocPath`.

```ts
// preview → editor: a click resolved to an address lands in the field it names.
onPick: (at) => visualEditor.setCaret(at);

// editor → preview: a caret move scrolls the preview to follow it,
// and a focus into a leaf with no caret to report ends the follow.
onCaretMove: preview.focusPosition;
onActiveLeafChange: preview.endFollow;
```

Both editor→preview hops or neither. A control reports its focus and no caret — there is no offset a date field could name — so without the second the preview keeps following the leaf the focus left, and every recompile pulls the pane back to it. A prose leaf restarts the follow with its next caret. A host that reads the active leaf for its own chrome calls `endFollow` from its handler.

A pick carries a caret where the compile tracks the content under the point, and the field alone where it tracks only the placement — a scalar the plate prints without tracking. `setCaret` takes both: an absent `pos` reveals and focuses the field, which is the whole of what a click on plate-placed ink can mean. The address may name an array element (`main.keywords[0]`), which lands on that row.

A consumer holding an `Addr` of its own maps it with `fieldPathForAddr` (from `@quillmark/svelte/core`). The playground app's split-pane route is the full reference shell: one session, both bridge directions, the preview following edits, and diagnostics routed inline.

## Errors

Every surface takes `onError`. It reports failures the surface **recovered from**: a commit the boundary refused, a card operation that threw, a page paint that failed, a serialize that threw. None of them stop editing. Wire nothing and each lands in the console.

```ts
onError: (err) => {
	// err.code: 'commit-refused' | 'paint-failed' | … (see EditorErrorCode)
	// err.severity: 'error' (runtime) | 'dev' (a contract violation)
	// err.cause: whatever was thrown, unwrapped
	if (err.severity === 'error') telemetry.capture(err);
};
```

This is not the diagnostics channel. A `Diagnostic` is about the **document** and draws on the field it belongs to; an `EditorError` is about the **surface** and draws nowhere. A refused scalar commit produces both.

## Canonical markdown

`doc.toMarkdown()` returns the document's canonical Quillmark markdown, which re-parses to an equal `Document`. A read-only mirror is that call in a `<pre>`, re-run after each edit lands, so it needs no surface from this package:

```ts
el.textContent = doc.toMarkdown();
```

## Theming

The surfaces carry the behavior against a neutral, overridable visual baseline: a set of `--qm-*` CSS custom properties you override on any ancestor. See [`THEMING.md`](THEMING.md).

## Development

This package is one workspace of [`quillmark-js`](../..); the gates are the root's, and the rules a change must keep live in [`prose/INVARIANTS.md`](prose/INVARIANTS.md).

```sh
npm run build -w packages/svelte   # svelte-package → dist/
npm run test  -w packages/svelte   # Vitest
npm run check -w packages/svelte   # svelte-check
npm run dev                        # the playground, from the root
```
