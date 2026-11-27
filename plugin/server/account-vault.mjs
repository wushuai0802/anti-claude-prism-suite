/**
 * Isolated OS-native credential vault for Anti-Claude Prism Suite (v0.5.0).
 *
 * Security invariants:
 * - Zero external dependencies, MIT clean-room implementation.
 * - NEVER touches Antigravity local SQLite, ~/.gemini/antigravity/brain/, or workspace files.
 * - Backups live ONLY in OS native credential stores under isolated namespaces:
 *     - Windows: prism-suite:account:<id>
 *     - WSL2:    prism-suite:wsl:<distro>:account:<id>
 *     - macOS:   Keychain service "prism-suite:account:<id>"
 *     - Linux:   libsecret attributes service="prism-suite" account="<id>"
 * - All sensitive data passes via stdin/memory (never argv or plaintext disk temp files).
 * - Credential Buffers are zero-filled in finally blocks and never returned or logged.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ACTIVE_WIN_TARGET = 'gemini:antigravity';
export const PRISM_WIN_PREFIX = 'prism-suite:account:';
export const PRISM_WSL_PREFIX = 'prism-suite:wsl:';
export const PRISM_PROVIDER_PREFIX = 'prism-suite:provider:';
export const WSL_CRED_ENVELOPE_KIND = 'prism-wsl-cred-v1';
export const GO_KEYRING_B64_PREFIX = 'go-keyring-base64:';
const ACCOUNT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,47}$/;
const PROVIDER_SECRET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64_BODY_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

const PS_CREDMAN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PrismWinCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredDeleteW(string target, uint type, uint flags);

  [DllImport("advapi32.dll", SetLastError = false)]
  private static extern void CredFree(IntPtr buffer);

  public static string Read(string target) {
    IntPtr ptr = IntPtr.Zero;
    try {
      if (!CredReadW(target, 1, 0, out ptr)) {
        int err = Marshal.GetLastWin32Error();
        if (err == 1168) return null;
        throw new System.ComponentModel.Win32Exception(err);
      }
      var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      int size = checked((int)cred.CredentialBlobSize);
      if (size <= 0 || cred.CredentialBlob == IntPtr.Zero) return "";
      byte[] buf = new byte[size];
      try {
        Marshal.Copy(cred.CredentialBlob, buf, 0, size);
        return Convert.ToBase64String(buf);
      } finally {
        Array.Clear(buf, 0, buf.Length);
      }
    } finally {
      if (ptr != IntPtr.Zero) CredFree(ptr);
    }
  }

  public static void Write(string target, string blobB64) {
    byte[] buf = Convert.FromBase64String(blobB64 ?? "");
    IntPtr mem = IntPtr.Zero;
    try {
      if (buf.Length > 0) {
        mem = Marshal.AllocHGlobal(buf.Length);
        Marshal.Copy(buf, 0, mem, buf.Length);
      }
      var cred = new CREDENTIAL();
      cred.Type = 1;
      cred.TargetName = target;
      cred.UserName = "prism-suite";
      cred.CredentialBlobSize = checked((uint)buf.Length);
      cred.CredentialBlob = mem;
      cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE (broadest Win10/11 compatibility)
      if (!CredWriteW(ref cred, 0)) {
        int err = Marshal.GetLastWin32Error();
        if (err == 1312 || err == 50) {
          cred.Persist = 3; // CRED_PERSIST_ENTERPRISE fallback
          if (!CredWriteW(ref cred, 0)) {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
          }
        } else {
          throw new System.ComponentModel.Win32Exception(err);
        }
      }
    } finally {
      Array.Clear(buf, 0, buf.Length);
      if (mem != IntPtr.Zero) {
        for (int i = 0; i < buf.Length; i++) Marshal.WriteByte(mem, i, 0);
        Marshal.FreeHGlobal(mem);
      }
    }
  }

  public static bool Delete(string target) {
    if (!CredDeleteW(target, 1, 0)) {
      int err = Marshal.GetLastWin32Error();
      if (err == 1168) return false;
      throw new System.ComponentModel.Win32Exception(err);
    }
    return true;
  }
}
"@
$raw = [Console]::In.ReadToEnd()
$req = ConvertFrom-Json -InputObject $raw
$op = [string]$req.op
function Invoke-PrismCredOp($item) {
  $subOp = [string]$item.op
  if ($subOp -eq 'probe') {
    return @{ ok = $true }
  } elseif ($subOp -eq 'read') {
    $b64 = [PrismWinCred]::Read([string]$item.target)
    if ($null -eq $b64) {
      return @{ ok = $true; found = $false }
    } else {
      return @{ ok = $true; found = $true; blobB64 = $b64 }
    }
  } elseif ($subOp -eq 'write') {
    [PrismWinCred]::Write([string]$item.target, [string]$item.blobB64)
    return @{ ok = $true; written = $true }
  } elseif ($subOp -eq 'delete') {
    $del = [PrismWinCred]::Delete([string]$item.target)
    return @{ ok = $true; deleted = $del }
  } else {
    throw "Unsupported operation: $subOp"
  }
}
if ($op -eq 'batch') {
  $list = New-Object System.Collections.ArrayList
  if ($null -ne $req.ops) {
    foreach ($item in @($req.ops)) {
      [void]$list.Add((Invoke-PrismCredOp $item))
    }
  }
  $arr = $list.ToArray()
  Write-Output (ConvertTo-Json -Compress -Depth 6 @{ ok = $true; results = $arr })
} else {
  $single = Invoke-PrismCredOp $req
  Write-Output (ConvertTo-Json -Compress -Depth 4 $single)
}
`;

const PS_ENCODED_SCRIPT = Buffer.from(PS_CREDMAN_SCRIPT, 'utf16le').toString('base64');

export function sanitizeAccountId(id) {
  const clean = String(id || '').trim().toLowerCase();
  if (!ACCOUNT_ID_RE.test(clean)) {
    throw Object.assign(
      new Error('无效账号槽位 ID：仅允许 2–48 位小写字母、数字、中划线与下划线，且以字母或数字开头'),
      { code: 'INVALID_ACCOUNT_ID' }
    );
  }
  return clean;
}

export function deriveAccountIdFromEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(clean || 'account').digest('hex').slice(0, 8);
  const local = (clean.split('@')[0] || 'acct').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || 'acct';
  let candidate = `${local}-${hash}`;
  if (!/^[a-z0-9]/.test(candidate)) candidate = `a-${candidate}`;
  return sanitizeAccountId(candidate.slice(0, 48));
}

export function fingerprintBuffer(buf) {
  if (!buf || !buf.length) return '';
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function normalizeEmailCandidate(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || /[\s\x00-\x1f<>]/.test(trimmed)) return '';
  const at = trimmed.indexOf('@');
  if (at <= 0 || at >= trimmed.length - 2 || !trimmed.slice(at + 1).includes('.')) return '';
  return trimmed;
}

function tryExtractEmailFromJwt(jwt) {
  if (typeof jwt !== 'string') return '';
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return '';
  let payloadBuf = null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    payloadBuf = Buffer.from(padded, 'base64');
    const obj = JSON.parse(payloadBuf.toString('utf8'));
    return normalizeEmailCandidate(obj?.email || obj?.preferred_username || obj?.upn || '');
  } catch {
    return '';
  } finally {
    if (payloadBuf) payloadBuf.fill(0);
  }
}

function hashRefreshSecret(secret) {
  if (typeof secret !== 'string') return '';
  const clean = secret.trim();
  if (!clean) return '';
  const buf = Buffer.from(clean, 'utf8');
  try {
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12).toLowerCase();
  } finally {
    buf.fill(0);
  }
}

function tryUnwrapGoKeyringBase64(trimmed) {
  if (typeof trimmed !== 'string' || !trimmed.startsWith(GO_KEYRING_B64_PREFIX)) return null;
  const compact = trimmed.slice(GO_KEYRING_B64_PREFIX.length).replace(/\s+/g, '');
  if (!compact || !BASE64_BODY_RE.test(compact)) return null;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function extractRefreshHashFromParsedObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return '';
  if (obj.kind === WSL_CRED_ENVELOPE_KIND && typeof obj.oauthTokenB64 === 'string') {
    let innerBuf = null;
    try {
      innerBuf = Buffer.from(obj.oauthTokenB64, 'base64');
      return extractCredentialRefreshHash(innerBuf, depth + 1);
    } catch {
      return '';
    } finally {
      if (innerBuf) innerBuf.fill(0);
    }
  }
  const direct = hashRefreshSecret(
    (obj.token && typeof obj.token === 'object' ? obj.token.refresh_token : '') ||
    (typeof obj.refresh_token === 'string' ? obj.refresh_token : '')
  );
  if (direct) return direct;
  if (typeof obj.token === 'string' && obj.token.trim()) {
    const fromText = extractRefreshHashFromText(obj.token, depth + 1);
    if (fromText) return fromText;
    let decoded = null;
    try {
      decoded = Buffer.from(obj.token.trim(), 'base64');
      if (decoded.length) {
        const fromB64 = extractCredentialRefreshHash(decoded, depth + 1);
        if (fromB64) return fromB64;
      }
    } catch {
      // ignore non-base64 token
    } finally {
      if (decoded) decoded.fill(0);
    }
  } else if (obj.token && typeof obj.token === 'object') {
    const nested = extractRefreshHashFromParsedObject(obj.token, depth + 1);
    if (nested) return nested;
  }
  return '';
}

function extractRefreshHashFromText(text, depth = 0) {
  if (typeof text !== 'string' || depth > 4) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const goBuf = tryUnwrapGoKeyringBase64(trimmed);
  if (goBuf) {
    try {
      return extractCredentialRefreshHash(goBuf, depth + 1);
    } finally {
      goBuf.fill(0);
    }
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return extractRefreshHashFromParsedObject(parsed, depth + 1);
    }
  } catch {
    // not strict JSON
  }
  const m = trimmed.match(/"refresh_token"\s*:\s*"([^"\r\n\\]+)"/i);
  if (m && m[1]) {
    return hashRefreshSecret(m[1]);
  }
  return '';
}

function extractEmailFromParsedObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return '';
  if (obj.kind === WSL_CRED_ENVELOPE_KIND && typeof obj.oauthTokenB64 === 'string') {
    let innerBuf = null;
    try {
      innerBuf = Buffer.from(obj.oauthTokenB64, 'base64');
      return extractCredentialEmail(innerBuf, depth + 1);
    } catch {
      return '';
    } finally {
      if (innerBuf) innerBuf.fill(0);
    }
  }

  for (const key of ['id_token_email', 'email', 'account_email', 'user_email', 'login_hint']) {
    const found = normalizeEmailCandidate(obj[key]);
    if (found) return found;
  }
  if (obj.user && typeof obj.user === 'object') {
    const u = normalizeEmailCandidate(obj.user.email || obj.user.id_token_email);
    if (u) return u;
  }
  if (typeof obj.id_token === 'string') {
    const jwtEmail = tryExtractEmailFromJwt(obj.id_token);
    if (jwtEmail) return jwtEmail;
  }
  if (typeof obj.token === 'string' && obj.token.trim()) {
    const direct = extractEmailFromText(obj.token, depth + 1);
    if (direct) return direct;
    let decoded = null;
    try {
      decoded = Buffer.from(obj.token.trim(), 'base64');
      const fromB64 = extractCredentialEmail(decoded, depth + 1);
      if (fromB64) return fromB64;
    } catch {
      // ignore non-base64 token
    } finally {
      if (decoded) decoded.fill(0);
    }
  } else if (obj.token && typeof obj.token === 'object') {
    const nested = extractEmailFromParsedObject(obj.token, depth + 1);
    if (nested) return nested;
  }
  return '';
}

function extractEmailFromText(text, depth = 0) {
  if (typeof text !== 'string' || depth > 4) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const goBuf = tryUnwrapGoKeyringBase64(trimmed);
  if (goBuf) {
    try {
      return extractCredentialEmail(goBuf, depth + 1);
    } finally {
      goBuf.fill(0);
    }
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return extractEmailFromParsedObject(parsed, depth + 1);
    }
  } catch {
    // not JSON, maybe JWT or base64 JSON
  }
  const jwtEmail = tryExtractEmailFromJwt(trimmed);
  if (jwtEmail) return jwtEmail;

  // Some Antigravity token blobs store JSON with leading/trailing binary padding or UTF-8 fields
  const m = trimmed.match(/"id_token_email"\s*:\s*"([^"\r\n\\]+)"/i) || trimmed.match(/"email"\s*:\s*"([^"\r\n\\]+)"/i);
  if (m) {
    const cand = normalizeEmailCandidate(m[1]);
    if (cand) return cand;
  }
  return '';
}

export function extractCredentialEmail(rawInput, depth = 0) {
  if (!rawInput || depth > 4) return '';
  if (Buffer.isBuffer(rawInput)) {
    const text = rawInput.toString('utf8');
    const direct = extractEmailFromText(text, depth);
    if (direct) return direct;
    return '';
  }
  if (typeof rawInput === 'string') {
    return extractEmailFromText(rawInput, depth);
  }
  if (typeof rawInput === 'object') {
    return extractEmailFromParsedObject(rawInput, depth);
  }
  return '';
}

export function extractCredentialRefreshHash(rawInput, depth = 0) {
  if (!rawInput || depth > 4) return '';
  if (Buffer.isBuffer(rawInput)) {
    return extractRefreshHashFromText(rawInput.toString('utf8'), depth);
  }
  if (typeof rawInput === 'string') {
    return extractRefreshHashFromText(rawInput, depth);
  }
  if (typeof rawInput === 'object') {
    return extractRefreshHashFromParsedObject(rawInput, depth);
  }
  return '';
}

export function extractCredentialMeta(rawInput) {
  return {
    email: extractCredentialEmail(rawInput, 0),
    refreshHash: extractCredentialRefreshHash(rawInput, 0)
  };
}

export function detectIsWsl({ platform = process.platform, env = process.env, procVersionPath = '/proc/version' } = {}) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    const ver = fs.readFileSync(procVersionPath, 'utf8');
    return /microsoft/i.test(ver);
  } catch {
    return false;
  }
}

export function detectVaultBackend({ platform = process.platform, isWsl = detectIsWsl({ platform }), distro = process.env.WSL_DISTRO_NAME || '' } = {}) {
  if (platform === 'win32') {
    return {
      backend: 'win32-credman',
      supported: true,
      activeTargetLabel: `Windows 凭据管理器 (${ACTIVE_WIN_TARGET})`,
      namespace: PRISM_WIN_PREFIX,
      wslDistro: ''
    };
  }
  if (platform === 'linux' && isWsl) {
    const cleanDistro = String(distro || 'wsl').replace(/[^a-zA-Z0-9._-]+/g, '-') || 'wsl';
    return {
      backend: 'wsl-wincred',
      supported: true,
      activeTargetLabel: 'WSL2 ~/.gemini/jetski-standalone-oauth-token',
      namespace: `${PRISM_WSL_PREFIX}${cleanDistro}:account:`,
      wslDistro: cleanDistro
    };
  }
  if (platform === 'darwin') {
    return {
      backend: 'darwin-keychain',
      supported: true,
      activeTargetLabel: 'macOS Keychain (gemini / antigravity)',
      namespace: PRISM_WIN_PREFIX,
      wslDistro: ''
    };
  }
  if (platform === 'linux') {
    return {
      backend: 'linux-secret-service',
      supported: true,
      activeTargetLabel: 'Linux Secret Service (gemini / antigravity)',
      namespace: PRISM_WIN_PREFIX,
      wslDistro: ''
    };
  }
  return {
    backend: 'unsupported',
    supported: false,
    activeTargetLabel: `${platform} (不支持)`,
    namespace: PRISM_WIN_PREFIX,
    wslDistro: ''
  };
}

export function resolveSafeExecCwd({
  isWsl = false,
  platform = process.platform,
  existsSync = fs.existsSync,
  homeDir = os.homedir(),
  tmpDir = os.tmpdir(),
  getCwd = () => process.cwd()
} = {}) {
  const candidates = [];
  if (isWsl) {
    candidates.push('/mnt/c/Windows/Temp', '/mnt/c', homeDir, tmpDir, '/');
  } else {
    try {
      const cur = getCwd();
      if (cur && existsSync(cur)) return cur;
    } catch {}
    candidates.push(homeDir, tmpDir, platform === 'win32' ? 'C:\\' : '/');
  }
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (existsSync(dir)) return dir;
    } catch {}
  }
  return platform === 'win32' ? 'C:\\' : '/';
}

export function resolveWslInteropEnv(baseEnv = process.env, isWsl = false, {
  interopDir = '/run/WSL',
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
  statSync = fs.statSync
} = {}) {
  const envCopy = { ...(baseEnv || {}) };
  if (!isWsl) return envCopy;
  const current = envCopy.WSL_INTEROP;
  if (current) {
    try {
      if (existsSync(current)) return envCopy;
    } catch {}
  }
  try {
    if (!existsSync(interopDir)) return envCopy;
    const files = [];
    for (const name of readdirSync(interopDir)) {
      if (!/_interop$/i.test(name)) continue;
      const full = path.join(interopDir, name);
      try {
        const st = statSync(full);
        files.push({ full, mtimeMs: Number(st.mtimeMs) || 0 });
      } catch {}
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (files.length > 0) {
      envCopy.WSL_INTEROP = files[0].full;
    }
  } catch {}
  return envCopy;
}

export function cleanPowerShellError(stderr = '', stdout = '', status = 1, signal = '') {
  let raw = String(stderr || stdout || '').trim();
  if (raw) {
    raw = raw
      .replace(/^#<\s*CLIXML\s*/i, '')
      .replace(/<Objs\b[\s\S]*$/i, (m) => {
        const msgs = [];
        const re = /<S\s+S="(?:Error|Warning)"[^>]*>([\s\S]*?)<\/S>/gi;
        let hit;
        while ((hit = re.exec(m)) !== null) {
          const text = hit[1]
            .replace(/_x000D__x000A_/gi, ' ')
            .replace(/_x000A_/gi, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
          if (text) msgs.push(text);
        }
        if (msgs.length) return msgs.join(' ');
        return m.replace(/<[^>]+>/g, ' ');
      })
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (raw) return raw.slice(0, 180);
  const sigNote = signal ? ` (${signal})` : '';
  return `exit ${status ?? 'unknown'}${sigNote}`;
}

