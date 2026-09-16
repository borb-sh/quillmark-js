#import "@local/quillmark-helper:0.1.0": (
  data, display, field-region, form-field, signature-field,
)
#import "@local/tonguetoquill-usaf-memo:5.0.0": (
  backmatter, date-pattern, frontmatter, indorsement, mainmatter,
)

// A memo has no "no style" state, so the blank takes the package's default.
// Resolved once here: `frontmatter` and the date's pattern must agree.
#let memo_style = if data.memo_style != "" { data.memo_style } else { "usaf" }

// The letterhead arrives as one ordered array of lines. Element 0 is the title,
// set larger; the rest are caption lines beneath it. A single element renders
// the title alone — the package skips a falsey caption. An empty array renders
// no letterhead text at all, silently: the block is `place`d, so an empty title
// leaves no glyphs and takes no space from the flow, and the seal stands alone.
#let letterhead_lines = data.letterhead_title

// Body text size, in points. Also the height of one line of the indorsement
// header, which is what an omitted indorsement date reserves for its fill-in
// widget (`date-placeholder-slot`, whose slot is `1em` tall and 1in wide).
#let body_font_size = data.font_size * 1pt

#show: frontmatter.with(
  letterhead-title: letterhead_lines.at(0, default: ""),
  letterhead-caption: if letterhead_lines.len() > 1 { letterhead_lines.slice(1) } else { () },
  letterhead-seal-subtitle: data.letterhead_seal_subtitle,
  // A memo has no seal-less state, so the blank takes the default, DoW.
  letterhead-seal: image(
    if data.letterhead_seal == "dod" {
      "assets/dod_seal.png"
    } else {
      "assets/dow_seal.png"
    }
  ),

  // Date. `data.date` is the native `datetime` and would render identically,
  // but its ink would be born inside the package and carry no schema address.
  // `display` places the field's *content* projection instead: the glyphs are
  // born in the generated helper, so the memo date stays click-to-edit however
  // deep the package formats it.
  //
  // A blank date means today's, and the plate stamps it rather than falling
  // through to `frontmatter`'s own `datetime.today()`: package-born ink carries
  // no address, so the one date a memo never types would be the one date a
  // preview cannot click. `field-region` claims that ink for the field instead.
  //
  // The stamp is markup, not the bare `str` `.display()` returns: a `str` off a
  // function call carries no source position, and ink with none is unclaimable.
  date: {
    let pattern = date-pattern(memo-style: memo_style)
    let authored = display("date", pattern)
    if authored != none {
      authored
    } else {
      field-region("date", [#datetime.today().display(pattern)])
    }
  },

  memo-for: data.memo_for,

  // A memo with no FROM line is a Memorandum for Record.
  ..if data.memo_from.len() > 0 { (memo-from: data.memo_from) },

  subject: data.subject,

  ..if data.references.len() > 0 { (references: data.references) },

  // The tag line is set in Cinzel, which ships one regular face: `emph` resolves
  // to it and reads as nothing. The slant is synthesized here rather than in the
  // package, whose `src/` is upstream's verbatim. `box` keeps the run inline.
  footer-tag-line: {
    show emph: it => box(skew(ax: -12deg, reflow: false, it.body))
    data.tag_line
  },

  // The blank reads as no banner, which is what the package's own
  // `classification-level: none` default means.
  classification-level: data.classification.value,

  dissemination: data.dissemination,

  // CUI designation indicator block fields (DoDM 5200.48). `classification`
  // declares a `CUI` variant, so these four exist only where the discriminant
  // reads CUI, and the branch is what makes reading them total: inside it every
  // declared field of that world is present, outside it none is. The package's
  // own `cui_*: none` defaults cover the worlds that omit them.
  ..if data.classification.value == "CUI" {
    (
      cui-controlled-by: data.classification.controlled_by,
      cui-category: data.classification.category,
      cui-limited-dissemination: data.classification.limited_dissemination,
      cui-poc: data.classification.poc,
    )
  },

  memo-style: memo_style,

  font-size: body_font_size,

  // One recipient per line; the package's own default is three columns.
  memo-for-cols: 1,
)

// The body's region needs no recovery step here: the package's render-body
// rebuilds paragraphs through a state buffer (AFH 33-337 auto-numbering), but
// the rebuilt glyphs keep their spans, which is what the backend reads regions
// from.
#mainmatter[
  #data.at("$body")
]

