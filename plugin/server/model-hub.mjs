// SPDX-License-Identifier: MIT
/**
 * Zero-dependency streaming Model Consultation Hub & anti-DNS-rebinding public
 * web search helper for Anti-Claude Prism Suite.
 *
 * Security & reliability invariants:
 * - Zero external dependencies (Node >= 22 built-in modules only).
 * - Multi-byte UTF-8 safe SSE parser (`TextDecoder` stream mode) with TTFT,
 *   idle-chunk, and total timeouts, deterministic timer cleanup, and mid-stream
 *   error frame detection (`event: error`, `{"error": ...}`, `{"type": "error"}`).
 * - Native support for `openai-chat`, `openai-responses`, and `anthropic-messages`
 *   with non-streaming JSON fallback and 1-hop cycle-safe fallback routing.
 * - Strict SSRF / DNS-rebinding elimination for public web search: HTTPS only,
 *   verifies ALL resolved DNS records via `isPublicRoutableIp`, pins the verified
 *   public IP via custom `https.request` `lookup` while preserving TLS SNI,
 *   re-verifies redirects (max 2 hops), and caps response bodies at 256 KB.
 * - Redacts outbound private keys and API credentials by default, and never
 *   exposes `baseUrl`, `apiKeyEnv`, or secrets in `listModelsForMcp`.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { TIER_DEFINITIONS, VALID_TIERS } from './prism-profile.mjs';

export const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 30_000;
export const DEFAULT_IDLE_CHUNK_TIMEOUT_MS = 60_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 600_000;
export const MAX_SEARCH_RESPONSE_BYTES = 256 * 1024;
export const MAX_SEARCH_REDIRECTS = 2;
export const DEFAULT_PUBLIC_SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';

const RETRIABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const NON_RETRIABLE_AUTH_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * Redacts common private keys, tokens, and high-risk credentials from outbound prompts.
 */
export function redactOutboundText(text) {
  let out = String(text ?? '');
  if (!out) return '';

  // PEM private keys
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  // GitHub classic & fine-grained PATs
  out = out.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    '[REDACTED_GH_TOKEN]'
  );
  // OpenAI / Anthropic / Stripe / OpenRouter style sk-... keys
  out = out.replace(
    /\bsk-(?:proj-|ant-|live-|test-|or-v1-)?[A-Za-z0-9_-]{16,}\b/g,
    '[REDACTED_API_KEY]'
  );
  // Google API keys
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_GOOGLE_KEY]');
  // Slack tokens
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, '[REDACTED_SLACK_TOKEN]');
  // AWS access key IDs
  out = out.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  // Standard 3-segment JWTs
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    '[REDACTED_JWT]'
  );
  // Authorization Bearer tokens
  out = out.replace(/\b(Bearer[ \t]+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED_TOKEN]');

  return out;
}

function expandIpv6ToWords(rawIpv6) {
  let addr = rawIpv6.toLowerCase();
  if (addr.includes('%')) return null;

  // Convert trailing dotted-quad IPv4 (e.g. ::ffff:10.0.0.1) into two 16-bit hex groups
  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.indexOf('.', lastColon) !== -1) {
    const v4Part = addr.slice(lastColon + 1);
    if (!net.isIPv4(v4Part)) return null;
    const octets = v4Part.split('.').map((n) => Number(n));
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const dblParts = addr.split('::');
  if (dblParts.length > 2) return null;

  const parseSide = (part) => {
    if (!part) return [];
    return part.split(':').map((seg) => {
      if (!/^[0-9a-f]{1,4}$/.test(seg)) return -1;
      return parseInt(seg, 16);
    });
  };

  if (dblParts.length === 1) {
    const groups = parseSide(dblParts[0]);
    if (groups.length !== 8 || groups.some((n) => n < 0)) return null;
    return groups;
  }

  const left = parseSide(dblParts[0]);
  const right = parseSide(dblParts[1]);
  if (left.some((n) => n < 0) || right.some((n) => n < 0)) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

function wordsToIpv4(hiWord, loWord) {
  return `${(hiWord >> 8) & 0xff}.${hiWord & 0xff}.${(loWord >> 8) & 0xff}.${loWord & 0xff}`;
}

/**
 * Returns true ONLY if `ip` is a globally routable public unicast IPv4 or IPv6 address.
 * Blocks loopback, RFC1918, CGNAT/Tailscale (100.64.0.0/10), link-local, benchmarking/FakeIP
 * (198.18.0.0/15), multicast/reserved, ULA, IPv4-mapped non-public IPv6, NAT64, 6to4, and doc ranges.
 */
export function isPublicRoutableIp(ip) {
  if (typeof ip !== 'string') return false;
  let clean = ip.trim();
  if (!clean || clean.includes('%')) return false;
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.');
    if (parts.length !== 4) return false;
    const nums = parts.map((p) => (/^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : -1));
    if (nums.some((n) => n < 0 || n > 255)) return false;
    const [a, b, c] = nums;

    if (a === 0) return false; // 0.0.0.0/8 ("This" network)
    if (a === 10) return false; // 10.0.0.0/8 (RFC1918)
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (CGNAT / Tailscale)
    if (a === 127) return false; // 127.0.0.0/8 (Loopback)
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 (RFC1918)
    if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24 (IETF protocol assignments)
    if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 168) return false; // 192.168.0.0/16 (RFC1918)
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 (Benchmarking / FakeIP)
    if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 (TEST-NET-2)
    if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 (TEST-NET-3)
    if (a >= 224) return false; // 224.0.0.0/4 Multicast + 240.0.0.0/4 Reserved/Broadcast

    return true;
  }

  if (net.isIPv6(clean)) {
    const g = expandIpv6ToWords(clean);
    if (!g) return false;

    const allZeroPrefix6 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    // :: (Unspecified) and ::1 (Loopback) and deprecated IPv4-compatible ::w.x.y.z
    if (allZeroPrefix6) {
      if (g[6] === 0 && (g[7] === 0 || g[7] === 1)) return false;
      return isPublicRoutableIp(wordsToIpv4(g[6], g[7]));
    }

    // IPv4-mapped ::ffff:0:0/96
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isPublicRoutableIp(wordsToIpv4(g[6], g[7]));
    }

    // IPv4-translated ::ffff:0:0:0/96
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) {
      return isPublicRoutableIp(wordsToIpv4(g[6], g[7]));
    }

    // NAT64 Well-Known Prefix 64:ff9b::/96 & Local-Use 64:ff9b:1::/48
    if (g[0] === 0x0064 && g[1] === 0xff9b) {
      if (g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
        return isPublicRoutableIp(wordsToIpv4(g[6], g[7]));
      }
      if (g[2] === 1) return false;
    }

    // 6to4 2002::/16 embeds IPv4 in g[1], g[2]
    if (g[0] === 0x2002) {
      return isPublicRoutableIp(wordsToIpv4(g[1], g[2]));
    }

    // Discard-Only 100::/64
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return false;

    // Documentation 2001:db8::/32 & Benchmarking 2001:2::/48 & Teredo 2001:0000::/32
    if (g[0] === 0x2001) {
      if (g[1] === 0x0db8) return false;
      if (g[1] === 0x0002 && g[2] === 0) return false;
      if (g[1] === 0x0000) return false;
    }

    // Unique Local fc00::/7
    if ((g[0] & 0xfe00) === 0xfc00) return false;

    // Link-Local fe80::/10 & deprecated Site-Local fec0::/10
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return false;

    // Multicast ff00::/8
    if ((g[0] & 0xff00) === 0xff00) return false;

    return true;
  }

  return false;
}

function createUpstreamError(message, {
  code = 'UPSTREAM_ERROR',
  status = 0,
  retriable = false,
  isStreamError = false,
  cause
} = {}) {
  const safeMessage = redactOutboundText(String(message || 'Upstream gateway error')).slice(0, 400);
  const err = new Error(safeMessage, cause ? { cause } : undefined);
  err.name = 'ModelHubUpstreamError';
  err.code = code;
  if (status) err.status = status;
  err.retriable = Boolean(retriable);
  err.isStreamError = Boolean(isStreamError);
  return err;
}

function createStreamTimeoutError(code, label, timeoutMs) {
  const err = new Error(`${label} (${timeoutMs}ms)`);
  err.name = 'AbortError';
  err.code = code;
  err.errno = 'ETIMEDOUT';
  err.retriable = true;
  return err;
}

