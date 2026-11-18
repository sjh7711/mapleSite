import {DatabaseSync,backup} from 'node:sqlite';
import {readFile,mkdir,readdir,stat,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
process.umask(0o077);
const config=JSON.parse(await readFile(process.env.INBOX_API_CONFIG,'utf8'));
const directory=join(dirname(config.database),'backups');await mkdir(directory,{recursive:true,mode:0o700});
const source=new DatabaseSync(config.database,{readOnly:true});
const name='inbox-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
try{await backup(source,join(directory,name));}finally{source.close();}
for(const name of await readdir(directory))if(/^inbox-[\dTZ.\-]+\.sqlite$/u.test(name)){
  const path=join(directory,name);if((await stat(path)).mtimeMs<Date.now()-86400000)await unlink(path);
}
console.log('Private inbox SQLite backup completed (24-hour rolling retention)');
