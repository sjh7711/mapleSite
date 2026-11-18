import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('실제 내부 Worker 바인딩에서 조회·변경 및 IP 보조 제한을 각각 적용한다',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const config=JSON.parse(await readFile(new URL('../workers/inbox-cleanup/wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
  const bundle=await build({entryPoints:[root+'workers/inbox-cleanup/index.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
  const mf=new Miniflare(convertV4MiniflareOptions({name:'inbox-traffic-tests',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-29', // Installed local workerd predates the deployment compatibility date.
    
    ratelimits:Object.fromEntries(config.ratelimits.map(({name,...binding})=>[name,binding]))}));
  const call=(method='GET',client='a'.repeat(64),ip='b'.repeat(64))=>mf.dispatchFetch('https://internal.test/',{method,headers:{'X-Traffic-Client':client,'X-Traffic-IP':ip}});
  try {
    assert.equal((await mf.dispatchFetch('https://internal.test/')).status,400);
    for(let n=0;n<60;n++)assert.equal((await call()).status,204);
    assert.equal((await call()).status,429);
    assert.equal((await call('GET','c'.repeat(64))).status,204,'같은 IP의 다른 정상 브라우저는 허용');
    for(let n=0;n<20;n++)assert.equal((await call('POST')).status,204);
    assert.equal((await call('POST')).status,429);
    // New browser keys do not escape the coarse IP cap.
    const ip='d'.repeat(64);
    for(let n=0;n<120;n++)assert.equal((await call('POST',n.toString(16).padStart(64,'0'),ip)).status,204);
    assert.equal((await call('POST','f'.repeat(64),ip)).status,429);
  } finally {await mf.dispose();}
});
