/*  | [Q] Core | QCoreDocumentation.js |
    ------------------------------------------------------------
    Role:
      Documentation system that opens a modal with an embedded
      tutorial video (iframe). Works with QCoreModalBase when
      present; falls back to a minimal self-contained modal.

    Exports (module-only via window.QCoreDocumentation):
      - showDocumentationModal()

    Dependencies (optional):
      - window.QCoreContent.getState / setState
      - window.QCoreModalBase.showModal

    Guarantees:
      - Duplicate-load guard
      - Non-throwing safe shims
      - no critical data is lost
*/

(function () {
  'use strict';

  // Prevent duplicate load
  if (window.QCoreDocumentation) return;

  // ---------- Safe shims ----------
  const getState =
    (window?.QCoreContent && typeof window.QCoreContent.getState === 'function'
      ? window.QCoreContent.getState
      : () => {
          try {
            return JSON.parse(localStorage.getItem('state')) || { status: 'paused', events: [] };
          } catch {
            return { status: 'paused', events: [] };
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

  const showModal =
    (window?.QCoreModalBase && typeof window.QCoreModalBase.showModal === 'function'
      ? window.QCoreModalBase.showModal
      : (title, builder) => {
          const wrap = document.createElement('div');
          wrap.style.cssText =
            'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';

          const dlg = document.createElement('div');
          dlg.style.cssText =
            'width:min(900px,90vw);max-height:85vh;overflow:auto;background:#0b1117;color:#e5e7eb;border:1px solid #273449;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:16px';

          const h = document.createElement('div');
          h.textContent = title || '[Documentation]';
          h.style.cssText = 'font-weight:700;margin-bottom:8px;color:#93c5fd';

          const body = document.createElement('div');
          try {
            if (builder) builder(body);
          } catch (e) {
            const err = document.createElement('pre');
            err.textContent = String(e?.message || e);
            err.style.cssText =
              'white-space:pre-wrap;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:10px;border-radius:10px';
            body.appendChild(err);
          }

          const close = document.createElement('button');
          close.type = 'button';
          close.textContent = 'Close';
          close.style.cssText =
            'margin-top:12px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:#334155;color:#e2e8f0;font-weight:600;cursor:pointer';
          close.onclick = () => wrap.remove();

          dlg.append(h, body, close);
          wrap.appendChild(dlg);
          wrap.addEventListener('click', (e) => {
            if (e.target === wrap) wrap.remove();
          });

          document.body.appendChild(wrap);
        });

  // ---------- Modal ----------
  function showDocumentationModal() {
    const s = getState();
    try {
      s.alert = 1;
    } catch {}
    setState(s);

    showModal('[Documentation]', (modal) => {
      const frameWrap = document.createElement('div');
      frameWrap.style.cssText =
        'border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;background:#020617';

      const iframe = document.createElement('iframe');
      iframe.width = '100%';
      iframe.height = '400';
      iframe.src = 'https://www.youtube.com/embed/_fVsK02blGI?si=RZ-ELXBCbDLQI_qi';
      iframe.title = 'YouTube video player';
      iframe.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      iframe.style.cssText = 'display:block;border:0;width:100%;height:400px;background:#000';

      frameWrap.appendChild(iframe);
      modal.appendChild(frameWrap);
    });
  }

  // ---------- Export ----------
  window.QCoreDocumentation = {
    showDocumentationModal,
  };
})();
