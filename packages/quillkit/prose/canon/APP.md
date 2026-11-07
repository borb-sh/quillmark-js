# App

> **Implementation**: `app/`

## TL;DR

The client a quiver's readers reach: someone with a form to fill in, who has never heard of a quill. One form beside the page it prints, a Download PDF press, and the documents they have started kept in their browser. `quillkit build app` lays it over a packed quiver with the `app.json` that says which quills it opens (QUILLKIT §"The app target"); this doc is the client itself.

Studio is for the quiver's authors and shows the quiver; the app is for its readers and shows a form ([STUDIO.md](STUDIO.md)). The surfaces and the bridge are the same, so the difference is everything around them: **nothing on the app names a quill, a ref, a version, a file or a line**, since a reader can act on none of them.

## Boot

`app.json` is fetched against `document.baseURI`, so an app serves from wherever it is put. It sets the tab's title and icon and links the author's `app.css` after the client's own sheets, and the mount waits on that sheet so the first paint is the author's look.

Then the core wasm, the quiver and the store, with the font suite downloading beside them (FONTS §"Size and loading"). The form mounts on the core alone; the render build loads behind it, so the page follows the form rather than holding it back. A boot that fails says so in one line and puts the detail in the console.

## The first screen

**One quill opens its form; several open a choice**, one card per quill with its title and description.

**A reload reopens what was open**, so a reader who closes the tab mid-form comes back to it.

**The head is the app's name and two presses**: My documents and Download PDF, the one primary action. The footer names the Quillmark release the client bundles, the one place the app says what it is made of. On a phone the split shows one track at a time, and a press on the page brings the form up with the caret in it.

## Documents

**A document is kept from its first edit**, saved after each settled burst and when the tab hides, so nothing typed is lost to a debounce. A blank form a reader looked at and left leaves nothing behind.

**What is kept is markdown**: a record of the canonical markdown, the canonical ref it was made on, a title and an edit time. Markdown for the reason studio's import takes it (STUDIO §"The document has doors"): it reads as a file, re-conforms on the way in, and rides no coupling to the wasm's storage DTO. The record carries a shape version, and the suite holds records as shipped releases wrote them (`tests/app/fixtures/`), each of which must still open.

**IndexedDB, one database per app**, keyed by the app's base URL so two apps on one origin never read each other's documents. A private window that refuses the store leaves the app working on the document in hand and saying it keeps nothing.

**My documents is a drawer** listing each document with open, download as markdown, and delete. It says the documents are saved in this browser only, since a reader who expects an account is owed being told there is none.

**A document's title is read off its answers**: the main card's first answered text field, preferring `title` or `subject`, else the quill's own title. It names the drawer row and the downloaded file.

## Download

**The file is the document in hand.** A press flushes a settling keystroke, waits on an open in flight, and writes the PDF from the session the page is painted from. A document that does not render is refused rather than written from the last good page, and the refusal says whether an answer needs fixing or the form itself cannot render.

## Retired pins

A document reopens on the ref it was made on, so a quiver that moves a quill to a new version does not move a reader's half-filled form under them. Each pin stands one of three ways against the loaded pack:

- **current**: the document opens as it was left.
- **retired**: the pack still holds the version. The document opens on it, with a note and an Update to the latest form press.
- **missing**: the pack no longer holds it, so the document stands as its record, downloadable as markdown and updatable where the app still opens that quill.

**An update offers the markdown first.** Moving to the latest version conforms the document and can strand answers, so the dialog's first action is the download; what the move stranded is shown on the fields it is about until the first edit. A pin that fails to open, or an update that fails, leaves the record as it was.

## The chrome

The app is drawn with `@quillmark/svelte/preset`: the preset's shell and its app chrome (THEMING §"The app chrome"). Everything an author's `app.css` may aim at is THEMING §"What a stylesheet may aim at"; the client's own classes are not in it.

## Not

Not studio: nothing about the quill. Not an account: documents live in one browser and leave it as files. Not offline: there is no service worker, and what outlives the tab is the documents. Not promised over acroform quills: Typst plates are what it is built and checked over.
