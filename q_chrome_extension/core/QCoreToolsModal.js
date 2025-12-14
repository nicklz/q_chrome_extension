// core/QCoreToolsModal.js
// QCoreToolsModal — “[Tools]” popup (full fat, now with lazy-loading for QCorePeopleManager)
// Fix: Clicking “People Manager” no longer fails with “QCorePeopleManager not loaded”.
//      We add a robust lazy loader that injects /core/QCorePeopleManager.js (MV3-safe) and waits for window.QCorePeopleManager.

(function () {
  if (window.QCoreToolsModal) return;

  // ------------------------------ Env Guards / Host Bridges ------------------------------
  const showModal =
    (window.QCoreModalBase && window.QCoreModalBase.showModal) ||
    ((title, painter) => {
      // Minimal fallback modal via alert-style host; still runs painter in a throwaway div
      const shim = document.createElement('div');
      shim.style.cssText = 'position:fixed;inset:0;z-index:2147483647;padding:16px;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
      const card = document.createElement('div');
      card.style.cssText = 'max-width:780px;width:95vw;max-height:85vh;overflow:auto;background:#0b1117;color:#cbd5e1;border:1px solid #273449;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5);padding:16px;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu;white-space:normal;';
      const h = document.createElement('div');
      h.textContent = title || '[Tools]';
      h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#93c5fd';
      const close = document.createElement('button');
      close.textContent = 'Close';
      close.style.cssText = 'float:right;padding:6px 10px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:#1f2a3a;color:#e2e8f0;cursor:pointer';
      close.onclick = () => shim.remove();
      h.appendChild(close);
      card.appendChild(h);
      shim.appendChild(card);
      document.body.appendChild(shim);
      try { painter(card); } catch (e) { console.error('[QCoreToolsModal] painter error', e); }
    });

  const getState =
    window?.QCoreContent?.getState ||
    (() => {
      try {
        return JSON.parse(localStorage.getItem('state')) || { status: 'paused', events: [], tickets: [] };
      } catch {
        return { status: 'paused', events: [], tickets: [] };
      }
    });

  const setState =
    window?.QCoreContent?.setState ||
    ((s) => {
      try { localStorage.setItem('state', JSON.stringify(s)); } catch {}
    });

  // Token knobs (kept for chunking/utilities that might rely on these)
  if (typeof window.TOKEN_MAX === 'undefined') window.TOKEN_MAX = 150000;
  if (typeof window.TOKEN_MAX_HALF === 'undefined') window.TOKEN_MAX_HALF = 100000;
  if (typeof window.TOKEN_OVERMAX === 'undefined') window.TOKEN_OVERMAX = 100001;
  if (typeof window.HEARTBEAT === 'undefined') window.HEARTBEAT = 2000;

  // ------------------------------ NEW: Robust Lazy Loader for Plugins ------------------------------
  // MV3-safe loader that injects a <script src="chrome-extension://.../core/FILE.js"> into the *page* context,
  // resolves when the global symbol appears or rejects on timeout.
  async function loadPluginIfNeeded({ globalCheck, filePath, symbolPath, timeoutMs = 15000 }) {
    // If already present, resolve fast
    try {
      const existing = globalCheck();
      if (existing) return existing;
    } catch {}

    // Build extension URL if possible; else try relative (best-effort in dev)
    let url = filePath;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        url = chrome.runtime.getURL(filePath);
      }
    } catch {}

    // Avoid double-inject by src
    const already = Array.from(document.querySelectorAll('script[src]')).some(s => s.src === url);
    if (!already) {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.crossOrigin = 'anonymous';
      // Ensure it runs in page context (content scripts append to document)
      (document.head || document.documentElement).appendChild(s);
    }

    // Wait for symbol to appear
    const started = Date.now();
    return await new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        try {
          // resolve on first truthy global
          const ok = globalCheck();
          if (ok) { clearInterval(iv); resolve(ok); return; }
          // timeout
          if (Date.now() - started > timeoutMs) {
            clearInterval(iv);
            reject(new Error(`Timeout loading ${symbolPath} from ${filePath}`));
          }
        } catch (e) {
          clearInterval(iv);
          reject(e);
        }
      }, 150);
    });
  }

  // Specialized helper for People Manager
  async function ensurePeopleManager(btn) {
    const flash = (el, emoji) => { try { flashEmoji(el, emoji); } catch {} };
    try {
      const PM = await loadPluginIfNeeded({
        globalCheck: () => (window.QCorePeopleManager && typeof window.QCorePeopleManager.QPeopleManagerView === 'function') ? window.QCorePeopleManager : null,
        filePath: 'core/QCorePeopleManager.js',
        symbolPath: 'window.QCorePeopleManager'
      });
      flash(btn, '🟢');
      return PM;
    } catch (e) {
      console.error('[QCoreToolsModal] Failed to load QCorePeopleManager:', e);
      flash(btn, '🔴');
      throw e;
    }
  }

  // ------------------------------ UI Helpers ------------------------------
  function flashEmoji(target, emoji = '🟢') {
    try {
      // micro click/scale feedback
      const prevT = target.style.transition;
      const prevX = target.style.transform;
      target.style.transition = 'transform 120ms ease';
      target.style.transform = 'scale(0.97)';
      setTimeout(() => {
        target.style.transform = prevX || 'scale(1)';
        target.style.transition = prevT || '';
      }, 120);

      // bubble
      const parent = target.parentElement || document.body;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      const span = document.createElement('span');
      span.textContent = emoji;
      span.style.cssText = 'position:absolute;right:-10px;top:-8px;opacity:1;transition:opacity .6s ease,transform .6s ease;pointer-events:none';
      parent.appendChild(span);
      requestAnimationFrame(() => {
        span.style.opacity = '0';
        span.style.transform = 'translateY(-10px)';
      });
      setTimeout(() => span.remove(), 650);
    } catch {}
  }

  // Background-friendly “Copy All Tab URLs” (content cannot call chrome.tabs.*)
  async function copyAllTabUrls(btn, onlyCurrentWindow = true) {
    try {
      if (!(chrome && chrome.runtime && chrome.runtime.sendMessage)) {
        throw new Error('chrome.runtime.sendMessage not available');
      }
      const res = await chrome.runtime.sendMessage({
        type: 'GET_TABS_URLS',
        scope: onlyCurrentWindow ? 'current' : 'all',
      });
      if (!res || !res.ok) throw new Error(res?.error || 'background failed');

      const json = JSON.stringify(res.urls || [], null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (btn) flashEmoji(btn, '🟢');
    } catch (e) {
      console.error('Copy tabs failed:', e);
      if (btn) flashEmoji(btn, '🔴');
    }
  }

  // ------------------------------ Cache/Clearing Helpers ------------------------------
  async function clearLocalStorage(btn) {
    try {
      localStorage.clear();
      flashEmoji(btn, '🟢');
    } catch {
      flashEmoji(btn, '🔴');
    }
  }

  async function clearSessionStorage(btn) {
    try {
      sessionStorage.clear();
      flashEmoji(btn, '🟢');
    } catch {
      flashEmoji(btn, '🔴');
    }
  }

  async function clearIndexedDB(btn) {
    try {
      let dbs = [];
      if (indexedDB && typeof indexedDB.databases === 'function') {
        try { dbs = await indexedDB.databases(); } catch {}
      }
      const names = Array.from(
        new Set(
          []
            .concat(dbs?.map((d) => d.name).filter(Boolean) || [])
            .concat(['keyval-store', 'localforage', 'idb-keyval', 'qpm-db', 'nexus-db'])
        )
      );
      await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
            })
        )
      );
      flashEmoji(btn, '🟢');
    } catch {
      flashEmoji(btn, '🔴');
    }
  }

  async function clearCacheStorage(btn) {
    try {
      if (!('caches' in window)) throw new Error('CacheStorage not supported');
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      flashEmoji(btn, '🟢');
    } catch {
      flashEmoji(btn, '🔴');
    }
  }

  async function clearChromeBrowsingData(btn) {
    try {
      if (!(chrome && chrome.runtime && chrome.runtime.sendMessage)) throw new Error('no runtime messaging');
      const res = await chrome.runtime.sendMessage({
        type: 'CLEAR_BROWSING_DATA',
        options: { since: 0, origins: [location.origin] },
      });
      if (!res || !res.ok) throw new Error(res?.error || 'background failed');
      flashEmoji(btn, '🟢');
    } catch (e) {
      console.warn('CLEAR_BROWSING_DATA not available from this context', e);
      flashEmoji(btn, '🔴');
    }
  }

  // ------------------------------ Downloader (yt-dlp via local server) ------------------------------
  function makeDownloaderSection() {
    const fieldset = document.createElement('fieldset');
    fieldset.classList.add('downloader-fieldset');
    fieldset.style.cssText =
      'border:1px solid #273449;border-radius:10px;padding:12px;margin-bottom:12px;background:linear-gradient(180deg,#0f1623 0%,#0b1117 100%)';

    const legend = document.createElement('legend');
    legend.textContent = 'Direct Video Download';
    legend.style.cssText = 'padding:0 6px;color:#93c5fd';
    fieldset.appendChild(legend);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter video URL…';
    input.classList.add('yt-url-input');
    input.style.cssText =
      'width:100%;padding:8px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1';
    fieldset.appendChild(input);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:8px;position:relative;flex-wrap:wrap';
    fieldset.appendChild(row);

    const mkBtn = (txt) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.classList.add('yt-download-button');
      b.style.cssText =
        'padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:600;cursor:pointer';
      return b;
    };

    const wavBtn = mkBtn('Download WAV');
    const mp3Btn = mkBtn('Download MP3');
    const mp4Btn = mkBtn('Download MP4');
    row.append(mp3Btn, mp4Btn, wavBtn);

    const status = document.createElement('div');
    status.classList.add('yt-download-status');
    status.textContent = '⏳ Idle';
    status.style.cssText = 'margin-top:6px;color:#94a3b8;font-size:12px';
    fieldset.appendChild(status);

    function runDownload(url, format, originBtn) {
      status.textContent = `⬇️ Downloading as ${format.toUpperCase()}…`;
      const body = {
        prompt: `yt-dlp download ${format}`,
        qid: ((value=document.title.trim().toLowerCase()).startsWith('q_')?document.title.toLowerCase():'q_error_download_1'),
        faas: [
          {
            type: 'command',
            subtype: 'yt-dlp',
            content: url,
            meta: format === 'mp3' || format === 'wav' ? { audioFormat: format } : {},
          },
        ],
      };

      fetch('http://localhost:3666/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((res) => res.json())
        .then((res) => {
          const ok = !!res?.[0]?.success;
          status.textContent = ok
            ? `✅ ${format.toUpperCase()} Download Complete`
            : `❌ Download Failed (${format.toUpperCase()}): ` + (res?.[0]?.error || 'Unknown');
          flashEmoji(originBtn, ok ? '🟢' : '🔴');
        })
        .catch((err) => {
          status.textContent = `❌ Error (${format.toUpperCase()}): ${err.message}`;
          flashEmoji(originBtn, '🔴');
        });
    }

    const guardAndGo = (btn, fmt) => {
      const url = input.value.trim();
      if (!url) {
        status.textContent = '❌ Please enter a URL.';
        flashEmoji(btn, '🔴');
        return;
      }
      runDownload(url, fmt, btn);
    };

    wavBtn.onclick = () => guardAndGo(wavBtn, 'wav');
    mp3Btn.onclick = () => guardAndGo(mp3Btn, 'mp3');
    mp4Btn.onclick = () => guardAndGo(mp4Btn, 'mp4');

    return fieldset;
  }

  // ------------------------------ Word/Token Counter ------------------------------
  function makeWordCounter() {
    const box = document.createElement('div');
    box.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:6px';

    const ta = document.createElement('textarea');
    ta.classList.add('word-count-textarea');
    ta.placeholder = 'Paste text here…';
    ta.style.cssText =
      'width:100%;min-height:120px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px';

    const lbl = document.createElement('label');
    lbl.classList.add('word-count-label');
    lbl.textContent = 'Token Count: 0';
    lbl.style.cssText = 'color:#94a3b8;font-size:12px';

    ta.addEventListener('input', () => {
      const text = ta.value.trim();
      const tokens = text.split(/\s+/).reduce((acc, token) => {
        const sub = token.split(/(?=[.,!?;(){}\[\]'"<>:\/\\|])/);
        return acc.concat(sub.filter(Boolean));
      }, []);
      lbl.textContent = `Token Count: ${tokens.length}`;
    });

    box.appendChild(ta);
    box.appendChild(lbl);
    return box;
  }

  // ------------------------------ Global Storage Helpers ------------------------------
  const globalSet =
    (window.chrome && chrome.storage && chrome.storage.local && chrome.storage.local.set.bind(chrome.storage.local)) ||
    ((data, cb) => {
      try { localStorage.setItem('__GLOBAL__', JSON.stringify(data || {})); cb && cb(); } catch {}
    });

  const globalGet =
    (window.chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get.bind(chrome.storage.local)) ||
    ((key, cb) => {
      try {
        const raw = localStorage.getItem('__GLOBAL__');
        const obj = raw ? JSON.parse(raw) : {};
        cb && cb(key ? obj[key] : obj);
      } catch { cb && cb(null); }
    });

  // ------------------------------ Tools Modal ------------------------------
  function showToolsModal() {
    const state = getState();
    state.alert = 1;
    setState(state);

    showModal('[Tools]', (modal) => {
      modal.style.whiteSpace = 'normal';

      // ---- Top row: Status + Actions ----
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap';
      modal.appendChild(row);

      const status = document.createElement('div');
      status.textContent = 'Connection: ⏳';
      status.style.cssText = 'font-weight:700;color:#cbd5e1';
      row.appendChild(status);

      // Break Lock (if locked)
      if (getState().locked === true) {
        const breakLock = document.createElement('button');
        breakLock.textContent = 'Break Lock ❌';
        breakLock.style.cssText =
          'padding:8px 10px;border-radius:8px;background:#7f1d1d;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:700';
        breakLock.onclick = () => {
          const s = getState();
          s.locked = false;
          setState(s);
          flashEmoji(breakLock, '🟢');
        };
        row.appendChild(breakLock);
      }

      const mkBtn = (txt) => {
        const b = document.createElement('button');
        b.textContent = txt;
        b.style.cssText =
          'padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:600;cursor:pointer';
        return b;
      };

      // Test Local Connection (POST with qid)
      const testBtn = mkBtn('Test Local Connection');
      testBtn.onclick = async () => {
        const currentQID = () => (window.QCoreQueueClient?.currentQID?.()) || document.title || null;
        const qid = currentQID();

        try {
          const res = await fetch('http://localhost:3666/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ qid })
          });
          const d = await res.json().catch(() => ({}));
          const ok = d?.status === 'ok';

          status.textContent = ok ? 'Connection: ✅' : 'Connection: ❌';
          flashEmoji(testBtn, ok ? '🟢' : '🔴');
        } catch {
          status.textContent = 'Connection: ❌';
          flashEmoji(testBtn, '🔴');
        }
      };
      row.appendChild(testBtn);

      // Copy All Tab URLs (current window)
      const copyBtn = mkBtn('Copy All Tab URLs');
      copyBtn.onclick = () => copyAllTabUrls(copyBtn, true);
      row.appendChild(copyBtn);

      // People Manager — FIXED: lazy-load QCorePeopleManager if missing
      const pmBtn = mkBtn('People Manager');
      pmBtn.onclick = async () => {
        pmBtn.disabled = true;
        pmBtn.textContent = 'People Manager (loading…)';
        try {
          const PM = await ensurePeopleManager(pmBtn);
          pmBtn.textContent = 'People Manager';
          pmBtn.disabled = false;
          if (PM && typeof PM.QPeopleManagerView === 'function') {
            PM.QPeopleManagerView(pmBtn, true);
            flashEmoji(pmBtn, '🟢');
          } else {
            alert('People Manager module did not expose QPeopleManagerView()');
            flashEmoji(pmBtn, '🔴');
          }
        } catch (e) {
          pmBtn.textContent = 'People Manager';
          pmBtn.disabled = false;
          alert('Failed to load People Manager. See console for details.');
        }
      };
      row.appendChild(pmBtn);

      // Tools AI Connection (send localStorage snapshot to sendPrompt + getResponse)
      const aiBtn = mkBtn('Tools AI Connection');
      aiBtn.onclick = async () => {
        try {
          let localDump = '';
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              const v = localStorage.getItem(k);
              localDump += `${k}: ${v}\n`;
            }
          } catch {}
          if (typeof window?.QCorePromptChunker?.sendPrompt === 'function') {
            window?.QCorePromptChunker?.sendPrompt(localDump);
          }
          if (typeof window.getResponse === 'function') {
            const txt = await window?.QCorePromptChunker?.getResponse();
            const pre = document.createElement('pre');
            pre.style.cssText =
              'margin-top:8px;white-space:pre-wrap;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;color:#e5e7eb;font-size:12px;max-height:220px;overflow:auto';
            pre.textContent = `AI Response:\n${txt || '(empty)'}`;
            modal.appendChild(pre);
          }
          flashEmoji(aiBtn, '🟢');
        } catch {
          flashEmoji(aiBtn, '🔴');
        }
      };
      row.appendChild(aiBtn);

      // ---- Downloader block ----
      modal.appendChild(makeDownloaderSection());


      const saveLocalNotes = mkBtn('Save Notes → localStorage');
      saveLocalNotes.style.background = '#65a30d';
      saveLocalNotes.style.color = '#0b1117';
      saveLocalNotes.style.fontWeight = '800';
      saveLocalNotes.onclick = () => {
        localStorage.setItem('q.tools.notes', notes.value);
        flashEmoji(saveLocalNotes, '🟢');
      };
      modal.appendChild(saveLocalNotes);

      // ---- Global storage suite ----
      const globalRow = document.createElement('div');
      globalRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
      modal.appendChild(globalRow);

      const saveGlobalBtn = mkBtn('Save Notes → Global');
      saveGlobalBtn.onclick = () => { globalSet({ notes: notes.value }, () => flashEmoji(saveGlobalBtn, '🟢')); };
      globalRow.appendChild(saveGlobalBtn);

      const viewGlobalBtn = mkBtn('View Global');
      viewGlobalBtn.onclick = () => {
        const pre = document.createElement('pre');
        pre.style.cssText =
          'margin-top:8px;white-space:pre-wrap;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;color:#e5e7eb;font-size:12px;max-height:220px;overflow:auto';
        if (chrome?.storage?.local) {
          chrome.storage.local.get(null, (data) => { pre.textContent = JSON.stringify(data || {}, null, 2); });
        } else {
          const raw = localStorage.getItem('__GLOBAL__');
          pre.textContent = raw || '{}';
        }
        modal.appendChild(pre);
        flashEmoji(viewGlobalBtn, '🟢');
      };
      globalRow.appendChild(viewGlobalBtn);

      const clearGlobalBtn = mkBtn('Clear Global');
      clearGlobalBtn.onclick = () => {
        if (chrome?.storage?.local) {
          chrome.storage.local.clear(() => flashEmoji(clearGlobalBtn, '🟢'));
        } else {
          try { localStorage.removeItem('__GLOBAL__'); flashEmoji(clearGlobalBtn, '🟢'); }
          catch { flashEmoji(clearGlobalBtn, '🔴'); }
        }
      };
      globalRow.appendChild(clearGlobalBtn);

      // ---- Cache/Clearers ----
      const clearers = document.createElement('div');
      clearers.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
      modal.appendChild(clearers);

      const btnLS = mkBtn('Clear LocalStorage');
      btnLS.onclick = () => clearLocalStorage(btnLS);
      clearers.appendChild(btnLS);

      const btnSS = mkBtn('Clear SessionStorage');
      btnSS.onclick = () => clearSessionStorage(btnSS);
      clearers.appendChild(btnSS);

      const btnIDB = mkBtn('Clear IndexedDB');
      btnIDB.onclick = () => clearIndexedDB(btnIDB);
      clearers.appendChild(btnIDB);

      const btnCS = mkBtn('Clear CacheStorage');
      btnCS.onclick = () => clearCacheStorage(btnCS);
      clearers.appendChild(btnCS);

      const btnChrome = mkBtn('Clear Chrome Cache (bg)');
      btnChrome.onclick = () => clearChromeBrowsingData(btnChrome);
      clearers.appendChild(btnChrome);

      const btnAll = mkBtn('Clear ALL (Local/Session/IDB/Cache)');
      btnAll.style.background = '#7f1d1d';
      btnAll.onclick = async () => {
        await clearLocalStorage(btnAll);
        await clearSessionStorage(btnAll);
        await clearIndexedDB(btnAll);
        await clearCacheStorage(btnAll);
        flashEmoji(btnAll, '🟢');
      };
      clearers.appendChild(btnAll);

      // ---- Emoji pad ----
      const emojiTa = document.createElement('textarea');
      emojiTa.placeholder = 'Emojis…';
      emojiTa.style.cssText =
        'width:100%;min-height:80px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px;margin-top:10px';
        emojiTa.value =
        [
          ...[
            '🟠','🟡','🟢','🔵','🟣','🟤','🟥','🟩','🟦','🟧','🟨','🟪','🟫','🔴','⚪','⚫','🟣','🟠','🟡',
            '🔶','🔷','🔳','🔲','🔘','🟣','🟡','🔺','🔻','🔹','🔸'
          ],
          ...[
            '😀','😁','😂','😃','😄','😅','😆','😇','😈','👿','😋','😎','😍','😘','😗','😙','😚','🙂','🙃',
            '🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜',
            '😝','🤓','🧐','🥳','🤠','😤','😡','😠','🤬','🥶','🥵','💀','☠️','🌞','🌝','🌚','🌟','✨','⚡',
            '🔥','💧','🌊','🍀','🌻','🌷','🌹','💐','🌼','🍂','🍁','🍃','🌱','🌲','🌳','🌴','🌵','🌾','🌿',
            '🌺','🍄','🌰','🦋','🐝','🐞','🦗','🐛','🐢','🐍','🦎','🐅','🐆','🦓','🐘','🦏','🐪','🐫','🦙',
            '🐎','🐄','🐖','🐑','🐏','🐐','🦌','🦒','🐕','🐈','🐁','🐇','🐿','🦔','🦢','🦜','🦩','🦚','🦘',
            '🦡','🦥','🦦','🦄','🐉','🦖','🦕','🐳','🐬','🐡','🦑','🐙','🦀','🦞','🐌','🐚','🦠','🦍','🦧',
            '🦨','🐕‍🦺','🐩','🐾'
          ],
          ...[
            '🙅','🚫','🖐','🚥','🚦','🚳','🚷','⛔','👋','📵','🚏','🚭','🚯','🚱','⏹️','✋','❌','❎',
            '🚨','🛑','⏸️','⏯️','🔕','🔇'
          ],
          ...[
            '🤕','🔥','💊','👾','😈','😎','🥸','🎃','👹','👺','😡','🤬','💩','🤡','👽','🤖','🚀','✔️',
            '✪','✤','🎁','⚒','🏠','🍭','🌏','👻','🤠','🤑'
          ],
      
          /* NEW BUTTON / WEBSITE / TECH EMOJIS */
          ...[
            '🖥️','💻','⌨️','🖱️','🖲️','📱','📲','📡','🛰️','💽','💾','💿','📀','🔌','🔋','🔧','🛠️','⚙️',
            '🔩','🔨','🧰','🧲','📂','📁','🗂️','🗄️','💼','📊','📈','📉','📋','📝','🗒️','📄','📃','📑',
            '🔐','🔓','🔏','🔒','🛜','🌐','🕹️','🎮','🧩','🛰️','🧪','🧬','📡','🛜','💡','🔦','🚦','💳',
            '🆙','🆒','🆕','🆓','🔖','🏷️','🔗','🪪','🧾','🧮','💰','💸','💲','💹','🧱','🧵','🧶','📦',
            '📌','📍','📎','🖇️','✂️','🗜️','📐','📏','🧱','🧰','🧯','🥽','🧪','🧬'
          ]
        ].join(' ');
      
      modal.appendChild(emojiTa);

      // ---- Token/Word Counter ----
      modal.appendChild(makeWordCounter());

      
      // ---- Notes (local) ----
      const notes = document.createElement('textarea');
      notes.placeholder = 'Notes…';
      notes.style.cssText =
        'width:100%;min-height:120px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px;margin-top:6px';
      try {
        const prior = localStorage.getItem('q.tools.notes');
        notes.value = prior || 'make install && make up';
      } catch {
        notes.value = 'make install && make up';
      }
      modal.appendChild(notes);

      // auto-test once
      setTimeout(() => testBtn.click(), 0);
    });
  }

  // Expose
  window.QCoreToolsModal = { showToolsModal, copyAllTabUrls, flashEmoji };
})();
