#!/usr/bin/env node
/**
 * Single-source-of-truth version synchronizer & CI parity checker.
 * Reads `version` from `package.json` and synchronizes (or verifies with `--check`)
 * all derived manifests, C# AssemblyInfo headers, extensions, and MCP server headers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const ver = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(ver)) {
  throw new Error(`Invalid semver version in package.json: ${ver}`);
}

const RULES = [
  {
    rel: 'plugin/plugin.json',
    apply: (s) =>
      s
        .replace(/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${ver}"`)
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+/g, `Anti-Claude Prism Suite v${ver}`)
  },
  {
    rel: 'plugin-cua/plugin.json',
    apply: (s) => s.replace(/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${ver}"`)
  },
  {
    rel: 'plugin/server/index.mjs',
    apply: (s) =>
      s
        .replace(/Part of Anti-Claude Prism Suite v\d+\.\d+\.\d+/g, `Part of Anti-Claude Prism Suite v${ver}`)
        .replace(/const SERVER_INFO = \{ name: 'prism-files', version: '\d+\.\d+\.\d+' \};/, `const SERVER_INFO = { name: 'prism-files', version: '${ver}' };`)
  },
  {
    rel: 'plugin-cua/server/index.mjs',
    apply: (s) => s.replace(/(\bSERVER_INFO\s*=\s*(?:Object\.freeze\(\s*)?\{[\s\S]{0,80}?version:\s*')(\d+\.\d+\.\d+)(')/, `$1${ver}$3`)
  },
  {
    rel: 'vendor/anti-claude/core/cua-broker.mjs',
    apply: (s) =>
      s
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+/, `Anti-Claude Prism Suite v${ver}`)
        .replace(/export const CUA_VERSION = '\d+\.\d+\.\d+';/, `export const CUA_VERSION = '${ver}';`)
  },
  {
    rel: 'extensions/prism-suite.js',
    apply: (s) =>
      s
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+/, `Anti-Claude Prism Suite v${ver}`)
        .replace(/const SUITE_VERSION = '\d+\.\d+\.\d+';/, `const SUITE_VERSION = '${ver}';`)
  },
  {
    rel: 'extensions/prism-suite-fx.js',
    apply: (s) => s.replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+/, `Anti-Claude Prism Suite v${ver}`)
  },
  {
    rel: 'extensions/prism-suite-workflow.js',
    apply: (s) => s.replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+/, `Anti-Claude Prism Suite v${ver}`)
  },
  {
    rel: 'extensions/chrome-cua-bridge/manifest.json',
    apply: (s) => s.replace(/"version":\s*"\d+\.\d+\.\d+"/, `"version": "${ver}"`)
  },
  {
    rel: 'extensions/chrome-cua-bridge/popup.html',
    apply: (s) => s.replace(/<span class="ver-pill">v\d+\.\d+\.\d+<\/span>/, `<span class="ver-pill">v${ver}</span>`)
  },
  {
    rel: 'extensions/chrome-cua-bridge/content-agent.js',
    apply: (s) => s.replace(/const AGENT_VERSION = '\d+\.\d+\.\d+';/, `const AGENT_VERSION = '${ver}';`)
  },
  {
    rel: 'extensions/chrome-cua-bridge/background.js',
    apply: (s) =>
      s
        .replace(/version:\s*'\d+\.\d+\.\d+'/g, `version: '${ver}'`)
        .replace(/window\.__prismCuaContentAgent\.version === '\d+\.\d+\.\d+'/g, `window.__prismCuaContentAgent.version === '${ver}'`)
  },
  {
    rel: 'installer/win/PrismSuiteInstaller.cs',
    apply: (s) =>
      s
        .replace(/\[assembly: AssemblyVersion\("\d+\.\d+\.\d+\.0"\)\]/, `[assembly: AssemblyVersion("${ver}.0")]`)
        .replace(/\[assembly: AssemblyFileVersion\("\d+\.\d+\.\d+\.0"\)\]/, `[assembly: AssemblyFileVersion("${ver}.0")]`)
        .replace(/一键安装器(\s*)v\d+\.\d+\.\d+/g, `一键安装器$1v${ver}`)
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+ 安装成功/g, `Anti-Claude Prism Suite v${ver} 安装成功`)
  },
  {
    rel: 'native/win-cua/PrismWinCua.cs',
    apply: (s) =>
      s
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+ Controlled Desktop/, `Anti-Claude Prism Suite v${ver} Controlled Desktop`)
        .replace(/\[assembly: AssemblyVersion\("\d+\.\d+\.\d+\.0"\)\]/, `[assembly: AssemblyVersion("${ver}.0")]`)
        .replace(/\[assembly: AssemblyFileVersion\("\d+\.\d+\.\d+\.0"\)\]/, `[assembly: AssemblyFileVersion("${ver}.0")]`)
        .replace(/ver\["version"\] = "\d+\.\d+\.\d+";/, `ver["version"] = "${ver}";`)
  },
  {
    rel: 'plugin/ui/app.html',
    apply: (s) =>
      s
        .replace(/界面已更新到 v\d+\.\d+\.\d+/g, `界面已更新到 v${ver}`)
        .replace(/<span class="pill">v\d+\.\d+\.\d+<\/span>/g, `<span class="pill">v${ver}</span>`)
        .replace(/currentVersion \|\| '\d+\.\d+\.\d+'/g, `currentVersion || '${ver}'`)
        .replace(/appInfo: \{ name: 'prism-files', version: '\d+\.\d+\.\d+' \}/g, `appInfo: { name: 'prism-files', version: '${ver}' }`)
  },
  {
    rel: 'plugin/ui/inline.html',
    apply: (s) =>
      s.replace(/appInfo: \{ name: 'prism-files', version: '\d+\.\d+\.\d+' \}/g, `appInfo: { name: 'prism-files', version: '${ver}' }`)
  },
  {
    rel: 'README.md',
    apply: (s) =>
      s
        .replace(/badge\/version-v\d+\.\d+\.\d+-2563eb/g, `badge/version-v${ver}-2563eb`)
        .replace(/alt="Version v\d+\.\d+\.\d+"/g, `alt="Version v${ver}"`)
        .replace(/Anti-Claude Prism Suite v\d+\.\d+\.\d+（单包独立完整版/g, `Anti-Claude Prism Suite v${ver}（单包独立完整版`)
  }
];

const mismatched = [];
const updated = [];

for (const rule of RULES) {
  const full = path.join(REPO, rule.rel);
  const before = fs.readFileSync(full, 'utf8');
  const after = rule.apply(before);
  if (after !== before) {
    if (checkOnly) {
      mismatched.push(rule.rel);
    } else {
      fs.writeFileSync(full, after, 'utf8');
      updated.push(rule.rel);
    }
  }
}

if (checkOnly) {
  if (mismatched.length > 0) {
    console.error(`[sync-version] Version mismatch against package.json (${ver}) in:\n  - ${mismatched.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`[sync-version] OK: all ${RULES.length} versioned files match v${ver}`);
} else {
  console.log(`[sync-version] Synced v${ver} across ${updated.length}/${RULES.length} files.`);
}
