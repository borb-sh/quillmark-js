# Studio

> **Implementation**: `client/`

## TL;DR

The surface a quill author looks at their quiver through: pick a quill, edit, watch it paint, read the errors. `quillkit check` answers *does it work*; studio answers *what is it like to use*, which is where most of what makes a quill good or bad lives. This doc is its shape: what it is a client of, the repack loop the document survives, and the look it is drawn with.

Two readers, one client. The author works mid-edit against files on disk, and the repack loop is theirs. A reader who arrives at a deployed URL (a reviewer, someone evaluating a quiver) gets the same client over one built quiver, with nothing to repack.

**Studio is the noun, not the verb.** It is a client rather than a package: `client/` beside the bin's `src/` under one manifest, and `studio` is a target every verb takes (QUILLKIT §"Verbs and targets"). The other client the tool carries is the app, for the person filling a form in ([APP.md](APP.md)).

## Looked at, not blocked on

Studio is reached for when someone wants to see the thing; the gate is `quillkit check` (QUILLKIT §"Blocked on, looked at"). Nothing fails a build on studio's verdict, which is what lets its chrome, weight and wasm be its own problem.

## Why it is not the playground

Both mount the same surfaces, and the difference is which thing is variable. The playground holds the quill fixed and makes the wiring the subject, so it shows its instruments. Studio holds the wiring fixed and invisible and makes the quill the subject, so it hides them. The drawing follows: the playground frames its mounts as one of several things on a page, and studio runs the two mounts to the viewport's edges, meeting at a hairline, because every pixel of chrome is one not spent on the quill.

## Opened, not stood on

The reader who followed a link is owed one line and one door, said in the bands that already exist: the head carries the quiver's own description beside its name. A landing page would cost the author a click every boot, and a band above the split would spend the surfaces' height on prose read once.

**Studio does not define its own vocabulary.** A paragraph explaining what a quill is would be prose nobody with authority over the document model reviewed, wrong in every deployed studio the moment the model moves. What studio says is limited to what studio is; everything else on the page is something a quill author wrote.

**The address bar names the quill**: `?quill=showcase@1.0.0`, the grammar `getQuill` takes, so a reader can be sent to one quill. A query rather than a path, so no static host needs a rewrite rule, and `replaceState` rather than a push, since back means leave. A ref the quiver does not hold opens the first quill and corrects the address bar.

**Two controls in the head move the document**, the source panel and the download (§"The document has doors"). Nothing opens on boot and nothing is stored, so an author who never presses either is where they were. The source panel is a native `<dialog>`, mounted only while open so it reads the document as it stands.

## A client, and what serves it

A browser cannot read the source layout, so studio is an ordinary quiver consumer over a built artifact: `fromBuiltUrl(base)`, a picker over `quillNames()` and `versionsOf()`, `getQuill(ref)`, then the surfaces over one `LiveSession`. Packing, watching and serving are `quillkit serve`'s. The picker offers only what varies; an axis with one value is printed. The quill is borrowed from the quiver's cache, so studio frees the session and the document and nothing else.

**Shipped inside the tool, and nothing in it is importable.** `vite build` lands the client in the tarball with the wasm and libraries bundled in. quillkit has no importable entry, so studio's wasm never lands in an importer's process, which is the thing the artifact's single-copy rule exists to prevent. Its runtime dependencies are pinned exactly (QUILLKIT §"One pin"), so the bin and the bundles are one release. Two toolchains share one manifest: `tsc` for the bin, `vite build` for the clients, meeting only in `dist`.

**A pack is never the client's.** A quiver is laid beside the client at deploy time, so a built studio serves from wherever it is put (QUILLKIT §"The deploy layout").

**The bundle names what it carries.** A browser resolves nothing, so the build stamps the versions of the wasm and each bundled sibling (`scripts/carried.mjs`, `dist/client/carried.json`), and the head states the wasm version that painted the page.

**The bridge is studio's own; the shell's shape is not.** The caret bridge and debounced recompile are consumer-layer by design. The pinned bands and the split are the preset's classes on studio's elements (THEMING §"The shell"); what studio writes is what a band is made of. Studio draws with `@quillmark/svelte/preset`, the same import a third-party consumer makes.

