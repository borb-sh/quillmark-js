# quillkit invariants

The rules a change to `quillkit` must keep, the reason behind each, and the designs already weighed and rejected: the bin, and the two clients it lays, studio and the app. The verbs, their flags, the deploy layout and what a host owes it are the [README](../README.md). A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## The tool

**quillkit is the only name in the toolchain an author installs.** A quiver's `package.json` lists `quillkit` in `devDependencies` and nothing else; the loaders a browser consumer reaches stay `@quillmark/quiver`'s. Not a generator, not a renderer, not a library and not a theme engine.

### Verbs and targets

**The quiver is the working directory.** No verb takes a path to it, so a `scripts` entry and a terminal mean the same tree. A verb refuses a flag it does not take rather than read it as absent.

**Every verb's default target is studio**, the client a quiver's own authors judge it in; a pipeline deploying the app names `app`.

**`serve` shows the source, `preview` the build.** A deploy records which target it was built for, so `preview` takes no target.

**No base path is configured.** Each client resolves everything relative to `document.baseURI`, so one build serves a root, a subpath and a preview URL unchanged.

### One pin

**The runtime dependencies are `@quillmark/wasm`, `@quillmark/quiver` and `@quillmark/fonts`, all at exact versions.** The bin packs with the quiver it carries, `check` renders with the wasm and fonts it carries, and both clients are built against the same three, so what the gate renders, what `serve` shows and what a deploy serves are one release by construction. An author upgrades the whole set by moving one devDependency.

**Exact, because the clients are bundled.** A range would let an install pair this bin with a wasm or quiver its clients were not built with, and the gate would pass a render the deployed page does not perform. `check:deps` holds the pins exact. The collection's own `node_modules` decides nothing.

**There is no importable entry**, so no handle minted here reaches another copy of the wasm. Only `check` and the app target instantiate the wasm in Node; the packer instantiates nothing.

### The gate

**`check` is what an author is blocked on; `serve` and the deploys are what they look at.** `check` runs in their CI and fails a build, and nothing fails a build on a client's verdict, which is what lets a client's chrome, weight and wasm be its own problem.

**The gate renders every quill's seed**, one card per kind with every field absent, so it proves the plate renders the blank a reader starts from.

**What an author wrote is held to every diagnostic.** A quill's example document fails on any diagnostic `quill.validate` raises, warnings included, since every value in it is the author's to fix. The render's own warnings and the quill's load warnings fail it only under `--strict`.

**The app resolves too.** With an `App.yaml` or `app.css` present, the gate runs what `build app` runs before writing, so a bad app fails the gate as it would fail the deploy.

**One door.** An author on another test runner spawns the bin and gates what CI gates. Rejected: a second entry onto the verdict, which would be a second answer under one name.

### Where a quiver comes from

**The starter is a quiver the suite gates**, so a scaffold that stops rendering fails CI before it fails an author on their first command.

**One shape, no options.** The quill is the smallest one worth reading, since the first thing an author does is rename and delete. It ships no font and declares `CC0-1.0`, so its first `build app` raises no licensing warning.

**`init` refuses rather than merges.** A starter entry already in the directory fails the verb before anything is written; an existing `package.json` is left alone.

### The local loop

**The pack always includes drafts**, since a quill under `0.1.0` is the likeliest thing on an author's screen.

**The pack landing whole is quiver's** (quiver/INVARIANTS §"The generation lands whole"). What is left here is the trigger: watcher bursts collapse to one repack, the outputs are filtered out of the watch so it does not repack forever, and the queue survives a failed pack, since a quiver mid-edit is invalid as often as not.

**The server is written rather than borrowed.** A general-purpose static server gets two things wrong here: `.wasm` must be served as `application/wasm` for streaming instantiation, and a path escaping its root must be refused on the resolved path.

### The deploy layout

