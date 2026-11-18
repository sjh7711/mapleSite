import { inboxItems, inboxLabel, INBOX_STATUSES, INBOX_EDIT_LIMIT, INBOX_ACTIVE_LIMIT, INBOX_HISTORY_LIMIT } from "./blacksmith-inbox-schema.js";
import { inboxRequestsForView } from "./blacksmith-inbox-list.js";
import { MESO_PER_EOK } from "../calc.js";
import { formatEquipmentText } from "./starforce-equipment-text.js";
import { enableCalculatorStoragePersistence } from "./result-share-state.js";
import "./blacksmith-inbox.css";

const API = `${import.meta.env.VITE_INBOX_API_BASE ?? ""}/api/blacksmith-inboxes`;
const ROOMS_KEY = "maplestarforce:blacksmith-inboxes:v1";
const APPLICANT_KEY = "maplestarforce:inbox-applicant:v1";
const OWNER_POLL_INTERVAL = 5000;
const expectedCostFormat = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const draftKey = (room, id) => `maplestarforce:inbox-draft:${room}:${id}`;
const node = (tag, className = "", text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
const button = (text, action, className = "inbox-button") => {
  const el = node("button", className, text); el.type = "button";
  el.addEventListener("click", action); return el;
};
const input = (label, placeholder = "", maxLength = 32) => {
  const el = node("input", "inbox-input"); el.setAttribute("aria-label", label);
  el.placeholder = placeholder; el.maxLength = maxLength; return el;
};
function readStored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
async function clientToken() {
  const connect = () => {
    let token = localStorage.getItem(APPLICANT_KEY);
    if (!/^[a-f0-9]{64}$/u.test(token ?? "")) {
      token = [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(APPLICANT_KEY, token);
    }
    return token;
  };
  return navigator.locks ? navigator.locks.request(APPLICANT_KEY, connect) : connect();
}
function readRooms() {
  const stored = readStored(ROOMS_KEY, []);
  // Retain access to previously created inboxes while allowing only one new inbox.
  return Array.isArray(stored) ? stored.filter(r => /^[a-f0-9]{24}$/u.test(r?.id) &&
    (/^[a-f0-9]{64}$/u.test(r?.browserToken ?? r?.ownerKey) || r.managedByIp === true))
    .slice(0, 10).map(r => ({ id: r.id, name: r.name,
      ...(/^[a-f0-9]{64}$/u.test(r.browserToken ?? r.ownerKey) ? { browserToken: r.browserToken ?? r.ownerKey } : { managedByIp: true }) })) : [];
}
async function request(path, { method = "GET", body, room, applicantToken, signal } = {}) {
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(`${API}${path}`, { method, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Accept: "application/json", "X-Inbox-Client": await clientToken(), ...(body ? { "Content-Type": "application/json" } : {}),
      ...(room?.browserToken ? { Authorization: `Bearer ${room.browserToken}` } : {}),
      ...(applicantToken ? { "X-Inbox-Applicant": applicantToken } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(data?.error ?? "대장장이 서비스에 연결하지 못했습니다."); error.status = response.status; throw error; }
  return data;
}
function modal(title, opener, compact = false) {
  const dialog = node("dialog", `inbox-dialog${compact ? " inbox-dialog--compact" : ""}`);
  const head = node("div", "inbox-head"), heading = node("h2", "", title);
  heading.id = `inbox-title-${crypto.randomUUID()}`; dialog.setAttribute("aria-labelledby", heading.id);
  head.append(heading, button("×", () => dialog.close(), "inbox-close"));
  head.lastChild.setAttribute("aria-label", "창 닫기");
  const content = node("div", "inbox-body"); dialog.append(head, content);
  const outside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => { pressedOutside = outside(event); });
  dialog.addEventListener("pointercancel", () => { pressedOutside = false; });
  dialog.addEventListener("click", (event) => { if (pressedOutside && outside(event)) dialog.close(); pressedOutside = false; });
  document.body.append(dialog); dialog.addEventListener("close", () => { dialog.remove(); opener?.focus(); }, { once: true });
  dialog.showModal(); return { dialog, content };
}
let turnstilePromise;
async function botWidget(host, action) {
  const { sitekey } = await request("/config");
  if (!sitekey) throw new Error("봇 확인 서비스가 준비되지 않았습니다.");
  turnstilePromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true; script.onload = resolve;
    script.onerror = () => { turnstilePromise = null; reject(new Error("봇 확인을 불러오지 못했습니다.")); };
    document.head.append(script);
  });
  await turnstilePromise;
  if (!host.isConnected) return null;
  let token = "";
  const id = window.turnstile.render(host, { sitekey, action, theme: "auto", language: "ko", size: host.clientWidth < 300 ? "compact" : "flexible",
    callback: value => { token = value; }, "expired-callback": () => { token = ""; }, "error-callback": () => { token = ""; },
  });
  return { token: () => token, reset() { token = ""; window.turnstile.reset(id); }, remove() { window.turnstile.remove(id); } };
}

export function installBlacksmithInbox(adapter) {
  if (!adapter) return;
  let rooms = readRooms();
  let room = rooms[0] ?? null, info = null, requests = [], revision = -1;
  let panel = null, list = null, status = null, controls = null, filters = null, requestFilter = null, pollTimer, controller, generation = 0, backoff = OWNER_POLL_INTERVAL;
  let requestSearch = "";
  let history = { page: 0, pages: 1, total: 0 }, pagination = null, searchTimer;
  let createCleanup = null;
  let entryMode = "create";
  let connection = null;
  let counts = { waiting: 0, working: 0, done: 0 };
  const expanded = new Set();
  let active = null, drafts = new Map();
  const head = document.querySelector(".page__head");
  const launch = head.querySelector(".inbox-launch") ?? node("button", "result-share-button inbox-launch");
  launch.type = "button"; launch.disabled = false;
  launch.addEventListener("click", () => showInbox());
  launch.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.4 8.4a2.1 2.1 0 0 1-3-3L12 9"/><path d="m9 6 3-3 9 9-3 3z"/></svg>';
  const launchLabel = node("span"); launch.append(launchLabel); updateBadge();
  const actions = head.querySelector(".equipment-text-actions");
  if (actions) actions.append(launch);
  else head.querySelector(".theme-toggle")?.before(launch);
  if (!launch.isConnected) head.append(launch);
  const workspace = node("div", "inbox-workspace"); workspace.hidden = true;
  document.querySelector(".enhance-toolbar").before(workspace);
  const persistRooms = () => { try { localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms)); } catch { throw new Error("브라우저에 대장장이 정보를 저장하지 못했습니다. 사이트 저장 공간을 확인해 주세요."); } };
  try { if (rooms.length) persistRooms(); } catch { /* Existing credentials remain available in this tab. */ }
  const message = (text, error = false) => {
    if (status) {
      status.textContent = text; status.hidden = !text; status.classList.toggle("is-error", error);
    }
  };
  function updateBadge() {
    const text = `${room ? "대장장이 대기열" : "대장장이 예약"}${info ? ` · 대기 ${counts.waiting}` : ""}`;
    launchLabel.textContent = text; launch.setAttribute("aria-label", text); launch.title = text;
  }
  async function copy(value, label, opener) {
    try {
      await navigator.clipboard.writeText(value);
      opener.querySelector(".inbox-copy-feedback")?.remove();
      const feedback = node("span", "inbox-copy-feedback", "복사완료"); feedback.setAttribute("role", "status");
      opener.classList.add("inbox-copy"); opener.append(feedback);
      setTimeout(() => feedback.remove(), 1800);
    }
    catch {
      const { content } = modal(label, opener, true);
      const field = input(label); field.value = value; field.readOnly = true;
      content.append(field, node("p", "inbox-help", "아래 내용을 선택해 복사하세요.")); field.select();
    }
  }
  function leave() {
    adapter.leaveRequest(); active = null; workspace.hidden = true; workspace.replaceChildren(); renderList();
  }
  function changeRoom(next) {
    if (active) leave();
    room = next; revision = -1; requests = []; info = null; requestFilter = null; requestSearch = ""; history = { page: 0, pages: 1, total: 0 }; counts = { waiting: 0, working: 0, done: 0 }; expanded.clear(); generation += 1; controller?.abort(); controller = null;
    renderPanel(); updateBadge(); void poll();
  }
  async function connectByIp() {
    if (room) return;
    if (connection) return connection;
    const epoch = generation;
    connection = request("/managed").then(data => {
      if (generation !== epoch || room || !/^[a-f0-9]{24}$/u.test(data.room?.id ?? "")) return;
      // This marker remembers the selection only. The server rechecks the IP.
      const next = { id: data.room.id, name: data.room.name, managedByIp: true };
      rooms = [next, ...rooms];
      try { persistRooms(); } catch { /* Same-IP access also works for this tab without storage. */ }
      changeRoom(next);
    }).catch(error => { message(error.message, true); }).finally(() => {
      connection = null;
      if (!room && panel?.querySelector(".inbox-connection")) renderPanel();
    });
    return connection;
  }
  function forgetRoom(id) {
    if (active?.roomId === id) leave();
    const prefix = draftKey(id, "");
    for (const key of drafts.keys()) if (key.startsWith(prefix)) drafts.delete(key);
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    } catch { /* Server disposal still succeeds when browser storage is unavailable. */ }
    rooms = rooms.filter(r => r.id !== id);
    try { persistRooms(); } catch { /* A later visit will also remove the expired room. */ }
    if (room?.id === id) changeRoom(rooms[0] ?? null);
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (!room) return;
    if (document.hidden || controller) { pollTimer = setTimeout(() => void poll(), OWNER_POLL_INTERVAL); return; }
    const selected = room, epoch = generation, pending = new AbortController(); controller = pending;
    try {
      const query = new URLSearchParams({ revision, includeItems: "1", historyPage: history.page, search: requestSearch });
      const data = await request(`/${selected.id}?${query}`, { room: selected, signal: pending.signal });
      if (epoch !== generation) return;
      info = data.room;
      if (!data.unchanged) {
        if (active && data.requests.some(item => item.id === active.id && (item.status === "blocked" || (item.version ?? 0) !== active.version))) leave();
        requests = data.requests; revision = info.revision;
        history = data.history ?? { page: 0, pages: 1, total: 0 };
        counts = data.counts ?? { waiting: requests.filter(item => item.status === "waiting").length, working: requests.filter(item => item.status === "working").length, done: history.total };
        renderList(); renderControls(); renderHeader(); updateBadge();
      }
      backoff = OWNER_POLL_INTERVAL;
      message("");
    } catch (error) {
      if (error.name !== "AbortError" && epoch === generation) {
        if (error.status === 404 || error.status === 410 || (error.status === 401 && selected.managedByIp)) {
          forgetRoom(selected.id); message(error.message, true);
          void connectByIp();
        } else { backoff = Math.min(backoff * 2, 60000); message(error.message, true); }
      }
    } finally {
      if (controller === pending) controller = null;
      if (epoch === generation && room) pollTimer = setTimeout(() => void poll(), backoff);
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll(); });
  window.addEventListener("online", () => void poll());
  window.addEventListener("storage", (event) => {
    if (event.key !== ROOMS_KEY && event.key !== null) return;
    const saved = readRooms(), previousId = room?.id;
    rooms = saved;
    if (previousId && !saved.some(r => r.id === previousId)) { forgetRoom(previousId); return; }
    const selected = saved.find(r => r.id === previousId) ?? saved[0] ?? null;
    if (selected?.id !== previousId) changeRoom(selected);
    else { room = selected; renderPanel(); }
  });
  function saveDraft(roomId, id, items, version) {
    const key = draftKey(roomId, id), value = { version, items }; drafts.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { if (active?.id === id) workspace.querySelector(".inbox-workspace__name").textContent = `${active.nickname} · 작업 저장 공간 부족`; }
  }
  function requestDraft(roomId, id, version = 0) {
    const key = draftKey(roomId, id), saved = drafts.get(key) ?? readStored(key, null);
    const items = Array.isArray(saved) ? (version === 0 ? saved : null) : saved?.version === version ? saved.items : null;
    // Only trusted calculator drafts may restore edited prices and strategies.
    try { if (Array.isArray(items)) { inboxItems(items); return items; } } catch { /* stale draft */ }
    return null;
  }
  async function loadApplication(item, opener) {
    opener.disabled = true;
    const selected = room, epoch = generation;
    let complete;
    try {
      const data = await request(`/${selected.id}/requests/${item.id}`, { room: selected });
      if (generation !== epoch) return;
      // Claim the exact version before opening it, so an applicant edit or
      // withdrawal racing this load never opens stale equipment.
      if (data.status === "waiting") await request(`/${selected.id}/requests/${item.id}`, { method: "PATCH", room: selected, body: { status: "working", version: data.version } });
      if (generation !== epoch) return;
      const version = data.version ?? 0, draft = requestDraft(selected.id, item.id, version);
      enableCalculatorStoragePersistence();
      adapter.openRequest(`${selected.id}:${item.id}`, inboxItems(data.items), draft, items => saveDraft(selected.id, item.id, items, version));
      active = { ...item, roomId: selected.id, version };
      complete = button("완료", (event) => void completeApplication(event.currentTarget), "inbox-button is-primary");
      const error = node("p", "inbox-workspace__status inbox-status is-error"); error.hidden = true; error.setAttribute("role", "alert");
      workspace.replaceChildren(node("strong", "inbox-workspace__name", `${item.nickname} · 신청 장비 작업 중`),
        complete, button("대기열", () => showInbox()), button("내 슬롯으로 돌아가기", leave), error);
      workspace.hidden = false;
      panel?.close();
      revision = -1; void poll();
    } catch (error) { message(error.message, true); revision = -1; void poll(); }
    finally { opener.disabled = false; if (complete) complete.disabled = false; }
  }
  async function completeApplication(opener) {
    const current = active, selected = rooms.find(r => r.id === current?.roomId);
    if (!current || !selected) return;
    opener.disabled = true;
    const errorBox = workspace.querySelector(".inbox-workspace__status");
    errorBox.textContent = ""; errorBox.hidden = true;
    try {
      await request(`/${selected.id}/requests/${current.id}`, { method: "PATCH", room: selected, body: { status: "done" } });
      if (active === current) leave();
      if (room?.id === selected.id) {
        requests = requests.map(item => item.id === current.id ? { ...item, status: "done" } : item);
        revision = -1; renderList(); updateBadge(); void poll();
      }
      return true;
    } catch (error) {
      if (active === current) { errorBox.textContent = error.message; errorBox.hidden = false; }
      message(error.message, true);
      return false;
    } finally { opener.disabled = false; }
  }
  function renderList() {
    if (!list) return;
    const scrollTop = list.scrollTop;
    renderFilters();
    renderPagination();
    list.replaceChildren();
    if (!room || !requests.length) return;
    for (const item of inboxRequestsForView(requests, requestFilter, requestSearch)) {
      const row = node("article", "inbox-request");
      if (active?.id === item.id && active.roomId === room.id) row.classList.add("is-active");
      const text = node("div", "inbox-request__text");
      const heading = node("div", "inbox-request__heading");
      const time = node("time", "inbox-help inbox-request__time", new Date(item.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }));
      time.dateTime = new Date(item.createdAt).toISOString();
      heading.append(node("strong", "", item.nickname), document.createTextNode(" "), time);
      const summary = node("span", "inbox-help inbox-request__summary"); summary.dataset.requestId = item.id;
      text.append(heading, summary);
      let details;
      if (Array.isArray(item.items)) {
        details = node("details", "inbox-request__equipment");
        const toggle = node("summary", "", "장비 보기");
        const preview = node("pre", "inbox-equipment", formatEquipmentText(inboxItems(item.items)));
        details.append(toggle, preview); details.open = expanded.has(item.id);
        details.addEventListener("toggle", () => { if (details.open) expanded.add(item.id); else expanded.delete(item.id); });
      }
      if (item.status === "blocked") {
        row.classList.add("is-blocked");
        heading.append(node("span", "inbox-request__blocked", "차단됨"));
        const unblock = button("차단 해제", async () => {
          if (!window.confirm(`${item.nickname}님의 차단을 해제할까요? 차단 기록은 목록에서 제거됩니다.`)) return;
          const selected = room;
          try {
            unblock.disabled = true;
            await request(`/${selected.id}/requests/${item.id}/block`, { method: "DELETE", room: selected, body: { blockedAt: item.blockedAt } });
            revision = -1; void poll();
          } catch (error) { message(error.message, true); unblock.disabled = false; }
        });
        row.append(text, unblock); if (details) row.append(details); list.append(row);
        continue;
      }
      const select = node("select", "inbox-input"); select.setAttribute("aria-label", `${item.nickname} 처리 상태`);
      Object.entries(INBOX_STATUSES).forEach(([value, label]) => { const option = node("option", "", label); option.value = value; select.append(option); });
      select.value = item.status;
      select.addEventListener("change", async () => {
        const selected = room;
        if(select.value === "done" && active?.id === item.id && active.roomId === selected.id) {
          if(!await completeApplication(select))select.value = item.status;
          return;
        }
        try { select.disabled = true; await request(`/${selected.id}/requests/${item.id}`, { room: selected, method: "PATCH", body: { status: select.value } }); revision = -1; void poll(); }
        catch (error) { message(error.message, true); select.value = item.status; }
        finally { select.disabled = false; }
      });
      const load = button("장비 불러오기", () => void loadApplication(item, load), "inbox-button is-primary");
      const remove = button("거절", async () => {
        if (!window.confirm(`${item.nickname}님의 신청을 거절할까요?`)) return;
        const selected = room;
        try {
          remove.disabled = true; await request(`/${selected.id}/requests/${item.id}`, { method: "DELETE", room: selected });
          if (active?.id === item.id) leave();
          localStorage.removeItem(draftKey(selected.id, item.id)); drafts.delete(draftKey(selected.id, item.id));
          revision = -1; void poll();
        } catch (error) { message(error.message, true); remove.disabled = false; }
      });
      const block = button("차단", async () => {
        if (!window.confirm(`${item.nickname}님의 신청을 거절하고 이번 대장장이의 재신청을 차단할까요?`)) return;
        const selected = room;
        try {
          block.disabled = true;
          await request(`/${selected.id}/requests/${item.id}/block`, { method: "POST", room: selected, body: {} });
          if (active?.id === item.id) leave();
          localStorage.removeItem(draftKey(selected.id, item.id)); drafts.delete(draftKey(selected.id, item.id));
          history.page = Number.MAX_SAFE_INTEGER; reloadView();
        } catch (error) { message(error.message, true); block.disabled = false; }
      }, "inbox-button is-danger");
      row.append(text, select, load, remove, block); if (details) row.append(details); list.append(row);
    }
    renderCosts();
    list.scrollTop = scrollTop;
  }
  function renderCosts() {
    if (!list || !room) return;
    const entries = new Map(requests.map(item => [item.id, item]));
    for (const summary of list.querySelectorAll(".inbox-request__summary")) {
      const item = entries.get(summary.dataset.requestId);
      if (!item) continue;
      let cost = null;
      try {
        const draft = active?.roomId === room.id && active.id === item.id ? adapter.getItems() : requestDraft(room.id, item.id, item.version ?? 0);
        cost = adapter.getExpectedCost(inboxItems(item.items), draft);
      } catch { /* Never display a misleading partial or zero estimate. */ }
      const amount = Number.isFinite(cost) ? `${expectedCostFormat.format(cost / MESO_PER_EOK)}억메소` : "계산 불가";
      summary.textContent = `장비 ${item.itemCount}개, 기댓값 ${amount}`;
    }
  }
  adapter.onCalculationChange(renderCosts);
  function renderFilters() {
    if (!filters) return;
    for (const filter of filters.children) {
      const value = filter.dataset.status, selected = value === requestFilter;
      const label = INBOX_STATUSES[value], limit = value === "done" ? INBOX_HISTORY_LIMIT : INBOX_ACTIVE_LIMIT;
      filter.textContent = `${label}·${counts[value] ?? 0}/${limit}`;
      filter.title = `${label} 신청만 보기 · 다시 누르면 전체 보기${value === "done" ? "" : ` · 대기·진행 합계 ${INBOX_ACTIVE_LIMIT}건`}`;
      filter.setAttribute("aria-pressed", String(selected));
      filter.classList.toggle("is-primary", selected);
      filter.disabled = !room;
    }
  }
  function reloadView() {
    revision = -1; generation += 1; controller?.abort(); controller = null; void poll();
  }
  function renderPagination() {
    if (!pagination) return;
    pagination.replaceChildren();
    pagination.hidden = !room || (["waiting", "working"].includes(requestFilter) && !counts.blocked) || history.pages < 2;
    if (pagination.hidden) return;
    const prev = button("이전", () => { history.page -= 1; reloadView(); }); prev.disabled = history.page === 0;
    const next = button("다음", () => { history.page += 1; reloadView(); }); next.disabled = history.page + 1 >= history.pages;
    pagination.append(node("span", "inbox-help", `${counts.blocked ? "완료·차단" : "완료"} ${history.total}건 · ${history.page + 1} / ${history.pages}`), prev, next);
  }
  function publicAddress() { const url = new URL("/", location.origin); url.searchParams.set("inbox", room.id); return url.href; }
  function renderControls() {
    if (!controls || !room) return;
    controls.replaceChildren();
    const address = input("신청 접수 주소"); address.value = publicAddress(); address.readOnly = true;
    controls.append(address,
      button("접수 주소 복사", (event) => void copy(publicAddress(), "접수 주소", event.currentTarget)),
      button(info?.accepting === false ? "접수 재개" : "접수 일시 중지", async () => {
        try { await request(`/${room.id}`, { room, method: "PATCH", body: { accepting: info?.accepting === false } }); revision = -1; void poll(); }
        catch (error) { message(error.message, true); }
      }),
      button("대장장이 종료", async (event) => {
        const selected = room, trigger = event.currentTarget;
        if (!window.confirm(`${info?.name ?? selected.name} 대장장이를 종료할까요? 접수된 모든 신청과 이 브라우저의 작업이 삭제됩니다.`)) return;
        trigger.disabled = true;
        try {
          await request(`/${selected.id}`, { room: selected, method: "DELETE" });
          forgetRoom(selected.id); message("대장장이를 종료했습니다.");
        } catch (error) {
          if (error.status === 404 || error.status === 410) forgetRoom(selected.id);
          message(error.message, true); trigger.disabled = false;
        }
      }, "inbox-button is-danger"));
  }
  function renderHeader() {
    if (!panel?.open) return;
    const heading = panel.querySelector(".inbox-head h2");
    if (!heading.parentElement.classList.contains("inbox-heading-group")) {
      const group = node("div", "inbox-heading-group"); heading.before(group); group.append(heading);
    }
    heading.replaceChildren();
    if (room) heading.textContent = info?.name ?? room.name;
    else {
      const tabs = node("span", "inbox-entry-tabs");
      tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "대장장이 예약 메뉴");
      for (const [mode, label] of [["create", "대장장이 예약 열기"], ["find", "대장장이 찾기"]]) {
        const tab = button(label, () => {
          if (entryMode === mode) return;
          entryMode = mode; renderPanel();
          panel.querySelector('.inbox-entry-tabs [aria-selected="true"]')?.focus();
        }, `inbox-button${entryMode === mode ? " is-primary" : ""}`);
        tab.id = `${heading.id}-${mode}`;
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(entryMode === mode));
        tab.setAttribute("aria-controls", `${heading.id}-entry`); tab.tabIndex = entryMode === mode ? 0 : -1;
        tab.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          entryMode = event.key === "Home" ? "create" : event.key === "End" ? "find" : entryMode === "create" ? "find" : "create";
          renderPanel(); panel.querySelector('.inbox-entry-tabs [aria-selected="true"]')?.focus();
        });
        tabs.append(tab);
      }
      heading.append(tabs);
    }
    panel.querySelector(".inbox-header-expiry")?.remove();
    if (room && Number.isFinite(info?.expiresAt)) {
      const expiry = node("span", "inbox-header-expiry");
      const time = node("time", "", new Date(info.expiresAt).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }));
      time.dateTime = new Date(info.expiresAt).toISOString();
      expiry.append(document.createTextNode("자동 종료 예정 "), time); heading.after(expiry);
    }
  }
  function renderPanel() {
    if (!panel?.open) return;
    panel.classList.toggle("inbox-dialog--queue", Boolean(room));
    createCleanup?.(); createCleanup = null;
    const body = panel.querySelector(".inbox-body"); body.replaceChildren();
    renderHeader();
    status = node("p", "inbox-status"); status.setAttribute("role", "status"); status.hidden = true; body.append(status);
    if (!room) {
      controls = list = filters = pagination = null;
      const empty = node("div", "inbox-empty-state");
      const heading = panel.querySelector(".inbox-head h2");
      empty.id = `${heading.id}-entry`; empty.setAttribute("role", "tabpanel");
      empty.setAttribute("aria-labelledby", `${heading.id}-${entryMode}`);
      body.append(empty);
      if (connection) {
        empty.append(node("p", "inbox-help inbox-connection", "대장장이 관리 정보를 확인하고 있습니다…"));
        return;
      }
      if (entryMode === "find") renderFindForm(empty);
      else renderCreateForm(empty);
      return;
    }
    if (rooms.length > 1) {
      const toolbar = node("div", "inbox-toolbar");
      const select = node("select", "inbox-input"); select.setAttribute("aria-label", "내 대장장이 선택");
      rooms.forEach(r => { const option = node("option", "", r.name); option.value = r.id; select.append(option); });
      select.value = room.id; select.onchange = () => changeRoom(rooms.find(r => r.id === select.value)); toolbar.append(select); body.append(toolbar);
    }
    controls = node("section", "inbox-controls"); list = node("section", "inbox-list"); list.setAttribute("aria-label", "받은 신청 목록"); body.append(controls);
    list.id = `inbox-list-${crypto.randomUUID()}`;
    const queue = node("div", "inbox-queue");
    filters = node("div", "inbox-filters"); filters.setAttribute("role", "group"); filters.setAttribute("aria-label", "신청 상태 필터");
    for (const [value, label] of Object.entries(INBOX_STATUSES)) {
      const filter = button(label, () => { requestFilter = requestFilter === value ? null : value; renderList(); });
      filter.dataset.status = value; filter.setAttribute("aria-controls", list.id);
      filters.append(filter);
    }
    controls.hidden = !room;
    const search = input("신청자 검색", "닉네임·초성 검색"); search.type = "search"; search.classList.add("inbox-search");
    search.value = requestSearch; search.disabled = !room; search.setAttribute("aria-controls", list.id);
    search.addEventListener("input", () => {
      requestSearch = search.value; history.page = 0; renderList(); clearTimeout(searchTimer);
      searchTimer = setTimeout(reloadView, 350);
    });
    const listToolbar = node("div", "inbox-list-toolbar"); listToolbar.append(filters, search);
    pagination = node("div", "inbox-pagination"); pagination.setAttribute("aria-label", "완료 내역 페이지");
    queue.append(listToolbar, list, pagination); body.append(queue); renderControls(); renderList();
  }
  function showInbox() {
    if (panel?.open) return;
    panel = modal("대장장이 대기열", launch).dialog;
    panel.addEventListener("close", () => { createCleanup?.(); createCleanup = null; panel = null; list = null; controls = null; filters = null; status = null; }, { once: true });
    const pending = connectByIp();
    renderPanel(); void pending; void poll();
  }
  function renderFindForm(content) {
    const dialog = panel, form = node("form", "inbox-find-form");
    const name = input("신청할 대장장이 이름", "대장장이 이름을 정확히 입력하세요"), bot = node("div", "inbox-bot");
    name.required = true; name.autocomplete = "off";
    const error = node("p", "inbox-status is-error"); error.hidden = true; error.setAttribute("role", "status");
    let widget, disposed = false;
    createCleanup = () => { disposed = true; widget?.remove(); widget = null; };
    const submit = node("button", "inbox-button is-primary", "신청서 열기"); submit.type = "submit";
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled = true; error.hidden = true;
      try {
        const label = inboxLabel(name.value);
        if (!widget?.token()) throw new Error("봇 확인을 완료해 주세요.");
        const result = await request("/lookup", { method: "POST", body: { name: label, token: widget.token() } });
        if (!disposed && dialog.open) {
          const address = new URL("/", location.origin); address.searchParams.set("inbox", result.room.id);
          location.assign(address.href);
        }
      } catch (e) { if (!disposed) { error.textContent = e.message; error.hidden = false; } }
      finally { if (!disposed) { submit.disabled = false; widget?.reset(); } }
    });
    form.append(name, bot, error, submit);
    content.append(form);
    void botWidget(bot, "inbox_lookup").then(value => { if (disposed) value?.remove(); else widget = value; }).catch(e => { if (!disposed) { error.textContent = e.message; error.hidden = false; } });
  }
  function renderCreateForm(content) {
    if (rooms.length) return;
    const dialog = panel;
    const name = input("대장장이 이름", "예: OO장이"), bot = node("div", "inbox-bot"), error = node("p", "inbox-status is-error");
    error.setAttribute("role", "status"); let widget, disposed = false;
    createCleanup = () => { disposed = true; widget?.remove(); widget = null; };
    const submit = button("대장장이 예약 열기", async () => {
      submit.disabled = true;
      try {
        const label = inboxLabel(name.value);
        const create = async () => {
          if (!dialog.open || disposed) return;
          const existing = readRooms();
          if (existing.length) { rooms = existing; changeRoom(rooms[0]); return; }
          await connectByIp();
          if (room || !dialog.open || disposed) return;
          if (!widget?.token()) throw new Error("봇 확인을 완료해 주세요.");
          // Do not create an inbox this browser cannot remember.
          const storageProbe = `${ROOMS_KEY}:probe`;
          try { localStorage.setItem(storageProbe, "0".repeat(512)); localStorage.removeItem(storageProbe); }
          catch { throw new Error("브라우저에 대장장이 정보를 저장할 수 없습니다. 사이트 저장 공간을 확인해 주세요."); }
          const next = await request("", { method: "POST", body: { name: label, token: widget.token() } });
          const previous = rooms; rooms = [next, ...rooms];
          try { persistRooms(); } catch (e) {
            try { await request(`/${next.id}`, { room: next, method: "DELETE" }); rooms = previous; }
            catch { changeRoom(next); message(e.message, true); return; }
            throw e;
          }
          changeRoom(next);
        };
        // Serialize creation across tabs belonging to this browser.
        if (navigator.locks) await navigator.locks.request(ROOMS_KEY, create);
        else await create();
      } catch (e) { error.textContent = e.message; }
      finally { submit.disabled = false; if (!disposed) widget?.reset(); }
    }, "inbox-button is-primary");
    content.append(node("p", "inbox-help inbox-create-help", "대장장이 진행자만 생성하세요.\n대장장이 요청이 12시간 동안 없으면 자동 종료됩니다."), name, bot, error, submit);
    void botWidget(bot, "inbox_create").then(value => { if (disposed) value?.remove(); else widget = value; }).catch(e => { if (!disposed) error.textContent = e.message; });
  }
  if (room) void poll();

  const applicantId = new URL(location.href).searchParams.get("inbox");
  if (!room && !/^[a-f0-9]{24}$/u.test(applicantId ?? "")) void connectByIp();
  if (/^[a-f0-9]{24}$/u.test(applicantId ?? "")) {
    launch.hidden = true;
    const banner = node("section", "inbox-application");
    const label = node("strong", "", "대장장이 정보를 확인하고 있습니다…");
    const help = node("p", "inbox-help", "장비와 목표를 설정 한 후 신청 버튼을 누르세요.");
    const feedback = node("p", "inbox-application__status inbox-status is-error"); feedback.hidden = true; feedback.setAttribute("role", "status");
    let applicantToken, targetRoom = null, mine = null, completed = null, completionTimer, ipRestricted = false, ipRestriction = null, banned = false, blocked = false, editing = null, refreshing = null, applicationTimer, busy = false, unavailable = false;
    help.setAttribute("role", "status"); help.setAttribute("aria-live", "polite");
    const submit = button("신청", () => void act(), "inbox-button is-primary"); submit.disabled = true;
    const cancel = button("수정 취소", () => { stopEditing(); void refreshApplication(); }); cancel.hidden = true;
    const withdraw = button("신청 철회", () => void withdrawApplication()); withdraw.hidden = true;
    const view = button("신청 장비 보기", async () => {
      if (!await refreshApplication() || !mine) return;
      const { content } = modal(`${mine.nickname} · 신청 장비`, view, true);
      content.append(node("pre", "inbox-equipment", formatEquipmentText(inboxItems(mine.items))));
    }); view.hidden = true;
    const actions = node("div", "inbox-application__actions"); actions.append(view, submit, cancel, withdraw);
    banner.append(label, help, actions, feedback);
    document.querySelector("[data-startup-application]")?.remove();
    head.after(banner);
    if (import.meta.env.VITE_INBOX_API_BASE) {
      const credit = node("a", "inbox-geo-credit", "IP Geolocation by DB-IP");
      credit.href = "https://db-ip.com/"; credit.target = "_blank"; credit.rel = "noopener noreferrer";
      const nexonCredit = document.querySelector('.site-footer a[href="https://openapi.nexon.com/ko/"]');
      if (nexonCredit) nexonCredit.after(document.createTextNode(" · "), credit);
      else (document.querySelector(".site-footer") ?? banner.parentElement).append(credit);
    }
    const showError = (error) => { feedback.textContent = error?.message ?? ""; feedback.hidden = !error; };
    function renderApplication() {
      clearTimeout(completionTimer);
      const completionRemaining = !mine && Number.isFinite(completed?.completedAt) ? (completed.localExpiresAt ?? completed.completedAt + 300000) - Date.now() : 0;
      if (completionRemaining > 0) completionTimer = setTimeout(() => { completed = null; renderApplication(); }, completionRemaining);
      const remainingEdits = Math.max(0, INBOX_EDIT_LIMIT - (mine?.version ?? 0));
      help.hidden = unavailable || (targetRoom?.accepting === false && !mine && completionRemaining <= 0); actions.hidden = unavailable;
      if (targetRoom) label.textContent = targetRoom.accepting ? `${targetRoom.name} 신청서` : "지금은 접수를 받지 않는 상태입니다.";
      submit.textContent = editing ? "수정 저장" : mine?.status === "waiting" ? "신청 수정" : mine ? "진행중" : blocked ? "접수됨" : "신청";
      submit.disabled = busy || banned || ipRestricted || !targetRoom?.accepting || (mine ? mine.status !== "waiting" || remainingEdits === 0 : blocked) || Boolean(editing && (!mine || editing.id !== mine.id || editing.version !== mine.version));
      withdraw.hidden = mine?.status !== "waiting"; withdraw.disabled = busy;
      view.hidden = !mine; view.disabled = busy;
      cancel.hidden = !editing; cancel.disabled = busy;
      help.textContent = ipRestricted ? ipRestriction === "foreign" ? "해외 IP에서는 대장장이를 신청할 수 없습니다. 한국 IP로 접속해 주세요." : "신청 불가능한 IP입니다. iCloud 비공개 릴레이를 끈 후 다시 접속해 주세요." : banned ? "이번 대장장이에서는 신청이 차단되었습니다." : mine?.status === "waiting" && remainingEdits === 0 ? "수정 기회 5회를 모두 사용했습니다. 대기중인 신청은 철회할 수 있습니다."
        : editing ? `장비와 목표를 수정한 후 수정 저장 버튼을 누르세요. · 수정 ${remainingEdits}회 남음` : mine?.status === "waiting" ? `대기중인 신청이 있습니다. 신청 수정 또는 철회를 선택하세요. · 수정 ${remainingEdits}회 남음`
        : mine ? "신청이 진행중입니다." : completionRemaining > 0 ? "신청한 장비의 대장장이가 완료되었습니다." : blocked ? "이미 접수한 신청이 있습니다." : "장비와 목표를 설정 한 후 신청 버튼을 누르세요.";
    }
    function stopEditing() { if (editing) adapter.leaveRequest(); editing = null; renderApplication(); }
    async function refreshApplication() {
      clearTimeout(applicationTimer);
      if (!applicantToken || unavailable || document.hidden) return false;
      if (refreshing) return refreshing;
      refreshing = (async () => {
        try {
          const data = await request(`/${applicantId}/my-request`, { applicantToken });
          targetRoom = data.room; mine = data.application; completed = data.completed ?? null; blocked = data.blocked; banned = data.banned === true; ipRestricted = data.ipRestricted === true; ipRestriction = data.ipRestriction ?? null;
          if(completed && Number.isFinite(completed.remainingMs))completed.localExpiresAt=Date.now()+Math.max(0,Math.min(300000,completed.remainingMs));
          renderApplication(); return true;
        } catch (error) {
          showError(error); submit.disabled = true;
          if (error.status === 404 || error.status === 410) {
            unavailable = true; targetRoom = null; mine = null; label.textContent = "이미 종료된 대장장이입니다.";
            stopEditing(); showError(null);
          }
          return false;
        } finally {
          refreshing = null;
          if (!unavailable && (mine || targetRoom === null) && !document.hidden) applicationTimer = setTimeout(() => void refreshApplication(), 10000);
        }
      })();
      return refreshing;
    }
    async function act() {
      showError(null);
      const intendedEdit = !editing && mine?.status === "waiting";
      if (!await refreshApplication() || submit.disabled) return;
      if (intendedEdit) {
        if (mine?.status !== "waiting") return;
        editing = { id: mine.id, version: mine.version, nickname: mine.nickname };
        enableCalculatorStoragePersistence();
        adapter.openRequest(`applicant:${applicantId}:${mine.id}`, inboxItems(mine.items), null, () => {});
        renderApplication(); return;
      }
      if (!editing && (mine || blocked)) return;
      application();
    }
    async function withdrawApplication() {
      if (!mine || mine.status !== "waiting" || !window.confirm("대기중인 신청을 철회할까요?")) return;
      const id = mine.id; busy = true; showError(null); renderApplication();
      try { await request(`/${applicantId}/my-request`, { method: "DELETE", applicantToken, body: { id } }); stopEditing(); }
      catch (error) { showError(error); }
      finally { busy = false; await refreshApplication(); }
    }
    async function connectApplicant() {
      try {
        applicantToken = await clientToken();
        await refreshApplication();
      } catch { showError(new Error("브라우저에 신청 정보를 저장할 수 없습니다. 사이트 저장 공간을 확인해 주세요.")); }
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshApplication(); else clearTimeout(applicationTimer); });
    window.addEventListener("focus", () => void refreshApplication());
    void connectApplicant();
    function application() {
      let items;
      try { items = inboxItems(adapter.getItems()); } catch (error) { showError(error); return; }
      const edit = editing ? { ...editing } : null;
      const { dialog, content } = modal(edit ? "신청 수정" : "장비 신청", submit, true);
      const nickname = input("신청자 닉네임", "닉네임", 20); nickname.value = edit?.nickname ?? adapter.getCharacterName();
      const preview = node("pre", "inbox-equipment", formatEquipmentText(items));
      const bot = node("div", "inbox-bot"), error = node("p", "inbox-status"); error.setAttribute("role", "status");
      let widget; const id = edit?.id ?? crypto.randomUUID();
      const send = button(edit ? "수정 저장" : "신청 보내기", async () => {
        try {
          const name = inboxLabel(nickname.value, 20);
          if (!widget?.token()) throw new Error("봇 확인을 완료해 주세요.");
          send.disabled = true;
          await request(`/${applicantId}/${edit ? "my-request" : "requests"}`, { method: edit ? "PATCH" : "POST", applicantToken,
            body: { id, nickname: name, items, ...(edit ? { version: edit.version } : {}), token: widget.token() } });
          if (edit) stopEditing();
          await refreshApplication();
          content.replaceChildren(node("strong", "", edit ? "신청이 수정되었습니다." : "신청이 접수되었습니다."), button("닫기", () => dialog.close()));
          widget?.remove(); widget = null;
        } catch (e) {
          error.textContent = e.message;
          if ([404, 409, 410].includes(e.status)) void refreshApplication();
        }
        finally { send.disabled = false; widget?.reset(); }
      }, "inbox-button is-primary");
      content.append(node("strong", "", targetRoom.name), nickname, preview);
      content.append(bot, error, send);
      dialog.addEventListener("close", () => widget?.remove(), { once: true });
      void botWidget(bot, "inbox_submit").then(value => { widget = value; }).catch(e => { error.textContent = e.message; });
    }
  }
}
