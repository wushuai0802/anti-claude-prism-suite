// SPDX-License-Identifier: MIT
/**
 * Local CUA Broker HTTP client and optional loopback external CUA endpoint adapter.
 *
 * Security invariants:
 * - Zero external dependencies (Node.js >= 22 built-in modules only).
 * - Rejects symlinks when reading cua-broker.json and prism-profile.json.
 * - Sends Authorization: Bearer <token>, X-Prism-Nonce, Idempotency-Key, and
 *   strict AbortSignal.timeout on every POST /v1/cua request.
 * - Iterates loopback (127.0.0.1) then WSL host-bridge (172.x.x.1) endpoints,
 *   never forwarding Bearer tokens to public/remote hosts.
 * - Enforces ANONYMIZED_TELEMETRY=false and strips forbidden categories
 *   (Shell, Registry, FileSystem, Process) on optional external loopback adapters.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_CONSENT_TIMEOUT_MS = 60_000;

export const FORBIDDEN_EXTERNAL_TOOL_CATEGORIES = Object.freeze([
  'Shell',
  'Registry',
  'FileSystem',
  'Process'
]);

const FORBIDDEN_CATEGORY_LOWER_SET = new Set(
  FORBIDDEN_EXTERNAL_TOOL_CATEGORIES.map((c) => c.toLowerCase())
);

const FORBIDDEN_EXTERNAL_TOOL_NAME_RE = /^(?:shell|bash|sh|cmd|powershell|pwsh|exec|execute_command|run_command|terminal|regedit|registry|reg_|filesystem|file_|fs_|read_file|write_file|delete_file|list_dir|process|kill_process|spawn_process|start_process)/i;

function assertNotSymlink(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw Object.assign(
      new Error(`拒绝读取符号链接 ${label}`),
      { code: 'SYMLINK_REJECTED' }
    );
  }
  return stat.isFile();
}

function isAllowedBrokerHostname(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1') {
    return true;
  }
  // Allow RFC1918 WSL2 host vEthernet bridge IPv4 (e.g. 172.16.0.0/12, 192.168.x.x, 10.x.x.x).
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return false;
  const octets = ipv4Match.slice(1).map((n) => Number(n));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 10) return true;
  return false;
}

function endpointPriority(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return 0;
    if (h.startsWith('172.')) return 1;
    return 2;
  } catch {
    return 9;
  }
}

export function normalizeBrokerEndpoint(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw Object.assign(new Error('Broker 端点 URL 不能为空'), {
      code: 'INVALID_BROKER_ENDPOINT'
    });
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw Object.assign(new Error('Broker 端点 URL 格式非法'), {
      code: 'INVALID_BROKER_ENDPOINT'
    });
  }
  if (parsed.protocol !== 'http:') {
    throw Object.assign(new Error('Broker 端点仅允许本地 http: 协议'), {
      code: 'INVALID_BROKER_ENDPOINT'
    });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Broker 端点禁止内嵌凭据'), {
      code: 'INVALID_BROKER_ENDPOINT'
    });
  }
  if (!isAllowedBrokerHostname(parsed.hostname)) {
    throw Object.assign(
      new Error(`拒绝向非本地/非 WSL 桥接主机发送 Broker 请求 (${parsed.hostname})`),
      { code: 'BROKER_HOST_FORBIDDEN' }
    );
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (cleanPath.endsWith('/v1/cua')) {
    return `${parsed.origin}${cleanPath}`;
  }
  return `${parsed.origin}${cleanPath}/v1/cua`;
}

function resolveDefaultBrokerFilePath(homeDir = os.homedir(), env = process.env) {
  if (typeof env?.PRISM_CUA_BROKER_FILE === 'string' && env.PRISM_CUA_BROKER_FILE.trim()) {
    return path.resolve(env.PRISM_CUA_BROKER_FILE.trim());
  }
  const primary = path.join(path.resolve(homeDir), '.gemini', 'antigravity', 'prism-suite', 'cua-broker.json');
  if (fs.existsSync(primary)) {
    return primary;
  }

  // WSL seamless bridge: if running inside Linux/WSL and Windows host wrote cua-broker.json under /mnt/c/Users/<profile>/.gemini/...
  if (process.platform === 'linux' && fs.existsSync('/mnt/c/Users')) {
    try {
      const skipped = new Set(['Public', 'Default', 'Default User', 'All Users']);
      const entries = fs.readdirSync('/mnt/c/Users', { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || skipped.has(entry.name)) continue;
        const candidate = path.join(
          '/mnt/c/Users',
          entry.name,
          '.gemini',
          'antigravity',
          'prism-suite',
          'cua-broker.json'
        );
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Ignore permission errors on system profile directories.
    }
  }

  return primary;
}

function resolveDefaultProfilePaths(homeDir = os.homedir()) {
  const resolvedHome = path.resolve(homeDir);
  return [
    path.join(resolvedHome, '.gemini', 'antigravity', 'prism-suite', 'prism-profile.json'),
    path.join(resolvedHome, '.gemini', 'antigravity', 'anti-claude', 'prism-profile.json')
  ];
}

/**
 * Reads and validates cua-broker.json ({ endpoints, token, pid, extensionId }).
 */