**The verb is the whole encapsulation**, so there is no workflow beside it: a consumer's scripts, this repository's CI and a Pages job all reach the layout by running it.

**What can refuse is read before anything is cleared**, so a bad `App.yaml` or a refused quill leaves the last deploy standing. An `--out` holding the quiver or the working directory is refused.

**What the layout cannot assert is the host's, and it is four rules**: `assets/*` immutable, no edge cache on `quiver/quiver.json`, a missing path answered as a 404, and https. `preview` serves a build under the first three, so a deploy is looked at locally under the rules it will meet.

**The gate is the recipe's, not `build`'s.** `build` compiles nothing, so a quill whose plate does not compile builds cleanly; every documented recipe runs `check` first.

### The app target

**Convention over configuration.** Everything the app target reads is found by name beside `Quiver.yaml`, none of it required, and `build app` resolves it into `app.json`, which is all the client reads at boot.

**The quills are the quiver's.** The app opens every quill the pack holds at its latest version, so a different set of forms is a different quiver.

**`App.yaml` names the app and nothing else, and an unknown key is refused.** Rejected: a look in it, which would be a second theming system, and a quill list, which would be a second way to say what the quiver says.

**`app.css` lands last, and its files with it**, so a rule of equal rank is the author's. A `url()` naming a file outside the quiver is refused, and a selector aiming at anything the theming contract does not promise (THEMING §"What a stylesheet may aim at") is warned.

**A quill without a licence is warned, not refused.** An app hands its plate and fonts to every reader, which is a licensing question the author answers in `Quill.yaml`.

## Studio

The surface a quill author looks at their quiver through. `check` answers *does it work*; studio answers *what is it like to use*. Two readers, one client: the author mid-edit against files on disk, and a reader who arrives at a deployed URL over one built quiver.

### Not the playground

**Studio holds the wiring fixed and makes the quill the subject.** The playground holds the quill fixed and makes the wiring the subject, so it shows its instruments; studio hides them and runs the two mounts to the viewport's edges, because every pixel of chrome is one not spent on the quill.

### Opened, not stood on

**The reader who followed a link is owed one line and one door**, in the bands that already exist: the head carries the quiver's own description beside its name. Rejected: a landing page, which costs the author a click every boot, and a band above the split, which spends the surfaces' height on prose read once.

**Studio does not define its own vocabulary.** A paragraph explaining what a quill is would be prose nobody with authority over the document model reviewed, wrong in every deployed studio the moment the model moves. What studio says is limited to what studio is.

**The address bar names the quill** in the grammar `getQuill` takes. A query rather than a path, so no static host needs a rewrite rule, and `replaceState` rather than a push, since back means leave.

**Nothing opens on boot and nothing is stored**, so an author who never presses a control is where they were.

### A client, and what serves it

**Studio is an ordinary quiver consumer over a built artifact.** A browser cannot read the source layout, so packing, watching and serving are `quillkit serve`'s. The quill is borrowed from the quiver's cache, so studio frees the session and the document and nothing else.

**Nothing in the client is importable**, so studio's wasm never lands in an importer's process, which is the thing the artifact's single-copy rule exists to prevent.

**A pack is never the client's.** A quiver is laid beside the client at deploy time, so a built client serves from wherever it is put.

**The bundle names what it carries.** A browser resolves nothing, so the build stamps the versions of the wasm and each bundled sibling (`scripts/carried.mjs`), and the head states the wasm version that painted the page.

**The bridge is studio's own; the shell's shape is not.** The caret bridge and the debounced recompile are consumer-layer by design; the bands and the split are the preset's classes on studio's elements, the same import a third-party consumer makes.

### The document is the blueprint's

**Studio holds one document, and it starts as the quill's own**: the example document while **Examples** is on, else the seed. No document of studio's outlives the tab, so reload is the reseed and a `default:` or `example:` edited mid-session appears after F5.

