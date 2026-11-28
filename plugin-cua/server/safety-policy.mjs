// SPDX-License-Identifier: MIT
/**
 * Hard safety guardrails, credential redaction, and CAPTCHA/challenge detection
 * for Prism Computer-Use (plugin-cua).
 *
 * Security invariants:
 * - Zero external dependencies (Node.js >= 22 built-in modules only).
 * - Hard-blocks self window (Antigravity.exe), OS credential/UAC brokers,
 *   password managers, Registry Editor, and sensitive configuration paths.
 * - Redacts password/payment fields in observation trees and blocks actions
 *   targeting them by @ref or bounding-box coordinates.
 * - Detects CAPTCHA / anti-bot challenges for immediate PAUSED_HANDOFF.
 */

export const SAFETY_CODES = Object.freeze({
  OK: 'OK',
  SELF_WINDOW_BLOCKED: 'SELF_WINDOW_BLOCKED',
  SYSTEM_SECURITY_WINDOW_BLOCKED: 'SYSTEM_SECURITY_WINDOW_BLOCKED',
  UIPI_PROTECTED_WINDOW_BLOCKED: 'UIPI_PROTECTED_WINDOW_BLOCKED',
  PASSWORD_MANAGER_BLOCKED: 'PASSWORD_MANAGER_BLOCKED',
  REGISTRY_EDITOR_BLOCKED: 'REGISTRY_EDITOR_BLOCKED',
  SENSITIVE_PATH_BLOCKED: 'SENSITIVE_PATH_BLOCKED',
  INVALID_URL: 'INVALID_URL',
  INTERNAL_BROWSER_URL_BLOCKED: 'INTERNAL_BROWSER_URL_BLOCKED',
  SENSITIVE_FILE_URL_BLOCKED: 'SENSITIVE_FILE_URL_BLOCKED',
  PASSWORD_SETTINGS_URL_BLOCKED: 'PASSWORD_SETTINGS_URL_BLOCKED',
  PAYMENT_CHECKOUT_URL_BLOCKED: 'PAYMENT_CHECKOUT_URL_BLOCKED',
  PASSWORD_FIELD_BLOCKED: 'PASSWORD_FIELD_BLOCKED',
  DANGEROUS_KEY_COMBO_BLOCKED: 'DANGEROUS_KEY_COMBO_BLOCKED',
  FORBIDDEN_OPERATION_BLOCKED: 'FORBIDDEN_OPERATION_BLOCKED',
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED'
});

const SELF_PROCESS_NAMES = new Set([
  'antigravity',
  'antigravity.exe'
]);

const SYSTEM_SECURITY_PROCESSES = new Set([
  'credentialuibroker',
  'credentialuibroker.exe',
  'consent',
  'consent.exe',
  'lsass',
  'lsass.exe',
  'logonui',
  'logonui.exe',
  'winlogon',
  'winlogon.exe',
  'csrss',
  'csrss.exe',
  'useraccountcontrolsettings',
  'useraccountcontrolsettings.exe'
]);

const PASSWORD_MANAGER_TOKENS = [
  '1password',
  'bitwarden',
  'keepassxc',
  'keepass',
  'enpass',
  'lastpass',
  'dashlane',
  'roboform',
  'protonpass'
];

const REGISTRY_PROCESSES = new Set([
  'regedit',
  'regedit.exe',
  'regedt32',
  'regedt32.exe'
]);

const SYSTEM_SHELL_PROCESSES = new Set([
  'explorer',
  'explorer.exe',
  'searchhost',
  'searchhost.exe',
  'shellexperiencehost',
  'shellexperiencehost.exe',
  'startmenuexperiencehost',
  'startmenuexperiencehost.exe',
  'taskmgr',
  'taskmgr.exe',
  'dwm',
  'dwm.exe'
]);

const SYSTEM_SHELL_CLASSES = new Set([
  'progman',
  'workerw',
  'shell_traywnd',
  'shell_secondarytraywnd',
  'dv2controlhost'
]);

const SENSITIVE_DOT_DIRS = [
  '.codex',
  '.claude',
  '.cc-switch',
  '.ssh',
  '.gnupg',
  '.aws'
];

