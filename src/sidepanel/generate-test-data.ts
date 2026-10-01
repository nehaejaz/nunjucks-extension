import nunjucksDefault from 'nunjucks'

// nunjucks exposes its parser/AST node classes for advanced use (custom
// extensions, tooling), but @types/nunjucks doesn't type them — see
// node_modules/@types/nunjucks/index.d.ts. Node shapes below were confirmed
// against the installed nunjucks@3.2.4 source (src/nodes.js, src/parser.js),
// not guessed from docs.
interface AstNode {
  typename: string
  children?: AstNode[]
  value?: unknown
  target?: AstNode
  val?: AstNode
  cond?: AstNode
  body?: AstNode
  else_?: AstNode
  arr?: AstNode
  name?: AstNode
  args?: { children?: AstNode[] }
  expr?: AstNode
  ops?: Array<{ type: string; expr?: AstNode }>
  left?: AstNode
  right?: AstNode
  targets?: AstNode[] | { children?: AstNode[] }
}

interface NunjucksInternal {
  parser: { parse(src: string): AstNode }
}

const nunjucksInternal = nunjucksDefault as unknown as NunjucksInternal

// Wraps one slot in the schema tree being built (an object property or an
// array's single example element) so resolveRef/visit can read/upgrade it
// without needing to know whether it's still a fresh placeholder.
class TreeRef {
  constructor(
    private container: Record<string, unknown> | unknown[],
    private key: string | number,
  ) {}

  get value(): unknown {
    return (this.container as Record<string, unknown>)[this.key as string]
  }

  set value(v: unknown) {
    ;(this.container as Record<string, unknown>)[this.key as string] = v
  }

  getOrCreateProp(name: string): TreeRef {
    let cur = this.value
    if (cur === undefined || cur === null || typeof cur !== 'object' || Array.isArray(cur)) {
      cur = {}
      this.value = cur
    }
    const obj = cur as Record<string, unknown>
    if (!(name in obj)) {
      obj[name] = guessPlaceholder(name)
    }
    return new TreeRef(obj, name)
  }

  getOrCreateArrayElement(): TreeRef {
    let cur = this.value
    if (!Array.isArray(cur)) {
      cur = []
      this.value = cur
    }
    const arr = cur as unknown[]
    if (arr.length === 0) {
      arr.push({})
    }
    return new TreeRef(arr, 0)
  }
}

// Scope chain for loop/set variable bindings. A bound value of `null` means
// "this name is locally computed, not external input" (e.g. a `{% set %}`
// target with no traceable source, or an `{% for k, v in ... %}` key) — such
// names are resolved but never turned into schema fields.
class Ctx {
  private bindings = new Map<string, TreeRef | null>()
  constructor(
    private rootRef: TreeRef,
    private parent?: Ctx,
  ) {}

  child(): Ctx {
    return new Ctx(this.rootRef, this)
  }

  bind(name: string, ref: TreeRef | null): void {
    this.bindings.set(name, ref)
  }

  resolveSymbol(name: string): TreeRef | null {
    let ctx: Ctx | undefined = this
    while (ctx) {
      if (ctx.bindings.has(name)) return ctx.bindings.get(name) ?? null
      ctx = ctx.parent
    }
    return this.rootRef.getOrCreateProp(name)
  }
}

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
}

function guessPlaceholder(name: string): unknown {
  const lower = name.toLowerCase()
  if (/^is[A-Z_]|^has[A-Z_]/.test(name) || /enabled|active|visible|valid/.test(lower)) {
    return true
  }
  if (/date|time|posted|created|updated/.test(lower)) {
    return '2026-01-01'
  }
  if (/(^|[a-z])id$/.test(lower)) {
    return 'sample-id'
  }
  // Identifier-shaped "...Number" fields (account/card/routing/phone number)
  // are long display strings in real GVA data, not counts — check before
  // the generic count bucket below, which would otherwise catch them on
  // the "number" substring alone.
  if (/(account|card|routing|phone|reference|confirmation|tracking|member|policy)number$/.test(lower)) {
    return '1234567890123456'
  }
  // Money fields arrive already formatted (e.g. "15,000.00") from the
  // backend, not as raw numbers — confirmed against real GVA account data
  // (fromAccount.display.currentBalance, .availableCredit[].amount, etc.
  // are all strings, not numbers).
  if (/amount|price|balance|credit|debit|payment/.test(lower)) {
    return '1,234.56'
  }
  if (/total|count|number|index|start|end|qty|quantity/.test(lower)) {
    return 1
  }
  return `sample ${humanize(name)}`
}

