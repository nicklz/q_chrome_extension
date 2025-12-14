// core/QCoreTerminalModal.js
(function () {
    // QCoreTerminalModal — “[Files]” popup (projects/tickets light shell)
    if (window.QCoreTerminalModal) return;

  

  
    // ---------- #menu-new click logic ----------
    async function showTerminalModal () {

  
      if (typeof window.QCoreQueueClient.getAllResponsesAll !== 'function' || typeof window.QCoreQueueClient.QNewTab !== 'function') {
        console.error('[QCoreTerminalModal] Missing QCoreQueueClient helpers (QNewTab/getAllResponsesAll). Load plugins/QCoreQueueClient.js first.');
        window.QCoreModalBase.showModal && window.QCoreModalBase.showModal('Queue client not loaded. Load QCoreQueueClient.js first.');
        return;
      }
  
      try {
        let state  = window?.QCoreContent?.getState() || {};
        let server = (state.server && typeof state.server === 'object') ? state.server : {};
        let queue  = (server.queue && typeof server.queue === 'object') ? server.queue : {}; // object map
  
        // find highest q_manifest_N
        const nums = Object.keys(queue)
          .map(k => /^q_manifest_(\d+)$/.exec(k))
          .filter(Boolean)
          .map(m => Number(m[1]))
          .filter(Number.isFinite);
  
        const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
        const qid     = `q_manifest_${nextNum}`;
        const filepath= `/tmp/${qid}.json`; // if you prefer sandboxing later: `./sandbox/tmp/${qid}.json`
        const now     = Date.now();


        window.document.title = qid;
  
        // materialize a fresh queue entry
        queue[qid] = {
          created_at: now,
          errors: [],
          qid,
          queue_status: 'new_manifest_terminal_start',
          raw: '',
          result: null,
          retry_count: 0,
          state: { prompt: ''},
          updated_at: now,
          success: false,
          status: 'new'
        };
  
        // update state counts safely
        server.queue = queue;
        server.count = Object.keys(queue).length;
        state.server = server;
        window?.QCoreContent?.setState(state);
  
        // collect full conversation data as JSON
        const contentJSON = await window.QCoreQueueClient.getAllResponsesAll();
  
        // open new tab and persist JSON content
        if (qid === 'q_status_1') {
          console.error('qid status error', qid)
        }
        const redirect_result = await window.QCoreQueueClient.QNewTab(qid, filepath, contentJSON);
        console.log('[Nexus] QNewTab result:', redirect_result);
      } catch (err) {
        console.error('[QCoreTerminalModal] Failed:', err);
        window.QCoreModalBase.showModal && window.QCoreModalBase.showModal('Terminal capture failed: ' + (err && err.message ? err.message : String(err)));
      }
    }
  
    window.QCoreTerminalModal = { showTerminalModal };
  })();
  