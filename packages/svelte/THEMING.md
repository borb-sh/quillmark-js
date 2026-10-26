# Theming

`@quillmark/svelte` ships complex UX over a thin skin: the surfaces carry the behavior (direct manipulation, the caret bridge, per-field state) against a neutral visual baseline a consumer restyles to its brand without fighting baked-in design.

There are three depths to that. An app mounting into an unstyled page stops at the first; an app with a plate of its own starts at the second:

|                   | You write              | You get                                                 |
| ----------------- | ---------------------- | ------------------------------------------------------- |
| **Drop it in**    | nothing                | a mounted surface that looks right in a bare `<div>`    |
| **Make it yours** | nine custom properties | the whole surface rescaled and recolored to your brand  |
| **Match ours**    | one CSS import         | the page around the surface, drawn the way we draw ours |

## Drop it in

```svelte
<VisualEditor {doc} {quill} />
```

Nothing to import and nothing to set. The package pulls its own stylesheet, and each surface owns its whole **column**, not only the cards in it: the gutter the stack sits in, the tone behind it, and (for the preview) the desk the painted sheet floats on. A bare `<div>` is a mounting site.

**Mounting into a fixed-height pane**: pass `class="qm-pane"`. The surface becomes its own scroll container and takes a scroll tail, so the last card can be read at the middle of your pane rather than against its bottom edge. Without it the editor grows to its content and your page scrolls, which is what you want when the editor _is_ the page. The preview always scrolls: a viewport onto a document has nothing else to be.

`.qm-pane` is opt-in on the editor rather than the default because the editor is what its own popovers portal into, and a scroll container clips them. In a pane you would have had that clipping from your own scrolling frame anyway; in a page you should not have it at all.

**Placing and sizing**: each surface carries a stable root class (`.qm-editor`, `.qm-preview`), so you can place it from your own stylesheet without a wrapper. Each also takes a `class` prop that merges onto the same element, which is the better handle when you have one to give.

A surface's width is the one you give it. Each contains its own inline size, so what a document holds — a table is as wide as its columns — scrolls inside the mount rather than widening the column the mount stands in.

**Taking the column back**: our selectors compute at specificity zero (below), so `padding: 0` or a `background` of your own on `.qm-editor` wins outright. Nothing is locked.

## Make it yours

The whole contract is **nine CSS custom properties**. They are dials, not a palette: each derives a closed private scale that every component reads, so one override rescales or recolors the whole surface. Set them on any ancestor of a mounted surface (the app, or one pane):

```css
.my-editor {
	--qm-bg: #fff;
	--qm-fg: #10233b;
	--qm-accent: #6d28d9;
	--qm-font: 'Inter', system-ui, sans-serif;
}
```

### Two of them are not branding

`--qm-bg` and `--qm-fg` are the two a themed host sets before any brand decision. Their defaults are a self-consistent neutral for a bare mounting site, not a guess at your page.

`--qm-bg` is the **card**, not the column behind it: the plane a document is written on, which is also the sheet the preview paints. Everything else is a step off it, and the column the cards sit in is a step down, so a mounted editor draws its own ground and the cards read as islands on it. Give it the tone you want a card to be — white, in most light themes — and let the column fall out. If you want the column to meet your page instead, set a `background` of your own on `.qm-editor`; any rule of yours wins.

The poles take a colour, not `transparent` or `inherit`: the raised surfaces, the borders and the muted inks are each a `color-mix` against `--qm-bg`, so a transparent pole makes every one of them translucent instead of letting your page through. Hand over the value your page is painted with and the derivation steps off it.

### The dials

