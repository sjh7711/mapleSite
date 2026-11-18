import { MAX_STARFORCE_PRICE_EOK } from "../shared/starforce-price-catalog.js";
import { foldedPresets, groupPresetsByLevel } from "../shared/starforce-equipment-presets.js";

const navigation = document.querySelector("#admin-navigation");
if (navigation) {
  navigation.hidden = false;
  navigation.querySelector('a[href="/admin/blacksmith-inboxes/"]').hidden = import.meta.env.VITE_STARFORCE_INBOX_ENABLED !== "true";
}

const message = document.querySelector("#admin-message");
function notify(text, kind = "") {
  message.textContent = text;
  message.dataset.error = String(kind === "error");
  message.dataset.success = String(kind === "success");
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !document.querySelector("#admin-login")) location.replace("/admin/login/");
    throw new Error(body?.error ?? "요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
  return body;
}

const login = document.querySelector("#admin-login");
if (login) {
  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = login.querySelector("button");
    button.disabled = true;
    notify("로그인 중입니다.");
    try {
      await api("/api/admin/session", { method: "POST", body: JSON.stringify({ password: login.elements.password.value }) });
      login.reset();
      location.replace("/admin/starforce-prices/");
    } catch (error) { notify(error.message, "error"); }
    finally { button.disabled = false; }
  });
}

