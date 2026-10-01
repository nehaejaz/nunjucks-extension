# Nunjucks CMS Formatter — Chrome Extension

## Problem

Glia's GVA CMS (`https://portal.finn.ai/cms`) lets editors write Nunjucks response
templates in a plain, unformatted textarea (see screenshot in project history —
the "Response Text" field on a User Goal Response, e.g. `summitcu-voice /
summitcu-voice-banking-voice-en / en-US`). The box has no syntax highlighting,
no formatting, no way to render the template against sample data, and no way to
see output before publishing. Templates are dense (nested `{% if %}`, `{% for
%}`, filters, SSML tags like `<say-as interpret-as="currency">`), so this is
error-prone and slow to review.

## Goal

A Chrome extension that, on the CMS response-editing page, opens Chrome's
native **Side Panel** with three synced panes:

1. **Code Editor** — the Nunjucks template, pretty-formatted and syntax
   highlighted. Two-way synced with the site's own textarea: typing in either
   place updates the other (debounced, loop-safe).
2. **Test Data** — a JSON input representing the template's render context
   (e.g. `pagination`, `items`, `transaction.*` fields from the screenshot).
3. **Output** — live-rendered result of the template + test data, using the
   *actual* rendering behavior of production (see below), so what you see
   here is what the voice/chat channel would actually say.

## Confirmed rendering behavior (from gva-template-evaluation Lambda)

- Renderer: `nunjucks@^3.2.4`, configured with `nunjucks.configure({ autoescape: false })`.
- Call: `nunjucks.renderString(expression, data)`.
- **No** `addFilter` / `addExtension` calls anywhere in that Lambda — only
  Nunjucks' built-in filters (e.g. `replace`, `upper`) and built-in support for
  regex literals (`r/pattern/flags`) as filter arguments, e.g.
  `{{ transaction.description | replace(r/(\d+)/g, '...') }}`.
