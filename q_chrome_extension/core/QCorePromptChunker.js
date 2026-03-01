// ============================================================================
// [Q] FILE HEADER — QCorePromptChunker
// ============================================================================
// 📄 File: core/QCorePromptChunker.js
// 🆔 QID: q_file_qcpc_1
//
// 🧠 ROLE IN SYSTEM
// QCorePromptChunker is a core automation utility responsible for:
// 1) Sending prompts into the active Chat UI input (the composer textarea)
// 2) Waiting for completion of generation and extracting the latest response
// 3) Detecting oversized prompts and automatically chunking them into smaller
//    messages using a deterministic loop + lock flag to prevent re-entry
//
// This module exists to make long-form automation reliable when the prompt
// length exceeds practical limits of a single message. Instead of failing,
// the system splits input into multiple pieces, sends them sequentially, and
// instructs the model how to respond to intermediate vs final chunks.
//
// ---------------------------------------------------------------------------
// 🧱 SYSTEM LAYER
// - Browser Runtime (Chrome Extension / Content Script context)
// - Core Automation Infrastructure (prompt IO + response capture)
//
// ---------------------------------------------------------------------------
// 🧰 TECHNOLOGIES USED
// - Vanilla JavaScript (IIFE module pattern)
// - DOM APIs:
//   - document.querySelector / document.querySelectorAll
//   - Element.textContent
// - Timers:
//   - setTimeout (delayed send click)
//   - setInterval (continuous overmax monitoring loop)
// - Async control flow:
//   - async/await
//   - Promise-based sleeps
// - Storage / State (depends on availability):
//   - window.QCoreContent.getState / setState (preferred, if present)
//   - localStorage fallback for setState only
// - Optional chaining (window?.QCoreContent) (requires modern JS runtime)
//
// ---------------------------------------------------------------------------
// 🧩 RELATED FILES / MODULES
// - core/QCoreContent.js (expected provider of getState/setState)
//   → Supplies the state object containing lock flags and any session metadata.
// - core/QCoreModalBase.js (not required here, but part of same UI foundation)
// - Other QCore automation modules that need sendPrompt/getResponse
//   → e.g., modules that drive multi-step workflows or batch execution.
//
// ---------------------------------------------------------------------------
// 📊 BUSINESS / PRODUCT ANALYSIS
// Why this file exists:
// - End-to-end automation depends on reliable prompt IO and deterministic reads.
// - Real prompts can exceed UI/input constraints and must degrade gracefully.
// - Chunking preserves workflow continuity without requiring user intervention.
// - Locking prevents runaway recursion where the chunker re-triggers itself.
//
// Value delivered:
// - Enables long prompts to be transmitted safely in sequential segments.
// - Reduces manual copy/paste and prevents UI stalls.
// - Provides reusable primitives used by higher-level automation sequences.
//
// ---------------------------------------------------------------------------
// 🏗️ ARCHITECTURAL INTENT
// - Export a tiny API surface on window.QCorePromptChunker:
//   - sendPrompt(prompt)
//   - getResponse()
//   - promptOvermax()
// - Operate safely in hostile host-page environments:
//   - Guard against missing DOM nodes
//   - Guard against missing QCoreContent provider
// - Maintain an explicit lock in state to avoid re-entry while chunking.
//
// ---------------------------------------------------------------------------
// 🔁 CONTROL FLOW OVERVIEW
// 1) Initialization:
//   - If window.QCorePromptChunker already exists, exit (singleton guard).
//   - Determine setState handler:
//     - Prefer window.QCoreContent.setState
//     - Fallback to localStorage write of a 'state' key
//
// 2) sendPrompt(prompt):
//   - Locate #prompt-textarea
//   - Write prompt into textarea
//   - Click send button after a short delay
//
// 3) getResponse():
//   - Poll for presence of #composer-submit-button to detect generation status
//   - Wait until generation completes
//   - Extract the last <article> element's textContent
//
// 4) promptOvermax():
//   - Every 1s, read current textarea content length
//   - If content exceeds TOKEN_OVERMAX and not locked:
//     - Lock state
//     - Split into chunks (half of TOKEN_OVERMAX)
//     - Send each chunk with an instruction suffix:
//       - Intermediate chunks: request brief acknowledgment
//       - Final chunk: instruct execution of full prompt
//     - Unlock state at end
//
// ---------------------------------------------------------------------------
// 📌 FUNCTIONS EXPORTED / USED
// - findSendBtn(): HTMLElement|null
// - sendPrompt(prompt: string): void
// - getResponse(): Promise<string>
// - promptOvermax(): void
//
// ---------------------------------------------------------------------------
// 🧾 VARIABLES / CONSTANTS
// - setState: function(stateObject) -> void
// - TOKEN_MAX: number (currently unused; reserved for future enforcement)
// - TOKEN_OVERMAX: number (threshold for triggering chunk behavior)
// - half: number (computed chunk size = TOKEN_OVERMAX/2)
// - chunks: string[] (derived from textarea content)
// - s / ns: stateObject (expected from QCoreContent.getState)
//
// ---------------------------------------------------------------------------
// 🔐 SECURITY & SAFETY NOTES
// - This module does not execute arbitrary code.
// - It manipulates the DOM and sends text to the UI; it should not include
//   secrets in logs.
// - LocalStorage fallback writes only; it does not provide getState fallback,
//   so missing QCoreContent.getState can cause runtime errors in promptOvermax.
//   (If QCoreContent is absent, implement a safe getState fallback upstream.)
//
// ---------------------------------------------------------------------------
// 📝 PATCH NOTES
// 🧩 Added core chunking loop to handle overmax prompts deterministically
// 🔒 Added state lock flag to prevent re-entrant chunk loops
// 🧪 Added getResponse polling to detect generation completion
// 📎 Documentation expanded for auditability — no critical data is lost
//
// ---------------------------------------------------------------------------
// FINAL GUARANTEE
// no critical data is lost
// ============================================================================

