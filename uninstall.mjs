#!/usr/bin/env node
/**
 * Uninstall Prism Suite extensions, Antigravity prism-files plugin,
 * and optionally the bundled Anti-Claude runtime kernel (--with-kernel)
 * or user profile/vault state (--purge).
 *
 * Usage:
 *   node uninstall.mjs [--extensions-only | --plugin-only] [--with-kernel] [--purge] [--user-dir <dir>] [--plugin-dir <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_FILES,
  KERNEL_USER_LAYER_FILES,
  buildNodeExecEnv,
  isPrismManagedRuntimeDir,
  resolveChromeBridgeTargetDir,
  resolvePluginsDir,
  resolvePrismCuaTargetDir,
  resolvePrismFilesTargetDir,
  resolveStateDirFromUserDir,
  resolveUserDir
} from './install.mjs';
import { parseWindowsLnkBuffer, updateWindowsLnkArguments } from './vendor/anti-claude/core/ms-lnk.mjs';

const __filename = fileURLToPath(import.meta.url);
const GENERATED_EXTENSION_FILES = ['prism-suite-00-prefs.js'];
const KERNEL_SUITE_METADATA_FILES = ['cua-broker.json', 'com.prism.cua.bridge.json'];
const PURGE_USER_DATA_FILES = [
  'prism-profile.json',
  'ui-prefs.json',
  'thought-translation-cache.json',
  'usage-ledger-cache.json',
  'handoff-memory.sqlite',
  'handoff-memory.sqlite-wal',
  'handoff-memory.sqlite-shm',
  'handoff-memories.jsonl',
  'accounts-registry.json',
  'files-state.json',
  'self-update-state.json',
  'cua-tools-state.json'
];
const WIN_NM_HOST_KEYS = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.prism.cua.bridge',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.prism.cua.bridge'
];

function removeRegularFileIfPresent(filePath) {
  const lst = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!lst || lst.isSymbolicLink() || lst.isDirectory()) return false;
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function tryRemoveEmptyPrismSuiteDir(suiteDir) {
  if (!suiteDir || path.basename(suiteDir).toLowerCase() !== 'prism-suite') return false;
  try {
    const suiteLst = fs.lstatSync(suiteDir, { throwIfNoEntry: false });
    if (suiteLst && suiteLst.isDirectory() && !suiteLst.isSymbolicLink() && fs.readdirSync(suiteDir).length === 0) {
      fs.rmdirSync(suiteDir);
      return true;
    }
  } catch {}
  return false;
}

function getWinSystem32Exe(exeName) {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  return path.join(sysRoot, 'System32', exeName);
}

function enumerateAntigravityShortcutsOnWin(homeDir = os.homedir()) {
  const roots = [
    path.join(homeDir, 'Desktop'),
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Desktop') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : ''
  ].filter(Boolean);

  const seenRoots = new Set();
  const out = [];
  for (const root of roots) {
    const normRoot = path.resolve(root).toLowerCase();
    if (seenRoots.has(normRoot)) continue;
    seenRoots.add(normRoot);
    const rootLst = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!rootLst || !rootLst.isDirectory()) continue;

    const stack = [root];
    let visited = 0;
    while (stack.length > 0 && visited < 256) {
      const cur = stack.pop();
      visited++;
      if (cur !== root) {
        const curLst = fs.lstatSync(cur, { throwIfNoEntry: false });
        if (!curLst || curLst.isSymbolicLink() || !curLst.isDirectory()) continue;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const full = path.join(cur, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile() && /antigravity.*\.lnk$/i.test(ent.name)) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

function cleanWindowsHostArtifactsOnKernelUninstall() {
  if (process.platform !== 'win32') return;

  const regExe = getWinSystem32Exe('reg.exe');
  if (fs.existsSync(regExe)) {
    for (const regKey of WIN_NM_HOST_KEYS) {
      try {
        execFileSync(regExe, ['delete', regKey, '/f'], {
          windowsHide: true,
          timeout: 5000,
          stdio: 'ignore'
        });
      } catch {}
    }
  }

  for (const lnkPath of enumerateAntigravityShortcutsOnWin()) {
    try {
      const lst = fs.lstatSync(lnkPath, { throwIfNoEntry: false });
      if (!lst || lst.isSymbolicLink() || !lst.isFile() || lst.size > 512 * 1024) continue;
      const buf = fs.readFileSync(lnkPath);
      const parsed = parseWindowsLnkBuffer(buf);
      if (!parsed || !parsed.ok) continue;
      if (parsed.targetPath && !/antigravity\.exe$/i.test(parsed.targetPath)) continue;
      const curArgs = String(parsed.arguments || '');
      if (!/(?:^|\s)--remote-debugging-port=0(?=\s|$)/i.test(curArgs)) continue;
      const nextArgs = curArgs
        .replace(/"[^"]*"|((?:^|\s+)--remote-debugging-port=0(?=\s|$))/gi, (m, flagHit) => (flagHit ? (m.startsWith(' ') || m.startsWith('\t') ? ' ' : '') : m))
        .trim();
      const updatedBuf = updateWindowsLnkArguments(buf, nextArgs);
      const tmpLnk = `${lnkPath}.prism-uninst-${process.pid}`;
      fs.writeFileSync(tmpLnk, updatedBuf);
      fs.renameSync(tmpLnk, lnkPath);
    } catch {}
  }
}

export function uninstallExtensions({ userDir = resolveUserDir() } = {}) {
  const targetDir = path.join(path.resolve(userDir), 'extensions');
  const removed = [];
  for (const name of [...EXTENSION_FILES, ...GENERATED_EXTENSION_FILES]) {
    const fp = path.join(targetDir, name);
    if (removeRegularFileIfPresent(fp)) {
      removed.push(fp);
    }
  }
  return { targetDir, removed };
}

export function uninstallKernel({ userDir = resolveUserDir(), stateDir, deactivateDaemon = false } = {}) {
  const resolvedUserDir = path.resolve(userDir);
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : resolveStateDirFromUserDir(resolvedUserDir);
  const runtimeDir = path.join(resolvedStateDir, 'runtime');
  const runtimeInstallScript = path.join(runtimeDir, 'install.mjs');
  const removed = [];

  const runtimeLst = fs.lstatSync(runtimeDir, { throwIfNoEntry: false });
  if (runtimeLst && !isPrismManagedRuntimeDir(runtimeDir)) {
    return { stateDir: resolvedStateDir, runtimeDir, removed, skippedUnmanaged: true };
  }

  if (deactivateDaemon && runtimeLst && fs.existsSync(runtimeInstallScript)) {
    try {
      execFileSync(process.execPath, [runtimeInstallScript, 'uninstall'], {
        cwd: runtimeDir,
        env: buildNodeExecEnv({ ...process.env, ANTI_CLAUDE_NO_NETWORK: '1' }),
        timeout: 25000,
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch {}
  }

  if (runtimeLst && !runtimeLst.isSymbolicLink() && runtimeLst.isDirectory()) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    removed.push(runtimeDir);
  }

  // Clean CUA broker / NativeMessaging host manifests in prism-suite & stateDir
  const suiteDir = path.dirname(resolveChromeBridgeTargetDir(resolvedUserDir, resolvedStateDir));
  for (const dir of [suiteDir, resolvedStateDir]) {
    for (const metaFile of KERNEL_SUITE_METADATA_FILES) {
      const mp = path.join(dir, metaFile);
      if (removeRegularFileIfPresent(mp)) {
        removed.push(mp);
      }
    }
  }
  tryRemoveEmptyPrismSuiteDir(suiteDir);

  if (deactivateDaemon) {
    cleanWindowsHostArtifactsOnKernelUninstall();
  } else {
    // In sandbox / non-daemon mode, clean untouched template user/base files we deployed
    const baseDir = path.join(resolvedStateDir, 'base');
    for (const fileName of KERNEL_USER_LAYER_FILES) {
      const livePath = path.join(resolvedUserDir, fileName);
      const basePath = path.join(baseDir, fileName);
      const liveLst = fs.lstatSync(livePath, { throwIfNoEntry: false });
      const baseLst = fs.lstatSync(basePath, { throwIfNoEntry: false });
      if (liveLst && !liveLst.isSymbolicLink() && baseLst && !baseLst.isSymbolicLink()) {
        try {
          if (fs.readFileSync(livePath, 'utf8') === fs.readFileSync(basePath, 'utf8')) {
            fs.rmSync(livePath, { force: true });
            removed.push(livePath);
          }
        } catch {}
      }
    }
    for (const sub of ['base', 'incoming']) {
      const subDir = path.join(resolvedStateDir, sub);
      const subLst = fs.lstatSync(subDir, { throwIfNoEntry: false });
      if (subLst && !subLst.isSymbolicLink() && subLst.isDirectory()) {
        fs.rmSync(subDir, { recursive: true, force: true });
      }
    }
  }

  return { stateDir: resolvedStateDir, runtimeDir, removed };
}

export function uninstallChromeBridge({ userDir = resolveUserDir(), stateDir, withKernel = false } = {}) {
  const targetDir = resolveChromeBridgeTargetDir(userDir, stateDir);
  if (path.basename(targetDir).toLowerCase() !== 'chrome-bridge') {
    throw new Error(`Unsafe chrome-bridge target directory: ${targetDir}`);
  }
  const removed = [];
  const lst = fs.lstatSync(targetDir, { throwIfNoEntry: false });
  if (lst && !lst.isSymbolicLink()) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    removed.push(targetDir);
  }
  const suiteDir = path.dirname(targetDir);
  if (path.basename(suiteDir).toLowerCase() === 'prism-suite') {
    const suiteLst = fs.lstatSync(suiteDir, { throwIfNoEntry: false });
    if (suiteLst && suiteLst.isDirectory() && !suiteLst.isSymbolicLink()) {
      removeRegularFileIfPresent(path.join(suiteDir, 'install-mode.json'));
      if (withKernel) {
        for (const metaFile of KERNEL_SUITE_METADATA_FILES) {
          removeRegularFileIfPresent(path.join(suiteDir, metaFile));
        }
      }
      tryRemoveEmptyPrismSuiteDir(suiteDir);
    }
  }
  return { targetDir, removed };
}

export function uninstallPlugin({ pluginsDir = resolvePluginsDir() } = {}) {
  const targetDir = resolvePrismFilesTargetDir(pluginsDir);
  if (path.basename(targetDir).toLowerCase() !== 'prism-files') {
    throw new Error(`Unsafe plugin target directory: ${targetDir}`);
  }

  const removed = [];
  const filesLst = fs.lstatSync(targetDir, { throwIfNoEntry: false });
  if (filesLst && !filesLst.isSymbolicLink()) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    removed.push(targetDir);
  }

  const cuaTargetDir = resolvePrismCuaTargetDir(pluginsDir);
  const cuaRemoved = [];
  if (path.basename(cuaTargetDir).toLowerCase() === 'prism-cua') {
    const cuaLst = fs.lstatSync(cuaTargetDir, { throwIfNoEntry: false });
    if (cuaLst && !cuaLst.isSymbolicLink()) {
      fs.rmSync(cuaTargetDir, { recursive: true, force: true });
      cuaRemoved.push(cuaTargetDir);
    }
  }

  return cuaRemoved.length
    ? { targetDir, removed, cuaTargetDir, cuaRemoved }
    : { targetDir, removed };
}

function collectKnownCredentialTargetsFromDisk(dirs) {
  const targets = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      const regPath = path.join(dir, 'accounts-registry.json');
      const regLst = fs.lstatSync(regPath, { throwIfNoEntry: false });
      if (regLst && regLst.isFile() && !regLst.isSymbolicLink()) {
        const parsed = JSON.parse(fs.readFileSync(regPath, 'utf8'));
        for (const acc of (Array.isArray(parsed?.accounts) ? parsed.accounts : [])) {
          const id = String(acc?.id || '').trim();
          if (id && /^[A-Za-z0-9._-]+$/.test(id)) {
            targets.add(`prism-suite:account:${id}`);
          }
        }
      }
    } catch {}
    try {
      const profPath = path.join(dir, 'prism-profile.json');
      const profLst = fs.lstatSync(profPath, { throwIfNoEntry: false });
      if (profLst && profLst.isFile() && !profLst.isSymbolicLink()) {
        const parsed = JSON.parse(fs.readFileSync(profPath, 'utf8'));
        const provs = Array.isArray(parsed?.providers)
          ? parsed.providers
          : (parsed?.providers && typeof parsed.providers === 'object' ? Object.values(parsed.providers) : []);
        for (const prov of provs) {
          const id = String(prov?.id || '').trim();
          if (id && /^[A-Za-z0-9._-]+$/.test(id)) {
            targets.add(`prism-suite:provider:${id}`);
          }
        }
      }
    } catch {}
  }
  return targets;
}

function purgeOsVaultCredentials(knownTargets, deleteCredential) {
  const purgedTargets = [];
  const targets = new Set(knownTargets);

  if (typeof deleteCredential === 'function') {
    for (const t of targets) {
      try {
        if (deleteCredential(t) !== false) purgedTargets.push(t);
      } catch {}
    }
    return purgedTargets;
  }

  if (process.platform === 'win32') {
    const cmdkeyExe = getWinSystem32Exe('cmdkey.exe');
    if (fs.existsSync(cmdkeyExe)) {
      try {
        const listOut = execFileSync(cmdkeyExe, ['/list:prism-suite:*'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        for (const line of String(listOut || '').split(/\r?\n/)) {
          const m = line.match(/(prism-suite:(?:account|provider):[A-Za-z0-9._-]+)/i);
          if (m) targets.add(m[1]);
        }
      } catch {}
      for (const t of targets) {
        if (!/^prism-suite:(?:account|provider):[A-Za-z0-9._-]+$/i.test(t)) continue;
        try {
          execFileSync(cmdkeyExe, [`/delete:${t}`], {
            windowsHide: true,
            timeout: 5000,
            stdio: 'ignore'
          });
          purgedTargets.push(t);
        } catch {}
      }
    }
  } else if (process.platform === 'darwin') {
    for (const t of targets) {
      if (!/^prism-suite:(?:account|provider):[A-Za-z0-9._-]+$/i.test(t)) continue;
      try {
        execFileSync('/usr/bin/security', ['delete-generic-password', '-s', t], {
          timeout: 5000,
          stdio: 'ignore'
        });
        purgedTargets.push(t);
      } catch {}
    }
  } else if (process.platform === 'linux') {
    for (const t of targets) {
      if (!/^prism-suite:(?:account|provider):[A-Za-z0-9._-]+$/i.test(t)) continue;
      try {
        execFileSync('secret-tool', ['clear', 'service', t], {
          timeout: 5000,
          stdio: 'ignore'
        });
        purgedTargets.push(t);
      } catch {}
    }
  }

  return purgedTargets;
}

export function purgeUserData({
  userDir = resolveUserDir(),
  stateDir,
  purgeOsCredentials = false,
  deleteCredential
} = {}) {
  const resolvedUserDir = path.resolve(userDir);
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : resolveStateDirFromUserDir(resolvedUserDir);
  const suiteDir = path.dirname(resolveChromeBridgeTargetDir(resolvedUserDir, resolvedStateDir));
  const candidateDirs = [...new Set([resolvedStateDir, suiteDir])];

  const knownCredTargets = collectKnownCredentialTargetsFromDisk(candidateDirs);
  const removedFiles = [];

  for (const dir of candidateDirs) {
    const dirLst = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!dirLst || dirLst.isSymbolicLink() || !dirLst.isDirectory()) continue;
    for (const name of PURGE_USER_DATA_FILES) {
      const fp = path.join(dir, name);
      if (removeRegularFileIfPresent(fp)) {
        removedFiles.push(fp);
      }
    }
  }

  if (purgeOsCredentials) {
    // Also clean Linux/WSL XDG native SQLite fallback when running a real host purge
    if (process.platform === 'linux') {
      const xdgBase = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
      const xdgSuiteDir = path.join(xdgBase, 'prism-suite');
      const xdgLst = fs.lstatSync(xdgSuiteDir, { throwIfNoEntry: false });
      if (xdgLst && !xdgLst.isSymbolicLink() && xdgLst.isDirectory()) {
        for (const name of ['handoff-memory.sqlite', 'handoff-memory.sqlite-wal', 'handoff-memory.sqlite-shm']) {
          const fp = path.join(xdgSuiteDir, name);
          if (removeRegularFileIfPresent(fp)) removedFiles.push(fp);
        }
        try {
          if (fs.readdirSync(xdgSuiteDir).length === 0) fs.rmdirSync(xdgSuiteDir);
        } catch {}
      }
    }
  }

  const removedCredentials = (purgeOsCredentials || typeof deleteCredential === 'function')
    ? purgeOsVaultCredentials(knownCredTargets, deleteCredential)
    : [];

  tryRemoveEmptyPrismSuiteDir(suiteDir);
  return { removedFiles, removedCredentials };
}

export function uninstallAll({
  argv = process.argv.slice(2),
  userDir,
  pluginsDir,
  extensionsOnly,
  pluginOnly,
  withKernel,
  deactivateKernelDaemon,
  purge,
  purgeOsCredentials,
  deleteCredential
} = {}) {
  const onlyExt = extensionsOnly !== undefined ? Boolean(extensionsOnly) : argv.includes('--extensions-only');
  const onlyPlugin = pluginOnly !== undefined ? Boolean(pluginOnly) : argv.includes('--plugin-only');

  if (onlyExt && onlyPlugin) {
    throw new Error('Cannot combine --extensions-only and --plugin-only');
  }

  const resolvedUserDir = userDir !== undefined ? path.resolve(userDir) : resolveUserDir(argv);
  const resolvedPluginsDir = pluginsDir !== undefined ? path.resolve(pluginsDir) : resolvePluginsDir(argv);
  const removeKernel = withKernel !== undefined ? Boolean(withKernel) : argv.includes('--with-kernel');
  const doPurge = purge !== undefined ? Boolean(purge) : argv.includes('--purge');

  const defaultHostUserDir = path.join(os.homedir(), '.gemini', 'antigravity', 'anti-claude', 'user');
  const isDefaultHost = userDir === undefined && path.resolve(resolvedUserDir) === path.resolve(defaultHostUserDir);

  const extensions = onlyPlugin ? null : uninstallExtensions({ userDir: resolvedUserDir });
  const chromeBridge = onlyPlugin ? null : uninstallChromeBridge({ userDir: resolvedUserDir, withKernel: removeKernel });
  const plugin = onlyExt ? null : uninstallPlugin({ pluginsDir: resolvedPluginsDir });

  let kernel = null;
  if (removeKernel && !onlyPlugin) {
    const shouldDeactivate = deactivateKernelDaemon !== undefined ? Boolean(deactivateKernelDaemon) : isDefaultHost;
    kernel = uninstallKernel({ userDir: resolvedUserDir, deactivateDaemon: shouldDeactivate });
  }

  let purged = null;
  if (doPurge && !onlyPlugin) {
    const shouldPurgeOsCreds = purgeOsCredentials !== undefined ? Boolean(purgeOsCredentials) : isDefaultHost;
    purged = purgeUserData({
      userDir: resolvedUserDir,
      purgeOsCredentials: shouldPurgeOsCreds,
      deleteCredential
    });
  }

  return purged
    ? { extensions, chromeBridge, plugin, kernel, purged }
    : { extensions, chromeBridge, plugin, kernel };
}

function printHelp() {
  console.log([
    'Usage: node uninstall.mjs [options]',
    '',
    'Options:',
    '  --extensions-only    Uninstall only Prism Suite user extensions (prism-suite*.{css,js})',
    '  --plugin-only        Uninstall only Antigravity prism-files plugin',
    '  --with-kernel        Also uninstall the bundled Anti-Claude runtime kernel & background daemon',
    '  --purge              Also delete user profile, caches, handoff memory DB & Prism vault credentials',
    '  --user-dir <dir>     Override Anti-Claude user dir (default: ~/.gemini/antigravity/anti-claude/user)',
    '  --plugin-dir <dir>   Override Antigravity plugins dir (default: ~/.gemini/config/plugins)',
    '  -h, --help           Show this help message'
  ].join('\n'));
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const res = uninstallAll({ argv });
  if (res.extensions) {
    if (res.extensions.removed.length) {
      console.log(`[Anti-Claude Extensions] Removed from ${res.extensions.targetDir}:`);
      for (const f of res.extensions.removed) console.log(`  - ${f}`);
    } else {
      console.log(`[Anti-Claude Extensions] No Prism Suite files found in: ${res.extensions.targetDir}`);
    }
  }
  if (res.kernel) {
    if (res.kernel.skippedUnmanaged) {
      console.log(`[Bundled Anti-Claude Kernel] Skipped unmanaged runtime directory in: ${res.kernel.stateDir}`);
    } else if (res.kernel.removed.length) {
      console.log(`[Bundled Anti-Claude Kernel] Removed runtime from: ${res.kernel.stateDir}`);
    } else {
      console.log(`[Bundled Anti-Claude Kernel] No bundled runtime found in: ${res.kernel.stateDir}`);
    }
  }
  if (res.chromeBridge && res.chromeBridge.removed.length) {
    console.log(`[Chrome/Edge MV3 CUA Bridge] Removed: ${res.chromeBridge.targetDir}`);
  }
  if (res.plugin) {
    if (res.plugin.removed.length) {
      console.log(`[Antigravity Plugin: prism-files] Removed: ${res.plugin.targetDir}`);
    } else {
      console.log(`[Antigravity Plugin: prism-files] Not found at: ${res.plugin.targetDir}`);
    }
    if (res.plugin.cuaRemoved?.length) {
      console.log(`[Antigravity Plugin: prism-cua] Removed: ${res.plugin.cuaTargetDir}`);
    }
  }
  if (res.purged) {
    console.log(
      `[Purge] Removed ${res.purged.removedFiles.length} state/cache files and ${res.purged.removedCredentials.length} Prism vault credentials.`
    );
  }
}
