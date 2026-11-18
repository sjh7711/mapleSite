// Sliding one-minute windows, bounded memory and no database writes for polling
// or rejected requests. Strict admission quotas remain SQLite transactions.
export function createTrafficLimiter({now=Date.now,maxKeys=100000}={}) {
  const buckets=new Map();let sweeps=0;
  function take(key,limit) {
    const time=now(),old=buckets.get(key)??[];let first=0;
    if(buckets.size>=maxKeys)for(const [id,entries] of buckets){if(entries.at(-1)>time-60000)break;buckets.delete(id);}
    while(first<old.length&&old[first]<=time-60000)first++;
    const recent=first?old.slice(first):old;
    if(recent.length>=limit)return false;
    if(!buckets.has(key)&&buckets.size>=maxKeys)return false;
    recent.push(time);buckets.delete(key);buckets.set(key,recent);
    if(++sweeps%256===0)for(const [id,entries] of buckets){if(entries.at(-1)>time-60000)break;buckets.delete(id);}
    return true;
  }
  return {async fetch(_url,options){
    const read=options.method==='GET',headers=new Headers(options.headers),client=headers.get('X-Traffic-Client'),ip=headers.get('X-Traffic-IP');
    const allowed=take(`${read?'r':'w'}:ip:${ip}`,read?300:120)&&take(`${read?'r':'w'}:client:${client}`,read?60:20);
    return new Response(null,{status:allowed?204:429});
  }};
}
