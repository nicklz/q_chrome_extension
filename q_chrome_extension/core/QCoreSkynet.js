// skynet.js — thin orchestrator after modular split

// ---- Runtime constants (kept) ----
window.TOKEN_MAX        = 150000;
window.TOKEN_MAX_HALF   = 100000;
window.TOKEN_OVERMAX    = 100001;
window.HEARTBEAT        = 2000;

//console.log('[Q] QCoreSkynet.js LOADED', window)


// ---- Minimal bootstrap container ----
(function ensureRoot() {
  if (!document.getElementById('skynet-container')) {
    const container = document.createElement('div');
    container.id = 'skynet-container';
    const menu = document.createElement('div'); menu.id = 'menu';
    const main = document.createElement('div'); main.id = 'main-content';
    container.appendChild(menu); container.appendChild(main);
    document.body.appendChild(container);
  }
})();

// ---- Body classes / title (keep your behavior) ----
(function hydrateBody() {
  const state = window?.QCoreContent?.getState();
  if (!document.documentElement.classList.contains('nexus-platforms')) {
    document.documentElement.classList.add('nexus-platforms');
  }
  const classes = Array.from(document.body.classList).filter(c => !/^nexus-/.test(c));
  classes.push(
    `nexus-application-${state.application || 'unknown'}`,
    `nexus-status-${state.status || 'paused'}`,
    `nexus-mute-${!!state.mute}`,
    `nexus-alert-${state.alert || 0}`,
    `nexus-debug-${!!state.debug}`
  );
  document.body.className = classes.join(' ');
})();



// Build menu (kept async SVG fetch)
(async function buildMenu() {
    // ---- Menu: now delegates into QCore* plugins ---- 
    const menuIcons = [
        { emoji: '🤖', icon: null,                         title: 'Tools',          action: () => window.QCoreToolsModal?.showToolsModal() },
        {                 icon: 'images/terminal.svg',     title: 'Terminal',       action: () => window.QCoreTerminalModal?.showTerminalModal() },
        {                 icon: 'images/new.svg',          title: 'New',            action: () => window.QCoreTicketModal?.showNewTicket() },
        {                 icon: 'images/files.svg',        title: 'Files',          action: () => window.QCoreFilesModal?.showFilesModal() },
        {                 icon: 'images/configuration.svg',title: 'Configuration',  action: () => window.QCoreSettings?.showSettingsModal() },    
        {                 icon: 'images/documentation.svg',title: 'Documentation',  action: () => window.QCoreDocumentation?.showDocumentationModal() },
        {                 icon: 'images/automate.svg',     title: 'Automate',       action: () => awaitUser() },                   // optional workflow
        {                 icon: 'images/play.svg',         title: 'Play',           action: () => window.QCorePlayControls?.playState() },
        {                 icon: 'images/pause.svg',        title: 'Pause',          action: () => window.QCorePlayControls?.pauseState() },
        {                 icon: 'images/mute.svg',         title: 'Mute',           action: () => window.QCorePlayControls?.muteState() },
        {                 icon: 'images/restart.svg',      title: 'Restart',        action: () => window.QCorePlayControls?.restartAll()},
    ];
    
  const menu = document.getElementById('menu');
  menu.innerHTML = '';
  for (const { emoji, icon, title, action } of menuIcons) {
    const btn = document.createElement('button');
    btn.title = title;
    btn.className = 'menu-button';
    btn.id = 'menu-' + title.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');

    if (icon) {
      try {
        const svgUrl = chrome.runtime.getURL(icon);
        const res = await fetch(svgUrl);
        const svg = await res.text();
        const span = document.createElement('span');
        span.className = 'menu-icon';
        span.innerHTML = svg;
        btn.appendChild(span);
      } catch {
        btn.textContent = emoji || '';
      }
    } else {
      btn.textContent = emoji || '';
    }

    btn.addEventListener('click', action);
    menu.appendChild(btn);
  }
})();





