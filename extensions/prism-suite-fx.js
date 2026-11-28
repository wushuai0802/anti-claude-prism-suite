/* ============================================================================
 * Anti-Claude Prism Suite v0.9.6 — Visual FX & Layout Polish (Clean-Room, MIT)
 * Architecture:
 *   - Joins window.__agPrismBus (Frozen v4) safely regardless of script order
 *   - Single shared requestAnimationFrame scheduler (true 0fps idle/hidden/reduced)
 *   - Zero permanent document.body MutationObserver
 *   - Zero per-frame layout reads (throttled ResizeObserver geometry cache)
 *   - Zero per-frame particle allocations (pre-allocated 128-particle Fibonacci sphere)
 *   - Full AbortController + bus.onCleanup disposal (zero leaks on hot-reload)
 * ============================================================================ */
(() => {
  'use strict';

  const INSTANCE_TOKEN = Symbol('agPrismFx');
  if (typeof window.__agPrismFxDispose === 'function') {
    try { window.__agPrismFxDispose(); } catch {}
  }
  window.__agPrismFxToken = INSTANCE_TOKEN;

  function registerPrismModule(id, initFn) {
    const reg = (window.__agPrismModules = window.__agPrismModules || Object.create(null));
    reg[id] = initFn;
    if (window.__agPrismBus && window.__agPrismBus.version >= 4) {
      try {
        initFn(window.__agPrismBus);
      } catch (err) {
        console.error(`[PrismSuite:${id}] init failed:`, err);
      }
    }
  }

  const FX_DEFAULTS = {
    performanceMode: 'balanced',  // 'power-save' | 'balanced' | 'vivid'
    ignoreReducedMotion: false,
    chatFontFamily: '',
    codeFontFamily: '',
    opticalFacets: true,
    semanticAfterglow: true,
    compactQuotaPill: true,
    composerBorderFx: 'smart',    // 'off' | 'smart' | 'beam' | 'static'
    outlineRailMode: 'smart',     // 'smart' | 'right' | 'off'
    outlinePreviewStyle: 'detailed', // 'detailed' | 'compact'
    tokenUnit: 'wan',             // 'wan' | 'kmb'
    composerIntentSuggest: false, // Tab-to-insert next prompt ghost
    borderBeam: false,
    borderBeamMode: 'always',     // 'always' | 'busy'
    borderBeamPalette: 'theme',   // 'theme' | 'gemini' | 'aurora' | 'prism' | 'neon' | 'quota'
    quotaRing: false,
    quotaRingPeriod: 'auto',      // 'auto' | 'weekly' | '5h'
    thinkingOrb: false,
    thinkingOrbMode: 'both',      // 'both' | 'replace'
    bubbleTint: false,
    bubbleTintPreset: 'accent',   // 'accent' | 'sky' | 'emerald' | 'amber' | 'violet'
    bubbleTintStrength: 22,       // 10..100 integer %
    compactLayout: false,
    unreadBadge: true,
    sidebarSessions: 'default',   // 'default' | '10' | 'all'
    keepOverviewOpen: true,
    alwaysOutlineRail: true,
    switchReturnHelper: true,
    switchAutoReturn: false,
    autoDismissOnboarding: false,
    quotaHandoffAlert: true
  };

  function resolveComposerBorderFx(prefs) {
    const raw = prefs && prefs.composerBorderFx;
    if (raw === 'off' || raw === 'beam' || raw === 'static') return raw;
    if (prefs && prefs.borderBeam === true && (prefs.borderBeamMode || 'always') === 'always') {
      return 'beam';
    }
    if (prefs && prefs.semanticAfterglow === false && !prefs.borderBeam && !prefs.quotaRing) {
      return 'off';
    }
    return 'smart';
  }

  function resolveOutlineRailMode(prefs) {
    if (prefs && prefs.alwaysOutlineRail === false && prefs.outlineRailMode !== 'right') {
      return 'off';
    }
    const raw = prefs && prefs.outlineRailMode;
    if (raw === 'right' || raw === 'off') return raw;
    return 'smart';
  }

  function resolveOutlinePreviewStyle(prefs) {
    return prefs && prefs.outlinePreviewStyle === 'compact' ? 'compact' : 'detailed';
  }

  const CHAT_FONT_PRESETS = [
    { label: '默认', value: '' },
    { label: '霞鹜文楷', value: '"LXGW WenKai", "霞鹜文楷"' },
    { label: '现代黑体', value: '"Inter", "HarmonyOS Sans SC", "Microsoft YaHei UI"' },
    { label: '屏显雅宋', value: '"Source Han Serif SC", "Songti SC", serif' }
  ];

  const CODE_FONT_PRESETS = [
    { label: '默认', value: '' },
    { label: 'JetBrains', value: '"JetBrains Mono"' },
    { label: 'Cascadia', value: '"Cascadia Code"' },
    { label: 'Maple', value: '"Maple Mono NF", "Maple Mono"' }
  ];

  function sanitizeFontFamilyPref(v) {
    if (typeof v !== 'string') return undefined;
    const s = v.replace(/[\r\n\0]+/g, ' ').trim();
    if (s.length > 160) return undefined;
    if (/[\x00-\x1f\x7f;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@import/i.test(s)) return undefined;
    if ((s.match(/"/g) || []).length % 2 !== 0 || (s.match(/'/g) || []).length % 2 !== 0) return undefined;
    return s;
  }

  const BEAM_PALETTE_LABELS = [
    { id: 'theme', label: '主题', dot: 'var(--primary, #2F75C3)' },
    { id: 'gemini', label: 'Gemini', dot: 'linear-gradient(135deg,#4285F4,#C084FC)' },
    { id: 'aurora', label: '极光', dot: 'linear-gradient(135deg,#10B981,#3B82F6)' },
    { id: 'prism', label: '棱镜', dot: 'linear-gradient(135deg,#F43F5E,#F59E0B,#3B82F6)' },
    { id: 'neon', label: '霓虹', dot: 'linear-gradient(135deg,#22D3EE,#E879F9)' },
    { id: 'quota', label: '额度', dot: 'linear-gradient(135deg,#10B981,#F59E0B,#EF4444)' }
  ];

  const BUBBLE_PRESETS = [
    { id: 'accent', label: '主题色', light: null, dark: null, swatch: 'var(--primary, #2F75C3)' },
    { id: 'sky', label: '天蓝', light: '#0284C7', dark: '#38BDF8', swatch: '#0EA5E9' },
    { id: 'emerald', label: '翡翠', light: '#059669', dark: '#10B981', swatch: '#10B981' },
    { id: 'amber', label: '琥珀', light: '#D97706', dark: '#F59E0B', swatch: '#F59E0B' },
    { id: 'violet', label: '紫罗兰', light: '#7C3AED', dark: '#8B5CF6', swatch: '#8B5CF6' }
  ];

  const ORB_STAGE_LABELS = {
    idle: '待命',
    thinking: '深度思考中',
    tools: '工具执行中',
    streaming: '实时输出中',
    done: '已完成'
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampInt(val, min, max, fallback) {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function parseCssColorToRgb(colorStr) {
    const s = String(colorStr || '').trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16)
      ];
    }
    const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i);
    if (rgb) {
      return [
        Math.max(0, Math.min(255, Math.round(Number(rgb[1]) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(rgb[2]) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(rgb[3]) || 0)))
      ];
    }
    return [47, 117, 195];
  }

  function relativeLuminance(rgb) {
    const ch = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
  }

  function lerpRgb(stops, t, out) {
    const n = stops.length;
    if (n === 1) {
      out[0] = stops[0][0];
      out[1] = stops[0][1];
      out[2] = stops[0][2];
      return;
    }
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const scaled = clamped * (n - 1);
    const idx = Math.min(n - 2, Math.floor(scaled));
    const frac = scaled - idx;
    const a = stops[idx];
    const b = stops[idx + 1];
    out[0] = (a[0] + (b[0] - a[0]) * frac) | 0;
    out[1] = (a[1] + (b[1] - a[1]) * frac) | 0;
    out[2] = (a[2] + (b[2] - a[2]) * frac) | 0;
  }

  function shiftRgb(rgb, delta) {
    return [
      Math.max(0, Math.min(255, rgb[0] + delta)),
      Math.max(0, Math.min(255, rgb[1] + delta)),
      Math.max(0, Math.min(255, rgb[2] + delta))
    ];
  }

  function initFxModule(bus) {
    if (window.__agPrismFxToken !== INSTANCE_TOKEN) return;
    if (typeof window.__agPrismFxDispose === 'function') {
      try { window.__agPrismFxDispose(); } catch {}
    }

    let disposed = false;
    const ac = new AbortController();
    const { signal } = ac;
    const fxCleanups = [];
    function onCleanup(fn) {
      if (typeof fn === 'function') fxCleanups.push(fn);
    }

    bus.registerDefaults(FX_DEFAULTS);

    function getPrefs() {
      const p = (bus.getPrefs && bus.getPrefs()) || {};
      return Object.assign({}, FX_DEFAULTS, p);
    }

    function setAttr(el, attr, val) {
      if (!el) return;
      if (val == null || val === '') {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
      } else if (typeof bus.setAttrIfChanged === 'function') {
        bus.setAttrIfChanged(el, attr, String(val));
      } else if (el.getAttribute(attr) !== String(val)) {
        el.setAttribute(attr, String(val));
      }
    }

    function setStyleVar(el, prop, val) {
      if (!el || !el.style) return;
      if (val == null || val === '') {
        if (el.style.getPropertyValue(prop)) el.style.removeProperty(prop);
      } else if (typeof bus.setStyleVarIfChanged === 'function') {
        bus.setStyleVarIfChanged(el, prop, String(val));
      } else if (el.style.getPropertyValue(prop) !== String(val)) {
        el.style.setProperty(prop, String(val));
      }
    }

    function safeIsBusy() {
      try { return Boolean(bus.isBusy && bus.isBusy()); } catch { return false; }
    }

    function safeIsDark() {
      try { return Boolean(bus.isDark && bus.isDark()); } catch { return false; }
    }

    function safeIsTyping() {
      try { return Boolean(bus.isTyping && bus.isTyping()); } catch { return false; }
    }

    function safeGetComposerEl() {
      try {
        const fromBus = (bus.getInputBoxEl && bus.getInputBoxEl()) || (bus.getComposerEl && bus.getComposerEl());
        if (fromBus && fromBus.isConnected && fromBus.getBoundingClientRect().width > 0) return fromBus;
      } catch {}
      try {
        const byId = document.getElementById('antigravity.agentSidePanelInputBox');
        if (byId && byId.isConnected && byId.getBoundingClientRect().width > 0) return byId;
      } catch {}
      const boxes = Array.from(document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]'));
      const vis = boxes.filter((b) => b.isConnected && b.getBoundingClientRect().width > 0);
      return vis[vis.length - 1] || null;
    }

    function safeGetViewportEl() {
      try {
        const el = bus.getViewportEl && bus.getViewportEl();
        if (el && el.isConnected && el.getBoundingClientRect().width > 0) return el;
      } catch {}
      const vps = Array.from(document.querySelectorAll('[data-testid="autoscroll-viewport"]'));
      const vis = vps.filter((v) => v.isConnected && v.getBoundingClientRect().width > 0);
      return vis[vis.length - 1] || null;
    }

    function safeGetThemeAccent() {
      try {
        const c = bus.getThemeAccent && bus.getThemeAccent();
        if (c && typeof c === 'string' && c.trim()) return c.trim();
      } catch {}
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        if (v) return v;
      } catch {}
      return '#2F75C3';
    }

    function safeGetQuotaState() {
      try {
        const q = bus.getQuotaState && bus.getQuotaState();
        if (q && typeof q === 'object') return q;
      } catch {}
      return { pct5h: null, pct7d: null, minPct: null };
    }

    function safeToast(msg) {
      try { if (typeof bus.showToast === 'function') bus.showToast(msg); } catch {}
    }

    function safeRefreshPopover() {
      try { if (typeof bus.refreshPopover === 'function') bus.refreshPopover(); } catch {}
    }

    /* ---- Reduced Motion & Visibility / Focus State ---- */
    const motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

    function isEffectivelyReducedMotion(prefs = getPrefs()) {
      return (
        (Boolean(motionQuery && motionQuery.matches) && !prefs.ignoreReducedMotion) ||
        prefs.performanceMode === 'power-save'
      );
    }

    if (motionQuery && typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', () => {
        if (disposed) return;
        const p = getPrefs();
        applyPerfAndCustomFonts(p);
        syncBorderBeamDom(Date.now(), p);
        if (isEffectivelyReducedMotion(p)) {
          stopScheduler();
          if (orbCanvas && p.thinkingOrb) renderThinkingOrbFrame(0, performance.now(), true);
        } else {
          ensureScheduler();
        }
      }, { signal });
    }

    /* ========================================================================
     * 1. Shared Composer Geometry Cache (Throttled ResizeObserver, 0 layout/frame)
     * ======================================================================== */
    const MAX_BEAM_CANVAS_PX = 1400;
    const BEAM_INSET = 2; // matches CSS inset: -2px

    let composerHost = null;
    let composerRO = null;
    let resizeThrottleTimer = 0;

    const geo = {
      w: 0,
      h: 0,
      radius: 14,
      cssW: 0,
      cssH: 0,
      dpr: 1,
      pxW: 0,
      pxH: 0,
      pad: 2.25,
      rw: 0,
      rh: 0,
      rad: 12,
      perim: 0,
      segs: new Float64Array(8),
      cum: new Float64Array(9)
    };

    function recomputePerimeterSegments() {
      const pad = geo.pad;
      const rw = Math.max(8, geo.cssW - pad * 2);
      const rh = Math.max(8, geo.cssH - pad * 2);
      const rad = Math.max(2, Math.min(geo.radius + 1.5, rw * 0.5 - 1, rh * 0.5 - 1));
      const straightW = Math.max(0, rw - rad * 2);
      const straightH = Math.max(0, rh - rad * 2);
      const arc = 0.5 * Math.PI * rad;

      geo.rw = rw;
      geo.rh = rh;
      geo.rad = rad;

      const s = geo.segs;
      s[0] = straightW; // top
      s[1] = arc;       // top-right
      s[2] = straightH; // right
      s[3] = arc;       // bottom-right
      s[4] = straightW; // bottom
      s[5] = arc;       // bottom-left
      s[6] = straightH; // left
      s[7] = arc;       // top-left

      let acc = 0;
      geo.cum[0] = 0;
      for (let i = 0; i < 8; i++) {
        acc += s[i];
        geo.cum[i + 1] = acc;
      }
      geo.perim = acc;
    }

    function measureComposerNow() {
      if (disposed || !composerHost || !composerHost.isConnected) return false;
      const rect = composerHost.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w < 40 || h < 24) return false;

      let radius = 14;
      try {
        const cs = getComputedStyle(composerHost);
        const parsed = parseFloat(cs.borderTopLeftRadius);
        if (Number.isFinite(parsed) && parsed > 0) {
          radius = parsed;
        } else if (composerHost.firstElementChild) {
          const innerR = parseFloat(getComputedStyle(composerHost.firstElementChild).borderTopLeftRadius);
          if (Number.isFinite(innerR) && innerR > 0) radius = innerR;
        }
      } catch {}

      const cssW = w + BEAM_INSET * 2;
      const cssH = h + BEAM_INSET * 2;
      const baseDpr = Math.min(2, window.devicePixelRatio || 1);
      const maxDim = Math.max(1, cssW, cssH);
      const dpr = Math.min(baseDpr, MAX_BEAM_CANVAS_PX / maxDim);
      const pxW = Math.max(1, Math.min(MAX_BEAM_CANVAS_PX, Math.round(cssW * dpr)));
      const pxH = Math.max(1, Math.min(MAX_BEAM_CANVAS_PX, Math.round(cssH * dpr)));

      const changed = (
        geo.w !== w ||
        geo.h !== h ||
        Math.abs(geo.radius - radius) > 0.5 ||
        geo.pxW !== pxW ||
        geo.pxH !== pxH
      );

      geo.w = w;
      geo.h = h;
      geo.radius = radius;
      geo.cssW = cssW;
      geo.cssH = cssH;
      geo.dpr = dpr;
      geo.pxW = pxW;
      geo.pxH = pxH;
      recomputePerimeterSegments();

      if (changed) {
        applyBeamRingSize();
        applyQuotaRingGeometry();
        if (quotaNudgeEl) positionQuotaNudge();
      }
      return true;
    }

    function scheduleThrottledMeasure() {
      if (disposed || resizeThrottleTimer) return;
      resizeThrottleTimer = setTimeout(() => {
        resizeThrottleTimer = 0;
        measureComposerNow();
      }, 120);
    }

    function attachComposerHost(el) {
      if (composerHost === el) return;
      detachComposerHost();
      if (!el || !el.isConnected) return;
      composerHost = el;
      setAttr(composerHost, 'data-ag-ps-fx-host', '1');
      if (typeof ResizeObserver === 'function') {
        composerRO = new ResizeObserver(() => scheduleThrottledMeasure());
        composerRO.observe(composerHost);
      }
      measureComposerNow();
    }

    function detachComposerHost() {
      if (resizeThrottleTimer) {
        clearTimeout(resizeThrottleTimer);
        resizeThrottleTimer = 0;
      }
      if (composerRO) {
        try { composerRO.disconnect(); } catch {}
        composerRO = null;
      }
      if (composerHost) {
        try { composerHost.removeAttribute('data-ag-ps-fx-host'); } catch {}
        composerHost = null;
      }
    }

    /* ========================================================================
     * 2. GPU Compositor-Thread Border Beam (.ag-ps-beam-ring > .ag-ps-beam-rotor)
     *    Zero main-thread rAF strokes; locked 120Hz/240Hz even under 135 tok/s load
     * ======================================================================== */
    let beamRingEl = null;
    let beamRotorEl = null;
    let composerPreviewStartAt = 0;
    let composerPreviewUntil = 0;
    const composerPreviewTimers = [];
    let beamPaletteCacheKey = '';
    let beamPaletteStops = [[66, 133, 244], [123, 97, 255], [56, 189, 248]];

    function clearComposerPreviewTimers() {
      while (composerPreviewTimers.length) {
        clearTimeout(composerPreviewTimers.pop());
      }
    }

    function getComposerPreviewStage(nowMs) {
      if (nowMs >= composerPreviewUntil || composerPreviewUntil <= 0) return '';
      const elapsed = Math.max(0, nowMs - composerPreviewStartAt);
      if (elapsed < 1250) return 'beam';
      if (elapsed < 2450) return 'decision';
      return 'done';
    }

    function isBeamPreviewActive(nowMs) {
      return nowMs < composerPreviewUntil;
    }

    function resolveBeamPaletteStops(prefs) {
      const pal = prefs.borderBeamPalette || 'theme';
      let key = pal;
      let accent = '';
      let qTier = '';

      if (pal === 'theme') {
        accent = safeGetThemeAccent();
        key = `theme:${accent}`;
      } else if (pal === 'quota') {
        const pct = selectQuotaPercent(prefs);
        qTier = pct == null ? 'ok' : pct >= 50 ? 'ok' : pct >= 20 ? 'warn' : 'danger';
        key = `quota:${qTier}`;
      }

      if (key === beamPaletteCacheKey) return beamPaletteStops;
      beamPaletteCacheKey = key;

      if (pal === 'gemini') {
        beamPaletteStops = [[66, 133, 244], [139, 92, 246], [56, 189, 248]];
      } else if (pal === 'aurora') {
        beamPaletteStops = [[16, 185, 129], [6, 182, 212], [59, 130, 246]];
      } else if (pal === 'prism') {
        beamPaletteStops = [[244, 63, 94], [245, 158, 11], [59, 130, 246]];
      } else if (pal === 'neon') {
        beamPaletteStops = [[34, 211, 238], [232, 121, 249], [244, 114, 182]];
      } else if (pal === 'quota') {
        if (qTier === 'danger') {
          beamPaletteStops = [[239, 68, 68], [248, 113, 113], [251, 146, 60]];
        } else if (qTier === 'warn') {
          beamPaletteStops = [[245, 158, 11], [251, 191, 36], [249, 115, 22]];
        } else {
          beamPaletteStops = [[16, 185, 129], [52, 211, 153], [6, 182, 212]];
        }
      } else {
        const base = parseCssColorToRgb(accent);
        beamPaletteStops = [
          shiftRgb(base, -24),
          base,
          shiftRgb(base, 52)
        ];
      }
      return beamPaletteStops;
    }

    function applyBeamRingSize() {
      if (!beamRingEl) return;
      const diag = Math.max(880, Math.min(1800, Math.round(Math.hypot(geo.w || 680, geo.h || 120) * 1.48)));
      setStyleVar(beamRingEl, '--ag-ps-beam-diag', `${diag}px`);
    }

    function ensureBeamRingEl() {
      if (!composerHost || !composerHost.isConnected) return null;
      if (beamRingEl && beamRingEl.parentElement === composerHost) return beamRingEl;
      if (beamRingEl) beamRingEl.remove();
      beamRingEl = document.createElement('div');
      beamRingEl.className = 'ag-ps-beam-ring';
      beamRingEl.setAttribute('aria-hidden', 'true');
      beamRingEl.setAttribute('data-ag-i18n-ignore', '1');
      beamRotorEl = document.createElement('div');
      beamRotorEl.className = 'ag-ps-beam-rotor';
      beamRingEl.appendChild(beamRotorEl);
      composerHost.appendChild(beamRingEl);
      applyBeamRingSize();
      return beamRingEl;
    }

    function removeBeamRingEl() {
      if (beamRingEl) {
        beamRingEl.remove();
        beamRingEl = null;
        beamRotorEl = null;
      }
    }

    function isBeamTargetActive(prefs, nowMs) {
      const stage = getComposerPreviewStage(nowMs);
      if (stage === 'beam') return true;
      if (stage) return false;
      const fxMode = resolveComposerBorderFx(prefs);
      if (fxMode === 'beam') return windowFocused;
      if (fxMode === 'smart') return lastBusy;
      return false;
    }

    function syncBorderBeamDom(nowMs, prefs = getPrefs()) {
      const wantActive = !document.hidden && !isEffectivelyReducedMotion(prefs) && isBeamTargetActive(prefs, nowMs);
      if (!wantActive) {
        if (beamRingEl) {
          setAttr(beamRingEl, 'data-running', '');
          setAttr(beamRingEl, 'data-ambient', '');
        }
        return false;
      }
      const host = safeGetComposerEl();
      if (!host) return false;
      attachComposerHost(host);
      const ring = ensureBeamRingEl();
      if (!ring) return false;

      const stops = resolveBeamPaletteStops(prefs);
      const c1 = stops[0] || [47, 117, 195];
      const c2 = stops[1] || c1;
      const c3 = stops[2] || c2;
      setStyleVar(ring, '--ag-ps-beam-c1', `rgb(${c1[0]}, ${c1[1]}, ${c1[2]})`);
      setStyleVar(ring, '--ag-ps-beam-c2', `rgb(${c2[0]}, ${c2[1]}, ${c2[2]})`);
      setStyleVar(ring, '--ag-ps-beam-c3', `rgb(${c3[0]}, ${c3[1]}, ${c3[2]})`);

      const fxMode = resolveComposerBorderFx(prefs);
      const stage = getComposerPreviewStage(nowMs);
      const isAmbient = !lastBusy && stage !== 'beam' && fxMode === 'beam';
      const dur = isAmbient ? '4.4s' : prefs.performanceMode === 'vivid' ? '2.3s' : '2.9s';
      setStyleVar(ring, '--ag-ps-beam-dur', dur);
      setAttr(ring, 'data-ambient', isAmbient ? '1' : '');
      setAttr(ring, 'data-running', '1');
      return true;
    }

    function triggerBeamPreview() {
      clearComposerPreviewTimers();
      const nowMs = Date.now();
      composerPreviewStartAt = nowMs;
      composerPreviewUntil = nowMs + 3650;
      const curPrefs = getPrefs();
      const host = safeGetComposerEl();
      if (host) {
        attachComposerHost(host);
      }
      syncComposerOverlays();
      syncSemanticAfterglow(nowMs);
      syncQuotaRingSuppression(nowMs);

      if (isEffectivelyReducedMotion(curPrefs)) {
        // Jump straight to static semantic afterglow preview when motion is disabled
        composerPreviewStartAt = nowMs - 1300;
        syncComposerOverlays();
        syncSemanticAfterglow(nowMs);
        safeToast('静态余晖预览：琥珀待确认 → 翡翠完成 ✨');
      } else {
        safeToast('正在预览：GPU 生成流光 → 琥珀待确认余晖 → 翡翠完成余晖 ✨');
      }

      for (const stepMs of [1260, 2460, 3680]) {
        const tid = setTimeout(() => {
          const idx = composerPreviewTimers.indexOf(tid);
          if (idx >= 0) composerPreviewTimers.splice(idx, 1);
          if (disposed) return;
          const t = Date.now();
          syncComposerOverlays();
          syncSemanticAfterglow(t);
          syncQuotaRingSuppression(t);
          if (stepMs >= 3600) safeRefreshPopover();
        }, stepMs);
        composerPreviewTimers.push(tid);
      }
      safeRefreshPopover();
    }

    /* ========================================================================
     * 3. Quota Ring (Static 0fps SVG Overlay + Mutual Exclusion with Border Beam)
     * ======================================================================== */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    let qRingWrap = null;
    let qRingSvg = null;
    let qRingTrack = null;
    let qRingArc = null;

    function selectQuotaPercent(prefs) {
      const q = safeGetQuotaState();
      const valid = (v) => {
        const n = Number(v);
        return v != null && v !== '' && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
      };
      const p5 = valid(q.pct5h);
      const p7 = valid(q.pct7d);
      const pMin = valid(q.minPct);

      const period = prefs.quotaRingPeriod || 'auto';
      if (period === '5h') return p5 != null ? p5 : pMin != null ? pMin : p7;
      if (period === 'weekly') return p7 != null ? p7 : pMin != null ? pMin : p5;
      if (pMin != null) return pMin;
      if (p5 != null && p7 != null) return Math.min(p5, p7);
      return p5 != null ? p5 : p7;
    }

    function ensureQuotaRingEl() {
      if (!composerHost || !composerHost.isConnected) return null;
      if (qRingWrap && qRingWrap.parentElement === composerHost) return qRingWrap;
      if (qRingWrap) qRingWrap.remove();

      qRingWrap = document.createElement('div');
      qRingWrap.className = 'ag-ps-quota-ring';
      qRingWrap.setAttribute('aria-hidden', 'true');
      qRingWrap.setAttribute('data-ag-i18n-ignore', '1');

      qRingSvg = document.createElementNS(SVG_NS, 'svg');
      qRingSvg.setAttribute('preserveAspectRatio', 'none');

      qRingTrack = document.createElementNS(SVG_NS, 'rect');
      qRingTrack.setAttribute('class', 'ag-ps-qring-track');
      qRingTrack.setAttribute('pathLength', '100');

      qRingArc = document.createElementNS(SVG_NS, 'rect');
      qRingArc.setAttribute('class', 'ag-ps-qring-arc');
      qRingArc.setAttribute('pathLength', '100');

      qRingSvg.appendChild(qRingTrack);
      qRingSvg.appendChild(qRingArc);
      qRingWrap.appendChild(qRingSvg);
      composerHost.appendChild(qRingWrap);

      applyQuotaRingGeometry();
      return qRingWrap;
    }

    function applyQuotaRingGeometry() {
      if (!qRingSvg || !qRingTrack || !qRingArc || geo.w < 40 || geo.h < 24) return;
      const svgW = geo.w + 3;
      const svgH = geo.h + 3;
      const pad = 1.5;
      const rw = Math.max(4, svgW - pad * 2);
      const rh = Math.max(4, svgH - pad * 2);
      const rx = Math.max(2, Math.min(geo.radius + 1, rw * 0.5, rh * 0.5));

      qRingSvg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
      for (const rect of [qRingTrack, qRingArc]) {
        rect.setAttribute('x', String(pad));
        rect.setAttribute('y', String(pad));
        rect.setAttribute('width', String(rw));
        rect.setAttribute('height', String(rh));
        rect.setAttribute('rx', String(rx));
        rect.setAttribute('ry', String(rx));
      }
    }

    function syncQuotaRingSuppression(nowMs) {
      if (!qRingWrap) return;
      const prefs = getPrefs();
      const fxMode = resolveComposerBorderFx(prefs);
      const preview = isBeamPreviewActive(nowMs);
      const afterglowOn = Boolean(afterglowHost && afterglowHost.getAttribute('data-ag-ps-afterglow'));
      const suppressHard = preview || afterglowOn || (fxMode !== 'off' && fxMode !== 'static' && lastBusy);
      const coexistAmbient = !suppressHard && fxMode === 'beam' && windowFocused;
      setAttr(qRingWrap, 'data-suppressed', suppressHard ? '1' : '');
      setAttr(qRingWrap, 'data-coexist', coexistAmbient ? '1' : '');
    }

    function syncQuotaRing() {
      const prefs = getPrefs();
      const fxMode = resolveComposerBorderFx(prefs);
      if (!prefs.quotaRing || fxMode === 'off') {
        if (qRingWrap) {
          qRingWrap.remove();
          qRingWrap = null;
          qRingSvg = null;
          qRingTrack = null;
          qRingArc = null;
        }
        return;
      }
      if (!composerHost || !composerHost.isConnected) return;
      ensureQuotaRingEl();
      applyQuotaRingGeometry();

      const pct = selectQuotaPercent(prefs);
      if (pct == null) {
        setAttr(qRingWrap, 'data-visible', '');
        return;
      }
      const tier = pct >= 50 ? 'ok' : pct >= 20 ? 'warn' : 'danger';
      const offset = Math.max(0, Math.min(100, 100 - pct));
      setAttr(qRingWrap, 'data-tier', tier);
      setAttr(qRingWrap, 'data-visible', '1');
      setStyleVar(qRingWrap, '--ag-ps-qring-offset', offset.toFixed(2));
      syncQuotaRingSuppression(Date.now());
    }

    /* ========================================================================
     * 4. ThinkingOrb 3D 128-Particle Fibonacci Sphere (Zero Per-Frame Allocs)
     * ======================================================================== */
    const ORB_COUNT = 128;
    const ORB_SIZE = 34;
    const ORB_CONVERGE_MS = 1200;

    // Pre-allocate 128 particle objects once
    const ORB_PARTICLES = new Array(ORB_COUNT);
    const ORB_ORDER = new Int16Array(ORB_COUNT);
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < ORB_COUNT; i++) {
      const y = 1 - ((i + 0.5) / ORB_COUNT) * 2;
      const radAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;
      const bx = Math.cos(theta) * radAtY;
      const bz = Math.sin(theta) * radAtY;
      ORB_PARTICLES[i] = {
        bx,
        by: y,
        bz,
        phase: (i * 0.61803398875) * Math.PI * 2,
        ringBand: i % 3,
        ringAngle: (i / ORB_COUNT) * Math.PI * 2,
        px: 0,
        py: 0,
        pz: 0
      };
      ORB_ORDER[i] = i;
    }

    let orbHost = null;
    let orbDock = null;
    let orbDockAc = null;
    let orbBtn = null;
    let orbCanvas = null;
    let orbCtx = null;
    let orbPill = null;
    let orbStage = 'idle';
    let orbDoneUntil = 0;
    let orbTime = 0;
    let orbRotY = 0;
    let orbRotX = 0.25;
    let orbHovering = false;
    let orbTargetTiltX = 0;
    let orbTargetTiltY = 0;
    let orbTiltX = 0;
    let orbTiltY = 0;
    let orbMorphTools = 0;
    let orbMorphStream = 0;
    let orbMorphEnergy = 0;
    let orbColorR = 96;
    let orbColorG = 165;
    let orbColorB = 250;
    let lastOrbDpr = 0;
    let dprMql = null;
    let dprMqlHandler = null;

    function notifyOrbGeometryChange() {
      if (disposed) return;
      try {
        if (typeof bus.syncMascotObstacles === 'function') {
          bus.syncMascotObstacles();
        } else if (typeof bus.emit === 'function') {
          bus.emit('orb-stage');
        } else {
          window.dispatchEvent(new CustomEvent('ag-prism-orb-change'));
        }
      } catch {}
    }

    function syncOrbCanvasDpr(forceRedraw = false) {
      if (!orbCanvas) return false;
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const targetPx = Math.max(ORB_SIZE, Math.round(ORB_SIZE * dpr));
      const resized =
        orbCanvas.width !== targetPx ||
        orbCanvas.height !== targetPx ||
        Math.abs(dpr - lastOrbDpr) > 0.001;
      if (resized) {
        lastOrbDpr = dpr;
        orbCanvas.width = targetPx;
        orbCanvas.height = targetPx;
      }
      if ((resized || forceRedraw) && !sharedRafId) {
        renderThinkingOrbFrame(0, Date.now(), true);
      }
      return resized;
    }

    function detachDprWatcher() {
      if (dprMql && dprMqlHandler) {
        try { dprMql.removeEventListener('change', dprMqlHandler); } catch {}
      }
      dprMql = null;
      dprMqlHandler = null;
    }

    function armDprWatcher() {
      detachDprWatcher();
      if (disposed || typeof window.matchMedia !== 'function') return;
      try {
        const curDpr = window.devicePixelRatio || 1;
        dprMql = window.matchMedia(`(resolution: ${curDpr}dppx)`);
        dprMqlHandler = () => {
          if (disposed) return;
          scheduleThrottledMeasure();
          if (orbCanvas && getPrefs().thinkingOrb) {
            syncOrbCanvasDpr(true);
          }
          armDprWatcher();
        };
        if (typeof dprMql.addEventListener === 'function') {
          dprMql.addEventListener('change', dprMqlHandler, { once: true });
        }
      } catch {}
    }
    armDprWatcher();

    let lastOrbStageCheckAt = 0;
    let lastOrbStageBusy = null;
    let cachedOrbStage = 'idle';

    function detectOrbStage(busy, nowMs) {
      if (!busy) {
        lastOrbStageBusy = false;
        cachedOrbStage = nowMs < orbDoneUntil ? 'done' : 'idle';
        return cachedOrbStage;
      }
      if (lastOrbStageBusy === true && nowMs - lastOrbStageCheckAt < 250) {
        return cachedOrbStage;
      }
      lastOrbStageBusy = true;
      lastOrbStageCheckAt = nowMs;
      const vp = safeGetViewportEl();
      const scope = vp || document;
      if (scope.querySelector('.animate-shimmer-text, [data-testid*="tool"][data-status="running"]')) {
        cachedOrbStage = 'tools';
        return cachedOrbStage;
      }
      const triggers = scope.querySelectorAll('[data-testid="thinking-collapsible-trigger"]');
      if (triggers.length) {
        const lastTxt = (triggers[triggers.length - 1].textContent || '').trim();
        if (lastTxt && !/\d+\s*s\b|\d+\s*秒|已思考|Thought\s+for/i.test(lastTxt)) {
          cachedOrbStage = 'thinking';
          return cachedOrbStage;
        }
      }
      cachedOrbStage = 'streaming';
      return cachedOrbStage;
    }

    function getStageTargetColor(stage) {
      if (stage === 'tools') return [245, 158, 11];     // Amber gold
      if (stage === 'streaming') return [16, 185, 129]; // Emerald cyan
      if (stage === 'done') return [52, 211, 153];      // Soft mint
      if (stage === 'thinking') {
        const acc = parseCssColorToRgb(safeGetThemeAccent());
        return [
          Math.min(255, Math.round(acc[0] * 0.72 + 124 * 0.28)),
          Math.min(255, Math.round(acc[1] * 0.72 + 92 * 0.28)),
          Math.min(255, Math.round(acc[2] * 0.72 + 252 * 0.28))
        ];
      }
      return parseCssColorToRgb(safeGetThemeAccent());
    }

    function safeGetOrbHostEl() {
      try {
        const activeInput = typeof bus.getInputBoxEl === 'function' ? bus.getInputBoxEl() : null;
        if (activeInput && activeInput.isConnected) return activeInput;
      } catch {}
      const boxes = Array.from(document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]'));
      const vis = boxes.filter((b) => b.isConnected && b.getBoundingClientRect().width > 0);
      return vis[vis.length - 1] || null;
    }

    function updateOrbButtonTip() {
      if (!orbBtn) return;
      const label = ORB_STAGE_LABELS[orbStage] || ORB_STAGE_LABELS.idle;
      const busyState = lastBusy || orbStage === 'thinking' || orbStage === 'tools' || orbStage === 'streaming';
      setAttr(orbBtn, 'data-ag-ps-tip', `ThinkingOrb · ${label}`);
      setAttr(orbBtn, 'data-ag-ps-tip-status', busyState ? 'busy' : 'idle');
    }

    function ensureOrbDock() {
      const host = safeGetOrbHostEl();
      if (!host || !host.isConnected) return null;
      if (orbDock && orbDock.parentElement === host) return orbDock;
      if (orbDock || orbDockAc) removeOrbDock();

      orbHost = host;
      setAttr(orbHost, 'data-ag-ps-orb-host', '1');
      orbDockAc = new AbortController();
      const orbSignal = orbDockAc.signal;

      orbDock = document.createElement('div');
      orbDock.id = 'ag-ps-orb-dock';
      orbDock.setAttribute('data-ag-i18n-ignore', '1');
      orbDock.setAttribute('data-stage', orbStage);

      orbBtn = document.createElement('button');
      orbBtn.id = 'ag-ps-orb-btn';
      orbBtn.type = 'button';
      orbBtn.className = 'ag-ps-orb-btn';
      orbBtn.setAttribute('aria-label', 'ThinkingOrb 任务进度球');
      updateOrbButtonTip();

      orbCanvas = document.createElement('canvas');
      orbCanvas.className = 'ag-ps-orb-canvas';
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      lastOrbDpr = dpr;
      orbCanvas.width = Math.max(ORB_SIZE, Math.round(ORB_SIZE * dpr));
      orbCanvas.height = Math.max(ORB_SIZE, Math.round(ORB_SIZE * dpr));
      orbCtx = orbCanvas.getContext('2d', { alpha: true });

      orbPill = document.createElement('span');
      orbPill.className = 'ag-ps-orb-pill';
      orbPill.textContent = ORB_STAGE_LABELS[orbStage] || ORB_STAGE_LABELS.idle;

      orbBtn.addEventListener('pointerenter', () => {
        if (disposed) return;
        if (orbDock) setAttr(orbDock, 'data-hover', '1');
        notifyOrbGeometryChange();
      }, { signal: orbSignal, passive: true });

      orbBtn.addEventListener('pointermove', (e) => {
        if (disposed || isEffectivelyReducedMotion()) return;
        const rect = orbBtn.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ny = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
        orbHovering = true;
        orbTargetTiltY = Math.max(-1, Math.min(1, nx)) * 0.55;
        orbTargetTiltX = Math.max(-1, Math.min(1, -ny)) * 0.55;
        ensureScheduler();
      }, { signal: orbSignal, passive: true });

      orbBtn.addEventListener('pointerleave', () => {
        orbHovering = false;
        orbTargetTiltX = 0;
        orbTargetTiltY = 0;
        if (orbDock) setAttr(orbDock, 'data-hover', '');
        notifyOrbGeometryChange();
        if (!isEffectivelyReducedMotion()) ensureScheduler();
      }, { signal: orbSignal, passive: true });

      orbBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const label = ORB_STAGE_LABELS[orbStage] || ORB_STAGE_LABELS.idle;
        safeToast(`ThinkingOrb · ${label}`);
      }, { signal: orbSignal });

      orbBtn.appendChild(orbCanvas);
      orbDock.appendChild(orbBtn);
      orbDock.appendChild(orbPill);
      host.appendChild(orbDock);

      // Paint an immediate crisp static frame so idle looks sharp at 0fps
      renderThinkingOrbFrame(0, Date.now(), true);
      notifyOrbGeometryChange();
      return orbDock;
    }

    function removeOrbDock() {
      const hadDock = Boolean(orbDock);
      if (orbDockAc) {
        orbDockAc.abort();
        orbDockAc = null;
      }
      if (orbDock) {
        orbDock.remove();
        orbDock = null;
        orbBtn = null;
        orbCanvas = null;
        orbCtx = null;
        orbPill = null;
      }
      if (orbHost) {
        try { orbHost.removeAttribute('data-ag-ps-orb-host'); } catch {}
        orbHost = null;
      }
      orbHovering = false;
      orbTargetTiltX = 0;
      orbTargetTiltY = 0;
      orbTiltX = 0;
      orbTiltY = 0;
      if (hadDock && !disposed) {
        notifyOrbGeometryChange();
      }
    }

    function syncThinkingOrbMount() {
      const prefs = getPrefs();
      const html = document.documentElement;
      const replaceMascot = Boolean(prefs.thinkingOrb) && prefs.thinkingOrbMode === 'replace';
      setAttr(html, 'data-ag-ps-orb-replace', replaceMascot ? '1' : '');

      if (!prefs.thinkingOrb) {
        removeOrbDock();
        return;
      }
      const host = safeGetOrbHostEl();
      if (!host || !host.isConnected) {
        removeOrbDock();
        return;
      }
      ensureOrbDock();
      updateOrbStageLabel(Date.now());
      updateOrbButtonTip();
    }

    function updateOrbStageLabel(nowMs) {
      const nextStage = detectOrbStage(lastBusy, nowMs);
      if (nextStage !== orbStage) {
        orbStage = nextStage;
        if (orbDock) setAttr(orbDock, 'data-stage', orbStage);
        if (orbPill) orbPill.textContent = ORB_STAGE_LABELS[orbStage] || ORB_STAGE_LABELS.idle;
        updateOrbButtonTip();
        notifyOrbGeometryChange();
        const p = getPrefs();
        if (isEffectivelyReducedMotion(p) && orbCanvas && p.thinkingOrb) {
          renderThinkingOrbFrame(0, nowMs, true);
        }
      } else if (orbBtn) {
        updateOrbButtonTip();
      }
    }

    function orbNeedsRaf(prefs, nowMs) {
      if (!prefs.thinkingOrb || !orbCanvas || !orbCanvas.isConnected) return false;
      if (lastBusy) return true;
      if (nowMs < orbDoneUntil) return true;
      if (windowFocused && (orbHovering || Math.abs(orbTiltX) > 0.004 || Math.abs(orbTiltY) > 0.004)) {
        return true;
      }
      return false;
    }

    function renderThinkingOrbFrame(dt, nowMs, isStaticSnapshot) {
      if (!orbCtx || !orbCanvas) return;

      const stage = orbStage;
      const doneProgress = stage === 'done' && orbDoneUntil > nowMs
        ? Math.max(0, Math.min(1, (orbDoneUntil - nowMs) / ORB_CONVERGE_MS))
        : 0;

      const wantTools = stage === 'tools' ? 1 : 0;
      const wantStream = stage === 'streaming' ? 1 : 0;
      const wantEnergy = stage === 'thinking' || stage === 'tools' || stage === 'streaming'
        ? 1
        : stage === 'done'
          ? doneProgress * doneProgress
          : 0;

      const k = isStaticSnapshot ? 1 : Math.min(1, dt * 5.2);
      orbMorphTools += (wantTools - orbMorphTools) * k;
      orbMorphStream += (wantStream - orbMorphStream) * k;
      orbMorphEnergy += (wantEnergy - orbMorphEnergy) * k;

      const tiltK = isStaticSnapshot ? 1 : Math.min(1, dt * 8.5);
      orbTiltX += (orbTargetTiltX - orbTiltX) * tiltK;
      orbTiltY += (orbTargetTiltY - orbTiltY) * tiltK;
      if (!orbHovering && Math.abs(orbTiltX) <= 0.004) orbTiltX = 0;
      if (!orbHovering && Math.abs(orbTiltY) <= 0.004) orbTiltY = 0;

      const targetRgb = getStageTargetColor(stage);
      const ck = isStaticSnapshot ? 1 : Math.min(1, dt * 4.2);
      orbColorR += (targetRgb[0] - orbColorR) * ck;
      orbColorG += (targetRgb[1] - orbColorG) * ck;
      orbColorB += (targetRgb[2] - orbColorB) * ck;

      const spinSpeed = stage === 'tools'
        ? 1.55
        : stage === 'streaming'
          ? 1.25
          : stage === 'thinking'
            ? 0.85
            : 0.55 * orbMorphEnergy;

      if (!isStaticSnapshot) {
        const orbVivid = getPrefs().performanceMode === 'vivid' ? 1.16 : 1;
        orbTime += dt * (0.8 + orbMorphEnergy * 1.4) * orbVivid;
        orbRotY += dt * spinSpeed * orbVivid;
        orbRotX = 0.25 + Math.sin(orbTime * 0.45) * 0.16 * orbMorphEnergy;
      }

      const rx = orbRotX + orbTiltX;
      const ry = orbRotY + orbTiltY;
      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);

      // Compute 3D transformed positions in-place (zero allocations)
      for (let i = 0; i < ORB_COUNT; i++) {
        const p = ORB_PARTICLES[i];
        let x = p.bx;
        let y = p.by;
        let z = p.bz;

        // Organic thinking breath modulation
        if (orbMorphEnergy > 0.005) {
          const wave = Math.sin(p.phase + orbTime * 2.6 + p.by * 3.1) * 0.11 * orbMorphEnergy;
          const rScale = 1 + wave;
          x *= rScale;
          y *= rScale;
          z *= rScale;
        }

        // Tools state: dual precision orbital rings around a compact core
        if (orbMorphTools > 0.005) {
          let tx, ty, tz;
          if (p.ringBand === 0) {
            tx = p.bx * 0.52;
            ty = p.by * 0.52;
            tz = p.bz * 0.52;
          } else {
            const ang = p.ringAngle + orbTime * (p.ringBand === 1 ? 1.8 : -1.5);
            const ringR = 1.08;
            const c = Math.cos(ang) * ringR;
            const s = Math.sin(ang) * ringR;
            if (p.ringBand === 1) {
              tx = c;
              ty = s * 0.42;
              tz = s * 0.91;
            } else {
              tx = c * 0.91;
              ty = -c * 0.42;
              tz = s;
            }
          }
          x += (tx - x) * orbMorphTools;
          y += (ty - y) * orbMorphTools;
          z += (tz - z) * orbMorphTools;
        }

        // Streaming state: lively radial pulse flow along latitude bands
        if (orbMorphStream > 0.005) {
          const pulse = 1 + Math.sin(p.by * 5.2 - orbTime * 5.0) * 0.14 * orbMorphStream;
          x *= pulse;
          z *= pulse;
        }

        // Rotate around Y then X
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        p.px = x1;
        p.py = y2;
        p.pz = z2;
      }

      // Insertion sort pre-allocated index array back-to-front by pz (zero allocations)
      for (let i = 1; i < ORB_COUNT; i++) {
        const keyIdx = ORB_ORDER[i];
        const keyZ = ORB_PARTICLES[keyIdx].pz;
        let j = i - 1;
        while (j >= 0 && ORB_PARTICLES[ORB_ORDER[j]].pz > keyZ) {
          ORB_ORDER[j + 1] = ORB_ORDER[j];
          j--;
        }
        ORB_ORDER[j + 1] = keyIdx;
      }

      const dpr = orbCanvas.width / ORB_SIZE;
      const ctx = orbCtx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ORB_SIZE, ORB_SIZE);

      const cx = ORB_SIZE * 0.5;
      const cy = ORB_SIZE * 0.5;
      const baseR = 11.4;
      const cr = orbColorR | 0;
      const cg = orbColorG | 0;
      const cb = orbColorB | 0;
      const dark = safeIsDark();

      // Subtle ambient core glow
      const glowAlpha = 0.12 + orbMorphEnergy * 0.18;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, baseR * 1.35);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${glowAlpha.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 1.35, 0, Math.PI * 2);
      ctx.fill();

      // Render 128 depth-sorted particles in 4 depth-bucketed batches (cuts Canvas draw calls 32x)
      const BUCKETS = 4;
      const perBucket = ORB_COUNT / BUCKETS;
      const baseAlpha = dark ? 0.24 : 0.28;
      for (let b = 0; b < BUCKETS; b++) {
        const midD = (b + 0.5) / BUCKETS;
        const alpha = Math.min(1, baseAlpha + midD * (0.58 + orbMorphEnergy * 0.14));
        const lift = midD > 0.68 ? (midD - 0.68) * (dark ? 220 : 120) : 0;
        const pr = Math.min(255, (cr + lift) | 0);
        const pg = Math.min(255, (cg + lift) | 0);
        const pb = Math.min(255, (cb + lift) | 0);
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha.toFixed(3)})`;
        ctx.beginPath();
        const iStart = b * perBucket;
        const iEnd = b === BUCKETS - 1 ? ORB_COUNT : iStart + perBucket;
        for (let i = iStart; i < iEnd; i++) {
          const p = ORB_PARTICLES[ORB_ORDER[i]];
          const persp = 2.55 / (2.55 - p.pz * 0.85);
          const sx = cx + p.px * baseR * persp;
          const sy = cy + p.py * baseR * persp;
          const depth01 = (p.pz + 1.2) / 2.4;
          const clampedD = depth01 < 0 ? 0 : depth01 > 1 ? 1 : depth01;
          const dotR = 0.58 + clampedD * 0.82;
          ctx.moveTo(sx + dotR, sy);
          ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    /* ========================================================================
     * 5. Single Shared rAF Scheduler (Drives ThinkingOrb -> 0fps Idle)
     * ======================================================================== */
    let sharedRafId = 0;
    let lastRafTs = 0;
    let lastBusy = safeIsBusy();

    function stopScheduler() {
      if (sharedRafId) {
        cancelAnimationFrame(sharedRafId);
        sharedRafId = 0;
      }
      lastRafTs = 0;
    }

    function shouldRunScheduler(nowMs) {
      if (disposed || document.hidden) return false;
      const prefs = getPrefs();
      if (isEffectivelyReducedMotion(prefs)) return false;
      return orbNeedsRaf(prefs, nowMs);
    }

    function ensureScheduler() {
      if (sharedRafId || disposed) return;
      if (shouldRunScheduler(Date.now())) {
        lastRafTs = 0;
        sharedRafId = requestAnimationFrame(onSharedRaf);
      }
    }

    function onSharedRaf(ts) {
      sharedRafId = 0;
      const prefs = getPrefs();
      if (disposed || document.hidden || isEffectivelyReducedMotion(prefs)) {
        lastRafTs = 0;
        return;
      }
      const dt = lastRafTs ? Math.min(0.05, Math.max(0.001, (ts - lastRafTs) / 1000)) : 0.016;
      lastRafTs = ts;

      const nowMs = Date.now();
      let keepRunning = false;

      if (prefs.thinkingOrb && orbCanvas && orbCanvas.isConnected) {
        updateOrbStageLabel(nowMs);
        const orbWant = orbNeedsRaf(prefs, nowMs);
        if (orbWant) {
          renderThinkingOrbFrame(dt, nowMs, false);
          keepRunning = true;
        } else {
          // Final crisp converged snapshot before stopping at 0fps
          renderThinkingOrbFrame(dt, nowMs, true);
        }
      }

      if (keepRunning && shouldRunScheduler(nowMs)) {
        sharedRafId = requestAnimationFrame(onSharedRaf);
      } else {
        lastRafTs = 0;
      }
    }

    /* ========================================================================
     * 6. User Bubble Tinting & Compact Layout
     * ======================================================================== */
    function resolveBubbleColor(prefs) {
      const presetId = prefs.bubbleTintPreset || 'accent';
      const dark = safeIsDark();
      if (presetId === 'accent') {
        return safeGetThemeAccent();
      }
      const item = BUBBLE_PRESETS.find((p) => p.id === presetId);
      if (item) return dark ? item.dark : item.light;
      return safeGetThemeAccent();
    }

    function applyPerfAndCustomFonts(prefs = getPrefs()) {
      const html = document.documentElement;
      if (!html) return;
      const perfMode = prefs.performanceMode || 'balanced';
      const chatFont = sanitizeFontFamilyPref(prefs.chatFontFamily || '') || '';
      const codeFont = sanitizeFontFamilyPref(prefs.codeFontFamily || '') || '';
      setAttr(html, 'data-ag-ps-perf', perfMode);
      setAttr(html, 'data-ag-ps-force-motion', prefs.ignoreReducedMotion && perfMode !== 'power-save' ? '1' : '');
      setAttr(html, 'data-ag-ps-reduced-motion', isEffectivelyReducedMotion(prefs) ? '1' : '');
      setAttr(html, 'data-ag-ps-facets', prefs.opticalFacets !== false ? '1' : '');
      setAttr(html, 'data-ag-ps-custom-chat-font', chatFont ? '1' : '');
      setStyleVar(html, '--ag-ps-chat-font', chatFont);
      setAttr(html, 'data-ag-ps-custom-code-font', codeFont ? '1' : '');
      setStyleVar(html, '--ag-ps-code-font', codeFont);
    }

    function applyBubbleTintAndCompact(strengthOverride) {
      const prefs = getPrefs();
      const html = document.documentElement;
      if (!html) return;

      applyPerfAndCustomFonts(prefs);

      // Compact layout
      setAttr(html, 'data-ag-ps-compact', prefs.compactLayout ? '1' : '');

      // User bubble tinting
      if (!prefs.bubbleTint) {
        setAttr(html, 'data-ag-ps-bubble-tint', '');
        setAttr(html, 'data-ag-ps-bubble-contrast', '');
        setStyleVar(html, '--ag-ps-bubble-color', '');
        setStyleVar(html, '--ag-ps-bubble-mix', '');
        return;
      }

      const strength = clampInt(
        strengthOverride !== undefined ? strengthOverride : prefs.bubbleTintStrength,
        10,
        100,
        22
      );
      const color = resolveBubbleColor(prefs);
      setAttr(html, 'data-ag-ps-bubble-tint', '1');
      setStyleVar(html, '--ag-ps-bubble-color', color);
      setStyleVar(html, '--ag-ps-bubble-mix', `${strength}%`);

      if (strength >= 70) {
        const lum = relativeLuminance(parseCssColorToRgb(color));
        setAttr(html, 'data-ag-ps-bubble-contrast', lum < 0.56 ? 'light' : 'dark');
      } else {
        setAttr(html, 'data-ag-ps-bubble-contrast', '');
      }
    }

    /* ========================================================================
     * 7. Unread Badge (Background Completion Title "(N)" Counter)
     * ======================================================================== */
    let unreadCount = 0;
    let titleHasBadge = false;
    let wasBusyForUnread = lastBusy;
    let hiddenPollTimer = 0;

    function stripTitleBadge(title) {
      return String(title || '').replace(/^\(\d+\)\s*/, '');
    }

    function applyUnreadBadgeTitle() {
      if (unreadCount <= 0) return;
      const clean = stripTitleBadge(document.title);
      document.title = `(${unreadCount}) ${clean}`;
      titleHasBadge = true;
    }

    function clearUnreadBadge() {
      if (unreadCount > 0 || titleHasBadge) {
        unreadCount = 0;
        titleHasBadge = false;
        const clean = stripTitleBadge(document.title);
        if (document.title !== clean) document.title = clean;
      }
    }

    function stopHiddenUnreadPoll() {
      if (hiddenPollTimer) {
        clearInterval(hiddenPollTimer);
        hiddenPollTimer = 0;
      }
    }

    function checkUnreadTransition(busyNow) {
      const prefs = getPrefs();
      if (!prefs.unreadBadge) {
        clearUnreadBadge();
        wasBusyForUnread = busyNow;
        stopHiddenUnreadPoll();
        return;
      }
      if (wasBusyForUnread && !busyNow && document.hidden) {
        unreadCount += 1;
        applyUnreadBadgeTitle();
        stopHiddenUnreadPoll();
      }
      wasBusyForUnread = busyNow;
    }

    /* ========================================================================
     * 8. Keep Overview Open Across Route Switches & Side-Panel Layout Reflows
     * ======================================================================== */
    const WANTED_OV_STORAGE_KEY = 'ag_prism_wanted_ov_open_v1';
    const CONV_ROUTE_RE = /^\/c\/[^/]+/;
    const fxSharedState = (window[Symbol.for('ag.prism.fx.visitState')] = window[Symbol.for('ag.prism.fx.visitState')] || {
      hasVisitedConvInWindow: false,
      homeReturnDismissed: false,
      userWantedOverviewOpen: null
    });
    let overviewOpenAtPointerDown = null;
    let overviewPointerDownAt = 0;
    let lastManualOverviewToggleAt = 0;
    let autoClickingOverview = false;
    let overviewRestoreTimer = 0;
    let overviewFollowupTimer = 0;
    let overviewExtraTimers = [];
    let railBurstTimers = [];
    let overviewAutoRestoreClicks = [];
    let lastObservedLayoutSig = '';

    function getWantedOverviewOpen() {
      if (typeof fxSharedState.userWantedOverviewOpen === 'boolean') {
        return fxSharedState.userWantedOverviewOpen;
      }
      try {
        const stored = localStorage.getItem(WANTED_OV_STORAGE_KEY);
        if (stored === '1') {
          fxSharedState.userWantedOverviewOpen = true;
          return true;
        }
        if (stored === '0') {
          fxSharedState.userWantedOverviewOpen = false;
          return false;
        }
      } catch {}
      // When the user has Keep Overview Open enabled and hasn't explicitly closed Overview, default wanted state to true!
      if (getPrefs().keepOverviewOpen) {
        return true;
      }
      return null;
    }

    function setWantedOverviewOpen(val) {
      fxSharedState.userWantedOverviewOpen = val;
      if (typeof val === 'boolean') {
        try { localStorage.setItem(WANTED_OV_STORAGE_KEY, val ? '1' : '0'); } catch {}
      }
    }

    function isConversationRoute(pathname) {
      return CONV_ROUTE_RE.test(pathname != null ? pathname : (window.location.pathname || ''));
    }

    function isElementActuallyVisible(el, minSize = 10) {
      if (!el || !el.isConnected || el.hidden) return false;
      const winW = window.innerWidth || 1920;
      const winH = window.innerHeight || 1080;
      const r = el.getBoundingClientRect();
      if (r.width <= minSize || r.height <= minSize) return false;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= winW || r.top >= winH) return false;
      let cur = el;
      for (let depth = 0; cur && cur !== document.documentElement && depth < 7; depth++, cur = cur.parentElement) {
        if (cur.hidden || cur.hasAttribute('inert')) return false;
        if (cur.getAttribute('aria-hidden') === 'true' || cur.getAttribute('data-state') === 'closed') return false;
        try {
          const cs = window.getComputedStyle(cur);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) {
            return false;
          }
        } catch {}
      }
      return true;
    }

    function getVisibleOverviewPanel() {
      const panels = document.querySelectorAll('[data-testid="overview-panel"]');
      if (!panels.length) return null;
      const vp = safeGetViewportEl();
      const vpRect = vp ? vp.getBoundingClientRect() : null;
      let best = null;
      let bestScore = -Infinity;
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        if (!isElementActuallyVisible(p, 40)) continue;
        const r = p.getBoundingClientRect();
        const overlapsVp = !vpRect || vpRect.width <= 0 || (r.right > vpRect.left + 40 && r.left < vpRect.right + 48);
        const score = (overlapsVp ? 1_000_000 : 0) + r.width * r.height;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      return best;
    }

    function isOverviewOpenNow() {
      return Boolean(getVisibleOverviewPanel());
    }

    function findActiveOverviewToggleBtn() {
      const rawBtns = document.querySelectorAll('[data-testid="toggle-overview-panel"]');
      if (!rawBtns.length) return null;
      const btns = [];
      for (let i = 0; i < rawBtns.length; i++) {
        if (isElementActuallyVisible(rawBtns[i], 4)) btns.push(rawBtns[i]);
      }
      if (!btns.length) return null;
      if (btns.length === 1) return btns[0];

      const vp = safeGetViewportEl();
      if (vp && vp.isConnected) {
        // Walk up starting at active viewport itself to find the nearest pane root owning a single overview toggle
        let anc = vp;
        for (let depth = 0; anc && anc !== document.body && depth < 9; depth++, anc = anc.parentElement) {
          const scoped = btns.filter((b) => anc.contains(b));
          if (scoped.length === 1) return scoped[0];
          if (scoped.length > 1) break;
        }
      }

      const vpRect = vp ? vp.getBoundingClientRect() : null;
      if (!vpRect || vpRect.width <= 0) return btns[0];
      let bestBtn = btns[0];
      let bestDist = Infinity;
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const insidePenalty = (cx >= vpRect.left - 24 && cx <= vpRect.right + 64) ? 0 : 10000;
        const dist = insidePenalty + Math.abs(cx - vpRect.right);
        if (dist < bestDist) {
          bestDist = dist;
          bestBtn = b;
        }
      }
      return bestBtn;
    }

    function clearOverviewRestoreTimers() {
      if (overviewRestoreTimer) {
        clearTimeout(overviewRestoreTimer);
        overviewRestoreTimer = 0;
      }
      if (overviewFollowupTimer) {
        clearTimeout(overviewFollowupTimer);
        overviewFollowupTimer = 0;
      }
      if (orphanedOvHealTimer) {
        clearTimeout(orphanedOvHealTimer);
        orphanedOvHealTimer = 0;
      }
      while (overviewExtraTimers.length) {
        clearTimeout(overviewExtraTimers.pop());
      }
    }

    function clearRailBurstTimers() {
      for (let i = 0; i < railBurstTimers.length; i++) {
        clearTimeout(railBurstTimers[i]);
      }
      railBurstTimers = [];
    }

    function scheduleRailRepositionBurst() {
      clearRailBurstTimers();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          if (!disposed && railEl) positionOutlineRail();
        });
      }
      for (const delay of [85, 220]) {
        railBurstTimers.push(setTimeout(() => {
          if (!disposed && railEl) positionOutlineRail();
        }, delay));
      }
    }

    function hasTransientOverlayBlockingOverviewRestore() {
      const candidates = document.querySelectorAll(
        '[role="menu"], [role="dialog"][aria-modal="true"], #ag-ps-popover[data-open="1"], #ag-claude-model-popover, #ag-claude-quota-popover'
      );
      for (let i = 0; i < candidates.length; i++) {
        if (isElementActuallyVisible(candidates[i], 10)) {
          return true;
        }
      }
      return false;
    }

    function isAuxSidePanelOpen() {
      const auxBtns = document.querySelectorAll('[data-testid="toggle-aux-sidebar"]');
      for (let i = 0; i < auxBtns.length; i++) {
        const b = auxBtns[i];
        if (
          isElementActuallyVisible(b, 4) &&
          (b.getAttribute('aria-expanded') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('data-state') === 'open')
        ) {
          return true;
        }
      }
      return false;
    }

    let orphanedOvEndingSince = 0;
    let orphanedOvHealTimer = 0;

    function checkAndHealOrphanedOverviewTransition(toggleBtn) {
      const sib = document.querySelector('[data-testid="overview-panel-host-sibling"]');
      if (!sib) {
        orphanedOvEndingSince = 0;
        return 'none';
      }
      const isPressed = Boolean(
        toggleBtn && (toggleBtn.getAttribute('aria-pressed') === 'true' || toggleBtn.getAttribute('data-state') === 'open')
      );
      if (sib.hasAttribute('data-starting-style')) {
        orphanedOvEndingSince = 0;
        return 'starting';
      }
      if (sib.hasAttribute('data-ending-style')) {
        if (!isPressed) {
          orphanedOvEndingSince = 0;
          return 'ending';
        }
        // Host button says Overview IS open (aria-pressed="true"), yet sibling has data-ending-style (opacity: 0)!
        const now = Date.now();
        if (!orphanedOvEndingSince) {
          orphanedOvEndingSince = now;
          if (!orphanedOvHealTimer) {
            orphanedOvHealTimer = setTimeout(() => {
              orphanedOvHealTimer = 0;
              if (!disposed) {
                checkAndHealOrphanedOverviewTransition(findActiveOverviewToggleBtn());
                tryRestoreOverviewNow();
              }
            }, 460);
          }
          return 'ending-verify';
        }
        if (now - orphanedOvEndingSince >= 440) {
          sib.removeAttribute('data-ending-style');
          sib.removeAttribute('data-starting-style');
          orphanedOvEndingSince = 0;
          scheduleRailRepositionBurst();
          return 'healed';
        }
        return 'ending-verify';
      }
      orphanedOvEndingSince = 0;
      return 'clean';
    }

    function tryRestoreOverviewNow() {
      if (disposed || !isConversationRoute()) return false;
      // Never fight Antigravity's native side-panel split: while Side Panel is expanded, host suspends Overview and restores it on close!
      if (isAuxSidePanelOpen()) return false;

      const toggleBtn = findActiveOverviewToggleBtn();
      const transState = checkAndHealOrphanedOverviewTransition(toggleBtn);
      if (transState === 'starting' || transState === 'ending' || transState === 'ending-verify' || transState === 'healed') {
        return true;
      }

      const prefs = getPrefs();
      if (!prefs.keepOverviewOpen || getWantedOverviewOpen() !== true) return false;
      const nowMs = Date.now();
      if (nowMs - lastManualOverviewToggleAt < 450) return false;
      if (isOverviewOpenNow()) {
        if (railEl) positionOutlineRail();
        return true;
      }
      if (hasTransientOverlayBlockingOverviewRestore()) return false;

      // Bounded sliding-window guard: max 3 auto-clicks within 4.5s, >=480ms apart (exceeds 400ms --ease-expo-out transition)
      overviewAutoRestoreClicks = overviewAutoRestoreClicks.filter((ts) => nowMs - ts < 4500);
      if (overviewAutoRestoreClicks.length >= 3) return false;
      if (overviewAutoRestoreClicks.length > 0 && nowMs - overviewAutoRestoreClicks[overviewAutoRestoreClicks.length - 1] < 480) {
        return false;
      }

      if (!toggleBtn) return false;
      if (toggleBtn.getAttribute('aria-pressed') === 'true' || toggleBtn.getAttribute('data-state') === 'open') {
        return true;
      }

      overviewAutoRestoreClicks.push(nowMs);
      const prevFocus = document.activeElement;
      autoClickingOverview = true;
      try {
        toggleBtn.click();
      } catch {}
      if (
        prevFocus &&
        prevFocus !== document.body &&
        prevFocus !== document.documentElement &&
        prevFocus !== toggleBtn &&
        prevFocus.isConnected &&
        typeof prevFocus.focus === 'function'
      ) {
        try { prevFocus.focus({ preventScroll: true }); } catch {}
      }
      setTimeout(() => { autoClickingOverview = false; }, 220);
      scheduleRailRepositionBurst();
      return true;
    }

    function scheduleEnsureOverviewOpen(triggerReason, primaryDelayMs = 140) {
      if (disposed || !isConversationRoute()) {
        clearOverviewRestoreTimers();
        return;
      }
      const prefs = getPrefs();
      if (!prefs.keepOverviewOpen || getWantedOverviewOpen() !== true) return;
      if (Date.now() - lastManualOverviewToggleAt < 450) return;

      if (triggerReason === 'route') {
        overviewAutoRestoreClicks = [];
      }

      if (overviewRestoreTimer) clearTimeout(overviewRestoreTimer);
      overviewRestoreTimer = setTimeout(() => {
        overviewRestoreTimer = 0;
        if (disposed) return;
        tryRestoreOverviewNow();
      }, primaryDelayMs);

      // Progressive multi-stage checks spaced past the 400ms --ease-expo-out animation so transitions never collide
      if (triggerReason === 'route' || triggerReason === 'layout' || triggerReason === 'panel-click') {
        if (overviewFollowupTimer) clearTimeout(overviewFollowupTimer);
        overviewFollowupTimer = setTimeout(() => {
          overviewFollowupTimer = 0;
          if (disposed) return;
          if (!isOverviewOpenNow()) {
            tryRestoreOverviewNow();
          } else if (railEl) {
            positionOutlineRail();
          }
        }, Math.max(primaryDelayMs + 360, 500));

        while (overviewExtraTimers.length) clearTimeout(overviewExtraTimers.pop());
        for (const extraMs of [900]) {
          overviewExtraTimers.push(setTimeout(() => {
            if (disposed) return;
            if (!isOverviewOpenNow()) {
              tryRestoreOverviewNow();
            }
          }, extraMs));
        }
      }
    }

    document.addEventListener('pointerdown', (e) => {
      if (disposed || autoClickingOverview || !isConversationRoute()) return;
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      const ovToggle = target.closest('[data-testid="toggle-overview-panel"]');
      if (ovToggle) {
        overviewOpenAtPointerDown = isOverviewOpenNow() || ovToggle.getAttribute('aria-pressed') === 'true';
        overviewPointerDownAt = Date.now();
        lastManualOverviewToggleAt = overviewPointerDownAt;
        clearOverviewRestoreTimers();
        return;
      }
      // Strictly scope Close-button detection INSIDE overview-panel itself so closing auxiliary tabs/dialogs never disables keepOverviewOpen!
      const closeInsideOverview =
        target.closest('[data-testid="overview-panel"]') &&
        target.closest('[aria-label*="Close" i], [aria-label*="Dismiss" i], [aria-label*="关闭"], [data-testid*="close"]');
      if (closeInsideOverview) {
        lastManualOverviewToggleAt = Date.now();
        clearOverviewRestoreTimers();
        setTimeout(() => {
          if (!disposed && isConversationRoute() && !isOverviewOpenNow()) {
            setWantedOverviewOpen(false);
            if (railEl) positionOutlineRail();
          }
        }, 460);
        return;
      }
      // When toggling the Aux Side Panel, let the host natively suspend/restore Overview first, then verify after its 400ms transition!
      const auxToggle = target.closest('[data-testid="toggle-aux-sidebar"]');
      if (auxToggle) {
        clearOverviewRestoreTimers();
        scheduleEnsureOverviewOpen('panel-click', 520);
        scheduleRailRepositionBurst();
        return;
      }
      // If Overview is currently open and user clicks another split-tab button outside Overview, verify cleanly after transition
      if (isOverviewOpenNow() && !target.closest('[data-testid="overview-panel"]')) {
        if (Date.now() - lastManualOverviewToggleAt > 450) {
          setWantedOverviewOpen(true);
        }
        const ctrl = target.closest('button, [role="button"], [role="tab"]');
        if (ctrl && !ctrl.closest('[data-testid="autoscroll-viewport"]')) {
          scheduleEnsureOverviewOpen('panel-click', 480);
          scheduleRailRepositionBurst();
        }
      }
    }, { capture: true, signal });

    document.addEventListener('pointercancel', () => {
      overviewOpenAtPointerDown = null;
      overviewPointerDownAt = 0;
    }, { capture: true, signal });

    document.addEventListener('click', (e) => {
      if (disposed || autoClickingOverview) return;
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('#ag-ps-pill')) {
        scheduleRailRepositionBurst();
        return;
      }
      if (!isConversationRoute()) return;
      const btn = target.closest('[data-testid="toggle-overview-panel"]');
      if (!btn) {
        overviewOpenAtPointerDown = null;
        overviewPointerDownAt = 0;
        return;
      }
      const nowClickMs = Date.now();
      lastManualOverviewToggleAt = nowClickMs;
      clearOverviewRestoreTimers();
      const freshPtrState = overviewOpenAtPointerDown !== null && (nowClickMs - overviewPointerDownAt < 1200);
      const expectedNext = freshPtrState ? !overviewOpenAtPointerDown : !isOverviewOpenNow();
      setWantedOverviewOpen(expectedNext);
      overviewOpenAtPointerDown = null;
      overviewPointerDownAt = 0;
      scheduleRailRepositionBurst();
      setTimeout(() => {
        if (!disposed && isConversationRoute()) {
          const actualOpen = btn.isConnected
            ? (btn.getAttribute('aria-pressed') === 'true' || isOverviewOpenNow())
            : isOverviewOpenNow();
          setWantedOverviewOpen(actualOpen);
          if (railEl) positionOutlineRail();
        }
      }, 480);
    }, { capture: true, signal });

    document.addEventListener('keydown', (e) => {
      if (disposed || e.key !== 'Escape' || !isConversationRoute()) return;
      if (!isOverviewOpenNow() || hasTransientOverlayBlockingOverviewRestore()) return;
      lastManualOverviewToggleAt = Date.now();
      clearOverviewRestoreTimers();
      setTimeout(() => {
        if (!disposed && isConversationRoute() && !isOverviewOpenNow()) {
          setWantedOverviewOpen(false);
          if (railEl) positionOutlineRail();
        }
      }, 150);
    }, { capture: true, signal });

    /* ========================================================================
     * 9. Sidebar Sessions ('default' | '10' | 'all') — Zero Body Observer
     * ======================================================================== */
    const SHOW_MORE_RE = /^(show\s+more|load\s+more|see\s+more|view\s+all|显示更多|展开更多|加载更多|查看全部)/i;
    let lastAutoExpandAt = 0;
    let autoExpandCount = 0;

    function clearHiddenSessionMarks() {
      document.querySelectorAll('[data-ag-ps-sess-hidden="1"]').forEach((el) => {
        el.removeAttribute('data-ag-ps-sess-hidden');
      });
    }

    function findSidebarContainers() {
      const candidates = document.querySelectorAll('aside, nav, [data-testid*="sidebar"], [class*="sidebar"]');
      const results = [];
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (!el.isConnected) continue;
        const links = el.querySelectorAll('a[href*="/c/"]');
        if (links.length >= 2) results.push({ container: el, links });
      }
      return results;
    }

    function syncSidebarSessions() {
      const prefs = getPrefs();
      const mode = prefs.sidebarSessions || 'default';
      const html = document.documentElement;
      setAttr(html, 'data-ag-ps-sidebar-sessions', mode === 'default' ? '' : mode);

      if (mode === 'default') {
        clearHiddenSessionMarks();
        autoExpandCount = 0;
        return;
      }

      const sidebars = findSidebarContainers();
      if (!sidebars.length) return;

      if (mode === '10') {
        autoExpandCount = 0;
        const curPath = window.location.pathname;
        for (let s = 0; s < sidebars.length; s++) {
          const { links } = sidebars[s];
          let visibleCount = 0;
          for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const row = link.closest('li, [role="listitem"], [data-testid*="session"], [data-testid*="conversation"]') || link;
            const href = link.getAttribute('href') || '';
            const isCurrent = link.getAttribute('aria-current') === 'page' || (curPath && href && curPath.endsWith(href));
            if (visibleCount < 10 || isCurrent) {
              if (row.hasAttribute('data-ag-ps-sess-hidden')) row.removeAttribute('data-ag-ps-sess-hidden');
              visibleCount++;
            } else {
              setAttr(row, 'data-ag-ps-sess-hidden', '1');
            }
          }
        }
        return;
      }

      if (mode === 'all') {
        clearHiddenSessionMarks();
        const now = Date.now();
        if (autoExpandCount < 6 && now - lastAutoExpandAt > 1800) {
          for (let s = 0; s < sidebars.length; s++) {
            const btns = sidebars[s].container.querySelectorAll('button');
            for (let b = 0; b < btns.length; b++) {
              const btn = btns[b];
              if (btn.disabled || btn.offsetParent === null) continue;
              const txt = (btn.textContent || '').trim();
              if (SHOW_MORE_RE.test(txt)) {
                lastAutoExpandAt = now;
                autoExpandCount++;
                try { btn.click(); } catch {}
                return;
              }
            }
          }
        }
      }
    }

    /* ========================================================================
     * 10. Always-On Outline Dot Rail (Lightweight Sync + Passive Viewport Scroll)
     * ======================================================================== */
    let railEl = null;
    let railTipEl = null;
    let railScrollVp = null;
    let railScrollAc = null;
    let railScrollRaf = 0;
    let railTurnSig = '';
    let railTurnNodes = [];
    let railActiveIdx = -1;

    function getTurnPreviewText(el) {
      if (!el) return '';
      const contentEl =
        (el.matches && el.matches('[data-testid="user-message-content"]') && el) ||
        (el.querySelector && el.querySelector('[data-testid="user-message-content"]')) ||
        el;
      const txt = (contentEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
      if (el.querySelector && el.querySelector('img, [data-testid*="attachment"], [data-testid*="media"], bdi.context-scope-mention')) {
        return '[图片 / 附件提问]';
      }
      return '';
    }

    function getUserTurns() {
      const scope = safeGetViewportEl() || document;
      let nodes = scope.querySelectorAll('[data-testid="user-input-step"]');
      if (!nodes.length) {
        nodes = scope.querySelectorAll('[data-testid="user-message-content"]');
      }
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!n || !n.isConnected || n.hidden) continue;
        if (n.closest && n.closest('[hidden], [aria-hidden="true"]')) continue;
        if (!getTurnPreviewText(n)) continue;
        out.push(n);
      }
      return out;
    }

    function detectCurrentTurnIndex(turns) {
      if (!turns.length) return -1;
      const vp = safeGetViewportEl();
      const vpRect = vp ? vp.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const anchorY = vpRect.top + vpRect.height * 0.35;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < turns.length; i++) {
        const r = turns[i].getBoundingClientRect();
        const d = Math.abs(r.top - anchorY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    let railHoveredDot = null;
    let railHoveredIdx = -1;

    function safeGetConversationNav() {
      try {
        if (typeof bus.getConversationNav === 'function') {
          return bus.getConversationNav();
        }
      } catch {}
      const turns = getUserTurns();
      return {
        mode: 'dom',
        convId: String(window.location.pathname || ''),
        total: turns.length,
        activeIndex: turns.length ? detectCurrentTurnIndex(turns) : -1,
        domTurns: turns,
        getPreview: (i) => (turns[i] ? getTurnPreviewText(turns[i]) : ''),
        getDomEl: (i) => turns[i] || null,
        ensurePreviews: () => Promise.resolve(false),
        jumpTo: () => false
      };
    }

    let hostNavBoundEl = null;
    let hostNavAc = null;

    function ensureRailTipOnly() {
      if (!railTipEl && document.body) {
        railTipEl = document.createElement('div');
        railTipEl.id = 'ag-ps-rail-tip';
        railTipEl.setAttribute('data-ag-i18n-ignore', '1');
        document.body.appendChild(railTipEl);
      }
      return railTipEl;
    }

    function hideRailTip() {
      railHoveredDot = null;
      railHoveredIdx = -1;
      if (railTipEl) setAttr(railTipEl, 'data-show', '');
    }

    function extractTurnReplyExcerpt(turnNode) {
      if (!turnNode || !turnNode.isConnected) return '';
      const turnContainer = turnNode.closest('[data-testid="user-message"]')?.parentElement || turnNode.parentElement;
      if (!turnContainer) return '';
      const resp =
        turnContainer.querySelector('[data-testid="planner-response-text"], [data-testid="agent-response"], [data-markdown-root], .prose') ||
        (turnContainer.nextElementSibling && turnContainer.nextElementSibling.querySelector && turnContainer.nextElementSibling.querySelector('[data-testid="planner-response-text"], [data-testid="agent-response"], [data-markdown-root], .prose'));
      if (!resp) return '';
      return (resp.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 110);
    }

    function showRailTip(dotBtn, idx, text, side = 'right') {
      const tip = ensureRailTipOnly();
      if (!tip || !dotBtn) return;
      railHoveredDot = dotBtn;
      railHoveredIdx = idx;
      const previewStyle = resolveOutlinePreviewStyle(getPrefs());
      setAttr(tip, 'data-style', previewStyle);
      tip.textContent = '';

      if (previewStyle === 'detailed') {
        const nav = safeGetConversationNav();
        const total = nav && nav.total > 0 ? nav.total : Math.max(idx + 1, railTurnNodes.length);
        const domTurn = (nav && typeof nav.getDomEl === 'function' && nav.getDomEl(idx)) || railTurnNodes[idx] || null;
        const replyTxt = extractTurnReplyExcerpt(domTurn);

        const qEl = document.createElement('div');
        qEl.className = 'ag-ps-rail-tip-q';
        qEl.textContent = (text || `第 ${idx + 1} 轮提问`).slice(0, 96);
        tip.appendChild(qEl);

        if (replyTxt) {
          const aEl = document.createElement('div');
          aEl.className = 'ag-ps-rail-tip-a';
          aEl.textContent = replyTxt;
          tip.appendChild(aEl);
        }

        const metaEl = document.createElement('div');
        metaEl.className = 'ag-ps-rail-tip-meta';
        metaEl.textContent = `第 ${idx + 1} / ${total} 轮`;
        tip.appendChild(metaEl);
      } else {
        const badge = document.createElement('span');
        badge.className = 'ag-ps-rail-tip-idx';
        badge.textContent = `#${idx + 1}`;
        const txtSpan = document.createElement('span');
        txtSpan.textContent = (text || '当前对话轮次').slice(0, 52);
        tip.appendChild(badge);
        tip.appendChild(txtSpan);
      }

      const rect = dotBtn.getBoundingClientRect();
      const estH = previewStyle === 'detailed' ? 96 : 30;
      const tipTop = Math.max(12, Math.min(window.innerHeight - estH - 12, Math.round(rect.top + rect.height * 0.5 - estH * 0.5)));
      setAttr(tip, 'data-side', side === 'left' ? 'left' : 'right');
      if (side === 'left') {
        const leftPx = Math.max(12, Math.min(window.innerWidth - 290, Math.round(rect.right + 10)));
        tip.style.left = `${leftPx}px`;
        tip.style.right = 'auto';
      } else {
        const tipRight = Math.max(16, Math.round(window.innerWidth - rect.left + 10));
        tip.style.right = `${tipRight}px`;
        tip.style.left = 'auto';
      }
      tip.style.top = `${tipTop}px`;
      setAttr(tip, 'data-show', '1');
    }

    function getVisibleHostConversationNavigator() {
      const navEl = document.querySelector('[data-testid="conversation-navigator"]');
      if (!navEl || !navEl.isConnected) return null;
      const r = navEl.getBoundingClientRect();
      if (r.width < 4 || r.height < 20) return null;
      try {
        const cs = getComputedStyle(navEl);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
      } catch {}
      return navEl;
    }

    function detachHostNavEnhancer() {
      if (hostNavAc) {
        try { hostNavAc.abort(); } catch {}
        hostNavAc = null;
      }
      hostNavBoundEl = null;
    }

    function attachHostNavEnhancer(navEl) {
      if (!navEl || !navEl.isConnected) {
        detachHostNavEnhancer();
        return;
      }
      if (hostNavBoundEl === navEl && hostNavAc) return;
      detachHostNavEnhancer();
      hostNavBoundEl = navEl;
      hostNavAc = new AbortController();
      const sig = hostNavAc.signal;

      navEl.addEventListener('pointerover', (e) => {
        if (disposed) return;
        const turnEl = e.target && e.target.closest && e.target.closest('[data-testid="conversation-navigator-turn"]');
        if (!turnEl) return;
        if (
          resolveOutlinePreviewStyle(getPrefs()) === 'detailed' &&
          (turnEl.hasAttribute('data-base-ui-tooltip-trigger') || turnEl.hasAttribute('data-hover-card-trigger'))
        ) {
          hideRailTip();
          return;
        }
        let idx = Number(turnEl.getAttribute('data-turn-index'));
        if (!Number.isFinite(idx) || idx < 0) {
          const allTurns = navEl.querySelectorAll('[data-testid="conversation-navigator-turn"]');
          idx = Array.prototype.indexOf.call(allTurns, turnEl);
        }
        if (idx < 0) return;
        const nav = safeGetConversationNav();
        let txt = nav && nav.total > idx ? nav.getPreview(idx) : '';
        if (!txt) {
          const domTurns = (nav && nav.domTurns) || getUserTurns();
          if (domTurns[idx]) txt = getTurnPreviewText(domTurns[idx]);
        }
        showRailTip(turnEl, idx, txt || `第 ${idx + 1} 轮提问`, 'left');
        if (!txt && nav && typeof nav.ensurePreviews === 'function') {
          nav.ensurePreviews(idx, 16, () => {
            if (!disposed && railHoveredDot === turnEl && railHoveredIdx === idx) {
              const refreshed = safeGetConversationNav().getPreview(idx);
              if (refreshed) showRailTip(turnEl, idx, refreshed, 'left');
            }
          });
        }
      }, { signal, passive: true });

      navEl.addEventListener('pointerout', (e) => {
        if (!railHoveredDot) return;
        const rel = e.relatedTarget;
        if (!rel || !railHoveredDot.contains(rel)) hideRailTip();
      }, { signal, passive: true });

      navEl.addEventListener('pointerleave', hideRailTip, { signal, passive: true });
    }

    function updateRailActiveDot(navOverride = null) {
      if (!railEl) return;
      const dots = railEl.children;
      if (!dots.length) return;
      const nav = navOverride || safeGetConversationNav();
      const idx = nav.total > 0
        ? Math.max(0, Math.min(dots.length - 1, nav.activeIndex >= 0 ? nav.activeIndex : dots.length - 1))
        : (railTurnNodes.length ? detectCurrentTurnIndex(railTurnNodes) : 0);
      if (idx < 0 || idx === railActiveIdx) return;
      railActiveIdx = idx;
      let activeDotEl = null;
      for (let i = 0; i < dots.length; i++) {
        if (i === idx) {
          dots[i].setAttribute('aria-current', 'true');
          activeDotEl = dots[i];
        } else {
          dots[i].removeAttribute('aria-current');
        }
      }
      // Keep active pill centered inside scrollable rail on multi-turn (>16) conversations
      if (activeDotEl && dots.length > 16 && railEl.clientHeight > 0 && !railHoveredDot) {
        const targetScroll = activeDotEl.offsetTop - railEl.clientHeight * 0.5 + activeDotEl.offsetHeight * 0.5;
        railEl.scrollTop = Math.max(0, Math.round(targetScroll));
      }
    }

    let railVpRO = null;
    let railObservedOv = null;
    let railPosRaf = 0;

    function collectRightFloatingPanelRects(vpRect, bandTop, bandBottom) {
      const rects = [];
      const seen = new Set();
      const minRightHalfX = vpRect.left + Math.max(180, vpRect.width * 0.56);
      const pushIfOverlappingRight = (el) => {
        if (!el || seen.has(el) || !isElementActuallyVisible(el, 28)) return;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (
          r.bottom > bandTop &&
          r.top < bandBottom &&
          r.left >= minRightHalfX &&
          r.right > vpRect.left + 180 &&
          r.left < vpRect.right + 40
        ) {
          rects.push(r);
        }
      };
      pushIfOverlappingRight(getVisibleOverviewPanel());
      const floaters = document.querySelectorAll(
        '#ag-ps-popover[data-open="1"], #ag-ps-outline[data-open="1"], #ag-ps-img-menu'
      );
      for (let i = 0; i < floaters.length; i++) {
        pushIfOverlappingRight(floaters[i]);
      }
      return rects;
    }

    function positionOutlineRail() {
      if (!railEl) return;
      const openOutlineDrawer = document.getElementById('ag-ps-outline');
      if (openOutlineDrawer && openOutlineDrawer.getAttribute('data-open') === '1') {
        setAttr(railEl, 'data-occluded', '1');
        hideRailTip();
        return;
      }
      const vp = safeGetViewportEl();
      if (vp) {
        const rect = vp.getBoundingClientRect();
        if (rect.width > 120) {
          // Clear gutter to the left of scrollbar so clicks never collide with scrollbar thumb
          const scrollbarW = Math.max(16, Math.round((vp.offsetWidth || 0) - (vp.clientWidth || 0)));
          const gutter = rect.width < 420 ? 12 : 20;
          let targetRightX = rect.right - scrollbarW - gutter;

          const winH = window.innerHeight || 800;
          const railH = Math.max(64, railEl.offsetHeight || 120);
          const bandTop = winH * 0.5 - railH * 0.5 - 20;
          const bandBottom = winH * 0.5 + railH * 0.5 + 20;
          const floatingRects = collectRightFloatingPanelRects(rect, bandTop, bandBottom);
          for (let i = 0; i < floatingRects.length; i++) {
            const fr = floatingRects[i];
            if (fr.left < targetRightX + 24) {
              targetRightX = Math.min(targetRightX, fr.left - 16);
            }
          }

          if (targetRightX - rect.left < 160) {
            setAttr(railEl, 'data-occluded', '1');
            hideRailTip();
            return;
          }

          setAttr(railEl, 'data-occluded', '');
          const minRight = Math.max(22, scrollbarW + gutter);
          const maxRight = Math.max(minRight, Math.round(window.innerWidth - rect.left - 64));
          const desired = Math.round(window.innerWidth - targetRightX);
          const rightPx = Math.max(minRight, Math.min(maxRight, desired));
          railEl.style.right = `${rightPx}px`;
          return;
        }
      }
      setAttr(railEl, 'data-occluded', '');
      railEl.style.right = '28px';
    }

    function detachRailScroll() {
      if (railScrollRaf) {
        cancelAnimationFrame(railScrollRaf);
        railScrollRaf = 0;
      }
      if (railPosRaf) {
        cancelAnimationFrame(railPosRaf);
        railPosRaf = 0;
      }
      if (railVpRO) {
        try { railVpRO.disconnect(); } catch {}
        railVpRO = null;
      }
      railObservedOv = null;
      if (railScrollAc) {
        railScrollAc.abort();
        railScrollAc = null;
      }
      railScrollVp = null;
    }

    function attachRailScroll(vp) {
      const curOv = getVisibleOverviewPanel();
      if (railScrollVp === vp && railScrollAc) {
        if (railVpRO && curOv && curOv !== railObservedOv) {
          railObservedOv = curOv;
          try { railVpRO.observe(curOv); } catch {}
        }
        return;
      }
      detachRailScroll();
      if (!vp || !vp.isConnected) return;
      railScrollVp = vp;
      railScrollAc = new AbortController();
      vp.addEventListener('scroll', () => {
        if (disposed || railScrollRaf || document.hidden) return;
        railScrollRaf = requestAnimationFrame(() => {
          railScrollRaf = 0;
          if (!disposed) updateRailActiveDot();
        });
      }, { passive: true, signal: railScrollAc.signal });
      if (typeof ResizeObserver === 'function') {
        railVpRO = new ResizeObserver(() => {
          if (disposed || railPosRaf || document.hidden) return;
          railPosRaf = requestAnimationFrame(() => {
            railPosRaf = 0;
            if (!disposed && railEl) positionOutlineRail();
          });
        });
        railVpRO.observe(vp);
        if (vp.parentElement && vp.parentElement !== document.body) {
          railVpRO.observe(vp.parentElement);
        }
        if (curOv) {
          railObservedOv = curOv;
          try { railVpRO.observe(curOv); } catch {}
        }
      }
    }

    function removeOutlineRail(keepTip = false) {
      detachRailScroll();
      if (railEl) {
        railEl.remove();
        railEl = null;
      }
      if (!keepTip && railTipEl) {
        railTipEl.remove();
        railTipEl = null;
      } else if (keepTip) {
        hideRailTip();
      }
      railTurnSig = '';
      railTurnNodes = [];
      railActiveIdx = -1;
    }

    function ensureOutlineRailEls() {
      if (!railEl && document.body) {
        railEl = document.createElement('nav');
        railEl.id = 'ag-ps-outline-rail';
        railEl.setAttribute('aria-label', '对话轮次圆点目录');
        railEl.setAttribute('data-ag-i18n-ignore', '1');

        railEl.addEventListener('click', (e) => {
          const dot = e.target && e.target.closest && e.target.closest('.ag-ps-rail-dot');
          if (!dot) return;
          const idx = Number(dot.getAttribute('data-rail-idx'));
          const nav = safeGetConversationNav();
          if (nav && nav.total > 0 && idx >= 0 && idx < nav.total) {
            if (nav.jumpTo(idx)) {
              railActiveIdx = -1;
              updateRailActiveDot({ total: nav.total, activeIndex: idx });
              setTimeout(() => {
                if (!disposed && railEl) {
                  railActiveIdx = -1;
                  updateRailActiveDot();
                }
              }, 240);
              return;
            }
          }
          const target = railTurnNodes[idx];
          if (!target || !target.isConnected) {
            const vp = safeGetViewportEl();
            if (vp && typeof vp.scrollTo === 'function') {
              vp.scrollTo({ top: 0, behavior: isEffectivelyReducedMotion() ? 'auto' : 'smooth' });
            }
            return;
          }
          const bubble =
            (target.querySelector && target.querySelector('[data-testid="user-message-bubble"]')) ||
            target.closest('[data-testid="user-message-bubble"]') ||
            target.closest('[data-testid="user-message"]') ||
            target;
          const red = isEffectivelyReducedMotion();
          bubble.scrollIntoView({ behavior: red ? 'auto' : 'smooth', block: 'center' });
          if (!red) {
            bubble.classList.remove('ag-ps-turn-pulse');
            void bubble.offsetWidth;
            bubble.classList.add('ag-ps-turn-pulse');
            setTimeout(() => bubble.classList.remove('ag-ps-turn-pulse'), 1500);
          }
          const preview = getTurnPreviewText(target).slice(0, 34);
          safeToast(`第 ${idx + 1} / ${railTurnNodes.length} 轮 · ${preview}`);
          railActiveIdx = -1;
          updateRailActiveDot();
        }, { signal });

        railEl.addEventListener('pointerover', (e) => {
          const dot = e.target && e.target.closest && e.target.closest('.ag-ps-rail-dot');
          if (!dot) return;
          const idx = Number(dot.getAttribute('data-rail-idx'));
          const nav = safeGetConversationNav();
          let txt = nav && nav.total > idx ? nav.getPreview(idx) : '';
          if (!txt && railTurnNodes[idx]) txt = getTurnPreviewText(railTurnNodes[idx]);
          showRailTip(dot, idx, txt || '加载提问摘要…', 'right');
          if (!txt && nav && typeof nav.ensurePreviews === 'function') {
            nav.ensurePreviews(idx, 16, () => {
              if (!disposed && railHoveredDot === dot && railHoveredIdx === idx) {
                const refreshed = safeGetConversationNav().getPreview(idx);
                if (refreshed) showRailTip(dot, idx, refreshed, 'right');
              }
            });
          }
        }, { signal });

        railEl.addEventListener('pointerleave', hideRailTip, { signal });
        document.body.appendChild(railEl);
      }

      ensureRailTipOnly();
    }

    function syncOutlineRail() {
      const prefs = getPrefs();
      const railMode = resolveOutlineRailMode(prefs);
      const previewStyle = resolveOutlinePreviewStyle(prefs);
      const html = document.documentElement;
      if (html) {
        setAttr(html, 'data-ag-ps-nav-off', railMode === 'off' ? '1' : '');
        setAttr(html, 'data-ag-ps-rail-preview', railMode !== 'off' && previewStyle === 'compact' ? 'compact' : '');
      }

      if (railMode === 'off') {
        detachHostNavEnhancer();
        removeOutlineRail(false);
        return;
      }

      if (railMode === 'smart') {
        const hostNavEl = getVisibleHostConversationNavigator();
        if (hostNavEl) {
          removeOutlineRail(true);
          const hostHasNativeCard = Boolean(
            hostNavEl.querySelector && hostNavEl.querySelector('[data-base-ui-tooltip-trigger], [data-hover-card-trigger]')
          );
          // Strictly show ONLY ONE tooltip:
          // - 'detailed' on modern host (with native hover card): let native multi-line card render alone (zero overlap!)
          // - 'compact' (or legacy host without native hover card): show our #ag-ps-rail-tip (CSS hides native card in compact mode)
          if (previewStyle === 'compact' || !hostHasNativeCard) {
            attachHostNavEnhancer(hostNavEl);
          } else {
            detachHostNavEnhancer();
            hideRailTip();
          }
          return;
        }
      }
      detachHostNavEnhancer();

      const vp = safeGetViewportEl();
      const nav = safeGetConversationNav();
      const turns = nav.domTurns || getUserTurns();
      const totalTurns = nav.total > 0 ? nav.total : turns.length;
      const hasVirtualActiveChat =
        totalTurns === 0 &&
        isConversationRoute() &&
        Boolean(vp && vp.querySelector('[data-testid="planner-response-text"], [data-testid="worked-for-collapsible"]'));

      if (totalTurns < 1 && !hasVirtualActiveChat) {
        if (railEl) setAttr(railEl, 'data-show', '');
        hideRailTip();
        detachRailScroll();
        railTurnNodes = turns;
        railTurnSig = '';
        return;
      }

      ensureOutlineRailEls();
      if (!railEl) return;

      const dotCount = Math.max(1, totalTurns);
      const lastStepTag = nav.turns && nav.turns.length
        ? `${nav.turns[0]?.startStepIndex}:${nav.turns[nav.turns.length - 1]?.startStepIndex}`
        : `${turns.length ? getTurnPreviewText(turns[0]).slice(0, 14) : 'v'}:${turns.length ? getTurnPreviewText(turns[turns.length - 1]).slice(0, 14) : 'v'}`;
      const sig = `${nav.convId || ''}|${dotCount}|${lastStepTag}`;
      railTurnNodes = turns;

      if (sig !== railTurnSig) {
        railTurnSig = sig;
        const initActive = totalTurns > 0
          ? Math.max(0, Math.min(dotCount - 1, nav.activeIndex >= 0 ? nav.activeIndex : dotCount - 1))
          : 0;
        railActiveIdx = initActive;
        let initActiveEl = null;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < dotCount; i++) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ag-ps-rail-dot';
          btn.setAttribute('data-rail-idx', String(i));
          btn.setAttribute('aria-label', `跳转到第 ${i + 1} 轮`);
          if (i === initActive) {
            btn.setAttribute('aria-current', 'true');
            initActiveEl = btn;
          }
          frag.appendChild(btn);
        }
        railEl.textContent = '';
        railEl.appendChild(frag);
        setAttr(railEl, 'data-scrollable', dotCount > 16 ? '1' : '');
        setAttr(railEl, 'data-show', '1');
        if (initActiveEl && dotCount > 16 && railEl.clientHeight > 0 && !railHoveredDot) {
          const targetScroll = initActiveEl.offsetTop - railEl.clientHeight * 0.5 + initActiveEl.offsetHeight * 0.5;
          railEl.scrollTop = Math.max(0, Math.round(targetScroll));
        }
      } else {
        setAttr(railEl, 'data-scrollable', dotCount > 16 ? '1' : '');
        setAttr(railEl, 'data-show', '1');
      }

      positionOutlineRail();
      updateRailActiveDot(nav);
      attachRailScroll(vp);
    }

    /* ========================================================================
     * 10b. Safe Manual Account-Switch Return Helper (Zero Credentials / Zero Modal Clicks)
     * ======================================================================== */
    const LAST_CONV_STORAGE_KEY = 'ag_prism_last_conv_v1';
    const LAST_CONV_COOKIE_KEY = 'ag_prism_last_conv_v1';
    const VALID_CONV_PATH_RE = /^\/c\/[A-Za-z0-9_-]{8,}/;
    const SAFE_CONV_PATH_RE = /^\/c\/[A-Za-z0-9_-]{8,}(?:\/[A-Za-z0-9_-]+)*$/;
    const SETTINGS_ROUTE_RE = /^\/settings(?:\/|$)/;
    const LAST_CONV_MAX_AGE_MS = 4 * 60 * 60 * 1000;
    const HOME_RETURN_MAX_AGE_MS = 30 * 60 * 1000;

    let returnBarEl = null;
    let returnBarAc = null;
    let returnBarPath = '';
    let returnBarMode = ''; // 'settings' | 'home'
    let returnBarCountdownEl = null;
    let returnBarDismissedForVisit = false;
    // Reuse fxSharedState persisted across Anti-Claude hot-reloads within the same document
    const fxVisitState = fxSharedState;
    if (VALID_CONV_PATH_RE.test(window.location.pathname || '') && SAFE_CONV_PATH_RE.test(window.location.pathname || '')) {
      fxVisitState.hasVisitedConvInWindow = true;
    }
    let wasOnSettingsRoute = false;
    let returnCountdownTimer = 0;
    let returnCountdownSec = 0;
    let returnNavFallbackTimer = 0;
    let lastSavedConvPath = '';
    let lastSavedConvAt = 0;
    let lastOnboardingDismissAt = 0;
    let onboardingRetryTimer = 0;

    function isSafeConvPath(p) {
      if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || /[\\\x00-\x20]/.test(p)) return false;
      return VALID_CONV_PATH_RE.test(p) && SAFE_CONV_PATH_RE.test(p);
    }

    function isHomeWelcomeRoute(p) {
      return p === '/' || p === '';
    }

    function canUseHostCookie() {
      try {
        return typeof window === 'object' && Boolean(window.location) && /^https?:$/i.test(window.location.protocol || '');
      } catch {
        return false;
      }
    }

    function saveLastConversationPath(pathname) {
      if (!isSafeConvPath(pathname)) return;
      fxVisitState.hasVisitedConvInWindow = true;
      const now = Date.now();
      if (pathname === lastSavedConvPath && now - lastSavedConvAt < 15000) return;
      lastSavedConvPath = pathname;
      lastSavedConvAt = now;
      const payload = JSON.stringify({ path: pathname, ts: now });
      try { sessionStorage.setItem(LAST_CONV_STORAGE_KEY, payload); } catch {}
      try { localStorage.setItem(LAST_CONV_STORAGE_KEY, payload); } catch {}
      if (canUseHostCookie()) {
        try {
          const enc = encodeURIComponent(payload);
          if (enc.length <= 1024) {
            const secureAttr = /^https:$/i.test(window.location.protocol || '') ? '; Secure' : '';
            document.cookie = `${LAST_CONV_COOKIE_KEY}=${enc}; Path=/; Max-Age=14400; SameSite=Lax${secureAttr}`;
          }
        } catch {}
      }
    }

    function loadLastConversationRecord() {
      const now = Date.now();
      let best = null;
      const considerRaw = (raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || !isSafeConvPath(parsed.path)) return;
          const ts = Number(parsed.ts);
          if (!Number.isFinite(ts)) return;
          const age = now - ts;
          if (age <= LAST_CONV_MAX_AGE_MS && age >= -60000) {
            if (!best || ts > best.ts) {
              best = { path: parsed.path, ts };
            }
          }
        } catch {}
      };
      try { considerRaw(sessionStorage.getItem(LAST_CONV_STORAGE_KEY)); } catch {}
      try { considerRaw(localStorage.getItem(LAST_CONV_STORAGE_KEY)); } catch {}
      if (canUseHostCookie()) {
        try {
          const prefix = `${LAST_CONV_COOKIE_KEY}=`;
          for (const part of String(document.cookie || '').split(';')) {
            const seg = part.trim();
            if (!seg.startsWith(prefix)) continue;
            try { considerRaw(decodeURIComponent(seg.slice(prefix.length))); } catch {}
          }
        } catch {}
      }
      return best;
    }

    function hasOpenModalDialog() {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      for (let i = 0; i < dialogs.length; i++) {
        const d = dialogs[i];
        if (!d || !d.isConnected) continue;
        if (d.hidden || d.getAttribute('aria-hidden') === 'true') continue;
        if (d.offsetWidth > 0 || d.offsetHeight > 0 || d.getClientRects().length > 0) {
          return true;
        }
      }
      return false;
    }

    function formatShortConvBadge(path) {
      const seg = String(path || '').replace(/^\/c\//, '').split('/')[0] || '';
      if (!seg) return '#conv';
      return seg.length > 10 ? `#${seg.slice(0, 8)}` : `#${seg}`;
    }

    function stopReturnCountdown() {
      if (returnCountdownTimer) {
        clearInterval(returnCountdownTimer);
        returnCountdownTimer = 0;
      }
      returnCountdownSec = 0;
      if (returnBarCountdownEl) {
        returnBarCountdownEl.textContent = '';
        setAttr(returnBarCountdownEl, 'data-active', '');
      }
    }

    let returnBarLeaveTimer = 0;
    let leavingReturnBarEl = null;

    function clearLeavingReturnBar() {
      if (returnBarLeaveTimer) {
        clearTimeout(returnBarLeaveTimer);
        returnBarLeaveTimer = 0;
      }
      if (leavingReturnBarEl) {
        leavingReturnBarEl.remove();
        leavingReturnBarEl = null;
      }
    }

    function removeReturnBar(immediate = false) {
      stopReturnCountdown();
      if (returnBarAc) {
        returnBarAc.abort();
        returnBarAc = null;
      }
      returnBarCountdownEl = null;
      returnBarPath = '';
      returnBarMode = '';

      if (immediate || disposed || isEffectivelyReducedMotion() || document.hidden) {
        clearLeavingReturnBar();
        if (returnBarEl) {
          returnBarEl.remove();
          returnBarEl = null;
        }
        return;
      }

      if (!returnBarEl) return;
      clearLeavingReturnBar();
      const el = returnBarEl;
      returnBarEl = null;
      if (!el.isConnected) {
        el.remove();
        return;
      }
      leavingReturnBarEl = el;
      setAttr(el, 'data-leaving', '1');
      returnBarLeaveTimer = setTimeout(() => {
        returnBarLeaveTimer = 0;
        if (leavingReturnBarEl === el) leavingReturnBarEl = null;
        if (el.isConnected) el.remove();
      }, 150);
    }

    function findNativeSidebarConvLink(targetPath) {
      const links = document.querySelectorAll('a[href*="/c/"]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        if (!a || !a.isConnected) continue;
        const rawHref = a.getAttribute('href') || '';
        if (rawHref === targetPath) return a;
        try {
          const parsed = new URL(a.href, window.location.origin);
          if (parsed.origin === window.location.origin && parsed.pathname === targetPath) {
            return a;
          }
        } catch {}
      }
      return null;
    }

    function navigateToSavedConv(savedPath) {
      if (!isSafeConvPath(savedPath)) return;
      fxVisitState.hasVisitedConvInWindow = true;
      returnBarDismissedForVisit = true;
      removeReturnBar();

      if (returnNavFallbackTimer) {
        clearTimeout(returnNavFallbackTimer);
        returnNavFallbackTimer = 0;
      }
      if (onboardingRetryTimer) {
        clearTimeout(onboardingRetryTimer);
        onboardingRetryTimer = 0;
      }

      const nativeLink = findNativeSidebarConvLink(savedPath);
      if (nativeLink) {
        try { nativeLink.click(); } catch {}
      } else {
        try {
          window.history.pushState(null, '', savedPath);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch {}
      }

      returnNavFallbackTimer = setTimeout(() => {
        returnNavFallbackTimer = 0;
        if (disposed) return;
        if (window.location.pathname !== savedPath) {
          try { window.location.assign(savedPath); } catch {}
        }
      }, 450);
    }

    function startReturnCountdown(savedPath) {
      if (disposed || returnCountdownTimer) return;
      if (!returnBarEl || !returnBarEl.isConnected || !returnBarCountdownEl) return;
      if (!getPrefs().switchAutoReturn || document.hidden || hasOpenModalDialog()) return;

      returnCountdownSec = 3;
      returnBarCountdownEl.textContent = `${returnCountdownSec}s 后自动返回`;
      setAttr(returnBarCountdownEl, 'data-active', '1');

      returnCountdownTimer = setInterval(() => {
        if (
          disposed ||
          !returnBarEl ||
          !returnBarEl.isConnected ||
          !SETTINGS_ROUTE_RE.test(window.location.pathname || '') ||
          !getPrefs().switchReturnHelper ||
          !getPrefs().switchAutoReturn
        ) {
          stopReturnCountdown();
          return;
        }
        if (document.hidden || hasOpenModalDialog()) {
          stopReturnCountdown();
          return;
        }
        returnCountdownSec -= 1;
        if (returnCountdownSec <= 0) {
          stopReturnCountdown();
          navigateToSavedConv(savedPath);
          return;
        }
        if (returnBarCountdownEl) {
          returnBarCountdownEl.textContent = `${returnCountdownSec}s 后自动返回`;
        }
      }, 1000);
    }

    function mountReturnBar(savedPath, mode = 'settings') {
      if (!document.body || !isSafeConvPath(savedPath)) return;
      const allowAutoCountdown = mode === 'settings';
      if (returnBarEl && returnBarEl.isConnected && returnBarPath === savedPath && returnBarMode === mode) {
        if (allowAutoCountdown && getPrefs().switchAutoReturn) {
          if (hasOpenModalDialog() || document.hidden) {
            stopReturnCountdown();
          } else if (!returnCountdownTimer && !returnBarDismissedForVisit) {
            startReturnCountdown(savedPath);
          }
        } else {
          stopReturnCountdown();
        }
        return;
      }

      clearLeavingReturnBar();
      removeReturnBar(true);
      returnBarAc = new AbortController();
      const barSignal = returnBarAc.signal;
      returnBarPath = savedPath;
      returnBarMode = mode;

      returnBarEl = document.createElement('div');
      returnBarEl.id = 'ag-ps-return-bar';
      returnBarEl.setAttribute('role', 'status');
      returnBarEl.setAttribute('data-ag-i18n-ignore', '1');

      const dot = document.createElement('span');
      dot.className = 'ag-ps-return-dot';
      dot.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'ag-ps-return-text';
      text.textContent = mode === 'home'
        ? '检测到刚重启回到首页 · 可一键返回上次会话'
        : '检测到位于设置页 · 可快速返回上次会话';

      const badge = document.createElement('span');
      badge.className = 'ag-ps-return-badge';
      badge.textContent = formatShortConvBadge(savedPath);

      returnBarCountdownEl = document.createElement('span');
      returnBarCountdownEl.className = 'ag-ps-return-countdown';

      const actions = document.createElement('div');
      actions.className = 'ag-ps-return-actions';

      const primaryBtn = document.createElement('button');
      primaryBtn.type = 'button';
      primaryBtn.className = 'ag-ps-return-btn-primary';
      primaryBtn.textContent = '返回上次会话 ↩';
      primaryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigateToSavedConv(savedPath);
      }, { signal: barSignal });

      const relayBtn = document.createElement('button');
      relayBtn.type = 'button';
      relayBtn.className = 'ag-ps-return-btn-ghost';
      relayBtn.textContent = '⚡ 账号接力';
      relayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof bus.openWorkbench === 'function') {
          bus.openWorkbench('accounts');
        }
      }, { signal: barSignal });

      const stayBtn = document.createElement('button');
      stayBtn.type = 'button';
      stayBtn.className = 'ag-ps-return-btn-ghost';
      stayBtn.textContent = mode === 'home' ? '留在首页' : '留在设置';
      stayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (mode === 'home') fxVisitState.homeReturnDismissed = true;
        else returnBarDismissedForVisit = true;
        removeReturnBar();
      }, { signal: barSignal });

      actions.appendChild(primaryBtn);
      actions.appendChild(relayBtn);
      actions.appendChild(stayBtn);

      returnBarEl.appendChild(dot);
      returnBarEl.appendChild(text);
      returnBarEl.appendChild(badge);
      returnBarEl.appendChild(returnBarCountdownEl);
      returnBarEl.appendChild(actions);
      document.body.appendChild(returnBarEl);

      if (allowAutoCountdown && getPrefs().switchAutoReturn && !document.hidden && !hasOpenModalDialog()) {
        startReturnCountdown(savedPath);
      }
    }

    function isSafeOnboardingTextMatch(rawText) {
      const norm = String(rawText || '').replace(/\s+/g, ' ').trim();
      if (!norm || norm.length > 1800) return false;
      // Never auto-dismiss destructive, permission, or OAuth/account-access consent prompts
      if (/\b(delete|remove|uninstall|reset|overwrite|format|revoke|authorize|permission|oauth|allow access|grant access)\b|删除|移除|卸载|重置|格式化|覆盖|吊销|授权|允许访问/i.test(norm)) {
        return false;
      }
      const matchesEn =
        norm.includes('One last thing before getting started') &&
        norm.includes('You are in control');
      const matchesZh =
        (norm.includes('开始使用前的最后一步') || norm.includes('开始前的最后一步')) &&
        /由[你您]掌控/.test(norm);
      return matchesEn || matchesZh;
    }

    function hasRecentAccountSwitchTimestamp(maxAgeMs = 300000) {
      const now = Date.now();
      const checkTs = (raw) => {
        const ts = Number(raw);
        return Number.isFinite(ts) && ts > 0 && now - ts >= -60000 && now - ts <= maxAgeMs;
      };
      try {
        if (checkTs(localStorage.getItem('ag_prism_last_account_switch_at'))) return true;
      } catch {}
      try {
        const sumRaw = localStorage.getItem('ag_prism_account_summary_v1');
        if (sumRaw) {
          const sum = JSON.parse(sumRaw);
          if (sum && sum.pendingSwitchEmail && checkTs(sum.updatedAt)) return true;
        }
      } catch {}
      if (canUseHostCookie()) {
        try {
          const prefix = 'ag_prism_last_sw=';
          for (const part of String(document.cookie || '').split(';')) {
            const seg = part.trim();
            if (seg.startsWith(prefix) && checkTs(decodeURIComponent(seg.slice(prefix.length)))) {
              return true;
            }
          }
        } catch {}
      }
      return false;
    }

    function tryDismissOnboardingDialog() {
      const now = Date.now();
      if (now - lastOnboardingDismissAt < 1200) return false;
      if (!hasRecentAccountSwitchTimestamp(300000)) return false;

      const candidates = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"]');

      for (let i = 0; i < candidates.length; i++) {
        const d = candidates[i];
        if (!d || !d.isConnected) continue;
        if (d.hidden || d.getAttribute('aria-hidden') === 'true') continue;
        if (d.closest('.monaco-editor, pre, code, [data-testid*="message"], #ag-ps-panel, iframe, webview, [data-mcp-app]')) continue;
        if (d.offsetWidth <= 0 && d.offsetHeight <= 0 && d.getClientRects().length === 0) continue;
        if (!isSafeOnboardingTextMatch(d.textContent)) continue;

        const buttons = d.querySelectorAll('button, [role="button"]');
        for (let j = 0; j < buttons.length; j++) {
          const btn = buttons[j];
          if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
          if (btn.getAttribute('role') === 'checkbox' || btn.getAttribute('role') === 'switch') continue;
          const bTxt = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (/^(Continue|继续|繼續)$/i.test(bTxt)) {
            lastOnboardingDismissAt = now;
            try { btn.click(); } catch {}
            safeToast('已自动确认 Antigravity 登录欢迎框');
            if (onboardingRetryTimer) clearTimeout(onboardingRetryTimer);
            onboardingRetryTimer = setTimeout(() => {
              onboardingRetryTimer = 0;
              if (!disposed) syncSwitchReturnHelper();
            }, 220);
            return true;
          }
        }
      }
      return false;
    }

    // Cold-start / post-account-switch onboarding watcher (catches delayed OAuth modal hydration within 22s, then self-terminates)
    let startupOnboardingPollCount = 0;
    let startupOnboardingPollTimer = setInterval(() => {
      startupOnboardingPollCount++;
      if (disposed || startupOnboardingPollCount > 48) {
        clearInterval(startupOnboardingPollTimer);
        startupOnboardingPollTimer = 0;
        return;
      }
      if (!getPrefs().autoDismissOnboarding) return;
      if (tryDismissOnboardingDialog()) {
        clearInterval(startupOnboardingPollTimer);
        startupOnboardingPollTimer = 0;
      }
    }, 450);
    onCleanup(() => {
      if (startupOnboardingPollTimer) {
        clearInterval(startupOnboardingPollTimer);
        startupOnboardingPollTimer = 0;
      }
    });

    function syncSwitchReturnHelper() {
      if (getPrefs().autoDismissOnboarding) {
        tryDismissOnboardingDialog();
      }
      const pathname = window.location.pathname || '';
      if (isSafeConvPath(pathname)) {
        fxVisitState.hasVisitedConvInWindow = true;
        saveLastConversationPath(pathname);
        wasOnSettingsRoute = false;
        returnBarDismissedForVisit = false;
        removeReturnBar();
        return;
      }

      const prefs = getPrefs();
      if (!prefs.switchReturnHelper) {
        wasOnSettingsRoute = false;
        removeReturnBar();
        return;
      }

      const onSettings = SETTINGS_ROUTE_RE.test(pathname);
      if (onSettings) {
        if (!wasOnSettingsRoute) {
          wasOnSettingsRoute = true;
          returnBarDismissedForVisit = false;
        }
        if (returnBarDismissedForVisit) {
          removeReturnBar();
          return;
        }
        const rec = loadLastConversationRecord();
        if (!rec || rec.path === pathname) {
          removeReturnBar();
          return;
        }
        mountReturnBar(rec.path, 'settings');
        return;
      }

      wasOnSettingsRoute = false;
      returnBarDismissedForVisit = false;

      // Fresh client restart landing on Home ('/') — offer 1-click return without auto-redirecting
      if (isHomeWelcomeRoute(pathname) && !fxVisitState.hasVisitedConvInWindow && !fxVisitState.homeReturnDismissed) {
        if (typeof bus.isTyping === 'function' && bus.isTyping()) {
          fxVisitState.homeReturnDismissed = true;
          removeReturnBar();
          return;
        }
        const rec = loadLastConversationRecord();
        if (rec && Date.now() - rec.ts <= HOME_RETURN_MAX_AGE_MS) {
          mountReturnBar(rec.path, 'home');
          return;
        }
      }

      removeReturnBar();
    }

    /* ========================================================================
     * 10c. 5h / 7d Quota Handoff Nudge (Live Bus Quota + 30m Session Cooldown)
     * ======================================================================== */
    const QUOTA_NUDGE_DISMISS_KEY = 'ag_prism_quota_nudge_dismiss_v1';
    const QUOTA_NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
    const HANDOFF_PROMPT_TEXT = '准备切号：请按固定 4 要素整理当前交接记录并写入 memory（1. 槽位标识与精确时间戳；2. 实际工作目录；3. Git 分支、最新 commit 及未提交改动；4. 已通过的验证证据与下一步直接动作）。';

    let quotaNudgeEl = null;
    let quotaNudgeAc = null;
    let quotaNudgeSig = '';
    const quotaNudgeDismissMem = Object.create(null);

    function quotaDismissScopeKey(winKey, accountEmail) {
      const acct = String(accountEmail || '').trim().toLowerCase() || '__dom__';
      return JSON.stringify([acct, String(winKey || '')]);
    }

    function readQuotaDismissTs(winKey, accountEmail) {
      const scopeKey = quotaDismissScopeKey(winKey, accountEmail);
      let ts = quotaNudgeDismissMem[scopeKey] || 0;
      try {
        const raw = sessionStorage.getItem(QUOTA_NUDGE_DISMISS_KEY);
        if (raw) {
          const map = JSON.parse(raw);
          const stored = Number(map && map[scopeKey]);
          if (Number.isFinite(stored) && stored > ts) ts = stored;
        }
      } catch {}
      return ts;
    }

    function isQuotaNudgeDismissed(winKey, accountEmail) {
      const ts = readQuotaDismissTs(winKey, accountEmail);
      return ts > 0 && Date.now() - ts < QUOTA_NUDGE_COOLDOWN_MS;
    }

    function markQuotaNudgeDismissed(winKey, accountEmail) {
      const scopeKey = quotaDismissScopeKey(winKey, accountEmail);
      const now = Date.now();
      quotaNudgeDismissMem[scopeKey] = now;
      try {
        let map = {};
        const raw = sessionStorage.getItem(QUOTA_NUDGE_DISMISS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') map = parsed;
        }
        map[scopeKey] = now;
        sessionStorage.setItem(QUOTA_NUDGE_DISMISS_KEY, JSON.stringify(map));
      } catch {}
    }

    function formatQuotaPct(n) {
      const rounded = Math.round(n * 10) / 10;
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    }

    function copyHandoffPrompt() {
      const onDone = (ok) => {
        safeToast(ok ? '已复制切号交接指令，粘贴发送即可' : '复制失败，请手动输入“准备切号”');
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(HANDOFF_PROMPT_TEXT).then(
          () => onDone(true),
          () => {
            onDone(fallbackCopyText(HANDOFF_PROMPT_TEXT));
          }
        );
        return;
      }
      onDone(fallbackCopyText(HANDOFF_PROMPT_TEXT));
    }

    function fallbackCopyText(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return Boolean(ok);
      } catch {
        return false;
      }
    }

    let quotaNudgeLeaveTimer = 0;
    let leavingQuotaNudgeEl = null;

    function clearLeavingQuotaNudge() {
      if (quotaNudgeLeaveTimer) {
        clearTimeout(quotaNudgeLeaveTimer);
        quotaNudgeLeaveTimer = 0;
      }
      if (leavingQuotaNudgeEl) {
        leavingQuotaNudgeEl.remove();
        leavingQuotaNudgeEl = null;
      }
    }

    function positionQuotaNudge() {
      if (!quotaNudgeEl || !quotaNudgeEl.isConnected) return;
      const winW = window.innerWidth || 1280;
      const winH = window.innerHeight || 800;
      const nudgeW = Math.round(quotaNudgeEl.offsetWidth || 340);
      const nudgeH = Math.round(quotaNudgeEl.offsetHeight || 40);

      let rightPx = 18;
      let bottomPx = 18;

      // 1. Shift left of visible right-side Overview panel when main pane has room
      const ovPanel = getVisibleOverviewPanel();
      if (ovPanel) {
        const ovRect = ovPanel.getBoundingClientRect();
        if (ovRect.width > 40 && ovRect.left > winW * 0.35 && ovRect.bottom > winH - 220) {
          const candRight = Math.round(winW - ovRect.left + 14);
          if (winW - candRight - nudgeW >= 12) {
            rightPx = Math.max(rightPx, candRight);
          }
        }
      }

      const nudgeRight = winW - rightPx;
      const nudgeLeft = Math.max(12, nudgeRight - nudgeW);

      // 2. Lift above bottom composer ([id="antigravity.agentSidePanelInputBox"]) with 10px clearance if overlapping
      const inputBox = safeGetOrbHostEl();
      if (inputBox && inputBox.isConnected) {
        const br = inputBox.getBoundingClientRect();
        if (br.width > 0 && br.height > 0) {
          const horizOverlap = nudgeRight > br.left - 8 && nudgeLeft < br.right + 8;
          const curTop = winH - bottomPx - nudgeH;
          const curBottom = winH - bottomPx;
          const vertOverlap = curBottom > br.top - 10 && curTop < br.bottom + 10;
          if (horizOverlap && vertOverlap) {
            bottomPx = Math.max(bottomPx, Math.round(winH - br.top + 10));
          }
        }
      }

      // 3. Lift above visible jump toast (#ag-ps-jump-toast[data-show="1"]) with 10px clearance if overlapping
      const toastEl = document.querySelector('#ag-ps-jump-toast[data-show="1"]');
      if (toastEl && toastEl.isConnected) {
        const tr = toastEl.getBoundingClientRect();
        if (tr.width > 0 && tr.height > 0) {
          const horizOverlap = nudgeRight > tr.left - 8 && nudgeLeft < tr.right + 8;
          const curTop = winH - bottomPx - nudgeH;
          const curBottom = winH - bottomPx;
          const vertOverlap = curBottom > tr.top - 10 && curTop < tr.bottom + 10;
          if (horizOverlap && vertOverlap) {
            bottomPx = Math.max(bottomPx, Math.round(winH - tr.top + 10));
          }
        }
      }

      const maxBottom = Math.max(18, winH - nudgeH - 56);
      bottomPx = Math.max(18, Math.min(maxBottom, Math.round(bottomPx)));
      rightPx = Math.max(12, Math.min(Math.max(12, winW - nudgeW - 12), Math.round(rightPx)));

      quotaNudgeEl.style.right = `${rightPx}px`;
      quotaNudgeEl.style.bottom = `${bottomPx}px`;
    }

    function removeQuotaNudge(immediate = false) {
      if (quotaNudgeAc) {
        quotaNudgeAc.abort();
        quotaNudgeAc = null;
      }
      quotaNudgeSig = '';

      if (immediate || disposed || isEffectivelyReducedMotion() || document.hidden) {
        clearLeavingQuotaNudge();
        if (quotaNudgeEl) {
          quotaNudgeEl.remove();
          quotaNudgeEl = null;
        }
        return;
      }

      if (!quotaNudgeEl) return;
      clearLeavingQuotaNudge();
      const el = quotaNudgeEl;
      quotaNudgeEl = null;
      if (!el.isConnected) {
        el.remove();
        return;
      }
      leavingQuotaNudgeEl = el;
      setAttr(el, 'data-leaving', '1');
      quotaNudgeLeaveTimer = setTimeout(() => {
        quotaNudgeLeaveTimer = 0;
        if (leavingQuotaNudgeEl === el) leavingQuotaNudgeEl = null;
        if (el.isConnected) el.remove();
      }, 150);
    }

    function mountQuotaNudge(winKey, pct, accountEmail = '') {
      if (!document.body) return;
      const pctStr = formatQuotaPct(pct);
      const acct = String(accountEmail || '').trim().toLowerCase() || 'active';
      const sig = `${acct}:${winKey}:${pctStr}`;
      if (quotaNudgeEl && quotaNudgeEl.isConnected && quotaNudgeSig === sig) {
        positionQuotaNudge();
        return;
      }

      clearLeavingQuotaNudge();
      removeQuotaNudge(true);
      quotaNudgeAc = new AbortController();
      const nudgeSignal = quotaNudgeAc.signal;
      quotaNudgeSig = sig;

      quotaNudgeEl = document.createElement('div');
      quotaNudgeEl.id = 'ag-ps-quota-nudge';
      quotaNudgeEl.setAttribute('role', 'status');
      quotaNudgeEl.setAttribute('data-tier', winKey);
      quotaNudgeEl.setAttribute('data-ag-i18n-ignore', '1');

      const dot = document.createElement('span');
      dot.className = 'ag-ps-nudge-dot';
      dot.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'ag-ps-nudge-text';
      text.textContent = winKey === '7d'
        ? `7d 额度仅剩 ${pctStr}% · 建议保存交接后切备用号`
        : `5h 额度仅剩 ${pctStr}% · 可先切换另一模型家族继续`;

      const actions = document.createElement('div');
      actions.className = 'ag-ps-nudge-actions';

      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'ag-ps-nudge-btn-switch';
      switchBtn.textContent = '⚡ 去切号';
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof bus.openWorkbench === 'function') {
          bus.openWorkbench('accounts');
        }
      }, { signal: nudgeSignal });
      actions.appendChild(switchBtn);

      if (winKey === '7d') {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'ag-ps-nudge-btn-copy';
        copyBtn.textContent = '复制交接指令';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyHandoffPrompt();
        }, { signal: nudgeSignal });
        actions.appendChild(copyBtn);
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ag-ps-nudge-btn-close';
      closeBtn.textContent = '关闭';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        markQuotaNudgeDismissed(winKey, accountEmail);
        removeQuotaNudge();
      }, { signal: nudgeSignal });
      actions.appendChild(closeBtn);

      quotaNudgeEl.appendChild(dot);
      quotaNudgeEl.appendChild(text);
      quotaNudgeEl.appendChild(actions);
      document.body.appendChild(quotaNudgeEl);
      positionQuotaNudge();
    }

    function syncQuotaHandoffNudge() {
      const prefs = getPrefs();
      if (!prefs.quotaHandoffAlert) {
        removeQuotaNudge();
        return;
      }
      const q = safeGetQuotaState();
      const pct7d = typeof q.pct7d === 'number' && Number.isFinite(q.pct7d) ? q.pct7d : null;
      const pct5h = typeof q.pct5h === 'number' && Number.isFinite(q.pct5h) ? q.pct5h : null;
      const acctEmail = typeof q.accountEmail === 'string' ? q.accountEmail : '';

      if (pct7d !== null && pct7d <= 5) {
        if (!isQuotaNudgeDismissed('7d', acctEmail)) {
          mountQuotaNudge('7d', pct7d, acctEmail);
          return;
        }
      } else if (pct5h !== null && pct5h <= 10) {
        if (!isQuotaNudgeDismissed('5h', acctEmail)) {
          mountQuotaNudge('5h', pct5h, acctEmail);
          return;
        }
      }
      removeQuotaNudge();
    }

    /* ========================================================================
     * 10.5 Semantic 0fps Edge Afterglow & Compact Composer Quota Micro-Capsule
     * ======================================================================== */
    let afterglowHost = null;
    let afterglowDoneUntil = 0;
    let afterglowClearTimer = 0;
    let afterglowDismissedTurnSig = '';
    let quotaChipEl = null;
    let quotaChipDotEl = null;
    let quotaChipTextEl = null;
    let quotaChipAc = null;
    let lastQuotaChipSig = '';
    let lastQuotaChipTip = '';

    function formatRelativeResetShort(isoStr, nowMs) {
      if (!isoStr || typeof isoStr !== 'string') return '';
      const targetMs = Date.parse(isoStr);
      if (!Number.isFinite(targetMs)) return '';
      const diffMs = targetMs - nowMs;
      if (diffMs <= 60_000) return '即将重置';
      const totalMins = Math.round(diffMs / 60_000);
      if (totalMins < 60) return `${totalMins}m 后重置`;
      const totalHours = Math.floor(totalMins / 60);
      const remMins = totalMins % 60;
      if (totalHours < 24) return remMins > 0 ? `${totalHours}h${remMins}m 后重置` : `${totalHours}h 后重置`;
      const days = Math.floor(totalHours / 24);
      const remHours = totalHours % 24;
      return remHours > 0 ? `${days}d${remHours}h 后重置` : `${days}d 后重置`;
    }

    function clearAfterglowHost() {
      if (afterglowClearTimer) {
        clearTimeout(afterglowClearTimer);
        afterglowClearTimer = 0;
      }
      if (afterglowHost) {
        try { afterglowHost.removeAttribute('data-ag-ps-afterglow'); } catch {}
        afterglowHost = null;
      }
    }

    function detectViewportAttentionState() {
      const vp = safeGetViewportEl();
      if (!vp) return { state: '', sig: '' };
      // Check visible pending confirmation / interactive question cards near bottom of viewport
      const decisionEl = vp.querySelector(
        '[data-testid*="approval" i], [data-testid*="permission" i], [data-testid="proceed-button"], [data-testid*="question" i] button:not([disabled])'
      );
      if (decisionEl && decisionEl.isConnected) {
        const r = decisionEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const sig = `decision:${(decisionEl.textContent || '').trim().slice(0, 32)}`;
          return { state: 'decision', sig };
        }
      }
      const errNodes = vp.querySelectorAll('[data-testid*="error-banner" i], [data-testid*="agent-error" i]');
      if (errNodes.length) {
        const lastErr = errNodes[errNodes.length - 1];
        const r = lastErr.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const sig = `error:${(lastErr.textContent || '').trim().slice(0, 32)}`;
          return { state: 'error', sig };
        }
      }
      return { state: '', sig: '' };
    }

    function syncSemanticAfterglow(nowMs) {
      const prefs = getPrefs();
      const fxMode = resolveComposerBorderFx(prefs);
      const previewStage = getComposerPreviewStage(nowMs);
      const host = safeGetComposerEl() || safeGetOrbHostEl();
      if (!host || !host.isConnected) {
        clearAfterglowHost();
        return;
      }
      if (afterglowHost && afterglowHost !== host) {
        try { afterglowHost.removeAttribute('data-ag-ps-afterglow'); } catch {}
      }
      afterglowHost = host;

      if (previewStage === 'decision' || previewStage === 'done') {
        setAttr(host, 'data-ag-ps-afterglow', previewStage);
        return;
      }
      if (previewStage === 'beam') {
        setAttr(host, 'data-ag-ps-afterglow', '');
        return;
      }

      if (fxMode === 'off' || prefs.semanticAfterglow === false) {
        afterglowDoneUntil = 0;
        clearAfterglowHost();
        return;
      }

      if (lastBusy || safeIsTyping()) {
        afterglowDismissedTurnSig = '';
        afterglowDoneUntil = 0;
        setAttr(host, 'data-ag-ps-afterglow', '');
        return;
      }

      const attn = detectViewportAttentionState();
      let wantState = '';
      if (attn.state && attn.sig !== afterglowDismissedTurnSig) {
        if (attn.sig !== afterglowLastAttnSig) {
          afterglowLastAttnSig = attn.sig;
          afterglowTriggeredAt = nowMs;
        }
        wantState = attn.state;
      } else if (nowMs < afterglowDoneUntil) {
        wantState = 'done';
      }

      setAttr(host, 'data-ag-ps-afterglow', wantState);
    }

    let afterglowTriggeredAt = 0;
    let afterglowLastAttnSig = '';

    function dismissAfterglowOnNewInteraction() {
      if (disposed || !afterglowHost) return;
      const now = Date.now();
      if (now < composerPreviewUntil) return;
      if (now - afterglowTriggeredAt < 120) return;
      const attn = detectViewportAttentionState();
      if (attn.sig) afterglowDismissedTurnSig = attn.sig;
      afterglowDoneUntil = 0;
      clearAfterglowHost();
      syncQuotaRingSuppression(now);
    }

    document.addEventListener('pointerdown', (e) => {
      if (disposed || !afterglowHost) return;
      const t = e && e.target;
      if (t && typeof t.closest === 'function' && afterglowHost.contains(t)) {
        dismissAfterglowOnNewInteraction();
      }
    }, { signal, passive: true });

    document.addEventListener('keydown', (e) => {
      if (disposed || !afterglowHost || !e) return;
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      const t = e.target;
      if (t && afterglowHost.contains(t)) {
        dismissAfterglowOnNewInteraction();
      }
    }, { signal, passive: true });

    function removeCompactQuotaChip() {
      if (quotaChipAc) {
        quotaChipAc.abort();
        quotaChipAc = null;
      }
      if (quotaChipEl) {
        quotaChipEl.remove();
        quotaChipEl = null;
        quotaChipDotEl = null;
        quotaChipTextEl = null;
      }
      lastQuotaChipSig = '';
      lastQuotaChipTip = '';
    }

    function ensureCompactQuotaChip(anchorEl) {
      if (!anchorEl || !anchorEl.parentElement) return null;
      if (quotaChipEl && quotaChipEl.isConnected && anchorEl.nextElementSibling === quotaChipEl) {
        return quotaChipEl;
      }
      if (!quotaChipEl) {
        quotaChipAc = new AbortController();
        const chipSig = quotaChipAc.signal;
        quotaChipEl = document.createElement('button');
        quotaChipEl.id = 'ag-ps-quota-chip';
        quotaChipEl.type = 'button';
        quotaChipEl.className = 'ag-ps-quota-chip';
        quotaChipEl.setAttribute('data-no-drag', '');
        quotaChipEl.setAttribute('data-ag-i18n-ignore', '1');
        quotaChipEl.setAttribute('aria-label', '5h 与周额度概览');

        quotaChipDotEl = document.createElement('span');
        quotaChipDotEl.className = 'ag-ps-quota-chip-dot';
        quotaChipTextEl = document.createElement('span');
        quotaChipTextEl.className = 'ag-ps-quota-chip-text';

        quotaChipEl.appendChild(quotaChipDotEl);
        quotaChipEl.appendChild(quotaChipTextEl);

        quotaChipEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const ctxRing = document.getElementById('ag-claude-ctx-ring');
          if (!e.shiftKey && ctxRing) {
            ctxRing.click();
          } else if (typeof bus.openWorkbench === 'function') {
            bus.openWorkbench('accounts');
          }
        }, { signal: chipSig });
      }
      if (anchorEl.nextElementSibling !== quotaChipEl) {
        anchorEl.insertAdjacentElement('afterend', quotaChipEl);
      }
      return quotaChipEl;
    }

    function syncCompactQuotaChip(nowMs) {
      const prefs = getPrefs();
      if (prefs.compactQuotaPill === false) {
        removeCompactQuotaChip();
        return;
      }
      const inputBox = safeGetOrbHostEl() || safeGetComposerEl();
      if (!inputBox || !inputBox.isConnected) {
        removeCompactQuotaChip();
        return;
      }
      // Anchor right after #ag-claude-ctx-ring (zero order conflict with custom.js)
      let anchor = inputBox.querySelector('#ag-claude-ctx-ring');
      if (!anchor) {
        const modelBtn = inputBox.querySelector('button[data-testid="model-selector-trigger"]');
        if (modelBtn) {
          const bar = modelBtn.closest('div.flex.min-w-0.flex-1.items-center') || modelBtn.parentElement;
          if (bar) {
            let cur = modelBtn;
            while (cur && cur.parentElement && cur.parentElement !== bar) cur = cur.parentElement;
            if (cur && cur.parentElement === bar) anchor = cur;
          }
        }
      }
      if (!anchor) {
        removeCompactQuotaChip();
        return;
      }

      const q = safeGetQuotaState();
      const p5 = typeof q.pct5h === 'number' && Number.isFinite(q.pct5h) ? Math.round(q.pct5h) : null;
      const p7 = typeof q.pct7d === 'number' && Number.isFinite(q.pct7d) ? Math.round(q.pct7d) : null;
      if (p5 === null && p7 === null) {
        lastQuotaChipSig = '';
        if (quotaChipEl) setAttr(quotaChipEl, 'data-visible', '0');
        return;
      }

      const chip = ensureCompactQuotaChip(anchor);
      if (!chip) return;

      const minVal = p5 !== null && p7 !== null ? Math.min(p5, p7) : (p5 !== null ? p5 : p7);
      const tier = (p7 !== null && p7 <= 5) || minVal <= 10
        ? 'danger'
        : minVal <= 25
          ? 'warn'
          : 'ok';

      const labelParts = [];
      if (p5 !== null) labelParts.push(`5h ${p5}%`);
      if (p7 !== null) labelParts.push(`7d ${p7}%`);
      const labelText = labelParts.join(' · ');
      const nextSig = `${labelText}|${tier}`;

      if (nextSig !== lastQuotaChipSig || chip.getAttribute('data-visible') !== '1') {
        lastQuotaChipSig = nextSig;
        if (quotaChipTextEl) quotaChipTextEl.textContent = labelText;
        setAttr(chip, 'data-tier', tier);
        setAttr(chip, 'data-visible', '1');
      }

      // Keep aria-label concise without hover tooltip so clicking opens unified quota popover cleanly without overlapping black tip
      const r5Rel = formatRelativeResetShort(q.reset5hAt, nowMs);
      const r7Rel = formatRelativeResetShort(q.reset7dAt, nowMs);
      const tipSegs = [];
      if (p5 !== null) tipSegs.push(`5h 剩余 ${p5}%${r5Rel ? ` (${r5Rel})` : ''}`);
      if (p7 !== null) tipSegs.push(`周额度剩余 ${p7}%${r7Rel ? ` (${r7Rel})` : ''}`);
      tipSegs.push('点击查看限额详情 · Shift+点击打开账号接力');
      const nextTip = tipSegs.join(' ｜ ');
      if (nextTip !== lastQuotaChipTip) {
        lastQuotaChipTip = nextTip;
        setAttr(chip, 'aria-label', nextTip);
        if (chip.hasAttribute('data-ag-ps-tip')) chip.removeAttribute('data-ag-ps-tip');
      }
    }

    /* ========================================================================
     * 10.6 Composer Intent Prediction (Tab Next-Prompt Ghost, Memory-Only)
     * ======================================================================== */
    const INTENT_FALLBACK_PROMPT = '继续检查还有没有细节需要优化';
    const intentCacheByConv = new Map(); // pathname -> { turnCount, suggestion, dismissed }
    let wasBusyForIntent = false;
    let lastIntentConvKey = String(window.location.pathname || '');
    let intentSeq = 0;
    let intentGraceTimer = 0;
    let intentLoadingTimer = 0;
    let intentCompEndTimer = 0;
    let intentInFlight = false;
    let intentInFlightConv = '';
    let intentComposing = false;
    let intentGhostEl = null;
    let intentGhostTextEl = null;
    let intentGhostKbdEl = null;
    let intentGhostHost = null;
    let intentGhostHostSetRel = false;
    let intentOpenBoxEl = null;
    let lastIntentAcceptAt = 0;

    function setIntentConvEntry(convKey, entry) {
      if (!convKey) return;
      if (intentCacheByConv.has(convKey)) {
        intentCacheByConv.delete(convKey);
      } else if (intentCacheByConv.size >= 20) {
        const oldest = intentCacheByConv.keys().next().value;
        if (oldest !== undefined) intentCacheByConv.delete(oldest);
      }
      intentCacheByConv.set(convKey, entry);
    }

    function getComposerEditable(boxEl) {
      if (!boxEl || typeof boxEl.querySelector !== 'function') return null;
      return boxEl.querySelector('[data-lexical-editor="true"], [contenteditable="true"], textarea');
    }

    function isComposerEmpty(boxEl) {
      const ed = getComposerEditable(boxEl);
      if (!ed || intentComposing) return false;
      if (ed.querySelector && ed.querySelector('[data-lexical-decorator="true"], img')) return false;
      const raw = (ed.value !== undefined ? ed.value : ed.textContent) || '';
      return raw.replace(/\u200B|\n/g, '').trim().length === 0;
    }

    function extractCleanMessageText(rootEl) {
      if (!rootEl) return '';
      if (typeof rootEl.cloneNode === 'function') {
        try {
          const clone = rootEl.cloneNode(true);
          if (typeof clone.querySelectorAll === 'function') {
            const drop = clone.querySelectorAll(
              'style, script, noscript, template, svg, [data-testid*="thinking"], .ag-bilingual-thought'
            );
            for (let i = 0; i < drop.length; i++) drop[i].remove();
            const blocks = clone.querySelectorAll('br, p, li, pre, h1, h2, h3, h4, blockquote, tr');
            for (let i = 0; i < blocks.length; i++) {
              const b = blocks[i];
              if (b.tagName === 'BR') b.replaceWith('\n');
              else b.append('\n');
            }
          }
          return (clone.textContent || '')
            .replace(/[ \t\f\v]+/g, ' ')
            .replace(/ *\n */g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
        } catch {}
      }
      return (rootEl.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function hasVisibleAncestorChain(el) {
      let cur = el ? el.parentElement : null;
      for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
        if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return false;
        const st = window.getComputedStyle ? window.getComputedStyle(cur) : null;
        if (st && (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0)) {
          return false;
        }
      }
      return true;
    }

    function hasVisibleComposerPopup() {
      const popups = document.querySelectorAll(
        '[role="listbox"], [data-lexical-menu], [data-radix-popper-content-wrapper] [role="option"]'
      );
      for (let i = 0; i < popups.length; i++) {
        if (isElementActuallyVisible(popups[i], 8) && hasVisibleAncestorChain(popups[i])) return true;
      }
      return false;
    }

    function extractIntentTurnContext() {
      const nav = safeGetConversationNav();
      const domTurns = nav && Array.isArray(nav.domTurns) && nav.domTurns.length ? nav.domTurns : getUserTurns();
      const rawTurns = nav && nav.total > 0 ? nav.total : domTurns.length;
      let lastUserText = '';
      if (domTurns.length > 0) {
        lastUserText = extractCleanMessageText(domTurns[domTurns.length - 1]) || getTurnPreviewText(domTurns[domTurns.length - 1]);
      } else if (nav && nav.total > 0 && typeof nav.getPreview === 'function') {
        lastUserText = nav.getPreview(nav.total - 1) || '';
      }

      const vp = safeGetViewportEl() || document;
      const pickLastCleanText = (nodeList) => {
        for (let i = nodeList.length - 1; i >= 0; i--) {
          const rn = nodeList[i];
          if (!rn || !rn.isConnected) continue;
          if (
            rn.closest &&
            rn.closest('[data-testid="user-message"], [data-testid="user-input-step"], [data-testid="thinking-collapsible"], [data-testid*="thinking"]')
          ) {
            continue;
          }
          const txt = extractCleanMessageText(rn);
          if (txt) return txt.slice(-1600);
        }
        return '';
      };

      let lastAssistantText = pickLastCleanText(vp.querySelectorAll('[data-testid="agent-response"]'));
      if (!lastAssistantText) {
        lastAssistantText = pickLastCleanText(vp.querySelectorAll('[data-testid="planner-response-text"]'));
      }
      if (!lastAssistantText) {
        lastAssistantText = pickLastCleanText(vp.querySelectorAll('[data-markdown-root]'));
      }

      const cleanUser = String(lastUserText || '').trim().slice(-1200);
      const turnCount = rawTurns > 0 ? rawTurns : (lastAssistantText ? 1 : 0);
      const contextSig = `${turnCount}|${cleanUser.slice(-96)}|${lastAssistantText.slice(-160)}`;
      return {
        turnCount,
        contextSig,
        lastUserText: cleanUser,
        lastAssistantText
      };
    }

    function cancelIntentInFlight() {
      ++intentSeq;
      intentInFlight = false;
      intentInFlightConv = '';
      if (intentGraceTimer) {
        clearTimeout(intentGraceTimer);
        intentGraceTimer = 0;
      }
      if (intentLoadingTimer) {
        clearTimeout(intentLoadingTimer);
        intentLoadingTimer = 0;
      }
    }

    function hideIntentGhost() {
      if (intentGhostEl) {
        setAttr(intentGhostEl, 'data-visible', '0');
        setAttr(intentGhostEl, 'data-loading', '');
      }
      if (intentOpenBoxEl) {
        intentOpenBoxEl.removeAttribute('data-ag-ps-intent-open');
        intentOpenBoxEl = null;
      }
    }

    function detachIntentGhostHost() {
      hideIntentGhost();
      if (intentGhostEl) {
        intentGhostEl.remove();
        intentGhostEl = null;
        intentGhostTextEl = null;
        intentGhostKbdEl = null;
      }
      if (intentGhostHost) {
        if (intentGhostHostSetRel && intentGhostHost.style) {
          intentGhostHost.style.removeProperty('position');
        }
        intentGhostHost = null;
        intentGhostHostSetRel = false;
      }
    }

    function teardownComposerIntent(clearCache = true) {
      cancelIntentInFlight();
      if (intentCompEndTimer) {
        clearTimeout(intentCompEndTimer);
        intentCompEndTimer = 0;
      }
      if (intentFallbackTimer) {
        clearTimeout(intentFallbackTimer);
        intentFallbackTimer = 0;
      }
      intentComposing = false;
      detachIntentGhostHost();
      if (clearCache) {
        intentCacheByConv.clear();
      }
    }

    let intentFallbackTimer = 0;

    function acceptIntentSuggestion(boxOverride = null) {
      const now = Date.now();
      if (now - lastIntentAcceptAt < 350) return false;
      const boxEl = boxOverride || safeGetComposerEl();
      if (!boxEl || !isComposerEmpty(boxEl)) return false;
      const convKey = String(window.location.pathname || '');
      const { contextSig } = extractIntentTurnContext();
      const entry = intentCacheByConv.get(convKey);
      const sug = entry && entry.contextSig === contextSig && !entry.dismissed ? entry.suggestion : '';
      if (!sug) return false;
      const ed = getComposerEditable(boxEl);
      if (!ed) return false;

      lastIntentAcceptAt = now;
      hideIntentGhost();

      ed.focus();
      if (ed.tagName === 'TEXTAREA' || ed.tagName === 'INPUT') {
        ed.value = sug;
        ed.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      try {
        const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
        if (sel && typeof document.createRange === 'function') {
          const range = document.createRange();
          range.selectNodeContents(ed);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch {}

      let execCalled = false;
      if (typeof document.execCommand === 'function') {
        try {
          document.execCommand('insertText', false, sug);
          execCalled = true;
        } catch {}
      }

      // Lexical reconciles EditorState -> DOM asynchronously on a microtask after execCommand('insertText').
      // Never inspect ed.textContent synchronously here or dispatch a second beforeinput in the same tick!
      const fallbackAfterReconcile = () => {
        intentFallbackTimer = 0;
        if (disposed || !ed.isConnected) return;
        const curTxt = (ed.textContent || '').replace(/\u200B|\n/g, '').trim();
        if (curTxt) return;
        let handledByBeforeInput = false;
        if (!execCalled && typeof InputEvent === 'function') {
          try {
            const ev = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: sug
            });
            handledByBeforeInput = ed.dispatchEvent(ev) === false;
          } catch {}
        }
        if (!handledByBeforeInput) {
          intentFallbackTimer = setTimeout(() => {
            intentFallbackTimer = 0;
            if (disposed || !ed.isConnected) return;
            if (!((ed.textContent || '').replace(/\u200B|\n/g, '').trim())) {
              ed.textContent = sug;
              ed.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, 0);
        }
      };

      if (intentFallbackTimer) clearTimeout(intentFallbackTimer);
      intentFallbackTimer = setTimeout(fallbackAfterReconcile, 24);
      return true;
    }

    function renderIntentGhost(boxEl, text, isLoading) {
      const ed = getComposerEditable(boxEl);
      const parent = ed && ed.parentElement;
      if (!boxEl || !ed || !parent || !text) {
        hideIntentGhost();
        return;
      }
      if (!intentGhostEl || intentGhostHost !== parent || !intentGhostEl.isConnected) {
        detachIntentGhostHost();
        intentGhostHost = parent;
        try {
          const pCs = getComputedStyle(parent);
          if (!parent.style.position && (!pCs || !pCs.position || pCs.position === 'static')) {
            parent.style.position = 'relative';
            intentGhostHostSetRel = true;
          }
        } catch {}
        intentGhostEl = document.createElement('div');
        intentGhostEl.className = 'ag-ps-intent-ghost';
        intentGhostEl.setAttribute('aria-hidden', 'true');
        intentGhostEl.setAttribute('data-ag-i18n-ignore', '1');
        const sparkEl = document.createElement('span');
        sparkEl.className = 'ag-ps-intent-spark';
        sparkEl.textContent = '✦';
        intentGhostTextEl = document.createElement('span');
        intentGhostTextEl.className = 'ag-ps-intent-text';
        intentGhostKbdEl = document.createElement('kbd');
        intentGhostKbdEl.className = 'ag-ps-intent-tab';
        intentGhostKbdEl.textContent = 'Tab';
        intentGhostKbdEl.title = '按 Tab 键或点击填入输入框（不会自动发送）';
        intentGhostKbdEl.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          acceptIntentSuggestion(boxEl);
        });
        intentGhostEl.appendChild(sparkEl);
        intentGhostEl.appendChild(intentGhostTextEl);
        intentGhostEl.appendChild(intentGhostKbdEl);
        parent.appendChild(intentGhostEl);
      }
      try {
        const cs = getComputedStyle(ed);
        const pt = parseFloat(cs.paddingTop) || 0;
        const pl = parseFloat(cs.paddingLeft) || 0;
        const pr = parseFloat(cs.paddingRight) || 0;
        const lh = parseFloat(cs.lineHeight) || 24;
        intentGhostEl.style.top = `${Math.round((ed.offsetTop || 0) + pt)}px`;
        intentGhostEl.style.left = `${Math.round((ed.offsetLeft || 0) + pl)}px`;
        intentGhostEl.style.right = `${Math.max(8, Math.round(pr + 8))}px`;
        intentGhostEl.style.height = `${Math.round(lh)}px`;
        if (cs.fontSize) intentGhostEl.style.fontSize = cs.fontSize;
        if (cs.lineHeight && cs.lineHeight !== 'normal') intentGhostEl.style.lineHeight = cs.lineHeight;
      } catch {}
      if (intentGhostTextEl && intentGhostTextEl.textContent !== text) {
        intentGhostTextEl.textContent = text;
      }
      if (intentGhostKbdEl) {
        intentGhostKbdEl.hidden = Boolean(isLoading);
      }
      if (intentOpenBoxEl && intentOpenBoxEl !== boxEl) {
        intentOpenBoxEl.removeAttribute('data-ag-ps-intent-open');
      }
      intentOpenBoxEl = boxEl;
      setAttr(boxEl, 'data-ag-ps-intent-open', '1');
      setAttr(intentGhostEl, 'data-loading', isLoading ? '1' : '');
      setAttr(intentGhostEl, 'data-visible', '1');
    }

    function syncIntentGhostVisibility(boxOverride = null) {
      if (
        disposed ||
        !getPrefs().composerIntentSuggest ||
        document.hidden ||
        !isConversationRoute() ||
        safeIsBusy() ||
        Date.now() - lastIntentAcceptAt < 350
      ) {
        hideIntentGhost();
        return;
      }
      const boxEl = boxOverride || safeGetComposerEl();
      if (!boxEl || !isComposerEmpty(boxEl)) {
        hideIntentGhost();
        return;
      }
      const convKey = String(window.location.pathname || '');
      const { contextSig } = extractIntentTurnContext();
      const entry = intentCacheByConv.get(convKey);
      if (entry && entry.contextSig === contextSig && !entry.dismissed && entry.suggestion) {
        renderIntentGhost(boxEl, entry.suggestion, false);
        return;
      }
      if (!intentInFlight || intentInFlightConv !== convKey) {
        hideIntentGhost();
      }
    }

    function runIntentPrediction() {
      intentGraceTimer = 0;
      if (disposed || !getPrefs().composerIntentSuggest || document.hidden || !isConversationRoute() || safeIsBusy()) {
        return;
      }
      const boxEl = safeGetComposerEl();
      if (!boxEl || !isComposerEmpty(boxEl)) {
        hideIntentGhost();
        return;
      }
      const convKey = String(window.location.pathname || '');
      const { turnCount, contextSig, lastUserText, lastAssistantText } = extractIntentTurnContext();
      if (turnCount < 1 || (!lastUserText && !lastAssistantText)) return;
      const existing = intentCacheByConv.get(convKey);
      if (existing && existing.contextSig === contextSig && (existing.suggestion || existing.dismissed)) {
        syncIntentGhostVisibility(boxEl);
        return;
      }
      const mySeq = ++intentSeq;
      intentInFlight = true;
      intentInFlightConv = convKey;
      if (intentLoadingTimer) clearTimeout(intentLoadingTimer);
      intentLoadingTimer = setTimeout(() => {
        intentLoadingTimer = 0;
        if (disposed || mySeq !== intentSeq || !intentInFlight) return;
        const curBox = safeGetComposerEl();
        if (curBox && isComposerEmpty(curBox) && !safeIsBusy()) {
          renderIntentGhost(curBox, '正在构思下一步建议…', true);
        }
      }, 160);

      const hasProjectRpc = typeof window.__agProjectCall === 'function';
      const reqPromise = hasProjectRpc
        ? Promise.resolve(window.__agProjectCall('predictNextPrompt', { lastUserText, lastAssistantText }, 6000))
        : Promise.resolve({ ok: true, suggestion: INTENT_FALLBACK_PROMPT });

      reqPromise
        .then((res) => {
          if (disposed || mySeq !== intentSeq) return;
          intentInFlight = false;
          if (intentLoadingTimer) {
            clearTimeout(intentLoadingTimer);
            intentLoadingTimer = 0;
          }
          let sug = '';
          if (typeof res === 'string') {
            sug = res;
          } else if (res && typeof res === 'object') {
            if (res.skipped) {
              hideIntentGhost();
              return;
            }
            if (res.ok !== false) {
              sug = String(res.suggestion || res.prompt || res.text || res.nextPrompt || '');
            }
          }
          sug = sug.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (!sug && !hasProjectRpc) {
            sug = INTENT_FALLBACK_PROMPT;
          }
          if (!sug || String(window.location.pathname || '') !== convKey) {
            hideIntentGhost();
            return;
          }
          const latestCtx = extractIntentTurnContext();
          setIntentConvEntry(convKey, {
            turnCount: Math.max(turnCount, latestCtx.turnCount),
            contextSig: latestCtx.contextSig || contextSig,
            suggestion: sug,
            dismissed: false
          });
          syncIntentGhostVisibility();
        })
        .catch(() => {
          if (disposed || mySeq !== intentSeq) return;
          intentInFlight = false;
          if (intentLoadingTimer) {
            clearTimeout(intentLoadingTimer);
            intentLoadingTimer = 0;
          }
          hideIntentGhost();
        });
    }

    function scheduleIntentPrediction(delayMs = 160) {
      if (disposed || !getPrefs().composerIntentSuggest) return;
      if (intentGraceTimer) clearTimeout(intentGraceTimer);
      intentGraceTimer = setTimeout(runIntentPrediction, delayMs);
    }

    function syncComposerIntent(busy, reason) {
      if (!getPrefs().composerIntentSuggest) {
        wasBusyForIntent = false;
        teardownComposerIntent(true);
        return;
      }
      const curConvKey = String(window.location.pathname || '');
      if (reason === 'route' || curConvKey !== lastIntentConvKey) {
        lastIntentConvKey = curConvKey;
        wasBusyForIntent = busy;
        cancelIntentInFlight();
        syncIntentGhostVisibility();
        return;
      }
      if (!isConversationRoute()) {
        wasBusyForIntent = false;
        cancelIntentInFlight();
        hideIntentGhost();
        return;
      }
      if (busy) {
        wasBusyForIntent = true;
        cancelIntentInFlight();
        hideIntentGhost();
        return;
      }
      if (wasBusyForIntent && !busy) {
        wasBusyForIntent = false;
        scheduleIntentPrediction(160);
        return;
      }
      if (reason === 'init' || reason === 'prefs') {
        const entry = intentCacheByConv.get(curConvKey);
        const { turnCount, contextSig } = extractIntentTurnContext();
        if (turnCount >= 1 && (!entry || entry.contextSig !== contextSig)) {
          scheduleIntentPrediction(140);
          return;
        }
      }
      syncIntentGhostVisibility();
    }

    function onIntentComposerActivate(e) {
      if (disposed || !getPrefs().composerIntentSuggest || document.hidden) return;
      const t = e && e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('.ag-ps-intent-tab')) return;
      const boxEl = t.closest('[id="antigravity.agentSidePanelInputBox"]');
      if (!boxEl || !isConversationRoute() || safeIsBusy()) return;
      if (!isComposerEmpty(boxEl)) {
        hideIntentGhost();
        return;
      }
      const convKey = String(window.location.pathname || '');
      const { turnCount, contextSig } = extractIntentTurnContext();
      if (turnCount < 1) return;
      const entry = intentCacheByConv.get(convKey);
      if (entry && entry.contextSig === contextSig) {
        if (!entry.dismissed && entry.suggestion) {
          syncIntentGhostVisibility(boxEl);
        }
        return;
      }
      if (!intentInFlight || intentInFlightConv !== convKey) {
        scheduleIntentPrediction(120);
      }
    }

    function onIntentKeyDown(e) {
      if (disposed || !e || e.defaultPrevented || !getPrefs().composerIntentSuggest) return;
      const boxEl = safeGetComposerEl();
      if (!boxEl) return;
      const activeInBox = Boolean(
        (e.target && boxEl.contains(e.target)) ||
        (document.activeElement && boxEl.contains(document.activeElement))
      );
      if (!activeInBox) return;

      if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
        cancelIntentInFlight();
        hideIntentGhost();
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (hasVisibleComposerPopup()) {
          return;
        }
        if (acceptIntentSuggestion(boxEl)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (e.key === 'Escape') {
        const ghostVisible = Boolean(intentGhostEl && intentGhostEl.getAttribute('data-visible') === '1');
        if (!ghostVisible && !intentInFlight && !intentGraceTimer) return;
        cancelIntentInFlight();
        const convKey = String(window.location.pathname || '');
        const { turnCount, contextSig } = extractIntentTurnContext();
        const prev = intentCacheByConv.get(convKey);
        setIntentConvEntry(convKey, {
          turnCount: Math.max(1, turnCount),
          contextSig,
          suggestion: prev && prev.contextSig === contextSig ? prev.suggestion : '',
          dismissed: true
        });
        hideIntentGhost();
      }
    }

    document.addEventListener('pointerdown', onIntentComposerActivate, { capture: true, passive: true, signal });
    document.addEventListener('focusin', onIntentComposerActivate, { capture: true, passive: true, signal });
    document.addEventListener('keydown', onIntentKeyDown, { capture: true, signal });
    document.addEventListener('compositionstart', (e) => {
      if (disposed || !getPrefs().composerIntentSuggest) return;
      const boxEl = e && e.target && e.target.closest ? e.target.closest('[id="antigravity.agentSidePanelInputBox"]') : null;
      if (!boxEl) return;
      intentComposing = true;
      cancelIntentInFlight();
      syncIntentGhostVisibility(boxEl);
    }, { capture: true, passive: true, signal });
    document.addEventListener('compositionend', (e) => {
      if (!intentComposing) {
        const boxEl = e && e.target && e.target.closest ? e.target.closest('[id="antigravity.agentSidePanelInputBox"]') : null;
        if (!boxEl) return;
      }
      intentComposing = false;
      if (disposed || !getPrefs().composerIntentSuggest) return;
      if (intentCompEndTimer) clearTimeout(intentCompEndTimer);
      intentCompEndTimer = setTimeout(() => {
        intentCompEndTimer = 0;
        if (!disposed) syncIntentGhostVisibility();
      }, 30);
    }, { capture: true, passive: true, signal });
    document.addEventListener('input', (e) => {
      if (disposed || !getPrefs().composerIntentSuggest) return;
      const boxEl = e && e.target && e.target.closest ? e.target.closest('[id="antigravity.agentSidePanelInputBox"]') : null;
      if (!boxEl) return;
      cancelIntentInFlight();
      syncIntentGhostVisibility(boxEl);
    }, { capture: true, passive: true, signal });
    document.addEventListener('paste', (e) => {
      if (disposed || !getPrefs().composerIntentSuggest) return;
      const boxEl = e && e.target && e.target.closest ? e.target.closest('[id="antigravity.agentSidePanelInputBox"]') : null;
      if (!boxEl) return;
      cancelIntentInFlight();
      hideIntentGhost();
      setTimeout(() => {
        if (!disposed) syncIntentGhostVisibility(boxEl);
      }, 20);
    }, { capture: true, passive: true, signal });

    /* ========================================================================
     * 11. Unified State Sync & Event Wiring
     * ======================================================================== */
    function syncComposerOverlays() {
      const prefs = getPrefs();
      const nowMs = Date.now();
      const fxMode = resolveComposerBorderFx(prefs);
      const needBeam = fxMode === 'beam' || fxMode === 'smart' || getComposerPreviewStage(nowMs) === 'beam';
      const needRing = Boolean(prefs.quotaRing && fxMode !== 'off');
      const needComposerOverlay = needBeam || needRing;

      if (!needComposerOverlay) {
        removeBeamRingEl();
        syncQuotaRing();
        detachComposerHost();
      } else {
        const host = safeGetComposerEl();
        if (!host) {
          removeBeamRingEl();
          detachComposerHost();
        } else {
          attachComposerHost(host);
          if (needBeam) {
            syncBorderBeamDom(nowMs, prefs);
          } else {
            removeBeamRingEl();
          }
          syncQuotaRing();
        }
      }

      syncThinkingOrbMount();

      if (!prefs.thinkingOrb) {
        stopScheduler();
      }
    }

    function syncAll(reason) {
      if (disposed) return;

      const nowMs = Date.now();
      const busy = safeIsBusy();
      const prevBusy = lastBusy;
      lastBusy = busy;
      if (document.documentElement) {
        setAttr(document.documentElement, 'data-ag-ps-generating', busy ? '1' : '0');
      }

      if (prevBusy && !busy) {
        orbDoneUntil = nowMs + ORB_CONVERGE_MS;
        afterglowDoneUntil = nowMs + 9500;
        afterglowTriggeredAt = nowMs;
        if (afterglowClearTimer) clearTimeout(afterglowClearTimer);
        afterglowClearTimer = setTimeout(() => {
          afterglowClearTimer = 0;
          if (!disposed) {
            const t = Date.now();
            syncSemanticAfterglow(t);
            syncQuotaRingSuppression(t);
          }
        }, 9600);
      }

      checkUnreadTransition(busy);
      syncComposerIntent(busy, reason);
      applyBubbleTintAndCompact();
      syncSwitchReturnHelper();

      if (isConversationRoute()) {
        checkAndHealOrphanedOverviewTransition(findActiveOverviewToggleBtn());
        const ovOpen = isOverviewOpenNow();
        if (ovOpen && nowMs - lastManualOverviewToggleAt > 350) {
          setWantedOverviewOpen(true);
        } else if (getWantedOverviewOpen() === null && document.querySelector('[data-testid="overview-panel"]')) {
          setWantedOverviewOpen(ovOpen);
        }

        const vpEl = safeGetViewportEl();
        const vpR = vpEl ? vpEl.getBoundingClientRect() : null;
        const curLayoutSig = vpR && vpR.width > 0
          ? `${Math.round(vpR.left / 12)}:${Math.round(vpR.width / 12)}`
          : '';

        if (reason === 'route') {
          autoExpandCount = 0;
          lastOrbStageCheckAt = 0;
          lastObservedLayoutSig = curLayoutSig;
          scheduleEnsureOverviewOpen('route', 95);
        } else if (curLayoutSig && lastObservedLayoutSig && curLayoutSig !== lastObservedLayoutSig) {
          lastObservedLayoutSig = curLayoutSig;
          if (!ovOpen && getWantedOverviewOpen() === true) {
            scheduleEnsureOverviewOpen('layout', 95);
          }
        } else if (!ovOpen && getPrefs().keepOverviewOpen && getWantedOverviewOpen() === true && nowMs - lastManualOverviewToggleAt > 800) {
          tryRestoreOverviewNow();
        } else if (curLayoutSig && !lastObservedLayoutSig) {
          lastObservedLayoutSig = curLayoutSig;
        }
      } else {
        clearOverviewRestoreTimers();
      }

      // Avoid non-urgent DOM scans while actively typing unless busy/prefs/route
      const deferDomScan = reason === 'tick' && safeIsTyping() && !busy;
      if (!deferDomScan) {
        syncComposerOverlays();
        syncSemanticAfterglow(nowMs);
        syncCompactQuotaChip(nowMs);
        syncSidebarSessions();
        syncOutlineRail();
        syncQuotaHandoffNudge();
      } else if (afterglowHost) {
        syncSemanticAfterglow(nowMs);
      }

      if (orbDock) updateOrbStageLabel(nowMs);
      syncQuotaRingSuppression(nowMs);

      const curPrefs = getPrefs();
      if (isEffectivelyReducedMotion(curPrefs)) {
        stopScheduler();
        syncBorderBeamDom(nowMs, curPrefs);
        if (orbCanvas && curPrefs.thinkingOrb) {
          const staticSig = `${orbStage}|${safeIsDark() ? 1 : 0}|${safeGetThemeAccent()}|${orbCanvas.width}`;
          if (orbCanvas._lastStaticSig !== staticSig) {
            orbCanvas._lastStaticSig = staticSig;
            renderThinkingOrbFrame(0, nowMs, true);
          }
        }
      } else if (shouldRunScheduler(nowMs)) {
        if (orbCanvas) orbCanvas._lastStaticSig = '';
        ensureScheduler();
      }
    }

    let fxRestoreRaf1 = 0;
    let fxRestoreRaf2 = 0;
    let fxRestoreTimer = 0;
    let fxResizeRaf = 0;
    let lastRestoreSyncAt = 0;

    function cancelFxRestoreSchedule() {
      if (fxRestoreRaf1) {
        cancelAnimationFrame(fxRestoreRaf1);
        fxRestoreRaf1 = 0;
      }
      if (fxRestoreRaf2) {
        cancelAnimationFrame(fxRestoreRaf2);
        fxRestoreRaf2 = 0;
      }
      if (fxRestoreTimer) {
        clearTimeout(fxRestoreTimer);
        fxRestoreTimer = 0;
      }
    }

    onCleanup(() => {
      cancelFxRestoreSchedule();
      if (fxResizeRaf) {
        cancelAnimationFrame(fxResizeRaf);
        fxResizeRaf = 0;
      }
    });

    // Window focus / blur / visibility handlers via AbortController
    function onVisibilityOrFocusChange() {
      if (disposed) return;
      windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : !document.hidden;
      cancelFxRestoreSchedule();
      if (document.hidden) {
        stopScheduler();
        stopReturnCountdown();
        // Lightweight background poll ONLY when busy & unreadBadge enabled so hidden completion is never missed
        if (getPrefs().unreadBadge && (lastBusy || safeIsBusy()) && !hiddenPollTimer) {
          wasBusyForUnread = true;
          hiddenPollTimer = setInterval(() => {
            if (disposed || !document.hidden) {
              stopHiddenUnreadPoll();
              return;
            }
            const busyNow = safeIsBusy();
            lastBusy = busyNow;
            checkUnreadTransition(busyNow);
          }, 2600);
        }
      } else {
        stopHiddenUnreadPoll();
        // Let browser paint first restored frame before touching DOM or reading layout
        fxRestoreRaf1 = requestAnimationFrame(() => {
          fxRestoreRaf1 = 0;
          fxRestoreRaf2 = requestAnimationFrame(() => {
            fxRestoreRaf2 = 0;
            fxRestoreTimer = window.setTimeout(() => {
              fxRestoreTimer = 0;
              if (disposed || document.hidden) return;
              lastRestoreSyncAt = Date.now();
              clearUnreadBadge();
              syncAll('visibility');
            }, 150);
          });
        });
      }
    }

    document.addEventListener('visibilitychange', onVisibilityOrFocusChange, { signal });
    window.addEventListener('focus', () => {
      if (disposed) return;
      windowFocused = true;
      if (fxRestoreRaf1 || fxRestoreRaf2 || fxRestoreTimer) return;
      clearUnreadBadge();
      const now = Date.now();
      syncBorderBeamDom(now);
      syncQuotaRingSuppression(now);
      if (shouldRunScheduler(now)) ensureScheduler();
    }, { signal });

    window.addEventListener('blur', () => {
      if (disposed) return;
      windowFocused = false;
      const now = Date.now();
      syncBorderBeamDom(now);
      syncQuotaRingSuppression(now);
      if (!shouldRunScheduler(now)) stopScheduler();
    }, { signal });

    window.addEventListener('resize', () => {
      if (disposed) return;
      scheduleThrottledMeasure();
      if (fxResizeRaf) return;
      fxResizeRaf = requestAnimationFrame(() => {
        fxResizeRaf = 0;
        if (disposed || document.hidden) return;
        if (orbCanvas && getPrefs().thinkingOrb) syncOrbCanvasDpr(false);
        if (railEl) positionOutlineRail();
        if (quotaNudgeEl) positionQuotaNudge();
        if (isConversationRoute() && getWantedOverviewOpen() === true && !isOverviewOpenNow()) {
          scheduleEnsureOverviewOpen('layout', 140);
        }
      });
    }, { passive: true, signal });

    window.addEventListener('ag-prism-overlay-change', () => {
      if (disposed) return;
      if (railEl) positionOutlineRail();
      if (quotaNudgeEl) positionQuotaNudge();
    }, { signal });

    // Subscribe to Frozen v4 Bus events
    const unsub = bus.subscribe((ev) => {
      if (disposed) return;
      const type = typeof ev === 'string' ? ev : (ev && ev.type) || 'tick';
      if (type === 'orb-stage') return;
      if (type === 'theme') {
        beamPaletteCacheKey = '';
        applyBubbleTintAndCompact();
        syncBorderBeamDom(Date.now());
        if (orbCanvas && getPrefs().thinkingOrb && !sharedRafId) {
          renderThinkingOrbFrame(0, Date.now(), true);
        }
        return;
      }
      if (type === 'visibility') {
        // Handled cleanly by native visibilitychange listener with post-paint coalescing
        return;
      }
      if (type === 'tick' && (fxRestoreRaf1 || fxRestoreRaf2 || fxRestoreTimer || Date.now() - lastRestoreSyncAt < 240)) {
        return;
      }
      syncAll(type);
    });

    function commitCustomFontInput(inputEl) {
      if (!inputEl) return false;
      const key = inputEl.getAttribute('data-fx-font-input');
      if (key !== 'chatFontFamily' && key !== 'codeFontFamily') return false;
      const cleaned = sanitizeFontFamilyPref(inputEl.value || '');
      if (cleaned === undefined) {
        safeToast('字体名称含非法语法字符，已忽略');
        const cur = getPrefs();
        inputEl.value = cur[key] || '';
        return true;
      }
      const label = key === 'codeFontFamily' ? '代码' : '正文';
      const changed = bus.setPref(key, cleaned);
      if (changed) {
        safeToast(cleaned ? `已应用自定义${label}字体` : `已恢复默认${label}字体`);
      }
      return true;
    }

    /* ========================================================================
     * 12. Popover Panel Section Registration (id: 'fx', order: 10, 4-Tab Aware)
     * ======================================================================== */
    bus.registerPanelSection({
      id: 'fx',
      order: 10,
      title: '',
      render(rawPrefs, helpers) {
        const p = Object.assign({}, FX_DEFAULTS, rawPrefs || {});
        const activeTab = (helpers && helpers.activeTab) || 'appearance';
        const previewing = isBeamPreviewActive(Date.now());
        const strength = clampInt(p.bubbleTintStrength, 10, 100, 22);
        const perfMode = p.performanceMode || 'balanced';
        const edgeMode = resolveComposerBorderFx(p);
        const railMode = resolveOutlineRailMode(p);
        const curChatFont = sanitizeFontFamilyPref(p.chatFontFamily || '') || '';
        const curCodeFont = sanitizeFontFamilyPref(p.codeFontFamily || '') || '';

        if (activeTab === 'appearance') {
          const chatFontChips = CHAT_FONT_PRESETS.map((item) => {
            const sel = curChatFont === item.value ? '1' : '0';
            return `<button type="button" class="ag-ps-fx-chip" data-fx-chat-font-preset="${escapeHtml(item.value)}" data-selected="${sel}">${escapeHtml(item.label)}</button>`;
          }).join('');

          const codeFontChips = CODE_FONT_PRESETS.map((item) => {
            const sel = curCodeFont === item.value ? '1' : '0';
            return `<button type="button" class="ag-ps-fx-chip" data-fx-code-font-preset="${escapeHtml(item.value)}" data-selected="${sel}">${escapeHtml(item.label)}</button>`;
          }).join('');

          const bubbleSwatches = BUBBLE_PRESETS.map((item) => {
            const sel = (p.bubbleTintPreset || 'accent') === item.id ? '1' : '0';
            return `<button type="button" class="ag-ps-fx-swatch-btn" data-fx-bubble-preset="${escapeHtml(item.id)}" data-selected="${sel}" style="background:${escapeHtml(item.swatch)}" data-ag-ps-tip="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}"></button>`;
          }).join('');

          return `
            <div class="ag-ps-toggle-list">
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="在浅色与深色全主题下为代码块、工具/变更/概览卡片与 kbd 键帽赋予立体微切面层次，并为分屏条提供悬停微光导引（不改动消息气泡配色）">
                  <span>光学立体切面与分割线</span>
                  <span class="ag-ps-toggle-sub">全主题卡片层次 · 立体键帽 · 悬停分屏导引</span>
                </div>
                <button type="button" role="switch" aria-checked="${p.opticalFacets !== false ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="opticalFacets" data-on="${p.opticalFacets !== false ? '1' : '0'}" aria-label="光学立体切面与分割线"></button>
              </div>

              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="为用户提问气泡添加主题融合色调，浓度 ≥70% 自动反白保证可读性">
                  <span>用户消息气泡着色</span>
                  <span class="ag-ps-toggle-sub">柔和融合 · 高浓度自动对比字色</span>
                </div>
                <button type="button" role="switch" aria-checked="${p.bubbleTint ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="bubbleTint" data-on="${p.bubbleTint ? '1' : '0'}" aria-label="用户消息气泡着色"></button>
              </div>
              ${
                p.bubbleTint
                  ? `<div class="ag-ps-subpanel">
                      <div class="ag-ps-toggle-row">
                        <span class="ag-ps-toggle-sub">色调</span>
                        <div class="ag-ps-fx-swatch-row">${bubbleSwatches}</div>
                      </div>
                      <div class="ag-ps-toggle-row">
                        <span class="ag-ps-toggle-sub">浓度</span>
                        <div class="ag-ps-range-wrap">
                          <input type="range" class="ag-ps-range" data-fx-bubble-strength="1" min="10" max="100" step="2" value="${strength}" aria-label="气泡着色浓度" />
                          <span class="ag-ps-range-val" data-fx-bubble-strength-val="1">${strength}%</span>
                          <button type="button" class="ag-ps-mini-reset" data-fx-bubble-reset="1" ${strength === 22 ? 'disabled' : ''}>复位</button>
                        </div>
                      </div>
                    </div>`
                  : ''
              }

              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="收紧正文行高至 1.42 与段落间距，完整保留你偏好的字号">
                  <span>紧凑排版</span>
                  <span class="ag-ps-toggle-sub">行高 1.42 · 同屏信息密度更高</span>
                </div>
                <button type="button" role="switch" aria-checked="${p.compactLayout ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="compactLayout" data-on="${p.compactLayout ? '1' : '0'}" aria-label="紧凑排版"></button>
              </div>

              <div class="ag-ps-subpanel ag-ps-font-subpanel">
                <div class="ag-ps-toggle-sub" style="font-weight:600;color:var(--foreground,#141413)">自定义对话与代码字体</div>
                <div class="ag-ps-toggle-sub">正文字体</div>
                <div class="ag-ps-fx-chip-grid ag-ps-fx-chip-grid-4">${chatFontChips}</div>
                <input type="text" class="ag-ps-font-input" data-fx-font-input="chatFontFamily" maxlength="160" value="${escapeHtml(curChatFont)}" placeholder="输入正文字体名称，按回车生效" aria-label="自定义对话正文字体" />
                <div class="ag-ps-toggle-sub" style="margin-top:3px">代码字体</div>
                <div class="ag-ps-fx-chip-grid ag-ps-fx-chip-grid-4">${codeFontChips}</div>
                <input type="text" class="ag-ps-font-input" data-fx-font-input="codeFontFamily" maxlength="160" value="${escapeHtml(curCodeFont)}" placeholder="输入代码字体名称，按回车生效" aria-label="自定义代码字体" />
              </div>
            </div>
          `;
        }

        if (activeTab === 'motion') {
          const beamChips = BEAM_PALETTE_LABELS.map((item) => {
            const sel = (p.borderBeamPalette || 'theme') === item.id ? '1' : '0';
            return `<button type="button" class="ag-ps-fx-chip" data-fx-beam-palette="${escapeHtml(item.id)}" data-selected="${sel}"><span class="ag-ps-fx-dot" style="background:${escapeHtml(item.dot)}"></span>${escapeHtml(item.label)}</button>`;
          }).join('');

          const edgeSubDesc =
            edgeMode === 'off'
              ? '已关闭边缘光效'
              : edgeMode === 'beam'
                ? '聚焦时常驻丝滑流光 · 完工或待确认亮余晖'
                : edgeMode === 'static'
                  ? '无旋转动画 · 思考黄 / 待确认红 / 完成绿三色微光'
                  : '回复时亮丝滑流光 · 完工或待确认亮三色微光';

          return `
            <div class="ag-ps-toggle-list">
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="省电：暂停常驻动效更省电量；均衡：日常推荐，闲置自动休眠；满血：增强光晕与活力表现">
                  <span>动效强度</span>
                  <span class="ag-ps-toggle-sub">${perfMode === 'power-save' ? '省电 · 静态安静更省电' : perfMode === 'vivid' ? '满血 · 灵动光晕增强' : '均衡 · 日常流畅闲置休眠'}</span>
                </div>
                <div class="ag-ps-seg-group">
                  <button type="button" class="ag-ps-seg-btn" data-fx-perf-mode="power-save" data-selected="${perfMode === 'power-save' ? '1' : '0'}">省电</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-perf-mode="balanced" data-selected="${perfMode === 'balanced' ? '1' : '0'}">均衡</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-perf-mode="vivid" data-selected="${perfMode === 'vivid' ? '1' : '0'}">满血</button>
                </div>
              </div>

              <div class="ag-ps-toggle-row" style="align-items:flex-start;flex-direction:column;gap:6px">
                <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px">
                  <div class="ag-ps-toggle-label" data-ag-ps-tip="统一管理输入框流光、三色状态余晖与剩余额度弧线；点击右侧预览可立即在底部输入框体验三段式效果">
                    <span>输入框边缘光效</span>
                    <span class="ag-ps-toggle-sub">${edgeSubDesc}</span>
                  </div>
                  <button type="button" class="ag-ps-fx-preview-btn" data-fx-beam-preview="1" data-active="${previewing ? '1' : '0'}">预览光效</button>
                </div>
                <div class="ag-ps-seg-group" style="width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">
                  <button type="button" class="ag-ps-seg-btn" data-fx-composer-edge="off" data-selected="${edgeMode === 'off' ? '1' : '0'}">关</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-composer-edge="smart" data-selected="${edgeMode === 'smart' ? '1' : '0'}">智能</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-composer-edge="beam" data-selected="${edgeMode === 'beam' ? '1' : '0'}">常驻流光</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-composer-edge="static" data-selected="${edgeMode === 'static' ? '1' : '0'}">纯静余晖</button>
                </div>
              </div>
              ${
                edgeMode !== 'off'
                  ? `<div class="ag-ps-subpanel">
                      ${
                        edgeMode === 'smart' || edgeMode === 'beam'
                          ? `<div class="ag-ps-toggle-sub">流光配色</div>
                             <div class="ag-ps-fx-chip-grid">${beamChips}</div>`
                          : ''
                      }
                      <div class="ag-ps-toggle-row">
                        <span class="ag-ps-toggle-sub" data-ag-ps-tip="空闲时在输入框边缘显示剩余额度色弧（绿 / 黄 / 红），AI 回复或亮起余晖时自动让位">空闲显示剩余额度环</span>
                        <button type="button" role="switch" aria-checked="${p.quotaRing ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="quotaRing" data-on="${p.quotaRing ? '1' : '0'}" aria-label="空闲显示剩余额度环"></button>
                      </div>
                      ${
                        p.quotaRing
                          ? `<div class="ag-ps-toggle-row">
                              <span class="ag-ps-toggle-sub">追踪周期</span>
                              <div class="ag-ps-seg-group">
                                <button type="button" class="ag-ps-seg-btn" data-fx-qring-period="auto" data-selected="${p.quotaRingPeriod === 'auto' ? '1' : '0'}">自动</button>
                                <button type="button" class="ag-ps-seg-btn" data-fx-qring-period="weekly" data-selected="${p.quotaRingPeriod === 'weekly' ? '1' : '0'}">周额度</button>
                                <button type="button" class="ag-ps-seg-btn" data-fx-qring-period="5h" data-selected="${p.quotaRingPeriod === '5h' ? '1' : '0'}">5h</button>
                              </div>
                            </div>`
                          : ''
                      }
                    </div>`
                  : ''
              }

              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="输入框左上方立体粒子球随思考、调用工具与输出实时变化形态，回复结束后自动静止">
                  <span>思考粒子球</span>
                  <span class="ag-ps-toggle-sub">随 AI 思考与输出灵动变形</span>
                </div>
                <button type="button" role="switch" aria-checked="${p.thinkingOrb ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="thinkingOrb" data-on="${p.thinkingOrb ? '1' : '0'}" aria-label="思考粒子球"></button>
              </div>
              ${
                p.thinkingOrb
                  ? `<div class="ag-ps-subpanel">
                      <div class="ag-ps-toggle-row">
                        <span class="ag-ps-toggle-sub">与像素伙伴</span>
                        <div class="ag-ps-seg-group">
                          <button type="button" class="ag-ps-seg-btn" data-fx-orb-mode="both" data-selected="${p.thinkingOrbMode !== 'replace' ? '1' : '0'}">左右共存</button>
                          <button type="button" class="ag-ps-seg-btn" data-fx-orb-mode="replace" data-selected="${p.thinkingOrbMode === 'replace' ? '1' : '0'}">替换伙伴</button>
                        </div>
                      </div>
                    </div>`
                  : ''
              }

              <details class="ag-ps-adv-fold">
                <summary>系统动画兼容选项</summary>
                <div class="ag-ps-toggle-list">
                  <div class="ag-ps-toggle-row">
                    <div class="ag-ps-toggle-label" data-ag-ps-tip="当 Windows 系统开启了「减少动画」导致特效不动时，开启此项可继续保留思考球、流光与像素伙伴动画">
                      <span>系统关动画时仍保留动效</span>
                      <span class="ag-ps-toggle-sub">不受系统「减少动态效果」限制</span>
                    </div>
                    <button type="button" role="switch" aria-checked="${p.ignoreReducedMotion ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="ignoreReducedMotion" data-on="${p.ignoreReducedMotion ? '1' : '0'}" aria-label="系统关动画时仍保留动效"></button>
                  </div>
                </div>
              </details>
            </div>
          `;
        }

        if (activeTab === 'nav') {
          const previewStyle = resolveOutlinePreviewStyle(p);
          const railSubDesc =
            railMode === 'smart'
              ? '优先使用左栏竖向蓝标 · 自动收起右侧防冲突'
              : railMode === 'right'
                ? '轮次圆点目录（右侧常驻） · 自动避让右侧面板'
                : '已隐藏左右轮次点阵导航';

          return `
            <div class="ag-ps-toggle-list">
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="智能左栏：有原生左侧导航时自动收起右侧圆点（彻底避免遮挡滚动条）；右侧：强制显示右侧常驻轮次圆点目录">
                  <span>侧边轮次点阵导航</span>
                  <span class="ag-ps-toggle-sub">${railSubDesc}</span>
                </div>
                <div class="ag-ps-seg-group">
                  <button type="button" class="ag-ps-seg-btn" data-fx-rail-mode="smart" data-selected="${railMode === 'smart' ? '1' : '0'}">智能左栏</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-rail-mode="right" data-selected="${railMode === 'right' ? '1' : '0'}">右侧</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-rail-mode="off" data-selected="${railMode === 'off' ? '1' : '0'}">关</button>
                </div>
              </div>

              ${
                railMode !== 'off'
                  ? `<div class="ag-ps-subcard">
                      <div class="ag-ps-toggle-row">
                        <span class="ag-ps-toggle-sub" data-ag-ps-tip="详细卡片展示多行问答预览与轮次时间；精简胶囊仅显示单行 #轮次 与提问摘要，不遮挡正文（两者互斥绝不重叠）">悬停预览样式</span>
                        <div class="ag-ps-seg-group">
                          <button type="button" class="ag-ps-seg-btn" data-fx-rail-preview="detailed" data-selected="${previewStyle === 'detailed' ? '1' : '0'}">详细卡片</button>
                          <button type="button" class="ag-ps-seg-btn" data-fx-rail-preview="compact" data-selected="${previewStyle === 'compact' ? '1' : '0'}">精简胶囊</button>
                        </div>
                      </div>
                    </div>`
                  : ''
              }

              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="记住你打开右侧「概览」面板的状态，切换对话或关闭工作台时不自动收起">
                  <span>保持右侧概览常开</span>
                  <span class="ag-ps-toggle-sub">切换对话时不自动收起右侧概览</span>
                </div>
                <button type="button" role="switch" aria-checked="${p.keepOverviewOpen ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="keepOverviewOpen" data-on="${p.keepOverviewOpen ? '1' : '0'}" aria-label="保持右侧概览常开"></button>
              </div>

              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label" data-ag-ps-tip="调整左侧边栏默认展示的历史对话条数">
                  <span>左侧历史对话显示数</span>
                  <span class="ag-ps-toggle-sub">一键展开更多历史记录</span>
                </div>
                <div class="ag-ps-seg-group">
                  <button type="button" class="ag-ps-seg-btn" data-fx-sidebar-sessions="default" data-selected="${p.sidebarSessions === 'default' ? '1' : '0'}">默认</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-sidebar-sessions="10" data-selected="${p.sidebarSessions === '10' ? '1' : '0'}">10条</button>
                  <button type="button" class="ag-ps-seg-btn" data-fx-sidebar-sessions="all" data-selected="${p.sidebarSessions === 'all' ? '1' : '0'}">全部</button>
                </div>
              </div>
            </div>
          `;
        }

        const curTokenUnit = p.tokenUnit === 'kmb' ? 'kmb' : 'wan';
        return `
          <div class="ag-ps-toggle-list">
            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="切换右侧概览、上下文环与用量统计中的 Token 数值单位">
                <span>Token 数量单位</span>
                <span class="ag-ps-toggle-sub">中文直觉 万/亿 · 国际标准 K/M</span>
              </div>
              <div class="ag-ps-seg-group">
                <button type="button" class="ag-ps-seg-btn" data-fx-token-unit="wan" data-selected="${curTokenUnit === 'wan' ? '1' : '0'}">万 / 亿</button>
                <button type="button" class="ag-ps-seg-btn" data-fx-token-unit="kmb" data-selected="${curTokenUnit === 'kmb' ? '1' : '0'}">K / M</button>
              </div>
            </div>

            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="实验性：每轮回复完成后在空输入框给出浅灰续写建议，按 Tab 键填入（绝不自动发送），打字或按 Esc 立即消失；配置模型中枢后（自动脱敏）由网关预测，未配置时使用纯本地启发式">
                <span>输入框下一步提问建议</span>
                <span class="ag-ps-toggle-sub">配置模型中枢后（自动脱敏）由网关预测，未配置时使用纯本地启发式</span>
              </div>
              <button type="button" role="switch" aria-checked="${p.composerIntentSuggest ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="composerIntentSuggest" data-on="${p.composerIntentSuggest ? '1' : '0'}" aria-label="输入框下一步提问建议"></button>
            </div>

            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="在输入框下方实时显示 5h 与每周剩余额度百分比，点击查看详情，按住 Shift 点击直达切号">
                <span>底栏实时额度百分比</span>
                <span class="ag-ps-toggle-sub">输入框底部显示 5h · 7d 剩余比例</span>
              </div>
              <button type="button" role="switch" aria-checked="${p.compactQuotaPill !== false ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="compactQuotaPill" data-on="${p.compactQuotaPill !== false ? '1' : '0'}" aria-label="底栏实时额度百分比"></button>
            </div>

            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="当周额度低于 5% 或 5h 额度低于 10% 时温和提醒切换模型或备用账号">
                <span>额度见底温和提醒</span>
                <span class="ag-ps-toggle-sub">7d≤5% 提示切号 · 5h≤10% 提示换模型</span>
              </div>
              <button type="button" role="switch" aria-checked="${p.quotaHandoffAlert ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="quotaHandoffAlert" data-on="${p.quotaHandoffAlert ? '1' : '0'}" aria-label="额度见底温和提醒"></button>
            </div>

            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="去设置页切换账号后，在页面顶部提供「返回刚才的对话」快捷横幅">
                <span>设置页切号后一键回原对话</span>
                <span class="ag-ps-toggle-sub">进入设置页时顶部显示返回按钮</span>
              </div>
              <button type="button" role="switch" aria-checked="${p.switchReturnHelper ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="switchReturnHelper" data-on="${p.switchReturnHelper ? '1' : '0'}" aria-label="设置页切号后一键回原对话"></button>
            </div>
            ${
              p.switchReturnHelper
                ? `<div class="ag-ps-subpanel">
                    <div class="ag-ps-toggle-row">
                      <span class="ag-ps-toggle-sub" data-ag-ps-tip="在设置页无弹窗操作时启动 3 秒可取消倒计时，自动回到原对话">无弹窗 3s 自动返回</span>
                      <button type="button" role="switch" aria-checked="${p.switchAutoReturn ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="switchAutoReturn" data-on="${p.switchAutoReturn ? '1' : '0'}" aria-label="无弹窗 3s 自动返回"></button>
                    </div>
                    <div class="ag-ps-toggle-row">
                      <span class="ag-ps-toggle-sub" data-ag-ps-tip="仅在近期切换账号（5 分钟内）弹出欢迎提示框时自动点继续，默认关闭且不改动任何隐私选项">自动跳过新号欢迎弹窗</span>
                      <button type="button" role="switch" aria-checked="${p.autoDismissOnboarding ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="autoDismissOnboarding" data-on="${p.autoDismissOnboarding ? '1' : '0'}" aria-label="自动跳过新号欢迎弹窗"></button>
                    </div>
                  </div>`
                : ''
            }

            <div class="ag-ps-toggle-row">
              <div class="ag-ps-toggle-label" data-ag-ps-tip="窗口切到后台等 AI 回复时，完成后在任务栏标题显示 (1) 未读提示">
                <span>后台回复完成标题提醒</span>
                <span class="ag-ps-toggle-sub">切回窗口自动清除未读数字</span>
              </div>
              <button type="button" role="switch" aria-checked="${p.unreadBadge ? 'true' : 'false'}" class="ag-ps-switch" data-fx-toggle="unreadBadge" data-on="${p.unreadBadge ? '1' : '0'}" aria-label="后台回复完成标题提醒"></button>
            </div>
          </div>
        `;
      },

      onClick(e) {
        if (disposed) return false;
        const target = e && e.target;
        if (!target || typeof target.closest !== 'function') return false;

        const perfModeBtn = target.closest('[data-fx-perf-mode]');
        if (perfModeBtn) {
          const val = perfModeBtn.getAttribute('data-fx-perf-mode');
          if (val === 'power-save' || val === 'balanced' || val === 'vivid') {
            bus.setPref('performanceMode', val);
            return true;
          }
          return false;
        }

        const edgeBtn = target.closest('[data-fx-composer-edge]');
        if (edgeBtn) {
          const val = edgeBtn.getAttribute('data-fx-composer-edge');
          if (val === 'off' || val === 'smart' || val === 'beam' || val === 'static') {
            if (val === 'off') {
              bus.setPref('borderBeam', false);
              bus.setPref('semanticAfterglow', false);
              bus.setPref('quotaRing', false);
            } else if (val === 'smart') {
              bus.setPref('borderBeam', true);
              bus.setPref('borderBeamMode', 'busy');
              bus.setPref('semanticAfterglow', true);
            } else if (val === 'beam') {
              bus.setPref('borderBeam', true);
              bus.setPref('borderBeamMode', 'always');
              bus.setPref('semanticAfterglow', true);
            } else if (val === 'static') {
              bus.setPref('borderBeam', false);
              bus.setPref('semanticAfterglow', true);
            }
            bus.setPref('composerBorderFx', val);
            return true;
          }
          return false;
        }

        const railModeBtn = target.closest('[data-fx-rail-mode]');
        if (railModeBtn) {
          const val = railModeBtn.getAttribute('data-fx-rail-mode');
          if (val === 'smart' || val === 'right' || val === 'off') {
            bus.setPref('alwaysOutlineRail', val !== 'off');
            bus.setPref('outlineRailMode', val);
            return true;
          }
          return false;
        }

        const railPreviewBtn = target.closest('[data-fx-rail-preview]');
        if (railPreviewBtn) {
          const val = railPreviewBtn.getAttribute('data-fx-rail-preview');
          if (val === 'detailed' || val === 'compact') {
            bus.setPref('outlinePreviewStyle', val);
            return true;
          }
          return false;
        }

        const tokenUnitBtn = target.closest('[data-fx-token-unit]');
        if (tokenUnitBtn) {
          const val = tokenUnitBtn.getAttribute('data-fx-token-unit');
          if (val === 'wan' || val === 'kmb') {
            bus.setPref('tokenUnit', val);
            return true;
          }
          return false;
        }

        const chatFontPresetBtn = target.closest('[data-fx-chat-font-preset]');
        if (chatFontPresetBtn) {
          const val = chatFontPresetBtn.getAttribute('data-fx-chat-font-preset') ?? '';
          bus.setPref('chatFontFamily', val);
          return true;
        }

        const codeFontPresetBtn = target.closest('[data-fx-code-font-preset]');
        if (codeFontPresetBtn) {
          const val = codeFontPresetBtn.getAttribute('data-fx-code-font-preset') ?? '';
          bus.setPref('codeFontFamily', val);
          return true;
        }

        const previewBtn = target.closest('[data-fx-beam-preview]');
        if (previewBtn) {
          triggerBeamPreview();
          return true;
        }

        const toggleBtn = target.closest('[data-fx-toggle]');
        if (toggleBtn) {
          const key = toggleBtn.getAttribute('data-fx-toggle');
          if (key && Object.prototype.hasOwnProperty.call(FX_DEFAULTS, key)) {
            const cur = getPrefs();
            const nextVal = !cur[key];
            if (key === 'keepOverviewOpen' && nextVal) {
              setWantedOverviewOpen(true);
              lastManualOverviewToggleAt = 0;
              setTimeout(() => { if (!disposed) tryRestoreOverviewNow(); }, 45);
            }
            bus.setPref(key, nextVal);
            return true;
          }
          return false;
        }

        const beamModeBtn = target.closest('[data-fx-beam-mode]');
        if (beamModeBtn) {
          const val = beamModeBtn.getAttribute('data-fx-beam-mode') === 'busy' ? 'busy' : 'always';
          bus.setPref('borderBeamMode', val);
          bus.setPref('composerBorderFx', val === 'busy' ? 'smart' : 'beam');
          return true;
        }

        const beamPalBtn = target.closest('[data-fx-beam-palette]');
        if (beamPalBtn) {
          const val = beamPalBtn.getAttribute('data-fx-beam-palette');
          if (val) {
            beamPaletteCacheKey = '';
            bus.setPref('borderBeamPalette', val);
            return true;
          }
          return false;
        }

        const qPeriodBtn = target.closest('[data-fx-qring-period]');
        if (qPeriodBtn) {
          const val = qPeriodBtn.getAttribute('data-fx-qring-period');
          if (val) {
            bus.setPref('quotaRingPeriod', val);
            return true;
          }
          return false;
        }

        const orbModeBtn = target.closest('[data-fx-orb-mode]');
        if (orbModeBtn) {
          const val = orbModeBtn.getAttribute('data-fx-orb-mode') === 'replace' ? 'replace' : 'both';
          bus.setPref('thinkingOrbMode', val);
          return true;
        }

        const bubblePresetBtn = target.closest('[data-fx-bubble-preset]');
        if (bubblePresetBtn) {
          const val = bubblePresetBtn.getAttribute('data-fx-bubble-preset');
          if (val) {
            bus.setPref('bubbleTintPreset', val);
            return true;
          }
          return false;
        }

        const bubbleResetBtn = target.closest('[data-fx-bubble-reset]');
        if (bubbleResetBtn) {
          bus.setPref('bubbleTintStrength', 22);
          return true;
        }

        const sessBtn = target.closest('[data-fx-sidebar-sessions]');
        if (sessBtn) {
          const val = sessBtn.getAttribute('data-fx-sidebar-sessions');
          if (val === 'default' || val === '10' || val === 'all') {
            autoExpandCount = 0;
            bus.setPref('sidebarSessions', val);
            return true;
          }
        }
        return false;
      },

      onInput(e) {
        if (disposed) return false;
        const target = e && e.target;
        const slider = target && target.closest && target.closest('[data-fx-bubble-strength]');
        if (!slider) return false;
        const val = clampInt(slider.value, 10, 100, 22);
        applyBubbleTintAndCompact(val);
        const root = slider.closest('#ag-ps-popover') || document;
        const valEl = root.querySelector('[data-fx-bubble-strength-val]');
        if (valEl) valEl.textContent = `${val}%`;
        const resetBtn = root.querySelector('[data-fx-bubble-reset]');
        if (resetBtn) resetBtn.disabled = val === 22;
        return true;
      },

      onChange(e) {
        if (disposed || (e && e.isComposing)) return false;
        const target = e && e.target;
        const fontInput = target && target.closest && target.closest('[data-fx-font-input]');
        if (fontInput) {
          return commitCustomFontInput(fontInput);
        }
        const slider = target && target.closest && target.closest('[data-fx-bubble-strength]');
        if (!slider) return false;
        const val = clampInt(slider.value, 10, 100, 22);
        bus.setPref('bubbleTintStrength', val);
        return true;
      },

      onKeyDown(e) {
        if (disposed || !e || e.key !== 'Enter' || e.isComposing) return false;
        const target = e.target;
        const fontInput = target && target.closest && target.closest('[data-fx-font-input]');
        if (!fontInput) return false;
        e.preventDefault();
        e.stopPropagation();
        return commitCustomFontInput(fontInput);
      }
    });

    /* ========================================================================
     * 13. Clean Disposal (Hot-Reload & Uninstall Safe)
     * ======================================================================== */
    let unregisterBusCleanup = null;

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof unregisterBusCleanup === 'function') {
        const unreg = unregisterBusCleanup;
        unregisterBusCleanup = null;
        try { unreg(); } catch {}
      }

      stopScheduler();
      stopHiddenUnreadPoll();
      ac.abort();

      clearComposerPreviewTimers();
      clearOverviewRestoreTimers();
      clearRailBurstTimers();
      if (returnNavFallbackTimer) {
        clearTimeout(returnNavFallbackTimer);
        returnNavFallbackTimer = 0;
      }
      if (onboardingRetryTimer) {
        clearTimeout(onboardingRetryTimer);
        onboardingRetryTimer = 0;
      }
      while (fxCleanups.length) {
        const fn = fxCleanups.pop();
        try { fn(); } catch {}
      }
      if (typeof unsub === 'function') {
        try { unsub(); } catch {}
      }
      try { bus.unregisterPanelSection?.('fx'); } catch {}

      clearUnreadBadge();
      teardownComposerIntent(true);
      clearHiddenSessionMarks();
      detachDprWatcher();
      clearAfterglowHost();
      removeCompactQuotaChip();
      detachHostNavEnhancer();
      removeOutlineRail(false);
      removeOrbDock();
      removeReturnBar(true);
      removeQuotaNudge(true);
      removeBeamRingEl();

      if (qRingWrap) {
        qRingWrap.remove();
        qRingWrap = null;
        qRingSvg = null;
        qRingTrack = null;
        qRingArc = null;
      }

      detachComposerHost();

      const html = document.documentElement;
      if (html) {
        html.removeAttribute('data-ag-ps-perf');
        html.removeAttribute('data-ag-ps-force-motion');
        html.removeAttribute('data-ag-ps-reduced-motion');
        html.removeAttribute('data-ag-ps-facets');
        html.removeAttribute('data-ag-ps-nav-off');
        html.removeAttribute('data-ag-ps-rail-preview');
        html.removeAttribute('data-ag-ps-custom-chat-font');
        html.removeAttribute('data-ag-ps-custom-code-font');
        html.removeAttribute('data-ag-ps-orb-replace');
        html.removeAttribute('data-ag-ps-bubble-tint');
        html.removeAttribute('data-ag-ps-bubble-contrast');
        html.removeAttribute('data-ag-ps-compact');
        html.removeAttribute('data-ag-ps-sidebar-sessions');
        html.removeAttribute('data-ag-ps-generating');
        html.style.removeProperty('--ag-ps-chat-font');
        html.style.removeProperty('--ag-ps-code-font');
        html.style.removeProperty('--ag-ps-bubble-color');
        html.style.removeProperty('--ag-ps-bubble-mix');
      }

      if (window.__agPrismFxDispose === dispose) {
        delete window.__agPrismFxDispose;
      }
    }

    window.__agPrismFxDispose = dispose;
    if (typeof bus.onCleanup === 'function') {
      unregisterBusCleanup = bus.onCleanup(dispose);
    }

    // Initial sync
    syncAll('init');
  }

  registerPrismModule('fx', initFxModule);
})();
