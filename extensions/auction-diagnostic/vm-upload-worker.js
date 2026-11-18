// A separate durable outbox survives manager tab closure, browser restarts,
// local backup completion, and MV3 service-worker suspension.
const DATABASE = "mapleAuctionVmUploadV1";
const ALARM = "mapleAuctionVmUploadRetry";
const STATUS = "mapleAuctionVmUploadStatus";
let running = false;
let configPromise;
const configuration = () => configPromise ||= fetch(chrome.runtime.getURL("vm-upload-config.json"))
  .then((response) => response.ok ? response.json() : {})
  .catch(() => ({}));

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("outbox", { keyPath: "sha256" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function store(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("outbox", mode);
      const request = operation(transaction.objectStore("outbox"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("outbox_aborted"));
    });
  } finally { db.close(); }
}
async function status(values = {}) {
  const previous = (await chrome.storage.local.get(STATUS))[STATUS] || {};
  const pending = await store("readonly", (outbox) => outbox.count());
  const config = await configuration();
  const result = { ...previous, ...values, pending, configured: Boolean(config.endpoint && config.token) };
  await chrome.storage.local.set({ [STATUS]: result });
  return result;
}
async function arm() {
  await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
async function drain() {
  if (running) return;
  running = true;
  try {
    const config = await configuration();
    if (!config.endpoint || !config.token) { await status(); return; }
    const records = await store("readonly", (outbox) => outbox.getAll(null, 10));
    if (!records.length) { await status(); return; }
    // The fixed address only returns the tunnel hostname. Capture bytes go
    // directly through Cloudflare Tunnel to the VM, never via the Worker.
    let origin;
    try {
      const route = await fetch(`${config.endpoint}/route`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(10000), redirect: "error", cache: "no-store",
      });
      if (!route.ok) throw new Error(`주소 확인 HTTP ${route.status}`);
      origin = (await route.json()).origin;
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/u.test(origin)) throw new Error("invalid_tunnel_address");
    } catch (error) { await status({ lastError: error.message }); return; }
    let sent = 0;
    for (const record of records.slice(0, 20)) {
      try {
        const response = await fetch(`${origin}/upload`, {
          method: "POST", headers: {
            Authorization: `Bearer ${config.token}`, "Content-Type": "application/x-ndjson",
            "X-Content-SHA256": record.sha256,
          },
          body: record.text, redirect: "error", signal: AbortSignal.timeout(25000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const receipt = await response.json();
        if (!receipt.ok || receipt.sha256 !== record.sha256) throw new Error("저장 확인 응답 불일치");
        await store("readwrite", (outbox) => outbox.delete(record.sha256));
        sent += 1;
        await status({ lastSuccessAt: new Date().toISOString(), lastError: "" });
      } catch (error) {
        await status({ lastError: String(error.message || error), lastAttemptAt: new Date().toISOString() });
        // Do not let an invalid record prevent other valid captures uploading.
        if (!/^HTTP 4\d\d/u.test(error.message)) break;
      }
    }
    if (sent) await status();
  } finally { running = false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !String(message?.type || "").startsWith("MAPLE_VM_UPLOAD_")) return false;
  (async () => {
    await arm();
    if (message.type === "MAPLE_VM_UPLOAD_QUEUE") {
      const config = await configuration();
      if (!config.endpoint || !config.token) return { ok: true, disabled: true };
      if (typeof message.text !== "string" || !/^[a-f0-9]{64}$/u.test(message.sha256 || "")) throw new Error("invalid_capture");
      await store("readwrite", (outbox) => outbox.put({ sha256: message.sha256, text: message.text, queuedAt: Date.now() }));
      await status();
      return { ok: true, queued: true };
    }
    return { ok: true, status: await status() };
  })().then((result) => {
    sendResponse(result);
    if (message.type !== "MAPLE_VM_UPLOAD_STATUS") void drain().catch(() => {});
  }, (error) => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void drain().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { void arm().then(drain).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void arm().then(drain).catch(() => {}); });
