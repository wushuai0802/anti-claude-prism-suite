import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installExtensions, installKernel, installPlugin, installAll } from '../install.mjs';
import { uninstallExtensions, uninstallKernel, uninstallPlugin, uninstallAll } from '../uninstall.mjs';
import { inspectLocalDaemon } from '../scripts/check-upstream.mjs';
import {
  createPrismFilesServer,
  fallbackLinuxToWindowsPath,
  isSensitivePath,
  buildWindowsExplorerArgs,
  buildWslExplorerArgs,
  isPrivateOrLocalIp,
  validateLanUncPath,
  parseLineCol,
  hasWindowsBatchMeta,
  redactSensitiveText,
  searchTranscripts,
  APP_URI,
  INLINE_URI,
  APP_MIME_TYPE
} from '../plugin/server/index.mjs';
import {
  extractCredentialEmail,
  sanitizeAccountId,
  createAccountVault,
  resolveSafeExecCwd,
  resolveWslInteropEnv,
  cleanPowerShellError
} from '../plugin/server/account-vault.mjs';
import {
  createAccountManager,
  parseQuotaText,
  computeEffectiveQuota,
  evaluateQuotaPoolHealth,
  readLocalAntigravityQuotaCache,
  sanitizePrismUiPrefs,
  readLocalPrismPrefsFromLevelDb
} from '../plugin/server/account-manager.mjs';
import {
  localizeCommitLocally,
  polishZhTechTerms,
  extractZhReleaseHighlights,
  checkPrismSelfUpdate,
  applyPrismSelfUpdate
} from '../plugin/server/upstream-radar.mjs';
import {
  createClientRelauncher,
  buildWinRelaunchWorkerScript,
  buildWinDetachedDispatchScript,
  resolveLocalAntigravityTarget
} from '../plugin/server/relaunch-client.mjs';
import {
  createHandoffMemoryStore,
  redactMemoryText,
  detectNonNativeSqliteMount,
  segmentForFts,
  buildSafeFtsMatchQuery
} from '../plugin/server/handoff-memory.mjs';
import {
  createPrismProfileManager,
  validateEnvVarName,
  validateHttpEndpointUrl,
  PROVIDER_PRESETS,
  TIER_DEFINITIONS
} from '../plugin/server/prism-profile.mjs';
import {
  createModelHub,
  parseSseEvents,
  isPublicRoutableIp,
  searchPublicWebSafe,
  redactOutboundText
} from '../plugin/server/model-hub.mjs';
import { resolveHostRevealTarget } from '../vendor/anti-claude/core/daemon.mjs';
import {
  UPSTREAM_SCHEMA_VERSION,
  evaluateRepoUpdate,
  checkUpstreams,
  renderMarkdownReport,
  syncUpstreamBaseline
} from '../plugin/server/upstream-radar.mjs';
import { runAccountsCli } from '../scripts/prism-accounts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('all v0.4.0 extension & helper scripts pass syntax check and enforce zero-body-observer guards', () => {
  const extJsFiles = ['prism-suite.js', 'prism-suite-fx.js', 'prism-suite-workflow.js'];
  const extCssFiles = ['prism-suite.css', 'prism-suite-fx.css', 'prism-suite-workflow.css'];
  for (const name of [...extJsFiles, ...extCssFiles]) {
    assert.equal(fs.existsSync(path.join(REPO, 'extensions', name)), true, `Missing extensions/${name}`);
  }
  for (const name of extJsFiles) {
    execFileSync(process.execPath, ['--check', path.join(REPO, 'extensions', name)], { stdio: 'pipe' });
  }
  execFileSync(process.execPath, ['--check', path.join(REPO, 'scripts', 'fork-session.mjs')], { stdio: 'pipe' });

  const jsSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.css'), 'utf8');
  const fxSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const wfSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-workflow.js'), 'utf8');

  assert.match(jsSrc, /__agPrismSuiteDispose/);
  assert.match(jsSrc, /__agPrismBus/);
  assert.match(jsSrc, /unregisterPanelSection/);
  assert.match(jsSrc, /unregisterOutlineAction/);
  assert.match(jsSrc, /getDockObstacleZones/);
  assert.match(jsSrc, /scanDockObstacles/);
  assert.match(jsSrc, /positionMoreBadgeSafe/);
  assert.match(jsSrc, /lastObstacleSig/);
  assert.match(jsSrc, /openPrismWorkbenchQuick/);
  assert.match(jsSrc, /findWorkbenchEntry/);
  assert.match(jsSrc, /skipSidebar/);
  assert.match(jsSrc, /triggerRadixMenuOpen/);
  assert.match(jsSrc, /safeClickElement/);
  assert.match(jsSrc, /ag-ps-btn-workbench/);
  assert.match(jsSrc, /ensureMascotDodgeWatcher/);
  assert.match(cssSrc, /data-yield="1"/);
  assert.match(jsSrc, /data-ag-ps-tip-status/);
  assert.doesNotMatch(jsSrc, /class="ag-ps-actor"[^>]*title=/, 'Mascot actors must use pointer-safe custom tooltip');
  assert.match(jsSrc, /setAttrIfChanged/);
  assert.match(jsSrc, /compositionend/);
  assert.match(jsSrc, /ag-ps-tooltip/);
  assert.match(jsSrc, /checkGithubUpdate/);
  assert.match(jsSrc, /positionFloatingPanel/);
  assert.match(jsSrc, /isUserActivelyTyping/);
  assert.match(jsSrc, /detectViewportTurnIndex/);
  assert.match(jsSrc, /ag-ps-thought-peek/);
  assert.match(jsSrc, /clampMascotSize/);
  assert.match(jsSrc, /clampMascotMinCount/);
  assert.match(jsSrc, /mascotRoam/);
  assert.match(jsSrc, /mascotCountMode/);
  assert.match(jsSrc, /mascotMinCount/);
  assert.match(jsSrc, /buildMascotRoster/);
  assert.match(jsSrc, /syncMascotRoaming/);
  assert.match(jsSrc, /getMascotSpeedScale/);
  assert.match(jsSrc, /triggerActorTrick/);
  assert.match(jsSrc, /tryBuddyHighFive/);
  assert.match(jsSrc, /detectLeadStatusEmote/);
  assert.match(jsSrc, /wakeMascotFromWait/);
  assert.match(jsSrc, /mascotVibe/);
  assert.doesNotMatch(jsSrc, /streamObserver\.observe\(document\.body/, 'Must never permanently observe document.body');
  assert.doesNotMatch(fxSrc, /new\s+MutationObserver/, 'FX module must not spawn MutationObservers');
  assert.doesNotMatch(wfSrc, /new\s+MutationObserver/, 'Workflow module must not spawn MutationObservers');
  assert.match(fxSrc, /borderBeam/);
  assert.match(fxSrc, /quotaRing/);
  assert.match(fxSrc, /thinkingOrb/);
  assert.match(fxSrc, /bubbleTint/);
  assert.match(fxSrc, /unreadBadge/);
  assert.match(fxSrc, /switchReturnHelper/);
  assert.match(fxSrc, /quotaHandoffAlert/);
  assert.match(fxSrc, /autoDismissOnboarding/);
  assert.match(fxSrc, /tryDismissOnboardingDialog/);
  assert.match(fxSrc, /unregisterPanelSection/);
  assert.match(wfSrc, /imageContextMenu/);
  assert.match(wfSrc, /\.monaco-diff-editor/);
  assert.match(wfSrc, /cleanCopy/);
  assert.match(wfSrc, /sshPaste/);
  assert.match(wfSrc, /i18nExtraMode/);
  assert.match(wfSrc, /inlineEditHelper/);
  assert.match(wfSrc, /sessionFork/);
  assert.match(wfSrc, /unregisterOutlineAction/);
  assert.doesNotMatch(wfSrc, /tid\.includes\(['"]undo['"]\)|tid\.includes\(['"]revert['"]\)/, 'Must never auto-click generic undo/revert buttons');
  assert.match(cssSrc, /data-ag-ps-light="crystal"/);
  assert.match(cssSrc, /data-ag-ps-light="sage"/);
  assert.match(cssSrc, /data-ag-ps-dark="obsidian"/);
  assert.match(cssSrc, /data-ag-ps-dark="marine"/);
  assert.match(cssSrc, /agPsPopIn/);
  assert.match(cssSrc, /\.ag-ps-subpanel/);
  assert.match(cssSrc, /color-mix\(in srgb, var\(--foreground/);
  assert.match(cssSrc, /agPsLeap/);
  assert.match(cssSrc, /agPsFlipR/);
  assert.match(cssSrc, /agPsRollR/);
  assert.match(cssSrc, /agPsDoubleHop/);
  assert.match(cssSrc, /agPsWiggle/);
  assert.match(cssSrc, /agPsComboFlip/);
  assert.match(cssSrc, /agPsDoze/);
  assert.match(cssSrc, /--ag-ps-sprite-w/);
});

test('installExtensions and uninstallExtensions round-trip all 6 files cleanly without touching others', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-suite-test-'));
  try {
    const userDir = path.join(tmp, 'user');
    const keepFile = path.join(userDir, 'extensions', 'other-ext.js');
    fs.mkdirSync(path.dirname(keepFile), { recursive: true });
    fs.writeFileSync(keepFile, '// keep me');

    const ins = installExtensions({ userDir });
    assert.equal(ins.installed.length, 6);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.css')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-fx.js')), true);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-workflow.js')), true);

    const un = uninstallExtensions({ userDir });
    assert.equal(un.removed.length, 6);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite.js')), false);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-fx.js')), false);
    assert.equal(fs.existsSync(path.join(userDir, 'extensions', 'prism-suite-workflow.js')), false);
    assert.equal(fs.existsSync(keepFile), true, 'Unrelated extension files must be preserved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('upstream.json and check-upstream daemon compatibility inspector work properly', () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8'));
  assert.equal(upstream.upstreams.antiClaude.repo, 'hongqi7/Anti-Claude');
  assert.equal(upstream.upstreams.obsidianPrism.repo, 'RMvdesi/obsidian-prism');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-daemon-check-'));
  try {
    const coreDir = path.join(tmp, 'core');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, 'daemon.mjs'), '// stock daemon without hooks');
    const stock = inspectLocalDaemon(tmp);
    assert.equal(stock.found, true);
    assert.equal(stock.compatible, false);
    assert.equal(stock.missing.length, 3);

    fs.writeFileSync(
      path.join(coreDir, 'daemon.mjs'),
      'function listUserExtensionFiles(){} function getUsageSummary(){} function translateText(){}'
    );
    const patched = inspectLocalDaemon(tmp);
    assert.equal(patched.compatible, true);
    assert.equal(patched.missing.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installPlugin / uninstallPlugin and installAll preserve sibling plugins cleanly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-plugin-test-'));
  try {
    const userDir = path.join(tmp, 'user');
    const pluginsDir = path.join(tmp, 'plugins');
    const siblingFile = path.join(pluginsDir, 'other-plugin', 'plugin.json');
    fs.mkdirSync(path.dirname(siblingFile), { recursive: true });
    fs.writeFileSync(siblingFile, '{"name":"other"}');

    const res = installAll({ userDir, pluginsDir });
    assert.equal(res.extensions.installed.length, 6);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'plugin.json')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'server', 'index.mjs')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'app.html')), true);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files', 'ui', 'inline.html')), true);

    const un = uninstallAll({ userDir, pluginsDir });
    assert.equal(un.extensions.removed.length, 6);
    assert.equal(un.plugin.removed.length, 1);
    assert.equal(fs.existsSync(path.join(pluginsDir, 'prism-files')), false);
    assert.equal(fs.existsSync(siblingFile), true, 'Sibling plugins must remain untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prism-files MCP App server enforces protocol, credential guards, SHA-256 save lock, and WSL path conversion', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-mcp-test-'));
  const prevBrain = process.env.PRISM_FILES_BRAIN_DIR;
  try {
    const workDir = path.join(tmp, 'work');
    const brainDir = path.join(tmp, 'brain');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(brainDir, 'conv-12345678'), { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    process.env.PRISM_FILES_BRAIN_DIR = brainDir;

    const notePath = path.join(workDir, 'notes.md');
    const envPath = path.join(workDir, '.env');
    const brainNote = path.join(brainDir, 'conv-12345678', 'report.md');
    fs.writeFileSync(notePath, '# Hello\nworld', 'utf8');
    fs.writeFileSync(envPath, 'SECRET_KEY=topsecret', 'utf8');
    fs.writeFileSync(brainNote, '# Artifact', 'utf8');

    const srv = createPrismFilesServer({ dataDir, defaultRoot: workDir, accountStateDir: path.join(tmp, 'prism-state') });

    // Protocol handshake & tool visibility (strictly <= 8 model-visible tools; all accounts_*, model_hub_*, & upstream tools are app-only)
    const init = await srv.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.capabilities.resources !== undefined, true);
    const listRes = await srv.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const isAppOnly = (t) => t._meta?.ui?.visibility?.length === 1 && t._meta.ui.visibility[0] === 'app';
    const modelTools = listRes.result.tools.filter((t) => !isAppOnly(t));
    assert.ok(modelTools.length <= 8, `Model-visible tools must stay <= 8, got ${modelTools.length}`);
    assert.deepEqual(
      modelTools.map((t) => t.name).sort(),
      [
        'open_prism_files',
        'prism_ask_model',
        'prism_list_models',
        'prism_memory_list',
        'prism_memory_search',
        'prism_memory_store',
        'prism_quota_sync',
        'show_files_inline'
      ]
    );
    const appOnlyNames = new Set(listRes.result.tools.filter(isAppOnly).map((t) => t.name));
    for (const priv of [
      'accounts_status',
      'accounts_capture',
      'accounts_switch',
      'accounts_delete',
      'check_upstreams',
      'sync_upstream_baseline',
      'handoff_catalog_upsert',
      'handoff_remote_sync',
      'model_hub_get_profile',
      'model_hub_upsert_provider',
      'model_hub_upsert_model',
      'model_hub_probe_speed'
    ]) {
      assert.equal(appOnlyNames.has(priv), true, `${priv} must remain visibility:['app']`);
    }

    // Resources return strict MCP App MIME type
    const appHtmlRes = await srv.handleRpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: APP_URI } });
    assert.equal(appHtmlRes.result.contents[0].mimeType, APP_MIME_TYPE);
    assert.match(appHtmlRes.result.contents[0].text, /ui\/initialize/);
    assert.match(appHtmlRes.result.contents[0].text, /Prism 工作台/);
    assert.match(appHtmlRes.result.contents[0].text, /后台插件进程仍为旧版本/);
    assert.match(appHtmlRes.result.contents[0].text, /如何添加主号与备用号/);
    const inlineHtmlRes = await srv.handleRpc({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: INLINE_URI } });
    assert.equal(inlineHtmlRes.result.contents[0].mimeType, APP_MIME_TYPE);

    // Inline card + directory + recent artifacts
    const inlineCall = await srv.handleToolCall('show_files_inline', { files: [notePath], title: '交付物' });
    assert.equal(inlineCall.structuredContent.items.length, 1);
    assert.equal(inlineCall.structuredContent.items[0].exists, true);

    const artCall = await srv.handleToolCall('list_recent_artifacts', { limit: 10 });
    assert.equal(artCall.structuredContent.items.length, 1);
    assert.equal(artCall.structuredContent.items[0].name, 'report.md');

    // Protected credentials cannot be previewed or saved
    assert.equal(isSensitivePath(envPath), true);
    const envPrev = srv.readFilePreview(envPath);
    assert.equal(envPrev.previewType, 'protected');
    assert.equal(envPrev.text, undefined);
    const envSave = srv.saveFileContent(envPath, 'hacked', Date.now(), 'deadbeef');
    assert.equal(envSave.ok, false);

    // Brain directory is strictly read-only
    const brainPrev = srv.readFilePreview(brainNote);
    assert.equal(brainPrev.editable, false);
    const brainSave = srv.saveFileContent(brainNote, 'overwrite', brainPrev.mtimeMs, brainPrev.baseHash);
    assert.equal(brainSave.ok, false);

    // Safe workspace edit with SHA-256 optimistic lock
    const prev = srv.readFilePreview(notePath);
    assert.equal(prev.editable, true);
    assert.ok(prev.baseHash);
    const blindSave = srv.saveFileContent(notePath, 'no-lock');
    assert.equal(blindSave.ok, false);
    const okSave = srv.saveFileContent(notePath, '# Updated\nok', prev.mtimeMs, prev.baseHash);
    assert.equal(okSave.ok, true);
    const staleSave = srv.saveFileContent(notePath, '# Stale', prev.mtimeMs, prev.baseHash);
    assert.equal(staleSave.ok, false);
    assert.equal(staleSave.conflict, true);

    // WSL path fallback conversion
    assert.equal(fallbackLinuxToWindowsPath('/mnt/d/AIWorkspace/test.txt'), 'D:\\AIWorkspace\\test.txt');
    assert.equal(fallbackLinuxToWindowsPath('/home/alice/demo.md', 'Ubuntu'), '\\\\wsl.localhost\\Ubuntu\\home\\alice\\demo.md');
  } finally {
    if (prevBrain === undefined) delete process.env.PRISM_FILES_BRAIN_DIR;
    else process.env.PRISM_FILES_BRAIN_DIR = prevBrain;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('prism-files 2.0 enforces Windows space-path reveal, private LAN SMB validation, Open With safety, and redacted transcript search', async () => {
  // 1. Windows & WSL explorer reveal args (spaces, commas, drive root)
  assert.deepEqual(buildWindowsExplorerArgs('D:\\', true), ['D:\\']);
  assert.deepEqual(
    buildWindowsExplorerArgs('D:\\AIWorkspace\\ops\\WS NAS\\my, report.md', false),
    ['/select,"D:\\AIWorkspace\\ops\\WS NAS\\my, report.md"']
  );
  assert.deepEqual(
    buildWslExplorerArgs('D:\\AIWorkspace\\ops\\WS NAS\\my, report.md', false),
    ['/select,', 'D:\\AIWorkspace\\ops\\WS NAS\\my, report.md']
  );

  // 2. Private IP & LAN UNC/SMB validation
  assert.equal(isPrivateOrLocalIp('192.168.1.50'), true);
  assert.equal(isPrivateOrLocalIp('10.0.0.5'), true);
  assert.equal(isPrivateOrLocalIp('100.64.12.34'), true);
  assert.equal(isPrivateOrLocalIp('::ffff:192.168.1.8'), true);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
  assert.equal(isPrivateOrLocalIp('1.1.1.1'), false);

  const okWsl = await validateLanUncPath('\\\\wsl.localhost\\Ubuntu\\home\\demo');
  assert.equal(okWsl.ok, true);
  const okPrivateDns = await validateLanUncPath('\\\\nas-box\\share\\doc.md', {
    lookupFn: async () => [{ address: '192.168.1.99', family: 4 }]
  });
  assert.equal(okPrivateDns.ok, true);
  const blockedMixedDns = await validateLanUncPath('\\\\evil-rebind.example\\share\\x', {
    lookupFn: async () => [
      { address: '192.168.1.99', family: 4 },
      { address: '93.184.216.34', family: 4 }
    ]
  });
  assert.equal(blockedMixedDns.ok, false);
  assert.equal((await validateLanUncPath('\\\\user@192.168.1.5\\share\\a')).ok, false);
  assert.equal((await validateLanUncPath('\\\\?\\C:\\Windows\\win.ini')).ok, false);

  // 3. Open With line:col & batch metachar guards
  assert.deepEqual(parseLineCol('42', '7'), { line: 42, column: 7 });
  assert.deepEqual(parseLineCol('not-a-num', '-3'), { line: null, column: null });
  assert.equal(hasWindowsBatchMeta('D:\\proj\\hello.js'), false);
  assert.equal(hasWindowsBatchMeta('D:\\proj\\a&calc.exe'), true);

  // 4. Secret redaction + cross-session transcript search + symlink jail
  const redacted = redactSensitiveText('token=sk-1234567890abcdefghij123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abcdef.123456');
  assert.doesNotMatch(redacted, /sk-1234567890/);
  assert.doesNotMatch(redacted, /eyJhbGciOiJIUzI1NiJ9/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-search-test-'));
  try {
    const brainDir = path.join(tmp, 'brain');
    const logDir = path.join(brainDir, 'sess-alpha-001', '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptFile = path.join(logDir, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptFile,
      [
        JSON.stringify({ role: 'user', content: 'Please optimize BorderBeam shader and check token ghp_secret1234567890abcdef1234567890' }),
        JSON.stringify({ role: 'assistant', content: 'Here is the fix:\n```js\nconst borderBeamSpeed = 1.5;\n```' }),
        'not-valid-json-line'
      ].join('\n'),
      'utf8'
    );

    // Create a symlink session pointing outside brainDir to confirm symlink jail rejects it
    const outsideDir = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(outsideDir, '.system_generated', 'logs'), { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, '.system_generated', 'logs', 'transcript.jsonl'),
      JSON.stringify({ role: 'user', content: 'BorderBeam secret outside jail' }) + '\n',
      'utf8'
    );
    try {
      fs.symlinkSync(outsideDir, path.join(brainDir, 'sess-symlink-escape'), 'dir');
    } catch {}

    const allHits = searchTranscripts({ query: 'BorderBeam', filter: 'all', brainDir });
    assert.equal(allHits.ok, true);
    assert.ok(allHits.results.length >= 2);
    assert.equal(allHits.results.some((r) => r.sessionId === 'sess-symlink-escape'), false, 'Symlink session must be rejected');
    assert.equal(allHits.results.some((r) => /ghp_secret/.test(r.snippet)), false, 'Secrets must be redacted in snippets');

    const codeHits = searchTranscripts({ query: 'borderBeamSpeed', filter: 'code_cmd', brainDir });
    assert.equal(codeHits.ok, true);
    assert.equal(codeHits.results.length, 1);

    const proseOnlyMiss = searchTranscripts({ query: 'borderBeamSpeed', filter: 'prose', brainDir });
    assert.equal(proseOnlyMiss.results.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.4.1 audit security guards block NTFS ADS, UNC bypasses, secret-slice leaks, symlinked brainDir writes, and nested plugin paths', async () => {
  // P0-4: NTFS ADS & trailing dot/space bypass guards
  assert.equal(isSensitivePath('/work/.env::$DATA'), true);
  assert.equal(isSensitivePath('C:\\work\\.env::$DATA'), true);
  assert.equal(isSensitivePath('/work/.env.'), true);
  assert.equal(isSensitivePath('/work/id_rsa '), true);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-v041-audit-'));
  const prevBrain = process.env.PRISM_FILES_BRAIN_DIR;
  try {
    const workDir = path.join(tmp, 'work');
    const realBrain = path.join(tmp, 'real-brain');
    const linkBrain = path.join(tmp, 'link-brain');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.join(realBrain, 'sess-001', '.system_generated', 'logs'), { recursive: true });

    try {
      fs.symlinkSync(realBrain, linkBrain, 'dir');
    } catch {}
    const effectiveBrain = fs.existsSync(linkBrain) ? linkBrain : realBrain;
    process.env.PRISM_FILES_BRAIN_DIR = effectiveBrain;

    const brainDoc = path.join(realBrain, 'sess-001', 'note.md');
    fs.writeFileSync(brainDoc, '# Brain Artifact', 'utf8');

    // P0-2: Mid-secret match must still redact the secret before snippet slicing
    fs.writeFileSync(
      path.join(realBrain, 'sess-001', '.system_generated', 'logs', 'transcript.jsonl'),
      JSON.stringify({
        role: 'assistant',
        content: 'Key block:\n-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(120) + 'TARGET_MARKER' + 'B'.repeat(80) + '\n-----END RSA PRIVATE KEY-----'
      }) + '\n',
      'utf8'
    );

    const srv = createPrismFilesServer({ dataDir, defaultRoot: workDir });

    // P0-3: Symlinked brainDir remains strictly read-only
    const brainPrev = srv.readFilePreview(brainDoc);
    assert.equal(brainPrev.editable, false);
    const brainSave = srv.saveFileContent(brainDoc, 'overwrite', brainPrev.mtimeMs, brainPrev.baseHash);
    assert.equal(brainSave.ok, false);

    // P0-1: open_prism_files blocks public UNC & falls back to safe local dir
    const openBlocked = await srv.handleToolCall('open_prism_files', { dir: '\\\\8.8.8.8\\public-share' });
    assert.ok(openBlocked.structuredContent.warning, 'Public UNC dir must trigger warning fallback');
    assert.notEqual(openBlocked.structuredContent.listing.dir, '\\\\8.8.8.8\\public-share');

    // P0-2: Secret prefix sliced away by window still redacted
    const hitMidSecret = searchTranscripts({ query: 'TARGET_MARKER', filter: 'all', brainDir: effectiveBrain });
    assert.equal(hitMidSecret.ok, true);
    assert.equal(hitMidSecret.results.length, 0, 'Redacted private key interior must not leak or match raw key payload');

    // P2: installPlugin / uninstallPlugin must not double-nest prism-files/prism-files
    const pluginsRoot = path.join(tmp, 'plugins-root');
    const explicitTarget = path.join(pluginsRoot, 'prism-files');
    const ins = installPlugin({ pluginsDir: explicitTarget });
    assert.equal(ins.targetDir, explicitTarget);
    assert.equal(fs.existsSync(path.join(explicitTarget, 'prism-files')), false);
    const un = uninstallPlugin({ pluginsDir: explicitTarget });
    assert.deepEqual(un.removed, [explicitTarget]);
    assert.equal(fs.existsSync(explicitTarget), false);
  } finally {
    if (prevBrain === undefined) delete process.env.PRISM_FILES_BRAIN_DIR;
    else process.env.PRISM_FILES_BRAIN_DIR = prevBrain;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 isolated account relay enforces email verification, ownership preservation, lock, rollback, and primary/backup routing (all mocked)', async () => {
  // 1. Credential email extraction (direct JSON, nested base64 token, JWT, WSL2 envelope)
  assert.equal(extractCredentialEmail(JSON.stringify({ id_token_email: 'Primary@Example.COM' })), 'primary@example.com');
  const innerB64 = Buffer.from(JSON.stringify({ id_token_email: 'Nested@Example.com' }), 'utf8').toString('base64');
  assert.equal(extractCredentialEmail(JSON.stringify({ token: innerB64 })), 'nested@example.com');
  const jwtHeader = Buffer.from('{"alg":"none"}').toString('base64url');
  const jwtBody = Buffer.from('{"email":"JwtUser@Example.org"}').toString('base64url');
  assert.equal(extractCredentialEmail(`${jwtHeader}.${jwtBody}.sig`), 'jwtuser@example.org');
  const wslEnv = JSON.stringify({
    kind: 'prism-wsl-cred-v1',
    oauthTokenB64: Buffer.from(JSON.stringify({ id_token_email: 'Wsl@Example.net' })).toString('base64')
  });
  assert.equal(extractCredentialEmail(wslEnv), 'wsl@example.net');
  assert.throws(() => sanitizeAccountId('../bad'), /INVALID|无效/);

  // 2. Sensitive path protection for Antigravity OAuth tokens & prism-suite metadata
  assert.equal(isSensitivePath('/home/user/.gemini/jetski-standalone-oauth-token'), true);
  assert.equal(isSensitivePath('/home/user/.config/antigravity/credential-user-scope'), true);
  assert.equal(isSensitivePath('/home/user/.gemini/antigravity/prism-suite/accounts.json'), true);
  assert.equal(isSensitivePath('/home/user/.gemini/antigravity/prism-suite/switch.lock'), true);

  // 3. Full mock OS credential store via injected runCmd (never touches real OS vault or ~/.gemini)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-acct-test-'));
  let mem = null;
  try {
    const stateDir = path.join(tmp, 'prism-suite');
    const brainDir = path.join(tmp, 'brain');
    fs.mkdirSync(path.join(brainDir, 'conv-abc'), { recursive: true });
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('main@example.com', 'tok_main_1'));

    let forceReadVerifyFailAfterWrite = false;
    let activeWriteSeen = false;
    const mockRunCmd = (_bin, args, { input = '' } = {}) => {
      if (args.includes('-EncodedCommand')) {
        const req = JSON.parse(input);
        if (req.op === 'probe') return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
        if (req.op === 'read') {
          if (forceReadVerifyFailAfterWrite && activeWriteSeen && req.target === 'gemini:antigravity') {
            return {
              status: 0,
              stdout: JSON.stringify({ ok: true, found: true, blobB64: Buffer.from('corrupted', 'utf8').toString('base64') }) + '\n',
              stderr: ''
            };
          }
          const b = fakeCredStore.get(req.target);
          return {
            status: 0,
            stdout: JSON.stringify(b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false }) + '\n',
            stderr: ''
          };
        }
        if (req.op === 'write') {
          if (req.target === 'gemini:antigravity') activeWriteSeen = true;
          fakeCredStore.set(req.target, Buffer.from(req.blobB64, 'base64'));
          return { status: 0, stdout: '{"ok":true,"written":true}\n', stderr: '' };
        }
        if (req.op === 'delete') {
          const had = fakeCredStore.delete(req.target);
          return { status: 0, stdout: JSON.stringify({ ok: true, deleted: had }) + '\n', stderr: '' };
        }
      }
      throw new Error(`Unexpected command: ${_bin}`);
    };

    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: mockRunCmd });
    mem = createHandoffMemoryStore({ stateDir });
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir, vault, handoffMemory: mem });

    // Default OFF rejects capture/switch
    assert.equal(mgr.getStatus().enabled, false);
    assert.throws(() => mgr.captureCurrentAccount({ role: 'primary' }), /默认关闭|ACCOUNTS_DISABLED/);

    // Explicit opt-in & capture primary + backup
    mgr.setEnabled(true);
    const capPrimary = mgr.captureCurrentAccount({ role: 'primary', alias: '主力号', modelsSupported: ['claude', 'gemini'] });
    assert.equal(capPrimary.account.role, 'primary');
    assert.equal(capPrimary.account.email, 'main@example.com');

    // Simulate external manual login to backup account -> capture as backup
    fakeCredStore.set('gemini:antigravity', makeCredBlob('backup@example.com', 'tok_bak_1'));
    const capBackup = mgr.captureCurrentAccount({ role: 'backup', alias: '备用一', modelsSupported: ['gemini'] });
    assert.equal(capBackup.account.role, 'backup');

    // Dry-run does NOT alter active credential
    const dry = mgr.switchAccount(capPrimary.account.id, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'backup@example.com');

    // Ownership drift guard: externally switch active credential to an unregistered account -> blocked
    fakeCredStore.set('gemini:antigravity', makeCredBlob('stranger@example.com', 'tok_stranger'));
    assert.throws(() => mgr.switchAccount(capPrimary.account.id), /尚未捕获到隔离库|UNCAPTURED_ACTIVE_ACCOUNT/);

    // Restore active to backup & perform verified atomic switch back to primary (with pre-switch 4-element snapshot)
    fakeCredStore.set('gemini:antigravity', makeCredBlob('backup@example.com', 'tok_bak_2'));
    const swRes = mgr.switchAccount(capPrimary.account.id, { handoff: { cwd: tmp, nextAction: '继续验证' } });
    assert.equal(swRes.ok, true);
    assert.equal(swRes.backedUpTo, capBackup.account.id, 'Updated active backup token must be saved to its true owner slot');
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com');
    assert.equal(extractCredentialEmail(fakeCredStore.get(`prism-suite:account:${capBackup.account.id}`)), 'backup@example.com');

    // Recommendation guards & offline quota reset projection (5h / 7d)
    const nowRef = Date.now();
    const parsedQ = parseQuotaText('5h: 75% 剩余 2h30m 后重置; 7d: 已用 96%', nowRef);
    assert.equal(parsedQ.window5hPct, 75);
    assert.equal(parsedQ.window7dPct, 4);
    assert.ok(parsedQ.reset5hAt);

    // Offline primary whose 7d reset timestamp is already in the past projects back to 100% (including per-family buckets!)
    mgr.updateAccount(capPrimary.account.id, {
      quota: {
        window7dPct: 2,
        window5hPct: 10,
        reset7dAt: new Date(nowRef - 60000).toISOString(),
        reset5hAt: new Date(nowRef + 3600000).toISOString(),
        families: {
          gemini: {
            pct5h: 15.7,
            pct7d: 2.8,
            reset5hAt: new Date(nowRef - 60000).toISOString(),
            reset7dAt: new Date(nowRef + 86400000).toISOString()
          },
          claude: {
            pct5h: 100,
            pct7d: 96.8
          }
        }
      }
    });
    const effPrimary = computeEffectiveQuota(mgr.getStatus().accounts.find((a) => a.id === capPrimary.account.id).lastQuota, nowRef);
    assert.equal(effPrimary.effective7dPct, 100);
    assert.equal(effPrimary.reset7dPassed, true);
    assert.equal(effPrimary.families.gemini.pct5h, 100, 'Expired family 5h window must project to 100%');
    assert.equal(effPrimary.families.gemini.reset5hPassed, true);
    assert.equal(effPrimary.families.gemini.pct7d, 2.8, 'Future family 7d window must preserve actual remaining %');

    // Critically exhausted primary — even when top-level window7dPct came from healthy Claude (96.8%) while Gemini 7d is 2.8% — must NEVER get recommended badge over healthy backup!
    mgr.updateAccount(capPrimary.account.id, {
      quota: {
        window7dPct: 96.8,
        window5hPct: 100,
        reset7dAt: new Date(nowRef + 86400000).toISOString(),
        families: {
          gemini: { pct5h: 15.7, pct7d: 2.8, reset7dAt: new Date(nowRef + 86400000).toISOString() },
          claude: { pct5h: 100, pct7d: 96.8 }
        }
      }
    });
    mgr.updateAccount(capBackup.account.id, {
      quota: {
        window7dPct: 49.5,
        window5hPct: 91.8,
        reset7dAt: new Date(nowRef + 86400000).toISOString(),
        families: {
          gemini: { pct5h: 91.8, pct7d: 49.5 },
          claude: { pct5h: 100, pct7d: 100 }
        }
      }
    });
    const recWhenPrimaryGeminiExhausted = mgr.pickRecommendedTarget({ currentId: 'acc_other_online' });
    assert.equal(recWhenPrimaryGeminiExhausted.recommended?.accountId, capBackup.account.id, 'Bottleneck Gemini 2.8% on primary must disqualify it in general recommendation');
    assert.equal(recWhenPrimaryGeminiExhausted.primaryRecovery, null, 'Depleted Gemini pool must also suppress primaryRecovery banner');

    // When ALL standby candidates are depleted (<20%), recommended must be null (never recommend an exhausted account)
    mgr.updateAccount(capBackup.account.id, {
      quota: {
        window7dPct: 5,
        window5hPct: 8,
        reset7dAt: new Date(nowRef + 86400000).toISOString(),
        families: { gemini: { pct5h: 8, pct7d: 5 } }
      }
    });
    const recWhenAllExhausted = mgr.pickRecommendedTarget({ currentId: 'acc_other_online' });
    assert.equal(recWhenAllExhausted.recommended, null, 'Must never attach recommended badge when all candidates have <20% bottleneck pool');

    const syncedQ = mgr.syncActiveAccountQuota({ window5hPct: 88, window7dPct: 92 });
    assert.equal(syncedQ.ok, true);
    assert.equal(syncedQ.effectiveQuota.effective7dPct, 92);

    mgr.updateAccount(capPrimary.account.id, { quota: { window7dPct: 45, window5hPct: 80 } });
    mgr.updateAccount(capBackup.account.id, { quota: { window7dPct: 85, window5hPct: 90 } });
    const recBackupForClaude = mgr.pickRecommendedTarget({ currentId: capBackup.account.id, activeModel: 'claude-opus' });
    assert.ok(recBackupForClaude.primaryRecovery, 'Healthy primary above hysteresis must trigger recovery prompt');

    // Atomic rollback if active verification fails after swap
    forceReadVerifyFailAfterWrite = true;
    activeWriteSeen = false;
    assert.throws(() => mgr.switchAccount(capBackup.account.id), (err) => err.rolledBack === true);
    forceReadVerifyFailAfterWrite = false;
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com', 'Rollback must restore previous credential');

    // Concurrent lock blocks overlapping switches; stale lock token protects newer lock owner
    const foreignLock = JSON.stringify({ pid: process.pid, hostname: os.hostname(), createdAt: Date.now(), lockToken: 'foreign-owner' });
    fs.writeFileSync(path.join(stateDir, 'switch.lock'), foreignLock);
    assert.throws(() => mgr.switchAccount(capBackup.account.id), /已有切换事务正在进行中|SWITCH_IN_PROGRESS/);
    assert.throws(() => mgr.deleteAccount(capBackup.account.id), /已有切换事务正在进行中|SWITCH_IN_PROGRESS/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDir, 'switch.lock'), 'utf8')).lockToken, 'foreign-owner');
    fs.rmSync(path.join(stateDir, 'switch.lock'), { force: true });

    // Read-only integrity verification & CLI help/status check
    const integrity = mgr.verifyDataIntegrity();
    assert.equal(integrity.brainSessionCount, 1);
    const helpRes = await runAccountsCli(['--help']);
    assert.equal(helpRes.help, true);
    const statusCli = await runAccountsCli(['status', '--json'], { manager: mgr, handoffMemory: mem });
    assert.equal(statusCli.data.accounts.length, 2);
    assert.doesNotMatch(JSON.stringify(statusCli.data), /tok_main_1|tok_bak_2/);
  } finally {
    try { mem?.close(); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 zero-dep handoff memory redacts secrets and enforces strict chronological order', async () => {
  const redacted = redactMemoryText('sk-1234567890abcdef123456 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig12345678 password="mysecret"');
  assert.doesNotMatch(redacted, /sk-1234567890|eyJhbGciOi|mysecret/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-mem-test-'));
  let store = null;
  try {
    store = createHandoffMemoryStore({ stateDir: path.join(tmp, 'state'), maxEntries: 5 });
    const oldEntry = store.store({
      project: 'demo-app',
      slot: 'main-dev',
      createdAtMs: 1700000000000,
      createdAt: '2026-11-24T10:00:00.000Z',
      summary: '旧里程碑总结',
      verified: 'token=ghp_12345678901234567890123456',
      nextAction: '旧步骤'
    });
    const newEntry = store.store({
      project: 'demo-app',
      slot: 'main-dev',
      createdAtMs: 1700009000000,
      createdAt: '2026-11-25T10:00:00.000Z',
      summary: '最新切号交接',
      verified: 'npm test 10/10 pass',
      nextAction: '检查上线'
    });

    assert.doesNotMatch(oldEntry.verified, /ghp_1234567890/);
    const listed = store.list({ project: 'demo-app', slot: 'main-dev', limit: 10 });
    assert.equal(listed.entries.length, 2);
    assert.equal(listed.entries[0].id, newEntry.id, 'Newest handoff entry must come first');

    const searched = store.search({ query: '上线', project: 'demo-app' });
    assert.equal(searched.entries[0].id, newEntry.id);
    assert.match(store.formatExternalMemoryStorePrompt(newEntry), /memory_store/);
    assert.match(store.formatResumePrompt(newEntry), /已对齐 \[handoff:demo-app:main-dev\]/);
  } finally {
    try { store?.close(); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 selective Upstream Radar keeps root/plugin upstream.json identical and classifies selective candidates', async () => {
  const rootUpstream = fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8');
  const pluginUpstream = fs.readFileSync(path.join(REPO, 'plugin', 'upstream.json'), 'utf8');
  assert.equal(rootUpstream, pluginUpstream, 'upstream.json and plugin/upstream.json must be byte-identical');
  const parsed = JSON.parse(rootUpstream);
  assert.equal(parsed.schema, UPSTREAM_SCHEMA_VERSION);
  assert.ok(parsed.upstreams.agyPowertools);
  assert.ok(parsed.upstreams.agySwitch);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-radar-test-'));
  try {
    const tmpCfg = path.join(tmp, 'upstream.json');
    fs.writeFileSync(tmpCfg, rootUpstream, 'utf8');

    const mockFetch = async (url) => {
      if (url.includes('WhiteBr1ck/agy-powertools/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: 'v2.17.0', name: 'v2.17.0', body: 'New widgets' }) };
      }
      if (url.includes('WhiteBr1ck/agy-powertools/commits')) {
        return { ok: true, json: async () => [{ sha: 'abc1234deadbeef', commit: { message: 'feat: add mini sound indicator', committer: { date: '2026-11-26T00:00:00Z' } } }] };
      }
      if (url.includes('WhiteBr1ck/agy-powertools/compare')) {
        return {
          ok: true,
          json: async () => ({
            ahead_by: 3,
            commits: [
              { sha: '1111111', commit: { message: 'fix: update windows credman target reader' } },
              { sha: '2222222', commit: { message: 'feat: add mini sound indicator' } },
              { sha: '3333333', commit: { message: 'docs: tweak readme banner' } }
            ],
            files: [
              { filename: 'lib/credential-vault.mjs' },
              { filename: 'media/demo.gif' }
            ]
          })
        };
      }
      if (url.includes('RMvdesi/obsidian-prism/commits')) {
        return { ok: true, json: async () => [{ sha: '9999999abcdef', commit: { message: 'feat: glassmorphism dock', committer: { date: '2026-11-26T00:00:00Z' } } }] };
      }
      if (url.includes('compare')) {
        return { ok: true, json: async () => ({ ahead_by: 1, commits: [{ sha: '9999999', commit: { message: 'feat: glassmorphism dock' } }], files: [] }) };
      }
      if (url.includes('hongqi7/Anti-Claude/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.antiClaude.baselineTag }) };
      }
      if (url.includes('hongqi7/Anti-Claude/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.antiClaude.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-25T00:00:00Z' } } }] };
      }
      if (url.includes('anglee0323/agy-switch/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.agySwitch.baselineTag }) };
      }
      if (url.includes('anglee0323/agy-switch/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.agySwitch.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-18T00:00:00Z' } } }] };
      }
      if (url.includes('CursorTouch/Windows-MCP/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.windowsMcp.baselineTag }) };
      }
      if (url.includes('CursorTouch/Windows-MCP/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.windowsMcp.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-26T00:00:00Z' } } }] };
      }
      if (url.includes('microsoft/playwright-mcp/releases/latest')) {
        return { ok: true, json: async () => ({ tag_name: parsed.upstreams.playwrightMcp.baselineTag }) };
      }
      if (url.includes('microsoft/playwright-mcp/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.playwrightMcp.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-18T00:00:00Z' } } }] };
      }
      if (url.includes('Cassius-stack/antigravity-codex-computer-control/commits')) {
        return { ok: true, json: async () => [{ sha: parsed.upstreams.macCodexCua.baselineCommit + '0000', commit: { message: 'sync', committer: { date: '2026-11-15T00:00:00Z' } } }] };
      }
      return { ok: false, status: 404, headers: { get: () => null } };
    };

    const report = await checkUpstreams({
      configPath: tmpCfg,
      fetchImpl: mockFetch,
      cacheFile: path.join(tmp, 'cache.json'),
      force: true
    });
    const agyRes = report.results.find((r) => r.key === 'agyPowertools');
    assert.equal(agyRes.impactLevel, 'HIGH');
    assert.equal(agyRes.watchedHits.includes('lib/credential-vault.mjs'), true);
    assert.equal(agyRes.compatFixes.length, 1);
    assert.equal(agyRes.featureCandidates.length, 1);
    assert.equal(agyRes.skippedNoise.length, 1);

    const md = renderMarkdownReport(report);
    assert.match(md, /择优/);
    assert.match(md, /Clean-Room 隔离红线/);
    assert.match(md, /兼容性 \/ 安全必看/);
    assert.match(md, /新增实用 \/ 有趣功能候选/);

    const synced = syncUpstreamBaseline(tmpCfg, { keys: ['agyPowertools'], report });
    assert.deepEqual(synced.updatedKeys, ['agyPowertools']);
    const afterCfg = JSON.parse(fs.readFileSync(tmpCfg, 'utf8'));
    assert.equal(afterCfg.upstreams.agyPowertools.baselineTag, 'v2.17.0');
    assert.equal(afterCfg.upstreams.agyPowertools.baselineCommit, 'abc1234');

    // Cache invalidation check: cached report must NOT return stale hits after baseline config changes on disk
    const mockFetchSynced = async (url) => {
      if (url.includes('agy-powertools/releases/latest')) return { ok: true, json: async () => ({ tag_name: 'v2.17.0' }) };
      if (url.includes('agy-powertools/commits')) return { ok: true, json: async () => [{ sha: 'abc1234', commit: { message: 'v2.17.0' } }] };
      return mockFetch(url);
    };
    const resAfterSync = await checkUpstreams({
      configPath: tmpCfg,
      fetchImpl: mockFetchSynced,
      cacheFile: path.join(tmp, 'cache.json'),
      onlyKeys: ['agyPowertools']
    });
    assert.equal(resAfterSync.fromCache, false, 'Config change must invalidate old cache entry');
    assert.equal(resAfterSync.results[0].impactLevel, 'UP_TO_DATE');

    // sync_upstream_baseline MCP tool end-to-end check on isolated tmp config
    fs.writeFileSync(tmpCfg, rootUpstream, 'utf8');
    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'srv-data'),
      defaultRoot: tmp,
      accountStateDir: path.join(tmp, 'srv-state'),
      upstreamConfigPath: tmpCfg,
      upstreamFetch: mockFetch
    });
    const origObsidianCommit = JSON.parse(rootUpstream).upstreams.obsidianPrism.baselineCommit;
    const mcpSync = await srv.handleToolCall('sync_upstream_baseline', { keys: ['obsidianPrism'] });
    assert.deepEqual(mcpSync.structuredContent.updatedKeys, ['obsidianPrism']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8')).upstreams.obsidianPrism.baselineCommit, origObsidianCommit);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 in-place plugin installer preserves directory inode and batch vault recovers from deleted cwd & stale interop', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-fix-test-'));
  const origCwd = process.cwd();
  try {
    // 1. installPlugin preserves root directory inode across updates and removes stale leftovers
    const pluginsDir = path.join(tmp, 'plugins');
    const first = installPlugin({ pluginsDir });
    const firstIno = fs.statSync(first.targetDir).ino;
    const staleFile = path.join(first.targetDir, 'stale-obsolete.txt');
    const staleDir = path.join(first.targetDir, 'stale-dir');
    fs.writeFileSync(staleFile, 'old', 'utf8');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'old.js'), 'x', 'utf8');

    const second = installPlugin({ pluginsDir });
    const secondIno = fs.statSync(second.targetDir).ino;
    assert.equal(secondIno, firstIno, 'installPlugin must preserve plugin root inode so running servers do not lose cwd');
    assert.equal(fs.existsSync(staleFile), false, 'Stale file must be removed during in-place sync');
    assert.equal(fs.existsSync(staleDir), false, 'Stale directory must be removed during in-place sync');

    // 2. resolveSafeExecCwd survives deleted/ENOENT process.cwd() and returns safe path (cross-platform)
    if (process.platform === 'win32') {
      const safeNonWsl = resolveSafeExecCwd({
        isWsl: false,
        homeDir: tmp,
        tmpDir: tmp,
        getCwd: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }
      });
      assert.equal(safeNonWsl, tmp);
    } else {
      const ghostDir = path.join(tmp, 'ghost-cwd');
      fs.mkdirSync(ghostDir, { recursive: true });
      process.chdir(ghostDir);
      fs.rmdirSync(ghostDir);
      const safeNonWsl = resolveSafeExecCwd({ isWsl: false, homeDir: tmp, tmpDir: tmp });
      assert.equal(fs.existsSync(safeNonWsl), true);
      process.chdir(origCwd);
    }
    const safeWslMock = resolveSafeExecCwd({
      isWsl: true,
      homeDir: tmp,
      tmpDir: tmp,
      existsSync: (p) => p === '/mnt/c' || p === tmp
    });
    assert.equal(safeWslMock, '/mnt/c');

    // 3. resolveWslInteropEnv replaces dead WSL_INTEROP socket with newest live *_interop socket
    const interopDir = path.join(tmp, 'wsl-sockets');
    fs.mkdirSync(interopDir, { recursive: true });
    const oldSock = path.join(interopDir, '100_interop');
    const newSock = path.join(interopDir, '200_interop');
    fs.writeFileSync(oldSock, '');
    fs.writeFileSync(newSock, '');
    fs.utimesSync(oldSock, new Date(1700000000000), new Date(1700000000000));
    fs.utimesSync(newSock, new Date(1700005000000), new Date(1700005000000));
    const fixedEnv = resolveWslInteropEnv({ WSL_INTEROP: path.join(interopDir, 'dead_interop') }, true, { interopDir });
    assert.equal(fixedEnv.WSL_INTEROP, newSock);

    // 4. cleanPowerShellError strips PowerShell CLIXML noise cleanly
    const clixml = '#< CLIXML\r\n<Objs Version="1.1"><S S="Error">CredWriteW failed_x000D__x000A_</S></Objs>';
    assert.equal(cleanPowerShellError(clixml, '', 1), 'CredWriteW failed');
    assert.equal(cleanPowerShellError('', '', 1, ''), 'exit 1');

    // 5. Batch CredMan transaction performs save/inspectMany/swap in single powershell invocation
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('alpha@example.com', 'tok_alpha'));
    let cmdCallCount = 0;
    const handleOp = (req) => {
      if (req.op === 'probe') return { ok: true };
      if (req.op === 'read') {
        const b = fakeCredStore.get(req.target);
        return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
      }
      if (req.op === 'write') {
        fakeCredStore.set(req.target, Buffer.from(req.blobB64, 'base64'));
        return { ok: true, written: true };
      }
      if (req.op === 'delete') {
        return { ok: true, deleted: fakeCredStore.delete(req.target) };
      }
      throw new Error(`bad op: ${req.op}`);
    };
    const batchRunCmd = (_bin, args, { input = '' } = {}) => {
      cmdCallCount += 1;
      assert.ok(args.includes('-EncodedCommand'));
      const parsed = JSON.parse(input);
      if (parsed.op === 'batch') {
        const results = parsed.ops.map(handleOp);
        // Simulate PowerShell 5.1 edge case when ops.length === 1 and results could be single object or array
        return { status: 0, stdout: JSON.stringify({ ok: true, results }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handleOp(parsed)) + '\n', stderr: '' };
    };

    const batchVault = createAccountVault({
      platform: 'win32',
      isWsl: false,
      homeDir: tmp,
      runCmd: batchRunCmd,
      enableBatch: true
    });
    const batchStateDir = path.join(tmp, 'state');
    const batchMgr = createAccountManager({ homeDir: tmp, stateDir: batchStateDir, brainDir: tmp, vault: batchVault });
    batchMgr.setEnabled(true);

    cmdCallCount = 0;
    const a1 = batchMgr.captureCurrentAccount({ role: 'primary', alias: 'A1' });
    assert.equal(cmdCallCount, 3, 'captureCurrentAccount on win32 uses inspectActive + readActive + 1 batch(write+verify)');

    fakeCredStore.set('gemini:antigravity', makeCredBlob('beta@example.com', 'tok_beta'));
    const a2 = batchMgr.captureCurrentAccount({ role: 'backup', alias: 'B2' });

    cmdCallCount = 0;
    const statusRes = batchMgr.getStatus({ forceRefresh: true });
    assert.equal(statusRes.accounts.length, 2);
    assert.equal(cmdCallCount, 3, 'getStatus(forceRefresh) runs probe + activeRead + single inspectSavedMany batch');
    cmdCallCount = 0;
    const statusWarm = batchMgr.getStatus();
    assert.equal(statusWarm.accounts.length, 2);
    assert.equal(cmdCallCount, 1, 'Warm getStatus skips cached probe & inspectSavedMany (only activeRead)');

    cmdCallCount = 0;
    const sw = batchMgr.switchAccount(a1.account.id, { saveSnapshot: false });
    assert.equal(sw.ok, true);
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'alpha@example.com');
    assert.equal(cmdCallCount, 5, 'win32 batch switch skips cached inspectSaved and merges backup+verify+target read into 1 batch call');

    // Verify wsl-wincred mode minimizes PowerShell calls during getStatus and switchAccount
    const wslHome = path.join(tmp, 'wsl-home');
    fs.mkdirSync(path.join(wslHome, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'), makeCredBlob('w1@example.com', 'tok_w1'));
    const wslVault = createAccountVault({
      platform: 'linux',
      isWsl: true,
      wslDistro: 'Ubuntu',
      homeDir: wslHome,
      runCmd: batchRunCmd,
      enableBatch: true
    });
    const wslMgr = createAccountManager({ homeDir: wslHome, stateDir: path.join(wslHome, 'state'), brainDir: tmp, vault: wslVault });
    wslMgr.setEnabled(true);
    cmdCallCount = 0;
    const w1 = wslMgr.captureCurrentAccount({ role: 'primary', alias: 'W1' });
    assert.equal(cmdCallCount, 1, 'wsl captureCurrentAccount executes exactly 1 PowerShell batch');
    fs.writeFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'), makeCredBlob('w2@example.com', 'tok_w2'));
    const w2 = wslMgr.captureCurrentAccount({ role: 'backup', alias: 'W2' });
    cmdCallCount = 0;
    const wStatus = wslMgr.getStatus();
    assert.equal(wStatus.accounts.length, 2);
    assert.equal(cmdCallCount, 1, 'wsl getStatus runs only probe because capture already populated savedMetaCache');
    cmdCallCount = 0;
    const wSw = wslMgr.switchAccount(w1.account.id, { saveSnapshot: false });
    assert.equal(wSw.ok, true);
    assert.equal(cmdCallCount, 1, 'wsl switchAccount runs exactly 1 single backup/target batch using cached target metadata');
    assert.equal(extractCredentialEmail(fs.readFileSync(path.join(wslHome, '.gemini', 'jetski-standalone-oauth-token'))), 'w1@example.com');
  } finally {
    try { process.chdir(origCwd); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 client relauncher, metadata cache TTL/mtime invalidation, and strict 6-tool visibility', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-relaunch-test-'));
  try {
    // 1. Test createClientRelauncher (dryRun + detached dispatch preserving --remote-debugging-port=0)
    const relaunchCalls = [];
    const mockRelaunchCmd = (_bin, args) => {
      const encIdx = args.indexOf('-EncodedCommand');
      const script = encIdx !== -1 ? Buffer.from(args[encIdx + 1], 'base64').toString('utf16le') : '';
      relaunchCalls.push(script);
      if (script.includes('Win32_Process') && script.includes('hasAntiClaude')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            ok: true,
            targetPath: 'C:\\Users\\Demo\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe',
            hasDebug: true,
            hasAntiClaude: true
          }) + '\n',
          stderr: ''
        };
      }
      return { status: 0, stdout: '{"ok":true,"method":"explorer"}\n', stderr: '' };
    };
    const relauncher = createClientRelauncher({ platform: 'linux', isWsl: true, homeDir: tmp, runCmd: mockRelaunchCmd });
    const dryR = relauncher.scheduleRelaunch({ dryRun: true });
    assert.equal(dryR.ok, true);
    assert.equal(dryR.dryRun, true);
    assert.equal(dryR.preserveDebugPort, true);
    assert.deepEqual(dryR.launchArgs, ['--remote-debugging-port=0']);
    assert.equal(relaunchCalls.length, 1, 'dryRun must only probe and not dispatch worker');

    const realR = relauncher.scheduleRelaunch({ dryRun: false, delayMs: 500 });
    assert.equal(realR.ok, true);
    assert.equal(realR.scheduled, true);
    assert.equal(realR.method, 'explorer');
    assert.equal(relaunchCalls.length, 3, 'Live schedule runs fresh probe + dispatches detached worker script');
    assert.match(relaunchCalls[2], /9BA05972-F6A8-11CF-A442-00A0C90A8F39/);

    // 2. Test vault cache hit, forceRefresh bypass, and external accounts.json mtime invalidation
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('c1@example.com', 'tok_c1'));
    let vaultCmdCount = 0;
    const vaultRunCmd = (_bin, args, { input = '' } = {}) => {
      vaultCmdCount += 1;
      assert.ok(args.includes('-EncodedCommand'));
      const req = JSON.parse(input);
      const handle = (r) => {
        if (r.op === 'probe') return { ok: true };
        if (r.op === 'read') {
          const b = fakeCredStore.get(r.target);
          return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
        }
        if (r.op === 'write') {
          fakeCredStore.set(r.target, Buffer.from(r.blobB64, 'base64'));
          return { ok: true, written: true };
        }
        return { ok: true };
      };
      if (req.op === 'batch') {
        return { status: 0, stdout: JSON.stringify({ ok: true, results: req.ops.map(handle) }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handle(req)) + '\n', stderr: '' };
    };
    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: vaultRunCmd, enableBatch: true });
    const stateDir = path.join(tmp, 'acct-state');
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir: tmp, vault });
    mgr.setEnabled(true);
    const c1 = mgr.captureCurrentAccount({ role: 'primary', alias: 'C1' });
    assert.equal(mgr.getStatus().autoRelaunchAfterSwitch, true, 'autoRelaunchAfterSwitch defaults to true');

    // Warm up cache -> subsequent getStatus only reads active slot (no probe/inspectSavedMany re-call)
    mgr.getStatus();
    vaultCmdCount = 0;
    mgr.getStatus();
    assert.equal(vaultCmdCount, 1, 'Cached probe & savedMetaCache must skip redundant PowerShell calls');

    // forceRefresh: true bypasses probe & savedMetaCache
    vaultCmdCount = 0;
    mgr.getStatus({ forceRefresh: true });
    assert.equal(vaultCmdCount, 3, 'forceRefresh must bypass cache and re-probe + re-inspect');

    // External accounts.json mtime change invalidates cache automatically
    const acctPath = path.join(stateDir, 'accounts.json');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(acctPath, future, future);
    vaultCmdCount = 0;
    mgr.getStatus();
    assert.equal(vaultCmdCount, 3, 'External mtime change on accounts.json must invalidate vault cache');

    // 3. Test MCP Server wiring: strictly 6 model-visible tools, accounts_relaunch_client hidden, autoRelaunch triggers only on live swap
    fakeCredStore.set('gemini:antigravity', makeCredBlob('c2@example.com', 'tok_c2'));
    mgr.captureCurrentAccount({ role: 'backup', alias: 'C2' });
    let relaunchedCount = 0;
    const fakeRelauncher = {
      scheduleRelaunch: ({ dryRun = false } = {}) => {
        if (!dryRun) relaunchedCount += 1;
        return { ok: true, dryRun, scheduled: !dryRun, method: 'mock' };
      }
    };
    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'srv-data'),
      defaultRoot: tmp,
      accountStateDir: stateDir,
      accountManager: mgr,
      clientRelauncher: fakeRelauncher
    });
    const listRpc = await srv.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const visibleToModel = listRpc.result.tools.filter((t) => !(t._meta?.ui?.visibility || []).includes('app'));
    assert.equal(visibleToModel.length, 8, 'Model-visible tool count must remain strictly 8 (<= 8 cap)');
    const relaunchTool = listRpc.result.tools.find((t) => t.name === 'accounts_relaunch_client');
    assert.ok(relaunchTool && relaunchTool._meta?.ui?.visibility?.includes('app'), 'accounts_relaunch_client must be app-only');

    // Dry-run switch must NOT trigger relaunch
    await srv.handleToolCall('accounts_switch', { targetId: c1.account.id, dryRun: true, autoRelaunch: true });
    assert.equal(relaunchedCount, 0);

    // Live switch with autoRelaunch: true triggers scheduleRelaunch once
    const liveSw = await srv.handleToolCall('accounts_switch', { targetId: c1.account.id, dryRun: false, autoRelaunch: true, saveSnapshot: false });
    assert.equal(liveSw.structuredContent.ok, true);
    assert.equal(liveSw.structuredContent.relaunch?.scheduled, true);
    assert.equal(relaunchedCount, 1);

    // Direct accounts_relaunch_client toggle persistence
    const tog = await srv.handleToolCall('accounts_toggle_enabled', { autoRelaunchAfterSwitch: false });
    assert.equal(tog.structuredContent.state.autoRelaunchAfterSwitch, false);
    assert.equal(tog.structuredContent.state.enabled, true, 'Omitted enabled preserves current opt-in state');
  } finally {
    try { process.chdir(origCwd); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.0 polish: incremental quota bridge, auto-capture uncaptured account with rollback safety, lastTab persistence, keyboard/line-ref UI, and in-place Win installer', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-prism-polish-test-'));
  try {
    const fakeCredStore = new Map();
    const makeCredBlob = (email, secret) =>
      Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: secret }), 'utf8');
    fakeCredStore.set('gemini:antigravity', makeCredBlob('main@example.com', 'tok_main'));

    let forceActiveFail = false;
    let activeWriteCount = 0;
    const mockRunCmd = (_bin, args, { input = '' } = {}) => {
      assert.ok(args.includes('-EncodedCommand'));
      const req = JSON.parse(input);
      const handle = (r) => {
        if (r.op === 'probe') return { ok: true };
        if (r.op === 'read') {
          if (forceActiveFail && activeWriteCount > 0 && r.target === 'gemini:antigravity') {
            return { ok: true, found: true, blobB64: Buffer.from('corrupt', 'utf8').toString('base64') };
          }
          const b = fakeCredStore.get(r.target);
          return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
        }
        if (r.op === 'write') {
          if (r.target === 'gemini:antigravity') activeWriteCount += 1;
          fakeCredStore.set(r.target, Buffer.from(r.blobB64, 'base64'));
          return { ok: true, written: true };
        }
        return { ok: true };
      };
      if (req.op === 'batch') {
        return { status: 0, stdout: JSON.stringify({ ok: true, results: req.ops.map(handle) }) + '\n', stderr: '' };
      }
      return { status: 0, stdout: JSON.stringify(handle(req)) + '\n', stderr: '' };
    };

    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: mockRunCmd, enableBatch: true });
    const stateDir = path.join(tmp, 'acct-state');
    const mgr = createAccountManager({ homeDir: tmp, stateDir, brainDir: tmp, vault });
    mgr.setEnabled(true);
    const mainCap = mgr.captureCurrentAccount({ role: 'primary', alias: '主号' });

    // 1. Incremental quota sync preserves existing window when partial telemetry arrives + expectedEmail mismatch guard
    const q1 = mgr.syncActiveAccountQuota({
      window5hPct: 72,
      window7dPct: 88,
      reset7dAt: new Date(Date.now() + 86400000).toISOString(),
      expectedEmail: 'main@example.com',
      tierName: 'Pro',
      families: { gemini: { pct5h: 72, pct7d: 88 }, claude: { pct5h: 95, pct7d: 90 } }
    });
    assert.equal(q1.ok, true);
    assert.equal(q1.effectiveQuota.tierName, 'Pro');
    assert.equal(q1.effectiveQuota.families.claude.pct5h, 95);
    const qWrongEmail = mgr.syncActiveAccountQuota({ window5hPct: 10, expectedEmail: 'other@example.com' });
    assert.equal(qWrongEmail.ok, true);
    assert.equal(qWrongEmail.skipped, true);
    assert.equal(qWrongEmail.reason, 'EMAIL_MISMATCH_SKIPPED', 'Stale quota from another email must be skipped');
    const q2 = mgr.syncActiveAccountQuota({ window5hPct: 65 });
    assert.equal(q2.ok, true);
    assert.equal(q2.effectiveQuota.effective5hPct, 65);
    assert.equal(q2.effectiveQuota.effective7dPct, 88, 'Partial 5h live sync must preserve existing 7d quota');
    assert.equal(q2.effectiveQuota.tierName, 'Pro');
    const qEmpty = mgr.syncActiveAccountQuota({});
    assert.equal(qEmpty.ok, true);
    assert.equal(qEmpty.skipped, true);

    // 2. Uncaptured new account: dryRun previews auto-capture; failed swap rolls back cleanly; live swap auto-captures into backup slot
    fakeCredStore.set('gemini:antigravity', makeCredBlob('fresh@example.com', 'tok_fresh'));
    const dryAuto = mgr.switchAccount(mainCap.account.id, { dryRun: true, autoCaptureUncaptured: true, saveSnapshot: false });
    assert.equal(dryAuto.ok, true);
    assert.equal(dryAuto.wouldAutoCapture?.email, 'fresh@example.com');
    assert.equal(mgr.getStatus().accounts.length, 1, 'dryRun must not mutate accounts.json');

    forceActiveFail = true;
    activeWriteCount = 0;
    assert.throws(() => mgr.switchAccount(mainCap.account.id, { autoCaptureUncaptured: true, saveSnapshot: false }), (e) => e.rolledBack === true);
    forceActiveFail = false;
    assert.equal(mgr.getStatus().accounts.length, 1, 'Failed auto-capture swap must not leave ghost account metadata');

    const liveAuto = mgr.switchAccount(mainCap.account.id, { autoCaptureUncaptured: true, saveSnapshot: false });
    assert.equal(liveAuto.ok, true);
    assert.equal(liveAuto.autoCapturedActive?.email, 'fresh@example.com');
    assert.equal(mgr.getStatus().accounts.length, 2);
    assert.equal(mgr.getStatus().pendingSwitch?.phase, 'active-swapped', 'Same server instance before restart should keep pendingSwitch banner');
    assert.equal(extractCredentialEmail(fakeCredStore.get('gemini:antigravity')), 'main@example.com');
    assert.equal(extractCredentialEmail(fakeCredStore.get(`prism-suite:account:${liveAuto.autoCapturedActive.id}`)), 'fresh@example.com');

    // Simulate a newly started MCP server instance after Antigravity restarts -> pendingSwitch must auto-clear
    const mgrAfterRestart = createAccountManager({
      stateDir,
      vault,
      disableLocalQuotaScan: true,
      serverPid: process.pid + 9999,
      serverBootMs: Date.now() + 2000
    });
    assert.equal(mgrAfterRestart.getStatus().pendingSwitch, null, 'New server instance booted after swap must auto-clear pendingSwitch');

    // 3. lastTab state persistence in prism-files MCP server (accounts is button-scoped, never hijacks normal opens)
    const srv = createPrismFilesServer({ dataDir: path.join(tmp, 'srv-data'), defaultRoot: tmp, accountStateDir: stateDir, accountManager: mgr });
    await srv.handleToolCall('update_state', { lastTab: 'pins' });
    const reopenedPins = await srv.handleToolCall('open_prism_files', {});
    assert.equal(reopenedPins.structuredContent.tab, 'pins', 'open_prism_files without explicit tab should restore regular lastTab');
    await srv.handleToolCall('update_state', { lastTab: 'accounts' });
    const reopenedNotAccounts = await srv.handleToolCall('open_prism_files', {});
    assert.equal(reopenedNotAccounts.structuredContent.tab, 'pins', 'accounts must not overwrite regular lastTab default');
    const explicitAccounts = await srv.handleToolCall('open_prism_files', { tab: 'accounts' });
    assert.equal(explicitAccounts.structuredContent.tab, 'accounts', 'Explicit tab=accounts still opens accounts tab');

    // 4. Read-only Antigravity Local Storage leveldb quota cache hydration (strict email match, zero cross-account leak)
    const fakeLevelDb = path.join(tmp, 'leveldb');
    fs.mkdirSync(fakeLevelDb, { recursive: true });
    const nowTs = Date.now();
    const reset5Sec = Math.floor((nowTs + 2.5 * 3600000) / 1000);
    const reset7Sec = Math.floor((nowTs + 96 * 3600000) / 1000);
    const fakeMainSnap = {
      accountKey: 'main@example.com|g1-pro-tier|Google AI Pro',
      tierName: 'Google AI Pro',
      ts: nowTs + 5000,
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            { window: 'weekly', remainingFraction: 0.089, resetTime: { seconds: String(reset7Sec) } },
            { window: '5h', remainingFraction: 0.445, resetTime: { seconds: String(reset5Sec) } }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { window: 'weekly', remainingFraction: 0.968, resetTime: { seconds: String(reset7Sec) } },
            { window: '5h', remainingFraction: 1 }
          ]
        }
      ]
    };
    const fakeOtherSnap = {
      accountKey: 'stranger@example.com|g1-pro-tier|Free',
      tierName: 'Free',
      ts: nowTs + 6000,
      groups: [{ displayName: 'Gemini Models', buckets: [{ window: '5h', remainingFraction: 0.01 }] }]
    };
    fs.writeFileSync(
      path.join(fakeLevelDb, '000039.log'),
      Buffer.concat([
        Buffer.from('\x00\x01_https://host\x00\x01ag_claude_ux_quota_cache_v1\x01', 'latin1'),
        Buffer.from(JSON.stringify(fakeMainSnap), 'latin1'),
        Buffer.from('\x00\x01ag_claude_ux_quota_cache_v1\x01', 'latin1'),
        Buffer.from(JSON.stringify(fakeOtherSnap), 'latin1')
      ])
    );
    const scanned = readLocalAntigravityQuotaCache({ localStorageDir: fakeLevelDb });
    assert.equal(scanned.byEmail.has('main@example.com'), true);
    assert.equal(scanned.byEmail.get('main@example.com').window5hPct, 44.5);
    assert.equal(scanned.byEmail.get('main@example.com').window7dPct, 8.9);
    assert.equal(scanned.byEmail.get('main@example.com').families.claude.pct7d, 96.8);

    const mgrWithCache = createAccountManager({ stateDir, vault, localStorageDir: fakeLevelDb });
    const stHydrated = mgrWithCache.getStatus({ forceRefresh: true });
    const mainAcc = stHydrated.accounts.find((a) => a.email === 'main@example.com');
    const freshAcc = stHydrated.accounts.find((a) => a.email === 'fresh@example.com');
    assert.equal(mainAcc.effectiveQuota.effective5hPct, 44.5);
    assert.equal(mainAcc.effectiveQuota.effective7dPct, 8.9);
    assert.equal(mainAcc.effectiveQuota.tierName, 'Google AI Pro');
    assert.equal(mainAcc.effectiveQuota.families.gemini.pct5h, 44.5);
    assert.equal(mainAcc.effectiveQuota.families.claude.pct5h, 100);
    assert.equal(freshAcc.effectiveQuota, null, 'Unmatched email snapshot must never bleed into another account');

    // 5. v0.5.5 Chinese commit humanizer + SHA-256 verified self-update (tamper rejection + happy path)
    const zh1 = localizeCommitLocally('feat(v3.1.9): support dragging and pasting local files & folders in Project composer');
    assert.equal(zh1.tagZh, '新功能');
    assert.match(zh1.summaryZh, /拖拽|粘贴|本地文件/);
    const zh2 = localizeCommitLocally('fix(launcher): extend Windows .lnk helper timeout to 15s and pass full env in CI test');
    assert.equal(zh2.tagZh, '修复');
    assert.match(zh2.summaryZh, /快捷方式|超时/);

    const fakeExeBytes = Buffer.from('MZ-fake-prism-installer-payload-v0.9.9');
    const cryptoMod = await import('node:crypto');
    const validSha = cryptoMod.createHash('sha256').update(fakeExeBytes).digest('hex');
    const mkSelfUpdateFetch = (shaText) => async (url) => {
      if (String(url).includes('/releases/latest')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            tag_name: 'v0.9.9',
            name: 'v0.9.9',
            published_at: '2026-11-26T09:00:00Z',
            html_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/tag/v0.9.9',
            body: '- **一键更新**：自动校验 SHA-256 并原地升级\n- **上游雷达中文化**：人话中文摘要',
            assets: [
              {
                name: 'Anti-Claude-Prism-Suite-Setup.exe',
                size: fakeExeBytes.length,
                browser_download_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/download/v0.9.9/Anti-Claude-Prism-Suite-Setup.exe'
              },
              {
                name: 'Anti-Claude-Prism-Suite-Setup.exe.sha256',
                size: 80,
                browser_download_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/download/v0.9.9/Anti-Claude-Prism-Suite-Setup.exe.sha256'
              }
            ]
          })
        };
      }
      if (String(url).endsWith('.sha256')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(shaText, 'utf8') };
      }
      return { ok: true, status: 200, arrayBuffer: async () => fakeExeBytes };
    };

    const chkUpd = await checkPrismSelfUpdate({ currentVersion: '0.5.5', fetchImpl: mkSelfUpdateFetch(`${validSha}  Anti-Claude-Prism-Suite-Setup.exe\n`) });
    assert.equal(chkUpd.hasUpdate, true);
    assert.equal(chkUpd.latestTag, 'v0.9.9');
    assert.equal(chkUpd.highlights.length, 2);

    const lockDir = path.join(tmp, 'upd-lock');
    const sameVerSkipped = await applyPrismSelfUpdate({
      currentVersion: '0.9.9',
      platform: 'win32',
      lockDir,
      fetchImpl: mkSelfUpdateFetch(`${validSha}  Anti-Claude-Prism-Suite-Setup.exe\n`),
      runExecFile: async () => { throw new Error('Should not execute installer when already up to date'); }
    });
    assert.equal(sameVerSkipped.ok, true);
    assert.equal(sameVerSkipped.skipped, true);
    assert.equal(sameVerSkipped.upToDate, true);

    await assert.rejects(
      () => applyPrismSelfUpdate({
        currentVersion: '0.5.5',
        platform: 'win32',
        lockDir,
        fetchImpl: async (url) => {
          if (String(url).includes('/releases/latest')) return mkSelfUpdateFetch(`${validSha}  Anti-Claude-Prism-Suite-Setup.exe\n`)(url);
          return { ok: false, status: 302, headers: new Map([['location', 'https://evil.example.com/payload.exe']]) };
        },
        runExecFile: async () => ({ stdout: '', stderr: '' })
      }),
      (err) => err.code === 'UNTRUSTED_REDIRECT_HOST'
    );

    await assert.rejects(
      () => applyPrismSelfUpdate({
        currentVersion: '0.5.5',
        platform: 'win32',
        lockDir,
        fetchImpl: mkSelfUpdateFetch(`${'0'.repeat(64)}  Anti-Claude-Prism-Suite-Setup.exe\n`),
        runExecFile: async () => ({ stdout: '', stderr: '' })
      }),
      (err) => err.code === 'SHA256_MISMATCH'
    );

    const execCalls = [];
    const appliedUpd = await applyPrismSelfUpdate({
      currentVersion: '0.5.5',
      platform: 'win32',
      lockDir,
      fetchImpl: mkSelfUpdateFetch(`${validSha}  Anti-Claude-Prism-Suite-Setup.exe\n`),
      runExecFile: async (file, args) => {
        execCalls.push({ file, args });
        return { stdout: 'Installed OK', stderr: '' };
      }
    });
    assert.equal(appliedUpd.ok, true);
    assert.equal(appliedUpd.sha256Verified, true);
    assert.equal(appliedUpd.updatedTo, 'v0.9.9');
    assert.deepEqual(execCalls[0].args, ['--silent-install']);

    // Verify WSL2 mode splits safely with --no-wsl (no recursive wsl.exe) + tar entry audit
    const wslCalls = [];
    const wslApplied = await applyPrismSelfUpdate({
      currentVersion: '0.5.5',
      platform: 'linux',
      isWsl: true,
      lockDir,
      pluginDir: path.join(tmp, 'wsl-plugins'),
      fetchImpl: mkSelfUpdateFetch(`${validSha}  Anti-Claude-Prism-Suite-Setup.exe\n`),
      runExecFile: async (file, args) => {
        wslCalls.push({ file, args });
        if (file === 'tar' && args[0] === '-tvzf') {
          return { stdout: '-rw-r--r-- root/root 100 2026-11-26 09:00 repo-v0.9.9/install.mjs\n', stderr: '' };
        }
        if (file === 'tar' && args[0] === '-xzf') {
          const destIdx = args.indexOf('-C') + 1;
          fs.writeFileSync(path.join(args[destIdx], 'install.mjs'), 'console.log("ok")', 'utf8');
          return { stdout: '', stderr: '' };
        }
        return { stdout: 'OK', stderr: '' };
      }
    });
    assert.equal(wslApplied.ok, true);
    assert.equal(wslApplied.method, 'wsl-split-safe-update');
    assert.deepEqual(wslCalls[0].args, ['--silent-install', '--no-wsl']);

    // 6. Static contract checks for persistent module registry, button-scoped focus, self-update, and v0.5.5 release consistency
    const jsSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
    const fxSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
    const wfSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-workflow.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.css'), 'utf8');
    const appHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'app.html'), 'utf8');
    const inlineHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'inline.html'), 'utf8');
    const csSrc = fs.readFileSync(path.join(REPO, 'installer', 'win', 'PrismSuiteInstaller.cs'), 'utf8');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const pluginJson = JSON.parse(fs.readFileSync(path.join(REPO, 'plugin', 'plugin.json'), 'utf8'));

    assert.equal(pkgJson.version, '0.9.4');
    assert.equal(pluginJson.version, pkgJson.version);
    assert.ok(Array.isArray(pluginJson.suggested_prompts) && pluginJson.suggested_prompts.length <= 3);
    assert.equal(Object.keys(pkgJson.dependencies || {}).length, 0, 'Must maintain zero external runtime npm dependencies');
    assert.ok(jsSrc.includes(`SUITE_VERSION = '${pkgJson.version}'`));
    assert.match(jsSrc, /COOKIE_PREFS_KEY = 'ag_prism_prefs_v1'/);
    assert.match(jsSrc, /getActiveInputBox/);
    assert.match(jsSrc, /getInputBoxEl: getActiveInputBox/);
    assert.match(jsSrc, /hydrateDiskPrefs/);
    assert.match(jsSrc, /formatShortTierName/);
    assert.match(jsSrc, /window\.__agPrismModules/);
    assert.match(jsSrc, /clearPendingWorkbenchNav/);
    assert.match(fxSrc, /registerPrismModule\('fx', initFxModule\)/);
    assert.match(fxSrc, /LAST_CONV_COOKIE_KEY = 'ag_prism_last_conv_v1'/);
    assert.match(fxSrc, /quotaDismissScopeKey/);
    assert.match(fxSrc, /scheduleEnsureOverviewOpen/);
    assert.match(fxSrc, /collectRightFloatingPanelRects/);
    assert.match(appHtml, /is-hero-active/);
    assert.match(appHtml, /is-standby-compact/);
    assert.match(appHtml, /evalAccountPoolHealthClient/);
    assert.match(appHtml, /radar-copy-all-picked/);
    assert.match(appHtml, /radar-sync-all/);
    assert.match(appHtml, /handleListDragStart/);
    assert.match(appHtml, /btn-accounts-sort/);
    assert.match(appHtml, /save-alias/);
    assert.match(fxSrc, /borderBeamMode/);
    assert.match(fxSrc, /scrollbarW/);
    assert.match(wfSrc, /registerPrismModule\('workflow', initWorkflowModule\)/);
    assert.match(wfSrc, /resolveTurnActionHost/);
    assert.match(wfSrc, /composerFileDrop/);
    assert.match(jsSrc, /ag_claude_ux_quota_cache_v1/);
    assert.match(jsSrc, /readAntiClaudeQuotaCache/);
    assert.ok(inlineHtml.includes(`version: '${pkgJson.version}'`));
    assert.match(jsSrc, /__agPrismBridge/);
    assert.match(jsSrc, /bridge-ping/);
    assert.match(jsSrc, /bridge-pong/);
    assert.match(jsSrc, /dispatchSwitchTabWithRetry/);
    assert.match(jsSrc, /openWorkbench: openPrismWorkbenchQuick/);
    assert.match(jsSrc, /data-open-workbench-tab="accounts"/);
    assert.match(jsSrc, /parseRelativeResetToIso/);
    assert.match(fxSrc, /ag-ps-nudge-btn-switch/);
    assert.match(fxSrc, /bus\.openWorkbench\('accounts'\)/);
    assert.match(cssSrc, /\.ag-ps-account-bar/);
    assert.match(appHtml, /RESTORABLE_TABS/);
    assert.match(appHtml, /quota-fam-chip/);
    assert.match(appHtml, /is-account-slot/);
    assert.match(appHtml, /\.relay-scroll > \*/);
    assert.match(appHtml, /prism_self_update_check/);
    assert.match(appHtml, /prism_self_update_apply/);
    assert.match(appHtml, /is-compact-controls/);
    assert.match(appHtml, /btn-preview-copy/);
    assert.match(appHtml, /code-ln/);
    assert.match(appHtml, /stepActiveListSelection/);
    assert.match(appHtml, /autoCaptureUncaptured/);
    assert.match(appHtml, /accounts_relaunch_client/);
    assert.match(appHtml, /navigateFromExternalBridge/);
    assert.match(appHtml, /isExternalNavLocked/);
    assert.match(appHtml, /is-focus-flash/);
    assert.match(appHtml, /expectedEmail/);
    assert.match(csSrc, /PruneObsoletePluginEntries/);
    assert.match(csSrc, /CheckDebugPortShortcutStatus/);
    assert.match(csSrc, /EnsureDebugPortOnUserShortcuts/);
    assert.match(csSrc, /InstallKernel/);
    assert.match(csSrc, /prism-suite-00-prefs\.js/);
    assert.ok(csSrc.includes(`v${pkgJson.version}`));
    const installPluginSlice = csSrc.slice(csSrc.indexOf('public static int InstallPlugin('), csSrc.indexOf('private static bool IsReparsePoint('));
    assert.doesNotMatch(installPluginSlice, /Directory\.Delete\(targetDir,\s*true\)/, 'InstallPlugin must update in-place without deleting prism-files root');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.5.7 cross-port UI prefs persistence, compaction guard, Starter tier non-truncation, and debugPort preservation', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v057-'));
  try {
    // 1. Whitelist normalization across all 38 keys + prototype/unknown key rejection
    const clean = sanitizePrismUiPrefs({
      lightPalette: 'sage',
      darkPalette: 'marine',
      mascotCountMode: 'agents',
      mascotMinCount: 99,
      mascotSize: 25,
      borderBeam: true,
      thinkingOrb: true,
      bubbleTintStrength: 5,
      i18nExtraMode: 'zh-CN',
      evilSecret: 'should-strip',
      _ts: 1795658000123
    });
    assert.equal(clean.lightPalette, 'sage');
    assert.equal(clean.darkPalette, 'marine');
    assert.equal(clean.mascotCountMode, 'agents');
    assert.equal(clean.mascotMinCount, 3);
    assert.equal(clean.mascotSize, 26);
    assert.equal(clean.borderBeam, true);
    assert.equal(clean.thinkingOrb, true);
    assert.equal(clean.bubbleTintStrength, 10);
    assert.equal(clean.i18nExtraMode, 'zh-CN');
    assert.equal('evilSecret' in clean, false);
    assert.equal(clean._ts, 1795658000123);
    assert.equal(clean._tsOrigin, 'explicit');
    assert.equal(sanitizePrismUiPrefs({ evilOnly: true }), null);

    // 2. LevelDB prefs recovery + compaction guard + odd-byte UTF-16LE alignment + multi-dir global winner
    const ldbDirOld = path.join(tmp, 'leveldb-old');
    const ldbDir = path.join(tmp, 'leveldb-active');
    fs.mkdirSync(ldbDirOld, { recursive: true });
    fs.mkdirSync(ldbDir, { recursive: true });

    // Older profile dir with legacy record must NOT cause early break over active profile dir
    fs.writeFileSync(
      path.join(ldbDirOld, '000001.log'),
      `ag_prism_suite_prefs_v1\x00\x01${JSON.stringify({ lightPalette: 'crystal', borderBeam: false })}`,
      'latin1'
    );

    const logFile = path.join(ldbDir, '000044.log');
    const explicitPayload = JSON.stringify({
      lightPalette: 'alabaster',
      mascotCountMode: 'agents',
      mascotMinCount: 3,
      borderBeam: true,
      alwaysOutlineRail: true,
      _ts: 1795658000000
    });
    // Place UTF-16LE record at an ODD byte offset (1 byte prefix 0x7f) to verify phase-aligned decoding
    const oddUtf16Record = Buffer.concat([
      Buffer.from([0x7f]),
      Buffer.from(`ag_prism_suite_prefs_v1\x00${explicitPayload}`, 'utf16le')
    ]);
    const quotaPayload = JSON.stringify({
      ts: 1795658005000,
      accountKey: 'starter@example.com|sub',
      tierName: 'Antigravity Starter Quota',
      groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.75 }] }]
    });
    const quotaBuf = Buffer.from(`\x00ag_claude_ux_quota_cache_v1\x00\x01${quotaPayload}`, 'latin1');
    fs.writeFileSync(logFile, Buffer.concat([oddUtf16Record, quotaBuf]));
    const oldTime = new Date(1795658000000);
    fs.utimesSync(logFile, oldTime, oldTime);

    // Simulate Chromium compacting an ancient un-timestamped default record into a brand-new .ldb with newer mtime
    const compactedLdb = path.join(ldbDir, '000099.ldb');
    const legacyDefaultPayload = JSON.stringify({
      lightPalette: 'default',
      mascotCountMode: 'fixed',
      borderBeam: false
    });
    fs.writeFileSync(compactedLdb, `_https://127.0.0.1:33885\x00\x01ag_prism_suite_prefs_v1\x00\x01${legacyDefaultPayload}`, 'latin1');
    const newerCompactedTime = new Date(1795659999000);
    fs.utimesSync(compactedLdb, newerCompactedTime, newerCompactedTime);

    const scannedPrefs = readLocalPrismPrefsFromLevelDb({ localStorageDir: ldbDir, platform: 'linux', homeDir: tmp });
    assert.equal(scannedPrefs.found, true);
    assert.equal(scannedPrefs.hasExplicitTs, true);
    assert.equal(scannedPrefs.prefs.lightPalette, 'alabaster');
    assert.equal(scannedPrefs.prefs.mascotCountMode, 'agents');
    assert.equal(scannedPrefs.prefs.borderBeam, true);

    // Verify 25-char "Antigravity Starter Quota" is NOT truncated to "Quot"
    const quotaScan = readLocalAntigravityQuotaCache({ localStorageDir: ldbDir, platform: 'linux', homeDir: tmp });
    assert.equal(quotaScan.byEmail.get('starter@example.com')?.tierName, 'Antigravity Starter Quota');

    // 3. Seed generation only into installed extension dirs & clean removal on uninstall
    const userDir = path.join(tmp, 'anti-claude-user');
    const bareExtDir = path.join(tmp, 'bare-uninstalled-ext');
    fs.mkdirSync(bareExtDir, { recursive: true });
    installExtensions({ userDir });
    const installedExtDir = path.join(userDir, 'extensions');

    const mgr = createAccountManager({
      homeDir: tmp,
      stateDir: path.join(tmp, 'state'),
      localStorageDir: ldbDir,
      extensionDirs: [installedExtDir, bareExtDir],
      platform: 'linux'
    });
    const seedRes = mgr.syncPrismPrefsSeed({ writeExtensionSeed: true });
    assert.equal(seedRes.ok, true);
    assert.equal(seedRes.found, true);
    assert.equal(fs.existsSync(path.join(tmp, 'state', 'ui-prefs.json')), true);
    assert.equal(fs.existsSync(path.join(installedExtDir, 'prism-suite-00-prefs.js')), true);
    assert.equal(fs.existsSync(path.join(bareExtDir, 'prism-suite-00-prefs.js')), false, 'Must not drop seed in bare uninstalled dir');
    const seedSrc = fs.readFileSync(path.join(installedExtDir, 'prism-suite-00-prefs.js'), 'utf8');
    assert.match(seedSrc, /window\.__agPrismDiskPrefs = seed/);
    assert.match(seedSrc, /hydrateDiskPrefs/);

    const uninst = uninstallExtensions({ userDir });
    assert.equal(uninst.removed.length, 7);
    assert.equal(fs.existsSync(path.join(installedExtDir, 'prism-suite-00-prefs.js')), false);

    // 4. Relauncher preserves explicit --remote-debugging-port=<N> and defaults to 0 when unspecified
    const defaultScript = buildWinRelaunchWorkerScript({ targetPath: 'C:\\App\\Antigravity.exe', preserveDebugPort: true });
    assert.match(defaultScript, /--remote-debugging-port=0/);
    const customPortScript = buildWinRelaunchWorkerScript({ targetPath: 'C:\\App\\Antigravity.exe', preserveDebugPort: true, debugPort: '9222' });
    assert.match(customPortScript, /--remote-debugging-port=9222/);

    const resolvedCustom = resolveLocalAntigravityTarget({
      platform: 'win32',
      isWsl: false,
      homeDir: tmp,
      existsSync: () => false,
      runCmd: () => ({
        status: 0,
        stdout: JSON.stringify({ ok: true, targetPath: 'C:\\App\\Antigravity.exe', hasDebug: true, debugPort: '9333', hasAntiClaude: true }),
        stderr: ''
      })
    });
    assert.deepEqual(resolvedCustom.launchArgs, ['--remote-debugging-port=9333']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.6.0 bundled Anti-Claude v3.1.9 kernel, per-pool quota recommendation veto, radar polish, and AV-safe relauncher', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v060-'));
  try {
    // 1. Bundled vendor/anti-claude kernel has full Prism RPC compatibility + 3-way user config preservation
    const vendorKernelDir = path.join(REPO, 'vendor', 'anti-claude');
    assert.equal(fs.existsSync(path.join(REPO, 'THIRD_PARTY_NOTICES.md')), true);
    const daemonCompat = inspectLocalDaemon(vendorKernelDir);
    assert.equal(daemonCompat.found, true);
    assert.equal(daemonCompat.compatible, true, `Bundled kernel missing hooks: ${daemonCompat.missing.join(', ')}`);
    const vendorPkg = JSON.parse(fs.readFileSync(path.join(vendorKernelDir, 'package.json'), 'utf8'));
    assert.equal(vendorPkg.version, '3.1.10');

    const sandboxStateDir = path.join(tmp, 'anti-claude');
    const sandboxUserDir = path.join(sandboxStateDir, 'user');
    const sandboxPluginsDir = path.join(tmp, 'plugins');
    const res1 = installAll({ userDir: sandboxUserDir, pluginsDir: sandboxPluginsDir, activateKernelDaemon: false });
    assert.ok(res1.kernel);
    assert.equal(fs.existsSync(path.join(sandboxStateDir, 'runtime', 'core', 'daemon.mjs')), true);
    assert.equal(fs.existsSync(path.join(sandboxUserDir, 'custom.js')), true);
    assert.equal(fs.existsSync(path.join(sandboxUserDir, 'config.json')), true);

    // Simulate user customizing config.json -> re-running installKernel must preserve user's custom key via 3-way merge
    const liveCfgPath = path.join(sandboxUserDir, 'config.json');
    const liveCfg = JSON.parse(fs.readFileSync(liveCfgPath, 'utf8'));
    liveCfg.userCustomFlag = 'keep-me-across-upgrade';
    fs.writeFileSync(liveCfgPath, `${JSON.stringify(liveCfg, null, 2)}\n`, 'utf8');

    const res2 = installKernel({ userDir: sandboxUserDir, activateDaemon: false });
    assert.ok(res2.userLayer.merged.includes('config.json') || res2.userLayer.keptLocal.includes('config.json'));
    const afterCfg = JSON.parse(fs.readFileSync(liveCfgPath, 'utf8'));
    assert.equal(afterCfg.userCustomFlag, 'keep-me-across-upgrade');

    const unWithKernel = uninstallAll({ userDir: sandboxUserDir, pluginsDir: sandboxPluginsDir, withKernel: true, deactivateKernelDaemon: false });
    assert.ok(unWithKernel.kernel);
    assert.equal(fs.existsSync(path.join(sandboxStateDir, 'runtime')), false);

    // 2. Per-pool quota bottleneck veto (reproduces screenshot: Gemini 7d 2.8% + Claude 7d 96.8% must NEVER get 推荐)
    const futureIso = new Date(Date.now() + 4 * 24 * 3600 * 1000).toISOString();
    const fakeCredStore = new Map();
    const mkBlob = (email, tok) => Buffer.from(JSON.stringify({ id_token_email: email, refresh_token: tok }), 'utf8');
    const mockVaultRun = (_bin, _args, { input = '' } = {}) => {
      const req = JSON.parse(input);
      const handle = (r) => {
        if (r.op === 'probe') return { ok: true };
        if (r.op === 'read') {
          const b = fakeCredStore.get(r.target);
          return b ? { ok: true, found: true, blobB64: b.toString('base64') } : { ok: true, found: false };
        }
        if (r.op === 'write') {
          fakeCredStore.set(r.target, Buffer.from(r.blobB64, 'base64'));
          return { ok: true, written: true };
        }
        return { ok: true };
      };
      if (req.op === 'batch') return { status: 0, stdout: JSON.stringify({ ok: true, results: req.ops.map(handle) }) + '\n', stderr: '' };
      return { status: 0, stdout: JSON.stringify(handle(req)) + '\n', stderr: '' };
    };
    const vault = createAccountVault({ platform: 'win32', isWsl: false, homeDir: tmp, runCmd: mockVaultRun, enableBatch: true });
    const mgr = createAccountManager({ stateDir: path.join(tmp, 'acc-state'), vault, disableLocalQuotaScan: true });
    mgr.setEnabled(true);

    fakeCredStore.set('gemini:antigravity', mkBlob('primary.lowgem@example.com', 'tok-main'));
    const capPrimary = mgr.captureCurrentAccount({ alias: '主号', role: 'primary', priority: 10 });
    mgr.updateAccount(capPrimary.account.id, {
      quota: {
        // Top-level looks healthy (96.8% from last active Claude session), but Gemini 7d is 2.8%!
        window5hPct: 100,
        window7dPct: 96.8,
        reset5hAt: futureIso,
        reset7dAt: futureIso,
        families: {
          gemini: { pct5h: 15.7, pct7d: 2.8, reset5hAt: futureIso, reset7dAt: futureIso },
          claude: { pct5h: 100, pct7d: 96.8, reset5hAt: futureIso, reset7dAt: futureIso }
        }
      }
    });

    fakeCredStore.set('gemini:antigravity', mkBlob('backup.healthy@example.com', 'tok-bak1'));
    const capHealthy = mgr.captureCurrentAccount({ alias: '健康备用', role: 'backup', priority: 20 });
    mgr.updateAccount(capHealthy.account.id, {
      quota: {
        window5hPct: 91.8,
        window7dPct: 49.5,
        reset5hAt: futureIso,
        reset7dAt: futureIso,
        families: {
          gemini: { pct5h: 91.8, pct7d: 49.5, reset5hAt: futureIso, reset7dAt: future7d => futureIso, reset7dAt: futureIso },
          claude: { pct5h: 100, pct7d: 100, reset5hAt: futureIso, reset7dAt: futureIso }
        }
      }
    });

    fakeCredStore.set('gemini:antigravity', mkBlob('current.online@example.com', 'tok-cur'));
    const capCur = mgr.captureCurrentAccount({ alias: '当前在线', role: 'backup', priority: 30 });
    mgr.updateAccount(capCur.account.id, {
      quota: { window5hPct: 90.5, window7dPct: 97.1, reset5hAt: futureIso, reset7dAt: futureIso }
    });

    const statusAllPools = mgr.getStatus({ forceRefresh: true });
    assert.equal(statusAllPools.recommendation.recommended?.accountId, capHealthy.account.id, 'Must recommend healthy backup over Gemini-exhausted primary');
    assert.equal(statusAllPools.recommendation.primaryRecovery, null, 'Must NOT trigger primaryRecovery when Gemini pool is 2.8%');

    // Explicit single-model query for Claude CAN still pick primary since its Claude pool is 96.8%
    const statusClaudeOnly = mgr.getStatus({ activeModel: 'claude-sonnet-5-5-high', forceRefresh: true });
    assert.equal(statusClaudeOnly.recommendation.recommended?.accountId, capPrimary.account.id);

    // Partial-family guard: if activeModel=gemini and families only has claude=0 while top-level effective is 80, fall back to top-level 80
    const partialHealth = evaluateQuotaPoolHealth(
      { effective5hPct: 80, effective7dPct: 80, families: { claude: { pct5h: 0, pct7d: 0 } } },
      'gemini-4-neon-high'
    );
    assert.equal(partialHealth.minPct, 80);

    // Symlink/junction containment guard in installKernel
    const symStateDir = path.join(tmp, 'sym-state');
    const symUserDir = path.join(symStateDir, 'user');
    fs.mkdirSync(symStateDir, { recursive: true });
    const outsideDir = path.join(tmp, 'outside-target');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.symlinkSync(outsideDir, path.join(symStateDir, 'base'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => installKernel({ userDir: symUserDir, activateDaemon: false }), /symlink/i);

    // 3. Upstream Radar: pre-release, inspiration-only classification, release highlights, and tech-term polish
    const polished = polishZhTechTerms('用纯节点助手替换 VBScript 并收紧门户隔离与滤波器');
    assert.doesNotMatch(polished, /纯节点|门户隔离|滤波器/);
    assert.match(polished, /纯 Node\.js|浮层容器隔离|过滤条件/);

    const relNotes = '## 更新亮点\n- 新增项目框本地文件与目录拖拽引用\n- 模型菜单支持运行中范围提示（tooltipNote）\n- Build artefact checksums';
    const zhHighlights = extractZhReleaseHighlights(relNotes);
    assert.equal(zhHighlights.length, 2);

    const gplEval = evaluateRepoUpdate(
      'obsidianPrism',
      { repo: 'RMvdesi/obsidian-prism', role: 'inspiration-only', license: 'GPL-3.0' },
      {
        latestTag: 'v1.0.8-beta.3',
        latestIsPrerelease: true,
        latestCommit: '41cc481999',
        aheadBy: 2,
        releaseBodies: [relNotes],
        commits: [
          { sha: '1111111', message: 'fix: adjust internal variable spacing in settings tab' },
          { sha: '41cc481', message: 'feat: add translucent tab bar pill indicator' }
        ]
      }
    );
    assert.equal(gplEval.latestIsPrerelease, true);
    assert.equal(gplEval.compatFixes.length, 0, 'GPL inspiration-only internal fixes must not be auto-checked as mandatory compatFixes');
    assert.equal(gplEval.featureCandidates.length, 2);
    assert.equal(gplEval.zhReleaseHighlights.length, 2);

    // 4. Windows AV-friendly detached relauncher: zero Win32_Process.Create and zero nested -EncodedCommand
    const dispatchSrc = buildWinDetachedDispatchScript('dGVzdA==');
    const workerSrc = buildWinRelaunchWorkerScript({ targetPath: 'C:\\App\\Antigravity.exe', preserveDebugPort: true });
    assert.doesNotMatch(dispatchSrc, /Win32_Process|-EncodedCommand/i);
    assert.doesNotMatch(workerSrc, /Win32_Process\.Create|-EncodedCommand/i);
    assert.match(dispatchSrc, /-File/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.6.1 WSL Show in File Explorer host path resolution, security guards, and workflow menu interception', () => {
  // 1. WSL DrvFS mounts (/mnt/<drive> and file:///mnt/<drive> and Antigravity's broken \\wsl.localhost\Ubuntu\mnt\<drive>)
  const rPromo = resolveHostRevealTarget(
    'file:///mnt/e/AIArchive/deliverables/anti-claude-prism-suite-v0.6.0-promo/outputs/anti-claude-prism-suite-v0.6.0-promo.mp4',
    { platform: 'win32', wslDistro: 'Ubuntu' }
  );
  assert.deepEqual(rPromo, {
    ok: true,
    path: 'E:\\AIArchive\\deliverables\\anti-claude-prism-suite-v0.6.0-promo\\outputs\\anti-claude-prism-suite-v0.6.0-promo.mp4',
    kind: 'wsl-drvfs'
  });

  const rSpacesCommas = resolveHostRevealTarget(
    'file:///mnt/d/AIWorkspace/ops/WS%20NAS/my%2C%20report.md',
    { platform: 'win32', wslDistro: 'Ubuntu' }
  );
  assert.deepEqual(rSpacesCommas, {
    ok: true,
    path: 'D:\\AIWorkspace\\ops\\WS NAS\\my, report.md',
    kind: 'wsl-drvfs'
  });

  const rDriveRoot = resolveHostRevealTarget('/mnt/e', { platform: 'win32' });
  assert.deepEqual(rDriveRoot, { ok: true, path: 'E:\\', kind: 'wsl-drvfs' });
  assert.deepEqual(
    resolveHostRevealTarget('file:///E:/', { platform: 'win32' }),
    { ok: true, path: 'E:\\', kind: 'win-drive' }
  );
  assert.equal(
    resolveHostRevealTarget('E:', { platform: 'win32' }).error,
    'relative_path_blocked'
  );

  const rBrokenUnc = resolveHostRevealTarget(
    '\\\\wsl.localhost\\Ubuntu\\mnt\\e\\AIArchive\\test.mp4',
    { platform: 'win32' }
  );
  assert.deepEqual(rBrokenUnc, { ok: true, path: 'E:\\AIArchive\\test.mp4', kind: 'wsl-drvfs' });

  // 2. Pure WSL Linux POSIX path maps to \\wsl.localhost\<distro>\...
  const rLinuxHome = resolveHostRevealTarget('/home/demo/project/README.md', {
    platform: 'win32',
    wslDistro: 'Ubuntu-24.04'
  });
  assert.deepEqual(rLinuxHome, {
    ok: true,
    path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\demo\\project\\README.md',
    kind: 'wsl-posix'
  });

  // 3. Security blocks: remote SMB/UNC (NTLM leak), encoded NUL/quotes, traversal, NTFS ADS
  assert.equal(
    resolveHostRevealTarget('file://198.51.100.7/share/secret.txt', { platform: 'win32' }).ok,
    false
  );
  assert.equal(
    resolveHostRevealTarget('\\\\198.51.100.7\\share\\secret.txt', { platform: 'win32' }).error,
    'remote_unc_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('file:///mnt/e/bad%00name.txt', { platform: 'win32' }).error,
    'invalid_file_url'
  );
  assert.equal(
    resolveHostRevealTarget('file:///mnt/e/bad%22quote.txt', { platform: 'win32' }).error,
    'invalid_file_url'
  );
  assert.equal(
    resolveHostRevealTarget('/mnt/e/bad"quote.txt', { platform: 'win32' }).error,
    'invalid_chars'
  );
  assert.equal(
    resolveHostRevealTarget('/mnt/e/../../etc/passwd', { platform: 'win32' }).error,
    'traversal_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('/mnt/e/file.txt:Zone.Identifier', { platform: 'win32' }).error,
    'ads_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('/mnt/e/foo\\..\\bar.txt', { platform: 'win32' }).error,
    'backslash_in_posix_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('file:///mnt/e/foo\\bar.txt', { platform: 'win32' }).error,
    'backslash_in_file_url_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('file:///mnt/e/foo/../bar.txt', { platform: 'win32' }).error,
    'traversal_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('file:///mnt/e/foo%5cbar.txt', { platform: 'win32' }).error,
    'invalid_file_url'
  );
  assert.equal(
    resolveHostRevealTarget('\\\\wsl.localhost\\bad$distro\\mnt\\e\\a.txt', { platform: 'win32' }).error,
    'invalid_wsl_distro'
  );
  assert.equal(
    resolveHostRevealTarget('/home/demo/a.txt', { platform: 'win32', wslDistro: 'bad/distro' }).error,
    'invalid_wsl_distro'
  );
  assert.equal(
    resolveHostRevealTarget('C:\\foo\\..\\bar.txt', { platform: 'win32' }).error,
    'traversal_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('C:relative.txt', { platform: 'win32' }).error,
    'relative_path_blocked'
  );
  assert.equal(
    resolveHostRevealTarget('/mnt/e/CON.txt', { platform: 'win32' }).error,
    'traversal_blocked'
  );
  // Cross-platform Linux branch works deterministically even when test runner is Windows
  assert.deepEqual(
    resolveHostRevealTarget('/home/demo/dir/', { platform: 'linux' }),
    { ok: true, path: '/home/demo/dir', kind: 'posix' }
  );

  // 4. Cross-port UI pref validator preserves wslExplorerRevealFix & workflow source mounts capture listener
  const sanitized = sanitizePrismUiPrefs({ wslExplorerRevealFix: false, composerFileDrop: true });
  assert.equal(sanitized.wslExplorerRevealFix, false);
  const wfSrc = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-workflow.js'), 'utf8');
  assert.match(wfSrc, /revealInOsFileManager/);
  assert.match(wfSrc, /onRevealMenuClickCapture/);
});

test('v0.7.0 Phase 1: 7-upstream CUA radar, 3 bundled progressive skills, SQLite FTS5 + 9P/taint/remote memory, and zero-dep SSE Model Hub', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v070-phase1-'));
  try {
    // 1. Upstream Radar: 7 sources + CUA/Apache-2.0 boundaries + 3 bundled plugin skills + --no-warnings MCP config
    const upstreamRaw = fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8');
    const upstreamCfg = JSON.parse(upstreamRaw);
    assert.deepEqual(
      Object.keys(upstreamCfg.upstreams).sort(),
      ['agyPowertools', 'agySwitch', 'antiClaude', 'macCodexCua', 'obsidianPrism', 'playwrightMcp', 'windowsMcp']
    );
    assert.equal(upstreamCfg.upstreams.windowsMcp.role, 'cua-reference');
    assert.equal(upstreamCfg.upstreams.playwrightMcp.role, 'browser-cua-reference');
    assert.equal(upstreamCfg.upstreams.playwrightMcp.license, 'Apache-2.0');

    const mcpCfg = JSON.parse(fs.readFileSync(path.join(REPO, 'plugin', 'mcp_config.json'), 'utf8'));
    assert.equal(mcpCfg.mcpServers.files.args.includes('--no-warnings'), true);
    const cuaMcpRaw = fs.readFileSync(path.join(REPO, 'plugin-cua', 'mcp_config.json'), 'utf8');
    assert.doesNotMatch(cuaMcpRaw, /\$\{__dirname\}/, 'plugin-cua mcp_config.json must use ${PLUGIN_ROOT}, never ${__dirname}');
    const cuaMcpCfg = JSON.parse(cuaMcpRaw);
    assert.ok(cuaMcpCfg.mcpServers.control, 'plugin-cua mcp_config.json server key must be "control" so host namespaces it as prism-cua_control');
    assert.ok(cuaMcpCfg.mcpServers.control.args.includes('${PLUGIN_ROOT}/server/index.mjs'));

    const expectedSkills = ['prism-cross-model-council', 'prism-slot-relay', 'prism-upstream-absorb'];
    const pluginsDir = path.join(tmp, 'plugins');
    installPlugin({ pluginsDir });
    for (const sk of expectedSkills) {
      const skPath = path.join(pluginsDir, 'prism-files', 'skills', sk, 'SKILL.md');
      assert.equal(fs.existsSync(skPath), true, `Bundled skill ${sk} must be deployed by installPlugin`);
      const skText = fs.readFileSync(skPath, 'utf8');
      assert.match(skText, new RegExp(`^---\\s*\\nname:\\s*${sk}\\b`));
    }

    const cuaEval = evaluateRepoUpdate('windowsMcp', upstreamCfg.upstreams.windowsMcp, {
      latestTag: 'v0.9.1',
      latestCommit: 'deadbeef123',
      aheadBy: 2,
      commits: [
        { sha: '1111111', message: 'refactor: internal python helper typing' },
        { sha: '2222222', message: 'security: tighten control_consent prompt injection check' }
      ]
    });
    assert.equal(cuaEval.compatFixes.length, 1, 'Only security/consent breaking changes become mandatory compatFixes on cua-reference');
    assert.equal(cuaEval.featureCandidates.length, 1);

    const pwEval = evaluateRepoUpdate('playwrightMcp', upstreamCfg.upstreams.playwrightMcp, {
      latestTag: 'v0.0.87',
      latestCommit: 'cafebabe999',
      aheadBy: 1,
      commits: [{ sha: '3333333', message: 'feat: compress accessibility tree in extension bridge' }]
    });
    const cuaMd = renderMarkdownReport({
      checkedAt: '2026-11-26T00:00:00Z',
      summary: { high: 1, medium: 1, low: 0, upToDate: 0 },
      results: [cuaEval, pwEval]
    });
    assert.match(cuaMd, /Apache-2\.0/);
    assert.match(cuaMd, /THIRD_PARTY_NOTICES\.md/);
    assert.match(cuaMd, /预编译二进制/);

    // 2. Dual-Mode Memory: 9P mount detection & redirect, legacy JSONL migration, CJK FTS5, taint guard, catalog:master, remote HTTP bridge
    const wslMountCheck = detectNonNativeSqliteMount('/mnt/c/Users/Alice/.gemini/state', {
      platform: 'linux',
      mountsText: 'C:\\134 /mnt/c 9p rw,aname=drvfs;path=C:\\ 0 0\n/dev/sdb / ext4 rw 0 0\n',
      realpathFn: (p) => p
    });
    assert.equal(wslMountCheck.unsafe, true);
    assert.equal(
      detectNonNativeSqliteMount('\\\\wsl.localhost\\Ubuntu\\home\\alice\\state', { platform: 'win32', realpathFn: (p) => p }).unsafe,
      true
    );

    const legacyDir = path.join(tmp, 'legacy-mem');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'handoff-memories.jsonl'),
      '\uFEFF' + JSON.stringify({
        id: 'mem-legacy-001',
        createdAt: '2026-11-20T08:00:00.000Z',
        createdAtMs: 1795161600000,
        project: 'prism-suite',
        slot: 'main',
        tags: ['project:prism-suite', 'handoff:prism-suite:main'],
        summary: '已完成双池切号与像素桌宠优化',
        verified: '16/16 pass',
        nextAction: '启动 Phase 1 架构蓝图落地'
      }) + '\r\n{corrupted-line\n',
      'utf8'
    );

    const remotePushed = [];
    const mockRemoteFetch = async (_url, init) => {
      const rpc = JSON.parse(init.body);
      if (rpc.params?.name === 'memory_store') {
        remotePushed.push(rpc.params.arguments);
        return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ jsonrpc: '2.0', id: rpc.id, result: { ok: true } }) };
      }
      if (rpc.params?.name === 'memory_list') {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              entries: [
                {
                  id: 'remote-slot-01',
                  project: 'nas-ops',
                  slot: 'deploy',
                  tags: ['catalog:master', 'handoff:nas-ops:deploy'],
                  cwd: '/volume3/docker/demo',
                  summary: '远程同步槽位 token=sk-secret1234567890abcdef',
                  updatedAtMs: 1795680000000
                }
              ]
            }
          })
        };
      }
      return { ok: false, status: 500 };
    };

    const nativeDbFallback = path.join(tmp, 'native-sqlite');
    const memStore = createHandoffMemoryStore({
      stateDir: legacyDir,
      nativeFallbackDir: nativeDbFallback,
      getRemoteConfig: () => ({ enabled: true, url: 'https://memory.example.org/mcp', syncCatalog: true }),
      fetchImpl: mockRemoteFetch
    });

    try {
      const migratedList = memStore.list({ project: 'prism-suite', slot: 'main' });
      assert.equal(migratedList.total, 1);
      assert.equal(migratedList.entries[0].id, 'mem-legacy-001');
      assert.equal(memStore.getStorageInfo().backend, 'sqlite');
      assert.equal(memStore.getStorageInfo().fts5Enabled, true);

      // CJK 2-char substring FTS5 search ("切号", "蓝图") + FTS5 syntax-injection immunity
      const cjkHit1 = memStore.search({ query: '切号' });
      assert.equal(cjkHit1.entries.length, 1);
      const cjkHit2 = memStore.search({ query: '架构蓝图' });
      assert.equal(cjkHit2.entries.length, 1);
      const injectionSafe = memStore.search({ query: 'C:\\foo "bar" OR NEAR() * ^ : - + 蓝图' });
      assert.equal(injectionSafe.ok, true);
      assert.equal(injectionSafe.entries.length, 1);

      // Taint Guard: untrusted source blocked from handoff:* / catalog:master, quarantined otherwise
      assert.throws(
        () => memStore.store({ source: 'web', tags: ['catalog:master'], summary: 'Prompt injection overwrite' }),
        (err) => err.code === 'TAINTED_HANDOFF_BLOCKED'
      );
      const quarantined = memStore.store({ source: 'browser', project: 'prism-suite', slot: 'main', summary: '外部网页摘录' });
      assert.equal(quarantined.tainted, true);
      assert.equal(quarantined.slotTag, 'quarantine:prism-suite:main');
      assert.equal(memStore.list({ project: 'prism-suite' }).entries.some((e) => e.id === quarantined.id), false);
      assert.equal(memStore.list({ project: 'prism-suite', includeTainted: true }).entries.some((e) => e.id === quarantined.id), true);

      // Clean store pushes async remote & updates catalog:master
      const cleanEntry = memStore.store({
        project: 'prism-suite',
        slot: 'main',
        cwd: '/mnt/d/AIWorkspace/projects/anti-claude-prism-suite',
        gitBranch: 'main',
        gitHead: '34766f5',
        summary: 'Phase 1 双模记忆与模型中枢收尾'
      });
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(remotePushed.length, 1);
      assert.equal(remotePushed[0].slotTag, cleanEntry.slotTag);

      const syncPull = await memStore.syncRemoteCatalog({ limit: 10 });
      assert.equal(syncPull.ok, true);
      assert.equal(syncPull.updatedSlots, 1);
      const catalog = memStore.getMasterCatalog();
      const nasSlot = catalog.slots.find((s) => s.project === 'nas-ops');
      assert.ok(nasSlot);
      assert.doesNotMatch(nasSlot.summary, /sk-secret1234567890/, 'Pulled remote entries must be redacted');
    } finally {
      memStore.close();
    }

    // 3. Universal Model Hub + prism-profile.json isolation + Anti-AV static guard + Anti-SSRF DNS pinning
    assert.equal(isSensitivePath('/home/alice/.gemini/antigravity/anti-claude/prism-profile.json'), true);
    assert.equal(isSensitivePath('C:\\Users\\Alice\\.gemini\\antigravity\\prism-suite\\handoff-memory.sqlite-wal'), true);

    // Static Anti-EDR guard: neither prism-profile.mjs nor model-hub.mjs may reference third-party CLI credential dirs
    for (const srvFile of ['prism-profile.mjs', 'model-hub.mjs']) {
      const src = fs.readFileSync(path.join(REPO, 'plugin', 'server', srvFile), 'utf8');
      assert.doesNotMatch(src, /\.cc-switch|cc-switch\.db|\.codex|\.claude/i, `${srvFile} must have zero references to external tool credential dirs`);
    }

    // Verify installAll + uninstallAll preserve user's prism-profile.json across upgrades and uninstall
    const sbState = path.join(tmp, 'ac-state');
    const sbUser = path.join(sbState, 'user');
    const sbPlugins = path.join(tmp, 'ac-plugins');
    const sbProfilePath = path.join(sbState, 'prism-profile.json');
    const secretMap = new Map();
    const profMgr = createPrismProfileManager({
      profilePath: sbProfilePath,
      env: { TEST_OPENAI_KEY: 'sk-test-env-secret-value-99999999', TEST_ANTH_KEY: 'sk-ant-test-env-secret-88888888' },
      secretStore: {
        getSecret: (id) => secretMap.get(id) || '',
        setSecret: (id, val) => { secretMap.set(id, val); },
        deleteSecret: (id) => secretMap.delete(id)
      }
    });

    assert.throws(() => validateEnvVarName('PATH'), (err) => err.code === 'BLOCKED_ENV_VAR_NAME');
    assert.throws(() => validateEnvVarName('ANTIGRAVITY_CSRF_TOKEN'), (err) => err.code === 'BLOCKED_ENV_VAR_NAME');
    assert.throws(() => validateHttpEndpointUrl('https://user:pass@api.example.com/v1'), (err) => err.code === 'INVALID_ENDPOINT_URL');

    profMgr.upsertProvider({
      id: 'openai-gw',
      preset: 'openai',
      baseUrl: 'https://api.example.org/v1',
      apiKeyEnv: 'TEST_OPENAI_KEY'
    });
    profMgr.upsertProvider({
      id: 'claude-gw',
      preset: 'anthropic',
      baseUrl: 'https://anthropic.example.org/v1',
      apiKey: 'sk-ant-vault-only-secret-1234567890'
    });
    assert.doesNotMatch(fs.readFileSync(sbProfilePath, 'utf8'), /sk-ant-vault-only|sk-test-env/, 'Plaintext keys must NEVER touch prism-profile.json');

    profMgr.upsertModel({
      id: 'primary-astra',
      alias: 'GPT-6.2 Astra',
      providerId: 'openai-gw',
      upstreamModel: 'gpt-6.2-astra',
      tier: 'T1',
      vendor: 'openai',
      fallbackModelId: 'backup-opus',
      favorite: true
    });
    profMgr.upsertModel({
      id: 'backup-opus',
      alias: 'Claude Opus 5.5',
      providerId: 'claude-gw',
      upstreamModel: 'claude-opus-5-5-high',
      tier: 'T1',
      vendor: 'anthropic',
      favorite: true
    });
    profMgr.reorderFavorites(['backup-opus', 'primary-astra']);

    installAll({ userDir: sbUser, pluginsDir: sbPlugins, activateKernelDaemon: false });
    assert.equal(fs.existsSync(sbProfilePath), true, 'installAll must preserve prism-profile.json');
    uninstallAll({ userDir: sbUser, pluginsDir: sbPlugins, withKernel: true, deactivateKernelDaemon: false });
    assert.equal(fs.existsSync(sbProfilePath), true, 'uninstallAll must preserve user prism-profile.json');

    // End-to-end MCP server test: prism_list_models + prism_ask_model (mid-stream SSE error -> 1-hop Anthropic SSE fallback + webSearch)
    let primaryAttempted = false;
    const mockModelFetch = async (url, init) => {
      if (url.includes('api.example.org')) {
        primaryAttempted = true;
        // Simulate 200 OK SSE stream that emits a mid-stream rate_limit error frame!
        const errSse = 'event: error\r\ndata: {"error":{"type":"rate_limit_error","message":"429 quota exceeded"}}\r\n\r\n';
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream' },
          body: [Buffer.from(errSse.slice(0, 19), 'utf8'), Buffer.from(errSse.slice(19), 'utf8')]
        };
      }
      if (url.includes('anthropic.example.org')) {
        const bodyObj = JSON.parse(init.body);
        assert.doesNotMatch(JSON.stringify(bodyObj), /ghp_leaktoken1234567890abcdef/, 'Outbound prompt must scrub accidental PATs');
        assert.equal(init.headers['x-api-key'], 'sk-ant-vault-only-secret-1234567890');
        // Multi-byte UTF-8 Chinese split right through the middle of a 3-byte Chinese character!
        const fullFrame =
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"跨厂商二审结论：VERDICT PASS"}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n';
        const rawBuf = Buffer.from(fullFrame, 'utf8');
        const chunks = [];
        for (let i = 0; i < rawBuf.length; i += 5) {
          chunks.push(rawBuf.subarray(i, Math.min(rawBuf.length, i + 5)));
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream' },
          body: chunks
        };
      }
      throw new Error(`Unexpected model URL: ${url}`);
    };

    let searchCallCount = 0;
    const hub = createModelHub({
      profileManager: profMgr,
      fetchFn: mockModelFetch,
      searchFn: async () => {
        searchCallCount += 1;
        return {
          ok: true,
          results: [{ title: 'Node 22 SQLite Docs', url: 'https://nodejs.org/api/sqlite.html', snippet: 'Built-in SQLite module' }]
        };
      }
    });

    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'mcp-data'),
      defaultRoot: tmp,
      accountStateDir: path.join(tmp, 'mcp-state'),
      prismProfile: profMgr,
      modelHub: hub
    });

    const listModelsRes = await srv.handleToolCall('prism_list_models', { excludeVendor: 'google' });
    assert.equal(listModelsRes.structuredContent.favorites[0].id, 'backup-opus');
    assert.doesNotMatch(
      JSON.stringify(listModelsRes),
      /api\.example\.org|anthropic\.example\.org|TEST_OPENAI_KEY|sk-ant-vault/,
      'prism_list_models must never leak baseUrl, apiKeyEnv, or secrets to the model'
    );

    // Policy gate: with default settings.webSearch=false, model passing webSearch:true MUST NOT trigger external search
    const askBlockedSearch = await srv.handleToolCall('prism_ask_model', {
      model: 'backup-opus',
      prompt: '测试关闭开关时不外连搜索',
      webSearch: true
    });
    assert.equal(searchCallCount, 0, 'Disabled settings.webSearch must block model-requested webSearch:true');
    assert.doesNotMatch(askBlockedSearch.content[0].text, /\[searched sources\]/);

    // Enable settings.webSearch=true: omitted webSearch still MUST NOT search, explicit webSearch:true DOES search
    profMgr.updateSettings({ webSearch: true });
    await srv.handleToolCall('prism_ask_model', {
      model: 'backup-opus',
      prompt: '审查私有代码时未传 webSearch 绝不外发搜索引擎'
    });
    assert.equal(searchCallCount, 0, 'Omitted webSearch must never send prompts to search engine');

    // Cleartext http:// public gateway with API key must be blocked before network fetch
    profMgr.upsertProvider({
      id: 'cleartext-pub',
      preset: 'openai',
      baseUrl: 'http://api.example.org/v1',
      apiKeyEnv: 'TEST_OPENAI_KEY'
    });
    profMgr.upsertModel({
      id: 'insecure-mod',
      providerId: 'cleartext-pub',
      upstreamModel: 'gpt-test',
      tier: 'T4',
      vendor: 'openai'
    });
    await assert.rejects(
      () => srv.handleToolCall('prism_ask_model', { model: 'insecure-mod', prompt: 'hello' }),
      (err) => err.code === 'CLEARTEXT_HTTP_CREDENTIAL_BLOCKED'
    );

    const askRes = await srv.handleToolCall('prism_ask_model', {
      model: 'primary-astra',
      prompt: '请复核此改动，注意测试 token ghp_leaktoken1234567890abcdef123456 是否已脱敏',
      webSearch: true
    });
    assert.equal(searchCallCount, 1);
    assert.equal(primaryAttempted, true);
    assert.equal(askRes.structuredContent.usedFallback, true);
    assert.equal(askRes.structuredContent.actualModelId, 'backup-opus');
    assert.equal(askRes.structuredContent.redactedPrompt, true);
    assert.match(askRes.content[0].text, /跨厂商二审结论：VERDICT PASS/);
    assert.match(askRes.content[0].text, /\[searched sources\]/);
    assert.match(askRes.content[0].text, /nodejs\.org\/api\/sqlite\.html/);

    const speedRes = await srv.handleToolCall('model_hub_probe_speed', { modelId: 'backup-opus' });
    assert.equal(speedRes.structuredContent.ok, true);
    assert.equal(typeof speedRes.structuredContent.ttftMs, 'number');

    // Anti-SSRF & DNS-rebinding guards on searchPublicWebSafe
    assert.equal(isPublicRoutableIp('127.0.0.1'), false);
    assert.equal(isPublicRoutableIp('192.168.1.10'), false);
    assert.equal(isPublicRoutableIp('100.64.5.9'), false);
    assert.equal(isPublicRoutableIp('::ffff:10.0.0.5'), false);
    assert.equal(isPublicRoutableIp('93.184.216.34'), true);

    await assert.rejects(
      () => searchPublicWebSafe('test query', {
        endpointUrl: 'https://rebind.example.com/search',
        lookupFn: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '192.168.1.1', family: 4 }
        ]
      }),
      (err) => err.code === 'SSRF_BLOCKED_IP'
    );
    await assert.rejects(
      () => searchPublicWebSafe('test query', { endpointUrl: 'http://example.com/search' }),
      (err) => err.code === 'UNSAFE_SEARCH_PROTOCOL'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.7.0 daemon windowsHide & unborn git guard, live subagent mascot exit, outline rail overflow, and sidebar wheel bridge', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const daemonSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'daemon.mjs'), 'utf8');
  const kernelInstallSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'install.mjs'), 'utf8');
  const customJsSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.js'), 'utf8');
  const customCssSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.css'), 'utf8');
  const suiteJsSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.js'), 'utf8');
  const suiteCssSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.css'), 'utf8');
  const fxCssSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.css'), 'utf8');
  const fxJsSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');

  // 1. Every Windows child_process invocation in daemon.mjs & install.mjs carries windowsHide: true
  const execGitSlice = daemonSrc.slice(
    daemonSrc.indexOf('function execGitAsync('),
    daemonSrc.indexOf('function parseNumstatOutput(')
  );
  assert.match(execGitSlice, /windowsHide:\s*true/, 'execGitAsync must set windowsHide: true');

  const readProcSlice = daemonSrc.slice(
    daemonSrc.indexOf('function readProcessCommandLine('),
    daemonSrc.indexOf('export function isOwnDaemonProcess(')
  );
  assert.match(readProcSlice, /windowsHide:\s*true/, 'readProcessCommandLine on win32 must set windowsHide: true');

  const pickFilesSlice = daemonSrc.slice(
    daemonSrc.indexOf('function pickLocalFilesNative('),
    daemonSrc.indexOf('const WIN_RESERVED_BASENAME_RE')
  );
  const psCallsInPickers = pickFilesSlice.match(/execFile\(\s*'powershell'[\s\S]*?\}\s*,/g) || [];
  assert.equal(psCallsInPickers.length, 2, 'Both native file/folder pickers use powershell on win32');
  for (const callBlock of psCallsInPickers) {
    assert.match(callBlock, /windowsHide:\s*true/, 'File/folder picker powershell must set windowsHide: true');
  }
  assert.match(kernelInstallSrc, /Get-CimInstance[\s\S]{0,160}windowsHide:\s*true/);

  // 2. Live integration test of readOverviewGitStatusAsync on an unborn repo & a committed repo
  const tmpGit = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-git-unborn-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpGit, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpGit, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpGit, stdio: 'ignore', windowsHide: true });
    fs.writeFileSync(path.join(tmpGit, 'untracked.txt'), 'line1\nline2\n', 'utf8');

    const { readOverviewGitStatusAsync } = await import('../vendor/anti-claude/core/daemon.mjs');
    const unbornUntracked = await readOverviewGitStatusAsync(tmpGit);
    assert.ok(unbornUntracked, 'Unborn git repo with untracked file should resolve status');
    assert.equal(unbornUntracked.branch, 'main');
    assert.equal(unbornUntracked.changedFiles, 1);
    assert.equal(unbornUntracked.added, 0);
    assert.equal(unbornUntracked.deleted, 0);

    // Stage file on unborn branch and test fresh path (bypassing 8s cache via subrepo)
    const tmpGitStaged = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-git-staged-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: tmpGitStaged, stdio: 'ignore', windowsHide: true });
      fs.writeFileSync(path.join(tmpGitStaged, 'hello.txt'), 'a\nb\nc\n', 'utf8');
      execFileSync('git', ['add', 'hello.txt'], { cwd: tmpGitStaged, stdio: 'ignore', windowsHide: true });
      const unbornStaged = await readOverviewGitStatusAsync(tmpGitStaged);
      assert.equal(unbornStaged.branch, 'main');
      assert.equal(unbornStaged.changedFiles, 1);
      assert.equal(unbornStaged.added, 3);
      assert.equal(unbornStaged.deleted, 0);
    } finally {
      fs.rmSync(tmpGitStaged, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(tmpGit, { recursive: true, force: true });
  }

  // 3. Mascots strictly filter to running subagents & animate farewell exit without leaving residue
  const liveSubSlice = suiteJsSrc.slice(
    suiteJsSrc.indexOf('function getLiveSubagents()'),
    suiteJsSrc.indexOf('function buildMascotRoster(')
  );
  assert.match(liveSubSlice, /Boolean\(c\.running\)/, 'getLiveSubagents must filter to actively running subagents');
  assert.match(suiteJsSrc, /retireMascotActorWithExit/);
  assert.match(suiteJsSrc, /data-exiting/);
  assert.match(suiteCssSrc, /@keyframes agPsSubExit/);
  assert.match(suiteCssSrc, /@keyframes agPsSubEnter/);

  // 4. Outline rail prevents horizontal scrollWidth overflow & overlay scrollbar circle artifact
  const railCssSlice = fxCssSrc.slice(
    fxCssSrc.indexOf('#ag-ps-outline-rail {'),
    fxCssSrc.indexOf('#ag-ps-rail-tip {')
  );
  assert.doesNotMatch(railCssSlice, /overflow-x:\s*visible/, 'Outline rail must not set overflow-x: visible');
  assert.match(railCssSlice, /overflow:\s*hidden/);
  assert.match(railCssSlice, /inset:\s*-2px\s+-3px/);
  assert.match(fxJsSrc, /data-scrollable/);

  // 5. Left sidebar wheel-scroll bridge & no-drag guard
  assert.match(customJsSrc, /function findSidebarWheelScroller\(/);
  assert.match(customJsSrc, /function onSidebarWheel\(/);
  assert.match(customJsSrc, /addEventListener\('wheel',\s*onSidebarWheel/);
  assert.match(customJsSrc, /removeEventListener\('wheel',\s*onSidebarWheel,\s*true\)/);
  assert.match(customCssSrc, /:has\(> #ag-claude-recent-section\[data-mode="unified"\]\)[\s\S]{0,160}-webkit-app-region:\s*no-drag\s*!important/);
});

test('v0.7.0 holistic UI clarity, spatial collision choreography, 12-mascot easter eggs, multi-viewport workbench, and 0fps/0ms performance gates', async () => {
  const vm = await import('node:vm');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const suiteJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.js'), 'utf8');
  const suiteCss = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.css'), 'utf8');
  const fxJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const fxCss = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.css'), 'utf8');
  const wfJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-workflow.js'), 'utf8');
  const wfCss = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-workflow.css'), 'utf8');
  const appHtml = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'app.html'), 'utf8');
  const inlineHtml = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'inline.html'), 'utf8');

  // 1. VM syntax verification of embedded <script> in app.html & inline.html
  for (const [name, html] of [['app.html', appHtml], ['inline.html', inlineHtml]]) {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length >= 1, `${name} must contain embedded script`);
    for (const m of scripts) {
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: name }), `${name} inline script must parse cleanly`);
    }
  }

  // 2. Windows HiDPI / ClearType crispness: zero odd-width translateX(-50%) on centered text bars & crisp pixel SVGs
  const jumpToastCss = suiteCss.slice(suiteCss.indexOf('#ag-ps-jump-toast {'), suiteCss.indexOf('/* ---- 4. Usage Book Yardstick'));
  assert.doesNotMatch(jumpToastCss, /translateX\(-50%\)/, '#ag-ps-jump-toast must avoid fractional translateX(-50%) blur');
  assert.match(jumpToastCss, /margin-inline:\s*auto/);

  const returnBarCss = fxCss.slice(fxCss.indexOf('#ag-ps-return-bar {'), fxCss.indexOf('.ag-ps-return-dot'));
  assert.doesNotMatch(returnBarCss, /translateX\(-50%\)/, '#ag-ps-return-bar must avoid fractional translateX(-50%) blur');
  assert.match(returnBarCss, /margin-inline:\s*auto/);
  assert.match(fxJs, /Math\.min\(3,\s*Math\.max\(1,\s*window\.devicePixelRatio\s*\|\|\s*1\)\)/, 'ThinkingOrb supports 3x HiDPI supersampling');

  // 3. Spatial collision avoidance & smooth enter/exit transitions
  assert.match(suiteJs, /function measureOrbDockZone\(/, 'Mascots must measure #ag-ps-orb-dock + stage pill obstacle zone');
  assert.match(fxJs, /#ag-ps-outline\[data-open="1"\]/, 'Outline rail collision check must include open outline drawer');
  assert.match(fxJs, /#ag-ps-img-menu/, 'Outline rail collision check must include context menu');
  assert.match(fxJs, /function positionQuotaNudge\(/, 'Quota nudge must dynamically avoid composer, overview, and jump toast');
  assert.match(fxCss, /#ag-ps-quota-nudge\[data-leaving="1"\]/);
  assert.match(fxCss, /#ag-ps-return-bar\[data-leaving="1"\]/);
  assert.match(suiteCss, /#ag-ps-popover\[data-closing="1"\]/);
  assert.match(suiteCss, /#ag-ps-outline\[data-closing="1"\]/);
  assert.match(wfJs, /ArrowDown[\s\S]{0,400}ArrowUp/, 'Image context menu supports keyboard arrow navigation');

  // 4. 12-Mascot pixel character catalog, GPU keyframes, 5 easter eggs & cross-port mascotStyle sync
  const expectedSprites = ['crab', 'cat', 'slime', 'frog', 'chick', 'bunny', 'fox', 'shiba', 'penguin', 'owlet', 'axolotl', 'robot'];
  for (const sid of expectedSprites) {
    assert.match(suiteJs, new RegExp(`id:\\s*'${sid}'`), `SPRITE_CATALOG must include ${sid}`);
  }
  const svgMatches = suiteJs.match(/<svg class="ag-ps-sprite"[^>]*>/g) || [];
  assert.equal(svgMatches.length, 12, 'All 12 pixel sprites must be defined');
  for (const tag of svgMatches) {
    assert.match(tag, /viewBox="0 0 12 11"/);
    assert.match(tag, /shape-rendering="crispEdges"/);
  }
  assert.match(suiteCss, /@keyframes agPsSpinJump/);
  assert.match(suiteCss, /@keyframes agPsJelly/);
  assert.match(suiteCss, /@keyframes agPsDance/);
  assert.match(suiteJs, /actorSkinOverrides/);
  assert.match(suiteJs, /isLateNightHour/);
  assert.equal(sanitizePrismUiPrefs({ mascotStyle: 'zoo' }).mascotStyle, 'zoo');
  assert.equal(sanitizePrismUiPrefs({ mascotStyle: 'cyber' }).mascotStyle, 'cyber');
  assert.equal(sanitizePrismUiPrefs({ mascotStyle: 'penguin' }).mascotStyle, 'penguin');
  assert.equal(sanitizePrismUiPrefs({ mascotStyle: 'fox' }).mascotStyle, 'fox');

  // 5. Multi-page & multi-viewport adaptation in app.html + inline.html
  assert.match(appHtml, /is-split-wide/, 'app.html supports >=820px side-by-side split layout');
  assert.match(appHtml, /function isFileTab\(/, 'app.html scopes preview drawer to file tabs so other pages get 100% viewport');
  assert.match(appHtml, /data-overflow-left/);
  assert.match(appHtml, /data-overflow-right/);
  assert.match(appHtml, /data-img-mode="1:1"/, 'Image preview supports 1:1 native pixel mode');
  assert.match(appHtml, /data-img-action="pixel"/, 'Image preview supports pixelated crisp toggle');
  assert.match(appHtml, /models-filter-bar/, 'Model Hub includes zero-latency filter bar');
  assert.match(appHtml, /data-mhub-action="copy-id"/, 'Model Hub supports 1-click model ID copy');
  assert.match(appHtml, /list-group-head/, 'Artifacts tab groups items by relative date');
  assert.match(inlineHtml, /data-action="copy-path"/, 'inline.html file card includes copy-path quick action');
  assert.match(inlineHtml, /flashButtonFeedback/);

  // 6. Strict 0fps idle & 0ms typing performance certification gates
  for (const [label, css] of [
    ['prism-suite.css', suiteCss],
    ['prism-suite-fx.css', fxCss],
    ['prism-suite-workflow.css', wfCss],
    ['app.html', appHtml],
    ['inline.html', inlineHtml]
  ]) {
    assert.doesNotMatch(css, /transition\s*:\s*all\b/i, `${label} must never use transition: all`);
    assert.match(css, /prefers-reduced-motion:\s*reduce/, `${label} must honor prefers-reduced-motion`);
  }
  for (const [label, src] of [
    ['prism-suite-fx.js', fxJs],
    ['prism-suite-workflow.js', wfJs],
    ['app.html', appHtml],
    ['inline.html', inlineHtml]
  ]) {
    assert.doesNotMatch(src, /new\s+MutationObserver\b/, `${label} must maintain zero MutationObservers`);
  }
  assert.doesNotMatch(suiteJs, /\.observe\(\s*document\.(?:body|documentElement)\b/, 'prism-suite.js must never observe document.body or documentElement');
});

test('v0.7.0 Windows shortcut/label adaptation, outline rail persistence, workbench toggle-close, dual-track Model Hub discovery, dismissible guides, and wide desktop dashboard', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v070-ux-'));
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const daemonSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'daemon.mjs'), 'utf8');
    const customJsSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.js'), 'utf8');
    const customCssSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.css'), 'utf8');
    const i18nSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'i18n.json'), 'utf8');
    const suiteJsSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.js'), 'utf8');
    const fxJsSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');
    const accMgrSrc = fs.readFileSync(path.join(repoRoot, 'plugin', 'server', 'account-manager.mjs'), 'utf8');
    const relaunchSrc = fs.readFileSync(path.join(repoRoot, 'plugin', 'server', 'relaunch-client.mjs'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(repoRoot, 'plugin', 'server', 'index.mjs'), 'utf8');
    const appHtml = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'app.html'), 'utf8');

    // 1. Windows child_process windowsHide coverage across plugin server modules
    assert.match(accMgrSrc, /execFileSync\('git'[\s\S]{0,220}windowsHide:\s*true/);
    assert.match(relaunchSrc, /spawn\(bin,\s*args,\s*\{[\s\S]{0,220}windowsHide:\s*true/);
    const spawnDetachedSlice = indexSrc.slice(
      indexSrc.indexOf('function spawnDetachedSafe('),
      indexSrc.indexOf('/* ---------------- Cross-Session Transcript Search')
    );
    assert.match(spawnDetachedSlice, /windowsHide:\s*true/);
    const revealExplorerSlice = indexSrc.slice(
      indexSrc.indexOf('async function revealInExplorer('),
      indexSrc.indexOf('async function openWithTarget(') > 0 ? indexSrc.indexOf('async function openWithTarget(') : indexSrc.indexOf('async function revealInExplorer(') + 3200
    );
    assert.match(revealExplorerSlice, /execFileAsync\('explorer\.exe'[\s\S]{0,200}windowsHide:\s*true/);

    // 2. Renderer-first HOST_OS detection & Windows shortcuts/labels (Ctrl+/, Alt+点击, 资源管理器 ↗, Microsoft YaHei UI)
    assert.match(customJsSrc, /navigator\.userAgentData\?\.platform/, 'HOST_OS must prioritize renderer platform over WSL daemon ctx.platform');
    assert.match(customJsSrc, /MOD_SLASH_LABEL\s*=\s*IS_MAC\s*\?\s*'⌘\/'\s*:\s*'Ctrl\+\/'/);
    assert.match(customJsSrc, /function adaptPlatformUiText\(/);
    assert.match(customJsSrc, /OS_FILE_MGR_SHORT_ZH\s*=\s*IS_WIN\s*\?\s*'资源管理器'/);
    assert.match(customJsSrc, /OS_FILE_MGR_SHORT_ZH\}\s*↗/);
    assert.match(customJsSrc, /在资源管理器中显示/);
    assert.match(customJsSrc, /e\.code === 'Slash'/, 'Ctrl+/ shortcut must support non-ASCII IME via e.code === Slash');
    assert.match(customCssSrc, /local\('Microsoft YaHei UI'\)/, 'Chinese font-size calibration must support Microsoft YaHei UI on Windows');
    assert.match(i18nSrc, /Cancel \(Ctrl\+D\)/);

    // 3. Outline rail default-on, virtualized scroll fallback, and daemon savePrismUiPrefs whitelist RPC
    assert.match(fxJsSrc, /alwaysOutlineRail:\s*true/, 'Outline rail should default to visible across account switches');
    assert.match(fxJsSrc, /轮次圆点目录（右侧常驻）/);
    assert.match(fxJsSrc, /data-testid="user-input-step"/);
    assert.match(suiteJsSrc, /__agProjectCall\('savePrismUiPrefs'/);
    assert.match(daemonSrc, /action === 'savePrismUiPrefs'/);
    assert.match(daemonSrc, /rawTs > nowMs \+ 60000 \? nowMs : Math\.round\(rawTs\)/);
    assert.match(daemonSrc, /prevClean\._tsOrigin === 'explicit' && cleanIncoming\._tsOrigin !== 'explicit'/);

    // 4. Sidebar & toolbar Prism Workbench bidirectional toggle-close / return to conversation
    assert.match(suiteJsSrc, /function isFullPageWorkbenchActive\(/);
    assert.match(suiteJsSrc, /function toggleOrClosePrismWorkbench\(/);
    assert.match(suiteJsSrc, /function onSidebarWorkbenchToggleCapture\(/);
    assert.match(suiteJsSrc, /data\.type === 'close-workbench'/);
    assert.match(appHtml, /id="btn-close-workbench"/);
    assert.match(appHtml, /type:\s*'close-workbench'/);

    // 5. Origin credential rebind protection, /v1/models auto-discovery & idempotent batch import
    const fakeSecretMap = new Map();
    const profMgr = createPrismProfileManager({
      profilePath: path.join(tmp, 'prof', 'prism-profile.json'),
      secretStore: {
        getSecret: (id) => fakeSecretMap.get(id) || '',
        setSecret: (id, val) => { fakeSecretMap.set(id, val); },
        deleteSecret: (id) => fakeSecretMap.delete(id)
      }
    });
    profMgr.upsertProvider({
      id: 'my-gw',
      label: 'Trusted GW',
      protocol: 'openai-chat',
      baseUrl: 'https://trusted.example.com/v1',
      apiKey: 'sk-secret-vault-123456'
    });
    assert.throws(
      () => profMgr.upsertProvider({ id: 'my-gw', baseUrl: 'https://other-host.example.com/v1' }),
      (err) => err.code === 'ORIGIN_REBIND_REQUIRES_KEY',
      'Changing provider origin while a vault key is stored must require explicit key re-entry or clearVaultKey'
    );
    const pubProf = profMgr.getPublicProfile();
    assert.ok(pubProf.profilePath.endsWith('prism-profile.json'));

    const batchRes = profMgr.batchImportModels({
      providerId: 'my-gw',
      items: [
        { id: 'claude-sonnet-5-5-high', tier: 'T2', vendor: 'anthropic', favorite: true },
        { id: 'gpt-6.2-astra', tier: 'T1', vendor: 'openai', favorite: true }
      ]
    });
    assert.equal(batchRes.added, 2);
    assert.equal(batchRes.importedIds.length, 2);
    const batchDup = profMgr.batchImportModels({
      providerId: 'my-gw',
      items: [{ id: 'gpt-6.2-astra', tier: 'T4', vendor: 'other' }]
    });
    assert.equal(batchDup.added, 0);
    assert.equal(batchDup.skipped, 1);
    assert.equal(profMgr.getPublicProfile().models.find((m) => m.id === 'gpt-6.2-astra').tier, 'T1', 'Idempotent batch import must preserve existing model tier');

    const hub = createModelHub({
      profileManager: profMgr,
      fetchImpl: async (url) => {
        assert.equal(url, 'https://trusted.example.com/v1/models');
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({
            data: [
              { id: 'gpt-6.2-astra' },
              { id: 'claude-opus-5-5-high' },
              { id: 'deepseek-v4.1-flash' },
              { id: 'text-embedding-3-large' }
            ]
          })
        };
      }
    });
    const disc = await hub.discoverProviderModels('my-gw');
    assert.equal(disc.ok, true);
    assert.equal(disc.total, 4);
    assert.equal(disc.chatCount, 3);
    const embItem = disc.models.find((x) => x.suggestedId === 'text-embedding-3-large');
    assert.equal(embItem.isChat, false);
    const opusItem = disc.models.find((x) => x.suggestedId === 'claude-opus-5-5-high');
    assert.equal(opusItem.vendor, 'anthropic');
    assert.equal(opusItem.tier, 'T1');
    assert.equal(opusItem.alreadyAdded, false);
    const astraItem = disc.models.find((x) => x.suggestedId === 'gpt-6.2-astra');
    assert.equal(astraItem.alreadyAdded, true);

    // 6. Server-persisted dismissedGuides & wide desktop dashboard layout markers
    const srv = createPrismFilesServer({ dataDir: path.join(tmp, 'srv'), defaultRoot: tmp, profileManager: profMgr, modelHub: hub });
    const updGuides = await srv.handleToolCall('update_state', {
      dismissedGuides: ['guide:models:v1', 'guide:accounts-steps:v1', 'invalid spaces!!']
    });
    assert.deepEqual(updGuides.structuredContent.state.dismissedGuides, ['guide:models:v1', 'guide:accounts-steps:v1']);
    const openSc = await srv.handleToolCall('open_prism_files', {});
    assert.deepEqual(openSc.structuredContent.state.dismissedGuides, ['guide:models:v1', 'guide:accounts-steps:v1']);

    const srvDisc = await srv.handleToolCall('model_hub_discover_models', { providerId: 'my-gw' });
    assert.equal(srvDisc.structuredContent.ok, true);
    assert.equal(srvDisc.structuredContent.total, 4);

    assert.match(appHtml, /\.accounts-dashboard/);
    assert.match(appHtml, /\.mhub-tier-cards/);
    assert.match(appHtml, /\.mhub-discover-list/);
    assert.match(appHtml, /id="btn-guide-toggle"/);
    assert.match(appHtml, /id="btn-mhub-discover"/);
    assert.match(appHtml, /id="btn-mhub-ai-setup"/);
    assert.match(appHtml, /shouldShowRightInspectorPane/);
    assert.match(appHtml, /applyServerDismissedGuides/);
    assert.match(appHtml, /discoverSeq/);
    assert.match(appHtml, /userClosedInWideByTab/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.8.0 prism-cua end-to-end broker/MCP roundtrip, batch_actions, safety/CAPTCHA/Esc guards, MV3 bridge, dual-plugin installer, and zero-blank restore', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v080-cua-'));
  let broker = null;
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { createCuaBroker, CUA_EXTENSION_ID } = await import(
      pathToFileURL(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'cua-broker.mjs')).href
    );
    const { createPrismCuaServer, TOOLS: CUA_TOOLS } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin-cua', 'server', 'index.mjs')).href
    );

    // 1. Strict 3-tool model visibility & default-disabled plugin manifest
    const cuaPluginJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugin-cua', 'plugin.json'), 'utf8'));
    const expectedVer = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.equal(cuaPluginJson.name, 'prism-cua');
    assert.equal(cuaPluginJson.version, expectedVer);
    assert.equal(cuaPluginJson.disabled, true, 'prism-cua must ship disabled by default');
    assert.deepEqual(CUA_TOOLS.map((t) => t.name), ['cua_status', 'cua_observe', 'cua_act']);

    // 2. Deterministic Chrome MV3 SPKI public key -> exact 32-char Extension ID check
    const mv3Manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'extensions', 'chrome-cua-bridge', 'manifest.json'), 'utf8')
    );
    const spkiDer = Buffer.from(mv3Manifest.key, 'base64');
    const shaHex = crypto.createHash('sha256').update(spkiDer).digest('hex').slice(0, 32);
    const derivedExtId = [...shaHex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    assert.equal(derivedExtId, CUA_EXTENSION_ID);
    assert.equal(derivedExtId, 'lbmibnghmlnidfiihkegicaejaacmkca');

    // 3. Minimize-to-restore zero-blank-screen static invariants
    const suiteJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.js'), 'utf8');
    const fxJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');
    const fxCss = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.css'), 'utf8');
    const daemonSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'daemon.mjs'), 'utf8');
    assert.match(suiteJs, /restoreWakeRaf2\s*=\s*requestAnimationFrame/);
    assert.match(fxJs, /fxRestoreRaf2\s*=\s*requestAnimationFrame/);
    assert.match(daemonSrc, /__agSyncHostVisibility/);
    assert.match(daemonSrc, /setFastWindowRestoreShortcut/);
    const railSlice = fxCss.slice(fxCss.indexOf('#ag-ps-outline-rail {'), fxCss.indexOf('#ag-ps-rail-tip {'));
    assert.doesNotMatch(railSlice, /backdrop-filter/, 'Persistent outline rail must avoid offscreen backdrop-filter');

    // 4. Dual-plugin installAll / uninstallAll roundtrip
    const userDir = path.join(tmp, 'user');
    const pluginsDir = path.join(tmp, 'plugins');
    fs.mkdirSync(path.join(pluginsDir, 'sibling-keep'), { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, 'sibling-keep', 'plugin.json'), '{"name":"sibling-keep"}\n');
    const instRes = installAll({ userDir, pluginsDir, skipKernel: true });
    assert.ok(fs.existsSync(path.join(pluginsDir, 'prism-files', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(pluginsDir, 'prism-cua', 'plugin.json')));
    assert.ok(instRes.plugin?.cuaTargetDir, 'installAll must deploy prism-cua');
    uninstallAll({ userDir, pluginsDir, removeKernel: false });
    assert.ok(!fs.existsSync(path.join(pluginsDir, 'prism-files')));
    assert.ok(!fs.existsSync(path.join(pluginsDir, 'prism-cua')));
    assert.ok(fs.existsSync(path.join(pluginsDir, 'sibling-keep', 'plugin.json')), 'Sibling plugins must remain intact');

    // 5. Live HTTP CUA Broker <-> prism-cua MCP Server E2E roundtrip (Consent, Batch, Idempotency, Esc, CAPTCHA, MV3 NM)
    let savedValue = '';
    let simulateEscOnNextAct = false;
    let simulateCaptchaOnNextObserve = false;
    let actCalls = 0;

    const prismSuiteDir = path.join(tmp, 'prism-suite');
    const wslGeminiDir = path.join(tmp, 'wsl-gemini');
    fs.mkdirSync(wslGeminiDir, { recursive: true });

    broker = createCuaBroker({
      allowNonWin32ForTest: true,
      homeDir: tmp,
      prismSuiteDir,
      wslAdapterIp: null,
      discoverWslGeminiDirs: () => [wslGeminiDir],
      mockWorkerRunner: async ({ cmd, stdin }) => {
        if (cmd === 'list-windows') {
          return {
            ok: true,
            windows: [
              { hwnd: '0x002004A0', title: '记事本 - 测试文档', processName: 'notepad.exe', className: 'Notepad', isElectron: false, isElevated: false },
              { hwnd: '0x00200999', title: 'C:\\Users\\Admin\\.codex\\auth.json', processName: 'notepad.exe', className: 'Notepad', isElectron: false, isElevated: false }
            ]
          };
        }
        if (cmd === 'consent') {
          return {
            ok: true,
            granted: true,
            state: stdin?.needAct ? 'ARMED_INTERACTIVE' : 'ARMED_READONLY',
            durationMinutes: 15,
            scope: { type: 'desktop_safe' }
          };
        }
        if (cmd === 'observe') {
          if (simulateCaptchaOnNextObserve) {
            return {
              ok: true,
              window: { hwnd: stdin.hwnd, title: '安全检查 - Cloudflare Turnstile', processName: 'chrome.exe' },
              elements: [{ ref: '@w1', role: 'checkbox', name: 'Verify you are human' }]
            };
          }
          return {
            ok: true,
            window: { hwnd: stdin.hwnd, title: '记事本 - 测试文档', processName: 'notepad.exe' },
            elements: [
              { ref: '@w1', role: 'edit', name: '正文编辑区', value: savedValue, bounds: { x: 100, y: 120, width: 300, height: 200 } },
              { ref: '@w2', role: 'edit', name: '口令输入', isPassword: true, value: 'super-secret', bounds: { x: 100, y: 340, width: 200, height: 28 } },
              { ref: '@w3', role: 'button', name: '保存', bounds: { x: 160, y: 390, width: 80, height: 30 } }
            ],
            screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            mimeType: 'image/png'
          };
        }
        if (cmd === 'act') {
          if (simulateEscOnNextAct) {
            return { ok: false, code: 'USER_ESC_ABORTED', error: '用户按下 Esc 紧急中断' };
          }
          actCalls += 1;
          if (stdin?.step?.op === 'type_text') {
            savedValue = stdin.step.text;
          }
          return { ok: true, executed: stdin?.step?.op };
        }
        if (cmd === 'release-modifiers') {
          return { ok: true };
        }
        return { ok: true };
      }
    });

    const started = await broker.start();
    assert.ok(started.endpoints.length >= 1);
    const wslBrokerPath = path.join(wslGeminiDir, 'antigravity', 'prism-suite', 'cua-broker.json');
    assert.ok(fs.existsSync(wslBrokerPath), 'Broker must sync cua-broker.json to WSL gemini dir');

    const cuaServer = createPrismCuaServer({
      brokerFilePath: wslBrokerPath,
      minPacingMs: 0
    });

    // 5a. Status auto-enumerates windows & hides/flags protected .codex window
    const stRes = await cuaServer.handleToolCall('cua_status', { includeWindows: true });
    assert.equal(stRes.structuredContent.ok, true);
    assert.equal(stRes.structuredContent.state, 'DISARMED');
    assert.equal(stRes.structuredContent.windows.some((w) => w.blocked === true), true, 'Sensitive .codex window must be marked blocked');

    // 5b. Observe auto-triggers readonly consent, resolves titleContains, redacts password, & attaches image
    const obsRes = await cuaServer.handleToolCall('cua_observe', {
      target: 'desktop',
      titleContains: '测试文档',
      includeScreenshot: true
    });
    assert.equal(obsRes.structuredContent.ok, true);
    assert.equal(broker.state, 'ARMED_READONLY');
    assert.match(obsRes.content[0].text, /\[UNTRUSTED_CUA_OBSERVATION id=[0-9a-f]{16} source=cua tainted=true\]/);
    assert.doesNotMatch(obsRes.content[0].text, /super-secret/, 'Password value must never leak');
    assert.equal(obsRes.content[1].type, 'image');

    // 5c. Blocking password field action before touching OS
    const pwdAct = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x002004A0',
      actions: [{ op: 'type_text', ref: '@w2', text: 'attempt' }]
    });
    assert.equal(pwdAct.isError, true);
    assert.equal(pwdAct.structuredContent.code, 'PASSWORD_FIELD_BLOCKED');

    // 5d. Declarative batch_actions upgrades to ARMED_INTERACTIVE, verifies expectBefore/expectAfter, computes diff & caches idempotencyKey
    const batchRes = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x002004A0',
      idempotencyKey: 'idem-save-1',
      actions: [
        { op: 'click', ref: '@w1', expectBefore: { titleContains: '记事本', refExists: '@w1' } },
        { op: 'type_text', ref: '@w1', text: 'Hello Prism CUA', expectAfter: { textContains: 'Hello Prism CUA' } },
        { op: 'click', ref: '@w3' }
      ]
    });
    assert.equal(batchRes.structuredContent.ok, true);
    assert.equal(broker.state, 'ARMED_INTERACTIVE');
    assert.equal(actCalls, 3);
    assert.match(batchRes.content[0].text, /Hello Prism CUA/);

    const batchDup = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x002004A0',
      idempotencyKey: 'idem-save-1',
      actions: [
        { op: 'click', ref: '@w1', expectBefore: { titleContains: '记事本', refExists: '@w1' } },
        { op: 'type_text', ref: '@w1', text: 'Hello Prism CUA', expectAfter: { textContains: 'Hello Prism CUA' } },
        { op: 'click', ref: '@w3' }
      ]
    });
    assert.equal(batchDup.structuredContent.idempotencyHit, true);
    assert.equal(actCalls, 3, 'Duplicate idempotencyKey must not re-execute actions');

    const batchConflict = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x002004A0',
      idempotencyKey: 'idem-save-1',
      actions: [{ op: 'click', ref: '@w3' }]
    });
    assert.equal(batchConflict.isError, true);
    assert.equal(batchConflict.structuredContent.code, 'IDEMPOTENCY_CONFLICT', 'Reusing idempotencyKey with mutated actions must reject');

    // 5e. Codex-style single-key Esc emergency interrupt disarms Broker & short-circuits batch
    simulateEscOnNextAct = true;
    const escRes = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x002004A0',
      actions: [
        { op: 'click', ref: '@w1' },
        { op: 'type_text', ref: '@w1', text: 'should-not-run' }
      ]
    });
    assert.equal(escRes.isError, true);
    assert.equal(escRes.structuredContent.code, 'USER_ESC_ABORTED');
    assert.equal(broker.state, 'DISARMED', 'Esc interrupt must disarm session immediately');
    simulateEscOnNextAct = false;

    // 5f. CAPTCHA challenge detection pauses Broker into PAUSED_HANDOFF
    simulateCaptchaOnNextObserve = true;
    const capRes = await cuaServer.handleToolCall('cua_observe', {
      target: 'desktop',
      hwnd: '0x002004A0'
    });
    assert.equal(capRes.isError, true);
    assert.equal(capRes.structuredContent.code, 'CAPTCHA_DETECTED');
    assert.equal(broker.state, 'PAUSED_HANDOFF');
    assert.match(capRes.content[0].text, /\[HANDOFF REQUIRED: CAPTCHA_DETECTED\]/);
  } finally {
    if (broker) await broker.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('v0.8.1 visual virtual cursor overlay, 4-tier non-intrusive mouse routing (courteous vs strict_virtual), PHYSICAL_CURSOR_REQUIRED guard, and workbench mouseMode toggle', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v081-vcursor-'));
  let broker = null;
  const prevBrokerEnv = process.env.PRISM_CUA_BROKER_FILE;
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const winCuaCs = fs.readFileSync(path.join(repoRoot, 'native', 'win-cua', 'PrismWinCua.cs'), 'utf8');
    const contentAgentJs = fs.readFileSync(path.join(repoRoot, 'extensions', 'chrome-cua-bridge', 'content-agent.js'), 'utf8');
    const appHtml = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'app.html'), 'utf8');

    // 1. Static invariants for Win32 per-pixel click-through VirtualCursorForm & 4-tier routing
    assert.match(winCuaCs, /class VirtualCursorForm : Form/);
    assert.match(winCuaCs, /WS_EX_LAYERED[\s\S]{0,160}WS_EX_TRANSPARENT[\s\S]{0,160}WS_EX_NOACTIVATE/);
    assert.match(winCuaCs, /UpdateLayeredWindow\(/);
    assert.match(winCuaCs, /TryInvokeUiaClickMta\(/);
    assert.match(winCuaCs, /TrySetTextUiaOrWin32Mta\(/);
    assert.match(winCuaCs, /TryPostWin32MouseClick\(/);
    assert.match(winCuaCs, /WaitForUserInputIdle\(350,/);
    assert.match(winCuaCs, /PHYSICAL_CURSOR_REQUIRED/);
    assert.match(winCuaCs, /NativeMethods\.SetCursorPos\(origCursor\.X,\s*origCursor\.Y\)/);

    // 2. Browser Shadow DOM virtual cursor & Workbench toggle UI invariants
    const expectedAgentVer = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.ok(contentAgentJs.includes(`AGENT_VERSION = '${expectedAgentVer}'`));
    assert.match(contentAgentJs, /function pulseVirtualCursor\(/);
    assert.match(contentAgentJs, /__prism_cua_vcursor_host/);
    assert.match(contentAgentJs, /delivery:\s*'dom_virtual'/);
    assert.match(appHtml, /data-cua-action="set-mouse-mode"/);
    assert.match(appHtml, /cua_bridge_set_mouse_mode/);

    // 3. Live Broker + prism-cua + prism-files mouseMode roundtrip & VIRTUAL_CURSOR pulse check
    const { createCuaBroker } = await import(
      pathToFileURL(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'cua-broker.mjs')).href
    );
    const { createPrismCuaServer } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin-cua', 'server', 'index.mjs')).href
    );

    const prismSuiteDir = path.join(tmp, '.gemini', 'antigravity', 'prism-suite');
    const seenMouseModes = [];

    broker = createCuaBroker({
      allowNonWin32ForTest: true,
      homeDir: tmp,
      prismSuiteDir,
      wslAdapterIp: null,
      discoverWslGeminiDirs: () => [],
      mockWorkerRunner: async ({ cmd, stdin }) => {
        if (cmd === 'list-windows') {
          return {
            ok: true,
            windows: [
              { hwnd: '0x00300100', title: 'WinForms Counter Demo', processName: 'demo.exe', className: 'WindowsForms10.Window.8', isElectron: false, isElevated: false },
              { hwnd: '0x00300200', title: 'Custom Canvas App', processName: 'canvas.exe', className: 'Chrome_WidgetWin_1', isElectron: true, isElevated: false }
            ]
          };
        }
        if (cmd === 'consent') {
          return {
            ok: true,
            granted: true,
            state: 'ARMED_INTERACTIVE',
            durationMinutes: 15,
            scope: { type: 'desktop_safe' }
          };
        }
        if (cmd === 'observe') {
          const isCanvas = String(stdin?.hwnd).includes('300200');
          return {
            ok: true,
            window: isCanvas
              ? { hwnd: '0x00300200', title: 'Custom Canvas App', processName: 'canvas.exe' }
              : { hwnd: '0x00300100', title: 'WinForms Counter Demo', processName: 'demo.exe' },
            elements: isCanvas
              ? []
              : [{ ref: '@w1', role: 'button', name: '计数+1', bounds: { x: 220, y: 180, width: 90, height: 32 } }]
          };
        }
        if (cmd === 'act') {
          seenMouseModes.push(stdin?.mouseMode);
          const isCanvas = String(stdin?.hwnd).includes('300200');
          if (isCanvas) {
            if (stdin?.mouseMode === 'strict_virtual') {
              return {
                ok: false,
                code: 'PHYSICAL_CURSOR_REQUIRED',
                error: '严格后台虚拟鼠标模式已拦截物理光标移动'
              };
            }
            return {
              ok: true,
              op: stdin?.step?.op,
              x: 320,
              y: 240,
              delivery: 'courteous_physical_restore',
              physicalCursorMoved: true,
              cursorRestored: true
            };
          }
          return {
            ok: true,
            op: stdin?.step?.op,
            x: 265,
            y: 196,
            ref: '@w1',
            delivery: 'uia_invoke',
            physicalCursorMoved: false,
            focusStolen: false
          };
        }
        return { ok: true };
      }
    });

    await broker.start();
    const brokerJsonPath = path.join(prismSuiteDir, 'cua-broker.json');
    process.env.PRISM_CUA_BROKER_FILE = brokerJsonPath;

    const cuaServer = createPrismCuaServer({ brokerFilePath: brokerJsonPath, minPacingMs: 0 });
    const filesServer = createPrismFilesServer({
      homeDir: tmp,
      dataDir: path.join(tmp, 'files-data'),
      defaultRoot: tmp
    });

    const stInitial = await filesServer.handleToolCall('cua_bridge_status', {});
    assert.equal(stInitial.structuredContent.brokerOnline, true);
    assert.equal(stInitial.structuredContent.mouseMode, 'courteous');

    // Tier L2 UIA click: zero physical cursor movement + emits VIRTUAL_CURSOR pulse to overlay
    const uiaAct = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x00300100',
      actions: [{ op: 'click', ref: '@w1' }]
    });
    assert.equal(uiaAct.structuredContent.ok, true);
    assert.equal(uiaAct.structuredContent.stepResults[0].delivery, 'uia_invoke');
    assert.equal(uiaAct.structuredContent.stepResults[0].physicalCursorMoved, false);
    assert.ok(
      broker.mockOverlayHistory.some((e) => e.state === 'VIRTUAL_CURSOR' && e.x === 265 && e.y === 196),
      'Broker must dispatch VIRTUAL_CURSOR pulse coordinates to overlay'
    );

    // Switch to strict_virtual via Workbench App-only tool -> persists & blocks L4 custom canvas click
    const setStrict = await filesServer.handleToolCall('cua_bridge_set_mouse_mode', {
      mouseMode: 'strict_virtual'
    });
    assert.equal(setStrict.structuredContent.ok, true);
    assert.equal(setStrict.structuredContent.mouseMode, 'strict_virtual');
    assert.ok(fs.existsSync(path.join(prismSuiteDir, 'cua-settings.json')));

    const stStrict = await filesServer.handleToolCall('cua_bridge_status', {});
    assert.equal(stStrict.structuredContent.mouseMode, 'strict_virtual');

    const blockedCanvasAct = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x00300200',
      actions: [{ op: 'click', x: 320, y: 240 }]
    });
    assert.equal(blockedCanvasAct.isError, true);
    assert.equal(blockedCanvasAct.structuredContent.code, 'PHYSICAL_CURSOR_REQUIRED');

    // [A-06] Model-supplied mouseMode: 'courteous' or 'physical' MUST NOT escalate out of user's strict_virtual preference!
    const escalateAttempt = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x00300200',
      mouseMode: 'courteous',
      actions: [{ op: 'click', x: 320, y: 240, mouseMode: 'physical' }]
    });
    assert.equal(escalateAttempt.isError, true, 'Model must never bypass strict_virtual via cua_act parameters');
    assert.equal(escalateAttempt.structuredContent.code, 'PHYSICAL_CURSOR_REQUIRED');

    // Only when user explicitly switches global mouseMode back to courteous via Workbench does L4 courteous click proceed
    await filesServer.handleToolCall('cua_bridge_set_mouse_mode', {
      mouseMode: 'courteous'
    });
    const courteousCanvasAct = await cuaServer.handleToolCall('cua_act', {
      target: 'desktop',
      hwnd: '0x00300200',
      actions: [{ op: 'click', x: 320, y: 240 }]
    });
    assert.equal(courteousCanvasAct.structuredContent.ok, true);
    assert.equal(courteousCanvasAct.structuredContent.stepResults[0].delivery, 'courteous_physical_restore');
    assert.deepEqual(seenMouseModes, ['courteous', 'strict_virtual', 'strict_virtual', 'courteous']);
    await filesServer.handleToolCall('cua_bridge_set_mouse_mode', {
      mouseMode: 'strict_virtual'
    });

    // 4. Issue #1 (--no-plugin, --no-file-card-rule, --no-skills, showWorkbenchBtn, granular MCP exposure) & sidebar @dnd-kit drag safety
    const suiteJsSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.js'), 'utf8');
    assert.match(suiteJsSrc, /showWorkbenchBtn:\s*true/);
    assert.match(suiteJsSrc, /function safeClickElement\(/);
    assert.match(suiteJsSrc, /function triggerRadixMenuOpen\(/);
    assert.doesNotMatch(suiteJsSrc, /function triggerRadixTrigger\(/, 'Legacy unpaired pointerdown triggerRadixTrigger must be removed');
    assert.match(suiteJsSrc, /if \(getActiveViewportEl\(\)\) return false;/, 'isFullPageWorkbenchActive must ignore hidden cached viewports');

    const noPlugUser = path.join(tmp, 'noplug-user');
    const noPlugPlugins = path.join(tmp, 'noplug-plugins');
    const noPlugRes = installAll({ argv: ['--no-plugin', '--no-kernel-daemon'], userDir: noPlugUser, pluginsDir: noPlugPlugins });
    assert.ok(noPlugRes.kernel?.installed?.length > 0, '--no-plugin must still deploy bundled Anti-Claude kernel');
    assert.ok(noPlugRes.extensions?.installed?.length === 6, '--no-plugin must deploy Prism UI extensions');
    assert.equal(noPlugRes.plugin, null, '--no-plugin must skip prism-files and prism-cua plugins');
    assert.ok(!fs.existsSync(path.join(noPlugPlugins, 'prism-files')));

    const slimPlugins = path.join(tmp, 'slim-plugins');
    installAll({
      argv: ['--no-file-card-rule', '--no-skills'],
      userDir: path.join(tmp, 'slim-user'),
      pluginsDir: slimPlugins,
      skipKernel: true
    });
    assert.ok(fs.existsSync(path.join(slimPlugins, 'prism-files', 'plugin.json')));
    assert.ok(!fs.existsSync(path.join(slimPlugins, 'prism-files', 'rules', 'AGENTS.md')), '--no-file-card-rule must omit rules/AGENTS.md');
    assert.ok(!fs.existsSync(path.join(slimPlugins, 'prism-files', 'skills')), '--no-skills must omit skills/');

    const rpcListDefault = await filesServer.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const modelVisibleDefault = rpcListDefault.result.tools.filter((t) => !t._meta?.ui?.visibility?.includes('app'));
    assert.equal(modelVisibleDefault.length, 8);

      await filesServer.handleToolCall('plugin_exposure_update', {
        fileTools: false,
        modelHubTools: false
      });
      const rpcListSlim = await filesServer.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const modelVisibleSlim = rpcListSlim.result.tools.filter((t) => !t._meta?.ui?.visibility?.includes('app'));
      assert.equal(modelVisibleSlim.length, 4, 'Disabling fileTools (2) + modelHubTools (2) must leave only 4 memory tools exposed to model');
      const blockedInline = await filesServer.handleToolCall('show_files_inline', { files: [path.join(repoRoot, 'package.json')] });
      assert.equal(blockedInline.isError, true, 'Disabled MCP tool group must also block direct tools/call execution');
      assert.equal(blockedInline.structuredContent.code, 'TOOL_GROUP_DISABLED');

      // 4b. CUA 1-click tools sleep switch (cua_bridge_set_tools_enabled) + preserve mouseMode + plugin-cua tools/list & tools/call enforcement
      const sleepRes = await filesServer.handleToolCall('cua_bridge_set_tools_enabled', { enabled: false });
      assert.equal(sleepRes.structuredContent.ok, true);
      assert.equal(sleepRes.structuredContent.toolsEnabled, false);
      const cuaListAsleep = await cuaServer.handleRpc({ jsonrpc: '2.0', id: 20, method: 'tools/list' });
      assert.equal(cuaListAsleep.result.tools.length, 0, 'When toolsEnabled=false, prism-cua must expose 0 tools for zero token cost');
      const cuaCallAsleep = await cuaServer.handleToolCall('cua_status', {});
      assert.equal(cuaCallAsleep.isError, true);
      assert.equal(cuaCallAsleep.structuredContent.code, 'CUA_TOOLS_DISABLED');

      const wakeRes = await filesServer.handleToolCall('cua_bridge_set_tools_enabled', { enabled: true });
      assert.equal(wakeRes.structuredContent.toolsEnabled, true);
      const cuaBridgeAfterWake = await filesServer.handleToolCall('cua_bridge_status', {});
      assert.equal(cuaBridgeAfterWake.structuredContent.mouseMode, 'strict_virtual', 'Toggling toolsEnabled must preserve saved mouseMode');
      assert.equal(cuaBridgeAfterWake.structuredContent.toolsEnabled, true);
      const cuaListAwake = await cuaServer.handleRpc({ jsonrpc: '2.0', id: 21, method: 'tools/list' });
      assert.equal(cuaListAwake.result.tools.length, 3, 'When toolsEnabled=true, prism-cua must expose all 3 CUA tools');

      // 4c. Static UI checks: collapsible radarList accordion + toggle-cua-tools + hardened onboarding text matcher
      const appHtmlSrc = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'app.html'), 'utf8');
      assert.match(appHtmlSrc, /data-sec="radarList"/, 'app.html must render independent collapsible radarList accordion');
      assert.match(appHtmlSrc, /data-acc-action="radar-collapse"/, 'app.html must include explicit collapse button for upstream radar list');
      assert.match(appHtmlSrc, /data-cua-action="toggle-cua-tools"/, 'app.html must render 1-click CUA tools sleep/wake switch');
      const fxSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');
      assert.match(fxSrc, /function isSafeOnboardingTextMatch\b/, 'prism-suite-fx.js must include hardened onboarding text matcher');
      assert.match(fxSrc, /由\[你您\]掌控/, 'prism-suite-fx.js must match both 由你掌控 and 由您掌控 i18n variants');

    // 5. Upstream Radar anti-rate-limit: in-memory gh auth token reuse + ETag / If-None-Match 304 quota-free cache
    const {
      resolveAmbientGitHubToken,
      resetUpstreamRadarRuntimeCachesForTest,
      checkUpstreams: checkUpstreamsWithEtag,
      checkPrismSelfUpdate: checkSelfUpdWithEtag
    } = await import(pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'upstream-radar.mjs')).href);

    resetUpstreamRadarRuntimeCachesForTest();
    let ghCalls = 0;
    const concurrentTokens = await Promise.all(
      Array.from({ length: 6 }, () =>
        resolveAmbientGitHubToken({
          explicitToken: '',
          env: {},
          ghExecFn: async () => {
            ghCalls += 1;
            await new Promise((r) => setTimeout(r, 15));
            return { stdout: 'mock_gh_cli_ram_token_123456\n' };
          }
        })
      )
    );
    assert.deepEqual(concurrentTokens, Array(6).fill('mock_gh_cli_ram_token_123456'));
    const cachedRepeatTok = await resolveAmbientGitHubToken({
      explicitToken: '',
      env: {},
      ghExecFn: async () => {
        ghCalls += 1;
        return { stdout: 'should_not_be_called_again\n' };
      }
    });
    assert.equal(cachedRepeatTok, 'mock_gh_cli_ram_token_123456');
    assert.equal(ghCalls, 1, 'gh auth token must be invoked at most once per process and reused in memory');

    resetUpstreamRadarRuntimeCachesForTest();
    let ghFailCalls = 0;
    const tokFallback = await resolveAmbientGitHubToken({
      explicitToken: '',
      env: {},
      ghExecFn: async () => {
        ghFailCalls += 1;
        throw new Error('gh not logged in');
      }
    });
    const tokFallbackSecond = await resolveAmbientGitHubToken({
      explicitToken: '',
      env: {},
      ghExecFn: async () => {
        ghFailCalls += 1;
        throw new Error('gh still not logged in');
      }
    });
    assert.equal(tokFallback, '', 'Failed gh auth token must silently fall back to empty anonymous mode');
    assert.equal(tokFallbackSecond, '');
    assert.equal(ghFailCalls, 1, 'Failed gh probe must also memoize empty token in RAM without re-spawning gh');

    resetUpstreamRadarRuntimeCachesForTest();
    const savedGhEnv = process.env.GITHUB_TOKEN;
    const savedGhTokEnv = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      const etagFile = path.join(tmp, 'etag', 'github-etag-cache.json');
      const seenHeaders = [];
      let fetchRound = 0;
      const mockGitHub304Fetch = async (_url, opts = {}) => {
        fetchRound += 1;
        seenHeaders.push({ ...(opts.headers || {}) });
        if (fetchRound === 1) {
          return {
            ok: true,
            status: 200,
            headers: {
              get: (h) => (String(h).toLowerCase() === 'etag' ? 'W/"etag-v081-rel"' : null)
            },
            json: async () => ({
              tag_name: 'v0.8.1',
              name: 'v0.8.1',
              published_at: '2026-11-27T05:00:00Z',
              body: '- Virtual cursor',
              assets: []
            })
          };
        }
        assert.equal(opts.headers['If-None-Match'], 'W/"etag-v081-rel"', 'Second request must send If-None-Match');
        return {
          ok: false,
          status: 304,
          headers: { get: () => null },
          json: async () => {
            throw new Error('304 response has empty body and must not call res.json()');
          }
        };
      };

      let prodGhCalls = 0;
      const prodGhExec = async () => {
        prodGhCalls += 1;
        return { stdout: 'mock_gh_cli_ram_token_999999\n' };
      };

      const r200 = await checkSelfUpdWithEtag({
        currentVersion: '0.8.0',
        fetchImpl: mockGitHub304Fetch,
        etagCacheFile: etagFile,
        ghExecFn: prodGhExec
      });
      assert.equal(r200.latestTag, 'v0.8.1');
      assert.equal(seenHeaders[0].Authorization, 'Bearer mock_gh_cli_ram_token_999999');
      const etagDiskRaw = fs.readFileSync(etagFile, 'utf8');
      assert.doesNotMatch(etagDiskRaw, /mock_gh_cli_ram_token_999999/, 'GitHub token must NEVER be persisted to disk');

      const r304 = await checkSelfUpdWithEtag({
        currentVersion: '0.8.0',
        fetchImpl: mockGitHub304Fetch,
        etagCacheFile: etagFile,
        ghExecFn: prodGhExec
      });
      assert.equal(r304.latestTag, 'v0.8.1', '304 Not Modified must seamlessly return ETag-cached release payload');
      assert.equal(fetchRound, 2);
      assert.equal(prodGhCalls, 1, 'Subsequent API checks must reuse RAM token without calling gh again');

      // Stale/revoked gh token (HTTP 401) must invalidate RAM cache and silently retry anonymously + slim /compare patch bloat
      resetUpstreamRadarRuntimeCachesForTest();
      const miniUpstreamCfg = path.join(tmp, 'mini-upstream.json');
      fs.writeFileSync(
        miniUpstreamCfg,
        JSON.stringify({
          upstreams: {
            demo: {
              repo: 'owner/demo',
              role: 'feature-reference',
              license: 'MIT',
              baselineTag: 'v1.0.0',
              baselineCommit: '1111111'
            }
          }
        }),
        'utf8'
      );
      const staleAuthHeaders = [];
      const staleEtagFile = path.join(tmp, 'etag', 'stale-etag-cache.json');
      fs.mkdirSync(path.dirname(staleEtagFile), { recursive: true });
      const cryptoMod = await import('node:crypto');
      const staleTokHash = cryptoMod.default.createHash('sha256').update('prism-etag-auth:stale_revoked_gh_token_abcdef123456').digest('hex').slice(0, 16);
      fs.writeFileSync(
        staleEtagFile,
        JSON.stringify({
          schema: 1,
          entries: {
            [`tok:${staleTokHash}|https://api.github.com/repos/owner/demo/releases?per_page=6`]: {
              etag: '"private-tok-etag"',
              data: [{ tag_name: 'v9.9.9-private' }],
              updatedAtMs: Date.now()
            }
          }
        }),
        'utf8'
      );
      const mock401FallbackFetch = async (u, opts = {}) => {
        staleAuthHeaders.push({
          url: u,
          auth: opts.headers?.Authorization || '',
          ifNoneMatch: opts.headers?.['If-None-Match'] || ''
        });
        if (opts.headers?.Authorization) {
          return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) };
        }
        assert.notEqual(opts.headers?.['If-None-Match'], '"private-tok-etag"', 'Anonymous 401 retry must NOT reuse authenticated ETag');
        if (u.includes('/releases?')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (h) => (String(h).toLowerCase() === 'etag' ? '"etag-rel"' : null) },
            json: async () => [{ tag_name: 'v1.1.0', name: 'v1.1.0', body: '- 新增极速缓存支持', html_url: 'https://github.com/owner/demo/releases/tag/v1.1.0' }]
          };
        }
        if (u.includes('/commits?')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (h) => (String(h).toLowerCase() === 'etag' ? '"etag-cmt"' : null) },
            json: async () => [{ sha: '2222222abcdef', commit: { message: 'feat: add etag cache', committer: { date: '2026-11-27T05:00:00Z' } } }]
          };
        }
        return {
          ok: true,
          status: 200,
          headers: { get: (h) => (String(h).toLowerCase() === 'etag' ? '"etag-cmp"' : null) },
          json: async () => ({
            status: 'ahead',
            ahead_by: 1,
            commits: [{ sha: '2222222abcdef', commit: { message: 'feat: add etag cache' } }],
            files: [{ filename: 'src/index.js', status: 'modified', patch: '@@ -1,1 +1,999 @@\n' + 'x'.repeat(20000) }]
          })
        };
      };

      const rep401 = await checkUpstreamsWithEtag({
        configPath: miniUpstreamCfg,
        fetchImpl: mock401FallbackFetch,
        cacheFile: '',
        etagCacheFile: staleEtagFile,
        force: true,
        ghExecFn: async () => ({ stdout: 'stale_revoked_gh_token_abcdef123456\n' })
      });
      assert.equal(rep401.summary.errors, 0, 'Stale gh token returning 401 must silently retry anonymously without failing');
      assert.equal(rep401.results[0].hasUpdate, true);
      assert.ok(staleAuthHeaders.some((h) => h.auth === ''), 'Must fall back to anonymous request after 401');
      const staleDiskRaw = fs.readFileSync(staleEtagFile, 'utf8');
      assert.doesNotMatch(staleDiskRaw, /stale_revoked_gh_token_abcdef123456/);
      assert.ok(!staleDiskRaw.includes('x'.repeat(200)), 'Compare patch diff bloat must be stripped from ETag disk cache');
    } finally {
      if (savedGhEnv !== undefined) process.env.GITHUB_TOKEN = savedGhEnv;
      if (savedGhTokEnv !== undefined) process.env.GH_TOKEN = savedGhTokEnv;
      resetUpstreamRadarRuntimeCachesForTest();
    }
  } finally {
    if (prevBrokerEnv === undefined) {
      delete process.env.PRISM_CUA_BROKER_FILE;
    } else {
      process.env.PRISM_CUA_BROKER_FILE = prevBrokerEnv;
    }
    if (broker) await broker.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Clean-Room TOP 6 hardening: IMDS guard (preserving Tailscale *.ts.net), redirect:error, bounded body, verified source tarball, git fsmonitor=false, and hidden CSS pause', async () => {
  const repoRoot = REPO;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-cleanroom-top6-'));
  try {
    // 1. IMDS metadata block while preserving Tailscale MagicDNS (*.ts.net), CGNAT, LAN & localhost
    const { validateHttpEndpointUrl, createPrismProfileManager } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'prism-profile.mjs')).href
    );
    for (const blockedUrl of [
      'http://169.254.169.254/latest/meta-data',
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      'http://100.100.100.200/latest/meta-data',
      'http://[::ffff:100.100.100.200]/latest/meta-data',
      'http://[64:ff9b::169.254.169.254]/latest/meta-data',
      'http://[fd00:ec2::254]/latest',
      'http://metadata.google.internal/computeMetadata/v1',
      'http://0.0.0.0:8080/v1'
    ]) {
      assert.throws(
        () => validateHttpEndpointUrl(blockedUrl),
        (err) => err.code === 'BLOCKED_METADATA_ENDPOINT',
        `Must block metadata/special endpoint: ${blockedUrl}`
      );
    }
    for (const allowedUrl of [
      'http://my-nas.tail12345.ts.net:11434/v1',
      'https://my-nas.tail12345.ts.net:8317/v1',
      'http://100.100.100.199:8317/v1',
      'http://[::ffff:100.100.100.199]:8317/v1',
      'http://192.168.1.20:11434/v1',
      'http://127.0.0.1:11434/v1',
      'http://[::1]:11434/v1'
    ]) {
      assert.ok(validateHttpEndpointUrl(allowedUrl).startsWith('http'), `Must preserve LAN/Tailscale endpoint: ${allowedUrl}`);
    }

    // 2. Outbound redirect:'error' & bounded JSON response protection in Model Hub
    const { createModelHub } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'model-hub.mjs')).href
    );
    const profPath = path.join(tmp, 'profile.json');
    const pm = createPrismProfileManager({
      profilePath: profPath,
      env: { MOCK_HUB_KEY: 'sk-mock-cleanroom-1234567890' }
    });
    pm.upsertProvider({
      id: 'lan-gw',
      protocol: 'openai-chat',
      baseUrl: 'http://my-nas.tail12345.ts.net:11434/v1',
      apiKeyEnv: 'MOCK_HUB_KEY'
    });
    pm.upsertModel({
      id: 'demo-m',
      providerId: 'lan-gw',
      upstreamModel: 'demo-m',
      tier: 'T2',
      vendor: 'openai'
    });

    let seenRedirectOpt = '';
    const hub = createModelHub({
      profileManager: pm,
      fetchFn: async (_url, init) => {
        seenRedirectOpt = init?.redirect || '';
        return {
          ok: true,
          status: 200,
          headers: {
            get: (k) => {
              const lk = String(k).toLowerCase();
              if (lk === 'content-type') return 'application/json';
              if (lk === 'content-length') return String(9 * 1024 * 1024);
              return null;
            }
          },
          text: async () => '{}'
        };
      }
    });
    await assert.rejects(
      () => hub.askModel({ model: 'demo-m', prompt: 'ping' }),
      (err) => err.code === 'RESPONSE_TOO_LARGE'
    );
    assert.equal(seenRedirectOpt, 'error', 'Model Hub outbound POST must enforce redirect: error');

    // 3. Verified Release Source Tarball (.tar.gz.sha256) in upstream-radar self-update
    const { checkPrismSelfUpdate, applyPrismSelfUpdate } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'upstream-radar.mjs')).href
    );
    const fakeTarBytes = Buffer.from('fake-tar-gz-bytes', 'utf8');
    const cryptoMod = await import('node:crypto');
    const validHash = cryptoMod.default.createHash('sha256').update(fakeTarBytes).digest('hex');
    const badShaText = `${'0'.repeat(64)}  Anti-Claude-Prism-Suite-Source.tar.gz\n`;

    const mockRelJson = {
      tag_name: 'v9.9.9',
      name: 'v9.9.9',
      html_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/tag/v9.9.9',
      published_at: '2026-11-27T09:00:00Z',
      body: '- Hardened release',
      assets: [
        {
          name: 'Anti-Claude-Prism-Suite-Source.tar.gz',
          size: fakeTarBytes.length,
          browser_download_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/download/v9.9.9/Anti-Claude-Prism-Suite-Source.tar.gz'
        },
        {
          name: 'Anti-Claude-Prism-Suite-Source.tar.gz.sha256',
          size: 98,
          browser_download_url: 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/download/v9.9.9/Anti-Claude-Prism-Suite-Source.tar.gz.sha256'
        }
      ]
    };

    const makeUpdaterFetch = (shaContent) => async (url) => {
      if (String(url).includes('/releases/latest')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => mockRelJson };
      }
      if (String(url).endsWith('.tar.gz.sha256')) {
        return { ok: true, status: 200, headers: { get: () => String(Buffer.byteLength(shaContent)) }, arrayBuffer: async () => Buffer.from(shaContent, 'utf8') };
      }
      if (String(url).endsWith('Anti-Claude-Prism-Suite-Source.tar.gz')) {
        return { ok: true, status: 200, headers: { get: () => String(fakeTarBytes.length) }, arrayBuffer: async () => fakeTarBytes };
      }
      return { ok: false, status: 404, headers: { get: () => null } };
    };

    const updInfo = await checkPrismSelfUpdate({ currentVersion: '0.9.0', fetchImpl: makeUpdaterFetch(`${validHash}  Anti-Claude-Prism-Suite-Source.tar.gz\n`), etagCacheFile: '' });
    assert.ok(updInfo.sourceTarAsset?.url.endsWith('Anti-Claude-Prism-Suite-Source.tar.gz'));
    assert.ok(updInfo.sourceSha256Asset?.url.endsWith('.tar.gz.sha256'));

    await assert.rejects(
      () => applyPrismSelfUpdate({
        currentVersion: '0.9.0',
        platform: 'darwin',
        isWsl: false,
        lockDir: path.join(tmp, 'lock1'),
        fetchImpl: makeUpdaterFetch(badShaText)
      }),
      (err) => err.code === 'SHA256_MISMATCH'
    );

    // Partial asset guard: sourceTarAsset present without companion .sha256 must NOT silently downgrade
    await assert.rejects(
      () => applyPrismSelfUpdate({
        currentVersion: '0.9.0',
        platform: 'darwin',
        isWsl: false,
        lockDir: path.join(tmp, 'lock2'),
        fetchImpl: async (url) => {
          if (String(url).includes('/releases/latest')) {
            return {
              ok: true,
              status: 200,
              headers: { get: () => null },
              json: async () => ({ ...mockRelJson, assets: [mockRelJson.assets[0]] })
            };
          }
          return { ok: false, status: 404, headers: { get: () => null } };
        }
      }),
      (err) => err.code === 'SHA256_MISSING'
    );

    // Binary .tar.gz header audit rejects symlink / traversal before invoking system tar
    const { auditTarGzBufferSafe } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'upstream-radar.mjs')).href
    );
    const zlibMod = await import('node:zlib');
    const badTarHdr = Buffer.alloc(1024, 0);
    badTarHdr.write('pkg/evil-link', 0, 'utf8');
    badTarHdr.write('00000000000\0', 124, 'ascii');
    badTarHdr[156] = '2'.charCodeAt(0); // USTAR symlink
    assert.throws(
      () => auditTarGzBufferSafe(zlibMod.default.gzipSync(badTarHdr)),
      (err) => err.code === 'UNSAFE_TAR_ENTRY'
    );

    // 4. Static checks: daemon -c core.fsmonitor=false, app.html textarea dataset.filePath reuse, hidden CSS pause, workflow @mention escaping
    const daemonSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'daemon.mjs'), 'utf8');
    assert.match(daemonSrc, /core\.fsmonitor=false/);
    const appSrc = fs.readFileSync(path.join(repoRoot, 'plugin', 'ui', 'app.html'), 'utf8');
    assert.match(appSrc, /existingTa\.dataset\.filePath === String\(data\.path \|\| ''\)/);
    const suiteCss = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite.css'), 'utf8');
    assert.match(suiteCss, /html\[data-ag-prism-hidden="1"\] #ag-ps-mascot-stage/);
    const watchYml = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'upstream-watch.yml'), 'utf8');
    assert.match(watchYml, /MAX_ISSUE_CHARS = 60000/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ThinkingOrb fx module clean init (no bare onCleanup crash) and left-sidebar GPU scroll isolation', async () => {
  const repoRoot = REPO;
  const fxSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const customJsSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.js'), 'utf8');
  const customCssSrc = fs.readFileSync(path.join(repoRoot, 'vendor', 'anti-claude', 'user', 'custom.css'), 'utf8');

  // 1. initFxModule must define local onCleanup + fxCleanups and drain them in dispose()
  const initFxSlice = fxSrc.slice(fxSrc.indexOf('function initFxModule(bus)'), fxSrc.indexOf('function getPrefs()'));
  assert.match(initFxSlice, /const fxCleanups = \[\];/);
  assert.match(initFxSlice, /function onCleanup\(fn\)/);
  const disposeSlice = fxSrc.slice(fxSrc.indexOf('function dispose()'), fxSrc.indexOf('window.__agPrismFxDispose = dispose;'));
  assert.match(disposeSlice, /while \(fxCleanups\.length\)/);

  // 2. Left sidebar wheel listener stays detached unless hideSidebarProjects is active, and virtual rows never trigger full-chat syncStepStream
  assert.match(customJsSrc, /function syncSidebarWheelListener\(\)/);
  assert.match(customJsSrc, /function scheduleSidebarVirtualRowSync\(\)/);
  assert.match(customJsSrc, /mt\.closest\('\[data-testid="conversation-list-sidebar"\]'\)/);
  assert.match(customCssSrc, /\[data-testid="conversation-list-sidebar"\]:not\(\[data-ag-sb-unified\] \*\)[\s\S]{0,120}contain:\s*layout style/);
  assert.match(customCssSrc, /\[data-testid="overlay-scrollbar-thumb"\][\s\S]{0,80}will-change:\s*transform/);
});

