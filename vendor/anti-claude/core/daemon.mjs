#!/usr/bin/env node
/**
 * Anti-Claude — core/daemon.mjs
 * Self-contained, zero-dependency CDP runtime & SQLite metrics daemon for Google Antigravity Desktop (Node.js >= 22).
 *
 * Modes:
 *   node core/daemon.mjs [--user-dir <dir>]          Continuous background daemon (2.5s heartbeat + instant hot-reload)
 *   node core/daemon.mjs --once [--user-dir <dir>]   Single injection pass then exit 0
 *   node core/daemon.mjs --verify-once               Inject & verify DOM styles on live Antigravity window, print JSON
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startCuaBroker, stopCuaBroker, stopCuaBrokerSync } from './cua-broker.mjs';
import {
  readWindowsShortcutInfo,
  resolveWindowsShortcutRoots,
  writeWindowsShortcutArguments
} from './ms-lnk.mjs';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();

/* Optional built-in node:sqlite (Node >= 22.5 / unflagged in >= 22.13) */
let DatabaseSync = null;
try {
  const req = createRequire(import.meta.url);
  ({ DatabaseSync } = req('node:sqlite'));
} catch {}

/* CLI arguments */
const argv = process.argv.slice(2);
const VERIFY_ONCE = argv.includes('--verify-once');
const RUN_ONCE = VERIFY_ONCE || argv.includes('--once');
const NO_CDP_BOOTSTRAP = process.env.ANTI_CLAUDE_NO_CDP_BOOTSTRAP === '1';

function resolveArgValue(flag) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  return null;
}

const STATE_DIR = path.resolve(
  process.env.ANTI_CLAUDE_STATE_DIR || path.join(HOME, '.gemini', 'antigravity', 'anti-claude')
);
const USER_DIR = path.resolve(
  resolveArgValue('--user-dir') || process.env.ANTI_CLAUDE_USER_DIR || path.join(STATE_DIR, 'user')
);
const PID_FILE = path.join(STATE_DIR, 'daemon.pid');
const UI_PREFS_FILE = path.join(STATE_DIR, 'ui-prefs.json');
const BASE_CONFIG_FILE = path.join(STATE_DIR, 'base', 'config.json');
const CORE_BASE_CSS_FILE = path.join(__dirname, 'base.css');
const CORE_I18N_FILE = path.join(__dirname, 'i18n.json');
const CORE_RUNTIME_FILE = path.join(__dirname, 'runtime.js');
const PKG_FILE = path.join(REPO_ROOT, 'package.json');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DB_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.db$/i;
const PROJECT_RULE_BEGIN = '<!-- BEGIN anti-claude-project -->';
const PROJECT_RULE_END = '<!-- END anti-claude-project -->';
const PROJECT_META_REL = path.join('.anti-claude', 'project-context.json');
const PROJECT_FILES_REL = path.join('.anti-claude', 'files');
const SIDECARS_DIR = path.resolve(
  process.env.ANTI_CLAUDE_SIDECARS_DIR || path.join(HOME, '.gemini', 'config', 'sidecars')
);
const NATIVE_PROJECTS_DIR = path.resolve(
  process.env.ANTI_CLAUDE_NATIVE_PROJECTS_DIR || path.join(HOME, '.gemini', 'config', 'projects')
);
const GLOBAL_SKILLS_DIR = path.resolve(
  process.env.ANTI_CLAUDE_SKILLS_DIR || path.join(HOME, '.gemini', 'config', 'skills')
);
const GLOBAL_AGENTS_DIR = path.resolve(
  process.env.ANTI_CLAUDE_AGENTS_DIR || path.join(HOME, '.gemini', 'config', 'agents')
);
const RESERVED_AGENT_NAMES = new Set(['self', 'browser', 'research', 'deepagent', 'review-agent', 'image-generator']);
const ALLOWED_AGENT_TOOLS = ['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task', 'search_web'];
const ALLOWED_UI_MODULE_KEYS = new Set([
  'i18n',
  'metrics',
  'composerWaxSeal',
  'deadlockHealer',
  'coldBootHealer',
  'zoomShortcuts',
  'customCss',
  'customJs',
  'claudeUxStepUnfold',
  'claudeUxCollapseAnimation',
  'claudeUxRunningTimer',
  'claudeUxContextRing',
  'claudeUxModelMenu',
  'claudeUxInlineUndo',
  'claudeUxFolderStatus',
  'claudeUxRecentSection',
  'claudeUxProjects',
  'claudeUxHideSidebarProjects',
  'claudeUxCustomizations',
  'claudeUxCodeFold',
  'claudeUxOverviewPanel'
]);
const VALID_CJK_SCALES = new Set(['94.5', '95', '100']);
const INLINE_TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.xml',
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go',
  '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.sql', '.sh', '.zsh',
  '.ini', '.conf', '.cfg', '.tex', '.rtf'
]);
const MAX_INLINE_FILE_BYTES = 12 * 1024;
const MAX_INLINE_TOTAL_BYTES = 18 * 1024;

/* Hermetic unit-test shortcut for `--verify-once` */
if (VERIFY_ONCE && (process.env.ANTI_CLAUDE_FAKE_VERIFY_OK === '1' || process.env.ANTI_CLAUDE_FAKE_VERIFY_OK === '0')) {
  const ok = process.env.ANTI_CLAUDE_FAKE_VERIFY_OK === '1';
  console.log(
    JSON.stringify(
      {
        ok,
        fake: true,
        userDir: USER_DIR,
        themeStyle: { present: ok, length: ok ? 1024 : 0 },
        customStyle: { present: ok, length: ok ? 4096 : 0 },
        live: { reachable: ok, port: ok ? 9222 : null, targets: ok ? 1 : 0 }
      },
      null,
      2
    )
  );
  process.exit(ok ? 0 : 1);
}

/* -------------------------------------------------------------------------- */
/* 1. Single-Instance PID Management                                          */
/* -------------------------------------------------------------------------- */

