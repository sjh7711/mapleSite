const openManagerButton = document.getElementById("openManagerButton");
const statusElement = document.getElementById("status");

openManagerButton.addEventListener("click", async () => {
  openManagerButton.disabled = true;
  showStatus("배치 수집 관리자를 여는 중입니다…");

  try {
    const existingManager = await findExistingManagerContext();
    if (existingManager) {
      await chrome.windows.update(existingManager.windowId, { focused: true });
      if (Number.isInteger(existingManager.tabId)) {
        await chrome.tabs.update(existingManager.tabId, { active: true });
      }
      window.close();
      return;
    }
    const tab = await getActiveAuctionTab();
    const url = new URL(chrome.runtime.getURL("manager.html"));
    url.searchParams.set("tabId", String(tab.id));
    url.searchParams.set("windowId", String(tab.windowId));

    await chrome.windows.create({
      url: url.href,
      type: "popup",
      width: 720,
      height: 900,
      focused: true
    });
    window.close();
  } catch (error) {
    showStatus(error.message, "error");
    openManagerButton.disabled = false;
  }
});

async function findExistingManagerContext() {
  if (typeof chrome.runtime.getContexts !== "function") return null;
  const managerUrl = chrome.runtime.getURL("manager.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
  return contexts.find((context) =>
    Number.isInteger(context.windowId) && String(context.documentUrl || "").startsWith(managerUrl)
  ) || null;
}

async function getActiveAuctionTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("현재 활성 탭을 찾지 못했습니다.");
  }
  if (!/^https:\/\/auction\.maplestory\.nexon\.com(?:\/|$)/i.test(tab.url)) {
    throw new Error("메이플스토리 경매장 탭에서 실행해 주세요.");
  }
  return tab;
}

function showStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `status${type ? ` ${type}` : ""}`;
}
