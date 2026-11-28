/**
 * Prism CUA Browser Bridge MV3 Service Worker (Clean-Room Original, MIT)
 *
 * Autopilot + Hard-Denylist Architecture (v0.9.6):
 * 1. In Autopilot mode (default when prism-cua is enabled), automatically exposes all normal
 *    non-blocked http/https tabs to local CUA Broker without tedious per-tab clicking, seamlessly
 *    following legitimate cross-origin navigations while hard-blocking sensitive URLs.
 * 2. Hard-blocks chrome://*, extension pages, web stores, password vaults (including configured
 *    self-hosted Vaultwarden origin & /admin), and payment card checkouts.
 * 3. Enforces Blind Curtain during Vaultwarden blind autofill: suppresses visible-tab screenshots
 *    until the tab navigates away from the credential-injected login document.
 */
'use strict';

const NATIVE_HOST_NAME = 'com.prism.cua.bridge';
const HEARTBEAT_ALARM = 'prism-cua-nm-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 0.4;
const SESSION_STORAGE_KEY = 'prismArmedTabsV1';
const LOCAL_PREFS_KEY = 'prismBrowserAutopilotPrefsV1';
const BADGE_ARMED_TEXT = 'AUTO';
const BADGE_MANUAL_TEXT = 'ARM';
const BADGE_ARMED_BG = '#059669';

/** @type {Map<number, { tabId: number, windowId: number, armedOrigin: string, url: string, title: string, armedAt: number }>} */
const armedTabs = new Map();
const mutedTabIds = new Set();
let autopilotAllTabs = true;
let dynamicBlockedOrigins = new Set();
let hydrated = false;
let hydratePromise = null;
let nativePort = null;
let lastNativeError = '';
let lastHostNotFoundAt = 0;
let brokerCuaState = 'ARMED_INTERACTIVE';
let currentBrokerLeaseEpoch = 0;

function parseSafeOrigin(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

function checkUrlBlockReason(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) {
    return '空白或受限系统标签页无法授权操控';
  }
  const lower = s.toLowerCase();
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('vivaldi://') ||
    lower.startsWith('opera://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('extension://') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('about:') ||
    lower.startsWith('file://') ||
    lower.startsWith('data:') ||
    lower.startsWith('javascript:')
  ) {
    return '浏览器内部页面与扩展受保护协议禁止授权操控';
  }

  let u;
  try {
    u = new URL(s);
  } catch {
    return '无效的页面 URL，禁止授权操控';
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `不支持的协议 (${u.protocol})，仅允许 http/https 网页`;
  }

  if (dynamicBlockedOrigins.has(u.origin.toLowerCase())) {
    return '自托管 Vaultwarden 密码库受硬隔离保护，禁止 AI 直接访问';
  }

  const host = u.hostname.toLowerCase();
  const fullPath = `${host}${u.pathname.toLowerCase()}`;
  if (
    host === 'chromewebstore.google.com' ||
    fullPath.startsWith('chrome.google.com/webstore') ||
    fullPath.startsWith('microsoftedge.microsoft.com/addons')
  ) {
    return '浏览器官方扩展商店受安全策略保护，禁止授权操控';
  }

  if (
    host === 'passwords.google.com' ||
    (host === 'myaccount.google.com' && /\/(?:security|signinoptions\/password)/i.test(u.pathname)) ||
    /(?:^|\.)(?:1password\.com|bitwarden\.com|lastpass\.com|dashlane\.com)$/i.test(host) ||
    /\/#\/(?:vault|locks)\b/i.test(s)
  ) {
    return '密码库与账号核心凭据页面受硬拦截保护，禁止授权操控';
  }

  if (
    host === 'checkout.stripe.com' ||
    host === 'pay.google.com' ||
    host === 'cashier.alipay.com' ||
    host === 'excashier.alipay.com' ||
    host === 'pay.weixin.qq.com'
  ) {
    return '支付收银台页面受硬拦截保护，请人工完成支付';
  }

  return '';
}

async function setBadgeForTab(tabId, text = '') {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_ARMED_BG });
      if (typeof chrome.action.setBadgeTextColor === 'function') {
        await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
      }
    }
  } catch {}
}

async function persistArmedTabs() {
  const serialized = {};
  for (const [tabId, info] of armedTabs.entries()) {
    serialized[String(tabId)] = info;
  }
  try {
    await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: serialized });
  } catch {}
}

async function persistLocalPrefs() {
  try {
    await chrome.storage.local.set({
      [LOCAL_PREFS_KEY]: {
        autopilotAllTabs,
        mutedTabIds: Array.from(mutedTabIds)
      }
    });
  } catch {}
}

