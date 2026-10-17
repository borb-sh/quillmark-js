#import "@local/quillmark-helper:0.2.0" as qm

#set page(paper: "us-letter", margin: 1in)
#set text(size: 11pt)
#set par(justify: true)

// Compute with `qm.data.x`, and on a text value, which is content, through
// `qm.str(qm.data.x)`. Print with `qm.ink(..)`, which keeps the printed text
// click-to-edit in a live preview.
#text(size: 16pt, weight: "bold", qm.ink(qm.data, "sender"))
#line(length: 100%, stroke: 0.5pt)

#align(right, qm.ink(qm.data, "date", "[month repr:long] [day padding:none], [year]"))

// A text value prints with a space on each side; `flush` drops them, so
// punctuation after it sits flush.
#let flush(c) = {
  if type(c) != content or not c.has("children") { return c }
  let kids = c.children
  while kids.len() > 0 and kids.first() == [ ] { kids = kids.slice(1) }
  while kids.len() > 0 and kids.last() == [ ] { kids = kids.slice(0, -1) }
  kids.sum(default: [])
}

// A text field left unanswered is `""`: guard its value.
#if qm.data.recipient != "" [Dear #flush(qm.ink(qm.data, "recipient")),]

#if qm.data.subject != "" [*Re: #qm.ink(qm.data, "subject")*]

#qm.data.at("$body", default: "")

// An enum stores an id; the words it prints are the plate's. The words are
// drawn here rather than by the field, so `qm.region` claims them for it.
#let closing-text = (sincerely: "Sincerely", regards: "Kind regards", thanks: "With thanks")
#if qm.data.closing != "" {
  qm.region("closing")[#closing-text.at(qm.data.closing),]
}

#v(2em)
#qm.ink(qm.data, "sender")

#for card in qm.data.at("$cards", default: ()) {
  let body = card.at("$body", default: "")
  if card.at("$kind", default: none) == "postscript" and body != "" [P.S. #body]
}
