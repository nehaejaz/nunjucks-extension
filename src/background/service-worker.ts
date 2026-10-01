chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

// Only show the side panel entry point on CMS pages so it doesn't clutter
// the toolbar/panel elsewhere.
chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  if (!tab.url) return
  const isCmsPage = tab.url.startsWith('https://portal.finn.ai/cms')
  chrome.sidePanel
    .setOptions({
      tabId,
      path: 'src/sidepanel/index.html',
      enabled: isCmsPage,
    })
    .catch(() => {})
})
