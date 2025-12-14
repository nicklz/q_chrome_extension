/*  | [Q] PLUGIN | QCoreTicketModal.js |
    ------------------------------------------------------------
    Role:
      Ticket editor + “Ticket Wizard” entrypoint.
      Current implementation:
        - Sets a state flag (QMoveToProject) and persists it.
        - Accepts an optional selected ticket object (future use).

    Exports (module-only via window.QCoreTicketModal):
      - showNewTicket(selected?)

    Optional Dependencies:
      - window.QCoreContent.getState / setState
      - window.QCoreModalBase.showModal

    Guarantees:
      - Duplicate-load guard
      - Safe state read/write (non-throwing)
      - no critical data is lost
*/

(function () {
  'use strict';

  // Prevent duplicate load
  if (window.QCoreTicketModal) return;

  // ---------- Safe shims ----------
  const getState =
    (window?.QCoreContent && typeof window.QCoreContent.getState === 'function'
      ? window.QCoreContent.getState
      : () => {
          try {
            return JSON.parse(localStorage.getItem('state')) || { tickets: {} };
          } catch {
            return { tickets: {} };
          }
        });

  const setState =
    (window?.QCoreContent && typeof window.QCoreContent.setState === 'function'
      ? window.QCoreContent.setState
      : (s) => {
          try {
            localStorage.setItem('state', JSON.stringify(s));
          } catch {}
        });

  // Kept for planned UI flows; do not remove (used by future ticket wizard UI).
  const showModal =
    (window?.QCoreModalBase && typeof window.QCoreModalBase.showModal === 'function'
      ? window.QCoreModalBase.showModal
      : (title) => alert('[QCoreTicketModal] ' + String(title || '')));

  // ---------- utils ----------
  function sanitizeInput(input) {
    return String(input)
      .replace(/[^a-zA-Z0-9\s,$.#@-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * showNewTicket(selected?)
   * ------------------------------------------------------------
   * Purpose:
   *   Entry point invoked by QCoreFilesModal "Open/Create".
   *
   * Current behavior:
   *   - Sets state.QMoveToProject = true
   *   - Persists to storage
   *
   * Notes:
   *   - `selected` is accepted and sanitized for future use.
   *   - UI (modal) will be layered in next iterations; leaving
   *     showModal and sanitizeInput in place avoids churn.
   * no critical data is lost
   */
  function showNewTicket(selected = {}) {
    const state = getState();

    // Persist intent flag for downstream UI/router.
    state.QMoveToProject = true;

    // Normalize + keep a minimal “last selection” record for debugging.
    try {
      if (selected && typeof selected === 'object') {
        state.lastTicketSelection = {
          id: sanitizeInput(selected.id || ''),
          status: sanitizeInput(selected.status || ''),
          summary: sanitizeInput(selected.summary || ''),
        };
      } else {
        state.lastTicketSelection = { id: '', status: '', summary: '' };
      }
    } catch {}

    setState(state);
    console.log('[Q] QCoreTicketModal.showNewTicket state updated', state);

    // Placeholder: modal UI wiring point.
    // showModal('[Ticket]', (modal) => { ... });
  }

  // ---------- Export ----------
  window.QCoreTicketModal = { showNewTicket };
})();
