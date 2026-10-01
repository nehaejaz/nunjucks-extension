import { RESPONSE_TEXTAREA_SELECTOR, debounce } from '../shared/messaging'
import type { ExtensionMessage } from '../shared/types'

// Bypasses React's controlled-input tracking (Carbon/React won't notice a
// plain `.value = ...` assignment). See CLAUDE.md "Confirmed DOM details".
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  'value',
)!.set!

let currentField: HTMLTextAreaElement | null = null
let lastKnownValue = ''
let applyingRemoteUpdate = false

function setFieldValue(field: HTMLTextAreaElement, value: string): void {
  applyingRemoteUpdate = true
  nativeValueSetter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  applyingRemoteUpdate = false
}

function sendUpdate(value: string): void {
  lastKnownValue = value
  const message: ExtensionMessage = { type: 'template-updated', source: 'content', value }
  chrome.runtime.sendMessage(message).catch(() => {
    // No side panel open yet; that's fine, it will ask for the current
    // value via 'request-current-value' once it opens.
  })
}

const sendUpdateDebounced = debounce(sendUpdate, 300)

function handleInput(event: Event): void {
  if (applyingRemoteUpdate) return
  const field = event.target as HTMLTextAreaElement
  sendUpdateDebounced(field.value)
}

function attachToField(field: HTMLTextAreaElement): void {
  if (currentField === field) return
  if (currentField) currentField.removeEventListener('input', handleInput)
  currentField = field
  lastKnownValue = field.value
  field.addEventListener('input', handleInput)
  sendUpdate(field.value)
}

function detachField(): void {
  if (!currentField) return
  currentField.removeEventListener('input', handleInput)
  currentField = null
  const message: ExtensionMessage = { type: 'field-unavailable' }
  chrome.runtime.sendMessage(message).catch(() => {})
}

function scanForField(): void {
  const field = document.querySelector<HTMLTextAreaElement>(RESPONSE_TEXTAREA_SELECTOR)
  if (field) attachToField(field)
  else detachField()
}

// The CMS is a React SPA (Carbon Design System) — the field can mount,
// unmount, and remount as the editor navigates between response entries
// without a full page load, so watch for it rather than querying once.
const observer = new MutationObserver(() => scanForField())
observer.observe(document.body, { childList: true, subtree: true })
scanForField()

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'template-updated' && message.source === 'sidepanel') {
    if (!currentField) return
    if (message.value === lastKnownValue) return
    lastKnownValue = message.value
    setFieldValue(currentField, message.value)
  }
  if (message.type === 'request-current-value' && currentField) {
    sendUpdate(currentField.value)
  }
})
