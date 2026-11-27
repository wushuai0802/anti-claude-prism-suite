#!/usr/bin/env node
/**
 * Anti-Claude — install.mjs
 * Standalone, zero-dependency CLI installer, CDP daemon manager, step-stream unlocker,
 * auto-updater, doctor & uninstaller (Node.js >= 22).
 *
 * Commands:
 *   node install.mjs install [--cli] [--cli-only] [--no-cli] [--no-cli-statusline] [--no-auto-update] [--no-step-unlock] [--no-agents-rule] [--overwrite-local]
 *   node install.mjs sync-upgrade [--force] [--overwrite-local]
 *   node install.mjs auto-update-on | auto-update-off
 *   node install.mjs doctor
 *   node install.mjs sync-fonts
 *   node install.mjs uninstall          Idempotent: a second run is a no-op
 *
 * Everything lives under ~/.gemini/antigravity/anti-claude/ (zero external git/runtime dependencies):
 *   user/                live config.json, custom.css, custom.js, i18n.override.json
 *   install-state.json   ownership of every file / setting this tool changed + sync timestamps
 *   backup/              pre-install originals of user/ files (when pre-existing)
 *   base/                last deployed template copies (3-way merge base, local-edit detection)
 *   incoming/            new template versions held back because the user edited the live file
 *
 * Legacy ~/.gemini/antigravity/theme-patch and com.antigravity.theme installations are migrated
 * and retired automatically during install / sync-upgrade.
 *
 * Exit codes: 0 = ok / partial (see "status"), 1 = failed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME = os.homedir();
const GEMINI_DIR = path.join(HOME, '.gemini');
const AGY_DIR = path.join(GEMINI_DIR, 'antigravity');
const AGY_STATE_PBTXT = path.join(AGY_DIR, 'antigravity_state.pbtxt');
const AGY_CONFIG_JSON = path.join(GEMINI_DIR, 'config', 'config.json');
const AGENTS_MD = path.join(GEMINI_DIR, 'AGENTS.md');
const AGY_CLI_DIR = path.join(GEMINI_DIR, 'antigravity-cli');
const AGY_CLI_SETTINGS_JSON = path.join(AGY_CLI_DIR, 'settings.json');
const AGY_CLI_STATUSLINE_NAME = 'anti-claude-statusline.mjs';
const AGY_CLI_STATUSLINE_FILE = path.join(AGY_CLI_DIR, AGY_CLI_STATUSLINE_NAME);

const STATE_DIR = path.join(AGY_DIR, 'anti-claude');
const USER_DIR = path.join(STATE_DIR, 'user');
const STATE_FILE = path.join(STATE_DIR, 'install-state.json');
const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
const PROJECTS_REGISTRY_FILE = path.join(STATE_DIR, 'projects-registry.json');
const UI_PREFS_FILE = path.join(STATE_DIR, 'ui-prefs.json');
const BACKUP_DIR = path.join(STATE_DIR, 'backup');
const BASE_DIR = path.join(STATE_DIR, 'base');
const INCOMING_DIR = path.join(STATE_DIR, 'incoming');
const LOCAL_SAVE_DIR = path.join(STATE_DIR, 'local-saves');
const SYNC_LOG_FILE = path.join(STATE_DIR, 'auto-sync.log');
const LAUNCHD_LOG_FILE = path.join(STATE_DIR, 'launchd.log');
const DAEMON_LOG_FILE = path.join(STATE_DIR, 'daemon.log');
const CORE_DAEMON_SCRIPT = path.join(__dirname, 'core', 'daemon.mjs');
const SIDECARS_DIR = path.join(GEMINI_DIR, 'config', 'sidecars');
const PROJECT_RULE_BEGIN = '<!-- BEGIN anti-claude-project -->';
const PROJECT_RULE_END = '<!-- END anti-claude-project -->';

/* Own LaunchAgent / background service identifiers */
const DAEMON_LABEL = 'com.antigravity.anti-claude.daemon';
const DAEMON_PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${DAEMON_LABEL}.plist`);
const AUTOSYNC_LABEL = 'com.antigravity.anti-claude.autosync';
const AUTOSYNC_PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${AUTOSYNC_LABEL}.plist`);

/* Legacy paths (v1, pre-rename claude-ux, and retired upstream theme-patch) — migrated & cleaned up automatically */
const LEGACY_V2_STATE_DIR = path.join(AGY_DIR, 'claude-ux');
const LEGACY_V2_STATE_FILE = path.join(LEGACY_V2_STATE_DIR, 'install-state.json');
const LEGACY_THEME_PATCH_DIR = path.join(AGY_DIR, 'theme-patch');
const LEGACY_THEME_USER_DIR = path.join(LEGACY_THEME_PATCH_DIR, 'user');
const LEGACY_BACKUP_DIR = path.join(LEGACY_THEME_USER_DIR, '.backup-before-claude-ux');
const LEGACY_SYNC_STATE_FILE = path.join(LEGACY_THEME_USER_DIR, '.claude-ux-sync-state.json');
const LEGACY_SYNC_LOG_FILE = path.join(LEGACY_THEME_USER_DIR, 'auto-sync.log');
const LEGACY_AUTOSYNC_LABEL = 'com.antigravity.claude-ux.autosync';
const LEGACY_AUTOSYNC_PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LEGACY_AUTOSYNC_LABEL}.plist`);
const LEGACY_THEME_DAEMON_LABEL = 'com.antigravity.theme';
const LEGACY_THEME_DAEMON_PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LEGACY_THEME_DAEMON_LABEL}.plist`);
const LEGACY_DAEMON_WRAPPER_FILE = path.join(AGY_DIR, 'scripts', 'antigravity-font-daemon.mjs');
const LEGACY_AG2_SYNC_SCRIPT = path.join(AGY_DIR, 'scripts', 'sync-antigravity-2.mjs');

const SELF_REPO = 'https://github.com/hongqi7/Anti-Claude.git';
const RULE_BEGIN = '<!-- BEGIN anti-claude -->';
const RULE_END = '<!-- END anti-claude -->';
const LEGACY_RULE_BEGIN = '<!-- BEGIN antigravity-claude-ux -->';
const LEGACY_RULE_END = '<!-- END antigravity-claude-ux -->';
const LEGACY_HEADING = '## 执行过程同步（Claude 式边做边汇报）';
const USER_LAYER_FILES = ['config.json', 'custom.css', 'custom.js', 'i18n.override.json'];
const STUB_CONTENT = { 'custom.css': '/* user/custom.css */\n', 'custom.js': '/* user/custom.js */\n' };

const REMOTE_CHECK_INTERVAL_MS = 11 * 3600 * 1000; // < launchd StartInterval (12h)
const NO_NETWORK = process.env.ANTI_CLAUDE_NO_NETWORK === '1' || process.env.CLAUDE_UX_NO_NETWORK === '1';
const NO_LAUNCHD = process.env.ANTI_CLAUDE_NO_LAUNCHD === '1' || process.env.CLAUDE_UX_NO_LAUNCHD === '1';
const NO_CDP = process.env.ANTI_CLAUDE_NO_CDP === '1' || process.env.CLAUDE_UX_NO_CDP === '1';
const NO_FONTS = process.env.ANTI_CLAUDE_NO_FONTS === '1' || process.env.CLAUDE_UX_NO_FONTS === '1';
const NO_CLI = process.env.ANTI_CLAUDE_NO_CLI === '1' || process.env.CLAUDE_UX_NO_CLI === '1';
const CDP_TIMEOUT_MS = Number(process.env.ANTI_CLAUDE_CDP_TIMEOUT_MS || process.env.CLAUDE_UX_CDP_TIMEOUT_MS) || 5000;
const STATE_SCHEMA = 2;

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function readJsonSafe(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return arguments.length >= 2 ? fallback : null;
  }
}

export function buildNodeExecEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (
    Boolean(process.versions && process.versions.electron) ||
    process.env.ELECTRON_RUN_AS_NODE === '1' ||
    baseEnv?.ELECTRON_RUN_AS_NODE === '1'
  ) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  return env;
}

function shouldRunAsElectronNode(nodePath = process.execPath, env = process.env) {
  return (
    Boolean(process.versions && process.versions.electron) ||
    env?.ELECTRON_RUN_AS_NODE === '1' ||
    /(?:^|[\\/])(?:antigravity|electron)(?:\.exe)?$/i.test(String(nodePath || '').trim())
  );
}

