
(() => {
  'use strict';

  function stripCodeFences(txt) {
    txt = String(txt || "").trim();
    // ```json ... ```
    if (txt.startsWith("```")) {
      txt = txt.replace(/^```[a-zA-Z0-9_-]*\s*/, "");
      txt = txt.replace(/\s*```$/, "");
    }
    return txt.trim();
  }

  function tryParseJson(txt) {
    try {
      const cleaned = stripCodeFences(txt);
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }

  function extractInstagramUrls(txt) {
    const urls = [];
    const re = /https?:\/\/www\.instagram\.com\/[^\s"'<>]+/g;
    let m;
    while ((m = re.exec(txt)) !== null) urls.push(m[0]);
    return Array.from(new Set(urls));
  }

  async function grokDownloadScrape(opts = {}) {
    const Q = window.QCoreToolsModal || {};
    const modalFactory = Q.makeGrokDownloadModal || Q.makeJsonDownloadModal;
    if (!modalFactory) throw new Error("QCoreToolsModal.makeGrokDownloadModal is not available.");

    const filename =
      opts.filename ||
      `grok_${Math.floor(Date.now() / 1000)}.json`;

    const modal = modalFactory({
      title: "Grok Download",
      subtitle: location.hostname,
      icon: "🧩",
      defaultFilename: filename,
    });

    modal.show();
    modal.setStatus("Scanning blocks…");

    const pres = [...document.querySelectorAll('a[node="[object Object]"]')];
    if (!pres.length) {
      modal.setStatus("No <a> tags found.", "warn");
      return;
    }

    const out = [];
    let instagramUrls = [];

    for (let i = 0; i < pres.length; i++) {
      const raw = pres[i]?.innerText || pres[i]?.textContent || "";
      if (!raw.trim()) continue;

      instagramUrls = instagramUrls.concat(extractInstagramUrls(raw));

      let parsed = tryParseJson(raw);

      if (parsed === null) continue;

      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    }

    // If we didn't parse JSON but we did find IG URLs, export those.
    if (!out.length && instagramUrls.length) {
      instagramUrls = Array.from(new Set(instagramUrls));
      modal.setJsonValue({ urls: instagramUrls });
      modal.setStatus(`Extracted ${instagramUrls.length} Instagram URLs.`);
      return;
    }

    if (!out.length) {
      modal.setStatus("No JSON found in <a> tags.", "warn");
      return;
    }

    modal.setJsonValue(out);
    modal.setStatus(`Ready: ${out.length} item(s).`);
  }

  function __register() {
    const Q = window.QCoreToolsModal;
    if (!Q || typeof Q.registerTool !== "function") return false;

    Q.registerTool({
      id: "grok",
      title: "Grok Download",
      icon: "🧩",
      description: "Parse JSON from <a> blocks and download.",
      order: 230,
      onClick: () => { grokDownloadScrape().catch(e => console.error(e)); },
    });

    try { Q.grokDownloadScrape = grokDownloadScrape; } catch {}
    return true;
  }

  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
