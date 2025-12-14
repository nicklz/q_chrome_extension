// plugins/QCorePromptChunker.js
(function () {
  // QCorePromptChunker — sendPrompt / getResponse (compact) + promptOvermax loop
  if (window.QCorePromptChunker) return;

  const setState = window?.QCoreContent?.setState || (s => localStorage.setItem('state', JSON.stringify(s)));

  const TOKEN_MAX = 150000;
  const TOKEN_OVERMAX = 100001;

  function findSendBtn() { return document.querySelector('button[data-testid="send-button"]'); }

  function sendPrompt(prompt) {
    console.log('🔵🔵🔵🔵🔵🔵🔵🔵 SEND PROMPT: ', prompt)
    const ta = document.querySelector('#prompt-textarea');

    
    if (!ta) return;
    ta.textContent = prompt;
    setTimeout(()=>findSendBtn()?.click(), 500);
  }


  async function getResponse() {
    console.log('getResponse FIRED');
  
    // Wait until the submit/stop button is NOT present (generation finished)
    while (document.querySelector('#composer-submit-button')) {
      console.log('[Q] - 🔹🔹🔹 Generating ...');
      await new Promise(r => setTimeout(r, 1000));
    }
  
    console.log('[Q] - 🟢🟢🟢🟢🟢🟢🟢🟢🟢 Generating FINISHED ! 🟢');
  
    // --- pause before extracting text ---
    await new Promise(r => setTimeout(r, 1000));
  
    let text = document.querySelectorAll('article')[
      document.querySelectorAll('article').length - 1
    ].textContent;
  
    // --- pause after extracting text ---
    await new Promise(r => setTimeout(r, 1000));
  
    console.log('getResponse RAW text', text);
  
    return text;
  }
  


  function promptOvermax() {
    setInterval(() => {
      const s = window?.QCoreContent?.getState();
      const ta = document.querySelector('#prompt-textarea');
      if (!ta) return;
      const text = ta.textContent || '';
      if (text.length > TOKEN_OVERMAX && s.locked !== true) {
        s.locked = true; setState(s);
        const half = Math.floor(TOKEN_OVERMAX / 2);
        const chunks = [];
        for (let i = 0; i < text.length; i += half) chunks.push(text.slice(i, i + half));
        (async () => {
          for (let i = 0; i < chunks.length; i++) {
            const tune = (i < chunks.length - 1) ? ' CHUNKED — reply OK' : ' FINAL — execute full prompt';
            sendPrompt(chunks[i] + tune);
            await new Promise(r => setTimeout(r, 1200));
          }
          const ns = window?.QCoreContent?.getState(); ns.locked = false; setState(ns);
        })();
      }
    }, 1000);
  }

  promptOvermax();

  window.QCorePromptChunker = { sendPrompt, getResponse, promptOvermax };
})();

