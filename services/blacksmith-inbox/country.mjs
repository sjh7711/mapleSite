import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {address} from './private-relay.mjs';

// DB-IP Country Lite, CC BY 4.0. Only Korean intervals are retained in memory.
// The applicant page attributes DB-IP; visitor IPs never leave this VM for lookup.
export function compileKoreanRanges(csv) {
  const ranges={4:[],6:[]};let rows=0;
  for(const [line] of csv.matchAll(/[^\r\n]+/gu)) {
    const match=/^"?([\da-fA-F:.]+)"?,"?([\da-fA-F:.]+)"?,"?([A-Z]{2})"?$/u.exec(line);
    if(!match)throw new Error('Invalid country database');
    rows++;
    if(match[3]!=='KR')continue;
    const start=address(match[1]),end=address(match[2]);
    if(!start||!end||start.version!==end.version||start.n>end.n)throw new Error('Invalid Korean IP interval');
    ranges[start.version].push([start.n,end.n]);
  }
  for(const version of [4,6]) {
    const sorted=ranges[version].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),merged=[];
    for(const next of sorted){const last=merged.at(-1);if(last&&next[0]<=last[1]+1n){if(next[1]>last[1])last[1]=next[1];}else merged.push(next);}
    ranges[version]=merged;
  }
  return {rows,intervals:ranges[4].length+ranges[6].length,isAllowed(value){
    let ip=address(value);if(!ip)return false;
    if(ip.version===6&&ip.n>>32n===65535n)ip={version:4,n:ip.n&4294967295n};
    const list=ranges[ip.version];let low=0,high=list.length-1;
    while(low<=high){const middle=(low+high)>>1,[start,end]=list[middle];if(ip.n<start)high=middle-1;else if(ip.n>end)low=middle+1;else return true;}
    return false;
  }};
}
export const countryFeed = (date) => `https://download.db-ip.com/free/dbip-country-lite-${date.toISOString().slice(0,7)}.csv.gz`;
export async function createCountryPolicy(cachePath,{fetchImpl=fetch,now=()=>Date.now(),minimumRows=100000,minimumIntervals=100}={}) {
  const compile=bytes=>{
    const next=compileKoreanRanges(gunzipSync(bytes,{maxOutputLength:64000000}).toString('utf8'));
    if(next.rows<minimumRows||next.rows>2000000||next.intervals<minimumIntervals)throw new Error('Incomplete country database');
    return next;
  };
  let snapshot,updatedAt=0,refreshing=false;
  try {snapshot=compile(await readFile(cachePath));updatedAt=(await stat(cachePath)).mtimeMs;}catch{/* A valid download is required before accepting applications. */}
  const refresh=async()=>{
    if(refreshing)return;refreshing=true;
    try {
      let bytes;
      for(let months=0;months<2;months++) {
        const date=new Date(now());date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-months);
        const response=await fetchImpl(countryFeed(date),{redirect:'error',signal:AbortSignal.timeout(30000)});
        if(response.status===404&&months===0)continue;
        if(!response.ok||Number(response.headers.get('content-length'))>16000000)throw new Error('Country database unavailable');
        const reader=response.body.getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16000000){await reader.cancel();throw new Error('Country database too large');}chunks.push(Buffer.from(value));}
        bytes=Buffer.concat(chunks);break;
      }
      if(!bytes)throw new Error('Country database unavailable');
      const next=compile(bytes);
      await writeFile(cachePath+'.tmp',bytes,{mode:0o600});await rename(cachePath+'.tmp',cachePath);
      snapshot=next;updatedAt=now();
    }finally{refreshing=false;}
  };
  if(!snapshot||now()-updatedAt>=86400000)try{await refresh();}catch(error){if(!snapshot)throw error;console.error('Country database refresh failed; retained last valid list');}
  const timer=setInterval(()=>void refresh().catch(()=>console.error('Country database refresh failed; retained last valid list')),86400000);timer.unref();
  return {isAllowed:ip=>snapshot.isAllowed(ip),close:()=>clearInterval(timer),get intervals(){return snapshot.intervals;}};
}
