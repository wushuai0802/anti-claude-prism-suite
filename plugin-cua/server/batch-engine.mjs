// SPDX-License-Identifier: MIT
/**
 * Pure JSON declarative batch_actions validator and execution engine.
 *
 * Design invariants:
 * - Zero dynamic code execution (strictly declarative JSON schema & table dispatch).
 * - Enforces 1 <= actions.length <= 12 and strict op/argument validation.
 * - Enforces minimum 80ms pacing between mutating steps (configurable to 0 in tests).
 * - Built-in 5-minute TTL, max-256-entry Idempotency-Key cache to prevent retry double-clicks.
 * - Evaluates expectBefore and expectAfter (with automatic fresh re-observation)
 *   supporting { titleContains, urlStartsWith, refExists, textContains }.
 * - Short-circuits immediately on assertion failure, safety policy block,
 *   CAPTCHA_DETECTED (invoking broker pause_handoff), or USER_ESC_ABORTED.
 */

import crypto from 'node:crypto';
import {
  detectCaptchaOrChallenge,
  evaluateActionSafety,
  evaluateUrlSafety,
  evaluateWindowSafety,
  sanitizeObservationTree
} from './safety-policy.mjs';
import { computeObservationDiff } from './state-diff.mjs';

export const MIN_BATCH_ACTIONS = 1;
export const MAX_BATCH_ACTIONS = 12;
export const DEFAULT_MIN_PACING_MS = 80;
export const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 256;

export const ALLOWED_ACTION_OPS = Object.freeze([
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'scroll',
  'select_option',
  'focus_ref',
  'wait_for'
]);

const ALLOWED_OP_SET = new Set(ALLOWED_ACTION_OPS);
const ASSERTION_KEYS = new Set([
  'titleContains',
  'urlStartsWith',
  'refExists',
  'textContains'
]);

const REF_TOKEN_RE = /^@[A-Za-z0-9_.-]{1,64}$/;