async function collectAvailableTabsPayload() {
  if (!autopilotAllTabs) {
    const list = [];
    for (const info of armedTabs.values()) {
      list.push({
        tabId: info.tabId,
        id: info.tabId,
        windowId: info.windowId,
        origin: info.armedOrigin,
        armedOrigin: info.armedOrigin,
        url: info.url,
        title: info.title,
        active: false,
        auto: false,
        armedAt: info.armedAt
      });
    }
    return list;
  }

  let allTabs = [];
  try {
    allTabs = await chrome.tabs.query({});
  } catch {
    allTabs = [];
  }
  const out = [];
  for (const t of allTabs) {
    if (!t || !Number.isInteger(t.id) || t.id <= 0) continue;
    if (mutedTabIds.has(t.id)) continue;
    if (checkUrlBlockReason(t.url)) continue;
    const orig = parseSafeOrigin(t.url);
    if (!orig) continue;
    out.push({
      tabId: t.id,
      id: t.id,
      windowId: t.windowId ?? 0,
      origin: orig,
      armedOrigin: orig,
      url: t.url || '',
      title: String(t.title || '').slice(0, 160),
      active: Boolean(t.active),
      auto: true,
      armedAt: Date.now()
    });
  }
  // Sort active tabs first so Broker defaults to foreground tab
  out.sort((a, b) => Number(b.active) - Number(a.active));
  return out;
}

async function ensureHydrated() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const localStored = await chrome.storage.local.get(LOCAL_PREFS_KEY);
      const lp = localStored?.[LOCAL_PREFS_KEY];
      if (lp && typeof lp === 'object') {
        if (typeof lp.autopilotAllTabs === 'boolean') autopilotAllTabs = lp.autopilotAllTabs;
        if (Array.isArray(lp.mutedTabIds)) {
          for (const id of lp.mutedTabIds) {
            if (Number.isInteger(id) && id > 0) mutedTabIds.add(id);
          }
        }
      }
    } catch {}

    try {
      const stored = await chrome.storage.session.get(SESSION_STORAGE_KEY);
      const rawMap = stored?.[SESSION_STORAGE_KEY];
      if (rawMap && typeof rawMap === 'object') {
        for (const [k, val] of Object.entries(rawMap)) {
          const tabId = Number(k);
          if (!Number.isInteger(tabId) || tabId <= 0 || !val || typeof val !== 'object') continue;
          try {
            const liveTab = await chrome.tabs.get(tabId);
            const liveOrigin = parseSafeOrigin(liveTab?.url);
            if (liveTab && !checkUrlBlockReason(liveTab.url) && liveOrigin && liveOrigin === val.armedOrigin) {
              armedTabs.set(tabId, {
                tabId,
                windowId: liveTab.windowId ?? val.windowId ?? 0,
                armedOrigin: val.armedOrigin,
                url: liveTab.url || val.url || '',
                title: liveTab.title || val.title || '',
                armedAt: Number(val.armedAt) || Date.now()
              });
              await setBadgeForTab(tabId, BADGE_MANUAL_TEXT);
            }
          } catch {}
        }
      }
      await persistArmedTabs();
    } catch {}
    hydrated = true;
    hydratePromise = null;
    await syncLifecycle();
  })();
  return hydratePromise;
}

function postNativeSafe(payload) {
  if (!nativePort) return false;
  try {
    nativePort.postMessage(payload);
    return true;
  } catch (err) {
    lastNativeError = String(err?.message || err);
    nativePort = null;
    return false;
  }
}

async function sendSyncArmedTabs() {
  const list = await collectAvailableTabsPayload();
  postNativeSafe({
    type: 'sync_armed_tabs',
    extensionId: chrome.runtime.id,
    version: '0.9.6',
    autopilotAllTabs,
    ts: Date.now(),
    tabs: list,
    armedTabs: list
  });
}

function ensureNativeConnected() {
  if (nativePort) return true;
  if (Date.now() - lastHostNotFoundAt < 15000) return false;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativePort = port;
    lastNativeError = '';

    port.onMessage.addListener((msg) => {
      handleNativeMessage(msg).catch((err) => {
        if (msg && msg.id !== undefined) {
          postNativeSafe({
            type: 'cmd_result',
            id: msg.id,
            ok: false,
            result: { ok: false, code: 'INTERNAL_BRIDGE_ERROR', error: String(err?.message || err) }
          });
        }
      });
    });

    port.onDisconnect.addListener(() => {
      const errMsg = chrome.runtime?.lastError?.message || '';
      if (errMsg) {
        lastNativeError = errMsg;
        if (/not found|forbidden|specified native messaging host/i.test(errMsg)) {
          lastHostNotFoundAt = Date.now();
        }
      }
      if (nativePort === port) {
        nativePort = null;
      }
    });

    void sendSyncArmedTabs();
    return true;
  } catch (err) {
    lastNativeError = String(err?.message || err);
    nativePort = null;
    return false;
  }
}