| Token            | Default                                | What it sets                                                                                                                                                   |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--qm-bg`        | `#fff` / `#272729`                     | Base surface: a card, and the preview's sheet. Fields, the popover and the column behind the cards each step off it.                                           |
| `--qm-fg`        | `#1c1c1c` / `#d7dadc`                  | Base ink. Body text, labels, and borders step off it.                                                                                                          |
| `--qm-accent`    | `#71717a` / `#a1a1aa`                  | Focus rings, active marks, the preview's active field box. The surface spends no hue of its own, so this is the one it wears.                                  |
| `--qm-danger`    | `#9e1518` / `#f9786c`                  | Error diagnostics and the delete glyph.                                                                                                                        |
| `--qm-font`      | `ui-sans-serif, system-ui, sans-serif` | The editor surface's font family. Controls and buttons take it too, in place of the UA face.                                                                   |
| `--qm-font-mono` | `ui-monospace, monospace`              | The monospace face: the JSON array control, the tips card.                                                                                                     |
| `--qm-font-size` | `0.875rem`                             | Chrome text: every control's size, the anchor the ramp derives up (title) and down (label/meta) from, and the anchor a document body sits one small step over. |
| `--qm-radius`    | `8px`                                  | Card & popover corner. Interior controls derive a tighter tier (half), so a square brand is square throughout.                                                 |
| `--qm-space`     | `0.25rem`                              | Spacing base. Gaps and insets are `half`/`1×`/`2×`/`3×`/`4×` multiples of it.                                                                                  |

Give a length dial a length: `--qm-space: 4` is a valid custom property and an invalid length, so it substitutes through every `calc()` that reads it. Where `@property` is supported the surface absorbs that, landing on the package default rather than collapsing the padding to zero.

### Your CSS beats ours

The rules behind every class the surfaces promise you — `.qm-editor`, `.qm-preview`, `.qm-pane` — are wrapped in `:where()` and sit in no cascade layer, as are the derivation and the shared control recipes under them. So **each computes at specificity zero**, and two things follow:

- **Any rule of yours wins**, at any specificity and without `!important`. A bare `.qm-editor { … }` does it; so does a bare `input`.
- **No layer of yours can reach them**, because unlayered rules outrank every layer. A reset in a layer — Tailwind v4's preflight in `@layer base` is the common one — cannot strip the controls however your bundler orders the sheets. There is no layer statement to write and no sheet order to get right.

One thing still outranks us: an **unlayered** blanket reset of your own (`* { padding: 0 }` in no layer) ties at specificity zero and wins on source order. Put it in a layer, where Tailwind, Bootstrap and Open Props already put theirs, and it stops reaching us.

### The surface follows your colour scheme

Ink steps `fg → bg` and the borders and hover fills step `bg → fg`, mixed in **oklab**, so inverting the two poles inverts all of them together.

**Planes are the exception**, and deliberately: the raised plane is the brighter one in both schemes, which is what makes a card read as a card rather than as a differently-tinted page. So the column under the cards sinks from `--qm-bg` toward shadow and a floating surface rises from it toward light, and neither reads the ink pole. How far each steps is a function of the card's own lightness — a dark card has to spend more before the plane above it reads as lifted — so a palette pinned at neither pole takes a proportionate step without being told which scheme it is in.

Which way the poles default is **your `color-scheme`**, not the operating system's. Declare the scheme your app is in and the surface lands on it, along with native chrome, which reads the same property:

```css
html {
	color-scheme: light dark; /* follow the OS */
}

/* A class-driven theme declares the scheme alongside the class. */
html.dark {
	color-scheme: dark;
}
```

Declare nothing and you get light. A dark app that skips this line gets a light editor in a dark page, and light scrollbars, date pickers and carets throughout. (The preset below declares `light dark` for you.)

Setting the poles yourself wins over the default in both schemes, so a fixed palette stays fixed:

```css
.my-editor {
	--qm-bg: #14171c;
	--qm-fg: #e8eaed;
}
```

That cuts both ways for the status hue: `--qm-danger` defaults to a pair calibrated against the card at both poles, and one pinned value replaces both arms, so a red measured against white carries into the dark scheme unmeasured. Pin it under your own scheme rule (`.dark { --qm-danger: … }`) where the colour your app means by error is itself scheme-aware.

A palette **pinned against** your own scheme still wants a second line, for a smaller reason than it used to be: the planes read your card's lightness, so the surface itself lands right either way, but the poles' own defaults, the status hue and native chrome all still read `color-scheme`. Pin it with them (`.my-editor { color-scheme: dark }`). Skip that line and what the browser paints — the selection highlight, the scrollbar, the spinner — stays on whichever scheme the host inherits, and a status hue you left to us is measured against the wrong card.

Pinning **one mount** rather than a page is the `style` prop, which lands on the same root: `<Preview style="color-scheme: dark" />`. There is no `scheme` prop, and deliberately — an inline declaration of ours would be the one thing your own CSS could not beat.

No JS runs and no media query: the derivation resolves through the cascade at paint time, so there is no `dark` prop and no mode toggle. The consumer's palette decides.