export function readBrokerDiscoveryFile(brokerFilePath) {
  const exists = assertNotSymlink(brokerFilePath, 'cua-broker.json');
  if (!exists) {
    throw Object.assign(
      new Error('未找到 CUA Broker 状态文件 cua-broker.json（请确认 Windows 端 Prism CUA Broker 已启动）'),
      { code: 'BROKER_NOT_RUNNING' }
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(brokerFilePath, 'utf8'));
  } catch {
    throw Object.assign(
      new Error('cua-broker.json 解析失败'),
      { code: 'INVALID_BROKER_FILE' }
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw Object.assign(new Error('cua-broker.json 内容无效'), {
      code: 'INVALID_BROKER_FILE'
    });
  }

  const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
  if (!token) {
    throw Object.assign(new Error('cua-broker.json 缺少有效的 Bearer token'), {
      code: 'INVALID_BROKER_TOKEN'
    });
  }

  let rawEndpoints = [];
  if (Array.isArray(parsed.endpoints)) {
    rawEndpoints = parsed.endpoints;
  } else if (typeof parsed.endpoint === 'string' && parsed.endpoint.trim()) {
    rawEndpoints = [parsed.endpoint.trim()];
  } else if (Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port <= 65535) {
    rawEndpoints = [`http://127.0.0.1:${parsed.port}`];
  }

  const normalizedEndpoints = rawEndpoints
    .filter((u) => typeof u === 'string' && u.trim())
    .map((u) => normalizeBrokerEndpoint(u));

  if (normalizedEndpoints.length === 0) {
    throw Object.assign(new Error('cua-broker.json 未包含任何可用本地端点'), {
      code: 'INVALID_BROKER_ENDPOINT'
    });
  }

  // Keep 127.0.0.1 loopback ahead of 172.x.x.1 WSL bridge while preserving stable relative order.
  const orderedEndpoints = normalizedEndpoints
    .map((url, idx) => ({ url, idx, prio: endpointPriority(url) }))
    .sort((a, b) => (a.prio - b.prio) || (a.idx - b.idx))
    .map((item) => item.url);

  const uniqueEndpoints = [...new Set(orderedEndpoints)];

  return {
    endpoints: uniqueEndpoints,
    token,
    pid: Number.isInteger(parsed.pid) ? parsed.pid : null,
    extensionId: typeof parsed.extensionId === 'string' ? parsed.extensionId : null
  };
}

/**
 * Strips forbidden external tool categories (Shell, Registry, FileSystem, Process)
 * from any external CUA endpoint capability/tool listing.
 */
export function stripForbiddenExternalTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => {
    if (!tool || typeof tool !== 'object') return false;
    const cat = String(
      tool.category ?? tool.group ?? tool.domain ?? tool.namespace ?? ''
    )
      .trim()
      .toLowerCase();
    if (cat && FORBIDDEN_CATEGORY_LOWER_SET.has(cat)) {
      return false;
    }
    const name = String(tool.name ?? tool.id ?? '').trim();
    if (name && FORBIDDEN_EXTERNAL_TOOL_NAME_RE.test(name)) {
      return false;
    }
    return true;
  });
}

