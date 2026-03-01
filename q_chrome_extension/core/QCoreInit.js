// core/QCoreInit.js
(function () {
  if (window.QCoreInit) return;

  const TAG = '%c🛑🟥 QCoreInit';
  const tagStyle = 'background:#b00020;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px';
  const msgStyle = 'color:#b00020;font-weight:bold';

  function logError(message, data) {
    try {
      if (data !== undefined) console.log(`%c ${message}`, data);
      else console.log(`%c ${message}`);
    } catch {}
  }

  // Promise that resolves when selector exists (or rejects after timeout)
  function waitForSelector(selector, { timeout = 4000, root = document } = {}) {
    return new Promise((resolve, reject) => {
      const get = () => {
        try {
          return root.querySelector(selector);
        } catch {
          return null;
        }
      };

      const immediate = get();
      if (immediate) return resolve(immediate);

      let done = false;
      let t = null;
      let iv = null;
      let obs = null;

      const finish = (err, val) => {
        if (done) return;
        done = true;
        try {
          if (obs) obs.disconnect();
        } catch {}
        try {
          if (t) clearTimeout(t);
        } catch {}
        try {
          if (iv) clearInterval(iv);
        } catch {}
        if (err) reject(err);
        else resolve(val);
      };

      obs = new MutationObserver(() => {
        const found = get();
        if (found) finish(null, found);
      });

      try {
        obs.observe(root === document ? document.documentElement : root, {
          childList: true,
          subtree: true,
          attributes: false,
        });
      } catch {}

      t = setTimeout(() => {
        finish(new Error(`Timeout waiting for ${selector}`));
      }, timeout);

      // Also poll lightly (covers weird DOMs / shadow-ish updates)
      iv = setInterval(() => {
        const found = get();
        if (found) finish(null, found);
      }, 1500);
    });
  }

  // Promise that resolves when fn() returns a function reference
  function waitForFunction(getter, { timeout = 4000 } = {}) {
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
        waitForSelector(`#${id}`, { timeout: 15000 }),
        waitForFunction(fnGetter, { timeout: 15000 }),
      ]);

      if (!el) throw new Error(`Element #${id} not found`);
      if (typeof handler !== 'function') throw new Error(`Handler ${fnName} not a function`);

      el.addEventListener('click', handler, { once: false });
      try { el.disabled = false; el.dataset.qcoreBind = 'ready'; } catch {}
      console.log(`[Q] ✅ Bound ${fnName} to #${id}`);
    } catch (e) {
      const msg = `[Q] ❌ Failed to bind ${fnName} → ${e.message}`;
      // console.error(msg);
      if (typeof logError === 'function') logError(msg);
    }
  }


  
  

  console.log('[Q] QCoreInit loaded inside', window);


  // Public API
  window.QCoreInit = { logError };
})();
