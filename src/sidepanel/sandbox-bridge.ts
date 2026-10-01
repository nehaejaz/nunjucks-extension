import type { RenderResult } from './render'

interface RenderResponse {
  id: number
  result: RenderResult
}

let iframe: HTMLIFrameElement | null = null
let readyPromise: Promise<void> | null = null
let nextId = 0
const pending = new Map<number, (result: RenderResult) => void>()

function ensureSandbox(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.src = chrome.runtime.getURL('src/sidepanel/sandbox.html')
    frame.style.display = 'none'
    frame.addEventListener('load', () => resolve(), { once: true })
    document.body.appendChild(frame)
    iframe = frame
  })
  return readyPromise
}

window.addEventListener('message', (event: MessageEvent<RenderResponse>) => {
  if (!iframe || event.source !== iframe.contentWindow) return
  const { id, result } = event.data
  const resolve = pending.get(id)
  if (!resolve) return
  pending.delete(id)
  resolve(result)
})

export async function renderInSandbox(template: string, dataJson: string): Promise<RenderResult> {
  await ensureSandbox()
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    iframe!.contentWindow!.postMessage({ id, template, dataJson }, '*')
  })
}
