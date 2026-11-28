// SPDX-License-Identifier: MIT
/**
 * Public/Private isolated profile & model-gateway configuration manager
 * for Anti-Claude Prism Suite.
 *
 * Security invariants:
 * - Zero external dependencies (Node >= 22 built-in modules only).
 * - Never persists plaintext API keys, tokens, or passwords to disk.
 * - Never scans or reads any external CLI/editor configuration directories.
 * - Rejects symbolic links on profile directories and target files; writes
 *   atomically via same-directory 0o600 wx temp files + renameSync.
 * - Blocks system/runtime environment variables from being bound as credential sources.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactSensitiveText } from './redact-shared.mjs';

export const PRISM_PROFILE_SCHEMA_VERSION = 1;

export const VALID_PROTOCOLS = Object.freeze([
  'openai-chat',
  'openai-responses',
  'anthropic-messages'
]);

export const VALID_TIERS = Object.freeze(['T1', 'T2', 'T3', 'T4']);

export const VALID_VENDORS = Object.freeze([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'glm',
  'other'
]);

export const PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI 官方 / 兼容网关',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedEnv: 'OPENAI_API_KEY'
  }),
  'openai-responses': Object.freeze({
    label: 'OpenAI Responses 网关',
    protocol: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedEnv: 'OPENAI_API_KEY'
  }),
  anthropic: Object.freeze({
    label: 'Anthropic 官方 / 兼容网关',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    suggestedEnv: 'ANTHROPIC_API_KEY'
  }),
  'gemini-openai': Object.freeze({
    label: 'Google Gemini (OpenAI 兼容)',
    protocol: 'openai-chat',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    suggestedEnv: 'GEMINI_API_KEY'
  }),
  'ollama-local': Object.freeze({
    label: '本机 Ollama (免 Key)',
    protocol: 'openai-chat',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    suggestedEnv: ''
  })
});

export const TIER_DEFINITIONS = Object.freeze({
  T1: Object.freeze({
    id: 'T1',
    order: 1,
    label: 'T1 顶配旗舰',
    title: 'T1 顶配旗舰（重决策 / 深度审计）',
    description: '用于高风险架构拍板、重大重构取舍、疑难根因死磕、核心安全链路深度交叉审计及多视角辩论'
  }),
  T2: Object.freeze({
    id: 'T2',
    order: 2,
    label: 'T2 常规主力',
    title: 'T2 常规主力（日常审计 / 常规二审）',
    description: '用于常规功能 Diff 交叉复核、中等复杂度方案第二意见与常规报错排查'
  }),
  T3: Object.freeze({
    id: 'T3',
    order: 3,
    label: 'T3 进阶性价比',
    title: 'T3 进阶性价比（高频分析 / 中文推理）',
    description: '用于高频数据分析、中文长文与业务规范梳理、日常性价比二审及限流降级备选'
  }),
  T4: Object.freeze({
    id: 'T4',
    order: 4,
    label: 'T4 轻量高速',
    title: 'T4 轻量高速（摘要 / 整理 / 批量低难）',
    description: '用于长日志与长文档摘要、中文问答、格式整理与简单资料初筛'
  })
});

const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;

export const BLOCKED_ENV_VAR_NAMES = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SHELL',
  'COMSPEC',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'WSL_INTEROP',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_LS_ADDRESS',
  // Additional OS / dynamic-linker / runtime process variables
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'ELECTRON_RUN_AS_NODE',
  'PYTHONPATH',
  'IFS',
  'PWD',
  'OLDPWD',
  'USER',
  'LOGNAME',
  'USERNAME',
  'HOSTNAME',
  'COMPUTERNAME',
  'SYSTEMROOT',
  'WINDIR',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'PATHEXT',
  'PSMODULEPATH',
  'WSL_DISTRO_NAME',
  'WSLENV',
  'SSH_AUTH_SOCK',
  'GPG_AGENT_INFO',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'TERM',
  'LANG',
  'LC_ALL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  // High-risk cross-service CI/cloud/registry credentials prohibited from model gateway binding
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'NPM_TOKEN',
  'AZURE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS'
]);

export const BLOCKED_ENV_NAMES = BLOCKED_ENV_VAR_NAMES;

/**
 * Strictly validates an environment variable name intended to supply an API key.
 * Must match /^[A-Z][A-Z0-9_]{1,63}$/ and must not be a system/runtime variable.
 */
export function validateEnvVarName(name) {
  if (typeof name !== 'string') {
    throw Object.assign(new Error('环境变量名必须为字符串'), {
      code: 'INVALID_ENV_VAR_NAME'
    });
  }
  const trimmed = name.trim();
  if (!ENV_VAR_NAME_RE.test(trimmed)) {
    throw Object.assign(
      new Error(`非法环境变量名 "${trimmed.slice(0, 64)}"：必须匹配 /^[A-Z][A-Z0-9_]{1,63}$/`),
      { code: 'INVALID_ENV_VAR_NAME' }
    );
  }
  if (BLOCKED_ENV_VAR_NAMES.has(trimmed)) {
    throw Object.assign(
      new Error(`禁止绑定非密钥系统环境变量 "${trimmed}"`),
      { code: 'BLOCKED_ENV_VAR_NAME' }
    );
  }
  return trimmed;
}

const CLOUD_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata'
]);

