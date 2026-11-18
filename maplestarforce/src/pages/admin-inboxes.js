import { renderInboxHistory } from "./admin-inbox-history.js";
import { createInboxRequestDetails } from "./admin-inbox-requests.js";

const endpoint = "/api/admin/blacksmith-inboxes";
const list = document.querySelector("#admin-inboxes"), summary = document.querySelector("#inbox-summary");
const message = document.querySelector("#admin-message"), form = document.querySelector("#inbox-search");
const search = document.querySelector("#inbox-query"), filter = document.querySelector("#inbox-status");
const sort = document.querySelector("#inbox-sort");
const reload = document.querySelector("#inbox-reload"), previous = document.querySelector("#inbox-prev"), next = document.querySelector("#inbox-next");
const pageLabel = document.querySelector("#inbox-page");
const blockList = document.querySelector("#inbox-blocks"), blockCount = document.querySelector("#inbox-block-count");
const blockPrevious = document.querySelector("#inbox-block-prev"), blockNext = document.querySelector("#inbox-block-next"), blockPageLabel = document.querySelector("#inbox-block-page");
let page = 0, pages = 1, loading = false, changing = false, generation = 0, controller, searchTimer;
let blockPage = 0, blockPages = 1;
let historyView=false;
const currentView=document.querySelector("#inbox-current-view"),historyButton=document.querySelector("#inbox-history-view");

