#!/usr/bin/env node
/**
 * Prism Files MCP App Server (Clean-Room Original, MIT, Zero External Dependencies)
 * Part of Anti-Claude Prism Suite v0.9.1
 *
 * Implements MCP stdio JSON-RPC 2.0 + SEP-1865 MCP Apps UI resources:
 *   - Model-visible tools (strictly 8):
 *       1. show_files_inline      -> inline interactive file card in conversation
 *       2. open_prism_files       -> Aux Pane + Global Sidebar 7-in-1 responsive workbench
 *       3. prism_memory_store     -> dual-mode SQLite FTS5 sanitized slot handoff memory
 *       4. prism_memory_list      -> chronological (newest-first) handoff memory & catalog:master reader
 *       5. prism_memory_search    -> bilingual FTS5 + literal handoff memory search
 *       6. prism_quota_sync       -> email-verified 5h/7d & per-family quota snapshot sync
 *       7. prism_list_models      -> T1-T4 cross-vendor Model Hub catalog (zero secret exposure)
 *       8. prism_ask_model        -> zero-dep SSE streaming cross-vendor consultation & review
 *   - App-only tools (visibility: ["app"], hidden from model):
 *       - list_directory / read_file_preview / save_file_content / list_recent_artifacts
 *       - reveal_in_explorer / get_state / update_state / list_open_targets / open_with_target / search_transcripts
 *       - model_hub_* (provider/model CRUD, /v1/models discovery, batch import, TTFT probe), accounts_*, handoff_*, check_upstreams
 *       - cua_bridge_status / cua_bridge_revoke / cua_bridge_register_nm / cua_bridge_open_ext_dir
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAccountManager } from './account-manager.mjs';
import { createAccountVault, resolveSafeExecCwd, resolveWslInteropEnv } from './account-vault.mjs';
import { createClientRelauncher } from './relaunch-client.mjs';
import { createHandoffMemoryStore } from './handoff-memory.mjs';
import { createPrismProfileManager } from './prism-profile.mjs';
import { createModelHub } from './model-hub.mjs';
import { checkUpstreams, renderMarkdownReport, syncUpstreamBaseline, checkPrismSelfUpdate, applyPrismSelfUpdate } from './upstream-radar.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

export const APP_URI = 'ui://prism-files/app.html';
export const INLINE_URI = 'ui://prism-files/inline.html';
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const CUA_EXTENSION_ID = 'lbmibnghmlnidfiihkegicaejaacmkca';
const SERVER_INFO = { name: 'prism-files', version: '0.9.1' };
const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_SAVE_BYTES = 512 * 1024;
const MAX_STDIN_BUFFER_BYTES = 16 * 1024 * 1024;

const TRANSCRIPT_MAX_SESSIONS = 80;
const TRANSCRIPT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const TRANSCRIPT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const TRANSCRIPT_BUDGET_MS = 1500;
const TRANSCRIPT_MAX_RESULTS = 50;
const TRANSCRIPT_CACHE_MAX_ENTRIES = 100;

const transcriptParseCache = new Map();

const activeExitCleanupCallbacks = new Set();
let exitCleanupHookRegistered = false;

function registerProcessExitCleanup(fn) {
  activeExitCleanupCallbacks.add(fn);
  if (!exitCleanupHookRegistered) {
    exitCleanupHookRegistered = true;
    process.once('exit', () => {
      for (const cb of activeExitCleanupCallbacks) {
        try { cb(); } catch {}
      }
      activeExitCleanupCallbacks.clear();
    });
  }
  return () => {
    activeExitCleanupCallbacks.delete(fn);
  };
}

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
};

const SENSITIVE_SEGMENTS = new Set(['.ssh', '.gnupg', '.aws', '.codex', '.claude', '.cc-switch']);
const SENSITIVE_BASENAME_RE = /^(?:\.env(?:\..+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|auth\.json|credentials\.json|cc-switch\.db|prism-profile\.json|cua-broker\.json|handoff-memory\.sqlite(?:-wal|-shm|-journal)?|handoff-catalog\.json|jetski-standalone-oauth-token|credential-user-scope|.*\.(?:pem|key|p12|pfx|kdbx))$/i;
const PRISM_PROTECTED_FILES = new Set([
  'accounts.json',
  'switch.lock',
  'handoff-memories.jsonl',
  'handoff-memory.sqlite',
  'handoff-memory.sqlite-wal',
  'handoff-memory.sqlite-shm',
  'handoff-memory.sqlite-journal',
  'handoff-catalog.json',
  'handoff-snapshot.json',
  'upstream-cache.json',
  'prism-profile.json',
  'cua-broker.json'
]);

export function isSensitivePath(targetPath) {
  const raw = String(targetPath || '');
  const trimmedStart = raw.trimStart();
  if (!trimmedStart.trim()) return false;
  // Block Windows NTFS Alternate Data Streams (any colon outside leading drive prefix ^[A-Za-z]:)
  const withoutDrivePrefix = trimmedStart.replace(/^[A-Za-z]:/, '');
  if (withoutDrivePrefix.includes(':')) return true;

  const isWinDrivePath = /^[A-Za-z]:/.test(trimmedStart);
  const norm = (isUncPathString(trimmedStart) || isWinDrivePath) ? trimmedStart : path.resolve(trimmedStart);
  const normWithoutDrive = norm.replace(/^[A-Za-z]:/, '');
  if (normWithoutDrive.includes(':')) return true;

  const parts = norm.split(/[\\/]+/).filter(Boolean);
  for (const seg of parts) {
    const cleanSeg = seg.replace(/:.*$/, '').replace(/[. ]+$/, '');
    if (SENSITIVE_SEGMENTS.has(cleanSeg.toLowerCase())) return true;
  }
  const rawBase = parts.length > 0 ? parts[parts.length - 1] : path.basename(norm);
  const cleanBase = rawBase.replace(/:.*$/, '').replace(/[. ]+$/, '');
  const parentSeg = parts.length >= 2 ? parts[parts.length - 2].replace(/:.*$/, '').replace(/[. ]+$/, '').toLowerCase() : '';
  if (parentSeg === 'prism-suite' && PRISM_PROTECTED_FILES.has(cleanBase.toLowerCase())) {
    return true;
  }
  return SENSITIVE_BASENAME_RE.test(cleanBase);
}

export function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

export function detectWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const ver = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(ver);
  } catch {
    return false;
  }
}

export function fallbackLinuxToWindowsPath(linuxPath, distroName = process.env.WSL_DISTRO_NAME || 'Ubuntu') {
  const norm = path.posix.resolve(String(linuxPath || '').replace(/\\/g, '/'));
  const mnt = norm.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mnt) {
    const drive = mnt[1].toUpperCase();
    const rest = (mnt[2] || '').replace(/\//g, '\\');
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }
  const winRest = norm.replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distroName}${winRest}`;
}

export async function toWindowsPathFromWsl(linuxPath) {
  const abs = path.resolve(linuxPath);
  try {
    const { stdout } = await execFileAsync('wslpath', ['-w', abs], { timeout: 4000 });
    const rawOut = String(stdout || '').replace(/\r?\n$/, '');
    if (rawOut && !/[\x00-\x1f\x7f]/.test(rawOut)) {
      return rawOut;
    }
  } catch {}
  return fallbackLinuxToWindowsPath(abs);
}

export async function toLinuxPathFromWslUnc(winUncPath) {
  const raw = String(winUncPath || '').trim();
  if (!raw || /[\x00-\x1f\x7f]/.test(raw)) return '';
  try {
    const { stdout } = await execFileAsync('wslpath', ['-u', raw], { timeout: 4000 });
    const rawOut = String(stdout || '').replace(/\r?\n$/, '');
    if (rawOut && rawOut.startsWith('/') && !/[\x00-\x1f\x7f]/.test(rawOut)) {
      return rawOut;
    }
  } catch {}
  return '';
}

export function realpathNearest(targetPath) {
  const abs = path.resolve(String(targetPath || ''));
  try {
    return fs.realpathSync(abs);
  } catch {}
  const missingSegments = [];
  let cur = abs;
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      try {
        const realRoot = fs.realpathSync(cur);
        return missingSegments.length ? path.join(realRoot, ...missingSegments.reverse()) : realRoot;
      } catch {
        return abs;
      }
    }
    missingSegments.push(path.basename(cur));
    cur = parent;
    try {
      const realAncestor = fs.realpathSync(cur);
      return path.join(realAncestor, ...missingSegments.reverse());
    } catch {}
  }
}

export function resolveHomeAndBrain() {
  const home = os.homedir();
  const rawBrainDir = process.env.PRISM_FILES_BRAIN_DIR
    ? path.resolve(process.env.PRISM_FILES_BRAIN_DIR)
    : path.join(home, '.gemini', 'antigravity', 'brain');
  const brainDir = realpathNearest(rawBrainDir);
  return { home, brainDir };
}

export function isPathInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const rel = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function hasSensitiveSegment(targetPath) {
  return isSensitivePath(targetPath);
}

export function expandUserPath(rawPath, fallbackDir) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return path.resolve(fallbackDir || process.cwd());
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace(/\.?0+$/, '')} GB`;
}

export function getFileKind(fileName, isDir) {
  if (isDir) return 'dir';
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (IMAGE_MIME_BY_EXT[ext]) return 'image';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx'].includes(ext)) return 'office';
  if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) return 'archive';
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.cs', '.go', '.rs', '.java', '.json', '.yaml', '.yml', '.toml', '.css', '.html', '.xml', '.sql', '.sh', '.ps1', '.cmd'].includes(ext)) {
    return 'code';
  }
  return 'file';
}

/* ---------------- Windows Explorer Args & Safe LAN SMB/UNC ---------------- */

function isUncPathString(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const trimmed = rawPath.trim();
  return trimmed.startsWith('\\\\') || trimmed.startsWith('//');
}

function isLocalWslUncHost(rawPath) {
  if (!isUncPathString(rawPath)) return false;
  const m = rawPath.trim().match(/^(?:\\\\|\/\/)([^\\/]+)/);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === 'wsl.localhost' || host === 'wsl$';
}

