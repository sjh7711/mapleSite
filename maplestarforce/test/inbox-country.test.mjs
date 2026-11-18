import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {compileKoreanRanges,createCountryPolicy,countryFeed} from '../tools/inbox-api/country.mjs';

const csv='1.201.0.0,1.201.0.127,KR\n1.201.0.128,1.201.0.255,KR\n8.8.8.0,8.8.8.255,US\n2001:db8::,2001:db8::ffff,KR\n';
test('country policy handles Korean IPv4, IPv6, mapped IPv4 and boundary/foreign IPs',()=>{
  const policy=compileKoreanRanges(csv);assert.equal(policy.rows,4);assert.equal(policy.intervals,2);
  for(const ip of ['1.201.0.0','1.201.0.255','::ffff:1.201.0.2','2001:db8::','2001:db8::ffff'])assert.equal(policy.isAllowed(ip),true,ip);
  for(const ip of ['1.200.255.255','1.201.1.0','8.8.8.8','2001:db8::1:0','invalid','127.0.0.1'])assert.equal(policy.isAllowed(ip),false,ip);
  assert.throws(()=>compileKoreanRanges('invalid'));
  assert.throws(()=>compileKoreanRanges('1.201.0.255,1.201.0.0,KR'));
  assert.equal(countryFeed(new Date('2026-11-03T00:00:00Z')),'https://download.db-ip.com/free/dbip-country-lite-2026-11.csv.gz');
});
test('country downloader falls back to last month, validates data and retains a valid cache',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'inbox-country-')),cache=join(directory,'country.csv.gz');
  const now=()=>Date.parse('2026-11-03T00:00:00Z'),calls=[];
  try {
    const policy=await createCountryPolicy(cache,{now,minimumRows:1,minimumIntervals:1,fetchImpl:async url=>{
      calls.push(url);return url.includes('2026-11')?new Response(null,{status:404}):new Response(gzipSync(csv));
    }});
    assert.equal(policy.isAllowed('1.201.0.1'),true);policy.close();assert.equal(calls.length,2);
    assert.equal((await stat(cache)).mode&0o777,0o600);
    const cached=await createCountryPolicy(cache,{now:()=>Date.now()+86400001,minimumRows:1,minimumIntervals:1,fetchImpl:async()=>{throw new Error('offline');}});
    assert.equal(cached.isAllowed('1.201.0.1'),true);cached.close();
    const missing=join(directory,'missing.gz');
    await assert.rejects(createCountryPolicy(missing,{fetchImpl:async()=>new Response(gzipSync(csv))}));
    await writeFile(missing,'corrupt');
    await assert.rejects(createCountryPolicy(missing,{fetchImpl:async()=>{throw new Error('offline');}}));
  }finally{await rm(directory,{recursive:true,force:true});}
});
