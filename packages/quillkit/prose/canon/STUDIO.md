# Studio

> **Implementation**: `client/`

## TL;DR

The surface a quill author looks at their quiver through: pick a quill, edit, watch it paint, read the errors. `quillkit test` answers *does it work*; studio answers *what is it like to use*, which is where most of what makes a quill good or bad lives. This doc is its shape: what it is a client of, the repack loop the document survives, and the endorsed look it is drawn with.

Two readers, one client. The author works mid-edit, locally, against files on disk, and the loop below is theirs. A deployed quiver is frozen at a commit, so the reader who arrives at a URL (a reviewer following a branch, someone evaluating a quiver) gets the picker, the surfaces and the errors over one built quiver, with nothing to repack. One client rather than two: it is the same client an `npx quillkit studio` over a working tree serves.

What the two readers do not share is what they arrive knowing, and that is answered by two lines in the head rather than by a second client. The author typed the verb and reads past both; the reader followed a link, and is owed a page that says what it is and a document that can leave it.

**Studio is the noun, not the verb.** It is a client rather than a package: `client/` beside the bin's `src/` under one manifest, no verb of its own, and `quillkit studio` is how the surface is reached ([QUILLKIT.md](QUILLKIT.md)). The name still has a job the tool's cannot do: the deployed thing a reviewer arrives at is a studio, and "the collection's site" names a directory rather than a surface.

## Looked at, not blocked on

Studio is reached for when someone wants to see the thing; the gate is `quillkit test` (QUILLKIT §"Blocked on, looked at"). Nothing fails a build on studio's verdict, which is what lets it be an app at all: its chrome, its weight and its wasm are its own problem.

## Why it is not the playground

Both mount the same surfaces over the same reference quill, and the distinction is **which thing is variable**. The playground holds the quill fixed and makes the *wiring* the subject, so it must show its instruments: state strips, live dumps, fixture variants, the hooks a headless pass drives. Studio holds the wiring fixed and invisible and makes the *quill* the subject, so it must hide them. The suspect when something looks wrong differs too (the library in one case, the quill in the other), and that is what decides what each surfaces.

That separation reaches the drawing, not only the contents. Both are one session under two surfaces in a pinned shell, so the shape of the screen is one thing taken out of the preset; what fills it is not. A page showing its instruments stands its mounts apart, framed, so each reads as one of several things on it. Studio spends the whole screen on the two mounts: they run to the viewport's edges and meet at a hairline, because the surface is the subject and every pixel of chrome around it is a pixel not spent on the quill.

Studio also sheds the playground's *site*: one screen, with no router, no reading column and no landing page. What it does not shed is the front-door job itself, which the deployed half is the whole reason for — a reader arriving at a link has had no contact with any of this, and a page that answers only the author is a page that answers half its readers.

## Opened, not stood on

The reader who followed a link has had no contact with any of this, and what they are owed is one line and one door. Studio spends the whole screen on the two mounts, so what it says to them is said in the bands that already exist or not at all: a landing before the picker costs the author, who has one quiver and typed the verb, a click every boot to be told what they know; a band above the split spends the surfaces' own height on prose read once; a separate route is reached by nobody.

So the head carries it, next to the picker that is already there: the quiver's own sentence, beside its name, truncating to whatever the controls leave. It is the only prose on this page its author wrote, and the reason studio does not have to explain what a quiver is.

What the two panes are is not said. A form on the left and a page on the right, one repainting as the other is typed into, is a thing the screen demonstrates in a keystroke, and a label naming them is chrome standing on the mounts to restate what the mounts already show. The panes keep their accessible names, which is where the fact is owed and where it costs nothing.

**Studio does not define its own vocabulary.** A paragraph here explaining what a quill is would be prose nobody with authority over the document model reviewed, compiled into a client and wrong in every deployed studio the moment the model moves. Wrong is worse than missing, so what studio says about itself is limited to what studio itself is: its two panes, its one document, its own screen. Everything else on the page is something a quill author wrote.

