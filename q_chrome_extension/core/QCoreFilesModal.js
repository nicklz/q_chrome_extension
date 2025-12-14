// core/QCoreFilesModal.js
// [Q] QCoreFilesModal — Files popup (tickets index + quick open/delete/create)
// no critical data is lost
//
// Role:
// - Provides a lightweight “[Files]” modal that lists tickets stored in state.tickets
// - Allows Open (handoff to QCoreTicketModal), Delete (remove from state), Create Ticket (new ticket flow)
//
// System layer:
// - Browser runtime plugin (Chrome extension / injected script context)
// - Depends on window.QCoreModalBase.showModal (preferred) with alert() fallback
// - Reads/writes state via window.QCoreContent.getState / setState, with localStorage fallback for setState
//
// Tech stack:
// - Vanilla JS DOM creation
//
// Architectural context:
// - QCoreFilesModal is intentionally small; it is an index shell, not the full editor
// - Editing is delegated to QCoreTicketModal.showNewTicket(ticketObj)
//
// Public API:
// - window.QCoreFilesModal.showFilesModal()
//
// Important invariants:
// - state exists and is an object
// - state.tickets exists and is an object (created if missing)
// - ticket entries may be null/undefined; those are filtered out
//
// Error behavior:
// - If QCoreTicketModal is missing, Open/Create falls back to alert().
// - If state retrieval fails, modal still opens and bootstraps a minimal state.

