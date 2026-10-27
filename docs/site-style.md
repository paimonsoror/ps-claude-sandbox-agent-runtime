# Site voice and design rules

The GitHub Pages site (`site/`) is read by people who run the homelab, by engineers who may
port it, and by people who have never heard of a sandbox runtime. Every page follows these
rules.

## Voice

- Write as **we** (the people who built this) and speak to **you** (the reader). Never "the
  owner" or "the operator".
- Plain, direct, conversational. Short sentences, active verbs. Say what a thing does before
  naming the technology that does it: "a network fence (a Cilium policy)", not the reverse.
- Explain every technical term the first time a page uses it, or link it to the glossary on the
  overview page.
- Be honest about gaps. "We have not built this yet, and here is what it takes" beats a
  hedge.
- No em-dashes, no "not X but Y" framing, no stock phrases.

## Structure

- Every page opens with a short **In plain terms** box: what the page covers, why it matters,
  who it is for.
- Plain explanation first, technical detail second (in a card, a table, or an expander).
- Commands and real output stay exactly as they ran.

## Diagrams

- Use the Flow engine in `assets/site.js`. Diagrams sit full width, never in a half column.
- Boxes size themselves to their text. Keep labels to two or three words; put the detail in
  the sub-label or the caption.
- Lanes are at least 220 units apart in a 1100-wide viewBox.
- Captions are full sentences in plain language and appear below the drawing.
- Each step holds long enough to read (the engine adds reading time to every step).
