/*  | [Q] CORE | QCoreTicketModal.js |
    ------------------------------------------------------------
    Role:
      Ticket editor modal + “Ticket Wizard” entrypoint (core UI surface).

    Expected UX:
      - Called by QCoreFilesModal “Create” OR “Open”.
      - One entrypoint handles both:
          openTicket(selectedOrId?)
      - Back-compat:
          showNewTicket(...) -> openTicket(...)
      - Always opens a modal (QCoreModalBase required; alerts if missing).

    Dependencies (optional):
      - window.QCoreContent.getState / setState
      - window.QCoreModalBase.showModal

    Guarantees:
      - Duplicate-load guard
      - Safe state read/write (non-throwing)
      - Works if state.tickets is missing (normalizes)
      - no critical data is lost
*/

(function () {
  'use strict';
  if (window.QCoreTicketModal) return;

  // ----------- shared shims (match codebase patterns) -----------
  const getState =
    (window?.QCoreContent && typeof window.QCoreContent.getState === 'function'
      ? window.QCoreContent.getState
      : () => {
          try { return JSON.parse(localStorage.getItem('state')) || { tickets: {} }; }
          catch { return { tickets: {} }; }
        });

  const setState =
    (window?.QCoreContent && typeof window.QCoreContent.setState === 'function'
      ? window.QCoreContent.setState
      : (s) => { try { localStorage.setItem('state', JSON.stringify(s)); } catch {} });

  const showModal =
    (window?.QCoreModalBase && typeof window.QCoreModalBase.showModal === 'function'
      ? window.QCoreModalBase.showModal
      : null);

  // ----------- small utilities (keep tight) -----------
  const S = (v) =>
    String(v == null ? '' : v)
      .replace(/[^a-zA-Z0-9\s,$.#@:_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function ensureTickets(state) {
    if (!state || typeof state !== 'object') state = {};
    if (!state.tickets || typeof state.tickets !== 'object') state.tickets = {};
    // scrub null entries (matches defensive style in QCoreContent.createTicket)
    try { for (const k of Object.keys(state.tickets)) if (state.tickets[k] == null) delete state.tickets[k]; } catch {}
    return state;
  }

  const hex4 = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const ticketId = () => `ticket_${Math.floor(Date.now() / 1000)}_${hex4()}`;

  function coerceSelected(x) {
    if (!x) return { mode: 'new', id: '', selected: null };
    if (typeof x === 'string') return { mode: 'edit', id: S(x), selected: null };
    if (typeof x === 'object') {
      const id = S(x.id || x.ticketId || x.key || '');
      return { mode: id ? 'edit' : 'new', id, selected: x };
    }
    return { mode: 'new', id: '', selected: null };
  }

  function getTicket(state, id) {
    try {
      const t = state?.tickets?.[id];
      return t && typeof t === 'object' ? t : null;
    } catch {
      return null;
    }
  }

  function normalizeDraft(d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      id: S(d.id || ''),
      status: S(d.status || 'open') || 'open',
      priority: S(d.priority || 'normal') || 'normal',
      summary: S(d.summary || ''),
      description: String(d.description == null ? '' : d.description),
      tags: Array.isArray(d.tags) ? d.tags.map(S).filter(Boolean).slice(0, 50) : [],
      createdAt: Number(d.createdAt || 0) || 0,
      updatedAt: Number(d.updatedAt || 0) || 0,
    };
  }

  function upsert(state, draft) {
    state = ensureTickets(state);
    const t = normalizeDraft(draft);
    if (!t.id) t.id = ticketId();

    const prev = state.tickets[t.id] || {};
    const createdAt = prev.createdAt ? Number(prev.createdAt) : (t.createdAt || Date.now());

    const next = Object.assign({}, prev, t, { createdAt, updatedAt: Date.now() });
    state.tickets[t.id] = next;
    return { state, ticket: next };
  }

  function del(state, id) {
    state = ensureTickets(state);
    try { if (id) delete state.tickets[id]; } catch {}
    return state;
  }

  function setLastSelection(state, t) {
    state = ensureTickets(state);
    try {
      state.lastTicketSelection = t
        ? { id: S(t.id || ''), status: S(t.status || ''), summary: S(t.summary || '') }
        : { id: '', status: '', summary: '' };
    } catch {}
    return state;
  }

  // ----------- modal UI (small, inline, no extra abstractions) -----------
  function ui(tag, text) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    return n;
  }
  function css(n, t) { n.style.cssText = t; return n; }
  function btn(label, cssText, onClick) {
    const b = ui('button', label);
    css(b, cssText);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  }

  function parseTags(raw) {
    return String(raw || '')
      .split(',')
      .map(S)
      .filter(Boolean)
      .slice(0, 50);
  }

  function render(modal, ctx) {
    const mode = ctx.mode;
    const t = normalizeDraft(ctx.ticket || {});
    const close = ctx.onClose;

    css(modal, 'white-space:normal');

    const head = ui('div');
    css(head, 'display:flex;align-items:center;gap:10px;margin-bottom:10px');

    const title = ui('div', mode === 'edit' ? 'Edit Ticket' : 'Create Ticket');
    css(title, 'font-weight:800;color:#93c5fd');

    const closeBtn = btn(
      'Close',
      'margin-left:auto;cursor:pointer;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#1f2a3a;color:#e5e7eb;font-weight:700',
      close
    );

    head.appendChild(title);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    const grid = ui('div');
    css(grid, 'display:grid;grid-template-columns:1fr 1fr;gap:10px');

    const field = (label, inputEl) => {
      const wrap = ui('div');
      const l = ui('label', label);
      css(l, 'display:block;color:#93c5fd;font-size:12px;margin-bottom:6px');
      wrap.appendChild(l);
      wrap.appendChild(inputEl);
      return wrap;
    };

    const baseInput = 'width:100%;padding:8px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;outline:none';
    const baseTa = baseInput + ';min-height:140px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;line-height:1.35';

    const id = document.createElement('input');
    id.value = t.id;
    css(id, baseInput);
    id.placeholder = 'auto-generated on save';
    if (mode === 'edit') id.disabled = true;

    const status = document.createElement('select');
    css(status, baseInput);
    ['open', 'in_progress', 'blocked', 'review', 'done'].forEach((s) => {
      const o = ui('option', s);
      o.value = s;
      if (t.status === s) o.selected = true;
      status.appendChild(o);
    });

    const priority = document.createElement('select');
    css(priority, baseInput);
    ['low', 'normal', 'high', 'urgent'].forEach((p) => {
      const o = ui('option', p);
      o.value = p;
      if (t.priority === p) o.selected = true;
      priority.appendChild(o);
    });

    const tags = document.createElement('input');
    tags.value = (t.tags || []).join(', ');
    css(tags, baseInput);
    tags.placeholder = 'ui, bug, infra';

    const summary = document.createElement('input');
    summary.value = t.summary;
    css(summary, baseInput);
    summary.placeholder = 'Short summary';

    const desc = document.createElement('textarea');
    desc.value = t.description || '';
    css(desc, baseTa);
    desc.placeholder = 'Details…';

    grid.appendChild(field('Ticket ID', id));
    grid.appendChild(field('Status', status));
    grid.appendChild(field('Priority', priority));
    grid.appendChild(field('Tags (comma-separated)', tags));
    grid.appendChild(field('Summary', summary));
    grid.appendChild(field('Description', desc));

    modal.appendChild(grid);

    const meta = ui('div', '');
    css(meta, 'margin-top:10px;color:#94a3b8;font-size:11px');
    modal.appendChild(meta);

    const footer = ui('div');
    css(footer, 'display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;flex-wrap:wrap');

    const msg = ui('div', '');
    css(msg, 'margin-right:auto;color:#93c5fd;font-size:12px;opacity:.9');

    const saveBtn = btn(
      'Save',
      'cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid rgba(59,130,246,.35);background:rgba(59,130,246,.25);color:#e5e7eb;font-weight:800',
      () => {
        try {
          let state = ensureTickets(getState());
          const draft = {
            id: S(id.value || ''),
            status: S(status.value || 'open') || 'open',
            priority: S(priority.value || 'normal') || 'normal',
            summary: S(summary.value || ''),
            description: String(desc.value == null ? '' : desc.value),
            tags: parseTags(tags.value || ''),
          };

          const beforeId = draft.id;
          const res = upsert(state, draft);
          state = res.state;

          state.QMoveToProject = true;
          state = setLastSelection(state, res.ticket);

          setState(state);

          if (!beforeId && res.ticket?.id) {
            id.value = res.ticket.id;
            id.disabled = true;
          }

          meta.textContent =
            `createdAt: ${res.ticket.createdAt ? new Date(res.ticket.createdAt).toLocaleString() : '—'}  •  ` +
            `updatedAt: ${res.ticket.updatedAt ? new Date(res.ticket.updatedAt).toLocaleString() : '—'}`;

          msg.textContent = 'Saved.';
          refreshDelete();
          console.log('[Q] QCoreTicketModal saved ticket', res.ticket);
        } catch (e) {
          console.log('[Q] QCoreTicketModal save error', e);
          msg.textContent = 'Save failed (see console).';
        }
      }
    );

    const deleteBtn = btn(
      'Delete',
      'cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid rgba(239,68,68,.32);background:rgba(239,68,68,.18);color:#e5e7eb;font-weight:800',
      () => {
        try {
          const tid = S(id.value || '');
          if (!tid) { msg.textContent = 'No ticket id to delete.'; return; }
          if (!confirm(`Delete ticket "${tid}"?`)) return;

          let state = ensureTickets(getState());
          state = del(state, tid);
          state = setLastSelection(state, null);
          setState(state);

          msg.textContent = 'Deleted.';
          console.log('[Q] QCoreTicketModal deleted ticket', tid);
          close();
        } catch (e) {
          console.log('[Q] QCoreTicketModal delete error', e);
          msg.textContent = 'Delete failed (see console).';
        }
      }
    );

    function refreshDelete() {
      const has = !!S(id.value || '');
      deleteBtn.style.display = has ? 'inline-block' : 'none';
    }

    refreshDelete();
    id.addEventListener('input', refreshDelete);

    footer.appendChild(msg);
    footer.appendChild(deleteBtn);
    footer.appendChild(saveBtn);
    modal.appendChild(footer);

    // shortcuts
    modal.addEventListener('keydown', (ev) => {
      try {
        if ((ev.ctrlKey || ev.metaKey) && String(ev.key || '').toLowerCase() === 's') { ev.preventDefault(); saveBtn.click(); }
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      } catch {}
    });

    // init meta + focus
    meta.textContent =
      `createdAt: ${t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}  •  ` +
      `updatedAt: ${t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '—'}`;

    setTimeout(() => { try { summary.focus(); } catch {} }, 0);
  }

  // ----------- entrypoint (Create + Open/Edit) -----------
  function openTicket(selectedOrId) {
    const sel = coerceSelected(selectedOrId);

    let state = ensureTickets(getState());
    state.QMoveToProject = true;

    let ticket;
    if (sel.mode === 'edit') {
      ticket = getTicket(state, sel.id) || (sel.selected ? Object.assign({}, sel.selected, { id: sel.id }) : null);
      if (!ticket) ticket = { id: sel.id, status: 'open', priority: 'normal', summary: '', description: '', tags: [] };
    } else {
      ticket = { id: '', status: 'open', priority: 'normal', summary: '', description: '', tags: [] };
    }

    state = setLastSelection(state, ticket);
    setState(state);

    if (typeof showModal !== 'function') {
      alert('[QCoreTicketModal] QCoreModalBase.showModal missing');
      return;
    }

    showModal('[Ticket]', (modalRoot) => {
      try { modalRoot.innerHTML = ''; } catch {}
      const close = () => { try { document.querySelector('.nexus-modal')?.remove(); } catch {} };
      render(modalRoot, { mode: sel.mode === 'edit' ? 'edit' : 'new', ticket, onClose: close });
    });
  }

  function showNewTicket(selected) { openTicket(selected); }
  function showEditTicket(selectedOrId) { openTicket(selectedOrId); }

  window.QCoreTicketModal = { openTicket, showNewTicket, showEditTicket };
})();
