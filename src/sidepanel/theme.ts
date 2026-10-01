export type ThemePreference = 'light' | 'dark'

const STORAGE_KEY = 'theme'

// Only falls back to the OS preference the very first time the panel is
// ever opened. Once the user picks explicitly (via the toggle), that choice
// is stored and always wins — the panel does not follow OS theme changes
// after that.
export async function loadTheme(): Promise<ThemePreference> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const value = stored[STORAGE_KEY]
  if (value === 'light' || value === 'dark') return value
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export async function saveTheme(theme: ThemePreference): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: theme })
}
