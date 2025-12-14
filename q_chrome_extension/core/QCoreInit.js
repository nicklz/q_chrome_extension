// plugins/QCoreInit.js
(function () {
  if (window.QCoreInit) return;

  const TAG = '%c🛑🟥 QCoreInit';
  const tagStyle = 'background:#b00020;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px';
  const msgStyle = 'color:#b00020;font-weight:bold';

  function logError(message, data) {
    try {
      if (data !== undefined) console.error(TAG, tagStyle, `%c ${message}`, msgStyle, data);
      else console.error(TAG, tagStyle, `%c ${message}`, msgStyle);
    } catch {}
  }

  // Promise that resolves when selector exists (or rejects after timeout)
  function waitForSelector(selector, { timeout = 15000, root = document } = {}) {
    return new Promise((resolve, reject) => {
      const el = root.querySelector(selector);
      if (el) return resolve(el);

      const obs = new MutationObserver(() => {
        const found = root.querySelector(selector);
        if (found) {
          obs.disconnect();
          resolve(found);
        }
      });

      obs.observe(root === document ? document.documentElement : root, {
        childList: true, subtree: true, attributes: false,
      });

      const t = setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);

      // also poll lightly (covers shadowish DOM)
      const iv = setInterval(() => {
        const found = root.querySelector(selector);
        if (found) {
          clearInterval(iv);
          clearTimeout(t);
          obs.disconnect();
          resolve(found);
        }
      }, 250);
    });
  }

  // Promise that resolves when fn() returns a function reference
  function waitForFunction(getter, { timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const v = getter();
        if (typeof v === 'function') return resolve(v);
      } catch {}

      const started = Date.now();
      const iv = setInterval(() => {
        try {
          const v = getter();
          if (typeof v === 'function') {
            clearInterval(iv);
            return resolve(v);
          }
          if (Date.now() - started > timeout) {
            clearInterval(iv);
            reject(new Error('Timeout waiting for function'));
          }
        } catch {
          if (Date.now() - started > timeout) {
            clearInterval(iv);
            reject(new Error('Timeout waiting for function'));
          }
        }
      }, 200);
    });
  }

  // Safe binder: waits for both the element and the handler
  async function bindWhenReady(id, fnGetter, fnName) {
    try {
      console.log(`[Q] ⏳ Waiting for ${fnName} and #${id}...`);
      const [el, handler] = await Promise.all([
        waitForSelector(`#${id}`, { timeout: 1000 }),
        waitForFunction(fnGetter, { timeout: 1000 }),
      ]);

      if (!el) throw new Error(`Element #${id} not found`);
      if (typeof handler !== 'function') throw new Error(`Handler ${fnName} not a function`);

      el.addEventListener('click', handler, { once: false });
      console.log(`[Q] ✅ Bound ${fnName} to #${id}`);
    } catch (e) {
      const msg = `[Q] ❌ Failed to bind ${fnName} → ${e.message}`;
      console.error(msg);
      if (typeof logError === 'function') logError(msg);
    }
  }

  console.log('[Q] QCoreInit loaded inside', window);

  // Bindings — each will patiently wait for both sides to exist.
  bindWhenReady('menu-tools',    () => window?.QCoreToolsModal?.showToolsModal,        'QCoreToolsModal.showToolsModal');
  bindWhenReady('menu-files',    () => window?.QCoreFilesModal?.showFilesModal,        'QCoreFilesModal.showFilesModal');
  bindWhenReady('menu-new',      () => window?.QCoreTicketModal?.showNewTicket,        'QCoreTicketModal.showNewTicket');
  bindWhenReady('menu-play',     () => window?.QCorePlayControls?.playState,           'QCorePlayControls.playState');
  bindWhenReady('menu-pause',    () => window?.QCorePlayControls?.pauseState,          'QCorePlayControls.pauseState');
  bindWhenReady('menu-mute',     () => window?.QCorePlayControls?.muteState,           'QCorePlayControls.muteState');
  bindWhenReady('menu-restart',  () => window?.QCorePlayControls?.restartAll,          'QCorePlayControls.restartAll');
  bindWhenReady('menu-terminal', () => window?.QCoreTerminalModal?.showTerminalModal,  'QCoreTerminalModal.showTerminalModal');
  //bindWhenReady('menu-automate', () => window?.QCoreSkynet.awaitUser,                              'window.QCoreSkynet.awaitUser');
  bindWhenReady('menu-configuration', () => window?.QCoreSettingsModal?.showSettingsModal,  'QCoreSettingsModal.showSettingsModal');
  bindWhenReady('menu-documentation', () => window?.QCoreDocumentation?.showDocumentationModal, 'QCoreDocumentation.showDocumentationModal');


  // Public API
  window.QCoreInit = { logError };
})();
