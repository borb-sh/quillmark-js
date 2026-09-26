~~~
$quill: showcase@1.0.0
$kind: main
title: The Showcase Quill
subtitle: A reference document
authors:
  - Ada Lovelace
  - Grace Hopper
signature_block:
  - A. LOVELACE
  - Author
contributors:
  - name: Ada Lovelace
    role: author
    since: "2025-11-03"
    lead: true
  - name: Grace Hopper
    role: reviewer
abstract: "A block richtext leaf: it holds paragraphs, so it never shares a row however compact it asks to be."
keywords:
  - "*Schema* shapes"
  - "**Regions** and geometry"
errata:
  - Fig. 2 is mislabelled — the **asterisks** here are the text, not emphasis.
  - Page 4 gives the wrong year.
appendices:
  - title: Sources
    entries:
      - label: Primary
        page: 12
        note: Where the *claims* come from.
      - label: Secondary
        page: 14
  - title: Glossary
    entries:
      - label: Terms
        page: 20
status: draft
revisions:
  - note: Fig. 2 relabelled
    pages: 1
    detail: The caption named the wrong figure.
~~~

The body is a full block leaf: paragraphs, emphasis, and the containers the codec round-trips.

- A bullet, to place a list container.

- A second one, so the list has a sibling to nest against.

A closing paragraph, far enough down the page that the body's boxes are two disjoint segments rather than one run.

~~~
$kind: section
heading: Findings
lead: What the section *found*, in one line.
~~~

Section bodies are leaves of their own, addressed per card.

~~~
$kind: note
~~~

~~~
$kind: signoff
signature_block:
  - G. HOPPER
  - Reviewer
~~~

~~~
$kind: figure
placement:
  value: float
caption: A figure's *caption*.
~~~

The figure's own note, which stands in for the figure.