const SENSITIVE_FILENAMES = [
  'cc-switch.db',
  'prism-profile.json',
  'cua-broker.json',
  'account-vault.json',
  'id_rsa',
  'id_ed25519',
  'authorized_keys',
  'known_hosts'
];

const SENSITIVE_DOT_DIR_RE = new RegExp(
  `(?:^|[\\s/\\\\'"(\\[=:;,])(${SENSITIVE_DOT_DIRS.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:$|[\\s/\\\\'")\\],:;?&#])`,
  'i'
);

const SENSITIVE_FILENAME_RE = new RegExp(
  `(?:^|[\\s/\\\\'"(\\[=:;,])(${SENSITIVE_FILENAMES.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:$|[\\s/\\\\'")\\],:;?&#])`,
  'i'
);

const CREDENTIAL_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'password',
  'cc-number',
  'cc-csc',
  'cc-cvc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year'
]);

const BLOCKED_URL_SCHEMES = new Set([
  'chrome:',
  'edge:',
  'brave:',
  'vivaldi:',
  'opera:',
  'devtools:',
  'chrome-extension:',
  'moz-extension:',
  'extension:',
  'view-source:',
  'javascript:',
  'data:',
  'vbscript:'
]);

const PASSWORD_SETTINGS_HOSTS = new Set([
  'passwords.google.com',
  'vault.bitwarden.com',
  'my.1password.com',
  'start.1password.com',
  'lastpass.com',
  'www.lastpass.com'
]);

