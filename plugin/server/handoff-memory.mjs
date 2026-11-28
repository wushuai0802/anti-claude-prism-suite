/**
 * Zero-dependency Dual-Mode Slot Handoff Memory Engine for Anti-Claude Prism Suite.
 *
 * Capabilities & Security Invariants:
 * 1. Dual-mode persistence: Native `node:sqlite` (WAL + FTS5) primary engine with
 *    zero-warning dynamic loading and automatic atomic `0o600` JSONL fallback.
 * 2. 9P / DrvFS / SMB / NFS corruption guard (`detectNonNativeSqliteMount`):
 *    Resolves symlinks (including dangling links via nearest existing ancestor),
 *    inspects `/proc/mounts` (Linux/WSL) & UNC/WSL mounts (Windows), and redirects
 *    SQLite WAL databases away from non-native mounts to `0o700` OS-native storage.
 * 3. Multi-process concurrency safety: `busy_timeout = 2500`, `journal_mode = WAL`,
 *    explicit `BEGIN IMMEDIATE ... COMMIT` write transactions, and idempotent
 *    one-shot migration from legacy `handoff-memories.jsonl`.
 * 4. Bilingual FTS5 full-text search: CJK unigram + adjacent bigram segmentation
 *    (`segmentForFts`) paired with syntax-injection-proof `buildSafeFtsMatchQuery`,
 *    combining `bm25()`, literal substring boosts, and 24h/7d recency scoring.
 * 5. Taint Guard & `catalog:master` index: Quarantines untrusted external sources,
 *    blocks tainted writes to `handoff:*` / `catalog:master` (`TAINTED_HANDOFF_BLOCKED`),
 *    and maintains an up-to-date `catalog:master` active slot board.
 * 6. Local-first optional Streamable-HTTP MCP Memory bridge: Fire-and-forget async
 *    `memory_store` push + awaitable `syncRemoteCatalog()` pull with strict URL and
 *    `authEnv` validation and full credential redaction.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { redactSensitiveText } from './redact-shared.mjs';

const MAX_ENTRY_BYTES = 8192;
const MAX_REMOTE_MCP_RESPONSE_BYTES = 1024 * 1024;
const JSONL_LOCK_STALE_MS = 15_000;
const JSONL_LOCK_WAIT_BUDGET_MS = 1500;

const UNSAFE_MOUNT_FS_TYPES = new Set([
  'drvfs',
  '9p',
  '9p2000',
  'cifs',
  'smb3',
  'smbfs',
  'nfs',
  'nfs4',
  'fuse.sshfs',
  'vboxsf'
]);

const UNTRUSTED_SOURCES = new Set([
  'web',
  'browser',
  'cua',
  'window-uia',
  'external-untrusted',
  'remote-mcp'
]);

const DANGEROUS_AUTH_ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PWD',
  'OLDPWD',
  'TMP',
  'TEMP',
  'TMPDIR',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SSH_AUTH_SOCK',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_LS_ADDRESS',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'NPM_TOKEN',
  'AZURE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS'
]);

const FTS_RESERVED_WORDS = new Set(['AND', 'OR', 'NOT', 'NEAR']);

/* ---------------- Zero-Warning node:sqlite Loader ---------------- */

let cachedSqliteProbe = null;

function withSqliteWarningSuppressed(fn) {
  const origEmitWarning = process.emitWarning;
  process.emitWarning = function prismSqliteWarningFilter(warning, ...args) {
    const msg = typeof warning === 'string' ? warning : String(warning?.message || '');
    const arg0 = args[0];
    const type =
      typeof arg0 === 'string'
        ? arg0
        : arg0 && typeof arg0 === 'object' && typeof arg0.type === 'string'
          ? arg0.type
          : warning && typeof warning === 'object' && typeof warning.name === 'string'
            ? warning.name
            : '';
    if (type === 'ExperimentalWarning' && /sqlite/i.test(msg)) {
      return;
    }
    return origEmitWarning.call(this, warning, ...args);
  };
  try {
    return fn();
  } finally {
    process.emitWarning = origEmitWarning;
  }
}

function loadNodeSqliteCapability() {
  if (cachedSqliteProbe) return cachedSqliteProbe;
  cachedSqliteProbe = withSqliteWarningSuppressed(() => {
    try {
      const req = createRequire(import.meta.url);
      const mod = req('node:sqlite');
      if (!mod || typeof mod.DatabaseSync !== 'function') {
        return { available: false, DatabaseSync: null, fts5Supported: false };
      }
      let fts5Supported = false;
      const memDb = new mod.DatabaseSync(':memory:');
      try {
        memDb.exec(
          "CREATE VIRTUAL TABLE prism_fts_probe USING fts5(id UNINDEXED, body_seg, tokenize='unicode61');"
        );
        fts5Supported = true;
      } catch {
        fts5Supported = false;
      } finally {
        try { memDb.close(); } catch {}
      }
      return { available: true, DatabaseSync: mod.DatabaseSync, fts5Supported };
    } catch {
      return { available: false, DatabaseSync: null, fts5Supported: false };
    }
  });
  return cachedSqliteProbe;
}

/* ---------------- Secret Redaction ---------------- */

export function redactMemoryText(text) {
  return redactSensitiveText(text);
}

/* ---------------- 9P / DrvFS / Network Mount Guard ---------------- */

function unescapeProcMountField(raw) {
  return String(raw || '').replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function normalizePosixMountPoint(mp) {
  const clean = String(mp || '').replace(/\/+$/g, '');
  return clean || '/';
}

function resolveRealPathViaAncestors(rawTarget, { platform = process.platform, realpathFn = null } = {}) {
  const isWin = platform === 'win32';
  const pathMod = isWin ? path.win32 : path.posix;
  const rawStr = String(rawTarget || '').trim();
  if (!rawStr) return '';

  const canUseHostFs = !realpathFn && platform === process.platform;
  const effectiveRealpath =
    typeof realpathFn === 'function'
      ? realpathFn
      : canUseHostFs
        ? (fs.realpathSync.native || fs.realpathSync)
        : null;

  const absStart = isWin && (/^(?:\\\\|\/\/)/.test(rawStr) || /^[a-zA-Z]:[\\/]/.test(rawStr))
    ? pathMod.normalize(rawStr)
    : (platform === process.platform ? path.resolve(rawStr) : pathMod.resolve('/', rawStr));

  if (!effectiveRealpath) {
    return absStart;
  }

  function resolveRecursive(targetAbs, depth) {
    if (depth > 16) return targetAbs;
    let cur = targetAbs;
    const suffix = [];
    for (let i = 0; i < 64; i++) {
      try {
        const resolvedBase = effectiveRealpath(cur);
        return suffix.length ? pathMod.join(resolvedBase, ...suffix) : resolvedBase;
      } catch {
        // Handle dangling symlinks when using host fs so symlink -> /mnt/d/nonexistent is still caught
        if (canUseHostFs) {
          try {
            const st = fs.lstatSync(cur);
            if (st.isSymbolicLink()) {
              const linkDest = fs.readlinkSync(cur);
              const nextAbs = pathMod.resolve(pathMod.dirname(cur), linkDest);
              const resolvedLink = resolveRecursive(nextAbs, depth + 1);
              return suffix.length ? pathMod.join(resolvedLink, ...suffix) : resolvedLink;
            }
          } catch {
            // Not an existing symlink; continue walking up to parent
          }
        }
        const parent = pathMod.dirname(cur);
        if (!parent || parent === cur) break;
        suffix.unshift(pathMod.basename(cur));
        cur = parent;
      }
    }
    return targetAbs;
  }

  return resolveRecursive(absStart, 0);
}

function isWindowsUncOrNetworkPath(p) {
  const s = String(p || '').trim();
  if (!s) return { unsafe: false, reason: '', fsType: '' };
  if (/^\\\\\?\\UNC\\/i.test(s)) {
    return { unsafe: true, reason: 'Windows UNC network path (\\\\?\\UNC\\) unsafe for SQLite WAL', fsType: 'unc' };
  }
  if (/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)(?:[\\/]|$)/i.test(s)) {
    return { unsafe: true, reason: 'Windows cross-OS WSL 9P path (\\\\wsl.localhost / \\\\wsl$) unsafe for SQLite WAL', fsType: '9p-wsl' };
  }
  if (/^(?:\\\\|\/\/)(?!\?\\[a-zA-Z]:[\\/])/.test(s)) {
    return { unsafe: true, reason: 'Windows UNC / mapped SMB network share unsafe for SQLite WAL', fsType: 'unc' };
  }
  return { unsafe: false, reason: '', fsType: '' };
}

