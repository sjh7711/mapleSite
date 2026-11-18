import { formatEquipmentText } from "../shared/starforce-equipment-text.js";

const statuses = {waiting:"대기중",working:"진행중",done:"완료",blocked:"차단됨"};

export function createInboxRequestDetails(room,{node,date,api,live=false,onBlock}) {
  const details=node("details","admin-history-details"),body=node("div","admin-history-body");
  const count=room.requestCount ?? room.waiting+room.working+room.done;
  const heading=node("summary","",`신청 내역 보기 · ${count}건`);
  details.append(heading,body);
  details.dataset.roomId=room.id;
  const section=node("div","admin-request-section");
  const refresh=node("button","admin-request-refresh");refresh.type="button";
  refresh.setAttribute("aria-label","신청 내역 새로고침");
  refresh.append(node("span","admin-request-refresh__prefix","신청 내역 "),document.createTextNode("새로고침"));
  if(live) {
    section.append(details,refresh);
    refresh.onclick=()=>{if(!details.open)details.open=true;else void load(page);};
  }
  let loaded=false,loading=false,page=0;
  async function load(requestedPage) {
    if(loading)return;loading=true;
    refresh.dataset.loading="true";refresh.disabled=true;
    body.replaceChildren(node("p","admin-message","신청 내역을 불러오는 중입니다."));
    try {
      const response=await api(`/api/admin/blacksmith-inboxes/${live?`${room.id}/requests`:`history/${room.id}`}?page=${requestedPage}`,{signal:AbortSignal.timeout(15000)});
      if(!details.isConnected)return;
      page=response.page;loaded=true;heading.textContent=`신청 내역 보기 · ${response.total}건`;body.replaceChildren();
      const records=node("div","admin-history-records");
      for(const application of response.requests) {
        const record=node("article","admin-history-request"),head=node("div","admin-inbox-heading");
        head.append(node("strong","",application.nickname),node("span","admin-inbox-badge",statuses[application.status]??application.status));
        if(live && onBlock) {
          const unblocking=application.status==="blocked";
          const block=node("button","admin-applicant-block admin-danger",unblocking?"차단 해제":"차단");block.type="button";
          block.setAttribute("aria-label",`${application.nickname} 신청 ${unblocking?"차단 해제":"차단"}`);
          if((!unblocking&&!application.canBlock) || room.expired) {
            block.dataset.blockUnavailable="true";block.disabled=true;
            block.title=room.expired?"종료된 대장장이는 차단할 수 없습니다.":"이전 신청의 식별 정보가 없어 차단할 수 없습니다.";
          }
          block.onclick=()=>void onBlock(application);
          head.append(block);
        }
        const time=node("time","",date(application.createdAt));time.dateTime=new Date(application.createdAt).toISOString();
        const meta=node("p","admin-inbox-counts");meta.append(time,document.createTextNode(` · 장비 ${application.itemCount}개 · 수정 ${application.editCount}회`));
        let equipment;
        try {equipment=formatEquipmentText(application.items);}
        catch {equipment="이전 장비 정보를 표시할 수 없습니다.";}
        record.append(head,meta,node("pre","admin-history-equipment",equipment));records.append(record);
      }
      if(!response.requests.length)records.append(node("p","admin-inbox-empty","접수 내역이 없습니다."));
      body.append(records);
      if(response.pages>1) {
        const navigation=node("div","admin-inbox-pagination"),prev=node("button","","이전"),next=node("button","","다음");prev.type=next.type="button";
        prev.disabled=page===0;next.disabled=page+1>=response.pages;prev.onclick=()=>void load(page-1);next.onclick=()=>void load(page+1);
        navigation.append(prev,node("span","",`${page+1} / ${response.pages}`),next);body.append(navigation);
      }
    } catch(error) {
      if(details.isConnected && error.name!=="AbortError") {
        const retry=node("button","","다시 불러오기");retry.type="button";retry.onclick=()=>void load(requestedPage);
        body.replaceChildren(node("p","admin-message",error.message),retry);
      }
    } finally {loading=false;refresh.dataset.loading="false";refresh.disabled=false;}
  }
  details.addEventListener("toggle",()=>{if(details.open&&(!loaded||live))void load(0);});
  return live?section:details;
}