test('v0.9.0 mini-dom runtime execution, [MS-SHLLINK] binary codec, AV-hygiene gate, CUA sensitive/idempotency hardening, Model Hub idle timeout, and go-keyring-base64 vault', async () => {
  const vm = await import('node:vm');
  const repoRoot = REPO;

  // 1. Lightweight mini-dom VM execution of prism-suite.js + prism-suite-fx.js + prism-suite-workflow.js
  {
    const docListeners = new Map();
    const winListeners = new Map();
    const addMapListener = (map, type, fn, opts) => {
      if (!map.has(type)) map.set(type, new Set());
      const entry = { fn, opts };
      map.get(type).add(entry);
      if (opts && opts.signal && typeof opts.signal.addEventListener === 'function') {
        opts.signal.addEventListener('abort', () => map.get(type)?.delete(entry), { once: true });
      }
    };
    const remMapListener = (map, type, fn) => {
      const set = map.get(type);
      if (!set) return;
      for (const item of Array.from(set)) {
        if (item.fn === fn) set.delete(item);
      }
    };

    let attrWriteCount = 0;
    const allElements = [];

    class MiniStyle {
      constructor() { this._props = new Map(); }
      setProperty(k, v) { this._props.set(String(k), String(v)); }
      getPropertyValue(k) { return this._props.get(String(k)) || ''; }
      removeProperty(k) { this._props.delete(String(k)); }
    }

    class MiniClassList {
      constructor() { this._set = new Set(); }
      add(...names) { for (const n of names) if (n) this._set.add(n); }
      remove(...names) { for (const n of names) this._set.delete(n); }
      contains(n) { return this._set.has(n); }
      toggle(n, force) {
        const next = force !== undefined ? Boolean(force) : !this._set.has(n);
        if (next) this._set.add(n); else this._set.delete(n);
        return next;
      }
    }

    const matchesSimpleSel = (el, sel) => {
      const parts = String(sel || '').split(',').map((s) => s.trim()).filter(Boolean);
      return parts.some((part) => {
        if (part.startsWith('#')) {
          const idOnly = part.slice(1).split('[')[0];
          return el.id === idOnly;
        }
        if (part.startsWith('.')) {
          const cls = part.slice(1).split('[')[0];
          return el.classList.contains(cls) || String(el.className || '').split(/\s+/).includes(cls);
        }
        const mAttr = part.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?/);
        if (mAttr) {
          if (!el.hasAttribute(mAttr[1])) return false;
          return mAttr[2] === undefined ? true : el.getAttribute(mAttr[1]) === mAttr[2];
        }
        const mTagAttr = part.match(/^([a-zA-Z0-9]+)\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
        if (mTagAttr) {
          return el.tagName.toLowerCase() === mTagAttr[1].toLowerCase() && el.getAttribute(mTagAttr[2]) === mTagAttr[3];
        }
        return el.tagName.toLowerCase() === part.toLowerCase();
      });
    };

    class MiniElement {
      constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = '';
        this.className = '';
        this.textContent = '';
        this.innerHTML = '';
        this.type = '';
        this.value = '';
        this.style = new MiniStyle();
        this.classList = new MiniClassList();
        this.dataset = {};
        this.attrs = new Map();
        this.children = [];
        this.parentElement = null;
        this.listeners = new Map();
        this._rect = { left: 260, top: 680, right: 980, bottom: 760, width: 720, height: 80 };
        this.width = 0;
        this.height = 0;
        allElements.push(this);
      }
      get isConnected() {
        let cur = this;
        while (cur) {
          if (cur === htmlEl) return true;
          cur = cur.parentElement;
        }
        return false;
      }
      get firstElementChild() { return this.children[0] || null; }
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx >= 0 ? (this.parentElement.children[idx + 1] || null) : null;
      }
      setAttribute(k, v) {
        attrWriteCount++;
        const sv = String(v);
        this.attrs.set(k, sv);
        if (k === 'id') this.id = sv;
        if (k === 'class') this.className = sv;
      }
      getAttribute(k) {
        if (k === 'id' && this.id) return this.id;
        if (k === 'class' && this.className) return this.className;
        return this.attrs.has(k) ? this.attrs.get(k) : null;
      }
      hasAttribute(k) {
        if (k === 'id' && this.id) return true;
        return this.attrs.has(k);
      }
      removeAttribute(k) {
        this.attrs.delete(k);
        if (k === 'id') this.id = '';
      }
      appendChild(ch) {
        if (ch && ch._isFragment) {
          for (const sub of Array.from(ch.children)) this.appendChild(sub);
          return ch;
        }
        if (ch.parentElement) ch.remove();
        ch.parentElement = this;
        this.children.push(ch);
        return ch;
      }
      insertBefore(ch, ref) {
        if (ch.parentElement) ch.remove();
        ch.parentElement = this;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) this.children.splice(idx, 0, ch);
        else this.children.push(ch);
        return ch;
      }
      insertAdjacentElement(pos, el) {
        if (pos === 'afterend' && this.parentElement) {
          const idx = this.parentElement.children.indexOf(this);
          if (el.parentElement) el.remove();
          el.parentElement = this.parentElement;
          this.parentElement.children.splice(idx + 1, 0, el);
          return el;
        }
        if (pos === 'beforeend') return this.appendChild(el);
        return el;
      }
      remove() {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      }
      matches(sel) { return matchesSimpleSel(this, sel); }
      closest(sel) {
        let cur = this;
        while (cur) {
          if (matchesSimpleSel(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      }
      querySelectorAll(sel) {
        const res = [];
        const walk = (node) => {
          for (const ch of node.children) {
            if (matchesSimpleSel(ch, sel)) res.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return res;
      }
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
      getBoundingClientRect() { return { ...this._rect }; }
      addEventListener(type, fn, opts) { addMapListener(this.listeners, type, fn, opts); }
      removeEventListener(type, fn) { remMapListener(this.listeners, type, fn); }
      dispatchEvent(ev) {
        ev.target = ev.target || this;
        const set = this.listeners.get(ev.type);
        if (set) for (const item of Array.from(set)) item.fn(ev);
        return true;
      }
      getContext() {
        return {
          setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
          arcTo() {}, arc() {}, closePath() {}, stroke() {}, fill() {},
          createRadialGradient() { return { addColorStop() {} }; }
        };
      }
      cloneNode() { return new MiniElement(this.tagName); }
      focus() {}
      click() { this.dispatchEvent({ type: 'click', stopPropagation() {}, preventDefault() {} }); }
    }

    const htmlEl = new MiniElement('html');
    const headEl = new MiniElement('head');
    const bodyEl = new MiniElement('body');
    htmlEl.appendChild(headEl);
    htmlEl.appendChild(bodyEl);

    const viewportEl = new MiniElement('div');
    viewportEl.setAttribute('data-testid', 'autoscroll-viewport');
    viewportEl._rect = { left: 240, top: 48, right: 1020, bottom: 670, width: 780, height: 622 };
    viewportEl.scrollHeight = 1600;
    viewportEl.scrollTop = 978;
    viewportEl.clientHeight = 622;
    viewportEl.offsetWidth = 794;
    viewportEl.clientWidth = 780;
    // Simulate paginated long conversation: only 1 tail user bubble is mounted in DOM, while host Fiber holds all 5 turns!
    const tailUserStep = new MiniElement('div');
    tailUserStep.setAttribute('data-testid', 'user-input-step');
    tailUserStep.textContent = '这是第 5 轮最新提问';
    viewportEl.appendChild(tailUserStep);
    let jumpedTurnIdx = -1;
    const mockHostTurns = [
      { startStepIndex: 0 },
      { startStepIndex: 12 },
      { startStepIndex: 28 },
      { startStepIndex: 45 },
      { startStepIndex: 63 }
    ];
    viewportEl.__reactFiber$mock = {
      return: {
        memoizedProps: {
          value: {
            turns: mockHostTurns,
            total: 5,
            activeIndex: 4,
            jumpTo: (idx) => { jumpedTurnIdx = idx; }
          }
        },
        return: {
          memoizedProps: {
            conversationId: 'conv-demo-01',
            turns: mockHostTurns,
            fetchTurns: async ({ stepIndices }) => ({
              turns: stepIndices.map((st) => ({
                startStepIndex: st,
                firstStep: { step: { value: { items: [{ chunk: { value: `历史轮次步骤#${st}` } }] } } }
              }))
            })
          },
          return: null
        }
      }
    };
    bodyEl.appendChild(viewportEl);

    const composerEl = new MiniElement('div');
    composerEl.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    const footerBar = new MiniElement('div');
    footerBar.setAttribute('class', 'flex min-w-0 flex-1 items-center agy-composer-footer');
    const modelWrap = new MiniElement('div');
    const modelBtn = new MiniElement('button');
    modelBtn.setAttribute('data-testid', 'model-selector-trigger');
    modelWrap.appendChild(modelBtn);
    const ctxRing = new MiniElement('button');
    ctxRing.setAttribute('id', 'ag-claude-ctx-ring');
    footerBar.appendChild(modelWrap);
    footerBar.appendChild(ctxRing);
    composerEl.appendChild(footerBar);
    bodyEl.appendChild(composerEl);

    const storageMap = new Map();
    storageMap.set('ag_claude_ux_quota_cache_v1', JSON.stringify({
      ts: Date.now(),
      accountEmail: 'demo@example.com',
      tierName: 'Google AI Ultra',
      groups: [
        {
          displayName: 'Gemini',
          buckets: [
            { window: '5h', remaining: { case: 'remainingFraction', value: 0.88 }, resetTime: new Date(Date.now() + 7200_000).toISOString() },
            { window: 'weekly', remaining: { case: 'remainingFraction', value: 0.74 }, resetTime: new Date(Date.now() + 172800_000).toISOString() }
          ]
        }
      ]
    }));

    const activeTimers = new Set();
    const wrapSetTimeout = (fn, ms) => {
      const id = setTimeout(() => { activeTimers.delete(id); fn(); }, Math.min(Number(ms) || 0, 5000));
      id.unref?.();
      activeTimers.add(id);
      return id;
    };
    const wrapClearTimeout = (id) => { activeTimers.delete(id); clearTimeout(id); };
    const activeIntervals = new Set();
    const wrapSetInterval = (fn, ms) => {
      const id = setInterval(fn, Math.max(50, Number(ms) || 1000));
      id.unref?.();
      activeIntervals.add(id);
      return id;
    };
    const wrapClearInterval = (id) => { activeIntervals.delete(id); clearInterval(id); };

    const documentMock = {
      documentElement: htmlEl,
      head: headEl,
      body: bodyEl,
      title: 'Antigravity',
      hidden: false,
      cookie: '',
      activeElement: null,
      hasFocus: () => true,
      createElement: (t) => new MiniElement(t),
      createElementNS: (_ns, t) => new MiniElement(t),
      createDocumentFragment: () => {
        const f = new MiniElement('#fragment');
        f._isFragment = true;
        return f;
      },
      getElementById: (id) => allElements.find((e) => e.isConnected && e.id === id) || null,
      querySelector: (sel) => htmlEl.querySelector(sel),
      querySelectorAll: (sel) => htmlEl.querySelectorAll(sel),
      addEventListener: (type, fn, opts) => addMapListener(docListeners, type, fn, opts),
      removeEventListener: (type, fn) => remMapListener(docListeners, type, fn),
      dispatchEvent: (ev) => {
        const set = docListeners.get(ev.type);
        if (set) for (const item of Array.from(set)) item.fn(ev);
        return true;
      }
    };

    const windowMock = {
      document: documentMock,
      location: { protocol: 'https:', origin: 'https://antigravity.local', pathname: '/c/conv-demo-01', href: 'https://antigravity.local/c/conv-demo-01' },
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', clipboard: { writeText: async () => {} } },
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 2,
      localStorage: {
        getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
        setItem: (k, v) => storageMap.set(String(k), String(v)),
        removeItem: (k) => storageMap.delete(k)
      },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      getComputedStyle: () => ({
        getPropertyValue: (p) => (p === '--primary' ? '#2F75C3' : ''),
        borderTopLeftRadius: '14px',
        display: 'block',
        visibility: 'visible',
        opacity: '1'
      }),
      requestAnimationFrame: (cb) => wrapSetTimeout(() => cb(performance.now()), 16),
      cancelAnimationFrame: (id) => wrapClearTimeout(id),
      setTimeout: wrapSetTimeout,
      clearTimeout: wrapClearTimeout,
      setInterval: wrapSetInterval,
      clearInterval: wrapClearInterval,
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
      AbortController,
      CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
      Event: class { constructor(type) { this.type = type; } },
      performance,
      console,
      Symbol,
      URL,
      Uint8Array,
      Float64Array,
      Int16Array,
      addEventListener: (type, fn, opts) => addMapListener(winListeners, type, fn, opts),
      removeEventListener: (type, fn) => remMapListener(winListeners, type, fn),
      dispatchEvent: (ev) => {
        const set = winListeners.get(ev.type);
        if (set) for (const item of Array.from(set)) item.fn(ev);
        return true;
      }
    };
    windowMock.window = windowMock;
    windowMock.globalThis = windowMock;

    const ctx = vm.createContext(windowMock);
    for (const rel of ['extensions/prism-suite.js', 'extensions/prism-suite-fx.js', 'extensions/prism-suite-workflow.js']) {
      const code = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      vm.runInContext(code, ctx, { filename: rel });
    }

    const bus = windowMock.__agPrismBus;
    assert.ok(bus && bus.version >= 4, 'Prism v4 event bus must initialize in mini-dom');
    assert.equal(typeof bus.showToast, 'function', 'bus.showToast must be exposed');

    // Verify new v0.9.0 prefs, CSS injection rejection, ThinkingOrb mount, optical facets, and compact quota pill
    assert.equal(htmlEl.getAttribute('data-ag-ps-facets'), '1', 'opticalFacets enabled by default');
    const qChip = documentMock.getElementById('ag-ps-quota-chip');
    assert.ok(qChip, 'Compact 5h/7d quota chip must mount beside #ag-claude-ctx-ring');
    assert.equal(ctxRing.nextElementSibling, qChip, 'Quota chip must anchor directly after #ag-claude-ctx-ring without Ping-Pong');
    assert.match(qChip.children[1].textContent, /5h 88% · 7d 74%/);

    // Dirty-checking verification: repeated tick with unchanged quota performs 0 writes on #ag-ps-quota-chip
    const writesBeforeTick = attrWriteCount;
    bus.setPref('performanceMode', 'power-save');
    assert.equal(htmlEl.getAttribute('data-ag-ps-perf'), 'power-save');
    assert.ok(attrWriteCount > writesBeforeTick);

    assert.equal(bus.setPref('chatFontFamily', '"LXGW WenKai"'), true);
    assert.equal(htmlEl.style.getPropertyValue('--ag-ps-chat-font'), '"LXGW WenKai"');
    assert.equal(bus.setPref('codeFontFamily', 'evil; } body { display: none'), false, 'CSS injection font must be rejected');

    assert.equal(bus.setPref('thinkingOrb', true), true);
    assert.ok(documentMock.getElementById('ag-ps-orb-dock'), 'ThinkingOrb dock must mount cleanly at runtime');

    // Outline rail must render all 5 host turns immediately on initial load without requiring any click!
    const railEl = documentMock.getElementById('ag-ps-outline-rail');
    assert.ok(railEl, 'Outline rail must mount immediately on conversation route');
    assert.equal(railEl.getAttribute('data-show'), '1');
    assert.equal(railEl.children.length, 5, 'Outline rail must immediately render all 5 turns from host Fiber even when only 1 bubble is in DOM');
    assert.equal(railEl.children[4].getAttribute('aria-current'), 'true', 'Active bottom turn pill must be highlighted initially');
    assert.equal(bus.getConversationNav().getPreview(4), '这是第 5 轮最新提问');
    // Clicking unmounted historical dot 1 invokes host jumpTo(1) and immediately switches active pill
    railEl.dispatchEvent({ type: 'click', target: railEl.children[1], stopPropagation() {}, preventDefault() {} });
    assert.equal(jumpedTurnIdx, 1, 'Clicking unmounted dot must invoke hostNav.jumpTo(1)');
    assert.equal(railEl.children[1].getAttribute('aria-current'), 'true');

    // v0.9.2: Opening bottom-left #ag-claude-quota-popover must NEVER push right #ag-ps-outline-rail into chat center
    const rightBeforeQuota = railEl.style.right;
    const mockQuotaPop = new MiniElement('div');
    mockQuotaPop.setAttribute('id', 'ag-claude-quota-popover');
    mockQuotaPop.setAttribute('data-open', 'true');
    mockQuotaPop._rect = { left: 380, top: 360, right: 720, bottom: 640, width: 340, height: 280 };
    bodyEl.appendChild(mockQuotaPop);
    windowMock.dispatchEvent(new windowMock.CustomEvent('ag-prism-overlay-change'));
    assert.equal(railEl.style.right, rightBeforeQuota, 'Bottom-left quota popover must not displace right outline rail');

    // v0.9.2: When host native left navigator [data-testid="conversation-navigator"] is present, smart mode deduplicates right rail & enhances left hover preview
    const hostLeftNav = new MiniElement('nav');
    hostLeftNav.setAttribute('data-testid', 'conversation-navigator');
    hostLeftNav._rect = { left: 224, top: 240, right: 238, bottom: 560, width: 14, height: 320 };
    const hostTurnBtn = new MiniElement('button');
    hostTurnBtn.setAttribute('data-testid', 'conversation-navigator-turn');
    hostTurnBtn.setAttribute('data-turn-index', '4');
    hostTurnBtn._rect = { left: 226, top: 520, right: 236, bottom: 536, width: 10, height: 16 };
    hostLeftNav.appendChild(hostTurnBtn);
    bodyEl.appendChild(hostLeftNav);
    bus.setPref('outlineRailMode', 'right');
    assert.ok(documentMock.getElementById('ag-ps-outline-rail'), 'Forced right mode renders right rail');
    bus.setPref('outlineRailMode', 'smart');
    assert.equal(documentMock.getElementById('ag-ps-outline-rail'), null, 'Smart mode removes duplicate right rail when host left navigator is visible');
    hostLeftNav.dispatchEvent({ type: 'pointerover', target: hostTurnBtn });
    const leftTip = documentMock.getElementById('ag-ps-rail-tip');
    assert.ok(leftTip && leftTip.getAttribute('data-show') === '1', 'Hovering legacy host left navigator dot shows Prism prompt preview tooltip');
    assert.equal(leftTip.getAttribute('data-side'), 'left');

    // Modern host with [data-base-ui-tooltip-trigger]: 'detailed' yields to native card (zero overlap), 'compact' shows single-line capsule
    hostTurnBtn.setAttribute('data-base-ui-tooltip-trigger', '');
    hostLeftNav.dispatchEvent({ type: 'pointerover', target: hostTurnBtn });
    assert.notEqual(leftTip.getAttribute('data-show'), '1', 'Detailed mode on modern host suppresses duplicate Prism capsule');
    bus.setPref('outlinePreviewStyle', 'compact');
    assert.equal(htmlEl.getAttribute('data-ag-ps-rail-preview'), 'compact');
    hostLeftNav.dispatchEvent({ type: 'pointerover', target: hostTurnBtn });
    assert.equal(leftTip.getAttribute('data-show'), '1', 'Compact mode shows single-line Prism capsule while CSS hides native card');
    assert.equal(leftTip.getAttribute('data-style'), 'compact');
    bus.setPref('outlinePreviewStyle', 'detailed');
    assert.notEqual(leftTip.getAttribute('data-show'), '1', 'Switching back to detailed hides Prism capsule immediately');

    // v0.9.2: GPU compositor border beam (.ag-ps-beam-ring) & 4-tab popover navigation
    bus.setPref('performanceMode', 'balanced');
    bus.setPref('composerBorderFx', 'beam');
    const beamRing = composerEl.querySelector('.ag-ps-beam-ring');
    assert.ok(beamRing, 'GPU compositor .ag-ps-beam-ring must mount without main-thread Canvas');
    assert.equal(beamRing.getAttribute('data-running'), '1');

    const titleToolbar = new MiniElement('div');
    titleToolbar.setAttribute('data-testid', 'pane-titlebar-toolbar');
    bodyEl.appendChild(titleToolbar);
    bus.setPref('showWorkbenchBtn', false);
    bus.setPref('showWorkbenchBtn', true);
    const suiteBtn = documentMock.getElementById('ag-ps-btn-suite');
    assert.ok(suiteBtn, 'Titlebar ✦ 棱镜 button must mount');
    suiteBtn.click();
    const popEl = documentMock.getElementById('ag-ps-popover');
    assert.ok(popEl && popEl.getAttribute('data-open') === '1', 'Popover opens on click');
    assert.match(popEl.innerHTML, /data-ps-tab="appearance"/);
    assert.match(popEl.innerHTML, /data-ps-tab="motion"/);
    assert.match(popEl.innerHTML, /data-ps-tab="nav"/);
    assert.match(popEl.innerHTML, /data-ps-tab="tools"/);

    // Double dispose() must leave zero orphaned DOM nodes, zero root attributes, and zero active intervals
    windowMock.__agPrismSuiteDispose();
    windowMock.__agPrismSuiteDispose();
    assert.equal(documentMock.getElementById('ag-ps-orb-dock'), null);
    assert.equal(documentMock.getElementById('ag-ps-quota-chip'), null);
    assert.equal(documentMock.getElementById('ag-ps-outline-rail'), null);
    assert.equal(documentMock.getElementById('ag-ps-rail-tip'), null);
    assert.equal(htmlEl.hasAttribute('data-ag-ps-perf'), false);
    assert.equal(htmlEl.hasAttribute('data-ag-ps-facets'), false);
    assert.equal(htmlEl.style.getPropertyValue('--ag-ps-chat-font'), '');
    assert.equal(activeIntervals.size, 0, 'All intervals must be cleared after dispose()');
    for (const t of Array.from(activeTimers)) clearTimeout(t);
  }

  // 2. [MS-SHLLINK] binary .lnk codec round-trip + ELECTRON_RUN_AS_NODE + AV-hygiene gate
  {
    const {
      LNK_HEADER_SIZE,
      LNK_CLSID_BYTES,
      LNK_FLAGS,
      parseWindowsLnkBuffer,
      updateWindowsLnkArguments
    } = await import(pathToFileURL(path.join(repoRoot, 'vendor', 'anti-claude', 'core', 'ms-lnk.mjs')).href);

    // Build a genuine [MS-SHLLINK] binary buffer with LinkInfo + Unicode StringData
    const header = Buffer.alloc(LNK_HEADER_SIZE, 0);
    header.writeUInt32LE(LNK_HEADER_SIZE, 0);
    LNK_CLSID_BYTES.copy(header, 4);
    const flags = LNK_FLAGS.HasLinkInfo | LNK_FLAGS.HasWorkingDir | LNK_FLAGS.HasArguments | LNK_FLAGS.IsUnicode;
    header.writeUInt32LE(flags, 20);

    const exePath = 'C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe';
    const ansiPath = Buffer.from(`${exePath}\0`, 'latin1');
    const uniPath = Buffer.from(`${exePath}\0`, 'utf16le');
    const volInfo = Buffer.alloc(16, 0);
    volInfo.writeUInt32LE(16, 0);
    volInfo.writeUInt32LE(3, 4); // DRIVE_FIXED
    const linkInfoHdrSize = 0x24;
    const volOffset = linkInfoHdrSize;
    const ansiBaseOffset = volOffset + volInfo.length;
    const ansiSuffixOffset = ansiBaseOffset + ansiPath.length;
    const ansiSuffix = Buffer.from([0]);
    const uniBaseOffset = ansiSuffixOffset + ansiSuffix.length;
    const uniSuffixOffset = uniBaseOffset + uniPath.length;
    const uniSuffix = Buffer.from([0, 0]);
    const linkInfoTotal = uniSuffixOffset + uniSuffix.length;

    const linkInfo = Buffer.alloc(linkInfoTotal, 0);
    linkInfo.writeUInt32LE(linkInfoTotal, 0);
    linkInfo.writeUInt32LE(linkInfoHdrSize, 4);
    linkInfo.writeUInt32LE(0x01, 8); // VolumeIDAndLocalBasePath
    linkInfo.writeUInt32LE(volOffset, 12);
    linkInfo.writeUInt32LE(ansiBaseOffset, 16);
    linkInfo.writeUInt32LE(ansiSuffixOffset, 24);
    linkInfo.writeUInt32LE(uniBaseOffset, 28);
    linkInfo.writeUInt32LE(uniSuffixOffset, 32);
    volInfo.copy(linkInfo, volOffset);
    ansiPath.copy(linkInfo, ansiBaseOffset);
    uniPath.copy(linkInfo, uniBaseOffset);

    const encUniCounted = (s) => {
      const b = Buffer.from(s, 'utf16le');
      const h = Buffer.alloc(2);
      h.writeUInt16LE(b.length >>> 1, 0);
      return Buffer.concat([h, b]);
    };
    const origLnk = Buffer.concat([
      header,
      linkInfo,
      encUniCounted('C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity'),
      encUniCounted('--existing-flag')
    ]);

    const parsed1 = parseWindowsLnkBuffer(origLnk);
    assert.equal(parsed1.ok, true);
    assert.equal(parsed1.targetPath, exePath);
    assert.equal(parsed1.arguments, '--existing-flag');

    const patchedLnk = updateWindowsLnkArguments(origLnk, '--existing-flag --remote-debugging-port=0');
    const parsed2 = parseWindowsLnkBuffer(patchedLnk);
    assert.equal(parsed2.ok, true);
    assert.equal(parsed2.targetPath, exePath);
    assert.equal(parsed2.arguments, '--existing-flag --remote-debugging-port=0');

    // ELECTRON_RUN_AS_NODE propagation
    const { buildNodeExecEnv } = await import(pathToFileURL(path.join(repoRoot, 'install.mjs')).href);
    const envOut = buildNodeExecEnv({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' });
    assert.equal(envOut.ELECTRON_RUN_AS_NODE, '1');

    // AV-hygiene static gates: zero WScript.Shell and zero -WindowStyle Hidden
    for (const rel of ['installer/win/PrismSuiteInstaller.cs', 'vendor/anti-claude/core/daemon.mjs', 'vendor/anti-claude/install.mjs']) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      assert.doesNotMatch(src, /WScript\.Shell/i, `${rel} must not contain WScript.Shell`);
    }
    for (const rel of ['plugin/server/upstream-radar.mjs', 'plugin/server/relaunch-client.mjs']) {
      const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      assert.doesNotMatch(src, /-WindowStyle\s+Hidden/i, `${rel} must not use -WindowStyle Hidden`);
    }
  }

  // 3. CUA content-agent sensitive OTP/paste guard, Broker 409 idempotency, {schema:1,prefs}, go-keyring-base64 & Model Hub idle timeout
  {
    const contentAgentSrc = fs.readFileSync(path.join(repoRoot, 'extensions', 'chrome-cua-bridge', 'content-agent.js'), 'utf8');
    let registeredListener = null;
    class MockAgentEl {}
    const otpInput = Object.assign(new MockAgentEl(), {
      tagName: 'INPUT',
      type: 'text',
      name: 'sms_code',
      id: 'otp',
      placeholder: '请输入短信验证码',
      isConnected: true,
      closest: () => null,
      getAttribute(k) { return this[k] || ''; },
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 120, height: 32 }),
      focus() {},
      dispatchEvent() { return true; }
    });
    const agentSandbox = vm.createContext({
      Element: MockAgentEl,
      HTMLElement: MockAgentEl,
      HTMLSelectElement: class extends MockAgentEl {},
      window: {
        innerWidth: 1280,
        innerHeight: 800,
        location: { href: 'https://portal.example.com/login', origin: 'https://portal.example.com' },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        scrollBy() {}
      },
      document: {
        title: 'Portal Login',
        activeElement: otpInput,
        body: otpInput,
        documentElement: otpInput,
        querySelector: () => null,
        querySelectorAll: () => [],
        elementFromPoint: () => otpInput
      },
      chrome: {
        runtime: {
          onMessage: { addListener: (fn) => { registeredListener = fn; } }
        }
      },
      CSS: { escape: (s) => s },
      MouseEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
      KeyboardEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
      Event: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
      setTimeout,
      clearTimeout
    });
    agentSandbox.window.document = agentSandbox.document;
    vm.runInContext(contentAgentSrc, agentSandbox);
    const cuaAgent = agentSandbox.window.__prismCuaContentAgent;
    const curPkgVer = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    assert.ok(cuaAgent && cuaAgent.version === curPkgVer);

    const pasteAttempt = await cuaAgent.act({ op: 'press_key', key: 'Ctrl+V' });
    assert.equal(pasteAttempt.ok, false);
    assert.equal(pasteAttempt.code, 'SENSITIVE_FIELD_BLOCKED', 'Ctrl+V into OTP/sensitive field must be blocked');

    const shiftInsAttempt = await cuaAgent.act({ op: 'press_key', key: 'Shift+Insert' });
    assert.equal(shiftInsAttempt.ok, false);
    assert.equal(shiftInsAttempt.code, 'SENSITIVE_FIELD_BLOCKED', 'Shift+Insert into sensitive field must be blocked');

    const tabNavAttempt = await cuaAgent.act({ op: 'press_key', key: 'Tab' });
    assert.equal(tabNavAttempt.ok, true, 'Pure Tab navigation away from sensitive field remains allowed');

    // sanitizePrismUiPrefs unwraps { schema: 1, prefs } and validates new v0.9.0 keys
    const { sanitizePrismUiPrefs } = await import(
      pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'account-manager.mjs')).href
    );
    const unwrapped = sanitizePrismUiPrefs({
      schema: 1,
      updatedAt: '2026-11-27T12:00:00Z',
      prefs: {
        performanceMode: 'vivid',
        ignoreReducedMotion: true,
        opticalFacets: true,
        semanticAfterglow: true,
        compactQuotaPill: true,
        chatFontFamily: '"LXGW WenKai"',
        codeFontFamily: 'bad; url(http://evil)'
      }
    });
    assert.equal(unwrapped.performanceMode, 'vivid');
    assert.equal(unwrapped.ignoreReducedMotion, true);
    assert.equal(unwrapped.opticalFacets, true);
    assert.equal(unwrapped.chatFontFamily, '"LXGW WenKai"');
    assert.equal(unwrapped.codeFontFamily, undefined);

    // account-vault go-keyring-base64 unwrapping & refreshHash extraction
    const {
      GO_KEYRING_B64_PREFIX,
      extractCredentialEmail,
      extractCredentialRefreshHash
    } = await import(pathToFileURL(path.join(repoRoot, 'plugin', 'server', 'account-vault.mjs')).href);
    const goPayload = `${GO_KEYRING_B64_PREFIX}${Buffer.from(
      JSON.stringify({ id_token_email: 'MacUser@Example.com', token: { refresh_token: '1//0gSecretRefreshTokenValue' } }),
      'utf8'
    ).toString('base64')}`;
    assert.equal(extractCredentialEmail(Buffer.from(goPayload, 'utf8')), 'macuser@example.com');
    const rHash = extractCredentialRefreshHash(Buffer.from(goPayload, 'utf8'));
    assert.match(rHash, /^[a-f0-9]{12}$/);

    // model-hub max_completion_tokens for o3 / gpt-5 & streaming idle timeout reset
    const tmpHubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v090-hub-'));
    try {
      const pm = createPrismProfileManager({
        profilePath: path.join(tmpHubDir, 'profile.json'),
        env: { TEST_HUB_KEY: 'sk-test-dummy-token-value-123456' }
      });
      pm.upsertProvider({
        id: 'p1',
        protocol: 'openai-chat',
        baseUrl: 'http://127.0.0.1:18888/v1',
        apiKeyEnv: 'TEST_HUB_KEY'
      });
      pm.upsertModel({
        id: 'o3-pro',
        providerId: 'p1',
        upstreamModel: 'o3-mini',
        tier: 'T1',
        vendor: 'openai'
      });
      let capturedBody = null;
      const enc = new TextEncoder();
      const hub = createModelHub({
        profileManager: pm,
        fetchFn: async (_url, init) => {
          capturedBody = JSON.parse(init.body);
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"PASS"}}]}\n\n'));
              controller.enqueue(enc.encode('data: [DONE]\n\n'));
              controller.close();
            }
          });
          return {
            ok: true,
            status: 200,
            headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
            body: stream
          };
        }
      });
      const resHub = await hub.askModel({ model: 'o3-pro', prompt: 'Audit check', maxTokens: 4096 });
      assert.equal(resHub.text, 'PASS');
      assert.equal(capturedBody.max_completion_tokens, 4096);
      assert.equal(capturedBody.max_tokens, undefined);
    } finally {
      fs.rmSync(tmpHubDir, { recursive: true, force: true });
    }
  }
});