/**
 * Validates optional external CUA endpoint configuration from prism-profile.json
 * under `cua.externalEndpoint` (strictly loopback 127.0.0.1 + ANONYMIZED_TELEMETRY=false).
 */
export function validateExternalCuaEndpoint(cuaSection, env = process.env) {
  if (!cuaSection || typeof cuaSection !== 'object' || !cuaSection.externalEndpoint) {
    return null;
  }

  const rawExt = cuaSection.externalEndpoint;
  if (typeof rawExt === 'object' && rawExt.enabled === false) {
    return null;
  }

  const urlStr = typeof rawExt === 'string'
    ? rawExt.trim()
    : String(rawExt?.url ?? rawExt?.endpoint ?? '').trim();

  if (!urlStr) return null;

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw Object.assign(
      new Error('cua.externalEndpoint URL 格式非法'),
      { code: 'INVALID_EXTERNAL_ENDPOINT' }
    );
  }

  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
    throw Object.assign(
      new Error('cua.externalEndpoint 仅允许绑定本机回环地址 http://127.0.0.1:<port>'),
      { code: 'EXTERNAL_ENDPOINT_NOT_LOOPBACK' }
    );
  }

  if (parsed.username || parsed.password) {
    throw Object.assign(
      new Error('cua.externalEndpoint 禁止包含内嵌用户名或密码'),
      { code: 'INVALID_EXTERNAL_ENDPOINT' }
    );
  }

  // Enforce ANONYMIZED_TELEMETRY=false invariant.
  const cfgTelemetry = typeof rawExt === 'object'
    ? (rawExt.anonymizedTelemetry ?? rawExt.env?.ANONYMIZED_TELEMETRY ?? cuaSection.anonymizedTelemetry)
    : cuaSection.anonymizedTelemetry;
  const envTelemetry = env?.ANONYMIZED_TELEMETRY;

  const isExplicitlyTrue = (v) =>
    v === true || /^(?:true|1|yes|on)$/i.test(String(v ?? '').trim());

  if (isExplicitlyTrue(cfgTelemetry) || isExplicitlyTrue(envTelemetry)) {
    throw Object.assign(
      new Error('外部 CUA 适配器强制要求 ANONYMIZED_TELEMETRY=false，检测到遥测未关闭，已拒绝连接'),
      { code: 'EXTERNAL_TELEMETRY_FORBIDDEN' }
    );
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return {
    baseUrl: `${parsed.origin}${cleanPath}`,
    anonymizedTelemetry: false,
    headers: Object.freeze({
      'ANONYMIZED_TELEMETRY': 'false',
      'X-Anonymized-Telemetry': 'false'
    })
  };
}

function readExternalEndpointFromProfile({ profileFilePath, profileData, homeDir, env }) {
  if (profileData && typeof profileData === 'object') {
    return validateExternalCuaEndpoint(profileData.cua, env);
  }

  const candidates = profileFilePath
    ? [path.resolve(profileFilePath)]
    : resolveDefaultProfilePaths(homeDir);

  for (const candidate of candidates) {
    const exists = assertNotSymlink(candidate, 'prism-profile.json');
    if (!exists) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch {
      continue;
    }
    if (parsed && typeof parsed === 'object' && parsed.cua) {
      return validateExternalCuaEndpoint(parsed.cua, env);
    }
  }
  return null;
}

const APPLICATION_TERMINAL_CODES = new Set([
  'USER_ESC_ABORTED',
  'CONSENT_DENIED',
  'CAPTCHA_DETECTED',
  'SELF_WINDOW_BLOCKED',
  'PASSWORD_FIELD_BLOCKED',
  'UNAUTHORIZED',
  'INVALID_TOKEN',
  'FORBIDDEN'
]);

