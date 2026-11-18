import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { createTrafficLimiter } from './traffic.mjs';

// Workerd exposes timingSafeEqual on SubtleCrypto; use Node's native constant
// time implementation when running the same validated handlers on the VM.
if(!crypto.subtle.timingSafeEqual)Object.defineProperty(crypto.subtle,'timingSafeEqual',{value:(a,b)=>a.byteLength===b.byteLength&&timingSafeEqual(Buffer.from(a),Buffer.from(b))});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createInboxServer({database,handlers,config,traffic=createTrafficLimiter(),relay={isBlocked:()=>false},country}) {
  const frontend=new URL(config.frontendOrigin);
  const env={STARFORCE_INBOX_DB:database,STARFORCE_INBOX_ENABLED:'true',TURNSTILE_SITEKEY:config.sitekey,INBOX_TRAFFIC:traffic,INBOX_VERIFY_URL:config.verifyUrl,INBOX_VM_TOKEN:config.bridgeToken};
  return http.createServer({maxHeaderSize:16384},async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','X-Inbox-Backend':'vm-sqlite','Vary':'Origin'};
    const send=(status,message)=>{req.resume();res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(message));};
    try {
      const path=new URL(req.url,'http://localhost');
      if(path.pathname==='/healthz'&&req.method==='GET')return send(200,{ok:true});
      const internal=path.pathname.startsWith('/internal/');
      const bridged=internal&&same(req.headers['x-inbox-bridge'],config.bridgeToken);
      if(internal&&!bridged)return send(401,{error:'인증이 필요합니다.'});
      if(!same(req.headers['x-inbox-proxy-key'],config.proxyKey))return send(403,{error:'허용되지 않은 연결입니다.'});
      const origin=bridged?req.headers['x-inbox-frontend']:req.headers.origin;
      if(origin!==frontend.origin)return send(403,{error:'허용된 사이트에서 다시 요청해 주세요.'});
      if(!internal)headers['Access-Control-Allow-Origin']=frontend.origin;
      if(req.method==='OPTIONS') {
        const requested=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);
        if(internal||!['GET','POST','PATCH','DELETE'].includes(req.headers['access-control-request-method'])||requested.some(h=>!['accept','content-type','authorization','x-inbox-client','x-inbox-applicant'].includes(h)))return send(403,{error:'허용되지 않은 요청입니다.'});
        res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Inbox-Client,X-Inbox-Applicant','Access-Control-Max-Age':'600'});return res.end();
      }
      if(!['GET','POST','PATCH','DELETE'].includes(req.method))return send(405,{error:'지원하지 않는 요청입니다.'});
      const ip=bridged?req.headers['x-inbox-visitor-ip']:req.headers['x-inbox-verified-ip'];
      if(typeof ip!=='string'||!isIP(ip))return send(503,{error:'접속 정보를 확인하지 못했습니다.'});
      if(Number(req.headers['content-length'])>48000)return send(413,{error:'요청이 너무 큽니다.'});
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>48000)return send(413,{error:'요청이 너무 큽니다.'});chunks.push(chunk);}
      const target=bridged?path.pathname.replace(/^\/internal\/(public|admin)/u,''):path.pathname;
      const isAdmin=bridged&&path.pathname.startsWith('/internal/admin/api/admin/blacksmith-inboxes');
      if(!isAdmin&&!/^\/api\/blacksmith-inboxes(?:\/|$)/u.test(target))return send(404,{error:'Not found'});
      const passed=new Headers();
      for(const name of ['content-type','authorization','x-inbox-client','x-inbox-applicant'])if(typeof req.headers[name]==='string')passed.set(name,req.headers[name]);
      passed.set('Origin',frontend.origin);passed.set('CF-Connecting-IP',ip);
      const request=new Request(frontend.origin+target+path.search,{method:req.method,headers:passed,...(size?{body:Buffer.concat(chunks)}:{})});
      const response=isAdmin?await handlers.adminApi(request,database.withSession()):await handlers.publicApi({request,env:{...env,INBOX_RELAY_BLOCKED:relay.isBlocked(ip)?'true':'false',...(country?{INBOX_FOREIGN_BLOCKED:country.isAllowed(ip)?'false':'true'}:{})}});
      for(const name of ['content-type','retry-after'])if(response.headers.has(name))headers[name]=response.headers.get(name);
      res.writeHead(response.status,headers);res.end(Buffer.from(await response.arrayBuffer()));
    }catch{send(503,{error:'대장장이 서비스를 일시적으로 사용할 수 없습니다.'});}
  });
}