- Any template containing a `{% %}` block or a `|` filter pipe is routed to
  this Lambda (gva-core's `responseResolution.ts`); there is no second/richer
  renderer.
- **Implication**: bundle the real `nunjucks` npm package in the extension and
  call `renderString()` directly. This should match production output
  closely. Verify the regex-literal + `replace` combination empirically once
  the Output panel is working — it was confirmed by reading source, not by
  executing a template.
- SSML tags (`<say-as>`, `<break time="300ms"/>`) are just literal output
  strings from Nunjucks' point of view — render them as plain text in the
  Output panel. No audio synthesis is in scope.

## Architecture decisions (confirmed)

| Decision | Choice | Why |
|---|---|---|
| Panel UI | Chrome **Side Panel API** (`chrome.sidePanel`) | Native docking, persists per-window, no risk of colliding with page CSS/layout. |
| Editor | **CodeMirror 6** | Lightweight (~200–300KB) vs Monaco. No official Nunjucks language package exists — use a hand-rolled `StreamLanguage` (Jinja2/Twig-like syntax is close enough to bootstrap from) or `@codemirror/lang-html` as a base since templates are HTML/SSML-ish with `{% %}`/`{{ }}` interpolations. |
| Renderer | Real `nunjucks` npm package, browser build, `renderString()` only | Matches production exactly (see above). No filesystem/loader needed — string-only rendering. |
| Manifest | **Manifest V3** | Required for new Chrome extensions. |
| Build tooling | Vite + `@crxjs/vite-plugin` | Standard, supports MV3 + HMR for the side panel UI during dev. |
| Language | TypeScript | — |
| UI framework | Plain TypeScript + CodeMirror, no framework initially | Keep bundle small; revisit (Preact) only if the 3-pane UI gets complex enough to need it. |
| DOM targeting scope | **Specific to the "Response Text" field** on this CMS page, not generic | Faster to build reliably; generalize later once working. |

## Sync design

- **Content script** (`portal.finn.ai/cms/*`) finds the Response Text field,
  attaches an `input`/`change` listener, and observes it (MutationObserver
  covers cases where the site's own JS framework rewrites the value, e.g.
  React re-render).
- **Side panel** and **content script** communicate over a `chrome.runtime`
  long-lived **Port**, keyed by `tabId`, so the panel only syncs with the
  active/relevant tab.
- Both sides tag outgoing updates with a source id and debounce
  (~300–500ms after typing stops) before pushing, and **ignore an incoming
  update that echoes their own last-sent value** to prevent feedback loops.
- Output panel re-renders (debounced) whenever Code Editor or Test Data
  changes.
- Test Data box: raw JSON text; invalid JSON shows an inline parse error
  instead of attempting a render.

## Proposed structure

```
nunjucks-cms-formatter/
├── CLAUDE.md
├── package.json
├── vite.config.ts
├── src/
│   ├── background/
│   │   └── service-worker.ts      # opens/manages side panel per tab
│   ├── content/
│   │   └── content-script.ts      # finds field, syncs via Port
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── panels/
│   │   │   ├── code-editor.ts
│   │   │   ├── test-data.ts
│   │   │   └── output.ts
│   │   └── render.ts               # nunjucks.renderString wrapper
│   └── shared/
│       ├── messaging.ts            # Port helpers, message types
│       └── types.ts
└── public/
    └── icons/
```

## Confirmed DOM details (Response Text field)

```html
<textarea
  placeholder="Enter the message the bot should respond with..."
  class="bx--text-area"
  aria-invalid="false"
  rows="4"
  style="width: 100%; height: 502px;"
>...template text, literal &lt;break time="300ms"/&gt; etc. once decoded...</textarea>
```

- **Element**: plain `<textarea>`, no wrapping rich-text/contenteditable component.
- **Selector**: `textarea.bx--text-area[placeholder="Enter the message the bot should respond with..."]`.
  `bx--text-area` is a generic Carbon Design System class (likely reused by
  other fields on the page/CMS), so the placeholder text is what makes this
  selector specific to Response Text. No id/data-attribute is present.
- **Framework**: `bx--*` classes are IBM **Carbon Design System**, almost
  certainly React underneath. Setting `textarea.value = newValue` directly
  from the content script will **not** register with React's internal state
  (classic controlled-input gotcha) — the UI will look updated but the
  framework's model won't know, and it may get stomped on the next re-render.
  Write-back must use the native setter + dispatch pattern:

  ```ts
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )!.set!;
  setter.call(textarea, newValue);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  ```

- **Content script robustness**: don't cache the textarea reference long-term
  — re-query on each sync tick (or keep the MutationObserver watching the
  containing panel) in case the SPA unmounts/remounts the field on
  navigation within the CMS.

## Open items — need input from the user

None blocking for initial implementation. If we hit a case where the
placeholder text differs (e.g. localized CMS UI) or multiple
`bx--text-area` fields appear on the same page, we'll need a more specific
selector at that point.

## Test data generation

The Test Data pane auto-populates from the current template the first time
a real template arrives in the panel, and offers a "↻ Generate from
template" button to reset back to it at any point — editing or clearing the
box afterward is left alone (not auto-corrected), since that's a valid user
choice; the button is the deliberate way to bring the generated skeleton
back. Implementation: `src/sidepanel/generate-test-data.ts` walks the real
Nunjucks AST (`nunjucks.parser.parse()` — pure parsing, no eval involved, so
this runs directly in the side panel rather than needing the sandbox) to
find every field path actually referenced (including dotted/`for`-loop
paths, e.g. `{% for transaction in items %}{{ transaction.description }}`
correctly becomes `items: [{ description: ... }]`), and fills each with a
type-guessed placeholder based on the field name — except where the
template does `field == 'SOME_LITERAL'`, in which case that literal is used
directly so the default preview exercises a real branch (e.g.
`transaction.type == 'CREDIT'` seeds `type: "CREDIT"`). Node shapes were
confirmed against the installed `nunjucks@3.2.4` source, not guessed.

Placeholder typing is name-heuristic-based (`guessPlaceholder` in
`generate-test-data.ts`) and was corrected against real GVA account data:
money fields (`amount`, `balance`, `credit`, `debit`, `price`, `payment`)
are formatted **strings** like `"1,234.56"`, not numbers — production sends
these pre-formatted from the backend (confirmed against
`fromAccount.display.currentBalance`/`.availableCredit[].amount`, both
strings like `"15,000.00"`). Identifier-shaped `...Number` fields
(`accountNumber`, `cardNumber`, `routingNumber`, etc.) are also strings, and
are checked before the generic count/index bucket so they don't fall into
it on the "number" substring alone. True counts (`totalNumberOfItems`,
`transactionStart`/`End`, `index`, `qty`) stay real numbers since templates
do arithmetic/comparison on them directly.

## Theme (light/dark)

A toggle in the status bar (`src/sidepanel/theme.ts`) persists the choice to
`chrome.storage.local` (hence the `storage` permission) — the panel defaults
to the OS's `prefers-color-scheme` only the very first time it's ever
opened, then the explicit choice always wins on every reopen, it does not
keep following OS changes. Panel chrome (backgrounds, panes, buttons, error
boxes) is themed via CSS custom properties on `<html data-theme="...">` in
`style.css`. Both CodeMirror instances are themed via a per-editor
`Compartment` (`src/sidepanel/main.ts`) holding `baseEditorTheme(dark)` +
`syntaxHighlighting(...)` together, reconfigured on toggle without
recreating the `EditorView`.

Syntax colors (`src/sidepanel/editor-theme.ts`) use an Atom One
Light/Dark-inspired palette for contrast. For the Code Editor, the jinja2
legacy mode's CM5-style token names were mapped to real Lezer tags by
reading `@codemirror/language`'s built-in legacy-name table directly (not
guessed): `"tag"` (the `{%`/`%}`/`{{`/`}}` delimiters) → `tags.tagName`,
`"variable"` → `tags.variableName`; the rest match tag names 1:1. A
`ViewPlugin` (`nunjucksBlockHighlighter`) additionally wraps each
`{% %}`/`{{ }}`/`{# #}` span in a background-highlighted `.cm-njk-block`
decoration so templating blocks read as visually distinct units from the
surrounding literal response text — this is a plain regex scan over the
whole doc (fine at CMS response-template sizes), not doc-structure-aware, so
it's cosmetic only and doesn't affect rendering. The Test Data (JSON) editor
gets a matching palette via `@lezer/json`'s own tag mapping
(`propertyName`/`string`/`number`/`bool`/`null`/`separator`/brackets),
confirmed from `node_modules/@lezer/json/src/highlight.js`.