function readProcessCommandLineSync(pid) {
  const numPid = Number(pid);
  if (!Number.isInteger(numPid) || numPid <= 0) return '';
  if (process.platform === 'linux') {
    try {
      const raw = fs.readFileSync(`/proc/${numPid}/cmdline`, 'utf8');
      if (raw) return raw.replace(/\0+/g, ' ').trim();
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      return execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${numPid}").CommandLine`],
        { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
    } catch {
      return '';
    }
  }
  try {
    return execFileSync('ps', ['-ww', '-p', String(numPid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

export function isMatchingDaemonPid(pid, pattern = /(?:^|[\\/ "'])daemon\.mjs(?:\s|$|["'])|anti-claude[\\/]+core[\\/]+daemon\.mjs/i, { commandReader = readProcessCommandLineSync, killProbe = process.kill } = {}) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0 || num === process.pid) return false;
  try {
    killProbe(num, 0);
  } catch {
    return false;
  }
  const cmd = String(commandReader(num) || '');
  return Boolean(cmd && pattern.test(cmd));
}

function resolveAtomicWriteTarget(p) {
  try {
    const lst = fs.lstatSync(p);
    if (lst.isSymbolicLink()) {
      try {
        return fs.realpathSync(p);
      } catch {
        return path.resolve(path.dirname(p), fs.readlinkSync(p));
      }
    }
  } catch {}
  return p;
}

function writeFileAtomic(p, content) {
  const target = resolveAtomicWriteTarget(p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let prevMode = null;
  try {
    const st = fs.statSync(target, { throwIfNoEntry: false });
    if (st && st.isFile()) prevMode = st.mode & 0o777;
  } catch {}
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, content, prevMode !== null ? { encoding: 'utf8', mode: prevMode } : 'utf8');
    if (prevMode !== null) {
      try {
        fs.chmodSync(tmp, prevMode);
      } catch {}
    }
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

function writeJsonAtomic(p, obj) {
  writeFileAtomic(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function sha256Text(t) {
  return t === null || t === undefined ? '' : crypto.createHash('sha256').update(t).digest('hex');
}

function sha256File(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch {
    return '';
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * 3-way JSON merge: base = template we deployed last time, local = live file, remote = new template.
 * User changes (local vs base) always win; template changes the user did not touch are applied.
 */
export function threeWayMergeJson(base, local, remote) {
  if (deepEqual(local, base)) return clone(remote);
  if (deepEqual(remote, base)) return clone(local);
  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(remote)) return clone(local);
  const out = {};
  const keys = [...new Set([...Object.keys(remote), ...Object.keys(local)])];
  for (const k of keys) {
    const inB = Object.prototype.hasOwnProperty.call(base, k);
    const inL = Object.prototype.hasOwnProperty.call(local, k);
    const inR = Object.prototype.hasOwnProperty.call(remote, k);
    if (inB && !inL) continue;
    if (inB && !inR) {
      if (inL && !deepEqual(local[k], base[k])) out[k] = clone(local[k]);
      continue;
    }
    if (!inB) {
      if (inL && inR) out[k] = threeWayMergeJson({}, local[k], remote[k]);
      else out[k] = clone(inL ? local[k] : remote[k]);
      continue;
    }
    out[k] = threeWayMergeJson(base[k], local[k], remote[k]);
  }
  return out;
}

/** Parse the last top-level JSON object printed to stdout. */
export function parseTrailingJson(text) {
  if (!text) return null;
  const s = String(text);
  const starts = [];
  if (s.startsWith('{')) starts.push(0);
  for (let i = s.indexOf('\n{'); i !== -1; i = s.indexOf('\n{', i + 1)) starts.push(i + 1);
  for (let j = starts.length - 1; j >= 0; j--) {
    try {
      return JSON.parse(s.slice(starts[j]).trim());
    } catch {}
  }
  return null;
}

export function compareSemver(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export function shouldCheckRemote(sync, { now = Date.now(), force = false, appChanged = false } = {}) {
  if (force || appChanged) return true;
  const last = Number(sync && sync.lastRemoteCheckAt) || 0;
  return now - last >= REMOTE_CHECK_INTERVAL_MS;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function appendSyncLog(msg) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const line = `[${new Date().toISOString()}] ${msg}`;
    const prev = readTextSafe(SYNC_LOG_FILE);
    const lines = prev ? prev.trim().split('\n').slice(-199) : [];
    lines.push(line);
    writeFileAtomic(SYNC_LOG_FILE, `${lines.join('\n')}\n`);
  } catch {}
}

function removeDirIfEmpty(dirPath) {
  try {
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {}
}

function finalize(report, { critical = [], warnings = [] } = {}) {
  const status = critical.length ? 'failed' : warnings.length ? 'partial' : 'ok';
  const out = Object.assign({ ok: status === 'ok', status }, report);
  if (critical.length) out.errors = critical;
  if (warnings.length) out.warnings = warnings;
  console.log(JSON.stringify(out, null, 2));
  if (status === 'failed') process.exitCode = 1;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Environment probes                                                         */
/* -------------------------------------------------------------------------- */

function getAntigravityAppFingerprint() {
  if (process.platform === 'darwin') {
    const plist = '/Applications/Antigravity.app/Contents/Info.plist';
    const asar = '/Applications/Antigravity.app/Contents/Resources/app.asar';
    let version = 'unknown';
    try {
      version = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {}
    let asarSig = 'missing';
    let changedAtMs = 0;
    try {
      const st = fs.statSync(asar);
      changedAtMs = Math.max(st.mtimeMs, st.ctimeMs);
      asarSig = `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch {}
    return { version, asarSig, changedAtMs, sig: `${version}|${asarSig}` };
  }
  return { version: 'unknown', asarSig: 'unknown', changedAtMs: 0, sig: process.platform };
}

function getDevToolsPortFile() {
  if (process.platform === 'darwin') {
    return path.join(HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    return path.join(appData, 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(HOME, '.config', 'Antigravity', 'DevToolsActivePort');
}

function getUserFontsDir() {
  if (process.platform === 'darwin') return path.join(HOME, 'Library', 'Fonts');
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    return path.join(localAppData, 'Microsoft', 'Windows', 'Fonts');
  }
  return path.join(HOME, '.local', 'share', 'fonts');
}

function checkFontsInstalled() {
  const dir = getUserFontsDir();
  try {
    const files = fs.readdirSync(dir);
    return {
      dir,
      hasAnthropicSans: files.some((f) => /AnthropicSans/i.test(f)),
      hasAnthropicSerif: files.some((f) => /AnthropicSerif/i.test(f))
    };
  } catch {
    return { dir, hasAnthropicSans: false, hasAnthropicSerif: false };
  }
}

function syncFontsFromLocalClaudeApp(state = null) {
  if (process.platform !== 'darwin') return { synced: false, reason: 'not_macos' };
  const claudeFontsDir = '/Applications/Claude.app/Contents/Resources/fonts';
  if (!fs.existsSync(claudeFontsDir)) return { synced: false, reason: 'claude_app_not_installed' };
  const destDir = getUserFontsDir();
  fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const name of fs.readdirSync(claudeFontsDir)) {
    if (/^Anthropic.*\.(ttf|otf)$/i.test(name)) {
      const dst = path.join(destDir, name);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(path.join(claudeFontsDir, name), dst);
        copied.push(name);
      }
    }
  }
  if (state && copied.length > 0) {
    const prev = Array.isArray(state.fontsCopied) ? state.fontsCopied : [];
    state.fontsCopied = Array.from(new Set([...prev, ...copied]));
  }
  return { synced: true, copied, note: 'Fonts are copied from your own local Claude.app for personal use only.' };
}

function findAgyCliBinary() {
  if (NO_CLI) return null;
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(cmd, ['agy'], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch {}
  const fallbacks =
    process.platform === 'win32'
      ? [path.join(HOME, '.gemini', 'bin', 'agy.exe'), path.join(HOME, '.local', 'bin', 'agy.exe')]
      : [path.join(HOME, '.gemini', 'bin', 'agy'), path.join(HOME, '.local', 'bin', 'agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy'];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function detectAntigravityCli() {
  const configDirExists = fs.existsSync(AGY_CLI_DIR);
  const settingsExists = fs.existsSync(AGY_CLI_SETTINGS_JSON);
  const binary = findAgyCliBinary();
  let version = null;
  if (binary) {
    try {
      version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch {}
  }
  const settings = settingsExists ? readJsonSafe(AGY_CLI_SETTINGS_JSON, null) : null;
  const statusLineInstalled = fs.existsSync(AGY_CLI_STATUSLINE_FILE);
  const statusLineEnabled = Boolean(
    settings?.statusLine?.enabled === true &&
      String(settings?.statusLine?.command || '').includes(AGY_CLI_STATUSLINE_NAME)
  );
  return {
    detected: Boolean(binary || configDirExists),
    binary,
    version,
    configDir: AGY_CLI_DIR,
    configDirExists,
    settingsExists,
    statusLineInstalled,
    statusLineEnabled
  };
}

/** Prefer a version-independent node path so `brew upgrade node` does not break LaunchAgents. */
export function stableNodePath(execPath = process.execPath) {
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node'];
  let realExec = execPath;
  try {
    realExec = fs.realpathSync(execPath);
  } catch {}
  for (const c of candidates) {
    try {
      if (fs.realpathSync(c) === realExec) return c;
    } catch {}
  }
  if (/\/Cellar\/node(@[\d.]+)?\//.test(execPath)) {
    for (const c of candidates) if (fs.existsSync(c)) return c;
  }
  return execPath;
}

/* -------------------------------------------------------------------------- */
/* State (ownership manifest) & Legacy Migration                              */
/* -------------------------------------------------------------------------- */

function newState() {
  return {
    schema: STATE_SCHEMA,
    installedAt: Date.now(),
    repoUrl: SELF_REPO,
    options: { desktop: true, cli: false, cliStatusLine: true, stepUnlock: true, agentsRule: true, autoUpdate: true },
    files: {},
    cli: {},
    settings: {},
    agentsRule: { inserted: false },
    sync: {}
  };
}

function migrateLegacyState() {
  const hasLegacyBackup = fs.existsSync(LEGACY_BACKUP_DIR);
  const legacySync = readJsonSafe(LEGACY_SYNC_STATE_FILE, null);
  if (!hasLegacyBackup && !legacySync) return null;
  const state = newState();
  state.migratedFrom = 'v1';
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(USER_DIR, { recursive: true });
  for (const f of USER_LAYER_FILES) {
    const legacyBak = path.join(LEGACY_BACKUP_DIR, f);
    const live = path.join(LEGACY_THEME_USER_DIR, f);
    const hasBak = hasLegacyBackup && fs.existsSync(legacyBak);
    if (hasBak) fs.copyFileSync(legacyBak, path.join(BACKUP_DIR, f));
    if (fs.existsSync(live)) {
      const liveText = readTextSafe(live);
      const srcText = readTextSafe(path.join(__dirname, 'user', f));
      fs.copyFileSync(live, path.join(USER_DIR, f));
      /* Only establish a base snapshot when the v1 file matches a verifiable template/stub;
         otherwise leave base unset so modified v1 CSS/JS is preserved and new template is saved to incoming/ */
      if (liveText !== null && srcText !== null && liveText === srcText) {
        writeFileAtomic(path.join(BASE_DIR, f), srcText);
        state.files[f] = { existedBefore: false, deployedSha: sha256Text(srcText) };
      } else if (liveText !== null && STUB_CONTENT[f] && liveText === STUB_CONTENT[f]) {
        writeFileAtomic(path.join(BASE_DIR, f), STUB_CONTENT[f]);
        state.files[f] = { existedBefore: false, deployedSha: sha256Text(STUB_CONTENT[f]) };
      } else if (f.endsWith('.json')) {
        const emptyJson = '{}\n';
        writeFileAtomic(path.join(BASE_DIR, f), emptyJson);
        state.files[f] = { existedBefore: false, deployedSha: sha256Text(emptyJson) };
      } else {
        state.files[f] = { existedBefore: false, deployedSha: '' };
      }
    }
  }
  state.settings = { legacyUnknown: true };
  if (legacySync) {
    state.installedAt = Number(legacySync.lastSyncAt) || state.installedAt;
    state.sync = {
      appVersion: legacySync.appVersion,
      appSig: legacySync.appSig,
      lastAppliedAt: legacySync.lastSyncAt,
      lastRemoteCheckAt: 0
    };
  }
  const agentsRaw = readTextSafe(AGENTS_MD) || '';
  state.agentsRule.inserted = agentsRaw.includes(RULE_BEGIN) || agentsRaw.includes(LEGACY_RULE_BEGIN);
  state.options.autoUpdate = fs.existsSync(AUTOSYNC_PLIST) || fs.existsSync(LEGACY_AUTOSYNC_PLIST);
  saveState(state);
  fs.rmSync(LEGACY_BACKUP_DIR, { recursive: true, force: true });
  fs.rmSync(LEGACY_SYNC_STATE_FILE, { force: true });
  return state;
}

function migrateLegacyV2State() {
  const legacyState = readJsonSafe(LEGACY_V2_STATE_FILE, null);
  if (!legacyState || legacyState.schema !== STATE_SCHEMA) return null;
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(path.dirname(STATE_DIR), { recursive: true });
    try {
      fs.renameSync(LEGACY_V2_STATE_DIR, STATE_DIR);
    } catch {
      fs.cpSync(LEGACY_V2_STATE_DIR, STATE_DIR, { recursive: true });
      fs.rmSync(LEGACY_V2_STATE_DIR, { recursive: true, force: true });
    }
  } else {
    fs.cpSync(LEGACY_V2_STATE_DIR, STATE_DIR, { recursive: true, force: false });
    fs.rmSync(LEGACY_V2_STATE_DIR, { recursive: true, force: true });
  }
  legacyState.migratedFrom = legacyState.migratedFrom || 'claude-ux';
  legacyState.repoUrl = SELF_REPO;
  saveState(legacyState);
  return legacyState;
}

/**
 * Migrate live user customizations from legacy `~/.gemini/antigravity/theme-patch/user/`
 * into `~/.gemini/antigravity/anti-claude/user/`, preserve a recoverable backup whenever
 * retiring an independent `theme-patch` install or unmigrated custom files, then retire
 * the external `theme-patch` daemon, wrapper scripts, and directory.
 */
function retireLegacyThemePatch(state) {
  const out = { migratedFiles: [], retiredDaemon: false, removedDir: false, backupDir: null };
  const hadLegacyPatchDir = fs.existsSync(LEGACY_THEME_PATCH_DIR);
  const hadLegacyUserDir = fs.existsSync(LEGACY_THEME_USER_DIR);
  const hadExistingState = Boolean(state && Object.keys(state.files || {}).length > 0);
  const isKnownAntiClaudeLegacy = Boolean(
    hadExistingState ||
      state?.migratedFrom ||
      fs.existsSync(LEGACY_DAEMON_WRAPPER_FILE) ||
      fs.existsSync(LEGACY_SYNC_STATE_FILE) ||
      fs.existsSync(LEGACY_BACKUP_DIR)
  );

  let hasUnmigratedContent = !isKnownAntiClaudeLegacy && hadLegacyPatchDir;
  let copyVerified = true;

  if (hadLegacyUserDir) {
    fs.mkdirSync(USER_DIR, { recursive: true });
    for (const f of USER_LAYER_FILES) {
      const legacyLive = path.join(LEGACY_THEME_USER_DIR, f);
      const newLive = path.join(USER_DIR, f);
      if (fs.existsSync(legacyLive)) {
        if (!fs.existsSync(newLive)) {
          fs.copyFileSync(legacyLive, newLive);
          if (sha256File(newLive) !== sha256File(legacyLive)) {
            copyVerified = false;
          } else {
            out.migratedFiles.push(f);
          }
        } else if (sha256File(newLive) !== sha256File(legacyLive)) {
          hasUnmigratedContent = true;
        }
      }
      /* Legacy backups from Anti-Claude <= v2.3.9 were stock upstream theme-patch files;
         for standalone theme-patch (!isKnownAntiClaudeLegacy), installUserLayer backs up newLive into BACKUP_DIR */
      if (isKnownAntiClaudeLegacy && state?.files?.[f] && !state.retiredThemePatch) {
        state.files[f].existedBefore = false;
        fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
      }
    }

    const ignoredLegacyUserNames = new Set([
      ...USER_LAYER_FILES,
      '.DS_Store',
      '.backup-before-claude-ux',
      '.claude-ux-sync-state.json',
      'auto-sync.log'
    ]);
    try {
      for (const name of fs.readdirSync(LEGACY_THEME_USER_DIR)) {
        if (!ignoredLegacyUserNames.has(name)) {
          hasUnmigratedContent = true;
          break;
        }
      }
    } catch {}
    if (state) state.retiredThemePatch = true;
  }

  /* Stop legacy com.antigravity.theme LaunchAgent / Windows VBS / PID if present */
  if (process.platform === 'darwin' && fs.existsSync(LEGACY_THEME_DAEMON_PLIST)) {
    if (!NO_LAUNCHD) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
      try {
        execFileSync('launchctl', ['bootout', `gui/${uid}`, LEGACY_THEME_DAEMON_PLIST], { stdio: 'ignore' });
      } catch {}
    }
    fs.rmSync(LEGACY_THEME_DAEMON_PLIST, { force: true });
    out.retiredDaemon = true;
  } else if (process.platform === 'win32' && !NO_LAUNCHD) {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    const legacyVbs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AntigravityThemeDaemon.vbs');
    if (fs.existsSync(legacyVbs)) {
      fs.rmSync(legacyVbs, { force: true });
      out.retiredDaemon = true;
    }
  }

  const legacyPidFile = path.join(AGY_DIR, 'theme-daemon.pid');
  if (fs.existsSync(legacyPidFile)) {
    const pid = parseInt(readTextSafe(legacyPidFile) || '0', 10);
    if (
      pid > 0 &&
      !NO_LAUNCHD &&
      isMatchingDaemonPid(pid, /theme-patch|antigravity-font-daemon|theme.*daemon/i)
    ) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(legacyPidFile, { force: true });
    out.retiredDaemon = true;
  }

  for (const oldScript of [LEGACY_DAEMON_WRAPPER_FILE, LEGACY_AG2_SYNC_SCRIPT]) {
    if (fs.existsSync(oldScript)) {
      fs.rmSync(oldScript, { force: true });
    }
  }
  removeDirIfEmpty(path.join(AGY_DIR, 'scripts'));

  if (hadLegacyPatchDir && copyVerified) {
    if (hasUnmigratedContent) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveDir = path.join(AGY_DIR, `theme-patch-backup-${ts}`);
      fs.cpSync(LEGACY_THEME_PATCH_DIR, archiveDir, { recursive: true });
      if (!fs.existsSync(archiveDir)) {
        return out;
      }
      out.backupDir = archiveDir;
    }
    fs.rmSync(LEGACY_THEME_PATCH_DIR, { recursive: true, force: true });
    out.removedDir = true;
  }
  return out;
}

function recoverStateFromDisk() {
  const hasBase = fs.existsSync(BASE_DIR);
  const hasBackup = fs.existsSync(BACKUP_DIR);
  if (!hasBase && !hasBackup) return null;
  const recovered = newState();
  let foundAny = false;
  for (const f of USER_LAYER_FILES) {
    const baseFile = path.join(BASE_DIR, f);
    const bakFile = path.join(BACKUP_DIR, f);
    const hasBaseFile = fs.existsSync(baseFile);
    const hasBakFile = fs.existsSync(bakFile);
    if (!hasBaseFile && !hasBakFile) continue;
    foundAny = true;
    recovered.files[f] = {
      existedBefore: hasBakFile,
      deployedSha: hasBaseFile ? sha256File(baseFile) : ''
    };
  }
  const cliBase = path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME);
  const cliBak = path.join(BACKUP_DIR, AGY_CLI_STATUSLINE_NAME);
  if (fs.existsSync(cliBase) || fs.existsSync(cliBak)) {
    foundAny = true;
    recovered.cli.statusLineScript = {
      existedBefore: fs.existsSync(cliBak),
      deployedSha: fs.existsSync(cliBase) ? sha256File(cliBase) : ''
    };
  }
  return foundAny ? recovered : null;
}

function loadState() {
  const raw = readTextSafe(STATE_FILE);
  if (raw !== null) {
    const st = readJsonSafe(STATE_FILE, null);
    if (st && st.schema === STATE_SCHEMA) return st;
    /* Preserve corrupt or incompatible state file instead of silently treating as fresh install */
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(STATE_DIR, `install-state.corrupt-${ts}.json`), raw, 'utf8');
    } catch {}
    return migrateLegacyV2State() || migrateLegacyState() || recoverStateFromDisk();
  }
  return migrateLegacyV2State() || migrateLegacyState();
}

function saveState(state) {
  writeJsonAtomic(STATE_FILE, state);
}

/* -------------------------------------------------------------------------- */
/* Source validation & git self-pull                                          */
/* -------------------------------------------------------------------------- */

const JSON_INVALID = Symbol('json_invalid');

export function validateSourceRoot(root = __dirname) {
  const problems = [];
  for (const rel of ['install.mjs', 'core/daemon.mjs', 'core/runtime.js', 'user/custom.js', 'cli/statusline.mjs']) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      problems.push(`${rel}: missing`);
      continue;
    }
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe', windowsHide: true, env: buildNodeExecEnv() });
    } catch (err) {
      problems.push(`${rel}: ${String(err.stderr || err.message).split('\n')[0]}`);
    }
  }
  for (const rel of ['core/i18n.json', 'user/config.json', 'user/i18n.override.json']) {
    const parsed = readJsonSafe(path.join(root, rel), JSON_INVALID);
    if (parsed === JSON_INVALID || !isPlainObject(parsed)) {
      problems.push(`${rel}: invalid or missing JSON object`);
    }
  }
  if (!fs.existsSync(path.join(root, 'core', 'base.css'))) problems.push('core/base.css missing');
  if (!fs.existsSync(path.join(root, 'rules', 'claude-execution-sync.md'))) problems.push('rules/claude-execution-sync.md missing');
  return { ok: problems.length === 0, problems };
}

function pullSelfRepoIfGit() {
  if (!fs.existsSync(path.join(__dirname, '.git'))) return { pulled: false, reason: 'not_git_checkout' };
  try {
    const headShort = () => execFileSync('git', ['-C', __dirname, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    const headFull = () => execFileSync('git', ['-C', __dirname, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    const beforeHead = headShort();
    const beforeFullHead = headFull();
    execFileSync('git', ['-C', __dirname, 'pull', '--ff-only', '--quiet'], { stdio: 'pipe', timeout: 20000, windowsHide: true });
    const afterHead = headShort();
    return { pulled: true, updated: beforeHead !== afterHead, beforeHead, beforeFullHead, afterHead };
  } catch (err) {
    return { pulled: false, error: String(err?.stderr || err?.message || err).split('\n')[0] };
  }
}

function rollbackSelfRepo(targetSha) {
  if (!targetSha || !/^[0-9a-f]{7,40}$/i.test(targetSha)) return false;
  try {
    execFileSync('git', ['-C', __dirname, 'reset', '--hard', targetSha], { stdio: 'pipe', timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Live CDP (with per-request deadline and close/error handling)              */
/* -------------------------------------------------------------------------- */

function rankCdpPageTarget(t) {
  const url = String(t?.url || '');
  const title = String(t?.title || '');
  if (url.startsWith('vscode-file://')) return 0;
  if (/Antigravity/i.test(title) || /workbench|jetski/i.test(url)) return 1;
  if (url.includes('127.0.0.1:')) return 2;
  if (url.includes('localhost:')) return 3;
  return 9;
}

export async function withCdpPage(fn, { timeoutMs = CDP_TIMEOUT_MS } = {}) {
  if (NO_CDP) return { ok: false, reason: 'cdp_disabled', appRunning: false };
  const raw = readTextSafe(getDevToolsPortFile());
  if (!raw) return { ok: false, reason: 'app_not_running', appRunning: false };
  const [port] = raw.trim().split(/\r?\n/);
  if (!port) return { ok: false, reason: 'empty_port' };

  let candidates = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    const list = await res.json();
    candidates = (Array.isArray(list) ? list : [])
      .filter(
        (x) =>
          x &&
          x.type === 'page' &&
          x.webSocketDebuggerUrl &&
          !String(x.url || '').startsWith('devtools://') &&
          !String(x.title || '').includes('Launchpad') &&
          rankCdpPageTarget(x) < 9
      )
      .sort((a, b) => rankCdpPageTarget(a) - rankCdpPageTarget(b));
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
  if (!candidates.length) return { ok: false, reason: 'main_page_not_found' };

  let lastResult = { ok: false, reason: 'main_page_not_found' };
  for (let idx = 0; idx < candidates.length; idx++) {
    const target = candidates[idx];
    let ws;
    try {
      ws = new WebSocket(target.webSocketDebuggerUrl);
      const pending = new Map();
      let closedReason = null;
      const failAll = (reason) => {
        closedReason = closedReason || reason;
        for (const [, p] of pending) p.reject(new Error(reason));
        pending.clear();
      };
      ws.addEventListener('message', (ev) => {
        let d;
        try {
          d = JSON.parse(ev.data);
        } catch {
          return;
        }
        const p = pending.get(d.id);
        if (p) {
          pending.delete(d.id);
          p.resolve(d);
        }
      });
      ws.addEventListener('close', () => failAll('ws_closed'));
      ws.addEventListener('error', () => failAll('ws_error'));

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ws_open_timeout')), 2500);
        ws.addEventListener('open', () => (clearTimeout(t), resolve()), { once: true });
        ws.addEventListener('close', () => (clearTimeout(t), reject(new Error('ws_closed'))), { once: true });
        ws.addEventListener('error', () => (clearTimeout(t), reject(new Error('ws_error'))), { once: true });
      });

      let nextId = 1;
      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          if (closedReason) return reject(new Error(closedReason));
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error('cdp_timeout'));
          }, timeoutMs);
          pending.set(id, {
            resolve: (v) => (clearTimeout(timer), resolve(v)),
            reject: (e) => (clearTimeout(timer), reject(e))
          });
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch (err) {
            pending.delete(id);
            clearTimeout(timer);
            reject(err);
          }
        });
      lastResult = await fn(send);
      if (lastResult?.ok || lastResult?.reason !== 'pref_store_not_found' || idx === candidates.length - 1) {
        return lastResult;
      }
    } catch (err) {
      lastResult = { ok: false, reason: String(err?.message || err) };
      if (idx === candidates.length - 1) return lastResult;
    } finally {
      try {
        ws?.close();
      } catch {}
    }
  }
  return lastResult;
}

/** Read (and optionally set) Antigravity preference values through the live React pref store. */
export async function cdpPrefs(setMap) {
  const keys = ['project4kMode', 'verboseConversationSteps'];
  const pageFn = async function (keys, setMap) {
    let prefStore = null;
    for (const el of document.querySelectorAll('#root *')) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      if (!key) continue;
      for (let f = el[key]; f && !prefStore; f = f.return) {
        for (let d = f.dependencies?.firstContext; d; d = d.next) {
          const v = d.memoizedValue;
          if (v && typeof v.getState === 'function') {
            const st = v.getState();
            if (st && typeof st.setPrefValue === 'function' && typeof st.getPrefValue === 'function') {
              prefStore = v;
              break;
            }
          }
        }
      }
      if (prefStore) break;
    }
    if (!prefStore) return { found: false };
    const read = () => Object.fromEntries(keys.map((k) => [k, prefStore.getState().getPrefValue(k)]));
    const before = read();
    if (setMap) {
      for (const [k, v] of Object.entries(setMap)) await prefStore.getState().setPrefValue(k, v);
    }
    return { found: true, before, after: read() };
  };
  return withCdpPage(async (send) => {
    const r = await send('Runtime.evaluate', {
      expression: `(${pageFn.toString()})(${JSON.stringify(keys)}, ${JSON.stringify(setMap || null)})`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.error) return { ok: false, reason: `cdp_error: ${r.error.message || JSON.stringify(r.error)}` };
    if (r.result?.exceptionDetails) {
      const ex = r.result.exceptionDetails;
      return { ok: false, reason: `eval_exception: ${ex.exception?.description || ex.text || 'unknown'}` };
    }
    const v = r.result?.result?.value;
    if (!v || !v.found) return { ok: false, reason: 'pref_store_not_found' };
    const applied = !setMap || Object.entries(setMap).every(([k, val]) => v.after[k] === val);
    return { ok: applied, reason: applied ? undefined : 'pref_not_applied', before: v.before, after: v.after };
  });
}

/* -------------------------------------------------------------------------- */
/* Step-stream settings (recorded for rollback)                               */
/* -------------------------------------------------------------------------- */

async function applyStepUnlock(state) {
  const settings = (state.settings = state.settings || {});
  const live = await cdpPrefs({ project4kMode: 1, verboseConversationSteps: true });
  if (live.before && !settings.live) settings.live = { captured: true, before: live.before };

  const actions = [];
  if (fs.existsSync(AGY_STATE_PBTXT)) {
    const content = fs.readFileSync(AGY_STATE_PBTXT, 'utf8');
    if (/product_skin:\s*PRODUCT_SKIN_NON_TECHNICAL/.test(content)) {
      writeFileAtomic(AGY_STATE_PBTXT, content.replace(/product_skin:\s*PRODUCT_SKIN_NON_TECHNICAL/g, 'product_skin: PRODUCT_SKIN_DEVELOPER'));
      settings.pbtxt = { changed: true, before: 'PRODUCT_SKIN_NON_TECHNICAL' };
      actions.push('pbtxt_developer_skin');
    } else if (!settings.pbtxt) {
      settings.pbtxt = { changed: false };
    }
  }
  if (fs.existsSync(AGY_CONFIG_JSON)) {
    const cfg = readJsonSafe(AGY_CONFIG_JSON, null);
    if (cfg) {
      cfg.userSettings = cfg.userSettings || {};
      if (cfg.userSettings.verboseConversationSteps !== true) {
        if (!settings.verbose?.changed) {
          settings.verbose = {
            changed: true,
            hadKey: Object.prototype.hasOwnProperty.call(cfg.userSettings, 'verboseConversationSteps'),
            before: cfg.userSettings.verboseConversationSteps
          };
        }
        cfg.userSettings.verboseConversationSteps = true;
        writeJsonAtomic(AGY_CONFIG_JSON, cfg);
        actions.push('config_json_verbose_steps');
      } else if (!settings.verbose) {
        settings.verbose = { changed: false };
      }
    }
  }
  return { live, fileActions: actions };
}

async function revertStepUnlock(state) {
  const settings = state.settings || {};
  const out = { live: null, files: [] };
  const recorded = Boolean(settings.live?.captured || settings.pbtxt?.changed || settings.verbose?.changed);
  if (settings.legacyUnknown && !recorded) {
    out.note = 'installed by v1, previous settings unknown: step settings left as-is';
    return out;
  }
  const liveBefore = settings.live?.captured ? settings.live.before : null;
  const restoreLive = {};
  if (liveBefore) {
    for (const [k, v] of Object.entries(liveBefore)) {
      if (v !== undefined && v !== null) restoreLive[k] = v;
    }
  }
  if (Object.keys(restoreLive).length) out.live = await cdpPrefs(restoreLive);

  if (settings.pbtxt?.changed && fs.existsSync(AGY_STATE_PBTXT)) {
    const content = fs.readFileSync(AGY_STATE_PBTXT, 'utf8');
    if (/product_skin:\s*PRODUCT_SKIN_DEVELOPER/.test(content)) {
      writeFileAtomic(AGY_STATE_PBTXT, content.replace(/product_skin:\s*PRODUCT_SKIN_DEVELOPER/g, `product_skin: ${settings.pbtxt.before}`));
      out.files.push('pbtxt_restored');
    }
  }
  if (settings.verbose?.changed && fs.existsSync(AGY_CONFIG_JSON)) {
    const cfg = readJsonSafe(AGY_CONFIG_JSON, null);
    if (cfg?.userSettings && cfg.userSettings.verboseConversationSteps === true) {
      if (settings.verbose.hadKey) cfg.userSettings.verboseConversationSteps = settings.verbose.before;
      else delete cfg.userSettings.verboseConversationSteps;
      writeJsonAtomic(AGY_CONFIG_JSON, cfg);
      out.files.push('verbose_restored');
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* AGENTS.md rule                                                             */
/* -------------------------------------------------------------------------- */

function findMarkedRuleSpan(text) {
  for (const [bTag, eTag] of [
    [RULE_BEGIN, RULE_END],
    [LEGACY_RULE_BEGIN, LEGACY_RULE_END]
  ]) {
    const begin = text.indexOf(bTag);
    const end = begin !== -1 ? text.indexOf(eTag, begin) : -1;
    if (begin !== -1 && end > begin) return { begin, end: end + eTag.length };
  }
  return null;
}

function injectAgentsMdRule(state, { allowInsert }) {
  const ruleBlock = fs.readFileSync(path.join(__dirname, 'rules', 'claude-execution-sync.md'), 'utf8').trim();
  const existing = readTextSafe(AGENTS_MD) || '';
  const span = findMarkedRuleSpan(existing);
  if (span) {
    const next = existing.slice(0, span.begin) + ruleBlock + existing.slice(span.end);
    if (next !== existing) writeFileAtomic(AGENTS_MD, next);
    return next !== existing ? 'updated_marked_block' : 'unchanged';
  }
  if (existing.includes(LEGACY_HEADING)) return 'already_present_unmarked';
  if (!allowInsert) return 'absent_respected';
  const sep = existing.trim() ? '\n\n---\n\n' : '';
  writeFileAtomic(AGENTS_MD, `${ruleBlock}${sep}${existing}`);
  state.agentsRule = { inserted: true };
  return 'prepended_rule_block';
}

function removeAgentsMdRule() {
  const existing = readTextSafe(AGENTS_MD);
  if (!existing) return false;
  const span = findMarkedRuleSpan(existing);
  if (!span) return false;
  let tail = existing.slice(span.end);
  tail = tail.replace(/^\s*(?:---\s*)?/, '');
  const head = existing.slice(0, span.begin);
  writeFileAtomic(AGENTS_MD, (head + tail).replace(/^\s+/, ''));
  return true;
}

/* -------------------------------------------------------------------------- */
/* User layer deploy / restore (`~/.gemini/antigravity/anti-claude/user/`)    */
/* -------------------------------------------------------------------------- */

function deployFile(f, text, state) {
  writeFileAtomic(path.join(USER_DIR, f), text);
  writeFileAtomic(path.join(BASE_DIR, f), text);
  state.files[f].deployedSha = sha256Text(text);
  fs.rmSync(path.join(INCOMING_DIR, f), { force: true });
}

function installUserLayer(state, { sourceRoot = __dirname, overwriteLocal = false } = {}) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const result = { created: [], updated: [], merged: [], conflicts: [], unchanged: [] };
  for (const f of USER_LAYER_FILES) {
    const src = path.join(sourceRoot, 'user', f);
    const srcText = readTextSafe(src);
    if (srcText === null) continue;
    const dst = path.join(USER_DIR, f);
    const localText = readTextSafe(dst);
    let entry = state.files[f];

    if (!entry) {
      const bakPath = path.join(BACKUP_DIR, f);
      const baseText = readTextSafe(path.join(BASE_DIR, f));
      const bakAlreadyExists = fs.existsSync(bakPath);
      if (bakAlreadyExists || baseText !== null) {
        /* Never overwrite an existing pre-install backup or treat our own deployed base as a user backup */
        entry = state.files[f] = {
          existedBefore: bakAlreadyExists,
          deployedSha: baseText !== null ? sha256Text(baseText) : ''
        };
      } else {
        if (localText !== null) {
          fs.mkdirSync(BACKUP_DIR, { recursive: true });
          fs.writeFileSync(bakPath, localText, 'utf8');
        }
        entry = state.files[f] = { existedBefore: localText !== null, deployedSha: '' };
        deployFile(f, srcText, state);
        result.created.push(f);
        continue;
      }
    }
    if (localText === null) {
      deployFile(f, srcText, state);
      result.updated.push(f);
      continue;
    }
    if (localText === srcText) {
      if (readTextSafe(path.join(BASE_DIR, f)) !== srcText) deployFile(f, srcText, state);
      result.unchanged.push(f);
      continue;
    }
    const baseText = readTextSafe(path.join(BASE_DIR, f));
    const localUntouched = baseText !== null ? localText === baseText : sha256Text(localText) === entry.deployedSha;
    if (localUntouched) {
      deployFile(f, srcText, state);
      result.updated.push(f);
      continue;
    }
    if (overwriteLocal) {
      writeFileAtomic(path.join(LOCAL_SAVE_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${f}`), localText);
      deployFile(f, srcText, state);
      result.updated.push(`${f} (local edits saved to local-saves/)`);
      continue;
    }
    if (f.endsWith('.json') && baseText !== null) {
      try {
        const merged = threeWayMergeJson(JSON.parse(baseText), JSON.parse(localText), JSON.parse(srcText));
        const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
        if (mergedText !== localText) writeFileAtomic(dst, mergedText);
        writeFileAtomic(path.join(BASE_DIR, f), srcText);
        entry.deployedSha = sha256Text(mergedText);
        result.merged.push(f);
        continue;
      } catch {}
    }
    if (baseText === srcText) {
      result.unchanged.push(`${f} (local edits kept)`);
      continue;
    }
    writeFileAtomic(path.join(INCOMING_DIR, f), srcText);
    result.conflicts.push(f);
  }
  return result;
}

function restoreUserLayer(state, saveDir) {
  const out = { restored: [], removed: [], stubbed: [], kept: [], savedLocalEdits: [] };
  for (const f of USER_LAYER_FILES) {
    const entry = state.files?.[f];
    if (!entry) continue;
    const dst = path.join(USER_DIR, f);
    const cur = readTextSafe(dst);
    const base = readTextSafe(path.join(BASE_DIR, f));
    const hasEdits =
      cur !== null &&
      (base !== null ? cur !== base : Boolean(entry.deployedSha) ? sha256Text(cur) !== entry.deployedSha : true);
    if (hasEdits) {
      fs.mkdirSync(saveDir, { recursive: true });
      fs.writeFileSync(path.join(saveDir, f), cur, 'utf8');
      out.savedLocalEdits.push(path.join(saveDir, f));
    }
    const bak = path.join(BACKUP_DIR, f);
    if (entry.existedBefore === true && fs.existsSync(bak)) {
      fs.mkdirSync(USER_DIR, { recursive: true });
      fs.copyFileSync(bak, dst);
      out.restored.push(f);
    } else if (entry.existedBefore === false) {
      fs.rmSync(dst, { force: true });
      out.removed.push(f);
    } else if (STUB_CONTENT[f]) {
      writeFileAtomic(dst, STUB_CONTENT[f]);
      out.stubbed.push(f);
    } else {
      out.kept.push(f);
    }
  }
  return out;
}

function preservePreviousLocalSaves(saveDir) {
  const preserved = [];
  if (!fs.existsSync(LOCAL_SAVE_DIR)) return preserved;
  try {
    const entries = fs.readdirSync(LOCAL_SAVE_DIR);
    if (!entries.length) return preserved;
    const targetSubdir = path.join(saveDir, 'local-saves');
    fs.mkdirSync(targetSubdir, { recursive: true });
    for (const name of entries) {
      const src = path.join(LOCAL_SAVE_DIR, name);
      const dst = path.join(targetSubdir, name);
      fs.cpSync(src, dst, { recursive: true });
      preserved.push(dst);
    }
  } catch {}
  return preserved;
}

function cleanupUninstallExtras(state) {
  const fontsRemoved = [];
  if (Array.isArray(state?.fontsCopied) && state.fontsCopied.length > 0) {
    const fontsDir = getUserFontsDir();
    for (const fname of state.fontsCopied) {
      if (typeof fname !== 'string' || !/^Anthropic.*\.(ttf|otf)$/i.test(path.basename(fname))) continue;
      const fp = path.join(fontsDir, path.basename(fname));
      if (fs.existsSync(fp)) {
        try {
          fs.rmSync(fp, { force: true });
          fontsRemoved.push(fp);
        } catch {}
      }
    }
  }

  const sidecarsRemoved = [];
  if (fs.existsSync(SIDECARS_DIR)) {
    try {
      for (const entry of fs.readdirSync(SIDECARS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const scDir = path.join(SIDECARS_DIR, entry.name);
        const sc = readJsonSafe(path.join(scDir, 'sidecar.json'), null);
        if (sc?.created_by === 'anti-claude' || typeof sc?.anti_claude_project_dir === 'string') {
          fs.rmSync(scDir, { recursive: true, force: true });
          sidecarsRemoved.push(entry.name);
        }
      }
    } catch {}
  }

  const projectsCleaned = [];
  const reg = readJsonSafe(PROJECTS_REGISTRY_FILE, null);
  if (Array.isArray(reg?.dirs)) {
    for (const rawDir of reg.dirs) {
      if (typeof rawDir !== 'string' || !path.isAbsolute(rawDir) || !fs.existsSync(rawDir)) continue;
      const agentsPath = path.join(rawDir, 'AGENTS.md');
      const existing = readTextSafe(agentsPath);
      let touched = false;
      if (existing) {
        const bIdx = existing.indexOf(PROJECT_RULE_BEGIN);
        const eIdx = bIdx !== -1 ? existing.indexOf(PROJECT_RULE_END, bIdx) : -1;
        if (bIdx !== -1 && eIdx > bIdx) {
          let before = existing.slice(0, bIdx).replace(/\s+$/, '');
          let after = existing.slice(eIdx + PROJECT_RULE_END.length).replace(/^\s+/, '');
          if (!before) after = after.replace(/^---(?:\r?\n)+/, '').replace(/^---\s*$/, '').replace(/^\s+/, '');
          else if (!after) before = before.replace(/(?:\r?\n)+---$/, '').replace(/\s+$/, '');
          const rest = [before, after].filter(Boolean).join('\n\n').trim();
          if (rest) writeFileAtomic(agentsPath, `${rest}\n`);
          else fs.rmSync(agentsPath, { force: true });
          touched = true;
        }
      }
      const acDir = path.join(rawDir, '.anti-claude');
      if (fs.existsSync(acDir)) {
        try {
          fs.rmSync(acDir, { recursive: true, force: true });
          touched = true;
        } catch {}
      }
      if (touched) projectsCleaned.push(rawDir);
    }
  }

  return { fontsRemoved, sidecarsRemoved, projectsCleaned };
}

function runLiveVerify() {
  const fakeEnv = process.env.ANTI_CLAUDE_FAKE_VERIFY_OK ?? process.env.FAKE_VERIFY_OK;
  if (NO_CDP && fakeEnv === undefined) {
    return { ok: true, skipped: 'cdp_disabled' };
  }
  if (!fs.existsSync(CORE_DAEMON_SCRIPT)) {
    return { ok: false, reason: 'core_daemon_missing' };
  }
  let stdout = '';
  let exitStatus = 0;
  const env = buildNodeExecEnv(process.env);
  if (fakeEnv !== undefined) env.ANTI_CLAUDE_FAKE_VERIFY_OK = String(fakeEnv);
  try {
    stdout = execFileSync(process.execPath, [CORE_DAEMON_SCRIPT, '--verify-once', '--user-dir', USER_DIR], {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    stdout = String(err?.stdout || '');
    exitStatus = typeof err?.status === 'number' ? err.status : -1;
    if (!stdout) return { ok: false, exitStatus, reason: String(err?.message || err).split('\n')[0] };
  }
  const parsed = parseTrailingJson(stdout);
  if (!parsed) return { ok: false, exitStatus, reason: 'verify_output_unparseable' };
  const ok = exitStatus === 0 && parsed.ok === true;
  return {
    ok,
    exitStatus,
    themeStyle: parsed.themeStyle ?? null,
    customStyle: parsed.customStyle ?? null,
    reachable: parsed.live?.reachable ?? null,
    reason: ok ? undefined : parsed.live?.reachable === false ? 'app_not_running_or_unreachable' : 'verify_reported_not_ok'
  };
}

function runLiveTeardownOnce() {
  if (NO_CDP || !fs.existsSync(CORE_DAEMON_SCRIPT)) return { skipped: true };
  const tmpTeardownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-claude-teardown-'));
  try {
    fs.writeFileSync(path.join(tmpTeardownDir, 'config.json'), JSON.stringify({ enabled: false }), 'utf8');
    execFileSync(process.execPath, [CORE_DAEMON_SCRIPT, '--once', '--user-dir', tmpTeardownDir], {
      timeout: 8000,
      windowsHide: true,
      env: buildNodeExecEnv(),
      stdio: 'ignore'
    });
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    fs.rmSync(tmpTeardownDir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Standalone Core Daemon & Auto-Update Service Management                    */
/* -------------------------------------------------------------------------- */

function getWinStartupVbsPath() {
  const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Anti-Claude-Daemon.vbs');
}

function getLinuxSystemdUnitPath() {
  return path.join(HOME, '.config', 'systemd', 'user', 'anti-claude-daemon.service');
}

function sleepSync(ms) {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

function waitForActiveRelaunchWindow(maxWaitMs = 5000) {
  const intentFile = path.join(STATE_DIR, 'relaunch-intent.json');
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const intent = readJsonSafe(intentFile, null);
    if (!intent || typeof intent.startedAt !== 'number' || Date.now() - intent.startedAt > 15000) {
      return;
    }
    sleepSync(200);
  }
}

function spawnDetachedDaemon(nodePath) {
  let logFd = null;
  let stdio = 'ignore';
  try {
    fs.mkdirSync(path.dirname(DAEMON_LOG_FILE), { recursive: true });
    logFd = fs.openSync(DAEMON_LOG_FILE, 'a');
    stdio = ['ignore', logFd, logFd];
  } catch {}
  try {
    const childEnv = shouldRunAsElectronNode(nodePath)
      ? { ...buildNodeExecEnv(), ELECTRON_RUN_AS_NODE: '1' }
      : buildNodeExecEnv();
    const child = spawn(nodePath, [CORE_DAEMON_SCRIPT, '--user-dir', USER_DIR], {
      detached: true,
      windowsHide: true,
      env: childEnv,
      stdio
    });
    child.unref();
    return child.pid;
  } finally {
    if (logFd !== null) {
      try {
        fs.closeSync(logFd);
      } catch {}
    }
  }
}

function ensureCoreDaemon() {
  if (NO_LAUNCHD) return { ok: true, skipped: 'launchd_disabled' };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(USER_DIR, { recursive: true });
  const nodePath = stableNodePath();
  const useElectronAsNode = shouldRunAsElectronNode(nodePath);

  if (process.platform === 'darwin') {
    const tmpRoot = fs.realpathSync(os.tmpdir());
    if (fs.realpathSync(__dirname).startsWith(tmpRoot)) {
      const pid = spawnDetachedDaemon(nodePath);
      return { ok: true, mode: 'detached_temp', pid };
    }
    fs.mkdirSync(path.dirname(DAEMON_PLIST), { recursive: true });
    const envPath = Array.from(
      new Set(['/opt/homebrew/bin', '/usr/local/bin', path.dirname(nodePath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])
    ).join(':');
    const electronEnvXml = useElectronAsNode
      ? '\n    <key>ELECTRON_RUN_AS_NODE</key>\n    <string>1</string>'
      : '';
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(CORE_DAEMON_SCRIPT)}</string>
    <string>--user-dir</string>
    <string>${xmlEscape(USER_DIR)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(envPath)}</string>${electronEnvXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(DAEMON_LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(DAEMON_LOG_FILE)}</string>
</dict>
</plist>
`;
    writeFileAtomic(DAEMON_PLIST, plistXml);
    waitForActiveRelaunchWindow(5000);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    const serviceTarget = `gui/${uid}/${DAEMON_LABEL}`;
    let hadLoaded = false;
    try {
      execFileSync('launchctl', ['print', serviceTarget], { stdio: 'ignore', timeout: 2000 });
      hadLoaded = true;
    } catch {}
    if (hadLoaded) {
      try {
        execFileSync('launchctl', ['bootout', `gui/${uid}`, DAEMON_PLIST], { stdio: 'ignore', timeout: 4000 });
      } catch {}
      /* Wait for launchd teardown to complete before calling bootstrap (prevents race -> Bootstrap failed: 5) */
      const teardownDeadline = Date.now() + 1800;
      while (Date.now() < teardownDeadline) {
        try {
          execFileSync('launchctl', ['print', serviceTarget], { stdio: 'ignore', timeout: 1000 });
          sleepSync(120);
        } catch {
          break;
        }
      }
    }
    try {
      execFileSync('launchctl', ['enable', serviceTarget], { stdio: 'ignore', timeout: 2000 });
    } catch {}
    let bootErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, DAEMON_PLIST], { stdio: 'pipe', timeout: 5000 });
        bootErr = null;
        break;
      } catch (err) {
        bootErr = err;
        const msg = String(err?.stderr || err?.message || '');
        if (/already loaded|already bootstrapped/i.test(msg)) {
          try {
            execFileSync('launchctl', ['kickstart', '-k', serviceTarget], { stdio: 'ignore', timeout: 4000 });
            bootErr = null;
            break;
          } catch (kErr) {
            bootErr = kErr;
          }
        }
        if (attempt < 2) sleepSync(250 * (attempt + 1));
      }
    }
    if (bootErr) {
      const pid = spawnDetachedDaemon(nodePath);
      if (pid) {
        return {
          ok: true,
          label: DAEMON_LABEL,
          plist: DAEMON_PLIST,
          node: nodePath,
          pid,
          fallbackDetached: true,
          launchctlNote: String(bootErr?.stderr || bootErr?.message).trim()
        };
      }
      return { ok: false, reason: `launchctl_bootstrap_failed: ${String(bootErr?.stderr || bootErr?.message).trim()}`, plist: DAEMON_PLIST };
    }
    /* plist sets RunAtLoad=true + KeepAlive=true, so successful bootstrap already starts the daemon once */
    return { ok: true, label: DAEMON_LABEL, plist: DAEMON_PLIST, node: nodePath };
  }

  if (process.platform === 'win32') {
    const vbsPath = getWinStartupVbsPath();
    const vbs = buildWinStartupVbs(nodePath, CORE_DAEMON_SCRIPT, USER_DIR, { useElectronAsNode });
    try {
      writeFileAtomic(vbsPath, vbs);
    } catch {}
    const pid = spawnDetachedDaemon(nodePath);
    return { ok: true, startupVbs: vbsPath, pid };
  }

  const unitPath = getLinuxSystemdUnitPath();
  const systemdEnvLine = useElectronAsNode ? 'Environment="ELECTRON_RUN_AS_NODE=1"\n' : '';
  const unit = `[Unit]\nDescription=Anti-Claude CDP Daemon\nAfter=default.target\n\n[Service]\n${systemdEnvLine}ExecStart="${nodePath}" "${CORE_DAEMON_SCRIPT}" --user-dir "${USER_DIR}"\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
  try {
    writeFileAtomic(unitPath, unit);
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore', timeout: 4000 });
    execFileSync('systemctl', ['--user', 'enable', '--now', 'anti-claude-daemon.service'], { stdio: 'ignore', timeout: 5000 });
    execFileSync('systemctl', ['--user', 'restart', 'anti-claude-daemon.service'], { stdio: 'ignore', timeout: 5000 });
    return { ok: true, systemdUnit: unitPath };
  } catch {
    const pid = spawnDetachedDaemon(nodePath);
    return { ok: true, mode: 'detached', pid };
  }
}

export function buildWinStartupVbs(nodePath, daemonScript, userDir, options = {}) {
  /* Encode non-ASCII characters via ChrW() so WScript never garbles Unicode usernames without BOM */
  const vbsExpr = (s) => {
    const parts = [];
    let buf = '';
    const flush = () => {
      if (buf) {
        parts.push(`"${buf}"`);
        buf = '';
      }
    };
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (ch === '"') buf += '""';
      else if (cp >= 32 && cp <= 126) buf += ch;
      else if (cp <= 0xffff) {
        flush();
        parts.push(`ChrW(${cp})`);
      } else {
        flush();
        const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
        const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
        parts.push(`ChrW(${hi})`, `ChrW(${lo})`);
      }
    }
    flush();
    return parts.length ? parts.join(' & ') : '""';
  };
  const useElectron = options?.useElectronAsNode !== undefined
    ? Boolean(options.useElectronAsNode)
    : shouldRunAsElectronNode(nodePath);
  const workDir = path.win32.dirname(String(daemonScript || ''));
  if (useElectron) {
    const cmdArgs = `/d /s /c "set "ELECTRON_RUN_AS_NODE=1" && "${nodePath}" "${daemonScript}" --user-dir "${userDir}""`;
    return `Set sh = CreateObject("Shell.Application")\r\nsh.ShellExecute "cmd.exe", ${vbsExpr(cmdArgs)}, ${vbsExpr(workDir)}, "open", 0\r\n`;
  }
  const directArgs = `"${daemonScript}" --user-dir "${userDir}"`;
  return `Set sh = CreateObject("Shell.Application")\r\nsh.ShellExecute ${vbsExpr(nodePath)}, ${vbsExpr(directArgs)}, ${vbsExpr(workDir)}, "open", 0\r\n`;
}

function disableCoreDaemon() {
  let stopped = false;
  if (process.platform === 'darwin' && fs.existsSync(DAEMON_PLIST)) {
    if (!NO_LAUNCHD) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
      try {
        execFileSync('launchctl', ['bootout', `gui/${uid}`, DAEMON_PLIST], { stdio: 'ignore' });
      } catch {}
    }
    fs.rmSync(DAEMON_PLIST, { force: true });
    stopped = true;
  } else if (process.platform === 'win32') {
    const vbsPath = getWinStartupVbsPath();
    if (fs.existsSync(vbsPath)) {
      fs.rmSync(vbsPath, { force: true });
      stopped = true;
    }
  } else {
    const unitPath = getLinuxSystemdUnitPath();
    if (fs.existsSync(unitPath)) {
      if (!NO_LAUNCHD) {
        try {
          execFileSync('systemctl', ['--user', 'disable', '--now', 'anti-claude-daemon.service'], { stdio: 'ignore', timeout: 4000 });
        } catch {}
      }
      fs.rmSync(unitPath, { force: true });
      stopped = true;
    }
  }

  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(readTextSafe(PID_FILE) || '0', 10);
    if (pid > 0 && !NO_LAUNCHD && isMatchingDaemonPid(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(PID_FILE, { force: true });
    stopped = true;
  }
  return { stopped };
}

function inspectCoreDaemon() {
  let pidAlive = false;
  let pid = null;
  if (fs.existsSync(PID_FILE)) {
    const parsed = parseInt(readTextSafe(PID_FILE) || '0', 10);
    if (parsed > 0) {
      pid = parsed;
      pidAlive = isMatchingDaemonPid(parsed);
    }
  }
  if (process.platform === 'darwin') {
    const xml = fs.existsSync(DAEMON_PLIST) ? readTextSafe(DAEMON_PLIST) : null;
    if (!xml) return { installed: false, running: pidAlive, pid };
    const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>\s*<string>([^<]+)<\/string>/);
    const nodePath = m ? m[1].replace(/&amp;/g, '&') : null;
    const scriptPath = m ? m[2].replace(/&amp;/g, '&') : null;
    return {
      installed: true,
      running: pidAlive,
      pid,
      label: DAEMON_LABEL,
      nodePath,
      nodeExists: Boolean(nodePath && fs.existsSync(nodePath)),
      scriptPath,
      scriptExists: Boolean(scriptPath && fs.existsSync(scriptPath))
    };
  }
  if (process.platform === 'win32') {
    const vbsPath = getWinStartupVbsPath();
    return { installed: fs.existsSync(vbsPath), running: pidAlive, pid, startupVbs: vbsPath };
  }
  const unitPath = getLinuxSystemdUnitPath();
  return { installed: fs.existsSync(unitPath), running: pidAlive, pid, systemdUnit: unitPath };
}

function enableMacAutoUpdateAgent() {
  if (process.platform !== 'darwin') return { ok: false, reason: 'macos_launchd_only' };
  if (NO_LAUNCHD) return { ok: false, reason: 'launchd_disabled' };
  const tmpRoot = fs.realpathSync(os.tmpdir());
  if (fs.realpathSync(__dirname).startsWith(tmpRoot)) {
    return { ok: false, reason: 'repo_in_temp_dir: clone to a permanent path (e.g. ~/Developer) before enabling auto-update' };
  }
  fs.mkdirSync(path.dirname(AUTOSYNC_PLIST), { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const nodePath = stableNodePath();
  const useElectronAsNode = shouldRunAsElectronNode(nodePath);
  const envPath = Array.from(
    new Set(['/opt/homebrew/bin', '/usr/local/bin', path.dirname(nodePath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'])
  ).join(':');
  const electronEnvXml = useElectronAsNode
    ? '\n    <key>ELECTRON_RUN_AS_NODE</key>\n    <string>1</string>'
    : '';
  const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTOSYNC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(path.join(__dirname, 'install.mjs'))}</string>
    <string>sync-upgrade</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(envPath)}</string>${electronEnvXml}
  </dict>
  <key>WatchPaths</key>
  <array>
    <string>/Applications/Antigravity.app/Contents/Info.plist</string>
    <string>/Applications/Antigravity.app/Contents/Resources/app.asar</string>
  </array>
  <key>StartInterval</key>
  <integer>43200</integer>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(LAUNCHD_LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(LAUNCHD_LOG_FILE)}</string>
</dict>
</plist>
`;
  writeFileAtomic(AUTOSYNC_PLIST, plistXml);
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  if (fs.existsSync(LEGACY_AUTOSYNC_PLIST)) {
    try {
      execFileSync('launchctl', ['bootout', `gui/${uid}`, LEGACY_AUTOSYNC_PLIST], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(LEGACY_AUTOSYNC_PLIST, { force: true });
  }
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}`, AUTOSYNC_PLIST], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('launchctl', ['enable', `gui/${uid}/${AUTOSYNC_LABEL}`], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, AUTOSYNC_PLIST], { stdio: 'pipe' });
  } catch (err) {
    return { ok: false, reason: `launchctl_bootstrap_failed: ${String(err?.stderr || err?.message).trim()}`, plist: AUTOSYNC_PLIST };
  }
  return { ok: true, label: AUTOSYNC_LABEL, plist: AUTOSYNC_PLIST, node: nodePath };
}

function disableMacAutoUpdateAgent() {
  if (process.platform !== 'darwin') return { removed: false };
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  let removed = false;
  for (const plist of [AUTOSYNC_PLIST, LEGACY_AUTOSYNC_PLIST]) {
    if (!fs.existsSync(plist)) continue;
    if (!NO_LAUNCHD) {
      try {
        execFileSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' });
      } catch {}
    }
    fs.rmSync(plist, { force: true });
    removed = true;
  }
  return removed ? { removed: true, label: AUTOSYNC_LABEL } : { removed: false };
}

function inspectAutoUpdateAgent() {
  const activePlist = fs.existsSync(AUTOSYNC_PLIST) ? AUTOSYNC_PLIST : fs.existsSync(LEGACY_AUTOSYNC_PLIST) ? LEGACY_AUTOSYNC_PLIST : null;
  const xml = activePlist ? readTextSafe(activePlist) : null;
  if (!xml) return { installed: false };
  const m = xml.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>\s*<string>([^<]+)<\/string>/);
  const nodePath = m ? m[1].replace(/&amp;/g, '&') : null;
  const scriptPath = m ? m[2].replace(/&amp;/g, '&') : null;
  return {
    installed: true,
    legacyPlist: activePlist === LEGACY_AUTOSYNC_PLIST,
    nodePath,
    nodeExists: Boolean(nodePath && fs.existsSync(nodePath)),
    nodeVersionPinned: Boolean(nodePath && /\/Cellar\/|\/\.nvm\/versions\//.test(nodePath)),
    scriptPath,
    scriptExists: Boolean(scriptPath && fs.existsSync(scriptPath))
  };
}

/* -------------------------------------------------------------------------- */
/* Antigravity CLI (agy) layer deploy / restore                               */
/* -------------------------------------------------------------------------- */

export function buildCliStatusLineCommand(nodePath = stableNodePath(), scriptPath = AGY_CLI_STATUSLINE_FILE) {
  return `"${nodePath}" "${scriptPath}"`;
}

function deployCliStatusLineScript(text, state) {
  writeFileAtomic(AGY_CLI_STATUSLINE_FILE, text);
  try {
    fs.chmodSync(AGY_CLI_STATUSLINE_FILE, 0o755);
  } catch {}
  writeFileAtomic(path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME), text);
  state.cli.statusLineScript.deployedSha = sha256Text(text);
  fs.rmSync(path.join(INCOMING_DIR, AGY_CLI_STATUSLINE_NAME), { force: true });
}

function installCliLayer(state, { sourceRoot = __dirname, overwriteLocal = false, allowSettingsEnable = true } = {}) {
  state.cli = state.cli || {};
  if (state.options.cliStatusLine === false) {
    return { skipped: 'disabled_by_option' };
  }
  const srcPath = path.join(sourceRoot, 'cli', 'statusline.mjs');
  const srcText = readTextSafe(srcPath);
  if (srcText === null) {
    return { error: 'cli_statusline_source_missing' };
  }

  fs.mkdirSync(AGY_CLI_DIR, { recursive: true });
  const localText = readTextSafe(AGY_CLI_STATUSLINE_FILE);
  let scriptAction = 'unchanged';
  let conflict = false;

  if (!state.cli.statusLineScript) {
    const bakPath = path.join(BACKUP_DIR, AGY_CLI_STATUSLINE_NAME);
    const baseText = readTextSafe(path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME));
    if (fs.existsSync(bakPath) || baseText !== null) {
      state.cli.statusLineScript = {
        existedBefore: fs.existsSync(bakPath),
        deployedSha: baseText !== null ? sha256Text(baseText) : ''
      };
    } else {
      if (localText !== null) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        fs.writeFileSync(bakPath, localText, 'utf8');
      }
      state.cli.statusLineScript = { existedBefore: localText !== null, deployedSha: '' };
      deployCliStatusLineScript(srcText, state);
      scriptAction = 'created';
    }
  }
  if (scriptAction !== 'created') {
    if (localText === null) {
      deployCliStatusLineScript(srcText, state);
      scriptAction = 'updated';
    } else if (localText === srcText) {
      if (readTextSafe(path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME)) !== srcText) {
        deployCliStatusLineScript(srcText, state);
      }
      scriptAction = 'unchanged';
    } else {
      const baseText = readTextSafe(path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME));
      const localUntouched =
        baseText !== null ? localText === baseText : sha256Text(localText) === state.cli.statusLineScript.deployedSha;
      if (localUntouched) {
        deployCliStatusLineScript(srcText, state);
        scriptAction = 'updated';
      } else if (overwriteLocal) {
        writeFileAtomic(
          path.join(LOCAL_SAVE_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${AGY_CLI_STATUSLINE_NAME}`),
          localText
        );
        deployCliStatusLineScript(srcText, state);
        scriptAction = 'overwritten';
      } else if (baseText === srcText) {
        scriptAction = 'unchanged (local edits kept)';
      } else {
        writeFileAtomic(path.join(INCOMING_DIR, AGY_CLI_STATUSLINE_NAME), srcText);
        scriptAction = 'conflict';
        conflict = true;
      }
    }
  }

  const cmd = buildCliStatusLineCommand();
  const settingsExisted = fs.existsSync(AGY_CLI_SETTINGS_JSON);
  let cfg = {};
  if (settingsExisted) {
    const parsed = readJsonSafe(AGY_CLI_SETTINGS_JSON, null);
    if (!isPlainObject(parsed)) {
      return { script: scriptAction, conflict, settings: { error: 'invalid_json', path: AGY_CLI_SETTINGS_JSON } };
    }
    cfg = parsed;
  }

  const currentStatusLine = cfg.statusLine;
  const isOurs = String(currentStatusLine?.command || '').includes(AGY_CLI_STATUSLINE_NAME);
  const hasCustomOverride = Boolean(currentStatusLine && !isOurs);
  let settingsAction = 'unchanged';

  if (allowSettingsEnable) {
    if (state.cli.settings && hasCustomOverride && !overwriteLocal) {
      /* Preserve user-configured custom statusLine on re-install unless --overwrite-local is passed */
      settingsAction = 'user_override_respected';
    } else {
      if (!state.cli.settings) {
        state.cli.settings = {
          existedBefore: settingsExisted,
          changed: true,
          hadStatusLine: Object.prototype.hasOwnProperty.call(cfg, 'statusLine'),
          beforeStatusLine: clone(cfg.statusLine),
          deployedCommand: cmd
        };
      } else {
        if (hasCustomOverride) {
          try {
            writeFileAtomic(
              path.join(LOCAL_SAVE_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-cli-statusline.json`),
              `${JSON.stringify({ statusLine: currentStatusLine }, null, 2)}\n`
            );
          } catch {}
        }
        state.cli.settings.changed = true;
        state.cli.settings.deployedCommand = cmd;
      }
      const desired = { type: 'command', command: cmd, enabled: true };
      if (!deepEqual(cfg.statusLine, desired)) {
        cfg.statusLine = desired;
        writeJsonAtomic(AGY_CLI_SETTINGS_JSON, cfg);
        settingsAction = settingsExisted ? 'updated' : 'created';
      }
    }
  } else if (isOurs && currentStatusLine?.enabled === true && currentStatusLine.command !== cmd) {
    cfg.statusLine = Object.assign({}, currentStatusLine, { command: cmd });
    writeJsonAtomic(AGY_CLI_SETTINGS_JSON, cfg);
    if (state.cli.settings) state.cli.settings.deployedCommand = cmd;
    settingsAction = 'command_refreshed';
  } else if (!isOurs) {
    settingsAction = 'user_override_respected';
  }

  return {
    script: scriptAction,
    scriptPath: AGY_CLI_STATUSLINE_FILE,
    conflict,
    settings: { action: settingsAction, path: AGY_CLI_SETTINGS_JSON }
  };
}

function restoreCliLayer(state, sharedSaveDir = null) {
  const out = { script: 'not_managed', settings: 'not_managed', savedLocalEdits: [] };
  const cliState = state?.cli;
  if (!cliState || (!cliState.statusLineScript && !cliState.settings)) return out;

  if (cliState.settings?.changed && fs.existsSync(AGY_CLI_SETTINGS_JSON)) {
    const cfg = readJsonSafe(AGY_CLI_SETTINGS_JSON, null);
    if (isPlainObject(cfg)) {
      const currentCmd = String(cfg.statusLine?.command || '');
      if (currentCmd.includes(AGY_CLI_STATUSLINE_NAME)) {
        if (cliState.settings.hadStatusLine) {
          cfg.statusLine = clone(cliState.settings.beforeStatusLine);
          writeJsonAtomic(AGY_CLI_SETTINGS_JSON, cfg);
          out.settings = 'restored';
        } else {
          delete cfg.statusLine;
          if (cliState.settings.existedBefore === false && Object.keys(cfg).length === 0) {
            fs.rmSync(AGY_CLI_SETTINGS_JSON, { force: true });
            out.settings = 'removed';
          } else {
            writeJsonAtomic(AGY_CLI_SETTINGS_JSON, cfg);
            out.settings = 'statusline_removed';
          }
        }
      } else {
        out.settings = 'user_override_kept';
      }
    }
  }

  const scriptEntry = cliState.statusLineScript;
  if (scriptEntry) {
    const cur = readTextSafe(AGY_CLI_STATUSLINE_FILE);
    const base = readTextSafe(path.join(BASE_DIR, AGY_CLI_STATUSLINE_NAME));
    if (cur !== null && base !== null && cur !== base) {
      const saveDir =
        sharedSaveDir || path.join(AGY_DIR, `anti-claude-uninstall-saved-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(saveDir, { recursive: true });
      const savedPath = path.join(saveDir, AGY_CLI_STATUSLINE_NAME);
      fs.writeFileSync(savedPath, cur, 'utf8');
      out.savedLocalEdits.push(savedPath);
    }
    const bak = path.join(BACKUP_DIR, AGY_CLI_STATUSLINE_NAME);
    if (scriptEntry.existedBefore === true && fs.existsSync(bak)) {
      fs.copyFileSync(bak, AGY_CLI_STATUSLINE_FILE);
      out.script = 'restored';
    } else if (scriptEntry.existedBefore === false) {
      fs.rmSync(AGY_CLI_STATUSLINE_FILE, { force: true });
      out.script = 'removed';
    } else {
      out.script = 'kept';
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

async function cmdDoctor() {
  const state = readJsonSafe(STATE_FILE, null);
  const pbtxt = readTextSafe(AGY_STATE_PBTXT) || '';
  const cfg = readJsonSafe(AGY_CONFIG_JSON, null);
  const agentsRaw = readTextSafe(AGENTS_MD) || '';
  const incoming = fs.existsSync(INCOMING_DIR) ? fs.readdirSync(INCOMING_DIR) : [];
  const daemon = inspectCoreDaemon();
  const agent = inspectAutoUpdateAgent();
  const antigravityCli = detectAntigravityCli();
  const pkgVersion = readJsonSafe(path.join(__dirname, 'package.json'), {})?.version || null;
  const legacyThemePatchPresent = fs.existsSync(LEGACY_THEME_PATCH_DIR) || fs.existsSync(LEGACY_THEME_DAEMON_PLIST);
  const mode = state
    ? state.options?.desktop === false
      ? 'cli-only'
      : state.options?.cli
        ? 'desktop+cli'
        : 'desktop'
    : null;
  const warnings = [];
  if (daemon.installed && daemon.nodeExists === false) warnings.push('core daemon LaunchAgent points to a missing node binary: run `install` again');
  if (daemon.installed && daemon.scriptExists === false) warnings.push('core daemon LaunchAgent points to a missing core/daemon.mjs');
  if (agent.installed && !agent.nodeExists) warnings.push('auto-update LaunchAgent points to a missing node binary: run auto-update-on again');
  if (agent.installed && !agent.scriptExists) warnings.push('auto-update LaunchAgent points to a missing install.mjs');
  if (incoming.length) warnings.push(`template updates held back because of local edits: ${incoming.join(', ')} (see ${INCOMING_DIR})`);
  if (!state && (fs.existsSync(LEGACY_V2_STATE_FILE) || fs.existsSync(LEGACY_BACKUP_DIR))) {
    warnings.push('legacy claude-ux install detected: run `install` once to migrate the install state to anti-claude');
  }
  if (legacyThemePatchPresent) {
    warnings.push('legacy theme-patch installation detected: run `install` once to migrate customizations and retire theme-patch');
  }
  if (agent.legacyPlist) warnings.push('legacy claude-ux LaunchAgent detected: run `install` or `auto-update-on` to migrate to com.antigravity.anti-claude.autosync');
  return finalize(
    {
      platform: process.platform,
      node: process.version,
      version: pkgVersion,
      mode,
      antigravityAppVersion: getAntigravityAppFingerprint().version,
      antigravityCli,
      coreEngine: {
        standalone: true,
        scriptExists: fs.existsSync(CORE_DAEMON_SCRIPT),
        userDir: USER_DIR,
        daemon
      },
      legacyThemePatchPresent,
      installState: state ? { installedAt: state.installedAt, options: state.options, files: Object.keys(state.files || {}) } : null,
      userLayerInstalled: (readTextSafe(path.join(USER_DIR, 'custom.js')) || '').includes('__agClaudeUxDispose'),
      autoUpdate: agent,
      lastSync: state?.sync || null,
      fonts: checkFontsInstalled(),
      developerStepSkinUnlocked: pbtxt.includes('PRODUCT_SKIN_DEVELOPER'),
      verboseConversationSteps: cfg?.userSettings?.verboseConversationSteps ?? null,
      agentsRuleConfigured: agentsRaw.includes(RULE_BEGIN) || agentsRaw.includes(LEGACY_RULE_BEGIN) || agentsRaw.includes(LEGACY_HEADING)
    },
    { warnings }
  );
}

async function cmdInstall(flags) {
  const critical = [];
  const warnings = [];
  const validation = validateSourceRoot();
  if (!validation.ok) {
    return finalize({ validation }, { critical: ['source validation failed, nothing deployed'] });
  }

  const cliOnly = flags.has('--cli-only');
  const explicitCli = flags.has('--cli') || cliOnly;
  const noCli = flags.has('--no-cli') || (NO_CLI && !explicitCli);
  const antigravityCli = detectAntigravityCli();

  const existingState = loadState();
  const desktopAlreadyInstalled = Boolean(
    existingState &&
      (existingState.options?.desktop === true || Object.keys(existingState.files || {}).length > 0)
  );
  const wasPureCliOnly = Boolean(existingState && existingState.options?.desktop === false && !desktopAlreadyInstalled);
  const state = existingState || newState();

  /* Keep installed component state separate from single-invocation `--cli-only` scope so an existing
     Desktop installation stays upgradable by `sync-upgrade` even after `install --cli-only`. */
  if (cliOnly) {
    state.options.desktop = desktopAlreadyInstalled;
  } else {
    state.options.desktop = true;
  }
  state.options.cli = !noCli && (explicitCli || antigravityCli.detected || Boolean(existingState?.options?.cli && !flags.has('--no-cli')));

  if (flags.has('--no-cli-statusline')) state.options.cliStatusLine = false;
  else if (flags.has('--cli-statusline') || state.options.cliStatusLine === undefined) state.options.cliStatusLine = true;

  if (flags.has('--no-step-unlock')) state.options.stepUnlock = false;
  else if (flags.has('--step-unlock') || (!cliOnly && wasPureCliOnly)) state.options.stepUnlock = true;
  else if (cliOnly && !desktopAlreadyInstalled) state.options.stepUnlock = false;

  if (flags.has('--no-agents-rule')) state.options.agentsRule = false;
  else if (flags.has('--agents-rule')) state.options.agentsRule = true;

  if (flags.has('--no-auto-update')) state.options.autoUpdate = false;
  else if (flags.has('--auto-update') || (!cliOnly && wasPureCliOnly)) state.options.autoUpdate = true;
  else if (cliOnly && !desktopAlreadyInstalled) state.options.autoUpdate = false;

  if (cliOnly) {
    const cliLayer = installCliLayer(state, { overwriteLocal: flags.has('--overwrite-local'), allowSettingsEnable: true });
    if (cliLayer.error) critical.push(`cli layer deploy failed: ${cliLayer.error}`);
    if (cliLayer.settings?.error) warnings.push(`cli settings (${cliLayer.settings.path}): ${cliLayer.settings.error}`);
    if (cliLayer.conflict) {
      warnings.push(`local edits kept, new version saved to ${INCOMING_DIR}: ${AGY_CLI_STATUSLINE_NAME} (use --overwrite-local to replace)`);
    }
    const ruleStatus = state.options.agentsRule ? injectAgentsMdRule(state, { allowInsert: true }) : 'disabled_by_option';
    state.sync = Object.assign({}, state.sync, { cliVersion: antigravityCli.version, lastAppliedAt: Date.now() });
    saveState(state);
    return finalize(
      { mode: desktopAlreadyInstalled ? 'desktop+cli' : 'cli-only', scope: 'cli-only', antigravityCli: detectAntigravityCli(), cliLayer, ruleStatus },
      { critical, warnings }
    );
  }

  /* Migrate any user overrides from legacy theme-patch/user and retire upstream theme-patch */
  const legacyMigration = retireLegacyThemePatch(state);
  if (legacyMigration.backupDir) {
    warnings.push(`standalone theme-patch archived to ${legacyMigration.backupDir}`);
  }

  const fontsBefore = checkFontsInstalled();
  const fontSync = fontsBefore.hasAnthropicSans || NO_FONTS ? null : syncFontsFromLocalClaudeApp(state);

  let layer;
  try {
    layer = installUserLayer(state, { overwriteLocal: flags.has('--overwrite-local') });
  } catch (err) {
    saveState(state);
    return finalize({}, { critical: [`user layer deploy failed: ${err?.message || err}`] });
  }
  if (layer.conflicts.length) warnings.push(`local edits kept, new versions saved to ${INCOMING_DIR}: ${layer.conflicts.join(', ')} (use --overwrite-local to replace)`);
  saveState(state);

  const coreDaemon = ensureCoreDaemon();
  if (!coreDaemon.ok) warnings.push(`core daemon: ${coreDaemon.reason}`);
  else if (coreDaemon.fallbackDetached) {
    warnings.push(`core daemon fell back to detached process (no launchd KeepAlive): ${coreDaemon.launchctlNote || 'launchctl failed'}`);
  }

  let stepUnlock = { skipped: 'disabled_by_option' };
  if (state.options.stepUnlock) {
    stepUnlock = await applyStepUnlock(state);
    if (!stepUnlock.live.ok && stepUnlock.live.appRunning !== false) warnings.push(`live step unlock: ${stepUnlock.live.reason}`);
  }
  const ruleStatus = state.options.agentsRule ? injectAgentsMdRule(state, { allowInsert: true }) : 'disabled_by_option';

  let cliLayer = { skipped: noCli ? 'disabled_by_option' : 'agy_cli_not_detected' };
  if (state.options.cli) {
    cliLayer = installCliLayer(state, { overwriteLocal: flags.has('--overwrite-local'), allowSettingsEnable: true });
    if (cliLayer.error) warnings.push(`cli layer: ${cliLayer.error}`);
    if (cliLayer.settings?.error) warnings.push(`cli settings (${cliLayer.settings.path}): ${cliLayer.settings.error}`);
    if (cliLayer.conflict) {
      warnings.push(`local edits kept, new version saved to ${INCOMING_DIR}: ${AGY_CLI_STATUSLINE_NAME} (use --overwrite-local to replace)`);
    }
  }

  const verify = runLiveVerify();
  if (!verify.ok) warnings.push(`live verify: ${verify.reason}`);

  const fp = getAntigravityAppFingerprint();
  state.sync = Object.assign({}, state.sync, { appVersion: fp.version, appSig: fp.sig, cliVersion: antigravityCli.version, lastAppliedAt: Date.now() });
  saveState(state);

  let autoUpdate = { skipped: true };
  if (state.options.autoUpdate && process.platform === 'darwin') {
    autoUpdate = enableMacAutoUpdateAgent();
    if (!autoUpdate.ok && autoUpdate.reason !== 'launchd_disabled') warnings.push(`auto-update: ${autoUpdate.reason}`);
  } else if (!state.options.autoUpdate) {
    autoUpdate = disableMacAutoUpdateAgent();
  }

  return finalize(
    {
      mode: state.options.cli ? 'desktop+cli' : 'desktop',
      antigravityVersion: fp.version,
      antigravityCli: detectAntigravityCli(),
      legacyMigration,
      fontSync,
      userLayer: layer,
      cliLayer,
      coreDaemon,
      stepUnlock,
      ruleStatus,
      autoUpdate,
      verify
    },
    { critical, warnings }
  );
}

async function cmdSyncUpgrade(flags) {
  const force = flags.has('--force');
  const afterPull = flags.has('--after-pull');
  const state = loadState();
  if (!state) return finalize({ noop: true, reason: 'not_installed' });

  const isDesktop = state.options?.desktop !== false;
  const fp = isDesktop ? getAntigravityAppFingerprint() : { version: 'none', sig: 'cli-only', changedAtMs: 0 };
  if (isDesktop && fp.changedAtMs > 0 && Date.now() - fp.changedAtMs < 12000) {
    await new Promise((r) => setTimeout(r, 4500));
  }
  const warnings = [];
  const appChanged = isDesktop && state.sync?.appSig !== fp.sig;
  const now = Date.now();

  let selfPull = { skipped: true };
  if (!afterPull && !NO_NETWORK && shouldCheckRemote(state.sync, { now, force, appChanged })) {
    state.sync = Object.assign({}, state.sync, { lastRemoteCheckAt: now });
    selfPull = pullSelfRepoIfGit();
    if (selfPull.error) warnings.push(`self pull: ${selfPull.error}`);
    if (selfPull.updated) {
      const v = validateSourceRoot();
      if (!v.ok) {
        const rolledBack = rollbackSelfRepo(selfPull.beforeFullHead);
        saveState(state);
        return finalize(
          { selfPull, rolledBack, validation: v },
          {
            critical: [
              rolledBack
                ? 'pulled code failed validation; repository rolled back to previous healthy commit'
                : 'pulled code failed validation; automatic git rollback failed, inspect repository'
            ]
          }
        );
      }
      state.sync.lastRemoteCheckOk = true;
      saveState(state);
      const args = [path.join(__dirname, 'install.mjs'), 'sync-upgrade', '--after-pull', ...[...flags].filter((f) => f !== '--after-pull')];
      try {
        execFileSync(process.execPath, args, { stdio: 'inherit', timeout: 180000, env: buildNodeExecEnv() });
      } catch (err) {
        process.exitCode = typeof err?.status === 'number' ? err.status : 1;
      }
      return null;
    }
    state.sync.lastRemoteCheckOk = !selfPull.error;
  }

  const validation = validateSourceRoot();
  if (!validation.ok) {
    saveState(state);
    return finalize({ validation }, { critical: ['source validation failed; live files left untouched'] });
  }

  let cliLayer = { skipped: 'disabled_by_option' };
  if (state.options?.cli) {
    cliLayer = installCliLayer(state, { overwriteLocal: flags.has('--overwrite-local'), allowSettingsEnable: false });
    if (cliLayer.error) warnings.push(`cli layer: ${cliLayer.error}`);
    if (cliLayer.settings?.error) warnings.push(`cli settings (${cliLayer.settings.path}): ${cliLayer.settings.error}`);
    if (cliLayer.conflict) warnings.push(`local edits kept, new version in ${INCOMING_DIR}: ${AGY_CLI_STATUSLINE_NAME}`);
  }

  const ruleStatus = state.options.agentsRule ? injectAgentsMdRule(state, { allowInsert: false }) : 'disabled_by_option';

  if (!isDesktop) {
    const antigravityCli = detectAntigravityCli();
    state.sync = Object.assign({}, state.sync, { cliVersion: antigravityCli.version, lastAppliedAt: now });
    saveState(state);
    const summary = `sync-upgrade | mode=cli-only | agyCli=${antigravityCli.version || 'unknown'} | remoteChecked=${!selfPull.skipped} | cliScript=${cliLayer.script || 'skipped'}`;
    appendSyncLog(summary);
    return finalize({ mode: 'cli-only', summary, selfPull, cliLayer, ruleStatus }, { warnings });
  }

  const legacyMigration = retireLegacyThemePatch(state);
  const layer = installUserLayer(state, { overwriteLocal: flags.has('--overwrite-local') });
  if (layer.conflicts.length) warnings.push(`local edits kept, new versions in ${INCOMING_DIR}: ${layer.conflicts.join(', ')}`);

  const coreDaemon = ensureCoreDaemon();
  if (!coreDaemon.ok) warnings.push(`core daemon: ${coreDaemon.reason}`);
  else if (coreDaemon.fallbackDetached) {
    warnings.push(`core daemon fell back to detached process (no launchd KeepAlive): ${coreDaemon.launchctlNote || 'launchctl failed'}`);
  }

  let stepUnlock = { skipped: appChanged ? 'disabled_by_option' : 'app_unchanged' };
  if (appChanged && state.options.stepUnlock) stepUnlock = await applyStepUnlock(state);
  if (state.options.autoUpdate && process.platform === 'darwin' && !NO_LAUNCHD && fs.existsSync(LEGACY_AUTOSYNC_PLIST)) {
    enableMacAutoUpdateAgent();
  }

  let verify = { skipped: true };
  const changed = layer.created.length + layer.updated.length + layer.merged.length > 0;
  if (force || appChanged || afterPull || changed || legacyMigration.removedDir) {
    verify = runLiveVerify();
    if (!verify.ok) warnings.push(`live verify: ${verify.reason}`);
  }

  state.sync = Object.assign({}, state.sync, { appVersion: fp.version, appSig: fp.sig, lastAppliedAt: now });
  saveState(state);
  const summary = `sync-upgrade | agy=${fp.version} | appChanged=${appChanged} | remoteChecked=${!selfPull.skipped} | updated=${layer.updated.length + layer.merged.length} | conflicts=${layer.conflicts.length}`;
  appendSyncLog(summary);
  return finalize({ summary, selfPull, legacyMigration, userLayer: layer, cliLayer, coreDaemon, stepUnlock, ruleStatus, verify }, { warnings });
}

async function cmdUninstall() {
  const state = loadState();
  if (!state) {
    const autoUpdateRemoved = disableMacAutoUpdateAgent();
    const daemonStopped = disableCoreDaemon();
    return finalize({ noop: true, reason: 'not_installed', autoUpdateRemoved, daemonStopped });
  }
  const warnings = [];
  const saveDir = path.join(AGY_DIR, `anti-claude-uninstall-saved-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const isDesktop = state.options?.desktop !== false || Object.keys(state.files || {}).length > 0;
  const autoUpdateRemoved = disableMacAutoUpdateAgent();
  const daemonStopped = isDesktop ? disableCoreDaemon() : { stopped: false };
  const liveTeardown = isDesktop ? runLiveTeardownOnce() : { skipped: 'cli_only' };
  const settings = isDesktop ? await revertStepUnlock(state) : { skipped: 'cli_only' };
  if (settings.live && !settings.live.ok && settings.live.appRunning !== false) warnings.push(`live settings revert: ${settings.live.reason}`);
  const files = isDesktop ? restoreUserLayer(state, saveDir) : { restored: [], removed: [], stubbed: [], kept: [], savedLocalEdits: [] };
  const preservedOverwrites = preservePreviousLocalSaves(saveDir);
  if (preservedOverwrites.length) {
    files.savedLocalEdits.push(...preservedOverwrites);
  }
  if (files.savedLocalEdits.length) warnings.push(`your post-install edits were saved: ${files.savedLocalEdits.join(', ')}`);
  const cli = restoreCliLayer(state, saveDir);
  if (cli.savedLocalEdits.length) warnings.push(`your post-install CLI edits were saved: ${cli.savedLocalEdits.join(', ')}`);
  const ruleRemoved = removeAgentsMdRule();
  const extras = cleanupUninstallExtras(state);

  /* Remove owned state artifacts while preserving USER_DIR if pre-existing user files were restored into it */
  for (const p of [
    STATE_FILE,
    PID_FILE,
    PROJECTS_REGISTRY_FILE,
    UI_PREFS_FILE,
    BACKUP_DIR,
    BASE_DIR,
    INCOMING_DIR,
    LOCAL_SAVE_DIR,
    SYNC_LOG_FILE,
    LAUNCHD_LOG_FILE,
    DAEMON_LOG_FILE
  ]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
  removeDirIfEmpty(USER_DIR);
  removeDirIfEmpty(STATE_DIR);
  fs.rmSync(LEGACY_V2_STATE_DIR, { recursive: true, force: true });
  fs.rmSync(LEGACY_SYNC_LOG_FILE, { force: true });

  return finalize({ autoUpdateRemoved, daemonStopped, liveTeardown, settings, files, cli, ruleRemoved, extras }, { warnings });
}

async function main(argv) {
  const sub = argv[0] || 'doctor';
  const flags = new Set(argv.slice(1));
  if (sub === 'install') return cmdInstall(flags);
  if (sub === 'sync-upgrade') return cmdSyncUpgrade(flags);
  if (sub === 'auto-update-on') {
    const state = loadState();
    if (state) {
      state.options.autoUpdate = true;
      saveState(state);
    }
    return console.log(JSON.stringify(enableMacAutoUpdateAgent(), null, 2));
  }
  if (sub === 'auto-update-off') {
    const state = loadState();
    if (state) {
      state.options.autoUpdate = false;
      saveState(state);
    }
    return console.log(JSON.stringify(disableMacAutoUpdateAgent(), null, 2));
  }
  if (sub === 'uninstall') return cmdUninstall();
  if (sub === 'sync-fonts') {
    const state = loadState();
    const res = syncFontsFromLocalClaudeApp(state);
    if (state && res?.copied?.length) saveState(state);
    return console.log(JSON.stringify(res, null, 2));
  }
  if (sub === 'doctor') return cmdDoctor();
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    return console.log(
      JSON.stringify(
        {
          ok: true,
          commands: ['install', 'sync-upgrade', 'doctor', 'uninstall', 'auto-update-on', 'auto-update-off', 'sync-fonts']
        },
        null,
        2
      )
    );
  }
  return finalize(
    { subcommand: sub },
    {
      critical: [
        `unknown command: ${sub} (expected: install | sync-upgrade | doctor | uninstall | auto-update-on | auto-update-off | sync-fonts)`
      ]
    }
  );
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    await main(process.argv.slice(2));
  } catch (err) {
    finalize({}, { critical: [String(err?.stack || err)] });
  }
}