export function detectNonNativeSqliteMount(
  targetDir,
  { platform = process.platform, mountsText = null, realpathFn = null } = {}
) {
  const rawInput = String(targetDir || '').trim();
  if (!rawInput) {
    return { unsafe: false, reason: '', fsType: '', resolvedPath: '' };
  }

  if (platform === 'win32') {
    const rawCheck = isWindowsUncOrNetworkPath(rawInput);
    const resolvedPath = resolveRealPathViaAncestors(rawInput, { platform, realpathFn }) || rawInput;
    if (rawCheck.unsafe) {
      return { unsafe: true, reason: rawCheck.reason, fsType: rawCheck.fsType, resolvedPath };
    }
    const resolvedCheck = isWindowsUncOrNetworkPath(resolvedPath);
    if (resolvedCheck.unsafe) {
      return {
        unsafe: true,
        reason: `Mapped network drive resolved to UNC (${resolvedCheck.reason})`,
        fsType: resolvedCheck.fsType,
        resolvedPath
      };
    }
    return { unsafe: false, reason: '', fsType: 'local-win32', resolvedPath };
  }

  const resolvedPath = resolveRealPathViaAncestors(rawInput, { platform, realpathFn });
  const normalizedResolved = resolvedPath.length > 1 ? resolvedPath.replace(/\/+$/g, '') : resolvedPath;

  let procMountsRaw = mountsText;
  if (procMountsRaw === null || procMountsRaw === undefined) {
    if (platform === 'linux') {
      try {
        procMountsRaw = fs.readFileSync('/proc/mounts', 'utf8');
      } catch {
        procMountsRaw = '';
      }
    } else {
      procMountsRaw = '';
    }
  }

  let bestMount = null;
  if (procMountsRaw) {
    for (const line of String(procMountsRaw).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;
      const mountPoint = normalizePosixMountPoint(unescapeProcMountField(parts[1]));
      const fsType = unescapeProcMountField(parts[2]).toLowerCase();
      const mountOpts = parts[3] ? unescapeProcMountField(parts[3]).toLowerCase() : '';
      const matches =
        mountPoint === '/' ||
        normalizedResolved === mountPoint ||
        normalizedResolved.startsWith(`${mountPoint}/`);
      if (matches) {
        if (!bestMount || mountPoint.length >= bestMount.mountPoint.length) {
          bestMount = { mountPoint, fsType, mountOpts };
        }
      }
    }
  }

  if (bestMount) {
    const isDrvfsOpt = bestMount.mountOpts.includes('aname=drvfs') || bestMount.mountOpts.includes('drvfs');
    if (UNSAFE_MOUNT_FS_TYPES.has(bestMount.fsType) || isDrvfsOpt) {
      const reportedFs = isDrvfsOpt && bestMount.fsType === '9p' ? '9p/drvfs' : bestMount.fsType;
      return {
        unsafe: true,
        reason: `Path resides on non-native mount ${bestMount.mountPoint} (${reportedFs}); SQLite WAL prohibited`,
        fsType: reportedFs,
        resolvedPath: normalizedResolved
      };
    }
  }

  if (/^\/mnt\/[a-zA-Z](?:\/|$)/.test(normalizedResolved)) {
    return {
      unsafe: true,
      reason: 'WSL /mnt/<drive> DrvFS/9P mount detected by canonical path prefix; SQLite WAL prohibited',
      fsType: bestMount?.fsType || 'drvfs',
      resolvedPath: normalizedResolved
    };
  }

  return {
    unsafe: false,
    reason: '',
    fsType: bestMount?.fsType || 'native',
    resolvedPath: normalizedResolved
  };
}

/* ---------------- Bilingual FTS5 Segmentation & Safe Query Builder ---------------- */