function isPlainObject(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function isValidCoord(val) {
  return typeof val === 'number' && Number.isFinite(val) && val >= -32768 && val <= 65535;
}

export function validateAssertionSpec(spec, label = 'assertion') {
  if (spec === undefined || spec === null) {
    return { valid: true };
  }
  if (!isPlainObject(spec)) {
    return {
      valid: false,
      code: 'INVALID_ASSERTION_SPEC',
      error: `${label} 必须为普通 JSON 对象`
    };
  }

  const keys = Object.keys(spec);
  if (keys.length === 0) {
    return {
      valid: false,
      code: 'INVALID_ASSERTION_SPEC',
      error: `${label} 至少需指定一项断言条件`
    };
  }

  for (const key of keys) {
    if (!ASSERTION_KEYS.has(key)) {
      return {
        valid: false,
        code: 'INVALID_ASSERTION_SPEC',
        error: `${label} 包含不支持的断言字段 "${key}"（仅支持 titleContains, urlStartsWith, refExists, textContains）`
      };
    }
    const val = spec[key];
    if (key === 'refExists' && Array.isArray(val)) {
      if (
        val.length === 0 ||
        val.some((r) => typeof r !== 'string' || !REF_TOKEN_RE.test(r.trim()))
      ) {
        return {
          valid: false,
          code: 'INVALID_ASSERTION_SPEC',
          error: `${label}.refExists 数组必须包含合法的 @ref 标识符`
        };
      }
      continue;
    }
    if (typeof val !== 'string' || val.length === 0 || val.length > 512) {
      return {
        valid: false,
        code: 'INVALID_ASSERTION_SPEC',
        error: `${label}.${key} 必须为非空字符串`
      };
    }
    if (key === 'refExists' && !REF_TOKEN_RE.test(val.trim())) {
      return {
        valid: false,
        code: 'INVALID_ASSERTION_SPEC',
        error: `${label}.refExists 必须为合法的 @ref 格式（如 "@w1" 或 "@e4"）`
      };
    }
  }

  return { valid: true };
}

export function validateSingleAction(step, index = 0) {
  const prefix = `actions[${index}]`;
  if (!isPlainObject(step)) {
    return {
      valid: false,
      code: 'INVALID_ACTION_STEP',
      error: `${prefix} 必须为普通 JSON 对象`
    };
  }

  if (
    Object.hasOwn(step, '__proto__') ||
    Object.hasOwn(step, 'constructor') ||
    Object.hasOwn(step, 'prototype')
  ) {
    return {
      valid: false,
      code: 'INVALID_ACTION_STEP',
      error: `${prefix} 包含非法原型属性`
    };
  }

  const op = step.op;
  if (typeof op !== 'string' || !ALLOWED_OP_SET.has(op)) {
    return {
      valid: false,
      code: 'INVALID_ACTION_OP',
      error: `${prefix}.op "${String(op)}" 不受支持（仅允许: ${ALLOWED_ACTION_OPS.join(', ')}）`
    };
  }

  const hasRef = step.ref !== undefined && step.ref !== null;
  if (hasRef && (typeof step.ref !== 'string' || !REF_TOKEN_RE.test(step.ref.trim()))) {
    return {
      valid: false,
      code: 'INVALID_ACTION_ARG',
      error: `${prefix}.ref 必须为合法引用字符串（如 "@w1" 或 "@e5"）`
    };
  }

  const hasX = step.x !== undefined && step.x !== null;
  const hasY = step.y !== undefined && step.y !== null;
  if (hasX !== hasY) {
    return {
      valid: false,
      code: 'INVALID_ACTION_ARG',
      error: `${prefix} 坐标参数 x 与 y 必须成对提供`
    };
  }
  if (hasX && (!isValidCoord(step.x) || !isValidCoord(step.y))) {
    return {
      valid: false,
      code: 'INVALID_ACTION_ARG',
      error: `${prefix} 坐标 x / y 必须为有限数值`
    };
  }

  if (step.timeoutMs !== undefined && step.timeoutMs !== null) {
    if (
      typeof step.timeoutMs !== 'number' ||
      !Number.isFinite(step.timeoutMs) ||
      step.timeoutMs < 0 ||
      step.timeoutMs > 60_000
    ) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix}.timeoutMs 必须为 0..60000 之间的数值`
      };
    }
  }

  if (op === 'click' || op === 'double_click' || op === 'right_click') {
    if (!hasRef && !hasX) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix} (${op}) 必须提供 ref 或 (x, y) 坐标`
      };
    }
  } else if (op === 'focus_ref') {
    if (!hasRef) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix} (focus_ref) 必须提供目标 ref`
      };
    }
  } else if (op === 'type_text') {
    if (typeof step.text !== 'string' || step.text.length > 8192) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix}.text 必须为长度 <= 8192 的字符串`
      };
    }
  } else if (op === 'press_key') {
    if (typeof step.key !== 'string' || !step.key.trim() || step.key.length > 64) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix}.key 必须为非空按键名称字符串`
      };
    }
  } else if (op === 'scroll') {
    if (typeof step.deltaY !== 'number' || !Number.isFinite(step.deltaY)) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix}.deltaY 必须为有限数值`
      };
    }
    if (step.deltaX !== undefined && step.deltaX !== null) {
      if (typeof step.deltaX !== 'number' || !Number.isFinite(step.deltaX)) {
        return {
          valid: false,
          code: 'INVALID_ACTION_ARG',
          error: `${prefix}.deltaX 必须为有限数值`
        };
      }
    }
  } else if (op === 'select_option') {
    if (!hasRef) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix} (select_option) 必须提供下拉控件 ref`
      };
    }
    const optVal = step.text ?? step.value ?? step.option;
    if (typeof optVal !== 'string' || optVal.length > 512) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix} (select_option) 必须提供字符串类型的 text 或 value`
      };
    }
  }

  if (step.mouseMode !== undefined && step.mouseMode !== null) {
    if (
      typeof step.mouseMode !== 'string' ||
      !['courteous', 'strict_virtual', 'physical'].includes(step.mouseMode.trim().toLowerCase())
    ) {
      return {
        valid: false,
        code: 'INVALID_ACTION_ARG',
        error: `${prefix}.mouseMode 仅允许 courteous, strict_virtual 或 physical`
      };
    }
  }

  const preValid = validateAssertionSpec(step.expectBefore, `${prefix}.expectBefore`);
  if (!preValid.valid) return preValid;

  const postValid = validateAssertionSpec(step.expectAfter, `${prefix}.expectAfter`);
  if (!postValid.valid) return postValid;

  return { valid: true };
}

export function validateBatchActions(actions) {
  if (!Array.isArray(actions)) {
    return {
      valid: false,
      code: 'INVALID_BATCH_LENGTH',
      error: 'actions 必须为数组'
    };
  }
  if (actions.length < MIN_BATCH_ACTIONS || actions.length > MAX_BATCH_ACTIONS) {
    return {
      valid: false,
      code: 'INVALID_BATCH_LENGTH',
      error: `actions 步数必须在 ${MIN_BATCH_ACTIONS}..${MAX_BATCH_ACTIONS} 之间（收到 ${actions.length} 步）`
    };
  }

  for (let i = 0; i < actions.length; i++) {
    const check = validateSingleAction(actions[i], i);
    if (!check.valid) {
      return { ...check, failedStepIndex: i };
    }
  }

  return { valid: true };
}

