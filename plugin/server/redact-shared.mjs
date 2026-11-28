// SPDX-License-Identifier: MIT
/**
 * Shared secret redaction & sensitive path classification utilities
 * for Anti-Claude Prism Suite (zero external dependencies).
 */
import fs from 'node:fs';
import path from 'node:path';

const NON_SECRET_TOKEN_KEY_RE =
  /(?:^|[_.-])(?:max|min|total|input|output|prompt|completion|cached|reasoning)[_-]?tokens?$|^token[_-]?(?:unit|count|limit|budget|type|uri)s?$/i;

const SENSITIVE_KEY_ASSIGNMENT_RE =
  /((["'])?\b([A-Za-z0-9_.-]*(?:aws_secret_access_key|x-goog-api-key|x-api-key|api[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|password|passwd|pwd|secret|token))\b\2?[ \t]*[:=][ \t]*)("([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s,;'"`}\]]+)/gi;

/**
 * Comprehensively redacts credentials, tokens, private keys, auth headers,
 * URL userinfo, and secret assignments from arbitrary text/JSON/logs.
 */
export function redactSensitiveText(input) {
  let out = String(input ?? '');
  if (!out) return '';

  // 1. PEM / OpenPGP private keys (complete or truncated)
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // 2. URL embedded credentials: scheme://user:pass@host -> scheme://[REDACTED_AUTH]@host
  out = out.replace(
    /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@'"`]+(?::[^/\s@'"`]*)?)@(?=[A-Za-z0-9.-]|\[)/g,
    '$1[REDACTED_AUTH]@'
  );

  // 3. HTTP Cookie / Set-Cookie headers
  out = out.replace(/\b((?:Set-)?Cookie[ \t]*:[ \t]*)[^\r\n]+/gi, '$1[REDACTED_COOKIE]');

  // 4. Explicit API key headers (x-goog-api-key / x-api-key)
  out = out.replace(
    /\b((?:x-goog-api-key|x-api-key)[ \t]*:[ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;'"`}\]]+)/gi,
    '$1[REDACTED_API_KEY]'
  );

  // 5. HTTP Basic & Bearer authorization schemes (lookahead preserves trailing '=' padding consumption)
  out = out.replace(/\b(Basic[ \t]+)[A-Za-z0-9+/=]{8,}(?![A-Za-z0-9+/=])/gi, '$1[REDACTED_BASIC_AUTH]');
  out = out.replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{8,}(?![A-Za-z0-9._~+/=-])/gi, '$1[REDACTED_TOKEN]');

  // 6. AWS Access Key IDs & aws_secret_access_key
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  out = out.replace(
    /\b(aws_secret_access_key[ \t]*[:=][ \t]*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;'"`}\]]+)/gi,
    '$1[REDACTED_AWS_SECRET]'
  );

  // 7. JWT (3-segment base64url starting with eyJ)
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]');

  // 8. Google OAuth access/refresh tokens & Google API keys
  out = out.replace(/\bya29\.[A-Za-z0-9._-]{20,}/g, '[REDACTED_GOOGLE_OAUTH]');
  out = out.replace(/(?<![A-Za-z0-9/])1\/\/0[A-Za-z0-9_-]{20,}/g, '[REDACTED_GOOGLE_REFRESH_TOKEN]');
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');

  // 9. GitHub classic & fine-grained PATs
  out = out.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GH_TOKEN]');

  // 10. OpenAI / Anthropic / OpenRouter / Stripe / HuggingFace / Slack tokens
  out = out.replace(/\bsk-(?:proj-|ant-|live-|test-|or-v1-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_API_KEY]');
  out = out.replace(/\b[rs]k_(?:live|test)_[A-Za-z0-9]{12,}\b/g, '[REDACTED_STRIPE_KEY]');
  out = out.replace(/\bhf_[A-Za-z0-9]{16,}\b/g, '[REDACTED_HF_TOKEN]');
  out = out.replace(/\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]');

  // 11. JSON / YAML / ENV / INI / CLI credential assignments
  out = out.replace(
    SENSITIVE_KEY_ASSIGNMENT_RE,
    (full, prefix, _keyQuote, keyName, rawVal, dqInner, sqInner) => {
      if (NON_SECRET_TOKEN_KEY_RE.test(keyName)) {
        return full;
      }
      const inner = dqInner !== undefined ? dqInner : (sqInner !== undefined ? sqInner : rawVal);
      const trimmedInner = String(inner ?? '').trim();
      if (
        !trimmedInner ||
        /^(?:null|true|false|undefined|\d+)$/i.test(trimmedInner) ||
        trimmedInner.startsWith('[REDACTED')
      ) {
        return full;
      }
      if (dqInner !== undefined) return `${prefix}"[REDACTED]"`;
      if (sqInner !== undefined) return `${prefix}'[REDACTED]'`;
      return `${prefix}[REDACTED]`;
    }
  );

  return out;
}

const SENSITIVE_DIR_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.codex',
  '.claude',
  '.cc-switch',
  '.kube',
  '.docker',
  '.azure'
]);

const SENSITIVE_SHORTNAME_SEG_RE =
  /^(?:ssh|aws|gnupg|codex|claude|cc-swi|kube|docker|azure|gcloud)~\d+(?:\..+)?$/i;

const SENSITIVE_READ_BASENAME_RE =
  /^(?:\.env(?:\..+)?|\.envrc|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|\.my\.cnf|oauth_creds\.json|google_accounts\.json|auth\.json|credentials\.json|cc-switch\.db|prism-profile\.json|cua-broker\.json|cua-vault\.dpapi|cua-vault\.json|handoff-memory\.sqlite(?:-wal|-shm|-journal)?|handoff-catalog\.json|handoff-memories\.jsonl|handoff-snapshot\.json|jetski-standalone-oauth-token|credential-user-scope|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|.*\.tfstate(?:\..+)?|.*\.(?:pem|key|p12|pfx|kdbx|dpapi))$/i;

const WRITE_ONLY_BLOCKED_BASENAMES = new Set([
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  'microsoft.powershell_profile.ps1',
  'mcp_config.json',
  '.mcp.json'
]);

const PRISM_PROTECTED_FILES = new Set([
  'accounts.json',
  'switch.lock',
  'handoff-memories.jsonl',
  'handoff-memories.lock',
  'handoff-memory.sqlite',
  'handoff-memory.sqlite-wal',
  'handoff-memory.sqlite-shm',
  'handoff-memory.sqlite-journal',
  'handoff-catalog.json',
  'handoff-snapshot.json',
  'upstream-cache.json',
  'prism-profile.json',
  'cua-broker.json',
  'cua-vault.dpapi',
  'cua-vault.json',
  'cua-settings.json',
  'ui-prefs.json'
]);

function isUncString(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const trimmed = rawPath.trim();
  return trimmed.startsWith('\\\\') || trimmed.startsWith('//');
}

export function safeRealpathSync(targetPath) {
  if (typeof fs.realpathSync?.native === 'function') {
    try {
      return fs.realpathSync.native(targetPath);
    } catch {}
  }
  return fs.realpathSync(targetPath);
}

export function realpathNearestSafe(targetPath) {
  const abs = path.resolve(String(targetPath || ''));
  try {
    return safeRealpathSync(abs);
  } catch {}
  const missingSegments = [];
  let cur = abs;
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      try {
        const realRoot = safeRealpathSync(cur);
        return missingSegments.length ? path.join(realRoot, ...missingSegments.reverse()) : realRoot;
      } catch {
        return abs;
      }
    }
    missingSegments.push(path.basename(cur));
    cur = parent;
    try {
      const realAncestor = safeRealpathSync(cur);
      return path.join(realAncestor, ...missingSegments.reverse());
    } catch {}
  }
}

function checkLexicalSensitivePath(normPath, forWrite = false) {
  const normWithoutDrive = normPath.replace(/^[A-Za-z]:/, '');
  if (normWithoutDrive.includes(':')) return true;

  const rawParts = normPath.split(/[\\/]+/).filter(Boolean);
  const cleanSegments = [];

  for (const seg of rawParts) {
    if (seg === '.' || seg === '..') continue;
    const cleanSeg = seg.replace(/:.*$/, '').replace(/[. ]+$/, '');
    if (!cleanSeg) continue;
    const lowerSeg = cleanSeg.toLowerCase();

    if (SENSITIVE_DIR_SEGMENTS.has(lowerSeg)) return true;
    if (SENSITIVE_SHORTNAME_SEG_RE.test(cleanSeg)) return true;

    const prevLower = cleanSegments.length > 0 ? cleanSegments[cleanSegments.length - 1].lower : '';
    if (prevLower === '.config' && (lowerSeg === 'gcloud' || lowerSeg === 'gh')) {
      return true;
    }
    if (forWrite) {
      if (lowerSeg === 'startup') return true;
      if (prevLower === '.git' && lowerSeg === 'hooks') return true;
    }

    cleanSegments.push({ clean: cleanSeg, lower: lowerSeg });
  }

  if (cleanSegments.length === 0) return false;
  const last = cleanSegments[cleanSegments.length - 1];
  const parentLower = cleanSegments.length >= 2 ? cleanSegments[cleanSegments.length - 2].lower : '';

  if (parentLower === 'prism-suite' && PRISM_PROTECTED_FILES.has(last.lower)) {
    return true;
  }
  if (SENSITIVE_READ_BASENAME_RE.test(last.clean)) {
    return true;
  }
  if (forWrite && WRITE_ONLY_BLOCKED_BASENAMES.has(last.lower)) {
    return true;
  }
  return false;
}

export function isSensitiveFilePath(rawPath, { forWrite = false } = {}) {
  const raw = String(rawPath || '');
  const trimmedStart = raw.trimStart();
  if (!trimmedStart.trim()) return false;

  // Block Windows NTFS Alternate Data Streams (any colon outside leading drive prefix ^[A-Za-z]:)
  const withoutDrivePrefix = trimmedStart.replace(/^[A-Za-z]:/, '');
  if (withoutDrivePrefix.includes(':')) return true;

  const isUnc = isUncString(trimmedStart);
  const isWinDrivePath = /^[A-Za-z]:/.test(trimmedStart);
  const norm = (isUnc || (isWinDrivePath && process.platform !== 'win32'))
    ? trimmedStart
    : path.resolve(trimmedStart);

  if (checkLexicalSensitivePath(norm, forWrite)) {
    return true;
  }

  // Never touch fs/realpath on UNC paths (avoids NTLM/SMB network packets) or foreign-OS drive strings
  if (!isUnc && !(isWinDrivePath && process.platform !== 'win32')) {
    try {
      const resolvedReal = realpathNearestSafe(norm);
      if (resolvedReal && resolvedReal !== norm && checkLexicalSensitivePath(resolvedReal, forWrite)) {
        return true;
      }
    } catch {}
  }

  return false;
}
