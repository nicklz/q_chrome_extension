/*  | [Q] CORE | QCoreContent.js |
    ------------------------------------------------------------
    Role:       Content-script bootstrap + state/ticket helpers (MV3-safe).

    Exports (module-only via window.QCoreContent):
      - getState()                     -> localStorage "state" (with safe defaults)
      - setState(state?)               -> writes localStorage "state" (NO recursion)
      - getGlobalState()               -> chrome.storage.local "globalState" (fallback localStorage)
      - setGlobalState(data)           -> chrome.storage.local "globalState" (fallback localStorage)
      - createTicket(errorData)        -> stores ticket object in state.tickets
      - initializeQ()                  -> hydrates + handles #Q_MANIFEST and optional #nexus flow
      - recoverManifest(raw)           -> lightweight passthrough parser (kept non-throwing)
      - sanitizeInput(input)           -> conservative sanitizer
      - isAllowed/currentDomain        -> allowlist helpers

    Guards:
      - Single-run: window.__NEXUS_CONTENT_INIT__
      - Module export guard: window.QCoreContent

    Patch Notes (2026-02-25)
      ✅ Fix: setState() no longer calls itself with an undefined variable (was clobbering state)
      ✅ Fix: getState() defaults tickets to {} (object), not []
      ✅ Fix: initializeQ() now persists state.manifest from the URL hash when #Q_MANIFEST=... exists
      ✅ Fix: state.manifest is stored as parsed JSON (array/object) when possible; also stores manifestRaw string
      ✅ Fix: window title is pinned from ?qid=... when present

    Notes:
      - No root globals besides window.QCoreContent + __NEXUS_CONTENT_INIT__ guard.
      - Domain allowlist sets "nexus-enabled" class when active.
      - no critical data is lost
*/

