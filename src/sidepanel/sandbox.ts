import { renderTemplate } from './render'

interface RenderRequest {
  id: number
  template: string
  dataJson: string
}

// Sandbox frames have an opaque ("null") origin, so we can't target the
// parent by origin — '*' is fine here since this frame isn't reachable from
// anything outside our own extension pages.
window.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  const { id, template, dataJson } = event.data
  const result = renderTemplate(template, dataJson)
  ;(event.source as Window)?.postMessage({ id, result }, '*')
})
