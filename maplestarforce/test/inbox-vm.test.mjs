import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import http from 'node:http';
import {openInboxDatabase} from '../tools/inbox-api/sqlite.mjs';
import {createInboxServer} from '../tools/inbox-api/server.mjs';
import {createTrafficLimiter} from '../tools/inbox-api/traffic.mjs';

let directory,db,server,verifier,url,handlers;
const config={frontendOrigin:'https://preview.starforce.pages.dev',proxyKey:'1'.repeat(64),bridgeToken:'2'.repeat(64),sitekey:'fixture-only'};
const hash=s=>createHash('sha256').update(s).digest('hex'),room='a'.repeat(24),owner='b'.repeat(64),applicant='c'.repeat(64),client='d'.repeat(64);
const items=[{presetId:'giant-fear',itemLevel:200,startStar:12,targetStar:21,quantity:1}];
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'inbox-vm-test-'));
  await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`export {onRequest as publicApi} from './functions/api/blacksmith-inboxes/[[path]].ts';export {handleInboxAdmin as adminApi} from './functions/api/admin/blacksmith-inboxes/[[path]].ts';`},bundle:true,format:'esm',platform:'node',outfile:join(directory,'handlers.mjs')});
  handlers=await import(join(directory,'handlers.mjs'));
  verifier=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,`Bearer ${config.bridgeToken}`);let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:body.token==='fixture-valid',action:body.action,hostname:'preview.starforce.pages.dev'}));});
  await new Promise(r=>verifier.listen(0,'127.0.0.1',r));config.verifyUrl=`http://127.0.0.1:${verifier.address().port}`;
  db=await openInboxDatabase(join(directory,'test.sqlite'),fileURLToPath(new URL('../migrations/blacksmith-inbox',import.meta.url)));
  await db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,creator_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(room,'테스트 대장장이',hash(`${room}:${owner}`),'creator',Date.now(),Date.now()+43200000).run();
  server=createInboxServer({database:db,handlers,config,relay:{isBlocked:ip=>ip==='203.0.113.8'},country:{isAllowed:ip=>ip!=='203.0.113.9'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(r=>server?.close(r));await new Promise(r=>verifier?.close(r));await db?.close();await rm(directory,{recursive:true,force:true});});
function call(path,{method='GET',headers={},body}={}){return fetch(url+path,{method,headers:{Origin:config.frontendOrigin,'X-Inbox-Proxy-Key':config.proxyKey,'X-Inbox-Verified-IP':'192.0.2.1','X-Inbox-Client':client,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const api='/api/blacksmith-inboxes';
test('foreign applicants are notified and cannot submit/edit, even when spoofing country headers',async()=>{
  const headers={'X-Inbox-Verified-IP':'203.0.113.9','X-Inbox-Applicant':applicant,'CF-IPCountry':'KR'};
  const data=await(await call(`${api}/${room}/my-request`,{headers})).json();
  assert.equal(data.ipRestricted,true);assert.equal(data.ipRestriction,'foreign');
  for(const [path,method] of [[`${api}/${room}/requests`,'POST'],[`${api}/${room}/my-request`,'PATCH']]){
    const response=await call(path,{method,headers,body:{}});
    assert.equal(response.status,403);assert.match((await response.json()).error,/해외 IP/u);
  }
  // Country policy does not intercept applicant withdrawal or public room reads.
  const withdrawn=await call(`${api}/${room}/my-request`,{method:'DELETE',headers,body:{id:randomUUID()}});
  assert.notEqual(withdrawn.status,403);
  assert.equal((await call(`${api}/${room}/public`,{headers})).status,200);
});
test('VM resolves exact blacksmith names without exposing private fields', async()=>{
  const response=await call(api+'/lookup',{method:'POST',body:{name:'테스트 대장장이',token:'fixture-valid'}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{room:{id:room,name:'테스트 대장장이'}});
  assert.equal((await call(api+'/lookup',{method:'POST',body:{name:'테스트',token:'fixture-valid'}})).status,404);
});
test('VM SQLite atomically limits different browser creations to one active inbox per IP',async()=>{
  const ip='192.0.2.44';
  const responses=await Promise.all(['e','f'].map((value,i)=>call(api,{method:'POST',headers:{'X-Inbox-Verified-IP':ip,'X-Inbox-Client':value.repeat(64)},body:{name:`VM IP 제한 ${i}`,token:'fixture-valid'}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const created=await responses.find(r=>r.status===201).json();
  const denied=await responses.find(r=>r.status===409).json();assert.match(denied.error,/같은 IP/);assert.equal(denied.browserToken,undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inboxes WHERE creator_ip_hash=?').bind(hash(`create-ip:${ip}`)).first()).n,1);
  await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(created.id).run();
});
test('VM connects private browsers by verified creator IP and rechecks direct and bridged management',async()=>{
  const ip='192.0.2.45',headers={'X-Inbox-Verified-IP':ip,'X-Inbox-Client':'7'.repeat(64)};
  const created=await(await call(api,{method:'POST',headers,body:{name:'VM IP 관리',token:'fixture-valid'}})).json();
  const incognito={...headers,'X-Inbox-Client':'8'.repeat(64)};
  try {
    const discovered=await call(api+'/managed',{headers:incognito});
    assert.equal(discovered.status,200);assert.equal(discovered.headers.get('cache-control'),'no-store');
    const body=await discovered.json();assert.equal(body.room.id,created.id);
    for(const secret of ['browserToken','owner_hash','creator_ip_hash',created.browserToken,ip])assert.ok(!JSON.stringify(body).includes(secret));
    assert.equal((await call(`${api}/${created.id}`,{headers:incognito})).status,200);
    assert.equal((await call(`${api}/${created.id}`,{method:'PATCH',headers:incognito,body:{accepting:false}})).status,200);
    const forged={'CF-Connecting-IP':ip,'X-Forwarded-For':ip};
    assert.deepEqual(await(await call(api+'/managed',{headers:forged})).json(),{room:null});
    assert.equal((await call(`${api}/${created.id}`,{headers:forged})).status,401);
    const bridge={'X-Inbox-Bridge':config.bridgeToken,'X-Inbox-Frontend':config.frontendOrigin,'X-Inbox-Visitor-IP':ip};
    assert.equal((await call(`/internal/public${api}/${created.id}`,{headers:bridge})).status,200);
    assert.equal((await call(`/internal/public${api}/${created.id}`,{headers:{...bridge,'X-Inbox-Visitor-IP':'192.0.2.46'}})).status,401);
    assert.equal((await call(`${api}/${created.id}`,{headers:{Authorization:`Bearer ${created.browserToken}`}})).status,200);
    assert.equal((await call(`${api}/${created.id}`,{method:'DELETE',headers:incognito})).status,200);
    assert.deepEqual(await(await call(api+'/managed',{headers:incognito})).json(),{room:null});
  } finally {await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(created.id).run();}
});
test('SQLite batches rollback atomically and persist through reopen',async()=>{
  await assert.rejects(db.batch([db.prepare("INSERT INTO blacksmith_limits VALUES ('rollback',1,1)"),db.prepare("INSERT INTO missing_table VALUES (1)")]));
  assert.equal(await db.prepare("SELECT * FROM blacksmith_limits WHERE key_hash='rollback'").first(),null);
  const result=await db.prepare("INSERT INTO blacksmith_limits VALUES ('persist',2,3)").run();assert.equal(result.meta.changes,1);
  const reopened=await openInboxDatabase(join(directory,'test.sqlite'),fileURLToPath(new URL('../migrations/blacksmith-inbox',import.meta.url)));
  try{assert.equal((await reopened.prepare("SELECT attempts FROM blacksmith_limits WHERE key_hash='persist'").first()).attempts,2);}finally{await reopened.close();}
});
test('VM accepts exact preview CORS preflight and rejects origin/header spoofing',async()=>{
  assert.equal((await call(api+'/config',{headers:{Origin:'https://attacker.test'}})).status,403);
  assert.equal((await call(api+'/config',{headers:{'X-Inbox-Proxy-Key':'wrong','CF-Connecting-IP':'192.0.2.1'}})).status,403);
  const response=await call(api+'/config',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-inbox-applicant'}});
  assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),config.frontendOrigin);
  assert.equal((await call(api+'/config',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-inbox-bridge'}})).status,403);
  assert.equal((await call(api+'/config',{method:'POST',body:'x'.repeat(48001)})).status,413);
});
test('VM uses server bot verifier, preserves applicant privacy and completion timestamp',async()=>{
  const id=randomUUID(),headers={'X-Inbox-Applicant':applicant};
  // A real equipment preset from the public registry, with no submitted prices.
  const equipment=items;
  const invalid=await call(`${api}/${room}/requests`,{method:'POST',headers,body:{id,nickname:'신청자',items:equipment,token:'invalid'}});
  assert.equal(invalid.status,403,await invalid.clone().text());
  const response=await call(`${api}/${room}/requests`,{method:'POST',headers,body:{id,nickname:'신청자',items:equipment,token:'fixture-valid'}});
  assert.equal(response.status,201,await response.clone().text());
  const complete=await call(`${api}/${room}/requests/${id}`,{method:'PATCH',headers:{Authorization:`Bearer ${owner}`},body:{status:'done'}});assert.equal(complete.status,200,await complete.clone().text());
  const mine=await (await call(`${api}/${room}/my-request`,{headers})).json();assert.equal(mine.application,null);assert.equal(mine.completed.id,id);assert.ok(Math.abs(Date.now()-mine.completed.completedAt)<5000);
  const other=await (await call(`${api}/${room}/my-request`,{headers:{'X-Inbox-Applicant':'e'.repeat(64)}})).json();assert.equal(other.completed,null);
});
test('administrator core is accessible only via authenticated server bridge',async()=>{
  assert.equal((await call('/internal/admin/api/admin/blacksmith-inboxes')).status,401);
  assert.equal((await call('/api/admin/blacksmith-inboxes')).status,404);
  const response=await call('/internal/admin/api/admin/blacksmith-inboxes',{headers:{'X-Inbox-Bridge':config.bridgeToken,'X-Inbox-Frontend':config.frontendOrigin,'X-Inbox-Visitor-IP':'192.0.2.1'}});
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).inboxes[0].name,'테스트 대장장이');
});
test('VM administrator reads active equipment through the private bridge without leaking capabilities',async()=>{
  const id='9'.repeat(24),requestId=randomUUID(),now=Date.now();
  await db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,creator_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')
    .bind(id,'활성 내역 검증',hash(`${id}:${owner}`),'detail-private-creator',now,now+43200000).run();
  await db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at,applicant_hash,submitter_ip_hash) VALUES (?,?,?,?,1,?,?,?,?,?)')
    .bind(requestId,id,'장비 검증 신청자',JSON.stringify(items),'private-fingerprint','working',now,'private-applicant-hash','private-ip-hash').run();
  const path='/internal/admin/api/admin/blacksmith-inboxes/'+id+'/requests';
  assert.equal((await call(path)).status,401);
  const response=await call(path,{headers:{'X-Inbox-Bridge':config.bridgeToken,'X-Inbox-Frontend':config.frontendOrigin,'X-Inbox-Visitor-IP':'192.0.2.1'}});
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');
  const text=await response.clone().text(),data=await response.json();
  assert.equal(data.total,1);assert.equal(data.requests[0].status,'working');assert.deepEqual(data.requests[0].items,items);
  assert.equal(data.requests[0].canBlock,true);
  for(const secret of ['private-','owner_hash','applicant_hash','submitter_ip_hash',owner]) assert.ok(!text.includes(secret),secret);
  const block=path+'/'+requestId+'/block',body={version:0};
  assert.equal((await call(block,{method:'POST',body})).status,401);
  const blocked=await call(block,{method:'POST',body,headers:{'X-Inbox-Bridge':config.bridgeToken,'X-Inbox-Frontend':config.frontendOrigin,'X-Inbox-Visitor-IP':'192.0.2.1'}});
  assert.equal(blocked.status,200,await blocked.clone().text());
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?').bind(id).first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks WHERE inbox_id=?').bind(id).first()).n,1);
  await db.prepare('DELETE FROM blacksmith_inboxes WHERE id=?').bind(id).run();
});
test('Private Relay restrictions use verified IP, deny submit/edit and retain read access',async()=>{
  const headers={'X-Inbox-Verified-IP':'203.0.113.8','X-Inbox-Applicant':applicant};
  const read=await call(`${api}/${room}/my-request`,{headers});assert.equal(read.status,200);assert.equal((await read.json()).ipRestricted,true);
  for(const [path,method] of [[`${api}/${room}/requests`,'POST'],[`${api}/${room}/my-request`,'PATCH']]) {
    const response=await call(path,{method,headers,body:{}});assert.equal(response.status,403);assert.match((await response.json()).error,/신청 불가능한 IP/);
  }
  const normal=await call(`${api}/${room}/my-request`,{headers:{'X-Inbox-Applicant':applicant,'CF-Connecting-IP':'203.0.113.8','X-Forwarded-For':'203.0.113.8'}});
  assert.equal((await normal.json()).ipRestricted,false);
  const bridged=await call(`/internal/public${api}/${room}/my-request`,{headers:{...headers,'X-Inbox-Bridge':config.bridgeToken,'X-Inbox-Frontend':config.frontendOrigin,'X-Inbox-Visitor-IP':'203.0.113.8'}});
  assert.equal((await bridged.json()).ipRestricted,true);
});
test('VM minute limiter enforces read/write windows and recovers after idle capacity',async()=>{
  let now=0;const limiter=createTrafficLimiter({now:()=>now,maxKeys:2});
  const request=()=>limiter.fetch('',{method:'POST',headers:{'X-Traffic-IP':'ip','X-Traffic-Client':'client'}});
  for(let i=0;i<20;i++)assert.equal((await request()).status,204);
  assert.equal((await request()).status,429);now=60001;assert.equal((await request()).status,204);
  now=120002;assert.equal((await limiter.fetch('',{method:'GET',headers:{'X-Traffic-IP':'other','X-Traffic-Client':'other'}})).status,204);
});
