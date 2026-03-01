(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const safeNowIso = Q.safeNowIso || (() => new Date().toISOString());
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));

  function makeDashboardPanelUI() {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "margin-top:10px;border:1px solid #273449;border-radius:10px;padding:12px;background:linear-gradient(180deg,#0f1623 0%,#0b1117 100%);display:none;";

      const headerRow = document.createElement("div");
      headerRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap";
      wrap.appendChild(headerRow);

      const title = document.createElement("div");
      title.textContent = "Dashboard — Site Health";
      title.style.cssText = "font-weight:800;color:#93c5fd";
      headerRow.appendChild(title);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
      headerRow.appendChild(right);

      const meta = document.createElement("div");
      meta.textContent = "Last check: (never)";
      meta.style.cssText = "color:#94a3b8;font-size:12px";
      right.appendChild(meta);

      const refreshBtn = document.createElement("button");
      refreshBtn.textContent = "Refresh";
      refreshBtn.style.cssText =
        "padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:700;cursor:pointer";
      right.appendChild(refreshBtn);

      const totals = document.createElement("div");
      totals.style.cssText =
        "margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:#cbd5e1;font-weight:700";
      wrap.appendChild(totals);

      const list = document.createElement("div");
      list.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:8px";
      wrap.appendChild(list);

      function paintTotals(results) {
        const total = results.length;
        const green = results.filter((r) => r.status === "ok").length;
        const red = results.filter((r) => r.status === "fail").length;
        const yellow = results.filter((r) => r.status === "warn" || r.status === "checking").length;

        totals.textContent = "";
        const pill = (label, val, emoji) => {
          const d = document.createElement("div");
          d.style.cssText =
            "padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:#0f172a;font-size:12px";
          d.textContent = `${emoji} ${label}: ${val}`;
          totals.appendChild(d);
        };
        pill("Total", total, "🧮");
        pill("Up", green, "🟢");
        pill("Warn", yellow, "🟡");
        pill("Down", red, "🔴");
      }

      function paintList(results) {
        list.textContent = "";
        for (const r of results) {
          const row = document.createElement("div");
          row.style.cssText =
            "display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px;border:1px solid rgba(255,255,255,.08);background:#0f172a;border-radius:10px";
          const left = document.createElement("div");
          left.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:260px;flex:1";
          const top = document.createElement("div");
          top.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";

          const em = document.createElement("span");
          em.textContent = emojiForStatus(r.status);
          em.style.cssText = "font-size:16px";
          top.appendChild(em);

          const name = document.createElement("span");
          name.textContent = r.name;
          name.style.cssText = "font-weight:900;color:#e2e8f0";
          top.appendChild(name);

          const code = document.createElement("span");
          const hs = r.httpStatus != null ? String(r.httpStatus) : "";
          const ms = r.ms != null ? String(r.ms) + "ms" : "";
          const extra = [hs, ms].filter(Boolean).join(" • ");
          code.textContent = extra ? `(${extra})` : "";
          code.style.cssText = "color:#94a3b8;font-size:12px;font-weight:700";
          top.appendChild(code);

          left.appendChild(top);

          const a = document.createElement("a");
          a.href = r.url;
          a.textContent = r.url;
          a.target = "_blank";
          a.rel = "noreferrer";
          a.style.cssText = "color:#60a5fa;text-decoration:none;font-size:12px;word-break:break-all";
          left.appendChild(a);

          if (r.error) {
            const err = document.createElement("div");
            err.textContent = `Error: ${r.error}`;
            err.style.cssText = "color:#fca5a5;font-size:12px;font-weight:700";
            left.appendChild(err);
          } else if (r.status === "warn") {
            const warn = document.createElement("div");
            warn.textContent = "Warning: check may be blocked by CORS from this context (use background checker for definitive status).";
            warn.style.cssText = "color:#fcd34d;font-size:12px;font-weight:700";
            left.appendChild(warn);
          }

          row.appendChild(left);

          const rightCol = document.createElement("div");
          rightCol.style.cssText = "display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:180px";

          const openBtn = document.createElement("button");
          openBtn.textContent = "Open";
          openBtn.style.cssText =
            "padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:800;cursor:pointer";
          openBtn.onclick = () => {
            try {
              window.open(r.url, "_blank", "noopener,noreferrer");
            } catch {}
          };
          rightCol.appendChild(openBtn);

          const tgt = DASH_SITES.find((x) => x.name === r.name)?.target || "";
          if (tgt) {
            const t = document.createElement("div");
            t.textContent = tgt;
            t.title = tgt;
            t.style.cssText =
              "max-width:260px;text-align:right;color:#94a3b8;font-size:11px;font-weight:700;word-break:break-all";
            rightCol.appendChild(t);
          }

          row.appendChild(rightCol);
          list.appendChild(row);
        }
      }

      async function runCheck(originBtn) {
        try {
          if (originBtn) {
            originBtn.disabled = true;
            originBtn.textContent = "Dashboard Panel (checking…)";
          }
          meta.textContent = "Last check: checking…";
          const results = await checkSitesBestEffort(DASH_SITES, { timeoutMs: 9000, preferBackground: true });
          meta.textContent = `Last check: ${safeNowIso()}`;
          paintTotals(results);
          paintList(results);

          // Flash the origin button based on totals (all ok => green, any down => red, else yellow)
          const anyFail = results.some((r) => r.status === "fail");
          const anyWarn = results.some((r) => r.status === "warn" || r.status === "checking");
          if (originBtn) flashEmoji(originBtn, anyFail ? "🔴" : anyWarn ? "🟡" : "🟢");
        } catch (e) {
          meta.textContent = `Last check: failed (${safeNowIso()})`;
          if (originBtn) flashEmoji(originBtn, "🔴");
          console.error("[QCoreToolsModal] Dashboard check failed:", e);
        } finally {
          if (originBtn) {
            originBtn.disabled = false;
            originBtn.textContent = "Dashboard Panel";
          }
        }
      }

      refreshBtn.onclick = () => runCheck(null);

      return {
        el: wrap,
        runCheck,
        show() {
          wrap.style.display = "block";
        },
        hide() {
          wrap.style.display = "none";
        },
        isShown() {
          return wrap.style.display !== "none";
        },
      };
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "dashboard",
      title: "Dashboard Panel",
      icon: "📊",
      description: "Quick diagnostics + helper actions.",
      order: 60,
      onClick: () => {
        try {
          const api = QQ.createToolModal({
            id: "qcore_dashboard_panel_modal",
            title: "Dashboard Panel",
            subtitle: location.hostname,
            icon: "📊",
            width: 980,
            actions: [{ label: "Close", onClick: (m) => m.close() }],
          });
          const panel = makeDashboardPanelUI();
          try { panel.style.display = "block"; } catch {}
          api.body.appendChild(panel);
        } catch (e) { console.error(e); }
      },
    });
    try { QQ.makeDashboardPanelUI = makeDashboardPanelUI; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
