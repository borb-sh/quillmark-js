# @quillmark/svelte invariants

The rules a change to `@quillmark/svelte` must keep, the reason behind each, and the designs already weighed and rejected. What the package exports and how a host mounts it is the [README](../README.md); the theming contract is [THEMING.md](../THEMING.md); the document model, the WASM boundary and diagnostics are quillmark's (quillmark/INVARIANTS). A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## Core vs chrome

**The core carries the substance and the chrome stays thin.** A vanilla TS core with no UI framework holds the WASM boundary, the codec and its ProseMirror integration, and the preview's paint loop, and its `.d.ts` depend on no framework. The Svelte chrome is components and `.svelte.ts` modules over it. A second binding would be a re-export of `/core`, not a rewrite.

**The chrome is Svelte 5 throughout.** Every component compiles in runes mode, and where Svelte 5 names a successor to a Svelte 4 idiom, the code writes the successor. The compiler refuses half of the old forms and `check:svelte` the rest; the framework-free core is outside the rule and keeps its own listeners.

## Packaging

**One package with subpath exports.** Rejected: separate packages. The one thing a split would buy, a preview-only consumer not pulling ProseMirror, is what separate module roots already give, and the surfaces share a substrate that co-evolves, so independent versions would be cost with no payer.

**A subpath is a promise**, so it carries a surface a consumer builds with, not a wrapper over one public call.

**`/core` declares what more than one surface speaks, and nothing more**: the address vocabulary and the error channel. Declaring either per subpath would force an import across a boundary the package keeps closed, or a structural copy that drifts.

**The `@quillmark/wasm` API is not re-exported.** Package code and consumers import it from the peer directly, so every symbol has one import path (`check:deps`).

**`/preview` imports nothing editor-side.** Its audience (a viewer, a share page, a CI screenshot) is not editing, and bundle weight is what makes the subpath claim true. `check:deps` holds the edge.

## Styling

**A plain skin over dense behaviour**: monochrome and typographic, with hierarchy from size, tone and whitespace, so a consumer's override is the design rather than a fight with a decorated one. The chrome names everything at one weight; a second weight is reserved for a run where weight is the only signal it has.

**A component reads a rung, it does not mint a value.** `core/theme.css` is the only file that mints a value for the surfaces: the public `--qm-*` dials in, a closed private `--_qm-*` scale out. The shared recipes (`visual/controls.css`, `codec/prose.css`) are rules more than one component draws; the preset is the same shape one level up, for the host page. `check:style` holds the rule over the package and each app.

**Consumer CSS outranks the package without `!important`.** Every package selector is wrapped in `:where()` with no layer, whatever order a bundler emits the sheets in, and the promised root classes are drawn `:global(:where(…))`. `check:style` holds the zero rank on every class THEMING promises.

**The shell is CSS on the host's own elements, never a component**, so the wiring stays the consumer's.

**Light and dark is the host's declared `color-scheme`**, read through `light-dark()`, so a colour pole states both arms. Motion durations are rungs, so `prefers-reduced-motion` collapses the scale rather than a roster of selectors. A surface hidden by geometry is `inert`, not merely unpainted.

**The interior DOM is not contract**, so the surfaces can re-cut it. The contract is THEMING's dials and mounted root classes.

### A plane is a tone, not an outline

**A surface in the flow is lifted off what it sits on by its fill, never by a line around it**, and the raised plane is the brighter one in both schemes. Where a card reads too faint against the ground, the fix is the derivation's, never a border. Three kinds of stroke survive, each saying something a fill cannot:

- **A stroke that structures**: a section's vertical, a table's rules, an `hr`. Depth is a ladder of verticals one `--_qm-nest` apart, never a rule across the block.
- **A stroke on something floating**: a menu, a popover, the table island's alignment cluster, which have no plane under them to step off.
- **A stroke that is a state**: the dashed edge on a card the schema cannot project.

Under `forced-colors: active` a fill is dropped, so there a card draws a `CanvasText` edge in place of its tone, the one outline a plane takes.

## The boundary

**Adding a construct upstream is a compile error here.** Block kinds, container kinds, mark types and island types are closed past their `x-` names, and each place that names a set names it against the boundary's own union (an exhaustive `switch`, a `satisfies`, a `Record` keyed by the union). Rejected: a literal check, which compiles unchanged against a widened union and silently drops the new member.

**Shapes are read straight off the boundary**, with no local duplicates. A `props` that crossed the DOM as JSON is the one place the codec reads a shape itself.

**One address crosses.** `Diagnostic.path`, `ContentHit.field` and `FieldRegion.field` are one canonical `DocPath`, so a diagnostic and a geometry address for one place join on equality. The package routes with `parseDocPath` and builds with `formatDocPath`. Rejected: a hand-rolled grammar.

**A content field is read through the schema, never raw.** A field can rest as a content object or as the authored string a transport-door load left, and the reader decodes by declared type at any depth, so the storage form is never the editor's business.

**The editor drives neither ingestion verb.** It is handed a `Document` and edits it; which door built one is the host's business.

**`init` latches.** Code that cannot await (the `DocPath` formatter, the codec inside a transaction) reads the latched gate, which throws naming the fix rather than reading `undefined`.

## The visual editor

### Federated, not monolithic

