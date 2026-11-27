/**
 * Primary / Backup Multi-Account Relay Manager for Anti-Claude Prism Suite (v0.5.0).
 *
 * Design guarantees:
 * - Default OFF (enabled: false). Requires explicit opt-in before capturing/switching credentials.
 * - Credentials NEVER touch accounts.json, switch.lock, or handoff-snapshot.json; only metadata & hashes live here.
 * - Cross-process exclusive switch.lock prevents concurrent switches.
 * - Pre-switch ownership verification prevents overwriting the wrong backup slot when user switches manually outside UI.
 * - Read-only verifyDataIntegrity() inspects workspace/brain health without ever writing SQLite or brain transcripts.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccountVault, deriveAccountIdFromEmail, sanitizeAccountId } from './account-vault.mjs';
import { redactMemoryText } from './handoff-memory.mjs';

const STALE_LOCK_MS = 120000;
const PENDING_SWITCH_TTL_MS = 5 * 60 * 1000;

function clampInt(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function defaultAccountState(stateDir) {
  return {
    version: 1,
    enabled: false,
    countdownSeconds: 5,
    primaryHysteresisPct: 20,
    autoRelaunchAfterSwitch: true,
    activeAccountId: '',
    accounts: [],
    pendingSwitch: null,
    lastSnapshotAt: '',
    stateDir
  };
}

function writeJsonAtomic0600(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.prism-tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  const text = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    fs.writeFileSync(tmpPath, text, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

function isPidAliveLocal(pid) {
  const p = Number(pid);
  if (!Number.isInteger(p) || p <= 0) return false;
  try {
    process.kill(p, 0);
    return true;
  } catch (err) {
    return err && err.code !== 'ESRCH';
  }
}

function readGitSummaryReadOnly(cwd) {
  const cleanCwd = cwd ? path.resolve(cwd) : '';
  if (!cleanCwd || !fs.existsSync(cleanCwd)) {
    return { isRepo: false, branch: '', head: '', dirtyCount: 0 };
  }
  const runGit = (args) =>
    execFileSync('git', ['-C', cleanCwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      windowsHide: true
    }).trim();
  try {
    const inside = runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') return { isRepo: false, branch: '', head: '', dirtyCount: 0 };
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
    const head = runGit(['rev-parse', '--short', 'HEAD']) || '';
    const porcelain = runGit(['status', '--porcelain']);
    const dirtyCount = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).length : 0;
    return { isRepo: true, branch, head, dirtyCount };
  } catch {
    return { isRepo: false, branch: '', head: '', dirtyCount: 0 };
  }
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseDurationToFutureIso(durationText, nowMs = Date.now()) {
  const s = String(durationText || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : '';
  }
  let totalMs = 0;
  const dayM = s.match(/(\d+(?:\.\d+)?)\s*(?:d|day|days|天)/i);
  const hourM = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|时)/i);
  const minM = s.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分)/i);
  if (dayM) totalMs += Number(dayM[1]) * 86400000;
  if (hourM) totalMs += Number(hourM[1]) * 3600000;
  if (minM) totalMs += Number(minM[1]) * 60000;
  if (totalMs > 0 && Number.isFinite(totalMs)) {
    return new Date(nowMs + totalMs).toISOString();
  }
  return '';
}

export function parseQuotaText(rawText, nowMs = Date.now()) {
  const txt = String(rawText || '').trim();
  if (!txt) return {};
  const out = {};
  const extractRem = (re) => {
    const m = txt.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    if (!Number.isFinite(v)) return null;
    const isUsed = /已用|used/i.test(m[0]);
    return Math.max(0, Math.min(100, Math.round((isUsed ? 100 - v : v) * 10) / 10));
  };
  const p5 = extractRem(/(?:5\s*(?:小时|h)|short)\s*[:：\-]?\s*[^\d%]{0,18}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
  const p7 = extractRem(/(?:每周|周限额|周额度|weekly|7\s*d)\s*[:：\-]?\s*[^\d%]{0,18}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
  if (p5 !== null) out.window5hPct = p5;
  if (p7 !== null) out.window7dPct = p7;

  const r5M = txt.match(/(?:5\s*(?:小时|h)[^;\n]{0,40}?)(\d+\s*(?:h|小时)(?:\s*\d+\s*(?:m|分))?|\d+\s*(?:m|分钟?)|\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)/i);
  const r7M = txt.match(/(?:(?:每周|周限额|weekly|7\s*d)[^;\n]{0,40}?)(\d+\s*(?:d|天)(?:\s*\d+\s*(?:h|小时))?|\d+\s*(?:h|小时)|\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)/i);
  if (r5M) {
    const iso = parseDurationToFutureIso(r5M[1], nowMs);
    if (iso) out.reset5hAt = iso;
  }
  if (r7M) {
    const iso = parseDurationToFutureIso(r7M[1], nowMs);
    if (iso) out.reset7dAt = iso;
  }
  return out;
}

function toFinitePctOrNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function normalizeFamilyQuotaMap(families) {
  if (!families || typeof families !== 'object') return null;
  const out = {};
  for (const key of ['gemini', 'claude', 'gpt', 'other']) {
    const item = families[key];
    if (!item || typeof item !== 'object') continue;
    const targetKey = key === 'gpt' ? 'claude' : key;
    const prev = out[targetKey] || {};
    const rec = { ...prev };
    const p5 = toFinitePctOrNull(item.pct5h);
    if (p5 !== null) {
      if (rec.pct5h === undefined || p5 < rec.pct5h) {
        rec.pct5h = p5;
        if (typeof item.reset5hAt === 'string' && Number.isFinite(Date.parse(item.reset5hAt))) {
          rec.reset5hAt = new Date(Date.parse(item.reset5hAt)).toISOString();
        }
      }
    }
    if (!rec.reset5hAt && typeof item.reset5hAt === 'string' && Number.isFinite(Date.parse(item.reset5hAt))) {
      rec.reset5hAt = new Date(Date.parse(item.reset5hAt)).toISOString();
    }
    const p7 = toFinitePctOrNull(item.pct7d);
    if (p7 !== null) {
      if (rec.pct7d === undefined || p7 < rec.pct7d) {
        rec.pct7d = p7;
        if (typeof item.reset7dAt === 'string' && Number.isFinite(Date.parse(item.reset7dAt))) {
          rec.reset7dAt = new Date(Date.parse(item.reset7dAt)).toISOString();
        }
      }
    }
    if (!rec.reset7dAt && typeof item.reset7dAt === 'string' && Number.isFinite(Date.parse(item.reset7dAt))) {
      rec.reset7dAt = new Date(Date.parse(item.reset7dAt)).toISOString();
    }
    if (Object.keys(rec).length) out[targetKey] = rec;
  }
  return Object.keys(out).length ? out : null;
}

function classifyQuotaWindow(quota = {}, nowMs = Date.now()) {
  const parsed = quota.rawText ? parseQuotaText(quota.rawText, nowMs) : {};
  const merged = { ...parsed, ...quota };
  const normalizePct = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
  };
  const normalizeIso = (v, fallbackHours) => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return new Date(nowMs + v * 3600000).toISOString();
    }
    if (typeof v === 'string' && v.trim()) {
      const t = Date.parse(v.trim());
      if (Number.isFinite(t)) return new Date(t).toISOString();
      const rel = parseDurationToFutureIso(v, nowMs);
      if (rel) return rel;
    }
    if (fallbackHours && Number.isFinite(Number(fallbackHours)) && Number(fallbackHours) > 0) {
      return new Date(nowMs + Number(fallbackHours) * 3600000).toISOString();
    }
    return '';
  };

  const out = {
    window5hPct: normalizePct(merged.window5hPct),
    window7dPct: normalizePct(merged.window7dPct),
    reset5hAt: normalizeIso(merged.reset5hAt, merged.reset5hInHours),
    reset7dAt: normalizeIso(merged.reset7dAt, merged.reset7dInHours),
    resetsAt: merged.resetsAt ? String(merged.resetsAt).slice(0, 64) : '',
    modelFamily: merged.modelFamily ? String(merged.modelFamily).slice(0, 48).toLowerCase() : '',
    tierName: merged.tierName ? String(merged.tierName).trim().slice(0, 48) : '',
    families: normalizeFamilyQuotaMap(merged.families),
    source: merged.source ? String(merged.source).slice(0, 32) : '',
    observedAt: normalizeIso(merged.observedAt, 0) || new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString()
  };

  if (out.resetsAt && merged.pct !== undefined && merged.pct !== null) {
    const resetMs = Date.parse(out.resetsAt);
    const pct = normalizePct(merged.pct);
    if (Number.isFinite(resetMs) && pct !== null) {
      const diffHours = (resetMs - nowMs) / 3600000;
      if (diffHours > 6) {
        out.window7dPct = pct;
        if (!out.reset7dAt) out.reset7dAt = new Date(resetMs).toISOString();
      } else {
        out.window5hPct = pct;
        if (!out.reset5hAt) out.reset5hAt = new Date(resetMs).toISOString();
      }
    }
  }
  return out;
}

export function computeEffectiveQuota(lastQuota, nowMs = Date.now()) {
  if (!lastQuota || typeof lastQuota !== 'object') return null;
  const updatedMs = Date.parse(lastQuota.updatedAt || '');
  const r5Ms = Date.parse(lastQuota.reset5hAt || '');
  const r7Ms = Date.parse(lastQuota.reset7dAt || '');

  const rawTop5 = toFinitePctOrNull(lastQuota.window5hPct);
  const rawTop7 = toFinitePctOrNull(lastQuota.window7dPct);

  const reset5hPassed = Number.isFinite(r5Ms)
    ? nowMs >= r5Ms
    : (Number.isFinite(updatedMs) && rawTop5 !== null && nowMs - updatedMs >= FIVE_HOURS_MS);
  const reset7dPassed = Number.isFinite(r7Ms)
    ? nowMs >= r7Ms
    : (Number.isFinite(updatedMs) && rawTop7 !== null && nowMs - updatedMs >= SEVEN_DAYS_MS);

  const effective5hPct = reset5hPassed ? 100 : rawTop5;
  const effective7dPct = reset7dPassed ? 100 : rawTop7;

  let effectiveFamilies = null;
  if (lastQuota.families && typeof lastQuota.families === 'object') {
    effectiveFamilies = {};
    for (const [famKey, fam] of Object.entries(lastQuota.families)) {
      if (!fam || typeof fam !== 'object') continue;
      const fR5Ms = Date.parse(fam.reset5hAt || '');
      const fR7Ms = Date.parse(fam.reset7dAt || '');
      const fam5Passed = Number.isFinite(fR5Ms)
        ? nowMs >= fR5Ms
        : (reset5hPassed && !fam.reset5hAt);
      const fam7Passed = Number.isFinite(fR7Ms)
        ? nowMs >= fR7Ms
        : (reset7dPassed && !fam.reset7dAt);
      const nextFam = { ...fam };
      const base5 = toFinitePctOrNull(fam.rawPct5h !== undefined ? fam.rawPct5h : fam.pct5h);
      if (base5 !== null) {
        nextFam.rawPct5h = base5;
        nextFam.pct5h = fam5Passed ? 100 : base5;
        nextFam.reset5hPassed = Boolean(fam5Passed);
      } else {
        delete nextFam.pct5h;
        delete nextFam.rawPct5h;
        delete nextFam.reset5hPassed;
      }
      const base7 = toFinitePctOrNull(fam.rawPct7d !== undefined ? fam.rawPct7d : fam.pct7d);
      if (base7 !== null) {
        nextFam.rawPct7d = base7;
        nextFam.pct7d = fam7Passed ? 100 : base7;
        nextFam.reset7dPassed = Boolean(fam7Passed);
      } else {
        delete nextFam.pct7d;
        delete nextFam.rawPct7d;
        delete nextFam.reset7dPassed;
      }
      if (!nextFam.reset5hAt && lastQuota.reset5hAt) nextFam.reset5hAt = lastQuota.reset5hAt;
      if (!nextFam.reset7dAt && lastQuota.reset7dAt) nextFam.reset7dAt = lastQuota.reset7dAt;
      if (nextFam.pct5h !== undefined || nextFam.pct7d !== undefined) {
        effectiveFamilies[famKey] = nextFam;
      }
    }
    if (!Object.keys(effectiveFamilies).length) effectiveFamilies = null;
  }

  return {
    ...lastQuota,
    families: effectiveFamilies,
    effective5hPct,
    effective7dPct,
    reset5hPassed,
    reset7dPassed
  };
}

function normalizeModelList(arr) {
  if (!Array.isArray(arr)) return [];
  const clean = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = String(raw || '').trim().toLowerCase().slice(0, 48);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    clean.push(s);
  }
  return clean.slice(0, 12);
}

function accountSupportsModel(account, activeModel) {
  const model = String(activeModel || '').trim().toLowerCase();
  if (!model) return true;
  const list = Array.isArray(account.modelsSupported) ? account.modelsSupported : [];
  if (list.length === 0) return true;
  return list.some((m) => model.includes(m) || m.includes(model));
}

function resolveAntigravityLocalStorageDirs({ localStorageDir = '', platform = process.platform, homeDir = os.homedir() } = {}) {
  const dirs = [];
  const pushUnique = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (!dirs.includes(resolved)) dirs.push(resolved);
  };
  if (localStorageDir) {
    pushUnique(localStorageDir);
    return dirs;
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    pushUnique(path.join(appData, 'Antigravity', 'Local Storage', 'leveldb'));
    return dirs;
  }
  if (platform === 'darwin') {
    pushUnique(path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'Local Storage', 'leveldb'));
    return dirs;
  }
  // Linux / WSL2: check Windows host AppData first when running in WSL, then native Linux config
  const winUsersRoot = '/mnt/c/Users';
  if (fs.existsSync(winUsersRoot)) {
    const preferredUsers = [];
    if (process.env.PRISM_WIN_USER) preferredUsers.push(process.env.PRISM_WIN_USER);
    try {
      const curUser = os.userInfo().username;
      if (curUser) preferredUsers.push(curUser);
    } catch {}
    preferredUsers.push('Administrator');
    const skip = new Set(['Public', 'Default', 'Default User', 'All Users']);
    for (const u of preferredUsers) {
      if (!u || skip.has(u)) continue;
      pushUnique(path.join(winUsersRoot, u, 'AppData', 'Roaming', 'Antigravity', 'Local Storage', 'leveldb'));
    }
    try {
      for (const ent of fs.readdirSync(winUsersRoot, { withFileTypes: true })) {
        if (!ent.isDirectory() || skip.has(ent.name) || ent.name.startsWith('.')) continue;
        pushUnique(path.join(winUsersRoot, ent.name, 'AppData', 'Roaming', 'Antigravity', 'Local Storage', 'leveldb'));
      }
    } catch {}
  }
  pushUnique(path.join(homeDir, '.config', 'Antigravity', 'Local Storage', 'leveldb'));
  return dirs;
}

function extractBalancedJsonObjectsAfterMarker(str, marker, maxObjChars = 16384) {
  const results = [];
  let pos = 0;
  while (pos < str.length) {
    const hit = str.indexOf(marker, pos);
    if (hit === -1) break;
    pos = hit + marker.length;
    const searchLimit = Math.min(str.length, pos + 96);
    const jStart = str.indexOf('{', pos);
    if (jStart === -1 || jStart > searchLimit) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    const endLimit = Math.min(str.length, jStart + maxObjChars);
    for (let i = jStart; i < endLimit; i++) {
      const c = str[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > jStart) {
      try {
        results.push(JSON.parse(str.slice(jStart, end)));
      } catch {}
      pos = end;
    }
  }
  return results;
}

function parseAntiClaudeQuotaSnapshotObject(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.groups) || obj.groups.length === 0) return null;
  const ts = Number(obj.ts);
  const validTs = Number.isFinite(ts) && ts > 1_000_000_000_000 ? ts : Date.now();
  const rawKey = String(obj.accountKey || '').trim();
  const keyFirst = rawKey.split('|')[0].trim().toLowerCase();
  const email = keyFirst.includes('@') && keyFirst.length <= 254 ? keyFirst : '';
  const tierName = String(obj.tierName || '').trim().slice(0, 48);

  let min5h = null;
  let min7d = null;
  let reset5hAt = '';
  let reset7dAt = '';
  const families = {};

  for (const g of obj.groups) {
    if (!g || !Array.isArray(g.buckets)) continue;
    const gName = String(g.displayName || '').toLowerCase();
    const famKey = /gemini/i.test(gName) ? 'gemini' : (/claude|gpt/i.test(gName) ? 'claude' : 'other');
    let g5 = null;
    let g7 = null;
    let g5Reset = '';
    let g7Reset = '';
    for (const b of g.buckets) {
      if (!b || typeof b !== 'object') continue;
      const frac = Number(b.remainingFraction);
      if (!Number.isFinite(frac)) continue;
      const pct = Math.max(0, Math.min(100, Math.round(frac * 1000) / 10));
      const win = `${b.window || ''} ${b.displayName || ''} ${b.description || ''}`.toLowerCase();
      const secRaw = b.resetTime && b.resetTime.seconds !== undefined ? Number(b.resetTime.seconds) : NaN;
      const rstIso = Number.isFinite(secRaw) && secRaw > 1_000_000_000 ? new Date(secRaw * 1000).toISOString() : '';
      if (/5\s*h|5\s*hour|5\s*小时/i.test(win)) {
        if (g5 === null || pct < g5) {
          g5 = pct;
          if (rstIso) g5Reset = rstIso;
        } else if (!g5Reset && rstIso) {
          g5Reset = rstIso;
        }
        if (min5h === null || pct < min5h) {
          min5h = pct;
          if (rstIso) reset5hAt = rstIso;
        } else if (!reset5hAt && rstIso) {
          reset5hAt = rstIso;
        }
      } else if (/week|7\s*d|周/i.test(win)) {
        if (g7 === null || pct < g7) {
          g7 = pct;
          if (rstIso) g7Reset = rstIso;
        } else if (!g7Reset && rstIso) {
          g7Reset = rstIso;
        }
        if (min7d === null || pct < min7d) {
          min7d = pct;
          if (rstIso) reset7dAt = rstIso;
        } else if (!reset7dAt && rstIso) {
          reset7dAt = rstIso;
        }
      }
    }
    if (g5 !== null || g7 !== null) {
      const prev = families[famKey] || {};
      const nextFam = { ...prev };
      if (g5 !== null && (prev.pct5h === undefined || g5 < prev.pct5h)) {
        nextFam.pct5h = g5;
        if (g5Reset) nextFam.reset5hAt = g5Reset;
      } else if (!nextFam.reset5hAt && g5Reset) {
        nextFam.reset5hAt = g5Reset;
      }
      if (g7 !== null && (prev.pct7d === undefined || g7 < prev.pct7d)) {
        nextFam.pct7d = g7;
        if (g7Reset) nextFam.reset7dAt = g7Reset;
      } else if (!nextFam.reset7dAt && g7Reset) {
        nextFam.reset7dAt = g7Reset;
      }
      families[famKey] = nextFam;
    }
  }

  if (min5h === null && min7d === null && Object.keys(families).length === 0) return null;
  return {
    email,
    ts: validTs,
    tierName,
    window5hPct: min5h,
    window7dPct: min7d,
    reset5hAt,
    reset7dAt,
    families: Object.keys(families).length ? families : null,
    observedAt: new Date(validTs).toISOString()
  };
}

export function readLocalAntigravityQuotaCache(options = {}) {
  const candidateDirs = resolveAntigravityLocalStorageDirs(options);
  const byEmail = new Map();
  let latest = null;
  let matchedDir = '';
  const MAX_SCAN_BYTES = 16 * 1024 * 1024;
  const MARKER = 'ag_claude_ux_quota_cache_v1';

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    let files = [];
    try {
      files = fs.readdirSync(dir)
        .filter((f) => /\.(log|ldb)$/i.test(f))
        .map((f) => {
          const full = path.join(dir, f);
          try {
            const st = fs.statSync(full);
            return { name: f, full, size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((x) => x && x.size > 0 && x.size <= MAX_SCAN_BYTES)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      continue;
    }
    if (!files.length) continue;
    matchedDir = dir;

    for (const file of files) {
      let buf;
      try {
        buf = fs.readFileSync(file.full);
      } catch {
        continue;
      }
      const candidates = [];
      if (buf.includes(Buffer.from(MARKER, 'latin1'))) {
        candidates.push(...extractBalancedJsonObjectsAfterMarker(buf.toString('latin1'), MARKER));
      }
      if (!candidates.length && buf.includes(Buffer.from(MARKER, 'utf16le'))) {
        candidates.push(...extractBalancedJsonObjectsAfterMarker(buf.toString('utf16le'), MARKER));
      }
      for (const rawObj of candidates) {
        const parsed = parseAntiClaudeQuotaSnapshotObject(rawObj);
        if (!parsed) continue;
        if (!latest || parsed.ts > latest.ts) latest = parsed;
        if (parsed.email) {
          const prev = byEmail.get(parsed.email);
          if (!prev || parsed.ts > prev.ts) {
            byEmail.set(parsed.email, parsed);
          }
        }
      }
    }
    if (byEmail.size > 0 || latest) break;
  }

  return { dir: matchedDir, byEmail, latest };
}

const PRISM_UI_ENUM_VALIDATORS = Object.freeze({
  lightPalette: new Set(['default', 'crystal', 'alabaster', 'sage']),
  darkPalette: new Set(['default', 'obsidian', 'basalt', 'marine']),
  performanceMode: new Set(['power-save', 'balanced', 'vivid']),
  mascotCountMode: new Set(['fixed', 'agents']),
  mascotStyle: new Set(['trio', 'zoo', 'cyber', 'crab', 'cat', 'penguin', 'fox', 'shiba', 'robot', 'owlet', 'axolotl', 'bunny', 'frog', 'chick', 'slime']),
  mascotVibe: new Set(['calm', 'lively']),
  thoughtMode: new Set(['off', 'bilingual', 'immersive']),
  composerBorderFx: new Set(['off', 'smart', 'beam', 'static']),
  outlineRailMode: new Set(['smart', 'right', 'off']),
  borderBeamMode: new Set(['always', 'busy']),
  borderBeamPalette: new Set(['theme', 'gemini', 'aurora', 'prism', 'neon', 'quota']),
  quotaRingPeriod: new Set(['auto', 'weekly', '5h']),
  thinkingOrbMode: new Set(['both', 'replace']),
  bubbleTintPreset: new Set(['accent', 'sky', 'emerald', 'amber', 'violet']),
  sidebarSessions: new Set(['default', '10', 'all']),
  i18nExtraMode: new Set(['off', 'zh-CN', 'zh-TW', 'en'])
});

const PRISM_UI_BOOL_KEYS = new Set([
  'outline', 'usageExtra', 'inkStream', 'mascot', 'mascotRoam',
  'borderBeam', 'quotaRing', 'thinkingOrb', 'bubbleTint', 'compactLayout',
  'unreadBadge', 'keepOverviewOpen', 'alwaysOutlineRail', 'switchReturnHelper',
  'switchAutoReturn', 'autoDismissOnboarding', 'quotaHandoffAlert',
  'imageContextMenu', 'cleanCopy', 'sshPaste', 'inlineEditHelper', 'sessionFork', 'composerFileDrop', 'wslExplorerRevealFix',
  'showWorkbenchBtn', 'fastWindowRestore', 'ignoreReducedMotion',
  'opticalFacets', 'semanticAfterglow', 'compactQuotaPill'
]);

const PRISM_UI_FONT_KEYS = Object.freeze(['chatFontFamily', 'codeFontFamily']);
const UNSAFE_FONT_FAMILY_RE = /[\x00-\x1f\x7f;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@import/i;
const hasBalancedFontQuotes = (s) => ((s.match(/"/g) || []).length % 2 === 0) && ((s.match(/'/g) || []).length % 2 === 0);

export function sanitizePrismUiPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.prefs && typeof raw.prefs === 'object' && !Array.isArray(raw.prefs))
    ? raw.prefs
    : raw;
  const out = {};
  let recognized = 0;
  for (const [k, allowed] of Object.entries(PRISM_UI_ENUM_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const v = src[k];
    if (typeof v === 'string' && allowed.has(v)) {
      out[k] = v;
      recognized++;
    }
  }
  for (const k of PRISM_UI_BOOL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    if (typeof src[k] === 'boolean') {
      out[k] = src[k];
      recognized++;
    }
  }
  if (Object.prototype.hasOwnProperty.call(src, 'mascotMinCount') && Number.isFinite(Number(src.mascotMinCount))) {
    out.mascotMinCount = clampInt(src.mascotMinCount, 1, 3, 1);
    recognized++;
  }
  if (Object.prototype.hasOwnProperty.call(src, 'mascotSize') && Number.isFinite(Number(src.mascotSize))) {
    const stepped = Math.round(Number(src.mascotSize) / 2) * 2;
    out.mascotSize = Math.max(16, Math.min(36, stepped));
    recognized++;
  }
  if (Object.prototype.hasOwnProperty.call(src, 'bubbleTintStrength') && Number.isFinite(Number(src.bubbleTintStrength))) {
    out.bubbleTintStrength = clampInt(src.bubbleTintStrength, 10, 100, 22);
    recognized++;
  }
  for (const fk of PRISM_UI_FONT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(src, fk)) continue;
    const v = src[fk];
    if (typeof v !== 'string') continue;
    const trimmedFont = v.trim();
    if (trimmedFont.length > 160 || UNSAFE_FONT_FAMILY_RE.test(trimmedFont) || !hasBalancedFontQuotes(trimmedFont)) continue;
    out[fk] = trimmedFont;
    recognized++;
  }
  if (recognized === 0) return null;
  const MIN_USER_TS = 1_700_000_000_000;
  const updatedAtRaw = typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
    ? Date.parse(raw.updatedAt.trim())
    : (typeof src.updatedAt === 'string' && src.updatedAt.trim() ? Date.parse(src.updatedAt.trim()) : NaN);
  const rawTs = src._ts !== undefined && src._ts !== null
    ? Number(src._ts)
    : (raw._ts !== undefined && raw._ts !== null ? Number(raw._ts) : updatedAtRaw);
  const tsOriginCandidate = src._tsOrigin ?? raw._tsOrigin;
  const isExplicit = tsOriginCandidate !== 'legacy' && Number.isFinite(rawTs) && rawTs >= MIN_USER_TS;
  out._ts = isExplicit ? Math.round(rawTs) : 0;
  out._tsOrigin = isExplicit ? 'explicit' : 'legacy';
  const legacyMtime = src._legacyMtime ?? raw._legacyMtime;
  if (!isExplicit && Number.isFinite(Number(legacyMtime)) && Number(legacyMtime) > 0) {
    out._legacyMtime = Math.round(Number(legacyMtime));
  }
  return out;
}

function readLevelDbWindow(filePath) {
  const MiB = 1024 * 1024;
  const MAX_FULL_BYTES = 16 * MiB;
  const TAIL_WINDOW_BYTES = 8 * MiB;
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) return null;
    const start = stat.size > MAX_FULL_BYTES ? stat.size - TAIL_WINDOW_BYTES : 0;
    const len = stat.size - start;
    const buf = Buffer.allocUnsafe(len);
    let used = 0;
    while (used < len) {
      const n = fs.readSync(fd, buf, used, len - used, start + used);
      if (!n) break;
      used += n;
    }
    return { buf: buf.subarray(0, used), mtimeMs: stat.mtimeMs };
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

export function readLocalPrismPrefsFromLevelDb(options = {}) {
  const candidateDirs = resolveAntigravityLocalStorageDirs(options);
  const MARKER = 'ag_prism_suite_prefs_v1';
  const MARKER_LATIN1 = Buffer.from(MARKER, 'latin1');
  const MARKER_UTF16_PROBE = Buffer.from('a\x00g\x00_\x00p\x00r\x00i\x00s\x00m\x00', 'latin1');
  let best = null;
  let seq = 0;
  let matchedDir = '';

  const beatsCandidate = (cand, cur) => {
    if (!cur) return true;
    if (cand.hasExplicitTs !== cur.hasExplicitTs) return cand.hasExplicitTs;
    if (cand.hasExplicitTs) {
      if (cand.prefs._ts !== cur.prefs._ts) return cand.prefs._ts > cur.prefs._ts;
      return cand.seq > cur.seq;
    }
    if (cand.mtimeMs !== cur.mtimeMs) return cand.mtimeMs > cur.mtimeMs;
    return cand.seq > cur.seq;
  };

  for (const dir of new Set(candidateDirs)) {
    if (!fs.existsSync(dir)) continue;
    let files = [];
    try {
      files = fs.readdirSync(dir)
        .filter((f) => /\.(log|ldb)$/i.test(f))
        .map((f) => {
          const full = path.join(dir, f);
          try {
            const st = fs.statSync(full);
            return st.isFile() && st.size > 0 ? { name: f, full, mtimeMs: Math.round(st.mtimeMs) } : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => (a.mtimeMs - b.mtimeMs) || a.name.localeCompare(b.name));
    } catch {
      continue;
    }

    for (const file of files) {
      let win;
      try {
        win = readLevelDbWindow(file.full);
      } catch {
        continue;
      }
      if (!win || !win.buf.length) continue;

      const { buf } = win;
      const mtimeMs = Math.round(win.mtimeMs || file.mtimeMs || 1);
      const rawObjs = [];
      if (buf.includes(MARKER_LATIN1)) {
        rawObjs.push(...extractBalancedJsonObjectsAfterMarker(buf.toString('latin1'), MARKER, 8192));
      }
      // LevelDB variable-length headers allow UTF-16LE payloads to start at either even (0) or odd (1) byte offset
      if (buf.includes(MARKER_UTF16_PROBE)) {
        for (const offset of [0, 1]) {
          const pairs = Math.floor((buf.length - offset) / 2);
          if (pairs > 0) {
            rawObjs.push(...extractBalancedJsonObjectsAfterMarker(buf.toString('utf16le', offset, offset + pairs * 2), MARKER, 8192));
          }
        }
      }

      for (const obj of rawObjs) {
        const clean = sanitizePrismUiPrefs(obj);
        if (!clean) continue;
        seq++;
        const hasExplicitTs = clean._tsOrigin === 'explicit' && clean._ts > 0;
        const prefsOut = hasExplicitTs
          ? { ...clean }
          : { ...clean, _ts: 0, _tsOrigin: 'legacy', _legacyMtime: mtimeMs };
        const cand = {
          prefs: prefsOut,
          hasExplicitTs,
          mtimeMs,
          seq,
          file: file.name,
          dir
        };
        if (beatsCandidate(cand, best)) {
          best = cand;
          matchedDir = dir;
        }
      }
    }
  }

  return best
    ? { found: true, dir: matchedDir, file: best.file, hasExplicitTs: best.hasExplicitTs, mtimeMs: best.mtimeMs, prefs: best.prefs }
    : { found: false, dir: matchedDir, file: '', hasExplicitTs: false, mtimeMs: 0, prefs: null };
}

function resolveAntiClaudeExtensionDirs({ homeDir = os.homedir(), platform = process.platform, extraExtensionDirs = [] } = {}) {
  const dirs = [];
  const pushUnique = (p) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (!dirs.includes(resolved)) dirs.push(resolved);
  };
  if (Array.isArray(extraExtensionDirs)) {
    for (const d of extraExtensionDirs) pushUnique(d);
  }
  pushUnique(path.join(homeDir, '.gemini', 'antigravity', 'anti-claude', 'user', 'extensions'));
  if (platform !== 'win32' && platform !== 'darwin' && fs.existsSync('/mnt/c/Users')) {
    const skip = new Set(['Public', 'Default', 'Default User', 'All Users']);
    const preferred = [process.env.PRISM_WIN_USER, 'Administrator'].filter(Boolean);
    try {
      const u = os.userInfo().username;
      if (u) preferred.unshift(u);
    } catch {}
    for (const u of preferred) {
      if (!skip.has(u)) pushUnique(path.join('/mnt/c/Users', u, '.gemini', 'antigravity', 'anti-claude', 'user', 'extensions'));
    }
    try {
      for (const ent of fs.readdirSync('/mnt/c/Users', { withFileTypes: true })) {
        if (!ent.isDirectory() || skip.has(ent.name) || ent.name.startsWith('.')) continue;
        pushUnique(path.join('/mnt/c/Users', ent.name, '.gemini', 'antigravity', 'anti-claude', 'user', 'extensions'));
      }
    } catch {}
  }
  return dirs;
}

function buildPrismPrefsSeedJs(cleanPrefs) {
  return [
    '/* Auto-generated by Anti-Claude Prism Suite — cross-port UI preferences seed (zero credentials) */',
    '(() => {',
    `  const seed = ${JSON.stringify(cleanPrefs)};`,
    '  window.__agPrismDiskPrefs = seed;',
    "  if (window.__agPrismBus && typeof window.__agPrismBus.hydrateDiskPrefs === 'function') {",
    '    try { window.__agPrismBus.hydrateDiskPrefs(seed); } catch {}',
    '  }',
    '})();',
    ''
  ].join('\n');
}