function readProcessCommandLine(pid) {
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
        { encoding: 'utf8', timeout: 3500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
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

export function isOwnDaemonProcess(pid, { commandReader = readProcessCommandLine, killProbe = process.kill } = {}) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  if (num === process.pid) return true;
  try {
    killProbe(num, 0);
  } catch {
    return false;
  }
  const cmd = String(commandReader(num) || '');
  if (!cmd) return false;
  return /(?:^|[\\/ "'])daemon\.mjs(?:\s|$|["'])|anti-claude[\\/]+core[\\/]+daemon\.mjs/i.test(cmd);
}

let pidCleanupBound = false;
function removeOwnPidFile(pidFile = PID_FILE) {
  try {
    if (!fs.existsSync(pidFile)) return;
    const owner = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (owner === process.pid) {
      fs.rmSync(pidFile, { force: true });
    }
  } catch {}
}

const RELAUNCH_INTENT_FILE = path.join(STATE_DIR, 'relaunch-intent.json');
let activeRelaunchPromise = null;
let wakeMacBootstrap = null;
let shuttingDown = false;

export function claimPidFile({
  pidFile = PID_FILE,
  stateDir = STATE_DIR,
  runOnce = RUN_ONCE,
  isDaemonFn = isOwnDaemonProcess,
  killFn = process.kill,
  bindExit = true
} = {}) {
  if (runOnce) return;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    if (fs.existsSync(pidFile)) {
      const prevPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (prevPid > 0 && prevPid !== process.pid && isDaemonFn(prevPid)) {
        try {
          killFn(prevPid, 'SIGTERM');
        } catch {}
      }
    }
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf8');
    if (bindExit && !pidCleanupBound && pidFile === PID_FILE) {
      pidCleanupBound = true;
      process.on('exit', () => {
        stopCuaBrokerSync();
        removeOwnPidFile(PID_FILE);
      });
      for (const sig of ['SIGTERM', 'SIGINT']) {
        process.on(sig, () => {
          if (shuttingDown) return;
          shuttingDown = true;
          const finish = () => {
            removeOwnPidFile(PID_FILE);
            process.exit(0);
          };
          const shutdownTasks = Promise.allSettled([
            stopCuaBroker(),
            ...(activeRelaunchPromise ? [activeRelaunchPromise] : [])
          ]);
          Promise.race([shutdownTasks, new Promise((r) => setTimeout(r, 6000))]).finally(finish);
        });
      }
    }
  } catch {}
}

export function checkPidOwnership({
  pidFile = PID_FILE,
  stateDir = STATE_DIR,
  runOnce = RUN_ONCE,
  isDaemonFn = isOwnDaemonProcess,
  onSuperseded = null
} = {}) {
  if (runOnce) return 'once';
  try {
    if (!fs.existsSync(pidFile)) {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf8');
      return 'reclaimed_missing';
    }
    const owner = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (owner === process.pid) return 'owned';
    if (owner > 0 && isDaemonFn(owner)) {
      if (typeof onSuperseded === 'function') {
        onSuperseded(owner);
        return 'superseded';
      }
      /* A newer verified daemon took over PID_FILE; exit cleanly */
      for (const [, entry] of attachedTargets.entries()) {
        try {
          entry.ws.close();
        } catch {}
      }
      process.exit(0);
    }
    /* Stale or reused non-daemon PID: reclaim ownership rather than exiting */
    fs.writeFileSync(pidFile, `${process.pid}\n`, 'utf8');
    return 'reclaimed_stale';
  } catch {
    return 'error';
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Cross-Platform Endpoint Discovery & macOS 2.33+ Cold-Boot Bootstrap     */
/* -------------------------------------------------------------------------- */

function isWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft|wsl/i.test(os.release()) || fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  } catch {
    return false;
  }
}

function isUncPath(p) {
  const s = String(p || '');
  return s.startsWith('\\\\') || s.startsWith('//') || s.startsWith('/mnt/');
}

let wslGeminiCache = { at: 0, dirs: [], convDirs: [], wslMissing: false };
let wslGeminiRefreshPromise = null;
const SAFE_WSL_DISTRO_RE = /^[a-zA-Z0-9._-]+$/;
const WSL_FS_TIMEOUT_MS = 1500;

function withWslFsTimeout(promise, timeoutMs = WSL_FS_TIMEOUT_MS) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('wsl_fs_timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function refreshWslGeminiDirsBg({
  execFileFn = execFile,
  fsPromises = fs.promises,
  platform = process.platform,
  systemRoot = process.env.SystemRoot || 'C:\\Windows',
  timeoutMs = WSL_FS_TIMEOUT_MS
} = {}) {
  if (platform !== 'win32') return Promise.resolve([]);
  if (wslGeminiRefreshPromise) return wslGeminiRefreshPromise;

  const wslExePath = path.win32.join(systemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const statWithCap = async (p) => {
    try {
      return await withWslFsTimeout(fsPromises.stat(p), timeoutMs);
    } catch {
      return null;
    }
  };

  const runPromise = (async () => {
    const found = [];
    const seen = new Set();
    let wslMissing = false;

    const addCandidateAsync = async (dirPath) => {
      const key = dirPath.toLowerCase();
      if (seen.has(key)) return;
      const st = await statWithCap(dirPath);
      if (!st || !st.isDirectory()) return;
      const convDir = path.join(dirPath, 'antigravity', 'conversations');
      const [convSt, cfgSt] = await Promise.all([
        statWithCap(convDir),
        statWithCap(path.join(dirPath, 'config'))
      ]);
      const hasConv = Boolean(convSt && convSt.isDirectory());
      const hasCfg = Boolean(cfgSt && cfgSt.isDirectory());
      if (!hasConv && !hasCfg) return;
      seen.add(key);
      found.push({
        dir: dirPath,
        convDir: hasConv ? convDir : '',
        score: hasConv ? convSt.mtimeMs : hasCfg ? cfgSt.mtimeMs : 0
      });
    };

    try {
      /* Query only running distros asynchronously so stopped distros and UNC mounts never block the main event loop */
      const buf = await new Promise((resolve, reject) => {
        execFileFn(
          wslExePath,
          ['-l', '-q', '--running'],
          { encoding: 'buffer', timeout: 2500, windowsHide: true },
          (err, stdout) => {
            if (err) return reject(err);
            resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout || ''), 'utf8'));
          }
        );
      });
      const txt = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
      const distros = txt
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((s) => s.replace(/\0/g, '').trim())
        .filter((s) => s && SAFE_WSL_DISTRO_RE.test(s) && !/^docker-desktop/i.test(s));

      for (const distro of distros) {
        const uncBases = [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`];
        let matchedBase = '';
        for (const base of uncBases) {
          const st = await statWithCap(base);
          if (st && st.isDirectory()) {
            matchedBase = base;
            break;
          }
        }
        if (!matchedBase) continue;
        const homeRoot = path.join(matchedBase, 'home');
        try {
          const users = await withWslFsTimeout(fsPromises.readdir(homeRoot, { withFileTypes: true }), timeoutMs);
          for (const u of users) {
            if (!u.isDirectory() || u.name.startsWith('.')) continue;
            await addCandidateAsync(path.join(homeRoot, u.name, '.gemini'));
          }
        } catch {}
        await addCandidateAsync(path.join(matchedBase, 'root', '.gemini'));
      }
      found.sort((a, b) => b.score - a.score);
      const dirs = found.map((x) => x.dir);
      const convDirs = found.map((x) => x.convDir).filter(Boolean);
      wslGeminiCache = { at: Date.now(), dirs, convDirs, wslMissing: false };
    } catch (err) {
      if (err && err.code === 'ENOENT') wslMissing = true;
      wslGeminiCache = {
        at: Date.now(),
        dirs: wslMissing ? [] : wslGeminiCache.dirs,
        convDirs: wslMissing ? [] : wslGeminiCache.convDirs,
        wslMissing
      };
    }
    return wslGeminiCache.dirs;
  })().finally(() => {
    if (wslGeminiRefreshPromise === runPromise) {
      wslGeminiRefreshPromise = null;
    }
  });

  wslGeminiRefreshPromise = runPromise;
  return runPromise;
}

export function discoverWslGeminiDirs({ force = false } = {}) {
  const envRaw = String(process.env.ANTI_CLAUDE_WSL_GEMINI_DIR || '').trim();
  if (envRaw) {
    return envRaw
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => {
        if (!s) return false;
        try {
          const st = fs.statSync(s, { throwIfNoEntry: false });
          return Boolean(st && st.isDirectory());
        } catch {
          return false;
        }
      });
  }
  if (process.platform !== 'win32') return [];
  const now = Date.now();
  const ttl = wslGeminiCache.wslMissing ? 300000 : wslGeminiCache.dirs.length > 0 ? 30000 : 120000;
  if (force || wslGeminiCache.at === 0 || now - wslGeminiCache.at >= ttl) {
    void refreshWslGeminiDirsBg();
  }
  return wslGeminiCache.dirs;
}

function discoverWslConversationsDirs() {
  const envRaw = String(process.env.ANTI_CLAUDE_WSL_GEMINI_DIR || '').trim();
  if (envRaw) {
    const out = [];
    for (const gDir of discoverWslGeminiDirs()) {
      const conv = path.join(gDir, 'antigravity', 'conversations');
      try {
        const st = fs.statSync(conv, { throwIfNoEntry: false });
        if (st && st.isDirectory()) out.push(conv);
      } catch {}
    }
    return out;
  }
  discoverWslGeminiDirs();
  return wslGeminiCache.convDirs;
}

export function resolveConversationDirForCascade(cascadeId, conversationsDirOrList) {
  const dirs = (Array.isArray(conversationsDirOrList) ? conversationsDirOrList : [conversationsDirOrList])
    .filter((d) => typeof d === 'string' && d.trim());
  if (!dirs.length) return '';
  if (!cascadeId || !UUID_RE.test(cascadeId)) return dirs[0];
  let bestDir = '';
  let bestMtime = -1;
  const seen = new Set();
  for (const dir of dirs) {
    const key = CASE_INSENSITIVE_FS ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = getDbStatByPath(path.join(dir, `${cascadeId}.db`));
    if (info && info.mtimeMs > bestMtime) {
      bestMtime = info.mtimeMs;
      bestDir = dir;
    }
  }
  return bestDir || dirs[0];
}

function discoverEndpoints() {
  const endpoints = [];
  const defaultConvDir = path.join(HOME, '.gemini', 'antigravity', 'conversations');

  if (process.platform === 'darwin') {
    endpoints.push({
      channel: 'darwin',
      portFile: path.join(HOME, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
      fallbackPort: 9222,
      conversationsDir: defaultConvDir
    });
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    endpoints.push({
      channel: 'win32',
      portFile: path.join(appData, 'Antigravity', 'DevToolsActivePort'),
      fallbackPort: 9222,
      conversationsDir: defaultConvDir
    });
  } else {
    endpoints.push({
      channel: 'linux',
      portFile: path.join(HOME, '.config', 'Antigravity', 'DevToolsActivePort'),
      fallbackPort: 9222,
      conversationsDir: defaultConvDir
    });
    if (isWsl()) {
      try {
        const usersDir = '/mnt/c/Users';
        if (fs.existsSync(usersDir)) {
          for (const u of fs.readdirSync(usersDir)) {
            if (/^(Public|Default|Default User|All Users)$/i.test(u)) continue;
            const winPort = path.join(usersDir, u, 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort');
            if (fs.existsSync(path.dirname(winPort))) {
              const winConv = path.join(usersDir, u, '.gemini', 'antigravity', 'conversations');
              const hasWinConv = fs.existsSync(winConv);
              endpoints.push({
                channel: `wsl:${u}`,
                portFile: winPort,
                fallbackPort: 9222,
                conversationsDir: hasWinConv ? winConv : defaultConvDir,
                extraConversationsDirs: hasWinConv && winConv !== defaultConvDir ? [defaultConvDir] : []
              });
            }
          }
        }
      } catch {}
    }
  }
  return endpoints;
}

function readPort(portFile) {
  try {
    if (!portFile || !fs.existsSync(portFile)) return 0;
    const first = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0];
    const p = parseInt(first, 10);
    return p > 0 && p < 65536 ? p : 0;
  } catch {
    return 0;
  }
}

function hasRecentConversationWalActivity(conversationsDir, withinMs = 15000) {
  try {
    if (!fs.existsSync(conversationsDir)) return false;
    const now = Date.now();
    for (const name of fs.readdirSync(conversationsDir)) {
      if (!name.endsWith('.db-wal')) continue;
      const st = fs.statSync(path.join(conversationsDir, name), { throwIfNoEntry: false });
      if (st && st.size > 0 && now - st.mtimeMs < withinMs) return true;
    }
  } catch {}
  return false;
}

/**
 * Wait for a terminated Antigravity process to exit and release its Electron `SingletonLock`,
 * checking both lock release and replacement processes across bounded retries so delayed lock
 * cleanup (e.g. ~900ms) never leaves the app closed.
 */
export async function waitForMacRelaunchReady({
  targetPid,
  isProcessAlive,
  listMainProcs,
  hasLock,
  tryClearStaleLock = () => false,
  onReadyToOpen,
  nowFn = () => Date.now(),
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  exitTimeoutMs = 8000,
  lockTimeoutMs = 6000,
  pollMs = 120,
  initialSettleMs = 350
}) {
  const exitDeadline = nowFn() + exitTimeoutMs;
  await sleepFn(pollMs);
  while (isProcessAlive(targetPid)) {
    if (nowFn() >= exitDeadline) {
      return { relaunched: false, reason: 'exit_timeout' };
    }
    await sleepFn(pollMs);
  }

  /* Allow launchservicesd ASN teardown to settle, then poll for SingletonLock release or takeover */
  if (initialSettleMs > 0) {
    await sleepFn(initialSettleMs);
  }

  const lockDeadline = nowFn() + lockTimeoutMs;
  while (true) {
    const afterProcs = await listMainProcs();
    if (Array.isArray(afterProcs) && afterProcs.length > 0) {
      return { relaunched: false, reason: 'replaced_by_other_instance' };
    }
    if (!hasLock()) {
      await onReadyToOpen();
      return { relaunched: true };
    }
    if (nowFn() >= lockDeadline) {
      if (tryClearStaleLock(targetPid) && !hasLock()) {
        await onReadyToOpen();
        return { relaunched: true, staleLockCleared: true };
      }
      return { relaunched: false, reason: 'singleton_lock_held' };
    }
    await sleepFn(pollMs);
  }
}

/**
 * Antigravity 2.33.0+ stopped appending `--remote-debugging-port=0` by default in C++.
 * Modifying `/Applications/Antigravity.app` breaks Google's Developer ID code signature
 * and blocks Squirrel.Mac auto-updates. Instead, when a fresh cold launch or in-app restart (`<= 35s` old)
 * starts without `--remote-debugging-port`, gracefully relaunch it with `--args --remote-debugging-port=0`.
 */
function startMacCdpBootstrap() {
  if (process.platform !== 'darwin' || RUN_ONCE || NO_CDP_BOOTSTRAP) return;
  const appDataDir = path.join(HOME, 'Library', 'Application Support', 'Antigravity');
  const portFile = path.join(appDataDir, 'DevToolsActivePort');
  const singletonLock = path.join(appDataDir, 'SingletonLock');
  const convDir = path.join(HOME, '.gemini', 'antigravity', 'conversations');
  const candidateApps = [
    '/Applications/Antigravity.app',
    path.join(HOME, 'Applications', 'Antigravity.app')
  ];
  let busy = false;
  let lastAttemptAt = 0;
  const attemptedPids = new Map();
  let recentAttempts = [];

  const parseEtimeSec = (raw) => {
    const s = String(raw || '').trim();
    let days = 0;
    let rest = s;
    if (s.includes('-')) {
      const [d, r] = s.split('-', 2);
      days = parseInt(d, 10) || 0;
      rest = r;
    }
    const parts = rest.split(':').map((x) => parseInt(x, 10) || 0);
    if (parts.length === 3) return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return days * 86400 + parts[0] * 60 + parts[1];
    return Infinity;
  };

  const parseLaunchExtraArgs = (cmd, mainBin) => {
    const rest = String(cmd || '').slice(mainBin.length).trim();
    if (!rest) return { extraArgs: [], hasCustomProfile: false, hasAmbiguousArgs: false };
    const tokens = rest.split(/\s+/).filter(Boolean);
    const extraArgs = [];
    let hasCustomProfile = false;
    let hasAmbiguousArgs = false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^-psn_/.test(tok)) continue;
      if (/^--remote-debugging-port(?:=|$)/.test(tok)) {
        if (!tok.includes('=') && i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) i += 1;
        continue;
      }
      if (/^--(user-data-dir|extensions-dir|profile-directory)(?:=|$)/.test(tok)) {
        hasCustomProfile = true;
        continue;
      }
      if (tok.startsWith('-')) {
        extraArgs.push(tok);
      } else if (fs.existsSync(tok)) {
        extraArgs.push(tok);
      } else {
        /* Space-containing path or non-flag argument that `ps` flattens without quoting */
        hasAmbiguousArgs = true;
      }
    }
    return { extraArgs, hasCustomProfile, hasAmbiguousArgs };
  };

  const parseMainProcesses = (stdout) => {
    const list = [];
    for (const line of String(stdout || '').split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
      if (!m) continue;
      const pid = Number(m[1]);
      const age = parseEtimeSec(m[2]);
      const cmd = m[3];
      for (const appBundle of candidateApps) {
        const mainBin = path.join(appBundle, 'Contents', 'MacOS', 'Antigravity');
        if (cmd === mainBin || cmd.startsWith(mainBin + ' ')) {
          const argInfo = parseLaunchExtraArgs(cmd, mainBin);
          list.push({
            pid,
            age,
            appBundle,
            hasCdp: cmd.includes('--remote-debugging-port'),
            ...argInfo
          });
          break;
        }
      }
    }
    return list;
  };

  const hasSingletonLock = () => {
    try {
      fs.lstatSync(singletonLock);
      return true;
    } catch {
      return false;
    }
  };

  const tryClearStaleSingletonLock = (expectedDeadPid) => {
    try {
      const linkTarget = fs.readlinkSync(singletonLock);
      const m = String(linkTarget || '').match(/-(\d+)$/);
      if (!m) return false;
      const lockPid = Number(m[1]);
      if (!lockPid) return false;
      if (lockPid !== expectedDeadPid) {
        try {
          process.kill(lockPid, 0);
          return false;
        } catch {}
      }
      fs.rmSync(singletonLock, { force: true });
      return true;
    } catch {
      return false;
    }
  };

  const psEnv = Object.assign({}, process.env);
  delete psEnv.COLUMNS;

  const queryMainProcs = () =>
    new Promise((resolve) => {
      execFile(
        'ps',
        ['-axww', '-o', 'pid=,etime=,command='],
        { timeout: 2500, maxBuffer: 16 * 1024 * 1024, env: psEnv },
        (err, stdout) => {
          resolve(!err && stdout ? parseMainProcesses(stdout) : []);
        }
      );
    });

  const waitPortAndSync = (triesLeft = 40) => {
    if (readPort(portFile) > 0) {
      sync().catch(() => {});
      return;
    }
    if (triesLeft > 0) {
      setTimeout(() => waitPortAndSync(triesLeft - 1), 150).unref();
    }
  };

  const openAppWithRetry = async (appBundle, extraArgs = []) => {
    try {
      fs.rmSync(portFile, { force: true });
    } catch {}
    const launchArgs = [...extraArgs, '--remote-debugging-port=0'];
    const attempts = [
      ['-n', '-a', appBundle, '--args', ...launchArgs],
      ['-n', '-a', appBundle, '--args', ...launchArgs],
      ['-a', appBundle, '--args', ...launchArgs]
    ];
    for (let i = 0; i < attempts.length; i++) {
      const err = await new Promise((resolve) => {
        execFile('/usr/bin/open', attempts[i], { timeout: 10000 }, (e) => resolve(e || null));
      });
      if (!err) {
        waitPortAndSync(40);
        return true;
      }
      console.warn(`[Anti-Claude Daemon] open attempt ${i + 1} failed for ${appBundle}: ${err.message || err}`);
      if (i < attempts.length - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    return false;
  };

  const clearRelaunchIntent = () => {
    try {
      fs.rmSync(RELAUNCH_INTENT_FILE, { force: true });
    } catch {}
  };

  const recoverInterruptedRelaunch = async () => {
    const intent = readJsonOrFallback(RELAUNCH_INTENT_FILE, null);
    if (!intent || typeof intent.startedAt !== 'number') return;
    clearRelaunchIntent();
    if (Date.now() - intent.startedAt > 30000) return;
    const procs = await queryMainProcs();
    if (procs.length > 0) return;
    const bundle =
      (typeof intent.appBundle === 'string' && fs.existsSync(intent.appBundle) && intent.appBundle) ||
      candidateApps.find((p) => fs.existsSync(p)) ||
      candidateApps[0];
    console.log(`[Anti-Claude Daemon] Recovering interrupted relaunch for ${bundle}`);
    await openAppWithRetry(bundle, Array.isArray(intent.extraArgs) ? intent.extraArgs : []);
  };

  let emptyStreak = 0;
  let pollTimer = null;

  const scheduleNext = (delayMs) => {
    if (shuttingDown) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(checkFreshLaunch, delayMs);
    pollTimer.unref?.();
  };

  wakeMacBootstrap = () => {
    emptyStreak = 0;
    if (!busy && !shuttingDown) scheduleNext(750);
  };

  const computeNextDelay = (procs) => {
    if (!activeConfig.enabled || attachedTargets.size > 0) return 15000;
    if (procs.some((p) => p.hasCdp)) return 6000;
    if (procs.length === 0) {
      emptyStreak = Math.min(emptyStreak + 1, 6);
      if (emptyStreak <= 2) return 1200;
      if (emptyStreak <= 4) return 2200;
      return 3500;
    }
    emptyStreak = 0;
    return 750;
  };

  const checkFreshLaunch = () => {
    if (busy || shuttingDown) return;
    rebuildBundleIfNeeded();
    if (!activeConfig.enabled) {
      scheduleNext(15000);
      return;
    }
    if (attachedTargets.size > 0) {
      scheduleNext(15000);
      return;
    }
    const now = Date.now();
    if (now - lastAttemptAt < 2500) {
      scheduleNext(1000);
      return;
    }

    for (const [pid, ts] of attemptedPids.entries()) {
      if (now - ts > 120000) attemptedPids.delete(pid);
    }
    recentAttempts = recentAttempts.filter((ts) => now - ts < 45000);
    if (recentAttempts.length >= 3) {
      scheduleNext(5000);
      return;
    }

    busy = true;
    queryMainProcs().then(async (procs) => {
      let nextDelay = computeNextDelay(procs);
      try {
        if (procs.some((p) => p.hasCdp)) {
          if (readPort(portFile) > 0 && attachedTargets.size === 0) {
            sync().catch(() => {});
          }
          return;
        }

        /* Do not kill newly spawned child/helper processes when an established non-CDP main instance (>35s) already exists */
        if (procs.some((p) => !p.hasCdp && p.age > 35)) {
          nextDelay = 10000;
          return;
        }

        const candidate = procs.find((p) => !p.hasCdp && !attemptedPids.has(p.pid) && p.age <= 35);
        if (!candidate) return;
        /* Avoid killing a process with custom profile/user-data-dir or ambiguous unquoted CLI path args */
        if (candidate.hasCustomProfile || candidate.hasAmbiguousArgs) {
          attemptedPids.set(candidate.pid, Date.now());
          console.log(`[Anti-Claude Daemon] Skipping auto-relaunch for PID ${candidate.pid} (custom launch arguments detected)`);
          return;
        }
        /* Let age=0 processes finish initial startup config writes before sending SIGTERM */
        if (candidate.age < 1) {
          nextDelay = 900;
          return;
        }
        if (candidate.age > 15 && hasRecentConversationWalActivity(convDir, 8000)) return;

        const targetPid = candidate.pid;
        const appBundle = candidate.appBundle || candidateApps.find((p) => fs.existsSync(p)) || candidateApps[0];
        const extraArgs = Array.isArray(candidate.extraArgs) ? candidate.extraArgs : [];
        const startTs = Date.now();
        lastAttemptAt = startTs;
        attemptedPids.set(targetPid, startTs);
        recentAttempts.push(startTs);
        console.log(
          `[Anti-Claude Daemon] Relaunching fresh Antigravity (PID ${targetPid}, age=${candidate.age}s) with --remote-debugging-port=0`
        );

        const doRelaunch = async () => {
          try {
            writeAtomicUtf8(
              RELAUNCH_INTENT_FILE,
              `${JSON.stringify({ targetPid, appBundle, extraArgs, startedAt: Date.now() })}\n`
            );
          } catch {}

          try {
            process.kill(targetPid, 'SIGTERM');
          } catch {
            clearRelaunchIntent();
            return;
          }

          const isPidAlive = (pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          };

          let outcome = await waitForMacRelaunchReady({
            targetPid,
            isProcessAlive: isPidAlive,
            listMainProcs: queryMainProcs,
            hasLock: hasSingletonLock,
            tryClearStaleLock: tryClearStaleSingletonLock,
            onReadyToOpen: () => openAppWithRetry(appBundle, extraArgs)
          });

          if (!outcome.relaunched && outcome.reason === 'exit_timeout') {
            /* Grace re-check in case SIGTERM completed right after timeout */
            await new Promise((r) => setTimeout(r, 1500));
            if (!isPidAlive(targetPid)) {
              const lingering = await queryMainProcs();
              if (lingering.length === 0) {
                if (hasSingletonLock()) tryClearStaleSingletonLock(targetPid);
                if (!hasSingletonLock()) {
                  await openAppWithRetry(appBundle, extraArgs);
                  outcome = { relaunched: true, lateExitRecovered: true };
                }
              }
            }
          } else if (!outcome.relaunched && outcome.reason === 'singleton_lock_held') {
            await new Promise((r) => setTimeout(r, 1500));
            const lingering = await queryMainProcs();
            if (lingering.length === 0 && tryClearStaleSingletonLock(targetPid) && !hasSingletonLock()) {
              await openAppWithRetry(appBundle, extraArgs);
              outcome = { relaunched: true, staleLockCleared: true };
            }
          }

          clearRelaunchIntent();
          if (!outcome.relaunched) {
            console.warn(
              `[Anti-Claude Daemon] Relaunch did not complete for PID ${targetPid} (reason=${outcome.reason || 'unknown'})`
            );
          }
        };

        activeRelaunchPromise = doRelaunch().finally(() => {
          activeRelaunchPromise = null;
        });
        await activeRelaunchPromise;
        nextDelay = 1200;
      } finally {
        busy = false;
        scheduleNext(nextDelay);
      }
    });
  };

  recoverInterruptedRelaunch()
    .catch(() => {})
    .finally(() => checkFreshLaunch());
}

/* -------------------------------------------------------------------------- */
/* 3. Config & Bundle Hot-Reload Compiler                                     */
/* -------------------------------------------------------------------------- */

function statSig(p) {
  try {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    return st ? `${st.size}:${Math.floor(st.mtimeMs)}` : 'missing';
  } catch {
    return 'missing';
  }
}

function readTextOrEmpty(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function readJsonOrFallback(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

let lastBundleFilesSig = '';
let cachedRuntimeTemplate = '';
let cachedBootPayloadBase = null;
let cachedBundleHash = '';
let cachedVersion = '3.0.2';
let activeConfig = {
  enabled: true,
  contextLimit: 256000,
  contextLimitOverride: 0,
  modules: {},
  endpoints: []
};

function sanitizeUiPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const modules = {};
  if (raw.modules && typeof raw.modules === 'object' && !Array.isArray(raw.modules)) {
    for (const [k, v] of Object.entries(raw.modules)) {
      if (ALLOWED_UI_MODULE_KEYS.has(k) && typeof v === 'boolean') {
        modules[k] = v;
      }
    }
  }
  const rawScale = String(raw.cjkFontScale ?? '').trim().replace(/%$/, '');
  const cjkFontScale = VALID_CJK_SCALES.has(rawScale) ? rawScale : null;
  const uiState = {};
  if (raw.uiState && typeof raw.uiState === 'object' && !Array.isArray(raw.uiState)) {
    if (typeof raw.uiState.recentCollapsed === 'boolean') {
      uiState.recentCollapsed = raw.uiState.recentCollapsed;
    }
    if (typeof raw.uiState.unifiedRecentCollapsed === 'boolean') {
      uiState.unifiedRecentCollapsed = raw.uiState.unifiedRecentCollapsed;
    }
  }
  const updatedAt = Number(raw.updatedAt) > 0 ? Math.floor(Number(raw.updatedAt)) : 0;
  return { modules, cjkFontScale, uiState, updatedAt };
}

function resolveEffectiveUserConfig(userConfigFile, rawCfg) {
  const baseObj = rawCfg && typeof rawCfg === 'object' && !Array.isArray(rawCfg) ? rawCfg : {};
  const prefs = sanitizeUiPrefs(readJsonOrFallback(UI_PREFS_FILE, null));
  if (!prefs) return baseObj;

  let manualConfigNewer = false;
  if (prefs.updatedAt > 0) {
    try {
      const st = fs.statSync(userConfigFile, { throwIfNoEntry: false });
      if (st && st.mtimeMs > prefs.updatedAt + 500) {
        const userRaw = readTextOrEmpty(userConfigFile);
        const baseRaw = readTextOrEmpty(BASE_CONFIG_FILE);
        if (userRaw && userRaw !== baseRaw) {
          manualConfigNewer = true;
        }
      }
    } catch {}
  }

  const rawMods = baseObj.modules && typeof baseObj.modules === 'object' ? baseObj.modules : {};
  const mergedModules = manualConfigNewer
    ? Object.assign({}, prefs.modules, rawMods)
    : Object.assign({}, rawMods, prefs.modules);
  const mergedUiState = Object.assign(
    {},
    baseObj.uiState && typeof baseObj.uiState === 'object' ? baseObj.uiState : {},
    prefs.uiState
  );
  const out = Object.assign({}, baseObj, {
    modules: mergedModules,
    uiState: mergedUiState,
    uiPrefsUpdatedAt: prefs.updatedAt || Date.now()
  });
  if (prefs.cjkFontScale && (!manualConfigNewer || !baseObj.cjkFontScale)) {
    out.cjkFontScale = prefs.cjkFontScale;
  }
  return out;
}

export function saveUiPrefs(payload) {
  const cur = sanitizeUiPrefs(readJsonOrFallback(UI_PREFS_FILE, null)) || {
    modules: {},
    cjkFontScale: null,
    uiState: {},
    updatedAt: 0
  };
  const incoming = sanitizeUiPrefs(payload) || {
    modules: {},
    cjkFontScale: null,
    uiState: {},
    updatedAt: 0
  };
  const updatedAt = Math.max(Date.now(), cur.updatedAt + 1, incoming.updatedAt);
  const next = {
    schema: 1,
    updatedAt,
    modules: Object.assign({}, cur.modules, incoming.modules),
    ...(incoming.cjkFontScale || cur.cjkFontScale
      ? { cjkFontScale: incoming.cjkFontScale || cur.cjkFontScale }
      : {}),
    uiState: Object.assign({}, cur.uiState, incoming.uiState)
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  writeAtomicUtf8(UI_PREFS_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return {
    ok: true,
    updatedAt,
    modules: next.modules,
    cjkFontScale: next.cjkFontScale || null,
    uiState: next.uiState
  };
}

function wrapSafeExtensionJs(filePath, rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return '';
  const name = path.basename(filePath);
  try {
    // Pre-compile syntax check so a broken extension never breaks user/custom.js or other extensions
    new vm.Script(code, { filename: name });
  } catch (err) {
    console.error(`[Anti-Claude Daemon] Skipped extension ${name} (syntax error): ${err?.message || err}`);
    return '';
  }
  return `\n;try {\n(function(){\n${code}\n})();\n} catch (__agExtErr) { console.error('[Anti-Claude ext]', ${JSON.stringify(name)}, __agExtErr); }\n`;
}

function listUserExtensionFiles(extDir) {
  const cssFiles = [];
  const jsFiles = [];
  try {
    const entries = fs.readdirSync(extDir, { withFileTypes: true })
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of entries) {
      const fp = path.join(extDir, name);
      if (/\.css$/i.test(name)) cssFiles.push(fp);
      else if (/\.js$/i.test(name)) jsFiles.push(fp);
    }
  } catch {}
  return { cssFiles, jsFiles };
}

function rebuildBundleIfNeeded() {
  const userConfigFile = path.join(USER_DIR, 'config.json');
  const userCssFile = path.join(USER_DIR, 'custom.css');
  const userJsFile = path.join(USER_DIR, 'custom.js');
  const userI18nFile = path.join(USER_DIR, 'i18n.override.json');
  const userExtDir = path.join(USER_DIR, 'extensions');
  const extFiles = listUserExtensionFiles(userExtDir);

  const filesSig = [
    statSig(PKG_FILE),
    statSig(CORE_BASE_CSS_FILE),
    statSig(CORE_I18N_FILE),
    statSig(CORE_RUNTIME_FILE),
    statSig(userConfigFile),
    statSig(UI_PREFS_FILE),
    statSig(userCssFile),
    statSig(userJsFile),
    statSig(userI18nFile),
    ...extFiles.cssFiles.map((f) => `${path.basename(f)}:${statSig(f)}`),
    ...extFiles.jsFiles.map((f) => `${path.basename(f)}:${statSig(f)}`)
  ].join('|');

  const endpoints = discoverEndpoints();
  activeConfig.endpoints = endpoints;

  if (filesSig === lastBundleFilesSig && cachedBootPayloadBase) {
    return false;
  }
  lastBundleFilesSig = filesSig;

  const pkg = readJsonOrFallback(PKG_FILE, {});
  cachedVersion = pkg?.version ? `anti-claude-${pkg.version}` : 'anti-claude-3.0.2';

  const diskCfg = readJsonOrFallback(userConfigFile, {});
  const rawCfg = resolveEffectiveUserConfig(userConfigFile, diskCfg);
  const enabled = rawCfg?.enabled !== false;
  const modules = Object.assign(
    {
      i18n: false,
      metrics: true,
      zoomShortcuts: true,
      customCss: true,
      customJs: true
    },
    rawCfg?.modules || {}
  );
  const themeVars = rawCfg?.themeVars && typeof rawCfg.themeVars === 'object' ? rawCfg.themeVars : {};
  const darkThemeVars = rawCfg?.darkThemeVars && typeof rawCfg.darkThemeVars === 'object' ? rawCfg.darkThemeVars : {};

  const coreDict = readJsonOrFallback(CORE_I18N_FILE, {});
  const overrideDict = readJsonOrFallback(userI18nFile, {});
  const mergedDict = Object.assign({}, coreDict, overrideDict);
  delete mergedDict._comment;

  const baseCss = readTextOrEmpty(CORE_BASE_CSS_FILE);
  const extCssChunks = extFiles.cssFiles.map((f) => readTextOrEmpty(f)).filter(Boolean);
  const extJsChunks = extFiles.jsFiles.map((f) => wrapSafeExtensionJs(f, readTextOrEmpty(f))).filter(Boolean);
  const customCss = [readTextOrEmpty(userCssFile), ...extCssChunks].filter(Boolean).join('\n\n');
  const customJs = [readTextOrEmpty(userJsFile), ...extJsChunks].filter(Boolean).join('\n');
  cachedRuntimeTemplate = readTextOrEmpty(CORE_RUNTIME_FILE);

  activeConfig = {
    enabled,
    contextLimit: Number(rawCfg?.contextLimit) > 0 ? Number(rawCfg.contextLimit) : 256000,
    contextLimitOverride: Number(rawCfg?.contextLimitOverride) > 0 ? Number(rawCfg.contextLimitOverride) : 0,
    modules,
    endpoints
  };

  cachedBootPayloadBase = {
    version: cachedVersion,
    platform: process.platform,
    enabled,
    config: rawCfg || {},
    modules,
    themeVars,
    darkThemeVars,
    cssText: baseCss,
    customCss,
    customJs,
    dict: mergedDict
  };

  cachedBundleHash = crypto
    .createHash('sha1')
    .update(JSON.stringify(cachedBootPayloadBase))
    .update(cachedRuntimeTemplate)
    .digest('hex')
    .slice(0, 12);

  return true;
}

function buildRuntimeScript(hostThemeMode = null, rpcToken = '', rpcSessionId = '') {
  if (!cachedRuntimeTemplate || !cachedBootPayloadBase) return '';
  const extra = {};
  if (hostThemeMode) extra.hostThemeMode = hostThemeMode;
  if (rpcToken) extra.rpcToken = rpcToken;
  if (rpcSessionId) extra.rpcSessionId = rpcSessionId;
  const payload = Object.keys(extra).length > 0 ? Object.assign({}, cachedBootPayloadBase, extra) : cachedBootPayloadBase;
  return cachedRuntimeTemplate.replace('(__AG_BOOT_PAYLOAD__);', () => `(${JSON.stringify(payload)});`);
}

/* -------------------------------------------------------------------------- */
/* 4. Read-Only SQLite & Protobuf Conversation Metrics Engine                 */
/* -------------------------------------------------------------------------- */

function parseProto(buf) {
  const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf || []);
  const out = new Map();
  let pos = 0;
  const len = bytes.length;

  const readVarint = () => {
    let result = 0;
    let shift = 0;
    while (pos < len) {
      const b = bytes[pos++];
      result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 53) {
        while (pos < len && (bytes[pos++] & 0x80) !== 0) {}
        return result;
      }
    }
    return result;
  };

  while (pos < len) {
    const tag = readVarint();
    if (!tag) break;
    const fieldNo = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === 0) {
      out.set(fieldNo, readVarint());
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 2) {
      const subLen = readVarint();
      if (subLen < 0 || pos + subLen > len) break;
      out.set(fieldNo, bytes.subarray(pos, pos + subLen));
      pos += subLen;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return out;
}

function readUtf8(val) {
  if (!(val instanceof Uint8Array)) return '';
  return Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('utf8');
}

function fmtTok(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function formatContextCeiling(tokens) {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  return `${Math.round(tokens / 1_000)}k`;
}

function getDbStatByPath(dbPath) {
  try {
    const st = fs.statSync(dbPath, { throwIfNoEntry: false });
    if (!st) return null;
    const wst = fs.statSync(`${dbPath}-wal`, { throwIfNoEntry: false });
    const walSig = wst ? `${wst.size}:${Math.floor(wst.mtimeMs)}` : '0:0';
    return {
      dbPath,
      mtimeMs: Math.max(st.mtimeMs, wst ? wst.mtimeMs : 0),
      sig: `${st.size}:${Math.floor(st.mtimeMs)}|${walSig}`
    };
  } catch {
    return null;
  }
}

let tmpSeq = 0;
function withReadOnlyDb(dbPath, timeoutMs, fn) {
  if (!isUncPath(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: timeoutMs });
    try {
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {}
    }
  }
  tmpSeq = (tmpSeq + 1) % 100000;
  const tmpBase = path.join(os.tmpdir(), `ac-wsl-sqlite-${process.pid}-${Date.now()}-${tmpSeq}.db`);
  let tmpDb = null;
  try {
    fs.copyFileSync(dbPath, tmpBase);
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      try {
        fs.copyFileSync(walPath, `${tmpBase}-wal`);
      } catch {}
    }
    tmpDb = new DatabaseSync(tmpBase, { readOnly: true, timeout: timeoutMs });
    return fn(tmpDb);
  } finally {
    try {
      tmpDb?.close();
    } catch {}
    for (const sfx of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(`${tmpBase}${sfx}`, { force: true });
      } catch {}
    }
  }
}

function parseGenMetadataRow(r) {
  const top = parseProto(r.data);
  const chatRaw = top.get(1);
  const chat = chatRaw instanceof Uint8Array ? parseProto(chatRaw) : new Map();
  const usageRaw = chat.get(4);
  const usage = usageRaw instanceof Uint8Array ? parseProto(usageRaw) : new Map();
  const chatStartRaw = chat.get(9);
  const chatStart = chatStartRaw instanceof Uint8Array ? parseProto(chatStartRaw) : new Map();
  const ctxWinRaw = chatStart.get(10);
  const ctxWin = ctxWinRaw instanceof Uint8Array ? parseProto(ctxWinRaw) : new Map();
  const maxCtx = ctxWin.get(4) || 0;
  const ttftRaw = chat.get(11);
  const ttftMap = ttftRaw instanceof Uint8Array ? parseProto(ttftRaw) : new Map();
  const streamRaw = chat.get(12);
  const streamMap = streamRaw instanceof Uint8Array ? parseProto(streamRaw) : new Map();

  const inTok = usage.get(2) || 0;
  const outTok = usage.get(3) || 0;
  const cacheRead = usage.get(5) || 0;
  const thinkTok = usage.get(9) || 0;
  const respTok = usage.get(10) || 0;
  const ttft = (ttftMap.get(1) || 0) + (ttftMap.get(2) || 0) / 1e9;
  const stream = (streamMap.get(1) || 0) + (streamMap.get(2) || 0) / 1e9;

  return {
    idx: r.idx,
    inTok,
    outTok,
    cacheRead,
    ctx: inTok + cacheRead,
    maxCtx,
    thinkTok,
    respTok,
    ttft,
    stream,
    totDur: ttft + stream
  };
}

const lineageCacheByDir = new Map();
const childScalarCache = new Map();
const metricsPayloadCache = new Map();

function setBounded(map, key, val, max = 128) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

function getDescendantIds(cascadeId, conversationsDir) {
  if (!DatabaseSync || !conversationsDir) return [];
  let dirState = lineageCacheByDir.get(conversationsDir);
  if (!dirState) {
    dirState = { dirMtimeMs: -1, nodes: new Map() };
    lineageCacheByDir.set(conversationsDir, dirState);
  }
  const st = fs.statSync(conversationsDir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return [];

  if (st.mtimeMs !== dirState.dirMtimeMs) {
    let entries = [];
    try {
      entries = fs.readdirSync(conversationsDir);
    } catch {
      return [];
    }
    const seen = new Set();
    const uncMode = isUncPath(conversationsDir);
    const maxBatchOpens = uncMode ? 6 : 20;
    const candidates = [];
    for (const name of entries) {
      const m = name.match(DB_FILE_RE);
      if (!m) continue;
      const uuid = m[1];
      seen.add(uuid);
      const existing = dirState.nodes.get(uuid);
      if (existing?.hasMeta) continue;
      const dbPath = path.join(conversationsDir, name);
      const info = getDbStatByPath(dbPath);
      if (!info || (existing && existing.sig === info.sig)) continue;
      candidates.push({ uuid, dbPath, info });
    }
    if (uncMode && candidates.length > maxBatchOpens) {
      candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    }
    let opens = 0;
    for (const item of candidates) {
      if (opens >= maxBatchOpens) break;
      opens += 1;
      try {
        const metaRes = withReadOnlyDb(item.dbPath, 20, (db) => {
          const row = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
          if (!row?.data) return { hasMeta: false, parentId: '', rootId: '' };
          const meta = parseProto(row.data);
          return {
            hasMeta: true,
            parentId: readUtf8(meta.get(5)).trim(),
            rootId: readUtf8(meta.get(6)).trim()
          };
        });
        dirState.nodes.set(item.uuid, { ...metaRes, sig: item.info.sig });
      } catch {
        dirState.nodes.set(item.uuid, { hasMeta: false, parentId: '', rootId: '', sig: item.info.sig });
      }
    }
    for (const id of Array.from(dirState.nodes.keys())) {
      if (!seen.has(id)) dirState.nodes.delete(id);
    }
    if (opens < maxBatchOpens) dirState.dirMtimeMs = st.mtimeMs;
  }

  const byParent = new Map();
  const direct = new Set();
  for (const [uuid, node] of dirState.nodes.entries()) {
    if (node.parentId) {
      let s = byParent.get(node.parentId);
      if (!s) {
        s = new Set();
        byParent.set(node.parentId, s);
      }
      s.add(uuid);
    }
    if (node.rootId === cascadeId && uuid !== cascadeId) direct.add(uuid);
  }
  const pSet = byParent.get(cascadeId);
  if (pSet) for (const id of pSet) if (id !== cascadeId) direct.add(id);

  const queue = Array.from(direct);
  const visited = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const next = byParent.get(queue[i]);
    if (!next) continue;
    for (const id of next) {
      if (id !== cascadeId && !visited.has(id)) {
        visited.add(id);
        queue.push(id);
      }
    }
  }
  return queue.sort();
}

function readChildMetrics(childId, conversationsDir) {
  const dbPath = path.join(conversationsDir, `${childId}.db`);
  const info = getDbStatByPath(dbPath);
  if (!info) return null;
  const cached = childScalarCache.get(dbPath);
  if (cached && cached.sig === info.sig) return cached;
  try {
    const entry = withReadOnlyDb(dbPath, 30, (db) => {
      const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      let calls = 0;
      let totalIn = 0;
      let totalCache = 0;
      let totalOut = 0;
      for (let i = 0; i < rows.length; i++) {
        const p = parseGenMetadataRow(rows[i]);
        if (p.ctx > 0 || p.outTok > 0) {
          calls += 1;
          totalIn += p.inTok;
          totalCache += p.cacheRead;
          totalOut += p.outTok;
        }
      }
      return { sig: info.sig, hasData: calls > 0, calls, totalIn, totalCache, totalOut };
    });
    setBounded(childScalarCache, dbPath, entry, 256);
    return entry;
  } catch {
    return cached || null;
  }
}

function readSubagentSummaries(descendantIds, conversationsDir) {
  if (!DatabaseSync || !Array.isArray(descendantIds) || !descendantIds.length || !conversationsDir) return [];
  const sumDbPath = path.join(path.dirname(conversationsDir), 'conversation_summaries.db');
  const info = getDbStatByPath(sumDbPath);
  if (!info) return [];
  const ids = descendantIds.slice(0, 40).filter((id) => UUID_RE.test(String(id || '')));
  if (!ids.length) return [];
  try {
    return withReadOnlyDb(sumDbPath, 30, (db) => {
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT conversation_id, title, agent_name, status, not_fully_idle, killed, last_modified_time FROM conversation_summaries WHERE conversation_id IN (${placeholders})`
        )
        .all(...ids);
      return rows.map((row) => ({
        id: String(row.conversation_id || ''),
        title: String(row.title || '').trim(),
        agentName: String(row.agent_name || '').trim(),
        status: String(row.status || '').trim(),
        running: Boolean(
          row &&
            !Number(row.killed) &&
            (Number(row.not_fully_idle) === 1 || /RUNNING|IN_PROGRESS|ACTIVE/i.test(String(row.status || '')))
        ),
        killed: Boolean(Number(row.killed)),
        lastModifiedTime: String(row.last_modified_time || '')
      }));
    });
  } catch {
    return [];
  }
}

export function parseConversationMetrics(cascadeId, conversationsDirOrList) {
  if (!DatabaseSync || !cascadeId || !UUID_RE.test(cascadeId) || !conversationsDirOrList) return null;
  const conversationsDir = resolveConversationDirForCascade(cascadeId, conversationsDirOrList);
  if (!conversationsDir) return null;
  const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
  const statInfo = getDbStatByPath(dbPath);
  if (!statInfo) return { cascadeId, hasData: false };

  const descendantIds = getDescendantIds(cascadeId, conversationsDir);
  const childSigParts = [];
  for (const cid of descendantIds) {
    const cs = getDbStatByPath(path.join(conversationsDir, `${cid}.db`));
    childSigParts.push(`${cid}=${cs ? cs.sig : '0'}`);
  }
  const sumDbStat =
    descendantIds.length > 0
      ? getDbStatByPath(path.join(path.dirname(conversationsDir), 'conversation_summaries.db'))
      : null;
  const compositeSig = `${statInfo.sig}|c:${childSigParts.join(',')}|s:${sumDbStat ? sumDbStat.sig : '0'}|lim:${activeConfig.contextLimitOverride || activeConfig.contextLimit}`;

  const cached = metricsPayloadCache.get(dbPath);
  if (cached && cached.sig === compositeSig) return cached.payload;

  try {
    const dbRes = withReadOnlyDb(dbPath, 150, (db) => {
      const rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
      if (!rows.length) return { empty: true };
      const userStat = db
        .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(idx), -1) AS lastIdx FROM steps WHERE step_type = 14')
        .get();
      const lastUserIdx = userStat?.lastIdx ?? -1;
      const userStepsCount = userStat?.cnt ?? 0;
      const turnStat = db.prepare('SELECT COUNT(*) AS cnt FROM steps WHERE step_type = 15 AND idx > ?').get(lastUserIdx);
      const rawTurnSteps = turnStat?.cnt ?? 0;
      return { empty: false, rows, userStepsCount, rawTurnSteps };
    });

    if (dbRes.empty) {
      const emptyPayload = { cascadeId, hasData: false, sig: compositeSig };
      setBounded(metricsPayloadCache, dbPath, { sig: compositeSig, payload: emptyPayload }, 64);
      return emptyPayload;
    }

    const valid = [];
    let totalIn = 0;
    let totalCache = 0;
    let totalOut = 0;
    let totalThink = 0;
    let totalResp = 0;
    for (const r of dbRes.rows) {
      const p = parseGenMetadataRow(r);
      totalIn += p.inTok;
      totalCache += p.cacheRead;
      totalOut += p.outTok;
      totalThink += p.thinkTok;
      totalResp += p.respTok;
      if (p.ctx > 0 || p.outTok > 0) valid.push(p);
    }

    if (!valid.length) {
      const emptyPayload = { cascadeId, hasData: false, sig: compositeSig };
      setBounded(metricsPayloadCache, dbPath, { sig: compositeSig, payload: emptyPayload }, 64);
      return emptyPayload;
    }

    let childCount = 0;
    let childCalls = 0;
    let childIn = 0;
    let childCache = 0;
    let childOut = 0;
    for (const cid of descendantIds) {
      const cm = readChildMetrics(cid, conversationsDir);
      if (!cm?.hasData) continue;
      childCount += 1;
      childCalls += cm.calls;
      childIn += cm.totalIn;
      childCache += cm.totalCache;
      childOut += cm.totalOut;
    }

    const turnSlice = dbRes.rawTurnSteps > 0 ? valid.slice(-dbRes.rawTurnSteps) : [];
    const turnSteps = turnSlice.length;
    let turnOut = 0;
    let turnThink = 0;
    let turnResp = 0;
    let turnDur = 0;
    for (const s of turnSlice) {
      turnOut += s.outTok;
      turnThink += s.thinkTok;
      turnResp += s.respTok;
      turnDur += s.totDur;
    }

    const last = valid[valid.length - 1];
    const contextLimitTokens =
      activeConfig.contextLimitOverride > 0
        ? activeConfig.contextLimitOverride
        : last.maxCtx > 0
          ? last.maxCtx
          : activeConfig.contextLimit || 256000;
    const limitStr = formatContextCeiling(contextLimitTokens);

    const rawStreamTps = last.stream >= 0.5 ? last.outTok / last.stream : 0;
    const e2eTps = last.totDur > 0 ? last.outTok / last.totDur : 0;
    const streamRatio = last.totDur > 0 ? last.stream / last.totDur : 0;
    const useStream =
      rawStreamTps > 0 &&
      rawStreamTps <= 600 &&
      (streamRatio >= 0.15 || (last.stream >= 2.0 && rawStreamTps <= 250));
    const displayTps = useStream ? rawStreamTps : e2eTps;
    const ctxPct = Math.round((last.ctx / contextLimitTokens) * 100);
    const ctxClass = ctxPct >= 90 ? 'ag-ctx-crit' : ctxPct >= 75 ? 'ag-ctx-warn' : 'ag-ctx-ok';
    const lastCacheRate = last.ctx > 0 ? ((last.cacheRead / last.ctx) * 100).toFixed(1) : '0.0';
    const sessionCacheRate = totalIn + totalCache > 0 ? ((totalCache / (totalIn + totalCache)) * 100).toFixed(1) : '0.0';
    const lastCacheRateNum = Number(lastCacheRate);
    const sessionCacheRateNum = Number(sessionCacheRate);
    const cacheCollapsed = Boolean(sessionCacheRateNum >= 65 && last.ctx >= 30000 && lastCacheRateNum < 35);
    const remainCtx = Math.max(0, contextLimitTokens - last.ctx);

    const subInlineHtml =
      childCount > 0 ? `<span class="ag-sep">·</span><span class="ag-sub-badge">+${childCount} sub</span>` : '';
    const inlineHtml = [
      `<span>${Math.round(displayTps)} tok/s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>${useStream ? 'TTFT' : 'Hold'} ${last.ttft.toFixed(1)}s</span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Ctx ${fmtTok(last.ctx)}/${limitStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`,
      `<span class="ag-sep">·</span>`,
      `<span>Out ${fmtTok(last.outTok)}</span>`,
      subInlineHtml
    ].join('');

    const turnRowHtml =
      turnSteps > 1
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">本轮合计 (${turnSteps}步)</span><span class="ag-tt-val">输出 ${fmtNum(turnOut)} (思考 ${fmtNum(turnThink)} + 响应 ${fmtNum(turnResp)}) | 耗时 ${turnDur.toFixed(1)}s</span></div>`
        : '';
    const subRowHtml =
      childCount > 0
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">子 Agent (${childCount})</span><span class="ag-tt-val">${childCalls} 次 · 新增 ${fmtTok(childIn)} + 缓存 ${fmtTok(childCache)} · 输出 ${fmtTok(childOut)}</span></div>`
        : '';
    const combinedOut = totalOut + childOut;
    const outputRowHtml =
      childCount > 0
        ? `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(combinedOut)} (主 ${fmtTok(totalOut)} + 子 ${fmtTok(childOut)})</span></div>`
        : `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输出量</span><span class="ag-tt-val">总计 ${fmtTok(totalOut)} (思考链 ${fmtTok(totalThink)} + 正文/工具 ${fmtTok(totalResp)})</span></div>`;

    const tooltipHtml = [
      `<div class="ag-tt-hdr">本轮最新调用 (Gen #${last.idx + 1})</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">生成速度</span><span class="ag-tt-val">${useStream ? `流式 ${rawStreamTps.toFixed(1)} tok/s | ` : ''}端到端（含等待） ${e2eTps.toFixed(1)} tok/s</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">响应耗时</span><span class="ag-tt-val">${useStream ? `TTFT ${last.ttft.toFixed(2)}s | 流式 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s` : `等待 ${last.ttft.toFixed(2)}s | 刷出 ${last.stream.toFixed(2)}s | 总计 ${last.totDur.toFixed(2)}s`}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">当前上下文</span><span class="ag-tt-val">${fmtNum(last.ctx)} (新增 ${fmtNum(last.inTok)} + 缓存 ${fmtNum(last.cacheRead)}, ${lastCacheRate}%)</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">本步输出量</span><span class="ag-tt-val">${fmtNum(last.outTok)} (思考链 ${fmtNum(last.thinkTok)} + 正文/工具 ${fmtNum(last.respTok)})</span></div>`,
      turnRowHtml,
      `<div class="ag-tt-hdr ag-tt-sec">当前会话累计 (${dbRes.userStepsCount} 轮提问 / ${valid.length} 次有效调用)</div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">压缩水位线</span><span class="ag-tt-val">${fmtTok(last.ctx)} / ${limitStr} (${ctxPct}%) · 距压缩余 ${fmtTok(remainCtx)}</span></div>`,
      `<div class="ag-tt-row"><span class="ag-tt-lbl">累计输入量</span><span class="ag-tt-val">新增 ${fmtTok(totalIn)} + 缓存读取 ${fmtTok(totalCache)} (命中率 ${sessionCacheRate}%)</span></div>`,
      subRowHtml,
      outputRowHtml
    ].join('');

    const subSummaryMap = new Map(readSubagentSummaries(descendantIds, conversationsDir).map((s) => [s.id, s]));
    const children = descendantIds.slice(0, 24).map((cid) => {
      const cm = readChildMetrics(cid, conversationsDir);
      const sm = subSummaryMap.get(cid);
      return {
        id: cid,
        title: sm?.title || '',
        agentName: sm?.agentName || '',
        status: sm?.status || '',
        running: Boolean(sm?.running),
        killed: Boolean(sm?.killed),
        calls: cm?.calls || 0,
        outTok: cm?.totalOut || 0
      };
    });
    const stats = {
      ctx: last.ctx,
      cached: last.cacheRead,
      uncached: last.inTok,
      limit: contextLimitTokens,
      limitStr,
      remain: remainCtx,
      pct: ctxPct,
      lastCacheRate: lastCacheRateNum,
      sessionCacheRate: sessionCacheRateNum,
      cacheCollapsed,
      turns: dbRes.userStepsCount,
      calls: valid.length,
      totalThink,
      totalResp,
      totalOut,
      childCount,
      childCalls,
      children
    };

    const payload = { cascadeId, hasData: true, sig: compositeSig, inlineHtml, tooltipHtml, stats };
    setBounded(metricsPayloadCache, dbPath, { sig: compositeSig, payload }, 64);
    return payload;
  } catch {
    return { cascadeId, transientError: true, cachedPayload: cached?.payload || null };
  }
}

