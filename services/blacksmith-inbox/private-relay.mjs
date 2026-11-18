import {isIP} from 'node:net';
import {readFile,writeFile,rename} from 'node:fs/promises';

export const PRIVATE_RELAY_FEED='https://mask-api.icloud.com/egress-ip-ranges.csv';
export function address(value) {
  const version=isIP(value);if(!version)return null;
  if(version===4)return {version,n:value.split('.').reduce((n,x)=>(n<<8n)|BigInt(x),0n)};
  let text=value.toLowerCase();
  if(text.includes('.')){const i=text.lastIndexOf(':'),v=address(text.slice(i+1)).n;text=text.slice(0,i+1)+(v>>16n).toString(16)+':'+(v&65535n).toString(16);}
  const halves=text.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
  const groups=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  return {version,n:groups.reduce((n,x)=>(n<<16n)|BigInt('0x'+x),0n)};
}
export function compileRelayRanges(csv) {
  const ranges={4:[],6:[]};let rows=0;
  for(const line of csv.split(/\r?\n/u)) {
    if(!line.trim())continue;
    const cidr=line.slice(0,line.indexOf(',')===-1?line.length:line.indexOf(',')).trim(),parts=cidr.split('/'),ip=address(parts[0]),prefix=Number(parts[1]);
    if(parts.length!==2||!ip||!/^\d{1,3}$/u.test(parts[1])||prefix<(ip.version===4?8:16)||prefix>(ip.version===4?32:128))throw new Error('Invalid Apple relay feed');
    const shift=BigInt((ip.version===4?32:128)-prefix),start=(ip.n>>shift)<<shift;
    ranges[ip.version].push([start,start+(1n<<shift)-1n]);rows++;
  }
  for(const version of [4,6]) {
    const sorted=ranges[version].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),merged=[];
    for(const range of sorted){const last=merged.at(-1);if(last&&range[0]<=last[1]+1n){if(range[1]>last[1])last[1]=range[1];}else merged.push(range);}
    ranges[version]=merged;
  }
  return {rows,intervals:ranges[4].length+ranges[6].length,isBlocked(value){
    let ip=address(value);if(!ip)return false;
    if(ip.version===6&&ip.n>>32n===65535n)ip={version:4,n:ip.n&4294967295n};
    const list=ranges[ip.version];let lo=0,hi=list.length-1;
    while(lo<=hi){const mid=(lo+hi)>>1,[start,end]=list[mid];if(ip.n<start)hi=mid-1;else if(ip.n>end)lo=mid+1;else return true;}
    return false;
  }};
}
export async function createRelayBlocker(cachePath) {
  let snapshot;
  const refresh=async()=>{
    const response=await fetch(PRIVATE_RELAY_FEED,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok||Number(response.headers.get('content-length'))>32000000)throw new Error('Apple relay feed unavailable');
    const reader=response.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32000000){await reader.cancel();throw new Error('Apple relay feed too large');}chunks.push(Buffer.from(value));}
    const text=Buffer.concat(chunks).toString('utf8'),next=compileRelayRanges(text);
    if(next.rows<10||next.rows>1000000||!next.intervals)throw new Error('Incomplete Apple relay feed');
    await writeFile(cachePath+'.tmp',text,{mode:0o600});await rename(cachePath+'.tmp',cachePath);snapshot=next;
  };
  try{await refresh();}catch(error){snapshot=compileRelayRanges(await readFile(cachePath,'utf8'));if(snapshot.rows<10)throw error;console.error('Apple relay feed refresh failed; retained last valid list');}
  const timer=setInterval(()=>void refresh().catch(()=>console.error('Apple relay feed refresh failed; retained last valid list')),86400000);timer.unref();
  return {isBlocked:ip=>snapshot.isBlocked(ip),close:()=>clearInterval(timer),get intervals(){return snapshot.intervals;}};
}