(function () {
  // Prevent redefinition
  if (window.QCoreFilesModal) return;

  // ----------------------------
  // Dependencies / fallbacks
  // ----------------------------
  const showModal =
    (window.QCoreModalBase && window.QCoreModalBase.showModal) ||
    ((title) => alert("[QCoreFilesModal] " + title));

  const getState =
    (window?.QCoreContent && window.QCoreContent.getState) ||
    (() => {
      try {
        return JSON.parse(localStorage.getItem("state")) || {};
      } catch {
        return {};
      }
    });

  const setState =
    (window?.QCoreContent && window.QCoreContent.setState) ||
    ((s) => {
      try {
        localStorage.setItem("state", JSON.stringify(s));
      } catch {
        // swallow
      }
    });

  // ----------------------------
  // DOM helpers
  // ----------------------------
  function el(tag, text) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    return n;
  }

  function css(node, cssText) {
    node.style.cssText = cssText;
    return node;
  }

  function btn(label, cssText, onClick) {
    const b = el("button", label);
    css(b, cssText);
    b.onclick = onClick;
    return b;
  }

  // ----------------------------
  // State helpers
  // ----------------------------
  function ensureTicketsState(state) {
    // Defensive normalization: ensure state is a plain object
    if (!state || typeof state !== "object") state = {};
    if (!state.tickets || typeof state.tickets !== "object") state.tickets = {};
    return state;
  }

  function getTicketEntries(state) {
    const entries = Object.entries(state.tickets).filter(([, t]) => t != null);
    // Stable ordering: keep insertion order as-is (Object.entries), but you can sort if desired.
    return entries;
  }

  // ----------------------------
  // Logging helpers (Open button)
  // ----------------------------
  function safeStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return "[unserializable ticket: " + (e && e.message ? e.message : String(e)) + "]";
    }
  }

  function logOpenContext(ctx) {
    // This intentionally logs in split sections for readability in DevTools.
    // Each group is a compact “section” so you can collapse/expand.
    try {
      const groupTitle = `[QCoreFilesModal] OPEN ticket — ${ctx.indexDisplay} — ${ctx.ticketId}`;
      console.groupCollapsed(groupTitle);

      console.groupCollapsed("1) Ticket identity");
      console.log("ticketId:", ctx.ticketId);
      console.log("index:", ctx.index);
      console.log("indexDisplay:", ctx.indexDisplay);
      console.groupEnd();

      console.groupCollapsed("2) Ticket summary/status");
      console.log("summary:", ctx.summary);
      console.log("status:", ctx.status);
      console.groupEnd();

      console.groupCollapsed("3) Ticket object (raw reference)");
      console.log(ctx.ticket);
      console.groupEnd();

      console.groupCollapsed("4) Ticket JSON (stringified)");
      console.log(ctx.ticketJson);
      console.groupEnd();

      console.groupCollapsed("5) State snapshot (tickets count)");
      console.log("ticketsCount:", ctx.ticketsCount);
      console.groupEnd();

      console.groupCollapsed("6) Delegation target");
      console.log("QCoreTicketModal loaded:", ctx.hasTicketModal);
      console.log("showNewTicket available:", ctx.hasShowNewTicket);
      console.groupEnd();

      console.groupEnd();
    } catch (e) {
      console.log("[QCoreFilesModal] logOpenContext failed:", e);
    }
  }

  // ----------------------------
  // Render functions
  // ----------------------------
  function renderTitle(modal) {
    const ticketsTitle = el("h2", "Tickets");
    css(ticketsTitle, "color:#93c5fd;margin-top:12px");
    modal.appendChild(ticketsTitle);
  }

  function renderEmpty(modal) {
    const none = el("div", "NO TICKETS");
    css(none, "opacity:.7;margin-bottom:10px");
    modal.appendChild(none);
  }

  function renderTicketRow(modal, state, ticketId, ticketObj, idx, totalCount) {
    const row = el("div");
    css(row, "display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap");

    const summary = ticketObj && ticketObj.summary != null ? String(ticketObj.summary) : "";
    const status = ticketObj && ticketObj.status != null ? String(ticketObj.status) : "";

    const label = el("div", `${idx + 1}. ${ticketId} — ${summary} [${status}]`);
    css(label, "flex:1");

    const openButton = btn(
      "Open",
      "padding:6px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08)",
      () => {
        const hasTicketModal = !!window.QCoreTicketModal;
        const hasShowNewTicket = !!(window.QCoreTicketModal && window.QCoreTicketModal.showNewTicket);

        const ctx = {
          ticketId,
          index: idx,
          indexDisplay: `${idx + 1}/${totalCount}`,
          summary,
          status,
          ticket: ticketObj,
          ticketJson: safeStringify(ticketObj),
          ticketsCount: totalCount,
          hasTicketModal,
          hasShowNewTicket,
        };

        logOpenContext(ctx);

        if (hasShowNewTicket) {
          window.QCoreTicketModal.showNewTicket(ticketObj);
        } else {
          alert("QCoreTicketModal not loaded");
        }
      }
    );

    const deleteButton = btn(
      "Delete",
      "padding:6px 10px;border-radius:8px;background:#7f1d1d;color:#e2e8f0;border:1px solid rgba(255,255,255,.08)",
      () => {
        delete state.tickets[ticketId];
        setState(state);
        showFilesModal(); // rerender
      }
    );

    row.appendChild(label);
    row.appendChild(openButton);
    row.appendChild(deleteButton);
    modal.appendChild(row);
  }

  function renderCreateButton(modal) {
    const create = btn(
      "Create Ticket",
      "margin-top:10px;padding:8px 10px;border-radius:8px;background:#65a30d;color:#0b1117;border:1px solid rgba(255,255,255,.08);font-weight:800",
      () => {
        const hasShowNewTicket = !!(window.QCoreTicketModal && window.QCoreTicketModal.showNewTicket);
        if (hasShowNewTicket) {
          window.QCoreTicketModal.showNewTicket();
        } else {
          alert("QCoreTicketModal not loaded");
        }
      }
    );
    modal.appendChild(create);
  }

  // ----------------------------
  // Main entry
  // ----------------------------
  function showFilesModal() {
    let state = ensureTicketsState(getState());
    // Persist normalization if tickets was missing
    setState(state);

    showModal("[Files]", (modal) => {
      // Title
      renderTitle(modal);

      // Rows
      const entries = getTicketEntries(state);
      if (!entries.length) {
        renderEmpty(modal);
      } else {
        const totalCount = entries.length;
        entries.forEach(([ticketId, ticketObj], idx) => {
          renderTicketRow(modal, state, ticketId, ticketObj, idx, totalCount);
        });
      }

      // Create
      renderCreateButton(modal);
    });
  }

  // Export
  window.QCoreFilesModal = { showFilesModal };
})();