/* -------------------------------------------------------------------------- */
/* 4.5 Local Zero-Config Project Context Bridge (AGENTS.md + .anti-claude/)   */
/* -------------------------------------------------------------------------- */

const PROJECTS_REGISTRY_FILE = path.join(STATE_DIR, 'projects-registry.json');

const CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32';

function normalizePathForCompare(p) {
  const resolved = path.resolve(String(p || ''));
  return CASE_INSENSITIVE_FS ? resolved.toLowerCase() : resolved;
}

function resolveRealPathBestEffort(absPath) {
  const resolved = path.resolve(String(absPath || ''));
  try {
    return fs.realpathSync(resolved);
  } catch {}
  /* Walk up until an existing ancestor is found, then join the remaining suffix */
  const suffix = [];
  let cur = resolved;
  while (cur && cur !== path.dirname(cur)) {
    try {
      const realBase = fs.realpathSync(cur);
      return suffix.length ? path.join(realBase, ...suffix.reverse()) : realBase;
    } catch {}
    suffix.push(path.basename(cur));
    cur = path.dirname(cur);
  }
  return resolved;
}

function getBlockedSystemPrefixes() {
  const resolvedHome = path.resolve(HOME);
  const realHome = resolveRealPathBestEffort(resolvedHome);
  const homes = resolvedHome === realHome ? [resolvedHome] : [resolvedHome, realHome];
  const prefixes = [
    STATE_DIR,
    resolveRealPathBestEffort(STATE_DIR),
    GLOBAL_SKILLS_DIR,
    resolveRealPathBestEffort(GLOBAL_SKILLS_DIR),
    GLOBAL_AGENTS_DIR,
    resolveRealPathBestEffort(GLOBAL_AGENTS_DIR),
    SIDECARS_DIR,
    resolveRealPathBestEffort(SIDECARS_DIR),
    '/System',
    '/bin',
    '/sbin',
    '/usr',
    '/etc',
    '/private/etc',
    '/private/var/db',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ];
  for (const h of homes) {
    prefixes.push(
      path.join(h, '.ssh'),
      path.join(h, '.gnupg'),
      path.join(h, '.aws'),
      path.join(h, '.kube'),
      path.join(h, '.config', 'gcloud'),
      path.join(h, 'Library', 'Keychains')
    );
  }
  return prefixes;
}

export function isSensitiveSourcePath(absPath) {
  if (!absPath || !path.isAbsolute(absPath)) return true;
  const candidates = [path.resolve(absPath), resolveRealPathBestEffort(absPath)];
  const blockedPrefixes = getBlockedSystemPrefixes();
  for (const cand of candidates) {
    const normCand = normalizePathForCompare(cand);
    for (const blocked of blockedPrefixes) {
      const normBlocked = normalizePathForCompare(blocked);
      if (normCand === normBlocked || isPathInsideDir(normBlocked, normCand)) return true;
    }
    /* Block common credential/key files directly under HOME */
    const base = path.basename(cand).toLowerCase();
    if (
      base === '.netrc' ||
      base === '.npmrc' ||
      base === '.pypirc' ||
      base === '.git-credentials' ||
      base === 'id_rsa' ||
      base === 'id_ed25519' ||
      base === 'id_ecdsa'
    ) {
      return true;
    }
  }
  return false;
}

export function isSafeProjectDir(absDir) {
  if (!absDir || !path.isAbsolute(absDir)) return false;
  const resolved = path.resolve(absDir);
  if (path.dirname(resolved) === resolved) return false; // filesystem root
  const realResolved = resolveRealPathBestEffort(resolved);
  if (path.dirname(realResolved) === realResolved) return false;

  const normHome = normalizePathForCompare(HOME);
  const normRealHome = normalizePathForCompare(resolveRealPathBestEffort(HOME));
  for (const cand of [resolved, realResolved]) {
    const normCand = normalizePathForCompare(cand);
    if (normCand === normHome || normCand === normRealHome) return false;
  }
  const blockedPrefixes = getBlockedSystemPrefixes();
  for (const cand of [resolved, realResolved]) {
    const normCand = normalizePathForCompare(cand);
    for (const blocked of blockedPrefixes) {
      const normBlocked = normalizePathForCompare(blocked);
      if (normCand === normBlocked || isPathInsideDir(normBlocked, normCand)) return false;
    }
  }
  return true;
}

function recordManagedProjectDir(dirPath, active = true, registryFile = PROJECTS_REGISTRY_FILE) {
  if (!registryFile) return;
  try {
    const cur = readJsonOrFallback(registryFile, null);
    const list = new Set(Array.isArray(cur?.dirs) ? cur.dirs : []);
    if (active) list.add(dirPath);
    else list.delete(dirPath);
    if (list.size > 0) {
      writeAtomicUtf8(registryFile, `${JSON.stringify({ schema: 1, dirs: [...list] }, null, 2)}\n`);
    } else if (fs.existsSync(registryFile)) {
      fs.rmSync(registryFile, { force: true });
    }
  } catch {}
}

function getRegisteredProjectDirs() {
  const cur = readJsonOrFallback(PROJECTS_REGISTRY_FILE, null);
  return Array.isArray(cur?.dirs) ? cur.dirs.map((d) => resolveLocalProjectDir(d)).filter(Boolean) : [];
}

function resolveLocalProjectDir(rawDir) {
  if (!rawDir || typeof rawDir !== 'string') return null;
  let p = rawDir.trim();
  if (!p) return null;
  if (/^file:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    } catch {
      return null;
    }
  }
  if (process.platform === 'win32') {
    const mntMatch = p.match(/^\/mnt\/([a-zA-Z])(\/.*)?$/);
    if (mntMatch) {
      p = `${mntMatch[1].toUpperCase()}:${(mntMatch[2] || '/').replace(/\//g, '\\')}`;
    }
  }
  const abs = path.resolve(p);
  if (!isSafeProjectDir(abs)) return null;
  try {
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isDirectory()) return null;
    return abs;
  } catch {
    return null;
  }
}