function disconnectNativeIfIdle() {
  if (autopilotAllTabs || armedTabs.size > 0) return;
  if (nativePort) {
    try {
      nativePort.postMessage({
        type: 'sync_armed_tabs',
        extensionId: chrome.runtime.id,
        version: '0.9.6',
        ts: Date.now(),
        tabs: [],
        armedTabs: []
      });
    } catch {}
    try {
      nativePort.disconnect();
    } catch {}
    nativePort = null;
  }
  chrome.alarms.clear(HEARTBEAT_ALARM).catch(() => {});
}

async function syncLifecycle() {
  if (autopilotAllTabs || armedTabs.size > 0) {
    ensureNativeConnected();
    await sendSyncArmedTabs();
    try {
      const existing = await chrome.alarms.get(HEARTBEAT_ALARM);
      if (!existing) {
        chrome.alarms.create(HEARTBEAT_ALARM, {
          delayInMinutes: HEARTBEAT_PERIOD_MINUTES,
          periodInMinutes: HEARTBEAT_PERIOD_MINUTES
        });
      }
    } catch {}
  } else {
    disconnectNativeIfIdle();
  }
}

function notifyTabContentAgentArmed(tabId, isArmed) {
  if (!Number.isInteger(tabId) || tabId <= 0) return;
  try {
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: (active) => {
          if (window.__prismCuaContentAgent && typeof window.__prismCuaContentAgent.setArmedState === 'function') {
            window.__prismCuaContentAgent.setArmedState(active);
          }
        },
        args: [Boolean(isArmed)]
      })
      .catch(() => {});
  } catch {}
}

async function disarmSingleTab(tabId, { reason = 'manual', muteInAutopilot = false } = {}) {
  const numId = Number(tabId);
  if (muteInAutopilot) {
    mutedTabIds.add(numId);
    await persistLocalPrefs();
  }
  const existed = armedTabs.delete(numId);
  await setBadgeForTab(numId, '');
  notifyTabContentAgentArmed(numId, false);
  if (existed) {
    await persistArmedTabs();
  }
  await sendSyncArmedTabs();
  if (!autopilotAllTabs && armedTabs.size === 0) {
    disconnectNativeIfIdle();
  }
  return { ok: true, disarmed: existed || muteInAutopilot, reason, armedCount: armedTabs.size };
}

async function disarmAllTabs({ reason = 'manual_all', disableAutopilot = false } = {}) {
  if (disableAutopilot) {
    autopilotAllTabs = false;
    await persistLocalPrefs();
  }
  const ids = Array.from(armedTabs.keys());
  armedTabs.clear();
  for (const id of ids) {
    notifyTabContentAgentArmed(id, false);
  }
  await Promise.all(ids.map((id) => setBadgeForTab(id, '')));
  await persistArmedTabs();
  if (!autopilotAllTabs) {
    disconnectNativeIfIdle();
  } else {
    await sendSyncArmedTabs();
  }
  return { ok: true, disarmedCount: ids.length, reason, armedCount: 0, autopilotAllTabs };
}

async function armTabByUserGesture(tab) {
  if (!tab || !Number.isInteger(tab.id) || tab.id <= 0) {
    return { ok: false, error: '无法识别当前活跃标签页' };
  }
  const blockReason = checkUrlBlockReason(tab.url);
  if (blockReason) {
    return { ok: false, blocked: true, error: blockReason };
  }
  const origin = parseSafeOrigin(tab.url);
  if (!origin) {
    return { ok: false, blocked: true, error: '无法解析当前页面的安全同源域 (Origin)' };
  }

  mutedTabIds.delete(tab.id);
  await persistLocalPrefs();

  const record = {
    tabId: tab.id,
    windowId: tab.windowId ?? 0,
    armedOrigin: origin,
    url: tab.url || '',
    title: String(tab.title || '').slice(0, 160),
    armedAt: Date.now()
  };
  armedTabs.set(tab.id, record);
  await setBadgeForTab(tab.id, autopilotAllTabs ? BADGE_ARMED_TEXT : BADGE_MANUAL_TEXT);
  await persistArmedTabs();
  lastHostNotFoundAt = 0;
  await syncLifecycle();
  ensureContentAgentLoaded(tab.id)
    .then(() => notifyTabContentAgentArmed(tab.id, true))
    .catch(() => {});
  return {
    ok: true,
    armed: true,
    tab: record,
    armedCount: armedTabs.size,
    autopilotAllTabs,
    nativeConnected: Boolean(nativePort),
    nativeError: lastNativeError
  };
}

