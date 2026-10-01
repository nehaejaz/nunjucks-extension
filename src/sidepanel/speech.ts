// Approximates SSML playback using the browser's built-in Web Speech API,
// which has no real SSML support of its own. This is a readability check,
// not a production-accurate rendering of what Polly (or whatever the real
// voice channel uses) would actually sound like — see CLAUDE.md.

export type PlaybackState = 'idle' | 'playing'

type QueueItem = { kind: 'speak'; text: string } | { kind: 'pause'; ms: number }

const BREAK_RE = /<break\s+time\s*=\s*["']?(\d+)(ms|s)?["']?\s*\/?>/gi
const DIGITS_SAY_AS_RE = /<say-as\s+interpret-as=["']digits["']\s*>([\s\S]*?)<\/say-as>/gi
const CURRENCY_SAY_AS_RE = /<say-as\s+interpret-as=["']currency["']\s*>([\s\S]*?)<\/say-as>/gi
const ANY_TAG_RE = /<\/?[a-zA-Z][^>]*>/g

function splitOnBreaks(raw: string): Array<{ text: string; pauseAfterMs: number }> {
  const segments: Array<{ text: string; pauseAfterMs: number }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  BREAK_RE.lastIndex = 0
  while ((match = BREAK_RE.exec(raw))) {
    const amount = parseInt(match[1], 10)
    const ms = match[2] === 's' ? amount * 1000 : amount
    segments.push({ text: raw.slice(lastIndex, match.index), pauseAfterMs: ms })
    lastIndex = BREAK_RE.lastIndex
  }
  segments.push({ text: raw.slice(lastIndex), pauseAfterMs: 0 })
  return segments
}

function cleanForSpeech(text: string): string {
  let out = text
  out = out.replace(DIGITS_SAY_AS_RE, (_, inner: string) => inner.trim().split('').join(' '))
  out = out.replace(CURRENCY_SAY_AS_RE, (_, inner: string) => `$${inner.trim()}`)
  out = out.replace(ANY_TAG_RE, '')
  return out.replace(/\s+/g, ' ').trim()
}

function buildQueue(raw: string): QueueItem[] {
  const queue: QueueItem[] = []
  for (const seg of splitOnBreaks(raw)) {
    const cleaned = cleanForSpeech(seg.text)
    if (cleaned) queue.push({ kind: 'speak', text: cleaned })
    if (seg.pauseAfterMs > 0) queue.push({ kind: 'pause', ms: seg.pauseAfterMs })
  }
  return queue
}

export class SpeechPlayer {
  private queue: QueueItem[] = []
  private index = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private playing = false

  constructor(private onStateChange: (state: PlaybackState) => void) {}

  get isPlaying(): boolean {
    return this.playing
  }

  static isSupported(): boolean {
    return 'speechSynthesis' in window
  }

  play(raw: string): void {
    this.stop()
    this.queue = buildQueue(raw)
    this.index = 0
    if (!this.queue.length) return
    this.playing = true
    this.onStateChange('playing')
    this.advance()
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    window.speechSynthesis?.cancel()
    if (this.playing) {
      this.playing = false
      this.onStateChange('idle')
    }
  }

  private advance(): void {
    if (!this.playing) return
    if (this.index >= this.queue.length) {
      this.playing = false
      this.onStateChange('idle')
      return
    }
    const item = this.queue[this.index++]
    if (item.kind === 'pause') {
      this.timer = setTimeout(() => this.advance(), item.ms)
      return
    }
    const utterance = new SpeechSynthesisUtterance(item.text)
    utterance.onend = () => this.advance()
    utterance.onerror = () => this.advance()
    window.speechSynthesis.speak(utterance)
  }
}
