(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const safeNowIso = Q.safeNowIso || (() => new Date().toISOString());
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

  // Auto-export: click-equivalent export every 60s (while running)
  const __GF_AUTO_EXPORT_INTERVAL_MS = 60 * 1000;

  function gfEnsureInit() {
    const root = window?.QCoreContent?.getState() || {};
    const now = gfNowIso();

    let gf = root.google;
    if (!gf || typeof gf !== "object") gf = {};

    // Prefer most complete/newest persisted state — BUT NEVER let LS overwrite cursor fields.
    try {
      const ls = gfReadLS();
      if (ls && typeof ls === "object") {
        const memUpdated = Date.parse(String(gf.updatedAt || "")) || 0;
        const lsUpdated = Date.parse(String(ls.updatedAt || "")) || 0;
        const memRecs = Array.isArray(gf.records) ? gf.records.length : 0;
        const lsRecs = Array.isArray(ls.records) ? ls.records.length : 0;

        const memJobs = gf.jobs && typeof gf.jobs === "object" ? Object.keys(gf.jobs).length : 0;
        const lsJobs = ls.jobs && typeof ls.jobs === "object" ? Object.keys(ls.jobs).length : 0;

        const preferLs =
          (lsRecs > memRecs) ||
          (lsJobs > memJobs) ||
          (lsUpdated > memUpdated);

        if (preferLs) {
          // Preserve run toggles
          const running = gf.running === true;
          const paused = gf.paused === true;
          const tickId = Number.isFinite(Number(gf.tickId))
            ? Number(gf.tickId)
            : (Number(ls.tickId) || 0);

          // Preserve UI visibility flags from memory so localStorage can't immediately
          // re-hide the modal after a user explicitly opens it.
          const memUiHidden = (typeof gf.uiHidden === "boolean") ? gf.uiHidden : undefined;
          const memUiOpen = (typeof gf.uiOpen === "boolean") ? gf.uiOpen : undefined;
          const memModalOpen = (typeof gf.modalOpen === "boolean") ? gf.modalOpen : undefined;

          // Cursor fields can get reset by state compaction; choose the *furthest-ahead* cursor
          // between memory and localStorage instead of blindly preserving memory.
          const memDateIso =
            (typeof gf.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(gf.dateIso))
              ? gf.dateIso
              : null;

          const memAirports =
            (Array.isArray(gf.airports) && gf.airports.length)
              ? gf.airports.slice()
              : null;

          const memOriginIdx =
            Number.isFinite(Number(gf.originIdx))
              ? Math.max(0, Math.floor(Number(gf.originIdx)))
              : null;

          const lsDateIso =
            (typeof ls.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ls.dateIso))
              ? ls.dateIso
              : null;

          const lsOriginIdx =
            Number.isFinite(Number(ls.originIdx))
              ? Math.max(0, Math.floor(Number(ls.originIdx)))
              : null;

          // Pick whichever cursor is ahead: (dateIso, originIdx)
          let bestDateIso = lsDateIso || memDateIso || null;
          let bestOriginIdx = (lsOriginIdx !== null) ? lsOriginIdx : memOriginIdx;

          if (memDateIso && memOriginIdx !== null && lsDateIso && lsOriginIdx !== null) {
            const memAhead =
              (memDateIso > lsDateIso) || (memDateIso === lsDateIso && memOriginIdx > lsOriginIdx);
            bestDateIso = memAhead ? memDateIso : lsDateIso;
            bestOriginIdx = memAhead ? memOriginIdx : lsOriginIdx;
          } else if (memDateIso && memOriginIdx !== null && (!lsDateIso || lsOriginIdx === null)) {
            bestDateIso = memDateIso;
            bestOriginIdx = memOriginIdx;
          }

          gf = { ...ls, running, paused, tickId };

          // Re-apply in-memory visibility if present.
          if (typeof memUiHidden === "boolean") gf.uiHidden = memUiHidden;
          if (typeof memUiOpen === "boolean") gf.uiOpen = memUiOpen;
          if (typeof memModalOpen === "boolean") gf.modalOpen = memModalOpen;
          if (typeof memModalOpen === "boolean") gf.modalOpen = memModalOpen;

          // Apply the best cursor; prefer memory airports if present (modal is source-of-truth).
          if (bestDateIso) gf.dateIso = bestDateIso;
          if (memAirports) gf.airports = memAirports;
          if (bestOriginIdx !== null) gf.originIdx = bestOriginIdx;
        }
      }
    } catch {}

    // Restore durable cursor/totals from the tiny progress key.
    // This survives large-state truncation (window.name / setState compaction) and prevents
    // "stuck on first airport" + "total reset" loops.
    try {
      const pr = gfReadProgressLS();
      if (pr && typeof pr === "object") {
        const prDateIso =
          typeof pr.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pr.dateIso)
            ? pr.dateIso
            : "";

        const prOriginIdx =
          Number.isFinite(Number(pr.originIdx))
            ? Math.max(0, Math.floor(Number(pr.originIdx)))
            : null;

        const memDateValid =
          typeof gf.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(gf.dateIso);

        const memOriginValid = Number.isFinite(Number(gf.originIdx));

        const cursorMissing = !memDateValid || !memOriginValid;
        const cursorLooksReset =
          memDateValid &&
          memOriginValid &&
          Number(gf.originIdx || 0) === 0 &&
          String(gf.dateIso || "") === gfTodayIsoDate();

        const memUpdated = Date.parse(String(gf.updatedAt || "")) || 0;
        const prUpdated = Date.parse(String(pr.updatedAt || "")) || 0;
        const prCursorValid = !!prDateIso && prOriginIdx !== null;
        const memCursorValid = memDateValid && memOriginValid;

        const prAheadOfMem = prCursorValid && memCursorValid
          ? (prDateIso > String(gf.dateIso || "")) ||
            (prDateIso === String(gf.dateIso || "") && Number(prOriginIdx || 0) > Number(gf.originIdx || 0))
          : false;

        const usePr = prUpdated > memUpdated || cursorMissing || cursorLooksReset || prAheadOfMem;

        if (usePr && prDateIso) gf.dateIso = prDateIso;
        if (usePr && prOriginIdx !== null) gf.originIdx = prOriginIdx;

        // Merge monotonic totals (never decrease)
        gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
        if (pr.totals && typeof pr.totals === "object") {
          const t = pr.totals;
          const maxNum = (a, b) => {
            const A = Number.isFinite(Number(a)) ? Number(a) : 0;
            const B = Number.isFinite(Number(b)) ? Number(b) : 0;
            return Math.max(A, B);
          };
          gf.totals.originJobsDone = maxNum(gf.totals.originJobsDone, t.originJobsDone);
          gf.totals.datesDone = maxNum(gf.totals.datesDone, t.datesDone);
          gf.totals.recordsDb = maxNum(gf.totals.recordsDb, t.recordsDb);
          gf.totals.recordsTotal = maxNum(gf.totals.recordsTotal, t.recordsTotal);
          gf.totals.recordsTotal = maxNum(gf.totals.recordsTotal, t.recordsDb);
        }
      }
    } catch {}


    // Normalize airports list
    const normalizeAirports = (arr) => {
      const out = [];
      for (const a of Array.isArray(arr) ? arr : []) {
        const code = gfNormalizeAirportCode(
          a && typeof a === "object" ? (a.code || a.iata || a.value) : a
        );
        if (code && /^[A-Z]{3}$/.test(code)) out.push(code);
      }
      const seen = new Set();
      return out.filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });
    };

    const airports = normalizeAirports(gf.airports);
    gf.airports = (airports && airports.length ? airports : __GF_DEFAULT_AIRPORTS);

    gf.version = 2;
    gf.createdAt = typeof gf.createdAt === "string" ? gf.createdAt : now;
    gf.updatedAt = now;

    gf.running = gf.running === true;
    gf.paused = gf.paused === true;
    gf.uiHidden = gf.uiHidden === true;

    // Explicit UI visibility flag (requested by Tools modal):
    // - uiHidden: user chose to hide
    // - uiOpen: modal is currently open/visible
    // Keep them consistent, but do NOT auto-open the modal here.
    const __uiOpen = (gf.uiOpen === true) || (gf.modalOpen === true);
    gf.uiOpen = __uiOpen;
    gf.modalOpen = __uiOpen;
    if (gf.uiHidden) {
      gf.uiOpen = false;
      gf.modalOpen = false;
    }

    gf.stage = typeof gf.stage === "string" ? gf.stage : "idle";
    gf.tickId = Number.isFinite(Number(gf.tickId)) ? Number(gf.tickId) : 0;

    // Cursor normalization (after preservation)
    gf.dateIso =
      typeof gf.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(gf.dateIso)
        ? gf.dateIso
        : gfTodayIsoDate();

    gf.originIdx =
      Number.isFinite(Number(gf.originIdx))
        ? Math.max(0, Math.floor(Number(gf.originIdx)))
        : 0;

    if (gf.originIdx >= gf.airports.length) gf.originIdx = 0;

    gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
    gf.totals.airports = gf.airports.length;
    gf.totals.originJobsDone = Number.isFinite(Number(gf.totals.originJobsDone))
      ? Number(gf.totals.originJobsDone)
      : 0;
    gf.totals.datesDone = Number.isFinite(Number(gf.totals.datesDone))
      ? Number(gf.totals.datesDone)
      : 0;

    gf.jobs =
      gf.jobs && typeof gf.jobs === "object" && !Array.isArray(gf.jobs)
        ? gf.jobs
        : {};

    // UI cache only (latest rows shown in the modal). Full records are stored in IndexedDB.
    gf.records = Array.isArray(gf.records) ? gf.records : [];
    if (gf.records.length > __GF_RECORD_CACHE_LIMIT) {
      gf.records = gf.records.slice(-__GF_RECORD_CACHE_LIMIT);
    }

    // Keep cache keys bounded (aligned to the cache only).
    gf.__recordKeys = {};
    try {
      for (const r of gf.records) {
        const key = gfRecordKey(
          r?.origin,
          r?.destinationCity,
          r?.destination,
          r?.destinationMid,
          r?.dateIso,
          r?.priceUsd
        );
        if (key) gf.__recordKeys[key] = 1;
      }
    } catch {}

    // Totals:
    // - recordsCache: what we keep in-memory for UI
    // - recordsDb: authoritative full count (IndexedDB). We keep it monotonic in-state as we insert/import.
    // - recordsTotal: legacy monotonic counter (also kept in progress key)
    const __cacheCount = gf.records.length;
    gf.totals.recordsCache = __cacheCount;

    gf.totals.recordsDb = Number.isFinite(Number(gf.totals.recordsDb))
      ? Number(gf.totals.recordsDb)
      : 0;

    gf.totals.recordsTotal = Number.isFinite(Number(gf.totals.recordsTotal))
      ? Number(gf.totals.recordsTotal)
      : gf.totals.recordsDb;

    if (gf.totals.recordsTotal < gf.totals.recordsDb) gf.totals.recordsTotal = gf.totals.recordsDb;

    // Keep legacy "records" field meaningful: show DB count (not cache count).
    gf.totals.records = gf.totals.recordsDb;

    gf.lastLog = typeof gf.lastLog === "string" ? gf.lastLog : "";
    gf.lastTickInfo = typeof gf.lastTickInfo === "string" ? gf.lastTickInfo : "";

    root.google = gf;
    window?.QCoreContent?.setState(root);
    try { gfWriteLS(gf); } catch {}
    try { gfWriteProgressLS(gf); } catch {}
    return root;
  }

  const __GF_KEY = "q.googleFlights";
  const __GF_PROGRESS_KEY = "q.googleFlights.progress.v1";

  // Full record storage (IndexedDB) — keeps ALL flights (e.g., 87,963+) without localStorage truncation.
  const __GF_DB_NAME = "q.googleFlights.records.db.v1";
  const __GF_DB_VERSION = 1;
  const __GF_DB_STORE = "records";
  const __GF_RECORD_CACHE_LIMIT = 400; // UI only (latest rows shown in modal)

  // Run range (inclusive). Runner auto-stops after this date.
  const __GF_END_DATE_ISO = "2026-12-31";

  // Google Flights MUST run ONLY on this base URL (query params OK):
  //   https://www.google.com/travel/explore
  // Not allowed:
  //   https://www.google.com/travel/
  //   https://www.google.com/
  const __GF_EXPLORE_BASE_URL = "https://www.google.com/travel/explore";

  function gfIsExploreBaseUrl(href = "") {
    try {
      const u = new URL(String(href || location.href), location.href);
      if (u.origin !== "https://www.google.com") return false;
      // Accept /travel/explore and /travel/explore/... plus any querystring.
      return String(u.pathname || "").startsWith("/travel/explore");
    } catch {
      return false;
    }
  }

  function gfEnforceExploreOnly({ reason = "" } = {}) {
    try {
      if (gfIsExploreBaseUrl(location.href)) return true;
      // Never redirect; just block execution.
      console.warn("[GF] blocked: not on /travel/explore (no redirect)", { reason, href: location.href });
      return false;
    } catch {
      return false;
    }
  }

  // FIX: this used to hard-crash on load if QCoreGlobal/initCoreData isn't ready yet
  // which prevented the tool from registering in the Tools modal.
  // Default list is 20 origins (LAX + JFK included) per your spec.
  const __GF_DEFAULT_AIRPORTS = (() => {
    const fallback20 = [
      "LAX","JFK","SFO","SEA","LAS","SAN","PHX","DEN","ORD","DFW",
      "IAH","ATL","MIA","BOS","IAD","EWR","CLT","DTW","MSP","BWI",
    ];

    try {
      const raw = window?.QCoreGlobal?.initCoreData?.();
      const list = Array.isArray(raw) ? raw : [];

      const out = [];
      const seen = new Set();

      // Prefer any USA airports from core data (but keep it bounded)
      for (const a of list) {
        try {
          if (!a) continue;
          if (String(a.country || "").toUpperCase() !== "USA") continue;
          const code = gfNormalizeAirportCode(a);
          if (!code || !/^[A-Z]{3}$/.test(code)) continue;
          if (seen.has(code)) continue;
          seen.add(code);
          out.push(code);
          // we don't need a massive list here; default rotation is 20
          if (out.length >= 120) break;
        } catch {}
      }

      // Ensure fallback major airports exist in the rotation
      for (const c of fallback20) {
        const cc = String(c || "").trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(cc)) continue;
        if (seen.has(cc)) continue;
        seen.add(cc);
        out.push(cc);
      }

      // Ensure LAX + JFK are present and early
      const ensure = ["LAX", "JFK"];
      for (const c of ensure.reverse()) {
        if (!out.includes(c)) out.unshift(c);
      }

      // Final: 20 only
      const final = [];
      const seen2 = new Set();
      for (const c of out) {
        if (seen2.has(c)) continue;
        seen2.add(c);
        final.push(c);
        if (final.length >= 20) break;
      }
      return final.length ? final : fallback20;
    } catch {
      return fallback20;
    }
  })();

  // pacing knobs
  // Faster runner: this used to be 2000ms which made Google Flights feel "stuck".
  // Keep it <=400ms per your rule; stage-specific waits still handle real page load.
  const __GF_STEP_DELAY_MS = 400;
  const __GF_AFTER_ENTER_DELAY_MS = 400;   // after hitting Enter on an input (<=400ms)
  const __GF_EXPLORE_SETTLE_WAIT_MS = 400; // per rule: <=400ms settle before scraping
  const __GF_AFTER_NONSTOP_WAIT_MS = 0;     // Nonstop step removed (unused)

  const __GF_PRICE_READY_TIMEOUT_MS = 10000;
  const __GF_PRICE_READY_POLL_MS = 375;
  const __GF_ABORT_POLL_MS = 125;

  function gfNowIso() {
    try {
      return new Date().toISOString();
    } catch {
      return String(Date.now());
    }
  }

  function gfNowMs() {
    try {
      return Date.now();
    } catch {
      return 0;
    }
  }

  function gfTodayIsoDate() {
    const d = new Date();
    // Local date to match the UI day
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function gfAddDaysIsoDate(isoDate, addDays) {
    try {
      const [y, m, d] = String(isoDate || "").split("-").map((x) => parseInt(x, 10));
      if (!y || !m || !d) return gfTodayIsoDate();
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + (addDays || 0));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    } catch {
      return gfTodayIsoDate();
    }
  }

  function gfFormatDateForInput(isoDate) {
    // "Tue, Feb 10"
    try {
      const [y, m, d] = String(isoDate || "").split("-").map((x) => parseInt(x, 10));
      const dt = new Date(y || 2026, (m || 2) - 1, d || 10);
      const weekday = dt.toLocaleDateString("en-US", { weekday: "short" });
      const month = dt.toLocaleDateString("en-US", { month: "short" });
      const day = dt.getDate();
      return `${weekday}, ${month} ${day}`;
    } catch {
      return "Tue, Feb 10";
    }
  }

  function gfIsExplorePage() {
    return gfIsExploreBaseUrl(location.href);
  }

  function gfSleep(ms) {
    return new Promise((r) => setTimeout(r, ms || 0));
  }

  // ---------- Abort / Pause locking (Pause MUST freeze progress) ----------
  function gfAbortError() {
    const e = new Error("__GF_ABORT__");
    e.__gfAbort = true;
    return e;
  }

  function gfIsStillRunning(runToken) {
    try {
      // Prefer live QCore state, but fall back to the tiny progress key if state was compacted/truncated.
      const root = window?.QCoreContent?.getState() || {};
      const g = root.google && typeof root.google === "object" ? root.google : {};
      const pr = gfReadProgressLS() || {};

      const running = (typeof g.running === "boolean") ? g.running : !!pr.running;
      const paused = (typeof g.paused === "boolean") ? g.paused : !!pr.paused;
      const tickId = Number.isFinite(Number(g.tickId)) ? Number(g.tickId) : Number(pr.tickId || 0);

      if (!running || paused) return false;
      if (Number(tickId || 0) !== Number(runToken || 0)) return false;
      return true;
    } catch {
      return false;
    }
  }

  function gfAssertStillRunning(runToken) {
    if (!gfIsStillRunning(runToken)) throw gfAbortError();
  }

  async function gfAbortableSleep(runToken, ms) {
    const end = gfNowMs() + (ms || 0);
    while (gfNowMs() < end) {
      gfAssertStillRunning(runToken);
      const remain = end - gfNowMs();
      await gfSleep(Math.min(__GF_ABORT_POLL_MS, Math.max(0, remain)));
    }
    gfAssertStillRunning(runToken);
  }

  // ---------- Storage ----------
  function gfReadLS() {
    try {
      const raw = localStorage.getItem(__GF_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  function gfReadProgressLS() {
    try {
      const raw = localStorage.getItem(__GF_PROGRESS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  function gfWriteProgressLS(gfState) {
    try {
      const gf = gfState && typeof gfState === "object" ? gfState : {};
      const totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
      const payload = {
        v: 1,
        updatedAt: gfNowIso(),
        tickId: Number(gf.tickId || 0) || 0,
        running: !!gf.running,
        paused: !!gf.paused,
        dateIso: String(gf.dateIso || "").trim(),
        originIdx: Number.isFinite(Number(gf.originIdx)) ? Math.max(0, Math.floor(Number(gf.originIdx))) : 0,
        totals: {
          airports: Number(totals.airports || 0) || 0,
          originJobsDone: Number(totals.originJobsDone || 0) || 0,
          datesDone: Number(totals.datesDone || 0) || 0,
          recordsDb: Number(totals.recordsDb || 0) || 0,
          recordsTotal: Number(totals.recordsTotal || totals.recordsDb || 0) || 0,
        },
      };
      localStorage.setItem(__GF_PROGRESS_KEY, JSON.stringify(payload));
    } catch {}
  }

  function gfWriteLS(obj) {
    try {
      // localStorage is ONLY a compact snapshot for cursor/jobs/totals + a small UI cache.
      // Full records live in IndexedDB (see __GF_DB_NAME).
      const src = obj && typeof obj === "object" ? obj : {};

      const clone = { ...(src || {}) };

      // Keep only a small rolling cache for the UI table.
      if (Array.isArray(clone.records) && clone.records.length > __GF_RECORD_CACHE_LIMIT) {
        clone.records = clone.records.slice(-__GF_RECORD_CACHE_LIMIT);
      }

      // Keep recordKeys aligned with the cache only (never let this grow unbounded).
      try {
        const keys = {};
        for (const r of Array.isArray(clone.records) ? clone.records : []) {
          const k = gfRecordKey(r?.origin, r?.destinationCity, r?.destination, r?.destinationMid, r?.dateIso, r?.priceUsd);
          if (k) keys[k] = 1;
        }
        clone.__recordKeys = keys;
      } catch {
        clone.__recordKeys = {};
      }

      // Jobs can still grow; cap to the most recent N to avoid quota issues.
      if (clone.jobs && typeof clone.jobs === "object" && !Array.isArray(clone.jobs)) {
        try {
          const entries = Object.entries(clone.jobs);
          if (entries.length > 2500) {
            entries.sort((a, b) => {
              const A = a[1] || {};
              const B = b[1] || {};
              const ta = Date.parse(String(A.finishedAt || A.startedAt || "")) || 0;
              const tb = Date.parse(String(B.finishedAt || B.startedAt || "")) || 0;
              return tb - ta;
            });
            const keep = entries.slice(0, 2500);
            const nextJobs = {};
            for (const [k, v] of keep) nextJobs[k] = v;
            clone.jobs = nextJobs;
          }
        } catch {}
      }

      const json = JSON.stringify(clone);

      try {
        localStorage.setItem(__GF_KEY, json);
        return true;
      } catch (e) {
        // Quota / private-mode fallback: keep the *minimum* viable snapshot.
        try {
          const mini = {
            ...clone,
            records: [],
            __recordKeys: {},
          };
          localStorage.setItem(__GF_KEY, JSON.stringify(mini));
          return true;
        } catch {}
        return false;
      }
    } catch {
      return false;
    }
  }

  // ---------- IndexedDB (Full record storage) ----------
  let __gfDbPromise = null;

  function gfDbSupported() {
    try {
      return typeof indexedDB !== "undefined" && !!indexedDB;
    } catch {
      return false;
    }
  }

  function gfDbOpen() {
    if (__gfDbPromise) return __gfDbPromise;
    __gfDbPromise = new Promise((resolve, reject) => {
      try {
        if (!gfDbSupported()) {
          reject(new Error("IndexedDB not supported"));
          return;
        }
        const req = indexedDB.open(__GF_DB_NAME, __GF_DB_VERSION);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(__GF_DB_STORE)) {
              const store = db.createObjectStore(__GF_DB_STORE, { keyPath: "id" });
              // Helpful indexes for later analysis (optional).
              try { store.createIndex("dateIso", "dateIso", { unique: false }); } catch {}
              try { store.createIndex("origin", "origin", { unique: false }); } catch {}
              try { store.createIndex("destination", "destination", { unique: false }); } catch {}
              try { store.createIndex("origin_dateIso", ["origin", "dateIso"], { unique: false }); } catch {}
            }
          } catch {}
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      } catch (e) {
        reject(e);
      }
    });
    return __gfDbPromise;
  }

  async function gfDbClearAll() {
    try {
      const db = await gfDbOpen();
      return await new Promise((resolve) => {
        const tx = db.transaction(__GF_DB_STORE, "readwrite");
        const store = tx.objectStore(__GF_DB_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  async function gfDbCountRecords() {
    try {
      const db = await gfDbOpen();
      return await new Promise((resolve) => {
        const tx = db.transaction(__GF_DB_STORE, "readonly");
        const store = tx.objectStore(__GF_DB_STORE);
        const req = store.count();
        req.onsuccess = () => resolve(Number(req.result || 0) || 0);
        req.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  async function gfDbAddRecordsBatch(records) {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) return { added: 0, addedIds: new Set() };

    try {
      const db = await gfDbOpen();
      return await new Promise((resolve) => {
        let added = 0;
        const addedIds = new Set();

        const tx = db.transaction(__GF_DB_STORE, "readwrite");
        const store = tx.objectStore(__GF_DB_STORE);

        for (const rec of list) {
          try {
            if (!rec || typeof rec !== "object") continue;
            if (!rec.id) {
              rec.id = gfRecordKey(rec.origin, rec.destinationCity, rec.destination, rec.destinationMid, rec.dateIso, rec.priceUsd);
            }
            if (!rec.id) continue;

            const req = store.add(rec);
            req.onsuccess = () => {
              added += 1;
              try { addedIds.add(String(rec.id)); } catch {}
            };
            req.onerror = (ev) => {
              // Duplicate keys are expected — do NOT abort the whole transaction.
              if (req.error && req.error.name === "ConstraintError") {
                try { ev.preventDefault(); ev.stopPropagation(); } catch {}
                return;
              }
              // For any other error, also avoid aborting; just log.
              try { ev.preventDefault(); ev.stopPropagation(); } catch {}
            };
          } catch {}
        }

        tx.oncomplete = () => resolve({ added, addedIds });
        tx.onerror = () => resolve({ added, addedIds });
        tx.onabort = () => resolve({ added, addedIds });
      });
    } catch {
      return { added: 0, addedIds: new Set() };
    }
  }

  async function gfDbGetAllRecords({ onProgress } = {}) {
    try {
      const db = await gfDbOpen();
      return await new Promise((resolve, reject) => {
        const out = [];
        const tx = db.transaction(__GF_DB_STORE, "readonly");
        const store = tx.objectStore(__GF_DB_STORE);
        const req = store.openCursor();
        let n = 0;

        req.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            out.push(cursor.value);
            n += 1;
            if (typeof onProgress === "function" && (n % 5000 === 0)) {
              try { onProgress(n); } catch {}
            }
            cursor.continue();
            return;
          }
          resolve(out);
        };
        req.onerror = () => reject(req.error || new Error("cursor error"));
      });
    } catch {
      return [];
    }
  }

  // Best-effort: sync totals.recordsDb with the actual IndexedDB count (non-blocking).
  async function gfSyncDbCountToState({ modal = null, state = null, reason = "" } = {}) {
    try {
      if (!gfDbSupported()) return 0;
      const count = await gfDbCountRecords();
      const st = state && typeof state === "object" ? state : gfEnsureInit();
      st.google = st.google && typeof st.google === "object" ? st.google : {};
      st.google.totals = st.google.totals && typeof st.google.totals === "object" ? st.google.totals : {};

      st.google.totals.recordsDb = count;
      st.google.totals.records = count; // keep legacy field meaningful
      const prevTotal = Number.isFinite(Number(st.google.totals.recordsTotal)) ? Number(st.google.totals.recordsTotal) : 0;
      st.google.totals.recordsTotal = Math.max(prevTotal, count);

      st.google.totals.recordsCache = Array.isArray(st.google.records) ? st.google.records.length : 0;

      st.google.updatedAt = gfNowIso();
      window?.QCoreContent?.setState(st);
      try { gfWriteLS(st.google); } catch {}
      try { gfWriteProgressLS(st.google); } catch {}

      try {
        if (modal) {
          gfUpdateModal(modal, st);
          if (reason) gfLog(modal, st, `DB count sync (${reason}) → ${count}`);
        }
      } catch {}
      return count;
    } catch {
      return 0;
    }
  }

  function gfGetGlobalMirror() {
    try {
      const st = window?.QCoreContent?.getState() || {};
      const gf = st.google;
      return gf && typeof gf === "object" ? gf : null;
    } catch {
      return null;
    }
  }

  function gfSetGlobalMirror(stateObj) {
    try {
      // Always persist to localStorage so state doesn't "snap back" after compaction/window.name limits.
      try { gfWriteLS(stateObj || {}); } catch {}

      // Avoid blowing up window.name: only mirror if reasonably small.
      const json = JSON.stringify(stateObj || {});
      if (json.length > 1000000) {
        // Too big to safely mirror into window.name; keep localStorage only.
        return;
      }
      const st = window?.QCoreContent?.getState() || {};
      st.google = stateObj || {};
      window?.QCoreContent?.setState(st);
    } catch {
      try { gfWriteLS(stateObj || {}); } catch {}
    }
  }

  function gfGet() {
    return gfGetGlobalMirror() || gfReadLS();
  }

  function gfNormalizeAirportCode(v) {
    try {
      // Support legacy shapes: {code:"LAX"} etc.
      if (v && typeof v === "object") {
        const c = v.code || v.iata || v.airport || v.value;
        if (c) v = c;
      }
      const raw = String(v || "").trim().toUpperCase();
      const m = raw.match(/\b[A-Z]{3}\b/);
      return m && m[0] ? m[0] : raw;
    } catch {
      return "";
    }
  }

  function gfJobKey(origin, dateIso) {
    const o = gfNormalizeAirportCode(origin);
    const d = String(dateIso || "").trim();
    return `${o}|${d}`;
  }

  function gfRecordKey(origin, destinationCity, destination, destinationMid, dateIso, priceUsd) {
    const o = String(origin || "").toUpperCase();
    const c = String(destinationCity || "").trim();
    const code = String(destination || "").trim();
    const mid = String(destinationMid || "");
    const dt = String(dateIso || "");
    const p = String(priceUsd || "");
    return `${o}>>${code}>>${c}>>${mid}>>${dt}>>${p}`;
  }

  function gfDedupPushRecord(state, rec) {
    // NOTE: This is now ONLY a small rolling cache for the UI.
    // Full record persistence happens in IndexedDB via gfDbAddRecordsBatch().
    try {
      const gf = state?.google;
      if (!gf || !rec) return false;

      gf.records = Array.isArray(gf.records) ? gf.records : [];
      gf.__recordKeys = gf.__recordKeys && typeof gf.__recordKeys === "object" ? gf.__recordKeys : {};

      const id = String(
        rec.id ||
          gfRecordKey(
            rec?.origin,
            rec?.destinationCity,
            rec?.destination,
            rec?.destinationMid,
            rec?.dateIso,
            rec?.priceUsd
          ) ||
          ""
      );
      if (!id) return false;
      rec.id = id;

      if (gf.__recordKeys[id]) return false;
      gf.__recordKeys[id] = 1;

      gf.records.push(rec);

      // Enforce cache limit and keep key-map bounded.
      if (gf.records.length > __GF_RECORD_CACHE_LIMIT) {
        gf.records = gf.records.slice(-__GF_RECORD_CACHE_LIMIT);
        const keys = {};
        for (const r of gf.records) {
          const k = r?.id || gfRecordKey(r?.origin, r?.destinationCity, r?.destination, r?.destinationMid, r?.dateIso, r?.priceUsd);
          if (k) keys[String(k)] = 1;
        }
        gf.__recordKeys = keys;
      }

      gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
      gf.totals.recordsCache = gf.records.length;
      return true;
    } catch {
      return false;
    }
  }

  function gfNextOriginOrDate(state) {
    const gf = state?.google || {};

    if (!Array.isArray(gf.airports) || !gf.airports.length) {
      gf.airports = __GF_DEFAULT_AIRPORTS;
    }

    const list = gf.airports || [];
    gf.originIdx = Number.isFinite(Number(gf.originIdx)) ? Math.max(0, Math.floor(Number(gf.originIdx))) : 0;
    gf.originIdx += 1;

    if (gf.originIdx >= list.length) {
      gf.originIdx = 0;
      gf.dateIso = gfAddDaysIsoDate(gf.dateIso, 1);
      gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
      gf.totals.datesDone = (Number(gf.totals.datesDone) || 0) + 1;
    }

    gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
    gf.totals.airports = list.length;
    gf.updatedAt = gfNowIso();

    state.google = gf;
    try { gfWriteProgressLS(gf); } catch {}
    try { gfWriteLS(gf); } catch {}
    return state;
  }

  // ---------- DOM helpers ----------
  function gfFire(el, type) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          buttons: 1,
        })
      );
    } catch {}
  }

  function gfSetValueWithEvents(input, value) {
    if (!input) return;
    try {
      input.focus();
      gfFire(input, "mousedown");
      gfFire(input, "mouseup");
      gfFire(input, "click");
    } catch {}

    // Native setter improves reliability on controlled inputs
    try {
      const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
      const setter = desc && typeof desc.set === "function" ? desc.set : null;
      if (setter) setter.call(input, String(value || ""));
      else input.value = String(value || "");
    } catch {
      try {
        input.value = String(value || "");
      } catch {}
    }

    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
  }

  function gfKey(el, key, code, which, keyCode) {
    try {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, code: code || key, which: which || 0, keyCode: keyCode || 0, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key, code: code || key, which: which || 0, keyCode: keyCode || 0, bubbles: true }));
    } catch {}
  }

  function gfKeyEnter(el) {
    gfKey(el, "Enter", "Enter", 13, 13);
  }

  function gfLog(modal, state, msg) {
    try {
      const line = String(msg || "");
      const root = state && typeof state === "object" ? state : window?.QCoreContent?.getState() || {};
      root.google = root.google && typeof root.google === "object" ? root.google : {};
      root.google.lastLog = line;
      root.google.updatedAt = gfNowIso();
      window?.QCoreContent?.setState(root);
      try { gfWriteLS(root.google); } catch {}
      try { gfWriteProgressLS(root.google); } catch {}
      if (modal && typeof modal.addLog === "function") modal.addLog(line);
    } catch {}
  }

  function __gfEscapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- City → Airport code mapping ----------
  function gfNorm(s) {
    try {
      return String(s || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u2019\u2018]/g, "'")
        .replace(/[^a-z0-9\s'-]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return String(s || "").trim().toLowerCase();
    }
  }

  function gfCityToAirportCode(cityText) {
    try {
      const raw = String(cityText || "").trim();
      if (!raw) return "";

      // NEW RULE (Google Flights + Zillow): initCoreData loops only country === "USA"
      const core = window?.QCoreGlobal?.initCoreData?.();
      const list = Array.isArray(core) ? core.filter((a) => a && a.country === "USA") : [];

      // If the text already contains a 3-letter code, prefer it if it exists in the (USA-only) list.
      const m = raw.match(/\b[A-Z]{3}\b/);
      if (m && m[0]) {
        const code = String(m[0]).toUpperCase();
        if (list.some((a) => String(a?.code || "").toUpperCase() === code)) return code;
      }

      const cityOnly = raw.split(",")[0].trim();
      const nCity = gfNorm(cityOnly);
      if (!nCity) return "";

      const matches = list.filter((a) => {
        const ac = gfNorm(a?.city || "");
        if (!ac) return false;
        return ac === nCity || ac.includes(nCity) || nCity.includes(ac);
      });

      if (!matches.length) return "";
      return String(matches[0]?.code || "").toUpperCase();
    } catch {
      return "";
    }
  }

  // (kept as-is; appears unused in this tool)
  function __qcoreEnsureVisibilityRegistry(stateObj, { includeDashSites = true, persist = false } = {}) {
    try {
      const s = stateObj && typeof stateObj === "object" ? stateObj : window?.QCoreContent?.getState() || {};
      __qcoreEnsureVisibilityArray(s);

      // Current site
      const curUrl = __qcoreCurrentSiteUrl();
      const curApp = __qcoreDetectApplicationName(s);
      __qcoreEnsureVisibilityRecord(s, { url: curUrl, applicationname: curApp, defaultVisibility: true });

      // Known sites list (Dashboard)
      if (includeDashSites && typeof DASH_SITES !== "undefined" && Array.isArray(DASH_SITES)) {
        for (const site of DASH_SITES) {
          const siteUrl = site?.url;
          if (!siteUrl) continue;
          __qcoreEnsureVisibilityRecord(s, {
            url: siteUrl,
            applicationname: site?.name || "",
            defaultVisibility: true,
          });
        }
      }

      if (persist) window?.QCoreContent?.setState(s);
      return s;
    } catch {
      try {
        if (persist) window?.QCoreContent?.setState(stateObj);
      } catch {}
      return stateObj || {};
    }
  }

  function __qcoreEnsureVisibilityRecord(stateObj, { url, applicationname, defaultVisibility = true } = {}) {
    try {
      if (!stateObj || typeof stateObj !== "object") return null;
      const list = __qcoreEnsureVisibilityArray(stateObj);

      const u = __qcoreNormSiteUrl(url);
      if (!u) return null;

      const app = String(applicationname || "").trim();

      let rec = __qcoreFindVisibilityRecord(stateObj, u);
      if (rec) {
        // Keep existing visibility; just normalize + fill missing fields.
        try {
          rec.url = u;
        } catch {}
        if (app) {
          try {
            rec.applicationname = app;
          } catch {}
        }
        if (typeof rec.visibility !== "boolean") {
          try {
            rec.visibility = !!defaultVisibility;
          } catch {}
        }
        if (!Number.isFinite(Number(rec.lastUpdated || 0))) {
          try {
            rec.lastUpdated = __qcoreUnixTs();
          } catch {}
        }
        return rec;
      }

      // Create once if missing
      rec = {
        url: u,
        applicationname: app || __qcoreDetectApplicationName(stateObj),
        visibility: !!defaultVisibility,
        lastUpdated: __qcoreUnixTs(),
      };
      list.push(rec);
      return rec;
    } catch {
      return null;
    }
  }

  // ---------- Modal UI ----------
  function __qcoreMakeGoogleFlightsModal({ title = "Google Flights", subtitle = "" } = {}) {
    let state = window?.QCoreContent?.getState();
    const root = document.createElement("div");
    root.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";

    const card = document.createElement("div");
    card.style.cssText =
      "width:min(980px,96vw);max-height:88vh;overflow:hidden;background:#0b1117;border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.65);display:flex;flex-direction:column;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu;color:#e5e7eb";

    const head = document.createElement("div");
    head.style.cssText = "padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:12px;align-items:flex-start;justify-content:space-between";

    const left = document.createElement("div");
    const h1 = document.createElement("div");
    h1.textContent = String(title || "Google Flights");
    h1.style.cssText = "font-weight:800;color:#93c5fd;font-size:16px;line-height:1.1";
    const h2 = document.createElement("div");
    h2.textContent = String(subtitle || "");
    h2.style.cssText = "margin-top:4px;color:rgba(255,255,255,.72);font-size:12px";
    left.appendChild(h1);
    left.appendChild(h2);

    const right = document.createElement("div");
    right.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end";

    const btn = (txt, bg) => {
      const b = document.createElement("button");
      b.textContent = txt;
      b.style.cssText =
        "padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:" +
        (bg || "#111827") +
        ";color:#e5e7eb;font-weight:800;cursor:pointer;font-size:12px";
      return b;
    };

    const btnStart = btn("Start / Resume", "#0891b2");
    const btnPause = btn("Pause", "#f59e0b");
    const btnReset = btn("Reset", "#a855f7");
    const btnImport = btn("Import JSON (merge)", "#10b981");
    const btnExport = btn("Export JSON (full)", "#16a34a");
    const btnClose = btn("Close (hide)", "#111827");

    right.appendChild(btnStart);
    right.appendChild(btnPause);
    right.appendChild(btnReset);
    right.appendChild(btnImport);
    right.appendChild(btnExport);
    right.appendChild(btnClose);

    head.appendChild(left);
    head.appendChild(right);

    const stats = document.createElement("div");
    stats.style.cssText = "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.82);display:flex;flex-direction:column;gap:2px";

    const lineRun = document.createElement("div");
    const lineDate = document.createElement("div");
    const lineTotals = document.createElement("div");
    const lineLast = document.createElement("div");
    stats.appendChild(lineRun);
    stats.appendChild(lineDate);
    stats.appendChild(lineTotals);
    stats.appendChild(lineLast);

    // ------------------------------ Controls ------------------------------
    // Cursor controls: Start Date + Start Airport (origin).
    // These directly set state.google.dateIso + state.google.originIdx so the runner starts/resumes here.
    const controls = document.createElement("div");
    controls.style.cssText =
      "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end";

    const mkField = (labelText) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:200px";
      const lab = document.createElement("div");
      lab.textContent = labelText;
      lab.style.cssText = "color:#94a3b8;font-size:12px;font-weight:900;letter-spacing:.2px";
      wrap.appendChild(lab);
      return { wrap, lab };
    };

    const init = (() => {
      try {
        return gfEnsureInit();
      } catch {
        return window?.QCoreContent?.getState() || {};
      }
    })();
    const initGf = init?.google || {};
    const initDateIso = String(initGf.dateIso || gfTodayIsoDate());
    const initAirports = Array.isArray(initGf.airports) ? initGf.airports : __GF_DEFAULT_AIRPORTS;
    const initOriginIdx = Number.isFinite(Number(initGf.originIdx)) ? Math.max(0, Math.floor(Number(initGf.originIdx))) : 0;
    const initOrigin = gfNormalizeAirportCode(initAirports[initOriginIdx] || initAirports[0] || "LAX") || "LAX";

    // Start Date
    const dateField = mkField("Start Date");
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = initDateIso;
    dateInput.max = __GF_END_DATE_ISO;
    dateInput.style.cssText =
      "padding:8px 10px;border-radius:10px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-weight:900;min-width:170px";
    dateField.wrap.appendChild(dateInput);
    const dateHelp = document.createElement("div");
    dateHelp.textContent = "Used as the beginning date for the scrape (cursor).";
    dateHelp.style.cssText = "color:#64748b;font-size:11px;font-weight:800;margin-top:-2px";
    dateField.wrap.appendChild(dateHelp);

    // Start Airport (Origin) with autocomplete dropdown
    const originField = mkField("Start Airport (Origin)");
    originField.wrap.style.minWidth = "320px";
    originField.wrap.style.position = "relative";

    const originInput = document.createElement("input");
    originInput.type = "text";
    originInput.value = initOrigin;
    originInput.placeholder = "Type: LAX or Los Angeles or USA";
    originInput.autocomplete = "off";
    originInput.spellcheck = false;
    originInput.style.cssText =
      "padding:8px 10px;border-radius:10px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-weight:900;min-width:260px;letter-spacing:.4px;text-transform:uppercase";
    originField.wrap.appendChild(originInput);

    const originMeta = document.createElement("div");
    originMeta.textContent = "";
    originMeta.style.cssText = "color:#64748b;font-size:11px;font-weight:800;margin-top:-2px;min-height:14px";
    originField.wrap.appendChild(originMeta);

    const originDrop = document.createElement("div");
    originDrop.style.cssText =
      "position:absolute;left:0;right:0;top:100%;margin-top:6px;background:#0b1117;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 16px 60px rgba(0,0,0,.65);max-height:260px;overflow:auto;display:none;z-index:2147483647";
    originField.wrap.appendChild(originDrop);

    const originErr = document.createElement("div");
    originErr.textContent = "";
    originErr.style.cssText = "color:#fca5a5;font-size:11px;font-weight:900;margin-top:6px;display:none";
    originField.wrap.appendChild(originErr);

    // Build / cache airport index for autocomplete (code + city + region + country)
    const airportIndex = (() => {
      try {
        if (window.__qcoreAirportIndex && window.__qcoreAirportIndex.list && window.__qcoreAirportIndex.byCode) return window.__qcoreAirportIndex;
      } catch {}
      const rawTry = window?.QCoreGlobal?.initCoreData?.();
      const raw = Array.isArray(rawTry) ? rawTry : [];
      const byCode = {};
      const list = [];
      for (const a of raw) {
        const code = gfNormalizeAirportCode(a && typeof a === "object" ? (a.code || a.iata || a.airport || a.value) : a);
        if (!code || !/^[A-Z]{3}$/.test(code)) continue;
        if (byCode[code]) continue;
        const city = String(a?.city || a?.town || a?.metro || "").trim();
        const region = String(a?.region || a?.state || a?.province || "").trim();
        const country = String(a?.country || a?.nation || "").trim();
        const name = String(a?.name || a?.airportName || a?.airport || "").trim();
        const blob = `${code} ${city} ${region} ${country} ${name}`.toLowerCase();
        const rec = { code, city, region, country, name, blob };
        byCode[code] = rec;
        list.push(rec);
      }
      const idx = { builtAt: Date.now(), list, byCode };
      try {
        window.__qcoreAirportIndex = idx;
      } catch {}
      return idx;
    })();

    const renderOriginMeta = (code) => {
      try {
        const c = gfNormalizeAirportCode(code);
        const rec = airportIndex?.byCode?.[c];
        if (!originMeta) return;
        if (!rec) {
          originMeta.textContent = "";
          return;
        }
        const parts = [];
        if (rec.city) parts.push(rec.city);
        if (rec.region) parts.push(rec.region);
        if (rec.country) parts.push(rec.country);
        originMeta.textContent = parts.join(", ");
      } catch {
        try {
          originMeta.textContent = "";
        } catch {}
      }
    };

    renderOriginMeta(initOrigin);

    const originSetState = (code) => {
      const c = gfNormalizeAirportCode(code);
      originErr.style.display = "none";
      originErr.textContent = "";
      if (!c || !/^[A-Z]{3}$/.test(c)) {
        originErr.textContent = "Enter a valid 3-letter airport code (IATA).";
        originErr.style.display = "block";
        return false;
      }
      try {
        const st = gfEnsureInit();
        const gf = st.google || {};
        const list = Array.isArray(gf.airports)
          ? gf.airports.slice()
          : Array.isArray(__GF_DEFAULT_AIRPORTS)
            ? __GF_DEFAULT_AIRPORTS.slice()
            : [];
        let idx = list.findIndex((x) => String(x || "").toUpperCase() === c);
        if (idx < 0) {
          // If not present, add it to the front so it's included in the rotation.
          list.unshift(c);
          idx = 0;
        }
        gf.airports = list;
        gf.originIdx = idx;

        // keep totals consistent with the configured airports list
        gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};
        gf.totals.airports = list.length;

        gf.updatedAt = gfNowIso();
        gf.lastLog = `origin_set:${c}`;
        st.google = gf;
        window?.QCoreContent?.setState(st);
        try {
          gfWriteLS(gf);
        } catch {}
        renderOriginMeta(c);
        try {
          api.addLog(`🛫 Origin set → ${c}`);
        } catch {}
        try {
          gfUpdateModal(api, st);
        } catch {}
        return true;
      } catch (e) {
        originErr.textContent = "Failed to set origin";
        originErr.style.display = "block";
        return false;
      }
    };

    const dateSetState = (iso) => {
      const v = String(iso || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      if (String(v) > __GF_END_DATE_ISO) return false;
      try {
        const st = gfEnsureInit();
        st.google = st.google || {};
        st.google.dateIso = v;
        st.google.updatedAt = gfNowIso();
        st.google.lastLog = `date_set:${v}`;
        window?.QCoreContent?.setState(st);
        try {
          gfWriteLS(st.google);
        } catch {}
        try {
          api.addLog(`📅 Date set → ${v}`);
        } catch {}
        try {
          gfUpdateModal(api, st);
        } catch {}
        return true;
      } catch {
        return false;
      }
    };

    dateInput.addEventListener("change", () => {
      try {
        const v = String(dateInput.value || "").trim();
        if (!dateSetState(v)) {
          // Soft revert to current state date if invalid
          const st = gfEnsureInit();
          if (st?.google?.dateIso) dateInput.value = st.google.dateIso;
        }
      } catch {}
    });

    // Autocomplete search / dropdown
    let originActiveIdx = -1;
    const hideOriginDrop = () => {
      try {
        originDrop.style.display = "none";
      } catch {}
      originActiveIdx = -1;
    };

    const showOriginDrop = () => {
      try {
        if (originDrop && originDrop.childElementCount) originDrop.style.display = "block";
      } catch {}
    };

    const clearOriginDrop = () => {
      try {
        while (originDrop.firstChild) originDrop.removeChild(originDrop.firstChild);
      } catch {}
    };

    const scoreAirport = (rec, q) => {
      try {
        const query = String(q || "").toLowerCase();
        if (!query) return 0;
        const code = String(rec.code || "").toLowerCase();
        const city = String(rec.city || "").toLowerCase();
        const country = String(rec.country || "").toLowerCase();
        const blob = String(rec.blob || "");
        // Simple heuristics: exact code > prefix > city prefix > contains
        if (code === query) return 1000;
        if (code.startsWith(query)) return 800;
        if (city.startsWith(query)) return 650;
        if (country.startsWith(query)) return 500;
        const idx = blob.indexOf(query);
        if (idx >= 0) return 300 - Math.min(250, idx);
        return 0;
      } catch {
        return 0;
      }
    };

    const findAirports = (q, limit = 14) => {
      const query = String(q || "").trim().toLowerCase();
      if (!query) return [];
      const out = [];
      for (const rec of Array.isArray(airportIndex?.list) ? airportIndex.list : []) {
        if (!rec || !rec.blob) continue;
        if (rec.blob.indexOf(query) === -1) continue;
        const score = scoreAirport(rec, query);
        if (score <= 0) continue;
        out.push({ rec, score });
      }
      out.sort((a, b) => b.score - a.score || String(a.rec.code).localeCompare(String(b.rec.code)));
      return out.slice(0, limit).map((x) => x.rec);
    };

    const renderOriginDrop = (q) => {
      const items = findAirports(q, 16);
      clearOriginDrop();
      originActiveIdx = -1;

      if (!items.length) {
        hideOriginDrop();
        return;
      }

      items.forEach((rec, idx) => {
        const row = document.createElement("div");
        row.style.cssText =
          "padding:8px 10px;cursor:pointer;display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.06)";
        row.onmouseenter = () => {
          originActiveIdx = idx;
          Array.from(originDrop.children).forEach((c, i) => {
            c.style.background = i === originActiveIdx ? "rgba(59,130,246,.18)" : "transparent";
          });
        };
        row.onclick = () => {
          try {
            originInput.value = rec.code;
            renderOriginMeta(rec.code);
            originSetState(rec.code);
            hideOriginDrop();
          } catch {}
        };

        const left = document.createElement("div");
        left.textContent = rec.code;
        left.style.cssText = "font-weight:1000;color:#e5e7eb;min-width:52px;letter-spacing:.8px";
        row.appendChild(left);

        const right = document.createElement("div");
        right.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0";
        const line1 = document.createElement("div");
        const parts = [];
        if (rec.city) parts.push(rec.city);
        if (rec.region) parts.push(rec.region);
        if (rec.country) parts.push(rec.country);
        line1.textContent = parts.join(", ") || rec.name || "";
        line1.style.cssText =
          "color:rgba(255,255,255,.85);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        right.appendChild(line1);

        if (rec.name) {
          const line2 = document.createElement("div");
          line2.textContent = rec.name;
          line2.style.cssText =
            "color:#64748b;font-size:11px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          right.appendChild(line2);
        }

        row.appendChild(right);
        originDrop.appendChild(row);
      });

      // last row border cleanup
      try {
        const last = originDrop.lastChild;
        if (last && last.style) last.style.borderBottom = "none";
      } catch {}

      showOriginDrop();
    };

    originInput.addEventListener("input", () => {
      try {
        const raw = String(originInput.value || "");
        renderOriginMeta(raw);
        renderOriginDrop(raw);
      } catch {}
    });

    originInput.addEventListener("focus", () => {
      try {
        const raw = String(originInput.value || "");
        renderOriginDrop(raw);
      } catch {}
    });

    originInput.addEventListener("keydown", (e) => {
      try {
        const key = e.key;
        const children = Array.from(originDrop.children || []);
        if (key === "Escape") {
          hideOriginDrop();
          return;
        }
        if (key === "ArrowDown") {
          if (!children.length) return;
          e.preventDefault();
          originActiveIdx = Math.min(children.length - 1, originActiveIdx + 1);
          children.forEach((c, i) => (c.style.background = i === originActiveIdx ? "rgba(59,130,246,.18)" : "transparent"));
          children[originActiveIdx]?.scrollIntoView?.({ block: "nearest" });
          return;
        }
        if (key === "ArrowUp") {
          if (!children.length) return;
          e.preventDefault();
          originActiveIdx = Math.max(0, originActiveIdx - 1);
          children.forEach((c, i) => (c.style.background = i === originActiveIdx ? "rgba(59,130,246,.18)" : "transparent"));
          children[originActiveIdx]?.scrollIntoView?.({ block: "nearest" });
          return;
        }
        if (key === "Enter") {
          // If a suggestion is highlighted, choose it.
          if (children.length) {
            e.preventDefault();
            if (originActiveIdx < 0) originActiveIdx = 0;
            children[Math.max(0, Math.min(children.length - 1, originActiveIdx))]?.click?.();
            return;
          }
          // Otherwise, parse code from input and apply.
          const code = gfNormalizeAirportCode(originInput.value);
          if (code && /^[A-Z]{3}$/.test(code)) {
            originInput.value = code;
            renderOriginMeta(code);
            originSetState(code);
            hideOriginDrop();
          }
          return;
        }
      } catch {}
    });

    // Close dropdown when clicking outside
    setTimeout(() => {
      try {
        document.addEventListener("mousedown", (ev) => {
          try {
            if (!originField.wrap.contains(ev.target)) hideOriginDrop();
          } catch {}
        });
      } catch {}
    }, 0);

    controls.appendChild(dateField.wrap);
    controls.appendChild(originField.wrap);

    const body = document.createElement("div");
    body.style.cssText = "display:grid;grid-template-columns: 1fr;gap:10px;padding:10px 14px;overflow:auto";

    const logWrap = document.createElement("div");
    logWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
    const logHead = document.createElement("div");
    logHead.textContent = "Log";
    logHead.style.cssText = "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
    const log = document.createElement("pre");
    log.style.cssText =
      "margin:0;padding:10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.25;color:#e5e7eb";
    log.textContent = "";

    logWrap.appendChild(logHead);
    logWrap.appendChild(log);

    const tableWrap = document.createElement("div");
    tableWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
    const tableHead = document.createElement("div");
    tableHead.textContent = "Prices (latest)";
    tableHead.style.cssText = "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
    const thead = document.createElement("thead");
    thead.innerHTML =
      '<tr style="text-align:left;color:rgba(255,255,255,.75)">' +
      '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Origin</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Destination</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Date</th>' +
      '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Price</th>' +
      "</tr>";
    const tbody = document.createElement("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(tableHead);
    tableWrap.appendChild(table);

    body.appendChild(logWrap);
    body.appendChild(tableWrap);

    card.appendChild(head);
    card.appendChild(stats);
    card.appendChild(controls);
    card.appendChild(body);
    root.appendChild(card);
    document.body.appendChild(root);

    // dock label (tiny)
    const dock = document.createElement("div");
    dock.style.cssText =
      "position:fixed;right:10px;bottom:10px;z-index:2147483646;padding:6px 10px;border-radius:999px;background:rgba(2,6,23,.85);border:1px solid rgba(255,255,255,.10);color:#e5e7eb;font-weight:800;font-size:12px;cursor:pointer;user-select:none";
    dock.textContent = "Google Flights • show";

    const __GF_MODAL_Z = 2147483647;

    const applyHiddenStyle = (hidden) => {
      try {
        // Keep mounted so the dock can always bring it back.
        root.style.display = "flex";

        if (hidden) {
          // user-requested: move it off-screen + behind everything
          root.style.zIndex = "-999";
          root.style.pointerEvents = "none";
          root.style.opacity = "0";
          root.style.transform = "translateX(-9999px)";
        } else {
          root.style.zIndex = String(__GF_MODAL_Z);
          root.style.pointerEvents = "auto";
          root.style.opacity = "1";
          root.style.transform = "";
        }
      } catch {}
    };

    const persistUiHidden = (hidden) => {
      try {
        let state = gfEnsureInit();
        state.google.uiHidden = !!hidden;
        // "Open" is the inverse of "hidden" for this modal.
        state.google.uiOpen = !state.google.uiHidden;
        state.google.modalOpen = state.google.uiOpen;
        state.google.updatedAt = gfNowIso();
        window?.QCoreContent?.setState(state);

        // Persist immediately so a later gfEnsureInit() call can't snap the UI back
        // to an older localStorage snapshot.
        try { gfWriteLS(state.google); } catch {}
        try { gfWriteProgressLS(state.google); } catch {}
      } catch {}
    };

    const setHidden = (hidden, { persist = true } = {}) => {
      const h = !!hidden;
      if (persist) persistUiHidden(h);
      applyHiddenStyle(h);
      if (h) dock.textContent = "Google Flights • show";
      else dock.textContent = "Google Flights • open";
    };

    dock.onclick = () => setHidden(false);
    document.body.appendChild(dock);

    const api = {
      el: root,
      dock,
      btnStart,
      btnPause,
      btnReset,
      btnImport,
      btnExport,
      btnClose,

      // Controls (inputs)
      controls,
      dateInput,
      originInput,
      originMeta,
      originDrop,

      setStats({ page, running, stage, dateLabel, origin, originPos, totals, last } = {}) {
        lineRun.textContent = `Page: ${page || location.href}`;
        lineDate.textContent = `Run: ${running ? "🟢 running" : "⚪ stopped"}   •   Stage: ${stage || "-"}`;
        lineTotals.textContent = `Date: ${dateLabel || "-"}   •   Origin: ${origin || "-"} (${originPos || "-"})`;
        lineLast.textContent =
          `Totals: airports=${totals?.airports ?? "-"}  origin-jobs=${totals?.originJobsDone ?? "-"}  datesDone=${totals?.datesDone ?? "-"}  cache=${totals?.recordsCache ?? "-"}  db=${totals?.recordsDb ?? totals?.records ?? "-"}  total=${totals?.recordsTotal ?? totals?.recordsDb ?? totals?.records ?? "-"}` +
          (last ? `
  Last: ${last}` : "");
      },

      addLog(msg) {
        const ts = new Date().toLocaleTimeString("en-US");
        log.textContent = `${ts}  ${msg}
  ` + log.textContent;
      },

      setRows(rows) {
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        (rows || []).slice(0, 200).forEach((r) => {
          const dest = `${r.destination ? r.destination + " - " : ""}${r.destinationCity || ""}`;
          const tr = document.createElement("tr");
          tr.innerHTML =
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${__gfEscapeHtml(r.origin)}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${__gfEscapeHtml(dest)}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${__gfEscapeHtml(r.dateIso || "")}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">$${__gfEscapeHtml(String(r.priceUsd || ""))}</td>`;
          tbody.appendChild(tr);
        });
      },

      setHidden,

      showOnly() {
        setHidden(false);
      },

      hideOnly() {
        setHidden(true);
      },
    };

    btnClose.onclick = () => api.hideOnly();
    return api;
  }

  function gfUpdateModal(modal, state) {
    try {
      if (!modal) return;

      const root = state && typeof state === "object" ? state : gfEnsureInit();
      const gf = root.google || {};

      const airports = Array.isArray(gf.airports) ? gf.airports : [];
      const originIdx = Number.isFinite(Number(gf.originIdx)) ? Math.max(0, Math.floor(Number(gf.originIdx))) : 0;
      const safeIdx = airports.length ? Math.min(originIdx, airports.length - 1) : 0;
      const origin = gfNormalizeAirportCode(airports[safeIdx] || airports[0] || "");

      const dateIso = String(gf.dateIso || "");
      const dateLabel = `${gfFormatDateForInput(dateIso)} (${dateIso})`;

      modal.setStats({
        page: location.href,
        running: !!gf.running && !gf.paused,
        stage: gf.stage || "-",
        dateLabel,
        origin,
        originPos: airports.length ? `${safeIdx + 1}/${airports.length}` : "-",
        totals: gf.totals || {},
        last: gf.lastTickInfo || gf.lastLog || "",
      });

      // Sync controls (Start Date / Start Airport) to current cursor (unless user is editing)
      try {
        if (modal.dateInput && document.activeElement !== modal.dateInput) {
          const v = String(dateIso || "");
          if (modal.dateInput.value !== v) modal.dateInput.value = v;
        }
      } catch {}

      try {
        if (modal.originInput && document.activeElement !== modal.originInput) {
          if (modal.originInput.value !== origin) modal.originInput.value = origin;
        }
      } catch {}

      try {
        if (modal.originMeta && document.activeElement !== modal.originInput) {
          const idx = window.__qcoreAirportIndex;
          const rec = idx && idx.byCode ? idx.byCode[origin] : null;
          if (rec) {
            const parts = [];
            if (rec.city) parts.push(rec.city);
            if (rec.region) parts.push(rec.region);
            if (rec.country) parts.push(rec.country);
            modal.originMeta.textContent = parts.join(", ");
          } else {
            modal.originMeta.textContent = "";
          }
        }
      } catch {}

      const latest = (Array.isArray(gf.records) ? gf.records : []).slice(-40).reverse();
      modal.setRows(latest);

      const recCount = Number.isFinite(Number(gf?.totals?.recordsDb))
        ? Number(gf.totals.recordsDb)
        : (Number.isFinite(Number(gf?.totals?.recordsTotal))
          ? Number(gf.totals.recordsTotal)
          : (Array.isArray(gf.records) ? gf.records : []).length);
      modal.dock.textContent = gf.uiHidden
        ? `Google Flights • ${recCount} • hidden (click to show)`
        : `Google Flights • ${recCount} • ${origin} ${dateIso}`;

      // Apply hide/show without blocking the runner
      try {
        if (typeof modal.setHidden === "function") {
          modal.setHidden(!!gf.uiHidden, { persist: false });
        }
      } catch {}

      // Keep visible while running unless user hid it
      try {
        if (gf.running && !gf.paused && !gf.uiHidden) modal.el.style.display = "flex";
      } catch {}
    } catch {}
  }

  async function gfExportJson(state, { modal = null, mode = "snapshot" } = {}) {
    try {
      const st = state && typeof state === "object" ? state : gfEnsureInit();
      const gf = st.google || {};

      const airports = gf.airports || [];
      const jobs = gf.jobs || {};
      const totals = { ...(gf.totals || {}) };

      const wantFull = String(mode || "").toLowerCase() === "full";

      let records = [];
      let exportedFrom = "cache";

      if (wantFull) {
        // FULL export: pull every record from IndexedDB (authoritative) when available.
        if (gfDbSupported()) {
          exportedFrom = "indexeddb_full";
          const expected = await gfDbCountRecords();
          try { if (modal) modal.addLog(`Export: reading ${expected} records from IndexedDB…`); } catch {}

          records = await gfDbGetAllRecords({
            onProgress: (n) => {
              try { if (modal) modal.addLog(`Export progress: ${n}…`); } catch {}
            },
          });

          totals.recordsDb = records.length;
          totals.records = records.length;
          totals.recordsCache = Array.isArray(gf.records) ? gf.records.length : 0;
          const prevTotal = Number.isFinite(Number(totals.recordsTotal)) ? Number(totals.recordsTotal) : 0;
          totals.recordsTotal = Math.max(prevTotal, records.length);
        } else {
          // No IndexedDB support: best effort export the in-memory cache (may be truncated).
          exportedFrom = "cache_full_fallback";
          records = Array.isArray(gf.records) ? gf.records : [];
          totals.recordsCache = records.length;
          totals.recordsDb = records.length;
          totals.records = records.length;
          const prevTotal = Number.isFinite(Number(totals.recordsTotal)) ? Number(totals.recordsTotal) : 0;
          totals.recordsTotal = Math.max(prevTotal, records.length);
        }
      } else {
        // SNAPSHOT export: small + fast (used for periodic backup before forced refresh).
        // Includes cursor/totals/jobs plus only the small UI cache of records.
        records = Array.isArray(gf.records) ? gf.records : [];
        totals.recordsCache = records.length;

        if (gfDbSupported()) {
          exportedFrom = "indexeddb_snapshot";
          const dbCount = await gfDbCountRecords();
          totals.recordsDb = dbCount;
          totals.records = dbCount;
          const prevTotal = Number.isFinite(Number(totals.recordsTotal)) ? Number(totals.recordsTotal) : 0;
          totals.recordsTotal = Math.max(prevTotal, dbCount);
        } else {
          exportedFrom = "cache_snapshot";
          totals.recordsDb = records.length;
          totals.records = records.length;
          const prevTotal = Number.isFinite(Number(totals.recordsTotal)) ? Number(totals.recordsTotal) : 0;
          totals.recordsTotal = Math.max(prevTotal, records.length);
        }
      }

      const payload = {
        exportedAt: gfNowIso(),
        exportMode: wantFull ? "full" : "snapshot",
        exportedFrom,
        airports,
        totals,
        dateIso: gf.dateIso,
        originIdx: gf.originIdx,
        recordCount: Array.isArray(records) ? records.length : 0,
        records,
        jobs,
      };

      // Pretty-print small exports; keep large exports compact (much faster + smaller).
      const pretty = (payload.recordCount || 0) <= 5000;
      const json = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);

      const blob = new Blob([json], { type: "application/json" });
      const tag = wantFull ? "google_flights_full" : "google_flights_snapshot";
      const name = __qcoreMakeScrapeFilename(tag, "json");
      __qcoreDownloadBlob(blob, name);
      return true;
    } catch (e) {
      try { if (modal) modal.addLog(`Export failed: ${String(e && e.message ? e.message : e)}`); } catch {}
      return false;
    }
  }

  // ---------- Auto export (every 60s) ----------
  // Runs the same logic as clicking the Export button, but with overlap protection.
  async function gfRunExport(modal, { mode = "full", reason = "manual" } = {}) {
    const ctl = (window.__qcoreGoogleFlightsAutoExportCtl = window.__qcoreGoogleFlightsAutoExportCtl || {});
    if (ctl.exportInFlight) {
      try { modal?.addLog?.(`⏱️ Export skipped (already running) — ${reason}`); } catch {}
      return false;
    }
    ctl.exportInFlight = true;
    try {
      const s = gfEnsureInit();
      try { gfLog(modal, s, `Export started (${mode}) — ${reason} …`); } catch {}
      const ok = await gfExportJson(s, { modal, mode });
      const s2 = gfEnsureInit();
      try { gfLog(modal, s2, ok ? "Export complete" : "Export failed (see above)"); } catch {}
      try { gfUpdateModal(modal, s2); } catch {}
      return ok;
    } catch (e) {
      try { modal?.addLog?.(`Export exception: ${String(e?.message || e)}`); } catch {}
      return false;
    } finally {
      ctl.exportInFlight = false;
    }
  }

  function gfStartAutoExport(modal) {
    try {
      const ctl = (window.__qcoreGoogleFlightsAutoExportCtl = window.__qcoreGoogleFlightsAutoExportCtl || {});
      ctl.modal = modal || ctl.modal || null;

      if (ctl.timerId) return; // already running

      ctl.timerId = setInterval(async () => {
        try {
          const st = gfEnsureInit();
          if (!st?.google?.running || st.google.paused) return;
          await gfRunExport(ctl.modal || modal || null, { mode: "full", reason: "auto_60s" });
        } catch {}
      }, __GF_AUTO_EXPORT_INTERVAL_MS);

      try { modal?.addLog?.(`⏱️ Auto-export armed: every ${Math.round(__GF_AUTO_EXPORT_INTERVAL_MS / 1000)}s (full)`); } catch {}
    } catch {}
  }

  function gfStopAutoExport() {
    try {
      const ctl = window.__qcoreGoogleFlightsAutoExportCtl;
      if (!ctl) return;
      if (ctl.timerId) clearInterval(ctl.timerId);
      ctl.timerId = 0;
    } catch {}
  }

  function gfPickFiles({ multiple = true, accept = ".json,.ndjson,application/json" } = {}) {
    return new Promise((resolve) => {
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = !!multiple;
        input.accept = String(accept || "");
        input.onchange = () => {
          try {
            const files = Array.from(input.files || []);
            resolve(files);
          } catch {
            resolve([]);
          }
        };
        input.click();
      } catch {
        resolve([]);
      }
    });
  }

  function gfReadFileAsText(file) {
    return new Promise((resolve, reject) => {
      try {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => reject(fr.error || new Error("file read error"));
        fr.readAsText(file);
      } catch (e) {
        reject(e);
      }
    });
  }

  function gfParseRecordsFromText(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];

    // JSON payload: { records: [...] }
    try {
      if (raw.startsWith("{")) {
        const obj = JSON.parse(raw);
        const recs = obj && typeof obj === "object" ? obj.records : null;
        return Array.isArray(recs) ? recs : [];
      }
    } catch {}

    // JSON array: [ ...records... ]
    try {
      if (raw.startsWith("[")) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    } catch {}

    // NDJSON: one JSON object per line
    try {
      const out = [];
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj === "object") {
            if (Array.isArray(obj.records)) out.push(...obj.records);
            else out.push(obj);
          }
        } catch {}
      }
      return out;
    } catch {
      return [];
    }
  }

  function gfNormalizeImportedRecord(r) {
    try {
      const now = gfNowIso();
      const src = r && typeof r === "object" ? r : {};
      const origin = gfNormalizeAirportCode(src.origin || src.from || "");
      const dateIso = String(src.dateIso || src.date || "").trim();
      const destinationCity = String(src.destinationCity || src.city || src.destination_name || "").trim();
      const destinationMid = String(src.destinationMid || src.mid || "");
      const priceUsd = Number(src.priceUsd || src.price || 0) || 0;

      let destination = "";
      try {
        destination = gfNormalizeAirportCode(src.destination || src.to || "");
        if (!destination || destination.length !== 3) {
          destination = gfCityToAirportCode(destinationCity) || "";
        }
      } catch {
        destination = "";
      }

      const rec = {
        ...src,
        collectedAt: String(src.collectedAt || src.collected_at || now),
        dateIso,
        origin,
        destination,
        destinationCity,
        destinationMid,
        priceUsd,
      };

      rec.id = String(
        src.id ||
          gfRecordKey(rec.origin, rec.destinationCity, rec.destination, rec.destinationMid, rec.dateIso, rec.priceUsd) ||
          ""
      );

      if (!rec.id) return null;
      if (!rec.origin) return null;
      if (!rec.dateIso) return null;
      if (!rec.destinationCity) return null;
      if (!rec.priceUsd || rec.priceUsd <= 0) return null;
      return rec;
    } catch {
      return null;
    }
  }

  async function gfImportJsonMerge(modal) {
    try {
      if (!gfDbSupported()) {
        const s = gfEnsureInit();
        gfLog(modal, s, "Import requires IndexedDB (not available in this browser)");
        return;
      }

      const files = await gfPickFiles({ multiple: true, accept: ".json,.ndjson,application/json" });
      if (!files.length) return;

      let state = gfEnsureInit();
      gfLog(modal, state, `Import: ${files.length} file(s)…`);

      let totalRead = 0;
      let totalAdded = 0;

      for (const file of files) {
        try {
          const text = await gfReadFileAsText(file);
          const rawRecs = gfParseRecordsFromText(text);
          totalRead += rawRecs.length;

          // Normalize + filter
          const recs = [];
          for (const r of rawRecs) {
            const rec = gfNormalizeImportedRecord(r);
            if (rec) recs.push(rec);
          }

          if (!recs.length) {
            state = gfEnsureInit();
            gfLog(modal, state, `Import: ${file.name} → 0 records (skipped)`);
            continue;
          }

          // Insert in batches (keeps transactions snappy)
          const BATCH = 2000;
          let fileAdded = 0;
          let lastAddedIds = new Set();

          for (let i = 0; i < recs.length; i += BATCH) {
            const chunk = recs.slice(i, i + BATCH);
            const res = await gfDbAddRecordsBatch(chunk);
            fileAdded += Number(res?.added || 0) || 0;
            totalAdded += Number(res?.added || 0) || 0;
            lastAddedIds = res?.addedIds instanceof Set ? res.addedIds : lastAddedIds;

            // Update UI cache with the latest inserted chunk
            try {
              state = gfEnsureInit();
              for (const rr of chunk.slice(-25)) {
                if (lastAddedIds && lastAddedIds.has && lastAddedIds.has(String(rr.id))) {
                  gfDedupPushRecord(state, rr);
                }
              }
              window?.QCoreContent?.setState(state);
            } catch {}
          }

          state = gfEnsureInit();
          gfLog(modal, state, `Import: ${file.name} → +${fileAdded}/${recs.length}`);
        } catch (e) {
          state = gfEnsureInit();
          gfLog(modal, state, `Import error (${file.name}): ${String(e && e.message ? e.message : e)}`);
        }
      }

      const dbCount = await gfDbCountRecords();

      state = gfEnsureInit();
      state.google.totals = state.google.totals && typeof state.google.totals === "object" ? state.google.totals : {};
      state.google.totals.recordsDb = dbCount;
      state.google.totals.recordsCache = Array.isArray(state.google.records) ? state.google.records.length : 0;
      state.google.totals.records = dbCount;
      const prevTotal = Number.isFinite(Number(state.google.totals.recordsTotal)) ? Number(state.google.totals.recordsTotal) : 0;
      state.google.totals.recordsTotal = Math.max(prevTotal, dbCount);
      state.google.updatedAt = gfNowIso();

      window?.QCoreContent?.setState(state);
      try { gfWriteLS(state.google); } catch {}
      try { gfWriteProgressLS(state.google); } catch {}
      try { gfUpdateModal(modal, state); } catch {}

      gfLog(modal, state, `Import done: read=${totalRead}  added=${totalAdded}  db=${dbCount}`);
    } catch {}
  }

  function gfResetAll(modal) {
    const root = window?.QCoreContent?.getState() || {};
    const now = gfNowIso();
    const airports = Array.isArray(__GF_DEFAULT_AIRPORTS) ? __GF_DEFAULT_AIRPORTS.slice() : [];

    root.google = {
      version: 2,
      createdAt: now,
      updatedAt: now,

      airports,

      running: false,
      paused: false,
      uiHidden: false,
      uiOpen: false,
      modalOpen: false,
      stage: "idle",
      tickId: 0,

      dateIso: gfTodayIsoDate(),
      originIdx: 0,

      totals: {
        airports: airports.length,
        originJobsDone: 0,
        datesDone: 0,
        records: 0,
        recordsTotal: 0,
      },

      jobs: {},
      records: [],
      __recordKeys: {},

      lastLog: "reset",
      lastTickInfo: "reset",
    };

    window?.QCoreContent?.setState(root);
    try { gfWriteLS(root.google); } catch {}
    try { gfWriteProgressLS(root.google); } catch {}

    // Stop auto-export on reset (prevents exporting empty state every 60s)
    try { gfStopAutoExport(); } catch {}

    gfLog(modal, root, "Reset complete (clearing IndexedDB…)");
    gfUpdateModal(modal, root);

    try {
      gfDbClearAll().then((ok) => {
        try {
          const s = gfEnsureInit();
          if (modal) gfLog(modal, s, ok ? "IndexedDB cleared" : "IndexedDB clear failed");
          if (modal) gfUpdateModal(modal, s);
        } catch {}
      });
    } catch {}
  }

  function gfStart(modal) {
    // Enforce Explore-only.
    if (!gfIsExploreBaseUrl(location.href)) {
      gfEnforceExploreOnly({ reason: "start_not_explore" });
      return;
    }

    const state = gfEnsureInit();
    const gf = state.google;

    gf.running = true;
    gf.paused = false;
    gf.stage = "explore";
    gf.tickId = Number(gf.tickId || 0) + 1;
    gf.lastTickInfo = "start";
    gf.updatedAt = gfNowIso();

    window?.QCoreContent?.setState(state);
    gfLog(modal, state, "Runner started");
    gfUpdateModal(modal, state);

    // Arm auto-export (every 60s) while running
    try { gfStartAutoExport(modal); } catch {}

    setTimeout(() => gfAutoTick("start_btn"), __GF_STEP_DELAY_MS);
  }

  function gfPause(modal) {
    const state = gfEnsureInit();
    const gf = state.google;

    // IMPORTANT: increment tickId so any in-flight async work aborts immediately
    gf.tickId = Number(gf.tickId || 0) + 1;

    gf.paused = true;
    gf.running = false;
    gf.stage = "paused";
    gf.lastTickInfo = "paused";
    gf.updatedAt = gfNowIso();

    window?.QCoreContent?.setState(state);
    gfLog(modal, state, "Paused (progress frozen)");
    gfUpdateModal(modal, state);
  }

  // ---------- Scraping helpers ----------
  function gfFindPriceEls() {
    try {
      const spans = Array.from(document.querySelectorAll('span[aria-label$="US dollars"], span[aria-label$="US dollar"]'));
      if (spans.length) return spans;
    } catch {}

    try {
      return Array.from(document.querySelectorAll("span[aria-label]")).filter((el) => /us dollars?/i.test(String(el.getAttribute("aria-label") || "")));
    } catch {
      return [];
    }
  }

  function gfParsePriceUsdFromText(text) {
    try {
      const raw = String(text || "").trim();
      if (!raw) return null;
      const cleaned = raw.replace(/[^0-9]/g, "");
      const num = parseInt(cleaned, 10);
      return Number.isFinite(num) ? num : null;
    } catch {
      return null;
    }
  }

  function gfPickCityFromText(raw) {
    const t = String(raw || "").trim();
    if (!t) return "";
    const first = t
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)[0];
    if (!first) return "";
    if (/us dollars/i.test(first)) return "";
    if (/^\$?\d/.test(first)) return "";
    return first;
  }

  function gfExtractCityFromPriceEl(priceEl) {
    try {
      if (!priceEl) return "";
      const p1 = priceEl.parentElement || null;
      const p2 = p1?.parentElement || null;

      const trySibling = (node) => {
        if (!node) return "";
        const prev = node.previousElementSibling;
        const next = node.nextElementSibling;

        for (const sib of [prev, next]) {
          if (!sib || sib.tagName !== "DIV") continue;
          const city = gfPickCityFromText(sib.textContent || "");
          if (city) return city;
        }
        return "";
      };

      let city = trySibling(p2);
      if (city) return city;

      let cur = p2 || p1 || priceEl;
      for (let i = 0; i < 12 && cur; i++) {
        city = trySibling(cur);
        if (city) return city;
        cur = cur.parentElement;
      }

      const host = priceEl.closest("div[data-mid]") || priceEl.closest("[data-mid]");
      if (host) {
        const byJs = host.querySelector('[jsname="sMqrvf"]');
        city = gfPickCityFromText(byJs?.textContent || "");
        if (city) return city;
      }

      return "";
    } catch {
      return "";
    }
  }

  function gfExtractCityFromPriceSpan(span) {
    try {
      const level4 = span?.parentElement?.parentElement?.parentElement?.parentElement || null;
      let locationText = level4?.querySelector("h3")?.textContent?.trim();

      if (!locationText) {
        const level3 = span?.parentElement?.parentElement?.parentElement || null;
        locationText = level3?.querySelector("div")?.textContent?.trim() || "";
      }

      locationText = gfPickCityFromText(locationText);

      if (!locationText) {
        locationText = gfExtractCityFromPriceEl(span);
      }

      return locationText || "";
    } catch {
      return "";
    }
  }

  async function gfWaitForPrices(modal, state, runToken, { minCount = 1, timeoutMs = __GF_PRICE_READY_TIMEOUT_MS } = {}) {
    const start = gfNowMs();
    let last = 0;
    while (gfNowMs() - start < timeoutMs) {
      gfAssertStillRunning(runToken);
      const els = gfFindPriceEls();
      last = els.length;
      if (last >= (minCount || 1)) {
        gfLog(modal, state, `Prices ready: ${last} nodes`);
        return els;
      }
      gfLog(modal, state, `Waiting for prices… (${last})`);
      await gfAbortableSleep(runToken, __GF_PRICE_READY_POLL_MS);
    }
    gfLog(modal, state, `Price wait timeout. Last count=${last}`);
    return gfFindPriceEls();
  }

  // ---------- Explore page interactions ----------
  async function gfEnsureOneWay(modal, state, runToken) {
    state.google.stage = "ticket_type";
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    gfAssertStillRunning(runToken);

    let trigger = null;
    try {
      const hint = document.querySelector('[aria-label="Change ticket type."]');
      trigger =
        hint?.closest('[role="combobox"][aria-haspopup="listbox"]') ||
        hint?.closest('[role="button"][aria-haspopup="listbox"]') ||
        null;
    } catch {}

    if (!trigger) {
      try {
        const combos = Array.from(document.querySelectorAll('[role="combobox"]')).filter((el) => el && el.tagName !== "INPUT");
        trigger = combos.find((el) => /one way|round trip/i.test(String(el.textContent || ""))) || null;
      } catch {}
    }

    if (!trigger) {
      gfLog(modal, state, 'Ticket type control not found — continuing (might already be "One way")');
      return;
    }

    const cur = String(trigger.textContent || "").toLowerCase();
    if (cur.includes("one way")) {
      gfLog(modal, state, "Ticket type already: One way");
      return;
    }

    gfLog(modal, state, 'Set ticket type → "One way"');
    trigger.click();
    await gfAbortableSleep(runToken, 300);

    let oneWayOpt = null;
    try {
      const opts = Array.from(document.querySelectorAll('[role="option"]'));
      oneWayOpt = opts.find((o) => String(o.textContent || "").trim().toLowerCase() === "one way") || null;
    } catch {}

    if (oneWayOpt) {
      oneWayOpt.click();
      await gfAbortableSleep(runToken, 400);
    } else {
      gfLog(modal, state, '"One way" option not found — continuing');
    }
  }

  async function gfSetOriginAndDateOnExplore(modal, state, runToken) {
    gfAssertStillRunning(runToken);

    const gf = state.google || {};
    const airports = Array.isArray(gf.airports) ? gf.airports : [];
    const originIdx = Number.isFinite(Number(gf.originIdx)) ? Math.max(0, Math.floor(Number(gf.originIdx))) : 0;

    const origin = gfNormalizeAirportCode(airports[originIdx] || airports[0] || "LAX") || "LAX";
    const dateIso = String(gf.dateIso || "").trim();
    const dateLabel = gfFormatDateForInput(dateIso);

    // -------------------- DATE FIRST --------------------
    gf.stage = "set_date";
    gf.lastTickInfo = `set date → ${dateIso}`;
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    const dateInput =
      document.querySelector('input[placeholder="Departure"][type="text"]') ||
      document.querySelector('input[aria-label^="Departure"][type="text"]') ||
      document.querySelector('input[placeholder^="Departure"]') ||
      document.querySelector('input[aria-label^="Departure"]');

    if (!dateInput) throw new Error('Date input not found (placeholder/aria-label starts with "Departure")');

    const hitEnter3 = async () => {
      try {
        dateInput.focus();
      } catch {}
      gfKeyEnter(dateInput);
      await gfAbortableSleep(runToken, 120);
      gfKeyEnter(dateInput);
      await gfAbortableSleep(runToken, 120);
      gfKeyEnter(dateInput);
    };

    const curDateVal = String(dateInput.value || "").trim();
    if (curDateVal === String(dateLabel || "").trim()) {
      gfLog(modal, state, `Date already set → ${dateLabel} (skip)`);
      await hitEnter3();
      await gfAbortableSleep(runToken, 180);
    } else {
      gfLog(modal, state, `Date → ${dateLabel}`);
      gfSetValueWithEvents(dateInput, dateLabel);
      await hitEnter3();
      await gfAbortableSleep(runToken, __GF_AFTER_ENTER_DELAY_MS);
    }

    gfAssertStillRunning(runToken);

    // -------------------- ORIGIN SECOND --------------------
    gf.stage = "set_origin";
    gf.lastTickInfo = `set origin → ${origin}`;
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    gfLog(modal, state, `Origin → ${origin}`);

    const prevSig = (() => {
      try {
        const spans = gfFindPriceEls().slice(0, 8);
        return spans
          .map((s) => {
            const mid = s.closest("[data-mid]")?.getAttribute("data-mid") || "";
            const al = s.getAttribute("aria-label") || "";
            const txt = String(s.textContent || "").trim();
            return `${mid}|${al}|${txt}`;
          })
          .join("||");
      } catch {
        return "";
      }
    })();

    const findOriginInput = () => {
      return (
        document.querySelector('input[role="combobox"][aria-label^="Where from"][type="text"]') ||
        document.querySelector('input[aria-label^="Where from"][type="text"]') ||
        document.querySelector('input[role="combobox"][aria-label^="Where from"]') ||
        document.querySelector('input[aria-label^="Where from"]') ||
        document.querySelector('input[placeholder^="Where from"][type="text"]') ||
        document.querySelector('input[placeholder^="Where from"]') ||
        null
      );
    };

    const isOriginCommitted = (code) => {
      try {
        const el = findOriginInput();
        if (!el) return false;

        const al = String(el.getAttribute("aria-label") || "");
        if (al && al.toUpperCase().includes(String(code || "").toUpperCase())) return true;

        const val = String(el.value || "");
        if (val && val.toUpperCase().includes(String(code || "").toUpperCase())) return true;
      } catch {}
      return false;
    };

    const pickVisibleOptionContaining = (needleUpper) => {
      try {
        const opts = Array.from(document.querySelectorAll('[role="option"]'));
        if (!opts.length) return null;

        const visible = opts.filter((o) => {
          try {
            const r = o.getBoundingClientRect();
            if (!r) return false;
            if (r.width <= 0 || r.height <= 0) return false;
            const ah = String(o.getAttribute("aria-hidden") || "");
            if (ah === "true") return false;
            return true;
          } catch {
            return false;
          }
        });

        const parenMatch = visible.find((o) => new RegExp(`\\(${needleUpper}\\)`).test(String(o.textContent || "").toUpperCase()));
        if (parenMatch) return parenMatch;

        const loose = visible.find((o) => String(o.textContent || "").toUpperCase().includes(needleUpper));
        return loose || null;
      } catch {
        return null;
      }
    };

    const setOriginOnce = async (code) => {
      gfAssertStillRunning(runToken);

      const originInput = findOriginInput();
      if (!originInput) throw new Error('Origin input not found (aria-label/placeholder starts with "Where from")');

      try {
        originInput.scrollIntoView?.({ block: "center", inline: "center" });
      } catch {}
      try {
        originInput.focus();
        originInput.click();
      } catch {}

      gfSetValueWithEvents(originInput, code);
      await gfAbortableSleep(runToken, 200);

      const opt = pickVisibleOptionContaining(String(code || "").toUpperCase());
      if (opt) {
        try {
          opt.click();
        } catch {}
        await gfAbortableSleep(runToken, 200);
      }

      gfKeyEnter(originInput);
      await gfAbortableSleep(runToken, 160);
      gfKeyEnter(originInput);
      await gfAbortableSleep(runToken, 260);

      if (!isOriginCommitted(code)) {
        const alt =
          document.querySelector('input[role="combobox"][aria-label^="Where else?"][type="text"]') ||
          document.querySelector('input[aria-label^="Where else?"][type="text"]') ||
          document.querySelector('input[role="combobox"][aria-label^="Where else?"]') ||
          document.querySelector('input[aria-label^="Where else?"]') ||
          null;

        if (alt) {
          try {
            alt.focus();
            alt.click();
          } catch {}
          gfSetValueWithEvents(alt, code);
          await gfAbortableSleep(runToken, 200);

          const opt2 = pickVisibleOptionContaining(String(code || "").toUpperCase());
          if (opt2) {
            try {
              opt2.click();
            } catch {}
            await gfAbortableSleep(runToken, 200);
          }

          gfKeyEnter(alt);
          await gfAbortableSleep(runToken, 220);
        }
      }
    };

    await setOriginOnce(origin);

    // Clear destination if it is set (Explore needs blank destination to show ALL).
    try {
      const destInput =
        document.querySelector('input[role="combobox"][aria-label^="Where to"][type="text"]') ||
        document.querySelector('input[aria-label^="Where to"][type="text"]') ||
        document.querySelector('input[role="combobox"][aria-label^="Where to"]') ||
        document.querySelector('input[aria-label^="Where to"]') ||
        document.querySelector('input[placeholder^="Where to"][type="text"]') ||
        document.querySelector('input[placeholder^="Where to"]') ||
        null;

      if (destInput && String(destInput.value || "").trim()) {
        gfLog(modal, state, "Clearing destination (to get all prices)");
        gfSetValueWithEvents(destInput, "");
        gfKeyEnter(destInput);
        await gfAbortableSleep(runToken, __GF_AFTER_ENTER_DELAY_MS);
      }
    } catch {}

    // Stops filter (optional). This is fast + guarded if the control isn't present.
    await gfSetStopsNonstopOnExplore(modal, state, runToken);

    // Wait until results signature changes.
    {
      const end = gfNowMs() + 12000;
      let lastSig = "";
      while (gfNowMs() < end) {
        gfAssertStillRunning(runToken);

        lastSig = (() => {
          try {
            const spans = gfFindPriceEls().slice(0, 8);
            return spans
              .map((s) => {
                const mid = s.closest("[data-mid]")?.getAttribute("data-mid") || "";
                const al = s.getAttribute("aria-label") || "";
                const txt = String(s.textContent || "").trim();
                return `${mid}|${al}|${txt}`;
              })
              .join("||");
          } catch {
            return "";
          }
        })();

        if (lastSig && prevSig && lastSig !== prevSig) break;
        if (lastSig && !prevSig) break;

        await gfAbortableSleep(runToken, 250);
      }
    }

    gf.stage = "settle";
    gf.lastTickInfo = `inputs set (date=${dateIso} origin=${origin})`;
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);
  }

  async function gfSetStopsNonstopOnExplore(modal, state, runToken) {
    const gf = state.google || {};

    gf.stage = "stops_menu";
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    gfAssertStillRunning(runToken);

    const stopsBtn =
      document.querySelector('button[aria-haspopup="true"][aria-label^="Stops"]') ||
      document.querySelector('button[aria-haspopup="true"][aria-label*="Stops"]') ||
      document.querySelector('[role="button"][aria-haspopup="true"][aria-label^="Stops"]') ||
      document.querySelector('[role="button"][aria-haspopup="true"][aria-label*="Stops"]') ||
      (() => {
        try {
          const pool = Array.from(document.querySelectorAll("button,[role='button']"));
          return (
            pool.find((el) => {
              const al = String(el.getAttribute?.("aria-label") || "");
              const txt = String(el.textContent || "");
              if (!/stops/i.test(al || txt)) return false;
              const hasPopup = String(el.getAttribute?.("aria-haspopup") || "").toLowerCase() === "true";
              const hasExpanded = el.hasAttribute?.("aria-expanded");
              return hasPopup || hasExpanded;
            }) || null
          );
        } catch {
          return null;
        }
      })();

    if (!stopsBtn) {
      gfLog(modal, state, "Stops button not found — continue anyway");
      return;
    }

    gfLog(modal, state, "Click → Stops dropdown");
    stopsBtn.click();
    await gfAbortableSleep(runToken, 250);

    const findGroup = () => {
      return (
        document.querySelector('div[role="radiogroup"][aria-label="Stops"]') ||
        document.querySelector('[role="radiogroup"][aria-label="Stops"]') ||
        document.querySelector('div[role="radiogroup"][aria-label*="Stops"]') ||
        document.querySelector('[role="radiogroup"][aria-label*="Stops"]') ||
        (() => {
          try {
            const groups = Array.from(document.querySelectorAll('[role="radiogroup"]'));
            const byBoth = groups.find((g) => /non\s*stop/i.test(String(g.textContent || "")) && /stops/i.test(String(g.textContent || "")));
            if (byBoth) return byBoth;
            const byNonstop = groups.find((g) => /non\s*stop/i.test(String(g.textContent || "")));
            return byNonstop || null;
          } catch {
            return null;
          }
        })()
      );
    };

    let group = findGroup();

    if (!group) {
      await gfAbortableSleep(runToken, 250);
      group = findGroup();
    }

    if (!group) {
      gfLog(modal, state, "Stops radiogroup not found — continue anyway");
      return;
    }

    const labels = Array.from(group.querySelectorAll("label,[role='radio']")).filter(Boolean);
    const nonstopLabel =
      labels.find((l) => /non\s*stop/i.test(String(l.textContent || l.getAttribute?.("aria-label") || ""))) ||
      labels.find((l) => /direct/i.test(String(l.textContent || l.getAttribute?.("aria-label") || ""))) ||
      null;

    if (!nonstopLabel) {
      gfLog(modal, state, 'Nonstop label not found — continue anyway');
      return;
    }

    gfLog(modal, state, 'Select → "Nonstop only"');
    nonstopLabel.click();

    gf.stage = "wait_nonstop_refresh";
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    await gfAbortableSleep(runToken, __GF_AFTER_NONSTOP_WAIT_MS);
  }

  async function gfScrapeExplorePrices(modal, state, runToken) {
    gfAssertStillRunning(runToken);

    const gf = state.google || {};

    gf.records = Array.isArray(gf.records) ? gf.records : [];
    gf.jobs = gf.jobs && typeof gf.jobs === "object" && !Array.isArray(gf.jobs) ? gf.jobs : {};
    gf.totals = gf.totals && typeof gf.totals === "object" ? gf.totals : {};

    const airports = Array.isArray(gf.airports) ? gf.airports : [];
    const originIdx = Number.isFinite(Number(gf.originIdx)) ? Math.max(0, Math.floor(Number(gf.originIdx))) : 0;
    const origin = gfNormalizeAirportCode(airports[originIdx] || airports[0] || "LAX") || "LAX";
    const dateIso = String(gf.dateIso || "").trim();

    gf.stage = "wait_prices";
    gf.lastTickInfo = `waiting for prices… (origin=${origin} date=${dateIso})`;
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    await gfAbortableSleep(runToken, __GF_EXPLORE_SETTLE_WAIT_MS);

    const ready = await gfWaitForPrices(modal, state, runToken, { minCount: 1, timeoutMs: __GF_PRICE_READY_TIMEOUT_MS });
    gfAssertStillRunning(runToken);

    const readyCount = Array.isArray(ready) ? ready.length : 0;
    if (readyCount < 1) {
      gf.stage = "scrape_prices";
      gf.lastTickInfo = "prices not detected (timeout) — skipping scrape";
      gf.updatedAt = gfNowIso();
      state.google = gf;
      window?.QCoreContent?.setState(state);
      gfUpdateModal(modal, state);
      gfLog(modal, state, "Prices not detected in time — scrape skipped");
      return { spans: 0, added: 0 };
    }

    gf.stage = "scrape_prices";
    gf.lastTickInfo = "scraping price spans…";
    gf.updatedAt = gfNowIso();
    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);

    const spans = gfFindPriceEls() || [];
    const candidates = [];
    const localSeen = new Set();

    for (const span of spans) {
      gfAssertStillRunning(runToken);

      const city = String(gfExtractCityFromPriceSpan(span) || "").trim();
      if (!city || /^location not found$/i.test(city)) continue;

      const aria = String(span.getAttribute("aria-label") || "");
      const txt = String(span.textContent || "");

      const priceUsd = gfParsePriceUsdFromText(aria) || gfParsePriceUsdFromText(txt);
      if (!priceUsd || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;

      const destinationMid = String(span.closest("[data-mid]")?.getAttribute("data-mid") || "");
      const destination = gfCityToAirportCode(city);

      const rec = {
        id: "",
        collectedAt: gfNowIso(),
        dateIso,
        origin,
        destination,
        destinationCity: city,
        destinationMid,
        priceUsd,
      };

      rec.id = gfRecordKey(rec.origin, rec.destinationCity, rec.destination, rec.destinationMid, rec.dateIso, rec.priceUsd);
      if (!rec.id) continue;

      if (localSeen.has(rec.id)) continue;
      localSeen.add(rec.id);
      candidates.push(rec);
    }

    let added = 0;
    let addedIds = new Set();
    let dbCount = null;

    if (gfDbSupported()) {
      const res = await gfDbAddRecordsBatch(candidates);
      added = Number(res?.added || 0) || 0;
      addedIds = res?.addedIds instanceof Set ? res.addedIds : new Set();
      dbCount = await gfDbCountRecords();
    } else {
      for (const rec of candidates) {
        if (gfDedupPushRecord(state, rec)) {
          added += 1;
          try { addedIds.add(String(rec.id)); } catch {}
        }
      }
    }

    try {
      if (gfDbSupported()) {
        for (const rec of candidates) {
          if (addedIds && addedIds.has && addedIds.has(String(rec.id))) {
            gfDedupPushRecord(state, rec);
          }
        }
      }
    } catch {}

    try {
      const jobKey = gfJobKey(origin, dateIso);
      const prev = gf.jobs[jobKey] || { status: "new", attempts: 0, startedAt: "", finishedAt: "", lastError: "" };
      const wasDone = prev.status === "done";

      prev.status = "done";
      if (!prev.startedAt) prev.startedAt = gfNowIso();
      prev.finishedAt = gfNowIso();
      prev.lastError = "";
      gf.jobs[jobKey] = prev;

      if (!wasDone) {
        gf.totals.originJobsDone = (Number(gf.totals.originJobsDone) || 0) + 1;
      }
    } catch {}

    gf.totals.airports = airports.length || gf.totals.airports || 0;

    gf.totals.recordsCache = Array.isArray(gf.records) ? gf.records.length : 0;

    if (Number.isFinite(Number(dbCount))) {
      gf.totals.recordsDb = Number(dbCount);
    } else {
      const prevDb = Number.isFinite(Number(gf.totals.recordsDb)) ? Number(gf.totals.recordsDb) : 0;
      gf.totals.recordsDb = prevDb + (Number(added) || 0);
    }

    const prevTotal = Number.isFinite(Number(gf.totals.recordsTotal)) ? Number(gf.totals.recordsTotal) : 0;
    gf.totals.recordsTotal = Math.max(prevTotal, Number(gf.totals.recordsDb) || 0);

    gf.totals.records = gf.totals.recordsDb;
    gf.lastTickInfo = `JOB COMPLETE: spans=${spans.length} added=${added} (origin=${origin} date=${dateIso})`;
    gf.updatedAt = gfNowIso();

    state.google = gf;
    window?.QCoreContent?.setState(state);
    gfUpdateModal(modal, state);
    gfLog(modal, state, `JOB COMPLETE: +${added} (spans=${spans.length})`);

    try { gfWriteProgressLS(gf); } catch {}
    try { gfWriteLS(gf); } catch {}

    return { spans: spans.length, added };
  }

  // ---------- Runner ----------
  let __gfTickInFlight = false;

  async function gfAutoTick(reason = "tick") {
    if (__gfTickInFlight) return;
    __gfTickInFlight = true;

    let ctl = window.__qcoreGoogleFlightsCtl;
    let modal = ctl?.modal || null;

    let state = gfEnsureInit();
    const gf = state.google || {};
    const runToken = Number(gf.tickId || 0);

    if (gf.running && !gf.paused) {
      try {
        if (!modal || !modal.el || !document.body.contains(modal.el)) {
          showGoogleFlightsModal({ reason: `auto_reopen:${reason}` });
          ctl = window.__qcoreGoogleFlightsCtl;
          modal = ctl?.modal || null;
        }
        if (modal && modal.el && !gf.uiHidden) modal.el.style.display = "flex";
      } catch {}
    }

    if (typeof __qcorePressHoldActive !== "undefined" && __qcorePressHoldActive) {
      try {
        state.google.lastTickInfo = "paused_for_press_hold";
        state.google.updatedAt = gfNowIso();
        window?.QCoreContent?.setState(state);
        if (modal) gfUpdateModal(modal, state);
      } catch {}
      __gfTickInFlight = false;
      setTimeout(() => gfAutoTick("press_hold_gate"), __GF_STEP_DELAY_MS);
      return;
    }

    if (!gf.running || gf.paused) {
      if (modal) gfUpdateModal(modal, state);
      __gfTickInFlight = false;
      return;
    }

    try {
      const pr = __qcoreMaybePlanForcedRefresh({
        runner: state.google,
        exportFn: () => {
          try {
            const s2 = gfEnsureInit();
            gfExportJson(s2, { mode: "snapshot" });
          } catch {}
        },
        note: "google_flights",
      });
      if (pr && pr.pending) {
        try {
          state.google.stage = "force_refresh_wait";
          state.google.updatedAt = gfNowIso();
          window?.QCoreContent?.setState(state);
          if (modal) gfUpdateModal(modal, state);
        } catch {}
        gfLog(modal, state, "♻️ Forced refresh planned — exported JSON, reloading in 50s");
        __gfTickInFlight = false;
        return;
      }
    } catch {}

    const MAX_ATTEMPTS = 3;

    try {
      if (!gfIsExploreBaseUrl(location.href)) {
        gfEnforceExploreOnly({ reason: `tick_not_explore:${reason}` });
        return;
      }

      gfLog(modal, state, `Tick → ${reason}`);

      if (String(state.google.dateIso || "") > __GF_END_DATE_ISO) {
        state.google.running = false;
        state.google.paused = false;
        state.google.stage = "done";
        state.google.lastTickInfo = `Reached end date ${__GF_END_DATE_ISO} — stopped`;
        state.google.updatedAt = gfNowIso();
        window?.QCoreContent?.setState(state);
        if (modal) {
          gfUpdateModal(modal, state);
          gfLog(modal, state, state.google.lastTickInfo);
        }
        return;
      }

      gfAssertStillRunning(runToken);

      const airports = Array.isArray(state.google.airports) && state.google.airports.length ? state.google.airports : __GF_DEFAULT_AIRPORTS;
      const originIdx = Number.isFinite(Number(state.google.originIdx)) ? Math.max(0, Math.floor(Number(state.google.originIdx))) : 0;
      const origin = gfNormalizeAirportCode(airports[originIdx] || airports[0] || "LAX") || "LAX";
      const dateIso = String(state.google.dateIso || "").trim();
      const jobKey = gfJobKey(origin, dateIso);

      if (!state.google.jobs || typeof state.google.jobs !== "object" || Array.isArray(state.google.jobs)) {
        state.google.jobs = {};
      }

      const existingJob = state.google.jobs[jobKey];
      if (existingJob && (existingJob.status === "done" || existingJob.status === "skipped")) {
        state.google.lastTickInfo = `skip ${existingJob.status}: ${jobKey}`;
        state.google.updatedAt = gfNowIso();

        gfNextOriginOrDate(state);
        state.google.stage = "explore";
        window?.QCoreContent?.setState(state);
        if (modal) gfUpdateModal(modal, state);
        setTimeout(() => gfAutoTick("skip_done"), __GF_STEP_DELAY_MS);
        return;
      }

      const job = existingJob || { status: "new", attempts: 0, startedAt: "", finishedAt: "", lastError: "" };
      job.status = "searching";
      job.attempts = (Number(job.attempts) || 0) + 1;
      if (!job.startedAt) job.startedAt = gfNowIso();
      job.finishedAt = "";
      job.lastError = "";
      state.google.jobs[jobKey] = job;

      state.google.stage = "explore";
      state.google.lastTickInfo = `job ${jobKey} (attempt ${job.attempts}/${MAX_ATTEMPTS})`;
      state.google.updatedAt = gfNowIso();
      window?.QCoreContent?.setState(state);
      if (modal) gfUpdateModal(modal, state);

      await gfEnsureOneWay(modal, state, runToken);
      await gfSetOriginAndDateOnExplore(modal, state, runToken);
      await gfScrapeExplorePrices(modal, state, runToken);

      gfNextOriginOrDate(state);
      state.google.stage = "explore";
      state.google.updatedAt = gfNowIso();
      window?.QCoreContent?.setState(state);
      if (modal) gfUpdateModal(modal, state);

      setTimeout(() => gfAutoTick("next_job"), __GF_STEP_DELAY_MS);
    } catch (e) {
      if (e && (e.__gfAbort || String(e?.message || "") === "__GF_ABORT__")) {
        try {
          const st = window?.QCoreContent?.getState() || state;
          if (modal) {
            gfLog(modal, st, "Tick aborted (paused/resumed) — progress frozen");
            gfUpdateModal(modal, st);
          }
        } catch {}
        return;
      }

      try {
        const airports = Array.isArray(state.google.airports) && state.google.airports.length ? state.google.airports : __GF_DEFAULT_AIRPORTS;
        const originIdx = Number.isFinite(Number(state.google.originIdx)) ? Math.max(0, Math.floor(Number(state.google.originIdx))) : 0;
        const origin = gfNormalizeAirportCode(airports[originIdx] || airports[0] || "LAX") || "LAX";
        const dateIso = String(state.google.dateIso || "").trim();
        const jobKey = gfJobKey(origin, dateIso);

        if (!state.google.jobs || typeof state.google.jobs !== "object" || Array.isArray(state.google.jobs)) {
          state.google.jobs = {};
        }

        const job = state.google.jobs[jobKey] || { status: "new", attempts: 0, startedAt: "", finishedAt: "", lastError: "" };
        job.status = "error";
        job.lastError = String(e?.message || e || "error");
        job.finishedAt = gfNowIso();
        state.google.jobs[jobKey] = job;

        state.google.stage = "error";
        state.google.updatedAt = gfNowIso();
        state.google.lastTickInfo = `error: ${job.lastError}`;
        window?.QCoreContent?.setState(state);
        if (modal) gfUpdateModal(modal, state);
        if (modal) gfLog(modal, state, `ERROR → ${state.google.lastTickInfo}`);

        const attempts = Number(job.attempts) || 0;
        if (attempts >= MAX_ATTEMPTS) {
          job.status = "skipped";
          job.finishedAt = gfNowIso();
          state.google.jobs[jobKey] = job;

          state.google.stage = "explore";
          state.google.lastTickInfo = `skipped after ${attempts} attempts: ${jobKey}`;
          state.google.updatedAt = gfNowIso();

          gfNextOriginOrDate(state);
          window?.QCoreContent?.setState(state);
          if (modal) gfUpdateModal(modal, state);
          if (modal) gfLog(modal, state, `SKIP → ${jobKey}`);

          setTimeout(() => gfAutoTick("skip_after_error"), __GF_STEP_DELAY_MS);
          return;
        }

        setTimeout(() => gfAutoTick("retry_after_error"), Math.max(__GF_STEP_DELAY_MS, 600));
      } catch {}
    } finally {
      __gfTickInFlight = false;
    }
  }

  function showGoogleFlightsModal({ reason = "tools_modal" } = {}) {
    let st = gfEnsureInit();
    const r = String(reason || "");
    const isAuto = r === "autoboot" || r.startsWith("auto_reopen:");

    // If the user explicitly opened the modal, clear the hidden flag.
    if (!isAuto) {
      st.google.uiHidden = false;
      st.google.uiOpen = true;
      st.google.modalOpen = true;
      st.google.updatedAt = gfNowIso();
      window?.QCoreContent?.setState(st);

      // Persist immediately so any follow-up gfEnsureInit()/DB sync won't
      // snap the UI back to a stale localStorage snapshot (which caused the
      // "open → instantly hide" bug).
      try { gfWriteLS(st.google); } catch {}
      try { gfWriteProgressLS(st.google); } catch {}
    } else {
      // Auto-open: do NOT override uiHidden, but keep "open" in sync with it.
      // (If the modal is hidden, it isn't considered open/visible.)
      try {
        st.google.uiOpen = !st.google.uiHidden;
        st.google.modalOpen = st.google.uiOpen;
        st.google.updatedAt = gfNowIso();
        window?.QCoreContent?.setState(st);
        try { gfWriteLS(st.google); } catch {}
        try { gfWriteProgressLS(st.google); } catch {}
      } catch {}
    }

    const existing = window.__qcoreGoogleFlightsCtl;
    if (existing && existing.modal && document.body.contains(existing.modal.el)) {
      try {
        if (isAuto && st.google.uiHidden) {
          existing.modal.setHidden?.(true, { persist: false });
        } else {
          existing.modal.setHidden?.(false, { persist: false });
        }

        gfUpdateModal(existing.modal, st);
        existing.modal.addLog(`Modal opened (reuse) — ${reason}`);
        try { setTimeout(() => { try { gfSyncDbCountToState({ modal: existing.modal, state: gfEnsureInit(), reason: "modal_reopen" }); } catch {} }, 0); } catch {}

        // Ensure auto-export timer is armed and points at the current modal
        try { gfStartAutoExport(existing.modal); } catch {}
      } catch {}
      return;
    }

    const modal = __qcoreMakeGoogleFlightsModal({
      title: "Google Flights",
      subtitle: "Google Travel Explore — Price Collector",
    });

    window.__qcoreGoogleFlightsCtl = { modal };

    gfUpdateModal(modal, st);
    modal.addLog(`Modal opened — ${reason}`);

    try { setTimeout(() => { try { gfSyncDbCountToState({ modal, state: gfEnsureInit(), reason: "modal_open" }); } catch {} }, 0); } catch {}

    try {
      if (isAuto && st.google.uiHidden) modal.setHidden?.(true, { persist: false });
    } catch {}

    modal.btnStart.onclick = () => gfStart(modal);
    modal.btnPause.onclick = () => gfPause(modal);
    modal.btnReset.onclick = () => gfResetAll(modal);

    modal.btnImport.onclick = () => {
      try {
        gfImportJsonMerge(modal);
      } catch {}
    };

    // FIX: export handler now routes through gfRunExport so the 60s auto-export shares the same lock logic
    modal.btnExport.onclick = async () => {
      try {
        await gfRunExport(modal, { mode: "full", reason: "manual_btn" });
      } catch {}
    };

    // Arm auto-export (the interval will only fire while running)
    try { gfStartAutoExport(modal); } catch {}

    // Resume quickly if already running
    try {
      const s = gfEnsureInit();
      if (s.google.running && !s.google.paused) setTimeout(() => gfAutoTick("modal_open_resume"), __GF_STEP_DELAY_MS);
    } catch {}
  }

  function gfAutoBoot() {
    try {
      const state = window?.QCoreContent?.getState();
      if (state && state.google && state.google.running && !state.google.paused) {
        if (!gfIsExploreBaseUrl(location.href)) {
          gfEnforceExploreOnly({ reason: "autoboot_not_explore" });
          return;
        }
        try {
          showGoogleFlightsModal({ reason: "autoboot" });
        } catch {}
        setTimeout(() => gfAutoTick("autoboot"), __GF_STEP_DELAY_MS);
      }
    } catch {}
  }

  // Always expose a direct opener for debugging / if tools UI is late
  try { window.showGoogleFlightsModal = showGoogleFlightsModal; } catch {}

  function __register() {
    try {
      if (window.__qcoreGoogleFlightsToolRegistered) return true;

      const QQ = window.QCoreToolsModal;
      if (!QQ || typeof QQ.registerTool !== 'function') return false;

      QQ.registerTool({
        id: "google_flights",
        title: "Google Flights Explore",
        icon: "🛫",
        description: "Scrape Google Flights Explore prices.",
        order: 190,
        onClick: () => { try { showGoogleFlightsModal(); } catch (e) { console.error(e); } },
        autoBoot: () => { try { gfAutoBoot(); } catch {} },
      });

      try { QQ.showGoogleFlightsModal = showGoogleFlightsModal; } catch {}
      try { QQ.gfShowGoogleFlightsModal = showGoogleFlightsModal; } catch {}

      window.__qcoreGoogleFlightsToolRegistered = true;
      return true;
    } catch (e) {
      console.warn("[GF] register failed", e);
      return false;
    }
  }

  // FIX: robust registration so the tool shows even if Tools modal loads after this script.
  function __registerWithRetry() {
    const ok = __register();
    if (ok) return true;

    // Queue for the existing pending mechanism (if QCore uses it)
    try {
      const arr = (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []);
      if (!arr.includes(__register)) arr.push(__register);
    } catch {}

    // Also poll briefly (covers cases where __QCORE_TOOLS_PENDING__ isn't consumed)
    try {
      if (window.__qcoreGoogleFlightsRegisterPoll) return false;

      let tries = 0;
      window.__qcoreGoogleFlightsRegisterPoll = setInterval(() => {
        tries += 1;
        if (window.__qcoreGoogleFlightsToolRegistered) {
          clearInterval(window.__qcoreGoogleFlightsRegisterPoll);
          window.__qcoreGoogleFlightsRegisterPoll = null;
          return;
        }
        const ok2 = __register();
        if (ok2) {
          clearInterval(window.__qcoreGoogleFlightsRegisterPoll);
          window.__qcoreGoogleFlightsRegisterPoll = null;
          return;
        }
        if (tries >= 240) { // 240 * 250ms = 60s
          clearInterval(window.__qcoreGoogleFlightsRegisterPoll);
          window.__qcoreGoogleFlightsRegisterPoll = null;
          console.warn("[GF] tool register poll timed out (Tools UI never appeared?)");
        }
      }, 250);
    } catch {}

    return false;
  }

  __registerWithRetry();
})();