const PASSWORD_SETTINGS_PATH_RE = /\/(?:settings\/passwords|password-manager|security\/passwords|account\/password|change-password|reset-password)(?:\/|$|\?|#)/i;

const PAYMENT_CHECKOUT_HOSTS = new Set([
  'checkout.stripe.com',
  'js.stripe.com',
  'pay.google.com',
  'cashier.alipay.com',
  'excashier.alipay.com',
  'pay.weixin.qq.com'
]);

const PAYMENT_CHECKOUT_PATH_RE = /\/(?:checkoutnow|checkout\/payment|payment\/checkout|payment\/card|credit-card|card-verification|3ds|3d-secure|online-banking|ebank|netbank)(?:\/|$|\?|#)/i;

const PASSIVE_RECAPTCHA_FOOTER_RE =
  /(?:this\s+site\s+is\s+)?protected\s+by\s+(?:google\s+)?recaptcha(?:\s+and\s+the\s+google\b[^.\n]{0,180})?|受\s*recaptcha\s*保护[^。\n]{0,90}|recaptcha\s*(?:privacy\s*policy|terms\s*of\s*service|隐私权?政策|服务条款)|grecaptcha-badge/gi;

const CAPTCHA_RULES = [
  {
    kind: 'cloudflare_turnstile',
    re: /challenges\.cloudflare\.com|cf-turnstile|cloudflare\s+turnstile|\bturnstile\b/i,
    reason: '检测到 Cloudflare Turnstile 人机验证组件'
  },
  {
    kind: 'recaptcha',
    re: /(?:google\.com|recaptcha\.net)\/recaptcha|\bg-recaptcha\b|\brecaptcha\b/i,
    reason: '检测到 Google reCAPTCHA 验证组件'
  },
  {
    kind: 'hcaptcha',
    re: /hcaptcha\.com|\bh-captcha\b|\bhcaptcha\b/i,
    reason: '检测到 hCaptcha 验证组件'
  },
  {
    kind: 'altcha',
    re: /\baltcha-widget\b|\baltcha\b/i,
    reason: '检测到 Altcha 验证组件'
  },
  {
    kind: 'geetest',
    re: /\bgeetest\b|\bgt_slider\b|极验/i,
    reason: '检测到 Geetest（极验）行为验证组件'
  },
  {
    kind: 'human_verification',
    re: /verify\s+(?:that\s+)?you\s+are\s+human|confirm\s+you\s+are\s+human|are\s+you\s+a\s+(?:human|robot)|i['’]?m\s+not\s+a\s+robot|i\s+am\s+not\s+a\s+robot|complete\s+the\s+security\s+check|人机身份验证|人机验证|请完成安全验证|拖动滑块/i,
    reason: '检测到人机身份验证或滑块挑战提示'
  }
];

function extractBaseProcessName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/^"+|"+$/g, '');
  if (!trimmed) return '';
  const parts = trimmed.split(/[/\\]/);
  return (parts[parts.length - 1] || '').trim().toLowerCase();
}

function findSensitiveToken(text) {
  if (!text || typeof text !== 'string') return null;
  const dirMatch = text.match(SENSITIVE_DOT_DIR_RE);
  if (dirMatch) return dirMatch[1];
  const fileMatch = text.match(SENSITIVE_FILENAME_RE);
  if (fileMatch) return fileMatch[1];
  return null;
}

function safeDecodeUri(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Evaluates whether a desktop window is safe to observe or control.
 */
export function evaluateWindowSafety(winInfo) {
  if (!winInfo) {
    return { allowed: true, code: SAFETY_CODES.OK };
  }

  const normalized = typeof winInfo === 'string'
    ? { title: winInfo, processName: winInfo }
    : winInfo;

  if (typeof normalized !== 'object') {
    return { allowed: true, code: SAFETY_CODES.OK };
  }

  const rawProc = String(
    normalized.processName ??
    normalized.process ??
    normalized.imageName ??
    normalized.exe ??
    normalized.executable ??
    normalized.exePath ??
    normalized.appName ??
    ''
  );
  const procBase = extractBaseProcessName(rawProc);
  const procNoExt = procBase.endsWith('.exe') ? procBase.slice(0, -4) : procBase;

  const title = String(
    normalized.title ??
    normalized.windowTitle ??
    normalized.name ??
    ''
  );
  const className = String(normalized.className ?? normalized.windowClass ?? '');
  const extraPaths = [
    normalized.path,
    normalized.exePath,
    normalized.workingDir,
    normalized.commandLine,
    normalized.filePath
  ]
    .filter((v) => typeof v === 'string' && v.length > 0)
    .join(' | ');

  if (
    SELF_PROCESS_NAMES.has(procBase) ||
    SELF_PROCESS_NAMES.has(procNoExt) ||
    /(?:^|[/\\])antigravity(?:\.exe)?$/i.test(rawProc.trim())
  ) {
    return {
      allowed: false,
      code: SAFETY_CODES.SELF_WINDOW_BLOCKED,
      reason: '禁止观察或操控 Antigravity 自身客户端窗口（SELF_WINDOW_BLOCKED）'
    };
  }

  if (
    SYSTEM_SECURITY_PROCESSES.has(procBase) ||
    SYSTEM_SECURITY_PROCESSES.has(procNoExt)
  ) {
    return {
      allowed: false,
      code: SAFETY_CODES.SYSTEM_SECURITY_WINDOW_BLOCKED,
      reason: `禁止触碰系统安全或凭据提权进程 (${procBase || rawProc})`
    };
  }

  if (normalized.uipiProtected === true || normalized.isUacDialog === true) {
    return {
      allowed: false,
      code: SAFETY_CODES.UIPI_PROTECTED_WINDOW_BLOCKED,
      reason: '目标窗口受 UIPI / UAC 高完整性保护，已拦截自动化访问'
    };
  }

  if (
    REGISTRY_PROCESSES.has(procBase) ||
    REGISTRY_PROCESSES.has(procNoExt) ||
    /^(?:registry editor|注册表编辑器)$/i.test(title.trim())
  ) {
    return {
      allowed: false,
      code: SAFETY_CODES.REGISTRY_EDITOR_BLOCKED,
      reason: '禁止观察或操作 Windows 注册表编辑器 (regedit)'
    };
  }

  for (const pm of PASSWORD_MANAGER_TOKENS) {
    if (procBase.includes(pm) || procNoExt.includes(pm)) {
      return {
        allowed: false,
        code: SAFETY_CODES.PASSWORD_MANAGER_BLOCKED,
        reason: `禁止观察或操作密码管理器进程 (${pm})`
      };
    }
    const pmTitleRe = new RegExp(`\\b${pm}\\b`, 'i');
    if (pmTitleRe.test(title)) {
      return {
        allowed: false,
        code: SAFETY_CODES.PASSWORD_MANAGER_BLOCKED,
        reason: `禁止观察或操作密码管理器窗口 (${pm})`
      };
    }
  }

  const combinedMeta = `${title}\n${rawProc}\n${className}\n${extraPaths}`;
  const hitSensitive = findSensitiveToken(combinedMeta);
  if (hitSensitive) {
    return {
      allowed: false,
      code: SAFETY_CODES.SENSITIVE_PATH_BLOCKED,
      reason: `目标窗口标题或路径涉及受保护配置/密钥区 (${hitSensitive})`
    };
  }

  return { allowed: true, code: SAFETY_CODES.OK };
}

/**
 * Evaluates whether a browser/tab URL is safe to observe or act upon.
 */
export function evaluateUrlSafety(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      allowed: false,
      code: SAFETY_CODES.INVALID_URL,
      reason: 'URL 不能为空'
    };
  }

  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();
  const isReadOnly =
    options.readOnly !== false &&
    options.mode !== 'act' &&
    options.needAct !== true;

  if (lower.startsWith('about:')) {
    const rest = lower.slice('about:'.length).split('#')[0].split('?')[0];
    if (rest === 'blank') {
      if (isReadOnly) {
        return { allowed: true, code: SAFETY_CODES.OK, readOnlyOnly: true };
      }
      return {
        allowed: false,
        code: SAFETY_CODES.INTERNAL_BROWSER_URL_BLOCKED,
        reason: 'about:blank 仅允许只读观察，禁止执行操控动作'
      };
    }
    return {
      allowed: false,
      code: SAFETY_CODES.INTERNAL_BROWSER_URL_BLOCKED,
      reason: `禁止访问浏览器内部页面 (${trimmed.slice(0, 64)})`
    };
  }

  if (lower.startsWith('view-source:') || lower.startsWith('blob:chrome-extension:')) {
    return {
      allowed: false,
      code: SAFETY_CODES.INTERNAL_BROWSER_URL_BLOCKED,
      reason: '禁止访问浏览器内部或扩展源视图 URL'
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      allowed: false,
      code: SAFETY_CODES.INVALID_URL,
      reason: 'URL 格式非法'
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_URL_SCHEMES.has(protocol)) {
    return {
      allowed: false,
      code: SAFETY_CODES.INTERNAL_BROWSER_URL_BLOCKED,
      reason: `禁止访问受保护协议页面 (${protocol}//*)`
    };
  }

  const decodedUrl = safeDecodeUri(trimmed);
  const sensitiveHit = findSensitiveToken(decodedUrl);
  if (sensitiveHit) {
    return {
      allowed: false,
      code: protocol === 'file:'
        ? SAFETY_CODES.SENSITIVE_FILE_URL_BLOCKED
        : SAFETY_CODES.SENSITIVE_PATH_BLOCKED,
      reason: `禁止访问涉及敏感凭据或配置路径的 URL (${sensitiveHit})`
    };
  }

  if (protocol === 'file:') {
    const lowerFile = decodedUrl.toLowerCase().replace(/\\/g, '/');
    if (
      /\/(?:etc\/shadow|etc\/gshadow|etc\/sudoers|system32\/config|appdata\/local\/(?:google\/chrome|microsoft\/edge|brave)\/user data|login data|key4\.db|cookies\.sqlite)(?:\/|$)/i.test(lowerFile) ||
      /\.(?:pem|key|pfx|p12|kdbx)(?:$|\?|#)/i.test(lowerFile)
    ) {
      return {
        allowed: false,
        code: SAFETY_CODES.SENSITIVE_FILE_URL_BLOCKED,
        reason: '禁止通过 file:// 访问系统凭据库、浏览器配置库或私钥文件'
      };
    }
    return { allowed: true, code: SAFETY_CODES.OK };
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      allowed: false,
      code: SAFETY_CODES.INTERNAL_BROWSER_URL_BLOCKED,
      reason: `不支持的浏览器 URL 协议 (${protocol})`
    };
  }

  const host = parsed.hostname.toLowerCase();
  const fullPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  if (PASSWORD_SETTINGS_HOSTS.has(host) || PASSWORD_SETTINGS_PATH_RE.test(fullPath)) {
    return {
      allowed: false,
      code: SAFETY_CODES.PASSWORD_SETTINGS_URL_BLOCKED,
      reason: `禁止访问密码管理器或账号密码设置页 (${host})`
    };
  }

  if (
    PAYMENT_CHECKOUT_HOSTS.has(host) ||
    PAYMENT_CHECKOUT_PATH_RE.test(fullPath) ||
    (host.endsWith('.paypal.com') && /\/(?:checkoutnow|signin|cgi-bin\/webscr)/i.test(fullPath))
  ) {
    return {
      allowed: false,
      code: SAFETY_CODES.PAYMENT_CHECKOUT_URL_BLOCKED,
      reason: `禁止在网银或收银台支付凭据页执行自动化 (${host})`
    };
  }

  return { allowed: true, code: SAFETY_CODES.OK };
}

const SENSITIVE_FIELD_TOKEN_RE =
  /\b(?:password|passwd|passcode|pwd|cvv|cvv2|cvc|cvc2|csc|ccnum|totp|otp|pincode|pin)\b/i;
const SENSITIVE_FIELD_PHRASE_RE =
  /\b(?:cc\s+(?:num|number|csc|cvc|cvv|exp)|card\s+(?:num|number|no)|credit\s+card|security\s+code|verification\s+code|one\s+time\s+(?:code|password|pin))\b/i;
const SENSITIVE_FIELD_CJK_RE =
  /(?:密码|口令|安全码|动态码|验证码|支付密码|交易密码|银行卡号|信用卡号|卡号)/;
const NON_EDITABLE_ROLES = new Set([
  'button',
  'splitbutton',
  'a',
  'link',
  'hyperlink',
  'menuitem',
  'tab',
  'tabitem',
  'checkbox',
  'radio',
  'radiobutton',
  'image',
  'img',
  'heading'
]);

function normalizeSensitiveIdentTokens(raw) {
  return String(raw ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[\[\]()_.:\-\s/\\]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Checks whether an observation element represents a password or payment-credential input.
 */
export function isCredentialOrPasswordElement(el) {
  if (!el || typeof el !== 'object') return false;
  if (
    el.isPassword === true ||
    el.IsPassword === true ||
    el.wasPassword === true ||
    el.password === true ||
    el.redacted === true ||
    el.valueRedacted !== undefined ||
    el.blockedCode === SAFETY_CODES.PASSWORD_FIELD_BLOCKED
  ) {
    return true;
  }

  const inputType = String(el.type ?? el.inputType ?? '').trim().toLowerCase();
  if (inputType === 'password') {
    return true;
  }

  const wts = String(el.webkitTextSecurity ?? el.textSecurity ?? '').trim().toLowerCase();
  if (wts && wts !== 'none') {
    return true;
  }

  const autoRaw = String(el.autocomplete ?? el.autoComplete ?? '').trim().toLowerCase();
  if (autoRaw) {
    for (const token of autoRaw.split(/\s+/)) {
      if (
        CREDENTIAL_AUTOCOMPLETE_TOKENS.has(token) ||
        token === 'one-time-code' ||
        token.startsWith('cc-')
      ) {
        return true;
      }
    }
  }

  const roleOrTag = String(el.role ?? el.controlType ?? el.tag ?? el.tagName ?? '').trim().toLowerCase();
  if (roleOrTag === 'password' || roleOrTag === 'passwordbox') {
    return true;
  }

  const isNonEditableActionControl =
    NON_EDITABLE_ROLES.has(roleOrTag) ||
    (roleOrTag === 'input' &&
      (inputType === 'button' ||
        inputType === 'submit' ||
        inputType === 'reset' ||
        inputType === 'checkbox' ||
        inputType === 'radio'));

  const isEditableCandidate =
    !isNonEditableActionControl &&
    (roleOrTag === '' ||
      el.contentEditable === true ||
      roleOrTag.includes('input') ||
      roleOrTag.includes('edit') ||
      roleOrTag.includes('textbox') ||
      roleOrTag.includes('textarea') ||
      roleOrTag.includes('combobox') ||
      roleOrTag.includes('spinbutton') ||
      roleOrTag.includes('custom') ||
      roleOrTag.includes('password'));

  if (isEditableCandidate) {
    const labelMeta = [
      el.name,
      el.label,
      el.labelText,
      el.ariaLabel,
      el.placeholder,
      el.id,
      el.automationId,
      el.title
    ]
      .filter((v) => typeof v === 'string' && v.length > 0)
      .join(' ');

    if (labelMeta) {
      const normalizedTokens = normalizeSensitiveIdentTokens(labelMeta);
      if (
        SENSITIVE_FIELD_TOKEN_RE.test(normalizedTokens) ||
        SENSITIVE_FIELD_PHRASE_RE.test(normalizedTokens) ||
        SENSITIVE_FIELD_CJK_RE.test(labelMeta)
      ) {
        return true;
      }
    }
  }

  return false;
}

function sanitizeElementNode(node) {
  if (!node || typeof node !== 'object') return node;
  const copy = { ...node };
  const sensitive = isCredentialOrPasswordElement(copy);

  if (sensitive) {
    copy.isPassword = true;
    copy.redacted = true;
    copy.blockedCode = SAFETY_CODES.PASSWORD_FIELD_BLOCKED;
    if ('value' in copy) copy.value = '[REDACTED]';
    if ('defaultValue' in copy) copy.defaultValue = '[REDACTED]';
    if ('text' in copy && copy.text) copy.text = '[REDACTED]';
    if ('innerText' in copy && copy.innerText) copy.innerText = '[REDACTED]';
  }

  if (Array.isArray(copy.children)) {
    copy.children = copy.children.map((child) => sanitizeElementNode(child));
  }
  return copy;
}

/**
 * Deeply sanitizes an observation snapshot, redacting all password/credential fields
 * and marking the payload as untrusted external screen/web data.
 */
export function sanitizeObservationTree(observation) {
  if (!observation || typeof observation !== 'object') {
    return observation;
  }

  const sanitized = {
    ...observation,
    source: 'cua',
    tainted: true
  };

  if (Array.isArray(observation.elements)) {
    sanitized.elements = observation.elements.map((el) => sanitizeElementNode(el));
  }
  if (Array.isArray(observation.nodes)) {
    sanitized.nodes = observation.nodes.map((el) => sanitizeElementNode(el));
  }
  if (observation.tree && typeof observation.tree === 'object') {
    sanitized.tree = Array.isArray(observation.tree)
      ? observation.tree.map((el) => sanitizeElementNode(el))
      : sanitizeElementNode(observation.tree);
  }

  return sanitized;
}

function collectElementsFlat(observation, out = []) {
  if (!observation || typeof observation !== 'object') return out;

  const visitList = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      out.push(item);
      if (Array.isArray(item.children)) {
        visitList(item.children);
      }
    }
  };

  visitList(observation.elements);
  visitList(observation.nodes);
  if (Array.isArray(observation.tree)) {
    visitList(observation.tree);
  } else if (observation.tree && typeof observation.tree === 'object') {
    visitList([observation.tree]);
  }
  return out;
}

function pointHitsElementBounds(x, y, el) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !el || typeof el !== 'object') {
    return false;
  }
  const rect = el.bounds ?? el.rect ?? el.boundingBox;
  if (!rect || typeof rect !== 'object') return false;

  if (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  ) {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  }
  if (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom)
  ) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  return false;
}