function collectObservationRefsAndText(observation) {
  const refs = new Set();
  const textChunks = [];

  if (!observation || typeof observation !== 'object') {
    return { title: '', url: '', refs, haystack: '' };
  }

  const title = String(
    observation.title ?? observation.windowTitle ?? observation.tabTitle ?? observation.window?.title ?? ''
  );
  const url = String(
    observation.url ?? observation.tabUrl ?? observation.window?.url ?? ''
  );

  if (title) textChunks.push(title);
  if (url) textChunks.push(url);
  if (typeof observation.rawText === 'string') textChunks.push(observation.rawText);
  if (typeof observation.summary === 'string') textChunks.push(observation.summary);

  const visit = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue;
      const rawRef = String(el.ref ?? el.id ?? '').trim();
      if (rawRef) {
        refs.add(rawRef.startsWith('@') ? rawRef : `@${rawRef}`);
      }
      for (const field of [el.name, el.label, el.ariaLabel, el.text, el.value, el.title]) {
        if (typeof field === 'string' && field && !el.isPassword && !el.redacted) {
          textChunks.push(field);
        }
      }
      if (Array.isArray(el.children)) {
        visit(el.children);
      }
    }
  };

  visit(observation.elements);
  visit(observation.nodes);
  if (Array.isArray(observation.tree)) {
    visit(observation.tree);
  } else if (observation.tree && typeof observation.tree === 'object') {
    visit([observation.tree]);
  }

  return {
    title,
    url,
    refs,
    haystack: textChunks.join('\n')
  };
}

/**
 * Evaluates an expectBefore / expectAfter declarative assertion object against an observation.
 */
export function evaluateAssertion(assertion, observation) {
  if (!assertion) {
    return { passed: true };
  }
  if (!observation || typeof observation !== 'object') {
    return {
      passed: false,
      code: 'ASSERTION_FAILED',
      failedKey: 'observation',
      reason: '缺少可供断言比对的界面观察快照'
    };
  }

  const { title, url, refs, haystack } = collectObservationRefsAndText(observation);

  if (typeof assertion.titleContains === 'string') {
    if (!title.includes(assertion.titleContains)) {
      return {
        passed: false,
        code: 'ASSERTION_FAILED',
        failedKey: 'titleContains',
        expected: assertion.titleContains,
        actual: title,
        reason: `窗口/标签标题 "${title}" 未包含预期子串 "${assertion.titleContains}"`
      };
    }
  }

  if (typeof assertion.urlStartsWith === 'string') {
    if (!url.startsWith(assertion.urlStartsWith)) {
      return {
        passed: false,
        code: 'ASSERTION_FAILED',
        failedKey: 'urlStartsWith',
        expected: assertion.urlStartsWith,
        actual: url,
        reason: `当前 URL "${url}" 未以 "${assertion.urlStartsWith}" 开头`
      };
    }
  }

  if (assertion.refExists !== undefined) {
    const requiredRefs = Array.isArray(assertion.refExists)
      ? assertion.refExists
      : [assertion.refExists];
    for (const r of requiredRefs) {
      const cleanRef = String(r).trim();
      if (!refs.has(cleanRef)) {
        return {
          passed: false,
          code: 'ASSERTION_FAILED',
          failedKey: 'refExists',
          expected: cleanRef,
          actual: [...refs].slice(0, 20),
          reason: `未在当前观察树中找到目标引用 ${cleanRef}`
        };
      }
    }
  }

  if (typeof assertion.textContains === 'string') {
    if (!haystack.includes(assertion.textContains)) {
      return {
        passed: false,
        code: 'ASSERTION_FAILED',
        failedKey: 'textContains',
        expected: assertion.textContains,
        reason: `当前界面文本中未找到预期内容 "${assertion.textContains}"`
      };
    }
  }

  return { passed: true };
}

/**
 * Bounded in-memory TTL cache (default 5 min, max 256 entries) for Idempotency-Key deduplication.
 */
