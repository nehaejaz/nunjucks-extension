# Nunjucks CMS Formatter

Chrome extension that adds a side panel with a formatted Nunjucks code
editor, test-data input, and live rendered output, synced two-way with the
Response Text field on `https://portal.finn.ai/cms`. See [CLAUDE.md](CLAUDE.md)
for the full design.

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts Vite in watch mode and builds into `dist/` with HMR for
the side panel.

## Load into Chrome

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Open `https://portal.finn.ai/cms`, navigate to a Response Text field, then
   click the extension's toolbar icon to open the side panel.

Re-run `npm run dev` (or `npm run build` for a one-off) after changes — the
unpacked extension picks up rebuilt files, though you may need to click the
refresh icon on `chrome://extensions` if content-script changes don't apply
to an already-open tab.

Also note: after loading the extension for the first time, tabs that were
**already open** won't have the content script injected — refresh the CMS
tab once after loading/reloading the extension.

## Why there's a `sandbox.html`

Nunjucks compiles templates to JS via `new Function(...)`, which needs
`'unsafe-eval'`. Manifest V3 extension pages (the side panel included)
default to a CSP that blocks that. The fix is a **sandboxed page**
(`src/sidepanel/sandbox.html` + `sandbox.ts`), which Chrome grants a
separate, more permissive CSP by default specifically for this case. The
side panel (`sandbox-bridge.ts`) `postMessage`s the template + test data to
that hidden iframe; it renders with the real `nunjucks` package and posts
the result back. This only affects the extension — the production Lambda
renders in Node, which has no such restriction.

`npm install` and `npm run build` have been verified to succeed cleanly (no
TS errors, `nunjucks` bundles fine via Vite, `@codemirror/legacy-modes/mode/jinja2`
resolves correctly, sandbox page picked up by crxjs automatically). Verified
against the live CMS: content-script injection and field detection. Not yet
verified:

- **Icons**: no `icons`/`default_icon` are set in `manifest.config.ts` yet
  (kept out to avoid referencing missing files). Chrome will use a generic
  puzzle-piece icon until real icons are added to `public/icons/`.
- **Side panel → page write-back**: the native-setter + dispatch trick in
  `content-script.ts`, and the sandboxed render round-trip end to end.
- **Side panel scoping on SPA navigation**: `chrome.sidePanel.setOptions` in
  the background worker enables the panel only for tabs whose URL starts
  with `https://portal.finn.ai/cms`; confirm this fires correctly when the
  CMS navigates client-side between response entries.