function isSystemShellWindow(winInfo) {
  if (!winInfo || typeof winInfo !== 'object') return false;
  if (winInfo.isSystemShell === true) return true;
  const procBase = extractBaseProcessName(
    String(winInfo.processName ?? winInfo.process ?? winInfo.exe ?? winInfo.exePath ?? '')
  );
  if (SYSTEM_SHELL_PROCESSES.has(procBase)) return true;

  const cls = String(winInfo.className ?? winInfo.windowClass ?? '').trim().toLowerCase();
  if (cls && SYSTEM_SHELL_CLASSES.has(cls)) return true;

  const title = String(winInfo.title ?? winInfo.windowTitle ?? '').trim().toLowerCase();
  if (title === 'program manager' || title === 'taskbar' || title === '任务栏') return true;
  return false;
}

function normalizeKeyCombo(rawKey) {
  if (typeof rawKey !== 'string') return '';
  const parts = rawKey
    .split(/\+|-/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const mods = new Set();
  let mainKey = '';
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'lctrl' || part === 'rctrl') {
      mods.add('ctrl');
    } else if (part === 'alt' || part === 'menu' || part === 'option' || part === 'lalt' || part === 'ralt') {
      mods.add('alt');
    } else if (part === 'shift' || part === 'lshift' || part === 'rshift') {
      mods.add('shift');
    } else if (
      part === 'win' ||
      part === 'windows' ||
      part === 'meta' ||
      part === 'super' ||
      part === 'cmd' ||
      part === 'command' ||
      part === 'lwin' ||
      part === 'rwin'
    ) {
      mods.add('win');
    } else if (part === 'delete' || part === 'del') {
      mainKey = 'del';
    } else if (part === 'escape' || part === 'esc') {
      mainKey = 'esc';
    } else {
      mainKey = part;
    }
  }

  const orderedMods = ['ctrl', 'alt', 'shift', 'win'].filter((m) => mods.has(m));
  return mainKey ? [...orderedMods, mainKey].join('+') : orderedMods.join('+');
}

