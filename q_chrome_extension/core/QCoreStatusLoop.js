// core/QCoreStatusLoop.js  (fix awaits, add sendImage, safe shims, and inline helpers)
(function () {
  if (window.QCoreStatusLoop) return;



  const isElementReady = window.isElementReady || ((attr, value) => {
    try {
      if (attr && value) return !!document.querySelector(`[${attr}="${value}"]`);
      return false;
    } catch { return false; }
  });

  const wait = window.wait || (ms => new Promise(r => setTimeout(r, ms)));

  // === QUEUE INTEGRATION (inline, no external helpers) ===
  const getActiveTicket = (s) => {
    if (!s || !s.tickets) return null;
    const title = typeof s.title === 'string' ? s.title : null;
    if (title && s.tickets[title] && typeof s.tickets[title].description === 'string' && s.tickets[title].description.trim() !== '') {
      return s.tickets[title];
    }
    for (const k in s.tickets) {
      const t = s.tickets[k];
      if (t && typeof t.description === 'string' && t.description.trim() !== '') return t;
    }
    return null;
  };

  // === QUEUE INTEGRATION (inline, no external helpers) ===
  // Purpose:
  //   Persist an updated ticket back into state.tickets,
  //   overwriting the existing entry atomically.
  //
  // Contract:
  //   - Accepts current state object `s`
  //   - Accepts a full `ticket` object (must include a stable key: title or id)
  //   - Mutates state via setState with a safe shallow copy
  //   - Guarantees tickets object integrity
  //   - No critical data is lost

  const setActiveTicket = (s, ticket) => {
    if (!s || !ticket || typeof ticket !== 'object') return;

    // Determine ticket key (prefer title, fallback to id)
    const key =
      typeof ticket.title === 'string' && ticket.title.trim() !== ''
        ? ticket.title
        : typeof ticket.id === 'string' && ticket.id.trim() !== ''
        ? ticket.id
        : null;

    if (!key) return;

    const nextState = {
      ...s,
      tickets: {
        ...(s.tickets || {}),
        [key]: {
          ...(s.tickets && s.tickets[key] ? s.tickets[key] : {}),
          ...ticket,
        },
      },
      title: key, // keep state.title in sync with active ticket
    };

    nextState.lockedOverride = true;
    nextState.locked = false;

    window?.QCoreContent?.setState(nextState);
    console.log(' 🦖 🦖 🦖 🦖 🦖 🦖 🦖 🦖 [Q][setActiveTicket] window?.?.setState success lockedOverride',[nextState,s]);

    nextState.lockedOverride = false;
    window?.QCoreContent?.setState(nextState);
    console.log(' 🦖 🦖 🦖 🦖 🦖 🦖 🦖 🦖 [Q][setActiveTicket] window?.?.setState success',[nextState,s]);
  };


  // -------------------- Image branch handler --------------------
  async function sendImage(state) {
    try {
      console.log('🖼️ [Q][IMAGE] sendImage start — state:', state, 'window:', window);
      if (!state.qImage || typeof state.qImage !== 'string' || !state.qImage.trim()) {
        console.log('🖼️ [Q][IMAGE] no qImage payload; skipping.');
        return state;
      }
      // Example handling: stash image event; real pipelines can hook here.
      state.events = state.events || [];
      state.events.push({ type:'Q_IMAGE', at: Date.now(), value: state.qImage });

      // If caller provided a file path via URL hash (e.g., Q_IMAGE_PATH), try to persist
      const hash = window.location.hash || '';
      const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
      const pathHint = params.get('Q_IMAGE_PATH'); // optional
      if (pathHint) {
        const qid = `q_image_${Date.now()}`;
        const content = state.qImage; // could be dataURL/base64/URL — upstream decides
        console.log('🖼️ [Q][IMAGE] attempting window?.QCoreQueueClient?.QNewTab', { qid, pathHint });
        try {
          await window?.QCoreQueueClient?.QNewTab(qid, pathHint, content, state);
          console.log('🖼️ [Q][IMAGE] window?.QCoreQueueClient?.QNewTab success');
        } catch (e) {
          console.warn('🖼️ [Q][IMAGE] window?.QCoreQueueClient?.QNewTab failed:', e?.message || e);
        }
      }
      state.lastImageProcessedAt = Date.now();
      console.log('🖼️ [Q][IMAGE] sendImage done.');
      return state;
    } catch (e) {
      console.error('🖼️ [Q][IMAGE] handler error:', e?.message || e);
      return state;
    }
  }
























  function qSanitizeContent(content = '', type = 'write') {
    // finally remove "Copy code" if it is at the start
    content = content.replace(/^Copy code/, '');
  
    // remove explicit "ChatGPT said" markers
    content = content.replace(/ChatGPT said:/g, '');
    content = content.replace(/ChatGPT said/g, '');
  
    // remove "Thought for Xs" at start — X is any chars before literal "s"
    content = content.replace(/Thought for .*s/g, '');
  
    // helper to escape regex special characters (like preg_quote in PHP)
    function escapeForRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  
    // remove all "xxxCopy code" prefixes for common file types
    const contentTypes = [
      'htmlCopy code',
      'jsonCopy code',
      'javascriptCopy code',
      'jsCopy code',
      'onCopy code',
      'phpCopy code',
      'cssCopy code',
      'bashCopy code',
      'sqlCopy code',
      'xmlCopy code',
      'yamlCopy code',
      'textCopy code',
      'dotenvCopy code',
      'typescriptCopy code',
    
      // new ChatGPT-style labels
      'makefileCopy code',
      'yamlCopy code',
      'ymlCopy code',
      'gitignoreCopy code',
      'textCopy code',        // for .example
      'markdownCopy code'     // for .md
    ];
  
    for (const t of contentTypes) {
      const re = new RegExp('^' + escapeForRegex(t), 'i');
      content = content.replace(re, '');
    }
  
    // remove common endings
    const endings = [
      'Is this conversation helpful so far?',
      'Updated saved memory'
    ];
  
    for (const e of endings) {
      const re = new RegExp(escapeForRegex(e), 'gi');
      content = content.replace(re, '');
    }
  
    return content;
  }
  










  // -------------------- generateQ (provided + integrated) --------------------
  async function generateQ(state) {





    let qid = window.QCoreQueueClient.currentQID();



    async function parseOrRecover(rawResponse) {
      console.log('parseOrRecover', rawResponse)
      if (typeof rawResponse !== 'string') return rawResponse;
    
      const leftBracket = rawResponse.indexOf('[');
      if (leftBracket === -1) return rawResponse;
    
      const hasBraceBefore =
        rawResponse.indexOf('{') !== -1 &&
        rawResponse.indexOf('{') < leftBracket;
    
      let out = rawResponse.slice(leftBracket);
    
      if (hasBraceBefore) out = '{' + out;
    
      return out;
    }
    
  
  
    async function parseOrRecoverFile(rawResponse) {
      console.log('parseOrRecoverFile', rawResponse)
    }
    
  
  






    console.log('generateQ STARTED');
    state.alert = 1;
    state.lockedOverride = true;
    state.status = 'generating';
    console.log('state.qPrompt !!!!!!!🥶🥶🥶🥶🥶🥶🥶🥶🥶', state.qPrompt);
          
    window?.QCoreContent?.setState(state);

    const maxRetries = 999999;
    const retryInterval = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (
          isElementReady('data-testid', 'composer-speech-button') ||
          isElementReady('data-testid', 'send-button')
        ) {
          // ----- main action -----
          state.prompt = '';

          if (!state.manifest && !state.qPromptSingleFileWrite) {
            state.prompt = `RULE: AVOID USING NON ALPHA NUMERIC NUMBERS DO NOT set 'content' to JSON OR STRUCTURED DATA ONLY A STRING.  IT IS AN ARRAY OF ITEMS AND VERY LONG BUT REMEMBER TO USE CODE FORMAT FOR THE JSON. I WANT YOU TO RESPOND WITH AS MANY ITEMS AS YOU CAN AND FOLLOW MY RULES. IF YOU NOTICE WE ARE JUST LOOPING FOREVER REDUNDANTLY END IT ALL BY SENDING AN EMPTY [] ARRAY OF 0 ITEMS BACK. ALSO IF THIS IS MID-PROCESS THEN CONTINUE WHERE YOU LEFT FROM MY LAST PROMPT KEEP GROWING THE LIST. IF THIS IS MY FIRST PROMPT START OVER IF THIS IS A NEW MANIFEST GENERATION THREAD. I WILL LOOP SENDING THIS SO KEEP GOING.  JUST MAKE SURE YOU HAVE EVERY FILE NEEDED LISTED. DO NOT USE FAAS GENERATE THE FULL FILE ASKED FROM THIS EXACT PROMPT WITH DOCUMENTATION AT THE HEADER OF THIS PROMPT IN ITS ENTIRETY WITH EACH FUNCTION OR METHOD FULLY FILLED OUT AND ANY RELATED FILES. AT THE TOP ALSO IS USAGE OF THIS FILE AND ITS FILETYPE AND LANGUAGE AND AUTHORING INFORMATION FROM Q USE CURRENT VERSION FROM MEMORY AT ALL TIMES.: ${state.prompt} ${state.qPrompt} General Requirements & Project Structure:


                            RETURN THE JSON FO A QID FORMAT qid increment from ${qid} and replace q_manifest with q_write unless its a bash q_command needed , filepath (string full pwd path with sandbox in the path), content (string)
                            WHEN YOU GENERATE THE README cover the list of commands for makefile and at top of readme try and re-sell the idea of the app from the original business proposal that was given to you, the original ticket, this is a marketing guys job so go full sales pitch on the idea a few paragraphs OK DO THIS WHEN GENERATING THE README + EXPAND UPON IT MARKDOWN FILE

                            ALSO DO NOT USE JS VITE UNLESS OVERRIDEN AND REQUESTED SPECIFICALLY JUST USE npm run start for react projects or node projects, run them through your makefile 


                            Database Tables & CRUD Operations:

                            Every database table should have:

                            Input Form: A form for creating and editing records.

                            Display Single View: A detailed page for viewing a single record.

                            Display List View: A table or list view for all records.

                            Search Filter Form: A form to search/filter records based on attributes, similar to how Drupal views work, enabling dynamic querying of records.

                            Makefile Structure & Shell Scripts:

                            The Makefile should include the following commands, each linked to an internal script for execution:

                            make install: Installs everything required to run the project from scratch. This includes verifying and installing Docker if it's not already installed. The script should check for the existence of Docker and install it if necessary.

                            Example:

                            # ./scripts/install.sh
                            if ! command -v docker &> /dev/null
                            then
                                echo "Docker not found, installing..."
                                # Docker installation steps
                            fi
                            docker-compose up -d  # Starts the services


                            make up: Starts all necessary services in the background. This will link to a script that launches all required Docker containers or services for the backend and frontend.

                            Example:

                            # ./scripts/up.sh
                            docker-compose up -d  # Starts all containers in detached mode


                            make restart: Restarts all services. This will shut down the running containers and then restart them.

                            Example:

                            # ./scripts/restart.sh
                            docker-compose down  # Stop services
                            docker-compose up -d  # Restart services


                            make deploy: Handles deployment by pulling the latest code, installing dependencies, and restarting services.

                            Example:

                            # ./scripts/deploy.sh
                            git pull origin main  # Pull latest code
                            make install  # Install dependencies
                            make restart  # Restart services


                            make down: Stops all running services without deleting data, linked to a script for gracefully shutting down containers.

                            Example:

                            # ./scripts/down.sh
                            docker-compose down  # Stop all services


                            make clean: Cleans up unused containers, networks, and volumes.

                            Example:

                            # ./scripts/clean.sh
                            docker system prune -f  # Removes unused containers, networks, and volumes


                            make clear: Clears logs and persistent data. This should remove any unnecessary cached or stored data to reset the environment.

                            Example:

                            # ./scripts/clear.sh
                            docker-compose down --volumes  # Stop containers and remove volumes


                            make test: Runs all unit, integration, and E2E tests for the project, using an automated script to trigger Jest for backend tests and Cypress/Playwright for frontend tests.

                            Example:

                            # ./scripts/test.sh
                            jest && cypress run  # Run backend unit tests and frontend E2E tests


                            make backup: Backs up the database and important files (such as configuration, logs).

                            Example:

                            # ./scripts/backup.sh
                            docker exec -t your-container pg_dump -U postgres your-database > ./backups/db-backup.sql  # Backup database


                            make sync: Syncs external data, such as pulling the latest sports data from an external API.

                            Example:

                            # ./scripts/sync.sh
                            node scripts/syncData.js  # Sync external data into the database


                            make export: Exports data (user data, transaction history, etc.) for backup or analysis.

                            Example:

                            # ./scripts/export.sh
                            node scripts/exportData.js  # Export user and transaction data


                            make download: Downloads necessary external assets or data sources.

                            Example:

                            # ./scripts/download.sh
                            node scripts/downloadAssets.js  # Download external assets or data

                            Modularization & Structure:

                            Frontend Structure:

                            Frontend Components should be modular, organized by feature (e.g., authentication, user profile, picks marketplace).

                            Use React Router for dynamic routing with support for user roles (admin, pro, user).

                            Styling: Use styled-components or CSS modules to ensure consistency and flexibility.

                            Backend Structure:

                            Modularize backend into separate controllers and services (e.g., user authentication, profile management, payment processing).

                            API Routes: Implement RESTful API routes to interact with the frontend and manage data.

                            Ensure that all routes are secure (role-based access control, JWT authentication).

                            Database Integration: Use a relational database (like MySQL) or NoSQL (MongoDB) to store data. Define tables with proper relations and queries.

                            Database Table Views (CRUD & Filtering):

                            Every database table must have an input form (to create and edit records), a single view (for displaying one record in detail), a list view (to display all records in a table), and a search/filter form (for querying records based on user-selected criteria).

                            This ensures flexibility in data interaction, allowing users to create, view, edit, and filter data efficiently.

                            Each of these views should be generated dynamically, meaning the application builds them internally based on the structure of the database and user requirements. Think of it like Drupal's Views module – rebuilding views each time ensures they are adaptable and customizable.

                            Testing and Coverage:

                            Unit Testing: Focus on testing individual backend services (Node.js with Jest or Mocha).

                            Integration Testing: Test interactions between components, APIs, and databases (using tools like Supertest).

                            End-to-End (E2E) Testing: Use Cypress or Playwright for frontend testing, simulating full user flows.

                            PHP Testing: For PHP, use PHPUnit for unit tests, and Codeception for integration and E2E testing.

                            Swift Testing: Use XCTest for unit tests, XCUITest for UI tests, and Appium for cross-platform E2E testing.

                            Project Agnostic Suggestions:

                            Data Sync & Integration:

                            Ensure that external data (such as sports data) is synchronized regularly with background workers like Bull or Agenda. This guarantees up-to-date data for your users.

                            Deployment & Environment Setup:

                            Always provide clear instructions for setting up local environments, especially when API keys or sensitive configurations are involved. Use .env.example and prompts for API keys to guide developers through the setup process.

                            Security:

                            Implement role-based access control for different user types (admin, pro, user). Protect sensitive data by validating and sanitizing all inputs and using HTTPS everywhere.

                            Store sensitive keys (such as API keys) securely in environment variables or a vault.

                            Scalability:

                            Design the backend to be stateless, ready for horizontal scaling. Use Redis for caching frequently accessed data and ensure that the app can scale as traffic grows.

                            Set up CDNs for serving static assets to optimize loading times globally.

                            Logging and Monitoring:

                            Use tools like Winston for logging backend activity and Sentry for tracking frontend errors. Make sure logging covers all critical user actions, errors, and system performance.

                            Testing Coverage:

                            Ensure all frontend and backend code is covered with unit tests, integration tests, and E2E tests. This will increase stability and reduce the likelihood of issues in production.`;
          }
          else {
            console.log("STATE LOOK FOR MANIFEST", state)
            if (!state.debug) {
              state.prompt = `${qid} THIS IS A Q_WRITE COMMAND [CHATGPT NAME THIS THREAD THE QID OF THIS PROCESS which read later is q_write_hash_0N++ where hash is the hash and N is the number ++ read this later token balance] MEANING YOU ARE TO FULLY AND THOROUGHLY GENERATE THE FILE BASED OFF THIS TEXT: ${state.prompt} ${state.qPrompt} GENERATE AS MUCH CODE WITH A FULL HEADER AND WRITE THE THIS VALUE IN HEADER: "doc title' ${document.title} AND 'qid of file' ${qid} WRITE ALL THE METHODS IN THE HEADER THAT YOU WILL WRITE IN THE FILE. WRITE ALL RELATED FILES IN THE HEADER BEFORE ANY INCLUDES. TRY TO AVOID INCLUDES AND USE AN INTERNAL STATE TO CONTROL EVERYTHING. WRITE THE CODE IN WHAT THE FILEPATH EXTENSION IS SO JS OR PHP OR JSON OR WRITE THE CODE TO THE PROPER FILE TYPE. GENERATE CORRECT QID FORMAT DO NOT JUST GIVE ME q_status_1 GENERATE IT UNIQUE IN THE Q_TYPE_HASH_NUMBER FORMAT THESE ARE MOSTYPE WRITE TYPES UNLESS COMMANDS ARE NEEDED TO STARTUP. WE NOW HAVE THE QID PREPROCESSED TAKE THE QID AND CHANGE MANIFEST TO WRITE AND INCREMENT THE 01++ AFTER FOR ALL NEW ITEMS KEEP INCREMENTING KEEP THE HASH FROM THE QID so q_write_hash_0N++ IS WHAT YOURE USING FOR THESE QID YOU GENERATE NOW IN THIS LIST. THE 'content' value is always a flat string never structured data
       






              START EVERY FILE WITH THIS FILE [Q] COMPRESSION HEADER
              /* =================================================================================================
              [Q] COMPRESSION HEADER (QC-HEADER)
              Standardized Middle-Out Compression Spec
              Version: 0.2
              
              ---------------------------------------------------------------------------------------------------
              PROJECT METADATA (MANDATORY – TOP OF FILE)
              ---------------------------------------------------------------------------------------------------
              FullFilePathPWD     <string>
              FileName:           <string>
              QID:                <string required from input generated / value must be maintained and carried over from prompt>
              ProjectName:        <string>
              Author:             <string>
              Date:               <YYYY-MM-DD>
              ContentType:        <code | book | json | database | logs | mixed>
              PrimaryLanguage:    <e.g., JavaScript | English | JSON | SQL | Mixed>
              FrameworkOrSchema: <e.g., React | Express | MySQL | Custom | None>
              Purpose:            <What this compressed header represents and how it should be used>
              
              ---------------------------------------------------------------------------------------------------
              SPECIFICATION METADATA
              ---------------------------------------------------------------------------------------------------
              SpecName:           Q_COMPRESSION
              SpecVersion:        0.2
              MaxSourceSize:      25MB (approximate)
              TargetHeaderSize:   100KB (tokens)
              CompressionModel:  Middle-Out, Iterative, Deterministic
              RehydrationGoal:   Deterministic reconstruction OR invariant-preserving regeneration
              
              ---------------------------------------------------------------------------------------------------
              0) CORE INTENT
              ---------------------------------------------------------------------------------------------------
              This header is a **compressed semantic representation** of a much larger corpus.
              
              The header must:
              - Represent up to ~25MB of source material
              - Fit within ~100KB of tokens
              - Preserve meaning, structure, intent, and navigability
              - Allow reconstruction OR equivalent regeneration
              
              The header is authoritative.
              The body is optional and may be partial, chunked, or omitted.
              
              ---------------------------------------------------------------------------------------------------
              1) SUPPORTED CORPUS TYPES
              ---------------------------------------------------------------------------------------------------
              This spec applies equally to:
              
              - Logic Code
                - functions, methods, modules
              - Narrative Text (Books, Articles, Scripts)
                - chapters are treated as functions
              - Structured Data (JSON, YAML)
                - objects/keys are treated as symbols
              - Databases (SQL, CSV, large tables)
                - schemas summarized; rows chunk-sampled and tagged
              - Logs / Repetitive Datasets
                - pattern-based summarization only
              
              The same compression rules apply; only the interpretation layer differs.
              
              ---------------------------------------------------------------------------------------------------
              2) MIDDLE-OUT COMPRESSION STRATEGY (CANONICAL)
              ---------------------------------------------------------------------------------------------------
              Compression is performed **iteratively**, not in one pass.
              
              Allowed operations:
              - Chunk sampling (do NOT read entire massive datasets)
              - Frequency analysis
              - Phrase / structure factoring
              - Rule-based regeneration
              - Semantic summarization
              
              Forbidden operations:
              - Silent data loss
              - Unlogged edits
              - Reordering without invariant declaration
              
              ---------------------------------------------------------------------------------------------------
              3) DATA HANDLING RULES BY CONTENT TYPE
              ---------------------------------------------------------------------------------------------------
              
              3.1 Narrative / Book Content
              - Chapters are treated as FUNCTIONS
              - Each chapter MUST have:
                - A short summary (≤4 lines)
                - Placed immediately ABOVE the chapter text
              - The summary functions as the “function comment”
              - Full chapter text MAY remain, be chunked, or be referenced externally
              
              3.2 JSON / Structured Files
              - Keys and schema are authoritative
              - Large arrays must NOT be fully read
              - Arrays are:
                - sampled
                - pattern-tagged
                - summarized
              - Repeating structures are replaced by rules
              
              3.3 Databases (MySQL / SQL)
              - Schema is fully preserved
              - Rows are NEVER fully ingested
              - Rows are:
                - chunked
                - statistically summarized
                - tagged by semantic meaning
              - Example:
                - “users table: ~4.2M rows, repeating pattern, fields X,Y,Z”
              
              3.4 Logs / Time-Series Data
              - No full ingestion
              - Only:
                - pattern detection
                - frequency bands
                - anomaly tags
                - time window summaries
              
              ---------------------------------------------------------------------------------------------------
              4) RECONSTRUCTION MODES
              ---------------------------------------------------------------------------------------------------
              ReconstructionMode: <Lossless | BehaviorPreserving | NarrativeEquivalent>
              
              Lossless:
              - Byte-accurate reconstruction possible
              
              BehaviorPreserving:
              - Interfaces, schemas, outputs preserved
              - Formatting may differ
              
              NarrativeEquivalent:
              - Meaning, structure, and intent preserved
              - Exact wording may differ unless marked canonical
              
              ---------------------------------------------------------------------------------------------------
              5) COMMENT & SUMMARY ENFORCEMENT
              ---------------------------------------------------------------------------------------------------
              All primary units MUST have comments:
              
              - Code → function header comments
              - Book → chapter summaries
              - JSON → object/schema summaries
              - Database → table summaries
              
              These summaries are:
              - Required
              - Logged
              - Mirrored in the index
              
              ---------------------------------------------------------------------------------------------------
              6) FUNCTION / CHAPTER COMMENT INDEX (MANDATORY)
              ---------------------------------------------------------------------------------------------------
              This index mirrors **all summaries** used in compression.
              
              Format:
              - UnitId:
                - Type: <function | chapter | object | table>
                - Name:
                - Location:
                - Summary:
                - Invariants:
                - References:
              
              This index is used for:
              - Navigation
              - Regeneration
              - Validation
              - Human audit
              
              ---------------------------------------------------------------------------------------------------
              7) SYMBOL & REWRITE MATRIX
              ---------------------------------------------------------------------------------------------------
              Repeated elements are replaced via a layered matrix:
              
              Levels:
              - Level 0: Canonicalization
              - Level 1: String Symbols
              - Level 2: Phrase Symbols
              - Level 3: Structural Chunks
              - Level 4: Generator Rules
              - Level 5: Residual Data
              
              All mappings MUST be logged.
              
              ---------------------------------------------------------------------------------------------------
              8) PATCH / CHANGE LOGGING (STRICT)
              ---------------------------------------------------------------------------------------------------
              Any change requires:
              - PatchId
              - Date
              - Author
              - Reason
              - Units affected
              - Invariants preserved
              
              No silent changes.
              No retroactive edits.
              
              ---------------------------------------------------------------------------------------------------
              9) RELATED FILES / DEPENDENCIES
              ---------------------------------------------------------------------------------------------------
              List all related:
              - Files
              - Schemas
              - APIs
              - External references
              
              Explain why each matters.
              
              ---------------------------------------------------------------------------------------------------
              10) VERIFICATION & INVARIANTS
              ---------------------------------------------------------------------------------------------------
              Each compressed corpus must declare:
              - What MUST remain true after reconstruction
              - What MAY vary
              - How to validate correctness
              
              ---------------------------------------------------------------------------------------------------
              11) GUARANTEE
              ---------------------------------------------------------------------------------------------------
              No critical data is lost.
              ================================================================================================= 
              
              do not be cheap on tokens give full file back wtih this header comments.*/

              


              
              `;
            }
            else {
              state.prompt = `THIS IS A Q_WRITE COMMAND [CHATGPT NAME THIS THREAD THE QID OF THIS PROCESS] MEANING YOU ARE TO IN DEBUG MODE SO WRITE A VERY BRIEF FILE: ${state.prompt} ${state.qPrompt} make sure to include QID in header but thats it.`;
            }
            
            
          }
          
          window?.QCorePromptChunker?.sendPrompt(state.prompt);


          // FINDME

          state.locked = true;
          window?.QCoreContent?.setState(state);
          console.log('🕐 Fetching response FINDME...', state);
          while (!document.querySelector('#composer-submit-button')) {
            console.log(`Attempt ${attempt}: Empty response received. Retrying...`);
            await wait(retryInterval);
            continue;
          }

          let rawResponse = await window?.QCorePromptChunker?.getResponse();
          rawResponse = qSanitizeContent(rawResponse)

          console.log('🕐 rawResponse ...', rawResponse);
          if (!rawResponse || !String(rawResponse).trim()) {
            console.log(`Attempt ${attempt}: Empty response received. Retrying...`);
            await wait(retryInterval);
            continue;
          }
          
          console.log('🕐 rawResponse...', rawResponse);
          state.locked = false;
          state.lockedOverride = true;
          window?.QCoreContent?.setState(state);


          console.log('🕐 state.lockedOverride = true ...', state);
          state.lockedOverride = false;
          window?.QCoreContent?.setState(state);
          console.log('🕐 state...', state);

          
          console.log('📥 Raw response received:', rawResponse);
          let parsed;
          try {
            console.log('🔍 Checking if JSON...');
            parsed = JSON.parse(rawResponse);
            console.log('✅ Parsed JSON successfully! 🎉');
            state.response = parsed;
          } catch (err) {
            console.log('⚠️ Not valid JSON. Treating as string. parseOrRecover ');

            if (typeof window.qid !== 'undefined' && window.qid) {
              console.log('window.qid EXISTS performing Q_WRITE');
              state.response = await parseOrRecoverFile(rawResponse);
            }
            else {
              console.log('attempting parseOrRecover...');
              state.response = JSON.parse(await parseOrRecover(rawResponse));            }

            console.log('⚠️ We have attempted to repair.', state.response);
            if (typeof rawResponse === 'string' && rawResponse.includes('qid')) {
              console.log('🆔 Found "qid" in string response!', rawResponse); 
              parsed = await window?.QCoreContent?.recoverManifest(rawResponse);
            } else {
              console.log('❌ No "qid" found in non-JSON string.');
              parsed = rawResponse;
            }
            state.response = parsed;
          }
          console.log('✅ Done processing response. 🚀');

          state.manifest = state.response;
          state.locked = false;
          state.lockedOverride = true;
          window?.QCoreContent?.setState(state);

          if (state.debug) {
            console.log('sendPrompt generateQ FINISHED', state.prompt);
          }

          console.log('getResponse generateQ FINISHED', state.response);
          console.log('✅✅✅ ... generateQ SUCCESS');
          return state;
        } else {
          console.log(`Attempt ${attempt}: Element not ready. Retrying...`);

          try {
            const selector = 'p[data-placeholder="Ask anything"].placeholder';
            const el = document.querySelector(selector);
          
            console.log('Found element:', el);
          
            if (el) {
              el.focus();
          
              const urlToPaste = window.location.href;
              console.log('Pasting URL:', urlToPaste);
          
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', urlToPaste);
          
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
              });
          
              el.dispatchEvent(pasteEvent);
            }
          } catch (err) {
            console.log('Error:', err);
          }
          
        }
      } catch (error) {
        console.error(`Attempt ${attempt}: An error occurred - ${error.message}`);
      }
      await wait(retryInterval);
    }

    state.alert = 1;
    state.lockedOverride = true;
    state.locked = false;
    console.log('state.qPrompt END ERROR !!!!!!!🥶🟧🥶', state.qPrompt);
          
    window?.QCoreContent?.setState(state);
    throw new Error('Failed to generate after maximum retries.');
  }

  // -------------------- Main loop (async, with awaited ops) --------------------
  async function tick(state) {

  
  //   if (state.QMoveToProject) {
  //     console.log("WE HERE")
  //     const btn = document.querySelector('button[data-testid="conversation-options-button"]');
  
  //     if (btn) {
  //       let rect = btn.getBoundingClientRect();
  //       const base = {
  //         bubbles: true,
  //         cancelable: true,
  //         composed: true,
  //         button: 0,
  //         clientX: rect.left + rect.width / 2,
  //         clientY: rect.top + rect.height / 2,
  //       };
    
  //       btn.dispatchEvent(new PointerEvent('pointerdown', {
  //         ...base,
  //         pointerId: 1,
  //         pointerType: 'mouse',
  //         isPrimary: true,
  //       }));
  //       btn.dispatchEvent(new MouseEvent('mousedown', base));
  //       btn.dispatchEvent(new MouseEvent('mouseup', base));
  //       btn.dispatchEvent(new MouseEvent('click', base));

        


  //     function loop() {
  //       console.log("FAST TICK");


  //        // # FUNCTION PATCH NOTES (hoverFirstRadixMenuItem):
  // // # - Adds a 100ms retry loop when the Radix popper wrapper is missing so no critical data is lost when menus mount slowly.

  // // Radix always wraps popper content in this attribute:
  // const wrappers = document.querySelectorAll('[data-radix-popper-content-wrapper]');

  // console.log("WRAPPERS:", wrappers);
  // if (wrappers.length > 0) {

  //   const wrapper = wrappers[0];

  //   console.log('WE GOT ONE!', wrapper);

  //   // // Find first menu item (role="menuitem" works across all Radix menus)
  //   // const firstItem = wrapper.querySelector('[role="menuitem"], [data-radix-collection-item]');
  //   // if (!firstItem) {
  //   //   console.warn("No menu items found");
  //   //   return;
  //   // }
  
  //   // // Compute coordinates for hover position
  //   // rect = firstItem.getBoundingClientRect();
  //   // const clientX = rect.left + rect.width / 2;
  //   // const clientY = rect.top + rect.height / 2;
  
  //   // const baseMouse = {
  //   //   bubbles: true,
  //   //   cancelable: true,
  //   //   composed: true,
  //   //   clientX,
  //   //   clientY,
  //   //   button: 0,
  //   //   buttons: 0
  //   // };
  
  //   // const basePointer = {
  //   //   ...baseMouse,
  //   //   pointerId: 1,
  //   //   pointerType: 'mouse',
  //   //   isPrimary: true
  //   // };
  
  //   // // Full hover event sequence
  //   // firstItem.dispatchEvent(new PointerEvent('pointerover', basePointer));
  //   // firstItem.dispatchEvent(new MouseEvent('mouseover', baseMouse));
  //   // firstItem.dispatchEvent(new PointerEvent('pointerenter', basePointer));
  //   // firstItem.dispatchEvent(new MouseEvent('mouseenter', baseMouse));
  
  //   // console.log('hovered first menu item:', firstItem);
  // }



  //       setTimeout(loop(), 1000);
  //     }
      
  //     loop();
      
   

  //     }









  //   }
  









    let qid = window.QCoreQueueClient.currentQID();
    let ticket = getActiveTicket(state);

    console.log('[Q] - 🤖 qid:', qid);

    if (window.QCoreStatusPanel?.updateStatus) window.QCoreStatusPanel.updateStatus(state);

    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

    // Preload global state (needed by both branches)
    let globalState = await window?.QCoreContent?.getGlobalState();


    state.manifest = null;

    // Read Q_WRITE / Q_MANIFEST
    state.qPrompt = params.has('Q_MANIFEST')
      ? params.get('Q_MANIFEST')
      : (params.has('Q_WRITE') ? params.get('Q_WRITE') : null);

    // Read Q_MANIFEST only (Q_WRITE ignored here by design)
    const qManifest = params.has('Q_MANIFEST') ? params.get('Q_MANIFEST') : null;

    // if and only if Q_MANIFEST is set to a string with a length, setActiveTicket
    if (typeof qManifest === 'string' && qManifest.length > 0) {
      state.qPrompt = qManifest;

      // load the active ticket, replace .description, save it as-is
      const active = getActiveTicket(state);
      if (active) {
        setActiveTicket(state, {
          ...active,
          description: qManifest,
          updatedAt: Date.now(),
        });

        state.locked = true;
      }
    }



    if (params.has('Q_MANIFEST')) {
      state.qPromptSingleFileWrite = 0;
      state.manifest = params.get('Q_MANIFEST');

      if (params.get('Q_MANIFEST').length < JSON.stringify(ticket || {}).length) {
        state.manifest = ticket;
      }
    }

    if (!state.manifest) {
      state.qPromptSingleFileWrite = 1;
    }

    if (params.has('Q_WRITE')) {
      state.qPromptSingleFileWrite = 1;
      state.qPrompt = params.get('Q_WRITE');
    }


    if (state.debug) {
      console.log('Q_MANIFEST PARAM $state', state);
    }
    

    // ---- Q_IMAGE early branch
    if (params.has('Q_IMAGE')) {
      state.qImage = params.get('Q_IMAGE');
      state.qPrompt = null;
      state.qPromptSingleFileWrite = 0;
      if (state.debug) console.log('Q_IMAGE PARAM 🟣 $state', state, 'window:', window);

      state = await sendImage(state);

      globalState.state = state;
      await window?.QCoreContent?.setGlobalState(globalState);
      window?.QCoreContent?.setState(state);
      if (state.debug) console.log('UPDATE STATE end (image branch)', state);
      return state;
    }

    state.run_count = (state?.run_count ?? 0) + 1;
    if (state.debug) console.log('UPDATE STATE start', state);

    let response = 'error';
    let output = null;
    

    if (!ticket) {
      if (state.debug) console.log('TICKET EMPTY NOT FOUND ADD? MAYBE BUG', ticket);
      // try pulling from global
      if (globalState?.state?.tickets) state.tickets = globalState.state.tickets;
      ticket = getActiveTicket(state);
    } else {
      if (state.debug) console.log('TICKET FOUND', ticket);
    }

    // Only run once per load and only if not locked
    console.log('manifest loop', 0);
    if (!state.locked) {
      console.log('manifest loop 1', state);

      if (typeof state.qPrompt !== 'string' || state.qPrompt.trim() === '') state.qPrompt = null;

      if (state.qPrompt) {
        // Split by "|" into [qid, filepath, ...content]
        let parts = [];
        let qid = window.document.title;
        let filepath = null;
        let content = null;
        console.log('manifest loop 2', state);
        if (!state.manifest) {
          parts = state.qPrompt.split('|').map(p => (typeof p === 'string' ? p.trim() : ''));
          qid = parts[0].trim();
          filepath = parts[1] || null;
          content = parts.length > 2 ? parts.slice(2).join('|').trim() : null;
        } else {

          let tune = 'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. GIVE FULL FILE PATH BASED OFF DOCROOT STARTING WITH ./sandbox/ FOR ALL FILES LIKE ./sandbox/.README - FOCUS ON TOTAL FILES MUST BE OVER 100 IN MOST CASES THIS IS A AUTOMATED SYSTEM AS WELL PUSH TOKEN LIMIT. RETURN A JSON LIST ITEMS OF QID,FILEPATH,CONTENT so {qid, filepath, content} THE QID MUST ALWAYS BE UNIQUE BY INCREMENTING THE LAST NUMBER !! ALSO UNLESS ITS FOR THE MANIFEST DONT CALL IT MANIFEST THE MANIFEST IS A JSON OF ALL THE FILE NAMES KEEP THAT STATIC THIS FILE SHOULD BE something unique but keep the q_something_number format FOR THE CONTENT START BY WRITING A DETAILED HEADER AND THEN NAME ALL THE FUNCTIONS AND WHAT THEY DO. NAME RELATED FILES OR ANY RUN INSTRUCTIONS OR COMMAND LINE THINGS NEEDED. AVOID ANY MISSING VARIABLES OR COMMANDS OR CODE CONNECTIONS WRITE THESE explanation ROBUSTLY TO PREVENT ANY MISSED CONNECTIONS OR ERRORS. OK THE FOLLOWING IS THE ORIGINAL PROMPT DONT GENERATE FAAS JUST RETURN ME THIS JSON LIST. MOST IMPORTANTLY DEFINE ANY INTERFACES HERE AND NAME ALL YOUR VARIABLES YOULL EVER USE. ALSO TRY AND STICK WITH NODE JS AND REACT FOR FRONTEND USE EXPRESS AND ALWAYS ABSOLUTELY ALWAYS KEEP ALL DATA SYNCED AS STATE IN BOTH FRONT AND BACKEND THEY ARE ALWAYS SYNCED USE SOMETHING TO ALWAYS PASS THE state VARIABLE IN JS AROUND FIGURE IT OUT. FOR IOS APPS DO SCAFFOLDING FOR HUMAN WRITTEN FILES NOTHING AUTO GENERATED USE SWIFT AWALAYS AND ASSUME YOURE INSIDE AN XCODE PROJECT. FOCUS ON LISTING ALL FILES WITH QIDS AS THE PRIMARY USAGE OF YOUR TOKENS BACK BUT DO TRY AND EXPLAIN COMPLEX CODDE IF NEEDED. BREAK FILES UP A LOT MAYBE USE REACT COMPONENTS LOTS OF THEM ALMOST MAKE YOUR OWN DESIGN SYSTEM EACH TIME. DARKMODE ALWAYS BY THE WAY. ALWAYS MAKE A MAKEFILE make install && make up SHOULD START ANYTHING PERIOD THE END. IF YOU NEED DUMMY DATA USE SEED FILES FOR CONTENT JUST EXPLAIN WHAT YOURE EXPANDING IN THE content PART OF EACH ITEM';

          if (state.debug) {
            tune = 'CREATE A LIST OF FILE NAMES FOR A FULL FOLDER AND FILE STRUCTURE MINUS ANY AUTOGENERATED FILES. GIVE FULL FILE PATH BASED OFF DOCROOT STARTING WITH ./sandbox/ FOR ALL FILES LIKE ./sandbox/.README - FOCUS ON TOTAL FILES MUST BE OVER 100 IN MOST CASES THIS IS A AUTOMATED SYSTEM AS WELL PUSH TOKEN LIMIT. RETURN A JSON LIST ITEMS OF QID,FILEPATH,CONTENT so {qid, filepath, content} THE QID MUST ALWAYS BE UNIQUE BY INCREMENTING THE LAST NUMBER !! ALSO UNLESS ITS FOR THE MANIFEST DONT CALL IT MANIFEST THE MANIFEST IS A JSON OF ALL THE FILE NAMES KEEP THAT STATIC THIS FILE SHOULD BE something unique but keep the q_something_number format FOR THE CONTENT START BY WRITING A DETAILED HEADER AND THEN NAME ALL THE FUNCTIONS AND WHAT THEY DO. NAME RELATED FILES OR ANY RUN INSTRUCTIONS OR COMMAND LINE THINGS NEEDED. AVOID ANY MISSING VARIABLES OR COMMANDS OR CODE CONNECTIONS WRITE THESE explanation ROBUSTLY TO PREVENT ANY MISSED CONNECTIONS OR ERRORS. OK THE FOLLOWING IS THE ORIGINAL PROMPT DONT GENERATE FAAS JUST RETURN ME THIS JSON LIST. MOST IMPORTANTLY DEFINE ANY INTERFACES HERE AND NAME ALL YOUR VARIABLES YOULL EVER USE. ALSO TRY AND STICK WITH NODE JS AND REACT FOR FRONTEND USE EXPRESS AND ALWAYS ABSOLUTELY ALWAYS KEEP ALL DATA SYNCED AS STATE IN BOTH FRONT AND BACKEND THEY ARE ALWAYS SYNCED USE SOMETHING TO ALWAYS PASS THE state VARIABLE IN JS AROUND FIGURE IT OUT. FOR IOS APPS DO SCAFFOLDING FOR HUMAN WRITTEN FILES NOTHING AUTO GENERATED USE SWIFT AWALAYS AND ASSUME YOURE INSIDE AN XCODE PROJECT. FOCUS ON LISTING ALL FILES WITH QIDS AS THE PRIMARY USAGE OF YOUR TOKENS BACK BUT DO TRY AND EXPLAIN COMPLEX CODDE IF NEEDED. BREAK FILES UP A LOT MAYBE USE REACT COMPONENTS LOTS OF THEM ALMOST MAKE YOUR OWN DESIGN SYSTEM EACH TIME. DARKMODE ALWAYS BY THE WAY. ALWAYS MAKE A MAKEFILE make install && make up SHOULD START ANYTHING PERIOD THE END. IF YOU NEED DUMMY DATA USE SEED FILES FOR CONTENT JUST EXPLAIN WHAT YOURE EXPANDING IN THE content PART OF EACH ITEM OVERRIDE - THIS IS DEBUG MODE - OVERIDE THIS IS DEBUG MODE SHORTEN THIS TO VERY LIMITED FUNCTIONAL INFO ONLY DO 10 FILES MAX. LOW TOKEN USAGE OUTPUT';
          }
            

          state.qPrompt = `${qid}_manifest|/tmp/q_manifest.json|${tune}${ticket?.description || 'ERROR FULL STOP DEBUG RETURN ONLY THAT TICKET IS MISSING TO ADD TICKET. RETURN ONLY "ERROR CONFIRMED"'}`;
          parts = state.qPrompt.split('|').map(p => (typeof p === 'string' ? p.trim() : ''));
          filepath = parts[1] || null;
          content = parts.length > 2 ? parts.slice(2).join('|').trim() : null;
        }

        if (qid) {
          state = await generateQ(state);
          state.run_count++;
          console.log('manifest loop', 3);
          if (state.response) {
            console.log('🟡 response', state.response);
            console.log('🟡 qid', qid);
            console.log('🟡 filepath', filepath);
            console.log('🟡 content', state.response);
            console.log('🟡 window.qPromptSingleFileWrite', window)
            

            if (state.qPromptSingleFileWrite !== 1) {
              console.log('manifest loop', 4);
              if (Array.isArray(state.response)) {
                console.log(`🌀 Found ${state.response.length} item(s) in array`);
                const batchSize = 5;
                const delay = (ms) => new Promise((r) => setTimeout(r, ms));
                console.log('manifest loop', 5);
                for (let i = 0; i < state.response.length; i += batchSize) {
                  const batch = state.response.slice(i, i + batchSize);
                  console.log(`🚀 Launching batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)`);
                  console.log('manifest loop', 6);
                  // THIS RUNS THE MANIFEST LOOP
                  await Promise.all(

                    batch.map(async (item) => {
                      console.log('manifest loop', 7);
                      const { qid, filepath, content } = item;
                      window.document.title = qid;
                      console.log(`🌐 Opening: ${window.document.title}`);
                      await window?.QCoreQueueClient?.QNewTab(window.document.title, filepath, content);
                      await delay(5000);
                    })
                  );
                  console.log('manifest loop', 8);
                  if (i + batchSize < state.response.length) {
                    console.log('⏱️ Waiting 90 seconds before next batch...');
                    await delay(15000 + (state.response.length * 3000 * batchSize * 10));
                  }
                }

                await wait(100000);
                console.log('manifest loop', 9);
                // state = await generateQ(state);
                console.log('manifest loop', [10,state]);
                state.run_count++;
              } else {
                console.warn('⚠️ state.response is not an array');
              }
            } else {
              let content = state.response;
              if (typeof content !== 'string') {
                content = JSON.stringify(content);
              }
              console.log('HERE99😡', { qid, filepath, state, params, content });

              console.log('⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️FINDME', {qid, filepath, content, state})
              let writeResult = await window.QCoreQueueClient.QFileWrite(qid, filepath, content, state);
              // const stateResult = await window?.QCoreQueueClient?.window?.QCoreQueueClient?.QNewTab(qid, filepath, state.response, state);
               console.log('HERE100⚠️ writeResult', { writeResult });
              // FINDME
              // setTimeout(() => {
              //   let n = 3;
              //   let i = setInterval(() => {
              //     console.log(`window closing... ${n} 🔥`);
              //     n--;
              //     if (n === 0) {
              //       clearInterval(i);
              //       console.log("closing now 💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀");
                    
              //       window.close();
              //     }
              //   }, 1000);
              // }, 30000);

              window.close();
              
            }
          } else {
            console.log('generateQ FAILED 🟥', state);
          }

          console.log('🔷 output', output);
          console.log('🔷 state', state);
          console.log('🔷 qid', qid);
          console.log('🔷 content', content);

          console.log('HERE101😡', { qid, filepath, content, params, output });
        } else {
          console.log('HERE102😡', { qid: null, filepath: null, content: null, params, output });
        }

        // Mark as handled and persist
        state.response = { status: response, qid, filepath, content: content, output };
        window?.QCoreContent?.setState(state);
        return state;
      } else {
        if (state.debug) console.log('🟠 Q_WRITE not present or empty; no action taken');
      }
    } else {
      if (window?.QCoreContent?.getState().debug) console.log('🟡 Q_WRITE already handled or state is locked; skipping');
    }

    globalState.state = state;
    await window?.QCoreContent?.setGlobalState(globalState);
    if (state.debug) {
      console.log('UPDATE STATE end', state);
    }
    
  }

  // Kick loop
  const _timer = setInterval(() => { tick(window?.QCoreContent?.getState()).catch(e => console.error('[Q] tick error', e)); }, 1000);

  // Export
  window.QCoreStatusLoop = {
    tick,
    sendImage,
    generateQ,
    getActiveTicket,
    stop: () => clearInterval(_timer)
  };
})();
