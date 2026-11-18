import { Worker } from 'node:worker_threads';

export async function openInboxDatabase(path,migrations) {
  const worker=new Worker(new URL('./sqlite-worker.mjs',import.meta.url),{workerData:{path,migrations},execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type'))});
  let serial=0,closed=false;const pending=new Map();
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  function fail(error){closed=true;readyReject(error);for(const task of pending.values())task.reject(error);pending.clear();}
  worker.on('error',fail);worker.on('exit',code=>{if(!closed)fail(new Error(`SQLite worker exited (${code})`));});
  worker.on('message',message=>{
    if(message.ready){readyResolve();return;}
    const task=pending.get(message.id);if(!task)return;pending.delete(message.id);
    if(message.error){const error=new Error(message.error.message);error.code=message.error.code;task.reject(error);}else task.resolve(message.result);
  });
  await ready;
  const rpc=(op,statements=[])=>new Promise((resolve,reject)=>{
    if(closed)return reject(new Error('SQLite worker unavailable'));
    if(pending.size>=2048)return reject(new Error('SQLite queue full'));
    const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,op,statements});
  });
  class Statement {
    constructor(sql,args=[]){this.sql=sql;this.args=args;}
    bind(...args){return new Statement(this.sql,args);}
    first(column){return rpc('query',[{...this,mode:'first'}]).then(row=>column?row?.[column]??null:row);}
    all(){return rpc('query',[this]);}
    run(){return rpc('query',[this]);}
  }
  const database={prepare:sql=>new Statement(sql),batch:statements=>rpc('batch',statements),withSession:()=>database,
    async close(){await rpc('close');closed=true;await worker.terminate();}};
  return database;
}