## Output playback

A "▶ Play" button on the Output pane (`src/sidepanel/speech.ts`) reads the
rendered text aloud using the browser's built-in Web Speech API
(`speechSynthesis`) — chosen over Amazon Polly to avoid needing AWS
credentials stored in the extension with no backend to hold them elsewhere,
plus per-request AWS cost. **This is a readability check, not a
production-accurate SSML rendering** — browsers have no real SSML support:
`<break time="Xms"/>` is approximated as an actual pause between separately
spoken chunks (splits the text, chains `SpeechSynthesisUtterance` calls with
a `setTimeout` between them), `<say-as interpret-as="digits">` is spaced out
character-by-character so it's read digit-by-digit rather than as one
number, `<say-as interpret-as="currency">` gets a `$` prefix, and any other
tag is stripped. Verified against the real rendered transaction-history
output — segments/pauses/digit-spacing all came out as expected.

Amazon Polly (true SSML, closer to what production likely sounds like) was
explicitly deferred — revisit only if the user decides how to handle AWS
credentials (raw IAM key stored client-side vs. a Cognito identity pool for
temporary credentials vs. a small proxy backend), since a browser extension
with no backend can't hold long-lived secrets safely.

## Non-goals (for now)

- Generic support for arbitrary fields/pages on the CMS (only Response Text).
- Audio/SSML synthesis — Output panel shows rendered text only.
- Custom Nunjucks filters/extensions beyond what ships in `nunjucks@3.2.4`,
  unless real templates surface a gap.