async function ensureContentAgentLoaded(tabId) {
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__prismCuaContentAgent && window.__prismCuaContentAgent.version === '0.9.6')
  });
  const alreadyLoaded = Boolean(probe && probe[0] && probe[0].result === true);
  if (!alreadyLoaded) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-agent.js']
    });
  }
}

async function verifyArmedTabLive(requestedTabId) {
  await ensureHydrated();
  let targetTabId = Number(requestedTabId);

  if (autopilotAllTabs) {
    if (!Number.isInteger(targetTabId) || targetTabId <= 0) {
      const [activeFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeFocused && activeFocused.id && !mutedTabIds.has(activeFocused.id) && !checkUrlBlockReason(activeFocused.url)) {
        targetTabId = activeFocused.id;
      } else {
        const candidates = await collectAvailableTabsPayload();
        if (candidates.length > 0) {
          targetTabId = candidates[0].tabId;
        } else {
          return {
            ok: false,
            code: 'NO_AVAILABLE_BROWSER_TAB',
            error: '当前浏览器没有可操作的普通 http/https 标签页（空白页或受保护系统页已屏蔽）'
          };
        }
      }
    }

    if (mutedTabIds.has(targetTabId)) {
      return {
        ok: false,
        code: 'TAB_MUTED_BY_USER',
        error: `标签页 #${targetTabId} 已被用户手动设为暂停协助`
      };
    }

    let liveTab;
    try {
      liveTab = await chrome.tabs.get(targetTabId);
    } catch {
      return { ok: false, code: 'TAB_CLOSED', error: `标签页 #${targetTabId} 已关闭或不存在` };
    }

    const blockReason = checkUrlBlockReason(liveTab.url);
    if (blockReason) {
      return { ok: false, code: 'BLOCKED_URL_DISARMED', error: blockReason };
    }
    const liveOrigin = parseSafeOrigin(liveTab.url);
    if (!liveOrigin) {
      return { ok: false, code: 'BLOCKED_URL_DISARMED', error: '不支持访问非 http/https 标签页' };
    }

    return {
      ok: true,
      tabId: targetTabId,
      liveTab,
      armedEntry: {
        tabId: targetTabId,
        windowId: liveTab.windowId ?? 0,
        armedOrigin: liveOrigin,
        url: liveTab.url || '',
        title: String(liveTab.title || '').slice(0, 160),
        auto: true,
        armedAt: Date.now()
      }
    };
  }

  // Manual per-tab ARMED mode fallback
  if (!Number.isInteger(targetTabId) || targetTabId <= 0) {
    if (armedTabs.size === 1) {
      targetTabId = armedTabs.keys().next().value;
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && armedTabs.has(activeTab.id)) {
        targetTabId = activeTab.id;
      } else {
        return {
          ok: false,
          code: 'TAB_NOT_ARMED',
          error: armedTabs.size === 0
            ? '当前没有任何已授权（ARMED）的浏览器标签页，请开启 Autopilot 或在扩展弹窗中点亮目标页'
            : '存在多个已授权标签页，请显式指定目标 tabId'
        };
      }
    }
  }

  const armedEntry = armedTabs.get(targetTabId);
  if (!armedEntry) {
    return {
      ok: false,
      code: 'TAB_NOT_ARMED',
      error: `标签页 #${targetTabId} 未经用户授权（ARMED），已拒绝访问`
    };
  }

  let liveTab;
  try {
    liveTab = await chrome.tabs.get(targetTabId);
  } catch {
    await disarmSingleTab(targetTabId, { reason: 'tab_closed' });
    return { ok: false, code: 'TAB_CLOSED', error: `标签页 #${targetTabId} 已关闭，已自动解除授权` };
  }

  const blockReason = checkUrlBlockReason(liveTab.url);
  if (blockReason) {
    await disarmSingleTab(targetTabId, { reason: 'blocked_url' });
    return { ok: false, code: 'BLOCKED_URL_DISARMED', error: `${blockReason}（已自动撤权）` };
  }

  const liveOrigin = parseSafeOrigin(liveTab.url);
  if (!liveOrigin || liveOrigin !== armedEntry.armedOrigin) {
    await disarmSingleTab(targetTabId, { reason: 'origin_changed' });
    return {
      ok: false,
      code: 'ORIGIN_CHANGED_DISARMED',
      error: `标签页已跨源跳转（${armedEntry.armedOrigin} -> ${liveOrigin || '未知'}），已自动解除操控授权`
    };
  }

  return { ok: true, tabId: targetTabId, liveTab, armedEntry };
}

