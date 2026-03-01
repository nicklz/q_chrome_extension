
(() => {
  'use strict';

  function __register() {
    const Q = window.QCoreToolsModal;
    if (!Q || typeof Q.registerTool !== 'function') return false;

    async function openPeopleManager() {
      try {
        await Q.ensurePeopleManager();
      } catch (e) {
        console.warn("[PeopleManager] ensurePeopleManager failed:", e);
      }

      try {
        if (typeof window.QPeopleManagerView === "function") {
          window.QPeopleManagerView();
          return;
        }
      } catch {}

      try {
        if (window.QCorePeopleManager && typeof window.QCorePeopleManager.showPeopleManagerModal === "function") {
          window.QCorePeopleManager.showPeopleManagerModal();
          return;
        }
      } catch {}

      alert("People Manager plugin is not available on this page.");
    }

    Q.registerTool({
      id: "people_manager",
      title: "People Manager",
      icon: "👥",
      description: "Open the People Manager plugin.",
      order: 40,
      onClick: () => { openPeopleManager(); },
    });

    try { Q.openPeopleManager = openPeopleManager; } catch {}
    return true;
  }

  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
