/* ============================================================================
 * Anti-Claude Prism Suite v0.9.4 (Clean-Room Original, MIT)
 * Performance-first architecture:
 *   - Zero document.body MutationObserver (0.0ms typing latency in composer)
 *   - Stream ink observer attaches ONLY to [data-testid="autoscroll-viewport"]
 *     during active generation and disconnects immediately on idle
 *   - Typing-grace + IME composition + touch-drag guard + dirty-checked DOM writes
 *   - Versioned event bus (window.__agPrismBus v4) for modular companion extensions
 * ============================================================================ */
(() => {
  if (typeof window.__agPrismSuiteDispose === 'function') {
    try { window.__agPrismSuiteDispose(); } catch {}
  }

  const SUITE_VERSION = '0.9.4';
  const REPO_RELEASES_API = 'https://api.github.com/repos/wushuai0802/anti-claude-prism-suite/releases/latest';
  const REPO_RELEASES_URL = 'https://github.com/wushuai0802/anti-claude-prism-suite/releases/latest';
  const STORAGE_KEY = 'ag_prism_suite_prefs_v1';
  const COOKIE_PREFS_KEY = 'ag_prism_prefs_v1';
  const LIVE_QUOTA_STORAGE_KEY = 'ag_prism_live_quota_v1';
  const ACCOUNT_SUMMARY_STORAGE_KEY = 'ag_prism_account_summary_v1';
  const ANTI_CLAUDE_QUOTA_CACHE_KEY = 'ag_claude_ux_quota_cache_v1';
  const MASCOT_SIZE_MIN = 16;
  const MASCOT_SIZE_MAX = 36;
  const MASCOT_SIZE_DEFAULT = 24;
  const MASCOT_MIN_COUNT_DEFAULT = 1;

  function clampMascotSize(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return MASCOT_SIZE_DEFAULT;
    const stepped = Math.round(n / 2) * 2;
    return Math.max(MASCOT_SIZE_MIN, Math.min(MASCOT_SIZE_MAX, stepped));
  }

  function clampMascotMinCount(val) {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n)) return MASCOT_MIN_COUNT_DEFAULT;
    return Math.max(1, Math.min(3, n));
  }

  function clampRangeInt(val, min, max, fallback) {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  const enumValidator = (allowed) => {
    const set = new Set(allowed);
    return (v) => (typeof v === 'string' && set.has(v) ? v : undefined);
  };
  const boolValidator = (v) => (typeof v === 'boolean' ? v : undefined);

  function sanitizeFontFamilyPref(v) {
    if (typeof v !== 'string') return undefined;
    const s = v.replace(/[\r\n\0]+/g, ' ').trim();
    if (s.length > 160) return undefined;
    if (/[\x00-\x1f\x7f;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@import/i.test(s)) return undefined;
    if ((s.match(/"/g) || []).length % 2 !== 0 || (s.match(/'/g) || []).length % 2 !== 0) return undefined;
    return s;
  }

  // Full 54-key schema across prism-suite, prism-suite-fx, and prism-suite-workflow
  const PREF_VALIDATORS = Object.freeze({
    lightPalette: enumValidator(['default', 'crystal', 'alabaster', 'sage']),
    darkPalette: enumValidator(['default', 'obsidian', 'basalt', 'marine']),
    showWorkbenchBtn: boolValidator,
    outline: boolValidator,
    usageExtra: boolValidator,
    inkStream: boolValidator,
    mascot: boolValidator,
    mascotCountMode: enumValidator(['fixed', 'agents']),
    mascotMinCount: (v) => (Number.isFinite(Number(v)) ? clampMascotMinCount(v) : undefined),
    mascotStyle: enumValidator(['trio', 'zoo', 'cyber', 'crab', 'cat', 'penguin', 'fox', 'shiba', 'robot', 'owlet', 'axolotl', 'bunny', 'frog', 'chick', 'slime']),
    mascotRoam: boolValidator,
    mascotVibe: enumValidator(['calm', 'lively']),
    mascotSize: (v) => (Number.isFinite(Number(v)) ? clampMascotSize(v) : undefined),
    thoughtMode: enumValidator(['off', 'bilingual', 'immersive']),
    performanceMode: enumValidator(['power-save', 'balanced', 'vivid']),
    ignoreReducedMotion: boolValidator,
    chatFontFamily: sanitizeFontFamilyPref,
    codeFontFamily: sanitizeFontFamilyPref,
    opticalFacets: boolValidator,
    semanticAfterglow: boolValidator,
    compactQuotaPill: boolValidator,
    composerBorderFx: enumValidator(['off', 'smart', 'beam', 'static']),
    outlineRailMode: enumValidator(['smart', 'right', 'off']),
    outlinePreviewStyle: enumValidator(['detailed', 'compact']),
    tokenUnit: enumValidator(['wan', 'kmb']),
    composerIntentSuggest: boolValidator,
    borderBeam: boolValidator,
    borderBeamMode: enumValidator(['always', 'busy']),
    borderBeamPalette: enumValidator(['theme', 'gemini', 'aurora', 'prism', 'neon', 'quota']),
    quotaRing: boolValidator,
    quotaRingPeriod: enumValidator(['auto', 'weekly', '5h']),
    thinkingOrb: boolValidator,
    thinkingOrbMode: enumValidator(['both', 'replace']),
    bubbleTint: boolValidator,
    bubbleTintPreset: enumValidator(['accent', 'sky', 'emerald', 'amber', 'violet']),
    bubbleTintStrength: (v) => (Number.isFinite(Number(v)) ? clampRangeInt(v, 10, 100, 22) : undefined),
    compactLayout: boolValidator,
    unreadBadge: boolValidator,
    sidebarSessions: enumValidator(['default', '10', 'all']),
    keepOverviewOpen: boolValidator,
    alwaysOutlineRail: boolValidator,
    switchReturnHelper: boolValidator,
    switchAutoReturn: boolValidator,
    autoDismissOnboarding: boolValidator,
    quotaHandoffAlert: boolValidator,
    imageContextMenu: boolValidator,
    cleanCopy: boolValidator,
    sshPaste: boolValidator,
    i18nExtraMode: enumValidator(['off', 'zh-CN', 'zh-TW', 'en']),
    inlineEditHelper: boolValidator,
    sessionFork: boolValidator,
    composerFileDrop: boolValidator,
    wslExplorerRevealFix: boolValidator,
    fastWindowRestore: boolValidator
  });

  const MIN_USER_TS = 1_700_000_000_000;
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function canUseHostCookie() {
    try {
      return typeof window === 'object' && Boolean(window.location) && /^https?:$/i.test(window.location.protocol || '');
    } catch {
      return false;
    }
  }

  function normalizePrefValue(key, val) {
    if (!hasOwn(PREF_VALIDATORS, key) || val === undefined || val === null) return undefined;
    try {
      return PREF_VALIDATORS[key](val);
    } catch {
      return undefined;
    }
  }

  function sanitizePrefsCandidate(raw) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { return null; }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const clean = {};
    let count = 0;
    for (const k of Object.keys(PREF_VALIDATORS)) {
      if (!hasOwn(raw, k)) continue;
      const norm = normalizePrefValue(k, raw[k]);
      if (norm !== undefined) {
        clean[k] = norm;
        count++;
      }
    }
    if (count === 0) return null;
    const rawTs = Number(raw._ts);
    const isExplicit = raw._tsOrigin !== 'legacy' && Number.isFinite(rawTs) && rawTs >= MIN_USER_TS;
    const ts = isExplicit ? Math.round(rawTs) : 0;
    clean._ts = ts;
    clean._tsOrigin = isExplicit ? 'explicit' : 'legacy';
    return { clean, ts, explicit: isExplicit };
  }

  function readPrefsFromCookie() {
    if (!canUseHostCookie()) return null;
    try {
      const rawCookie = typeof document === 'object' && document ? String(document.cookie || '') : '';
      if (!rawCookie) return null;
      const prefix = `${COOKIE_PREFS_KEY}=`;
      let best = null;
      for (const part of rawCookie.split(';')) {
        const seg = part.trim();
        if (!seg.startsWith(prefix)) continue;
        try {
          const decoded = decodeURIComponent(seg.slice(prefix.length));
          const cand = sanitizePrefsCandidate(decoded);
          if (cand && (!best || cand.ts >= best.ts)) {
            best = cand;
          }
        } catch {}
      }
      return best;
    } catch {
      return null;
    }
  }

  function writePrefsToCookie(prefsObj) {
    if (!canUseHostCookie()) return;
    try {
      if (typeof document !== 'object' || !document) return;
      const cand = sanitizePrefsCandidate(prefsObj);
      if (!cand) return;
      const encoded = encodeURIComponent(JSON.stringify(cand.clean));
      if (encoded.length <= 3800) {
        const secureAttr = /^https:$/i.test(window.location.protocol || '') ? '; Secure' : '';
        document.cookie = `${COOKIE_PREFS_KEY}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax${secureAttr}`;
      }
    } catch {}
  }

  const DEFAULT_PREFS = {
    lightPalette: 'default',   // 'default' | 'crystal' | 'alabaster' | 'sage'
    darkPalette: 'default',    // 'default' | 'obsidian' | 'basalt' | 'marine'
    showWorkbenchBtn: true,    // Topbar '工作台' quick button (can hide in pure-UI mode)
    outline: true,             // Conversation outline + Alt+Up/Down turn jump
    usageExtra: true,          // Book yardstick + weekday-aligned 12-week heatmap
    inkStream: true,           // 5-stage CSS.highlights stream fade-in
    mascot: true,              // Composer pixel mascots (0fps idle)
    mascotCountMode: 'fixed',  // 'fixed' | 'agents' (follow live swarm / subagent count)
    mascotMinCount: MASCOT_MIN_COUNT_DEFAULT, // 1..3 floor count in 'agents' mode
    mascotStyle: 'trio',       // 'trio' | 'crab' | 'cat' (used in fixed mode)
    mascotRoam: true,          // Random run & leap along composer top while busy
    mascotVibe: 'lively',      // 'calm' | 'lively' (personality intensity)
    mascotSize: MASCOT_SIZE_DEFAULT, // 16..36 px (step 2)
    thoughtMode: 'bilingual',  // 'off' | 'bilingual' | 'immersive'
    performanceMode: 'balanced', // 'power-save' | 'balanced' | 'vivid'
    ignoreReducedMotion: false,
    chatFontFamily: '',
    codeFontFamily: '',
    opticalFacets: true,
    semanticAfterglow: true,
    compactQuotaPill: true,
    composerBorderFx: 'smart',
    outlineRailMode: 'smart',
    outlinePreviewStyle: 'detailed',
    tokenUnit: 'wan',
    composerIntentSuggest: false
  };

  const registeredDefaults = Object.assign({}, DEFAULT_PREFS);
  const prefs = {};

  function syncTokenUnitBridge(dispatchEvent = true) {
    const unit = prefs.tokenUnit === 'kmb' ? 'kmb' : 'wan';
    try {
      localStorage.setItem('ag-prism-token-unit', unit);
    } catch {}
    if (dispatchEvent) {
      try {
        window.dispatchEvent(new CustomEvent('ag-prism-token-unit-change', { detail: { unit } }));
      } catch {}
    }
  }

  function replacePrefsInPlace(cand) {
    const prevTokenUnit = prefs.tokenUnit;
    const next = Object.assign({}, registeredDefaults, cand ? cand.clean : null, {
      _ts: cand ? cand.ts : 0,
      _tsOrigin: cand && cand.explicit ? 'explicit' : 'legacy'
    });
    for (const k of Object.keys(prefs)) {
      if (!hasOwn(next, k)) delete prefs[k];
    }
    Object.assign(prefs, next);
    syncTokenUnitBridge(prevTokenUnit !== prefs.tokenUnit);
  }

  function persistPrefsMirrors(prefsObj) {
    const cand = sanitizePrefsCandidate(prefsObj);
    if (!cand) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cand.clean)); } catch {}
    writePrefsToCookie(cand.clean);
  }

  const loadedFromStorage = (() => {
    let cLocal = null;
    try { cLocal = sanitizePrefsCandidate(localStorage.getItem(STORAGE_KEY)); } catch {}
    const cCookie = readPrefsFromCookie();
    let cDisk = null;
    try {
      if (window.__agPrismDiskPrefs && typeof window.__agPrismDiskPrefs === 'object') {
        cDisk = sanitizePrefsCandidate(window.__agPrismDiskPrefs);
      }
    } catch {}

    const hadBrowserStorage = Boolean(cLocal || cCookie);
    let winner = null;
    // Tie-break identical timestamps in order: local -> cookie -> disk
    for (const cand of [cLocal, cCookie, cDisk]) {
      if (cand && (!winner || cand.ts > winner.ts)) {
        winner = cand;
      }
    }
    replacePrefsInPlace(winner);
    if (winner) {
      // Backfill localStorage & host cookie on the new port without fabricating an explicit _ts
      persistPrefsMirrors(prefs);
    }
    return hadBrowserStorage;
  })();

  function savePrefs() {
    prefs._ts = Math.max(MIN_USER_TS, Date.now());
    prefs._tsOrigin = 'explicit';
    persistPrefsMirrors(prefs);
    try {
      if (typeof window.__agProjectCall === 'function') {
        const cand = sanitizePrefsCandidate(prefs);
        if (cand) {
          window.__agProjectCall('savePrismUiPrefs', { prefs: cand.clean }, 3000);
        }
      }
    } catch {}
  }

  let disposed = false;
  const cleanups = new Set();
  const onCleanup = (fn) => {
    if (typeof fn !== 'function') return () => false;
    cleanups.add(fn);
    return () => cleanups.delete(fn);
  };

  const motionQuery = (() => {
    try {
      return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      return null;
    }
  })();

  function isEffectivelyReducedMotion(p = prefs) {
    return (
      (Boolean(motionQuery && motionQuery.matches) && !p.ignoreReducedMotion) ||
      p.performanceMode === 'power-save'
    );
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtTokens(n) {
    const v = Number(n) || 0;
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (prefs.tokenUnit !== 'kmb') {
      if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(2).replace(/\.?0+$/, '')}亿`;
      if (v >= 10_000) return `${(v / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
      return String(Math.round(v));
    }
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(Math.round(v));
  }

  /* ---- Typing-grace, IME composition & touch-drag guard ---- */
  let lastTypingAt = 0;
  let isComposing = false;
  let isTouchDragging = false;
  let composeResetTimer = 0;

  function markUserTyping(e) {
    const t = e && e.target;
    if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
      lastTypingAt = Date.now();
    }
  }
  function onCompositionStart(e) {
    isComposing = true;
    markUserTyping(e);
    clearTimeout(composeResetTimer);
    composeResetTimer = setTimeout(() => { isComposing = false; }, 8000);
  }
  function onCompositionEnd(e) {
    isComposing = false;
    clearTimeout(composeResetTimer);
    markUserTyping(e);
  }
  function onTouchStart() { isTouchDragging = true; }
  function onTouchEnd() { isTouchDragging = false; }

  document.addEventListener('keydown', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionstart', onCompositionStart, { capture: true, passive: true });
  document.addEventListener('compositionupdate', markUserTyping, { capture: true, passive: true });
  document.addEventListener('compositionend', onCompositionEnd, { capture: true, passive: true });
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  onCleanup(() => {
    clearTimeout(composeResetTimer);
    document.removeEventListener('keydown', markUserTyping, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionupdate', markUserTyping, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchEnd, true);
  });

  function isUserActivelyTyping() {
    return isComposing || isTouchDragging || Date.now() - lastTypingAt < 1800;
  }

  /* ---- Dirty-checked attribute & CSS var writers (prevent full-page style recalcs) ---- */
  function setAttrIfChanged(el, attr, val) {
    if (!el) return false;
    if (val === null || val === undefined || val === false) {
      if (!el.hasAttribute(attr)) return false;
      el.removeAttribute(attr);
      return true;
    }
    const str = String(val);
    if (el.getAttribute(attr) === str) return false;
    el.setAttribute(attr, str);
    return true;
  }

  function setStyleVarIfChanged(el, prop, val) {
    if (!el || !el.style) return false;
    if (val === null || val === undefined || val === '') {
      if (!el.style.getPropertyValue(prop)) return false;
      el.style.removeProperty(prop);
      return true;
    }
    const str = String(val);
    if (el.style.getPropertyValue(prop) === str) return false;
    el.style.setProperty(prop, str);
    return true;
  }

  /* ==========================================================================
   * 1. Multi-Palette Theme Application
   * ========================================================================== */
  const LIGHT_NAMES = { default: '纯白默认', crystal: '白昼冷晶', alabaster: '暖白画册', sage: '松雾青岚' };
  const DARK_NAMES = { default: '暖炭默认', obsidian: '深空黑曜', basalt: '暖炭玄岩', marine: '深海墨蓝' };
  const LIGHT_ACCENTS = { default: '#2F75C3', crystal: '#2563EB', alabaster: '#B45309', sage: '#15803D' };
  const DARK_ACCENTS = { default: '#60A5FA', obsidian: '#3B82F6', basalt: '#D97706', marine: '#38BDF8' };

  function isCurrentlyDark() {
    return (
      document.documentElement.getAttribute('data-ag-theme-mode') === 'dark' ||
      document.body.classList.contains('dark')
    );
  }

  function getThemeAccent() {
    if (isCurrentlyDark()) return DARK_ACCENTS[prefs.darkPalette] || DARK_ACCENTS.default;
    return LIGHT_ACCENTS[prefs.lightPalette] || LIGHT_ACCENTS.default;
  }

  const PRISM_PALETTE_TOKENS = {
    light: {
      default: { bg: '#FFFFFF', subtle: '#F9F9F8', hover: '#F1F0EC', active: '#E5E4DF', text: '#141413', textSec: '#4A4945', textMuted: '#73726C', border: 'rgba(20, 20, 19, 0.09)', borderStrong: 'rgba(20, 20, 19, 0.16)', accent: '#2F75C3', accentSoft: 'rgba(47, 117, 195, 0.11)', codeBg: '#F7F7F5' },
      crystal: { bg: '#F4F7FB', subtle: '#E8EEF6', hover: '#DCE5F2', active: '#CFDCEB', text: '#0F172A', textSec: '#334155', textMuted: '#5B6B82', border: 'rgba(15, 23, 42, 0.09)', borderStrong: 'rgba(15, 23, 42, 0.16)', accent: '#2563EB', accentSoft: 'rgba(37, 99, 235, 0.12)', codeBg: '#EDF2F9' },
      alabaster: { bg: '#F6F4EE', subtle: '#EBE6DC', hover: '#E0D9CC', active: '#D5CCB9', text: '#231F1A', textSec: '#574F45', textMuted: '#746B5E', border: 'rgba(35, 31, 26, 0.09)', borderStrong: 'rgba(35, 31, 26, 0.16)', accent: '#B45309', accentSoft: 'rgba(180, 83, 9, 0.12)', codeBg: '#EFEBE2' },
      sage: { bg: '#F3F7F4', subtle: '#E6EFE9', hover: '#D9E6DD', active: '#CCE0D2', text: '#14221B', textSec: '#2F473B', textMuted: '#4C6356', border: 'rgba(20, 34, 27, 0.09)', borderStrong: 'rgba(20, 34, 27, 0.16)', accent: '#15803D', accentSoft: 'rgba(21, 128, 61, 0.12)', codeBg: '#ECF3EE' }
    },
    dark: {
      default: { bg: '#212120', subtle: '#1B1B1A', hover: '#2A2A28', active: '#343432', text: '#ECECEA', textSec: '#C4C3BE', textMuted: '#8E8D87', border: 'rgba(255, 255, 255, 0.09)', borderStrong: 'rgba(255, 255, 255, 0.18)', accent: '#60A5FA', accentSoft: 'rgba(96, 165, 250, 0.16)', codeBg: '#191918' },
      obsidian: { bg: '#0E0E11', subtle: '#09090B', hover: '#1B1B20', active: '#25252C', text: '#F4F4F5', textSec: '#D4D4D8', textMuted: '#8B8B95', border: 'rgba(255, 255, 255, 0.09)', borderStrong: 'rgba(255, 255, 255, 0.18)', accent: '#3B82F6', accentSoft: 'rgba(59, 130, 246, 0.18)', codeBg: '#141418' },
      basalt: { bg: '#141312', subtle: '#100F0E', hover: '#22201D', active: '#2C2925', text: '#EFECE6', textSec: '#C8C2B8', textMuted: '#938C82', border: 'rgba(255, 244, 230, 0.09)', borderStrong: 'rgba(255, 244, 230, 0.18)', accent: '#D97706', accentSoft: 'rgba(217, 119, 6, 0.18)', codeBg: '#191816' },
      marine: { bg: '#0B1220', subtle: '#080E19', hover: '#162238', active: '#1F2F4C', text: '#E8F0FA', textSec: '#C4D4EA', textMuted: '#8DA2BE', border: 'rgba(148, 197, 255, 0.11)', borderStrong: 'rgba(148, 197, 255, 0.20)', accent: '#38BDF8', accentSoft: 'rgba(56, 189, 248, 0.18)', codeBg: '#0E1728' }
    }
  };

  function getCurrentThemeBridgePayload() {
    const dark = isCurrentlyDark();
    const mode = dark ? 'dark' : 'light';
    const rawPal = dark ? (prefs.darkPalette || 'default') : (prefs.lightPalette || 'default');
    const group = PRISM_PALETTE_TOKENS[mode] || PRISM_PALETTE_TOKENS.light;
    const palette = Object.prototype.hasOwnProperty.call(group, rawPal) ? rawPal : 'default';
    return {
      mode,
      palette,
      lightPalette: prefs.lightPalette || 'default',
      darkPalette: prefs.darkPalette || 'default',
      tierBadgeMode: getPrismTierBadgeMode(),
      tokens: group[palette]
    };
  }

  const PRISM_TIER_BADGE_KEY = 'ag-prism-tier-badge-mode';
  const PRISM_TIER_MODES = ['badge', 'icon', 'text'];
  let prismTierBadgePop = false;

  function getPrismTierBadgeMode() {
    try {
      const m = localStorage.getItem(PRISM_TIER_BADGE_KEY);
      if (m && PRISM_TIER_MODES.includes(m)) return m;
    } catch {}
    return 'badge';
  }

  function setPrismTierBadgeMode(next, source = 'suite') {
    if (!PRISM_TIER_MODES.includes(next)) return;
    try { localStorage.setItem(PRISM_TIER_BADGE_KEY, next); } catch {}
    prismTierBadgePop = true;
    try {
      window.dispatchEvent(new CustomEvent('ag-prism-tier-badge-change', { detail: { mode: next, source } }));
    } catch {}
    if (typeof broadcastThemeToFrames === 'function') {
      try { broadcastThemeToFrames(); } catch {}
    }
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      renderPopoverContent(pop);
    }
    setTimeout(() => { prismTierBadgePop = false; }, 240);
  }

  function cyclePrismTierBadgeMode() {
    const cur = getPrismTierBadgeMode();
    const next = PRISM_TIER_MODES[(PRISM_TIER_MODES.indexOf(cur) + 1) % PRISM_TIER_MODES.length];
    setPrismTierBadgeMode(next, 'suite');
    return next;
  }

  function renderPrismTierBadgeHtml(rawTier) {
    const full = String(rawTier || '').trim();
    if (!full) return '';
    let kind = 'starter';
    let shortLabel = full.replace(/^Google\s+AI\s+/i, '').trim() || full;
    let gemSvg = '<svg class="ag-tier-gem" viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 2 12 7 7 12 2 7 7 2z"/></svg>';
    if (/ultra/i.test(full)) {
      kind = 'ultra';
      shortLabel = 'ULTRA';
      gemSvg = '<svg class="ag-tier-gem" viewBox="0 0 14 14" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M3.7 2.1h6.6l2.4 3.2L7 12.4 1.3 5.3l2.4-3.2z"/></svg>';
    } else if (/\bpro\b/i.test(full)) {
      kind = 'pro';
      shortLabel = 'PRO';
      gemSvg = '<svg class="ag-tier-gem" viewBox="0 0 14 14" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M7 1.3 12.7 7 7 12.7 1.3 7 7 1.3z"/></svg>';
    } else if (/\b(team|enterprise|business)\b/i.test(full)) {
      kind = 'team';
      shortLabel = /enterprise/i.test(full) ? 'ENT' : 'TEAM';
      gemSvg = '<svg class="ag-tier-gem" viewBox="0 0 14 14" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M7 1l1.8 4.2L13 7l-4.2 1.8L7 13 5.2 8.8 1 7l4.2-1.8L7 1z"/></svg>';
    } else if (/\b(plus|advanced)\b/i.test(full)) {
      kind = 'plus';
      shortLabel = 'PLUS';
      gemSvg = '<svg class="ag-tier-gem" viewBox="0 0 14 14" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M7 1.5l1.5 4L12.5 7l-4 1.5L7 12.5l-1.5-4L1.5 7l4-1.5L7 1.5z"/></svg>';
    } else if (/starter/i.test(full)) {
      shortLabel = 'STARTER';
    } else if (/free/i.test(full)) {
      shortLabel = 'FREE';
    } else {
      shortLabel = shortLabel.slice(0, 10).toUpperCase();
    }
    const mode = getPrismTierBadgeMode();
    const popCls = prismTierBadgePop ? ' is-pop' : '';
    const tip = `${full} · 点击切换徽章 / 图标 / 文字`;
    if (mode === 'text') {
      const txt = formatShortTierName(full) || full;
      return `<span class="ag-ps-qchip ag-tier-badge${popCls}" data-ps-tier-toggle="1" data-tier-mode="text" data-tier-kind="${kind}" role="button" tabindex="0" data-ag-ps-tip="${escapeHtml(tip)}" style="cursor:pointer;">${escapeHtml(txt)}</span>`;
    }
    if (mode === 'icon') {
      return `<span class="ag-tier-badge${popCls}" data-ps-tier-toggle="1" data-tier-mode="icon" data-tier-kind="${kind}" role="button" tabindex="0" data-ag-ps-tip="${escapeHtml(tip)}" aria-label="${escapeHtml(full)}">${gemSvg}</span>`;
    }
    return `<span class="ag-tier-badge${popCls}" data-ps-tier-toggle="1" data-tier-mode="badge" data-tier-kind="${kind}" role="button" tabindex="0" data-ag-ps-tip="${escapeHtml(tip)}">${gemSvg}<span class="ag-tier-txt">${escapeHtml(shortLabel)}</span></span>`;
  }

  const onExternalTierBadgeChange = (ev) => {
    if (ev && ev.detail && ev.detail.source === 'suite') return;
    if (typeof broadcastThemeToFrames === 'function') {
      try { broadcastThemeToFrames(); } catch {}
    }
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      renderPopoverContent(pop);
    }
  };
  window.addEventListener('ag-prism-tier-badge-change', onExternalTierBadgeChange);
  onCleanup(() => window.removeEventListener('ag-prism-tier-badge-change', onExternalTierBadgeChange));

  function applyPalettes() {
    const html = document.documentElement;
    if (!html) return;
    setAttrIfChanged(html, 'data-ag-ps-light', prefs.lightPalette && prefs.lightPalette !== 'default' ? prefs.lightPalette : null);
    setAttrIfChanged(html, 'data-ag-ps-dark', prefs.darkPalette && prefs.darkPalette !== 'default' ? prefs.darkPalette : null);
    if (typeof broadcastThemeToFrames === 'function') {
      try { broadcastThemeToFrames(); } catch {}
    }
  }
  applyPalettes();
  onCleanup(() => {
    setAttrIfChanged(document.documentElement, 'data-ag-ps-light', null);
    setAttrIfChanged(document.documentElement, 'data-ag-ps-dark', null);
  });

  /* ==========================================================================
   * 2. Conversation Outline Drawer, Viewport-Anchored Alt+Up/Down Jump & /btw
   * ========================================================================== */
  let jumpToastTimer = 0;
  let popCloseTimer = 0;
  let outlineCloseTimer = 0;

  function notifyOverlayChange() {
    if (disposed) return;
    try {
      window.dispatchEvent(new CustomEvent('ag-prism-overlay-change'));
    } catch {}
  }

  function cancelPopoverClose(pop) {
    if (popCloseTimer) {
      clearTimeout(popCloseTimer);
      popCloseTimer = 0;
    }
    if (pop) pop.removeAttribute('data-closing');
  }

  function cancelOutlineClose(drawer) {
    if (outlineCloseTimer) {
      clearTimeout(outlineCloseTimer);
      outlineCloseTimer = 0;
    }
    if (drawer) drawer.removeAttribute('data-closing');
  }

  function closePopoverAnimated(dispatchOverlay = true) {
    const pop = document.getElementById('ag-ps-popover');
    if (!pop) return false;
    const wasOpen = pop.getAttribute('data-open') === '1';
    pop.removeAttribute('data-open');
    if (!wasOpen) {
      cancelPopoverClose(pop);
      return false;
    }
    cancelPopoverClose(pop);
    if (!isEffectivelyReducedMotion() && !disposed && !document.hidden) {
      pop.setAttribute('data-closing', '1');
      popCloseTimer = setTimeout(() => {
        popCloseTimer = 0;
        if (pop.isConnected) pop.removeAttribute('data-closing');
      }, 130);
    }
    if (dispatchOverlay) notifyOverlayChange();
    return true;
  }

  function closeOutlineAnimated(dispatchOverlay = true) {
    const drawer = document.getElementById('ag-ps-outline');
    if (!drawer) return false;
    const wasOpen = drawer.getAttribute('data-open') === '1';
    drawer.removeAttribute('data-open');
    if (!wasOpen) {
      cancelOutlineClose(drawer);
      return false;
    }
    cancelOutlineClose(drawer);
    if (!isEffectivelyReducedMotion() && !disposed && !document.hidden) {
      drawer.setAttribute('data-closing', '1');
      outlineCloseTimer = setTimeout(() => {
        outlineCloseTimer = 0;
        if (drawer.isConnected) drawer.removeAttribute('data-closing');
      }, 130);
    }
    if (dispatchOverlay) notifyOverlayChange();
    return true;
  }

  function showJumpToast(text) {
    let el = document.getElementById('ag-ps-jump-toast');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'ag-ps-jump-toast';
      el.setAttribute('data-ag-i18n-ignore', '1');
      document.body.appendChild(el);
    }
    if (!el) return;
    try {
      const box = getActiveInputBox();
      if (box) {
        const r = box.getBoundingClientRect();
        if (r.top > 120 && r.top < window.innerHeight) {
          el.style.bottom = `${Math.max(96, Math.round(window.innerHeight - r.top + 38))}px`;
        } else {
          el.style.removeProperty('bottom');
        }
      } else {
        el.style.removeProperty('bottom');
      }
    } catch {}
    el.textContent = text;
    el.setAttribute('data-show', '1');
    notifyOverlayChange();
    clearTimeout(jumpToastTimer);
    jumpToastTimer = setTimeout(() => {
      el.removeAttribute('data-show');
      notifyOverlayChange();
    }, 2000);
  }
  onCleanup(() => {
    clearTimeout(jumpToastTimer);
    clearTimeout(popCloseTimer);
    clearTimeout(outlineCloseTimer);
  });

  function isElementRendered(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getActiveCascadeId() {
    try {
      if (window.__ag_watched_cascade_id) return String(window.__ag_watched_cascade_id);
      const sel = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
      return (sel && sel.getAttribute('data-cascade-id')) || '';
    } catch {
      return '';
    }
  }

  function getActiveInputBox(anchorEl = null) {
    if (anchorEl && anchorEl.closest) {
      const own = anchorEl.closest('[id="antigravity.agentSidePanelInputBox"]');
      if (own && isElementRendered(own)) return own;
      const view = anchorEl.closest('[data-testid="conversation-view"]');
      if (view) {
        const inView = view.querySelector('[id="antigravity.agentSidePanelInputBox"]');
        if (inView && isElementRendered(inView)) return inView;
      }
    }
    const allBoxes = Array.from(document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]'));
    if (!allBoxes.length) return null;
    const pool = allBoxes.filter(isElementRendered);
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];

    const ae = document.activeElement;
    if (ae && ae.closest) {
      const aeOwn = ae.closest('[id="antigravity.agentSidePanelInputBox"]');
      if (aeOwn && pool.includes(aeOwn)) return aeOwn;
      const aeView = ae.closest('[data-testid="conversation-view"]');
      if (aeView) {
        const aeBox = aeView.querySelector('[id="antigravity.agentSidePanelInputBox"]');
        if (aeBox && pool.includes(aeBox)) return aeBox;
      }
    }
    const cid = getActiveCascadeId();
    if (cid) {
      for (const b of pool) {
        const v = b.closest('[data-testid="conversation-view"]');
        if (v && v.getAttribute('data-cascade-id') === cid) return b;
      }
    }
    return pool[pool.length - 1];
  }

  function getActiveViewportEl() {
    const box = getActiveInputBox();
    if (box && box.closest) {
      const view = box.closest('[data-testid="conversation-view"]');
      if (view) {
        const vp = view.querySelector('[data-testid="autoscroll-viewport"]');
        if (vp && isElementRendered(vp)) return vp;
      }
    }
    const vps = Array.from(document.querySelectorAll('[data-testid="autoscroll-viewport"]'));
    const vis = vps.filter(isElementRendered);
    return vis[vis.length - 1] || null;
  }

  function getUserTurnElements() {
    const scope = getActiveViewportEl() || document;
    const nodes = Array.from(scope.querySelectorAll('[data-testid="user-message-content"], [data-testid="user-input-step"]'));
    const out = [];
    const seenMsg = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!isElementRendered(n)) continue;
      const host = (n.closest && (n.closest('[data-testid="user-input-step"]') || n.closest('[data-testid="user-message"]'))) || n;
      if (seenMsg.has(host)) continue;
      const contentEl = (host.matches && host.matches('[data-testid="user-message-content"]') && host)
        || (host.querySelector && host.querySelector('[data-testid="user-message-content"]'))
        || n;
      const hasTxt = (contentEl.textContent || '').trim().length > 0;
      const hasMedia = !hasTxt && Boolean(host.querySelector && host.querySelector('img, [data-testid*="attachment"], [data-testid*="media"], bdi.context-scope-mention'));
      if (!hasTxt && !hasMedia) continue;
      seenMsg.add(host);
      out.push(contentEl);
    }
    return out;
  }

  // Per-conversation turn prompt summary cache for paginated/unmounted older turns (LRU capped at 12 conversations)
  const navTurnPreviewByConv = new Map(); // convId -> Map<startStepIndex, string>
  const navInFlightStepsByConv = new Map(); // convId -> Set<number>

  function getConvPreviewMap(convId) {
    if (!convId) return null;
    if (!navTurnPreviewByConv.has(convId)) {
      if (navTurnPreviewByConv.size >= 12) {
        const oldestKey = navTurnPreviewByConv.keys().next().value;
        navTurnPreviewByConv.delete(oldestKey);
        navInFlightStepsByConv.delete(oldestKey);
      }
      navTurnPreviewByConv.set(convId, new Map());
    }
    return navTurnPreviewByConv.get(convId);
  }

  function extractPromptFromHostTurnSummary(turnSummary) {
    if (!turnSummary || typeof turnSummary !== 'object') return '';
    const stepVal = turnSummary?.firstStep?.step?.value;
    if (stepVal && typeof stepVal === 'object') {
      const parts = [];
      if (Array.isArray(stepVal.items)) {
        for (let i = 0; i < stepVal.items.length; i++) {
          const it = stepVal.items[i];
          const ch = it && it.chunk;
          if (!ch) continue;
          if (typeof ch.value === 'string') {
            parts.push(ch.value);
          } else if (ch.value && typeof ch.value === 'object') {
            const label = ch.value.displayName || ch.value.filePath || ch.value.uri || ch.value.title || '';
            if (label) parts.push(`@${String(label).split(/[\\/]/).pop()}`);
          }
        }
      }
      const cleaned = parts
        .join(' ')
        .replace(/<\/?USER_REQUEST>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) return cleaned;
      const fb = String(stepVal.query || stepVal.userResponse || '')
        .replace(/<\/?USER_REQUEST>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (fb) return fb;
      if (
        (Array.isArray(stepVal.media) && stepVal.media.length) ||
        (Array.isArray(stepVal.images) && stepVal.images.length) ||
        (Array.isArray(turnSummary?.firstStep?.attachments) && turnSummary.firstStep.attachments.length)
      ) {
        return '[图片 / 附件提问]';
      }
    }
    return '';
  }

  function probeHostNavigatorFiber(vp) {
    if (!vp) return null;
    try {
      const keys = Object.keys(vp);
      let fk = '';
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].startsWith('__reactFiber$')) {
          fk = keys[i];
          break;
        }
      }
      if (!fk) return null;
      let cur = vp[fk];
      let navCtx = null;
      let navProps = null;
      for (let d = 0; cur && d < 14; d++, cur = cur.return) {
        const mp = cur.memoizedProps;
        if (!mp || typeof mp !== 'object') continue;
        if (!navCtx && mp.value && typeof mp.value === 'object' && Array.isArray(mp.value.turns) && typeof mp.value.jumpTo === 'function') {
          navCtx = mp.value;
        }
        if (!navProps && Array.isArray(mp.turns) && typeof mp.fetchTurns === 'function') {
          navProps = mp;
        }
        if (navCtx && navProps) break;
      }
      if (!navCtx || !Array.isArray(navCtx.turns) || navCtx.turns.length === 0) return null;
      return {
        convId: String((navProps && navProps.conversationId) || getActiveCascadeId() || window.location.pathname || ''),
        turns: navCtx.turns,
        total: navCtx.turns.length,
        activeIndex: Number.isFinite(Number(navCtx.activeIndex)) ? Number(navCtx.activeIndex) : navCtx.turns.length - 1,
        jumpTo: navCtx.jumpTo,
        fetchTurns: navProps && typeof navProps.fetchTurns === 'function' ? navProps.fetchTurns : null,
        sections: navProps && navProps.sections ? navProps.sections : null
      };
    } catch {
      return null;
    }
  }

  function getConversationNavSnapshot() {
    const vp = getActiveViewportEl();
    const domTurns = getUserTurnElements();
    const hostNav = probeHostNavigatorFiber(vp);

    if (!hostNav || hostNav.turns.length < domTurns.length) {
      const curDomIdx = detectViewportTurnIndex(domTurns);
      return {
        mode: 'dom',
        convId: String(getActiveCascadeId() || window.location.pathname || ''),
        total: domTurns.length,
        activeIndex: curDomIdx >= 0 ? curDomIdx : Math.max(0, domTurns.length - 1),
        domTurns,
        getPreview(idx) {
          const el = domTurns[idx];
          if (!el) return '';
          const txt = getCachedTurnText(el);
          return txt || '[图片 / 附件提问]';
        },
        getDomEl(idx) {
          return domTurns[idx] || null;
        },
        ensurePreviews() {
          return Promise.resolve(false);
        },
        jumpTo(idx) {
          const targetEl = domTurns[idx];
          if (!targetEl) return false;
          jumpToTurn(targetEl, idx, domTurns.length);
          return true;
        }
      };
    }

    const { convId, turns, total, fetchTurns } = hostNav;
    const previewMap = getConvPreviewMap(convId);

    // Seed mounted tail DOM turns into previewMap at 0 RPC cost when DOM turns correspond to the tail slice
    if (previewMap && domTurns.length > 0 && domTurns.length <= total) {
      const offset = total - domTurns.length;
      for (let i = 0; i < domTurns.length; i++) {
        const tMeta = turns[offset + i];
        if (tMeta && Number.isFinite(Number(tMeta.startStepIndex)) && !previewMap.has(tMeta.startStepIndex)) {
          const txt = getCachedTurnText(domTurns[i]) || '[图片 / 附件提问]';
          if (txt) previewMap.set(tMeta.startStepIndex, txt);
        }
      }
    }

    // Refine activeIndex when user is scrolled at the very bottom or viewing mounted tail turns
    let resolvedActive = Math.max(0, Math.min(total - 1, hostNav.activeIndex));
    if (vp && domTurns.length > 0 && domTurns.length <= total) {
      const distBottom = vp.scrollHeight - (vp.scrollTop + vp.clientHeight);
      if (distBottom < 36) {
        resolvedActive = total - 1;
      } else {
        const firstMountedRect = domTurns[0].getBoundingClientRect();
        const vpRect = vp.getBoundingClientRect();
        if (firstMountedRect.top <= vpRect.top + vpRect.height * 0.55) {
          const localIdx = detectViewportTurnIndex(domTurns);
          if (localIdx >= 0) {
            resolvedActive = (total - domTurns.length) + localIdx;
          }
        }
      }
    }

    const resolveMountedDomEl = (idx) => {
      if (domTurns.length > 0 && domTurns.length <= total) {
        const localIdx = idx - (total - domTurns.length);
        if (localIdx >= 0 && localIdx < domTurns.length && domTurns[localIdx]?.isConnected) {
          return domTurns[localIdx];
        }
      }
      return null;
    };

    const ensurePreviews = async (centerIdx = 0, radius = 16, onUpdated = null) => {
      if (!fetchTurns || !previewMap || !convId) return false;
      let inFlight = navInFlightStepsByConv.get(convId);
      if (!inFlight) {
        inFlight = new Set();
        navInFlightStepsByConv.set(convId, inFlight);
      }
      const lo = Math.max(0, centerIdx - radius);
      const hi = Math.min(total - 1, centerIdx + radius);
      const wantSteps = [];
      for (let i = lo; i <= hi; i++) {
        const st = turns[i]?.startStepIndex;
        if (Number.isFinite(Number(st)) && !previewMap.has(st) && !inFlight.has(st)) {
          wantSteps.push(st);
          if (wantSteps.length >= 48) break;
        }
      }
      if (!wantSteps.length) return false;
      for (const s of wantSteps) inFlight.add(s);
      try {
        const resp = await fetchTurns({ conversationId: convId, stepIndices: wantSteps });
        const list = Array.isArray(resp?.turns) ? resp.turns : [];
        let added = false;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const st = Number(item?.startStepIndex);
          if (!Number.isFinite(st)) continue;
          const promptTxt = extractPromptFromHostTurnSummary(item) || `第 ${turns.findIndex((t) => t.startStepIndex === st) + 1} 轮提问`;
          previewMap.set(st, promptTxt);
          added = true;
        }
        for (const s of wantSteps) {
          if (!previewMap.has(s)) previewMap.set(s, '提问记录');
        }
        if (added && !disposed && typeof onUpdated === 'function') {
          try { onUpdated(); } catch {}
        }
        return added;
      } catch {
        return false;
      } finally {
        for (const s of wantSteps) inFlight.delete(s);
      }
    };

    return {
      mode: 'host',
      convId,
      total,
      turns,
      activeIndex: resolvedActive,
      domTurns,
      getPreview(idx) {
        const tMeta = turns[idx];
        if (!tMeta) return '';
        const cached = previewMap ? previewMap.get(tMeta.startStepIndex) : '';
        if (cached) return cached;
        const mounted = resolveMountedDomEl(idx);
        if (mounted) {
          const txt = getCachedTurnText(mounted) || '[图片 / 附件提问]';
          if (previewMap && txt) previewMap.set(tMeta.startStepIndex, txt);
          return txt;
        }
        return '';
      },
      getDomEl: resolveMountedDomEl,
      ensurePreviews,
      jumpTo(idx) {
        if (idx < 0 || idx >= total) return false;
        const mounted = resolveMountedDomEl(idx);
        const preview = (this.getPreview(idx) || `第 ${idx + 1} 轮`).slice(0, 36);
        if (mounted) {
          jumpToTurn(mounted, idx, total);
          return true;
        }
        try {
          hostNav.jumpTo(idx);
          showJumpToast(`第 ${idx + 1} / ${total} 轮 · ${preview}`);
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  function detectViewportTurnIndex(turns) {
    if (!turns.length) return -1;
    const vp = getActiveViewportEl();
    const vpRect = vp ? vp.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const anchorY = vpRect.top + vpRect.height * 0.35;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < turns.length; i++) {
      const r = turns[i].getBoundingClientRect();
      const dist = Math.abs(r.top - anchorY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function jumpToTurn(el, index, total) {
    if (!el) return;
    const bubble = el.closest('[data-testid="user-message-bubble"]') || el.closest('[data-testid="user-message"]') || el;
    bubble.scrollIntoView({ behavior: isEffectivelyReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    bubble.classList.remove('ag-ps-turn-pulse');
    void bubble.offsetWidth;
    bubble.classList.add('ag-ps-turn-pulse');
    setTimeout(() => bubble.classList.remove('ag-ps-turn-pulse'), 1500);
    const preview = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36);
    showJumpToast(`第 ${index + 1} / ${total} 轮 · ${preview}`);
  }

  function insertBtwQuote(text) {
    const snippet = `/btw 关于「${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 48)}」：`;
    const box = getActiveInputBox();
    const editor = box && box.querySelector('[contenteditable="true"], textarea');
    let inserted = false;
    if (editor) {
      editor.focus();
      const before = (editor.textContent || editor.value || '').length;
      try {
        document.execCommand('insertText', false, snippet);
        const after = (editor.textContent || editor.value || '').length;
        inserted = after > before;
      } catch {}
      if (!inserted && editor.tagName === 'TEXTAREA') {
        editor.value = snippet + (editor.value || '');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        inserted = true;
      }
    }
    if (inserted) {
      showJumpToast('已填入支线追问前缀');
      return;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(snippet).then(
        () => showJumpToast('已复制追问引用，按 Ctrl+V 粘贴'),
        () => showJumpToast('未能写入输入框，请手动输入 /btw')
      );
    } else {
      showJumpToast('未能写入输入框，请手动输入 /btw');
    }
  }

  function stepTurn(delta) {
    if (!prefs.outline) return;
    const nav = getConversationNavSnapshot();
    if (!nav.total) {
      showJumpToast('当前视图暂无可跳转的提问轮次');
      return;
    }
    const next = Math.max(0, Math.min(nav.total - 1, nav.activeIndex + delta));
    nav.jumpTo(next);
  }

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function closeTopFloatingPanel(restoreFocus = false) {
    // Unified overlay priority stack: Image Context Menu > Suite Popover > Outline Drawer > Inline Editor
    const imgMenu = document.getElementById('ag-ps-img-menu');
    if (imgMenu && imgMenu.isConnected) {
      if (typeof window.__agPrismCloseImageMenu === 'function') {
        try { window.__agPrismCloseImageMenu(); } catch { imgMenu.remove(); }
      } else {
        imgMenu.remove();
      }
      return true;
    }
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      closePopoverAnimated(true);
      syncToolbarActiveStates();
      if (restoreFocus) document.getElementById('ag-ps-btn-suite')?.focus();
      return true;
    }
    const drawer = document.getElementById('ag-ps-outline');
    if (drawer && drawer.getAttribute('data-open') === '1') {
      closeOutlineAnimated(true);
      syncToolbarActiveStates();
      if (restoreFocus) document.getElementById('ag-ps-btn-outline')?.focus();
      return true;
    }
    const inlineEd = document.querySelector('.ag-ps-inline-editor');
    if (inlineEd && inlineEd.isConnected) {
      if (typeof window.__agPrismCloseInlineEditor === 'function') {
        try { window.__agPrismCloseInlineEditor(); } catch { inlineEd.remove(); }
      } else {
        inlineEd.remove();
      }
      return true;
    }
    return false;
  }

  function onGlobalKeyDown(e) {
    if (disposed || !e || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      if (closeTopFloatingPanel(true)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      }
      return;
    }
    if (!prefs.outline) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const tEl = e.target && typeof e.target.closest === 'function'
        ? e.target
        : (document.activeElement && typeof document.activeElement.closest === 'function' ? document.activeElement : null);
      if (tEl && tEl.closest('.monaco-editor, .xterm, [role="code"]')) return;
      const editable = isEditableTarget(e.target) || Boolean(tEl && isEditableTarget(tEl));
      if (editable && !(tEl && tEl.closest('[data-testid="conversation-view"]'))) return;
      const inAgentInput = Boolean(tEl && tEl.closest('[id="antigravity.agentSidePanelInputBox"]'));
      const canStepArrow = e.shiftKey ? inAgentInput : !editable;
      if (e.key === 'ArrowUp' && canStepArrow) {
        e.preventDefault();
        stepTurn(-1);
      } else if (e.key === 'ArrowDown' && canStepArrow) {
        e.preventDefault();
        stepTurn(1);
      } else if (!e.shiftKey && (e.key || '').toLowerCase() === 'o' && !editable) {
        e.preventDefault();
        toggleOutlineDrawer();
      }
    }
  }
  window.addEventListener('keydown', onGlobalKeyDown, true);
  onCleanup(() => window.removeEventListener('keydown', onGlobalKeyDown, true));

  let resizeRaf = 0;
  function onWindowResize() {
    if (disposed || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') {
        positionFloatingPanel(pop, document.getElementById('ag-ps-btn-suite'));
      }
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        positionFloatingPanel(drawer, document.getElementById('ag-ps-btn-outline'));
      }
      syncMascotCompactGuard();
    });
  }
  window.addEventListener('resize', onWindowResize, { passive: true });
  onCleanup(() => {
    window.removeEventListener('resize', onWindowResize);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  });

  const outlineTextCache = new WeakMap();
  const registeredOutlineActions = [];

  function getCachedTurnText(el) {
    if (!el) return '';
    const rawLen = el.textContent ? el.textContent.length : 0;
    const prev = outlineTextCache.get(el);
    if (prev && prev.len === rawLen) return prev.txt;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    outlineTextCache.set(el, { len: rawLen, txt });
    return txt;
  }

  function hydrateAllOutlinePreviews(nav) {
    if (!nav || nav.mode !== 'host' || nav.total <= 0) return;
    // Hydrate uncached older turns in 48-turn windows from newest to oldest
    const centers = [];
    for (let c = nav.total - 1; c >= 0; c -= 40) centers.push(c);
    let idx = 0;
    const stepNext = () => {
      if (disposed || idx >= centers.length) return;
      const drawer = document.getElementById('ag-ps-outline');
      if (!drawer || drawer.getAttribute('data-open') !== '1') return;
      const center = centers[idx++];
      nav.ensurePreviews(center, 24, () => {
        const inp = drawer.querySelector('.ag-ps-outline-search');
        renderOutlineList(inp ? inp.value : '', true);
      }).then(() => {
        if (!disposed) setTimeout(stepNext, 20);
      });
    };
    stepNext();
  }

  function renderOutlineList(filter = '', skipHydrate = false) {
    const drawer = document.getElementById('ag-ps-outline');
    if (!drawer) return;
    const list = drawer.querySelector('.ag-ps-outline-list');
    if (!list) return;
    const nav = getConversationNavSnapshot();
    const curIdx = nav.activeIndex;
    const q = String(filter || '').trim().toLowerCase();
    const items = [];
    let missingAny = false;
    for (let i = 0; i < nav.total; i++) {
      const rawTxt = nav.getPreview(i);
      if (!rawTxt) missingAny = true;
      const txt = rawTxt || `第 ${i + 1} 轮提问（加载摘要中…）`;
      if (q && !txt.toLowerCase().includes(q)) continue;
      items.push({ idx: i, txt, isCurrent: i === curIdx, hasDom: Boolean(nav.getDomEl(i)) });
    }
    const countEl = drawer.querySelector('.ag-ps-outline-count');
    if (countEl) countEl.textContent = `共 ${nav.total} 轮`;
    if (missingAny && !skipHydrate) {
      hydrateAllOutlinePreviews(nav);
    }

    if (!items.length) {
      list.innerHTML = `<div style="padding:14px 8px;text-align:center;color:var(--muted-foreground)">暂无匹配提问（快捷键 Alt+↑/↓ 跳轮）</div>`;
      return;
    }
    const extraBtns = (idx, hasDom) =>
      hasDom
        ? registeredOutlineActions
            .map(
              (act) =>
                `<button type="button" class="ag-ps-outline-btw ag-ps-outline-act" data-outline-act="${escapeHtml(act.id)}" data-act-idx="${idx}" data-ag-ps-tip="${escapeHtml(act.title || act.label)}">${escapeHtml(act.label)}</button>`
            )
            .join('')
        : '';
    list.innerHTML = items
      .map(
        (it) =>
          `<div class="ag-ps-outline-item" role="listitem"${it.isCurrent ? ' aria-current="true"' : ''}>
            <button type="button" class="ag-ps-outline-main" data-turn-idx="${it.idx}">
              <span class="ag-ps-outline-idx">#${it.idx + 1}</span>
              <span class="ag-ps-outline-txt" data-ag-ps-tip="${escapeHtml(it.txt)}">${escapeHtml(it.txt.slice(0, 60))}</span>
            </button>
            ${extraBtns(it.idx, it.hasDom)}
            <button type="button" class="ag-ps-outline-btw" data-btw-idx="${it.idx}" data-ag-ps-tip="针对此轮内容发起支线追问">追问</button>
          </div>`
      )
      .join('');
  }

  function ensureOutlineDrawer() {
    let drawer = document.getElementById('ag-ps-outline');
    if (drawer) return drawer;
    drawer = document.createElement('div');
    drawer.id = 'ag-ps-outline';
    drawer.setAttribute('data-ag-i18n-ignore', '1');
    drawer.innerHTML = `
      <div class="ag-ps-outline-hdr">
        <span style="font-weight:600;font-size:12.5px;letter-spacing:-0.015em">会话大纲</span>
        <span class="ag-ps-outline-count ag-ps-pop-meta">0 轮</span>
      </div>
      <input type="text" class="ag-ps-outline-search" placeholder="筛选提问关键词… (Alt+↑/↓ 跳轮 · Esc 关)" />
      <div class="ag-ps-outline-list" role="list"></div>
    `;
    const input = drawer.querySelector('.ag-ps-outline-search');
    input.addEventListener('input', () => renderOutlineList(input.value));
    drawer.addEventListener('click', (e) => {
      e.stopPropagation();
      const nav = getConversationNavSnapshot();
      const actEl = e.target.closest('[data-outline-act]');
      if (actEl) {
        e.stopPropagation();
        const actId = actEl.getAttribute('data-outline-act');
        const idx = Number(actEl.getAttribute('data-act-idx'));
        const act = registeredOutlineActions.find((a) => a.id === actId);
        const domEl = nav.getDomEl(idx);
        if (act && typeof act.onClick === 'function' && domEl) {
          try { act.onClick(idx, domEl, buildBusHelpers()); } catch {}
        }
        closeOutlineAnimated(true);
        syncToolbarActiveStates();
        return;
      }
      const btw = e.target.closest('[data-btw-idx]');
      if (btw) {
        e.stopPropagation();
        const idx = Number(btw.getAttribute('data-btw-idx'));
        const txt = nav.getPreview(idx);
        if (txt) insertBtwQuote(txt);
        closeOutlineAnimated(true);
        syncToolbarActiveStates();
        return;
      }
      const row = e.target.closest('[data-turn-idx]');
      if (row) {
        const idx = Number(row.getAttribute('data-turn-idx'));
        if (nav.jumpTo(idx)) {
          renderOutlineList(input ? input.value : '', true);
        }
      }
    });
    document.body.appendChild(drawer);
    onCleanup(() => drawer.remove());
    return drawer;
  }

  function positionFloatingPanel(panelEl, anchorBtn) {
    if (!panelEl) return;
    const rect = anchorBtn && anchorBtn.isConnected ? anchorBtn.getBoundingClientRect() : null;
    const topPx = rect ? Math.max(48, Math.round(rect.bottom + 8)) : 78;
    const widthPx = panelEl.offsetWidth || (panelEl.id === 'ag-ps-outline' ? 292 : 316);
    let leftPx = rect ? Math.round(rect.right - widthPx) : window.innerWidth - widthPx - 16;
    leftPx = Math.max(12, Math.min(window.innerWidth - widthPx - 12, leftPx));
    panelEl.style.top = `${topPx}px`;
    panelEl.style.left = `${leftPx}px`;
    panelEl.style.right = 'auto';
    panelEl.style.maxHeight = `calc(100vh - ${topPx + 14}px)`;
  }

  function toggleOutlineDrawer(forceState) {
    const drawer = ensureOutlineDrawer();
    closePopoverAnimated(false);
    const open = typeof forceState === 'boolean' ? forceState : drawer.getAttribute('data-open') !== '1';
    if (open) {
      hideCustomTooltip();
      try {
        window.dispatchEvent(new CustomEvent('ag-prism-close-popovers', { detail: { except: 'outline' } }));
      } catch {}
      cancelOutlineClose(drawer);
      drawer.setAttribute('data-open', '1');
      positionFloatingPanel(drawer, document.getElementById('ag-ps-btn-outline'));
      const input = drawer.querySelector('.ag-ps-outline-search');
      if (input) input.value = '';
      renderOutlineList('');
    } else {
      closeOutlineAnimated(false);
    }
    syncToolbarActiveStates();
    notifyOverlayChange();
  }

  /* ==========================================================================
   * 3. Usage Book Yardstick + Weekday-Aligned 12-Week Heatmap
   * ========================================================================== */
  const BOOK_YARDSTICKS = [
    { name: '《道德经》', unit: '本', tokens: 7600 },
    { name: '《小王子》', unit: '本', tokens: 21000 },
    { name: '《变形记》', unit: '本', tokens: 28000 },
    { name: '《老人与海》', unit: '本', tokens: 36000 },
    { name: '《浮士德》', unit: '本', tokens: 54000 },
    { name: '《围城》', unit: '本', tokens: 180000 },
    { name: '《三体》全集', unit: '套', tokens: 880000 },
    { name: '《红楼梦》', unit: '部', tokens: 960000 },
    { name: '《哈利·波特》全集', unit: '套', tokens: 1450000 },
    { name: '《大英百科全书》', unit: '套', tokens: 55000000 },
    { name: '《四库全书》', unit: '部', tokens: 550000000 }
  ];

  function pickBookYardstick(totalTokens) {
    const t = Number(totalTokens) || 0;
    if (t < 1500) return '刚翻开扉页';
    let chosen = BOOK_YARDSTICKS[0];
    for (const b of BOOK_YARDSTICKS) {
      if (t >= b.tokens * 0.75) chosen = b;
    }
    const mult = t / chosen.tokens;
    const multStr = mult >= 100 ? Math.round(mult).toString() : mult >= 10 ? mult.toFixed(1) : mult.toFixed(2).replace(/\.?0+$/, '');
    return `≈ ${multStr} ${chosen.unit}${chosen.name}`;
  }

  function computeStreakDays(hist) {
    if (!Array.isArray(hist) || !hist.length) return 0;
    let streak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if ((Number(hist[i].totalTokens) || 0) > 0) streak += 1;
      else if (i === hist.length - 1) continue; // Allow today still 0 when checking yesterday streak
      else break;
    }
    return streak;
  }

  let heatCache = { ts: 0, data: null };
  let heatInFlight = null;
  let heatPartialTimer = 0;
  let bookScopeIdx = 0; // 0: 12周, 1: 今日

  function ensureHeatmapData(force = false) {
    if (!prefs.usageExtra || typeof window.__agProjectCall !== 'function') return null;
    const now = Date.now();
    if (!force && heatCache.data && !heatCache.data.partial && now - heatCache.ts < 30000) {
      return heatCache.data;
    }
    if (!heatInFlight) {
      heatInFlight = Promise.resolve(window.__agProjectCall('getUsageSummary', { days: 84, force: Boolean(force) }, 10000))
        .then((res) => {
          if (disposed || !res || !res.ok) return;
          heatCache = { ts: Date.now(), data: res };
          syncUsageExtraMount();
          if (res.partial && !document.hidden) {
            clearTimeout(heatPartialTimer);
            heatPartialTimer = setTimeout(() => {
              heatPartialTimer = 0;
              if (!disposed && prefs.usageExtra && !document.hidden) ensureHeatmapData(true);
            }, 1100);
          }
        })
        .catch(() => {})
        .finally(() => { heatInFlight = null; });
    }
    return heatCache.data;
  }
  onCleanup(() => {
    clearTimeout(heatPartialTimer);
    document.querySelectorAll('.ag-ps-usage-extra').forEach((n) => n.remove());
  });

  function syncUsageExtraMount() {
    const cardBody = document.querySelector('#ag-claude-ov-sections [data-ov-card="usage"] .ag-ov-card-body');
    const existing = cardBody && cardBody.querySelector('.ag-ps-usage-extra');
    if (!prefs.usageExtra) {
      if (existing) existing.remove();
      return;
    }
    if (!cardBody) return;
    const data = ensureHeatmapData(false);
    if (!data || !Array.isArray(data.dailyHistory) || !data.dailyHistory.length) return;

    const hist = data.dailyHistory;
    const scopeTokens = bookScopeIdx === 0 ? data.totalWindowTokens : (data.today ? data.today.totalTokens : 0);
    const scopeLbl = bookScopeIdx === 0 ? '近12周' : '今日';
    const bookText = pickBookYardstick(scopeTokens);
    const sig = `${data.todayDate}|${data.totalWindowTokens}|${data.today?.totalTokens}|${data.partial ? 1 : 0}|${bookScopeIdx}|${prefs.tokenUnit || 'wan'}`;

    if (existing && existing.getAttribute('data-sig') === sig) return;

    const maxTok = hist.reduce((m, d) => Math.max(m, Number(d.totalTokens) || 0), 0);
    const activeDays = hist.filter((d) => (Number(d.totalTokens) || 0) > 0).length;
    const streak = computeStreakDays(hist);
    const avgActive = activeDays > 0 ? Math.round(data.totalWindowTokens / activeDays) : 0;
    const defaultMeta = data.partial
      ? `同步中 · 活跃 ${activeDays} 天`
      : `连续 ${streak} 天 · 活跃日均 ${fmtTokens(avgActive)}`;

    // Align grid rows strictly to Monday (0) .. Sunday (6)
    const firstParts = String(hist[0].date || '').split('-').map(Number);
    const firstDate = firstParts.length === 3 ? new Date(firstParts[0], firstParts[1] - 1, firstParts[2]) : new Date();
    const leadPads = (firstDate.getDay() + 6) % 7;

    const padHtml = Array.from({ length: leadPads }, () => `<span class="ag-ps-heat-cell is-pad" aria-hidden="true"></span>`).join('');
    const cellsHtml = hist
      .map((d) => {
        const tot = Number(d.totalTokens) || 0;
        let lv = 0;
        if (tot > 0 && maxTok > 0) {
          const r = tot / maxTok;
          lv = r >= 0.72 ? 4 : r >= 0.42 ? 3 : r >= 0.16 ? 2 : 1;
        }
        const tip = tot > 0 ? `${d.label} · ${fmtTokens(tot)} · ${d.activeSessions}会话` : `${d.label} · 无消耗`;
        return `<span class="ag-ps-heat-cell" data-lv="${lv}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(`${d.date}: ${fmtTokens(tot)} (${d.activeSessions} 会话)`)}"></span>`;
      })
      .join('');

    const wrap = existing || document.createElement('div');
    const scopeSwitched = Boolean(
      existing && existing.hasAttribute('data-scope') && existing.getAttribute('data-scope') !== String(bookScopeIdx)
    );
    wrap.className = 'ag-ps-usage-extra';
    wrap.setAttribute('data-sig', sig);
    wrap.setAttribute('data-scope', String(bookScopeIdx));
    wrap.innerHTML = `
      <div class="ag-ps-book-row" role="button" tabindex="0"${scopeSwitched && !isEffectivelyReducedMotion() ? ' data-switching="1"' : ''} title="点击切换 今日 / 近12周 名著换算（基于精确总量 ${fmtTokens(scopeTokens)}）">
        <span class="ag-ov-muted">📚 ${scopeLbl}体量</span>
        <span class="ag-ps-book-val">${escapeHtml(bookText)}</span>
      </div>
      <div class="ag-ps-heat-hdr">
        <span class="ag-ov-muted">12 周热力图</span>
        <span class="ag-ps-heat-meta ag-ov-tabular" data-default="${escapeHtml(defaultMeta)}">${escapeHtml(defaultMeta)}</span>
      </div>
      <div class="ag-ps-heat-grid">${padHtml}${cellsHtml}</div>
      <div class="ag-ps-heat-foot ag-ov-tabular">
        <span>周一→周日</span>
        <span>活跃 ${activeDays} / ${hist.length} 天</span>
      </div>
    `;
    if (!existing) {
      wrap.addEventListener('click', (e) => {
        if (e.target.closest('.ag-ps-book-row')) {
          bookScopeIdx = (bookScopeIdx + 1) % 2;
          syncUsageExtraMount();
        }
      });
      wrap.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.ag-ps-book-row')) {
          e.preventDefault();
          bookScopeIdx = (bookScopeIdx + 1) % 2;
          syncUsageExtraMount();
          wrap.querySelector('.ag-ps-book-row')?.focus({ preventScroll: true });
        }
      });
      wrap.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.ag-ps-heat-cell[data-tip]');
        if (!cell) return;
        const meta = wrap.querySelector('.ag-ps-heat-meta');
        if (meta) {
          meta.textContent = cell.getAttribute('data-tip') || defaultMeta;
          meta.setAttribute('data-hover', '1');
        }
      });
      wrap.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.ag-ps-heat-cell');
        if (!cell || (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.ag-ps-heat-cell'))) return;
        const meta = wrap.querySelector('.ag-ps-heat-meta');
        if (meta) {
          meta.textContent = meta.getAttribute('data-default') || defaultMeta;
          meta.removeAttribute('data-hover');
        }
      });
      cardBody.appendChild(wrap);
    }
  }

  /* ==========================================================================
   * 4. Zero-Latency 5-Stage Ink Stream Fade-In
   *    - NEVER observes document.body (0.0ms impact on typing in composer)
   *    - Attaches ONLY to [data-testid="autoscroll-viewport"] while generating
   *    - Reuses 5 persistent Highlight instances + 30fps throttling
   * ========================================================================== */
  const SUPPORTS_HIGHLIGHTS = typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight === 'function';
  const INK_NAMES = ['ag-ps-ink-1', 'ag-ps-ink-2', 'ag-ps-ink-3', 'ag-ps-ink-4', 'ag-ps-ink-5'];
  const INK_HIGHLIGHTS = SUPPORTS_HIGHLIGHTS ? INK_NAMES.map(() => new Highlight()) : [];
  const INK_DURATION_MS = 320;
  const INK_FRAME_INTERVAL_MS = 33; // ~30fps cap even on 144Hz/300Hz monitors
  let inkEntries = [];
  let inkRafId = 0;
  let lastInkTickMs = 0;
  const seenTextLens = new WeakMap();

  function clearInkHighlights() {
    if (inkRafId) {
      cancelAnimationFrame(inkRafId);
      inkRafId = 0;
    }
    inkEntries = [];
    if (SUPPORTS_HIGHLIGHTS) {
      for (let i = 0; i < INK_NAMES.length; i++) {
        try {
          INK_HIGHLIGHTS[i].clear();
          CSS.highlights.delete(INK_NAMES[i]);
        } catch {}
      }
    }
  }

  function tickInkFade(now) {
    inkRafId = 0;
    if (disposed || !prefs.inkStream || isEffectivelyReducedMotion() || !SUPPORTS_HIGHLIGHTS || !inkEntries.length) {
      clearInkHighlights();
      return;
    }
    if (now - lastInkTickMs < INK_FRAME_INTERVAL_MS) {
      inkRafId = requestAnimationFrame(tickInkFade);
      return;
    }
    lastInkTickMs = now;
    for (let i = 0; i < 5; i++) INK_HIGHLIGHTS[i].clear();
    const alive = [];
    for (const item of inkEntries) {
      const age = now - item.startMs;
      if (age >= INK_DURATION_MS) continue;
      if (!item.range || !item.range.startContainer || !item.range.startContainer.isConnected) continue;
      const stage = Math.min(4, Math.floor((age / INK_DURATION_MS) * 5));
      INK_HIGHLIGHTS[stage].add(item.range);
      alive.push(item);
    }
    inkEntries = alive;
    for (let i = 0; i < 5; i++) {
      try {
        if (INK_HIGHLIGHTS[i].size > 0) CSS.highlights.set(INK_NAMES[i], INK_HIGHLIGHTS[i]);
        else CSS.highlights.delete(INK_NAMES[i]);
      } catch {}
    }
    if (inkEntries.length) {
      inkRafId = requestAnimationFrame(tickInkFade);
    }
  }

  function pushInkRange(textNode, fromIdx, toIdx) {
    if (mascotWaitingDoze) wakeMascotFromWait();
    else if (!mascotFirstTokenSeen) mascotFirstTokenSeen = true;
    if (!SUPPORTS_HIGHLIGHTS || !prefs.inkStream || isEffectivelyReducedMotion() || !textNode || textNode.nodeType !== 3) return;
    if (toIdx <= fromIdx || toIdx > textNode.length) return;
    try {
      const range = document.createRange();
      range.setStart(textNode, fromIdx);
      range.setEnd(textNode, toIdx);
      inkEntries.push({ range, startMs: performance.now() });
      if (inkEntries.length > 36) inkEntries = inkEntries.slice(-36);
      if (!inkRafId) inkRafId = requestAnimationFrame(tickInkFade);
    } catch {}
  }

  let streamObserver = null;
  let observedStreamVp = null;

  function detachStreamObserver() {
    if (streamObserver) {
      streamObserver.disconnect();
      streamObserver = null;
    }
    observedStreamVp = null;
  }

  function syncStreamObserver(isBusy) {
    if (disposed || !prefs.inkStream || isEffectivelyReducedMotion() || !SUPPORTS_HIGHLIGHTS || !isBusy || document.hidden) {
      detachStreamObserver();
      if (!isBusy) clearInkHighlights();
      return;
    }
    const vp = getActiveViewportEl();
    if (!vp) return;
    if (streamObserver && observedStreamVp === vp) return;
    detachStreamObserver();
    observedStreamVp = vp;
    streamObserver = new MutationObserver((mutations) => {
      if (disposed || !prefs.inkStream) return;
      for (const m of mutations) {
        if (m.type === 'characterData' && m.target && m.target.nodeType === 3) {
          const parent = m.target.parentElement;
          if (!parent || parent.closest('pre, code') || !parent.closest('[data-testid="planner-response-text"]')) continue;
          const prevLen = seenTextLens.get(m.target) || 0;
          const curLen = m.target.length;
          seenTextLens.set(m.target, curLen);
          if (curLen > prevLen) pushInkRange(m.target, prevLen, curLen);
        } else if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          const host = m.target && m.target.nodeType === 1 ? m.target : m.target?.parentElement;
          if (!host || host.closest('pre, code') || !host.closest('[data-testid="planner-response-text"]')) continue;
          for (const n of m.addedNodes) {
            if (n.nodeType === 3 && n.length > 0 && n.length <= 240) {
              seenTextLens.set(n, n.length);
              pushInkRange(n, 0, n.length);
            }
          }
        }
      }
    });
    streamObserver.observe(vp, { childList: true, subtree: true, characterData: true });
  }
  onCleanup(() => {
    detachStreamObserver();
    clearInkHighlights();
  });

  function isAgentGenerating() {
    const vp = getActiveViewportEl();
    const convView = (vp && vp.closest && vp.closest('[data-testid="conversation-view"]'))
      || (getActiveInputBox()?.closest?.('[data-testid="conversation-view"]'))
      || null;
    if (convView) {
      return Boolean(convView.querySelector('[data-testid="input-cancel-button"]'));
    }
    return Boolean(document.querySelector('[data-testid="input-cancel-button"]'));
  }

  /* ==========================================================================
   * 5. Composer Pixel Mascots (12 Original Crisp 12x11 Pixel SVGs, 0fps Idle)
   * ========================================================================== */
  const SVG_CRAB = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="2" width="1" height="2" fill="#E06C3A"/><rect x="9" y="2" width="1" height="2" fill="#E06C3A"/>
    <rect x="1" y="3" width="1" height="2" fill="#F28552"/><rect x="10" y="3" width="1" height="2" fill="#F28552"/>
    <rect x="3" y="3" width="6" height="5" fill="#EA7541"/><rect x="2" y="4" width="8" height="3" fill="#EA7541"/>
    <rect x="4" y="3" width="2" height="1" fill="#FDBA74"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="2" y="8" width="1" height="2" fill="#C9592B"/><rect x="4" y="8" width="1" height="2" fill="#C9592B"/>
    <rect x="7" y="8" width="1" height="2" fill="#C9592B"/><rect x="9" y="8" width="1" height="2" fill="#C9592B"/>
  </svg>`;

  const SVG_CAT = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="1" width="2" height="2" fill="#8B5CF6"/><rect x="8" y="1" width="2" height="2" fill="#8B5CF6"/>
    <rect x="3" y="2" width="1" height="1" fill="#F9A8D4"/><rect x="8" y="2" width="1" height="1" fill="#F9A8D4"/>
    <rect x="2" y="3" width="8" height="5" fill="#9D76FA"/><rect x="4" y="2" width="4" height="1" fill="#9D76FA"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="4" y="4" width="1" height="1" fill="#EDE9FE"/><rect x="7" y="4" width="1" height="1" fill="#EDE9FE"/>
    <rect x="5" y="6" width="2" height="1" fill="#F9A8D4"/>
    <rect x="3" y="8" width="2" height="2" fill="#7C3AED"/><rect x="7" y="8" width="2" height="2" fill="#7C3AED"/>
    <rect x="10" y="6" width="1" height="3" fill="#8B5CF6"/>
  </svg>`;

  const SVG_SLIME = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="4" y="3" width="4" height="1" fill="#60A5FA"/>
    <rect x="3" y="4" width="6" height="1" fill="#60A5FA"/>
    <rect x="4" y="4" width="2" height="1" fill="#BAE6FD"/>
    <rect x="2" y="5" width="8" height="4" fill="#3B82F6"/>
    <rect x="3" y="9" width="6" height="1" fill="#2563EB"/>
    <rect x="4" y="6" width="1" height="1" fill="#FFFFFF"/><rect x="7" y="6" width="1" height="1" fill="#FFFFFF"/>
    <rect x="4" y="7" width="1" height="1" fill="#1E3A8A"/><rect x="7" y="7" width="1" height="1" fill="#1E3A8A"/>
  </svg>`;

  const SVG_FROG = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="2" width="2" height="2" fill="#22C55E"/><rect x="8" y="2" width="2" height="2" fill="#22C55E"/>
    <rect x="2" y="2" width="1" height="1" fill="#FFFFFF"/><rect x="9" y="2" width="1" height="1" fill="#FFFFFF"/>
    <rect x="3" y="2" width="1" height="1" fill="#18181B"/><rect x="8" y="2" width="1" height="1" fill="#18181B"/>
    <rect x="2" y="4" width="8" height="4" fill="#4ADE80"/>
    <rect x="3" y="5" width="1" height="1" fill="#FCA5A5"/><rect x="8" y="5" width="1" height="1" fill="#FCA5A5"/>
    <rect x="4" y="6" width="4" height="2" fill="#BBF7D0"/>
    <rect x="2" y="8" width="2" height="2" fill="#16A34A"/><rect x="8" y="8" width="2" height="2" fill="#16A34A"/>
  </svg>`;

  const SVG_CHICK = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="5" y="1" width="2" height="1" fill="#EA580C"/>
    <rect x="3" y="2" width="6" height="6" fill="#FBBF24"/>
    <rect x="4" y="2" width="2" height="1" fill="#FEF08A"/>
    <rect x="2" y="4" width="8" height="3" fill="#F59E0B"/>
    <rect x="4" y="4" width="1" height="1" fill="#18181B"/><rect x="7" y="4" width="1" height="1" fill="#18181B"/>
    <rect x="5" y="5" width="2" height="1" fill="#EA580C"/>
    <rect x="4" y="8" width="1" height="2" fill="#D97706"/><rect x="7" y="8" width="1" height="2" fill="#D97706"/>
  </svg>`;

  const SVG_BUNNY = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="3" y="0" width="2" height="3" fill="#F472B6"/><rect x="7" y="0" width="2" height="3" fill="#F472B6"/>
    <rect x="4" y="1" width="1" height="2" fill="#FCE7F3"/><rect x="7" y="1" width="1" height="2" fill="#FCE7F3"/>
    <rect x="3" y="3" width="6" height="5" fill="#F9A8D4"/>
    <rect x="2" y="4" width="8" height="3" fill="#F472B6"/>
    <rect x="4" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="5" y="6" width="2" height="1" fill="#FFFFFF"/>
    <rect x="3" y="8" width="2" height="2" fill="#DB2777"/><rect x="7" y="8" width="2" height="2" fill="#DB2777"/>
  </svg>`;

  const SVG_FOX = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="1" width="2" height="2" fill="#EA580C"/><rect x="7" y="1" width="2" height="2" fill="#EA580C"/>
    <rect x="2" y="1" width="1" height="1" fill="#431407"/><rect x="8" y="1" width="1" height="1" fill="#431407"/>
    <rect x="2" y="3" width="7" height="5" fill="#F97316"/>
    <rect x="4" y="3" width="3" height="1" fill="#FB923C"/>
    <rect x="2" y="6" width="2" height="2" fill="#FFF7ED"/><rect x="7" y="6" width="2" height="2" fill="#FFF7ED"/>
    <rect x="4" y="7" width="3" height="2" fill="#FFFFFF"/>
    <rect x="3" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="4" width="1" height="1" fill="#FFEDD5"/><rect x="7" y="4" width="1" height="1" fill="#FFEDD5"/>
    <rect x="5" y="6" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="8" width="1" height="2" fill="#431407"/><rect x="7" y="8" width="1" height="2" fill="#431407"/>
    <rect x="9" y="5" width="2" height="4" fill="#EA580C"/><rect x="10" y="4" width="2" height="2" fill="#FFFFFF"/>
  </svg>`;

  const SVG_SHIBA = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="1" width="2" height="2" fill="#D97706"/><rect x="7" y="1" width="2" height="2" fill="#D97706"/>
    <rect x="2" y="3" width="7" height="5" fill="#F59E0B"/>
    <rect x="4" y="4" width="1" height="1" fill="#FFFFFF"/><rect x="6" y="4" width="1" height="1" fill="#FFFFFF"/>
    <rect x="3" y="5" width="1" height="1" fill="#18181B"/><rect x="7" y="5" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="6" width="5" height="2" fill="#FEFCE8"/><rect x="4" y="8" width="3" height="1" fill="#FFFFFF"/>
    <rect x="5" y="6" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="8" width="1" height="2" fill="#D97706"/><rect x="7" y="8" width="1" height="2" fill="#D97706"/>
    <rect x="9" y="4" width="2" height="3" fill="#F59E0B"/><rect x="10" y="4" width="1" height="1" fill="#FEFCE8"/>
  </svg>`;

  const SVG_PENGUIN = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="3" y="1" width="6" height="2" fill="#1E293B"/>
    <rect x="4" y="1" width="2" height="1" fill="#475569"/>
    <rect x="2" y="3" width="8" height="6" fill="#0F172A"/>
    <rect x="1" y="5" width="1" height="3" fill="#1E293B"/><rect x="10" y="5" width="1" height="3" fill="#1E293B"/>
    <rect x="3" y="4" width="6" height="5" fill="#F8FAFC"/>
    <rect x="5" y="3" width="2" height="2" fill="#0F172A"/>
    <rect x="4" y="4" width="1" height="1" fill="#18181B"/><rect x="7" y="4" width="1" height="1" fill="#18181B"/>
    <rect x="4" y="3" width="1" height="1" fill="#FFFFFF"/><rect x="7" y="3" width="1" height="1" fill="#FFFFFF"/>
    <rect x="5" y="5" width="2" height="1" fill="#F59E0B"/>
    <rect x="3" y="9" width="2" height="1" fill="#EA580C"/><rect x="7" y="9" width="2" height="1" fill="#EA580C"/>
  </svg>`;

  const SVG_OWLET = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="1" width="2" height="1" fill="#78350F"/><rect x="8" y="1" width="2" height="1" fill="#78350F"/>
    <rect x="2" y="2" width="8" height="7" fill="#92400E"/>
    <rect x="1" y="4" width="1" height="4" fill="#78350F"/><rect x="10" y="4" width="1" height="4" fill="#78350F"/>
    <rect x="3" y="3" width="2" height="2" fill="#FBBF24"/><rect x="7" y="3" width="2" height="2" fill="#FBBF24"/>
    <rect x="3" y="3" width="1" height="1" fill="#FEF3C7"/><rect x="8" y="3" width="1" height="1" fill="#FEF3C7"/>
    <rect x="4" y="4" width="1" height="1" fill="#18181B"/><rect x="7" y="4" width="1" height="1" fill="#18181B"/>
    <rect x="5" y="5" width="2" height="1" fill="#F59E0B"/>
    <rect x="4" y="6" width="4" height="3" fill="#FDE68A"/>
    <rect x="4" y="7" width="1" height="1" fill="#92400E"/><rect x="7" y="7" width="1" height="1" fill="#92400E"/><rect x="5" y="8" width="2" height="1" fill="#92400E"/>
    <rect x="4" y="9" width="1" height="1" fill="#D97706"/><rect x="7" y="9" width="1" height="1" fill="#D97706"/>
  </svg>`;

  const SVG_AXOLOTL = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="1" y="2" width="1" height="1" fill="#F43F5E"/><rect x="0" y="4" width="2" height="1" fill="#FB7185"/><rect x="1" y="6" width="1" height="1" fill="#F43F5E"/>
    <rect x="10" y="2" width="1" height="1" fill="#F43F5E"/><rect x="10" y="4" width="2" height="1" fill="#FB7185"/><rect x="10" y="6" width="1" height="1" fill="#F43F5E"/>
    <rect x="3" y="2" width="6" height="1" fill="#FBCFE8"/>
    <rect x="2" y="3" width="8" height="5" fill="#F9A8D4"/>
    <rect x="4" y="6" width="4" height="2" fill="#FDF2F8"/>
    <rect x="3" y="4" width="1" height="1" fill="#18181B"/><rect x="8" y="4" width="1" height="1" fill="#18181B"/>
    <rect x="3" y="5" width="1" height="1" fill="#F43F5E"/><rect x="8" y="5" width="1" height="1" fill="#F43F5E"/>
    <rect x="5" y="5" width="2" height="1" fill="#DB2777"/>
    <rect x="3" y="8" width="2" height="2" fill="#F472B6"/><rect x="7" y="8" width="2" height="2" fill="#F472B6"/>
    <rect x="9" y="7" width="2" height="2" fill="#FB7185"/>
  </svg>`;

  const SVG_ROBOT = `<svg class="ag-ps-sprite" viewBox="0 0 12 11" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="5" y="0" width="2" height="1" fill="#22D3EE"/><rect x="5" y="1" width="2" height="1" fill="#64748B"/>
    <rect x="2" y="2" width="8" height="6" fill="#94A3B8"/>
    <rect x="3" y="2" width="6" height="1" fill="#CBD5E1"/>
    <rect x="1" y="4" width="1" height="2" fill="#475569"/><rect x="10" y="4" width="1" height="2" fill="#475569"/>
    <rect x="3" y="4" width="6" height="2" fill="#0F172A"/>
    <rect x="4" y="4" width="1" height="1" fill="#38BDF8"/><rect x="7" y="4" width="1" height="1" fill="#38BDF8"/>
    <rect x="4" y="5" width="1" height="1" fill="#A5F3FC"/><rect x="7" y="5" width="1" height="1" fill="#A5F3FC"/>
    <rect x="5" y="6" width="2" height="1" fill="#22D3EE"/>
    <rect x="3" y="7" width="6" height="1" fill="#64748B"/>
    <rect x="3" y="8" width="2" height="2" fill="#334155"/><rect x="7" y="8" width="2" height="2" fill="#334155"/>
  </svg>`;

  const SPRITE_CATALOG = [
    { id: 'crab', name: '橘蟹', emoji: '🦀', svg: SVG_CRAB, lines: ['钳子蓄力，缓存命中稳稳的 ✨', '横行无阻，构建一遍过 🦀', '主控钳就位，Token 省到极致！'] },
    { id: 'cat', name: '紫猫', emoji: '🐱', svg: SVG_CAT, lines: ['喵～零重排丝滑如猫步 🐾', '踩踩键盘，灵感自动补全 ✨', '呼噜呼噜，空闲稳稳 0fps 💤'] },
    { id: 'slime', name: '蓝萌', emoji: '💧', svg: SVG_SLIME, lines: ['Q 弹水墨淡入，一点不卡顿 💧', '软乎乎接住所有边界情况 ✨', '内存干干净净，毫无泄漏 🫧'] },
    { id: 'frog', name: '翡翠蛙', emoji: '🐸', svg: SVG_FROG, lines: ['呱！跳过所有深坑直达绿灯 🐸', '荷叶待命，输入延迟 0ms ⚡', '稳稳落地，自检全绿通过 ✅'] },
    { id: 'chick', name: '闪电鸡', emoji: '🐤', svg: SVG_CHICK, lines: ['叽叽！首字响应快如闪电 ⚡', '小翅膀扇风，吞吐量拉满 🚀', '精神饱满，随时准备冲刺 🐤'] },
    { id: 'bunny', name: '樱花兔', emoji: '🐰', svg: SVG_BUNNY, lines: ['竖起长耳朵盯紧像素对齐 🐰', '高分屏整数坐标，字字锐利 ✨', '蹦蹦跳跳把界面打磨到发光 🌸'] },
    { id: 'fox', name: '极客赤狐', emoji: '🦊', svg: SVG_FOX, lines: ['嗅觉敏锐，根因一抓一个准 🦊', '翻遍上下文，绝不漏掉细节 🔍', '蓬松大尾巴扫清一切死角 ✨'] },
    { id: 'shiba', name: '守护柴犬', emoji: '🐕', svg: SVG_SHIBA, lines: ['汪！代码防线巡逻完毕，零 Bug 🐕', '乐观锁看门中，草稿稳如泰山 🛡️', '摇摇卷尾，守护每一次提交 ✨'] },
    { id: 'penguin', name: 'WSL 企鹅', emoji: '🐧', svg: SVG_PENGUIN, lines: ['WSL 跨盘路径已就绪，丝滑互通 🐧', 'Linux 内核级冷静，零挂起秒回 ❄️', '拍拍雪白肚皮，终端命令稳稳落地 ⚡'] },
    { id: 'owlet', name: '博学猫头鹰', emoji: '🦉', svg: SVG_OWLET, lines: ['琥珀大眼交叉二审，逻辑严丝合缝 🦉', '架构全貌尽收眼底，零盲区 ✨', '咕咕～边界条件全部核验完毕 📚'] },
    { id: 'axolotl', name: '霓虹六角恐龙', emoji: '🦎', svg: SVG_AXOLOTL, lines: ['六角外鳃接收灵感电波中 🌈', '微动效丝滑再生，像素级治愈 ✨', '保持微笑，复杂交互也能很轻盈 💖'] },
    { id: 'robot', name: '棱镜小机甲', emoji: '🤖', svg: SVG_ROBOT, lines: ['小天线满格，多模型协同在线 🤖', 'GPU 合成层引擎全开，空闲 0fps ⚡', '棱镜光谱校准完成，随时出击 🔷'] }
  ];
  const SPRITE_BY_ID = Object.fromEntries(SPRITE_CATALOG.map((s) => [s.id, s]));
  const SPRITE_POOL = SPRITE_CATALOG.map((s) => s.svg);
  const MAX_DYNAMIC_ACTORS = 8;
  const actorSkinOverrides = new Map();

  function hashString(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getCurrentCascadeIdFromUrl() {
    const m = String(window.location.pathname || '').match(/\/c\/([0-9a-f-]{36})/i);
    return m ? m[1] : (window.__ag_watched_cascade_id || '');
  }

  function getLiveSubagents() {
    const metrics = window.__ag_last_metrics;
    const curId = getCurrentCascadeIdFromUrl();
    if (!metrics || !metrics.stats || !Array.isArray(metrics.stats.children)) return [];
    if (curId && metrics.cascadeId && metrics.cascadeId !== curId) return [];
    // Strictly filter to actively running subagents so completed/idle subagents trigger exit animation & leave zero residue
    return metrics.stats.children
      .filter((c) => c && !c.killed && Boolean(c.running))
      .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  }

  const ROLE_THEME_RULES = [
    { re: /wsl|linux|ubuntu|distro|installer|shell|bash|ops|deploy|docker|nas/i, ids: ['penguin', 'robot'] },
    { re: /ui|ux|frontend|css|design|motion|canvas|svg|workbench|theme|visual|前端|界面/i, ids: ['bunny', 'axolotl', 'cat'] },
    { re: /review|audit|security|verify|qa|test|check|guard|safe|审计|审查|安全|测试/i, ids: ['owlet', 'shiba'] },
    { re: /research|search|explore|doc|read|analy|investigat|radar|upstream|调研|检索|分析/i, ids: ['fox', 'owlet'] },
    { re: /mcp|hub|model|council|bridge|browser|api|proto|rpc|swarm|模型|会诊/i, ids: ['robot', 'slime', 'chick'] }
  ];

  function pickDistinctSpriteSpec(preferredIds, fallbackSeed, usedIds) {
    for (let i = 0; i < preferredIds.length; i++) {
      const spec = SPRITE_BY_ID[preferredIds[i]];
      if (spec && !usedIds.has(spec.id)) return spec;
    }
    const nonCoordCount = SPRITE_CATALOG.length - 1;
    const startOffset = hashString(fallbackSeed) % nonCoordCount;
    for (let step = 0; step < nonCoordCount; step++) {
      const cand = SPRITE_CATALOG[1 + ((startOffset + step) % nonCoordCount)];
      if (cand && !usedIds.has(cand.id)) return cand;
    }
    if (preferredIds.length && SPRITE_BY_ID[preferredIds[0]]) {
      return SPRITE_BY_ID[preferredIds[0]];
    }
    return SPRITE_CATALOG[1 + startOffset];
  }

  function pickSubagentSpriteSpec(sub, idx, actorKey, usedIds) {
    const overrideId = actorSkinOverrides.get(actorKey);
    if (overrideId && SPRITE_BY_ID[overrideId]) return SPRITE_BY_ID[overrideId];
    const hint = `${sub.agentName || ''} ${sub.title || ''} ${sub.role || ''}`;
    let preferred = [];
    for (let r = 0; r < ROLE_THEME_RULES.length; r++) {
      if (ROLE_THEME_RULES[r].re.test(hint)) {
        preferred = ROLE_THEME_RULES[r].ids;
        break;
      }
    }
    return pickDistinctSpriteSpec(preferred, String(sub.id || hint || idx), usedIds);
  }

  function makeFixedMascotEntry(key, defaultSpriteId, defaultLabel, busy) {
    const overrideId = actorSkinOverrides.get(key);
    const spec = (overrideId && SPRITE_BY_ID[overrideId]) || SPRITE_BY_ID[defaultSpriteId] || SPRITE_CATALOG[0];
    const label = overrideId && overrideId !== defaultSpriteId ? `${spec.name}伙伴` : defaultLabel;
    return {
      key,
      label,
      spriteId: spec.id,
      svg: spec.svg,
      busy: Boolean(busy)
    };
  }

  function buildMascotRoster(busy) {
    if (prefs.mascotCountMode === 'agents') {
      const subs = getLiveSubagents();
      // If overflow (> 7), prioritize running workers in selection, then sort stably by id so DOM never churns mid-roam
      const selectedSubs =
        subs.length > MAX_DYNAMIC_ACTORS - 1
          ? subs
              .slice()
              .sort((a, b) => {
                if (Boolean(b.running) !== Boolean(a.running)) return b.running ? 1 : -1;
                return String(a.id || '').localeCompare(String(b.id || ''));
              })
              .slice(0, MAX_DYNAMIC_ACTORS - 1)
              .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
          : subs;
      const visibleSubs = selectedSubs;
      const overflow = Math.max(0, subs.length - visibleSubs.length);
      const coordOverride = actorSkinOverrides.get('coordinator');
      const coordSpec = (coordOverride && SPRITE_BY_ID[coordOverride]) || SPRITE_BY_ID.crab;
      const usedIds = new Set([coordSpec.id]);
      const roster = [
        {
          key: 'coordinator',
          label: '主控 Agent',
          spriteId: coordSpec.id,
          svg: coordSpec.svg,
          busy: Boolean(busy)
        }
      ];
      for (let i = 0; i < visibleSubs.length; i++) {
        const sub = visibleSubs[i];
        const name = sub.agentName || sub.title || `子 Agent #${i + 1}`;
        const subKey = `sub:${sub.id || i}`;
        const spec = pickSubagentSpriteSpec(sub, i, subKey, usedIds);
        usedIds.add(spec.id);
        roster.push({
          key: subKey,
          label: name,
          spriteId: spec.id,
          svg: spec.svg,
          busy: Boolean(sub.running)
        });
      }
      // Guarantee user-selected floor count (1..3) so composer is never empty when no subagents are active
      const floorCount = clampMascotMinCount(prefs.mascotMinCount);
      const fillerDefs = [
        { key: 'floor:cat', defaultId: 'cat', label: '紫猫' },
        { key: 'floor:slime', defaultId: 'slime', label: '蓝萌' }
      ];
      let fi = 0;
      while (roster.length < floorCount && fi < fillerDefs.length) {
        const f = fillerDefs[fi++];
        const ovId = actorSkinOverrides.get(f.key);
        const fSpec = (ovId && SPRITE_BY_ID[ovId]) || pickDistinctSpriteSpec([f.defaultId], f.key, usedIds);
        usedIds.add(fSpec.id);
        roster.push({
          key: f.key,
          label: ovId ? fSpec.name : f.label,
          spriteId: fSpec.id,
          svg: fSpec.svg,
          busy: Boolean(busy)
        });
      }
      return { roster, overflow, liveSubCount: subs.length };
    }
    const styleKey = prefs.mascotStyle || 'trio';
    let fixedItems;
    if (styleKey === 'crab') {
      fixedItems = [makeFixedMascotEntry('fixed:crab', 'crab', '橘蟹伙伴', busy)];
    } else if (styleKey === 'cat') {
      fixedItems = [makeFixedMascotEntry('fixed:cat', 'cat', '紫猫伙伴', busy)];
    } else if (styleKey === 'penguin') {
      fixedItems = [makeFixedMascotEntry('fixed:penguin', 'penguin', 'WSL 企鹅', busy)];
    } else if (styleKey === 'fox') {
      fixedItems = [makeFixedMascotEntry('fixed:fox', 'fox', '极客赤狐', busy)];
    } else if (styleKey === 'zoo') {
      fixedItems = [
        makeFixedMascotEntry('fixed:fox', 'fox', '极客赤狐', busy),
        makeFixedMascotEntry('fixed:shiba', 'shiba', '守护柴犬', busy),
        makeFixedMascotEntry('fixed:penguin', 'penguin', 'WSL 企鹅', busy)
      ];
    } else if (styleKey === 'cyber') {
      fixedItems = [
        makeFixedMascotEntry('fixed:robot', 'robot', '棱镜小机甲', busy),
        makeFixedMascotEntry('fixed:owlet', 'owlet', '博学猫头鹰', busy),
        makeFixedMascotEntry('fixed:axolotl', 'axolotl', '霓虹六角恐龙', busy)
      ];
    } else {
      fixedItems = [
        makeFixedMascotEntry('fixed:crab', 'crab', '橘蟹伙伴', busy),
        makeFixedMascotEntry('fixed:cat', 'cat', '紫猫伙伴', busy),
        makeFixedMascotEntry('fixed:slime', 'slime', '蓝萌伙伴', busy)
      ];
    }
    return { roster: fixedItems, overflow: 0, liveSubCount: 0 };
  }

  const CHEER_LINES = ['代码一遍过 ✨', '缓存命中稳稳的', '摸摸头，继续冲！', '0fps 节能待机中', '今天效率拉满 🚀'];
  const COMBO_LINES = [
    'SSR 暴击 ×5！全员人浪祈福 · 今日代码零回滚 🌟',
    '连击 ×5 共鸣达成！送你 99% 缓存命中锦鲤 🍀',
    '全员起立欢呼 🎉 灵感暴击 +999，Bug 退散！',
    '触发隐藏人浪彩蛋 ✨ 祝你把把一遍过 🚀'
  ];
  const SLEEP_WAKE_LINES = [
    '呼噜…醒啦！伸个懒腰随时待命 ⚡',
    '揉揉像素眼 🫧 满电复活，继续冲！',
    '刚刚在 0fps 省电打盹，一戳秒醒 ✨'
  ];
  const LATE_NIGHT_LINES = [
    '夜深啦，代码交给我们盯，记得喝水早点休息 🌙',
    '凌晨还在打磨细节，辛苦啦～注意护眼喔 🍵',
    '星光不负赶路人 ✨ 跑完这轮就去睡个好觉吧 🌙',
    '深夜静音巡航中 🌙 愿你今晚零报错好梦'
  ];

  function isLateNightHour() {
    const hr = new Date().getHours();
    return hr >= 23 || hr < 5;
  }
  let wasMascotBusy = false;
  let mascotCheerUntil = 0;
  let mascotIdleSince = Date.now();
  let mascotBubbleTimer = 0;
  let mascotRoamingActive = false;
  let mascotActors = []; // [{ key, label, busy, el, emoteEl, emoteText, emoteTempUntil, tapTimes, x, facing, moveTimer, settleTimer, clickTimer, roaming }]
  let lastTrackWidth = 0;
  let lastRosterSig = '';
  let mascotSnapRaf = 0;
  let mascotBusyStartedAt = 0;
  let mascotBusyStartLen = 0;
  let mascotFirstTokenSeen = true;
  let mascotWaitingDoze = false;
  let lastHighFiveAt = 0;

  function setActorEmote(actor, text, isSleepZ = false, tempMs = 0) {
    if (!actor || !actor.emoteEl) return;
    const now = Date.now();
    if (tempMs > 0) {
      actor.emoteTempUntil = now + tempMs;
      if (actor.emoteTimer) clearTimeout(actor.emoteTimer);
      actor.emoteTimer = setTimeout(() => {
        actor.emoteTimer = 0;
        actor.emoteTempUntil = 0;
        if (!disposed && actor.emoteEl?.isConnected) {
          actor.emoteText = '';
          actor.emoteEl.textContent = '';
          actor.emoteEl.removeAttribute('data-show');
          actor.emoteEl.removeAttribute('data-sleep-z');
        }
      }, tempMs);
    } else if (actor.emoteTempUntil > now) {
      return; // Let transient high-five / combo emote finish
    }
    const want = String(text || '');
    if (actor.emoteText !== want) {
      actor.emoteText = want;
      actor.emoteEl.textContent = want;
    }
    if (want) {
      actor.emoteEl.setAttribute('data-show', '1');
      if (isSleepZ) actor.emoteEl.setAttribute('data-sleep-z', '1');
      else actor.emoteEl.removeAttribute('data-sleep-z');
    } else {
      actor.emoteEl.removeAttribute('data-show');
      actor.emoteEl.removeAttribute('data-sleep-z');
    }
  }

  function sampleLatestResponseLen() {
    const vp = getActiveViewportEl();
    if (!vp) return 0;
    const resps = vp.querySelectorAll('[data-testid="planner-response-text"], [data-testid="agent-response"]');
    if (resps.length) {
      const last = resps[resps.length - 1];
      return (last && last.textContent ? last.textContent.length : 0);
    }
    return 0;
  }

  function detectLeadStatusEmote(mainBusy) {
    // 1. High context pressure or cache collapse warning (O(1) memory check)
    const stats = window.__ag_last_metrics && window.__ag_last_metrics.stats;
    const curId = getCurrentCascadeIdFromUrl();
    if (stats && (!curId || !window.__ag_last_metrics.cascadeId || window.__ag_last_metrics.cascadeId === curId)) {
      if (stats.cacheCollapsed || (Number(stats.pct) || 0) >= 85) {
        return { icon: '💦', tip: '上下文偏高或缓存波动，可考虑 /compact' };
      }
    }
    if (!mainBusy) return { icon: '', tip: '' };
    if (mascotWaitingDoze) return { icon: '…', tip: '等待模型首字输出中' };
    // 2. Lightweight stage hint: tool call vs deep thinking
    if (document.querySelector('.animate-shimmer-text')) {
      return { icon: '🔧', tip: '工具执行中' };
    }
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    if (triggers.length) {
      const lastTxt = (triggers[triggers.length - 1].textContent || '').trim();
      if (lastTxt && !/\d+\s*s\b|\d+\s*秒|已思考|Thought\s+for/i.test(lastTxt)) {
        return { icon: '💡', tip: '深度思考中' };
      }
    }
    return { icon: '', tip: '' };
  }

  function wakeMascotFromWait() {
    if (!mascotWaitingDoze) return;
    mascotFirstTokenSeen = true;
    mascotWaitingDoze = false;
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (!dock || !mascotActors.length) return;
    mascotActors.forEach((a) => {
      if (a.el && a.el.getAttribute('data-act') === 'doze') {
        a.el.removeAttribute('data-act');
        const ms = triggerActorTrick(a, 'leap');
        if (a.clickTimer) clearTimeout(a.clickTimer);
        a.clickTimer = setTimeout(() => {
          a.clickTimer = 0;
          if (a.el?.getAttribute('data-act') === 'leap') a.el.removeAttribute('data-act');
        }, ms);
      }
    });
    showMascotBubble('出字啦！冲冲冲 ⚡', 1700);
    syncMascotRoaming(dock);
  }

  function cancelSnapRaf() {
    if (mascotSnapRaf) {
      cancelAnimationFrame(mascotSnapRaf);
      mascotSnapRaf = 0;
    }
  }
  onCleanup(cancelSnapRaf);

  let mascotBubbleOwner = null;
  let lastObstacleSig = '';

  function syncBubbleEdgeAlign(bubble, actor, dock) {
    if (!bubble || !actor || !dock) return;
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    if (trackW <= 0) return;
    const { w } = getMascotDims();
    const center = actor.x + w / 2;
    if (center > trackW - 140) bubble.setAttribute('data-align', 'right');
    else if (center < 140) bubble.setAttribute('data-align', 'left');
    else bubble.removeAttribute('data-align');
  }

  function showMascotBubble(text, ms = 2000, actor = null) {
    const dock = document.getElementById('ag-ps-mascot-dock');
    const b = dock && dock.querySelector('.ag-ps-mascot-bubble');
    if (!b) return;
    const target = actor && actor.el?.isConnected ? actor : mascotActors[0] || null;
    if (target && target.el && b.parentElement !== target.el) {
      target.el.appendChild(b);
    }
    mascotBubbleOwner = target;
    syncBubbleEdgeAlign(b, target, dock);
    b.textContent = text;
    b.setAttribute('data-show', '1');
    clearTimeout(mascotBubbleTimer);
    mascotBubbleTimer = setTimeout(() => b.removeAttribute('data-show'), ms);
  }
  onCleanup(() => {
    clearTimeout(mascotBubbleTimer);
    mascotBubbleOwner = null;
  });

  function getMascotDims() {
    const w = Math.round(clampMascotSize(prefs.mascotSize)) | 0;
    const h = Math.max(14, Math.round((w * 11) / 12)) | 0;
    const gap = Math.max(4, Math.round(w * 0.22)) | 0;
    return { w, h, gap };
  }

  function getCurrentTokPerSec() {
    const el = document.getElementById('ag-live-metrics-text');
    const txt = (el && el.textContent) || (window.__ag_last_metrics && window.__ag_last_metrics.inlineHtml) || '';
    const m = String(txt).match(/(\d+(?:\.\d+)?)\s*tok\/s/i);
    if (!m) return 0;
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function getMascotSpeedScale() {
    const tps = getCurrentTokPerSec();
    if (tps <= 0) return 1;
    // Map ~30 tok/s -> 0.78x (calm), ~80 tok/s -> 1.0x (brisk), 180+ tok/s -> 2.0x (turbo)
    const raw = 0.62 + tps / 140;
    return Math.max(0.75, Math.min(2.05, raw));
  }

  function syncMascotSpeedVars(dock) {
    if (!dock) return 1;
    const scale = getMascotSpeedScale();
    const trot = Math.max(0.14, Math.min(0.36, 0.28 / scale));
    const roll = Math.max(0.24, Math.min(0.60, 0.46 / scale));
    dock.style.setProperty('--ag-ps-trot-dur', `${trot.toFixed(2)}s`);
    dock.style.setProperty('--ag-ps-roll-dur', `${roll.toFixed(2)}s`);
    return scale;
  }

  function clearActorTimers(actor) {
    if (!actor) return;
    if (actor.moveTimer) { clearTimeout(actor.moveTimer); actor.moveTimer = 0; }
    if (actor.settleTimer) { clearTimeout(actor.settleTimer); actor.settleTimer = 0; }
    if (actor.clickTimer) { clearTimeout(actor.clickTimer); actor.clickTimer = 0; }
    if (actor.emoteTimer) { clearTimeout(actor.emoteTimer); actor.emoteTimer = 0; }
    if (actor.enterTimer) { clearTimeout(actor.enterTimer); actor.enterTimer = 0; }
  }

  const mascotExitTimers = new Set();
  const mascotEggTimers = new Set();

  function scheduleEggTimer(fn, ms) {
    const id = setTimeout(() => {
      mascotEggTimers.delete(id);
      if (!disposed) fn();
    }, ms);
    mascotEggTimers.add(id);
    return id;
  }

  function clearMascotEggTimers() {
    for (const id of mascotEggTimers) {
      clearTimeout(id);
    }
    mascotEggTimers.clear();
  }
  onCleanup(clearMascotEggTimers);

  function clearAllMascotExitTimers(removeDom = false) {
    for (const entry of mascotExitTimers) {
      clearTimeout(entry.timer);
      if (removeDom && entry.el && entry.el.isConnected) {
        entry.el.remove();
      }
    }
    mascotExitTimers.clear();
  }

  function createMascotActorRecord(item, idx, isEntering = false) {
    const el = document.createElement('span');
    el.className = 'ag-ps-actor';
    el.setAttribute('data-actor-idx', String(idx));
    el.setAttribute('data-busy', item.busy ? '1' : '0');
    if (item.spriteId) el.setAttribute('data-sprite', item.spriteId);
    el.style.setProperty('--ag-ps-idx', String(idx));
    el.setAttribute('data-ag-ps-tip', `${item.label} · ${item.busy ? '运行中' : '待命'}`);
    el.setAttribute('data-ag-ps-tip-status', item.busy ? 'busy' : 'idle');
    el.innerHTML = `<span class="ag-ps-emote" aria-hidden="true"></span><span class="ag-ps-actor-body">${item.svg}</span>`;
    const rec = {
      key: item.key,
      label: item.label,
      spriteId: item.spriteId || 'crab',
      busy: item.busy,
      svg: item.svg,
      el,
      emoteEl: el.querySelector('.ag-ps-emote'),
      emoteText: '',
      emoteTempUntil: 0,
      emoteTimer: 0,
      enterTimer: 0,
      tapTimes: [],
      x: 0,
      facing: 1,
      moveTimer: 0,
      settleTimer: 0,
      clickTimer: 0,
      roaming: false
    };
    if (isEntering && !isEffectivelyReducedMotion()) {
      el.setAttribute('data-entering', '1');
      setActorEmote(rec, '⚡', false, 620);
      rec.enterTimer = setTimeout(() => {
        rec.enterTimer = 0;
        if (!disposed && el.isConnected) el.removeAttribute('data-entering');
      }, 560);
    }
    return rec;
  }

  function cancelMascotExitGhostByKey(key) {
    if (!key) return;
    for (const entry of Array.from(mascotExitTimers)) {
      if (entry.key === key) {
        clearTimeout(entry.timer);
        mascotExitTimers.delete(entry);
        if (entry.el && entry.el.isConnected) entry.el.remove();
      }
    }
  }

  function retireMascotActorWithExit(actor, dock, nextAnchorActor = null) {
    if (!actor) return;
    clearActorTimers(actor);
    if (actor.key && actor.key.startsWith('sub:')) {
      actorSkinOverrides.delete(actor.key);
    }
    actor.roaming = false;
    const el = actor.el;
    if (!el || !el.isConnected || !dock || !dock.isConnected) return;

    // Rescue shared speech bubble before retiring this actor's DOM node
    const bubble = el.querySelector('.ag-ps-mascot-bubble');
    if (bubble) {
      const validAnchor =
        nextAnchorActor &&
        nextAnchorActor.el &&
        nextAnchorActor.el.isConnected &&
        nextAnchorActor.el.getAttribute('data-exiting') !== '1'
          ? nextAnchorActor.el
          : dock;
      validAnchor.insertBefore(bubble, validAnchor.firstChild);
      if (mascotBubbleOwner === actor) {
        mascotBubbleOwner = validAnchor === dock ? null : nextAnchorActor;
      }
    }
    if (tipTarget && (tipTarget === el || el.contains(tipTarget))) {
      hideCustomTooltip();
    }

    if (isEffectivelyReducedMotion() || document.hidden) {
      el.remove();
      return;
    }

    el.removeAttribute('data-actor-idx');
    el.removeAttribute('data-act');
    el.removeAttribute('data-entering');
    el.removeAttribute('data-sleep');
    el.setAttribute('data-exiting', '1');
    if (actor.emoteEl) {
      actor.emoteEl.textContent = '✨';
      actor.emoteEl.setAttribute('data-show', '1');
      actor.emoteEl.removeAttribute('data-sleep-z');
    }
    const entry = {
      key: actor.key || '',
      el,
      timer: setTimeout(() => {
        mascotExitTimers.delete(entry);
        if (el.isConnected) el.remove();
      }, 700)
    };
    mascotExitTimers.add(entry);
  }

  function measureOrbDockZone(dock, dockRect) {
    if (!dock || !dockRect || dockRect.width <= 0) return null;
    if (document.documentElement.getAttribute('data-ag-ps-orb-replace') === '1') return null;
    const hostBox = dock.parentElement;
    const orbDock = (hostBox && hostBox.querySelector('#ag-ps-orb-dock')) || document.getElementById('ag-ps-orb-dock');
    if (!orbDock || !orbDock.isConnected || orbDock.hidden) return null;
    try {
      const cs = window.getComputedStyle(orbDock);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    } catch {}
    const orbBtn = orbDock.querySelector('.ag-ps-orb-btn');
    const btnRect = (orbBtn && orbBtn.isConnected ? orbBtn : orbDock).getBoundingClientRect();
    if (btnRect.width <= 0 || btnRect.height <= 0) return null;
    if (btnRect.bottom < dockRect.top - 18 || btnRect.top > dockRect.bottom + 18) return null;
    if (btnRect.right < dockRect.left - 12 || btnRect.left > dockRect.right + 12) return null;

    let orbLeft = btnRect.left;
    let orbRight = btnRect.right;

    const stage = orbDock.getAttribute('data-stage') || '';
    const activeStage = stage === 'thinking' || stage === 'tools' || stage === 'streaming' || stage === 'done';
    let hovered = orbDock.getAttribute('data-hover') === '1';
    if (!hovered && typeof orbDock.matches === 'function') {
      try { hovered = orbDock.matches(':hover'); } catch {}
    }
    if (activeStage || hovered) {
      const pill = orbDock.querySelector('.ag-ps-orb-pill');
      if (pill && pill.isConnected) {
        const pr = pill.getBoundingClientRect();
        if (pr.width > 0 && pr.height > 0) {
          orbLeft = Math.min(orbLeft, pr.left);
          orbRight = Math.max(orbRight, pr.right);
        }
      }
    }

    const zl = Math.max(0, Math.floor(orbLeft - dockRect.left - 8));
    const zr = Math.min(Math.ceil(dockRect.width), Math.ceil(orbRight - dockRect.left + 8));
    if (zr <= zl) return null;
    const isLeftSide = (orbLeft - dockRect.left) < dockRect.width * 0.45;
    return { zl, zr, isLeftSide };
  }

  function getMascotRunwayBounds(dock) {
    const trackW = dock ? (dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0) : 0;
    const { w } = getMascotDims();
    const hasBadge = Boolean(dock && dock.querySelector('.ag-ps-more-badge'));
    let minX = Math.min(92, Math.max(12, Math.round(trackW * 0.16)));
    if (dock && dock.isConnected && trackW > 0) {
      const dockRect = dock.getBoundingClientRect();
      if (dockRect.width > 0) {
        const orbZone = measureOrbDockZone(dock, dockRect);
        if (orbZone && orbZone.isLeftSide) {
          minX = Math.max(minX, Math.ceil(orbZone.zr));
        }
      }
    }
    const maxX = Math.max(minX, Math.round(trackW - (hasBadge ? 44 : 16) - w));
    return { trackW, w, minX, maxX, hasBadge };
  }

  function clampRoamingActorsInBounds(dock) {
    if (!dock || !mascotRoamingActive) return;
    const { trackW, minX, maxX } = getMascotRunwayBounds(dock);
    if (trackW <= 0) return;
    for (const actor of mascotActors) {
      if (!actor.roaming || !actor.el) continue;
      const clamped = Math.max(minX, Math.min(maxX, actor.x));
      if (Math.abs(clamped - actor.x) >= 1) {
        applyActorTransform(actor, clamped, actor.facing, 0.25);
      }
    }
  }

  function stopMascotRoaming(parkHome = true) {
    mascotRoamingActive = false;
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (dock) dock.removeAttribute('data-roaming');
    for (const actor of mascotActors) {
      clearActorTimers(actor);
      actor.roaming = false;
      if (actor.el) actor.el.removeAttribute('data-act');
    }
    if (parkHome && dock) {
      parkActorsHome(dock, false);
    }
  }
  onCleanup(() => stopMascotRoaming(false));

  /* ---- Smart Button-Obstacle Avoidance & Playful Pointer-Dodge for Mascots ---- */
  function scanDockObstacles(dock) {
    if (!dock || !dock.isConnected) return { zones: [], crowded: false, sig: '' };
    const dockRect = dock.getBoundingClientRect();
    if (!dockRect.width) return { zones: [], crowded: false, sig: '' };
    const { w, gap } = getMascotDims();
    const hostBox = dock.parentElement;
    // Match the actual mascot dock height (adapts automatically from 16px..36px) without probing inside inputBox
    const bandTop = dockRect.top - 6;
    const bandBottom = dockRect.bottom;
    const searchRoot = dock.closest('[data-testid="conversation-view"], main, [role="main"]') || document.body;
    if (!searchRoot) return { zones: [], crowded: false, sig: '' };

    const rawZones = [];
    const orbZone = measureOrbDockZone(dock, dockRect);
    if (orbZone) {
      rawZones.push([orbZone.zl, orbZone.zr]);
    }
    const controls = searchRoot.querySelectorAll('button, [role="button"], a[href], input:not([type="hidden"]), [role="tab"], [role="radio"]');
    for (let i = 0; i < controls.length; i++) {
      const el = controls[i];
      if (!el.isConnected || dock.contains(el)) continue;
      if (hostBox && hostBox.contains(el)) continue;
      if (el.closest('#ag-ps-popover, #ag-ps-tooltip, #ag-ps-outline, .ag-ps-turn-actions')) continue;
      if (el.id === 'ag-ps-orb-btn' || el.parentElement?.id === 'ag-ps-orb-dock') continue;
      // Scrolling chat messages/links inside autoscroll-viewport are NOT composer toolbar obstacles (unless inside a floating approval/question prompt)
      if (
        el.closest('[data-testid="autoscroll-viewport"]') &&
        !el.closest('[role="dialog"], [data-testid*="approval"], [data-testid*="question"], [data-testid*="confirm"]')
      ) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width > 280) continue;
      if (r.bottom < bandTop || r.top > bandBottom) continue;
      if (r.right < dockRect.left - 8 || r.left > dockRect.right + 8) continue;
      const l = Math.max(0, Math.floor(r.left - dockRect.left) - 10);
      const ri = Math.min(Math.ceil(dockRect.width), Math.ceil(r.right - dockRect.left) + 10);
      if (ri > l) rawZones.push([l, ri]);
    }
    if (!rawZones.length) return { zones: [], crowded: false, sig: '' };
    rawZones.sort((a, b) => a[0] - b[0]);
    const merged = [rawZones[0]];
    for (let i = 1; i < rawZones.length; i++) {
      const prev = merged[merged.length - 1];
      if (rawZones[i][0] <= prev[1] + 12) {
        prev[1] = Math.max(prev[1], rawZones[i][1]);
      } else {
        merged.push(rawZones[i]);
      }
    }

    const totalBlockedW = merged.reduce((sum, z) => sum + (z[1] - z[0]), 0);
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const rightBound = Math.max(12, Math.round(dockRect.width - (hasBadge ? 44 : 16)));
    const needW = mascotActors.length ? mascotActors.length * w + Math.max(0, mascotActors.length - 1) * gap : w;
    let cursor = 12;
    let maxFreeGap = 0;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i][0] > cursor) {
        maxFreeGap = Math.max(maxFreeGap, Math.min(rightBound, merged[i][0]) - cursor);
      }
      cursor = Math.max(cursor, merged[i][1]);
    }
    if (rightBound > cursor) {
      maxFreeGap = Math.max(maxFreeGap, rightBound - cursor);
    }
    const crowded = totalBlockedW > dockRect.width * 0.65 || (mascotActors.length > 0 && maxFreeGap < needW);
    const sig = `${crowded ? '1' : '0'}|${merged.map((z) => `${z[0]}:${z[1]}`).join(',')}`;
    return { zones: merged, crowded, sig };
  }

  function getDockObstacleZones(dock) {
    return scanDockObstacles(dock).zones;
  }

  function isIntervalBlocked(x, w, zones) {
    for (let i = 0; i < zones.length; i++) {
      if (x + w > zones[i][0] && x < zones[i][1]) return true;
    }
    return false;
  }

  function findNearestSafeX(curX, w, minX, maxX, zones, avoidLeft, avoidRight) {
    const allZones = avoidRight > avoidLeft ? [...zones, [avoidLeft, avoidRight]] : zones;
    let bestX = null;
    let bestDist = Infinity;
    for (let x = minX; x <= maxX; x += 6) {
      if (!isIntervalBlocked(x, w, allZones)) {
        const d = Math.abs(x - curX);
        if (d < bestDist) {
          bestDist = d;
          bestX = x;
        }
      }
    }
    return bestX;
  }

  function computeHomePositions(trackW, count, hasOverflowBadge, dock = null, scan = null) {
    const { w, gap } = getMascotDims();
    const rightPad = hasOverflowBadge ? 44 : 16;
    const totalW = count * w + Math.max(0, count - 1) * gap;
    const info = scan || (dock ? scanDockObstacles(dock) : { zones: [], crowded: false });
    const zones = info.zones || [];
    let minHomeX = 12;
    if (dock && dock.isConnected && trackW > 0) {
      const dr = dock.getBoundingClientRect();
      if (dr.width > 0) {
        const oz = measureOrbDockZone(dock, dr);
        if (oz && oz.isLeftSide) {
          minHomeX = Math.max(minHomeX, Math.ceil(oz.zr));
        }
      }
    }
    let anchorRight = trackW - rightPad;

    // If right-side controls (e.g. ^ / × or interactive card buttons) overlap default home, park neatly to their left
    for (let i = zones.length - 1; i >= 0; i--) {
      const [zl, zr] = zones[i];
      if (zr >= anchorRight - totalW && zl < anchorRight) {
        if (zl - 10 - totalW >= minHomeX) {
          anchorRight = zl - 10;
        }
      }
    }

    const startX = Math.max(minHomeX, Math.round(anchorRight - totalW));
    const xs = [];
    for (let i = 0; i < count; i++) {
      let cx = startX + i * (w + gap);
      if (zones.length && isIntervalBlocked(cx, w, zones)) {
        const safe = findNearestSafeX(cx, w, minHomeX, Math.max(minHomeX, trackW - rightPad - w), zones, 0, 0);
        if (safe !== null) cx = safe;
      }
      xs.push(cx);
    }
    return xs;
  }

  function positionMoreBadgeSafe(dock, xs, zones) {
    const badge = dock && dock.querySelector('.ag-ps-more-badge');
    if (!badge) return;
    if (!xs.length) {
      badge.hidden = true;
      return;
    }
    const { w } = getMascotDims();
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    const badgeW = Math.max(24, badge.offsetWidth || 26);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const candidates = [maxX + w + 6, minX - badgeW - 6];
    let chosen = null;
    for (const c of candidates) {
      const rounded = Math.round(c);
      if (rounded >= 6 && rounded + badgeW <= trackW - 6 && !isIntervalBlocked(rounded, badgeW, zones)) {
        chosen = rounded;
        break;
      }
    }
    if (chosen === null) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.style.left = `${chosen}px`;
      badge.style.right = 'auto';
    }
  }

  let dodgeHostEl = null;
  let dodgeHostAc = null;
  let lastDodgeCheckAt = 0;
  let dodgeRestoreTimer = 0;

  function detachMascotDodgeWatcher() {
    if (dodgeHostAc) {
      try { dodgeHostAc.abort(); } catch {}
      dodgeHostAc = null;
    }
    dodgeHostEl = null;
    if (dodgeRestoreTimer) {
      clearTimeout(dodgeRestoreTimer);
      dodgeRestoreTimer = 0;
    }
  }
  onCleanup(detachMascotDodgeWatcher);

  function ensureMascotDodgeWatcher(box) {
    if (!box) return;
    if (dodgeHostEl === window && dodgeHostAc) return;
    detachMascotDodgeWatcher();
    dodgeHostEl = window;
    dodgeHostAc = new AbortController();
    window.addEventListener(
      'pointermove',
      (e) => {
        if (disposed || !mascotActors.length) return;
        const now = Date.now();
        if (now - lastDodgeCheckAt < 80) return;
        lastDodgeCheckAt = now;
        const dock = document.getElementById('ag-ps-mascot-dock');
        if (!dock || !dock.isConnected || dock.getAttribute('data-yield') === '1') return;
        const dockRect = dock.getBoundingClientRect();
        if (!dockRect.width) return;
        const { w, h } = getMascotDims();
        if (e.clientY < dockRect.top - Math.max(h, 26) - 12 || e.clientY > dockRect.bottom + 14) return;
        const scan = scanDockObstacles(dock);
        if (scan.crowded) {
          dock.setAttribute('data-yield', '1');
          if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
          return;
        }
        const zones = scan.zones;
        if (!zones.length) return;
        const localPx = e.clientX - dockRect.left;
        const nearZone = zones.find(([zl, zr]) => localPx >= zl - 16 && localPx <= zr + 16);
        if (!nearZone) return;

        const { minX, maxX } = getMascotRunwayBounds(dock);
        let dodgedAny = false;
        for (const actor of mascotActors) {
          if (!actor.el || !actor.el.isConnected) continue;
          const overlapsPointerZone = actor.x + w > nearZone[0] - 10 && actor.x < nearZone[1] + 10;
          if (!overlapsPointerZone) continue;
          const safeX = findNearestSafeX(actor.x, w, minX, maxX, zones, nearZone[0] - 12, nearZone[1] + 12);
          if (safeX !== null && Math.abs(safeX - actor.x) >= 10) {
            const dir = safeX < actor.x ? -1 : 1;
            actor.el.setAttribute('data-dodging', '1');
            actor.el.setAttribute('data-act', 'run');
            applyActorTransform(actor, safeX, dir, 0.24);
            setActorEmote(actor, '💨', false, 680);
            if (tipTarget === actor.el) hideCustomTooltip();
            dodgedAny = true;
            setTimeout(() => {
              if (!disposed && actor.el?.isConnected) {
                actor.el.removeAttribute('data-dodging');
                if (actor.el.getAttribute('data-act') === 'run' && !actor.roaming) {
                  actor.el.removeAttribute('data-act');
                }
              }
            }, 420);
          } else {
            // No safe escape slot on runway: yield smoothly so button clicks pass straight through
            dock.setAttribute('data-yield', '1');
            if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
            dodgedAny = true;
            break;
          }
        }
        if (dodgedAny && !mascotRoamingActive) {
          clearTimeout(dodgeRestoreTimer);
          dodgeRestoreTimer = setTimeout(() => {
            dodgeRestoreTimer = 0;
            if (!disposed && !mascotRoamingActive) {
              const d2 = document.getElementById('ag-ps-mascot-dock');
              if (d2) {
                const s2 = scanDockObstacles(d2);
                if (!s2.crowded) d2.removeAttribute('data-yield');
                parkActorsHome(d2, false, false, s2);
              }
            }
          }, 2600);
        }
      },
      { passive: true, signal: dodgeHostAc.signal }
    );
  }

  function applyActorTransform(actor, x, facing, durSec) {
    if (!actor || !actor.el) return;
    actor.x = x;
    actor.facing = facing;
    actor.el.style.setProperty('--ag-ps-x', `${Math.round(x)}px`);
    actor.el.style.setProperty('--ag-ps-flip', String(facing));
    if (typeof durSec === 'number') {
      actor.el.style.setProperty('--ag-ps-dur', `${durSec.toFixed(2)}s`);
    }
    if (mascotBubbleOwner === actor) {
      const dock = actor.el.parentElement;
      const b = actor.el.querySelector('.ag-ps-mascot-bubble');
      if (b && b.getAttribute('data-show') === '1') syncBubbleEdgeAlign(b, actor, dock);
    }
  }

  function parkActorsHome(dock, instant, onlyIdleActors = false, scan = null) {
    if (!dock || !mascotActors.length) return;
    const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
    if (trackW <= 0) return;
    lastTrackWidth = trackW;
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const info = scan || scanDockObstacles(dock);
    const xs = computeHomePositions(trackW, mascotActors.length, hasBadge, dock, info);
    cancelSnapRaf();
    if (instant) dock.setAttribute('data-snap', '1');
    else dock.removeAttribute('data-snap');
    mascotActors.forEach((actor, idx) => {
      if (onlyIdleActors && actor.roaming) return;
      if (actor.el) actor.el.removeAttribute('data-act');
      applyActorTransform(actor, xs[idx], 1, instant ? 0 : 0.45);
    });
    positionMoreBadgeSafe(dock, xs, info.zones || []);
    if (instant) {
      mascotSnapRaf = requestAnimationFrame(() => {
        mascotSnapRaf = 0;
        if (!disposed && dock.isConnected) dock.removeAttribute('data-snap');
      });
    }
  }

  function triggerActorTrick(actor, preferredAct) {
    if (!actor || !actor.el) return 0;
    const facingRight = actor.facing >= 0;
    const isCalm = prefs.mascotVibe === 'calm';
    let act = preferredAct;
    if (!act) {
      const r = Math.random();
      if (isCalm) {
        if (r < 0.34) act = 'leap';
        else if (r < 0.62) act = 'jelly';
        else if (r < 0.84) act = 'wiggle';
        else act = 'dance';
      } else if (r < 0.22) {
        act = facingRight ? 'flip-r' : 'flip-l';
      } else if (r < 0.38) {
        act = 'spin-jump';
      } else if (r < 0.54) {
        act = 'leap';
      } else if (r < 0.68) {
        act = 'double-hop';
      } else if (r < 0.80) {
        act = 'jelly';
      } else if (r < 0.91) {
        act = 'dance';
      } else {
        act = 'wiggle';
      }
    }
    const durMap = {
      'combo-flip': 1340,
      dance: 880,
      'double-hop': 760,
      'flip-r': 740,
      'flip-l': 740,
      'spin-jump': 740,
      jelly: 720,
      wiggle: 680,
      leap: 640
    };
    const ms = durMap[act] || 680;
    actor.el.removeAttribute('data-act');
    void actor.el.offsetWidth;
    actor.el.setAttribute('data-act', act);
    return ms;
  }

  function tryBuddyHighFive(actor, idx) {
    if (!actor || prefs.mascotVibe === 'calm' || mascotActors.length < 2) return false;
    const now = Date.now();
    if (now - lastHighFiveAt < 6000) return false;
    const { w } = getMascotDims();
    const neighbor = mascotActors.find((other, oi) => {
      if (oi === idx || !other.el?.isConnected) return false;
      const act = other.el.getAttribute('data-act') || '';
      if (act === 'run' || act === 'roll-r' || act === 'roll-l' || act === 'combo-flip') return false;
      return Math.abs(other.x - actor.x) <= w + 20;
    });
    if (!neighbor || Math.random() > 0.52) return false;
    lastHighFiveAt = now;
    // Turn toward each other and share either a synchronized dance battle or a high-five hop
    const actorFacesRight = neighbor.x >= actor.x ? 1 : -1;
    applyActorTransform(actor, actor.x, actorFacesRight, 0.15);
    applyActorTransform(neighbor, neighbor.x, -actorFacesRight, 0.15);
    const doDance = Math.random() < 0.5;
    const sharedAct = doDance ? 'dance' : 'leap';
    const msA = triggerActorTrick(actor, sharedAct);
    const msB = triggerActorTrick(neighbor, sharedAct);
    const icon = doDance
      ? (Math.random() < 0.5 ? '🎵' : '🎶')
      : (Math.random() < 0.55 ? '🤝' : '⚡');
    setActorEmote(actor, icon, false, doDance ? 1050 : 900);
    setActorEmote(neighbor, icon, false, doDance ? 1050 : 900);
    if (neighbor.clickTimer) clearTimeout(neighbor.clickTimer);
    neighbor.clickTimer = setTimeout(() => {
      neighbor.clickTimer = 0;
      if (neighbor.el?.getAttribute('data-act') === sharedAct) neighbor.el.removeAttribute('data-act');
    }, msB);
    actor.settleTimer = setTimeout(() => {
      actor.settleTimer = 0;
      if (actor.el?.getAttribute('data-act') === sharedAct) actor.el.removeAttribute('data-act');
      scheduleActorRoamStep(idx);
    }, msA);
    return true;
  }

  function scheduleActorRoamStep(idx, initialDelayMs) {
    const actor = mascotActors[idx];
    if (!actor || !actor.roaming || !mascotRoamingActive || disposed || document.hidden || mascotWaitingDoze) return;
    clearActorTimers(actor);
    const isCalm = prefs.mascotVibe === 'calm';
    const delay = typeof initialDelayMs === 'number'
      ? initialDelayMs
      : (isCalm ? 1500 : 850) + Math.floor(Math.random() * (isCalm ? 2400 : 1850));

    actor.moveTimer = setTimeout(() => {
      actor.moveTimer = 0;
      if (!actor.roaming || !mascotRoamingActive || disposed || document.hidden || mascotWaitingDoze) return;
      const dock = document.getElementById('ag-ps-mascot-dock');
      if (!dock || !actor.el?.isConnected) return;
      const trackW = dock.clientWidth || 0;
      if (trackW < 480) {
        stopMascotRoaming(true);
        return;
      }
      const { w, minX, maxX } = getMascotRunwayBounds(dock);
      const span = maxX - minX;

      const roll = Math.random();
      const obstacleZones = getDockObstacleZones(dock);
      if (span >= w * 2 && roll < (isCalm ? 0.52 : 0.58)) {
        let targetX = actor.x;
        const minStep = Math.min(48, span * 0.25);
        for (let attempt = 0; attempt < 10; attempt++) {
          const cand = minX + Math.random() * span;
          if (Math.abs(cand - actor.x) < minStep) continue;
          if (obstacleZones.length && isIntervalBlocked(cand, w, obstacleZones)) continue;
          const crowded = mascotActors.some((o, oi) => oi !== idx && Math.abs(o.x - cand) < w + 8);
          targetX = cand;
          if (!crowded) break;
        }
        if (obstacleZones.length && isIntervalBlocked(targetX, w, obstacleZones)) {
          const safe = findNearestSafeX(targetX, w, minX, maxX, obstacleZones, 0, 0);
          if (safe !== null) targetX = safe;
        }
        const dist = Math.abs(targetX - actor.x);
        if (dist >= 10) {
          const vividBoost = prefs.performanceMode === 'vivid' ? 1.15 : 1;
          const speedScale = syncMascotSpeedVars(dock) * (isCalm ? 0.72 : 1) * vividBoost;
          const doRollDash = !isCalm && dist >= 65 && Math.random() < (speedScale >= 1.35 ? 0.42 : 0.26);
          const baseSpeed = doRollDash ? 115 + Math.random() * 45 : 88 + Math.random() * 48;
          const speed = baseSpeed * speedScale;
          const dur = Math.max(0.34, Math.min(2.6, dist / speed));
          const dir = targetX < actor.x ? -1 : 1;
          actor.el.setAttribute('data-act', doRollDash ? (dir > 0 ? 'roll-r' : 'roll-l') : 'run');
          applyActorTransform(actor, targetX, dir, dur);
          actor.settleTimer = setTimeout(() => {
            actor.settleTimer = 0;
            if (!actor.roaming || !mascotRoamingActive || disposed || !actor.el?.isConnected || mascotWaitingDoze) return;
            if (tryBuddyHighFive(actor, idx)) return;
            const landRoll = Math.random();
            if (landRoll < (isCalm ? 0.22 : 0.42)) {
              const trickMs = triggerActorTrick(actor);
              actor.settleTimer = setTimeout(() => {
                actor.settleTimer = 0;
                actor.el?.removeAttribute('data-act');
                scheduleActorRoamStep(idx);
              }, trickMs);
            } else {
              actor.el.removeAttribute('data-act');
              scheduleActorRoamStep(idx);
            }
          }, Math.round(dur * 1000) + 40);
          return;
        }
      }

      if (roll < (isCalm ? 0.78 : 0.90)) {
        const trickMs = triggerActorTrick(actor);
        actor.settleTimer = setTimeout(() => {
          actor.settleTimer = 0;
          actor.el?.removeAttribute('data-act');
          scheduleActorRoamStep(idx);
        }, trickMs);
      } else {
        applyActorTransform(actor, actor.x, actor.facing * -1, 0.2);
        actor.settleTimer = setTimeout(() => {
          actor.settleTimer = 0;
          if (!actor.roaming || !mascotRoamingActive || disposed || mascotWaitingDoze) return;
          applyActorTransform(actor, actor.x, actor.facing * -1, 0.2);
          scheduleActorRoamStep(idx, 900 + Math.floor(Math.random() * 1300));
        }, 520);
      }
    }, delay);
  }

  function syncMascotRoaming(dock) {
    if (!dock || !prefs.mascotRoam || prefs.performanceMode === 'power-save' || isEffectivelyReducedMotion() || document.hidden || mascotWaitingDoze || (dock.clientWidth || 0) < 480) {
      if (mascotRoamingActive) stopMascotRoaming(!mascotWaitingDoze);
      return;
    }
    const anyBusy = mascotActors.some((a) => a.busy);
    if (!anyBusy) {
      if (mascotRoamingActive) stopMascotRoaming(true);
      return;
    }
    mascotRoamingActive = true;
    dock.setAttribute('data-roaming', '1');
    const hasBadge = Boolean(dock.querySelector('.ag-ps-more-badge'));
    const homeXs = computeHomePositions(dock.clientWidth || 0, mascotActors.length, hasBadge, dock);
    mascotActors.forEach((actor, idx) => {
      if (actor.busy) {
        if (!actor.roaming) {
          actor.roaming = true;
          scheduleActorRoamStep(idx, 200 + idx * 280 + Math.floor(Math.random() * 260));
        }
      } else if (actor.roaming) {
        clearActorTimers(actor);
        actor.roaming = false;
        actor.el?.removeAttribute('data-act');
        applyActorTransform(actor, homeXs[idx], 1, 0.55);
      }
    });
  }

  function applyMascotSizeVars(dock, repositionHome) {
    const { w, h } = getMascotDims();
    // Single source of truth on :root so every conversation view inherits the global mascot size
    setStyleVarIfChanged(document.documentElement, '--ag-ps-sprite-w', `${w}px`);
    setStyleVarIfChanged(document.documentElement, '--ag-ps-sprite-h', `${h}px`);
    if (!dock) return;
    if (repositionHome) {
      parkActorsHome(dock, true, mascotRoamingActive);
      clampRoamingActorsInBounds(dock);
    }
  }
  applyMascotSizeVars(null, false);
  onCleanup(() => {
    setStyleVarIfChanged(document.documentElement, '--ag-ps-sprite-w', null);
    setStyleVarIfChanged(document.documentElement, '--ag-ps-sprite-h', null);
  });

  function syncMascotCompactGuard() {
    const box = getActiveInputBox();
    const dock = document.getElementById('ag-ps-mascot-dock');
    if (!box || !dock) return;
    const w = box.getBoundingClientRect().width;
    if (w > 0 && w < 420) {
      dock.setAttribute('data-compact-hide', '1');
      if (mascotRoamingActive) stopMascotRoaming(false);
      return;
    }
    dock.removeAttribute('data-compact-hide');
    if (w < 480 && mascotRoamingActive) {
      stopMascotRoaming(true);
    } else if (w > 0 && Math.abs(w - lastTrackWidth) > 2) {
      parkActorsHome(dock, true, mascotRoamingActive);
      clampRoamingActorsInBounds(dock);
    }
  }

  function handleMascotActorClick(e, dock) {
    const actorEl = e.target.closest('.ag-ps-actor:not([data-exiting="1"])');
    if (!actorEl) return;
    e.stopPropagation();
    const idx = Number(actorEl.getAttribute('data-actor-idx'));
    const actor = mascotActors[idx];
    const now = Date.now();
    const wasSleeping = dock.getAttribute('data-mood') === 'sleep';
    mascotIdleSince = now;
    mascotCheerUntil = now + 2000;
    if (wasSleeping) {
      dock.setAttribute('data-mood', 'calm');
    }

    if (!actor) {
      dock.setAttribute('data-mood', 'cheer');
      showMascotBubble(CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)], 2200, null);
      return;
    }

    // Easter Egg 1: Shift + Click => Instant pixel costume swap across 12 characters
    if (e.shiftKey && !e.altKey) {
      actor.tapTimes = [];
      const curSpecIdx = SPRITE_CATALOG.findIndex((s) => s.id === actor.spriteId);
      const nextSpec = SPRITE_CATALOG[(curSpecIdx + 1) % SPRITE_CATALOG.length];
      actorSkinOverrides.set(actor.key, nextSpec.id);
      actor.spriteId = nextSpec.id;
      actor.svg = nextSpec.svg;
      if (actor.key.startsWith('fixed:') || actor.key.startsWith('floor:')) {
        actor.label = actor.key.startsWith('fixed:') ? `${nextSpec.name}伙伴` : nextSpec.name;
      }
      actorEl.setAttribute('data-sprite', nextSpec.id);
      setAttrIfChanged(actorEl, 'data-ag-ps-tip', `${actor.label} · ${actor.busy ? '运行中' : '待命'}`);
      const bodySpan = actorEl.querySelector('.ag-ps-actor-body');
      if (bodySpan) bodySpan.innerHTML = nextSpec.svg;
      const curOverflow = dock.querySelector('.ag-ps-more-badge') ? Number((dock.querySelector('.ag-ps-more-badge').textContent || '').replace(/\D+/g, '')) || 0 : 0;
      lastRosterSig = `${prefs.mascotCountMode}|${curOverflow}|${mascotActors.map((a) => `${a.key}:${a.spriteId || ''}`).join(',')}`;

      const trickMs = triggerActorTrick(actor, 'spin-jump');
      setActorEmote(actor, '💨', false, 950);
      if (actor.clickTimer) clearTimeout(actor.clickTimer);
      actor.clickTimer = setTimeout(() => {
        actor.clickTimer = 0;
        if (actorEl.getAttribute('data-act') === 'spin-jump') actorEl.removeAttribute('data-act');
      }, trickMs);
      showMascotBubble(`噗——变身「${nextSpec.name}」${nextSpec.emoji}！`, 2300, actor);
      return;
    }

    // Easter Egg 3: Alt + Click => Squad emergency rally & synchronized high-five
    if (e.altKey && !e.shiftKey) {
      actor.tapTimes = [];
      clearMascotEggTimers();
      const trackW = dock.clientWidth || 0;
      if (mascotActors.length >= 2 && trackW >= 320) {
        const { w, minX, maxX } = getMascotRunwayBounds(dock);
        const zones = getDockObstacleZones(dock);
        const centerX = Math.max(minX, Math.min(maxX, actor.x));
        let peerRank = 0;
        mascotActors.forEach((peer) => {
          clearActorTimers(peer);
          if (peer === actor) {
            peer.el?.removeAttribute('data-act');
            return;
          }
          peerRank++;
          const side = peerRank % 2 === 1 ? -1 : 1;
          const distSlots = Math.ceil(peerRank / 2);
          let candX = Math.round(centerX + side * distSlots * (w + 6));
          candX = Math.max(minX, Math.min(maxX, candX));
          if (zones.length && isIntervalBlocked(candX, w, zones)) {
            const safe = findNearestSafeX(candX, w, minX, maxX, zones, 0, 0);
            if (safe !== null) candX = safe;
          }
          const dir = candX <= centerX ? 1 : -1;
          if (peer.el) peer.el.setAttribute('data-act', 'run');
          applyActorTransform(peer, candX, dir, 0.28);
        });
        scheduleEggTimer(() => {
          if (!dock.isConnected) return;
          mascotActors.forEach((a) => {
            if (!a.el?.isConnected) return;
            triggerActorTrick(a, a === actor ? 'spin-jump' : 'leap');
            setActorEmote(a, '🤝', false, 920);
          });
          showMascotBubble('🤝 小队集结完毕！协同火力全开', 2300, actor);
        }, 290);
        scheduleEggTimer(() => {
          if (!dock.isConnected) return;
          mascotActors.forEach((a) => a.el?.removeAttribute('data-act'));
          if (mascotRoamingActive) {
            mascotActors.forEach((a, i) => {
              if (a.busy) {
                a.roaming = true;
                scheduleActorRoamStep(i, 180 + i * 160);
              }
            });
          } else {
            parkActorsHome(dock, false);
          }
        }, 1250);
        return;
      }
      const soloMs = triggerActorTrick(actor, 'spin-jump');
      setActorEmote(actor, '🫡', false, 950);
      if (actor.clickTimer) clearTimeout(actor.clickTimer);
      actor.clickTimer = setTimeout(() => {
        actor.clickTimer = 0;
        if (actorEl.getAttribute('data-act') === 'spin-jump') actorEl.removeAttribute('data-act');
      }, soloMs);
      showMascotBubble('单兵就位！随时呼叫队友支援 ⚡', 2000, actor);
      return;
    }

    actor.tapTimes = (actor.tapTimes || []).filter((t) => now - t <= 2000);
    actor.tapTimes.push(now);
    const isCombo = actor.tapTimes.length >= 5;
    if (isCombo) actor.tapTimes = [];

    // Easter Egg 2: Combo x5 => Protagonist 3.5x somersault + full-runway Mexican Wave resonance
    if (isCombo) {
      clearActorTimers(actor);
      const trickMs = triggerActorTrick(actor, 'combo-flip');
      setActorEmote(actor, '🌟', false, 1650);
      if (actor.clickTimer) clearTimeout(actor.clickTimer);
      actor.clickTimer = setTimeout(() => {
        actor.clickTimer = 0;
        if (actorEl.getAttribute('data-act') === 'combo-flip') actorEl.removeAttribute('data-act');
        if (actor.roaming && mascotRoamingActive && !disposed) {
          scheduleActorRoamStep(idx, 500);
        }
      }, trickMs);

      const peers = mascotActors
        .map((p, pi) => ({ p, pi }))
        .filter((entry) => entry.p !== actor && entry.p.el?.isConnected)
        .sort((a, b) => a.p.x - b.p.x);
      peers.forEach(({ p, pi }, waveIdx) => {
        scheduleEggTimer(() => {
          if (!p.el?.isConnected) return;
          const curPeerAct = p.el.getAttribute('data-act') || '';
          const peerMoving = curPeerAct === 'run' || curPeerAct === 'roll-r' || curPeerAct === 'roll-l';
          if (peerMoving) clearActorTimers(p);
          const waveAct = waveIdx % 2 === 0 ? 'spin-jump' : 'double-hop';
          const wMs = triggerActorTrick(p, waveAct);
          setActorEmote(p, waveIdx % 2 === 0 ? '🎉' : '✨', false, 1100);
          if (p.clickTimer) clearTimeout(p.clickTimer);
          p.clickTimer = setTimeout(() => {
            p.clickTimer = 0;
            if (p.el?.getAttribute('data-act') === waveAct) p.el.removeAttribute('data-act');
            if (peerMoving && p.roaming && mascotRoamingActive && !disposed) {
              scheduleActorRoamStep(pi, 360);
            }
          }, wMs);
        }, (waveIdx + 1) * 90);
      });

      const ssrLine = COMBO_LINES[Math.floor(Math.random() * COMBO_LINES.length)];
      showMascotBubble(ssrLine, 2900, actor);
      return;
    }

    // Easter Egg 4b: Sleeping mascot poked awake => Q-bounce jelly stretch + sleepy bubble
    if (wasSleeping) {
      const wakeMs = triggerActorTrick(actor, 'jelly');
      setActorEmote(actor, '🫧', false, 1100);
      if (actor.clickTimer) clearTimeout(actor.clickTimer);
      actor.clickTimer = setTimeout(() => {
        actor.clickTimer = 0;
        if (actorEl.getAttribute('data-act') === 'jelly') actorEl.removeAttribute('data-act');
      }, wakeMs);
      const wakeLine = SLEEP_WAKE_LINES[Math.floor(Math.random() * SLEEP_WAKE_LINES.length)];
      const wakeMsg = prefs.mascotCountMode === 'agents' && actor.label ? `${actor.label}：${wakeLine}` : wakeLine;
      showMascotBubble(wakeMsg, 2300, actor);
      return;
    }

    const curAct = actorEl.getAttribute('data-act') || '';
    const isMoving = curAct === 'run' || curAct === 'roll-r' || curAct === 'roll-l';
    if (!isMoving) {
      const trickMs = triggerActorTrick(actor);
      if (actor.clickTimer) clearTimeout(actor.clickTimer);
      const appliedAct = actorEl.getAttribute('data-act');
      actor.clickTimer = setTimeout(() => {
        actor.clickTimer = 0;
        if (actorEl.getAttribute('data-act') === appliedAct) actorEl.removeAttribute('data-act');
      }, trickMs);
    }

    // Easter Egg 5: Character-specific persona lines + Late-night warm companion lines (23:00–05:00)
    let line = '';
    if (isLateNightHour() && Math.random() < 0.42) {
      line = LATE_NIGHT_LINES[Math.floor(Math.random() * LATE_NIGHT_LINES.length)];
      setActorEmote(actor, '🌙', false, 1100);
    } else {
      const spec = SPRITE_BY_ID[actor.spriteId];
      if (spec && Array.isArray(spec.lines) && spec.lines.length && Math.random() < 0.68) {
        line = spec.lines[Math.floor(Math.random() * spec.lines.length)];
      } else {
        line = CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)];
      }
    }
    const msg = prefs.mascotCountMode === 'agents' && actor.label ? `${actor.label}：${line}` : line;
    showMascotBubble(msg, 2200, actor);
  }

  function syncMascotDock(busy) {
    const box = getActiveInputBox();
    let dock = document.getElementById('ag-ps-mascot-dock');
    if (!prefs.mascot || !box) {
      stopMascotRoaming(false);
      clearMascotEggTimers();
      clearAllMascotExitTimers(true);
      mascotActors.forEach(clearActorTimers);
      mascotActors = [];
      lastRosterSig = '';
      if (dock) dock.remove();
      return;
    }
    const { roster, overflow } = buildMascotRoster(busy);
    const rosterSig = `${prefs.mascotCountMode}|${overflow}|${roster.map((r) => `${r.key}:${r.spriteId || ''}`).join(',')}`;
    let rebuilt = false;
    if (!dock || dock.parentElement !== box) {
      stopMascotRoaming(false);
      clearMascotEggTimers();
      clearAllMascotExitTimers(true);
      mascotActors.forEach(clearActorTimers);
      mascotActors = [];
      if (dock) dock.remove();
      dock = document.createElement('div');
      dock.id = 'ag-ps-mascot-dock';
      dock.setAttribute('data-ag-i18n-ignore', '1');
      dock.addEventListener('click', (e) => handleMascotActorClick(e, dock));
      box.appendChild(dock);
      rebuilt = true;
    }
    ensureMascotDodgeWatcher(box);
    if (rebuilt) {
      lastRosterSig = rosterSig;
      dock.setAttribute('data-mode', prefs.mascotCountMode);
      dock.innerHTML = '<span class="ag-ps-mascot-bubble"></span>';
      mascotActors = roster.map((item, idx) => {
        const rec = createMascotActorRecord(item, idx, false);
        dock.appendChild(rec.el);
        return rec;
      });
      if (overflow > 0) {
        const badge = document.createElement('span');
        badge.className = 'ag-ps-more-badge';
        badge.setAttribute('data-ag-ps-tip', `还有 ${overflow} 个活跃 Agent`);
        badge.textContent = `+${overflow}`;
        dock.appendChild(badge);
      }
      applyMascotSizeVars(dock, false);
      parkActorsHome(dock, true, false);
      const obs = scanDockObstacles(dock);
      lastObstacleSig = obs.sig;
      const { w } = getMascotDims();
      const anyBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
      if (obs.crowded || anyBlocked) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
      } else {
        dock.removeAttribute('data-yield');
      }
    } else if (rosterSig !== lastRosterSig) {
      const prevMode = dock.getAttribute('data-mode') || '';
      const modeChanged = prevMode !== prefs.mascotCountMode;
      lastRosterSig = rosterSig;
      dock.setAttribute('data-mode', prefs.mascotCountMode);

      const prevByKey = new Map(mascotActors.map((a) => [a.key, a]));
      const nextKeys = new Set(roster.map((r) => r.key));
      const nextActors = [];
      const newlyAdded = [];

      // 1. Build nextActors in roster order, reusing surviving actors in-place
      let badgeEl = dock.querySelector('.ag-ps-more-badge');
      for (let idx = 0; idx < roster.length; idx++) {
        const item = roster[idx];
        cancelMascotExitGhostByKey(item.key);
        const existing = !modeChanged ? prevByKey.get(item.key) : null;
        if (existing && existing.el && existing.el.isConnected) {
          existing.busy = item.busy;
          existing.label = item.label;
          existing.spriteId = item.spriteId || existing.spriteId || 'crab';
          existing.el.removeAttribute('data-exiting');
          setAttrIfChanged(existing.el, 'data-actor-idx', String(idx));
          setAttrIfChanged(existing.el, 'data-sprite', existing.spriteId);
          existing.el.style.setProperty('--ag-ps-idx', String(idx));
          setAttrIfChanged(existing.el, 'data-busy', item.busy ? '1' : '0');
          setAttrIfChanged(existing.el, 'data-ag-ps-tip', `${item.label} · ${item.busy ? '运行中' : '待命'}`);
          setAttrIfChanged(existing.el, 'data-ag-ps-tip-status', item.busy ? 'busy' : 'idle');
          if (existing.svg !== item.svg) {
            existing.svg = item.svg;
            const bodySpan = existing.el.querySelector('.ag-ps-actor-body');
            if (bodySpan) bodySpan.innerHTML = item.svg;
          }
          nextActors.push(existing);
        } else {
          const isSubSpawn = prefs.mascotCountMode === 'agents' && item.key.startsWith('sub:');
          const created = createMascotActorRecord(item, idx, isSubSpawn);
          if (badgeEl && badgeEl.parentElement === dock) {
            dock.insertBefore(created.el, badgeEl);
          } else {
            dock.appendChild(created.el);
          }
          nextActors.push(created);
          newlyAdded.push({ actor: created, idx, isSubSpawn });
        }
      }

      // Explicitly align DOM child order with nextActors so nth-of-type, tab order, and accessibility stay deterministic
      let orderRef = badgeEl && badgeEl.parentElement === dock ? badgeEl : null;
      for (let i = nextActors.length - 1; i >= 0; i--) {
        const el = nextActors[i].el;
        if (el && el.parentElement === dock && el.nextSibling !== orderRef) {
          dock.insertBefore(el, orderRef);
        }
        orderRef = el;
      }

      // 2. Play farewell exit animation on retired actors (or remove immediately on mode switch)
      let retiredSubCount = 0;
      let spawnedSubCount = newlyAdded.filter((n) => n.isSubSpawn).length;
      const anchorActor = nextActors[0] || null;
      for (const oldActor of mascotActors) {
        if (!modeChanged && nextKeys.has(oldActor.key)) continue;
        if (modeChanged) {
          clearActorTimers(oldActor);
          const b = oldActor.el?.querySelector('.ag-ps-mascot-bubble');
          if (b && anchorActor?.el) anchorActor.el.insertBefore(b, anchorActor.el.firstChild);
          oldActor.el?.remove();
        } else {
          if (oldActor.key.startsWith('sub:')) retiredSubCount++;
          retireMascotActorWithExit(oldActor, dock, anchorActor);
        }
      }

      // 3. Sync overflow badge without wiping dock
      if (overflow > 0) {
        if (!badgeEl) {
          badgeEl = document.createElement('span');
          badgeEl.className = 'ag-ps-more-badge';
          dock.appendChild(badgeEl);
        }
        badgeEl.hidden = false;
        badgeEl.textContent = `+${overflow}`;
        setAttrIfChanged(badgeEl, 'data-ag-ps-tip', `还有 ${overflow} 个活跃 Agent`);
      } else if (badgeEl) {
        badgeEl.remove();
        badgeEl = null;
      }

      mascotActors = nextActors;
      applyMascotSizeVars(dock, false);
      const obs = scanDockObstacles(dock);
      lastObstacleSig = obs.sig;
      const trackW = dock.clientWidth || dock.parentElement?.getBoundingClientRect().width || 0;
      if (trackW > 0 && newlyAdded.length > 0) {
        const homeXs = computeHomePositions(trackW, mascotActors.length, overflow > 0, dock, obs);
        for (const entry of newlyAdded) {
          applyActorTransform(entry.actor, homeXs[entry.idx] ?? 16, 1, 0);
        }
      }
      // Re-index active roam timers cleanly so closure indices stay valid, while smoothly sliding idle actors home
      if (mascotRoamingActive) {
        mascotActors.forEach((a) => {
          clearActorTimers(a);
          a.roaming = false;
        });
        mascotRoamingActive = false;
      }
      parkActorsHome(dock, modeChanged, false, obs);

      const { w } = getMascotDims();
      const anyBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
      if (obs.crowded || anyBlocked) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
      } else {
        dock.removeAttribute('data-yield');
      }

      if (retiredSubCount > 0) {
        showMascotBubble(retiredSubCount > 1 ? `${retiredSubCount} 个子 Agent 完工退场 ✨` : '子 Agent 完工退场 ✨', 2100, anchorActor);
      } else if (spawnedSubCount > 0) {
        showMascotBubble(spawnedSubCount > 1 ? `召唤 ${spawnedSubCount} 个子 Agent 协同出战 ⚡` : '新子 Agent 加入协同 ⚡', 1900, newlyAdded[newlyAdded.length - 1].actor);
      }
    } else {
      mascotActors.forEach((actor, idx) => {
        const item = roster[idx];
        if (!item) return;
        actor.busy = item.busy;
        actor.label = item.label;
        if (actor.el) {
          setAttrIfChanged(actor.el, 'data-busy', item.busy ? '1' : '0');
          setAttrIfChanged(actor.el, 'data-ag-ps-tip', `${item.label} · ${item.busy ? '运行中' : '待命'}`);
          setAttrIfChanged(actor.el, 'data-ag-ps-tip-status', item.busy ? 'busy' : 'idle');
        }
      });
      applyMascotSizeVars(dock, false);
      const obs = scanDockObstacles(dock);
      const { w } = getMascotDims();
      const sigChanged = obs.sig !== lastObstacleSig;
      if (sigChanged) lastObstacleSig = obs.sig;
      const anyBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
      if (obs.crowded) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
      } else if (sigChanged || anyBlocked) {
        parkActorsHome(dock, false, mascotRoamingActive, obs);
        const stillBlocked = obs.zones.length > 0 && mascotActors.some((a) => isIntervalBlocked(a.x, w, obs.zones));
        if (stillBlocked) {
          dock.setAttribute('data-yield', '1');
          if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
        } else {
          dock.removeAttribute('data-yield');
        }
      } else {
        dock.removeAttribute('data-yield');
      }
    }
    dock.setAttribute('data-vibe', prefs.mascotVibe === 'calm' ? 'calm' : 'lively');
    setAttrIfChanged(dock, 'data-perf', prefs.performanceMode || 'balanced');
    syncMascotCompactGuard();

    const anyBusy = mascotActors.some((a) => a.busy);
    const now = Date.now();
    if (anyBusy) {
      mascotIdleSince = now;
      if (!wasMascotBusy) {
        mascotBusyStartedAt = now;
        mascotBusyStartLen = sampleLatestResponseLen();
        mascotFirstTokenSeen = false;
        mascotWaitingDoze = false;
        showMascotBubble(prefs.mascotRoam && !isEffectivelyReducedMotion() ? '开工啦！出发巡逻 ⚡' : '思考中… ⚡', 1800);
      } else if (!mascotFirstTokenSeen) {
        const curLen = sampleLatestResponseLen();
        if (Math.abs(curLen - mascotBusyStartLen) > 12) {
          if (mascotWaitingDoze) wakeMascotFromWait();
          else mascotFirstTokenSeen = true;
        } else if (now - mascotBusyStartedAt >= 8000 && !mascotWaitingDoze) {
          // High TTFT waiting (>8s without first token): gently doze until first token arrives
          mascotWaitingDoze = true;
          stopMascotRoaming(false);
          mascotActors.forEach((a) => {
            if (a.busy && a.el) a.el.setAttribute('data-act', 'doze');
          });
        }
      }
      dock.setAttribute('data-mood', 'busy');
      mascotActors.forEach((a) => {
        if (a.el) {
          if (!a.busy) a.el.setAttribute('data-sleep', '1');
          else a.el.removeAttribute('data-sleep');
        }
      });
      syncMascotSpeedVars(dock);
      if (!mascotWaitingDoze) syncMascotRoaming(dock);
    } else {
      mascotFirstTokenSeen = true;
      mascotWaitingDoze = false;
      if (mascotRoamingActive) {
        stopMascotRoaming(true);
      }
      mascotActors.forEach((a) => {
        a.el?.removeAttribute('data-sleep');
        if (a.el?.getAttribute('data-act') === 'doze') a.el.removeAttribute('data-act');
      });
      if (wasMascotBusy) {
        mascotCheerUntil = now + 1900 + mascotActors.length * 110;
        showMascotBubble('完成啦 ✨', 2400);
      }
      if (now < mascotCheerUntil) {
        dock.setAttribute('data-mood', 'cheer');
      } else if (now - mascotIdleSince >= 5000) {
        dock.setAttribute('data-mood', 'sleep');
      } else {
        dock.setAttribute('data-mood', 'calm');
      }
    }

    // Update lightweight status micro-emote on lead actor (O(1), no extra timers)
    const lead = mascotActors[0];
    if (lead) {
      const moodNow = dock.getAttribute('data-mood');
      const status = detectLeadStatusEmote(Boolean(busy));
      if (status.icon) {
        setActorEmote(lead, status.icon, false);
        if (status.tip && lead.el) {
          setAttrIfChanged(lead.el, 'data-ag-ps-tip', `${lead.label} · ${status.tip}`);
          setAttrIfChanged(lead.el, 'data-ag-ps-tip-status', 'busy');
        }
      } else if (moodNow === 'sleep') {
        setActorEmote(lead, 'zZ', true);
      } else {
        setActorEmote(lead, '', false);
      }
      for (let i = 1; i < mascotActors.length; i++) {
        setActorEmote(mascotActors[i], '', false);
      }
    }
    wasMascotBusy = anyBusy;
  }
  let mascotObstacleRaf = 0;

  function nudgeMascotObstacleSync() {
    if (disposed || mascotObstacleRaf || !prefs.mascot || document.hidden) return;
    mascotObstacleRaf = requestAnimationFrame(() => {
      mascotObstacleRaf = 0;
      if (disposed || !prefs.mascot) return;
      const dock = document.getElementById('ag-ps-mascot-dock');
      if (!dock || !dock.isConnected) return;
      const obs = scanDockObstacles(dock);
      lastObstacleSig = obs.sig;
      if (obs.crowded) {
        dock.setAttribute('data-yield', '1');
        if (tipTarget && dock.contains(tipTarget)) hideCustomTooltip();
        return;
      }
      dock.removeAttribute('data-yield');
      if (mascotRoamingActive) {
        clampRoamingActorsInBounds(dock);
        const { w, minX, maxX } = getMascotRunwayBounds(dock);
        for (const actor of mascotActors) {
          if (actor.roaming && actor.el && isIntervalBlocked(actor.x, w, obs.zones)) {
            const safe = findNearestSafeX(actor.x, w, minX, maxX, obs.zones, 0, 0);
            if (safe !== null) {
              applyActorTransform(actor, safe, safe >= actor.x ? 1 : -1, 0.22);
            }
          }
        }
      } else {
        parkActorsHome(dock, false, false, obs);
      }
    });
  }
  window.addEventListener('ag-prism-orb-change', nudgeMascotObstacleSync);
  onCleanup(() => {
    window.removeEventListener('ag-prism-orb-change', nudgeMascotObstacleSync);
    if (mascotObstacleRaf) {
      cancelAnimationFrame(mascotObstacleRaf);
      mascotObstacleRaf = 0;
    }
  });

  onCleanup(() => {
    stopMascotRoaming(false);
    clearAllMascotExitTimers(true);
    mascotActors.forEach(clearActorTimers);
    mascotActors = [];
    lastRosterSig = '';
    lastObstacleSig = '';
    document.getElementById('ag-ps-mascot-dock')?.remove();
  });

  /* ==========================================================================
   * 6. Thought Process Live Chinese Translation
   *    - Waits until generation settles (no repeated RPC every tick while streaming)
   *    - Viewport-lazy translation + passive viewport scroll trigger
   *    - Cleans up cleanly when thinking block collapses or mode turns off
   *    - Flush-left per-block "原文 / 译文" peek toggle in both bilingual & immersive modes
   * ========================================================================== */
  const thoughtInFlight = new WeakSet();
  let thoughtTextMemo = new WeakMap(); // bodyEl -> { src, zh, ver }
  let thoughtPeekOriginal = new WeakSet(); // bodyEl user chose to peek original
  const thoughtBoxByTrigger = new WeakMap(); // triggerBtn -> { box, bodyEl }
  let thoughtSeq = 0;
  let thoughtWatchedVp = null;
  let thoughtScrollTimer = 0;

  function onThoughtViewportScroll() {
    if (disposed || prefs.thoughtMode === 'off' || document.hidden || thoughtScrollTimer) return;
    thoughtScrollTimer = setTimeout(() => {
      thoughtScrollTimer = 0;
      if (!disposed && prefs.thoughtMode !== 'off' && !document.hidden) {
        syncThoughtBlocks(isAgentGenerating());
      }
    }, 140);
  }

  function detachThoughtScrollWatcher() {
    if (thoughtScrollTimer) {
      clearTimeout(thoughtScrollTimer);
      thoughtScrollTimer = 0;
    }
    if (thoughtWatchedVp) {
      try { thoughtWatchedVp.removeEventListener('scroll', onThoughtViewportScroll); } catch {}
      thoughtWatchedVp = null;
    }
  }

  function syncThoughtScrollWatcher() {
    if (disposed || prefs.thoughtMode === 'off') {
      detachThoughtScrollWatcher();
      return;
    }
    const vp = getActiveViewportEl();
    if (vp === thoughtWatchedVp) return;
    detachThoughtScrollWatcher();
    if (vp) {
      thoughtWatchedVp = vp;
      vp.addEventListener('scroll', onThoughtViewportScroll, { passive: true });
    }
  }

  function looksMostlyEnglish(text) {
    const s = String(text || '').trim();
    if (s.length < 24) return false;
    const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return latin >= 16 && cjk / Math.max(1, cjk + latin) < 0.42;
  }

  function findThoughtBody(triggerBtn) {
    const parent = triggerBtn && triggerBtn.parentElement;
    if (!parent) return null;
    for (const ch of Array.from(parent.children)) {
      if (ch === triggerBtn || ch.classList.contains('ag-ps-thought-zh')) continue;
      if ((ch.textContent || '').trim().length > 0) return ch;
    }
    const next = parent.nextElementSibling;
    if (next && !next.classList.contains('ag-ps-thought-zh') && (next.textContent || '').trim().length > 0) {
      return next;
    }
    return null;
  }

  function removeThoughtBoxNear(triggerBtn) {
    const tracked = triggerBtn ? thoughtBoxByTrigger.get(triggerBtn) : null;
    if (tracked) {
      if (tracked.box && tracked.box.isConnected) tracked.box.remove();
      if (tracked.bodyEl) {
        tracked.bodyEl.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
      }
      thoughtBoxByTrigger.delete(triggerBtn);
    }
    const parent = triggerBtn && triggerBtn.parentElement;
    if (!parent) return;
    parent.querySelectorAll(':scope > .ag-ps-thought-zh').forEach((n) => n.remove());
    parent.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
    const fallbackBody = findThoughtBody(triggerBtn);
    if (fallbackBody && fallbackBody.parentElement && fallbackBody.parentElement !== parent) {
      fallbackBody.parentElement.querySelectorAll(':scope > .ag-ps-thought-zh').forEach((n) => n.remove());
      fallbackBody.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    }
  }

  const THOUGHT_TOKEN_OR_URL_RE = /(?:https?|wss?|ftp):\/\/[^\s<>'"`]+|(?:^|(?<=[\s(（"'`「『【\[，。：；]))((?:[A-Za-z]:[\\/][^\s<>'"`():，。、；！？：「」『』【】（）《》\[\]]+|\/(?:mnt|home|Users|workspace|volume\d)\/[^\s<>'"`():，。、；！？：「」『』【】（）《》\[\]]+|(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ts|tsx|jsx|py|cs|go|rs|java|json|yml|yaml|md|css|html|sh|ps1)\b)(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+)?)?)/g;

  function stripThoughtFileRefLineSuffix(rawRef) {
    return String(rawRef || '')
      .trim()
      .replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/i, '');
  }

  function renderThoughtTextWithFileRefs(rawText) {
    const str = String(rawText || '');
    if (!str) return '';
    THOUGHT_TOKEN_OR_URL_RE.lastIndex = 0;
    let out = '';
    let lastIdx = 0;
    let m;
    while ((m = THOUGHT_TOKEN_OR_URL_RE.exec(str)) !== null) {
      if (!m[1]) {
        // Matched an http(s):// URL — emit escaped plain text without turning middle segments into file refs
        out += escapeHtml(str.slice(lastIdx, m.index + m[0].length));
        lastIdx = m.index + m[0].length;
        continue;
      }
      let token = m[1];
      let trailing = '';
      const punctMatch = token.match(/([.,;]+)$/);
      if (punctMatch) {
        trailing = punctMatch[1];
        token = token.slice(0, -trailing.length);
      }
      out += escapeHtml(str.slice(lastIdx, m.index));
      if (token) {
        const esc = escapeHtml(token);
        out += `<button type="button" class="ag-ps-thought-file-ref" data-file-ref="${esc}" title="点击定位或复制源码位置">${esc}</button>`;
      }
      if (trailing) {
        out += escapeHtml(trailing);
      }
      lastIdx = m.index + m[0].length;
    }
    out += escapeHtml(str.slice(lastIdx));
    return out;
  }

  function onThoughtFileRefClick(e) {
    if (disposed) return;
    const btn = e.target && e.target.closest ? e.target.closest('.ag-ps-thought-file-ref') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const rawRef = String(btn.getAttribute('data-file-ref') || '').trim();
    if (!rawRef) return;
    const refPath = stripThoughtFileRefLineSuffix(rawRef);
    if (!refPath) return;
    const shortRef = rawRef.length > 56 ? `…${rawRef.slice(-54)}` : rawRef;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try { navigator.clipboard.writeText(rawRef).catch(() => {}); } catch {}
    }
    if (typeof window.__agProjectCall === 'function') {
      Promise.resolve(window.__agProjectCall('revealFile', { targetPath: refPath }))
        .then((res) => {
          if (disposed) return;
          if (res && res.ok) {
            showJumpToast(`已定位并复制源码引用：${shortRef}`);
          } else {
            showJumpToast(`已复制源码路径：${shortRef}`);
          }
        })
        .catch(() => {
          if (!disposed) showJumpToast(`已复制源码路径：${shortRef}`);
        });
      return;
    }
    if (bridgeTargetWin) {
      openPrismWorkbenchQuick('browse');
    }
    showJumpToast(`已复制源码路径：${shortRef}`);
  }
  document.addEventListener('click', onThoughtFileRefClick, true);
  onCleanup(() => document.removeEventListener('click', onThoughtFileRefClick, true));

  function applyThoughtDisplay(bodyEl, zhText, mode) {
    if (!bodyEl || !bodyEl.parentElement) return;
    let box = bodyEl.parentElement.querySelector(':scope > .ag-ps-thought-zh');
    if (mode === 'off' || !zhText) {
      bodyEl.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
      if (box) box.remove();
      return;
    }
    const peeking = thoughtPeekOriginal.has(bodyEl);
    if (!box) {
      box = document.createElement('div');
      box.className = 'ag-ps-thought-zh';
      box.setAttribute('data-ag-i18n-ignore', '1');
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('.ag-ps-thought-peek');
        if (!btn) return;
        e.stopPropagation();
        if (thoughtPeekOriginal.has(bodyEl)) thoughtPeekOriginal.delete(bodyEl);
        else thoughtPeekOriginal.add(bodyEl);
        const memo = thoughtTextMemo.get(bodyEl);
        applyThoughtDisplay(bodyEl, memo ? memo.zh : zhText, prefs.thoughtMode);
      });
      bodyEl.parentElement.insertBefore(box, bodyEl.nextSibling);
    }
    const effectiveImmersive = mode === 'immersive' && !peeking;
    const bilingualPeekSrcOnly = mode === 'bilingual' && peeking;
    box.setAttribute('data-mode', effectiveImmersive ? 'immersive' : 'bilingual');
    const renderSig = `${mode}|${peeking ? '1' : '0'}|${zhText}`;
    if (box.getAttribute('data-render-sig') !== renderSig) {
      box.setAttribute('data-render-sig', renderSig);
      const hdrHtml = mode === 'immersive'
        ? `<div class="ag-ps-thought-zh-hdr"><button type="button" class="ag-ps-thought-peek">${peeking ? '仅看译文' : '查看原文'}</button></div>`
        : `<div class="ag-ps-thought-zh-hdr"><span>译文对照</span><button type="button" class="ag-ps-thought-peek">${peeking ? '恢复双语' : '仅看原文'}</button></div>`;
      const bodyStyle = bilingualPeekSrcOnly ? ' style="display:none"' : '';
      box.innerHTML = `${hdrHtml}<div${bodyStyle}>${renderThoughtTextWithFileRefs(zhText)}</div>`;
    }
    if (effectiveImmersive) {
      bodyEl.classList.add('ag-ps-thought-src-hidden');
      bodyEl.classList.remove('ag-ps-thought-src-dim');
    } else if (bilingualPeekSrcOnly) {
      bodyEl.classList.remove('ag-ps-thought-src-hidden', 'ag-ps-thought-src-dim');
    } else {
      bodyEl.classList.remove('ag-ps-thought-src-hidden');
      bodyEl.classList.add('ag-ps-thought-src-dim');
    }
    return box;
  }

  function extractCleanThoughtText(bodyEl) {
    if (!bodyEl) return '';
    try {
      const clone = bodyEl.cloneNode(true);
      clone.querySelectorAll('style, script, noscript').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch {
      return (bodyEl.innerText || '').trim();
    }
  }

  function translateThoughtContainer(bodyEl, triggerBtn = null) {
    if (!bodyEl || typeof window.__agProjectCall !== 'function') return;
    const mode = prefs.thoughtMode;
    if (mode === 'off') {
      applyThoughtDisplay(bodyEl, '', 'off');
      return;
    }
    const rawTxtNow = bodyEl.textContent || '';
    const rawSig = `${rawTxtNow.length}:${rawTxtNow.slice(0, 24)}:${rawTxtNow.slice(-24)}`;
    const memo = thoughtTextMemo.get(bodyEl);
    if (memo && memo.zh && memo.rawSig === rawSig) {
      const box = applyThoughtDisplay(bodyEl, memo.zh, mode);
      if (triggerBtn && box) thoughtBoxByTrigger.set(triggerBtn, { box, bodyEl });
      return;
    }
    if (memo && memo.skipped && memo.rawSig === rawSig) return;
    if (memo && memo.failedSig === rawSig && (memo.fails >= 3 || Date.now() < (memo.retryAfter || 0))) {
      return;
    }
    const srcText = extractCleanThoughtText(bodyEl);
    if (!looksMostlyEnglish(srcText)) return;
    const clipped = srcText.slice(0, 9800);
    if (memo && memo.skipped && (memo.rawSig === rawSig || memo.src === clipped)) {
      memo.rawSig = rawSig;
      return;
    }
    if (memo && memo.src === clipped && memo.zh) {
      memo.rawSig = rawSig;
      const box = applyThoughtDisplay(bodyEl, memo.zh, mode);
      if (triggerBtn && box) thoughtBoxByTrigger.set(triggerBtn, { box, bodyEl });
      return;
    }
    if (thoughtInFlight.has(bodyEl)) return;
    const myVer = ++thoughtSeq;
    const startRawSig = rawSig;
    thoughtInFlight.add(bodyEl);
    let needFollowUp = false;
    const recordFailure = () => {
      if (disposed || !bodyEl.isConnected) return;
      const prev = thoughtTextMemo.get(bodyEl);
      const prevFails = prev && prev.failedSig === startRawSig ? (Number(prev.fails) || 0) : 0;
      thoughtTextMemo.set(bodyEl, {
        ...(prev && prev.zh ? { src: prev.src, zh: prev.zh, ver: prev.ver } : {}),
        failedSig: startRawSig,
        fails: prevFails + 1,
        retryAfter: Date.now() + Math.min(180000, 5000 * Math.pow(4, prevFails))
      });
    };
    Promise.resolve(window.__agProjectCall('translateText', { text: clipped, targetLang: 'zh-CN' }, 12000))
      .then((res) => {
        if (disposed || !bodyEl.isConnected) return;
        const curTxt = bodyEl.textContent || '';
        const curSig = `${curTxt.length}:${curTxt.slice(0, 24)}:${curTxt.slice(-24)}`;
        if (res && res.skipped) {
          thoughtTextMemo.set(bodyEl, {
            src: clipped,
            skipped: true,
            rawSig: curSig === startRawSig ? startRawSig : ''
          });
          if (curSig !== startRawSig) needFollowUp = true;
          return;
        }
        if (res && res.ok && res.translated) {
          thoughtTextMemo.set(bodyEl, {
            src: clipped,
            zh: res.translated,
            ver: myVer,
            rawSig: curSig === startRawSig ? startRawSig : ''
          });
          if (curSig !== startRawSig) needFollowUp = true;
          const box = applyThoughtDisplay(bodyEl, res.translated, prefs.thoughtMode);
          if (triggerBtn && box) thoughtBoxByTrigger.set(triggerBtn, { box, bodyEl });
          return;
        }
        recordFailure();
      })
      .catch(() => {
        recordFailure();
      })
      .finally(() => {
        thoughtInFlight.delete(bodyEl);
        if (needFollowUp && !disposed && bodyEl.isConnected && prefs.thoughtMode !== 'off') {
          translateThoughtContainer(bodyEl, triggerBtn);
        }
      });
  }

  function syncThoughtBlocks(isBusy) {
    syncThoughtScrollWatcher();
    const triggers = document.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
    for (let i = 0; i < triggers.length; i++) {
      const trig = triggers[i];
      const expanded = trig.getAttribute('aria-expanded') === 'true';
      if (!expanded) {
        removeThoughtBoxNear(trig);
        continue;
      }
      const bodyEl = findThoughtBody(trig);
      if (!bodyEl) continue;
      if (prefs.thoughtMode === 'off') {
        applyThoughtDisplay(bodyEl, '', 'off');
        thoughtBoxByTrigger.delete(trig);
        continue;
      }
      // Only defer the actively streaming last thinking block (which has no completed duration yet)
      const trigTxt = (trig.textContent || '').trim();
      const isCompleted = /\d+\s*(?:h|m|s)\b|\d+\s*(?:小时|分|秒)|已思考|Thought\s+for/i.test(trigTxt);
      if (isBusy && i === triggers.length - 1 && !isCompleted) {
        const memo = thoughtTextMemo.get(bodyEl);
        if (memo && memo.zh) {
          const box = applyThoughtDisplay(bodyEl, memo.zh, prefs.thoughtMode);
          if (box) thoughtBoxByTrigger.set(trig, { box, bodyEl });
        }
        continue;
      }
      const r = (bodyEl.getBoundingClientRect().height > 0 ? bodyEl : trig).getBoundingClientRect();
      if (r.bottom < -180 || r.top > (window.innerHeight || 1080) + 280) continue;
      translateThoughtContainer(bodyEl, trig);
    }
  }
  onCleanup(() => {
    detachThoughtScrollWatcher();
    document.querySelectorAll('.ag-ps-thought-zh').forEach((n) => n.remove());
    document.querySelectorAll('.ag-ps-thought-src-dim, .ag-ps-thought-src-hidden').forEach((n) => {
      n.classList.remove('ag-ps-thought-src-dim', 'ag-ps-thought-src-hidden');
    });
  });

  /* ==========================================================================
   * 7. Titlebar Entry, Theme-Adaptive Tooltip, Update Capsule & v4 Event Bus
   * ========================================================================== */
  const registeredPanelSections = [];
  const busSubscribers = new Set();
  let cachedComposerEl = null;

  function getComposerEl() {
    const inputBox = getActiveInputBox();
    if (inputBox) {
      if (cachedComposerEl && isElementRendered(cachedComposerEl) && cachedComposerEl.contains(inputBox)) {
        return cachedComposerEl;
      }
      cachedComposerEl =
        inputBox.closest('[data-testid="composer-container"]') ||
        inputBox.closest('form') ||
        inputBox.parentElement ||
        inputBox;
      return cachedComposerEl;
    }
    const fallbacks = Array.from(document.querySelectorAll('[data-testid="composer-container"]'));
    cachedComposerEl = fallbacks.find(isElementRendered) || fallbacks[0] || null;
    return cachedComposerEl;
  }

  function parseRelativeResetToIso(durationText, nowMs = Date.now()) {
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

  let antiClaudeQuotaCacheMemo = undefined;
  let antiClaudeQuotaCacheMemoAt = 0;
  let antiClaudeQuotaCacheMemoFam = '';

  function detectActiveComposerFamily() {
    try {
      const activeBox = getActiveInputBox();
      const trig = (activeBox && activeBox.querySelector('button[data-testid="model-selector-trigger"]'))
        || document.querySelector('button[data-testid="model-selector-trigger"]');
      const label = ((trig && trig.textContent) || '').toLowerCase();
      if (label.includes('claude') || label.includes('gpt')) return 'claude';
      if (label.includes('gemini')) return 'gemini';
    } catch {}
    return '';
  }

  function readAntiClaudeQuotaCache() {
    const checkNowMs = Date.now();
    const curFam = detectActiveComposerFamily();
    if (
      antiClaudeQuotaCacheMemo !== undefined &&
      antiClaudeQuotaCacheMemoFam === curFam &&
      checkNowMs - antiClaudeQuotaCacheMemoAt < 1000
    ) {
      return antiClaudeQuotaCacheMemo;
    }
    antiClaudeQuotaCacheMemoAt = checkNowMs;
    antiClaudeQuotaCacheMemoFam = curFam;
    try {
      const raw = typeof localStorage === 'object' && localStorage ? localStorage.getItem(ANTI_CLAUDE_QUOTA_CACHE_KEY) : null;
      if (!raw) {
        antiClaudeQuotaCacheMemo = null;
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
        antiClaudeQuotaCacheMemo = null;
        return null;
      }

      const rawKey = String(parsed.accountKey || '').trim();
      const firstSeg = rawKey.split('|')[0].trim().toLowerCase();
      const accountEmail = firstSeg.includes('@') && firstSeg.length <= 254 ? firstSeg : '';
      const tierName = String(parsed.tierName || '').trim().slice(0, 48);
      const nowMs = checkNowMs;

      const detectActiveFamily = () => {
        try {
          const activeBox = getActiveInputBox();
          const trig = (activeBox && activeBox.querySelector('button[data-testid="model-selector-trigger"]'))
            || document.querySelector('button[data-testid="model-selector-trigger"]');
          const txt = String(trig?.textContent || '').toLowerCase();
          if (/claude|sonnet|opus/i.test(txt)) return 'claude';
          if (/gpt/i.test(txt)) return 'gpt';
          if (/gemini/i.test(txt)) return 'gemini';
        } catch {}
        return '';
      };

      const families = {};
      const parsedGroups = [];
      for (const g of parsed.groups) {
        if (!g || !Array.isArray(g.buckets) || g.buckets.length === 0) continue;
        const dn = String(g.displayName || '').trim();
        let famKey = 'other';
        if (/gemini/i.test(dn)) famKey = 'gemini';
        else if (/claude|gpt/i.test(dn)) famKey = 'claude';

        let g5 = null;
        let g7 = null;
        let r5 = '';
        let r7 = '';
        for (const b of g.buckets) {
          if (!b || typeof b !== 'object') continue;
          const frac = typeof b.remainingFraction === 'number'
            ? b.remainingFraction
            : (b.remaining && typeof b.remaining.value === 'number' ? b.remaining.value : null);
          if (frac === null || !Number.isFinite(frac)) continue;
          const pct = Math.max(0, Math.min(100, Math.round(frac * 1000) / 10));
          const secRaw = b.resetTime && b.resetTime.seconds !== undefined ? Number(b.resetTime.seconds) : NaN;
          const resetMs = Number.isFinite(secRaw) && secRaw > 0 ? secRaw * 1000 : NaN;
          const resetIso = Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : '';

          const win = String(b.window || b.displayName || '').trim().toLowerCase();
          let isWeekly = /week|7d|每周|周/.test(win);
          let is5h = /5h|5\s*hour|5\s*小时|short/.test(win);
          if (!isWeekly && !is5h && Number.isFinite(resetMs)) {
            if ((resetMs - nowMs) / 3600000 > 6) isWeekly = true;
            else is5h = true;
          }
          if (isWeekly) {
            if (g7 === null || pct < g7) {
              g7 = pct;
              if (resetIso) r7 = resetIso;
            }
          } else {
            if (g5 === null || pct < g5) {
              g5 = pct;
              if (resetIso) r5 = resetIso;
            }
          }
        }

        if (g5 !== null || g7 !== null) {
          parsedGroups.push({ famKey, g5, g7, r5, r7 });
          if (famKey !== 'other') {
            const cur = families[famKey] || {};
            if (g5 !== null && (cur.pct5h === undefined || g5 < cur.pct5h)) {
              cur.pct5h = g5;
              if (r5) cur.reset5hAt = r5;
            } else if (!cur.reset5hAt && r5) {
              cur.reset5hAt = r5;
            }
            if (g7 !== null && (cur.pct7d === undefined || g7 < cur.pct7d)) {
              cur.pct7d = g7;
              if (r7) cur.reset7dAt = r7;
            } else if (!cur.reset7dAt && r7) {
              cur.reset7dAt = r7;
            }
            families[famKey] = cur;
          }
        }
      }

      if (!parsedGroups.length) {
        antiClaudeQuotaCacheMemo = null;
        return null;
      }
      const activeFam = detectActiveFamily();
      const preferred = (activeFam && parsedGroups.find((g) => g.famKey === activeFam)) || parsedGroups[0];
      const all5 = parsedGroups.map((g) => g.g5).filter((n) => typeof n === 'number');
      const all7 = parsedGroups.map((g) => g.g7).filter((n) => typeof n === 'number');
      const pct5h = preferred.g5 !== null ? preferred.g5 : (all5.length ? Math.min(...all5) : null);
      const pct7d = preferred.g7 !== null ? preferred.g7 : (all7.length ? Math.min(...all7) : null);
      const reset5hAt = preferred.r5 || (parsedGroups.find((g) => g.r5)?.r5 || '');
      const reset7dAt = preferred.r7 || (parsedGroups.find((g) => g.r7)?.r7 || '');
      const vals = [pct5h, pct7d].filter((n) => typeof n === 'number');
      const minPct = vals.length ? Math.min(...vals) : null;
      antiClaudeQuotaCacheMemo = {
        pct5h,
        pct7d,
        minPct,
        reset5hAt,
        reset7dAt,
        families: Object.keys(families).length ? families : null,
        accountEmail,
        tierName,
        observedAt: Number(parsed.ts) || nowMs
      };
      return antiClaudeQuotaCacheMemo;
    } catch {
      antiClaudeQuotaCacheMemo = null;
      return null;
    }
  }

  function getQuotaState() {
    const cached = readAntiClaudeQuotaCache();
    if (cached && (typeof cached.pct5h === 'number' || typeof cached.pct7d === 'number')) {
      return cached;
    }
    let pct5h = null;
    let pct7d = null;
    let reset5hAt = '';
    let reset7dAt = '';
    try {
      const ov = document.getElementById('ag-claude-ov-sections') || document.querySelector('[data-testid="overview-panel"]');
      if (ov) {
        const txt = ov.textContent || '';
        const m5 = txt.match(/5\s*(?:小时|h)[^\d%]{0,24}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
        const m7 = txt.match(/(?:每周|周限额|周额度|weekly|7d)[^\d%]{0,24}(\d{1,3}(?:\.\d+)?)\s*%\s*(?:已用|used|剩余|left)?/i);
        const toRemaining = (m) => {
          if (!m) return null;
          const v = Number(m[1]);
          if (!Number.isFinite(v)) return null;
          const isUsed = /已用|used/i.test(m[0]);
          const rem = isUsed ? 100 - v : v;
          return Math.max(0, Math.min(100, Math.round(rem * 10) / 10));
        };
        pct5h = toRemaining(m5);
        pct7d = toRemaining(m7);
        const nowMs = Date.now();
        const r5 = txt.match(/5\s*(?:小时|h)[^;\n]{0,42}?(\d+\s*(?:h|小时)(?:\s*\d+\s*(?:m|分))?|\d+\s*(?:m|分钟?))/i);
        const r7 = txt.match(/(?:每周|周限额|周额度|weekly|7d)[^;\n]{0,42}?(\d+\s*(?:d|天)(?:\s*\d+\s*(?:h|小时))?|\d+\s*(?:h|小时))/i);
        if (r5) reset5hAt = parseRelativeResetToIso(r5[1], nowMs);
        if (r7) reset7dAt = parseRelativeResetToIso(r7[1], nowMs);
      }
    } catch {}
    const vals = [pct5h, pct7d].filter((n) => typeof n === 'number');
    const minPct = vals.length ? Math.min(...vals) : null;
    return { pct5h, pct7d, minPct, reset5hAt, reset7dAt, families: null, accountEmail: '', tierName: '' };
  }

  /* ---- Sanitized Workbench Bridge (Main Window <-> Prism Files MCP App iframe) ---- */
  const ALLOWED_BRIDGE_TABS = new Set(['browse', 'artifacts', 'pins', 'search', 'accounts']);
  const bridgeSessionId = `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let bridgeTargetWin = null;
  let bridgeTargetOrigin = '*';
  let bridgeLastSeenAt = 0;
  let pendingWorkbenchTab = '';
  let pendingWorkbenchTabAt = 0;
  let pendingIntentId = '';
  let bridgeRetryTimers = [];
  let lastPushedQuotaSig = '';
  let lastPushedQuotaAt = 0;

  let cachedLiveQuota = (() => {
    try {
      const raw = localStorage.getItem(LIVE_QUOTA_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch {}
    return { pct5h: null, pct7d: null, reset5hAt: '', reset7dAt: '', observedAt: 0 };
  })();

  let cachedAccountSummary = (() => {
    try {
      const raw = localStorage.getItem(ACCOUNT_SUMMARY_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch {}
    return null;
  })();

  function clearBridgeRetryTimers() {
    while (bridgeRetryTimers.length) {
      clearTimeout(bridgeRetryTimers.pop());
    }
  }

  const bridgeFrameTargets = new Map();
  const LAST_ACCOUNT_SWITCH_STORAGE_KEY = 'ag_prism_last_account_switch_at';
  const LAST_ACCOUNT_SWITCH_COOKIE_KEY = 'ag_prism_last_sw';

  function recordAccountSwitchMarker(tsMs = Date.now()) {
    const ts = String(Math.round(Number(tsMs) || Date.now()));
    try { localStorage.setItem(LAST_ACCOUNT_SWITCH_STORAGE_KEY, ts); } catch {}
    if (canUseHostCookie()) {
      try {
        const secureAttr = /^https:$/i.test(window.location.protocol || '') ? '; Secure' : '';
        document.cookie = `${LAST_ACCOUNT_SWITCH_COOKIE_KEY}=${ts}; Path=/; Max-Age=300; SameSite=Lax${secureAttr}`;
      } catch {}
    }
  }

  function isTrustedBridgeOrigin(origin) {
    const o = String(origin || '').trim();
    if (!o || o === 'null') return false;
    if (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.usercontent\.goog(?::\d+)?$/i.test(o)) return true; // Antigravity MCP App sandbox origin
    return /^vscode-webview:\/\/[a-z0-9._-]+(?::\d+)?$/i.test(o);
  }

  function findOwningHostIframe(win) {
    if (!win || win === window) return null;
    try { if (win.closed) return null; } catch {}
    let parentWin = null;
    try {
      parentWin = win.parent;
    } catch {
      parentWin = null;
    }
    try {
      const frames = document.querySelectorAll('iframe');
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!f || !f.isConnected) continue;
        const cw = f.contentWindow;
        if (!cw) continue;
        if (cw === win) return f;
        if (parentWin && parentWin !== window && cw === parentWin) return f;
        try {
          const innerCount = cw.frames ? cw.frames.length : 0;
          for (let j = 0; j < Math.min(innerCount, 6); j++) {
            if (cw.frames[j] === win) return f;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  function collectCandidateFrameWindows() {
    const wins = [];
    const seen = new Set();
    const pushWin = (w) => {
      if (!w || w === window || seen.has(w)) return;
      try { if (w.closed) return; } catch {}
      seen.add(w);
      wins.push(w);
    };
    if (bridgeTargetWin && findOwningHostIframe(bridgeTargetWin)) {
      pushWin(bridgeTargetWin);
    } else if (bridgeTargetWin) {
      bridgeTargetWin = null;
    }
    for (const [fw] of bridgeFrameTargets) {
      if (!fw || !findOwningHostIframe(fw)) {
        bridgeFrameTargets.delete(fw);
        continue;
      }
      pushWin(fw);
    }
    try {
      const frames = document.querySelectorAll('iframe');
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!f || !f.isConnected) continue;
        const cw = f.contentWindow;
        pushWin(cw);
        // Best-effort 1-level nested frame scan inside host iframe container
        try {
          const innerCount = cw && cw.frames ? cw.frames.length : 0;
          for (let j = 0; j < Math.min(innerCount, 6); j++) {
            pushWin(cw.frames[j]);
          }
        } catch {}
      }
    } catch {}
    return wins;
  }

  function isOwnedIframeWindow(win) {
    return Boolean(findOwningHostIframe(win));
  }

  function stripQuotaEmailForBridge(q) {
    if (!q || typeof q !== 'object') return null;
    return {
      pct5h: q.pct5h ?? null,
      pct7d: q.pct7d ?? null,
      reset5hAt: q.reset5hAt || '',
      reset7dAt: q.reset7dAt || '',
      families: q.families || null,
      tierName: q.tierName || '',
      observedAt: Number(q.observedAt) || Date.now()
    };
  }

  function postBridgeMessage(win, payload, origin = bridgeTargetOrigin) {
    if (!win || typeof win.postMessage !== 'function') return false;
    const safeOrigin = origin && origin !== 'null' ? origin : '*';
    try {
      win.postMessage(
        Object.assign({ __agPrismBridge: 'v1', sessionId: bridgeSessionId, source: 'prism-suite', target: 'prism-files' }, payload),
        safeOrigin
      );
      return true;
    } catch {
      return false;
    }
  }

  function broadcastThemeToFrames() {
    const theme = getCurrentThemeBridgePayload();
    const wins = collectCandidateFrameWindows();
    for (let i = 0; i < wins.length; i++) {
      const targetOrig = bridgeFrameTargets.get(wins[i]) || (wins[i] === bridgeTargetWin ? bridgeTargetOrigin : '*');
      postBridgeMessage(wins[i], { type: 'theme-sync', theme }, targetOrig);
    }
  }

  function broadcastBridgePing() {
    const reqId = `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const theme = getCurrentThemeBridgePayload();
    const wins = collectCandidateFrameWindows();
    for (let i = 0; i < wins.length; i++) {
      postBridgeMessage(wins[i], { type: 'bridge-ping', requestId: reqId }, '*');
      postBridgeMessage(wins[i], { type: 'theme-sync', theme }, '*');
    }
  }

  function clearPendingWorkbenchNav() {
    clearBridgeRetryTimers();
    pendingIntentId = '';
    pendingWorkbenchTab = '';
    pendingWorkbenchTabAt = 0;
  }

  function dispatchSwitchTabWithRetry(targetTab) {
    if (!targetTab || !ALLOWED_BRIDGE_TABS.has(targetTab)) return;
    clearBridgeRetryTimers();
    const intentId = `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    pendingWorkbenchTab = targetTab;
    pendingWorkbenchTabAt = Date.now();
    pendingIntentId = intentId;

    const sendAttempt = (attempt) => {
      if (disposed || pendingIntentId !== intentId) return;
      const reqId = `${intentId}-r${attempt}`;
      if (bridgeTargetWin) {
        postBridgeMessage(bridgeTargetWin, {
          type: 'switch-tab',
          intentId,
          requestId: reqId,
          tab: targetTab,
          focus: true
        }, bridgeTargetOrigin);
      }
      // Also broadcast discovery ping + switch-tab to candidate frames on early/retry attempts so hot-reloaded or nested frames pick it up
      if (!bridgeTargetWin || attempt === 1 || attempt === 3) {
        const wins = collectCandidateFrameWindows();
        for (let i = 0; i < wins.length; i++) {
          if (wins[i] === bridgeTargetWin) continue;
          postBridgeMessage(wins[i], { type: 'bridge-ping', requestId: `p-${reqId}` }, '*');
          postBridgeMessage(wins[i], {
            type: 'switch-tab',
            intentId,
            requestId: reqId,
            tab: targetTab,
            focus: true
          }, '*');
        }
      }
    };

    const delays = [0, 100, 260, 600, 1100, 1800];
    for (let i = 0; i < delays.length; i++) {
      const idx = i;
      if (delays[i] === 0) {
        sendAttempt(0);
      } else {
        bridgeRetryTimers.push(setTimeout(() => sendAttempt(idx), delays[idx]));
      }
    }
  }

  function sanitizeQuotaPayload(q) {
    if (!q || typeof q !== 'object') return null;
    const normPct = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : null;
    };
    const pct5h = normPct(q.pct5h);
    const pct7d = normPct(q.pct7d);
    let families = null;
    if (q.families && typeof q.families === 'object') {
      const cleanFam = {};
      for (const fk of ['gemini', 'claude', 'gpt']) {
        const src = q.families[fk];
        if (!src || typeof src !== 'object') continue;
        const rec = {};
        const f5 = normPct(src.pct5h);
        const f7 = normPct(src.pct7d);
        if (f5 !== null) rec.pct5h = f5;
        if (f7 !== null) rec.pct7d = f7;
        if (Object.keys(rec).length) cleanFam[fk] = rec;
      }
      if (Object.keys(cleanFam).length) families = cleanFam;
    }
    if (pct5h === null && pct7d === null && !families) return null;
    const rawEmail = typeof q.accountEmail === 'string' ? q.accountEmail.trim().toLowerCase() : '';
    const accountEmail = rawEmail.includes('@') && rawEmail.length <= 254 ? rawEmail : '';
    return {
      pct5h,
      pct7d,
      reset5hAt: typeof q.reset5hAt === 'string' ? q.reset5hAt.slice(0, 40) : '',
      reset7dAt: typeof q.reset7dAt === 'string' ? q.reset7dAt.slice(0, 40) : '',
      families,
      accountEmail,
      tierName: typeof q.tierName === 'string' ? q.tierName.trim().slice(0, 48) : '',
      observedAt: Number(q.observedAt) || Date.now()
    };
  }

  function formatShortTierName(rawTier) {
    const s = String(rawTier || '').trim();
    if (!s) return '';
    if (/^(?:antigravity\s+)?starter(?:\s+quota)?$/i.test(s)) return 'Starter';
    return s.length > 24 ? `${s.slice(0, 22)}…` : s;
  }

  function shortAccountEmail(em) {
    const s = String(em || '').trim();
    if (!s) return '';
    const at = s.indexOf('@');
    if (at <= 0) return s.slice(0, 16);
    const local = s.slice(0, at);
    return local.length > 12 ? `${local.slice(0, 10)}…` : local;
  }

  function syncWorkbenchTooltip() {
    const wbBtn = document.getElementById('ag-ps-btn-workbench');
    if (!wbBtn) return;
    const parts = ['快捷打开 Prism 工作台'];
    const q = sanitizeQuotaPayload(getQuotaState()) || cachedLiveQuota;
    const liveEmail = String(q?.accountEmail || '').trim().toLowerCase();
    const sumEmail = String(cachedAccountSummary?.activeEmail || '').trim().toLowerCase();
    const validSum = (cachedAccountSummary && sumEmail && liveEmail && sumEmail !== liveEmail)
      ? null
      : cachedAccountSummary;
    if (validSum && validSum.activeAlias) {
      const roleTag = validSum.activeRole === 'primary' ? '主号' : '备号';
      parts.push(`${roleTag}: ${validSum.activeAlias}`);
    } else if (liveEmail) {
      parts.push(`在线: ${shortAccountEmail(liveEmail)}`);
    }
    if (q && (typeof q.pct5h === 'number' || typeof q.pct7d === 'number')) {
      const qBits = [];
      if (typeof q.pct5h === 'number') qBits.push(`5h ${q.pct5h}%`);
      if (typeof q.pct7d === 'number') qBits.push(`7d ${q.pct7d}%`);
      if (qBits.length) parts.push(qBits.join(' · '));
    }
    setAttrIfChanged(wbBtn, 'data-ag-ps-tip', parts.join(' ｜ '));
  }

  function pushLiveQuotaToBridge(force = false) {
    const live = sanitizeQuotaPayload(getQuotaState());
    if (!live) return;
    cachedLiveQuota = live;
    try { localStorage.setItem(LIVE_QUOTA_STORAGE_KEY, JSON.stringify(live)); } catch {}
    syncWorkbenchTooltip();
    const famSig = live.families
      ? Object.entries(live.families).map(([k, v]) => `${k}:${v.pct5h ?? ''}/${v.pct7d ?? ''}`).join(',')
      : '';
    const sig = `${live.accountEmail || ''}|${live.pct5h ?? ''}|${live.pct7d ?? ''}|${live.reset5hAt.slice(0, 16)}|${live.reset7dAt.slice(0, 16)}|${famSig}`;
    const now = Date.now();
    if (!force && sig === lastPushedQuotaSig && now - lastPushedQuotaAt < 60000) return;
    lastPushedQuotaSig = sig;
    lastPushedQuotaAt = now;
    if (bridgeTargetWin) {
      if (!isOwnedIframeWindow(bridgeTargetWin) || !postBridgeMessage(bridgeTargetWin, { type: 'quota-sync', quota: stripQuotaEmailForBridge(live) }, bridgeTargetOrigin)) {
        bridgeTargetWin = null;
      }
    }
  }

  function onWorkbenchBridgeMessage(event) {
    if (disposed) return;
    const data = event && event.data;
    if (!data || typeof data !== 'object' || data.__agPrismBridge !== 'v1') return;
    if (!isTrustedBridgeOrigin(event.origin)) return;
    const src = event.source;
    if (!src || src === window) return;
    if (data.source && data.source !== 'prism-files') return;
    const replyOrigin = event.origin;

    if (data.type === 'ready' || data.type === 'bridge-pong') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeFrameTargets.set(src, replyOrigin);
      if (data.role !== 'inline-card') {
        bridgeTargetWin = src;
        bridgeTargetOrigin = replyOrigin;
        bridgeLastSeenAt = Date.now();
      }
      const liveNow = sanitizeQuotaPayload(getQuotaState()) || (cachedLiveQuota && (cachedLiveQuota.pct5h !== null || cachedLiveQuota.pct7d !== null) ? cachedLiveQuota : null);
      const wantTab =
        data.role !== 'inline-card' && pendingWorkbenchTab && Date.now() - pendingWorkbenchTabAt < 8000 && ALLOWED_BRIDGE_TABS.has(pendingWorkbenchTab)
          ? pendingWorkbenchTab
          : '';
      postBridgeMessage(src, {
        type: 'init-sync',
        switchTab: wantTab,
        intentId: wantTab ? (pendingIntentId || `init-${Date.now().toString(36)}`) : '',
        focus: Boolean(wantTab),
        quota: stripQuotaEmailForBridge(liveNow),
        theme: getCurrentThemeBridgePayload()
      }, replyOrigin);
      return;
    }

    if (data.type === 'ack') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeTargetWin = src;
      bridgeTargetOrigin = replyOrigin;
      bridgeLastSeenAt = Date.now();
      if (data.ok && pendingIntentId && data.intentId === pendingIntentId) {
        pendingIntentId = '';
        pendingWorkbenchTab = '';
        pendingWorkbenchTabAt = 0;
        clearBridgeRetryTimers();
      }
      return;
    }

    if (data.type === 'close-workbench') {
      if (!isOwnedIframeWindow(src)) return;
      toggleOrClosePrismWorkbench();
      return;
    }

    if (data.type === 'set-tier-badge-mode') {
      if (!isOwnedIframeWindow(src)) return;
      if (PRISM_TIER_MODES.includes(data.mode)) {
        setPrismTierBadgeMode(data.mode, 'workbench');
      }
      return;
    }

    if (data.type === 'account-switched') {
      if (!isOwnedIframeWindow(src)) return;
      recordAccountSwitchMarker(Date.now());
      return;
    }

    if (data.type === 'account-summary' && data.summary && typeof data.summary === 'object') {
      if (!isOwnedIframeWindow(src)) return;
      bridgeTargetWin = src;
      bridgeTargetOrigin = replyOrigin;
      bridgeLastSeenAt = Date.now();
      const s = data.summary;
      if (s.pendingSwitchEmail) {
        recordAccountSwitchMarker(Date.now());
      }
      cachedAccountSummary = {
        enabled: Boolean(s.enabled),
        activeAlias: String(s.activeAlias || '').trim().slice(0, 32),
        activeEmail: String(s.activeEmail || '').trim().slice(0, 64),
        activeRole: s.activeRole === 'primary' ? 'primary' : (s.activeRole === 'backup' ? 'backup' : ''),
        accountCount: Math.max(0, Math.min(99, Number(s.accountCount) || 0)),
        pendingSwitchEmail: String(s.pendingSwitchEmail || '').trim().slice(0, 64),
        updatedAt: Date.now()
      };
      try { localStorage.setItem(ACCOUNT_SUMMARY_STORAGE_KEY, JSON.stringify(cachedAccountSummary)); } catch {}
      syncWorkbenchTooltip();
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') {
        renderPopoverContent(pop);
      }
    }
  }
  window.addEventListener('message', onWorkbenchBridgeMessage);
  onCleanup(() => {
    window.removeEventListener('message', onWorkbenchBridgeMessage);
    clearBridgeRetryTimers();
    bridgeFrameTargets.clear();
    bridgeTargetWin = null;
  });
  setTimeout(() => { if (!disposed) broadcastBridgePing(); }, 450);

  function emitBus(type) {
    if (disposed) return;
    if (type === 'theme') {
      try { broadcastThemeToFrames(); } catch {}
    }
    const payload = {
      type,
      prefs: Object.assign({}, prefs),
      busy: isAgentGenerating(),
      dark: isCurrentlyDark(),
      path: window.location.pathname
    };
    for (const fn of busSubscribers) {
      try { fn(payload); } catch {}
    }
  }

  function setPref(key, val) {
    if (!key) return false;
    const norm = normalizePrefValue(key, val);
    if (norm === undefined || Object.is(prefs[key], norm)) return false;
    prefs[key] = norm;
    savePrefs();
    if (key === 'mascotSize') {
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
    } else if (key === 'performanceMode' || key === 'ignoreReducedMotion') {
      const busy = isAgentGenerating();
      syncStreamObserver(busy);
      syncMascotDock(busy);
    } else if (key === 'showWorkbenchBtn' || key === 'outline') {
      syncToolbarButtons();
    } else if (key === 'tokenUnit') {
      syncTokenUnitBridge(true);
      syncUsageExtraMount();
    } else if (key === 'thoughtMode') {
      if (norm === 'off') {
        thoughtTextMemo = new WeakMap();
        thoughtPeekOriginal = new WeakSet();
        try { window.__agProjectCall?.('clearTranslateCache', {}, 4000); } catch {}
      }
      syncThoughtBlocks(isAgentGenerating());
    }
    emitBus('prefs');
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') {
      renderPopoverContent(pop);
    }
    return true;
  }

  const EXPERIENCE_PRESETS = [
    {
      id: 'minimal',
      label: '🕊 极简专注',
      tip: '关闭粒子与桌面伙伴，仅保留静态卡片层次与三色完工提醒，安静无干扰',
      patch: {
        performanceMode: 'power-save',
        composerBorderFx: 'static',
        borderBeam: false,
        semanticAfterglow: true,
        thinkingOrb: false,
        mascot: false,
        inkStream: false,
        opticalFacets: true
      }
    },
    {
      id: 'recommended',
      label: '✦ 灵动推荐',
      tip: '默认最佳平衡：回复时丝滑流光、完工三色微光、思考粒子球与闲置自动休眠',
      patch: {
        performanceMode: 'balanced',
        composerBorderFx: 'smart',
        borderBeam: true,
        borderBeamMode: 'busy',
        semanticAfterglow: true,
        thinkingOrb: true,
        mascot: true,
        inkStream: true,
        opticalFacets: true
      }
    },
    {
      id: 'vivid',
      label: '🌈 炫彩满血',
      tip: '开启常驻流光环、满血光晕、活泼伙伴漫游与消息气泡主题融合色',
      patch: {
        performanceMode: 'vivid',
        composerBorderFx: 'beam',
        borderBeam: true,
        borderBeamMode: 'always',
        semanticAfterglow: true,
        thinkingOrb: true,
        mascot: true,
        mascotRoam: true,
        inkStream: true,
        opticalFacets: true,
        bubbleTint: true
      }
    }
  ];

  function detectActiveExperiencePreset(p) {
    for (let i = 0; i < EXPERIENCE_PRESETS.length; i++) {
      const pr = EXPERIENCE_PRESETS[i];
      const keys = Object.keys(pr.patch);
      let match = true;
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        if (k === 'opticalFacets') {
          if ((p.opticalFacets !== false) !== Boolean(pr.patch[k])) { match = false; break; }
        } else if (!Object.is(p[k], pr.patch[k])) {
          match = false;
          break;
        }
      }
      if (match) return pr.id;
    }
    return 'custom';
  }

  function applyExperiencePreset(presetId) {
    const pr = EXPERIENCE_PRESETS.find((x) => x.id === presetId);
    if (!pr) return false;
    for (const [k, v] of Object.entries(pr.patch)) {
      const norm = normalizePrefValue(k, v);
      if (norm !== undefined) prefs[k] = norm;
    }
    savePrefs();
    const busy = isAgentGenerating();
    syncStreamObserver(busy);
    syncMascotDock(busy);
    emitBus('prefs');
    return true;
  }

  function openUnderlyingUxSettings() {
    closePopoverAnimated(true);
    syncToolbarActiveStates();
    const clickUxNav = () => {
      const navBtn = document.getElementById('ag-claude-ux-settings-nav');
      if (navBtn) {
        navBtn.click();
        return true;
      }
      return false;
    };
    if (clickUxNav()) return;
    const settingsBtn =
      document.querySelector('[data-testid="settings-button"]') ||
      document.querySelector('a[href="/settings"], button[aria-label*="设置"], button[aria-label*="Settings"]');
    if (settingsBtn && typeof settingsBtn.click === 'function') {
      settingsBtn.click();
    }
    let tries = 0;
    const poll = () => {
      if (disposed || clickUxNav() || ++tries > 12) return;
      setTimeout(poll, 90);
    };
    setTimeout(poll, 70);
  }

  const POPOVER_TABS = [
    { id: 'appearance', label: '🎨 外观' },
    { id: 'motion', label: '✨ 动效' },
    { id: 'nav', label: '🧭 导航' },
    { id: 'tools', label: '⚡ 效率' }
  ];
  let activePopTab = 'appearance';

  function buildBusHelpers(tabOverride) {
    return {
      prefs: Object.assign({}, prefs),
      activeTab: tabOverride || activePopTab,
      getPrefs: () => Object.assign({}, prefs),
      setPref,
      refreshPopover: () => {
        const pop = document.getElementById('ag-ps-popover');
        if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
      },
      showToast: showJumpToast,
      isDark: isCurrentlyDark,
      isBusy: isAgentGenerating,
      escapeHtml
    };
  }

  /* ---- GitHub Release Update Checker (on-demand only, zero auto network calls) ---- */
  let updateState = { status: 'idle', latest: '', url: REPO_RELEASES_URL };

  function compareSemver(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  async function checkGithubUpdate() {
    if (updateState.status === 'checking') return;
    updateState = { status: 'checking', latest: '', url: REPO_RELEASES_URL };
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(REPO_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (disposed) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (disposed) return;
      const tag = String(data.tag_name || '').trim();
      const url = typeof data.html_url === 'string' && /^https:\/\/github\.com\//.test(data.html_url) ? data.html_url : REPO_RELEASES_URL;
      if (tag && compareSemver(tag, SUITE_VERSION) > 0) {
        updateState = { status: 'available', latest: tag, url };
        showJumpToast(`发现新版本 ${tag}，可前往 Releases 下载更新`);
      } else {
        updateState = { status: 'latest', latest: tag || `v${SUITE_VERSION}`, url };
        showJumpToast(`当前已是最新版本 v${SUITE_VERSION}`);
      }
    } catch {
      if (disposed) return;
      updateState = { status: 'error', latest: '', url: REPO_RELEASES_URL };
      showJumpToast('检查更新失败，请稍后再试');
    }
    if (disposed) return;
    const p2 = document.getElementById('ag-ps-popover');
    if (p2 && p2.getAttribute('data-open') === '1') renderPopoverContent(p2);
  }

  /* ---- Pointer-Safe Theme-Adaptive Custom Tooltip Engine (data-ag-ps-tip) ---- */
  let tipEl = null;
  let tipTarget = null;

  function ensureTooltipEl() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'ag-ps-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.setAttribute('data-ag-i18n-ignore', '1');
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function hideCustomTooltip() {
    tipTarget = null;
    if (tipEl) tipEl.removeAttribute('data-show');
  }

  function showCustomTooltip(target, evt) {
    if (disposed || !target) return;
    const text = target.getAttribute('data-ag-ps-tip');
    if (!text) return;
    tipTarget = target;
    const el = ensureTooltipEl();
    const status = target.getAttribute('data-ag-ps-tip-status') || '';
    el.textContent = '';
    if (status === 'busy' || status === 'idle') {
      const dot = document.createElement('span');
      dot.className = 'ag-ps-tip-dot';
      dot.setAttribute('data-status', status);
      el.appendChild(dot);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    el.setAttribute('data-show', '1');

    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth || 140;
    const th = el.offsetHeight || 28;
    const isMascot = target.classList.contains('ag-ps-actor');
    const clearance = isMascot ? 16 : 12;

    let left = Math.round(r.left + r.width / 2 - tw / 2);
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));

    // Strictly prefer ABOVE target so the OS pointer below never obscures text
    let top = Math.round(r.top - th - clearance);
    let place = 'top';
    if (top < 8) {
      top = Math.round(r.bottom + 14);
      place = 'bottom';
      if (evt && typeof evt.clientY === 'number' && top <= evt.clientY + 18) {
        top = Math.min(window.innerHeight - th - 8, Math.round(evt.clientY + 22));
      }
    } else if (evt && typeof evt.clientY === 'number' && top + th > evt.clientY - 12) {
      top = Math.max(8, Math.round(evt.clientY - th - 16));
    }

    el.setAttribute('data-place', place);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function onTipOver(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-ag-ps-tip]') : null;
    if (t && t !== tipTarget) showCustomTooltip(t, e);
  }
  function onTipOut(e) {
    if (!tipTarget) return;
    const rel = e.relatedTarget;
    if (!rel || !tipTarget.contains(rel)) hideCustomTooltip();
  }
  document.addEventListener('mouseover', onTipOver, true);
  document.addEventListener('mouseout', onTipOut, true);
  document.addEventListener('focusin', onTipOver, true);
  document.addEventListener('focusout', hideCustomTooltip, true);
  document.addEventListener('scroll', hideCustomTooltip, true);
  onCleanup(() => {
    document.removeEventListener('mouseover', onTipOver, true);
    document.removeEventListener('mouseout', onTipOut, true);
    document.removeEventListener('focusin', onTipOver, true);
    document.removeEventListener('focusout', hideCustomTooltip, true);
    document.removeEventListener('scroll', hideCustomTooltip, true);
    if (tipEl) tipEl.remove();
    tipEl = null;
  });

  function renderPopoverContent(pop) {
    const darkNow = isCurrentlyDark();
    const curTab = POPOVER_TABS.some((t) => t.id === activePopTab) ? activePopTab : 'appearance';
    const helpers = buildBusHelpers(curTab);

    const extRenderedById = Object.create(null);
    const customExtList = [];
    const sortedSecs = registeredPanelSections.slice().sort((a, b) => (a.order || 50) - (b.order || 50));
    for (let i = 0; i < sortedSecs.length; i++) {
      const sec = sortedSecs[i];
      let body = '';
      try { body = String(sec.render ? sec.render(helpers.prefs, helpers) : '').trim(); } catch {}
      if (!body) continue;
      const html = `<div class="ag-ps-ext-section"${sec.title ? ' data-titled="1"' : ''} data-ext-sec="${escapeHtml(sec.id)}">
        ${sec.title ? `<div class="ag-ps-sec-lbl"><span>${escapeHtml(sec.title)}</span></div>` : ''}
        ${body}
      </div>`;
      extRenderedById[sec.id] = html;
      if (sec.id !== 'fx' && sec.id !== 'workflow') {
        customExtList.push(html);
      }
    }

    const updateBtnText =
      updateState.status === 'checking'
        ? '检查中…'
        : updateState.status === 'available'
          ? `新版本 ${escapeHtml(updateState.latest)} ↗`
          : updateState.status === 'latest'
            ? '已是最新 ✓'
            : updateState.status === 'error'
              ? '重试检查'
              : '检查更新';
    const liveQ = sanitizeQuotaPayload(getQuotaState()) || cachedLiveQuota;
    const rawAccSum = cachedAccountSummary;
    const sumEmail = String(rawAccSum?.activeEmail || '').trim().toLowerCase();
    const liveEmail = String(liveQ?.accountEmail || '').trim().toLowerCase();
    const accSum = (rawAccSum && sumEmail && liveEmail && sumEmail !== liveEmail) ? null : rawAccSum;
    const effectiveEmail = (accSum ? sumEmail : '') || liveEmail;
    const accTitle = accSum?.activeAlias
      ? `${accSum.activeRole === 'primary' ? '★ ' : ''}${accSum.activeAlias}${effectiveEmail ? ` · ${shortAccountEmail(effectiveEmail)}` : ''}`
      : (effectiveEmail ? shortAccountEmail(effectiveEmail) : '多账号安全接力');
    const quotaChips = [];
    const tierChipHtml = renderPrismTierBadgeHtml(liveQ?.tierName);
    if (tierChipHtml) {
      quotaChips.push(tierChipHtml);
    }
    if (liveQ && typeof liveQ.pct5h === 'number') {
      const tier5 = liveQ.pct5h >= 50 ? 'ok' : liveQ.pct5h >= 20 ? 'warn' : 'danger';
      quotaChips.push(`<span class="ag-ps-qchip" data-tier="${tier5}">5h ${liveQ.pct5h}%</span>`);
    }
    if (liveQ && typeof liveQ.pct7d === 'number') {
      const tier7 = liveQ.pct7d >= 50 ? 'ok' : liveQ.pct7d >= 20 ? 'warn' : 'danger';
      quotaChips.push(`<span class="ag-ps-qchip" data-tier="${tier7}">7d ${liveQ.pct7d}%</span>`);
    }
    const accSubHtml = accSum?.pendingSwitchEmail
      ? `<span class="ag-ps-qchip" data-tier="warn">待重启切至 ${escapeHtml(shortAccountEmail(accSum.pendingSwitchEmail))}</span>`
      : (quotaChips.length
        ? quotaChips.join('')
        : `<span class="ag-ps-toggle-sub">${accSum?.accountCount ? `已捕获 ${accSum.accountCount} 个账号` : '打开工作台同步主备账号与额度'}</span>`);

    const catTabsHtml = POPOVER_TABS.map(
      (t) =>
        `<button type="button" class="ag-ps-cat-tab" role="tab" aria-selected="${t.id === curTab ? 'true' : 'false'}" data-ps-tab="${t.id}" data-selected="${t.id === curTab ? '1' : '0'}">${t.label}</button>`
    ).join('');

    let tabBodyHtml = '';
    if (curTab === 'appearance') {
      tabBodyHtml = `
        <div class="ag-ps-sec-lbl" style="margin-top:4px"><span>浅色配色</span><span class="ag-ps-sec-tag">${!darkNow ? '当前生效' : '浅色首选'}</span></div>
        <div class="ag-ps-palette-row">
          <button type="button" class="ag-ps-pal-btn" data-set-light="default" data-selected="${prefs.lightPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#FFFFFF 52%,#2F75C3 52%)"></span>纯白默认</button>
          <button type="button" class="ag-ps-pal-btn" data-set-light="crystal" data-selected="${prefs.lightPalette === 'crystal' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#E8EEF6 52%,#2563EB 52%)"></span>白昼冷晶</button>
          <button type="button" class="ag-ps-pal-btn" data-set-light="alabaster" data-selected="${prefs.lightPalette === 'alabaster' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#F1ECE2 52%,#B45309 52%)"></span>暖白画册</button>
          <button type="button" class="ag-ps-pal-btn" data-set-light="sage" data-selected="${prefs.lightPalette === 'sage' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#E6EFE9 52%,#15803D 52%)"></span>松雾青岚</button>
        </div>

        <div class="ag-ps-sec-lbl"><span>深色配色</span><span class="ag-ps-sec-tag">${darkNow ? '当前生效' : '深色首选'}</span></div>
        <div class="ag-ps-palette-row">
          <button type="button" class="ag-ps-pal-btn" data-set-dark="default" data-selected="${prefs.darkPalette === 'default' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#212120 52%,#60A5FA 52%)"></span>暖炭默认</button>
          <button type="button" class="ag-ps-pal-btn" data-set-dark="obsidian" data-selected="${prefs.darkPalette === 'obsidian' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#09090B 52%,#3B82F6 52%)"></span>深空黑曜</button>
          <button type="button" class="ag-ps-pal-btn" data-set-dark="basalt" data-selected="${prefs.darkPalette === 'basalt' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#141312 52%,#D97706 52%)"></span>暖炭玄岩</button>
          <button type="button" class="ag-ps-pal-btn" data-set-dark="marine" data-selected="${prefs.darkPalette === 'marine' ? '1' : '0'}"><span class="ag-ps-swatch" style="background:linear-gradient(135deg,#0B1220 52%,#38BDF8 52%)"></span>深海墨蓝</button>
        </div>

        <div class="ag-ps-sec-lbl"><span>质感与排版</span></div>
        ${extRenderedById.fx || ''}
      `;
    } else if (curTab === 'motion') {
      const mascotSectionHtml = `
        <div class="ag-ps-toggle-list">
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label"><span>输入框像素小伙伴</span><span class="ag-ps-toggle-sub">空闲时自动安静休眠</span></div>
            <button type="button" role="switch" aria-checked="${prefs.mascot ? 'true' : 'false'}" aria-label="输入框像素小伙伴" class="ag-ps-switch" data-toggle="mascot" data-on="${prefs.mascot ? '1' : '0'}"></button>
          </div>
          ${
            prefs.mascot
              ? `<div class="ag-ps-subpanel">
                  <div class="ag-ps-toggle-row">
                    <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">数量${prefs.mascotCountMode === 'agents' ? `（1 主控 + ${getLiveSubagents().length} 活跃）` : ''}</span></div>
                    <div class="ag-ps-seg-group">
                      <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="fixed" data-selected="${prefs.mascotCountMode === 'fixed' ? '1' : '0'}">固定</button>
                      <button type="button" class="ag-ps-seg-btn" data-mascot-count-mode="agents" data-selected="${prefs.mascotCountMode === 'agents' ? '1' : '0'}">跟随 Agent</button>
                    </div>
                  </div>
                  ${
                    prefs.mascotCountMode === 'fixed'
                      ? `<div class="ag-ps-toggle-row" style="align-items:flex-start;flex-direction:column;gap:5px">
                          <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">样式预设（Shift+点精灵自由变装 · Alt+点集结）</span></div>
                          <div class="ag-ps-seg-group ag-ps-mascot-style-grid">
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="trio" data-selected="${prefs.mascotStyle === 'trio' ? '1' : '0'}">三萌</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="zoo" data-selected="${prefs.mascotStyle === 'zoo' ? '1' : '0'}">萌宠队</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="cyber" data-selected="${prefs.mascotStyle === 'cyber' ? '1' : '0'}">极客队</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="crab" data-selected="${prefs.mascotStyle === 'crab' ? '1' : '0'}">橘蟹</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="cat" data-selected="${prefs.mascotStyle === 'cat' ? '1' : '0'}">紫猫</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="penguin" data-selected="${prefs.mascotStyle === 'penguin' ? '1' : '0'}">企鹅</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-style="fox" data-selected="${prefs.mascotStyle === 'fox' ? '1' : '0'}">赤狐</button>
                          </div>
                        </div>`
                      : `<div class="ag-ps-toggle-row">
                          <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">保底数量</span></div>
                          <div class="ag-ps-seg-group">
                            <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="1" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 1 ? '1' : '0'}">1只</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="2" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 2 ? '1' : '0'}">2只</button>
                            <button type="button" class="ag-ps-seg-btn" data-mascot-min-count="3" data-selected="${clampMascotMinCount(prefs.mascotMinCount) === 3 ? '1' : '0'}">3只</button>
                          </div>
                        </div>`
                  }
                  <div class="ag-ps-toggle-row">
                    <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">工作态漫游跑跳</span></div>
                    <button type="button" role="switch" aria-checked="${prefs.mascotRoam ? 'true' : 'false'}" aria-label="工作态漫游跑跳" class="ag-ps-switch" data-toggle="mascotRoam" data-on="${prefs.mascotRoam ? '1' : '0'}"></button>
                  </div>
                  <div class="ag-ps-toggle-row">
                    <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">性格</span></div>
                    <div class="ag-ps-seg-group">
                      <button type="button" class="ag-ps-seg-btn" data-mascot-vibe="calm" data-selected="${prefs.mascotVibe === 'calm' ? '1' : '0'}">温顺</button>
                      <button type="button" class="ag-ps-seg-btn" data-mascot-vibe="lively" data-selected="${prefs.mascotVibe !== 'calm' ? '1' : '0'}">活泼</button>
                    </div>
                  </div>
                  <div class="ag-ps-toggle-row" title="全局生效：所有对话与账号共用同一大小，调节一次处处生效">
                    <div class="ag-ps-toggle-label"><span class="ag-ps-toggle-sub">全局大小</span></div>
                    <div class="ag-ps-range-wrap">
                      <input type="range" class="ag-ps-range" data-mascot-size="1" min="${MASCOT_SIZE_MIN}" max="${MASCOT_SIZE_MAX}" step="2" value="${clampMascotSize(prefs.mascotSize)}" aria-label="像素伙伴全局大小" />
                      <span class="ag-ps-range-val" data-mascot-size-val="1">${clampMascotSize(prefs.mascotSize)}px</span>
                      <button type="button" class="ag-ps-mini-reset" data-mascot-size-reset="1" ${clampMascotSize(prefs.mascotSize) === MASCOT_SIZE_DEFAULT ? 'disabled' : ''}>复位</button>
                    </div>
                  </div>
                </div>`
              : ''
          }
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label"><span>柔和流式文字淡入</span><span class="ag-ps-toggle-sub">生成文字自然浮现 · 打字零干扰</span></div>
            <button type="button" role="switch" aria-checked="${prefs.inkStream ? 'true' : 'false'}" aria-label="柔和流式文字淡入" class="ag-ps-switch" data-toggle="inkStream" data-on="${prefs.inkStream ? '1' : '0'}"></button>
          </div>
        </div>
      `;
      tabBodyHtml = `${extRenderedById.fx || ''}${mascotSectionHtml}`;
    } else if (curTab === 'nav') {
      const coreNavHtml = `
        <div class="ag-ps-toggle-list">
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label"><span>会话大纲 &amp; 跳轮抽屉</span><span class="ag-ps-toggle-sub">Alt+↑/↓ 跳轮 · Alt+O 展开大纲</span></div>
            <button type="button" role="switch" aria-checked="${prefs.outline ? 'true' : 'false'}" aria-label="会话大纲与跳轮抽屉" class="ag-ps-switch" data-toggle="outline" data-on="${prefs.outline ? '1' : '0'}"></button>
          </div>
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label"><span>顶栏「工作台」快捷入口</span><span class="ag-ps-toggle-sub">纯前端增强模式可隐藏顶栏按钮</span></div>
            <button type="button" role="switch" aria-checked="${prefs.showWorkbenchBtn !== false ? 'true' : 'false'}" aria-label="顶栏工作台快捷入口" class="ag-ps-switch" data-toggle="showWorkbenchBtn" data-on="${prefs.showWorkbenchBtn !== false ? '1' : '0'}"></button>
          </div>
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label" data-ag-ps-tip="自动掩码代码并脱敏密码/密钥后经 Google 翻译转换 · 关闭即清缓存（沉浸模式仍可一键查看原文）"><span>思考过程实时中译</span><span class="ag-ps-toggle-sub">自动掩码代码并脱敏密码/密钥后经 Google 翻译转换 · 关闭即清缓存</span></div>
            <div class="ag-ps-seg-group">
              <button type="button" class="ag-ps-seg-btn" data-thought-mode="off" data-selected="${prefs.thoughtMode === 'off' ? '1' : '0'}">关</button>
              <button type="button" class="ag-ps-seg-btn" data-thought-mode="bilingual" data-selected="${prefs.thoughtMode === 'bilingual' ? '1' : '0'}">双语</button>
              <button type="button" class="ag-ps-seg-btn" data-thought-mode="immersive" data-selected="${prefs.thoughtMode === 'immersive' ? '1' : '0'}">沉浸</button>
            </div>
          </div>
        </div>
      `;
      tabBodyHtml = `${extRenderedById.fx || ''}${coreNavHtml}${extRenderedById.workflow || ''}`;
    } else {
      const coreToolsHtml = `
        <div class="ag-ps-toggle-list">
          <div class="ag-ps-toggle-row">
            <div class="ag-ps-toggle-label"><span>名著换算 &amp; 12 周热力图</span><span class="ag-ps-toggle-sub">右侧「概览 → 用量统计」底部 <a href="#" data-jump-usage="1" style="color:var(--primary,#2F75C3);text-decoration:none;margin-left:4px">定位 ↗</a></span></div>
            <button type="button" role="switch" aria-checked="${prefs.usageExtra ? 'true' : 'false'}" aria-label="名著换算与 12 周热力图" class="ag-ps-switch" data-toggle="usageExtra" data-on="${prefs.usageExtra ? '1' : '0'}"></button>
          </div>
        </div>
      `;
      tabBodyHtml = `${extRenderedById.fx || ''}${coreToolsHtml}${extRenderedById.workflow || ''}${customExtList.join('')}`;
    }

    const curPreset = detectActiveExperiencePreset(helpers.prefs);
    const presetButtonsHtml = EXPERIENCE_PRESETS.map(
      (pr) =>
        `<button type="button" class="ag-ps-preset-btn" data-ps-preset="${pr.id}" data-selected="${curPreset === pr.id ? '1' : '0'}" data-ag-ps-tip="${escapeHtml(pr.tip)}">${pr.label}</button>`
    ).join('');

    pop.innerHTML = `
      <div class="ag-ps-pop-hdr">
        <span class="ag-ps-pop-title">✦ 棱镜控制中心</span>
        <span style="display:inline-flex;align-items:center;gap:5px;">
          ${prefs.showWorkbenchBtn !== false ? '<button type="button" class="ag-ps-mini-reset" data-open-workbench="1" title="打开右侧 Prism 工作台（文件 / 历史检索 / 账号接力）">工作台 ↗</button>' : ''}
          <button type="button" class="ag-ps-mini-reset" data-open-ux-settings="1" title="前往「设置 → 界面增强」管理底层布局模块">全部设置 ⚙</button>
        </span>
      </div>

      <div class="ag-ps-account-bar">
        <div class="ag-ps-account-info">
          <div class="ag-ps-account-name">
            <span class="ag-ps-account-dot" data-online="${effectiveEmail ? '1' : '0'}" aria-hidden="true"></span>
            <span class="ag-ps-account-text" title="${escapeHtml(effectiveEmail || '')}">${escapeHtml(accTitle)}</span>
          </div>
          <div class="ag-ps-account-meta">${accSubHtml}</div>
        </div>
        <button type="button" class="ag-ps-account-cta" data-open-workbench-tab="accounts" title="打开 Prism 工作台并直达「账号接力」页签">⚡ 切号</button>
      </div>

      <div class="ag-ps-preset-bar" role="group" aria-label="一键体验模式">${presetButtonsHtml}</div>

      <div class="ag-ps-cat-tabs" role="tablist" aria-label="棱镜功能分类">${catTabsHtml}</div>
      <div class="ag-ps-tab-body">${tabBodyHtml}</div>

      <div class="ag-ps-about-bar">
        <span class="ag-ps-about-ver">${darkNow ? '深色' : '浅色'} · Prism v${SUITE_VERSION}${curPreset === 'custom' ? ' · 已自定义' : ''}</span>
        ${
          updateState.status === 'available'
            ? `<a class="ag-ps-update-pill" data-update-link="1" href="${escapeHtml(updateState.url)}" target="_blank" rel="noopener noreferrer">${updateBtnText}</a>`
            : `<button type="button" class="ag-ps-update-pill" data-check-update="1" ${updateState.status === 'checking' ? 'disabled' : ''}>${updateBtnText}</button>`
        }
      </div>
    `;
  }

  function ensurePopover() {
    let pop = document.getElementById('ag-ps-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'ag-ps-popover';
    pop.setAttribute('data-ag-i18n-ignore', '1');
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const tierToggle = e.target.closest('[data-ps-tier-toggle]');
      if (tierToggle) {
        e.preventDefault();
        hideCustomTooltip();
        cyclePrismTierBadgeMode();
        return;
      }
      const catTabBtn = e.target.closest('[data-ps-tab]');
      if (catTabBtn) {
        const nextTab = catTabBtn.getAttribute('data-ps-tab');
        if (POPOVER_TABS.some((t) => t.id === nextTab) && nextTab !== activePopTab) {
          activePopTab = nextTab;
          hideCustomTooltip();
          renderPopoverContent(pop);
          pop.scrollTop = 0;
        }
        return;
      }
      const presetBtn = e.target.closest('[data-ps-preset]');
      if (presetBtn) {
        const pid = presetBtn.getAttribute('data-ps-preset');
        if (applyExperiencePreset(pid)) {
          hideCustomTooltip();
          renderPopoverContent(pop);
          const prObj = EXPERIENCE_PRESETS.find((x) => x.id === pid);
          if (prObj) showJumpToast(`已切换体验模式：${prObj.label}`);
        }
        return;
      }
      const uxSettingsBtn = e.target.closest('[data-open-ux-settings]');
      if (uxSettingsBtn) {
        e.preventDefault();
        openUnderlyingUxSettings();
        return;
      }
      const chkUpd = e.target.closest('[data-check-update]');
      if (chkUpd) {
        e.preventDefault();
        checkGithubUpdate();
        return;
      }
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const secId = extSecEl.getAttribute('data-ext-sec');
        const sec = registeredPanelSections.find((s) => s.id === secId);
        if (sec && typeof sec.onClick === 'function') {
          try {
            if (sec.onClick(e, buildBusHelpers()) === true) return;
          } catch {}
        }
      }
      const jumpUsage = e.target.closest('[data-jump-usage]');
      if (jumpUsage) {
        e.preventDefault();
        closePopoverAnimated(true);
        syncToolbarActiveStates();
        const ovBtn = document.querySelector('[data-testid="toggle-overview-panel"]');
        const ovPanel = document.querySelector('[data-testid="overview-panel"]');
        if ((!ovPanel || ovPanel.hidden || ovPanel.getAttribute('aria-hidden') === 'true') && ovBtn) {
          ovBtn.click();
        }
        setTimeout(() => {
          if (disposed) return;
          syncUsageExtraMount();
          const card = document.querySelector('#ag-claude-ov-sections [data-ov-card="usage"]');
          if (card) {
            card.scrollIntoView({ behavior: isEffectivelyReducedMotion() ? 'auto' : 'smooth', block: 'center' });
            card.classList.remove('ag-ps-turn-pulse');
            void card.offsetWidth;
            card.classList.add('ag-ps-turn-pulse');
            setTimeout(() => {
              if (!disposed) card.classList.remove('ag-ps-turn-pulse');
            }, 1500);
          }
        }, 180);
        return;
      }
      const lBtn = e.target.closest('[data-set-light]');
      if (lBtn) {
        const val = PREF_VALIDATORS.lightPalette(lBtn.getAttribute('data-set-light')) || 'default';
        prefs.lightPalette = val;
        savePrefs();
        applyPalettes();
        emitBus('theme');
        emitBus('prefs');
        renderPopoverContent(pop);
        const name = LIGHT_NAMES[val] || val;
        showJumpToast(isCurrentlyDark() ? `已设为浅色首选「${name}」，切换浅色模式时生效` : `已切换浅色配色：${name}`);
        return;
      }
      const dBtn = e.target.closest('[data-set-dark]');
      if (dBtn) {
        const val = PREF_VALIDATORS.darkPalette(dBtn.getAttribute('data-set-dark')) || 'default';
        prefs.darkPalette = val;
        savePrefs();
        applyPalettes();
        emitBus('theme');
        emitBus('prefs');
        renderPopoverContent(pop);
        const name = DARK_NAMES[val] || val;
        showJumpToast(!isCurrentlyDark() ? `已设为深色首选「${name}」，切换深色模式时生效` : `已切换深色配色：${name}`);
        return;
      }
      const sw = e.target.closest('[data-toggle]');
      if (sw) {
        const k = sw.getAttribute('data-toggle');
        prefs[k] = !prefs[k];
        savePrefs();
        emitBus('prefs');
        const busy = isAgentGenerating();
        if (k === 'inkStream') syncStreamObserver(busy);
        if (k === 'outline' && !prefs.outline) toggleOutlineDrawer(false);
        syncMascotDock(busy);
        syncUsageExtraMount();
        syncToolbarButtons();
        renderPopoverContent(pop);
        return;
      }
      const mcm = e.target.closest('[data-mascot-count-mode]');
      if (mcm) {
        prefs.mascotCountMode = mcm.getAttribute('data-mascot-count-mode') === 'agents' ? 'agents' : 'fixed';
        savePrefs();
        emitBus('prefs');
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const mmc = e.target.closest('[data-mascot-min-count]');
      if (mmc) {
        prefs.mascotMinCount = clampMascotMinCount(mmc.getAttribute('data-mascot-min-count'));
        savePrefs();
        emitBus('prefs');
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const mv = e.target.closest('[data-mascot-vibe]');
      if (mv) {
        prefs.mascotVibe = mv.getAttribute('data-mascot-vibe') === 'calm' ? 'calm' : 'lively';
        savePrefs();
        emitBus('prefs');
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const ms = e.target.closest('[data-mascot-style]');
      if (ms) {
        for (const k of Array.from(actorSkinOverrides.keys())) {
          if (k.startsWith('fixed:')) actorSkinOverrides.delete(k);
        }
        prefs.mascotStyle = PREF_VALIDATORS.mascotStyle(ms.getAttribute('data-mascot-style')) || 'trio';
        savePrefs();
        emitBus('prefs');
        syncMascotDock(isAgentGenerating());
        renderPopoverContent(pop);
        return;
      }
      const mReset = e.target.closest('[data-mascot-size-reset]');
      if (mReset) {
        prefs.mascotSize = MASCOT_SIZE_DEFAULT;
        savePrefs();
        emitBus('prefs');
        applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
        renderPopoverContent(pop);
        return;
      }
      const wbTabBtn = e.target.closest('[data-open-workbench-tab]');
      if (wbTabBtn) {
        const targetTab = wbTabBtn.getAttribute('data-open-workbench-tab') || 'accounts';
        togglePopover(false);
        openPrismWorkbenchQuick(targetTab);
        return;
      }
      const wbBtn = e.target.closest('[data-open-workbench]');
      if (wbBtn) {
        togglePopover(false);
        openPrismWorkbenchQuick();
        return;
      }
      const tm = e.target.closest('[data-thought-mode]');
      if (tm) {
        const nextMode = PREF_VALIDATORS.thoughtMode(tm.getAttribute('data-thought-mode')) || 'bilingual';
        setPref('thoughtMode', nextMode);
      }
    });
    let mascotSizeSaveTimer = 0;
    onCleanup(() => { if (mascotSizeSaveTimer) clearTimeout(mascotSizeSaveTimer); });
    pop.addEventListener('input', (e) => {
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const sec = registeredPanelSections.find((s) => s.id === extSecEl.getAttribute('data-ext-sec'));
        if (sec && typeof sec.onInput === 'function') {
          try { sec.onInput(e, buildBusHelpers()); } catch {}
          return;
        }
      }
      const slider = e.target.closest('[data-mascot-size]');
      if (!slider) return;
      const sz = clampMascotSize(slider.value);
      prefs.mascotSize = sz;
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
      const valEl = pop.querySelector('[data-mascot-size-val]');
      if (valEl) valEl.textContent = `${sz}px`;
      const resetBtn = pop.querySelector('[data-mascot-size-reset]');
      if (resetBtn) resetBtn.disabled = sz === MASCOT_SIZE_DEFAULT;
      if (mascotSizeSaveTimer) clearTimeout(mascotSizeSaveTimer);
      mascotSizeSaveTimer = setTimeout(() => {
        mascotSizeSaveTimer = 0;
        if (disposed) return;
        savePrefs();
        emitBus('prefs');
      }, 140);
    });
    pop.addEventListener('change', (e) => {
      const extSecEl = e.target.closest('[data-ext-sec]');
      if (extSecEl) {
        const sec = registeredPanelSections.find((s) => s.id === extSecEl.getAttribute('data-ext-sec'));
        if (sec && typeof sec.onChange === 'function') {
          try { sec.onChange(e, buildBusHelpers()); } catch {}
          return;
        }
      }
      const slider = e.target.closest('[data-mascot-size]');
      if (!slider) return;
      if (mascotSizeSaveTimer) {
        clearTimeout(mascotSizeSaveTimer);
        mascotSizeSaveTimer = 0;
      }
      const sz = clampMascotSize(slider.value);
      prefs.mascotSize = sz;
      savePrefs();
      emitBus('prefs');
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
    });
    pop.addEventListener('keydown', (e) => {
      const extSecEl = e.target && e.target.closest ? e.target.closest('[data-ext-sec]') : null;
      if (extSecEl) {
        const sec = registeredPanelSections.find((s) => s.id === extSecEl.getAttribute('data-ext-sec'));
        if (sec && typeof sec.onKeyDown === 'function') {
          try { sec.onKeyDown(e, buildBusHelpers()); } catch {}
        }
      }
    });
    document.body.appendChild(pop);
    onCleanup(() => pop.remove());
    return pop;
  }

  function togglePopover(forceState) {
    const pop = ensurePopover();
    closeOutlineAnimated(false);
    const open = typeof forceState === 'boolean' ? forceState : pop.getAttribute('data-open') !== '1';
    if (open) {
      hideCustomTooltip();
      try {
        window.dispatchEvent(new CustomEvent('ag-prism-close-popovers', { detail: { except: 'suite' } }));
      } catch {}
      cancelPopoverClose(pop);
      renderPopoverContent(pop);
      pop.setAttribute('data-open', '1');
      positionFloatingPanel(pop, document.getElementById('ag-ps-btn-suite'));
    } else {
      closePopoverAnimated(false);
    }
    syncToolbarActiveStates();
    notifyOverlayChange();
  }

  function onPeerPopoverCloseSignal(e) {
    if (disposed) return;
    const ex = e && e.detail && e.detail.except ? String(e.detail.except) : '';
    let changed = false;
    if (ex !== 'suite') {
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') {
        closePopoverAnimated(false);
        changed = true;
      }
    }
    if (ex !== 'outline') {
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        closeOutlineAnimated(false);
        changed = true;
      }
    }
    hideCustomTooltip();
    if (changed) {
      syncToolbarActiveStates();
      notifyOverlayChange();
    }
  }
  window.addEventListener('ag-prism-close-popovers', onPeerPopoverCloseSignal);
  onCleanup(() => window.removeEventListener('ag-prism-close-popovers', onPeerPopoverCloseSignal));

  function syncToolbarActiveStates() {
    const popOpen = document.getElementById('ag-ps-popover')?.getAttribute('data-open') === '1';
    const outOpen = document.getElementById('ag-ps-outline')?.getAttribute('data-open') === '1';
    const pBtn = document.getElementById('ag-ps-btn-suite');
    const oBtn = document.getElementById('ag-ps-btn-outline');
    const wBtn = document.getElementById('ag-ps-btn-workbench');
    if (pBtn) pBtn.setAttribute('data-active', popOpen ? '1' : '0');
    if (oBtn) oBtn.setAttribute('data-active', outOpen ? '1' : '0');
    if (wBtn) {
      const rightTab = findWorkbenchEntry(document, { skipSidebar: true });
      const wbOpen = isFullPageWorkbenchActive() || Boolean(rightTab && isAuxWorkbenchTabActive(rightTab));
      wBtn.setAttribute('data-active', wbOpen ? '1' : '0');
    }
  }

  let workbenchOpening = false;
  let lastChatConvPath = /^\/c\/[A-Za-z0-9_-]{6,}/.test(window.location.pathname || '')
    ? window.location.pathname
    : '';

  function isOwnedWorkbenchFrameVisible(minWidthRatio = 0.08) {
    try {
      const frames = document.querySelectorAll('iframe');
      const minW = Math.max(80, (window.innerWidth || 1000) * minWidthRatio);
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!f.isConnected) continue;
        const r = f.getBoundingClientRect();
        if (r.width < minW || r.height < 80) continue;
        if (bridgeTargetWin && f.contentWindow === bridgeTargetWin) return true;
        const meta = `${f.title || ''} ${f.getAttribute('aria-label') || ''} ${f.name || ''} ${f.src || ''}`;
        if (/prism[-_\s]*(?:files|工作台|workbench)/i.test(meta)) return true;
      }
    } catch {}
    return false;
  }

  function isAuxWorkbenchTabActive(tabEl) {
    if (!tabEl || !tabEl.isConnected) return false;
    const check = (el) =>
      Boolean(
        el &&
          (el.getAttribute('aria-selected') === 'true' ||
            el.getAttribute('data-state') === 'active' ||
            el.getAttribute('data-active') === 'true' ||
            el.classList.contains('is-active') ||
            el.classList.contains('active') ||
            (el.classList.contains('agy-aux-tab') && el.classList.contains('bg-secondary')))
      );
    if (check(tabEl) || check(tabEl.closest('.agy-aux-tab'))) {
      return true;
    }
    return isOwnedWorkbenchFrameVisible(0.12);
  }

  function isFullPageWorkbenchActive() {
    const p = window.location.pathname || '';
    if (/^\/view\/mcp-app/i.test(p) && /prism[-_\s]*files/i.test(decodeURIComponent(p))) {
      return true;
    }
    if (getActiveViewportEl()) return false;
    if (getActiveInputBox()) return false;
    const settingsSb = document.querySelector('[data-testid="settings-sidebar"]');
    if (settingsSb && isElementRendered(settingsSb)) return false;
    if (isOwnedWorkbenchFrameVisible(0.42)) return true;
    const sbEntry = findSidebarWorkbenchEntry();
    if (!sbEntry) return false;
    const checkActive = (n) =>
      Boolean(
        n &&
          (n.getAttribute('aria-current') === 'page' ||
            n.getAttribute('aria-selected') === 'true' ||
            n.getAttribute('data-active') === 'true' ||
            n.getAttribute('data-selected') === 'true' ||
            n.getAttribute('data-state') === 'active' ||
            n.classList.contains('bg-sidebar-secondary'))
      );
    return checkActive(sbEntry) || checkActive(sbEntry.parentElement);
  }

  function findSidebarWorkbenchEntry() {
    const candidates = document.querySelectorAll(
      '[data-testid="plugin-sidebar-mcp-app-item"], .bg-sidebar a, .bg-sidebar button, .bg-sidebar [role="button"], [role="navigation"] a, [role="navigation"] button, aside button, aside a, aside [role="button"], nav button, nav a, [data-testid*="sidebar" i] button, [data-testid*="sidebar" i] a'
    );
    for (const el of candidates) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.left > 360) continue;
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      const href = String(el.getAttribute('href') || '');
      if (
        (txt.length <= 28 && /Prism\s*(?:工作台|文件)/i.test(txt)) ||
        /Prism\s*(?:工作台|文件)/i.test(aria) ||
        /prism-files/i.test(href)
      ) {
        return el;
      }
    }
    return null;
  }

  function findSidePanelToggleButton(toolbar) {
    const scope = toolbar || document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll('button')).filter(
      (b) => b.isConnected && !b.classList.contains('ag-ps-tb-btn') && b.getAttribute('data-testid') !== 'toggle-overview-panel'
    );
    const matched = buttons.find((b) => {
      const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.getAttribute('data-testid') || ''}`;
      return /Side\s*Panel|Auxiliary\s*Pane|侧边面板|辅助看板|右侧边栏|aux[-_]?pane/i.test(lbl);
    });
    if (matched) return matched;
    // If there is a single non-menu native icon button at the right end of pane-titlebar-toolbar, it is Toggle Side Panel
    const nonMenuBtns = buttons.filter((b) => b.getAttribute('aria-haspopup') !== 'menu');
    return nonMenuBtns.length === 1 ? nonMenuBtns[0] : null;
  }

  function safeClickElement(el) {
    if (!el || !el.isConnected) return false;
    try { el.focus({ preventScroll: true }); } catch {}
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  function triggerRadixMenuOpen(el) {
    if (!el || !el.isConnected) return;
    // Never dispatch synthetic pointerdown inside left sidebar (@dnd-kit PointerSensor would start dragging!)
    if (el.closest('aside, nav, .bg-sidebar, [data-testid*="sidebar" i]')) {
      safeClickElement(el);
      return;
    }
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + Math.max(1, r.width) / 2);
    const cy = Math.round(r.top + Math.max(1, r.height) / 2);
    const evInit = { bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy };
    try { el.focus({ preventScroll: true }); } catch {}
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...evInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
      }
      el.dispatchEvent(new MouseEvent('mousedown', { ...evInit, buttons: 1 }));
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerup', { ...evInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
      }
      el.dispatchEvent(new MouseEvent('mouseup', { ...evInit, buttons: 0 }));
    } catch {}
    try { el.click(); } catch {}
  }

  function closeAuxWorkbenchTab(rightTab) {
    if (!rightTab || !rightTab.isConnected) return false;
    const isCloseControl = (b) => {
      if (!b || !b.isConnected) return false;
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.getAttribute('data-testid') || ''}`;
      if (/close|关闭|dismiss/i.test(lbl)) return true;
      const txt = (b.textContent || '').trim();
      if (txt === '×' || txt === '✕') return true;
      return Boolean(b.querySelector('svg[class*="lucide-x" i], svg[data-lucide="x"]'));
    };

    const innerBtns = rightTab.querySelectorAll('button, [role="button"]');
    for (const b of innerBtns) {
      if (b !== rightTab && isCloseControl(b)) {
        safeClickElement(b);
        setTimeout(syncToolbarActiveStates, 80);
        return true;
      }
    }
    const tabRow = rightTab.parentElement;
    if (tabRow) {
      for (const b of tabRow.querySelectorAll('button, [role="button"]')) {
        if (b !== rightTab && isCloseControl(b)) {
          const tr = rightTab.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          if (Math.abs(br.top - tr.top) < 24 && br.left >= tr.left && br.left <= tr.right + 36) {
            safeClickElement(b);
            setTimeout(syncToolbarActiveStates, 80);
            return true;
          }
        }
      }
    }
    let anc = rightTab.parentElement;
    for (let depth = 0; anc && anc !== document.body && depth < 5; depth++, anc = anc.parentElement) {
      const hdrBtns = anc.querySelectorAll('button, [role="button"]');
      for (const b of hdrBtns) {
        if (b !== rightTab && isCloseControl(b)) {
          const tr = rightTab.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          if (Math.abs(br.top - tr.top) < 28 && br.left > tr.left) {
            safeClickElement(b);
            setTimeout(syncToolbarActiveStates, 80);
            return true;
          }
        }
      }
    }
    const toggleSideBtn = findSidePanelToggleButton();
    if (toggleSideBtn) {
      safeClickElement(toggleSideBtn);
      setTimeout(syncToolbarActiveStates, 90);
      return true;
    }
    return false;
  }

  function returnFromFullPageWorkbench() {
    // Ensure any stale @dnd-kit PointerSensor in the host is cleanly cancelled first
    try {
      if (typeof PointerEvent === 'function') {
        window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: false }));
      }
    } catch {}
    let savedConvPath = lastChatConvPath;
    if (!savedConvPath) {
      try {
        const raw = sessionStorage.getItem('ag_prism_last_conv_v1') || localStorage.getItem('ag_prism_last_conv_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.path === 'string' && /^\/c\/[A-Za-z0-9_-]{6,}/.test(parsed.path)) {
            savedConvPath = parsed.path;
          }
        }
      } catch {}
    }
    const wantedCid = savedConvPath.startsWith('/c/') ? savedConvPath.slice(3).split('/')[0] : '';
    const rows = Array.from(
      document.querySelectorAll(
        '[data-testid="conversation-row-sidebar"], .ag-recent-row, .bg-sidebar a[href^="/c/"], [role="navigation"] a[href^="/c/"], aside a[href^="/c/"], nav a[href^="/c/"]'
      )
    );
    let targetRow = null;
    if (wantedCid) {
      targetRow = rows.find((el) => {
        if (!isElementRendered(el)) return false;
        const href = el.getAttribute('href') || el.querySelector?.('a[href]')?.getAttribute('href') || '';
        const cid = el.getAttribute('data-cascade-id') || '';
        return cid === wantedCid || href.includes(wantedCid);
      });
    }
    if (!targetRow) {
      targetRow = rows.find((el) => isElementRendered(el) && (el.getAttribute('data-selected') === 'true' || el.getAttribute('aria-current') === 'page'));
    }
    if (!targetRow) {
      targetRow = rows.find((el) => isElementRendered(el));
    }
    if (targetRow) {
      const clickable = targetRow.matches('a[href^="/c/"], a, button, [role="button"]')
        ? targetRow
        : (targetRow.querySelector('a[href^="/c/"], a, button, [role="button"]') || targetRow);
      safeClickElement(clickable);
      setTimeout(syncToolbarActiveStates, 90);
      return true;
    }
    if (savedConvPath && /^\/c\/[A-Za-z0-9_-]{6,}/.test(savedConvPath)) {
      try {
        window.history.pushState({}, '', savedConvPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
        setTimeout(syncToolbarActiveStates, 90);
        return true;
      } catch {}
    }
    try {
      if (window.history.length > 1) {
        window.history.back();
        setTimeout(syncToolbarActiveStates, 90);
        return true;
      }
    } catch {}
    const newBtn = document.querySelector('[data-testid="new-conversation-button"], .bg-sidebar a[href="/"], [role="navigation"] a[href="/"], aside a[href="/"], nav a[href="/"]');
    if (newBtn && isElementRendered(newBtn)) {
      safeClickElement(newBtn);
      return true;
    }
    return false;
  }

  function toggleOrClosePrismWorkbench() {
    if (isFullPageWorkbenchActive()) {
      return returnFromFullPageWorkbench();
    }
    const rightTab = findWorkbenchEntry(document, { skipSidebar: true });
    if (rightTab && isAuxWorkbenchTabActive(rightTab)) {
      if (closeAuxWorkbenchTab(rightTab)) return true;
    }
    if (isOwnedWorkbenchFrameVisible(0.12)) {
      const toggleSideBtn = findSidePanelToggleButton();
      if (toggleSideBtn) {
        safeClickElement(toggleSideBtn);
        setTimeout(syncToolbarActiveStates, 90);
        return true;
      }
    }
    return false;
  }

  function onSidebarWorkbenchToggleCapture(e) {
    if (disposed || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const sbEntry = findSidebarWorkbenchEntry();
    if (!sbEntry || !sbEntry.contains(t)) return;
    const innerBtn = t.closest('button, [role="button"]');
    if (innerBtn && innerBtn !== sbEntry && sbEntry.contains(innerBtn)) return;
    if (isFullPageWorkbenchActive()) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      returnFromFullPageWorkbench();
    }
  }
  document.addEventListener('click', onSidebarWorkbenchToggleCapture, true);
  onCleanup(() => document.removeEventListener('click', onSidebarWorkbenchToggleCapture, true));

  function findWorkbenchEntry(root = document, { skipSidebar = false } = {}) {
    if (!root || !root.querySelectorAll) return null;
    const candidates = root.querySelectorAll('button, a, [role="tab"], [role="button"], [role="menuitem"], [role="option"]');
    for (const el of candidates) {
      if (!el.isConnected || el.closest('#ag-ps-popover, #ag-ps-outline, [data-testid="autoscroll-viewport"]')) continue;
      if (el.id === 'ag-ps-btn-workbench' || el.id === 'ag-ps-btn-suite' || el.id === 'ag-ps-btn-outline') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (skipSidebar && !el.closest('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]') && (el.closest('aside, nav, .bg-sidebar, [data-testid*="sidebar" i]') || r.left < 280)) {
        continue;
      }
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      if ((txt.length <= 28 && /Prism\s*(?:工作台|文件)/i.test(txt)) || /Prism\s*(?:工作台|文件)/i.test(aria)) {
        return el;
      }
    }
    return null;
  }

  function hoverAndClickMenuItem(el) {
    if (!el) return;
    for (const type of ['pointerenter', 'pointermove', 'mouseover', 'mouseenter']) {
      try {
        const Evt = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new Evt(type, { bubbles: true, cancelable: true }));
      } catch {}
    }
    safeClickElement(el);
  }

  function findMoreToolbarButton(toolbar) {
    if (!toolbar) return null;
    const menuBtn = toolbar.querySelector('button[aria-haspopup="menu"]:not(.ag-ps-tb-btn)');
    if (menuBtn) return menuBtn;
    const buttons = Array.from(toolbar.querySelectorAll('button')).filter(
      (b) => b.isConnected && !b.classList.contains('ag-ps-tb-btn') && b.getAttribute('data-testid') !== 'toggle-overview-panel'
    );
    return buttons.find((b) => {
      const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
      return /more|更多|menu|菜单|action|选项/i.test(lbl);
    }) || null;
  }

  function findRightPaneExtensionPickerButton() {
    const minLeft = Math.max(290, (window.innerWidth || 1000) * 0.42);
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const b of candidates) {
      if (!b.isConnected || b.classList.contains('ag-ps-tb-btn')) continue;
      if (b.closest('#ag-ps-popover, #ag-ps-outline, aside, nav, .bg-sidebar, [data-testid="autoscroll-viewport"]')) continue;
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.left < minLeft || r.top > 110) continue;
      const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''} ${b.textContent || ''}`.replace(/\s+/g, ' ').trim();
      if (/UI\s*Extensions|Show\s*or\s*Hide\s*Extensions|界面扩展|显示或隐藏扩展|扩展插件|Plugins|Add\s*Tab|New\s*Tab|添加|更多|\+/i.test(lbl) || b.getAttribute('aria-haspopup') === 'menu') {
        if (!b.closest('[data-testid="pane-titlebar-toolbar"]')) {
          return b;
        }
      }
    }
    return null;
  }

  function trySidebarFallback() {
    const fallback = findSidebarWorkbenchEntry();
    if (!fallback) return false;
    if (isFullPageWorkbenchActive()) {
      return returnFromFullPageWorkbench();
    }
    // Check if row exposes an inline "Open in Side Panel" button first
    const row = fallback.closest('.agy-sidebar-row, li, div') || fallback.parentElement;
    if (row) {
      for (const b of row.querySelectorAll('button, [role="button"]')) {
        const lbl = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
        if (/Side\s*Panel|side\s*pane|侧边面板|侧边栏中打开|分屏/i.test(lbl)) {
          safeClickElement(b);
          return true;
        }
      }
    }
    // Strictly use safeClickElement (el.click() only, NEVER pointerdown!) so @dnd-kit never drags the sidebar item!
    safeClickElement(fallback);
    return true;
  }

  function openPrismWorkbenchQuick(targetTab = '') {
    const wantTab = targetTab && ALLOWED_BRIDGE_TABS.has(targetTab) ? targetTab : '';
    if (!wantTab) {
      if (toggleOrClosePrismWorkbench()) {
        clearPendingWorkbenchNav();
        return true;
      }
      clearPendingWorkbenchNav();
    } else {
      dispatchSwitchTabWithRetry(wantTab);
    }

    // 1. Prioritize already-open right-side aux pane tab (strictly skipping left global sidebar)
    const rightTab = findWorkbenchEntry(document, { skipSidebar: true });
    if (rightTab) {
      safeClickElement(rightTab);
      if (wantTab) {
        bridgeRetryTimers.push(setTimeout(() => {
          if (!disposed && pendingIntentId) broadcastBridgePing();
        }, 160));
      }
      setTimeout(syncToolbarActiveStates, 80);
      return true;
    }

    if (workbenchOpening) return false;
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    const sideToggleBtn = findSidePanelToggleButton(toolbar);
    const moreBtn = findMoreToolbarButton(toolbar);

    workbenchOpening = true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        const searchOpenMenusAndClick = async (loops = 6) => {
          let subTrigger = null;
          for (let i = 0; i < loops; i++) {
            await sleep(55);
            if (disposed) return true;
            const poppers = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
            for (const m of poppers) {
              const directItem = findWorkbenchEntry(m, { skipSidebar: false });
              if (directItem) {
                safeClickElement(directItem);
                setTimeout(syncToolbarActiveStates, 90);
                return true;
              }
              const items = m.querySelectorAll('[role="menuitem"], [role="option"], button');
              for (const it of items) {
                const t = String(it.textContent || '').replace(/\s+/g, ' ').trim();
                if (/扩展插件|界面扩展|UI\s*Extensions|Show\s*or\s*Hide\s*Extensions|Plugins|Extensions/i.test(t)) {
                  subTrigger = it;
                  break;
                }
              }
              if (subTrigger) break;
            }
            if (subTrigger) break;
          }
          if (subTrigger) {
            hoverAndClickMenuItem(subTrigger);
            for (let j = 0; j < 6; j++) {
              await sleep(60);
              if (disposed) return true;
              const poppers = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
              for (const m of poppers) {
                const target = findWorkbenchEntry(m, { skipSidebar: false });
                if (target) {
                  safeClickElement(target);
                  setTimeout(syncToolbarActiveStates, 90);
                  return true;
                }
              }
            }
          }
          return false;
        };

        // 2a. Expand right Side Panel first if collapsed, then check its tab strip & extension picker
        let sidePanelOpenedByUs = false;
        if (sideToggleBtn && !isFullPageWorkbenchActive() && !findRightPaneExtensionPickerButton()) {
          safeClickElement(sideToggleBtn);
          sidePanelOpenedByUs = true;
          for (let k = 0; k < 5; k++) {
            await sleep(55);
            if (disposed) return;
            if (isOwnedWorkbenchFrameVisible(0.12)) {
              setTimeout(syncToolbarActiveStates, 60);
              return;
            }
            const newlyMountedRightTab = findWorkbenchEntry(document, { skipSidebar: true });
            if (newlyMountedRightTab) {
              safeClickElement(newlyMountedRightTab);
              setTimeout(syncToolbarActiveStates, 80);
              return;
            }
          }
        }

        const rightPickerBtn = findRightPaneExtensionPickerButton();
        if (rightPickerBtn) {
          triggerRadixMenuOpen(rightPickerBtn);
          if (await searchOpenMenusAndClick(6)) return;
          try {
            (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          } catch {}
        }

        // 2b. Try toolbar ⋮ overflow menu if present
        if (moreBtn) {
          triggerRadixMenuOpen(moreBtn);
          if (await searchOpenMenusAndClick(6)) return;
          try {
            (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          } catch {}
        }

        // Re-collapse empty Side Panel if we opened it and Prism wasn't inside it
        if (sidePanelOpenedByUs && sideToggleBtn && !isOwnedWorkbenchFrameVisible(0.12)) {
          safeClickElement(sideToggleBtn);
          await sleep(40);
        }

        if (!disposed) {
          // 3. Clean fallback to global Workbench entry (using safeClickElement -> zero drag sensor activation!)
          if (!trySidebarFallback()) {
            showJumpToast('未检测到已启用的 Prism 工作台插件，请先在插件管理中启用 prism-files');
          }
        }
      } finally {
        workbenchOpening = false;
      }
    })();
    return true;
  }

  function syncToolbarButtons() {
    const toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
    if (!toolbar) return;

    let wbBtn = document.getElementById('ag-ps-btn-workbench');
    if (prefs.showWorkbenchBtn !== false) {
      if (!wbBtn || wbBtn.parentElement !== toolbar) {
        if (wbBtn) wbBtn.remove();
        wbBtn = document.createElement('button');
        wbBtn.id = 'ag-ps-btn-workbench';
        wbBtn.type = 'button';
        wbBtn.className = 'ag-ps-tb-btn';
        wbBtn.setAttribute('data-ag-i18n-ignore', '1');
        wbBtn.setAttribute('data-ag-ps-tip', '打开 / 收起 Prism 工作台（文件 / 历史检索 / 账号接力 / 电脑操控）');
        wbBtn.textContent = '工作台';
        wbBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openPrismWorkbenchQuick();
        });
        toolbar.insertBefore(wbBtn, toolbar.firstChild);
      }
    } else if (wbBtn) {
      wbBtn.remove();
    }

    let outBtn = document.getElementById('ag-ps-btn-outline');
    if (prefs.outline) {
      if (!outBtn || outBtn.parentElement !== toolbar) {
        if (outBtn) outBtn.remove();
        outBtn = document.createElement('button');
        outBtn.id = 'ag-ps-btn-outline';
        outBtn.type = 'button';
        outBtn.className = 'ag-ps-tb-btn';
        outBtn.setAttribute('data-ag-i18n-ignore', '1');
        outBtn.title = '会话大纲 (Alt+O) · 上下跳轮 (Alt+↑/↓)';
        outBtn.textContent = '大纲';
        outBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleOutlineDrawer();
        });
        toolbar.insertBefore(outBtn, toolbar.firstChild);
      }
    } else if (outBtn) {
      outBtn.remove();
    }

    let suiteBtn = document.getElementById('ag-ps-btn-suite');
    if (!suiteBtn || suiteBtn.parentElement !== toolbar) {
      if (suiteBtn) suiteBtn.remove();
      suiteBtn = document.createElement('button');
      suiteBtn.id = 'ag-ps-btn-suite';
      suiteBtn.type = 'button';
      suiteBtn.className = 'ag-ps-tb-btn';
      suiteBtn.setAttribute('data-ag-i18n-ignore', '1');
      suiteBtn.title = '棱镜扩展套件（主题 / 像素伙伴 / 思考翻译 / 热力图）';
      suiteBtn.textContent = '✦ 棱镜';
      suiteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover();
      });
      toolbar.insertBefore(suiteBtn, toolbar.firstChild);
    }
    syncToolbarActiveStates();
  }
  onCleanup(() => {
    document.getElementById('ag-ps-btn-suite')?.remove();
    document.getElementById('ag-ps-btn-outline')?.remove();
    document.getElementById('ag-ps-btn-workbench')?.remove();
    document.getElementById('ag-ps-jump-toast')?.remove();
  });

  function onDocClickOutside(e) {
    if (disposed) return;
    const pop = document.getElementById('ag-ps-popover');
    if (pop && pop.getAttribute('data-open') === '1' && !pop.contains(e.target) && !e.target.closest('#ag-ps-btn-suite')) {
      closePopoverAnimated(true);
      syncToolbarActiveStates();
    }
    const drawer = document.getElementById('ag-ps-outline');
    if (drawer && drawer.getAttribute('data-open') === '1' && !drawer.contains(e.target) && !e.target.closest('#ag-ps-btn-outline')) {
      closeOutlineAnimated(true);
      syncToolbarActiveStates();
    }
  }
  document.addEventListener('click', onDocClickOutside);
  onCleanup(() => document.removeEventListener('click', onDocClickOutside));

  /* ==========================================================================
   * 8. Lightweight Periodic Sync, Visibility Pause & Shallow Overview Observer
   * ========================================================================== */
  let ovMountObserver = null;
  let observedOvEl = null;

  function ensureOverviewObserver() {
    const sec = document.getElementById('ag-claude-ov-sections');
    if (!sec) return;
    if (observedOvEl === sec && ovMountObserver) return;
    if (ovMountObserver) ovMountObserver.disconnect();
    observedOvEl = sec;
    // Shallow childList observation only (no subtree overhead)
    ovMountObserver = new MutationObserver(() => {
      if (disposed || !prefs.usageExtra) return;
      const body = sec.querySelector('[data-ov-card="usage"] .ag-ov-card-body');
      if (body && !body.querySelector('.ag-ps-usage-extra')) {
        syncUsageExtraMount();
      }
    });
    ovMountObserver.observe(sec, { childList: true });
  }
  onCleanup(() => {
    if (ovMountObserver) ovMountObserver.disconnect();
    ovMountObserver = null;
    observedOvEl = null;
  });

  let lastPath = window.location.pathname;
  let lastSearch = window.location.search || '';
  let lastActiveBox = null;
  let lastDarkState = isCurrentlyDark();
  let navSwitchTimer = 0;
  let isImeComposing = false;

  const onImeStart = () => { isImeComposing = true; };
  const onImeEnd = () => { isImeComposing = false; };
  document.addEventListener('compositionstart', onImeStart, { capture: true, passive: true });
  document.addEventListener('compositionend', onImeEnd, { capture: true, passive: true });
  onCleanup(() => {
    document.removeEventListener('compositionstart', onImeStart, true);
    document.removeEventListener('compositionend', onImeEnd, true);
  });

  function onNavClickHint(e) {
    if (disposed) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-testid="conversation-row-sidebar"], .ag-recent-row, .bg-sidebar, [role="navigation"], aside, nav, [role="tab"], .agy-aux-tab')) {
      if (navSwitchTimer) clearTimeout(navSwitchTimer);
      navSwitchTimer = setTimeout(() => {
        navSwitchTimer = 0;
        if (!disposed) tickAll();
      }, 65);
    }
  }
  document.addEventListener('click', onNavClickHint, { capture: true, passive: true });
  onCleanup(() => {
    if (navSwitchTimer) clearTimeout(navSwitchTimer);
    document.removeEventListener('click', onNavClickHint, true);
  });

  function tickAll() {
    if (disposed || document.hidden) return;
    const curBox = getActiveInputBox();
    // Detect SPA conversation switch (URL pathname/search change OR cached multi-view inputBox switch)
    if (/^\/c\/[A-Za-z0-9_-]{6,}/.test(window.location.pathname || '')) {
      lastChatConvPath = window.location.pathname;
    }
    const curSearch = window.location.search || '';
    if (window.location.pathname !== lastPath || curSearch !== lastSearch || (curBox && curBox !== lastActiveBox)) {
      lastPath = window.location.pathname;
      lastSearch = curSearch;
      lastActiveBox = curBox;
      cachedComposerEl = null;
      const drawer = document.getElementById('ag-ps-outline');
      if (drawer && drawer.getAttribute('data-open') === '1') {
        renderOutlineList('');
      }
      emitBus('route');
    }
    const darkNow = isCurrentlyDark();
    if (darkNow !== lastDarkState) {
      lastDarkState = darkNow;
      emitBus('theme');
    }
    const busy = isAgentGenerating();
    syncStreamObserver(busy);
    // Defer non-urgent DOM scans while user is actively typing or using Windows/CJK IME composition
    if (isImeComposing || (isUserActivelyTyping() && !busy)) return;
    syncToolbarButtons();
    syncWorkbenchTooltip();
    syncMascotDock(busy);
    ensureOverviewObserver();
    syncUsageExtraMount();
    syncThoughtBlocks(busy);
    pushLiveQuotaToBridge(false);
    emitBus('tick');
  }

  let restoreWakeRaf1 = 0;
  let restoreWakeRaf2 = 0;
  let restoreWakeTimer = 0;

  function cancelPendingRestoreWake() {
    if (restoreWakeRaf1) {
      cancelAnimationFrame(restoreWakeRaf1);
      restoreWakeRaf1 = 0;
    }
    if (restoreWakeRaf2) {
      cancelAnimationFrame(restoreWakeRaf2);
      restoreWakeRaf2 = 0;
    }
    if (restoreWakeTimer) {
      clearTimeout(restoreWakeTimer);
      restoreWakeTimer = 0;
    }
  }

  function notifyHostVisibility(state) {
    try {
      if (typeof window.__agSyncHostVisibility === 'function') {
        window.__agSyncHostVisibility(state);
      }
    } catch {}
  }

  function onVisibilityChange() {
    if (disposed) return;
    cancelPendingRestoreWake();
    if (document.hidden) {
      document.documentElement.setAttribute('data-ag-prism-hidden', '1');
      notifyHostVisibility('hidden');
      detachStreamObserver();
      clearInkHighlights();
      stopMascotRoaming(false);
      emitBus('visibility');
    } else {
      notifyHostVisibility('visible');
      // Yield two animation frames + 140ms so Chromium presents Frame 1 after unminimize with 0ms main-thread block
      restoreWakeRaf1 = requestAnimationFrame(() => {
        restoreWakeRaf1 = 0;
        restoreWakeRaf2 = requestAnimationFrame(() => {
          restoreWakeRaf2 = 0;
          restoreWakeTimer = window.setTimeout(() => {
            restoreWakeTimer = 0;
            if (disposed || document.hidden) return;
            document.documentElement.removeAttribute('data-ag-prism-hidden');
            emitBus('visibility');
            tickAll();
          }, 140);
        });
      });
    }
  }
  if (document.hidden) {
    document.documentElement.setAttribute('data-ag-prism-hidden', '1');
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  onCleanup(() => {
    cancelPendingRestoreWake();
    document.documentElement.removeAttribute('data-ag-prism-hidden');
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  /* ---- Publish Versioned Event Bus (window.__agPrismBus v4) ---- */
  const prismBus = {
    version: 4,
    suiteVersion: SUITE_VERSION,
    getPrefs: () => Object.assign({}, prefs),
    registerDefaults(defaultsObj) {
      if (!defaultsObj || typeof defaultsObj !== 'object' || Array.isArray(defaultsObj)) return;
      let changed = false;
      for (const [k, rawDefault] of Object.entries(defaultsObj)) {
        const validDefault = normalizePrefValue(k, rawDefault);
        if (validDefault === undefined) continue;
        registeredDefaults[k] = validDefault;
        if (!hasOwn(prefs, k) || normalizePrefValue(k, prefs[k]) === undefined) {
          prefs[k] = validDefault;
          changed = true;
        }
      }
      if (changed) emitBus('prefs');
    },
    hydrateDiskPrefs(rawDiskPrefs) {
      const cand = sanitizePrefsCandidate(rawDiskPrefs);
      if (!cand) return false;
      const curTs = Number(prefs._ts) || 0;
      if (!(cand.ts > curTs || (curTs === 0 && !loadedFromStorage))) return false;
      replacePrefsInPlace(cand);
      persistPrefsMirrors(prefs);
      applyPalettes();
      applyMascotSizeVars(document.getElementById('ag-ps-mascot-dock'), true);
      const busy = isAgentGenerating();
      syncStreamObserver(busy);
      syncToolbarButtons();
      syncMascotDock(busy);
      syncUsageExtraMount();
      syncThoughtBlocks(busy);
      emitBus('theme');
      emitBus('prefs');
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
      return true;
    },
    setPref,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      busSubscribers.add(fn);
      return () => busSubscribers.delete(fn);
    },
    registerPanelSection(spec) {
      if (!spec || !spec.id) return;
      const idx = registeredPanelSections.findIndex((s) => s.id === spec.id);
      if (idx >= 0) registeredPanelSections[idx] = spec;
      else registeredPanelSections.push(spec);
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    },
    unregisterPanelSection(id) {
      if (!id) return;
      const idx = registeredPanelSections.findIndex((s) => s.id === id);
      if (idx >= 0) {
        registeredPanelSections.splice(idx, 1);
        const pop = document.getElementById('ag-ps-popover');
        if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
      }
    },
    registerOutlineAction(spec) {
      if (!spec || !spec.id) return;
      const idx = registeredOutlineActions.findIndex((a) => a.id === spec.id);
      if (idx >= 0) registeredOutlineActions[idx] = spec;
      else registeredOutlineActions.push(spec);
    },
    unregisterOutlineAction(id) {
      if (!id) return;
      const idx = registeredOutlineActions.findIndex((a) => a.id === id);
      if (idx >= 0) registeredOutlineActions.splice(idx, 1);
    },
    isBusy: isAgentGenerating,
    isDark: isCurrentlyDark,
    isTyping: isUserActivelyTyping,
    getInputBoxEl: getActiveInputBox,
    getComposerEl,
    getViewportEl: getActiveViewportEl,
    getThemeAccent,
    getQuotaState,
    getConversationNav: getConversationNavSnapshot,
    openWorkbench: openPrismWorkbenchQuick,
    showToast: showJumpToast,
    refreshPopover: () => {
      const pop = document.getElementById('ag-ps-popover');
      if (pop && pop.getAttribute('data-open') === '1') renderPopoverContent(pop);
    },
    emit(type) {
      if (disposed || !type) return;
      if (type === 'orb-stage') {
        nudgeMascotObstacleSync();
      }
      emitBus(String(type));
    },
    syncMascotObstacles: nudgeMascotObstacleSync,
    setAttrIfChanged,
    setStyleVarIfChanged,
    onCleanup
  };
  window.__agPrismBus = prismBus;
  const attachedInitFns = new Set();
  if (window.__agPrismModules && typeof window.__agPrismModules === 'object') {
    for (const [modId, initFn] of Object.entries(window.__agPrismModules)) {
      if (typeof initFn === 'function' && !attachedInitFns.has(initFn)) {
        attachedInitFns.add(initFn);
        try {
          initFn(prismBus);
        } catch (err) {
          console.error(`[PrismSuite:${modId}] attach failed:`, err);
        }
      }
    }
  }
  if (Array.isArray(window.__agPrismBusQueue)) {
    const queued = window.__agPrismBusQueue.splice(0, window.__agPrismBusQueue.length);
    for (const initFn of queued) {
      if (typeof initFn === 'function' && !attachedInitFns.has(initFn)) {
        attachedInitFns.add(initFn);
        try { initFn(prismBus); } catch {}
      }
    }
  }
  onCleanup(() => {
    busSubscribers.clear();
    if (window.__agPrismBus === prismBus) {
      try { delete window.__agPrismBus; } catch { window.__agPrismBus = null; }
    }
  });

  syncToolbarButtons();
  tickAll();
  const intervalId = setInterval(tickAll, 2400);
  onCleanup(() => clearInterval(intervalId));

  window.__agPrismSuiteDispose = function () {
    if (disposed) return;
    disposed = true;
    const fns = Array.from(cleanups).reverse();
    cleanups.clear();
    for (let i = 0; i < fns.length; i++) {
      try { fns[i](); } catch {}
    }
  };
  if (typeof window.ctx?.onCleanup === 'function') {
    window.ctx.onCleanup(window.__agPrismSuiteDispose);
  }
})();
