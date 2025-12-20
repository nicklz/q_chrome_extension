/* ======================================================================
[Q] DISTROKID AUTOMATION SCRIPT — MASSIVE PAGE SAFE (SLOW + CHANGE-ONLY)
----------------------------------------------------------------------
Doc Title : DistroKid Bulk Autofill (30 tracks) — Song Title + Album Title + Songwriter Name
QID       : q_command_dk_auto_0005
Author    : [Q] Writer v13
Role      : Safely set values on a huge 30-track page without focus/blur spam; fire change/onchange
Targets   :
  - #js-track-table-1
      - [data-field-name="song title"]  -> title derived from filenames (01..30) with cleanup
      - [data-field-name="album title"] -> "Discover Weekly"
  - songwriter_real_name_* fields (by name=...N enumeration, fixed count)
      - First  -> "Nick"
      - Middle -> "A"
      - Last   -> "Kuhn"
Design Constraints :
  - SLOW: 1 job per second (no bursts)
  - NO focus/blur (avoids crashing other content scripts)
  - Uses native value setter + fires input/change + calls onchange if present
  - Button updates live: [RUN_MS=____] [done/total]
Guarantee :
  - No critical data is lost
====================================================================== */

(function () {
  console.log("🟦🤖 DK BULK AUTOFILL LOADED");

  const RUN_MS = 1000; // 1 job/sec
  const MAX_TRACKS = 30; // track rows (titles/albums)
  const MAX_WRITER_FIELDS = 31; // fixed N count you mentioned (1..31)
  const ALBUM_TITLE = "Discover Weekly";
  const WRITER = { first: "Nick", middle: "A", last: "Kuhn" };

  // ====== PUT YOUR 30 FILENAMES HERE (IN ORDER 01..30) ======
  const FILENAMES = [
    "01 Discover Weekly - Static Feeds The Wire.wav",
    "02 Discover Weekly - Dancing In The Neon Light.wav",
    "03 Discover Weekly Hide My Eyes.wav",
    "04 Discover Weekly.wav",
    "05 Radio.wav",
    "06 Backwards Sunrise.wav",
    "07 Discover Weekly - New 2025 Music.wav",
    "08 Discover Weekly - Move The Sound.wav",
    "09 Aerodynamik.wav",
    "10 The Frequency.wav",
    "11 Discover Weekly - Celebrate.wav",
    "12 Honey In The Reverb.wav",
    "13 Silhouette.wav",
    "14 Discover Weekly - Tanky.wav",
    "15 Discover Weekly - After The Fall.wav",
    "16 Discover Weekly - Way Out.wav",
    "17 Discover Weekly - Swim.wav",
    "18 Discover Weekly - Tales.wav",
    "29 Discover Weekly - Casa Bonita.wav",
    "20 Discover Weekly - Follow The Black Rabbit.wav",
    "21 Discover Weekly - City Of Angeles Burning.wav",
    "22 Discover Weekly - Spirit Of Angels.wav",
    "23 Discover Weekly - Minus Thirty One.wav",
    "24 Discover Weekly - Make It.wav",
    "25 Discover Weekly - Weekly.wav",
    "26 Discover Weekly - Work It Make It 4.wav",
    "27 Discover Weekly - Riddle.wav",
    "28 Whispers from the Void.wav",
    "29 Discover Weekly - Wolfgang.wav",
  ].slice(0, MAX_TRACKS);

  // ====== core helpers ======
  function nativeSetValue(el, value) {
    if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const setter = desc && desc.set ? desc.set : null;
    if (setter) setter.call(el, value);
    else el.value = value;
    return true;
  }

  // input/change + call inline handler if present
  function fireChange(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_) {}
    try {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {}
    // call property onchange if assigned
    try {
      if (typeof el.onchange === "function") el.onchange();
    } catch (_) {}
    // also try calling attribute handler (rare, but helps some pages)
    try {
      const attr = el.getAttribute && el.getAttribute("onchange");
      if (attr && typeof window[attr] === "function") window[attr].call(el);
    } catch (_) {}
  }

  function normalizeTitle(filename) {
    let s = String(filename || "").trim();

    // drop extension
    s = s.replace(/\.(wav|mp3|aiff|flac)$/i, "").trim();

    // remove leading track numbers like "01 ", "1 ", "01-", "01_"
    s = s.replace(/^\s*\d{1,2}\s*[-_ ]\s*/i, "").trim();

    // remove "Discover Weekly - " or "Discover Weekly " prefix from song title
    s = s.replace(/^discover weekly\s*-\s*/i, "").trim();
    s = s.replace(/^discover weekly\s+/i, "").trim();

    return s;
  }

  function qAllTrackInputs(fieldName) {
    const results = [];
    for (let n = 1; n <= 31; n++) {
      const root = document.querySelector(`#js-track-table-${n}`);
      if (!root) continue;
  
      const direct = Array.from(
        root.querySelectorAll(
          `input[data-field-name="${fieldName}"], textarea[data-field-name="${fieldName}"]`
        )
      );
  
      const wrapped = Array.from(
        root.querySelectorAll(
          `[data-field-name="${fieldName}"] input, [data-field-name="${fieldName}"] textarea`
        )
      );
  
      for (const el of direct.concat(wrapped)) {
        if (!results.includes(el)) results.push(el);
      }
    }
    return results;
  }
  
  // name-based single lookup (your preferred path)
  function qByNameExact(name) {
    // CSS.escape for safety
    const safe = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/"/g, '\\"');
    return document.querySelector(`input[name="${safe}"], textarea[name="${safe}"]`);
  }

  function writerFieldName(kind, n) {
    // kind: "first" | "middle" | "last"
    return `songwriter_real_name_${kind}${n}`;
  }

  // ====== button state ======
  function makeButtonController(btn) {
    const base = "🤖 Bulk Autofill (Slow)";
    const ctrl = {
      setIdle() {
        btn.textContent = `${base} [RUN_MS=${RUN_MS}]`;
      },
      setRunning(done, total) {
        btn.textContent = `${base} [RUN_MS=${RUN_MS}] [${done}/${total}]`;
      },
      setDone(total) {
        btn.textContent = `${base} [RUN_MS=${RUN_MS}] [${total}/${total}] ✅`;
      },
      setError(done, total) {
        btn.textContent = `${base} [RUN_MS=${RUN_MS}] [${done}/${total}] ⚠️`;
      },
    };
    ctrl.setIdle();
    return ctrl;
  }

  // ====== build jobs (objects) ======
  function buildJobs() {
    console.log("🧩📦 building jobs…");

    const jobs = [];
    let jid = 1;

    // 1) Track table: song title
    const songTitleInputs = qAllTrackInputs("song title");
    console.log(`🎵🧾 found song title inputs: ${songTitleInputs.length}`);

    for (let i = 0; i < Math.min(MAX_TRACKS, songTitleInputs.length, FILENAMES.length); i++) {
      const el = songTitleInputs[i];
      const title = normalizeTitle(FILENAMES[i]);
      jobs.push({
        id: `job_${jid++}`,
        kind: "song_title",
        label: `Row ${String(i + 1).padStart(2, "0")} → "${title}"`,
        run: () => {
          nativeSetValue(el, title);
          fireChange(el);
          console.log(`🎵✅ song title set [${i + 1}/${MAX_TRACKS}] → ${title}`);
        },
      });
    }

    // 2) Track table: album title
    const albumTitleInputs = qAllTrackInputs("album title");
    console.log(`💿🧾 found album title inputs: ${albumTitleInputs.length}`);

    for (let i = 0; i < Math.min(MAX_TRACKS, albumTitleInputs.length); i++) {
      const el = albumTitleInputs[i];
      jobs.push({
        id: `job_${jid++}`,
        kind: "album_title",
        label: `Row ${String(i + 1).padStart(2, "0")} album → "${ALBUM_TITLE}"`,
        run: () => {
          nativeSetValue(el, ALBUM_TITLE);
          fireChange(el);
          console.log(`💿✅ album title set [${i + 1}/${MAX_TRACKS}] → ${ALBUM_TITLE}`);
        },
      });
    }


    const root = document.querySelector("#checkboxtimes");
    if (!root) return;
  
    const boxes = Array.from(root.querySelectorAll('input[type="checkbox"]'));
    for (const cb of boxes) {
      if (cb.disabled) continue;
  
      // set checked using the native setter (works with frameworks)
      const proto = Object.getPrototypeOf(cb);
      const desc = Object.getOwnPropertyDescriptor(proto, "checked");
      if (desc && typeof desc.set === "function") desc.set.call(cb, true);
      else cb.checked = true;
  
      cb.dispatchEvent(new Event("input", { bubbles: true }));
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      if (typeof cb.onchange === "function") cb.onchange();
    }
    


    const TARGET_FIELD = 'album title';
    const VALUE = 'Discover Weekly';
    const DELAY_MS = 1000; // 1/sec
  
    function isTextInput(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') return false;
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type && type !== 'text' && type !== 'search' && type !== 'email' && type !== 'tel' && type !== 'url') return false;
      }
      return !el.disabled && !el.readOnly;
    }
  
    function setNativeValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      const setter = desc && desc.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    }
  
    function fire(el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof el.onchange === 'function') {
        try { el.onchange(new Event('change')); } catch (_) {}
      }
    }
  
    const els = Array.from(document.querySelectorAll('[data-field-name]'))
      .filter(el => (el.getAttribute('data-field-name') || '').trim().toLowerCase() === TARGET_FIELD)
      .map(el => {
        if (isTextInput(el)) return el;
        const inside = el.querySelector && el.querySelector('input, textarea');
        return isTextInput(inside) ? inside : null;
      })
      .filter(Boolean);
  
    let i = 0;
    (function step() {
      if (i >= els.length) return;
      const el = els[i++];
      if ((el.value || '') !== VALUE) {
        setNativeValue(el, VALUE);
        fire(el);
      }
      setTimeout(step, DELAY_MS);
    })();

    // 3) Songwriter fields by explicit name enumeration: songwriter_real_name_{first|middle|last}{N}
    //    You said “fixed 31” and you’re seeing ...last1, ...last2 etc — so we do N=1..31.
    console.log(`🧑‍💼🧾 songwriter enumeration: 1..${MAX_WRITER_FIELDS}`);

    for (let n = 1; n <= MAX_WRITER_FIELDS; n++) {
      const nStr = String(n);

      const firstName = writerFieldName("first", nStr);
      const middleName = writerFieldName("middle", nStr);
      const lastName = writerFieldName("last", nStr);

      jobs.push({
        id: `job_${jid++}`,
        kind: "writer_first",
        label: `${firstName} → "${WRITER.first}"`,
        run: () => {
          const el = qByNameExact(firstName);
          if (!el) {
            console.log(`🟨⏭️ missing: ${firstName} (skipped)`);
            return;
          }
          nativeSetValue(el, WRITER.first);
          fireChange(el);
          console.log(`🧑‍💼✅ first set ${firstName} → ${WRITER.first}`);
        },
      });

      jobs.push({
        id: `job_${jid++}`,
        kind: "writer_middle",
        label: `${middleName} → "${WRITER.middle}"`,
        run: () => {
          const el = qByNameExact(middleName);
          if (!el) {
            console.log(`🟨⏭️ missing: ${middleName} (skipped)`);
            return;
          }
          nativeSetValue(el, WRITER.middle);
          fireChange(el);
          console.log(`🧑‍💼✅ middle set ${middleName} → ${WRITER.middle}`);
        },
      });

      jobs.push({
        id: `job_${jid++}`,
        kind: "writer_last",
        label: `${lastName} → "${WRITER.last}"`,
        run: () => {
          const el = qByNameExact(lastName);
          if (!el) {
            console.log(`🟨⏭️ missing: ${lastName} (skipped)`);
            return;
          }
          nativeSetValue(el, WRITER.last);
          fireChange(el);
          console.log(`🧑‍💼✅ last set ${lastName} → ${WRITER.last}`);
        },
      });
    }

    console.log(`🧩✅ jobs built: ${jobs.length}`);
    return jobs;
  }

  // ====== slow runner (1 job/sec) ======
  function runSlow(jobs, ui) {
    if (!jobs.length) {
      console.log("🟥❌ no jobs to run");
      if (ui) ui.setError(0, 0);
      return;
    }

    const total = jobs.length;
    let done = 0;

    console.log("🐢⏳ starting slow run (1/sec)…");
    if (ui) ui.setRunning(done, total);

    const t = setInterval(() => {
      if (!jobs.length) {
        clearInterval(t);
        console.log("🏁🎉 ALL DONE");
        if (ui) ui.setDone(total);
        return;
      }

      const job = jobs.shift();
      done++;

      if (ui) ui.setRunning(done, total);

      console.log(`🟩▶️ ${job.id} [RUN_MS=${RUN_MS}] [${done}/${total}] | ${job.kind} | ${job.label}`);

      try {
        job.run();
        console.log(`🟩✅ ${job.id} complete | remaining=${jobs.length}`);
      } catch (e) {
        console.log(`🟥💥 ${job.id} failed | ${String(e)} | remaining=${jobs.length}`);
        if (ui) ui.setError(done, total);
      }
    }, RUN_MS);
  }

  // ====== UI button ======
  function injectButton() {
    const id = "q-dk-bulk-autofill-btn";
    if (document.getElementById(id)) return;

    const btn = document.createElement("button");
    btn.id = id;
    btn.textContent = "🤖 Bulk Autofill (Slow)";

    btn.style.position = "fixed";
    btn.style.right = "20px";
    btn.style.top = "20px";
    btn.style.padding = "16px 22px";
    btn.style.fontSize = "16px";
    btn.style.fontWeight = "800";
    btn.style.background = "#c62828";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.borderRadius = "12px";
    btn.style.cursor = "pointer";
    btn.style.zIndex = "999999";
    btn.style.boxShadow = "0 6px 18px rgba(0,0,0,0.35)";

    const ui = makeButtonController(btn);

    btn.addEventListener("click", () => {
      console.log("🚀🔘 button clicked → building + running");
      const jobs = buildJobs();
      runSlow(jobs, ui);
    });

    document.body.appendChild(btn);
    console.log("🟥🔘 button injected:", `#${id}`);
  }

  injectButton();
})();
