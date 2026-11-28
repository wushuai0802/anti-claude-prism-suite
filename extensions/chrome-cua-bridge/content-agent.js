/**
 * Prism CUA Browser Content Agent (Clean-Room Original, MIT)
 * Injected on-demand ONLY into tabs explicitly armed by user click in popup.
 * Zero MutationObservers, zero background timers at rest, strict password & CAPTCHA redaction/blocking.
 */
(() => {
  'use strict';

  const AGENT_VERSION = '0.9.6';
  if (window.__prismCuaContentAgent && window.__prismCuaContentAgent.version === AGENT_VERSION) {
    return;
  }

  const MAX_REFS = 200;
  const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(', ');

  const SENSITIVE_AUTOCOMPLETE_RE = /\b(?:password|current-password|new-password|one-time-code|cc-number|cc-csc|cc-cvc|cc-exp|cc-[a-z0-9-]+)\b/i;
  const SENSITIVE_TOKEN_RE = /\b(?:password|passwd|passcode|pwd|cvv|cvv2|cvc|cvc2|csc|ccnum|totp|otp|pincode|pin)\b/i;
  const SENSITIVE_PHRASE_RE = /\b(?:cc\s+(?:num|number|csc|cvc|cvv|exp)|card\s+(?:num|number|no)|credit\s+card|security\s+code|verification\s+code|one\s+time\s+(?:code|password|pin))\b/i;
  const SENSITIVE_IDENT_RE = /(?:密码|口令|验证码|安全码|动态码|支付密码|交易密码|银行卡号|信用卡号|卡号|cvv2?|cvc2?|passcode|(?<![a-z])otp(?![a-z])|(?<![a-z])totp(?![a-z])|pin[-_ ]?code)/i;
  const PURE_SENSITIVE_NAV_KEYS = new Set([
    'Tab',
    'Escape',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Shift'
  ]);
  const SECRET_VALUE_RE = /\b(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,})\b/g;

  const CAPTCHA_IFRAME_PATTERNS = [
    { provider: 'Turnstile', re: /challenges\.cloudflare\.com|cloudflare.*turnstile|cf-chl/i },
    { provider: 'reCAPTCHA', re: /(?:google\.com|recaptcha\.net)\/recaptcha/i },
    { provider: 'hCaptcha', re: /hcaptcha\.com/i },
    { provider: 'Arkose', re: /arkoselabs\.com|funcaptcha/i },
    { provider: 'GeeTest', re: /geetest\.com/i },
    { provider: 'Altcha', re: /altcha/i }
  ];

  const CAPTCHA_DOM_SELECTORS = [
    { provider: 'Turnstile', selector: '.cf-turnstile, #cf-turnstile, [data-cf-turnstile-sitekey], #challenge-running, #challenge-stage' },
    { provider: 'reCAPTCHA', selector: '.g-recaptcha, [data-sitekey][class*="recaptcha"]' },
    { provider: 'hCaptcha', selector: '.h-captcha, [data-hcaptcha-widget-id]' },
    { provider: 'Altcha', selector: 'altcha-widget' }
  ];

  const CAPTCHA_TEXT_RE = /(?:verify you are human|confirm you are human|are you a robot|complete the security check|确认您是真人|验证您是真人|请完成安全验证|请完成人机验证|人机身份验证)/i;

  let lastRefMap = new Map();
  const everPasswordElements = new WeakSet();
  let agentArmedActive = true;
  let localEscAbortedAt = 0;
  let blindCurtainActive = false;
  let blindCurtainStartUrl = '';
  let blindCurtainInputs = [];

  function maybeReleaseBlindCurtainAfterSpaNavigation() {
    if (!blindCurtainActive) return;
    try {
      if (
        blindCurtainStartUrl &&
        window.location.href !== blindCurtainStartUrl &&
        blindCurtainInputs.every((el) => !el || !el.isConnected) &&
        !document.querySelector('input[type="password"]')
      ) {
        for (const el of blindCurtainInputs) {
          try {
            if (el) el.value = '';
          } catch {}
        }
        blindCurtainInputs = [];
        blindCurtainStartUrl = '';
        blindCurtainActive = false;
      }
    } catch {}
  }

  function lockPasswordFieldAgainstUnmasking(el) {
    if (!el || !(el instanceof HTMLInputElement)) return;
    everPasswordElements.add(el);
    try {
      el.setAttribute('type', 'password');
      el.setAttribute('autocomplete', 'off');
      const origSetAttribute = el.setAttribute.bind(el);
      el.setAttribute = function patchedSetAttribute(name, val) {
        if (String(name || '').toLowerCase() === 'type' && String(val || '').toLowerCase() !== 'password') {
          return;
        }
        return origSetAttribute(name, val);
      };
      Object.defineProperty(el, 'type', {
        configurable: false,
        enumerable: true,
        get() {
          return 'password';
        },
        set() {}
      });
    } catch {}
  }

  function isShowPasswordToggleElement(el) {
    if (!el || !(el instanceof Element)) return false;
    const meta = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('class') || '',
      el.getAttribute('data-testid') || '',
      el.textContent || ''
    ].join(' ');
    return /(?:show[-_ ]?pass|reveal[-_ ]?pass|toggle[-_ ]?pass|password[-_ ]?visibility|显示密码|查看密码|明文显示)/i.test(meta);
  }

  function onCaptureEscKeyDown(e) {
    if (!agentArmedActive) return;
    if (!e || e.isTrusted !== true || e.key !== 'Escape') return;
    localEscAbortedAt = Date.now();
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        const maybePromise = chrome.runtime.sendMessage({
          type: 'content_esc_brake',
          origin: window.location.origin,
          url: window.location.href,
          ts: localEscAbortedAt
        });
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
      }
    } catch {}
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', onCaptureEscKeyDown, true);
  }

  function normalizeFieldIdentifierTokens(raw) {
    return String(raw ?? '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[\[\]()_.:\-\s/\\]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function scanAndRememberPasswordInputs(root = document) {
    try {
      const pwInputs = root.querySelectorAll('input[type="password"]');
      for (const el of pwInputs) {
        everPasswordElements.add(el);
      }
    } catch {}
  }

  function extractAssociatedLabelText(el) {
    if (!el || !(el instanceof Element)) return '';
    const chunks = [];
    try {
      if (el.labels && el.labels.length > 0) {
        for (const lbl of Array.from(el.labels)) {
          if (lbl && lbl.textContent) chunks.push(lbl.textContent);
        }
      }
    } catch {}
    if (chunks.length === 0 && el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.textContent) chunks.push(lbl.textContent);
      } catch {}
    }
    if (chunks.length === 0) {
      const parentLbl = el.closest('label');
      if (parentLbl && parentLbl.textContent) chunks.push(parentLbl.textContent);
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const refId of labelledBy.split(/\s+/).filter(Boolean)) {
        const refEl = document.getElementById(refId);
        if (refEl && refEl.textContent) chunks.push(refEl.textContent);
      }
    }
    return chunks.join(' ');
  }

  function verifyExpectedOrigin(optsOrStep) {
    const expectedOrigin = String(
      optsOrStep?.expectedOrigin ?? optsOrStep?.armedOrigin ?? ''
    ).trim();
    if (expectedOrigin && window.location.origin !== expectedOrigin) {
      agentArmedActive = false;
      return {
        ok: false,
        code: 'ORIGIN_MISMATCH',
        error: `页面当前同源域 (${window.location.origin}) 与授权同源域 (${expectedOrigin}) 不匹配，已拒绝访问`
      };
    }
    return null;
  }

  function cleanText(str, maxLen = 120) {
    const norm = String(str ?? '').replace(/\s+/g, ' ').trim();
    if (!norm) return '';
    const redacted = norm.replace(SECRET_VALUE_RE, '[REDACTED_SECRET]');
    return redacted.length > maxLen ? `${redacted.slice(0, maxLen - 1)}…` : redacted;
  }

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest('[hidden], [aria-hidden="true"]')) {
      if (el.tagName !== 'INPUT' && el.tagName !== 'BUTTON') return false;
    }
    let style;
    try {
      style = window.getComputedStyle(el);
    } catch {
      return false;
    }
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function isInViewport(rect) {
    const vw = window.innerWidth || document.documentElement?.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement?.clientHeight || 0;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  }

  function getDeepActiveElement() {
    let cur = document.activeElement;
    let depth = 0;
    while (cur && cur.shadowRoot && cur.shadowRoot.activeElement && depth < 6) {
      cur = cur.shadowRoot.activeElement;
      depth++;
    }
    return cur || null;
  }

  function isSensitiveField(el) {
    if (!el || !(el instanceof Element)) return false;
    if (everPasswordElements.has(el)) return true;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'iframe') return true;
    const type = String(el.getAttribute('type') || (el.type ?? '')).toLowerCase();
    if (type === 'password') {
      everPasswordElements.add(el);
      return true;
    }
    try {
      const style = window.getComputedStyle(el);
      const wts = String(
        style?.webkitTextSecurity ||
        style?.getPropertyValue?.('-webkit-text-security') ||
        el.style?.webkitTextSecurity ||
        ''
      ).trim().toLowerCase();
      if (wts && wts !== 'none') {
        everPasswordElements.add(el);
        return true;
      }
    } catch {}
    const ac = String(el.getAttribute('autocomplete') || '').trim();
    if (ac && SENSITIVE_AUTOCOMPLETE_RE.test(ac)) return true;

    const role = String(el.getAttribute('role') || '').toLowerCase();
    const isNonTextInput =
      tag === 'input' &&
      (type === 'button' || type === 'submit' || type === 'reset' || type === 'checkbox' || type === 'radio');
    if (
      !isNonTextInput &&
      (tag === 'input' ||
        tag === 'textarea' ||
        el.isContentEditable ||
        role === 'textbox' ||
        role === 'searchbox' ||
        role === 'combobox' ||
        role === 'spinbutton')
    ) {
      const labelTxt = extractAssociatedLabelText(el);
      const ident = [
        el.getAttribute('name') || '',
        el.getAttribute('id') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('data-testid') || '',
        labelTxt
      ].join(' ');
      const normalizedTokens = normalizeFieldIdentifierTokens(ident);
      if (SENSITIVE_TOKEN_RE.test(normalizedTokens) || SENSITIVE_PHRASE_RE.test(normalizedTokens)) {
        return true;
      }
      if (SENSITIVE_IDENT_RE.test(ident)) {
        return true;
      }
    }
    return false;
  }

  function makeError(code, error, extra = {}) {
    const msg = String(error || '浏览器操控操作失败');
    return {
      ok: false,
      code: String(code || 'BROWSER_AGENT_ERROR'),
      error: msg,
      ...(extra && extra.handoffRequired ? { blocked: true, humanRequired: true, reason: msg } : {}),
      ...extra
    };
  }

  function detectCaptchaGate() {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const frame of iframes) {
        if (!isElementVisible(frame)) continue;
        const meta = `${frame.getAttribute('src') || ''} ${frame.getAttribute('title') || ''} ${frame.getAttribute('name') || ''}`;
        for (const item of CAPTCHA_IFRAME_PATTERNS) {
          if (item.re.test(meta)) {
            return {
              detected: true,
              provider: item.provider,
              reason: `检测到可见 ${item.provider} 验证框架`
            };
          }
        }
      }

      for (const item of CAPTCHA_DOM_SELECTORS) {
        const nodes = document.querySelectorAll(item.selector);
        for (const node of nodes) {
          if (isElementVisible(node)) {
            return {
              detected: true,
              provider: item.provider,
              reason: `检测到可见 ${item.provider} 验证组件`
            };
          }
        }
      }

      const titleStr = String(document.title || '');
      if (/^(?:just a moment\.{0,3}|请稍候\.{0,3}|安全验证|人机验证)$/i.test(titleStr.trim())) {
        const bodySample = String(document.body?.innerText || '').slice(0, 1200);
        if (CAPTCHA_TEXT_RE.test(bodySample) || /cloudflare|ray id/i.test(bodySample)) {
          return {
            detected: true,
            provider: 'AntiBotGate',
            reason: `页面处于人机验证挑战页 (${cleanText(titleStr, 48)})`
          };
        }
      }

      const headings = document.querySelectorAll('h1, h2, [role="heading"], [role="dialog"] h1, [role="dialog"] h2');
      for (const h of headings) {
        if (!isElementVisible(h)) continue;
        const txt = cleanText(h.textContent, 140);
        if (CAPTCHA_TEXT_RE.test(txt)) {
          return {
            detected: true,
            provider: 'HumanChallenge',
            reason: `检测到人机验证提示：${txt}`
          };
        }
      }
    } catch {}

    return { detected: false, provider: '', reason: '' };
  }

  function computeAccessibleName(el) {
    if (!el) return '';
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return cleanText(ariaLabel, 120);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .filter(Boolean);
      if (parts.length) return cleanText(parts.join(' '), 120);
    }

    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.textContent) return cleanText(lbl.textContent, 120);
      } catch {}
    }

    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) {
      return cleanText(parentLabel.textContent, 120);
    }

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input') {
      const t = String(el.type || '').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset') {
        return cleanText(el.value || el.getAttribute('title') || t, 120);
      }
      return cleanText(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '', 120);
    }

    return cleanText(
      el.innerText || el.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '',
      120
    );
  }

  function sanitizeHrefPreview(rawHref) {
    if (!rawHref) return '';
    try {
      const u = new URL(rawHref, window.location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      const base = `${u.origin}${u.pathname}`;
      return base.length > 140 ? `${base.slice(0, 139)}…` : base;
    } catch {
      return '';
    }
  }

  function collectSnapshot(opts = {}) {
    agentArmedActive = true;
    const originErr = verifyExpectedOrigin(opts);
    if (originErr) return originErr;

    maybeReleaseBlindCurtainAfterSpaNavigation();
    scanAndRememberPasswordInputs(document);
    const { mode = 'compact', maxElements = MAX_REFS } = opts;
    const cap = Math.max(1, Math.min(MAX_REFS, Number(maxElements) || MAX_REFS));
    const rawNodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const seen = new Set();
    const inViewCandidates = [];
    const outViewCandidates = [];

    for (const el of rawNodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (!isElementVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      const inVp = isInViewport(rect);
      if (inVp) inViewCandidates.push({ el, rect, inViewport: true });
      else outViewCandidates.push({ el, rect, inViewport: false });
    }

    const totalInteractive = inViewCandidates.length + outViewCandidates.length;
    const ordered = [...inViewCandidates, ...outViewCandidates].slice(0, cap);

    const nextMap = new Map();
    const elements = [];
    let activeElementRef = null;
    const activeEl = document.activeElement;

    for (let i = 0; i < ordered.length; i++) {
      const { el, rect, inViewport } = ordered[i];
      const ref = `@e${i + 1}`;
      nextMap.set(ref, el);
      if (el === activeEl) activeElementRef = ref;

      const tag = (el.tagName || '').toLowerCase();
      const role = el.getAttribute('role') || '';
      const inputType = tag === 'input' ? String(el.getAttribute('type') || el.type || 'text').toLowerCase() : '';
      const sensitive = isSensitiveField(el);
      const name = computeAccessibleName(el);
      const placeholder = cleanText(el.getAttribute('placeholder') || '', 80);

      const item = {
        ref,
        tag,
        ...(inputType ? { type: inputType } : {}),
        ...(role ? { role } : {}),
        ...(name ? { name } : {}),
        ...(placeholder && placeholder !== name ? { placeholder } : {}),
        inViewport,
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };

      if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
        item.disabled = true;
      }
      if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
        item.checked = Boolean(el.checked);
      } else if (el.hasAttribute('aria-checked')) {
        item.checked = el.getAttribute('aria-checked') === 'true';
      }

      if (tag === 'a') {
        const safeHref = sanitizeHrefPreview(el.getAttribute('href') || el.href || '');
        if (safeHref) item.href = safeHref;
      }

      if (sensitive || blindCurtainActive) {
        item.isPassword = Boolean(sensitive);
        item.redacted = true;
        item.valueRedacted = blindCurtainActive ? '[VAULT_CURTAIN_PROTECTED]' : '[PASSWORD_REDACTED]';
      } else if (tag === 'input' || tag === 'textarea') {
        if (
          inputType !== 'checkbox' &&
          inputType !== 'radio' &&
          inputType !== 'button' &&
          inputType !== 'submit' &&
          inputType !== 'reset'
        ) {
          const rawVal = String(el.value ?? '');
          if (rawVal.length > 0) {
            item.hasValue = true;
            item.value = '[已填写]';
          }
        }
      } else if (tag === 'select') {
        const selOpt = el.selectedOptions && el.selectedOptions[0];
        const val = cleanText(selOpt ? (selOpt.text || el.value) : el.value, 96);
        if (val) item.value = val;
      } else if (el.isContentEditable) {
        item.contentEditable = true;
        const rawVal = String(el.innerText || el.textContent || '').trim();
        if (rawVal.length > 0) {
          item.hasValue = true;
          item.value = '[已填写]';
        }
      }

      elements.push(item);
    }

    lastRefMap = nextMap;
    const captcha = detectCaptchaGate();

    const out = {
      ok: true,
      url: window.location.href,
      origin: window.location.origin,
      title: cleanText(document.title || '', 160),
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
        scrollX: Math.round(window.scrollX || 0),
        scrollY: Math.round(window.scrollY || 0),
        pageHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)
      },
      activeElementRef,
      captcha,
      totalInteractive,
      truncated: totalInteractive > cap,
      ...(blindCurtainActive ? { blindCurtainActive: true } : {}),
      elements
    };

    if (!blindCurtainActive) {
      try {
        const statusNodes = document.querySelectorAll('[role="status"], [role="alert"], output, .done, .toast, .alert, h1, h2');
        const statusParts = [];
        for (const sn of statusNodes) {
          if (!isElementVisible(sn)) continue;
          const st = cleanText(sn.textContent || '', 180);
          if (st && !statusParts.includes(st)) statusParts.push(st);
          if (statusParts.length >= 6) break;
        }
        if (statusParts.length > 0) {
          out.statusText = statusParts.join(' | ').slice(0, 600);
        }
      } catch {}

      if (mode === 'full' || mode === 'text') {
        out.textExcerpt = cleanText(document.body?.innerText || '', 2400);
      }
    }

    return out;
  }

  function normalizeRefKey(rawRef) {
    const s = String(rawRef ?? '').trim();
    if (!s) return '';
    if (/^@e\d+$/i.test(s)) return s.toLowerCase();
    if (/^e\d+$/i.test(s)) return `@${s.toLowerCase()}`;
    return s;
  }

  function resolveRefElement(rawRef) {
    const key = normalizeRefKey(rawRef);
    if (!key) return { ok: false, code: 'MISSING_REF', error: '缺少目标元素引用 ref（如 @e1）' };
    if (lastRefMap.size === 0) {
      collectSnapshot({ mode: 'compact' });
    }
    const el = lastRefMap.get(key);
    if (!el) {
      return { ok: false, code: 'UNKNOWN_REF', error: `未找到元素引用 ${key}，请先重新执行 browser_observe 获取最新快照` };
    }
    if (!el.isConnected) {
      return { ok: false, code: 'STALE_REF', error: `元素 ${key} 已脱离页面 DOM，请重新执行 browser_observe` };
    }
    return { ok: true, ref: key, el };
  }

  let vCursorHost = null;
  let vCursorPtr = null;
  let vCursorRing = null;
  let vCursorFadeTimer = null;
  let vCursorCleanupTimer = null;
  let lastVCursorX = -1;
  let lastVCursorY = -1;

  function pulseVirtualCursor(clientX, clientY, kind = 'click') {
    try {
      const vw = Math.max(1, window.innerWidth || 1280);
      const vh = Math.max(1, window.innerHeight || 720);
      const x = Math.max(2, Math.min(vw - 2, Math.round(Number(clientX) || vw / 2)));
      const y = Math.max(2, Math.min(vh - 2, Math.round(Number(clientY) || vh / 2)));

      if (!vCursorHost || !vCursorHost.isConnected) {
        const host = document.createElement('div');
        host.id = '__prism_cua_vcursor_host';
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;overflow:hidden!important;contain:layout style paint!important;';
        const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
        const accent = kind === 'type_text' ? '#8b5cf6' : (kind === 'scroll' ? '#10b981' : '#2563eb');
        root.innerHTML =
          '<style>' +
          '.vc-wrap{position:fixed;left:0;top:0;width:48px;height:48px;pointer-events:none;will-change:transform,opacity;transition:transform 165ms cubic-bezier(0.22,1,0.36,1),opacity 210ms ease;opacity:0;}' +
          '.vc-ring{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:999px;border:2px solid var(--vc-accent,#38bdf8);opacity:0;transform:scale(0.35);}' +
          '.vc-ring.is-pulse{animation:vcPulse 340ms cubic-bezier(0.16,1,0.3,1) forwards;}' +
          '.vc-badge{position:absolute;left:15px;top:19px;padding:1px 4px;border-radius:4px;background:rgba(15,23,42,0.92);border:1px solid var(--vc-accent,#38bdf8);color:#f8fafc;font:700 9px/1.15 system-ui,-apple-system,sans-serif;letter-spacing:0.03em;box-shadow:0 2px 6px rgba(0,0,0,0.28);}' +
          '@keyframes vcPulse{0%{opacity:0.92;transform:scale(0.35);}100%{opacity:0;transform:scale(1.85);}}' +
          '</style>' +
          `<div class="vc-wrap" style="--vc-accent:${accent}">` +
          '<div class="vc-ring"></div>' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 2px 5px rgba(15,23,42,0.38))">' +
          '<path d="M2 2L2 19.5L6.8 15.2L10.2 22L13.2 20.5L9.8 13.8L16.2 13.8L2 2Z" fill="var(--vc-accent,#2563eb)" stroke="#f8fafc" stroke-width="1.6" stroke-linejoin="round"/>' +
          '</svg>' +
          '<span class="vc-badge">AI</span>' +
          '</div>';
        (document.documentElement || document.body).appendChild(host);
        vCursorHost = host;
        vCursorPtr = root.querySelector('.vc-wrap');
        vCursorRing = root.querySelector('.vc-ring');
        const startX = lastVCursorX >= 0 ? lastVCursorX : Math.max(4, x - 32);
        const startY = lastVCursorY >= 0 ? lastVCursorY : Math.min(vh - 4, y + 24);
        if (vCursorPtr) {
          vCursorPtr.style.transition = 'none';
          vCursorPtr.style.transform = `translate3d(${startX - 2}px, ${startY - 2}px, 0)`;
          void vCursorPtr.offsetWidth;
          vCursorPtr.style.transition = 'transform 165ms cubic-bezier(0.22,1,0.36,1), opacity 210ms ease';
        }
      }

      const accentColor = kind === 'type_text' ? '#8b5cf6' : (kind === 'scroll' ? '#10b981' : '#2563eb');
      if (vCursorPtr) {
        vCursorPtr.style.setProperty('--vc-accent', accentColor);
        vCursorPtr.style.opacity = '1';
        vCursorPtr.style.transform = `translate3d(${x - 2}px, ${y - 2}px, 0)`;
      }
      if (vCursorRing) {
        vCursorRing.classList.remove('is-pulse');
        void vCursorRing.offsetWidth;
        vCursorRing.classList.add('is-pulse');
      }
      lastVCursorX = x;
      lastVCursorY = y;

      if (vCursorFadeTimer) clearTimeout(vCursorFadeTimer);
      if (vCursorCleanupTimer) clearTimeout(vCursorCleanupTimer);
      vCursorFadeTimer = setTimeout(() => {
        if (vCursorPtr) vCursorPtr.style.opacity = '0';
      }, 760);
      vCursorCleanupTimer = setTimeout(() => {
        if (vCursorHost && vCursorHost.parentNode) {
          vCursorHost.parentNode.removeChild(vCursorHost);
        }
        vCursorHost = null;
        vCursorPtr = null;
        vCursorRing = null;
        vCursorFadeTimer = null;
        vCursorCleanupTimer = null;
      }, 1020);
    } catch {}
  }

  function dispatchPointerClickSequence(el, { doubleClick = false, rightClick = false, overrideX = null, overrideY = null } = {}) {
    const rect = el.getBoundingClientRect();
    const clientX = Number.isFinite(overrideX) ? Math.round(overrideX) : Math.round(rect.left + rect.width / 2);
    const clientY = Number.isFinite(overrideY) ? Math.round(overrideY) : Math.round(rect.top + rect.height / 2);
    pulseVirtualCursor(clientX, clientY, 'click');
    const btnCode = rightClick ? 2 : 0;
    const btnMask = rightClick ? 2 : 1;
    const commonInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: btnCode,
      buttons: btnMask
    };

    const fireSingle = (detail) => {
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...commonInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      } catch {}
      el.dispatchEvent(new MouseEvent('mousedown', { ...commonInit, detail }));
      if (!rightClick && typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch {}
      }
      try {
        el.dispatchEvent(new PointerEvent('pointerup', { ...commonInit, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      } catch {}
      el.dispatchEvent(new MouseEvent('mouseup', { ...commonInit, buttons: 0, detail }));
    };

    if (rightClick) {
      fireSingle(1);
      el.dispatchEvent(new MouseEvent('contextmenu', { ...commonInit, buttons: 0, detail: 1 }));
      return { clientX, clientY };
    }

    fireSingle(1);
    if (typeof el.click === 'function') {
      el.click();
    } else {
      el.dispatchEvent(new MouseEvent('click', { ...commonInit, buttons: 0, detail: 1 }));
    }

    if (doubleClick) {
      fireSingle(2);
      el.dispatchEvent(new MouseEvent('click', { ...commonInit, buttons: 0, detail: 2 }));
      el.dispatchEvent(new MouseEvent('dblclick', { ...commonInit, buttons: 0, detail: 2 }));
    }
    return { clientX, clientY };
  }

  function setNativeControlValue(el, nextValue) {
    const prevValue = el.value;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, nextValue);
    } else {
      el.value = nextValue;
    }
    if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
      try {
        el._valueTracker.setValue(prevValue);
      } catch {}
    }
  }

  function parseKeyCombo(rawKey) {
    const parts = String(rawKey || '').trim().split('+').filter(Boolean);
    const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    let mainKey = 'Enter';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const lower = p.toLowerCase();
      if (i < parts.length - 1) {
        if (lower === 'ctrl' || lower === 'control') { mods.ctrlKey = true; continue; }
        if (lower === 'shift') { mods.shiftKey = true; continue; }
        if (lower === 'alt' || lower === 'option') { mods.altKey = true; continue; }
        if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') { mods.metaKey = true; continue; }
      }
      mainKey = p;
    }

    const keyAliasMap = {
      esc: 'Escape',
      escape: 'Escape',
      enter: 'Enter',
      return: 'Enter',
      tab: 'Tab',
      space: ' ',
      backspace: 'Backspace',
      delete: 'Delete',
      insert: 'Insert',
      ins: 'Insert',
      shift: 'Shift',
      arrowup: 'ArrowUp',
      arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft',
      arrowright: 'ArrowRight',
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      home: 'Home',
      end: 'End',
      pageup: 'PageUp',
      pagedown: 'PageDown'
    };
    const normKey = keyAliasMap[mainKey.toLowerCase()] || (mainKey.length === 1 ? mainKey : mainKey);
    const codeMap = {
      Enter: 'Enter',
      Escape: 'Escape',
      Tab: 'Tab',
      Shift: 'ShiftLeft',
      Insert: 'Insert',
      ' ': 'Space',
      Backspace: 'Backspace',
      Delete: 'Delete',
      ArrowUp: 'ArrowUp',
      ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft',
      ArrowRight: 'ArrowRight',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown'
    };
    const keyCodeMap = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Shift: 16,
      ' ': 32,
      Backspace: 8,
      Insert: 45,
      Delete: 46,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40
    };
    const code = codeMap[normKey] || (/^[a-zA-Z]$/.test(normKey) ? `Key${normKey.toUpperCase()}` : (/^\d$/.test(normKey) ? `Digit${normKey}` : normKey));
    const keyCode = keyCodeMap[normKey] || (normKey.length === 1 ? normKey.toUpperCase().charCodeAt(0) : 0);
    return { key: normKey, code, keyCode, ...mods };
  }

  function dispatchKeyToElement(target, rawKey, modOverrides = null) {
    const spec = parseKeyCombo(rawKey);
    const evInit = {
      key: spec.key,
      code: spec.code,
      keyCode: spec.keyCode,
      which: spec.keyCode,
      ctrlKey: modOverrides && typeof modOverrides.ctrlKey === 'boolean' ? modOverrides.ctrlKey : spec.ctrlKey,
      shiftKey: modOverrides && typeof modOverrides.shiftKey === 'boolean' ? modOverrides.shiftKey : spec.shiftKey,
      altKey: modOverrides && typeof modOverrides.altKey === 'boolean' ? modOverrides.altKey : spec.altKey,
      metaKey: modOverrides && typeof modOverrides.metaKey === 'boolean' ? modOverrides.metaKey : spec.metaKey,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    const notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', evInit));
    if (notCancelled && spec.key === 'Enter' && target instanceof HTMLInputElement && target.form) {
      try {
        if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
      } catch {}
    }
    target.dispatchEvent(new KeyboardEvent('keyup', evInit));
    return spec.key;
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function executeStep(step = {}) {
    agentArmedActive = true;
    const stepStartedAt = Date.now();
    const originErr = verifyExpectedOrigin(step);
    if (originErr) return originErr;

    scanAndRememberPasswordInputs(document);

    const captchaBefore = detectCaptchaGate();
    if (captchaBefore.detected) {
      const msg = `检测到人机验证挑战（${captchaBefore.provider}），已按安全红线暂停自动操作，请人工完成验证`;
      return {
        ok: false,
        blocked: true,
        humanRequired: true,
        handoffRequired: true,
        pausedHandoff: true,
        code: 'CAPTCHA_HANDOFF',
        captcha: captchaBefore,
        reason: msg,
        error: msg
      };
    }

    const action = String(step.action || step.type || step.op || '').trim().toLowerCase();
    const rawRef = step.ref ?? step.target ?? '';

    if (action === 'click' || action === 'double_click' || action === 'dblclick' || action === 'right_click') {
      let el = null;
      let ref = null;
      let overrideX = null;
      let overrideY = null;
      if (rawRef) {
        const resolved = resolveRefElement(rawRef);
        if (!resolved.ok) return resolved;
        el = resolved.el;
        ref = resolved.ref;
        try {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        } catch {
          try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
        }
        await sleepMs(25);
        if (localEscAbortedAt >= stepStartedAt) {
          return { ok: false, code: 'USER_ESC_ABORTED', abortedByEsc: true, error: '用户按下 Esc 紧急中断' };
        }
        const postScrollOriginErr = verifyExpectedOrigin(step);
        if (postScrollOriginErr) return postScrollOriginErr;
      } else if (Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) {
        overrideX = Math.round(Number(step.x));
        overrideY = Math.round(Number(step.y));
        el = document.elementFromPoint(overrideX, overrideY);
        if (!el) {
          return { ok: false, code: 'POINT_OUT_OF_VIEWPORT', error: `坐标 (${overrideX}, ${overrideY}) 未命中页面可见元素` };
        }
      } else {
        return { ok: false, code: 'MISSING_REF_OR_COORDS', error: '点击操作需要提供 ref (@eN) 或 (x, y) 坐标' };
      }

      if (blindCurtainActive && isShowPasswordToggleElement(el)) {
        return makeError('BLIND_CURTAIN_SHOW_PASSWORD_BLOCKED', '盲注防窥帘生效中：严禁点击显示密码按钮以防明文泄露');
      }

      if (isSensitiveField(el)) {
        const msg = '目标字段为密码或支付敏感区域，已拦截自动点击，请人工操作';
        return {
          ok: false,
          blocked: true,
          humanRequired: true,
          handoffRequired: true,
          code: 'PASSWORD_FIELD_BLOCKED',
          reason: msg,
          error: msg
        };
      }

      const pt = dispatchPointerClickSequence(el, {
        doubleClick: action === 'double_click' || action === 'dblclick',
        rightClick: action === 'right_click',
        overrideX,
        overrideY
      });
      await sleepMs(60);
      return {
        ok: true,
        action: action === 'right_click' ? 'right_click' : (action === 'click' ? 'click' : 'double_click'),
        ref,
        x: pt.clientX,
        y: pt.clientY,
        delivery: 'dom_virtual',
        physicalCursorMoved: false,
        url: window.location.href,
        origin: window.location.origin,
        title: cleanText(document.title || '', 160),
        captcha: detectCaptchaGate()
      };
    }

    if (action === 'type_text' || action === 'type' || action === 'fill') {
      let el = null;
      let ref = '';
      if (rawRef) {
        const resolved = resolveRefElement(rawRef);
        if (!resolved.ok) return resolved;
        el = resolved.el;
        ref = resolved.ref;
      } else if (Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y))) {
        el = document.elementFromPoint(Math.round(Number(step.x)), Math.round(Number(step.y)));
      } else if (document.activeElement && document.activeElement !== document.body) {
        el = document.activeElement;
      }
      if (!el) {
        return { ok: false, code: 'NO_TARGET_INPUT', error: '未指定输入目标 ref，且当前无已聚焦输入框' };
      }
      if (blindCurtainActive && isShowPasswordToggleElement(el)) {
        return makeError('BLIND_CURTAIN_SHOW_PASSWORD_BLOCKED', '盲注防窥帘生效中：严禁点击显示密码按钮以防明文泄露');
      }

      if (isSensitiveField(el)) {
        const msg = '目标字段为密码或银行卡敏感输入框，已拦截自动输入，请人工填写';
        return {
          ok: false,
          blocked: true,
          humanRequired: true,
          handoffRequired: true,
          code: 'PASSWORD_FIELD_BLOCKED',
          reason: msg,
          error: msg
        };
      }

      const textToType = String(step.text ?? step.value ?? '');
      const explicitClear = step.clear !== undefined ? step.clear : step.clearFirst;
      const shouldClear = explicitClear !== undefined ? Boolean(explicitClear) : !Boolean(step.append);

      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      } catch {}
      try {
        const r = el.getBoundingClientRect();
        pulseVirtualCursor(r.left + r.width / 2, r.top + r.height / 2, 'type_text');
      } catch {}
      if (typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch {}
      }
      const postFocusActive = getDeepActiveElement();
      if (isSensitiveField(el) || (postFocusActive && isSensitiveField(postFocusActive))) {
        return makeError('PASSWORD_FIELD_BLOCKED', '聚焦后命中密码或敏感凭据输入框，已拦截自动输入', { handoffRequired: true });
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const nextVal = shouldClear ? textToType : `${el.value || ''}${textToType}`;
        setNativeControlValue(el, nextVal);
        try {
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            composed: true,
            data: textToType,
            inputType: shouldClear ? 'insertReplacementText' : 'insertText'
          }));
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.isContentEditable) {
        if (shouldClear) {
          el.textContent = '';
        }
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, textToType);
        } catch {
          inserted = false;
        }
        if (!inserted) {
          el.textContent = shouldClear ? textToType : `${el.textContent || ''}${textToType}`;
          try {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: textToType, inputType: 'insertText' }));
          } catch {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } else {
        return { ok: false, code: 'NOT_EDITABLE', error: `目标元素 <${(el.tagName || '').toLowerCase()}> 不支持文本输入` };
      }

      if (step.submit || step.pressEnter) {
        await sleepMs(20);
        dispatchKeyToElement(el, 'Enter');
      }

      await sleepMs(50);
      return {
        ok: true,
        action: 'type_text',
        ref: ref || null,
        charCount: textToType.length,
        delivery: 'dom_virtual',
        physicalCursorMoved: false,
        url: window.location.href,
        origin: window.location.origin,
        title: cleanText(document.title || '', 160),
        captcha: detectCaptchaGate()
      };
    }

    if (action === 'press_key' || action === 'key' || action === 'keypress') {
      let target = document.activeElement || document.body || document.documentElement;
      let ref = '';
      if (rawRef) {
        const resolved = resolveRefElement(rawRef);
        if (!resolved.ok) return resolved;
        target = resolved.el;
        ref = resolved.ref;
      }
      const rawKey = step.key || step.value || 'Enter';
      const spec = parseKeyCombo(rawKey);
      const modList = Array.isArray(step.modifiers)
        ? step.modifiers.map((m) => String(m || '').toLowerCase())
        : [];
      const ctrlKey = Boolean(spec.ctrlKey || step.ctrlKey || modList.includes('ctrl') || modList.includes('control'));
      const metaKey = Boolean(spec.metaKey || step.metaKey || modList.includes('meta') || modList.includes('cmd') || modList.includes('command') || modList.includes('win'));
      const altKey = Boolean(spec.altKey || step.altKey || modList.includes('alt') || modList.includes('option'));
      const shiftKey = Boolean(spec.shiftKey || step.shiftKey || modList.includes('shift'));

      const checkSensBeforeOrAfter = () => {
        const deepAct = getDeepActiveElement();
        if (isSensitiveField(target) || (deepAct && deepAct !== target && isSensitiveField(deepAct))) {
          const isShiftInsert = shiftKey && (spec.key === 'Insert' || spec.code === 'Insert');
          const isPureNav = !ctrlKey && !metaKey && !altKey && !isShiftInsert && PURE_SENSITIVE_NAV_KEYS.has(spec.key);
          if (!isPureNav) return true;
        }
        return false;
      };
      if (checkSensBeforeOrAfter()) {
        return makeError('SENSITIVE_FIELD_BLOCKED', '已拦截向敏感凭据字段发送按键或粘贴指令', { handoffRequired: true });
      }
      if (rawRef && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch {}
      }
      if (checkSensBeforeOrAfter()) {
        return makeError('SENSITIVE_FIELD_BLOCKED', '聚焦后命中敏感凭据字段，已拦截发送按键或粘贴指令', { handoffRequired: true });
      }
      const keyUsed = dispatchKeyToElement(target, rawKey, { ctrlKey, shiftKey, altKey, metaKey });
      await sleepMs(45);
      return {
        ok: true,
        action: 'press_key',
        key: keyUsed,
        ref: ref || null,
        url: window.location.href,
        origin: window.location.origin,
        captcha: detectCaptchaGate()
      };
    }

    if (action === 'select_option' || action === 'select') {
      const resolved = resolveRefElement(rawRef);
      if (!resolved.ok) return resolved;
      const { el, ref } = resolved;
      if (!(el instanceof HTMLSelectElement)) {
        return { ok: false, code: 'NOT_SELECT_ELEMENT', error: `元素 ${ref} 不是原生 <select> 下拉框` };
      }
      const wantVal = step.value !== undefined ? String(step.value) : null;
      const wantLabel = step.label !== undefined ? String(step.label).trim() : (step.text !== undefined ? String(step.text).trim() : null);
      const wantIdx = typeof step.index === 'number' && Number.isInteger(step.index) ? step.index : null;

      let matchedIndex = -1;
      const opts = Array.from(el.options);
      if (wantIdx !== null && wantIdx >= 0 && wantIdx < opts.length) {
        matchedIndex = wantIdx;
      } else if (wantVal !== null) {
        matchedIndex = opts.findIndex((o) => o.value === wantVal);
      }
      if (matchedIndex === -1 && wantLabel !== null) {
        matchedIndex = opts.findIndex((o) => o.text.trim() === wantLabel || o.label.trim() === wantLabel);
        if (matchedIndex === -1) {
          const lower = wantLabel.toLowerCase();
          matchedIndex = opts.findIndex((o) => o.text.trim().toLowerCase().includes(lower));
        }
      }
      if (matchedIndex === -1 && wantVal !== null) {
        const lower = wantVal.toLowerCase();
        matchedIndex = opts.findIndex((o) => o.text.trim().toLowerCase() === lower);
      }
      if (matchedIndex === -1) {
        return { ok: false, code: 'OPTION_NOT_FOUND', error: `未在 ${ref} 中找到匹配的下拉选项` };
      }

      const chosen = opts[matchedIndex];
      const valDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (valDesc && typeof valDesc.set === 'function') {
        valDesc.set.call(el, chosen.value);
      } else {
        el.selectedIndex = matchedIndex;
      }
      try {
        const r = el.getBoundingClientRect();
        pulseVirtualCursor(r.left + r.width / 2, r.top + r.height / 2, 'click');
      } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleepMs(45);
      return {
        ok: true,
        action: 'select_option',
        ref,
        selectedValue: cleanText(chosen.value, 80),
        selectedLabel: cleanText(chosen.text, 80),
        delivery: 'dom_virtual',
        physicalCursorMoved: false,
        url: window.location.href,
        origin: window.location.origin
      };
    }

    if (action === 'scroll') {
      const dir = String(step.direction || 'down').toLowerCase();
      const amount = Math.max(40, Math.min(4000, Math.abs(Number(step.amount ?? step.pixels) || Math.round((window.innerHeight || 720) * 0.72))));
      let dx = Number(step.deltaX) || 0;
      let dy = Number(step.deltaY) || 0;
      if (!dx && !dy) {
        if (dir === 'down') dy = amount;
        else if (dir === 'up') dy = -amount;
        else if (dir === 'right') dx = amount;
        else if (dir === 'left') dx = -amount;
      }

      if (rawRef) {
        const resolved = resolveRefElement(rawRef);
        if (!resolved.ok) return resolved;
        const { el, ref } = resolved;
        if (step.intoView || (!step.direction && !step.deltaY && !step.deltaX)) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
        } else {
          el.scrollBy({ left: dx, top: dy, behavior: 'instant' });
        }
        await sleepMs(40);
        return {
          ok: true,
          action: 'scroll',
          ref,
          scrollX: Math.round(window.scrollX || 0),
          scrollY: Math.round(window.scrollY || 0)
        };
      }

      pulseVirtualCursor(
        Number.isFinite(Number(step.x)) ? Number(step.x) : (window.innerWidth || 800) * 0.5,
        Number.isFinite(Number(step.y)) ? Number(step.y) : (window.innerHeight || 600) * 0.5,
        'scroll'
      );
      if (dir === 'top') {
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else if (dir === 'bottom') {
        window.scrollTo({ top: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0), behavior: 'instant' });
      } else {
        window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      }
      await sleepMs(40);
      return {
        ok: true,
        action: 'scroll',
        delivery: 'dom_virtual',
        physicalCursorMoved: false,
        scrollX: Math.round(window.scrollX || 0),
        scrollY: Math.round(window.scrollY || 0),
        pageHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)
      };
    }

    if (action === 'focus_ref' || action === 'focus') {
      const resolved = resolveRefElement(rawRef);
      if (!resolved.ok) return resolved;
      const { el, ref } = resolved;
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      } catch {}
      if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }
      return { ok: true, action: 'focus_ref', ref };
    }

    if (action === 'wait_for' || action === 'wait') {
      const timeoutMs = Math.max(50, Math.min(30000, Number(step.timeoutMs ?? step.ms ?? step.durationMs) || 2000));
      const wantText = typeof step.text === 'string' && step.text.trim() ? step.text.trim().toLowerCase() : '';
      const wantSelector = typeof step.selector === 'string' && step.selector.trim() ? step.selector.trim() : '';
      const wantRef = normalizeRefKey(rawRef);

      if (!wantText && !wantSelector && !wantRef) {
        await sleepMs(Math.min(timeoutMs, 5000));
        return { ok: true, action: 'wait_for', waitedMs: Math.min(timeoutMs, 5000) };
      }

      const started = Date.now();
      while (Date.now() - started <= timeoutMs) {
        if (localEscAbortedAt >= stepStartedAt) {
          return { ok: false, code: 'USER_ESC_ABORTED', abortedByEsc: true, error: '用户按下 Esc 紧急中断' };
        }
        const loopOriginErr = verifyExpectedOrigin(step);
        if (loopOriginErr) return loopOriginErr;
        const gate = detectCaptchaGate();
        if (gate.detected) {
          return {
            ok: false,
            blocked: true,
            humanRequired: true,
            code: 'CAPTCHA_HUMAN_REQUIRED',
            captcha: gate,
            error: `等待期间出现人机验证挑战（${gate.provider}），请人工完成验证`
          };
        }
        if (wantText) {
          const bodyLower = String(document.body?.innerText || '').toLowerCase();
          if (bodyLower.includes(wantText)) {
            return { ok: true, action: 'wait_for', matched: 'text', waitedMs: Date.now() - started };
          }
        }
        if (wantSelector) {
          let found = null;
          try {
            found = document.querySelector(wantSelector);
          } catch {
            return { ok: false, code: 'INVALID_SELECTOR', error: `无效的 CSS 选择器: ${wantSelector}` };
          }
          if (found && isElementVisible(found)) {
            return { ok: true, action: 'wait_for', matched: 'selector', waitedMs: Date.now() - started };
          }
        }
        if (wantRef) {
          const r = resolveRefElement(wantRef);
          if (r.ok && isElementVisible(r.el)) {
            return { ok: true, action: 'wait_for', matched: 'ref', waitedMs: Date.now() - started };
          }
        }
        await sleepMs(100);
      }

      return {
        ok: false,
        code: 'WAIT_TIMEOUT',
        waitedMs: Date.now() - started,
        error: `等待目标条件超时 (${timeoutMs}ms)`
      };
    }

    if (action === 'vault_fill_and_submit' || action === 'vault_fill_totp') {
      if (window !== window.top) {
        return makeError('IFRAME_VAULT_FILL_BLOCKED', '安全护栏：拒绝向 iframe 子框架注入凭据');
      }
      const vaultMaterial = step.__brokerInjectedVault;
      if (!vaultMaterial || typeof vaultMaterial !== 'object') {
        return makeError('DIRECT_VAULT_INJECTION_FORBIDDEN', '缺少受控本地 Vault Broker 盲注载荷');
      }
      if (vaultMaterial.origin && String(vaultMaterial.origin).toLowerCase() !== window.location.origin.toLowerCase()) {
        return makeError('ORIGIN_MISMATCH', `页面当前域 (${window.location.origin}) 与凭据匹配域 (${vaultMaterial.origin}) 不一致`);
      }

      let userEl = null;
      let passEl = null;
      let totpEl = null;
      let submitEl = null;

      if (step.usernameRef) {
        const r = resolveRefElement(step.usernameRef);
        if (!r.ok) return r;
        userEl = r.el;
      }
      const pwRefRaw = step.passwordRef || (action === 'vault_fill_and_submit' ? rawRef : '');
      if (pwRefRaw) {
        const r = resolveRefElement(pwRefRaw);
        if (!r.ok) return r;
        passEl = r.el;
      }
      const totpRefRaw = step.totpRef || (action === 'vault_fill_totp' ? rawRef : '');
      if (totpRefRaw) {
        const r = resolveRefElement(totpRefRaw);
        if (!r.ok) return r;
        totpEl = r.el;
      }
      if (step.submitRef) {
        const r = resolveRefElement(step.submitRef);
        if (!r.ok) return r;
        submitEl = r.el;
      }

      if (action === 'vault_fill_and_submit') {
        if (!(passEl instanceof HTMLInputElement) || String(passEl.getAttribute('type') || passEl.type).toLowerCase() !== 'password') {
          return makeError('NOT_PASSWORD_INPUT', 'vault_fill_and_submit 的 passwordRef 必须指向真实的 <input type="password"> 控件');
        }
      } else if (!(totpEl instanceof HTMLInputElement)) {
        return makeError('NOT_TOTP_INPUT', 'vault_fill_totp 的 totpRef 必须指向有效的 <input> 控件');
      }

      const anchorInput = passEl || totpEl;
      const enclosingForm = anchorInput?.form || submitEl?.form || anchorInput?.closest?.('form') || null;
      for (const actAttr of [
        enclosingForm?.getAttribute?.('action') || '',
        submitEl?.getAttribute?.('formaction') || ''
      ]) {
        const trimmedAct = String(actAttr || '').trim();
        if (!trimmedAct || trimmedAct.startsWith('#') || /^javascript:/i.test(trimmedAct)) continue;
        try {
          const resolvedFormOrigin = new URL(trimmedAct, window.location.href).origin.toLowerCase();
          if (resolvedFormOrigin !== window.location.origin.toLowerCase()) {
            return makeError(
              'CROSS_ORIGIN_FORM_ACTION_BLOCKED',
              `安全护栏：检测到表单提交目标指向外部域 (${resolvedFormOrigin})，已拒绝注入凭据`
            );
          }
        } catch {
          return makeError('INVALID_FORM_ACTION', '表单提交地址格式异常，已拒绝盲注');
        }
      }

      // Engage Blind Curtain BEFORE writing a single character into DOM!
      blindCurtainActive = true;
      blindCurtainStartUrl = window.location.href;
      blindCurtainInputs = [passEl, totpEl].filter(Boolean);
      if (passEl) lockPasswordFieldAgainstUnmasking(passEl);

      const fillInputCleanly = (inputEl, secretStr) => {
        if (!(inputEl instanceof HTMLInputElement) || typeof secretStr !== 'string' || !secretStr) return false;
        try {
          const r = inputEl.getBoundingClientRect();
          pulseVirtualCursor(r.left + r.width / 2, r.top + r.height / 2, 'type_text');
        } catch {}
        setNativeControlValue(inputEl, secretStr);
        try {
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, composed: true, inputType: 'insertReplacementText' }));
        } catch {
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };

      let filledUsername = false;
      let filledPassword = false;
      let filledTotp = false;

      if (action === 'vault_fill_and_submit') {
        if (userEl && vaultMaterial.username) {
          filledUsername = fillInputCleanly(userEl, String(vaultMaterial.username));
        }
        if (passEl && vaultMaterial.password) {
          filledPassword = fillInputCleanly(passEl, String(vaultMaterial.password));
        }
      }
      if (totpEl && vaultMaterial.totpCode) {
        filledTotp = fillInputCleanly(totpEl, String(vaultMaterial.totpCode));
      }

      await sleepMs(45);
      if (localEscAbortedAt >= stepStartedAt) {
        if (passEl) setNativeControlValue(passEl, '');
        if (totpEl) setNativeControlValue(totpEl, '');
        return { ok: false, code: 'USER_ESC_ABORTED', abortedByEsc: true, error: '用户按下 Esc 紧急中断，已清空已注入字段' };
      }

      let submitted = false;
      if (submitEl) {
        dispatchPointerClickSequence(submitEl, {});
        submitted = true;
      } else if (enclosingForm && typeof enclosingForm.requestSubmit === 'function') {
        try {
          enclosingForm.requestSubmit();
          submitted = true;
        } catch {}
      } else if (anchorInput) {
        dispatchKeyToElement(anchorInput, 'Enter');
        submitted = true;
      }

      await sleepMs(140);
      return {
        ok: true,
        action,
        vaultFilled: true,
        filledUsername,
        filledPassword,
        filledTotp,
        submitted,
        blindCurtainActive: true,
        delivery: 'vault_blind_dom',
        physicalCursorMoved: false,
        url: window.location.href,
        origin: window.location.origin,
        title: cleanText(document.title || '', 160)
      };
    }

    return {
      ok: false,
      code: 'UNSUPPORTED_BROWSER_ACTION',
      error: `不支持的浏览器操控动作: ${action || '(空)'}`
    };
  }

  window.__prismCuaContentAgent = {
    version: AGENT_VERSION,
    observe: (opts = {}) => collectSnapshot(opts),
    act: (step = {}) => executeStep(step),
    setArmedState: (active) => {
      agentArmedActive = Boolean(active);
    }
  };
})();
