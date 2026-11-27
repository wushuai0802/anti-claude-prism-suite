/**
 * Detached, process-tree-independent Antigravity client relauncher (v0.5.0).
 *
 * Design guarantees:
 * - Zero external dependencies, MIT clean-room implementation.
 * - Preserves `--remote-debugging-port=0` when active or Anti-Claude extensions are present.
 * - Uses Explorer ShellExecute COM -> Start-Process fallback executing a self-cleaning `-File` script
 *   on Windows/WSL2 (no WMI creation, no nested EncodedCommand) so closing Antigravity never kills the worker.
 * - Only signals Antigravity.exe matching the resolved executable path; never touches unrelated apps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  cleanPowerShellError,
  detectIsWsl,
  resolveSafeExecCwd,
  resolveWslInteropEnv
} from './account-vault.mjs';

function psSingleQuote(val) {
  return `'${String(val ?? '').replace(/'/g, "''")}'`;
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

function defaultRunCmd(bin, args, { input = '', timeoutMs = 10000, cwd, env } = {}) {
  const res = spawnSync(bin, args, {
    input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {})
  });
  if (res.error) throw res.error;
  return {
    status: res.status ?? (res.signal ? 1 : 0),
    signal: res.signal || '',
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

function defaultSpawnDetached(bin, args, options = {}) {
  const child = spawn(bin, args, {
    shell: false,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options
  });
  child.unref();
  return true;
}

const PS_PROBE_TARGET_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$target = ''
$hasDebug = $false
$debugPort = ''
$mainProc = Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" | Where-Object { $_.ExecutablePath -and ($_.CommandLine -notmatch '--type=') } | Select-Object -First 1
if ($mainProc) {
  $target = [string]$mainProc.ExecutablePath
  $cmdStr = [string]$mainProc.CommandLine
  if ($cmdStr -match '--remote-debugging-port') {
    $hasDebug = $true
    $portPattern = '(?<!\S)(?:"--remote-debugging-port=(?<p>[0-9]{1,5})"|--remote-debugging-port=(?:"(?<p>[0-9]{1,5})"|(?<p>[0-9]{1,5}))|--remote-debugging-port\s+(?<p>[0-9]{1,5}))(?=\s|$)'
    $portMatch = [regex]::Match($cmdStr, $portPattern)
    if ($portMatch.Success) {
      $portNumber = [int]$portMatch.Groups['p'].Value
      if ($portNumber -ge 1 -and $portNumber -le 65535) {
        $debugPort = [string]$portNumber
      }
    }
  }
}
if (-not $target) {
  $cands = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),
    'C:\Program Files\Antigravity\Antigravity.exe',
    'D:\Program Files\Antigravity\Antigravity.exe'
  )
  foreach ($c in $cands) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { $target = $c; break }
  }
}
$antiClaudeDir = Join-Path $env:USERPROFILE '.gemini\antigravity\anti-claude'
$hasAntiClaude = Test-Path -LiteralPath $antiClaudeDir -PathType Container
Write-Output (ConvertTo-Json -Compress @{ ok = $true; targetPath = $target; hasDebug = [bool]$hasDebug; debugPort = $debugPort; hasAntiClaude = [bool]$hasAntiClaude })
`;

const PS_PROBE_TARGET_ENCODED = Buffer.from(PS_PROBE_TARGET_SCRIPT, 'utf16le').toString('base64');

function normalizeDebugPortFlag(debugPort) {
  const raw = String(debugPort ?? '').trim();
  if (/^\d{1,5}$/.test(raw)) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) {
      return `--remote-debugging-port=${n}`;
    }
  }
  return '--remote-debugging-port=0';
}

export function buildWinRelaunchWorkerScript({
  targetPath,
  preserveDebugPort = true,
  debugPort = '',
  delayMs = 650
} = {}) {
  const safeDelay = Math.max(250, Math.min(5000, Math.round(Number(delayMs) || 650)));
  const launchArgLine = preserveDebugPort ? normalizeDebugPortFlag(debugPort) : '';
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Start-Sleep -Milliseconds ${safeDelay}`,
    `$target = ${psSingleQuote(targetPath)}`,
    '$targetDir = Split-Path -Parent $target',
    'function Get-AgyTargetProcs {',
    "  @(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Where-Object {",
    '    -not $_.ExecutablePath -or $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)',
    '  })',
    '}',
    '$origPids = @((Get-AgyTargetProcs) | ForEach-Object { [int]$_.ProcessId } | Where-Object { $_ -gt 0 })',
    'function Get-AgyOrigRemaining {',
    '  if ($origPids.Count -eq 0) { return @() }',
    "  @(Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Where-Object { $origPids -contains $_.Id })",
    '}',
    "foreach ($p in (Get-AgyOrigRemaining)) {",
    '  if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }',
    '}',
    '$deadline = (Get-Date).AddMilliseconds(4500)',
    'while ((Get-Date) -lt $deadline) {',
    '  if ((Get-AgyOrigRemaining).Count -eq 0) { break }',
    '  Start-Sleep -Milliseconds 200',
    '}',
    'foreach ($p in (Get-AgyOrigRemaining)) {',
    '  Stop-Process -Id $p.Id -Force',
    '}',
    '$waitDead = (Get-Date).AddMilliseconds(3000)',
    'while ((Get-Date) -lt $waitDead) {',
    '  if ((Get-AgyOrigRemaining).Count -eq 0) { break }',
    '  Start-Sleep -Milliseconds 180',
    '}',
    'Start-Sleep -Milliseconds 400',
    'Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:NODE_OPTIONS,Env:ANTIGRAVITY_LS_ADDRESS,Env:ANTIGRAVITY_CSRF_TOKEN,Env:ANTIGRAVITY_AGENTAPI_EXE -ErrorAction SilentlyContinue',
    "Get-ChildItem Env:ANTIGRAVITY_SIDECAR_* -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item ('Env:' + $_.Name) -ErrorAction SilentlyContinue }",
    `$argLine = ${psSingleQuote(launchArgLine)}`,
    'if ($argLine) {',
    '  Start-Process -FilePath $target -ArgumentList $argLine -WorkingDirectory $targetDir',
    '} else {',
    '  Start-Process -FilePath $target -WorkingDirectory $targetDir',
    '}',
    'Start-Sleep -Milliseconds 1200',
    'if ((Get-AgyTargetProcs).Count -eq 0) {',
    '  try {',
    "    $sw = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
    '    $h = 0; $d = $sw.FindWindowSW(0, 0, 8, [ref]$h, 1)',
    "    if ($d -and $d.Document -and $d.Document.Application) { $d.Document.Application.ShellExecute($target, $argLine, $targetDir, 'open', 1) }",
    '  } catch {}',
    '}'
  ].join('\r\n');
}

export function buildWinDetachedDispatchScript(workerEncoded) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$psExe = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "if (-not (Test-Path -LiteralPath $psExe)) { $psExe = 'powershell.exe' }",
    `$rawWorker = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String(${psSingleQuote(workerEncoded)}))`,
    "$workerPath = Join-Path $env:TEMP ('prism-relaunch-' + [Guid]::NewGuid().ToString('N').Substring(0, 12) + '.ps1')",
    "$wrapped = \"try {`r`n\" + $rawWorker + \"`r`n} finally {`r`n  Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue`r`n}\"",
    "[System.IO.File]::WriteAllText($workerPath, $wrapped, (New-Object System.Text.UTF8Encoding($true)))",
    "$psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"' + $workerPath + '\"'",
    "$method = ''",
    'try {',
    "  $sw = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
    '  $hwnd = 0',
    '  $disp = $sw.FindWindowSW(0, 0, 8, [ref]$hwnd, 1)',
    '  if ($disp -and $disp.Document -and $disp.Document.Application) {',
    "    $disp.Document.Application.ShellExecute($psExe, $psArgs, '', 'open', 0)",
    "    $method = 'explorer'",
    '  }',
    '} catch {}',
    'if (-not $method) {',
    '  $psi = New-Object System.Diagnostics.ProcessStartInfo($psExe, $psArgs)',
    '  $psi.UseShellExecute = $false',
    '  $psi.CreateNoWindow = $true',
    '  [void][System.Diagnostics.Process]::Start($psi)',
    "  $method = 'start-process'",
    '}',
    'Write-Output (ConvertTo-Json -Compress @{ ok = $true; method = $method })'
  ].join('\r\n');
}

export function resolveLocalAntigravityTarget({
  platform = process.platform,
  isWsl = detectIsWsl({ platform }),
  homeDir = os.homedir(),
  env = process.env,
  runCmd = defaultRunCmd,
  existsSync = fs.existsSync
} = {}) {
  const antiClaudeLocal = existsSync(path.join(homeDir, '.gemini', 'antigravity', 'anti-claude'));

  if (platform === 'win32' || isWsl) {
    const psExe = resolvePowerShellExe(isWsl);
    const execCwd = resolveSafeExecCwd({ isWsl, platform, homeDir });
    const execEnv = resolveWslInteropEnv(env, isWsl);
    const res = runCmd(
      psExe,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', PS_PROBE_TARGET_ENCODED],
      { timeoutMs: 10000, cwd: execCwd, env: execEnv }
    );
    if (res.status !== 0) {
      throw new Error(`探测 Antigravity 安装路径失败: ${cleanPowerShellError(res.stderr, res.stdout, res.status, res.signal)}`);
    }
    const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
    const parsed = JSON.parse(line);
    const targetPath = String(parsed.targetPath || '').trim();
    if (!targetPath) {
      return { found: false, targetPath: '', preserveDebugPort: false, debugPort: '', launchArgs: [] };
    }
    const preserveDebugPort = Boolean(parsed.hasDebug || parsed.hasAntiClaude || antiClaudeLocal);
    const debugPort = typeof parsed.debugPort === 'string' ? parsed.debugPort.trim() : '';
    const debugFlag = normalizeDebugPortFlag(debugPort);
    return {
      found: true,
      targetPath,
      preserveDebugPort,
      debugPort,
      launchArgs: preserveDebugPort ? [debugFlag] : []
    };
  }

  if (platform === 'darwin') {
    for (const candidate of ['/Applications/Antigravity.app', path.join(homeDir, 'Applications', 'Antigravity.app')]) {
      if (existsSync(candidate)) {
        return {
          found: true,
          targetPath: candidate,
          preserveDebugPort: antiClaudeLocal,
          debugPort: '',
          launchArgs: antiClaudeLocal ? ['--remote-debugging-port=0'] : []
        };
      }
    }
    return { found: false, targetPath: '', preserveDebugPort: false, debugPort: '', launchArgs: [] };
  }

  if (platform === 'linux') {
    const cands = [
      env?.APPIMAGE,
      '/usr/share/antigravity/antigravity',
      '/opt/Antigravity/antigravity',
      '/usr/bin/antigravity'
    ].filter(Boolean);
    for (const candidate of cands) {
      if (existsSync(candidate)) {
        return {
          found: true,
          targetPath: candidate,
          preserveDebugPort: antiClaudeLocal,
          debugPort: '',
          launchArgs: antiClaudeLocal ? ['--remote-debugging-port=0'] : []
        };
      }
    }
    return { found: false, targetPath: '', preserveDebugPort: false, debugPort: '', launchArgs: [] };
  }

  return { found: false, targetPath: '', preserveDebugPort: false, debugPort: '', launchArgs: [] };
}

export function createClientRelauncher(options = {}) {
  const platform = options.platform || process.platform;
  const isWsl = options.isWsl !== undefined ? Boolean(options.isWsl) : detectIsWsl({ platform });
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const env = options.env || process.env;
  const runCmd = options.runCmd || defaultRunCmd;
  const spawnDetached = options.spawnDetached || defaultSpawnDetached;
  const existsSync = options.existsSync || fs.existsSync;

  function scheduleRelaunch({ dryRun = false, delayMs = 650 } = {}) {
    let targetInfo;
    try {
      targetInfo = resolveLocalAntigravityTarget({ platform, isWsl, homeDir, env, runCmd, existsSync });
    } catch (err) {
      return { ok: false, code: 'CLIENT_PROBE_FAILED', error: String(err?.message || err) };
    }

    if (!targetInfo.found || !targetInfo.targetPath) {
      return {
        ok: false,
        code: 'CLIENT_NOT_FOUND',
        error: '未检测到本机 Antigravity 可执行文件，请手动重启客户端生效'
      };
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        scheduled: false,
        platform,
        isWsl,
        targetPath: targetInfo.targetPath,
        launchArgs: targetInfo.launchArgs,
        preserveDebugPort: targetInfo.preserveDebugPort
      };
    }

    if (platform === 'win32' || isWsl) {
      const workerScript = buildWinRelaunchWorkerScript({
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        debugPort: targetInfo.debugPort || '',
        delayMs
      });
      const workerEncoded = Buffer.from(workerScript, 'utf16le').toString('base64');
      const dispatchScript = buildWinDetachedDispatchScript(workerEncoded);
      const dispatchEncoded = Buffer.from(dispatchScript, 'utf16le').toString('base64');
      const psExe = resolvePowerShellExe(isWsl);
      const execCwd = resolveSafeExecCwd({ isWsl, platform, homeDir });
      const execEnv = resolveWslInteropEnv(env, isWsl);

      const res = runCmd(
        psExe,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', dispatchEncoded],
        { timeoutMs: 15000, cwd: execCwd, env: execEnv }
      );
      if (res.status !== 0) {
        return {
          ok: false,
          code: 'RELAUNCH_DISPATCH_FAILED',
          error: `拉起重启进程失败: ${cleanPowerShellError(res.stderr, res.stdout, res.status, res.signal)}`
        };
      }
      let method = 'powershell';
      try {
        const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
        const parsed = JSON.parse(line);
        if (parsed?.method) method = String(parsed.method);
      } catch {}
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method,
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已脱离进程树调度 Antigravity 重启，客户端将在 1 秒内关闭并自动重开…'
      };
    }

    const delaySec = (Math.max(250, Math.min(5000, Number(delayMs) || 650)) / 1000).toFixed(2);
    const unixDebugFlag = normalizeDebugPortFlag(targetInfo.debugPort);
    const finalArgs = targetInfo.preserveDebugPort ? [unixDebugFlag] : [];
    if (platform === 'darwin') {
      const macOpenArgs = targetInfo.preserveDebugPort
        ? ['-n', '-a', targetInfo.targetPath, '--args', ...finalArgs]
        : ['-n', '-a', targetInfo.targetPath];
      const script = [
        `sleep ${delaySec}`,
        'osascript -e \'tell application "Antigravity" to quit\' >/dev/null 2>&1 || true',
        'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do pgrep -x Antigravity >/dev/null 2>&1 || break; sleep 0.3; done',
        'pkill -x Antigravity >/dev/null 2>&1 || true',
        'sleep 0.5',
        'open "$@"'
      ].join('; ');
      spawnDetached('/bin/sh', ['-c', script, '--', ...macOpenArgs], { cwd: homeDir });
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method: 'macos-open',
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已调度 Antigravity 自动重启…'
      };
    }

    if (platform === 'linux') {
      const script = [
        `sleep ${delaySec}`,
        'pkill -TERM -x antigravity >/dev/null 2>&1 || true',
        'sleep 0.8; exec "$@" >/dev/null 2>&1 &'
      ].join('; ');
      spawnDetached('/bin/sh', ['-c', script, '--', targetInfo.targetPath, ...finalArgs], { cwd: homeDir });
      return {
        ok: true,
        dryRun: false,
        scheduled: true,
        method: 'linux-nohup',
        targetPath: targetInfo.targetPath,
        preserveDebugPort: targetInfo.preserveDebugPort,
        message: '已调度 Antigravity 自动重启…'
      };
    }

    return { ok: false, code: 'UNSUPPORTED_PLATFORM', error: `当前平台暂不支持自动重启: ${platform}` };
  }

  return {
    resolveTarget: () => resolveLocalAntigravityTarget({ platform, isWsl, homeDir, env, runCmd, existsSync }),
    scheduleRelaunch
  };
}
