
(() => {
  'use strict';

  function __register() {
    const Q = window.QCoreToolsModal;
    if (!Q || typeof Q.registerTool !== 'function') return false;

    function __buildPromptFromLocalStorage() {
      const dump = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          dump[k] = localStorage.getItem(k);
        }
      } catch {}
      return (
        "Analyze the following localStorage dump (QCoreToolsModal environment). " +
        "Return issues, risks, and actionable improvements.\n\n" +
        JSON.stringify(dump, null, 2)
      );
    }

    async function __sendPrompt(prompt) {
      // Prefer the existing chunker if present
      if (window.QCorePromptChunker && typeof window.QCorePromptChunker.sendPrompt === 'function') {
        await window.QCorePromptChunker.sendPrompt(prompt);
        if (typeof window.getResponse === 'function') return await window.getResponse();
        if (typeof window.QCorePromptChunker.getResponse === 'function') return await window.QCorePromptChunker.getResponse();
        return "(Sent prompt, but no getResponse() function is available.)";
      }
      throw new Error("QCorePromptChunker is not available on this page.");
    }

    function openAIConnectionModal() {
      const api = Q.createToolModal({
        id: "qcore_ai_connection_modal",
        title: "Tools AI Connection",
        subtitle: location.hostname,
        icon: "🤖",
        width: 980,
        actions: [
          { label: "Close", onClick: (m) => m.close() }
        ],
        onMount: (m) => {
          m.addSectionTitle("Prompt");
        }
      });

      const status = document.createElement("div");
      status.className = "qcoretm_kv";
      status.textContent = "Ready.";
      api.body.appendChild(status);

      const ta = document.createElement("textarea");
      ta.className = "qcoretm_textarea";
      ta.style.minHeight = "220px";
      ta.value = __buildPromptFromLocalStorage();
      api.body.appendChild(ta);

      const btnRow = document.createElement("div");
      btnRow.style.display = "flex";
      btnRow.style.gap = "10px";
      btnRow.style.flexWrap = "wrap";
      btnRow.style.marginTop = "10px";

      const sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "qcoretm_btn qcoretm_btnPrimary";
      sendBtn.textContent = "Send Prompt";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "qcoretm_btn";
      copyBtn.textContent = "Copy Response";

      const respPre = document.createElement("pre");
      respPre.style.whiteSpace = "pre-wrap";
      respPre.style.wordBreak = "break-word";
      respPre.style.marginTop = "12px";
      respPre.style.padding = "10px 12px";
      respPre.style.borderRadius = "12px";
      respPre.style.border = "1px solid rgba(0,0,0,.12)";
      respPre.style.background = "rgba(0,0,0,.04)";
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        respPre.style.border = "1px solid rgba(255,255,255,.12)";
        respPre.style.background = "rgba(255,255,255,.06)";
      }
      respPre.textContent = "";

      sendBtn.addEventListener("click", async () => {
        status.textContent = "Sending…";
        respPre.textContent = "";
        try {
          const response = await __sendPrompt(ta.value || "");
          status.textContent = "Done.";
          respPre.textContent = typeof response === "string" ? response : JSON.stringify(response, null, 2);
        } catch (e) {
          status.textContent = "Error.";
          respPre.textContent = e?.message || String(e);
        }
      });

      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard?.writeText?.(respPre.textContent || "");
          status.textContent = "Copied response to clipboard.";
        } catch {
          status.textContent = "Copy failed.";
        }
      });

      btnRow.appendChild(sendBtn);
      btnRow.appendChild(copyBtn);
      api.body.appendChild(btnRow);
      api.body.appendChild(respPre);

      // kick off
      setTimeout(() => { try { sendBtn.click(); } catch {} }, 50);

      return api;
    }

    Q.registerTool({
      id: "ai_connection",
      title: "Tools AI Connection",
      icon: "🤖",
      description: "Send local diagnostics to your AI connector.",
      order: 80,
      onClick: () => { try { openAIConnectionModal(); } catch (e) { console.error(e); } },
    });

    try { Q.openAIConnectionModal = openAIConnectionModal; } catch {}

    return true;
  }

  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