(function () {
  'use strict';

  // ---------- module export guard ----------
  if (window.QCoreContent) return;

  // ---------- single-run guard ----------
  if (window.__NEXUS_CONTENT_INIT__) return;
  window.__NEXUS_CONTENT_INIT__ = true;

  // ---------- domain allowlist ----------
  const currentDomain = location.hostname;
  const allowedDomains = [
    "chatgpt.com",
    "linkedin.com",
    "openai.com",
    "instagram.com",
    "ads.reddit.com",
    "distrokid.com",
    "facebook.com",
    "blockchain.com",
    "google.com",
    "zillow.com",
    "justice.gov",
    "virginwifi.com",
    "runitbyq.com",
    "flyfrontier.com",
    "www.flyfrontier.com",
    "claude.ai",
    "grok.com",
    "sora.com",
    "sora.chatgpt.com",
    "amazon.com",
    "reddit.com",
    "suno.com",
    "spotify.com"
  ];

  const isAllowed = allowedDomains.some(
    (allowed) => currentDomain === allowed || currentDomain.endsWith('.' + allowed)
  );

  if (isAllowed) {
    document.documentElement.classList.add('nexus-enabled');
    console.log(`🤖 Nexus active on ${currentDomain}`);
  } else {
    console.log(`🤖 Nexus NOT ACTIVE on ${currentDomain}`);
  }

  // domain class (stable)
  try {
    document.documentElement.classList.add(
      location.hostname
        .replace(/^www\./, '')
        .replace(/\./g, '')
    );
  } catch {}

  // ---------- utils ----------
  function sanitizeInput(input) {
    return String(input ?? '')
      .replace(/[^a-zA-Z0-9\s,$.#@-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  // ---------- storage helpers (MODULE ONLY) ----------
  async function setGlobalState(data) {
    await new Promise((resolve) => {
      try {
        chrome?.storage?.local?.set({ globalState: data }, () => {
          try {
            const st = data?.state;
            if (st?.debug) console.log('[QCoreContent] globalState set', data);
          } catch {}
          resolve();
        });
      } catch {
        try { localStorage.setItem('__GLOBAL__', JSON.stringify({ globalState: data })); } catch {}
        resolve();
      }
    });
  }

  async function getGlobalState() {
    return await new Promise((resolve) => {
      try {
        chrome?.storage?.local?.get(['globalState'], (result) => {
          const def = { state: null, status: 'play', transactions: [] };
          resolve(result?.globalState || def);
        });
      } catch {
        try {
          const raw = localStorage.getItem('__GLOBAL__');
          const parsed = raw ? JSON.parse(raw) : {};
          resolve(parsed.globalState || { state: null, status: 'play', transactions: [] });
        } catch {
          resolve({ state: null, status: 'play', transactions: [] });
        }
      }
    });
  }

  function getState() {
    // Prefer in-page cache (survives some clobbers)
    try {
      if (window.__qcoreStateCache && typeof window.__qcoreStateCache === 'object') {
        return window.__qcoreStateCache;
      }
    } catch {}

    try {
      const parsed = JSON.parse(localStorage.getItem('state'));
      if (parsed && typeof parsed === 'object') {
        if (!parsed.events || !Array.isArray(parsed.events)) parsed.events = [];
        if (!parsed.tickets || typeof parsed.tickets !== 'object') parsed.tickets = {};
        return parsed;
      }
    } catch {}

    return { status: 'paused', events: [], tickets: {} };
  }

  /**
   * setState(nextState)
   * Critical: must be non-recursive and must not write unrelated globalState back into local "state".
   */
  async function setState(nextState) {
    if (!nextState || typeof nextState !== 'object') {
      nextState = getState();
    }

    if (!nextState.events || !Array.isArray(nextState.events)) nextState.events = [];
    if (!nextState.tickets || typeof nextState.tickets !== 'object') nextState.tickets = {};

    const override = !!nextState.lockedOverride;
    if (nextState.locked && !override) {
      console.log('%c🟥 LOCKED CANT SET STATE setState', 'color: red; font-size: 16px;', nextState);
      return;
    }

    if (override) {
      nextState = { ...nextState, lockedOverride: false };
    }

    try {
      localStorage.setItem('state', JSON.stringify(nextState));
    } catch (e) {
      console.warn('[QCoreContent.setState] localStorage write failed:', e?.message || e);
    }

    try {
      window.__qcoreStateCache = nextState;
      window.__qcoreStateCacheMs = Date.now();
    } catch {}

    // Maintain largest arrays in-memory
    try {
      const arr =
        Array.isArray(nextState?.amazon?.products) ? nextState.amazon.products :
        (Array.isArray(nextState?.amazon?.items) ? nextState.amazon.items : null);

      if (Array.isArray(arr)) {
        const cur = window.__qcoreLargestAmazonProducts;
        if (!Array.isArray(cur) || arr.length > cur.length) window.__qcoreLargestAmazonProducts = arr;
      }
    } catch {}

    try {
      const arr = Array.isArray(nextState?.linkedin?.jobs) ? nextState.linkedin.jobs : null;
      if (Array.isArray(arr)) {
        const cur = window.__qcoreLargestLinkedInJobs;
        if (!Array.isArray(cur) || arr.length > cur.length) window.__qcoreLargestLinkedInJobs = arr;
      }
    } catch {}

    try {
      const arr = Array.isArray(nextState?.reddit) ? nextState.reddit : null;
      if (Array.isArray(arr)) {
        const cur = window.__qcoreLargestReddit;
        if (!Array.isArray(cur) || arr.length > cur.length) window.__qcoreLargestReddit = arr;
      }
    } catch {}

    try {
      const arr = Array.isArray(nextState?.facebook) ? nextState.facebook : null;
      if (Array.isArray(arr)) {
        const cur = window.__qcoreLargestFacebook;
        if (!Array.isArray(cur) || arr.length > cur.length) window.__qcoreLargestFacebook = arr;
      }
    } catch {}

    // Optional mirror to globalState (non-blocking)
    try {
      const gs = await getGlobalState();
      void setGlobalState({ ...gs, state: nextState, lastWriteAt: nowIso() });
    } catch {}
  }

  // ---------- ticket helper (MODULE ONLY) ----------
  function createTicket(errorData) {
    const state = getState();

    if (!state.tickets || typeof state.tickets !== 'object') state.tickets = {};

    for (const k of Object.keys(state.tickets)) {
      if (state.tickets[k] == null) delete state.tickets[k];
    }

    const filePath = errorData?.sourceURL || 'Unknown File';
    const errorMessage = errorData?.message || 'No message available';
    const stackTrace = errorData?.stack || 'No stack trace available';

    const nextId = Object.keys(state.tickets).length + 1;
    const ticketId = `NEXUS-${String(nextId).padStart(3, '0')}`;

    const newTicket = {
      id: ticketId,
      status: 'open',
      type: 'bug',
      summary: `console.log ${errorMessage} in ${filePath}`,
      description: `Error in file: ${filePath}`,
      logs: [
        'Opened the ticket...',
        `Error Message: ${errorMessage}`,
        `Stack Trace: ${stackTrace}`,
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const exists = Object.values(state.tickets).some((t) => t?.summary === newTicket.summary);
    if (!exists) {
      state.tickets[ticketId] = newTicket;
      void setState(state);
      console.log(`✅ Created ticket:`, newTicket);
    } else {
      console.log(`⚠️ Ticket already exists for this error: ${filePath}`);
    }
  }

  // ---------- UI bootstrap sequence ----------
  function proceedWithTicketSequence(nexusValue) {
    const menuFiles = document.querySelector('#menu-tickets');
    if (!menuFiles) return;

    setTimeout(() => {
      menuFiles.click();

      setTimeout(() => {
        const firstTicketHeader = document.querySelector('.tickets-container h3');
        if (!firstTicketHeader) return;

        firstTicketHeader.click();

        setTimeout(() => {
          const uploadBtn = document.querySelector('.nexus-ticket-manifest-upload');
          if (!uploadBtn) return;

          uploadBtn.click();

          setTimeout(() => {
            const manifestInput = document.querySelector('.nexus-ticket-manifest-input');
            if (!manifestInput) return;

            manifestInput.value = String(nexusValue ?? '');
            manifestInput.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
              const firstSave = document.querySelector(
                '.nexus-ticket-wizard-modal-content .nexus-ticket-save-btn'
              );
              if (!firstSave) return;

              firstSave.click();

              const poll = setInterval(() => {
                const btn = document.querySelector(
                  '.nexus-ticket-wizard-modal-content .nexus-ticket-save-btn'
                );
                if (btn) btn.click();

                const wizardModal = document.querySelector('.nexus-ticket-wizard-modal');
                if (!wizardModal) {
                  clearInterval(poll);

                  const secondSave = document.querySelector('.nexus-ticket-save-btn');
                  if (secondSave) secondSave.click();

                  setTimeout(() => {
                    const projectHeader = document.querySelector('.projects-container h3');
                    if (!projectHeader) return;

                    projectHeader.click();
                    setTimeout(() => {
                      const menuPlay = document.querySelector('#menu-play');
                      const menuAutomate = document.querySelector('#menu-automate');
                      if (menuPlay) menuPlay.click();
                      if (menuAutomate) menuAutomate.click();
                    }, 1000);
                  }, 1000);
                }
              }, 2000);
            }, 500);
          }, 1000);
        }, 1000);
      }, 1000);
    }, 500);
  }

  function deriveQIDFromEnv() {
    // Prefer ?qid query parameter
    try {
      const qp = new URLSearchParams(String(window.location.search || ''));
      const qidParam = qp.get('qid');
      if (qidParam && qidParam.trim().length > 4) {
        const qid = qidParam.trim();
        window.qid = qid;
        document.title = qid;
        return qid;
      }
    } catch {}

    // Fallback to existing global qid
    try {
      if (typeof window.qid === 'string' && window.qid.trim().length > 4) {
        const qid = window.qid.trim();
        document.title = qid;
        return qid;
      }
    } catch {}

    // Fallback to current title if it already looks like q_*
    try {
      const t = String(document.title || '').trim();
      if (t.toLowerCase().startsWith('q_') && t.length > 4) {
        window.qid = t;
        document.title = t;
        return t;
      }
    } catch {}

    return null;
  }

  function initializeQ() {
    // Let any UI know that content bootstrap happened
    try { window.dispatchEvent(new Event('react-hydrated')); } catch {}

    const state = getState();

    if (!state.mute && state.debug) {
      state.alert = 1;
      state.playSound = 'wub';
      void setState(state);
    }

    // Ensure title is aligned with qid query param if present
    const qid = deriveQIDFromEnv();
    if (qid) {
      // Keep these in state for other modules that look at state.title
      state.qid = qid;
      state.title = qid;
    }

    // Parse hash params (supports both #Q_MANIFEST=... and #nexus=...)
    const hash = String(window.location.hash || '').startsWith('#')
      ? window.location.hash.substring(1)
      : '';

    const params = new URLSearchParams(hash);

    // Highest priority: Q_MANIFEST
    const qManifest = params.get('Q_MANIFEST');

    // Secondary (legacy): nexus
    const nexusValue = params.get('nexus');

    const payloadRaw = (qManifest != null ? qManifest : (nexusValue != null ? nexusValue : null));
    if (!payloadRaw) return;

    // Persist the raw payload string (helpful for debugging)
    state.manifestRaw = String(payloadRaw);
    state.manifestAt = nowIso();

    // Parse if JSON, else keep raw string
    const parsed = safeJsonParse(state.manifestRaw);
    state.manifest = (parsed !== null ? parsed : state.manifestRaw);

    // If you want both, keep manifestParsed too (redundant but explicit)
    if (parsed !== null) state.manifestParsed = parsed;

    // Seed/update a default ticket with the raw manifest string in description
    if (!state.tickets || typeof state.tickets !== 'object') state.tickets = {};
    if (!state.tickets[1]) {
      state.tickets[1] = {
        id: 'NEXUS-001',
        summary: 'QFIX AUTOGENERATED',
        description: state.manifestRaw,
        status: 'open',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    } else {
      state.tickets[1].description = state.manifestRaw;
      state.tickets[1].updatedAt = nowIso();
    }

    // Persist even if the state is locked (one-shot override)
    state.lockedOverride = true;
    void setState(state);

    // If legacy nexus flow is used, optionally continue the UI automation
    if (nexusValue != null && nexusValue !== '') {
      try { proceedWithTicketSequence(nexusValue); } catch {}
    }
  }

  /**
   * recoverManifest(raw)
   * Non-throwing manifest intake. Current behavior:
   *   - If raw is JSON string -> parses, returns parsed
   *   - Else returns raw unchanged
   * no critical data is lost
   */
  function recoverManifest(raw) {
    try {
      const parsed = JSON.parse(raw);
      console.log('recoverManifest RAW', parsed);
      return parsed;
    } catch {
      console.log('recoverManifest RAW', raw);
      return raw;
    }
  }

  // ---------- handy keybinding ----------
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      const promptTextarea = document.querySelector('#prompt-textarea');
      if (!promptTextarea) return;
      const parent = promptTextarea.closest('[class^="_prosemirror"]');
      if (parent) parent.scrollTop += 12;
    }
  });

  // ---------- Module export ONLY ----------
  window.QCoreContent = {
    getState,
    setState,
    getGlobalState,
    setGlobalState,
    createTicket,
    initializeQ,
    recoverManifest,
    sanitizeInput,
    isAllowed,
    currentDomain,
  };

  // Bootstrap on load (safe)
  try { initializeQ(); } catch {}

})();