async function maybeCaptureArmedScreenshot(liveTab) {
  if (!liveTab || !liveTab.active) {
    return { dataUrl: '', note: '目标标签页当前不在前台激活态，已跳过可见视口截图（DOM 快照仍正常返回）' };
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(liveTab.windowId, {
      format: 'jpeg',
      quality: 74
    });
    return { dataUrl: dataUrl || '', note: '' };
  } catch (err) {
    return { dataUrl: '', note: String(err?.message || err) };
  }
}

function applyBrokerMetadata(msg) {
  if (!msg || typeof msg !== 'object') return;
  const st = String(msg.state || msg.payload?.state || '').trim().toUpperCase();
  if (st) brokerCuaState = st;
  const incomingEpoch = Number(msg.leaseEpoch ?? msg.payload?.leaseEpoch);
  if (Number.isFinite(incomingEpoch) && incomingEpoch > currentBrokerLeaseEpoch) {
    currentBrokerLeaseEpoch = incomingEpoch;
  }
  const vaultOrig = String(msg.vaultServerOrigin || msg.payload?.vaultServerOrigin || '').trim().toLowerCase();
  if (vaultOrig) {
    dynamicBlockedOrigins.add(vaultOrig);
  }
  if (typeof msg.autopilot === 'boolean' && msg.autopilot !== autopilotAllTabs) {
    autopilotAllTabs = msg.autopilot;
    void persistLocalPrefs();
    void sendSyncArmedTabs();
  }
}

