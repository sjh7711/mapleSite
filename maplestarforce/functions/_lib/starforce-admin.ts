export const SESSION_COOKIE = "__Host-starforce_admin";
export const SESSION_SECONDS = 4 * 60 * 60;

export class AdminError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function adminJson(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(JSON.stringify(body), { status, headers });
}

export function adminFailure(error: unknown): Response {
  return error instanceof AdminError
    ? adminJson({ ok: false, error: error.message }, error.status)
    : adminJson({ ok: false, error: "관리 서비스를 일시적으로 사용할 수 없습니다." }, 503);
}

export function requireDatabase(env: Env): D1Database {
  if (!env.STARFORCE_CONFIG) throw new AdminError(503, "관리 서비스가 준비되지 않았습니다.");
  return env.STARFORCE_CONFIG;
}

export function requireSameOrigin(request: Request): void {
  if (request.headers.get("Origin") !== new URL(request.url).origin ||
      request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new AdminError(403, "이 사이트에서 다시 요청해주세요.");
  }
}

export async function readAdminJson(request: Request, limit = 16_384): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new AdminError(415, "JSON 요청만 지원합니다.");
  }
  if (Number(request.headers.get("Content-Length")) > limit) throw new AdminError(413, "요청이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError(400, "요청 내용을 확인해주세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AdminError(413, "요청이 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new AdminError(400, "요청 내용을 확인해주세요."); }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function digestHex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieToken(request: Request): string | null {
  const matches = (request.headers.get("Cookie") ?? "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/u.test(token) ? token : null;
}

export async function requireAdmin(request: Request, env: Env): Promise<string> {
  const db = requireDatabase(env);
  if (!/^[a-f0-9]{64}$/u.test(env.STARFORCE_ADMIN_PASSWORD_HASH ?? "")) {
    throw new AdminError(503, "관리 서비스가 준비되지 않았습니다.");
  }
  const token = cookieToken(request);
  if (!token) throw new AdminError(401, "관리자 로그인이 필요합니다.");
  const hash = await digestHex(`${env.STARFORCE_ADMIN_PASSWORD_HASH}:${token}`);
  const session = await db.prepare(
    "SELECT token_hash FROM starforce_admin_sessions WHERE token_hash = ? AND expires_at > ?",
  ).bind(hash, Math.floor(Date.now() / 1000)).first<{ token_hash: string }>();
  if (!session) throw new AdminError(401, "로그인이 만료되었습니다. 다시 로그인해주세요.");
  return hash;
}

export function sessionCookie(token = ""): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}`;
}

export async function createAdminSession(request: Request, env: Env): Promise<Response> {
  requireSameOrigin(request);
  const db = requireDatabase(env);
  const expected = env.STARFORCE_ADMIN_PASSWORD_HASH;
  if (!/^[a-f0-9]{64}$/u.test(expected ?? "")) throw new AdminError(503, "관리 서비스가 준비되지 않았습니다.");
  const now = Math.floor(Date.now() / 1000);
  // A provisioned random 256-bit password is used, not a user-chosen low-entropy password.
  // Keep raw IP addresses and passwords out of the database and application logs.
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const key = await digestHex(`${expected}:${ip}`);
  const attempt = await db.prepare(`
    INSERT INTO starforce_admin_attempts (key_hash, attempts, resets_at) VALUES (?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN resets_at <= ? THEN 1 ELSE attempts + 1 END,
      resets_at = CASE WHEN resets_at <= ? THEN ? ELSE resets_at END
    RETURNING attempts, resets_at
  `).bind(key, now + 900, now, now, now + 900).first<{ attempts: number; resets_at: number }>();
  if (!attempt || attempt.attempts > 10) {
    return adminJson({ ok: false, error: "로그인 시도가 많습니다. 잠시 후 다시 시도해주세요." }, 429,
      { "Retry-After": String(Math.max(1, (attempt?.resets_at ?? now + 900) - now)) });
  }
  const body = await readAdminJson(request, 1_024);
  const password = isRecord(body) && typeof body.password === "string" ? body.password : "";
  const actual = await digestHex(password);
  const actualBytes = Uint8Array.from(actual.match(/.{2}/gu) ?? [], (byte) => parseInt(byte, 16));
  const expectedBytes = Uint8Array.from(expected.match(/.{2}/gu) ?? [], (byte) => parseInt(byte, 16));
  if (!crypto.subtle.timingSafeEqual(actualBytes, expectedBytes)) throw new AdminError(401, "비밀번호를 확인해주세요.");
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.batch([
    db.prepare("DELETE FROM starforce_admin_sessions WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM starforce_admin_attempts WHERE resets_at <= ? OR key_hash = ?").bind(now, key),
    db.prepare("INSERT INTO starforce_admin_sessions (token_hash, expires_at) VALUES (?, ?)").bind(await digestHex(`${expected}:${token}`), now + SESSION_SECONDS),
  ]);
  return adminJson({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}
