// ============================================================================
// [Q] FILE HEADER — QCoreModalBase
// ============================================================================
// 📄 File: core/QCoreModalBase.js
// 🆔 QID: q_file_qcmb_1
//
// 🧠 ROLE IN SYSTEM
// QCoreModalBase is a shared, foundational modal utility used by all QCore*
// modules inside the Q Chrome Extension ecosystem. It provides a single,
// consistent, dependency-free mechanism for rendering modal dialogs into the
// browser DOM.
//
// This module is intentionally minimal and defensive. It guarantees:
// - Exactly one active modal at a time
// - Safe teardown and re-rendering
// - No reliance on external CSS or UI frameworks
//
// It serves as a UI primitive upon which higher-level QCore modules build
// inspection panels, confirmations, previews, warnings, and control surfaces.
//
// ---------------------------------------------------------------------------
// 🧱 SYSTEM LAYER
// - Browser Runtime (Chrome Extension / Content Script context)
// - Core UI Infrastructure
//
// ---------------------------------------------------------------------------
// 🧰 TECHNOLOGIES USED
// - Vanilla JavaScript (ES5-compatible IIFE pattern)
// - DOM APIs:
//   - document.createElement
//   - document.querySelector
//   - document.body.appendChild
//   - Element.remove
// - Window-global namespace registration (window.QCoreModalBase)
//
// ---------------------------------------------------------------------------
// 🧩 RELATED FILES / MODULES
// - core/QCore*.js
//   → All QCore modules depend on this file to render modal UI.
// - Chrome extension content scripts
//   → This file must be injected safely without polluting the host page.
//
// ---------------------------------------------------------------------------
// 🏗️ ARCHITECTURAL INTENT
// - Enforce singleton modal behavior to prevent overlay stacking
// - Self-contained inline styles to avoid host-site CSS collisions
// - Zero-build, zero-dependency runtime execution
// - Predictable API surface: showModal(title, contentBuilder)
//
// ---------------------------------------------------------------------------
// 📊 BUSINESS / PRODUCT ANALYSIS
// Why this file exists:
// - QCore tools frequently need to surface structured information to users
//   (diffs, logs, state inspection, confirmations).
// - Host pages are uncontrolled environments; CSS and JS isolation is critical.
// - Centralizing modal logic avoids duplication, drift, and inconsistent UX.
//
// Value delivered:
// - Stable, reusable modal UX across all QCore functionality
// - Reduced risk of DOM conflicts or broken overlays
// - Faster development of new QCore tools without UI scaffolding overhead
//
// ---------------------------------------------------------------------------
// 🔁 CONTROL FLOW OVERVIEW
// 1) Guard clause prevents duplicate initialization.
// 2) showModal removes any existing modal instance.
// 3) DOM nodes are created programmatically (overlay, card, header, controls).
// 4) Optional contentBuilder callback is executed inside a try/catch.
// 5) Modal is appended to document.body.
// 6) Close button removes the modal cleanly.
//
// ---------------------------------------------------------------------------
// 🧠 PUBLIC API
// window.QCoreModalBase = {
//   showModal(title: string, contentBuilder: function)
// }
//
// ---------------------------------------------------------------------------
// 🔐 SECURITY & SAFETY NOTES
// - No external input is executed as code.
// - contentBuilder is caller-controlled and wrapped in error handling.
// - No secrets, tokens, or QIDs are injected into the DOM by default.
//
// ---------------------------------------------------------------------------
// 📝 PATCH NOTES
// 🧩 Initial extraction of shared modal utility for QCore modules
// 🛡️ Defensive singleton guard to prevent duplicate injection
// 🧠 Inline styling to avoid host-page CSS interference
// 📎 Documentation expanded for auditability — no critical data is lost
//
// ---------------------------------------------------------------------------
// FINAL GUARANTEE
// no critical data is lost
// ============================================================================

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