function extractEmbeddedErrorDetails(errPayload) {
  if (typeof errPayload === 'string') {
    return { message: errPayload, status: 502, type: '' };
  }
  if (!errPayload || typeof errPayload !== 'object') {
    return { message: 'SSE upstream error frame', status: 502, type: '' };
  }
  const inner = errPayload.error && typeof errPayload.error === 'object'
    ? errPayload.error
    : errPayload;

  const rawStatus = Number(inner.status ?? inner.httpStatus ?? errPayload.status ?? inner.code);
  const errType = String(inner.type || errPayload.type || inner.code || '').toLowerCase();
  let status = Number.isFinite(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 0;
  if (!status) {
    if (errType.includes('rate_limit') || errType === '429') status = 429;
    else if (errType.includes('overload')) status = 529;
    else if (errType.includes('authentication') || errType.includes('unauthorized')) status = 401;
    else if (errType.includes('permission') || errType.includes('forbidden')) status = 403;
    else status = 502;
  }

  const message = String(
    inner.message ||
    (typeof errPayload.error === 'string' ? errPayload.error : '') ||
    errPayload.message ||
    errType ||
    'Upstream SSE stream error'
  );

  return { message, status, type: errType };
}

function checkMidStreamErrorFrame(sseEvent) {
  const eventType = sseEvent.event || 'message';
  const rawData = String(sseEvent.data ?? '').trim();

  if (eventType === 'error') {
    let parsed = null;
    if (rawData.startsWith('{')) {
      try { parsed = JSON.parse(rawData); } catch {}
    }
    const { message, status } = extractEmbeddedErrorDetails(parsed || rawData || 'SSE error event');
    const retriable = !NON_RETRIABLE_AUTH_STATUSES.has(status);
    throw createUpstreamError(`SSE 流内错误事件: ${message}`, {
      code: 'SSE_STREAM_ERROR',
      status,
      retriable,
      isStreamError: true
    });
  }

  if (!rawData || rawData === '[DONE]' || !rawData.startsWith('{')) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return;
  }

  if (parsed.type === 'error' || parsed.type === 'response.failed') {
    const sourceObj = parsed.type === 'response.failed'
      ? (parsed.response?.error || parsed.error || { message: 'OpenAI Responses stream failed', status: 502 })
      : parsed;
    const { message, status } = extractEmbeddedErrorDetails(sourceObj);
    const retriable = !NON_RETRIABLE_AUTH_STATUSES.has(status);
    throw createUpstreamError(`SSE 流内错误帧: ${message}`, {
      code: 'SSE_STREAM_ERROR',
      status,
      retriable,
      isStreamError: true
    });
  }

  if (parsed.error !== undefined && parsed.error !== null && parsed.error !== false) {
    const { message, status } = extractEmbeddedErrorDetails(parsed);
    const retriable = !NON_RETRIABLE_AUTH_STATUSES.has(status);
    throw createUpstreamError(`SSE 流内错误帧: ${message}`, {
      code: 'SSE_STREAM_ERROR',
      status,
      retriable,
      isStreamError: true
    });
  }
}

function toChunkReader(streamOrResponse) {
  const source = streamOrResponse && typeof streamOrResponse === 'object' && 'body' in streamOrResponse && streamOrResponse.body
    ? streamOrResponse.body
    : streamOrResponse;

  if (!source) {
    throw createUpstreamError('SSE 响应流为空', {
      code: 'EMPTY_SSE_STREAM',
      status: 502,
      retriable: true
    });
  }

  // Web ReadableStream
  if (typeof source.getReader === 'function') {
    const reader = source.getReader();
    return {
      read: () => reader.read(),
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } catch {}
        try {
          reader.releaseLock();
        } catch {}
      }
    };
  }

  // AsyncIterable or Iterable (e.g. Node Readable, async generator, array of Buffers)
  const iterator = source[Symbol.asyncIterator]
    ? source[Symbol.asyncIterator]()
    : source[Symbol.iterator]
      ? source[Symbol.iterator]()
      : null;

  if (!iterator) {
    throw createUpstreamError('不支持的 SSE 输入流类型', {
      code: 'INVALID_SSE_STREAM',
      status: 500,
      retriable: false
    });
  }

  return {
    read: async () => {
      const next = await iterator.next();
      if (next.done) return { done: true, value: undefined };
      const val = typeof next.value === 'string'
        ? Buffer.from(next.value, 'utf8')
        : next.value;
      return { done: false, value: val };
    },
    cancel: async (reason) => {
      try {
        if (typeof source.destroy === 'function') {
          source.destroy(reason instanceof Error ? reason : undefined);
        } else if (typeof iterator.return === 'function') {
          await iterator.return();
        }
      } catch {}
    }
  };
}

/**
 * Pure Node zero-dependency SSE async generator.
 * - Multi-byte UTF-8 safe across arbitrary TCP packet boundaries (`TextDecoder` stream mode).
 * - Handles `\r\n`, `\n`, split `\r`/`\n` across chunks, comments, and multi-line `data:` concatenation.
 * - Enforces `firstByteTimeoutMs`, `idleChunkTimeoutMs`, and `totalTimeoutMs` via `AbortController`
 *   and cleans up all `setTimeout` handles deterministically in `finally`.
 * - Detects mid-stream error frames (`event: error`, `{"error": ...}`, `{"type": "error"}`).
 */
export async function* parseSseEvents(streamOrResponse, options = {}) {
  const firstByteTimeoutMs = options.firstByteTimeoutMs !== undefined
    ? Math.max(0, Number(options.firstByteTimeoutMs) || 0)
    : DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleChunkTimeoutMs = options.idleChunkTimeoutMs !== undefined
    ? Math.max(0, Number(options.idleChunkTimeoutMs) || 0)
    : DEFAULT_IDLE_CHUNK_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs !== undefined
    ? Math.max(0, Number(options.totalTimeoutMs) || 0)
    : DEFAULT_TOTAL_TIMEOUT_MS;
  const detectMidStreamErrors = options.detectMidStreamErrors !== false;
  const onFirstByte = typeof options.onFirstByte === 'function' ? options.onFirstByte : null;

  const internalController = options.abortController || new AbortController();
  const externalSignal = options.signal || null;

  let abortError = null;
  let rejectAbortPromise = null;
  const abortPromise = new Promise((_, reject) => {
    rejectAbortPromise = reject;
  });
  // Prevent unhandled rejection if abort fires while not actively awaited
  abortPromise.catch(() => {});

  const triggerAbort = (err) => {
    if (abortError) return;
    abortError = err;
    try {
      if (!internalController.signal.aborted) {
        internalController.abort(err);
      }
    } catch {}
    if (rejectAbortPromise) {
      rejectAbortPromise(err);
    }
  };

  const onExternalAbort = () => {
    const reason = externalSignal?.reason instanceof Error
      ? externalSignal.reason
      : Object.assign(new Error('Request aborted by caller'), {
        name: 'AbortError',
        code: 'CALLER_ABORTED',
        callerAborted: true,
        retriable: false
      });
    reason.callerAborted = true;
    triggerAbort(reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let totalTimer = null;
  let stepTimer = null;
  const clearStepTimer = () => {
    if (stepTimer !== null) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }
  };
  const clearAllTimers = () => {
    clearStepTimer();
    if (totalTimer !== null) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
  };

  if (totalTimeoutMs > 0 && !abortError) {
    totalTimer = setTimeout(() => {
      triggerAbort(createStreamTimeoutError('TOTAL_TIMEOUT', 'SSE 流总时长超时', totalTimeoutMs));
    }, totalTimeoutMs);
  }

  const reader = toChunkReader(streamOrResponse);
  const decoder = new TextDecoder('utf-8', { stream: true });

  let receivedFirstByte = Boolean(options.firstByteAlreadyReceived);
  let carryCr = '';
  let lineBuffer = '';
  let eventName = 'message';
  let eventId = '';
  let dataLines = [];
  let finishedCleanly = false;

  const flushCurrentEvent = () => {
    if (dataLines.length === 0 && eventName === 'message') {
      return null;
    }
    const evt = {
      event: eventName || 'message',
      data: dataLines.join('\n'),
      id: eventId
    };
    eventName = 'message';
    dataLines = [];
    if (detectMidStreamErrors) {
      checkMidStreamErrorFrame(evt);
    }
    return evt;
  };

  const processLine = (line) => {
    if (line === '') {
      return flushCurrentEvent();
    }
    if (line.startsWith(':')) {
      return null;
    }
    const colonIdx = line.indexOf(':');
    let field;
    let value;
    if (colonIdx === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
    }

    if (field === 'event') {
      eventName = value.trim() || 'message';
    } else if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'id' && !value.includes('\0')) {
      eventId = value;
    }
    return null;
  };

  try {
    while (true) {
      if (abortError) throw abortError;

      const stepLimitMs = !receivedFirstByte ? firstByteTimeoutMs : idleChunkTimeoutMs;
      if (stepLimitMs > 0) {
        const code = !receivedFirstByte ? 'FIRST_BYTE_TIMEOUT' : 'IDLE_CHUNK_TIMEOUT';
        const label = !receivedFirstByte ? 'SSE 首字节响应超时' : 'SSE 流间静默超时';
        stepTimer = setTimeout(() => {
          triggerAbort(createStreamTimeoutError(code, label, stepLimitMs));
        }, stepLimitMs);
      }

      let chunkResult;
      try {
        chunkResult = await Promise.race([reader.read(), abortPromise]);
      } finally {
        clearStepTimer();
      }

      if (abortError) throw abortError;

      if (chunkResult.done) {
        const tailText = carryCr + decoder.decode();
        carryCr = '';
        if (tailText) {
          lineBuffer += tailText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        }
        if (lineBuffer.length > 0) {
          const remainingLines = lineBuffer.split('\n');
          lineBuffer = '';
          for (const ln of remainingLines) {
            const dispatched = processLine(ln);
            if (dispatched) yield dispatched;
          }
        }
        const trailingEvt = flushCurrentEvent();
        if (trailingEvt) yield trailingEvt;
        finishedCleanly = true;
        break;
      }

      const rawChunk = chunkResult.value;
      if (!rawChunk || rawChunk.byteLength === 0) {
        continue;
      }

      if (!receivedFirstByte) {
        receivedFirstByte = true;
        if (onFirstByte) onFirstByte();
      }

      let decoded = carryCr + decoder.decode(rawChunk, { stream: true });
      if (decoded.endsWith('\r')) {
        carryCr = '\r';
        decoded = decoded.slice(0, -1);
      } else {
        carryCr = '';
      }

      if (!decoded) continue;

      const normalized = lineBuffer + decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const dispatched = processLine(line);
        if (dispatched) {
          yield dispatched;
        }
      }
    }
  } finally {
    clearAllTimers();
    if (externalSignal) {
      try {
        externalSignal.removeEventListener('abort', onExternalAbort);
      } catch {}
    }
    if (!finishedCleanly) {
      await reader.cancel(abortError || undefined);
    }
  }
}

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '--',
  hellip: '...',
  copy: '(c)'
});