function parseIpv6Words(rawHost) {
  let h = String(rawHost || '').trim().toLowerCase();
  const v4Tail = h.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4Tail) {
    const oct = v4Tail.slice(2).map((x) => Number(x));
    if (oct.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    h = `${v4Tail[1]}${((oct[0] << 8) | oct[1]).toString(16)}:${((oct[2] << 8) | oct[3]).toString(16)}`;
  }
  if ((h.match(/::/g) || []).length > 1) return null;
  if (/^:[^:]|[^:]:$/.test(h)) return null;
  let groups;
  if (h.includes('::')) {
    const [left, right] = h.split('::');
    const L = left ? left.split(':') : [];
    const R = right ? right.split(':') : [];
    if (L.length + R.length >= 8) return null;
    groups = [...L, ...Array(8 - L.length - R.length).fill('0'), ...R];
  } else {
    groups = h.split(':');
    if (groups.length !== 8) return null;
  }
  const words = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    words.push(parseInt(g, 16));
  }
  return words;
}

/**
 * Blocks cloud IMDS / link-local / unspecified / multicast endpoints while explicitly
 * preserving localhost, RFC1918 LAN, Tailscale CGNAT (100.64.0.0/10 except 100.100.100.200),
 * and Tailscale MagicDNS (*.ts.net).
 */
export function isBlockedMetadataOrSpecialHost(rawHostname) {
  let host = String(rawHostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (!host || host.includes('%')) return true;
  if (CLOUD_METADATA_HOSTS.has(host)) return true;

  // IPv4 check
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const nums = v4.slice(1).map((x) => Number(x));
    if (nums.some((n) => n < 0 || n > 255)) return true;
    const [a, b, c, d] = nums;
    if (a === 0) return true; // 0.0.0.0/8 unspecified
    if (a === 169 && b === 254) return true; // AWS/GCP/Azure link-local IMDS 169.254.169.254
    if (a === 100 && b === 100 && c === 100 && d === 200) return true; // Alibaba Cloud ECS IMDS
    if (a >= 224) return true; // Multicast / broadcast
    return false;
  }

  // IPv6 8-word numeric check (covers ::, fe80::/10, ff00::/8, fd00:ec2::254, ::ffff:a9fe:a9fe, ::a9fe:a9fe, NAT64 64:ff9b::/96)
  if (host.includes(':')) {
    const w = parseIpv6Words(host);
    if (!w) return true;
    if (w.every((x) => x === 0)) return true; // :: unspecified
    if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (
      w[0] === 0xfd00 && w[1] === 0x0ec2 &&
      w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && w[6] === 0 &&
      w[7] === 0x0254
    ) {
      return true; // AWS IPv6 IMDS fd00:ec2::254
    }
    const z5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;
    const isV4Mapped = z5 && w[5] === 0xffff;
    const isV4Compat = z5 && w[5] === 0 && !(w[6] === 0 && w[7] === 1);
    const isNat64 = w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0;
    if (isV4Mapped || isV4Compat || isNat64) {
      const embeddedV4 = `${(w[6] >> 8) & 0xff}.${w[6] & 0xff}.${(w[7] >> 8) & 0xff}.${w[7] & 0xff}`;
      return isBlockedMetadataOrSpecialHost(embeddedV4);
    }
  }

  return false;
}

/**
 * Validates and normalizes an HTTP/HTTPS gateway endpoint URL.
 * Allows only http: and https:, blocks cloud metadata / link-local endpoints,
 * forbids embedded credentials (username/password/@) and ASCII control characters.
 */