export function buildWindowsExplorerArgs(winPath, isDir) {
  const raw = String(winPath ?? '');
  if (!raw || /[\x00-\x1f\x7f"]/.test(raw)) {
    throw new Error('Windows 路径包含非法字符或控制字符');
  }
  const driveRootMatch = raw.match(/^([a-zA-Z]):[\\/]?$/);
  if (driveRootMatch) {
    return [`${driveRootMatch[1].toUpperCase()}:\\`];
  }
  const normalized = raw.replace(/\//g, '\\');
  // UNC server root or share root cannot be selected with /select,
  if (/^\\\\[^\\]+(?:\\[^\\]+)?\\?$/.test(normalized)) {
    return [normalized];
  }
  if (isDir) {
    return [normalized];
  }
  return [`/select,"${normalized}"`];
}

export function buildWslExplorerArgs(winPath, isDir) {
  const raw = String(winPath ?? '');
  if (!raw || /[\x00-\x1f\x7f"]/.test(raw)) {
    throw new Error('Windows 路径包含非法字符或控制字符');
  }
  const driveRootMatch = raw.match(/^([a-zA-Z]):[\\/]?$/);
  if (driveRootMatch) {
    return [`${driveRootMatch[1].toUpperCase()}:\\`];
  }
  const normalized = raw.replace(/\//g, '\\');
  if (/^\\\\[^\\]+(?:\\[^\\]+)?\\?$/.test(normalized)) {
    return [normalized];
  }
  if (isDir) {
    return [normalized];
  }
  // In WSL interop, passing two separate argv items avoids escaping inner quotes while auto-quoting spaces in winPath
  return ['/select,', normalized];
}

function expandIpv6ToGroups(ip) {
  let s = ip.toLowerCase();
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4Part = s.slice(lastColon + 1);
    if (!net.isIPv4(ipv4Part)) return null;
    const octets = ipv4Part.split('.').map((n) => Number(n));
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;
  const full = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (full.length !== 8) return null;
  const groups = [];
  for (const part of full) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

export function isPrivateOrLocalIp(ip) {
  if (typeof ip !== 'string') return false;
  let s = ip.trim().toLowerCase();
  const zoneIdx = s.indexOf('%');
  if (zoneIdx !== -1) s = s.slice(0, zoneIdx);
  if (!s) return false;

  if (net.isIPv4(s)) {
    const parts = s.split('.').map((n) => Number(n));
    const [a, b] = parts;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT / Tailscale
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    return false;
  }

  if (net.isIPv6(s)) {
    const g = expandIpv6ToGroups(s);
    if (!g) return false;
    // Loopback ::1
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) {
      return true;
    }
    // IPv4-mapped IPv6 ::ffff:0:0/96
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      const v4 = `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
      return isPrivateOrLocalIp(v4);
    }
    // ULA fc00::/7
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    // Link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    return false;
  }

  return false;
}

export async function validateLanUncPath(rawPath, { lookupFn } = {}) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, error: 'UNC 路径不能为空' };
  }
  if (/[\x00-\x1f\x7f]/.test(rawPath)) {
    return { ok: false, error: 'UNC 路径包含非法控制字符或 NUL 字节' };
  }
  const trimmed = rawPath.trim();
  if (/^(?:\\\\|\/\/)[?.](?:\\|\/|$)/.test(trimmed)) {
    return { ok: false, error: '已拒绝设备/扩展前缀路径 (\\\\?\\ 或 \\\\.\\)' };
  }
  const m = trimmed.match(/^(?:\\\\|\/\/)([^\\/]+)(?:[\\/](.*))?$/);
  if (!m) {
    return { ok: false, error: '不是有效的 UNC 网络路径' };
  }

  const host = m[1];
  const rest = m[2] ?? '';

  if (trimmed.includes('@')) {
    return { ok: false, error: 'UNC 路径禁止包含凭据或 WebDAV 符号 (@)' };
  }
  if (trimmed.includes(':')) {
    return { ok: false, error: 'UNC 路径禁止包含端口或冒号 (:)' };
  }
  if (!host || host === '.' || host === '..' || /\s/.test(host) || host.includes('"')) {
    return { ok: false, error: 'UNC 主机名格式无效' };
  }

  const segments = rest ? rest.split(/[\\/]+/) : [];
  if (segments.some((seg) => seg === '..')) {
    return { ok: false, error: 'UNC 路径禁止包含 .. 路径穿越段' };
  }

  const normalizedPath = `\\\\${host}${rest ? `\\${rest.replace(/\//g, '\\')}` : ''}`;
  const hostLower = host.toLowerCase();

  if (hostLower === 'wsl.localhost' || hostLower === 'wsl$' || hostLower === 'localhost') {
    return { ok: true, host, normalizedPath, ips: ['127.0.0.1'], localAlias: true };
  }

  if (net.isIP(hostLower)) {
    if (isPrivateOrLocalIp(hostLower)) {
      return { ok: true, host, normalizedPath, ips: [hostLower] };
    }
    return { ok: false, error: `已拒绝公网 IP UNC 路径 (${host})，以防止 NTLM 凭据泄露` };
  }

  if (!/^[a-z0-9](?:[a-z0-9._-]{0,251}[a-z0-9])?$/i.test(host)) {
    return { ok: false, error: `UNC 主机名包含不支持的字符：${host}` };
  }

  const resolver = typeof lookupFn === 'function'
    ? lookupFn
    : (h, opts) => dns.promises.lookup(h, opts);

  let records;
  try {
    records = await resolver(host, { all: true });
  } catch (err) {
    return { ok: false, error: `无法解析局域网主机 ${host}：${err?.message || 'DNS 查询失败'}` };
  }

  const list = Array.isArray(records) ? records : (records ? [records] : []);
  const ips = list
    .map((r) => (typeof r === 'string' ? r : r?.address))
    .filter((addr) => typeof addr === 'string' && addr.trim());

  if (ips.length === 0) {
    return { ok: false, error: `局域网主机 ${host} 未解析到任何 IP 地址` };
  }

  for (const addr of ips) {
    if (!isPrivateOrLocalIp(addr)) {
      return { ok: false, error: `主机 ${host} 解析到公网 IP (${addr})，已拒绝以防止 NTLM 凭据泄露` };
    }
  }

  return { ok: true, host, normalizedPath, ips };
}

/* ---------------- Dynamic Local Editor & Terminal Detector ---------------- */

function parsePositiveInt(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') {
    return Number.isSafeInteger(val) && val >= 1 && val <= 10000000 ? val : null;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!/^[1-9]\d{0,7}$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= 1 && n <= 10000000 ? n : null;
  }
  return null;
}

export function parseLineCol(rawLine, rawCol) {
  const line = parsePositiveInt(rawLine);
  const column = line !== null ? parsePositiveInt(rawCol) : null;
  return { line, column };
}

export function hasWindowsBatchMeta(str) {
  return /[&|<>^%!"\r\n\0]/.test(String(str ?? ''));
}

function isExecutableFile(filePath, isWin = process.platform === 'win32') {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    if (!isWin) {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function findInEnvPath(names, isWin = process.platform === 'win32') {
  const pathEnv = process.env.PATH || process.env.Path || '';
  if (!pathEnv) return '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate, isWin)) {
        return candidate;
      }
    }
  }
  return '';
}

function findFirstExistingFile(paths, isWin = process.platform === 'win32') {
  for (const p of paths) {
    if (p && isExecutableFile(p, isWin)) return p;
  }
  return '';
}

function getWslWindowsUserDirs() {
  const dirs = [];
  const seen = new Set();
  const add = (p) => {
    if (p && !seen.has(p) && fs.existsSync(p)) {
      seen.add(p);
      dirs.push(p);
    }
  };
  // Infer active Windows user from PATH entries like /mnt/c/Users/<Name>/AppData/...
  const pathEnv = process.env.PATH || '';
  for (const seg of pathEnv.split(':')) {
    const m = seg.match(/^(\/mnt\/c\/Users\/[^/]+)(?:\/|$)/i);
    if (m) add(m[1]);
  }
  try {
    if (fs.existsSync('/mnt/c/Users')) {
      for (const ent of fs.readdirSync('/mnt/c/Users', { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        if (['Public', 'Default', 'Default User', 'All Users'].includes(ent.name)) continue;
        add(path.join('/mnt/c/Users', ent.name));
      }
    }
  } catch {}
  return dirs;
}

function detectInstalledOpenTargets(isWsl) {
  const targets = [];
  const seenIds = new Set();

  const register = (target) => {
    if (!target || !target.id || seenIds.has(target.id)) return;
    seenIds.add(target.id);
    targets.push(target);
  };

  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const winEditors = [
      {
        id: 'vscode',
        name: 'VS Code',
        protocol: 'vscode',
        supportsLineCol: true,
        fixed: [
          localApp && path.join(localApp, 'Programs', 'Microsoft VS Code', 'Code.exe'),
          path.join(progFiles, 'Microsoft VS Code', 'Code.exe')
        ],
        pathBins: ['Code.exe', 'code.exe', 'code.cmd']
      },
      {
        id: 'cursor',
        name: 'Cursor',
        protocol: 'vscode',
        supportsLineCol: true,
        fixed: [
          localApp && path.join(localApp, 'Programs', 'cursor', 'Cursor.exe'),
          path.join(progFiles, 'cursor', 'Cursor.exe')
        ],
        pathBins: ['Cursor.exe', 'cursor.exe', 'cursor.cmd']
      },
      {
        id: 'windsurf',
        name: 'Windsurf',
        protocol: 'vscode',
        supportsLineCol: true,
        fixed: [
          localApp && path.join(localApp, 'Programs', 'Windsurf', 'Windsurf.exe'),
          path.join(progFiles, 'Windsurf', 'Windsurf.exe')
        ],
        pathBins: ['Windsurf.exe', 'windsurf.exe', 'windsurf.cmd']
      },
      {
        id: 'agy',
        name: 'Antigravity',
        protocol: 'vscode',
        supportsLineCol: true,
        fixed: [
          localApp && path.join(localApp, 'Programs', 'Antigravity', 'Antigravity.exe'),
          path.join(progFiles, 'Antigravity', 'Antigravity.exe')
        ],
        pathBins: ['Antigravity.exe', 'agy.exe', 'agy.cmd']
      },
      {
        id: 'zed',
        name: 'Zed',
        protocol: 'zed',
        supportsLineCol: true,
        fixed: [
          localApp && path.join(localApp, 'Programs', 'Zed', 'Zed.exe')
        ],
        pathBins: ['Zed.exe', 'zed.exe', 'zed.cmd']
      },
      {
        id: 'idea',
        name: 'IntelliJ IDEA',
        protocol: 'jetbrains',
        supportsLineCol: true,
        fixed: [localApp && path.join(localApp, 'JetBrains', 'Toolbox', 'scripts', 'idea.cmd')],
        pathBins: ['idea64.exe', 'idea.exe', 'idea.cmd']
      },
      {
        id: 'webstorm',
        name: 'WebStorm',
        protocol: 'jetbrains',
        supportsLineCol: true,
        fixed: [localApp && path.join(localApp, 'JetBrains', 'Toolbox', 'scripts', 'webstorm.cmd')],
        pathBins: ['webstorm64.exe', 'webstorm.exe', 'webstorm.cmd']
      },
      {
        id: 'pycharm',
        name: 'PyCharm',
        protocol: 'jetbrains',
        supportsLineCol: true,
        fixed: [localApp && path.join(localApp, 'JetBrains', 'Toolbox', 'scripts', 'pycharm.cmd')],
        pathBins: ['pycharm64.exe', 'pycharm.exe', 'pycharm.cmd']
      },
      {
        id: 'goland',
        name: 'GoLand',
        protocol: 'jetbrains',
        supportsLineCol: true,
        fixed: [localApp && path.join(localApp, 'JetBrains', 'Toolbox', 'scripts', 'goland.cmd')],
        pathBins: ['goland64.exe', 'goland.exe', 'goland.cmd']
      },
      {
        id: 'rider',
        name: 'Rider',
        protocol: 'jetbrains',
        supportsLineCol: true,
        fixed: [localApp && path.join(localApp, 'JetBrains', 'Toolbox', 'scripts', 'rider.cmd')],
        pathBins: ['rider64.exe', 'rider.exe', 'rider.cmd']
      }
    ];

    for (const ed of winEditors) {
      const bin = findFirstExistingFile(ed.fixed, true) || findInEnvPath(ed.pathBins, true);
      if (bin) {
        register({
          id: ed.id,
          name: ed.name,
          kind: 'editor',
          supportsLineCol: ed.supportsLineCol,
          execBin: bin,
          protocol: ed.protocol,
          isBatch: /\.(?:cmd|bat)$/i.test(bin),
          isWindowsExe: true
        });
      }
    }

    const wtBin =
      findFirstExistingFile([localApp && path.join(localApp, 'Microsoft', 'WindowsApps', 'wt.exe')], true) ||
      findInEnvPath(['wt.exe'], true);
    if (wtBin) {
      register({
        id: 'wt',
        name: 'Windows Terminal',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: wtBin,
        protocol: 'wt',
        isBatch: false,
        isWindowsExe: true
      });
    }

    const gitBashBin = findFirstExistingFile([
      path.join(progFiles, 'Git', 'git-bash.exe'),
      path.join(progFiles86, 'Git', 'git-bash.exe'),
      'D:\\Program Files\\Git\\git-bash.exe'
    ], true) || findInEnvPath(['git-bash.exe'], true);
    if (gitBashBin) {
      register({
        id: 'git-bash',
        name: 'Git Bash',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: gitBashBin,
        protocol: 'git-bash',
        isBatch: false,
        isWindowsExe: true
      });
    }

    return targets;
  }

  if (process.platform === 'darwin') {
    const macEditors = [
      { id: 'vscode', name: 'VS Code', protocol: 'vscode', supportsLineCol: true, cli: ['code'], app: '/Applications/Visual Studio Code.app', appName: 'Visual Studio Code' },
      { id: 'cursor', name: 'Cursor', protocol: 'vscode', supportsLineCol: true, cli: ['cursor'], app: '/Applications/Cursor.app', appName: 'Cursor' },
      { id: 'windsurf', name: 'Windsurf', protocol: 'vscode', supportsLineCol: true, cli: ['windsurf'], app: '/Applications/Windsurf.app', appName: 'Windsurf' },
      { id: 'agy', name: 'Antigravity', protocol: 'vscode', supportsLineCol: true, cli: ['agy'], app: '/Applications/Antigravity.app', appName: 'Antigravity' },
      { id: 'zed', name: 'Zed', protocol: 'zed', supportsLineCol: true, cli: ['zed'], app: '/Applications/Zed.app', appName: 'Zed' },
      { id: 'idea', name: 'IntelliJ IDEA', protocol: 'jetbrains', supportsLineCol: true, cli: ['idea'], app: '/Applications/IntelliJ IDEA.app', appName: 'IntelliJ IDEA' },
      { id: 'webstorm', name: 'WebStorm', protocol: 'jetbrains', supportsLineCol: true, cli: ['webstorm'], app: '/Applications/WebStorm.app', appName: 'WebStorm' },
      { id: 'pycharm', name: 'PyCharm', protocol: 'jetbrains', supportsLineCol: true, cli: ['pycharm'], app: '/Applications/PyCharm.app', appName: 'PyCharm' },
      { id: 'goland', name: 'GoLand', protocol: 'jetbrains', supportsLineCol: true, cli: ['goland'], app: '/Applications/GoLand.app', appName: 'GoLand' },
      { id: 'rider', name: 'Rider', protocol: 'jetbrains', supportsLineCol: true, cli: ['rider'], app: '/Applications/Rider.app', appName: 'Rider' }
    ];

    for (const ed of macEditors) {
      const cliBin = findInEnvPath(ed.cli, false);
      if (cliBin) {
        register({
          id: ed.id,
          name: ed.name,
          kind: 'editor',
          supportsLineCol: ed.supportsLineCol,
          execBin: cliBin,
          protocol: ed.protocol,
          isBatch: false,
          isWindowsExe: false
        });
      } else if (fs.existsSync(ed.app)) {
        register({
          id: ed.id,
          name: ed.name,
          kind: 'editor',
          supportsLineCol: false,
          execBin: 'open',
          appName: ed.appName,
          protocol: 'macos-open-app',
          isBatch: false,
          isWindowsExe: false
        });
      }
    }

    if (fs.existsSync('/Applications/iTerm.app')) {
      register({
        id: 'iterm2',
        name: 'iTerm2',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: 'open',
        appName: 'iTerm',
        protocol: 'macos-open-app',
        isBatch: false,
        isWindowsExe: false
      });
    }
    if (fs.existsSync('/System/Applications/Utilities/Terminal.app') || fs.existsSync('/Applications/Utilities/Terminal.app')) {
      register({
        id: 'macos-terminal',
        name: 'macOS 终端',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: 'open',
        appName: 'Terminal',
        protocol: 'macos-open-app',
        isBatch: false,
        isWindowsExe: false
      });
    }

    return targets;
  }

  // Linux / WSL
  const wslUsers = isWsl ? getWslWindowsUserDirs() : [];
  const linuxEditors = [
    {
      id: 'vscode',
      name: 'VS Code',
      protocol: 'vscode',
      supportsLineCol: true,
      cli: ['code'],
      wslFixed: [
        ...wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe')),
        '/mnt/c/Program Files/Microsoft VS Code/Code.exe'
      ]
    },
    {
      id: 'cursor',
      name: 'Cursor',
      protocol: 'vscode',
      supportsLineCol: true,
      cli: ['cursor'],
      wslFixed: [
        ...wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe')),
        '/mnt/c/Program Files/cursor/Cursor.exe'
      ]
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      protocol: 'vscode',
      supportsLineCol: true,
      cli: ['windsurf'],
      wslFixed: [
        ...wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Programs', 'Windsurf', 'Windsurf.exe')),
        '/mnt/c/Program Files/Windsurf/Windsurf.exe'
      ]
    },
    {
      id: 'agy',
      name: 'Antigravity',
      protocol: 'vscode',
      supportsLineCol: true,
      cli: ['agy'],
      wslFixed: [
        ...wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Programs', 'Antigravity', 'Antigravity.exe')),
        '/mnt/c/Program Files/Antigravity/Antigravity.exe'
      ]
    },
    {
      id: 'zed',
      name: 'Zed',
      protocol: 'zed',
      supportsLineCol: true,
      cli: ['zed', 'zeditor'],
      wslFixed: [
        ...wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Programs', 'Zed', 'Zed.exe'))
      ]
    },
    { id: 'idea', name: 'IntelliJ IDEA', protocol: 'jetbrains', supportsLineCol: true, cli: ['idea'], wslFixed: [] },
    { id: 'webstorm', name: 'WebStorm', protocol: 'jetbrains', supportsLineCol: true, cli: ['webstorm'], wslFixed: [] },
    { id: 'pycharm', name: 'PyCharm', protocol: 'jetbrains', supportsLineCol: true, cli: ['pycharm'], wslFixed: [] },
    { id: 'goland', name: 'GoLand', protocol: 'jetbrains', supportsLineCol: true, cli: ['goland'], wslFixed: [] },
    { id: 'rider', name: 'Rider', protocol: 'jetbrains', supportsLineCol: true, cli: ['rider'], wslFixed: [] }
  ];

  for (const ed of linuxEditors) {
    // In WSL, prefer native Windows .exe fixed installs BEFORE .cmd/.bat wrappers in PATH
    const cliBin = findInEnvPath(ed.cli, false);
    const cliIsBatch = Boolean(cliBin && /\.(?:cmd|bat)$/i.test(cliBin));
    if (cliBin && !(isWsl && cliIsBatch)) {
      const isWinExe = /\.exe$/i.test(cliBin);
      register({
        id: ed.id,
        name: ed.name,
        kind: 'editor',
        supportsLineCol: ed.supportsLineCol,
        execBin: cliBin,
        protocol: ed.protocol,
        isBatch: cliIsBatch,
        isWindowsExe: isWinExe
      });
      continue;
    }
    if (isWsl && ed.wslFixed.length > 0) {
      const wslBin = findFirstExistingFile(ed.wslFixed, true);
      if (wslBin) {
        register({
          id: ed.id,
          name: ed.name,
          kind: 'editor',
          supportsLineCol: ed.supportsLineCol,
          execBin: wslBin,
          protocol: ed.protocol,
          isBatch: /\.(?:cmd|bat)$/i.test(wslBin),
          isWindowsExe: true
        });
        continue;
      }
    }
    const fallbackBatchBin = cliBin || (isWsl ? findInEnvPath(ed.cli.map((c) => `${c}.cmd`), true) : '');
    if (fallbackBatchBin) {
      const isBatch = /\.(?:cmd|bat)$/i.test(fallbackBatchBin);
      register({
        id: ed.id,
        name: ed.name,
        kind: 'editor',
        supportsLineCol: ed.supportsLineCol,
        execBin: fallbackBatchBin,
        protocol: ed.protocol,
        isBatch,
        isWindowsExe: isBatch || /\.exe$/i.test(fallbackBatchBin)
      });
    }
  }

  if (isWsl) {
    const wtBin =
      findInEnvPath(['wt.exe'], true) ||
      findFirstExistingFile(wslUsers.map((u) => path.join(u, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe')), true);
    if (wtBin) {
      register({
        id: 'wt',
        name: 'Windows Terminal',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: wtBin,
        protocol: 'wt',
        isBatch: false,
        isWindowsExe: true
      });
    }

    const gitBashBin = findFirstExistingFile([
      '/mnt/c/Program Files/Git/git-bash.exe',
      '/mnt/c/Program Files (x86)/Git/git-bash.exe',
      '/mnt/d/Program Files/Git/git-bash.exe'
    ], true) || findInEnvPath(['git-bash.exe'], true);
    if (gitBashBin) {
      register({
        id: 'git-bash',
        name: 'Git Bash',
        kind: 'terminal',
        supportsLineCol: false,
        execBin: gitBashBin,
        protocol: 'git-bash',
        isBatch: false,
        isWindowsExe: true
      });
    }
  } else {
    const linuxTerminals = [
      { id: 'gnome-terminal', name: 'GNOME Terminal', bin: 'gnome-terminal', protocol: 'gnome-terminal' },
      { id: 'konsole', name: 'Konsole', bin: 'konsole', protocol: 'konsole' },
      { id: 'kitty', name: 'Kitty', bin: 'kitty', protocol: 'kitty' },
      { id: 'alacritty', name: 'Alacritty', bin: 'alacritty', protocol: 'alacritty' },
      { id: 'wezterm', name: 'WezTerm', bin: 'wezterm', protocol: 'wezterm' },
      { id: 'xfce4-terminal', name: 'XFCE Terminal', bin: 'xfce4-terminal', protocol: 'xfce4-terminal' },
      { id: 'x-terminal-emulator', name: '系统终端', bin: 'x-terminal-emulator', protocol: 'cwd-terminal' },
      { id: 'xterm', name: 'XTerm', bin: 'xterm', protocol: 'cwd-terminal' }
    ];
    for (const term of linuxTerminals) {
      const bin = findInEnvPath([term.bin], false);
      if (bin) {
        register({
          id: term.id,
          name: term.name,
          kind: 'terminal',
          supportsLineCol: false,
          execBin: bin,
          protocol: term.protocol,
          isBatch: false,
          isWindowsExe: false
        });
      }
    }
  }

  return targets;
}

function buildTargetSpawnSpec(target, targetPath, targetDir, isDir, line, column) {
  let args = [];
  let cwd;
  const bin = target.execBin;

  if (target.protocol === 'vscode') {
    if (!isDir && line) {
      const loc = column ? `${targetPath}:${line}:${column}` : `${targetPath}:${line}`;
      args = ['--goto', loc];
    } else {
      args = [targetPath];
    }
  } else if (target.protocol === 'zed') {
    if (!isDir && line) {
      const loc = column ? `${targetPath}:${line}:${column}` : `${targetPath}:${line}`;
      args = [loc];
    } else {
      args = [targetPath];
    }
  } else if (target.protocol === 'jetbrains') {
    if (!isDir && line) {
      args = ['--line', String(line)];
      if (column) args.push('--column', String(column));
      args.push(targetPath);
    } else {
      args = [targetPath];
    }
  } else if (target.protocol === 'wt') {
    args = ['-d', targetDir];
  } else if (target.protocol === 'git-bash') {
    args = [`--cd=${targetDir}`];
  } else if (target.protocol === 'macos-open-app') {
    args = ['-a', target.appName, target.kind === 'terminal' ? targetDir : targetPath];
  } else if (target.protocol === 'gnome-terminal' || target.protocol === 'xfce4-terminal') {
    args = [`--working-directory=${targetDir}`];
  } else if (target.protocol === 'konsole') {
    args = ['--workdir', targetDir];
  } else if (target.protocol === 'kitty') {
    args = ['--directory', targetDir];
  } else if (target.protocol === 'alacritty') {
    args = ['--working-directory', targetDir];
  } else if (target.protocol === 'wezterm') {
    args = ['start', '--cwd', targetDir];
  } else if (target.protocol === 'cwd-terminal') {
    args = [];
    cwd = targetDir;
  } else {
    args = [target.kind === 'terminal' ? targetDir : targetPath];
  }

  return { bin, args, cwd };
}

function spawnDetachedSafe(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    let child;
    try {
      child = spawn(bin, args, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        ...options
      });
    } catch (err) {
      finish(err);
      return;
    }
    const timer = setTimeout(() => {
      try { child.unref(); } catch {}
      finish(null);
    }, 350);
    child.once('error', (err) => {
      clearTimeout(timer);
      finish(err);
    });
    child.once('spawn', () => {
      clearTimeout(timer);
      try { child.unref(); } catch {}
      finish(null);
    });
  });
}

/* ---------------- Cross-Session Transcript Search & Redaction ---------------- */

export function redactSensitiveText(text) {
  let out = String(text ?? '');
  if (!out) return '';
  // PEM private keys (complete or truncated)
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  // sk-... API keys (OpenAI / Anthropic / Stripe etc.)
  out = out.replace(/\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
  // GitHub tokens
  out = out.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GH_TOKEN]');
  // Google API keys
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');
  // Bearer tokens
  out = out.replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED_TOKEN]');
  // password / token / secret / api_key key=value assignments
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:password|passwd|token|secret|api[_-]?key)[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;'"`]+)/gi,
    '$1[REDACTED]'
  );
  return out;
}

function safeLstatJoinInRoot(rootDir, ...segments) {
  const absRoot = path.resolve(rootDir);
  let cur = absRoot;
  let lastStat = null;
  for (const seg of segments) {
    if (typeof seg !== 'string' || !seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
      return null;
    }
    cur = path.join(cur, seg);
    if (!isPathInside(cur, absRoot)) return null;
    try {
      lastStat = fs.lstatSync(cur);
    } catch {
      return null;
    }
    if (lastStat.isSymbolicLink()) return null;
  }
  return { fullPath: cur, stat: lastStat };
}

function splitProseAndFencedCode(rawText) {
  const prose = [];
  const code = [];
  const lines = String(rawText || '').replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let proseBuf = [];
  let codeBuf = [];

  const flushProse = () => {
    const joined = proseBuf.join('\n').trim();
    if (joined) prose.push(joined);
    proseBuf = [];
  };
  const flushCode = () => {
    const joined = codeBuf.join('\n').trim();
    if (joined) code.push(joined);
    codeBuf = [];
  };

  for (const line of lines) {
    if (!inFence) {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) {
        flushProse();
        inFence = true;
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        continue;
      }
      proseBuf.push(line);
    } else {
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      if (closeRe.test(line)) {
        flushCode();
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      } else {
        codeBuf.push(line);
      }
    }
  }
  if (inFence) flushCode();
  else flushProse();
  return { prose, code };
}

function stringifyBounded(val, maxLen = 2000) {
  if (typeof val === 'string') return val.slice(0, maxLen);
  if (val === null || val === undefined) return '';
  try {
    return JSON.stringify(val).slice(0, maxLen);
  } catch {
    return String(val).slice(0, maxLen);
  }
}

function extractChunksFromTranscriptObj(obj, lineIndex) {
  if (!obj || typeof obj !== 'object') return [];
  const chunks = [];
  const rawRole = String(obj.role || obj.message?.role || obj.author || obj.type || 'unknown').toLowerCase();
  const role =
    rawRole.includes('user') || rawRole === 'human'
      ? 'user'
      : rawRole.includes('assistant') || rawRole === 'model' || rawRole === 'agent'
        ? 'assistant'
        : rawRole.includes('tool') || rawRole.includes('command') || rawRole.includes('function')
          ? 'tool'
          : rawRole;
  const timestamp = String(obj.timestamp || obj.createdAt || obj.ts || obj.time || '');

  const pushChunk = (kind, text) => {
    const rawClean = String(text || '').trim();
    if (!rawClean) return;
    // Redact BEFORE keyword matching and BEFORE excerpt slicing so secret fragments can never leak
    const safeText = redactSensitiveText(rawClean);
    if (!safeText) return;
    chunks.push({
      kind,
      role,
      text: safeText,
      textLower: safeText.toLowerCase(),
      timestamp,
      lineIndex
    });
  };

  const ingestText = (str, forceKind = '') => {
    if (typeof str !== 'string' || !str.trim()) return;
    const redactedStr = redactSensitiveText(str);
    if (forceKind) {
      pushChunk(forceKind, redactedStr);
      return;
    }
    if (role === 'tool') {
      pushChunk('code_cmd', redactedStr);
      return;
    }
    const { prose, code } = splitProseAndFencedCode(redactedStr);
    for (const p of prose) pushChunk('prose', p);
    for (const c of code) pushChunk('code_cmd', c);
  };

  const ingestContent = (content) => {
    if (typeof content === 'string') {
      ingestText(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (typeof part === 'string') {
        ingestText(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const pType = String(part.type || '').toLowerCase();
      if (typeof part.text === 'string') {
        ingestText(part.text, pType === 'code' || pType === 'tool_result' ? 'code_cmd' : '');
      }
      if (pType === 'tool_use' || pType === 'tool_call' || part.functionCall) {
        const fc = part.functionCall || part;
        const toolName = fc.name || fc.tool || 'tool';
        const toolArgs = fc.input ?? fc.args ?? fc.arguments ?? fc.command ?? fc.CommandLine;
        pushChunk('code_cmd', `${toolName}: ${stringifyBounded(toolArgs)}`);
      }
      if (pType === 'tool_result' || part.functionResponse) {
        const fr = part.functionResponse || part;
        const body = fr.content ?? fr.response ?? fr.output;
        if (body !== undefined) {
          pushChunk('code_cmd', stringifyBounded(body));
        }
      }
    }
  };

  if (obj.message && typeof obj.message === 'object') {
    ingestContent(obj.message.content ?? obj.message.parts ?? obj.message.text);
  }
  if (obj.content !== undefined) ingestContent(obj.content);
  if (obj.parts !== undefined) ingestContent(obj.parts);
  if (typeof obj.text === 'string') ingestText(obj.text);

  // Explicit command/tool fields at top level
  const cmdParts = [];
  for (const key of ['command', 'CommandLine', 'cmd', 'tool', 'toolName', 'path', 'filePath', 'TargetFile']) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
      cmdParts.push(`${key}=${obj[key].trim()}`);
    }
  }
  if (obj.args && typeof obj.args === 'object') {
    cmdParts.push(stringifyBounded(obj.args, 1000));
  } else if (obj.input && typeof obj.input === 'object') {
    cmdParts.push(stringifyBounded(obj.input, 1000));
  }
  if (cmdParts.length > 0) {
    pushChunk('code_cmd', cmdParts.join(' '));
  }

  return chunks;
}

function loadParsedTranscriptChunks(filePath, stat) {
  const cacheKey = `${filePath}|${stat.mtimeMs}:${stat.size}:${stat.ino || 0}`;
  const cached = transcriptParseCache.get(cacheKey);
  if (cached) {
    return { chunks: cached.chunks, bytesRead: cached.bytesRead, fromCache: true };
  }

  const readLen = Math.min(stat.size, TRANSCRIPT_MAX_FILE_BYTES);
  const buf = Buffer.alloc(readLen);
  const fd = fs.openSync(filePath, 'r');
  let actualRead = 0;
  try {
    actualRead = fs.readSync(fd, buf, 0, readLen, 0);
  } finally {
    fs.closeSync(fd);
  }

  const rawText = buf.subarray(0, actualRead).toString('utf8');
  const lines = rawText.split(/\r?\n/);
  // Drop incomplete trailing line if file exceeded per-file byte limit
  if (stat.size > TRANSCRIPT_MAX_FILE_BYTES && lines.length > 1) {
    lines.pop();
  }

  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const extracted = extractChunksFromTranscriptObj(parsed, i);
    for (const c of extracted) chunks.push(c);
  }

  if (transcriptParseCache.size >= TRANSCRIPT_CACHE_MAX_ENTRIES) {
    const oldestKey = transcriptParseCache.keys().next().value;
    if (oldestKey !== undefined) transcriptParseCache.delete(oldestKey);
  }
  transcriptParseCache.set(cacheKey, { chunks, bytesRead: actualRead });
  return { chunks, bytesRead: actualRead, fromCache: false };
}

function buildExcerptAroundMatch(text, matchIdx, queryLen) {
  const beforeCtx = 90;
  const afterCtx = 160;
  const start = Math.max(0, matchIdx - beforeCtx);
  const end = Math.min(text.length, matchIdx + queryLen + afterCtx);
  let slice = text.slice(start, end);
  if (start > 0) slice = `…${slice}`;
  if (end < text.length) slice = `${slice}…`;
  return slice;
}

export function searchTranscripts({ query, filter = 'all', limit = 40, brainDir } = {}) {
  const startMs = Date.now();
  const q = String(query ?? '').trim();
  const normFilter = ['all', 'prose', 'code_cmd'].includes(filter) ? filter : 'all';
  const maxResults = Math.max(1, Math.min(TRANSCRIPT_MAX_RESULTS, Number(limit) || 40));
  const resolvedBrainDir = realpathNearest(brainDir || resolveHomeAndBrain().brainDir);

  if (!q) {
    return {
      ok: true,
      query: '',
      filter: normFilter,
      results: [],
      total: 0,
      scannedSessions: 0,
      scannedBytes: 0,
      truncated: false,
      durationMs: 0,
      brainDir: resolvedBrainDir
    };
  }

  let rootStat;
  try {
    rootStat = fs.lstatSync(resolvedBrainDir);
  } catch {
    return {
      ok: true,
      query: q,
      filter: normFilter,
      results: [],
      total: 0,
      scannedSessions: 0,
      scannedBytes: 0,
      truncated: false,
      durationMs: Date.now() - startMs,
      brainDir: resolvedBrainDir
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      ok: false,
      error: 'brain 目录无效',
      query: q,
      filter: normFilter,
      results: [],
      total: 0,
      scannedSessions: 0,
      scannedBytes: 0,
      truncated: false,
      durationMs: Date.now() - startMs,
      brainDir: resolvedBrainDir
    };
  }

  let sessions = [];
  try {
    const ents = fs.readdirSync(resolvedBrainDir, { withFileTypes: true });
    for (const ent of ents) {
      if (ent.name.startsWith('.') || ent.name === '..') continue;
      const checked = safeLstatJoinInRoot(resolvedBrainDir, ent.name);
      if (!checked || !checked.stat.isDirectory()) continue;
      sessions.push({
        name: ent.name,
        full: checked.fullPath,
        mtimeMs: checked.stat.mtimeMs
      });
    }
  } catch {
    sessions = [];
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (sessions.length > TRANSCRIPT_MAX_SESSIONS) {
    sessions = sessions.slice(0, TRANSCRIPT_MAX_SESSIONS);
  }

  const qLower = q.toLowerCase();
  const results = [];
  let scannedSessions = 0;
  let scannedBytes = 0;
  let truncated = false;

  for (const sess of sessions) {
    if (Date.now() - startMs >= TRANSCRIPT_BUDGET_MS) {
      truncated = true;
      break;
    }
    if (results.length >= maxResults) {
      truncated = true;
      break;
    }

    const fileChecked = safeLstatJoinInRoot(
      resolvedBrainDir,
      sess.name,
      '.system_generated',
      'logs',
      'transcript.jsonl'
    );
    if (!fileChecked || !fileChecked.stat.isFile()) continue;

    const plannedBytes = Math.min(fileChecked.stat.size, TRANSCRIPT_MAX_FILE_BYTES);
    if (scannedBytes + plannedBytes > TRANSCRIPT_MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }

    let loaded;
    try {
      loaded = loadParsedTranscriptChunks(fileChecked.fullPath, fileChecked.stat);
    } catch {
      continue;
    }

    scannedSessions += 1;
    scannedBytes += loaded.bytesRead;

    for (const chunk of loaded.chunks) {
      if (Date.now() - startMs >= TRANSCRIPT_BUDGET_MS) {
        truncated = true;
        break;
      }
      if (normFilter !== 'all' && chunk.kind !== normFilter) continue;

      const idx = chunk.textLower.indexOf(qLower);
      if (idx === -1) continue;

      const rawExcerpt = buildExcerptAroundMatch(chunk.text, idx, q.length);
      const safeSnippet = redactSensitiveText(rawExcerpt);

      results.push({
        sessionId: sess.name,
        shortSessionId: sess.name.slice(0, 8),
        sessionDir: sess.full,
        transcriptPath: fileChecked.fullPath,
        conversationUri: `conversation://${sess.name}`,
        kind: chunk.kind,
        role: chunk.role,
        snippet: safeSnippet,
        timestamp: chunk.timestamp || new Date(Math.round(fileChecked.stat.mtimeMs)).toISOString(),
        mtimeMs: Math.round(fileChecked.stat.mtimeMs),
        lineNumber: chunk.lineIndex + 1
      });

      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
    }
  }

  return {
    ok: true,
    query: q,
    filter: normFilter,
    results,
    total: results.length,
    scannedSessions,
    scannedBytes,
    truncated,
    durationMs: Date.now() - startMs,
    brainDir: resolvedBrainDir
  };
}

/* ---------------- Main MCP Server Factory ---------------- */

export function createPrismFilesServer({
  dataDir = '',
  defaultRoot = process.cwd(),
  accountStateDir = '',
  profilePath = '',
  accountManager: injectedAccountManager = null,
  handoffMemory: injectedHandoffMemory = null,
  prismProfile: injectedPrismProfile = null,
  modelHub: injectedModelHub = null,
  clientRelauncher: injectedClientRelauncher = null,
  upstreamConfigPath = '',
  upstreamFetch = null,
  modelFetch = null,
  searchLookupFn = null,
  cuaBrokerPath = '',
  cuaFetch = null
} = {}) {
  const stateFile = dataDir ? path.join(path.resolve(dataDir), 'state.json') : '';
  const { home, brainDir } = resolveHomeAndBrain();
  const isWsl = detectWsl();
  const resolvedAccountStateDir = accountStateDir
    ? path.resolve(accountStateDir)
    : path.join(home, '.gemini', 'antigravity', 'prism-suite');
  const isExternalSandboxState = Boolean(accountStateDir && !isPathInside(resolvedAccountStateDir, home));
  const resolvedProfilePath = profilePath
    ? path.resolve(profilePath)
    : (isExternalSandboxState ? path.join(resolvedAccountStateDir, 'prism-profile.json') : '');
  const sharedProviderVault = createAccountVault({ homeDir: home, isWsl });
  const prismProfile = injectedPrismProfile || createPrismProfileManager({
    homeDir: home,
    ...(resolvedProfilePath ? { profilePath: resolvedProfilePath } : {}),
    secretStore: sharedProviderVault.asProviderSecretStore()
  });
  const handoffMemory = injectedHandoffMemory || createHandoffMemoryStore({
    homeDir: home,
    stateDir: resolvedAccountStateDir,
    getRemoteConfig: () => {
      try {
        const rm = prismProfile.loadProfile().settings?.remoteMemory;
        if (!rm || typeof rm !== 'object') return { enabled: false };
        return {
          enabled: Boolean(rm.enabled),
          url: rm.endpointUrl || rm.url || '',
          authEnv: rm.apiKeyEnv || rm.authEnv || '',
          syncCatalog: rm.syncCatalog !== false
        };
      } catch {
        return { enabled: false };
      }
    }
  });
  const unregisterExitCleanup = registerProcessExitCleanup(() => {
    try { handoffMemory?.close?.(); } catch {}
  });
  const modelHub = injectedModelHub || createModelHub({
    profileManager: prismProfile,
    ...(modelFetch ? { fetchFn: modelFetch } : {}),
    ...(searchLookupFn ? { lookupFn: searchLookupFn } : {})
  });
  const accountManager = injectedAccountManager || createAccountManager({
    homeDir: home,
    stateDir: resolvedAccountStateDir,
    brainDir,
    handoffMemory
  });
  const clientRelauncher = injectedClientRelauncher || createClientRelauncher({
    isWsl,
    homeDir: home
  });
  const resolvedUpstreamConfigPath = upstreamConfigPath
    ? path.resolve(upstreamConfigPath)
    : (fs.existsSync(path.join(PLUGIN_ROOT, 'upstream.json'))
      ? path.join(PLUGIN_ROOT, 'upstream.json')
      : path.join(PLUGIN_ROOT, '..', 'upstream.json'));
  const upstreamCacheFile = path.join(resolvedAccountStateDir, 'upstream-cache.json');
  const platformLabel =
    process.platform === 'darwin'
      ? 'macOS Finder'
      : process.platform === 'win32'
        ? 'Windows 资源管理器'
        : isWsl
          ? 'Windows 资源管理器 (WSL)'
          : '系统文件管理器';

  // Cached with 60s TTL to avoid scanning /mnt/c/Users/* on every menu open while staying fresh
  const OPEN_TARGETS_TTL_MS = 60 * 1000;
  let cachedOpenTargets = null;
  let cachedOpenTargetMap = null;
  let cachedOpenTargetsExpiresAt = 0;

  function getDetectedTargetsInternal({ force = false } = {}) {
    const now = Date.now();
    if (force || !cachedOpenTargets || now >= cachedOpenTargetsExpiresAt) {
      cachedOpenTargets = detectInstalledOpenTargets(isWsl);
      cachedOpenTargetMap = new Map(cachedOpenTargets.map((t) => [t.id, t]));
      cachedOpenTargetsExpiresAt = now + OPEN_TARGETS_TTL_MS;
    }
    return { list: cachedOpenTargets, map: cachedOpenTargetMap };
  }

  function listOpenTargets() {
    const { list } = getDetectedTargetsInternal();
    return {
      ok: true,
      targets: list.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        supportsLineCol: Boolean(t.supportsLineCol)
      }))
    };
  }

  const VALID_TABS = new Set(['browse', 'artifacts', 'pins', 'search', 'models', 'accounts', 'cua']);
  const RESTORABLE_TABS = new Set(['browse', 'artifacts', 'pins', 'search', 'models', 'cua']);

  function normalizeMcpExposure(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      fileTools: r.fileTools !== false,
      memoryTools: r.memoryTools !== false,
      modelHubTools: r.modelHubTools !== false
    };
  }

  function loadState() {
    const defaults = {
      pinnedPaths: [],
      lastPath: path.resolve(defaultRoot || home),
      lastTab: 'browse',
      showHidden: false,
      doubleClickAction: 'reveal', // 'reveal' | 'open_tab'
      allowLanSmb: false, // explicit opt-in for LAN SMB/UNC paths
      dismissedGuides: [],
      mcpExposure: { fileTools: true, memoryTools: true, modelHubTools: true }
    };
    if (!stateFile) return defaults;
    try {
      if (fs.existsSync(stateFile)) {
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return {
          pinnedPaths: Array.isArray(parsed.pinnedPaths) ? parsed.pinnedPaths.filter((p) => typeof p === 'string').slice(0, 30) : [],
          lastPath: typeof parsed.lastPath === 'string' && parsed.lastPath ? parsed.lastPath : defaults.lastPath,
          lastTab: RESTORABLE_TABS.has(parsed.lastTab) ? parsed.lastTab : 'browse',
          showHidden: Boolean(parsed.showHidden),
          doubleClickAction: parsed.doubleClickAction === 'open_tab' ? 'open_tab' : 'reveal',
          allowLanSmb: Boolean(parsed.allowLanSmb),
          dismissedGuides: Array.isArray(parsed.dismissedGuides)
            ? parsed.dismissedGuides.filter((g) => typeof g === 'string' && /^[a-z0-9:_-]{2,48}$/i.test(g)).slice(0, 32)
            : [],
          mcpExposure: normalizeMcpExposure(parsed.mcpExposure)
        };
      }
    } catch {}
    return defaults;
  }

  function saveState(patch) {
    const cur = loadState();
    const nextExposure = patch?.mcpExposure && typeof patch.mcpExposure === 'object'
      ? normalizeMcpExposure({ ...cur.mcpExposure, ...patch.mcpExposure })
      : cur.mcpExposure;
    const next = {
      pinnedPaths: Array.isArray(patch?.pinnedPaths) ? patch.pinnedPaths.filter((p) => typeof p === 'string').slice(0, 30) : cur.pinnedPaths,
      lastPath: typeof patch?.lastPath === 'string' && patch.lastPath ? patch.lastPath : cur.lastPath,
      lastTab: RESTORABLE_TABS.has(patch?.lastTab) ? patch.lastTab : cur.lastTab,
      showHidden: typeof patch?.showHidden === 'boolean' ? patch.showHidden : cur.showHidden,
      doubleClickAction: patch?.doubleClickAction === 'open_tab' || patch?.doubleClickAction === 'reveal' ? patch.doubleClickAction : cur.doubleClickAction,
      allowLanSmb: typeof patch?.allowLanSmb === 'boolean' ? patch.allowLanSmb : cur.allowLanSmb,
      dismissedGuides: Array.isArray(patch?.dismissedGuides)
        ? Array.from(new Set(patch.dismissedGuides.filter((g) => typeof g === 'string' && /^[a-z0-9:_-]{2,48}$/i.test(g)))).slice(0, 32)
        : cur.dismissedGuides,
      mcpExposure: nextExposure
    };
    if (stateFile) {
      try {
        const existingSt = fs.lstatSync(stateFile, { throwIfNoEntry: false });
        if (existingSt && (existingSt.isSymbolicLink() || existingSt.isDirectory())) {
          return next;
        }
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        const tmp = `${stateFile}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          try { fs.chmodSync(tmp, 0o600); } catch {}
          fs.renameSync(tmp, stateFile);
          try { fs.chmodSync(stateFile, 0o600); } catch {}
        } catch {
          try { fs.rmSync(tmp, { force: true }); } catch {}
        }
      } catch {}
    }
    return next;
  }

  const WSL_UNMOUNTED_SMB_MSG =
    'WSL 中无法直接读写未挂载的 Windows SMB 路径；可点击「定位」在 Windows 资源管理器中打开，或通过「打开方式」使用本地 Windows 编辑器打开。';

  async function guardUncAccessIfNeeded(rawPath) {
    if (!isUncPathString(rawPath)) return { ok: true, isUnc: false };
    const trimmed = String(rawPath).trim();
    if (/^(?:\\\\|\/\/)[?.](?:\\|\/|$)/.test(trimmed)) {
      return { ok: false, isUnc: true, error: '已拒绝设备/扩展前缀路径 (\\\\?\\ 或 \\\\.\\)' };
    }
    if (!isLocalWslUncHost(trimmed) && !loadState().allowLanSmb) {
      return {
        ok: false,
        isUnc: true,
        error: '当前未开启「允许局域网 NAS/SMB 路径」，请在顶栏手动开启后再访问 UNC 网络路径'
      };
    }
    const validation = await validateLanUncPath(trimmed);
    if (!validation.ok) {
      return { ok: false, isUnc: true, error: validation.error };
    }
    return { ok: true, isUnc: true, normalizedPath: validation.normalizedPath };
  }

  async function resolveWslUncPathForFs(uncCheck) {
    if (!uncCheck?.isUnc) return { ok: true, convertedToLocal: false, path: '' };
    if (!isWsl) {
      return { ok: true, convertedToLocal: false, path: uncCheck.normalizedPath };
    }
    if (isLocalWslUncHost(uncCheck.normalizedPath)) {
      const linuxPath = await toLinuxPathFromWslUnc(uncCheck.normalizedPath);
      if (linuxPath) {
        return { ok: true, convertedToLocal: true, path: linuxPath };
      }
      return {
        ok: false,
        error: `无法将 WSL UNC 路径转换为 Linux 本地路径：${uncCheck.normalizedPath}`
      };
    }
    return {
      ok: false,
      error: WSL_UNMOUNTED_SMB_MSG
    };
  }

  function checkUncSyncGuard(rawPath, { uncPrevalidated = false } = {}) {
    if (!isUncPathString(rawPath)) return { ok: true, isUnc: false };
    if (/[\x00-\x1f\x7f]/.test(rawPath)) {
      return { ok: false, isUnc: true, error: 'UNC 路径包含非法控制字符或 NUL 字节' };
    }
    const trimmed = String(rawPath).trim();
    if (/^(?:\\\\|\/\/)[?.](?:\\|\/|$)/.test(trimmed)) {
      return { ok: false, isUnc: true, error: '已拒绝设备/扩展前缀路径 (\\\\?\\ 或 \\\\.\\)' };
    }
    if (trimmed.includes('@')) {
      return { ok: false, isUnc: true, error: 'UNC 路径禁止包含凭据或 WebDAV 符号 (@)' };
    }
    if (trimmed.includes(':')) {
      return { ok: false, isUnc: true, error: 'UNC 路径禁止包含端口或冒号 (:)' };
    }
    const m = trimmed.match(/^(?:\\\\|\/\/)([^\\/]+)(?:[\\/](.*))?$/);
    if (!m) {
      return { ok: false, isUnc: true, error: '不是有效的 UNC 网络路径' };
    }
    const host = m[1];
    const rest = m[2] ?? '';
    if (!host || host === '.' || host === '..' || /\s/.test(host) || host.includes('"')) {
      return { ok: false, isUnc: true, error: 'UNC 主机名格式无效' };
    }
    const segments = rest ? rest.split(/[\\/]+/) : [];
    if (segments.some((seg) => seg === '..')) {
      return { ok: false, isUnc: true, error: 'UNC 路径禁止包含 .. 路径穿越段' };
    }
    const normalizedPath = `\\\\${host}${rest ? `\\${rest.replace(/\//g, '\\')}` : ''}`;
    const hostLower = host.toLowerCase();
    const isLocalWsl = hostLower === 'wsl.localhost' || hostLower === 'wsl$';
    if (!isLocalWsl && !loadState().allowLanSmb) {
      return {
        ok: false,
        isUnc: true,
        error: '当前未开启「允许局域网 NAS/SMB 路径」，请在顶栏手动开启后再访问 UNC 网络路径'
      };
    }
    if (isWsl) {
      return {
        ok: false,
        isUnc: true,
        error: isLocalWsl
          ? 'WSL UNC 路径需经异步 wslpath 转换，请通过 MCP 工具调用访问'
          : WSL_UNMOUNTED_SMB_MSG
      };
    }
    if (!uncPrevalidated) {
      if (isLocalWsl || hostLower === 'localhost') {
        return { ok: true, isUnc: true, normalizedPath };
      }
      if (net.isIP(hostLower)) {
        if (!isPrivateOrLocalIp(hostLower)) {
          return { ok: false, isUnc: true, error: `已拒绝公网 IP UNC 路径 (${host})，以防止 NTLM 凭据泄露` };
        }
        return { ok: true, isUnc: true, normalizedPath };
      }
      return {
        ok: false,
        isUnc: true,
        error: 'UNC 主机名需经异步 DNS 私网校验，已拒绝未预检的同步访问'
      };
    }
    return { ok: true, isUnc: true, normalizedPath };
  }

  function buildFileItem(absPath, baseDir = '') {
    const resolved = path.resolve(absPath);
    let st = null;
    try {
      st = fs.statSync(resolved);
    } catch {
      return {
        path: resolved,
        uri: pathToFileURL(resolved).href,
        name: path.basename(resolved) || resolved,
        relPath: baseDir ? path.relative(baseDir, resolved) : resolved,
        isDir: false,
        exists: false,
        size: 0,
        sizeText: '不存在',
        mtimeMs: 0,
        kind: 'file'
      };
    }
    const isDir = st.isDirectory();
    const name = path.basename(resolved) || resolved;
    return {
      path: resolved,
      uri: pathToFileURL(resolved).href,
      name,
      relPath: baseDir ? (path.relative(baseDir, resolved) || name) : resolved,
      isDir,
      exists: true,
      size: isDir ? 0 : st.size,
      sizeText: isDir ? '文件夹' : formatBytes(st.size),
      mtimeMs: Math.round(st.mtimeMs),
      kind: getFileKind(name, isDir)
    };
  }

  function listDirectoryInternal(rawDir, showHidden = false, query = '', { uncPrevalidated = false } = {}) {
    const syncUnc = checkUncSyncGuard(rawDir, { uncPrevalidated });
    if (!syncUnc.ok) {
      return {
        ok: false,
        error: syncUnc.error,
        dir: String(rawDir || ''),
        entries: []
      };
    }
    const dir = syncUnc.isUnc && process.platform === 'win32'
      ? syncUnc.normalizedPath
      : expandUserPath(rawDir, loadState().lastPath || defaultRoot || home);
    if (!fs.existsSync(dir)) {
      return { ok: false, error: `目录不存在：${dir}`, dir, entries: [] };
    }
    const st = fs.statSync(dir);
    const targetDir = st.isDirectory() ? dir : path.dirname(dir);
    let rawEntries = [];
    try {
      rawEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, error: `无法读取目录：${err.message}`, dir: targetDir, entries: [] };
    }
    const q = String(query || '').trim().toLowerCase();
    const items = [];
    for (const ent of rawEntries) {
      const name = ent.name;
      if (!showHidden && name.startsWith('.')) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      const full = path.join(targetDir, name);
      let isDir = ent.isDirectory();
      let size = 0;
      let mtimeMs = 0;
      try {
        const s = fs.statSync(full);
        isDir = s.isDirectory();
        size = isDir ? 0 : s.size;
        mtimeMs = Math.round(s.mtimeMs);
      } catch {}
      items.push({
        path: full,
        uri: pathToFileURL(full).href,
        name,
        isDir,
        size,
        sizeText: isDir ? '' : formatBytes(size),
        mtimeMs,
        kind: getFileKind(name, isDir)
      });
    }
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    const truncated = items.length > 400;
    const parent = path.dirname(targetDir);
    saveState({ lastPath: targetDir });
    return {
      ok: true,
      dir: targetDir,
      parent: parent !== targetDir ? parent : '',
      total: items.length,
      truncated,
      entries: items.slice(0, 400),
      platformLabel
    };
  }

  function listDirectory(rawDir, showHidden = false, query = '') {
    return listDirectoryInternal(rawDir, showHidden, query, { uncPrevalidated: false });
  }

  function readFilePreviewInternal(rawPath, { uncPrevalidated = false } = {}) {
    const syncUnc = checkUncSyncGuard(rawPath, { uncPrevalidated });
    if (!syncUnc.ok) {
      return { ok: false, error: syncUnc.error, path: String(rawPath || '') };
    }
    const abs = syncUnc.isUnc && process.platform === 'win32'
      ? syncUnc.normalizedPath
      : expandUserPath(rawPath);
    if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在', path: abs };
    let st;
    try {
      st = fs.statSync(abs);
    } catch (err) {
      return { ok: false, error: err.message, path: abs };
    }
    if (st.isDirectory()) return { ok: false, error: '目标是文件夹而非文件', path: abs, isDir: true };

    const ext = path.extname(abs).toLowerCase();
    const name = path.basename(abs);
    const kind = getFileKind(name, false);
    const real = (() => { try { return fs.realpathSync(abs); } catch { return abs; } })();
    if (isSensitivePath(abs) || isSensitivePath(real)) {
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind,
        previewType: 'protected',
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }
    const editableBlocked =
      isPathInside(real, brainDir) ||
      st.size > MAX_SAVE_BYTES;

    if (IMAGE_MIME_BY_EXT[ext]) {
      if (st.size > MAX_IMAGE_PREVIEW_BYTES) {
        return {
          ok: true,
          path: abs,
          uri: pathToFileURL(abs).href,
          name,
          kind: 'image',
          previewType: 'too_large',
          size: st.size,
          sizeText: formatBytes(st.size),
          mtimeMs: Math.round(st.mtimeMs),
          editable: false
        };
      }
      const b64 = fs.readFileSync(abs).toString('base64');
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind: 'image',
        previewType: 'image',
        mime: IMAGE_MIME_BY_EXT[ext],
        dataUrl: `data:${IMAGE_MIME_BY_EXT[ext]};base64,${b64}`,
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }

    const readLen = Math.min(st.size, MAX_TEXT_PREVIEW_BYTES);
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(readLen);
    let actualRead = 0;
    try {
      actualRead = fs.readSync(fd, buf, 0, readLen, 0);
    } finally {
      fs.closeSync(fd);
    }
    const slice = buf.subarray(0, actualRead);
    // Check NUL byte for binary files
    let isBinary = false;
    const probeLen = Math.min(slice.length, 4096);
    for (let i = 0; i < probeLen; i++) {
      if (slice[i] === 0) {
        isBinary = true;
        break;
      }
    }
    if (isBinary) {
      return {
        ok: true,
        path: abs,
        uri: pathToFileURL(abs).href,
        name,
        kind,
        previewType: 'binary',
        size: st.size,
        sizeText: formatBytes(st.size),
        mtimeMs: Math.round(st.mtimeMs),
        editable: false
      };
    }
    const truncated = st.size > MAX_TEXT_PREVIEW_BYTES;
    return {
      ok: true,
      path: abs,
      uri: pathToFileURL(abs).href,
      name,
      kind,
      previewType: kind === 'markdown' ? 'markdown' : 'text',
      text: slice.toString('utf8'),
      baseHash: truncated ? '' : sha256Hex(slice),
      truncated,
      size: st.size,
      sizeText: formatBytes(st.size),
      mtimeMs: Math.round(st.mtimeMs),
      editable: !editableBlocked && !truncated
    };
  }

  function readFilePreview(rawPath) {
    return readFilePreviewInternal(rawPath, { uncPrevalidated: false });
  }

  function saveFileContentInternal(rawPath, content, expectedMtimeMs, baseHash = '', { uncPrevalidated = false } = {}) {
    const syncUnc = checkUncSyncGuard(rawPath, { uncPrevalidated });
    if (!syncUnc.ok) {
      return { ok: false, error: syncUnc.error };
    }
    const abs = syncUnc.isUnc && process.platform === 'win32'
      ? syncUnc.normalizedPath
      : expandUserPath(rawPath);
    if (!fs.existsSync(abs)) return { ok: false, error: '文件不存在，拒绝创建未知路径' };
    const real = fs.realpathSync(abs);
    if (isPathInside(real, brainDir)) {
      return { ok: false, error: '为保护会话产物，brain/ 目录仅允许只读预览' };
    }
    if (isSensitivePath(abs) || isSensitivePath(real)) {
      return { ok: false, error: '受保护凭据或配置目录禁止通过工作台写入' };
    }
    const st = fs.statSync(real);
    if (st.isDirectory()) return { ok: false, error: '目标为目录，无法写入' };
    const text = String(content ?? '');
    const byteLen = Buffer.byteLength(text, 'utf8');
    if (byteLen > MAX_SAVE_BYTES) {
      return { ok: false, error: `文件内容超过安全编辑上限 (${formatBytes(MAX_SAVE_BYTES)})` };
    }
    if (baseHash) {
      const curHash = sha256Hex(fs.readFileSync(real));
      if (curHash !== String(baseHash)) {
        return {
          ok: false,
          conflict: true,
          error: '文件内容已在外部变更，请刷新后再保存',
          currentMtimeMs: Math.round(st.mtimeMs)
        };
      }
    } else if (typeof expectedMtimeMs === 'number' && Number.isFinite(expectedMtimeMs)) {
      const curMtime = Math.round(st.mtimeMs);
      if (Math.abs(curMtime - Math.round(expectedMtimeMs)) > 1) {
        return {
          ok: false,
          conflict: true,
          error: '文件已在外部发生变更，请刷新后再保存',
          currentMtimeMs: curMtime
        };
      }
    } else {
      return { ok: false, error: '缺少版本校验信息（baseHash / expectedMtimeMs），已拒绝盲写' };
    }
    const fileMode = (st.mode & 0o777) || 0o600;
    const tmp = path.join(path.dirname(real), `.prism-save-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}.tmp`);
    try {
      const outBuf = Buffer.from(text, 'utf8');
      fs.writeFileSync(tmp, outBuf, { flag: 'wx', mode: fileMode });
      try { fs.chmodSync(tmp, fileMode); } catch {}
      fs.renameSync(tmp, real);
      const nextSt = fs.statSync(real);
      return {
        ok: true,
        path: abs,
        size: nextSt.size,
        sizeText: formatBytes(nextSt.size),
        mtimeMs: Math.round(nextSt.mtimeMs),
        baseHash: sha256Hex(outBuf)
      };
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      return { ok: false, error: `保存失败：${err.message}` };
    }
  }

  function saveFileContent(rawPath, content, expectedMtimeMs, baseHash = '') {
    return saveFileContentInternal(rawPath, content, expectedMtimeMs, baseHash, { uncPrevalidated: false });
  }

  function listRecentArtifacts(limit = 50) {
    if (!fs.existsSync(brainDir)) {
      return { ok: true, brainDir, items: [], platformLabel };
    }
    const found = [];
    let sessions = [];
    try {
      const ents = fs.readdirSync(brainDir, { withFileTypes: true });
      for (const d of ents) {
        if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
        const full = path.join(brainDir, d.name);
        let st;
        try {
          st = fs.lstatSync(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
        sessions.push({ name: d.name, full, mtime: st.mtimeMs });
      }
      sessions.sort((a, b) => b.mtime - a.mtime);
      sessions = sessions.slice(0, 24);
    } catch {
      sessions = [];
    }

    for (const sess of sessions) {
      let ents = [];
      try { ents = fs.readdirSync(sess.full, { withFileTypes: true }); } catch { continue; }
      for (const ent of ents) {
        if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
        if (/\.resolved(\.\d+)?$|\.metadata\.json$/i.test(ent.name)) continue;
        const full = path.join(sess.full, ent.name);
        let st;
        try {
          st = fs.lstatSync(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink() || !st.isFile()) continue;
        found.push({
          path: full,
          uri: pathToFileURL(full).href,
          name: ent.name,
          sessionId: sess.name.slice(0, 8),
          isDir: false,
          size: st.size,
          sizeText: formatBytes(st.size),
          mtimeMs: Math.round(st.mtimeMs),
          kind: getFileKind(ent.name, false)
        });
      }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return {
      ok: true,
      brainDir,
      items: found.slice(0, Math.max(1, Math.min(120, Number(limit) || 50))),
      platformLabel
    };
  }

  async function revealInExplorer(rawPath) {
    const uncCheck = await guardUncAccessIfNeeded(rawPath);
    if (!uncCheck.ok) {
      return { ok: false, error: uncCheck.error, path: String(rawPath || '') };
    }

    if (uncCheck.isUnc && isWsl) {
      const winPath = uncCheck.normalizedPath;
      const explorerBin = fs.existsSync('/mnt/c/Windows/explorer.exe') ? '/mnt/c/Windows/explorer.exe' : 'explorer.exe';
      const likelyDir = /[\\/]$/.test(winPath) || /^\\\\[^\\]+(?:\\[^\\]+)?\\?$/.test(winPath) || !path.win32.extname(winPath);
      try {
        const args = buildWslExplorerArgs(winPath, likelyDir);
        try {
          await execFileAsync(explorerBin, args, {
            timeout: 8000,
            windowsHide: true,
            cwd: resolveSafeExecCwd({ isWsl: true, homeDir: home }),
            env: resolveWslInteropEnv(process.env, true)
          });
        } catch (err) {
          if (err && typeof err.code === 'number' && err.code !== 1) throw err;
        }
        return { ok: true, path: winPath, winPath, method: 'wsl-windows-explorer-unc' };
      } catch (err) {
        return { ok: false, error: `打开系统文件管理器失败：${err.message}`, path: winPath };
      }
    }

    const abs = uncCheck.isUnc && process.platform === 'win32'
      ? uncCheck.normalizedPath
      : expandUserPath(rawPath);

    if (!fs.existsSync(abs)) {
      return { ok: false, error: `路径不存在：${abs}`, path: abs };
    }
    const isDir = fs.statSync(abs).isDirectory();
    try {
      if (process.platform === 'darwin') {
        await execFileAsync('open', ['-R', abs], { timeout: 8000 });
        return { ok: true, path: abs, method: 'macos-finder' };
      }
      if (process.platform === 'win32') {
        const explorerArgs = buildWindowsExplorerArgs(abs, isDir);
        const useVerbatim = explorerArgs.length === 1 && explorerArgs[0].startsWith('/select,');
        try {
          await execFileAsync('explorer.exe', explorerArgs, {
            windowsVerbatimArguments: useVerbatim,
            windowsHide: true,
            timeout: 8000
          });
        } catch (err) {
          // explorer.exe routinely exits with code 1 even when the window opens cleanly
          if (err && typeof err.code === 'number' && err.code !== 1) throw err;
        }
        return { ok: true, path: abs, method: 'windows-explorer' };
      }
      if (isWsl) {
        const winPath = await toWindowsPathFromWsl(abs);
        if (/[\x00-\x1f\x7f"]/.test(winPath)) {
          return { ok: false, error: '转换后的 Windows 路径包含非法字符，已拒绝执行', path: abs };
        }
        const explorerBin = fs.existsSync('/mnt/c/Windows/explorer.exe') ? '/mnt/c/Windows/explorer.exe' : 'explorer.exe';
        const args = buildWslExplorerArgs(winPath, isDir);
        try {
          await execFileAsync(explorerBin, args, {
            timeout: 8000,
            windowsHide: true,
            cwd: resolveSafeExecCwd({ isWsl: true, homeDir: home }),
            env: resolveWslInteropEnv(process.env, true)
          });
        } catch (err) {
          if (err && typeof err.code === 'number' && err.code !== 1) throw err;
        }
        return { ok: true, path: abs, winPath, method: 'wsl-windows-explorer' };
      }
      const openTarget = isDir ? abs : path.dirname(abs);
      await execFileAsync('xdg-open', [openTarget], { timeout: 8000, windowsHide: true });
      return { ok: true, path: abs, method: 'linux-xdg-open' };
    } catch (err) {
      return { ok: false, error: `打开系统文件管理器失败：${err.message}`, path: abs };
    }
  }

  async function openWithTarget({ targetId, path: rawPath, line, column } = {}) {
    const id = String(targetId || '').trim();
    const { map } = getDetectedTargetsInternal();
    const target = map.get(id);
    if (!target) {
      return { ok: false, error: `未检测到打开方式或不在允许列表中：${id || '(空)'}` };
    }

    const uncCheck = await guardUncAccessIfNeeded(rawPath);
    if (!uncCheck.ok) {
      return { ok: false, error: uncCheck.error };
    }

    const hasRawLine = line !== undefined && line !== null && line !== '';
    const hasRawCol = column !== undefined && column !== null && column !== '';
    const parsedLC = parseLineCol(line, column);
    if (hasRawLine && parsedLC.line === null) {
      return { ok: false, error: '行号参数无效，仅接受正整数' };
    }
    if (hasRawCol && parsedLC.column === null) {
      return { ok: false, error: '列号参数无效，仅接受正整数且需配合有效行号' };
    }

    let abs = '';
    let isDir = false;
    let launchPath = '';
    let launchDir = '';

    if (isWsl && uncCheck.isUnc) {
      if (isLocalWslUncHost(uncCheck.normalizedPath)) {
        const linuxPath = await toLinuxPathFromWslUnc(uncCheck.normalizedPath);
        if (linuxPath) {
          abs = linuxPath;
        }
      }
      if (!abs) {
        if (!target.isWindowsExe) {
          return {
            ok: false,
            error: `WSL 中的 Linux 程序 (${target.name}) 无法直接打开未挂载的 Windows SMB 路径，请选择本地 Windows 编辑器或使用「定位」`,
            path: uncCheck.normalizedPath
          };
        }
        if (isSensitivePath(uncCheck.normalizedPath)) {
          return { ok: false, error: '受保护凭据文件禁止通过外部程序直接打开', path: uncCheck.normalizedPath };
        }
        abs = uncCheck.normalizedPath;
        const likelyDir = /[\\/]$/.test(abs) || /^\\\\[^\\]+(?:\\[^\\]+)?\\?$/.test(abs) || !path.win32.extname(abs);
        isDir = likelyDir;
        launchPath = abs;
        launchDir = likelyDir ? abs : path.win32.dirname(abs);
      }
    }

    if (!launchPath) {
      if (!abs) {
        abs = uncCheck.isUnc && process.platform === 'win32'
          ? uncCheck.normalizedPath
          : expandUserPath(rawPath);
      }

      if (!fs.existsSync(abs)) {
        return { ok: false, error: `目标路径不存在：${abs}`, path: abs };
      }

      const real = (() => { try { return fs.realpathSync(abs); } catch { return abs; } })();
      if (isSensitivePath(abs) || isSensitivePath(real)) {
        return { ok: false, error: '受保护凭据文件禁止通过外部程序直接打开', path: abs };
      }

      const st = fs.statSync(abs);
      isDir = st.isDirectory();
      launchPath = abs;
      launchDir = isDir ? abs : path.dirname(abs);

      if (isWsl && target.isWindowsExe) {
        launchPath = await toWindowsPathFromWsl(abs);
        launchDir = await toWindowsPathFromWsl(isDir ? abs : path.dirname(abs));
      }
    }

    if (/[\x00-\x1f\x7f]/.test(launchPath) || /[\x00-\x1f\x7f]/.test(launchDir)) {
      return { ok: false, error: '路径包含非法控制字符，已拒绝启动' };
    }

    if (target.isBatch && (hasWindowsBatchMeta(launchPath) || hasWindowsBatchMeta(launchDir))) {
      return {
        ok: false,
        error: '路径包含 Windows 批处理元字符 (&|<>^%!")，已拒绝传递给 .cmd/.bat 启动器'
      };
    }

    const spec = buildTargetSpawnSpec(target, launchPath, launchDir, isDir, parsedLC.line, parsedLC.column);
    try {
      if (target.isBatch) {
        if (hasWindowsBatchMeta(spec.bin) || spec.args.some((a) => hasWindowsBatchMeta(a))) {
          return { ok: false, error: '启动参数包含 Windows 批处理元字符，已拒绝执行' };
        }
        if (isWsl) {
          const cmdBin = fs.existsSync('/mnt/c/Windows/System32/cmd.exe') ? '/mnt/c/Windows/System32/cmd.exe' : 'cmd.exe';
          const winBatchBin = /^\/mnt\/[a-z]\//i.test(spec.bin) ? await toWindowsPathFromWsl(spec.bin) : spec.bin;
          if (hasWindowsBatchMeta(winBatchBin)) {
            return { ok: false, error: '启动参数包含 Windows 批处理元字符，已拒绝执行' };
          }
          // In WSL interop, pass separate clean argv entries to cmd.exe to avoid double-quoted single-arg escaping issues
          await spawnDetachedSafe(
            cmdBin,
            ['/d', '/c', winBatchBin, ...spec.args],
            {
              cwd: spec.cwd || resolveSafeExecCwd({ isWsl: true, homeDir: home }),
              env: resolveWslInteropEnv(process.env, true)
            }
          );
        } else {
          // Node >= 20.12.2 / 22 rejects spawning .cmd/.bat with shell:false (CVE-2024-27980 EINVAL).
          // After strict metachar rejection on bin + all args, invoke cmd.exe explicitly with /d /s /c.
          const cmdBin = process.env.ComSpec || 'cmd.exe';
          const quote = (s) => `"${String(s)}"`;
          const cmdLine = `"${quote(spec.bin)}${spec.args.length ? ' ' + spec.args.map(quote).join(' ') : ''}"`;
          await spawnDetachedSafe(
            cmdBin,
            ['/d', '/s', '/c', cmdLine],
            { ...(spec.cwd ? { cwd: spec.cwd } : {}), ...(process.platform === 'win32' ? { windowsVerbatimArguments: true } : {}) }
          );
        }
      } else {
        const spawnOpts = {};
        if (spec.cwd) {
          spawnOpts.cwd = spec.cwd;
        } else if (isWsl && target.isWindowsExe) {
          spawnOpts.cwd = resolveSafeExecCwd({ isWsl: true, homeDir: home });
        }
        if (isWsl && target.isWindowsExe) {
          spawnOpts.env = resolveWslInteropEnv(process.env, true);
        }
        await spawnDetachedSafe(spec.bin, spec.args, spawnOpts);
      }
      return {
        ok: true,
        targetId: target.id,
        targetName: target.name,
        kind: target.kind,
        path: abs
      };
    } catch (err) {
      return { ok: false, error: `启动 ${target.name} 失败：${err.message}`, path: abs };
    }
  }

  function discoverWslHostIpv4List() {
    if (!isWsl) return [];
    const ips = [];
    const addIp = (raw) => {
      const s = String(raw || '').trim();
      if (net.isIPv4(s) && s !== '127.0.0.1' && s !== '0.0.0.0' && isPrivateOrLocalIp(s) && !ips.includes(s)) {
        ips.push(s);
      }
    };
    try {
      const routeText = fs.readFileSync('/proc/net/route', 'utf8');
      for (const line of routeText.split(/\r?\n/).slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 3 && cols[1] === '00000000' && /^[0-9A-Fa-f]{8}$/.test(cols[2])) {
          const gw = parseInt(cols[2], 16) >>> 0;
          const ip = `${gw & 0xff}.${(gw >>> 8) & 0xff}.${(gw >>> 16) & 0xff}.${(gw >>> 24) & 0xff}`;
          addIp(ip);
        }
      }
    } catch {}
    try {
      const resolvText = fs.readFileSync('/etc/resolv.conf', 'utf8');
      for (const line of resolvText.split(/\r?\n/)) {
        const m = line.match(/^\s*nameserver\s+([^\s#]+)/);
        if (m) addIp(m[1]);
      }
    } catch {}
    return ips;
  }

  function resolveCuaBridgeContext() {
    const wslWinUsers = (isWsl && !isExternalSandboxState) ? getWslWindowsUserDirs() : [];

    // 1. Check whether prism-cua plugin is installed
    const pluginCuaCandidates = [
      path.join(path.dirname(PLUGIN_ROOT), 'prism-cua', 'plugin.json')
    ];
    if (!isExternalSandboxState) {
      pluginCuaCandidates.push(path.join(home, '.gemini', 'config', 'plugins', 'prism-cua', 'plugin.json'));
      for (const u of wslWinUsers) {
        pluginCuaCandidates.push(path.join(u, '.gemini', 'config', 'plugins', 'prism-cua', 'plugin.json'));
      }
    }
    const foundPluginJson = pluginCuaCandidates.find((p) => {
      try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
    });
    const pluginInstalled = Boolean(foundPluginJson);

    // 2. Resolve chrome-bridge directory (prefer Windows %USERPROFILE%\.gemini\antigravity\prism-suite\chrome-bridge on WSL)
    const localBridgeDir = path.join(resolvedAccountStateDir, 'chrome-bridge');
    let chromeBridgeDir = localBridgeDir;
    let chromeBridgeWinDisplay = process.platform === 'win32'
      ? localBridgeDir
      : '%USERPROFILE%\\.gemini\\antigravity\\prism-suite\\chrome-bridge';
    if (isWsl && !isExternalSandboxState) {
      for (const u of wslWinUsers) {
        const winCand = path.join(u, '.gemini', 'antigravity', 'prism-suite', 'chrome-bridge');
        if (fs.existsSync(winCand)) {
          chromeBridgeDir = winCand;
          chromeBridgeWinDisplay = fallbackLinuxToWindowsPath(winCand);
          break;
        }
      }
    }

    // 3. Resolve cua-broker.json (freshest existing non-symlink file across prism-suite / anti-claude / WSL Windows user profile)
    let brokerFile = '';
    const envBrokerPath = typeof process.env.PRISM_CUA_BROKER_FILE === 'string' ? process.env.PRISM_CUA_BROKER_FILE.trim() : '';
    const explicitBrokerInput = cuaBrokerPath || envBrokerPath;
    if (explicitBrokerInput) {
      const explicit = path.resolve(explicitBrokerInput);
      const st = fs.lstatSync(explicit, { throwIfNoEntry: false });
      if (st && st.isFile() && !st.isSymbolicLink()) brokerFile = explicit;
    } else {
      const brokerCandidates = [path.join(resolvedAccountStateDir, 'cua-broker.json')];
      if (!isExternalSandboxState) {
        brokerCandidates.push(path.join(home, '.gemini', 'antigravity', 'anti-claude', 'cua-broker.json'));
        for (const u of wslWinUsers) {
          brokerCandidates.push(path.join(u, '.gemini', 'antigravity', 'prism-suite', 'cua-broker.json'));
          brokerCandidates.push(path.join(u, '.gemini', 'antigravity', 'anti-claude', 'cua-broker.json'));
        }
      }
      let bestMtime = -1;
      for (const cand of brokerCandidates) {
        try {
          const st = fs.lstatSync(cand, { throwIfNoEntry: false });
          if (st && st.isFile() && !st.isSymbolicLink() && st.mtimeMs >= bestMtime) {
            bestMtime = st.mtimeMs;
            brokerFile = cand;
          }
        } catch {}
      }
    }

    return {
      pluginInstalled,
      chromeBridgeDir,
      chromeBridgeWinDisplay,
      brokerFile
    };
  }

  function resolveCuaSettingsFile(ctx) {
    const suiteDir = ctx?.brokerFile ? path.dirname(ctx.brokerFile) : path.dirname(ctx?.chromeBridgeDir || path.join(resolvedAccountStateDir, 'chrome-bridge'));
    return path.join(suiteDir, 'cua-settings.json');
  }

  function readCuaSettings(ctx) {
    const defaults = { schema: 1, mouseMode: 'courteous', toolsEnabled: true };
    try {
      const settingsFile = resolveCuaSettingsFile(ctx);
      const st = fs.lstatSync(settingsFile, { throwIfNoEntry: false });
      if (!st || !st.isFile() || st.isSymbolicLink()) return defaults;
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return {
        schema: 1,
        mouseMode: parsed?.mouseMode === 'strict_virtual' ? 'strict_virtual' : 'courteous',
        toolsEnabled: parsed?.toolsEnabled !== false
      };
    } catch {
      return defaults;
    }
  }

  function writeCuaSettings(ctx, patch = {}) {
    const prev = readCuaSettings(ctx);
    const next = {
      schema: 1,
      mouseMode: patch.mouseMode === 'strict_virtual'
        ? 'strict_virtual'
        : (patch.mouseMode === 'courteous' ? 'courteous' : prev.mouseMode),
      toolsEnabled: typeof patch.toolsEnabled === 'boolean' ? patch.toolsEnabled : prev.toolsEnabled,
      updatedAt: new Date().toISOString()
    };
    try {
      const settingsFile = resolveCuaSettingsFile(ctx);
      const suiteDir = path.dirname(settingsFile);
      fs.mkdirSync(suiteDir, { recursive: true, mode: 0o700 });
      const st = fs.lstatSync(settingsFile, { throwIfNoEntry: false });
      if (!st || (!st.isSymbolicLink() && !st.isDirectory())) {
        const tmp = `${settingsFile}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, settingsFile);
      }
    } catch {}
    return next;
  }

  async function queryHostCuaPluginEnabled() {
    if (isExternalSandboxState) return null;
    const rawAddr = String(process.env.ANTIGRAVITY_LS_ADDRESS || '').trim();
    const csrf = String(process.env.ANTIGRAVITY_CSRF_TOKEN || '').trim();
    if (!rawAddr || !csrf) return null;
    let urlStr;
    try {
      const u = new URL(rawAddr.includes('://') ? rawAddr : `http://${rawAddr}`);
      const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (u.protocol !== 'http:' || (h !== '127.0.0.1' && h !== 'localhost' && h !== '::1')) return null;
      u.pathname = '/exa.language_server_pb.LanguageServerService/GetAllPlugins';
      urlStr = u.toString();
    } catch {
      return null;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 750);
    try {
      const res = await fetch(urlStr, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrf
        },
        body: '{}',
        signal: ac.signal
      });
      if (!res.ok) return null;
      const data = await res.json();
      const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
      for (const p of plugins) {
        const pPath = String(p?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
        const dirName = pPath.split('/').pop() || '';
        if (dirName.toLowerCase() === 'prism-cua' || String(p?.name || '').toLowerCase() === 'prism-cua') {
          return p?.disabled !== true;
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function buildSafeCuaEndpoints(brokerCfg) {
    if (!brokerCfg || typeof brokerCfg !== 'object') return [];
    const rawList = [];
    const pushRaw = (u) => {
      if (typeof u === 'string' && u.trim()) rawList.push(u.trim());
      else if (u && typeof u === 'object' && typeof u.url === 'string' && u.url.trim()) rawList.push(u.url.trim());
    };
    if (Array.isArray(brokerCfg.endpoints)) {
      for (const item of brokerCfg.endpoints) pushRaw(item);
    }
    pushRaw(brokerCfg.url);
    pushRaw(brokerCfg.endpoint);
    pushRaw(brokerCfg.baseUrl);

    const parsedPort = Number(brokerCfg.port);
    if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
      rawList.push(`http://127.0.0.1:${parsedPort}/v1/cua`);
    }

    const loopbackUrls = [];
    const lanUrls = [];
    const seen = new Set();
    const discoveredPorts = new Set();

    const registerCandidate = (rawStr) => {
      let u;
      try {
        u = new URL(rawStr.includes('://') ? rawStr : `http://${rawStr}`);
      } catch {
        return;
      }
      if (u.protocol !== 'http:') return;
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
      if (!isLoopback && !isPrivateOrLocalIp(host)) return;
      if (!u.pathname || u.pathname === '/') {
        u.pathname = '/v1/cua';
      }
      if (u.port) discoveredPorts.add(Number(u.port));
      const href = u.toString();
      if (seen.has(href)) return;
      seen.add(href);
      if (isLoopback) loopbackUrls.push(href);
      else lanUrls.push(href);
    };

    for (const raw of rawList) registerCandidate(raw);

    // Ensure WSL host IP fallback is appended after 127.0.0.1 when running inside WSL2
    if (isWsl && discoveredPorts.size > 0) {
      const hostIps = discoverWslHostIpv4List();
      for (const p of discoveredPorts) {
        if (!Number.isInteger(p) || p <= 0) continue;
        for (const ip of hostIps) {
          registerCandidate(`http://${ip}:${p}/v1/cua`);
        }
      }
    }

    return [...loopbackUrls, ...lanUrls];
  }

  function postJsonLocalHttp(targetUrl, token, bodyObj, timeoutMs = 2400) {
    const MAX_LOCAL_HTTP_BYTES = 2 * 1024 * 1024;
    const payloadStr = JSON.stringify(bodyObj);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payloadStr, 'utf8'))
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['X-Prism-Cua-Token'] = token;
    }

    if (typeof cuaFetch === 'function') {
      return Promise.resolve(cuaFetch(targetUrl, { method: 'POST', headers, body: payloadStr }))
        .then(async (r) => {
          const txt = typeof r?.text === 'function' ? await r.text() : JSON.stringify(r || {});
          if (Buffer.byteLength(txt, 'utf8') > MAX_LOCAL_HTTP_BYTES) {
            throw Object.assign(new Error('Local HTTP response body exceeds 2MB limit'), { code: 'RESPONSE_TOO_LARGE' });
          }
          return { status: Number(r?.status) || 200, data: JSON.parse(txt) };
        });
    }

    return new Promise((resolve, reject) => {
      const u = new URL(targetUrl);
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(val);
      };

      const req = http.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 80,
          path: `${u.pathname}${u.search}`,
          method: 'POST',
          headers,
          timeout: timeoutMs
        },
        (res) => {
          const declaredLen = Number(res.headers?.['content-length']);
          if (Number.isFinite(declaredLen) && declaredLen > MAX_LOCAL_HTTP_BYTES) {
            clearTimeout(timer);
            try { res.destroy(); } catch {}
            done(Object.assign(new Error(`Local HTTP response body exceeds 2MB limit (${declaredLen} bytes)`), { code: 'RESPONSE_TOO_LARGE' }));
            return;
          }
          const chunks = [];
          let totalBytes = 0;
          res.on('data', (chunk) => {
            if (settled) return;
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > MAX_LOCAL_HTTP_BYTES) {
              clearTimeout(timer);
              try { res.destroy(); } catch {}
              done(Object.assign(new Error('Local HTTP response body exceeds 2MB limit'), { code: 'RESPONSE_TOO_LARGE' }));
              return;
            }
            chunks.push(buf);
          });
          res.on('error', (err) => {
            clearTimeout(timer);
            done(err);
          });
          res.on('end', () => {
            if (settled) return;
            clearTimeout(timer);
            const rawText = Buffer.concat(chunks, totalBytes).toString('utf8');
            try {
              const parsed = rawText ? JSON.parse(rawText) : {};
              done(null, { status: res.statusCode || 200, data: parsed });
            } catch (err) {
              done(new Error(`Invalid Broker JSON (${res.statusCode}): ${err.message}`));
            }
          });
        }
      );

      const timer = setTimeout(() => {
        try { req.destroy(new Error('Broker HTTP timeout')); } catch {}
        done(new Error('Broker HTTP timeout'));
      }, timeoutMs);

      req.on('error', (err) => {
        clearTimeout(timer);
        done(err);
      });
      req.on('close', () => clearTimeout(timer));
      req.write(payloadStr);
      req.end();
    });
  }

  async function callCuaBrokerAction(action, payload = {}, { timeoutMs = 2400 } = {}) {
    const ctx = resolveCuaBridgeContext();
    if (!ctx.brokerFile) {
      return { reachable: false, ctx, error: '未检测到运行中的 CUA 守护进程配置 (cua-broker.json)' };
    }
    let brokerCfg;
    try {
      brokerCfg = JSON.parse(fs.readFileSync(ctx.brokerFile, 'utf8'));
    } catch {
      return { reachable: false, ctx, error: 'cua-broker.json 解析失败或正在重写' };
    }
    const endpoints = buildSafeCuaEndpoints(brokerCfg);
    if (!endpoints.length) {
      return { reachable: false, ctx, error: 'cua-broker.json 未包含有效的本地端点' };
    }
    const token = String(brokerCfg.token || brokerCfg.authToken || brokerCfg.secret || '').trim();
    const bodyObj = payload && Object.keys(payload).length > 0 ? { action, payload } : { action, payload: {} };

    let lastErr = '';
    for (const ep of endpoints) {
      try {
        const res = await postJsonLocalHttp(ep, token, bodyObj, timeoutMs);
        if (res.status >= 200 && res.status < 500 && res.data && typeof res.data === 'object') {
          return { reachable: true, ctx, endpoint: ep, status: res.status, data: res.data };
        }
        lastErr = `HTTP ${res.status}`;
      } catch (err) {
        lastErr = String(err?.message || err);
      }
    }
    return { reachable: false, ctx, error: lastErr || 'CUA 守护进程离线' };
  }

  function normalizeCuaControlState(rawData) {
    const raw = String(
      rawData?.controlState ??
      rawData?.mode ??
      rawData?.state ??
      rawData?.lease?.mode ??
      ''
    ).trim().toLowerCase();

    if (
      rawData?.humanRequired ||
      rawData?.awaitingHuman ||
      /^(?:paused_handoff|human_wait|awaiting_human|takeover|paused|captcha)$/.test(raw)
    ) {
      return { controlState: 'human_wait', stateLabelZh: '等待人工接管' };
    }
    if (/^(?:armed_interactive|act|acting|armed|active|control|input|desktop_act)$/.test(raw)) {
      return { controlState: 'act', stateLabelZh: '键鼠操控中' };
    }
    if (/^(?:armed_readonly|observe|observing|readonly|read_only|observe_only)$/.test(raw)) {
      return { controlState: 'observe', stateLabelZh: '只读观察' };
    }
    return { controlState: 'locked', stateLabelZh: '未授权锁定' };
  }

  function readUiHtml(uri) {
    const envPath = uri === INLINE_URI ? process.env.PRISM_FILES_INLINE_HTML : process.env.PRISM_FILES_APP_HTML;
    const fp = envPath ? path.resolve(envPath) : path.join(PLUGIN_ROOT, 'ui', uri === INLINE_URI ? 'inline.html' : 'app.html');
    return fs.readFileSync(fp, 'utf8');
  }

  const TOOLS = [
    {
      name: 'show_files_inline',
      title: '内联文件卡片',
      description: 'Render an interactive inline file card list in the conversation so the user can open files in Antigravity native tabs, launch local editors/terminals, or double-click to reveal them in Windows Explorer / macOS Finder.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Optional short heading for the file card (e.g. "本次交付物")' },
          baseDir: { type: 'string', description: 'Optional base directory for relative display paths' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of absolute file or directory paths to display'
          }
        },
        required: ['files']
      },
      _meta: {
        ui: { resourceUri: INLINE_URI }
      }
    },
    {
      name: 'open_prism_files',
      title: 'Prism 工作台',
      description: 'Open the Prism workbench in the side pane or sidebar for workspace file tree browsing, live code/Markdown/image preview & safe editing, selection quoting to AI, recent brain artifacts, cross-session transcript search, Model Hub (T1-T4 cross-vendor gateway), opt-in primary/backup account relay, dual-mode SQLite FTS5 handoff memory, Upstream Radar, and Computer Control (CUA) dashboard.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional initial directory path' },
          tab: { type: 'string', enum: ['browse', 'artifacts', 'pins', 'search', 'models', 'accounts', 'cua'], description: 'Optional initial tab' },
          selectFile: { type: 'string', description: 'Optional file path to preview immediately' }
        }
      },
      _meta: {
        ui: { resourceUri: APP_URI },
        'com.google.antigravity/ui': {
          entrypoints: [
            { type: 'aux_pane', title: 'Prism 工作台' },
            { type: 'global', title: 'Prism 工作台' }
          ]
        }
      }
    },
    {
      name: 'list_directory',
      description: 'App-only: list directory contents',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string' },
          showHidden: { type: 'boolean' },
          query: { type: 'string' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'read_file_preview',
      description: 'App-only: read bounded text or image preview for a file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'save_file_content',
      description: 'App-only: save edited text file with SHA-256 / mtime optimistic lock',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          expectedMtimeMs: { type: 'number' },
          baseHash: { type: 'string' }
        },
        required: ['path', 'content']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'list_recent_artifacts',
      description: 'App-only: list recent Antigravity brain artifacts',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number' } }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'reveal_in_explorer',
      description: 'App-only: reveal a file or folder in the native OS file manager (Windows Explorer / WSL / macOS Finder / Linux)',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'get_state',
      description: 'App-only: read persisted plugin preferences and pins',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'update_state',
      description: 'App-only: update persisted plugin preferences and pins',
      inputSchema: {
        type: 'object',
        properties: {
          pinnedPaths: { type: 'array', items: { type: 'string' } },
          lastPath: { type: 'string' },
          lastTab: { type: 'string', enum: ['browse', 'artifacts', 'pins', 'search', 'models', 'accounts', 'cua'] },
          showHidden: { type: 'boolean' },
          doubleClickAction: { type: 'string', enum: ['reveal', 'open_tab'] },
          allowLanSmb: { type: 'boolean' },
          dismissedGuides: { type: 'array', items: { type: 'string' } }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'list_open_targets',
      description: 'App-only: list auto-detected local editors and terminals for "Open With"',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'open_with_target',
      description: 'App-only: open a local file or directory in a whitelisted local editor or terminal',
      inputSchema: {
        type: 'object',
        properties: {
          targetId: { type: 'string' },
          path: { type: 'string' },
          line: { type: 'number' },
          column: { type: 'number' }
        },
        required: ['targetId', 'path']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'prism_memory_store',
      title: '写入槽位交接记忆',
      description: 'Store a sanitized 4-element slot handoff memory (project/slot tags, cwd, git status, verified progress, next action) in Prism local JSONL store. Secrets/tokens are redacted automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project identifier (e.g. anti-claude-prism-suite)' },
          slot: { type: 'string', description: 'Task slot name (e.g. default, v05-relay, bugfix)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional extra tags' },
          summary: { type: 'string', description: 'Concise 1-line summary' },
          cwd: { type: 'string', description: 'Working directory or worktree path' },
          gitBranch: { type: 'string', description: 'Git branch name' },
          gitHead: { type: 'string', description: 'Short Git commit hash' },
          gitDirtyCount: { type: 'number', description: 'Uncommitted file count' },
          conversationPath: { type: 'string', description: 'Conversation URI or /c/<id>' },
          verified: { type: 'string', description: 'Verified evidence / completed checks' },
          nextAction: { type: 'string', description: 'Immediate next action after resume' },
          content: { type: 'string', description: 'Optional detailed notes (redacted before save)' }
        }
      }
    },
    {
      name: 'prism_memory_list',
      title: '列出槽位交接记忆',
      description: 'List slot handoff memories strictly ordered newest-first by timestamp so stale milestones never shadow latest progress.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Optional project filter' },
          slot: { type: 'string', description: 'Optional slot filter' },
          tag: { type: 'string', description: 'Optional exact tag filter (e.g. handoff:proj:slot)' },
          limit: { type: 'number', description: 'Max entries to return (1-100, default 10)' }
        }
      }
    },
    {
      name: 'prism_memory_search',
      title: '检索槽位交接记忆',
      description: 'Search across sanitized local slot handoff memories by keyword, project, or slot.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords' },
          project: { type: 'string', description: 'Optional project filter' },
          slot: { type: 'string', description: 'Optional slot filter' },
          tag: { type: 'string', description: 'Optional exact tag filter' },
          limit: { type: 'number', description: 'Max entries to return (default 10)' }
        },
        required: ['query']
      }
    },
    {
      name: 'prism_quota_sync',
      title: '同步当前账号额度快照',
      description: 'Sync current active account 5h/7d remaining quota % and reset times to the Prism Workbench Accounts card (zero-risk snapshot only, no credentials touched).',
      inputSchema: {
        type: 'object',
        properties: {
          window5hPct: { type: 'number', description: 'Remaining 5h quota percentage (0-100)' },
          window7dPct: { type: 'number', description: 'Remaining 7d weekly quota percentage (0-100)' },
          reset5hAt: { type: 'string', description: '5h reset ISO timestamp or relative duration like 3h20m' },
          reset7dAt: { type: 'string', description: '7d reset ISO timestamp or relative duration like 4d' },
          rawText: { type: 'string', description: 'Optional raw quota summary text to parse automatically' },
          expectedEmail: { type: 'string', description: 'Optional expected account email to prevent cross-account stale writes' },
          tierName: { type: 'string', description: 'Optional subscription tier label e.g. Pro / Ultra' },
          families: { type: 'object', description: 'Optional per-family summary e.g. { gemini: { pct5h, pct7d }, claude: { pct5h, pct7d } }' }
        }
      }
    },
    {
      name: 'prism_list_models',
      title: '列出可用会诊模型',
      description: 'List configured cross-vendor consultation models in Prism Model Hub grouped by capability tiers (T1 flagship, T2 workhorse, T3 balanced, T4 fast) and ordered by user favorites. Never exposes gateway URLs or API keys.',
      inputSchema: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['T1', 'T2', 'T3', 'T4'], description: 'Optional capability tier filter (T1..T4)' },
          excludeVendor: { type: 'string', description: 'Optional comma-separated vendor family to exclude to avoid same-family self-review (e.g. anthropic, google, openai)' }
        }
      }
    },
    {
      name: 'prism_ask_model',
      title: '跨厂商模型会诊与审查',
      description: 'Consult an external model configured in Prism Model Hub via zero-dependency SSE streaming (supports T1-T4 cross-vendor review, adversarial debate, automatic 1-hop fallback routing, outbound secret redaction, and optional anti-SSRF public web search). Never send raw secrets or credentials.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model ID from prism_list_models (omit to use top ready favorite)' },
          prompt: { type: 'string', description: 'Self-contained question, architecture proposal, or sanitized diff to review' },
          systemPrompt: { type: 'string', description: 'Optional role or review instructions' },
          webSearch: { type: 'boolean', description: 'Enable DNS-pinned public HTTPS web search and append [searched sources]' },
          maxTokens: { type: 'number', description: 'Optional max output tokens' },
          temperature: { type: 'number', description: 'Optional sampling temperature' }
        },
        required: ['prompt']
      }
    },
    {
      name: 'search_transcripts',
      description: 'App-only: cross-session full-text literal search across Antigravity brain transcripts',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          filter: { type: 'string', enum: ['all', 'prose', 'code_cmd'] },
          limit: { type: 'number' }
        },
        required: ['query']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_status',
      description: 'App-only: read opt-in primary/backup account relay status, isolated vault probe, recommendations, and last snapshot',
      inputSchema: {
        type: 'object',
        properties: {
          activeModel: { type: 'string' },
          forceRefresh: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_toggle_enabled',
      description: 'App-only: explicitly enable/disable account relay or persist countdown/auto-relaunch preferences',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          countdownSeconds: { type: 'number' },
          primaryHysteresisPct: { type: 'number' },
          autoRelaunchAfterSwitch: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_capture',
      description: 'App-only: capture the currently active Antigravity credential into isolated OS native vault',
      inputSchema: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['primary', 'backup'] },
          alias: { type: 'string' },
          modelsSupported: { type: 'array', items: { type: 'string' } }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_update',
      description: 'App-only: update metadata/role/priority/quota hints for a captured account slot',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          alias: { type: 'string' },
          role: { type: 'string', enum: ['primary', 'backup'] },
          priority: { type: 'number' },
          modelsSupported: { type: 'array', items: { type: 'string' } },
          quota: { type: 'object' }
        },
        required: ['accountId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_save_snapshot',
      description: 'App-only: create a sanitized 4-element handoff snapshot + memory entry before switching',
      inputSchema: {
        type: 'object',
        properties: {
          slot: { type: 'string' },
          project: { type: 'string' },
          cwd: { type: 'string' },
          conversationPath: { type: 'string' },
          verifiedSummary: { type: 'string' },
          nextAction: { type: 'string' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_switch',
      description: 'App-only: perform dry-run or atomic credential swap to target account slot',
      inputSchema: {
        type: 'object',
        properties: {
          targetId: { type: 'string' },
          dryRun: { type: 'boolean' },
          saveSnapshot: { type: 'boolean' },
          allowUncapturedActive: { type: 'boolean' },
          autoCaptureUncaptured: { type: 'boolean' },
          autoRelaunch: { type: 'boolean' },
          handoff: { type: 'object' }
        },
        required: ['targetId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_relaunch_client',
      description: 'App-only: gracefully close and relaunch Antigravity outside the MCP process tree (preserving debug flags)',
      inputSchema: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_delete',
      description: 'App-only: remove isolated credential backup and metadata for a captured account slot',
      inputSchema: {
        type: 'object',
        properties: { accountId: { type: 'string' } },
        required: ['accountId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'accounts_verify_integrity',
      description: 'App-only: read-only integrity check confirming SQLite/brain isolation and active credential health',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'handoff_memory_list',
      description: 'App-only: list slot handoff memories + formatted sync/resume prompts for UI',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slot: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'handoff_memory_remove',
      description: 'App-only: delete a single slot handoff memory entry from UI',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'check_upstreams',
      description: 'App-only: on-demand Upstream Radar check returning selective adoption candidates (never auto-copies code)',
      inputSchema: {
        type: 'object',
        properties: {
          force: { type: 'boolean' },
          onlyKeys: { type: 'array', items: { type: 'string' } }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'sync_upstream_baseline',
      description: 'App-only: sync upstream.json baseline tag & commit after user finishes selective review/adoption',
      inputSchema: {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' } }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'prism_self_update_check',
      description: 'App-only: check latest official Anti-Claude Prism Suite GitHub Release version and highlights',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'prism_self_update_apply',
      description: 'App-only: download SHA-256 verified official Anti-Claude Prism Suite release and apply in-place update',
      inputSchema: {
        type: 'object',
        properties: {
          force: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'handoff_catalog_upsert',
      description: 'App-only: create or update a catalog:master active slot entry from Workbench UI',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slot: { type: 'string' },
          cwd: { type: 'string' },
          summary: { type: 'string' },
          gitBranch: { type: 'string' },
          activeAccount: { type: 'string' },
          status: { type: 'string' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'handoff_remote_sync',
      description: 'App-only: trigger manual pull/sync from optional remote Streamable-HTTP MCP Memory bridge',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_get_profile',
      description: 'App-only: read redacted public Model Hub & remote memory profile (zero secrets exposed)',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_update_settings',
      description: 'App-only: update global Model Hub, anti-SSRF web search, and remote memory bridge settings',
      inputSchema: {
        type: 'object',
        properties: {
          remoteMemory: {},
          webSearch: {},
          defaultTier: { type: 'string' },
          redactOutboundSecrets: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_upsert_provider',
      description: 'App-only: create or update an OpenAI/Anthropic compatible gateway provider in prism-profile.json',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          preset: { type: 'string' },
          protocol: { type: 'string' },
          baseUrl: { type: 'string' },
          apiKeyEnv: { type: 'string' },
          apiKey: { type: ['string', 'null'] },
          clearVaultKey: { type: 'boolean' },
          allowKeyless: { type: 'boolean' },
          enabled: { type: 'boolean' }
        },
        required: ['id']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_remove_provider',
      description: 'App-only: delete a gateway provider and clean up associated vault secret & models',
      inputSchema: {
        type: 'object',
        properties: { providerId: { type: 'string' } },
        required: ['providerId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_upsert_model',
      description: 'App-only: create or update a T1-T4 model entry in Prism Model Hub',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          alias: { type: 'string' },
          providerId: { type: 'string' },
          upstreamModel: { type: 'string' },
          tier: { type: 'string' },
          vendor: { type: 'string' },
          roleHint: { type: 'string' },
          fallbackModelId: { type: 'string' },
          maxTokens: { type: 'number' },
          favorite: { type: 'boolean' },
          enabled: { type: 'boolean' }
        },
        required: ['id', 'providerId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_remove_model',
      description: 'App-only: remove a model entry from Prism Model Hub',
      inputSchema: {
        type: 'object',
        properties: { modelId: { type: 'string' } },
        required: ['modelId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_reorder_favorites',
      description: 'App-only: persist drag-and-drop favorite model order',
      inputSchema: {
        type: 'object',
        properties: {
          orderedIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['orderedIds']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_probe_speed',
      description: 'App-only: run 1-click TTFT & tok/s SSE latency probe on a configured model',
      inputSchema: {
        type: 'object',
        properties: { modelId: { type: 'string' } },
        required: ['modelId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_discover_models',
      description: 'App-only: fetch available upstream models from a configured gateway /models endpoint and classify T1-T4 tiers',
      inputSchema: {
        type: 'object',
        properties: { providerId: { type: 'string' } },
        required: ['providerId']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_batch_import_models',
      description: 'App-only: idempotently import selected discovered models into Prism Model Hub',
      inputSchema: {
        type: 'object',
        properties: {
          providerId: { type: 'string' },
          items: { type: 'array', items: { type: 'object' } }
        },
        required: ['providerId', 'items']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'model_hub_reveal_profile',
      description: 'App-only: initialize prism-profile.json (0600) if missing and reveal it in native file manager',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_status',
      description: 'App-only: query local CUA Broker status, armed browser tabs, observable desktop windows, and prism-cua installation state',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_revoke',
      description: 'App-only: immediately revoke all active CUA desktop/browser control leases via Broker',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_register_nm',
      description: 'App-only: register Chrome & Edge Native Messaging host (com.prism.cua.bridge) for fixed Extension ID via Broker',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_open_ext_dir',
      description: 'App-only: reveal deployed chrome-bridge unpacked extension directory in Windows Explorer / OS file manager',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_set_mouse_mode',
      description: 'App-only: set CUA virtual mouse routing mode (courteous or strict_virtual) via Broker and local settings',
      inputSchema: {
        type: 'object',
        properties: {
          mouseMode: { type: 'string', enum: ['courteous', 'strict_virtual'] }
        },
        required: ['mouseMode']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'cua_bridge_set_tools_enabled',
      description: 'App-only: toggle whether prism-cua exposes its 3 MCP tools to the AI model (zero-token sleep mode)',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' }
        },
        required: ['enabled']
      },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'plugin_exposure_status',
      description: 'App-only: query fine-grained MCP tool groups, AGENTS.md file-card rule, and bundled Skills exposure status',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { visibility: ['app'] } }
    },
    {
      name: 'plugin_exposure_update',
      description: 'App-only: toggle fine-grained MCP tool groups (fileTools/memoryTools/modelHubTools) and deployed AGENTS.md rule / bundled Skills',
      inputSchema: {
        type: 'object',
        properties: {
          fileTools: { type: 'boolean' },
          memoryTools: { type: 'boolean' },
          modelHubTools: { type: 'boolean' },
          fileCardRule: { type: 'boolean' },
          bundledSkills: { type: 'boolean' }
        }
      },
      _meta: { ui: { visibility: ['app'] } }
    }
  ];

  const FILE_TOOL_NAMES = new Set(['show_files_inline', 'open_prism_files']);
  const MEMORY_TOOL_NAMES = new Set(['prism_memory_store', 'prism_memory_list', 'prism_memory_search', 'prism_quota_sync']);
  const MODEL_HUB_TOOL_NAMES = new Set(['prism_list_models', 'prism_ask_model']);

  function getExposedToolsList() {
    const exp = loadState().mcpExposure || { fileTools: true, memoryTools: true, modelHubTools: true };
    return TOOLS.filter((t) => {
      const vis = t?._meta?.ui?.visibility;
      if (Array.isArray(vis) && vis.includes('app')) return true;
      if (FILE_TOOL_NAMES.has(t.name)) return exp.fileTools !== false;
      if (MEMORY_TOOL_NAMES.has(t.name)) return exp.memoryTools !== false;
      if (MODEL_HUB_TOOL_NAMES.has(t.name)) return exp.modelHubTools !== false;
      return true;
    });
  }

  function resolveDeployedPluginRootForToggle() {
    // Only mutate rules/ or skills/ on deployed plugin copies (never inside git repo source tree)
    if (fs.existsSync(path.join(PLUGIN_ROOT, '..', '.git'))) {
      const deployedCand = path.join(home, '.gemini', 'config', 'plugins', 'prism-files');
      return fs.existsSync(path.join(deployedCand, 'plugin.json')) ? deployedCand : '';
    }
    return path.basename(PLUGIN_ROOT).toLowerCase() === 'prism-files' ? PLUGIN_ROOT : '';
  }

  function getPluginExposureSnapshot() {
    const st = loadState();
    const exp = normalizeMcpExposure(st.mcpExposure);
    const deployedRoot = resolveDeployedPluginRootForToggle();
    const checkRoot = deployedRoot || PLUGIN_ROOT;
    const ruleActive = fs.existsSync(path.join(checkRoot, 'rules', 'AGENTS.md'));
    const skillsActive = fs.existsSync(path.join(checkRoot, 'skills'));
    const activeMcpCount = (exp.fileTools ? 2 : 0) + (exp.memoryTools ? 4 : 0) + (exp.modelHubTools ? 2 : 0);
    return {
      ok: true,
      mcpExposure: exp,
      fileCardRule: ruleActive,
      bundledSkills: skillsActive,
      canToggleFilesOnDisk: Boolean(deployedRoot),
      activeMcpCount
    };
  }

  async function handleToolCall(name, args = {}) {
    const exp = loadState().mcpExposure || { fileTools: true, memoryTools: true, modelHubTools: true };
    if (
      (name === 'show_files_inline' && exp.fileTools === false) ||
      (MEMORY_TOOL_NAMES.has(name) && exp.memoryTools === false) ||
      (MODEL_HUB_TOOL_NAMES.has(name) && exp.modelHubTools === false)
    ) {
      return {
        isError: true,
        content: [{ type: 'text', text: `工具 ${name} 已在 Prism「上下文精简开关」中停用` }],
        structuredContent: { ok: false, code: 'TOOL_GROUP_DISABLED', tool: name }
      };
    }

    if (name === 'show_files_inline') {
      const files = Array.isArray(args.files) ? args.files.filter((f) => typeof f === 'string' && f.trim()).slice(0, 40) : [];
      const baseDir = args.baseDir ? expandUserPath(args.baseDir) : '';
      const items = files.map((f) => buildFileItem(expandUserPath(f), baseDir));
      const title = String(args.title || (items.length === 1 ? '文件定位卡片' : `文件卡片 (${items.length})`)).trim();
      return {
        content: [
          {
            type: 'text',
            text: `已展示 ${items.length} 个文件的交互卡片（双击或点「定位」可在 ${platformLabel} 中高亮打开）：\n` +
              items.map((it) => `- ${it.path}`).join('\n')
          }
        ],
        structuredContent: { title, items, platformLabel }
      };
    }

    if (name === 'open_prism_files') {
      const state = loadState();
      const safeDefaultDir = path.resolve(defaultRoot || home);
      const fallbackDir = state.lastPath && !isUncPathString(state.lastPath) && fs.existsSync(state.lastPath)
        ? state.lastPath
        : safeDefaultDir;
      const warnings = [];
      let initDir = fallbackDir;
      let initDirPrevalidated = false;

      if (args.dir) {
        const dirUnc = await guardUncAccessIfNeeded(args.dir);
        if (!dirUnc.ok) {
          warnings.push(dirUnc.error);
          initDir = safeDefaultDir;
        } else if (dirUnc.isUnc) {
          const wslResolved = await resolveWslUncPathForFs(dirUnc);
          if (!wslResolved.ok) {
            warnings.push(wslResolved.error);
            initDir = safeDefaultDir;
          } else {
            initDir = wslResolved.path;
            initDirPrevalidated = !wslResolved.convertedToLocal;
          }
        } else {
          initDir = expandUserPath(args.dir, fallbackDir);
        }
      } else if (state.lastPath && isUncPathString(state.lastPath)) {
        const lastUnc = await guardUncAccessIfNeeded(state.lastPath);
        if (lastUnc.ok) {
          const wslResolved = await resolveWslUncPathForFs(lastUnc);
          if (wslResolved.ok) {
            initDir = wslResolved.path;
            initDirPrevalidated = !wslResolved.convertedToLocal;
          }
        }
      }

      let selectFile = '';
      if (args.selectFile) {
        const selUnc = await guardUncAccessIfNeeded(args.selectFile);
        if (!selUnc.ok) {
          warnings.push(selUnc.error);
        } else if (selUnc.isUnc) {
          const wslSel = await resolveWslUncPathForFs(selUnc);
          if (!wslSel.ok) {
            warnings.push(wslSel.error);
          } else {
            selectFile = wslSel.path;
          }
        } else {
          selectFile = expandUserPath(args.selectFile);
        }
      }

      const listing = listDirectoryInternal(initDir, state.showHidden, '', { uncPrevalidated: initDirPrevalidated });
      const tab = VALID_TABS.has(args.tab) ? args.tab : (RESTORABLE_TABS.has(state.lastTab) ? state.lastTab : 'browse');
      const warning = warnings.join('；');
      const textMsg = warning
        ? `已打开 Prism 工作台（安全提示：${warning}；已回退至安全目录：${listing.dir || initDir}）`
        : `已打开 Prism 工作台（当前目录：${listing.dir || initDir}）`;
      return {
        content: [{ type: 'text', text: textMsg }],
        structuredContent: {
          tab,
          state,
          listing,
          selectFile,
          ...(warning ? { warning } : {}),
          brainDir,
          homeDir: home,
          platformLabel
        }
      };
    }

    if (name === 'list_directory') {
      const uncCheck = await guardUncAccessIfNeeded(args.dir);
      if (!uncCheck.ok) {
        const errRes = { ok: false, error: uncCheck.error, dir: String(args.dir || ''), entries: [] };
        return { content: [{ type: 'text', text: JSON.stringify(errRes) }], structuredContent: errRes };
      }
      let dirArg = args.dir;
      let uncPrevalidated = false;
      if (uncCheck.isUnc) {
        const wslResolved = await resolveWslUncPathForFs(uncCheck);
        if (!wslResolved.ok) {
          const errRes = { ok: false, error: wslResolved.error, dir: uncCheck.normalizedPath, entries: [] };
          return { content: [{ type: 'text', text: JSON.stringify(errRes) }], structuredContent: errRes };
        }
        dirArg = wslResolved.path;
        uncPrevalidated = !wslResolved.convertedToLocal;
      }
      const res = listDirectoryInternal(dirArg, Boolean(args.showHidden), args.query || '', { uncPrevalidated });
      return { content: [{ type: 'text', text: JSON.stringify(res) }], structuredContent: res };
    }

    if (name === 'read_file_preview') {
      const uncCheck = await guardUncAccessIfNeeded(args.path);
      if (!uncCheck.ok) {
        const errRes = { ok: false, error: uncCheck.error, path: String(args.path || '') };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
      let pathArg = args.path;
      let uncPrevalidated = false;
      if (uncCheck.isUnc) {
        const wslResolved = await resolveWslUncPathForFs(uncCheck);
        if (!wslResolved.ok) {
          const errRes = { ok: false, error: wslResolved.error, path: uncCheck.normalizedPath };
          return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
        }
        pathArg = wslResolved.path;
        uncPrevalidated = !wslResolved.convertedToLocal;
      }
      const res = readFilePreviewInternal(pathArg, { uncPrevalidated });
      return { content: [{ type: 'text', text: res.ok ? `Loaded ${res.name}` : res.error }], structuredContent: res };
    }

    if (name === 'save_file_content') {
      const uncCheck = await guardUncAccessIfNeeded(args.path);
      if (!uncCheck.ok) {
        const errRes = { ok: false, error: uncCheck.error };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
      let pathArg = args.path;
      let uncPrevalidated = false;
      if (uncCheck.isUnc) {
        const wslResolved = await resolveWslUncPathForFs(uncCheck);
        if (!wslResolved.ok) {
          const errRes = { ok: false, error: wslResolved.error };
          return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
        }
        pathArg = wslResolved.path;
        uncPrevalidated = !wslResolved.convertedToLocal;
      }
      const res = saveFileContentInternal(
        pathArg,
        args.content,
        args.expectedMtimeMs,
        args.baseHash || '',
        { uncPrevalidated }
      );
      return { content: [{ type: 'text', text: res.ok ? `Saved ${res.path}` : res.error }], structuredContent: res };
    }

    if (name === 'list_recent_artifacts') {
      const res = listRecentArtifacts(args.limit);
      return { content: [{ type: 'text', text: `Found ${res.items.length} recent artifacts` }], structuredContent: res };
    }

    if (name === 'reveal_in_explorer') {
      const res = await revealInExplorer(args.path);
      return { content: [{ type: 'text', text: res.ok ? `Revealed ${res.path}` : res.error }], structuredContent: res };
    }

    if (name === 'get_state') {
      const state = loadState();
      const pinnedItems = state.pinnedPaths.map((p) => buildFileItem(p));
      const res = { ok: true, state, pinnedItems, homeDir: home, brainDir, platformLabel };
      return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: res };
    }

    if (name === 'update_state') {
      const state = saveState(args || {});
      const pinnedItems = state.pinnedPaths.map((p) => buildFileItem(p));
      const res = { ok: true, state, pinnedItems, homeDir: home, brainDir, platformLabel };
      return { content: [{ type: 'text', text: JSON.stringify(state) }], structuredContent: res };
    }

    if (name === 'list_open_targets') {
      const res = listOpenTargets();
      return { content: [{ type: 'text', text: `Detected ${res.targets.length} open targets` }], structuredContent: res };
    }

    if (name === 'open_with_target') {
      const res = await openWithTarget({
        targetId: args.targetId,
        path: args.path,
        line: args.line,
        column: args.column
      });
      return { content: [{ type: 'text', text: res.ok ? `Opened with ${res.targetName}` : res.error }], structuredContent: res };
    }

    if (name === 'search_transcripts') {
      const res = searchTranscripts({
        query: args.query,
        filter: args.filter || 'all',
        limit: args.limit,
        brainDir
      });
      return { content: [{ type: 'text', text: `Found ${res.results.length} matches` }], structuredContent: res };
    }

    if (name === 'prism_memory_store') {
      const entry = handoffMemory.store({
        project: args.project,
        slot: args.slot,
        tags: args.tags,
        summary: args.summary,
        cwd: args.cwd || defaultRoot,
        gitBranch: args.gitBranch,
        gitHead: args.gitHead,
        gitDirtyCount: args.gitDirtyCount,
        conversationPath: args.conversationPath,
        verified: args.verified,
        nextAction: args.nextAction,
        content: args.content,
        source: args.source || 'mcp-model',
        tainted: Boolean(args.tainted)
      });
      const res = {
        ok: true,
        entry,
        externalMemoryPrompt: handoffMemory.formatExternalMemoryStorePrompt(entry)
      };
      return {
        content: [{ type: 'text', text: `已写入脱敏交接记忆 ${entry.slotTag} (${entry.id})：${entry.summary}` }],
        structuredContent: res
      };
    }

    if (name === 'prism_memory_list') {
      const cleanTag = String(args.tag || '').trim().toLowerCase();
      if (cleanTag === 'catalog:master' && typeof handoffMemory.getMasterCatalog === 'function') {
        const cat = handoffMemory.getMasterCatalog({
          project: args.project || '',
          limit: args.limit || 20
        });
        const text = cat.slots.length
          ? cat.slots.map((s) => `- [${s.slotTag}] (${s.updatedAt}) 目录: ${s.cwd || '-'} | 摘要: ${s.summary || '-'}`).join('\n')
          : '暂无已登记的 catalog:master 主目录槽位';
        return {
          content: [{ type: 'text', text }],
          structuredContent: cat
        };
      }
      const res = handoffMemory.list({
        project: args.project || '',
        slot: args.slot || '',
        tag: args.tag || '',
        limit: args.limit || 10
      });
      const summaryText = res.entries.length
        ? res.entries.map((e) => `- [${e.slotTag}] (${e.createdAt}) ${e.summary}${e.nextAction ? ` | 下一步: ${e.nextAction}` : ''}`).join('\n')
        : '暂无匹配的槽位交接记忆';
      return {
        content: [{ type: 'text', text: summaryText }],
        structuredContent: res
      };
    }

    if (name === 'prism_memory_search') {
      const res = handoffMemory.search({
        query: args.query,
        project: args.project || '',
        slot: args.slot || '',
        tag: args.tag || '',
        limit: args.limit || 10
      });
      const summaryText = res.entries.length
        ? res.entries.map((e) => `- [${e.slotTag}] (${e.createdAt}) ${e.summary}`).join('\n')
        : `未检出匹配 "${args.query}" 的交接记忆`;
      return {
        content: [{ type: 'text', text: summaryText }],
        structuredContent: res
      };
    }

    if (name === 'prism_quota_sync') {
      const res = accountManager.syncActiveAccountQuota(args || {});
      return {
        content: [{ type: 'text', text: res.ok ? `已同步「${res.alias || res.email}」额度快照` : res.error }],
        structuredContent: res
      };
    }

    if (name === 'prism_list_models') {
      const catalog = modelHub.listModelsForMcp({
        tier: args.tier || '',
        excludeVendor: args.excludeVendor || ''
      });
      if (!catalog.models.length) {
        return {
          content: [{
            type: 'text',
            text: '当前 Prism Model Hub 尚未配置可用会诊模型；请打开 Prism 工作台切换至「模型中枢」页签添加网关与模型。'
          }],
          structuredContent: catalog
        };
      }
      const lines = [];
      if (catalog.favorites.length) {
        lines.push('Favorites (优先推荐):');
        for (const m of catalog.favorites) {
          lines.push(`- ${m.id} (${m.alias}) [${m.tier} · ${m.vendor}${m.ready ? '' : ' · 待配Key'}]${m.roleHint ? ` — ${m.roleHint}` : ''}`);
        }
      }
      for (const tk of ['T1', 'T2', 'T3', 'T4']) {
        const grp = catalog.tiers?.[tk];
        if (!grp || !grp.models?.length) continue;
        lines.push(`${grp.title}:`);
        for (const m of grp.models) {
          const spd = m.lastSpeed?.ok && m.lastSpeed.ttftMs !== null ? ` (TTFT ${m.lastSpeed.ttftMs}ms)` : '';
          lines.push(`- ${m.id} (${m.alias}) [${m.vendor}${m.hasFallback ? ' · 含备用降级' : ''}${m.ready ? '' : ' · 待配Key'}]${spd}`);
        }
      }
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: catalog
      };
    }

    if (name === 'prism_ask_model') {
      const askRes = await modelHub.askModel({
        model: args.model || '',
        prompt: args.prompt,
        systemPrompt: args.systemPrompt || '',
        webSearch: args.webSearch,
        maxTokens: args.maxTokens,
        temperature: args.temperature
      });
      const fbBanner = askRes.usedFallback
        ? `[answered by ${askRes.actualModelId} (fallback from ${askRes.requestedModelId}: ${askRes.fallbackReason}) | TTFT ${askRes.ttftMs}ms | ${askRes.totalMs}ms]\n`
        : `[answered by ${askRes.actualModelId} (${askRes.tier}/${askRes.vendor}) | TTFT ${askRes.ttftMs}ms | ${askRes.totalMs}ms]\n`;
      return {
        content: [{ type: 'text', text: `${fbBanner}${askRes.text}` }],
        structuredContent: {
          ok: true,
          requestedModelId: askRes.requestedModelId,
          actualModelId: askRes.actualModelId,
          usedFallback: askRes.usedFallback,
          fallbackReason: askRes.fallbackReason,
          tier: askRes.tier,
          vendor: askRes.vendor,
          ttftMs: askRes.ttftMs,
          totalMs: askRes.totalMs,
          redactedPrompt: askRes.redactedPrompt,
          searchedSources: askRes.searchedSources
        }
      };
    }

    if (name === 'accounts_status') {
      const res = accountManager.getStatus({
        activeModel: args.activeModel || '',
        forceRefresh: Boolean(args.forceRefresh)
      });
      return { content: [{ type: 'text', text: `Accounts enabled=${res.enabled}, count=${res.accounts.length}` }], structuredContent: res };
    }

    if (name === 'accounts_toggle_enabled') {
      const state = accountManager.setEnabled(
        args.enabled === undefined ? undefined : Boolean(args.enabled),
        {
          countdownSeconds: args.countdownSeconds,
          primaryHysteresisPct: args.primaryHysteresisPct,
          autoRelaunchAfterSwitch: args.autoRelaunchAfterSwitch
        }
      );
      const res = { ok: true, state };
      return { content: [{ type: 'text', text: `Account relay enabled=${state.enabled}` }], structuredContent: res };
    }

    if (name === 'accounts_capture') {
      try {
        const res = accountManager.captureCurrentAccount({
          role: args.role,
          alias: args.alias || '',
          modelsSupported: args.modelsSupported || []
        });
        return { content: [{ type: 'text', text: `Captured ${res.account.email} as ${res.account.role}` }], structuredContent: res };
      } catch (err) {
        const errRes = { ok: false, code: err?.code || 'CAPTURE_FAILED', error: String(err?.message || err) };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
    }

    if (name === 'accounts_update') {
      try {
        const res = accountManager.updateAccount(args.accountId, {
          alias: args.alias,
          role: args.role,
          priority: args.priority,
          modelsSupported: args.modelsSupported,
          quota: args.quota
        });
        return { content: [{ type: 'text', text: `Updated ${res.account.id}` }], structuredContent: res };
      } catch (err) {
        const errRes = { ok: false, code: err?.code || 'UPDATE_FAILED', error: String(err?.message || err) };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
    }

    if (name === 'accounts_save_snapshot') {
      const res = accountManager.saveHandoffSnapshot({
        slot: args.slot || 'default',
        project: args.project || '',
        cwd: args.cwd || defaultRoot,
        conversationPath: args.conversationPath || '',
        verifiedSummary: args.verifiedSummary || '',
        nextAction: args.nextAction || ''
      });
      return { content: [{ type: 'text', text: `Saved snapshot ${res.snapshot.slotTag}` }], structuredContent: res };
    }

    if (name === 'accounts_switch') {
      try {
        const res = accountManager.switchAccount(args.targetId, {
          dryRun: Boolean(args.dryRun),
          saveSnapshot: args.saveSnapshot !== false,
          allowUncapturedActive: Boolean(args.allowUncapturedActive),
          autoCaptureUncaptured: Boolean(args.autoCaptureUncaptured),
          handoff: { cwd: defaultRoot, ...(args.handoff || {}) }
        });
        if (res.ok && !res.dryRun && !res.alreadyActive && args.autoRelaunch) {
          let relaunchRes = null;
          try {
            relaunchRes = clientRelauncher.scheduleRelaunch({ dryRun: false, delayMs: 650 });
          } catch (rErr) {
            relaunchRes = { ok: false, scheduled: false, error: String(rErr?.message || rErr) };
          }
          res.relaunch = relaunchRes;
          if (relaunchRes?.ok && relaunchRes?.scheduled) {
            const autoNote = res.autoCapturedActive ? `已自动备份原新号 (${res.autoCapturedActive.email})；` : '';
            res.message = `${autoNote}凭据已安全切换至 ${res.target?.alias || ''} (${res.target?.email || ''})，正在自动重启 Antigravity 生效（保留扩展挂载与原会话回跳）…`;
          } else if (relaunchRes?.error) {
            res.message = `${res.message}（自动重启未拉起：${relaunchRes.error}）`;
          }
        }
        return { content: [{ type: 'text', text: res.message || 'Switched' }], structuredContent: res };
      } catch (err) {
        const errRes = {
          ok: false,
          code: err?.code || 'SWITCH_FAILED',
          rolledBack: Boolean(err?.rolledBack),
          error: String(err?.message || err)
        };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
    }

    if (name === 'accounts_relaunch_client') {
      try {
        if (!args?.dryRun && typeof accountManager.syncPrismPrefsSeed === 'function') {
          try { accountManager.syncPrismPrefsSeed({ writeExtensionSeed: true }); } catch {}
        }
        const r = clientRelauncher.scheduleRelaunch({ dryRun: Boolean(args.dryRun), delayMs: 500 });
        return { content: [{ type: 'text', text: r.message || r.error || 'Relaunch scheduled' }], structuredContent: r };
      } catch (err) {
        const errRes = { ok: false, code: err?.code || 'RELAUNCH_FAILED', error: String(err?.message || err) };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
    }

    if (name === 'accounts_delete') {
      try {
        const res = accountManager.deleteAccount(args.accountId);
        return { content: [{ type: 'text', text: `Deleted backup slot ${res.removed.id}` }], structuredContent: res };
      } catch (err) {
        const errRes = { ok: false, code: err?.code || 'DELETE_FAILED', error: String(err?.message || err) };
        return { content: [{ type: 'text', text: errRes.error }], structuredContent: errRes };
      }
    }

    if (name === 'accounts_verify_integrity') {
      const res = accountManager.verifyDataIntegrity();
      return { content: [{ type: 'text', text: `Verified brain=${res.brainSessionCount}, vault=${res.vaultBackend}` }], structuredContent: res };
    }

    if (name === 'handoff_memory_list') {
      const listRes = handoffMemory.list({
        project: args.project || '',
        slot: args.slot || '',
        limit: args.limit || 20
      });
      const entries = listRes.entries.map((e) => ({
        ...e,
        externalMemoryPrompt: handoffMemory.formatExternalMemoryStorePrompt(e),
        resumePrompt: handoffMemory.formatResumePrompt(e)
      }));
      const catalogSlots = typeof handoffMemory.getMasterCatalog === 'function'
        ? handoffMemory.getMasterCatalog({ limit: 24 }).slots.map((s) => ({
            ...s,
            resumePrompt: handoffMemory.formatResumePrompt({
              slot: s.slot,
              slotTag: s.slotTag,
              createdAt: s.updatedAt,
              cwd: s.cwd,
              verified: s.summary,
              summary: s.summary,
              nextAction: '按最新槽位进度继续'
            })
          }))
        : [];
      const storageInfo = typeof handoffMemory.getStorageInfo === 'function' ? handoffMemory.getStorageInfo() : null;
      const remoteSync = typeof handoffMemory.getRemoteSyncStatus === 'function' ? handoffMemory.getRemoteSyncStatus() : null;
      const res = { ok: true, total: listRes.total, entries, catalogSlots, storageInfo, remoteSync };
      return { content: [{ type: 'text', text: `Listed ${entries.length} memories, ${catalogSlots.length} catalog slots` }], structuredContent: res };
    }

    if (name === 'handoff_catalog_upsert') {
      const slot = handoffMemory.upsertCatalogSlot(args || {});
      const res = { ok: true, slot };
      return { content: [{ type: 'text', text: `Updated catalog slot ${slot.slotTag}` }], structuredContent: res };
    }

    if (name === 'handoff_remote_sync') {
      const syncRes = await handoffMemory.syncRemoteCatalog({ limit: args.limit || 20 });
      const res = {
        ...syncRes,
        remoteSync: typeof handoffMemory.getRemoteSyncStatus === 'function' ? handoffMemory.getRemoteSyncStatus() : null
      };
      return {
        content: [{ type: 'text', text: syncRes.ok ? `Synced ${syncRes.updatedSlots} slots` : (syncRes.error || 'Sync failed') }],
        structuredContent: res
      };
    }

    if (name === 'model_hub_get_profile') {
      const pub = prismProfile.getPublicProfile();
      const res = {
        ok: true,
        ...pub,
        memoryStorage: typeof handoffMemory.getStorageInfo === 'function' ? handoffMemory.getStorageInfo() : null,
        remoteSync: typeof handoffMemory.getRemoteSyncStatus === 'function' ? handoffMemory.getRemoteSyncStatus() : null
      };
      return { content: [{ type: 'text', text: `Loaded Model Hub profile (${pub.models.length} models)` }], structuredContent: res };
    }

    if (name === 'model_hub_update_settings') {
      const settings = prismProfile.updateSettings(args || {});
      const res = {
        ok: true,
        settings,
        profile: prismProfile.getPublicProfile(),
        remoteSync: typeof handoffMemory.getRemoteSyncStatus === 'function' ? handoffMemory.getRemoteSyncStatus() : null
      };
      return { content: [{ type: 'text', text: 'Updated Model Hub settings' }], structuredContent: res };
    }

    if (name === 'model_hub_upsert_provider') {
      const provider = prismProfile.upsertProvider(args || {});
      const res = { ok: true, provider, profile: prismProfile.getPublicProfile() };
      return { content: [{ type: 'text', text: `Saved provider ${provider.id}` }], structuredContent: res };
    }

    if (name === 'model_hub_remove_provider') {
      const out = prismProfile.removeProvider(args.providerId);
      const res = { ok: true, ...out, profile: prismProfile.getPublicProfile() };
      return { content: [{ type: 'text', text: `Removed provider ${out.providerId}` }], structuredContent: res };
    }

    if (name === 'model_hub_upsert_model') {
      const model = prismProfile.upsertModel(args || {});
      const res = { ok: true, model, profile: prismProfile.getPublicProfile() };
      return { content: [{ type: 'text', text: `Saved model ${model.id}` }], structuredContent: res };
    }

    if (name === 'model_hub_remove_model') {
      const out = prismProfile.removeModel(args.modelId);
      const res = { ok: true, ...out, profile: prismProfile.getPublicProfile() };
      return { content: [{ type: 'text', text: `Removed model ${out.modelId}` }], structuredContent: res };
    }

    if (name === 'model_hub_reorder_favorites') {
      const favorites = prismProfile.reorderFavorites(args.orderedIds || []);
      const res = { ok: true, favorites, profile: prismProfile.getPublicProfile() };
      return { content: [{ type: 'text', text: `Reordered ${favorites.length} favorites` }], structuredContent: res };
    }

    if (name === 'model_hub_probe_speed') {
      const probe = await modelHub.probeModelSpeed(args.modelId);
      const res = { ...probe, profile: prismProfile.getPublicProfile() };
      return {
        content: [{ type: 'text', text: probe.ok ? `${probe.modelId}: TTFT ${probe.ttftMs}ms` : `${probe.modelId}: ${probe.error}` }],
        structuredContent: res
      };
    }

    if (name === 'model_hub_discover_models') {
      const disc = await modelHub.discoverProviderModels(args.providerId);
      return {
        content: [{ type: 'text', text: disc.ok ? `Discovered ${disc.total} models` : (disc.error || 'Discovery unavailable') }],
        structuredContent: disc
      };
    }

    if (name === 'model_hub_batch_import_models') {
      const imp = prismProfile.batchImportModels({
        providerId: args.providerId,
        items: Array.isArray(args.items) ? args.items : []
      });
      const res = { ok: true, ...imp, profile: prismProfile.getPublicProfile() };
      return {
        content: [{ type: 'text', text: `Imported ${imp.added} models (${imp.skipped} skipped)` }],
        structuredContent: res
      };
    }

    if (name === 'model_hub_reveal_profile') {
      const pPath = prismProfile.profilePath;
      if (!fs.existsSync(pPath)) {
        prismProfile.updateSettings({});
      }
      const rev = await revealInExplorer(pPath);
      return {
        content: [{ type: 'text', text: rev.ok ? `Revealed ${pPath}` : rev.error }],
        structuredContent: { ...rev, profilePath: pPath }
      };
    }

    if (name === 'handoff_memory_remove') {
      const res = handoffMemory.remove(args.id);
      return { content: [{ type: 'text', text: res.removed ? 'Removed' : 'Not found' }], structuredContent: res };
    }

    if (name === 'check_upstreams') {
      const report = await checkUpstreams({
        configPath: resolvedUpstreamConfigPath,
        fetchImpl: upstreamFetch || globalThis.fetch,
        cacheFile: upstreamCacheFile,
        force: Boolean(args.force),
        onlyKeys: Array.isArray(args.onlyKeys) ? args.onlyKeys : []
      });
      const res = {
        ...report,
        markdown: renderMarkdownReport(report)
      };
      return { content: [{ type: 'text', text: `Upstreams checked: HIGH=${report.summary.high}, MEDIUM=${report.summary.medium}` }], structuredContent: res };
    }

    if (name === 'sync_upstream_baseline') {
      const keys = Array.isArray(args.keys) ? args.keys.filter((k) => typeof k === 'string' && k.trim()) : [];
      const report = await checkUpstreams({
        configPath: resolvedUpstreamConfigPath,
        fetchImpl: upstreamFetch || globalThis.fetch,
        cacheFile: upstreamCacheFile,
        force: true,
        onlyKeys: keys
      });
      const synced = syncUpstreamBaseline(resolvedUpstreamConfigPath, { keys, report });
      if (
        !upstreamConfigPath &&
        synced.updatedKeys.length &&
        path.resolve(resolvedUpstreamConfigPath) === path.join(PLUGIN_ROOT, 'upstream.json')
      ) {
        const siblingRootCfg = path.join(PLUGIN_ROOT, '..', 'upstream.json');
        if (fs.existsSync(siblingRootCfg)) {
          try { fs.copyFileSync(resolvedUpstreamConfigPath, siblingRootCfg); } catch {}
        }
      }
      try { if (fs.existsSync(upstreamCacheFile)) fs.rmSync(upstreamCacheFile, { force: true }); } catch {}
      return {
        content: [{ type: 'text', text: `已同步基线: ${synced.updatedKeys.join(', ') || '(无变更)'}` }],
        structuredContent: synced
      };
    }

    if (name === 'prism_self_update_check') {
      const info = await checkPrismSelfUpdate({
        currentVersion: SERVER_INFO.version,
        fetchImpl: upstreamFetch || globalThis.fetch
      });
      return {
        content: [{ type: 'text', text: info.hasUpdate ? `发现新版本 ${info.latestTag}` : `当前已是最新版本 v${info.currentVersion}` }],
        structuredContent: info
      };
    }

    if (name === 'prism_self_update_apply') {
      const res = await applyPrismSelfUpdate({
        currentVersion: SERVER_INFO.version,
        force: Boolean(args.force),
        pluginDir: path.dirname(PLUGIN_ROOT),
        fetchImpl: upstreamFetch || globalThis.fetch
      });
      return {
        content: [{ type: 'text', text: res.message || `已更新至 ${res.updatedTo}` }],
        structuredContent: res
      };
    }

    if (name === 'cua_bridge_status') {
      const [brokerRes, hostPluginEnabled] = await Promise.all([
        callCuaBrokerAction(
          'status',
          { includeWindows: true, includeArmedTabs: true, refreshWindows: true },
          { timeoutMs: 3800 }
        ),
        queryHostCuaPluginEnabled()
      ]);
      const { ctx } = brokerRes;
      const savedCuaSettings = readCuaSettings(ctx);
      const baseMeta = {
        ok: true,
        pluginInstalled: ctx.pluginInstalled,
        hostPluginEnabled,
        toolsEnabled: savedCuaSettings.toolsEnabled !== false,
        customizationUri: 'customization://prism-cua',
        extensionId: CUA_EXTENSION_ID,
        chromeBridgeDir: ctx.chromeBridgeDir,
        chromeBridgeDisplayPath: ctx.chromeBridgeWinDisplay,
        chromeBridgeInstalled: fs.existsSync(path.join(ctx.chromeBridgeDir, 'manifest.json')),
        hostSupported: process.platform === 'win32' || isWsl
      };

      if (!brokerRes.reachable) {
        const savedMouseMode = savedCuaSettings.mouseMode === 'strict_virtual' ? 'strict_virtual' : 'courteous';
        const offline = {
          ...baseMeta,
          brokerOnline: false,
          controlState: 'locked',
          stateLabelZh: '未授权锁定',
          mouseMode: savedMouseMode,
          remainingSeconds: 0,
          expiresAtMs: 0,
          nmHostRegistered: false,
          nmConnected: false,
          armedTabs: [],
          windows: [],
          offlineReason: brokerRes.error || ''
        };
        return {
          content: [{ type: 'text', text: 'CUA 守护进程未在线' }],
          structuredContent: offline
        };
      }

      const raw = (brokerRes.data && typeof brokerRes.data.result === 'object' && brokerRes.data.result)
        ? brokerRes.data.result
        : ((brokerRes.data && typeof brokerRes.data.status === 'object' && brokerRes.data.status) ? brokerRes.data.status : brokerRes.data);
      const { controlState, stateLabelZh } = normalizeCuaControlState(raw);

      let expiresAtMs = 0;
      const rawExp = raw?.expiresAtMs ?? raw?.leaseExpiresAtMs ?? raw?.lease?.expiresAtMs ?? raw?.expiresAt ?? raw?.leaseExpiresAt ?? raw?.expiresAtIso ?? raw?.armedUntil;
      if (typeof rawExp === 'number' && rawExp > 1e11) {
        expiresAtMs = Math.round(rawExp);
      } else if (typeof rawExp === 'string' && !Number.isNaN(Date.parse(rawExp))) {
        expiresAtMs = Date.parse(rawExp);
      } else if (typeof raw?.remainingMs === 'number' && raw.remainingMs > 0) {
        expiresAtMs = Date.now() + Math.round(raw.remainingMs);
      } else if (typeof raw?.remainingSec === 'number' && raw.remainingSec > 0) {
        expiresAtMs = Date.now() + Math.round(raw.remainingSec * 1000);
      } else if (typeof raw?.remainingSeconds === 'number' && raw.remainingSeconds > 0) {
        expiresAtMs = Date.now() + Math.round(raw.remainingSeconds * 1000);
      }
      const remainingSeconds = expiresAtMs > Date.now() ? Math.ceil((expiresAtMs - Date.now()) / 1000) : 0;

      const online = {
        ...raw,
        ...baseMeta,
        ok: true,
        brokerOnline: true,
        controlState,
        stateLabelZh,
        mouseMode: raw?.mouseMode === 'strict_virtual' ? 'strict_virtual' : 'courteous',
        expiresAtMs,
        remainingSeconds,
        nmHostRegistered: Boolean(raw?.nmHostRegistered ?? raw?.nativeMessagingRegistered ?? raw?.nmRegistered ?? false),
        nmConnected: Boolean(raw?.nmConnected ?? raw?.browserBridgeConnected ?? raw?.extensionConnected ?? false),
        armedTabs: Array.isArray(raw?.armedTabs) ? raw.armedTabs : [],
        windows: Array.isArray(raw?.windows) ? raw.windows : []
      };
      return {
        content: [{ type: 'text', text: `CUA Broker 在线：${stateLabelZh}` }],
        structuredContent: online
      };
    }

    if (name === 'cua_bridge_revoke') {
      const brokerRes = await callCuaBrokerAction('revoke', {}, { timeoutMs: 3500 });
      if (!brokerRes.reachable) {
        const offlineRes = { ok: false, brokerOnline: false, error: brokerRes.error || 'CUA 守护进程未在线，无需或无法吊销授权' };
        return { content: [{ type: 'text', text: offlineRes.error }], structuredContent: offlineRes };
      }
      const raw = brokerRes.data?.result || brokerRes.data || {};
      const out = {
        ...raw,
        ok: raw.ok !== false,
        brokerOnline: true,
        revoked: true,
        message: raw.message || '已立即吊销全部桌面与浏览器操控授权，并恢复锁定状态'
      };
      return { content: [{ type: 'text', text: out.message }], structuredContent: out };
    }

    if (name === 'cua_bridge_register_nm') {
      const brokerRes = await callCuaBrokerAction('register_nm_host', { extensionId: CUA_EXTENSION_ID }, { timeoutMs: 6000 });
      if (!brokerRes.reachable) {
        const offlineRes = {
          ok: false,
          brokerOnline: false,
          extensionId: CUA_EXTENSION_ID,
          error: '未连接 Windows CUA 守护进程；请先在 Windows 宿主启动 Antigravity / 内置守护内核后再注册 Native Messaging 宿主'
        };
        return { content: [{ type: 'text', text: offlineRes.error }], structuredContent: offlineRes };
      }
      const raw = brokerRes.data?.result || brokerRes.data || {};
      const out = {
        ...raw,
        ok: raw.ok !== false,
        brokerOnline: true,
        extensionId: CUA_EXTENSION_ID,
        message: raw.message || `已向当前用户注册表写入 Chrome 与 Edge Native Messaging 宿主 (ID: ${CUA_EXTENSION_ID})`
      };
      return { content: [{ type: 'text', text: out.message }], structuredContent: out };
    }

    if (name === 'cua_bridge_open_ext_dir') {
      const ctx = resolveCuaBridgeContext();
      let targetDir = ctx.chromeBridgeDir;
      if (!fs.existsSync(targetDir)) {
        const repoFallback = path.resolve(PLUGIN_ROOT, '..', 'extensions', 'chrome-cua-bridge');
        if (fs.existsSync(path.join(repoFallback, 'manifest.json'))) {
          targetDir = repoFallback;
        } else {
          const miss = {
            ok: false,
            path: targetDir,
            error: `尚未在 ${ctx.chromeBridgeWinDisplay} 发现已部署的 chrome-bridge 目录；请重新运行一次安装器或一键更新完成部署`
          };
          return { content: [{ type: 'text', text: miss.error }], structuredContent: miss };
        }
      }
      const rev = await revealInExplorer(targetDir);
      return {
        content: [{ type: 'text', text: rev.ok ? `Opened ${targetDir}` : rev.error }],
        structuredContent: {
          ...rev,
          chromeBridgeDir: targetDir,
          extensionId: CUA_EXTENSION_ID
        }
      };
    }

    if (name === 'cua_bridge_set_mouse_mode') {
      const wantMode = String(args?.mouseMode || '').trim().toLowerCase();
      if (wantMode !== 'courteous' && wantMode !== 'strict_virtual') {
        const bad = { ok: false, error: 'mouseMode 仅支持 courteous 或 strict_virtual' };
        return { isError: true, content: [{ type: 'text', text: bad.error }], structuredContent: bad };
      }
      const ctx = resolveCuaBridgeContext();
      writeCuaSettings(ctx, { mouseMode: wantMode });

      const brokerRes = await callCuaBrokerAction('set_mouse_mode', { mouseMode: wantMode }, { timeoutMs: 3500 });
      const labelZh = wantMode === 'strict_virtual'
        ? '严格后台虚拟鼠标（100% 绝不触碰真鼠标）'
        : '智能无感虚拟鼠标（UIA/网页零抢鼠 + 自绘窗空闲礼让归位）';
      const out = {
        ok: true,
        mouseMode: wantMode,
        brokerOnline: Boolean(brokerRes.reachable),
        message: brokerRes.reachable
          ? `已切换虚拟鼠标模式：${labelZh}`
          : `已保存默认鼠标模式（守护唤醒后自动生效）：${labelZh}`
      };
      return { content: [{ type: 'text', text: out.message }], structuredContent: out };
    }

    if (name === 'cua_bridge_set_tools_enabled') {
      if (typeof args?.enabled !== 'boolean') {
        const bad = { ok: false, error: 'enabled 必须为布尔值' };
        return { isError: true, content: [{ type: 'text', text: bad.error }], structuredContent: bad };
      }
      const wantEnabled = Boolean(args.enabled);
      const ctx = resolveCuaBridgeContext();
      const nextSettings = writeCuaSettings(ctx, { toolsEnabled: wantEnabled });
      const hostPluginEnabled = await queryHostCuaPluginEnabled();
      const out = {
        ok: true,
        toolsEnabled: nextSettings.toolsEnabled !== false,
        hostPluginEnabled,
        message: wantEnabled
          ? (hostPluginEnabled === false
              ? '已开启 CUA 工具暴露；注意宿主插件 prism-cua 当前仍处于关闭态，请在左侧栏「技能与自定义 → 插件」打开一次 prism-cua 即可生效'
              : '已开启 AI 电脑操控工具（cua_status / cua_observe / cua_act），新对话或重载插件后模型即可按需调用')
          : '已将 AI 电脑操控工具设为休眠隐藏（日常对话 0 工具 Token 占用）'
      };
      return { content: [{ type: 'text', text: out.message }], structuredContent: out };
    }

    if (name === 'plugin_exposure_status') {
      const snap = getPluginExposureSnapshot();
      return { content: [{ type: 'text', text: `Active MCP tools: ${snap.activeMcpCount}/8` }], structuredContent: snap };
    }

    if (name === 'plugin_exposure_update') {
      const expPatch = {};
      if (typeof args.fileTools === 'boolean') expPatch.fileTools = args.fileTools;
      if (typeof args.memoryTools === 'boolean') expPatch.memoryTools = args.memoryTools;
      if (typeof args.modelHubTools === 'boolean') expPatch.modelHubTools = args.modelHubTools;
      if (Object.keys(expPatch).length > 0) {
        saveState({ mcpExposure: expPatch });
      }

      const deployedRoot = resolveDeployedPluginRootForToggle();
      if (deployedRoot) {
        if (typeof args.fileCardRule === 'boolean') {
          const activeRule = path.join(deployedRoot, 'rules', 'AGENTS.md');
          const disabledRule = path.join(deployedRoot, 'rules', '.AGENTS.md.disabled');
          try {
            if (!args.fileCardRule && fs.existsSync(activeRule)) {
              fs.renameSync(activeRule, disabledRule);
            } else if (args.fileCardRule && !fs.existsSync(activeRule) && fs.existsSync(disabledRule)) {
              fs.renameSync(disabledRule, activeRule);
            }
          } catch {}
        }
        if (typeof args.bundledSkills === 'boolean') {
          const activeSkills = path.join(deployedRoot, 'skills');
          const disabledSkills = path.join(deployedRoot, '.skills-disabled');
          try {
            if (!args.bundledSkills && fs.existsSync(activeSkills)) {
              fs.renameSync(activeSkills, disabledSkills);
            } else if (args.bundledSkills && !fs.existsSync(activeSkills) && fs.existsSync(disabledSkills)) {
              fs.renameSync(disabledSkills, activeSkills);
            }
          } catch {}
        }
      }

      const snap = {
        ...getPluginExposureSnapshot(),
        needsReload: true,
        message: '已保存上下文暴露设置；在插件管理重载一次 prism-files 或重启客户端即可对新对话生效'
      };
      return { content: [{ type: 'text', text: snap.message }], structuredContent: snap };
    }

    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }

  async function handleRpc(req) {
    if (!req || typeof req !== 'object') return null;
    const { id, method, params } = req;
    const isNotification = id === undefined || id === null;

    try {
      if (method === 'initialize') {
        const clientVer = params?.protocolVersion || '2025-06-18';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: clientVer,
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false }
            },
            serverInfo: SERVER_INFO
          }
        };
      }
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        return null;
      }
      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }
      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: getExposedToolsList() } };
      }
      if (method === 'tools/call') {
        const result = await handleToolCall(params?.name, params?.arguments || {});
        return { jsonrpc: '2.0', id, result };
      }
      if (method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: APP_URI,
                name: 'Prism Files Workbench',
                mimeType: APP_MIME_TYPE,
                _meta: { ui: { prefersBorder: false } }
              },
              {
                uri: INLINE_URI,
                name: 'Prism Files Inline Card',
                mimeType: APP_MIME_TYPE,
                _meta: { ui: { prefersBorder: false } }
              }
            ]
          }
        };
      }
      if (method === 'resources/read') {
        const uri = params?.uri;
        if (uri !== APP_URI && uri !== INLINE_URI) {
          throw Object.assign(new Error(`Resource not found: ${uri}`), { code: -32002 });
        }
        const html = readUiHtml(uri);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: APP_MIME_TYPE,
                text: html,
                _meta: { ui: { prefersBorder: false } }
              }
            ]
          }
        };
      }
      if (isNotification) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    } catch (err) {
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: typeof err?.code === 'number' ? err.code : -32000, message: String(err?.message || err) }
      };
    }
  }

  return {
    handleRpc,
    handleToolCall,
    listDirectory,
    readFilePreview,
    saveFileContent,
    listRecentArtifacts,
    revealInExplorer,
    listOpenTargets,
    openWithTarget,
    searchTranscripts: (opts = {}) => searchTranscripts({ ...opts, brainDir }),
    loadState,
    saveState,
    accountManager,
    handoffMemory,
    prismProfile,
    modelHub,
    clientRelauncher,
    close: () => {
      unregisterExitCleanup();
      try { handoffMemory?.close?.(); } catch {}
    }
  };
}

function parseDataDirArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--data_dir=')) return a.slice('--data_dir='.length);
    if (a === '--data_dir' && i + 1 < argv.length) return argv[i + 1];
  }
  return '';
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

function safeProcessCwd(fallback = os.homedir()) {
  try {
    const cur = process.cwd();
    if (cur && fs.existsSync(cur)) return cur;
  } catch {}
  return fallback;
}

if (isMain) {
  const dataDir = parseDataDirArg(process.argv.slice(2));
  const initialCwd = safeProcessCwd(os.homedir());
  const effectiveDefaultRoot = path.resolve(initialCwd) === PLUGIN_ROOT ? os.homedir() : initialCwd;
  // Pin daemon process cwd to user's home dir so plugin updates never orphan cwd and workspace dirs stay unlocked.
  try {
    if (fs.existsSync(os.homedir())) {
      process.chdir(os.homedir());
    }
  } catch {}
  const server = createPrismFilesServer({ dataDir, defaultRoot: effectiveDefaultRoot });
  let buffer = '';

  const sendLine = (obj) => {
    if (!obj) return;
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MAX_STDIN_BUFFER_BYTES) {
      buffer = '';
      return;
    }
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      Promise.resolve(server.handleRpc(parsed))
        .then(sendLine)
        .catch(() => {});
    }
  });
  process.stdin.resume();
}
