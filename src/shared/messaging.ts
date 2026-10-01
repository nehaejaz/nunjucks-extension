// Carbon's `bx--text-area` class is generic and likely reused elsewhere in the
// CMS, so the placeholder text is what actually pins this to the Response
// Text field. See CLAUDE.md "Confirmed DOM details".
export const RESPONSE_TEXTAREA_SELECTOR =
  'textarea.bx--text-area[placeholder="Enter the message the bot should respond with..."]'

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