/**
 * Evaluates whether a single declarative CUA action is allowed under safety guardrails.
 */
export function evaluateActionSafety(action, context = {}) {
  if (!action || typeof action !== 'object') {
    return {
      allowed: false,
      code: SAFETY_CODES.FORBIDDEN_OPERATION_BLOCKED,
      reason: '动作定义必须为非空对象'
    };
  }

  const op = String(action.op ?? '').trim();
  const forbiddenCategoryRe = /^(?:shell|exec|spawn|powershell|cmd|registry|regedit|filesystem|file_write|file_delete|process|kill_process)$/i;
  if (forbiddenCategoryRe.test(op)) {
    return {
      allowed: false,
      code: SAFETY_CODES.FORBIDDEN_OPERATION_BLOCKED,
      reason: `禁止执行越权系统类别动作 (${op})`
    };
  }

  const winContext = context.window ?? context.observation?.window ?? null;
  if (winContext) {
    const winCheck = evaluateWindowSafety(winContext);
    if (!winCheck.allowed) return winCheck;
  } else if (context.observation && (context.observation.processName || context.observation.windowTitle || context.observation.title)) {
    const winCheck = evaluateWindowSafety(context.observation);
    if (!winCheck.allowed) return winCheck;
  }

  const urlContext = context.url ?? context.observation?.url ?? '';
  if (urlContext) {
    const urlCheck = evaluateUrlSafety(urlContext, {
      mode: op === 'wait_for' ? 'observe' : 'act',
      readOnly: op === 'wait_for'
    });
    if (!urlCheck.allowed) return urlCheck;
  }

  // Resolve target element by explicit context.element, elementsByRef map, or observation list.
  let targetEl = context.element ?? null;
  const flatElements = collectElementsFlat(
    context.observation ?? (Array.isArray(context.elements) ? { elements: context.elements } : null)
  );

  if (!targetEl && typeof action.ref === 'string' && action.ref) {
    if (context.elementsByRef instanceof Map) {
      targetEl = context.elementsByRef.get(action.ref) ?? null;
    } else if (context.elementsByRef && typeof context.elementsByRef === 'object') {
      targetEl = context.elementsByRef[action.ref] ?? null;
    }
    if (!targetEl) {
      targetEl = flatElements.find((el) => (el.ref ?? el.id) === action.ref) ?? null;
    }
  }

  const passwordSensitiveOps = new Set([
    'type_text',
    'click',
    'double_click',
    'right_click',
    'focus_ref',
    'select_option'
  ]);

  if (targetEl && passwordSensitiveOps.has(op) && isCredentialOrPasswordElement(targetEl)) {
    return {
      allowed: false,
      code: SAFETY_CODES.PASSWORD_FIELD_BLOCKED,
      reason: `禁止对密码或支付凭据字段 (${action.ref || targetEl.ref || 'password'}) 执行 ${op} 操作`
    };
  }

  // Coordinate-level hit-test protection against clicking/typing into password fields without @ref.
  if (
    passwordSensitiveOps.has(op) &&
    Number.isFinite(action.x) &&
    Number.isFinite(action.y) &&
    flatElements.length > 0
  ) {
    for (const el of flatElements) {
      if (isCredentialOrPasswordElement(el) && pointHitsElementBounds(action.x, action.y, el)) {
        return {
          allowed: false,
          code: SAFETY_CODES.PASSWORD_FIELD_BLOCKED,
          reason: `目标坐标 (${action.x}, ${action.y}) 命中受保护的密码或支付凭据输入框 (${el.ref || 'password'})`
        };
      }
    }
  }

  if (op === 'press_key' || typeof action.key === 'string') {
    const combo = normalizeKeyCombo(String(action.key ?? ''));
    if (
      combo === 'ctrl+alt+del' ||
      combo === 'ctrl+esc' ||
      combo === 'ctrl+shift+esc' ||
      combo === 'alt+tab' ||
      combo === 'alt+shift+tab' ||
      combo === 'alt+esc' ||
      combo === 'win' ||
      combo.startsWith('win+')
    ) {
      return {
        allowed: false,
        code: SAFETY_CODES.DANGEROUS_KEY_COMBO_BLOCKED,
        reason: `禁止发送高危系统组合键 (${action.key})`
      };
    }

    if (combo === 'alt+f4' && isSystemShellWindow(winContext ?? context.observation)) {
      return {
        allowed: false,
        code: SAFETY_CODES.DANGEROUS_KEY_COMBO_BLOCKED,
        reason: '禁止对系统桌面或外壳窗口发送 Alt+F4'
      };
    }
  }

  return { allowed: true, code: SAFETY_CODES.OK };
}