**The example is on by default** because the failures a long list or a wrapping value reveal are invisible on the seed. The toggle is the one key in browser storage, since how an author judges quills is a habit across quills and launches; it holds no document, so nothing stale lands on a field.

### The document has doors

**Markdown, not the storage DTO.** The DTO's version coupling to `@quillmark/wasm` is recorded nowhere a kept file could rely on, while markdown is readable, portable to the CLI, and re-conformed on the way in. In is the repack's own ingestion (`quill.parse`), so what an import strands is shown on the controls it is about.

**The rendered file is taken from the snapshot the preview is painting**, so the file never disagrees with the page it was taken from.

**No door here is the write door.** Each moves a document or a render of one; nothing reaches a `Quill.yaml`, a plate or a quiver (§"The door rule").

### The document survives the quill

**A repack drops the quiver rather than invalidating it**: a new `Quiver`, a re-`getQuill`, the old handles going with the old open. What crosses is the document as canonical markdown, landed through `quill.parse`, so an incompatible schema change strands what it will not take with `conform::*` diagnostics on the controls they name, and nothing is swallowed. A deployed studio listens for nothing.

**A pick, unlike a repack, carries nothing**: a different quill is a different document. Two overlapping opens drop the loser.

### The errors

**A diagnostic is shown where it is about, and nowhere else.** There is no list. A `path` is the document's, and the editor routes it to its control; a `location` is the quill source's, and the strip over the paint names it. A diagnostic with neither reaches nothing, and `check` is where a quill's own faults are answered for.

**A document that will not compile is a state of the paint.** The last good paint stays on screen with the failure laid over it, so breaking and fixing a plate does not resize what is being judged.

**The editor stands either way.** It needs no session, so a failed open costs the preview alone, and the edit that answers the failure retries the open.

### The door rule

**Quiver owns the authored source layout and every door onto it; a door moves bytes into the layout and does not know what the bytes mean.** A door that must parse a `Quill.yaml` is studio's, and quillkit's job is to hang it. No write door exists yet: designing a protocol before there is an editor to shape it is how the wrong one gets built.

## The app

The client a quiver's readers reach: someone with a form to fill in, who has never heard of a quill.

**Nothing on the app names a quill, a ref, a version, a file or a line**, since a reader can act on none of them. The surfaces and the bridge are studio's; the difference is everything around them.

### Boot

**The first paint is the author's look.** The mount waits on the author's `app.css`, linked after the client's own sheets.

**The form mounts on the core alone**; the render build and the font suite load behind it, so the page follows the form rather than holding it back.

### Documents

**A document is kept from its first edit**, saved after each settled burst and when the tab hides, so nothing typed is lost to a debounce. A blank form a reader looked at and left leaves nothing behind.

**What is kept is markdown**, for the reason studio's doors take it (§"The document has doors"), with the canonical ref it was made on. The record carries a shape version, and the suite holds records as shipped releases wrote them (`tests/app/fixtures/`), each of which must still open.

**One database per app**, keyed by the app's base URL, so two apps on one origin never read each other's documents. A store the browser refuses leaves the app working on the document in hand and saying it keeps nothing.

**The drawer says the documents are saved in this browser only**, since a reader who expects an account is owed being told there is none.

### Download

**The file is the document in hand.** A press flushes a settling keystroke, waits on an open in flight, and writes from the session the page is painted from. A document that does not render is refused rather than written from the last good page.

### Retired pins

**A document reopens on the ref it was made on**, so a quiver that moves a quill to a new version does not move a reader's half-filled form under them. A pin the pack still holds opens on it with an update offered; a pin the pack no longer holds stands as its record, downloadable as markdown.

**An update offers the markdown first.** Moving to the latest version conforms the document and can strand answers, so the dialog's first action is the download. A pin that fails to open, or an update that fails, leaves the record as it was.

**Not offline.** There is no service worker; what outlives the tab is the documents. Typst plates are what the app is built and checked over, so acroform quills are not promised.
