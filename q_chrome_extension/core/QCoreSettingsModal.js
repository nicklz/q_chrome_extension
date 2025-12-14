// core/QCoreSettings.js
(function () {
    // QCoreSettings — settings modal (debug toggle, credentials, flags manager)
    if (window.showSettingsModal) return;


        // public API — unify all call sites
    window.QCoreSettingsModal = { showSettingsModal };
    // backward-compat aliases for existing callers
    window.QCoreSettings = window.QCoreSettings || window.QCoreSettingsModal;
    window.showSettingsModal = window.showSettingsModal || window.QCoreSettingsModal;
  
    const getState =
      window?.QCoreContent?.getState ||
      (() => JSON.parse(localStorage.getItem('state')) || { status:'paused', events:[], tickets:{} });
  
    const setState =
      window?.QCoreContent?.setState || (s => localStorage.setItem('state', JSON.stringify(s)));
  
    const showModal =
      (window.QCoreModalBase && window.QCoreModalBase.showModal) ||
      ((t) => alert('[QCoreSettings] ' + t));
  
    const FLAG_OPTIONS = [
      '🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪',
      '🚨','⚠️','❗','❕','❓','‼️','⁉️',
      '🚩','🏴','🏁','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️',
      '✅','❌','❎','🛑','⛔','🔺','🔻','🔸','🔹','🔶','🔷',
      '⬆️','⬇️','⬅️','➡️','🔄','🔃','🔀','🔁','🔂',
      '💡','🔥','⚡','💥','🎯','💰','💎','🛡️','🚀','🎉'
    ];
  
    const DEFAULT_FLAGS = [
      { id: 'flag_1', title: 'Flag 1', emoji: '🚩' },
      { id: 'flag_2', title: 'Flag 2', emoji: '🏴' },
      { id: 'flag_3', title: 'Flag 3', emoji: '⛳'  },
    ];
  
    // tiny helpers
    const byId = (id, el=document) => el.querySelector(`#${id}`);
    const mk  = (tag, attrs={}, children=[]) => {
      const el = document.createElement(tag);
      for (const [k,v] of Object.entries(attrs)) {
        if (k === 'style') el.style.cssText = v;
        else if (k === 'class') el.className = v;
        else el.setAttribute(k, v);
      }
      (Array.isArray(children) ? children : [children]).forEach(c=>{
        if (typeof c === 'string') el.appendChild(document.createTextNode(c));
        else if (c) el.appendChild(c);
      });
      return el;
    };
  
    const rowStyles  = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0';
    const inputStyle = 'padding:8px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1';
    const btnStyle   = 'padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:600;cursor:pointer';
  
    function showSettingsModal() {
      if (!showModal) return alert('Modal base not loaded');
  
      // seed flags once
      const st = getState();
      if (!Array.isArray(st.flags)) {
        st.flags = DEFAULT_FLAGS.slice();
        setState(st);
      }
  
      showModal('[Configuration]', (modal) => {
        // ========== Debug toggle ==========
        const debugRow = mk('div', { style: rowStyles });
        const debugLabel = mk('label', {}, 'Debug Mode:');
        const debugSelect = mk('select', { style: inputStyle });
        ['false','true'].forEach(v => {
          debugSelect.appendChild(mk('option', { value: v }, v === 'true' ? 'Enabled' : 'Disabled'));
        });
        debugSelect.value = String(!!getState().debug);
        debugSelect.onchange = () => { const s = getState(); s.debug = (debugSelect.value === 'true'); setState(s); };
  
        // ========== Credentials ==========
        const email = mk('input', { placeholder:'ChatGPT Email', style: inputStyle });
        email.value = localStorage.getItem('chatgptEmail') || '';
        const pass  = mk('input', { placeholder:'ChatGPT Password', type:'password', style: inputStyle });
        pass.value  = localStorage.getItem('chatgptPassword') || '';
        const saveCreds = mk('button', { style: btnStyle }, 'Save Credentials');
        saveCreds.onclick = () => {
          localStorage.setItem('chatgptEmail', email.value);
          localStorage.setItem('chatgptPassword', pass.value);
          const s = getState(); s.alert = 1; setState(s);
        };
  
        debugRow.append(debugLabel, debugSelect, email, pass, saveCreds);
        modal.appendChild(debugRow);
  
        // ========== Flags Manager ==========
        const flagsTitle = mk('div', { style: 'margin-top:4px;font-weight:700;color:#93c5fd' }, 'Flags');
  
        const addRow = mk('div', { style: rowStyles });
        const addTitle = mk('input', { id:'cfg-flag-title', placeholder:'Enter Flag Title', style: inputStyle + ';min-width:220px' });
        const emojiSelect = mk('select', { id:'cfg-flag-emoji', style: inputStyle });
        FLAG_OPTIONS.forEach(emo => emojiSelect.appendChild(mk('option', { value: emo }, emo)));
        const addBtn = mk('button', { style: btnStyle }, 'Add / Update Flag');
        addRow.append(addTitle, emojiSelect, addBtn);
  
        const table = mk('table', { id:'cfg-flags-table', style:'width:100%;border-collapse:collapse;margin-top:6px' });
        const thead = mk('thead');
        thead.appendChild(
          mk('tr', {}, [
            mk('th', { style:'text-align:left;padding:8px;border-bottom:1px solid #273449;color:#cbd5e1' }, 'Title'),
            mk('th', { style:'text-align:left;padding:8px;border-bottom:1px solid #273449;color:#cbd5e1' }, 'UUID'),
            mk('th', { style:'text-align:left;padding:8px;border-bottom:1px solid #273449;color:#cbd5e1' }, 'Emoji'),
            mk('th', { style:'text-align:left;padding:8px;border-bottom:1px solid #273449;color:#cbd5e1' }, 'Action'),
          ])
        );
        const tbody = mk('tbody');
        table.appendChild(thead);
        table.appendChild(tbody);
  
        function renderFlags() {
          const s = getState();
          const flags = Array.isArray(s.flags) ? s.flags : [];
          tbody.innerHTML = '';
          flags.forEach((flag, i) => {
            const tr = mk('tr');
            const td = (txt) => mk('td', { style:'padding:8px;border-bottom:1px solid #1f2a3a;color:#e5e7eb;vertical-align:top' }, txt);
            const del = mk('button', { style: btnStyle + ';background:#7f1d1d' }, '❌ Delete');
            del.onclick = () => {
              const ns = getState();
              ns.flags = (ns.flags || []).filter((_, idx) => idx !== i);
              setState(ns);
              renderFlags();
            };
            const act = mk('td', { style:'padding:8px;border-bottom:1px solid #1f2a3a' }, del);
            tr.append(td(flag.title || ''), td(flag.id || ''), td(flag.emoji || ''), act);
            tbody.appendChild(tr);
          });
        }
  
        addBtn.onclick = () => {
          const title = (byId('cfg-flag-title', modal).value || '').trim();
          const emoji = byId('cfg-flag-emoji', modal).value || '🚩';
          if (!title) return;
          const id = title.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]+/g,'').replace(/^_+|_+$/g,'') || `flag_${Date.now()}`;
          const s = getState();
          const list = Array.isArray(s.flags) ? s.flags.slice() : [];
          const at = list.findIndex(f => f.id === id);
          if (at >= 0) list[at] = { id, title, emoji }; else list.push({ id, title, emoji });
          s.flags = list;
          setState(s);
          renderFlags();
        };
  
        modal.appendChild(flagsTitle);
        modal.appendChild(addRow);
        modal.appendChild(table);
        renderFlags();
      });
    }
  
    // public API
    window.showSettingsModal = { showSettingsModal };
  
    // backward compatibility with existing button hook:
    // If other code calls showSettingsModal(), delegate to QCoreSettings.showSettingsModal().
    if (!window.showSettingsModal) {
      window.showSettingsModal = showSettingsModal;
    }
  })();
  