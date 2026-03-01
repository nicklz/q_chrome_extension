(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const safeNowIso = Q.safeNowIso || (() => new Date().toISOString());
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));

    // ------------------------------ SUNO DOWNLOAD (More menu -> Download -> WAV Audio) ------------------------------
    // Goal:
    //   Find div[data-scroll-root="true"], then inside it process each row's “More menu contents” button:
    //     1) Click More → wait ~1s
    //     2) Find & click “Download” (move cursor over it first)
    //     3) Hold 5s; each second try clicking “WAV Audio”
    //     4) If “Download File” confirmation appears, click it (auto loop keeps clicking every 1s)
    //
    // Visual status (on the row’s More button):
    //   - Yellow: in progress
    //   - Green: confirmed download
    //   - Red: failed (after 30 checks)
    //
    // Persistence:
    //   - We store per-row status in shared QCore state (localStorage "state" + window.name mirror)
    //     under state.sunoDownload.
    //   - Green rows are skipped on later runs; Red rows are retried.



    const __sunoSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms || 0))));

    const __sunoNow = () => {
      try {
        return typeof safeNowIso === "function" ? safeNowIso() : new Date().toISOString();
      } catch {
        return new Date().toISOString();
      }
    };

    const __sunoNorm = (s) =>
      String(s == null ? "" : s)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    // ------------------------------ Suno Persistence (shared QCore state) ------------------------------
    // NOTE: previously this used `let` inside an `if` block which created block-scoped variables and
    // caused ReferenceError: __SUNO_PERSIST_V is not defined. These must be real bindings in this scope.
    const __SUNO_PERSIST_KEY = "sunoDownload";
    const __SUNO_PERSIST_V = 1;

  const __sunoPersistRead = () => {
      try {
        const root = window?.QCoreContent?.getState();
        const cur = root && typeof root === "object" ? root[__SUNO_PERSIST_KEY] : null;

        const base = {
          v: __SUNO_PERSIST_V,
          done: {}, // key -> { at, label? }
          fail: {}, // key -> { at, reason?, label? }
          updatedAt: 0,
        };

        if (!cur || typeof cur !== "object") return base;

        const next = {
          ...base,
          ...(cur && typeof cur === "object" ? cur : {}),
        };

        next.v = __SUNO_PERSIST_V;
        next.done = next.done && typeof next.done === "object" ? next.done : {};
        next.fail = next.fail && typeof next.fail === "object" ? next.fail : {};
        next.updatedAt = Number(next.updatedAt || 0);

        return next;
      } catch {
        return { v: __SUNO_PERSIST_V, done: {}, fail: {}, updatedAt: 0 };
      }
    };

    const __sunoPersistWrite = (next) => {
      try {
        const root = window?.QCoreContent?.getState();
        const r = root && typeof root === "object" ? root : {};
        r[__SUNO_PERSIST_KEY] = next;
        window?.QCoreContent?.setState(r);
      } catch {}
      return next;
    };

    const __sunoPersistReset = () => {
      const next = { v: __SUNO_PERSIST_V, done: {}, fail: {}, updatedAt: Date.now() };
      return __sunoPersistWrite(next);
    };

    const __sunoPersistMarkDone = (key, meta = {}) => {
      if (!key) return __sunoPersistRead();
      const cur = __sunoPersistRead();
      cur.done = cur.done && typeof cur.done === "object" ? cur.done : {};
      cur.fail = cur.fail && typeof cur.fail === "object" ? cur.fail : {};
      cur.done[key] = { at: Date.now(), ...(meta && typeof meta === "object" ? meta : {}) };
      try {
        if (cur.fail[key]) delete cur.fail[key];
      } catch {}
      cur.updatedAt = Date.now();
      return __sunoPersistWrite(cur);
    };

    const __sunoPersistMarkFail = (key, meta = {}) => {
      if (!key) return __sunoPersistRead();
      const cur = __sunoPersistRead();
      cur.done = cur.done && typeof cur.done === "object" ? cur.done : {};
      cur.fail = cur.fail && typeof cur.fail === "object" ? cur.fail : {};
      cur.fail[key] = { at: Date.now(), ...(meta && typeof meta === "object" ? meta : {}) };
      cur.updatedAt = Date.now();
      return __sunoPersistWrite(cur);
    };

    // ------------------------------ Suno Row Keying ------------------------------
    // We need a stable per-row identifier so we can skip "done" items across runs.
    // We hash a best-effort signature from nearby row DOM.
    const __sunoHash32 = (str) => {
      // FNV-1a 32-bit
      try {
        let h = 2166136261;
        const s = String(str || "");
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(36);
      } catch {
        return String(Math.random()).slice(2);
      }
    };

    const __sunoFindRowRoot = (btn) => {
      try {
        // Prefer a true row wrapper; avoid falling back to a generic <div> (can accidentally grab the whole list).
        return (
          btn?.closest?.('[data-testid="song-row"]') ||
          btn?.closest?.(".clip-row") ||
          btn?.closest?.('[role="row"]') ||
          btn?.closest?.("li")
        );
      } catch {
        return null;
      }
    };

    const __sunoRowKey = (btn, absIndex = 0) => {
      try {
        const row = __sunoFindRowRoot(btn);
        const parts = [];

        const push = (k, v) => {
          const val = String(v || "").trim();
          if (!val) return;
          parts.push(`${k}:${val}`);
        };

        // Row attributes / link / text are usually the most stable signals.
        if (row) {
          try {
            push("rid", row.getAttribute?.("data-id") || "");
            push("clip", row.getAttribute?.("data-clip-id") || "");
            push("song", row.getAttribute?.("data-song-id") || "");
            push("track", row.getAttribute?.("data-track-id") || "");
            push("id", row.id || "");
          } catch {}

          try {
            let href = row.querySelector?.("a[href]")?.getAttribute?.("href") || "";
            if (href && href.startsWith("/")) href = location.origin + href;
            push("href", href);
          } catch {}

          try {
            const txt = __sunoNorm((row.innerText || "").slice(0, 220));
            push("txt", txt);
          } catch {}
        }

        // Only use these React-ish ids as a LAST resort (they can change across re-renders).
        if (!parts.length) {
          try {
            push("btnid", btn?.getAttribute?.("data-button-id") || "");
          } catch {}
          try {
            push("mover", btn?.getAttribute?.("data-mouseover-id") || "");
          } catch {}
        }

        // Final fallback: index (only if we truly have nothing else).
        if (!parts.length) parts.push(`idx:${Number(absIndex || 0)}`);

        return `suno_${__sunoHash32(parts.join("|"))}`;
      } catch {
        return `suno_idx_${Number(absIndex || 0)}`;
      }
    };

    const __sunoRowLabel = (btn) => {
      try {
        const row = __sunoFindRowRoot(btn);
        if (!row) return "";
        const t = __sunoNorm((row.innerText || "").replace(/\s+/g, " ").trim());
        if (!t) return "";
        return t.slice(0, 90);
      } catch {
        return "";
      }
    };

    // ------------------------------ Suno DOM Helpers ------------------------------
    const __sunoIsVisible = (el) => {
      try {
        if (!el) return false;
        if (!el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (!r || r.width < 1 || r.height < 1) return false;
        const style = window.getComputedStyle(el);
        if (!style) return true;
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return true;
      } catch {
        return false;
      }
    };

    const __sunoText = (el) => {
      try {
        return (el?.innerText || el?.textContent || "").trim();
      } catch {
        return "";
      }
    };

    const __sunoHasDisabledCursorNotAllowed = (el) => {
      try {
        if (!el) return false;

        // Tailwind-ish disabled class you called out (colon is part of the className)
        const cls = String(el.getAttribute?.("class") || "");
        if (cls.includes("disabled:cursor-not-allowed")) return true;

        // Some builds may drop the "disabled:" prefix; still treat cursor-not-allowed as disabled-ish
        // ONLY if we also see a common disabled signal.
        const aria = String(el.getAttribute?.("aria-disabled") || "").toLowerCase();
        const isAriaDisabled = aria === "true";
        const isPropDisabled = el.disabled === true;

        if (cls.includes("cursor-not-allowed") && (isAriaDisabled || isPropDisabled)) return true;

        // If aria/prop disabled is set, respect it even if the class isn't present.
        if (isAriaDisabled || isPropDisabled) return true;

        // classList.contains works fine even with ":" in the class name, but wrap in try for safety.
        try {
          if (el.classList?.contains?.("disabled:cursor-not-allowed")) return true;
        } catch {}

        return false;
      } catch {
        return false;
      }
    };

    const __sunoSetBg = (el, color) => {
      try {
        if (!el) return;
        el.style.setProperty("background", color, "important");
        el.style.setProperty("background-color", color, "important");
        // Outline makes highlight visible even on patterned backgrounds.
        el.style.setProperty("outline", "2px solid rgba(0,0,0,0.25)", "important");
        el.style.setProperty("outline-offset", "2px", "important");
      } catch {}
    };

    const __sunoClearBg = (el) => {
      try {
        if (!el) return;
        el.style.removeProperty("background");
        el.style.removeProperty("background-color");
        el.style.removeProperty("outline");
        el.style.removeProperty("outline-offset");
      } catch {}
    };

    const __sunoDispatchMouse = (el, type) => {
      try {
        if (!el) return;
        const r = el.getBoundingClientRect?.();
        const clientX = r ? Math.floor(r.left + Math.min(10, r.width / 2)) : 1;
        const clientY = r ? Math.floor(r.top + Math.min(10, r.height / 2)) : 1;
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          })
        );
      } catch {}
    };

    const __sunoHover = (el) => {
      try {
        if (!el) return false;
        __sunoDispatchMouse(el, "mousemove");
        __sunoDispatchMouse(el, "mouseover");
        __sunoDispatchMouse(el, "mouseenter");
        __sunoDispatchMouse(el, "mousemove");
        return true;
      } catch {
        return false;
      }
    };

    const __sunoSafeClick = (el) => {
      try {
        if (!el) return false;

        // Try to bring it into view (even if virtualized).
        try {
          el.scrollIntoView?.({ block: "center", inline: "nearest" });
        } catch {}

        // Some UIs require a hover/move before click registers.
        try {
          __sunoHover(el);
        } catch {}

        // Focus can matter for menu items.
        try {
          el.focus?.({ preventScroll: true });
        } catch {}

        // Dispatch the "reliable" stack you provided (as MouseEvent to avoid pointer-capture weirdness).
        const seq = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
        for (const type of seq) {
          try {
            __sunoDispatchMouse(el, type);
          } catch {}
        }

        // Native click.
        try {
          el.click?.();
        } catch {}

        return true;
      } catch {
        return false;
      }
    };

    const __sunoPressEscape = () => {
      try {
        const down = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true });
        const up = new KeyboardEvent("keyup", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true });
        document.dispatchEvent(down);
        document.dispatchEvent(up);
      } catch {}
    };

    const __sunoWaitFor = async (fn, { timeoutMs = 2500, intervalMs = 50, mustStop } = {}) => {
      const start = Date.now();
      while (Date.now() - start <= timeoutMs) {
        try {
          if (typeof mustStop === "function") mustStop();
        } catch {}
        try {
          const v = fn();
          if (v) return v;
        } catch {}
        await __sunoSleep(intervalMs);
      }
      return null;
    };

    const __sunoFindVisibleButtonByText = (textNeedle, scope = document) => {
      const needle = __sunoNorm(textNeedle);
      const nodes = Array.from(scope.querySelectorAll("button,[role='menuitem'],[role='button']"));
      for (const el of nodes) {
        if (!__sunoIsVisible(el)) continue;
        const t = __sunoNorm(__sunoText(el));
        if (!t) continue;
        if (t === needle || t.includes(needle)) return el;
      }
      return null;
    };

    const __sunoFindDownloadItem = () => {
      // Prefer context menu items with this attribute (matches your HTML snippet).
      const candidates = Array.from(document.querySelectorAll('button[data-context-menu-trigger="true"],button,[role="menuitem"]')).filter(__sunoIsVisible);

      // 1) exact "Download"
      for (const el of candidates) {
        const t = __sunoNorm(__sunoText(el));
        if (t === "download") return el;
      }

      // 2) contains "download" but NOT "download file"
      for (const el of candidates) {
        const t = __sunoNorm(__sunoText(el));
        if (!t) continue;
        if (t.includes("download") && !t.includes("download file")) return el;
      }

      // 3) fallback: any visible button with Download in it
      return __sunoFindVisibleButtonByText("Download", document);
    };

    const __sunoFindWavItem = () => {
      // Highest confidence: aria-label="WAV Audio"
      const byAria = Array.from(document.querySelectorAll('button[aria-label="WAV Audio"],[role="menuitem"][aria-label="WAV Audio"]')).find(__sunoIsVisible);
      if (byAria) return byAria;

      // Fallback: by text
      const byText = __sunoFindVisibleButtonByText("WAV Audio", document);
      if (byText) return byText;

      // Loose fallback: "WAV" (avoid misclick if multiple WAV-related things exist)
      const candidates = Array.from(document.querySelectorAll("button,[role='menuitem'],[role='button']")).filter(__sunoIsVisible);
      for (const el of candidates) {
        const t = __sunoNorm(__sunoText(el));
        if (t === "wav audio" || t === "wav") return el;
        if (t.includes("wav") && t.includes("audio")) return el;
      }
      return null;
    };
    if (typeof __sunoFindDownloadFileBtn !== "function") {
      window.__sunoFindDownloadFileBtn = function () {
        return __sunoFindVisibleButtonByText("Download File", document);
      };
    }

    // ------------------------------ Suno Modal ------------------------------
    function __qcoreMakeSunoDownloadModal({ title = "Suno Download", subtitle = "" } = {}) {
      // If a modal already exists (from a previous run), reuse it.
      try {
        const existing = document.querySelector('[data-qcore-suno-modal="1"]');
        const existingDock = document.querySelector('[data-qcore-suno-dock="1"]');
        if (existing && existingDock) {
          // NOTE: We'll still return a "thin wrapper" so controller can reuse.
        }
      } catch {}

      const overlay = document.createElement("div");
      overlay.setAttribute("data-qcore-suno-modal", "1");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:18px;";

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(980px, calc(100vw - 36px));max-height:calc(100vh - 36px);overflow:hidden;background:#0b1117;color:#e6edf3;border:1px solid rgba(250,204,21,0.35);border-radius:14px;box-shadow:0 20px 80px rgba(0,0,0,0.55);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:14px 14px 10px 14px;border-bottom:1px solid rgba(250,204,21,0.18);";

      const left = document.createElement("div");
      left.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;";

      const h1 = document.createElement("div");
      h1.style.cssText = "font-size:16px;font-weight:900;letter-spacing:0.2px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;";
      h1.textContent = title;

      const pill = document.createElement("span");
      pill.style.cssText =
        "display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;background:rgba(250,204,21,0.14);border:1px solid rgba(250,204,21,0.22);font-size:12px;font-weight:900;";
      pill.textContent = "idle";
      h1.appendChild(pill);

      const sub = document.createElement("div");
      sub.style.cssText = "font-size:12px;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;";
      sub.textContent = subtitle || "";

      const headerLog = document.createElement("div");
      headerLog.style.cssText =
        "font-size:11px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;color:rgba(255,255,255,0.82);";
      headerLog.textContent = "";

      left.appendChild(h1);
      left.appendChild(sub);
      left.appendChild(headerLog);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;";

      const mkHeaderBtn = (label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText =
          "cursor:pointer;border-radius:10px;padding:8px 10px;font-size:12px;font-weight:900;background:rgba(250,204,21,0.12);color:#e6edf3;border:1px solid rgba(250,204,21,0.22);";
        b.onmouseenter = () => (b.style.background = "rgba(250,204,21,0.20)");
        b.onmouseleave = () => (b.style.background = "rgba(250,204,21,0.12)");
        return b;
      };

      // Requested: Start / Pause / Reset controls
      const startBtn = mkHeaderBtn("Start");
      const pauseBtn = mkHeaderBtn("Pause");
      const resetBtn = mkHeaderBtn("Reset");

      // Keep Stop + Close as well (Stop cancels; Close hides without cancel)
      const stopBtn = mkHeaderBtn("Stop");
      const closeBtn = mkHeaderBtn("Close");

      right.appendChild(startBtn);
      right.appendChild(pauseBtn);
      right.appendChild(resetBtn);
      right.appendChild(stopBtn);
      right.appendChild(closeBtn);

      header.appendChild(left);
      header.appendChild(right);

      const body = document.createElement("div");
      body.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:12px 14px 14px 14px;";

      const status = document.createElement("div");
      status.style.cssText =
        "font-size:12px;opacity:0.95;display:flex;gap:10px;align-items:center;flex-wrap:wrap;";

      const statusLeft = document.createElement("div");
      statusLeft.style.cssText = "font-weight:900;";
      statusLeft.textContent = "Ready.";

      const statusRight = document.createElement("div");
      statusRight.style.cssText = "opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;";
      statusRight.textContent = "";

      status.appendChild(statusLeft);
      status.appendChild(statusRight);

      const progWrap = document.createElement("div");
      progWrap.style.cssText =
        "width:100%;height:12px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;border:1px solid rgba(250,204,21,0.18);";

      const progBar = document.createElement("div");
      progBar.style.cssText =
        "height:100%;width:0%;background:linear-gradient(90deg, rgba(250,204,21,0.95), rgba(34,197,94,0.92));transition:width 120ms ease;";

      progWrap.appendChild(progBar);

      const counters = document.createElement("div");
      counters.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;font-size:12px;opacity:0.95;";

      const cTotal = document.createElement("span");
      const cDone = document.createElement("span");
      const cOk = document.createElement("span");
      const cFail = document.createElement("span");
      const cSkip = document.createElement("span");
      const cLast = document.createElement("span");
      for (const el of [cTotal, cDone, cOk, cFail, cSkip, cLast]) {
        el.style.cssText = "padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);";
        counters.appendChild(el);
      }

      const logBox = document.createElement("div");
      logBox.style.cssText =
        "width:100%;height:46vh;min-height:280px;max-height:62vh;overflow:auto;border-radius:12px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.10);padding:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.35;";

      body.appendChild(status);
      body.appendChild(progWrap);
      body.appendChild(counters);
      body.appendChild(logBox);

      card.appendChild(header);
      card.appendChild(body);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      // A small "dock" button (top page pill) that can re-open the modal if you hide it.
      const dock = document.createElement("button");
      dock.type = "button";
      dock.setAttribute("data-qcore-suno-dock", "1");
      dock.style.cssText =
        "position:fixed;top:12px;right:12px;z-index:2147483647;display:none;align-items:center;gap:8px;padding:10px 12px 14px 12px;border-radius:999px;background:rgba(0,0,0,0.75);color:#e6edf3;border:1px solid rgba(250,204,21,0.35);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;font-size:12px;font-weight:900;cursor:pointer;backdrop-filter: blur(6px);overflow:hidden;max-width:min(520px, calc(100vw - 24px));";
      dock.onmouseenter = () => (dock.style.background = "rgba(0,0,0,0.85)");
      dock.onmouseleave = () => (dock.style.background = "rgba(0,0,0,0.75)");

      const dockLabel = document.createElement("span");
      dockLabel.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;";
      dockLabel.textContent = String(title || "Suno Download") + " • show";
      dock.appendChild(dockLabel);

      const dockBarWrap = document.createElement("div");
      dockBarWrap.style.cssText =
        "position:absolute;left:10px;right:10px;bottom:6px;height:4px;border-radius:999px;background:rgba(255,255,255,0.14);overflow:hidden;";
      const dockBar = document.createElement("div");
      dockBar.style.cssText =
        "height:100%;width:0%;background:linear-gradient(90deg, rgba(250,204,21,0.95), rgba(34,197,94,0.92));transition:width 120ms ease;";
      dockBarWrap.appendChild(dockBar);
      dock.appendChild(dockBarWrap);

      document.body.appendChild(dock);

      const hide = () => {
        try {
          overlay.style.display = "none";
        } catch {}
        try {
          dock.style.display = "inline-flex";
        } catch {}
      };

      const show = () => {
        try {
          overlay.style.display = "flex";
        } catch {}
        try {
          dock.style.display = "none";
        } catch {}
      };

      dock.onclick = () => {
        show();
      };

      const state = {
        // runner controls
        cancelled: false,
        paused: false,
        resetRequested: false,
        running: false,
        mode: "idle",

        // counters
        total: 0,
        done: 0,
        ok: 0,
        fail: 0,
        skip: 0,
        last: "",
        _logLines: 0,
      };

      const __truncate = (s, n = 60) => {
        const t = String(s || "");
        if (t.length <= n) return t;
        return t.slice(0, Math.max(0, n - 1)) + "…";
      };

      const syncCounters = () => {
        cTotal.textContent = `Total: ${state.total}`;
        cDone.textContent = `Done: ${state.done}`;
        cOk.textContent = `✅ OK: ${state.ok}`;
        cFail.textContent = `❌ Fail: ${state.fail}`;
        cSkip.textContent = `⏭ Skip: ${state.skip}`;
        cLast.textContent = `Last: ${state.last || "—"}`;

        try {
          const pct = state.total ? Math.min(100, Math.max(0, (state.done / state.total) * 100)) : 0;
          progBar.style.width = `${pct.toFixed(2)}%`;

          const icon =
            state.mode === "running" ? "▶" :
            state.mode === "paused" ? "⏸" :
            state.mode === "done" ? "✅" :
            state.mode === "stopped" ? "⏹" :
            state.mode === "resetting" ? "♻" :
            "•";

          pill.textContent = `${icon} ${state.done}/${state.total} (${pct.toFixed(1)}%)`;

          // Top-page pill dashboard
          dockBar.style.width = `${pct.toFixed(2)}%`;
          dockLabel.textContent = `${String(title || "Suno Download")} • ${state.done}/${state.total} • ${__truncate(state.last, 70)}`;
          dock.title = state.last ? String(state.last) : "";
        } catch {}
      };

      const log = (msg, data) => {
        const line = `[suno ${__sunoNow()}] ${msg}${data !== undefined ? " " + JSON.stringify(data) : ""}`;
        state.last = String(msg || "");

        try {
          console.log(line, data === undefined ? "" : data);
        } catch {}

        try {
          // Keep it from growing unbounded (remove oldest)
          state._logLines += 1;
          const div = document.createElement("div");
          div.textContent = line;
          logBox.appendChild(div);

          if (state._logLines > 2200) {
            // Remove ~10% oldest lines to keep DOM light.
            const removeN = Math.floor(state._logLines * 0.1);
            for (let i = 0; i < removeN; i++) {
              if (logBox.firstChild) logBox.removeChild(logBox.firstChild);
            }
            state._logLines -= removeN;
          }

          logBox.scrollTop = logBox.scrollHeight;
        } catch {}

        try {
          statusRight.textContent = line;
        } catch {}

        try {
          headerLog.textContent = __truncate(line, 110);
        } catch {}

        syncCounters();
      };

      const setMode = (mode) => {
        state.mode = String(mode || "idle");
        syncCounters();
      };

      const setStatus = (msg) => {
        try {
          statusLeft.textContent = msg;
        } catch {}
        syncCounters();
      };

      const setSubtitle = (txt) => {
        try {
          sub.textContent = String(txt || "");
        } catch {}
      };

      const setTotal = (n) => {
        state.total = Math.max(0, Number(n || 0));
        syncCounters();
      };

      const setProgress = (done) => {
        state.done = Math.max(0, Number(done || 0));
        syncCounters();
      };

      const incOk = () => {
        state.ok += 1;
        syncCounters();
      };

      const incFail = () => {
        state.fail += 1;
        syncCounters();
      };

      const incSkip = (n = 1) => {
        state.skip += Math.max(0, Number(n || 0));
        syncCounters();
      };

      const clearLogs = () => {
        try {
          logBox.innerHTML = "";
        } catch {}
        state._logLines = 0;
        state.last = "";
        syncCounters();
      };

      // Click outside hides (doesn't cancel)
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          hide();
          log("hidden (outside click)");
        }
      });

      closeBtn.onclick = () => {
        // Requested: hide only (doesn't break process)
        hide();
        log("hidden (run continues)");
      };

      syncCounters();

      // Expose buttons so controller can wire them.
      return {
        el: overlay,
        dock,
        buttons: { startBtn, pauseBtn, resetBtn, stopBtn, closeBtn },
        state,
        log,
        setMode,
        setStatus,
        setSubtitle,
        setTotal,
        setProgress,
        incOk,
        incFail,
        incSkip,
        clearLogs,
        show,
        hide,
        destroy: () => {
          try {
            overlay.remove();
          } catch {}
          try {
            dock.remove();
          } catch {}
        },
      };
    }

    // ------------------------------ Suno Controller (singleton) ------------------------------
    function __qcoreGetOrCreateSunoController(initOptions = {}) {
      try {
        if (window.__qcoreSunoDownloadCtl && window.__qcoreSunoDownloadCtl.modal) {
          // update options
          try {
            window.__qcoreSunoDownloadCtl.options = { ...window.__qcoreSunoDownloadCtl.options, ...(initOptions || {}) };
          } catch {}
          try {
            window.__qcoreSunoDownloadCtl.modal.setSubtitle(
              `root: ${window.__qcoreSunoDownloadCtl.options.rootSelector} • buttons: ${window.__qcoreSunoDownloadCtl.options.moreBtnSelector}`
            );
          } catch {}
          return window.__qcoreSunoDownloadCtl;
        }
      } catch {}

      const defaults = {
        rootSelector: 'div[data-scroll-root="true"]',
        moreBtnSelector: '[data-testid="song-row"] .hidden .contents button',

        afterMenuClickWaitMs: 1000,
        downloadClickDelayMs: 200,
        hoverHoldSeconds: 5,
        wavRetryEveryMs: 1000,

        // safety caps (requested)
        maxDownloadChecks: 30,
        downloadCheckIntervalMs: 1000,

        maxConfirmChecks: 30,
        confirmCheckIntervalMs: 1000,
        confirmTimeoutMs: 45000,

        perRowDelayMs: 250,
        startIndex: 0,
        maxRows: 0, // 0 = no limit
        autoDownloadFileIntervalMs: 1000,
      };

      const options = { ...defaults, ...(initOptions || {}) };

      const modal = __qcoreMakeSunoDownloadModal({
        title: "Suno Download",
        subtitle: `root: ${options.rootSelector} • buttons: ${options.moreBtnSelector}`,
      });

      const ctl = {
        options,
        modal,

        // active row tracking (used by the always-on "Download File" clicker)
        active: {
          btn: null,
          key: "",
          idx: 0,
          confirmed: false,
          wavClicked: false,
          lastDlFileClickAt: 0,
        },

        // internals
        _autoInterval: null,
        _runPromise: null,

        _syncButtons() {
          try {
            const { startBtn, pauseBtn, resetBtn, stopBtn } = modal.buttons;

            if (modal.state.running) {
              stopBtn.disabled = false;
              resetBtn.disabled = false;

              if (modal.state.paused) {
                startBtn.textContent = "Resume";
                startBtn.disabled = false;
                pauseBtn.textContent = "Paused";
                pauseBtn.disabled = true;
              } else {
                startBtn.textContent = "Running…";
                startBtn.disabled = true;
                pauseBtn.textContent = "Pause";
                pauseBtn.disabled = false;
              }
            } else {
              startBtn.textContent = "Start";
              startBtn.disabled = false;
              pauseBtn.textContent = "Pause";
              pauseBtn.disabled = true;
              stopBtn.disabled = true;
              resetBtn.disabled = false;
            }
          } catch {}
        },

        async _waitWhilePaused(mustStop) {
          // Keep runner asleep while paused (but still let Stop/Reset break out).
          try {
            if (!modal.state.paused) return;
            modal.setMode("paused");
            modal.setStatus("⏸ Paused");
          } catch {}
          while (modal.state.paused) {
            try {
              if (typeof mustStop === "function") mustStop();
            } catch {}
            await __sunoSleep(200);
          }
          try {
            if (modal.state.running) modal.setMode("running");
          } catch {}
        },

        start({ auto = false } = {}) {
          try {
            // If already running: resume if paused.
            if (modal.state.running) {
              if (modal.state.paused) {
                modal.state.paused = false;
                modal.log("resume");
                modal.setMode("running");
                ctl._syncButtons();
              } else if (!auto) {
                modal.log("already running");
              }
              return;
            }

            // (Re)start a run
            modal.state.cancelled = false;
            modal.state.resetRequested = false;
            modal.state.paused = false;
            modal.state.running = true;
            modal.setMode("running");
            ctl._syncButtons();

            ctl._runPromise = ctl._runOnce().finally(() => {
              modal.state.running = false;
              modal.state.paused = false;
              ctl._syncButtons();
            });

            return ctl._runPromise;
          } catch (e) {
            try {
              modal.log("start error", { message: e?.message || String(e) });
            } catch {}
          }
        },

        pause() {
          try {
            if (!modal.state.running) return;
            if (modal.state.paused) return;
            modal.state.paused = true;
            modal.setMode("paused");
            modal.log("pause requested");
            ctl._syncButtons();
          } catch {}
        },

        stop() {
          try {
            modal.state.cancelled = true;
            modal.state.paused = false;
            modal.setMode("stopped");
            modal.log("stop requested");
            ctl._syncButtons();
          } catch {}
        },

        reset() {
          try {
            // If a run is active, request reset (runner will catch and perform actual reset).
            if (modal.state.running) {
              modal.state.resetRequested = true;
              modal.state.paused = false;
              modal.setMode("resetting");
              modal.log("reset requested");
              ctl._syncButtons();
              return;
            }

            // Not running → reset immediately.
            ctl._doResetUI();
            modal.log("reset complete");
            modal.setStatus("Reset. Click Start.");
            modal.setMode("idle");
            ctl._syncButtons();
          } catch (e) {
            try {
              modal.log("reset error", { message: e?.message || String(e) });
            } catch {}
          }
        },

        _doResetUI() {
          try {
            __sunoPersistReset();
          } catch {}

          // Clear highlights for currently visible rows (best effort)
          try {
            const root = document.querySelector(ctl.options.rootSelector);
            if (root) {
              const btns = Array.from(root.querySelectorAll(ctl.options.moreBtnSelector))
                .map((el) => el?.closest?.("button") || el)
                .filter(Boolean);
              for (const b of btns) __sunoClearBg(b);
            }
          } catch {}

          // Reset modal counters/logs
          try {
            modal.clearLogs();
          } catch {}

          try {
            modal.state.total = 0;
            modal.state.done = 0;
            modal.state.ok = 0;
            modal.state.fail = 0;
            modal.state.skip = 0;
            modal.setTotal(0);
            modal.setProgress(0);
          } catch {}
        },

        _mustStop() {
          if (modal.state.cancelled) throw new Error("cancelled");
          if (modal.state.resetRequested) throw new Error("reset");
        },

        _markConfirmed(why = "Download File") {
          if (!ctl.active.btn) return;
          if (!ctl.active.confirmed) {
            ctl.active.confirmed = true;
            __sunoSetBg(ctl.active.btn, "#22c55e");
            modal.log(`row ${ctl.active.idx}: ✅ confirmed (${why})`);
          }
        },

        _startAutoConfirmLoop() {
          try {
            if (ctl._autoInterval) return;

            ctl._autoInterval = setInterval(() => {
              try {
                if (!modal.state.running) return;
                if (modal.state.cancelled) return;
                if (modal.state.resetRequested) return;
                if (modal.state.paused) return;

                const dlFileBtn = __sunoFindDownloadFileBtn();
                if (!dlFileBtn) return;
                if (!__sunoIsVisible(dlFileBtn)) return;

                // IMPORTANT: don't click disabled controls
                if (__sunoHasDisabledCursorNotAllowed(dlFileBtn)) {
                  modal.log("auto: Download File is disabled (cursor-not-allowed) — skipping");
                  return;
                }

                const now = Date.now();
                if (ctl.active && now - (ctl.active.lastDlFileClickAt || 0) < 800) return;
                if (ctl.active) ctl.active.lastDlFileClickAt = now;

                modal.log("auto: clicking Download File");
                try {
                  __sunoHover(dlFileBtn);
                } catch {}
                __sunoSafeClick(dlFileBtn);

                // Only mark confirmed if we're in the middle of a row's WAV flow.
                if (ctl.active && ctl.active.btn && ctl.active.wavClicked && !ctl.active.confirmed) {
                  ctl._markConfirmed("auto Download File clicker");
                }
              } catch (e) {
                try {
                  modal.log("auto clicker error", { message: e?.message || String(e) });
                } catch {}
              }
            }, Math.max(250, Number(ctl.options.autoDownloadFileIntervalMs || 1000)));
          } catch {}
        },

        _stopAutoConfirmLoop() {
          try {
            if (ctl._autoInterval) clearInterval(ctl._autoInterval);
          } catch {}
          ctl._autoInterval = null;
        },

        async _runOnce() {
          const modal = ctl.modal;
          const opt = ctl.options;

          ctl._startAutoConfirmLoop();

          // Reset per-run counters
          try {
            modal.state.ok = 0;
            modal.state.fail = 0;
            modal.state.done = 0;
            modal.state.skip = 0;
            modal.setProgress(0);
            modal.setMode("running");
          } catch {}

          const base = Math.max(0, Number(opt.startIndex || 0));

          const collectButtons = () => {
            let btns = [];
            try {
              const root = document.querySelector(opt.rootSelector);
              if (!root) return [];
              btns = Array.from(root.querySelectorAll(opt.moreBtnSelector));
            } catch {}

            // Fallbacks (in case Suno changes the markup)
            if (!btns.length) {
              try {
                const root = document.querySelector(opt.rootSelector);
                if (root) btns = Array.from(root.querySelectorAll('[aria-label="More menu contents"]'));
              } catch {}
            }
            if (!btns.length && opt.moreBtnSelector !== '[data-testid="song-row"] .hidden .contents button') {
              try {
                const root = document.querySelector(opt.rootSelector);
                if (root) btns = Array.from(root.querySelectorAll('[data-testid="song-row"] .hidden .contents button'));
              } catch {}
            }

            // Normalize to actual buttons
            btns = btns.map((el) => el?.closest?.("button") || el).filter(Boolean);

            // De-dup
            btns = Array.from(new Set(btns));
            return btns;
          };

          try {
            modal.setStatus("Locating scroll root…");
            modal.log("init", { rootSelector: opt.rootSelector, moreBtnSelector: opt.moreBtnSelector });

            const root = document.querySelector(opt.rootSelector);
            if (!root) {
              modal.setStatus("❌ Could not find scroll root");
              modal.log("root not found", { rootSelector: opt.rootSelector });
              modal.setMode("idle");
              return;
            }

            // Build slice
            const allLive = collectButtons();
            const totalAll = allLive.length;
            let slice = allLive.slice(base);
            if (Number(opt.maxRows || 0) > 0) slice = slice.slice(0, Number(opt.maxRows || 0));

            // Persistence
            const persist = __sunoPersistRead();
            const doneKeys = new Set(Object.keys(persist.done || {}));
            const failKeys = new Set(Object.keys(persist.fail || {}));

            // Compute metas
            const metas = slice.map((btn, i) => {
              const absIndex = base + i;
              const key = __sunoRowKey(btn, absIndex);
              const label = __sunoRowLabel(btn);
              return {
                absIndex,
                key,
                label,
                isDone: doneKeys.has(key),
                isFail: failKeys.has(key),
              };
            });

            // Color current buttons based on persisted status (best effort)
            for (let i = 0; i < slice.length; i++) {
              const btn = slice[i];
              const meta = metas[i];
              if (!btn || !meta) continue;

              if (meta.isDone) __sunoSetBg(btn, "#22c55e");
              else if (meta.isFail) __sunoSetBg(btn, "#ef4444");
            }

            const plan = metas.filter((m) => !m.isDone);
            const skipped = metas.length - plan.length;

            modal.setTotal(plan.length);
            modal.state.skip = skipped;
            modal.incSkip(0); // ensure UI sync
            modal.setStatus(`Found ${metas.length} rows • ${plan.length} to process • ${skipped} already done (skipped)`);
            modal.log("rows found", {
              totalAll,
              slice: metas.length,
              toProcess: plan.length,
              skippedDone: skipped,
              startIndex: opt.startIndex,
              maxRows: opt.maxRows,
            });

            // If nothing to do, we're done.
            if (!plan.length) {
              modal.setProgress(0);
              modal.setMode("done");
              modal.setStatus("✅ Nothing to do — everything in this list is already marked done.");
              modal.log("complete (no work)");
              return;
            }

            let done = 0;

            for (let p = 0; p < plan.length; p++) {
              // Pause support
              await ctl._waitWhilePaused(() => ctl._mustStop());
              ctl._mustStop();

              const idx = p + 1;
              const meta = plan[p];

              // Re-query live buttons and re-find by key (DOM can re-render / virtualize)
              const liveBtns = collectButtons();

              let rowBtn = null;
              try {
                // Build key map for current live list
                const map = new Map();
                for (let j = 0; j < liveBtns.length; j++) {
                  const b = liveBtns[j];
                  const k = __sunoRowKey(b, j);
                  if (!map.has(k)) map.set(k, b);
                }
                rowBtn = map.get(meta.key) || liveBtns[meta.absIndex] || null;
              } catch {
                rowBtn = liveBtns[meta.absIndex] || null;
              }

              // Update active
              ctl.active.btn = rowBtn;
              ctl.active.key = meta.key;
              ctl.active.idx = idx;
              ctl.active.confirmed = false;
              ctl.active.wavClicked = false;
              ctl.active.lastDlFileClickAt = 0;

              if (!rowBtn) {
                modal.setStatus(`Row ${idx}/${plan.length} — ❌ missing button (DOM changed)`);
                modal.log(`row ${idx}: button missing`, { meta });
                modal.incFail();
                __sunoPersistMarkFail(meta.key, { reason: "missing_button", label: meta.label || "" });
                done += 1;
                modal.setProgress(done);
                continue;
              }

              // If this row is already done (maybe another run just marked it), skip it.
              const latestPersist = __sunoPersistRead();
              if (latestPersist?.done && latestPersist.done[meta.key]) {
                __sunoSetBg(rowBtn, "#22c55e");
                modal.log(`row ${idx}: already marked done — skipping`);
                done += 1;
                modal.setProgress(done);
                continue;
              }

              modal.setStatus(`Row ${idx}/${plan.length} — opening menu…`);
              modal.log(`row ${idx}/${plan.length}: begin`, {
                key: meta.key,
                label: meta.label || "",
                aria: rowBtn.getAttribute?.("aria-label") || null,
                dataId: rowBtn.getAttribute?.("data-button-id") || null,
              });

              // Yellow = in progress
              __sunoSetBg(rowBtn, "#facc15");

              // Open the "More" menu for this row
              __sunoSafeClick(rowBtn);

              // Wait for the menu to render
              await __sunoSleep(opt.afterMenuClickWaitMs);

              ctl._mustStop();
              await ctl._waitWhilePaused(() => ctl._mustStop());
              ctl._mustStop();

              // Find & click the menu item: Download (skip if disabled:cursor-not-allowed)
              modal.setStatus(`Row ${idx}/${plan.length} — finding Download…`);

              let downloadBtn = null;
              let downloadClicked = false;

              const dlMaxChecks = Math.max(1, Number(opt.maxDownloadChecks || 30));
              const dlInterval = Math.max(200, Number(opt.downloadCheckIntervalMs || 1000));

              for (let dlAttempt = 1; dlAttempt <= dlMaxChecks; dlAttempt++) {
                ctl._mustStop();
                await ctl._waitWhilePaused(() => ctl._mustStop());
                ctl._mustStop();

                // Re-find each attempt (menu DOM can re-render / virtualize)
                downloadBtn = __sunoFindDownloadItem();

                if (!downloadBtn || !__sunoIsVisible(downloadBtn)) {
                  modal.log(`row ${idx}: Download not found (attempt ${dlAttempt}/${dlMaxChecks})`);

                  // Re-open the row menu in case it collapsed.
                  try {
                    __sunoPressEscape();
                  } catch {}
                  await __sunoSleep(80);
                  __sunoSafeClick(rowBtn);
                  await __sunoSleep(opt.afterMenuClickWaitMs);
                  continue;
                }

                // IMPORTANT: Don't click when disabled (requested).
                if (__sunoHasDisabledCursorNotAllowed(downloadBtn)) {
                  modal.log(`row ${idx}: Download disabled (cursor-not-allowed) — skipping (attempt ${dlAttempt}/${dlMaxChecks})`);
                  try {
                    __sunoHover(downloadBtn);
                  } catch {}
                  await __sunoSleep(dlInterval);
                  continue;
                }

                modal.log(`row ${idx}: Download found (enabled) — clicking`, { attempt: dlAttempt, text: __sunoText(downloadBtn).slice(0, 90) });

                // Move cursor over Download, then click it
                try {
                  __sunoHover(downloadBtn);
                } catch {}
                await __sunoSleep(40);
                __sunoSafeClick(downloadBtn);

                downloadClicked = true;
                break;
              }

              if (!downloadClicked) {
                modal.setStatus(`Row ${idx}/${plan.length} — ❌ Download never became clickable (flagging red)`);
                modal.log(`row ${idx}: ❌ Download not clickable after ${dlMaxChecks} checks`);
                __sunoSetBg(rowBtn, "#ef4444"); // red
                modal.incFail();
                __sunoPersistMarkFail(meta.key, { reason: "download_not_clickable", label: meta.label || "" });

                done += 1;
                modal.setProgress(done);
                __sunoPressEscape();
                await __sunoSleep(opt.perRowDelayMs);
                continue;
              }

              await __sunoSleep(Math.max(0, Number(opt.downloadClickDelayMs || 200)));

              // Hold for N seconds; each second try to click WAV Audio
              const hold = Math.max(1, Number(opt.hoverHoldSeconds || 5));
              for (let tick = 0; tick < hold; tick++) {
                ctl._mustStop();
                await ctl._waitWhilePaused(() => ctl._mustStop());
                ctl._mustStop();

                const secondsLeft = hold - tick;
                modal.setStatus(`Row ${idx}/${plan.length} — Download menu (${secondsLeft}s) • clicking WAV…`);
                modal.log(`row ${idx}: wav tick`, { secondsLeft });

                // Keep the submenu alive
                try {
                  __sunoHover(downloadBtn);
                } catch {}

                const wavBtn = __sunoFindWavItem();
                if (wavBtn) {
                  ctl.active.wavClicked = true;
                  modal.log(`row ${idx}: clicking WAV Audio`, { aria: wavBtn.getAttribute?.("aria-label") || null });
                  __sunoSafeClick(wavBtn);
                }

                // Sometimes "Download File" pops immediately; click it here too (auto loop also running)
                const dlFileNow = __sunoFindDownloadFileBtn();
                if (dlFileNow && __sunoIsVisible(dlFileNow)) {
                  if (__sunoHasDisabledCursorNotAllowed(dlFileNow)) {
                    modal.log(`row ${idx}: Download File disabled (cursor-not-allowed) — skipping (inline)`);
                  } else {
                    modal.log(`row ${idx}: clicking Download File (inline)`);
                    __sunoSafeClick(dlFileNow);
                    ctl._markConfirmed("inline Download File");
                  }
                }

                if (ctl.active.confirmed) break;

                await __sunoSleep(Math.max(50, Number(opt.wavRetryEveryMs || 1000)));
              }

              // If WAV was clicked, wait for "Download File" confirmation.
              if (ctl.active.wavClicked && !ctl.active.confirmed) {
                const interval = Math.max(200, Number(opt.confirmCheckIntervalMs || 1000));
                const maxChecksWanted = Math.max(1, Number(opt.maxConfirmChecks || 30));

                // Keep confirmTimeoutMs as an upper bound if you override it lower than maxConfirmChecks.
                const maxChecksByTimeout =
                  Number(opt.confirmTimeoutMs || 0) > 0 ? Math.max(1, Math.ceil(Number(opt.confirmTimeoutMs || 0) / interval)) : maxChecksWanted;

                const maxChecks = Math.min(maxChecksWanted, maxChecksByTimeout);

                for (let check = 1; check <= maxChecks && !ctl.active.confirmed; check++) {
                  ctl._mustStop();
                  await ctl._waitWhilePaused(() => ctl._mustStop());
                  ctl._mustStop();

                  modal.setStatus(`Row ${idx}/${plan.length} — waiting for Download File… (${check}/${maxChecks})`);

                  const dlFileBtn = __sunoFindDownloadFileBtn();
                  if (dlFileBtn && __sunoIsVisible(dlFileBtn)) {
                    if (__sunoHasDisabledCursorNotAllowed(dlFileBtn)) {
                      modal.log(`row ${idx}: Download File disabled (cursor-not-allowed) — skipping (wait loop)`, { check, maxChecks });
                    } else {
                      modal.log(`row ${idx}: clicking Download File (wait loop)`, { check, maxChecks });
                      __sunoSafeClick(dlFileBtn);
                      ctl._markConfirmed("wait-loop Download File");
                      break;
                    }
                  }

                  await __sunoSleep(interval);
                }
              }

              // Outcome → persist & color
              if (ctl.active.confirmed) {
                __sunoSetBg(rowBtn, "#22c55e"); // green
                modal.incOk();
                modal.log(`row ${idx}: ✅ done`);
                __sunoPersistMarkDone(meta.key, { label: meta.label || "" });
              } else if (ctl.active.wavClicked) {
                __sunoSetBg(rowBtn, "#ef4444"); // red
                modal.incFail();
                modal.log(`row ${idx}: ❌ no Download File confirmation after ${Math.max(1, Number(opt.maxConfirmChecks || 30))} checks — flagged red`);
                __sunoPersistMarkFail(meta.key, { reason: "no_download_file_confirmation", label: meta.label || "" });
              } else {
                __sunoSetBg(rowBtn, "#ef4444"); // red
                modal.incFail();
                modal.log(`row ${idx}: ❌ WAV not found/clicked`);
                __sunoPersistMarkFail(meta.key, { reason: "wav_not_clicked", label: meta.label || "" });
              }

              done += 1;
              modal.setProgress(done);

              // Close any menus so we don't stack them
              __sunoPressEscape();
              await __sunoSleep(opt.perRowDelayMs);
            }

            modal.setStatus(`✅ Complete — processed ${done}/${plan.length} (${modal.state.ok} OK, ${modal.state.fail} Fail, ${modal.state.skip} Skipped)`);
            modal.log("run complete", { done, total: plan.length, ok: modal.state.ok, fail: modal.state.fail, skip: modal.state.skip });
            modal.setMode("done");
          } catch (e) {
            if (String(e?.message || e) === "reset") {
              // Reset requested: clear persistence + UI, but keep the modal around.
              try {
                modal.setStatus("♻ Resetting…");
              } catch {}
              try {
                ctl._doResetUI();
              } catch {}
              try {
                modal.state.resetRequested = false;
                modal.state.cancelled = false;
              } catch {}
              modal.setMode("idle");
              modal.setStatus("Reset. Click Start.");
              modal.log("reset applied");
              return;
            }

            if (String(e?.message || e) === "cancelled") {
              modal.setStatus("⏹ Stopped by user");
              modal.log("cancelled");
              modal.setMode("stopped");
              return;
            }

            modal.setStatus(`❌ Error: ${e?.message || String(e)}`);
            modal.log("error", { message: e?.message || String(e), stack: e?.stack || null });
            modal.setMode("idle");
            try {
              console.error("[Suno Download] error", e);
            } catch {}
          } finally {
            // Stop loop if the run ended
            ctl._stopAutoConfirmLoop();
          }
        },
      };

      // Wire modal buttons
      try {
        modal.buttons.startBtn.onclick = () => ctl.start({ auto: false });
        modal.buttons.pauseBtn.onclick = () => ctl.pause();
        modal.buttons.resetBtn.onclick = () => ctl.reset();
        modal.buttons.stopBtn.onclick = () => ctl.stop();
      } catch {}

      ctl._syncButtons();

      try {
        window.__qcoreSunoDownloadCtl = ctl;
      } catch {}

      return ctl;
    }



  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "suno",
      title: "Suno WAV Download",
      icon: "🎵",
      description: "Batch-download WAVs from Suno UI (manual open).",
      order: 140,
      onClick: () => {
        try {
          const ctl = __qcoreGetOrCreateSunoController({
            rootSelector: 'div[data-scroll-root="true"]',
            moreBtnSelector: '[data-testid="song-row"] .hidden .contents button',
            afterMenuClickWaitMs: 1000,
            downloadClickDelayMs: 200,
            hoverHoldSeconds: 5,
            wavRetryEveryMs: 1000,
            confirmTimeoutMs: 45000,
            autoDownloadFileIntervalMs: 1000,
          });
          try { ctl?.modal?.show?.(); } catch {}
          try { ctl?.start?.({ auto: true }); } catch {}
          window.QCoreToolsModal.__qcoreSunoDownloadCtl = ctl;
        } catch (e) { console.error(e); }
      },
    });
    try { QQ.__qcoreGetOrCreateSunoController = __qcoreGetOrCreateSunoController; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
