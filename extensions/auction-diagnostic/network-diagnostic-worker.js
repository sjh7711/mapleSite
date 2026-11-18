import "./vm-upload-worker.js";
import {
  NETWORK_DIAGNOSTIC_MAX_EVENTS,
  NETWORK_DIAGNOSTIC_SCHEMA_VERSION,
  buildNetworkDiagnosticReport,
  sanitizeNetworkRequestEvent
} from "./tools/network-diagnostic-core.mjs";

const STORAGE_KEY = "mapleAuctionNetworkDiagnosticV1";
const MAX_DURATION_MS = 5 * 60_000;
const MONITORED_URLS = [
  "https://auction.maplestory.nexon.com/*",
  "https://api.mskr.nexon.com/*"
];
let updateQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !String(message?.type || "").startsWith("MAPLE_NETWORK_DIAGNOSTIC_")) {
    return false;
  }
  enqueue(() => handleMessage(message)).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: String(error?.message || error || "network_diagnostic_failed") })
  );
  return true;
});

chrome.webRequest.onCompleted.addListener(
  (details) => { void enqueue(() => appendRequestEvent(details, "completed")); },
  { urls: MONITORED_URLS }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => { void enqueue(() => appendRequestEvent(details, "error")); },
  { urls: MONITORED_URLS }
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => { void enqueue(() => appendRequestEvent(details, "redirect")); },
  { urls: MONITORED_URLS }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const session = await readSession();
    if (!session?.active || session.tab_id !== tabId) return;
    await chrome.storage.session.set({
      [STORAGE_KEY]: {
        ...session,
        active: false,
        finished_at: session.finished_at || new Date().toISOString()
      }
    });
  });
});

function enqueue(operation) {
  const next = updateQueue.then(operation, operation);
  updateQueue = next.catch(() => {});
  return next;
}

async function handleMessage(message) {
  const type = String(message.type || "");
  if (type === "MAPLE_NETWORK_DIAGNOSTIC_START") {
    const tabId = Number(message.tab_id);
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error("invalid_diagnostic_tab");
    await assertAuctionTab(tabId);
    const duration = Math.max(10_000, Math.min(MAX_DURATION_MS, Number(message.duration_ms) || 120_000));
    const now = Date.now();
    const session = {
      schema_version: NETWORK_DIAGNOSTIC_SCHEMA_VERSION,
      extension_version: chrome.runtime.getManifest().version,
      session_id: safeSessionId(message.session_id),
      tab_id: tabId,
      active: true,
      started_at: new Date(now).toISOString(),
      finished_at: null,
      expires_at: new Date(now + duration).toISOString(),
      next_sequence: 1,
      dropped_events: 0,
      events: []
    };
    await chrome.storage.session.set({ [STORAGE_KEY]: session });
    return { report: buildNetworkDiagnosticReport(session) };
  }

  const session = await readSession();
  if (type === "MAPLE_NETWORK_DIAGNOSTIC_GET") {
    if (!session || !messageTargetsSession(message, session)) {
      return { report: null };
    }
    const current = await expireSessionIfNeeded(session);
    return { report: buildNetworkDiagnosticReport(current) };
  }
  if (type === "MAPLE_NETWORK_DIAGNOSTIC_STOP") {
    if (!session || !messageTargetsSession(message, session)) {
      return { report: null };
    }
    const stopped = {
      ...session,
      active: false,
      finished_at: session.finished_at || new Date().toISOString()
    };
    await chrome.storage.session.set({ [STORAGE_KEY]: stopped });
    return { report: buildNetworkDiagnosticReport(stopped) };
  }
  throw new Error("unsupported_network_diagnostic_action");
}

function messageTargetsSession(message, session) {
  const tabId = Number(message.tab_id);
  return Number.isInteger(tabId) && tabId === session.tab_id &&
    (!message.session_id || message.session_id === session.session_id);
}

async function assertAuctionTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https:\/\/auction\.maplestory\.nexon\.com(?:\/|$)/iu.test(String(tab?.url || ""))) {
    throw new Error("diagnostic_tab_is_not_maple_auction");
  }
}

async function appendRequestEvent(details, phase) {
  const session = await readSession();
  if (!session?.active || session.tab_id !== details.tabId) return;
  const current = await expireSessionIfNeeded(session);
  if (!current.active) return;
  const event = sanitizeNetworkRequestEvent(details, phase);
  if (!event) return;
  const events = [...current.events, {
    ...event,
    sequence: current.next_sequence
  }];
  let droppedEvents = current.dropped_events;
  if (events.length > NETWORK_DIAGNOSTIC_MAX_EVENTS) {
    droppedEvents += events.length - NETWORK_DIAGNOSTIC_MAX_EVENTS;
    events.splice(0, events.length - NETWORK_DIAGNOSTIC_MAX_EVENTS);
  }
  await chrome.storage.session.set({
    [STORAGE_KEY]: {
      ...current,
      next_sequence: current.next_sequence + 1,
      dropped_events: droppedEvents,
      events
    }
  });
}

async function readSession() {
  const value = await chrome.storage.session.get(STORAGE_KEY);
  return value?.[STORAGE_KEY] || null;
}

async function expireSessionIfNeeded(session) {
  if (!session.active || Date.parse(session.expires_at || "") > Date.now()) return session;
  const expired = {
    ...session,
    active: false,
    finished_at: session.finished_at || new Date().toISOString()
  };
  await chrome.storage.session.set({ [STORAGE_KEY]: expired });
  return expired;
}

function safeSessionId(value) {
  const normalized = String(value || "");
  if (!/^network-[0-9]+-[a-z0-9]{4,16}$/u.test(normalized)) {
    throw new Error("invalid_network_diagnostic_session");
  }
  return normalized;
}