const TOKEN_SCAN_RE = /[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
const CJK_TEST_RE = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/;

export function segmentForFts(text) {
  const src = String(text ?? '').replace(/\0/g, ' ').trim();
  if (!src) return '';
  const out = [];
  const matches = src.match(TOKEN_SCAN_RE);
  if (!matches) return '';

  for (const raw of matches) {
    if (CJK_TEST_RE.test(raw)) {
      const chars = Array.from(raw);
      for (let i = 0; i < chars.length; i++) {
        out.push(chars[i]);
      }
      for (let i = 0; i + 1 < chars.length; i++) {
        out.push(chars[i] + chars[i + 1]);
      }
    } else {
      const lower = raw.toLowerCase();
      const subParts = lower.split(/[._-]+/).filter(Boolean);
      if (subParts.length > 1) {
        for (const sp of subParts) out.push(sp);
        // Also emit joined form without punctuation for identifier recall
        out.push(subParts.join(''));
      } else if (subParts.length === 1) {
        out.push(subParts[0]);
      }
    }
  }
  return out.join(' ');
}

export function buildSafeFtsMatchQuery(rawQuery) {
  // Strip NUL and all FTS5 special syntax operators before tokenizing
  const cleaned = String(rawQuery ?? '')
    .replace(/[\0"*^:()+\-\\/|<>~?!@#$%&=[\]{};,'`]+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const tokens = [];
  const seen = new Set();
  const addToken = (tok) => {
    const safe = String(tok || '').replace(/["\0\s]/g, '').toLowerCase();
    if (!safe) return;
    if (FTS_RESERVED_WORDS.has(safe.toUpperCase()) && !/^[a-z0-9]+$/.test(safe)) return;
    if (seen.has(safe)) return;
    seen.add(safe);
    tokens.push(safe);
  };

  const matches = cleaned.match(TOKEN_SCAN_RE);
  if (!matches) return '';

  for (const raw of matches) {
    if (tokens.length >= 32) break;
    if (CJK_TEST_RE.test(raw)) {
      const chars = Array.from(raw);
      // Add adjacent bigrams first (higher precision), then unigrams for recall
      for (let i = 0; i + 1 < chars.length && tokens.length < 32; i++) {
        addToken(chars[i] + chars[i + 1]);
      }
      for (let i = 0; i < chars.length && tokens.length < 32; i++) {
        addToken(chars[i]);
      }
    } else {
      const lower = raw.toLowerCase();
      const subParts = lower.split(/[._-]+/).filter(Boolean);
      for (const sp of subParts) {
        if (tokens.length >= 32) break;
        addToken(sp);
      }
    }
  }

  if (!tokens.length) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

/* ---------------- Helpers & Sanitizers ---------------- */

function normalizeSlug(val, fallback = 'default', maxLen = 40) {
  const s = String(val || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return s || fallback;
}

function isTaintedInput(input = {}) {
  if (input?.tainted === true) return true;
  const src = String(input?.source || '').trim().toLowerCase();
  return UNTRUSTED_SOURCES.has(src);
}

function hasProtectedControlAttempt(input = {}) {
  if (input?.allowSlotOverwrite === true) return true;
  const rawTags = Array.isArray(input?.tags)
    ? input.tags
    : typeof input?.tags === 'string'
      ? [input.tags]
      : [];
  for (const t of rawTags) {
    const clean = String(t || '').trim().toLowerCase();
    if (clean === 'catalog:master' || clean.startsWith('handoff:')) {
      return true;
    }
  }
  return false;
}

function throwTaintedBlockedError() {
  throw Object.assign(
    new Error('安全拦截：不可信外部内容禁止写入或覆写槽位交接与主目录索引'),
    { code: 'TAINTED_HANDOFF_BLOCKED' }
  );
}

function normalizeTags(rawTags, project, slot, tainted = false) {
  const baseTag = tainted ? `quarantine:${project}:${slot}` : `handoff:${project}:${slot}`;
  const set = new Set([`project:${project}`, baseTag]);
  if (tainted) {
    set.add('tainted:quarantine');
  }
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const clean = redactMemoryText(String(t || '').trim()).slice(0, 64);
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (tainted && (lower === 'catalog:master' || lower.startsWith('handoff:'))) {
        continue;
      }
      set.add(clean);
    }
  }
  return Array.from(set).slice(0, 16);
}

function writeJsonAtomic0600(targetPath, payloadStr) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = path.join(dir, `.prism-mem-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  try {
    fs.writeFileSync(tmpPath, payloadStr, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmpPath, 0o600); } catch {}
    fs.renameSync(tmpPath, targetPath);
    try { fs.chmodSync(targetPath, 0o600); } catch {}
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

function writeJsonlAtomic0600(filePath, entries) {
  const payload = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  writeJsonAtomic0600(filePath, payload);
}

function parseJsonlTextLenient(rawText) {
  const cleanRaw = String(rawText || '').replace(/^\uFEFF/, '');
  const items = [];
  for (const line of cleanRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && obj.id) {
        items.push(obj);
      }
    } catch {
      // Skip corrupted line without failing migration or read
    }
  }
  return items;
}

function sanitizeStoredEntry(raw) {
  const nowMs = Number(raw?.createdAtMs) || Date.parse(raw?.createdAt || '') || Date.now();
  const createdAt = String(raw?.createdAt || new Date(nowMs).toISOString());
  const project = normalizeSlug(raw?.project || (raw?.cwd ? path.basename(String(raw.cwd)) : 'workspace'), 'workspace', 48);
  const slot = normalizeSlug(raw?.slot || 'default', 'default', 32);
  const tainted = Boolean(raw?.tainted === true || raw?.visibility === 'quarantine' || UNTRUSTED_SOURCES.has(String(raw?.source || '').trim().toLowerCase()));
  const slotTag = tainted ? `quarantine:${project}:${slot}` : `handoff:${project}:${slot}`;
  const tags = normalizeTags(raw?.tags, project, slot, tainted);

  const entry = {
    id: redactMemoryText(String(raw?.id || `mem-${nowMs}-${crypto.randomBytes(3).toString('hex')}`).trim().slice(0, 80)),
    createdAt: redactMemoryText(createdAt.slice(0, 64)),
    createdAtMs: nowMs,
    project,
    slot,
    slotTag,
    tags,
    source: redactMemoryText(String(raw?.source || 'manual').slice(0, 32)),
    summary: redactMemoryText(String(raw?.summary || '').trim().slice(0, 600)),
    cwd: redactMemoryText(String(raw?.cwd || '').trim().slice(0, 300)),
    gitBranch: redactMemoryText(String(raw?.gitBranch || '').trim().slice(0, 96)),
    gitHead: redactMemoryText(String(raw?.gitHead || '').trim().slice(0, 24)),
    gitDirtyCount: Math.max(0, Math.round(Number(raw?.gitDirtyCount) || 0)),
    conversationPath: redactMemoryText(String(raw?.conversationPath || '').trim().slice(0, 240)),
    verified: redactMemoryText(String(raw?.verified || '').trim().slice(0, 1200)),
    nextAction: redactMemoryText(String(raw?.nextAction || '').trim().slice(0, 800)),
    content: redactMemoryText(String(raw?.content || '').trim().slice(0, 2400)),
    tainted,
    visibility: tainted ? 'quarantine' : 'normal'
  };
  if (!entry.summary) {
    entry.summary = (entry.nextAction || entry.verified || entry.content).slice(0, 160);
  }
  return entry;
}

function boundEntryBytes(entry) {
  while (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_ENTRY_BYTES && entry.content.length > 0) {
    entry.content = entry.content.slice(0, Math.floor(entry.content.length * 0.7));
  }
  while (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_ENTRY_BYTES && entry.verified.length > 0) {
    entry.verified = entry.verified.slice(0, Math.floor(entry.verified.length * 0.7));
  }
  while (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_ENTRY_BYTES && entry.summary.length > 64) {
    entry.summary = entry.summary.slice(0, Math.floor(entry.summary.length * 0.7));
  }
  return entry;
}

function rowToEntry(row) {
  let parsedTags = [];
  try {
    const arr = JSON.parse(row.tags_json || '[]');
    if (Array.isArray(arr)) parsedTags = arr;
  } catch {}
  const tainted = Boolean(row.tainted);
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    createdAtMs: Number(row.created_at_ms) || 0,
    project: String(row.project),
    slot: String(row.slot),
    slotTag: String(row.slot_tag),
    tags: parsedTags,
    source: String(row.source || 'manual'),
    summary: String(row.summary || ''),
    cwd: String(row.cwd || ''),
    gitBranch: String(row.git_branch || ''),
    gitHead: String(row.git_head || ''),
    gitDirtyCount: Number(row.git_dirty_count) || 0,
    conversationPath: String(row.conversation_path || ''),
    verified: String(row.verified || ''),
    nextAction: String(row.next_action || ''),
    content: String(row.content || ''),
    tainted,
    visibility: tainted ? 'quarantine' : String(row.visibility || 'normal')
  };
}

function rowToCatalogSlot(row) {
  let parsedTags = [];
  try {
    const arr = JSON.parse(row.tags_json || '[]');
    if (Array.isArray(arr)) parsedTags = arr;
  } catch {}
  if (!parsedTags.length) {
    parsedTags = ['catalog:master', `project:${row.project}`, `handoff:${row.project}:${row.slot}`];
  }
  return {
    project: String(row.project),
    slot: String(row.slot),
    slotTag: String(row.slot_tag),
    catalogTag: 'catalog:master',
    tags: parsedTags,
    cwd: String(row.cwd || ''),
    summary: String(row.summary || ''),
    gitBranch: String(row.git_branch || ''),
    activeAccount: String(row.active_account || ''),
    status: String(row.status || 'active'),
    updatedAtMs: Number(row.updated_at_ms) || 0,
    updatedAt: String(row.updated_at || ''),
    lastMemoryId: String(row.last_memory_id || ''),
    tainted: Boolean(row.tainted)
  };
}

function computeCombinedSearchScore(entry, cleanQueryLower, queryTokens, ftsRawScore, nowMs) {
  const haySummary = `${entry.summary} ${entry.nextAction}`.toLowerCase();
  const hayTags = (Array.isArray(entry.tags) ? entry.tags.join(' ') : '').toLowerCase();
  const hayBody = `${entry.verified} ${entry.content} ${entry.cwd} ${entry.gitBranch}`.toLowerCase();

  let score = Math.max(0, Number(ftsRawScore) || 0) * 8;
  let matched = Number(ftsRawScore) > 0;

  if (cleanQueryLower) {
    if (haySummary.includes(cleanQueryLower)) {
      score += 25;
      matched = true;
    }
    if (hayTags.includes(cleanQueryLower)) {
      score += 15;
      matched = true;
    }
    if (hayBody.includes(cleanQueryLower)) {
      score += 12;
      matched = true;
    }
  }

  for (const term of queryTokens) {
    let hit = false;
    if (haySummary.includes(term)) { score += 8; hit = true; }
    if (hayTags.includes(term)) { score += 6; hit = true; }
    if (hayBody.includes(term)) { score += 3; hit = true; }
    if (hit) matched = true;
  }

  if (!matched) return null;

  const ageHours = Math.max(0, (nowMs - (Number(entry.createdAtMs) || nowMs)) / 3600000);
  const recencyBonus = ageHours < 24 ? 5 : ageHours < 168 ? 2 : 0;
  return score + recencyBonus;
}

function scrubSecretFromError(err, secret = '') {
  let msg = redactMemoryText(String(err?.message || err || 'Unknown remote error'));
  if (secret && secret.length >= 4) {
    msg = msg.split(secret).join('[REDACTED_TOKEN]');
  }
  return msg.slice(0, 400);
}

/* ---------------- Remote Bridge Config Validation ---------------- */

const REMOTE_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata'
]);

function classifyRemoteHostSafety(rawHostname) {
  let host = String(rawHostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  if (!host || host.includes('%')) return { blocked: true, isPrivateOrLocal: false };
  if (REMOTE_METADATA_HOSTS.has(host)) return { blocked: true, isPrivateOrLocal: false };

  if (host === 'localhost') {
    return { blocked: false, isPrivateOrLocal: true };
  }

  if (net.isIPv4(host)) {
    const [a, b, c, d] = host.split('.').map((x) => Number(x));
    if (a === 0 || (a === 169 && b === 254) || (a === 100 && b === 100 && c === 100 && d === 200) || a >= 224) {
      return { blocked: true, isPrivateOrLocal: false };
    }
    const isPriv =
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    return { blocked: false, isPrivateOrLocal: isPriv };
  }

  if (net.isIPv6(host)) {
    let norm = host;
    const v4Tail = norm.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4Tail && net.isIPv4(v4Tail[2])) {
      const oct = v4Tail[2].split('.').map((x) => Number(x));
      norm = `${v4Tail[1]}${((oct[0] << 8) | oct[1]).toString(16)}:${((oct[2] << 8) | oct[3]).toString(16)}`;
    }
    const halves = norm.split('::');
    if (halves.length > 2) return { blocked: true, isPrivateOrLocal: false };
    const L = halves[0] ? halves[0].split(':') : [];
    const R = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = halves.length === 2 ? 8 - (L.length + R.length) : 0;
    const full = halves.length === 2 ? [...L, ...Array(Math.max(0, missing)).fill('0'), ...R] : L;
    if (full.length !== 8 || full.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
      return { blocked: true, isPrivateOrLocal: false };
    }
    const w = full.map((g) => parseInt(g, 16));
    if (w.every((x) => x === 0) || (w[0] & 0xffc0) === 0xfe80 || (w[0] & 0xff00) === 0xff00) {
      return { blocked: true, isPrivateOrLocal: false };
    }
    if (w[0] === 0xfd00 && w[1] === 0x0ec2 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && w[6] === 0 && w[7] === 0x0254) {
      return { blocked: true, isPrivateOrLocal: false };
    }
    const z5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;
    if (z5 && w[5] === 0 && w[6] === 0 && w[7] === 1) {
      return { blocked: false, isPrivateOrLocal: true };
    }
    if ((z5 && w[5] === 0xffff) || (w[0] === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0)) {
      const embeddedV4 = `${(w[6] >> 8) & 0xff}.${w[6] & 0xff}.${(w[7] >> 8) & 0xff}.${w[7] & 0xff}`;
      return classifyRemoteHostSafety(embeddedV4);
    }
    if ((w[0] & 0xfe00) === 0xfc00) {
      return { blocked: false, isPrivateOrLocal: true };
    }
    return { blocked: false, isPrivateOrLocal: false };
  }

  const isLocalDomain =
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.ts.net');
  return { blocked: false, isPrivateOrLocal: isLocalDomain };
}

function resolveValidatedRemoteConfig(getRemoteConfigFn, staticRemoteConfig) {
  let raw = null;
  try {
    raw = typeof getRemoteConfigFn === 'function' ? getRemoteConfigFn() : staticRemoteConfig;
  } catch (err) {
    return {
      enabled: false,
      valid: false,
      code: 'REMOTE_CONFIG_ERROR',
      error: redactMemoryText(String(err?.message || err))
    };
  }
  if (!raw || typeof raw !== 'object' || !raw.enabled) {
    return { enabled: false, valid: true, url: '', displayUrl: '', bearerToken: '', syncCatalog: false };
  }

  const rawUrl = String(raw.url || '').trim();
  if (!rawUrl) {
    return { enabled: false, valid: true, url: '', displayUrl: '', bearerToken: '', syncCatalog: Boolean(raw.syncCatalog) };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      enabled: true,
      valid: false,
      code: 'INVALID_REMOTE_URL',
      error: '远程 Memory URL 格式不合法'
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      enabled: true,
      valid: false,
      code: 'INVALID_REMOTE_PROTOCOL',
      error: `远程 Memory URL 仅允许 http: 或 https: 协议（当前: ${parsed.protocol}）`
    };
  }

  if (parsed.username || parsed.password) {
    return {
      enabled: true,
      valid: false,
      code: 'REMOTE_URL_CREDENTIALS_FORBIDDEN',
      error: '安全拦截：远程 Memory URL 禁止包含内嵌用户名或密码，请改用 authEnv 环境变量传递凭据'
    };
  }

  const hostCheck = classifyRemoteHostSafety(parsed.hostname);
  if (hostCheck.blocked) {
    return {
      enabled: true,
      valid: false,
      code: 'BLOCKED_METADATA_ENDPOINT',
      error: `安全拦截：禁止将云元数据或保留地址配置为远程 Memory 端点 (${parsed.hostname})`
    };
  }
  if (parsed.protocol === 'http:' && !hostCheck.isPrivateOrLocal) {
    return {
      enabled: true,
      valid: false,
      code: 'INSECURE_REMOTE_HTTP',
      error: '安全拦截：非本机/局域网的远程 Memory 端点必须使用 https: 加密协议'
    };
  }

  let bearerToken = '';
  const authEnv = String(raw.authEnv || '').trim();
  if (authEnv) {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(authEnv) || DANGEROUS_AUTH_ENV_NAMES.has(authEnv)) {
      return {
        enabled: true,
        valid: false,
        code: 'INVALID_AUTH_ENV_NAME',
        error: '远程 Memory authEnv 变量名不合法或命中系统保护变量黑名单'
      };
    }
    const envVal = process.env[authEnv];
    if (typeof envVal === 'string' && envVal.trim()) {
      bearerToken = envVal.trim();
    }
  }

  return {
    enabled: true,
    valid: true,
    url: parsed.toString(),
    displayUrl: `${parsed.origin}${parsed.pathname}`,
    bearerToken,
    syncCatalog: raw.syncCatalog !== false
  };
}

async function readBoundedRemoteResponseText(res, maxBytes = MAX_REMOTE_MCP_RESPONSE_BYTES) {
  const declared = Number(res?.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel?.(); } catch {}
    throw Object.assign(new Error(`远程 MCP 响应体超过 1MB 安全上限 (${declared} bytes)`), {
      code: 'REMOTE_RESPONSE_TOO_LARGE'
    });
  }
  if (res?.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parts = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = value instanceof Uint8Array ? value : Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw Object.assign(new Error('远程 MCP 响应体超过 1MB 安全上限'), {
            code: 'REMOTE_RESPONSE_TOO_LARGE'
          });
        }
        parts.push(decoder.decode(chunk, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join('');
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
  }
  if (typeof res?.text === 'function') {
    const raw = await res.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      throw Object.assign(new Error('远程 MCP 响应体超过 1MB 安全上限'), {
        code: 'REMOTE_RESPONSE_TOO_LARGE'
      });
    }
    return raw;
  }
  return null;
}

async function invokeRemoteMcpRpc(fetchFn, cfg, toolName, toolArgs) {
  if (typeof fetchFn !== 'function') {
    throw new Error('当前运行环境未提供可用的 fetch 实现');
  }
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (cfg.bearerToken) {
    headers.Authorization = `Bearer ${cfg.bearerToken}`;
  }
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `prism-rpc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs
    }
  });

  const res = await fetchFn(cfg.url, {
    method: 'POST',
    redirect: 'error',
    headers,
    body,
    signal: AbortSignal.timeout(4500)
  });

  if (!res || res.ok === false) {
    const status = res?.status ? `HTTP ${res.status}` : 'HTTP request failed';
    throw new Error(`远程 MCP 响应失败 (${status})`);
  }

  const contentType = typeof res.headers?.get === 'function'
    ? String(res.headers.get('content-type') || '').toLowerCase()
    : '';

  let payload = null;
  const rawBodyText = await readBoundedRemoteResponseText(res, MAX_REMOTE_MCP_RESPONSE_BYTES);
  if (rawBodyText !== null) {
    if (contentType.includes('text/event-stream')) {
      const dataLines = rawBodyText
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter((l) => l && l !== '[DONE]');
      if (dataLines.length) {
        payload = JSON.parse(dataLines[dataLines.length - 1]);
      }
    } else {
      payload = rawBodyText ? JSON.parse(rawBodyText) : {};
    }
  } else if (typeof res.json === 'function') {
    payload = await res.json();
    if (Buffer.byteLength(JSON.stringify(payload ?? {}), 'utf8') > MAX_REMOTE_MCP_RESPONSE_BYTES) {
      throw Object.assign(new Error('远程 MCP 响应体超过 1MB 安全上限'), {
        code: 'REMOTE_RESPONSE_TOO_LARGE'
      });
    }
  }

  if (payload?.error) {
    throw new Error(String(payload.error?.message || '远程 MCP tools/call 返回错误'));
  }
  return payload?.result !== undefined ? payload.result : payload;
}

function extractRemoteEntriesFromResult(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  const sc = result.structuredContent;
  if (sc && typeof sc === 'object') {
    for (const key of ['entries', 'memories', 'slots', 'items', 'results']) {
      if (Array.isArray(sc[key])) return sc[key];
    }
  }
  for (const key of ['entries', 'memories', 'slots', 'items', 'results']) {
    if (Array.isArray(result[key])) return result[key];
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const trimmed = block.text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            const nested = extractRemoteEntriesFromResult(parsed);
            if (nested.length) return nested;
          } catch {}
        }
      }
    }
  }
  return [];
}

