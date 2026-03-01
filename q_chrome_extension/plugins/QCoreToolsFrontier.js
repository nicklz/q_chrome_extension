(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.txt`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

    // ------------------------------ NEW: Frontier Flight Search (GoWild! graph runner) ------------------------------
    // Uses shared Q state via window?.QCoreContent?.getState/window?.QCoreContent?.setState (so it survives across flyfrontier.com + booking.flyfrontier.com).
    // Goal:
    //   1) Loop all destinations from LAX and capture GoWild prices.
    //   2) From airports that returned GoWild prices, loop outbound flights again.
    //   3) Keep looping until a 3-hop path (LAX -> A -> B -> C) is found.
    //
    // Note: This is intentionally verbose with console logs so you can trace the runner.

    const FFS_FRONTIER_SEARCH_URL = "https://www.flyfrontier.com/#Q_SEARCH";
    const FFS_BOOKING_SELECT_PATH = "/Flight/Select";
    window.airports ||= window.QCoreGlobal.initCoreData();
    const FFS_AIRPORTS = window.QCoreGlobal.initCoreData()
      .filter(a => a.country === "USA")
      .map(a => a.code);

    // LocalStorage backup (per-domain) as a safety net when the shared QCore state gets compacted/truncated.
    // NOTE: flyfrontier.com and booking.flyfrontier.com have separate localStorage. This is still useful for
    // crash-recovery and for keeping each domain from "forgetting" progress.
    const __FFS_LS_KEY = "q.frontier.v1";
    const __FFS_LS_KEY_OLD = "q.frontier" + "FlightSearch.v1"; // legacy
    const __FFS_LEGACY_SLICE = "frontier" + "FlightSearch"; // legacy root key

    function ffsReadLS() {
      try {
        const keys = [__FFS_LS_KEY, __FFS_LS_KEY_OLD].filter(Boolean);
        for (const k of keys) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const obj = JSON.parse(raw);
          const st = obj && typeof obj === "object" ? (obj.state || obj.frontier || obj[__FFS_LEGACY_SLICE] || obj) : null;
          if (st && typeof st === "object") return st;
        }
        return null;
      } catch {
        return null;
      }
    }

    function ffsWriteLS(ffsState) {
      try {
        const st = ffsState && typeof ffsState === "object" ? ffsState : {};
        // Keep payload JSON-safe
        const safe = JSON.parse(JSON.stringify(st));
        localStorage.setItem(__FFS_LS_KEY, JSON.stringify({ v: 1, updatedAt: Date.now(), state: safe }));
        // Cleanup legacy key so old state doesn't resurrect
        try { localStorage.removeItem(__FFS_LS_KEY_OLD); } catch {}
        return true;
      } catch {
        return false;
      }
    }






    let __ffsModalEl = null;

    let __ffsModalKeepAliveIv = null;
    let __ffsTickInFlight = false;
    let __ffsRedirectScheduled = false;


    // Frontier Flight Search UI origin input (source-of-truth for configured start origin)
    // We keep a live reference so the runner can read the user's chosen origin reliably.
    let __ffsOriginInputEl = null;
    let __ffsOriginInputLast = "";
    let __ffsOriginInputLastAt = 0;


    let __ffsRunnerLoopIv = null;
    let __ffsLastSeenUrl = "";
    let __ffsLastSeenUrlAt = 0;

    // Spammy debug knobs (requested)
    const FFS_DEBUG_SPAM_STATE = true;

    function ffsErr(...args) {
      try {
        console.error("[FFS]", ...args);
      } catch {}
      // also mirror to normal log so it shows up even if errors are filtered
      try {
        console.log("[FFS][ERR]", ...args);
      } catch {}
    }

    function ffsDumpState(tag = "state_dump", extra = null) {
      if (!FFS_DEBUG_SPAM_STATE) return;
      try {
        const s = ffsRead();
        const jobs = Array.isArray(s.jobs) ? s.jobs : [];
        const searching = jobs.filter((j) => String(j.status).toLowerCase() === "searching").slice(-1)[0] || null;

        const summary = {
          tag: String(tag || "state_dump"),
          url: String(location.href || ""),
          running: !!s.running,
          runId: s.runId || null,
          plan: s.plan || null,
          jobsCount: jobs.length,
          searchingJob: searching
            ? {
                id: searching.id,
                origin: searching.origin,
                destination: searching.destination,
                status: searching.status,
                step: searching.step,
                ageSec: (searching.updatedAt || searching.createdAt) ? Math.floor((ffsNow() - Number(searching.updatedAt || searching.createdAt || 0)) / 1000) : 0,
                retries: searching.retries || 0,
              }
            : null,
          lastTickInfo: s.lastTickInfo || "",
          lastTickAt: s.lastTickAt || 0,
          lastError: s.lastError || "",
        };

        console.log("[FFS][STATE]", summary, extra ? { extra } : "");
        // Full dump (trimmed) — only on "big moments" so the console doesn't melt.
        try {
          const t = String(tag || "");
          const shouldFull = t && !/^update$/i.test(t) && !/^write$/i.test(t);
          if (shouldFull) {
            const raw = JSON.stringify(s);
            console.log("[FFS][STATE_JSON]", raw.length > 5000 ? raw.slice(0, 5000) + "…(trimmed)" : raw);
          }
        } catch {}
      } catch (e) {
        // never block execution
        try {
          console.log("[FFS][STATE] dump failed", e);
        } catch {}
      }
    }

    function ffsNow() {

      return Date.now();
    }






    // Deep clone helper (was deleted; required by multiple Frontier runner paths)
    function ffsClone(obj) {
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch {
        return obj;
      }
    }

    // Extract an IATA code from values like "Los Angeles, CA (LAX)" or "LAX"
    function ffsIataFromAny(val) {
      try {
        const s = String(val || "").trim().toUpperCase();
        if (!s) return "";
        const m1 = s.match(/\(([A-Z]{3})\)\s*$/);
        if (m1 && m1[1]) return m1[1];
        if (/^[A-Z]{3}$/.test(s)) return s;
        const m2 = s.match(/\b([A-Z]{3})\s*$/);
        if (m2 && m2[1]) return m2[1];
        return "";
      } catch {
        return "";
      }
    }


    function ffsIsFrontierDomain() {
      const h = String(location.hostname || "").toLowerCase();
      return h === "www.flyfrontier.com" || h.endsWith(".flyfrontier.com");
    }

    function ffsIsBookingDomain() {
      const h = String(location.hostname || "").toLowerCase();
      return h === "booking.flyfrontier.com";
    }

    function ffsIsQSearch() {
      try {
        return String(location.hash || "") === "#Q_SEARCH" || String(location.href || "").includes("#Q_SEARCH");
      } catch {
        return false;
      }
    }

    function ffsIsBookingSelect() {
      try {
        return ffsIsBookingDomain() && String(location.pathname || "") === FFS_BOOKING_SELECT_PATH;
      } catch {
        return false;
      }
    }

    function ffsGetTomorrowMeta() {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      const unix = d.getTime();

      // Format: "Feb 03 2026"
      let text = "";
      try {
        const mon = d.toLocaleString("en-US", { month: "short" });
        const dd = String(d.getDate()).padStart(2, "0");
        const yyyy = String(d.getFullYear());
        text = `${mon} ${dd} ${yyyy}`;
      } catch {
        text = "Feb 03 2026";
      }
      return { dateObj: d, unix, text };
    }



    function ffsParsePriceValue(text) {
      try {
        const raw = String(text || "").trim();
        if (!raw) return 0;
        if (raw === "--" || raw.includes("--")) return 0;
        const m = raw.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
        const v = m && m[1] ? Number(m[1]) : 0;
        return Number.isFinite(v) ? v : 0;
      } catch {
        return 0;
      }
    }




    function ffsEdgesFromJobs(jobs) {
      const list = Array.isArray(jobs) ? jobs : ffsJobs();
      return list
        .filter((j) => j && String(j.status).toLowerCase() === "complete")
        .map((j) => {
          const price = String(j.result || "").trim();
          const value =
            typeof j.resultValue === "number" && Number.isFinite(j.resultValue) ? Number(j.resultValue) : ffsParsePriceValue(price);
          const hasGoWild = j.hasGoWildPrice === true || value > 0;
          return {
            jobId: j.id,
            origin: ffsNormalizeAirport(j.origin),
            destination: ffsNormalizeAirport(j.destination),
            price,
            value,
            hasGoWild,
            hop: Number(j.hop || 0),
          };
        })
        // Only treat *non-zero* GoWild results as edges for pathfinding.
        .filter((e) => e.origin && e.destination && Number(e.value || 0) > 0);
    }

    function ffsFind3HopPath(edges, startOrigin) {
      const start = ffsNormalizeAirport(startOrigin);
      if (!start) return null;

      const adj = new Map();
      for (const e of edges || []) {
        if (!e || !e.origin || !e.destination) continue;
        const o = ffsNormalizeAirport(e.origin);
        const d = ffsNormalizeAirport(e.destination);
        if (!adj.has(o)) adj.set(o, []);
        adj.get(o).push({ ...e, origin: o, destination: d });
      }

      const out1 = adj.get(start) || [];
      for (const e1 of out1) {
        const A = e1.destination;
        if (!A || A === start) continue;
        const out2 = adj.get(A) || [];
        for (const e2 of out2) {
          const B = e2.destination;
          if (!B || B === start || B === A) continue;
          const out3 = adj.get(B) || [];
          for (const e3 of out3) {
            const C = e3.destination;
            if (!C || C === start || C === A || C === B) continue;
            return {
              airports: [start, A, B, C],
              edges: [e1, e2, e3],
            };
          }
        }
      }
      return null;
    }

    function ffsMaybeRecordFoundPath() {
      const ffs = ffsRead();
      if (Array.isArray(ffs.foundPaths) && ffs.foundPaths.length) return ffs.foundPaths[0];

      const edges = ffsEdgesFromJobs(ffs.jobs);
      const found = ffsFind3HopPath(edges, ffs.startOrigin || "LAX");
      if (!found) return null;

      ffsLog("🎯 Found 3-hop path!", found);
      ffsWrite({
        ...ffs,
        running: false,
        stoppedAt: ffsNow(),
        foundPaths: [
          {
            foundAt: ffsNow(),
            airports: found.airports,
            edges: found.edges,
          },
        ],
        lastTickInfo: "found_3_hop_path",
      });
      return found;
    }

    function ffsComputeReachableOriginsForNextPhase(prevPhase, ffsState) {
      // prevPhase: 0 => phase0 finished, compute origins for phase1 from successful LAX->X
      // prevPhase: 1 => phase1 finished, compute origins for phase2 from successful phase1 origins -> X
      const ffs = ffsState || ffsRead();
      const edges = ffsEdgesFromJobs(ffs.jobs);

      if (prevPhase === 0) {
        const start = ffsNormalizeAirport(ffs.startOrigin || "LAX");
        const reachable1 = Array.from(new Set(edges.filter((e) => e.origin === start).map((e) => e.destination))).sort();
        return reachable1;
      }

      if (prevPhase === 1) {
        const phase1Origins = Array.isArray(ffs.plan?.origins) ? ffs.plan.origins.map(ffsNormalizeAirport) : [];
        const originSet = new Set(phase1Origins);
        const reachable2 = Array.from(new Set(edges.filter((e) => originSet.has(e.origin)).map((e) => e.destination))).sort();
        return reachable2;
      }

      return [];
    }

      function ffsAutoBoot() {
      try {
        const ffs = ffsRead();
        const hasSearching = !!ffsFindSearchingJob(ffs.jobs);
        if (!(ffs.running || hasSearching)) return;
        ffsLog("AutoBoot", { running: ffs.running, hasSearching, href: location.href });
        __ffsRedirectScheduled = false;
        ffsEnsureModalOpen({ reason: "auto_boot" });
        ffsStartModalKeepAlive();
        ffsStartRunnerLoop();
        setTimeout(() => ffsAutoTick("auto_boot"), 400);

        // Also tick when hash changes (Frontier is hash-routed)
        if (!window.__ffsHashListenerInstalled) {
          window.__ffsHashListenerInstalled = true;
          window.addEventListener("hashchange", () => {
            try {
              const s = ffsRead();
              const hs = !!ffsFindSearchingJob(s.jobs);
              if (s.running || hs) setTimeout(() => ffsAutoTick("hashchange"), 150);
            } catch {}
          });
        }
      } catch (e) {
        ffsLog("AutoBoot error", e);
      }
    }

    function ffsAdvancePhaseIfDone() {
      const ffs = ffsRead();
      const searching = ffsFindSearchingJob(ffs.jobs);
      const plan = ffs.plan || {};

      // Only advance when we've finished scheduling the phase (originIdx >= origins.length)
      // AND there is no searching job.
      const phaseOrigins = Array.isArray(plan.origins) ? plan.origins : [];
      const scheduledDone = Number(plan.originIdx || 0) >= phaseOrigins.length;

      if (searching || !scheduledDone) return ffs;

      // If phase2 (third hop search) is done and we didn't find, stop.
      if (Number(plan.phase || 0) >= (ffs.maxHops || 3) - 1) {
        ffsLog("Phase 2 completed; stopping (no 3-hop path found yet).", { phase: plan.phase });
        return ffsWrite({
          ...ffs,
          running: false,
          stoppedAt: ffsNow(),
          lastTickInfo: "phase2_done_stop",
        });
      }

      const prevPhase = Number(plan.phase || 0);
      const nextPhase = prevPhase + 1;
      const nextOrigins = ffsComputeReachableOriginsForNextPhase(prevPhase, ffs);

      if (!nextOrigins.length) {
        ffsLog("No reachable origins for next phase; stopping.", { prevPhase, nextPhase });
        return ffsWrite({
          ...ffs,
          running: false,
          stoppedAt: ffsNow(),
          lastError: `No reachable origins for phase ${nextPhase}`,
          lastTickInfo: "no_reachable_origins_stop",
        });
      }

      ffsLog("Advancing phase", { from: prevPhase, to: nextPhase, origins: nextOrigins });
      return ffsWrite({
        ...ffs,
        plan: {
          phase: nextPhase,
          origins: nextOrigins,
          originIdx: 0,
          destIdx: 0,
          phaseStartedAt: ffsNow(),
          phaseCompletedAt: 0,
        },
        lastTickInfo: `phase_advance_${prevPhase}_to_${nextPhase}`,
      });
    }

    async function ffsWait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }


    // ------------------------------ UI Origin Helpers ------------------------------
    // The user requested: the Origin on our Frontier Flight Search modal is the source of truth.
    // We "double-check" it (read → wait 1s → read again) to avoid any stale/autofill weirdness.
    function ffsIsKnownAirport(code) {
      const c = ffsNormalizeAirport(code);
      if (!c) return false;
      try {
        return FFS_AIRPORTS.includes(c);
      } catch {
        return false;
      }
    }

    function ffsGetOriginInputEl() {
      try {
        const el =
          __ffsOriginInputEl ||
          document.querySelector('[data-qcore-ffs-origin-input="1"]') ||
          document.querySelector("#qcore-ffs-origin-input");
        if (el) __ffsOriginInputEl = el;
        return el || null;
      } catch {
        return null;
      }
    }

    function ffsReadUiOriginOnce() {
      try {
        const el = ffsGetOriginInputEl();
        const raw = el && typeof el.value !== "undefined" ? String(el.value || "") : "";
        const v = ffsNormalizeAirport(raw);
        if (v) {
          __ffsOriginInputLast = v;
          __ffsOriginInputLastAt = ffsNow();
        }
        return v || "";
      } catch {
        return "";
      }
    }

    async function ffsReadUiOriginStable({ delayMs = 1000, context = "" } = {}) {
      // If a "Press & Hold" gate is present, pause so we don't race UI changes while blocked.
      await ffsMaybePauseForPressHold(`ui_origin:${context || "stable"}`);

      const a = ffsReadUiOriginOnce();
      try {
        console.log("🧭🧭 [FFS][ORIGIN][UI] read1", { context, value: a || null });
      } catch {}
      ffsLog("🧭 UI origin read1", { context, value: a || null });

      // Wait a beat and read again (requested)
      await ffsWait(Math.max(0, Number(delayMs || 0)));

      await ffsMaybePauseForPressHold(`ui_origin:${context || "stable"}:read2`);

      const b = ffsReadUiOriginOnce();
      try {
        console.log("🧭🧭 [FFS][ORIGIN][UI] read2", { context, value: b || null });
      } catch {}
      ffsLog("🧭 UI origin read2", { context, value: b || null });

      const picked = b || a || __ffsOriginInputLast || "";
      const v = ffsNormalizeAirport(picked);

      // If user typed something weird, fall back to state.startOrigin.
      if (!v) {
        const fallback = ffsNormalizeAirport(ffsRead().startOrigin || "LAX") || "LAX";
        ffsLog("🧭 UI origin empty → fallback to state.startOrigin", { context, fallback });
        return fallback;
      }

      // If it's not in our airport list, we still allow it (Frontier may support more),
      // but we log it loudly so you can spot typos.
      if (!ffsIsKnownAirport(v)) {
        ffsLog("⚠️ UI origin not in airport list (still using it)", { context, v });
      }

      ffsLog("🧭 UI origin stable", { context, v });
      return v;
    }

    async function ffsSyncStartOriginFromUi({ context = "sync", delayMs = 1000 } = {}) {
      // Modal Origin input is the source of truth.
      const uiOriginRaw = await ffsReadUiOriginStable({ delayMs, context: `sync:${context}` });
      const uiOrigin = ffsNormalizeAirport(ffsIataFromAny(uiOriginRaw) || uiOriginRaw) || "LAX";

      const cur = ffsRead();
      const curStart = ffsNormalizeAirport(cur.startOrigin || "LAX") || "LAX";
      const plan = cur.plan || {};
      const phase = Number(plan.phase || 0);
      const planOrigins = Array.isArray(plan.origins) ? plan.origins.map(ffsNormalizeAirport) : [];

      // Phase0 should always be seeded by the UI origin.
      const phase0SeedMismatch = !(planOrigins.length === 1 && planOrigins[0] === uiOrigin);

      // If we're in phase>0 but we haven't even produced a single hop-1 job for the UI origin,
      // the plan is stale (typically because origin changed after a previous run).
      const jobs = Array.isArray(cur.jobs) ? cur.jobs : [];
      const hasHop1FromUiOrigin = jobs.some(
        (j) => j && Number(j.hop || 0) === 1 && ffsNormalizeAirport(j.origin) === uiOrigin
      );
      const planLooksStale = phase > 0 && !hasHop1FromUiOrigin;

      const needsReset = uiOrigin !== curStart || (phase === 0 && phase0SeedMismatch) || planLooksStale;

      if (!needsReset) return uiOrigin;

      ffsLog("🔁 Sync startOrigin from UI", {
        context,
        uiOrigin,
        curStart,
        phase,
        phase0SeedMismatch,
        planLooksStale,
      });

      ffsUpdate(
        (s) => {
          const prev = ffsNormalizeAirport(s.startOrigin || "LAX") || "LAX";
          s.startOrigin = uiOrigin;

          const p = s.plan && typeof s.plan === "object" ? s.plan : {};
          const keepDestIdx = Number(p.destIdx || 0);

          // If origin changed OR plan is stale, reset to phase0 (but KEEP jobs).
          if (prev !== uiOrigin || planLooksStale) {
            s.plan = {
              phase: 0,
              origins: [uiOrigin],
              originIdx: 0,
              destIdx: 0,
              phaseStartedAt: ffsNow(),
              phaseCompletedAt: 0,
            };
            s.foundPaths = [];
            s.lastOriginChangeAt = ffsNow();
            s.lastOriginChangeFrom = prev;
            s.lastOriginChangeTo = uiOrigin;
            return;
          }

          // Otherwise, just make sure phase0 is pinned
          if (Number(p.phase || 0) === 0) {
            p.origins = [uiOrigin];
            p.originIdx = 0;
            s.plan = p;
          }
        },
        `🧭 Origin sync: ${curStart} → ${uiOrigin}${planLooksStale ? " (reset stale plan)" : ""}`
      );

      return uiOrigin;
    }




    // ------------------------------ Press & Hold Barrier ------------------------------
    // If the anti-bot "Press & Hold" gate shows up, PAUSE the whole Frontier runner until it's done.
    //
    // BUGFIX:
    //  - Previous code used NodeList.find() (not supported) so detection was effectively always false.
    //  - It also referenced __qcorePressHoldActive / __qcorePressHoldEndsAt as bare identifiers, but the
    //    Press&Hold runner stored them in a different scope, causing ReferenceError and stopping the runner.
    //
    // We now:
    //  - detect via the canonical container [aria-label="Press & Hold"] (same as the auto-runner) + iframe fallback
    //  - read gate state from globalThis so all tools can safely pause/resume
    function ffsIsPressHoldPresent() {
      try {
        // Primary: in-page gate container
        if (document.querySelector('[aria-label="Press & Hold"]')) return true;

        // Fallback: sometimes it's rendered inside an iframe
        const iframes = document.querySelectorAll("iframe");
        for (let i = 0; i < iframes.length; i++) {
          const fr = iframes[i];
          try {
            const txt = fr?.contentDocument?.body?.innerText || "";
            if (String(txt).includes("Press & Hold")) return true;
          } catch {
            // cross-origin iframe; ignore
          }
        }
        return false;
      } catch {
        return false;
      }
    }

    function ffsPressHoldRemainingSec() {
      try {
        const now = ffsNow();
        const ends = Number(globalThis.__qcorePressHoldEndsAt || 0);
        if (!ends) return null;
        return Math.max(0, Math.ceil((ends - now) / 1000));
      } catch {
        return null;
      }
    }

    async function ffsMaybePauseForPressHold(context = "") {
      try {
        const getActive = () => !!globalThis.__qcorePressHoldActive;

        // If present, make sure the press-hold is actually started
        const present = ffsIsPressHoldPresent();
        if (present) {
          try {
            if (typeof globalThis.__qcoreMaybeStartPressHold === "function") {
              globalThis.__qcoreMaybeStartPressHold(`ffs:${context || "pause"}`);
            }
          } catch {}
        }

        // If nothing to wait on, return fast.
        if (!present && !getActive()) return false;

        let ticks = 0;
        while (true) {
          const stillPresent = ffsIsPressHoldPresent();
          const active = getActive();
          if (!stillPresent && !active) break;

          // Keep trying to start it if it's present but not active yet.
          if (stillPresent && !active) {
            try {
              if (typeof globalThis.__qcoreMaybeStartPressHold === "function") {
                globalThis.__qcoreMaybeStartPressHold(`ffs:${context || "pause"}:retry`);
              }
            } catch {}
          }

          const rem = ffsPressHoldRemainingSec();
          const msg = `✋🧱 Press & Hold gate active — pausing (${rem != null ? rem + "s" : "…"})${context ? " • " + context : ""}`;
          ffsLog(msg);
          ffsUpdate(() => {}, msg);

          await ffsWait(1000);
          ticks++;

          // Safety: if this sticks around forever, keep waiting but log louder every 60s.
          if (ticks % 60 === 0) {
            ffsErr("Still waiting on Press & Hold gate…", { context, ticks });
          }
        }

        const doneMsg = `✅✋ Press & Hold complete — resuming${context ? " • " + context : ""}`;
        ffsLog(doneMsg);
        ffsUpdate(() => {}, doneMsg);
        await ffsWait(500);
        return true;
      } catch (e) {
        ffsErr("Press & Hold pause failed", e);
        return false;
      }
    }

  // ------------------------------ Frontier Slow-Mode Helpers ------------------------------
    // Requested: 1s padding BEFORE and AFTER each form field fill, with console logs + modal status updates.
    const FFS_INPUT_PAD_MS = 1000;

    async function ffsPadStep({ label = "", jobId = "", step = "", ms = FFS_INPUT_PAD_MS } = {}) {
      const jid = jobId ? String(jobId) : "";
      const baseStep = step ? String(step) : "";
      const cleanLabel = String(label || "").trim() || "Waiting";
      const totalMs = Math.max(0, Number(ms || 0));

      // If a "Press & Hold" gate is present, pause ALL automation until it finishes.
      await ffsMaybePauseForPressHold(`pad:${cleanLabel}`);


      // Update once even if ms < 1000
      if (totalMs > 0 && totalMs < 1000) {
        if (jid && baseStep) ffsPatchJob(jid, { step: baseStep });
        const msg = `⏳ ${cleanLabel} (${Math.round(totalMs)}ms)`;
        ffsLog(msg);
        // Important: call ffsUpdate AFTER ffsPatchJob so our message wins over "patch_job"
        ffsUpdate(() => {}, msg);
        await ffsWait(totalMs);
        return;
      }

      const seconds = Math.max(0, Math.round(totalMs / 1000));
      if (seconds <= 0) return;

      for (let i = seconds; i >= 1; i--) {
        // If a "Press & Hold" gate pops up mid-countdown, pause until it's done.
        await ffsMaybePauseForPressHold(`pad:${cleanLabel}:${i}s`);

        if (jid && baseStep) ffsPatchJob(jid, { step: `${baseStep}_${i}s` });
        const msg = `⏳ ${cleanLabel} (${i}s)`;
        ffsLog(msg);
        // Important: call ffsUpdate AFTER ffsPatchJob so our message wins over "patch_job"
        ffsUpdate(() => {}, msg);
        await ffsWait(1000);
      }
    }

    async function ffsSlowSetInput({ jobId = "", field = "field", selector, value, timeoutMs = 20000 } = {}) {
      const jid = jobId ? String(jobId) : "";
      const key = String(field || "field");
      const valStr = String(value ?? "");

      await ffsPadStep({ label: `Before ${key}`, jobId: jid, step: `pad_before_${key}`, ms: FFS_INPUT_PAD_MS });

      if (jid) ffsPatchJob(jid, { step: `set_${key}` });
      ffsLog(`⌨️ setting ${key}`, { selector, value: valStr });
      try { console.log("📝✨ [FFS][INPUT]", key, { selector, value: valStr }); } catch {}
      ffsUpdate(() => {}, `⌨️ Setting ${key}: ${valStr}`);

      const el = await ffsSetInputValue(selector, value, timeoutMs);

      if (jid) ffsPatchJob(jid, { step: `set_${key}_done` });
      ffsLog(`✅ ${key} set`, { selector, value: valStr });
      ffsUpdate(() => {}, `✅ ${key} set: ${valStr}`);

      await ffsPadStep({ label: `After ${key}`, jobId: jid, step: `pad_after_${key}`, ms: FFS_INPUT_PAD_MS });

      try { console.log("✅✨ [FFS][INPUT] done", key, { selector, value: valStr }); } catch {}
      return el;
    }



    async function ffsRedirectWithCountdown(url, { seconds = 3, reason = "" } = {}) {
      try {
        if (__ffsRedirectScheduled) return;
        __ffsRedirectScheduled = true;

        const label = reason ? `Redirecting (${reason})` : "Redirecting";
        await ffsPadStep({ label, ms: Math.max(0, seconds) * 1000 });

        ffsLog("➡️ Redirect now", { url, reason });
        window.location.href = url;
      } catch (e) {
        ffsErr("redirectWithCountdown failed", e);
        try {
          window.location.href = url;
        } catch (_) {}
      }
    }

    function ffsStartRunnerLoop() {
      if (__ffsRunnerLoopIv) return;
      __ffsRunnerLoopIv = setInterval(() => {
        try {
          const ffs = ffsRead();
          const hasSearching = !!ffsFindSearchingJob(ffs.jobs || []);
          if (!(ffs.running || hasSearching)) {
            clearInterval(__ffsRunnerLoopIv);
            __ffsRunnerLoopIv = null;
            return;
          }
          ffsAutoTick("runner_loop");
        } catch (e) {
          // swallow
        }
      }, 2000);
    }

    function ffsStopRunnerLoop() {
      if (!__ffsRunnerLoopIv) return;
      clearInterval(__ffsRunnerLoopIv);
      __ffsRunnerLoopIv = null;
    }

    async function ffsWaitForSelector(selector, timeoutMs = 15000) {
      const started = ffsNow();
      while (ffsNow() - started < timeoutMs) {
        // If a "Press & Hold" gate appears while we're waiting for DOM, pause until it's done.
        if (ffsIsPressHoldPresent() || !!globalThis.__qcorePressHoldActive) {
          await ffsMaybePauseForPressHold(`wait_for_selector:${selector}`);
        }

        const el = document.querySelector(selector);
        if (el) return el;
        await ffsWait(150);
      }
      return null;
    }

    function ffsDispatchInputEvents(el) {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {}
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}
      try {
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch {}
    }

    async function ffsSetInputValue(selector, value, timeoutMs = 15000) {
      const el = await ffsWaitForSelector(selector, timeoutMs);
      if (!el) return null;
      try {
        el.focus?.();
      } catch {}
      el.value = String(value ?? "");
      ffsDispatchInputEvents(el);
      return el;
    }

    async function ffsClick(selector, timeoutMs = 15000) {
      const el = await ffsWaitForSelector(selector, timeoutMs);
      if (!el) return null;
      try {
        el.click?.();
      } catch {}
      return el;
    }

    function ffsExtractGoWildPrice() {
      const priceEl =
        document.querySelector(".navItem.itmnav.navmain-parent.gw .navitlblprc, .navItem.gw .navitlblprc, .gw .navitlblprc");
      if (!priceEl) return "";
      const raw = String(priceEl.textContent || "").trim();

      // Treat "--" as no GoWild price
      if (!raw || raw === "--" || raw.includes("--")) return "";

      const m = raw.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
      if (m && m[1]) return `$${m[1]}`;
      return raw;
    }

      async function ffsCapturePriceOnResultsAndRedirect({ reason = "capture" } = {}) {
      try {
        if (__ffsRedirectScheduled) {
          ffsLog("🚫 Redirect already scheduled; skipping capture redirect scheduling.");
          // Still return the current DOM value if possible
          const quick = ffsExtractGoWildPrice() || "$0";
          ffsDumpState("capture_skip_redirect", { quick });
          return quick;
        }

        const ffsState = ffsRead();
        const searchingJob = ffsFindSearchingJob(ffsState.jobs);

        // Requested: loud emoji log on landing
        ffsLog("🛬🛬🛬🛬🛬 LANDING: booking.flyfrontier.com " + String(location.pathname || "") + " 🛬🛬🛬🛬🛬", {
          reason,
          href: location.href,
          searchingJobId: searchingJob ? searchingJob.id : null,
        });

        ffsDumpState("capture_landing", { reason });

        if (searchingJob) {
          ffsLog("🔎 Capturing GoWild price for searching job…", { jobId: searchingJob.id, reason, href: location.href });
          ffsPatchJob(searchingJob.id, { step: "capturing_price", pageUrlAtCapture: String(location.href || "") });
        } else {
          ffsLog("⚠️ No searching job found on results page; will still attempt to capture GoWild price from DOM.");
        }

        // Wait for price element, then grab it.
        const gwSel = ".navItem.itmnav.navmain-parent.gw .navitlblprc, .navItem.gw .navitlblprc, .gw .navitlblprc";
        let priceEl = document.querySelector(gwSel);
        if (!priceEl) {
          await ffsWaitForSelector(".navItem.itmnav.navmain-parent.gw .navitlblprc", 15000);
          priceEl = document.querySelector(gwSel);
        }

        const raw = priceEl ? String(priceEl.textContent || "").trim() : "";
        let price = ffsExtractGoWildPrice(); // sanitized ($123) or "" for none/--
        const priceOut = price || "$0";

        const value = ffsParsePriceValue(priceOut);
        const hasGoWild = value > 0;

        // Requested: spam result 10 times
        for (let i = 0; i < 10; i++) {
          console.log(`[FFS] 💥🌵✈️ GoWild price spam ${i + 1}/10:`, priceOut, { raw });
        }

        ffsLog("🧾 GoWild capture snapshot", { priceOut, value, hasGoWild, raw, foundEl: !!priceEl });

        if (searchingJob) {
          // ALWAYS complete the job (even if $0) so the queue keeps moving (requested).
          const step = hasGoWild ? "captured_price" : "captured_no_price";
          ffsPatchJob(searchingJob.id, {
            status: "complete",
            step,
            result: priceOut,
            resultRaw: raw,
            resultValue: value,
            hasGoWildPrice: hasGoWild,
            capturedAt: ffsNow(),
          });

          ffsUpdate(() => {}, `✅ Job complete: ${searchingJob.origin}→${searchingJob.destination} = ${priceOut}`);

          // After updating job, maybe record a 3-hop path
          ffsMaybeRecordFoundPath();

          // Advance phase if needed (e.g., phase0 done -> phase1)
          ffsAdvancePhaseIfDone();

          ffsDumpState("capture_complete", { jobId: searchingJob.id, priceOut, value, hasGoWild });
        } else {
          // Even without a job, still run path detection in case user is debugging
          ffsMaybeRecordFoundPath();
          ffsDumpState("capture_no_job", { priceOut, value, hasGoWild });
        }

        // ALWAYS go back to #Q_SEARCH (requested)
        await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: `after_capture:${reason}` });

        return priceOut;
      } catch (e) {
        ffsErr("capturePriceOnResultsAndRedirect failed", e);
        try {
          // Don't deadlock the queue if capture blows up — finish the searching job as $0 and continue.
          const ffsState = ffsRead();
          const searchingJob = ffsFindSearchingJob(ffsState.jobs);
          if (searchingJob) {
            ffsPatchJob(searchingJob.id, {
              status: "complete",
              step: "capture_error_complete",
              result: "$0",
              resultRaw: "",
              resultValue: 0,
              hasGoWildPrice: false,
              capturedAt: ffsNow(),
              error: e?.message || String(e),
            });
          }
        } catch {}
        try {
          await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: "capture_error" });
        } catch {}
        return "$0";
      }
    }

  function ffsPickNextPlannedPair(ffsState) {
      const ffs = ffsState || ffsRead();
      const plan = ffs.plan || {};
      const origins = Array.isArray(plan.origins) ? plan.origins.map(ffsNormalizeAirport) : [ffs.startOrigin || "LAX"];
      let oi = Number(plan.originIdx || 0);
      let di = Number(plan.destIdx || 0);
      const { unix: depUnix, text: depText } = ffsGetTomorrowMeta();

      while (oi < origins.length) {
        const origin = origins[oi];
        while (di < FFS_AIRPORTS.length) {
          const dest = ffsNormalizeAirport(FFS_AIRPORTS[di]);
          const curDestIdx = di;
          di += 1;
          if (!dest || dest === origin) continue;

          // Avoid duplicates for same date
          if (ffsHasJobFor({ origin, destination: dest, departureDateUnix: depUnix })) continue;

          return {
            origin,
            destination: dest,
            depUnix,
            depText,
            nextPlan: {
              phase: Number(plan.phase || 0),
              origins,
              originIdx: oi,
              destIdx: di,
            },
            pickedFrom: { oi, destIdxUsed: curDestIdx },
          };
        }
        // advance origin
        oi += 1;
        di = 0;
      }

      return null;
    }

    async function ffsSubmitSearchOnQSearch() {
      const ffsState0 = ffsRead();
      const searchingJob = ffsFindSearchingJob(ffsState0.jobs);
      if (searchingJob) {
        ffsLog("A job is already searching; not submitting a new one.", searchingJob.id);
        return;
      }

      // 🔎🧭 Sync configured Origin from the Frontier Flight Search modal (double-check read).
      // This ensures the modal input is the true source-of-truth for the start origin.
      await ffsSyncStartOriginFromUi({ context: "submit_qsearch", delayMs: 1000 });


      // Ensure phase advancement if phase fully scheduled
      const ffsState = ffsAdvancePhaseIfDone();
      const fresh = ffsRead();
      if (!fresh.running) {
        ffsLog("Runner not running (or stopped). Skipping submit.");
        return;
      }

      const pick = ffsPickNextPlannedPair(fresh);
      if (!pick) {
        // Nothing left in this phase; mark phase complete and try advance
        ffsLog("No next pair found in current phase; marking scheduled done and advancing.");
        ffsWrite({
          ...fresh,
          plan: {
            ...(fresh.plan || {}),
            originIdx: Array.isArray(fresh.plan?.origins) ? fresh.plan.origins.length : 9999,
            destIdx: 0,
            phaseCompletedAt: ffsNow(),
          },
        });
        ffsAdvancePhaseIfDone();
        return;
      }

      let { origin, destination, depUnix, depText } = pick;

      // Quick guard: if we're in phase0 (hop-1), the configured Origin must match the modal input.
      // (We already did a double-check sync above, but this catches any last-second drift.)
      try {
        const phase0 = Number(pick?.nextPlan?.phase || 0) === 0;
        if (phase0) {
          const uiOriginQuick = ffsReadUiOriginOnce() || __ffsOriginInputLast || "";
          const uiOriginNorm = ffsNormalizeAirport(uiOriginQuick);
          if (uiOriginNorm && uiOriginNorm !== ffsNormalizeAirport(origin || "")) {
            ffsLog("🧭 Phase0 origin guard override", { from: origin, to: uiOriginNorm });
            origin = uiOriginNorm;
          }
        }
      } catch {}

      // Update plan indices (destIdx, originIdx if needed)
      const nextPlan = pick.nextPlan;
      const updatedPlan = ffsClone(fresh.plan || {});
      updatedPlan.phase = Number(nextPlan.phase || 0);
      updatedPlan.origins = nextPlan.origins;

      // Keep phase0 plan origins pinned to the configured origin (modal UI).
      if (Number(updatedPlan.phase || 0) === 0) {
        updatedPlan.origins = [origin];
        updatedPlan.originIdx = 0;
      }
      updatedPlan.originIdx = Number(nextPlan.originIdx || 0);
      updatedPlan.destIdx = Number(nextPlan.destIdx || 0);

      // If we finished destinations list for this origin, the picker already moved di; but we only updated destIdx.
      // We'll compute scheduled completion lazily.

      const ts = ffsNow();
      const hop = Number(updatedPlan.phase || 0) + 1;
      const job = {
        id: `job_${ts}`,
        name: `job_${ts}`,
        status: "searching",
        step: "submitting",
        hop,
        phase: Number(updatedPlan.phase || 0),
        origin,
        destination,
        departureDateUnix: depUnix,
        departureDateText: depText,
        createdAt: ts,
        updatedAt: ts,
        result: "",
        resultRaw: "",
        resultValue: 0,
        hasGoWildPrice: false,
        pageUrlAtSubmit: String(location.href || ""),
      };

      ffsLog("Submitting new search job", { jobId: job.id, origin, destination, depText, hop, phase: job.phase });

      // Persist plan + job before clicking search
      ffsWrite({
        ...fresh,
        plan: updatedPlan,
        jobs: (Array.isArray(fresh.jobs) ? fresh.jobs : []).concat([job]),
        lastTickInfo: "submit_search",
        lastTickAt: ffsNow(),
      });

      // Fill the form

      // Fill the form (SLOW MODE: 1s padding before/after each field)
      await ffsSlowSetInput({ jobId: job.id, field: "origin", selector: "#origin", value: origin, timeoutMs: 20000 });

      // Click one-way radio (label or input) — also padded
      await ffsPadStep({ label: "Before One-way click", jobId: job.id, step: "pad_before_oneway", ms: 1000 });

      const oneWayLabel = document.querySelector('label.rb-container.one-way[for="rboneway"]');
      const oneWayInput =
        document.getElementById("rboneway") ||
        document.querySelector('input[type="radio"][name="tripType"][value="oneway"]');
      try {
        if (oneWayInput && !oneWayInput.checked) {
          ffsLog("Clicking One-way input");
          oneWayInput.click();
        } else if (oneWayLabel) {
          ffsLog("Clicking One-way label");
          oneWayLabel.click();
        } else {
          ffsLog("One-way controls not found (continuing anyway)");
        }
      } catch (e) {
        ffsLog("One-way click error", e);
      }

      ffsUpdate(() => {}, "✅ One-way clicked (or already selected)");
      await ffsPadStep({ label: "After One-way click", jobId: job.id, step: "pad_after_oneway", ms: 1000 });

      await ffsSlowSetInput({ jobId: job.id, field: "destination", selector: "#destination", value: destination, timeoutMs: 20000 });

      await ffsSlowSetInput({ jobId: job.id, field: "departureDate", selector: "#departureDate", value: depText, timeoutMs: 20000 });


      // Click Search
      const btn = document.querySelector("#btnSearch");
      if (btn) {
        ffsLog("Clicking Search button…", { jobId: job.id });

        await ffsPadStep({ label: "Before Search click", jobId: job.id, step: "pad_before_search", ms: 1000 });

        try {
          btn.click();
        } catch (e) {
          ffsLog("Search click error", e);
        }

        ffsPatchJob(job.id, { step: "clicked_search" });
        ffsUpdate(() => {}, `🖱️ clicked Search: ${job.origin}→${job.destination}`);

        await ffsPadStep({ label: "After Search click", jobId: job.id, step: "pad_after_search", ms: 1000 });
      } else {
        ffsLog("Search button not found; marking job error", { jobId: job.id });
        ffsPatchJob(job.id, { status: "error", step: "btnSearch_missing", lastError: "#btnSearch not found" });
        ffsUpdate(() => {}, "⚠️ Search button missing (#btnSearch)");
      }
    }

    function ffsJobAgeSeconds(job) {
      try {
        const t = Number(job?.updatedAt || job?.createdAt || 0);
        if (!t) return 0;
        return Math.max(0, Math.floor((ffsNow() - t) / 1000));
      } catch {
        return 0;
      }
    }

    async function ffsRetrySubmitExistingJobOnQSearch(job, attemptNo = 1) {
      if (!job || !job.id) return;
      const jid = job.id;
      const attempt = Math.max(1, Number(attemptNo) || 1);

      const now = ffsNow();
      const lastRetryAt = Number(job.lastRetryAt || 0);

      // Throttle retries so the tick loop doesn't spam-click.
      if (lastRetryAt && now - lastRetryAt < 15000) {
        ffsLog("🔁 Retry throttled (last retry too recent)", { jid, lastRetryAt, now });
        return;
      }

      const route = `${job.origin || "?"}→${job.destination || "?"}`;
      ffsLog("🔁 Retrying search submit on #Q_SEARCH", { attempt, jid, route });
      ffsUpdate(() => {}, `🔁 Retry submit #${attempt}: ${route}`);

      ffsPatchJob(jid, {
        retries: attempt,
        lastRetryAt: now,
        step: `retry_submit_${attempt}_start`,
      });

      const depText = job.departureDateText || ffsGetTomorrowMeta().text;

      // Origin: if this is a hop-1 (phase0) job, ALWAYS trust the modal Origin input (double-check read).
      // This prevents accidental drift (e.g. carrying over the previous destination as origin).
      const uiOrigin = await ffsReadUiOriginStable({ delayMs: 1000, context: `retry_origin_${jid}` });
      const originToUse = Number(job.phase || 0) === 0 ? uiOrigin : ffsNormalizeAirport(job.origin || "") || uiOrigin;

      if (originToUse && originToUse !== ffsNormalizeAirport(job.origin || "")) {
        ffsLog("🧭 Retry origin overridden from UI", { jid, from: job.origin, to: originToUse });
        ffsPatchJob(jid, { origin: originToUse, originOverriddenFromUi: true });
        job.origin = originToUse;
      }

      await ffsSlowSetInput({ jobId: jid, field: "origin", selector: "#origin", value: originToUse });

      // One-way
      await ffsPadStep({ label: "Before one-way", jobId: jid, step: `retry${attempt}_pad_before_oneway`, ms: 1000 });
      const oneway = document.getElementById("rboneway") || document.querySelector('input[type="radio"][name="tripType"][value="oneway"]') || document.querySelector('input[name="tripType"][value="oneway"]');
      if (oneway) {
        oneway.click();
        ffsPatchJob(jid, { step: `retry_submit_${attempt}_clicked_oneway` });
        ffsUpdate(() => {}, `🖱️ clicked One-way (retry #${attempt})`);
      } else {
        ffsPatchJob(jid, { step: `retry_submit_${attempt}_oneway_not_found` });
        ffsUpdate(() => {}, `⚠️ One-way input not found (retry #${attempt})`);
      }
      await ffsPadStep({ label: "After one-way", jobId: jid, step: `retry${attempt}_pad_after_oneway`, ms: 1000 });

      await ffsSlowSetInput({ jobId: jid, field: "destination", selector: "#destination", value: job.destination });
      await ffsSlowSetInput({ jobId: jid, field: "departureDate", selector: "#departureDate", value: depText });

      // Search click
      await ffsPadStep({ label: "Before search click", jobId: jid, step: `retry${attempt}_pad_before_search`, ms: 1000 });
      const btn = document.querySelector("#btnSearch");
      if (btn) {
        btn.click();
        ffsPatchJob(jid, { step: `clicked_search_retry_${attempt}` });
        ffsUpdate(() => {}, `🖱️ clicked Search (retry #${attempt})`);
      } else {
        ffsPatchJob(jid, { step: `retry_submit_${attempt}_search_btn_not_found` });
        ffsUpdate(() => {}, `⚠️ Search button not found (retry #${attempt})`);
      }
      await ffsPadStep({ label: "After search click", jobId: jid, step: `retry${attempt}_pad_after_search`, ms: 1000 });
    }

    async function ffsAutoTick(reason = "auto") {
      if (__ffsTickInFlight) return;
      __ffsTickInFlight = true;
      try {
        const ffs = ffsRead();
        const searchingJob = ffsFindSearchingJob(ffs.jobs || []);
        const hasSearching = !!searchingJob;
        const shouldRun = ffs.running || hasSearching;
        if (!shouldRun) return;

        // If a "Press & Hold" gate is present, pause before doing anything else.
        await ffsMaybePauseForPressHold(`tick:${reason}`);


        // Keep the runner loop alive while we have work.
        ffsStartRunnerLoop();

        ffsEnsureModalOpen({ reason: `tick:${reason}` });

        // Wait 1s when the URL changes so the page can fully settle (requested).
        const curUrl = String(location.href || "");
        if (__ffsLastSeenUrl !== curUrl) {
          __ffsLastSeenUrl = curUrl;
          __ffsLastSeenUrlAt = ffsNow();
          await ffsPadStep({ label: "Page settle (post-nav)", ms: 3000 });
        }

        // Booking results page → capture price → redirect back.
        if (ffsIsBookingSelect()) {
          console.log(
            "🛬🛬🛬🛬🛬🛬🛬🛬🛬🛬  LANDING ON booking.flyfrontier.com/Flight/Select  🛬🛬🛬🛬🛬🛬🛬🛬🛬🛬"
          );
          ffsUpdate(() => {}, "🛬 On booking /Flight/Select → capturing GoWild price…");
          await ffsCapturePriceOnResultsAndRedirect({ reason: `booking_select:${reason}` });
          return;
        }

        // Booking domain (but not /Flight/Select) → wait for it to load/redirect internally.
        if (ffsIsBookingDomain()) {
          const msg = `⏳ On booking domain (${location.pathname}) waiting for /Flight/Select…`;
          ffsLog(msg, { reason, href: location.href });
          ffsUpdate(() => {}, msg);

          // If GoWild UI is already on the page (even if the path isn't /Flight/Select), capture now.
          try {
            const hasGwEl = !!document.querySelector(".navItem.itmnav.navmain-parent.gw .navitlblprc, .navItem.gw .navitlblprc, .gw .navitlblprc");
            if (hasGwEl) {
              const snap = ffsExtractGoWildPrice() || "$0";
              ffsLog("🧲 booking domain has GoWild element → capturing immediately", { snap, path: location.pathname });
              ffsUpdate(() => {}, `🧲 booking.* has GoWild element → capture: ${snap}`);
              await ffsCapturePriceOnResultsAndRedirect({ reason: `booking_domain_has_gw:${reason}` });
              return;
            }
          } catch (e) {
            ffsLog("ERROR OR MISSING GW PRICE", { snap, path: location.pathname });
          }

          // If we're stuck on booking.* without reaching /Flight/Select, don't deadlock the whole loop.
          if (searchingJob) {
            const ageSec = ffsJobAgeSeconds(searchingJob);
            if (ageSec >= 20) {
              const route = `${searchingJob.origin || "?"}→${searchingJob.destination || "?"}`;
              ffsLog("🧹 Booking domain looks stuck; marking job complete ($0) and returning to #Q_SEARCH.", {
                jobId: searchingJob.id,
                route,
                ageSec,
                step: searchingJob.step,
              });
              ffsPatchJob(searchingJob.id, {
                status: "complete",
                step: "stale_on_booking_domain",
                result: "$0",
                resultRaw: "",
                resultValue: 0,
                hasGoWildPrice: false,
                capturedAt: ffsNow(),
                stale: true,
              });
              await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: "booking_domain_stale" });
              return;
            }
          }

          // If we landed here without an active job, bounce back so the loop can continue.
          if (!hasSearching && ffs.running) {
            await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: "booking_domain_no_job" });
          }
          return;
        }

        // flyfrontier.com runner page
        if (ffsIsFrontierDomain()) {
          if (!ffsIsQSearch()) {
            const msg = `↩️ On flyfrontier.com but not #Q_SEARCH (${location.pathname || ""}${location.hash || ""})`;
            ffsLog(msg, { reason, href: location.href });
            ffsUpdate(() => {}, msg);
            await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: "not_q_search" });
            return;
          }

          // #Q_SEARCH
          // Keep the Frontier form "From" field visually synced to the modal Origin (source of truth).
          // This prevents the page from sitting on LAX while our UI says e.g. DEN.
          try {
            const ui = ffsNormalizeAirport(ffsIataFromAny(ffsReadUiOriginOnce()) || ffsRead().startOrigin || "LAX") || "LAX";
            if (/^[A-Z]{3}$/.test(ui)) {
              const fromEl = document.querySelector("#origin");
              if (fromEl) {
                const curCode = ffsIataFromAny(fromEl.value) || ffsNormalizeAirport(fromEl.value || "");
                if (curCode !== ui) {
                  ffsLog("🧭 Syncing Frontier #origin to UI origin", { from: curCode || null, to: ui });
                  fromEl.focus?.();
                  fromEl.value = ui;
                  ffsDispatchInputEvents(fromEl);
                }
              }
            }
          } catch {}

          if (searchingJob) {
            const ageSec = ffsJobAgeSeconds(searchingJob);
            const retries = Number(searchingJob.retries || 0);
            const step = String(searchingJob.step || "");
            const route = `${searchingJob.origin || "?"}→${searchingJob.destination || "?"}`;

            const waitMsg = `⏳ Waiting: ${route} (step=${step || "?"}, age=${ageSec}s, retries=${retries})`;
            ffsLog(waitMsg);
            ffsUpdate(() => {}, waitMsg);

            // If we're still on #Q_SEARCH a while after clicking search, retry a couple times.
            if (ageSec >= 10 && retries < 2) {
              await ffsRetrySubmitExistingJobOnQSearch(searchingJob, retries + 1);
              return;
            }

            // Still stuck? Mark it no_price so we can advance to the next destination.
            if (ageSec >= 8) {
              ffsLog("🧹 Searching job looks stale on #Q_SEARCH; marking complete ($0) so we can continue.", {
                jobId: searchingJob.id,
                route,
                step,
                ageSec,
                retries,
              });
              ffsPatchJob(searchingJob.id, {
                status: "complete",
                step: "stale_timeout",
                result: "$0",
                resultRaw: "",
                resultValue: 0,
                hasGoWildPrice: false,
                capturedAt: ffsNow(),
                stale: true,
              });
              ffsUpdate(() => {}, `🧹 Stale job → complete ($0): ${route}`);
              await ffsPadStep({ label: "After stale job", ms: 1000 });
              return;
            }

            return; // keep waiting
          }

          if (!ffs.running) {
            ffsLog("Runner paused/stopped; not submitting new job.", { reason });
            return;
          }

          ffsLog("Tick on #Q_SEARCH → submit next job", { reason });
          await ffsSubmitSearchOnQSearch();
          return;
        }

        // Any other domain → bounce back to Frontier search page.
        const msg = `🌐 Not on flyfrontier/booking.* (${location.hostname}); returning to #Q_SEARCH…`;
        ffsLog(msg, { href: location.href });
        ffsUpdate(() => {}, msg);
        await ffsRedirectWithCountdown(FFS_FRONTIER_SEARCH_URL, { seconds: 3, reason: "wrong_domain" });
      } catch (e) {
        ffsErr("AutoTick failed", e);
      } finally {
        __ffsTickInFlight = false;
      }
    }

    function ffsStartRun({ startOrigin = "LAX" } = {}) {
      const now = ffsNow();
      const cur = ffsRead();

      // Use the modal/UI-provided startOrigin as the source of truth (no coupling to Google Flights state).
      const origin = ffsNormalizeAirport(ffsIataFromAny(startOrigin) || startOrigin) || ffsNormalizeAirport(cur.startOrigin || "LAX") || "LAX";


      const jobs = Array.isArray(cur.jobs) ? cur.jobs : [];
      const hasJobs = jobs.length > 0;

      const curStart = ffsNormalizeAirport(cur.startOrigin || "LAX") || "LAX";
      const originChanged = origin !== curStart;

      // Detect stale plan when origin changed after a previous run:
      // phase>0 but we haven't even created a single hop-1 job from the (new) origin.
      const curPlan = cur.plan && typeof cur.plan === "object" ? ffsClone(cur.plan) : null;
      const curPhase = Number(curPlan?.phase || 0);
      const hasHop1FromOrigin = jobs.some(
        (j) => j && Number(j.hop || 0) === 1 && ffsNormalizeAirport(j.origin) === origin
      );
      const planLooksStale = curPhase > 0 && !hasHop1FromOrigin;

      // Restart semantics (requested): DO NOT delete existing items.
      // If there's no plan yet (or it's empty), seed it.
      // If the origin changed OR the plan looks stale, reset to phase=0 with the new origin (but KEEP jobs).
      let nextPlan = curPlan;
      if (!nextPlan || !Array.isArray(nextPlan.origins) || !nextPlan.origins.length) {
        nextPlan = {
          phase: 0,
          origins: [origin],
          originIdx: 0,
          destIdx: 0,
          phaseStartedAt: now,
          phaseCompletedAt: 0,
        };
      } else if (originChanged || planLooksStale) {
        const keepDestIdx = Number(nextPlan.destIdx || 0);
        nextPlan = {
          phase: 0,
          origins: [origin],
          originIdx: 0,
          destIdx: 0,
          phaseStartedAt: now,
          phaseCompletedAt: 0,
        };
      } else {
        // Same-origin resume: keep where we left off.
        // Still pin phase0 seed origin to the chosen origin (safe + avoids UI drift).
        if (Number(nextPlan.phase || 0) === 0) {
          nextPlan.origins = [origin];
          nextPlan.originIdx = 0;
        }
      }

      ffsLog("▶️ Start/Resume Frontier Flight Search", {
        origin,
        curStart,
        originChanged,
        hasJobs,
        planLooksStale,
        plan: {
          phase: nextPlan.phase,
          origins: nextPlan.origins,
          originIdx: nextPlan.originIdx,
          destIdx: nextPlan.destIdx,
        },
      });

      try {
        ffsDumpState("start_run_before");
      } catch {}

      ffsWrite({
        ...cur,
        running: true,
        autoShowModal: true,
        runId: cur.runId || now,
        startedAt: cur.startedAt || now,
        stoppedAt: 0,
        lastError: "",
        startOrigin: origin,
        plan: nextPlan,
        // keep jobs (no deletions)
        jobs,
        // if origin changed or plan was stale, clear any "found path" banner so it's not misleading
        foundPaths: originChanged || planLooksStale ? [] : Array.isArray(cur.foundPaths) ? cur.foundPaths : [],
        lastTickInfo: `start_or_resume (${origin})${planLooksStale ? " (reset stale plan)" : ""}`,
        lastTickAt: now,
        resumedAt: now, // extra meta ok
      });

      __ffsRedirectScheduled = false;
      ffsEnsureModalOpen({ reason: "start_run" });
      ffsStartModalKeepAlive();
      ffsStartRunnerLoop();
      setTimeout(() => ffsAutoTick("start_run"), 350);
    }


  function ffsStopRun(reason = "manual_stop") {
      ffsLog("⏸️ Stopping Frontier Flight Search", { reason });
      const ffs = ffsRead();
      ffsWrite({
        ...ffs,
        running: false,
        stoppedAt: ffsNow(),
        lastTickInfo: reason,
      });

      // stop the modal keep-alive loop
      try {
        if (__ffsModalKeepAliveIv) {
          clearInterval(__ffsModalKeepAliveIv);
          __ffsModalKeepAliveIv = null;
        }
      } catch {}

      // stop runner loop
      try {
        ffsStopRunnerLoop();
      } catch {}
    }

    function ffsRenderLocalStorageSnapshot(container) {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.sort();
        container.textContent = "";

        const table = document.createElement("table");
        table.style.cssText =
          "width:100%;border-collapse:collapse;font-size:12px;background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden";

        const thead = document.createElement("thead");
        thead.innerHTML =
          '<tr style="text-align:left;background:#111827;color:#93c5fd">' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Key</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Value (preview)</th>' +
          "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        for (const k of keys) {
          let v = "";
          try {
            v = localStorage.getItem(k);
          } catch {}
          const preview = String(v || "");
          const tr = document.createElement("tr");
          tr.style.cssText = "border-bottom:1px solid rgba(255,255,255,.06)";
          const tdK = document.createElement("td");
          tdK.textContent = k;
          tdK.style.cssText = "padding:8px;vertical-align:top;color:#cbd5e1;font-weight:800";
          const tdV = document.createElement("td");
          tdV.textContent = preview.length > 180 ? preview.slice(0, 180) + "…" : preview;
          tdV.title = preview;
          tdV.style.cssText = "padding:8px;vertical-align:top;color:#94a3b8;word-break:break-all";
          tr.appendChild(tdK);
          tr.appendChild(tdV);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        container.appendChild(table);
      } catch (e) {
        ffsLog("render localStorage snapshot error", e);
      }
    }

    function ffsRenderJobsTable(container, ffsState) {
      try {
        const ffs = ffsState || ffsRead();
        const jobs = Array.isArray(ffs.jobs) ? ffs.jobs.slice() : [];
        jobs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
        container.textContent = "";

        const table = document.createElement("table");
        table.style.cssText =
          "width:100%;border-collapse:collapse;font-size:12px;background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden";

        const thead = document.createElement("thead");
        thead.innerHTML =
          '<tr style="text-align:left;background:#111827;color:#93c5fd">' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">#</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Route</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Hop</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Status</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Step</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">Date</th>' +
          '<th style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08)">GoWild</th>' +
          "</tr>";
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        let i = 0;
        for (const j of jobs) {
          i += 1;
          const st = String(j.status || "").toLowerCase();
          const value =
            typeof j.resultValue === "number" && Number.isFinite(j.resultValue) ? Number(j.resultValue) : ffsParsePriceValue(j.result);
          const hasGW = j.hasGoWildPrice === true || value > 0;

          const color =
            st === "complete"
              ? hasGW
                ? "#22c55e"
                : "#fcd34d"
              : st === "searching"
                ? "#f59e0b"
                : st === "error"
                  ? "#fca5a5"
                  : "#94a3b8";

          const tr = document.createElement("tr");
          tr.style.cssText = "border-bottom:1px solid rgba(255,255,255,.06)";

          const tdN = document.createElement("td");
          tdN.textContent = String(i);
          tdN.style.cssText = "padding:8px;color:#94a3b8;font-weight:800;white-space:nowrap";

          const tdR = document.createElement("td");
          tdR.textContent = `${ffsNormalizeAirport(j.origin)} → ${ffsNormalizeAirport(j.destination)}`;
          tdR.style.cssText = "padding:8px;color:#e2e8f0;font-weight:900;white-space:nowrap";

          const tdHop = document.createElement("td");
          tdHop.textContent = String(j.hop || "");
          tdHop.style.cssText = "padding:8px;color:#cbd5e1;font-weight:800;white-space:nowrap";

          const tdS = document.createElement("td");
          tdS.textContent = String(j.status || "");
          tdS.style.cssText = `padding:8px;color:${color};font-weight:900;white-space:nowrap`;

          const tdStep = document.createElement("td");
          tdStep.textContent = String(j.step || "");
          tdStep.style.cssText = "padding:8px;color:#cbd5e1;font-weight:700;white-space:nowrap";

          const tdD = document.createElement("td");
          tdD.textContent = String(j.departureDateText || "");
          tdD.style.cssText = "padding:8px;color:#94a3b8;font-weight:700;white-space:nowrap";

          const tdP = document.createElement("td");
          tdP.textContent = String(j.result || "");
          tdP.style.cssText = "padding:8px;color:#e2e8f0;font-weight:900;white-space:nowrap";

          tr.append(tdN, tdR, tdHop, tdS, tdStep, tdD, tdP);
          tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        container.appendChild(table);

        if (!jobs.length) {
          const empty = document.createElement("div");
          empty.textContent = "No jobs yet.";
          empty.style.cssText = "margin-top:6px;color:#94a3b8;font-size:12px;font-weight:700";
          container.appendChild(empty);
        }
      } catch (e) {
        ffsLog("render jobs table error", e);
      }
    }


    // ------------------------------ Export Helpers ------------------------------
    function ffsCsvEscape(v) {
      const s = v == null ? "" : String(v);
      if (/["\n\r,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    function ffsDownloadTextFile({ filename, text, mime = "text/plain" } = {}) {
      try {
        const blob = new Blob([String(text || "")], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = String(filename || __qcoreMakeScrapeFilename("unknown", "txt"));
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch {}
          try {
            a.remove();
          } catch {}
        }, 1000);
      } catch (e) {
        console.error("[FFS] download file failed", e);
      }
    }

    function ffsExportResultsCsv() {
      const ffs = ffsRead();
      const jobs = Array.isArray(ffs.jobs) ? ffs.jobs.slice() : [];
      jobs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

      const cols = [
        "id",
        "status",
        "step",
        "phase",
        "hop",
        "origin",
        "destination",
        "departureDateText",
        "departureDateUnix",
        "result",
        "resultValue",
        "hasGoWildPrice",
        "retries",
        "stale",
        "createdAt",
        "updatedAt",
        "capturedAt",
        "pageUrlAtSubmit",
        "pageUrlAtCapture",
      ];

      const lines = [];
      lines.push(cols.join(","));
      for (const j of jobs) {
        const row = cols.map((k) => ffsCsvEscape(j && j[k] != null ? j[k] : ""));
        lines.push(row.join(","));
      }
      const csv = lines.join("\n");

      const filename = __qcoreMakeScrapeFilename("frontier", "csv");

      ffsLog("⬇️ Exporting Results CSV", { filename, rows: jobs.length });
      ffsUpdate(() => {}, `⬇️ Exporting CSV (${jobs.length} rows)…`);
      ffsDownloadTextFile({ filename, text: csv, mime: "text/csv" });
      ffsUpdate(() => {}, `✅ Exported CSV: ${filename}`);
    }

  function showFrontierFlightSearchModal({ reason = "manual" } = {}) {
      // If already open, don't create a duplicate
      try {
        if (__ffsModalEl && document.body.contains(__ffsModalEl)) return;
      } catch {}

      ffsLog("Opening Frontier Flight Search modal…", { reason, href: location.href });

      // BUGFIX (Frontier): showModal was never defined in this file; use QCoreModalBase.
      const _showModal = window?.QCoreModalBase?.showModal;
      if (typeof _showModal !== "function") {
        try {
          console.error("[FFS] QCoreModalBase.showModal not available — cannot open Frontier modal");
        } catch {}
        return;
      }

      window.QCoreModalBase.showModal("Frontier Flight Search", (modal) => {
        __ffsModalEl = modal;
        modal.style.whiteSpace = "normal";

        const header = document.createElement("div");
        header.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:10px";
        modal.appendChild(header);

        const title = document.createElement("div");
        title.textContent = "Frontier Flight Search — GoWild Graph Runner";
        title.style.cssText = "font-weight:900;color:#93c5fd";
        header.appendChild(title);

        const page = document.createElement("div");
        page.style.cssText = "color:#94a3b8;font-size:12px;font-weight:700;word-break:break-all";
        header.appendChild(page);

        const status = document.createElement("div");
        status.style.cssText = "color:#e2e8f0;font-weight:900;white-space:pre-wrap";
        header.appendChild(status);

        // Origin selector (requested) — defaults to LAX, autocomplete via datalist
        const originRow = document.createElement("div");
        originRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px";
        header.appendChild(originRow);

        const originLbl = document.createElement("div");
        originLbl.textContent = "Origin:";
        originLbl.style.cssText = "color:#94a3b8;font-size:12px;font-weight:900";
        originRow.appendChild(originLbl);

        const originInput = document.createElement("input");
        originInput.type = "text";
        originInput.placeholder = "LAX";
        originInput.autocomplete = "off";
        originInput.value = ffsNormalizeAirport(ffsRead().startOrigin || "LAX") || "LAX";

        // Mark + remember this input so the runner can read it as the canonical Origin source.
        originInput.id = "qcore-ffs-origin-input";
        originInput.dataset.qcoreFfsOriginInput = "1";
        __ffsOriginInputEl = originInput;
        __ffsOriginInputLast = ffsNormalizeAirport(originInput.value || "") || __ffsOriginInputLast || "";
        __ffsOriginInputLastAt = ffsNow();
        originInput.setAttribute("list", "qcore-ffs-origin-airports");
        originInput.style.cssText =
          "padding:8px 10px;border-radius:10px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-weight:900;min-width:120px;letter-spacing:.4px;text-transform:uppercase";
        originRow.appendChild(originInput);

        const originHelp = document.createElement("div");
        originHelp.textContent = "(used as start origin)";
        originHelp.style.cssText = "color:#64748b;font-size:12px;font-weight:800";
        originRow.appendChild(originHelp);

        // datalist for airports
        const originDl = document.createElement("datalist");
        originDl.id = "qcore-ffs-origin-airports";
        for (const code of FFS_AIRPORTS) {
          const opt = document.createElement("option");
          opt.value = code;
          originDl.appendChild(opt);
        }
        modal.appendChild(originDl);

        originInput.addEventListener("input", () => {
          try {
            const iata = ffsIataFromAny(originInput.value) || ffsNormalizeAirport(originInput.value);
            const newOrigin = ffsNormalizeAirport(iata);

            // Cache so the runner can read it from anywhere
            __ffsOriginInputEl = originInput;
            __ffsOriginInputLast = newOrigin || __ffsOriginInputLast || "";
            __ffsOriginInputLastAt = ffsNow();

            // Only act once we have a full 3-letter airport code
            if (!newOrigin || !/^[A-Z]{3}$/.test(newOrigin)) return;

            // Persist chosen origin to shared state.
            // IMPORTANT: If the origin changes, we reset the plan to phase=0 so we don't keep using a stale planOrigin
            // (e.g., getting stuck on AUS when the UI says DEN). We do NOT delete jobs.
            ffsUpdate(
              (s) => {
                const prev = ffsNormalizeAirport(s.startOrigin || "LAX") || "LAX";
                s.startOrigin = newOrigin;

                const plan = s.plan && typeof s.plan === "object" ? s.plan : {};
                const keepDestIdx = Number(plan.destIdx || 0);

                if (prev !== newOrigin) {
                  s.plan = {
                    phase: 0,
                    origins: [newOrigin],
                    originIdx: 0,
                    destIdx: 0,
                    phaseStartedAt: ffsNow(),
                    phaseCompletedAt: 0,
                  };
                  // Clear found paths when the root origin changes (avoid showing old LAX paths)
                  s.foundPaths = [];
                  s.lastOriginChangeAt = ffsNow();
                  s.lastOriginChangeFrom = prev;
                  s.lastOriginChangeTo = newOrigin;
                } else {
                  // If same origin, keep phase0 pinned to it.
                  if (Number(plan.phase || 0) === 0) {
                    plan.origins = [newOrigin];
                    plan.originIdx = 0;
                    s.plan = plan;
                  }
                }
              },
              `🛫 Origin set: ${newOrigin}`
            );

            // Immediately override Frontier's #origin input (if we're on #Q_SEARCH) so the page UI reflects the modal.
            try {
              if (ffsIsFrontierDomain() && ffsIsQSearch()) {
                const frontierOriginEl = document.querySelector("#origin");
                if (frontierOriginEl) {
                  const curCode = ffsIataFromAny(frontierOriginEl.value) || ffsNormalizeAirport(frontierOriginEl.value || "");
                  if (curCode !== newOrigin) {
                    ffsLog("🧭 UI origin changed → overriding Frontier form origin", { from: curCode || null, to: newOrigin });
                    frontierOriginEl.focus?.();
                    frontierOriginEl.value = newOrigin;
                    ffsDispatchInputEvents(frontierOriginEl);
                  }
                }
              }
            } catch {}
          } catch (e) {
            ffsErr("origin input handler failed", e);
          }
        });


        const controls = document.createElement("div");
        controls.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 12px";
        modal.appendChild(controls);

        const mkBtn = (txt, bg) => {
          const b = document.createElement("button");
          b.textContent = txt;
          b.style.cssText =
            `padding:8px 10px;border-radius:8px;background:${bg || "#334155"};color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:900;cursor:pointer`;
          return b;
        };

        const startBtn = mkBtn("Start / Resume", "#0ea5e9");
        startBtn.style.color = "#071019";
        startBtn.onclick = async () => {
          // Double-check Origin from the modal input (read → wait 1s → read again).
          // This prevents any stale/autofill weirdness and guarantees the modal input is the source of truth.
          flashEmoji(startBtn, "🟢");

          const origin = await ffsReadUiOriginStable({ delayMs: 1000, context: "start_btn" });

          try {
            originInput.value = origin;
          } catch {}

          ffsLog("🛫 Start/Resume clicked — using UI Origin", { origin });
          ffsUpdate(() => {}, `🛫 Start/Resume → Origin: ${origin}`);

          ffsStartRun({ startOrigin: origin });
        };
  controls.appendChild(startBtn);

        const stopBtn = mkBtn("Stop", "#7f1d1d");
        stopBtn.onclick = () => {
          ffsStopRun("manual_stop");
          flashEmoji(stopBtn, "🟢");
        };
        controls.appendChild(stopBtn);

        const tickBtn = mkBtn("Tick Now", "#1f2937");
        tickBtn.onclick = () => {
          flashEmoji(tickBtn, "🟡");
          __ffsRedirectScheduled = false;
          ffsAutoTick("manual_tick");
        };
        controls.appendChild(tickBtn);

        const goBtn = mkBtn("Go to #Q_SEARCH");
        goBtn.onclick = () => {
          flashEmoji(goBtn, "🟢");
          try {
            window.location.href = FFS_FRONTIER_SEARCH_URL;
          } catch {}
        };
        controls.appendChild(goBtn);

        const clearBtn = mkBtn("Clear Jobs", "#7c3aed");
        clearBtn.onclick = () => {
          ffsClearJobs();
          flashEmoji(clearBtn, "🟢");
        };
        controls.appendChild(clearBtn);

        const exportBtn = mkBtn("Export Results", "#16a34a");
        exportBtn.style.color = "#071019";
        exportBtn.onclick = () => {
          try {
            flashEmoji(exportBtn, "🟢");
            ffsExportResultsCsv();
          } catch (e) {
            console.error("[FFS] Export Results failed", e);
            flashEmoji(exportBtn, "🔴");
          }
        };
        controls.appendChild(exportBtn);


        const foundBox = document.createElement("div");
        foundBox.style.cssText =
          "margin:8px 0 12px;padding:10px;border:1px solid rgba(255,255,255,.08);background:#0f172a;border-radius:10px;color:#e2e8f0;font-weight:800";
        modal.appendChild(foundBox);

        const planBox = document.createElement("div");
        planBox.style.cssText =
          "margin:8px 0 12px;padding:10px;border:1px solid rgba(255,255,255,.08);background:#0f172a;border-radius:10px;color:#cbd5e1;font-weight:700";
        modal.appendChild(planBox);

        const jobsHeader = document.createElement("div");
        jobsHeader.textContent = "Jobs";
        jobsHeader.style.cssText = "font-weight:900;color:#e2e8f0;margin-top:6px";
        modal.appendChild(jobsHeader);

        const jobsBox = document.createElement("div");
        jobsBox.style.cssText = "margin-top:6px;max-height:75vh;overflow-y:auto;padding-right:2px";
        modal.appendChild(jobsBox);

        const lsHeader = document.createElement("div");
        lsHeader.textContent = "localStorage (this domain)";
        lsHeader.style.cssText = "font-weight:900;color:#e2e8f0;margin-top:14px";
        modal.appendChild(lsHeader);

        const lsBox = document.createElement("div");
        lsBox.style.cssText = "margin-top:6px";
        modal.appendChild(lsBox);

        function render() {
          const ffs = ffsRead();
          const jobs = Array.isArray(ffs.jobs) ? ffs.jobs : [];
          const searching = jobs.filter((j) => String(j.status).toLowerCase() === "searching").length;
          const complete = jobs.filter((j) => String(j.status).toLowerCase() === "complete").length;
          const zeroPrice = jobs.filter((j) => {
            const st = String(j.status).toLowerCase();
            if (st !== "complete") return false;
            const v = typeof j.resultValue === "number" && Number.isFinite(j.resultValue) ? Number(j.resultValue) : ffsParsePriceValue(j.result);
            return !(v > 0);
          }).length;
          const error = jobs.filter((j) => String(j.status).toLowerCase() === "error").length;

          page.textContent = `Page: ${location.hostname}${location.pathname}${location.hash || ""}`;
                  const ageSec = ffs.lastTickAt ? Math.max(0, Math.round((ffsNow() - Number(ffs.lastTickAt || 0)) / 1000)) : null;
          const lastLine = ffs.lastTickInfo
            ? `\nLast: ${ffs.lastTickInfo}${ageSec != null ? ` (${ageSec}s ago)` : ""}`
            : "";
          // UI vs State vs Plan origin — helpful when debugging "why is it using AUS?"
          const uiOriginNow = ffsNormalizeAirport(originInput?.value || "") || "(unset)";
          const planNow = ffs.plan || {};
          const planOriginsNow = Array.isArray(planNow.origins) ? planNow.origins.map(ffsNormalizeAirport) : [];
          const planOriginNow = planOriginsNow[Math.max(0, Number(planNow.originIdx || 0))] || "";

          status.textContent =
            `Run: ${ffs.running ? "🟢 running" : "⚪ stopped"}  •  origin(UI)=${uiOriginNow}  •  startOrigin(state)=${ffs.startOrigin || "LAX"}  •  planOrigin=${planOriginNow || "(none)"}  •  jobs=${jobs.length}  searching=${searching}  complete=${complete}  zero=$0:${zeroPrice}  error=${error}` +
            lastLine;

          const fp = Array.isArray(ffs.foundPaths) && ffs.foundPaths.length ? ffs.foundPaths[0] : null;
          if (fp && fp.airports && fp.airports.length) {
            const p = fp.airports.join(" → ");
            foundBox.textContent = `🎯 Found path: ${p}`;
          } else {
            foundBox.textContent = "No 3-hop path found yet.";
          }

          const plan = ffs.plan || {};
          const phase = Number(plan.phase || 0);
          const origins = Array.isArray(plan.origins) ? plan.origins : [];
          planBox.textContent = `Plan: phase=${phase} (hop ${phase + 1}/${ffs.maxHops})  •  origins=${origins.length}  •  originIdx=${plan.originIdx}  •  destIdx=${plan.destIdx}  •  lastTick=${ffs.lastTickInfo || ""}`;

          ffsRenderJobsTable(jobsBox, ffs);
          ffsRenderLocalStorageSnapshot(lsBox);
        }

        render();


      }); // end showModal callback
  } // end showFrontierFlightSearchModal

    function ffsEnsureModalOpen({ reason = "ensure" } = {}) {
      const ffs = ffsRead();
      if (ffs.autoShowModal === false) return;
      try {
        if (__ffsModalEl && document.body.contains(__ffsModalEl)) return;
      } catch {}
      showFrontierFlightSearchModal({ reason });
    }

    function ffsStartModalKeepAlive() {
      if (__ffsModalKeepAliveIv) return;
      __ffsModalKeepAliveIv = setInterval(() => {
        try {
          const ffs = ffsRead();
          const hasSearching = !!ffsFindSearchingJob(ffs.jobs);
          if (!(ffs.running || hasSearching)) {
            clearInterval(__ffsModalKeepAliveIv);
            __ffsModalKeepAliveIv = null;
            return;
          }
          if (ffs.autoShowModal === false) return;
          // If user closes the modal while the runner is active, re-open it.
          if (!__ffsModalEl || !document.body.contains(__ffsModalEl)) {
            showFrontierFlightSearchModal({ reason: "keep_alive" });
          }
        } catch {}
      }, 1200);
    }










    function ffsLog(...args) {
      try {
        console.log("[FFS]", ...args);
      } catch {}
    }


      function __efsGetRootStateSafe() {



      const s = window?.QCoreContent?.getState();
      return s && typeof s === "object" ? s : {};
    }
    const EFS_DEFAULTS = {
      running: false,
      paused: false,
      startedAt: 0,
      stoppedAt: 0,
      stage: "idle",
      cooldownUntil: 0,
      lastStep: "",
      lastError: "",
      currentPage: 1,
      maxPages: 380,
      pagesProcessed: 0,
      linksFound: 0,
      dupesSkipped: 0,
      newLinksLastPage: 0,
      lastPageUrl: "",
      didAutoExport: false,
      runId: 0,

      // NEW: small diagnostics
      lastHttpStatus: 0,
      lastFetchMs: 0,
      lastTotalHits: 0,
      lastUniqueCount: 0,
      consecutiveErrors: 0,
    };



    // ------------------------------ Frontier Flight Search State (BUGFIX) ------------------------------
    // The runner relies on a shared QCore state slice: root.frontier.
    // A missing/undefined ensure function caused the modal contentBuilder to throw:
    //   ReferenceError: ffsEnsureFfsState is not defined
    //
    // We define:
    //   - FFS_DEFAULTS: canonical default state shape
    //   - ffsEnsureFfsState(root): normalizes + repairs the slice (and recovers from localStorage when possible)

    const FFS_DEFAULTS = {
      v: 1,
      running: false,
      autoShowModal: true,

      runId: 0,
      startedAt: 0,
      resumedAt: 0,
      stoppedAt: 0,

      lastTickInfo: "",
      lastTickAt: 0,
      lastError: "",

      startOrigin: "LAX",
      maxHops: 3,

      plan: {
        phase: 0,
        origins: ["LAX"],
        originIdx: 0,
        destIdx: 0,
        phaseStartedAt: 0,
        phaseCompletedAt: 0,
      },

      jobs: [],
      foundPaths: [],

      // optional diagnostics/migration fields (kept if present)
      lastOriginChangeAt: 0,
      lastOriginChangeFrom: "",
      lastOriginChangeTo: "",
    };

    function ffsEnsureFfsState(root) {
      const r = root && typeof root === "object" ? root : {};
      let cur = r.frontier;

      // Migration: legacy slice -> new slice
      try {
        if ((!cur || typeof cur !== "object") && r[__FFS_LEGACY_SLICE] && typeof r[__FFS_LEGACY_SLICE] === "object") {
          cur = r[__FFS_LEGACY_SLICE];
        }
      } catch {}

      // Recover from localStorage if the shared state slice is missing (common after state compaction).
      try {
        if (!cur || typeof cur !== "object") {
          const ls = ffsReadLS();
          if (ls && typeof ls === "object") cur = ls;
        }
      } catch {}

      cur = cur && typeof cur === "object" ? cur : {};

      // Merge top-level defaults
      const merged = { ...FFS_DEFAULTS, ...cur };

      // Merge nested plan defaults
      const curPlan = cur.plan && typeof cur.plan === "object" ? cur.plan : {};
      merged.plan = { ...FFS_DEFAULTS.plan, ...curPlan };

      // Normalize common primitives
      merged.running = !!merged.running;
      merged.autoShowModal = merged.autoShowModal !== false;

      const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

      merged.runId = n0(merged.runId);
      merged.startedAt = n0(merged.startedAt);
      merged.resumedAt = n0(merged.resumedAt);
      merged.stoppedAt = n0(merged.stoppedAt);
      merged.lastTickAt = n0(merged.lastTickAt);

      merged.lastTickInfo = typeof merged.lastTickInfo === "string" ? merged.lastTickInfo : "";
      merged.lastError = typeof merged.lastError === "string" ? merged.lastError : "";

      // startOrigin must always be an IATA-ish code (best effort)
      try {
        merged.startOrigin = ffsNormalizeAirport(ffsIataFromAny(merged.startOrigin) || merged.startOrigin) || "LAX";
      } catch {
        merged.startOrigin = "LAX";
      }

      // maxHops
      try {
        const mh = Math.round(Number(merged.maxHops));
        merged.maxHops = Number.isFinite(mh) && mh > 0 ? mh : FFS_DEFAULTS.maxHops;
      } catch {
        merged.maxHops = FFS_DEFAULTS.maxHops;
      }

      // Plan normalization
      try {
        merged.plan.phase = Math.max(0, Math.round(Number(merged.plan.phase || 0)));
      } catch {
        merged.plan.phase = 0;
      }
      try {
        merged.plan.originIdx = Math.max(0, Math.round(Number(merged.plan.originIdx || 0)));
      } catch {
        merged.plan.originIdx = 0;
      }
      try {
        merged.plan.destIdx = Math.max(0, Math.round(Number(merged.plan.destIdx || 0)));
      } catch {
        merged.plan.destIdx = 0;
      }
      merged.plan.phaseStartedAt = n0(merged.plan.phaseStartedAt);
      merged.plan.phaseCompletedAt = n0(merged.plan.phaseCompletedAt);

      // Plan origins should be a non-empty array
      try {
        let origins = Array.isArray(merged.plan.origins) ? merged.plan.origins : [];
        origins = origins
          .map((c) => ffsNormalizeAirport(ffsIataFromAny(c) || c))
          .filter((c) => !!c);
        if (!origins.length) origins = [merged.startOrigin || "LAX"];
        merged.plan.origins = origins;
      } catch {
        merged.plan.origins = [merged.startOrigin || "LAX"];
      }

      // Arrays
      merged.jobs = Array.isArray(merged.jobs) ? merged.jobs : [];
      merged.foundPaths = Array.isArray(merged.foundPaths) ? merged.foundPaths : [];

      // Write back normalized slice so subsequent calls see a valid structure
      r.frontier = merged;
      // Cleanup legacy slice to avoid drift/confusion
      try { if (r[__FFS_LEGACY_SLICE]) delete r[__FFS_LEGACY_SLICE]; } catch {}
      return merged;
    }


    function ffsRead() {
      const root = ffsGetRootStateSafe();
      const ffs = ffsEnsureFfsState(root);
      return ffsClone(ffs);
    }

    function ffsWrite(nextFfs) {
      const root = ffsGetRootStateSafe();
      root.frontier = {
        ...ffsEnsureFfsState(root),
        ...(nextFfs && typeof nextFfs === "object" ? nextFfs : {}),
      };
      // Re-normalize
      ffsEnsureFfsState(root);
      window?.QCoreContent?.setState(root);
      try { ffsWriteLS(root.frontier); } catch {}
      try { ffsDumpState("write"); } catch {}
      return ffsClone(root.frontier);
    }

    function ffsUpdate(mutator, info) {
      const root = ffsGetRootStateSafe();
      const ffs = ffsEnsureFfsState(root);
      const next = ffsClone(ffs);
      try {
        mutator(next);
      } catch (e) {
        ffsLog("ffsUpdate mutator error", e);
        next.lastError = e?.message || String(e);
      }
      if (info) next.lastTickInfo = String(info);
      next.lastTickAt = ffsNow();
      root.frontier = next;
      ffsEnsureFfsState(root);
      window?.QCoreContent?.setState(root);
      try { ffsWriteLS(root.frontier); } catch {}
      try { ffsDumpState("update", info || ""); } catch {}

      return ffsClone(root.frontier);
    }

    function ffsJobs() {
      return ffsRead().jobs || [];
    }

    function ffsFindSearchingJob(jobs) {
      const list = Array.isArray(jobs) ? jobs : ffsJobs();
      // only allow one; pick most recent searching
      const searching = list.filter((j) => j && String(j.status).toLowerCase() === "searching");
      if (!searching.length) return null;
      searching.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      return searching[0] || null;
    }

    function ffsGetJobById(id, jobs) {
      const list = Array.isArray(jobs) ? jobs : ffsJobs();
      return list.find((j) => j && j.id === id) || null;
    }

    function ffsHasJobFor({ origin, destination, departureDateUnix }) {
      const o = ffsNormalizeAirport(origin);
      const d = ffsNormalizeAirport(destination);
      const t = Number(departureDateUnix || 0);
      return ffsJobs().some((j) =>
        j && ffsNormalizeAirport(j.origin) === o && ffsNormalizeAirport(j.destination) === d && Number(j.departureDateUnix || 0) === t
      );
    }

    function ffsUpsertJob(job) {
      if (!job || !job.id) return null;
      const id = String(job.id);
      const now = ffsNow();

      return ffsUpdate(
        (ffs) => {
          const jobs = Array.isArray(ffs.jobs) ? ffs.jobs.slice() : [];
          const idx = jobs.findIndex((j) => j && j.id === id);
          const merged = { ...(idx >= 0 ? jobs[idx] : {}), ...job, id, updatedAt: now };
          if (!merged.createdAt) merged.createdAt = now;
          if (idx >= 0) jobs[idx] = merged;
          else jobs.push(merged);
          // keep stable order by createdAt asc
          jobs.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
          ffs.jobs = jobs;
        },
        `upsert:${id}`
      );
    }

    function ffsPatchJob(id, patch) {
      const jobId = String(id || "");
      if (!jobId) return null;
      const now = ffsNow();

      const stepOrStatus =
        patch && (patch.step || patch.status) ? String(patch.step || patch.status) : "";
      const info = stepOrStatus ? `job:${jobId} ${stepOrStatus}` : `job:${jobId} patched`;

      return ffsUpdate(
        (ffs) => {
          const jobs = Array.isArray(ffs.jobs) ? ffs.jobs.slice() : [];
          const idx = jobs.findIndex((j) => j && j.id === jobId);
          if (idx < 0) return;
          jobs[idx] = { ...(jobs[idx] || {}), ...(patch || {}), id: jobId, updatedAt: now };
          ffs.jobs = jobs;
        },
        info
      );
    }

    function ffsClearJobs() {
      // HARD RESET: blank the frontier slice so "Clear Jobs" truly clears everything.
      try { ffsLog("🧹 Clear Jobs: blanking frontier state"); } catch {}

      // Stop runner loops
      try { ffsStopRunnerLoop(); } catch {}
      try {
        if (__ffsModalKeepAliveIv) {
          clearInterval(__ffsModalKeepAliveIv);
          __ffsModalKeepAliveIv = null;
        }
      } catch {}
      try { __ffsRedirectScheduled = false; } catch {}
      try { __ffsTickInFlight = false; } catch {}

      // Blank shared QCore state slice (and legacy slice, if present)
      try {
        const root = ffsGetRootStateSafe();
        root.frontier = {};
        try { root[__FFS_LEGACY_SLICE] = {}; } catch {}
        window?.QCoreContent?.setState(root);
      } catch (e) {
        try { ffsErr("Clear Jobs failed", e); } catch {}
      }

      // Blank localStorage mirrors (new + legacy)
      try { localStorage.removeItem(__FFS_LS_KEY); } catch {}
      try { localStorage.removeItem(__FFS_LS_KEY_OLD); } catch {}
    }



   (function () {
    const fire = (el, type) =>
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1,
      })
    );
      // NOTE: Do not early-return here. Even if ToolsModal already exists,
      // we still need the global Press & Hold gate so other automations can pause/resume safely.

      // ------------------------------ Press & Hold Auto-Runner ------------------------------
      // Watches for a [aria-label="Press & Hold"] container and performs a 30s press+hold.
      // Exposes a small global "gate" state so other automations (Frontier, Reddit, etc.) can PAUSE while this is active.
      const CHECK_INTERVAL_MS = 1000;
      const HOLD_DURATION_MS = 30_000;
      const PRESS_HOLD_COOLDOWN_MS = 5_000;

      // Shared gate state lives on globalThis so any module can read it safely.
      try {
        if (typeof globalThis.__qcorePressHoldActive !== "boolean") globalThis.__qcorePressHoldActive = false;
        if (!Number.isFinite(Number(globalThis.__qcorePressHoldStartedAt))) globalThis.__qcorePressHoldStartedAt = 0;
        if (!Number.isFinite(Number(globalThis.__qcorePressHoldEndsAt))) globalThis.__qcorePressHoldEndsAt = 0;
        if (!Number.isFinite(Number(globalThis.__qcorePressHoldLastRunAt))) globalThis.__qcorePressHoldLastRunAt = 0;
      } catch {}

      globalThis.__qcoreMaybeStartPressHold = function __qcoreMaybeStartPressHold(source = "unknown") {
        try {
          const container = document.querySelector('[aria-label="Press & Hold"]');
          if (!container) return false;

          const p = container.querySelector("p");
          if (!p) return false;

          const now = Date.now();

          // If already running, keep reporting "present" so other logic can pause.
          if (globalThis.__qcorePressHoldActive) return true;

          // Small cooldown so we don't spam multiple holds if the element is sticky.
          if (now - Number(globalThis.__qcorePressHoldLastRunAt || 0) < PRESS_HOLD_COOLDOWN_MS) return true;

          globalThis.__qcorePressHoldActive = true;
          globalThis.__qcorePressHoldLastRunAt = now;
          globalThis.__qcorePressHoldStartedAt = now;
          globalThis.__qcorePressHoldEndsAt = now + HOLD_DURATION_MS;

          try {
            console.log("✋🧱🛑 PRESS & HOLD DETECTED — pausing automations for ~30s", {
              source,
              now,
              endsAt: globalThis.__qcorePressHoldEndsAt,
            });
          } catch {}

          // press & hold
          try { fire(p, "mousedown"); } catch {}

          setTimeout(() => {
            try {
              fire(p, "mouseup");
              console.log("✅✋ Press & Hold mouseup fired");
            } catch {}
          }, HOLD_DURATION_MS);

          // Mark gate done slightly after mouseup
          setTimeout(() => {
            try {
              globalThis.__qcorePressHoldActive = false;
              globalThis.__qcorePressHoldEndsAt = 0;
              console.log("▶️✨ Press & Hold done — automations may resume");
            } catch {}
          }, HOLD_DURATION_MS + 300);

          return true;
        } catch {
          return false;
        }
      };

      // Watcher: handle the gate even if no tool explicitly calls __qcoreMaybeStartPressHold()
      try {
        if (!globalThis.__qcorePressHoldWatcherIv) {
          globalThis.__qcorePressHoldWatcherIv = setInterval(() => {
            try {
              globalThis.__qcoreMaybeStartPressHold?.("watcher");
            } catch {}
          }, CHECK_INTERVAL_MS);
        }
      } catch {}
    })();



    function ffsGetRootStateSafe() {
      const s = window?.QCoreContent?.getState();
      const root = (s && typeof s === "object") ? s : {};

      // If the shared state is missing our tool slice (can happen after compaction), recover from localStorage.
      try {
        if (!root.frontier || typeof root.frontier !== "object") {
          const ls = ffsReadLS();
          if (ls && typeof ls === "object") root.frontier = ls;
        }
      } catch {}

      return root;
    }



    function ffsNormalizeAirport(code) {
      return String(code || "").trim().toUpperCase();
    }







  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "frontier",
      title: "Frontier Flight Search",
      icon: "✈️",
      description: "Frontier press-&-hold flight search automation.",
      order: 110,
      onClick: () => { try { showFrontierFlightSearchModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { ffsAutoBoot(); } catch (e) { /* noop */ } },
    });
    try { QQ.showFrontierFlightSearchModal = showFrontierFlightSearchModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
