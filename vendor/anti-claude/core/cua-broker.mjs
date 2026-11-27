/**
 * Anti-Claude Prism Suite v0.9.1 — core/cua-broker.mjs
 * Zero-dependency Controlled Desktop & Browser CUA Session Broker + Native Messaging HTTP Relay.
 *
 * Security invariants:
 *   1. Binds ONLY to 127.0.0.1 (ephemeral port) and optional WSL virtual adapter IPv4 (NEVER 0.0.0.0).
 *   2. Enforces exact Host header allowlist (anti-DNS-rebinding) + constant-time Bearer token check.
 *   3. Verifies prism-win-cua.exe SHA-256 against prism-win-cua.exe.sha256 before every execution.
 *   4. Hard child-process timeouts with immediate kill so daemon.mjs never stalls on UIA or Win32 IPC.
 *   5. Session-scoped consent (DISARMED | ARMED_READONLY | ARMED_INTERACTIVE | PAUSED_HANDOFF) with
 *      instant Esc / Revoke emergency abort and modifier-key release.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SUITE_ROOT_CANDIDATE = path.resolve(__dirname, '..', '..', '..');

export const CUA_EXTENSION_ID = 'lbmibnghmlnidfiihkegicaejaacmkca';
export const CUA_NM_HOST_NAME = 'com.prism.cua.bridge';
export const CUA_VERSION = '0.9.1';
export const MAX_CUA_BODY_BYTES = 2 * 1024 * 1024;

export const CUA_STATES = Object.freeze({
  DISARMED: 'DISARMED',
  ARMED_READONLY: 'ARMED_READONLY',
  ARMED_INTERACTIVE: 'ARMED_INTERACTIVE',
  PAUSED_HANDOFF: 'PAUSED_HANDOFF'
});

export const CUA_MOUSE_MODES = Object.freeze({
  COURTEOUS: 'courteous',
  STRICT_VIRTUAL: 'strict_virtual'
});

export function normalizeCuaMouseMode(raw, { allowPhysicalOverride = false, fallback = CUA_MOUSE_MODES.COURTEOUS } = {}) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'strict_virtual' || s === 'virtual_only' || s === 'background') {
    return CUA_MOUSE_MODES.STRICT_VIRTUAL;
  }
  if (allowPhysicalOverride && (s === 'physical' || s === 'hardware')) {
    return 'physical';
  }
  if (s === 'courteous' || s === 'auto' || s === 'smart') {
    return CUA_MOUSE_MODES.COURTEOUS;
  }
  return fallback;
}

const WSL_IFACE_NAME_RE = /WSL|vEthernet/i;
const WSL_PRIVATE_GATEWAY_RE = /^172\.(1[6-9]|2\d|3[01])\.\d+\.1$/;
const SAFE_WSL_DISTRO_RE = /^[a-zA-Z0-9._-]+$/;
const SHA256_HEX_RE = /^([0-9a-f]{64})(?:\s|$)/i;

/**
 * Discover WSL host-side virtual adapter IPv4 address from os.networkInterfaces().
 * Never returns 0.0.0.0 or 127.0.0.1.
 */
export function discoverWslAdapterIpv4(networkInterfaces = os.networkInterfaces()) {
  if (!networkInterfaces || typeof networkInterfaces !== 'object') return null;

  let fallbackGatewayIp = null;
  for (const [ifName, addrs] of Object.entries(networkInterfaces)) {
    if (!Array.isArray(addrs)) continue;
    const nameMatchesWsl = WSL_IFACE_NAME_RE.test(ifName);
    for (const entry of addrs) {
      if (!entry || entry.internal) continue;
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4) continue;
      const ip = String(entry.address || '').trim();
      if (!ip || ip === '0.0.0.0' || ip.startsWith('127.')) continue;
      if (nameMatchesWsl) {
        return ip;
      }
      if (!fallbackGatewayIp && WSL_PRIVATE_GATEWAY_RE.test(ip)) {
        fallbackGatewayIp = ip;
      }
    }
  }
  return fallbackGatewayIp;
}

const WSL_DISCOVERY_TTL_MS = 60_000;
let cachedWslDirs = [];
let cachedWslDirsAt = 0;
let wslDiscoveryInFlight = null;

function readEnvWslGeminiDirsSync() {
  const envRaw = String(process.env.ANTI_CLAUDE_WSL_GEMINI_DIR || '').trim();
  if (!envRaw) return null;
  return envRaw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      try {
        return Boolean(fs.statSync(s, { throwIfNoEntry: false })?.isDirectory());
      } catch {
        return false;
      }
    });
}

function execWslRunningDistrosAsync() {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-l', '-q', '--running'],
      { encoding: 'buffer', timeout: 2500, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        const rawTxt = Buffer.isBuffer(stdout)
          ? (stdout.includes(0) ? stdout.toString('utf16le') : stdout.toString('utf8'))
          : String(stdout);
        const distros = rawTxt
          .replace(/\0/g, '')
          .replace(/^\uFEFF/, '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && SAFE_WSL_DISTRO_RE.test(s) && !/^docker-desktop/i.test(s));
        resolve(distros);
      }
    );
  });
}

