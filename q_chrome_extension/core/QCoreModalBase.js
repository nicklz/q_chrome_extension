// plugins/QCoreModalBase.js
(function () {
  // QCoreModalBase — shared modal helper used by all QCore* plugins
  if (window.QCoreModalBase) return;

  function showModal(title, contentBuilder) {
    const existing = document.querySelector('.nexus-modal');
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.className = 'nexus-modal';
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'background:rgba(0,0,0,.45)'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'max-width:1040px','margin:40px auto','border-radius:12px',
      'background:#0b1117','color:#cbd5e1','border:1px solid #273449',
      'box-shadow:0 10px 40px rgba(0,0,0,.5)','padding:16px','position:relative'
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px';

    const h2 = document.createElement('h2');
    h2.textContent = title || '[Modal]';
    h2.style.cssText = 'margin:0;color:#93c5fd;font-weight:800;';

    const close = document.createElement('button');
    close.className = 'close-button';
    close.textContent = 'Close';
    close.style.cssText = [
      'margin-left:auto','cursor:pointer','padding:6px 10px','border-radius:8px',
      'border:1px solid rgba(255,255,255,.08)','background:#1f2a3a','color:#e5e7eb','font-weight:700'
    ].join(';');
    close.addEventListener('click', () => wrap.remove());

    head.appendChild(h2);
    head.appendChild(close);
    card.appendChild(head);

    if (typeof contentBuilder === 'function') {
      try { contentBuilder(card); } catch (e) { console.error('[QCoreModalBase] contentBuilder error', e); }
    }

    wrap.appendChild(card);
    document.body.appendChild(wrap);
  }

  window.QCoreModalBase = { showModal };
})();