export function createIdempotencyCache({
  ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
  maxEntries = DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
  nowFn = Date.now
} = {}) {
  const store = new Map();

  function prune(now = nowFn()) {
    for (const [k, entry] of store.entries()) {
      if (now - entry.createdAt >= ttlMs) {
        store.delete(k);
      }
    }
  }

  function get(key) {
    if (typeof key !== 'string' || !key.trim()) return null;
    const cleanKey = key.trim();
    const now = nowFn();
    prune(now);
    const entry = store.get(cleanKey);
    if (!entry) return null;
    if (now - entry.createdAt >= ttlMs) {
      store.delete(cleanKey);
      return null;
    }
    return structuredClone(entry.value);
  }

  function set(key, value) {
    if (typeof key !== 'string' || !key.trim()) return;
    const cleanKey = key.trim();
    const now = nowFn();
    prune(now);
    if (store.has(cleanKey)) {
      store.delete(cleanKey);
    }
    while (store.size >= maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
    store.set(cleanKey, {
      createdAt: now,
      value: structuredClone(value)
    });
  }

  return {
    get,
    set,
    prune,
    clear: () => store.clear(),
    get size() {
      prune();
      return store.size;
    }
  };
}

function defaultSleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEscAbortPayload(payloadOrErr) {
  if (!payloadOrErr || typeof payloadOrErr !== 'object') return false;
  if (payloadOrErr.code === 'USER_ESC_ABORTED' || payloadOrErr.abortedByEsc === true) {
    return true;
  }
  const msg = String(payloadOrErr.message ?? payloadOrErr.error ?? payloadOrErr.reason ?? '');
  return /USER_ESC_ABORTED/i.test(msg);
}

function unwrapObservation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.observation && typeof raw.observation === 'object') {
    return raw.observation;
  }
  if (
    Array.isArray(raw.elements) ||
    Array.isArray(raw.nodes) ||
    raw.tree ||
    raw.title !== undefined ||
    raw.windowTitle !== undefined ||
    raw.url !== undefined ||
    raw.window !== undefined
  ) {
    return raw;
  }
  return null;
}

/**
 * Creates a declarative batch_actions execution engine.
 */
