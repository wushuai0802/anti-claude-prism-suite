'use strict';

(() => {
  const stateCard = document.getElementById('state-card');
  const nmBadge = document.getElementById('nm-badge');
  const armBadge = document.getElementById('arm-badge');
  const originBox = document.getElementById('origin-box');
  const blockNotice = document.getElementById('block-notice');
  const btnToggleArm = document.getElementById('btn-toggle-arm');
  const btnDisarmAll = document.getElementById('btn-disarm-all');

  function sendBgMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: '未收到扩展后台响应' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  function renderState(st) {
    if (!st || !st.ok) {
      nmBadge.className = 'status-badge is-warn';
      nmBadge.innerHTML = '<span class="dot"></span><span>后台未就绪</span>';
      originBox.textContent = st?.error || '无法读取当前标签页状态';
      btnToggleArm.disabled = true;
      btnDisarmAll.disabled = true;
      return;
    }

    const nh = st.nativeHost || {};
    if (nh.hostRegistered) {
      nmBadge.className = 'status-badge is-ok';
      nmBadge.innerHTML = '<span class="dot"></span><span>已连接 Antigravity</span>';
    } else {
      nmBadge.className = 'status-badge is-warn';
      nmBadge.innerHTML = '<span class="dot"></span><span>待首次启用</span>';
      nmBadge.title = nh.error || '请在 Prism 工作台「电脑操控」页完成第 1 步连接配对';
    }

    const tab = st.activeTab;
    const armedCount = Number(st.armedCount) || 0;
    const isArmed = Boolean(tab?.isArmed);

    stateCard.classList.toggle('is-armed', isArmed);
    if (isArmed) {
      armBadge.className = 'status-badge is-ok';
      armBadge.textContent = `已允许 AI 协助（共 ${armedCount} 页）`;
    } else {
      armBadge.className = 'status-badge is-muted';
      armBadge.textContent = armedCount > 0 ? `本页未开启（其他 ${armedCount} 页协助中）` : '未允许 AI 操作';
    }

    if (!tab) {
      originBox.textContent = '未检测到当前网页';
      blockNotice.hidden = true;
      btnToggleArm.disabled = true;
    } else if (tab.blockReason && !isArmed) {
      originBox.textContent = tab.url ? tab.url.slice(0, 96) : '浏览器系统页面';
      blockNotice.textContent = tab.blockReason;
      blockNotice.hidden = false;
      btnToggleArm.disabled = true;
      btnToggleArm.classList.remove('is-disarm');
      btnToggleArm.textContent = '允许 AI 协助此网页';
    } else {
      originBox.textContent = `当前网站：${tab.origin || tab.armedOrigin || '-'}`;
      if (!nh.hostRegistered) {
        blockNotice.textContent = '首次使用请先在 Antigravity 打开「工作台 → 电脑操控」，点击第 1 步「一键连接浏览器助手」。';
        blockNotice.hidden = false;
      } else {
        blockNotice.hidden = true;
      }
      btnToggleArm.disabled = false;
      if (isArmed) {
        btnToggleArm.classList.add('is-disarm');
        btnToggleArm.textContent = '停止协助此网页';
      } else {
        btnToggleArm.classList.remove('is-disarm');
        btnToggleArm.textContent = '允许 AI 协助此网页';
      }
    }

    btnDisarmAll.disabled = armedCount <= 0;
    btnDisarmAll.textContent = armedCount > 0
      ? `停止全部网页协助 (${armedCount})`
      : '停止全部网页协助';
  }

  async function refresh() {
    const st = await sendBgMessage({ type: 'popup_get_state' });
    renderState(st);
  }

  btnToggleArm.addEventListener('click', async () => {
    btnToggleArm.disabled = true;
    const res = await sendBgMessage({ type: 'popup_toggle_arm' });
    if (!res?.ok && res?.error) {
      blockNotice.textContent = res.error;
      blockNotice.hidden = false;
    }
    await refresh();
  });

  btnDisarmAll.addEventListener('click', async () => {
    btnDisarmAll.disabled = true;
    await sendBgMessage({ type: 'popup_disarm_all' });
    await refresh();
  });

  refresh();
})();