**Each content leaf is its own ProseMirror state, view, history and plugins**, and a Svelte tree renders the schema around them. Rejected: one PM document spanning the page, which would re-encode the document's schema tree as nodes and re-derive every address from tree position, through a serializer, a patched parser and a lossy fallback.

### Structure mirrors the schema

**The layout is a projection of `quill.schema` joined against the live payload**, and the editor performs that join itself; quillmark has no projection for an editing surface.

**A body and a `richtext` field are one kind of leaf**, differing only in address, so there is one field list with controls chosen by type and no metadata-vs-body mode.

**A prose leaf over content its schema cannot edit holds read-only** rather than writing the loss back, judged off the value itself.

**Commit is by value below a field's address.** A nested row has no op address, so at depth a keystroke commits the whole field, a bound the design accepts.

**A run of commits to one field derives once.** Its commits past the first rebuild the one card from the one field's value, and the whole-document derive, validation with it, lands when the run rests, so a by-value keystroke costs what its card holds rather than what the document does. A commit that sets or unsets the field derives at once, since it moves what the field's default shows.

**`ui` hints drive layout, not structure.**

**Layout is CSS's, not JavaScript's.** A section is one grid and a container query steps the column count. Nothing measures, so there is no observer to loop and no resize that remounts a prose leaf.

### The commitment ladder

**Per field: the authored value, else the `default:` where it prints, else words about the value.**

- **A default that prints is drawn a step off the ink, and nothing is written until an edit takes it**, so tabbing through a card freezes nothing against the next quill version. An undo back to the default a text leaf or a number input held unwritten unsets the field, so taking every edit back freezes nothing either.
- **Emptying a control writes what empty means for its field**: the empty answer where a default would otherwise print, a removed key for an optional cell, an unset for a number.
- **A card's field that holds one value says at its label where it stands against a default that prints**: a tag while the default is what shows, and once written, one reset there that unsets the field. Rejected: the way back inside each control, which a listbox has a row for and a text field has nowhere for, emptying it being the empty answer.

**No field is required and nothing gates.** An incomplete document edits and renders; completeness is the host's read of `quill.validate(doc)`. Document-level guidance rides the tips card, never a per-field surface.

### The address is the spine

**Every editable unit is keyed by an address**: what `apply` targets, what the preview bridge speaks, what a diagnostic routes to and what Svelte keys the tree on.

**A card is keyed by a session key, resolved to an index only at the mutation boundary.** A reorder moves keys, so no leaf remounts and no caret is lost. Card identity is gone on reload.

**Every payload naming a card carries its `cardId` beside its address**, because an address names a different card after a move. With no card handle in the document, the key list is the identity, so the editor owns structural mutation for the session.

**Every hook naming a place speaks the canonical `DocPath`**, so wiring the editor to the preview is a pass-through. `Addr` stays the mutator currency.

### Edits are ops

**The editor writes ops at an address, never markdown and never a whole-document re-serialize.** A prose leaf lowers each transaction to a `Change` for `doc.apply`, so anchors move with their text; a scalar, an array or an object goes through the typed writer; structure goes through the card verbs.

**One hook reports every lane.** `onChange` carries an `EditorChange` whose `source` names the lane, so a host recompiles off one hook and reads `source` only to schedule.

### Card operations

**A card is seeded and inserted in one mutation**; no placeholder card exists before it is real.

**A retype inserts the new card before removing the old**, so a refusal leaves the document as it was. The chrome offers no switch for a declared kind: a card's kind is fixed once it exists.

**A removed card is kept for the session.** Nothing else holds a card once it is gone, so its step outlives the toast that offers it: a control at the stack's foot names the newest one, and ⌘Z reaches it with no toast up only until the next edit lands, so the key never brings back a card the user has worked past. A review answer is no such edit, so an answer given over the step and taken back by ⌘Z leaves the step the key's again; and a card a review's removal takes out is no such step, the answer journal holding it (§Review). The restore names the cards it stood between, not an index, so no later card operation unseats it. A row's removal is offered once and withdrawn by any other structural edit, its list's own history being what holds it after. A timer as the only way back to a card was rejected: a card can hold pages, and six seconds is shorter than noticing a mistake.

**The `$ext.editor` namespace is the write unit, and one verb owns it.** `storeExt` replaces the whole `$ext` map, so every write goes through `patchEditorExt`, which merges and drops keys; that is what keeps a tips dismissal from wiping every card's title. An emptied namespace removes itself. The backend never sees the namespace.

### Focus and the preview bridge

**Every mounted field is a landing target**, a scalar as much as a prose leaf, since on a memo the scalar front matter is half of what the preview can name.

**A landing reveals first, with the minimum scroll**: a line clear of the fold and never a centring, since its commonest target is the leaf already focused.

**A landing's mark decays.** Resting ink would outlive the hop.

### Teardown and the swap

**One order, held by every surface: unregister, cancel, then free.** A continuation that crosses an `await tick()` asks the surface's `Lifespan` whether it still exists before acting, so a destroy that lands mid-flight cannot dispatch into a dead view.

**A different document remounts the editor.** The state a swap invalidates is spread across every leaf, so a remount is the one correct reset. A once-bound prop swapped under a mounted surface reports `rebind-ignored`.

### Chrome

