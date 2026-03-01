(() => {
  'use strict';

  // ============================================
  // QCore Tool: Facebook Messages Scraper (MINIMAL)
  // ============================================
  // Keeps:
  //   - Modal
  //   - Buttons (Start / Pause / Reset / Export / Close)
  //   - Logs in modal
  //
  // Does ONLY:
  //   1) Scroll up every 200ms using EXACT snippet
  //   2) Scrape every 200ms using YOUR exact selector loop
  //   3) Merge into state.facebook.records (no dupes)
  //
  // Adds:
  //   ✅ QCore Tools button registration (like Google Flights)
  //   ✅ Total record count at top of modal (live)
  //   ✅ Auto "click Export" every 30s while running (downloads JSON)
  // ============================================

  const SCROLL_MS = 200;
  const AUTO_EXPORT_MS = 30 * 1000;

  // NOTE: keep EXACT selector you provided
  const NODES_SELECTOR =
    'div[aria-label="Messages in conversation titled CC"] > div > div > div > div [data-virtualized="false"]';

  let loopId = null;
  let autoExportId = null;

  // Track the latest modal so background timers always log/update the right one.
  let __activeModal = null;

  function getState() {
    try {
      return window?.QCoreContent?.getState?.() || {};
    } catch {
      return {};
    }
  }

  function setState(s) {
    try {
      window?.QCoreContent?.setState?.(s);
    } catch {}
  }

  function ensureState() {
    const state = getState();
    state.facebook = state.facebook || {};
    state.facebook.records = Array.isArray(state.facebook.records)
      ? state.facebook.records
      : [];
    state.facebook.__keys =
      state.facebook.__keys && typeof state.facebook.__keys === 'object'
        ? state.facebook.__keys
        : {};
    setState(state);
    return state;
  }

  function setActiveModal(modal) {
    try {
      __activeModal = modal || null;
    } catch {
      __activeModal = null;
    }
  }

  function getActiveModal() {
    try {
      const ctl = window.__qcoreFacebookMessagesCtl;
      const m = ctl?.modal || __activeModal;
      if (m && m.el && document.body.contains(m.el)) return m;
      return __activeModal;
    } catch {
      return __activeModal;
    }
  }

  function log(modal, msg) {
    try {
      const m = modal || getActiveModal();
      const ts = new Date().toLocaleTimeString();
      m?.addLog?.(`${ts}  ${msg}`);
      console.log(msg);
    } catch {}
  }

  function updateCount(modal) {
    try {
      const st = ensureState();
      const n = Array.isArray(st.facebook.records) ? st.facebook.records.length : 0;
      const m = modal || getActiveModal();
      m?.setCount?.(n);
    } catch {}
  }

  // IMPORTANT: keep EXACT scroll snippet you provided
  function scrollUpExact() {
    try {
      document
        .querySelectorAll(
          'div[aria-label="Messages in conversation titled CC"] > div > div'
        )[0].scrollTop = 0;
    } catch {}
  }

  function scrapeAndMerge(modal) {
    const state = ensureState();
    const fb = state.facebook;

    const nodes = document.querySelectorAll(NODES_SELECTOR);
    const arr = [];

    // IMPORTANT: keep EXACT loop you provided
    for (let i = 0; i < nodes.length; i++) {
      const text = nodes[i].textContent?.trim();
      if (text) arr.push(text);
    }

    console.log(`[${arr.join(',')}]`);

    let added = 0;

    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (!fb.__keys[t]) {
        fb.__keys[t] = 1;
        fb.records.push(t);
        added++;
      }
    }

    setState(state);

    // Update modal count line (requested)
    updateCount(modal);

    log(modal, `MESSAGE SWEEP DONE GOING TO NEXT (nodes=${arr.length}, added=${added})`);
  }

  function exportJson(modal, { reason = 'manual' } = {}) {
    const state = ensureState();
    const records = state.facebook.records || [];

    try {
      const blob = new Blob([JSON.stringify(records, null, 2)], {
        type: 'application/json',
      });

      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `facebook_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      // cleanup URL
      try {
        setTimeout(() => {
          try { URL.revokeObjectURL(url); } catch {}
        }, 2000);
      } catch {}

      log(modal, `Exported JSON (${records.length} records) — ${reason}`);
    } catch (e) {
      log(modal, `Export failed — ${String(e?.message || e)}`);
    }
  }

  function startAutoExport(modal) {
    try {
      const m = modal || getActiveModal();
      if (m) setActiveModal(m);

      if (autoExportId) return;

      autoExportId = setInterval(() => {
        try {
          // Only auto-export while the scraper loop is running
          if (!loopId) return;
          exportJson(getActiveModal(), { reason: 'auto_30s' });
        } catch {}
      }, AUTO_EXPORT_MS);

      log(modal, `Auto-export armed (every ${Math.round(AUTO_EXPORT_MS / 1000)}s)`);
    } catch {}
  }

  function stopAutoExport(modal) {
    try {
      if (!autoExportId) return;
      clearInterval(autoExportId);
      autoExportId = null;
      log(modal, 'Auto-export stopped');
    } catch {}
  }

  function startLoop(modal) {
    try {
      if (modal) setActiveModal(modal);
    } catch {}

    if (loopId) {
      // already running — just ensure auto-export is armed
      startAutoExport(modal);
      log(modal, 'Already running');
      return;
    }

    loopId = setInterval(() => {
      const m = getActiveModal();
      scrollUpExact();
      scrapeAndMerge(m);
    }, SCROLL_MS);

    startAutoExport(modal);
    log(modal, 'Started');
  }

  function stopLoop(modal) {
    // stop downloads first
    stopAutoExport(modal);

    if (!loopId) {
      log(modal, 'Already paused');
      return;
    }

    clearInterval(loopId);
    loopId = null;
    log(modal, 'Paused');
  }

  function reset(modal) {
    const state = ensureState();
    state.facebook.records = [];
    state.facebook.__keys = {};
    setState(state);

    updateCount(modal);
    log(modal, 'Reset complete');
  }

  function createModal() {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';

    const card = document.createElement('div');
    card.style.cssText =
      'width:900px;max-height:85vh;background:#0b1117;border-radius:14px;display:flex;flex-direction:column;color:#e5e7eb;font-family:system-ui';

    const head = document.createElement('div');
    head.style.cssText =
      'padding:14px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;align-items:flex-start;gap:12px';

    const headLeft = document.createElement('div');
    headLeft.style.cssText = 'display:flex;flex-direction:column;gap:6px';

    const title = document.createElement('div');
    title.innerHTML = '<b>Facebook Messages</b>';
    title.style.cssText = 'font-size:14px;line-height:1.1';

    // Requested: total count at top
    const countLine = document.createElement('div');
    countLine.style.cssText =
      'font-size:12px;color:rgba(255,255,255,.75);font-weight:900';
    countLine.textContent = 'Total records: 0';

    headLeft.appendChild(title);
    headLeft.appendChild(countLine);

    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end';

    function btn(txt, bg) {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText =
        `padding:8px 10px;border-radius:8px;border:none;font-weight:700;cursor:pointer;background:${bg};color:white`;
      return b;
    }

    const btnStart = btn('Start', '#0891b2');
    const btnPause = btn('Pause', '#f59e0b');
    const btnReset = btn('Reset', '#a855f7');
    const btnExport = btn('Export', '#16a34a');
    const btnClose = btn('Close', '#374151');

    btnWrap.append(btnStart, btnPause, btnReset, btnExport, btnClose);

    head.appendChild(headLeft);
    head.appendChild(btnWrap);

    const logBox = document.createElement('pre');
    logBox.style.cssText =
      'margin:0;padding:12px;overflow:auto;flex:1;background:#0a1020;font-size:12px';

    card.append(head, logBox);
    root.appendChild(card);
    document.body.appendChild(root);

    const modal = {
      el: root,

      addLog(msg) {
        logBox.textContent = msg + '\n' + logBox.textContent;
      },

      setCount(n) {
        try {
          countLine.textContent = `Total records: ${Number(n || 0)}`;
        } catch {}
      },

      close() {
        try {
          root.remove();
        } catch {}
      },
    };

    btnStart.onclick = () => startLoop(modal);
    btnPause.onclick = () => stopLoop(modal);
    btnReset.onclick = () => reset(modal);
    btnExport.onclick = () => exportJson(modal, { reason: 'manual_btn' });
    btnClose.onclick = () => modal.close();

    // initialize count on open
    updateCount(modal);

    // make it active
    setActiveModal(modal);

    return modal;
  }

  function showFacebookMessagesModal({ reason = 'tools_modal' } = {}) {
    try {
      const existing = window.__qcoreFacebookMessagesCtl?.modal;
      if (existing && existing.el && document.body.contains(existing.el)) {
        setActiveModal(existing);
        updateCount(existing);
        try { existing.addLog(`Modal opened (reuse) — ${reason}`); } catch {}
        return existing;
      }
    } catch {}

    const modal = createModal();
    window.__qcoreFacebookMessagesCtl = { modal };
    try { modal.addLog(`Modal opened — ${reason}`); } catch {}
    return modal;
  }

  // Expose for debugging
  try { window.showFacebookMessagesModal = showFacebookMessagesModal; } catch {}

  // ---------- Tool registration (like Google Flights) ----------
  function __register() {
    try {
      if (window.__qcoreFacebookMessagesToolRegistered) return true;

      const QQ = window.QCoreToolsModal;
      if (!QQ || typeof QQ.registerTool !== 'function') return false;

      QQ.registerTool({
        id: 'facebook_messages',
        title: 'Facebook Messages',
        icon: '💬',
        description: 'Scrape Facebook messages into JSON (auto-export every 30s while running).',
        order: 175,
        onClick: () => {
          try { showFacebookMessagesModal({ reason: 'tools_modal' }); } catch (e) { console.error(e); }
        },
      });

      try { QQ.showFacebookMessagesModal = showFacebookMessagesModal; } catch {}
      try { QQ.fbShowFacebookMessagesModal = showFacebookMessagesModal; } catch {}

      window.__qcoreFacebookMessagesToolRegistered = true;
      return true;
    } catch (e) {
      console.warn('[FB] register failed', e);
      return false;
    }
  }

  function __registerWithRetry() {
    const ok = __register();
    if (ok) return true;

    // same pending queue style as other tools
    try {
      const arr = (window.__QCORE_TOOLS_PENDING__ =
        window.__QCORE_TOOLS_PENDING__ || []);
      if (!arr.includes(__register)) arr.push(__register);
    } catch {}

    // poll as backup
    try {
      if (window.__qcoreFacebookMessagesRegisterPoll) return false;

      let tries = 0;
      window.__qcoreFacebookMessagesRegisterPoll = setInterval(() => {
        tries += 1;

        if (window.__qcoreFacebookMessagesToolRegistered) {
          clearInterval(window.__qcoreFacebookMessagesRegisterPoll);
          window.__qcoreFacebookMessagesRegisterPoll = null;
          return;
        }

        const ok2 = __register();
        if (ok2) {
          clearInterval(window.__qcoreFacebookMessagesRegisterPoll);
          window.__qcoreFacebookMessagesRegisterPoll = null;
          return;
        }

        if (tries >= 240) { // 60s
          clearInterval(window.__qcoreFacebookMessagesRegisterPoll);
          window.__qcoreFacebookMessagesRegisterPoll = null;
          console.warn('[FB] tool register poll timed out (Tools UI never appeared?)');
        }
      }, 250);
    } catch {}

    return false;
  }

  __registerWithRetry();
})();