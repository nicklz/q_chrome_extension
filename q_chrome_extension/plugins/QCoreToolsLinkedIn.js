(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const safeNowIso = Q.safeNowIso || (() => new Date().toISOString());
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

    // ------------------------------ LinkedIn Jobs Scrape ------------------------------
    // Collects job cards from:
    //   https://www.linkedin.com/jobs/search-results/
    //
    // Requested state shape:
    //   state.linkedin.jobs = []       // array of job objects (from your snippet)
    //   state.linkedin.companies = []  // reserved for future
    //
    // NOTE: We intentionally DO NOT wipe state on init. We only fill missing defaults.

    const __LI_HOME_URL = "https://www.linkedin.com/jobs/search-results/";
    const __LI_MAX_JOBS_HARD = 8000;
    const __LI_MAX_LOGS = 240;

    const __LI_STEP_DELAY_MS = 1000;               // pace between ticks while staying on same page
    const __LI_AFTER_NEXT_CLICK_WAIT_MS = 3000;    // matches your snippet
    const __LI_RESULTS_READY_TIMEOUT_MS = 20000;
    const __LI_RESULTS_POLL_MS = 250;
    const __LI_ABORT_POLL_MS = 200;

    // Pre-generated keywords (randomly selected after pagination ends)
    // Requested: ~100 keywords, mixed seniority + roles + stacks (staff/principal/manager/director/CTO/VP, Drupal/PHP/Python/JS/AI/Java, etc.)
    const __LI_KEYWORDS = window.QCoreGlobal.initCoreProfessions();

  console.log('did we fuck this up', __LI_KEYWORDS)
  // Map JSON fields to same variable names your loop expects

  let prefixes  = __LI_KEYWORDS.prefixes  || [];
  let levels    = __LI_KEYWORDS.levels    || [];
  let roles     = __LI_KEYWORDS.roles     || [];
  let stacks    = __LI_KEYWORDS.stacks    || [];

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    let base = (__LI_KEYWORDS && __LI_KEYWORDS.base) || [];

    const out = new Set();

    for (const s of base) {
      const t = String(s || "").trim();
      if (t) out.add(t);
    }

    let guard = 0;

    while (out.size < 120 && guard < 5000) {
      guard += 1;

      const prefix = pick(prefixes);
      const role = pick(roles);

      // Only add a level if it doesn't create nonsense like "CTO CTO"
      const level = pick(levels);

      let parts = [prefix];

      const roleLower = String(role || "").toLowerCase();
      const levelLower = String(level || "").toLowerCase();

      const roleIsExec =
        roleLower.includes("cto") ||
        roleLower.includes("vp of engineering") ||
        roleLower.includes("director of engineering");

      const roleIsMgr = roleLower.includes("engineering manager") || roleLower.includes("manager");
      const levelIsExec = levelLower === "cto" || levelLower === "vp" || levelLower === "director" || levelLower === "head";

      // If the role already implies seniority (CTO/VP/Director), skip level unless it's "Senior" or "Lead".
      if (roleIsExec) {
        if (levelLower === "senior" || levelLower === "lead") parts.push(level);
      } else if (roleIsMgr) {
        // allow "Senior Engineering Manager" etc
        if (levelLower === "senior" || levelLower === "staff" || levelLower === "principal" || levelLower === "lead") {
          parts.push(level);
        }
      } else if (!levelIsExec) {
        // regular IC roles: allow seniority levels but not exec words
        parts.push(level);
      }

      parts.push(role);

      // Optional stack terms (0-2)
      const s1 = Math.random() < 0.85 ? pick(stacks) : "";
      const s2 = Math.random() < 0.25 ? pick(stacks) : "";

      const uniqStacks = [];
      for (const s of [s1, s2]) {
        const st = String(s || "").trim();
        if (!st) continue;
        if (uniqStacks.some((x) => x.toLowerCase() === st.toLowerCase())) continue;
        if (roleLower.includes(st.toLowerCase())) continue;
        uniqStacks.push(st);
      }

      parts = parts.concat(uniqStacks);

      const kw = String(parts.join(" ").replace(/\s+/g, " ").trim());
      if (kw) out.add(kw);
    }


    const list = Array.from(out);
    // Ensure at least 100
    while (list.length < 100) list.push(...base);






    const liNowIso = () => {
      try {
        return new Date().toISOString();
      } catch {
        return safeNowIso();
      }
    };

    const liNowMs = () => {
      try {
        return Date.now();
      } catch {
        return 0;
      }
    };

    const liSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms || 0))));

    function liIsLinkedInHost() {
      try {
        const host = String(location.hostname || "").replace(/^www\./, "").toLowerCase();
        return host === "linkedin.com" || host.endsWith(".linkedin.com");
      } catch {
        return false;
      }
    }

    function liIsSearchResultsPage() {
      try {
        if (!liIsLinkedInHost()) return false;
        const path = String(location.pathname || "/");
        return path.startsWith("/jobs/search-results");
      } catch {
        return false;
      }
    }

    function liKeywordFromUrl(href = location.href) {
      try {
        const u = new URL(String(href || location.href));
        const kw = String(u.searchParams.get("keywords") || "").trim();
        return kw;
      } catch {
        return "";
      }
    }

    function liBuildSearchUrl(keyword) {
      try {
        const u = new URL(__LI_HOME_URL);
        const kw = String(keyword || "").trim();
        if (kw) u.searchParams.set("keywords", kw);
        return u.toString();
      } catch {
        return __LI_HOME_URL;
      }
    }

    function liPickRandomKeyword(prevKeyword = "") {
      try {
        const prev = String(prevKeyword || "").trim().toLowerCase();
        const list = Array.isArray(__LI_KEYWORDS) && __LI_KEYWORDS.length ? __LI_KEYWORDS : ["Remote senior software engineer"];
        if (list.length === 1) return list[0];

        // Avoid repeating the immediately-previous keyword if possible.
        for (let i = 0; i < 8; i++) {
          const idx = Math.floor(Math.random() * list.length);
          const cand = String(list[idx] || "").trim();
          if (!cand) continue;
          if (cand.trim().toLowerCase() !== prev) return cand;
        }
        return String(list[Math.floor(Math.random() * list.length)] || list[0]);
      } catch {
        return "Remote senior software engineer";
      }
    }

    function liNorm(str) {
      try {
        return String(str || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
      } catch {
        return "";
      }
    }

    function liJobKey(job) {
      try {
        const j = job && typeof job === "object" ? job : {};
        return [
          liNorm(j.title),
          liNorm(j.company),
          liNorm(j.location),
          liNorm(j.salary),
          liNorm(j.image),
        ].join("|");
      } catch {
        return "";
      }
    }

    function liEnsureInit() {
      const state = window?.QCoreContent?.getState() || {};
      state.linkedin = state.linkedin && typeof state.linkedin === "object" ? state.linkedin : {};

      const li = state.linkedin;
      const now = liNowIso();

      li.version = Number(li.version || 1);
      li.createdAt = String(li.createdAt || now);
      li.updatedAt = String(li.updatedAt || now);

      li.running = !!li.running;
      li.paused = !!li.paused;
      li.uiHidden = !!li.uiHidden;

      li.stage = String(li.stage || "idle");
      li.tickId = Number(li.tickId || 0);

      // Query / per-query progress
      li.query = String(li.query || "");
      li.totalJobsOnQuery = Number.isFinite(Number(li.totalJobsOnQuery)) ? Number(li.totalJobsOnQuery) : 0;
      li.queryJobsSaved = Number.isFinite(Number(li.queryJobsSaved)) ? Number(li.queryJobsSaved) : 0;

      li.totals = li.totals && typeof li.totals === "object" ? li.totals : {};
      li.totals.cycles = Number.isFinite(Number(li.totals.cycles)) ? Number(li.totals.cycles) : 0;
      li.totals.pagesDone = Number.isFinite(Number(li.totals.pagesDone)) ? Number(li.totals.pagesDone) : 0;
      li.totals.jobs = Number.isFinite(Number(li.totals.jobs)) ? Number(li.totals.jobs) : 0;
      li.totals.jobsTrimmed = Number.isFinite(Number(li.totals.jobsTrimmed)) ? Number(li.totals.jobsTrimmed) : 0;

      li.lastUrl = String(li.lastUrl || "");
      li.lastTickInfo = String(li.lastTickInfo || "");
      li.lastLog = String(li.lastLog || "");

      // Requested arrays (do not wipe if present)
      li.jobs = Array.isArray(li.jobs) ? li.jobs : [];
      li.companies = Array.isArray(li.companies) ? li.companies : [];

      // Small log ring buffer
      li.logs = Array.isArray(li.logs) ? li.logs : [];
      if (li.logs.length > __LI_MAX_LOGS) li.logs = li.logs.slice(-__LI_MAX_LOGS);

      // Dedupe map
      li.__jobKeys = li.__jobKeys && typeof li.__jobKeys === "object" && !Array.isArray(li.__jobKeys) ? li.__jobKeys : {};

      // Rebuild dedupe keys if missing/empty (or after compaction)
      try {
        const keys = Object.keys(li.__jobKeys || {});
        if ((!keys || !keys.length) && Array.isArray(li.jobs) && li.jobs.length) {
          li.__jobKeys = {};
          for (const j of li.jobs) {
            const k = liJobKey(j);
            if (k) li.__jobKeys[k] = 1;
          }
        }
      } catch {}

      // Hard cap safety (prevents storage writes from failing silently)
      try {
        if (Array.isArray(li.jobs) && li.jobs.length > __LI_MAX_JOBS_HARD) {
          const cut = li.jobs.length - __LI_MAX_JOBS_HARD;
          li.jobs = li.jobs.slice(-__LI_MAX_JOBS_HARD);

          li.totals.jobsTrimmed = Number(li.totals.jobsTrimmed || 0) + Math.max(0, cut);

          // rebuild keys for compacted tail
          li.__jobKeys = {};
          for (const j of li.jobs) {
            const k = liJobKey(j);
            if (k) li.__jobKeys[k] = 1;
          }
        }
      } catch {}

      // Keep totals.jobs synced
      try {
        li.totals.jobs = Array.isArray(li.jobs) ? li.jobs.length : 0;
      } catch {}

      // Runner guard: keep a top-level flag so redirects don't accidentally reset LinkedIn state
      try {
        if (state.linkedinRunning === true) {
          li.running = true;
          li.paused = false;
        }

        // Only ever set this flag to true here (do not default it to false).
        if (li.running && !li.paused) state.linkedinRunning = true;
      } catch {}

      state.linkedin = li;
      return state;
    }

    function liGetCtl() {
      try {
        return window.__qcoreLinkedInCtl || null;
      } catch {
        return null;
      }
    }

    function liSetCtl(modal) {
      try {
        window.__qcoreLinkedInCtl = { modal };
      } catch {}
    }

    function liPushLogLine(state, line) {
      try {
        const s = state && typeof state === "object" ? state : liEnsureInit();
        const li = s.linkedin || {};
        li.logs = Array.isArray(li.logs) ? li.logs : [];
        li.logs.push(String(line || ""));
        if (li.logs.length > __LI_MAX_LOGS) li.logs = li.logs.slice(-__LI_MAX_LOGS);
        li.lastLog = String(line || "");
        li.updatedAt = liNowIso();
        s.linkedin = li;
        return s;
      } catch {
        return state;
      }
    }

    function liLog(modal, state, msg, extra) {
      const line = `${msg || ""}`;
      const ts = (() => {
        try {
          return new Date().toLocaleTimeString("en-US");
        } catch {
          return String(Date.now());
        }
      })();

      const full = extra ? `${ts}  ${line}  ${JSON.stringify(extra)}` : `${ts}  ${line}`;
      try {
        const s = liPushLogLine(state, full);
        window?.QCoreContent?.setState(s);
        try {
          if (modal && typeof modal.addLog === "function") modal.addLog(line);
        } catch {}
        try {
          console.log("💼 [LinkedIn]", line, extra || "");
        } catch {}
        return s;
      } catch {
        return state;
      }
    }

    function liSetQuery(state, keyword, { incrementCycle = false, reason = "" } = {}) {
      try {
        const s = state && typeof state === "object" ? state : liEnsureInit();
        const li = s.linkedin || {};

        const kw = String(keyword || "").trim();
        const changed = kw && kw !== String(li.query || "");

        if (changed) {
          li.query = kw;
          li.queryJobsSaved = 0;
          li.totalJobsOnQuery = 0;
          li.lastTickInfo = reason ? `query set (${reason})` : "query set";
          if (incrementCycle) li.totals = li.totals && typeof li.totals === "object" ? li.totals : {};
          if (incrementCycle) li.totals.cycles = Number(li.totals.cycles || 0) + 1;
        }

        li.updatedAt = liNowIso();
        s.linkedin = li;
        return s;
      } catch {
        return state;
      }
    }

    function liPickNextUrl(state, { incrementCycle = true, reason = "" } = {}) {
      try {
        const s = state && typeof state === "object" ? state : liEnsureInit();
        const li = s.linkedin || {};
        const nextKw = liPickRandomKeyword(li.query || "");
        liSetQuery(s, nextKw, { incrementCycle, reason: reason || "pick_next" });
        return liBuildSearchUrl(nextKw);
      } catch {
        return __LI_HOME_URL;
      }
    }

    // ---------- Abortable runner helpers ----------
    function liAbortError() {
      const e = new Error("LinkedIn runner aborted");
      e.__liAbort = true;
      return e;
    }

    function liGet() {
      try {
        return liEnsureInit().linkedin || null;
      } catch {
        return null;
      }
    }

    function liIsStillRunning(runToken) {
      try {
        const li = liGet();
        if (!li) return false;
        if (!li.running || li.paused) return false;
        if (Number(li.tickId || 0) !== Number(runToken || 0)) return false;
        return true;
      } catch {
        return false;
      }
    }

    function liAssertStillRunning(runToken) {
      if (!liIsStillRunning(runToken)) throw liAbortError();
    }

    async function liAbortableSleep(runToken, ms) {
      const end = liNowMs() + (ms || 0);
      while (liNowMs() < end) {
        liAssertStillRunning(runToken);
        const remain = end - liNowMs();
        await liSleep(Math.min(__LI_ABORT_POLL_MS, Math.max(0, remain)));
      }
      liAssertStillRunning(runToken);
    }

    // ---------- Your snippet (extraction) ----------
    function liExtractJobsFromPage() {
      const container = document.querySelector('[componentkey="SearchResultsMainContent"]');
      if (!container) {
        try { console.log("[LinkedIn] No SearchResultsMainContent container found"); } catch {}
        return [];
      }

      const figures = container.querySelectorAll("figure");
      const jobs = [];

      figures.forEach((fig) => {
        const card = fig.parentElement;
        if (!card) return;

        // Only process company logo figures (skip profile/person icons)
        const img = fig.querySelector("img");
        if (!img) return;

        const image = img.src || null;

        const titleEl = card.querySelector("span._562b7e30");
        const companyEl = card.querySelector("p._41ddd51d._6c72be37");
        const locationEl = Array.from(card.querySelectorAll("p")).find(
          (p) => p.textContent.includes("(") || p.textContent.toLowerCase().includes("remote")
        );

        const salaryEl = Array.from(card.querySelectorAll("p")).find((p) => p.textContent.includes("$"));

        if (!titleEl || !companyEl) return;

        jobs.push({
          title: titleEl.textContent.trim(),
          company: companyEl.textContent.trim(),
          location: locationEl ? locationEl.textContent.trim() : null,
          salary: salaryEl ? salaryEl.textContent.trim() : null,
          image,
        });
      });

      return jobs;
    }

    function liDetectTotalJobsOnPage() {
      try {
        // Common selectors on LinkedIn job search UIs (best effort; safe to fail)
        const el =
          document.querySelector("span.results-context-header__job-count") ||
          document.querySelector(".results-context-header__job-count") ||
          document.querySelector(".jobs-search-results-list__subtitle") ||
          document.querySelector("[data-test-search-results-count]");

        const txt = String(el?.textContent || "").trim();
        if (!txt) return 0;

        const m = txt.replace(/\u00a0/g, " ").match(/(\d[\d,]*)/);
        if (!m) return 0;

        const n = Number(String(m[1]).replace(/,/g, ""));
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    }

    function liHasNoResultsFound() {
      try {
        // Some LinkedIn result sets render: <h2 ...>No results found</h2>
        const hs = Array.from(document.querySelectorAll("h2"));
        for (const h of hs) {
          const t = String(h?.textContent || "").trim().toLowerCase();
          if (!t) continue;
          if (t === "no results found" || t.includes("no results found")) return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    async function liWaitForResultsReady(runToken) {
      const end = liNowMs() + __LI_RESULTS_READY_TIMEOUT_MS;

      while (liNowMs() < end) {
        liAssertStillRunning(runToken);

        // Fast exit: query returned no results
        if (liHasNoResultsFound()) return { ok: false, noResults: true };

        const container = document.querySelector('[componentkey="SearchResultsMainContent"]');
        if (container) {
          const imgs = container.querySelectorAll("figure img");
          if (imgs && imgs.length) return { ok: true };
        }

        await liAbortableSleep(runToken, __LI_RESULTS_POLL_MS);
      }

      return { ok: false, timeout: true };
    }

    function liMergeJobs(state, jobs, { keyword = "" } = {}) {
      try {
        const s = state && typeof state === "object" ? state : liEnsureInit();
        const li = s.linkedin || {};
        li.jobs = Array.isArray(li.jobs) ? li.jobs : [];
        li.__jobKeys = li.__jobKeys && typeof li.__jobKeys === "object" && !Array.isArray(li.__jobKeys) ? li.__jobKeys : {};

        const kw = String(keyword || li.query || "").trim();
        if (kw && kw !== String(li.query || "")) {
          liSetQuery(s, kw, { incrementCycle: false, reason: "merge_kw_change" });
        }

        let added = 0;

        for (const j of Array.isArray(jobs) ? jobs : []) {
          if (!j || typeof j !== "object") continue;
          const k = liJobKey(j);
          if (!k) continue;
          if (li.__jobKeys[k]) continue;

          li.__jobKeys[k] = 1;
          li.jobs.push(j);
          added += 1;
          li.queryJobsSaved = Number(li.queryJobsSaved || 0) + 1;
        }

        // sync totals
        li.totals = li.totals && typeof li.totals === "object" ? li.totals : {};
        li.totals.jobs = li.jobs.length;

        li.updatedAt = liNowIso();
        s.linkedin = li;
        return added;
      } catch {
        return 0;
      }
    }

    function liFindNextButton() {
      try {
        const nextBtn = document.querySelector('[data-testid="pagination-controls-next-button-visible"]');
        if (!nextBtn) return null;

        const ariaDisabled = String(nextBtn.getAttribute("aria-disabled") || "").toLowerCase();
        if (ariaDisabled === "true") return null;

        // Some UIs use disabled attr
        if (nextBtn.disabled) return null;

        return nextBtn;
      } catch {
        return null;
      }
    }

    // ---------- Modal UI ----------
    function __liEscapeHtml(str) {
      try {
        return String(str || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      } catch {
        return "";
      }
    }

    function __qcoreMakeLinkedInModal({ title = "LinkedIn", subtitle = "" } = {}) {
      const root = document.createElement("div");
      root.dataset.qcoreLinkedInModal = "1";
      root.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(980px,96vw);max-height:88vh;overflow:hidden;background:#0b1117;border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.65);display:flex;flex-direction:column;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu;color:#e5e7eb";

      const head = document.createElement("div");
      head.style.cssText =
        "padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:12px;align-items:flex-start;justify-content:space-between";

      const left = document.createElement("div");
      const h1 = document.createElement("div");
      h1.textContent = String(title || "LinkedIn");
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
      const btnRunning = btn("Running: OFF", "#334155");
      const btnReset = btn("Reset (wipe jobs)", "#a855f7");
      const btnExport = btn("Export JSON", "#16a34a");
      const btnGoJobs = btn("Go → Jobs Search", "#1f2937");
      const btnClose = btn("Close (hide)", "#111827");

      right.appendChild(btnStart);
      right.appendChild(btnPause);
      right.appendChild(btnRunning);
      right.appendChild(btnReset);
      right.appendChild(btnExport);
      right.appendChild(btnGoJobs);
      right.appendChild(btnClose);

      head.appendChild(left);
      head.appendChild(right);

      const stats = document.createElement("div");
      stats.style.cssText =
        "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.82);display:flex;flex-direction:column;gap:2px";

      const lineRun = document.createElement("div");
      const lineStage = document.createElement("div");
      const lineTotals = document.createElement("div");
      const lineLast = document.createElement("div");
      stats.appendChild(lineRun);
      stats.appendChild(lineStage);
      stats.appendChild(lineTotals);
      stats.appendChild(lineLast);

      // Progress bar (per-query, if LinkedIn exposes a total count)
      const barWrap = document.createElement("div");
      barWrap.style.cssText =
        "margin-top:8px;width:100%;height:12px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;border:1px solid rgba(255,255,255,.10);";
      const bar = document.createElement("div");
      bar.style.cssText = "height:100%;width:0%;background:#22c55e;transition:width .18s ease;";
      barWrap.appendChild(bar);

      const barLabel = document.createElement("div");
      barLabel.style.cssText = "margin-top:4px;color:rgba(255,255,255,.72);font-size:12px;font-weight:800;";
      barLabel.textContent = "Progress: -";

      stats.appendChild(barWrap);
      stats.appendChild(barLabel);

      const body = document.createElement("div");
      body.style.cssText = "display:grid;grid-template-columns: 1fr;gap:10px;padding:10px 14px;overflow:auto";

      const logWrap = document.createElement("div");
      logWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const logHead = document.createElement("div");
      logHead.textContent = "Log";
      logHead.style.cssText =
        "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
      const log = document.createElement("pre");
      log.style.cssText =
        "margin:0;padding:10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.25;color:#e5e7eb";
      log.textContent = "";

      logWrap.appendChild(logHead);
      logWrap.appendChild(log);

      const tableWrap = document.createElement("div");
      tableWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const tableHead = document.createElement("div");
      tableHead.textContent = "Captured jobs (latest)";
      tableHead.style.cssText =
        "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";

      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
      const thead = document.createElement("thead");
      thead.innerHTML =
        '<tr style="text-align:left;color:rgba(255,255,255,.75)">' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);width:92px">Logo</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Title</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Company</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Location</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Salary</th>' +
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
      card.appendChild(body);
      root.appendChild(card);
      document.body.appendChild(root);

      // dock label (tiny)
      const dock = document.createElement("div");
      dock.style.cssText =
        "position:fixed;right:10px;bottom:10px;z-index:2147483646;padding:6px 10px;border-radius:999px;background:rgba(2,6,23,.85);border:1px solid rgba(255,255,255,.10);color:#e5e7eb;font-weight:800;font-size:12px;cursor:pointer;user-select:none";
      dock.textContent = "LinkedIn • show";

      const __LI_MODAL_Z = 2147483647;

      const applyHiddenStyle = (hidden) => {
        try {
          root.style.display = "flex";
          if (hidden) {
            root.style.zIndex = "-999";
            root.style.pointerEvents = "none";
            root.style.opacity = "0";
            root.style.transform = "translateX(-9999px)";
          } else {
            root.style.zIndex = String(__LI_MODAL_Z);
            root.style.pointerEvents = "auto";
            root.style.opacity = "1";
            root.style.transform = "";
          }
        } catch {}
      };

      const persistUiHidden = (hidden) => {
        try {
          let state = liEnsureInit();
          state.linkedin.uiHidden = !!hidden;
          state.linkedin.updatedAt = liNowIso();
          window?.QCoreContent?.setState(state);
        } catch {}
      };

      const setHidden = (hidden, { persist = true } = {}) => {
        const h = !!hidden;
        if (persist) persistUiHidden(h);
        applyHiddenStyle(h);
        if (h) dock.textContent = "LinkedIn • show";
      };

      dock.onclick = () => setHidden(false);
      document.body.appendChild(dock);

      const api = {
        el: root,
        dock,
        btnStart,
        btnPause,
        btnRunning,
        btnReset,
        btnExport,
        btnGoJobs,
        btnClose,

        setStats({ page, running, stage, query, totals, last, totalOnQuery, querySaved } = {}) {
          lineRun.textContent = `Page: ${page || location.href}`;
          lineStage.textContent = `Run: ${running ? "🟢 running" : "⚪ stopped"}   •   Stage: ${stage || "-"}`;
          lineTotals.textContent =
            `Query: ${query || "-"}   •   Saved: ${totals?.jobs ?? "-"} jobs` +
            (Number(totalOnQuery || 0) ? `   •   Query progress: ${querySaved || 0}/${totalOnQuery}` : "");
          lineLast.textContent = last ? `Last: ${last}` : "Last: -";
        },

        setProgress(done, total) {
          try {
            const d = Number(done || 0);
            const t = Number(total || 0);
            if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0) {
              bar.style.width = "0%";
              barLabel.textContent = "Progress: -";
              return;
            }
            const pct = Math.max(0, Math.min(100, (d / t) * 100));
            bar.style.width = `${pct.toFixed(1)}%`;
            barLabel.textContent = `Progress: ${d}/${t} (${pct.toFixed(1)}%)`;
          } catch {}
        },

        setLogs(lines) {
          try {
            log.textContent = String(lines || "");
          } catch {}
        },

        addLog(msg) {
          try {
            const ts = new Date().toLocaleTimeString("en-US");
            log.textContent = `${ts}  ${msg}\n` + log.textContent;
          } catch {}
        },

        setRows(rows) {
          while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
          (rows || []).slice(0, 120).forEach((r) => {
            const title = __liEscapeHtml(r.title || "");
            const company = __liEscapeHtml(r.company || "");
            const locationTxt = __liEscapeHtml(r.location || "");
            const salaryTxt = __liEscapeHtml(r.salary || "");

            const img0 = __liEscapeHtml(r.image || "");
            const imgCell = img0
              ? `<a href="${img0}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;color:#93c5fd">` +
                `<img src="${img0}" loading="lazy" style="width:78px;height:52px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#0b1117" />` +
                `</a>`
              : `<div style="opacity:.55;font-size:11px;line-height:1">—</div>`;

            const tr = document.createElement("tr");
            tr.innerHTML =
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top">${imgCell}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${company}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${locationTxt}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${salaryTxt}</td>`;
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

    function liUpdateModal(modal, state) {
      try {
        if (!modal) return;
        const st = state && typeof state === "object" ? state : liEnsureInit();
        const li = st.linkedin || {};

        const count = Array.isArray(li.jobs) ? li.jobs.length : 0;

        modal.setStats({
          page: location.href,
          running: !!li.running && !li.paused,
          stage: li.stage || "-",
          query: li.query || liKeywordFromUrl() || "-",
          totals: li.totals || {},
          last: li.lastTickInfo || li.lastLog || "",
          totalOnQuery: li.totalJobsOnQuery || 0,
          querySaved: li.queryJobsSaved || 0,
        });

        // per-query progress bar (best effort)
        try {
          modal.setProgress(li.queryJobsSaved || 0, li.totalJobsOnQuery || 0);
        } catch {}

        // latest jobs (reverse chronological)
        const latest = (Array.isArray(li.jobs) ? li.jobs : []).slice(-80).reverse();
        modal.setRows(latest);

        // logs (most recent first)
        try {
          const lines = (Array.isArray(li.logs) ? li.logs : []).slice(-160).reverse().join("\n");
          modal.setLogs(lines);
        } catch {}

        // Update running toggle button label
          try {
            if (modal.btnRunning) {
              modal.btnRunning.textContent = li.running && !li.paused ? "Running: ON" : "Running: OFF";
            }
          } catch {}

          modal.dock.textContent = li.uiHidden
          ? `LinkedIn • ${count} • hidden (click to show)`
          : `LinkedIn • ${count} • ${li.running && !li.paused ? "running" : "stopped"}`;

        // Apply hide/show without blocking runner
        try {
          if (typeof modal.setHidden === "function") {
            modal.setHidden(!!li.uiHidden, { persist: false });
          }
        } catch {}

        // Keep visible while running unless user hid it
        try {
          if (li.running && !li.paused && !li.uiHidden) modal.el.style.display = "flex";
        } catch {}
      } catch {}
    }

    function liExportJson(state) {
      try {
        const st = state && typeof state === "object" ? state : liEnsureInit();
        const li = st.linkedin || {};

        const payload = {
          exportedAt: liNowIso(),
          page: String(location.href || ""),
          query: li.query || liKeywordFromUrl() || "",
          totals: li.totals || {},
          jobs: Array.isArray(li.jobs) ? li.jobs : [],
          companies: Array.isArray(li.companies) ? li.companies : [],
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = __qcoreMakeScrapeFilename("linkedin", "json");
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(a.href);
            a.remove();
          } catch {}
        }, 400);

        return true;
      } catch {
        return false;
      }
    }

    function liEnsureModal() {
      try {
        const ctl = liGetCtl();
        if (ctl && ctl.modal && ctl.modal.el && document.body.contains(ctl.modal.el)) return ctl.modal;

        const modal = __qcoreMakeLinkedInModal({
          title: "LinkedIn",
          subtitle: "Jobs Search Results • collector",
        });

        liSetCtl(modal);

        // Wire buttons
        modal.btnStart.onclick = () => {
          try {
            let st = liEnsureInit();
            st.linkedin.running = true;
            st.linkedin.paused = false;
            st.linkedin.stage = "run";
            st.linkedin.tickId = Number(st.linkedin.tickId || 0) + 1;
            st.linkedin.updatedAt = liNowIso();
            st.linkedinRunning = true;
            window?.QCoreContent?.setState(st);
            liUpdateModal(modal, st);
            setTimeout(() => liAutoTick("ui_start"), 250);
          } catch {}
        };

        modal.btnPause.onclick = () => {
          try {
            let st = liEnsureInit();
            st.linkedin.running = false;
            st.linkedin.paused = true;
            st.linkedin.stage = "paused";
            st.linkedin.tickId = Number(st.linkedin.tickId || 0) + 1;
            st.linkedin.updatedAt = liNowIso();
            st.linkedinRunning = false;
            window?.QCoreContent?.setState(st);
            liUpdateModal(modal, st);
            liLog(modal, st, "⏸ paused");
          } catch {}
        };

        modal.btnRunning.onclick = () => {
          try {
            let st = liEnsureInit();
            const li = st.linkedin || {};

            const isRunning = !!li.running && !li.paused;

            if (isRunning) {
              li.running = false;
              li.paused = false;
              li.stage = "stopped";
              li.tickId = Number(li.tickId || 0) + 1;
              li.updatedAt = liNowIso();

              st.linkedinRunning = false;
              st.linkedin = li;

              window?.QCoreContent?.setState(st);
              liUpdateModal(modal, st);
              liLog(modal, st, "⏹ stopped (running off)");
              return;
            }

            li.running = true;
            li.paused = false;
            li.stage = "run";
            li.tickId = Number(li.tickId || 0) + 1;
            li.updatedAt = liNowIso();

            st.linkedinRunning = true;
            st.linkedin = li;

            window?.QCoreContent?.setState(st);
            liUpdateModal(modal, st);

            setTimeout(() => liAutoTick("ui_running_on"), 250);
          } catch {}
        };

        modal.btnReset.onclick = () => {
          try {
            const prior = liEnsureInit();
            const createdAt = String(prior.linkedin?.createdAt || liNowIso());

            prior.linkedin = {
              version: 1,
              createdAt,
              updatedAt: liNowIso(),
              running: false,
              paused: false,
              uiHidden: false,
              stage: "idle",
              tickId: Number(prior.linkedin?.tickId || 0) + 1,
              query: "",
              totalJobsOnQuery: 0,
              queryJobsSaved: 0,
              totals: { cycles: 0, pagesDone: 0, jobs: 0, jobsTrimmed: 0 },
              jobs: [],
              companies: [],
              logs: [],
              __jobKeys: {},
              lastUrl: "",
              lastTickInfo: "",
              lastLog: "",
            };

            prior.linkedinRunning = false;
            // Allow this wipe even if state is locked.
            try { prior.lockedOverride = true; } catch {}
            window?.QCoreContent?.setState(prior);
            liUpdateModal(modal, prior);
            liLog(modal, prior, "🧽 reset (jobs wiped)");
          } catch {}
        };

        modal.btnExport.onclick = () => {
          try {
            const st = liEnsureInit();
            liExportJson(st);
            liLog(modal, st, "📦 export json");
            liUpdateModal(modal, st);
          } catch {}
        };

        modal.btnGoJobs.onclick = () => {
          try {
            const st = liEnsureInit();
            const li = st.linkedin || {};
            const url = liBuildSearchUrl(li.query || liPickRandomKeyword(""));
            st.linkedin.lastTickInfo = "go jobs search";
            st.linkedin.updatedAt = liNowIso();
            window?.QCoreContent?.setState(st);
            location.href = url;
          } catch {
            location.href = __LI_HOME_URL;
          }
        };

        // close already wires to hideOnly()

        return modal;
      } catch {
        return null;
      }
    }

    function showLinkedInModal({ reason = "tools_modal" } = {}) {
      try {
        const st = liEnsureInit();
        const r = String(reason || "");
        const isAuto = r === "autoboot" || r.startsWith("auto_reopen:");

        // If explicitly opened, unhide.
        if (!isAuto) {
          st.linkedin.uiHidden = false;
          st.linkedin.updatedAt = liNowIso();
          window?.QCoreContent?.setState(st);
        }

        if (st.linkedin.uiHidden === true && isAuto) return;

        const modal = liEnsureModal();
        if (modal) liUpdateModal(modal, st);

        try {
          console.log("💼✅ [LinkedIn] modal opened", { reason });
        } catch {}
      } catch {}
    }

    // ---------- Runner ----------
    let __liTickInFlight = false;

    async function liAutoTick(reason = "auto") {
      if (__liTickInFlight) return;
      __liTickInFlight = true;

      let modal = null;

      try {
        // If a press&hold gate is active, do NOT keep clicking around.
        if (typeof __qcorePressHoldActive !== "undefined" && __qcorePressHoldActive) {
          const st = liEnsureInit();
          st.linkedin.stage = "press_hold_wait";
          st.linkedin.lastTickInfo = "Press & Hold active — waiting";
          st.linkedin.updatedAt = liNowIso();
          window?.QCoreContent?.setState(st);

          try {
            modal = liGetCtl()?.modal || null;
            if (modal) liUpdateModal(modal, st);
          } catch {}

          setTimeout(() => liAutoTick("press_hold_wait"), 2000);
          return;
        }

        let st = liEnsureInit();
        let li = st.linkedin || {};

        modal = liGetCtl()?.modal || null;

        // Keep modal updated even if paused
        if (modal) liUpdateModal(modal, st);

        if (!li.running || li.paused) return;

        // Requested: refresh the page every 100s (export first), with a 50s wait before reload.
        try {
          const pr = __qcoreMaybePlanForcedRefresh({
            runner: st.linkedin,
            exportFn: () => {
              try {
                const s2 = liEnsureInit();
                liExportJson(s2);
              } catch {}
            },
            note: "linkedin",
          });
          if (pr && pr.pending) {
            try {
              st = liEnsureInit();
              st.linkedin.stage = "force_refresh_wait";
              st.linkedin.updatedAt = liNowIso();
              window?.QCoreContent?.setState(st);
              if (modal) liUpdateModal(modal, st);
            } catch {}
            try {
              liLog(modal, st, "♻️ Forced refresh planned — exported JSON, reloading in 50s");
            } catch {}
            return;
          }
        } catch {}

        const runToken = Number(li.tickId || 0);

        // If modal is missing but runner is active and not hidden, recreate it.
        if ((!modal || !modal.el || !document.body.contains(modal.el)) && !li.uiHidden) {
          try {
            showLinkedInModal({ reason: `auto_reopen:${reason}` });
            modal = liGetCtl()?.modal || null;
          } catch {}
        }

        // Not on LinkedIn search-results? navigate.
        if (!liIsSearchResultsPage()) {
          st = liEnsureInit();
          li = st.linkedin || {};

          li.stage = "ensure_search_results";
          li.lastTickInfo = `redirect (${reason})`;
          li.lastUrl = location.href;
          li.updatedAt = liNowIso();

          // Pick a query if none is set yet
          if (!String(li.query || "").trim()) {
            liSetQuery(st, liPickRandomKeyword(""), { incrementCycle: false, reason: "no_query_set" });
          }

          window?.QCoreContent?.setState(st);
          if (modal) liUpdateModal(modal, st);

          const url = liBuildSearchUrl(st.linkedin.query || liPickRandomKeyword(""));
          try {
            console.log("💼↪️ [LinkedIn] redirecting to search-results", { to: url, from: location.href });
          } catch {}
          location.href = url;
          return;
        }

        // On correct page; sync query with URL if present.
        const urlKw = liKeywordFromUrl();
        if (urlKw && urlKw !== String(li.query || "")) {
          st = liSetQuery(st, urlKw, { incrementCycle: false, reason: "url_kw_changed" }) || st;
          li = st.linkedin || li;
          window?.QCoreContent?.setState(st);
        }

        // Wait for results
        st = liEnsureInit();
        li = st.linkedin || {};
        li.stage = "wait_results";
        li.lastTickInfo = `tick (${reason})`;
        li.lastUrl = location.href;
        li.updatedAt = liNowIso();
        window?.QCoreContent?.setState(st);
        if (modal) liUpdateModal(modal, st);

        const res = await liWaitForResultsReady(runToken);
        if (!res || !res.ok) {
          // If LinkedIn explicitly says "No results found", rotate keywords immediately.
          if (res && res.noResults) {
            st = liEnsureInit();
            li = st.linkedin || {};

            li.stage = "no_results";
            li.lastTickInfo = "No results found — switching keyword";
            li.updatedAt = liNowIso();

            st.linkedin = li;

            // Keep the runner alive across redirects (requested)
            try {
              if (st.linkedinRunning !== false) st.linkedinRunning = true;
            } catch {}

            const url = liPickNextUrl(st, { incrementCycle: true, reason: "no_results_found" });
            window?.QCoreContent?.setState(st);
            if (modal) liUpdateModal(modal, st);

            location.href = url;
            return;
          }

          st = liEnsureInit();
          li = st.linkedin || {};
          li.stage = "wait_results_retry";
          li.lastTickInfo = "results not ready; retry";
          li.updatedAt = liNowIso();
          window?.QCoreContent?.setState(st);
          if (modal) liUpdateModal(modal, st);
          setTimeout(() => liAutoTick("retry_results"), 1500);
          return;
        }

        // Extract + merge
        st = liEnsureInit();
        li = st.linkedin || {};

        li.stage = "scrape";
        li.updatedAt = liNowIso();

        const jobs = liExtractJobsFromPage();
        const added = liMergeJobs(st, jobs, { keyword: liKeywordFromUrl() || li.query });
        const totalOnQuery = liDetectTotalJobsOnPage();

        if (Number.isFinite(Number(totalOnQuery)) && Number(totalOnQuery) > 0) {
          li.totalJobsOnQuery = Number(totalOnQuery);
        }

        li.totals = li.totals && typeof li.totals === "object" ? li.totals : {};
        li.totals.pagesDone = Number(li.totals.pagesDone || 0) + 1;
        li.totals.jobs = Array.isArray(li.jobs) ? li.jobs.length : 0;

        li.lastTickInfo = `scraped=${jobs.length} added=${added}`;
        li.updatedAt = liNowIso();

        st.linkedin = li;
        window?.QCoreContent?.setState(st);

        if (modal) liUpdateModal(modal, st);

        // Console log new jobs (same as your snippet, but only newly-added)
        try {
          if (added > 0) {
            const tail = (Array.isArray(li.jobs) ? li.jobs : []).slice(-added);
            tail.forEach((job) => console.log(JSON.stringify(job)));
          }
        } catch {}

        // Next page / next keyword
        const nextBtn = liFindNextButton();
        if (nextBtn) {
          st = liEnsureInit();
          li = st.linkedin || {};

          li.stage = "next_page";
          li.lastTickInfo = "click next";
          li.updatedAt = liNowIso();
          st.linkedin = li;
          window?.QCoreContent?.setState(st);
          if (modal) liUpdateModal(modal, st);

          try {
            nextBtn.click();
          } catch {}

          setTimeout(() => liAutoTick("after_next_click"), __LI_AFTER_NEXT_CLICK_WAIT_MS);
          return;
        }

        // End of pagination → pick a new keyword + navigate
        st = liEnsureInit();
        li = st.linkedin || {};

        li.stage = "next_query";
        li.lastTickInfo = "no next button — new keyword";
        li.updatedAt = liNowIso();
        st.linkedin = li;

        const url = liPickNextUrl(st, { incrementCycle: true, reason: "end_of_pagination" });
        window?.QCoreContent?.setState(st);
        if (modal) liUpdateModal(modal, st);

        location.href = url;
        return;
      } catch (e) {
        const isAbort = !!e && !!e.__liAbort;
        try {
          const st = liEnsureInit();
          st.linkedin.stage = isAbort ? st.linkedin.stage : "error";
          st.linkedin.updatedAt = liNowIso();

          const msg = isAbort ? "⏹️ aborted (pause/stop)" : `💥 ERROR: ${String(e?.message || e || "error")}`;
          liPushLogLine(st, msg);
          window?.QCoreContent?.setState(st);

          try {
            const modal2 = liGetCtl()?.modal || null;
            if (modal2) liUpdateModal(modal2, st);
          } catch {}
        } catch {}

        if (!isAbort) setTimeout(() => liAutoTick("retry_after_error"), 2000);
      } finally {
        __liTickInFlight = false;
      }
    }








    function __qcoreWriteStateToWindowName(stateObj) {
      try {
        let payload = stateObj && typeof stateObj === "object" ? { ...stateObj } : {};

        // Mark as our state (signature)
        try {
          if (!payload.__qcoreStateSig) payload.__qcoreStateSig = "qcore";
          payload.__qcoreStateSigV = 2;
          payload.__qcoreStateWrittenAt = new Date().toISOString();
        } catch {}

        let json = "";
        try {
          json = JSON.stringify(payload);
        } catch {
          json = "{}";
        }

        // If too large, fall back to a compact snapshot so window.name never gets "stuck" on an old blob.
        if (json.length > __QCORE_STATE_WN_MAX_CHARS) {
          payload = __qcoreCompactState(stateObj, { maxGfRecords: 200, maxGfJobs: 1500, maxZlRecords: 250, maxRedditRecords: 450, maxRedditLogs: 120, maxFacebookMessages: 450, maxFacebookLogs: 120, maxAmazonItems: 1200, maxAmazonLogs: 120, maxLinkedInJobs: 1200, maxLinkedInCompanies: 1200, maxLinkedInLogs: 120 });
          json = JSON.stringify(payload || {});
        }

        const encoded = encodeURIComponent(json);
        const name = String(window.name || "");
        if (name.includes(__QCORE_STATE_WN_PREFIX)) {
          const re = new RegExp(__QCORE_STATE_WN_PREFIX + "[^;]*");
          window.name = name.replace(re, __QCORE_STATE_WN_PREFIX + encoded);
        } else {
          window.name = name ? name + ";" + __QCORE_STATE_WN_PREFIX + encoded : __QCORE_STATE_WN_PREFIX + encoded;
        }
      } catch {}

    }

    function setState(s) {
      // Apply protections BEFORE updating caches / writing storage
      try {
        s = __qcoreApplyWriteProtections(s);
      } catch {}



      // mirror to localStorage + window.name for cross-domain resilience
      __qcoreWriteStateToLocalStorage(s);
      __qcoreWriteStateToWindowName(s);
    };
  function liAutoBoot() {
      try {
        const st = liEnsureInit();
        const li = st.linkedin || {};
        if (li.running && !li.paused) {
          try {
            showLinkedInModal({ reason: "autoboot" });
          } catch {}
          setTimeout(() => liAutoTick("autoboot"), __LI_STEP_DELAY_MS);
          try {
            console.log("💼✅ [LinkedIn] autoboot", { href: location.href, tickId: li.tickId });
          } catch {}
        }
      } catch {}
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "linkedin",
      title: "LinkedIn Jobs",
      icon: "💼",
      description: "Scrape LinkedIn job listings & export JSON.",
      order: 210,
      onClick: () => { try { showLinkedInModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { liAutoBoot(); } catch {} },
    });
    try { QQ.showLinkedInModal = showLinkedInModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
