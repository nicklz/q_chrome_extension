
(() => {
  'use strict';

  function stripCodeFences(txt) {
    txt = String(txt || "").trim();
    if (txt.startsWith("```")) {
      txt = txt.replace(/^```[a-zA-Z0-9_-]*\s*/, "");
      txt = txt.replace(/\s*```$/, "");
    }
    return txt.trim();
  }

  function tryParseJson(txt) {
    try { return JSON.parse(stripCodeFences(txt)); } catch { return null; }
  }

  function findChatGPTJsonCandidates() {
    const blocks = [];
    const selectors = [
      "pre code",
      "pre",
      "code",
      "article",
    ];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        const t = (el.innerText || el.textContent || "").trim();
        if (!t) continue;
        if (t.length < 2) continue;
        if (!(t.startsWith("{") || t.startsWith("[") || t.startsWith("```"))) continue;
        blocks.push(t);
      }
      if (blocks.length) break;
    }
    return blocks;
  }

  async function chatGPTDownloadFromArticles(opts = {}) {
    const Q = window.QCoreToolsModal || {};
    const modalFactory = Q.makeJsonDownloadModal;
    if (!modalFactory) throw new Error("QCoreToolsModal.makeJsonDownloadModal is not available.");

    const filename =
      opts.filename ||
      `chatgpt_${Math.floor(Date.now() / 1000)}.json`;

    const modal = modalFactory({
      title: "ChatGPT Download",
      subtitle: location.hostname,
      icon: "🤖",
      defaultFilename: filename,
    });
    modal.show();
    modal.setStatus("Scanning messages…");

    const candidates = findChatGPTJsonCandidates();
    if (!candidates.length) {
      modal.setStatus("No JSON-like blocks found.", "warn");
      return;
    }

    const parsed = [];
    for (const t of candidates) {
      const v = tryParseJson(t);
      if (v === null) continue;
      if (Array.isArray(v)) parsed.push(...v);
      else parsed.push(v);
    }

    if (!parsed.length) {
      modal.setStatus("Found blocks, but none parsed as JSON. Showing raw.", "warn");
      modal.textarea.value = stripCodeFences(candidates[0] || "");
      return;
    }

    modal.setJsonValue(parsed.length === 1 ? parsed[0] : parsed);
    modal.setStatus(`Ready: ${parsed.length} JSON value(s).`);
  }

  function __register() {
    const Q = window.QCoreToolsModal;
    if (!Q || typeof Q.registerTool !== "function") return false;

    Q.registerTool({
      id: "chatgpt",
      title: "ChatGPT Download",
      icon: "🤖",
      description: "Parse JSON from ChatGPT code blocks.",
      order: 250,
      onClick: () => { chatGPTDownloadFromArticles().catch(e => console.error(e)); },
    });

    try { Q.chatGPTDownloadFromArticles = chatGPTDownloadFromArticles; } catch {}
    return true;
  }

  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
