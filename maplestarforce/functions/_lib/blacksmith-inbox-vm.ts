import { AdminError, adminJson } from "./starforce-admin";

type VmEnv = { INBOX_VM_ORIGIN?: string; INBOX_VM_TOKEN?: string; INBOX_VM_MAINTENANCE?: string };

// Only legacy frontend requests and low-volume administrator actions use this
// bridge. Both frontends poll their isolated VM database directly.
export async function proxyInboxRequest(request: Request, env: VmEnv, kind: "admin" | "public") {
  if (env.INBOX_VM_MAINTENANCE === "true") return adminJson({error:"대장장이 서버를 이전 중입니다. 잠시 후 다시 시도해 주세요."},503,{"Retry-After":"30"});
  if (!env.INBOX_VM_ORIGIN) return null;
  const base = new URL(env.INBOX_VM_ORIGIN);
  const source = new URL(request.url);
  const paths: Record<string,string> = { "preview.starforce.pages.dev":"/starforce-preview-api", "starforce.pages.dev":"/starforce-api" };
  if (base.origin !== "https://maple.hoegifarm.duckdns.org" || base.pathname !== paths[source.hostname] || base.search || base.hash || !/^[a-f0-9]{64}$/u.test(env.INBOX_VM_TOKEN ?? "")) throw new AdminError(503,"대장장이 서버 연결 설정을 확인해 주세요.");
  const headers = new Headers(request.headers);
  headers.delete("cookie");headers.delete("host");
  headers.set("X-Inbox-Bridge",env.INBOX_VM_TOKEN!);
  headers.set("X-Inbox-Frontend",source.origin);
  // Trust visitor IP only on the authenticated server-to-server bridge.
  headers.set("X-Inbox-Visitor-IP",request.headers.get("CF-Connecting-IP") ?? "");
  const response = await fetch(`${base.href}/internal/${kind}${source.pathname}${source.search}`, {
    method:request.method,headers,redirect:"manual",signal:AbortSignal.timeout(20000),
    ...(["GET","HEAD"].includes(request.method)?{}:{body:request.body}),
  });
  if(response.status>=300 && response.status<400){await response.body?.cancel();throw new AdminError(503,"대장장이 서버 연결을 확인해 주세요.");}
  const output = new Headers(response.headers);
  output.delete("access-control-allow-origin");output.delete("access-control-allow-headers");
  return new Response(response.body,{status:response.status,headers:output});
}
