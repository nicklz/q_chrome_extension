(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

  function zlCoreTotalCities() {
    try {
      // NEW RULE: window.QCoreGlobal.initCoreData() loops only country === "USA"
      return Array.isArray(window.QCoreGlobal.initCoreData()) ? window.QCoreGlobal.initCoreData().filter((a) => a && a.country === "USA").length : 0;
    } catch {
      return 0;
    }
  }
  function zlCoreCityQueryAt(idx) {
    try {
      // NEW RULE: window.QCoreGlobal.initCoreData() loops only country === "USA"
      const list = Array.isArray(window.QCoreGlobal.initCoreData()) ? window.QCoreGlobal.initCoreData().filter((a) => a && a.country === "USA") : [];
      const ap = list[idx] || null;
      if (!ap) return "";

      const city = String(ap.city || "").trim();
      const region = String(ap.region || "").trim();

      let query = region ? `${city}, ${region}` : city;
      query = String(query || "").trim();

      // Fallback to code if city missing
      if (!query) query = String(ap.code || "").trim();

      return query;
    } catch {
      return "";
    }
  }
  function zlIsHomesPage() {
      try {
        const href = String(location.href || "");
        if (!/https?:\/\/(www\.)?zillow\.com\//i.test(href)) return false;
        // Accept /homes or /homes/
        return String(location.pathname || "").startsWith("/homes");
      } catch {
        return false;
      }
    }
  function zlWriteStateObj(zlObj) {
      try {
        const st = window?.QCoreContent?.getState() || {};
        st.zillow = zlObj || {};
        window?.QCoreContent?.setState(st);
      } catch {}
    }
  // ------------------------------ Zillow — Homes Property Card Collector ------------------------------
    // Scrapes Zillow SRP cards on:
    //   https://www.zillow.com/homes/
    //
    // Flow (as requested):
    //  - Find all: article[data-test="property-card"]
    //  - Extract: image url(s), price, beds, baths, sqft, listing label (for sale/rent/etc), full address, badges/open-house bubbles
    //  - Store everything in shared state: state.zillow
    //  - Paginate by clicking: a[title="Next page"] until it no longer exists
    //  - Rotate through a city list derived from our existing airport dataset (window.QCoreGlobal.initCoreData() / __GF_DEFAULT_AIRPORTS)
    //    by typing into the search box:
    //      input[placeholder^="Address" i]
    //    wait 200ms, then press Enter

    const __ZL_HOMES_URL = "https://www.zillow.com/homes/";
    const __ZL_BEFORE_ENTER_DELAY_MS = 100;  // per request (halved)
    const __ZL_AFTER_ENTER_DELAY_MS = 750;
    const __ZL_STEP_DELAY_MS = 350;
    const __ZL_PAGE_ADVANCE_DELAY_MS = 1000; // per request: wait ~1s before clicking Next
    const __ZL_RESULTS_READY_TIMEOUT_MS = 15000;
    const __ZL_RESULTS_POLL_MS = 300;
    const __ZL_ABORT_POLL_MS = 125;

    // Size guards: we keep state.zillow reasonably bounded so window.name/localStorage don't explode.
    // (You can still export frequently; export includes whatever is currently stored.)
    const __ZL_MAX_RECORDS = 6000;
    const __ZL_MAX_IMAGES_PER_RECORD = 6;

    function zlNowIso() {
      try {
        return new Date().toISOString();
      } catch {
        return String(Date.now());
      }
    }

    function zlNowMs() {
      try {
        return Date.now();
      } catch {
        return 0;
      }
    }

    function zlSleep(ms) {
      return new Promise((r) => setTimeout(r, ms || 0));
    }



    // ---------- Abort / Pause locking (Pause MUST freeze progress) ----------
    function zlAbortError() {
      const e = new Error("__ZL_ABORT__");
      e.__zlAbort = true;
      return e;
    }



    function zlIsStillRunning(runToken) {
      try {
        // BUGFIX (Zillow): this used to reference `zlwindow` (undefined) which
        // caused every tick to abort immediately.
        const root = window?.QCoreContent?.getState?.() || {};
        const zl = root.zillow && typeof root.zillow === "object" ? root.zillow : null;
        if (!zl) return false;
        if (!zl.running || zl.paused) return false;
        if (Number(zl.tickId || 0) !== Number(runToken || 0)) return false;
        return true;
      } catch {
        return false;
      }
    }


    function zlAssertStillRunning(runToken) {
      if (!zlIsStillRunning(runToken)) throw zlAbortError();
    }

    async function zlAbortableSleep(runToken, ms) {
      const end = zlNowMs() + (ms || 0);
      while (zlNowMs() < end) {
        zlAssertStillRunning(runToken);
        const remain = end - zlNowMs();
        await zlSleep(Math.min(__ZL_ABORT_POLL_MS, Math.max(0, remain)));
      }
      zlAssertStillRunning(runToken);
    }





  function zlEnsureInit() {
    const totalCities = zlCoreTotalCities();
    const now = zlNowIso();

    // Root state holds all tool states (Google Flights, Zillow, etc.)
    const root = (() => {
      try {
        const s = window?.QCoreContent?.getState();
        return s && typeof s === "object" ? s : {};
      } catch {
        return {};
      }
    })();

    const defaults = {
      version: 2,
      createdAt: now,
      updatedAt: now,

      running: false,
      paused: false,
      uiHidden: false,
      stage: "idle",
      tickId: 0,

      // City cursor indexes the USA-only window.QCoreGlobal.initCoreData() filtered list
      citiesMode: "window.QCoreGlobal.initCoreData()",
      cities: [], // intentionally not storing derived list
      cityIdx: 0,
      pageInCity: 1,

      totals: {
        cities: totalCities,
        citiesDone: 0,
        pagesDone: 0,
        records: 0,
        cycles: 0,
      },

      records: [],
      __recordKeys: {},
      __pageKeys: {},
      __nextStrategy: "",
      __nextScrollTries: 0,

      lastLog: "",
      lastTickInfo: "",
    };

    let zl = root.zillow;
    zl = zl && typeof zl === "object" ? zl : {};
    zl = { ...defaults, ...zl };

    // Force canonical city source
    zl.citiesMode = "window.QCoreGlobal.initCoreData()";

    // Normalize types
    zl.running = zl.running === true;
    zl.paused = zl.paused === true;
    zl.uiHidden = zl.uiHidden === true;

    zl.stage = typeof zl.stage === "string" ? zl.stage : "idle";
    zl.tickId = Number.isFinite(Number(zl.tickId)) ? Number(zl.tickId) : 0;

    zl.cities = Array.isArray(zl.cities) ? zl.cities : [];
    zl.records = Array.isArray(zl.records) ? zl.records : [];

    zl.__recordKeys = zl.__recordKeys && typeof zl.__recordKeys === "object" ? zl.__recordKeys : {};
    zl.__pageKeys = zl.__pageKeys && typeof zl.__pageKeys === "object" ? zl.__pageKeys : {};
    zl.__nextStrategy = typeof zl.__nextStrategy === "string" ? zl.__nextStrategy : "";
    zl.__nextScrollTries = Number.isFinite(Number(zl.__nextScrollTries)) ? Math.max(0, Math.floor(Number(zl.__nextScrollTries))) : 0;

    zl.cityIdx = Number.isFinite(Number(zl.cityIdx)) ? Math.max(0, Math.floor(Number(zl.cityIdx))) : 0;
    zl.pageInCity = Number.isFinite(Number(zl.pageInCity)) ? Math.max(1, Math.floor(Number(zl.pageInCity))) : 1;

    // Totals
    zl.totals = zl.totals && typeof zl.totals === "object" ? zl.totals : {};
    zl.totals.cities = totalCities || zl.totals.cities || 0;
    zl.totals.citiesDone = Math.max(0, Math.floor(Number(zl.totals.citiesDone || 0)));
    zl.totals.pagesDone = Math.max(0, Math.floor(Number(zl.totals.pagesDone || 0)));
    zl.totals.cycles = Math.max(0, Math.floor(Number(zl.totals.cycles || 0)));
    zl.totals.records = zl.records.length;

    // Clamp cityIdx if out-of-range after USA-only filtering
    if (totalCities && zl.cityIdx >= totalCities) zl.cityIdx = 0;

    zl.lastLog = typeof zl.lastLog === "string" ? zl.lastLog : "";
    zl.lastTickInfo = typeof zl.lastTickInfo === "string" ? zl.lastTickInfo : "";

    // createdAt/updatedAt
    zl.version = 2;
    zl.createdAt = typeof zl.createdAt === "string" ? zl.createdAt : now;
    zl.updatedAt = now;

    // Backfill record keys if missing but records exist
    try {
      if (zl.records.length && (!zl.__recordKeys || !Object.keys(zl.__recordKeys).length)) {
        zl.__recordKeys = {};
        for (const r of zl.records) {
          const k = zlRecordKey(r);
          if (k) zl.__recordKeys[k] = 1;
        }
      }
    } catch {}

    root.zillow = zl;
    window?.QCoreContent?.setState(root);
    return root;
  }


    function zlLog(modal, state, msg) {
      try {
        const line = String(msg || "");
        const root = state && typeof state === "object" ? state : window?.QCoreContent?.getState() || {};
        root.zillow = root.zillow && typeof root.zillow === "object" ? root.zillow : {};
        root.zillow.lastLog = line;
        root.zillow.updatedAt = zlNowIso();
        window?.QCoreContent?.setState(root);
        if (modal && typeof modal.addLog === "function") modal.addLog(line);
      } catch {}
    }

    function __zlEscapeHtml(s) {
      return String(s || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function __zlCsvEscape(v) {
      const s = String(v ?? "");
      if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    }

    function zlPruneForSize(state) {
      try {
        if (!state || typeof state !== "object") return state;

        // Trim image arrays
        try {
          for (const r of state.records || []) {
            if (Array.isArray(r.images) && r.images.length > __ZL_MAX_IMAGES_PER_RECORD) {
              r.images = r.images.slice(0, __ZL_MAX_IMAGES_PER_RECORD);
            }
          }
        } catch {}

        // Trim record count
        if (Array.isArray(state.records) && state.records.length > __ZL_MAX_RECORDS) {
          state.records = state.records.slice(-__ZL_MAX_RECORDS);
          // Rebuild record keys to match trimmed set
          state.__recordKeys = {};
          for (const r of state.records) {
            const k = zlRecordKey(r);
            if (k) state.__recordKeys[k] = 1;
          }
        }

        state.totals = state.totals || {};
        state.totals.records = (state.records || []).length;

        return state;
      } catch {
        return state;
      }
    }

    function zlRecordKey(rec) {
      try {
        if (!rec) return "";
        const zpid = String(rec.zpid || "").trim();
        if (zpid) return `zpid:${zpid}`;
        const url = String(rec.detailUrl || "").trim();
        if (url) return `url:${url}`;
        const addr = String(rec.address || "").trim();
        const price = String(rec.price || "").trim();
        if (addr || price) return `addr:${addr}::price:${price}`;
        return "";
      } catch {
        return "";
      }
    }

    function zlDedupPushRecord(state, rec) {
      try {
        const key = zlRecordKey(rec);
        if (!key) return false;
        if (!state.__recordKeys || typeof state.__recordKeys !== "object") state.__recordKeys = {};
        if (state.__recordKeys[key]) return false;
        state.__recordKeys[key] = 1;
        state.records.push(rec);
        state.totals = state.totals || {};
        state.totals.records = state.records.length;
        return true;
      } catch {
        return false;
      }
    }

    function zlFindSearchInput() {
      try {
        const inputs = Array.from(document.querySelectorAll("input[placeholder]"));
        if (!inputs.length) return null;

        // Primary: placeholder starts with "Address" (case-insensitive)
        const startsWithAddress = inputs.find((i) => /^address/i.test(String(i.getAttribute("placeholder") || "").trim()));
        if (startsWithAddress) return startsWithAddress;

        // Fallback: any placeholder containing address + city
        const fuzzy = inputs.find((i) => {
          const ph = String(i.getAttribute("placeholder") || "").toLowerCase();
          return ph.includes("address") && (ph.includes("city") || ph.includes("zip"));
        });
        return fuzzy || null;
      } catch {
        return null;
      }
    }

    function zlSetValueWithEvents(input, value) {
      if (!input) return;
      try {
        input.focus();
      } catch {}
      try {
        input.value = String(value ?? "");
      } catch {}
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}
    }

    function zlKey(el, key, code, which, keyCode) {
      try {
        el.dispatchEvent(new KeyboardEvent("keydown", { key, code: code || key, which: which || 0, keyCode: keyCode || 0, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key, code: code || key, which: which || 0, keyCode: keyCode || 0, bubbles: true }));
      } catch {}
    }

    function zlKeyEnter(el) {
      zlKey(el, "Enter", "Enter", 13, 13);
    }

    // More reliable click helper (some Zillow elements ignore programmatic .click() or require
    // pointer/mouse sequences; also helps when the element is off-screen).
    function zlFireMouse(el, type) {
      try {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: 1,
          })
        );
      } catch {}
    }

    function zlFirePointer(el, type) {
      try {
        if (typeof PointerEvent === "undefined") return;
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerType: "mouse",
            isPrimary: true,
            buttons: 1,
          })
        );
      } catch {}
    }

    function zlHardClick(el) {
      try {
        if (!el) return false;

        // Ensure the *clickable* element is targeted (often an <a> inside an <li>)
        const target = el.closest?.("a,button") || el;

        try {
          target.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}

        try {
          target.focus?.({ preventScroll: true });
        } catch {}

        // pointer sequence
        zlFirePointer(target, "pointerover");
        zlFirePointer(target, "pointerenter");
        zlFirePointer(target, "pointermove");
        zlFirePointer(target, "pointerdown");

        // mouse sequence
        zlFireMouse(target, "mouseover");
        zlFireMouse(target, "mouseenter");
        zlFireMouse(target, "mousemove");
        zlFireMouse(target, "mousedown");
        zlFireMouse(target, "mouseup");

        // click
        try {
          target.click();
          return true;
        } catch {}

        zlFireMouse(target, "click");
        return true;
      } catch {
        return false;
      }
    }


    // Compute a Next-page URL when the Next button exists but ignores programmatic clicks.
    // Zillow frequently encodes pagination inside the searchQueryState JSON param; we can bump currentPage safely.
    function zlComputeNextUrlFromLocation(nextPageInCity) {
      try {
        const pageNum = Math.max(2, Math.floor(Number(nextPageInCity || 2)));
        const u = new URL(String(location.href || ""), location.href);

        // 1) Path-style pagination: /2_p/ , /3_p/, etc.
        try {
          const p = String(u.pathname || "");
          if (/\/\d+_p\/?$/.test(p)) {
            u.pathname = p.replace(/\/\d+_p\/?$/, `/${pageNum}_p/`);
            return u.toString();
          }
        } catch {}

        // 2) Query-style pagination: searchQueryState JSON
        try {
          const sqs = u.searchParams.get("searchQueryState");
          if (sqs) {
            let obj = null;
            try {
              obj = JSON.parse(String(sqs));
            } catch {
              obj = null;
            }
            if (obj && typeof obj === "object") {
              obj.pagination = obj.pagination && typeof obj.pagination === "object" ? obj.pagination : {};
              obj.pagination.currentPage = pageNum;
              u.searchParams.set("searchQueryState", JSON.stringify(obj));
              return u.toString();
            }
          }
        } catch {}

        // 3) Common plain query param
        try {
          for (const k of ["currentPage", "page", "p"]) {
            if (u.searchParams.has(k)) {
              u.searchParams.set(k, String(pageNum));
              return u.toString();
            }
          }
        } catch {}

        // 4) Last-ditch: add a page param
        try {
          u.searchParams.set("page", String(pageNum));
          return u.toString();
        } catch {}

        return "";
      } catch {
        return "";
      }
    }

    function zlFindPropertyCards() {
      try {
        return Array.from(document.querySelectorAll('article[data-test="property-card"]'));
      } catch {
        return [];
      }
    }

    function zlExtractZpidFromUrl(url) {
      try {
        const u = String(url || "");
        const m = u.match(/\/(\d+)_zpid\b/i);
        return m && m[1] ? String(m[1]) : "";
      } catch {
        return "";
      }
    }

    function zlParseBedsBathsSqftFromLi(li) {
      const text = String(li?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      const b = li?.querySelector?.("b")?.textContent?.trim?.() || "";
      const num = b || (text.match(/([0-9,.]+)/) ? text.match(/([0-9,.]+)/)[1] : "");
      if (!num) return { kind: "", val: "" };

      if (text.includes("bd")) return { kind: "beds", val: num };
      if (text.includes("ba")) return { kind: "baths", val: num };
      if (text.includes("sqft")) return { kind: "sqft", val: num };
      return { kind: "", val: "" };
    }

    function zlParseCard(article, cityQuery) {
      try {
        if (!article) return null;

        // zpid
        let zpid = "";
        const id = String(article.getAttribute("id") || "");
        if (id.startsWith("zpid_")) zpid = id.slice(5);

        // URL
        let detailUrl = "";
        try {
          const a =
            article.querySelector('a[data-test="property-card-link"]') ||
            article.querySelector('a[data-test="property-card-title-link"]') ||
            article.querySelector('a[href*="_zpid"]');
          detailUrl = a ? String(a.href || a.getAttribute("href") || "") : "";
        } catch {}

        if (!zpid && detailUrl) zpid = zlExtractZpidFromUrl(detailUrl);

        // address
        let address = "";
        try {
          const addrEl = article.querySelector("address");
          address = addrEl ? String(addrEl.textContent || "").replace(/\s+/g, " ").trim() : "";
        } catch {}

        // price
        let price = "";
        try {
          const priceEl =
            article.querySelector('[data-test="property-card-price"]') ||
            article.querySelector('[data-testid="property-card-price"]') ||
            article.querySelector('span[data-test="property-card-price"]');
          price = priceEl ? String(priceEl.textContent || "").replace(/\s+/g, " ").trim() : "";
        } catch {}

        // beds / baths / sqft
        let beds = "";
        let baths = "";
        let sqft = "";
        try {
          const lis = Array.from(article.querySelectorAll('ul[data-testid="property-card-details"] li'));
          for (const li of lis) {
            const { kind, val } = zlParseBedsBathsSqftFromLi(li);
            if (kind === "beds" && !beds) beds = val;
            if (kind === "baths" && !baths) baths = val;
            if (kind === "sqft" && !sqft) sqft = val;
          }
        } catch {}

        // Listing label (for sale/rent/etc)
        let listingLabel = "";
        try {
          const ul = article.querySelector('ul[data-testid="property-card-details"]');
          const parent = ul?.parentElement || null;
          if (ul && parent) {
            const raw = String(parent.textContent || "");
            const withoutDetails = raw.replace(String(ul.textContent || ""), "");
            listingLabel = withoutDetails.replace(/\s+/g, " ").replace(/^\s*-\s*/g, "").trim();
          } else {
            // fallback: any "for sale/for rent" text
            const txt = String(article.textContent || "");
            const m = txt.match(/\b(for sale|for rent|sold|pending)\b[^.\n\r]*/i);
            listingLabel = m ? String(m[0]).replace(/\s+/g, " ").trim() : "";
          }
        } catch {}

        // Images (grab anything in the card, including carousel slides)
        let images = [];
        try {
          const imgEls = Array.from(article.querySelectorAll("img"));
          const srcs = [];
          for (const img of imgEls) {
            const u = String(img.currentSrc || img.src || "").trim();
            if (u) srcs.push(u);
          }

          // Also capture source srcset (webp) when present
          const sourceEls = Array.from(article.querySelectorAll("source[srcset]"));
          for (const s of sourceEls) {
            const ss = String(s.getAttribute("srcset") || "");
            // take first url in srcset
            const first = ss.split(",")[0]?.trim()?.split(" ")[0]?.trim() || "";
            if (first) srcs.push(first);
          }

          const seen = new Set();
          images = srcs
            .map((u) => String(u || "").trim())
            .filter(Boolean)
            .filter((u) => {
              const k = u.toLowerCase();
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
        } catch {}

        // Badges / bubbles (Showcase, Open house, etc.)
        let badges = [];
        try {
          const cand = Array.from(
            article.querySelectorAll(
              'span[class*="Badge"], span[class*="badge"], div[class*="Badge"], div[class*="badge"], [data-testid*="badge"], [data-test*="badge"]'
            )
          );
          const out = [];
          const seen = new Set();

          for (const el of cand) {
            const t = String(el.textContent || "").replace(/\s+/g, " ").trim();
            if (!t) continue;
            if (/use arrow keys to navigate/i.test(t)) continue;
            if (/show more/i.test(t)) continue;

            // Avoid accidentally collecting address/price as "badges"
            if (price && t === price) continue;
            if (address && t === address) continue;

            // Keep reasonably short “bubble” texts
            if (t.length > 80) continue;

            const key = t.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
          }

          badges = out;
        } catch {}

        const rec = {
          zpid,
          detailUrl,
          address,
          price,
          beds,
          baths,
          sqft,
          listingLabel,
          images,
          badges,

          cityQuery: String(cityQuery || ""),
          pageUrl: String(location.href || ""),
          collectedAt: zlNowIso(),
        };

        return rec;
      } catch {
        return null;
      }
    }


  function zlFindNextPageLink(state) {
    try {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.visibility === "hidden" || style.display === "none")) return false;
        // Some Zillow pagination links can briefly report 0×0 or be off-screen; if it's not hidden
        // we'll still consider it usable and rely on click+href fallback.
        return true;
      };

      const isEnabled = (el) => {
        if (!el) return false;
        const ariaDisabled = String(el.getAttribute?.("aria-disabled") || "").toLowerCase();
        if (ariaDisabled === "true") return false;
        if (el.hasAttribute?.("disabled")) return false;
        const cls = String(el.className || "");
        if (/disabled/i.test(cls)) return false;
        return true;
      };

      const trySel = (sel) => {
        // Use querySelectorAll + filtering instead of querySelector:
        // Zillow can render multiple "Next" buttons (hidden/disabled) and the first
        // match in DOM order is often not clickable.
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if (!el) continue;
          if (!isVisible(el)) continue;
          if (!isEnabled(el)) continue;
          return el;
        }
        return null;
      };

      const st =
        state && typeof state === "object"
          ? state
          : (window?.QCoreContent?.getState?.()?.zillow || {});

      const strategies = [
        { key: "a_aria_next_page", sel: 'a[aria-label="Next page"]' }
      ];

      // Try cached strategy first
      if (st.__nextStrategy) {
        const cached = strategies.find((s) => s.key === st.__nextStrategy);
        if (cached) {
          const el = trySel(cached.sel);
          if (el) return el;
        }
      }

      // Scan and remember first working strategy
      for (const s of strategies) {
        const el = trySel(s.sel);
        if (el) {
          st.__nextStrategy = s.key;
          try {
            if (state) state.__nextStrategy = s.key;
          } catch {}
          return el;
        }
      }

      // Fallback: look for any anchor/button in a pagination-ish container that looks like "Next"
      try {
        const nav =
          document.querySelector("nav") ||
          document.querySelector('[aria-label*="Pagination"]') ||
          document.querySelector('[data-testid*="pagination"]') ||
          document.querySelector('[data-test*="pagination"]') ||
          null;

        const pool = Array.from((nav || document).querySelectorAll("a,button"));
        const cand = pool.find((el) => {
          if (!el) return false;
          if (!isVisible(el) || !isEnabled(el)) return false;
          const t = String(el.textContent || "").trim();
          const al = String(el.getAttribute?.("aria-label") || "").trim();
          const title = String(el.getAttribute?.("title") || "").trim();
          return /\bnext\b/i.test(t) || /^next/i.test(al) || /^next/i.test(title);
        });
        if (cand) return cand;
      } catch {}

      // Nothing found: clear cached strategy so we can re-discover next time
      if (st.__nextStrategy) {
        st.__nextStrategy = "";
        try {
          if (state) state.__nextStrategy = "";
        } catch {}
      }

      return null;
    } catch {
      return null;
    }
  }

    async function zlWaitForCards(runToken, { minCount = 1, timeoutMs = __ZL_RESULTS_READY_TIMEOUT_MS } = {}) {
      const end = zlNowMs() + (timeoutMs || 0);
      while (zlNowMs() < end) {
        zlAssertStillRunning(runToken);
        const cards = zlFindPropertyCards();
        if (cards.length >= (minCount || 1)) return true;
        await zlAbortableSleep(runToken, __ZL_RESULTS_POLL_MS);
      }
      return false;
    }

    async function zlWaitForNewPage(runToken, { prevUrl = "", prevFirstZpid = "", timeoutMs = 12500 } = {}) {
      const end = zlNowMs() + (timeoutMs || 0);
      while (zlNowMs() < end) {
        zlAssertStillRunning(runToken);

        const urlChanged = prevUrl && String(location.href || "") !== String(prevUrl || "");
        let firstChanged = false;

        try {
          const cards = zlFindPropertyCards();
          const first = cards[0] || null;
          const firstId = first ? String(first.getAttribute("id") || "") : "";
          const zpid = firstId.startsWith("zpid_") ? firstId.slice(5) : "";
          if (prevFirstZpid && zpid && zpid !== prevFirstZpid) firstChanged = true;
        } catch {}

        if (urlChanged || firstChanged) return true;

        // even if we can't detect change, proceed once cards exist
        const hasCards = zlFindPropertyCards().length > 0;
        if (hasCards && !prevUrl) return true;

        await zlAbortableSleep(runToken, __ZL_RESULTS_POLL_MS);
      }
      return false;
    }
    async function zlDoSearchCity(modal, state, runToken, cityQuery) {
    zlAssertStillRunning(runToken);

    const input = zlFindSearchInput();
    if (!input) {
      try {
        state.zillow = state.zillow && typeof state.zillow === "object" ? state.zillow : {};
      } catch {
        state = zlEnsureInit();
      }
      state.zillow.lastTickInfo = "ERROR: search input not found (placeholder starts with 'Address')";
      state.zillow.updatedAt = zlNowIso();
      window?.QCoreContent?.setState(state);
      zlUpdateModal(modal, state);
      zlLog(modal, state, state.zillow.lastTickInfo);
      return false;
    }

    const text = String(cityQuery || "").trim();
    if (!text) return false;
    const textconverted = text
    .toLowerCase()
    .replace(/,/g, "")        // remove commas
    .replace(/\s+/g, "-");    // replace spaces with hyphens

    window.location.href = "/" + textconverted;
    state.zillow.stage = 'scrape_page';

    // Snapshot previous page signature so we can confirm we actually switched cities.
    let prevUrl = "";
    let prevFirstZpid = "";
    try {
      prevUrl = String(location.href || "");
      const first = zlFindPropertyCards()[0] || null;
      const fid = first ? String(first.getAttribute("id") || "") : "";
      prevFirstZpid = fid.startsWith("zpid_") ? fid.slice(5) : "";
    } catch {}

    try {
      zlLog(modal, state, `Search city → ${text}`);

    } catch (e) {
      zlLog(modal, state, `Search error: ${String(e?.message || e || "error")}`);
      return false;
    }
  }

    async function zlScrapePage(modal, state, runToken) {
      zlAssertStillRunning(runToken);

      const cityQuery = zlCoreCityQueryAt(state.zillow.cityIdx || 0) || "";
      const cards = zlFindPropertyCards();

      let added = 0;
      for (const a of cards) {
        const rec = zlParseCard(a, cityQuery);
        if (!rec) continue;
        const ok = zlDedupPushRecord(state.zillow, rec);
        if (ok) added++;
      }

      // page counter (unique by cityIdx + URL)
      try {
        const pageKey = `${state.zillow.cityIdx || 0}::${String(location.href || "")}`;
        if (!state.zillow.__pageKeys || typeof state.zillow.__pageKeys !== "object") state.zillow.__pageKeys = {};
        if (!state.zillow.__pageKeys[pageKey]) {
          state.zillow.__pageKeys[pageKey] = 1;
          state.zillow.totals = state.zillow.totals || {};
          state.zillow.totals.pagesDone = (state.zillow.totals.pagesDone || 0) + 1;
        }
      } catch {}

      // Persist last scrape stats for UI/debugging
      state.zillow.lastScrape = {
        at: zlNowIso(),
        url: String(location.href || ""),
        cityQuery: String(cityQuery || ""),
        pageInCity: Number(state.zillow.pageInCity || 1),
        cards: Number(cards.length || 0),
        added: Number(added || 0),
      };

      state.zillow.lastTickInfo = `scraped=${cards.length} added=${added} • city=${cityQuery} • page=${state.zillow.pageInCity || 1}`;
      state.zillow.updatedAt = zlNowIso();

      zlPruneForSize(state.zillow);
      window?.QCoreContent?.setState(state);
      zlUpdateModal(modal, state);
      zlLog(modal, state, `Scrape done: +${added} (cards=${cards.length})`);

      return { cards: cards.length, added };
    }

    // ---------- Modal UI ----------
    function __qcoreMakeZillowModal({ title = "Zillow", subtitle = "" } = {}) {
      const root = document.createElement("div");
      root.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(1120px,96vw);max-height:88vh;overflow:hidden;background:#0b1117;border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.65);display:flex;flex-direction:column;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu;color:#e5e7eb";

      const head = document.createElement("div");
      head.style.cssText = "padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:12px;align-items:flex-start;justify-content:space-between";

      const left = document.createElement("div");
      const h1 = document.createElement("div");
      h1.textContent = String(title || "Zillow");
      h1.style.cssText = "font-weight:800;color:#93c5fd;font-size:16px;line-height:1.1";
      const h2 = document.createElement("div");
      h2.textContent = String(subtitle || "");
      h2.style.cssText = "margin-top:4px;color:rgba(255,255,255,.72);font-size:12px";
      left.appendChild(h1);
      left.appendChild(h2);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end";

      const btn = (txt, bg) => {
        const b = document.createElement("button");
        b.textContent = txt;
        b.style.cssText =
          "padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:" +
          (bg || "#111827") +
          ";color:#e5e7eb;font-weight:800;cursor:pointer;font-size:12px";
        return b;
      };

      const btnStart = btn("Start / Resume", "#0891b2");
      const btnPause = btn("Pause", "#f59e0b");
      const btnReset = btn("Reset (wipe state.zillow)", "#a855f7");
      const btnExport = btn("Export JSON", "#16a34a");
      const btnExportCsv = btn("Export CSV", "#22c55e");
      const btnGoHomes = btn("Go → Zillow /homes", "#1f2937");
      const btnClose = btn("Close (hide)", "#111827");

      right.appendChild(btnStart);
      right.appendChild(btnPause);
      right.appendChild(btnReset);
      right.appendChild(btnExport);
      right.appendChild(btnExportCsv);
      right.appendChild(btnGoHomes);
      right.appendChild(btnClose);

      head.appendChild(left);
      head.appendChild(right);

      const stats = document.createElement("div");
      stats.style.cssText = "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.82);display:flex;flex-direction:column;gap:2px";

      const lineRun = document.createElement("div");
      const lineCity = document.createElement("div");
      const lineTotals = document.createElement("div");
      const lineLast = document.createElement("div");
      stats.appendChild(lineRun);
      stats.appendChild(lineCity);
      stats.appendChild(lineTotals);
      stats.appendChild(lineLast);

      const body = document.createElement("div");
      body.style.cssText = "display:grid;grid-template-columns: 1fr;gap:10px;padding:10px 14px;overflow:auto";

      const logWrap = document.createElement("div");
      logWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const logHead = document.createElement("div");
      logHead.textContent = "Log";
      logHead.style.cssText = "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
      const log = document.createElement("pre");
      log.style.cssText =
        "margin:0;padding:10px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.25;color:#e5e7eb";
      log.textContent = "";

      logWrap.appendChild(logHead);
      logWrap.appendChild(log);

      const tableWrap = document.createElement("div");
      tableWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const tableHead = document.createElement("div");
      tableHead.textContent = "Properties (latest)";
      tableHead.style.cssText = "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
      const thead = document.createElement("thead");
      thead.innerHTML =
        '<tr style="text-align:left;color:rgba(255,255,255,.75)">' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">City</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Price</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Beds</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Baths</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Sqft</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Listing</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Address</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Badges</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Images</th>' +
        '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Link</th>' +
        "</tr>";
      const tbody = document.createElement("tbody");
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(tableHead);
      tableWrap.appendChild(table);

      body.appendChild(logWrap);
      body.appendChild(tableWrap);

      card.appendChild(head);
      card.appendChild(stats);
      card.appendChild(body);
      root.appendChild(card);
      document.body.appendChild(root);

      // dock label (tiny)
    const dock = document.createElement("div");
    dock.style.cssText =
      "position:fixed;right:10px;bottom:10px;z-index:2147483646;padding:6px 10px;border-radius:999px;background:rgba(2,6,23,.85);border:1px solid rgba(255,255,255,.10);color:#e5e7eb;font-weight:800;font-size:12px;cursor:pointer;user-select:none";
    dock.textContent = "Zillow • show";

    const __ZL_MODAL_Z = 2147483647;

    const applyHiddenStyle = (hidden) => {
      try {
        // Keep mounted so the dock can always bring it back.
        root.style.display = "flex";

        if (hidden) {
          // user-requested: move it off-screen + behind everything
          root.style.zIndex = "-999";
          root.style.pointerEvents = "none";
          root.style.opacity = "0";
          root.style.transform = "translateX(-9999px)";
        } else {
          root.style.zIndex = String(__ZL_MODAL_Z);
          root.style.pointerEvents = "auto";
          root.style.opacity = "1";
          root.style.transform = "";
        }
      } catch {}
    };

    const persistUiHidden = (hidden) => {
      try {
        const st = zlEnsureInit();
        st.zillow.uiHidden = !!hidden;
        st.zillow.updatedAt = zlNowIso();
        window?.QCoreContent?.setState(st);
      } catch {}
    };

    const setHidden = (hidden, { persist = true } = {}) => {
      const h = !!hidden;
      if (persist) persistUiHidden(h);
      applyHiddenStyle(h);
      if (h) dock.textContent = "Zillow • show";
    };

    dock.onclick = () => setHidden(false);
    document.body.appendChild(dock);

    const api = {
      el: root,
      dock,
      btnStart,
      btnPause,
      btnReset,
      btnExport,
      btnExportCsv,
      btnGoHomes,
      btnClose,

      setStats({ page, running, stage, city, cityPos, pageInCity, totals, last, urlPage } = {}) {
        lineRun.textContent = `Page: ${page || location.href}`;

        // City + paging
        const pInfo = urlPage ? ` • urlPage=${urlPage}` : "";
        lineCity.textContent = `City: ${city || "-"} (${cityPos || "-"})   •   Page-in-city: ${pageInCity || "-"}${pInfo}`;

        // Totals + stage
        const t = totals && typeof totals === "object" ? totals : {};
        const cities = t.cities ?? "-";
        const citiesDone = t.citiesDone ?? "-";
        const pagesDone = t.pagesDone ?? t.pages ?? "-";
        const records = t.records ?? "-";
        const cycles = t.cycles ?? "-";
        lineTotals.textContent =
          `Run: ${running ? "🟢 running" : "⚪ stopped"}   •   Stage: ${stage || "-"}   •   ` +
          `Totals: records=${records}  pagesDone=${pagesDone}  citiesDone=${citiesDone}/${cities}  cycles=${cycles}`;

        // Last line
        lineLast.textContent = last ? `Last: ${last}` : "Last: -";
      },


      addLog(msg) {
        const ts = new Date().toLocaleTimeString("en-US");
        log.textContent = `${ts}  ${msg}\n` + log.textContent;
      },

      setRows(rows) {
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        (rows || []).slice(0, 120).forEach((r) => {
          const tr = document.createElement("tr");

          const city = __zlEscapeHtml(r.cityQuery || "");
          const price = __zlEscapeHtml(String(r.price || ""));
          const beds = __zlEscapeHtml(String(r.beds || ""));
          const baths = __zlEscapeHtml(String(r.baths || ""));
          const sqft = __zlEscapeHtml(String(r.sqft || ""));
          const listing = __zlEscapeHtml(String(r.listingLabel || ""));
          const address = __zlEscapeHtml(String(r.address || ""));
          const badges = __zlEscapeHtml(Array.isArray(r.badges) ? r.badges.join(" • ") : String(r.badges || ""));
          const imgs = Array.isArray(r.images) ? r.images : [];
          const imgCount = imgs.length;
          const img0 = imgCount ? __zlEscapeHtml(String(imgs[0] || "")) : "";
          const imgCell = img0
            ? `<a href="${img0}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;text-decoration:none">🖼️ ${imgCount}</a>`
            : `—`;
          const link = __zlEscapeHtml(String(r.detailUrl || ""));
          const linkCell = link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;text-decoration:none">open</a>` : "—";

          tr.innerHTML =
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${city}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${price}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${beds}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${baths}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${sqft}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${listing}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${address}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${badges}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${imgCell}</td>` +
            `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">${linkCell}</td>`;

          tbody.appendChild(tr);
        });
      },
  setHidden,

      showOnly() {
        setHidden(false);
      },

      hideOnly() {
        setHidden(true);
      },
    };

    btnClose.onclick = () => api.hideOnly();
    return api;
  }

  function zlUpdateModal(modal, state) {
    try {
      if (!modal) return;

      const zl = state && state.zillow && typeof state.zillow === "object" ? state.zillow : {};

      const totalCities = zlCoreTotalCities();
      const city = zlCoreCityQueryAt(zl.cityIdx || 0) || "";

      const urlPage = (() => {
        try {
          const href = String(location.href || "");
          // Zillow SRP pagination often uses ".../<n>_p/".
          let m = href.match(/\/(\d+)_p\/?(?:\?|#|$)/i);
          if (m && m[1]) return Number(m[1]);
          // Some pages use ?page=<n>
          const u = new URL(href);
          const p = Number(u.searchParams.get("page") || 0);
          return Number.isFinite(p) && p > 0 ? p : 0;
        } catch {
          return 0;
        }
      })();
  modal.setStats({
        page: location.href,
        running: !!zl.running && !zl.paused,
        stage: zl.stage || "-",
        city,
        cityPos: `${(zl.cityIdx || 0) + 1}/${totalCities || 0}`,
        pageInCity: zl.pageInCity || 1,
        urlPage,
        totals: zl.totals || {},
        last: zl.lastTickInfo || zl.lastLog || "",
      });

      const latest = (zl.records || []).slice(-40).reverse();
      modal.setRows(latest);

      const recCount = (zl.totals && Number.isFinite(Number(zl.totals.records)) ? Number(zl.totals.records) : (zl.records || []).length) || 0;
      modal.dock.textContent = zl.uiHidden
        ? `Zillow • ${recCount} • hidden (click to show)`
        : `Zillow • ${recCount} • ${city || "-"} p${zl.pageInCity || 1}`;

      // Apply hide/show without blocking the runner
      try {
        if (typeof modal.setHidden === "function") {
          modal.setHidden(!!zl.uiHidden, { persist: false });
        }
      } catch {}

      // Keep the modal visible while running unless user hid it
      try {
        if (zl.running && !zl.paused && !zl.uiHidden) modal.el.style.display = "flex";
      } catch {}
    } catch {}
  }

  function zlExportJson(state) {
      try {
        const payload = {
          exportedAt: zlNowIso(),
          homesUrl: __ZL_HOMES_URL,
          citiesMode: state.zillow.citiesMode || "window.QCoreGlobal.initCoreData()",
          cityTotal: zlCoreTotalCities(),
          cities: state.zillow.cities || [],
          totals: state.zillow.totals || {},
          cityIdx: state.zillow.cityIdx,
          pageInCity: state.zillow.pageInCity,
          records: state.zillow.records || [],
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = __qcoreMakeScrapeFilename("zillow", "json");
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(a.href);
            a.remove();
          } catch {}
        }, 1000);
      } catch {}
    }

    function zlExportCsv(state) {
      try {
        const rows = [];
        rows.push([
          "city",
          "zpid",
          "price",
          "beds",
          "baths",
          "sqft",
          "listingLabel",
          "address",
          "badges",
          "images",
          "detailUrl",
          "pageUrl",
          "collectedAt",
        ]);

        for (const r of state.zillow.records || []) {
          rows.push([
            r.cityQuery || "",
            r.zpid || "",
            r.price || "",
            r.beds || "",
            r.baths || "",
            r.sqft || "",
            r.listingLabel || "",
            r.address || "",
            Array.isArray(r.badges) ? r.badges.join(" | ") : "",
            Array.isArray(r.images) ? r.images.join(" | ") : "",
            r.detailUrl || "",
            r.pageUrl || "",
            r.collectedAt || "",
          ]);
        }

        const csv = rows.map((row) => row.map(__zlCsvEscape).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = __qcoreMakeScrapeFilename("zillow", "csv");
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(a.href);
            a.remove();
          } catch {}
        }, 1000);
      } catch {}
    }

    function zlResetAll(modal) {
      const state = zlEnsureInit();
      const createdAt = String(state?.zillow?.createdAt || "") || zlNowIso();
      state.zillow = {
        ...state.zillow,
        version: 2,
        createdAt,
        updatedAt: zlNowIso(),
        running: false,
        paused: false,
        uiHidden: false,
        stage: "idle",
        tickId: 0,
        citiesMode: "window.QCoreGlobal.initCoreData()",
        cities: [],
        cityIdx: 0,
        pageInCity: 1,
        totals: { cities: zlCoreTotalCities(), citiesDone: 0, pagesDone: 0, records: 0, cycles: 0 },
        records: [],
        __recordKeys: {},
        __pageKeys: {},
        __nextStrategy: "",
        lastLog: "reset",
        lastTickInfo: "reset",
      };
      window?.QCoreContent?.setState(state);
      zlLog(modal, state, "Reset complete");
      zlUpdateModal(modal, state);
    }

    function zlStart(modal) {
      const state = zlEnsureInit();
      state.zillow.running = true;
      state.zillow.paused = false;
      state.zillow.stage = "ensure_homes";
      state.zillow.tickId = Number(state.zillow.tickId || 0) + 1;
      state.zillow.lastTickInfo = "start";
      state.zillow.updatedAt = zlNowIso();
      window?.QCoreContent?.setState(state);
      zlLog(modal, state, "Runner started");
      zlUpdateModal(modal, state);
      setTimeout(() => zlAutoTick("start_btn"), 400);
    }

    function zlPause(modal) {
      const state = zlEnsureInit();
      // IMPORTANT: increment tickId so any in-flight async work aborts immediately
      state.zillow.tickId = Number(state.zillow.tickId || 0) + 1;
      state.zillow.paused = true;
      state.zillow.running = false;
      state.zillow.stage = "idle";
      state.zillow.lastTickInfo = "paused";
      state.zillow.updatedAt = zlNowIso();
      window?.QCoreContent?.setState(state);
      zlLog(modal, state, "Paused (progress frozen)");
      zlUpdateModal(modal, state);
    }

    // ---------- Runner ----------
    let __zlTickInFlight = false;

    async function zlAutoTick(reason = "tick") {
      // Allow only one tick at a time.
      if (__zlTickInFlight) return;
      __zlTickInFlight = true;

      let ctl = window.__qcoreZillowCtl;
      let modal = ctl?.modal || null;

      try {
        // Refresh state each tick (state can change mid-run via Pause)
        const state = zlEnsureInit();
        const zl = state.zillow || {};
        const runToken = Number(zl.tickId || 0);

        // Keep modal visible while running (across navigations / reloads)
        if (zl.running && !zl.paused) {
          try {
            if (!modal || !modal.el || !document.body.contains(modal.el)) {
              showZillowModal({ reason: `auto_reopen:${reason}` });
              ctl = window.__qcoreZillowCtl;
              modal = ctl?.modal || null;
            }
            if (modal && modal.el && !zl.uiHidden) modal.el.style.display = "flex";
          } catch {}
        }

        // Gate: pause if Press & Hold is active
        if (typeof __qcorePressHoldActive !== "undefined" && __qcorePressHoldActive) {
          zl.lastTickInfo = "paused_for_press_hold";
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);
          setTimeout(() => zlAutoTick("press_hold_gate"), 500);
          return;
        }

        // Not running
        if (!zl.running || zl.paused) {
          if (modal) zlUpdateModal(modal, state);
          return;
        }

        // Requested: refresh the page every 100s (export first), with a 50s wait before reload.
        try {
          const pr = __qcoreMaybePlanForcedRefresh({
            runner: state.zillow,
            exportFn: () => {
              try {
                const s2 = zlEnsureInit();
                zlExportJson(s2);
              } catch {}
            },
            note: "zillow",
          });
          if (pr && pr.pending) {
            try {
              state.zillow.stage = "force_refresh_wait";
              state.zillow.updatedAt = zlNowIso();
              window?.QCoreContent?.setState(state);
              if (modal) zlUpdateModal(modal, state);
            } catch {}
            zlLog(modal, state, "♻️ Forced refresh planned — exported JSON, reloading in 50s");
            return;
          }
        } catch {}

        zlLog(modal, state, `Tick → ${reason}`);

        // If the runner was started on a non-Zillow page, hop to Zillow once.
        // (Do NOT force /homes while running — Zillow search results live on other paths.)
        try {
          const href = String(location.href || "");
          if (!/https?:\/\/(?:[^/]*\.)?zillow\.com\//i.test(href)) {
            zl.lastTickInfo = "Navigate → Zillow";
            zl.updatedAt = zlNowIso();
            state.zillow = zl;
            window?.QCoreContent?.setState(state);
            if (modal) zlUpdateModal(modal, state);
            zlLog(modal, state, zl.lastTickInfo);
            location.href = __ZL_HOMES_URL;
            return;
          }
        } catch {}

        zlAssertStillRunning(runToken);

        // Canonical city list is window.QCoreGlobal.initCoreData() (USA-only; no dedupe, no truncation)
        const totalCities = zlCoreTotalCities();
        zl.totals = zl.totals && typeof zl.totals === "object" ? zl.totals : {};
        zl.totals.cities = totalCities;

        if (!totalCities) {
          throw new Error("window.QCoreGlobal.initCoreData() empty — cannot run Zillow city loop");
        }

        // If we reach the end, DO NOT STOP — loop back to start of window.QCoreGlobal.initCoreData()
        if ((zl.cityIdx || 0) >= totalCities) {
          zl.cityIdx = 0;
          zl.pageInCity = 1;
          zl.stage = "search_city";
          zl.totals.cycles = (Number(zl.totals.cycles) || 0) + 1;
          zl.lastTickInfo = "All cities finished — looping window.QCoreGlobal.initCoreData()";
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) {
            zlUpdateModal(modal, state);
            zlLog(modal, state, zl.lastTickInfo);
          }
          setTimeout(() => zlAutoTick("cities_loop"), __ZL_STEP_DELAY_MS);
          return;
        }

        const cityQuery = zlCoreCityQueryAt(zl.cityIdx || 0);

        // Stage machine
        if (!zl.stage || zl.stage === "idle") zl.stage = "ensure_homes";
        // Back-compat: older builds used an ephemeral "wait_next" stage that could persist across reloads.
        // Treat it as wait_results so pagination continues instead of restarting the city search.
        if (zl.stage === "wait_next") zl.stage = "wait_results";

        if (zl.stage === "ensure_homes") {
          if (!zl.pageInCity || zl.pageInCity < 1) zl.pageInCity = 1;
          zl.stage = "search_city";
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);
          setTimeout(() => zlAutoTick("to_search_city"), __ZL_STEP_DELAY_MS);
          return;
        }

        if (zl.stage === "search_city") {
          const ok = await zlDoSearchCity(modal, state, runToken, cityQuery);
          zlAssertStillRunning(runToken);

          if (!ok) {
            zl.lastTickInfo = "search_city failed — retrying";
            zl.updatedAt = zlNowIso();
            state.zillow = zl;
            window?.QCoreContent?.setState(state);
            if (modal) zlUpdateModal(modal, state);
            setTimeout(() => zlAutoTick("retry_search_city"), 1000);
            return;
          }

          zl.stage = "wait_results";
          zl.pageInCity = 1;
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);
          setTimeout(() => zlAutoTick("after_city_enter"), __ZL_STEP_DELAY_MS);
          return;
        }

        if (zl.stage === "wait_results") {
          const ok = await zlWaitForCards(runToken, { minCount: 1, timeoutMs: __ZL_RESULTS_READY_TIMEOUT_MS });
          zlAssertStillRunning(runToken);

          if (!ok) {
            zl.lastTickInfo = `Timeout waiting for property cards (${cityQuery}) — retrying search`;
            zl.stage = "search_city";
            zl.updatedAt = zlNowIso();
            state.zillow = zl;
            window?.QCoreContent?.setState(state);
            if (modal) zlUpdateModal(modal, state);
            setTimeout(() => zlAutoTick("retry_after_timeout"), 750);
            return;
          }

          zl.stage = "scrape_page";
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);
          setTimeout(() => zlAutoTick("to_scrape"), 200);
          return;
        }

        if (zl.stage === "scrape_page") {
          await zlScrapePage(modal, state, runToken);
          zlAssertStillRunning(runToken);

          zl.stage = "paginate";
          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);

          setTimeout(() => zlAutoTick("to_paginate"), __ZL_STEP_DELAY_MS);
          return;
        }

        if (zl.stage === "paginate") {
          const next = zlFindNextPageLink(zl);

          // If pagination isn't rendered yet, try scrolling to bottom a couple times before giving up.
          if (!next) {
            zl.__nextScrollTries = Number(zl.__nextScrollTries || 0);
            if (zl.__nextScrollTries < 2) {
              zl.__nextScrollTries += 1;
              zl.updatedAt = zlNowIso();
              state.zillow = zl;
              window?.QCoreContent?.setState(state);
              if (modal) zlUpdateModal(modal, state);
              zlLog(modal, state, `No "Next page" found — scrolling to bottom (try ${zl.__nextScrollTries}/2)`);
              try {
                window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
              } catch {
                try { window.scrollTo(0, document.body.scrollHeight); } catch {}
              }
              setTimeout(() => zlAutoTick("retry_find_next_after_scroll"), 500);
              return;
            }
            zl.__nextScrollTries = 0;
          } else {
            zl.__nextScrollTries = 0;
          }


          if (next) {
            let prevUrl = "";
            let prevFirstZpid = "";
            try {
              prevUrl = String(location.href || "");
              const first = zlFindPropertyCards()[0] || null;
              const fid = first ? String(first.getAttribute("id") || "") : "";
              prevFirstZpid = fid.startsWith("zpid_") ? fid.slice(5) : "";
            } catch {}

            // Grab href for fallback navigation (some Zillow pages ignore untrusted programmatic clicks).
            let nextHref = "";
            try {
              nextHref = String(next.href || next.getAttribute?.("href") || "").trim();
            } catch {}

            zlLog(modal, state, `Click → Next page${nextHref ? " • " + nextHref : ""}`);

            // IMPORTANT: advance progress BEFORE triggering navigation.
            // Full-page reloads can interrupt execution mid-tick; if we only update state *after* click,
            // pageInCity/stage can be lost and the runner will re-run page 1 forever.
            const prevPageInCity = Number(zl.pageInCity) || 1;
            zl.pageInCity = prevPageInCity + 1;
            // Durable stage across reloads: "wait_results" is handled by the state machine.
            zl.stage = "wait_results";
            zl.updatedAt = zlNowIso();
            state.zillow = zl;
            window?.QCoreContent?.setState(state);
            if (modal) zlUpdateModal(modal, state);

            try {
              // Per request: wait a beat between scraping the page and clicking Next.
              await zlAbortableSleep(runToken, __ZL_PAGE_ADVANCE_DELAY_MS);
              zlAssertStillRunning(runToken);

              // Try click first (supports SPA-style pagination)
              const clicked = zlHardClick(next);

              // If click wasn't possible, fall back to direct navigation
              if (!clicked && nextHref) {
                zlLog(modal, state, "Next click failed — navigating via href");
                location.href = nextHref;
                return;
              }

              // If we're still on the same URL after a short beat, force href navigation.
              // (If navigation happened, this context will unload and we won't reach here.)
              await zlAbortableSleep(runToken, 250);
              zlAssertStillRunning(runToken);

              // If the URL did not change, the click was likely ignored (common on Zillow). Fall back to:
              //   1) href navigation (if present)
              //   2) computed next-page URL derived from searchQueryState / path pattern
              const nowUrl = String(location.href || "");
              if (nowUrl === prevUrl) {
                const fallbackUrl =
                  (nextHref && nextHref !== prevUrl) ? nextHref : zlComputeNextUrlFromLocation(zl.pageInCity);

                if (fallbackUrl && fallbackUrl !== prevUrl) {
                  zlLog(modal, state, "Next click ignored — navigating via fallback URL");
                  location.href = fallbackUrl;
                  return;
                }
              }
            } catch (e) {
              // If we were paused/resumed mid-step, bubble the abort up to the outer handler.
              if (e && (e.__zlAbort || String(e?.message || "") === "__ZL_ABORT__")) throw e;

              zlLog(modal, state, `Next page navigation failed: ${String(e?.message || e || "error")}`);

              // Roll back and retry.
              zl.stage = "paginate";
              zl.pageInCity = prevPageInCity;
              zl.updatedAt = zlNowIso();
              state.zillow = zl;
              window?.QCoreContent?.setState(state);
              if (modal) zlUpdateModal(modal, state);

              setTimeout(() => zlAutoTick("retry_next_click"), 750);
              return;
            }

            // If we're still here, pagination likely happened without a full reload (SPA).
            // Wait for URL / first zpid to change before scraping.
            const ok = await zlWaitForNewPage(runToken, { prevUrl, prevFirstZpid, timeoutMs: 12500 });
            zlAssertStillRunning(runToken);
            if (!ok) {
              zlLog(modal, state, "Timeout waiting for next page render — continuing anyway");
            }

            // stage already set to wait_results; just continue.
            zl.updatedAt = zlNowIso();
            state.zillow = zl;
            window?.QCoreContent?.setState(state);
            if (modal) zlUpdateModal(modal, state);

            setTimeout(() => zlAutoTick("after_next"), __ZL_STEP_DELAY_MS);
            return;
          }

          // No next page => next city
          zl.totals = zl.totals && typeof zl.totals === "object" ? zl.totals : {};
          zl.totals.citiesDone = (Number(zl.totals.citiesDone) || 0) + 1;
          zl.cityIdx = (Number(zl.cityIdx) || 0) + 1;
          zl.pageInCity = 1;

          const tc = zlCoreTotalCities();
          zl.totals.cities = tc;

          if ((zl.cityIdx || 0) >= (tc || 0)) {
            zl.cityIdx = 0;
            zl.stage = "search_city";
            zl.totals.cycles = (Number(zl.totals.cycles) || 0) + 1;
            zl.lastTickInfo = "All cities finished — looping window.QCoreGlobal.initCoreData()";
          } else {
            zl.stage = "search_city";
            zl.lastTickInfo = `City done → next city (${zlCoreCityQueryAt(zl.cityIdx || 0) || ""})`;
          }

          zl.updatedAt = zlNowIso();
          state.zillow = zl;
          window?.QCoreContent?.setState(state);
          if (modal) zlUpdateModal(modal, state);

          setTimeout(() => zlAutoTick("next_city"), 6000);
          return;
        }

        // Fallback
        zl.stage = "search_city";
        zl.updatedAt = zlNowIso();
        state.zillow = zl;
        window?.QCoreContent?.setState(state);
        if (modal) zlUpdateModal(modal, state);
        setTimeout(() => zlAutoTick("fallback_to_search"), 400);
      } catch (e) {
        // Abort is expected when paused — do NOT mark as error
        if (e && (e.__zlAbort || String(e?.message || "") === "__ZL_ABORT__")) {
          try {
            const st = zlEnsureInit();
            if (modal) {
              zlLog(modal, st, "Tick aborted (paused/resumed) — progress frozen");
              zlUpdateModal(modal, st);
            }
          } catch {}
          return;
        }

        // Real error
        try {
          const st = zlEnsureInit();
          st.zillow.lastTickInfo = `error: ${String(e?.message || e || "error")}`;
          st.zillow.updatedAt = zlNowIso();
          window?.QCoreContent?.setState(st);
          if (modal) zlUpdateModal(modal, st);
          if (modal) zlLog(modal, st, `ERROR → ${st.zillow.lastTickInfo}`);
        } catch {}

        // Slow retry
        setTimeout(() => zlAutoTick("retry_after_error"), 1750);
      } finally {
        __zlTickInFlight = false;
      }
    }
    function zlAutoBoot() {
      try {
        const state = zlEnsureInit();
        const zl = state.zillow || {};
        if (zl && zl.running && !zl.paused) {
          try {
            showZillowModal({ reason: "autoboot" });
          } catch {}
          setTimeout(() => zlAutoTick("autoboot"), 400);
        }
      } catch {}
    }

    function showZillowModal({ reason = "tools_modal" } = {}) {
      let state = zlEnsureInit();
      const r = String(reason || "");
      const isAuto = r === "autoboot" || r.startsWith("auto_reopen:");

      // If the user explicitly opened the modal, clear the hidden flag.
      if (!isAuto) {
        state.zillow.uiHidden = false;
        window?.QCoreContent?.setState(state);
      }

      const existing = window.__qcoreZillowCtl;
      if (existing && existing.modal && document.body.contains(existing.modal.el)) {
        try {
          // Refresh from storage in case it changed since modal creation.
          state = zlEnsureInit();

          // Respect hidden state on auto-reopen.
          if (state.zillow.uiHidden && isAuto) {
            existing.modal.setHidden?.(true, { persist: false });
          } else {
            existing.modal.setHidden?.(false, { persist: false });
          }

          zlUpdateModal(existing.modal, state);
          existing.modal.addLog(`Modal opened (reuse) — ${reason}`);
        } catch {}
        return;
      }

      const modal = __qcoreMakeZillowModal({
        title: "Zillow",
        subtitle: "Homes search — Property Card Collector",
      });

      window.__qcoreZillowCtl = { modal };

      zlUpdateModal(modal, state);
      modal.addLog(`Modal opened — ${reason}`);

      // Respect hidden state on auto-open
      try {
        if (state.zillow.uiHidden && isAuto) modal.setHidden?.(true, { persist: false });
      } catch {}

      // Convenience: navigate to Zillow /homes
      try {
        if (modal.btnGoHomes) {
          modal.btnGoHomes.onclick = () => {
            try {
              location.href = __ZL_HOMES_URL;
            } catch {}
          };
        }
      } catch {}

      modal.btnStart.onclick = () => zlStart(modal);
      modal.btnPause.onclick = () => zlPause(modal);
      modal.btnReset.onclick = () => zlResetAll(modal);
      modal.btnExport.onclick = () => {
        try {
          const s = zlEnsureInit();
          zlExportJson(s);
          zlLog(modal, s, "Exported JSON");
          zlUpdateModal(modal, s);
        } catch {}
      };
      modal.btnExportCsv.onclick = () => {
        try {
          const s = zlEnsureInit();
          zlExportCsv(s);
          zlLog(modal, s, "Exported CSV");
          zlUpdateModal(modal, s);
        } catch {}
      };

      // Resume quickly if already running
      try {
        const s = zlEnsureInit();
        if (s.zillow.running && !s.zillow.paused) setTimeout(() => zlAutoTick("modal_open_resume"), 600);
      } catch {}
    }

  function zlAutoBoot() {
      try {
        const state = zlEnsureInit();
        const zl = state.zillow || {};
        if (zl && zl.running && !zl.paused) {
          try {
            showZillowModal({ reason: "autoboot" });
          } catch {}
          setTimeout(() => zlAutoTick("autoboot"), 400);
        }
      } catch {}
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "zillow",
      title: "Zillow Scrape",
      icon: "🏠",
      description: "Collect Zillow pages & export JSON.",
      order: 170,
      onClick: () => { try { showZillowModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { zlAutoBoot(); } catch {} },
    });
    try { QQ.showZillowModal = showZillowModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();
