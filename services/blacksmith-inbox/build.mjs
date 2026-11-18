import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const sitePackage = new URL('../../maplestarforce/package.json', import.meta.url);
const { build } = createRequire(sitePackage)('esbuild');
const root=fileURLToPath(new URL('.',sitePackage));
await mkdir(new URL('./.build',import.meta.url),{recursive:true});
await build({stdin:{resolveDir:root,contents:`
  export {onRequest as publicApi} from './functions/api/blacksmith-inboxes/[[path]].ts';
  export {handleInboxAdmin as adminApi} from './functions/api/admin/blacksmith-inboxes/[[path]].ts';
  export {purgeExpiredInboxes,purgeInboxHistory} from './functions/_lib/blacksmith-inbox-expiry.ts';
`},bundle:true,format:'esm',platform:'node',target:'node22',outfile:fileURLToPath(new URL('./.build/handlers.mjs',import.meta.url))});
