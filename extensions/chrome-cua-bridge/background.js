/**
 * Prism CUA Browser Bridge MV3 Service Worker (Clean-Room Original, MIT)
 * Security & Zero-Idle Architecture:
 * 1. ONLY tabs explicitly armed by user click in popup.js (persisted in chrome.storage.session) are ever inspected or acted upon.
 * 2. Navigating an armed tab to any different origin (or protected URL) immediately auto-disarms it.
 * 3. Native Messaging port ("com.prism.cua.bridge") + 24s heartbeat alarm run ONLY while armedTabs.size > 0;
 *    when 0 tabs are armed, port disconnects and alarm is cleared -> strictly 0 idle overhead.
 */
'use strict';

const NATIVE_HOST_NAME = 'com.prism.cua.bridge';
const HEARTBEAT_ALARM = 'prism-cua-nm-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 0.4; // 24s keepalive while >= 1 tab is ARMED
const SESSION_STORAGE_KEY = 'prismArmedTabsV1';
const BADGE_ARMED_TEXT = 'ARM';
const BADGE_ARMED_BG = '#059669';

/** @type {Map<number, { tabId: number, windowId: number, armedOrigin: string, url: string, title: string, armedAt: number }>} */
const armedTabs = new Map();
let hydrated = false;
let hydratePromise = null;
let nativePort = null;
let lastNativeError = '';
let brokerCuaState = 'UNKNOWN';
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
    host === 'myaccount.google.com' && /\/(?:security|signinoptions\/password)/i.test(u.pathname) ||
    /(?:^|\.)(?:1password\.com|bitwarden\.com|lastpass\.com|dashlane\.com)$/i.test(host)
  ) {
    return '密码库与账号核心凭据页面受硬拦截保护，禁止授权操控';
  }

  return '';
}

async function setBadgeForTab(tabId, isArmed) {
  try {
    await chrome.action.setBadgeText({ tabId, text: isArmed ? BADGE_ARMED_TEXT : '' });
    if (isArmed) {
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

function getArmedTabsPayload() {
  const list = [];
  for (const info of armedTabs.values()) {
    list.push({
      tabId: info.tabId,
      windowId: info.windowId,
      origin: info.armedOrigin,
      armedOrigin: info.armedOrigin,
      url: info.url,
      title: info.title,
      armedAt: info.armedAt
    });
  }
  return list;
}

async function ensureHydrated() {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
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
              await setBadgeForTab(tabId, true);
            } else {
              await setBadgeForTab(tabId, false);
            }
          } catch {}
        }
      }
      await persistArmedTabs();
    } catch {}
    hydrated = true;
    hydratePromise = null;
    await syncLifecycleWithArmedCount();
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

function sendSyncArmedTabs() {
  const list = getArmedTabsPayload();
  postNativeSafe({
    type: 'sync_armed_tabs',
    extensionId: chrome.runtime.id,
    version: '0.9.4',
    ts: Date.now(),
    tabs: list,
    armedTabs: list
  });
}

function ensureNativeConnected() {
  if (nativePort) return true;
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
      if (errMsg) lastNativeError = errMsg;
      if (nativePort === port) {
        nativePort = null;
      }
    });

    sendSyncArmedTabs();
    return true;
  } catch (err) {
    lastNativeError = String(err?.message || err);
    nativePort = null;
    return false;
  }
}

