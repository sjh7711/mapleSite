// Run only against a trusted Wrangler export, while preview is in maintenance.
// Refuse to replace a live database. Output aggregates only, never user data.
import {DatabaseSync} from 'node:sqlite';
import {readFile,open,chmod,unlink} from 'node:fs/promises';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw new Error('Usage: node import-d1.mjs private-export.sql new-database.sqlite');
const file=await open(destination,'wx',0o600);await file.close();
const db=new DatabaseSync(destination);
try {
  db.exec(await readFile(source,'utf8'));
  db.exec('PRAGMA foreign_keys=ON');
  const problems=db.prepare('PRAGMA foreign_key_check').all();if(problems.length)throw new Error('Imported foreign key check failed');
  const tables=['blacksmith_inboxes','blacksmith_requests','blacksmith_inbox_history','blacksmith_submissions','blacksmith_creator_ip_blocks'];
  const counts=Object.fromEntries(tables.map(name=>[name,db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n]));
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Imported integrity check failed');
  console.log(JSON.stringify({imported:true,counts}));
} catch(error){db.close();await unlink(destination);throw error;}
db.close();await chmod(destination,0o600);