**The address bar names the quill.** A reader who followed a link to the quiver is one link from being sent to a quill in it, so the picked ref stands in the URL: `?quill=showcase@1.0.0`, the grammar `getQuill` already takes, resolved through the quiver so `showcase` and `showcase@1` are links too. A query rather than a path segment, a deploy being static files behind whatever host the author has: a query participates in no file resolution and relative resolution drops it, so the base the quiver is read off is untouched and no host is asked for a rewrite rule. `replaceState` rather than a push, because there is one screen and back means leave rather than unpick. A ref the quiver does not hold has nothing to honour, so the catalog's first quill opens and the address bar is corrected to what is on screen; a selector is honoured and then said canonically, which pins the reader's own address bar and not the link they were sent. The document is not in it — the param names a quill, and a reload still reseeds.

**Two controls, and the loop gains no step.** The document's doors stand in the head, beside the picker, which is the one band studio draws that is already about what is being held rather than about what is on screen. Nothing opens on boot, nothing is dismissed, nothing is stored, and an author who never presses either is where they were. They are two because what they move is: the source goes both ways and needs a panel to be edited in, and the file goes one way and needs nothing, so the press is the whole of it.

The panel behind the source control is mounted only while open, for the same reason the document is not stored: it reads the document as it then stands, and one kept mounted would hold whatever the last opening did. Its drawing is studio's, not the preset's — the preset's shell is the pinned bands and the split, and a panel stands over that rather than among it, so nothing here restates a number the preset owns. Native `<dialog>` carries the top layer, the focus trap and the escape key; what studio writes is the scrim's tone and the plate's box. A second consumer wanting one is what would promote it.

## A client, and what serves it

A browser cannot read the source layout, so studio ends at a built artifact behind a base URL, consumed with `Quiver.fromBuiltUrl`. Packing, watching and serving are `quillkit studio`'s, and none of it is here: `client/` is the client those verbs lay over a pack, and that is the whole of it.

**Shipped inside the tool, and nothing in it is importable.** `vite build` lands the client at `dist/client`, beside the compiled bin under the one `dist` the tarball carries, with wasm and both libraries bundled in. quillkit is a **bundled terminal**: no importable entry, so `check:deps` asks it for no peer range, and no runtime dependencies, so what the client bundles is never installed a second time beside it. An importable entry would put studio's wasm in an importer's process, which is the thing the artifact's single-copy rule exists to prevent; the one wasm here runs in a browser tab, in a process nothing else shares.

**Two toolchains under one manifest**, which is what carrying the client costs: `tsc` compiles the bin from `src/`, `vite build` compiles the client from `client/`, `prepack` runs both, and svelte, vite and svelte-check sit in the tool's `devDependencies`. The trees share a `dist` and meet nowhere else, which is what keeps the cost to the manifest: three programs, and no file is in two of them (`tsconfig.json`, `tsconfig.client.json`, `tsconfig.check.json`).

**A pack is never the client's.** The base URL is a runtime fact, so a quiver is laid beside the client at deploy time and never baked into it, and a built studio serves from wherever it is put. The layout is `quillkit site`'s to write ([QUILLKIT §The deploy layout](QUILLKIT.md)); the client asserts nothing about it, and `vite build` runs with `copyPublicDir: false` so a dev run's packed tree cannot ride into the tarball.