#backmatter(
  authority-line: data.authority_line,
  signature-block: data.signature_block,
  // The widget sits at the bottom of AFH 33-337's four blank lines and is
  // sized to two and a half of them, so the line and a half above it stays
  // clear of the body text without moving the block off the fifth line.
  signing-field: signature-field(
    "Signature",
    field: "signature_block",
    height: body_font_size * 2.5,
  ),

  ..if data.cc.len() > 0 { (cc: data.cc) },

  ..if data.distribution.len() > 0 { (distribution: data.distribution) },

  ..if data.attachments.len() > 0 { (attachments: data.attachments) },
)

// The action line's wording follows the indorsement's place in the chain, not
// an endorser's choice: the last indorsement is the approval authority and
// reads Approve / Disapprove, every one before it is a coordinating official
// and reads Concur / Nonconcur. Only this loop can see whether an indorsement
// is the last one, so the position is resolved here and passed down. Cards of
// other kinds may interleave, so the last indorsement is the last card *of
// this kind*, not the last card. `-1` never matches a real index, which is the
// wanted result when there are no indorsements at all.
// Parenthesized so the method chain can span lines: in markup, a `#let` whose
// expression ends at a line break stops there, and the next line's leading
// `.at(…)` would be read as text.
#let last_indorsement_index = (
  data
    .at("$cards")
    .enumerate()
    .filter(entry => entry.at(1).at("$kind", default: none) == "indorsement")
    .map(entry => entry.at(0))
    .at(-1, default: -1)
)

#for (i, card) in data.at("$cards").enumerate() {
  if card.at("$kind", default: none) == "indorsement" {
    // The quillmark helper leaves an unset/whitespace-only markdown body as
    // the empty string `""`; only non-empty bodies are eval'd into content.
    // Pass truly empty content (`[]`) in the empty case so indorsement can
    // collapse the body's surrounding spacing.
    let body = card.at("$body", default: "")
    let body_content = if type(body) == str { [] } else { body }
    // Per AFH 33-337 Ch. 14, an indorsement is dated when the endorser signs
    // it (distinct from the originating memo's date). The signing date is
    // generally unknown at compile time, so a blank or omitted date leaves the
    // date slot fillable rather than stamping the compile date into it.
    // `display` takes an address, so a per-card call yields a per-card region
    // even though every iteration shares one `card` loop variable, and it
    // returns `none` for a blank date — the fill-in case below.
    let resolved_date = display(
      card.at("$path") + "date",
      date-pattern(memo-style: memo_style),
    )
    // The card's `$path` prefix composes its canonical schema addresses
    // (`$cards.indorsement.<n>.…`, per-kind ordinal) — the absolute loop
    // index `i` is NOT that ordinal once kinds interleave, so it stays a
    // widget-name suffix only. The card body's region rides its own glyph
    // spans through the package rebuild, per-card because each card's body
    // has its own backend-generated eval site.
    indorsement(
      from: card.at("from", default: ""),
      to: card.at("for", default: ""),
      authority-line: card.authority_line,
      signature-block: card.signature_block,
      signing-field: signature-field(
        "Ind_" + str(i) + "_Signature",
        field: card.at("$path") + "signature_block",
        height: body_font_size * 2.5,
      ),
      ..if card.format != "" { (format: card.format) },
      date: resolved_date,
      // An omitted date becomes an empty AcroForm text box the endorser types
      // the signing date into, sized to the slot the package reserves for it.
      // Built only when there is no date to print: a widget over a printed date
      // would offer an edit that the rendered document does not carry back.
      ..if resolved_date == none {
        (date-field: form-field(
          "Ind_" + str(i) + "_Date",
          type: "text",
          width: 1in,
          height: body_font_size,
          field: card.at("$path") + "date",
        ))
      },
      ..if card.action != "" { (action: card.action) },
      approval-authority: i == last_indorsement_index,
      body_content,
    )
  }
}
