// core/QCoreStatusPanel.js
(function () {
    if (window.QCoreStatusPanel) return;
  
    const getState = window?.QCoreContent?.getState || (() => JSON.parse(localStorage.getItem('state')) || {});
  
    function ensure(targetSel, tag, id) {
      const host = document.querySelector(targetSel) || document.body;
      let el = host.querySelector('#' + id);
      if (!el) { el = document.createElement(tag); el.id = id; host.appendChild(el); }
      return el;
    }
  
    function paintLabel(state, fail) {
      const btn = document.querySelector('#menu-tools');
      if (!btn) return;
    
      let label = btn.querySelector('.q-status-label');
      if (!label) {
        label = document.createElement('span');
        label.className = 'q-status-label';
        btn.insertBefore(label, btn.firstChild);
      }
    
      const s = String(state?.status ?? 'offline');
      const lockedText = state?.locked ? ' ⛔ [locked]' : '';
      const debugText = state?.debug ? ' 🚧 [debug mode on]' : '';
    
      label.textContent = `${fail ? '❌' : '✅'} [${s}]${lockedText}${debugText}`;
    }
    
    
  
    function buildPanel(state) {
      const panel = ensure('#menu-tools', 'div', 'q-status');
      panel.innerHTML = '';
      const root = document.createElement('div');
      root.id = 'q-status-root';
      root.style.cssText = 'margin-top:6px;font-size:12px;color:#cbd5e1';
      const qLen = Array.isArray(state?.server?.queue) ? state.server.queue.length : (state?.server?.queue ? Object.keys(state.server.queue).length : 0);
      const tkLen = (state?.tickets && typeof state.tickets === 'object') ? Object.keys(state.tickets).length : 0;
      const qRow = document.createElement('div'); qRow.textContent = `Queue: ${qLen}`;
      const tRow = document.createElement('div'); tRow.textContent = `Tickets: ${tkLen}`;
      root.append(qRow, tRow); panel.appendChild(root);
    }
  
    async function updateStatus(state) {
      
      const qid = window.QCoreQueueClient.currentQID();
    
      if (state.debug) {
        console.log('[Q] updateStatus: start', { qid, state });
        console.log('[Q] updateStatus: before try POST');
      }

    
      try {
        const res = await fetch('http://localhost:3666/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qid, state })
        });
        if (state.debug) {  
          console.log('[Q] updateStatus: POST [qid, snap]', [qid, state]);
        }
        
        const data = await res.json().catch(() => null);
        if (state.debug) {
          console.log('[Q] 🟢 updateStatus: POST success ', { status: res.status, ok: res.ok, data });
        }
    
        paintLabel(state, false);
    
      } catch (err) {
        console.error('[Q] updateStatus: POST failed [err, qid, snap]', [err, qid, state]);
        paintLabel(state, true);
        console.log('[Q] updateStatus: after paintLabel(success=true)');
      }
    
      buildPanel(state);
    }
    
  
    window.QCoreStatusPanel = { updateStatus };
  })();
  