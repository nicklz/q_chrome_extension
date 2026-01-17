/*  | [Q] CORE | QCoreContent.js |
    ------------------------------------------------------------
    Role:
      Content-script bootstrap + state/ticket helpers (MV3-safe).

    Exports (module-only via window.QCoreContent):
      - getState()                     -> localStorage "state"
      - setState(state?)               -> writes localStorage "state"
      - getGlobalState()               -> chrome.storage.local "globalState" (fallback localStorage)
      - setGlobalState(data)           -> chrome.storage.local "globalState" (fallback localStorage)
      - createTicket(errorData)        -> stores ticket object in state.tickets
      - initializeQ()                  -> hydrates + optional #nexus flow
      - recoverManifest(raw)           -> lightweight passthrough parser (kept non-throwing)

    Guards:
      - Single-run: window.__NEXUS_CONTENT_INIT__
      - Module export guard: window.QCoreContent

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
    'chatgpt.com',
    'openai.com',
    'sora.com',
    'blockchain.com',
    'instagram.com',
    'spotify.com',
    'distrokid.com',
    'virginwifi.com',
    'runitbyq.com'
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

  // ---------- utils ----------
  function sanitizeInput(input) {
    return String(input)
      .replace(/[^a-zA-Z0-9\s,$.#@-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- storage helpers (MODULE ONLY) ----------
  async function setGlobalState(data) {
    await new Promise((resolve) => {
      try {
        chrome?.storage?.local?.set({ globalState: data }, () => {
          try {
            if (data?.state?.debug) console.log('Data set:', data);
          } catch {}
          resolve();
        });
      } catch {
        try {
          localStorage.setItem('__GLOBAL__', JSON.stringify({ globalState: data }));
        } catch {}
        resolve();
      }
    });
  }

  async function getGlobalState() {
    return await new Promise((resolve) => {
      try {
        chrome?.storage?.local?.get(['globalState'], (result) => {
          const def = { transactions: [], status: 'play' };
          resolve(result?.globalState || def);
        });
      } catch {
        try {
          const raw = localStorage.getItem('__GLOBAL__');
          const parsed = raw ? JSON.parse(raw) : {};
          resolve(parsed.globalState || { transactions: [], status: 'play' });
        } catch {
          resolve({ transactions: [], status: 'play' });
        }
      }
    });
  }

  function getState() {
    try {
      return (
        JSON.parse(localStorage.getItem('state')) || {
          status: 'paused',
          events: [],
          tickets: [],
        }
      );
    } catch {
      return { status: 'paused', events: [], tickets: [] };
    }
  }

  async function setState(state) {
    if (!state) {
      const globalState = await getGlobalState();
      state = globalState;
    }

    if (state.locked && !state.lockedOverride) {
      console.log('%c🟥 LOCKED CANT SET STATE setState ', 'color: red; font-size: 16px;', state);
      return;
    }

    if (state.lockedOverride) state.lockedOverride = false;

    try {
      localStorage.setItem('state', JSON.stringify(state));
    } catch {}
  }

  // ---------- ticket helper (MODULE ONLY) ----------
  function createTicket(errorData) {
    const state = getState();

    if (!state.tickets || typeof state.tickets !== 'object') state.tickets = {};

    for (const k of Object.keys(state.tickets)) {
      if (state.tickets[k] == null) delete state.tickets[k];
    }

    const filePath = errorData.sourceURL || 'Unknown File';
    const errorMessage = errorData.message || 'No message available';
    const stackTrace = errorData.stack || 'No stack trace available';

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
    };

    const exists = Object.values(state.tickets).some((t) => t?.summary === newTicket.summary);
    if (!exists) {
      state.tickets[ticketId] = newTicket;
      setState(state);
      console.log(`✅ Created ticket:`, newTicket);
    } else {
      console.log(`⚠️ Ticket already exists for this error: ${filePath}`);
    }
  }

  // ---------- UI bootstrap sequence ----------
  function proceedWithTicketSequence(nexusValue) {
    const menuFiles = document.querySelector('#menu-files');
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

            manifestInput.value = nexusValue;
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

  function initializeQ() {
    window.dispatchEvent(new Event('react-hydrated'));

    const state = getState();

    if (!state.mute && state.debug) {
      state.alert = 1;
      state.playSound = 'wub';
      setState(state);
    }

    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const nexusValue = params.get('nexus');
    if (!nexusValue) return;

    if (!state.tickets) state.tickets = {};
    if (!state.tickets[1]) {
      state.tickets[1] = {
        id: 'NEXUS-001',
        summary: 'QFIX AUTOGENERATED',
        description: 'QFIX AUTOGENERATED',
        status: 'open',
      };
    } else {
      state.tickets[1].description = 'QFIX AUTOGENERATED';
    }
    setState(state);

    const clickSoon = (sel, ms = 1000) =>
      setTimeout(() => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, ms);

    clickSoon('#menu-new');

    setTimeout(() => {
      const saveButton = document.querySelector('.save-button');
      if (saveButton) saveButton.click();

      setTimeout(() => {
        const closeButton = document.querySelector('.close-button');
        if (closeButton) {
          closeButton.click();
          setTimeout(() => proceedWithTicketSequence(nexusValue), 1000);
        }
      }, 500);
    }, 1000);
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
})();