async function handleNativeMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  await ensureHydrated();

  const cmd = String(msg.cmd || msg.action || msg.type || '').trim();
  const reqId = msg.requestId ?? msg.id;

  if (cmd === 'status_reply' || cmd === 'cua_state') {
    applyBrokerMetadata(msg);
    return;
  }

  if (cmd === 'revoke' || cmd === 'disarm_all') {
    brokerCuaState = 'DISARMED';
    currentBrokerLeaseEpoch += 1;
    const res = await disarmAllTabs({ reason: 'broker_revoke', disableAutopilot: false });
    if (reqId !== undefined) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: true, result: res });
    }
    return;
  }

  if (cmd === 'ping' || cmd === 'list_armed_tabs') {
    applyBrokerMetadata(msg);
    const list = await collectAvailableTabsPayload();
    const result = {
      ok: true,
      pong: true,
      extensionId: chrome.runtime.id,
      version: '0.9.6',
      autopilotAllTabs,
      armedCount: list.length,
      tabs: list,
      armedTabs: list
    };
    if (reqId !== undefined) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: true, result });
    } else {
      await sendSyncArmedTabs();
    }
    return;
  }

  if (cmd === 'browser_observe' || cmd === 'browser_act') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
    applyBrokerMetadata(msg);
    const cmdEpoch = Number(msg.leaseEpoch ?? payload.leaseEpoch);
    if (brokerCuaState === 'DISARMED' || brokerCuaState === 'PAUSED_HANDOFF') {
      const rejCode = brokerCuaState === 'PAUSED_HANDOFF' ? 'HANDOFF_PAUSED' : 'REVOKED';
      postNativeSafe({
        type: 'cmd_result',
        id: reqId,
        requestId: reqId,
        ok: false,
        result: {
          ok: false,
          code: rejCode,
          error: `浏览器桥已拒绝在 ${brokerCuaState} 状态下执行滞留指令`
        }
      });
      return;
    }
    if (Number.isFinite(cmdEpoch) && cmdEpoch < currentBrokerLeaseEpoch) {
      postNativeSafe({
        type: 'cmd_result',
        id: reqId,
        requestId: reqId,
        ok: false,
        result: {
          ok: false,
          code: 'STALE_LEASE_EPOCH',
          error: `浏览器桥已拒绝过期的授权纪元指令 (epoch ${cmdEpoch} < ${currentBrokerLeaseEpoch})`
        }
      });
      return;
    }
    if (Number.isFinite(cmdEpoch) && cmdEpoch > currentBrokerLeaseEpoch) {
      currentBrokerLeaseEpoch = cmdEpoch;
    }
  }

  if (cmd === 'browser_observe') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
    const check = await verifyArmedTabLive(msg.tabId ?? payload.tabId);
    if (!check.ok) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: false, result: check });
      return;
    }

    const { tabId, liveTab, armedEntry } = check;
    await ensureContentAgentLoaded(tabId);
    const mode = String(msg.mode || payload.mode || 'compact');
    const maxElements = Number(msg.maxElements || payload.maxElements) || 200;

    const execRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => window.__prismCuaContentAgent.observe(opts),
      args: [{
        mode,
        maxElements,
        expectedOrigin: armedEntry.armedOrigin,
        armedOrigin: armedEntry.armedOrigin
      }]
    });
    const obs = (execRes && execRes[0] && execRes[0].result) || { ok: false, error: '无法读取页面无障碍快照' };
    obs.tabId = tabId;

    const wantsScreenshot =
      mode === 'screenshot' ||
      mode === 'vision' ||
      mode === 'full' ||
      msg.includeScreenshot === true ||
      msg.screenshot === true ||
      payload.includeScreenshot === true ||
      payload.screenshot === true;
    if (wantsScreenshot && obs.ok) {
      if (obs.blindCurtainActive) {
        obs.screenshotNote = '盲注防窥帘生效中：离开登录页前已自动禁止截图回读';
      } else {
        const shot = await maybeCaptureArmedScreenshot(liveTab);
        if (shot.dataUrl) {
          obs.screenshotDataUrl = shot.dataUrl;
          obs.screenshotBase64 = shot.dataUrl.replace(/^data:[^;]+;base64,/, '');
          obs.mimeType = 'image/jpeg';
        }
        if (shot.note) obs.screenshotNote = shot.note;
      }
    }

    postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: Boolean(obs.ok), result: obs });
    return;
  }

  if (cmd === 'browser_act') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
    const check = await verifyArmedTabLive(msg.tabId ?? payload.tabId);
    if (!check.ok) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: false, result: check });
      return;
    }

    const { tabId, armedEntry } = check;
    await ensureContentAgentLoaded(tabId);
    const rawStep = msg.step || payload.step || payload || {};
    const step = {
      ...rawStep,
      expectedOrigin: armedEntry.armedOrigin,
      armedOrigin: armedEntry.armedOrigin
    };

    if (step.__brokerInjectedVault && typeof step.__brokerInjectedVault === 'object') {
      let freshTab = null;
      try {
        freshTab = await chrome.tabs.get(tabId);
      } catch {}
      const freshOrigin = parseSafeOrigin(freshTab?.url || '').toLowerCase();
      const expectedVaultOrigin = String(step.__brokerInjectedVault.origin || '').toLowerCase();
      if (
        !freshTab ||
        freshTab.pendingUrl ||
        checkUrlBlockReason(freshTab.url || '') ||
        !expectedVaultOrigin ||
        freshOrigin !== expectedVaultOrigin
      ) {
        postNativeSafe({
          type: 'cmd_result',
          id: reqId,
          requestId: reqId,
          ok: false,
          result: {
            ok: false,
            code: 'ORIGIN_MISMATCH',
            error: '盲注安全闸门：检测到目标标签页发生跳转或域不匹配，已在进入页面脚本前阻断凭据投递'
          }
        });
        return;
      }
    }

    const execRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => window.__prismCuaContentAgent.act(s),
      args: [step]
    });
    const actOut = (execRes && execRes[0] && execRes[0].result) || { ok: false, error: '页面动作执行未返回结果' };
    actOut.tabId = tabId;
    if (actOut.code === 'ORIGIN_MISMATCH') {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: false, result: actOut });
      return;
    }

    try {
      const postTab = await chrome.tabs.get(tabId);
      const postOrigin = parseSafeOrigin(postTab.url);
      const postBlocked = checkUrlBlockReason(postTab.url);
      if (!postOrigin || postBlocked) {
        if (!autopilotAllTabs) {
          await disarmSingleTab(tabId, { reason: 'blocked_after_act' });
        }
        actOut.disarmedOnOriginChange = true;
      } else if (!autopilotAllTabs && postOrigin !== armedEntry.armedOrigin) {
        await disarmSingleTab(tabId, { reason: 'origin_changed_after_act' });
        actOut.disarmedOnOriginChange = true;
      } else if (step.includeSnapshot !== false && actOut.ok) {
        try {
          await ensureContentAgentLoaded(tabId);
          const snapRes = await chrome.scripting.executeScript({
            target: { tabId },
            func: (expectedOrig) => window.__prismCuaContentAgent.observe({
              mode: 'compact',
              maxElements: 120,
              expectedOrigin: expectedOrig,
              armedOrigin: expectedOrig
            }),
            args: [postOrigin]
          });
          if (snapRes && snapRes[0] && snapRes[0].result?.ok) {
            actOut.snapshot = snapRes[0].result;
          }
        } catch {}
      }

      const curtainActive = Boolean(actOut.blindCurtainActive || actOut.snapshot?.blindCurtainActive);
      if ((step.screenshot || msg.includeScreenshot || payload.includeScreenshot) && actOut.ok && !actOut.disarmedOnOriginChange) {
        if (curtainActive) {
          actOut.screenshotNote = '盲注防窥帘生效中：离开登录页前已自动禁止截图回读';
        } else {
          const shot = await maybeCaptureArmedScreenshot(postTab);
          if (shot.dataUrl) {
            actOut.screenshotDataUrl = shot.dataUrl;
            actOut.screenshotBase64 = shot.dataUrl.replace(/^data:[^;]+;base64,/, '');
            actOut.mimeType = 'image/jpeg';
          }
        }
      }
      await sendSyncArmedTabs();
    } catch {
      await disarmSingleTab(tabId, { reason: 'tab_closed_after_act' });
    }

    postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: Boolean(actOut.ok), result: actOut });
    return;
  }

  if (reqId !== undefined) {
    postNativeSafe({
      type: 'cmd_result',
      id: reqId,
      requestId: reqId,
      ok: false,
      result: { ok: false, code: 'UNKNOWN_CMD', error: `未知的扩展桥指令: ${cmd}` }
    });
  }
}

