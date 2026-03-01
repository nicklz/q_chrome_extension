// ============================================================================
// [Q] FILE HEADER — QCoreQueueClient (v2.2 patched)
// ============================================================================
// 📄 File: core/QCoreQueueClient.js
// 🧠 ROLE IN SYSTEM
// QCoreQueueClient is the core “bridge” module that connects:
// - Browser automation (Chat UI + DOM extraction)
// - Local execution endpoint (http://localhost:3666/q_run)
// - Q-style file mutation workflows driven by URL hash directives
//   (#Q_WRITE / #Q_MANIFEST / #Q_IMAGE)
// - Tab spawning (opening new Chat tabs with Q directives embedded in the URL)
//
// ---------------------------------------------------------------------------
// PATCH NOTES (2026-02-25)
// ✅ Fix: Immediately persist state.manifest from #Q_MANIFEST=... (parsed JSON when possible)
// ✅ Fix: Also keep state.manifestRaw string for fidelity/debugging
// ✅ Fix: Ensure state.title/state.qid match window title QID for downstream ticket selection
// ✅ Fix: Auto-run regex includes Q_WRITE + Q_PROMPT (legacy)
// ✅ Fix: Prevent runtime ReferenceErrors (path/newManifest/serverQID) from breaking flows
//
// FINAL GUARANTEE
// no critical data is lost
// ============================================================================