**The client** is an ordinary quiver consumer: `fromBuiltUrl(base)`, a picker over `quillNames()` and `versionsOf()` (both sync, so it needs no loading state), `getQuill(ref)`, then the surfaces over one `LiveSession`. The picker offers only what varies: an axis holding one value is printed rather than selected, since a working tree is usually one quill at one version and a control that cannot be used is chrome competing with the surface. The fact stays either way, an author having to know what they are looking at. The quill it holds is **borrowed** (cached per canonical ref for the quiver's lifetime and handed to every caller), so studio frees the session and the document and nothing else. It rewrites no quill bytes, so it needs no quill of its own.

**One wasm, and the head says which.** Inside this workspace the root `overrides` pin is the only copy, so studio and `quillkit test` render through one instance. Over a collection they are two: the client bundles the copy it was built with, a gate runs whatever the collection's own tree holds, and nothing at runtime reconciles them. The version is stated so the reader who cannot run `npm ls` is told what painted the page.

**And the bundle names the rest of what it carries.** A browser resolves nothing, so both siblings are compiled in too, and no manifest in a consumer's tree records which copies. The build stamps all three (`scripts/carried.mjs`), each at the version its manifest states: `__CARRIED__` for the running client, and `dist/client/carried.json` for a consumer reading the tarball without running it. A release's notes open with that file rendered out of the packed tarball, so the coordinate is minted once. A label rather than a claim about a working tree — nobody installs the contents of a bundle, so the coordinate is for diagnosis, and `release.yml` builds from the commit it tags, so a released tarball's manifests and its bytes agree by construction.

**The client ships built and runs unbuilt.** The tarball carries what `vite build` produced; locally it is an ordinary Vite dev server, with HMR on its own chrome. That is the whole of what the dev server buys over `quillkit studio`, and the pack it serves is the same `build` the tool calls, so the loop is not written twice. An author who cannot run a bundler is the reason for the first, and the reason the wasm is bundled with it.

**The bridge is studio's own; the shell's shape is not.** The caret bridge and the debounced recompile are consumer-layer by design, and a shared component wiring them would contradict the reason the wiring is the consumer's. The shape of the screen goes the other way: the pinned bands, the row a band puts its parts on, and the split's tracks and its breakpoint are the preset's classes on studio's own elements (THEMING §"The shell"). What studio writes is what a band is made of, which is where the look diverges: the mark's treatment, the head's depth and full-bleed rule, the seam the mounts meet at, and the depth of the switch band above them. A rule studio writes because the preset picked the playground's answer is the promotion coming apart, not a divergence.

The threshold is the test of that, and studio states none: under it the split shows one track, `.qm-switch` says which, and the caret bridge reveals the editor when a hit crosses into it. The seam is what makes the number unnecessary here: it is the split's own gap closed to a stroke with the border behind it, so it appears and goes with the second track. Drawn on a pane instead, it would outlive the pane beside it and stand against the viewport, and studio would restate the preset's widths to say when not to draw it.

Studio draws with `@quillmark/svelte/preset`, the same import a third-party consumer makes; `studio.css` adds one width beyond the endorsed look, what the source panel stands at. It is how much of a document is worth showing at once rather than rhythm, which is why it is not a rung the preset could have carried.

## The document is the blueprint's

Studio holds one document and it starts as the schema's own: `seedDocument()` over the `example:` values in `Quill.yaml`. Nothing of studio's outlives the tab — no file it is read from at boot, none it writes, no store it reseeds from.

**Reload is the reseed.** A boot seeds, and the carry keeps a running session on the document in hand, so an `example:` edited mid-session does not appear until the page reloads. F5 is the whole of that verb, and it costs a keystroke rather than a control.

**What that costs.** The failures that only a long list, a wrapping value or an empty optional reveal are invisible here, and to `quillkit test` with it: neither renders a document the schema did not write. The corpus *is* the `example:` block, so an author buys that coverage by writing examples that are uncomfortable rather than tidy.

## The document has doors

Canonical markdown out and the same markdown in, through one panel; the rendered file out, through one press. A visitor who fills a memo out has something to close the tab on, and a document on disk opens in the surface built to judge documents without a working tree behind it.

**Out is the string the loop already takes.** `toMarkdown()` is what the repack carries, and a failed open holds that same string, so the door covers the state where a quill will not compile — which is the state an author most wants a document out of.

**In is the carry with a different source.** `quill.parse` is the bound ingestion door and the repack loop already runs it: parse, conform against the schema in hand, strand what will not take with `conform::*` diagnostics. An import lands through exactly that, so what an import strands is read where a repack's stranding is read — on the controls it is about — and this door writes no landing and no stranding of its own.

The panel's text is editable, since replacing it is how a document comes in, and it is not a second editor: what is typed there reaches the document only on apply, all at once, through that same conform. The surface that routes a diagnostic to the control it is about is the editor pane, which is what a `path` address is for.

**The file names its own quill, and is believed.** `doc.quillRef` is persisted in the markdown and read before anything is opened against it (`Document.fromMarkdown`, which needs no quill). A ref this quiver holds is the one the document lands in and the picker follows it: the document says what it is, and landing it somewhere else to spare the reader a moved control would strand every field to make a point about the picker. A ref the quiver does not hold has nothing to honour, so the quill on screen takes it and the conform names what would not fit.

**Markdown, not the storage DTO.** `toJson()` / `fromJson` is the versioned DTO and would reconstitute exactly rather than re-conform. It is not in DOCUMENT_MODEL's table, which is the one place the version coupling to `@quillmark/wasm` is recorded, so a file a reader keeps would ride a coupling nothing records and move under a wasm bump with nothing to notice. Markdown is readable by whoever saved it, unchanged into the CLI or a quiver repo, and re-conformed on the way in — which is what is wanted when the schema moved under a stored document, and a loss only when it did not.

**And the document leaves as what it renders to.** A reader who filled a memo out wants the memo, not its source, so the second control writes the file: `session.render({ format: 'pdf' })` over the compiled snapshot the preview is already painting, named by the ref the address bar carries.

The session rather than a second compile, because the alternative is a file that disagrees with the page it was taken from. **The file is the paint**: a keystroke that has not settled and a compile that failed are both states the preview is in, the last good one standing on screen either way, and the strip over it is what says so. A download that opened its own compile would answer a third document — the one in hand at the press — and studio would show two truths at once.

**PDF, because a document is a file.** It is the one format the render contract answers with a single artifact; `svg` and `png` emit one per page, so a document leaving as them is a directory rather than a thing to keep. The format a backend emits is `supportedFormats`, an always-free probe off the backend descriptor, read once per open: a backend writing no PDF draws no control, a control that cannot be pressed being chrome standing on the mounts.

**A page that paints can still fail to write**, the PDF spine being the lane a canvas paint does not run, so the refusal is its own slot among the errors and the strip over the preview takes it: the same register as a compile failure, saying `Download failed` instead, and outranked by one, since a compile that will not land is why the paint is stale and the emit's verdict is about the page that is there. The next edit drops it, as the carry's diagnostics are dropped: it described the document that was in hand when the control was pressed.

**No door here is the write door.** Each moves a DOCUMENT, which studio mints, edits and frees on every keystroke, or bytes a render made of one. Nothing reaches a `Quill.yaml`, a plate or a quiver, so the rule below stands unamended.

The one refusal that is not a stranding is markdown that will not parse at all: it never becomes a document, so it has no diagnostics to route and no session to land in. That is said at the door, beside the text that caused it, and the document on screen stands.

## The document survives the quill

The playground holds the quill fixed; studio is the surface where the schema changes under live content. A repack yields a new content-addressed manifest and pointer, and the quill cache lives as long as the quiver does, so the client **drops the quiver rather than invalidating it**: new `Quiver`, re-`getQuill`, and the old handles go with the old open. The pointer is already fetched `no-cache`, so no loader API moves for this: a `refresh()` verb would be an optimization against a working loop.

What crosses is the document, as its canonical markdown, landed through the bound ingestion door (`quill.parse`, which conforms as it parses). Three outcomes, and each is a fact about the quill rather than an error to swallow:

- a plate-only edit repaints the same document verbatim;
- an additive schema change keeps it and defaults the new fields;
- an incompatible one strands what the schema will not take, with the `conform::*` diagnostics naming each stranded value.

**Showing what stranded is the point**, so those diagnostics reach the controls they name rather than being swallowed as a load warning. They describe the document as it *arrived*, so they are dropped at the first edit and the schema producer speaks for it from then on.

**A card kind the schema stopped declaring strands nothing.** Conform keeps the card whole and emits no `conform::*` diagnostic, so nothing reaches a control; `quill.validate` names it and `Engine.open` refuses the document it stands in. The document still lands, and the editor draws that card in its recovery shell — the one surface it is reachable from — so what the refusal costs is the paint.

Two edges the loop turns on. A ref that went away under the author (a version directory renamed) leaves the document nothing to land in, so whatever the catalog now holds is seeded instead. And a quill the quiver will not **materialize** — a `Quill.yaml` mid-edit — leaves nothing to stand a surface on: the document waits it out as text, the panes go empty, the errors say why, and the next repack that resolves gets it back. A plate that will not compile is not that edge. The quill materializes and the document lands, so the surfaces stand and the line to open is carried where the paint would be.

An open takes as long as the backend takes to load and compile a page, which is long enough for a second repack to land inside one, so the loser of two overlapping opens drops what it built instead of both writing the same slot.

A *pick*, unlike a repack, carries nothing. A different quill is a different document, and its seeded example is where "what is this quill like to use" starts.

## The errors

Five producers say something about the document in hand — `quill.validate(doc)`, the compile (`session.warnings` and the diagnostics a throw carries), the `conform::*` set a repack stranded, what a surface recovered from, and what the last emit refused. They overlap by design, so the set is merged and deduplicated before anything reads it: one field's one problem is one thing on screen. The editor draws errors only; a warning in the set does not.

A throw is unwrapped rather than reported as one line: a `QuillmarkError` carries every diagnostic, and a broken plate is the case that matters.

**A diagnostic is shown where it is about, and nowhere else.** There is no list. An address is written in one of two spaces, and each has a surface: `path` is the document's, and the editor routes a diagnostic to its control by it; `location` is the quill's source — a file, a line and a column, which a compile failure carries and nothing the schema says does — and the strip over the paint names it, which is what an author opens their other editor at.

What that costs is the third shape. A diagnostic carrying neither address reaches nothing, and studio does not show it. A quill emitting one has a problem worth knowing about, and studio is not where it is found; `quillkit test` is blocked on and is where a quill's own faults are answered for.

**A document that will not compile is a state of the paint.** The session is transactional, so the last good paint stays on screen and stops answering the document. A failed **open** is the same state with nothing under it, and takes the same register: the failure at the surface it is about, carrying the place to open. The paint stays whole underneath where there is one, being the only evidence of what the plate did before it stopped compiling, and the strip is laid over rather than stacked above, so breaking a plate and fixing it do not resize what is being judged.

**The editor stands either way.** It binds a quill and a document and needs no session, so a failed open costs the preview alone. That is what makes a refusal answerable: the card the refusal named is drawn where it can be retyped or removed, and the edit that answers it tries the open again.

## Not

A Typst IDE: studio shows a quill, it does not edit the plate or the schema. Not a CMS: no auth, no persistence, no multi-doc management, matching the playground's own limit — a document leaves as a file the reader keeps, which is the converse of studio keeping it. Not a gate: `quillkit test` is blocked on, studio is looked at, and `quillkit studio` gates nothing. Not a tool: the client carries no verb, so every door onto it is one the bin beside it opens.

## The door rule, for what comes next

Studio is headed for features that write quill source (a schema editor, a form quill-ifier), and today every arrow points one way: disk → HTTP → browser. Those need an arrow back, and it is the first thing between the client and its server that is not a static file.

The rule that keeps it from leaking: **quiver owns the authored source layout and every door onto it; a door moves bytes into the layout and does not know what the bytes mean.** A door that must parse a `Quill.yaml` to do its job is studio's, not quiver's, and quillkit's job is to hang the door rather than to decide what goes through it. Quiver already owns the safety the layout implies (the path-escape rejection reading manifest-named files off a disk, the destructive-write refusals in `build`), which is the concrete reason a client cannot reimplement it correctly.

No write door yet. Designing a protocol before there is an editor to shape it is how the wrong protocol gets built; the rule is what makes the right one land when it arrives.

## Links

[QUILLKIT.md](QUILLKIT.md) · [QUIVER.md](../../../quiver/prose/canon/QUIVER.md) · [PLAYGROUND.md](../../../playground/prose/canon/PLAYGROUND.md) · [`THEMING.md`](../../../svelte/THEMING.md)