function defaultRunCmd(bin, args, { input = '', timeoutMs = 15000, cwd, env } = {}) {
  const spawnOpts = {
    input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024
  };
  if (cwd) spawnOpts.cwd = cwd;
  if (env) spawnOpts.env = env;
  const res = spawnSync(bin, args, spawnOpts);
  if (res.error) {
    throw res.error;
  }
  return {
    status: res.status ?? (res.signal ? 1 : 0),
    signal: res.signal || '',
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

function resolvePowerShellExe(isWsl) {
  if (!isWsl) {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const full = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return fs.existsSync(full) ? full : 'powershell.exe';
  }
  const wslPs = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return fs.existsSync(wslPs) ? wslPs : 'powershell.exe';
}

function writeFileAtomic0600(targetPath, buf) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.prism-tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmpPath, buf, { mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

export function createAccountVault(options = {}) {
  const platform = options.platform || process.platform;
  const isWsl = options.isWsl !== undefined ? Boolean(options.isWsl) : detectIsWsl({ platform });
  const wslDistro = options.wslDistro || process.env.WSL_DISTRO_NAME || 'Ubuntu';
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const runCmd = options.runCmd || defaultRunCmd;
  const allowBatch = options.enableBatch !== undefined ? Boolean(options.enableBatch) : !options.runCmd;

  const backendInfo = detectVaultBackend({ platform, isWsl, distro: wslDistro });
  const wslTokenPath = path.join(homeDir, '.gemini', 'jetski-standalone-oauth-token');
  const wslUserScopePath = path.join(homeDir, '.config', 'antigravity', 'credential-user-scope');

  const PROBE_TTL_MS = 120 * 1000;
  const SAVED_META_TTL_MS = 60 * 1000;
  const PROVIDER_SECRET_CACHE_TTL_MS = 60_000;
  let probeCache = null; // { value, expiresAt }
  let savedCacheRev = 0;
  const savedMetaCache = new Map(); // cleanId -> { value, expiresAt, rev }
  const providerSecretRamCache = new Map(); // cleanId -> { value, expiresAt }

  function invalidateCache() {
    savedCacheRev += 1;
    probeCache = null;
    savedMetaCache.clear();
    providerSecretRamCache.clear();
  }

  function updateSavedCacheEntry(cleanId, meta) {
    if (!cleanId || !meta || meta.ok === false) return;
    savedMetaCache.set(cleanId, {
      value: { ...meta },
      expiresAt: Date.now() + SAVED_META_TTL_MS,
      rev: savedCacheRev
    });
  }

  function savedTargetName(accountId) {
    const cleanId = sanitizeAccountId(accountId);
    return `${backendInfo.namespace}${cleanId}`;
  }

  function invokeWinCred(payload) {
    const psExe = resolvePowerShellExe(isWsl);
    const jsonIn = JSON.stringify(payload);
    const execCwd = resolveSafeExecCwd({ isWsl, platform, homeDir });
    const execEnv = resolveWslInteropEnv(process.env, isWsl);
    const res = runCmd(
      psExe,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', PS_ENCODED_SCRIPT],
      { input: jsonIn, timeoutMs: 20000, cwd: execCwd, env: execEnv }
    );
    if (res.status !== 0) {
      const safeMsg = cleanPowerShellError(res.stderr, res.stdout, res.status, res.signal);
      throw Object.assign(new Error(`Windows 凭据管理器调用失败: ${safeMsg.slice(0, 180)}`), {
        code: 'VAULT_COMMAND_FAILED'
      });
    }
    const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
    return JSON.parse(line);
  }

  function invokeWinCredBatch(ops) {
    const list = Array.isArray(ops) ? ops : [];
    if (!list.length) return [];
    if (!allowBatch) {
      return list.map((item) => invokeWinCred(item));
    }
    const res = invokeWinCred({ op: 'batch', ops: list });
    if (Array.isArray(res?.results)) return res.results;
    if (res?.results && typeof res.results === 'object') return [res.results];
    throw Object.assign(new Error('Windows 凭据管理器批量响应格式异常'), { code: 'VAULT_COMMAND_FAILED' });
  }

  function readWinCredBuffer(target) {
    const res = invokeWinCred({ op: 'read', target });
    if (!res.found) return null;
    return Buffer.from(String(res.blobB64 || ''), 'base64');
  }

  function writeWinCredBuffer(target, buf) {
    invokeWinCred({ op: 'write', target, blobB64: buf.toString('base64') });
  }

  function deleteWinCred(target) {
    const res = invokeWinCred({ op: 'delete', target });
    return Boolean(res.deleted);
  }

  function readKeychainBuffer(service, account) {
    const res = runCmd('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { timeoutMs: 15000 });
    if (res.status !== 0) {
      if (/could not be found|SecKeychainSearchCopyNext/i.test(res.stderr || '')) return null;
      throw Object.assign(new Error('macOS Keychain 读取失败'), { code: 'VAULT_COMMAND_FAILED' });
    }
    let raw = String(res.stdout || '').replace(/\r?\n$/, '');
    if (/^[0-9a-fA-F]{20,}$/.test(raw) && raw.length % 2 === 0 && !raw.startsWith('prism-b64:') && !raw.startsWith(GO_KEYRING_B64_PREFIX)) {
      try {
        const hexBuf = Buffer.from(raw, 'hex');
        const fromHex = hexBuf.toString('utf8');
        if (fromHex.startsWith('prism-b64:') || fromHex.startsWith(GO_KEYRING_B64_PREFIX) || fromHex.trim().startsWith('{')) {
          raw = fromHex;
        }
      } catch {}
    }
    if (raw.startsWith('prism-b64:')) {
      return Buffer.from(raw.slice('prism-b64:'.length), 'base64');
    }
    return Buffer.from(raw, 'utf8');
  }

  function writeKeychainBuffer(service, account, buf, { rawHostFormat = false } = {}) {
    const asText = rawHostFormat ? buf.toString('utf8') : `prism-b64:${buf.toString('base64')}`;
    const hasBinaryOrNewline = rawHostFormat && (Buffer.compare(Buffer.from(asText, 'utf8'), buf) !== 0 || /[\x00-\x1f\x7f]/.test(asText));
    // Pass secrets strictly via security -i stdin (never argv): use -X <hex> over stdin when >3KB or containing binary/newlines
    const cmdLine = (asText.length > 3000 || hasBinaryOrNewline)
      ? `add-generic-password -U -s ${JSON.stringify(service)} -a ${JSON.stringify(account)} -X ${(rawHostFormat ? buf : Buffer.from(asText, 'utf8')).toString('hex')}\n`
      : `add-generic-password -U -s ${JSON.stringify(service)} -a ${JSON.stringify(account)} -w ${JSON.stringify(asText)}\n`;
    const res = runCmd('security', ['-i'], { input: cmdLine, timeoutMs: 15000 });
    if (res.status !== 0) {
      throw Object.assign(new Error('macOS Keychain 写入失败'), { code: 'VAULT_COMMAND_FAILED' });
    }
  }

  function deleteKeychain(service, account) {
    const res = runCmd('security', ['delete-generic-password', '-s', service, '-a', account], { timeoutMs: 15000 });
    if (res.status !== 0) {
      if (/could not be found/i.test(res.stderr || '')) return false;
      throw Object.assign(new Error('macOS Keychain 删除失败'), { code: 'VAULT_COMMAND_FAILED' });
    }
    return true;
  }

  function readSecretToolBuffer(service, account) {
    const res = runCmd('secret-tool', ['lookup', 'service', service, 'account', account], { timeoutMs: 15000 });
    if (res.status !== 0 || !res.stdout) return null;
    const raw = String(res.stdout || '').replace(/\r?\n$/, '');
    if (raw.startsWith('prism-b64:')) {
      return Buffer.from(raw.slice('prism-b64:'.length), 'base64');
    }
    return Buffer.from(raw, 'utf8');
  }

  function writeSecretToolBuffer(service, account, label, buf, { rawHostFormat = false } = {}) {
    const asText = buf.toString('utf8');
    const canWriteRaw = Buffer.compare(Buffer.from(asText, 'utf8'), buf) === 0 && !asText.includes('\0');
    if (rawHostFormat && !canWriteRaw) {
      throw Object.assign(new Error('Linux Secret Service 活跃凭据包含非法二进制字节，拒绝写入'), { code: 'CORRUPT_CREDENTIAL' });
    }
    const payload = rawHostFormat ? asText : `prism-b64:${buf.toString('base64')}`;
    const res = runCmd(
      'secret-tool',
      ['store', '--label', label, 'service', service, 'account', account],
      { input: payload, timeoutMs: 15000 }
    );
    if (res.status !== 0) {
      throw Object.assign(new Error('Linux secret-tool 写入失败'), { code: 'VAULT_COMMAND_FAILED' });
    }
  }

  function deleteSecretTool(service, account) {
    const res = runCmd('secret-tool', ['clear', 'service', service, 'account', account], { timeoutMs: 15000 });
    return res.status === 0;
  }

  function readActiveRaw() {
    if (backendInfo.backend === 'win32-credman') {
      const buf = readWinCredBuffer(ACTIVE_WIN_TARGET);
      if (!buf) return { exists: false, buf: null, hasUserScope: false };
      return { exists: true, buf, hasUserScope: false };
    }
    if (backendInfo.backend === 'wsl-wincred') {
      if (!fs.existsSync(wslTokenPath)) {
        return { exists: false, buf: null, hasUserScope: false };
      }
      const tokenBuf = fs.readFileSync(wslTokenPath);
      const hasUserScope = fs.existsSync(wslUserScopePath);
      const scopeBuf = hasUserScope ? fs.readFileSync(wslUserScopePath) : null;
      try {
        const envelope = {
          kind: WSL_CRED_ENVELOPE_KIND,
          oauthTokenB64: tokenBuf.toString('base64'),
          ...(scopeBuf ? { userScopeB64: scopeBuf.toString('base64') } : {})
        };
        return {
          exists: true,
          buf: Buffer.from(JSON.stringify(envelope), 'utf8'),
          hasUserScope
        };
      } finally {
        tokenBuf.fill(0);
        if (scopeBuf) scopeBuf.fill(0);
      }
    }
    if (backendInfo.backend === 'darwin-keychain') {
      const buf = readKeychainBuffer('gemini', 'antigravity');
      return { exists: Boolean(buf), buf, hasUserScope: false };
    }
    if (backendInfo.backend === 'linux-secret-service') {
      const buf = readSecretToolBuffer('gemini', 'antigravity');
      return { exists: Boolean(buf), buf, hasUserScope: false };
    }
    throw Object.assign(new Error(`当前平台不支持隔离凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
  }

  function writeActiveRaw(buf) {
    if (!buf || !buf.length) {
      throw Object.assign(new Error('拒绝写入空凭据到活跃槽'), { code: 'EMPTY_CREDENTIAL' });
    }
    if (backendInfo.backend === 'win32-credman') {
      writeWinCredBuffer(ACTIVE_WIN_TARGET, buf);
      return;
    }
    if (backendInfo.backend === 'wsl-wincred') {
      let envelope;
      try {
        envelope = JSON.parse(buf.toString('utf8'));
      } catch {
        throw Object.assign(new Error('WSL 凭据信封损坏，已拒绝写回活跃槽'), { code: 'CORRUPT_ENVELOPE' });
      }
      if (!envelope || envelope.kind !== WSL_CRED_ENVELOPE_KIND || typeof envelope.oauthTokenB64 !== 'string' || !envelope.oauthTokenB64) {
        throw Object.assign(new Error('WSL 凭据信封格式无效，已拒绝写回活跃槽'), { code: 'CORRUPT_ENVELOPE' });
      }
      const tokenBuf = Buffer.from(envelope.oauthTokenB64, 'base64');
      let scopeBuf = typeof envelope.userScopeB64 === 'string' && envelope.userScopeB64
        ? Buffer.from(envelope.userScopeB64, 'base64')
        : null;
      try {
        writeFileAtomic0600(wslTokenPath, tokenBuf);
        if (scopeBuf) {
          writeFileAtomic0600(wslUserScopePath, scopeBuf);
        } else if (fs.existsSync(wslUserScopePath)) {
          fs.rmSync(wslUserScopePath, { force: true });
        }
      } finally {
        tokenBuf.fill(0);
        if (scopeBuf) scopeBuf.fill(0);
      }
      return;
    }
    if (backendInfo.backend === 'darwin-keychain') {
      writeKeychainBuffer('gemini', 'antigravity', buf, { rawHostFormat: true });
      return;
    }
    if (backendInfo.backend === 'linux-secret-service') {
      writeSecretToolBuffer('gemini', 'antigravity', 'Antigravity Active Credential', buf, { rawHostFormat: true });
      return;
    }
    throw Object.assign(new Error(`当前平台不支持隔离凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
  }

  function readSavedRaw(accountId) {
    const cleanId = sanitizeAccountId(accountId);
    if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
      return readWinCredBuffer(savedTargetName(cleanId));
    }
    if (backendInfo.backend === 'darwin-keychain') {
      return readKeychainBuffer('prism-suite', cleanId);
    }
    if (backendInfo.backend === 'linux-secret-service') {
      return readSecretToolBuffer('prism-suite', cleanId);
    }
    throw Object.assign(new Error(`当前平台不支持隔离凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
  }

  function writeSavedRaw(accountId, buf) {
    const cleanId = sanitizeAccountId(accountId);
    if (!buf || !buf.length) {
      throw Object.assign(new Error('禁止写入空凭据备份'), { code: 'EMPTY_CREDENTIAL' });
    }
    if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
      writeWinCredBuffer(savedTargetName(cleanId), buf);
      return;
    }
    if (backendInfo.backend === 'darwin-keychain') {
      writeKeychainBuffer('prism-suite', cleanId, buf);
      return;
    }
    if (backendInfo.backend === 'linux-secret-service') {
      writeSecretToolBuffer('prism-suite', cleanId, `Prism Suite Account (${cleanId})`, buf);
      return;
    }
    throw Object.assign(new Error(`当前平台不支持隔离凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
  }

  function deleteSavedRaw(accountId) {
    const cleanId = sanitizeAccountId(accountId);
    if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
      return deleteWinCred(savedTargetName(cleanId));
    }
    if (backendInfo.backend === 'darwin-keychain') {
      return deleteKeychain('prism-suite', cleanId);
    }
    if (backendInfo.backend === 'linux-secret-service') {
      return deleteSecretTool('prism-suite', cleanId);
    }
    throw Object.assign(new Error(`当前平台不支持隔离凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
  }

  function probe({ force = false } = {}) {
    if (!backendInfo.supported) {
      return { ok: false, ...backendInfo, error: '当前操作系统不支持原生凭据库' };
    }
    const now = Date.now();
    if (!force && probeCache && probeCache.value?.ok && now < probeCache.expiresAt) {
      return { ...probeCache.value };
    }
    try {
      if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
        invokeWinCred({ op: 'probe' });
      } else if (backendInfo.backend === 'darwin-keychain') {
        runCmd('security', ['-h'], { timeoutMs: 5000 });
      } else if (backendInfo.backend === 'linux-secret-service') {
        runCmd('secret-tool', ['--help'], { timeoutMs: 5000 });
      }
      const res = {
        ok: true,
        ...backendInfo,
        note: '隔离命名空间生效，绝不读写会话 SQLite / brain / memory。'
      };
      probeCache = { value: res, expiresAt: now + PROBE_TTL_MS };
      return { ...res };
    } catch (err) {
      probeCache = null;
      return {
        ok: false,
        ...backendInfo,
        error: String(err?.message || err)
      };
    }
  }

  function inspectActive() {
    const raw = readActiveRaw();
    if (!raw.exists || !raw.buf) {
      return {
        ok: true,
        exists: false,
        email: '',
        hashPrefix: '',
        refreshHash: '',
        byteLength: 0,
        hasUserScope: raw.hasUserScope,
        backend: backendInfo.backend
      };
    }
    try {
      const meta = extractCredentialMeta(raw.buf);
      return {
        ok: true,
        exists: true,
        email: meta.email,
        hashPrefix: fingerprintBuffer(raw.buf),
        refreshHash: meta.refreshHash,
        byteLength: raw.buf.length,
        hasUserScope: raw.hasUserScope,
        backend: backendInfo.backend
      };
    } finally {
      raw.buf.fill(0);
    }
  }

  function inspectSaved(accountId, { force = false } = {}) {
    const cleanId = sanitizeAccountId(accountId);
    const now = Date.now();
    if (!force) {
      const cached = savedMetaCache.get(cleanId);
      if (cached && cached.rev === savedCacheRev && now < cached.expiresAt) {
        return { ...cached.value };
      }
    }
    const reqRev = savedCacheRev;
    const buf = readSavedRaw(cleanId);
    if (!buf) {
      const emptyMeta = {
        ok: true,
        exists: false,
        accountId: cleanId,
        email: '',
        hashPrefix: '',
        refreshHash: '',
        byteLength: 0,
        backend: backendInfo.backend
      };
      if (reqRev === savedCacheRev) updateSavedCacheEntry(cleanId, emptyMeta);
      return emptyMeta;
    }
    try {
      const parsedMeta = extractCredentialMeta(buf);
      const meta = {
        ok: true,
        exists: true,
        accountId: cleanId,
        email: parsedMeta.email,
        hashPrefix: fingerprintBuffer(buf),
        refreshHash: parsedMeta.refreshHash,
        byteLength: buf.length,
        backend: backendInfo.backend
      };
      if (reqRev === savedCacheRev) updateSavedCacheEntry(cleanId, meta);
      return meta;
    } finally {
      buf.fill(0);
    }
  }

  function inspectSavedMany(accountIds = [], { force = false } = {}) {
    const ids = Array.isArray(accountIds) ? accountIds.map((id) => sanitizeAccountId(id)) : [];
    const out = {};
    if (!ids.length) return out;
    const now = Date.now();
    const missingIds = [];
    for (const cleanId of ids) {
      if (!force) {
        const cached = savedMetaCache.get(cleanId);
        if (cached && cached.rev === savedCacheRev && now < cached.expiresAt) {
          out[cleanId] = { ...cached.value };
          continue;
        }
      }
      missingIds.push(cleanId);
    }
    if (!missingIds.length) return out;

    const reqRev = savedCacheRev;
    if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
      const ops = missingIds.map((id) => ({ op: 'read', target: savedTargetName(id) }));
      const results = invokeWinCredBatch(ops);
      for (let i = 0; i < missingIds.length; i++) {
        const cleanId = missingIds[i];
        const r = results[i];
        if (!r || !r.found) {
          const emptyMeta = { ok: true, exists: false, accountId: cleanId, email: '', hashPrefix: '', refreshHash: '', byteLength: 0, backend: backendInfo.backend };
          out[cleanId] = emptyMeta;
          if (reqRev === savedCacheRev) updateSavedCacheEntry(cleanId, emptyMeta);
          continue;
        }
        const buf = Buffer.from(String(r.blobB64 || ''), 'base64');
        try {
          const parsedMeta = extractCredentialMeta(buf);
          const meta = {
            ok: true,
            exists: true,
            accountId: cleanId,
            email: parsedMeta.email,
            hashPrefix: fingerprintBuffer(buf),
            refreshHash: parsedMeta.refreshHash,
            byteLength: buf.length,
            backend: backendInfo.backend
          };
          out[cleanId] = meta;
          if (reqRev === savedCacheRev) updateSavedCacheEntry(cleanId, meta);
        } finally {
          buf.fill(0);
        }
      }
      return out;
    }
    for (const cleanId of missingIds) {
      out[cleanId] = inspectSaved(cleanId, { force });
    }
    return out;
  }

  function saveActiveTo(accountId, { expectedEmail = '' } = {}) {
    const cleanId = sanitizeAccountId(accountId);
    const raw = readActiveRaw();
    if (!raw.exists || !raw.buf) {
      throw Object.assign(new Error('未检测到当前活跃 Antigravity 登录凭据'), { code: 'NO_ACTIVE_CREDENTIAL' });
    }
    let verifyBuf = null;
    try {
      const activeMeta = extractCredentialMeta(raw.buf);
      const email = activeMeta.email;
      const refreshHash = activeMeta.refreshHash;
      const wantEmail = normalizeEmailCandidate(expectedEmail);
      if (wantEmail && email && wantEmail !== email) {
        throw Object.assign(
          new Error(`活跃凭据邮箱 (${email}) 与目标槽位 (${wantEmail}) 不一致，已拦截防止串号覆盖`),
          { code: 'EMAIL_MISMATCH', activeEmail: email, expectedEmail: wantEmail }
        );
      }
      if (wantEmail && !email) {
        throw Object.assign(
          new Error('当前活跃凭据无法解析邮箱，拒绝覆盖已命名账号槽位'),
          { code: 'EMAIL_UNVERIFIABLE' }
        );
      }
      const expectedHash = fingerprintBuffer(raw.buf);
      if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
        const targetName = savedTargetName(cleanId);
        const batchRes = invokeWinCredBatch([
          { op: 'write', target: targetName, blobB64: raw.buf.toString('base64') },
          { op: 'read', target: targetName }
        ]);
        const readItem = batchRes[1];
        verifyBuf = readItem && readItem.found ? Buffer.from(String(readItem.blobB64 || ''), 'base64') : null;
      } else {
        writeSavedRaw(cleanId, raw.buf);
        verifyBuf = readSavedRaw(cleanId);
      }
      if (!verifyBuf || fingerprintBuffer(verifyBuf) !== expectedHash) {
        throw Object.assign(new Error('写入隔离凭据槽后回读校验失败'), { code: 'VAULT_VERIFY_FAILED' });
      }
      updateSavedCacheEntry(cleanId, {
        ok: true,
        exists: true,
        accountId: cleanId,
        email,
        hashPrefix: expectedHash,
        refreshHash,
        byteLength: raw.buf.length,
        backend: backendInfo.backend
      });
      return {
        ok: true,
        accountId: cleanId,
        email,
        hashPrefix: expectedHash,
        refreshHash,
        byteLength: raw.buf.length,
        hasUserScope: raw.hasUserScope,
        backend: backendInfo.backend
      };
    } finally {
      raw.buf.fill(0);
      if (verifyBuf) verifyBuf.fill(0);
    }
  }

  function swapActiveFromSaved(accountId, { expectedTargetEmail = '', backupCurrentToId = '' } = {}) {
    const cleanTargetId = sanitizeAccountId(accountId);
    const prevRaw = readActiveRaw();
    let targetBuf = null;
    let verifyActiveBuf = null;
    let verifyBackupBuf = null;
    let swapped = false;

    try {
      const isWinCred = backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred';
      if (isWinCred && allowBatch) {
        const ops = [];
        let cleanBackupId = '';
        let prevHash = '';
        if (backupCurrentToId) {
          cleanBackupId = sanitizeAccountId(backupCurrentToId);
          if (!prevRaw.exists || !prevRaw.buf) {
            throw Object.assign(new Error('当前无活跃凭据可备份'), { code: 'NO_ACTIVE_CREDENTIAL' });
          }
          prevHash = fingerprintBuffer(prevRaw.buf);
          const backupTarget = savedTargetName(cleanBackupId);
          ops.push({ op: 'write', target: backupTarget, blobB64: prevRaw.buf.toString('base64') });
          ops.push({ op: 'read', target: backupTarget });
        }
        ops.push({ op: 'read', target: savedTargetName(cleanTargetId) });
        const batchRes = invokeWinCredBatch(ops);
        let idx = 0;
        if (cleanBackupId) {
          idx += 1; // skip write result
          const bRead = batchRes[idx++];
          verifyBackupBuf = bRead && bRead.found ? Buffer.from(String(bRead.blobB64 || ''), 'base64') : null;
          if (!verifyBackupBuf || fingerprintBuffer(verifyBackupBuf) !== prevHash) {
            throw Object.assign(new Error('切换前备份当前活跃凭据校验失败，已中止切换'), { code: 'BACKUP_VERIFY_FAILED' });
          }
        }
        const tRead = batchRes[idx];
        targetBuf = tRead && tRead.found ? Buffer.from(String(tRead.blobB64 || ''), 'base64') : null;
      } else {
        if (backupCurrentToId) {
          const cleanBackupId = sanitizeAccountId(backupCurrentToId);
          if (!prevRaw.exists || !prevRaw.buf) {
            throw Object.assign(new Error('当前无活跃凭据可备份'), { code: 'NO_ACTIVE_CREDENTIAL' });
          }
          const prevHash = fingerprintBuffer(prevRaw.buf);
          writeSavedRaw(cleanBackupId, prevRaw.buf);
          verifyBackupBuf = readSavedRaw(cleanBackupId);
          if (!verifyBackupBuf || fingerprintBuffer(verifyBackupBuf) !== prevHash) {
            throw Object.assign(new Error('切换前备份当前活跃凭据校验失败，已中止切换'), { code: 'BACKUP_VERIFY_FAILED' });
          }
        }

        targetBuf = readSavedRaw(cleanTargetId);
      }

      if (!targetBuf || !targetBuf.length) {
        throw Object.assign(new Error(`隔离凭据槽 ${cleanTargetId} 不存在或为空`), { code: 'TARGET_CREDENTIAL_MISSING' });
      }

      const targetMeta = extractCredentialMeta(targetBuf);
      const targetEmail = targetMeta.email;
      const targetRefreshHash = targetMeta.refreshHash;
      const wantEmail = normalizeEmailCandidate(expectedTargetEmail);
      if (wantEmail && targetEmail !== wantEmail) {
        throw Object.assign(
          new Error(`目标槽位凭据邮箱 (${targetEmail || '未知'}) 与期望 (${wantEmail}) 不符，已拦截串号切换`),
          { code: 'TARGET_EMAIL_MISMATCH', targetEmail, expectedTargetEmail: wantEmail }
        );
      }

      const expectedHash = fingerprintBuffer(targetBuf);
      writeActiveRaw(targetBuf);
      swapped = true;

      const afterRaw = readActiveRaw();
      verifyActiveBuf = afterRaw.buf;
      const afterHash = verifyActiveBuf ? fingerprintBuffer(verifyActiveBuf) : '';
      const afterEmail = verifyActiveBuf ? extractCredentialEmail(verifyActiveBuf) : '';
      if (!afterRaw.exists || afterHash !== expectedHash || (wantEmail && afterEmail !== wantEmail)) {
        throw Object.assign(new Error('写入活跃凭据后回读核验未通过，正在执行原子回滚'), { code: 'ACTIVE_VERIFY_FAILED' });
      }

      if (backupCurrentToId && verifyBackupBuf) {
        const cleanBackupId = sanitizeAccountId(backupCurrentToId);
        const backupMeta = extractCredentialMeta(verifyBackupBuf);
        updateSavedCacheEntry(cleanBackupId, {
          ok: true,
          exists: true,
          accountId: cleanBackupId,
          email: backupMeta.email,
          hashPrefix: fingerprintBuffer(verifyBackupBuf),
          refreshHash: backupMeta.refreshHash,
          byteLength: verifyBackupBuf.length,
          backend: backendInfo.backend
        });
      }

      return {
        ok: true,
        targetId: cleanTargetId,
        targetEmail: targetEmail || wantEmail,
        hashPrefix: afterHash,
        refreshHash: targetRefreshHash,
        byteLength: verifyActiveBuf.length,
        backedUpTo: backupCurrentToId ? sanitizeAccountId(backupCurrentToId) : '',
        rolledBack: false
      };
    } catch (err) {
      let rolledBack = false;
      if (swapped && prevRaw.exists && prevRaw.buf) {
        try {
          writeActiveRaw(prevRaw.buf);
          rolledBack = true;
        } catch {
          rolledBack = false;
        }
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { rolledBack });
    } finally {
      if (prevRaw.buf) prevRaw.buf.fill(0);
      if (targetBuf) targetBuf.fill(0);
      if (verifyActiveBuf) verifyActiveBuf.fill(0);
      if (verifyBackupBuf) verifyBackupBuf.fill(0);
    }
  }

  function deleteSaved(accountId) {
    const cleanId = sanitizeAccountId(accountId);
    const deleted = deleteSavedRaw(cleanId);
    savedCacheRev += 1;
    savedMetaCache.delete(cleanId);
    return { ok: true, accountId: cleanId, deleted };
  }

  function sanitizeProviderSecretId(providerId) {
    const clean = String(providerId ?? '').trim();
    if (!PROVIDER_SECRET_ID_RE.test(clean) || clean.includes('..')) {
      throw Object.assign(new Error('非法 Provider ID'), { code: 'INVALID_PROVIDER_ID' });
    }
    return clean;
  }

  function providerSecretTargetName(cleanId) {
    return backendInfo.backend === 'wsl-wincred'
      ? `${PRISM_WSL_PREFIX}${wslDistro}:provider:${cleanId}`
      : `${PRISM_PROVIDER_PREFIX}${cleanId}`;
  }

  function getProviderSecret(providerId) {
    const cleanId = sanitizeProviderSecretId(providerId);
    const now = Date.now();
    const cached = providerSecretRamCache.get(cleanId);
    if (cached && now < cached.expiresAt) {
      return cached.value;
    }
    if (cached) providerSecretRamCache.delete(cleanId);

    let buf = null;
    try {
      if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
        buf = readWinCredBuffer(providerSecretTargetName(cleanId));
      } else if (backendInfo.backend === 'darwin-keychain') {
        buf = readKeychainBuffer('prism-suite-provider', cleanId);
      } else if (backendInfo.backend === 'linux-secret-service') {
        buf = readSecretToolBuffer('prism-suite-provider', cleanId);
      } else {
        return '';
      }
      const val = buf && buf.length ? buf.toString('utf8') : '';
      if (val) {
        providerSecretRamCache.set(cleanId, { value: val, expiresAt: now + PROVIDER_SECRET_CACHE_TTL_MS });
      }
      return val;
    } finally {
      if (buf) buf.fill(0);
    }
  }

  function setProviderSecret(providerId, secretValue) {
    const cleanId = sanitizeProviderSecretId(providerId);
    const str = String(secretValue ?? '').trim();
    if (!str) {
      throw Object.assign(new Error('Provider API Key 不能为空'), { code: 'EMPTY_PROVIDER_SECRET' });
    }
    providerSecretRamCache.delete(cleanId);
    const buf = Buffer.from(str, 'utf8');
    try {
      if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
        writeWinCredBuffer(providerSecretTargetName(cleanId), buf);
        providerSecretRamCache.set(cleanId, { value: str, expiresAt: Date.now() + PROVIDER_SECRET_CACHE_TTL_MS });
        return true;
      }
      if (backendInfo.backend === 'darwin-keychain') {
        writeKeychainBuffer('prism-suite-provider', cleanId, buf);
        providerSecretRamCache.set(cleanId, { value: str, expiresAt: Date.now() + PROVIDER_SECRET_CACHE_TTL_MS });
        return true;
      }
      if (backendInfo.backend === 'linux-secret-service') {
        writeSecretToolBuffer('prism-suite-provider', cleanId, `Prism Model Hub (${cleanId})`, buf);
        providerSecretRamCache.set(cleanId, { value: str, expiresAt: Date.now() + PROVIDER_SECRET_CACHE_TTL_MS });
        return true;
      }
      throw Object.assign(new Error(`当前系统不支持原生凭据库: ${backendInfo.backend}`), { code: 'UNSUPPORTED_VAULT' });
    } finally {
      buf.fill(0);
    }
  }

  function deleteProviderSecret(providerId) {
    const cleanId = sanitizeProviderSecretId(providerId);
    providerSecretRamCache.delete(cleanId);
    if (backendInfo.backend === 'win32-credman' || backendInfo.backend === 'wsl-wincred') {
      return deleteWinCred(providerSecretTargetName(cleanId));
    }
    if (backendInfo.backend === 'darwin-keychain') {
      return deleteKeychain('prism-suite-provider', cleanId);
    }
    if (backendInfo.backend === 'linux-secret-service') {
      return deleteSecretTool('prism-suite-provider', cleanId);
    }
    return false;
  }

  function asProviderSecretStore() {
    return {
      getSecret: getProviderSecret,
      setSecret: setProviderSecret,
      deleteSecret: deleteProviderSecret
    };
  }

  return {
    backendInfo,
    probe,
    invalidateCache,
    inspectActive,
    inspectSaved,
    inspectSavedMany,
    saveActiveTo,
    swapActiveFromSaved,
    deleteSaved,
    getProviderSecret,
    setProviderSecret,
    deleteProviderSecret,
    asProviderSecretStore
  };
}