**Editing chrome is per leaf; structural chrome is Svelte in the shell.**

- **The formatting popover answers a selection, never a pointer**, and asks the view it would act on, so it withholds itself over a `text` leaf. It takes the focus only by its own key, and then holds it until Escape hands it back to the selection. Font families come from the host's library, not the quill's.
- **An input rule declines only where its result is unrepresentable or belongs to another gesture**, never on how a quill would render it, since what a quill typesets is not knowable here. Backspace right after a rule takes it back.
- **An input rule runs the command its slash pick runs**, so a construct's two doors are one implementation and cannot drift apart.
- **Each body key is one chain of links, innermost surface first**, so the nearest surface answers. A key edits its own block; an item's number is its position and no keystroke writes one; Tab is structural in a body and free for navigation in a one-line field; Escape hands the next Tab or Shift-Tab to the browser, the focus staying in the leaf until that key moves it, and a Tab the body held names that way out beside the leaf; no gesture nests past the store's depth bound. Escape blurring the leaf was rejected: the focus is then drawn nowhere, and Shift-Tab from a blurred body lands back in the body.
- **A floating surface stands in the editor's frame and tracks a live element, never a rect measured once.** It portals into the nearest `[data-qm-root]`, so the consumer's dials reach it, and is placed absolutely in that root, which is positioned, so a pane that scrolls carries the surface with its text and only a reflow asks for a new place. Rejected: fixed placement re-done on each scroll event, which a scroll the compositor runs ahead of leaves a frame behind its anchor for as long as the pane moves.
- **A date field is one Tab stop.** The stop is the segment the focus is on, the first while the focus is elsewhere; the arrows walk the segments and one step past the last onto the Today toggle, so nothing in the field is out of the keyboard's reach and Tab always leaves it. Rejected: a stop per segment and one for the toggle, as the primitive ships them, which made each date four Tabs of a card's walk.
- **A field's own chrome waits for the field.** The guidance marker and the way back to a default are absent until the pointer or the focus is in their field, the whole of it, label and control: the moment a reader is on a field is the moment its guidance matters, and a quiet page reads faster. Each holds its box meanwhile and arrives by opacity, so arriving moves nothing. A marker stays while its surface is open, the keyboard raises guidance from the control by `Mod-/` whether or not the marker is drawn, and where nothing hovers both rest drawn, a tap being their only door. Rejected: the marker drawn at rest so a reader sees that guidance exists before touching anything, which stands a glyph against every label on a card that describes every field.

### Diagnostics

**Only errors draw**; warnings stay the host's to read.

**A diagnostic draws at the nearest cell the tree holds.** It routes to its field, and the field walks it down to the cell its path names, or carries it under a collapsed row's head or a closed panel's header, so nothing is lost on the way down.

**What a diagnostic says is the consumer's, up to a residue.** Validation and edit codes can be re-worded from `args`; parse and render messages carry backend prose no string table can key, so the built-in text stands there.

**A diagnostic is heard from one standing region, never from its own list.** The editor keeps one hidden status region mounted and empty, and says in it the errors the page draws once they have changed and held still: one error with its field, several as a count and their fields, the last one clearing once (`diagAnnounced`). What a mount starts from is not a change, and a set that returns to what was last said says nothing, so a host validating on every keystroke speaks when the typing rests. The list stays its control's error message, heard on arriving at the control. Rejected: `role="status"` on each list, which enters the page with its text already in it, so a screen reader may not say it, and which a host's batch raises once per field; and sharing the undo toast's region, which is read whole, so a diagnostic would repeat the toast standing in it.

**Diagnostics are not the error channel.** A `Diagnostic` is about the document and draws on its field; an `EditorError` is about the surface, a failure it already recovered from, and reaches `onError`.

### What the surface says

**Every built-in string is a key, and `strings` is partial**, so wording is an override rather than a fork. Many are accessible names, which is why this is a seam. `Preview` carries its own set, since a shared module would be an edge back into the editor.

### Enums

**Enum policy is a deployment's, so it is a prop rather than a per-option verdict.** Disabled is a promise that some state would allow the option; hidden is for one the deployment does not carry at all. The selected value is always drawn. The blank is the boundary's and the control mints none.

**A variant flip keeps the other worlds' answers**, because the boundary deliberately carries them, so comparing worlds costs nothing.

### The matrix

**The control composes each member's schema from the roster and the field's properties**, since the boundary serializes only the roster. The document keeps no answer for an unheld member, so the control keeps an unticked member's columns for the mount. Commit is whole, through one `writer.set`. A proposal for a cell of an unheld member shows the member held, since taking it writes the member, and unticking that member turns the proposal down; drawn unheld, the member has no cell to mark, and the proposal is reported open with nothing on the page.

### Surface

**A host that changes the document says so.** The editor owns structural mutation, so a host that wrote the document itself re-reads one prose leaf, re-derives the card tree, or moves card keys through inserts, removes and moves so surviving cards keep their leaves and carets. A target the surface does not hold is a no-op reporting `target-unknown`.

**A nested address is a target through its field.** The boundary names elements and cells `Addr` cannot reach, so a landing checks each step against the schema and hands the walk to the field's control, each rung resolving its own step at the point of use.

### Review