## Match ours

A mounted surface looks right on its own. The page around it (the label over a readout, the status line, the plate your controls sit on) is yours, and if you have a design system it should stay yours. If you do not, take ours:

```js
import '@quillmark/svelte/preset';
```

```html
<body class="qm-page">
	<p class="qm-label">quill</p>
	<pre class="qm-readout">showcase@1.0.0</pre>
</body>
```

This is the stylesheet our own apps import: the playground, studio and quillkit's app client draw with these rules and nothing else, so what you get is what we ship, not a reduction of it.

It carries a `--qmh-*` scale for the page, derived from the same nine dials and calibrated against the surfaces' own steps, so a plate of yours and a card of ours agree about which way "raised" goes. Turning a dial moves both.

| Class         | What it is                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.qm-page`    | The page baseline: tone, ink, face, leading, and `color-scheme: light dark`. Put it on `<body>` or the element your app mounts into. |
| `.qm-panel`   | The plate your controls and readouts sit on: one rung off the page, a hairline, a corner.                                            |
| `.qm-label`   | A run of chrome type: a section label, the name over a value.                                                                        |
| `.qm-readout` | A value read back out of the session, monospace and tabular. `<pre class="qm-readout">` is the block form.                           |
| `.qm-status`  | A phase line. `.qm-status-error` is the one it fails to.                                                                             |
| `.qm-control` | A boxed button or select, which is what a host's controls are and the package's are not.                                             |
| `.qm-measure` | A reading column at the width a passage wants.                                                                                       |

### The shell, if you are building a tool

An app that mounts an editor beside a preview over one session needs a screen to put them in, and the shape of that screen is the same every time. Five more classes are that shape, so what you write is the wiring rather than the grid:

```html
<div class="qm-workspace">
	<header class="qm-bar site-head">
		<span class="site-mark">acme<span class="site-slash">/</span>studio</span>
	</header>
	<div class="site-body">
		<div class="qm-switch" role="group" aria-label="Visible pane">
			<button class="qm-control" aria-pressed="{shown" ="" ="" ="1}" onclick="{()" ="">
				(shown = 1)}>Editor
			</button>
			<button class="qm-control" aria-pressed="{shown" ="" ="" ="2}" onclick="{()" ="">
				(shown = 2)}>Preview
			</button>
		</div>
		<div class="qm-split" data-qm-show="{shown}">
			<section class="qm-frame"><!-- <VisualEditor class="qm-pane" /> --></section>
			<section class="qm-frame"><!-- <Preview /> --></section>
		</div>
	</div>
</div>
```

| Class           | What it is                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.qm-workspace` | The screen: pinned to the viewport, three bands (a head, the body, an optional foot), the body taking what is left and the document scrolling nowhere.                                            |
| `.qm-bar`       | The row a band puts its parts on, wrapping and centred. The rule under it, the gutter beside it and its depth stay yours: that is your page shell.                                                |
| `.qm-split`     | Two even tracks for two surfaces, the page gap between them. Under `50rem` wide or `30rem` tall, one track at a time; `data-qm-show="1"\|"2"` says which.                                         |
| `.qm-switch`    | The band that says which track is showing, and nothing at the widths where both are. Its controls read as even halves and stand at the touch floor (`--qmh-tap`, 44px); depth past that is yours. |
| `.qm-frame`     | The mounting site: an edge, a corner, and the clip that holds a surface to them. What is inside it is the surface's own.                                                                          |

The narrow shape is one mount at a time, not two of them stacked: half a narrow viewport is under the width either surface reads at. The track you are not showing is `display: none`, so it leaves the tab order, hit-testing and the accessibility tree together: you need no `inert` on it, and no breakpoint in your JS, since the only state you hold is which of the two you last asked for. Keep both mounted: the hidden pane keeps its pixels, its caret and its scroll, and comes back to them — it rasters nothing at a box it has none of, and repaints only where it returns to a box that draws its pages at another scale. A preview scroll asked for while it was hidden is held and run on the way back, so it opens at the caret rather than several edits behind it. A click that lands in the hidden pane is the one thing the shape adds to your wiring, so send the caret and reveal the track together, or the hit goes somewhere the reader cannot see.