async function probeNativeHostTransient() {
  if (nativePort) {
    return { hostRegistered: true, connected: true, error: '' };
  }
  return new Promise((resolve) => {
    let settled = false;
    let tempPort = null;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      if (tempPort && !autopilotAllTabs && armedTabs.size === 0) {
        try { tempPort.disconnect(); } catch {}
      }
      resolve(res);
    };

    try {
      tempPort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      finish({ hostRegistered: false, connected: false, error: String(err?.message || err) });
      return;
    }

    tempPort.onDisconnect.addListener(() => {
      const errMsg = chrome.runtime?.lastError?.message || '';
      const notFound = /not found|forbidden|specified native messaging host/i.test(errMsg);
      finish({
        hostRegistered: !notFound && !errMsg,
        connected: false,
        error: errMsg
      });
    });

    tempPort.onMessage.addListener(() => {
      finish({ hostRegistered: true, connected: true, error: '' });
    });

    try {
      tempPort.postMessage({ type: 'get_status', id: 'probe-1', extensionId: chrome.runtime.id, version: '0.9.6', ts: Date.now() });
    } catch {}

    setTimeout(() => {
      finish({ hostRegistered: true, connected: true, error: '' });
    }, 220);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  mutedTabIds.delete(tabId);
  ensureHydrated()
    .then(() => {
      if (armedTabs.has(tabId)) {
        return disarmSingleTab(tabId, { reason: 'tab_removed' });
      }
      if (autopilotAllTabs && nativePort) {
        return sendSyncArmedTabs();
      }
    })
    .catch(() => {});
});

