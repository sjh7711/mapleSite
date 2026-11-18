// Local, disposable database only. Never points at a deployed API or live DB.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {openInboxDatabase} from './sqlite.mjs';
import {createInboxServer} from './server.mjs';
import * as handlers from './.build/handlers.mjs';

const directory=await mkdtemp(join(tmpdir(),'inbox-load-'));
const db=await openInboxDatabase(join(directory,'benchmark.sqlite'),fileURLToPath(new URL('../../migrations/blacksmith-inbox',import.meta.url)));
const hash=s=>createHash('sha256').update(s).digest('hex'),owner='b'.repeat(64);
const rooms=Array.from({length:100},(_,i)=>({id:i.toString(16).padStart(24,'0'),client:hash('client:'+i),ip:`192.0.2.${i+1}`}));
const equipment=JSON.stringify(Array.from({length:5},()=>({presetId:'giant-fear',itemLevel:200,startStar:12,targetStar:21,quantity:1})));
const now=Date.now();
await db.batch(rooms.map((r,i)=>db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,creator_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(r.id,`부하테스트${i}`,hash(`${r.id}:${owner}`),hash(r.client),now,now+43200000)));
for(const room of rooms)await db.batch(Array.from({length:100},(_,i)=>db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at,applicant_hash,submitter_ip_hash) VALUES (?,?,?,?,5,?,?,?,?,?)').bind(randomUUID(),room.id,`신청자${i}`,equipment,hash(`${room.id}:${i}`),i<50?'waiting':'done',now+i,hash(`applicant:${room.id}:${i}`),hash(`ip:${room.id}:${i}`))));
const config={frontendOrigin:'https://preview.starforce.pages.dev',proxyKey:'1'.repeat(64),bridgeToken:'2'.repeat(64),sitekey:'unused',verifyUrl:'http://127.0.0.1:1/never-used'};
const results=[];
try {
  for(const mixed of [false,true]) {
    const server=createInboxServer({database:db,handlers,config});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}/api/blacksmith-inboxes`,latencies=[],errors={},tasks=[];
    const duration=30,rate=100,total=duration*rate,delay=monitorEventLoopDelay({resolution:10});delay.enable();
    const cpu=process.cpuUsage(),started=performance.now();
    for(let i=0;i<total;i++) {
      const due=started+i*1000/rate,wait=due-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
      tasks.push((async()=>{
        const room=rooms[Math.floor(i/5)%100],write=mixed&&i%5===0,full=i%10===1;
        const before=performance.now();
        try {
          const response=await fetch(`${base}/${room.id}${write?'':full?'':'?revision=100'}`,{method:write?'PATCH':'GET',headers:{Origin:config.frontendOrigin,'Content-Type':'application/json','X-Inbox-Proxy-Key':config.proxyKey,'X-Inbox-Verified-IP':room.ip,'X-Inbox-Client':room.client,Authorization:`Bearer ${owner}`},...(write?{body:JSON.stringify({accepting:Boolean(i%2)})}:{})});
          await response.arrayBuffer();if(response.status!==200)errors[response.status]=(errors[response.status]??0)+1;
        }catch(error){errors.network=(errors.network??0)+1;}
        latencies.push(performance.now()-before);
      })());
    }
    await Promise.all(tasks);const elapsed=(performance.now()-started)/1000,used=process.cpuUsage(cpu);delay.disable();
    latencies.sort((a,b)=>a-b);const percentile=p=>Number(latencies[Math.floor((latencies.length-1)*p)].toFixed(2));
    results.push({mode:mixed?'80% reads / 20% writes':'read only',requests:total,seconds:Number(elapsed.toFixed(2)),requestsPerSecond:Number((total/elapsed).toFixed(2)),p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:percentile(1),errors,cpuSeconds:Number(((used.user+used.system)/1e6).toFixed(2)),eventLoopP99Ms:Number((delay.percentile(99)/1e6).toFixed(2)),rssMB:Number((process.memoryUsage().rss/1048576).toFixed(1))});
    await new Promise(r=>server.close(r));
  }
  console.log(JSON.stringify({fixture:{rooms:100,requestsPerRoom:100,equipmentPerRequest:5},results},null,2));
} finally {await db.close();await rm(directory,{recursive:true,force:true});}
if(results.some(r=>Object.keys(r.errors).length))process.exitCode=1;
