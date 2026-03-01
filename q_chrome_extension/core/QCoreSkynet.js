// skynet.js — thin orchestrator after modular split

// ---- Runtime constants (kept) ----
window.TOKEN_MAX        = 150000;
window.TOKEN_MAX_HALF   = 100000;
window.TOKEN_OVERMAX    = 100001;
window.HEARTBEAT        = 2000;

//console.log('[Q] QCoreSkynet.js LOADED', window)


(function ensureRoot() {
  const ID = 'skynet-container';

  function inject() {
    if (document.getElementById(ID)) return;

    const container = document.createElement('div');
    container.id = ID;

    const menu = document.createElement('div');
    menu.id = 'menu';

    const main = document.createElement('div');
    main.id = 'main-content';

    container.appendChild(menu);
    container.appendChild(main);

    document.body.appendChild(container);
  }

  function ensureInBody() {
    const el = document.getElementById(ID);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  }

  function start() {
    inject();
    ensureInBody();

    // React/Reddit protection
    new MutationObserver(() => {
      ensureInBody();
    }).observe(document.body, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();


// ---- Body classes / title (keep your behavior) ----
function hydrateBody() {
  let state = window?.QCoreContent?.getState();
  if (!state) {
    state = { status: 'paused', events: [], tickets: [] }
  }
  console.log(state);
  if (!document.documentElement.classList.contains('nexus-platforms')) {
    document.documentElement.classList.add('nexus-platforms');
  }
    const rawUrl = window.location.href.toLowerCase();
  
    const cleanUrl = rawUrl.split("#")[0].split("?")[0];
      // Extract hostname
    let hostname = new URL(cleanUrl).hostname;

    // Strip leading www.
    hostname = hostname.replace(/^www\./, "");

    // Flatten
    const applicationName = hostname.replace(/\./g, "");

    console.log("HEY", applicationName);
    state.application = applicationName;
    state.applicationName = applicationName;
    window?.QCoreContent?.setState(state)


  const classes = Array.from(document.body.classList).filter(c => !/^nexus-/.test(c));
  classes.push(
    `nexus-application-${state.applicationName || 'unknown'}`,
    `nexus-status-${state.status || 'paused'}`,
    `nexus-mute-${!!state.mute}`,
    `nexus-alert-${state.alert || 0}`,
    `nexus-debug-${!!state.debug}`
  );
  document.body.className = classes.join(' ');
};



// Build menu (kept async SVG fetch)
// NOTE: Click actions are bound by QCoreInit (core/QCoreInit.js).
// This file only renders the menu buttons to avoid double-binding (which can start Automate twice).
(async function buildMenu() {

  hydrateBody();

  const bindings = {
    'menu-tools':                () => window?.QCoreToolsModal?.showToolsModal,
    'menu-tickets':              () => window?.QCoreFilesModal?.showFilesModal,
    'menu-create-mvp':           () => window?.QCoreMVPModal?.showMVPModal,
    'menu-play':                 () => window?.QCorePlayControls?.playState,
    'menu-pause':                () => window?.QCorePlayControls?.pauseState,
    'menu-mutehide':             () => window?.QCorePlayControls?.muteState,
    'menu-restart':              () => window?.QCorePlayControls?.restartAll,
    'menu-generate-manifest':    () => window?.QCoreManifest?.bootFromManifest,
    'menu-automate':             () => window?.QCoreSkynet?.awaitUser,
    'menu-configuration':        () => window?.QCoreSettingsModal?.showSettingsModal,
    'menu-documentation':        () => window?.QCoreDocumentation?.showDocumentationModal,
  };

  const menuIcons = [
    { emoji: '🤖', icon: null, title: 'Tools' },
    { icon: 'images/terminal.svg', title: 'Generate Manifest' },
    { icon: 'images/new.svg', title: 'Create MVP' },
    { icon: 'images/files.svg', title: 'Tickets' },
    { icon: 'images/configuration.svg', title: 'Configuration' },
    { icon: 'images/documentation.svg', title: 'Documentation' },
    { icon: 'images/automate.svg', title: 'Automate' },
    { icon: 'images/play.svg', title: 'Play' },
    { icon: 'images/pause.svg', title: 'Pause' },
    { icon: 'images/mute.svg', title: 'MuteHide' },
    { icon: 'images/restart.svg', title: 'Restart' },
  ];

  const menu = document.getElementById('menu');
  if (!menu) return;

  menu.innerHTML = '';

  let index = 0;

  for (const { emoji, icon, title } of menuIcons) {

    const btn = document.createElement('button');
    btn.title = title;
    btn.className = 'menu-button';
    btn.id = 'menu-' + title.toLowerCase().replace(/\s+/g, '-');

    btn.disabled = true;
    btn.dataset.qcoreBind = 'pending';

    if (icon) {
      try {
        const svgUrl = chrome.runtime.getURL(icon);
        const res = await fetch(svgUrl);
        btn.innerHTML = await res.text();
      } catch {
        btn.textContent = emoji || '';
      }
    } else {
      btn.textContent = emoji || '';
    }

    // Immediate click binding (safe, resolves lazily)
    btn.addEventListener('click', () => {
      const getter = bindings[btn.id];
      if (!getter) return;

      const handler = getter();
      if (typeof handler === 'function') {
        handler.call(window);
      }
    });

    menu.appendChild(btn);

    // ---- Staggered enabling ----
    const getter = bindings[btn.id];

    if (getter) {
      const delay = btn.id === 'menu-tools' ? 1000 : index * 100;

      setTimeout(() => {
        const iv = setInterval(() => {
          const fn = getter();
          if (typeof fn === 'function') {
            btn.disabled = false;
            btn.dataset.qcoreBind = 'ready';
            clearInterval(iv);
          }
        }, 100);
      }, delay);
    }

    index++;
  }

})();

  // === QUEUE INTEGRATION (inline, no external helpers) ===


    
async function awaitUser() {
  // Re-entrancy guard: prevent multiple awaitUser loops (easy to accidentally double-start via duplicate click bindings).
  if (window.__QCORE_AWAIT_USER_RUNNING) {
    try { console.warn("[Q] awaitUser already running; ignoring duplicate call."); } catch {}
    return;
  }
  window.__QCORE_AWAIT_USER_RUNNING = true;
  try {

    console.log('FLAG CHECK')




    let selected = null;
    let state = window?.QCoreContent?.getState();    
    // chatgpt.com            → chatgptcom
    // openai.com             → openaicom
    // instagram.com          → instagramcom
    // distrokid.com          → distrokidcom
    // facebook.com           → facebookcom
    // blockchain.com         → blockchaincom
    // virginwifi.com         → virginwificom
    // google.com             → googlecom
    // runitbyq.com           → runitbyqcom
    // zillow.com             → zillowcom
    // flyfrontier.com        → flyfrontiercom
    // justice.gov            → justicegov
    // www.flyfrontier.com    → wwwflyfrontiercom
    // google.com             → googlecom
    // claude.ai              → claudeai
    // grok.com               → grokcom
    // sora.com               → soracom
    // sora.chatgpt.com       → sorachatgptcom
    // suno.com               → sunocom
    // spotify.com            → spotifycom

    const rawUrl = window.location.href.toLowerCase();

    // Remove hash + query
    const cleanUrl = rawUrl.split("#")[0].split("?")[0];

    // Extract hostname
    let hostname = new URL(cleanUrl).hostname;

    // Strip leading www.
    hostname = hostname.replace(/^www\./, "");

    // Flatten
    const applicationName = hostname.replace(/\./g, "");

    console.log("HEY", applicationName);
    state.application = applicationName;



    // END //

    console.log('awaitUser STARTED', {})
    const startTime = Date.now();
    const timeoutDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    console.log('awaitUser state', state)
    state.alert = 1;
    window?.QCoreContent?.setState(state)


    // Define the sequence of events
    let events = ['startup'];
    console.log('state.application !!!!!!!!!!!!!!!!!!!', state.application)
    if (state.application === 'chatgptcom') {
        events.push('send_prompt_loop_chatgpt');
    } else if (state.application === 'soracom' || state.application === 'sorachatgptcom') {
        events.push('send_prompt_loop_sora');
    } else if (state.application === 'grokcom') {
        events.push('send_prompt_loop_grok');
    } else if (state.application === 'claudeai') {
        events.push('send_prompt_loop_claude');
    } else if (state.application === 'sunocom') {
        events.push('startup');
    } else {
        console.warn('Unknown application. No events to process.', state);
        return;
    }
    

    // Helper function to wait
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Initialize the current event index
    let currentEventIndex = 0;

    while (Date.now() - startTime < timeoutDuration) {

      // Load the current state from localStorage
      state = window?.QCoreContent?.getState();    
      console.log('awaitUser LOOP INDEX:' + currentEventIndex, state)
      if (state.status === 'play' || state.status === 'analysis' || state.status === 'idle' && state.locked !== true) {
          console.log('Initializing...');
          console.log('Running Install..')

          if (currentEventIndex >= events.length) {
              currentEventIndex = 1; // Loop back to 'enter_faas' and 'click_run'
          }

          const currentEvent = events[currentEventIndex];
          console.log(`Processing event: ${currentEvent}`);

          if (currentEvent === 'startup') {

              console.log('Clear old events');
              currentEventIndex++;
              console.log('Startup event completed.');
          }

          if (currentEvent === 'documentation') {
              // Clear before run
              let state = window?.QCoreContent?.getState();
              if (state && state.events) {
                  state.events = [];
                  window?.QCoreContent?.setState(state);
              }
          

          

          }




          if (currentEvent === 'click_new') {
              const newButton = document.querySelector('#menu-new');
              if (newButton) {
                  newButton.click();
                  console.log('Clicked "New" button');
                  currentEventIndex++;
              } else {
                  console.log('No "New" button found. Retrying...');
                  await wait(1000);
                  continue;
              }
          }

          if (currentEvent === 'enter_prompt') {

              if (state.prompt) {
                  sendPrompt(state.prompt);
                  
                  console.log(`Sent prompt: ${state.prompt}`);
                  currentEventIndex++;
              } else {
                  console.log('No prompt found in state. Skipping... [enter_prompt]', [state, selected]);
                  promptTextarea = document.querySelector('#prompt-textarea');
                  if (promptTextarea) {
                      state.prompt = promptTextarea.textContent;
                      window?.QCoreContent?.setState(state);
                  }
                  else {
                      console.warn('prompt-textarea no on page, open project')
                  }
                  currentEventIndex++;
              }

              // logEvent({
              //     type: 'event',
              //     subtype: 'enter_prompt',
              //     tags: ['enter', 'prompt', 'generating'],
              //     message: 'prompt has been entered, generating',
              //     status: 'generating',
              // });
          }

          if (currentEvent === 'get_response') {
                  let response = await window?.QCorePromptChunker?.getResponse();
                  state.response = response;
                  window?.QCoreContent?.setState(state);
                  console.log(`getResponse: ${response}`);
                  currentEventIndex++;
          }
                    
        if (currentEvent === "send_prompt_loop_grok") {
            //
            if (!document.querySelector('[aria-label="Stop model response"]')) {
                await wait(1000);
                let ticket = window?.QCoreStatusLoop?.getActiveTicket(state);
                window?.QCorePromptChunker?.sendPrompt(ticket.description);
                await wait(10000);
            }



        }


            if (currentEvent === "send_prompt_loop_chatgpt") {
console.log(currentEvent, 'START');
            if (typeof Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'stop') === 'undefined' && typeof [...document.querySelectorAll('button')].find(btn => btn.textContent.trim() === 'Answer now') === 'undefined') {
                            console.log(currentEvent, 'STOP FOUND WAIT 1 SECOND');
              await wait(Math.floor(20000 + Math.random() * 1000));
              if (typeof Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'stop') === 'undefined' && typeof [...document.querySelectorAll('button')].find(btn => btn.textContent.trim() === 'Answer now') === 'undefined') {

              if (typeof !document.querySelector('[data-testid="stop-button"]')) {
                

                
              console.log(currentEvent);
                await wait(1000 + Math.random() * 1000);
                let ticket = window?.QCoreStatusLoop?.getActiveTicket(state);
                window?.QCorePromptChunker?.sendPrompt(ticket.description);
                await wait(10000);
              }
              else {
                console.log(currentEvent, 'STOP FOUND SKIP SECOND LAYER');
              }

            }
            else {
              console.log(currentEvent, 'STOP FOUND SKIP');
            }

            }


        }
        else {
          console.log(currentEvent, 'FAIL');
        }
                            
        if (currentEvent === "send_prompt_loop_claude") {
            //
            if (!document.querySelector('[aria-label="Stop model response"]')) {
                await wait(1000);
                let ticket = window?.QCoreStatusLoop?.getActiveTicket(state);
                window?.QCorePromptChunker?.sendPrompt(ticket.description);
                await wait(10000);
            }



        }



          if (currentEvent === "send_prompt_loop_sora") {
              console.log("Starting Sora prompt loop...");
              
              let promptTextarea = document.querySelector("textarea");

              if (!promptTextarea) {
                  promptTextarea = document.querySelector('textarea[placeholder^="Describe"]');
              }
       
              let ticket = JSON.stringify(window?.QCoreStatusLoop?.getActiveTicket(state).description);

              promptTextarea.value = ticket;
              
              const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  if (!promptTextarea) return;

  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;

  // 1️⃣ First click (human focus intent)
  promptTextarea.click();
  promptTextarea.focus();
  await sleep(120);

  // 2️⃣ Set value using native setter (important for React/Vue/etc)
  nativeSetter.call(promptTextarea, ticket);
  promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(120);

  // 3️⃣ Click again (reinforce focus like human adjusting cursor)
  promptTextarea.click();
  promptTextarea.focus();
  await sleep(100);

  // 4️⃣ Simulate pressing Space key (keydown → keypress → keyup)
  const spaceDown = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    keyCode: 32,
    which: 32,
    bubbles: true
  });

  const spacePress = new KeyboardEvent("keypress", {
    key: " ",
    code: "Space",
    keyCode: 32,
    which: 32,
    bubbles: true
  });

  const spaceUp = new KeyboardEvent("keyup", {
    key: " ",
    code: "Space",
    keyCode: 32,
    which: 32,
    bubbles: true
  });

  promptTextarea.dispatchEvent(spaceDown);
  promptTextarea.dispatchEvent(spacePress);
  promptTextarea.dispatchEvent(spaceUp);

  await sleep(80);

  // 5️⃣ Remove trailing space (optional cleanup so value stays exact)
  nativeSetter.call(promptTextarea, promptTextarea.value.trimEnd());
  promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
})();

              document.querySelectorAll('button').forEach(btn => {
                const label = btn.querySelector('.sr-only')?.textContent?.trim();
                
                if (label === "Create video") {
                    const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('data-disabled') === "true";
                    const isClickable = !isDisabled;

                    console.log("Create video button clickable:", isClickable);
                    btn.click();
                }
                });
          }

          if (currentEvent === 'enter_faas') {
              let faas = await generateFAAS(state);
              console.log(`push enter_faas`);
              events.push('click_run');

              const textField = document.querySelector('.faas-textarea');
              if (textField) {
                  textField.value = faas;
              } else {
                  console.log('Textfield with class "faas-textarea" not found.');
              }

              currentEventIndex++;
          }

          if (currentEvent === 'click_run') {
            let currentState = window?.QCoreContent?.getState();
        
            if (currentState.status !== 'in_progress') {
                // Safely append event
                currentState.events = Array.isArray(currentState.events) ? currentState.events : [];
                currentState.events.push('enter_faas');
                currentState.status = 'in_progress';
                window?.QCoreContent?.setState(currentState);
        
                const runButton = document.querySelector('button.run-button');
        
                if (runButton) {
                    runButton.click();
                    console.log('✅ Clicked Run button');
                    await wait(1000);
                    currentEventIndex++;
                } else {
                    console.log('⚠️ No Run button found. Retrying...');
                    await wait(1000);
                    return; // short-circuit retry cycle
                }
        
                // Safely update status to 'analysis' without wiping logs
                const latest = window?.QCoreContent?.getState();
                window?.QCoreContent?.setState({
                    ...latest,
                    status: 'analysis',
                    events: Array.isArray(latest.events) ? latest.events : currentState.events
                });
        
                console.log('🌶️ click_run transitioned to analysis', window?.QCoreContent?.getState());
        
                await wait(2000);
            }
        }
        

          // state = window?.QCoreContent?.getState();
          // // Update state and save it to localStorage
          // if(Array.isArray(state.events)) {
          //     console.log('Update state and save it to localStorage 🌶️', state)
          //     state.events.push({ event: currentEvent, timestamp: Date.now() });
          //     window?.QCoreContent?.setState(state)
          // }


          await wait(2000);
      } else if (state.status === 'paused') {
          console.log('Paused...');
          await wait(1000);
      } else {
          state.status = 'idle';
          window?.QCoreContent?.setState(state)
          console.log('Unknown state. Setting to Idle...', state);
          await wait(5000);
      }
  }

  // Log timeout and save the final state
  let finalState = JSON.parse(localStorage.getItem('state')) || { status: 'paused', events: [] };
  finalState.status = 'timed_out';
  finalState.events.push('AwaitUser function timed out after 7 days');
  localStorage.setItem('state', JSON.stringify(finalState));

  console.warn('AwaitUser finished copletely.');
  } finally {
    window.__QCORE_AWAIT_USER_RUNNING = false;
  }
}

  // ---------- Export ----------
  window.QCoreSkynet = {
    awaitUser
  };