test('v0.9.1 multi-size optical prism .ico binary integrity, /win32icon embedding, and High-DPI flow layout guards', () => {
  const icoPath = path.join(REPO, 'installer', 'win', 'prism-suite.ico');
  assert.equal(fs.existsSync(icoPath), true, 'installer/win/prism-suite.ico must exist');
  const icoBuf = fs.readFileSync(icoPath);
  assert.equal(icoBuf.readUInt16LE(0), 0, 'ICO reserved word must be 0');
  assert.equal(icoBuf.readUInt16LE(2), 1, 'ICO type must be 1 (ICON)');
  const frameCount = icoBuf.readUInt16LE(4);
  assert.equal(frameCount, 7, 'ICO must pack all 7 standard Windows DPI frames (16, 20, 24, 32, 48, 64, 256)');

  const seenWidths = [];
  for (let i = 0; i < frameCount; i++) {
    const entryOff = 6 + i * 16;
    const w = icoBuf.readUInt8(entryOff) || 256;
    const bpp = icoBuf.readUInt16LE(entryOff + 6);
    const bytesInRes = icoBuf.readUInt32LE(entryOff + 8);
    const imgOff = icoBuf.readUInt32LE(entryOff + 12);
    assert.equal(bpp, 32, 'Every icon frame must be 32-bit ARGB');
    assert.ok(imgOff + bytesInRes <= icoBuf.length, 'ICO frame bounds must be valid');
    seenWidths.push(w);
  }
  assert.deepEqual(seenWidths, [16, 20, 24, 32, 48, 64, 256]);

  const buildPs1 = fs.readFileSync(path.join(REPO, 'scripts', 'build-win-exe.ps1'), 'utf8');
  assert.equal((buildPs1.match(/\/win32icon:/g) || []).length >= 2, true, 'Both Setup.exe and prism-win-cua.exe must embed /win32icon');
  assert.match(buildPs1, /payload\.app\.icon/, 'Setup.exe must embed payload.app.icon for runtime window titlebar Icon');

  const installerCs = fs.readFileSync(path.join(REPO, 'installer', 'win', 'PrismSuiteInstaller.cs'), 'utf8');
  assert.doesNotMatch(installerCs, /AutoScaleMode\s*=\s*AutoScaleMode\.Dpi/, 'Must not use unanchored AutoScaleMode.Dpi');
  assert.doesNotMatch(installerCs, /header\.Height\s*=\s*84/, 'Header height must flow-size rather than clip at 84px');
  assert.match(installerCs, /SetProcessDpiAwarenessContext/);
  assert.match(installerCs, /SyncResponsiveWrapWidths/);
  assert.match(installerCs, /PaintPrismEmblem/);
});