export function validateHttpEndpointUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw Object.assign(new Error('网关端点 URL 不能为空'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }
  if (/[\x00-\x1f\x7f]/.test(rawUrl)) {
    throw Object.assign(new Error('网关端点 URL 包含非法控制字符'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }
  const trimmed = rawUrl.trim();
  const authorityMatch = trimmed.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/);
  if (authorityMatch && authorityMatch[1].includes('@')) {
    throw Object.assign(new Error('网关端点 URL 禁止内嵌用户名或密码凭据 (@)'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('网关端点 URL 格式无效'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error(`网关端点仅支持 http: 或 https: 协议（收到 ${parsed.protocol}）`), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('网关端点 URL 禁止包含 username 或 password'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }
  if (!parsed.hostname) {
    throw Object.assign(new Error('网关端点 URL 缺少主机名'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }
  if (isBlockedMetadataOrSpecialHost(parsed.hostname)) {
    throw Object.assign(new Error(`安全拦截：禁止将云元数据或链路本地保留地址配置为网关端点 (${parsed.hostname})`), {
      code: 'BLOCKED_METADATA_ENDPOINT'
    });
  }
  if (parsed.hash) {
    throw Object.assign(new Error('网关端点 URL 禁止包含片段标识符 (#)'), {
      code: 'INVALID_ENDPOINT_URL'
    });
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}${parsed.search}`;
}

function stripControlChars(str, maxLen = 200) {
  return String(str ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function redactErrorSnippet(text) {
  return redactSensitiveText(String(text ?? ''))
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 240);
}

function isLoopbackUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

function sanitizeProviderId(rawId) {
  const clean = String(rawId ?? '').trim();
  if (!PROVIDER_ID_RE.test(clean) || clean.includes('..')) {
    throw Object.assign(
      new Error('非法 Provider ID：仅允许 1–64 位字母、数字、点、下划线或连字符，且以字母或数字开头'),
      { code: 'INVALID_PROVIDER_ID' }
    );
  }
  return clean;
}

function sanitizeModelId(rawId) {
  const clean = String(rawId ?? '').trim();
  if (!MODEL_ID_RE.test(clean) || clean.includes('..')) {
    throw Object.assign(
      new Error('非法 Model ID：仅允许 1–96 位字母、数字及 ._:/- 字符，且禁止包含 ..'),
      { code: 'INVALID_MODEL_ID' }
    );
  }
  return clean;
}

function normalizeTier(rawTier, fallback = 'T2', strict = false) {
  if (rawTier === undefined || rawTier === null || rawTier === '') {
    return fallback;
  }
  const upper = String(rawTier).trim().toUpperCase();
  if (!VALID_TIERS.includes(upper)) {
    if (strict) {
      throw Object.assign(new Error(`非法模型梯队 "${rawTier}"：仅支持 T1、T2、T3、T4`), {
        code: 'INVALID_TIER'
      });
    }
    return fallback;
  }
  return upper;
}

function normalizeVendor(rawVendor, fallback = 'other', strict = false) {
  if (rawVendor === undefined || rawVendor === null || rawVendor === '') {
    return fallback;
  }
  const lower = String(rawVendor).trim().toLowerCase();
  if (!VALID_VENDORS.includes(lower)) {
    if (strict) {
      throw Object.assign(
        new Error(`非法厂商标识 "${rawVendor}"：仅支持 ${VALID_VENDORS.join(', ')}`),
        { code: 'INVALID_VENDOR' }
      );
    }
    return fallback;
  }
  return lower;
}

function normalizeProtocol(rawProtocol, fallback = 'openai-chat', strict = false) {
  if (rawProtocol === undefined || rawProtocol === null || rawProtocol === '') {
    return fallback;
  }
  const lower = String(rawProtocol).trim().toLowerCase();
  if (!VALID_PROTOCOLS.includes(lower)) {
    if (strict) {
      throw Object.assign(
        new Error(`非法网关协议 "${rawProtocol}"：仅支持 ${VALID_PROTOCOLS.join(', ')}`),
        { code: 'INVALID_PROTOCOL' }
      );
    }
    return fallback;
  }
  return lower;
}

function createDefaultSettings() {
  return {
    remoteMemory: false,
    webSearch: false,
    defaultTier: 'T2',
    redactOutboundSecrets: true
  };
}

function createEmptyProfile() {
  return {
    schemaVersion: PRISM_PROFILE_SCHEMA_VERSION,
    updatedAt: null,
    settings: createDefaultSettings(),
    providers: [],
    models: [],
    favorites: []
  };
}

function sanitizeRemoteMemorySetting(input, prevValue = false) {
  if (input === undefined) return prevValue;
  if (typeof input === 'boolean') return input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const out = {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : true
    };
    const rawEndpoint = input.endpointUrl ?? input.url ?? '';
    if (rawEndpoint !== '') {
      out.endpointUrl = validateHttpEndpointUrl(String(rawEndpoint));
    } else {
      out.endpointUrl = '';
    }
    if (input.apiKeyEnv !== undefined && String(input.apiKeyEnv).trim() !== '') {
      out.apiKeyEnv = validateEnvVarName(String(input.apiKeyEnv));
    } else {
      out.apiKeyEnv = '';
    }
    if (input.namespace !== undefined) {
      out.namespace = stripControlChars(input.namespace, 64) || 'default';
    }
    return out;
  }
  return Boolean(input);
}

function sanitizeWebSearchSetting(input, prevValue = false) {
  if (input === undefined) return prevValue;
  if (typeof input === 'boolean') return input;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const out = {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : true
    };
    const rawEndpoint = input.endpointUrl ?? input.searchUrl ?? '';
    if (rawEndpoint !== '') {
      const cleanUrl = validateHttpEndpointUrl(String(rawEndpoint));
      if (!cleanUrl.startsWith('https://')) {
        throw Object.assign(new Error('公网代搜端点必须使用 https: 协议'), {
          code: 'INVALID_ENDPOINT_URL'
        });
      }
      out.endpointUrl = cleanUrl;
    }
    if (input.maxResults !== undefined) {
      const n = Math.round(Number(input.maxResults));
      if (Number.isFinite(n) && n >= 1 && n <= 15) {
        out.maxResults = n;
      }
    }
    return out;
  }
  return Boolean(input);
}

function normalizeSpeedRecord(rawSpeed) {
  if (!rawSpeed || typeof rawSpeed !== 'object') return null;
  const ttft = rawSpeed.ttftMs != null && Number.isFinite(Number(rawSpeed.ttftMs))
    ? Math.max(0, Math.round(Number(rawSpeed.ttftMs)))
    : null;
  const total = rawSpeed.totalMs != null && Number.isFinite(Number(rawSpeed.totalMs))
    ? Math.max(0, Math.round(Number(rawSpeed.totalMs)))
    : null;
  const tps = rawSpeed.tokPerSec != null && Number.isFinite(Number(rawSpeed.tokPerSec))
    ? Math.max(0, Math.round(Number(rawSpeed.tokPerSec) * 100) / 100)
    : null;
  return {
    ok: Boolean(rawSpeed.ok),
    ttftMs: ttft,
    totalMs: total,
    tokPerSec: tps,
    checkedAt: typeof rawSpeed.checkedAt === 'string' && rawSpeed.checkedAt.trim()
      ? stripControlChars(rawSpeed.checkedAt, 48)
      : new Date().toISOString(),
    error: rawSpeed.error ? redactErrorSnippet(rawSpeed.error) : ''
  };
}

function assertPathNotSymlink(targetPath, label) {
  let st;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw Object.assign(
      new Error(`安全拒绝：${label} 不能为符号链接 (${targetPath})`),
      { code: 'SYMLINK_REJECTED' }
    );
  }
  return st;
}

function ensureSafeParentDir0700(dirPath) {
  const existingStat = assertPathNotSymlink(dirPath, '配置父目录');
  if (existingStat && !existingStat.isDirectory()) {
    throw Object.assign(new Error(`配置父路径不是目录: ${dirPath}`), {
      code: 'INVALID_PROFILE_DIR'
    });
  }
  if (!existingStat) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  const postStat = assertPathNotSymlink(dirPath, '配置父目录');
  if (!postStat || !postStat.isDirectory()) {
    throw Object.assign(new Error(`无法初始化安全配置目录: ${dirPath}`), {
      code: 'INVALID_PROFILE_DIR'
    });
  }
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // Non-POSIX filesystems (e.g. Windows / DrvFS) may ignore chmod bits.
  }
}

function writeJsonAtomic0600(targetPath, dataObj) {
  const dir = path.dirname(targetPath);
  ensureSafeParentDir0700(dir);
  assertPathNotSymlink(targetPath, '配置文件');

  const serialized = `${JSON.stringify(dataObj, null, 2)}\n`;
  const tmpName = `.prism-profile-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  try {
    fs.writeFileSync(tmpPath, serialized, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // Ignore chmod no-op on non-POSIX mounts.
    }

    assertPathNotSymlink(targetPath, '配置文件');

    try {
      fs.renameSync(tmpPath, targetPath);
    } catch (renameErr) {
      if (
        process.platform === 'win32' &&
        (renameErr?.code === 'EPERM' || renameErr?.code === 'EACCES' || renameErr?.code === 'EEXIST')
      ) {
        assertPathNotSymlink(targetPath, '配置文件');
        fs.rmSync(targetPath, { force: true });
        fs.renameSync(tmpPath, targetPath);
      } else {
        throw renameErr;
      }
    }

    try {
      fs.chmodSync(targetPath, 0o600);
    } catch {
      // Ignore chmod no-op on non-POSIX mounts.
    }
  } finally {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
    } catch {
      // Best-effort cleanup of temp file.
    }
  }
}

export function createPrismProfileManager({
  homeDir,
  profilePath: customProfilePath,
  secretStore = null,
  env = process.env
} = {}) {
  const resolvedHome = path.resolve(homeDir || os.homedir());
  const profilePath = customProfilePath
    ? path.resolve(customProfilePath)
    : path.join(resolvedHome, '.gemini', 'antigravity', 'anti-claude', 'prism-profile.json');

  function sanitizeStoredProvider(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let id;
    try {
      id = sanitizeProviderId(raw.id);
    } catch {
      return null;
    }
    const presetKey = typeof raw.preset === 'string' && Object.hasOwn(PROVIDER_PRESETS, raw.preset)
      ? raw.preset
      : '';
    const preset = presetKey ? PROVIDER_PRESETS[presetKey] : null;
    const protocol = normalizeProtocol(raw.protocol, preset?.protocol || 'openai-chat', false);

    let baseUrl;
    try {
      baseUrl = validateHttpEndpointUrl(raw.baseUrl || preset?.defaultBaseUrl || '');
    } catch {
      return null;
    }

    let apiKeyEnv = '';
    if (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim() !== '') {
      try {
        apiKeyEnv = validateEnvVarName(raw.apiKeyEnv);
      } catch {
        apiKeyEnv = '';
      }
    }

    const hasVaultKey = Boolean(raw.hasVaultKey);
    const allowKeyless = raw.allowKeyless !== undefined
      ? Boolean(raw.allowKeyless)
      : (presetKey === 'ollama-local' || (!apiKeyEnv && !hasVaultKey && isLoopbackUrl(baseUrl)));

    // Explicitly omit any raw apiKey/secret fields even if manually placed in JSON.
    return {
      id,
      label: stripControlChars(raw.label ?? raw.name ?? preset?.label ?? id, 120) || id,
      preset: presetKey,
      protocol,
      baseUrl,
      apiKeyEnv,
      hasVaultKey,
      allowKeyless,
      enabled: raw.enabled !== false,
      updatedAt: typeof raw.updatedAt === 'string' ? stripControlChars(raw.updatedAt, 48) : null
    };
  }

  function sanitizeStoredModel(raw, providerIds) {
    if (!raw || typeof raw !== 'object') return null;
    let id;
    let providerId;
    try {
      id = sanitizeModelId(raw.id);
      providerId = sanitizeProviderId(raw.providerId);
    } catch {
      return null;
    }
    if (!providerIds.has(providerId)) return null;

    const upstreamModel = stripControlChars(raw.upstreamModel || id, 160);
    if (!upstreamModel) return null;

    let fallbackModelId = '';
    if (typeof raw.fallbackModelId === 'string' && raw.fallbackModelId.trim()) {
      try {
        const candidate = sanitizeModelId(raw.fallbackModelId);
        if (candidate !== id) fallbackModelId = candidate;
      } catch {
        fallbackModelId = '';
      }
    }

    const maxTokensRaw = Number(raw.maxTokens);
    const maxTokens = Number.isFinite(maxTokensRaw) && maxTokensRaw >= 1
      ? Math.min(1048576, Math.round(maxTokensRaw))
      : 4096;

    return {
      id,
      alias: stripControlChars(raw.alias || id, 120) || id,
      providerId,
      upstreamModel,
      tier: normalizeTier(raw.tier, 'T2', false),
      vendor: normalizeVendor(raw.vendor, 'other', false),
      roleHint: stripControlChars(raw.roleHint || '', 240),
      fallbackModelId,
      enabled: raw.enabled !== false,
      maxTokens,
      lastSpeed: normalizeSpeedRecord(raw.lastSpeed)
    };
  }

  function sanitizeLoadedProfile(rawObj) {
    const base = createEmptyProfile();
    if (!rawObj || typeof rawObj !== 'object') return base;

    const rawSettings = rawObj.settings && typeof rawObj.settings === 'object' ? rawObj.settings : {};
    let remoteMemory = false;
    try {
      remoteMemory = sanitizeRemoteMemorySetting(rawSettings.remoteMemory, false);
    } catch {
      remoteMemory = false;
    }
    let webSearch = false;
    try {
      webSearch = sanitizeWebSearchSetting(rawSettings.webSearch, false);
    } catch {
      webSearch = false;
    }

    base.updatedAt = typeof rawObj.updatedAt === 'string' ? stripControlChars(rawObj.updatedAt, 48) : null;
    base.settings = {
      remoteMemory,
      webSearch,
      defaultTier: normalizeTier(rawSettings.defaultTier, 'T2', false),
      redactOutboundSecrets: rawSettings.redactOutboundSecrets !== undefined
        ? Boolean(rawSettings.redactOutboundSecrets)
        : true
    };

    const providerSeen = new Set();
    if (Array.isArray(rawObj.providers)) {
      for (const item of rawObj.providers) {
        const p = sanitizeStoredProvider(item);
        if (p && !providerSeen.has(p.id)) {
          providerSeen.add(p.id);
          base.providers.push(p);
        }
      }
    }

    const modelSeen = new Set();
    if (Array.isArray(rawObj.models)) {
      for (const item of rawObj.models) {
        const m = sanitizeStoredModel(item, providerSeen);
        if (m && !modelSeen.has(m.id)) {
          modelSeen.add(m.id);
          base.models.push(m);
        }
      }
    }

    if (Array.isArray(rawObj.favorites)) {
      const favSet = new Set();
      for (const favId of rawObj.favorites) {
        const cleanId = typeof favId === 'string' ? favId.trim() : '';
        if (cleanId && modelSeen.has(cleanId) && !favSet.has(cleanId)) {
          favSet.add(cleanId);
          base.favorites.push(cleanId);
        }
      }
    }

    return base;
  }

  function loadProfile() {
    const dir = path.dirname(profilePath);
    assertPathNotSymlink(dir, '配置父目录');
    const fileStat = assertPathNotSymlink(profilePath, '配置文件');
    if (!fileStat) {
      return createEmptyProfile();
    }
    if (!fileStat.isFile()) {
      throw Object.assign(new Error(`配置文件路径不是普通文件: ${profilePath}`), {
        code: 'INVALID_PROFILE_FILE'
      });
    }
    const rawText = fs.readFileSync(profilePath, 'utf8');
    if (!rawText.trim()) {
      return createEmptyProfile();
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw Object.assign(
        new Error(`解析 prism-profile.json 失败: ${err?.message || 'Invalid JSON'}`),
        { code: 'CORRUPT_PROFILE_JSON' }
      );
    }
    return sanitizeLoadedProfile(parsed);
  }

  function saveProfile(profile) {
    const toWrite = {
      schemaVersion: PRISM_PROFILE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      settings: profile.settings,
      providers: profile.providers.map((p) => ({
        id: p.id,
        label: p.label,
        preset: p.preset || '',
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        apiKeyEnv: p.apiKeyEnv || '',
        hasVaultKey: Boolean(p.hasVaultKey),
        allowKeyless: Boolean(p.allowKeyless),
        enabled: p.enabled !== false,
        updatedAt: p.updatedAt || new Date().toISOString()
      })),
      models: profile.models.map((m) => ({
        id: m.id,
        alias: m.alias,
        providerId: m.providerId,
        upstreamModel: m.upstreamModel,
        tier: m.tier,
        vendor: m.vendor,
        roleHint: m.roleHint || '',
        fallbackModelId: m.fallbackModelId || '',
        enabled: m.enabled !== false,
        maxTokens: m.maxTokens,
        lastSpeed: m.lastSpeed ? normalizeSpeedRecord(m.lastSpeed) : null
      })),
      favorites: Array.from(profile.favorites)
    };
    writeJsonAtomic0600(profilePath, toWrite);
    return toWrite;
  }

  function enrichPublicProvider(p) {
    const envConfigured = Boolean(p.apiKeyEnv && typeof env[p.apiKeyEnv] === 'string' && env[p.apiKeyEnv].trim() !== '');
    const hasVaultKey = Boolean(p.hasVaultKey);
    const ready = p.enabled !== false && (hasVaultKey || envConfigured || Boolean(p.allowKeyless));
    return {
      id: p.id,
      label: p.label,
      preset: p.preset || '',
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      apiKeyEnv: p.apiKeyEnv || '',
      envConfigured,
      hasVaultKey,
      allowKeyless: Boolean(p.allowKeyless),
      enabled: p.enabled !== false,
      ready,
      updatedAt: p.updatedAt
    };
  }

  function getPublicProfile() {
    const profile = loadProfile();
    const publicProviders = profile.providers.map(enrichPublicProvider);
    const providerReadyMap = new Map(publicProviders.map((p) => [p.id, p.ready]));
    const favoriteSet = new Set(profile.favorites);

    const publicModels = profile.models.map((m) => ({
      id: m.id,
      alias: m.alias,
      providerId: m.providerId,
      upstreamModel: m.upstreamModel,
      tier: m.tier,
      vendor: m.vendor,
      roleHint: m.roleHint || '',
      fallbackModelId: m.fallbackModelId || '',
      enabled: m.enabled !== false,
      maxTokens: m.maxTokens,
      isFavorite: favoriteSet.has(m.id),
      ready: m.enabled !== false && Boolean(providerReadyMap.get(m.providerId)),
      lastSpeed: m.lastSpeed ? { ...m.lastSpeed } : null
    }));

    return {
      schemaVersion: PRISM_PROFILE_SCHEMA_VERSION,
      profilePath,
      updatedAt: profile.updatedAt,
      settings: structuredClone(profile.settings),
      providers: publicProviders,
      models: publicModels,
      favorites: [...profile.favorites],
      presets: PROVIDER_PRESETS,
      tiers: TIER_DEFINITIONS
    };
  }

  function updateSettings({
    remoteMemory,
    webSearch,
    defaultTier,
    redactOutboundSecrets
  } = {}) {
    const profile = loadProfile();
    const prev = profile.settings || createDefaultSettings();

    const nextSettings = {
      remoteMemory: sanitizeRemoteMemorySetting(remoteMemory, prev.remoteMemory),
      webSearch: sanitizeWebSearchSetting(webSearch, prev.webSearch),
      defaultTier: defaultTier !== undefined
        ? normalizeTier(defaultTier, prev.defaultTier || 'T2', true)
        : (prev.defaultTier || 'T2'),
      redactOutboundSecrets: redactOutboundSecrets !== undefined
        ? Boolean(redactOutboundSecrets)
        : (prev.redactOutboundSecrets !== false)
    };

    profile.settings = nextSettings;
    saveProfile(profile);
    return structuredClone(nextSettings);
  }

  function upsertProvider(providerInput = {}) {
    if (!providerInput || typeof providerInput !== 'object') {
      throw Object.assign(new Error('Provider 参数必须为对象'), { code: 'INVALID_PROVIDER_INPUT' });
    }
    const id = sanitizeProviderId(providerInput.id);
    const profile = loadProfile();
    const existingIdx = profile.providers.findIndex((p) => p.id === id);
    const existing = existingIdx >= 0 ? profile.providers[existingIdx] : null;

    const presetKey = providerInput.preset !== undefined
      ? (Object.hasOwn(PROVIDER_PRESETS, providerInput.preset) ? providerInput.preset : '')
      : (existing?.preset || '');
    const preset = presetKey ? PROVIDER_PRESETS[presetKey] : null;

    const protocol = providerInput.protocol !== undefined
      ? normalizeProtocol(providerInput.protocol, preset?.protocol || 'openai-chat', true)
      : (existing?.protocol || preset?.protocol || 'openai-chat');

    const rawBaseUrl = providerInput.baseUrl !== undefined
      ? providerInput.baseUrl
      : (existing?.baseUrl || preset?.defaultBaseUrl || '');
    const baseUrl = validateHttpEndpointUrl(rawBaseUrl);

    let apiKeyEnv;
    if (providerInput.apiKeyEnv !== undefined) {
      const rawEnv = String(providerInput.apiKeyEnv ?? '').trim();
      apiKeyEnv = rawEnv === '' ? '' : validateEnvVarName(rawEnv);
    } else if (existing) {
      apiKeyEnv = existing.apiKeyEnv || '';
    } else if (preset?.suggestedEnv) {
      apiKeyEnv = validateEnvVarName(preset.suggestedEnv);
    } else {
      apiKeyEnv = '';
    }

    let hasVaultKey = Boolean(existing?.hasVaultKey);
    const hasFreshApiKey = typeof providerInput.apiKey === 'string' && providerInput.apiKey.trim() !== '';
    if (existing) {
      let oldOrigin = '';
      let newOrigin = '';
      try {
        oldOrigin = new URL(existing.baseUrl).origin.toLowerCase();
        newOrigin = new URL(baseUrl).origin.toLowerCase();
      } catch {}
      if (oldOrigin && newOrigin && oldOrigin !== newOrigin) {
        if (hasVaultKey && !hasFreshApiKey && providerInput.clearVaultKey !== true && providerInput.apiKey !== null) {
          throw Object.assign(
            new Error(`安全拦截：修改已绑定系统凭据库密钥的网关主机 (${oldOrigin} → ${newOrigin}) 时，必须重新录入 API Key 或先清除原凭据库密钥，以防密钥发往非预期端点`),
            { code: 'ORIGIN_REBIND_REQUIRES_KEY' }
          );
        }
        const explicitlyResuppliedEnv = typeof providerInput.apiKeyEnv === 'string' && providerInput.apiKeyEnv.trim() !== '';
        if (existing.apiKeyEnv && apiKeyEnv && providerInput.confirmOriginRebind !== true && !explicitlyResuppliedEnv) {
          throw Object.assign(
            new Error(`安全拦截：修改已绑定环境变量 (${existing.apiKeyEnv}) 的网关主机 (${oldOrigin} → ${newOrigin}) 时，必须显式确认 confirmOriginRebind 或重新指定 apiKeyEnv，以防密钥发往非预期端点`),
            { code: 'ORIGIN_REBIND_REQUIRES_KEY' }
          );
        }
      }
    }
    if (providerInput.clearVaultKey === true || providerInput.apiKey === null) {
      if (secretStore && typeof secretStore.deleteSecret === 'function') {
        secretStore.deleteSecret(id);
      }
      hasVaultKey = false;
    } else if (hasFreshApiKey) {
      if (!secretStore || typeof secretStore.setSecret !== 'function') {
        throw Object.assign(
          new Error('未注入系统隔离凭据库 (secretStore)，禁止接收或落盘明文 API Key；请使用环境变量 apiKeyEnv'),
          { code: 'SECRET_STORE_UNAVAILABLE' }
        );
      }
      secretStore.setSecret(id, providerInput.apiKey.trim());
      hasVaultKey = true;
    }

    const allowKeyless = providerInput.allowKeyless !== undefined
      ? Boolean(providerInput.allowKeyless)
      : (existing && providerInput.preset === undefined && providerInput.baseUrl === undefined
        ? Boolean(existing.allowKeyless)
        : (presetKey === 'ollama-local' || (!apiKeyEnv && !hasVaultKey && isLoopbackUrl(baseUrl))));

    const labelRaw = providerInput.label ?? providerInput.name ?? existing?.label ?? preset?.label ?? id;
    const record = {
      id,
      label: stripControlChars(labelRaw, 120) || id,
      preset: presetKey,
      protocol,
      baseUrl,
      apiKeyEnv,
      hasVaultKey,
      allowKeyless,
      enabled: providerInput.enabled !== undefined
        ? Boolean(providerInput.enabled)
        : (existing ? existing.enabled !== false : true),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      profile.providers[existingIdx] = record;
    } else {
      profile.providers.push(record);
    }

    saveProfile(profile);
    return enrichPublicProvider(record);
  }

  function removeProvider(providerId) {
    const cleanId = sanitizeProviderId(providerId);
    const profile = loadProfile();
    const beforeCount = profile.providers.length;
    profile.providers = profile.providers.filter((p) => p.id !== cleanId);
    const removed = profile.providers.length !== beforeCount;

    if (secretStore && typeof secretStore.deleteSecret === 'function') {
      try {
        secretStore.deleteSecret(cleanId);
      } catch {
        // Ensure profile cleanup completes even if external vault entry was already absent.
      }
    }

    // Remove models bound to this provider and scrub dangling favorites / fallback references
    const removedModelIds = new Set();
    profile.models = profile.models.filter((m) => {
      if (m.providerId === cleanId) {
        removedModelIds.add(m.id);
        return false;
      }
      return true;
    });

    if (removedModelIds.size > 0) {
      profile.favorites = profile.favorites.filter((favId) => !removedModelIds.has(favId));
      for (const m of profile.models) {
        if (m.fallbackModelId && removedModelIds.has(m.fallbackModelId)) {
          m.fallbackModelId = '';
        }
      }
    }

    if (removed || removedModelIds.size > 0) {
      saveProfile(profile);
    }

    return {
      removed,
      providerId: cleanId,
      removedModelIds: Array.from(removedModelIds)
    };
  }

  function upsertModel(modelInput = {}) {
    if (!modelInput || typeof modelInput !== 'object') {
      throw Object.assign(new Error('Model 参数必须为对象'), { code: 'INVALID_MODEL_INPUT' });
    }
    const id = sanitizeModelId(modelInput.id);
    const profile = loadProfile();
    const existingIdx = profile.models.findIndex((m) => m.id === id);
    const existing = existingIdx >= 0 ? profile.models[existingIdx] : null;

    const providerId = sanitizeProviderId(modelInput.providerId ?? existing?.providerId);
    if (!profile.providers.some((p) => p.id === providerId)) {
      throw Object.assign(new Error(`关联的 Provider "${providerId}" 不存在`), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }

    const upstreamModel = stripControlChars(
      modelInput.upstreamModel !== undefined ? modelInput.upstreamModel : (existing?.upstreamModel ?? id),
      160
    );
    if (!upstreamModel) {
      throw Object.assign(new Error('upstreamModel 不能为空'), {
        code: 'INVALID_UPSTREAM_MODEL'
      });
    }

    const tier = modelInput.tier !== undefined
      ? normalizeTier(modelInput.tier, profile.settings.defaultTier || 'T2', true)
      : (existing?.tier || profile.settings.defaultTier || 'T2');

    const vendor = modelInput.vendor !== undefined
      ? normalizeVendor(modelInput.vendor, 'other', true)
      : (existing?.vendor || 'other');

    let fallbackModelId = existing?.fallbackModelId || '';
    if (modelInput.fallbackModelId !== undefined) {
      const rawFb = String(modelInput.fallbackModelId ?? '').trim();
      if (rawFb === '') {
        fallbackModelId = '';
      } else {
        const cleanFb = sanitizeModelId(rawFb);
        if (cleanFb === id) {
          throw Object.assign(new Error('模型 fallbackModelId 不能指向自身'), {
            code: 'SELF_FALLBACK_INVALID'
          });
        }
        fallbackModelId = cleanFb;
      }
    }

    let maxTokens = existing?.maxTokens ?? 4096;
    if (modelInput.maxTokens !== undefined) {
      const parsedMax = Math.round(Number(modelInput.maxTokens));
      if (!Number.isFinite(parsedMax) || parsedMax < 1 || parsedMax > 1048576) {
        throw Object.assign(new Error('maxTokens 必须为 1–1048576 之间的正整数'), {
          code: 'INVALID_MAX_TOKENS'
        });
      }
      maxTokens = parsedMax;
    }

    const aliasRaw = modelInput.alias !== undefined ? modelInput.alias : (existing?.alias || id);
    const roleHintRaw = modelInput.roleHint !== undefined ? modelInput.roleHint : (existing?.roleHint || '');

    const record = {
      id,
      alias: stripControlChars(aliasRaw, 120) || id,
      providerId,
      upstreamModel,
      tier,
      vendor,
      roleHint: stripControlChars(roleHintRaw, 240),
      fallbackModelId,
      enabled: modelInput.enabled !== undefined
        ? Boolean(modelInput.enabled)
        : (existing ? existing.enabled !== false : true),
      maxTokens,
      lastSpeed: existing?.lastSpeed ? { ...existing.lastSpeed } : null
    };

    if (existingIdx >= 0) {
      profile.models[existingIdx] = record;
    } else {
      profile.models.push(record);
    }

    if (modelInput.favorite === true && !profile.favorites.includes(id)) {
      profile.favorites.push(id);
    } else if (modelInput.favorite === false) {
      profile.favorites = profile.favorites.filter((favId) => favId !== id);
    }

    saveProfile(profile);
    return structuredClone(record);
  }

  function removeModel(modelId) {
    const cleanId = sanitizeModelId(modelId);
    const profile = loadProfile();
    const beforeCount = profile.models.length;
    profile.models = profile.models.filter((m) => m.id !== cleanId);
    const removed = profile.models.length !== beforeCount;

    profile.favorites = profile.favorites.filter((favId) => favId !== cleanId);
    for (const m of profile.models) {
      if (m.fallbackModelId === cleanId) {
        m.fallbackModelId = '';
      }
    }

    if (removed) {
      saveProfile(profile);
    }
    return { removed, modelId: cleanId };
  }

  function reorderFavorites(orderedIds = []) {
    if (!Array.isArray(orderedIds)) {
      throw Object.assign(new Error('orderedIds 必须为数组'), {
        code: 'INVALID_FAVORITES_INPUT'
      });
    }
    const profile = loadProfile();
    const validModelIds = new Set(profile.models.map((m) => m.id));
    const seen = new Set();
    const cleaned = [];

    for (const item of orderedIds) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed || !validModelIds.has(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleaned.push(trimmed);
    }

    profile.favorites = cleaned;
    saveProfile(profile);
    return [...cleaned];
  }

  function recordModelSpeed(modelId, speedObj = {}) {
    const cleanId = sanitizeModelId(modelId);
    const profile = loadProfile();
    const target = profile.models.find((m) => m.id === cleanId);
    if (!target) {
      throw Object.assign(new Error(`未找到模型 "${cleanId}"`), {
        code: 'MODEL_NOT_FOUND'
      });
    }
    const normalized = normalizeSpeedRecord(speedObj || {});
    target.lastSpeed = normalized;
    saveProfile(profile);
    return structuredClone(normalized);
  }

  /**
   * Internal server-only credential resolver for model-hub.mjs.
   * Order: secretStore.getSecret(providerId) -> env[provider.apiKeyEnv].
   * Returned object masks `apiKey` from JSON.stringify and util.inspect so it
   * can never be accidentally serialized outward.
   */
  function resolveProviderAuth(providerId) {
    const cleanId = sanitizeProviderId(providerId);
    const profile = loadProfile();
    const provider = profile.providers.find((p) => p.id === cleanId);
    if (!provider) {
      throw Object.assign(new Error(`未找到 Provider "${cleanId}"`), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }

    let apiKey = '';
    let source = 'none';

    if (provider.hasVaultKey && secretStore && typeof secretStore.getSecret === 'function') {
      const vaultSecret = secretStore.getSecret(provider.id);
      if (typeof vaultSecret === 'string' && vaultSecret.trim() !== '') {
        apiKey = vaultSecret.trim();
        source = 'vault';
      }
    }

    if (!apiKey && provider.apiKeyEnv) {
      const envSecret = env[provider.apiKeyEnv];
      if (typeof envSecret === 'string' && envSecret.trim() !== '') {
        apiKey = envSecret.trim();
        source = 'env';
      }
    }

    const authResult = {
      providerId: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      allowKeyless: Boolean(provider.allowKeyless),
      enabled: provider.enabled !== false,
      source,
      hasApiKey: Boolean(apiKey),
      toJSON() {
        return {
          providerId: provider.id,
          protocol: provider.protocol,
          source,
          hasApiKey: Boolean(apiKey)
        };
      },
      [Symbol.for('nodejs.util.inspect.custom')]() {
        return `[PrismProviderAuth provider=${provider.id} source=${source} hasApiKey=${Boolean(apiKey)}]`;
      }
    };

    Object.defineProperty(authResult, 'apiKey', {
      value: apiKey,
      enumerable: false,
      writable: false,
      configurable: false
    });

    return Object.freeze(authResult);
  }

  function batchImportModels({ providerId, items = [] } = {}) {
    const cleanProvId = sanitizeProviderId(providerId);
    if (!Array.isArray(items) || items.length === 0) {
      return { added: 0, skipped: 0, importedIds: [] };
    }
    const profile = loadProfile();
    if (!profile.providers.some((p) => p.id === cleanProvId)) {
      throw Object.assign(new Error(`关联的 Provider "${cleanProvId}" 不存在`), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }
    const existingIds = new Set(profile.models.map((m) => m.id));
    const existingPairKeys = new Set(profile.models.map((m) => `${m.providerId}::${m.upstreamModel}`));
    let added = 0;
    let skipped = 0;
    const importedIds = [];

    for (const raw of items.slice(0, 120)) {
      if (!raw || typeof raw !== 'object') continue;
      const upstreamModel = stripControlChars(raw.upstreamModel || raw.id || '', 160);
      if (!upstreamModel) continue;
      const pairKey = `${cleanProvId}::${upstreamModel}`;
      if (existingPairKeys.has(pairKey)) {
        skipped++;
        continue;
      }
      let candidateId = String(raw.id || upstreamModel).trim().replace(/^models\//i, '').replace(/[^A-Za-z0-9._:/-]+/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 80);
      if (!candidateId || !MODEL_ID_RE.test(candidateId) || candidateId.includes('..')) {
        candidateId = `${cleanProvId}-${added + 1}`;
      }
      if (existingIds.has(candidateId)) {
        const scopedId = `${cleanProvId}-${candidateId}`.slice(0, 95);
        if (existingIds.has(scopedId) || !MODEL_ID_RE.test(scopedId)) {
          skipped++;
          continue;
        }
        candidateId = scopedId;
      }
      const tier = normalizeTier(raw.tier, profile.settings.defaultTier || 'T2', false);
      const vendor = normalizeVendor(raw.vendor, 'other', false);
      const alias = stripControlChars(raw.alias || candidateId, 120) || candidateId;
      const roleHint = stripControlChars(raw.roleHint || '', 240);
      profile.models.push({
        id: candidateId,
        alias,
        providerId: cleanProvId,
        upstreamModel,
        tier,
        vendor,
        roleHint,
        fallbackModelId: '',
        enabled: true,
        maxTokens: 4096,
        lastSpeed: null
      });
      existingIds.add(candidateId);
      existingPairKeys.add(pairKey);
      if (raw.favorite === true && !profile.favorites.includes(candidateId)) {
        profile.favorites.push(candidateId);
      }
      importedIds.push(candidateId);
      added++;
    }

    if (added > 0) {
      saveProfile(profile);
    }
    return { added, skipped, importedIds };
  }

  return {
    profilePath,
    loadProfile,
    getPublicProfile,
    updateSettings,
    upsertProvider,
    removeProvider,
    upsertModel,
    batchImportModels,
    removeModel,
    reorderFavorites,
    recordModelSpeed,
    resolveProviderAuth
  };
}
