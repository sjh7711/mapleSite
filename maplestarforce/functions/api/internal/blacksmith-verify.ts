import { AdminError, adminFailure, adminJson, isRecord, readAdminJson } from "../../_lib/starforce-admin";

// The existing Turnstile secret stays in Cloudflare. Only low-volume creation,
// submission and edits use Siteverify; polling and database work run on the VM.
export const onRequest: PagesFunction<Env> = async ({request,env}) => {
  try {
    const token = (env as Env & { INBOX_VM_TOKEN?:string }).INBOX_VM_TOKEN;
    const supplied=request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1];
    if(!token || !supplied || !crypto.subtle.timingSafeEqual(new TextEncoder().encode(token),new TextEncoder().encode(supplied))) throw new AdminError(401,"인증이 필요합니다.");
    const hostname=new URL(request.url).hostname;
    if(!["preview.starforce.pages.dev","starforce.pages.dev"].includes(hostname) || request.method!=="POST") throw new AdminError(404,"Not found");
    const body=await readAdminJson(request,4096);
    if(!isRecord(body) || body.hostname!==hostname || !["inbox_create","inbox_submit","inbox_lookup"].includes(String(body.action)) || typeof body.token!=="string" || !body.token || body.token.length>2048 || typeof body.remoteip!=="string" || body.remoteip.length>64) throw new AdminError(400,"검증 요청을 확인해 주세요.");
    const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:body.token,remoteip:body.remoteip})});
    if(!response.ok)throw new AdminError(503,"봇 확인에 연결하지 못했습니다.");
    const result=await response.json() as {success?:boolean;action?:string;hostname?:string};
    return adminJson({success:result.success===true && result.action===body.action && result.hostname===body.hostname,action:result.action,hostname:result.hostname});
  }catch(error){return adminFailure(error);}
};