// Optional: lightweight awaitUser driver (preserves your entry point; delegates to PromptChunker / PlayControls if needed)



    
async function awaitUser() {
  console.log('FLAG CHECK')
  if (checkFlag('flag_1')) {
      let emoji = getFlag('flag_1');
      console.log((`Flag 1 ${emoji}`, emoji))
  }

  let allFlags = getAllFlags();
  allFlags.forEach(flagId => {
      let emoji = getFlag(flagId);
      console.log(`Flag ${flagId} TEST: ${emoji}`,emoji);
  });

  
  let selected = null;
  let state = window?.QCoreContent?.getState();    

  // Get the hostname of the current website
  let hostname = window.location.hostname;

  // Extract the domain name before ".com" or remove all periods if ".com" is not present
  let applicationName;
  if (hostname.includes('.com')) {
      applicationName = hostname.split('.com')[0].split('.').pop().toLowerCase();
  } else {
      applicationName = hostname.replace(/\./g, '').toLowerCase();
  }

  console.log("HEY", applicationName);
  // Update the state object
  state.application = applicationName;
  console.log('awaitUser STARTED', {})
  const startTime = Date.now();
  const timeoutDuration = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

  console.log('awaitUser state', state)
  state.alert = 1;
  window?.QCoreContent?.setState(state)
  // Define the sequence of events
  let events = ['startup'];

  if (state.application === 'chatgpt') {
      events.push('get_response', 'documentation', 'get_response','enter_faas', 'click_run');
  } else if (state.application === 'sora') {
      events.push('send_prompt_loop');
  } else if (state.application === 'suno') {
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
      state = JSON.parse(localStorage.getItem('state')) || { status: 'paused', events: [] };
      console.log('awaitUser LOOP INDEX:' + currentEventIndex, state)
      if (state.status === 'play' || state.status === 'analysis' || state.status === 'idle' && state.locked !== true) {
          console.log('Running...');

          if (currentEventIndex >= events.length) {
              currentEventIndex = 1; // Loop back to 'enter_faas' and 'click_run'
          }

          const currentEvent = events[currentEventIndex];
          console.log(`Processing event: ${currentEvent}`);

          if (currentEvent === 'startup') {
              console.log('Startup event completed.');
              console.log('Clear old events');

              console.log('GETTING DOCUMENTATION')


              currentEventIndex++;
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
              if (!state.response) {
                  let response = await window?.QCorePromptChunker?.getResponse();
                  state.response = response;
                  window?.QCoreContent?.setState(state);
                  console.log(`getResponse: ${response}`);
                  currentEventIndex++;
              } else {
                  console.log('No response found in state. Skipping... [get_response]', [state, selected]);
                  let response = await window?.QCorePromptChunker?.getResponse();
                  console.log('wait', response)
                  currentEventIndex++;
              }
          }

          if (currentEvent === "send_prompt_loop") {
              console.log("Starting Sora prompt loop...");
              
              let promptTextarea = document.querySelector(".pointer-events-none textarea");

              if (!promptTextarea) {
                  promptTextarea = document.querySelector('textarea[placeholder^="Describe"]');
              }
              let createVideoButton = Array.from(document.querySelectorAll('button'))
                  .find(button => button.textContent.trim() === "Create") ||
                  Array.from(document.querySelectorAll('button'))
                  .find(button => button.textContent.trim() === "Remix");


              console.log('createVideoButton', createVideoButton)
              if (!promptTextarea || !createVideoButton) {
                  console.error("Required elements not found. Exiting...");
                  return;
              }
      
              if (!createVideoButton.disabled) {
                  console.log("Populating prompt...");
                  promptTextarea.value = state.prompt;
                  promptTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      
                  setTimeout(() => {
                      console.log('Clicking "Create video" button...');
                      createVideoButton.click();
      
                      setTimeout(() => {
                          console.log('"Create video" clicked successfully.');
                      }, 1000);
                  }, 1000);
              } else {
                  console.warn('"Create video" button is disabled. Exiting...');
              }
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

          if (currentEvent === 'regenerate_prompt') {

              window.QCoreDocumentation?.regeneratePrompt()();
              console.log(`regeneratePrompt`);
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
}

  // ---------- Export ----------
  window.QCoreSkynet = {
    awaitUser
  };




// ---- Done. Everything else (People Manager, Tools, Files, Tickets, Status, Prompt chunking, Queue I/O) lives in plugins/*.js ----