function node(tag, className = "", text = "") {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function notify(text, error = false) { message.textContent = text; message.dataset.error = String(error); }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options,
    headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) location.replace("/admin/login/");
    const error = new Error(data?.error ?? "대장장이 관리에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    error.status = response.status; throw error;
  }
  return data;
}
const date = value => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
function updateControls() {
  reload.disabled = loading || changing; previous.disabled = loading || changing || page<=0;
  next.disabled = loading || changing || page+1>=pages;
  blockPrevious.disabled = loading || changing || blockPage<=0; blockNext.disabled = loading || changing || blockPage+1>=blockPages;
  search.disabled = changing; filter.disabled = changing; sort.disabled = changing;
  currentView.disabled=historyButton.disabled=changing;
  for (const button of list.querySelectorAll(".admin-inbox-actions button")) button.disabled = loading || changing;
  for (const button of list.querySelectorAll("button[data-ip-unknown]")) button.disabled = true;
  for (const button of list.querySelectorAll(".admin-applicant-block,.admin-request-refresh")) button.disabled = loading || changing || button.dataset.loading === "true" || button.dataset.blockUnavailable === "true";
  for (const button of blockList.querySelectorAll("button")) button.disabled = loading || changing;
}
async function changeIp(room, block) {
  if (loading || changing) return;
  if (!confirm(block ? `「${room.name}」의 생성 IP에서 새 대장장이 예약을 열지 못하도록 차단할까요?\n같은 IP를 쓰는 사용자에게도 적용됩니다. 기존 대장장이는 유지됩니다.`
    : `「${room.sourceName ?? room.name}」의 IP 차단을 해제할까요?`)) return;
  changing = true; clearTimeout(searchTimer); updateControls();
  try {
    await api(block ? `${endpoint}/${room.id}/block-creator-ip` : `${endpoint}/blocked-ips/${room.creatorIpBlockId ?? room.id}`, {
      method:block ? "POST" : "DELETE", signal:AbortSignal.timeout(15000), body:JSON.stringify(block ? { revision:room.revision } : {}),
    });
    await load(block ? "IP를 차단했습니다." : "IP 차단을 해제했습니다.");
  } catch (error) {
    if ([404,409].includes(error.status)) await load();
    notify(error.message,true);
  } finally { changing = false; updateControls(); }
}
async function blockApplicant(room, application) {
  if (loading || changing) return;
  const unblocking=application.status==="blocked";
  if (!confirm(unblocking?`${application.nickname}님의 차단을 해제할까요? 차단 기록은 목록에서 제거됩니다.`:`${application.nickname}님의 신청을 거절하고 이번 대장장이의 재신청을 차단할까요?`)) return;
  changing=true;clearTimeout(searchTimer);updateControls();
  try {
    await api(`${endpoint}/${room.id}/requests/${application.id}/block`,{method:unblocking?"DELETE":"POST",signal:AbortSignal.timeout(15000),body:JSON.stringify(unblocking?{blockedAt:application.blockedAt}:{version:application.editCount})});
    await load(unblocking?"신청자 차단을 해제했습니다.":"신청자를 차단했습니다.");
    const details=list.querySelector(`details[data-room-id="${room.id}"]`);
    if(details)details.open=true;
  } catch(error) {
    if([404,409,410].includes(error.status))await load();
    notify(error.message,true);
  } finally {changing=false;updateControls();}
}
async function change(room, accepting) {
  if (loading || changing) return;
  const discard = accepting === undefined;
  if (discard && !confirm(`「${room.name}」 대장장이를 종료할까요?\n대기 ${room.waiting}건 · 진행 ${room.working}건 · 완료 ${room.done}건이 종료 이력에 3일 동안 보관됩니다. 대기열과 진행 중 작업은 종료됩니다.`)) return;
  changing = true; clearTimeout(searchTimer); updateControls();
  try {
    await api(`${endpoint}/${room.id}`, { method: discard ? "DELETE" : "PATCH", signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ revision: room.revision, ...(discard ? {} : { accepting }) }) });
    await load(discard ? "대장장이를 종료했습니다." : accepting ? "접수를 재개했습니다." : "접수를 일시 중지했습니다.");
  } catch (error) {
    // Refresh stale counts and revisions before another destructive action.
    if ([404,409,410].includes(error.status)) await load();
    notify(error.message, true);
  } finally { changing = false; updateControls(); }
}
function render(data) {
  if(historyView) {
    renderInboxHistory(data,{summary,list,node,date,api});
    page=data.page;pages=data.pages;pageLabel.textContent=`${page+1} / ${pages} · ${data.total}개`;
    return;
  }
  summary.replaceChildren(...[["활성 대장장이",`${data.summary.active} / ${data.summary.limit}`],["접수 중",data.summary.accepting],["접수 일시 중지",data.summary.paused],["자동 종료",data.summary.expired]].map(([label,value]) => {
    const box = node("div"); box.append(node("span","",label),node("strong","",String(value))); return box;
  }));
  list.replaceChildren(...data.inboxes.map(room => {
    const article = node("article","admin-inbox"), main = node("div","admin-inbox-main");
    const heading = node("div","admin-inbox-heading"), badge = node("span","admin-inbox-badge",room.expired ? "자동 종료" : room.accepting ? "접수 중" : "접수 일시 중지");
    badge.dataset.state = room.expired ? "expired" : room.accepting ? "accepting" : "paused";
    heading.append(node("h2","",room.name),badge);
    main.append(heading,node("p","admin-inbox-counts",`대기 ${room.waiting}건 · 진행 ${room.working}건 · 완료 ${room.done}건`));
    const times = node("div","admin-inbox-times");
    for (const pairs of [
      [["생성",room.createdAt],[room.expired ? "자동 종료" : "자동 종료 예정",room.expiresAt]],
      [["최근 신청",room.lastSubmittedAt],["최근 완료",room.lastCompletedAt]],
    ]) {
      const line = node("div","admin-inbox-time-row");
      for (const [label,value] of pairs) {
        const field = node("span","admin-inbox-time-field"), time = node(value == null ? "span" : "time","",value == null ? "—" : date(value));
        if (value != null) time.dateTime = new Date(value).toISOString();
        field.append(node("span","",label),time); line.append(field);
      }
      times.append(line);
    }
    const actions = node("div","admin-inbox-actions");
    const ipAction = node("button",room.creatorIpBlockId ? "" : "admin-danger",room.creatorIpBlockId ? "IP 차단 해제" : "IP 차단");
    ipAction.type = "button"; ipAction.setAttribute("aria-label",`${room.name} ${ipAction.textContent}`);
    if (!room.creatorIpKnown) { ipAction.dataset.ipUnknown = "true"; ipAction.title = "이전 대장장이에는 생성 IP 기록이 없습니다."; }
    ipAction.onclick = () => void changeIp(room,!room.creatorIpBlockId); actions.append(ipAction);
    if (!room.expired) {
      const toggle = node("button","",room.accepting ? "접수 일시 중지" : "접수 재개"); toggle.type = "button";
      toggle.setAttribute("aria-label",`${room.name} ${toggle.textContent}`); toggle.onclick = () => void change(room,!room.accepting); actions.append(toggle);
    }
    const discard = node("button","admin-danger","대장장이 종료"); discard.type = "button";
    discard.setAttribute("aria-label",`${room.name} 대장장이 종료`); discard.onclick = () => void change(room); actions.append(discard);
    article.append(main,times,actions,createInboxRequestDetails(room,{node,date,api,live:true,onBlock:application=>blockApplicant(room,application)})); return article;
  }));
  if (!data.inboxes.length) list.append(node("p","admin-inbox-empty",search.value.trim() ? "검색 결과가 없습니다." : "대장장이가 없습니다."));
  page = data.page; pages = data.pages; pageLabel.textContent = `${page+1} / ${pages} · ${data.total}개`;
}
function renderBlocks(data) {
  blockCount.textContent = `(${data.total})`;
  blockList.replaceChildren(...data.blocks.map(block => {
    const row = node("div","admin-inbox-block"), text = node("div");
    const time = node("time","",date(block.blockedAt)); time.dateTime = new Date(block.blockedAt).toISOString();
    text.append(node("strong","",block.sourceName),node("span",""," 생성 IP · 차단 "),time);
    const remove = node("button","","차단 해제"); remove.type = "button"; remove.onclick = () => void changeIp(block,false);
    row.append(text,remove); return row;
  }));
  if (!data.blocks.length) blockList.append(node("p","admin-description","차단한 IP가 없습니다."));
  blockPage=data.page; blockPages=data.pages; blockPageLabel.textContent=`${blockPage+1} / ${blockPages}`;
}
async function load(notice) {
  controller?.abort(); const epoch = ++generation; controller = new AbortController();
  loading = true; updateControls(); notify(historyView?"종료 이력을 불러오는 중입니다.":"대장장이를 불러오는 중입니다.");
  const params = new URLSearchParams({ page:String(page), [historyView?"reason":"status"]:filter.value, sort:sort.value, q:search.value.trim() });
  try {
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
    const [data,blocks] = await Promise.all([api(`${endpoint}${historyView?"/history":""}?${params}`,{ signal }),historyView?Promise.resolve(null):api(`${endpoint}/blocked-ips?page=${blockPage}`,{ signal })]);
    if (epoch !== generation) return;
    render(data); if(blocks)renderBlocks(blocks); notify(notice ?? (historyView?"종료 이력을 불러왔습니다.":"대장장이 현황을 불러왔습니다."));
  } catch (error) {
    if (epoch === generation && error.name !== "AbortError") notify(error.message,true);
  } finally { if (epoch === generation) { loading = false; updateControls(); } }
}
form.addEventListener("submit", event => { event.preventDefault(); clearTimeout(searchTimer); if (!changing) void load(); });
search.addEventListener("input", () => { page = 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!changing) void load(); },300); });
for (const control of [filter,sort]) control.addEventListener("change", () => { page = 0; clearTimeout(searchTimer); void load(); });
previous.onclick = () => { page = Math.max(0,page-1); void load(); };
next.onclick = () => { page += 1; void load(); };
blockPrevious.onclick = () => { blockPage=Math.max(0,blockPage-1); void load(); };
blockNext.onclick = () => { blockPage+=1; void load(); };
document.querySelector("#admin-logout").onclick = async () => {
  try { await api("/api/admin/session",{ method:"DELETE" }); location.replace("/admin/login/"); }
  catch (error) { notify(error.message,true); }
};
function setView(history) {
  if(changing)return;
  historyView=history;page=0;clearTimeout(searchTimer);
  currentView.setAttribute("aria-pressed",String(!history));historyButton.setAttribute("aria-pressed",String(history));
  document.querySelector("#inbox-history-help").hidden=!history;
  document.querySelector(".admin-inbox-blocks").hidden=history;
  document.querySelector("#inbox-filter-label").textContent=history?"종료 구분":"접수 상태";
  filter.replaceChildren(...(history?[["all","전체"],["owner","진행자 종료"],["admin","관리자 종료"],["expired","자동 종료"]]:[["all","전체"],["accepting","접수 중"],["paused","접수 일시 중지"],["expired","자동 종료"]]).map(([value,label])=>new Option(label,value)));
  sort.replaceChildren(...(history?[["ended","최근 종료 순"],["created","최근 생성 순"],["completed","최근 완료 순"]]:[["created","최근 생성 순"],["submitted","최근 신청 순"],["completed","최근 완료 순"]]).map(([value,label])=>new Option(label,value)));
  const url=new URL(location.href);if(history)url.searchParams.set("view","history");else url.searchParams.delete("view");window.history.replaceState(null,"",url);
  void load();
}
currentView.onclick=()=>setView(false);historyButton.onclick=()=>setView(true);
setView(new URL(location.href).searchParams.get("view")==="history");
