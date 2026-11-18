// Per-request IP policy flags supplied by the isolated VM APIs.
interface Env { INBOX_RELAY_BLOCKED?: string; INBOX_FOREIGN_BLOCKED?: string; }
declare namespace Cloudflare {
  interface Env { INBOX_RELAY_BLOCKED?: string; INBOX_FOREIGN_BLOCKED?: string; }
}