export function decodeHtmlEntities(input) {
  return String(input ?? '').replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (full, dec, hex, named) => {
    if (dec !== undefined) {
      const cp = Number(dec);
      if (cp >= 0x20 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) && cp !== 0x7f) {
        return String.fromCodePoint(cp);
      }
      return ' ';
    }
    if (hex !== undefined) {
      const cp = parseInt(hex, 16);
      if (cp >= 0x20 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) && cp !== 0x7f) {
        return String.fromCodePoint(cp);
      }
      return ' ';
    }
    const lower = named.toLowerCase();
    return Object.hasOwn(NAMED_HTML_ENTITIES, lower) ? NAMED_HTML_ENTITIES[lower] : full;
  });
}

function stripTagsAndNormalizeText(htmlFragment, maxLen = 320) {
  const withoutTags = String(htmlFragment ?? '').replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeCandidateResultUrl(rawHref) {
  let href = decodeHtmlEntities(String(rawHref ?? '').trim());
  if (!href || /[\x00-\x1f\x7f]/.test(href)) return '';

  if (href.startsWith('//')) {
    href = `https:${href}`;
  } else if (href.startsWith('/l/?') || href.startsWith('/l?')) {
    href = `https://duckduckgo.com${href}`;
  }

  let parsed;
  try {
    parsed = new URL(href);
  } catch {
    return '';
  }

  // Unwrap DuckDuckGo redirect links (?uddg=https%3A%2F%2F...)
  const uddg = parsed.searchParams.get('uddg');
  if (uddg) {
    try {
      parsed = new URL(uddg);
    } catch {
      return '';
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }
  if (parsed.username || parsed.password) {
    return '';
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return '';

  // Skip internal DuckDuckGo navigation/ad tracker links
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) {
    return '';
  }
  // Never surface links pointing directly to private/non-public IP literals
  if (net.isIP(host) !== 0 && !isPublicRoutableIp(host)) {
    return '';
  }

  return parsed.toString();
}

/**
 * Safely extracts `{ title, url, snippet }` search results from raw HTML
 * without DOM dependencies: strips scripts/styles/comments, decodes entities,
 * and unwraps search redirect links.
 */
export function extractSearchResultsFromHtml(rawHtml, { maxResults = 6 } = {}) {
  const limit = Math.max(1, Math.min(20, Number(maxResults) || 6));
  const cleanedHtml = String(rawHtml ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  const results = [];
  const seenUrls = new Set();

  const pushCandidate = (rawHref, rawTitleHtml, rawSnippetHtml) => {
    if (results.length >= limit) return;
    const url = normalizeCandidateResultUrl(rawHref);
    if (!url || seenUrls.has(url)) return;
    const title = stripTagsAndNormalizeText(rawTitleHtml, 160);
    if (!title) return;
    const snippet = stripTagsAndNormalizeText(rawSnippetHtml, 320);
    seenUrls.add(url);
    results.push({ title, url, snippet });
  };

  // Pass 1: DuckDuckGo HTML result anchors (`class="...result__a..."`) + nearest `result__snippet`
  const ddgAnchorRe = /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = ddgAnchorRe.exec(cleanedHtml)) !== null && results.length < limit) {
    const fullTag = match[0];
    const hrefMatch = fullTag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i);
    const rawHref = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : '';
    const windowAfter = cleanedHtml.slice(match.index + fullTag.length, match.index + fullTag.length + 2400);
    const snippetMatch = windowAfter.match(
      /<(?:a|div|p|span)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|p|span)>/i
    );
    pushCandidate(rawHref, match[1], snippetMatch ? snippetMatch[1] : '');
  }

  if (results.length >= limit) {
    return results;
  }

  // Pass 2: Generic semantic HTML anchors (`<a href="https://...">Title</a>` + trailing text/snippet)
  const genericAnchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((match = genericAnchorRe.exec(cleanedHtml)) !== null && results.length < limit) {
    const attrs = match[1] || '';
    if (/\bresult__snippet\b/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
    const afterSlice = cleanedHtml.slice(match.index + match[0].length, match.index + match[0].length + 600);
    const nextAnchorIdx = afterSlice.search(/<a\b/i);
    const snippetRegion = nextAnchorIdx >= 0 ? afterSlice.slice(0, nextAnchorIdx) : afterSlice;
    const cleanedSnippet = stripTagsAndNormalizeText(snippetRegion, 320).replace(/^[-–—:|·]+\s*/, '');
    pushCandidate(rawHref, match[2], cleanedSnippet);
  }

  return results;
}

async function resolveAndVerifyPublicHost(hostname, lookupFn) {
  const bareHost = String(hostname || '').replace(/^\[|\]$/g, '').trim();
  if (!bareHost) {
    throw Object.assign(new Error('公网代搜 URL 缺少有效主机名'), {
      code: 'INVALID_SEARCH_URL'
    });
  }

  const literalFamily = net.isIP(bareHost);
  if (literalFamily !== 0) {
    if (!isPublicRoutableIp(bareHost)) {
      throw Object.assign(
        new Error(`公网代搜已拦截非公网目标 IP: ${bareHost}`),
        { code: 'SSRF_BLOCKED_IP', blockedIp: bareHost, host: bareHost }
      );
    }
    return { bareHost, verifiedIp: bareHost, family: literalFamily };
  }

  const rawRecords = await lookupFn(bareHost);
  const recordList = Array.isArray(rawRecords)
    ? rawRecords
    : rawRecords
      ? [rawRecords]
      : [];

  if (recordList.length === 0) {
    throw Object.assign(new Error(`DNS 解析未返回任何记录: ${bareHost}`), {
      code: 'DNS_EMPTY',
      host: bareHost
    });
  }

  const normalized = recordList.map((entry) => {
    if (typeof entry === 'string') {
      return { address: entry.trim(), family: net.isIP(entry.trim()) || 4 };
    }
    const addr = String(entry?.address || '').trim();
    return {
      address: addr,
      family: Number(entry?.family) || net.isIP(addr) || 4
    };
  });

  // Strict anti-DNS-rebinding policy: EVERY returned DNS record MUST be publicly routable.
  for (const rec of normalized) {
    if (!rec.address || !isPublicRoutableIp(rec.address)) {
      throw Object.assign(
        new Error(`公网代搜已拦截非公网或混合 DNS 记录 (${bareHost} -> ${rec.address || 'invalid'})`),
        { code: 'SSRF_BLOCKED_IP', blockedIp: rec.address, host: bareHost }
      );
    }
  }

  const chosen = normalized.find((r) => r.family === 4) || normalized[0];
  return {
    bareHost,
    verifiedIp: chosen.address,
    family: chosen.family
  };
}

function validateHttpsSearchUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw Object.assign(new Error('公网代搜 URL 不能为空'), {
      code: 'INVALID_SEARCH_URL'
    });
  }
  if (/[\x00-\x1f\x7f]/.test(rawUrl)) {
    throw Object.assign(new Error('公网代搜 URL 包含非法控制字符'), {
      code: 'INVALID_SEARCH_URL'
    });
  }
  const trimmed = rawUrl.trim();
  const authMatch = trimmed.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/);
  if (authMatch && authMatch[1].includes('@')) {
    throw Object.assign(new Error('公网代搜 URL 禁止内嵌凭据 (@)'), {
      code: 'INVALID_SEARCH_URL'
    });
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw Object.assign(new Error('公网代搜 URL 格式无效'), {
      code: 'INVALID_SEARCH_URL'
    });
  }

  if (parsed.protocol !== 'https:') {
    throw Object.assign(
      new Error(`公网代搜仅允许 https: 协议（收到 ${parsed.protocol}）`),
      { code: 'UNSAFE_SEARCH_PROTOCOL' }
    );
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('公网代搜 URL 禁止包含用户名或密码'), {
      code: 'INVALID_SEARCH_URL'
    });
  }
  return parsed;
}