async function isDirectoryAsync(dirPath) {
  try {
    const st = await fs.promises.stat(dirPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

export function refreshWslGeminiDirsAsync({ force = false } = {}) {
  const envDirs = readEnvWslGeminiDirsSync();
  if (envDirs !== null) {
    return Promise.resolve(envDirs);
  }
  if (process.platform !== 'win32') {
    cachedWslDirs = [];
    cachedWslDirsAt = Date.now();
    return Promise.resolve([]);
  }
  const now = Date.now();
  if (!force && cachedWslDirsAt > 0 && now - cachedWslDirsAt < WSL_DISCOVERY_TTL_MS) {
    return Promise.resolve([...cachedWslDirs]);
  }
  if (wslDiscoveryInFlight) {
    return wslDiscoveryInFlight;
  }

  const runPromise = (async () => {
    const out = [];
    const seen = new Set();
    try {
      const distros = await execWslRunningDistrosAsync();
      for (const distro of distros) {
        for (const uncBase of [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`]) {
          try {
            if (!(await isDirectoryAsync(uncBase))) continue;
            const homeRoot = path.join(uncBase, 'home');
            try {
              const entries = await fs.promises.readdir(homeRoot, { withFileTypes: true });
              for (const u of entries) {
                if (!u.isDirectory() || u.name.startsWith('.')) continue;
                const gDir = path.join(homeRoot, u.name, '.gemini');
                const key = gDir.toLowerCase();
                if (!seen.has(key) && (await isDirectoryAsync(gDir))) {
                  seen.add(key);
                  out.push(gDir);
                }
              }
            } catch {}
            const rootGemini = path.join(uncBase, 'root', '.gemini');
            const rKey = rootGemini.toLowerCase();
            if (!seen.has(rKey) && (await isDirectoryAsync(rootGemini))) {
              seen.add(rKey);
              out.push(rootGemini);
            }
            break;
          } catch {}
        }
      }
      cachedWslDirs = out;
      cachedWslDirsAt = Date.now();
    } catch {
      cachedWslDirsAt = Date.now();
    }
    return [...cachedWslDirs];
  })().finally(() => {
    if (wslDiscoveryInFlight === runPromise) {
      wslDiscoveryInFlight = null;
    }
  });

  wslDiscoveryInFlight = runPromise;
  return runPromise;
}

function fallbackDiscoverWslGeminiDirs() {
  const envDirs = readEnvWslGeminiDirsSync();
  if (envDirs !== null) return envDirs;
  if (process.platform !== 'win32') return [];
  if (!wslDiscoveryInFlight && (cachedWslDirsAt === 0 || Date.now() - cachedWslDirsAt >= WSL_DISCOVERY_TTL_MS)) {
    void refreshWslGeminiDirsAsync();
  }
  return [...cachedWslDirs];
}

export function resolveDefaultCuaExePath({ homeDir = os.homedir(), cuaExePath = '' } = {}) {
  if (cuaExePath && String(cuaExePath).trim()) {
    return path.resolve(String(cuaExePath).trim());
  }
  if (process.env.PRISM_WIN_CUA_EXE && String(process.env.PRISM_WIN_CUA_EXE).trim()) {
    return path.resolve(String(process.env.PRISM_WIN_CUA_EXE).trim());
  }
  const primary = path.join(REPO_ROOT, 'bin', 'prism-win-cua.exe');
  const candidates = [
    primary,
    path.join(SUITE_ROOT_CANDIDATE, 'bin', 'prism-win-cua.exe'),
    path.join(homeDir, '.gemini', 'antigravity', 'prism-suite', 'bin', 'prism-win-cua.exe'),
    path.join(homeDir, '.gemini', 'antigravity', 'anti-claude', 'runtime', 'bin', 'prism-win-cua.exe')
  ];
  for (const candidate of candidates) {
    try {
      const st = fs.lstatSync(candidate, { throwIfNoEntry: false });
      if (st && st.isFile() && !st.isSymbolicLink()) {
        return candidate;
      }
    } catch {}
  }
  return primary;
}

/**
 * Verify prism-win-cua.exe matches prism-win-cua.exe.sha256 alongside it.
 */
export function verifyCuaBinaryIntegrity(exePath) {
  const resolvedExe = path.resolve(String(exePath || ''));
  const shaPath = `${resolvedExe}.sha256`;
  try {
    const exeSt = fs.lstatSync(resolvedExe, { throwIfNoEntry: false });
    if (!exeSt || !exeSt.isFile() || exeSt.isSymbolicLink()) {
      return {
        ok: false,
        code: 'BINARY_MISSING',
        error: `prism-win-cua.exe 未找到或不是普通文件: ${resolvedExe}`
      };
    }
    const shaSt = fs.lstatSync(shaPath, { throwIfNoEntry: false });
    if (!shaSt || !shaSt.isFile() || shaSt.isSymbolicLink()) {
      return {
        ok: false,
        code: 'BINARY_SHA256_MISSING',
        error: `缺少完整性校验文件: ${shaPath}`
      };
    }
    const rawShaText = fs.readFileSync(shaPath, 'utf8').replace(/^\uFEFF/, '').trim();
    const match = rawShaText.match(SHA256_HEX_RE);
    if (!match) {
      return {
        ok: false,
        code: 'BINARY_SHA256_MALFORMED',
        error: `SHA-256 校验文件格式无效: ${shaPath}`
      };
    }
    const expectedHex = match[1].toLowerCase();
    const actualHex = crypto.createHash('sha256').update(fs.readFileSync(resolvedExe)).digest('hex').toLowerCase();
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const actualBuf = Buffer.from(actualHex, 'utf8');
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return {
        ok: false,
        code: 'BINARY_INTEGRITY_FAILED',
        error: 'prism-win-cua.exe SHA-256 校验失败，已拒绝执行'
      };
    }
    return { ok: true, exePath: resolvedExe, sha256: actualHex };
  } catch (err) {
    return {
      ok: false,
      code: 'BINARY_INTEGRITY_FAILED',
      error: `校验 prism-win-cua.exe 失败: ${err?.message || err}`
    };
  }
}

export function resolveBrokerDiscoveryPaths({
  homeDir = os.homedir(),
  prismSuiteDir = '',
  discoverWslGeminiDirs = fallbackDiscoverWslGeminiDirs
} = {}) {
  const winSuiteDir = prismSuiteDir
    ? path.resolve(prismSuiteDir)
    : path.join(homeDir, '.gemini', 'antigravity', 'prism-suite');
  const winBrokerFile = path.join(winSuiteDir, 'cua-broker.json');
  const nmManifestFile = path.join(winSuiteDir, `${CUA_NM_HOST_NAME}.json`);
  const wslBrokerFiles = [];

  try {
    const wslGeminiDirs = typeof discoverWslGeminiDirs === 'function' ? discoverWslGeminiDirs() : [];
    if (Array.isArray(wslGeminiDirs)) {
      for (const gDir of wslGeminiDirs) {
        if (!gDir || typeof gDir !== 'string') continue;
        wslBrokerFiles.push(path.join(gDir, 'antigravity', 'prism-suite', 'cua-broker.json'));
      }
    }
  } catch {}

  return { winSuiteDir, winBrokerFile, nmManifestFile, wslBrokerFiles };
}

function writePrivateJsonAtomic(destFile, obj) {
  const dir = path.dirname(destFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = fs.lstatSync(destFile, { throwIfNoEntry: false });
  if (existing && (existing.isSymbolicLink() || existing.isDirectory())) {
    throw new Error(`Refusing to overwrite symlink or directory: ${destFile}`);
  }
  const tmpFile = path.join(
    dir,
    `.cua-tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  );
  const content = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    fs.writeFileSync(tmpFile, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      fs.chmodSync(tmpFile, 0o600);
    } catch {}
    fs.renameSync(tmpFile, destFile);
    try {
      fs.chmodSync(destFile, 0o600);
    } catch {}
  } catch (err) {
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {}
    throw err;
  }
}

function removeBrokerFileIfOwned(filePath, expectedPid = process.pid) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.pid === expectedPid) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {}
}

function normalizeHwndKey(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  try {
    if (/^0x[0-9a-f]+$/i.test(s)) {
      return `0x${BigInt(s).toString(16).toUpperCase()}`;
    }
    if (/^\d+$/.test(s)) {
      return `0x${BigInt(s).toString(16).toUpperCase()}`;
    }
  } catch {}
  return s.toUpperCase();
}

function normalizeArmedTab(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const idNum = Number(raw);
    if (!Number.isFinite(idNum)) return null;
    return { tabId: idNum, id: idNum, title: '', url: '', origin: '' };
  }
  if (typeof raw === 'object') {
    const idVal = raw.tabId ?? raw.id;
    const idNum = Number(idVal);
    if (!Number.isFinite(idNum)) return null;
    return {
      tabId: idNum,
      id: idNum,
      title: typeof raw.title === 'string' ? raw.title : '',
      url: typeof raw.url === 'string' ? raw.url : '',
      origin: typeof raw.origin === 'string' ? raw.origin : ''
    };
  }
  return null;
}

function constantTimeBearerMatch(authHeader, expectedTokenBuf) {
  const headerStr = typeof authHeader === 'string' ? authHeader : '';
  if (!headerStr.startsWith('Bearer ')) {
    crypto.timingSafeEqual(expectedTokenBuf, expectedTokenBuf);
    return false;
  }
  const candidateStr = headerStr.slice('Bearer '.length).trim();
  const candidateBuf = Buffer.from(candidateStr, 'utf8');
  if (candidateBuf.length !== expectedTokenBuf.length) {
    crypto.timingSafeEqual(expectedTokenBuf, expectedTokenBuf);
    return false;
  }
  return crypto.timingSafeEqual(candidateBuf, expectedTokenBuf);
}

function readJsonRequestBody(req, maxBytes = MAX_CUA_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error(`Request JSON body exceeds ${maxBytes} bytes`);
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        try {
          req.destroy();
        } catch {}
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('JSON body must be an object');
          err.code = 'INVALID_JSON_OBJECT';
          reject(err);
          return;
        }
        resolve(parsed);
      } catch {
        const err = new Error('Malformed JSON request body');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.on('close', () => {
      if (!settled && !req.complete) {
        settled = true;
        reject(Object.assign(new Error('Request aborted before completion'), { code: 'REQUEST_ABORTED' }));
      }
    });
  });
}

function sendJsonResponse(res, statusCode, payload) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body, 'utf8')
  });
  res.end(body);
}

function execRegAddKey(regKey, manifestPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'reg.exe',
      ['add', regKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
      { timeout: 5000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || stdout || err.message || err).trim()));
          return;
        }
        resolve(String(stdout || '').trim());
      }
    );
  });
}

/**
 * Create a self-contained CUA Broker instance.
 */
