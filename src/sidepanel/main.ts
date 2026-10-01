import { EditorView, basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language'
// CodeMirror has no dedicated Nunjucks mode; the CM5-ported jinja2 stream
// mode handles {{ }} / {% %} / {# #} syntax closely enough for highlighting
// purposes (Nunjucks is a Jinja2 dialect).
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2'
import { json } from '@codemirror/lang-json'
import { renderInSandbox } from './sandbox-bridge'
import { generateTestData } from './generate-test-data'
import {
  baseEditorTheme,
  jsonHighlightStyle,
  nunjucksBlockHighlighter,
  nunjucksHighlightStyle,
} from './editor-theme'
import { loadTheme, saveTheme, type ThemePreference } from './theme'
import { SpeechPlayer } from './speech'
import { debounce } from '../shared/messaging'
import type { ExtensionMessage } from '../shared/types'

const statusEl = document.getElementById('status')!
const outputEl = document.getElementById('output')!
const renderErrorEl = document.getElementById('render-error')!
const dataErrorEl = document.getElementById('data-error')!
const generateDataBtn = document.getElementById('btn-generate-data') as HTMLButtonElement
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement
const playOutputBtn = document.getElementById('btn-play-output') as HTMLButtonElement

let boundTabId: number | null = null
let applyingRemoteUpdate = false
// Auto-fill Test Data once, the first time a real template arrives, so the
// box never just sits empty. After that we leave it alone — deleting or
// editing it is a valid choice the user made, not something to auto-correct
// — and rely on the button below to bring the generated skeleton back.
let hasAutoPopulatedData = false

function setStatus(text: string, warn = false): void {
  statusEl.textContent = text
  statusEl.classList.toggle('warn', warn)
}

// Each editor's theme + syntax highlighting live in one Compartment so the
// toggle can reconfigure both together without recreating the EditorView.
const codeAppearance = new Compartment()
const dataAppearance = new Compartment()

function appearanceExtensions(dark: boolean, highlightStyle: ReturnType<typeof nunjucksHighlightStyle>) {
  return [baseEditorTheme(dark), syntaxHighlighting(highlightStyle)]
}

async function init(): Promise<void> {
  let theme: ThemePreference = await loadTheme()
  applyThemeAttribute(theme)

  const codeEditor = new EditorView({
    parent: document.getElementById('editor-code')!,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        StreamLanguage.define(jinja2),
        nunjucksBlockHighlighter,
        codeAppearance.of(appearanceExtensions(theme === 'dark', nunjucksHighlightStyle(theme === 'dark'))),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingRemoteUpdate) {
            onCodeChanged(update.state.doc.toString())
          }
        }),
      ],
    }),
  })

  const dataEditor = new EditorView({
    parent: document.getElementById('editor-data')!,
    state: EditorState.create({
      doc: '{}',
      extensions: [
        basicSetup,
        json(),
        dataAppearance.of(appearanceExtensions(theme === 'dark', jsonHighlightStyle(theme === 'dark'))),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) rerender()
        }),
      ],
    }),
  })

  function applyThemeAttribute(t: ThemePreference): void {
    document.documentElement.dataset.theme = t
    themeToggleBtn.textContent = t === 'dark' ? '☀️ Light' : '🌙 Dark'
  }

  themeToggleBtn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'
    applyThemeAttribute(theme)
    saveTheme(theme).catch(() => {})
    const dark = theme === 'dark'
    codeEditor.dispatch({
      effects: codeAppearance.reconfigure(appearanceExtensions(dark, nunjucksHighlightStyle(dark))),
    })
    dataEditor.dispatch({
      effects: dataAppearance.reconfigure(appearanceExtensions(dark, jsonHighlightStyle(dark))),
    })
  })

  const speechPlayer = new SpeechPlayer((state) => {
    playOutputBtn.textContent = state === 'playing' ? '⏹ Stop' : '▶ Play'
  })

  if (SpeechPlayer.isSupported()) {
    playOutputBtn.addEventListener('click', () => {
      if (speechPlayer.isPlaying) {
        speechPlayer.stop()
      } else {
        speechPlayer.play(outputEl.textContent ?? '')
      }
    })
  } else {
    playOutputBtn.disabled = true
    playOutputBtn.title = "This browser doesn't support speech synthesis."
  }

  let renderToken = 0

  async function rerender(): Promise<void> {
    const template = codeEditor.state.doc.toString()
    const data = dataEditor.state.doc.toString()
    const token = ++renderToken

    const result = await renderInSandbox(template, data)
    if (token !== renderToken) return // a newer render started while this one was in flight

    dataErrorEl.textContent = result.error?.startsWith('Invalid JSON') ? result.error : ''
    renderErrorEl.textContent =
      result.error && !result.error.startsWith('Invalid JSON') ? result.error : ''
    outputEl.textContent = result.output ?? ''
  }

  const sendToContent = debounce((value: string) => {
    if (boundTabId === null) return
    const message: ExtensionMessage = { type: 'template-updated', source: 'sidepanel', value }
    chrome.tabs.sendMessage(boundTabId, message).catch(() => {})
  }, 300)

  function onCodeChanged(value: string): void {
    sendToContent(value)
    rerender()
  }

  function applyGeneratedData(templateSrc: string): void {
    const result = generateTestData(templateSrc)
    if (result.error) {
      dataErrorEl.textContent = result.error
      return
    }
    dataEditor.dispatch({
      changes: {
        from: 0,
        to: dataEditor.state.doc.length,
        insert: JSON.stringify(result.data ?? {}, null, 2),
      },
    })
    rerender()
  }

  function setCodeFromRemote(value: string): void {
    if (value === codeEditor.state.doc.toString()) return
    applyingRemoteUpdate = true
    codeEditor.dispatch({
      changes: { from: 0, to: codeEditor.state.doc.length, insert: value },
    })
    applyingRemoteUpdate = false

    if (!hasAutoPopulatedData) {
      hasAutoPopulatedData = true
      applyGeneratedData(value)
    } else {
      rerender()
    }
  }

  generateDataBtn.addEventListener('click', () => {
    applyGeneratedData(codeEditor.state.doc.toString())
  })

  async function bindToActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    boundTabId = tab?.id ?? null

    if (boundTabId === null) {
      setStatus('No active tab.', true)
      return
    }

    setStatus('Looking for a Response Text field on this tab…')
    const message: ExtensionMessage = { type: 'request-current-value' }
    chrome.tabs.sendMessage(boundTabId, message).catch(() => {
      setStatus('This tab has no Nunjucks CMS Formatter content script loaded. Open a CMS Response Text page.', true)
    })
  }

  chrome.tabs.onActivated.addListener(() => bindToActiveTab())
  chrome.windows.onFocusChanged.addListener(() => bindToActiveTab())

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    if (sender.tab?.id !== boundTabId) return

    if (message.type === 'template-updated' && message.source === 'content') {
      setStatus('Synced with page.')
      setCodeFromRemote(message.value)
    }

    if (message.type === 'field-unavailable') {
      setStatus('No Response Text field found on this page.', true)
    }
  })

  bindToActiveTab()
}

init()
