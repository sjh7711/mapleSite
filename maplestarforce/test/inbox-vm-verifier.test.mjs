import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
let mf, calls = 0;
const token = 'a'.repeat(64);
before(async () => {
  const bundle = await build({ stdin: { resolveDir:fileURLToPath(new URL('../',import.meta.url)), contents:`import {onRequest} from './functions/api/internal/blacksmith-verify';export default {fetch(request,env){return onRequest({request,env});}}` }, bundle:true,format:'esm',write:false });
  mf = new Miniflare(convertV4MiniflareOptions({ modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-29',bindings:{INBOX_VM_TOKEN:token,TURNSTILE_SECRET:'fixture'},outboundService:async request=>{
    calls++;assert.equal(request.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body=new URLSearchParams(await request.text());assert.equal(body.get('secret'),'fixture');
    const hostname=body.get('response').startsWith('production')?'starforce.pages.dev':'preview.starforce.pages.dev';
    return Response.json({success:true,action:'inbox_lookup',hostname});
  }}));
});
after(async()=>{await mf?.dispose();});
const check=(host,body,auth=token)=>mf.dispatchFetch(`https://${host}/api/internal/blacksmith-verify`,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('private verifier permits lookup only with authenticated matching production or preview hostname',async()=>{
  for(const [host,prefix] of [['starforce.pages.dev','production'],['preview.starforce.pages.dev','preview']]) {
    const body={hostname:host,action:'inbox_lookup',token:`${prefix}-fixture`,remoteip:'192.0.2.1'};
    const response=await check(host,body);assert.equal(response.status,200);assert.equal((await response.json()).success,true);
    const count=calls;
    assert.equal((await check(host,body,'b'.repeat(64))).status,401);
    assert.equal((await check(host,{...body,hostname:host==='starforce.pages.dev'?'preview.starforce.pages.dev':'starforce.pages.dev'})).status,400);
    assert.equal((await check(host,{...body,action:'unapproved_action'})).status,400);
    assert.equal(calls,count);
  }
  assert.equal((await check('attacker.test',{hostname:'attacker.test',action:'inbox_lookup',token:'fixture',remoteip:'192.0.2.1'})).status,404);
});
