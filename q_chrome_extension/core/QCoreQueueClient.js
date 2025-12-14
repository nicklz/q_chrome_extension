// core/QCoreQueueClient.js
// QCoreQueueClient — v2 (module-only exports; no root globals). QID always from window.title.
// Provides: QFileWrite, QNewTab, getAllResponsesAll, updateStateFromHash, currentQID
// Usage from other modules:
//   window.QCoreQueueClient.QFileWrite(...)
//   window.QCoreQueueClient.QNewTab(...)
//   window.QCoreQueueClient.getAllResponsesAll()
//   window.QCoreQueueClient.updateStateFromHash()
//   window.QCoreQueueClient.currentQID()

(function () {
  if (window.QCoreQueueClient) return;

  // -------------------- Local shims (module-scoped) --------------------
  const getState = () => {
    try { return JSON.parse(localStorage.getItem('state')) || { status:'paused', events:[], tickets:{} }; }
    catch { return { status:'paused', events:[], tickets:{} }; }
  };
  const setState = (s) => { try { localStorage.setItem('state', JSON.stringify(s)); } catch {} };
  const getGlobalState = async () => ({});
  const setGlobalState = async (_)=>{};

  // -------------------- QID: always from window title --------------------
  function currentQID() {
    if (typeof window.qid !== 'undefined') {
      window.document.title = window.qid;

      return qid;
    }
    const raw = String(document.title || '').trim();
    const low = raw.toLowerCase();
    let state = getState();
  
    if (state.debug) {
      console.log('[Q] currentQID check', low);
    }
  
    // ---------------------------------------------
    // 1. CHECK HASH FOR #Q_WRITE or #Q_MANIFEST
    // ---------------------------------------------
    const hash = String(window.location.hash || '').trim();   // e.g. "#Q_WRITE=abc|extra"
    const upperHash = hash.toUpperCase();
  
    let extractedQID = null;
  
    if (upperHash.startsWith('#Q_WRITE=') || upperHash.startsWith('#Q_MANIFEST=')) {
      // remove "#"
      const clean = hash.substring(1);             // e.g. "Q_WRITE=abc|123"
      const parts = clean.split('=');              // ["Q_WRITE", "abc|123"]
  
      if (parts.length === 2) {
        const payload = parts[1];                  // "abc|123"
        const pipeSplit = payload.split('|');      // ["abc", "123"]
        const first = (pipeSplit[0] || '').trim(); // "abc"
  
        if (first.toLowerCase().startsWith('q_')) {
          extractedQID = first.toLowerCase();
          if (state.debug) {
            console.log('[Q] extracted QID from hash →', extractedQID);
          }
        }
      }
    }
  
    if (extractedQID) {
      window.qid = extractedQID;
      return extractedQID;
    }
  
    // ---------------------------------------------
    // 2. FALLBACK: USE window.title if it starts with q_
    // ---------------------------------------------
    if (low.startsWith('q_')) {
      window.qid = low;
      return low;
    }
  
    // ---------------------------------------------
    // 3. FINAL RESORT DEFAULT
    // ---------------------------------------------
    console.warn(
      '🟨 [Q] QCoreQueueClient.js Missing/invalid QID in window.title and hash; defaulting to q_status_1 — title:',
      raw
    );
    
    window.document.title = 'q_status_1';
    return 'q_status_1';
  }
  

  // -------------------- Helpers --------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const ensureHiddenCollector = () => {
    let el = document.querySelector('#nexus-terminal-input');
    if (!el) {
      el = document.createElement('input');
      el.type = 'text';
      el.id = 'nexus-terminal-input';
      el.value = '';
      el.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;display:none;';
      document.documentElement.appendChild(el);
    }
    return el;
  };

  const selectAllArticles = () => Array.from(document.querySelectorAll('article'));

  function normalizeSandboxPath(p) {
    if (!p || typeof p !== 'string') return './sandbox/unknown';
    let s = p.replace(/\\/g,'/').replace(/^[a-z]+:\/\//i,'').replace(/^[A-Z]:\//,'');
    s = s.replace(/^\.\/sandbox\/?/i,'').replace(/^(\.\/)+/g,'').replace(/^\/+/g,'');
    const parts = s.split('/').filter(Boolean).map(seg=>{
      let t = seg.toLowerCase().replace(/[^a-z0-9._-]+/g,'_').replace(/[_-]{2,}/g,'_').replace(/^\.+/,'').replace(/^[_-]+|[_-]+$/g,'');
      return t || 'x';
    });
    return `./sandbox/${parts.join('/')||'unknown'}`.replace(/\/{2,}/g,'/');
  }

  // -------------------- Core ops (module methods) --------------------
  async function QFileWrite(qid, filepath, content, state) {
    try {
      const path = normalizeSandboxPath(filepath);
      const res = await fetch('http://localhost:3666/q_run', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ qid, filepath: path, content: String(content ?? '') })
      });
      const json = await res.json().catch(()=>([{ success:false, error:'Bad JSON from /q_run' }]));
      return { state, result: json };
    } catch (e) {
      return { state, result: [{ success:false, error: String(e?.message || e) }] };
    }
  }

  async function QNewTab(qid, filepath, content) {
    const path = normalizeSandboxPath(filepath);

    let state = getState();
    let globalState = await getGlobalState();
    globalState.state = state;
    try { await setGlobalState(globalState); } catch {}

    const url = `https://chatgpt.com/#Q_WRITE=${encodeURIComponent(qid)}|${encodeURIComponent(path)}|${encodeURIComponent(String(content ?? ''))}`;
    window.open(url, qid, 'popup=yes,width=320,height=20,left=20000,top=15000,resizable=yes,scrollbars=yes');
    return true;
  }

  // -------------------- Conversation capture (module only) --------------------
  const COPY_SELECTORS = [
    '[data-testid="copy-turn-action-button"]',
    'button[aria-label="Copy"]',
    'button[aria-label="Copy code"]',
    '[data-testid="copy-button"]',
    'button:has(svg[aria-label="Copy"])'
  ];

  const findCopyButtons = (root) => {
    const set = new Set();
    for (const sel of COPY_SELECTORS) root.querySelectorAll(sel).forEach(b => set.add(b));
    return Array.from(set);
  };

  async function getAllResponsesAll() {
    console.log('getAllResponsesAll start!')
    await sleep(500);

    const input = ensureHiddenCollector();
    const articles = selectAllArticles();
    const results = [];

    for (let idx = 0; idx < articles.length; idx++) {
      const a = articles[idx];
      const entry = { index: idx, copied: false, fallback: false, text: '' };

      const buttons = findCopyButtons(a);
      if (buttons.length > 0) {
        const preferred = buttons.find(b => b.matches('[data-testid="copy-turn-action-button"]')) || buttons[0];
        try {
          preferred.click();
          await sleep(200);
          const txt = await navigator.clipboard.readText();
          if (txt && txt.trim()) { entry.copied = true; entry.text = txt; }
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


    console.log('getAllResponsesAll end !', [input.value])
    return JSON.stringify([input.value], null, 2);
  }

  // -------------------- Hash bootstrap (module only) --------------------
  async function updateStateFromHash() {
    let state = getState();
    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

    // Q_IMAGE branch (no file writes)
    if (params.has('Q_IMAGE')) {
      state.qImage = params.get('Q_IMAGE');
      state.qPrompt = null;
      state.qPromptSingleFileWrite = 0;
      setState(state);
      // If a status loop module provides an image handler, call it via its module
      try {
        if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.sendImage === 'function') {
          state = await window.QCoreStatusLoop.sendImage(state);
          setState(state);
        }
      } catch {}
      return state;
    }

    state.run_count = (state?.run_count ?? 0) + 1;

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

    // hydrate tickets from globalState if needed
    let globalState = await getGlobalState();
    if (!state.tickets && globalState?.state?.tickets) {
      state.tickets = globalState.state.tickets;
      setState(state);
    }

    const hasManifest = params.has('Q_MANIFEST');
    const hasPrompt   = params.has('Q_WRITE');
    if (!hasManifest && !hasPrompt) return state;

    const ticket = pickTicket(state);
    state.manifest = null;
    state.qPromptSingleFileWrite = hasPrompt ? 1 : 0;

    // ALWAYS use qid from window title
    const qid = currentQID();
    let filepath = null, content = null;

    if (hasManifest) {
      let driver = '';

      if (!state.debug) {
        driver = 'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. ' +
        'GIVE FULL FILE PATH STARTING WITH ./sandbox/. RETURN JSON ARRAY OF {qid, filepath, content}. ' +
        'QID MUST BE THE WINDOW TITLE (NO MINTING). DO NOT NAME NON-MANIFEST FILES “manifest”. ' +
        'WRITE DETAILED HEADERS, INTERFACES, RUN INSTRUCTIONS; FRONTEND React, BACKEND Express; synced state. ' +
        'ALWAYS INCLUDE A Makefile WITH "make install" AND "make up". ';
      }
      else {
        driver = 'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. ' +
        'GIVE FULL FILE PATH STARTING WITH ./sandbox/. RETURN JSON ARRAY OF {qid, filepath, content}. ' +
        'QID MUST BE THE WINDOW TITLE (NO MINTING). DO NOT NAME NON-MANIFEST FILES “manifest”. ' +
        'WRITE DETAILED HEADERS, INTERFACES, RUN INSTRUCTIONS; FRONTEND React, BACKEND Express; synced state. ' +
        'ALWAYS INCLUDE A Makefile WITH "make install" AND "make up". OVERRIDE - THIS IS DEBUG MODE - OVERIDE THIS IS DEBUG MODE SHORTEN THIS TO VERY LIMITED FUNCTIONAL INFO ONLY DO 10 FILES MAX. LOW TOKEN USAGE OUTPUT';
      }
      const ticketDesc = ticket?.description || 'ERROR: MISSING TICKET DESCRIPTION — RETURN A MINIMAL MANIFEST ARRAY.';
      filepath = '/tmp/q_manifest.json';
      content  = driver + ticketDesc;
      state.qPrompt = `${qid}|${filepath}|${content}`;
      setState(state);
    } else {
      const raw = (params.get('Q_WRITE') || '').trim();
      const parts = raw.split('|');
      filepath = (parts[1] || '').trim();
      content  = parts.slice(2).join('|').trim();
      filepath = normalizeSandboxPath(filepath || `/tmp/${qid}.txt`);
      state.qPrompt = `${qid}|${filepath}|${content}`;
      setState(state);
    }

    try {
      // Prefer module-provided generator if available
      if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
        state = await window.QCoreStatusLoop.generateQ(state);
        state.run_count = (state.run_count || 0) + 1;
        setState(state);
      }

      if (hasManifest) {
        const items = Array.isArray(state.response) ? state.response : [];
        if (items.length) {
          const batchSize = 5;
          const delay = (ms) => new Promise(r=>setTimeout(r, ms));
          for (let i=0;i<items.length;i+=batchSize) {
            const batch = items.slice(i, i+batchSize);
            await Promise.all(batch.map(async it => {
              const _qid  = currentQID();
              const _path = normalizeSandboxPath(it.filepath || `/tmp/${_qid}.txt`);
              await QNewTab(_qid, _path, String(it.content ?? ''));
            }));
            if (i + batchSize < items.length) await delay(90000);
          }
          if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
            state = await window.QCoreStatusLoop.generateQ(state);
            state.run_count = (state.run_count || 0) + 1;
            setState(state);
          }
        }
      } else {
        await QFileWrite(qid, filepath, state.response ?? content, state);
        // restart via play-controls module if present
        setTimeout(() => {
          let n = 3;
          let i = setInterval(() => {
            console.log(`window closing... ${n} 🔥`);
            n--;
            if (n === 0) {
              clearInterval(i);
              console.log("closing now 💀");
              window.close();
            }
          }, 100000);
        }, 3000);
        
      }
    } catch (e) {
      if (state?.debug) console.warn('[QCoreQueueClient] updateStateFromHash error', e);
    }

    return state;
  }

  // -------------------- Module export ONLY --------------------
  window.QCoreQueueClient = {
    QFileWrite,
    QNewTab,
    getAllResponsesAll,
    updateStateFromHash,
    currentQID
  };

  // Auto-run bootstrap if a relevant hash is present (no globals created)
  try {
    const h = window.location.hash || '';
    if (/#Q_(PROMPT|MANIFEST|IMAGE)=/i.test(h)) setTimeout(() => { updateStateFromHash(); }, 0);
  } catch {}

})();
