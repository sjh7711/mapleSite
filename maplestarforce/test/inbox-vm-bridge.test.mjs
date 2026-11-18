import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
let mf;
const key='a'.repeat(64);
before(async()=>{
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`import {proxyInboxRequest} from './functions/_lib/blacksmith-inbox-vm';export default {async fetch(request,env){try{return await proxyInboxRequest(request,env,'public')??new Response('local');}catch(e){return Response.json({error:e.message},{status:500});}}}`},bundle:true,format:'esm',write:false});
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-29',bindings:{INBOX_VM_ORIGIN:'https://maple.hoegifarm.duckdns.org/starforce-preview-api',INBOX_VM_TOKEN:key},outboundService:async request=>{
    assert.equal(request.url,'https://maple.hoegifarm.duckdns.org/starforce-preview-api/internal/public/api/blacksmith-inboxes/config');
    assert.equal(request.headers.get('X-Inbox-Bridge'),key);assert.equal(request.headers.get('Cookie'),null);
    assert.equal(request.headers.get('X-Inbox-Frontend'),'https://preview.starforce.pages.dev');
    assert.equal(request.headers.get('X-Inbox-Visitor-IP'),'192.0.2.1');
    return Response.json({ok:true},{headers:{'Access-Control-Allow-Origin':'https://preview.starforce.pages.dev'}});
  }}));
});
after(async()=>{await mf?.dispose();});
test('Pages legacy bridge authenticates VM without forwarding administrator cookies',async()=>{
  const response=await mf.dispatchFetch('https://preview.starforce.pages.dev/api/blacksmith-inboxes/config',{headers:{Cookie:'private-admin-session=fixture','CF-Connecting-IP':'192.0.2.1'}});
  assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.deepEqual(await response.json(),{ok:true});
});
