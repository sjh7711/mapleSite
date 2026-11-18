import { MAX_SOUL_ETHER_PRICE_EOK, SOUL_ETHER_PRICE_UPDATE_KEY } from "../shared/soul-ether-prices.js";

document.querySelector("#admin-inbox-link").hidden = import.meta.env.VITE_STARFORCE_INBOX_ENABLED !== "true";
const form = document.querySelector("#admin-soul-prices");
const list = document.querySelector("#admin-price-rows");
const save = document.querySelector("#admin-save");
const reload = document.querySelector("#admin-reload");
const message = document.querySelector("#admin-message");
const inputs = [];
let current = null;
let busy = false;
let dirty = false;

function notify(text, kind = "") {
  message.textContent = text;
  message.dataset.error = String(kind === "error");
  message.dataset.success = String(kind === "success");
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) location.replace("/admin/login/");
    throw new Error(body?.error ?? "요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
  return body;
}
function changed() {
  dirty = inputs.some((input, index) => input.value === "" || Number(input.value) !== current?.prices[index]);
  inputs.forEach((input, index) => {
    input.disabled = busy || !current;
    input.closest(".admin-equipment-row").dataset.dirty = String(input.value === "" || Number(input.value) !== current?.prices[index]);
  });
  save.disabled = busy || !current || !dirty;
  reload.disabled = busy;
}
for (let index = 0; index < 4; index++) {
  const row = document.createElement("div"); row.className = "admin-equipment-row";
  const label = document.createElement("label"); label.className = "admin-equipment-name";
  label.htmlFor = `ether-price-${index + 1}`; label.textContent = `${index + 1}단계 에테르`;
  const price = document.createElement("div"); price.className = "admin-price-input";
  const input = document.createElement("input"); input.id = label.htmlFor;
  input.type = "number"; input.min = "0"; input.max = String(MAX_SOUL_ETHER_PRICE_EOK);
  input.step = "any"; input.inputMode = "decimal"; input.required = true; input.disabled = true;
  input.setAttribute("aria-label", `${index + 1}단계 에테르 가격 (억 메소)`);
  input.addEventListener("input", changed); inputs.push(input);
  const unit = document.createElement("span"); unit.className = "admin-price-unit";
  unit.textContent = "억"; unit.setAttribute("aria-hidden", "true");
  price.append(input, unit); row.append(label, price); list.append(row);
}
function render() {
  inputs.forEach((input, index) => { input.value = String(current.prices[index]); });
  document.querySelector("#price-updated").textContent = `마지막 저장: ${current.updatedAt
    ? new Date(current.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "기본 가격"}`;
}
async function load() {
  busy = true; changed();
  try {
    current = await api("/api/admin/soul-ether-prices"); render();
    notify("가격을 불러왔습니다.");
  } catch (error) { notify(error.message, "error"); }
  finally { busy = false; changed(); }
}
reload.addEventListener("click", () => {
  if (!dirty || confirm("저장하지 않은 변경사항을 버리고 최신 가격을 불러올까요?")) void load();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !current || !dirty || !form.reportValidity()) return;
  busy = true; changed(); notify("가격을 저장하는 중입니다.");
  try {
    current = await api("/api/admin/soul-ether-prices", { method: "PUT",
      body: JSON.stringify({ revision: current.revision, prices: inputs.map((input) => Number(input.value)) }) });
    render();
    notify("저장했습니다. 운영·프리뷰의 공통 기본 가격에 적용됩니다.", "success");
    try { localStorage.setItem(SOUL_ETHER_PRICE_UPDATE_KEY, String(current.revision)); } catch { /* Saving succeeded even when browser storage is unavailable. */ }
  } catch (error) { notify(error.message, "error"); }
  finally { busy = false; changed(); }
});
document.querySelector("#admin-logout").addEventListener("click", async () => {
  if (dirty && !confirm("저장하지 않은 변경사항을 버리고 로그아웃할까요?")) return;
  try { await api("/api/admin/session", { method: "DELETE" }); dirty = false; location.replace("/admin/login/"); }
  catch (error) { notify(error.message, "error"); }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty && current) { event.preventDefault(); event.returnValue = ""; }
});
void load();