function executePinnedHttpsGet({
  parsedUrl,
  bareHost,
  verifiedIp,
  family,
  maxBytes,
  timeoutMs
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req = null;

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (req) {
        try { req.destroy(); } catch {}
      }
      reject(err);
    };

    const finishResolve = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };

    const timer = setTimeout(() => {
      finishReject(
        Object.assign(new Error(`公网代搜请求超时 (${timeoutMs}ms)`), {
          code: 'SEARCH_TIMEOUT',
          errno: 'ETIMEDOUT'
        })
      );
    }, timeoutMs);

    const pinnedLookup = (_host, opts, cb) => {
      if (typeof opts === 'function') {
        opts(null, verifiedIp, family);
        return;
      }
      if (opts && opts.all) {
        cb(null, [{ address: verifiedIp, family }]);
        return;
      }
      cb(null, verifiedIp, family);
    };

    req = https.request(
      {
        protocol: 'https:',
        hostname: bareHost,
        port: parsedUrl.port ? Number(parsedUrl.port) : 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        agent: false,
        servername: net.isIP(bareHost) === 0 ? bareHost : undefined,
        lookup: pinnedLookup,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; AntiClaudePrismSuite/0.7)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'accept-encoding': 'identity',
          connection: 'close'
        }
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const headers = res.headers || {};

        if (statusCode >= 300 && statusCode < 400) {
          res.resume();
          finishResolve({ statusCode, headers, body: '' });
          return;
        }

        const declaredLen = Number(headers['content-length']);
        if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
          res.destroy();
          finishReject(
            Object.assign(new Error(`公网代搜响应体超过上限 (${maxBytes} bytes)`), {
              code: 'SEARCH_RESPONSE_TOO_LARGE'
            })
          );
          return;
        }

        const chunks = [];
        let totalBytes = 0;

        res.on('data', (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > maxBytes) {
            res.destroy();
            finishReject(
              Object.assign(new Error(`公网代搜响应体超过上限 (${maxBytes} bytes)`), {
                code: 'SEARCH_RESPONSE_TOO_LARGE'
              })
            );
            return;
          }
          chunks.push(buf);
        });

        res.on('error', (err) => finishReject(err));
        res.on('end', () => {
          const body = Buffer.concat(chunks, totalBytes).toString('utf8');
          finishResolve({ statusCode, headers, body });
        });
      }
    );

    req.on('error', (err) => finishReject(err));
    req.end();
  });
}

function buildInitialSearchUrl(cleanQuery, endpointUrl) {
  const base = endpointUrl ? String(endpointUrl).trim() : DEFAULT_PUBLIC_SEARCH_ENDPOINT;
  if (base.includes('{query}')) {
    return base.replace(/\{query\}/g, encodeURIComponent(cleanQuery));
  }
  const parsed = validateHttpsSearchUrl(base);
  if (!parsed.searchParams.has('q')) {
    parsed.searchParams.set('q', cleanQuery);
  }
  return parsed.toString();
}

/**
 * Zero-key public web search with full DNS-rebinding (TOCTOU) elimination.
 */
export async function searchPublicWebSafe(query, options = {}) {
  const redactQuery = options.redactQuery !== false;
  const rawQuery = String(query ?? '').trim();
  const cleanQuery = (redactQuery ? redactOutboundText(rawQuery) : rawQuery)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 280);

  if (!cleanQuery) {
    throw Object.assign(new Error('搜索关键词不能为空'), {
      code: 'EMPTY_SEARCH_QUERY'
    });
  }

  const lookupFn = options.lookupFn || ((host) => dns.promises.lookup(host, { all: true }));
  const transportFn = options.transportFn || executePinnedHttpsGet;
  const maxRedirects = options.maxRedirects !== undefined
    ? Math.max(0, Math.min(MAX_SEARCH_REDIRECTS, Number(options.maxRedirects) || 0))
    : MAX_SEARCH_REDIRECTS;
  const maxBytes = options.maxBytes !== undefined
    ? Math.max(1024, Math.min(MAX_SEARCH_RESPONSE_BYTES, Number(options.maxBytes) || MAX_SEARCH_RESPONSE_BYTES))
    : MAX_SEARCH_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs !== undefined
    ? Math.max(500, Number(options.timeoutMs) || 12_000)
    : 12_000;
  const maxResults = options.maxResults !== undefined
    ? Math.max(1, Math.min(15, Number(options.maxResults) || 5))
    : 5;

  let currentUrl = buildInitialSearchUrl(cleanQuery, options.endpointUrl || options.url);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsedUrl = validateHttpsSearchUrl(currentUrl);
    const { bareHost, verifiedIp, family } = await resolveAndVerifyPublicHost(parsedUrl.hostname, lookupFn);

    const response = await transportFn({
      parsedUrl,
      bareHost,
      verifiedIp,
      family,
      maxBytes,
      timeoutMs
    });

    const status = Number(response?.statusCode) || 0;
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      if (hop >= maxRedirects) {
        throw Object.assign(new Error(`公网代搜重定向超过最大跳数 (${maxRedirects})`), {
          code: 'TOO_MANY_REDIRECTS'
        });
      }
      const rawLocation = Array.isArray(response.headers?.location)
        ? response.headers.location[0]
        : response.headers?.location;
      if (!rawLocation || typeof rawLocation !== 'string') {
        throw Object.assign(new Error('公网代搜收到无 Location 的重定向响应'), {
          code: 'INVALID_SEARCH_REDIRECT'
        });
      }
      currentUrl = new URL(rawLocation, currentUrl).toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      throw Object.assign(new Error(`公网代搜 HTTP 状态异常: ${status}`), {
        code: 'SEARCH_HTTP_ERROR',
        status
      });
    }

    const htmlBody = String(response?.body ?? '');
    if (Buffer.byteLength(htmlBody, 'utf8') > maxBytes) {
      throw Object.assign(new Error(`公网代搜响应体超过上限 (${maxBytes} bytes)`), {
        code: 'SEARCH_RESPONSE_TOO_LARGE'
      });
    }

    const results = extractSearchResultsFromHtml(htmlBody, { maxResults });
    return {
      ok: true,
      query: cleanQuery,
      results,
      verifiedIp,
      redirects: hop
    };
  }

  throw Object.assign(new Error('公网代搜重定向超限'), { code: 'TOO_MANY_REDIRECTS' });
}

function buildProtocolEndpoint(baseUrl, suffix) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  if (cleanBase.endsWith(suffix)) return cleanBase;
  return `${cleanBase}${suffix}`;
}

async function readBoundedResponseText(response, maxBytes = 4 * 1024 * 1024, throwOnOverflow = true) {
  const declared = Number(response?.headers?.get?.('content-length') || 0);
  if (throwOnOverflow && Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw createUpstreamError(`上游响应体超过上限 (${declared} > ${maxBytes} bytes)`, {
      code: 'RESPONSE_TOO_LARGE',
      status: 502,
      retriable: false
    });
  }
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parts = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = value instanceof Uint8Array ? value : Buffer.from(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          if (throwOnOverflow) {
            throw createUpstreamError(`上游响应体超过上限 (> ${maxBytes} bytes)`, {
              code: 'RESPONSE_TOO_LARGE',
              status: 502,
              retriable: false
            });
          }
          const keep = Math.max(0, maxBytes - (total - chunk.byteLength));
          if (keep > 0) parts.push(decoder.decode(chunk.subarray(0, keep), { stream: false }));
          return parts.join('');
        }
        parts.push(decoder.decode(chunk, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join('');
    } finally {
      try { reader.releaseLock?.(); } catch {}
    }
  }
  if (typeof response?.text === 'function') {
    const txt = await response.text();
    const byteLen = Buffer.byteLength(txt, 'utf8');
    if (byteLen > maxBytes) {
      if (throwOnOverflow) {
        throw createUpstreamError(`上游响应体超过上限 (> ${maxBytes} bytes)`, {
          code: 'RESPONSE_TOO_LARGE',
          status: 502,
          retriable: false
        });
      }
      return Buffer.from(txt, 'utf8').subarray(0, maxBytes).toString('utf8');
    }
    return txt;
  }
  return '';
}

function extractOpenAiChatJsonFallback(json) {
  if (json?.error) {
    const { message, status } = extractEmbeddedErrorDetails(json);
    throw createUpstreamError(message, {
      code: 'UPSTREAM_JSON_ERROR',
      status,
      retriable: RETRIABLE_HTTP_STATUSES.has(status)
    });
  }
  const msg = json?.choices?.[0]?.message || {};
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('');
  }
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
  return {
    text,
    reasoningChars: reasoning.length,
    usage: json?.usage || null
  };
}

function extractOpenAiResponsesJsonFallback(json) {
  if (json?.error || json?.status === 'failed') {
    const { message, status } = extractEmbeddedErrorDetails(
      json?.error ? json : { error: json?.error || { message: 'OpenAI Responses failed', status: 502 } }
    );
    throw createUpstreamError(message, {
      code: 'UPSTREAM_JSON_ERROR',
      status,
      retriable: RETRIABLE_HTTP_STATUSES.has(status)
    });
  }
  if (typeof json?.output_text === 'string' && json.output_text.length > 0) {
    return { text: json.output_text, reasoningChars: 0, usage: json?.usage || null };
  }
  const textParts = [];
  if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if ((c?.type === 'output_text' || c?.type === 'text') && typeof c.text === 'string') {
            textParts.push(c.text);
          }
        }
      }
    }
  }
  return {
    text: textParts.join(''),
    reasoningChars: 0,
    usage: json?.usage || null
  };
}

function extractAnthropicJsonFallback(json) {
  if (json?.type === 'error' || json?.error) {
    const { message, status } = extractEmbeddedErrorDetails(json);
    throw createUpstreamError(message, {
      code: 'UPSTREAM_JSON_ERROR',
      status,
      retriable: RETRIABLE_HTTP_STATUSES.has(status)
    });
  }
  const textParts = [];
  let reasoningChars = 0;
  if (Array.isArray(json?.content)) {
    for (const block of json.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        reasoningChars += block.thinking.length;
      }
    }
  }
  return {
    text: textParts.join(''),
    reasoningChars,
    usage: json?.usage || null
  };
}