function normalizeRpcPayload(data, httpStatus) {
  if (!data || typeof data !== 'object') {
    return {
      ok: httpStatus >= 200 && httpStatus < 300,
      status: httpStatus
    };
  }

  const inner = (data.result && typeof data.result === 'object' && !Array.isArray(data.result))
    ? { ...data.result, ...data }
    : { ...data };

  if (
    inner.abortedByEsc === true ||
    inner.code === 'USER_ESC_ABORTED' ||
    inner.error?.code === 'USER_ESC_ABORTED' ||
    /USER_ESC_ABORTED/i.test(String(inner.error?.message ?? inner.error ?? inner.reason ?? ''))
  ) {
    return {
      ...inner,
      ok: false,
      code: 'USER_ESC_ABORTED',
      abortedByEsc: true,
      state: 'DISARMED'
    };
  }

  if (
    inner.code === 'CONSENT_DENIED' ||
    inner.granted === false ||
    inner.error?.code === 'CONSENT_DENIED'
  ) {
    return {
      ...inner,
      ok: false,
      code: 'CONSENT_DENIED',
      granted: false
    };
  }

  if (inner.ok === undefined) {
    inner.ok = httpStatus >= 200 && httpStatus < 300 && !inner.error;
  }
  if (!inner.ok && !inner.code && typeof inner.error === 'object' && inner.error?.code) {
    inner.code = String(inner.error.code);
  }
  return inner;
}

/**
 * Creates a Prism CUA Broker client instance.
 */
