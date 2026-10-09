const MENU_ID = "formula-code-agent-convert";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "将选中的 LaTeX 转为 Python",
      contexts: ["selection"],
    });
  });

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

async function savePendingFormula(latex, sourceUrl = "") {
  await chrome.storage.session.set({
    pendingFormula: {
      latex: String(latex || "").trim(),
      sourceUrl,
      createdAt: Date.now(),
    },
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText || !tab?.id) return;
  await savePendingFormula(info.selectionText, tab.url || "");
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_FORMULA_PANEL" || !sender.tab?.id) return false;

  (async () => {
    try {
      await savePendingFormula(message.latex, message.sourceUrl || sender.tab.url || "");
      await chrome.sidePanel.open({ tabId: sender.tab.id });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();

  return true;
});