## The document is the blueprint's

Studio holds one document, and it starts as the quill's own: the example document (every `example:` committed) while **Examples** is on, else the seed. No document of studio's outlives the tab. **Reload is the reseed**, so a `default:` or `example:` edited mid-session appears after F5.

The example is on by default because the failures a long list or a wrapping value reveal are invisible on the seed; off shows the other half, the ghosts and defaults an unanswered field shows. `quillkit check` renders both. The toggle is one key in browser storage, since how an author judges quills is a habit across every quill and launch; it holds no document, so nothing stale lands on a field.

## The document has doors

Canonical markdown out and in, through one panel; the rendered file out, through one press. A visitor who fills a memo out has something to close the tab on.

- **Out** is `toMarkdown()`, the string the repack loop already carries, so it works even while a quill will not compile.
- **In** is the repack's own ingestion (`quill.parse`, which conforms), so what an import strands is shown on the controls it is about, as a repack's is. The file's `quillRef` is believed: a ref the quiver holds is the quill it lands in.
- **Markdown, not the storage DTO.** The DTO's version coupling to `@quillmark/wasm` is recorded nowhere a kept file could rely on, while markdown is readable, portable to the CLI, and re-conformed on the way in.
- **The rendered file** is `session.render({ format: 'pdf' })` over the snapshot the preview is already painting, so the file never disagrees with the page it was taken from. PDF because it is one artifact; a backend that writes none draws no control.

**No door here is the write door.** Each moves a document or a render of one; nothing reaches a `Quill.yaml`, a plate or a quiver (§"The door rule, for what comes next").

## The document survives the quill

Studio is the surface where the schema changes under live content. A repack yields a new `quiver.json`, so the client drops the quiver rather than invalidating it: new `Quiver`, re-`getQuill`, the old handles going with the old open. The signal is Vite's socket under the dev server, or `quillkit serve`'s event stream (QUILLKIT §"The local loop"); a deployed studio listens for nothing.

What crosses is the document as canonical markdown, landed through `quill.parse`. Three outcomes, each a fact about the quill rather than an error to swallow:

- a plate-only edit repaints the same document;
- an additive schema change keeps it and defaults the new fields;
- an incompatible one strands what the schema will not take, with `conform::*` diagnostics routed to the controls they name until the first edit.

A card kind the schema stopped declaring strands nothing; the editor draws it in its recovery shell. A quill that will not materialize leaves the document waiting as text until the next repack resolves it. Two overlapping opens drop the loser. A *pick*, unlike a repack, carries nothing: a different quill is a different document.

## The errors

Four producers say something about the document in hand: `quill.validate(doc)`, the compile, the `conform::*` set a repack stranded, and the last download's refusal. They are merged and deduplicated so one problem is one thing on screen.

**A diagnostic is shown where it is about, and nowhere else.** There is no list. A `path` is the document's, and the editor routes it to its control; a `location` is the quill source's, and the strip over the paint names it so the author can open their other editor there. A diagnostic with neither reaches nothing, and `quillkit check` is where a quill's own faults are answered for.

**A document that will not compile is a state of the paint.** The last good paint stays on screen, the failure laid over it rather than stacked above, so breaking and fixing a plate does not resize what is being judged. A lost commit or a failed page paint reaches the strip too, since each means the paint has stopped answering the editor.

**The editor stands either way.** It needs no session, so a failed open costs the preview alone, and the edit that answers the failure retries the open.

## Not

A Typst IDE: studio shows a quill, it does not edit the plate or the schema. Not a CMS: no auth, no persistence, no multi-doc management. Not a gate. Not a tool: the client carries no verb.

## The door rule, for what comes next

Every arrow today points one way: disk → HTTP → browser. Features that write quill source (a schema editor, a form quill-ifier) will need an arrow back. The rule that keeps it from leaking: **quiver owns the authored source layout and every door onto it; a door moves bytes into the layout and does not know what the bytes mean.** A door that must parse a `Quill.yaml` is studio's, and quillkit's job is to hang the door. Quiver already owns the safety the layout implies, which is why a client cannot reimplement it correctly. No write door exists yet: designing a protocol before there is an editor to shape it is how the wrong one gets built.