function stripPassiveCaptchaFooterText(raw) {
  return String(raw ?? '').replace(PASSIVE_RECAPTCHA_FOOTER_RE, ' ').trim();
}

/**
 * Scans an observation payload (structured captcha flag, titles, URLs, iframes, and UI/DOM elements)
 * for CAPTCHAs or anti-bot human verification challenges, ignoring passive reCAPTCHA legal footers.
 */
export function detectCaptchaOrChallenge(observation) {
  if (!observation || typeof observation !== 'object') {
    return { detected: false, kind: null, reason: null };
  }

  if (observation.captcha && typeof observation.captcha === 'object' && observation.captcha.detected === true) {
    const rawKind = String(observation.captcha.kind || observation.captcha.provider || 'captcha')
      .trim()
      .toLowerCase();
    return {
      detected: true,
      kind: rawKind || 'captcha',
      reason: String(observation.captcha.reason || '检测到页面人机验证挑战组件'),
      handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]'
    };
  }

  const probes = [];
  const pushTextProbe = (val) => {
    if (typeof val === 'string' && val.trim()) {
      const cleaned = stripPassiveCaptchaFooterText(val);
      if (cleaned) probes.push(cleaned);
    }
  };
  const pushStructuralProbe = (val) => {
    if (typeof val === 'string' && val.trim()) {
      const s = val.trim();
      if (/grecaptcha-badge/i.test(s)) return;
      probes.push(s);
    }
  };

  pushTextProbe(observation.title);
  pushTextProbe(observation.windowTitle);
  pushTextProbe(observation.tabTitle);
  pushTextProbe(observation.window?.title);
  pushStructuralProbe(observation.url);
  pushStructuralProbe(observation.tabUrl);
  pushTextProbe(observation.rawText);
  pushTextProbe(observation.textExcerpt);
  pushTextProbe(observation.summary);

  const frameLists = [observation.iframes, observation.frames];
  for (const list of frameLists) {
    if (!Array.isArray(list)) continue;
    for (const frame of list) {
      if (typeof frame === 'string') {
        pushStructuralProbe(frame);
      } else if (frame && typeof frame === 'object') {
        pushStructuralProbe(frame.url);
        pushStructuralProbe(frame.src);
        pushTextProbe(frame.title);
        pushStructuralProbe(frame.name);
        pushStructuralProbe(frame.id);
      }
    }
  }

  const elements = collectElementsFlat(observation);
  for (const el of elements) {
    pushTextProbe(el.name);
    pushTextProbe(el.label);
    pushTextProbe(el.ariaLabel);
    pushTextProbe(el.title);
    pushTextProbe(el.text);
    pushTextProbe(el.placeholder);
    pushStructuralProbe(el.id);
    pushStructuralProbe(el.className);
    pushStructuralProbe(el.src);
    pushStructuralProbe(el.url);
    pushStructuralProbe(el.iframeSrc);
  }

  for (const sample of probes) {
    for (const rule of CAPTCHA_RULES) {
      if (rule.re.test(sample)) {
        return {
          detected: true,
          kind: rule.kind,
          reason: rule.reason,
          handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]'
        };
      }
    }
  }

  return { detected: false, kind: null, reason: null };
}