test('v0.9.2 4-category popover tabs, GPU compositor border beam, 5x-ID semantic afterglow, smart left-rail deduplication, and unified floating card coordination', async () => {
  const { sanitizePrismUiPrefs } = await import(
    pathToFileURL(path.join(REPO, 'plugin', 'server', 'account-manager.mjs')).href
  );
  const prefsOut = sanitizePrismUiPrefs({
    composerBorderFx: 'smart',
    outlineRailMode: 'smart'
  });
  assert.equal(prefsOut.composerBorderFx, 'smart');
  assert.equal(prefsOut.outlineRailMode, 'smart');
  assert.equal(sanitizePrismUiPrefs({ composerBorderFx: 'invalid' }), null);

  const fxCss = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.css'), 'utf8');
  const fxJs = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const suiteJs = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
  const customJs = fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'user', 'custom.js'), 'utf8');
  const customCss = fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'user', 'custom.css'), 'utf8');
  const runtimeJs = fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'core', 'runtime.js'), 'utf8');

  // 1. Pure GPU compositor-thread border beam (conic-gradient + mask-composite + pure rotate(360deg))
  assert.match(fxCss, /@keyframes agPsBeamSpin[\s\S]{0,120}transform:\s*rotate\(360deg\)/);
  assert.match(fxCss, /\.ag-ps-beam-ring\s*\{[\s\S]{0,520}mask-composite:\s*exclude/);
  assert.doesNotMatch(fxJs, /drawCometTrail/, 'Legacy 84-stroke main-thread Canvas comet loop must be removed');

  // 2. 5x-ID specificity on semantic afterglow & non-focus-wiping dismissal
  assert.match(fxCss, /(?:#antigravity\\\.agentSidePanelInputBox){5}\[data-ag-ps-afterglow="done"\]/);
  assert.match(fxJs, /function dismissAfterglowOnNewInteraction\(/);
  assert.doesNotMatch(fxJs, /setAttr\(chip,\s*'data-ag-ps-tip'/, 'Quota chip must not attach redundant hover tooltip');

  // 3. Global floating card mutual exclusion & theme-adaptive surfaces
  assert.match(customJs, /ag-prism-close-popovers/);
  assert.match(suiteJs, /ag-prism-close-popovers/);
  assert.match(runtimeJs, /ag-claude-quota-popover/);
  assert.match(customCss, /body:has\(#ag-claude-quota-popover\[data-open="true"\]\)\s*#ag-live-metrics-tooltip/);
  assert.doesNotMatch(customCss, /#ag-claude-quota-popover\s*\{[^}]*background-color:\s*#252523/i);

  // 4. Cross-surface 8-palette theme sync, 1-click experience presets, dual-settings bridge & beginner-clean installer
  assert.match(suiteJs, /PRISM_PALETTE_TOKENS/);
  assert.match(suiteJs, /EXPERIENCE_PRESETS/);
  assert.match(suiteJs, /type:\s*'theme-sync'/);
  assert.match(customJs, /data-ag-open-prism-suite/);
  const appHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'app.html'), 'utf8');
  const inlineHtml = fs.readFileSync(path.join(REPO, 'plugin', 'ui', 'inline.html'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(REPO, 'extensions', 'chrome-cua-bridge', 'popup.html'), 'utf8');
  const installerCs = fs.readFileSync(path.join(REPO, 'installer', 'win', 'PrismSuiteInstaller.cs'), 'utf8');
  assert.match(appHtml, /applyPrismThemePayload/);
  assert.match(inlineHtml, /applyPrismThemePayload/);
  assert.match(popupHtml, /icons\/icon48\.png/);
  assert.match(popupHtml, /Prism 网页协作助手/);
  assert.match(installerCs, /btnTogglePaths/);

  // 5. Post-v0.9.2 real-window polish: exclude 0px changed-files-card wrapper, vertical left-rail capsule, *.usercontent.goog bridge origin, resting-clean sash, decoupled bubble tint & side-panel-safe keepOverviewOpen
  assert.doesNotMatch(fxCss, /\[data-testid="changed-files-card"\]\s*,/, 'Must not apply card border to unrounded outer changed-files-card wrapper');
  assert.doesNotMatch(fxCss, /data-ag-ps-facets="1"[\s\S]{0,180}agy-user-bubble/, 'Optical facets must not alter user message bubble borders or tint');
  assert.match(fxCss, /\[data-testid="conversation-navigator-turn"\]\[aria-current="true"\][\s\S]{0,160}>\s*span\s*\{[\s\S]{0,160}height:\s*16px/);
  assert.match(suiteJs, /usercontent\\\.goog/);
  assert.match(fxJs, /WANTED_OV_STORAGE_KEY/);
  assert.match(fxJs, /isAuxSidePanelOpen/);
  assert.match(fxJs, /checkAndHealOrphanedOverviewTransition/);
  assert.match(suiteJs, /renderPrismTierBadgeHtml/);
  assert.match(appHtml, /renderWbTierBadge/);
  assert.match(fxJs, /outlinePreviewStyle/);
  assert.match(fxCss, /data-ag-ps-rail-preview="compact"/);
});

test('v0.9.3 Anti-Claude v3.1.10 compat, placeholder-masked thought translation, wan/yi token & hour duration formatting, and composer Tab intent ghost', () => {
  const rootUp = fs.readFileSync(path.join(REPO, 'upstream.json'), 'utf8');
  const pluginUp = fs.readFileSync(path.join(REPO, 'plugin', 'upstream.json'), 'utf8');
  assert.equal(rootUp, pluginUp, 'Root upstream.json and plugin/upstream.json must stay byte-for-byte identical');
  const parsedUp = JSON.parse(rootUp);
  assert.equal(parsedUp.upstreams.antiClaude.baselineTag, 'v3.1.10');
  assert.equal(parsedUp.upstreams.antiClaude.baselineCommit, 'c49103c');
  assert.equal(parsedUp.upstreams.agyPowertools.baselineTag, 'v2.17.0');
  assert.equal(parsedUp.upstreams.agyPowertools.baselineCommit, '6e2354b');

  const daemonSrc = fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'core', 'daemon.mjs'), 'utf8');
  const customSrc = fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'user', 'custom.js'), 'utf8');
  const i18nJson = JSON.parse(fs.readFileSync(path.join(REPO, 'vendor', 'anti-claude', 'core', 'i18n.json'), 'utf8'));
  const suiteJs = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite.js'), 'utf8');
  const fxJs = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.js'), 'utf8');
  const fxCss = fs.readFileSync(path.join(REPO, 'extensions', 'prism-suite-fx.css'), 'utf8');
  const accMgr = fs.readFileSync(path.join(REPO, 'plugin', 'server', 'account-manager.mjs'), 'utf8');

  // 1. Anti-Claude v3.1.10 Antigravity v2.36.0 model menu compatibility
  assert.equal(i18nJson['Context and quota indicator'], '上下文与配额指示器');
  assert.equal(i18nJson['Legacy Dark'], '经典深色');
  assert.match(customSrc, /'locked',\s*'hideThinkingEffort'/);
  assert.match(customSrc, /api\.hideThinkingEffort === true/);

  // 2. Placeholder masking, 0600 cache & clearTranslateCache + predictNextPrompt in daemon.mjs
  assert.match(daemonSrc, /⟪P\$\{/);
  assert.match(daemonSrc, /clearTranslateCache/);
  assert.match(daemonSrc, /predictNextPrompt/);
  assert.match(daemonSrc, /thought-translation-cache\.json/);

  // 3. Chinese 万/亿 token unit + >=1h duration carry + Composer Tab intent ghost
  assert.match(customSrc, /ag-prism-token-unit/);
  assert.match(customSrc, /小时/);
  assert.match(suiteJs, /tokenUnit:/);
  assert.match(suiteJs, /composerIntentSuggest:/);
  assert.match(suiteJs, /clearTranslateCache/);
  assert.match(fxJs, /composerIntentSuggest/);
  assert.match(fxJs, /ag-ps-intent-ghost/);
  assert.match(fxJs, /acceptIntentSuggestion/);
  assert.match(fxJs, /lastIntentAcceptAt/);
  assert.match(fxJs, /fallbackAfterReconcile/);
  assert.match(fxJs, /ag-ps-intent-spark/);
  assert.match(fxCss, /\.ag-ps-intent-ghost/);
  assert.match(fxCss, /\[data-ag-ps-intent-open="1"\]\s*\[data-lexical-placeholder="true"\]/);
  assert.doesNotMatch(fxCss, /\[data-testid="user-message"\]:not\(:has\(/, 'Image-only user messages must never match outer user-message wrapper tinting');
  assert.match(accMgr, /composerIntentSuggest/);
  assert.match(accMgr, /tokenUnit/);
});

test('v0.9.4 behavioral security & data-integrity suite: GBK non-corruption, _appToken capability enforcement, UNC/sensitive-dir guards, redaction matrix, WSL/IMDS guards, and .prism-managed symmetric uninstall', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-v094-audit-'));
  try {
    // 1. Single-source version parity across all 17 derived files
    const syncOut = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'sync-version.mjs'), '--check'], {
      cwd: REPO,
      encoding: 'utf8'
    });
    assert.match(syncOut, /OK: all \d+ versioned files match v0\.9\.4/);

    // 2. [B-03] GBK file readable preview + strict save block (zero byte corruption) + UTF-8 BOM preservation
    const srv = createPrismFilesServer({
      dataDir: path.join(tmp, 'srv-data'),
      defaultRoot: tmp,
      accountStateDir: path.join(tmp, 'srv-state')
    });
    const gbkPath = path.join(tmp, 'legacy-script.bat');
    // "echo 中文\r\n" in GBK: 65 63 68 6f 20 d6 d0 ce c4 0d 0a
    const gbkOriginalBytes = Buffer.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a]);
    fs.writeFileSync(gbkPath, gbkOriginalBytes);

    const gbkPrev = await srv.handleToolCall('read_file_preview', { path: gbkPath });
    assert.equal(gbkPrev.structuredContent.ok, true);
    assert.equal(gbkPrev.structuredContent.editable, false, 'GBK file must automatically lock to read-only');
    assert.equal(gbkPrev.structuredContent.encoding, 'non-utf8');
    assert.match(gbkPrev.structuredContent.text, /echo 中文/, 'GBK Chinese text must decode legibly without U+FFFD');
    assert.ok(gbkPrev.structuredContent.readOnlyReason);

    const gbkSaveAttempt = await srv.handleToolCall('save_file_content', {
      path: gbkPath,
      content: 'echo 改写\r\n',
      expectedMtimeMs: gbkPrev.structuredContent.mtimeMs
    });
    assert.equal(gbkSaveAttempt.structuredContent.ok, false, 'Saving over a GBK file must be blocked');
    assert.equal(gbkSaveAttempt.structuredContent.code, 'NON_UTF8_READONLY');
    assert.deepEqual(fs.readFileSync(gbkPath), gbkOriginalBytes, 'Original GBK bytes on disk must remain 100% untouched');

    // UTF-8 BOM roundtrip preservation
    const bomPath = path.join(tmp, 'with-bom.txt');
    fs.writeFileSync(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('首行内容\n', 'utf8')]));
    const bomPrev = await srv.handleToolCall('read_file_preview', { path: bomPath });
    assert.equal(bomPrev.structuredContent.editable, true);
    const bomSave = await srv.handleToolCall('save_file_content', {
      path: bomPath,
      content: '更新后内容\n',
      expectedMtimeMs: bomPrev.structuredContent.mtimeMs,
      baseHash: bomPrev.structuredContent.baseHash
    });
    assert.equal(bomSave.structuredContent.ok, true);
    const savedBomBytes = fs.readFileSync(bomPath);
    assert.deepEqual(savedBomBytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]), 'UTF-8 BOM must be preserved on save');

    // 3. [B-01] Server-enforced 256-bit _appToken capability token on stdio transport
    const utf8Path = path.join(tmp, 'normal.txt');
    fs.writeFileSync(utf8Path, 'hello\n', 'utf8');
    const normalPrev = await srv.handleToolCall('read_file_preview', { path: utf8Path });
    const unauthorizedStdioSave = await srv.handleToolCall(
      'save_file_content',
      { path: utf8Path, content: 'pwned\n', expectedMtimeMs: normalPrev.structuredContent.mtimeMs },
      { fromStdio: true }
    );
    assert.equal(unauthorizedStdioSave.isError, true, 'Model stdio call to app-only tool without _appToken must fail');
    assert.equal(unauthorizedStdioSave.structuredContent.code, 'APP_ONLY_FORBIDDEN');
    assert.equal(fs.readFileSync(utf8Path, 'utf8'), 'hello\n');

    const authorizedStdioSave = await srv.handleToolCall(
      'save_file_content',
      {
        path: utf8Path,
        content: 'updated-by-ui\n',
        expectedMtimeMs: normalPrev.structuredContent.mtimeMs,
        baseHash: normalPrev.structuredContent.baseHash,
        _appToken: srv.getAppCapabilityToken()
      },
      { fromStdio: true }
    );
    assert.equal(authorizedStdioSave.structuredContent.ok, true);
    assert.equal(fs.readFileSync(utf8Path, 'utf8'), 'updated-by-ui\n');

    // 4. [B-02 + B-06] show_files_inline UNC/SMB NTLM leak block & open_prism_files sensitive dir block
    const uncInline = await srv.handleToolCall('show_files_inline', {
      files: ['\\\\evil.example.com\\share\\ntlm-trap.txt']
    });
    assert.equal(uncInline.structuredContent.items[0].blocked, true, 'External UNC path in show_files_inline must be blocked before stat');
    assert.equal(uncInline.structuredContent.items[0].exists, false);

    const fakeSshDir = path.join(tmp, '.ssh');
    fs.mkdirSync(fakeSshDir, { recursive: true });
    fs.writeFileSync(path.join(fakeSshDir, 'id_ed25519'), 'PRIVATE', 'utf8');
    const sshOpen = await srv.handleToolCall('open_prism_files', { dir: fakeSshDir });
    assert.doesNotMatch(JSON.stringify(sshOpen), /id_ed25519/, 'open_prism_files must never leak filenames inside .ssh');

    // 5. [B-04 + X-01 + X-05] Unified credential redaction matrix & IPv4-mapped IPv6 IMDS guard
    const { redactSensitiveText, isSensitiveFilePath } = await import(
      pathToFileURL(path.join(REPO, 'plugin', 'server', 'redact-shared.mjs')).href
    );
    const {
      redactSensitiveOutboundText,
      isAllowedModelHubEndpointUrl,
      stripFastRestoreFlagsPreservingQuotes
    } = await import(pathToFileURL(path.join(REPO, 'vendor', 'anti-claude', 'core', 'daemon.mjs')).href);

    const SECRET_SAMPLES = [
      ['password=Hunter2SecretPass', 'Hunter2SecretPass'],
      ['DB_PASSWORD: SuperSecretValue99', 'SuperSecretValue99'],
      ['{"password": "JsonPasswordValue123"}', 'JsonPasswordValue123'],
      ['{"apiKey": "JsonApiKeySecretValue999"}', 'JsonApiKeySecretValue999'],
      ['postgres://dbadmin:PgSecretPass88@db.example.com:5432/prod', 'PgSecretPass88'],
      [`${'AKIA'}${'IOSFODNN7EXAMPLE'}`, 'IOSFODNN7EXAMPLE'],
      [`${'ya29'}.a0AfH6SMBxSecretGoogleAccessToken123456`, 'SecretGoogleAccessToken123456'],
      [`${'1//'}${'0gSecretGoogleRefreshTokenValue1234567890'}`, 'SecretGoogleRefreshTokenValue1234567890'],
      [`${'hf'}_${'abcdefghijklmnopqrstuvwxyz123456'}`, 'abcdefghijklmnopqrstuvwxyz123456'],
      [`${'rk'}_${'live'}_${'1234567890abcdefghijklmn'}`, '1234567890abcdefghijklmn'],
      ['-----BEGIN PGP PRIVATE KEY BLOCK-----\nSecretKeyBody\n-----END PGP PRIVATE KEY BLOCK-----', 'SecretKeyBody']
    ];
    for (const [sample, needle] of SECRET_SAMPLES) {
      assert.doesNotMatch(redactSensitiveText(sample), new RegExp(needle), `redactSensitiveText leaked: ${sample}`);
      assert.doesNotMatch(redactSensitiveOutboundText(sample), new RegExp(needle), `redactSensitiveOutboundText leaked: ${sample}`);
    }
    assert.equal(isSensitiveFilePath('/home/alice/.kube/config'), true);
    assert.equal(isSensitiveFilePath('/home/alice/.gemini/oauth_creds.json'), true);
    assert.equal(isSensitiveFilePath('C:\\Users\\alice\\AWS~1\\credentials'), true);
    assert.equal(isSensitiveFilePath('/home/alice/.bashrc', { forWrite: true }), true);
    assert.equal(isSensitiveFilePath('/home/alice/.gemini/config/plugins/x/mcp_config.json', { forWrite: true }), true);

    assert.equal(isAllowedModelHubEndpointUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'), false, 'IPv6-mapped AWS IMDS must be blocked');
    assert.equal(isAllowedModelHubEndpointUrl('http://100.100.100.200/latest/meta-data/'), false, 'Alibaba Cloud IMDS must be blocked');
    assert.equal(isAllowedModelHubEndpointUrl('http://100.82.183.41:8787/v1/chat/completions'), true, 'Tailscale NAS CPA gateway must remain allowed');

    // 6. [A-01 + A-07 + A-08] Strict WSL adapter match, quote-preserving shortcut flag strip & [MS-SHLLINK] relative path
    const { discoverWslAdapterIpv4 } = await import(
      pathToFileURL(path.join(REPO, 'vendor', 'anti-claude', 'core', 'cua-broker.mjs')).href
    );
    assert.equal(
      discoverWslAdapterIpv4({
        'vEthernet (External Switch)': [{ family: 'IPv4', internal: false, address: '192.168.1.23' }],
        'vEthernet (Default Switch)': [{ family: 'IPv4', internal: false, address: '172.20.48.1' }],
        'vEthernet (WSL (Hyper-V firewall))': [{ family: 'IPv4', internal: false, address: '172.29.0.1' }]
      }),
      '172.29.0.1',
      'Must ignore Hyper-V External/Default switches and pick true WSL adapter'
    );
    assert.equal(
      discoverWslAdapterIpv4({
        'vEthernet (External Switch)': [{ family: 'IPv4', internal: false, address: '192.168.1.23' }]
      }),
      null,
      'Must return null when only non-WSL vEthernet exists'
    );
    assert.equal(
      stripFastRestoreFlagsPreservingQuotes('--user-data-dir="D:\\My  Data" --disable-renderer-backgrounding --remote-debugging-port=0'),
      '--user-data-dir="D:\\My  Data" --remote-debugging-port=0'
    );

    // 7. [E-01 + E-03] .prism-managed prevents wiping unrelated parent/runtime on userDir ending in "user", and symmetric uninstall cleans prism-suite/
    const userProjectRoot = path.join(tmp, 'myproject');
    const unrelatedRuntimeFile = path.join(userProjectRoot, 'runtime', 'MY-IMPORTANT-DATA.txt');
    fs.mkdirSync(path.dirname(unrelatedRuntimeFile), { recursive: true });
    fs.writeFileSync(unrelatedRuntimeFile, 'DO_NOT_DELETE', 'utf8');
    assert.throws(
      () => installAll({ userDir: path.join(userProjectRoot, 'user'), pluginsDir: path.join(tmp, 'p1'), activateKernelDaemon: false }),
      /unmanaged|runtime/i,
      'installAll must refuse overwriting an unmanaged pre-existing runtime directory'
    );
    assert.equal(fs.readFileSync(unrelatedRuntimeFile, 'utf8'), 'DO_NOT_DELETE');

    const cleanBox = path.join(tmp, 'cleanbox');
    installAll({ userDir: path.join(cleanBox, 'user'), pluginsDir: path.join(cleanBox, 'plugins'), activateKernelDaemon: false });
    assert.equal(fs.existsSync(path.join(cleanBox, 'runtime', '.prism-managed')), true);
    uninstallAll({ userDir: path.join(cleanBox, 'user'), pluginsDir: path.join(cleanBox, 'plugins'), removeKernel: true, deactivateDaemon: false });
    assert.equal(fs.existsSync(path.join(cleanBox, 'prism-suite', 'install-mode.json')), false, 'install-mode.json must be cleaned up on uninstall');
    assert.equal(fs.existsSync(path.join(cleanBox, 'prism-suite')), false, 'Empty prism-suite directory must be removed on uninstall');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