export function createBrokerClient({
  brokerFilePath,
  profileFilePath,
  profileData,
  homeDir = os.homedir(),
  env = process.env,
  fetchFn = globalThis.fetch,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  consentTimeoutMs = DEFAULT_CONSENT_TIMEOUT_MS
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new TypeError('fetchFn must be a function');
  }

  function resolveBrokerPath() {
    if (typeof brokerFilePath === 'string' && brokerFilePath.trim()) {
      return path.resolve(brokerFilePath.trim());
    }
    return resolveDefaultBrokerFilePath(homeDir, env);
  }

  function getBrokerConfig() {
    return readBrokerDiscoveryFile(resolveBrokerPath());
  }

  function getExternalAdapterConfig() {
    return readExternalEndpointFromProfile({
      profileFilePath,
      profileData,
      homeDir,
      env
    });
  }

  async function request(op, params = {}, options = {}) {
    const config = getBrokerConfig();
    const timeoutMs = Math.max(
      250,
      Number(options.timeoutMs) ||
        (op === 'request_consent' ? consentTimeoutMs : defaultTimeoutMs)
    );
    const idempotencyKey = options.idempotencyKey ?? params?.idempotencyKey ?? '';
    const nonce = crypto.randomBytes(16).toString('hex');

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${config.token}`,
      'X-Prism-Nonce': nonce
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = String(idempotencyKey);
    }

    const isBrowserTarget = (p) =>
      p?.target === 'browser' ||
      ((p?.target === 'auto' || !p?.target) && p?.tabId !== undefined && p?.tabId !== null && !p?.hwnd && !p?.windowId);

    let wireAction = op;
    if (op === 'observe') {
      wireAction = isBrowserTarget(params) ? 'browser_observe' : 'desktop_observe';
    } else if (op === 'act') {
      wireAction = isBrowserTarget(params) ? 'browser_act' : 'desktop_act';
    }

    const bodyStr = JSON.stringify({
      ...params,
      action: wireAction,
      op,
      command: op,
      nonce,
      ...(idempotencyKey ? { idempotencyKey: String(idempotencyKey) } : {}),
      payload: params
    });

    const endpointErrors = [];
    for (let i = 0; i < config.endpoints.length; i++) {
      const targetUrl = config.endpoints[i];
      let response;
      try {
        response = await fetchFn(targetUrl, {
          method: 'POST',
          headers,
          body: bodyStr,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (netErr) {
        endpointErrors.push(`${targetUrl}: ${String(netErr?.message || netErr).slice(0, 120)}`);
        continue;
      }

      const httpStatus = Number(response?.status ?? 200);
      let rawData = null;
      try {
        const text = typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json());
        rawData = text ? JSON.parse(text) : {};
      } catch {
        rawData = {};
      }

      // Gateway/service-unavailable errors on first endpoint can fall back to secondary bridge endpoint.
      if ((httpStatus === 502 || httpStatus === 503 || httpStatus === 504) && i + 1 < config.endpoints.length) {
        endpointErrors.push(`${targetUrl}: HTTP ${httpStatus}`);
        continue;
      }

      const normalized = normalizeRpcPayload(rawData, httpStatus);
      if (httpStatus === 401 || httpStatus === 403) {
        return {
          ...normalized,
          ok: false,
          code: normalized.code || 'BROKER_AUTH_FAILED'
        };
      }
      if (normalized.code && APPLICATION_TERMINAL_CODES.has(normalized.code)) {
        return normalized;
      }
      return normalized;
    }

    throw Object.assign(
      new Error(`无法连接 CUA Broker 本地端点 (${endpointErrors.join(' ; ') || '无响应'})`),
      { code: 'BROKER_UNREACHABLE', endpointErrors }
    );
  }

  async function callExternalAdapter(op, payload = {}, options = {}) {
    const ext = getExternalAdapterConfig();
    if (!ext) {
      throw Object.assign(
        new Error('未配置外部回环 CUA 端点 (cua.externalEndpoint)'),
        { code: 'EXTERNAL_ENDPOINT_NOT_CONFIGURED' }
      );
    }

    const requestedCat = String(payload?.category ?? '').trim().toLowerCase();
    if (
      (requestedCat && FORBIDDEN_CATEGORY_LOWER_SET.has(requestedCat)) ||
      FORBIDDEN_EXTERNAL_TOOL_NAME_RE.test(String(op || ''))
    ) {
      throw Object.assign(
        new Error(`禁止向外部 CUA 端点转发高危系统类别操作 (${payload?.category || op})`),
        { code: 'FORBIDDEN_EXTERNAL_CATEGORY' }
      );
    }

    const timeoutMs = Math.max(250, Number(options.timeoutMs) || defaultTimeoutMs);
    const nonce = crypto.randomBytes(16).toString('hex');
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Prism-Nonce': nonce,
      ...ext.headers
    };
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = String(options.idempotencyKey);
    }

    const targetUrl = ext.baseUrl.endsWith('/v1/cua')
      ? ext.baseUrl
      : `${ext.baseUrl}/v1/cua`;

    const res = await fetchFn(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        op,
        anonymizedTelemetry: false,
        ...payload
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const text = typeof res.text === 'function'
      ? await res.text()
      : JSON.stringify(await res.json());
    const parsed = text ? JSON.parse(text) : {};
    if (Array.isArray(parsed.tools)) {
      parsed.tools = stripForbiddenExternalTools(parsed.tools);
    }
    return normalizeRpcPayload(parsed, Number(res?.status ?? 200));
  }

  return {
    getBrokerConfig,
    getExternalAdapterConfig,
    request,
    callExternalAdapter,
    getStatus: (params = {}, opts = {}) => request('status', params, opts),
    requestConsent: ({ needAct = false, target = 'auto', reason = '' } = {}, opts = {}) =>
      request('request_consent', { needAct: Boolean(needAct), target, reason }, opts),
    pauseHandoff: ({ reason = '', kind = '', code = 'PAUSED_HANDOFF' } = {}, opts = {}) =>
      request('pause_handoff', { reason, kind, code }, opts),
    setMouseMode: (mouseMode, opts = {}) =>
      request('set_mouse_mode', { mouseMode }, opts),
    observe: (params = {}, opts = {}) => request('observe', params, opts),
    act: (step, meta = {}, opts = {}) =>
      request(
        'act',
        {
          ...meta,
          step,
          actions: [step]
        },
        {
          ...opts,
          idempotencyKey: opts.idempotencyKey ?? meta.idempotencyKey
        }
      )
  };
}