Every rule behind the five is wrapped in `:where()`, so it computes at specificity zero: a rule of yours on the same element wins at any specificity and in any sheet order, which is what lets a stylesheet written by someone other than the app's author (an `app.css` over quillkit's app client) restyle a band without knowing which shell rules set it.

The shape is shared; the look of a band is not. Your wordmark, your nav and the depth of your head are the most app-specific things on the screen, and a preset that drew them would hand every tool built on this the same face, so they read `--qmh-*` like everything else and you write the rules. `.qm-split`'s gap is a default rather than a fact about splitting: close it to `0` and carry a hairline on one pane if you want the two mounts to meet instead of stand apart.

It is **unlayered**, and nothing in it outranks a rule of yours aimed at the same element: the page, type, status and control recipes compute at ordinary specificity, so your own rules beat them by ordinary precedence, and the shell and the app chrome compute at specificity zero, as the surfaces do. It is also opt-in and side-effect free until imported: nothing that styles your document arrives with a component.

One rule in it earns its place regardless of whether you take the rest, and you want it if you draw a focus ring of your own — cut the mounted surfaces out of the blanket:

```css
:focus-visible:not(:where([data-qm-root], [data-qm-root] *)) {
	outline: 2px solid; /* your ring, on your page */
}
```

A blanket `:focus-visible` of yours outranks ours, including on the controls that already draw one, so a ring written for the controls that draw none repaints the ones that do. The cut-out leaves yours everywhere else, and `:not(:where(…))` contributes no specificity, so your rule ranks exactly as it would without it.

### The app chrome

A tool's bands are yours, since a tool's head is the most app-specific thing on its screen. An app whose whole page is one form to fill in has less to say there: a name, the action the page leads to, and a line signing it. Four classes draw that much, quillkit's app client wears them, and a host of its own takes them the same way:

| Class             | What it is                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `.qm-app-header`  | The band naming the app: a plate, a gutter and a hairline under it. Put it beside `.qm-bar`.      |
| `.qm-app-title`   | What the app is called, at the title rung: the one line on the screen read as a name.             |
| `.qm-app-footer`  | The line signing the app, in meta type under a hairline; its links take the line's own ink.       |
| `.qm-app-primary` | The one action the page leads to: the control wearing `--qm-accent`, standing at the touch floor. |

They compute at specificity zero, as the shell does, so `.qm-app-header { background: #00308f; color: #fff; }` is the whole of rebranding the head.

## What a stylesheet may aim at

A stylesheet you write against a mounted surface, or one an author writes over an app someone else built, may aim at these and nothing else:

- the nine dials (§"The dials");
- the surface roots, `.qm-editor` and `.qm-preview`, and `.qm-pane`;
- `data-qm-card="<kind>"`, on the box of every card the editor draws, its value the card's kind and `main` for the main card;
- the preset's classes, on your own DOM, if you import it (§"Match ours").

`data-qm-card` is the one hook named by the schema rather than by the package: a rule aimed at a kind lands on that kind's cards wherever the editor puts them, which is the one thing a quill-specific restyle needs and a dial cannot say.

```css
[data-qm-card='indorsement'] {
	border-left: 3px solid var(--qm-accent);
}
```

Nothing names a field or a property. Every other `data-qm-*` attribute the surfaces carry, `data-qm-prop` among them, is something the surface queries itself, and moves when it does.

## What is deliberately not public

The two root classes and `.qm-pane` are the whole class contract on the surfaces. Every other `qm-*` class inside them is internal and renames without notice: a class contract over the interior would freeze the DOM shape the surfaces are free to re-cut, and the dials already reach the values a restyle wants. The preset's classes are a contract of their own: they land on _your_ DOM, so they freeze nothing of ours.

The derived surface scale (surface / border / ink rungs, the blur radius, the popover's translucency ratio, the recede-opacity ladder, the two leading rungs, the overlay ring widths, the scroll tail) is internal on the same terms, and declared **on** each root element, so setting a rung from an ancestor does nothing. A dial appears when a real consumer needs one; every dial is one more thing a reader has to hold.

## Requirements

`:where()`, `color-mix()`, `light-dark()` and relative colour syntax (`oklab(from …)`): Baseline since 2021, 2023, 2024 and 2024 respectively — the last is what lets a plane step by the card's own lightness. `@property` is the one feature the surface does not require: where it is missing, an invalid length dial collapses the surface rather than falling back.
