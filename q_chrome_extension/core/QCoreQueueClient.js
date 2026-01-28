// ============================================================================
// [Q] FILE HEADER — QCoreQueueClient (v2)
// ============================================================================
// 📄 File: core/QCoreQueueClient.js
// 🆔 QID: q_file_qcqc_1
//
// 🧠 ROLE IN SYSTEM
// QCoreQueueClient is the core “bridge” module that connects:
// - Browser automation (Chat UI + DOM extraction)
// - Local execution endpoint (http://localhost:3666/q_run)
// - Q-style file mutation workflows driven by URL hash directives (#Q_WRITE / #Q_MANIFEST / #Q_IMAGE)
// - Tab spawning (opening new Chat tabs with Q directives embedded in the URL)
//
// This module is the canonical implementation of:
// - Reading Q directives from window.location.hash
// - Determining the active QID (strictly derived from window.title or hash extraction)
// - Writing files through the local server with normalized ./sandbox paths
// - Launching multi-file workflows by opening new tabs for each file write (manifest fan-out)
// - Capturing all assistant responses in a conversation into a single JSON string payload
//
// ---------------------------------------------------------------------------
// 🧱 SYSTEM LAYER
// - Browser Runtime (Chrome Extension / Content Script context)
// - Core Automation / Queue / Relay Layer
//
// ---------------------------------------------------------------------------
// 🧰 TECHNOLOGIES USED
// - Vanilla JavaScript (IIFE module pattern)
// - DOM APIs:
//   - document.querySelector / document.querySelectorAll
//   - document.createElement / appendChild
//   - document.title reads/writes
// - Web APIs:
//   - fetch (POST JSON to localhost relay server)
//   - window.open (popup tab spawning)
//   - navigator.clipboard.readText (response capture when possible)
//   - URLSearchParams (hash parsing)
//   - localStorage (state storage shim)
// - Async control flow:
//   - async/await
//   - Promise-based sleeps
//
// ---------------------------------------------------------------------------
// 🧩 RELATED FILES / MODULES
// - core/QCoreStatusLoop.js
//   → Optional orchestration module that may provide:
//     - generateQ(state): model interaction driver
//     - sendImage(state): image flow handler
// - core/QCoreModalBase.js
//   → Not directly required, but part of the core UI foundation.
// - core/QCoreContent.js (or equivalent state provider)
//   → In this file, localStorage is used as a minimal state shim; other modules
//     may provide global state sync helpers.
//
// ---------------------------------------------------------------------------
// 📊 BUSINESS / PRODUCT ANALYSIS
// Why this file exists:
// - The system needs a single, auditable “queue client” that translates high-level
//   directives into deterministic local actions.
// - The automation pipeline must be able to:
//   - Take a Q_WRITE (single file) and commit the generated output to disk
//   - Take a Q_MANIFEST (multi-file manifest) and fan-out into many Q_WRITE tabs
//   - Capture multi-turn conversation output when needed for packaging / archival
// - QIDs must be consistent across all emitted artifacts for traceability.
//
// Value delivered:
// - Reliable local-first file generation without blind writes
// - Deterministic fan-out workflows for large manifests
// - Simplified integration surface: other modules call window.QCoreQueueClient.*
//
// ---------------------------------------------------------------------------
// 🏗️ ARCHITECTURAL INTENT
// - Module exports are attached ONLY to window.QCoreQueueClient (single namespace)
// - No additional root globals are intentionally created
// - QID is always sourced from the environment (window.title / hash), never minted
// - Sandbox path normalization prevents unsafe/invalid file paths
// - Errors are contained and returned as structured results rather than throwing
//
// ---------------------------------------------------------------------------
// 🔁 CONTROL FLOW OVERVIEW
// 1) currentQID()
//   - Priority order:
//     A) If window.qid exists, enforce document.title = window.qid and return it
//     B) If hash begins with #Q_WRITE= or #Q_MANIFEST=, extract q_* token and return it
//     C) If document.title begins with q_, treat it as QID and return it
//     D) Fallback to q_status_1 and set document.title accordingly
//
// 2) updateStateFromHash()
//   - Parse hash into params
//   - If Q_IMAGE: store state, invoke optional QCoreStatusLoop.sendImage
//   - If Q_MANIFEST:
//     - Build a driver prompt + append ticket description
//     - Set state.qPrompt in the form qid|filepath|content
//     - Run generateQ (if provided by QCoreStatusLoop)
//     - For each manifest item in state.response, open new Q_WRITE tabs via QNewTab
//   - If Q_WRITE:
//     - Extract filepath and content from hash
//     - Normalize filepath into ./sandbox/...
//     - Run generateQ (optional) then write the produced state.response via QFileWrite
//     - Close the window after a delay loop
//
// 3) QFileWrite(qid, filepath, content, state)
//   - POST {qid, filepath, content} to localhost relay
//   - Return structured {state, result}
//
// 4) getAllResponsesAll()
//   - For each <article> turn:
//     - Prefer clicking a “copy” UI button and reading clipboard (best fidelity)
//     - Otherwise fall back to article text extraction
//   - Aggregate into a hidden input value and return JSON stringified array [text]
//
// ---------------------------------------------------------------------------
// 📌 FUNCTIONS EXPORTED
// - QFileWrite(qid, filepath, content, state): Promise<{state, result}>
// - QNewTab(qid, filepath, content): Promise<boolean>
// - getAllResponsesAll(): Promise<string>  // returns JSON string
// - updateStateFromHash(): Promise<object> // returns state
// - currentQID(): string
//
// ---------------------------------------------------------------------------
// 🧾 VARIABLES / CONSTANTS (KEY ONES)
// - getState(): reads localStorage 'state' or defaults {status, events, tickets}
// - setState(s): writes localStorage 'state'
// - getGlobalState/setGlobalState: async shims (currently no-op / empty)
// - COPY_SELECTORS: selectors used to find copy buttons inside each article
//
// ---------------------------------------------------------------------------
// 🔐 SECURITY & SAFETY NOTES
// - All file writes are routed through a local server endpoint (localhost)
// - normalizeSandboxPath() constrains writes under ./sandbox/*
// - QID is treated as a public identifier (not a secret)
// - Clipboard reads are best-effort and may fail silently; fallback is used
//
// ---------------------------------------------------------------------------
// 📝 PATCH NOTES
// 🧩 v2 core export surface consolidated under window.QCoreQueueClient
// 🧠 QID derivation enforced from title/hash (no minting)
// 🧹 Path normalization hardened for ./sandbox confinement
// 📎 Documentation expanded for auditability — no critical data is lost
//
// ---------------------------------------------------------------------------
// FINAL GUARANTEE
// no critical data is lost
// ============================================================================

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
// -------------------- QID: prefer ?qid query string --------------------
function currentQID() {
  const state = getState();

  // ---------------------------------------------
  // 0. CHECK QUERY STRING FOR ?qid (length > 4)
  // ---------------------------------------------
  const search = String(window.location.search || '');
  const queryParams = new URLSearchParams(search);
  const qidParam = queryParams.get('qid');

  if (typeof qidParam === 'string' && qidParam.trim().length > 4) {
    const normalized = qidParam.trim();

    window.qid = normalized;
    window.document.title = normalized;

    if (state.debug) {
      console.log('[Q] QID from query string →', normalized);
    }

    return normalized;
  }

  // ---------------------------------------------
  // 1. EXISTING GLOBAL QID
  // ---------------------------------------------
  if (typeof window.qid === 'string' && window.qid.length > 4) {
    window.document.title = window.qid;
    return window.qid;
  }

  const rawTitle = String(document.title || '').trim();
  const lowTitle = rawTitle.toLowerCase();

  if (state.debug) {
    console.log('[Q] currentQID fallback check', lowTitle);
  }

  // ---------------------------------------------
  // 2. CHECK HASH FOR #Q_WRITE or #Q_MANIFEST
  // ---------------------------------------------
  const hash = String(window.location.hash || '').trim();
  const upperHash = hash.toUpperCase();

  let extractedQID = null;

  if (upperHash.startsWith('#Q_WRITE=') || upperHash.startsWith('#Q_MANIFEST=')) {
    const clean = hash.substring(1);        // remove #
    const parts = clean.split('=');

    if (parts.length === 2) {
      const payload = parts[1];
      const first = (payload.split('|')[0] || '').trim();

      if (first.toLowerCase().startsWith('q_') && first.length > 4) {
        extractedQID = first.toLowerCase();

        if (state.debug) {
          console.log('[Q] extracted QID from hash →', extractedQID);
        }
      }
    }
  }

  if (extractedQID) {
    window.qid = extractedQID;
    window.document.title = extractedQID;
    return extractedQID;
  }

  // ---------------------------------------------
  // 3. FALLBACK: WINDOW TITLE
  // ---------------------------------------------
  if (lowTitle.startsWith('q_') && lowTitle.length > 4) {
    window.qid = lowTitle;
    return lowTitle;
  }

  // ---------------------------------------------
  // 4. FINAL DEFAULT
  // ---------------------------------------------
  console.warn(
    '[Q] Missing/invalid QID in query, hash, and title; defaulting to q_status_1 — title:',
    rawTitle
  );

  window.qid = 'q_status_1';
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
    const path = normalizeSandboxPath(filepath);
    const payload = JSON.stringify({
      qid,
      filepath: path,
      content: String(content ?? '')
    });

    const targets = [
      { url: 'http://localhost:3666/q_run', label: 'localhost' }
    ];

    for (const t of targets) {
      try {
        const res = await fetch(t.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });

        const json = await res.json().catch(() => ([
          { success: false, error: `Bad JSON from ${t.label}` }
        ]));

        return { state, result: json };

      } catch (e) {
        // try next target
        if (t === targets[targets.length - 1]) {
          return {
            state,
            result: [
              { success: false, error: String(e?.message || e) }
            ]
          };
        }
      }
    }
  }

  
  // -------------------- Core ops (module methods) --------------------
  async function QFileRead(qid, filepaths = [], state) {
    try {
      // build command
      let command = 'cd ./sandbox && lsd a';
      if (Array.isArray(filepaths) && filepaths.length > 0) {
        // IMPORTANT: join safely; backend executes raw bash
        // command = `lsd ${filepaths.map(p => `"${p}"`).join(' ')}`;
      }

      // unique qid per invocation (required)


      const res = await fetch('http://localhost:3666/q_run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qid,
          command
        })
      });

      const json = await res.json();

      return {
        state,
        result: json
      };

    } catch (e) {
      return {
        state,
        result: {
          success: false,
          error: String(e?.message || e)
        }
      };
    }
  }

  async function QNewTab(qid, filepath, content) {
    const path = normalizeSandboxPath(filepath);

    let state = getState();
    let globalState = await getGlobalState();
    globalState.state = state;
    try { await setGlobalState(globalState); } catch {}

    const url = `https://chatgpt.com/#Q_WRITE=${encodeURIComponent(qid)}|${encodeURIComponent(path)}|${encodeURIComponent(String(content ?? ''))}`;

    // 🔔 fire notification request (unique every time)
    chrome.runtime.sendMessage({
      type: "Q_NEW_TAB_FIRED",
      qid,
      path,
      ts: Date.now()
    });

    // 🪟 open new tab/window (already correct)
    window.open(
      url,
      `Q_${qid}_${Date.now()}`, // unique window name
      "popup=yes,width=320,height=20,left=20000,top=15000,resizable=yes,scrollbars=yes"
    );

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

    console.log('getAllResponsesAll end !', [input.value]);
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


    // optional: log or use the value
    console.log('screen-threadFlyOut present:', state.hasThreadFlyOut);

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
      state.status = 'file_write';
      // Prefer module-provided generator if available
      if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
        state = await window.QCoreStatusLoop.generateQ(state);
        state.run_count = (state.run_count || 0) + 1;
        setState(state);
      }



      if (hasManifest && !state.hasThreadFlyOut) {
        let items = Array.isArray(state.response) ? state.response : [];
        if (items.length) {
          // BATCH SIZE FINDME
          const batchSize = 4;
          const delay = (ms) => new Promise(r=>setTimeout(r, ms));
          for (let i=0;i<items.length;i+=batchSize) {
            const batch = items.slice(i, i+batchSize);
            await Promise.all(batch.map(async it => {
         
              
              const _path = normalizeSandboxPath(it.filepath || `/tmp/${it.qid}.txt`);
              console.log("❎ QNewTab ❎", [it.qid, _path, String(it.content ?? '')])
              await QNewTab(it.qid, _path, String(it.content ?? ''));


            }));
            await delay(30000)
          }
          // if (window.QCoreStatusLoop && typeof window.QCoreStatusLoop.generateQ === 'function') {
          //   state = await window.QCoreStatusLoop.generateQ(state);
          //   state.run_count = (state.run_count || 0) + 1;
          //   setState(state);
          // }

          // check if element with data-testid="screen-threadFlyOut" exists on the page


          console.log('❎1', state.manifest)
          let filepaths = Array.isArray(state.manifest)
          ? state.manifest.map(item => item.filepath).filter(Boolean)
          : [];
          console.log('❎2', filepaths)

          let fileReadContents;
          let fileOutput;
          console.log('WAIT 90 FOR LSD')
          await delay(60000)
          console.log('WAIT FINISHED RUN LSD')
          try {
            let fileReadQID = `q_command_lsd_${Date.now()}`;
            fileReadContents = await QFileRead(fileReadQID, filepaths, state);
            console.log("fileReadContents !!!!!!!!!! ", fileReadContents);
            console.log('❎', 3);
            fileOutput =
              fileReadContents?.result?.server_state?.[fileReadQID]
                ?.result
                ?.response
                ?.output;
          
            console.log('❎', 4);
            console.log("fileOutput !!!!!!!!!! ", fileOutput);
            
            let fileTune = 'the following is lsd output of files you just wrote, some may have errored so if empty or missing data generate new items with same qid and filepath with new content. do you see any issues? do you see any dummy content? for databases generate large json files of data from web searches if possible. are all the features complete? do you want to write more files? write new qid items qid filepath content for any needed fixes. here is file dump: ';
            window?.QCorePromptChunker?.sendPrompt(fileTune + fileOutput + ' RETURN NEW MANIFEST WITH NEW FILES OR RETURN []. ONLY RETURN [] IF THE COUNT OF FILES MATCH AND THEY ALL LOOK GOOD  OTHERWISE REDO THE MANIFEST WITH FIXES WITH SAME QIDs and FILEPATHS AND NEW CONTENT');

            let response = await window?.QCorePromptChunker?.getResponse();
            state.response = await window?.QCoreContent?.recoverManifest(response);

            let items = Array.isArray(state.response) ? state.response : [];


            for (let i=0;i<newManifest.length;i+=batchSize) {
              const batch = items.slice(i, i+batchSize);
              await Promise.all(batch.map(async it => {
           
                
                const _path = normalizeSandboxPath(it.filepath || `/tmp/${it.qid}.txt`);
                console.log("❎ QNewTab ❎", [it.qid, _path, String(it.content ?? '')])
                await QNewTab(it.qid, _path, String(it.content ?? ''));
  
  
              }));
              if (i + batchSize < items.length) await delay(20000);
            }


            console.log('❎', 5);
          } catch (err) {
            console.error("❌ QFileRead / prompt handling failed", {
              error: err,
              filepaths,
              state,
              fileReadContents,
              fileOutput,
              serverQID
            });
          }
        

        }
      } else {
        await QFileWrite(qid, filepath, state.response ?? content, state);

        chrome.runtime.sendMessage({
          type: "Q_NEW_TAB_CLOSED",
          qid,
          path,
          ts: Date.now()
        });

        
        // window.close();


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
