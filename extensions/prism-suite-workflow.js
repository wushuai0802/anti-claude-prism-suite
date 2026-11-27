/* ============================================================================
 * Anti-Claude Prism Suite v0.7.0 — Workflow & i18n Module (Clean-Room, MIT)
 * Zero external dependencies. Joins Frozen Bus v4 safely regardless of load order.
 *
 * Features:
 *   1. Conversation Image Context Menu (Quote / Copy PNG / Save)
 *   2. Clean Final-Answer Copy (filters collapsed thinking & tool summaries)
 *   3. SSH Command Paste Auto-Parser (strips passwords & trailing args)
 *   4. Antigravity 2.34–2.35 & Swarm Incremental i18n Supplement (zh-CN / zh-TW / en)
 *   5. In-Place Message Edit Helper (explicit edit-message first, optimistic-locked fallback)
 *   6. Session Branching (Outline action + turn hover trigger + CLI fallback)
 * ============================================================================ */
(() => {
  'use strict';

  const INSTANCE_TOKEN = Symbol('agPrismWorkflow');
  if (typeof window.__agPrismWorkflowDispose === 'function') {
    try { window.__agPrismWorkflowDispose(); } catch {}
  }
  window.__agPrismWorkflowToken = INSTANCE_TOKEN;

  function registerPrismModule(id, initFn) {
    const reg = (window.__agPrismModules = window.__agPrismModules || Object.create(null));
    reg[id] = initFn;
    if (window.__agPrismBus && window.__agPrismBus.version >= 4) {
      try { initFn(window.__agPrismBus); } catch {}
    }
  }

  const MAX_CANVAS_DIM = 4096;
  const I18N_MAX_NODES_PER_PASS = 600;
  const DEFAULT_PREFS = Object.freeze({
    imageContextMenu: true,
    cleanCopy: true,
    sshPaste: true,
    composerFileDrop: true,
    wslExplorerRevealFix: true,
    fastWindowRestore: false,
    i18nExtraMode: 'off',
    inlineEditHelper: true,
    sessionFork: true
  });

  const VALID_I18N_MODES = new Set(['off', 'zh-CN', 'zh-TW', 'en']);

  /* ==========================================================================
   * Shared Pure Utilities
   * ========================================================================== */
  function hashText(str) {
    const s = String(str == null ? '' : str);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function sanitizeFilename(rawName, fallbackExt = 'png') {
    let base = String(rawName || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .trim();
    if (!base) base = `prism-image-${Date.now()}`;
    const extMatch = base.match(/\.([a-zA-Z0-9]{2,5})$/);
    const allowedExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']);
    let ext = fallbackExt;
    if (extMatch && allowedExts.has(extMatch[1].toLowerCase())) {
      ext = extMatch[1].toLowerCase();
      base = base.slice(0, -extMatch[0].length);
    }
    base = base.replace(/[._-]+$/, '').slice(0, 56) || `prism-image-${Date.now()}`;
    return `${base}.${ext}`;
  }

  function inferFilenameFromImage(img) {
    const src = String(img?.currentSrc || img?.src || '');
    if (src.startsWith('data:image/')) {
      const m = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/i);
      const ext = m ? m[1].toLowerCase().replace('svg+xml', 'svg').replace('jpeg', 'jpg') : 'png';
      return sanitizeFilename(img.alt || `image-${Date.now()}`, ext);
    }
    try {
      const u = new URL(src, window.location.href);
      const seg = decodeURIComponent((u.pathname || '').split('/').pop() || '');
      if (seg && seg.length > 1) {
        return sanitizeFilename(seg, 'png');
      }
    } catch {}
    return sanitizeFilename(img?.alt || `image-${Date.now()}`, 'png');
  }

  function isSafeDownloadUrl(urlStr) {
    const s = String(urlStr || '').trim();
    if (!s) return false;
    if (s.startsWith('blob:')) return true;
    if (/^data:image\/[a-zA-Z0-9+.-]+;/i.test(s)) return true;
    try {
      const u = new URL(s, window.location.href);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function setNativeInputValue(inputEl, val) {
    if (!inputEl) return;
    const proto = inputEl instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(inputEl, val);
    } else {
      inputEl.value = val;
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function writeClipboardText(text) {
    const str = String(text == null ? '' : text);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(str);
        return true;
      } catch {}
    }
    // Fallback offscreen textarea copy (only inside user gesture)
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  /* ==========================================================================
   * SSH Command Tokenizer & Parser (Zero Password Logging / Strict Stripping)
   * ========================================================================== */
  const SSH_FLAGS_WITH_ARG = new Set([
    '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i',
    '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R',
    '-S', '-W', '-w'
  ]);

  const SSHPASS_FLAGS_WITH_ARG = new Set(['-p', '-f', '-d', '-P']);

  function tokenizeShellLine(line) {
    const tokens = [];
    const s = String(line || '').trim();
    let cur = '';
    let quote = '';
    let hasToken = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === '\\' && quote === '"' && i + 1 < s.length) {
          cur += s[++i];
        } else if (ch === quote) {
          quote = '';
        } else {
          cur += ch;
        }
        hasToken = true;
      } else if (ch === '\'' || ch === '"') {
        quote = ch;
        hasToken = true;
      } else if (ch === '\\' && i + 1 < s.length) {
        cur += s[++i];
        hasToken = true;
      } else if (/\s/.test(ch)) {
        if (hasToken) {
          tokens.push(cur);
          cur = '';
          hasToken = false;
        }
      } else {
        cur += ch;
        hasToken = true;
      }
    }
    if (hasToken) tokens.push(cur);
    return tokens;
  }

  function validatePort(val) {
    const s = String(val || '').trim();
    if (!/^\d{1,5}$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
  }

  function isValidHost(host, isIpv6) {
    if (!host || host.length > 255) return false;
    if (/[\s/\\'"`;|&<>()[\]$]/.test(host)) return false;
    if (isIpv6) {
      return /^[0-9a-fA-F:.%a-zA-Z0-9_-]+$/.test(host) && host.includes(':');
    }
    // IPv4 or hostname
    return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(host);
  }

  function parseSshCommand(rawText) {
    const singleLine = String(rawText || '').trim().split(/\r?\n/)[0].trim();
    if (!singleLine || singleLine.length > 2048) return null;

    const tokens = tokenizeShellLine(singleLine);
    if (tokens.length < 2) return null;

    let idx = 0;
    let passwordStripped = false;
    let extraStripped = false;

    // Strip leading env / sudo / sshpass wrappers safely (discarding password args immediately)
    while (idx < tokens.length) {
      const cmdBase = tokens[idx].replace(/^.*[\\/]/, '').toLowerCase();
      if (cmdBase === 'sshpass' || cmdBase === 'sshpass.exe') {
        passwordStripped = true;
        idx++;
        while (idx < tokens.length) {
          const t = tokens[idx];
          if (t === '--') {
            idx++;
            break;
          }
          if (SSHPASS_FLAGS_WITH_ARG.has(t)) {
            idx += 2; // skip flag and secret value without storing it
            continue;
          }
          if (/^-[pfdP].+/.test(t)) {
            idx++;
            continue;
          }
          if (t.startsWith('-')) {
            idx++;
            continue;
          }
          break;
        }
        continue;
      }
      break;
    }

    if (idx >= tokens.length) return null;
    const sshCmd = tokens[idx].replace(/^.*[\\/]/, '').toLowerCase();
    if (sshCmd !== 'ssh' && sshCmd !== 'ssh.exe') return null;
    idx++;

    let flagPort = null;
    let flagUser = '';
    let destination = '';
    let endOfOpts = false;

    while (idx < tokens.length) {
      const t = tokens[idx];
      if (!endOfOpts && t === '--') {
        endOfOpts = true;
        idx++;
        continue;
      }
      if (!endOfOpts && t.startsWith('-') && t.length > 1) {
        if (t === '-p') {
          const p = validatePort(tokens[idx + 1]);
          if (p !== null) flagPort = p;
          idx += 2;
          continue;
        }
        if (/^-p\d+$/.test(t)) {
          const p = validatePort(t.slice(2));
          if (p !== null) flagPort = p;
          idx++;
          continue;
        }
        if (t === '-l') {
          if (idx + 1 < tokens.length) flagUser = tokens[idx + 1].trim();
          idx += 2;
          continue;
        }
        if (/^-l.+$/.test(t)) {
          flagUser = t.slice(2).trim();
          idx++;
          continue;
        }
        if (SSH_FLAGS_WITH_ARG.has(t)) {
          extraStripped = true;
          idx += 2;
          continue;
        }
        if (SSH_FLAGS_WITH_ARG.has(t.slice(0, 2))) {
          extraStripped = true;
          idx++;
          continue;
        }
        // Boolean flag(s)
        extraStripped = true;
        idx++;
        continue;
      }

      destination = t;
      idx++;
      if (idx < tokens.length) extraStripped = true; // trailing remote command args discarded
      break;
    }

    if (!destination) return null;

    // Strip optional ssh:// prefix
    let dest = destination.replace(/^ssh:\/\//i, '');
    // Strip any path/query/hash suffix if URI-formatted
    const slashIdx = dest.indexOf('/');
    if (slashIdx !== -1) {
      dest = dest.slice(0, slashIdx);
      extraStripped = true;
    }

    let user = flagUser;
    let hostPart = dest;

    const atIdx = dest.lastIndexOf('@');
    if (atIdx !== -1) {
      const rawUserPart = dest.slice(0, atIdx);
      hostPart = dest.slice(atIdx + 1);
      const colonInUser = rawUserPart.indexOf(':');
      if (colonInUser !== -1) {
        // Strictly strip inline password (user:password@host)
        user = rawUserPart.slice(0, colonInUser).trim();
        passwordStripped = true;
      } else if (rawUserPart.trim()) {
        user = rawUserPart.trim();
      }
    }

    // Sanitize user
    if (user && /[\s/\\'"`;|&<>()[\]$:]/.test(user)) {
      return null;
    }

    let host = '';
    let isIpv6 = false;
    let inlinePort = null;

    if (hostPart.startsWith('[')) {
      const closeBracket = hostPart.indexOf(']');
      if (closeBracket === -1) return null;
      host = hostPart.slice(1, closeBracket);
      isIpv6 = true;
      const rest = hostPart.slice(closeBracket + 1);
      if (rest) {
        if (!rest.startsWith(':')) return null;
        inlinePort = validatePort(rest.slice(1));
        if (inlinePort === null) return null;
      }
    } else {
      const firstColon = hostPart.indexOf(':');
      const lastColon = hostPart.lastIndexOf(':');
      if (firstColon !== -1 && firstColon === lastColon) {
        host = hostPart.slice(0, firstColon);
        inlinePort = validatePort(hostPart.slice(firstColon + 1));
        if (inlinePort === null) return null;
      } else if (firstColon !== -1) {
        // Bare IPv6 without brackets
        host = hostPart;
        isIpv6 = true;
      } else {
        host = hostPart;
      }
    }

    if (!isValidHost(host, isIpv6)) return null;

    const port = flagPort !== null ? flagPort : inlinePort;
    const hostFormatted = isIpv6 ? `[${host}]` : host;
    const hostWithoutPort = user ? `${user}@${hostFormatted}` : hostFormatted;
    const hostWithPort = port !== null ? `${hostWithoutPort}:${port}` : hostWithoutPort;

    return {
      user,
      host,
      isIpv6,
      port,
      hostWithoutPort,
      hostWithPort,
      passwordStripped,
      extraStripped
    };
  }

  /* ==========================================================================
   * 2.34–2.35 & Swarm Incremental i18n Dictionaries (Preserves Brand Names)
   * ========================================================================== */
  const I18N_EXACT_ZH_CN = Object.freeze({
    // Conversations, Pinned, Inbox, Archive, Export
    'Pinned Conversations': '置顶会话',
    'Pinned conversations': '置顶会话',
    'Pinned': '已置顶',
    'Pin conversation': '置顶会话',
    'Pin Conversation': '置顶会话',
    'Unpin conversation': '取消置顶',
    'Unpin Conversation': '取消置顶',
    'Recent Conversations': '最近会话',
    'All Conversations': '全部会话',
    'Archived Conversations': '已归档会话',
    'Load older messages': '加载更早的消息',
    'Load Older Messages': '加载更早的消息',
    'Load more messages': '加载更多消息',
    'Loading older messages...': '正在加载更早的消息…',
    'Delete Permanently': '永久删除',
    'Delete permanently': '永久删除',
    'Move to Trash': '移至回收站',
    'Return to Inbox': '返回收件箱',
    'Return to inbox': '返回收件箱',
    'Back to Inbox': '返回收件箱',
    'Inbox': '收件箱',
    'Fork conversation': '分支会话',
    'Fork Conversation': '分支会话',
    'Fork from here': '从此处分支',
    'Rename conversation': '重命名会话',
    'Export conversation': '导出会话',
    'Export Conversation': '导出会话',
    'Exporting conversation...': '正在导出会话…',
    'Export complete': '导出完成',
    'Export Complete': '导出完成',
    'Export failed': '导出失败',
    'Preparing export...': '正在准备导出…',

    // Images & Media
    'Save Image': '保存图片',
    'Save image': '保存图片',
    'Save image as...': '图片另存为…',
    'Copy Image': '复制图片',
    'Copy image': '复制图片',
    'Open Image in New Tab': '在新标签页打开图片',
    'View full size': '查看原图',

    // Thinking & Execution Steps
    'Thinking...': '思考中…',
    'Thought process': '思考过程',
    'Thought Process': '思考过程',
    'Show thinking': '展开思考',
    'Hide thinking': '折叠思考',
    'Working...': '处理中…',
    'Generating...': '生成中…',
    'In Progress': '进行中',
    'In progress': '进行中',
    'Completed': '已完成',
    'Pending': '等待中',
    'Failed': '失败',
    'Cancelled': '已取消',
    'Canceled': '已取消',
    'Skipped': '已跳过',
    'Queued': '排队中',

    // Swarm & Hive UI (Brand name "Swarm" preserved)
    'Swarm Overview': 'Swarm 总览',
    'Swarm Activity': 'Swarm 活动',
    'Swarm Members': 'Swarm 成员',
    'Swarm Status': 'Swarm 状态',
    'Swarm Tasks': 'Swarm 任务',
    'Swarm Controls': 'Swarm 控制',
    'Active Agents': '活跃 Agent',
    'Idle Agents': '空闲 Agent',
    'Running Agents': '运行中 Agent',
    'Lead Agent': '主控 Agent',
    'Subagent': '子 Agent',
    'Subagents': '子 Agent',
    'Hive Legend': 'Swarm 蜂巢图例',
    'Legend': '图例',
    'Working': '运行中',
    'Waiting': '等待中',
    'Idle': '空闲',
    'Done': '已完成',
    'Blocked': '已阻塞',
    'Broadcast to Swarm': '向 Swarm 广播',
    'Stop Swarm': '停止 Swarm',
    'Pause Swarm': '暂停 Swarm',
    'Resume Swarm': '继续 Swarm',
    'Task Queue': '任务队列',
    'No active tasks': '暂无活跃任务',
    'All tasks completed': '全部任务已完成',
    'Shared Workspace': '共享工作区',
    'Isolated Workspace': '隔离工作区',

    // Permissions, SSH & Dialog Chrome
    'Allow once': '仅允许一次',
    'Allow Once': '仅允许一次',
    'Allow always': '始终允许',
    'Allow Always': '始终允许',
    'Allow for this session': '本次会话允许',
    'Deny': '拒绝',
    'Always Deny': '始终拒绝',
    'Approve': '批准',
    'Reject': '驳回',
    'Permission Required': '需要权限确认',
    'Review changes': '审查变更',
    'Review Changes': '审查变更',
    'Connect via SSH': '通过 SSH 连接',
    'SSH Connection': 'SSH 连接',
    'Remote Host': '远程主机',
    'Connect': '连接',
    'Disconnect': '断开连接',
    'Reconnect': '重新连接',
    'Cancel': '取消',
    'Confirm': '确认',
    'Save': '保存',
    'Close': '关闭',
    'Copy': '复制',
    'Copied': '已复制',
    'Edit': '编辑',
    'Undo': '撤销',
    'Retry': '重试',

    // Antigravity v2.35.1–2.35.2 Active-Turn Model Note, /btw, Skills, Customizations & Marketplace
    'Applies to /btw and messages sent after this turn': '将用于 /btw 及本轮之后发送的消息',
    'Applies to messages sent after this turn': '将用于本轮之后发送的消息',
    'Ask a side question...': '发起旁路追问 (/btw)…',
    'Side question': '旁路追问',
    'Skills & Customizations': '技能与自定义',
    'Skills': '技能',
    'Customizations': '自定义配置',
    'Agent Marketplace': 'Agent 插件市场',
    'Marketplace': '插件市场',
    'Browse Marketplace': '浏览插件市场',
    'Plugins Manager': '插件管理器',
    'Installed Plugins': '已安装插件',
    'Manage Plugins': '管理插件',
    'MCP Servers': 'MCP 服务',
    'Enable Plugin': '启用插件',
    'Disable Plugin': '禁用插件',
    'Uninstall Plugin': '卸载插件',
    'More options': '更多选项',
    'Native menu': '官方菜单'
  });

  const I18N_EXACT_ZH_TW = Object.freeze({
    // Conversations, Pinned, Inbox, Archive, Export
    'Pinned Conversations': '置頂會話',
    'Pinned conversations': '置頂會話',
    'Pinned': '已置頂',
    'Pin conversation': '置頂會話',
    'Pin Conversation': '置頂會話',
    'Unpin conversation': '取消置頂',
    'Unpin Conversation': '取消置頂',
    'Recent Conversations': '最近會話',
    'All Conversations': '全部會話',
    'Archived Conversations': '已封存會話',
    'Load older messages': '載入更早的訊息',
    'Load Older Messages': '載入更早的訊息',
    'Load more messages': '載入更多訊息',
    'Loading older messages...': '正在載入更早的訊息…',
    'Delete Permanently': '永久刪除',
    'Delete permanently': '永久刪除',
    'Move to Trash': '移至垃圾桶',
    'Return to Inbox': '返回收件匣',
    'Return to inbox': '返回收件匣',
    'Back to Inbox': '返回收件匣',
    'Inbox': '收件匣',
    'Fork conversation': '分支會話',
    'Fork Conversation': '分支會話',
    'Fork from here': '從此處分支',
    'Rename conversation': '重新命名會話',
    'Export conversation': '匯出會話',
    'Export Conversation': '匯出會話',
    'Exporting conversation...': '正在匯出會話…',
    'Export complete': '匯出完成',
    'Export Complete': '匯出完成',
    'Export failed': '匯出失敗',
    'Preparing export...': '正在準備匯出…',

    // Images & Media
    'Save Image': '儲存圖片',
    'Save image': '儲存圖片',
    'Save image as...': '圖片另存為…',
    'Copy Image': '複製圖片',
    'Copy image': '複製圖片',
    'Open Image in New Tab': '在新分頁開啟圖片',
    'View full size': '檢視原圖',

    // Thinking & Execution Steps
    'Thinking...': '思考中…',
    'Thought process': '思考過程',
    'Thought Process': '思考過程',
    'Show thinking': '展開思考',
    'Hide thinking': '摺疊思考',
    'Working...': '處理中…',
    'Generating...': '生成中…',
    'In Progress': '進行中',
    'In progress': '進行中',
    'Completed': '已完成',
    'Pending': '等待中',
    'Failed': '失敗',
    'Cancelled': '已取消',
    'Canceled': '已取消',
    'Skipped': '已略過',
    'Queued': '排隊中',

    // Swarm & Hive UI (Brand name "Swarm" preserved)
    'Swarm Overview': 'Swarm 總覽',
    'Swarm Activity': 'Swarm 活動',
    'Swarm Members': 'Swarm 成員',
    'Swarm Status': 'Swarm 狀態',
    'Swarm Tasks': 'Swarm 任務',
    'Swarm Controls': 'Swarm 控制',
    'Active Agents': '活躍 Agent',
    'Idle Agents': '閒置 Agent',
    'Running Agents': '執行中 Agent',
    'Lead Agent': '主控 Agent',
    'Subagent': '子 Agent',
    'Subagents': '子 Agent',
    'Hive Legend': 'Swarm 蜂巢圖例',
    'Legend': '圖例',
    'Working': '執行中',
    'Waiting': '等待中',
    'Idle': '閒置',
    'Done': '已完成',
    'Blocked': '已阻塞',
    'Broadcast to Swarm': '向 Swarm 廣播',
    'Stop Swarm': '停止 Swarm',
    'Pause Swarm': '暫停 Swarm',
    'Resume Swarm': '繼續 Swarm',
    'Task Queue': '任務佇列',
    'No active tasks': '暫無活躍任務',
    'All tasks completed': '全部任務已完成',
    'Shared Workspace': '共享工作區',
    'Isolated Workspace': '隔離工作區',

    // Permissions, SSH & Dialog Chrome
    'Allow once': '僅允許一次',
    'Allow Once': '僅允許一次',
    'Allow always': '始終允許',
    'Allow Always': '始終允許',
    'Allow for this session': '本次會話允許',
    'Deny': '拒絕',
    'Always Deny': '始終拒絕',
    'Approve': '核准',
    'Reject': '駁回',
    'Permission Required': '需要權限確認',
    'Review changes': '審查變更',
    'Review Changes': '審查變更',
    'Connect via SSH': '透過 SSH 連線',
    'SSH Connection': 'SSH 連線',
    'Remote Host': '遠端主機',
    'Connect': '連線',
    'Disconnect': '中斷連線',
    'Reconnect': '重新連線',
    'Cancel': '取消',
    'Confirm': '確認',
    'Save': '儲存',
    'Close': '關閉',
    'Copy': '複製',
    'Copied': '已複製',
    'Edit': '編輯',
    'Undo': '復原',
    'Retry': '重試',

    // Antigravity v2.35.1–2.35.2 Active-Turn Model Note, /btw, Skills, Customizations & Marketplace
    'Applies to /btw and messages sent after this turn': '將用於 /btw 及本輪之後傳送的訊息',
    'Applies to messages sent after this turn': '將用於本輪之後傳送的訊息',
    'Ask a side question...': '發起旁路追問 (/btw)…',
    'Side question': '旁路追問',
    'Skills & Customizations': '技能與自訂',
    'Skills': '技能',
    'Customizations': '自訂設定',
    'Agent Marketplace': 'Agent 外掛市集',
    'Marketplace': '外掛市集',
    'Browse Marketplace': '瀏覽外掛市集',
    'Plugins Manager': '外掛管理員',
    'Installed Plugins': '已安裝外掛',
    'Manage Plugins': '管理外掛',
    'MCP Servers': 'MCP 伺服器',
    'Enable Plugin': '啟用外掛',
    'Disable Plugin': '停用外掛',
    'Uninstall Plugin': '解除安裝外掛',
    'More options': '更多選項',
    'Native menu': '官方選單'
  });

  const I18N_PATTERNS = Object.freeze([
    {
      re: /^Thought for less than a second$/i,
      'zh-CN': () => '思考不到 1 秒',
      'zh-TW': () => '思考不到 1 秒'
    },
    {
      re: /^Thought for (\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/i,
      'zh-CN': (m) => `已思考 ${m[1]} 秒`,
      'zh-TW': (m) => `已思考 ${m[1]} 秒`
    },
    {
      re: /^Thought for (\d+)\s*m(?:in(?:ute)?s?)?(?:\s+(\d+)\s*s(?:ec)?s?)?$/i,
      'zh-CN': (m) => (m[2] ? `已思考 ${m[1]} 分 ${m[2]} 秒` : `已思考 ${m[1]} 分钟`),
      'zh-TW': (m) => (m[2] ? `已思考 ${m[1]} 分 ${m[2]} 秒` : `已思考 ${m[1]} 分鐘`)
    },
    {
      re: /^Step (\d+) of (\d+)$/i,
      'zh-CN': (m) => `第 ${m[1]} / ${m[2]} 步`,
      'zh-TW': (m) => `第 ${m[1]} / ${m[2]} 步`
    },
    {
      re: /^Step (\d+)$/i,
      'zh-CN': (m) => `步骤 ${m[1]}`,
      'zh-TW': (m) => `步驟 ${m[1]}`
    },
    {
      re: /^(\d+)\s+steps? completed$/i,
      'zh-CN': (m) => `已完成 ${m[1]} 个步骤`,
      'zh-TW': (m) => `已完成 ${m[1]} 個步驟`
    },
    {
      re: /^(\d+)\s+of\s+(\d+)\s+tasks? completed$/i,
      'zh-CN': (m) => `已完成 ${m[1]} / ${m[2]} 项任务`,
      'zh-TW': (m) => `已完成 ${m[1]} / ${m[2]} 項任務`
    },
    {
      re: /^(\d+)\s*\/\s*(\d+)\s+tasks?$/i,
      'zh-CN': (m) => `${m[1]} / ${m[2]} 项任务`,
      'zh-TW': (m) => `${m[1]} / ${m[2]} 項任務`
    },
    {
      re: /^(\d+)\s+tasks? remaining$/i,
      'zh-CN': (m) => `剩余 ${m[1]} 项任务`,
      'zh-TW': (m) => `剩餘 ${m[1]} 項任務`
    },
    {
      re: /^(\d+)\s+active\s+members?$/i,
      'zh-CN': (m) => `${m[1]} 名活跃成员`,
      'zh-TW': (m) => `${m[1]} 名活躍成員`
    },
    {
      re: /^(\d+)\s+members?$/i,
      'zh-CN': (m) => `${m[1]} 名成员`,
      'zh-TW': (m) => `${m[1]} 名成員`
    },
    {
      re: /^(\d+)\s+active\s+agents?$/i,
      'zh-CN': (m) => `${m[1]} 个活跃 Agent`,
      'zh-TW': (m) => `${m[1]} 個活躍 Agent`
    },
    {
      re: /^(\d+)\s+agents?$/i,
      'zh-CN': (m) => `${m[1]} 个 Agent`,
      'zh-TW': (m) => `${m[1]} 個 Agent`
    },
    {
      re: /^(\d+)\s+subagents?$/i,
      'zh-CN': (m) => `${m[1]} 个子 Agent`,
      'zh-TW': (m) => `${m[1]} 個子 Agent`
    },
    {
      re: /^Exporting\s+(\d+)%$/i,
      'zh-CN': (m) => `正在导出 ${m[1]}%`,
      'zh-TW': (m) => `正在匯出 ${m[1]}%`
    },
    {
      re: /^Exporting\s+(\d+)\s*\/\s*(\d+)(?:\s+messages?)?$/i,
      'zh-CN': (m) => `正在导出 ${m[1]} / ${m[2]}`,
      'zh-TW': (m) => `正在匯出 ${m[1]} / ${m[2]}`
    },
    {
      re: /^(\d+)\s+pinned$/i,
      'zh-CN': (m) => `${m[1]} 个置顶`,
      'zh-TW': (m) => `${m[1]} 個置頂`
    },
    {
      re: /^Load (\d+) older messages?$/i,
      'zh-CN': (m) => `加载 ${m[1]} 条更早的消息`,
      'zh-TW': (m) => `載入 ${m[1]} 則更早的訊息`
    },
    {
      re: /^(\d+)\s+older messages?$/i,
      'zh-CN': (m) => `${m[1]} 条更早的消息`,
      'zh-TW': (m) => `${m[1]} 則更早的訊息`
    },
    {
      re: /^Swarm:\s*(\d+)\s+active$/i,
      'zh-CN': (m) => `Swarm：${m[1]} 个活跃`,
      'zh-TW': (m) => `Swarm：${m[1]} 個活躍`
    },
    {
      re: /^(\d+)\s+completed,\s*(\d+)\s+running$/i,
      'zh-CN': (m) => `${m[1]} 已完成，${m[2]} 运行中`,
      'zh-TW': (m) => `${m[1]} 已完成，${m[2]} 執行中`
    }
  ]);

  function translateChromeString(raw, mode) {
    if (mode !== 'zh-CN' && mode !== 'zh-TW') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 96) return null;

    const dict = mode === 'zh-TW' ? I18N_EXACT_ZH_TW : I18N_EXACT_ZH_CN;
    let mapped = dict[trimmed];
    if (!mapped) {
      for (let i = 0; i < I18N_PATTERNS.length; i++) {
        const entry = I18N_PATTERNS[i];
        const m = trimmed.match(entry.re);
        if (m) {
          mapped = entry[mode](m);
          break;
        }
      }
    }
    if (!mapped || mapped === trimmed) return null;

    // Preserve original leading/trailing whitespace
    const leadMatch = raw.match(/^\s*/);
    const trailMatch = raw.match(/\s*$/);
    const lead = leadMatch ? leadMatch[0] : '';
    const trail = trailMatch ? trailMatch[0] : '';
    return `${lead}${mapped}${trail}`;
  }

  /* ==========================================================================
   * Module Initialization via Frozen Bus v4
   * ========================================================================== */
  function initWorkflowModule(bus) {
    if (window.__agPrismWorkflowToken !== INSTANCE_TOKEN) return;
    if (typeof window.__agPrismWorkflowDispose === 'function') {
      try { window.__agPrismWorkflowDispose(); } catch {}
    }

    let disposed = false;
    const ac = new AbortController();
    const { signal } = ac;
    const moduleCleanups = [];
    const addCleanup = (fn) => moduleCleanups.push(fn);

    bus.registerDefaults(DEFAULT_PREFS);

    function getPrefs() {
      const p = bus.getPrefs() || {};
      const i18nMode = VALID_I18N_MODES.has(p.i18nExtraMode) ? p.i18nExtraMode : 'off';
      return {
        imageContextMenu: p.imageContextMenu !== false,
        cleanCopy: p.cleanCopy !== false,
        sshPaste: p.sshPaste !== false,
        composerFileDrop: p.composerFileDrop !== false,
        i18nExtraMode: i18nMode,
        inlineEditHelper: p.inlineEditHelper !== false,
        sessionFork: p.sessionFork !== false
      };
    }

    function getViewport() {
      return (typeof bus.getViewportEl === 'function' && bus.getViewportEl())
        || document.querySelector('[data-testid="autoscroll-viewport"]');
    }

    function getComposerEditor() {
      const box = (typeof bus.getInputBoxEl === 'function' && bus.getInputBoxEl())
        || (typeof bus.getComposerEl === 'function' && bus.getComposerEl())
        || document.getElementById('antigravity.agentSidePanelInputBox');
      if (box) {
        if (box.isContentEditable || box.tagName === 'TEXTAREA') return box;
        const inner = box.querySelector('[contenteditable="true"], textarea');
        if (inner) return inner;
      }
      return document.querySelector('[data-testid="composer-input"], [contenteditable="true"][role="textbox"]');
    }

    function getComposerText() {
      const editor = getComposerEditor();
      if (!editor) return '';
      if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
        return String(editor.value || '').trim();
      }
      return String(editor.innerText || editor.textContent || '').trim();
    }

    function insertTextIntoComposer(text, replaceAll = false) {
      const editor = getComposerEditor();
      if (!editor) return false;
      const content = String(text || '');
      try {
        editor.focus();
        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          const nextVal = replaceAll ? content : `${editor.value || ''}${content}`;
          setNativeInputValue(editor, nextVal);
          return true;
        }
        if (replaceAll) {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          document.execCommand('selectAll', false);
        }
        const ok = document.execCommand('insertText', false, content);
        if (ok) return true;
      } catch {}
      return false;
    }

    function getUserTurnElements() {
      const scope = getViewport() || document;
      const nodes = Array.from(scope.querySelectorAll('[data-testid="user-message-content"]'));
      return nodes.filter((n) => {
        if (!n || !n.isConnected || !(n.textContent || '').trim().length) return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    }

    function getCurrentConversationId() {
      const path = window.location.pathname || '';
      const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const segMatch = path.match(/\/(?:conversations?|chats?|cascades?|sessions?|c)\/([A-Za-z0-9._:-]{4,128})/i);
      if (segMatch) return segMatch[1];
      const pathUuid = path.match(uuidRe);
      if (pathUuid) return pathUuid[0];

      try {
        const sp = new URLSearchParams(window.location.search || '');
        for (const k of ['conversationId', 'cascadeId', 'sessionId', 'chatId', 'id']) {
          const v = (sp.get(k) || '').trim();
          if (/^[A-Za-z0-9._:-]{4,128}$/.test(v)) return v;
        }
      } catch {}

      const hashUuid = (window.location.hash || '').match(uuidRe);
      if (hashUuid) return hashUuid[0];

      const selectedSidebarRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
      if (selectedSidebarRow) {
        const selVal = (
          selectedSidebarRow.getAttribute('data-conversation-id') ||
          selectedSidebarRow.getAttribute('data-cascade-id') ||
          selectedSidebarRow.getAttribute('data-session-id') ||
          ''
        ).trim();
        if (/^[A-Za-z0-9._:-]{4,128}$/.test(selVal)) return selVal;
      }

      const activeLink = document.querySelector('a[aria-current="page"][href]');
      if (activeLink) {
        const href = activeLink.getAttribute('href') || '';
        const lm = href.match(/\/(?:conversations?|chats?|cascades?|sessions?|c)\/([A-Za-z0-9._:-]{4,128})/i)
          || href.match(uuidRe);
        if (lm) return lm[1] || lm[0];
      }

      const attrNode = document.querySelector(
        '[data-testid="conversation-view"][data-cascade-id], [data-conversation-id]:not([data-testid="conversation-row-sidebar"]), [data-cascade-id]:not([data-testid="conversation-row-sidebar"]), [data-session-id]:not([data-testid="conversation-row-sidebar"])'
      );
      if (attrNode) {
        const v = (
          attrNode.getAttribute('data-conversation-id') ||
          attrNode.getAttribute('data-cascade-id') ||
          attrNode.getAttribute('data-session-id') ||
          ''
        ).trim();
        if (/^[A-Za-z0-9._:-]{4,128}$/.test(v)) return v;
      }

      return '';
    }

    /* ========================================================================
     * 1. Image Context Menu (Quote / Copy PNG / Save)
     * ======================================================================== */
    let activeImgMenu = null;
    let activeImgTarget = null;
    const objectUrlsToRevoke = new Set();

    function notifyWorkflowOverlayChange() {
      if (disposed) return;
      try {
        window.dispatchEvent(new CustomEvent('ag-prism-overlay-change'));
      } catch {}
    }

    function closeImageMenu() {
      const hadMenu = Boolean(activeImgMenu);
      if (activeImgMenu) {
        activeImgMenu.remove();
        activeImgMenu = null;
      }
      activeImgTarget = null;
      if (hadMenu) notifyWorkflowOverlayChange();
    }

    window.__agPrismCloseImageMenu = closeImageMenu;
    const onPeerCloseForImgMenu = (e) => {
      if (disposed) return;
      const ex = e && e.detail && e.detail.except ? String(e.detail.except) : '';
      if (ex !== 'img-menu') closeImageMenu();
    };
    window.addEventListener('ag-prism-close-popovers', onPeerCloseForImgMenu, { signal });

    addCleanup(() => {
      closeImageMenu();
      if (window.__agPrismCloseImageMenu === closeImageMenu) {
        try { delete window.__agPrismCloseImageMenu; } catch { window.__agPrismCloseImageMenu = undefined; }
      }
      objectUrlsToRevoke.forEach((u) => {
        try { URL.revokeObjectURL(u); } catch {}
      });
      objectUrlsToRevoke.clear();
    });

    async function imageToPngBlob(img) {
      if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
        throw new Error('IMAGE_NOT_READY');
      }
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
        const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
      ctx.drawImage(img, 0, 0, w, h);

      return await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('CANVAS_TO_BLOB_FAILED'));
          }, 'image/png');
        } catch (err) {
          reject(err);
        }
      });
    }

    function isSameOriginOrLocalUrl(src) {
      const s = String(src || '');
      if (s.startsWith('blob:') || s.startsWith('data:image/')) return true;
      try {
        const u = new URL(s, window.location.href);
        return u.origin === window.location.origin;
      } catch {
        return false;
      }
    }

    async function resolveReadablePngBlob(img) {
      try {
        return await imageToPngBlob(img);
      } catch (err) {
        const src = String(img?.currentSrc || img?.src || '');
        if (!src || !isSameOriginOrLocalUrl(src)) {
          const corsErr = new Error('CORS_TAINTED');
          corsErr.cause = err;
          throw corsErr;
        }
        // Fallback: fetch local/blob/same-origin and draw via createImageBitmap if possible
        const res = await fetch(src);
        if (!res.ok) throw err;
        const rawBlob = await res.blob();
        if (rawBlob.type === 'image/png') return rawBlob;
        if (typeof createImageBitmap === 'function') {
          const bmp = await createImageBitmap(rawBlob);
          try {
            let w = bmp.width;
            let h = bmp.height;
            if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {
              const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);
              w = Math.max(1, Math.round(w * scale));
              h = Math.max(1, Math.round(h * scale));
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0, w, h);
            return await new Promise((resolve, reject) => {
              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('BLOB_FAIL'))), 'image/png');
            });
          } finally {
            bmp.close();
          }
        }
        return rawBlob;
      }
    }

    async function handleImageQuote(img) {
      const filename = inferFilenameFromImage(img);
      const cleanLabel = String(img.alt || filename).replace(/\s+/g, ' ').trim().slice(0, 64) || '图片';
      const editor = getComposerEditor();

      // Try pasting actual image blob into composer via synthetic ClipboardEvent
      if (editor && typeof DataTransfer === 'function' && typeof ClipboardEvent === 'function') {
        try {
          const blob = await resolveReadablePngBlob(img);
          const file = new File([blob], sanitizeFilename(filename, 'png'), { type: 'image/png' });
          const dt = new DataTransfer();
          dt.items.add(file);
          editor.focus();
          const pasteEv = new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          });
          editor.dispatchEvent(pasteEv);
          if (pasteEv.defaultPrevented) {
            bus.showToast('已将图片引用粘贴到输入框');
            return;
          }
        } catch {}
      }

      // Clean text reference fallback
      const refText = `关于图片「${cleanLabel}」：`;
      if (insertTextIntoComposer(refText, false)) {
        bus.showToast('已插入图片引用文本到输入框');
        return;
      }
      const copied = await writeClipboardText(refText);
      bus.showToast(copied ? '已复制图片引用文本，按 Ctrl+V 粘贴' : '未能写入输入框，请手动引用该图片');
    }

    async function handleImageCopy(img) {
      if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
        bus.showToast('当前环境不支持剪贴板写入图片，请使用「保存图片」');
        return;
      }
      try {
        const blob = await resolveReadablePngBlob(img);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        bus.showToast('已复制图片（PNG）到剪贴板');
      } catch (err) {
        const msg = String(err && err.message || '');
        const isCors = msg === 'CORS_TAINTED' || (err && err.name === 'SecurityError');
        if (isCors) {
          bus.showToast('该外部图片受跨域（CORS）限制无法直接复制，可尝试「保存图片」');
        } else {
          bus.showToast('复制图片失败：剪贴板权限受限或图片尚未加载完成');
        }
      }
    }

    function triggerAnchorDownload(href, filename, openBlankFallback = false) {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      if (openBlankFallback) a.target = '_blank';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    async function handleImageSave(img) {
      const src = String(img?.currentSrc || img?.src || '');
      if (!isSafeDownloadUrl(src)) {
        bus.showToast('不支持的图片链接协议，已拦截保存');
        return;
      }
      const filename = inferFilenameFromImage(img);

      // Direct blob: or data:image/ URLs download cleanly as-is
      if (src.startsWith('blob:') || src.startsWith('data:image/')) {
        triggerAnchorDownload(src, filename, false);
        bus.showToast(`已触发保存：${filename}`);
        return;
      }

      // Same-origin or canvas-readable image -> save via object URL
      try {
        const blob = await resolveReadablePngBlob(img);
        const objUrl = URL.createObjectURL(blob);
        objectUrlsToRevoke.add(objUrl);
        triggerAnchorDownload(objUrl, sanitizeFilename(filename, 'png'), false);
        setTimeout(() => {
          objectUrlsToRevoke.delete(objUrl);
          try { URL.revokeObjectURL(objUrl); } catch {}
        }, 10000);
        bus.showToast(`已触发保存：${sanitizeFilename(filename, 'png')}`);
        return;
      } catch {}

      // Cross-origin fetch attempt (works when server sends Access-Control-Allow-Origin)
      try {
        const res = await fetch(src, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          objectUrlsToRevoke.add(objUrl);
          triggerAnchorDownload(objUrl, filename, false);
          setTimeout(() => {
            objectUrlsToRevoke.delete(objUrl);
            try { URL.revokeObjectURL(objUrl); } catch {}
          }, 10000);
          bus.showToast(`已触发保存：${filename}`);
          return;
        }
      } catch {}

      // Final clean cross-origin fallback
      triggerAnchorDownload(src, filename, true);
      bus.showToast('跨域图片已通过浏览器触发保存');
    }

    function openImageContextMenu(img, clientX, clientY) {
      closeImageMenu();
      try {
        window.dispatchEvent(new CustomEvent('ag-prism-close-popovers', { detail: { except: 'img-menu' } }));
      } catch {}
      activeImgTarget = img;

      const menu = document.createElement('div');
      menu.id = 'ag-ps-img-menu';
      menu.tabIndex = -1;
      menu.setAttribute('data-ag-i18n-ignore', '1');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', '图片快捷菜单');

      const w = img.naturalWidth || Math.round(img.getBoundingClientRect().width);
      const h = img.naturalHeight || Math.round(img.getBoundingClientRect().height);
      const meta = document.createElement('div');
      meta.className = 'ag-ps-img-menu-meta';
      const labelName = inferFilenameFromImage(img);
      meta.textContent = w > 0 && h > 0 ? `${w} × ${h} · ${labelName}` : labelName;
      menu.appendChild(meta);

      const sep = document.createElement('div');
      sep.className = 'ag-ps-img-menu-sep';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);

      const items = [
        { id: 'quote', icon: '↩', label: '引用到输入框', run: () => handleImageQuote(img) },
        { id: 'copy', icon: '⎘', label: '复制图片', run: () => handleImageCopy(img) },
        { id: 'save', icon: '↓', label: '保存图片', run: () => handleImageSave(img) }
      ];

      items.forEach((it) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ag-ps-img-menu-item';
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-img-act', it.id);

        const ico = document.createElement('span');
        ico.className = 'ag-ps-img-menu-ico';
        ico.setAttribute('aria-hidden', 'true');
        ico.textContent = it.icon;

        const lbl = document.createElement('span');
        lbl.textContent = it.label;

        btn.appendChild(ico);
        btn.appendChild(lbl);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeImageMenu();
          void it.run();
        });
        menu.appendChild(btn);
      });

      menu.style.visibility = 'hidden';
      menu.style.left = '0px';
      menu.style.top = '0px';
      document.body.appendChild(menu);

      const mw = menu.offsetWidth || 184;
      const mh = menu.offsetHeight || 132;
      const margin = 8;
      const left = Math.max(margin, Math.min(window.innerWidth - mw - margin, Math.round(clientX)));
      const top = Math.max(margin, Math.min(window.innerHeight - mh - margin, Math.round(clientY)));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = 'visible';
      activeImgMenu = menu;
      const firstItem = menu.querySelector('.ag-ps-img-menu-item:not([disabled])');
      if (firstItem && typeof firstItem.focus === 'function') {
        try { firstItem.focus({ preventScroll: true }); } catch {}
      }
      notifyWorkflowOverlayChange();
    }

    document.addEventListener('contextmenu', (e) => {
      if (disposed || !getPrefs().imageContextMenu) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const img = target.closest('img');
      if (!img) return;
      const vp = getViewport();
      if (!vp || !vp.contains(img)) return;
      if (img.closest('#ag-ps-popover, #ag-ps-outline, #ag-ps-img-menu, #ag-ps-mascot-dock')) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 16 && rect.height < 16) return;

      e.preventDefault();
      e.stopPropagation();
      openImageContextMenu(img, e.clientX, e.clientY);
    }, { capture: true, signal });

    document.addEventListener('pointerdown', (e) => {
      if (!activeImgMenu) return;
      if (!(e.target instanceof Node) || !activeImgMenu.contains(e.target)) {
        closeImageMenu();
      }
    }, { capture: true, signal });

    window.addEventListener('keydown', (e) => {
      if (!activeImgMenu || !activeImgMenu.isConnected) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        closeImageMenu();
        return;
      }
      if (e.key === 'Tab') {
        closeImageMenu();
        return;
      }
      const items = Array.from(activeImgMenu.querySelectorAll('.ag-ps-img-menu-item:not([disabled])'));
      if (!items.length) return;
      const curIdx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % items.length;
        try { items[nextIdx].focus({ preventScroll: true }); } catch {}
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const prevIdx = curIdx <= 0 ? items.length - 1 : curIdx - 1;
        try { items[prevIdx].focus({ preventScroll: true }); } catch {}
      } else if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        try { items[0].focus({ preventScroll: true }); } catch {}
      } else if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        try { items[items.length - 1].focus({ preventScroll: true }); } catch {}
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (curIdx >= 0 && items[curIdx]) {
          e.preventDefault();
          e.stopPropagation();
          items[curIdx].click();
        }
      }
    }, { capture: true, signal });

    window.addEventListener('blur', closeImageMenu, { signal });
    window.addEventListener('resize', closeImageMenu, { passive: true, signal });
    document.addEventListener('scroll', closeImageMenu, { capture: true, passive: true, signal });

    /* ========================================================================
     * 2. Clean Final-Answer Copy (Filters Collapsed Thinking & Tool Summaries)
     * ======================================================================== */
    const CODE_COPY_EXCLUDE_SELECTOR = [
      'pre',
      'code',
      '[data-testid*="code"]',
      '[class*="code-block"]',
      '[class*="codeblock"]',
      '[class*="CodeBlock"]',
      '.shiki',
      '.hljs',
      '[data-language]'
    ].join(', ');

    const THOUGHT_OR_TOOL_SELECTORS = [
      '[data-testid*="thinking"]',
      '[data-testid*="thought"]',
      '[data-testid*="tool-call"]',
      '[data-testid*="tool-use"]',
      '[data-testid*="tool-summary"]',
      '[data-testid*="tool-group"]',
      '[data-testid*="tool-result"]',
      '[data-testid*="step-progress"]',
      '[data-testid*="steps-summary"]',
      '[data-testid*="task-progress"]',
      '[data-testid*="execution-step"]',
      '[data-testid*="plan-step"]',
      'details[data-thinking]',
      'details[data-tool]',
      '.ag-ps-thought-zh',
      '.ag-ps-turn-actions',
      '.ag-ps-inline-editor',
      '[data-ag-i18n-ignore="1"]',
      '[data-testid*="message-actions"]',
      '[data-testid*="response-actions"]',
      '[role="toolbar"]',
      'style',
      'script',
      'noscript'
    ].join(', ');

    const SUMMARY_BTN_RE = /^(Thought\s+for|Thinking\b|已思考|思考过程|思考過程|Used\s+\d+\s+tools?|Ran\s+\d+|Executed|Step\s+\d+|步骤\s*\d+|步驟\s*\d+|\d+\s+steps?\s+completed|已完成\s*\d+\s*[个個]?步骤)/i;

    function isAssistantCopyButton(btn) {
      if (!btn || !(btn instanceof Element)) return false;
      if (btn.closest('#ag-ps-popover, #ag-ps-outline, #ag-ps-img-menu, .ag-ps-inline-editor, .ag-ps-turn-actions')) {
        return false;
      }
      // Strictly exclude code-block copy buttons and user message copy buttons
      if (btn.closest(CODE_COPY_EXCLUDE_SELECTOR)) return false;
      if (btn.closest('[data-testid="user-message"], [data-testid="user-message-bubble"], [data-testid="user-message-content"]')) {
        return false;
      }

      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('code')) return false;

      const label = (
        btn.getAttribute('aria-label') ||
        btn.getAttribute('title') ||
        btn.textContent ||
        ''
      ).trim();

      const testIdMatch = /copy/.test(testId) && !/code/.test(testId);
      const labelMatch = /^(copy(\s+(message|response|reply|answer|text))?|复制(回复|消息|全文|内容)?|複製(回覆|訊息|全文|內容)?)$/i.test(label);
      return testIdMatch || labelMatch;
    }

    function findAssistantResponseContainer(btn, viewport) {
      const candidates = [
        '[data-testid="assistant-message"]',
        '[data-testid="agent-message"]',
        '[data-testid="assistant-turn"]',
        '[data-testid="response-container"]',
        '[data-testid="message-item"]',
        '[data-message-role="assistant"]',
        'article'
      ];
      for (const sel of candidates) {
        const found = btn.closest(sel);
        if (found && viewport.contains(found) && found !== viewport) {
          return found;
        }
      }
      // Walk up from button until we find a container with markdown content that doesn't include user turns
      let cur = btn.parentElement;
      let depth = 0;
      while (cur && cur !== viewport && cur !== document.body && depth < 10) {
        const hasMarkdown = Boolean(cur.querySelector('[data-markdown-root]'));
        const hasUserTurn = Boolean(cur.querySelector('[data-testid="user-message-content"]'));
        if (hasMarkdown && !hasUserTurn) {
          return cur;
        }
        cur = cur.parentElement;
        depth++;
      }
      return null;
    }

    function serializeCleanDomToText(root) {
      const BLOCK_TAGS = new Set([
        'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
        'BLOCKQUOTE', 'TABLE', 'TR', 'HR'
      ]);
      const rawSegments = [];

      function walkSegmented(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          rawSegments.push({ pre: false, text: node.nodeValue || '' });
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName;
        // Preserve <pre> blocks verbatim with ZERO regex mutation!
        if (tag === 'PRE') {
          rawSegments.push({ pre: false, text: '\n' });
          rawSegments.push({ pre: true, text: node.textContent || '' });
          rawSegments.push({ pre: false, text: '\n' });
          return;
        }
        if (tag === 'BR') {
          rawSegments.push({ pre: false, text: '\n' });
          return;
        }
        if (tag === 'HR') {
          rawSegments.push({ pre: false, text: '\n---\n' });
          return;
        }
        const isBlock = BLOCK_TAGS.has(tag);
        if (isBlock) rawSegments.push({ pre: false, text: '\n' });
        if (tag === 'LI') rawSegments.push({ pre: false, text: '- ' });
        for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
          walkSegmented(ch);
        }
        if (isBlock) rawSegments.push({ pre: false, text: '\n' });
      }
      walkSegmented(root);

      let result = '';
      let proseBuf = '';
      const flushProse = () => {
        if (!proseBuf) return;
        result += proseBuf
          .replace(/\r\n/g, '\n')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n');
        proseBuf = '';
      };

      for (const seg of rawSegments) {
        if (seg.pre) {
          flushProse();
          result += seg.text;
        } else {
          proseBuf += seg.text;
        }
      }
      flushProse();
      return result.trim();
    }

    function extractCleanFinalAnswer(container) {
      const clone = container.cloneNode(true);
      let removedCount = 0;

      // 1. Remove explicit thinking collapsible triggers & their wrapper/body
      const triggers = Array.from(clone.querySelectorAll('[data-testid="thinking-collapsible-trigger"]'));
      for (const trig of triggers) {
        if (!trig.isConnected || trig.closest('pre, code')) continue;
        const parent = trig.parentElement;
        if (parent && parent !== clone && !parent.querySelector('[data-markdown-root]') && !parent.querySelector('pre')) {
          parent.remove();
        } else {
          if (parent) {
            for (const ch of Array.from(parent.children)) {
              if (ch !== trig && !ch.querySelector('[data-markdown-root]') && !ch.querySelector('pre')) {
                ch.remove();
              }
            }
          }
          trig.remove();
        }
        removedCount++;
      }

      // 2. Remove explicit thinking / tool / step-progress / action-bar nodes
      const knownNoise = Array.from(clone.querySelectorAll(THOUGHT_OR_TOOL_SELECTORS));
      for (const node of knownNoise) {
        if (!node.isConnected || node.closest('pre, code')) continue;
        // Safety: never remove a container that wraps the final markdown answer itself
        if (node.querySelector('[data-markdown-root]') && !node.matches('[data-testid*="thinking"], [data-testid*="thought"], [data-testid*="tool"]')) {
          continue;
        }
        node.remove();
        removedCount++;
      }

      // 3. Remove collapsed summary buttons (thinking/tool/step summaries)
      const collapsibleBtns = Array.from(clone.querySelectorAll('button[aria-expanded]'));
      for (const b of collapsibleBtns) {
        if (!b.isConnected) continue;
        if (b.closest('pre, code')) continue;
        const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (SUMMARY_BTN_RE.test(txt)) {
          const wrap = b.parentElement;
          if (wrap && wrap !== clone && !wrap.querySelector('[data-markdown-root]') && !wrap.querySelector('pre')) {
            wrap.remove();
          } else {
            b.remove();
          }
          removedCount++;
        }
      }

      // 4. Remove remaining non-code UI buttons (e.g. Copy / Regenerate / Thumbs)
      const uiBtns = Array.from(clone.querySelectorAll('button'));
      for (const b of uiBtns) {
        if (!b.isConnected || b.closest('pre, code')) continue;
        b.remove();
      }

      const text = serializeCleanDomToText(clone);
      return { text, removedCount };
    }

    // Single module-level copy intercept slot to guarantee zero zombie window 'copy' listeners
    let activeCopyIntercept = null;

    function clearActiveCopyIntercept() {
      if (!activeCopyIntercept) return;
      const { handler, timerId } = activeCopyIntercept;
      activeCopyIntercept = null;
      clearTimeout(timerId);
      try { window.removeEventListener('copy', handler, true); } catch {}
    }
    addCleanup(clearActiveCopyIntercept);

    document.addEventListener('click', (e) => {
      if (disposed || !getPrefs().cleanCopy) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const btn = target.closest('button, [role="button"]');
      if (!isAssistantCopyButton(btn)) return;

      const vp = getViewport();
      if (!vp || !vp.contains(btn)) return;

      const container = findAssistantResponseContainer(btn, vp);
      if (!container) return;

      const { text, removedCount } = extractCleanFinalAnswer(container);
      // Only override if we actually filtered thinking/tool noise and have clean final text
      if (!removedCount || !text) return;

      // Always remove any prior pending listener/timer before registering a new intercept
      clearActiveCopyIntercept();

      let syncCopyHandled = false;
      const intercept = { handler: null, timerId: 0 };

      // Preserve native button visual feedback & checkmark animation (let click bubble to React),
      // while overriding sync execCommand('copy') AND async navigator.clipboard.writeText().
      const onCopyIntercept = (copyEv) => {
        if (activeCopyIntercept !== intercept) return;
        clearActiveCopyIntercept();
        if (copyEv.clipboardData) {
          copyEv.clipboardData.setData('text/plain', text);
          copyEv.preventDefault();
          syncCopyHandled = true;
          if (!disposed) {
            bus.showToast('已过滤思考与工具摘要，复制纯净回复');
          }
        }
      };

      intercept.handler = onCopyIntercept;
      window.addEventListener('copy', onCopyIntercept, { capture: true, once: true });

      intercept.timerId = setTimeout(() => {
        if (activeCopyIntercept === intercept) {
          clearActiveCopyIntercept();
        }
        if (disposed || syncCopyHandled) return;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).then(
            () => {
              if (!disposed) bus.showToast('已过滤思考与工具摘要，复制纯净回复');
            },
            () => {
              // Clipboard write permission denied / unfocused: fall back silently to host's native copy
            }
          );
        }
      }, 80);

      activeCopyIntercept = intercept;
    }, { capture: true, signal });

    /* ========================================================================
     * 3. SSH Command Paste Auto-Parser
     * ======================================================================== */
    const sshStatusEls = new Set();

    addCleanup(() => {
      sshStatusEls.forEach((el) => {
        try { el.remove(); } catch {}
      });
      sshStatusEls.clear();
    });

    function isSshHostInput(el) {
      if (!(el instanceof HTMLInputElement)) return false;
      if (el.matches('input[data-testid="ssh-connect-host-input"]')) return true;
      const dialog = el.closest('[data-testid="ssh-connect-dialog"]');
      if (!dialog) return false;
      const type = (el.type || 'text').toLowerCase();
      if (type !== 'text' && type !== 'search' && type !== 'url') return false;
      const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('data-testid') || ''}`.toLowerCase();
      if (/\b(pass|pwd|secret|token|key)\b/.test(hint)) return false;
      return true;
    }

    function findSiblingPortInput(hostInput) {
      const dialog = hostInput.closest('[data-testid="ssh-connect-dialog"]') || hostInput.closest('[role="dialog"]');
      if (!dialog) return null;
      const candidates = Array.from(dialog.querySelectorAll('input'));
      for (const inp of candidates) {
        if (inp === hostInput || inp.disabled || inp.readOnly) continue;
        const t = (inp.type || 'text').toLowerCase();
        if (t !== 'text' && t !== 'number') continue;
        const hint = `${inp.getAttribute('data-testid') || ''} ${inp.name || ''} ${inp.id || ''} ${inp.placeholder || ''} ${inp.getAttribute('aria-label') || ''}`.toLowerCase();
        if (/\bport\b|端口|^22$/.test(hint)) return inp;
      }
      return null;
    }

    function showSshParseStatus(inputEl, message, isWarn = false) {
      const hostWrap = inputEl.parentElement;
      if (!hostWrap) return;
      let statusEl = hostWrap.querySelector(':scope > .ag-ps-ssh-status')
        || (hostWrap.nextElementSibling && hostWrap.nextElementSibling.classList.contains('ag-ps-ssh-status')
          ? hostWrap.nextElementSibling
          : null);
      if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'ag-ps-ssh-status';
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        statusEl.setAttribute('data-ag-i18n-ignore', '1');
        hostWrap.insertAdjacentElement('afterend', statusEl);
        sshStatusEls.add(statusEl);
      }
      statusEl.textContent = message;
      if (isWarn) statusEl.setAttribute('data-tone', 'warn');
      else statusEl.removeAttribute('data-tone');
    }

    document.addEventListener('paste', (e) => {
      if (disposed || !getPrefs().sshPaste) return;
      const target = e.target instanceof Element ? e.target.closest('input') : null;
      if (!isSshHostInput(target)) return;

      const raw = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if (!raw || !/^\s*(?:(?:[^\s]+[\\/])?(?:sshpass(?:\.exe)?|ssh(?:\.exe)?))\s+/i.test(raw)) {
        return;
      }

      const parsed = parseSshCommand(raw);
      if (!parsed) return;

      e.preventDefault();
      e.stopPropagation();

      const portInput = findSiblingPortInput(target);
      if (portInput && parsed.port !== null) {
        setNativeInputValue(target, parsed.hostWithoutPort);
        setNativeInputValue(portInput, String(parsed.port));
      } else {
        setNativeInputValue(target, parsed.hostWithPort);
      }

      const notes = [];
      if (parsed.port !== null) notes.push(`端口 ${parsed.port}`);
      if (parsed.passwordStripped) notes.push('已安全丢弃密码');
      if (parsed.extraStripped) notes.push('已忽略附加参数');
      const suffix = notes.length ? `（${notes.join(' · ')}）` : '';
      showSshParseStatus(target, `已自动解析 SSH 目标：${parsed.hostWithPort}${suffix}`, parsed.passwordStripped);
    }, { capture: true, signal });

    /* ========================================================================
     * 3b. Composer Local File & Folder Drag/Drop & Paste Reference Helper
     *     (Clean-Room non-conflicting fallback: yields whenever host/Anti-Claude handles first)
     * ======================================================================== */
    let activeDropCard = null;

    function clearDropHighlight() {
      if (activeDropCard) {
        activeDropCard.classList.remove('ag-ps-drop-target');
        activeDropCard = null;
      }
    }
    addCleanup(clearDropHighlight);

    function decodeFileUriToPath(uriStr) {
      const raw = String(uriStr || '').trim();
      if (!/^file:\/\//i.test(raw)) return '';
      try {
        const u = new URL(raw);
        if (u.protocol !== 'file:') return '';
        let pathname = decodeURIComponent(u.pathname || '');
        if (!pathname) return '';
        // Windows file:///D:/foo/bar -> D:\foo\bar
        if (/^\/[A-Za-z]:[\\/]/.test(pathname)) {
          pathname = pathname.slice(1).replace(/\//g, '\\');
        } else if (u.host && u.host !== 'localhost') {
          pathname = `\\\\${u.host}${pathname.replace(/\//g, '\\')}`;
        }
        return /[\x00-\x1f]/.test(pathname) ? '' : pathname;
      } catch {
        return '';
      }
    }

    function extractNonImageLocalPaths(dt) {
      if (!dt) return { paths: [], hasImageFiles: false };
      const seen = new Set();
      const paths = [];
      let hasImageFiles = false;
      const pushPath = (p) => {
        const clean = String(p || '').trim();
        if (!clean || /[\x00-\x1f]/.test(clean) || seen.has(clean)) return;
        seen.add(clean);
        paths.push(clean);
      };

      const fileList = dt.files ? Array.from(dt.files) : [];
      for (const f of fileList) {
        if (!f) continue;
        const mime = String(f.type || '').toLowerCase();
        if (mime.startsWith('image/')) {
          hasImageFiles = true;
          continue;
        }
        let resolved = '';
        try {
          if (window.electronNative && typeof window.electronNative.getPathForFile === 'function') {
            resolved = String(window.electronNative.getPathForFile(f) || '').trim();
          }
        } catch {}
        if (!resolved && typeof f.path === 'string' && f.path.trim()) {
          resolved = f.path.trim();
        }
        if (resolved) pushPath(resolved);
      }

      if (!paths.length) {
        try {
          const uriList = String(dt.getData('text/uri-list') || '');
          for (const line of uriList.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const fp = decodeFileUriToPath(trimmed);
            if (fp && !/\.(?:png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(fp)) {
              pushPath(fp);
            }
          }
        } catch {}
      }

      return { paths, hasImageFiles };
    }

    function resolveTargetComposerEditor(targetNode) {
      const el = targetNode instanceof Element ? targetNode : (targetNode && targetNode.parentElement);
      if (!el) return null;
      if (el.closest('.ag-ps-inline-editor, #ag-ps-popover, [data-testid="ssh-connect-dialog"], .monaco-editor, .cm-editor, .xterm')) {
        return null;
      }
      const directEditable = el.closest('[contenteditable="true"], textarea');
      if (directEditable) {
        const hostCard = directEditable.closest(
          '[id="antigravity.agentSidePanelInputBox"], [data-testid*="composer"], [data-testid*="input"], form'
        ) || directEditable.parentElement;
        return { editor: directEditable, card: hostCard || directEditable };
      }
      const wrapper = el.closest('[id="antigravity.agentSidePanelInputBox"], [data-testid*="composer"]');
      if (wrapper) {
        const inner = wrapper.querySelector('[contenteditable="true"], textarea');
        if (inner) return { editor: inner, card: wrapper };
      }
      return null;
    }

    function insertTextIntoTargetEditor(editor, text) {
      if (!editor || !text) return false;
      try {
        editor.focus();
        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          const cur = String(editor.value || '');
          const sep = cur && !/\s$/.test(cur) ? ' ' : '';
          setNativeInputValue(editor, `${cur}${sep}${text} `);
          return true;
        }
        const curTxt = String(editor.textContent || '');
        const prefix = curTxt && !/\s$/.test(curTxt) ? ' ' : '';
        return Boolean(document.execCommand('insertText', false, `${prefix}${text} `));
      } catch {
        return false;
      }
    }

    function formatFileRefTokens(paths) {
      return paths.map((p) => (/\s/.test(p) ? `@"${p.replace(/"/g, '')}"` : `@${p}`)).join(' ');
    }

    document.addEventListener('dragover', (e) => {
      if (disposed || !getPrefs().composerFileDrop || e.defaultPrevented) return;
      const dt = e.dataTransfer;
      if (!dt || !Array.from(dt.types || []).some((t) => t === 'Files' || t === 'text/uri-list')) return;
      const hit = resolveTargetComposerEditor(e.target);
      if (!hit) {
        clearDropHighlight();
        return;
      }
      e.preventDefault();
      if (dt) dt.dropEffect = 'copy';
      if (activeDropCard !== hit.card) {
        clearDropHighlight();
        activeDropCard = hit.card;
        activeDropCard.classList.add('ag-ps-drop-target');
      }
    }, { capture: false, signal });

    document.addEventListener('dragleave', (e) => {
      if (!activeDropCard) return;
      const related = e.relatedTarget;
      if (!related || !(related instanceof Node) || !activeDropCard.contains(related)) {
        clearDropHighlight();
      }
    }, { capture: false, signal });

    document.addEventListener('drop', (e) => {
      const hadCard = activeDropCard;
      clearDropHighlight();
      if (disposed || !getPrefs().composerFileDrop || e.defaultPrevented) return;
      const hit = resolveTargetComposerEditor(e.target) || (hadCard ? resolveTargetComposerEditor(hadCard) : null);
      if (!hit) return;
      const { paths, hasImageFiles } = extractNonImageLocalPaths(e.dataTransfer);
      if (!paths.length) return;
      if (!hasImageFiles) {
        e.preventDefault();
      }
      const refText = formatFileRefTokens(paths);
      if (insertTextIntoTargetEditor(hit.editor, refText)) {
        try {
          if (typeof bus.showToast === 'function') bus.showToast(`已插入 ${paths.length} 个本地文件/目录引用`);
          else if (typeof bus.toast === 'function') bus.toast(`已插入 ${paths.length} 个本地文件/目录引用`);
        } catch {}
      }
    }, { capture: false, signal });

    document.addEventListener('paste', (e) => {
      if (disposed || !getPrefs().composerFileDrop || e.defaultPrevented) return;
      const dt = e.clipboardData;
      if (!dt) return;
      // Do not intercept normal text pastes
      const plain = String(dt.getData('text/plain') || '').trim();
      if (plain && (!dt.files || dt.files.length === 0)) return;
      const hit = resolveTargetComposerEditor(e.target);
      if (!hit) return;
      const { paths, hasImageFiles } = extractNonImageLocalPaths(dt);
      if (!paths.length || hasImageFiles) return;
      e.preventDefault();
      const refText = formatFileRefTokens(paths);
      if (insertTextIntoTargetEditor(hit.editor, refText)) {
        try {
          if (typeof bus.showToast === 'function') bus.showToast(`已粘贴 ${paths.length} 个本地文件/目录引用`);
          else if (typeof bus.toast === 'function') bus.toast(`已粘贴 ${paths.length} 个本地文件/目录引用`);
        } catch {}
      }
    }, { capture: false, signal });

    /* ========================================================================
     * 4. 2.34–2.35 & Swarm Incremental i18n Supplement (Zero Body Observer)
     * ======================================================================== */
    const i18nOriginals = new WeakMap(); // TextNode -> { orig: string, applied: string }
    const i18nTrackedRefs = new Set();   // Set<WeakRef<Text>>

    const I18N_SCOPE_SELECTOR = [
      'aside',
      'nav',
      '[data-testid*="sidebar"]',
      '[data-testid*="conversation-list"]',
      '[data-testid*="inbox"]',
      '[data-testid*="swarm"]',
      '[data-testid*="hive"]',
      '[data-testid*="subagent"]',
      '[class*="swarm"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[role="menu"]',
      '[role="listbox"]',
      '[data-radix-popper-content-wrapper]',
      '[data-testid*="dialog"]',
      '[data-testid*="modal"]',
      '[data-testid*="settings"]',
      '[data-testid*="permission"]',
      '[data-testid*="ssh-connect"]',
      '[data-testid="pane-titlebar-toolbar"]',
      '[data-testid="thinking-collapsible-trigger"]',
      '[data-testid*="load-older"]',
      '[data-testid*="step-"]',
      '[data-testid*="overview-panel"]',
      '[data-testid*="status-bar"]',
      '#ag-claude-model-popover',
      '#ag-claude-model-subpop',
      '#ag-claude-model-tripop',
      '[data-testid*="marketplace"]',
      '[data-testid*="plugin"]',
      '[data-testid*="skill"]',
      '[data-testid*="customization"]'
    ].join(', ');

    const I18N_SKIP_ANCESTOR_SELECTOR = [
      '[contenteditable]',
      '[contenteditable="true"]',
      '[data-markdown-root]',
      'pre',
      'code',
      'textarea',
      'input',
      'script',
      'style',
      'svg',
      '.monaco-editor',
      '.monaco-diff-editor',
      '.view-lines',
      '.cm-editor',
      '.xterm',
      '.code-block',
      '.font-mono',
      '[data-testid*="diff"]',
      '[data-testid*="code-viewer"]',
      '[data-ag-i18n-ignore]',
      '#ag-ps-popover',
      '#ag-ps-outline',
      '#ag-ps-img-menu'
    ].join(', ');

    function restoreAllI18nNodes() {
      for (const ref of Array.from(i18nTrackedRefs)) {
        const node = typeof ref.deref === 'function' ? ref.deref() : null;
        if (!node) {
          i18nTrackedRefs.delete(ref);
          continue;
        }
        const rec = i18nOriginals.get(node);
        if (rec && node.isConnected && node.nodeValue === rec.applied) {
          node.nodeValue = rec.orig;
        }
        i18nOriginals.delete(node);
        i18nTrackedRefs.delete(ref);
      }
    }

    addCleanup(restoreAllI18nNodes);

    function pruneDeadI18nRefs() {
      if (!i18nTrackedRefs.size) return;
      for (const ref of i18nTrackedRefs) {
        if (!ref || typeof ref.deref !== 'function' || ref.deref() == null) {
          i18nTrackedRefs.delete(ref);
        }
      }
    }

    function runI18nPass() {
      if (disposed || document.hidden) return;
      const mode = getPrefs().i18nExtraMode;
      if (mode === 'off' || mode === 'en') {
        if (i18nTrackedRefs.size > 0) restoreAllI18nNodes();
        return;
      }
      if (typeof bus.isTyping === 'function' && bus.isTyping()) return;

      pruneDeadI18nRefs();

      const containers = document.querySelectorAll(I18N_SCOPE_SELECTOR);
      if (!containers.length) return;

      const visited = new WeakSet();
      let processed = 0;

      for (let i = 0; i < containers.length; i++) {
        const root = containers[i];
        if (!root || !root.isConnected || visited.has(root)) continue;
        if (root.closest(I18N_SKIP_ANCESTOR_SELECTOR)) continue;
        visited.add(root);

        const walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(textNode) {
              const parent = textNode.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              if (parent.closest(I18N_SKIP_ANCESTOR_SELECTOR)) return NodeFilter.FILTER_REJECT;
              const val = textNode.nodeValue;
              if (!val || !val.trim() || val.length > 120) return NodeFilter.FILTER_SKIP;
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        let textNode = walker.nextNode();
        while (textNode) {
          if (++processed > I18N_MAX_NODES_PER_PASS) return;

          const curVal = textNode.nodeValue || '';
          const rec = i18nOriginals.get(textNode);

          // Determine authoritative English source (handle React dynamic text updates cleanly)
          let sourceText = curVal;
          if (rec) {
            if (curVal === rec.applied) {
              sourceText = rec.orig;
            } else {
              // Host updated this text node to new content
              sourceText = curVal;
            }
          }

          const translated = translateChromeString(sourceText, mode);
          if (translated && translated !== curVal) {
            if (!rec) {
              i18nOriginals.set(textNode, { orig: sourceText, applied: translated });
              if (typeof WeakRef === 'function') {
                i18nTrackedRefs.add(new WeakRef(textNode));
              }
            } else {
              rec.orig = sourceText;
              rec.applied = translated;
            }
            textNode.nodeValue = translated;
          }
          textNode = walker.nextNode();
        }
      }
    }

    /* ========================================================================
     * 5 & 6. In-Place Message Edit Helper + Session Branching (Turn Actions)
     * ======================================================================== */
    let activeInlineEditor = null;
    let forkInFlight = false;

    function closeActiveInlineEditor(restoreFocusEl = null) {
      if (!activeInlineEditor) return;
      const { editorEl, actionsEl } = activeInlineEditor;
      if (editorEl && editorEl.isConnected) editorEl.remove();
      if (actionsEl && actionsEl.isConnected) actionsEl.removeAttribute('data-pinned');
      activeInlineEditor = null;
      if (restoreFocusEl && restoreFocusEl.isConnected) {
        try { restoreFocusEl.focus(); } catch {}
      }
    }

    function closeInlineEditorOverlay(restoreFocus = true) {
      if (!activeInlineEditor) return false;
      const focusTarget = restoreFocus ? activeInlineEditor.triggerBtn : null;
      closeActiveInlineEditor(focusTarget);
      return true;
    }

    window.__agPrismCloseInlineEditor = closeInlineEditorOverlay;
    addCleanup(() => {
      if (window.__agPrismCloseInlineEditor === closeInlineEditorOverlay) {
        try { delete window.__agPrismCloseInlineEditor; } catch { window.__agPrismCloseInlineEditor = undefined; }
      }
    });

    function findTurnBubble(contentEl) {
      return (
        contentEl.closest('[data-testid="user-message-bubble"]') ||
        contentEl.closest('[data-testid="user-message"]') ||
        contentEl.parentElement ||
        contentEl
      );
    }

    const NATIVE_EDIT_EXCLUDE_ANCESTORS = [
      '.ag-ps-turn-actions',
      '.ag-ps-inline-editor',
      '[role="toolbar"]',
      '[data-testid*="toolbar"]',
      '[data-testid*="titlebar"]',
      '[data-testid*="diff"]',
      '[class*="diff"]',
      '[data-testid*="file-change"]',
      '[data-testid*="checkpoint"]',
      '[data-testid*="workspace"]'
    ].join(', ');

    function findNativeEditOrUndoButton(turnBubble) {
      if (!turnBubble) return null;
      const searchRoots = [turnBubble, turnBubble.parentElement].filter(Boolean);
      const nativeSel = [
        'button[data-testid*="edit-message"]',
        'button[data-testid*="inline-edit"]',
        'button[aria-label]',
        'button[title]'
      ].join(', ');
      const exactEditLabelRe = /^(edit(\s+message)?|编辑消息|原位编辑)$/i;
      const forbiddenUndoRe = /\b(undo|revert|rollback|restore|checkpoint|discard)\b|撤销|撤回|回滚|还原/i;

      for (const root of searchRoots) {
        // Never cross up into multi-turn containers, global toolbars, or diff panels
        if (root.matches(NATIVE_EDIT_EXCLUDE_ANCESTORS) || root.closest(NATIVE_EDIT_EXCLUDE_ANCESTORS)) {
          continue;
        }
        if (root.querySelectorAll('[data-testid="user-message-content"]').length > 1) continue;
        const buttons = Array.from(root.querySelectorAll(nativeSel));
        for (const btn of buttons) {
          if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
          if (btn.closest(NATIVE_EDIT_EXCLUDE_ANCESTORS)) continue;

          const tid = (btn.getAttribute('data-testid') || '').toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
          const title = (btn.getAttribute('title') || '').trim();
          const text = (btn.textContent || '').trim();

          // CRITICAL SAFETY: never auto-click any generic undo/revert button (could undo workspace file edits)
          if (forbiddenUndoRe.test(`${tid} ${ariaLabel} ${title} ${text}`)) continue;

          if (tid.includes('edit-message') || tid.includes('inline-edit')) {
            return btn;
          }
          if (
            (ariaLabel && exactEditLabelRe.test(ariaLabel)) ||
            (title && exactEditLabelRe.test(title))
          ) {
            return btn;
          }
        }
      }
      return null;
    }

    function findComposerSendButton() {
      const box = (typeof bus.getComposerEl === 'function' && bus.getComposerEl())
        || document.getElementById('antigravity.agentSidePanelInputBox')
        || document;
      const selectors = [
        'button[data-testid*="send"]',
        'button[type="submit"]',
        'button[aria-label*="Send" i]',
        'button[aria-label*="发送"]',
        'button[title*="Send" i]',
        'button[title*="发送"]'
      ];
      for (const sel of selectors) {
        const btn = box.querySelector(sel);
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          return btn;
        }
      }
      return null;
    }

    function openInlineEditForTurn(contentEl, turnBubble, actionsEl, triggerBtn) {
      if (!contentEl || !contentEl.isConnected) return;

      // Priority 1: trigger explicitly proven native edit-message button only (never generic undo/revert)
      const nativeBtn = findNativeEditOrUndoButton(turnBubble);
      if (nativeBtn) {
        nativeBtn.click();
        bus.showToast('已触发原生消息编辑');
        return;
      }

      // If already open on this bubble, focus textarea
      if (activeInlineEditor && activeInlineEditor.contentEl === contentEl) {
        activeInlineEditor.textarea.focus();
        return;
      }
      closeActiveInlineEditor();

      const turns = getUserTurnElements();
      const turnIndex = turns.indexOf(contentEl);
      const originalText = (contentEl.innerText || contentEl.textContent || '').trim();
      const lock = {
        conversationId: getCurrentConversationId(),
        turnIndex,
        originalHash: hashText(originalText)
      };

      const editorEl = document.createElement('div');
      editorEl.className = 'ag-ps-inline-editor';
      editorEl.setAttribute('data-ag-i18n-ignore', '1');
      editorEl.setAttribute('data-ag-ps-overlay', 'inline-editor');
      editorEl.setAttribute('role', 'region');
      editorEl.setAttribute('aria-label', '原位消息编辑器');

      const textarea = document.createElement('textarea');
      textarea.className = 'ag-ps-inline-textarea';
      textarea.value = originalText;
      textarea.setAttribute('aria-label', '编辑消息内容');
      editorEl.appendChild(textarea);

      const warnEl = document.createElement('div');
      warnEl.className = 'ag-ps-inline-warn';
      warnEl.hidden = true;
      editorEl.appendChild(warnEl);

      const footer = document.createElement('div');
      footer.className = 'ag-ps-inline-footer';

      const hint = document.createElement('span');
      hint.className = 'ag-ps-inline-hint';
      hint.textContent = 'Esc 取消 · Ctrl+Enter 填入输入框';
      footer.appendChild(hint);

      const btns = document.createElement('div');
      btns.className = 'ag-ps-inline-btns';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ag-ps-inline-btn';
      cancelBtn.textContent = '取消';

      const fillBtn = document.createElement('button');
      fillBtn.type = 'button';
      fillBtn.className = 'ag-ps-inline-btn';
      fillBtn.textContent = '填入输入框';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = 'ag-ps-inline-btn';
      sendBtn.setAttribute('data-primary', '1');
      sendBtn.textContent = '填入并发送';

      btns.appendChild(cancelBtn);
      btns.appendChild(fillBtn);
      btns.appendChild(sendBtn);
      footer.appendChild(btns);
      editorEl.appendChild(footer);

      let overwriteConfirmedMode = '';

      function verifyOptimisticLock() {
        if (!contentEl.isConnected) return false;
        if (getCurrentConversationId() !== lock.conversationId) return false;
        const curTurns = getUserTurnElements();
        const curIdx = curTurns.indexOf(contentEl);
        if (curIdx !== lock.turnIndex) return false;
        const curText = (contentEl.innerText || contentEl.textContent || '').trim();
        return hashText(curText) === lock.originalHash;
      }

      function applyEdit(andSend) {
        if (!verifyOptimisticLock()) {
          bus.showToast('会话或该条消息已发生变化，原位编辑锁已失效，请重新打开');
          closeActiveInlineEditor(triggerBtn);
          return;
        }
        const edited = textarea.value.trim();
        if (!edited) {
          bus.showToast('消息内容为空，未执行填入');
          return;
        }

        const modeKey = andSend ? 'send' : 'fill';
        const existingDraft = getComposerText();
        if (existingDraft && existingDraft !== edited && overwriteConfirmedMode !== modeKey) {
          overwriteConfirmedMode = modeKey;
          warnEl.textContent = '输入框当前已有未发送草稿，为防误覆盖请再次点击按钮确认替换。';
          warnEl.hidden = false;
          if (andSend) {
            sendBtn.textContent = '确认替换并发送';
            fillBtn.textContent = '填入输入框';
          } else {
            fillBtn.textContent = '确认替换草稿';
            sendBtn.textContent = '填入并发送';
          }
          return;
        }

        const inserted = insertTextIntoComposer(edited, true);
        if (!inserted) {
          void writeClipboardText(edited).then((ok) => {
            bus.showToast(ok ? '未找到输入框，已复制编辑后内容到剪贴板' : '未能写入输入框');
          });
          closeActiveInlineEditor(triggerBtn);
          return;
        }

        closeActiveInlineEditor();
        if (andSend) {
          if (typeof bus.isBusy === 'function' && bus.isBusy()) {
            bus.showToast('当前正在生成，已将修改内容填入输入框');
            return;
          }
          const hostSend = findComposerSendButton();
          if (hostSend) {
            hostSend.click();
            bus.showToast('已填入并发送修改后的消息');
          } else {
            bus.showToast('已填入输入框（请按 Enter 发送）');
          }
        } else {
          bus.showToast('已将修改后的消息填入输入框');
        }
      }

      cancelBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeActiveInlineEditor(triggerBtn);
      });
      fillBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyEdit(false);
      });
      sendBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        applyEdit(true);
      });
      textarea.addEventListener('input', () => {
        overwriteConfirmedMode = '';
        warnEl.hidden = true;
        fillBtn.textContent = '填入输入框';
        sendBtn.textContent = '填入并发送';
      });
      editorEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          closeActiveInlineEditor(triggerBtn);
        }
      });
      textarea.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          applyEdit(Boolean(ev.shiftKey));
        }
      });

      if (actionsEl) actionsEl.setAttribute('data-pinned', '1');
      const hostCs = window.getComputedStyle(turnBubble);
      const isRowFlex = hostCs.display === 'flex' && hostCs.flexDirection !== 'column' && hostCs.flexDirection !== 'column-reverse';
      if (isRowFlex) {
        editorEl.classList.add('ag-ps-inline-editor-float');
      }
      turnBubble.appendChild(editorEl);
      activeInlineEditor = { editorEl, textarea, contentEl, actionsEl, triggerBtn };
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }

    async function invokeNativeForkHook(payload) {
      const hook = (
        (typeof window.__agPrismForkConversation === 'function' && window.__agPrismForkConversation) ||
        (typeof window.__agForkConversation === 'function' && window.__agForkConversation) ||
        (window.antigravity && typeof window.antigravity.forkConversation === 'function'
          && ((arg) => window.antigravity.forkConversation(arg))) ||
        (window.__antigravity && typeof window.__antigravity.forkConversation === 'function'
          && ((arg) => window.__antigravity.forkConversation(arg)))
      );
      if (!hook) return { available: false };

      let timerId = 0;
      try {
        const res = await Promise.race([
          Promise.resolve(hook(payload)),
          new Promise((_, reject) => {
            timerId = setTimeout(() => reject(new Error('FORK_TIMEOUT')), 15000);
          })
        ]);
        return { available: true, ok: true, result: res };
      } catch (err) {
        return { available: true, ok: false, error: err };
      } finally {
        clearTimeout(timerId);
      }
    }

    async function triggerSessionFork(turnIndex, turnEl, triggerBtn = null) {
      if (disposed) return;
      if (!getPrefs().sessionFork) {
        bus.showToast('会话分支功能已在棱镜面板中关闭');
        return;
      }
      if (forkInFlight) {
        bus.showToast('正在执行分支操作，请稍候…');
        return;
      }

      const turns = getUserTurnElements();
      let resolvedIdx = Number.isInteger(turnIndex) && turnIndex >= 0 ? turnIndex : -1;
      if (resolvedIdx < 0 && turnEl) {
        resolvedIdx = turns.indexOf(turnEl);
      }
      if (resolvedIdx < 0) resolvedIdx = 0;
      const turnNumber = resolvedIdx + 1;

      const rawConvId = getCurrentConversationId();
      const safeConvId = /^[A-Za-z0-9._:-]{4,128}$/.test(rawConvId) ? rawConvId : '';

      forkInFlight = true;
      if (triggerBtn) triggerBtn.setAttribute('data-busy', '1');

      try {
        const nativeRes = await invokeNativeForkHook({
          conversationId: safeConvId,
          turnNumber,
          turnIndex: resolvedIdx
        });

        if (nativeRes.available) {
          if (nativeRes.ok) {
            const newId = nativeRes.result && (nativeRes.result.conversationId || nativeRes.result.id);
            bus.showToast(newId ? `已从第 ${turnNumber} 轮分支新会话（${String(newId).slice(0, 12)}…）` : `已从第 ${turnNumber} 轮分支出新会话`);
          } else {
            const reason = nativeRes.error && nativeRes.error.message ? nativeRes.error.message : '调用失败';
            bus.showToast(`分支会话失败：${reason}`);
          }
          return;
        }

        // CLI Fallback: copy exact one-line command + show clear guidance
        const argConv = safeConvId || '<conversationId>';
        const cmd = `node scripts/fork-session.mjs ${argConv} ${turnNumber}`;
        const copied = await writeClipboardText(cmd);
        if (!safeConvId) {
          bus.showToast(
            copied
              ? `未检测到会话 ID，已复制模板命令（请替换 conversationId）：${cmd}`
              : `未检测到会话 ID，请在终端运行：${cmd}`
          );
        } else {
          bus.showToast(
            copied
              ? `已复制第 ${turnNumber} 轮分支命令：${cmd}（在终端运行即可创建分支）`
              : `请在终端运行：${cmd}`
          );
        }
      } finally {
        forkInFlight = false;
        if (triggerBtn && triggerBtn.isConnected) triggerBtn.removeAttribute('data-busy');
      }
    }

    // Register Outline Action for Session Branching
    if (typeof bus.registerOutlineAction === 'function') {
      bus.registerOutlineAction({
        id: 'fork',
        label: '分支',
        title: '从此轮次分支出新会话',
        onClick(turnIndex, turnEl) {
          void triggerSessionFork(turnIndex, turnEl, null);
        }
      });
    }

    let turnActionsAc = new AbortController();
    let boundTurnHosts = new WeakSet();

    function cleanupAllTurnActions() {
      closeActiveInlineEditor();
      try { turnActionsAc.abort(); } catch {}
      turnActionsAc = new AbortController();
      boundTurnHosts = new WeakSet();
      document.querySelectorAll('.ag-ps-turn-actions').forEach((el) => el.remove());
      document.querySelectorAll('[data-ag-ps-edit-bound]').forEach((el) => {
        el.removeAttribute('data-ag-ps-edit-bound');
        el.classList.remove('ag-ps-turn-host');
      });
    }

    addCleanup(cleanupAllTurnActions);

    function resolveTurnActionHost(bubble, contentEl) {
      if (!bubble) return null;
      const p = bubble.parentElement;
      if (
        bubble !== contentEl &&
        p &&
        p.isConnected &&
        !p.matches('[data-testid="autoscroll-viewport"], main, body') &&
        p.querySelectorAll('[data-testid="user-message-content"]').length === 1
      ) {
        const bs = window.getComputedStyle(p);
        const br = bubble.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        const isHorizontalFlex = bs.display === 'flex' && bs.flexDirection !== 'column' && bs.flexDirection !== 'column-reverse';
        const isBroadRow = pr.width > br.width + 48 || pr.left < br.left - 24 || pr.right > br.right + 24;
        if (!isHorizontalFlex && !isBroadRow) return p;
      }
      return bubble;
    }

    function syncTurnActionEdgeFlip(bar, host) {
      if (!bar || !host) return;
      const vp = host.closest('[data-testid="autoscroll-viewport"]');
      if (!vp) return;
      const vr = vp.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      if (hr.top - vr.top < 14) {
        bar.setAttribute('data-below', '1');
      } else {
        bar.removeAttribute('data-below');
      }
    }

    function syncTurnActionBars() {
      if (disposed || document.hidden) return;
      const p = getPrefs();
      const showEdit = p.inlineEditHelper;
      const showFork = p.sessionFork;

      if (!showEdit && !showFork) {
        if (document.querySelector('.ag-ps-turn-actions')) cleanupAllTurnActions();
        return;
      }

      // Pass 1: Pure DOM geometry & computed-style reads (zero DOM mutations -> zero layout thrashing)
      const turns = getUserTurnElements();
      const busy = typeof bus.isBusy === 'function' && bus.isBusy();
      const vpRectCache = new WeakMap();
      const measuredTurns = [];

      for (let i = 0; i < turns.length; i++) {
        const contentEl = turns[i];
        const bubble = findTurnBubble(contentEl);
        if (!bubble || !bubble.isConnected) continue;
        const host = resolveTurnActionHost(bubble, contentEl) || bubble;
        const vp = host.closest('[data-testid="autoscroll-viewport"]');
        let flipBelow = null;
        if (vp) {
          let vr = vpRectCache.get(vp);
          if (!vr) {
            vr = vp.getBoundingClientRect();
            vpRectCache.set(vp, vr);
          }
          const hr = host.getBoundingClientRect();
          flipBelow = hr.top - vr.top < 14;
        }
        measuredTurns.push({
          bubble,
          host,
          isStreamingTurn: Boolean(busy && i === turns.length - 1),
          flipBelow
        });
      }

      // Pass 2: Pure DOM writes & single-instance listener binding per host
      for (let i = 0; i < measuredTurns.length; i++) {
        const { bubble, host, isStreamingTurn, flipBelow } = measuredTurns[i];

        // Ensure no legacy in-flow action bar stays inside the colored bubble itself
        if (host !== bubble) {
          bubble.querySelectorAll(':scope > .ag-ps-turn-actions').forEach((n) => n.remove());
          bubble.removeAttribute('data-ag-ps-edit-bound');
          bubble.classList.remove('ag-ps-turn-host');
        }

        let bar = host.querySelector(':scope > .ag-ps-turn-actions');
        if (!bar) {
          host.setAttribute('data-ag-ps-edit-bound', '1');
          host.classList.add('ag-ps-turn-host');

          bar = document.createElement('div');
          bar.className = 'ag-ps-turn-actions';
          bar.setAttribute('data-ag-i18n-ignore', '1');
          host.appendChild(bar);
        }

        if (!boundTurnHosts.has(host)) {
          boundTurnHosts.add(host);
          const onHostEnterOrFocus = () => {
            const liveBar = host.querySelector(':scope > .ag-ps-turn-actions');
            if (liveBar) syncTurnActionEdgeFlip(liveBar, host);
          };
          host.addEventListener('pointerenter', onHostEnterOrFocus, { passive: true, signal: turnActionsAc.signal });
          host.addEventListener('focusin', onHostEnterOrFocus, { passive: true, signal: turnActionsAc.signal });
        }

        if (flipBelow === true) {
          if (bar.getAttribute('data-below') !== '1') bar.setAttribute('data-below', '1');
        } else if (flipBelow === false) {
          if (bar.hasAttribute('data-below')) bar.removeAttribute('data-below');
        }

        // Sync Edit button idempotently
        let editBtn = bar.querySelector('[data-ps-act="edit"]');
        if (showEdit) {
          if (!editBtn) {
            editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'ag-ps-turn-act-btn';
            editBtn.setAttribute('data-ps-act', 'edit');
            editBtn.setAttribute('data-ag-ps-tip', '原位编辑（优先原生消息编辑，否则打开安全原位编辑器）');
            editBtn.textContent = '编辑';
            editBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const liveContentEl = host.matches('[data-testid="user-message-content"]')
                ? host
                : host.querySelector('[data-testid="user-message-content"]');
              if (!liveContentEl || !liveContentEl.isConnected) return;
              openInlineEditForTurn(liveContentEl, host, bar, editBtn);
            });
            bar.insertBefore(editBtn, bar.firstChild);
          }
        } else if (editBtn) {
          editBtn.remove();
        }

        // Sync Fork button idempotently (completed turns only)
        let forkBtn = bar.querySelector('[data-ps-act="fork"]');
        if (showFork && !isStreamingTurn) {
          if (!forkBtn) {
            forkBtn = document.createElement('button');
            forkBtn.type = 'button';
            forkBtn.className = 'ag-ps-turn-act-btn';
            forkBtn.setAttribute('data-ps-act', 'fork');
            forkBtn.setAttribute('data-ag-ps-tip', '从此轮次分支出新会话');
            forkBtn.textContent = '分支';
            forkBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const liveContentEl = host.matches('[data-testid="user-message-content"]')
                ? host
                : host.querySelector('[data-testid="user-message-content"]');
              if (!liveContentEl || !liveContentEl.isConnected) return;
              const curIdx = getUserTurnElements().indexOf(liveContentEl);
              void triggerSessionFork(curIdx, liveContentEl, forkBtn);
            });
            bar.appendChild(forkBtn);
          }
        } else if (forkBtn) {
          forkBtn.remove();
        }
      }
    }

    /* ========================================================================
     * 6B. WSL Native "Show in File Explorer" Menu Fix (Zero-Observer Capture)
     *     Fixes Antigravity v2.35.x bug where `distroToWindowsPath` turns
     *     `/mnt/e/...` into non-existent `\\wsl.localhost\Ubuntu\mnt\e\...`.
     * ======================================================================== */
    const REVEAL_MENU_LABELS = new Set([
      'Show in File Explorer',
      'Reveal in File Explorer',
      'Reveal in Explorer',
      'Show in Explorer',
      'Reveal in Finder',
      'Show in Finder',
      'Open Containing Folder',
      '在文件资源管理器中显示',
      '在资源管理器中显示',
      '在访达中显示',
      '在 Finder 中显示',
      '打开所在文件夹'
    ]);

    let cachedWslDistro = '';
    function refreshWslDistroState() {
      try {
        if (window.wsl && typeof window.wsl.getState === 'function') {
          Promise.resolve(window.wsl.getState())
            .then((st) => {
              const d = String((st && (st.distro || st.activeDistro || st.name)) || '').trim();
              if (d && /^[A-Za-z0-9._-]+$/.test(d)) cachedWslDistro = d;
            })
            .catch(() => {});
        }
      } catch {}
    }
    refreshWslDistroState();

    function detectActiveWslDistro() {
      if (cachedWslDistro) return cachedWslDistro;
      try {
        const m = String(document.title || '').match(/\(WSL:\s*([A-Za-z0-9._-]+)\)/i);
        if (m && m[1]) return m[1];
      } catch {}
      return '';
    }

    function isNativeRevealMenuItem(itemEl) {
      if (!itemEl || !(itemEl instanceof Element)) return false;
      if (
        itemEl.hasAttribute('data-ag-pm-act') ||
        itemEl.hasAttribute('data-ag-pd-reveal-file') ||
        itemEl.hasAttribute('data-ag-pm-reveal-agents') ||
        itemEl.hasAttribute('data-action') ||
        itemEl.closest('#ag-ps-img-menu, #ag-ps-img-ctx-menu, #ag-ps-popover')
      ) {
        return false;
      }
      const rawText = String(itemEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (REVEAL_MENU_LABELS.has(rawText)) return true;
      const origMap = window.__ag_orig_text_map;
      if (origMap && typeof origMap.get === 'function') {
        try {
          const walker = document.createTreeWalker(itemEl, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const orig = String(origMap.get(walker.currentNode) || '').trim();
            if (orig && REVEAL_MENU_LABELS.has(orig)) return true;
          }
        } catch {}
      }
      return false;
    }

    function scoreRevealPathCandidate(val, hintMeta) {
      if (typeof val !== 'string') return null;
      const s = val.trim();
      if (s.length < 3 || s.length > 3000 || /[\r\n\0"]/.test(s)) return null;
      let score = 0;
      if (/^file:\/\/\/mnt\/[a-zA-Z](?:\/|$)/i.test(s)) {
        score = 120;
      } else if (/^\/mnt\/[a-zA-Z](?:\/|$)/.test(s)) {
        score = 115;
      } else if (/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/][^\\/]+[\\/]mnt[\\/](?:[a-zA-Z])(?:[\\/]|$)/i.test(s)) {
        score = 112;
      } else if (/^file:\/\/\//i.test(s)) {
        score = 100;
      } else if (/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]/i.test(s) || /^[a-zA-Z]:[\\/]/.test(s)) {
        score = 92;
      } else if (/^\/(?:home|root|tmp|opt|var|srv|etc|usr|workspace)(?:\/|$)/.test(s)) {
        score = 84;
      } else {
        return null;
      }
      let decoded = s;
      try { decoded = decodeURIComponent(s); } catch {}
      const baseLower = (decoded.split(/[\\/]/).pop() || '').toLowerCase();
      if (hintMeta && baseLower) {
        if (hintMeta.exact && baseLower === hintMeta.exact) {
          score += 70;
        } else if (
          (hintMeta.prefix && baseLower.startsWith(hintMeta.prefix)) ||
          (hintMeta.suffix && baseLower.endsWith(hintMeta.suffix))
        ) {
          score += 40;
        }
      }
      return { path: s, score };
    }

    function collectViewerFilenameHint() {
      try {
        const tabs = document.querySelectorAll('[role="tab"][aria-selected="true"], [data-state="active"][role="tab"]');
        for (let i = tabs.length - 1; i >= 0; i--) {
          const titleAttr = String(tabs[i].getAttribute('title') || tabs[i].getAttribute('aria-label') || '').trim();
          if (titleAttr && !titleAttr.includes('…') && !titleAttr.includes('...')) {
            const fullBase = (titleAttr.split(/[\\/]/).pop() || '').trim().toLowerCase();
            if (fullBase.length >= 3 && fullBase.includes('.')) {
              return { exact: fullBase, prefix: '', suffix: '' };
            }
          }
          const raw = String(tabs[i].textContent || '').replace(/[×✕⋮]/g, '').trim();
          if (!raw) continue;
          if (raw.includes('…') || raw.includes('...')) {
            const parts = raw.split(/…|\.{3,}/).map((p) => p.trim().toLowerCase());
            const prefix = parts[0] && parts[0].length >= 4 ? parts[0] : '';
            const suffix = parts[parts.length - 1] && parts[parts.length - 1].length >= 4 ? parts[parts.length - 1] : '';
            if (prefix || suffix) return { exact: '', prefix, suffix };
          } else if (raw.startsWith('-') && raw.length >= 5) {
            return { exact: '', prefix: '', suffix: raw.toLowerCase() };
          } else if (raw.length >= 3 && raw.includes('.')) {
            return { exact: raw.toLowerCase(), prefix: '', suffix: '' };
          }
        }
      } catch {}
      return null;
    }

    function extractRevealTargetResult(startEl) {
      if (!startEl || !(startEl instanceof Element)) return { status: 'none', path: '' };
      const hintMeta = collectViewerFilenameHint();

      const walkSingleFiberChain = (domNode) => {
        if (!domNode) return { status: 'none', path: '' };
        let cur = domNode;
        let fiber = null;
        for (let up = 0; up < 6 && cur && !fiber; up++, cur = cur.parentElement) {
          try {
            const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
            if (fk && cur[fk]) fiber = cur[fk];
          } catch {}
        }
        const seenObjs = new WeakSet();
        let visitedCount = 0;
        // Stop at the NEAREST component ancestor that holds document URI(s), preserving ambiguity explicitly
        for (let d = 0; d < 40 && fiber && visitedCount <= 280; d++, fiber = fiber.return) {
          const levelHits = new Map();
          const scanLevelVal = (val, objDepth) => {
            if (val == null || objDepth > 3 || visitedCount > 280) return;
            if (typeof val === 'string') {
              const scored = scoreRevealPathCandidate(val, hintMeta);
              if (scored) {
                const prev = levelHits.get(scored.path);
                if (prev === undefined || scored.score > prev) levelHits.set(scored.path, scored.score);
              }
              return;
            }
            if (typeof val !== 'object') return;
            if (val instanceof Node || val instanceof Window) return;
            if (seenObjs.has(val)) return;
            seenObjs.add(val);
            visitedCount++;
            if (Array.isArray(val)) {
              const len = Math.min(val.length, 16);
              for (let i = 0; i < len; i++) scanLevelVal(val[i], objDepth + 1);
              return;
            }
            let keys;
            try { keys = Object.keys(val); } catch { return; }
            const kLen = Math.min(keys.length, 24);
            for (let i = 0; i < kLen; i++) {
              const k = keys[i];
              if (k === 'children' || k === '_owner' || k === '_store' || k.startsWith('__react')) continue;
              let child;
              try { child = val[k]; } catch { continue; }
              scanLevelVal(child, objDepth + 1);
            }
          };

          if (fiber.memoizedProps) scanLevelVal(fiber.memoizedProps, 0);
          let hook = fiber.memoizedState;
          for (let h = 0; h < 20 && hook && typeof hook === 'object'; h++, hook = hook.next) {
            if ('memoizedState' in hook) scanLevelVal(hook.memoizedState, 0);
          }

          if (levelHits.size === 1) {
            return { status: 'found', path: Array.from(levelHits.keys())[0] };
          }
          if (levelHits.size > 1) {
            const sorted = Array.from(levelHits.entries()).sort((a, b) => b[1] - a[1]);
            if (sorted[0][1] >= sorted[1][1] + 25) {
              return { status: 'found', path: sorted[0][0] };
            }
            return { status: 'ambiguous', path: '' };
          }
        }
        return { status: 'none', path: '' };
      };

      const direct = walkSingleFiberChain(startEl);
      if (direct.status === 'found') return direct;
      // Never fall back to document-wide tabs or cached targets if the menu's own fiber chain is ambiguous
      if (direct.status === 'ambiguous') return direct;

      try {
        const activeTabs = document.querySelectorAll('[role="tab"][aria-selected="true"], [data-state="active"][role="tab"]');
        if (activeTabs.length === 1) {
          const onlyTab = activeTabs[0];
          for (const attr of ['data-filepath', 'data-file-path', 'data-uri', 'title']) {
            const av = onlyTab.getAttribute && onlyTab.getAttribute(attr);
            const sc = av ? scoreRevealPathCandidate(av, hintMeta) : null;
            if (sc) return { status: 'found', path: sc.path };
          }
          const tabHit = walkSingleFiberChain(onlyTab);
          if (tabHit.status === 'found' || tabHit.status === 'ambiguous') return tabHit;
        }
        const mediaEls = document.querySelectorAll('[role="tabpanel"]:not([hidden]) video[src], [role="tabpanel"]:not([hidden]) img[src]');
        if (mediaEls.length === 1) {
          const src = mediaEls[0].getAttribute('src');
          const sc = src ? scoreRevealPathCandidate(src, hintMeta) : null;
          if (sc) return { status: 'found', path: sc.path };
        }
      } catch {}

      return { status: 'none', path: '' };
    }

    function needsWslDaemonReveal(targetPath, wslDistro) {
      if (!targetPath) return false;
      if (/^(?:file:\/\/)?\/mnt\/[a-zA-Z](?:\/|$)/i.test(targetPath)) return true;
      if (/^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/][^\\/]+[\\/]mnt[\\/](?:[a-zA-Z])(?:[\\/]|$)/i.test(targetPath)) {
        return true;
      }
      if (wslDistro && (/^file:\/\/\//i.test(targetPath) || targetPath.startsWith('/'))) {
        return true;
      }
      return false;
    }

    let pendingRevealMenuTarget = { itemEl: null, path: '', ts: 0 };
    let lastRevealCommit = { itemEl: null, path: '', ts: 0 };

    function onRevealMenuPointerDownCapture(e) {
      if (disposed || getPrefs().wslExplorerRevealFix === false) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (typeof window.__agProjectCall !== 'function') return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const itemEl = target.closest('[role="menuitem"], [data-radix-collection-item]');
      if (!itemEl || !isNativeRevealMenuItem(itemEl)) return;
      const res = extractRevealTargetResult(itemEl);
      pendingRevealMenuTarget =
        res.status === 'found' && res.path
          ? { itemEl, path: res.path, ts: Date.now() }
          : { itemEl: null, path: '', ts: 0 };
    }

    function commitWslRevealInterception(e, itemEl) {
      const now = Date.now();
      const fresh = extractRevealTargetResult(itemEl);
      let targetPath = '';
      if (fresh.status === 'found') {
        targetPath = fresh.path;
      } else if (fresh.status === 'none') {
        targetPath =
          pendingRevealMenuTarget.itemEl === itemEl && now - pendingRevealMenuTarget.ts < 2500
            ? pendingRevealMenuTarget.path
            : '';
      }
      pendingRevealMenuTarget = { itemEl: null, path: '', ts: 0 };
      if (fresh.status === 'ambiguous') return;
      const wslDistro = detectActiveWslDistro();

      if (!needsWslDaemonReveal(targetPath, wslDistro)) return;

      // Suppress duplicate Enter/Space keydown -> synthesized click on the exact same menu item + target
      if (
        lastRevealCommit.itemEl === itemEl &&
        lastRevealCommit.path === targetPath &&
        now - lastRevealCommit.ts < 350
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }
      lastRevealCommit = { itemEl, path: targetPath, ts: now };
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

      try {
        itemEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true })
        );
      } catch {}

      window
        .__agProjectCall('revealInOsFileManager', { targetPath, wslDistro }, 6000)
        .then((res) => {
          if (res && res.ok) return;
          // Only fall back to native API if an older daemon does not implement revealInOsFileManager;
          // never fall back on policy rejections or RPC timeouts.
          const errCode = String((res && res.error) || '');
          if (
            errCode.startsWith('unknown_action:') &&
            window.electronNative &&
            typeof window.electronNative.revealInFilePicker === 'function'
          ) {
            try { void window.electronNative.revealInFilePicker(targetPath); } catch {}
          }
        })
        .catch(() => {});
    }

    function onRevealMenuClickCapture(e) {
      if (disposed || getPrefs().wslExplorerRevealFix === false) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (typeof window.__agProjectCall !== 'function') return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const itemEl = target.closest('[role="menuitem"], [data-radix-collection-item]');
      if (!itemEl || !isNativeRevealMenuItem(itemEl)) return;
      commitWslRevealInterception(e, itemEl);
    }

    function onRevealMenuKeyDownCapture(e) {
      if (disposed || getPrefs().wslExplorerRevealFix === false) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (typeof window.__agProjectCall !== 'function') return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      const itemEl = target.closest('[role="menuitem"], [data-radix-collection-item]');
      if (!itemEl || !isNativeRevealMenuItem(itemEl)) return;
      commitWslRevealInterception(e, itemEl);
    }

    document.addEventListener('pointerdown', onRevealMenuPointerDownCapture, { capture: true, signal });
    document.addEventListener('click', onRevealMenuClickCapture, { capture: true, signal });
    document.addEventListener('keydown', onRevealMenuKeyDownCapture, { capture: true, signal });

    /* ========================================================================
     * 7. Popover Section Registration (id: 'workflow', order: 20)
     * ======================================================================== */
    if (typeof bus.registerPanelSection === 'function') {
      bus.registerPanelSection({
        id: 'workflow',
        order: 20,
        title: '',
        render(rawPrefs, helpers) {
          const p = Object.assign({}, DEFAULT_PREFS, rawPrefs || {});
          const activeTab = (helpers && helpers.activeTab) || 'all';
          const i18nMode = VALID_I18N_MODES.has(p.i18nExtraMode) ? p.i18nExtraMode : 'off';

          if (activeTab === 'appearance' || activeTab === 'motion') {
            return '';
          }

          if (activeTab === 'nav') {
            return `
              <div class="ag-ps-toggle-list">
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label">
                    <span>从历史某轮开启分支对话</span>
                    <span class="ag-ps-toggle-sub">鼠标移到历史提问显示「分支」按钮</span>
                  </div>
                  <button type="button" class="ag-ps-switch" data-wf-toggle="sessionFork" data-on="${p.sessionFork !== false ? '1' : '0'}" aria-label="从历史某轮开启分支对话"></button>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label">
                    <span>已发消息快速修改重发</span>
                    <span class="ag-ps-toggle-sub">鼠标移到历史提问可直接编辑重发</span>
                  </div>
                  <button type="button" class="ag-ps-switch" data-wf-toggle="inlineEditHelper" data-on="${p.inlineEditHelper !== false ? '1' : '0'}" aria-label="已发消息快速修改重发"></button>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label">
                    <span>界面英文词条中文化</span>
                    <span class="ag-ps-toggle-sub">补全未翻译菜单与按钮 · 可随时还原</span>
                  </div>
                  <div class="ag-ps-seg-group">
                    <button type="button" class="ag-ps-seg-btn" data-wf-i18n="off" data-selected="${i18nMode === 'off' ? '1' : '0'}">关</button>
                    <button type="button" class="ag-ps-seg-btn" data-wf-i18n="zh-CN" data-selected="${i18nMode === 'zh-CN' ? '1' : '0'}">简中</button>
                    <button type="button" class="ag-ps-seg-btn" data-wf-i18n="zh-TW" data-selected="${i18nMode === 'zh-TW' ? '1' : '0'}">繁中</button>
                    <button type="button" class="ag-ps-seg-btn" data-wf-i18n="en" data-selected="${i18nMode === 'en' ? '1' : '0'}">EN</button>
                  </div>
                </div>
              </div>
            `;
          }

          return `
            <div class="ag-ps-toggle-list">
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label">
                  <span>输入框拖入或粘贴文件</span>
                  <span class="ag-ps-toggle-sub">拖入本地文件自动变成 @文件引用</span>
                </div>
                <button type="button" class="ag-ps-switch" data-wf-toggle="composerFileDrop" data-on="${p.composerFileDrop !== false ? '1' : '0'}" aria-label="输入框拖入或粘贴文件"></button>
              </div>
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label">
                  <span>对话图片右键菜单</span>
                  <span class="ag-ps-toggle-sub">右键图片一键引用到提问、复制或保存</span>
                </div>
                <button type="button" class="ag-ps-switch" data-wf-toggle="imageContextMenu" data-on="${p.imageContextMenu !== false ? '1' : '0'}" aria-label="对话图片右键菜单"></button>
              </div>
              <div class="ag-ps-toggle-row">
                <div class="ag-ps-toggle-label">
                  <span>纯净复制 AI 最终回答</span>
                  <span class="ag-ps-toggle-sub">复制时自动去掉思考过程与工具日志</span>
                </div>
                <button type="button" class="ag-ps-switch" data-wf-toggle="cleanCopy" data-on="${p.cleanCopy !== false ? '1' : '0'}" aria-label="纯净复制 AI 最终回答"></button>
              </div>
            </div>
            <details class="ag-ps-adv-fold">
              <summary>高级与环境兼容选项</summary>
              <div class="ag-ps-toggle-list">
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label" data-ag-ps-tip="优化桌面快捷方式启动参数，防止最小化到后台久置后切回短暂白屏（下次重启客户端生效，关闭即恢复原状）">
                    <span>最小化后秒速恢复画面</span>
                    <span class="ag-ps-toggle-sub">防止后台久置切回短暂白屏 · 重启生效</span>
                  </div>
                  <button type="button" class="ag-ps-switch" data-wf-toggle="fastWindowRestore" data-on="${p.fastWindowRestore === true ? '1' : '0'}" aria-label="最小化后秒速恢复画面"></button>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label">
                    <span>WSL 打开本地文件夹修复</span>
                    <span class="ag-ps-toggle-sub">修复 WSL 环境下点击打开文件夹无反应</span>
                  </div>
                  <button type="button" class="ag-ps-switch" data-wf-toggle="wslExplorerRevealFix" data-on="${p.wslExplorerRevealFix !== false ? '1' : '0'}" aria-label="WSL 打开本地文件夹修复"></button>
                </div>
                <div class="ag-ps-toggle-row">
                  <div class="ag-ps-toggle-label">
                    <span>粘贴远程连接命令自动整理</span>
                    <span class="ag-ps-toggle-sub">粘贴 SSH 命令时自动提取地址并过滤密码</span>
                  </div>
                  <button type="button" class="ag-ps-switch" data-wf-toggle="sshPaste" data-on="${p.sshPaste !== false ? '1' : '0'}" aria-label="粘贴远程连接命令自动整理"></button>
                </div>
              </div>
            </details>
          `;
        },
        onClick(e) {
          if (disposed) return false;
          const target = e.target instanceof Element ? e.target : null;
          if (!target) return false;

          const toggleBtn = target.closest('[data-wf-toggle]');
          if (toggleBtn) {
            const key = toggleBtn.getAttribute('data-wf-toggle');
            if (key && Object.prototype.hasOwnProperty.call(DEFAULT_PREFS, key)) {
              const cur = getPrefs()[key];
              const nextVal = !cur;
              bus.setPref(key, nextVal);
              if (key === 'fastWindowRestore' && typeof window.__agProjectCall === 'function') {
                window.__agProjectCall('setFastWindowRestoreShortcut', { enabled: nextVal }, 8000).catch(() => {});
              }
              if (key === 'imageContextMenu' && cur) closeImageMenu();
              if (key === 'inlineEditHelper' || key === 'sessionFork') {
                if (key === 'inlineEditHelper' && cur) closeActiveInlineEditor();
                syncTurnActionBars();
              }
              return true;
            }
            return false;
          }

          const i18nBtn = target.closest('[data-wf-i18n]');
          if (i18nBtn) {
            const mode = i18nBtn.getAttribute('data-wf-i18n');
            if (VALID_I18N_MODES.has(mode)) {
              bus.setPref('i18nExtraMode', mode);
              if (mode === 'off' || mode === 'en') {
                restoreAllI18nNodes();
              } else {
                runI18nPass();
              }
              return true;
            }
            return false;
          }

          return false;
        }
      });
    }

    /* ========================================================================
     * 8. Bus Subscriptions & Zero-Leak Lifecycle Disposal
     * ======================================================================== */
    const unsubscribe = typeof bus.subscribe === 'function'
      ? bus.subscribe((evt) => {
          if (disposed) return;
          const type = typeof evt === 'string' ? evt : (evt && evt.type);
          if (type === 'route') {
            closeImageMenu();
            closeActiveInlineEditor();
            syncTurnActionBars();
            runI18nPass();
          } else if (type === 'prefs') {
            if (!getPrefs().imageContextMenu) closeImageMenu();
            if (!getPrefs().inlineEditHelper) closeActiveInlineEditor();
            syncTurnActionBars();
            runI18nPass();
          } else if (type === 'visibility') {
            if (document.hidden) {
              closeImageMenu();
            } else {
              syncTurnActionBars();
              runI18nPass();
            }
          } else if (type === 'tick') {
            if (document.hidden) return;
            if (typeof bus.isTyping === 'function' && bus.isTyping()) return;
            syncTurnActionBars();
            runI18nPass();
          }
        })
      : null;

    if (typeof unsubscribe === 'function') {
      addCleanup(unsubscribe);
    }

    // Initial lightweight sync
    syncTurnActionBars();
    runI18nPass();

    function dispose() {
      if (disposed) return;
      disposed = true;
      try { ac.abort(); } catch {}
      try { bus.unregisterPanelSection?.('workflow'); } catch {}
      try { bus.unregisterOutlineAction?.('fork'); } catch {}
      while (moduleCleanups.length) {
        const fn = moduleCleanups.pop();
        try { fn(); } catch {}
      }
      if (window.__agPrismWorkflowDispose === dispose) {
        delete window.__agPrismWorkflowDispose;
      }
    }

    window.__agPrismWorkflowDispose = dispose;
    if (typeof bus.onCleanup === 'function') {
      bus.onCleanup(dispose);
    }
  }

  registerPrismModule('workflow', initWorkflowModule);
})();
