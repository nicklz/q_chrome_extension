(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const safeNowIso = Q.safeNowIso || (() => new Date().toISOString());
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

    // ------------------------------
    // Amazon Products Scrape
    // ------------------------------
  const __AMZ_PRODUCT_QUERIES = [
    //findmeeee get from the file global
  ];

    const __AMZ_CFG = {
      homeUrl: "https://www.amazon.com/",
      searchBoxSel: "#twotabsearchtextbox",
      searchBtnSel: "#nav-search-submit-button",
      nextBtnSel: ".s-pagination-next",
      resultCardSel: 'div.s-main-slot div[data-component-type="s-search-result"]',
      domSettleMs: 500,
      preSubmitDelayMs: 900,
      maxPagesPerQuery: 50,
      maxCardsPerPage: 500,
      modalId: "q_amz_scrape_modal",
      logMax: 500,
      stepDelayMs: 1000,
    };

    function amzHomeUrl(stateObj) {
      try {
        const st = stateObj && typeof stateObj === "object" ? stateObj : (window?.QCoreContent?.getState() || {});
        const amz = st.amazon && typeof st.amazon === "object" ? st.amazon : null;
        const meta = amz && amz.meta && typeof amz.meta === "object" ? amz.meta : null;
        const u = meta && typeof meta.homeUrl === "string" ? meta.homeUrl.trim() : "";
        if (u) return u;
      } catch {}

      // Fall back to current origin if we are on an Amazon host.
      try {
        if (amzIsAmazonHost()) return location.origin.replace(/\/+$/, "") + "/";
      } catch {}

      return __AMZ_CFG.homeUrl;
    }

    const __amzLOGS = [];
    let __amzTickInFlight = false;
    let __amzHeartbeatIv = null;

    function amzNowIso() {
      try {
        return new Date().toISOString();
      } catch {
        return String(Date.now());
      }
    }

    function amzNowStr() {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function amzCssEscapeLite(s) {
      return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    function amzEscapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function amzIsAmazonHost() {
      try {
        const h = String(location.hostname || "").toLowerCase();
        return h === "amazon.com" || h.endsWith(".amazon.com") || h === "www.amazon.com";
      } catch {
        return false;
      }
    }

    function amzSafeJsonParse(s, fallback) {
      try {
        return JSON.parse(s);
      } catch {
        return fallback;
      }
    }


// Global pause guard: if the top-level state.status is "paused", do not run automatically.
// (Some deployments also place status under amazon/meta/progress; we check a few common locations.)
function amzIsStateStatusPaused(stateObj) {
  try {
    const st = stateObj && typeof stateObj === "object" ? stateObj : (window?.QCoreContent?.getState() || {});
    const candidates = [
      st?.status,
      st?.amazon?.status,
      st?.amazon?.meta?.status,
      st?.amazon?.meta?.progress?.status,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        return c.trim().toLowerCase() === "paused";
      }
    }
    return false;
  } catch {
    return false;
  }
}

    // LocalStorage backup for Amazon products to survive QCore state compaction / window.name limits.
    const __AMZ_LS_KEY = "q.amazon.products.v1";

    function amzReadLSProducts() {
      try {
        const raw = localStorage.getItem(__AMZ_LS_KEY);
        if (!raw) return { products: [], meta: {} };
        const obj = JSON.parse(raw);
        const products = Array.isArray(obj?.products) ? obj.products : [];
        const meta = obj?.meta && typeof obj.meta === "object" ? obj.meta : {};
        return { products, meta };
      } catch {
        return { products: [], meta: {} };
      }
    }

    function amzWriteLSProducts(products, meta = {}) {
      try {
        const arr = Array.isArray(products) ? products : [];
        // Guard localStorage quota: keep a rolling tail if needed.
        let toStore = arr;
        let payload = { v: 1, updatedAt: Date.now(), meta: meta && typeof meta === "object" ? meta : {}, products: toStore };
        let json = JSON.stringify(payload);

        // ~4MB soft limit (varies by browser/domain); trim progressively if too big.
        const SOFT = 4_000_000;
        if (json.length > SOFT) {
          const keep = Math.max(200, Math.floor(toStore.length * 0.6));
          toStore = toStore.slice(-keep);
          payload.products = toStore;
          json = JSON.stringify(payload);
        }
        if (json.length > SOFT) {
          toStore = toStore.slice(-200);
          payload.products = toStore;
          json = JSON.stringify(payload);
        }

        localStorage.setItem(__AMZ_LS_KEY, json);
        return true;
      } catch {
        return false;
      }
    }

    function amzBestProducts(memArr, lsArr) {
      const a = Array.isArray(memArr) ? memArr : [];
      const b = Array.isArray(lsArr) ? lsArr : [];
      return b.length > a.length ? b : a;
    }

    function amzEnsureInit() {
      const st = window?.QCoreContent?.getState() || {};

      if (!st.amazon || typeof st.amazon !== "object") st.amazon = {};
      const amz = st.amazon;

      // Canonical array for scraped products (preferred key: amazon.products)
      if (!Array.isArray(amz.products)) amz.products = [];

      // Back-compat / migration from older keys (amazon.items / amazon.data)
      try {
        if (Array.isArray(amz.items) && amz.items.length && amz.items !== amz.products) {
          // Merge items -> products (dedupe by url/asin best-effort)
          const seen = new Set();
          for (const it of amz.products) {
            const k = String(it?.asin || it?.url || "").trim();
            if (k) seen.add(k);
          }
          for (const it of amz.items) {
            const k = String(it?.asin || it?.url || "").trim();
            if (!k || seen.has(k)) continue;
            seen.add(k);
            amz.products.push(it);
          }
        } else if (Array.isArray(amz.items) && amz.items.length && !amz.products.length) {
          amz.products = amz.items;
        }
      } catch {}

      try {
        if (Array.isArray(amz.data) && amz.data.length && !amz.products.length) {
          amz.products = amz.data;
        }
      } catch {}

      // LocalStorage recovery: if the QCore state was compacted/truncated, restore from LS.
      try {
        const ls = amzReadLSProducts();
        const lsProducts = Array.isArray(ls?.products) ? ls.products : [];
        if (lsProducts.length) {
          // Merge LS -> memory with dedupe by canonical URL/ASIN.
          const canon = (u) => {
            try {
              return typeof amzCanonicalProductUrl === "function" ? amzCanonicalProductUrl(u) : String(u || "");
            } catch {
              return String(u || "");
            }
          };
          const seenUrl = new Set();
          const seenAsin = new Set();
          for (const it of amz.products) {
            const asin = it?.asin ? String(it.asin) : "";
            const u = it?.url ? canon(it.url) : "";
            if (asin) seenAsin.add(asin);
            if (u) seenUrl.add(u);
          }
          let merged = 0;
          for (const it of lsProducts) {
            const asin = it?.asin ? String(it.asin) : "";
            const u = it?.url ? canon(it.url) : "";
            if (u && seenUrl.has(u)) continue;
            if (asin && seenAsin.has(asin)) continue;
            amz.products.push(it);
            merged++;
            if (u) seenUrl.add(u);
            if (asin) seenAsin.add(asin);
          }
          if (merged) {
            amz.meta = amz.meta || {};
            amz.meta.recoveredFromLocalStorage = { merged, at: Date.now() };
          }
        }
      } catch {}

      // Keep amazon.items as an alias for backward compatibility
      amz.items = amz.products;
      if (!amz.meta || typeof amz.meta !== "object") amz.meta = {};
      if (!amz.meta.progress || typeof amz.meta.progress !== "object") amz.meta.progress = {};

      const p = amz.meta.progress;

      amz.updatedAt = typeof amz.updatedAt === "string" ? amz.updatedAt : amzNowIso();
      amz.version = Number.isFinite(Number(amz.version)) ? Number(amz.version) : 1;
      amz.createdAt = typeof amz.createdAt === "string" ? amz.createdAt : amzNowIso();

      // runner state
      p.tickId = Number.isFinite(Number(p.tickId)) ? Number(p.tickId) : 0;
      p.running = p.running === true;
      p.paused = p.paused === true;
      p.done = p.done === true;

      p.stage = typeof p.stage === "string" ? p.stage : "idle";
      p.queryIndex = Number.isFinite(Number(p.queryIndex)) ? Math.max(0, Math.floor(Number(p.queryIndex))) : 0;
      p.pageIndex = Number.isFinite(Number(p.pageIndex)) ? Math.max(0, Math.floor(Number(p.pageIndex))) : 0;

      p.lastQuery = typeof p.lastQuery === "string" ? p.lastQuery : "";
      p.lastUrl = typeof p.lastUrl === "string" ? p.lastUrl : "";
      p.lastLog = typeof p.lastLog === "string" ? p.lastLog : "";

      p.startedAt = Number.isFinite(Number(p.startedAt)) ? Number(p.startedAt) : 0;
      p.completedAt = Number.isFinite(Number(p.completedAt)) ? Number(p.completedAt) : 0;
      p.updatedAt = typeof p.updatedAt === "string" ? p.updatedAt : amzNowIso();

      // Persist the "home" origin to avoid cross-subdomain localStorage loss (www/smile/etc).
      try {
        const curHome = amzIsAmazonHost()
          ? location.origin.replace(/\/+$/, "") + "/"
          : __AMZ_CFG.homeUrl;

        if (amzIsAmazonHost()) {
          // Always follow the current Amazon origin while on Amazon.
          amz.meta.homeUrl = curHome;
        } else {
          // Off Amazon: keep the last known homeUrl, or set default.
          if (!amz.meta.homeUrl || typeof amz.meta.homeUrl !== "string") amz.meta.homeUrl = curHome;
        }
      } catch {}

      // Optional persisted logs (small tail)
      if (!Array.isArray(amz.meta.logs)) amz.meta.logs = [];

      // Query config (lets you change list later without losing enable toggles)
      if (!amz.meta.queryConfig || typeof amz.meta.queryConfig !== "object") {
        amz.meta.queryConfig = {
          queries: __AMZ_PRODUCT_QUERIES.slice(),
          enabled: __AMZ_PRODUCT_QUERIES.map(() => true),
        };
      } else {
        const qc = amz.meta.queryConfig;
        if (!Array.isArray(qc.queries) || !qc.queries.length) qc.queries = __AMZ_PRODUCT_QUERIES.slice();
        if (!Array.isArray(qc.enabled)) qc.enabled = qc.queries.map(() => true);
        if (qc.enabled.length !== qc.queries.length) {
          const next = qc.queries.map((_, i) => (typeof qc.enabled[i] === "boolean" ? qc.enabled[i] : true));
          qc.enabled = next;
        }
      }

      st.amazon = amz;
      window?.QCoreContent?.setState(st);
      return st;
    }

    function amzModalWanted() {
      try {
        // IMPORTANT: do NOT call amzEnsureInit() here (it writes/compacts state).
        // We only need to read whether the user hid the modal.
        const st = window?.QCoreContent?.getState() || {};
        const amz = st.amazon && typeof st.amazon === "object" ? st.amazon : {};
        const meta = amz.meta && typeof amz.meta === "object" ? amz.meta : {};
        return !(meta.uiHidden === true);
      } catch {
        return true;
      }
    }

  function amzEnsureModal() {
    if (!amzModalWanted()) return;

    // If the modal exists but is missing key controls (can happen after SPA/DOM churn), rebuild it.
    const existing = document.getElementById(__AMZ_CFG.modalId);
    if (existing) {
      const neededIds = [
        `${__AMZ_CFG.modalId}_start`,
        `${__AMZ_CFG.modalId}_pause`,
        `${__AMZ_CFG.modalId}_dl`,
        `${__AMZ_CFG.modalId}_reset`,
        `${__AMZ_CFG.modalId}_countTop`,
      ];

      const ok = neededIds.every((id) => !!document.getElementById(id));
      if (ok) return;

      try { existing.remove(); } catch {}
    }

    // Ensure we never leave a stale style tag behind (duplicate IDs cause weird UI issues)
    try {
      const stEl = document.getElementById(`${__AMZ_CFG.modalId}_style`);
      if (stEl) stEl.remove();
    } catch {}

    const style = document.createElement("style");
    style.id = `${__AMZ_CFG.modalId}_style`;
    style.textContent = `
      #${__AMZ_CFG.modalId}{
        position:fixed; z-index:2147483647; /* keep header/buttons above Amazon UI */ top:16px; right:16px;
        width:420px; max-width:calc(100vw - 32px);
        height:560px; max-height:calc(100vh - 32px);
        background:rgba(10,10,12,.92);
        color:#eaeaea;
        border:1px solid rgba(255,255,255,.12);
        border-radius:14px;
        box-shadow:0 20px 60px rgba(0,0,0,.55);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        overflow:hidden;
        display:flex; flex-direction:column;
      }
      #${__AMZ_CFG.modalId} .qhdr{
        display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:10px;
        padding:10px 12px;
        border-bottom:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.04);
      }
      #${__AMZ_CFG.modalId} .qtitle{
        font-size:13px; font-weight:700; letter-spacing:.2px;
        display:flex; flex-direction:column; gap:2px;
      }
      #${__AMZ_CFG.modalId} .qsub{ font-size:11px; font-weight:600; opacity:.75; }
      #${__AMZ_CFG.modalId} .qbtns{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; max-width:100%; }
      #${__AMZ_CFG.modalId} button{
        all:unset; cursor:pointer;
        padding:7px 10px; border-radius:10px;
        font-size:12px; font-weight:700;
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.06);
        user-select:none;
      }
      #${__AMZ_CFG.modalId} button:hover{ background:rgba(255,255,255,.10); }
      #${__AMZ_CFG.modalId} button:active{ transform:translateY(1px); }
      #${__AMZ_CFG.modalId} .qbody{
        padding:10px 12px;
        flex:1 1 auto; min-height:0;
        display:flex; flex-direction:column; gap:10px;
      }
      #${__AMZ_CFG.modalId} .qstats{
        display:grid; grid-template-columns:1fr 1fr; gap:8px;
      }
      #${__AMZ_CFG.modalId} .qstat{
        padding:8px 10px; border-radius:12px;
        border:1px solid rgba(255,255,255,.10);
        background:rgba(255,255,255,.04);
      }
      #${__AMZ_CFG.modalId} .qstat .k{ font-size:11px; font-weight:800; opacity:.7; }
      #${__AMZ_CFG.modalId} .qstat .v{ font-size:13px; font-weight:800; margin-top:2px; }
      #${__AMZ_CFG.modalId} .qlog{
        flex:1;
        border:1px solid rgba(255,255,255,.10);
        background:rgba(0,0,0,.20);
        border-radius:12px;
        overflow:auto;
        padding:8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size:11px;
        line-height:1.35;
      }
      #${__AMZ_CFG.modalId} .qline{ white-space:pre-wrap; word-break:break-word; }
      #${__AMZ_CFG.modalId} .qfoot{ display:flex; gap:8px; }
      #${__AMZ_CFG.modalId} .qfoot button{ flex:1; text-align:center; }
    `;
    document.documentElement.appendChild(style);

    const modal = document.createElement("div");
    modal.id = __AMZ_CFG.modalId;
    modal.innerHTML = `
      <div class="qhdr">
        <div class="qtitle">
          <div>Amazon Scraper</div>
          <div class="qsub">
            <span id="${__AMZ_CFG.modalId}_countTop">0 products</span>
            <span style="opacity:.65">•</span>
            <span id="${__AMZ_CFG.modalId}_sub">idle</span>
          </div>
        </div>
        <div class="qbtns">
          <button id="${__AMZ_CFG.modalId}_start">Start</button>
          <button id="${__AMZ_CFG.modalId}_pause">Pause</button>
          <button id="${__AMZ_CFG.modalId}_dl">Export</button>
          <button id="${__AMZ_CFG.modalId}_reset">Reset</button>
          <button id="${__AMZ_CFG.modalId}_close">×</button>
        </div>
      </div>
      <div class="qbody">
        <div class="qstats">
          <div class="qstat"><div class="k">Query</div><div class="v" id="${__AMZ_CFG.modalId}_q">-</div></div>
          <div class="qstat"><div class="k">Page</div><div class="v" id="${__AMZ_CFG.modalId}_p">-</div></div>
          <div class="qstat"><div class="k">Items saved</div><div class="v" id="${__AMZ_CFG.modalId}_n">0</div></div>
          <div class="qstat"><div class="k">Last merge</div><div class="v" id="${__AMZ_CFG.modalId}_m">-</div></div>
        </div>
        <div class="qlog" id="${__AMZ_CFG.modalId}_log"></div>
        <div class="qfoot">
          <button id="${__AMZ_CFG.modalId}_clear">Clear logs</button>
          <button id="${__AMZ_CFG.modalId}_refresh">Refresh stats</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const startBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_start`);
    const pauseBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_pause`);
    const dlBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_dl`);
    const resetBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_reset`);
    const clearBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_clear`);
    const refreshBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_refresh`);
    const closeBtn = modal.querySelector(`#${__AMZ_CFG.modalId}_close`);

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        amzStart();
        amzRefreshStats();
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener("click", () => {
        amzPause();
        amzRefreshStats();
      });
    }

    dlBtn.addEventListener("click", () => {
      amzDownloadStateAmazonJson();
    });

    resetBtn.addEventListener("click", () => {
      const st = window?.QCoreContent?.getState() || {};
      st.amazon = st.amazon && typeof st.amazon === "object" ? st.amazon : {};

      // reset scraped data
      st.amazon.products = [];
      st.amazon.items = st.amazon.products; // alias
      try { localStorage.removeItem(__AMZ_LS_KEY); } catch {}

      // reset meta/progress
      st.amazon.meta = st.amazon.meta && typeof st.amazon.meta === "object" ? st.amazon.meta : {};
      st.amazon.meta.progress = {
        running: false,
        paused: false,
        done: false,
        stage: "idle",
        queryIndex: 0,
        pageIndex: 0,
        lastQuery: "",
        lastUrl: "",
        lastLog: "",
        tickId: 0,
        startedAt: 0,
        completedAt: 0,
        updatedAt: amzNowIso(),
      };
      st.amazon.meta.uiHidden = false;
      st.amazon.meta.logs = [];
      st.amazon.updatedAt = amzNowIso();

      window?.QCoreContent?.setState(st);
      __amzLOGS.length = 0;
      amzRefreshStats();
      amzRenderLogs();
      amzLog("amazon state reset");
    });

    clearBtn.addEventListener("click", () => {
      __amzLOGS.length = 0;
      amzRenderLogs();
      amzLog("logs cleared");
    });

    refreshBtn.addEventListener("click", () => {
      amzRefreshStats();
      amzLog("stats refreshed");
    });

    closeBtn.addEventListener("click", () => {
      modal.remove();
      const stEl = document.getElementById(`${__AMZ_CFG.modalId}_style`);
      if (stEl) stEl.remove();
    });

    amzRefreshStats();
    amzRenderLogs();
  }


    function amzRenderLogs() {
      if (!amzModalWanted()) return;
      const el = document.getElementById(`${__AMZ_CFG.modalId}_log`);
      if (!el) return;
      el.innerHTML = __amzLOGS
        .map((l) => {
          const m = l.replace(/^\[[^\]]+\]\s*/, "");
          const t = l.match(/^\[([^\]]+)\]/)?.[1] || "";
          return `<div class="qline"><span class="t">[${t}]</span> <span class="m">${amzEscapeHtml(m)}</span></div>`;
        })
        .join("");
    }

    function amzLog(msg, extra) {
      const line = `[${amzNowStr()}] ${msg}`;
      try {
        console.log("🛒✅ [AmazonScrape]", msg, extra || "");
      } catch {}

      __amzLOGS.push(line);
      while (__amzLOGS.length > __AMZ_CFG.logMax) __amzLOGS.shift();

      // Persist a tiny tail for continuity (and for modal subtitle)
      try {
        const st = amzEnsureInit();
        const amz = st.amazon;
        amz.updatedAt = amzNowIso();
        if (amz?.meta?.progress) {
          amz.meta.progress.lastLog = msg;
          amz.meta.progress.updatedAt = amzNowIso();
        }
        if (Array.isArray(amz?.meta?.logs)) {
          amz.meta.logs.push(line);
          if (amz.meta.logs.length > 200) amz.meta.logs = amz.meta.logs.slice(-200);
        }
        window?.QCoreContent?.setState(st);
      } catch {}

      if (amzModalWanted()) {
        amzEnsureModal();
        amzRenderLogs();
        const el = document.getElementById(`${__AMZ_CFG.modalId}_log`);
        if (el) el.scrollTop = el.scrollHeight;
      }
    }

    function amzRefreshStats(stOverride) {
      if (!amzModalWanted()) return;
      amzEnsureModal();
      const st = (stOverride && typeof stOverride === "object") ? stOverride : amzEnsureInit();

      const ls = amzReadLSProducts();
      const pMem = st.amazon?.meta?.progress || {};
      const pLS = (ls?.meta?.progress && typeof ls.meta.progress === "object") ? ls.meta.progress : {};
      const p = Number(pMem?.tickId || 0) >= Number(pLS?.tickId || 0) ? pMem : pLS;

      const lastMerge = st.amazon?.meta?.lastMerge || ls?.meta?.lastMerge || null;
      const a = Array.isArray(st.amazon?.products) ? st.amazon.products : [];
      const b = Array.isArray(st.amazon?.items) ? st.amazon.items : [];
      const items = amzBestProducts(amzBestProducts(b, a), ls.products);

      const qEl = document.getElementById(`${__AMZ_CFG.modalId}_q`);
      const pEl = document.getElementById(`${__AMZ_CFG.modalId}_p`);
      const nEl = document.getElementById(`${__AMZ_CFG.modalId}_n`);
      const mEl = document.getElementById(`${__AMZ_CFG.modalId}_m`);

      // NEW: show total product count in the header (requested)
      const countTopEl = document.getElementById(`${__AMZ_CFG.modalId}_countTop`);

      const subEl = document.getElementById(`${__AMZ_CFG.modalId}_sub`);
      const startBtn = document.getElementById(`${__AMZ_CFG.modalId}_start`);
      const pauseBtn = document.getElementById(`${__AMZ_CFG.modalId}_pause`);

      const total = Array.isArray(items) ? items.length : 0;
      const running = pMem.running === true && pMem.paused !== true && pMem.done !== true;

      const urlQ = (() => { try { const u = new URL(location.href); return String(u.searchParams.get("k") || "").trim(); } catch { return ""; } })();
      if (qEl) qEl.textContent = p.lastQuery || urlQ || "-";
      const page0 = Number.isFinite(Number(p.pageIndex)) ? Number(p.pageIndex) : amzPageIndexFromUrl();
      const page1 = Number.isFinite(page0) ? page0 + 1 : NaN;
      if (pEl) pEl.textContent = Number.isFinite(page1) ? String(page1) : "-";
      if (nEl) nEl.textContent = String(total || 0);
      if (mEl) mEl.textContent = lastMerge ? `${lastMerge.added} added` : "-";

      if (countTopEl) countTopEl.textContent = `${total || 0} products`;

      if (subEl) {
        if (pMem.done) subEl.textContent = "done";
        else if (pMem.paused) subEl.textContent = "paused";
        else if (pMem.running) subEl.textContent = pMem.lastUrl ? pMem.lastUrl : (p.lastUrl ? p.lastUrl : "running…");
        else subEl.textContent = "idle";
      }

      // Keep the header controls stable so they never "vanish" (requested)
      if (startBtn) startBtn.textContent = running ? "Running…" : (pMem.paused ? "Resume" : "Start");
      if (pauseBtn) {
        pauseBtn.textContent = "Pause";
        pauseBtn.style.opacity = running ? "1" : "0.6";
        pauseBtn.style.pointerEvents = running ? "auto" : "none";
      }
    }

    function amzDownloadStateAmazonJson() {
      const st = amzEnsureInit();
      const payload = {
        exportedAt: new Date().toISOString(),
        source: "amazon",
        meta: st.amazon?.meta || {},
        products: (() => {
          const a = Array.isArray(st.amazon?.products) ? st.amazon.products : [];
          const b = Array.isArray(st.amazon?.items) ? st.amazon.items : [];
          return b.length > a.length ? b : a;
        })(),
        items: st.amazon?.items || st.amazon?.products || [],
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = amzCssEscapeLite((st.amazon?.meta?.progress?.lastQuery || "amazon_scrape").slice(0, 60));
      a.href = url;
      a.download = __qcoreMakeScrapeFilename("amazon", "json");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      amzLog(`downloaded JSON (${(payload.products || payload.items || []).length} items)`);
    }

    // ----------------------------
    // Timing / waiting helpers
    // ----------------------------
    const amzSleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function amzWaitForSelector(sel, { timeoutMs = 15000, pollMs = 100 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const el = document.querySelector(sel);
        if (el) return el;
        await amzSleep(pollMs);
      }
      return null;
    }

    async function amzWaitForAnySelector(sels, { timeoutMs = 15000, pollMs = 100 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) return { sel, el };
        }
        await amzSleep(pollMs);
      }
      return null;
    }

    async function amzWaitForUrlChange(fromUrl, { timeoutMs = 20000, pollMs = 100 } = {}) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (location.href !== fromUrl) return true;
        await amzSleep(pollMs);
      }
      return false;
    }

    // ----------------------------
    // URL checks
    // ----------------------------
    function amzIsSearchResultsUrl() {
      const u = new URL(location.href);
      const hasK = u.searchParams.has("k") && (u.searchParams.get("k") || "").trim().length > 0;
      const isSPath = u.pathname === "/s";
      return hasK || isSPath;
    }

    function amzUrlQueryMatches(desiredQuery) {
      try {
        const u = new URL(location.href);
        const k = (u.searchParams.get("k") || "").trim();
        if (!k) return false;
        const norm = (s) =>
          String(s || "")
            .toLowerCase()
            .replace(/\+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return norm(k) === norm(desiredQuery);
      } catch {
        return false;
      }
    }

    function amzAbsUrl(href) {
      if (!href) return null;
      try {
        return new URL(href, location.origin).toString();
      } catch {
        return null;
      }
    }

    // Canonicalize Amazon product URLs so we can dedupe reliably across tracking params / variations.
    function amzCanonicalProductUrl(url) {
      try {
        const u = new URL(String(url || ""), location.origin);
        u.hash = "";

        // Normalize to /dp/ASIN when possible
        const m =
          u.pathname.match(/\/dp\/([A-Z0-9]{10})/i) ||
          u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
          u.pathname.match(/\/product\/([A-Z0-9]{10})/i);

        if (m && m[1]) return `${u.origin}/dp/${String(m[1]).toUpperCase()}`;

        // Otherwise drop query params for stability
        return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
      } catch {
        try {
          return String(url || "").split("#")[0].split("?")[0].trim();
        } catch {
          return String(url || "");
        }
      }
    }

    function amzTextOrNull(el) {
      if (!el) return null;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return t || null;
    }

    function amzGetImageInfo(card) {
      const img = card.querySelector("img.s-image") || card.querySelector("img");
      if (!img) return { image: null, imageSrcset: null, imageAlt: null };
      return {
        image: img.getAttribute("src") || null,
        imageSrcset: img.getAttribute("srcset") || null,
        imageAlt: img.getAttribute("alt") || null,
      };
    }

    function amzGetPriceInfo(card) {
      const whole = card.querySelector(".a-price .a-price-whole");
      const frac = card.querySelector(".a-price .a-price-fraction");
      const sym = card.querySelector(".a-price .a-price-symbol");
      const offscreen = card.querySelector(".a-price .a-offscreen");
      const strike = card.querySelector(".a-text-price .a-offscreen");

      const priceText =
        (offscreen && amzTextOrNull(offscreen)) ||
        (() => {
          const w = amzTextOrNull(whole);
          const f = amzTextOrNull(frac);
          const s = amzTextOrNull(sym) || "$";
          if (w && f) return `${s}${w.replace(/[^\d]/g, "")}.${f.replace(/[^\d]/g, "")}`;
          if (w) return `${s}${w.replace(/[^\d]/g, "")}`;
          return null;
        })();

      return { price: priceText, priceStrike: strike ? amzTextOrNull(strike) : null };
    }

    function amzGetRatingInfo(card) {
      const rating = card.querySelector('[aria-label*="out of 5 stars"]');
      const reviews = card.querySelector('a[href*="#customerReviews"] span') || card.querySelector("span.a-size-base.s-underline-text");
      return {
        ratingText: rating ? rating.getAttribute("aria-label") || null : null,
        reviewCountText: reviews ? amzTextOrNull(reviews) : null,
      };
    }

    function amzGetBadgesAndAttributes(card) {
      const attrs = [];
      const badgeEls = card.querySelectorAll(
        [
          ".a-badge-text",
          ".a-badge-label",
          ".a-color-state",
          ".a-row.a-size-base.a-color-secondary",
          ".a-row.a-size-base.a-color-base",
          ".a-section.a-spacing-none.a-spacing-top-small",
        ].join(",")
      );

      badgeEls.forEach((el) => {
        const t = amzTextOrNull(el);
        if (t) attrs.push(t);
      });

      const coupon = card.querySelector("span.a-color-success") || card.querySelector('[data-a-strategy="coupon"]');
      const couponText = amzTextOrNull(coupon);
      if (couponText) attrs.push(couponText);

      const prime = card.querySelector('i[aria-label="Prime"]') || card.querySelector(".s-prime");
      if (prime) attrs.push("Prime");

      const sponsored = card.querySelector('span[aria-label="Sponsored"]') || card.querySelector("span.puis-sponsored-label-text");
      if (sponsored) attrs.push("Sponsored");

      const seen = new Set();
      const out = [];
      for (const a of attrs) {
        const key = a.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
      return out.slice(0, 30);
    }

    function amzGetProductLink(card) {
      if (!card) return null;
      try {
        const a =
          card.querySelector('a.a-link-normal.s-no-outline') ||
          card.querySelector('a.a-link-normal[href*="/dp/"]') ||
          card.querySelector('a[href*="/dp/"]') ||
          card.querySelector("a.a-link-normal") ||
          card.querySelector("a[href]");

        const href = a?.getAttribute?.("href") || "";
        if (!href) return null;

        const abs = amzAbsUrl(href);
        return abs ? amzCanonicalProductUrl(abs) : null;
      } catch {
        return null;
      }
    }

    function amzGetTitle(card) {
      const h2 = card.querySelector("h2");
      const t = amzTextOrNull(h2);
      if (t) return t;
      const img = card.querySelector("img.s-image");
      return img ? img.getAttribute("alt") || null : null;
    }

    function amzGetAsin(card) {
      return card.getAttribute("data-asin") || null;
    }

    function amzPageIndexFromUrl() {
      try {
        const u = new URL(location.href);
        const p = parseInt(u.searchParams.get("page") || "1", 10);
        if (Number.isFinite(p) && p > 0) return p - 1;
        return 0;
      } catch {
        return 0;
      }
    }

    function amzScrapeCardsForPage(query, pageIndex) {
      const cards = Array.from(document.querySelectorAll(__AMZ_CFG.resultCardSel)).slice(0, __AMZ_CFG.maxCardsPerPage);
      const items = [];
      for (const card of cards) {
        const asin = amzGetAsin(card);
        const url = amzGetProductLink(card);
        const title = amzGetTitle(card);
        const img = amzGetImageInfo(card);
        const price = amzGetPriceInfo(card);
        const rating = amzGetRatingInfo(card);
        const attributes = amzGetBadgesAndAttributes(card);

        if (!asin && !url && !title) continue;

        items.push({
          source: "amazon",
          query,
          pageIndex,
          scrapedAt: Date.now(),
          asin,
          title,
          url,
          image: img.image,
          imageSrcset: img.imageSrcset,
          imageAlt: img.imageAlt,
          price: price.price,
          priceStrike: price.priceStrike,
          ratingText: rating.ratingText,
          reviewCountText: rating.reviewCountText,
          attributes,
        });
      }
      return items;
    }

    function amzMergeIntoState(newItems, stOverride) {
      const st = (stOverride && typeof stOverride === "object") ? stOverride : amzEnsureInit();

      // Canonical store: state.amazon.products (array of full product records).
      if (!st.amazon || typeof st.amazon !== "object") st.amazon = {};
      if (!Array.isArray(st.amazon.products)) st.amazon.products = [];

      // Keep items as an alias for backward compatibility.
      st.amazon.items = st.amazon.products;

      const existing = st.amazon.products;

      const seenUrl = new Set();
      const seenAsin = new Set();

      for (const it of existing) {
        const asin = it && it.asin ? String(it.asin) : "";
        const canonUrl = it && it.url ? amzCanonicalProductUrl(it.url) : "";
        if (asin) seenAsin.add(asin);
        if (canonUrl) seenUrl.add(canonUrl);
      }

      let added = 0;
      for (const raw of newItems || []) {
        if (!raw || typeof raw !== "object") continue;

        const asin = raw.asin ? String(raw.asin) : "";
        const canonUrl = raw.url ? amzCanonicalProductUrl(raw.url) : "";

        // Requested: if url matches, skip (no duplicates).
        if (canonUrl && seenUrl.has(canonUrl)) continue;

        // Also dedupe by ASIN when available.
        if (asin && seenAsin.has(asin)) continue;

        const it = { ...raw };

        // Normalize URL to canonical form (stable dedupe)
        if (canonUrl) it.url = canonUrl;

        existing.push(it);
        added++;

        if (canonUrl) seenUrl.add(canonUrl);
        if (asin) seenAsin.add(asin);
      }

      st.amazon.products = existing;
      st.amazon.items = st.amazon.products; // keep alias in sync

      st.amazon.updatedAt = amzNowIso();
      st.amazon.meta = st.amazon.meta || {};
      st.amazon.meta.lastMerge = { added, total: existing.length, at: Date.now() };
      window?.QCoreContent?.setState(st);

      // Also persist to localStorage to survive state compaction/window.name limits.
      try {
        amzWriteLSProducts(existing, { lastMerge: st.amazon?.meta?.lastMerge || null, progress: st.amazon?.meta?.progress || null });
      } catch {}

      amzRefreshStats(st);
      return added;
    }

    // ----------------------------
    // Search / navigation actions
    // ----------------------------
    async function amzDoSearchIfNeeded(query) {
      // If already on results for THIS query, skip.
      if (amzIsSearchResultsUrl() && amzUrlQueryMatches(query)) {
        amzLog(`already on results page for query (k=): "${query}"`, { href: location.href });
        return true;
      }

      const box = await amzWaitForSelector(__AMZ_CFG.searchBoxSel, { timeoutMs: 15000 });
      const btn = await amzWaitForSelector(__AMZ_CFG.searchBtnSel, { timeoutMs: 15000 });
      if (!box || !btn) {
        amzLog("search box or submit button not found");
        return false;
      }

      box.focus();
      box.click();
      box.value = query;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));

      amzLog(`typed query: "${query}"`);
      await amzSleep(__AMZ_CFG.preSubmitDelayMs);

      const before = location.href;
      btn.click();
      amzLog("clicked submit");

      await amzWaitForUrlChange(before, { timeoutMs: 20000 });
      await amzSleep(__AMZ_CFG.domSettleMs);

      amzLog(`navigated to: ${location.href}`);
      return true;
    }

    async function amzWaitForResultsToRender() {
      const found = await amzWaitForAnySelector([__AMZ_CFG.resultCardSel, "#search", "div.s-main-slot"], { timeoutMs: 20000 });
      if (!found) {
        amzLog("results container not found (timeout)");
        return false;
      }
      await amzSleep(__AMZ_CFG.domSettleMs);
      return true;
    }

    function amzNextButtonIsDisabled() {
      const next = document.querySelector(__AMZ_CFG.nextBtnSel);
      if (!next) return true;
      const aria = next.getAttribute("aria-disabled");
      if (aria && aria.toLowerCase() === "true") return true;
      if (next.classList.contains("s-pagination-disabled")) return true;
      return false;
    }

    async function amzClickNextPage() {
      const next = document.querySelector(__AMZ_CFG.nextBtnSel);
      if (!next) {
        amzLog("next button not found");
        return false;
      }
      const aria = next.getAttribute("aria-disabled");
      if (aria && aria.toLowerCase() === "true") {
        amzLog("next button aria-disabled=true (end)");
        return false;
      }

      const before = location.href;
      next.scrollIntoView({ block: "center" });
      next.click();
      amzLog("clicked next page");

      await amzWaitForUrlChange(before, { timeoutMs: 20000 });
      await amzSleep(__AMZ_CFG.domSettleMs);
      amzLog(`page changed to: ${location.href}`);
      return true;
    }

    function amzGetEnabledQueries(st) {
      try {
        const qc = st.amazon?.meta?.queryConfig;
        const queries = Array.isArray(qc?.queries) ? qc.queries : __AMZ_PRODUCT_QUERIES;
        const enabled = Array.isArray(qc?.enabled) ? qc.enabled : queries.map(() => true);

        const out = [];
        for (let i = 0; i < queries.length; i++) {
          if (enabled[i] === false) continue;
          const q = String(queries[i] || "").trim();
          if (q) out.push(q);
        }
        return out.length ? out : __AMZ_PRODUCT_QUERIES.slice();
      } catch {
        return __AMZ_PRODUCT_QUERIES.slice();
      }
    }

    function amzEnsureHeartbeat() {
      try {
        if (__amzHeartbeatIv) return;
        __amzHeartbeatIv = setInterval(() => {
          try {
            const st = amzEnsureInit();
            if (amzIsStateStatusPaused(st)) return;
            const p = st.amazon?.meta?.progress || {};
            if (!p.running || p.paused || p.done) return;
            amzAutoTick("heartbeat");
          } catch {}
        }, __AMZ_CFG.stepDelayMs);
      } catch {}
    }

    function amzStopHeartbeat() {
      try {
        if (!__amzHeartbeatIv) return;
        clearInterval(__amzHeartbeatIv);
        __amzHeartbeatIv = null;
      } catch {}
    }

    function amzStart() {
      const st = amzEnsureInit();
      const p = st.amazon.meta.progress;

      // Lock state while the runner is active so redirects/other init code cannot wipe totals.
      try {
        st.locked = true;
        st.lockedBy = "amazon";
      } catch {}

      p.tickId = Number(p.tickId || 0) + 1;
      p.running = true;
      p.paused = false;
      p.done = false;
      p.stage = "run";
      p.startedAt = p.startedAt || Date.now();
      p.updatedAt = amzNowIso();

      st.amazon.updatedAt = amzNowIso();

      // unhide UI on explicit start
      try {
        if (st.amazon?.meta) st.amazon.meta.uiHidden = false;
      } catch {}

      window?.QCoreContent?.setState(st);

      amzEnsureModal();
      amzRefreshStats();
      amzLog("🚀 start / resume", { href: location.href });

      amzEnsureHeartbeat();

      // If not on Amazon, jump there; auto-boot continues the loop.
      try {
        if (!amzIsAmazonHost()) {
          amzLog("↪️ Not on amazon.com — redirecting to Amazon home", { to: amzHomeUrl(typeof st !== "undefined" ? st : null) });
          location.href = amzHomeUrl(typeof st !== "undefined" ? st : null);
          return;
        }
      } catch {}

      setTimeout(() => amzAutoTick("start_btn"), 250);
    }

    function amzPause() {
      const st = amzEnsureInit();
      const p = st.amazon.meta.progress;

      p.tickId = Number(p.tickId || 0) + 1;
      p.paused = true;
      p.running = false;
      p.stage = "paused";
      p.updatedAt = amzNowIso();

      st.amazon.updatedAt = amzNowIso();
      // Allow this wipe even if state is locked.
      try { st.lockedOverride = true; } catch {}
      window?.QCoreContent?.setState(st);

      amzStopHeartbeat();
      amzRefreshStats();
      amzLog("⏸️ paused");
    }

    async function amzAutoTick(reason = "tick") {
      if (__amzTickInFlight) return;
      __amzTickInFlight = true;

      try {
        const st0 = amzEnsureInit();
        if (amzIsStateStatusPaused(st0)) {
          // Respect global pause: do not run ticks automatically.
          amzRefreshStats();
          return;
        }
        const p0 = st0.amazon?.meta?.progress || {};
        if (!p0.running || p0.paused || p0.done) {
          amzStopHeartbeat();
          amzRefreshStats();
          return;
        }

        // Keep modal visible while running (unless user closed it)
        if (amzModalWanted()) {
          try {
            amzEnsureModal();
            const modal = document.getElementById(__AMZ_CFG.modalId);
            if (modal) modal.style.display = "block";
          } catch {}
        }

        const st = amzEnsureInit();
        const p = st.amazon.meta.progress;

        // Requested: refresh the page every 100s (export first), with a 50s wait before reload.
        try {
          const pr = __qcoreMaybePlanForcedRefresh({
            runner: p,
            exportFn: () => {
              try {
                amzDownloadStateAmazonJson();
              } catch {}
            },
            note: "amazon",
          });
          if (pr && pr.pending) {
            try {
              p.stage = "force_refresh_wait";
              p.updatedAt = amzNowIso();
              st.amazon.updatedAt = amzNowIso();
              window?.QCoreContent?.setState(st);
              amzLog("♻️ Forced refresh planned — downloaded JSON, reloading in 50s");
              amzRefreshStats();
            } catch {}
            return;
          }
        } catch {}

        // Lock state while the runner is active so redirects/other init code cannot wipe totals.
        try {
          st.locked = true;
          st.lockedBy = "amazon";
        } catch {}
        const enabledQueries = amzGetEnabledQueries(st);

        // End condition
        if (p.queryIndex >= enabledQueries.length) {
          p.running = false;
          p.paused = false;
          p.done = true;
          p.stage = "done";
          p.completedAt = Date.now();
          p.updatedAt = amzNowIso();
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);
          amzStopHeartbeat();
          amzRefreshStats();
          amzLog("✅ done — all queries complete");
          return;
        }

        // Ensure we're on Amazon
        if (!amzIsAmazonHost()) {
          p.stage = "redirect_home";
          p.lastUrl = location.href;
          p.updatedAt = amzNowIso();
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);
          amzLog("↪️ redirecting to Amazon home (not on amazon.com)", { to: amzHomeUrl(typeof st !== "undefined" ? st : null), from: location.href });
          location.href = amzHomeUrl(typeof st !== "undefined" ? st : null);
          return;
        }

        const query = enabledQueries[p.queryIndex] || enabledQueries[0] || __AMZ_PRODUCT_QUERIES[0];
        p.lastQuery = query;
        p.lastUrl = location.href;
        p.updatedAt = amzNowIso();
        st.amazon.updatedAt = amzNowIso();
        window?.QCoreContent?.setState(st);

        amzRefreshStats();
        amzLog(`🔁 tick → ${reason}`, { queryIndex: p.queryIndex, href: location.href });

        // If we're not on search results for this query, do the search.
        if (!amzIsSearchResultsUrl() || !amzUrlQueryMatches(query)) {
          p.stage = "search";
          p.updatedAt = amzNowIso();
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);

          // If we're on some random Amazon page, go home first (keeps selectors stable)
          if (!location.pathname || location.pathname !== "/" && location.pathname !== "/s") {
            amzLog("🏠 navigating to homepage to run search", { to: amzHomeUrl(typeof st !== "undefined" ? st : null) });
            location.href = amzHomeUrl(typeof st !== "undefined" ? st : null);
            return;
          }

          const okSearch = await amzDoSearchIfNeeded(query);
          if (!okSearch) {
            amzLog("❌ search failed; retrying shortly");
            setTimeout(() => amzAutoTick("retry_search"), 1500);
            return;
          }

          // Next tick will scrape.
          setTimeout(() => amzAutoTick("after_search"), 900);
          return;
        }

        // Results page: wait for cards.
        p.stage = "wait_results";
        p.updatedAt = amzNowIso();
        st.amazon.updatedAt = amzNowIso();
        window?.QCoreContent?.setState(st);

        const okResults = await amzWaitForResultsToRender();
        if (!okResults) {
          amzLog("⏳ results not rendered; retrying");
          setTimeout(() => amzAutoTick("retry_results"), 1500);
          return;
        }

        // Scrape + merge
        const pageIndex = amzPageIndexFromUrl();
        p.pageIndex = pageIndex;
        p.stage = "scrape";
        p.updatedAt = amzNowIso();
        st.amazon.updatedAt = amzNowIso();
        window?.QCoreContent?.setState(st);

        const pageItems = amzScrapeCardsForPage(query, pageIndex);
        const added = amzMergeIntoState(pageItems, st);
        amzLog(`🧲 scraped cards: ${pageItems.length}, added: ${added}`, { pageIndex });

        // Next page / next query
        if (amzNextButtonIsDisabled() || pageIndex >= __AMZ_CFG.maxPagesPerQuery - 1) {
          amzLog("➡️ end of pagination — moving to next query");
          p.queryIndex = p.queryIndex + 1;
          p.pageIndex = 0;
          p.stage = "next_query";
          p.updatedAt = amzNowIso();
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);

          location.href = amzHomeUrl(typeof st !== "undefined" ? st : null);
          return;
        }

        p.stage = "next_page";
        p.updatedAt = amzNowIso();
        st.amazon.updatedAt = amzNowIso();
        window?.QCoreContent?.setState(st);

        const moved = await amzClickNextPage();
        if (!moved) {
          amzLog("⚠️ could not move to next page; moving to next query");
          p.queryIndex = p.queryIndex + 1;
          p.pageIndex = 0;
          p.stage = "next_query";
          p.updatedAt = amzNowIso();
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);
          location.href = amzHomeUrl(typeof st !== "undefined" ? st : null);
          return;
        }

        // Post navigation: keep loop alive if Amazon uses client-side navigation.
        setTimeout(() => amzAutoTick("post_next_click"), 900);
      } catch (e) {
        try {
          amzLog(`💥 ERROR: ${String(e?.message || e || "error")}`);
        } catch {}
        setTimeout(() => amzAutoTick("retry_after_error"), 1750);
      } finally {
        __amzTickInFlight = false;
      }
    }

    function showAmazonScrapeModal({ reason = "tools_modal" } = {}) {
      try {
        const st = amzEnsureInit();
        const r = String(reason || "");
        const isAuto = r === "autoboot" || r.startsWith("auto_reopen:");

        // If explicitly opened, unhide.
        if (!isAuto) {
          if (st.amazon?.meta) st.amazon.meta.uiHidden = false;
          st.amazon.updatedAt = amzNowIso();
          window?.QCoreContent?.setState(st);
        }

        if (st.amazon?.meta?.uiHidden === true && isAuto) return;

        amzEnsureModal();
        amzRefreshStats();
        amzLog(`modal opened — ${reason}`);
      } catch {}
    }






  function amzAutoBoot() {
      try {
        const st = amzEnsureInit();
        if (amzIsStateStatusPaused(st)) {
          try {
            console.log("🛒⏸️ [AmazonScrape] state.status=paused — skipping autoboot");
          } catch {}
          return;
        }
        const p = st.amazon?.meta?.progress || {};
        if (p && p.running && !p.paused && !p.done) {
          try {
            showAmazonScrapeModal({ reason: "autoboot" });
          } catch {}
          amzEnsureHeartbeat();
          setTimeout(() => amzAutoTick("autoboot"), __AMZ_CFG.stepDelayMs);
          try {
            console.log("🛒✅ [AmazonScrape] autoboot", { href: location.href, tickId: p.tickId });
          } catch {}
        }
      } catch {}
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "amazon",
      title: "Amazon Products Scrape",
      icon: "🛒",
      description: "Scrape Amazon product pages and export JSON.",
      order: 220,
      onClick: () => { try { showAmazonScrapeModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { amzAutoBoot(); } catch {} },
    });
    try { QQ.showAmazonScrapeModal = showAmazonScrapeModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
