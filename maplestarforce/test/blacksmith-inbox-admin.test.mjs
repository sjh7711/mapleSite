import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, after, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const base='https://preview.starforce.test', endpoint='/api/admin/blacksmith-inboxes';
const password='fixture-only-admin-inboxes-password', ownerToken='a'.repeat(64);
let mf, db, config, activityMigrationSnapshot;
before(async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const bundle=await build({stdin:{resolveDir:root,contents:`
    import {onRequest as inboxes} from './functions/api/admin/blacksmith-inboxes/[[path]].ts';
    import {onRequest as session} from './functions/api/admin/session.ts';
    import {onRequest as middleware} from './functions/admin/_middleware.ts';
    import {onRequest as page} from './functions/admin/blacksmith-inboxes.ts';
    import {onRequest as publicApi} from './functions/api/blacksmith-inboxes/[[path]].ts';
    export default {fetch(request,env) {
      const url=new URL(request.url), path=url.pathname;
      if (url.searchParams.has('disabled')) env={...env,STARFORCE_INBOX_ENABLED:'false'};
      if (path==='/api/admin/session') return session({request,env});
      if (path.startsWith('/api/admin/blacksmith-inboxes')) return inboxes({request,env});
      if (path.startsWith('/api/blacksmith-inboxes')) return publicApi({request,env});
      return middleware({request,env,next:()=>page({request,env})});
    }};
  `},bundle:true,write:false,format:'esm',platform:'browser',plugins:[{
    name:'private-admin-html-fixture',setup(build) {
      // Page authentication runs unchanged; a plain HTML fixture avoids making
      // API tests depend on Vite's ignored build output. Browser tests use Vite.
      build.onResolve({filter:/\/_generated\/starforce-inbox-admin-page$/},()=>({path:'private-page',namespace:'admin-html-fixture'}));
      build.onLoad({filter:/.*/,namespace:'admin-html-fixture'},()=>({contents:'export default "<html>대장장이 관리</html>"',loader:'js'}));
    },
  }]});
  mf=new Miniflare(convertV4MiniflareOptions({name:'inbox-admin-tests',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:'2026-08-29',d1Databases:['STARFORCE_CONFIG','STARFORCE_INBOX_DB'],
    serviceBindings:{INBOX_TRAFFIC:async()=>new Response(null,{status:204})},
    bindings:{STARFORCE_INBOX_ENABLED:'true',TURNSTILE_SITEKEY:'fixture',TURNSTILE_SECRET:'fixture',STARFORCE_ADMIN_PASSWORD_HASH:createHash('sha256').update(password).digest('hex')},
    outboundService:async request=>{
      assert.equal(request.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const token=new URLSearchParams(await request.text()).get('response');
      return Response.json({success:token?.startsWith('admin-create-'),action:'inbox_create',hostname:'preview.starforce.test'});
    }}));
  db=await mf.getD1Database('STARFORCE_INBOX_DB');config=await mf.getD1Database('STARFORCE_CONFIG');
  const adminSql=await readFile(new URL('../migrations/starforce-prices/0001_initial.sql',import.meta.url),'utf8');
  await config.batch(adminSql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>config.prepare(s)));
  for (const name of ['0001_initial.sql','0002_expiry.sql','0003_applicant.sql','0004_capacity.sql','0005_inbox_names.sql']) {
    const sql=await readFile(new URL('../migrations/blacksmith-inbox/'+name,import.meta.url),'utf8');
    await db.batch(sql.match(/CREATE TRIGGER[\s\S]*?END;|(?:CREATE(?: UNIQUE)? (?:TABLE|INDEX)|ALTER TABLE|UPDATE|DROP TRIGGER|INSERT INTO)[\s\S]*?;/gu).map(s=>db.prepare(s)));
  }
  const old=Date.now()-3600000, latest=old+60000;
  const legacy=await room({name:'이전 완료 기록',createdAt:old,expiresAt:latest+43200000});
  await seedRequest(legacy,'done');
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(latest+43200000,legacy).run();
  const empty=await room({name:'이전 빈 신청함',createdAt:old,expiresAt:old+43200000});
  const activitySql=await readFile(new URL('../migrations/blacksmith-inbox/0006_inbox_activity.sql',import.meta.url),'utf8');
  await db.batch(activitySql.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|UPDATE|DROP TRIGGER)[\s\S]*?;/gu).map(s=>db.prepare(s)));
  activityMigrationSnapshot={legacy:await getRoom(legacy),empty:await getRoom(empty),latest,
    requests:(await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?').bind(legacy).first()).n};
  const blockSql=await readFile(new URL('../migrations/blacksmith-inbox/0007_creator_ip_blocks.sql',import.meta.url),'utf8');
  await db.batch(blockSql.match(/(?:ALTER TABLE|CREATE TABLE)[\s\S]*?;/gu).map(s=>db.prepare(s)));
  const capacitySql=await readFile(new URL('../migrations/blacksmith-inbox/0008_request_capacity.sql',import.meta.url),'utf8');
  await db.batch(capacitySql.match(/CREATE TRIGGER[\s\S]*?END;|(?:DROP TRIGGER|DELETE FROM)[\s\S]*?;/gu).map(s=>db.prepare(s)));
  const historySql=await readFile(new URL('../migrations/blacksmith-inbox/0009_closed_history.sql',import.meta.url),'utf8');
  await db.batch(historySql.match(/CREATE TRIGGER[\s\S]*?END;|(?:CREATE(?: UNIQUE)? (?:TABLE|INDEX)|ALTER TABLE)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const completionSql=await readFile(new URL('../migrations/blacksmith-inbox/0010_request_completion.sql',import.meta.url),'utf8');
  await db.batch(completionSql.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|CREATE INDEX)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const applicantBlocksSql=await readFile(new URL('../migrations/blacksmith-inbox/0011_applicant_blocks.sql',import.meta.url),'utf8');
  await db.batch(applicantBlocksSql.match(/CREATE (?:TABLE|INDEX)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const retainedBlocksSql=await readFile(new URL('../migrations/blacksmith-inbox/0012_retained_applicant_blocks.sql',import.meta.url),'utf8');
  await db.batch(retainedBlocksSql.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|CREATE VIEW|DROP TRIGGER)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
});
after(async()=>{await mf?.dispose();});
beforeEach(async()=>{
  await db.batch([db.prepare('DELETE FROM blacksmith_inboxes'),db.prepare('DELETE FROM blacksmith_inbox_history'),db.prepare('DELETE FROM blacksmith_submissions'),db.prepare('DELETE FROM blacksmith_creator_ip_blocks'),db.prepare('DELETE FROM blacksmith_limits')]);
  await config.batch([config.prepare('DELETE FROM starforce_admin_sessions'),config.prepare('DELETE FROM starforce_admin_attempts')]);
});
async function call(path=endpoint,{method='GET',cookie,body,origin=base,headers={}}={}) {
  return mf.dispatchFetch(base+path,{method,redirect:'manual',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',
    ...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function login(){const r=await call('/api/admin/session',{method:'POST',body:{password}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
async function room({name='대장장이',accepting=1,createdAt=Date.now(),expiresAt=Date.now()+43200000}={}) {
  const id=randomUUID().replaceAll('-','').slice(0,24),ownerHash=createHash('sha256').update(`${id}:${ownerToken}`).digest('hex');
  await db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,creator_hash,accepting,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id,name,ownerHash,'private-creator-hash:'+id,accepting,createdAt,expiresAt).run();
  return id;
}
async function seedRequest(id,status='waiting') {
  const requestId=randomUUID();
  await db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at,applicant_hash,submitter_ip_hash) VALUES (?,?,?,?,1,?,?,?,?,?)')
    .bind(requestId,id,'private-applicant','[{"private":"equipment"}]',requestId,status,Date.now(),'private-applicant-hash:'+requestId,'private-ip-hash:'+requestId).run();
  return requestId;
}
const getRoom=id=>db.prepare('SELECT * FROM blacksmith_inboxes WHERE id=?').bind(id).first();
const createFromIp=(ip,name='IP검증-'+randomUUID().slice(0,12),extraHeaders={})=>call('/api/blacksmith-inboxes',{
  method:'POST',body:{name,token:'admin-create-'+randomUUID()},headers:{'CF-Connecting-IP':ip,'X-Inbox-Client':createHash('sha256').update(randomUUID()).digest('hex'),...extraHeaders},
});

const history=endpoint+'/history';
const savedHistory=id=>db.prepare('SELECT * FROM blacksmith_inbox_history WHERE id=?').bind(id).first();
test('활성 대장장이 신청 상세는 관리자만 조회하며 장비·상태만 반환하고 관리 정보를 변경하지 않는다',async()=>{
  const id=await room({accepting:0}),other=await room(),requestId=await seedRequest(id,'working');
  await seedRequest(other);
  const items=[{presetId:'pitch-belt',itemLevel:200,startStar:12,targetStar:22,quantity:2}];
  await db.prepare('UPDATE blacksmith_requests SET nickname=?,items=?,item_count=2,version=3 WHERE id=?')
    .bind('관리자 확인 신청자',JSON.stringify(items),requestId).run();
  const path=endpoint+'/'+id+'/requests';
  for(const options of [{},{headers:{Authorization:'Bearer '+ownerToken}},{headers:{'X-Inbox-Applicant':ownerToken}}]) assert.equal((await call(path,options)).status,401);
  const cookie=await login(),before=await getRoom(id),response=await call(path,{cookie});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const text=await response.clone().text(),data=await response.json();
  assert.deepEqual(data.room,{id,name:'대장장이'});assert.equal(data.total,1);
  assert.equal(data.requests[0].id,requestId);assert.equal(data.requests[0].status,'working');assert.equal(data.requests[0].canBlock,true);
  assert.equal(data.requests[0].nickname,'관리자 확인 신청자');assert.deepEqual(data.requests[0].items,items);assert.equal(data.requests[0].editCount,3);
  for(const secret of ['private-','owner_hash','creator_hash','applicant_hash','submitter_ip_hash','fingerprint',ownerToken]) assert.ok(!text.includes(secret),secret);
  assert.deepEqual(await getRoom(id),before);
  assert.equal((await call(path,{cookie,method:'POST',body:{}})).status,405);
  assert.equal((await call(path+'?disabled',{cookie})).status,404);
  assert.equal((await call(endpoint+'/'+'f'.repeat(24)+'/requests',{cookie})).status,404);
});
test('관리자 신청자 차단은 이번 대장장이에만 적용하고 신청·예약을 제거하며 횟수와 만료 기한은 유지한다',async()=>{
  const id=await room(),other=await room(),cookie=await login(),requestId=await seedRequest(id,'done');
  const token='c'.repeat(64),ip='192.0.2.11',hash=value=>createHash('sha256').update(value).digest('hex');
  const applicantHash=hash(`applicant:${id}:${token}`),ipHash=hash(`submit-ip:${ip}`);
  await db.prepare('UPDATE blacksmith_requests SET applicant_hash=?,submitter_ip_hash=? WHERE id=?').bind(applicantHash,ipHash,requestId).run();
  await db.prepare('INSERT INTO blacksmith_nickname_claims(inbox_id,nickname_key,applicant_hash,request_id) VALUES (?,?,?,?)').bind(id,'blocked',applicantHash,requestId).run();
  await db.prepare('INSERT INTO blacksmith_submissions(request_id,ip_hash,submitted_at) VALUES (?,?,?)').bind(requestId,ipHash,Date.now()).run();
  const expiry=(await getRoom(id)).expires_at,path=endpoint+'/'+id+'/requests/'+requestId+'/block';
  assert.equal((await call(path,{cookie,method:'POST',body:{version:0}})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests WHERE id=?').bind(requestId).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_nickname_claims WHERE inbox_id=?').bind(id).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_submissions WHERE request_id=?').bind(requestId).first()).n,1);
  assert.equal((await getRoom(id)).expires_at,expiry);assert.ok(await getRoom(other));
  for(const [applicant,visitor] of [[token,ip],['d'.repeat(64),ip],[token,'192.0.2.12']]) {
    const response=await call('/api/blacksmith-inboxes/'+id+'/requests',{method:'POST',headers:{'X-Inbox-Applicant':applicant,'CF-Connecting-IP':visitor},
      body:{id:randomUUID(),nickname:'재접수',items:[{presetId:'giant-fear',itemLevel:200,startStar:12,targetStar:21,quantity:1}]}});
    assert.equal(response.status,403);assert.match((await response.json()).error,/차단/);
  }
  const mine=async roomId=>(await (await call('/api/blacksmith-inboxes/'+roomId+'/my-request',{headers:{'X-Inbox-Applicant':token,'CF-Connecting-IP':ip}})).json());
  assert.equal((await mine(id)).banned,true);assert.equal((await mine(other)).banned,false);
  assert.equal((await call(path,{cookie,method:'POST',body:{version:0}})).status,404);
  await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks WHERE inbox_id=?').bind(id).first()).n,0);
});
test('관리자 차단은 인증·Origin·최신 버전·대상·식별값을 검증하고 실패 시 내역을 보존한다',async()=>{
  const id=await room(),other=await room(),cookie=await login(),requestId=await seedRequest(id),path=endpoint+'/'+id+'/requests/'+requestId+'/block';
  for(const options of [{},{headers:{Authorization:'Bearer '+ownerToken}},{headers:{'X-Inbox-Applicant':ownerToken}}]) assert.equal((await call(path,{...options,method:'POST',body:{version:0}})).status,401);
  assert.equal((await call(path,{cookie,method:'POST',origin:'https://attacker.test',body:{version:0}})).status,403);
  for(const body of [{},{version:-1},{version:'0'},{version:0,ip:'forged'},{version:0,applicantHash:'forged'}]) assert.equal((await call(path,{cookie,method:'POST',body})).status,400);
  assert.equal((await call(path,{cookie})).status,405);
  await db.prepare('UPDATE blacksmith_requests SET version=1 WHERE id=?').bind(requestId).run();
  assert.equal((await call(path,{cookie,method:'POST',body:{version:0}})).status,409);
  assert.equal((await call(endpoint+'/'+other+'/requests/'+requestId+'/block',{cookie,method:'POST',body:{version:1}})).status,404);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks').first()).n,0);
  assert.ok(await db.prepare('SELECT 1 FROM blacksmith_requests WHERE id=?').bind(requestId).first());
  await db.prepare('UPDATE blacksmith_requests SET applicant_hash=NULL,submitter_ip_hash=NULL WHERE id=?').bind(requestId).run();
  const data=await (await call(endpoint+'/'+id+'/requests',{cookie})).json();assert.equal(data.requests[0].canBlock,false);
  assert.equal((await call(path,{cookie,method:'POST',body:{version:1}})).status,409);
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=1 WHERE id=?').bind(id).run();
  assert.equal((await call(path,{cookie,method:'POST',body:{version:1}})).status,404);
});
test('신청자 차단 중 삭제가 실패하면 차단 기록과 닉네임 해제도 함께 롤백한다',async()=>{
  const id=await room(),cookie=await login(),requestId=await seedRequest(id);
  await db.prepare("CREATE TRIGGER block_delete_fail BEFORE DELETE ON blacksmith_requests BEGIN SELECT RAISE(ABORT,'fixture block rollback'); END").run();
  try {
    const response=await call(endpoint+'/'+id+'/requests/'+requestId+'/block',{cookie,method:'POST',body:{version:0}});
    assert.equal(response.status,503);assert.ok(await db.prepare('SELECT 1 FROM blacksmith_requests WHERE id=?').bind(requestId).first());
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks').first()).n,0);
  } finally {await db.prepare('DROP TRIGGER block_delete_fail').run();}
});
test('활성 신청 상세는 대기·진행을 접수순으로 함께 정렬하고 완료는 아래에 최신 접수순으로 페이지 조회한다',async()=>{
  const id=await room(),cookie=await login(),time=Date.now();
  const ordered=Array.from({length:25},(_,i)=>({id:'request-'+String(i).padStart(3,'0'),status:i<22?(i%2?'working':'waiting'):'done',time:time+i}));
  for(const item of [...ordered].reverse()) await db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,'[]',1,?,?,?)")
    .bind(item.id,id,item.id,item.id,item.status,item.time).run();
  const path=endpoint+'/'+id+'/requests',all=[];
  for(let page=0;page<2;page++) {
    const data=await (await call(path+'?page='+page,{cookie})).json();
    assert.equal(data.total,25);assert.equal(data.pages,2);assert.equal(data.requests.length,page===0?20:5);all.push(...data.requests.map(r=>r.id));
  }
  assert.deepEqual(all,[...ordered.slice(0,22),...ordered.slice(22).reverse()].map(r=>r.id));
  assert.equal((await (await call(path+'?page=999',{cookie})).json()).page,1);
  for(const value of ['-1','1.5','abc','1000000']) assert.equal((await call(path+'?page='+value,{cookie})).status,400);
  const empty=await room();assert.deepEqual((await (await call(endpoint+'/'+empty+'/requests',{cookie})).json()).requests,[]);
});
test('종료 이력은 사이트 관리자만 조회하고 일반 진행자·신청자 권한으로는 접근할 수 없다',async()=>{
  const id=await room();await seedRequest(id);await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
  for(const path of [history,history+'/'+id]) {
    for(const options of [{},{headers:{Authorization:'Bearer '+ownerToken}},{headers:{'X-Inbox-Applicant':ownerToken}}]) assert.equal((await call(path,options)).status,401);
    const cookie=await login(),response=await call(path,{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await call(path,{method:'DELETE',cookie,body:{}})).status,405);
  }
});
test('진행자 종료는 장비·처리 상태·수정 횟수를 보존하며 인증값과 IP는 복제하지 않는다',async()=>{
  const id=await room({name:'종료 검증'}),cookie=await login(),requestId=await seedRequest(id,'working');
  const items=[{presetId:'pitch-belt',itemLevel:200,startStar:12,targetStar:22,quantity:1}];
  await db.prepare('UPDATE blacksmith_requests SET items=?,version=3 WHERE id=?').bind(JSON.stringify(items),requestId).run();
  const before=Date.now();
  const response=await call('/api/blacksmith-inboxes/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+ownerToken}});assert.equal(response.status,200);
  assert.equal(await getRoom(id),null);
  const record=await savedHistory(id);assert.equal(record.end_reason,'owner');assert.equal(record.request_count,1);assert.equal(record.working,1);
  assert.ok(record.ended_at>=before-2&&record.ended_at<=Date.now()+2);assert.equal(record.retain_until-record.ended_at,259200000);
  const detailResponse=await call(history+'/'+id,{cookie}),text=await detailResponse.clone().text(),detail=await detailResponse.json();
  assert.deepEqual(detail.requests[0].items,items);assert.equal(detail.requests[0].editCount,3);assert.equal(detail.requests[0].status,'working');
  for(const secret of ['private-applicant-hash','private-creator-hash','private-ip-hash','owner_hash','creator_hash','applicant_hash','submitter_ip_hash',ownerToken]) assert.ok(!text.includes(secret),secret);
  const columns=(await db.prepare('PRAGMA table_info(blacksmith_inbox_history)').all()).results.map(r=>r.name);
  assert.ok(!columns.some(c=>/hash|token|code/.test(c)));
  const list=await (await call(history,{cookie})).json();assert.equal(list.inboxes[0].requestCount,1);assert.ok(!JSON.stringify(list).includes('pitch-belt'));
  assert.equal((await (await call(endpoint,{cookie})).json()).summary.active,0);
});
test('관리자 종료와 자동 종료를 구분하고 오래된 revision은 종료 이력을 만들지 않는다',async()=>{
  const id=await room(),cookie=await login();await seedRequest(id);
  assert.equal((await call(endpoint+'/'+id,{method:'DELETE',cookie,body:{revision:0}})).status,409);assert.equal(await savedHistory(id),null);
  const revision=(await getRoom(id)).revision;
  assert.equal((await call(endpoint+'/'+id,{method:'DELETE',cookie,body:{revision}})).status,200);assert.equal((await savedHistory(id)).end_reason,'admin');
  const expired=await room(),requestId=await seedRequest(expired,'done'),deadline=Date.now()-1000;
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(deadline,expired).run();
  assert.equal((await call('/api/blacksmith-inboxes/'+expired+'/public')).status,410);
  const record=await savedHistory(expired);assert.equal(record.end_reason,'expired');assert.equal(record.ended_at,deadline);assert.equal(record.retain_until,deadline+259200000);assert.equal(record.done,1);
  assert.equal((await (await call(history+'/'+expired,{cookie})).json()).requests[0].id,requestId);
});
test('종료 이력 저장에 실패하면 원래 대장장이와 신청을 함께 보존한다',async()=>{
  const id=await room(),cookie=await login();await seedRequest(id);
  await db.prepare("CREATE TRIGGER history_fail BEFORE INSERT ON blacksmith_inbox_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END").run();
  try {
    const response=await call(endpoint+'/'+id,{method:'DELETE',cookie,body:{revision:(await getRoom(id)).revision}});
    assert.equal(response.status,503);assert.ok(await getRoom(id));assert.equal((await getRoom(id)).termination_reason,'owner');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?').bind(id).first()).n,1);assert.equal(await savedHistory(id),null);
  } finally {await db.prepare('DROP TRIGGER history_fail').run();}
});
test('종료 당시 신청은 20건씩 안정된 접수순으로 조회하고 페이지 범위를 검증한다',async()=>{
  const id=await room(),cookie=await login(),createdAt=Date.now(),ids=Array.from({length:45},(_,i)=>'history-'+String(i).padStart(3,'0'));
  for(const requestId of [...ids].reverse()) await db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,'[]',1,?,'done',?)").bind(requestId,id,requestId,requestId,createdAt).run();
  await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inbox_history_pages WHERE inbox_id=?').bind(id).first()).n,3);
  const all=[];
  for(let page=0;page<3;page++) {const data=await (await call(history+'/'+id+'?page='+page,{cookie})).json();all.push(...data.requests.map(r=>r.id));assert.equal(data.pages,3);assert.equal(data.requests.length,page===2?5:20);}
  assert.deepEqual(all,ids);assert.equal((await (await call(history+'/'+id+'?page=999',{cookie})).json()).page,2);
  assert.equal((await call(history+'/'+id+'?page=-1',{cookie})).status,400);
});
test('종료 이력은 3일 보관 기한·검색·종료 구분·정렬·목록 페이지를 적용한다',async()=>{
  const cookie=await login(),ids=[];
  for(let i=0;i<23;i++) {const id=await room({name:i===0?'100%_종료':'이력'+i});ids.push(id);await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
    await db.prepare('UPDATE blacksmith_inbox_history SET ended_at=?,last_completed_at=?,end_reason=? WHERE id=?').bind(Date.now()+i,i===0?Date.now():null,i%2?'admin':'owner',id).run();}
  const data=await (await call(history,{cookie})).json();assert.equal(data.total,23);assert.equal(data.pages,2);assert.equal(data.inboxes.length,20);assert.equal(data.inboxes[0].id,ids[22]);
  assert.equal((await (await call(history+'?page=999',{cookie})).json()).inboxes.length,3);
  const completed=await (await call(history+'?sort=completed',{cookie})).json();assert.equal(completed.inboxes[0].id,ids[0]);
  const literal=await (await call(history+'?q='+encodeURIComponent('%_'),{cookie})).json();assert.equal(literal.total,1);
  assert.equal((await (await call(history+'?reason=admin',{cookie})).json()).total,11);
  await db.prepare('UPDATE blacksmith_inbox_history SET retain_until=? WHERE id=?').bind(Date.now()-1,ids[0]).run();
  assert.equal((await call(history+'/'+ids[0],{cookie})).status,404);assert.equal((await (await call(history,{cookie})).json()).total,22);
  for(const query of ['reason=bad','sort=bad','page=-1','q=%00'])assert.equal((await call(history+'?'+query,{cookie})).status,400);
});

test('관리 페이지·목록·변경은 사이트 관리자만 접근하며 일반 신청함 관리 권한은 인정하지 않는다',async()=>{
  const id=await room();
  for(const path of ['/admin/blacksmith-inboxes/','/admin/blacksmith-inboxes','/admin/blacksmith-inboxes/index.html']) {
    const r=await call(path);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/admin/login/');
  }
  for(const options of [{},{headers:{Authorization:'Bearer '+ownerToken}},{headers:{'X-Inbox-Applicant':ownerToken}},{cookie:'__Host-starforce_admin='+'0'.repeat(64)}]) {
    assert.equal((await call(endpoint,options)).status,401);
    assert.equal((await call(endpoint+'/'+id,{...options,method:'DELETE',body:{revision:0}})).status,401);
  }
  assert.ok(await getRoom(id));
  const cookie=await login(), page=await call('/admin/blacksmith-inboxes/',{cookie});
  assert.equal(page.status,200);assert.match(await page.text(),/대장장이 관리/);
  assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('x-frame-options'),'DENY');
  assert.equal((await call('/admin/blacksmith-inboxes/',{method:'HEAD',cookie})).status,200);
});
test('관리 목록은 요약만 반환하고 인증값·IP·신청자·장비를 노출하지 않는다',async()=>{
  const id=await room(), cookie=await login();await seedRequest(id);await seedRequest(id,'working');await seedRequest(id,'done');
  const response=await call(endpoint,{cookie}), text=await response.clone().text(), data=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(data.summary,{total:1,active:1,accepting:1,paused:0,expired:0,limit:100});
  assert.deepEqual([data.inboxes[0].waiting,data.inboxes[0].working,data.inboxes[0].done],[1,1,1]);
  assert.equal(data.inboxes[0].accepting,true);assert.equal(data.inboxes[0].expired,false);
  for(const privateText of ['private-','owner_hash','creator_hash','applicant_hash','submitter_ip_hash','equipment',ownerToken]) assert.ok(!text.includes(privateText),privateText);
});
test('목록은 20개씩 생성 역순으로 표시하고 전체 정원 집계·검색·접수 상태 필터를 분리한다',async()=>{
  const cookie=await login(), now=Date.now();
  for(let i=0;i<24;i++) await room({name:'대장장이'+i,accepting:i%2,createdAt:now+i});
  const expired=await room({name:'만료',createdAt:now-43200000,expiresAt:now-1});
  const first=await (await call(endpoint,{cookie})).json();
  assert.equal(first.inboxes.length,20);assert.equal(first.pages,2);assert.equal(first.total,25);
  assert.deepEqual(first.summary,{total:25,active:24,accepting:12,paused:12,expired:1,limit:100});
  assert.equal(first.inboxes[0].name,'대장장이23');
  const second=await (await call(endpoint+'?page=999',{cookie})).json();assert.equal(second.page,1);assert.equal(second.inboxes.length,5);
  const search=await (await call(endpoint+'?q='+encodeURIComponent('대장장이23'),{cookie})).json();assert.equal(search.total,1);assert.equal(search.summary.active,24);
  const paused=await (await call(endpoint+'?status=paused',{cookie})).json();assert.equal(paused.total,12);assert.ok(paused.inboxes.every(r=>!r.accepting&&!r.expired));
  const old=await (await call(endpoint+'?status=expired',{cookie})).json();assert.equal(old.total,1);assert.equal(old.inboxes[0].id,expired);
});
test('활동 시각 마이그레이션은 기존 접수를 보존하고 과거 완료 시각을 임의로 만들지 않는다',()=>{
  assert.equal(activityMigrationSnapshot.legacy.last_submitted_at,activityMigrationSnapshot.latest);
  assert.equal(activityMigrationSnapshot.legacy.last_completed_at,null);
  assert.equal(activityMigrationSnapshot.empty.last_submitted_at,null);
  assert.equal(activityMigrationSnapshot.empty.last_completed_at,null);
  assert.equal(activityMigrationSnapshot.requests,1);
});
test('최근 신청은 새 접수 시각을 기록하고 수정·상태 변경·삭제로 바뀌거나 사라지지 않는다',async()=>{
  const id=await room(), cookie=await login();
  let data=await (await call(endpoint,{cookie})).json();
  assert.equal(data.inboxes[0].lastSubmittedAt,null);assert.equal(data.inboxes[0].lastCompletedAt,null);
  const requestId=await seedRequest(id), submitted=(await getRoom(id)).last_submitted_at, expiry=(await getRoom(id)).expires_at;
  await db.prepare("UPDATE blacksmith_requests SET nickname='수정',status='working' WHERE id=?").bind(requestId).run();
  assert.equal((await getRoom(id)).last_submitted_at,submitted);assert.equal((await getRoom(id)).last_completed_at,null);
  await db.prepare('DELETE FROM blacksmith_requests WHERE id=?').bind(requestId).run();
  data=await (await call(endpoint,{cookie})).json();
  assert.equal(data.inboxes[0].lastSubmittedAt,submitted);assert.equal(data.inboxes[0].lastCompletedAt,null);
  assert.equal((await getRoom(id)).expires_at,expiry);
});
test('최근 완료는 실제 완료 처리 때 기록하며 같은 상태 재요청·재개는 갱신하지 않는다',async()=>{
  const id=await room(), requestId=await seedRequest(id,'working'), started=Date.now();
  const update=status=>call('/api/blacksmith-inboxes/'+id+'/requests/'+requestId,{method:'PATCH',headers:{Authorization:'Bearer '+ownerToken},body:{status}});
  const expiry=(await getRoom(id)).expires_at;
  assert.equal((await update('done')).status,200);
  const completed=(await getRoom(id)).last_completed_at;
  assert.ok(completed>=started-2&&completed<=Date.now()+2);
  // A known earlier event makes same-state retries distinguishable without sleeps.
  await db.prepare('UPDATE blacksmith_inboxes SET last_completed_at=? WHERE id=?').bind(started-10000,id).run();
  assert.equal((await update('done')).status,200);assert.equal((await getRoom(id)).last_completed_at,started-10000);
  assert.equal((await update('working')).status,200);assert.equal((await getRoom(id)).last_completed_at,started-10000);
  assert.equal((await update('done')).status,200);assert.ok((await getRoom(id)).last_completed_at>=started-2);
  await db.prepare('DELETE FROM blacksmith_requests WHERE id=?').bind(requestId).run();
  assert.ok((await getRoom(id)).last_completed_at>=started-2);assert.equal((await getRoom(id)).expires_at,expiry);
});
test('최근 신청·완료 정렬은 전체 목록에 먼저 적용하고 검색·필터·페이지에서도 유지한다',async()=>{
  const cookie=await login(), now=Date.now(), ids=[];
  for(let i=0;i<25;i++) {
    const id=await room({name:'정렬'+i,createdAt:now+i,accepting:i%2});ids.push(id);
    if(i<23) await db.prepare('UPDATE blacksmith_inboxes SET last_submitted_at=?,last_completed_at=? WHERE id=?').bind(now-i,now+i,id).run();
  }
  const submitted=await (await call(endpoint+'?sort=submitted',{cookie})).json();
  assert.equal(submitted.inboxes[0].id,ids[0]);assert.equal(submitted.inboxes.at(-1).id,ids[19]);
  const completed=await (await call(endpoint+'?sort=completed',{cookie})).json();assert.equal(completed.inboxes[0].id,ids[22]);
  const second=await (await call(endpoint+'?sort=completed&page=1',{cookie})).json();
  assert.deepEqual(second.inboxes.map(r=>r.id),[ids[2],ids[1],ids[0],ids[24],ids[23]]);
  const filtered=await (await call(endpoint+'?sort=completed&status=paused&q='+encodeURIComponent('정렬'),{cookie})).json();
  assert.equal(filtered.inboxes[0].id,ids[22]);assert.equal(filtered.total,13);
  const defaultSort=await (await call(endpoint,{cookie})).json();assert.equal(defaultSort.inboxes[0].id,ids[24]);
});
test('이름 검색은 와일드카드·따옴표를 일반 문자로 처리하고 잘못된 검색 조건은 거부한다',async()=>{
  const cookie=await login();await room({name:'문자 %_\\'});await room({name:'일반'});
  const search=await (await call(endpoint+'?q='+encodeURIComponent('%_\\'),{cookie})).json();assert.equal(search.total,1);
  const injection=await (await call(endpoint+'?q='+encodeURIComponent("' OR 1=1 --"),{cookie})).json();assert.equal(injection.total,0);
  for(const q of ['sort=unknown','sort=__proto__','sort='+encodeURIComponent('created; DROP TABLE blacksmith_inboxes'),'status=unknown','page=-1','page=no','page=1000000','q='+encodeURIComponent('a'.repeat(65))]) assert.equal((await call(endpoint+'?'+q,{cookie})).status,400);
});
test('접수 중지·재개는 진행자의 공개 상태에도 즉시 반영하며 만료 시각과 접수 정원을 유지한다',async()=>{
  const cookie=await login(), id=await room(), before=await getRoom(id);
  const mutate=body=>call(endpoint+'/'+id,{cookie,method:'PATCH',body});
  assert.equal((await mutate({revision:0,accepting:false})).status,200);
  const publicRoom=await (await call('/api/blacksmith-inboxes/'+id+'/public')).json();assert.equal(publicRoom.accepting,false);
  assert.equal((await getRoom(id)).expires_at,before.expires_at);
  assert.equal((await (await call(endpoint,{cookie})).json()).summary.active,1);
  assert.equal((await mutate({revision:1,accepting:true})).status,200);
  assert.equal((await getRoom(id)).accepting,1);
  assert.equal((await config.prepare('SELECT revision FROM starforce_price_config').first()).revision,0);
});
test('폐기는 신청·닉네임 예약을 함께 제거하고 접수 횟수는 환불하지 않으며 다른 신청함은 보존한다',async()=>{
  const cookie=await login(), id=await room(), other=await room({name:'다른 진행자'}), requestId=await seedRequest(id);
  await db.prepare('INSERT INTO blacksmith_nickname_claims(inbox_id,nickname_key,applicant_hash,request_id) VALUES (?,?,?,?)').bind(id,'private-applicant','private-applicant-hash',requestId).run();
  await db.prepare('INSERT INTO blacksmith_submissions(request_id,ip_hash,submitted_at) VALUES (?,?,?)').bind(requestId,'private-ip-hash',Date.now()).run();
  const r=await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:(await getRoom(id)).revision}});assert.equal(r.status,200);
  assert.equal(await getRoom(id),null);assert.ok(await getRoom(other));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_nickname_claims').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_submissions').first()).n,1);
  assert.equal((await call('/api/blacksmith-inboxes/'+id+'/public')).status,404);
});
test('확인 이후 새 신청이나 진행자 변경이 있으면 오래된 화면에서 중지·폐기하지 않는다',async()=>{
  const cookie=await login(), id=await room();await seedRequest(id);
  for(const method of ['PATCH','DELETE']) {
    const r=await call(endpoint+'/'+id,{cookie,method,body:{revision:0,...(method==='PATCH'?{accepting:false}:{})}});
    assert.equal(r.status,409);assert.match((await r.json()).error,/변경/);
  }
  assert.equal((await getRoom(id)).accepting,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests').first()).n,1);
});
test('만료 신청함은 재개할 수 없고 관리자가 폐기할 수 있다',async()=>{
  const cookie=await login(), id=await room({expiresAt:Date.now()-1});
  assert.equal((await call(endpoint+'/'+id,{cookie,method:'PATCH',body:{revision:0,accepting:true}})).status,410);
  assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:0}})).status,200);
  assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:0}})).status,404);
});
test('관리 변경은 Origin·본문·버전을 검사하고 비활성 환경과 만료·로그아웃 세션은 거부한다',async()=>{
  const cookie=await login(), id=await room();
  for(const options of [{origin:null},{origin:'https://attacker.test'},{headers:{'Sec-Fetch-Site':'cross-site'}}]) assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:0},...options})).status,403);
  for(const body of [{},{revision:'0'},{revision:-1},{revision:0,ownerKey:ownerToken}]) assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body})).status,400);
  assert.equal((await call(endpoint+'/'+id,{cookie,method:'PATCH',body:{revision:0,accepting:1}})).status,400);
  assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:0,padding:'x'.repeat(2048)}})).status,413);
  assert.equal((await call(endpoint+'?disabled',{cookie})).status,404);
  assert.equal((await call('/admin/blacksmith-inboxes/?disabled',{cookie})).status,404);
  assert.ok(await getRoom(id));
  await call('/api/admin/session',{cookie,method:'DELETE'});assert.equal((await call(endpoint,{cookie})).status,401);
  const expired=await login();await config.prepare('UPDATE starforce_admin_sessions SET expires_at=1').run();assert.equal((await call(endpoint,{cookie:expired})).status,401);
});
test('생성 IP 차단은 관리자만 가능하며 위조·누락·과거 IP를 거부하고 해시를 공개하지 않는다',async()=>{
  const cookie=await login(), legacy=await room(), r=await createFromIp('192.0.2.71');assert.equal(r.status,201);
  const owner=await r.json(), target=endpoint+'/'+owner.id+'/block-creator-ip';
  assert.equal((await call(target,{method:'POST',body:{revision:0}})).status,401);
  assert.equal((await call(target,{method:'POST',body:{revision:0},headers:{Authorization:'Bearer '+owner.browserToken}})).status,401);
  assert.equal((await call(target,{cookie,method:'POST',body:{revision:0},origin:'https://attacker.test'})).status,403);
  for(const body of [{},{revision:'0'},{revision:0,ip:'192.0.2.72'},{revision:0,creator_ip_hash:'forged'}]) assert.equal((await call(target,{cookie,method:'POST',body})).status,400);
  assert.equal((await call(endpoint+'/'+legacy+'/block-creator-ip',{cookie,method:'POST',body:{revision:0}})).status,409);
  assert.equal((await call(target,{cookie,method:'POST',body:{revision:999}})).status,409);
  const data=await (await call(endpoint,{cookie})).json(), recorded=data.inboxes.find(r=>r.id===owner.id);
  assert.equal(recorded.creatorIpKnown,true);assert.equal(recorded.creatorIpBlockId,null);assert.equal(data.inboxes.find(r=>r.id===legacy).creatorIpKnown,false);
  const stored=await getRoom(owner.id);assert.match(stored.creator_ip_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(data).includes(stored.creator_ip_hash));
  const publicData=await (await call('/api/blacksmith-inboxes/'+owner.id+'/public')).json();
  assert.ok(!JSON.stringify(publicData).includes('creator'));assert.ok(!JSON.stringify(publicData).includes('192.0.2.71'));
});
test('차단한 IP는 새 브라우저로도 생성하지 못하며 기존 신청함·다른 IP는 유지하고 폐기 후에도 차단된다',async()=>{
  const cookie=await login(), ip='192.0.2.81';
  const original=await (await createFromIp(ip,'차단대상')).json();
  // Preserve multiple inboxes created before the one-active-IP policy.
  const second={id:await room({name:'같은IP기존'})};
  await db.prepare('UPDATE blacksmith_inboxes SET creator_ip_hash=(SELECT creator_ip_hash FROM blacksmith_inboxes WHERE id=?) WHERE id=?').bind(original.id,second.id).run();
  const target=endpoint+'/'+original.id+'/block-creator-ip';
  assert.equal((await call(target,{cookie,method:'POST',body:{revision:0}})).status,200);
  assert.equal((await call(target,{cookie,method:'POST',body:{revision:0}})).status,200);
  const list=await (await call(endpoint,{cookie})).json(), blockId=list.inboxes.find(r=>r.id===original.id).creatorIpBlockId;
  assert.ok(blockId);assert.equal(list.inboxes.find(r=>r.id===second.id).creatorIpBlockId,blockId);
  assert.equal((await createFromIp(ip,'차단새브라우저',{'X-Forwarded-For':'192.0.2.99'})).status,403);
  assert.equal((await createFromIp('192.0.2.82','다른IP')).status,201);
  assert.equal((await call('/api/blacksmith-inboxes/'+original.id+'/public')).status,200);
  assert.equal((await call('/api/blacksmith-inboxes/'+original.id,{method:'PATCH',body:{accepting:false},headers:{Authorization:'Bearer '+original.browserToken}})).status,200);
  for(const id of [original.id,second.id]) assert.equal((await call(endpoint+'/'+id,{cookie,method:'DELETE',body:{revision:(await getRoom(id)).revision}})).status,200);
  assert.equal((await createFromIp(ip,'폐기후재시도')).status,403);
  const blocks=await (await call(endpoint+'/blocked-ips',{cookie})).json();assert.equal(blocks.total,1);assert.equal(blocks.blocks[0].sourceName,'차단대상');
  assert.ok(!JSON.stringify(blocks).includes('ip_hash'));assert.ok(!JSON.stringify(blocks).includes(ip));
  const remove=endpoint+'/blocked-ips/'+blockId;
  assert.equal((await call(remove,{cookie,method:'DELETE',body:{},origin:'https://attacker.test'})).status,403);
  assert.equal((await call(remove,{method:'DELETE',body:{}})).status,401);
  assert.equal((await call(remove,{cookie,method:'DELETE',body:{}})).status,200);
  assert.equal((await createFromIp(ip,'차단해제후')).status,201);
});
test('차단 목록도 페이지를 나누며 만료·없는 인증과 잘못된 본문은 차단 해제를 허용하지 않는다',async()=>{
  const cookie=await login(), now=Date.now(), ids=[];
  for(let i=0;i<25;i++) {const id=randomUUID();ids.push(id);await db.prepare('INSERT INTO blacksmith_creator_ip_blocks(id,ip_hash,source_name,blocked_at) VALUES (?,?,?,?)').bind(id,createHash('sha256').update('ip-'+i).digest('hex'),'차단'+i,now+i).run();}
  assert.equal((await call(endpoint+'/blocked-ips')).status,401);
  const first=await (await call(endpoint+'/blocked-ips',{cookie})).json();assert.equal(first.blocks.length,20);assert.equal(first.blocks[0].id,ids[24]);
  const second=await (await call(endpoint+'/blocked-ips?page=999',{cookie})).json();assert.equal(second.page,1);assert.equal(second.blocks.length,5);
  assert.equal((await call(endpoint+'/blocked-ips?page=-1',{cookie})).status,400);
  assert.equal((await call(endpoint+'/blocked-ips/'+ids[0],{cookie,method:'DELETE',body:{ip:'forged'}})).status,400);
  assert.equal((await call(endpoint+'/blocked-ips/'+randomUUID(),{cookie,method:'DELETE',body:{}})).status,404);
  assert.equal((await call(endpoint+'/blocked-ips?disabled',{cookie})).status,404);
});

