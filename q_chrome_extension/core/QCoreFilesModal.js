// plugins/QCoreFilesModal.js
(function () {
  // QCoreFilesModal — “[Files]” popup (projects/tickets light shell)
  if (window.QCoreFilesModal) return;

  const showModal = (window.QCoreModalBase && window.QCoreModalBase.showModal) || ((t)=>alert('[QCoreFilesModal] '+t));
  const setState = window?.QCoreContent?.setState || (s => localStorage.setItem('state', JSON.stringify(s)));

  function showFilesModal() {
    const state = window?.QCoreContent?.getState();
    if (!state.tickets || typeof state.tickets !== 'object') { state.tickets = {}; setState(state); }

    showModal('[Files]', (modal) => {




      const ticketsTitle = document.createElement('h2');
      ticketsTitle.textContent = 'Tickets';
      ticketsTitle.style.cssText = 'color:#93c5fd;margin-top:12px';
      modal.appendChild(ticketsTitle);

      const entries = Object.entries(state.tickets).filter(([,t]) => t != null);
      if (!entries.length) {
        const none = document.createElement('div'); none.textContent = 'NO TICKETS'; none.style.cssText = 'opacity:.7;margin-bottom:10px'; modal.appendChild(none);
      } else {
        entries.forEach(([id, t], idx) => {
          const row = document.createElement('div'); row.style.cssText='display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap';
          const label = document.createElement('div'); label.textContent = `${idx+1}. ${id} — ${t.summary} [${t.status}]`; label.style.cssText='flex:1';
          const open = document.createElement('button');
          open.textContent = 'Open';
          open.style.cssText = 'padding:6px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08)';
          open.onclick = () => { (window.QCoreTicketModal && window.QCoreTicketModal.showNewTicket) ? window.QCoreTicketModal.showNewTicket(t) : alert('QCoreTicketModal not loaded'); };
          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.style.cssText = 'padding:6px 10px;border-radius:8px;background:#7f1d1d;color:#e2e8f0;border:1px solid rgba(255,255,255,.08)';
          del.onclick = () => { delete state.tickets[id]; setState(state); showFilesModal(); };
          row.appendChild(label); row.appendChild(open); row.appendChild(del); modal.appendChild(row);
        });
      }

      const create = document.createElement('button');
      create.textContent = 'Create Ticket';
      create.style.cssText = 'margin-top:10px;padding:8px 10px;border-radius:8px;background:#65a30d;color:#0b1117;border:1px solid rgba(255,255,255,.08);font-weight:800';
      create.onclick = () => { (window.QCoreTicketModal && window.QCoreTicketModal.showNewTicket) ? window.QCoreTicketModal.showNewTicket() : alert('QCoreTicketModal not loaded'); };
      modal.appendChild(create);
    });
  }

  window.QCoreFilesModal = { showFilesModal };
})();