const form = document.querySelector("#admin-prices");
if (form) {
  const list = document.querySelector("#admin-price-rows");
  const save = document.querySelector("#admin-save");
  const reload = document.querySelector("#admin-reload");
  let current = null;
  let dirty = false;
  let busy = false;
  let otherOpen = false;
  const expandedGroups = new Set();
  const inputs = new Map();
  const changed = () => {
    dirty = [...inputs].some(([id, input]) => Number(input.value) !== current?.prices[id]);
    save.disabled = busy || !dirty;
    for (const [id, input] of inputs) input.closest(".admin-equipment-row").dataset.dirty = String(Number(input.value) !== current?.prices[id]);
    for (const button of list.querySelectorAll(".admin-parts-toggle")) {
      button.dataset.dirty = String(current.catalog.some((item) => item.groupId === button.dataset.groupId &&
        Number(inputs.get(item.id)?.value) !== current.prices[item.id]));
    }
  };
  const render = () => {
    inputs.clear();
    const catalog = new Map(current.catalog.map((item) => [item.id, item]));
    const equipmentRow = (item) => {
      const row = document.createElement("div"); row.className = "admin-equipment-row";
      const name = document.createElement("div"); name.className = "admin-equipment-name";
      const label = document.createElement("label"); label.className = "admin-item-name";
      label.htmlFor = `admin-price-${item.id}`;
      if (item.icon) {
        const icon = document.createElement("img");
        icon.src = "/" + item.icon.replace(/^\.\//u, ""); icon.alt = ""; label.append(icon);
      }
      const text = document.createElement("span"); text.textContent = item.name;
      label.append(text); name.append(label);
      if (item.fixed) {
        const note = document.createElement("span"); note.className = "admin-fixed";
        note.textContent = "고정"; note.title = "상점 고정가"; name.append(note);
      }
      const price = document.createElement("div"); price.className = "admin-price-input";
      const input = document.createElement("input");
      input.id = label.htmlFor;
      input.type = "number"; input.min = "0"; input.max = String(MAX_STARFORCE_PRICE_EOK);
      input.step = "any"; input.required = true; input.value = String(current.prices[item.id]);
      input.inputMode = "decimal";
      input.readOnly = item.fixed; input.setAttribute("aria-label", `${item.name} 노작값 (억 메소)`);
      if (item.fixed) input.title = "상점에서 정해진 가격입니다.";
      input.dataset.priceId = item.id;
      let previous = Number(input.value);
      input.addEventListener("input", () => {
        const next = Number(input.value);
        for (const child of current.catalog.filter((child) => child.groupId === item.id)) {
          const part = inputs.get(child.id);
          if (part && Number(part.value) === previous) part.value = input.value;
        }
        previous = next;
        changed();
      });
      inputs.set(item.id, input); price.append(input);
      const unit = document.createElement("span"); unit.className = "admin-price-unit";
      unit.textContent = "억"; unit.setAttribute("aria-hidden", "true"); price.append(unit);
      row.append(name, price); return row;
    };
    const entry = (preset) => {
      const item = catalog.get(preset.id);
      const wrapper = document.createElement("div"); wrapper.className = "admin-equipment-entry";
      const row = equipmentRow(item); wrapper.append(row);
      const parts = current.catalog.filter((part) => part.groupId === item.id);
      if (parts.length) {
        const button = document.createElement("button"); button.type = "button";
        button.className = "admin-parts-toggle"; button.dataset.groupId = item.id;
        button.setAttribute("aria-controls", `admin-parts-${item.id}`);
        button.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
        const panel = document.createElement("div"); panel.className = "admin-parts";
        panel.id = `admin-parts-${item.id}`;
        panel.append(...parts.map(equipmentRow));
        const expand = (open) => {
          panel.hidden = !open; button.setAttribute("aria-expanded", String(open));
          button.setAttribute("aria-label", `${item.name} 부위별 노작값 ${open ? "접기" : "펼치기"}`);
          if (open) expandedGroups.add(item.id); else expandedGroups.delete(item.id);
        };
        expand(expandedGroups.has(item.id));
        button.addEventListener("click", () => expand(panel.hidden));
        row.querySelector(".admin-equipment-name").append(button);
        wrapper.append(panel);
      }
      return wrapper;
    };
    const order = [200, 160, 140, 250];
    const rank = (level) => order.includes(level) ? order.indexOf(level) : order.length + (999 - level) / 1000;
    const groups = groupPresetsByLevel().sort((a, b) => rank(a.level) - rank(b.level)).map((group) => {
      const section = document.createElement("section"); section.className = "admin-equipment-group";
      const heading = document.createElement("h3"); heading.className = "admin-equipment-level";
      heading.textContent = `${group.level}제`;
      const grid = document.createElement("div"); grid.className = "admin-equipment-grid";
      grid.append(...group.presets.map(entry)); section.append(heading, grid); return section;
    });
    const other = document.createElement("details"); other.className = "admin-other"; other.open = otherOpen;
    other.addEventListener("toggle", () => { otherOpen = other.open; });
    const summary = document.createElement("summary"); summary.textContent = "기타";
    const otherGrid = document.createElement("div"); otherGrid.className = "admin-equipment-grid";
    otherGrid.append(...foldedPresets().map(entry)); other.append(summary, otherGrid);
    list.replaceChildren(...groups, other);
    const time = current.updatedAt ? new Date(current.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "기본 가격";
    document.querySelector("#price-updated").textContent = `마지막 저장: ${time}`;
    changed();
  };
  form.addEventListener("invalid", (event) => {
    const panel = event.target.closest(".admin-parts");
    if (panel?.hidden) panel.previousElementSibling.querySelector(".admin-parts-toggle").click();
    const other = event.target.closest("details");
    if (other) other.open = true;
  }, true);
  const load = async () => {
    busy = true; save.disabled = true; reload.disabled = true;
    try {
      current = await api("/api/admin/starforce-prices"); render();
      notify("가격을 불러왔습니다.");
    } catch (error) { notify(error.message, "error"); }
    finally { busy = false; reload.disabled = false; changed(); }
  };
  reload.addEventListener("click", () => {
    if (!dirty || confirm("저장하지 않은 변경사항을 버리고 최신 가격을 불러올까요?")) void load();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !dirty || !form.reportValidity()) return;
    busy = true; save.disabled = true; reload.disabled = true;
    for (const input of inputs.values()) input.disabled = true;
    notify("가격을 저장하는 중입니다.");
    try {
      const prices = Object.fromEntries([...inputs].map(([id, input]) => [id, Number(input.value)]));
      const result = await api("/api/admin/starforce-prices", { method: "PUT", body: JSON.stringify({ revision: current.revision, prices }) });
      current = { ...current, ...result }; render();
      notify("저장했습니다. 운영·프리뷰의 공통 기본 가격에 적용됩니다.", "success");
      localStorage.setItem("maplestarforce:price-update", String(current.revision));
    } catch (error) { notify(error.message, "error"); }
    finally {
      busy = false; reload.disabled = false;
      for (const input of inputs.values()) input.disabled = false;
      changed();
    }
  });
  document.querySelector("#admin-logout").addEventListener("click", async () => {
    try { await api("/api/admin/session", { method: "DELETE" }); location.replace("/admin/login/"); }
    catch (error) { notify(error.message, "error"); }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  void load();
}