function isFallbackEligibleError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.callerAborted) return false;
  if (err.retriable === true) return true;
  const status = Number(err.status);
  if (Number.isFinite(status) && status > 0) {
    return RETRIABLE_HTTP_STATUSES.has(status);
  }
  if (err.isStreamError && !NON_RETRIABLE_AUTH_STATUSES.has(status)) {
    return true;
  }
  const code = String(err.code || err.errno || err.cause?.code || '');
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'FIRST_BYTE_TIMEOUT' ||
    code === 'IDLE_CHUNK_TIMEOUT' ||
    code === 'TOTAL_TIMEOUT' ||
    code.startsWith('UND_ERR_')
  ) {
    return true;
  }
  if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'TypeError') {
    return true;
  }
  return false;
}

function formatFallbackReason(err) {
  const statusPrefix = err?.status ? `HTTP ${err.status}: ` : (err?.code ? `${err.code}: ` : '');
  return redactOutboundText(`${statusPrefix}${err?.message || 'Upstream failure'}`)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .trim()
    .slice(0, 200);
}

function formatSearchContextBlock(results) {
  const lines = results.map((item, idx) => {
    const snip = item.snippet ? `\n   摘要: ${item.snippet}` : '';
    return `${idx + 1}. ${item.title} (${item.url})${snip}`;
  });
  return `[公网实时检索参考资料]\n${lines.join('\n')}\n[/公网实时检索参考资料]`;
}

function appendSearchedSourcesFooter(text, results) {
  if (!Array.isArray(results) || results.length === 0) return text;
  const cleanText = String(text ?? '').trimEnd();
  if (cleanText.includes('[searched sources]')) return cleanText;
  const bullets = results.map((r) => `- [${r.title}](${r.url})`).join('\n');
  return `${cleanText}\n\n[searched sources]\n${bullets}`;
}

function parseAskArguments(arg1, arg2, arg3) {
  if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
    const merged = {
      ...arg1,
      ...(arg2 && typeof arg2 === 'object' ? arg2 : {})
    };
    return {
      modelId: String(merged.modelId || merged.model || '').trim(),
      prompt: String(merged.prompt ?? merged.input ?? ''),
      options: merged
    };
  }
  if (typeof arg2 === 'object' && arg2 !== null && !Array.isArray(arg2)) {
    return {
      modelId: String(arg1 || '').trim(),
      prompt: String(arg2.prompt ?? arg2.input ?? ''),
      options: arg2
    };
  }
  return {
    modelId: String(arg1 || '').trim(),
    prompt: String(arg2 ?? ''),
    options: arg3 && typeof arg3 === 'object' ? arg3 : {}
  };
}