function parseSlotAndProjectFromTags(tags = []) {
  let project = '';
  let slot = '';
  let isCatalog = false;
  let isHandoff = false;
  for (const raw of tags) {
    const t = String(raw || '').trim();
    const lower = t.toLowerCase();
    if (lower === 'catalog:master') {
      isCatalog = true;
    } else if (lower.startsWith('handoff:')) {
      isHandoff = true;
      const parts = t.split(':');
      if (parts.length >= 3) {
        if (!project) project = parts[1];
        if (!slot) slot = parts.slice(2).join(':');
      }
    } else if (lower.startsWith('project:') && !project) {
      project = t.slice('project:'.length);
    }
  }
  return { project, slot, isCatalog, isHandoff };
}

/* ---------------- Main Store Factory ---------------- */

export function createHandoffMemoryStore(options = {}) {
  const platform = options.platform || process.platform;
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const requestedStateDir = path.resolve(
    options.stateDir || path.join(homeDir, '.gemini', 'antigravity', 'prism-suite')
  );
  const filePath = path.join(requestedStateDir, 'handoff-memories.jsonl');
  const catalogJsonPath = path.join(requestedStateDir, 'handoff-catalog.json');
  const maxEntries = Math.max(2, Math.min(5000, Math.floor(Number(options.maxEntries)) || 500));

  const mountInfo = detectNonNativeSqliteMount(requestedStateDir, {
    platform,
    mountsText: options.mountsText ?? null,
    realpathFn: options.realpathFn ?? null
  });

  const dirHash = crypto
    .createHash('sha256')
    .update(mountInfo.resolvedPath || requestedStateDir)
    .digest('hex')
    .slice(0, 16);

  function resolveNativeFallbackDir() {
    if (options.nativeFallbackDir) {
      return path.resolve(options.nativeFallbackDir);
    }
    // Prefer options.homeDir if safe; otherwise os.homedir(); otherwise os.tmpdir()
    const homeCheck = detectNonNativeSqliteMount(homeDir, { platform });
    if (!homeCheck.unsafe) {
      return path.join(homeDir, '.gemini', 'antigravity', 'prism-suite', 'native-db', dirHash);
    }
    const osHome = path.resolve(os.homedir());
    const osHomeCheck = detectNonNativeSqliteMount(osHome, { platform });
    if (!osHomeCheck.unsafe) {
      return path.join(osHome, '.gemini', 'antigravity', 'prism-suite', 'native-db', dirHash);
    }
    const uidSuffix = typeof process.getuid === 'function' ? String(process.getuid()) : 'local';
    return path.join(os.tmpdir(), `prism-suite-native-db-${uidSuffix}`, dirHash);
  }

  const sqliteCap = options.forceJsonl === true
    ? { available: false, DatabaseSync: null, fts5Supported: false }
    : loadNodeSqliteCapability();

  let backend = sqliteCap.available ? 'sqlite' : 'jsonl';
  let fts5Enabled = backend === 'sqlite' ? sqliteCap.fts5Supported : false;
  const effectiveDbDir = backend === 'sqlite'
    ? (mountInfo.unsafe ? resolveNativeFallbackDir() : requestedStateDir)
    : '';
  let dbPath = backend === 'sqlite' ? path.join(effectiveDbDir, 'handoff-memory.sqlite') : '';

  let db = null;
  let txDepth = 0;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const remoteState = {
    inFlight: 0,
    pushCount: 0,
    pullCount: 0,
    lastPushAt: '',
    lastPushOk: null,
    lastPullAt: '',
    lastPullOk: null,
    lastError: '',
    offline: false
  };

  /* ---------------- SQLite Lifecycle & Immediate Transactions ---------------- */

  function ensureDb() {
    if (backend !== 'sqlite') return null;
    if (db) return db;

    try {
      fs.mkdirSync(effectiveDbDir, { recursive: true, mode: 0o700 });
      if (mountInfo.unsafe || options.nativeFallbackDir) {
        try { fs.chmodSync(effectiveDbDir, 0o700); } catch {}
      }

      const opened = withSqliteWarningSuppressed(() => new sqliteCap.DatabaseSync(dbPath));
      try { fs.chmodSync(dbPath, 0o600); } catch {}

      opened.exec('PRAGMA busy_timeout = 2500;');
      try {
        opened.exec('PRAGMA journal_mode = WAL;');
      } catch {
        try { opened.exec('PRAGMA journal_mode = DELETE;'); } catch {}
      }
      opened.exec('PRAGMA synchronous = NORMAL;');
      opened.exec('PRAGMA foreign_keys = ON;');

      db = opened;

      withWriteTx((database) => {
        database.exec(`
          CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL
          );

          CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            project TEXT NOT NULL,
            slot TEXT NOT NULL,
            slot_tag TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            source TEXT NOT NULL,
            summary TEXT NOT NULL,
            cwd TEXT NOT NULL,
            git_branch TEXT NOT NULL,
            git_head TEXT NOT NULL,
            git_dirty_count INTEGER NOT NULL DEFAULT 0,
            conversation_path TEXT NOT NULL,
            verified TEXT NOT NULL,
            next_action TEXT NOT NULL,
            content TEXT NOT NULL,
            tainted INTEGER NOT NULL DEFAULT 0,
            visibility TEXT NOT NULL DEFAULT 'normal'
          );

          CREATE INDEX IF NOT EXISTS idx_memories_chron
            ON memories(tainted, created_at_ms DESC, id DESC);
          CREATE INDEX IF NOT EXISTS idx_memories_proj_slot
            ON memories(project, slot, tainted, created_at_ms DESC);

          CREATE TABLE IF NOT EXISTS catalog_slots (
            project TEXT NOT NULL,
            slot TEXT NOT NULL,
            slot_tag TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            cwd TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            git_branch TEXT NOT NULL DEFAULT '',
            active_account TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            updated_at_ms INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            last_memory_id TEXT NOT NULL DEFAULT '',
            tainted INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project, slot)
          );

          CREATE INDEX IF NOT EXISTS idx_catalog_updated
            ON catalog_slots(tainted, updated_at_ms DESC);
        `);

        try {
          database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
              id UNINDEXED,
              title_seg,
              tags_seg,
              body_seg,
              tokenize='unicode61'
            );
          `);
          fts5Enabled = true;
        } catch {
          fts5Enabled = false;
        }

        migrateLegacyJsonlIfNeeded(database);
      });

      try { fs.chmodSync(dbPath, 0o600); } catch {}
      return db;
    } catch {
      // Unrecoverable SQLite initialization error -> graceful fallback to atomic 0600 JSONL
      if (db) {
        try { db.close(); } catch {}
        db = null;
      }
      backend = 'jsonl';
      fts5Enabled = false;
      dbPath = '';
      return null;
    }
  }

  function withWriteTx(fn) {
    const database = db || ensureDb();
    if (!database) {
      throw new Error('SQLite backend unavailable');
    }
    if (txDepth > 0) {
      return fn(database);
    }
    database.exec('BEGIN IMMEDIATE');
    txDepth += 1;
    try {
      const result = fn(database);
      database.exec('COMMIT');
      return result;
    } catch (err) {
      try { database.exec('ROLLBACK'); } catch {}
      throw err;
    } finally {
      txDepth -= 1;
    }
  }

  function insertEntryRowSqlite(database, entry, { ignoreExisting = false } = {}) {
    const verb = ignoreExisting ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE';
    const res = database
      .prepare(
        `${verb} INTO memories (
          id, created_at, created_at_ms, project, slot, slot_tag, tags_json,
          source, summary, cwd, git_branch, git_head, git_dirty_count,
          conversation_path, verified, next_action, content, tainted, visibility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.createdAt,
        entry.createdAtMs,
        entry.project,
        entry.slot,
        entry.slotTag,
        JSON.stringify(entry.tags),
        entry.source,
        entry.summary,
        entry.cwd,
        entry.gitBranch,
        entry.gitHead,
        entry.gitDirtyCount,
        entry.conversationPath,
        entry.verified,
        entry.nextAction,
        entry.content,
        entry.tainted ? 1 : 0,
        entry.visibility
      );

    const inserted = Number(res?.changes) > 0;
    if (inserted && fts5Enabled) {
      if (!ignoreExisting) {
        database.prepare('DELETE FROM memories_fts WHERE id = ?').run(entry.id);
      }
      const titleSeg = segmentForFts(`${entry.summary} ${entry.nextAction}`);
      const tagsSeg = segmentForFts(`${entry.slotTag} ${entry.tags.join(' ')} ${entry.project} ${entry.slot}`);
      const bodySeg = segmentForFts(`${entry.verified} ${entry.content} ${entry.cwd} ${entry.gitBranch}`);
      database
        .prepare('INSERT INTO memories_fts (id, title_seg, tags_seg, body_seg) VALUES (?, ?, ?, ?)')
        .run(entry.id, titleSeg, tagsSeg, bodySeg);
    }
    return inserted;
  }

  function pruneOverflowSqlite(database) {
    const overflowRows = database
      .prepare('SELECT id FROM memories ORDER BY created_at_ms DESC, id DESC LIMIT -1 OFFSET ?')
      .all(maxEntries);
    if (!overflowRows.length) return;
    const delMem = database.prepare('DELETE FROM memories WHERE id = ?');
    const delFts = fts5Enabled ? database.prepare('DELETE FROM memories_fts WHERE id = ?') : null;
    for (const r of overflowRows) {
      delMem.run(r.id);
      if (delFts) delFts.run(r.id);
    }
  }

  function upsertCatalogSlotRowSqlite(database, slotInput, { respectNewerExisting = false } = {}) {
    const existingRow = database
      .prepare('SELECT * FROM catalog_slots WHERE project = ? AND slot = ?')
      .get(slotInput.project, slotInput.slot);

    const existing = existingRow ? rowToCatalogSlot(existingRow) : null;
    const incomingTs = Number(slotInput.updatedAtMs) || Date.now();

    if (respectNewerExisting && existing && existing.updatedAtMs > incomingTs) {
      const mergedCwd = existing.cwd || slotInput.cwd || '';
      const mergedBranch = existing.gitBranch || slotInput.gitBranch || '';
      const mergedAccount = existing.activeAccount || slotInput.activeAccount || '';
      if (mergedCwd !== existing.cwd || mergedBranch !== existing.gitBranch || mergedAccount !== existing.activeAccount) {
        database
          .prepare('UPDATE catalog_slots SET cwd = ?, git_branch = ?, active_account = ? WHERE project = ? AND slot = ?')
          .run(mergedCwd, mergedBranch, mergedAccount, existing.project, existing.slot);
      }
      return {
        ...existing,
        cwd: mergedCwd,
        gitBranch: mergedBranch,
        activeAccount: mergedAccount
      };
    }

    const updatedAtMs = incomingTs;
    const updatedAt = new Date(updatedAtMs).toISOString();
    const slotTag = `handoff:${slotInput.project}:${slotInput.slot}`;
    const tags = ['catalog:master', `project:${slotInput.project}`, slotTag];
    const cwd = slotInput.cwd !== undefined && slotInput.cwd !== ''
      ? slotInput.cwd
      : (existing?.cwd || '');
    const summary = slotInput.summary !== undefined && slotInput.summary !== ''
      ? slotInput.summary
      : (existing?.summary || '');
    const gitBranch = slotInput.gitBranch !== undefined && slotInput.gitBranch !== ''
      ? slotInput.gitBranch
      : (existing?.gitBranch || '');
    const activeAccount = slotInput.activeAccount !== undefined && slotInput.activeAccount !== ''
      ? slotInput.activeAccount
      : (existing?.activeAccount || '');
    const status = slotInput.status || existing?.status || 'active';
    const lastMemoryId = slotInput.lastMemoryId || existing?.lastMemoryId || '';

    database
      .prepare(
        `INSERT INTO catalog_slots (
          project, slot, slot_tag, tags_json, cwd, summary, git_branch,
          active_account, status, updated_at_ms, updated_at, last_memory_id, tainted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(project, slot) DO UPDATE SET
          slot_tag = excluded.slot_tag,
          tags_json = excluded.tags_json,
          cwd = excluded.cwd,
          summary = excluded.summary,
          git_branch = excluded.git_branch,
          active_account = excluded.active_account,
          status = excluded.status,
          updated_at_ms = excluded.updated_at_ms,
          updated_at = excluded.updated_at,
          last_memory_id = excluded.last_memory_id,
          tainted = 0`
      )
      .run(
        slotInput.project,
        slotInput.slot,
        slotTag,
        JSON.stringify(tags),
        cwd,
        summary,
        gitBranch,
        activeAccount,
        status,
        updatedAtMs,
        updatedAt,
        lastMemoryId
      );

    return {
      project: slotInput.project,
      slot: slotInput.slot,
      slotTag,
      catalogTag: 'catalog:master',
      tags,
      cwd,
      summary,
      gitBranch,
      activeAccount,
      status,
      updatedAtMs,
      updatedAt,
      lastMemoryId,
      tainted: false
    };
  }

  function migrateLegacyJsonlIfNeeded(database) {
    const migratedMeta = database
      .prepare("SELECT value FROM meta WHERE key = 'jsonl_migrated_v1'")
      .get();
    if (migratedMeta) return;
    if (!fs.existsSync(filePath)) return;

    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }

    const parsedItems = parseJsonlTextLenient(raw);
    let importedCount = 0;
    for (const rawObj of parsedItems) {
      const sanitized = boundEntryBytes(sanitizeStoredEntry(rawObj));
      if (!sanitized.summary && !sanitized.content && !sanitized.verified && !sanitized.nextAction) {
        continue;
      }
      const didInsert = insertEntryRowSqlite(database, sanitized, { ignoreExisting: true });
      if (didInsert) importedCount += 1;
      if (!sanitized.tainted) {
        upsertCatalogSlotRowSqlite(
          database,
          {
            project: sanitized.project,
            slot: sanitized.slot,
            cwd: sanitized.cwd,
            summary: sanitized.summary,
            gitBranch: sanitized.gitBranch,
            status: 'active',
            updatedAtMs: sanitized.createdAtMs,
            lastMemoryId: sanitized.id
          },
          { respectNewerExisting: true }
        );
      }
    }

    pruneOverflowSqlite(database);

    const now = Date.now();
    database
      .prepare("INSERT OR REPLACE INTO meta (key, value, updated_at_ms) VALUES ('jsonl_migrated_v1', ?, ?)")
      .run(JSON.stringify({ importedCount, totalParsed: parsedItems.length, migratedAt: new Date(now).toISOString() }), now);
  }

  /* ---------------- JSONL Fallback Helpers & File Lock ---------------- */

  const jsonlLockPath = path.join(requestedStateDir, 'handoff-memories.lock');
  const waitSleepBuf = typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;
  let jsonlLockDepth = 0;

  function isLockPidAlive(pid) {
    const p = Number(pid);
    if (!Number.isInteger(p) || p <= 0) return false;
    try {
      process.kill(p, 0);
      return true;
    } catch (err) {
      return err && err.code !== 'ESRCH';
    }
  }

  function withJsonlFileLock(fn) {
    if (jsonlLockDepth > 0) {
      return fn();
    }
    fs.mkdirSync(requestedStateDir, { recursive: true, mode: 0o700 });
    const lockToken = crypto.randomBytes(16).toString('hex');
    const deadline = Date.now() + JSONL_LOCK_WAIT_BUDGET_MS;
    let acquired = false;

    while (!acquired) {
      const payload = JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: Date.now(),
        lockToken
      });
      try {
        fs.writeFileSync(jsonlLockPath, payload, { flag: 'wx', mode: 0o600 });
        acquired = true;
        break;
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err;
        let stale = false;
        let staleToken = '';
        try {
          const existing = JSON.parse(fs.readFileSync(jsonlLockPath, 'utf8'));
          staleToken = typeof existing?.lockToken === 'string' ? existing.lockToken : '';
          const age = Date.now() - Number(existing.createdAt || 0);
          const sameHost = !existing.hostname || existing.hostname === os.hostname();
          if (age > JSONL_LOCK_STALE_MS || (sameHost && !isLockPidAlive(existing.pid))) {
            stale = true;
          }
        } catch {
          try {
            const st = fs.statSync(jsonlLockPath);
            if (Date.now() - Number(st.mtimeMs || 0) > 2500) stale = true;
          } catch {}
        }

        if (stale) {
          const staleTmp = `${jsonlLockPath}.stale-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
          try {
            fs.renameSync(jsonlLockPath, staleTmp);
            try {
              const moved = JSON.parse(fs.readFileSync(staleTmp, 'utf8'));
              if (staleToken && moved?.lockToken && moved.lockToken !== staleToken) {
                try { fs.linkSync(staleTmp, jsonlLockPath); } catch {}
              }
            } catch {}
            try { fs.rmSync(staleTmp, { force: true }); } catch {}
          } catch {}
          continue;
        }

        if (Date.now() >= deadline) {
          throw Object.assign(new Error('获取交接记忆文件锁超时，请稍后重试'), { code: 'MEMORY_LOCK_BUSY' });
        }
        if (waitSleepBuf) {
          try { Atomics.wait(waitSleepBuf, 0, 0, 15); } catch {}
        }
      }
    }

    jsonlLockDepth += 1;
    try {
      return fn();
    } finally {
      jsonlLockDepth -= 1;
      try {
        if (fs.existsSync(jsonlLockPath)) {
          const cur = JSON.parse(fs.readFileSync(jsonlLockPath, 'utf8'));
          if (cur && cur.lockToken === lockToken) {
            fs.rmSync(jsonlLockPath, { force: true });
          }
        }
      } catch {}
    }
  }

  function readAllNewestFirstJsonl() {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const items = parseJsonlTextLenient(raw).map((o) => sanitizeStoredEntry(o));
    items.sort((a, b) => {
      const ta = Number(a.createdAtMs) || Date.parse(a.createdAt || '') || 0;
      const tb = Number(b.createdAtMs) || Date.parse(b.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return items;
  }

  function readCatalogSlotsJsonl() {
    if (!fs.existsSync(catalogJsonPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(catalogJsonPath, 'utf8').replace(/^\uFEFF/, ''));
      return Array.isArray(parsed?.slots) ? parsed.slots : [];
    } catch {
      return [];
    }
  }

  function writeCatalogSlotsJsonl(slots) {
    writeJsonAtomic0600(catalogJsonPath, JSON.stringify({ schema: 1, tag: 'catalog:master', slots }, null, 2) + '\n');
  }

  function upsertCatalogSlotJsonl(slotInput, { respectNewerExisting = false } = {}) {
    const slots = readCatalogSlotsJsonl();
    const idx = slots.findIndex((s) => s.project === slotInput.project && s.slot === slotInput.slot);
    const existing = idx >= 0 ? slots[idx] : null;
    const incomingTs = Number(slotInput.updatedAtMs) || Date.now();

    if (respectNewerExisting && existing && Number(existing.updatedAtMs) > incomingTs) {
      existing.cwd = existing.cwd || slotInput.cwd || '';
      existing.gitBranch = existing.gitBranch || slotInput.gitBranch || '';
      existing.activeAccount = existing.activeAccount || slotInput.activeAccount || '';
      writeCatalogSlotsJsonl(slots);
      return existing;
    }

    const slotTag = `handoff:${slotInput.project}:${slotInput.slot}`;
    const record = {
      project: slotInput.project,
      slot: slotInput.slot,
      slotTag,
      catalogTag: 'catalog:master',
      tags: ['catalog:master', `project:${slotInput.project}`, slotTag],
      cwd: slotInput.cwd || existing?.cwd || '',
      summary: slotInput.summary || existing?.summary || '',
      gitBranch: slotInput.gitBranch || existing?.gitBranch || '',
      activeAccount: slotInput.activeAccount || existing?.activeAccount || '',
      status: slotInput.status || existing?.status || 'active',
      updatedAtMs: incomingTs,
      updatedAt: new Date(incomingTs).toISOString(),
      lastMemoryId: slotInput.lastMemoryId || existing?.lastMemoryId || '',
      tainted: false
    };
    if (idx >= 0) {
      slots[idx] = record;
    } else {
      slots.push(record);
    }
    slots.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
    writeCatalogSlotsJsonl(slots);
    return record;
  }

  /* ---------------- Async Remote Push Helper ---------------- */

  function fireAndForgetRemotePush(entry) {
    if (entry.tainted) return;
    const cfg = resolveValidatedRemoteConfig(options.getRemoteConfig, options.remoteConfig);
    if (!cfg.enabled) return;
    if (!cfg.valid) {
      remoteState.lastPushAt = new Date().toISOString();
      remoteState.lastPushOk = false;
      remoteState.lastError = cfg.error || 'Invalid remote config';
      return;
    }
    if (!cfg.url) return;

    remoteState.inFlight += 1;
    const contentLines = [
      `[${entry.slotTag}] (${entry.createdAt})`,
      `工作目录：${entry.cwd || '(未指定)'}`,
      `Git：${entry.gitBranch ? `${entry.gitBranch} @ ${entry.gitHead || '-'} (改动 ${entry.gitDirtyCount} 项)` : '非 Git 目录'}`,
      `已验证进度：${entry.verified || entry.summary}`,
      `下一步：${entry.nextAction || '继续推进'}`
    ];
    const remoteTags = cfg.syncCatalog && !entry.tags.includes('catalog:master')
      ? [...entry.tags, 'catalog:master']
      : entry.tags;

    const toolArgs = {
      summary: entry.summary,
      tags: remoteTags,
      content: contentLines.join('\n'),
      project: entry.project,
      slot: entry.slot,
      slotTag: entry.slotTag,
      cwd: entry.cwd,
      gitBranch: entry.gitBranch,
      gitHead: entry.gitHead,
      gitDirtyCount: entry.gitDirtyCount,
      verified: entry.verified,
      nextAction: entry.nextAction,
      createdAt: entry.createdAt,
      createdAtMs: entry.createdAtMs
    };

    void Promise.resolve()
      .then(() => invokeRemoteMcpRpc(fetchImpl, cfg, 'memory_store', toolArgs))
      .then(() => {
        remoteState.pushCount += 1;
        remoteState.lastPushAt = new Date().toISOString();
        remoteState.lastPushOk = true;
        remoteState.offline = false;
        remoteState.lastError = '';
      })
      .catch((err) => {
        remoteState.lastPushAt = new Date().toISOString();
        remoteState.lastPushOk = false;
        remoteState.offline = true;
        remoteState.lastError = scrubSecretFromError(err, cfg.bearerToken);
      })
      .finally(() => {
        remoteState.inFlight = Math.max(0, remoteState.inFlight - 1);
      });
  }

  /* ---------------- Public Store Operations ---------------- */

  function store(input = {}) {
    const tainted = isTaintedInput(input);
    if (tainted && hasProtectedControlAttempt(input)) {
      throwTaintedBlockedError();
    }

    const nowMs = Number(input.createdAtMs) || Date.now();
    const createdAt = input.createdAt ? redactMemoryText(String(input.createdAt).slice(0, 64)) : new Date(nowMs).toISOString();
    const project = normalizeSlug(
      input.project || (input.cwd ? path.basename(String(input.cwd)) : 'workspace'),
      'workspace',
      48
    );
    const slot = normalizeSlug(input.slot || 'default', 'default', 32);
    const tags = normalizeTags(input.tags, project, slot, tainted);
    const slotTag = tainted ? `quarantine:${project}:${slot}` : `handoff:${project}:${slot}`;

    const entry = {
      id: `mem-${nowMs}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt,
      createdAtMs: nowMs,
      project,
      slot,
      slotTag,
      tags,
      source: redactMemoryText(String(input.source || 'manual').slice(0, 32)),
      summary: redactMemoryText(String(input.summary || '').trim().slice(0, 600)),
      cwd: redactMemoryText(String(input.cwd || '').trim().slice(0, 300)),
      gitBranch: redactMemoryText(String(input.gitBranch || '').trim().slice(0, 96)),
      gitHead: redactMemoryText(String(input.gitHead || '').trim().slice(0, 24)),
      gitDirtyCount: Math.max(0, Math.round(Number(input.gitDirtyCount) || 0)),
      conversationPath: redactMemoryText(String(input.conversationPath || '').trim().slice(0, 240)),
      verified: redactMemoryText(String(input.verified || '').trim().slice(0, 1200)),
      nextAction: redactMemoryText(String(input.nextAction || '').trim().slice(0, 800)),
      content: redactMemoryText(String(input.content || '').trim().slice(0, 2400)),
      tainted,
      visibility: tainted ? 'quarantine' : 'normal'
    };

    if (!entry.summary && !entry.content && !entry.verified && !entry.nextAction) {
      throw Object.assign(new Error('交接记忆内容不能为空（至少填写 summary / verified / nextAction / content 之一）'), {
        code: 'EMPTY_MEMORY'
      });
    }
    if (!entry.summary) {
      entry.summary = (entry.nextAction || entry.verified || entry.content).slice(0, 160);
    }

    boundEntryBytes(entry);

    const activeAccount = input.activeAccount
      ? redactMemoryText(String(input.activeAccount).trim().slice(0, 120))
      : '';

    const database = ensureDb();
    if (database) {
      withWriteTx((txDb) => {
        insertEntryRowSqlite(txDb, entry, { ignoreExisting: false });
        if (!entry.tainted) {
          upsertCatalogSlotRowSqlite(
            txDb,
            {
              project: entry.project,
              slot: entry.slot,
              cwd: entry.cwd,
              summary: entry.summary,
              gitBranch: entry.gitBranch,
              activeAccount,
              status: 'active',
              updatedAtMs: entry.createdAtMs,
              lastMemoryId: entry.id
            },
            { respectNewerExisting: true }
          );
        }
        pruneOverflowSqlite(txDb);
      });
    } else {
      withJsonlFileLock(() => {
        const existing = readAllNewestFirstJsonl();
        const next = [entry, ...existing].slice(0, maxEntries);
        writeJsonlAtomic0600(filePath, next);
        if (!entry.tainted) {
          upsertCatalogSlotJsonl(
            {
              project: entry.project,
              slot: entry.slot,
              cwd: entry.cwd,
              summary: entry.summary,
              gitBranch: entry.gitBranch,
              activeAccount,
              status: 'active',
              updatedAtMs: entry.createdAtMs,
              lastMemoryId: entry.id
            },
            { respectNewerExisting: true }
          );
        }
      });
    }

    fireAndForgetRemotePush(entry);
    return entry;
  }

  function list({ project = '', slot = '', tag = '', limit = 10, includeTainted = false } = {}) {
    const cleanProject = project ? normalizeSlug(project, '', 48) : '';
    const cleanSlot = slot ? normalizeSlug(slot, '', 32) : '';
    const cleanTag = String(tag || '').trim().toLowerCase();
    const cap = Math.max(1, Math.min(200, Number(limit) || 10));
    const allowTainted = includeTainted === true;

    const database = ensureDb();
    if (database) {
      const clauses = [];
      const params = [];
      if (!allowTainted) {
        clauses.push('tainted = 0');
      }
      if (cleanProject) {
        clauses.push('project = ?');
        params.push(cleanProject);
      }
      if (cleanSlot) {
        clauses.push('slot = ?');
        params.push(cleanSlot);
      }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      if (!cleanTag) {
        const countRow = database.prepare(`SELECT COUNT(*) AS cnt FROM memories ${whereSql}`).get(...params);
        const rows = database
          .prepare(`SELECT * FROM memories ${whereSql} ORDER BY created_at_ms DESC, id DESC LIMIT ?`)
          .all(...params, cap);
        return {
          ok: true,
          total: Number(countRow?.cnt) || 0,
          entries: rows.map(rowToEntry)
        };
      }

      const rows = database
        .prepare(`SELECT * FROM memories ${whereSql} ORDER BY created_at_ms DESC, id DESC`)
        .all(...params);
      const filtered = rows.map(rowToEntry).filter((e) => {
        const hasTag = Array.isArray(e.tags) && e.tags.some((t) => String(t).toLowerCase() === cleanTag);
        return hasTag || String(e.slotTag || '').toLowerCase() === cleanTag;
      });
      return {
        ok: true,
        total: filtered.length,
        entries: filtered.slice(0, cap)
      };
    }

    const all = readAllNewestFirstJsonl();
    const filtered = all.filter((e) => {
      if (!allowTainted && e.tainted === true) return false;
      if (cleanProject && e.project !== cleanProject) return false;
      if (cleanSlot && e.slot !== cleanSlot) return false;
      if (cleanTag) {
        const hasTag = Array.isArray(e.tags) && e.tags.some((t) => String(t).toLowerCase() === cleanTag);
        if (!hasTag && String(e.slotTag || '').toLowerCase() !== cleanTag) return false;
      }
      return true;
    });
    return {
      ok: true,
      total: filtered.length,
      entries: filtered.slice(0, cap)
    };
  }

  function search({ query = '', project = '', slot = '', tag = '', limit = 10, includeTainted = false } = {}) {
    const cleanRaw = redactMemoryText(String(query ?? '').replace(/\0/g, '').trim());
    if (!cleanRaw) {
      return list({ project, slot, tag, limit, includeTainted });
    }

    const cleanProject = project ? normalizeSlug(project, '', 48) : '';
    const cleanSlot = slot ? normalizeSlug(slot, '', 32) : '';
    const cleanTag = String(tag || '').trim().toLowerCase();
    const cap = Math.max(1, Math.min(50, Number(limit) || 10));
    const allowTainted = includeTainted === true;
    const nowMs = Date.now();

    const cleanQueryLower = cleanRaw.toLowerCase();
    const ftsMatchExpr = buildSafeFtsMatchQuery(cleanRaw);
    const segmentedTokens = segmentForFts(cleanRaw).split(/\s+/).filter(Boolean).slice(0, 24);

    const database = ensureDb();
    if (database && fts5Enabled && ftsMatchExpr) {
      const rows = database
        .prepare(
          `SELECT m.*, (-bm25(memories_fts, 0.0, 10.0, 6.0, 2.0)) AS fts_score
           FROM memories_fts
           JOIN memories m ON m.id = memories_fts.id
           WHERE memories_fts MATCH ?
             AND (? = 1 OR m.tainted = 0)
             AND (? = '' OR m.project = ?)
             AND (? = '' OR m.slot = ?)`
        )
        .all(
          ftsMatchExpr,
          allowTainted ? 1 : 0,
          cleanProject,
          cleanProject,
          cleanSlot,
          cleanSlot
        );

      const scored = [];
      for (const row of rows) {
        const entry = rowToEntry(row);
        if (cleanTag) {
          const hasTag = Array.isArray(entry.tags) && entry.tags.some((t) => String(t).toLowerCase() === cleanTag);
          if (!hasTag && String(entry.slotTag || '').toLowerCase() !== cleanTag) continue;
        }
        const ftsRaw = Math.max(0.0001, Number(row.fts_score) || 0.0001);
        const totalScore = computeCombinedSearchScore(entry, cleanQueryLower, segmentedTokens, ftsRaw, nowMs);
        if (totalScore !== null) {
          scored.push({ entry, score: totalScore });
        }
      }

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const diffTs = (Number(b.entry.createdAtMs) || 0) - (Number(a.entry.createdAtMs) || 0);
        if (diffTs !== 0) return diffTs;
        return String(b.entry.id).localeCompare(String(a.entry.id));
      });

      return {
        ok: true,
        total: scored.length,
        entries: scored.slice(0, cap).map((s) => s.entry)
      };
    }

    // Fallback search when FTS5 unavailable, JSONL mode, or query contains only punctuation operators
    const { entries: pool } = list({ project, slot, tag, limit: 200, includeTainted: allowTainted });
    const scored = [];
    for (const entry of pool) {
      const totalScore = computeCombinedSearchScore(entry, cleanQueryLower, segmentedTokens, 0, nowMs);
      if (totalScore !== null) {
        scored.push({ entry, score: totalScore });
      }
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (Number(b.entry.createdAtMs) || 0) - (Number(a.entry.createdAtMs) || 0);
    });
    return {
      ok: true,
      total: scored.length,
      entries: scored.slice(0, cap).map((s) => s.entry)
    };
  }

  function remove(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return { ok: false, removed: false };

    const database = ensureDb();
    if (database) {
      const removed = withWriteTx((txDb) => {
        const res = txDb.prepare('DELETE FROM memories WHERE id = ?').run(cleanId);
        if (fts5Enabled) {
          txDb.prepare('DELETE FROM memories_fts WHERE id = ?').run(cleanId);
        }
        return Number(res?.changes) > 0;
      });
      return { ok: true, removed };
    }

    return withJsonlFileLock(() => {
      const existing = readAllNewestFirstJsonl();
      const filtered = existing.filter((e) => e.id !== cleanId);
      if (filtered.length === existing.length) {
        return { ok: true, removed: false };
      }
      writeJsonlAtomic0600(filePath, filtered);
      return { ok: true, removed: true };
    });
  }

  function upsertCatalogSlot(input = {}) {
    if (isTaintedInput(input)) {
      throwTaintedBlockedError();
    }
    const project = normalizeSlug(
      input.project || (input.cwd ? path.basename(String(input.cwd)) : 'workspace'),
      'workspace',
      48
    );
    const slot = normalizeSlug(input.slot || 'default', 'default', 32);
    const normalized = {
      project,
      slot,
      cwd: input.cwd !== undefined ? redactMemoryText(String(input.cwd || '').trim().slice(0, 300)) : undefined,
      summary: input.summary !== undefined ? redactMemoryText(String(input.summary || '').trim().slice(0, 600)) : undefined,
      gitBranch: input.gitBranch !== undefined ? redactMemoryText(String(input.gitBranch || '').trim().slice(0, 96)) : undefined,
      activeAccount: input.activeAccount !== undefined
        ? redactMemoryText(String(input.activeAccount || '').trim().slice(0, 120))
        : undefined,
      status: redactMemoryText(String(input.status || 'active').trim().toLowerCase().slice(0, 24)) || 'active',
      updatedAtMs: Number(input.updatedAtMs) > 0 ? Math.round(Number(input.updatedAtMs)) : Date.now(),
      lastMemoryId: input.lastMemoryId ? redactMemoryText(String(input.lastMemoryId).trim().slice(0, 80)) : ''
    };

    const database = ensureDb();
    if (database) {
      return withWriteTx((txDb) => upsertCatalogSlotRowSqlite(txDb, normalized, { respectNewerExisting: false }));
    }
    return withJsonlFileLock(() => upsertCatalogSlotJsonl(normalized, { respectNewerExisting: false }));
  }

  function getMasterCatalog({ project = '', limit = 30, includeTainted = false } = {}) {
    const cleanProject = project ? normalizeSlug(project, '', 48) : '';
    const cap = Math.max(1, Math.min(200, Number(limit) || 30));
    const allowTainted = includeTainted === true;

    const database = ensureDb();
    if (database) {
      const clauses = [];
      const params = [];
      if (!allowTainted) {
        clauses.push('tainted = 0');
      }
      if (cleanProject) {
        clauses.push('project = ?');
        params.push(cleanProject);
      }
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const countRow = database.prepare(`SELECT COUNT(*) AS cnt FROM catalog_slots ${whereSql}`).get(...params);
      const rows = database
        .prepare(`SELECT * FROM catalog_slots ${whereSql} ORDER BY updated_at_ms DESC, project ASC, slot ASC LIMIT ?`)
        .all(...params, cap);
      const slots = rows.map(rowToCatalogSlot);
      return {
        ok: true,
        tag: 'catalog:master',
        total: Number(countRow?.cnt) || 0,
        slots,
        entries: slots
      };
    }

    const allSlots = readCatalogSlotsJsonl().filter((s) => {
      if (!allowTainted && s.tainted === true) return false;
      if (cleanProject && s.project !== cleanProject) return false;
      return true;
    });
    allSlots.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
    const sliced = allSlots.slice(0, cap);
    return {
      ok: true,
      tag: 'catalog:master',
      total: allSlots.length,
      slots: sliced,
      entries: sliced
    };
  }

  async function syncRemoteCatalog({ limit = 20 } = {}) {
    const cap = Math.max(1, Math.min(100, Number(limit) || 20));
    const cfg = resolveValidatedRemoteConfig(options.getRemoteConfig, options.remoteConfig);

    if (!cfg.valid) {
      remoteState.lastPullAt = new Date().toISOString();
      remoteState.lastPullOk = false;
      remoteState.lastError = cfg.error || '远程 Memory 配置校验未通过';
      return {
        ok: false,
        offline: false,
        code: cfg.code || 'INVALID_REMOTE_CONFIG',
        error: remoteState.lastError
      };
    }

    if (!cfg.enabled || !cfg.url) {
      return {
        ok: false,
        offline: false,
        skipped: true,
        error: '远程 Memory 同步未启用或未配置 URL'
      };
    }

    remoteState.inFlight += 1;
    try {
      const rpcRes = await invokeRemoteMcpRpc(fetchImpl, cfg, 'memory_list', {
        limit: cap,
        tag: cfg.syncCatalog ? 'catalog:master' : ''
      });
      const rawItems = extractRemoteEntriesFromResult(rpcRes).slice(0, cap);
      let updatedSlots = 0;
      let importedMemories = 0;

      const database = ensureDb();
      const applyItems = (txDb) => {
        for (const item of rawItems) {
          if (!item || typeof item !== 'object') continue;
          if (item.tainted === true || isTaintedInput(item)) continue;

          const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
          const rawTags = Array.isArray(item.tags)
            ? item.tags
            : Array.isArray(meta.tags)
              ? meta.tags
              : [];
          const cleanTags = rawTags.map((t) => redactMemoryText(String(t || '').trim())).filter(Boolean);
          const tagInfo = parseSlotAndProjectFromTags(cleanTags);

          const hasRelevantTag =
            tagInfo.isCatalog ||
            tagInfo.isHandoff ||
            Boolean(item.project || meta.project || item.slot || meta.slot || item.slotTag || meta.slotTag);
          if (!hasRelevantTag) continue;

          const parsedFromSlotTag = parseSlotAndProjectFromTags([item.slotTag || meta.slotTag || '']);
          const project = normalizeSlug(
            item.project || meta.project || tagInfo.project || parsedFromSlotTag.project || 'workspace',
            'workspace',
            48
          );
          const slot = normalizeSlug(
            item.slot || meta.slot || tagInfo.slot || parsedFromSlotTag.slot || 'default',
            'default',
            32
          );
          const tsMs =
            Number(item.updatedAtMs || item.createdAtMs || meta.createdAtMs) ||
            Date.parse(item.updatedAt || item.createdAt || meta.createdAt || '') ||
            Date.now();
          const summary = redactMemoryText(
            String(item.summary || meta.summary || item.content || '').trim().slice(0, 600)
          );
          const cwd = redactMemoryText(String(item.cwd || meta.cwd || '').trim().slice(0, 300));
          const gitBranch = redactMemoryText(String(item.gitBranch || meta.gitBranch || '').trim().slice(0, 96));
          const activeAccount = redactMemoryText(
            String(item.activeAccount || meta.activeAccount || '').trim().slice(0, 120)
          );
          const status = redactMemoryText(String(item.status || meta.status || 'active').trim().toLowerCase().slice(0, 24)) || 'active';

          if (txDb) {
            upsertCatalogSlotRowSqlite(
              txDb,
              { project, slot, cwd, summary, gitBranch, activeAccount, status, updatedAtMs: tsMs },
              { respectNewerExisting: true }
            );
          } else {
            upsertCatalogSlotJsonl(
              { project, slot, cwd, summary, gitBranch, activeAccount, status, updatedAtMs: tsMs },
              { respectNewerExisting: true }
            );
          }
          updatedSlots += 1;

          if (tagInfo.isHandoff || parsedFromSlotTag.isHandoff || item.verified || item.nextAction || meta.verified || meta.nextAction) {
            const candidate = boundEntryBytes(
              sanitizeStoredEntry({
                id: item.id || meta.id || `remote-${project}-${slot}-${tsMs}`,
                createdAtMs: tsMs,
                createdAt: item.createdAt || meta.createdAt || new Date(tsMs).toISOString(),
                project,
                slot,
                tags: cleanTags,
                source: 'remote-mcp',
                summary,
                cwd,
                gitBranch,
                gitHead: item.gitHead || meta.gitHead || '',
                gitDirtyCount: item.gitDirtyCount ?? meta.gitDirtyCount ?? 0,
                verified: item.verified || meta.verified || '',
                nextAction: item.nextAction || meta.nextAction || '',
                content: item.content || '',
                tainted: true
              })
            );
            if (candidate.summary || candidate.content || candidate.verified || candidate.nextAction) {
              if (txDb) {
                if (insertEntryRowSqlite(txDb, candidate, { ignoreExisting: true })) {
                  importedMemories += 1;
                }
              } else {
                const existing = readAllNewestFirstJsonl();
                if (!existing.some((e) => e.id === candidate.id)) {
                  writeJsonlAtomic0600(filePath, [candidate, ...existing].slice(0, maxEntries));
                  importedMemories += 1;
                }
              }
            }
          }
        }
        if (txDb) {
          pruneOverflowSqlite(txDb);
        }
      };

      if (database) {
        withWriteTx(applyItems);
      } else {
        withJsonlFileLock(() => applyItems(null));
      }

      remoteState.pullCount += 1;
      remoteState.lastPullAt = new Date().toISOString();
      remoteState.lastPullOk = true;
      remoteState.offline = false;
      remoteState.lastError = '';

      const cat = getMasterCatalog({ limit: cap });
      return {
        ok: true,
        offline: false,
        updatedSlots,
        importedMemories,
        slots: cat.slots
      };
    } catch (err) {
      const safeErr = scrubSecretFromError(err, cfg.bearerToken);
      remoteState.lastPullAt = new Date().toISOString();
      remoteState.lastPullOk = false;
      remoteState.offline = true;
      remoteState.lastError = safeErr;
      return {
        ok: false,
        offline: true,
        error: safeErr
      };
    } finally {
      remoteState.inFlight = Math.max(0, remoteState.inFlight - 1);
    }
  }

  function getRemoteSyncStatus() {
    const cfg = resolveValidatedRemoteConfig(options.getRemoteConfig, options.remoteConfig);
    return {
      enabled: Boolean(cfg.enabled && cfg.valid && cfg.url),
      validConfig: Boolean(cfg.valid),
      endpoint: cfg.valid ? (cfg.displayUrl || '') : '',
      inFlight: remoteState.inFlight,
      pushCount: remoteState.pushCount,
      pullCount: remoteState.pullCount,
      lastPushAt: remoteState.lastPushAt,
      lastPushOk: remoteState.lastPushOk,
      lastPullAt: remoteState.lastPullAt,
      lastPullOk: remoteState.lastPullOk,
      lastError: remoteState.lastError,
      offline: remoteState.offline
    };
  }

  function getStorageInfo() {
    return {
      backend,
      dbPath: backend === 'sqlite' ? dbPath : '',
      filePath,
      requestedStateDir,
      effectiveDbDir: backend === 'sqlite' ? effectiveDbDir : requestedStateDir,
      redirectedFromMount: Boolean(backend === 'sqlite' && mountInfo.unsafe),
      mountUnsafe: Boolean(mountInfo.unsafe),
      mountReason: mountInfo.reason || '',
      mountFsType: mountInfo.fsType || '',
      fts5Enabled: Boolean(backend === 'sqlite' && fts5Enabled)
    };
  }

  function close() {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
  }

  function formatExternalMemoryStorePrompt(entry) {
    if (!entry) return '';
    const contentLines = [
      `[${entry.slotTag}] (${entry.createdAt})`,
      `工作目录：${entry.cwd || '(未指定)'}`,
      `Git：${entry.gitBranch ? `${entry.gitBranch} @ ${entry.gitHead || '-'} (改动 ${entry.gitDirtyCount} 项)` : '非 Git 目录'}`,
      `已验证进度：${entry.verified || entry.summary}`,
      `下一步：${entry.nextAction || '继续推进'}`
    ];
    return [
      '请调用 memory_store（或写入你外部的 memory-mcp）记录以下 4 要素交接记忆：',
      `- tags: ${JSON.stringify(entry.tags)}`,
      `- summary: ${entry.summary}`,
      '- content:',
      contentLines.join('\n')
    ].join('\n');
  }

  function formatResumePrompt(entry) {
    if (!entry) return '';
    const taintBanner = entry.tainted ? '[EXTERNAL_UNTRUSTED_MEMORY] ' : '';
    return [
      `${taintBanner}接力 [${entry.slot}]`,
      `${taintBanner}已对齐 [${entry.slotTag}]（来自 ${entry.createdAt} 交接）｜工作目录：${entry.cwd || '(保持当前)'}｜上次进度：${entry.verified || entry.summary}｜现在继续：${entry.nextAction || '按上次进度继续'}`
    ].join('\n');
  }

  return {
    filePath,
    get dbPath() {
      return backend === 'sqlite' ? dbPath : '';
    },
    get backend() {
      return backend;
    },
    getStorageInfo,
    store,
    list,
    search,
    remove,
    upsertCatalogSlot,
    getMasterCatalog,
    syncRemoteCatalog,
    getRemoteSyncStatus,
    formatExternalMemoryStorePrompt,
    formatResumePrompt,
    close
  };
}