function isPathInsideDir(parentDir, targetPath) {
  const rel = path.relative(normalizePathForCompare(parentDir), normalizePathForCompare(targetPath));
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function formatHumanBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function resolveAtomicWriteTarget(filePath) {
  try {
    const lst = fs.lstatSync(filePath);
    if (lst.isSymbolicLink()) {
      try {
        return fs.realpathSync(filePath);
      } catch {
        return path.resolve(path.dirname(filePath), fs.readlinkSync(filePath));
      }
    }
  } catch {}
  return filePath;
}

function writeAtomicUtf8(filePath, content) {
  const target = resolveAtomicWriteTarget(filePath);
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

function isInlineCandidate(fileName, sizeBytes) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return INLINE_TEXT_EXTS.has(ext) && Number(sizeBytes) > 0 && Number(sizeBytes) <= MAX_INLINE_FILE_BYTES;
}

function splitAgentsMdDocument(agentsText, rawMeta) {
  const raw = String(agentsText || '');
  const beginIdx = raw.indexOf(PROJECT_RULE_BEGIN);
  const endIdx = beginIdx !== -1 ? raw.indexOf(PROJECT_RULE_END, beginIdx) : -1;
  const hasManagedBlock = beginIdx !== -1 && endIdx > beginIdx;

  let outsideText = '';
  let legacyFromBlock = '';
  if (hasManagedBlock) {
    const before = raw
      .slice(0, beginIdx)
      .replace(/\s+$/, '')
      .replace(/(?:\r?\n)*---$/, '')
      .trim();
    const after = raw
      .slice(endIdx + PROJECT_RULE_END.length)
      .replace(/^\s+/, '')
      .replace(/^---(?:\r?\n)*/, '')
      .trim();
    outsideText = [before, after].filter(Boolean).join('\n\n').trim();

    const inner = raw.slice(beginIdx + PROJECT_RULE_BEGIN.length, endIdx).trim();
    if (/^##\s+Project Context & Instructions\b/i.test(inner)) {
      const afterHdr = inner.replace(/^##\s+Project Context & Instructions[^\n]*\n*/i, '');
      const nextSecMatch = afterHdr.match(/\n##\s+(?:Project Reference Files|Linked Project Folders)\b/i);
      legacyFromBlock = (nextSecMatch ? afterHdr.slice(0, nextSecMatch.index) : afterHdr).trim();
    } else if (inner && !/^##\s+(?:Project Reference Files|Linked Project Folders)\b/i.test(inner)) {
      legacyFromBlock = inner;
    }
  } else {
    outsideText = raw.trim();
  }

  const metaSchema = Number(rawMeta?.schema) || 1;
  const legacyFromMeta =
    metaSchema < 2 && typeof rawMeta?.instructions === 'string' ? rawMeta.instructions.replace(/\r\n/g, '\n').trim() : '';
  const legacyInst = legacyFromBlock || legacyFromMeta;

  let bodyText = '';
  if (outsideText && legacyInst && !outsideText.includes(legacyInst)) {
    bodyText = `${outsideText}\n\n${legacyInst}`;
  } else {
    bodyText = outsideText || legacyInst || '';
  }

  return { bodyText, outsideText, hasManagedBlock };
}

function readProjectContext(rawDir) {
  const dirPath = resolveLocalProjectDir(rawDir);
  if (!dirPath) return { ok: false, error: 'invalid_directory' };

  const metaPath = path.join(dirPath, PROJECT_META_REL);
  const agentsPath = path.join(dirPath, 'AGENTS.md');
  const rawMeta = readJsonOrFallback(metaPath, null);
  const agentsText = readTextOrEmpty(agentsPath);
  const hasAgentsMd = fs.existsSync(agentsPath);
  const { bodyText: instructions } = splitAgentsMdDocument(agentsText, rawMeta);
  const rawFiles = Array.isArray(rawMeta?.files) ? rawMeta.files : [];

  let inlineBytesUsed = 0;
  const files = [];
  for (const item of rawFiles) {
    if (!item || typeof item.relPath !== 'string') continue;
    const absPath = path.resolve(dirPath, item.relPath);
    if (!isPathInsideDir(dirPath, absPath)) continue;
    const st = fs.statSync(absPath, { throwIfNoEntry: false });
    if (!st || !st.isFile()) continue;
    const name = item.name || path.basename(absPath);
    const canInline = isInlineCandidate(name, st.size) && inlineBytesUsed + st.size <= MAX_INLINE_TOTAL_BYTES;
    if (canInline) inlineBytesUsed += st.size;
    files.push({
      name,
      relPath: item.relPath.replace(/\\/g, '/'),
      absPath,
      size: st.size,
      sizeText: formatHumanBytes(st.size),
      mtimeMs: Math.floor(st.mtimeMs),
      managedCopy: Boolean(item.managedCopy),
      inlined: canInline
    });
  }

  let lastModifiedMs = 0;
  let dirMtimeMs = 0;
  try {
    const dst = fs.statSync(dirPath, { throwIfNoEntry: false });
    if (dst) dirMtimeMs = Math.floor(dst.mtimeMs);
    const mst = fs.statSync(metaPath, { throwIfNoEntry: false });
    if (mst) lastModifiedMs = Math.max(lastModifiedMs, Math.floor(mst.mtimeMs));
    const ast = fs.statSync(agentsPath, { throwIfNoEntry: false });
    if (ast) lastModifiedMs = Math.max(lastModifiedMs, Math.floor(ast.mtimeMs));
  } catch {}

  const rawFolders = Array.isArray(rawMeta?.extraFolders) ? rawMeta.extraFolders : [];
  const extraFolders = [];
  const seenFolders = new Set([dirPath]);
  for (const rf of rawFolders) {
    const fp = resolveLocalProjectDir(typeof rf === 'string' ? rf : rf?.absPath);
    if (!fp || seenFolders.has(fp)) continue;
    seenFolders.add(fp);
    extraFolders.push({
      name: (typeof rf === 'object' && rf?.name) || path.basename(fp) || fp,
      absPath: fp
    });
  }

  const scheduledTasks = readProjectScheduledTasks(dirPath, rawMeta, extraFolders);

  return {
    ok: true,
    dirPath,
    instructions,
    files,
    extraFolders,
    scheduledTasks,
    hasAgentsMd,
    hasOtherAgentsMd: false,
    lastModifiedMs,
    dirMtimeMs
  };
}

function summarizeFolderEntries(absDir) {
  try {
    const entries = fs
      .readdirSync(absDir)
      .filter((n) => n && !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    if (!entries.length) return 'empty';
    const shown = entries.slice(0, 15).map((n) => `\`${n}\``);
    const suffix = entries.length > 15 ? `, +${entries.length - 15} more` : '';
    return `${entries.length} items: ${shown.join(', ')}${suffix}`;
  } catch {
    return 'read on demand';
  }
}

function buildManagedAgentsBlock(files, extraFolders = []) {
  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasFolders = Array.isArray(extraFolders) && extraFolders.length > 0;
  if (!hasFiles && !hasFolders) return '';

  const parts = [PROJECT_RULE_BEGIN];
  if (hasFiles) {
    parts.push('## Project Reference Files', '');
    let inlineBytesUsed = 0;
    const inlineLines = [];
    const pointerLines = [];
    for (const f of files) {
      const safeRel = String(f.relPath || '').replace(/\\/g, '/');
      const safeLabel = String(f.name || path.basename(safeRel)).replace(/[\[\]()]/g, '_');
      if (isInlineCandidate(f.name, f.size) && inlineBytesUsed + f.size <= MAX_INLINE_TOTAL_BYTES) {
        inlineBytesUsed += f.size;
        inlineLines.push(`@[${safeLabel}](${safeRel})`);
      } else {
        pointerLines.push(`- \`${f.name}\` (\`${safeRel}\`, ${formatHumanBytes(f.size)} — read on demand with \`read_file\`)`);
      }
    }
    if (inlineLines.length) parts.push(...inlineLines);
    if (inlineLines.length && pointerLines.length) parts.push('');
    if (pointerLines.length) parts.push(...pointerLines);
  }
  if (hasFolders) {
    if (parts.length > 1) parts.push('');
    parts.push('## Linked Project Folders', '');
    for (const fld of extraFolders) {
      const abs = fld.absPath;
      const summary = summarizeFolderEntries(abs);
      parts.push(`- **${fld.name || path.basename(abs)}** (\`${abs}\` — ${summary})`);
    }
  }
  parts.push(PROJECT_RULE_END);
  return parts.join('\n');
}

function uniqueDestPath(destDir, rawBaseName) {
  const cleanName = String(rawBaseName || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'file';
  const ext = path.extname(cleanName);
  const stem = ext ? cleanName.slice(0, -ext.length) : cleanName;
  let candidate = path.join(destDir, cleanName);
  let idx = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${stem}-${idx}${ext}`);
    idx += 1;
  }
  return candidate;
}

export function saveProjectContext(payload, { registryFile = PROJECTS_REGISTRY_FILE } = {}) {
  const dirPath = resolveLocalProjectDir(payload?.dirPath);
  if (!dirPath) return { ok: false, error: 'invalid_directory' };

  const agentsPath = path.join(dirPath, 'AGENTS.md');
  const existingAgents = readTextOrEmpty(agentsPath);
  const prevMeta = readJsonOrFallback(path.join(dirPath, PROJECT_META_REL), null);
  const prevFiles = Array.isArray(prevMeta?.files) ? prevMeta.files : [];
  const filesDir = path.join(dirPath, PROJECT_FILES_REL);

  const curDoc = splitAgentsMdDocument(existingAgents, prevMeta);
  const instructions =
    typeof payload?.instructions === 'string'
      ? payload.instructions.replace(/\r\n/g, '\n').trim()
      : curDoc.bodyText;

  /* Preserve existing attachments unless `payload.files` was explicitly provided */
  const hasExplicitFiles = Array.isArray(payload?.files);
  const ops = hasExplicitFiles
    ? payload.files
    : prevFiles.map((f) => ({ action: 'keep', relPath: f.relPath, name: f.name }));

  const keptManagedRelPaths = new Set();
  const nextFiles = [];
  const seenRelPaths = new Set();

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    if (op.action === 'keep' && typeof op.relPath === 'string') {
      const absPath = path.resolve(dirPath, op.relPath);
      if (!isPathInsideDir(dirPath, absPath)) continue;
      const st = fs.statSync(absPath, { throwIfNoEntry: false });
      if (!st || !st.isFile()) continue;
      const relNorm = path.relative(dirPath, absPath).replace(/\\/g, '/');
      if (seenRelPaths.has(relNorm)) continue;
      seenRelPaths.add(relNorm);
      const managedCopy = isPathInsideDir(filesDir, absPath);
      if (managedCopy) keptManagedRelPaths.add(relNorm);
      nextFiles.push({ name: op.name || path.basename(absPath), relPath: relNorm, size: st.size, managedCopy });
    } else if (op.action === 'add' && typeof op.sourcePath === 'string') {
      const srcAbs = path.resolve(op.sourcePath.trim());
      if (isSensitiveSourcePath(srcAbs)) continue;
      const st = fs.statSync(srcAbs, { throwIfNoEntry: false });
      if (!st || !st.isFile()) continue;
      const realSrc = resolveRealPathBestEffort(srcAbs);
      if (isSensitiveSourcePath(realSrc)) continue;
      let finalAbs = srcAbs;
      let managedCopy = false;
      if (!isPathInsideDir(dirPath, realSrc)) {
        fs.mkdirSync(filesDir, { recursive: true });
        finalAbs = uniqueDestPath(filesDir, path.basename(srcAbs));
        fs.copyFileSync(realSrc, finalAbs);
        try {
          fs.chmodSync(finalAbs, 0o644);
        } catch {}
        managedCopy = true;
      } else {
        managedCopy = isPathInsideDir(filesDir, srcAbs);
      }
      const relNorm = path.relative(dirPath, finalAbs).replace(/\\/g, '/');
      if (seenRelPaths.has(relNorm)) continue;
      seenRelPaths.add(relNorm);
      if (managedCopy) keptManagedRelPaths.add(relNorm);
      const finalSt = fs.statSync(finalAbs);
      nextFiles.push({ name: path.basename(finalAbs), relPath: relNorm, size: finalSt.size, managedCopy });
    } else if (op.action === 'addContent' && typeof op.name === 'string' && typeof op.base64 === 'string') {
      const buf = Buffer.from(op.base64, 'base64');
      if (buf.length > 50 * 1024 * 1024) continue;
      fs.mkdirSync(filesDir, { recursive: true });
      const finalAbs = uniqueDestPath(filesDir, op.name);
      fs.writeFileSync(finalAbs, buf, { mode: 0o644 });
      const relNorm = path.relative(dirPath, finalAbs).replace(/\\/g, '/');
      if (seenRelPaths.has(relNorm)) continue;
      seenRelPaths.add(relNorm);
      keptManagedRelPaths.add(relNorm);
      nextFiles.push({ name: path.basename(finalAbs), relPath: relNorm, size: buf.length, managedCopy: true });
    }
  }

  /* Clean up removed managed copies inside .anti-claude/files/ only when `payload.files` was explicitly updated */
  if (hasExplicitFiles) {
    for (const old of prevFiles) {
      if (!old?.managedCopy || typeof old.relPath !== 'string') continue;
      const relNorm = old.relPath.replace(/\\/g, '/');
      if (keptManagedRelPaths.has(relNorm)) continue;
      const oldAbs = path.resolve(dirPath, relNorm);
      if (isPathInsideDir(filesDir, oldAbs)) {
        try {
          fs.rmSync(oldAbs, { force: true });
        } catch {}
      }
    }
  }

  /* Normalize attached extra folders */
  const rawExtraFolders = Array.isArray(payload?.extraFolders)
    ? payload.extraFolders
    : Array.isArray(prevMeta?.extraFolders)
      ? prevMeta.extraFolders
      : [];
  const nextExtraFolders = [];
  const seenExtraFolders = new Set([dirPath]);
  for (const rf of rawExtraFolders) {
    const fp = resolveLocalProjectDir(typeof rf === 'string' ? rf : rf?.absPath);
    if (!fp || seenExtraFolders.has(fp)) continue;
    seenExtraFolders.add(fp);
    nextExtraFolders.push({
      name: (typeof rf === 'object' && rf?.name) || path.basename(fp) || fp,
      absPath: fp
    });
  }

  /* Write unified AGENTS.md: user instructions as primary body + optional managed footer for files/folders */
  const managedBlock = buildManagedAgentsBlock(nextFiles, nextExtraFolders);
  let nextAgents = '';
  if (instructions && managedBlock) {
    nextAgents = `${instructions}\n\n---\n\n${managedBlock}\n`;
  } else if (instructions) {
    nextAgents = `${instructions}\n`;
  } else if (managedBlock) {
    nextAgents = `${managedBlock}\n`;
  }

  if (nextAgents !== existingAgents) {
    if (nextAgents) {
      writeAtomicUtf8(agentsPath, nextAgents);
    } else if (fs.existsSync(agentsPath)) {
      fs.rmSync(agentsPath, { force: true });
    }
  }

  const preservedTasks = Array.isArray(prevMeta?.scheduledTasks) ? prevMeta.scheduledTasks : [];
  const metaPath = path.join(dirPath, PROJECT_META_REL);
  const hasManagedData = Boolean(
    nextFiles.length > 0 || nextExtraFolders.length > 0 || preservedTasks.length > 0
  );
  if (hasManagedData) {
    writeAtomicUtf8(
      metaPath,
      `${JSON.stringify(
        {
          schema: 2,
          updatedAt: Date.now(),
          files: nextFiles.map((f) => ({ name: f.name, relPath: f.relPath, managedCopy: f.managedCopy })),
          extraFolders: nextExtraFolders,
          scheduledTasks: preservedTasks
        },
        null,
        2
      )}\n`
    );
    recordManagedProjectDir(dirPath, true, registryFile);
  } else {
    try {
      fs.rmSync(metaPath, { force: true });
      if (fs.existsSync(filesDir) && fs.readdirSync(filesDir).length === 0) fs.rmdirSync(filesDir);
      const acDir = path.join(dirPath, '.anti-claude');
      if (fs.existsSync(acDir) && fs.readdirSync(acDir).length === 0) fs.rmdirSync(acDir);
    } catch {}
    recordManagedProjectDir(dirPath, false, registryFile);
  }

  return readProjectContext(dirPath);
}

function toFileUriSafe(absPath) {
  try {
    return pathToFileURL(path.resolve(absPath)).href;
  } catch {
    return `file://${encodeURI(String(absPath || ''))}`;
  }
}

function fromFileUriSafe(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    if (uri.startsWith('file://')) return path.resolve(fileURLToPath(uri));
    return path.resolve(uri);
  } catch {
    return '';
  }
}

function getHostTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  } catch {
    return 'Asia/Shanghai';
  }
}

function slugifySidecarId(rawName, dirPath) {
  const ascii = String(rawName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const hash = crypto
    .createHash('sha1')
    .update(`${dirPath}:${rawName}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 6);
  return ascii ? `ac-${ascii}-${hash}` : `ac-task-${hash}`;
}

function buildScheduleCronExpr(task) {
  const freq = String(task?.frequency || 'manual').toLowerCase();
  if (freq === 'manual') return '';
  const tz = String(task?.timezone || getHostTimeZone()).trim() || 'Asia/Shanghai';
  const rawTime = String(task?.time || '09:00').trim();
  const tm = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  const hour = tm ? Math.min(23, Math.max(0, Number(tm[1]))) : 9;
  const min = tm ? Math.min(59, Math.max(0, Number(tm[2]))) : 0;

  if (freq === 'hourly') {
    const hMin = Math.min(59, Math.max(0, Number.isFinite(Number(task?.minute)) ? Number(task.minute) : 0));
    return `CRON_TZ=${tz} ${hMin} * * * *`;
  }
  if (freq === 'daily') {
    return `CRON_TZ=${tz} ${min} ${hour} * * *`;
  }
  if (freq === 'weekdays') {
    return `CRON_TZ=${tz} ${min} ${hour} * * 1-5`;
  }
  if (freq === 'weekly') {
    const dow = Math.min(6, Math.max(0, Number.isFinite(Number(task?.dayOfWeek)) ? Number(task.dayOfWeek) : 1));
    return `CRON_TZ=${tz} ${min} ${hour} * * ${dow}`;
  }
  const custom = String(task?.customCron || '').trim();
  if (!custom) return `CRON_TZ=${tz} 0 9 * * *`;
  if (/^(CRON_TZ|TZ)=/i.test(custom)) return custom;
  return `CRON_TZ=${tz} ${custom}`;
}

function parseScheduleCronExpr(rawExpr) {
  const s = String(rawExpr || '').trim();
  if (!s) return { frequency: 'manual', time: '09:00', dayOfWeek: 1, minute: 0, customCron: '', timezone: getHostTimeZone() };
  let timezone = getHostTimeZone();
  let expr = s;
  const tzMatch = expr.match(/^(?:CRON_TZ|TZ)=([^\s]+)\s+(.+)$/);
  if (tzMatch) {
    timezone = tzMatch[1];
    expr = tzMatch[2].trim();
  }
  const fields = expr.split(/\s+/);
  if (fields.length === 5) {
    const [m, h, dom, mon, dow] = fields;
    const mNum = /^\d{1,2}$/.test(m) ? Number(m) : null;
    const hNum = /^\d{1,2}$/.test(h) ? Number(h) : null;
    if (mNum !== null && h === '*' && dom === '*' && mon === '*' && dow === '*') {
      return { frequency: 'hourly', minute: mNum, time: '09:00', dayOfWeek: 1, customCron: expr, timezone };
    }
    if (mNum !== null && hNum !== null && dom === '*' && mon === '*') {
      const time = `${String(hNum).padStart(2, '0')}:${String(mNum).padStart(2, '0')}`;
      if (dow === '*') return { frequency: 'daily', time, dayOfWeek: 1, minute: mNum, customCron: expr, timezone };
      if (dow === '1-5') return { frequency: 'weekdays', time, dayOfWeek: 1, minute: mNum, customCron: expr, timezone };
      if (/^[0-6]$/.test(dow)) return { frequency: 'weekly', time, dayOfWeek: Number(dow), minute: mNum, customCron: expr, timezone };
    }
  }
  return { frequency: 'custom', time: '09:00', dayOfWeek: 1, minute: 0, customCron: expr, timezone };
}

function readProjectScheduledTasks(dirPath, rawMeta, extraFolders = []) {
  const projectDirs = new Set([path.resolve(dirPath)]);
  for (const ef of extraFolders) {
    if (ef?.absPath) projectDirs.add(path.resolve(ef.absPath));
  }

  const stored = Array.isArray(rawMeta?.scheduledTasks) ? rawMeta.scheduledTasks : [];
  const tasks = [];
  const knownSidecarIds = new Set();

  for (const t of stored) {
    if (!t || typeof t !== 'object' || !t.name) continue;
    const rawSidecarId = typeof t.sidecarId === 'string' ? t.sidecarId.trim() : '';
    let sidecarId = '';
    let syncedSidecar = false;
    if (rawSidecarId && /^[a-z0-9._-]+$/i.test(rawSidecarId)) {
      const sidecarPath = path.join(SIDECARS_DIR, rawSidecarId, 'sidecar.json');
      const sc = isPathInsideDir(SIDECARS_DIR, sidecarPath) ? readJsonOrFallback(sidecarPath, null) : null;
      /* Verify sidecar ownership against trusted local sidecar metadata — never blindly trust cloned repo JSON */
      if (sc && sidecarBelongsToProject(sc, rawSidecarId, projectDirs, path.resolve(dirPath))) {
        sidecarId = rawSidecarId;
        syncedSidecar = true;
        knownSidecarIds.add(sidecarId);
      }
    }
    tasks.push({
      id: String(t.id || sidecarId || `task-${tasks.length + 1}`),
      name: String(t.name),
      description: String(t.description || ''),
      instructions: String(t.instructions || ''),
      folderPath: resolveLocalProjectDir(t.folderPath) || dirPath,
      model: String(t.model || ''),
      frequency: String(t.frequency || 'manual'),
      time: String(t.time || '09:00'),
      dayOfWeek: Number.isFinite(Number(t.dayOfWeek)) ? Number(t.dayOfWeek) : 1,
      minute: Number.isFinite(Number(t.minute)) ? Number(t.minute) : 0,
      customCron: String(t.customCron || ''),
      timezone: String(t.timezone || getHostTimeZone()),
      cron: String(t.cron || ''),
      sidecarId,
      syncedSidecar,
      externalSidecar: false,
      updatedAt: Number(t.updatedAt || 0)
    });
  }

  /* Also discover native Antigravity Automations targeting this project's folders */
  try {
    if (fs.existsSync(SIDECARS_DIR)) {
      for (const entry of fs.readdirSync(SIDECARS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory() || knownSidecarIds.has(entry.name)) continue;
        const scPath = path.join(SIDECARS_DIR, entry.name, 'sidecar.json');
        const sc = readJsonOrFallback(scPath, null);
        if (!sc || sc.builtin !== 'schedule' || !Array.isArray(sc.args)) continue;
        const uris = Array.isArray(sc.agent_permissions?.workspace_uris) ? sc.agent_permissions.workspace_uris : [];
        const matchedDir = uris.map(fromFileUriSafe).find((p) => p && projectDirs.has(p));
        if (!matchedDir) continue;
        const parsed = parseScheduleCronExpr(sc.args[0]);
        const sepIdx = sc.args.indexOf('--');
        const instructions = sepIdx !== -1 && sc.args[sepIdx + 1] ? String(sc.args[sepIdx + 1]) : '';
        const modelArg = sc.args.find((a) => typeof a === 'string' && a.startsWith('--model='));
        const model = modelArg ? modelArg.slice('--model='.length) : '';
        let updatedAt = 0;
        try {
          updatedAt = Math.floor(fs.statSync(scPath).mtimeMs);
        } catch {}
        tasks.push({
          id: `sidecar:${entry.name}`,
          name: String(sc.display_name || entry.name),
          description: String(sc.description || ''),
          instructions,
          folderPath: matchedDir,
          model,
          frequency: parsed.frequency,
          time: parsed.time,
          dayOfWeek: parsed.dayOfWeek,
          minute: parsed.minute,
          customCron: parsed.customCron,
          timezone: parsed.timezone,
          cron: String(sc.args[0] || ''),
          sidecarId: entry.name,
          syncedSidecar: true,
          externalSidecar: true,
          updatedAt
        });
      }
    }
  } catch {}

  return tasks;
}

function buildProjectDirSet(dirPath, prevMeta) {
  const dirs = new Set([path.resolve(dirPath)]);
  const extra = Array.isArray(prevMeta?.extraFolders) ? prevMeta.extraFolders : [];
  for (const ef of extra) {
    const p = resolveLocalProjectDir(typeof ef === 'string' ? ef : ef?.absPath);
    if (p) dirs.add(p);
  }
  return dirs;
}

function sidecarBelongsToProject(sc, sidecarId, projectDirs, dirPath) {
  if (!sc || typeof sc !== 'object') return false;
  const normDirs = new Set([...projectDirs].map((d) => normalizePathForCompare(resolveRealPathBestEffort(d))));
  normDirs.add(normalizePathForCompare(resolveRealPathBestEffort(dirPath)));
  if (sc.anti_claude_project_dir) {
    const scDir = normalizePathForCompare(resolveRealPathBestEffort(path.resolve(sc.anti_claude_project_dir)));
    if (normDirs.has(scDir)) return true;
  }
  if (sc.builtin !== 'schedule') return false;
  const uris = Array.isArray(sc.agent_permissions?.workspace_uris) ? sc.agent_permissions.workspace_uris : [];
  return uris
    .map(fromFileUriSafe)
    .some((p) => p && normDirs.has(normalizePathForCompare(resolveRealPathBestEffort(p))));
}

export function saveProjectScheduledTask(
  payload,
  { sidecarsDir = SIDECARS_DIR, registryFile = sidecarsDir === SIDECARS_DIR ? PROJECTS_REGISTRY_FILE : null } = {}
) {
  const dirPath = resolveLocalProjectDir(payload?.dirPath);
  if (!dirPath) return { ok: false, error: 'invalid_directory' };
  const rawTask = payload?.task;
  if (!rawTask || typeof rawTask !== 'object') return { ok: false, error: 'missing_task' };

  const name = String(rawTask.name || '').trim();
  const description = String(rawTask.description || '').trim();
  const instructions = String(rawTask.instructions || '').replace(/\r\n/g, '\n').trim();
  if (!name || !description || !instructions) {
    return { ok: false, error: 'required_fields_missing' };
  }

  const folderPath = resolveLocalProjectDir(rawTask.folderPath) || dirPath;
  const model = String(rawTask.model || '').trim();
  const frequency = ['manual', 'hourly', 'daily', 'weekdays', 'weekly', 'custom'].includes(String(rawTask.frequency || 'manual'))
    ? String(rawTask.frequency || 'manual')
    : 'manual';
  const time = /^\d{1,2}:\d{2}$/.test(String(rawTask.time || '')) ? String(rawTask.time) : '09:00';
  const dayOfWeek = Math.min(6, Math.max(0, Number.isFinite(Number(rawTask.dayOfWeek)) ? Number(rawTask.dayOfWeek) : 1));
  const minute = Math.min(59, Math.max(0, Number.isFinite(Number(rawTask.minute)) ? Number(rawTask.minute) : 0));
  const customCron = String(rawTask.customCron || '').trim();
  const timezone = String(rawTask.timezone || getHostTimeZone()).trim() || 'Asia/Shanghai';

  const metaPath = path.join(dirPath, PROJECT_META_REL);
  const prevMeta = readJsonOrFallback(metaPath, null) || {};
  const prevTasks = Array.isArray(prevMeta.scheduledTasks) ? prevMeta.scheduledTasks.slice() : [];
  const projectDirs = buildProjectDirSet(dirPath, prevMeta);
  projectDirs.add(folderPath);

  const editId = typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id.trim() : '';
  const existingIdx = editId ? prevTasks.findIndex((t) => t && t.id === editId) : -1;
  const existing = existingIdx !== -1 ? prevTasks[existingIdx] : null;
  let sidecarId = String(existing?.sidecarId || rawTask.sidecarId || '').trim();
  const cron = buildScheduleCronExpr({ frequency, time, dayOfWeek, minute, customCron, timezone });

  if (frequency === 'manual') {
    if (sidecarId && /^[a-z0-9._-]+$/i.test(sidecarId)) {
      const scDir = path.join(sidecarsDir, sidecarId);
      if (isPathInsideDir(sidecarsDir, scDir) && fs.existsSync(scDir)) {
        const existingSc = readJsonOrFallback(path.join(scDir, 'sidecar.json'), null);
        if (!sidecarBelongsToProject(existingSc, sidecarId, projectDirs, dirPath)) {
          return { ok: false, error: 'sidecar_not_in_project' };
        }
        try {
          fs.rmSync(scDir, { recursive: true, force: true });
        } catch {}
      }
    }
    sidecarId = '';
  } else {
    if (!sidecarId || !/^[a-z0-9._-]+$/i.test(sidecarId)) {
      sidecarId = slugifySidecarId(name, dirPath);
    }
    const scDir = path.join(sidecarsDir, sidecarId);
    if (!isPathInsideDir(sidecarsDir, scDir)) return { ok: false, error: 'invalid_sidecar_id' };
    const existingSc = readJsonOrFallback(path.join(scDir, 'sidecar.json'), null);
    if (existingSc && !sidecarBelongsToProject(existingSc, sidecarId, projectDirs, dirPath)) {
      return { ok: false, error: 'sidecar_not_in_project' };
    }
    const args = [cron, 'agentapi', 'new-conversation'];
    if (model) args.push(`--model=${model}`);
    args.push('--', instructions);

    /* Preserve multi-workspace `workspace_uris` on native sidecars unless the user changed this task's folder */
    const nextUri = toFileUriSafe(folderPath);
    const existingUris = Array.isArray(existingSc?.agent_permissions?.workspace_uris)
      ? existingSc.agent_permissions.workspace_uris
      : [];
    let nextWorkspaceUris = [nextUri];
    if (existingUris.length > 0) {
      const prevMatchedDir =
        (existing?.folderPath && resolveLocalProjectDir(existing.folderPath)) ||
        existingUris.map(fromFileUriSafe).find((p) => p && projectDirs.has(p)) ||
        '';
      if (prevMatchedDir && folderPath === prevMatchedDir) {
        nextWorkspaceUris = existingUris.slice();
      } else if (prevMatchedDir) {
        const replaced = [];
        let didReplace = false;
        for (const u of existingUris) {
          if (!didReplace && fromFileUriSafe(u) === prevMatchedDir) {
            replaced.push(nextUri);
            didReplace = true;
          } else if (u !== nextUri) {
            replaced.push(u);
          }
        }
        if (!didReplace && !replaced.includes(nextUri)) replaced.unshift(nextUri);
        nextWorkspaceUris = replaced;
      }
    }

    const nextSidecar = {
      ...(existingSc && typeof existingSc === 'object' ? existingSc : { created_by: 'anti-claude', anti_claude_project_dir: dirPath }),
      builtin: 'schedule',
      args,
      restart_policy: 'always',
      display_name: name,
      description,
      agent_permissions: {
        ...(existingSc?.agent_permissions && typeof existingSc.agent_permissions === 'object' ? existingSc.agent_permissions : {}),
        workspace_uris: nextWorkspaceUris
      }
    };
    writeAtomicUtf8(path.join(scDir, 'sidecar.json'), `${JSON.stringify(nextSidecar, null, 2)}\n`);
  }

  const savedId = editId && !editId.startsWith('sidecar:') ? editId : sidecarId || `task-${Date.now().toString(36)}`;
  const taskRecord = {
    id: savedId,
    name,
    description,
    instructions,
    folderPath,
    model,
    frequency,
    time,
    dayOfWeek,
    minute,
    customCron,
    timezone,
    cron,
    sidecarId,
    updatedAt: Date.now()
  };

  if (existingIdx !== -1) prevTasks[existingIdx] = taskRecord;
  else prevTasks.unshift(taskRecord);

  const nextSchema = Number(prevMeta.schema) >= 2 ? 2 : prevMeta.instructions ? 1 : 2;
  const metaPayload = {
    schema: nextSchema,
    updatedAt: Date.now(),
    ...(nextSchema < 2 && typeof prevMeta.instructions === 'string' ? { instructions: prevMeta.instructions } : {}),
    files: Array.isArray(prevMeta.files) ? prevMeta.files : [],
    extraFolders: Array.isArray(prevMeta.extraFolders) ? prevMeta.extraFolders : [],
    scheduledTasks: prevTasks
  };
  writeAtomicUtf8(metaPath, `${JSON.stringify(metaPayload, null, 2)}\n`);
  recordManagedProjectDir(dirPath, true, registryFile);

  const ctx = readProjectContext(dirPath);
  return { ...ctx, savedTaskId: savedId, sidecarId };
}

export function deleteProjectScheduledTask(
  payload,
  { sidecarsDir = SIDECARS_DIR, registryFile = sidecarsDir === SIDECARS_DIR ? PROJECTS_REGISTRY_FILE : null } = {}
) {
  const dirPath = resolveLocalProjectDir(payload?.dirPath);
  if (!dirPath) return { ok: false, error: 'invalid_directory' };
  const taskId = String(payload?.taskId || '').trim();
  const reqSidecarId = String(payload?.sidecarId || '').trim();
  if (!taskId && !reqSidecarId) return { ok: false, error: 'missing_task_id' };

  const metaPath = path.join(dirPath, PROJECT_META_REL);
  const prevMeta = readJsonOrFallback(metaPath, null);
  const prevTasks = Array.isArray(prevMeta?.scheduledTasks) ? prevMeta.scheduledTasks : [];
  const projectDirs = buildProjectDirSet(dirPath, prevMeta);
  const target = prevTasks.find((t) => t && (t.id === taskId || (reqSidecarId && t.sidecarId === reqSidecarId)));
  const inferredSidecarId = !target && taskId.startsWith('sidecar:') ? taskId.slice('sidecar:'.length) : '';
  const sidecarId = String(target?.sidecarId || reqSidecarId || inferredSidecarId || '').trim();

  if (sidecarId) {
    if (!/^[a-z0-9._-]+$/i.test(sidecarId)) return { ok: false, error: 'invalid_sidecar_id' };
    const scDir = path.join(sidecarsDir, sidecarId);
    if (!isPathInsideDir(sidecarsDir, scDir)) return { ok: false, error: 'invalid_sidecar_id' };
    if (fs.existsSync(scDir)) {
      const existingSc = readJsonOrFallback(path.join(scDir, 'sidecar.json'), null);
      if (!sidecarBelongsToProject(existingSc, sidecarId, projectDirs, dirPath)) {
        return { ok: false, error: 'sidecar_not_in_project' };
      }
      try {
        fs.rmSync(scDir, { recursive: true, force: true });
      } catch {}
    } else if (!target) {
      return { ok: false, error: 'sidecar_not_found' };
    }
  }

  if (prevMeta) {
    const nextTasks = prevTasks.filter((t) => t && t.id !== taskId && (!sidecarId || t.sidecarId !== sidecarId));
    const prevSchema = Number(prevMeta.schema) >= 2 ? 2 : 1;
    const hasLegacyInst = prevSchema < 2 && typeof prevMeta.instructions === 'string' && prevMeta.instructions.trim();
    const hasAnything =
      hasLegacyInst ||
      (Array.isArray(prevMeta.files) && prevMeta.files.length > 0) ||
      (Array.isArray(prevMeta.extraFolders) && prevMeta.extraFolders.length > 0) ||
      nextTasks.length > 0;
    if (hasAnything) {
      writeAtomicUtf8(
        metaPath,
        `${JSON.stringify(
          {
            ...prevMeta,
            schema: prevSchema,
            updatedAt: Date.now(),
            scheduledTasks: nextTasks
          },
          null,
          2
        )}\n`
      );
    } else {
      try {
        fs.rmSync(metaPath, { force: true });
        const acDir = path.join(dirPath, '.anti-claude');
        if (fs.existsSync(acDir) && fs.readdirSync(acDir).length === 0) fs.rmdirSync(acDir);
      } catch {}
      const agentsText = readTextOrEmpty(path.join(dirPath, 'AGENTS.md'));
      if (!agentsText.includes(PROJECT_RULE_BEGIN)) recordManagedProjectDir(dirPath, false);
    }
  }

  return readProjectContext(dirPath);
}

function pickLocalFilesNative() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      const script = [
        'activate',
        'set fs to choose file with prompt "选择要添加到项目上下文的参考文件" with multiple selections allowed',
        'set out to ""',
        'repeat with f in fs',
        'set out to out & POSIX path of f & linefeed',
        'end repeat',
        'return out'
      ];
      const args = [];
      for (const line of script) args.push('-e', line);
      execFile('osascript', args, { timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          const msg = `${err.message || ''}\n${stderr || ''}`;
          if (/User canceled|-128/i.test(msg)) {
            return resolve({ ok: true, canceled: true, paths: [] });
          }
          console.error('[Anti-Claude Daemon] pickLocalFilesNative failed:', msg.trim());
          return resolve({ ok: false, error: msg.trim() || 'pick_files_failed', paths: [] });
        }
        if (!stdout) return resolve({ ok: true, canceled: true, paths: [] });
        const paths = String(stdout)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s && fs.existsSync(s));
        resolve({ ok: true, canceled: paths.length === 0, paths });
      });
      return;
    }
    if (process.platform === 'win32') {
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$top = New-Object System.Windows.Forms.Form; $top.TopMost = $true',
        '$dlg = New-Object System.Windows.Forms.OpenFileDialog',
        '$dlg.Multiselect = $true',
        'try { if ($dlg.ShowDialog($top) -eq "OK") { $dlg.FileNames -join "`n" } } finally { $top.Dispose() }'
      ].join('; ');
      execFile(
        'powershell',
        ['-NoProfile', '-STA', '-Command', ps],
        { timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
        (err, stdout) => {
          if (err || !stdout) return resolve({ ok: true, canceled: true, paths: [] });
          const paths = String(stdout)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s && fs.existsSync(s));
          resolve({ ok: true, canceled: paths.length === 0, paths });
        }
      );
      return;
    }
    resolve({ ok: false, error: 'unsupported_platform', paths: [] });
  });
}

function pickLocalFolderNative() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile(
        'osascript',
        ['-e', 'activate', '-e', 'POSIX path of (choose folder with prompt "选择要加入本项目的本地文件夹")'],
        { timeout: 120000 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = `${err.message || ''}\n${stderr || ''}`;
            if (/User canceled|-128/i.test(msg)) {
              return resolve({ ok: true, canceled: true, folderPath: '' });
            }
            console.error('[Anti-Claude Daemon] pickLocalFolderNative failed:', msg.trim());
            return resolve({ ok: false, error: msg.trim() || 'pick_folder_failed', folderPath: '' });
          }
          if (!stdout) return resolve({ ok: true, canceled: true, folderPath: '' });
          const folderPath = String(stdout).trim().replace(/\/+$/, '');
          if (!folderPath || !fs.existsSync(folderPath)) return resolve({ ok: true, canceled: true, folderPath: '' });
          resolve({ ok: true, canceled: false, folderPath, name: path.basename(folderPath) || folderPath });
        }
      );
      return;
    }
    if (process.platform === 'win32') {
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$top = New-Object System.Windows.Forms.Form; $top.TopMost = $true',
        '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
        'try { if ($dlg.ShowDialog($top) -eq "OK") { $dlg.SelectedPath } } finally { $top.Dispose() }'
      ].join('; ');
      execFile(
        'powershell',
        ['-NoProfile', '-STA', '-Command', ps],
        { timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
        (err, stdout) => {
          if (err || !stdout) return resolve({ ok: true, canceled: true, folderPath: '' });
          const folderPath = String(stdout).trim();
          if (!folderPath || !fs.existsSync(folderPath)) return resolve({ ok: true, canceled: true, folderPath: '' });
          resolve({ ok: true, canceled: false, folderPath, name: path.basename(folderPath) || folderPath });
        }
      );
      return;
    }
    resolve({ ok: false, error: 'unsupported_platform', folderPath: '' });
  });
}

const WIN_RESERVED_BASENAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function inferSingleRunningWslDistroFromCache() {
  const distros = new Set();
  const collect = (list) => {
    for (const dir of list || []) {
      const m = String(dir || '').match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\/i);
      if (m && SAFE_WSL_DISTRO_RE.test(m[1])) distros.add(m[1]);
    }
  };
  collect(wslGeminiCache.dirs);
  if (distros.size === 0) collect(discoverWslGeminiDirs());
  return distros.size === 1 ? Array.from(distros)[0] : '';
}

function hasUnsafeWinSegments(segs) {
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..') return true;
    const trimmed = seg.replace(/[. ]+$/, '');
    if (!trimmed || WIN_RESERVED_BASENAME_RE.test(trimmed)) return true;
  }
  return false;
}

