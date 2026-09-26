~~~
$quill: usaf_memo@0.0.0
$kind: main
memo_for:
  - ORG1/SYMBOL
  - ORG2/SYMBOL
memo_from:
  - ORG/SYMBOL
  - Organization Name
  - 123 Street Ave
  - City ST 12345-6789
subject: Subject of the Memorandum
authority_line: FOR THE COMMANDER
signature_block:
  - FIRST M. LAST, Rank, USAF
  - Duty Title
letterhead_title:
  - DEPARTMENT OF THE AIR FORCE
  - HEADQUARTERS [UNIT NAME]
references:
  - AFMAN 33-326, 25 November 2011, *Preparing Official Communications*
  - AFI 33-360, *Publications and Forms Management*
cc:
  - Rank and Name, ORG/SYMBOL
distribution:
  - ORG1/SYMBOL
  - ORG2/SYMBOL
attachments:
  - Attachment description, YYYY MMM DD
~~~

The first paragraph. Top-level paragraphs are auto-numbered; do not add manual numbering.

- Nested bullets are automatically lettered.

Lines that take no number, letter, or bullet — a roster of names, an address — go in a block quote, typeset as written. End a line with a backslash to break it.

> FIRST M. LAST, Maj, USAF\
> SECOND N. LAST, Capt, USAF

~~~
$kind: indorsement
from: ORG/SYMBOL
for: ORG/SYMBOL
signature_block:
  - FIRST M. LAST, Rank, USAF
  - Duty Title
~~~
