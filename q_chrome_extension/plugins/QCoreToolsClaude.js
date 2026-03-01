
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

  function findClaudeJsonCandidates() {
    // Claude UIs vary; prioritize explicit code blocks.
    const blocks = [];
    const selectors = [
      "pre code",
      "pre",
      "code",
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

  async function claudeDownloadFromCodeBlocks(opts = {}) {
    const Q = window.QCoreToolsModal || {};
    const modalFactory = Q.makeJsonDownloadModal;
    if (!modalFactory) throw new Error("QCoreToolsModal.makeJsonDownloadModal is not available.");

    const filename =
      opts.filename ||
      `claude_${Math.floor(Date.now() / 1000)}.json`;

    const modal = modalFactory({
      title: "Claude Download",
      subtitle: location.hostname,
      icon: "🧠",
      defaultFilename: filename,
    });
    modal.show();
    modal.setStatus("Scanning code blocks…");

    const candidates = findClaudeJsonCandidates();
    if (!candidates.length) {
      modal.setStatus("No candidate code blocks found.", "warn");
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
      modal.setStatus("Found code blocks, but none parsed as JSON.", "warn");
      // Still show raw for manual cleanup
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
      id: "claude",
      title: "Claude Download",
      icon: "🧠",
      description: "Parse JSON from Claude code blocks.",
      order: 240,
      onClick: () => { claudeDownloadFromCodeBlocks().catch(e => console.error(e)); },
    });

    try { Q.claudeDownloadFromCodeBlocks = claudeDownloadFromCodeBlocks; } catch {}
    return true;
  }

  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
