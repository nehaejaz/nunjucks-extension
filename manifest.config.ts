import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Nunjucks CMS Formatter',
  description:
    'Format, test-render, and sync Nunjucks templates on the GVA CMS response editor.',
  version: pkg.version,
  action: {
    default_title: 'Nunjucks CMS Formatter',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://portal.finn.ai/cms*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  // Sandbox pages get a CSP that permits 'unsafe-eval' by default — needed
  // because nunjucks compiles templates via `new Function`, which the side
  // panel's own (stricter) extension-page CSP blocks. See render flow in
  // src/sidepanel/sandbox.ts and sandbox-bridge.ts.
  sandbox: {
    pages: ['src/sidepanel/sandbox.html'],
  },
  permissions: ['sidePanel', 'tabs', 'storage'],
  host_permissions: ['https://portal.finn.ai/*'],
})