export function resolveHostRevealTarget(
  rawPath,
  { wslDistro = '', fallbackWslDistro = '', platform = process.platform } = {}
) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, error: 'missing_path' };
  let s = rawPath.trim();
  if (!s || s.length > 4096) return { ok: false, error: 'invalid_path' };
  if (/[\x00-\x1f\x7f"]/.test(s)) return { ok: false, error: 'invalid_chars' };

  const fromFileUrl = /^file:/i.test(s);
  if (fromFileUrl) {
    if (s.includes('\\')) return { ok: false, error: 'backslash_in_file_url_blocked' };
    if (/%(?:2f|5c|00|22)/i.test(s)) return { ok: false, error: 'invalid_file_url' };
    const fm = s.match(/^file:\/\/([^/?#]*)(\/[^?#]*)$/i);
    if (!fm) return { ok: false, error: 'invalid_file_url' };
    const rawHost = fm[1];
    const host = rawHost.toLowerCase();
    const rawUrlPath = fm[2];
    const rawUrlSegs = rawUrlPath.split('/');
    const decodedSegs = [];
    for (let i = 1; i < rawUrlSegs.length; i++) {
      const encSeg = rawUrlSegs[i];
      if (!encSeg) continue;
      let dec = '';
      try {
        dec = decodeURIComponent(encSeg);
      } catch {
        return { ok: false, error: 'invalid_file_url_encoding' };
      }
      if (dec === '.' || dec === '..') return { ok: false, error: 'traversal_blocked' };
      if (/[\x00-\x1f\x7f"\\/]/.test(dec)) return { ok: false, error: 'invalid_chars' };
      decodedSegs.push(dec);
    }
    const reconstructedPosix = decodedSegs.length ? `/${decodedSegs.join('/')}` : '/';
    if (host === 'wsl.localhost' || host === 'wsl$') {
      s = `\\\\${rawHost}${reconstructedPosix.replace(/\//g, '\\')}`;
    } else if (host && host !== 'localhost') {
      return { ok: false, error: 'remote_file_url_blocked' };
    } else if (platform === 'win32' && /^\/[a-zA-Z]:(?:\/|$)/.test(reconstructedPosix)) {
      const sliced = reconstructedPosix.slice(1);
      s = sliced.length === 2 ? `${sliced}\\` : sliced;
    } else {
      s = reconstructedPosix;
    }
  }

  if (/^(?:\\\\|\/\/)[?.](?:[\\/]|$)/.test(s)) {
    return { ok: false, error: 'device_prefix_blocked' };
  }

  if (platform === 'win32') {
    // 1a. POSIX WSL DrvFS mount (/mnt/e/...) — forbid literal backslashes in POSIX input
    if (s.startsWith('/mnt/') || s === '/mnt') {
      if (s.includes('\\')) return { ok: false, error: 'backslash_in_posix_blocked' };
      const mntPosix = s.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
      if (!mntPosix) return { ok: false, error: 'invalid_mnt_path' };
      const drive = mntPosix[1].toUpperCase();
      const rawRest = String(mntPosix[2] || '');
      if (rawRest.includes(':')) return { ok: false, error: 'ads_blocked' };
      const segs = rawRest.split('/').filter(Boolean);
      if (hasUnsafeWinSegments(segs)) return { ok: false, error: 'traversal_blocked' };
      const resolved = segs.length ? `${drive}:\\${segs.join('\\')}` : `${drive}:\\`;
      return { ok: true, path: resolved, kind: 'wsl-drvfs' };
    }

    // 1b. Antigravity's broken UNC DrvFS path (\\wsl.localhost\<distro>\mnt\e\...) — validate distro first
    const mntUnc = s.match(/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)[\\/]mnt[\\/]([a-zA-Z])(?:[\\/](.*))?$/i);
    if (mntUnc) {
      const uncDistro = mntUnc[1];
      if (!SAFE_WSL_DISTRO_RE.test(uncDistro)) return { ok: false, error: 'invalid_wsl_distro' };
      const drive = mntUnc[2].toUpperCase();
      const rawRest = String(mntUnc[3] || '');
      if (rawRest.includes(':')) return { ok: false, error: 'ads_blocked' };
      const segs = rawRest.split(/[\\/]+/).filter(Boolean);
      if (hasUnsafeWinSegments(segs)) return { ok: false, error: 'traversal_blocked' };
      const resolved = segs.length ? `${drive}:\\${segs.join('\\')}` : `${drive}:\\`;
      return { ok: true, path: resolved, kind: 'wsl-drvfs' };
    }

    // 2. Native Windows drive path (strictly rooted C:\... or C:/..., rejecting C:relative and ..)
    const winDrive = s.match(/^([a-zA-Z]):(?:[\\/](.*))?$/);
    if (winDrive && (s.length === 2 || s[2] === '\\' || s[2] === '/')) {
      if (s.length === 2) return { ok: false, error: 'relative_path_blocked' };
      const drive = winDrive[1].toUpperCase();
      const rawRest = String(winDrive[2] || '');
      if (rawRest.includes(':')) return { ok: false, error: 'ads_blocked' };
      const segs = rawRest.split(/[\\/]+/).filter(Boolean);
      if (hasUnsafeWinSegments(segs)) return { ok: false, error: 'traversal_blocked' };
      const resolved = segs.length ? `${drive}:\\${segs.join('\\')}` : `${drive}:\\`;
      return { ok: true, path: resolved, kind: 'win-drive' };
    }

    // 3. UNC paths: strictly allow local WSL UNC (\\wsl.localhost\<distro>\... or \\wsl$\<distro>\...), block remote SMB
    if (s.startsWith('\\\\') || s.startsWith('//')) {
      const mUnc = s.match(/^(?:\\\\|\/\/)(wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i);
      if (!mUnc) return { ok: false, error: 'remote_unc_blocked' };
      const host = mUnc[1];
      const distro = mUnc[2];
      const rest = String(mUnc[3] || '');
      if (!SAFE_WSL_DISTRO_RE.test(distro)) return { ok: false, error: 'invalid_wsl_distro' };
      if (rest.includes(':')) return { ok: false, error: 'ads_blocked' };
      const segs = rest.split(/[\\/]+/).filter(Boolean);
      if (segs.some((seg) => seg === '.' || seg === '..')) return { ok: false, error: 'traversal_blocked' };
      const resolved = segs.length ? `\\\\${host}\\${distro}\\${segs.join('\\')}` : `\\\\${host}\\${distro}\\`;
      return { ok: true, path: resolved, kind: 'wsl-unc' };
    }

    // 4. Pure WSL POSIX path (/home/user/..., /tmp/...) -> map to \\wsl.localhost\<distro>\...
    if (s.startsWith('/')) {
      if (s.includes('\\')) return { ok: false, error: 'backslash_in_posix_blocked' };
      if (s.includes(':')) return { ok: false, error: 'ads_blocked' };
      const rawSegs = s.split('/').filter(Boolean);
      if (rawSegs.some((seg) => seg === '.' || seg === '..')) return { ok: false, error: 'traversal_blocked' };
      const cleanExplicit = String(wslDistro || '').trim();
      if (cleanExplicit && !SAFE_WSL_DISTRO_RE.test(cleanExplicit)) {
        return { ok: false, error: 'invalid_wsl_distro' };
      }
      const cleanFallback = String(fallbackWslDistro || '').trim();
      if (cleanFallback && !SAFE_WSL_DISTRO_RE.test(cleanFallback)) {
        return { ok: false, error: 'invalid_wsl_distro' };
      }
      const distro = cleanExplicit || cleanFallback || inferSingleRunningWslDistroFromCache();
      if (!distro) return { ok: false, error: 'wsl_distro_unknown' };
      const resolved = rawSegs.length
        ? `\\\\wsl.localhost\\${distro}\\${rawSegs.join('\\')}`
        : `\\\\wsl.localhost\\${distro}\\`;
      return { ok: true, path: resolved, kind: 'wsl-posix' };
    }

    return { ok: false, error: 'relative_path_blocked' };
  }

  if (s.startsWith('\\\\') || s.startsWith('//')) {
    return { ok: false, error: 'remote_unc_blocked' };
  }
  if (s.includes('\\')) {
    return { ok: false, error: 'backslash_in_posix_blocked' };
  }
  if (!path.posix.isAbsolute(s)) {
    return { ok: false, error: 'relative_path_blocked' };
  }
  const posixSegs = s.split('/').filter(Boolean);
  if (posixSegs.some((seg) => seg === '.' || seg === '..')) {
    return { ok: false, error: 'traversal_blocked' };
  }
  return { ok: true, path: posixSegs.length ? `/${posixSegs.join('/')}` : '/', kind: 'posix' };
}

function resolveTrustedWindowsExplorerBin() {
  const sysRoot = String(process.env.SystemRoot || process.env.windir || 'C:\\Windows').trim() || 'C:\\Windows';
  const candidate = path.win32.join(sysRoot, 'explorer.exe');
  try {
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  return 'C:\\Windows\\explorer.exe';
}

const WIN_INSPECT_REVEAL_PS = [
  '$ErrorActionPreference = "Stop"',
  '$t = $env:AG_REVEAL_TARGET',
  'if ([string]::IsNullOrEmpty($t) -or $t.Length -lt 3) { Write-Output "ERR:invalid_drive_path"; exit 0 }',
  '$letter = $t.Substring(0, 1)',
  'try { $dt = [int]([System.IO.DriveInfo]::new($letter)).DriveType } catch { Write-Output "ERR:drive_type_check_failed"; exit 0 }',
  'if ($dt -eq 1) { Write-Output "ERR:not_found"; exit 0 }',
  'if ($dt -ne 2 -and $dt -ne 3 -and $dt -ne 6) { Write-Output "ERR:remote_drive_blocked"; exit 0 }',
  '$root = $letter.ToUpperInvariant() + ":\\"',
  'try { $ra = [System.IO.File]::GetAttributes($root) } catch { Write-Output "ERR:not_found"; exit 0 }',
  'if (($ra -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Output "ERR:reparse_point_blocked"; exit 0 }',
  '$rest = $t.Substring(3)',
  '$cur = $root',
  '$parts = $rest -split "\\\\" | Where-Object { $_ -ne "" }',
  'foreach ($p in $parts) {',
  '  $cur = [System.IO.Path]::Combine($cur, $p)',
  '  try { $a = [System.IO.File]::GetAttributes($cur) } catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] { Write-Output "ERR:not_found"; exit 0 } catch { Write-Output "ERR:stat_failed"; exit 0 }',
  '  if (($a -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Output "ERR:reparse_point_blocked"; exit 0 }',
  '}',
  '$finalAttr = [System.IO.File]::GetAttributes($cur)',
  'if (($finalAttr -band [System.IO.FileAttributes]::Directory) -ne 0) { Write-Output "OK:dir" } else { Write-Output "OK:file" }'
].join('; ');

async function inspectWindowsLocalDrivePath(absPath) {
  const sysRoot = String(process.env.SystemRoot || process.env.windir || 'C:\\Windows').trim() || 'C:\\Windows';
  const psBin = path.win32.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(
      psBin,
      ['-NoProfile', '-NonInteractive', '-Command', WIN_INSPECT_REVEAL_PS],
      {
        timeout: 4000,
        windowsHide: true,
        env: { ...process.env, AG_REVEAL_TARGET: absPath }
      },
      (err, stdout) => {
        if (err) return resolve({ ok: false, error: 'stat_failed:ps_exec_failed' });
        const line = String(stdout || '').trim().split(/\r?\n/).pop() || '';
        if (line === 'OK:dir') return resolve({ ok: true, isDir: true });
        if (line === 'OK:file') return resolve({ ok: true, isDir: false });
        if (line.startsWith('ERR:')) return resolve({ ok: false, error: line.slice(4) || 'stat_failed' });
        return resolve({ ok: false, error: 'stat_failed:unexpected_output' });
      }
    );
  });
}

async function revealLocalPath(rawPath, { openFolderContents = false, wslDistro = '' } = {}) {
  const resolved = resolveHostRevealTarget(rawPath, { wslDistro });
  if (!resolved.ok) return resolved;
  const abs = resolved.path;
  let isDir = false;
  if (process.platform === 'win32' && resolved.kind !== 'wsl-unc' && resolved.kind !== 'wsl-posix') {
    const winCheck = await inspectWindowsLocalDrivePath(abs);
    if (!winCheck.ok) return { ok: false, error: winCheck.error, path: abs };
    isDir = winCheck.isDir;
  } else {
    try {
      if (process.platform === 'win32' && (resolved.kind === 'wsl-unc' || resolved.kind === 'wsl-posix')) {
        const mShare = abs.match(/^(\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+)(?:\\(.*))?$/i);
        if (!mShare) return { ok: false, error: 'invalid_wsl_unc', path: abs };
        let cur = `${mShare[1]}\\`;
        const rootSt = await fs.promises.lstat(cur);
        isDir = rootSt.isDirectory();
        const parts = String(mShare[2] || '').split('\\').filter(Boolean);
        for (const part of parts) {
          cur = path.win32.join(cur, part);
          const lst = await fs.promises.lstat(cur);
          if (lst.isSymbolicLink()) return { ok: false, error: 'reparse_point_blocked', path: cur };
          isDir = lst.isDirectory();
        }
      } else {
        const parts = abs.split('/').filter(Boolean);
        let cur = '/';
        const rootSt = await fs.promises.lstat(cur);
        isDir = rootSt.isDirectory();
        for (const part of parts) {
          cur = path.posix.join(cur, part);
          const lst = await fs.promises.lstat(cur);
          if (lst.isSymbolicLink()) return { ok: false, error: 'reparse_point_blocked', path: cur };
          isDir = lst.isDirectory();
        }
      }
    } catch (err) {
      const code = err && err.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { ok: false, error: 'not_found', path: abs };
      }
      return { ok: false, error: `stat_failed:${code || 'io_error'}`, path: abs };
    }
  }

  const openInside = openFolderContents && isDir;
  const spawnDetachedCheck = (bin, args, opts = {}) =>
    new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      try {
        const child = execFile(bin, args, { windowsHide: true, ...opts }, () => {});
        child.once('error', (err) => done({ ok: false, error: `spawn_failed:${err?.code || 'error'}`, path: abs }));
        child.once('spawn', () => done({ ok: true, path: abs }));
      } catch (err) {
        done({ ok: false, error: `spawn_failed:${err?.code || 'error'}`, path: abs });
      }
    });

  if (process.platform === 'darwin') {
    return spawnDetachedCheck('open', openInside ? [abs] : ['-R', abs]);
  }
  if (process.platform === 'win32') {
    const explorerBin = resolveTrustedWindowsExplorerBin();
    const isDriveOrShareRoot =
      /^[A-Za-z]:\\?$/.test(abs) || /^\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\?$/i.test(abs);
    if (openInside || isDriveOrShareRoot) {
      return spawnDetachedCheck(explorerBin, [abs]);
    }
    // Strip any trailing backslash on non-root paths so \" never escapes the closing quote in verbatim mode
    const cleanSelectPath = abs.replace(/\\+$/, '');
    return spawnDetachedCheck(explorerBin, [`/select,"${cleanSelectPath}"`], {
      windowsVerbatimArguments: true
    });
  }
  return spawnDetachedCheck('xdg-open', [openInside ? abs : path.dirname(abs)]);
}

function formatYamlScalar(raw, alwaysQuote = false) {
  const s = String(raw ?? '').replace(/\r?\n/g, ' ').trim();
  if (
    !alwaysQuote &&
    /^[A-Za-z0-9_\u4e00-\u9fff][A-Za-z0-9._\-\s\u4e00-\u9fff]*$/.test(s) &&
    !/[:#\[\]{}&*!|>'"%@`,?\\]/.test(s) &&
    !/^(?:true|false|null|yes|no|on|off|~)$/i.test(s)
  ) {
    return s;
  }
  return JSON.stringify(s);
}

function sanitizeSkillFolderName(rawName) {
  const cleaned = String(rawName || '')
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!cleaned || cleaned === '.' || cleaned === '..') return '';
  return cleaned;
}

export function createLocalSkill(payload, { skillsDir = GLOBAL_SKILLS_DIR } = {}) {
  const rawName = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  const instructions = String(payload?.instructions || '').replace(/\r\n/g, '\n').trim();
  if (!rawName || !description || !instructions) {
    return { ok: false, error: 'required_fields_missing' };
  }
  const folderName = sanitizeSkillFolderName(rawName);
  if (!folderName) return { ok: false, error: 'invalid_skill_name' };
  fs.mkdirSync(skillsDir, { recursive: true });
  const targetDir = path.join(skillsDir, folderName);
  if (!isPathInsideDir(skillsDir, targetDir)) return { ok: false, error: 'invalid_skill_path' };
  if (fs.existsSync(targetDir) && !payload?.overwrite) {
    return { ok: false, error: 'skill_already_exists' };
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const yamlName = formatYamlScalar(rawName, false);
  const yamlDesc = formatYamlScalar(description, true);
  const content = `---\nname: ${yamlName}\ndescription: ${yamlDesc}\n---\n\n${instructions}\n`;
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  writeAtomicUtf8(skillMdPath, content);
  return { ok: true, name: rawName, folderName, dirPath: targetDir, skillMdPath };
}

async function importLocalSkillNative() {
  const picked = await pickLocalFolderNative();
  if (!picked || !picked.ok || picked.canceled || !picked.folderPath) {
    return { ok: true, canceled: true };
  }
  const srcDir = path.resolve(picked.folderPath);
  const srcSkillMd = path.join(srcDir, 'SKILL.md');
  if (!fs.existsSync(srcSkillMd)) {
    return { ok: false, error: 'missing_skill_md' };
  }
  const baseName = sanitizeSkillFolderName(path.basename(srcDir));
  if (!baseName) return { ok: false, error: 'invalid_skill_name' };
  fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
  let destName = baseName;
  let destDir = path.join(GLOBAL_SKILLS_DIR, destName);
  let idx = 1;
  while (fs.existsSync(destDir)) {
    if (path.resolve(destDir) === srcDir) {
      return { ok: true, canceled: false, alreadyInstalled: true, folderName: destName, dirPath: destDir };
    }
    destName = `${baseName}-${idx++}`;
    destDir = path.join(GLOBAL_SKILLS_DIR, destName);
  }
  if (!isPathInsideDir(GLOBAL_SKILLS_DIR, destDir)) return { ok: false, error: 'invalid_skill_path' };
  fs.cpSync(srcDir, destDir, { recursive: true });
  return { ok: true, canceled: false, folderName: destName, dirPath: destDir, skillMdPath: path.join(destDir, 'SKILL.md') };
}

export function createLocalAgent(payload, { agentsDir = GLOBAL_AGENTS_DIR } = {}) {
  const rawName = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  const systemPrompt = String(payload?.systemPrompt || '').replace(/\r\n/g, '\n').trim();
  if (!rawName || !description || !systemPrompt) {
    return { ok: false, error: 'required_fields_missing' };
  }
  const fileSlug = sanitizeSkillFolderName(rawName);
  if (!fileSlug) return { ok: false, error: 'invalid_agent_name' };
  if (RESERVED_AGENT_NAMES.has(fileSlug.toLowerCase())) {
    return { ok: false, error: 'reserved_agent_name' };
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  const targetFile = path.join(agentsDir, `${fileSlug}.md`);
  if (!isPathInsideDir(agentsDir, targetFile)) return { ok: false, error: 'invalid_agent_path' };
  if (fs.existsSync(targetFile) && !payload?.overwrite) {
    return { ok: false, error: 'agent_already_exists' };
  }

  const roleMode = String(payload?.roleMode || 'subagent');
  const subagent = roleMode !== 'main_only';
  const mainAgent = roleMode === 'both' || roleMode === 'main_only';
  const rawTools = Array.isArray(payload?.tools) ? payload.tools : ['read_file', 'search_web'];
  const tools = rawTools.filter((t) => ALLOWED_AGENT_TOOLS.includes(t));
  const finalTools = tools.length ? tools : ['read_file'];

  const yamlName = formatYamlScalar(fileSlug, false);
  const yamlDesc = formatYamlScalar(description, true);
  const content = [
    '---',
    `name: ${yamlName}`,
    `description: ${yamlDesc}`,
    `subagent: ${subagent ? 'true' : 'false'}`,
    `mainAgent: ${mainAgent ? 'true' : 'false'}`,
    `tools: [${finalTools.join(', ')}]`,
    '---',
    '',
    systemPrompt,
    ''
  ].join('\n');
  writeAtomicUtf8(targetFile, content);
  return { ok: true, name: fileSlug, filePath: targetFile, dirPath: agentsDir };
}

async function importLocalAgentNative() {
  const picked = await pickLocalFilesNative();
  if (!picked || !picked.ok || picked.canceled || !Array.isArray(picked.paths) || picked.paths.length === 0) {
    return { ok: true, canceled: true };
  }
  const mdFiles = picked.paths.filter((p) => /\.md$/i.test(p) && fs.existsSync(p));
  if (!mdFiles.length) return { ok: false, error: 'missing_md_file' };
  fs.mkdirSync(GLOBAL_AGENTS_DIR, { recursive: true });
  const imported = [];
  for (const src of mdFiles) {
    const absSrc = path.resolve(src);
    const stem = sanitizeSkillFolderName(path.basename(absSrc, path.extname(absSrc)));
    if (!stem) continue;
    let destName = stem;
    let destPath = path.join(GLOBAL_AGENTS_DIR, `${destName}.md`);
    let idx = 1;
    while (fs.existsSync(destPath)) {
      if (path.resolve(destPath) === absSrc) break;
      destName = `${stem}-${idx++}`;
      destPath = path.join(GLOBAL_AGENTS_DIR, `${destName}.md`);
    }
    if (!isPathInsideDir(GLOBAL_AGENTS_DIR, destPath)) continue;
    if (path.resolve(destPath) !== absSrc) fs.copyFileSync(absSrc, destPath);
    imported.push({ name: destName, filePath: destPath });
  }
  if (!imported.length) return { ok: false, error: 'invalid_agent_name' };
  return { ok: true, canceled: false, imported, dirPath: GLOBAL_AGENTS_DIR };
}

const CONNECTOR_DISPLAY_OVERRIDES = {
  'chrome-devtools': 'Chrome devtools',
  'chrome-devtools_chrome-devtools': 'Chrome devtools',
  github: 'GitHub',
  gitlab: 'GitLab',
  playwright: 'Playwright',
  perplexity: 'Perplexity',
  gdrive: 'Google Drive',
  gcalendar: 'Google Calendar'
};

function prettifyConnectorName(rawId) {
  const s = String(rawId || '').trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (CONNECTOR_DISPLAY_OVERRIDES[lower]) return CONNECTOR_DISPLAY_OVERRIDES[lower];
  const spaced = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : s;
}

const overviewGitCache = new Map();
const overviewGitInFlight = new Map();

function execGitAsync(absDir, args, timeoutMs = 1200) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.fsmonitor=false', '-C', absDir, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(String(stdout || ''));
      }
    );
  });
}

function parseNumstatOutput(numstat) {
  let added = 0;
  let deleted = 0;
  if (!numstat) return { added, deleted };
  for (const line of numstat.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const a = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      if (Number.isFinite(a)) added += a;
      if (Number.isFinite(d)) deleted += d;
    }
  }
  return { added, deleted };
}

export async function readOverviewGitStatusAsync(absDir) {
  const now = Date.now();
  const cached = overviewGitCache.get(absDir);
  if (cached && now - cached.ts < 8000) return cached.git;
  if (overviewGitInFlight.has(absDir)) return overviewGitInFlight.get(absDir);

  const task = (async () => {
    let git = null;
    try {
      const statusOut = await execGitAsync(absDir, ['status', '--porcelain=v2', '--branch'], 1200);
      if (statusOut !== null) {
        let branch = '';
        let isUnborn = false;
        let changedFiles = 0;
        let trackedChangedFiles = 0;
        for (const line of statusOut.split(/\r?\n/)) {
          if (!line) continue;
          if (line.startsWith('# branch.head ')) {
            const rawHead = line.slice('# branch.head '.length).trim();
            branch = rawHead === '(detached)' ? 'HEAD' : rawHead;
          } else if (line.startsWith('# branch.oid ')) {
            if (line.slice('# branch.oid '.length).trim() === '(initial)') {
              isUnborn = true;
            }
          } else if (!line.startsWith('#')) {
            changedFiles += 1;
            if (/^(?:1|2|u)\s/.test(line)) {
              trackedChangedFiles += 1;
            }
          }
        }
        if (branch) {
          let numstatText = '';
          if (trackedChangedFiles > 0) {
            if (isUnborn) {
              const [unstaged, staged] = await Promise.all([
                execGitAsync(absDir, ['diff', '--numstat'], 1000),
                execGitAsync(absDir, ['diff', '--cached', '--numstat'], 1000)
              ]);
              numstatText = `${unstaged || ''}\n${staged || ''}`;
            } else {
              const headNumstat = await execGitAsync(absDir, ['diff', 'HEAD', '--numstat'], 1200);
              if (headNumstat !== null) {
                numstatText = headNumstat;
              } else {
                const [unstaged, staged] = await Promise.all([
                  execGitAsync(absDir, ['diff', '--numstat'], 1000),
                  execGitAsync(absDir, ['diff', '--cached', '--numstat'], 1000)
                ]);
                numstatText = `${unstaged || ''}\n${staged || ''}`;
              }
            }
          }
          const { added, deleted } = parseNumstatOutput(numstatText);
          git = { branch, added, deleted, changedFiles };
        }
      }
    } catch {
      git = null;
    }
    setBounded(overviewGitCache, absDir, { ts: Date.now(), git }, 32);
    return git;
  })().finally(() => {
    overviewGitInFlight.delete(absDir);
  });

  overviewGitInFlight.set(absDir, task);
  return task;
}

function scanSkillsDirectory(dirPath, source, skillMap) {
  if (!dirPath) return;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
    if (ent.name.startsWith('.')) continue;
    const skillDir = path.join(dirPath, ent.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    const st = fs.statSync(skillMd, { throwIfNoEntry: false });
    if (!st || !st.isFile()) continue;
    if (!skillMap.has(ent.name)) {
      skillMap.set(ent.name, { name: ent.name, path: skillMd, source });
    }
  }
}

function collectEnabledPlugins(configDir) {
  const rootCfg = readJsonOrFallback(path.join(configDir, 'config.json'), {});
  const pluginsCfg = rootCfg && typeof rootCfg.plugins === 'object' && rootCfg.plugins ? rootCfg.plugins : {};
  const pluginsRoot = path.join(configDir, 'plugins');
  const pluginNames = new Set(Object.keys(pluginsCfg));
  try {
    for (const ent of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
      if ((ent.isDirectory() || ent.isSymbolicLink()) && !ent.name.startsWith('.')) {
        pluginNames.add(ent.name);
      }
    }
  } catch {}
  const enabled = [];
  for (const name of pluginNames) {
    const cfg = pluginsCfg[name];
    if (cfg && typeof cfg === 'object' && cfg.enabled === false) continue;
    const dir = path.join(pluginsRoot, name);
    const st = fs.statSync(dir, { throwIfNoEntry: false });
    if (st && st.isDirectory()) {
      enabled.push({
        name,
        cfg: cfg && typeof cfg === 'object' ? cfg : {},
        dir
      });
    }
  }
  return enabled;
}

export function collectOverviewSnapshot(payload = {}, opts = {}) {
  const explicitOverride = Boolean(opts.homeDir || opts.geminiDir || opts.configDir || opts.skillsDir || opts.agentsDir);
  const homeDir = opts.homeDir ? path.resolve(opts.homeDir) : HOME;
  const geminiDir = opts.geminiDir ? path.resolve(opts.geminiDir) : path.join(homeDir, '.gemini');
  const configDir = opts.configDir ? path.resolve(opts.configDir) : path.join(geminiDir, 'config');
  const skillsDir = opts.skillsDir ? path.resolve(opts.skillsDir) : GLOBAL_SKILLS_DIR;
  const agentsDir = opts.agentsDir ? path.resolve(opts.agentsDir) : GLOBAL_AGENTS_DIR;
  const builtinSkillsDir = opts.builtinSkillsDir
    ? path.resolve(opts.builtinSkillsDir)
    : path.join(geminiDir, 'antigravity', 'builtin', 'skills');
  const extraGeminiDirs = Array.isArray(opts.extraGeminiDirs)
    ? opts.extraGeminiDirs.filter((d) => typeof d === 'string' && d.trim())
    : explicitOverride
      ? []
      : discoverWslGeminiDirs();
  const skipGit = Boolean(opts.skipGit);

  let absDir = '';
  const rawDir = typeof payload?.dirPath === 'string' ? payload.dirPath.trim() : '';
  if (rawDir) {
    const resolved = resolveLocalProjectDir(rawDir);
    if (resolved) absDir = resolved;
  }

  const workspace = {
    dirPath: absDir,
    name: absDir ? path.basename(absDir) || absDir : '',
    git: opts.gitResolved !== undefined ? opts.gitResolved : null
  };

  const sources = [
    {
      geminiDir,
      configDir,
      skillsDir,
      agentsDir,
      builtinSkillsDir
    }
  ];
  const seenGeminiRoots = new Set([normalizePathForCompare(geminiDir)]);
  for (const extraDir of extraGeminiDirs) {
    const norm = normalizePathForCompare(extraDir);
    if (seenGeminiRoots.has(norm)) continue;
    seenGeminiRoots.add(norm);
    const eCfg = path.join(extraDir, 'config');
    sources.push({
      geminiDir: extraDir,
      configDir: eCfg,
      skillsDir: path.join(eCfg, 'skills'),
      agentsDir: path.join(eCfg, 'agents'),
      builtinSkillsDir: path.join(extraDir, 'antigravity', 'builtin', 'skills')
    });
  }

  const sourcePlugins = sources.map((src) => ({ src, enabledPlugins: collectEnabledPlugins(src.configDir) }));

  /* 1. Rules / Memory files */
  const rules = [];
  const seenRuleLabels = new Set();
  for (const { src } of sourcePlugins) {
    const globalAgentsPath = path.join(src.geminiDir, 'AGENTS.md');
    const globalAst = fs.statSync(globalAgentsPath, { throwIfNoEntry: false });
    if (globalAst && globalAst.isFile() && !seenRuleLabels.has('global:~/.gemini/AGENTS.md')) {
      seenRuleLabels.add('global:~/.gemini/AGENTS.md');
      rules.push({
        label: '~/.gemini/AGENTS.md',
        path: globalAgentsPath,
        scope: 'global',
        bytes: globalAst.size
      });
    }
  }
  if (absDir) {
    const projAgentsPath = path.join(absDir, 'AGENTS.md');
    const projAst = fs.statSync(projAgentsPath, { throwIfNoEntry: false });
    if (projAst && projAst.isFile()) {
      rules.push({
        label: 'AGENTS.md',
        path: projAgentsPath,
        scope: 'project',
        bytes: projAst.size
      });
    }
  }
  for (const { enabledPlugins } of sourcePlugins) {
    for (const pl of enabledPlugins) {
      const rulesDir = path.join(pl.dir, 'rules');
      let ruleFiles = [];
      try {
        ruleFiles = fs.readdirSync(rulesDir).filter((f) => /\.md$/i.test(f));
      } catch {}
      for (const file of ruleFiles) {
        const label = `${pl.name}/${file}`;
        if (seenRuleLabels.has(`plugin:${label}`)) continue;
        const fp = path.join(rulesDir, file);
        const st = fs.statSync(fp, { throwIfNoEntry: false });
        if (st && st.isFile()) {
          seenRuleLabels.add(`plugin:${label}`);
          rules.push({
            label,
            path: fp,
            scope: 'plugin',
            bytes: st.size
          });
        }
      }
    }
  }

  /* 2. Skills (priority: user > plugin > builtin) */
  const skillMap = new Map();
  for (const { src } of sourcePlugins) scanSkillsDirectory(src.skillsDir, 'user', skillMap);
  for (const { enabledPlugins } of sourcePlugins) {
    for (const pl of enabledPlugins) {
      scanSkillsDirectory(path.join(pl.dir, 'skills'), 'plugin', skillMap);
    }
  }
  for (const { src } of sourcePlugins) scanSkillsDirectory(src.builtinSkillsDir, 'builtin', skillMap);
  const rankSource = { user: 0, plugin: 1, builtin: 2 };
  const allSkills = Array.from(skillMap.values()).sort((a, b) => {
    const r = (rankSource[a.source] ?? 9) - (rankSource[b.source] ?? 9);
    return r !== 0 ? r : a.name.localeCompare(b.name);
  });
  const userCount = allSkills.filter((s) => s.source === 'user').length;
  const skills = {
    total: allSkills.length,
    userCount,
    items: allSkills.slice(0, 80)
  };

  /* 3. Custom Agents */
  const agentItems = [];
  const seenAgentNames = new Set();
  const collectAgentMd = (dirPath, source) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if ((!ent.isFile() && !ent.isSymbolicLink()) || !/\.md$/i.test(ent.name)) continue;
      const name = ent.name.replace(/\.md$/i, '');
      if (seenAgentNames.has(name)) continue;
      seenAgentNames.add(name);
      agentItems.push({ name, path: path.join(dirPath, ent.name), source });
    }
  };
  for (const { src } of sourcePlugins) collectAgentMd(src.agentsDir, 'user');
  for (const { enabledPlugins } of sourcePlugins) {
    for (const pl of enabledPlugins) {
      collectAgentMd(path.join(pl.dir, 'agents'), 'plugin');
    }
  }
  const agents = { total: agentItems.length, items: agentItems };

  /* 4. Connectors (never expose env/args/headers/command/tokens) */
  const connectors = [];
  const seenConnIds = new Set();
  for (const { src, enabledPlugins } of sourcePlugins) {
    const rootMcpPath = path.join(src.configDir, 'mcp_config.json');
    const rootMcp = readJsonOrFallback(rootMcpPath, null);
    if (rootMcp && typeof rootMcp.mcpServers === 'object' && rootMcp.mcpServers) {
      for (const [id, def] of Object.entries(rootMcp.mcpServers)) {
        if (!def || def.disabled === true || seenConnIds.has(id)) continue;
        seenConnIds.add(id);
        connectors.push({ id, name: prettifyConnectorName(id), kind: 'mcp', configPath: rootMcpPath });
      }
    }
    for (const pl of enabledPlugins) {
      const plMcpPath = path.join(pl.dir, 'mcp_config.json');
      const plMcp = readJsonOrFallback(plMcpPath, null);
      if (plMcp && typeof plMcp.mcpServers === 'object' && plMcp.mcpServers) {
        for (const [id, def] of Object.entries(plMcp.mcpServers)) {
          if (!def || def.disabled === true || seenConnIds.has(id)) continue;
          seenConnIds.add(id);
          connectors.push({ id, name: prettifyConnectorName(id), kind: 'mcp', configPath: plMcpPath });
        }
      }
      const plJsonPath = path.join(pl.dir, 'plugin.json');
      const plJson = readJsonOrFallback(plJsonPath, null);
      const hasAuth = fs.existsSync(path.join(pl.dir, 'auth.json'));
      const isExternalConnector = Boolean(
        plJson && (pl.cfg.installedFrom || plJson.auth || plJson.cli || plJson.mcp || hasAuth)
      );
      if (isExternalConnector && !seenConnIds.has(pl.name)) {
        seenConnIds.add(pl.name);
        connectors.push({
          id: pl.name,
          name: String(plJson.displayName || plJson.name || prettifyConnectorName(pl.name)),
          kind: 'plugin',
          configPath: plJsonPath
        });
      }
    }
  }

  return { ok: true, workspace, rules, skills, agents, connectors };
}

