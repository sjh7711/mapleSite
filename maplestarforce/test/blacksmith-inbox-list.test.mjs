import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxRequestsForView } from "../src/shared/blacksmith-inbox-list.js";

const queue = [
  { id: "older-done", status: "done", createdAt: 10 },
  { id: "third", status: "waiting", createdAt: 40 },
  { id: "newer-done", status: "done", createdAt: 50 },
  { id: "first", status: "waiting", createdAt: 20 },
  { id: "second", status: "working", createdAt: 30 },
];
const ids = rows => rows.map(row => row.id);

test("대기·진행은 같은 순위로 접수순을 유지하고, 완료 내역은 그 아래에 최신 신청부터 표시한다", () => {
  assert.deepEqual(ids(inboxRequestsForView(queue)), ["first", "second", "third", "newer-done", "older-done"]);
  assert.deepEqual(ids(queue), ["older-done", "third", "newer-done", "first", "second"]);
});
test("대기를 진행으로 바꿔도 자리를 유지하며, 완료하면 다른 미완료 신청 아래로 이동한다", () => {
  const started = queue.map(row => row.id === "first" ? { ...row, status: "working" } : row);
  assert.deepEqual(ids(inboxRequestsForView(started)), ids(inboxRequestsForView(queue)));
  const finished = started.map(row => row.id === "first" ? { ...row, status: "done" } : row);
  assert.deepEqual(ids(inboxRequestsForView(finished)), ["second", "third", "newer-done", "first", "older-done"]);
});
test("필터는 해당 상태만 표시하며 각 상태의 시간순을 유지한다", () => {
  assert.deepEqual(ids(inboxRequestsForView(queue, "waiting")), ["first", "third"]);
  assert.deepEqual(ids(inboxRequestsForView(queue, "working")), ["second"]);
  assert.deepEqual(ids(inboxRequestsForView(queue, "done")), ["newer-done", "older-done"]);
  assert.deepEqual(inboxRequestsForView([], "done"), []);
});
test("접수 시각이 같아도 서버 응답 배열 순서에 따라 위치가 흔들리지 않는다", () => {
  const ties = [{ id: "b", status: "waiting", createdAt: 20 }, { id: "a", status: "working", createdAt: 20 }];
  assert.deepEqual(ids(inboxRequestsForView(ties)), ids(inboxRequestsForView([...ties].reverse())));
});
test("닉네임 부분 검색은 대소문자·유니코드 정규화를 처리하고 상태 필터·정렬과 함께 적용된다", () => {
  const rows=queue.map((row,i)=>({...row,nickname:["AB완료","말랑","ab최근","AB대기","그네"][i]}));
  assert.deepEqual(ids(inboxRequestsForView(rows,null," ab ")), ["first","newer-done","older-done"]);
  assert.deepEqual(ids(inboxRequestsForView(rows,"done","AB")), ["newer-done","older-done"]);
  assert.deepEqual(ids(inboxRequestsForView(rows,"waiting","말랑")), ["third"]);
  assert.deepEqual(inboxRequestsForView(rows,null,"없음"),[]);
  assert.equal(inboxRequestsForView([{id:"1",nickname:"말랑",status:"waiting",createdAt:1}],null,"말랑".normalize("NFD")).length,1);
});
test("초성·이름 일부·섞어 쓴 검색어 모두 해당 닉네임을 찾고 상태 필터와 정렬을 유지한다", () => {
  const rows=[
    {id:"done",nickname:"신청자AB",status:"done",createdAt:10},
    {id:"waiting",nickname:"신청자",status:"waiting",createdAt:20},
    {id:"other",nickname:"다른사람",status:"waiting",createdAt:30},
    {id:"double",nickname:"까치",status:"working",createdAt:40},
  ];
  for(const query of ["ㅅㅊㅈ","ㅊㅈ","신ㅊ자","신청ㅈ"]) assert.deepEqual(ids(inboxRequestsForView(rows,null,query)),["waiting","done"]);
  assert.deepEqual(ids(inboxRequestsForView(rows,"done","ㅅㅊㅈ")),["done"]);
  assert.deepEqual(ids(inboxRequestsForView(rows,null,"ㅅㅊㅈab")),["done"]);
  assert.deepEqual(ids(inboxRequestsForView(rows,null,"ㄲㅊ")),["double"]);
  for(const query of ["ㅅㅊㅈㄱ","ㄱㅊ","ㅅㅈㅊ","ㅏ"]) assert.deepEqual(inboxRequestsForView(rows,null,query),[]);
});

test('차단 기록은 별도 필터 없이 완료 아래에 남고 검색과 같은 접수순 정렬을 적용한다',()=>{
  const blocked=[{id:'blocked-old',nickname:'차단',status:'blocked',createdAt:5},{id:'blocked-new',nickname:'차단',status:'blocked',createdAt:60}];
  const rows=queue.map(item=>({...item,nickname:'신청'})).concat(blocked);
  assert.deepEqual(ids(inboxRequestsForView(rows)),['first','second','third','newer-done','older-done','blocked-new','blocked-old']);
  assert.deepEqual(ids(inboxRequestsForView(rows,'waiting')),['first','third','blocked-new','blocked-old']);
  assert.deepEqual(ids(inboxRequestsForView(rows,'done','ㅊㄷ')),['blocked-new','blocked-old']);
});