export function createModelHub({
  profileManager,
  fetchImpl,
  fetchFn = fetchImpl || globalThis.fetch,
  lookupFn,
  searchFn,
  defaultTimeouts = {}
} = {}) {
  if (!profileManager || typeof profileManager.loadProfile !== 'function') {
    throw Object.assign(new Error('createModelHub 需要有效的 profileManager 实例'), {
      code: 'INVALID_PROFILE_MANAGER'
    });
  }
  if (typeof fetchFn !== 'function') {
    throw Object.assign(new Error('当前运行环境缺少 fetch 实现'), {
      code: 'FETCH_UNAVAILABLE'
    });
  }

  const effectiveSearchFn = searchFn || ((q, opts) => searchPublicWebSafe(q, {
    lookupFn,
    ...opts
  }));

  async function invokeSingleModel({
    model,
    provider,
    prompt,
    systemPrompt = '',
    maxTokens,
    temperature,
    onDelta,
    signal,
    timeouts = {}
  }) {
    const auth = await Promise.resolve(profileManager.resolveProviderAuth(provider.id));
    if (!auth.enabled || model.enabled === false) {
      throw createUpstreamError(`模型或网关已停用 (${model.id})`, {
        code: 'MODEL_DISABLED',
        status: 400,
        retriable: false
      });
    }
    if (!auth.hasApiKey && !auth.allowKeyless) {
      throw createUpstreamError(
        `Provider "${provider.id}" 尚未配置有效凭据（请配置环境变量 ${provider.apiKeyEnv || 'API_KEY'} 或录入隔离凭据库）`,
        { code: 'MISSING_PROVIDER_CREDENTIALS', status: 401, retriable: false }
      );
    }
    if (auth.hasApiKey) {
      const parsedBase = new URL(provider.baseUrl);
      if (parsedBase.protocol === 'http:') {
        const bareH = parsedBase.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        const ipFam = net.isIP(bareH);
        const isLocalOrLanHost =
          bareH === 'localhost' ||
          bareH.endsWith('.local') ||
          bareH.endsWith('.lan') ||
          bareH.endsWith('.internal') ||
          bareH.endsWith('.ts.net') ||
          !bareH.includes('.') ||
          (ipFam !== 0 && !isPublicRoutableIp(bareH));
        if (!isLocalOrLanHost) {
          throw createUpstreamError(
            `安全拦截：禁止通过明文 http:// 向公网网关 (${bareH}) 发送 API Key，请改用 https://`,
            { code: 'CLEARTEXT_HTTP_CREDENTIAL_BLOCKED', status: 400, retriable: false }
          );
        }
      }
    }

    const rawCallerTimeout = timeouts.timeoutMs ?? defaultTimeouts.timeoutMs;
    const explicitTimeoutMs =
      rawCallerTimeout !== undefined && rawCallerTimeout !== null && Number.isFinite(Number(rawCallerTimeout)) && Number(rawCallerTimeout) > 0
        ? Number(rawCallerTimeout)
        : 0;
    const idleTimeoutMs = timeouts.idleChunkTimeoutMs !== undefined
      ? Math.max(0, Number(timeouts.idleChunkTimeoutMs) || 0)
      : (defaultTimeouts.idleChunkTimeoutMs !== undefined && !explicitTimeoutMs
        ? Math.max(0, Number(defaultTimeouts.idleChunkTimeoutMs) || 0)
        : Math.min(explicitTimeoutMs || 60_000, 60_000));
    const maxTotalMs = timeouts.totalTimeoutMs !== undefined
      ? Math.max(0, Number(timeouts.totalTimeoutMs) || 0)
      : (explicitTimeoutMs > 0
        ? (explicitTimeoutMs < 60_000 ? explicitTimeoutMs : Math.max(explicitTimeoutMs, 60_000))
        : (defaultTimeouts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS));
    const firstByteTimeoutMs = timeouts.firstByteTimeoutMs !== undefined
      ? Math.max(0, Number(timeouts.firstByteTimeoutMs) || 0)
      : (explicitTimeoutMs > 0 && explicitTimeoutMs < (defaultTimeouts.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS)
        ? explicitTimeoutMs
        : (defaultTimeouts.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS));
    const idleChunkTimeoutMs = idleTimeoutMs;
    const totalTimeoutMs = maxTotalMs;
    const effectiveMaxTokens = maxTokens ?? model.maxTokens ?? 4096;

    const protocol = provider.protocol;
    let endpointUrl;
    const headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream, application/json'
    };
    let requestBody;

    if (protocol === 'openai-chat') {
      endpointUrl = buildProtocolEndpoint(provider.baseUrl, '/chat/completions');
      if (auth.apiKey) {
        headers.authorization = `Bearer ${auth.apiKey}`;
      }
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
      requestBody = {
        model: model.upstreamModel,
        messages,
        stream: true
      };
      if (effectiveMaxTokens) {
        if (/^(?:o[134](?:-|$)|gpt-5(?:-|$))/i.test(String(model.upstreamModel || '').trim())) {
          requestBody.max_completion_tokens = effectiveMaxTokens;
        } else {
          requestBody.max_tokens = effectiveMaxTokens;
        }
      }
      if (temperature !== undefined) requestBody.temperature = temperature;
    } else if (protocol === 'openai-responses') {
      endpointUrl = buildProtocolEndpoint(provider.baseUrl, '/responses');
      if (auth.apiKey) {
        headers.authorization = `Bearer ${auth.apiKey}`;
      }
      requestBody = {
        model: model.upstreamModel,
        input: prompt,
        stream: true
      };
      if (systemPrompt) requestBody.instructions = systemPrompt;
      if (effectiveMaxTokens) requestBody.max_output_tokens = effectiveMaxTokens;
      if (temperature !== undefined) requestBody.temperature = temperature;
    } else if (protocol === 'anthropic-messages') {
      endpointUrl = buildProtocolEndpoint(provider.baseUrl, '/messages');
      headers['anthropic-version'] = '2023-06-01';
      if (auth.apiKey) {
        if (/^Bearer\s+/i.test(auth.apiKey)) {
          headers.authorization = auth.apiKey;
        } else if (timeouts.preferBearerAuth === true) {
          headers.authorization = `Bearer ${auth.apiKey}`;
        } else {
          headers['x-api-key'] = auth.apiKey;
        }
      }
      requestBody = {
        model: model.upstreamModel,
        max_tokens: effectiveMaxTokens || 4096,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      };
      if (systemPrompt) requestBody.system = systemPrompt;
      if (temperature !== undefined) requestBody.temperature = temperature;
    } else {
      throw createUpstreamError(`不支持的协议类型: ${protocol}`, {
        code: 'UNSUPPORTED_PROTOCOL',
        status: 400,
        retriable: false
      });
    }

    const requestController = new AbortController();
    let headerTimer = null;
    let totalRequestTimer = null;
    let timedOutErr = null;

    const onCallerAbort = () => {
      const callerErr = Object.assign(new Error('Request aborted by caller'), {
        name: 'AbortError',
        code: 'CALLER_ABORTED',
        callerAborted: true,
        retriable: false
      });
      timedOutErr = callerErr;
      try { requestController.abort(callerErr); } catch {}
    };

    if (signal) {
      if (signal.aborted) onCallerAbort();
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const clearHeaderTimers = () => {
      if (headerTimer !== null) {
        clearTimeout(headerTimer);
        headerTimer = null;
      }
    };
    const clearRequestTimers = () => {
      clearHeaderTimers();
      if (totalRequestTimer !== null) {
        clearTimeout(totalRequestTimer);
        totalRequestTimer = null;
      }
      if (signal) {
        try { signal.removeEventListener('abort', onCallerAbort); } catch {}
      }
    };

    const startedAt = performance.now();
    let ttftMs = null;
    const markFirstToken = () => {
      if (ttftMs === null) {
        ttftMs = Math.max(0, Math.round(performance.now() - startedAt));
      }
    };

    if (firstByteTimeoutMs > 0) {
      headerTimer = setTimeout(() => {
        timedOutErr = createStreamTimeoutError('FIRST_BYTE_TIMEOUT', '上游网关首包连接超时', firstByteTimeoutMs);
        try { requestController.abort(timedOutErr); } catch {}
      }, firstByteTimeoutMs);
    }
    if (totalTimeoutMs > 0) {
      totalRequestTimer = setTimeout(() => {
        timedOutErr = createStreamTimeoutError('TOTAL_TIMEOUT', '上游网关请求总超时', totalTimeoutMs);
        try { requestController.abort(timedOutErr); } catch {}
      }, totalTimeoutMs);
    }

    let response;
    try {
      try {
        response = await fetchFn(endpointUrl, {
          method: 'POST',
          redirect: 'error',
          headers,
          body: JSON.stringify(requestBody),
          signal: requestController.signal
        });
      } catch (fetchErr) {
        if (timedOutErr) throw timedOutErr;
        throw fetchErr;
      } finally {
        clearHeaderTimers();
      }

      const status = Number(response?.status) || 0;
      if (!response.ok) {
        let errText = '';
        try {
          errText = (await readBoundedResponseText(response, 16 * 1024, false)).slice(0, 800);
        } catch {}
        let parsedMsg = errText;
        if (errText.trim().startsWith('{')) {
          try {
            const errJson = JSON.parse(errText);
            parsedMsg = extractEmbeddedErrorDetails(errJson).message;
          } catch {}
        }
        throw createUpstreamError(
          `上游 HTTP ${status}: ${parsedMsg || response.statusText || 'Request failed'}`,
          {
            code: `HTTP_${status}`,
            status,
            retriable: RETRIABLE_HTTP_STATUSES.has(status)
          }
        );
      }

      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
        const rawJsonText = await readBoundedResponseText(response, 4 * 1024 * 1024, true);
        const json = JSON.parse(rawJsonText);
        markFirstToken();
        const fallbackParsed = protocol === 'openai-chat'
          ? extractOpenAiChatJsonFallback(json)
          : protocol === 'openai-responses'
            ? extractOpenAiResponsesJsonFallback(json)
            : extractAnthropicJsonFallback(json);

        if (fallbackParsed.text && typeof onDelta === 'function') {
          onDelta(fallbackParsed.text);
        }
        const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
        return {
          text: fallbackParsed.text,
          reasoningChars: fallbackParsed.reasoningChars,
          usage: fallbackParsed.usage,
          ttftMs: ttftMs ?? totalMs,
          totalMs
        };
      }

      const elapsedBeforeStream = Math.round(performance.now() - startedAt);
      const streamFirstChunkBudgetMs = timeouts.firstByteTimeoutMs !== undefined
        ? (firstByteTimeoutMs > 0 ? Math.max(50, firstByteTimeoutMs - elapsedBeforeStream) : 0)
        : idleChunkTimeoutMs;
      const remainingTotalMs = totalTimeoutMs > 0
        ? Math.max(50, totalTimeoutMs - elapsedBeforeStream)
        : 0;

      const textParts = [];
      let reasoningChars = 0;
      let usage = null;

      for await (const sseEvent of parseSseEvents(response, {
        firstByteTimeoutMs: streamFirstChunkBudgetMs,
        idleChunkTimeoutMs,
        totalTimeoutMs: remainingTotalMs,
        abortController: requestController,
        signal,
        onFirstByte: markFirstToken
      })) {
        const rawData = String(sseEvent.data ?? '').trim();
        if (!rawData) continue;
        if (rawData === '[DONE]') break;

        let payload;
        try {
          payload = JSON.parse(rawData);
        } catch {
          continue;
        }

        if (protocol === 'openai-chat') {
          const choice = payload?.choices?.[0];
          const delta = choice?.delta || choice?.message || {};
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
            markFirstToken();
            reasoningChars += delta.reasoning_content.length;
          } else if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
            markFirstToken();
            reasoningChars += delta.reasoning.length;
          }
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            markFirstToken();
            textParts.push(delta.content);
            if (typeof onDelta === 'function') onDelta(delta.content);
          } else if (Array.isArray(delta.content)) {
            for (const part of delta.content) {
              const piece = typeof part === 'string' ? part : (part?.text ?? '');
              if (piece) {
                markFirstToken();
                textParts.push(piece);
                if (typeof onDelta === 'function') onDelta(piece);
              }
            }
          }
          if (payload?.usage) usage = payload.usage;
        } else if (protocol === 'openai-responses') {
          const evtType = payload?.type || sseEvent.event;
          if (evtType === 'response.output_text.delta') {
            const deltaText = typeof payload.delta === 'string' ? payload.delta : '';
            if (deltaText) {
              markFirstToken();
              textParts.push(deltaText);
              if (typeof onDelta === 'function') onDelta(deltaText);
            }
          } else if (
            evtType === 'response.reasoning_summary_text.delta' ||
            evtType === 'response.reasoning.delta'
          ) {
            if (typeof payload.delta === 'string') {
              markFirstToken();
              reasoningChars += payload.delta.length;
            }
          } else if (evtType === 'response.completed' || evtType === 'response.done') {
            const respObj = payload?.response || payload;
            if (respObj?.status === 'failed' || respObj?.error) {
              const { message, status: errStatus } = extractEmbeddedErrorDetails(
                respObj.error || { message: 'OpenAI Responses completed with failure', status: 502 }
              );
              throw createUpstreamError(message, {
                code: 'SSE_STREAM_ERROR',
                status: errStatus,
                retriable: !NON_RETRIABLE_AUTH_STATUSES.has(errStatus),
                isStreamError: true
              });
            }
            if (textParts.length === 0) {
              const extracted = extractOpenAiResponsesJsonFallback(respObj);
              if (extracted.text) {
                markFirstToken();
                textParts.push(extracted.text);
                if (typeof onDelta === 'function') onDelta(extracted.text);
              }
            }
            if (respObj?.usage) usage = respObj.usage;
          }
        } else if (protocol === 'anthropic-messages') {
          const evtType = payload?.type || sseEvent.event;
          if (evtType === 'content_block_start') {
            const initText = payload?.content_block?.type === 'text' ? payload.content_block.text : '';
            if (typeof initText === 'string' && initText.length > 0) {
              markFirstToken();
              textParts.push(initText);
              if (typeof onDelta === 'function') onDelta(initText);
            }
          } else if (evtType === 'content_block_delta') {
            const delta = payload?.delta;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
              markFirstToken();
              textParts.push(delta.text);
              if (typeof onDelta === 'function') onDelta(delta.text);
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              markFirstToken();
              reasoningChars += delta.thinking.length;
            }
          } else if (evtType === 'message_delta') {
            if (payload?.usage) usage = payload.usage;
          } else if (evtType === 'message_stop') {
            break;
          }
        }
      }

      const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (timedOutErr) throw timedOutErr;

      return {
        text: textParts.join(''),
        reasoningChars,
        usage,
        ttftMs: ttftMs ?? totalMs,
        totalMs
      };
    } catch (err) {
      if (timedOutErr) throw timedOutErr;
      throw err;
    } finally {
      clearRequestTimers();
    }
  }

  function listModelsForMcp({ tier = '', excludeVendor = '' } = {}) {
    const publicProfile = profileManager.getPublicProfile();
    const providerMap = new Map(publicProfile.providers.map((p) => [p.id, p]));

    const tierFilter = String(tier || '').trim().toUpperCase();
    const excludedVendors = new Set(
      String(excludeVendor || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    );

    const enabledModels = publicProfile.models.filter((m) => m.enabled !== false);
    const enabledIdSet = new Set(enabledModels.map((m) => m.id));
    const favoriteIndexMap = new Map();
    publicProfile.favorites.forEach((favId, idx) => {
      favoriteIndexMap.set(favId, idx);
    });

    const filtered = enabledModels.filter((m) => {
      if (tierFilter && VALID_TIERS.includes(tierFilter) && m.tier !== tierFilter) {
        return false;
      }
      if (excludedVendors.size > 0 && excludedVendors.has(String(m.vendor || '').toLowerCase())) {
        return false;
      }
      return true;
    });

    // Project strictly to the 8 safe public keys (zero baseUrl / apiKeyEnv / secret exposure)
    const toSafeMcpItem = (m) => {
      const prov = providerMap.get(m.providerId);
      const hasFallback = Boolean(
        m.fallbackModelId &&
        m.fallbackModelId !== m.id &&
        enabledIdSet.has(m.fallbackModelId)
      );
      return {
        id: m.id,
        alias: m.alias || m.id,
        tier: m.tier,
        vendor: m.vendor,
        roleHint: m.roleHint || '',
        hasFallback,
        ready: Boolean(m.ready && prov?.ready),
        lastSpeed: m.lastSpeed ? { ...m.lastSpeed } : null
      };
    };

    const tierOrder = { T1: 1, T2: 2, T3: 3, T4: 4 };
    const sortedModels = filtered
      .slice()
      .sort((a, b) => {
        const aFav = favoriteIndexMap.has(a.id) ? favoriteIndexMap.get(a.id) : Number.POSITIVE_INFINITY;
        const bFav = favoriteIndexMap.has(b.id) ? favoriteIndexMap.get(b.id) : Number.POSITIVE_INFINITY;
        if (aFav !== bFav) return aFav - bFav;
        const aTier = tierOrder[a.tier] ?? 99;
        const bTier = tierOrder[b.tier] ?? 99;
        if (aTier !== bTier) return aTier - bTier;
        return a.id.localeCompare(b.id);
      })
      .map(toSafeMcpItem);

    const favorites = sortedModels.filter((item) => favoriteIndexMap.has(item.id));
    const tiers = {};
    for (const tierKey of VALID_TIERS) {
      tiers[tierKey] = {
        ...TIER_DEFINITIONS[tierKey],
        models: sortedModels.filter((item) => item.tier === tierKey)
      };
    }

    return {
      total: sortedModels.length,
      favorites,
      tiers,
      models: sortedModels
    };
  }

  async function askModel(arg1, arg2, arg3) {
    const { modelId: rawModelId, prompt: rawPrompt, options } = parseAskArguments(arg1, arg2, arg3);
    if (!String(rawPrompt ?? '').trim()) {
      throw Object.assign(new Error('提问内容 (prompt) 不能为空'), {
        code: 'EMPTY_PROMPT'
      });
    }

    const profile = profileManager.loadProfile();
    const providerMap = new Map(profile.providers.map((p) => [p.id, p]));
    const modelMap = new Map(profile.models.map((m) => [m.id, m]));

    let primaryModel = rawModelId ? modelMap.get(rawModelId) : null;
    if (!rawModelId) {
      const publicProfile = profileManager.getPublicProfile();
      const readySet = new Set(publicProfile.models.filter((m) => m.ready).map((m) => m.id));
      const favReadyId = profile.favorites.find((id) => readySet.has(id));
      const pickedId = favReadyId
        || publicProfile.models.find((m) => m.ready && m.tier === profile.settings.defaultTier)?.id
        || publicProfile.models.find((m) => m.ready)?.id
        || profile.models[0]?.id;
      if (pickedId) primaryModel = modelMap.get(pickedId);
    }

    if (!primaryModel) {
      throw Object.assign(new Error(`未找到目标模型 "${rawModelId || '(default)'}"`), {
        code: 'MODEL_NOT_FOUND'
      });
    }

    const primaryProvider = providerMap.get(primaryModel.providerId);
    if (!primaryProvider) {
      throw Object.assign(new Error(`模型 "${primaryModel.id}" 关联的 Provider 不存在`), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }

    const shouldRedact = options.redactSecrets !== undefined
      ? Boolean(options.redactSecrets)
      : (profile.settings?.redactOutboundSecrets !== false);

    const sanitizedUserPrompt = shouldRedact ? redactOutboundText(rawPrompt) : String(rawPrompt);
    const rawSysPrompt = String(options.systemPrompt ?? '');
    const sanitizedSystemPrompt = shouldRedact ? redactOutboundText(rawSysPrompt) : rawSysPrompt;
    const didRedact = sanitizedUserPrompt !== String(rawPrompt) || sanitizedSystemPrompt !== rawSysPrompt;

    const webSearchSetting = profile.settings?.webSearch;
    const defaultWebSearchEnabled = typeof webSearchSetting === 'object' && webSearchSetting !== null
      ? Boolean(webSearchSetting.enabled)
      : Boolean(webSearchSetting);
    // Strict dual gate: requires BOTH user settings.webSearch opt-in AND explicit per-call webSearch:true
    const enableWebSearch = Boolean(options.webSearch === true) &&
      (defaultWebSearchEnabled || options.allowPolicyOverride === true);
    const webSearchBlockedByPolicy = Boolean(options.webSearch === true) && !enableWebSearch;

    let searchedSources = [];
    let effectivePrompt = sanitizedUserPrompt;

    if (enableWebSearch) {
      const searchEndpoint = options.searchEndpointUrl
        || (typeof webSearchSetting === 'object' && webSearchSetting?.endpointUrl ? webSearchSetting.endpointUrl : undefined);
      const searchMaxResults = options.searchMaxResults
        || (typeof webSearchSetting === 'object' && webSearchSetting?.maxResults ? webSearchSetting.maxResults : 5);
      const queryText = String(options.searchQuery || sanitizedUserPrompt).slice(0, 240);

      const searchOutcome = await effectiveSearchFn(queryText, {
        endpointUrl: searchEndpoint,
        maxResults: searchMaxResults,
        ...(options.webSearchOptions || {})
      });
      searchedSources = Array.isArray(searchOutcome?.results) ? searchOutcome.results : [];
      if (searchedSources.length > 0) {
        effectivePrompt = `${formatSearchContextBlock(searchedSources)}\n\n${sanitizedUserPrompt}`;
      }
    }

    const timeouts = {
      timeoutMs: options.timeoutMs,
      firstByteTimeoutMs: options.firstByteTimeoutMs,
      idleChunkTimeoutMs: options.idleChunkTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
      preferBearerAuth: options.preferBearerAuth
    };

    try {
      const res = await invokeSingleModel({
        model: primaryModel,
        provider: primaryProvider,
        prompt: effectivePrompt,
        systemPrompt: sanitizedSystemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        onDelta: options.onDelta,
        signal: options.signal,
        timeouts
      });

      const finalText = searchedSources.length > 0
        ? appendSearchedSourcesFooter(res.text, searchedSources)
        : res.text;

      return {
        ok: true,
        text: finalText,
        rawText: res.text,
        requestedModelId: primaryModel.id,
        actualModelId: primaryModel.id,
        usedFallback: false,
        fallbackReason: '',
        providerId: primaryProvider.id,
        protocol: primaryProvider.protocol,
        tier: primaryModel.tier,
        vendor: primaryModel.vendor,
        ttftMs: res.ttftMs,
        totalMs: res.totalMs,
        reasoningChars: res.reasoningChars,
        redactedPrompt: didRedact,
        webSearchBlockedByPolicy,
        searchedSources,
        usage: res.usage
      };
    } catch (primaryErr) {
      // Max 1-hop cycle-safe fallback routing
      const fbId = primaryModel.fallbackModelId;
      const fbModel = fbId && fbId !== primaryModel.id ? modelMap.get(fbId) : null;
      const fbProvider = fbModel ? providerMap.get(fbModel.providerId) : null;

      if (
        !fbModel ||
        fbModel.enabled === false ||
        !fbProvider ||
        fbProvider.enabled === false ||
        !isFallbackEligibleError(primaryErr)
      ) {
        throw primaryErr;
      }

      const fallbackReason = formatFallbackReason(primaryErr);
      const fbRes = await invokeSingleModel({
        model: fbModel,
        provider: fbProvider,
        prompt: effectivePrompt,
        systemPrompt: sanitizedSystemPrompt,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        onDelta: options.onDelta,
        signal: options.signal,
        timeouts
      });

      const finalText = searchedSources.length > 0
        ? appendSearchedSourcesFooter(fbRes.text, searchedSources)
        : fbRes.text;

      return {
        ok: true,
        text: finalText,
        rawText: fbRes.text,
        requestedModelId: primaryModel.id,
        actualModelId: fbModel.id,
        usedFallback: true,
        fallbackReason,
        providerId: fbProvider.id,
        protocol: fbProvider.protocol,
        tier: fbModel.tier,
        vendor: fbModel.vendor,
        ttftMs: fbRes.ttftMs,
        totalMs: fbRes.totalMs,
        reasoningChars: fbRes.reasoningChars,
        redactedPrompt: didRedact,
        webSearchBlockedByPolicy,
        searchedSources,
        usage: fbRes.usage
      };
    }
  }

  async function probeModelSpeed(modelId, options = {}) {
    const cleanId = String(modelId || '').trim();
    const profile = profileManager.loadProfile();
    const model = profile.models.find((m) => m.id === cleanId);
    if (!model) {
      throw Object.assign(new Error(`未找到待测速模型 "${cleanId}"`), {
        code: 'MODEL_NOT_FOUND'
      });
    }
    const provider = profile.providers.find((p) => p.id === model.providerId);
    if (!provider) {
      throw Object.assign(new Error(`模型 "${cleanId}" 关联的 Provider 不存在`), {
        code: 'PROVIDER_NOT_FOUND'
      });
    }

    const startedAt = performance.now();
    const checkedAt = new Date().toISOString();

    try {
      const res = await invokeSingleModel({
        model,
        provider,
        prompt: 'Reply with OK',
        systemPrompt: '',
        maxTokens: 8,
        timeouts: {
          firstByteTimeoutMs: options.firstByteTimeoutMs ?? 15_000,
          idleChunkTimeoutMs: options.idleChunkTimeoutMs ?? 15_000,
          totalTimeoutMs: options.totalTimeoutMs ?? 25_000
        }
      });

      const completionToks = Number(
        res.usage?.completion_tokens ??
        res.usage?.output_tokens ??
        Math.max(1, Math.ceil((res.text.length + res.reasoningChars) / 4))
      );
      const durationSec = Math.max(0.001, res.totalMs / 1000);
      const tokPerSec = Math.round((completionToks / durationSec) * 100) / 100;

      const recorded = profileManager.recordModelSpeed(model.id, {
        ok: true,
        ttftMs: res.ttftMs,
        totalMs: res.totalMs,
        tokPerSec,
        checkedAt,
        error: ''
      });

      return {
        ok: true,
        modelId: model.id,
        ...recorded,
        preview: res.text.trim().slice(0, 64)
      };
    } catch (err) {
      const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
      const recorded = profileManager.recordModelSpeed(model.id, {
        ok: false,
        ttftMs: null,
        totalMs,
        tokPerSec: null,
        checkedAt,
        error: formatFallbackReason(err)
      });

      return {
        ok: false,
        modelId: model.id,
        ...recorded,
        preview: ''
      };
    }
  }

  function classifyDiscoveredModel(rawId) {
    const clean = String(rawId || '').trim().replace(/^models\//i, '');
    const lower = clean.toLowerCase();
    const isNonChat = /(?:embedding|text-embedding|tts|whisper|moderation|rerank|babbage|davinci-002|dall-e|imagen|flux|stable-diffusion|veo|sora|audio-preview-tts)/i.test(lower);

    let vendor = 'other';
    if (/(?:claude|anthropic|sonnet|opus|haiku)/i.test(lower)) vendor = 'anthropic';
    else if (/(?:gemini|gemma|learnlm|palm)/i.test(lower)) vendor = 'google';
    else if (/(?:deepseek)/i.test(lower)) vendor = 'deepseek';
    else if (/(?:\bglm|\bchatglm|zhipu)/i.test(lower)) vendor = 'glm';
    else if (/(?:\bgpt|\bo1\b|\bo3\b|\bo4\b|codex|chatgpt|astra)/i.test(lower)) vendor = 'openai';

    let tier = 'T2';
    if (/(?:opus|gpt-6\.2-astra|gpt-6-astra|gpt-5-pro|\bo1-pro\b|\bo3-pro\b|carbon|xhigh|reasoner|r1\b|v4-pro)/i.test(lower)) {
      tier = 'T1';
    } else if (/(?:flash-lite|haiku|mini\b|nano\b|glm-.*-flash|3\.5-turbo)/i.test(lower)) {
      tier = 'T4';
    } else if (/(?:flash|hydrogen|deepseek-v4\.1|glm-5|qwen)/i.test(lower)) {
      tier = 'T3';
    }

    return {
      upstreamModel: String(rawId || '').trim(),
      suggestedId: clean,
      vendor,
      tier,
      isChat: !isNonChat
    };
  }

  function buildModelsDiscoveryUrl(baseUrl, protocol) {
    const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
    const u = new URL(cleanBase);
    let p = u.pathname.replace(/\/+$/, '');
    p = p.replace(/\/(?:chat\/completions|responses|messages|models)$/i, '');
    if (protocol === 'anthropic-messages' && !/\/v1$/i.test(p)) {
      p = `${p}/v1`;
    } else if (!/\/v\d+(?:beta)?(?:\/openai)?$/i.test(p) && !/\/api$/i.test(p)) {
      p = `${p}/v1`;
    }
    u.pathname = `${p}/models`;
    return u.toString();
  }

  async function discoverProviderModels(providerId, options = {}) {
    const cleanProvId = String(providerId || '').trim();
    const profile = profileManager.loadProfile();
    const provider = profile.providers.find((p) => p.id === cleanProvId);
    if (!provider) {
      throw Object.assign(new Error(`未找到网关 "${cleanProvId}"`), { code: 'PROVIDER_NOT_FOUND' });
    }
    const auth = profileManager.resolveProviderAuth(provider.id);
    if (!auth.hasApiKey && !auth.allowKeyless) {
      return {
        ok: false,
        code: 'MISSING_API_KEY',
        providerId: provider.id,
        error: provider.apiKeyEnv
          ? `网关尚未检测到环境变量 ${provider.apiKeyEnv}，请先配置环境变量或在编辑网关中存入系统凭据库`
          : '网关尚未绑定 API Key 凭据，请先编辑网关配置环境变量名或凭据库密钥',
        models: []
      };
    }

    const candidates = [buildModelsDiscoveryUrl(provider.baseUrl, provider.protocol)];
    if (/\/v1\/models$/i.test(candidates[0]) && provider.baseUrl.includes('11434')) {
      candidates.push(candidates[0].replace(/\/v1\/models$/i, '/api/tags'));
    }

    const existingPairSet = new Set(
      profile.models.filter((m) => m.providerId === provider.id).map((m) => m.upstreamModel)
    );
    const headers = { Accept: 'application/json' };
    if (auth.hasApiKey) {
      if (provider.protocol === 'anthropic-messages') {
        headers['x-api-key'] = auth.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${auth.apiKey}`;
      }
    }

    const activeFetch = options.fetchFn || options.fetchImpl || fetchFn || globalThis.fetch;
    let lastStatus = 0;
    let lastMsg = '';

    for (const targetUrl of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('探测超时 (8s)')), options.timeoutMs ?? 8000);
      try {
        const resp = await activeFetch(targetUrl, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: controller.signal
        });
        lastStatus = Number(resp?.status) || 0;
        const rawText = await readBoundedResponseText(resp, 2 * 1024 * 1024, Boolean(resp?.ok));
        if (!resp.ok) {
          if (lastStatus === 401 || lastStatus === 403 || lastStatus === 404) {
            lastMsg = `该网关未开放 /models 模型枚举接口 (HTTP ${lastStatus})，这不影响正常对话调用；请直接点击「+ 模型」手动添加或复制 AI 配置口令`;
          } else {
            lastMsg = `网关返回 HTTP ${lastStatus}：${redactOutboundText(rawText).slice(0, 140)}`;
          }
          continue;
        }
        if (/^\s*<!doctype html|^\s*<html/i.test(rawText)) {
          lastMsg = '网关返回了 HTML 页面而非 JSON 模型列表，请检查网关 Base URL 是否填写正确（通常以 /v1 结尾）';
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          lastMsg = '网关响应不是有效的 JSON 模型列表，请改用「+ 模型」手动添加';
          continue;
        }
        const rawArr = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.data) ? parsed.data : (Array.isArray(parsed?.models) ? parsed.models : null));
        if (!rawArr) {
          lastMsg = '网关未返回标准模型数组，请使用「+ 模型」手动添加';
          continue;
        }

        const seen = new Set();
        const items = [];
        for (const entry of rawArr) {
          const rawId = typeof entry === 'string'
            ? entry.trim()
            : String(entry?.id || entry?.name || entry?.model || '').trim();
          if (!rawId || seen.has(rawId)) continue;
          seen.add(rawId);
          const info = classifyDiscoveredModel(rawId);
          items.push({
            ...info,
            alreadyAdded: existingPairSet.has(info.upstreamModel) || existingPairSet.has(info.suggestedId)
          });
        }
        items.sort((a, b) => {
          if (a.isChat !== b.isChat) return a.isChat ? -1 : 1;
          if (a.alreadyAdded !== b.alreadyAdded) return a.alreadyAdded ? 1 : -1;
          const rank = { T1: 1, T2: 2, T3: 3, T4: 4 };
          if (rank[a.tier] !== rank[b.tier]) return rank[a.tier] - rank[b.tier];
          return a.suggestedId.localeCompare(b.suggestedId);
        });
        return {
          ok: true,
          providerId: provider.id,
          providerLabel: provider.label,
          total: items.length,
          chatCount: items.filter((x) => x.isChat).length,
          models: items.slice(0, 300)
        };
      } catch (err) {
        const rawErr = redactOutboundText(String(err?.message || err || '请求失败'))
          .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]');
        lastMsg = `无法连接网关模型列表接口：${rawErr.slice(0, 160)}`;
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      code: 'DISCOVERY_UNAVAILABLE',
      status: lastStatus,
      providerId: provider.id,
      error: lastMsg || '未能从该网关自动拉取模型列表，请使用「+ 模型」手动添加',
      models: []
    };
  }

  return {
    askModel,
    listModelsForMcp,
    probeModelSpeed,
    discoverProviderModels,
    searchPublicWeb: (q, opts) => effectiveSearchFn(q, opts),
    redactOutboundText
  };
}