**Review is the host's list, drawn in the editor's own flow.** An item is a proposal, plain data naming blocks of a field by their ids or a field's path, and it draws where that is: a decoration in the leaf, a mark on the control, a card it adds as a preview where the card would stand, a card it takes out marked where it stands. Nothing is measured from outside a view, so an item rides every edit and reflow, and nothing of it enters the document, the commit, a leaf's history or a collaborator's copy while it stands. Rejected: an overlay laid over the editor, which re-measures on every change and parts from the text it describes; a host render slot, which hands reconciliation to consumer code; suggestion marks in the content, which every reader of the content would have to know to skip; anchors the host lays in the content to place a proposal, which every host wrote and lifted again around each answer, where the leaf's blocks already carry ids; and `changed` items, a host's own writes drawn for review with a `revert` the host answered, which no host sent once every change starts as a proposal.

**A proposal is drawn and taken from one plan.** The leaf pairs the proposal's blocks with the paragraphs it names and derives the pieces once: the stretches to replace, the blocks to lift, the blocks to add. The decorations are those pieces drawn, and taking the proposal is those pieces as one transaction, so what lands is what was read. Rejected: the host writing an accepted proposal with the store's block verbs, which place Markdown by rules of their own, so the drawn proposal and the written one part inside a list.

**Who writes follows who holds the words.** A proposal carries what it would write, so taking it is the editor's edit, down the lane a reader's takes: a leaf's transaction, in its history; a field's value, through the typed writer. A card added or taken out is a review item too, written by the editor as one of the reader's card operations, the added card under the `$id` its proposal carries, and reported as a structure change. Answering leaves the caret and the focus where they were. Every answer since the reader's last edit is held in the answer journal, newest first, one entry per answer or per `answerReview` call, and ⌘Z anywhere in the editor, or on the host's chrome outside a text box, takes back the newest: a leaf's accept by that leaf's own undo, which carries the answer in its history, a field's accept by writing the value it replaced, a card's accept by the card operation that undoes it, a dismissal by opening it again, each reported as `reopen` and drawn again from the list that still holds it. The journal is not one undo stack for the document: it holds review answers alone, and the first ordinary edit ends it, an inverse being good against the document it was recorded over and no other. Its writes and its undoes go down the lanes an edit takes, so they are flagged as the answer's while they are made. Turning a proposal down writes nothing. No answer raises a toast: ⌘Z is the way back from every one, and a notice per answer over a review of dozens is noise the reader learns to dismiss. A host's `answerReview` batch is taken back as one entry. Rejected: the host writing an accepted card with `applyCardOps`, which leaves it off the journal, so ⌘Z after an accept reached the reader's last typing instead.

**A proposal is an edit of the paragraph as its writer read it.** An item naming blocks carries `before`, the blocks as the assistant read them, and the leaf carries each stretch the proposal rewrites in them through what the reader has written since; without one, the leaf keeps the blocks the proposal covered when it first drew it and carries from those. Typing while the assistant answers and typing after its answer arrives take that one path: words typed beside a stretch stay outside it, and a word rewritten under one is struck as it now reads. So what the reader writes in the paragraph is neither struck while the proposal stands nor lost when it is taken. Where the reader's writing meets a stretch the proposal changes, taking it writes over the reader's words, so the proposal is outdated, said on the answer card and in the report; where that writing reaches past the stretch, the proposal draws as the whole paragraph as it now reads giving way to the whole proposed one, since a stretch carried onto words it was never computed against writes a sentence nobody proposed. A block it names that is gone, or that `before` does not read as one block for each id, outdates it too, and a block the store takes again under a new id, as it does one an undo puts back, is still the block it named, where a split's second half, which copied the id, is not, as a field's proposal is outdated where the field no longer holds its `before`, a field of words excepted, which carries its proposal as a paragraph does (§"A field's proposal is drawn in its control"). A base kept from the first draw is the mounted leaf's, by item id, outlives the item's answer while one of its blocks stands, and is read anew when the item arrives with another `after`. Rejected: diffing the paragraph as it stands against `after`, which strikes every word the reader adds and removes it on Accept; and the host writing the answer over the live document to derive the proposal, which puts the reader's new words inside the stretch the proposal replaces.

**A paragraph takes one proposal of each kind, whole.** The diff inside it is drawn by the word and answered by the paragraph: a sentence taken a word at a time is one nobody proposed and nobody read. A paragraph holds one proposal that rewrites it and one that only adds after it, the first item of each kind naming it, since a rewrite and an added paragraph is a normal thing for a model to return; a third would land in an order the drawing does not show. The caret answers the rewrite of the two, and the one it was put into by id while it stays there. A proposal whose plan writes nothing draws nothing and is reported `applied`, since its Accept would answer without writing.

**What the reader does beside a batch costs what it touches.** A proofread leaves dozens of proposals open in one leaf while the reader types, so a paragraph's diffs are kept against the paragraph nodes they were made from, which an edit elsewhere leaves the same objects, and only the paragraph a keystroke changed is diffed again. The lit item is not part of what is drawn: attention moving makes the few decorations that read it again, in a leaf that draws the item it left or the one it reached, and no other leaf hears of it. Keying the drawing on the whole document and on the lit item was rejected: every keystroke and every hover then diffed every proposal in every leaf.

