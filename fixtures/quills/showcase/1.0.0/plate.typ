#import "@local/quillmark-helper:0.1.0": data, display, form-field, signature-field
#import "@local/showcase-layout:1.0.0": (
  accent-rule, callout, mono-face, plain-text, showcase-page,
)

#let accent = data.at("accent", default: "slate")

#show: showcase-page.with(
  // A string, not `data.title`: see `showcase-page` on why the running head takes
  // a flattened projection and the block stays in the flow. The projection is the
  // quill's own walk — the helper offers no content-to-string coercion.
  running-title: plain-text(data.title),
  status: data.at("status", default: "draft"),
  accent: accent,
  font-size: data.at("font_size", default: 10.5) * 1pt,
  watermark: data.at("draft_watermark", default: false),
)

// A date arrives as a native `datetime`, so `data.<field>` is what arithmetic and
// comparison take. Rendered ink is reached by schema address instead: `display`
// keys on the address, returns `none` for a blank date, and its glyphs carry that
// address, so a date stays click-to-edit however it is formatted.
#let shown-date(addr, fallback) = {
  let ink = display(addr, "[year]-[month]-[day]")
  if ink == none { fallback } else { ink }
}

// A `variants:` enum rests as a container, `{value, …the live member's fields}`. The
// branch covers `values ∪ blank` and its last arm is the blank's, not a fallback: an
// `else` standing for "anything else" would print a world nobody chose. Inside a
// branch every declared cell of that world is present, so a cell needs no presence
// guard — only its value is worth one.
//
// The discriminant is bound for the branching, and every *emitted* cell is read off
// `data` directly: a direct read regions at the property, so these cells reach the
// preview as `main.distribution.<cell>`. A cell read through a local binding carries
// no address.
#let distribution-note = {
  let world = data.distribution.value
  if world == "internal" [Internal]
  else if world == "public" [Public · #data.distribution.license]
  else if world == "embargoed" [
    Embargoed#if data.distribution.lift_on != "" [ until #data.distribution.lift_on]#if data.distribution.held_by != "" [ · #data.distribution.held_by]
    // A variant cell holding a record list. A row's `text` is a content cell, so it
    // regions at `main.distribution.notices[i].text` through the loop; `party` is a
    // scalar and reaches the preview through the field alone.
    #for n in data.distribution.notices [ · #n.at("party", default: "")#if n.at("text", default: "") != "" [: #n.text]]
  ] else [Distribution unset]
}

// The second `variants:` enum, whose `default:` is the blank. The blank owns no world,
// so the last arm is what an unset document reaches as well as a blank one, and the
// members are read as marked rather than as ids. A prose cell arrives as its markup
// block when written and as the empty string when not, so the guard is a content
// field's anywhere else.
#let handling-note = {
  let world = data.handling.value
  if world == "OPEN" [Open]
  else if world == "CONTROLLED" [
    Controlled#if data.handling.controlled_by != "" [ by #data.handling.controlled_by]#if data.handling.caveat != "" [ · #data.handling.caveat]
  ]
  else if world == "CLOSE HOLD" [Close hold]
  else [Handling unset]
}

// ── Letterhead ──────────────────────────────────────────────────────────────
#grid(
  columns: (auto, 1fr),
  column-gutter: 12pt,
  align: horizon,
  image("assets/mark.png", width: 46pt),
  {
    text(size: 19pt, weight: "bold", data.title)
    // A blank content field arrives as the empty string and a written one as its
    // markup block, so `!= ""` is the guard a placement takes.
    if data.at("subtitle", default: "") != "" {
      linebreak()
      text(size: 11pt, style: "italic", data.subtitle)
    }
  },
)

#v(4pt)
#accent-rule(accent: accent)

#let authors = data.at("authors", default: ())
#let poc = data.at("contact", default: (:))
#text(size: 9pt)[
  #if authors.len() > 0 [#authors.join(", ")]
  #if poc.at("name", default: "") != "" [
    · #poc.name#if poc.at("email", default: "") != "" [ (#poc.email)]
  ]
  · Issued #shown-date("issued", [—])
  #let revised = display("revised_at", "[year]-[month]-[day] [hour]:[minute]")
  #if revised != none [ · Revised #revised]
  #if data.at("tracking_id", default: "") != "" [ · #raw(data.tracking_id)]
  #if data.at("reference", default: none) != none [ · re #data.reference]
  // A property's date is a `datetime` like a card-level one, so the property is
  // addressed the same way rather than placed as the string it used to be.
  #let reply = display("contact.reply_by", "[year]-[month]-[day]")
  #if reply != none [ · reply by #reply]
  #if poc.at("listed", default: false) [ · listed]
  #if poc.at("note", default: "") != "" [ · #poc.note]
]