test('관리자 차단 내역은 완료 아래에 남고 인증된 차단 해제로만 제거되며 종료 이력에도 보관된다',async()=>{
  const id=await room(),cookie=await login(),requestId=await seedRequest(id),path=endpoint+'/'+id+'/requests/'+requestId+'/block';
  assert.equal((await call(path,{cookie,method:'POST',body:{version:0}})).status,200);
  const data=await(await call(endpoint+'/'+id+'/requests',{cookie})).json(),record=data.requests[0];
  assert.equal(record.status,'blocked');assert.equal(record.canBlock,false);assert.ok(record.blockedAt);
  const body={blockedAt:record.blockedAt};
  assert.equal((await call(path,{method:'DELETE',body})).status,401);
  assert.equal((await call(path,{cookie,method:'DELETE',body,origin:'https://attacker.test'})).status,403);
  assert.equal((await call(path,{cookie,method:'DELETE',body:{...body,ip:'forged'}})).status,400);
  assert.equal((await call(path,{cookie,method:'DELETE',body:{blockedAt:record.blockedAt+1}})).status,409);
  await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
  const historyData=await(await call(history+'/'+id,{cookie})).json();
  assert.equal(historyData.requests[0].status,'blocked');assert.equal(historyData.requests[0].nickname,record.nickname);assert.equal(historyData.total,1);
  assert.ok(!JSON.stringify(historyData).includes('applicant_hash'));
  const next=await room(),nextRequest=await seedRequest(next),nextPath=endpoint+'/'+next+'/requests/'+nextRequest+'/block';
  assert.equal((await call(nextPath,{cookie,method:'POST',body:{version:0}})).status,200);
  const nextRecord=(await(await call(endpoint+'/'+next+'/requests',{cookie})).json()).requests[0];
  assert.equal((await call(nextPath,{cookie,method:'DELETE',body:{blockedAt:nextRecord.blockedAt}})).status,200);
  assert.equal((await(await call(endpoint+'/'+next+'/requests',{cookie})).json()).total,0);
});
