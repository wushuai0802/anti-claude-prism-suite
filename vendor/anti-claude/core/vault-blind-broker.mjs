// SPDX-License-Identifier: MIT
/**
 * Zero-dependency Vaultwarden / Bitwarden E2EE Blind Credential Broker & RFC 6238 TOTP Engine.
 *
 * Security invariants:
 * - Designed for a dedicated AI sub-account / sub-vault (physically isolated from personal master vault).
 * - Decrypts Bitwarden EncString (AesCbc256_HmacSha256_B64) strictly in local Broker RAM using node:crypto.
 * - NEVER exposes plaintext passwords, TOTP seeds, or TOTP codes to MCP stdout, logs, disk, or LLM context.
 * - Matches credentials ONLY against trusted browser-verified origins (`scheme + hostname + port`),
 *   explicitly blocking self-injection into the Vaultwarden server origin itself.
 */

import crypto from 'node:crypto';

const ENC_TYPE_AES_CBC_256_B64 = 0;
const ENC_TYPE_AES_CBC_256_HMAC_SHA256_B64 = 2;
const DEFAULT_SYNC_TTL_MS = 10 * 60 * 1000;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeSafeOrigin(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin.toLowerCase();
  } catch {
    return '';
  }
}

export function maskAccountHint(rawUser) {
  const s = String(rawUser || '').trim();
  if (!s) return '(无用户名)';
  const atIdx = s.indexOf('@');
  if (atIdx > 0) {
    const local = s.slice(0, atIdx);
    const domain = s.slice(atIdx + 1);
    const prefix = local.slice(0, Math.min(2, local.length));
    return `${prefix}***@${domain}`;
  }
  if (s.length <= 2) return `${s[0]}***`;
  return `${s.slice(0, 2)}***`;
}

/**
 * Bitwarden's HKDF-Expand (RFC 5869 Step 2 ONLY, using 32-byte masterKey directly as PRK).
 */
export function hkdfExpandSha256(prk32, infoStr) {
  if (!Buffer.isBuffer(prk32) || prk32.length !== 32) {
    throw new Error('Invalid 32-byte PRK for Bitwarden HKDF-Expand');
  }
  return crypto
    .createHmac('sha256', prk32)
    .update(Buffer.from(String(infoStr), 'utf8'))
    .update(Buffer.from([0x01]))
    .digest();
}

export function stretchMasterKey(masterKey32) {
  const encKey = hkdfExpandSha256(masterKey32, 'enc');
  const macKey = hkdfExpandSha256(masterKey32, 'mac');
  return {
    encKey,
    macKey,
    fullKey64: Buffer.concat([encKey, macKey])
  };
}

export function deriveBitwardenMasterKey({
  password,
  email,
  kdf = 0,
  kdfIterations = 600000,
  kdfMemory = 64,
  kdfParallelism = 4
} = {}) {
  const normEmail = String(email || '').trim().toLowerCase();
  const pwStr = String(password || '');
  if (!normEmail || !pwStr) {
    throw Object.assign(new Error('缺少 Vaultwarden 账号邮箱或主密码'), { code: 'VAULT_CREDENTIALS_MISSING' });
  }
  const pwBuf = Buffer.from(pwStr, 'utf8');
  const emailBuf = Buffer.from(normEmail, 'utf8');

  if (Number(kdf) === 1) {
    if (typeof crypto.argon2Sync !== 'function') {
      throw Object.assign(
        new Error('当前 Node 运行时不支持 Argon2id KDF，请使用 Windows Node >= 24 或将 AI 子账号 KDF 设为 PBKDF2-SHA256'),
        { code: 'ARGON2_UNSUPPORTED_RUNTIME' }
      );
    }
    const salt = crypto.createHash('sha256').update(emailBuf).digest();
    const derived = crypto.argon2Sync('argon2id', {
      message: pwBuf,
      nonce: salt,
      parallelism: Math.max(1, Math.min(16, Number(kdfParallelism) || 4)),
      tagLength: 32,
      memory: Math.max(8, Math.min(1024, Number(kdfMemory) || 64)) * 1024,
      passes: Math.max(1, Math.min(32, Number(kdfIterations) || 3))
    });
    return Buffer.from(derived);
  }

  const iterations = Math.max(5000, Math.min(5_000_000, Number(kdfIterations) || 600000));
  return crypto.pbkdf2Sync(pwBuf, emailBuf, iterations, 32, 'sha256');
}

