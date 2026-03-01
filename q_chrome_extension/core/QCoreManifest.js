(function () {
  if (window.QCoreManifest) return;

  function parseManifestFromHash() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#Q_MANIFEST=')) return null;

    try {
      const json = decodeURIComponent(hash.replace('#Q_MANIFEST=', ''));
      return JSON.parse(json);
    } catch (e) {
      console.error('[Q] Failed to parse Q_MANIFEST', e);
      return null;
    }
  }

  function bootFromManifest() {
    const manifest = parseManifestFromHash();
    if (!manifest) return;

    console.log('[Q] Q_MANIFEST detected', manifest);

    let state = window?.QCoreContent?.getState() || {};
    state.manifest = manifest;
    state.status = 'analysis';

    window?.QCoreContent?.setState(state);

    // optional: clear hash
    history.replaceState(null, '', window.location.pathname);

    // trigger flow
    window?.QCoreSkynet?.awaitUser?.();
  }

  window.QCoreManifest = {
    bootFromManifest
  };

  // auto-run
  bootFromManifest();
})();