**A place inside a field is proposed on its own, and written as the field.** A memo header is one record, and a proposal for the whole of it is a row of raw data nobody can answer a line at a time; so an item names a cell or a member by its path, a choice with variants its discriminant and each cell of its world, and a checklist each member it ticks or unticks and each cell of a member it keeps, routed down the rungs a nested diagnostic takes and marked on the control of that place. Taking it writes the field's whole value with that place alone changed, down the commit an edit of the cell takes, so the record writes itself as it does for the reader. Its inverse in the journal writes the whole value it replaced back, which is exact because the journal takes answers back newest first and ends at the reader's first edit. A list's member is found by the `before` it carries, the nearest member holding it that no other open proposal of the list has found, since an index alone moves under every member another accept takes out. Rejected: a writer of its own for nested places, which would part from what the cell's own commit checks.

**The editor reports what it draws, and why not.** A host counts its list and steps through it by what the editor says it draws, in the page's order, and every listed item it does not draw is reported with why: a host counting its own list says "9 open" over a page showing none, and its next stops on items nothing shows. The leaves report what they hold, the surface what its fields hold, and an item no leaf reports is anchored nowhere, decided only once the leaves a list mounted have drawn. An item naming blocks is handed to the leaf of the field it names alone, so a block id another field holds too never draws there. The editor ships the data, the verbs `answerReview` and `stepReview`, and the answer card, and no bar of its own, the shell being the host's (§Styling).

**An answered item is drawn no more, from the answer.** The leaf and the surface each drop it at the press, until a list arrives without it, so the reader's answer shows at once however long the host takes to hand over the next list.

**The host sets the list once and clears it once.** Every answer's drawing is the editor's: an answered item hidden, a reopened one drawn again, each while the list holds it. So a host sets the list when an answer arrives and clears it when the reader keeps the result or asks again, and between the two leaves it alone. A host taking each answered item off its list was the contract this replaces: every host rewrote the editor's bookkeeping, and a list handed over mid-answer raced the editor's own.

**An answer's list is made from what its writer read.** `proposalsBetween` compares the document as the assistant read it with the document it left, never with the live one, and the editor compares each item with the live document as it draws. A host that merges the answer into the live document first and diffs the result reads the reader's typing meanwhile as the assistant's, and lays the very collisions it then cannot see.

**The page's order is derived, never read off the page.** The order the editor reports and steps in comes from what it holds: the card stack, each card's fields as `cardLayout` lays them out, a place inside a field by the layout its schema declares (`rankAt`), and each leaf's report, which lists its items in the leaf's order. So the order is known before a leaf has mounted, and the review store needs no editor to say it. Places one mark stands for, the cells of a collapsed row, are ordered as the open row would draw them. Rejected: walking the page for `[data-qm-review]`, which made the order something only a mounted editor knew, and put an item not yet mounted last until it was.

**A list names its cards as they stood when it was set.** A path names its card by index, and a card item names the card it removes or follows by index too, so a card written while the review is open moves every later card's index. The editor reads each item's card index against its own card keys as they stood when the list arrived, and resolves it to where that card stands now, through `applyCardOps` and the reader's own card edits alike; a card gone takes its items with it, reported `undrawn` as `field`, and a removal whose card is gone is reported `applied`. Added cards that follow one card stand in the list's order, each after the card the one before it wrote. A list the host sets anew is read against the cards as they stand then. Rejected: a path that names its card by id, which the `DocPath` grammar the boundary owns does not carry; and holding a card's write until the review closes, which leaves an accepted card off the page while the reader goes on reviewing.

**Accept leaves plain text.** A proposal taken is the document's, the reader's to edit like any other words, and the editor keeps no record of it past the answer journal: the leaf's own history takes an accept back with ⌘Z, and the journal ends at the reader's first edit. A host that offers to take a whole answer back keeps its own snapshot of the document from before it, restoring it with whatever the reader wrote since. Rejected: a record of each accept's stretches and the slices they replaced, mapped through every later transaction, which drew a line under what an accept wrote and took one change back out of order past the reader's typing; a line under changed words reads as underline formatting, says nothing a reader who pressed Accept does not know, and carried a card, a chord and a per-place inverse for a way back no host used.

**Added and removed have one look everywhere.** The tint means *would come*, and nothing that would go wears it. A member, a row or a card a proposal adds is drawn as it would stand, a row in its own controls and a card as a preview listing each field it fills, each box under the tint and the current one ringed in the review line. A member, a row or a card a proposal takes out keeps its place and its own ground, ringed in the review line outside its edge, its values dimmed and struck and its labels left alone, and says *Proposed removal* in its own header where it has one. Neither takes room the reader's form does not already give it, so a review opening or closing moves nothing. Rejected: a removed row under the tint, which said *would come* of a row that would go; an added row as raw text, which read as a different thing from the row it would become; and a removed card in a padded frame with its tag above it, which shifted every card below it.