export function createBatchEngine({
  brokerClient = null,
  observeFn = null,
  actFn = null,
  pauseHandoffFn = null,
  minPacingMs = DEFAULT_MIN_PACING_MS,
  idempotencyTtlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
  idempotencyMaxEntries = DEFAULT_IDEMPOTENCY_MAX_ENTRIES,
  nowFn = Date.now,
  sleepFn = defaultSleep
} = {}) {
  const idempotencyCache = createIdempotencyCache({
    ttlMs: idempotencyTtlMs,
    maxEntries: idempotencyMaxEntries,
    nowFn
  });

  const doObserve = observeFn || (brokerClient ? (p) => brokerClient.observe(p) : null);
  const doAct = actFn || (brokerClient ? (step, meta) => brokerClient.act(step, meta) : null);
  const doPauseHandoff =
    pauseHandoffFn || (brokerClient ? (info) => brokerClient.pauseHandoff(info) : null);

  async function triggerCaptchaHandoff(captchaInfo) {
    if (typeof doPauseHandoff === 'function') {
      try {
        await doPauseHandoff({
          code: 'CAPTCHA_DETECTED',
          kind: captchaInfo.kind,
          reason: captchaInfo.reason
        });
      } catch {
        // Preserve CAPTCHA handoff short-circuit even if broker already transitioned state.
      }
    }
  }

  function evaluateSnapshotContextSafety(obs) {
    if (!obs || typeof obs !== 'object') {
      return { allowed: true, code: 'OK' };
    }
    const winTarget = obs.window ?? ((obs.processName || obs.windowTitle || obs.title) ? obs : null);
    if (winTarget) {
      const winSafety = evaluateWindowSafety(winTarget);
      if (!winSafety.allowed) return winSafety;
    }
    if (typeof obs.url === 'string' && obs.url.trim()) {
      const urlSafety = evaluateUrlSafety(obs.url, { mode: 'act', readOnly: false });
      if (!urlSafety.allowed) return urlSafety;
    }
    return { allowed: true, code: 'OK' };
  }

  async function runBatch({
    actions,
    idempotencyKey = '',
    target = 'auto',
    windowId,
    hwnd,
    tabId,
    mouseMode,
    includeScreenshot = false,
    initialObservation = null,
    minPacingMs: callPacingMs
  } = {}) {
    const validation = validateBatchActions(actions);
    if (!validation.valid) {
      return {
        ok: false,
        code: validation.code,
        error: validation.error,
        failedStepIndex: validation.failedStepIndex ?? 0,
        completedSteps: 0,
        totalSteps: Array.isArray(actions) ? actions.length : 0,
        stepResults: [],
        deduplicated: false
      };
    }

    const cleanIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    const batchFingerprint = cleanIdempotencyKey
      ? crypto
          .createHash('sha256')
          .update(JSON.stringify({ target, windowId: windowId ?? null, hwnd: hwnd ?? null, tabId: tabId ?? null, actions }))
          .digest('hex')
      : '';
    if (cleanIdempotencyKey) {
      const cached = idempotencyCache.get(cleanIdempotencyKey);
      if (cached) {
        if (cached._fingerprint && cached._fingerprint !== batchFingerprint) {
          return {
            ok: false,
            code: 'IDEMPOTENCY_CONFLICT',
            error: `幂等键 "${cleanIdempotencyKey}" 已被用于不同的动作载荷，拒绝覆盖执行`,
            completedSteps: 0,
            totalSteps: actions.length,
            stepResults: [],
            deduplicated: false
          };
        }
        const { _fingerprint: _omitted, ...cleanCached } = cached;
        return {
          ...cleanCached,
          deduplicated: true,
          idempotencyHit: true
        };
      }
    }

    if (typeof doAct !== 'function') {
      throw new Error('Batch engine requires brokerClient.act or actFn');
    }

    const effectivePacingMs =
      callPacingMs !== undefined && callPacingMs !== null
        ? Math.max(0, Number(callPacingMs))
        : Math.max(0, Number(minPacingMs));

    const stepResults = [];
    const finishAndCache = (outcome) => {
      const payload = {
        ...outcome,
        idempotencyKey: cleanIdempotencyKey || null,
        deduplicated: false
      };
      if (
        cleanIdempotencyKey &&
        outcome?.code !== 'CONSENT_DENIED' &&
        outcome?.code !== 'CONSENT_REQUIRED'
      ) {
        idempotencyCache.set(cleanIdempotencyKey, {
          ...payload,
          _fingerprint: batchFingerprint
        });
      }
      return payload;
    };

    // 1. Acquire initial observation if not supplied by caller.
    let rawInitial = initialObservation;
    if (!rawInitial && typeof doObserve === 'function') {
      try {
        const obsResp = await doObserve({ target, windowId, hwnd, tabId, includeScreenshot: false });
        if (isEscAbortPayload(obsResp)) {
          return finishAndCache({
            ok: false,
            status: 'DISARMED',
            code: 'USER_ESC_ABORTED',
            abortedByEsc: true,
            handoffRequired: true,
            error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即停止所有操控动作',
            completedSteps: 0,
            totalSteps: actions.length,
            stepResults
          });
        }
        if (obsResp?.code === 'CONSENT_DENIED' || obsResp?.code === 'CONSENT_REQUIRED') {
          return {
            ok: false,
            status: 'DISARMED',
            code: obsResp.code,
            handoffRequired: obsResp.code === 'CONSENT_DENIED',
            error: obsResp.code === 'CONSENT_REQUIRED'
              ? '尚未授予操控权限 (CONSENT_REQUIRED)'
              : '用户拒绝授予操控权限 (CONSENT_DENIED)',
            completedSteps: 0,
            totalSteps: actions.length,
            stepResults,
            idempotencyKey: cleanIdempotencyKey || null,
            deduplicated: false
          };
        }
        rawInitial = unwrapObservation(obsResp);
      } catch (obsErr) {
        if (isEscAbortPayload(obsErr)) {
          return finishAndCache({
            ok: false,
            status: 'DISARMED',
            code: 'USER_ESC_ABORTED',
            abortedByEsc: true,
            handoffRequired: true,
            error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即停止所有操控动作',
            completedSteps: 0,
            totalSteps: actions.length,
            stepResults
          });
        }
        throw obsErr;
      }
    }

    if (rawInitial) {
      const initCaptcha = detectCaptchaOrChallenge(rawInitial);
      if (initCaptcha.detected) {
        await triggerCaptchaHandoff(initCaptcha);
        return finishAndCache({
          ok: false,
          status: 'PAUSED_HANDOFF',
          code: 'CAPTCHA_DETECTED',
          handoffRequired: true,
          handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]',
          captchaKind: initCaptcha.kind,
          error: `[HANDOFF REQUIRED: CAPTCHA_DETECTED] ${initCaptcha.reason}，已自动暂停并转交人工完成验证`,
          completedSteps: 0,
          totalSteps: actions.length,
          stepResults
        });
      }

      const initSafety = evaluateSnapshotContextSafety(rawInitial);
      if (!initSafety.allowed) {
        return finishAndCache({
          ok: false,
          code: initSafety.code,
          blockedBySafety: true,
          error: initSafety.reason,
          completedSteps: 0,
          totalSteps: actions.length,
          stepResults
        });
      }
    }

    const baselineObs = rawInitial ? sanitizeObservationTree(rawInitial) : null;
    let currentObs = baselineObs;
    let mutatingStepsExecuted = 0;
    let lastMutatingFinishedAt = null;
    let lastStepObservedFreshly = false;

    // 2. Execute declarative actions sequentially with assertions, safety checks, and pacing.
    for (let i = 0; i < actions.length; i++) {
      const step = actions[i];
      lastStepObservedFreshly = false;

      const stepSafety = evaluateActionSafety(step, {
        observation: currentObs,
        window: currentObs?.window,
        url: currentObs?.url
      });
      if (!stepSafety.allowed) {
        return finishAndCache({
          ok: false,
          code: stepSafety.code,
          blockedBySafety: true,
          error: stepSafety.reason,
          failedStepIndex: i,
          completedSteps: i,
          totalSteps: actions.length,
          stepResults,
          observation: currentObs,
          diff: computeObservationDiff(baselineObs, currentObs)
        });
      }

      if (step.expectBefore) {
        if (!currentObs && typeof doObserve === 'function') {
          const preObsResp = await doObserve({ target, windowId, hwnd, tabId, includeScreenshot: false });
          if (isEscAbortPayload(preObsResp)) {
            return finishAndCache({
              ok: false,
              status: 'DISARMED',
              code: 'USER_ESC_ABORTED',
              abortedByEsc: true,
              handoffRequired: true,
              error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即中止执行',
              failedStepIndex: i,
              completedSteps: i,
              totalSteps: actions.length,
              stepResults
            });
          }
          const unwrappedPre = unwrapObservation(preObsResp);
          if (unwrappedPre) {
            const preCaptcha = detectCaptchaOrChallenge(unwrappedPre);
            if (preCaptcha.detected) {
              await triggerCaptchaHandoff(preCaptcha);
              return finishAndCache({
                ok: false,
                status: 'PAUSED_HANDOFF',
                code: 'CAPTCHA_DETECTED',
                handoffRequired: true,
                handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]',
                captchaKind: preCaptcha.kind,
                error: `[HANDOFF REQUIRED: CAPTCHA_DETECTED] ${preCaptcha.reason}`,
                failedStepIndex: i,
                completedSteps: i,
                totalSteps: actions.length,
                stepResults
              });
            }
            currentObs = sanitizeObservationTree(unwrappedPre);
          }
        }

        const preCheck = evaluateAssertion(step.expectBefore, currentObs);
        if (!preCheck.passed) {
          return finishAndCache({
            ok: false,
            code: 'EXPECT_BEFORE_FAILED',
            assertionStage: 'expectBefore',
            failedStepIndex: i,
            failedAssertion: preCheck,
            error: `第 ${i + 1} 步前置断言 (expectBefore) 未通过：${preCheck.reason}`,
            completedSteps: i,
            totalSteps: actions.length,
            stepResults,
            observation: currentObs,
            diff: computeObservationDiff(baselineObs, currentObs)
          });
        }
      }

      const isMutating = step.op !== 'wait_for';
      if (
        isMutating &&
        mutatingStepsExecuted > 0 &&
        effectivePacingMs > 0 &&
        lastMutatingFinishedAt !== null
      ) {
        const elapsed = nowFn() - lastMutatingFinishedAt;
        if (elapsed < effectivePacingMs) {
          await sleepFn(effectivePacingMs - elapsed);
        }
      }

      let actResp;
      try {
        const effectiveStepMouseMode = step.mouseMode ?? mouseMode;
        const wireStep = {
          ...step,
          ...(step.clear === undefined && step.clearFirst !== undefined ? { clear: Boolean(step.clearFirst) } : {}),
          ...(effectiveStepMouseMode ? { mouseMode: effectiveStepMouseMode } : {})
        };
        actResp = await doAct(wireStep, {
          stepIndex: i,
          target,
          windowId,
          hwnd,
          tabId,
          ...(effectiveStepMouseMode ? { mouseMode: effectiveStepMouseMode } : {}),
          idempotencyKey: cleanIdempotencyKey ? `${cleanIdempotencyKey}:${i}` : undefined
        });
      } catch (actErr) {
        if (isEscAbortPayload(actErr)) {
          return finishAndCache({
            ok: false,
            status: 'DISARMED',
            code: 'USER_ESC_ABORTED',
            abortedByEsc: true,
            handoffRequired: true,
            error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即中止后续动作',
            failedStepIndex: i,
            completedSteps: i,
            totalSteps: actions.length,
            stepResults
          });
        }
        throw actErr;
      }

      if (isEscAbortPayload(actResp)) {
        return finishAndCache({
          ok: false,
          status: 'DISARMED',
          code: 'USER_ESC_ABORTED',
          abortedByEsc: true,
          handoffRequired: true,
          error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即中止后续动作',
          failedStepIndex: i,
          completedSteps: i,
          totalSteps: actions.length,
          stepResults
        });
      }

      if (actResp?.code === 'CONSENT_DENIED' || actResp?.code === 'CONSENT_REQUIRED') {
        const denyPayload = {
          ok: false,
          status: 'DISARMED',
          code: actResp.code,
          handoffRequired: actResp.code === 'CONSENT_DENIED',
          error: actResp.code === 'CONSENT_REQUIRED'
            ? '执行动作前需要授予操控权限 (CONSENT_REQUIRED)'
            : '操控授权已被拒绝或撤销 (CONSENT_DENIED)',
          failedStepIndex: i,
          completedSteps: i,
          totalSteps: actions.length,
          stepResults,
          idempotencyKey: cleanIdempotencyKey || null,
          deduplicated: false
        };
        // Only skip caching when i === 0 (zero side effects executed); if i > 0, cache partial progress so retrying same key never re-runs step 0..i-1
        return i === 0 ? denyPayload : finishAndCache(denyPayload);
      }

      if (actResp && actResp.ok === false) {
        return finishAndCache({
          ok: false,
          code: actResp.code || 'STEP_EXECUTION_FAILED',
          error: String(actResp.error?.message ?? actResp.error ?? actResp.message ?? `第 ${i + 1} 步 (${step.op}) 执行失败`),
          failedStepIndex: i,
          completedSteps: i,
          totalSteps: actions.length,
          stepResults,
          observation: currentObs,
          diff: computeObservationDiff(baselineObs, currentObs)
        });
      }

      if (step.op === 'wait_for' && step.timeoutMs && !actResp?.waitedMs && effectivePacingMs > 0) {
        await sleepFn(Math.min(step.timeoutMs, 5_000));
      }

      if (isMutating) {
        mutatingStepsExecuted += 1;
        lastMutatingFinishedAt = nowFn();
      }

      const inlineObs = actResp?.observation && typeof actResp.observation === 'object'
        ? actResp.observation
        : null;

      if (inlineObs) {
        const inlineCaptcha = detectCaptchaOrChallenge(inlineObs);
        if (inlineCaptcha.detected) {
          await triggerCaptchaHandoff(inlineCaptcha);
          return finishAndCache({
            ok: false,
            status: 'PAUSED_HANDOFF',
            code: 'CAPTCHA_DETECTED',
            handoffRequired: true,
            handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]',
            captchaKind: inlineCaptcha.kind,
            error: `[HANDOFF REQUIRED: CAPTCHA_DETECTED] ${inlineCaptcha.reason}`,
            failedStepIndex: i,
            completedSteps: i + 1,
            totalSteps: actions.length,
            stepResults
          });
        }
        const inlineSafety = evaluateSnapshotContextSafety(inlineObs);
        if (!inlineSafety.allowed) {
          return finishAndCache({
            ok: false,
            code: inlineSafety.code,
            blockedBySafety: true,
            error: inlineSafety.reason,
            failedStepIndex: i,
            completedSteps: i + 1,
            totalSteps: actions.length,
            stepResults
          });
        }
        currentObs = sanitizeObservationTree(inlineObs);
        lastStepObservedFreshly = true;
      }

      // Auto re-observe tree whenever expectAfter is specified on the step!
      if (step.expectAfter) {
        if (typeof doObserve !== 'function') {
          return finishAndCache({
            ok: false,
            code: 'OBSERVE_UNAVAILABLE',
            error: '当前执行上下文未提供 observeFn，无法校验 expectAfter 断言',
            failedStepIndex: i,
            completedSteps: i + 1,
            totalSteps: actions.length,
            stepResults
          });
        }

        const postObsResp = await doObserve({
          target,
          windowId,
          hwnd,
          tabId,
          includeScreenshot: i === actions.length - 1 ? Boolean(includeScreenshot) : false
        });

        if (isEscAbortPayload(postObsResp)) {
          return finishAndCache({
            ok: false,
            status: 'DISARMED',
            code: 'USER_ESC_ABORTED',
            abortedByEsc: true,
            handoffRequired: true,
            error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即中止后续动作',
            failedStepIndex: i,
            completedSteps: i + 1,
            totalSteps: actions.length,
            stepResults
          });
        }

        const freshObs = unwrapObservation(postObsResp);
        if (freshObs) {
          const postCaptcha = detectCaptchaOrChallenge(freshObs);
          if (postCaptcha.detected) {
            await triggerCaptchaHandoff(postCaptcha);
            return finishAndCache({
              ok: false,
              status: 'PAUSED_HANDOFF',
              code: 'CAPTCHA_DETECTED',
              handoffRequired: true,
              handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]',
              captchaKind: postCaptcha.kind,
              error: `[HANDOFF REQUIRED: CAPTCHA_DETECTED] ${postCaptcha.reason}`,
              failedStepIndex: i,
              completedSteps: i + 1,
              totalSteps: actions.length,
              stepResults
            });
          }

          const postSafety = evaluateSnapshotContextSafety(freshObs);
          if (!postSafety.allowed) {
            return finishAndCache({
              ok: false,
              code: postSafety.code,
              blockedBySafety: true,
              error: postSafety.reason,
              failedStepIndex: i,
              completedSteps: i + 1,
              totalSteps: actions.length,
              stepResults
            });
          }

          currentObs = sanitizeObservationTree(freshObs);
          lastStepObservedFreshly = true;
        }

        const postCheck = evaluateAssertion(step.expectAfter, currentObs);
        if (!postCheck.passed) {
          return finishAndCache({
            ok: false,
            code: 'EXPECT_AFTER_FAILED',
            assertionStage: 'expectAfter',
            failedStepIndex: i,
            failedAssertion: postCheck,
            error: `第 ${i + 1} 步后置断言 (expectAfter) 未通过：${postCheck.reason}`,
            completedSteps: i + 1,
            totalSteps: actions.length,
            stepResults,
            observation: currentObs,
            diff: computeObservationDiff(baselineObs, currentObs)
          });
        }
      }

      stepResults.push({
        index: i,
        op: step.op,
        ref: step.ref ?? actResp?.ref ?? null,
        delivery: actResp?.delivery ?? null,
        physicalCursorMoved: Boolean(actResp?.physicalCursorMoved),
        ok: true
      });
    }

    // 3. Re-observe once after the final step if not already fresh so incremental diff & CAPTCHA check are exact.
    if (!lastStepObservedFreshly && typeof doObserve === 'function') {
      try {
        const finalResp = await doObserve({
          target,
          windowId,
          hwnd,
          tabId,
          includeScreenshot: Boolean(includeScreenshot)
        });
        if (isEscAbortPayload(finalResp)) {
          return finishAndCache({
            ok: false,
            status: 'DISARMED',
            code: 'USER_ESC_ABORTED',
            abortedByEsc: true,
            handoffRequired: true,
            error: '[USER_ESC_ABORTED] 用户按下 Esc 急刹，已立即停止操控',
            completedSteps: actions.length,
            totalSteps: actions.length,
            stepResults
          });
        }
        const finalRaw = unwrapObservation(finalResp);
        if (finalRaw) {
          const finalCaptcha = detectCaptchaOrChallenge(finalRaw);
          if (finalCaptcha.detected) {
            await triggerCaptchaHandoff(finalCaptcha);
            return finishAndCache({
              ok: false,
              status: 'PAUSED_HANDOFF',
              code: 'CAPTCHA_DETECTED',
              handoffRequired: true,
              handoffTag: '[HANDOFF REQUIRED: CAPTCHA_DETECTED]',
              captchaKind: finalCaptcha.kind,
              error: `[HANDOFF REQUIRED: CAPTCHA_DETECTED] ${finalCaptcha.reason}`,
              completedSteps: actions.length,
              totalSteps: actions.length,
              stepResults
            });
          }
          const finalSafety = evaluateSnapshotContextSafety(finalRaw);
          if (!finalSafety.allowed) {
            return finishAndCache({
              ok: false,
              code: finalSafety.code,
              blockedBySafety: true,
              error: finalSafety.reason,
              completedSteps: actions.length,
              totalSteps: actions.length,
              stepResults
            });
          }
          currentObs = sanitizeObservationTree(finalRaw);
        }
      } catch {
        // Keep last valid observation if optional trailing diff poll encounters a non-fatal glitch.
      }
    }

    const diff = computeObservationDiff(baselineObs, currentObs);
    return finishAndCache({
      ok: true,
      code: 'OK',
      completedSteps: actions.length,
      totalSteps: actions.length,
      stepResults,
      observation: currentObs,
      diff
    });
  }

  return {
    runBatch,
    idempotencyCache
  };
}
