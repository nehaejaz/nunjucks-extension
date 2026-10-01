import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Atom One Light / One Dark inspired — chosen for proven, high-contrast
// readability rather than invented from scratch.
const lightPalette = {
  bg: '#fafafa',
  gutterBg: '#eeeeee',
  gutterFg: '#9d9d9f',
  fg: '#383a42',
  muted: '#a0a1a7',
  selection: '#e5e5e6',
  activeLine: '#f0f0f1',
  cursor: '#526fff',
  keyword: '#a626a4',
  tagDelim: '#e45649',
  string: '#50a14f',
  number: '#986801',
  variable: '#4078f2',
  operator: '#0184bc',
  blockBg: 'rgba(228, 86, 73, 0.08)',
  blockBorder: 'rgba(228, 86, 73, 0.35)',
}

const darkPalette = {
  bg: '#282c34',
  gutterBg: '#21252b',
  gutterFg: '#5c6370',
  fg: '#abb2bf',
  muted: '#5c6370',
  selection: '#3e4451',
  activeLine: '#2c313c',
  cursor: '#528bff',
  keyword: '#c678dd',
  tagDelim: '#e06c75',
  string: '#98c379',
  number: '#d19a66',
  variable: '#61afef',
  operator: '#56b6c2',
  blockBg: 'rgba(224, 108, 117, 0.14)',
  blockBorder: 'rgba(224, 108, 117, 0.4)',
}

function palette(dark: boolean) {
  return dark ? darkPalette : lightPalette
}

// Background/gutter/selection/cursor chrome for an editor instance, plus
// the CSS for the "block" decoration below. Theme-dependent, so it lives in
// a Compartment the caller reconfigures on toggle.
export function baseEditorTheme(dark: boolean): Extension {
  const p = palette(dark)
  return EditorView.theme(
    {
      '&': {
        backgroundColor: p.bg,
        color: p.fg,
        height: '100%',
      },
      '.cm-content': {
        caretColor: p.cursor,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: p.cursor,
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: p.selection,
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: p.activeLine,
      },
      '.cm-gutters': {
        backgroundColor: p.gutterBg,
        color: p.gutterFg,
        border: 'none',
      },
      // Visually separates each {% %} / {{ }} / {# #} block from the
      // surrounding literal text — see nunjucksBlockHighlighter below.
      '.cm-njk-block': {
        backgroundColor: p.blockBg,
        borderRadius: '3px',
        boxShadow: `0 0 0 1px ${p.blockBorder}`,
      },
    },
    { dark },
  )
}

// Maps the jinja2 legacy-mode's CM5-style token names to real Lezer tags.
// Confirmed against @codemirror/language's built-in legacy-name table
// (node_modules/@codemirror/language/dist/index.js): "tag" -> tags.tagName,
// "variable" -> tags.variableName; the rest match tag names directly.
export function nunjucksHighlightStyle(dark: boolean): HighlightStyle {
  const p = palette(dark)
  return HighlightStyle.define([
    { tag: t.keyword, color: p.keyword, fontWeight: '600' },
    { tag: t.tagName, color: p.tagDelim, fontWeight: '700' },
    { tag: t.string, color: p.string },
    { tag: t.number, color: p.number },
    { tag: t.atom, color: p.number, fontWeight: '600' },
    { tag: t.comment, color: p.muted, fontStyle: 'italic' },
    { tag: t.variableName, color: p.variable },
    { tag: t.operator, color: p.operator },
  ])
}

export function jsonHighlightStyle(dark: boolean): HighlightStyle {
  const p = palette(dark)
  return HighlightStyle.define([
    { tag: t.propertyName, color: p.variable, fontWeight: '600' },
    { tag: t.string, color: p.string },
    { tag: t.number, color: p.number },
    { tag: t.bool, color: p.number, fontWeight: '600' },
    { tag: t.null, color: p.number, fontStyle: 'italic' },
    { tag: t.separator, color: p.operator },
    { tag: [t.squareBracket, t.brace], color: p.muted },
  ])
}

const blockMark = Decoration.mark({ class: 'cm-njk-block' })
const BLOCK_RE = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g

function computeBlockDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  BLOCK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BLOCK_RE.exec(text))) {
    builder.add(match.index, match.index + match[0].length, blockMark)
  }
  return builder.finish()
}

// Wraps each templating block in a background so it reads as a distinct
// unit against the surrounding literal response text. Cosmetic only — a
// naive scan, not aware of e.g. a literal "%}" inside a string — which is
// fine since it doesn't affect rendering, only editor readability.
export const nunjucksBlockHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = computeBlockDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = computeBlockDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
