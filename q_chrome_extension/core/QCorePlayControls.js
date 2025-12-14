// core/QCorePlayControls.js
(function () {
  // Prevent duplicate load
  if (window.QCorePlayControls) return;

  // ---------- Safe shims ----------
  



  // ---------- Small helpers ----------
  function dispatchStatus(s) {
    try { window.dispatchEvent(new CustomEvent('q:state-changed', { detail: s })); } catch {}
    // mirror a simple global for quick checks in site scripts
    window.__Q_PLAYING = (s.status === 'play');
  }

  function setStatus(next) {
    const s = window?.QCoreContent?.getState() || {};
    s.alert = 1;
    s.status = next;
    window?.QCoreContent?.setState(s);
    dispatchStatus(s);
    if (s.debug) console.log("[QCorePlayControls]", "status →", next);
    return s;
  }

  // ---------- Controls ----------
  function playState() {
    setStatus("play");
  }

  function pauseState() {
    setStatus("paused");
  }

  function muteState() {
    console.log('mute!')
    const s = window?.QCoreContent?.getState() || {};
    s.mute = !s.mute;
    window?.QCoreContent?.setState(s);
    dispatchStatus(s);
    if (s.debug) console.log("[QCorePlayControls] mute →", s.mute);
  }

  function regeneratePrompt() {
    // Load state from localStorage or create a new one if none exists
    let state = JSON.parse(localStorage.getItem('state')) || { status: 'paused', events: [] };

    // Get the logs from state.events
    let logs = Array.isArray(state.events)
      ? state.events.map(event => `Event: ${event.type}, Message: ${event.message}`).join('\n')
      : '';

    // Append logs to state.prompt
    state.prompt = (state.prompt || '') +
      '\nHere are your existing log events of files you\'ve interacted with:\n' +
      logs +
      ' OK REMEMBER RETURN FAAS UNLESS I OVERRODE THIS. NOTHING ELSE! FAAS!';

    // Save the updated state back to localStorage
    localStorage.setItem('state', JSON.stringify(state));
    if (state.debug) {
      console.log('regeneratePrompt state.prompt:', state.prompt);
    }
  }

  async function restartAll(close = false) {
    let state = window?.QCoreContent?.getState();
    console.log('[Q] restartAll: begin');
  
    // unlock any stuck gates
    try {
      state.locked = false;
      state.lockedOverride = true;
      state.QMoveToProject = false;
      window?.QCoreContent?.getState(state);
      state.lockedOverride = null;
      window?.QCoreContent?.getState(state)
    } catch (e) {
      console.warn('[Q] restartAll: state unlock failed', e);
    }
  
    // hit server /restart first
    const url = 'http://localhost:3666/restart';
    let attemptedBg = false;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 4000);
  
      console.log('[Q] /restart → GET', url);
      const res = await fetch(url, { method: 'GET', signal: ac.signal, cache: 'no-store' });
      clearTimeout(to);
  
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
  
      console.log('[Q] /restart result:', {
        success: data?.success,
        method: data?.method,
        error: data?.error || null,
        before_count: data?.before?.count,
        after_count: data?.after?.count,
        ts: data?.timestamp
      });
    } catch (e) {
      console.warn('[Q] /restart fetch failed; continuing with client reload', e?.message || e);
    }

        // client-side hard fallback
        try {
          await new Promise(r => setTimeout(r, 1000)); // wait 1s before reload
          // 🩺 Doctor Q: closing all windows from queue except current
          
          console.log('🩺 State:', state);
    
          const queue = state?.server?.queue || [];
          console.log('🩺 Queue:', queue);
    
          Object.values(queue).forEach(item => {
            const qid = item?.qid;
            console.log('🩺 Found qid:', qid);
            if (qid && window[qid] && !window[qid].closed && window[qid] !== window) {
              console.log('🩺 Closing window:', qid);
              window[qid].close();
            } else {
              console.log('🩺 Skipping qid:', qid, '— window not found or is current');
            }
          });
        } catch (e) {
          console.warn('[Q] restartAll fallback error:', e, 'bgTried:', attemptedBg);
        }
    
  
    // try MV3 background restart after server clears cache
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        attemptedBg = true;
        chrome.runtime.sendMessage({ action: 'restartTabs' }, async () => {
          await new Promise(r => setTimeout(r, 2000)); // wait 1s before reload
          try { location.reload(); } catch {}
        });
        return;
      }
    } catch (_) { /* ignore */ }
  
    // client-side hard fallback
    try {
      await new Promise(r => setTimeout(r, 1000)); // wait 1s before reload
      if (close) {
        try { window.close(); } catch {}
      } else {
        try { location.reload(); } catch {}
        setTimeout(() => { try { history.go(0); } catch {} }, 150);
        setTimeout(() => { try { window.location.href = window.location.href; } catch {} }, 300);
      }
    } catch (e) {
      console.warn('[Q] restartAll fallback error:', e, 'bgTried:', attemptedBg);
    }




  }
  

  // ---------- Export ----------
  window.QCorePlayControls = {
    playState,
    pauseState,
    muteState,
    regeneratePrompt,
    restartAll
  };
})();
