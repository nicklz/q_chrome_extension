// [Q] v5.0 | Run It By Q Automated Registration Assistant
// ------------------------------------------------------------
// Full guest registration workflow for portal.live.virginwifi.com
// Hides #skynet-container immediately
// Launch button (top right, 40px red, black bg) - resets state on click
// Steps are fully resumable per localStorage.wifi.step
// Major actions logged
//  1. Logout (if present)
//  2. Fill random email, click Continue (#check)
//  3. Fill all password fields (12345678)
//  4. Click Register button (by text)
//  5. Redirect to /register (only if NOT already on /register)
//  6. Check all checkboxes (input[type=checkbox])
//  7. Final submit (button[type=submit])
// Never deletes or shrinks file, always additive if re-run
// ------------------------------------------------------------

(function () {
  if (!location.hostname.endsWith('virginwifi.com')) return;

  // Hide #skynet-container immediately
  const skynetEl = document.getElementById('skynet-container');
  if (skynetEl) skynetEl.style.display = "none";

  // Launch button
  if (!document.getElementById('q-auto-launch-btn')) {
      const btn = document.createElement('button');
      btn.id = 'q-auto-launch-btn';
      btn.textContent = '[Q] Login Bypass';
      Object.assign(btn.style, {
          position: 'fixed',
          top: '24px',
          right: '32px',
          zIndex: 999999,
          background: 'black',
          color: 'red',
          fontSize: '40px',
          padding: '10px 32px',
          border: '2px solid red',
          borderRadius: '8px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 0 8px #000a'
      });
      btn.onclick = async function() {
          await QAutoRun(true);
      };
      document.body.appendChild(btn);
      console.log('[Q] v5.0 | Launch button injected');
  }

  function getState() {
      let state = JSON.parse(localStorage.getItem('wifi')) || {};
      return state;
  }
  function setState(state) {
      localStorage.setItem('wifi', JSON.stringify(state));
  }

  async function QAutoRun(forceReset) {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      let state = getState();
      if (!state.wifi) state.wifi = {};
      if (forceReset) state.wifi.step = "start";
      setState(state);

      function markStep(step) {
          state.wifi.step = step;
          setState(state);
          console.log(`[Q] Step: ${step}`);
      }

      // Step 1: Logout if present, else start with email
      if (state.wifi.step === "start") {
          let el = document.querySelector("#logoutConfirm");
          if (el) {
              console.log('[Q] Found logout button, clicking...');
              el.click();
              markStep("afterLogout");
              await wait(1200);
              location.reload();
              return;
          } else {
              console.log('[Q] No logout button, starting at email entry.');
              markStep("emailEntry");
          }
      }

      // Step 2: Fill the email field, click Continue (#check)
      if (state.wifi.step === "emailEntry") {
          let emailInput = Array.from(document.querySelectorAll('input[type="email"]'))
              .find(inp => inp.id && inp.id.includes("datafield-"));
          if (emailInput) {
              let randomEmail = `FUCKYOUIHACKEDYOURSHIT${Math.floor(Math.random()*1e10)}@gmail.com`;
              emailInput.value = randomEmail;
              emailInput.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`[Q] Entered email: ${randomEmail}`);
              let checkBtn = document.querySelector("#check");
              if (checkBtn) {
                  await wait(200);
                  checkBtn.click();
                  console.log('[Q] Clicked Continue (#check) after email.');
                  markStep("waitForPassword");
                  await wait(1500);
                  location.reload();
                  return;
              } else {
                  console.log('[Q] Continue button (#check) not found after email.');
              }
          } else {
              console.log('[Q] Email input not found, retrying...');
              await wait(1000); location.reload(); return;
          }
      }

      // Step 3: Fill ALL password fields (12345678)
      if (state.wifi.step === "waitForPassword") {
          await wait(1200);
          markStep("passwordEntry");
      }
      if (state.wifi.step === "passwordEntry") {
          let passInputs = Array.from(document.querySelectorAll('input[type="password"]'));
          if (passInputs.length > 0) {
              passInputs.forEach((input, idx) => {
                  input.value = "12345678";
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  console.log(`[Q] Filled password field ${idx+1} with 12345678`);
              });
              markStep("passwordSet");
          } else {
              console.log('[Q] Password fields not found, retrying...');
              await wait(1000); location.reload(); return;
          }
      }

      // Step 4: Click Register button (by text)
      if (state.wifi.step === "passwordSet") {
          let regBtn = Array.from(document.querySelectorAll('button'))
              .find(btn => btn.textContent.trim().toLowerCase() === "register");
          if (regBtn) {
              regBtn.click();
              console.log('[Q] Clicked "Register"');
              markStep("waitForFreeLink");
              await wait(1500); location.reload(); return;
          } else {
              console.log('[Q] Register button not found, retrying...');
              await wait(1000); location.reload(); return;
          }
      }

      // Step 5: Redirect to /register (only if NOT already on /register)
      if (state.wifi.step === "waitForFreeLink") {
          await wait(1200);
          markStep("redirectToRegister");
      }
      if (state.wifi.step === "redirectToRegister") {
          if (!window.location.pathname.startsWith('/register')) {
              console.log('[Q] Redirecting to /register for "30 Minutes Free"...');
              window.location.href = "https://portal.live.virginwifi.com/register";
              return;
          } else {
              console.log('[Q] Already on /register, continuing...');
              markStep("waitForFinalForm");
          }
      }

      // Step 6: Check all checkboxes (input[type=checkbox], value="yes")
      if (state.wifi.step === "waitForFinalForm") {
          await wait(1200);
          markStep("checkCheckboxes");
      }
      if (state.wifi.step === "checkCheckboxes") {
          let boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
              .filter(x => x.value === "yes");
          if (boxes.length > 0) {
              boxes.forEach((box, idx) => { if (!box.checked) { box.click(); console.log(`[Q] Checked checkbox ${idx+1}`); } });
              markStep("finalSubmitReady");
          } else {
              console.log('[Q] Checkbox fields not found, retrying...');
              await wait(1000); location.reload(); return;
          }
      }

      // Step 7: Final submit (button[type=submit])
      if (state.wifi.step === "finalSubmitReady") {
          let submitBtn = Array.from(document.querySelectorAll('button[type="submit"]'))
              .find(btn => btn.textContent.trim().toLowerCase() === "continue");
          if (submitBtn) {
              submitBtn.click();
              console.log('[Q] Clicked final "Continue" (submit)');
              markStep("done");
          } else {
              console.log('[Q] Final submit button not found, retrying...');
              await wait(1000); location.reload(); return;
          }
      }

      // Done
      if (state.wifi.step === "done") {
          console.log("[Q] Automation complete.");
      }
  }

  // On load: if wifi.step in progress, resume
  let state = getState();
  if (state.wifi && state.wifi.step && state.wifi.step !== "done") {
      QAutoRun(false);
  }

})();