export function evaluateQuotaPoolHealth(eff, activeModel = '') {
  if (!eff || typeof eff !== 'object') {
    return { minPct: null, avgPct: null, hasKnown: false };
  }
  const model = String(activeModel || '').trim().toLowerCase();
  const targetFam = /claude|sonnet|opus|gpt/.test(model)
    ? 'claude'
    : (/gemini/.test(model) ? 'gemini' : '');
  const vals = [];
  const pushIfFinite = (v) => {
    const n = toFinitePctOrNull(v);
    if (n !== null) vals.push(n);
  };

  const fams = eff.families && typeof eff.families === 'object' ? eff.families : null;
  if (targetFam) {
    if (fams && fams[targetFam]) {
      pushIfFinite(fams[targetFam].pct5h);
      pushIfFinite(fams[targetFam].pct7d);
    }
  } else if (fams && (fams.gemini || fams.claude || fams.other)) {
    for (const fk of ['gemini', 'claude', 'other']) {
      if (!fams[fk]) continue;
      pushIfFinite(fams[fk].pct5h);
      pushIfFinite(fams[fk].pct7d);
    }
  }
  if (!vals.length) {
    pushIfFinite(eff.effective5hPct);
    pushIfFinite(eff.effective7dPct);
  }
  if (!vals.length) {
    return { minPct: null, avgPct: null, hasKnown: false };
  }
  const minPct = Math.min(...vals);
  const avgPct = vals.reduce((acc, x) => acc + x, 0) / vals.length;
  return { minPct, avgPct, hasKnown: true };
}