const USAGE_LEDGER_CACHE_FILE = path.join(STATE_DIR, 'usage-ledger-cache.json');
let usageLedgerMem = null; // { cachePath, entries: Map<dbPath, { sig, mtimeMs, byDay }> }
let usageSummaryMemo = { at: 0, key: '', data: null };
const usageReadFailUntil = new Map();
const THOUGHT_TRANSLATE_CACHE_FILE = path.join(
  os.homedir(),
  '.gemini',
  'antigravity',
  'prism-suite',
  'thought-translation-cache.json'
);
const MODEL_HUB_CONFIG_FILE = path.join(os.homedir(), '.gemini', 'antigravity', 'prism-suite', 'model-hub.json');
const TRANSLATE_CACHE_TTL_MS = 7 * 86400 * 1000;
const TRANSLATE_CACHE_MAX_ENTRIES = 300;
const translateCache = new Map(); // hash -> { v: string, t: number }
const translateChunkCache = new Map(); // masked chunk hash -> translated string
let translateCacheLoaded = false;
let translateCacheWriteTimer = null;

function flushTranslateCacheSync() {
  const dir = path.dirname(THOUGHT_TRANSLATE_CACHE_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  const now = Date.now();
  const entries = {};
  for (const [k, rec] of translateCache.entries()) {
    if (!rec || typeof rec.v !== 'string' || !rec.v || now - (Number(rec.t) || 0) > TRANSLATE_CACHE_TTL_MS) {
      translateCache.delete(k);
      continue;
    }
    entries[k] = { v: rec.v, t: Math.floor(Number(rec.t) || now) };
  }
  const target = resolveAtomicWriteTarget(THOUGHT_TRANSLATE_CACHE_FILE);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const body = `${JSON.stringify({ schema: 1, updatedAt: now, entries })}\n`;
  try {
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {}
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

function scheduleTranslateCacheWrite() {
  if (translateCacheWriteTimer) clearTimeout(translateCacheWriteTimer);
  translateCacheWriteTimer = setTimeout(() => {
    translateCacheWriteTimer = null;
    try {
      flushTranslateCacheSync();
    } catch {}
  }, 1200);
  if (translateCacheWriteTimer && typeof translateCacheWriteTimer.unref === 'function') {
    translateCacheWriteTimer.unref();
  }
}

function ensureTranslateCacheLoaded() {
  if (translateCacheLoaded) return;
  translateCacheLoaded = true;
  const raw = readJsonOrFallback(THOUGHT_TRANSLATE_CACHE_FILE, null);
  if (!raw || typeof raw !== 'object' || !raw.entries || typeof raw.entries !== 'object') return;
  const now = Date.now();
  let pruned = false;
  const validItems = [];
  for (const [k, val] of Object.entries(raw.entries)) {
    if (!k || !val || typeof val !== 'object') {
      pruned = true;
      continue;
    }
    const v = typeof val.v === 'string' ? val.v : '';
    const t = Number(val.t) || 0;
    if (!v || t <= 0 || now - t > TRANSLATE_CACHE_TTL_MS) {
      pruned = true;
      continue;
    }
    validItems.push([k, { v, t }]);
  }
  if (validItems.length > TRANSLATE_CACHE_MAX_ENTRIES) {
    validItems.sort((a, b) => a[1].t - b[1].t);
    validItems.splice(0, validItems.length - TRANSLATE_CACHE_MAX_ENTRIES);
    pruned = true;
  }
  for (const [k, rec] of validItems) {
    translateCache.set(k, rec);
  }
  if (pruned) scheduleTranslateCacheWrite();
}

function getTranslateCacheEntry(key) {
  const rec = translateCache.get(key);
  if (!rec) return null;
  if (!rec.v || typeof rec.v !== 'string' || Date.now() - (Number(rec.t) || 0) > TRANSLATE_CACHE_TTL_MS) {
    translateCache.delete(key);
    return null;
  }
  translateCache.delete(key);
  translateCache.set(key, rec);
  return rec.v;
}

function setTranslateCacheEntry(key, val) {
  if (!val || typeof val !== 'string') return;
  if (translateCache.has(key)) translateCache.delete(key);
  translateCache.set(key, { v: val, t: Date.now() });
  while (translateCache.size > TRANSLATE_CACHE_MAX_ENTRIES) {
    const oldest = translateCache.keys().next().value;
    if (oldest === undefined) break;
    translateCache.delete(oldest);
  }
  scheduleTranslateCacheWrite();
}

function clearTranslateCacheStore() {
  translateCacheLoaded = true;
  translateCache.clear();
  translateChunkCache.clear();
  if (translateCacheWriteTimer) {
    clearTimeout(translateCacheWriteTimer);
    translateCacheWriteTimer = null;
  }
  try {
    if (fs.existsSync(THOUGHT_TRANSLATE_CACHE_FILE)) {
      fs.unlinkSync(THOUGHT_TRANSLATE_CACHE_FILE);
    }
  } catch {}
}

const PRISM_PROFILE_FILE = path.join(STATE_DIR, 'prism-profile.json');

export function redactSensitiveOutboundText(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  // 1) PEM / OpenPGP private keys (including truncated tail blocks)
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    '[REDACTED]'
  );
  // 2) URLs with embedded user:password@ credentials (preserve scheme, redact credentials)
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[REDACTED]@');
  // 3) Bearer / Basic Authorization headers
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]');
  // 4) Well-known API key, OAuth, PAT, AWS, JWT, HuggingFace, Stripe & Slack token prefixes
  out = out.replace(
    /\b(?:sk-[A-Za-z0-9_-]{16,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?:AKIA|ASIA)[0-9A-Z]{16}|ya29\.[A-Za-z0-9._-]{20,}|1\/\/0[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}|hf_[A-Za-z0-9]{20,}|[rs]k_live_[A-Za-z0-9]{16,}|xox[a-z]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b/g,
    '[REDACTED]'
  );
  // 5) Key-value & JSON secret/password/token assignments
  out = out.replace(
    /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\s"',;}\])`<>]{4,}/gi,
    '$1[REDACTED]'
  );
  return out;
}

function maskThoughtProtectedSpans(rawText) {
  const originals = [];
  const put = (segment) => {
    const idx = originals.length;
    originals.push(segment);
    return `⟪P${idx}⟫`;
  };
  let out = String(rawText || '');
  // 0) Redaction markers (keep exact [REDACTED] token untranslated)
  out = out.replace(/\[REDACTED\]/g, (m) => put(m));
  // 1) Fenced code blocks (masked before chunk splitting so code blocks never split across chunks)
  out = out.replace(/```[\s\S]*?```/g, (m) => put(m));
  // 2) Inline code spans
  out = out.replace(/`[^`\n]{1,240}`/g, (m) => put(m));
  // 3) URLs
  out = out.replace(/\b(?:https?|file|vscode-webview):\/\/[^\s<>)"']+/gi, (m) => put(m));
  // 4) File paths with optional line references (linear non-backtracking)
  out = out.replace(
    /(?:^|(?<=[\s([{"']))(?:\/[A-Za-z0-9._-]+){2,}(?::\d+(?:-\d+)?)?|[A-Za-z]:\\(?:[^\s<>:"|?*`\r\n\\]+\\)*[^\s<>:"|?*`\r\n\\]+/gm,
    (m) => put(m)
  );
  // 5) Code identifiers (camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE >= 4 chars, never touching ⟪P...⟫)
  out = out.replace(
    /(?<!⟪)\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Za-z]+_[A-Za-z0-9_]+)\b/g,
    (m) => (m.length >= 4 ? put(m) : m)
  );
  return { masked: out, originals };
}

function unmaskThoughtProtectedSpans(text, originals) {
  if (!text || !Array.isArray(originals) || originals.length === 0) return text;
  return String(text).replace(/⟪\s*P\s*(\d+)\s*⟫/gi, (full, numStr) => {
    const idx = Number(numStr);
    return Number.isInteger(idx) && idx >= 0 && idx < originals.length ? originals[idx] : full;
  });
}

function splitTextForTranslation(text, maxChunkLen = 950) {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  const pushCur = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChunkLen) {
      if (cur && cur.length + 2 + p.length > maxChunkLen) pushCur();
      cur = cur ? `${cur}\n\n${p}` : p;
      continue;
    }
    pushCur();
    const sentences = p.split(/(?<=[.!?\n])\s+/);
    let buf = '';
    for (const sent of sentences) {
      if (sent.length <= maxChunkLen) {
        if (buf && buf.length + 1 + sent.length > maxChunkLen) {
          chunks.push(buf.trim());
          buf = '';
        }
        buf = buf ? `${buf} ${sent}` : sent;
      } else {
        if (buf.trim()) {
          chunks.push(buf.trim());
          buf = '';
        }
        for (let i = 0; i < sent.length; i += maxChunkLen) {
          chunks.push(sent.slice(i, i + maxChunkLen));
        }
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  }
  pushCur();
  return chunks.slice(0, 12);
}

async function translateChunk(chunk, tl, fetchFn = fetch) {
  const safeChunk = redactSensitiveOutboundText(chunk);
  const cKey = `c:${tl}:${crypto.createHash('sha1').update(safeChunk).digest('hex')}`;
  if (translateChunkCache.has(cKey)) return translateChunkCache.get(cKey);
  let tier1Err = null;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(safeChunk)}`;
    const res = await fetchFn(url, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    const translated = Array.isArray(data?.[0]) ? data[0].map((seg) => (Array.isArray(seg) ? seg[0] || '' : '')).join('') : '';
    if (!translated) throw new Error('empty_translation');
    setBounded(translateChunkCache, cKey, translated, 384);
    return translated;
  } catch (err) {
    tier1Err = err;
  }

  const fallbackUrl = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(safeChunk)}`;
  const res2 = await fetchFn(fallbackUrl, { signal: AbortSignal.timeout(6000), redirect: 'error' });
  if (!res2.ok) throw new Error(`http_${res2.status}`);
  const data2 = await res2.json();
  const translated2 = Array.isArray(data2)
    ? typeof data2[0] === 'string'
      ? data2.join('')
      : Array.isArray(data2[0])
        ? data2[0].map((x) => (Array.isArray(x) ? x[0] || '' : typeof x === 'string' ? x : '')).join('')
        : ''
    : data2?.sentences
      ? data2.sentences.map((s) => s?.trans || '').join('')
      : '';
  if (!translated2) throw tier1Err || new Error('empty_translation');
  setBounded(translateChunkCache, cKey, translated2, 384);
  return translated2;
}

export async function translateThoughtText(rawText, targetLang = 'zh-CN', opts = {}) {
  const rawTrimmed = String(rawText || '').trim();
  if (!rawTrimmed) return { ok: true, translated: '', skipped: true };
  ensureTranslateCacheLoaded();
  const preClipped = rawTrimmed.length > 14000 ? rawTrimmed.slice(0, 14000) : rawTrimmed;
  const redacted = redactSensitiveOutboundText(preClipped);
  const clipped = redacted.length > 10000 ? redacted.slice(0, 10000) : redacted;
  const tl = /^[a-zA-Z-]{2,10}$/.test(String(targetLang || '')) ? String(targetLang) : 'zh-CN';
  const cacheKey = `${tl}:${crypto.createHash('sha1').update(clipped).digest('hex')}`;
  const cachedHit = getTranslateCacheEntry(cacheKey);
  if (cachedHit !== null) {
    return { ok: true, translated: cachedHit, cached: true };
  }

  const { masked, originals } = maskThoughtProtectedSpans(clipped);
  const proseOnly = masked.replace(/⟪P\d+⟫/g, '');
  const cjkCount = (proseOnly.match(/[\u4e00-\u9fff]/g) || []).length;
  const alphaCount = (proseOnly.match(/[A-Za-z]/g) || []).length;
  if (alphaCount === 0 || (cjkCount > 0 && cjkCount / Math.max(1, cjkCount + alphaCount) >= 0.55)) {
    return { ok: true, translated: clipped, skipped: true };
  }

  const fetchFn = typeof opts?.fetchFn === 'function' ? opts.fetchFn : fetch;
  try {
    const chunks = splitTextForTranslation(masked, 950);
    const out = [];
    for (const ch of chunks) {
      out.push(await translateChunk(ch, tl, fetchFn));
    }
    const translated = unmaskThoughtProtectedSpans(out.join('\n\n'), originals);
    setTranslateCacheEntry(cacheKey, translated);
    return { ok: true, translated, truncated: rawTrimmed.length > 10000 };
  } catch (err) {
    return { ok: false, error: String(err?.name || err?.message || 'translate_failed') };
  }
}

export { translateThoughtText as translateTextAction };

export function isAllowedModelHubEndpointUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === '0.0.0.0' ||
      host === '::' ||
      host === '0:0:0:0:0:0:0:0' ||
      host === '::ffff:0:0' ||
      host === '::ffff:0.0.0.0' ||
      host === '100.100.100.200' ||
      host === '::ffff:6464:64c8' ||
      host === '::ffff:100.100.100.200' ||
      host === 'fd00:ec2::254' ||
      host === 'metadata' ||
      host === 'metadata.google.internal' ||
      host.endsWith('.internal') ||
      host.startsWith('169.254.') ||
      host.startsWith('fe80:') ||
      host.startsWith('::ffff:169.254.') ||
      host.startsWith('::ffff:a9fe:') ||
      host.startsWith('0:0:0:0:0:ffff:a9fe:') ||
      host.startsWith('64:ff9b::a9fe:') ||
      host.startsWith('64:ff9b::169.254.')
    ) {
      return false;
    }

    let ipv4Octets = null;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octs = ipv4.slice(1).map(Number);
      if (octs.some((o) => o < 0 || o > 255)) return false;
      ipv4Octets = octs;
    } else {
      const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        ipv4Octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
      }
    }
    if (ipv4Octets) {
      const [a, b, c, d] = ipv4Octets;
      if (a === 0 || (a === 169 && b === 254) || (a === 100 && b === 100 && c === 100 && d === 200)) {
        return false;
      }
    }

    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    if (host === 'localhost' || host === '::1') return true;
    if (host.endsWith('.ts.net') && host.length > 7) return true;
    if (!ipv4Octets) return false;
    const [a, b] = ipv4Octets;
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  } catch {
    return false;
  }
}

const BLOCKED_ENV_VAR_EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SHELL',
  'PWD',
  'OLDPWD',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'GL_TOKEN',
  'NPM_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET',
  'AZURE_TENANT_ID',
  'GOOGLE_APPLICATION_CREDENTIALS'
]);

const BLOCKED_ENV_VAR_PREFIX_RE =
  /^(?:GITHUB_|GH_|GITLAB_|BITBUCKET_|AWS_|AZURE_CLIENT_|AZURE_TENANT_|AZURE_FEDERATED_|AZURE_SUBSCRIPTION_|NPM_|YARN_|PNPM_|PYPI_|CARGO_|DOCKER_|KUBE|VAULT_|TERRAFORM_|CLOUDFLARE_|CF_|SLACK_|DISCORD_|TELEGRAM_|STRIPE_|TWILIO_|SENDGRID_|DATABASE_|DB_|POSTGRES_|MYSQL_|REDIS_|MONGO_|SSH_|GPG_|GNUPG_|ANTIGRAVITY_|VSCODE_|CHROME_|PRISM_CUA_|SESSION_|COOKIE_|CSRF_)/;

const SAFE_LLM_ENV_HINT_RE =
  /(?:API_KEY|API_TOKEN|LLM|MODEL|HUB|PRISM|CPA|OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE_AI|VERTEX|DEEPSEEK|DASHSCOPE|QWEN|MOONSHOT|KIMI|ZHIPU|GLM|MISTRAL|GROQ|TOGETHER|FIREWORKS|OPENROUTER|SILICONFLOW|VOLC|ARK|XAI|GROK|COHERE|PERPLEXITY|OLLAMA|LITELLM|ONEAPI|NEWAPI|VLLM|LMSTUDIO)/;

export function isSafeLlmApiKeyEnvName(rawName) {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(name)) return false;
  if (BLOCKED_ENV_VAR_EXACT.has(name)) return false;
  if (BLOCKED_ENV_VAR_PREFIX_RE.test(name)) return false;
  if (!/(?:_KEY|_TOKEN|_SECRET)$/.test(name)) return false;
  return SAFE_LLM_ENV_HINT_RE.test(name);
}

function predictNextPromptHeuristic(lastAssistantText) {
  const text = String(lastAssistantText || '').trim();
  const tail = text.slice(-320);
  const asksQuestion = /[?？]|(?:是否|要不要|需要我|确认|可以吗|好吗|行吗|如何|怎么样|请告知|告诉我|反馈)/.test(tail);
  const asksToRelease = /(?:是否|要不要|需要我|帮您|帮你).{0,16}(?:打包|发布|发版|推送|补发\s*v?\d+\.\d+)/i.test(tail);

  if (asksToRelease || (/(?:打包发布|补发\s*v?\d+\.\d+|发版|推送.*Release)/i.test(tail) && asksQuestion)) {
    return '确认无误，请打包发布新版本';
  }
  if (/(?:已正式发布|已经正式发布|发布上线|本机无需重装|无需任何额外操作)/.test(text) && !asksToRelease) {
    return '实际体验一下新功能细节，看看还有哪里可以打磨';
  }
  if (/(?:测试|验收|试试|看一眼|感受一下|已消除|实时生效)/.test(tail) && asksQuestion) {
    return '界面效果已经正常了，请继续收尾提交';
  }
  if (/(?:报错|异常|根因|失败)/.test(tail)) {
    return '请按定位的根因修复并运行测试验证';
  }
  if (/(?:方案|选项)/.test(tail) || (/(?:^|\s)1[.、)]/.test(tail) && /(?:^|\s)2[.、)]/.test(tail))) {
    return '按你的推荐方案继续落地执行';
  }
  if (/(?:待合入|候选更新|是否合入|巡检报告)/.test(tail)) {
    return '合入高优先级兼容项并运行回归测试';
  }
  return '继续检查还有没有遗漏细节需要优化';
}

export async function predictNextPromptAction(payload, opts = {}) {
  const rawUserTail = String(payload?.lastUserText || '').trim().slice(-4000);
  const rawAssistantTail = String(payload?.lastAssistantText || '').trim().slice(-6000);
  const lastUserText = redactSensitiveOutboundText(rawUserTail).slice(-900);
  const lastAssistantText = redactSensitiveOutboundText(rawAssistantTail).slice(-1400);

  if (lastAssistantText || lastUserText) {
    const profileFile = opts.profileFile || process.env.PRISM_PROFILE_PATH || PRISM_PROFILE_FILE;
    const hubFile = opts.modelHubFile || process.env.PRISM_MODEL_HUB_FILE || MODEL_HUB_CONFIG_FILE;
    const env = opts.env || process.env;
    const fetchFn = typeof opts.fetchFn === 'function' ? opts.fetchFn : fetch;

    const configSources = [
      { kind: 'profile', raw: readJsonOrFallback(profileFile, null) },
      { kind: 'legacy', raw: readJsonOrFallback(hubFile, null) }
    ];

    for (const { kind, raw: rawHub } of configSources) {
      if (!rawHub || typeof rawHub !== 'object') continue;
      const candidates = Array.isArray(rawHub)
        ? rawHub
        : Array.isArray(rawHub.endpoints)
          ? rawHub.endpoints
          : Array.isArray(rawHub.providers)
            ? rawHub.providers
            : rawHub.baseUrl
              ? [rawHub]
              : [];
      const topModels = Array.isArray(rawHub.models) ? rawHub.models : [];

      for (const ep of candidates) {
        if (!ep || typeof ep !== 'object' || ep.enabled === false) continue;
        if (ep.protocol && !/^openai/i.test(String(ep.protocol))) continue;
        const baseUrl = String(ep.baseUrl || '').trim().replace(/\/+$/, '');
        if (!baseUrl) continue;

        const authMode = String(ep.authMode || '').trim().toLowerCase();
        const envKeyName = typeof ep.apiKeyEnv === 'string' ? ep.apiKeyEnv.trim() : '';
        const envApiKey = envKeyName && isSafeLlmApiKeyEnvName(envKeyName) ? String(env[envKeyName] || '').trim() : '';
        const directApiKey = kind === 'legacy' && typeof ep.apiKey === 'string' ? ep.apiKey.trim() : '';
        const apiKey = envApiKey || directApiKey;
        const allowKeylessLocal = authMode === 'none';
        if (!apiKey && !allowKeylessLocal) continue;

        const chatUrl = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
        if (!isAllowedModelHubEndpointUrl(chatUrl)) continue;

        const rawModels = Array.isArray(ep.models)
          ? ep.models
          : ep.id
            ? topModels.filter((m) => m && m.providerId === ep.id && m.enabled !== false)
            : topModels;
        const modelIds = rawModels
          .filter((m) => (typeof m === 'string' ? true : m && m.enabled !== false))
          .map((m) =>
            typeof m === 'string'
              ? m.trim()
              : String(m.upstreamModel || m.modelId || m.model || m.name || m.id || '').trim()
          )
          .filter(Boolean);
        const chosenModel = modelIds.find((id) => /flash|mini|haiku/i.test(id)) || modelIds[0] || '';
        if (!chosenModel) continue;

        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

        try {
          const res = await fetchFn(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: chosenModel,
              max_tokens: 42,
              temperature: 0.3,
              messages: [
                {
                  role: 'system',
                  content:
                    '基于最后一轮问答（重点依据助手回复末尾的最新结论或提问，忽略前文已完结的历史背景），站在用户角度预测用户下一步最可能输入的一句简短中文指令（10~24字，直接输出指令本身，不要引号、句号或解释）。'
                },
                {
                  role: 'user',
                  content: `${lastUserText ? `【用户上一句】\n${lastUserText}\n\n` : ''}【助手最新回复】\n${lastAssistantText}`
                }
              ]
            }),
            signal: AbortSignal.timeout(2800),
            redirect: 'error'
          });
          if (!res.ok) continue;
          const data = await res.json();
          const rawContent = String(data?.choices?.[0]?.message?.content || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[\s"'“”‘’「」『』`]+|[\s"'“”‘’「」『』`。！.!]+$/g, '')
            .trim();
          if (rawContent.length >= 4 && rawContent.length <= 48) {
            return { ok: true, suggestion: rawContent, source: 'ai' };
          }
        } catch {}
      }
    }
  }

  return {
    ok: true,
    suggestion: predictNextPromptHeuristic(lastAssistantText),
    source: 'heuristic'
  };
}

function formatLocalDateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractStepCreatedSec(metaBuf) {
  if (!(metaBuf instanceof Uint8Array) || !metaBuf.length) return 0;
  try {
    const meta = parseProto(metaBuf);
    for (const f of [1, 6, 7, 8]) {
      const tsRaw = meta.get(f);
      if (tsRaw instanceof Uint8Array && tsRaw.length) {
        const tsMap = parseProto(tsRaw);
        const sec = tsMap.get(1) || 0;
        if (sec >= 1600000000 && sec <= 2200000000) return sec;
      }
    }
  } catch {}
  return 0;
}

const MIN_USAGE_LEDGER_HORIZON_DAYS = 190;

function loadUsageLedgerStore(cacheFile) {
  if (usageLedgerMem && usageLedgerMem.cachePath === cacheFile) return usageLedgerMem;
  const entries = new Map();
  const raw = readJsonOrFallback(cacheFile, null);
  if (raw && raw.schema === 1 && raw.files && typeof raw.files === 'object') {
    for (const [fp, val] of Object.entries(raw.files)) {
      if (val && typeof val.sig === 'string' && val.byDay && typeof val.byDay === 'object') {
        entries.set(fp, {
          sig: val.sig,
          mtimeMs: Number(val.mtimeMs) || 0,
          cutoffDateKey: typeof val.cutoffDateKey === 'string' ? val.cutoffDateKey : '',
          byDay: val.byDay
        });
      }
    }
  }
  usageLedgerMem = { cachePath: cacheFile, entries };
  return usageLedgerMem;
}

function saveUsageLedgerStore(store) {
  const target = resolveAtomicWriteTarget(store.cachePath);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const files = {};
    for (const [fp, val] of store.entries.entries()) {
      files[fp] = val;
    }
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, updatedAt: Date.now(), files }), {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {}
    fs.renameSync(tmp, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {}
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
  }
}

function readDbDailyUsage(dbPath, fallbackMtimeMs, cutoffDateKey) {
  return withReadOnlyDb(dbPath, 60, (db) => {
    const genRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    if (!genRows.length) return {};
    let stepDays = [];
    try {
      const stepRows = db.prepare('SELECT metadata FROM steps WHERE step_type = 15 ORDER BY idx ASC').all();
      stepDays = stepRows.map((r) => {
        const sec = extractStepCreatedSec(r.metadata);
        return sec > 0 ? formatLocalDateKey(sec * 1000) : '';
      });
    } catch {}
    const fallbackDay = formatLocalDateKey(fallbackMtimeMs || Date.now());
    const lastKnownDay = stepDays.length ? stepDays[stepDays.length - 1] || fallbackDay : fallbackDay;
    const byDay = {};
    for (let i = 0; i < genRows.length; i++) {
      const p = parseGenMetadataRow(genRows[i]);
      const tot = p.inTok + p.cacheRead + p.outTok;
      if (tot <= 0) continue;
      const dayKey = (i < stepDays.length && stepDays[i]) || lastKnownDay;
      if (dayKey < cutoffDateKey) continue;
      let b = byDay[dayKey];
      if (!b) {
        b = { input: 0, cache: 0, output: 0, calls: 0 };
        byDay[dayKey] = b;
      }
      b.input += p.inTok;
      b.cache += p.cacheRead;
      b.output += p.outTok;
      b.calls += 1;
    }
    return byDay;
  });
}