**A proposal is struck and tinted in one hue.** Its words that would go are struck and the words that would come tinted where they stand, with no answers of their own in the text: a pair of buttons at every change crowds the text it marks, and the answer card on the current change carries them once. `--qm-review` is a hue of its own at each pole, beside danger the second the surface spends: in the accent's grey a proposed word reads as a code span before it reads as someone else's writing. Nothing is set in the hue; it runs under words and along them. The hue is never the only mark, since a reader who cannot tell it from the ink, or a forced-colours theme that drops it, loses every proposal: words that would come carry a thin line under them, words that would go a strike, a tinted control an edge in the review line, and the line holds 3:1 over the card and a well at both poles. To assistive tech a control under a proposal is described as one, with the value the field holds now (`reviewCurrently`), since what it shows is the proposed value, and each step announces the field or card it lands on beside its place in the review. Rejected: the description on the field's label, which every reader of the label would hear with the review closed too.

**One item is under attention at a time, and it stays until another takes it.** The current item is what the answer card, the review keys and the host's place in the review all name: a review starts on its first item, the caret names the item it enters at once, a press names the item under it at once, and the pointer names the item it rests on after a dwell, never while it is over the card, so the card does not jump away from a pointer on its way to it. Leaving an item names nothing, so the card stays where the reader left it. Every answer to the current item, by key, card or host, moves on to the next open one in the page's order, wrapping, without moving the caret or the focus, and a reveal or a step makes its item current while moving the caret only where the host or the reader's own key asks. Rejected: lighting what the pointer passes over apart from the current item, which drew two lit changes and left the reader unsure which the keys would answer.

**The review keys are the document's while a review is open.** Accept, dismiss and the steps answer the current item wherever the focus is, so a reader reading the preview or the host's bar answers without first finding the change; they stay out of another editor and of a text box outside the editor, where the chords are that box's. The answer card never takes the focus: the keyboard reaches it by Alt-F10, the way the formatting popover is reached, since Tab is structural in a body, and Escape or an answer hands the focus back.

**A field's proposal is drawn in its control, and the answer card carries only the answer.** A control under a proposal shows what its Accept would write, never the stored value under a tint. A leaf of lines, one-line text or rich text and multi-line text, draws its proposal as a word diff in its own leaf, the words it strikes struck and the words it writes tinted beside them in their own formatting, a run whose formatting alone changes struck and written again, as prose does; a list draws a member it appends after its last in the controls the member would have, holding the proposed value and taking no input, and marks a member it takes out where it stands. The diff is the leaf as it reads against what Accept writes, and both come from one plan (`value-plan.ts`) that carries each stretch the proposal rewrites from its `before` onto the leaf as it now reads, so the reader's words beside a proposal stay unstruck and survive Accept, and a proposal whose stretch the reader's writing meets is outdated and written whole; one the leaf already reads as is reported `applied` and drawn no more, as a paragraph's is. A number is drawn the same way over its input, its figures struck and the proposed ones tinted beside them, the input holding its own text beneath. A value no diff of words reads, a choice, a date or a switch, shows in its control as the value it would come to, and the control's own box takes the review tint, laid over it so it takes no room: a switch's track or a tick's square, not the row it stands in. A proposal that clears a field shows what Accept leaves: the default the control draws for one unset, else its empty face. A field on its default drops its Default tag, and an empty one its placeholder, while a proposal stands on it, since the control is saying another value. The reader reads a change where the value stands and nothing moves as a review opens or closes, and the card stays two buttons wide. A place inside a control that no control of its own draws, a collapsed row's cell, marks the nearest control that holds it. Rejected: the value drawn under its control, which shifted the form under the reader on every answer; the change said on the answer card, which grew the card with every value and set the change apart from the control it is for; and diffing a leaf as it reads against `after`, which struck the reader's own typing and lost it on Accept.

**A proposal stays open only while its control can show what Accept would write.** A control edits from the value it shows. Words and figures draw the reader's value and the proposal together, so there a proposal stays open, outdated where the two meet. A choice, a date, a switch and a checklist's tick show one value, so there the reader's commit answers the proposal: the proposed value accepts it, a blank and an unset value being one, and any other is written and dismisses it, both answers moving on and held in the journal as any answer is, the dismissal with the write's inverse, so ⌘Z brings back the value and the proposal together. A choice under a proposal holds no option in its primitive, so picking the proposed member commits too. Rejected: keeping the proposal open as outdated, which left a control showing the reader's value while Accept would still write another; and editing from the stored value under the proposed face, which made a press on a proposed switch write the proposed state without the thumb moving.

**Accepting everything leaves what the reader's writing meets.** `answerReview('all', 'accept')` skips every outdated item, each of which would write over the reader, and leaves it open; a host that names ids gets those ids answered, and leaves the outdated ones out itself.

**The preview shows a review from a projection, never from the document.** While items are open, `projectReview` writes every one the editor draws into a copy the host hands in, each as its Accept would write it: a field's value through the typed writer, a place inside one as the field's whole value with that place changed, a card at the place its preview stands, and a leaf's proposals from the plans it draws them from, written in one pass and planned again one at a time only where those passes do not make a document together. Nothing of it reaches the document, a leaf's state or history, the answer journal or a hook, so an item still enters nothing while it stands, and the host compiles the copy for its preview alone and frees it, everything that saves, shares or prints reading the document. The copy's card indexes and offsets are not the document's once a proposal adds or takes something out, so both bridge hops go through the projection's map, and a pick on what only the copy holds names the item that adds it. Rejected: writing the proposals into the document and taking them back on Dismiss, which a host saving the document on each edit stores, publishes and hands to collaborators before the reader answers, and which mixes the reader's typing with words nobody accepted in one history; and the host building the copy with the store's block verbs, which part from the leaf's plan inside a list (§"A proposal is drawn and taken from one plan").