// Resolves an *expression* node to the schema slot it refers to (or null for
// compound/boolean/dynamic expressions that don't map to a single field).
// Always recurses into sub-expressions so nested field references still get
// registered even when the outer node itself has no single ref.
function resolveRef(node: AstNode | null | undefined, ctx: Ctx): TreeRef | null {
  if (!node) return null

  switch (node.typename) {
    case 'Symbol':
      return ctx.resolveSymbol(node.value as string)

    case 'LookupVal': {
      const targetRef = resolveRef(node.target, ctx)
      const valNode = node.val
      if (valNode?.typename === 'Literal' && typeof valNode.value === 'string') {
        return targetRef ? targetRef.getOrCreateProp(valNode.value) : null
      }
      if (valNode?.typename === 'Literal' && typeof valNode.value === 'number') {
        return targetRef ? targetRef.getOrCreateArrayElement() : null
      }
      resolveRef(valNode, ctx) // dynamic index (e.g. arr[i]) — can't name it, but still walk it
      return null
    }

    case 'Filter': {
      // args.children[0] is the piped-in target; the rest are the filter's
      // own arguments (regex/replacement strings etc.), not data fields.
      const args = node.args?.children ?? []
      const targetRef = args.length ? resolveRef(args[0], ctx) : null
      for (let i = 1; i < args.length; i++) resolveRef(args[i], ctx)
      return targetRef
    }

    case 'FunCall': {
      const args = node.args?.children ?? []
      args.forEach((a) => resolveRef(a, ctx))
      return null
    }

    case 'Compare': {
      const leftRef = resolveRef(node.expr, ctx)
      node.ops?.forEach((op) => {
        resolveRef(op.expr, ctx)
        // `transaction.type == 'DEBIT'` — use the compared literal as the
        // sample value so the default preview exercises a real branch.
        if (leftRef && (op.type === '==' || op.type === '===') && op.expr?.typename === 'Literal') {
          leftRef.value = op.expr.value
        }
      })
      return null
    }

    case 'Is':
      // `x is defined` — right side is a test name, not a data field.
      resolveRef(node.left, ctx)
      return null

    case 'And':
    case 'Or':
    case 'In':
    case 'Add':
    case 'Concat':
    case 'Sub':
    case 'Mul':
    case 'Div':
    case 'FloorDiv':
    case 'Mod':
    case 'Pow':
      resolveRef(node.left, ctx)
      resolveRef(node.right, ctx)
      return null

    case 'Not':
    case 'Neg':
    case 'Pos':
      resolveRef(node.target, ctx)
      return null

    case 'InlineIf':
      resolveRef(node.cond, ctx)
      resolveRef(node.body, ctx)
      if (node.else_) resolveRef(node.else_, ctx)
      return null

    case 'Group':
    case 'Array':
      node.children?.forEach((c) => resolveRef(c, ctx))
      return null

    case 'Dict':
      node.children?.forEach((pair) => resolveRef(pair.value as AstNode | undefined, ctx))
      return null

    case 'Literal':
    default:
      return null
  }
}

// Walks statement-level nodes (template structure), delegating to
// resolveRef wherever an expression is used.
function visit(node: AstNode | null | undefined, ctx: Ctx): void {
  if (!node) return

  switch (node.typename) {
    case 'Root':
    case 'NodeList':
    case 'Output':
    case 'Capture':
      node.children?.forEach((c) => visit(c, ctx))
      return

    case 'TemplateData':
      return

    case 'If':
    case 'IfAsync':
      resolveRef(node.cond, ctx)
      visit(node.body, ctx)
      if (node.else_) visit(node.else_, ctx)
      return

    case 'For':
    case 'AsyncEach':
    case 'AsyncAll': {
      const arrRef = resolveRef(node.arr, ctx)
      const elementRef = arrRef ? arrRef.getOrCreateArrayElement() : null
      const child = ctx.child()
      const nameNode = node.name
      if (nameNode?.typename === 'Symbol') {
        child.bind(nameNode.value as string, elementRef)
      } else if (nameNode?.typename === 'Array') {
        // `{% for key, value in dict %}` — key is a local, value gets the
        // element schema.
        const parts = nameNode.children ?? []
        if (parts[0]?.typename === 'Symbol') child.bind(parts[0].value as string, null)
        if (parts[1]?.typename === 'Symbol') child.bind(parts[1].value as string, elementRef)
      }
      visit(node.body, child)
      if (node.else_) visit(node.else_, child)
      return
    }

    case 'Set': {
      const valueRef = resolveRef(node.value as AstNode, ctx)
      const targets = Array.isArray(node.targets) ? node.targets : (node.targets?.children ?? [])
      targets.forEach((t) => {
        if (t.typename === 'Symbol') ctx.bind(t.value as string, valueRef)
      })
      return
    }

    case 'Block':
      visit(node.body, ctx)
      return

    // Macros/imports introduce their own param scopes we don't model —
    // skip rather than risk false fields leaking into the schema.
    case 'Macro':
    case 'Import':
    case 'FromImport':
    case 'Include':
    case 'Extends':
      return

    default:
      resolveRef(node, ctx)
  }
}

export interface GeneratedTestData {
  data?: Record<string, unknown>
  error?: string
}

export function generateTestData(templateSrc: string): GeneratedTestData {
  if (!templateSrc.trim()) return { data: {} }

  let ast: AstNode
  try {
    ast = nunjucksInternal.parser.parse(templateSrc)
  } catch (err) {
    return { error: `Could not analyze template: ${(err as Error).message}` }
  }

  const rootHolder: { root: Record<string, unknown> } = { root: {} }
  try {
    visit(ast, new Ctx(new TreeRef(rootHolder, 'root')))
  } catch (err) {
    return { error: `Could not analyze template: ${(err as Error).message}` }
  }

  return { data: rootHolder.root }
}
