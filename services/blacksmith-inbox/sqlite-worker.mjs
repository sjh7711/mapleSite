import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

await mkdir(dirname(workerData.path),{recursive:true,mode:0o700});
const db=new DatabaseSync(workerData.path);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS vm_inbox_migrations(name TEXT PRIMARY KEY)');
const imported=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get();
if(imported)for(const row of db.prepare('SELECT name FROM d1_migrations').all())db.prepare('INSERT OR IGNORE INTO vm_inbox_migrations VALUES (?)').run(row.name);
for(const name of (await readdir(workerData.migrations)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) {
  if(db.prepare('SELECT 1 FROM vm_inbox_migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN IMMEDIATE');
  try {db.exec(await readFile(join(workerData.migrations,name),'utf8'));db.prepare('INSERT INTO vm_inbox_migrations VALUES (?)').run(name);db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
}
const cache=new Map();
function execute({sql,args=[],mode='all'}) {
  let statement=cache.get(sql);
  if(!statement){statement=db.prepare(sql);if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(sql,statement);}
  const changesBefore=db.prepare('SELECT total_changes() AS n').get().n;
  const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);
  const meta={changes:db.prepare('SELECT changes() AS n').get().n,total_changes:db.prepare('SELECT total_changes() AS n').get().n-changesBefore};
  if(mode==='first')return rows[0]??null;
  return {success:true,results:rows,meta};
}
parentPort.on('message',({id,op,statements})=>{
  try {
    if(op==='close'){db.close();parentPort.postMessage({id,result:true});parentPort.close();return;}
    if(op==='batch')db.exec('BEGIN IMMEDIATE');
    let result;
    try {result=statements.map(execute);if(op==='batch')db.exec('COMMIT');}
    catch(error){if(op==='batch')db.exec('ROLLBACK');throw error;}
    parentPort.postMessage({id,result:op==='batch'?result:result[0]});
  }catch(error){parentPort.postMessage({id,error:{message:error.message,code:error.code}});}
});
parentPort.postMessage({ready:true});