export function createAccountManager(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const stateDir = path.resolve(options.stateDir || path.join(homeDir, '.gemini', 'antigravity', 'prism-suite'));
  const brainDir = path.resolve(options.brainDir || path.join(homeDir, '.gemini', 'antigravity', 'brain'));
  const localStorageDir = options.localStorageDir ? path.resolve(options.localStorageDir) : '';
  const disableLocalQuotaScan = Boolean(options.disableLocalQuotaScan);
  const accountsFile = path.join(stateDir, 'accounts.json');
  const lockFile = path.join(stateDir, 'switch.lock');
  const snapshotFile = path.join(stateDir, 'handoff-snapshot.json');
  const uiPrefsFile = path.join(stateDir, 'ui-prefs.json');
  const extraExtensionDirs = Array.isArray(options.extensionDirs) ? options.extensionDirs : [];

  const curPlatform = String(options.platform || process.platform);
  const curWslDistro = options.wslDistro !== undefined
    ? String(options.wslDistro || '')
    : (curPlatform === 'linux' ? String(process.env.WSL_DISTRO_NAME || '') : '');
  const vault = options.vault || createAccountVault({
    platform: options.platform,
    isWsl: options.isWsl,
    wslDistro: options.wslDistro,
    homeDir,
    runCmd: options.runCmd
  });
  const handoffMemory = options.handoffMemory || null;
  const serverPid = Number(options.serverPid) || process.pid;
  const serverBootMs = Number.isFinite(Number(options.serverBootMs))
    ? Number(options.serverBootMs)
    : Math.round(Date.now() - Math.max(0, process.uptime()) * 1000);
  let lastAccountsMtimeMs = -1;
  let localQuotaCacheSig = '';
  let localQuotaCacheResult = null;

  function readLocalQuotaCached(force = false) {
    if (disableLocalQuotaScan) return { dir: '', byEmail: new Map(), latest: null };
    try {
      const dirs = resolveAntigravityLocalStorageDirs({ localStorageDir, platform: options.platform || process.platform, homeDir });
      const activeDir = dirs.find((d) => fs.existsSync(d)) || '';
      if (!activeDir) return { dir: '', byEmail: new Map(), latest: null };
      const sigParts = [];
      for (const name of fs.readdirSync(activeDir)) {
        if (!/\.(log|ldb)$/i.test(name)) continue;
        try {
          const st = fs.statSync(path.join(activeDir, name));
          sigParts.push(`${name}:${st.size}:${Math.round(st.mtimeMs)}`);
        } catch {}
      }
      const sig = `${activeDir}|${sigParts.sort().join(',')}`;
      if (!force && localQuotaCacheResult && sig === localQuotaCacheSig) {
        return localQuotaCacheResult;
      }
      const res = readLocalAntigravityQuotaCache({ localStorageDir: activeDir, platform: options.platform || process.platform, homeDir });
      localQuotaCacheSig = sig;
      localQuotaCacheResult = res;
      return res;
    } catch {
      return { dir: '', byEmail: new Map(), latest: null };
    }
  }

  function hydrateAccountsFromLocalQuotaCache(state, { force = false } = {}) {
    if (!state || !Array.isArray(state.accounts) || state.accounts.length === 0) return false;
    const scanned = readLocalQuotaCached(force);
    if (!scanned || !scanned.byEmail || scanned.byEmail.size === 0) return false;
    let dirty = false;
    for (let i = 0; i < state.accounts.length; i++) {
      const acc = state.accounts[i];
      const em = String(acc.email || '').trim().toLowerCase();
      if (!em) continue;
      const snap = scanned.byEmail.get(em);
      if (!snap) continue;
      const prev = acc.lastQuota || null;
      const prevObservedMs = prev ? Date.parse(prev.observedAt || prev.updatedAt || '') : 0;
      const shouldApply = !prev || !Number.isFinite(prevObservedMs) || snap.ts > prevObservedMs + 500;
      if (!shouldApply) continue;
      const nextQuota = classifyQuotaWindow({
        window5hPct: snap.window5hPct,
        window7dPct: snap.window7dPct,
        reset5hAt: snap.reset5hAt,
        reset7dAt: snap.reset7dAt,
        tierName: snap.tierName || prev?.tierName || '',
        families: snap.families || prev?.families || null,
        observedAt: snap.observedAt,
        source: 'anti-claude-cache'
      }, snap.ts);
      state.accounts[i] = { ...acc, lastQuota: nextQuota };
      dirty = true;
    }
    if (dirty) {
      try { saveState(state); } catch {}
    }
    return dirty;
  }

  function syncPrismPrefsSeed({ writeExtensionSeed = false, allowBareExtensionDir = false } = {}) {
    let saved = null;
    if (fs.existsSync(uiPrefsFile)) {
      try {
        const parsed = sanitizePrismUiPrefs(JSON.parse(fs.readFileSync(uiPrefsFile, 'utf8')));
        if (parsed) {
          const explicit = parsed._tsOrigin === 'explicit' && parsed._ts > 0;
          const mtimeMs = Number.isFinite(parsed._legacyMtime)
            ? parsed._legacyMtime
            : Math.round(fs.statSync(uiPrefsFile).mtimeMs || 1);
          saved = { prefs: parsed, hasExplicitTs: explicit, mtimeMs };
        }
      } catch {}
    }
    const scanned = disableLocalQuotaScan
      ? { found: false, hasExplicitTs: false, mtimeMs: 0, prefs: null }
      : readLocalPrismPrefsFromLevelDb({ localStorageDir, platform: options.platform || process.platform, homeDir });

    let best = saved;
    if (scanned.found && scanned.prefs) {
      if (!best) {
        best = { prefs: scanned.prefs, hasExplicitTs: scanned.hasExplicitTs, mtimeMs: scanned.mtimeMs };
      } else {
        const sameExplicitTs = best.hasExplicitTs && scanned.hasExplicitTs && scanned.prefs._ts === best.prefs._ts;
        const scanWins = !sameExplicitTs && (
          (scanned.hasExplicitTs && !best.hasExplicitTs) ||
          (scanned.hasExplicitTs && best.hasExplicitTs && scanned.prefs._ts > best.prefs._ts) ||
          (!scanned.hasExplicitTs && !best.hasExplicitTs && scanned.mtimeMs > best.mtimeMs)
        );
        if (scanWins) {
          best = { prefs: scanned.prefs, hasExplicitTs: scanned.hasExplicitTs, mtimeMs: scanned.mtimeMs };
        }
      }
    }
    if (!best) {
      return { ok: true, found: false, prefs: null, writtenSeedFiles: [] };
    }

    const diskPayload = { ...best.prefs, _tsOrigin: best.hasExplicitTs ? 'explicit' : 'legacy' };
    if (best.hasExplicitTs) {
      delete diskPayload._legacyMtime;
    } else {
      diskPayload._ts = 0;
      diskPayload._legacyMtime = best.mtimeMs;
    }

    if (!saved || JSON.stringify(saved.prefs) !== JSON.stringify(diskPayload)) {
      try { writeJsonAtomic0600(uiPrefsFile, diskPayload); } catch {}
    }

    const seedPayload = { ...diskPayload };
    delete seedPayload._legacyMtime;

    const writtenSeedFiles = [];
    if (writeExtensionSeed) {
      const jsText = buildPrismPrefsSeedJs(seedPayload);
      const extDirs = resolveAntiClaudeExtensionDirs({
        homeDir,
        platform: options.platform || process.platform,
        extraExtensionDirs
      });
      for (const extDir of new Set(extDirs)) {
        try {
          if (!fs.existsSync(extDir)) continue;
          // Only drop seed next to an installed Prism Suite unless explicitly requested in tests
          if (!allowBareExtensionDir && !fs.statSync(path.join(extDir, 'prism-suite.js'), { throwIfNoEntry: false })?.isFile()) continue;
          const seedPath = path.join(extDir, 'prism-suite-00-prefs.js');
          if (fs.existsSync(seedPath) && fs.readFileSync(seedPath, 'utf8') === jsText) {
            writtenSeedFiles.push(seedPath);
            continue;
          }
          const tmpSeed = path.join(extDir, `.prism-prefs-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
          try {
            fs.writeFileSync(tmpSeed, jsText, { encoding: 'utf8', flag: 'wx' });
            fs.renameSync(tmpSeed, seedPath);
          } catch {
            try { fs.rmSync(tmpSeed, { force: true }); } catch {}
            fs.writeFileSync(seedPath, jsText, 'utf8');
          }
          writtenSeedFiles.push(seedPath);
        } catch {}
      }
    }

    return { ok: true, found: true, prefs: seedPayload, uiPrefsFile, writtenSeedFiles };
  }

  function loadState() {
    const base = defaultAccountState(stateDir);
    if (!fs.existsSync(accountsFile)) return base;
    try {
      const st = fs.statSync(accountsFile);
      const mtimeMs = Math.round(Number(st.mtimeMs) || 0);
      if (lastAccountsMtimeMs !== -1 && mtimeMs !== lastAccountsMtimeMs && typeof vault.invalidateCache === 'function') {
        vault.invalidateCache();
      }
      lastAccountsMtimeMs = mtimeMs;
      const parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return base;
      const merged = {
        ...base,
        enabled: Boolean(parsed.enabled),
        countdownSeconds: clampInt(parsed.countdownSeconds, 3, 15, 5),
        primaryHysteresisPct: clampInt(parsed.primaryHysteresisPct, 5, 50, 20),
        autoRelaunchAfterSwitch: parsed.autoRelaunchAfterSwitch === undefined ? true : Boolean(parsed.autoRelaunchAfterSwitch),
        activeAccountId: typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : '',
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts.filter((a) => a && typeof a.id === 'string') : [],
        pendingSwitch: parsed.pendingSwitch && typeof parsed.pendingSwitch === 'object' ? parsed.pendingSwitch : null,
        lastSnapshotAt: typeof parsed.lastSnapshotAt === 'string' ? parsed.lastSnapshotAt : ''
      };
      if (merged.pendingSwitch && merged.pendingSwitch.expiresAt && Date.now() > Number(merged.pendingSwitch.expiresAt)) {
        merged.pendingSwitch = null;
      }
      return merged;
    } catch {
      return base;
    }
  }

  function saveState(nextState) {
    const clean = {
      version: 1,
      enabled: Boolean(nextState.enabled),
      countdownSeconds: clampInt(nextState.countdownSeconds, 3, 15, 5),
      primaryHysteresisPct: clampInt(nextState.primaryHysteresisPct, 5, 50, 20),
      autoRelaunchAfterSwitch: nextState.autoRelaunchAfterSwitch === undefined ? true : Boolean(nextState.autoRelaunchAfterSwitch),
      activeAccountId: String(nextState.activeAccountId || ''),
      accounts: Array.isArray(nextState.accounts) ? nextState.accounts : [],
      pendingSwitch: nextState.pendingSwitch || null,
      lastSnapshotAt: String(nextState.lastSnapshotAt || '')
    };
    writeJsonAtomic0600(accountsFile, clean);
    try {
      lastAccountsMtimeMs = Math.round(Number(fs.statSync(accountsFile).mtimeMs) || 0);
    } catch {}
    return { ...clean, stateDir };
  }

  function acquireSwitchLock(targetId) {
    fs.mkdirSync(stateDir, { recursive: true });
    const lockToken = crypto.randomBytes(16).toString('hex');
    const payload = JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      platform: curPlatform,
      wslDistro: curWslDistro,
      createdAt: Date.now(),
      targetId: String(targetId || ''),
      lockToken
    });
    const releaseLock = () => {
      try {
        if (!fs.existsSync(lockFile)) return;
        const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (cur && cur.lockToken === lockToken) {
          fs.rmSync(lockFile, { force: true });
        }
      } catch {}
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.writeFileSync(lockFile, payload, { flag: 'wx', mode: 0o600 });
        return releaseLock;
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err;
        let stale = false;
        try {
          const rawLock = fs.readFileSync(lockFile, 'utf8');
          const existing = JSON.parse(rawLock);
          const age = Date.now() - Number(existing.createdAt || 0);
          const sameHost = !existing.hostname || existing.hostname === os.hostname();
          const samePidNamespace =
            sameHost &&
            existing.platform === curPlatform &&
            String(existing.wslDistro || '') === curWslDistro;
          if (age > STALE_LOCK_MS || (samePidNamespace && !isPidAliveLocal(existing.pid))) {
            stale = true;
          }
        } catch {
          try {
            const st = fs.statSync(lockFile);
            if (Date.now() - Number(st.mtimeMs || 0) > 2500) stale = true;
          } catch {}
        }
        if (stale && attempt < 2) {
          try { fs.unlinkSync(lockFile); } catch {}
          continue;
        }
        throw Object.assign(new Error('已有切换事务正在进行中，请稍后再试'), { code: 'SWITCH_IN_PROGRESS' });
      }
    }
    throw Object.assign(new Error('无法获取切换互斥锁'), { code: 'SWITCH_IN_PROGRESS' });
  }

  function loadLastSnapshot() {
    if (!fs.existsSync(snapshotFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    } catch {
      return null;
    }
  }

  function pickRecommendedTarget({ currentId = '', reason = 'manual', activeModel = '', quotaSnapshot = null, state: providedState = null } = {}) {
    const state = providedState || loadState();
    const accounts = state.accounts || [];
    const curId = currentId || state.activeAccountId || '';
    const primary = accounts.find((a) => a.role === 'primary') || null;
    const hysteresis = clampInt(state.primaryHysteresisPct, 5, 50, 20);

    let crossFamilyHint = '';
    if (reason === '5h_low' || (quotaSnapshot && Number(quotaSnapshot.window5hPct) <= 10)) {
      const fam = String(quotaSnapshot?.modelFamily || '').toLowerCase();
      const alt = fam.includes('claude') ? 'Gemini 4 系列' : fam.includes('gemini') ? 'Claude 系列' : '另一独立模型家族';
      crossFamilyHint = `当前触发 5h 窗口预警（≤ 10%）：若不急于切号，可先直接切到「${alt}」继续；若需保留当前模型，请选择下方备用账号。`;
    }

    let primaryRecovery = null;
    if (primary && curId && primary.id !== curId) {
      const eff = computeEffectiveQuota(primary.lastQuota);
      const health = evaluateQuotaPoolHealth(eff, activeModel);
      const p7 = toFinitePctOrNull(eff?.effective7dPct);
      const p5 = toFinitePctOrNull(eff?.effective5hPct);
      const topOk = (p7 === null || p7 >= hysteresis) && (p5 === null || p5 >= hysteresis);
      const poolOk = !health.hasKnown || health.minPct >= hysteresis;
      if (topOk && poolOk) {
        primaryRecovery = {
          accountId: primary.id,
          email: primary.email,
          alias: primary.alias || '主账号',
          reason: eff?.reset7dPassed || eff?.reset5hPassed
            ? `主账号各模型池额度预计已重置恢复（≥ ${hysteresis}%），可择机切回主号继续使用`
            : `主账号各模型池额度充沛（≥ ${hysteresis}% 滞回阈值），可择机切回主号继续使用`
        };
      }
    }

    const candidates = accounts
      .filter((a) => a.id !== curId)
      .map((a) => {
        const compatible = accountSupportsModel(a, activeModel);
        const eff = computeEffectiveQuota(a.lastQuota);
        const health = evaluateQuotaPoolHealth(eff, activeModel);
        const minPct = health.minPct;
        const avgPct = health.avgPct;
        const qScore = health.hasKnown
          ? minPct * 1.15 + avgPct * 0.35
          : 92;
        const healthyForRecommend = !health.hasKnown || minPct >= hysteresis;
        const depletedPool = health.hasKnown && minPct < 20;
        const criticallyLow = health.hasKnown && minPct < 10;
        const roleBoost = a.role === 'primary' && healthyForRecommend ? 200 : 0;
        const lowPenalty = criticallyLow ? 600 : (depletedPool ? 380 : 0);
        const compatBoost = compatible ? 1000 : 0;
        const prioPenalty = clampInt(a.priority, 1, 99, 50);
        return {
          account: a,
          compatible,
          hasKnownQuota: health.hasKnown,
          minPct,
          depletedPool,
          score: compatBoost + roleBoost + qScore - lowPenalty - prioPenalty
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = candidates[0] || null;
    // Never mark an account as "recommended" if its bottleneck pool is clearly depleted (<20%)
    const eligibleBest = best && !best.depletedPool ? best : null;
    return {
      recommended: eligibleBest
        ? {
            accountId: eligibleBest.account.id,
            email: eligibleBest.account.email,
            alias: eligibleBest.account.alias || eligibleBest.account.email,
            role: eligibleBest.account.role,
            modelCompatible: eligibleBest.compatible
          }
        : null,
      primaryRecovery,
      crossFamilyHint
    };
  }

  function getStatus({ activeModel = '', quotaHints = null, forceRefresh = false } = {}) {
    const state = loadState();
    const force = Boolean(forceRefresh);
    hydrateAccountsFromLocalQuotaCache(state, { force });
    if (force) {
      try { syncPrismPrefsSeed({ writeExtensionSeed: false }); } catch {}
    }
    const vaultProbe = vault.probe({ force });
    let activeCred = { exists: false, email: '', hashPrefix: '', byteLength: 0, hasUserScope: false };
    let activeError = '';
    if (vaultProbe.supported) {
      try {
        activeCred = vault.inspectActive();
      } catch (err) {
        activeError = String(err?.message || err);
      }
    }

    const matchedActive = activeCred.email
      ? state.accounts.find((a) => a.email === activeCred.email) || null
      : null;

    // Auto-clear pendingSwitch once Antigravity has restarted (new MCP server instance booted after swap)
    if (state.pendingSwitch && state.pendingSwitch.phase === 'active-swapped') {
      const ps = state.pendingSwitch;
      const switchedMs = Number(ps.switchedAtMs || Date.parse(ps.switchedAt || '') || 0);
      const restartedAfterSwap = switchedMs > 0 && serverBootMs > switchedMs;
      const differentProcessOnTarget =
        Boolean(ps.originPid && ps.originPid !== serverPid) &&
        Boolean(activeCred.email && ps.targetEmail && activeCred.email === ps.targetEmail);
      if (restartedAfterSwap || differentProcessOnTarget) {
        state.pendingSwitch = null;
        try { saveState(state); } catch {}
      }
    }

    let savedPresenceMap = null;
    if (vaultProbe.supported && state.accounts.length > 0 && typeof vault.inspectSavedMany === 'function') {
      try {
        savedPresenceMap = vault.inspectSavedMany(state.accounts.map((a) => a.id), { force });
      } catch {
        savedPresenceMap = null;
      }
    }

    const accountsWithVault = state.accounts.map((a) => {
      let vaultHasBackup = false;
      if (vaultProbe.supported) {
        if (savedPresenceMap && Object.prototype.hasOwnProperty.call(savedPresenceMap, a.id)) {
          vaultHasBackup = Boolean(savedPresenceMap[a.id]?.exists);
        } else {
          try {
            const saved = vault.inspectSaved(a.id, { force });
            vaultHasBackup = Boolean(saved.exists);
          } catch {
            vaultHasBackup = false;
          }
        }
      }
      return {
        ...a,
        effectiveQuota: computeEffectiveQuota(a.lastQuota),
        vaultHasBackup,
        isCurrentActive: Boolean(matchedActive && matchedActive.id === a.id) || state.activeAccountId === a.id
      };
    });

    const recommendation = pickRecommendedTarget({
      currentId: matchedActive ? matchedActive.id : state.activeAccountId,
      reason: quotaHints?.reason || 'manual',
      activeModel,
      quotaSnapshot: quotaHints,
      state
    });

    return {
      ok: true,
      enabled: state.enabled,
      countdownSeconds: state.countdownSeconds,
      primaryHysteresisPct: state.primaryHysteresisPct,
      autoRelaunchAfterSwitch: state.autoRelaunchAfterSwitch !== false,
      stateDir,
      vault: vaultProbe,
      activeCredential: {
        exists: activeCred.exists,
        email: activeCred.email,
        hashPrefix: activeCred.hashPrefix,
        hasUserScope: activeCred.hasUserScope,
        matchedAccountId: matchedActive ? matchedActive.id : '',
        unregistered: Boolean(activeCred.exists && activeCred.email && !matchedActive),
        error: activeError
      },
      accounts: accountsWithVault,
      recommendation,
      pendingSwitch: state.pendingSwitch,
      lastSnapshot: loadLastSnapshot()
    };
  }

  function setEnabled(enabled, { countdownSeconds, primaryHysteresisPct, autoRelaunchAfterSwitch } = {}) {
    const state = loadState();
    if (enabled !== undefined && enabled !== null) {
      state.enabled = Boolean(enabled);
    }
    if (countdownSeconds !== undefined) {
      state.countdownSeconds = clampInt(countdownSeconds, 3, 15, state.countdownSeconds);
    }
    if (primaryHysteresisPct !== undefined) {
      state.primaryHysteresisPct = clampInt(primaryHysteresisPct, 5, 50, state.primaryHysteresisPct);
    }
    if (autoRelaunchAfterSwitch !== undefined) {
      state.autoRelaunchAfterSwitch = Boolean(autoRelaunchAfterSwitch);
    }
    return saveState(state);
  }

  function assertEnabled(state) {
    if (!state.enabled) {
      throw Object.assign(
        new Error('账号接力模块当前处于默认关闭状态，请先在「账号接力」面板确认安全边界后手动开启'),
        { code: 'ACCOUNTS_DISABLED' }
      );
    }
  }

  function captureCurrentAccount({ role, alias = '', modelsSupported = [] } = {}) {
    const releaseLock = acquireSwitchLock('capture');
    try {
      const state = loadState();
      assertEnabled(state);
      const active = vault.inspectActive();
      if (!active.exists) {
        throw Object.assign(new Error('未检测到当前登录的 Antigravity 凭据'), { code: 'NO_ACTIVE_CREDENTIAL' });
      }
      const email = active.email;
      if (!email) {
        throw Object.assign(new Error('当前凭据未携带可验证邮箱，已拒绝绑定以防止串号'), { code: 'EMAIL_UNVERIFIABLE' });
      }

      const existing = state.accounts.find((a) => a.email === email);
      const id = existing ? existing.id : deriveAccountIdFromEmail(email);
      const hasPrimary = state.accounts.some((a) => a.role === 'primary' && a.id !== id);
      const desiredRole = role === 'primary' || (!hasPrimary && !existing) ? 'primary' : (role === 'backup' ? 'backup' : (existing?.role || 'backup'));

      const saved = vault.saveActiveTo(id, { expectedEmail: email });
      const nowIso = new Date().toISOString();

      if (desiredRole === 'primary') {
        for (const acc of state.accounts) {
          if (acc.id !== id && acc.role === 'primary') acc.role = 'backup';
        }
      }

      const nextEntry = {
        id,
        email,
        alias: redactMemoryText(String(alias || existing?.alias || (desiredRole === 'primary' ? '主账号' : '备用账号')).trim().slice(0, 48)),
        role: desiredRole,
        priority: existing?.priority ?? (desiredRole === 'primary' ? 1 : state.accounts.length + 2),
        modelsSupported: modelsSupported.length ? normalizeModelList(modelsSupported) : (existing?.modelsSupported || []),
        credHash: saved.hashPrefix,
        capturedAt: existing?.capturedAt || nowIso,
        lastUsedAt: nowIso,
        lastQuota: existing?.lastQuota || null
      };

      if (existing) {
        const idx = state.accounts.findIndex((a) => a.id === id);
        state.accounts[idx] = nextEntry;
      } else {
        state.accounts.push(nextEntry);
      }
      state.activeAccountId = id;
      saveState(state);

      return { ok: true, account: nextEntry, updated: Boolean(existing) };
    } finally {
      releaseLock();
    }
  }

  function updateAccount(accountId, { alias, role, priority, modelsSupported, quota } = {}) {
    const cleanId = sanitizeAccountId(accountId);
    const state = loadState();
    const idx = state.accounts.findIndex((a) => a.id === cleanId);
    if (idx === -1) {
      throw Object.assign(new Error(`未找到账号槽位: ${cleanId}`), { code: 'ACCOUNT_NOT_FOUND' });
    }
    const target = { ...state.accounts[idx] };
    if (alias !== undefined) {
      const cleanedAlias = redactMemoryText(String(alias).trim().slice(0, 48));
      target.alias = cleanedAlias || ((role || target.role) === 'primary' ? '主账号' : '备用账号');
    }
    if (role === 'primary' || role === 'backup') {
      if (role === 'primary') {
        for (const acc of state.accounts) {
          if (acc.id !== cleanId && acc.role === 'primary') acc.role = 'backup';
        }
      }
      target.role = role;
    }
    if (priority !== undefined) {
      target.priority = clampInt(priority, 1, 99, target.priority || 10);
    }
    if (modelsSupported !== undefined) {
      target.modelsSupported = normalizeModelList(modelsSupported);
    }
    if (quota && typeof quota === 'object') {
      target.lastQuota = classifyQuotaWindow(quota);
    }
    state.accounts[idx] = target;
    saveState(state);
    return { ok: true, account: { ...target, effectiveQuota: computeEffectiveQuota(target.lastQuota) } };
  }

  function syncActiveAccountQuota(quotaInput = {}) {
    const state = loadState();
    const expectedEmail = typeof quotaInput?.expectedEmail === 'string'
      ? quotaInput.expectedEmail.trim().toLowerCase()
      : '';
    let activeEmail = '';
    let target = null;
    try {
      const active = vault.inspectActive();
      if (active.exists && active.email) {
        activeEmail = active.email.trim().toLowerCase();
        target = state.accounts.find((a) => a.email === activeEmail) || null;
      }
    } catch {}
    // Guard against writing stale quota cache from a previous account right after switching before restart
    if (expectedEmail && activeEmail && expectedEmail !== activeEmail) {
      return {
        ok: true,
        skipped: true,
        reason: 'EMAIL_MISMATCH_SKIPPED',
        expectedEmail,
        activeEmail
      };
    }
    if (!target && expectedEmail) {
      target = state.accounts.find((a) => a.email === expectedEmail) || null;
    }
    if (!target && state.activeAccountId) {
      target = state.accounts.find((a) => a.id === state.activeAccountId) || null;
    }
    if (!target) {
      return {
        ok: false,
        code: 'NO_CAPTURED_ACTIVE_ACCOUNT',
        error: '当前活跃账号尚未在「Prism 工作台 → 账号接力」捕获，暂无法同步额度快照'
      };
    }

    const incoming = classifyQuotaWindow(quotaInput);
    const hasAnyIncoming =
      incoming.window5hPct !== null ||
      incoming.window7dPct !== null ||
      Boolean(incoming.reset5hAt) ||
      Boolean(incoming.reset7dAt) ||
      Boolean(incoming.families);
    if (!hasAnyIncoming) {
      return {
        ok: true,
        skipped: true,
        accountId: target.id,
        alias: target.alias,
        role: target.role,
        email: target.email,
        effectiveQuota: computeEffectiveQuota(target.lastQuota)
      };
    }

    // Preserve still-valid (non-expired) fields from previous snapshot when partial live telemetry arrives
    const nowMs = Date.now();
    const prev = target.lastQuota && typeof target.lastQuota === 'object' ? target.lastQuota : {};
    const prevR5Ms = Date.parse(prev.reset5hAt || '');
    const prevR7Ms = Date.parse(prev.reset7dAt || '');
    const prevR5Valid = Number.isFinite(prevR5Ms) && prevR5Ms > nowMs;
    const prevR7Valid = Number.isFinite(prevR7Ms) && prevR7Ms > nowMs;
    const prevEff = computeEffectiveQuota(prev, nowMs);
    const mergedInput = {
      window5hPct: incoming.window5hPct !== null ? incoming.window5hPct : (prevEff && !prevEff.reset5hPassed ? (prev.window5hPct ?? null) : null),
      window7dPct: incoming.window7dPct !== null ? incoming.window7dPct : (prevEff && !prevEff.reset7dPassed ? (prev.window7dPct ?? null) : null),
      reset5hAt: incoming.reset5hAt || (prevR5Valid ? prev.reset5hAt : ''),
      reset7dAt: incoming.reset7dAt || (prevR7Valid ? prev.reset7dAt : ''),
      resetsAt: incoming.resetsAt || '',
      modelFamily: incoming.modelFamily || prev.modelFamily || '',
      tierName: incoming.tierName || prev.tierName || '',
      families: incoming.families || prev.families || undefined
    };

    const upd = updateAccount(target.id, { quota: mergedInput });
    return {
      ok: true,
      accountId: upd.account.id,
      alias: upd.account.alias,
      role: upd.account.role,
      email: upd.account.email,
      effectiveQuota: upd.account.effectiveQuota
    };
  }

  function saveHandoffSnapshot({
    slot = 'default',
    project = '',
    cwd = '',
    conversationPath = '',
    verifiedSummary = '',
    nextAction = '',
    fromAccount = '',
    toAccount = '',
    alsoRecordMemory = true
  } = {}) {
    const resolvedCwd = cwd ? path.resolve(cwd) : '';
    const git = readGitSummaryReadOnly(resolvedCwd);
    const projectName = String(project || (resolvedCwd ? path.basename(resolvedCwd) : 'workspace') || 'workspace')
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .slice(0, 48) || 'workspace';
    const cleanSlot = String(slot || 'default').trim().replace(/[^\w.-]+/g, '-').slice(0, 32) || 'default';
    const createdAt = new Date().toISOString();

    const safeSnapshot = {
      version: 1,
      createdAt,
      project: projectName,
      slot: cleanSlot,
      slotTag: `handoff:${projectName}:${cleanSlot}`,
      fromAccount: redactMemoryText(String(fromAccount || '')),
      toAccount: redactMemoryText(String(toAccount || '')),
      cwd: resolvedCwd,
      conversationPath: redactMemoryText(String(conversationPath || '')),
      git,
      verifiedSummary: redactMemoryText(String(verifiedSummary || '切号前自动保留现场与工作区状态').slice(0, 1000)),
      nextAction: redactMemoryText(String(nextAction || '重启 Antigravity 后回到原会话继续执行').slice(0, 500))
    };

    const mdLines = [
      `### 多账号槽位交接快照 · ${safeSnapshot.slotTag}`,
      `- 时间：${createdAt}`,
      `- 目录：\`${safeSnapshot.cwd || '(未指定)'}\``,
      `- Git：${git.isRepo ? `\`${git.branch}\` @ \`${git.head || '-'}\`（未提交改动 ${git.dirtyCount} 项）` : '非 Git 目录或未探测'}`,
      `- 原对话：${safeSnapshot.conversationPath || '(保留本地全量会话，不修改 SQLite / brain)'}`,
      `- 账号切换：${safeSnapshot.fromAccount || '当前号'} → ${safeSnapshot.toAccount || '目标号'}`,
      `- 已验证进度：${safeSnapshot.verifiedSummary}`,
      `- 下一步：${safeSnapshot.nextAction}`
    ];
    safeSnapshot.markdown = mdLines.join('\n');

    writeJsonAtomic0600(snapshotFile, safeSnapshot);
    const state = loadState();
    state.lastSnapshotAt = createdAt;
    saveState(state);

    let memoryEntry = null;
    if (alsoRecordMemory && handoffMemory) {
      memoryEntry = handoffMemory.store({
        project: projectName,
        slot: cleanSlot,
        summary: `${safeSnapshot.fromAccount ? safeSnapshot.fromAccount + ' → ' + (safeSnapshot.toAccount || '备用') + '：' : ''}${safeSnapshot.nextAction}`,
        cwd: safeSnapshot.cwd,
        gitBranch: git.branch,
        gitHead: git.head,
        gitDirtyCount: git.dirtyCount,
        conversationPath: safeSnapshot.conversationPath,
        verified: safeSnapshot.verifiedSummary,
        nextAction: safeSnapshot.nextAction,
        source: 'account-relay'
      });
    }

    return { ok: true, snapshot: safeSnapshot, memoryEntry };
  }

  function switchAccount(targetId, { dryRun = false, saveSnapshot = true, allowUncapturedActive = false, autoCaptureUncaptured = false, handoff = {} } = {}) {
    const cleanTargetId = sanitizeAccountId(targetId);
    const state = loadState();
    assertEnabled(state);

    const target = state.accounts.find((a) => a.id === cleanTargetId);
    if (!target) {
      throw Object.assign(new Error(`目标账号槽位不存在: ${cleanTargetId}`), { code: 'ACCOUNT_NOT_FOUND' });
    }

    const releaseLock = acquireSwitchLock(cleanTargetId);
    try {
      const targetSaved = vault.inspectSaved(cleanTargetId);
      if (!targetSaved.exists) {
        throw Object.assign(new Error(`目标账号 (${target.email}) 在隔离凭据库中无备份，请先登录该账号并捕获`), {
          code: 'TARGET_CREDENTIAL_MISSING'
        });
      }
      if (targetSaved.email && targetSaved.email !== target.email) {
        throw Object.assign(
          new Error(`目标备份凭据邮箱 (${targetSaved.email}) 与元数据 (${target.email}) 不一致，已阻断切号`),
          { code: 'TARGET_EMAIL_MISMATCH' }
        );
      }

      const active = vault.inspectActive();
      if (active.exists && active.email && active.email === target.email) {
        state.activeAccountId = target.id;
        saveState(state);
        return {
          ok: true,
          alreadyActive: true,
          dryRun: Boolean(dryRun),
          target,
          message: `当前活跃账号已是 ${target.alias} (${target.email})，无需切换。`
        };
      }

      let backupOwner = null;
      let autoCapturePlan = null;
      if (active.exists) {
        if (active.email) {
          backupOwner = state.accounts.find((a) => a.email === active.email) || null;
          if (!backupOwner) {
            if (autoCaptureUncaptured) {
              const autoId = deriveAccountIdFromEmail(active.email);
              const localPart = active.email.split('@')[0] || '新号';
              autoCapturePlan = {
                id: autoId,
                email: active.email,
                alias: redactMemoryText(`自动备份 (${localPart.slice(0, 18)})`),
                role: 'backup',
                priority: state.accounts.length + 2,
                modelsSupported: [],
                credHash: active.hashPrefix || '',
                capturedAt: new Date().toISOString(),
                lastUsedAt: new Date().toISOString(),
                lastQuota: null
              };
            } else if (!allowUncapturedActive) {
              throw Object.assign(
                new Error(`检测到当前活跃账号 (${active.email}) 尚未捕获到隔离库；为防丢失登录态，请先点击「捕获当前账号」或显式允许跳过备份`),
                { code: 'UNCAPTURED_ACTIVE_ACCOUNT', activeEmail: active.email }
              );
            }
          }
        } else if (!allowUncapturedActive) {
          throw Object.assign(
            new Error('当前活跃凭据无法解析邮箱且未登记，为防丢失登录态已阻止直接覆盖'),
            { code: 'UNCAPTURED_ACTIVE_ACCOUNT' }
          );
        }
      }

      if (dryRun) {
        const backupLabel = backupOwner
          ? backupOwner.email
          : (autoCapturePlan ? `${autoCapturePlan.email}（自动建槽防丢）` : '(无/跳过)');
        return {
          ok: true,
          dryRun: true,
          restartRequired: true,
          wouldBackupTo: backupOwner
            ? { id: backupOwner.id, email: backupOwner.email, alias: backupOwner.alias }
            : (autoCapturePlan ? { id: autoCapturePlan.id, email: autoCapturePlan.email, alias: autoCapturePlan.alias, autoCapture: true } : null),
          wouldAutoCapture: autoCapturePlan ? { id: autoCapturePlan.id, email: autoCapturePlan.email, alias: autoCapturePlan.alias } : null,
          fromEmail: active.email || '',
          target,
          wouldSaveSnapshot: Boolean(saveSnapshot),
          message: `预演通过：将备份 ${backupLabel} 并切换活跃凭据至 ${target.email}（不碰 SQLite / brain / 会话）。`
        };
      }

      let snapshotRes = null;
      if (saveSnapshot) {
        snapshotRes = saveHandoffSnapshot({
          ...handoff,
          fromAccount: active.email || state.activeAccountId || '当前账号',
          toAccount: target.email
        });
        if (snapshotRes?.snapshot?.createdAt) {
          state.lastSnapshotAt = snapshotRes.snapshot.createdAt;
        }
      }

      // Phase 1 intent log BEFORE touching OS active credential slot
      const prepMs = Date.now();
      state.pendingSwitch = {
        targetId: target.id,
        targetEmail: target.email,
        phase: 'prepared',
        startedAt: new Date(prepMs).toISOString(),
        expiresAt: prepMs + PENDING_SWITCH_TTL_MS
      };
      saveState(state);

      let swapRes;
      const effectiveBackupId = backupOwner ? backupOwner.id : (autoCapturePlan ? autoCapturePlan.id : '');
      try {
        swapRes = vault.swapActiveFromSaved(cleanTargetId, {
          expectedTargetEmail: target.email,
          backupCurrentToId: effectiveBackupId
        });
      } catch (err) {
        if (autoCapturePlan) {
          try { vault.deleteSaved(autoCapturePlan.id); } catch {}
        }
        state.pendingSwitch = null;
        try { saveState(state); } catch {}
        throw err;
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let autoCapturedActive = null;
      if (autoCapturePlan && swapRes.backedUpTo === autoCapturePlan.id) {
        if (!state.accounts.some((a) => a.id === autoCapturePlan.id)) {
          autoCapturedActive = { ...autoCapturePlan, capturedAt: nowIso, lastUsedAt: nowIso };
          state.accounts.push(autoCapturedActive);
        }
      }
      state.activeAccountId = target.id;
      const tIdx = state.accounts.findIndex((a) => a.id === target.id);
      if (tIdx !== -1) {
        state.accounts[tIdx] = { ...state.accounts[tIdx], lastUsedAt: nowIso, credHash: swapRes.hashPrefix };
      }
      state.pendingSwitch = {
        targetId: target.id,
        targetEmail: target.email,
        phase: 'active-swapped',
        switchedAt: nowIso,
        switchedAtMs: nowMs,
        originPid: serverPid,
        originBootMs: serverBootMs,
        expiresAt: nowMs + PENDING_SWITCH_TTL_MS
      };
      saveState(state);
      // Persist latest UI preferences to disk seed before Antigravity restarts on a new random localhost port
      try { syncPrismPrefsSeed({ writeExtensionSeed: true }); } catch {}

      const autoBackupNote = autoCapturedActive
        ? `已先自动备份原未捕获账号 (${autoCapturedActive.email}) 防丢；`
        : '';
      return {
        ok: true,
        dryRun: false,
        restartRequired: true,
        fromEmail: active.email || '',
        backedUpTo: swapRes.backedUpTo,
        autoCapturedActive,
        target,
        snapshot: snapshotRes?.snapshot || null,
        memoryEntry: snapshotRes?.memoryEntry || null,
        externalMemoryPrompt: snapshotRes?.memoryEntry && handoffMemory
          ? handoffMemory.formatExternalMemoryStorePrompt(snapshotRes.memoryEntry)
          : '',
        resumePrompt: snapshotRes?.memoryEntry && handoffMemory
          ? handoffMemory.formatResumePrompt(snapshotRes.memoryEntry)
          : '',
        message: `${autoBackupNote}凭据已安全切换至 ${target.alias} (${target.email})；本地会话 SQLite 与 brain 记录 100% 未修改。请重载或重启 Antigravity 生效，重启后底部回跳条可一键返回原会话。`
      };
    } finally {
      releaseLock();
    }
  }

  function deleteAccount(accountId) {
    const cleanId = sanitizeAccountId(accountId);
    const releaseLock = acquireSwitchLock(`delete:${cleanId}`);
    try {
      const state = loadState();
      const idx = state.accounts.findIndex((a) => a.id === cleanId);
      if (idx === -1) {
        throw Object.assign(new Error(`未找到账号槽位: ${cleanId}`), { code: 'ACCOUNT_NOT_FOUND' });
      }
      const removed = state.accounts[idx];
      vault.deleteSaved(cleanId);
      state.accounts.splice(idx, 1);
      if (state.activeAccountId === cleanId) {
        state.activeAccountId = '';
      }
      if (state.pendingSwitch && state.pendingSwitch.targetId === cleanId) {
        state.pendingSwitch = null;
      }
      saveState(state);
      return {
        ok: true,
        removed,
        note: '仅移除隔离备份与元数据，当前活跃登录态、本地会话与 brain 记录均未改动。'
      };
    } finally {
      releaseLock();
    }
  }

  function verifyDataIntegrity() {
    const state = loadState();
    const vaultProbe = vault.probe();
    let brainSessionCount = 0;
    const brainExists = fs.existsSync(brainDir);
    if (brainExists) {
      try {
        brainSessionCount = fs.readdirSync(brainDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
      } catch {
        brainSessionCount = 0;
      }
    }
    let activeOk = false;
    let activeEmail = '';
    if (vaultProbe.supported) {
      try {
        const active = vault.inspectActive();
        activeOk = Boolean(active.exists);
        activeEmail = active.email || '';
      } catch {
        activeOk = false;
      }
    }
    return {
      ok: true,
      isolatedStateDir: stateDir,
      enabled: state.enabled,
      brainDir,
      brainExists,
      brainSessionCount,
      lockActive: fs.existsSync(lockFile),
      vaultBackend: vaultProbe.backend,
      vaultReady: vaultProbe.ok,
      activeCredentialPresent: activeOk,
      activeEmail,
      accountCount: state.accounts.length,
      guarantees: [
        '不读写 Antigravity 本地 SQLite 会话数据库',
        '不修改 ~/.gemini/antigravity/brain/ 对话与产物',
        '所有备份凭据仅存 OS 原生凭据库，零明文落盘'
      ]
    };
  }

  return {
    stateDir,
    getStatus,
    setEnabled,
    captureCurrentAccount,
    updateAccount,
    syncActiveAccountQuota,
    syncPrismPrefsSeed,
    pickRecommendedTarget,
    saveHandoffSnapshot,
    switchAccount,
    deleteAccount,
    verifyDataIntegrity
  };
}