**The answer card stands on the current item, inside the editor.** It is placed from the union of everything the item draws, each run of words widened to the block it flows in, read anew on each measure, below the item where there is room, beside the block's last line where that line ends short of the card, above it where not, and pinned at the pane's foot over an item taller than the pane, keeping clear of the host's chrome there (`reviewInset`). An item scrolled out of the pane keeps its card beside it, so the card scrolls out with the text and the pane's edge clips it as it clips the text: a card hidden as soon as its item left the pane vanished while it still showed. It is held out of the way while the reader types and returns when the pointer moves. A phone gets the same card, tap-sized, without key hints. Rejected: docking the answers into the host's bar on a narrow screen, which forked the surface for a target the editor does not serve (§Declined); and the host drawing the card, which cannot measure what a leaf draws; and the card under the run's own line, which covers the lines of its paragraph after it.

### Declined

Per-control render slots, which would hand reconciliation to consumer code; a pointer door onto the insert menu; image authoring, which has no asset story; touch as a target, and its accessory bar. Undo is per leaf and per list, never one stack for the document: a list keeps the changes to its rows as steps of its own (ArrayField), a card removal is the one card op with a step back, offered on the toast, and the answer journal holds the answers since the reader's last edit (§Review). A host's own write has no step back on it: a host that wants one words it in its own chrome.

## The codec

The bidirectional codec between one content field and one ProseMirror document. Markdown is not in this loop.

### Direction

**The content is truth, PM is its projection, and edits are ops.** Encode projects the new PM doc back to content and asks the store's own `diff` for the `Change`. Ops rather than a replace, because a `Change` moves each anchor exactly as it moves its text. A whole-field diff rather than a step replay, because the codec then restates none of the store's rules about where a mark or an anchor lands.

**`replace` is the exception**: a field not yet at content rest, and an `apply` that throws.

### Decode

**Decode is a pure function, and every node carries its id**, so the projection hands each back under the id it was read with. A construct no leaf edits holds the leaf read-only rather than being flattened.

### Encode

**The projection is total over the schema.** Every document the leaf's commands can reach projects to a valid `Content`; a projection the store refused would leave the leaf diverged from its field for the session. `tests/codec/roundtrip.test.ts` asserts it over the whole chain.

**The leaf holds one spelling of each shape**, normalizing what commands leave, so `decode(stored)` is the document the leaf is holding.

### Positions

**The position map is built in the same walk as the projection**, so the two cannot disagree. Offsets are UTF-16 code units.

### Marks

**Identity is kept off PM's mark mechanism.** Formatting is a property of a range and maps to PM marks; an anchor is a zero-width handle and maps to plugin-held positions keyed by id. Overlap only bites where identity and formatting coexist, and they never share a mechanism. So an anchor draws as a decoration, a span carrying `data-qm-anchor` that the host styles, never as a mark the schema would serialize.

**An anchor's id is the caller's**: supplied at `insertAnchor`, unique, and never changed afterwards, since no content determines what a comment refers to and the codec mints none.

**A link's scheme allowlist is the render's, not the model's**: a refused href stays on the mark and round-trips.

**An applied commit leaves new block ids to the store.** A commit that lands as a change sends each block the store does not hold as a placeholder, and the nodes then take the ids the store holds, because the store does not mint an id it retired except on a write against the value it was minted on, which in practice is an undo: a writer naming a retired id, a model among them, is refused rather than landing on a stranger. The projection's own id for a new block is provisional, and a `replace` writes it as it stands.

### Islands

**A minted island id continues the field's `isl-{n}` sequence**, never a UUID or a clock, because the id is part of the document's canonical bytes.

### The table island

- **The rectangle is an invariant with no error channel**, so every row and column op goes through one rectangularizing constructor. A ragged table would leave PM and the store disagreeing silently.
- **A pointer press resolves to a caret, and a drop to the cell it is over.** Only a grip acts on a line, and a drop on a cell's padding or beside its text lands in its text rather than in the field around the table.
- **A selection is the subject of the next command**, never armed for replacement: a printable key over a selected island types after it.
- **The chrome occupies no layout.** Grips, add bars and the alignment cluster hang outside the grid, positioned by construction rather than measured, and out of the tab order; the cells are the whole tab order.
- **A cell edit is one `nested` step**, so every anchor in the field survives it.

### Task items

**The checkbox is outside the item's content**, so no caret reaches it and a toggle is one transaction. No shorthand mints a task item.

### Vocabularies

**The PM schema names the whole vocabulary and nothing beside it**, so no projection writes a name the store does not hold. A paste reaches a node without having been `Content`, so the island rule refuses a type no leaf edits.

### Inline mode

**A `text` field's schema declares no mark types.** Mark-freedom is the schema's rather than a rule per path, because the boundary refuses a marked `text` value only at render, where no commit-time gate catches it.

**A `text` field writes its whole literal string through `writer.set`.** A content object would round-trip through markdown and change what the author typed.

**`codec/prose.css` predicts nothing about the size a quill sets a span at.**

### Markdown at the edges

**Markdown never represents an edit.** It reaches a field only at serialize, paste and copy.

