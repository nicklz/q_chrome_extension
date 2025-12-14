// plugins/QCorePeopleManager.js
(function () {
  // Prevent duplicate load
  if (window.QCorePeopleManager) return;

  // ---------- Host-state shims ----------
  const getState =
    window?.QCoreContent?.getState ||
    (() => JSON.parse(localStorage.getItem("state")) || { status: "paused", events: [], tickets: [] });

  const setState =
    window?.QCoreContent?.setState ||
    ((s) => localStorage.setItem("state", JSON.stringify(s)));

  // ============================================================================
  // QPM_colorRowsTROnly — paint just the <tr> based on tags in the 9th column
  // ============================================================================
  function QPM_colorRowsTROnly() {
    const PRIORITY = [
      "interested",
      "interested_unsent",
      "maybe_unsent",
      "maybe",
      "doubt",
      "private_want_to_see",
      "private_second_unsent",
      "private",
    ];
    const COLORS = {
      interested:            { bg: "rgba(34,197,94,0.18)",  fg: "#e5e7eb" },
      interested_unsent:     { bg: "rgba(59,130,246,0.18)", fg: "#e5e7eb" },
      maybe_unsent:          { bg: "rgba(245,158,11,0.18)", fg: "#111827" },
      maybe:                 { bg: "rgba(245,158,11,0.12)", fg: "#e5e7eb" },
      doubt:                 { bg: "rgba(239,68,68,0.18)",  fg: "#111827" },
      private_want_to_see:   { bg: "rgba(147,51,234,0.18)", fg: "#e5e7eb" },
      private_second_unsent: { bg: "rgba(234,179,8,0.18)",  fg: "#111827" },
      private:               { bg: "rgba(148,163,184,0.12)",fg: "#e5e7eb" },
    };

    const tbody = document.getElementById("qpm-rows");
    if (!tbody) return;

    const normTag = (s) =>
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9 _-]+/g, "")
        .replace(/\s+/g, "_");

    const splitNotes = (s) =>
      String(s || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map(normTag);

    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      const notesCell = tr.querySelector("td:nth-child(9)");
      if (!notesCell) return;

      const ta = notesCell.querySelector("textarea");
      const raw = ta ? ta.value : notesCell.textContent;
      const tags = new Set(splitNotes(raw));

      let theme = null;
      for (const key of PRIORITY) {
        if (tags.has(normTag(key))) {
          theme = COLORS[key];
          break;
        }
      }
      if (!theme) return;

      tr.style.setProperty("background", theme.bg, "important");
      tr.style.setProperty("background-color", theme.bg, "important");
      tr.style.setProperty("color", theme.fg, "important");
    });
  }

  // ====================================================================================
  // QPM_applyHardcodedHighlights — stronger row paint + pills + classes + observers
  // ====================================================================================
  function QPM_applyHardcodedHighlights() {
    const PRIORITY = [
      "interested",
      "interested_unsent",
      "maybe_unsent",
      "maybe",
      "doubt",
      "private_want_to_see",
      "private_second_unsent",
      "private",
    ];

    const COLORS = {
      interested:            { bg: "rgba(34,197,94,0.18)",  fg: "#e5e7eb", border: "#22C55E" },
      interested_unsent:     { bg: "rgba(59,130,246,0.18)", fg: "#e5e7eb", border: "#3B82F6" },
      maybe_unsent:          { bg: "rgba(245,158,11,0.18)", fg: "#111827", border: "#F59E0B" },
      doubt:                 { bg: "rgba(239,68,68,0.18)",  fg: "#111827", border: "#EF4444" },
      private_want_to_see:   { bg: "rgba(147,51,234,0.18)", fg: "#e5e7eb", border: "#9333EA" },
      private_second_unsent: { bg: "rgba(234,179,8,0.18)",  fg: "#111827", border: "#EAB308" },
    };

    const FALLBACK = [
      "#0d1b2a","#1f2937","#0f172a","#2c0d0d","#0d2c1a","#2c1a0d",
      "#0d2433","#2a0d2c","#102a0d","#2c0d21","#0d2a28","#2c2310",
      "#111827","#1a0d2e",
    ];

    const cssify = (s) =>
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9 _-]+/g, "")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    const uniq = (a) => Array.from(new Set((a || []).filter(Boolean)));
    const split = (s) => uniq(String(s || "").split(",").map((x) => x.trim()).filter(Boolean));

    const randomColor = (tag) => {
      let h = 0;
      const t = String(tag || "");
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
      return FALLBACK[h % FALLBACK.length];
    };

    const cat = (t) => COLORS[cssify(t)] || null;

    // CSS baseline (strong)
    if (!document.getElementById("qpm-row-paint-rules")) {
      const st = document.createElement("style");
      st.id = "qpm-row-paint-rules";
      st.textContent = `
        #qpm-rows > tr.qpm-row.qpm-painted {
          background: var(--qpm-bg) !important;
          color: var(--qpm-fg) !important;
          border-left: 4px solid var(--qpm-accent) !important;
        }
        #qpm-rows > tr.qpm-row.qpm-painted a { color: #d1d5db !important; }
        #qpm-rows > tr.qpm-row.qpm-painted textarea,
        #qpm-rows > tr.qpm-row.qpm-painted input,
        #qpm-rows > tr.qpm-row.qpm-painted select {
          background: rgba(0,0,0,.25) !important;
          color: var(--qpm-fg, #e5e7eb) !important;
          border-color: rgba(255,255,255,.15) !important;
        }
      `;
      document.head.appendChild(st);
    }

    // Build user→tags map from local persisted data (so IG usernames carry tags to any row for that user)
    function extractUser(urlOrUser) {
      const normUser = (u) => String(u||"").toLowerCase().replace(/^@/,"").replace(/\/+$/,"").trim();
      if (/^https?:\/\//i.test(urlOrUser||"")) {
        try { const url = new URL(urlOrUser); return normUser((url.pathname.replace(/^\/+/,"").split("/")[0])||""); }
        catch { return null; }
      }
      return normUser(urlOrUser);
    }

    function buildUserToTags() {
      let map = new Map();
      try {
        const raw = localStorage.getItem("q.people.manager.v1");
        const arr = raw ? JSON.parse(raw) : null;
        if (Array.isArray(arr)) {
          arr.forEach((it) => {
            const user = extractUser(it && it.href);
            if (!user) return;
            const tags = split(it && it.notes);
            if (!map.has(user)) map.set(user, new Set());
            tags.forEach((t) => map.get(user).add(t));
          });
        }
      } catch {}
      return map;
    }

    const userToTags = buildUserToTags();

    // Helper: gather tags for a row by combining notes + any stored tags for same IG username
    function mergedTagsForRow(tr) {
      const notesEl = tr.querySelector("td:nth-child(9) textarea");
      const notes = notesEl
        ? notesEl.value || ""
        : (tr.querySelector("td:nth-child(9)")?.textContent || "");
      const tags = split(notes);

      // If column 2 contains a URL, derive IG username and merge historical tags
      const a = tr.querySelector('td:nth-child(2) a[href]');
      if (a) {
        const user = extractUser(a.getAttribute("href"));
        if (user && userToTags.has(user)) {
          userToTags.get(user).forEach((t) => tags.push(t));
        }
      }
      return uniq(tags);
    }

    const paint = () => {
      const tbody = document.getElementById("qpm-rows");
      if (!tbody) return;

      Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
        tr.classList.add("qpm-row");

        // reset class tags
        tr.className = tr.className
          .split(/\s+/)
          .filter((c) => !/^qpm-cat-/.test(c) && !/^qpm-note-/.test(c) && c !== "qpm-painted")
          .join(" ")
          .trim();

        // tags (merged with user history)
        const tags = mergedTagsForRow(tr);

        // primary
        const lower = new Set(tags.map((t) => t.toLowerCase().trim()));
        const primary = PRIORITY.find((c) => lower.has(c)) || null;
        if (primary) tr.classList.add("qpm-cat-" + cssify(primary));

        // per-tag classes
        tags.map(cssify).filter(Boolean).forEach((t) => tr.classList.add("qpm-note-" + t));

        // theme
        let theme = primary ? cat(primary) : null;
        if (!theme) {
          const known = tags.find((t) => cat(t));
          if (known) theme = cat(known);
        }
        if (!theme) {
          const fb = randomColor(tags[0] || "fallback");
          theme = { bg: fb + "33", fg: "#e5e7eb", border: fb };
        }

        // paint
        tr.style.setProperty("--qpm-bg", theme.bg);
        tr.style.setProperty("--qpm-fg", theme.fg);
        tr.style.setProperty("--qpm-accent", theme.border);
        tr.style.setProperty("background", theme.bg, "important");
        tr.style.setProperty("color", theme.fg, "important");
        tr.style.setProperty("border-left", `4px solid ${theme.border}`, "important");
        tr.classList.add("qpm-painted");

        // Pills container in notes (9th td)
        const td9 = tr.querySelector("td:nth-child(9)");
        if (td9) {
          let wrap = td9.querySelector(".qpm-pills");
          if (!wrap) {
            wrap = document.createElement("div");
            wrap.className = "qpm-pills";
            wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px";
            td9.appendChild(wrap);
          }
          wrap.innerHTML = "";
          tags.forEach((t) => {
            const pill = document.createElement("span");
            const c = cat(t);
            const bg = c ? c.bg : randomColor(t) + "33";
            const fg = c ? c.fg : "#ffffff";
            const ac = c ? c.border : randomColor(t);
            pill.textContent = t;
            pill.style.cssText =
              "padding:2px 8px;border-radius:9999px;font-size:12px;line-height:18px;display:inline-block;border:1px solid rgba(255,255,255,.15)";
            pill.style.backgroundColor = bg;
            pill.style.color = fg;
            pill.style.boxShadow = `inset 0 0 0 2px ${ac}`;
            wrap.appendChild(pill);
          });
        }

        // re-paint throttle on notes edit
        const notesEl = tr.querySelector("td:nth-child(9) textarea");
        if (notesEl && !notesEl.__qpm_bound) {
          notesEl.__qpm_bound = true;
          notesEl.addEventListener("input", () => {
            clearTimeout(notesEl.__qpm_t);
            notesEl.__qpm_t = setTimeout(paint, 80);
          });
        }
      });
    };

    paint();

    // Observe row mutations (child list & style changes) to keep highlights alive
    const tbody = document.getElementById("qpm-rows");
    if (tbody && !tbody.__qpm_observe) {
      tbody.__qpm_observe = true;
      new MutationObserver((mutations) => {
        let repaint = false;
        for (const m of mutations) {
          if (m.type === "childList" || (m.type === "attributes" && (m.attributeName === "style" || m.attributeName === "class"))) {
            repaint = true; break;
          }
        }
        if (repaint) paint();
      }).observe(tbody, { childList: true, subtree: true, attributes: true, attributeFilter: ["style","class"] });
    }

    // Repaint when modal shown/closed/clicked
    const modal = document.getElementById("qpm-modal");
    if (modal && !modal.__qpm_linked) {
      modal.__qpm_linked = true;
      ["close", "cancel", "click"].forEach((evt) => modal.addEventListener(evt, () => setTimeout(paint, 0)));
    }

    // Safety pass: if any row ends up transparent, force a bg from tags
    requestAnimationFrame(() => {
      document.querySelectorAll("#qpm-rows tr").forEach((tr) => {
        const computed = getComputedStyle(tr).backgroundColor;
        if (computed === "rgba(0, 0, 0, 0)") {
          const tags = mergedTagsForRow(tr).map((t) => t.toLowerCase());
          const bg =
            tags.includes("interested_unsent") ? "rgba(59,130,246,0.18)" :
            tags.includes("private_second_unsent") ? "rgba(234,179,8,0.18)" :
            (tags.includes("private_want_to_see") || tags.includes("private")) ? "rgba(147,51,234,0.18)" :
            (tags.includes("maybe_unsent") || tags.includes("maybe")) ? "rgba(245,158,11,0.18)" :
            tags.includes("doubt") ? "rgba(239,68,68,0.18)" :
            tags.includes("interested") ? "rgba(34,197,94,0.18)" : "";
          if (bg) {
            tr.style.setProperty("background", bg, "important");
            tr.style.setProperty("background-color", bg, "important");
          }
        }
      });
    });

    // Public hook to force repaint from outside
    window.QPM_forceRepaint = paint;
  }

  // ====================================================================================
  // QPeopleManagerView — Full modal UI w/ CSV import/export, open-all, persistence
  // ====================================================================================
  async function QPeopleManagerView(_btn, _currentWindowOnly) {
    // Re-open if exists
    if (document.getElementById("qpm-root")) {
      document.getElementById("qpm-root").style.display = "block";
      document.getElementById("qpm-modal").showModal();
      return;
    }

    const qpm = {
      STORAGE_KEY: "q.people.manager.v1",
      items: [],
      uid: () => Math.random().toString(36).slice(2, 10),
      openTried: new Set(),
      openStats: { opened: 0, blocked: 0, errors: 0 },
      HEADERS: ["id", "href", "label", "rating", "rank", "name", "age", "badNotes", "notes"],
      getHostState() {
        try { return typeof getState === "function" ? (getState() || {}) : {}; } catch { return {}; }
      },
      setHostState(next) {
        try { if (typeof setState === "function") setState(next); } catch {}
      }
    };

    // ---------- Frame ----------
    const root = document.createElement("div");
    root.id = "qpm-root";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:block";

    const overlay = document.createElement("div");
    overlay.id = "qpm-overlay";
    overlay.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.45)";

    const dlg = document.createElement("dialog");
    dlg.id = "qpm-modal";
    dlg.style.cssText = "width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:0;border:none;background:#0b1117;color:#cbd5e1;overflow:hidden";

    // Header
    const header = document.createElement("div");
    header.style.cssText =
      "position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #273449;backdrop-filter:saturate(1.2) blur(6px);background:rgba(11,17,23,0.85)";

    const hTitle = document.createElement("div");
    hTitle.textContent = "People Manager";
    hTitle.style.cssText = "font-weight:600;font-size:16px;letter-spacing:.3px;color:#93c5fd;";

    const hVer = document.createElement("span");
    hVer.textContent = "v2025.11.06";
    hVer.style.cssText = "font-size:11px;color:#94a3b8;margin-left:8px;";

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;";

    const mkBtn = (txt, bg, fg = "#e2e8f0") => {
      const b = document.createElement("button");
      b.textContent = txt;
      b.style.cssText =
        `padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:${bg};color:${fg};font-weight:600;cursor:pointer;transition:transform .06s ease,filter .12s ease;user-select:none`;
      b.onmousedown = () => (b.style.transform = "translateY(1px)");
      b.onmouseup = b.onmouseleave = () => (b.style.transform = "translateY(0)");
      b.onmouseover = () => (b.style.filter = "brightness(1.05)");
      b.onmouseout  = ()  => (b.style.filter = "brightness(1.0)");
      return b;
    };

    const btnSave   = mkBtn("Save", "#65a30d", "#0b1117");
    const btnOpen   = mkBtn("Open All", "#65a30d", "#0b1117");
    const btnA      = mkBtn("Part A (0–25%)", "#3b82f6");
    const btnB      = mkBtn("Part B (25–50%)", "#3b82f6");
    const btnC      = mkBtn("Part C (50–75%)", "#3b82f6");
    const btnD      = mkBtn("Part D (75–100%)", "#3b82f6");
    const btnImport = mkBtn("Import CSV", "#334155");
    const btnExport = mkBtn("Export CSV", "#334155");
    const btnAdd    = mkBtn("Add URL", "#334155");
    const btnClear  = mkBtn("Clear", "#7f1d1d");
    const btnClose  = mkBtn("Close", "#1f2a3a");

    [btnSave, btnOpen, btnA, btnB, btnC, btnD, btnImport, btnExport, btnAdd, btnClear, btnClose].forEach((b) => btnRow.appendChild(b));
    header.append(hTitle, hVer, btnRow);

    // Info strip
    const info = document.createElement("div");
    info.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid #1f2a3a;background:linear-gradient(180deg,#0f1623 0%,#0b1117 100%)";
    const pill = (html) => {
      const p = document.createElement("span");
      p.innerHTML = html;
      p.style.cssText = "border:1px solid #2b3648;background:#111827;padding:4px 8px;border-radius:10px;font-size:12px;color:#cbd5e1";
      return p;
    };
    info.append(
      pill('Links open in <code style="font-family:monospace;background:#0b1117;border:1px solid #334155;padding:1px 6px;border-radius:6px">_blank</code>'),
      pill('Autosaves to <code style="font-family:monospace;background:#0b1117;border:1px solid #334155;padding:1px 6px;border-radius:6px">localStorage</code>'),
      pill("Rating 1–10 • Rank 0–10"),
      pill("CSV import/export"),
      pill("Row color from Notes tags (col 9)")
    );

    // Main
    const main = document.createElement("div");
    main.style.cssText = "position:relative;height:calc(100vh - 106px);overflow:auto;padding:16px";

    const card = document.createElement("div");
    card.style.cssText = "border:1px solid #1f2a3a;border-radius:12px;background:linear-gradient(180deg,#0f1623 0%,#0b1117 100%);padding:12px";

    const wrap = document.createElement("div");
    wrap.style.cssText = "overflow:auto;border-radius:10px";

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:separate;border-spacing:0;font-size:14px";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    trh.style.cssText = "border-bottom:1px solid #273449;color:#cbd5e1;background:#0d1420;position:sticky;top:0;z-index:1;";
    ["#","URL (href)","Open","Name","Age","Rank (0–10)","Rating 1–10","Bad Notes","Notes","Actions"].forEach((h,i)=>{
      const th = document.createElement("th");
      th.textContent = h;
      th.style.cssText = `padding:10px;${i===1?"width:32%":""};${i===6?"min-width:110px":""};${(i===7||i===8)?"width:22%":""}`;
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");
    tbody.id = "qpm-rows";
    table.append(thead, tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    main.appendChild(card);

    // Dialog helpers
    const mkDialog = (id, w) => {
      const d = document.createElement("dialog");
      d.id = id;
      d.style.cssText = `border-radius:12px;border:1px solid #273449;background:#0b1117;color:#cbd5e1;width:min(${w}px,95vw);padding:0;margin:auto;box-shadow:0 10px 40px rgba(0,0,0,.5)`;
      return d;
    };

    const dlgConfirm = mkDialog("qpm-confirm", 560);
    dlgConfirm.innerHTML = [
      '<form method="dialog" style="display:flex;flex-direction:column">',
      '<div style="padding:12px 16px;border-bottom:1px solid #273449;font-weight:600" id="qpm-confirm-title">Confirm</div>',
      '<div style="padding:16px;color:#cbd5e1">',
      '<div id="qpm-confirm-text">Are you sure?</div>',
      '<div id="qpm-progress-wrap" style="display:none;margin-top:10px">',
      '<div style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8"><div>Opening tabs…</div><div id="qpm-progress-count">0 / 0</div></div>',
      '<div style="height:10px;border-radius:9999px;background:#1f2a3a;overflow:hidden;border:1px solid #2b3648;margin-top:6px"><div id="qpm-progress-fill" style="height:100%;width:0%;background:#22c55e;transition:width .4s ease"></div></div>',
      '<div id="qpm-progress-status" style="margin-top:6px;font-size:11px;color:#94a3b8">Waiting…</div>',
      "</div></div>",
      '<div style="padding:12px 16px;border-top:1px solid #273449;display:flex;justify-content:flex-end;gap:8px">',
      '<button value="cancel" id="qpm-confirm-cancel" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0;font-weight:600;cursor:pointer">Cancel</button>',
      '<button value="ok" id="qpm-confirm-yes" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#65a30d;color:#0b1117;font-weight:800;cursor:pointer">OK</button>',
      "</div></form>",
    ].join("");

    const dlgInfo = mkDialog("qpm-info", 560);
    dlgInfo.innerHTML = [
      '<form method="dialog" style="display:flex;flex-direction:column">',
      '<div style="padding:12px 16px;border-bottom:1px solid #273449;font-weight:600" id="qpm-info-title">Notice</div>',
      '<div style="padding:16px;color:#cbd5e1;white-space:pre-wrap" id="qpm-info-text">Done.</div>',
      '<div style="padding:12px 16px;border-top:1px solid #273449;display:flex;justify-content:flex-end;gap:8px">',
      '<button value="ok" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#3b82f6;color:#fff;font-weight:700;cursor:pointer">OK</button>',
      "</div></form>",
    ].join("");

    const dlgImport = mkDialog("qpm-import", 680);
    dlgImport.innerHTML = [
      '<form method="dialog" style="display:flex;flex-direction:column" id="qpm-import-form">',
      '<div style="padding:12px 16px;border-bottom:1px solid #273449;font-weight:600">Import CSV</div>',
      '<div style="padding:16px;color:#cbd5e1">',
      '<div style="font-size:13px;margin-bottom:8px">Columns supported (extra ignored): <code style="font-family:monospace;background:#0b1117;border:1px solid #334155;padding:1px 6px;border-radius:6px">id,href,label,rating,rank,name,age,badNotes,notes</code>.</div>',
      '<input id="qpm-csv-file" type="file" accept=".csv,text/csv" style="width:100%;padding:10px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1" />',
      "</div>",
      '<div style="padding:12px 16px;border-top:1px solid #273449;display:flex;justify-content:flex-end;gap:8px">',
      '<button value="cancel" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0;font-weight:600;cursor:pointer">Cancel</button>',
      '<button value="ok" id="qpm-import-ok" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#3b82f6;color:#fff;font-weight:700;cursor:pointer">OK</button>',
      "</div></form>",
    ].join("");

    const dlgExport = mkDialog("qpm-export", 680);
    dlgExport.innerHTML = [
      '<form method="dialog" style="display:flex;flex-direction:column">',
      '<div style="padding:12px 16px;border-bottom:1px solid #273449;font-weight:600">Export CSV</div>',
      '<div style="padding:16px;color:#cbd5e1;font-size:14px">Prepare a CSV download of current rows?</div>',
      '<div style="padding:12px 16px;border-top:1px solid #273449;display:flex;justify-content:flex-end;gap:8px">',
      '<button value="cancel" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0;font-weight:600;cursor:pointer">Cancel</button>',
      '<button value="ok" id="qpm-export-ok" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#3b82f6;color:#fff;font-weight:700;cursor:pointer">OK</button>',
      "</div></form>",
    ].join("");

    const dlgAdd = mkDialog("qpm-add", 680);
    dlgAdd.innerHTML = [
      '<form method="dialog" style="display:flex;flex-direction:column">',
      '<div style="padding:12px 16px;border-bottom:1px solid #273449;font-weight:600">Add URL</div>',
      '<div style="padding:16px;color:#cbd5e1;display:flex;flex-direction:column;gap:10px">',
      '<input id="qpm-url-input" type="url" inputmode="url" placeholder="https://example.com/your/link" style="width:100%;padding:10px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1" />',
      '<input id="qpm-title-input" type="text" placeholder="Optional label (defaults to href)" style="width:100%;padding:10px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1" />',
      "</div>",
      '<div style="padding:12px 16px;border-top:1px solid #273449;display:flex;justify-content:flex-end;gap:8px">',
      '<button value="cancel" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0;font-weight:600;cursor:pointer">Cancel</button>',
      '<button value="ok" id="qpm-add-ok" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#3b82f6;color:#fff;font-weight:700;cursor:pointer">OK</button>',
      "</div></form>",
    ].join("");

    // Compose
    dlg.append(header, info, main);
    root.append(overlay, dlg, dlgConfirm, dlgInfo, dlgImport, dlgExport, dlgAdd);
    document.body.appendChild(root);
    dlg.showModal();

    // ---------- Utils ----------
    const confirmTitle = dlgConfirm.querySelector("#qpm-confirm-title");
    const confirmText  = dlgConfirm.querySelector("#qpm-confirm-text");
    const progWrap     = dlgConfirm.querySelector("#qpm-progress-wrap");
    const progFill     = dlgConfirm.querySelector("#qpm-progress-fill");
    const progCount    = dlgConfirm.querySelector("#qpm-progress-count");
    const progStatus   = dlgConfirm.querySelector("#qpm-progress-status");
    const confirmYes   = dlgConfirm.querySelector("#qpm-confirm-yes");

    const infoTitle = dlgInfo.querySelector("#qpm-info-title");
    const infoText  = dlgInfo.querySelector("#qpm-info-text");

    const showProgress = (total) => {
      progWrap.style.display = "block";
      progFill.style.width = "0%";
      progCount.textContent = `0 / ${total}`;
      progStatus.textContent = "Starting…";
    };
    const updateProgress = (done, total, extra = "") => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      progFill.style.width = `${pct}%`;
      progCount.textContent = `${done} / ${total}`;
      progStatus.textContent = `${pct}% — ${extra}`;
    };
    const hideProgress = () => {
      progWrap.style.display = "none";
      progFill.style.width = "0%";
      progCount.textContent = "0 / 0";
      progStatus.textContent = "Waiting…";
    };
    const confirmBox = (t, m, onOK, withProg = false) => {
      confirmTitle.textContent = t;
      confirmText.textContent = m;
      withProg ? showProgress(0) : hideProgress();
      dlgConfirm.showModal();
      const handler = async (e) => {
        if (e.target.value === "ok") {
          confirmYes.disabled = true;
          try { await onOK?.(); } finally { confirmYes.disabled = false; }
        }
        confirmYes.removeEventListener("click", handler);
      };
      confirmYes.addEventListener("click", handler, { once: true });
    };
    const infoBox = (t, m) => {
      infoTitle.textContent = t;
      infoText.textContent = m;
      dlgInfo.showModal();
    };

    const normalizeURL = (u) => {
      try { if (!/^https?:\/\//i.test(u)) u = "https://" + u; const url = new URL(u); url.hash = ""; return url.toString(); }
      catch { return null; }
    };

    function toCSV(rows) {
      const esc = (v="") => {
        v = String(v ?? "");
        return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
      };
      const header = qpm.HEADERS;
      const body = rows.map(r => header.map(h => {
        if (h==="rating")   return Number.isFinite(r.rating) ? r.rating : 0;
        if (h==="rank")     return Number.isFinite(r.rank)   ? r.rank   : 0;
        if (h==="age")      return Number.isFinite(r.age)    ? r.age    : "";
        if (h==="badNotes") return r.badNotes ?? "";
        if (h==="notes")    return r.notes ?? "";
        return r[h] ?? "";
      }).map(esc).join(","));
      return [header.join(","), ...body].join("\n");
    }

    function parseCSV(text) {
      const rows = []; let i=0, field="", inQ=false, row=[];
      const pushF=()=>{ row.push(field); field=""; }, pushR=()=>{ rows.push(row); row=[]; };
      while(i<text.length){
        const ch=text[i];
        if(inQ){
          if(ch===`"`){ if(text[i+1]==='"'){ field+='"'; i+=2; continue; } inQ=false; i++; continue; }
          field+=ch; i++; continue;
        } else {
          if(ch===`"`){ inQ=true; i++; continue; }
          if(ch===","){ pushF(); i++; continue; }
          if(ch==="\r"){ i++; continue; }
          if(ch==="\n"){ pushF(); pushR(); i++; continue; }
          field+=ch; i++; continue;
        }
      }
      pushF(); pushR(); if(!rows.length) return [];
      const header = rows[0].map(h=>h.trim().toLowerCase());
      const idx = (n)=>header.indexOf(n);
      const idI=idx("id"), hrefI=idx("href"), labelI=idx("label"),
            ratingI=idx("rating"), notesI=idx("notes"), rankI=idx("rank"),
            nameI=idx("name"), ageI=idx("age"), badI=idx("badnotes");
      const out=[];
      for(let r=1;r<rows.length;r++){
        const cells = rows[r]; if(!cells || !cells.length) continue;
        const hrefRaw = (hrefI>=0 ? (cells[hrefI]||"") : "").trim();
        const norm = hrefRaw ? normalizeURL(hrefRaw) : null; if(!norm) continue;
        const ratingRaw = (ratingI>=0 ? (cells[ratingI]??"") : "");
        const rankRaw   = (rankI>=0   ? (cells[rankI]??"")   : "");
        const ageRaw    = (ageI>=0    ? (cells[ageI]??"")    : "");
        const rating = String(ratingRaw).trim()===""?0:Number(ratingRaw);
        const rank   = String(rankRaw).trim()===""?0:Number(rankRaw);
        const age    = String(ageRaw).trim()===""?null:Number(ageRaw);
        out.push({
          id: (idI>=0 && cells[idI]) ? String(cells[idI]).trim() : qpm.uid(),
          href: norm,
          label: (labelI>=0 ? (cells[labelI]||"").trim() : "") || null,
          rating: Number.isFinite(rating)?rating:0,
          notes: (notesI>=0 ? (cells[notesI]||"") : ""),
          rank: Number.isFinite(rank)?rank:0,
          name: (nameI>=0 ? (cells[nameI]||"").trim() : "") || null,
          age: Number.isFinite(age)?age:null,
          badNotes: (badI>=0 ? (cells[badI]||"") : "")
        });
      }
      return out;
    }

    function saveLocal() {
      try { localStorage.setItem(qpm.STORAGE_KEY, JSON.stringify(qpm.items)); } catch {}
      const csv = toCSV(qpm.items);
      const st = qpm.getHostState();
      st.people = csv;
      qpm.setHostState(st);
    }

    function loadLocal() {
      try {
        const raw = localStorage.getItem(qpm.STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch { return null; }
    }

    function seedFromHostCSV() {
      const st = qpm.getHostState();
      const csv = typeof st.people === "string" ? st.people : "";
      if (!csv.trim()) return [];
      try { return parseCSV(csv); } catch { return []; }
    }

    function seedFromAnchors() {
      const seen = new Set(); const out = [];
      Array.from(document.querySelectorAll("a[href]")).forEach(a=>{
        const u = normalizeURL(a.getAttribute("href") || "");
        if(u && !seen.has(u)){
          seen.add(u);
          out.push({ id:qpm.uid(), href:u, label:a.textContent?.trim()||null, rating:0, rank:0, name:a.textContent?.trim()||null, age:null, notes:"", badNotes:"" });
        }
      });
      return out;
    }

    // ---------- Render rows ----------
    function render() {
      tbody.innerHTML = "";
      qpm.items.forEach((item, i) => {
        const tr = document.createElement("tr");
        tr.style.cssText = "border-bottom:1px solid rgba(39,52,73,0.8)";

        const td = () => {
          const el = document.createElement("td");
          el.style.cssText = "padding:10px;";
          return el;
        };

        // #
        { const t = td(); const s = document.createElement("span"); s.style.cssText="color:#94a3b8"; s.textContent=String(i+1); t.appendChild(s); tr.appendChild(t); }

        // URL
        { const t = td(); const a = document.createElement("a");
          a.href=item.href; a.target="_blank"; a.rel="noopener noreferrer";
          a.textContent=item.href;
          a.style.cssText="color:#60a5fa;text-decoration:underline dotted;text-underline-offset:4px;word-break:break-all";
          t.appendChild(a); tr.appendChild(t);
        }

        // Open
        { const t = td(); const b = document.createElement("button");
          b.textContent="↗";
          b.style.cssText="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0";
          b.onclick=()=>{const w=window.open(item.href,"_blank","noopener"); if(w) qpm.openStats.opened++; else qpm.openStats.blocked++;};
          t.appendChild(b); tr.appendChild(t);
        }

        // Name
        { const t = td(); const s = document.createElement("span"); s.style.cssText="color:#e5e7eb"; s.textContent=item.name ?? item.label ?? ""; t.appendChild(s); tr.appendChild(t); }

        // Age
        { const t = td(); const s = document.createElement("span"); s.style.cssText="color:#e5e7eb"; s.textContent=item.age ?? ""; t.appendChild(s); tr.appendChild(t); }

        // Rank
        { const t = td(); const wrap=document.createElement("div"); wrap.style.cssText="display:flex;align-items:center;gap:8px";
          const r=document.createElement("input"); r.type="range"; r.min="0"; r.max="10"; r.step="1";
          r.value = Number.isFinite(item.rank) ? String(item.rank) : "0";
          r.style.cssText="width:140px;accent-color:#84cc16";
          const v=document.createElement("span"); v.style.cssText="width:20px;text-align:right;color:#cbd5e1"; v.textContent=r.value;
          r.oninput=()=>v.textContent=r.value;
          r.onchange=()=>{ item.rank=Number(r.value)||0; saveLocal(); };
          wrap.append(r,v); t.appendChild(wrap); tr.appendChild(t);
        }

        // Rating
        { const t = td(); const n=document.createElement("input"); n.type="number"; n.min="1"; n.max="10"; n.step="1"; n.inputMode="numeric";
          n.placeholder="—"; n.value=(item.rating ?? 0) || "";
          n.style.cssText="width:90px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:6px 8px";
          n.onchange=()=>{ const val = n.value.trim()===""?0:Math.max(1,Math.min(10,Number(n.value))); item.rating=Number.isFinite(val)?val:0; saveLocal(); };
          t.appendChild(n); tr.appendChild(t);
        }

        // Bad Notes
        { const t = td(); const x=document.createElement("input"); x.type="text"; x.placeholder="Bad notes…"; x.value=item.badNotes ?? "";
          x.style.cssText="width:100%;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px";
          x.oninput=()=>{ item.badNotes=x.value; saveLocal(); };
          t.appendChild(x); tr.appendChild(t);
        }

        // Notes
        { const t = td(); const ta=document.createElement("textarea"); ta.rows=2; ta.placeholder="Notes…"; ta.value=item.notes ?? "";
          ta.style.cssText="width:100%;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px;resize:vertical";
          ta.oninput=()=>{ item.notes=ta.value; saveLocal(); };
          t.appendChild(ta); tr.appendChild(t);
        }

        // Actions
        { const t = td(); const b=document.createElement("button"); b.textContent="Delete";
          b.style.cssText="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#7f1d1d;color:#e2e8f0";
          b.onclick=()=>confirmBox("Delete row","Delete this row?",()=>{ qpm.items.splice(i,1); saveLocal(); render(); },false);
          t.appendChild(b); tr.appendChild(t);
        }

        tbody.appendChild(tr);
      });

      requestAnimationFrame(()=>{ try { QPM_colorRowsTROnly(); } catch {} });
    }

    // ---------- Buttons ----------
    btnSave.onclick  = () => { saveLocal(); infoBox("Save","Saved."); };

    // Progress helpers
    const setOverall = (total) => { showProgress(total); updateProgress(0,total,""); };
    const addOverall = (done,total,msg) => updateProgress(done,total,msg);

    const getAllPageLinks = () => {
      const set = new Set();
      const isIG = (u)=>{ try { return /(^|\.)instagram\.com$/i.test(new URL(u).hostname); } catch { return false; } };
      qpm.items.forEach(it=>{ const u = normalizeURL(it.href); if(u && isIG(u)) set.add(u); });
      Array.from(document.querySelectorAll("a[href]")).forEach(a=>{ const u=normalizeURL(a.getAttribute("href")||""); if(u && isIG(u)) set.add(u); });
      return Array.from(set);
    };

    const openList = async (hrefs,total) => {
      for (let i=0;i<hrefs.length;i++){
        const h = hrefs[i];
        if (!qpm.openTried.has(h)) {
          try { const w=window.open(h,"_blank","noopener"); qpm.openTried.add(h); if(w) qpm.openStats.opened++; else qpm.openStats.blocked++; }
          catch { qpm.openTried.add(h); qpm.openStats.errors++; }
        }
        addOverall(qpm.openTried.size, total, `Opened ${qpm.openStats.opened} | Blocked ${qpm.openStats.blocked} | Errors ${qpm.openStats.errors}`);
        if (i+1<hrefs.length) await new Promise(r=>setTimeout(r,1000));
      }
    };

    btnOpen.onclick = () => {
      const all = getAllPageLinks();
      confirmBox("Open All Links", `Open ${all.length} link(s)?\n1 per sec.`, async ()=>{
        setOverall(all.length);
        await openList(all, all.length);
        infoBox("Open All — Summary", `Requested: ${all.length}\nOpened: ${qpm.openStats.opened}\nBlocked: ${qpm.openStats.blocked}\nErrors: ${qpm.openStats.errors}`);
      }, true);
    };

    const segment = (k) => {
      const all = getAllPageLinks(); const total = all.length;
      const q = Math.floor(total/4), r=total%4; const bounds=[]; let s=0;
      for(let i=0;i<4;i++){ const extra=i<r?1:0; const len=q+extra; bounds.push([s,s+len]); s+=len; }
      const map={A:0,B:1,C:2,D:3}; return { total, slice: bounds[map[k]??0] };
    };

    const openPart = (k) => {
      const { total, slice:[s,e] } = segment(k);
      const list = getAllPageLinks().slice(s,e);
      confirmBox(`Open Part ${k}`, `Open ${list.length} / ${total} link(s) (indices ${s}–${e-1})?\n1 per sec.`, async ()=>{
        setOverall(total);
        await openList(list, total);
        infoBox(`Open Part ${k} — Summary`, `Segment size: ${list.length}\nOpened: ${qpm.openStats.opened}\nBlocked: ${qpm.openStats.blocked}\nErrors: ${qpm.openStats.errors}`);
      }, true);
    };

    btnA.onclick = ()=>openPart("A");
    btnB.onclick = ()=>openPart("B");
    btnC.onclick = ()=>openPart("C");
    btnD.onclick = ()=>openPart("D");

    btnImport.onclick = ()=>{ dlgImport.showModal(); dlgImport.querySelector("#qpm-csv-file").value=""; };
    btnExport.onclick = ()=>{
      const csv = toCSV(qpm.items);
      const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = `people-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
      a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      infoBox("Export CSV", `Exported ${qpm.items.length} row(s) to ${name}`);
    };
    btnAdd.onclick = ()=>dlgAdd.showModal();
    btnClear.onclick = ()=>{
      confirmBox("Clear All", "Clear all rows (localStorage)?", ()=>{
        qpm.items=[]; qpm.openTried.clear(); qpm.openStats={opened:0,blocked:0,errors:0}; saveLocal(); render(); infoBox("Clear","Cleared.");
      }, false);
    };
    btnClose.onclick = ()=>{ dlg.close(); root.style.display="none"; };

    // Import OK
    dlgImport.querySelector("#qpm-import-ok").addEventListener("click", async ()=>{
      const file = dlgImport.querySelector("#qpm-csv-file").files?.[0];
      if(!file){ infoBox("Import CSV","No file selected."); return; }
      const text = await file.text();
      const rows = parseCSV(text);
      const map  = new Map(qpm.items.map(x=>[x.href,x]));
      let add=0, upd=0;
      rows.forEach(r=>{
        const norm=normalizeURL(r.href); if(!norm) return;
        if(map.has(norm)){
          const prev=map.get(norm);
          const merged={
            id:prev.id, href:norm,
            label: (r.label ?? prev.label ?? null) || null,
            rating: Number.isFinite(r.rating)?r.rating:(prev.rating??0),
            notes:  (r.notes ?? prev.notes ?? ""),
            rank:   Number.isFinite(r.rank)?r.rank:(prev.rank??0),
            name:   r.name ?? prev.name ?? null,
            age:    Number.isFinite(r.age)?r.age:(prev.age??null),
            badNotes: (typeof r.badNotes==="string"?r.badNotes:(prev.badNotes??""))
          };
          const changed = JSON.stringify(merged)!==JSON.stringify(prev);
          map.set(norm, merged);
          if(changed) upd++;
        } else {
          map.set(norm, {
            id: r.id || qpm.uid(), href:norm, label:r.label ?? null,
            rating:Number.isFinite(r.rating)?r.rating:0,
            notes:r.notes ?? "", rank:Number.isFinite(r.rank)?r.rank:0,
            name:r.name ?? null, age:Number.isFinite(r.age)?r.age:null, badNotes:r.badNotes ?? ""
          });
          add++;
        }
      });
      qpm.items = Array.from(map.values());
      saveLocal(); render();
      infoBox("Import CSV", `Processed ${rows.length} rows\n+ Added ${add}\n+ Updated ${upd}\n= Total ${qpm.items.length}`);
    });

    // Add OK
    dlgAdd.querySelector("#qpm-add-ok").addEventListener("click", ()=>{
      const url  = dlgAdd.querySelector("#qpm-url-input").value.trim();
      const label= dlgAdd.querySelector("#qpm-title-input").value.trim();
      const norm = normalizeURL(url);
      if(!norm) { infoBox("Add URL","Invalid URL."); return; }
      if(qpm.items.some(i=>i.href===norm)){ infoBox("Add URL","Already exists."); return; }
      qpm.items.push({ id:qpm.uid(), href:norm, label:label||null, name:label||null, rating:0, rank:0, age:null, notes:"", badNotes:"" });
      saveLocal(); render(); infoBox("Add URL","Added.");
    });

    // ---------- Boot data ----------
    const persisted = loadLocal();
    if (persisted) {
      qpm.items = persisted.map(x=>({
        id:x.id ?? qpm.uid(),
        href: normalizeURL(x.href) || x.href,
        label: x.label ?? null,
        rating: Number.isFinite(x.rating)?x.rating:0,
        notes: x.notes ?? "",
        rank: Number.isFinite(x.rank)?x.rank:0,
        name: x.name ?? null,
        age: Number.isFinite(x.age)?x.age:null,
        badNotes: x.badNotes ?? ""
      }));
    } else {
      const fromHost = seedFromHostCSV();
      if (fromHost.length) qpm.items = fromHost;
      else {
        const fromAnch = seedFromAnchors();
        qpm.items = fromAnch.length ? fromAnch : [{
          id: qpm.uid(),
          href: "https://www.instagram.com/example/",
          label: "Example",
          rating: 0, rank: 0, name: "Example", age: 30, notes: "interested_unsent, maybe", badNotes: ""
        }];
      }
      saveLocal();
    }

    render();

    // Force background if ever transparent (safety repaint)
    requestAnimationFrame(()=>{
      document.querySelectorAll("#qpm-rows tr").forEach(tr=>{
        if (getComputedStyle(tr).backgroundColor === "rgba(0, 0, 0, 0)") {
          const notes = (tr.querySelector("td:nth-child(9) textarea")?.value || tr.querySelector("td:nth-child(9)")?.textContent || "").toLowerCase();
          const bg =
            /interested_unsent/.test(notes) ? "rgba(59,130,246,0.18)" :
            /private_second_unsent/.test(notes) ? "rgba(234,179,8,0.18)" :
            /private_want_to_see|private\b/.test(notes) ? "rgba(147,51,234,0.18)" :
            /maybe_unsent|(?:\b)maybe(?:\b)/.test(notes) ? "rgba(245,158,11,0.18)" :
            /doubt/.test(notes) ? "rgba(239,68,68,0.18)" :
            /interested/.test(notes) ? "rgba(34,197,94,0.18)" : "";
          if (bg) {
            tr.style.setProperty("background", bg, "important");
            tr.style.setProperty("background-color", bg, "important");
          }
        }
      });
    });

    // Run the hardcoded painter once (adds pills/vars/classes)
    try { QPM_applyHardcodedHighlights(); } catch {}
  }

  // Expose public API
  window.QCorePeopleManager = {
    QPeopleManagerView,
    QPM_colorRowsTROnly,
    QPM_applyHardcodedHighlights,
  };
})();