// A table's rows are all scalars, so the loop reaches the preview through the array's
// own region and no row names itself. A date cell arrives as a native `datetime`, or as
// the string blank where the row left it unset.
#let contributors = data.at("contributors", default: ())
#if contributors.len() > 0 {
  v(4pt)
  text(size: 9pt, {
    strong[Contributors]
    for c in contributors {
      let since = c.at("since", default: none)
      linebreak()
      [#c.at("name", default: "") — #c.at("role", default: "author")]
      if type(since) == datetime [ (since #since.display("[year]"))]
      if c.at("lead", default: false) [ · lead]
    }
  })
}

#if data.at("epigraph", default: "") != "" {
  v(6pt)
  align(center, block(width: 78%, text(size: 9.5pt, data.epigraph)))
}

// ── Abstract, keywords ──────────────────────────────────────────────────────
#if data.at("abstract", default: "") != "" {
  v(8pt)
  block(inset: (left: 14pt), text(size: 9.5pt, data.abstract))
}

#let keywords = data.at("keywords", default: ())
#if keywords.len() > 0 {
  v(4pt)
  text(size: 9pt, { strong[Keywords: ]; keywords.map(box).join[, ] })
}

// `errata` rows are `plaintext`, so each row's markdown delimiters reach the page
// as the characters they are rather than as the emphasis they would mark.
#let errata = data.at("errata", default: ())
#if errata.len() > 0 {
  v(6pt)
  text(size: 9pt, {
    strong[Errata]
    list(..errata)
  })
}

// ── Body ────────────────────────────────────────────────────────────────────
#v(10pt)
#columns(data.at("columns", default: 1), data.at("$body"))

// ── Signature ───────────────────────────────────────────────────────────────
// A widget, not text: `main.signature_block` reaches the region table through
// this placement and through no glyph span of its own.
#v(16pt)
#align(right, {
  signature-field("Signature", width: 200pt, height: 34pt, field: "signature_block")
  for line in data.at("signature_block", default: ()) {
    line
    linebreak()
  }
})

