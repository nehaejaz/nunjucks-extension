import nunjucks from 'nunjucks'

// autoescape: false matches the gva-template-evaluation Lambda's config —
// see CLAUDE.md "Confirmed rendering behavior". No custom filters/extensions
// are registered there, so the stock environment is the accurate match.
const env = new nunjucks.Environment(null, { autoescape: false })

export interface RenderResult {
  output?: string
  error?: string
}

export function renderTemplate(template: string, dataJson: string): RenderResult {
  let data: object = {}
  if (dataJson.trim()) {
    try {
      data = JSON.parse(dataJson)
    } catch (err) {
      return { error: `Invalid JSON: ${(err as Error).message}` }
    }
  }

  try {
    const output = env.renderString(template, data)
    return { output }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