export function collectUsageSummary(opts = {}) {
  if (!DatabaseSync) {
    return { ok: false, error: 'sqlite_unavailable' };
  }
  const days = Math.max(7, Math.min(182, Number(opts.days) || 14));
  const nowMs = Number(opts.nowMs) > 0 ? Number(opts.nowMs) : Date.now();
  const explicitDirs = Array.isArray(opts.conversationsDirs);
  const convDirs = explicitDirs
    ? opts.conversationsDirs.filter((d) => typeof d === 'string' && d.trim())
    : [path.join(HOME, '.gemini', 'antigravity', 'conversations'), ...discoverWslConversationsDirs()];
  const cacheFile = opts.cacheFile ? path.resolve(opts.cacheFile) : USAGE_LEDGER_CACHE_FILE;
  const memoKey = `${days}|${cacheFile}|${convDirs.join('|')}`;
  if (!opts.force && !explicitDirs && usageSummaryMemo.data && usageSummaryMemo.key === memoKey && !usageSummaryMemo.data.partial && nowMs - usageSummaryMemo.at < 15000) {
    return usageSummaryMemo.data;
  }

  const todayDateObj = new Date(nowMs);
  todayDateObj.setHours(0, 0, 0, 0);
  const windowDates = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(todayDateObj.getTime() - offset * 86400000);
    windowDates.push(formatLocalDateKey(d.getTime()));
  }
  const todayKey = windowDates[windowDates.length - 1];
  const cutoffDateKey = formatLocalDateKey(todayDateObj.getTime() - (days + 2) * 86400000);
  const cutoffMtimeMs = todayDateObj.getTime() - (days + 2) * 86400000;
  const ledgerHorizonDays = Math.max(MIN_USAGE_LEDGER_HORIZON_DAYS, days + 2);
  const ledgerCutoffDateKey = formatLocalDateKey(todayDateObj.getTime() - ledgerHorizonDays * 86400000);
  const pruneCutoffMtimeMs = todayDateObj.getTime() - ledgerHorizonDays * 86400000;

  const store = loadUsageLedgerStore(cacheFile);
  const seenDirs = new Set();
  const discovered = [];
  const livePaths = new Set();

  for (const dir of convDirs) {
    const normDir = normalizePathForCompare(dir);
    if (seenDirs.has(normDir)) continue;
    seenDirs.add(normDir);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const unc = isUncPath(dir);
    for (const name of names) {
      if (!DB_FILE_RE.test(name)) continue;
      const dbPath = path.join(dir, name);
      const info = getDbStatByPath(dbPath);
      if (!info) continue;
      livePaths.add(dbPath);
      if (info.mtimeMs < cutoffMtimeMs) continue;
      discovered.push({ dbPath, info, unc });
    }
  }

  // Sort newest first so today and recent days populate immediately on cold start
  discovered.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);

  let dirty = false;
  let uncachedScanned = 0;
  let remainingUncached = 0;
  const maxBatchDefault = discovered.some((x) => x.unc) ? 8 : 40;
  const maxBatch = Number(opts.maxUncachedBatch) > 0 ? Number(opts.maxUncachedBatch) : maxBatchDefault;

  for (const item of discovered) {
    const existing = store.entries.get(item.dbPath);
    if (
      existing &&
      existing.sig === item.info.sig &&
      typeof existing.cutoffDateKey === 'string' &&
      existing.cutoffDateKey.length === 10 &&
      existing.cutoffDateKey <= cutoffDateKey
    ) {
      continue;
    }
    const retryAfter = usageReadFailUntil.get(item.dbPath) || 0;
    if (retryAfter > nowMs) continue;
    if (uncachedScanned >= maxBatch) {
      remainingUncached += 1;
      continue;
    }
    uncachedScanned += 1;
    try {
      const byDay = readDbDailyUsage(item.dbPath, item.info.mtimeMs, ledgerCutoffDateKey);
      store.entries.set(item.dbPath, {
        sig: item.info.sig,
        mtimeMs: item.info.mtimeMs,
        cutoffDateKey: ledgerCutoffDateKey,
        byDay
      });
      usageReadFailUntil.delete(item.dbPath);
      dirty = true;
    } catch {
      usageReadFailUntil.set(item.dbPath, nowMs + 60000);
    }
  }

  // Prune deleted or very stale cache entries
  for (const [fp, val] of Array.from(store.entries.entries())) {
    if (!livePaths.has(fp) && val.mtimeMs < pruneCutoffMtimeMs) {
      store.entries.delete(fp);
      dirty = true;
    }
  }
  if (dirty) saveUsageLedgerStore(store);

  const dayAgg = new Map();
  for (const key of windowDates) {
    dayAgg.set(key, { input: 0, cache: 0, output: 0, calls: 0, sessions: 0 });
  }
  for (const item of discovered) {
    const entry = store.entries.get(item.dbPath);
    if (!entry || !entry.byDay) continue;
    for (const [dayKey, vals] of Object.entries(entry.byDay)) {
      if (dayKey < cutoffDateKey) continue;
      const bucket = dayAgg.get(dayKey);
      if (!bucket || !vals) continue;
      const inp = Number(vals.input) || 0;
      const cac = Number(vals.cache) || 0;
      const out = Number(vals.output) || 0;
      const calls = Number(vals.calls) || 0;
      if (inp + cac + out <= 0) continue;
      bucket.input += inp;
      bucket.cache += cac;
      bucket.output += out;
      bucket.calls += calls;
      bucket.sessions += 1;
    }
  }

  let totalWindowTokens = 0;
  const dailyHistory = windowDates.map((dateKey) => {
    const b = dayAgg.get(dateKey);
    const totalTokens = b.input + b.cache + b.output;
    const totalPrompt = b.input + b.cache;
    const cacheHitRate = totalPrompt > 0 ? Number(((b.cache / totalPrompt) * 100).toFixed(1)) : 0;
    totalWindowTokens += totalTokens;
    return {
      date: dateKey,
      label: dateKey.slice(5).replace('-', '/'),
      totalTokens,
      inputTokens: b.input,
      cacheReadTokens: b.cache,
      outputTokens: b.output,
      cacheHitRate,
      activeSessions: b.sessions,
      calls: b.calls,
      isToday: dateKey === todayKey
    };
  });

  const today = dailyHistory[dailyHistory.length - 1];
  const result = {
    ok: true,
    partial: remainingUncached > 0,
    remainingCount: remainingUncached,
    todayDate: todayKey,
    today,
    totalWindowTokens,
    days,
    dailyHistory
  };
  if (!explicitDirs) {
    usageSummaryMemo = { at: nowMs, key: memoKey, data: result };
  }
  return result;
}

export async function collectOverviewSnapshotAsync(payload = {}, opts = {}) {
  const skipGit = Boolean(opts.skipGit);
  let absDir = '';
  const rawDir = typeof payload?.dirPath === 'string' ? payload.dirPath.trim() : '';
  if (rawDir) {
    const resolved = resolveLocalProjectDir(rawDir);
    if (resolved) absDir = resolved;
  }
  const gitResolved = absDir && !skipGit ? await readOverviewGitStatusAsync(absDir) : null;
  return collectOverviewSnapshot(payload, Object.assign({}, opts, { gitResolved }));
}

function getSafePluginDocRoots(configDir = path.join(HOME, '.gemini', 'config')) {
  const pluginsRoot = path.join(configDir, 'plugins');
  const roots = [];
  let entries = [];
  try {
    entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const ent of entries) {
    if ((!ent.isDirectory() && !ent.isSymbolicLink()) || ent.name.startsWith('.')) continue;
    for (const sub of ['skills', 'rules', 'agents']) {
      roots.push(path.join(pluginsRoot, ent.name, sub));
    }
  }
  return roots;
}

function collectAntigravityShortcutFiles(roots, maxDepth = 5) {
  const found = [];
  const seen = new Set();
  const walk = (dirPath, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dirPath, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile() && /antigravity.*\.lnk$/i.test(ent.name)) {
        const key = full.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          found.push(full);
        }
      }
    }
  };
  for (const r of roots || []) {
    if (r) walk(r, 0);
  }
  return found;
}

export function stripFastRestoreFlagsPreservingQuotes(rawArgs) {
  const src = String(rawArgs || '').trim();
  if (!src) return '';
  if (!/(?:^|\s)--disable-(?:renderer-backgrounding|backgrounding-occluded-windows)(?=\s|$)/i.test(src)) {
    return src;
  }
  return src
    .replace(
      /((?:\S*(?:"[^"]*"|'[^']*')\S*)+)|(^|\s+)(?:--disable-renderer-backgrounding|--disable-backgrounding-occluded-windows)(?=\s|$)/gi,
      (full, quotedToken) => (quotedToken ? quotedToken : '')
    )
    .trim();
}

export function getFastWindowRestoreStatus({ env = process.env, roots = null } = {}) {
  try {
    const searchRoots = Array.isArray(roots) ? roots : resolveWindowsShortcutRoots(env, { includeCommon: false });
    const lnkFiles = collectAntigravityShortcutFiles(searchRoots);
    let found = 0;
    let enabledCount = 0;
    for (const lnkPath of lnkFiles) {
      const info = readWindowsShortcutInfo(lnkPath, { env });
      if (!info.ok || !/(?:^|[\\/])Antigravity\.exe$/i.test(String(info.targetPath || ''))) {
        continue;
      }
      found += 1;
      const args = String(info.arguments || '');
      if (
        /(?:^|\s)--disable-renderer-backgrounding(?=\s|$)/i.test(args) &&
        /(?:^|\s)--disable-backgrounding-occluded-windows(?=\s|$)/i.test(args)
      ) {
        enabledCount += 1;
      }
    }
    return {
      ok: true,
      found,
      enabledCount,
      enabled: found > 0 && enabledCount === found
    };
  } catch (err) {
    return { ok: false, found: 0, enabledCount: 0, enabled: false, error: String(err?.message || err) };
  }
}

async function handleProjectRpcRequest(rawPayload, callerEntry = null) {
  let req;
  try {
    req = JSON.parse(String(rawPayload || '{}'));
  } catch {
    return null;
  }
  const reqId = req?.reqId;
  const action = req?.action;
  const payload = req?.payload || {};
  if (!reqId || !action) return null;

  try {
    if (action === 'saveUiPrefs') {
      const res = saveUiPrefs(payload);
      rebuildBundleIfNeeded();
      if (callerEntry && callerEntry.hostConfirmed) {
        callerEntry.injectedBundleHash = cachedBundleHash;
        await callerEntry.updateNewDocScript().catch(() => {});
      }
      for (const [, other] of attachedTargets.entries()) {
        if (other !== callerEntry && other.hostConfirmed) {
          other.updateNewDocScript().catch(() => {});
          other.checkAndInject(true).catch(() => {});
        }
      }
      return { reqId, result: res };
    }
    if (action === 'savePrismUiPrefs') {
      const rawPrefs = payload && typeof payload.prefs === 'object' && !Array.isArray(payload.prefs) ? payload.prefs : null;
      if (!rawPrefs) return { reqId, result: { ok: false, error: 'invalid_prefs' } };
      try {
        const ENUM_ALLOW = {
          lightPalette: ['default', 'crystal', 'alabaster', 'sage'],
          darkPalette: ['default', 'obsidian', 'basalt', 'marine'],
          mascotCountMode: ['fixed', 'agents'],
          mascotStyle: ['trio', 'zoo', 'cyber', 'crab', 'cat', 'penguin', 'fox', 'shiba', 'robot', 'owlet', 'axolotl', 'bunny', 'frog', 'chick', 'slime'],
          mascotVibe: ['calm', 'lively'],
          thoughtMode: ['off', 'bilingual', 'immersive'],
          composerBorderFx: ['off', 'smart', 'beam', 'static'],
          outlineRailMode: ['smart', 'right', 'off'],
          outlinePreviewStyle: ['detailed', 'compact'],
          borderBeamMode: ['always', 'busy'],
          borderBeamPalette: ['theme', 'gemini', 'aurora', 'prism', 'neon', 'quota'],
          quotaRingPeriod: ['auto', 'weekly', '5h'],
          thinkingOrbMode: ['both', 'replace'],
          bubbleTintPreset: ['accent', 'sky', 'emerald', 'amber', 'violet'],
          sidebarSessions: ['default', '10', 'all'],
          i18nExtraMode: ['off', 'zh-CN', 'zh-TW', 'en'],
          performanceMode: ['power-save', 'balanced', 'vivid'],
          tokenUnit: ['auto', 'wan', 'kmb']
        };
        const BOOL_ALLOW = new Set([
          'showWorkbenchBtn', 'outline', 'usageExtra', 'inkStream', 'mascot', 'mascotRoam',
          'borderBeam', 'quotaRing', 'thinkingOrb', 'bubbleTint', 'compactLayout',
          'unreadBadge', 'keepOverviewOpen', 'alwaysOutlineRail', 'switchReturnHelper',
          'switchAutoReturn', 'autoDismissOnboarding', 'quotaHandoffAlert',
          'imageContextMenu', 'cleanCopy', 'sshPaste', 'inlineEditHelper',
          'sessionFork', 'composerFileDrop', 'wslExplorerRevealFix', 'fastWindowRestore',
          'ignoreReducedMotion', 'opticalFacets', 'semanticAfterglow', 'compactQuotaPill',
          'composerIntentSuggest'
        ]);
        const FONT_STR_ALLOW = new Set(['chatFontFamily', 'codeFontFamily']);
        const UNSAFE_FONT_VAL_RE = /[;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@import|[\x00-\x1f\x7f]/i;
        const hasBalancedQuotes = (s) => ((s.match(/"/g) || []).length % 2 === 0) && ((s.match(/'/g) || []).length % 2 === 0);
        const sanitizeSeedObj = (obj) => {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
          const out = {};
          let cnt = 0;
          for (const k of Object.keys(BOOL_ALLOW.size ? obj : {})) {
            if (BOOL_ALLOW.has(k) && typeof obj[k] === 'boolean') {
              out[k] = obj[k];
              cnt++;
            } else if (Object.prototype.hasOwnProperty.call(ENUM_ALLOW, k) && ENUM_ALLOW[k].includes(obj[k])) {
              out[k] = obj[k];
              cnt++;
            } else if (FONT_STR_ALLOW.has(k) && typeof obj[k] === 'string') {
              const trimmed = obj[k].trim();
              if (trimmed.length <= 160 && !UNSAFE_FONT_VAL_RE.test(trimmed) && hasBalancedQuotes(trimmed)) {
                out[k] = trimmed;
                cnt++;
              }
            } else if (k === 'mascotMinCount' && Number.isFinite(Number(obj[k]))) {
              out[k] = Math.max(1, Math.min(3, Math.round(Number(obj[k]))));
              cnt++;
            } else if (k === 'mascotSize' && Number.isFinite(Number(obj[k]))) {
              out[k] = Math.max(16, Math.min(36, Math.round(Number(obj[k]) / 2) * 2));
              cnt++;
            } else if (k === 'bubbleTintStrength' && Number.isFinite(Number(obj[k]))) {
              out[k] = Math.max(10, Math.min(100, Math.round(Number(obj[k]))));
              cnt++;
            }
          }
          if (!cnt) return null;
          const nowMs = Date.now();
          const rawTs = Number(obj._ts);
          const hasExplicitTs = obj._tsOrigin !== 'legacy' && Number.isFinite(rawTs) && rawTs >= 1700000000000;
          out._ts = hasExplicitTs ? (rawTs > nowMs + 60000 ? nowMs : Math.round(rawTs)) : 0;
          out._tsOrigin = hasExplicitTs ? 'explicit' : 'legacy';
          return out;
        };
        const cleanIncoming = sanitizeSeedObj(rawPrefs);
        if (!cleanIncoming) return { reqId, result: { ok: false, error: 'empty_valid_prefs' } };
        const extDir = path.join(USER_DIR, 'extensions');
        fs.mkdirSync(extDir, { recursive: true });
        const seedFile = path.join(extDir, 'prism-suite-00-prefs.js');
        let merged = cleanIncoming;
        try {
          if (fs.existsSync(seedFile)) {
            const prevTxt = fs.readFileSync(seedFile, 'utf8');
            const m = prevTxt.match(/const seed = (\{[^\n]+\});/);
            if (m) {
              const prevClean = sanitizeSeedObj(JSON.parse(m[1]));
              if (prevClean) {
                if (prevClean._tsOrigin === 'explicit' && cleanIncoming._tsOrigin !== 'explicit') {
                  merged = prevClean;
                } else {
                  merged = cleanIncoming._ts >= prevClean._ts
                    ? Object.assign({}, prevClean, cleanIncoming)
                    : prevClean;
                }
              }
            }
          }
        } catch {}
        const safeJson = JSON.stringify(merged)
          .replace(/</g, '\\u003c')
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029');
        const scriptBody =
          `/* Auto-generated by Anti-Claude Prism Suite — cross-port UI preferences seed (zero credentials) */\n` +
          `(() => {\n` +
          `  const seed = ${safeJson};\n` +
          `  window.__agPrismDiskPrefs = seed;\n` +
          `  if (window.__agPrismBus && typeof window.__agPrismBus.hydrateDiskPrefs === 'function') {\n` +
          `    try { window.__agPrismBus.hydrateDiskPrefs(seed); } catch {}\n` +
          `  }\n` +
          `})();\n`;
        writeAtomicUtf8(seedFile, scriptBody);
        try {
          const prismStateDir = path.join(HOME, '.gemini', 'antigravity', 'prism-suite');
          fs.mkdirSync(prismStateDir, { recursive: true });
          writeAtomicUtf8(
            path.join(prismStateDir, 'ui-prefs.json'),
            `${JSON.stringify({ schema: 1, updatedAt: new Date(merged._ts).toISOString(), prefs: merged }, null, 2)}\n`
          );
        } catch {}
        rebuildBundleIfNeeded();
        if (callerEntry && callerEntry.hostConfirmed) {
          callerEntry.injectedBundleHash = cachedBundleHash;
          await callerEntry.updateNewDocScript().catch(() => {});
        }
        for (const [, other] of attachedTargets.entries()) {
          if (other !== callerEntry && other.hostConfirmed) {
            other.updateNewDocScript().catch(() => {});
            other.checkAndInject(true).catch(() => {});
          }
        }
        return { reqId, result: { ok: true, updatedAt: merged._ts } };
      } catch (err) {
        return { reqId, result: { ok: false, error: String(err?.message || err) } };
      }
    }
    if (action === 'listContexts') {
      const paths = Array.isArray(payload.paths) ? payload.paths.slice(0, 80) : [];
      const projectIds = Array.isArray(payload.projectIds) ? payload.projectIds.slice(0, 120) : [];
      const contexts = {};
      for (const raw of paths) {
        const res = readProjectContext(raw);
        if (res.ok) contexts[raw] = res;
      }
      const projectMtimes = {};
      const projectDirs = [NATIVE_PROJECTS_DIR, ...discoverWslGeminiDirs().map((g) => path.join(g, 'config', 'projects'))];
      for (const rawId of projectIds) {
        const id = String(rawId || '').trim();
        if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) continue;
        for (const projDir of projectDirs) {
          const projFile = path.join(projDir, `${id}.json`);
          if (!isPathInsideDir(projDir, projFile)) continue;
          try {
            const st = fs.statSync(projFile, { throwIfNoEntry: false });
            if (st && st.isFile()) {
              projectMtimes[id] = Math.floor(st.mtimeMs);
              break;
            }
          } catch {}
        }
      }
      return { reqId, result: { ok: true, contexts, projectMtimes } };
    }
    if (action === 'readContext') {
      return { reqId, result: readProjectContext(payload.dirPath) };
    }
    if (action === 'saveContext') {
      return { reqId, result: saveProjectContext(payload) };
    }
    if (action === 'pickFiles') {
      const res = await pickLocalFilesNative();
      return { reqId, result: res };
    }
    if (action === 'pickFolder') {
      const res = await pickLocalFolderNative();
      return { reqId, result: res };
    }
    if (action === 'saveScheduledTask') {
      return { reqId, result: saveProjectScheduledTask(payload) };
    }
    if (action === 'deleteScheduledTask') {
      return { reqId, result: deleteProjectScheduledTask(payload) };
    }
    if (action === 'openSkillsDir') {
      fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
      return { reqId, result: await revealLocalPath(GLOBAL_SKILLS_DIR, { openFolderContents: true }) };
    }
    if (action === 'createLocalSkill') {
      return { reqId, result: createLocalSkill(payload) };
    }
    if (action === 'importLocalSkill') {
      const res = await importLocalSkillNative();
      return { reqId, result: res };
    }
    if (action === 'openAgentsDir') {
      fs.mkdirSync(GLOBAL_AGENTS_DIR, { recursive: true });
      return { reqId, result: await revealLocalPath(GLOBAL_AGENTS_DIR, { openFolderContents: true }) };
    }
    if (action === 'createLocalAgent') {
      return { reqId, result: createLocalAgent(payload) };
    }
    if (action === 'importLocalAgent') {
      const res = await importLocalAgentNative();
      return { reqId, result: res };
    }
    if (action === 'getOverviewSnapshot') {
      const result = await collectOverviewSnapshotAsync(payload);
      return { reqId, result };
    }
    if (action === 'getUsageSummary') {
      const days = Number(payload?.days) || 14;
      const result = collectUsageSummary({ days, force: Boolean(payload?.force) });
      return { reqId, result };
    }
    if (action === 'translateText') {
      const result = await translateThoughtText(payload?.text, payload?.targetLang || 'zh-CN');
      return { reqId, result };
    }
    if (action === 'clearTranslateCache') {
      clearTranslateCacheStore();
      return { reqId, result: { ok: true } };
    }
    if (action === 'predictNextPrompt') {
      const result = await predictNextPromptAction(payload);
      return { reqId, result };
    }
    if (action === 'getFastWindowRestoreStatus') {
      if (process.platform !== 'win32') {
        return { reqId, result: { ok: true, found: 0, enabledCount: 0, enabled: false, note: 'windows_only' } };
      }
      return { reqId, result: getFastWindowRestoreStatus() };
    }
    if (action === 'setFastWindowRestoreShortcut') {
      const wantEnabled = Boolean(payload?.enabled);
      if (process.platform !== 'win32') {
        return { reqId, result: { ok: true, updated: 0, note: 'windows_only' } };
      }
      try {
        const roots = resolveWindowsShortcutRoots(process.env, { includeCommon: false });
        const lnkFiles = collectAntigravityShortcutFiles(roots);
        let updated = 0;
        for (const lnkPath of lnkFiles) {
          try {
            const info = readWindowsShortcutInfo(lnkPath, { env: process.env });
            if (!info.ok || !/(?:^|[\\/])Antigravity\.exe$/i.test(String(info.targetPath || ''))) {
              continue;
            }
            const cur = String(info.arguments || '').trim();
            const cleaned = stripFastRestoreFlagsPreservingQuotes(cur);
            const next = wantEnabled
              ? `${cleaned} --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`.trim()
              : cleaned;
            if (next !== cur) {
              writeWindowsShortcutArguments(lnkPath, next);
              updated += 1;
            }
          } catch {}
        }
        return { reqId, result: { ok: true, enabled: wantEnabled, updated } };
      } catch (err) {
        return { reqId, result: { ok: false, error: String(err?.message || err) } };
      }
    }
    if (action === 'revealInOsFileManager' || action === 'revealFile') {
      const rawTarget = typeof payload?.targetPath === 'string' ? payload.targetPath.trim() : '';
      if (!rawTarget) return { reqId, result: { ok: false, error: 'missing_path' } };
      const hostTarget = resolveHostRevealTarget(rawTarget, {
        wslDistro: typeof payload?.wslDistro === 'string' ? payload.wslDistro : ''
      });
      const absTarget = hostTarget.ok ? hostTarget.path : path.resolve(rawTarget);
      if (isSensitiveSourcePath(absTarget)) {
        return { reqId, result: { ok: false, error: 'sensitive_path_blocked' } };
      }
      const explicitProj = resolveLocalProjectDir(payload?.dirPath);
      const globalAgentsFiles = [
        path.join(HOME, '.gemini', 'AGENTS.md'),
        ...discoverWslGeminiDirs().map((g) => path.join(g, 'AGENTS.md'))
      ];
      const builtinRootDir = path.join(HOME, '.gemini', 'antigravity', 'builtin');
      const nativeBrainDir = path.join(HOME, '.gemini', 'antigravity', 'brain');
      const wslRoots = [];
      for (const g of discoverWslGeminiDirs()) {
        const cfg = path.join(g, 'config');
        wslRoots.push(
          path.join(cfg, 'skills'),
          path.join(cfg, 'agents'),
          path.join(g, 'antigravity', 'builtin'),
          ...(action === 'revealInOsFileManager' ? [path.join(g, 'antigravity', 'brain')] : [])
        );
        wslRoots.push(...getSafePluginDocRoots(cfg));
      }
      const allowedRoots = [
        ...(explicitProj ? [explicitProj] : []),
        ...getRegisteredProjectDirs(),
        GLOBAL_SKILLS_DIR,
        GLOBAL_AGENTS_DIR,
        builtinRootDir,
        ...(action === 'revealInOsFileManager' ? [nativeBrainDir] : []),
        ...getSafePluginDocRoots(),
        ...wslRoots
      ];
      const normTarget = normalizePathForCompare(absTarget);
      const authorized =
        globalAgentsFiles.some((f) => normalizePathForCompare(f) === normTarget) ||
        allowedRoots.some((root) => normTarget === normalizePathForCompare(root) || isPathInsideDir(root, absTarget));
      if (!authorized) {
        return { reqId, result: { ok: false, error: 'path_outside_project' } };
      }
      return {
        reqId,
        result: await revealLocalPath(absTarget, {
          openFolderContents: Boolean(payload?.openFolder),
          wslDistro: typeof payload?.wslDistro === 'string' ? payload.wslDistro : ''
        })
      };
    }
    return { reqId, result: { ok: false, error: `unknown_action:${action}` } };
  } catch (err) {
    return { reqId, result: { ok: false, error: String(err?.message || err) } };
  }
}

/* -------------------------------------------------------------------------- */
/* 5. CDP Target Discovery, Host Verification & Session Attachment            */
/* -------------------------------------------------------------------------- */

const attachedTargets = new Map();
const skippedNonHostTargets = new Map();
const targetThemeModes = new Map();
const fallbackBackoffUntil = new Map();

export function isAllowedOrigin(rawUrl) {
  const s = String(rawUrl || '');
  if (!s || s === 'about:blank') return false;
  if (s.startsWith('plugin://swarm--') || s.startsWith('vscode-file://')) return true;
  if (s.startsWith('file://')) {
    return /\/Antigravity\.app\/|\/antigravity\/resources\/|\/workbench\.html\b|\/jetski\b/i.test(s);
  }
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function getOriginKey(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(rawUrl || '');
  }
}

async function fetchTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false, targets: [] };
    const list = await res.json();
    return { ok: true, targets: Array.isArray(list) ? list : [] };
  } catch {
    return { ok: false, targets: [] };
  }
}

async function isAntigravityFallbackPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return false;
    const info = await res.json();
    const ua = String(info?.['User-Agent'] || '');
    const browser = String(info?.Browser || '');
    return /\bAntigravity\b|\bElectron\//i.test(`${ua} ${browser}`);
  } catch {
    return false;
  }
}

export const HOST_IDENTITY_PROBE_EXPR = `(function () {
  var loc = (typeof window !== 'undefined' && window.location) || {};
  if (loc.protocol === 'plugin:' && /^swarm--/i.test(loc.hostname || '')) return 'swarm';
  if (/^plugin:\\/\\/swarm--/i.test(loc.href || '')) return 'swarm';
  if (loc.protocol === 'vscode-file:') return 'host';
  if (loc.protocol === 'file:' && /\\/Antigravity\\.app\\/|\\/antigravity\\/resources\\//i.test(loc.href || '')) return 'host';
  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  var isElectronHost = /\\bElectron\\//i.test(ua);
  if (!isElectronHost) return 'non_host';
  /* Require the genuine non-configurable, frozen contextBridge preload object rather than page-forgeable DOM or globals */
  var en = typeof window !== 'undefined' ? window.electronNative : null;
  if (en && typeof en === 'object' && Object.isFrozen(en)) {
    var desc = Object.getOwnPropertyDescriptor(window, 'electronNative');
    var lockedOnWindow = Boolean(desc && desc.configurable === false && desc.writable === false);
    var isNativeFn = function (fn) {
      if (typeof fn !== 'function') return false;
      var name = String(fn.name || '');
      if (name.indexOf('bound ') === 0) return false;
      try { return Function.prototype.toString.call(fn).indexOf('[native code]') !== -1; } catch (_) { return false; }
    };
    if (lockedOnWindow && isNativeFn(en.getZoomLevel) && isNativeFn(en.setTitleBarOverlay) && isNativeFn(en.openExternal)) {
      return 'host';
    }
  }
  if (document.readyState === 'loading') return 'loading';
  return 'non_host';
})()`;

const NON_HOST_SKIP_TTL_MS = 15000;

function resolveParentHostTheme(page) {
  if (page.parentId && targetThemeModes.has(page.parentId)) {
    return targetThemeModes.get(page.parentId);
  }
  for (const [, mode] of targetThemeModes.entries()) {
    if (mode === 'dark' || mode === 'light') return mode;
  }
  return null;
}