// ── Cards ───────────────────────────────────────────────────────────────────
// One arm per kind. `Engine.open` refuses a card whose kind the schema does not
// declare, so only declared kinds reach here; the `$kind` read carries a default
// regardless, the guard being the plate's rather than the engine's.
#{
  let section-no = 0
  for (i, card) in data.at("$cards").enumerate() {
    let kind = card.at("$kind", default: none)
    let path = card.at("$path")
    // The helper leaves an unset body as the empty string; only a written one is
    // content, so the empty case passes `[]` rather than a stray `""`.
    let raw-body = card.at("$body", default: "")
    let card-body = if type(raw-body) == str { [] } else { raw-body }

    if kind == "section" {
      if card.at("numbered", default: true) { section-no += 1 }
      let label = if card.at("numbered", default: true) [#section-no. ] else []
      v(8pt)
      heading(level: 2, outlined: false)[#label#card.at("heading", default: "")]
      if card.at("lead", default: "") != "" {
        text(size: 9.5pt, style: "italic", card.lead)
        parbreak()
      }
      let layout = card.at("layout", default: "prose")
      if layout == "callout" {
        callout(accent: accent, card-body)
      } else if layout == "aside" {
        block(inset: (left: 24pt), text(size: 8.5pt, card-body))
      } else {
        card-body
      }
    } else if kind == "note" {
      let tone = card.at("tone", default: "neutral")
      v(6pt)
      block(
        width: 100%,
        inset: (left: 10pt),
        stroke: (left: 2pt + if tone == "warning" { rgb("#b45309") } else { luma(180) }),
        {
          text(size: 8pt, weight: "bold", upper(card.at("label", default: "Note")))
          linebreak()
          card-body
        },
      )
    } else if kind == "figure" {
      // A variant-bearing enum on a card rests as a container, read as the main
      // card's `distribution` is; inside the `float` arm its `side` cell is present.
      let placement = card.placement.value
      let figure = block(
        width: if placement == "float" { 60% } else { 100% },
        inset: 6pt,
        stroke: 0.5pt + luma(180),
        {
          card-body
          if card.at("caption", default: "") != "" {
            v(3pt)
            text(size: 8.5pt, style: "italic", card.caption)
          }
        },
      )
      v(6pt)
      if placement == "float" {
        align(if card.placement.side == "start" { left } else { right }, figure)
      } else {
        figure
      }
    } else if kind == "signoff" {
      v(10pt)
      // The region keys on this card's own `$path`, so a click lands on this
      // instance's field rather than on the kind's first.
      signature-field("Signoff_" + str(i), width: 180pt, height: 34pt, field: path + "signature_block")
      for line in card.at("signature_block", default: ()) {
        line
        linebreak()
      }
      text(size: 9pt)[Date: #shown-date(path + "signed_on", box(width: 90pt, line(length: 100%)))]
    }
  }
}

// ── Colophon ────────────────────────────────────────────────────────────────
// A second page, unconditionally: a one-page fixture proves nothing about the
// page counter, the running head, or a preview that scrolls.
#pagebreak()
#accent-rule(accent: accent)
#v(4pt)
// The title restated. Its second placement is what makes `main.title`'s regions
// non-unique and page-spanning, the case a scroll-to-field rule has to answer.
#text(size: 12pt, weight: "bold", data.title)
#v(4pt)
#text(font: mono-face, size: 8pt)[
  #data.at("status", default: "draft") · #accent · #str(data.at("columns", default: 1)) col · #str(data.at("font_size", default: 10.5)) pt
  #linebreak()
  #distribution-note
  #linebreak()
  #handling-note
  #linebreak()
  // A row's cells are reached through the loop's own binding, which carries no
  // address, and a scalar carries no span of its own — so `note` and `pages` reach the
  // preview through `main.revisions` alone. A content cell's spans ride its value, so
  // `detail` regions at `main.revisions[i].detail` wherever it is placed: the nested
  // row address a landing resolves through.
  #for rev in data.at("revisions", default: ()) [
    #rev.at("note", default: "revised") (#str(rev.at("pages", default: 0)) pp)#if rev.at("detail", default: "") != "" [ — #rev.detail]
    #linebreak()
  ]
  // The matrix arrives total, every member in roster order carrying `held`, its roster
  // `title`, and the columns. Only a held member prints. `note` is a content
  // cell, so it regions at `main.checks.<member>.note`; `held` and `severity` are
  // scalars read through the loop and reach the preview through the field.
  #let held-checks = data.at("checks", default: (:)).pairs().filter(p => p.at(1).held)
  #if held-checks.len() > 0 [
    Checked: #for (id, m) in held-checks [#m.title#if m.at("severity", default: "minor") == "major" [ (major)]#if m.at("note", default: "") != "" [: #m.note]; ]
    #linebreak()
  ]
  // A text widget over a boolean, so a boolean field reaches the region table the
  // same way the signature does — through a placement, not through a glyph span.
  // `form-field` keeps `text` and `signature`, so the mark is a character this plate
  // writes; an interactive checkbox is an `acroform` quill's.
  #form-field(
    "DraftWatermark",
    type: "text",
    value: if data.at("draft_watermark", default: false) { "X" } else { "" },
    field: "draft_watermark",
    width: 9pt,
    height: 9pt,
  )
  marked draft
]
#if data.at("colophon", default: "") != "" {
  v(4pt)
  text(font: mono-face, size: 8pt, data.colophon)
}

// ── Appendices ──────────────────────────────────────────────────────────────
// The two-deep shape, after the colophon so the colophon keeps its page: the title's
// second placement is the page-spanning case the geometry suite reads. An entry's
// `label` and `note` are content cells, so each regions at
// `main.appendices[i].entries[j].<cell>` through both loops; `title` and `page` are
// scalars and reach the preview through `main.appendices` alone.
#let appendices = data.at("appendices", default: ())
#if appendices.len() > 0 {
  v(10pt)
  for (i, app) in appendices.enumerate() {
    heading(level: 2, outlined: false)[Appendix #str(i + 1). #app.at("title", default: "")]
    for entry in app.at("entries", default: ()) [
      #entry.at("label", default: "") (p. #str(entry.at("page", default: 0)))#if entry.at("note", default: "") != "" [ — #entry.note]
      #linebreak()
    ]
  }
}