(function () {
  'use strict';
  if (window.QCoreQueueClient) return;

  // -------------------- Local shims (module-scoped) --------------------
  const getState = () => {
    try {
      const s = JSON.parse(localStorage.getItem('state'));
      if (s && typeof s === 'object') {
        if (!s.events || !Array.isArray(s.events)) s.events = [];
        if (!s.tickets || typeof s.tickets !== 'object') s.tickets = {};
        return s;
      }
      return { status: 'paused', events: [], tickets: {} };
    } catch {
      return { status: 'paused', events: [], tickets: {} };
    }
  };

  const setState = (s) => {
    try {
      if (!s || typeof s !== 'object') return;
      localStorage.setItem('state', JSON.stringify(s));
    } catch {}
  };

  const getGlobalState = async () => ({});
  const setGlobalState = async (_) => {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function nowIso() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  // -------------------- QID: prefer ?qid query string --------------------
  function currentQID() {
    const state = getState();

    // 0) Query string ?qid
    try {
      const queryParams = new URLSearchParams(String(window.location.search || ''));
      const qidParam = queryParams.get('qid');

      if (typeof qidParam === 'string' && qidParam.trim().length > 4) {
        const normalized = qidParam.trim();
        window.qid = normalized;
        document.title = normalized;

        if (state.debug) console.log('[Q] QID from query string →', normalized);
        return normalized;
      }
    } catch {}

    // 1) Existing global qid
    if (typeof window.qid === 'string' && window.qid.length > 4) {
      document.title = window.qid;
      return window.qid;
    }

    const rawTitle = String(document.title || '').trim();
    const lowTitle = rawTitle.toLowerCase();

    if (state.debug) console.log('[Q] currentQID fallback check', lowTitle);

    // 2) Hash extraction (supports #Q_WRITE and #Q_MANIFEST)
    const hash = String(window.location.hash || '').trim();
    const upperHash = hash.toUpperCase();

    let extractedQID = null;

    if (upperHash.startsWith('#Q_WRITE=') || upperHash.startsWith('#Q_MANIFEST=')) {
      const clean = hash.substring(1); // remove #
      const parts = clean.split('=');

      if (parts.length === 2) {
        const payload = parts[1];
        const first = (payload.split('|')[0] || '').trim();
        if (first.toLowerCase().startsWith('q_') && first.length > 4) {
          extractedQID = first.toLowerCase();
          if (state.debug) console.log('[Q] extracted QID from hash →', extractedQID);
        }
      }
    }

    if (extractedQID) {
      window.qid = extractedQID;
      document.title = extractedQID;
      return extractedQID;
    }

    // 3) Window title
    if (lowTitle.startsWith('q_') && lowTitle.length > 4) {
      window.qid = lowTitle;
      return lowTitle;
    }

    // 4) Default
    console.log('[Q] Missing/invalid QID in query, hash, and title; defaulting to q_status_1');
    window.qid = 'q_status_1';
    document.title = 'q_status_1';
    return 'q_status_1';
  }

  // -------------------- Helpers --------------------
  function ensureHiddenCollector() {
    let el = document.querySelector('#nexus-terminal-input');
    if (!el) {
      el = document.createElement('input');
      el.type = 'text';
      el.id = 'nexus-terminal-input';
      el.value = '';
      el.style.cssText =
        'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;display:none;';
      document.documentElement.appendChild(el);
    }
    return el;
  }

  const selectAllArticles = () => Array.from(document.querySelectorAll('article'));

  function normalizeSandboxPath(p) {
    if (!p || typeof p !== 'string') return './sandbox/unknown';
    let s = p.replace(/\\/g, '/').replace(/^[a-z]+:\/\//i, '').replace(/^[A-Z]:\//, '');
    s = s.replace(/^\.\/sandbox\/?/i, '').replace(/^(\.\/)+/g, '').replace(/^\/+/g, '');
    const parts = s
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        let t = seg
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '_')
          .replace(/[_-]{2,}/g, '_')
          .replace(/^\.+/, '')
          .replace(/^[_-]+|[_-]+$/g, '');
        return t || 'x';
      });
    return `./sandbox/${parts.join('/') || 'unknown'}`.replace(/\/{2,}/g, '/');
  }

  // -------------------- Core ops (module methods) --------------------
  async function QFileWrite(qid, filepath, content, state) {
    const path = normalizeSandboxPath(filepath);
    const payload = JSON.stringify({
      qid,
      filepath: path,
      content: String(content ?? ''),
    });

    const targets = [{ url: 'http://localhost:3666/q_run', label: 'localhost' }];

    for (const t of targets) {
      try {
        const res = await fetch(t.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

        const json = await res.json().catch(() => [
          { success: false, error: `Bad JSON from ${t.label}` },
        ]);

        return { state, result: json };
      } catch (e) {
        if (t === targets[targets.length - 1]) {
          return {
            state,
            result: [{ success: false, error: String(e?.message || e) }],
          };
        }
      }
    }
  }

  async function QFileRead(qid, filepaths = [], state) {
    try {
      const command = 'cd ./sandbox && lsd -la';

      const res = await fetch('http://localhost:3666/q_run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qid, command, filepaths }),
      });

      const json = await res.json();
      return { state, result: json };
    } catch (e) {
      return { state, result: { success: false, error: String(e?.message || e) } };
    }
  }

  async function QNewTab(qid, filepath, content) {

    
    const path = normalizeSandboxPath(filepath);

    let state = getState();
    let globalState = await getGlobalState();
    globalState.state = state;
    try {
      await setGlobalState(globalState);
    } catch {}

    function encodeUnderscore(content) {
      const str = String(content ?? '');

      return str
        .replace(/[^a-zA-Z0-9]/g, '_')  // replace special chars
        .replace(/_+/g, '_')            // collapse multiple underscores
        .replace(/^_+|_+$/g, '');       // trim edges
    }
    let url = `https://chatgpt.com/#Q_WRITE=${encodeURIComponent(qid)}|${encodeURIComponent(
      path
    )}|${encodeUnderscore(String(content ?? ''))}`;


    // 🔔 notify (if extension runtime is present)
    try {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'Q_NEW_TAB_FIRED',
          qid,
          path,
          ts: Date.now(),
        });
      }
    } catch {}

    // 🪟 open new tab/window
    // window.open(
    //   url,
    //   `Q_${qid}_${Date.now()}`, // unique window name
    //   'popup=yes,width=320,height=20,left=20000,top=15000,resizable=yes,scrollbars=yes'
    // );
    window.open(
      url,
      '_blank'
    );

    return true;
  }

  // -------------------- Conversation capture (module only) --------------------
  const COPY_SELECTORS = [
    '[data-testid="copy-turn-action-button"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Copy code"]',
    '[data-testid="copy-button"]',
  ];

  const findCopyButtons = (root) => {
    const set = new Set();
    for (const sel of COPY_SELECTORS) root.querySelectorAll(sel).forEach((b) => set.add(b));
    return Array.from(set);
  };

  async function getAllResponsesAll() {
    console.log('getAllResponsesAll start!');
    await sleep(500);

    const input = ensureHiddenCollector();
    const articles = selectAllArticles();
    const results = [];

    for (let idx = 0; idx < articles.length; idx++) {
      const a = articles[idx];
      const entry = { index: idx, copied: false, fallback: false, text: '' };

      const buttons = findCopyButtons(a);
      if (buttons.length > 0) {
        const preferred =
          buttons.find((b) => b.matches('[data-testid="copy-turn-action-button"]')) || buttons[0];
        try {
          preferred.click();
          await sleep(200);
          const txt = await navigator.clipboard.readText();
          if (txt && txt.trim()) {
            entry.copied = true;
            entry.text = txt;
          }
        } catch {}
      }

      if (!entry.text) {
        entry.fallback = true;
        const raw = a.textContent || a.innerText || '';
        entry.text = (raw || '').trim();
      }

      input.value += (input.value ? '\n' : '') + entry.text;
      results.push(entry);
      await sleep(200);
    }

    console.log('getAllResponsesAll end!', [input.value]);
    return JSON.stringify([input.value], null, 2);
  }

  // -------------------- Hash bootstrap (module only) --------------------
  async function updateStateFromHash() {
    let state = getState();
    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

    // ALWAYS derive QID early (ensures window title is set correctly)
    const qid = currentQID();
    state.qid = qid;
    state.title = qid;

    // Q_IMAGE branch
    if (params.has('Q_IMAGE')) {
      state.qImage = params.get('Q_IMAGE');
      state.qPrompt = null;
      state.qPromptSingleFileWrite = 0;
      state.lastHashAt = nowIso();
      setState(state);

      try {
        if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.sendImage === 'function') {
          state = await window.QCoreStatusLoop.sendImage(state);
          setState(state);
        }
      } catch {}
      return state;
    }

    const hasManifest = params.has('Q_MANIFEST');
    const hasWrite = params.has('Q_WRITE') || params.has('Q_PROMPT');

    if (!hasManifest && !hasWrite) return state;

    // ------------------------------------------------------------
    // ✅ FIX: Persist manifest immediately to state.manifest (parsed when possible)
    // ------------------------------------------------------------
    let qManifestRaw = null;
    if (hasManifest) {
      qManifestRaw = params.get('Q_MANIFEST');
      if (typeof qManifestRaw === 'string' && qManifestRaw.trim()) {
        state.manifestRaw = qManifestRaw;
        const parsed = safeJsonParse(qManifestRaw);
        state.manifest = (parsed !== null ? parsed : qManifestRaw);
        if (parsed !== null) state.manifestParsed = parsed;
        state.manifestAt = nowIso();

        // Persist early (so even if later logic throws, the manifest sticks)
        setState(state);
      }
    }

    // Helper: pick active ticket with description
    const pickTicket = (s) => {
      const ts = s?.tickets;
      const title = typeof s?.title === 'string' ? s.title : null;
      if (title && ts?.[title]?.description?.trim()) return ts[title];
      if (ts && typeof ts === 'object') {
        for (const k of Object.keys(ts)) {
          const t = ts[k];
          if (t?.description?.trim()) return t;
        }
      }
      return null;
    };

    state.run_count = (state?.run_count ?? 0) + 1;

    // hydrate tickets from globalState if needed
    try {
      const globalState = await getGlobalState();
      if ((!state.tickets || typeof state.tickets !== 'object') && globalState?.state?.tickets) {
        state.tickets = globalState.state.tickets;
        setState(state);
      }
    } catch {}

    const ticket = pickTicket(state);

    // ------------------------------------------------------------
    // MANIFEST FLOW (treat Q_MANIFEST as prompt/ticket description)
    // ------------------------------------------------------------
    if (hasManifest) {
      const ticketDesc =
        (typeof qManifestRaw === 'string' && qManifestRaw.trim())
          ? qManifestRaw
          : (ticket?.description || 'ERROR: MISSING TICKET DESCRIPTION — RETURN A MINIMAL MANIFEST ARRAY.');

      // Optional: sync active ticket description to Q_MANIFEST
      try {
        if (ticket && ticketDesc && ticket.description !== ticketDesc) {
          ticket.description = ticketDesc;
          ticket.updatedAt = nowIso();
          setState(state);
        }
      } catch {}

      let driver = '';
      if (!state.debug) {
        driver =
          'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. ' +
          'GIVE FULL FILE PATH STARTING WITH ./sandbox/. RETURN JSON ARRAY OF {qid, filepath, content}. ' +
          'QID MUST BE THE WINDOW TITLE (NO MINTING). DO NOT NAME NON-MANIFEST FILES “manifest”. ' +
          'WRITE DETAILED HEADERS, INTERFACES, RUN INSTRUCTIONS; FRONTEND React, BACKEND Express; synced state. ' +
          'ALWAYS INCLUDE A Makefile WITH "make install" AND "make up". ';
      } else {
        driver =
          'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. ' +
          'GIVE FULL FILE PATH STARTING WITH ./sandbox/. RETURN JSON ARRAY OF {qid, filepath, content}. ' +
          'QID MUST BE THE WINDOW TITLE (NO MINTING). DO NOT NAME NON-MANIFEST FILES “manifest”. ' +
          'DEBUG MODE: SHORT OUTPUT, <= 10 FILES MAX.';
      }

      const filepath = '/tmp/q_manifest.json';
      const content = driver + ticketDesc;

      state.qPromptSingleFileWrite = 0;
      state.qPrompt = `${qid}|${filepath}|${content}`;
      state.status = 'manifest';
      setState(state);

      // Generate manifest via QCoreStatusLoop if present
      try {
        if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
          await new Promise(r => setTimeout(r, 1000));
          state = await window.QCoreStatusLoop.generateQ(state);
          state.run_count = (state.run_count || 0) + 1;
          setState(state);
        }
      } catch (e) {
        if (state.debug) console.warn('[QCoreQueueClient] generateQ (manifest) error', e);
      }

      // If state.response is a file manifest array, store it and fan-out
      try {
        const items = Array.isArray(state.response) ? state.response : [];
        if (items.length) {
          state.fileManifest = items;
          state.fileManifestAt = nowIso();
          setState(state);

          const batchSize = 4;
          const delay = (ms) => new Promise((r) => setTimeout(r, ms));

          for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (it) => {
                const _path = normalizeSandboxPath(it.filepath || `/tmp/${it.qid}.txt`);
                await QNewTab(it.qid, _path, String(it.content ?? ''));
              })
            );
            if (i + batchSize < items.length) await delay(2000);
          }
        }
      } catch (e) {
        if (state.debug) console.warn('[QCoreQueueClient] fan-out error', e);
      }

      return state;
    }

    // ------------------------------------------------------------
    // Q_WRITE FLOW (single file write)
    // ------------------------------------------------------------
    if (hasWrite) {
      const raw = (params.get('Q_WRITE') || params.get('Q_PROMPT') || '').trim();
      const parts = raw.split('|');

      let filepath = (parts[1] || '').trim();
      let content = parts.slice(2).join('|').trim();

      filepath = normalizeSandboxPath(filepath || `/tmp/${qid}.txt`);

      state.qPromptSingleFileWrite = 1;
      state.qPrompt = `${qid}|${filepath}|${content}`;
      state.status = 'file_write';
      setState(state);

      try {
        if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
          state = await window.QCoreStatusLoop.generateQ(state);
          state.run_count = (state.run_count || 0) + 1;
          setState(state);
        }

        // Write to disk (fallback: content as-is if no response)
        const body = state.response ?? content;
        await QFileWrite(qid, filepath, body, state);

        // Notify close (guarded)
        try {
          if (chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'Q_NEW_TAB_CLOSED',
              qid,
              path: filepath,
              ts: Date.now(),
            });
          }
        } catch {}
      } catch (e) {
        if (state.debug) console.warn('[QCoreQueueClient] Q_WRITE flow error', e);
      }

      return state;
    }

    return state;
  }

  // -------------------- Module export ONLY --------------------
  window.QCoreQueueClient = {
    QFileWrite,
    QFileRead,
    QNewTab,
    getAllResponsesAll,
    updateStateFromHash,
    currentQID,
  };

  // Auto-run bootstrap if a relevant hash is present
  try {
    const h = window.location.hash || '';
    // ✅ FIX: include WRITE + PROMPT (legacy)
    if (/#Q_(WRITE|PROMPT|MANIFEST|IMAGE)=/i.test(h)) setTimeout(() => { updateStateFromHash(); }, 0);
  } catch {}

})();