export async function attachTarget(page, endpoint, opts = {}) {
  const readOnly = Boolean(opts && opts.readOnly);
  const wsUrl = String(page.webSocketDebuggerUrl || '').replace(/^ws:\/\/localhost:/i, 'ws://127.0.0.1:');
  if (!wsUrl) return;

  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    return;
  }

  let nextId = 1;
  let closed = false;
  const pending = new Map();

  const failAll = (reason) => {
    closed = true;
    for (const [, p] of pending) p.reject(new Error(reason));
    pending.clear();
  };

  const send = (method, params = {}, timeoutMs = 4000) =>
    new Promise((resolve, reject) => {
      if (closed || ws.readyState !== WebSocket.OPEN) return reject(new Error('ws_not_open'));
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`cdp_timeout:${method}`));
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

  const entry = {
    id: page.id,
    type: page.type,
    url: page.url,
    parentId: page.parentId || null,
    endpoint,
    ws,
    send,
    hostConfirmed: false,
    mainFrameId: null,
    trustedContextId: null,
    rpcToken: '',
    rpcSessionId: '',
    navGen: 0,
    contextMeta: new Map(),
    defaultContextByFrame: new Map(),
    newDocScriptId: null,
    injectedBundleHash: '',
    watchedCascadeId: '',
    lastMetricsSig: '',
    revokeHostAuth() {
      entry.hostConfirmed = false;
      entry.trustedContextId = null;
      entry.rpcToken = '';
      entry.rpcSessionId = '';
      entry.injectedBundleHash = '';
    },
    isAuthorizedBindingCaller(executionContextId) {
      if (!entry.hostConfirmed) return false;
      if (entry.trustedContextId !== null) {
        return executionContextId === entry.trustedContextId;
      }
      if (typeof executionContextId === 'number' && entry.contextMeta.size > 0) {
        const meta = entry.contextMeta.get(executionContextId);
        if (!meta || !meta.isDefault) return false;
        if (entry.mainFrameId && meta.frameId && meta.frameId !== entry.mainFrameId) return false;
        if (meta.origin && meta.origin !== '://' && !isAllowedOrigin(meta.origin)) return false;
        return true;
      }
      return entry.contextMeta.size === 0;
    },
    updateTargetUrl(nextUrl) {
      entry.url = nextUrl;
      const m = String(nextUrl || '').match(/\/c\/([0-9a-f-]{36})/i);
      if (m && m[1] !== entry.watchedCascadeId) {
        entry.watchedCascadeId = m[1];
        entry.lastMetricsSig = '';
      }
    }
  };

  entry.updateTargetUrl(page.url);

  const evalInHostContext = (expression, returnByValue = false) => {
    const params = { expression, returnByValue };
    if (entry.trustedContextId !== null) params.contextId = entry.trustedContextId;
    return send('Runtime.evaluate', params);
  };

  const probeHostKind = async (contextId = null) => {
    let probeKind = 'non_host';
    for (let attempt = 0; attempt < 3; attempt++) {
      const evalParams = { expression: HOST_IDENTITY_PROBE_EXPR, returnByValue: true };
      if (contextId !== null) evalParams.contextId = contextId;
      const probeRes = await send('Runtime.evaluate', evalParams).catch(() => null);
      if (!probeRes) return 'error';
      probeKind = probeRes?.result?.result?.value || 'non_host';
      if (probeKind !== 'loading') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    return probeKind;
  };

  const pushMetricsToTarget = async (cascadeId, force = false) => {
    if (!entry.hostConfirmed || !activeConfig.enabled || activeConfig.modules.metrics === false || page.type === 'iframe') return;
    const cid = cascadeId || entry.watchedCascadeId;
    if (!cid || !UUID_RE.test(cid)) return;
    const candidateConvDirs = [
      entry.endpoint.conversationsDir,
      ...(Array.isArray(entry.endpoint.extraConversationsDirs) ? entry.endpoint.extraConversationsDirs : []),
      ...discoverWslConversationsDirs()
    ];
    const payload = parseConversationMetrics(cid, candidateConvDirs);
    if (!payload) return;
    if (payload.transientError) {
      if (force && payload.cachedPayload) {
        await evalInHostContext(
          `window.__ag_render_metrics && window.__ag_render_metrics(${JSON.stringify(payload.cachedPayload)})`,
          false
        ).catch(() => {});
      }
      return;
    }
    if (!force && payload.sig && payload.sig === entry.lastMetricsSig) return;
    entry.lastMetricsSig = payload.sig || '';
    await evalInHostContext(
      `window.__ag_render_metrics && window.__ag_render_metrics(${JSON.stringify(payload)})`,
      false
    ).catch(() => {});
  };

  entry.syncMetricsForSession = async (force = false) => {
    if (!entry.hostConfirmed || page.type === 'iframe' || !activeConfig.enabled) return;
    if (!entry.watchedCascadeId) {
      const r = await evalInHostContext('window.__ag_watched_cascade_id || ""', true).catch(() => null);
      const cid = r?.result?.result?.value;
      if (cid && UUID_RE.test(cid)) entry.watchedCascadeId = cid;
    }
    if (entry.watchedCascadeId) {
      await pushMetricsToTarget(entry.watchedCascadeId, force);
    }
  };

  entry.updateNewDocScript = async () => {
    if (!entry.hostConfirmed) return;
    if (entry.newDocScriptId) {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: entry.newDocScriptId }).catch(() => {});
      entry.newDocScriptId = null;
    }
    if (!activeConfig.enabled) return;
    const hostMode = page.type === 'iframe' ? resolveParentHostTheme(page) : null;
    /* Never embed an RPC capability token in NewDocument scripts; tokens are issued only after post-navigation host verification */
    const scriptSource = buildRuntimeScript(hostMode, '');
    if (!scriptSource) return;
    const res = await send('Page.addScriptToEvaluateOnNewDocument', { source: scriptSource }).catch(() => null);
    entry.newDocScriptId = res?.result?.identifier || null;
  };

  entry.injectNow = async (issueRpcAuth = true) => {
    if (!entry.hostConfirmed) return;
    const hostMode = page.type === 'iframe' ? resolveParentHostTheme(page) : null;
    if (issueRpcAuth && page.type === 'page') {
      if (!entry.rpcToken) entry.rpcToken = crypto.randomBytes(24).toString('hex');
      if (!entry.rpcSessionId) entry.rpcSessionId = crypto.randomBytes(12).toString('hex');
    }
    const scriptSource = buildRuntimeScript(
      hostMode,
      issueRpcAuth && page.type === 'page' ? entry.rpcToken : '',
      issueRpcAuth && page.type === 'page' ? entry.rpcSessionId : ''
    );
    if (!scriptSource) return;
    const evalRes = await evalInHostContext(scriptSource, true).catch(() => null);
    entry.injectedBundleHash = cachedBundleHash;
    const resolvedMode = evalRes?.result?.result?.value;
    if (page.type === 'page' && (resolvedMode === 'dark' || resolvedMode === 'light')) {
      targetThemeModes.set(page.id, resolvedMode);
    }
  };

  entry.checkAndInject = async (force = false) => {
    if (!entry.hostConfirmed) return;
    if (force || entry.injectedBundleHash !== cachedBundleHash) {
      await entry.injectNow();
      return;
    }
    if (!activeConfig.enabled) return;
    const needCustomJs = page.type === 'page' && activeConfig.modules.customJs !== false;
    const sessionCheck =
      page.type === 'page' && entry.rpcSessionId
        ? ` && window.__ag_rpc_session_id === ${JSON.stringify(entry.rpcSessionId)}`
        : '';
    const probe = await evalInHostContext(
      `Boolean(document.getElementById("ag-custom-fonts"))${sessionCheck} && (!document.body || !${needCustomJs} || Boolean(window.__ag_custom_js_mounted))`,
      true
    ).catch(() => null);
    if (probe?.result?.result?.value === false) {
      await entry.injectNow();
    }
  };

  const bindHostBindings = async () => {
    if (page.type !== 'page') return;
    const bindParams = (name) =>
      entry.trustedContextId !== null ? { name, executionContextId: entry.trustedContextId } : { name };
    for (const name of ['__agRequestMetrics', '__agSyncHostThemeMode', '__agSyncHostVisibility', '__agProjectRpc']) {
      await send('Runtime.addBinding', bindParams(name)).catch(() =>
        send('Runtime.addBinding', { name }).catch(() => {})
      );
    }
  };

  entry.reverifyAfterNavigation = async (gen) => {
    if (closed || gen !== entry.navGen) return;
    if (!isAllowedOrigin(entry.url)) {
      skippedNonHostTargets.set(page.id, { origin: getOriginKey(entry.url), expiresAt: Date.now() + NON_HOST_SKIP_TTL_MS });
      try {
        ws.close();
      } catch {}
      return;
    }
    const candidateCtxId = (entry.mainFrameId && entry.defaultContextByFrame.get(entry.mainFrameId)) || null;
    const probeKind = await probeHostKind(candidateCtxId);
    if (closed || gen !== entry.navGen) return;
    if (probeKind === 'loading') {
      setTimeout(() => entry.reverifyAfterNavigation(gen).catch(() => {}), 200).unref?.();
      return;
    }
    if (probeKind !== 'host' && probeKind !== 'swarm') {
      skippedNonHostTargets.set(page.id, { origin: getOriginKey(entry.url), expiresAt: Date.now() + NON_HOST_SKIP_TTL_MS });
      try {
        ws.close();
      } catch {}
      return;
    }
    entry.trustedContextId =
      (entry.mainFrameId && entry.defaultContextByFrame.get(entry.mainFrameId)) ?? candidateCtxId ?? null;
    entry.hostConfirmed = true;
    if (readOnly) return;
    entry.rpcToken = page.type === 'page' ? crypto.randomBytes(24).toString('hex') : '';
    entry.rpcSessionId = page.type === 'page' ? crypto.randomBytes(12).toString('hex') : '';
    await bindHostBindings();
    await entry.injectNow();
    await entry.syncMetricsForSession(true);
  };

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        p.resolve(msg);
      }
      return;
    }
    if (msg.method === 'Runtime.executionContextCreated') {
      const ctx = msg.params?.context;
      if (ctx && typeof ctx.id === 'number') {
        const frameId = ctx.auxData?.frameId || null;
        const isDefault = ctx.auxData?.isDefault !== false && (!ctx.auxData?.type || ctx.auxData.type === 'default');
        entry.contextMeta.set(ctx.id, { frameId, isDefault, origin: String(ctx.origin || '') });
        if (isDefault && frameId) {
          entry.defaultContextByFrame.set(frameId, ctx.id);
          if (!entry.mainFrameId) entry.mainFrameId = frameId;
        }
      }
      return;
    }
    if (msg.method === 'Runtime.executionContextDestroyed') {
      const cid = msg.params?.executionContextId;
      if (typeof cid === 'number') {
        const meta = entry.contextMeta.get(cid);
        if (meta?.frameId && entry.defaultContextByFrame.get(meta.frameId) === cid) {
          entry.defaultContextByFrame.delete(meta.frameId);
        }
        entry.contextMeta.delete(cid);
        if (entry.trustedContextId === cid) {
          entry.revokeHostAuth();
        }
      }
      return;
    }
    if (msg.method === 'Runtime.executionContextsCleared') {
      entry.contextMeta.clear();
      entry.defaultContextByFrame.clear();
      entry.revokeHostAuth();
      return;
    }
    if (msg.method === 'Page.frameNavigated' && !msg.params?.frame?.parentId) {
      /* Top-level navigation: immediately revoke previous document's host & RPC authorization */
      entry.revokeHostAuth();
      const nextFrameId = msg.params?.frame?.id;
      if (nextFrameId) entry.mainFrameId = nextFrameId;
      entry.updateTargetUrl(msg.params?.frame?.url || entry.url);
      const gen = ++entry.navGen;
      setTimeout(() => {
        entry.reverifyAfterNavigation(gen).catch(() => {});
      }, 60);
      return;
    }
    if (!entry.hostConfirmed) return;
    if (msg.method === 'Runtime.bindingCalled') {
      const { name, payload, executionContextId } = msg.params || {};
      if (!entry.isAuthorizedBindingCaller(executionContextId)) return;
      if (name === '__agRequestMetrics' && payload && UUID_RE.test(payload)) {
        entry.watchedCascadeId = payload;
        entry.lastMetricsSig = '';
        pushMetricsToTarget(payload, true).catch(() => {});
      } else if (name === '__agSyncHostThemeMode' && (payload === 'dark' || payload === 'light')) {
        targetThemeModes.set(page.id, payload);
        for (const [, other] of attachedTargets.entries()) {
          if (other.type === 'iframe' && other.hostConfirmed) {
            other
              .send('Runtime.evaluate', {
                expression: `window.__ag_set_host_theme_mode && window.__ag_set_host_theme_mode(${JSON.stringify(payload)})`,
                returnByValue: false
              })
              .catch(() => {});
          }
        }
      } else if (name === '__agSyncHostVisibility' && (payload === 'hidden' || payload === 'visible')) {
        entry.docHidden = payload === 'hidden';
        if (!entry.docHidden && entry.watchedCascadeId) {
          setTimeout(() => {
            if (!entry.docHidden && entry.hostConfirmed) {
              pushMetricsToTarget(entry.watchedCascadeId, false).catch(() => {});
            }
          }, 260).unref?.();
        }
      } else if (name === '__agProjectRpc' && payload) {
        let parsedEnv = null;
        try {
          parsedEnv = JSON.parse(String(payload));
        } catch {
          return;
        }
        if (!entry.rpcToken || !parsedEnv || parsedEnv.token !== entry.rpcToken) {
          if (parsedEnv?.reqId) {
            evalInHostContext(
              `window.__ag_project_rpc_resolve && window.__ag_project_rpc_resolve(${JSON.stringify(parsedEnv.reqId)}, { ok: false, error: "unauthorized_context" })`,
              false
            ).catch(() => {});
          }
          return;
        }
        const expectedContextId = entry.trustedContextId;
        const expectedToken = entry.rpcToken;
        handleProjectRpcRequest(payload, entry)
          .then((reply) => {
            if (!reply || !entry.hostConfirmed || entry.rpcToken !== expectedToken || entry.trustedContextId !== expectedContextId) {
              return;
            }
            return evalInHostContext(
              `window.__ag_project_rpc_resolve && window.__ag_project_rpc_resolve(${JSON.stringify(reply.reqId)}, ${JSON.stringify(reply.result)})`,
              false
            ).catch(() => {});
          })
          .catch(() => {});
      }
    }
  });

  ws.addEventListener('close', () => {
    failAll('ws_closed');
    if (attachedTargets.get(page.id) === entry) {
      attachedTargets.delete(page.id);
      targetThemeModes.delete(page.id);
      if (attachedTargets.size === 0 && typeof wakeMacBootstrap === 'function') {
        wakeMacBootstrap();
      }
    }
  });
  ws.addEventListener('error', () => failAll('ws_error'));

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws_open_timeout')), 2000);
      ws.addEventListener('open', () => (clearTimeout(t), resolve()), { once: true });
      ws.addEventListener('close', () => (clearTimeout(t), reject(new Error('ws_closed'))), { once: true });
      ws.addEventListener('error', () => (clearTimeout(t), reject(new Error('ws_error'))), { once: true });
    });

    await send('Page.enable').catch(() => {});
    const frameTreeRes = await send('Page.getFrameTree').catch(() => null);
    const rootFrameId = frameTreeRes?.result?.frameTree?.frame?.id || null;
    if (rootFrameId) entry.mainFrameId = rootFrameId;

    await send('Runtime.enable');

    const candidateCtxId = (entry.mainFrameId && entry.defaultContextByFrame.get(entry.mainFrameId)) || null;
    /* Verify this target is actually an Antigravity host window or swarm plugin (never inject into localhost user web apps) */
    const probeKind = await probeHostKind(candidateCtxId);

    if (probeKind === 'loading') {
      /* Still loading: do NOT add to skippedNonHostTargets so subsequent sync cycles retry cleanly */
      try {
        ws.close();
      } catch {}
      return;
    }

    if (probeKind !== 'host' && probeKind !== 'swarm') {
      skippedNonHostTargets.set(page.id, { origin: getOriginKey(page.url), expiresAt: Date.now() + NON_HOST_SKIP_TTL_MS });
      try {
        ws.close();
      } catch {}
      return;
    }

    entry.trustedContextId =
      (entry.mainFrameId && entry.defaultContextByFrame.get(entry.mainFrameId)) ?? candidateCtxId ?? null;
    entry.hostConfirmed = true;
    attachedTargets.set(page.id, entry);

    if (readOnly) return;

    entry.rpcToken = page.type === 'page' ? crypto.randomBytes(24).toString('hex') : '';
    entry.rpcSessionId = page.type === 'page' ? crypto.randomBytes(12).toString('hex') : '';

    await bindHostBindings();

    await entry.updateNewDocScript();
    await entry.injectNow();
    await entry.syncMetricsForSession(true);
  } catch {
    if (attachedTargets.get(page.id) === entry) {
      attachedTargets.delete(page.id);
      targetThemeModes.delete(page.id);
    }
    try {
      ws.close();
    } catch {}
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Main Sync Loop & --verify-once Probe                                    */
/* -------------------------------------------------------------------------- */

let isSyncing = false;
let syncTickCount = 0;
let lastReachablePort = 0;
const endpointConsecutiveFailures = new Map();

async function sync(opts = {}) {
  const readOnly = Boolean(opts && opts.readOnly);
  checkPidOwnership();
  if (isSyncing) return;
  isSyncing = true;
  syncTickCount = (syncTickCount + 1) % 6000;
  try {
    const bundleChanged = rebuildBundleIfNeeded();
    if (!readOnly && !activeConfig.enabled) targetThemeModes.clear();
    const shouldHeartbeatCheck = !readOnly && (bundleChanged || syncTickCount % 6 === 1);

    const activeTargetIds = new Set();
    const seenRawTargetIds = new Set();
    const authoritativeChannels = new Set();
    const pendingPages = [];
    const pendingIframes = [];
    const probedPorts = new Set();
    const nowMs = Date.now();

    for (const endpoint of activeConfig.endpoints) {
      const port = readPort(endpoint.portFile);
      let targets = [];
      let querySucceeded = false;
      let usedPort = 0;
      if (port && !probedPorts.has(port)) {
        probedPorts.add(port);
        const res = await fetchTargets(port);
        if (res.ok) {
          querySucceeded = true;
          targets = res.targets;
          if (targets.length > 0) usedPort = port;
        }
      }
      if (
        targets.length === 0 &&
        endpoint.fallbackPort &&
        !probedPorts.has(endpoint.fallbackPort) &&
        (RUN_ONCE || nowMs >= (fallbackBackoffUntil.get(endpoint.fallbackPort) || 0))
      ) {
        probedPorts.add(endpoint.fallbackPort);
        const isAgPort = await isAntigravityFallbackPort(endpoint.fallbackPort);
        if (isAgPort) {
          const res = await fetchTargets(endpoint.fallbackPort);
          if (res.ok) {
            querySucceeded = true;
            targets = res.targets;
          }
        }
        if (targets.length === 0) {
          fallbackBackoffUntil.set(endpoint.fallbackPort, nowMs + 10000);
        } else {
          fallbackBackoffUntil.delete(endpoint.fallbackPort);
          usedPort = endpoint.fallbackPort;
        }
      }
      if (querySucceeded) {
        endpointConsecutiveFailures.delete(endpoint.channel);
        authoritativeChannels.add(endpoint.channel);
      } else {
        endpointConsecutiveFailures.set(endpoint.channel, (endpointConsecutiveFailures.get(endpoint.channel) || 0) + 1);
      }
      if (targets.length === 0) continue;
      lastReachablePort = usedPort;

      for (const t of targets) {
        if (!t?.id) continue;
        seenRawTargetIds.add(t.id);
        const skipped = skippedNonHostTargets.get(t.id);
        if (
          skipped &&
          (!isAllowedOrigin(t.url) ||
            getOriginKey(t.url) !== skipped.origin ||
            (typeof skipped.expiresAt === 'number' && nowMs >= skipped.expiresAt))
        ) {
          skippedNonHostTargets.delete(t.id);
        }
      }

      const candidates = targets.filter(
        (t) =>
          (t.type === 'page' || (t.type === 'iframe' && String(t.url || '').startsWith('plugin://swarm--'))) &&
          t.webSocketDebuggerUrl &&
          !String(t.url || '').startsWith('devtools://') &&
          isAllowedOrigin(t.url) &&
          !String(t.title || '').includes('Launchpad') &&
          skippedNonHostTargets.get(t.id)?.origin !== getOriginKey(t.url)
      );

      for (const page of candidates) {
        activeTargetIds.add(page.id);
        if (page.type === 'iframe') pendingIframes.push({ page, endpoint });
        else pendingPages.push({ page, endpoint });
      }
    }

    const syncBatch = async (items) => {
      const attaches = [];
      for (const { page, endpoint } of items) {
        if (!attachedTargets.has(page.id)) {
          attaches.push(attachTarget(page, endpoint, { readOnly }));
        } else if (!readOnly) {
          const entry = attachedTargets.get(page.id);
          entry.endpoint = endpoint;
          entry.parentId = page.parentId || entry.parentId || null;
          entry.updateTargetUrl(page.url);
          if (entry.hostConfirmed) {
            if (bundleChanged) await entry.updateNewDocScript();
            if (bundleChanged || (!entry.docHidden && shouldHeartbeatCheck)) await entry.checkAndInject(bundleChanged);
            if (bundleChanged || !entry.docHidden) await entry.syncMetricsForSession(bundleChanged);
          }
        }
      }
      if (attaches.length > 0) await Promise.allSettled(attaches);
    };

    await syncBatch(pendingPages);
    await syncBatch(pendingIframes);

    for (const [id, entry] of attachedTargets.entries()) {
      if (activeTargetIds.has(id)) continue;
      const ch = entry.endpoint?.channel;
      const wsDead = entry.ws?.readyState !== WebSocket.OPEN;
      const fails = ch ? endpointConsecutiveFailures.get(ch) || 0 : 0;
      /* Do not drop live WebSocket targets on a single transient /json/list timeout */
      if (!wsDead && ch && !authoritativeChannels.has(ch) && fails < 3) {
        continue;
      }
      try {
        entry.ws.close();
      } catch {}
      if (attachedTargets.get(id) === entry) {
        attachedTargets.delete(id);
        targetThemeModes.delete(id);
      }
    }
    if (seenRawTargetIds.size > 0) {
      for (const id of skippedNonHostTargets.keys()) {
        if (!seenRawTargetIds.has(id)) skippedNonHostTargets.delete(id);
      }
    }
  } finally {
    isSyncing = false;
  }
}

async function runVerifyOnce() {
  await sync({ readOnly: true });
  const inspectLiveStyles = async () => {
    let themeStyle = { present: false, length: 0 };
    let customStyle = { present: false, length: 0 };
    let hostPages = 0;

    for (const [, entry] of attachedTargets.entries()) {
      if (!entry.hostConfirmed || entry.type !== 'page') continue;
      hostPages += 1;
      const r = await entry
        .send('Runtime.evaluate', {
          expression: `(function () {
            const s1 = document.getElementById('ag-custom-fonts');
            const s2 = document.getElementById('antigravity-user-custom-style');
            return {
              themeStyle: { present: Boolean(s1), length: s1 ? (s1.textContent || '').length : 0 },
              customStyle: { present: Boolean(s2), length: s2 ? (s2.textContent || '').length : 0 }
            };
          })()`,
          returnByValue: true
        })
        .catch(() => null);
      const val = r?.result?.result?.value;
      if (val?.themeStyle?.present) themeStyle = val.themeStyle;
      if (val?.customStyle?.present) customStyle = val.customStyle;
    }
    return { themeStyle, customStyle, hostPages };
  };

  let { themeStyle, customStyle, hostPages } = await inspectLiveStyles();
  const stylesReady = () => themeStyle.present && (!activeConfig.modules.customCss || customStyle.present);
  if (hostPages > 0 && activeConfig.enabled && !stylesReady()) {
    for (let i = 0; i < 4 && !stylesReady(); i++) {
      await new Promise((r) => setTimeout(r, 350));
      ({ themeStyle, customStyle, hostPages } = await inspectLiveStyles());
    }
    if (!stylesReady()) {
      for (const [, entry] of attachedTargets.entries()) {
        if (entry.hostConfirmed && entry.type === 'page') {
          await entry.injectNow(false);
        }
      }
      ({ themeStyle, customStyle, hostPages } = await inspectLiveStyles());
    }
  }

  for (const [, entry] of attachedTargets.entries()) {
    try {
      entry.ws.close();
    } catch {}
  }

  const reachable = hostPages > 0;
  const ok =
    reachable &&
    (!activeConfig.enabled ||
      (themeStyle.present && (!activeConfig.modules.customCss || customStyle.present)));

  console.log(
    JSON.stringify(
      {
        ok,
        version: cachedVersion,
        userDir: USER_DIR,
        themeStyle,
        customStyle,
        live: {
          reachable,
          port: lastReachablePort || null,
          targets: hostPages
        }
      },
      null,
      2
    )
  );
  process.exit(ok ? 0 : 1);
}

function getCachedBootPayload() {
  return cachedBootPayloadBase;
}

const CUA_PLUGIN_POLL_MS = 4000;

function cleanupStaleCuaBrokerFiles({
  homeDir = os.homedir(),
  brokerFilePath = '',
  wslGeminiDirs = wslGeminiCache.dirs
} = {}) {
  const targets = [
    brokerFilePath || path.join(homeDir, '.gemini', 'antigravity', 'prism-suite', 'cua-broker.json')
  ];
  if (Array.isArray(wslGeminiDirs)) {
    for (const gDir of wslGeminiDirs) {
      if (typeof gDir === 'string' && gDir.trim()) {
        targets.push(path.join(gDir, 'antigravity', 'prism-suite', 'cua-broker.json'));
      }
    }
  }
  for (const fp of targets) {
    try {
      const st = fs.lstatSync(fp, { throwIfNoEntry: false });
      if (st && !st.isDirectory()) {
        fs.rmSync(fp, { force: true });
      }
    } catch {}
  }
}

export async function isPrismCuaPluginEnabled({
  homeDir = os.homedir(),
  pluginJsonPath = '',
  env = process.env,
  fsPromises = fs.promises
} = {}) {
  if (String(env?.PRISM_FORCE_CUA_BROKER || '') === '1') return true;
  const target = pluginJsonPath || path.join(homeDir, '.gemini', 'config', 'plugins', 'prism-cua', 'plugin.json');
  try {
    const raw = await fsPromises.readFile(target, 'utf8');
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === 'object' && parsed.disabled !== true);
  } catch {
    return false;
  }
}

export function createCuaBrokerLifecycleController({
  homeDir = os.homedir(),
  pluginJsonPath = '',
  brokerFilePath = '',
  env = process.env,
  fsPromises = fs.promises,
  pollIntervalMs = CUA_PLUGIN_POLL_MS,
  startBrokerFn = (opts) => startCuaBroker(opts),
  stopBrokerFn = async (brokerInstance) => {
    await stopCuaBroker();
    if (brokerInstance && typeof brokerInstance.stop === 'function') {
      await brokerInstance.stop();
    } else if (brokerInstance && typeof brokerInstance.close === 'function') {
      await brokerInstance.close();
    }
  },
  discoverWslDirsFn = discoverWslGeminiDirs,
  onWarn = (msg) => console.warn(msg)
} = {}) {
  const resolvedPluginJson =
    pluginJsonPath || path.join(homeDir, '.gemini', 'config', 'plugins', 'prism-cua', 'plugin.json');
  let activeCuaBroker = null;
  let brokerRunning = false;
  let lastMtimeSig = '';
  let lastDesiredEnabled = null;
  let reconcilePromise = null;
  let pollTimer = null;
  let disposed = false;

  const reconcileOnce = async () => {
    if (disposed || shuttingDown) return { enabled: false, running: brokerRunning };
    let desiredEnabled = false;
    if (String(env?.PRISM_FORCE_CUA_BROKER || '') === '1') {
      desiredEnabled = true;
      lastMtimeSig = 'forced:1';
    } else {
      let st = null;
      try {
        st = await fsPromises.stat(resolvedPluginJson);
      } catch {
        st = null;
      }
      if (!st || !st.isFile()) {
        lastMtimeSig = 'missing';
        desiredEnabled = false;
      } else {
        const sig = `${st.size}:${st.mtimeMs}`;
        if (sig === lastMtimeSig && lastDesiredEnabled !== null) {
          desiredEnabled = lastDesiredEnabled;
        } else {
          try {
            const raw = await fsPromises.readFile(resolvedPluginJson, 'utf8');
            const parsed = JSON.parse(raw);
            desiredEnabled = Boolean(parsed && typeof parsed === 'object' && parsed.disabled !== true);
            lastMtimeSig = sig;
          } catch {
            desiredEnabled = lastDesiredEnabled === true;
          }
        }
      }
    }

    if (desiredEnabled) {
      if (!brokerRunning && !disposed && !shuttingDown) {
        try {
          activeCuaBroker = await startBrokerFn({ discoverWslGeminiDirs: discoverWslDirsFn });
          brokerRunning = true;
        } catch (err) {
          onWarn(`[Anti-Claude Daemon] CUA Broker warning: ${err?.message || err}`);
        }
      }
      lastDesiredEnabled = true;
    } else {
      if (brokerRunning || activeCuaBroker) {
        const prev = activeCuaBroker;
        activeCuaBroker = null;
        brokerRunning = false;
        try {
          await stopBrokerFn(prev);
        } catch {}
        cleanupStaleCuaBrokerFiles({ homeDir, brokerFilePath });
      } else if (lastDesiredEnabled === null) {
        cleanupStaleCuaBrokerFiles({ homeDir, brokerFilePath });
      }
      lastDesiredEnabled = false;
    }
    return { enabled: desiredEnabled, running: brokerRunning, broker: activeCuaBroker };
  };

  const syncNow = () => {
    if (!reconcilePromise) {
      reconcilePromise = reconcileOnce().finally(() => {
        reconcilePromise = null;
      });
    }
    return reconcilePromise;
  };

  const startPolling = () => {
    if (disposed || pollTimer) return;
    pollTimer = setInterval(() => {
      void syncNow();
    }, pollIntervalMs);
    if (pollTimer && typeof pollTimer.unref === 'function') {
      pollTimer.unref();
    }
  };

  const stopController = async () => {
    disposed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (reconcilePromise) {
      await reconcilePromise.catch(() => {});
    }
    if (brokerRunning || activeCuaBroker) {
      const prev = activeCuaBroker;
      activeCuaBroker = null;
      brokerRunning = false;
      try {
        await stopBrokerFn(prev);
      } catch {}
      cleanupStaleCuaBrokerFiles({ homeDir, brokerFilePath });
    }
  };

  return {
    syncNow,
    startPolling,
    stop: stopController,
    get activeBroker() {
      return activeCuaBroker;
    },
    get isRunning() {
      return brokerRunning;
    }
  };
}

export { attachedTargets, skippedNonHostTargets, sync, rebuildBundleIfNeeded, getCachedBootPayload };

const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  claimPidFile();
  startMacCdpBootstrap();

  if (VERIFY_ONCE) {
    await runVerifyOnce();
  } else if (RUN_ONCE) {
    await sync();
    for (const [, entry] of attachedTargets.entries()) {
      try {
        entry.ws.close();
      } catch {}
    }
    process.exit(0);
  } else {
    rebuildBundleIfNeeded();
    const cuaLifecycle = createCuaBrokerLifecycleController({ homeDir: HOME });
    await cuaLifecycle.syncNow();
    cuaLifecycle.startPolling();
    console.log(`[Anti-Claude Daemon] Started (${cachedVersion}) | userDir=${USER_DIR} | sqlite=${Boolean(DatabaseSync)}`);
    await sync();
    setInterval(sync, 2500);
  }
}