function disconnectNativeIfIdle() {
  if (armedTabs.size > 0) return;
  if (nativePort) {
    try {
      nativePort.postMessage({
        type: 'sync_armed_tabs',
        extensionId: chrome.runtime.id,
        version: '0.9.4',
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

async function syncLifecycleWithArmedCount() {
  if (armedTabs.size > 0) {
    ensureNativeConnected();
    sendSyncArmedTabs();
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

async function disarmSingleTab(tabId, { reason = 'manual' } = {}) {
  const numId = Number(tabId);
  const existed = armedTabs.delete(numId);
  await setBadgeForTab(numId, false);
  if (existed) {
    notifyTabContentAgentArmed(numId, false);
    await persistArmedTabs();
    if (armedTabs.size > 0) {
      sendSyncArmedTabs();
    } else {
      disconnectNativeIfIdle();
    }
  }
  return { ok: true, disarmed: existed, reason, armedCount: armedTabs.size };
}

async function disarmAllTabs({ reason = 'manual_all' } = {}) {
  const ids = Array.from(armedTabs.keys());
  armedTabs.clear();
  for (const id of ids) {
    notifyTabContentAgentArmed(id, false);
  }
  await Promise.all(ids.map((id) => setBadgeForTab(id, false)));
  await persistArmedTabs();
  disconnectNativeIfIdle();
  return { ok: true, disarmedCount: ids.length, reason, armedCount: 0 };
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

  const record = {
    tabId: tab.id,
    windowId: tab.windowId ?? 0,
    armedOrigin: origin,
    url: tab.url || '',
    title: String(tab.title || '').slice(0, 160),
    armedAt: Date.now()
  };
  armedTabs.set(tab.id, record);
  await setBadgeForTab(tab.id, true);
  await persistArmedTabs();
  await syncLifecycleWithArmedCount();
  ensureContentAgentLoaded(tab.id)
    .then(() => notifyTabContentAgentArmed(tab.id, true))
    .catch(() => {});
  return {
    ok: true,
    armed: true,
    tab: record,
    armedCount: armedTabs.size,
    nativeConnected: Boolean(nativePort),
    nativeError: lastNativeError
  };
}

async function ensureContentAgentLoaded(tabId) {
  const probe = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__prismCuaContentAgent && window.__prismCuaContentAgent.version === '0.9.4')
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
            ? '当前没有任何已授权（ARMED）的浏览器标签页，请先在浏览器右上角点击 Prism 扩展图标授权目标标签页'
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
      error: `标签页 #${targetTabId} 未经用户显式授权（ARMED），已拒绝访问`
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

  if (liveTab.url !== armedEntry.url || liveTab.title !== armedEntry.title) {
    armedEntry.url = liveTab.url || armedEntry.url;
    armedEntry.title = String(liveTab.title || '').slice(0, 160);
    await persistArmedTabs();
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

async function handleNativeMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  await ensureHydrated();

  const cmd = String(msg.cmd || msg.action || msg.type || '').trim();
  const reqId = msg.requestId ?? msg.id;

  if (cmd === 'status_reply') {
    const st = String(msg.state || '').trim().toUpperCase();
    if (st) brokerCuaState = st;
    if (Number.isFinite(Number(msg.leaseEpoch)) && Number(msg.leaseEpoch) > currentBrokerLeaseEpoch) {
      currentBrokerLeaseEpoch = Number(msg.leaseEpoch);
    }
    return;
  }

  if (cmd === 'cua_state') {
    const incomingState = String(msg.state || msg.payload?.state || '').trim().toUpperCase();
    const incomingEpoch = Number(msg.leaseEpoch ?? msg.payload?.leaseEpoch);
    if (Number.isFinite(incomingEpoch) && incomingEpoch > currentBrokerLeaseEpoch) {
      currentBrokerLeaseEpoch = incomingEpoch;
    } else if ((incomingState === 'DISARMED' || incomingState === 'PAUSED_HANDOFF') && !Number.isFinite(incomingEpoch)) {
      currentBrokerLeaseEpoch += 1;
    }
    if (incomingState) {
      brokerCuaState = incomingState;
    }
    return;
  }

  if (cmd === 'revoke' || cmd === 'disarm_all') {
    brokerCuaState = 'DISARMED';
    currentBrokerLeaseEpoch += 1;
    const res = await disarmAllTabs({ reason: 'broker_revoke' });
    if (reqId !== undefined) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: true, result: res });
    }
    return;
  }

  if (cmd === 'ping' || cmd === 'list_armed_tabs') {
    const list = getArmedTabsPayload();
    const result = {
      ok: true,
      pong: true,
      extensionId: chrome.runtime.id,
      version: '0.9.4',
      armedCount: armedTabs.size,
      tabs: list,
      armedTabs: list
    };
    if (reqId !== undefined) {
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: true, result });
    } else {
      sendSyncArmedTabs();
    }
    return;
  }

  if (cmd === 'browser_observe' || cmd === 'browser_act') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
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
    if (obs.code === 'ORIGIN_MISMATCH') {
      await disarmSingleTab(tabId, { reason: 'origin_mismatch_observe' });
    }

    const wantsScreenshot =
      mode === 'screenshot' ||
      mode === 'vision' ||
      mode === 'full' ||
      msg.includeScreenshot === true ||
      msg.screenshot === true ||
      payload.includeScreenshot === true ||
      payload.screenshot === true;
    if (wantsScreenshot && obs.ok) {
      const shot = await maybeCaptureArmedScreenshot(liveTab);
      if (shot.dataUrl) {
        obs.screenshotDataUrl = shot.dataUrl;
        obs.screenshotBase64 = shot.dataUrl.replace(/^data:[^;]+;base64,/, '');
        obs.mimeType = 'image/jpeg';
      }
      if (shot.note) obs.screenshotNote = shot.note;
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

    const execRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => window.__prismCuaContentAgent.act(s),
      args: [step]
    });
    const actOut = (execRes && execRes[0] && execRes[0].result) || { ok: false, error: '页面动作执行未返回结果' };
    actOut.tabId = tabId;
    if (actOut.code === 'ORIGIN_MISMATCH') {
      await disarmSingleTab(tabId, { reason: 'origin_mismatch_act' });
      postNativeSafe({ type: 'cmd_result', id: reqId, requestId: reqId, ok: false, result: actOut });
      return;
    }

    // Re-check origin immediately after action in case click/submit navigated cross-origin
    try {
      const postTab = await chrome.tabs.get(tabId);
      const postOrigin = parseSafeOrigin(postTab.url);
      const liveArmedEntry = armedTabs.get(tabId);
      if (liveArmedEntry && (!postOrigin || checkUrlBlockReason(postTab.url) || postOrigin !== liveArmedEntry.armedOrigin)) {
        await disarmSingleTab(tabId, { reason: 'origin_changed_after_act' });
        actOut.disarmedOnOriginChange = true;
      } else if (step.includeSnapshot !== false && actOut.ok && liveArmedEntry) {
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
            args: [liveArmedEntry.armedOrigin]
          });
          if (snapRes && snapRes[0] && snapRes[0].result?.ok) {
            actOut.snapshot = snapRes[0].result;
          }
        } catch {}
      }
      if ((step.screenshot || msg.includeScreenshot || payload.includeScreenshot) && actOut.ok && !actOut.disarmedOnOriginChange) {
        const shot = await maybeCaptureArmedScreenshot(postTab);
        if (shot.dataUrl) {
          actOut.screenshotDataUrl = shot.dataUrl;
          actOut.screenshotBase64 = shot.dataUrl.replace(/^data:[^;]+;base64,/, '');
          actOut.mimeType = 'image/jpeg';
        }
      }
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
      if (tempPort && armedTabs.size === 0) {
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
      tempPort.postMessage({ type: 'get_status', id: 'probe-1', extensionId: chrome.runtime.id, version: '0.9.4', ts: Date.now() });
    } catch {}

    // If Native Messaging host stayed alive for 220ms without immediate lastError disconnect, it is registered & reachable
    setTimeout(() => {
      finish({ hostRegistered: true, connected: true, error: '' });
    }, 220);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  ensureHydrated()
    .then(() => {
      if (armedTabs.has(tabId)) {
        return disarmSingleTab(tabId, { reason: 'tab_removed' });
      }
    })
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ensureHydrated()
    .then(async () => {
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
        await setBadgeForTab(tabId, true);
        await persistArmedTabs();
        sendSyncArmedTabs();
      }
    })
    .catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== HEARTBEAT_ALARM) return;
  ensureHydrated()
    .then(async () => {
      for (const [tabId, entry] of Array.from(armedTabs.entries())) {
        try {
          const t = await chrome.tabs.get(tabId);
          const liveOrig = parseSafeOrigin(t?.url);
          if (!t || checkUrlBlockReason(t.url) || !liveOrig || liveOrig !== entry.armedOrigin) {
            await disarmSingleTab(tabId, { reason: 'heartbeat_origin_mismatch' });
          }
        } catch {
          await disarmSingleTab(tabId, { reason: 'heartbeat_tab_missing' });
        }
      }
      if (armedTabs.size === 0) {
        disconnectNativeIfIdle();
        return;
      }
      ensureNativeConnected();
      const list = getArmedTabsPayload();
      postNativeSafe({
        type: 'heartbeat',
        extensionId: chrome.runtime.id,
        version: '0.9.4',
        ts: Date.now(),
        armedCount: armedTabs.size,
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
      if (!Number.isInteger(senderTabId) || !armedTabs.has(senderTabId)) {
        sendResponse({ ok: false, code: 'TAB_NOT_ARMED', error: '来源标签页未处于受控授权态' });
        return;
      }
      brokerCuaState = 'DISARMED';
      currentBrokerLeaseEpoch += 1;
      ensureNativeConnected();
      postNativeSafe({
        type: 'emergency_stop',
        action: 'emergency_stop',
        code: 'USER_ESC_ABORTED',
        reason: 'USER_ESC_ABORTED',
        tabId: senderTabId,
        extensionId: chrome.runtime.id,
        version: '0.9.4',
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
      const armedEntry = tabId ? armedTabs.get(tabId) || null : null;

      let hostStatus = { hostRegistered: Boolean(nativePort), connected: Boolean(nativePort), error: lastNativeError };
      if (!nativePort) {
        hostStatus = await probeNativeHostTransient();
      }

      sendResponse({
        ok: true,
        extensionId: chrome.runtime.id,
        version: '0.9.4',
        activeTab: activeTab
          ? {
              tabId,
              title: activeTab.title || '',
              url,
              origin,
              blockReason,
              isArmed: Boolean(armedEntry),
              armedOrigin: armedEntry?.armedOrigin || ''
            }
          : null,
        armedCount: armedTabs.size,
        armedTabs: getArmedTabsPayload(),
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
      const res = await disarmAllTabs({ reason: 'user_popup_disarm_all' });
      sendResponse(res);
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