**Paste parses HTML against the schema, so markdown spelled inside markup arrives literally.** Plain text that opens a markdown block is parsed; a one-line or `text` leaf never parses.

**Copy and paste are a tier**: every attribute the schema writes to the DOM is read back, so an ordinary copy destroys nothing. An island id a field already holds is re-minted on the way in. Nothing writes markdown to the clipboard.

### Reconciliation

**A leaf re-hydrates only on an external change**, gated by canonical-content equality scoped to that field. Content normalizes on write, so `decode ∘ lower` is idempotent only up to normalization, and caret continuity across a leaf's own edits is PM's step mapping.

**A re-hydrate is one step outside the undo history**, replacing only the span that differs, so undo takes back the leaf's own edits and leaves another writer's.

## The preview

**The preview is a pure view.** It paints and reads geometry off a `LiveSession` the consumer opened, and never mutates it, so one session can take edits from any source. Every option is bound once; a swap is the consumer's.

**The preview leaves no ink of its own on the page.** It is the surface a user proofs against, so nothing advertises clickability and nothing marks the editor's active field.

**The pane's message is heard as a change of state, not as a paint.** A hidden status region stands empty in the pane from the mount and takes the message once the pane has held still: a failed paint, the pages running out, and the pages standing again after either was said (`restored`). A recompile over a page that still fails clears the message and raises it again, which is no change, and a fresh seed's empty pane is where a mount starts, so neither is said. Rejected: a role on the message itself, which arrives with its text in it and would speak on every such recompile.

**Paint is bounded by what is visible.** A canvas per visible page plus a margin, mounted and unmounted on scroll. A page that fails to paint shows a message in its slot rather than blanking the pane.

**One zoom for every page**, as a fraction of actual size, so type is one size across a portrait memo and its landscape attachment.

### Click bridge

**Two rungs and no third.** `positionAt` answers with an offset over span-tracked content; `fieldAt` answers with no offset over every placement the compile tracks, and the bridge asks the finer first. An absent `pos` is the coarse rung; a fabricated `0` would be an invented offset. Rejected: a rung over `regions()`, whose rects are bounding boxes over ink the field does not fill, so hit-testing them would land clicks the compile never claimed.

**The slack is the pointer's imprecision**, so it is fixed in screen pixels and converted per click.

**The consumer completes the caret move**, because only the editor's codec maps a content offset to a ProseMirror position.

### Follow-the-caret scroll

**The preview scrolls its own scrollport and nothing else.** `scrollIntoView` would walk every scrollable ancestor and drag the host page away from the surface the user is typing in.

**The discrete hop centres; the follow moves only when the caret leaves the fold.** The hop outranks the follow and ends it, and a focus change ends it too, since a leaf with no caret would otherwise keep pulling the pane back.

**A miss is an answer, not a failure.** The plate places plenty it does not track, so a field the compile placed nothing for is not an `onError` report.

**A wash moves nothing**: a pane that jumped to it would take the reader off what they were reading.

## Hosting

The seam a consumer owns once it mounts the surfaces over live handles.

**A host that stores markdown owns the round trip**, and projects on the change, not on a timer: a keystroke lost to a projection debounce is lost to a crash. Debounce the recompile instead.

**Guard a reopen with `doc.equals`.** An autosave whose store echoes the saved text back would otherwise reparse and remount on its own output, dropping the caret mid-keystroke.

**The editor lands before the session.** The editor needs only `doc` and `quill`; the first open loads the render build, which is large, so the host opens the session behind the editor over the document as it stands. A reopen is async and can race, and the loser frees what it opened rather than installing it.

**The host frees what it made, and nothing else.** A `Quill` from `@quillmark/quiver`'s `getQuill` is borrowed, so freeing it breaks the next caller.

**`session.update` is transactional**: a document that cannot compile leaves the last good compile painted, so a host shows the failure beside the preview, not instead of it.

**A field is addressable only where the compile placed something it can name**, which is the quill's decision, not the editor's. A bridge that reaches too little is answered in the quill.

## The playground

`packages/playground` is the reference wiring for the glue the primitives push outward, the manual harness for what unit tests cannot reach, and the project's landing page. How to reach it from source is its [README](../../playground/README.md).

**The playground consumes only the published subpaths**, so a needed internal is an API gap to fix.

**It stays a harness, not a product**: no auth, no multi-doc management, and no persistence but a `?collab=` room's.

**The bridge between the panes is consumer-layer glue.** The editor emits places and the preview emits hits, and the shell joins them, so neither surface imports the other.

**It draws with the preset, the import a third-party consumer makes**, so it looks like the endorsed version by construction. An app scale may not restate a name the preset defines, and two app scales may not mint one concept at two values; a rung two app scales have to keep agreeing on belongs in the preset.

**The front page mounts what it describes**, over a session opened exactly as a consumer's is, so nothing on it claims a capability the mounted surface is not already showing. What only a hand driving the harness needs is a query flag rather than chrome.

**A harness flag lives in the URL, not the browser**, so a link in a report reproduces the document it was copied from.

**Every quill comes from a quiver, not the bundler**, so no Typst source or font bytes are in the JS bundle. The app is the workspace's one edge to `@quillmark/quiver`, and where the two tiers meet.