chrome.tabs.onActivated.addListener(() => {
  ensureHydrated()
    .then(() => {
      if (autopilotAllTabs) {
        ensureNativeConnected();
        return sendSyncArmedTabs();
      }
    })
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ensureHydrated()
    .then(async () => {
      if (autopilotAllTabs) {
        if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
          ensureNativeConnected();
          await sendSyncArmedTabs();
        }
        return;
      }
      const entry = armedTabs.get(tabId);
      if (!entry) return;
      const candidateUrl = changeInfo.url || tab?.url || '';
      if (candidateUrl) {
        const blocked = checkUrlBlockReason(candidateUrl);
        const nextOrigin = parseSafeOrigin(candidateUrl);
        if (blocked || !nextOrigin || nextOrigin !== entry.armedOrigin) {
          await disarmSingleTab(tabId, { reason: 'origin_changed' });
          return;
        }
        entry.url = candidateUrl;
      }
      if (typeof changeInfo.title === 'string') {
        entry.title = changeInfo.title.slice(0, 160);
      }
      if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
        await setBadgeForTab(tabId, BADGE_MANUAL_TEXT);
        await persistArmedTabs();
        await sendSyncArmedTabs();
      }
    })
    .catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== HEARTBEAT_ALARM) return;
  ensureHydrated()
    .then(async () => {
      if (!autopilotAllTabs && armedTabs.size === 0) {
        disconnectNativeIfIdle();
        return;
      }
      ensureNativeConnected();
      const list = await collectAvailableTabsPayload();
      postNativeSafe({
        type: 'heartbeat',
        extensionId: chrome.runtime.id,
        version: '0.9.6',
        autopilotAllTabs,
        ts: Date.now(),
        armedCount: list.length,
        tabs: list,
        armedTabs: list
      });
    })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  (async () => {
    await ensureHydrated();

    if (typeof msg.type === 'string' && msg.type.startsWith('popup_')) {
      if (sender && sender.tab) {
        sendResponse({
          ok: false,
          code: 'FORBIDDEN_TAB_SENDER',
          error: '拒绝来自网页或内容脚本上下文的弹窗特权消息'
        });
        return;
      }
      if (sender && sender.id && sender.id !== chrome.runtime.id) {
        sendResponse({
          ok: false,
          code: 'FORBIDDEN_SENDER',
          error: '拒绝非本扩展上下文消息'
        });
        return;
      }
    }

    if (msg.type === 'content_esc_brake') {
      const senderTabId = sender?.tab?.id;
      if (!Number.isInteger(senderTabId) || (!autopilotAllTabs && !armedTabs.has(senderTabId))) {
        sendResponse({ ok: false, code: 'TAB_NOT_ARMED', error: '来源标签页未处于受控授权态' });
        return;
      }
      currentBrokerLeaseEpoch += 1;
      ensureNativeConnected();
      postNativeSafe({
        type: 'emergency_stop',
        action: 'emergency_stop',
        code: 'USER_ESC_ABORTED',
        reason: 'USER_ESC_ABORTED',
        tabId: senderTabId,
        extensionId: chrome.runtime.id,
        version: '0.9.6',
        ts: Date.now()
      });
      sendResponse({ ok: true, emergencyStopped: true });
      return;
    }

    if (msg.type === 'popup_get_state') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = activeTab?.id ?? 0;
      const url = activeTab?.url || '';
      const blockReason = activeTab ? checkUrlBlockReason(url) : '未检测到活跃标签页';
      const origin = parseSafeOrigin(url);
      const isMuted = Boolean(tabId && mutedTabIds.has(tabId));
      const armedEntry = tabId ? armedTabs.get(tabId) || null : null;
      const effectiveArmed = autopilotAllTabs ? (!blockReason && Boolean(origin) && !isMuted) : Boolean(armedEntry);
      const allAvail = await collectAvailableTabsPayload();

      let hostStatus = { hostRegistered: Boolean(nativePort), connected: Boolean(nativePort), error: lastNativeError };
      if (!nativePort) {
        lastHostNotFoundAt = 0;
        ensureNativeConnected();
        hostStatus = nativePort
          ? { hostRegistered: true, connected: true, error: '' }
          : await probeNativeHostTransient();
      }

      sendResponse({
        ok: true,
        extensionId: chrome.runtime.id,
        version: '0.9.6',
        autopilotAllTabs,
        activeTab: activeTab
          ? {
              tabId,
              title: activeTab.title || '',
              url,
              origin,
              blockReason,
              isMuted,
              isArmed: effectiveArmed,
              armedOrigin: armedEntry?.armedOrigin || origin || ''
            }
          : null,
        armedCount: allAvail.length,
        armedTabs: allAvail,
        nativeHost: hostStatus
      });
      return;
    }

    if (msg.type === 'popup_toggle_arm') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id) {
        sendResponse({ ok: false, error: '未找到当前活跃标签页' });
        return;
      }
      if (autopilotAllTabs) {
        if (mutedTabIds.has(activeTab.id)) {
          mutedTabIds.delete(activeTab.id);
          await persistLocalPrefs();
          await sendSyncArmedTabs();
          sendResponse({ ok: true, isArmed: true, autopilotAllTabs });
        } else {
          const res = await disarmSingleTab(activeTab.id, { reason: 'user_popup_mute', muteInAutopilot: true });
          sendResponse({ ...res, isArmed: false, autopilotAllTabs });
        }
        return;
      }
      if (armedTabs.has(activeTab.id)) {
        const res = await disarmSingleTab(activeTab.id, { reason: 'user_popup_disarm' });
        sendResponse({ ...res, isArmed: false });
      } else {
        const res = await armTabByUserGesture(activeTab);
        sendResponse({ ...res, isArmed: Boolean(res.ok) });
      }
      return;
    }

    if (msg.type === 'popup_disarm_all') {
      const nextAuto = !autopilotAllTabs;
      if (!nextAuto) {
        const res = await disarmAllTabs({ reason: 'user_popup_pause_autopilot', disableAutopilot: true });
        sendResponse(res);
      } else {
        autopilotAllTabs = true;
        mutedTabIds.clear();
        await persistLocalPrefs();
        lastHostNotFoundAt = 0;
        await syncLifecycle();
        sendResponse({ ok: true, autopilotAllTabs: true });
      }
      return;
    }

    sendResponse({ ok: false, error: '未知请求类型' });
  })().catch((err) => {
    sendResponse({ ok: false, error: String(err?.message || err) });
  });

  return true;
});

chrome.runtime.onStartup?.addListener(() => {
  ensureHydrated().catch(() => {});
});

chrome.runtime.onInstalled?.addListener(() => {
  ensureHydrated().catch(() => {});
});

ensureHydrated().catch(() => {});