export function createCuaBroker(options = {}) {
  const {
    allowNonWin32ForTest = false,
    mockWorkerRunner = null,
    regRunner = null,
    homeDir = os.homedir(),
    prismSuiteDir = '',
    cuaExePath = '',
    discoverWslGeminiDirs = fallbackDiscoverWslGeminiDirs,
    networkInterfacesFn = () => os.networkInterfaces(),
    wslAdapterIp,
    nmPollHoldMs = 15000,
    nmHeartbeatTtlMs = 35000,
    defaultMouseMode = ''
  } = options;

  const isSupportedPlatform = process.platform === 'win32' || Boolean(allowNonWin32ForTest);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenBuf = Buffer.from(token, 'utf8');

  function resolveSettingsFilePath() {
    const { winSuiteDir } = resolveBrokerDiscoveryPaths({
      homeDir,
      prismSuiteDir,
      discoverWslGeminiDirs
    });
    return path.join(winSuiteDir, 'cua-settings.json');
  }

  function loadPersistedMouseMode() {
    if (defaultMouseMode) {
      return normalizeCuaMouseMode(defaultMouseMode);
    }
    try {
      const f = resolveSettingsFilePath();
      const st = fs.lstatSync(f, { throwIfNoEntry: false });
      if (st && st.isFile() && !st.isSymbolicLink()) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        return normalizeCuaMouseMode(parsed?.mouseMode);
      }
    } catch {}
    return CUA_MOUSE_MODES.COURTEOUS;
  }

  let state = CUA_STATES.DISARMED;
  let mouseMode = loadPersistedMouseMode();
  let prePauseState = null;
  let handoffReason = '';
  let scope = null;
  let expiresAt = null;
  let lastWindows = [];
  let armedTabs = [];
  let lastNmSeenAt = 0;
  let activeRelaySessionId = '';
  const consentInFlightByScope = new Map();

  const servers = [];
  const boundEndpoints = [];
  const allowedHosts = new Set();
  const writtenBrokerFiles = new Set();
  const activeWorkerControllers = new Set();

  const nmCommandQueue = [];
  const nmPollWaiters = new Set();
  const pendingBrowserRequests = new Map();

  const seenNonces = new Map();
  const idempotencyCache = new Map();

  let overlayChild = null;
  let overlayStdoutBuf = '';
  const mockOverlayHistory = [];

  let expiryTimer = null;
  let wslSyncTimer = null;
  let started = false;
  let stopped = false;

  function resolveExePath() {
    return resolveDefaultCuaExePath({ homeDir, cuaExePath });
  }

  function pruneReplayCaches(now = Date.now()) {
    if (seenNonces.size > 512) {
      for (const [k, exp] of seenNonces.entries()) {
        if (now >= exp || seenNonces.size > 512) seenNonces.delete(k);
      }
    } else {
      for (const [k, exp] of seenNonces.entries()) {
        if (now >= exp) seenNonces.delete(k);
      }
    }

    for (const [k, entry] of idempotencyCache.entries()) {
      if (now >= entry.expiresAt) idempotencyCache.delete(k);
    }
    while (idempotencyCache.size > 256) {
      const oldestKey = idempotencyCache.keys().next().value;
      if (oldestKey === undefined) break;
      idempotencyCache.delete(oldestKey);
    }
  }

  function isExtensionConnected(now = Date.now()) {
    return lastNmSeenAt > 0 && now - lastNmSeenAt < nmHeartbeatTtlMs;
  }

  function isNmHostRegistered() {
    const { nmManifestFile } = resolveBrokerDiscoveryPaths({
      homeDir,
      prismSuiteDir,
      discoverWslGeminiDirs
    });
    try {
      return Boolean(fs.statSync(nmManifestFile, { throwIfNoEntry: false })?.isFile());
    } catch {
      return false;
    }
  }

  function getRemainingSec(now = Date.now()) {
    if (!expiresAt || state === CUA_STATES.DISARMED) return 0;
    return Math.max(0, Math.ceil((expiresAt - now) / 1000));
  }

  function checkAndExpireConsent(now = Date.now()) {
    if (state !== CUA_STATES.DISARMED && expiresAt && now >= expiresAt) {
      disarmInternal({ releaseModifiers: true });
    }
  }

  function sendOverlayUpdate(visualState) {
    if (mockWorkerRunner && !options.spawnOverlayInMock) {
      mockOverlayHistory.push({ at: Date.now(), state: visualState });
      return;
    }
    if (process.platform !== 'win32') return;

    if (visualState === 'EXIT' || visualState === CUA_STATES.DISARMED) {
      stopOverlayProcess();
      return;
    }

    if (!overlayChild || overlayChild.killed || overlayChild.exitCode !== null) {
      const exe = resolveExePath();
      const verified = verifyCuaBinaryIntegrity(exe);
      if (!verified.ok) return;
      try {
        const child = spawn(verified.exePath, ['--overlay', '--parent-pid', String(process.pid)], {
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true
        });
        child.stdin.on('error', () => {});
        overlayChild = child;
        overlayStdoutBuf = '';

        child.stdout.on('data', (chunk) => {
          overlayStdoutBuf += chunk.toString('utf8');
          const lines = overlayStdoutBuf.split(/\r?\n/);
          overlayStdoutBuf = lines.pop() || '';
          for (const rawLine of lines) {
            handleOverlayStdoutLine(rawLine);
          }
        });

        child.on('error', () => {
          if (overlayChild === child) overlayChild = null;
        });
        child.on('close', () => {
          if (overlayChild === child) overlayChild = null;
        });
      } catch {
        overlayChild = null;
        return;
      }
    }

    try {
      overlayChild.stdin.write(`${JSON.stringify({ state: visualState })}\n`);
    } catch {}
  }

  function sendOverlayVirtualCursor({ x, y, op = 'click' } = {}) {
    const px = Math.round(Number(x));
    const py = Math.round(Number(y));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    if (mockWorkerRunner && !options.spawnOverlayInMock) {
      mockOverlayHistory.push({ at: Date.now(), state: 'VIRTUAL_CURSOR', x: px, y: py, op });
      return;
    }
    if (process.platform !== 'win32') return;
    if (!overlayChild || overlayChild.killed || overlayChild.exitCode !== null) return;
    try {
      overlayChild.stdin.write(`${JSON.stringify({ state: 'VIRTUAL_CURSOR', x: px, y: py, op })}\n`);
    } catch {}
  }

  function stopOverlayProcess() {
    if (mockWorkerRunner && !options.spawnOverlayInMock) {
      mockOverlayHistory.push({ at: Date.now(), state: 'EXIT' });
    }
    const child = overlayChild;
    overlayChild = null;
    overlayStdoutBuf = '';
    if (!child) return;
    try {
      child.stdin.write('{"state":"EXIT"}\n');
      child.stdin.end();
    } catch {}
    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) child.kill();
      } catch {}
    }, 250).unref?.();
  }

  function handleOverlayStdoutLine(rawLine) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed) return;
    let action = trimmed.toUpperCase();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        action = String(parsed?.action || parsed?.event || '').trim().toUpperCase();
      } catch {
        return;
      }
    }
    if (action === 'REVOKE') {
      void handleRevoke();
    } else if (action === 'RESUME') {
      void handleResumeHandoff();
    }
  }

  function abortInFlightActions(reasonCode = 'REVOKED', reasonMsg = 'CUA 授权已收回或中断') {
    for (const ac of activeWorkerControllers) {
      try {
        ac.abort();
      } catch {}
    }
    activeWorkerControllers.clear();

    for (const [reqId, pending] of pendingBrowserRequests.entries()) {
      clearTimeout(pending.timer);
      pendingBrowserRequests.delete(reqId);
      pending.resolve({ ok: false, code: reasonCode, error: reasonMsg });
    }
  }

  function disarmInternal({ releaseModifiers = false } = {}) {
    abortInFlightActions('REVOKED', '用户已收回 Prism CUA 授权');
    state = CUA_STATES.DISARMED;
    prePauseState = null;
    handoffReason = '';
    scope = null;
    expiresAt = null;
    stopOverlayProcess();
    enqueueNmCommand({
      id: `evt-${Date.now()}`,
      type: 'cua_state',
      action: 'cua_state',
      state: CUA_STATES.DISARMED
    });
    if (releaseModifiers) {
      void runWorker({
        mode: 'release-modifiers',
        cmd: 'release-modifiers',
        args: ['--release-modifiers'],
        stdinObj: null,
        timeoutMs: 2500,
        trackAbort: false
      }).catch(() => {});
    }
  }

  async function runWorker({ mode, cmd, args, stdinObj = null, timeoutMs = 4500, trackAbort = false }) {
    const ac = new AbortController();
    if (trackAbort) activeWorkerControllers.add(ac);

    try {
      if (mockWorkerRunner) {
        if (typeof mockWorkerRunner === 'function') {
          return await mockWorkerRunner({
            mode,
            cmd,
            args,
            stdin: stdinObj,
            timeoutMs,
            signal: ac.signal
          });
        }
        if (typeof mockWorkerRunner === 'object') {
          const fn = mockWorkerRunner[cmd] || mockWorkerRunner[mode] || mockWorkerRunner.run;
          if (typeof fn === 'function') {
            return await fn({
              mode,
              cmd,
              args,
              stdin: stdinObj,
              timeoutMs,
              signal: ac.signal
            });
          }
        }
      }

      const exe = resolveExePath();
      const verified = verifyCuaBinaryIntegrity(exe);
      if (!verified.ok) {
        return { ok: false, code: verified.code, error: verified.error };
      }

      return await new Promise((resolve) => {
        let settled = false;
        let stdoutText = '';
        let stderrText = '';

        const finish = (resObj) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ac.signal.removeEventListener('abort', onAbort);
          resolve(resObj);
        };

        const fullArgs = [...args, '--parent-pid', String(process.pid)];
        let child;
        try {
          child = spawn(verified.exePath, fullArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
          });
          child.stdin.on('error', () => {});
        } catch (err) {
          finish({
            ok: false,
            code: 'WORKER_SPAWN_FAILED',
            error: `无法启动 prism-win-cua.exe: ${err?.message || err}`
          });
          return;
        }

        const killChildHard = () => {
          try {
            if (child.exitCode === null && !child.killed) {
              child.kill('SIGKILL');
            }
          } catch {}
        };

        const onAbort = () => {
          killChildHard();
          finish({
            ok: false,
            code: 'ACTION_ABORTED',
            error: '当前操作已被紧急中止或收回授权'
          });
        };

        if (ac.signal.aborted) {
          onAbort();
          return;
        }
        ac.signal.addEventListener('abort', onAbort, { once: true });

        const timer = setTimeout(() => {
          killChildHard();
          finish({
            ok: false,
            code: 'WORKER_TIMEOUT',
            error: `prism-win-cua.exe (${cmd}) 超时 (${timeoutMs}ms) 已被强制终止`
          });
        }, timeoutMs);
        timer.unref?.();

        child.stdout.on('data', (chunk) => {
          if (stdoutText.length < 12 * 1024 * 1024) {
            stdoutText += chunk.toString('utf8');
          }
        });

        child.stderr.on('data', (chunk) => {
          if (stderrText.length < 64 * 1024) {
            stderrText += chunk.toString('utf8');
          }
        });

        child.on('error', (err) => {
          finish({
            ok: false,
            code: 'WORKER_ERROR',
            error: String(err?.message || err)
          });
        });

        child.on('close', (exitCode) => {
          const trimmed = stdoutText.trim();
          if (trimmed) {
            const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() || trimmed;
            try {
              const parsed = JSON.parse(lastLine);
              if (parsed && typeof parsed === 'object') {
                finish(parsed);
                return;
              }
            } catch {}
          }
          finish({
            ok: false,
            code: 'WORKER_INVALID_OUTPUT',
            error: stderrText.trim() || `prism-win-cua.exe 退出码 ${exitCode}`
          });
        });

        try {
          if (stdinObj !== null && stdinObj !== undefined) {
            child.stdin.write(JSON.stringify(stdinObj), 'utf8');
          }
          child.stdin.end();
        } catch {}
      });
    } finally {
      if (trackAbort) activeWorkerControllers.delete(ac);
    }
  }

  function enqueueNmCommand(cmdObj) {
    if (!isExtensionConnected() && nmPollWaiters.size === 0) {
      return false;
    }
    nmCommandQueue.push(cmdObj);
    while (nmCommandQueue.length > 128) {
      nmCommandQueue.shift();
    }
    flushNmWaiters();
    return true;
  }

  function flushNmWaiters() {
    if (nmPollWaiters.size === 0) return;
    if (nmCommandQueue.length === 0 && !stopped) return;
    const batch = nmCommandQueue.splice(0, nmCommandQueue.length);
    const firstWaiter = nmPollWaiters.values().next().value;
    if (firstWaiter) {
      nmPollWaiters.delete(firstWaiter);
      firstWaiter(batch);
    }
    if (stopped) {
      for (const waiter of nmPollWaiters) {
        waiter([]);
      }
      nmPollWaiters.clear();
    }
  }

  function dispatchBrowserCommand(actionName, payloadObj, timeoutMs = 5000) {
    const requestId = `br-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const tabId = Number(payloadObj?.tabId);
    const wireCmd = {
      id: requestId,
      requestId,
      type: actionName,
      action: actionName,
      cmd: actionName,
      tabId,
      step: payloadObj?.step || null,
      payload: { ...payloadObj, tabId }
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingBrowserRequests.delete(requestId);
        resolve({
          ok: false,
          code: 'BROWSER_BRIDGE_TIMEOUT',
          error: `浏览器扩展执行 ${actionName} 超时 (${timeoutMs}ms)`
        });
      }, timeoutMs);
      timer.unref?.();

      pendingBrowserRequests.set(requestId, { resolve, timer, actionName });
      nmCommandQueue.push(wireCmd);
      flushNmWaiters();
    });
  }

  function getStatusSnapshot(windowsOverride = null) {
    const now = Date.now();
    checkAndExpireConsent(now);
    return {
      ok: true,
      state,
      expiresAt,
      expiresAtIso: expiresAt ? new Date(expiresAt).toISOString() : null,
      remainingSec: getRemainingSec(now),
      scope,
      handoffReason: state === CUA_STATES.PAUSED_HANDOFF ? handoffReason : null,
      windows: Array.isArray(windowsOverride) ? windowsOverride : lastWindows,
      armedTabs: [...armedTabs],
      mouseMode,
      extensionConnected: isExtensionConnected(now),
      extensionId: CUA_EXTENSION_ID,
      nmRegistered: isNmHostRegistered()
    };
  }

  async function handleSetMouseMode(payload = {}) {
    const raw = payload?.mouseMode ?? payload?.mode;
    const normalized = normalizeCuaMouseMode(raw, { fallback: '' });
    if (!normalized) {
      return {
        ok: false,
        code: 'INVALID_MOUSE_MODE',
        error: 'mouseMode 仅支持 courteous 或 strict_virtual'
      };
    }
    mouseMode = normalized;
    try {
      const settingsFile = resolveSettingsFilePath();
      let prevSettings = {};
      try {
        const st = fs.lstatSync(settingsFile, { throwIfNoEntry: false });
        if (st && st.isFile() && !st.isSymbolicLink()) {
          const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            prevSettings = parsed;
          }
        }
      } catch {}
      writePrivateJsonAtomic(settingsFile, {
        ...prevSettings,
        schema: 1,
        mouseMode,
        updatedAt: new Date().toISOString()
      });
    } catch {}
    enqueueNmCommand({
      id: `evt-${Date.now()}`,
      type: 'cua_state',
      action: 'cua_state',
      state,
      mouseMode,
      scope,
      expiresAt
    });
    return {
      ok: true,
      mouseMode,
      state,
      remainingSec: getRemainingSec()
    };
  }

  async function handleStatus(payload) {
    checkAndExpireConsent();
    if (payload?.refreshWindows === true || (payload?.includeWindows === true && lastWindows.length === 0)) {
      const winRes = await runWorker({
        mode: 'cmd',
        cmd: 'list-windows',
        args: ['--cmd', 'list-windows'],
        stdinObj: null,
        timeoutMs: 3500
      });
      if (winRes?.ok && Array.isArray(winRes.windows)) {
        lastWindows = winRes.windows;
      }
    }
    return getStatusSnapshot();
  }

  async function handleRequestConsent(payload = {}) {
    const scopeKey = `${Boolean(payload?.needAct)}|${String(payload?.target || '')}|${String(payload?.hwnd ?? '')}|${String(payload?.tabId ?? '')}`;
    if (consentInFlightByScope.has(scopeKey)) {
      return consentInFlightByScope.get(scopeKey);
    }
    const runConsent = async () => {
      if (lastWindows.length === 0) {
        await handleListWindows().catch(() => {});
      }
      const reqMinutesRaw = Number(payload?.requestedMinutes);
      const requestedMinutes = Number.isFinite(reqMinutesRaw)
        ? Math.max(1, Math.min(60, Math.round(reqMinutesRaw)))
        : 15;

      const consentReq = {
        workspace: typeof payload?.workspace === 'string' ? payload.workspace.slice(0, 260) : '',
        reason: typeof payload?.reason === 'string' ? payload.reason.slice(0, 600) : '',
        needAct: Boolean(payload?.needAct),
        target: typeof payload?.target === 'string' ? payload.target : '',
        hwnd: payload?.hwnd ?? null,
        tabId: payload?.tabId ?? null,
        requestedMinutes,
        windows: lastWindows
      };

      const res = await runWorker({
        mode: 'consent',
        cmd: 'consent',
        args: ['--consent'],
        stdinObj: consentReq,
        timeoutMs: 47000
      });

      if (!res || res.ok === false) {
        return {
          ok: false,
          granted: false,
          code: res?.code || 'CONSENT_DIALOG_FAILED',
          error: res?.error || '无法显示原生授权确认窗口',
          state: CUA_STATES.DISARMED,
          scope: null,
          expiresAt: null,
          remainingSec: 0
        };
      }

      if (!res.granted) {
        disarmInternal({ releaseModifiers: false });
        return {
          ok: true,
          granted: false,
          timedOut: Boolean(res.timedOut),
          state: CUA_STATES.DISARMED,
          scope: null,
          expiresAt: null,
          remainingSec: 0
        };
      }

      const grantedMinutesRaw = Number(res.durationMinutes ?? requestedMinutes);
      const grantedMinutes = Number.isFinite(grantedMinutesRaw)
        ? Math.max(1, Math.min(60, Math.round(grantedMinutesRaw)))
        : 15;

      state = res.state === CUA_STATES.ARMED_INTERACTIVE
        ? CUA_STATES.ARMED_INTERACTIVE
        : CUA_STATES.ARMED_READONLY;
      prePauseState = null;
      handoffReason = '';
      scope = res.scope && typeof res.scope === 'object'
        ? {
            type: String(res.scope.type || 'desktop_safe'),
            hwnd: res.scope.hwnd ?? null,
            title: res.scope.title ?? '',
            processName: res.scope.processName ?? '',
            tabId: res.scope.tabId ?? null
          }
        : { type: 'desktop_safe', hwnd: null, title: '', processName: '', tabId: null };
      expiresAt = Date.now() + grantedMinutes * 60 * 1000;

      sendOverlayUpdate('ARMED');
      enqueueNmCommand({
        id: `evt-${Date.now()}`,
        type: 'cua_state',
        action: 'cua_state',
        state,
        scope,
        expiresAt
      });

      return {
        ok: true,
        granted: true,
        state,
        scope,
        expiresAt,
        expiresAtIso: new Date(expiresAt).toISOString(),
        remainingSec: getRemainingSec()
      };
    };

    const inFlight = runConsent().finally(() => {
      if (consentInFlightByScope.get(scopeKey) === inFlight) {
        consentInFlightByScope.delete(scopeKey);
      }
    });
    consentInFlightByScope.set(scopeKey, inFlight);
    return inFlight;
  }

  async function handleRevoke() {
    abortInFlightActions('REVOKED', '用户已收回 Prism CUA 授权');
    state = CUA_STATES.DISARMED;
    prePauseState = null;
    handoffReason = '';
    scope = null;
    expiresAt = null;
    for (const [k, v] of idempotencyCache.entries()) {
      if (v && v.action === 'request_consent') idempotencyCache.delete(k);
    }
    stopOverlayProcess();
    enqueueNmCommand({
      id: `evt-${Date.now()}`,
      type: 'cua_state',
      action: 'cua_state',
      state: CUA_STATES.DISARMED
    });
    await runWorker({
      mode: 'release-modifiers',
      cmd: 'release-modifiers',
      args: ['--release-modifiers'],
      stdinObj: null,
      timeoutMs: 2500,
      trackAbort: false
    }).catch(() => {});
    return { ok: true, state: CUA_STATES.DISARMED };
  }

  async function handlePauseHandoff(payload = {}) {
    checkAndExpireConsent();
    if (state === CUA_STATES.DISARMED) {
      return {
        ok: false,
        code: 'CONSENT_REQUIRED',
        error: '当前未处于已授权状态，无法切换人工接管'
      };
    }
    abortInFlightActions('HANDOFF_PAUSED', '检测到验证码或敏感页面，已暂停自动操作等待人工处理');
    if (state !== CUA_STATES.PAUSED_HANDOFF) {
      prePauseState = state;
    }
    state = CUA_STATES.PAUSED_HANDOFF;
    handoffReason = typeof payload?.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : '🟠 检测到验证码/敏感页，等待人工处理';
    sendOverlayUpdate('PAUSED_HANDOFF');
    return {
      ok: true,
      state,
      reason: handoffReason,
      scope,
      expiresAt,
      remainingSec: getRemainingSec()
    };
  }

  async function handleResumeHandoff() {
    checkAndExpireConsent();
    if (state !== CUA_STATES.PAUSED_HANDOFF) {
      return {
        ok: false,
        code: 'NOT_PAUSED_HANDOFF',
        error: '当前会话未处于等待人工处理状态'
      };
    }
    state = prePauseState === CUA_STATES.ARMED_INTERACTIVE
      ? CUA_STATES.ARMED_INTERACTIVE
      : CUA_STATES.ARMED_READONLY;
    prePauseState = null;
    handoffReason = '';
    sendOverlayUpdate('ARMED');
    return {
      ok: true,
      state,
      scope,
      expiresAt,
      remainingSec: getRemainingSec()
    };
  }

  async function handleListWindows() {
    const res = await runWorker({
      mode: 'cmd',
      cmd: 'list-windows',
      args: ['--cmd', 'list-windows'],
      stdinObj: null,
      timeoutMs: 3500
    });
    if (!res || res.ok === false) {
      return {
        ok: false,
        code: res?.code || 'LIST_WINDOWS_FAILED',
        error: res?.error || '枚举桌面窗口失败'
      };
    }
    const windows = Array.isArray(res.windows) ? res.windows : [];
    lastWindows = windows;
    return { ok: true, windows };
  }

  function validateDesktopAccess({ requireInteractive = false, requestedHwnd = null } = {}) {
    checkAndExpireConsent();
    if (state === CUA_STATES.PAUSED_HANDOFF) {
      return {
        ok: false,
        code: 'HANDOFF_PAUSED',
        error: handoffReason || '🟠 检测到验证码/敏感页，等待人工处理完成后再继续'
      };
    }
    if (state === CUA_STATES.DISARMED) {
      return {
        ok: false,
        code: 'CONSENT_REQUIRED',
        error: '执行桌面观察或操作前需先获得用户授权 (request_consent)'
      };
    }
    if (requireInteractive && state !== CUA_STATES.ARMED_INTERACTIVE) {
      return {
        ok: false,
        code: 'READONLY_CONSENT',
        error: '当前仅授予只读观察权限 (ARMED_READONLY)，禁止执行键鼠动作'
      };
    }
    if (scope?.type === 'browser_tab') {
      return {
        ok: false,
        code: 'SCOPE_MISMATCH',
        error: '当前授权范围仅限已武装的浏览器标签页，禁止访问桌面窗口'
      };
    }
    let effectiveHwnd = requestedHwnd;
    if (scope?.type === 'window' && scope.hwnd) {
      if (!effectiveHwnd) {
        effectiveHwnd = scope.hwnd;
      } else if (normalizeHwndKey(effectiveHwnd) !== normalizeHwndKey(scope.hwnd)) {
        return {
          ok: false,
          code: 'SCOPE_MISMATCH',
          error: `目标窗口 (${effectiveHwnd}) 不在已授权的单窗口范围 (${scope.hwnd}) 内`
        };
      }
    }
    if (!effectiveHwnd) {
      return {
        ok: false,
        code: 'MISSING_HWND',
        error: '缺少目标桌面窗口句柄 hwnd'
      };
    }
    return { ok: true, hwnd: effectiveHwnd };
  }

  async function resolveCandidateDesktopHwnd(payload = {}) {
    const direct = payload?.hwnd ?? payload?.windowId ?? null;
    if (direct) return direct;
    if (scope?.type === 'window' && scope.hwnd) return scope.hwnd;
    if (lastWindows.length === 0) {
      await handleListWindows().catch(() => {});
    }
    const procFilter = typeof payload?.processName === 'string' ? payload.processName.trim().toLowerCase() : '';
    const titleFilter = typeof payload?.titleContains === 'string' ? payload.titleContains.trim().toLowerCase() : '';
    if (procFilter || titleFilter) {
      const matched = lastWindows.find((w) => {
        const wProc = String(w.processName || '').toLowerCase();
        const wTitle = String(w.title || '').toLowerCase();
        if (procFilter && !wProc.includes(procFilter)) return false;
        if (titleFilter && !wTitle.includes(titleFilter)) return false;
        return Boolean(w.hwnd || w.windowId);
      });
      if (matched) return matched.hwnd || matched.windowId;
    }
    if (lastWindows.length > 0 && !procFilter && !titleFilter) {
      return lastWindows[0].hwnd || lastWindows[0].windowId || null;
    }
    return null;
  }

  async function handleDesktopObserve(payload = {}) {
    const candidateHwnd = await resolveCandidateDesktopHwnd(payload);
    const check = validateDesktopAccess({
      requireInteractive: false,
      requestedHwnd: candidateHwnd
    });
    if (!check.ok) return check;

    return runWorker({
      mode: 'cmd',
      cmd: 'observe',
      args: ['--cmd', 'observe'],
      stdinObj: { ...payload, hwnd: check.hwnd },
      timeoutMs: 4500
    });
  }

  async function handleDesktopAct(payload = {}) {
    const candidateHwnd = await resolveCandidateDesktopHwnd(payload);
    const check = validateDesktopAccess({
      requireInteractive: true,
      requestedHwnd: candidateHwnd
    });
    if (!check.ok) return check;

    const stepObj = payload?.step && typeof payload.step === 'object' ? payload.step : payload;
    const effectiveMouseMode = normalizeCuaMouseMode(stepObj?.mouseMode ?? payload?.mouseMode, {
      allowPhysicalOverride: true,
      fallback: mouseMode
    });
    const rawDesktopOp = String(stepObj?.op || stepObj?.action || '').trim().toLowerCase();
    const desktopWorkerTimeoutMs = (rawDesktopOp === 'wait_for' || rawDesktopOp === 'wait')
      ? Math.min(35000, Math.max(6500, (Number(stepObj?.timeoutMs ?? stepObj?.ms ?? payload?.timeoutMs) || 5000) + 3000))
      : 6500;
    sendOverlayUpdate('EXECUTING');
    try {
      const res = await runWorker({
        mode: 'cmd',
        cmd: 'act',
        args: ['--cmd', 'act'],
        stdinObj: { hwnd: check.hwnd, mouseMode: effectiveMouseMode, step: stepObj },
        timeoutMs: desktopWorkerTimeoutMs,
        trackAbort: true
      });
      if (res?.code === 'USER_ESC_ABORTED') {
        disarmInternal({ releaseModifiers: true });
        return {
          ok: false,
          code: 'USER_ESC_ABORTED',
          error: res.error || '用户按下 Esc 紧急中断',
          state: CUA_STATES.DISARMED
        };
      }
      if (res?.ok && Number.isFinite(Number(res.x)) && Number.isFinite(Number(res.y))) {
        sendOverlayVirtualCursor({
          x: Number(res.x),
          y: Number(res.y),
          op: String(res.op || stepObj?.op || 'click')
        });
      }
      return res;
    } finally {
      if (state === CUA_STATES.ARMED_INTERACTIVE || state === CUA_STATES.ARMED_READONLY) {
        sendOverlayUpdate('ARMED');
      } else if (state === CUA_STATES.PAUSED_HANDOFF) {
        sendOverlayUpdate('PAUSED_HANDOFF');
      }
    }
  }

  function validateBrowserAccess({ requireInteractive = false, requestedTabId = null } = {}) {
    checkAndExpireConsent();
    if (state === CUA_STATES.PAUSED_HANDOFF) {
      return {
        ok: false,
        code: 'HANDOFF_PAUSED',
        error: handoffReason || '🟠 检测到验证码/敏感页，等待人工处理完成后再继续'
      };
    }
    if (state === CUA_STATES.DISARMED) {
      return {
        ok: false,
        code: 'CONSENT_REQUIRED',
        error: '执行浏览器观察或操作前需先获得用户授权 (request_consent)'
      };
    }
    if (requireInteractive && state !== CUA_STATES.ARMED_INTERACTIVE) {
      return {
        ok: false,
        code: 'READONLY_CONSENT',
        error: '当前仅授予只读观察权限 (ARMED_READONLY)，禁止执行浏览器动作'
      };
    }
    if (scope?.type === 'window') {
      return {
        ok: false,
        code: 'SCOPE_MISMATCH',
        error: '当前授权范围仅限指定桌面窗口，禁止访问浏览器标签页'
      };
    }
    if (!isExtensionConnected()) {
      return {
        ok: false,
        code: 'EXTENSION_NOT_CONNECTED',
        error: 'Prism CUA 浏览器扩展 Native Messaging 桥未连接'
      };
    }

    let effectiveTabId = requestedTabId;
    if ((effectiveTabId === null || effectiveTabId === undefined) && scope?.type === 'browser_tab' && scope.tabId != null) {
      effectiveTabId = scope.tabId;
    }
    const tabNum = Number(effectiveTabId);
    if (!Number.isFinite(tabNum)) {
      return {
        ok: false,
        code: 'MISSING_TAB_ID',
        error: '缺少有效的目标浏览器标签页 tabId'
      };
    }
    if (scope?.type === 'browser_tab' && scope.tabId != null && Number(scope.tabId) !== tabNum) {
      return {
        ok: false,
        code: 'SCOPE_MISMATCH',
        error: `目标标签页 (#${tabNum}) 不在已授权的标签页 (#${scope.tabId}) 范围内`
      };
    }
    const isTabArmed = armedTabs.some((t) => Number(t.tabId ?? t.id) === tabNum);
    if (!isTabArmed) {
      return {
        ok: false,
        code: 'TAB_NOT_ARMED',
        error: `浏览器标签页 #${tabNum} 尚未在扩展中武装授权 (Armed)`
      };
    }
    return { ok: true, tabId: tabNum };
  }

  async function handleBrowserObserve(payload = {}) {
    const check = validateBrowserAccess({
      requireInteractive: false,
      requestedTabId: payload?.tabId
    });
    if (!check.ok) return check;

    const reply = await dispatchBrowserCommand('browser_observe', { ...payload, tabId: check.tabId }, 5000);
    if (reply?.code === 'CAPTCHA_HANDOFF' || reply?.handoffRequired === true || reply?.pausedHandoff === true) {
      await handlePauseHandoff({ reason: reply.reason || reply.error });
    }
    return reply;
  }

  async function handleBrowserAct(payload = {}) {
    const check = validateBrowserAccess({
      requireInteractive: true,
      requestedTabId: payload?.tabId
    });
    if (!check.ok) return check;

    sendOverlayUpdate('EXECUTING');
    try {
      const effectiveMouseMode = normalizeCuaMouseMode(payload?.step?.mouseMode ?? payload?.mouseMode, {
        fallback: mouseMode
      });
      const rawBrowserOp = String(payload?.op || payload?.action || payload?.step?.op || payload?.step?.action || '').trim().toLowerCase();
      const rawWaitTimeout = Number(
        payload?.timeoutMs ?? payload?.ms ?? payload?.durationMs ??
        payload?.step?.timeoutMs ?? payload?.step?.ms ?? payload?.step?.durationMs
      );
      const browserTimeoutMs = (rawBrowserOp === 'wait_for' || rawBrowserOp === 'wait')
        ? Math.min(35000, Math.max(5000, (rawWaitTimeout || 5000) + 3000))
        : 5000;
      const reply = await dispatchBrowserCommand(
        'browser_act',
        { ...payload, tabId: check.tabId, mouseMode: effectiveMouseMode },
        browserTimeoutMs
      );
      if (reply?.code === 'USER_ESC_ABORTED') {
        disarmInternal({ releaseModifiers: true });
        return {
          ok: false,
          code: 'USER_ESC_ABORTED',
          error: reply.error || '用户按下 Esc 紧急中断',
          state: CUA_STATES.DISARMED
        };
      }
      if (reply?.code === 'CAPTCHA_HANDOFF' || reply?.handoffRequired === true || reply?.pausedHandoff === true) {
        await handlePauseHandoff({ reason: reply.reason || reply.error });
      }
      return reply;
    } finally {
      if (state === CUA_STATES.ARMED_INTERACTIVE || state === CUA_STATES.ARMED_READONLY) {
        sendOverlayUpdate('ARMED');
      } else if (state === CUA_STATES.PAUSED_HANDOFF) {
        sendOverlayUpdate('PAUSED_HANDOFF');
      }
    }
  }

  async function handleRegisterNmHost() {
    const exePath = resolveExePath();
    if (!mockWorkerRunner) {
      const verified = verifyCuaBinaryIntegrity(exePath);
      if (!verified.ok) {
        return { ok: false, code: verified.code, error: verified.error };
      }
    }

    const { nmManifestFile } = resolveBrokerDiscoveryPaths({
      homeDir,
      prismSuiteDir,
      discoverWslGeminiDirs
    });

    const manifestObj = {
      name: CUA_NM_HOST_NAME,
      description: 'Prism CUA Chrome Bridge',
      path: exePath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${CUA_EXTENSION_ID}/`]
    };

    writePrivateJsonAtomic(nmManifestFile, manifestObj);

    const regKeys = [
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${CUA_NM_HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${CUA_NM_HOST_NAME}`
    ];

    if (typeof regRunner === 'function') {
      for (const rk of regKeys) {
        await regRunner(rk, nmManifestFile);
      }
    } else if (process.platform === 'win32') {
      for (const rk of regKeys) {
        await execRegAddKey(rk, nmManifestFile);
      }
    }

    return {
      ok: true,
      nmRegistered: true,
      hostName: CUA_NM_HOST_NAME,
      manifestPath: nmManifestFile,
      exePath,
      extensionId: CUA_EXTENSION_ID
    };
  }

  async function dispatchCuaAction(body, reqHeaders = {}) {
    const now = Date.now();
    pruneReplayCaches(now);

    const rawAction = typeof body?.action === 'string'
      ? body.action
      : (typeof body?.op === 'string' ? body.op : (typeof body?.command === 'string' ? body.command : ''));
    let action = rawAction.trim();
    const payload = body?.payload && typeof body.payload === 'object' ? body.payload : body || {};
    const nonce = String(body?.nonce || reqHeaders['x-prism-nonce'] || '').trim();
    const idempotencyKey = String(body?.idempotencyKey || reqHeaders['idempotency-key'] || '').trim();

    if (action === 'observe') {
      action = payload?.target === 'browser' || (payload?.tabId != null && !payload?.hwnd && !payload?.windowId)
        ? 'browser_observe'
        : 'desktop_observe';
    } else if (action === 'act') {
      action = payload?.target === 'browser' || (payload?.tabId != null && !payload?.hwnd && !payload?.windowId)
        ? 'browser_act'
        : 'desktop_act';
    }

    if (!action) {
      return { ok: false, code: 'MISSING_ACTION', error: 'Missing required field: action' };
    }

    const canonicalizeJson = (val) => {
      if (val === null || typeof val !== 'object') return JSON.stringify(val);
      if (Array.isArray(val)) return `[${val.map((x) => canonicalizeJson(x)).join(',')}]`;
      const keys = Object.keys(val).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(val[k])}`).join(',')}}`;
    };
    const hashablePayload = (body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload))
      ? payload
      : (() => {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
          const { nonce: _n, idempotencyKey: _ik, ...rest } = payload;
          return rest;
        })();
    const payloadHash = idempotencyKey
      ? crypto.createHash('sha256').update(`${action}:${canonicalizeJson(hashablePayload || {})}`).digest('hex')
      : '';

    if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
      const cachedEntry = idempotencyCache.get(idempotencyKey);
      if (cachedEntry.payloadHash && cachedEntry.payloadHash !== payloadHash) {
        return {
          ok: false,
          status: 409,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          error: '相同 Idempotency-Key 不得复用在不同请求参数上'
        };
      }
      return cachedEntry.response;
    }

    const idempotencyInFlight = dispatchCuaAction._inFlight || (dispatchCuaAction._inFlight = new Map());
    if (idempotencyKey && idempotencyInFlight.has(idempotencyKey)) {
      const pending = idempotencyInFlight.get(idempotencyKey);
      if (pending.payloadHash !== payloadHash) {
        return {
          ok: false,
          status: 409,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          error: '相同 Idempotency-Key 并发请求参数不一致'
        };
      }
      return pending.promise;
    }

    if (nonce) {
      if (seenNonces.has(nonce)) {
        return { ok: false, code: 'NONCE_REPLAYED', error: 'Duplicate request nonce rejected' };
      }
      seenNonces.set(nonce, now + 5 * 60 * 1000);
    }

    const executeActionOnce = async () => {
      let result;
      switch (action) {
        case 'status':
          result = await handleStatus(payload);
          break;
        case 'request_consent':
          result = await handleRequestConsent(payload);
          break;
        case 'revoke':
          result = await handleRevoke();
          break;
        case 'pause_handoff':
          result = await handlePauseHandoff(payload);
          break;
        case 'resume_handoff':
          result = await handleResumeHandoff();
          break;
        case 'list_windows':
          result = await handleListWindows();
          break;
        case 'desktop_observe':
          result = await handleDesktopObserve(payload);
          break;
        case 'desktop_act':
          result = await handleDesktopAct(payload);
          break;
        case 'browser_observe':
          result = await handleBrowserObserve(payload);
          break;
        case 'browser_act':
          result = await handleBrowserAct(payload);
          break;
        case 'register_nm_host':
          result = await handleRegisterNmHost();
          break;
        case 'set_mouse_mode':
          result = await handleSetMouseMode(payload);
          break;
        default:
          result = { ok: false, code: 'UNKNOWN_ACTION', error: `Unsupported CUA action: ${action}` };
          break;
      }

      const nonCacheableCodes = new Set([
        'CONSENT_REQUIRED',
        'CONSENT_DENIED',
        'UNAUTHORIZED',
        'INVALID_ACTION',
        'UNKNOWN_ACTION',
        'MISSING_ACTION',
        'READONLY_CONSENT',
        'HANDOFF_PAUSED'
      ]);
      if (
        idempotencyKey &&
        action !== 'status' &&
        action !== 'list_windows' &&
        !nonCacheableCodes.has(String(result?.code || '')) &&
        !(action === 'request_consent' && result?.granted === false)
      ) {
        idempotencyCache.set(idempotencyKey, {
          expiresAt: Date.now() + 60 * 1000,
          action,
          payloadHash,
          response: result
        });
      }
      return result;
    };

    if (!idempotencyKey) {
      return executeActionOnce();
    }
    const inFlightPromise = executeActionOnce().finally(() => {
      if (idempotencyInFlight.get(idempotencyKey)?.promise === inFlightPromise) {
        idempotencyInFlight.delete(idempotencyKey);
      }
    });
    idempotencyInFlight.set(idempotencyKey, { payloadHash, promise: inFlightPromise });
    return inFlightPromise;
  }

  async function handleNmPush(body, relaySessionHeader = '') {
    const msgType = String(body?.type || body?.action || '').trim().toLowerCase();
    const sessionId = String(body?.sessionId || relaySessionHeader || '').trim();

    if (msgType === 'nm_disconnect' || msgType === 'disconnect') {
      if (!sessionId || !activeRelaySessionId || sessionId === activeRelaySessionId) {
        lastNmSeenAt = 0;
        activeRelaySessionId = '';
        armedTabs = [];
        abortInFlightActions('EXTENSION_DISCONNECTED', '浏览器 Native Messaging 桥已断开连接');
      }
      return { ok: true, disconnected: true };
    }

    lastNmSeenAt = Date.now();
    if (sessionId) activeRelaySessionId = sessionId;

    if (Array.isArray(body?.armedTabs)) {
      armedTabs = body.armedTabs.map(normalizeArmedTab).filter(Boolean);
    } else if (msgType === 'tab_armed' || msgType === 'arm_tab') {
      const added = normalizeArmedTab(body?.tab ?? body);
      if (added) {
        armedTabs = [...armedTabs.filter((t) => t.tabId !== added.tabId), added];
      }
    } else if (msgType === 'tab_disarmed' || msgType === 'disarm_tab') {
      const removedId = Number(body?.tabId ?? body?.tab?.tabId ?? body?.id);
      if (Number.isFinite(removedId)) {
        armedTabs = armedTabs.filter((t) => t.tabId !== removedId);
      }
    }

    const reqId = String(body?.requestId || body?.id || body?.replyTo || '').trim();
    if (reqId && pendingBrowserRequests.has(reqId)) {
      const pending = pendingBrowserRequests.get(reqId);
      clearTimeout(pending.timer);
      pendingBrowserRequests.delete(reqId);
      const unwrapped = body?.result && typeof body.result === 'object' ? body.result : body;
      pending.resolve(unwrapped);
      return { ok: true, matchedRequestId: reqId };
    }

    if (msgType === 'revoke' || msgType === 'emergency_stop') {
      await handleRevoke();
      return { ok: true, state: CUA_STATES.DISARMED };
    }

    if (msgType === 'pause_handoff' || msgType === 'handoff') {
      const paused = await handlePauseHandoff({ reason: body?.reason });
      return { ok: true, state: paused.state };
    }

    if (msgType === 'get_status' || msgType === 'status') {
      const snap = getStatusSnapshot();
      return {
        ok: true,
        reply: {
          id: reqId || undefined,
          requestId: reqId || undefined,
          type: 'status_reply',
          ...snap
        }
      };
    }

    return { ok: true, armedCount: armedTabs.length };
  }

  function handleNmPoll(req, res, sessionId) {
    lastNmSeenAt = Date.now();
    if (sessionId) activeRelaySessionId = sessionId;

    if (nmCommandQueue.length > 0 || stopped) {
      const commands = nmCommandQueue.splice(0, nmCommandQueue.length);
      sendJsonResponse(res, 200, { ok: true, commands });
      return;
    }

    let settled = false;
    const waiter = (commands) => {
      if (settled) return;
      settled = true;
      clearTimeout(holdTimer);
      nmPollWaiters.delete(waiter);
      sendJsonResponse(res, 200, { ok: true, commands: Array.isArray(commands) ? commands : [] });
    };

    const holdTimer = setTimeout(() => {
      waiter([]);
    }, nmPollHoldMs);
    holdTimer.unref?.();

    nmPollWaiters.add(waiter);
    req.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(holdTimer);
      nmPollWaiters.delete(waiter);
    });
  }

  async function handleHttpRequest(req, res, serverExpectedHost) {
    try {
      const hostHeader = String(req.headers.host || '').trim().toLowerCase();
      if (!hostHeader || (hostHeader !== serverExpectedHost && !allowedHosts.has(hostHeader))) {
        sendJsonResponse(res, 403, {
          ok: false,
          code: 'INVALID_HOST_HEADER',
          error: 'Rejected due to Host header mismatch'
        });
        return;
      }

      const originHeader = String(req.headers.origin || '').trim();
      if (originHeader && !originHeader.startsWith(`chrome-extension://${CUA_EXTENSION_ID}`)) {
        sendJsonResponse(res, 403, {
          ok: false,
          code: 'FORBIDDEN_ORIGIN',
          error: 'Cross-origin browser requests are forbidden'
        });
        return;
      }

      if (!constantTimeBearerMatch(req.headers.authorization, tokenBuf)) {
        sendJsonResponse(res, 401, {
          ok: false,
          code: 'UNAUTHORIZED',
          error: 'Invalid or missing Bearer token'
        });
        return;
      }

      if (req.method !== 'POST') {
        sendJsonResponse(res, 405, {
          ok: false,
          code: 'METHOD_NOT_ALLOWED',
          error: 'Only POST is supported'
        });
        return;
      }

      const pathname = String(req.url || '').split('?')[0];
      if (pathname !== '/v1/cua' && pathname !== '/v1/nm-push' && pathname !== '/v1/nm-poll') {
        sendJsonResponse(res, 404, {
          ok: false,
          code: 'NOT_FOUND',
          error: `Unknown endpoint: ${pathname}`
        });
        return;
      }

      const body = await readJsonRequestBody(req, MAX_CUA_BODY_BYTES);
      if (pathname === '/v1/cua') {
        const result = await dispatchCuaAction(body, req.headers);
        const statusCode = result?.code === 'IDEMPOTENCY_KEY_CONFLICT' ? 409 : 200;
        sendJsonResponse(res, statusCode, result);
        return;
      }

      const relaySession = String(req.headers['x-prism-relay-session'] || body?.sessionId || '').trim();
      if (pathname === '/v1/nm-push') {
        const result = await handleNmPush(body, relaySession);
        sendJsonResponse(res, 200, result);
        return;
      }

      handleNmPoll(req, res, relaySession);
    } catch (err) {
      if (err?.code === 'REQUEST_ABORTED') {
        return;
      }
      if (err?.code === 'PAYLOAD_TOO_LARGE') {
        sendJsonResponse(res, 413, { ok: false, code: 'PAYLOAD_TOO_LARGE', error: err.message });
        return;
      }
      if (err?.code === 'INVALID_JSON' || err?.code === 'INVALID_JSON_OBJECT') {
        sendJsonResponse(res, 400, { ok: false, code: err.code, error: err.message });
        return;
      }
      sendJsonResponse(res, 500, {
        ok: false,
        code: 'BROKER_INTERNAL_ERROR',
        error: String(err?.message || err)
      });
    }
  }

  function bindSingleHttpServer(bindIp) {
    return new Promise((resolve, reject) => {
      if (!bindIp || bindIp === '0.0.0.0' || bindIp === '::') {
        reject(new Error(`Refusing insecure wildcard bind address: ${bindIp}`));
        return;
      }
      let expectedHost = '';
      const srv = http.createServer((req, res) => {
        void handleHttpRequest(req, res, expectedHost);
      });
      srv.once('error', reject);
      srv.listen(0, bindIp, () => {
        srv.removeListener('error', reject);
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        expectedHost = `${bindIp}:${port}`.toLowerCase();
        allowedHosts.add(expectedHost);
        servers.push(srv);
        resolve({ server: srv, ip: bindIp, port, endpoint: `http://${bindIp}:${port}` });
      });
    });
  }

  function syncBrokerDiscoveryFiles() {
    if (!started || stopped || boundEndpoints.length === 0) return;
    const { winBrokerFile, wslBrokerFiles } = resolveBrokerDiscoveryPaths({
      homeDir,
      prismSuiteDir,
      discoverWslGeminiDirs
    });

    const discoveryPayload = {
      schema: 1,
      version: CUA_VERSION,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
      token,
      endpoints: [...boundEndpoints],
      extensionId: CUA_EXTENSION_ID,
      platform: 'win32'
    };

    try {
      writePrivateJsonAtomic(winBrokerFile, discoveryPayload);
      writtenBrokerFiles.add(winBrokerFile);
    } catch {}

    for (const wslFile of wslBrokerFiles) {
      try {
        writePrivateJsonAtomic(wslFile, discoveryPayload);
        writtenBrokerFiles.add(wslFile);
      } catch {}
    }
  }

  async function start() {
    if (!isSupportedPlatform) return null;
    if (started) {
      return {
        token,
        endpoints: [...boundEndpoints],
        extensionId: CUA_EXTENSION_ID
      };
    }

    const loopbackBound = await bindSingleHttpServer('127.0.0.1');
    boundEndpoints.push(loopbackBound.endpoint);

    const detectedWslIp = wslAdapterIp !== undefined
      ? wslAdapterIp
      : discoverWslAdapterIpv4(networkInterfacesFn());

    if (detectedWslIp && detectedWslIp !== '127.0.0.1' && detectedWslIp !== '0.0.0.0') {
      try {
        const wslBound = await bindSingleHttpServer(detectedWslIp);
        boundEndpoints.push(wslBound.endpoint);
      } catch {}
    }

    started = true;
    stopped = false;
    syncBrokerDiscoveryFiles();
    if (discoverWslGeminiDirs === fallbackDiscoverWslGeminiDirs && process.platform === 'win32') {
      void refreshWslGeminiDirsAsync({ force: true }).then(() => {
        if (started && !stopped) syncBrokerDiscoveryFiles();
      });
    }

    expiryTimer = setInterval(() => {
      checkAndExpireConsent();
    }, 1000);
    expiryTimer.unref?.();

    wslSyncTimer = setInterval(() => {
      if (discoverWslGeminiDirs === fallbackDiscoverWslGeminiDirs && process.platform === 'win32') {
        void refreshWslGeminiDirsAsync().then(() => {
          syncBrokerDiscoveryFiles();
        });
      } else {
        syncBrokerDiscoveryFiles();
      }
    }, 30000);
    wslSyncTimer.unref?.();

    return {
      token,
      endpoints: [...boundEndpoints],
      extensionId: CUA_EXTENSION_ID
    };
  }

  function stopSync() {
    stopped = true;
    if (expiryTimer) {
      clearInterval(expiryTimer);
      expiryTimer = null;
    }
    if (wslSyncTimer) {
      clearInterval(wslSyncTimer);
      wslSyncTimer = null;
    }
    abortInFlightActions('BROKER_STOPPING', 'CUA Broker 正在关闭');
    stopOverlayProcess();
    for (const waiter of nmPollWaiters) {
      try {
        waiter([]);
      } catch {}
    }
    nmPollWaiters.clear();
    for (const file of writtenBrokerFiles) {
      removeBrokerFileIfOwned(file, process.pid);
    }
    writtenBrokerFiles.clear();
  }

  async function stop() {
    if (!started && servers.length === 0) return;
    stopSync();
    const closers = servers.splice(0, servers.length).map(
      (srv) =>
        new Promise((resolve) => {
          try {
            srv.closeIdleConnections?.();
            srv.closeAllConnections?.();
            srv.close(() => resolve());
          } catch {
            resolve();
          }
        })
    );
    await Promise.allSettled(closers);
    boundEndpoints.length = 0;
    allowedHosts.clear();
    started = false;
  }

  return {
    start,
    stop,
    stopSync,
    get token() {
      return token;
    },
    get endpoints() {
      return [...boundEndpoints];
    },
    get state() {
      checkAndExpireConsent();
      return state;
    },
    get mockOverlayHistory() {
      return [...mockOverlayHistory];
    },
    getStatusSnapshot,
    syncBrokerDiscoveryFiles,
    simulateOverlayEvent(actionName) {
      handleOverlayStdoutLine(actionName);
    }
  };
}

let singletonBroker = null;

export async function startCuaBroker(options = {}) {
  if (process.platform !== 'win32' && !options.allowNonWin32ForTest) {
    return null;
  }
  if (singletonBroker) {
    return singletonBroker;
  }
  const broker = createCuaBroker(options);
  await broker.start();
  singletonBroker = broker;
  return broker;
}

export async function stopCuaBroker() {
  const broker = singletonBroker;
  singletonBroker = null;
  if (!broker) return;
  await broker.stop();
}

export function stopCuaBrokerSync() {
  const broker = singletonBroker;
  singletonBroker = null;
  if (!broker) return;
  broker.stopSync();
}
