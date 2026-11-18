import { createResultShareURL, setResultSharePersonalPrices } from "./result-share-state.js";
import { toggleChip } from "./ui.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function showLinkDialog(url, opener, equipmentText = false) {
  const dialog = element("dialog", "result-share-dialog");
  const title = element("h2", "", equipmentText ? "장비목록 복사" : "현재 결과 공유");
  title.id = "result-share-dialog-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const help = element("p", "", equipmentText ? "장비목록을 복사해서 공유하세요." : "링크를 복사해서 공유하세요.");
  const input = element("textarea", "result-share-link");
  input.readOnly = true;
  input.value = url;
  input.setAttribute("aria-label", equipmentText ? "공유 장비목록" : "공유 링크");
  const actions = element("div", "result-share-actions");
  const copy = element("button", "result-share-action", equipmentText ? "장비목록 복사" : "링크 복사");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      help.textContent = equipmentText ? "장비목록을 복사했습니다." : "링크를 복사했습니다.";
    } catch {
      input.focus(); input.select();
      help.textContent = equipmentText ? "선택된 장비목록을 직접 복사해 주세요." : "선택된 링크를 직접 복사해 주세요.";
    }
  });
  const close = element("button", "result-share-action", "닫기");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  actions.append(copy, close);
  dialog.append(title, help, input, actions);
  dialog.addEventListener("close", () => { dialog.remove(); opener.focus(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  input.focus(); input.select();
}

export function installResultShare(tool, { shared, error }, { getEquipmentText, pasteButton } = {}) {
  const header = document.querySelector(".page__head");
  if (!header) return;
  const titleRow = header.querySelector(".page__title-row") ?? header;
  const button = header.querySelector("[data-equipment-copy]") ?? element("button", "result-share-button");
  button.disabled = false;
  button.type = "button";
  button.title = "현재 결과 공유 링크 복사";
  button.setAttribute("aria-label", "현재 결과 공유 링크 복사");
  // Fixed icon markup; never interpolate a link or shared data into HTML.
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 15 6-6M7.5 9.5l-3 3a4.95 4.95 0 0 0 7 7l3-3m-5-9 3-3a4.95 4.95 0 0 1 7 7l-3 3"/></svg><span>현재 결과 공유</span>';
  if (getEquipmentText) {
    button.querySelector("span").textContent = "장비목록 복사";
    button.title = "현재 슬롯의 장비목록을 텍스트로 복사";
    button.setAttribute("aria-label", button.title);
    button.querySelector("svg").innerHTML = '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>';
  }
  if (getEquipmentText && pasteButton) {
    const actions = titleRow.querySelector(".equipment-text-actions") ?? element("div", "equipment-text-actions");
    actions.append(button, pasteButton);
    // Keep all three actions together when the mobile header wraps.
    const inboxLaunch = header.querySelector(".inbox-launch");
    if (inboxLaunch) actions.append(inboxLaunch);
    titleRow.append(actions);
  } else {
    titleRow.append(button);
  }
  const status = header.querySelector(".result-share-status") ?? element("div", "result-share-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  header.append(status);
  let timeout;
  const copyResult = async (equipmentText, opener) => {
    opener.disabled = true;
    clearTimeout(timeout);
    try {
      const url = equipmentText ? getEquipmentText() : await createResultShareURL(tool);
      try {
        await navigator.clipboard.writeText(url);
        status.textContent = equipmentText ? "장비목록을 복사했습니다." : "공유 링크를 복사했습니다.";
      } catch {
        showLinkDialog(url, opener, equipmentText);
      }
    } catch (error) {
      status.textContent = error instanceof ReferenceError
        ? "공유 링크를 만들려면 브라우저를 최신 버전으로 업데이트해 주세요."
        : error.message || "공유 링크를 만들지 못했습니다.";
    } finally {
      opener.disabled = false;
      timeout = setTimeout(() => { status.textContent = ""; }, 6000);
    }
  };
  button.addEventListener("click", () => copyResult(Boolean(getEquipmentText), button));
  if (!shared) return;
  const banner = element("div", "result-share-banner");
  if (error) banner.setAttribute("role", "alert");
  banner.append(element("span", "", error || "공유된 결과입니다."));
  const bannerActions = element("div", "result-share-banner-actions");
  if (tool === "starforce" && !error) {
    const sparePrices = toggleChip("내 스페어값으로 보기", false, async () => {
      if (sparePrices.disabled) return;
      clearTimeout(timeout);
      sparePrices.disabled = true;
      sparePrices.setAttribute("aria-busy", "true");
      status.textContent = "";
      try {
        const result = await setResultSharePersonalPrices(sparePrices.getAttribute("aria-pressed") !== "true");
        sparePrices.setAttribute("aria-pressed", String(result.enabled));
        status.textContent = result.message;
      } catch {
        status.textContent = "스페어값을 불러올 수 없습니다.";
      } finally {
        sparePrices.disabled = false;
        sparePrices.removeAttribute("aria-busy");
        timeout = setTimeout(() => { status.textContent = ""; }, 6000);
      }
    });
    sparePrices.classList.add("result-share-action", "result-share-spare-prices");
    sparePrices.title = "저장한 스페어값을 적용하며, 저장값이 없으면 최신 기본값을 사용합니다. 끄면 공유 스페어값으로 돌아갑니다.";
    bannerActions.append(sparePrices);
  }
  const exit = element("button", "result-share-action", tool === "starforce" ? "공유 정보 초기화" : "내 설정으로 돌아가기");
  exit.type = "button";
  exit.title = "공유 정보 적용을 종료하고 내 저장 설정으로 돌아갑니다.";
  exit.addEventListener("click", () => {
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(history.state, "", url);
    location.reload();
  });
  bannerActions.append(exit);
  banner.append(bannerActions);
  header.after(banner);
}