export function deriveMasterPasswordHashB64(masterKey32, password) {
  return crypto
    .pbkdf2Sync(masterKey32, Buffer.from(String(password || ''), 'utf8'), 1, 32, 'sha256')
    .toString('base64');
}

export function decryptBitwardenEncBytes(encString, symKey64) {
  const s = String(encString || '').trim();
  if (!s) return null;
  if (!Buffer.isBuffer(symKey64) || symKey64.length < 32) {
    throw Object.assign(new Error('无效的对称解密密钥长度'), { code: 'INVALID_SYM_KEY' });
  }

  const dotIdx = s.indexOf('.');
  if (dotIdx <= 0) {
    throw Object.assign(new Error('不支持的 EncString 格式'), { code: 'INVALID_ENC_STRING' });
  }
  const encType = Number(s.slice(0, dotIdx));
  const parts = s.slice(dotIdx + 1).split('|');

  if (encType === ENC_TYPE_AES_CBC_256_HMAC_SHA256_B64) {
    if (parts.length < 3 || symKey64.length < 64) {
      throw Object.assign(new Error('Type-2 EncString 缺少 MAC 或 64 字节密钥'), { code: 'INVALID_ENC_STRING' });
    }
    const iv = Buffer.from(parts[0], 'base64');
    const ct = Buffer.from(parts[1], 'base64');
    const mac = Buffer.from(parts[2], 'base64');
    const encKey = symKey64.subarray(0, 32);
    const macKey = symKey64.subarray(32, 64);

    const expectedMac = crypto
      .createHmac('sha256', macKey)
      .update(Buffer.concat([iv, ct]))
      .digest();
    if (expectedMac.length !== mac.length || !crypto.timingSafeEqual(expectedMac, mac)) {
      throw Object.assign(new Error('Vaultwarden 密文 HMAC 校验未通过（主密码错误或密文损坏）'), {
        code: 'VAULT_MAC_FAILED'
      });
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  if (encType === ENC_TYPE_AES_CBC_256_B64) {
    if (parts.length < 2) {
      throw Object.assign(new Error('Type-0 EncString 缺少密文段'), { code: 'INVALID_ENC_STRING' });
    }
    const iv = Buffer.from(parts[0], 'base64');
    const ct = Buffer.from(parts[1], 'base64');
    const encKey = symKey64.subarray(0, 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', encKey, iv);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  throw Object.assign(new Error(`不支持的 Bitwarden 加密类型 (${encType})`), {
    code: 'UNSUPPORTED_ENC_TYPE'
  });
}

export function decryptBitwardenEncString(encString, symKey64) {
  if (!encString) return '';
  const buf = decryptBitwardenEncBytes(encString, symKey64);
  return buf ? buf.toString('utf8') : '';
}

export function encryptBitwardenEncBytesForTest(plainBuf, symKey64, iv = crypto.randomBytes(16)) {
  const encKey = symKey64.subarray(0, 32);
  const macKey = symKey64.subarray(32, 64);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
  const ct = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const mac = crypto
    .createHmac('sha256', macKey)
    .update(Buffer.concat([iv, ct]))
    .digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}

export function decodeBase32Secret(rawBase32) {
  const clean = String(rawBase32 || '')
    .toUpperCase()
    .replace(/[\s=-]+/g, '');
  if (!clean) return Buffer.alloc(0);
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw Object.assign(new Error('TOTP Base32 密钥包含无效字符'), { code: 'INVALID_TOTP_SECRET' });
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Generates RFC 6238 TOTP code in-memory (supports raw Base32, otpauth://totp/..., and steam://...).
 */
export function generateTotpCode(rawTotpSpec, nowMs = Date.now()) {
  const raw = String(rawTotpSpec || '').trim();
  if (!raw) return null;

  let secretBase32 = raw;
  let algorithm = 'sha1';
  let digits = 6;
  let period = 30;
  let isSteam = false;

  if (/^steam:\/\//i.test(raw)) {
    isSteam = true;
    secretBase32 = raw.slice('steam://'.length).trim();
    digits = 5;
  } else if (/^otpauth:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw Object.assign(new Error('无效的 otpauth:// URI'), { code: 'INVALID_TOTP_URI' });
    }
    secretBase32 = parsed.searchParams.get('secret') || '';
    const algoParam = String(parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    if (algoParam === 'SHA256') algorithm = 'sha256';
    else if (algoParam === 'SHA512') algorithm = 'sha512';
    else algorithm = 'sha1';

    const digitsParam = Number(parsed.searchParams.get('digits'));
    if (Number.isInteger(digitsParam) && digitsParam >= 5 && digitsParam <= 10) {
      digits = digitsParam;
    }
    const periodParam = Number(parsed.searchParams.get('period'));
    if (Number.isInteger(periodParam) && periodParam >= 10 && periodParam <= 120) {
      period = periodParam;
    }
    if (String(parsed.searchParams.get('issuer') || '').toLowerCase() === 'steam') {
      isSteam = true;
      digits = 5;
    }
  }

  const keyBuf = decodeBase32Secret(secretBase32);
  if (keyBuf.length === 0) return null;

  const nowSec = Math.floor(Math.max(0, Number(nowMs) || Date.now()) / 1000);
  const counter = BigInt(Math.floor(nowSec / period));
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter, 0);

  const hmac = crypto.createHmac(algorithm, keyBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  let code;
  if (isSteam) {
    const steamChars = '23456789BCDFGHJKMNPQRTVWXY';
    let full = binary;
    let s = '';
    for (let i = 0; i < 5; i++) {
      s += steamChars[full % steamChars.length];
      full = Math.floor(full / steamChars.length);
    }
    code = s;
  } else {
    const mod = 10 ** digits;
    code = String(binary % mod).padStart(digits, '0');
  }

  return {
    code,
    period,
    remainingSec: period - (nowSec % period)
  };
}

export function decryptVaultSyncPayload(syncJson, stretchedMasterKey64, serverOrigin = '') {
  const encUserKey = syncJson?.profile?.key;
  if (!encUserKey || typeof encUserKey !== 'string') {
    throw Object.assign(new Error('Vaultwarden 同步响应缺少加密主密钥 profile.key'), {
      code: 'VAULT_PROFILE_KEY_MISSING'
    });
  }

  const userSymKey64 = decryptBitwardenEncBytes(encUserKey, stretchedMasterKey64);
  if (!userSymKey64 || userSymKey64.length < 64) {
    throw Object.assign(new Error('解密用户对称主密钥失败'), { code: 'VAULT_USER_KEY_INVALID' });
  }

  // Optional organization keys if user shared a read-only AI collection into this sub-account
  const orgKeys = new Map();
  if (Array.isArray(syncJson?.profile?.organizations)) {
    for (const org of syncJson.profile.organizations) {
      if (org?.id && typeof org.key === 'string' && org.key.startsWith('2.')) {
        try {
          const okBuf = decryptBitwardenEncBytes(org.key, userSymKey64);
          if (okBuf && okBuf.length >= 64) orgKeys.set(String(org.id), okBuf);
        } catch {}
      }
    }
  }

  const rawCiphers = Array.isArray(syncJson?.ciphers) ? syncJson.ciphers : [];
  const items = [];
  const normServerOrigin = normalizeSafeOrigin(serverOrigin);

  for (const c of rawCiphers) {
    if (!c || c.deletedDate || Number(c.type) !== 1 || !c.login) continue;
    let baseKey = c.organizationId && orgKeys.has(String(c.organizationId))
      ? orgKeys.get(String(c.organizationId))
      : userSymKey64;
    if (!baseKey) continue;

    let itemKey = baseKey;
    if (typeof c.key === 'string' && c.key.trim()) {
      try {
        const perItem = decryptBitwardenEncBytes(c.key, baseKey);
        if (perItem && perItem.length >= 64) itemKey = perItem;
      } catch {
        continue;
      }
    }

    try {
      const name = c.name ? decryptBitwardenEncString(c.name, itemKey) : '';
      const username = c.login.username ? decryptBitwardenEncString(c.login.username, itemKey) : '';
      const password = c.login.password ? decryptBitwardenEncString(c.login.password, itemKey) : '';
      const totp = c.login.totp ? decryptBitwardenEncString(c.login.totp, itemKey) : '';
      if (!username && !password && !totp) continue;

      const rawUris = Array.isArray(c.login.uris) ? c.login.uris : [];
      const origins = new Set();
      const uriRules = [];
      for (const uEntry of rawUris) {
        if (!uEntry?.uri) continue;
        const matchMode = uEntry.match === null || uEntry.match === undefined ? 0 : Number(uEntry.match);
        // match === 4 (Regex) and match === 5 (Never autofill) are excluded from URL origin indexing
        if (matchMode === 4 || matchMode === 5) continue;
        const decUri = decryptBitwardenEncString(uEntry.uri, itemKey).trim();
        if (!decUri) continue;
        const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(decUri) ? decUri : `https://${decUri}`;
        const orig = normalizeSafeOrigin(withScheme);
        if (!orig) continue;
        if (normServerOrigin && orig === normServerOrigin) continue; // Never self-fill Vaultwarden itself!
        origins.add(orig);
        uriRules.push({ origin: orig, matchMode, fullUri: withScheme });
      }

      if (origins.size === 0) continue;
      items.push({
        id: String(c.id || ''),
        name,
        username,
        password,
        totp,
        accountHint: maskAccountHint(username),
        hasPassword: Boolean(password),
        hasTotp: Boolean(totp),
        origins: [...origins],
        uriRules
      });
    } catch {
      // Skip malformed individual cipher without crashing sync
    }
  }

  return items;
}

export function validateVaultwardenServerUrl(rawUrl, { allowInsecureLocalForTest = false } = {}) {
  const s = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!s) {
    throw Object.assign(new Error('Vaultwarden 服务地址不能为空'), { code: 'INVALID_VAULT_URL' });
  }
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    throw Object.assign(new Error('Vaultwarden 服务地址格式无效'), { code: 'INVALID_VAULT_URL' });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Vaultwarden 地址禁止内嵌凭据'), { code: 'INVALID_VAULT_URL' });
  }
  if (parsed.protocol !== 'https:') {
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!(allowInsecureLocalForTest && parsed.protocol === 'http:' && isLoopback)) {
      throw Object.assign(new Error('Vaultwarden 服务地址必须使用 https:// 加密协议'), {
        code: 'INSECURE_VAULT_URL'
      });
    }
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Creates an in-memory Blind Vault Broker instance.
 * Secrets stay inside private closure variables and are NEVER returned by public metadata methods.
 */
export function createVaultBlindBroker({
  configLoader = null,
  fetchFn = globalThis.fetch,
  nowFn = Date.now,
  syncTtlMs = DEFAULT_SYNC_TTL_MS,
  allowInsecureLocalForTest = false
} = {}) {
  let cachedItemsByOrigin = new Map();
  let totalItemCount = 0;
  let lastSyncedAt = 0;
  let configuredServerOrigin = '';
  let configuredEmailMask = '';
  let allowedOriginSet = null; // null = allow any exact origin stored in the dedicated AI sub-vault
  let lastSyncError = '';
  let syncInFlight = null;

  function clearMemory() {
    cachedItemsByOrigin = new Map();
    totalItemCount = 0;
    lastSyncedAt = 0;
  }

  function parseAllowedOriginsList(rawAllowed) {
    if (!rawAllowed) return null;
    const arr = Array.isArray(rawAllowed)
      ? rawAllowed
      : String(rawAllowed)
          .split(/[\s,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
    if (arr.length === 0 || arr.includes('*')) return null;
    const set = new Set();
    for (const item of arr) {
      const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(item) ? item : `https://${item}`;
      const orig = normalizeSafeOrigin(withScheme);
      if (orig) set.add(orig);
    }
    return set.size > 0 ? set : null;
  }

  async function performSyncWithConfig(cfg) {
    const baseUrl = validateVaultwardenServerUrl(cfg.serverUrl, { allowInsecureLocalForTest });
    const serverOrigin = normalizeSafeOrigin(baseUrl);
    const email = String(cfg.email || '').trim().toLowerCase();
    const masterPassword = String(cfg.masterPassword || '');
    if (!email || !masterPassword) {
      throw Object.assign(new Error('Vaultwarden 配置缺少账号邮箱或主密码'), {
        code: 'VAULT_CREDENTIALS_MISSING'
      });
    }

    // 1. Prelogin to fetch exact KDF parameters
    const preloginRes = await fetchFn(`${baseUrl}/identity/accounts/prelogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ email }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!preloginRes.ok) {
      throw Object.assign(new Error(`Vaultwarden prelogin 失败 (HTTP ${preloginRes.status})`), {
        code: 'VAULT_PRELOGIN_FAILED'
      });
    }
    const prelogin = await preloginRes.json();
    const masterKey = deriveBitwardenMasterKey({
      password: masterPassword,
      email,
      kdf: prelogin?.kdf ?? prelogin?.Kdf ?? 0,
      kdfIterations: prelogin?.kdfIterations ?? prelogin?.KdfIterations ?? 600000,
      kdfMemory: prelogin?.kdfMemory ?? prelogin?.KdfMemory ?? 64,
      kdfParallelism: prelogin?.kdfParallelism ?? prelogin?.KdfParallelism ?? 4
    });
    const stretched = stretchMasterKey(masterKey);

    // 2. Obtain bearer token (prefer Personal API Key client_credentials if configured, else password grant)
    const deviceId = String(cfg.deviceIdentifier || '9f4b3e20-6c51-4a8d-9b12-prismcuablind').trim();
    const form = new URLSearchParams();
    if (cfg.clientId && cfg.clientSecret) {
      form.set('grant_type', 'client_credentials');
      form.set('scope', 'api');
      form.set('client_id', String(cfg.clientId).trim());
      form.set('client_secret', String(cfg.clientSecret).trim());
      form.set('device_identifier', deviceId);
      form.set('device_type', '21');
      form.set('device_name', 'Prism-CUA-Blind-Broker');
    } else {
      form.set('grant_type', 'password');
      form.set('scope', 'api offline_access');
      form.set('client_id', 'cli');
      form.set('username', email);
      form.set('password', deriveMasterPasswordHashB64(masterKey, masterPassword));
      form.set('device_identifier', deviceId);
      form.set('device_type', '21');
      form.set('device_name', 'Prism-CUA-Blind-Broker');
      if (cfg.newDeviceOtp) {
        form.set('newDeviceOtp', String(cfg.newDeviceOtp).trim());
      }
    }

    const tokRes = await fetchFn(`${baseUrl}/identity/connect/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Accept': 'application/json',
        'Auth-Email': Buffer.from(email, 'utf8').toString('base64url')
      },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(12000)
    });
    if (!tokRes.ok) {
      let detail = '';
      try {
        const errObj = await tokRes.json();
        detail = String(errObj?.error_description || errObj?.ErrorModel?.Message || errObj?.error || '').slice(0, 140);
      } catch {}
      throw Object.assign(
        new Error(`Vaultwarden 令牌认证失败 (HTTP ${tokRes.status}${detail ? `: ${detail}` : ''})`),
        { code: 'VAULT_AUTH_FAILED' }
      );
    }
    const tokJson = await tokRes.json();
    const accessToken = String(tokJson?.access_token || '').trim();
    if (!accessToken) {
      throw Object.assign(new Error('Vaultwarden 未返回有效 access_token'), { code: 'VAULT_AUTH_FAILED' });
    }

    // 3. Fetch encrypted vault sync payload and decrypt in local RAM
    const syncRes = await fetchFn(`${baseUrl}/api/sync?excludeDomains=true`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (!syncRes.ok) {
      throw Object.assign(new Error(`Vaultwarden 同步密码库失败 (HTTP ${syncRes.status})`), {
        code: 'VAULT_SYNC_FAILED'
      });
    }
    const syncPayload = await syncRes.json();
    const items = decryptVaultSyncPayload(syncPayload, stretched.fullKey64, serverOrigin);

    const byOrigin = new Map();
    for (const item of items) {
      for (const orig of item.origins) {
        if (!byOrigin.has(orig)) byOrigin.set(orig, []);
        byOrigin.get(orig).push(item);
      }
    }

    cachedItemsByOrigin = byOrigin;
    totalItemCount = items.length;
    configuredServerOrigin = serverOrigin;
    configuredEmailMask = maskAccountHint(email);
    allowedOriginSet = parseAllowedOriginsList(cfg.allowedOrigins);
    lastSyncedAt = nowFn();
    lastSyncError = '';

    return {
      ok: true,
      configured: true,
      itemCount: totalItemCount,
      originCount: byOrigin.size,
      accountMask: configuredEmailMask,
      serverOrigin: configuredServerOrigin
    };
  }

  async function ensureSynced({ force = false } = {}) {
    const now = nowFn();
    if (!force && lastSyncedAt > 0 && now - lastSyncedAt < syncTtlMs) {
      return {
        ok: true,
        configured: true,
        cached: true,
        itemCount: totalItemCount,
        accountMask: configuredEmailMask,
        serverOrigin: configuredServerOrigin
      };
    }
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      if (typeof configLoader !== 'function') {
        clearMemory();
        return { ok: true, configured: false, itemCount: 0 };
      }
      const cfg = await configLoader();
      if (!cfg || cfg.enabled === false || !cfg.serverUrl || !cfg.email || !cfg.masterPassword) {
        clearMemory();
        configuredServerOrigin = '';
        configuredEmailMask = '';
        lastSyncError = '';
        return { ok: true, configured: false, itemCount: 0 };
      }
      try {
        return await performSyncWithConfig(cfg);
      } catch (err) {
        lastSyncError = String(err?.message || err).slice(0, 180);
        throw err;
      }
    })().finally(() => {
      syncInFlight = null;
    });

    return syncInFlight;
  }

  function isOriginPermitted(normOrigin) {
    if (!normOrigin) return false;
    if (configuredServerOrigin && normOrigin === configuredServerOrigin) return false;
    if (allowedOriginSet && !allowedOriginSet.has(normOrigin)) return false;
    return true;
  }

  function matchesItemUriRules(item, rawTabUrl, normOrigin) {
    const rules = Array.isArray(item?.uriRules) ? item.uriRules : [];
    if (rules.length === 0) return item?.origins?.includes(normOrigin) || false;
    const cleanTabUrl = String(rawTabUrl || '').trim();
    for (const rule of rules) {
      if (rule.origin !== normOrigin) continue;
      if (rule.matchMode === 2) {
        if (cleanTabUrl.startsWith(rule.fullUri)) return true;
      } else if (rule.matchMode === 3) {
        if (cleanTabUrl === rule.fullUri) return true;
      } else {
        return true;
      }
    }
    return false;
  }

  /**
   * Public metadata-only lookup safe to attach as a boolean/masked hint in cua_observe.
   * NEVER returns plaintext passwords or TOTP codes.
   */
  async function inspectOriginMatch(rawTabUrl) {
    const normOrigin = normalizeSafeOrigin(rawTabUrl);
    if (!normOrigin) return { matched: false };
    try {
      const syncState = await ensureSynced({ force: false });
      if (!syncState.configured) return { matched: false, configured: false };
    } catch {
      return { matched: false, error: lastSyncError };
    }
    if (!isOriginPermitted(normOrigin)) {
      return { matched: false, blockedByAllowlist: Boolean(allowedOriginSet) };
    }
    const rawCandidates = cachedItemsByOrigin.get(normOrigin) || [];
    const candidates = rawCandidates.filter((it) => matchesItemUriRules(it, rawTabUrl, normOrigin));
    if (candidates.length === 0) {
      return { matched: false, configured: true };
    }
    const primary = candidates[0];
    return {
      matched: true,
      configured: true,
      origin: normOrigin,
      candidateCount: candidates.length,
      accountHint: primary.accountHint,
      hasUsername: Boolean(primary.username),
      hasPassword: primary.hasPassword,
      hasTotp: primary.hasTotp
    };
  }

  /**
   * Internal Broker-only secret resolver for executing atomic blind autofill into a verified tab origin.
   */
  async function resolveBlindFillMaterial(rawVerifiedTabUrl, { accountHintFilter = '' } = {}) {
    const normOrigin = normalizeSafeOrigin(rawVerifiedTabUrl);
    if (!normOrigin) {
      throw Object.assign(new Error('无法校验目标页面的安全同源域 (Origin)'), {
        code: 'VAULT_INVALID_TARGET_ORIGIN'
      });
    }
    const syncState = await ensureSynced({ force: false });
    if (!syncState.configured) {
      throw Object.assign(
        new Error('尚未配置 Vaultwarden 盲注子库（请在 Prism 工作台「电脑操控」点击「配置 Vaultwarden 盲注子库」）'),
        { code: 'VAULT_NOT_CONFIGURED' }
      );
    }
    if (configuredServerOrigin && normOrigin === configuredServerOrigin) {
      throw Object.assign(new Error('安全护栏：禁止向 Vaultwarden 密码库自身页面自动注入凭据'), {
        code: 'VAULT_SELF_ORIGIN_BLOCKED'
      });
    }
    if (!isOriginPermitted(normOrigin)) {
      throw Object.assign(new Error(`当前站点 (${normOrigin}) 不在允许自动盲注的域名白名单内`), {
        code: 'VAULT_ORIGIN_NOT_ALLOWLISTED'
      });
    }

    const rawCandidates = cachedItemsByOrigin.get(normOrigin) || [];
    const candidates = rawCandidates.filter((it) => matchesItemUriRules(it, rawVerifiedTabUrl, normOrigin));
    if (candidates.length === 0) {
      throw Object.assign(
        new Error(`AI 专用 Vaultwarden 子库中未找到与 ${normOrigin} 精确匹配的登录凭据`),
        { code: 'VAULT_NO_MATCHING_ITEM' }
      );
    }

    let chosen = candidates[0];
    if (accountHintFilter) {
      const filt = String(accountHintFilter).trim().toLowerCase();
      const found = candidates.find(
        (c) =>
          c.accountHint.toLowerCase() === filt ||
          c.username.toLowerCase().includes(filt) ||
          c.name.toLowerCase().includes(filt)
      );
      if (found) chosen = found;
    }

    let totpCode = '';
    if (chosen.totp) {
      const gen = generateTotpCode(chosen.totp, nowFn());
      if (gen?.code) totpCode = gen.code;
    }

    return {
      origin: normOrigin,
      accountHint: chosen.accountHint,
      username: chosen.username,
      password: chosen.password,
      totpCode,
      hasTotp: Boolean(chosen.totp)
    };
  }

  function getPublicStatus() {
    return {
      configured: lastSyncedAt > 0 || Boolean(configuredServerOrigin),
      serverOrigin: configuredServerOrigin || null,
      accountMask: configuredEmailMask || null,
      itemCount: totalItemCount,
      lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
      lastError: lastSyncError || null,
      hasOriginAllowlist: Boolean(allowedOriginSet && allowedOriginSet.size > 0)
    };
  }

  return {
    ensureSynced,
    performSyncWithConfig,
    inspectOriginMatch,
    resolveBlindFillMaterial,
    getPublicStatus,
    getConfiguredServerOrigin: () => configuredServerOrigin,
    clearMemory
  };
}
