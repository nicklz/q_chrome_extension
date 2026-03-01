(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });
  const __qcoreMakeJsonDownloadModal = Q.makeJsonDownloadModal || (() => ({ show:()=>{}, setStatus:()=>{}, setJsonValue:()=>{}, download:()=>{} }));

  // ------------------------------ EPSTEIN FILES HELPER (Justice.gov scraper) ------------------------------
    // Adds a “Epstein Files Helper” tool button.
    //
    // UPDATE (AJAX MODE):
    //   - Keep the black + red modal UI, but DELETE the old DOM automation (typing into #searchInput,
    //     clicking #searchButton, and paging with “Next”).
    //   - Instead, we directly fetch the Justice.gov multimedia-search JSON endpoint:
    //       https://www.justice.gov/multimedia-search?keys=no%20images%20produced&page=N
    //     for N = 1..380 (default), at ~2 pages / second (requested: half the waits).
    //   - We collect PDF URLs from: hits.hits[*]._source.ORIGIN_FILE_URI
    //   - We normalize URLs (https + encode spaces -> %20, so “DataSet 8/” becomes “DataSet%208/”).
    //   - We persist deduped results into shared state: state.files[].
    //   - Export JSON works the same as before.

    const EFS_QUERY = "no images produced";
    const EFS_PAGE_DELAY_MS = 500;       // requested: halve waits (was 1000ms)
    const EFS_ERROR_RETRY_DELAY_MS = 1500; // requested: halve waits (was 3000ms)
    const EFS_RUNNER_LOOP_INTERVAL_MS = 300; // requested: halve waits (was 600ms)
    const EFS_RENDER_INTERVAL_MS = 125;      // requested: halve waits (was 250ms)
    const EFS_FAILSAFE_DELAY_MS = 250;       // requested: halve waits (was 500ms)
    const EFS_FETCH_TIMEOUT_MS = 20000;  // per-page timeout (ms)
    const EFS_STOP_AFTER_ERRORS = 8;     // safety: stop after N consecutive fetch failures

    function __efsBuildSearchUrl(page) {
      const p = Math.max(1, Math.floor(Number(page || 1)));
      const keys = encodeURIComponent(String(EFS_QUERY || ""));
      // NOTE: Justice.gov expects 0-based or 1-based depending on implementation. Your examples use 1..380.
      return `https://www.justice.gov/multimedia-search?keys=${keys}&page=${p}`;
    }

    function __efsNormalizePdfUrl(url) {
      try {
        let u = String(url || "").trim();
        if (!u) return "";
        // Force https
        u = u.replace(/^http:\/\//i, "https://");
        // Encode whitespace (DataSet 8 -> DataSet%208)
        u = u.replace(/\s/g, "%20");
        // Best-effort URI encoding without mangling already-encoded sequences
        try {
          u = encodeURI(u);
        } catch {}
        const lower = u.toLowerCase();

        // Only keep PDFs (the dataset items are PDFs)
        if (!lower.endsWith(".pdf")) return "";

        // Only keep Epstein files folder (matches your target URLs)
        if (!lower.startsWith("https://www.justice.gov/epstein/files/")) return "";

        return u;
      } catch {
        return "";
      }
    }

    async function __efsFetchJsonPage(page, { timeoutMs = EFS_FETCH_TIMEOUT_MS } = {}) {
      const url = __efsBuildSearchUrl(page);
      const started = Date.now();

      const ctl = new AbortController();
      const to = setTimeout(() => {
        try { ctl.abort(); } catch {}
      }, Math.max(0, Number(timeoutMs || 0)));

      let resp = null;
      let json = null;

      try {
        resp = await fetch(url, {
          method: "GET",
          cache: "no-store",
          redirect: "follow",
          signal: ctl.signal,
          // Some sites behave better when you ask for JSON explicitly.
          headers: {
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        // Parse JSON
        json = await resp.json();
      } finally {
        clearTimeout(to);
      }

      const ms = Math.max(0, Date.now() - started);
      return { url, page: Number(page || 1), resp, json, ms };
    }

    function __efsExtractPdfUrlsFromJson(json) {
      try {
        const hits = json?.hits?.hits;
        if (!Array.isArray(hits)) return [];
        const out = [];
        for (const h of hits) {
          const raw = h?._source?.ORIGIN_FILE_URI || "";
          const u = __efsNormalizePdfUrl(raw);
          if (u) out.push(u);
        }
        return out;
      } catch {
        return [];
      }
    }


    let __efsUI = null;
    let __efsTickInFlight = false;
    let __efsRunnerLoopIv = null;
    let __efsRenderIv = null;

    const __efsUiLogRing = [];

    // Keep event counters so the UI layout stays the same (but we no longer install the DOM event logger).
    let __efsEventCounts = {};

    function __efsNow() {
      return Date.now();
    }

    function __efsClone(obj) {
      try {
        return JSON.parse(JSON.stringify(obj));
      } catch {
        return obj;
      }
    }

    function __efsSummarizeArgs(args) {
      try {
        return args
          .map((a) => {
            if (typeof a === "string") return a;
            if (a == null) return String(a);
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220);
      } catch {
        return "";
      }
    }

    function __efsUiLog(line) {
      const msg = String(line || "").trim();
      if (!msg) return;
      __efsUiLogRing.push({ t: __efsNow(), msg });
      if (__efsUiLogRing.length > 8) __efsUiLogRing.splice(0, __efsUiLogRing.length - 8);
      try {
        __efsRenderModal();
      } catch {}
    }

    function efsLog(...args) {
      console.log("[EFS]", ...args);
      __efsUiLog(__efsSummarizeArgs(args));
    }

    function efsWarn(...args) {
      console.warn("[EFS]", ...args);
      __efsUiLog("⚠️ " + __efsSummarizeArgs(args));
    }

    function efsErr(...args) {
      console.error("[EFS]", ...args);
      __efsUiLog("🧨 " + __efsSummarizeArgs(args));
    }




    function efsRead() {
      const root = __efsGetRootStateSafe();
      const efs = __efsEnsureRootState(root);
      return __efsClone(efs);
    }

    function efsWrite(nextPartial) {
      const root = __efsGetRootStateSafe();
      const cur = __efsEnsureRootState(root);
      root.epsteinFilesHelper = { ...cur, ...(nextPartial && typeof nextPartial === "object" ? nextPartial : {}) };
      __efsEnsureRootState(root);
      window?.QCoreContent?.setState(root);
      return __efsClone(root.epsteinFilesHelper);
    }

    function efsUpdate(mutator, stepLabel) {
      const root = __efsGetRootStateSafe();
      const cur = __efsEnsureRootState(root);
      const next = __efsClone(cur);
      try {
        mutator(next, root);
      } catch (e) {
        next.lastError = e?.message || String(e);
      }
      if (typeof stepLabel === "string" && stepLabel) next.lastStep = stepLabel;
      root.epsteinFilesHelper = next;
      __efsEnsureRootState(root);
      window?.QCoreContent?.setState(root);
      try {
        __efsRenderModal();
      } catch {}
      return __efsClone(root.epsteinFilesHelper);
    }

    function __efsMakeEpsteinFilesModal() {
      const overlay = document.createElement("div");
      overlay.setAttribute("data-qcore-efs-overlay", "1");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "background:rgba(0,0,0,0.82)",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:16px",
      ].join(";");

      const card = document.createElement("div");
      card.style.cssText = [
        "width:min(1100px, 96vw)",
        "max-height:92vh",
        "overflow:hidden",
        "background:#050a10",
        "color:#fecaca",
        "border:2px solid #ef4444",
        "border-radius:14px",
        "box-shadow:0 10px 50px rgba(0,0,0,.75)",
        "padding:14px",
        "font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial",
        "display:flex",
        "flex-direction:column",
        "gap:10px",
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;";

      const titleBox = document.createElement("div");
      const title = document.createElement("div");
      title.textContent = "🟥 Epstein Files Helper";
      title.style.cssText = "font-size:18px;font-weight:900;letter-spacing:0.4px;color:#fee2e2;";

      const subtitle = document.createElement("div");
      subtitle.textContent = "Scrapes justice.gov /epstein/ files/DataSet links via direct AJAX JSON paging.";
      subtitle.style.cssText = "font-size:12px;opacity:0.85;margin-top:2px;";

      titleBox.appendChild(title);
      titleBox.appendChild(subtitle);

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;";

      const mkMiniBtn = (label) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText = [
          "background:#0b0f14",
          "color:#fecaca",
          "border:2px solid #ef4444",
          "border-radius:10px",
          "padding:8px 10px",
          "font-weight:800",
          "cursor:pointer",
        ].join(";");
        b.onmouseenter = () => (b.style.filter = "brightness(1.15)");
        b.onmouseleave = () => (b.style.filter = "none");
        return b;
      };

      const pauseBtn = mkMiniBtn("⏸ Pause");
      const exportBtn = mkMiniBtn("💾 Export JSON");
      const closeBtn = mkMiniBtn("✖ Close");

      btnRow.appendChild(pauseBtn);
      btnRow.appendChild(exportBtn);
      btnRow.appendChild(closeBtn);

      header.appendChild(titleBox);
      header.appendChild(btnRow);

      // Status line
      const statusLine = document.createElement("div");
      statusLine.style.cssText = "background:#0b0f14;border:1px solid #7f1d1d;border-radius:10px;padding:8px 10px;font-size:12px;";
      statusLine.textContent = "Status: idle";

      // Progress bar
      const progressWrap = document.createElement("div");
      progressWrap.style.cssText = "background:#0b0f14;border:1px solid #7f1d1d;border-radius:10px;padding:10px;";

      const statsLine = document.createElement("div");
      statsLine.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;font-size:12px;opacity:0.92;margin-bottom:8px;";

      const progressOuter = document.createElement("div");
      progressOuter.style.cssText = "height:12px;background:#111827;border-radius:999px;overflow:hidden;border:1px solid #7f1d1d;";

      const progressInner = document.createElement("div");
      progressInner.style.cssText = "height:100%;width:0%;background:#ef4444;border-radius:999px;transition:width 150ms linear;";

      progressOuter.appendChild(progressInner);
      progressWrap.appendChild(statsLine);
      progressWrap.appendChild(progressOuter);

      // Log tail
      const logTail = document.createElement("div");
      logTail.style.cssText = "background:#0b0f14;border:1px solid #7f1d1d;border-radius:10px;padding:10px;font-size:12px;line-height:1.35;max-height:90px;overflow:auto;white-space:pre-wrap;";
      logTail.textContent = "(console tail)";

      // Output textarea
      const ta = document.createElement("textarea");
      ta.placeholder = "Collected URLs will appear here…";
      ta.spellcheck = false;
      ta.style.cssText = [
        "width:100%",
        "height:42vh",
        "resize:vertical",
        "background:#020409",
        "color:#e5e7eb",
        "border:2px solid #ef4444",
        "border-radius:12px",
        "padding:12px",
        "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New'",
        "font-size:12px",
        "line-height:1.35",
        "overflow:auto",
      ].join(";");

      // Footer hint
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:12px;opacity:0.85;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;";
      hint.innerHTML = `<span>State: <code style="color:#fecaca">state.filesPage</code> (resume) • <code style="color:#fecaca">state.files[]</code> (deduped)</span><span style="opacity:0.8">Tip: Export works at any time.</span>`;

      card.appendChild(header);
      card.appendChild(statusLine);
      card.appendChild(progressWrap);
      card.appendChild(logTail);
      card.appendChild(ta);
      card.appendChild(hint);

      overlay.appendChild(card);

      function close() {
        try {
          overlay.remove();
        } catch {}
      }

      return {
        overlay,
        card,
        pauseBtn,
        exportBtn,
        closeBtn,
        statusLine,
        statsLine,
        progressInner,
        logTail,
        ta,
        close,
      };
    }

    function __efsRenderModal() {
      if (!__efsUI) return;
      if (!document.body.contains(__efsUI.overlay)) return;

      const root = __efsGetRootStateSafe();
      const efs = __efsEnsureRootState(root);

      const files = Array.isArray(root.files) ? root.files : [];

      const filesPage = __efsClamp(Number(root.filesPage || efs.currentPage || 1), 1, efs.maxPages);

      const pages = __efsClamp(efs.pagesProcessed, 0, efs.maxPages);
      const pct = efs.maxPages ? Math.round((pages / efs.maxPages) * 1000) / 10 : 0;

      const now = __efsNow();
      const coolMs = Math.max(0, (efs.cooldownUntil || 0) - now);
      const coolS = coolMs ? Math.round((coolMs / 1000) * 10) / 10 : 0;

      const stage = efs.stage || "idle";
      const stagePretty = stage.replace(/^do_/, "").replace(/_/g, " ");

      const statusBits = [];
      statusBits.push(`Status: ${efs.running ? (efs.paused ? "PAUSED" : "RUNNING") : "STOPPED"}`);
      statusBits.push(`Stage: ${stagePretty}`);
      if (coolS) statusBits.push(`wait: ${coolS}s`);
      if (efs.lastError) statusBits.push(`err: ${efs.lastError.slice(0, 160)}`);
      if (efs.lastStep && !coolS) statusBits.push(`• ${efs.lastStep}`);

      __efsUI.statusLine.textContent = statusBits.join("  ");

      const evTotal = Object.values(__efsEventCounts || {}).reduce((a, b) => a + b, 0);
      const parts = [
        `Page: ${filesPage}/${efs.maxPages}`,
        `Processed: ${efs.pagesProcessed}`,
        `URLs: ${files.length}`,
        `New: ${efs.newLinksLastPage}`,
        `Dupes: ${efs.dupesSkipped}`,
        `HTTP: ${efs.lastHttpStatus || 0}`,
        `ms: ${efs.lastFetchMs || 0}`,
        `Events: ${evTotal}`,
      ];

      // If Justice.gov is returning a stable total, show it (helps validate completeness).
      if (efs.lastUniqueCount || efs.lastTotalHits) {
        parts.push(`unique_count: ${efs.lastUniqueCount || 0}`);
      }

      __efsUI.statsLine.textContent = parts.join("   |   ");
      __efsUI.progressInner.style.width = `${pct}%`;

      // Log tail (last few)
      if (__efsUiLogRing.length) {
        __efsUI.logTail.textContent = __efsUiLogRing.map((x) => x.msg).join("\n");
      } else {
        __efsUI.logTail.textContent = "(console tail)";
      }

      // Append newly discovered URLs (cheap incremental render)
      if (typeof __efsUI._lastFilesCount !== "number") {
        __efsUI._lastFilesCount = 0;
        __efsUI.ta.value = files.join("\n");
        __efsUI._lastFilesCount = files.length;
        __efsUI.ta.scrollTop = __efsUI.ta.scrollHeight;
      } else if (files.length > __efsUI._lastFilesCount) {
        const add = files.slice(__efsUI._lastFilesCount);
        __efsUI.ta.value += ( __efsUI.ta.value && !__efsUI.ta.value.endsWith("\n") ? "\n" : "" ) + add.join("\n");
        __efsUI._lastFilesCount = files.length;
        __efsUI.ta.scrollTop = __efsUI.ta.scrollHeight;
      }

      // Pause button label
      __efsUI.pauseBtn.textContent = efs.paused ? "▶ Resume" : "⏸ Pause";
    }

    function showEpsteinFilesHelperModal({ reason = "manual" } = {}) {
      try {
        if (__efsUI && document.body.contains(__efsUI.overlay)) {
          __efsRenderModal();
          return __efsUI;
        }

        __efsUI = __efsMakeEpsteinFilesModal();
        document.body.appendChild(__efsUI.overlay);

        __efsUI.pauseBtn.onclick = () => {
          const efs = efsRead();
          if (!efs.running) return;
          const nextPaused = !efs.paused;
          efsWrite({ paused: nextPaused, lastStep: nextPaused ? "paused" : "resumed" });
          efsLog(nextPaused ? "Paused" : "Resumed");
          __efsRenderModal();
        };

        __efsUI.exportBtn.onclick = () => {
          try {
            efsExportJson({ reason: "manual_export" });
            flashEmoji(__efsUI.exportBtn, "💾");
          } catch (e) {
            efsErr("Export failed", e);
            flashEmoji(__efsUI.exportBtn, "🔴");
          }
        };

        __efsUI.closeBtn.onclick = () => {
          try {
            efsStopRun({ reason: "close_btn" });
          } catch {}
          try {
            __efsUI.close();
          } catch {}
          __efsUI = null;
        };

        // Clicking the dim overlay closes too (but keeps a red-themed vibe)
        __efsUI.overlay.addEventListener("click", (e) => {
          if (e.target === __efsUI.overlay) {
            try {
              efsStopRun({ reason: "overlay_click" });
            } catch {}
            try {
              __efsUI.close();
            } catch {}
            __efsUI = null;
          }
        });

        // Render heartbeat (for countdown + incremental UI)
        if (__efsRenderIv) clearInterval(__efsRenderIv);
        __efsRenderIv = setInterval(() => {
          try {
            __efsRenderModal();
          } catch {}
        }, EFS_RENDER_INTERVAL_MS);

        // Initial fill
        __efsUiLog(`opened modal (${reason})`);
        __efsRenderModal();

        return __efsUI;
      } catch (e) {
        console.error("[EFS] show modal failed", e);
        return null;
      }
    }

    function efsExportJson({ reason = "export" } = {}) {
      const root = __efsGetRootStateSafe();
      const efs = __efsEnsureRootState(root);
      const files = Array.isArray(root.files) ? root.files : [];

      const payload = {
        exportedAt: new Date().toISOString(),
        reason,
        query: EFS_QUERY,
        pageUrl: location.href,
        currentPage: efs.currentPage,
        pagesProcessed: efs.pagesProcessed,
        maxPages: efs.maxPages,
        totalUrls: files.length,
        files,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const name = __qcoreMakeScrapeFilename("epstein", "json");

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => {
        try {
          URL.revokeObjectURL(a.href);
        } catch {}
      }, 1500);

      efsLog(`Exported ${files.length} URLs => ${name}`);
      efsWrite({ lastStep: `exported (${files.length})` });
    }

    function __efsEnsureRunnerLoop() {
      if (__efsRunnerLoopIv) return;
      __efsRunnerLoopIv = setInterval(() => {
        try {
          // efsAutoTick is async; we intentionally don't await inside the interval.
          efsAutoTick("runner_loop");
        } catch {}
      }, EFS_RUNNER_LOOP_INTERVAL_MS);
    }

    function __efsStopRunnerLoop() {
      if (__efsRunnerLoopIv) {
        clearInterval(__efsRunnerLoopIv);
        __efsRunnerLoopIv = null;
      }
    }

    function efsStartRun({ maxPages = 380 } = {}) {
      showEpsteinFilesHelperModal({ reason: "start" });

      const root = __efsGetRootStateSafe();
      const prev = __efsEnsureRootState(root);

      const resolvedMaxPages = Math.max(1, Math.floor(Number(maxPages || prev.maxPages || 380)));

      // Resume pointer (requested): always start from state.filesPage
      const resumePage = __efsClamp(
        Math.floor(Number(root.filesPage || prev.currentPage || 1)),
        1,
        resolvedMaxPages
      );

      // Persist resume pointer immediately so even a hard restart resumes correctly.
      root.filesPage = resumePage;

      const now = __efsNow();

      const prior =
        root.epsteinFilesHelper && typeof root.epsteinFilesHelper === "object" ? root.epsteinFilesHelper : prev;

      // If we already have progress (files collected, pages processed, etc.), keep counters instead of resetting.
      const hasProgress =
        (Array.isArray(root.files) && root.files.length > 0) ||
        Number(prior.pagesProcessed || 0) > 0 ||
        Number(prior.linksFound || 0) > 0 ||
        resumePage > 1;

      const pagesProcessedFloor = Math.max(0, Math.min(resumePage - 1, resolvedMaxPages));
      const existingPagesProcessed = Math.max(0, Math.floor(Number(prior.pagesProcessed || 0)));

      root.epsteinFilesHelper = {
        ...EFS_DEFAULTS,
        ...(hasProgress ? prior : {}),

        running: true,
        paused: false,
        startedAt: hasProgress && Number(prior.startedAt || 0) ? Number(prior.startedAt) : now,
        stoppedAt: 0,
        stage: "do_fetch_page",
        cooldownUntil: 0,

        currentPage: resumePage,
        maxPages: resolvedMaxPages,

        pagesProcessed: hasProgress ? Math.max(existingPagesProcessed, pagesProcessedFloor) : 0,
        linksFound: Array.isArray(root.files) ? root.files.length : 0,
        newLinksLastPage: 0,
        lastPageUrl: hasProgress ? String(prior.lastPageUrl || "") : "",

        lastStep: hasProgress
          ? `resuming from state.filesPage=${resumePage} (AJAX)…`
          : "starting (AJAX)…",
        lastError: "",
        didAutoExport: false,

        // Keep runId stable for a resume; otherwise start a new one.
        runId: hasProgress && Number(prior.runId || 0) ? Number(prior.runId) : now,

        // Reset per-page diagnostics for a clean restart
        lastHttpStatus: 0,
        lastFetchMs: 0,
        consecutiveErrors: 0,
      };

      window?.QCoreContent?.setState(root);

      efsLog(hasProgress ? "Resumed run (AJAX)" : "Started run (AJAX)", {
        maxPages: root.epsteinFilesHelper.maxPages,
        startPage: root.epsteinFilesHelper.currentPage,
        stateFilesPage: root.filesPage,
        existingUrls: Array.isArray(root.files) ? root.files.length : 0,
      });

      __efsEnsureRunnerLoop();
      __efsRenderModal();

      // Kick immediately (requested: faster)
      setTimeout(() => {
        try { efsAutoTick("start"); } catch {}
      }, 25);

      return efsRead();
    }

    function efsStopRun({ reason = "stop" } = {}) {
      const now = __efsNow();
      efsUpdate((efs) => {
        efs.running = false;
        efs.paused = false;
        efs.stoppedAt = now;
        efs.stage = "stopped";
        efs.cooldownUntil = 0;
        efs.lastStep = `stopped (${reason})`;
      }, `stopped (${reason})`);

      __efsStopRunnerLoop();
      efsLog("Stopped", reason);
    }


    async function efsAutoTick(reason = "tick") {
      if (__efsTickInFlight) return;

      const efs0 = efsRead();
      if (!efs0.running) return;
      if (efs0.paused) return;

      const now = __efsNow();
      if (efs0.cooldownUntil && now < efs0.cooldownUntil) {
        // Just render (countdown)
        __efsRenderModal();
        return;
      }

      __efsTickInFlight = true;
      try {
        showEpsteinFilesHelperModal({ reason: "tick" });

        const efs = efsRead();
        if (!efs.running || efs.paused) return;

        const stage = efs.stage || "idle";

        if (stage === "do_fetch_page" || stage === "idle") {
          const page = Math.max(1, Math.floor(Number(efs.currentPage || 1)));
          const maxPages = Math.max(1, Math.floor(Number(efs.maxPages || 380)));

          // Done?
          if (page > maxPages) {
            efsUpdate((s, root) => {
              s.stage = "done";
              s.running = false;
              s.paused = false;
              s.stoppedAt = __efsNow();
              s.cooldownUntil = 0;
              root.filesPage = maxPages;
              s.lastStep = `done (reached ${maxPages} pages)`;
            }, "done");

            efsLog("Done: reached max pages", maxPages);

            // Auto-export (kept)
            try {
              const efs2 = efsRead();
              if (!efs2.didAutoExport) {
                efsWrite({ didAutoExport: true });
                efsExportJson({ reason: "auto_export_done" });
              }
            } catch {}

            __efsStopRunnerLoop();
            return;
          }

          // Mark state as "fetching"
          efsUpdate((s) => {
            s.stage = "do_fetch_page";
            s.lastError = "";
            s.lastStep = `fetching page ${page}/${maxPages} (${reason})`;
          }, `fetch page ${page}`);

          let payload = null;
          try {
            payload = await __efsFetchJsonPage(page, { timeoutMs: EFS_FETCH_TIMEOUT_MS });
          } catch (e) {
            const msg = e?.message || String(e);

            efsErr("Fetch failed", { page, msg });

            // Update error + retry
            efsUpdate((s) => {
              s.lastError = msg;
              s.consecutiveErrors = Math.max(0, Number(s.consecutiveErrors || 0)) + 1;
              s.lastStep = `fetch failed page ${page} (retry in ${Math.round(EFS_ERROR_RETRY_DELAY_MS / 100) / 10}s)`;
              s.cooldownUntil = __efsNow() + EFS_ERROR_RETRY_DELAY_MS;
              s.lastHttpStatus = 0;
              s.lastFetchMs = 0;
            }, `fetch error page ${page}`);

            const cur = efsRead();
            if (Number(cur.consecutiveErrors || 0) >= EFS_STOP_AFTER_ERRORS) {
              efsErr("Too many consecutive errors; stopping.", { consecutiveErrors: cur.consecutiveErrors });
              efsStopRun({ reason: "too_many_errors" });

              try {
                const efs2 = efsRead();
                if (!efs2.didAutoExport) {
                  efsWrite({ didAutoExport: true });
                  efsExportJson({ reason: "auto_export_error_stop" });
                }
              } catch {}
            }

            return;
          }

          const json = payload?.json || {};
          const urls = __efsExtractPdfUrlsFromJson(json);

          const totalHits = Number(json?.hits?.total?.value || 0);
          const uniqueCount = Number(json?.aggregations?.unique_count?.value || 0);

          efsUpdate((s, root) => {
            const files = Array.isArray(root.files) ? root.files : [];
            const set = new Set(files);

            let newCount = 0;
            let dupes = 0;

            for (const u of urls) {
              if (!u) continue;
              if (set.has(u)) {
                dupes++;
                continue;
              }
              set.add(u);
              files.push(u);
              newCount++;
            }

            root.files = files;

            s.pagesProcessed = Math.max(s.pagesProcessed || 0, page);
            s.linksFound = files.length;
            s.newLinksLastPage = newCount;
            s.dupesSkipped = (s.dupesSkipped || 0) + dupes;
            s.lastPageUrl = payload.url || "";
            s.lastHttpStatus = payload?.resp?.status || 0;
            s.lastFetchMs = payload?.ms || 0;
            s.lastTotalHits = totalHits || s.lastTotalHits || 0;
            s.lastUniqueCount = uniqueCount || s.lastUniqueCount || 0;
            s.consecutiveErrors = 0;

            s.lastStep = `page ${page} scanned: +${newCount} (total ${files.length})`;

            // Next page
            s.currentPage = page + 1;

            // Advance shared resume pointer (state.filesPage) as we move to the next page
            root.filesPage = __efsClamp(page + 1, 1, maxPages);

            // pacing
            s.cooldownUntil = __efsNow() + EFS_PAGE_DELAY_MS;
            s.stage = "do_fetch_page";
          }, `scanned page ${page}`);

          efsLog(`Scanned page ${page}`, { found: urls.length, totalUrls: efsRead().linksFound, http: payload?.resp?.status, ms: payload?.ms });

          return;
        }

        if (stage === "done" || stage === "stopped") {
          __efsStopRunnerLoop();
          return;
        }

        // Unknown stage: fail-safe → reset back to fetch loop
        efsWarn("Unknown stage; resetting to do_fetch_page", stage);
        efsUpdate((s) => {
          s.stage = "do_fetch_page";
          s.cooldownUntil = __efsNow() + EFS_FAILSAFE_DELAY_MS;
          s.lastError = "";
          s.lastStep = `reset stage (was ${stage})`;
        }, "reset stage");
      } catch (e) {
        efsErr("efsAutoTick failed", e);
      } finally {
        __efsTickInFlight = false;
      }
    }

  function efsAutoBoot() {
      const root = __efsGetRootStateSafe();
      const efs = __efsEnsureRootState(root);
      if (!efs.running) return;

      // If we navigated/reloaded, always resume from state.filesPage (requested)
      const resumePage = __efsClamp(Number(root.filesPage || efs.currentPage || 1), 1, efs.maxPages);
      if (resumePage !== efs.currentPage) {
        root.epsteinFilesHelper.currentPage = resumePage;
        window?.QCoreContent?.setState(root);
      }

      // Re-open modal + restart loop
      showEpsteinFilesHelperModal({ reason: "autoboot" });
      __efsEnsureRunnerLoop();

      efsLog("Auto-booted runner", { stage: efs.stage, page: resumePage, stateFilesPage: root.filesPage });
    }
  function __efsEnsureRootState(root) {
      const r = root && typeof root === "object" ? root : {};

      // Shared store for scraped URLs
      if (!Array.isArray(r.files)) r.files = [];

      const cur =
        r.epsteinFilesHelper && typeof r.epsteinFilesHelper === "object" ? r.epsteinFilesHelper : {};

      // Shared resume pointer (requested)
      // - state.filesPage starts at 1
      // - we advance it as we move through pages
      // - on restart, we resume from state.filesPage
      const curPageHint = Math.max(1, Math.floor(Number(cur.currentPage || 1)));
      if (!Number.isFinite(Number(r.filesPage)) || Number(r.filesPage) < 1) {
        r.filesPage = curPageHint;
      }
      r.filesPage = Math.max(1, Math.floor(Number(r.filesPage || 1)));
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

      const next = { ...EFS_DEFAULTS, ...cur };

      next.running = !!next.running;
      next.paused = !!next.paused;
      next.startedAt = Number(next.startedAt || 0);
      next.stoppedAt = Number(next.stoppedAt || 0);
      next.cooldownUntil = Number(next.cooldownUntil || 0);
      next.currentPage = Math.max(1, Math.floor(Number(next.currentPage || 1)));
      next.maxPages = Math.max(1, Math.floor(Number(next.maxPages || 380)));

      function __efsClamp(n, min, max) {
        const x = Number(n);
        if (!Number.isFinite(x)) return min;
        return Math.max(min, Math.min(max, x));
      }

      // Keep shared resume pointer in-bounds (never > maxPages)
      r.filesPage = __efsClamp(r.filesPage, 1, next.maxPages);

      next.pagesProcessed = Math.max(0, Math.floor(Number(next.pagesProcessed || 0)));
      next.linksFound = Math.max(0, Math.floor(Number(next.linksFound || 0)));
      next.dupesSkipped = Math.max(0, Math.floor(Number(next.dupesSkipped || 0)));
      next.newLinksLastPage = Math.max(0, Math.floor(Number(next.newLinksLastPage || 0)));
      next.didAutoExport = !!next.didAutoExport;
      next.runId = Number(next.runId || 0);
      next.stage = typeof next.stage === "string" ? next.stage : "idle";
      next.lastStep = typeof next.lastStep === "string" ? next.lastStep : "";
      next.lastError = typeof next.lastError === "string" ? next.lastError : "";
      next.lastPageUrl = typeof next.lastPageUrl === "string" ? next.lastPageUrl : "";

      // Diagnostics
      next.lastHttpStatus = Math.max(0, Math.floor(Number(next.lastHttpStatus || 0)));
      next.lastFetchMs = Math.max(0, Math.floor(Number(next.lastFetchMs || 0)));
      next.lastTotalHits = Math.max(0, Math.floor(Number(next.lastTotalHits || 0)));
      next.lastUniqueCount = Math.max(0, Math.floor(Number(next.lastUniqueCount || 0)));
      next.consecutiveErrors = Math.max(0, Math.floor(Number(next.consecutiveErrors || 0)));

      r.epsteinFilesHelper = next;
      return next;
    }
  function __efsClamp(n, min, max) {
      const x = Number(n);
      if (!Number.isFinite(x)) return min;
      return Math.max(min, Math.min(max, x));
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "epstein",
      title: "Epstein Files Helper",
      icon: "🗂️",
      description: "Collect links and export clean JSON/CSV.",
      order: 160,
      onClick: () => { try { showEpsteinFilesHelperModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { efsAutoBoot(); } catch {} },
    });
    try { QQ.showEpsteinFilesHelperModal = showEpsteinFilesHelperModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
