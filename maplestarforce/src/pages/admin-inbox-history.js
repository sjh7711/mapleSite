import { createInboxRequestDetails } from "./admin-inbox-requests.js";

const reasons = {owner:"진행자 종료",admin:"관리자 종료",expired:"자동 종료"};

export function renderInboxHistory(data,{summary,list,node,date,api}) {
  summary.replaceChildren(...[["종료 대장장이",data.summary.total],["진행자 종료",data.summary.owner],["관리자 종료",data.summary.admin],["자동 종료",data.summary.expired]].map(([label,value])=>{
    const box=node("div");box.append(node("span","",label),node("strong","",String(value)));return box;
  }));
  list.replaceChildren(...data.inboxes.map(room=>{
    const article=node("article","admin-inbox admin-inbox--history"),main=node("div","admin-inbox-main");
    const heading=node("div","admin-inbox-heading"),badge=node("span","admin-inbox-badge",reasons[room.endReason]);
    heading.append(node("h2","",room.name),badge);
    main.append(heading,node("p","admin-inbox-counts",`신청 ${room.requestCount}건 · 장비 ${room.itemCount}개 · 대기 ${room.waiting}건 · 진행 ${room.working}건 · 완료 ${room.done}건`));
    const times=node("div","admin-inbox-times");
    for(const pairs of [[["생성",room.createdAt],["종료",room.endedAt]],[["최근 신청",room.lastSubmittedAt],["최근 완료",room.lastCompletedAt]],[["보관 기한",room.retainUntil]]]) {
      const line=node("div","admin-inbox-time-row");
      for(const [label,value] of pairs) {
        const field=node("span","admin-inbox-time-field"),time=node(value==null?"span":"time","",value==null?"—":date(value));
        if(value!=null)time.dateTime=new Date(value).toISOString();field.append(node("span","",label),time);line.append(field);
      }
      times.append(line);
    }
    const details=createInboxRequestDetails(room,{node,date,api});
    article.append(main,times,details);return article;
  }));
  if(!data.inboxes.length)list.append(node("p","admin-inbox-empty","종료 이력이 없습니다."));
}