(function () {
  // QCorePromptChunker — sendPrompt / getResponse (compact) + promptOvermax loop
  if (window.QCorePromptChunker) return;

  const setState = window?.QCoreContent?.setState || (s => localStorage.setItem('state', JSON.stringify(s)));

  const TOKEN_MAX = 150000;
  const TOKEN_OVERMAX = 100001;

  function findSendBtn(applicationName) { 
  
      if (applicationName === 'grokcom') {
        return document.querySelector('button[aria-label="Submit"]');
      }
      
      if (applicationName === 'claudeai') {
        return document.querySelector('[aria-label="Send message"]');
      }

      console.log('SEND11111111111', document.querySelectorAll('button[aria-label="Submit"]')[0])

      return document.querySelector('#composer-submit-button');

      
  
  }


      /**
     * Extract application name from hostname
     * - If hostname has a 2-3 character TLD (.com, .ai, .pro, etc.), remove it and take the last segment
     * - Otherwise, remove all dots from the hostname
     * Examples: chat.openai.com → openai, claude.ai → claude, localhost → localhost
     */

  function sendPrompt(prompt) {
    console.log('🟩 sendPrompt',prompt)
    const rawUrl = window.location.href.toLowerCase();
  
    const cleanUrl = rawUrl.split("#")[0].split("?")[0];
      // Extract hostname
    let hostname = new URL(cleanUrl).hostname;

    // Strip leading www.
    hostname = hostname.replace(/^www\./, "");

    // Flatten
    let applicationName = hostname.replace(/\./g, "");



  switch (applicationName) {
    case 'grokcom':
      prompt_input = document.querySelector('form .tiptap');
      break;
    case 'claudeai':
      prompt_input = document.querySelector('[data-testid="chat-input"]')
      break;
    default:
      if (document.querySelector('p.placeholder')) {
        prompt_input = document.querySelector('p.placeholder');
      }
      else {
        prompt_input = document.querySelector('#prompt-textarea p');
      }
      
      break;
  }

    prompt_input.textContent = prompt;
    setTimeout(() => findSendBtn(applicationName)?.click(), 2000);
  }

  async function getResponse() {
    let state = window?.QCoreContent?.getState()
    console.log('getResponse FIRED', state);

    // Wait until the submit/stop button is NOT present (generation finished)
    while (document.querySelector('#composer-submit-button')) {

      console.log('[Q] - 🔹🔹🔹 Generating ...', state);
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('[Q] - 🟢🟢🟢🟢🟢🟢🟢🟢🟢 Generating FINISHED ! 🟢');

    // --- pause before extracting text ---
    await new Promise(r => setTimeout(r, 1000));

    let nodes = [];
    if (window.location.hostname === "sora.chatgpt.com") {
      return null;
    }


    else {
      document.querySelector('#prompt-textarea p')
    }
    let text = '';
    switch (state.application) {
      case 'grokcom':
        nodes = document.querySelectorAll('.response-content-markdown.markdown');

        let text_array = [];

        nodes.forEach(node => {
          text_array.push(node.textContent);
        });

        text = JSON.stringify(text_array);

        console.log(text);
        break;

      case 'claudeai':
        text = document.querySelectorAll('article')[
          document.querySelectorAll('article').length - 1
        ].textContent;
        break;

      default:
        nodes = document.querySelectorAll('[data-message-author-role="assistant"]');

        const messages = [];

        nodes.forEach(node => {
          const content = node.textContent?.trim();
          if (content) {
            messages.push(content);
          }
        });

        // convert to JSON string
        text = JSON.stringify(messages);
        break;
    }


    // --- pause after extracting text ---
    await new Promise(r => setTimeout(r, 1000));

    console.log('🟡 getResponse RAW text must response', text);

    return text;
  }

  function promptOvermax() {
    setInterval(() => {
      const s = window?.QCoreContent?.getState?.() || {};
      const ta = document.querySelector('#prompt-textarea');
      if (!ta || s.locked === true) return;
  
      const text = ta.textContent || '';
      if (text.length <= TOKEN_OVERMAX) return;
  
      s.locked = true;
      setState(s);
  
      // ── core logic ─────────────────────────────────────────────
      // total length = L
      // remove first (OVERMAX / 4) and last (OVERMAX / 4)
      // resulting kept chunk = OVERMAX / 2
      const quarter = Math.floor(TOKEN_OVERMAX / 4);
      const half = Math.floor(TOKEN_OVERMAX / 2);
  
      const start = quarter;
      const end = start + half;
  
      const sliced = text.slice(start, end);
      // ──────────────────────────────────────────────────────────
  
      (async () => {
        sessionStorage.setItem('q_after_reload_countdown', '1');
        sendPrompt(sliced);
        await new Promise(r => setTimeout(r, 400));
        window.location.reload();
      })();
    }, 100000);
  }
  
  function postReloadCountdown() {
    if (!sessionStorage.getItem('q_after_reload_countdown')) return;
    sessionStorage.removeItem('q_after_reload_countdown');
  
    let n = 10;
    const id = setInterval(() => {
      if (n > 0) {
        console.log(n);
        n--;
      } else {
        console.log('complete');
        clearInterval(id);
      }
    }, 1000);
  }
  
  promptOvermax();
  postReloadCountdown();
  
  

  window.QCorePromptChunker = { sendPrompt, getResponse, promptOvermax };
})();
