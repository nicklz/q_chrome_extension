(() => {
  'use strict';
  const Q = window.QCoreToolsModal || {};
  const flashEmoji = Q.flashEmoji || (() => {});
  const __qcoreSleep = Q.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const __qcoreSanitizeProjectName = Q.__qcoreSanitizeProjectName || (s => String(s || ''));
  const __qcoreMakeScrapeFilename = Q.__qcoreMakeScrapeFilename || ((...args) => `qcore_${Date.now()}.json`);
  const __qcoreDownloadBlob = Q.__qcoreDownloadBlob || ((blob, name) => { try { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name||'download'; a.click(); } catch {} });

  // ------------------------------ Reddit — Random Post Title Scraper ------------------------------
  // Flow (per request):
  //  - Every 1s tick while running
  //  - Pick a random <a> (RNG) on reddit.com (prefers /comments/ links)
  //  - On the destination page, look for: <h1 id^="post-title">
  //    - If found: store { url, title, links, images } into state.reddit.records (no duplicates)
  //    - Then redirect back to https://www.reddit.com/ and repeat
  //
  // Notes:
  //  - Loud by design: lots of console.log + in-modal logs.
  //  - Auto-reopens its modal across navigations (like Google Flights / Zillow).

  // Hub page (per request): when a listing hits the end of scroll, bounce through /explore
  const __RS_EXPLORE_URL = "https://www.reddit.com/explore/";
  const __RS_HOME_URL = __RS_EXPLORE_URL;
  const __RS_ROOT_URL = "https://www.reddit.com/";
    // Default OFF: aggressively clearing cookies can break the feed / trigger login walls.
    const __RS_COOKIE_NUKE_ENABLED = false;

  const __RS_STEP_DELAY_MS = 1500; // slowed down 50%
  const __RS_429_BACKOFF_MS = 90000; // 90s backoff when we hit Reddit rate-limit (429)

  // "End of page" detection:
  //  - If scrolling to bottom stops increasing scrollHeight for N consecutive scrolls -> treat as end
  //  - Also cap scrolls per page so infinite feeds still rotate back through /explore
  const __RS_END_NO_GROWTH_STREAK = 2;
  const __RS_MAX_SCROLLS_PER_PAGE = 14;

  // Explore page selectors (per request)
  const __RS_EXPLORE_SHOW_MORE_ARIA = "Show more community recommendations";
  const __RS_EXPLORE_GRID_LINK_SELECTOR = ".show-more-grid-item a[href]";


  // Title requirement (exact): <h1 id^="post-title">
  const __RS_POST_H1_SELECTOR = 'h1[id^="post-title"]';

  // Image requirement (explicit): <img id="post-image"> (+ friends)
  const __RS_POST_IMAGE_SELECTOR = 'img#post-image, img[id^="post-image"]';

  // Loud logging (kept), but export strips logs as requested.
  const __RS_MAX_LOGS = 220;
  const __RS_MAX_RECORDS_HARD = 8000; // safety guard; compactState also trims

  // --- Storage safety caps (prevents localStorage quota freezes that look like "stuck totals") ---
  // Keep the in-state DB small enough that QCoreContent.setState(...) can always persist.
  // (Most Chrome localStorage quotas are ~5MB; huge arrays of links/images will silently break saves.)
  const __RS_MAX_RECORDS_SOFT = 0;             // 0 = disabled (use byte-size compaction instead)
  const __RS_BOTTOM_HITS_TO_EXPLORE = 10;      // consecutive bottom/no-growth hits before rotating
  const __RS_MAX_LINKS_PER_RECORD = 120;       // listing records are noisier; cap aggressively
  const __RS_MAX_IMAGES_PER_RECORD = 80;
  const __RS_MAX_MEDIA_PER_RECORD = 12;
  const __RS_MAX_TEXT_LEN = 360;
  const __RS_MAX_URL_LEN = 700;

    function rsNowIso() {
      try {
        return new Date().toISOString();
      } catch {
        return String(Date.now());
      }
    }

    function rsNowMs() {
      try {
        return Date.now();
      } catch {
        return 0;
      }
    }

    function rsSleep(ms) {
      return new Promise((r) => setTimeout(r, ms || 0));
    }

    // Preflight: fetch reddit.com to detect 429 BEFORE we reload.
    // Motivation: if we blindly refresh on a 429/blocked response, we can land on a dead-end error page.
    // If the preflight sees 429, we clear cookies again and refresh immediately.
    async function rsPreflightHome429({ timeoutMs = 6500 } = {}) {
      try {
        // Only safe on reddit.* (same-origin); otherwise CORS can throw.
        if (!rsIsRedditHost()) return { ok: false, status: 0 };

        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = ctrl ? setTimeout(() => ctrl.abort(), Math.max(250, timeoutMs || 6500)) : null;

        const res = await fetch("https://www.reddit.com/", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl ? ctrl.signal : undefined,
        });

        if (t) clearTimeout(t);

        const status = Number(res?.status || 0);
        return { ok: true, status };
      } catch {
        return { ok: false, status: 0 };
      }
    }

    function rsEscapeHtml(s) {
      try {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      } catch {
        return "";
      }
    }

    function rsIsRedditHost(href = "") {
      try {
        const u = new URL(String(href || location.href));
        const h = String(u.hostname || "");
        return /(^|\.)reddit\.com$/i.test(h) || /(^|\.)old\.reddit\.com$/i.test(h);
      } catch {
        try {
          return /(^|\.)reddit\.com$/i.test(String(location.hostname || ""));
        } catch {
          return false;
        }
      }
    }

    // Detect Reddit's login/register gate pages so we can bounce home and avoid navigation flooding.
    function rsIsLoginGatePage(href = "") {
      try {
        const u = new URL(String(href || location.href), location.href);
        const p = String(u.pathname || "");
        if (/^\/login\/?$/i.test(p)) return true;
        if (/^\/account\/login\/?$/i.test(p)) return true;
        if (/^\/account\/register\/?$/i.test(p)) return true;
        return false;
      } catch {
        try {
          const p = String(location.pathname || "");
          return /\/(login|account\/login|account\/register)\b/i.test(p);
        } catch {
          return false;
        }
      }
    }

    // Explore hub page helpers (per request)
    function rsIsExplorePage(href = "") {
      try {
        const u = new URL(String(href || location.href), location.href);
        return /^\/explore\/?/i.test(String(u.pathname || ""));
      } catch {
        try {
          return /^\/explore\/?/i.test(String(location.pathname || ""));
        } catch {
          return false;
        }
      }
    }

    function rsFindExploreShowMoreButtons() {
      try {
        const primary = Array.from(document.querySelectorAll(`button[aria-label="${__RS_EXPLORE_SHOW_MORE_ARIA}"]`));

        // Fallback: match by aria-label substring OR visible text "Show more"
        const fallback = Array.from(document.querySelectorAll("button")).filter((b) => {
          try {
            if (!b) return false;
            if (b.closest("[data-qcore-reddit-scrape-modal='1']")) return false;

            const aria = String(b.getAttribute("aria-label") || "").trim().toLowerCase();
            const txt = String(b.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();

            if (aria.includes("show more community recommendations")) return true;
            if (aria === "show more" || aria.startsWith("show more")) return true;
            if (txt === "show more" || txt.startsWith("show more")) return true;

            return false;
          } catch {
            return false;
          }
        });

        const out = [...primary, ...fallback];

        // Dedupe (DOM elements are stable references)
        const seen = new Set();
        return out.filter((b) => {
          if (!b) return false;
          if (seen.has(b)) return false;
          seen.add(b);
          return true;
        });
      } catch {
        return [];
      }
    }

    async function rsClickExploreShowMoreButtons(modal, state, runToken, { maxClicks = 4 } = {}) {
      let clicked = 0;
      try {
        rsAssertStillRunning(runToken);

        const btns = rsFindExploreShowMoreButtons()
          .filter((b) => {
            try {
              if (!b) return false;
              if (b.disabled) return false;
              if (String(b.getAttribute("aria-disabled") || "") === "true") return false;
              return true;
            } catch {
              return true;
            }
          })
          .slice(0, Math.max(0, Math.min(12, Number(maxClicks || 0) || 0)));

        for (const b of btns) {
          rsAssertStillRunning(runToken);

          try {
            if (typeof b.scrollIntoView === "function") b.scrollIntoView({ block: "center", behavior: "instant" });
          } catch {}

          try {
            b.click();
            clicked += 1;

            // Persist a small counter for debugging
            try {
              const st = state && typeof state === "object" ? state : rsEnsureInit();
              st.reddit = st.reddit && typeof st.reddit === "object" ? st.reddit : {};
              st.reddit.exploreShowMoreClicks = Number(st.reddit.exploreShowMoreClicks || 0) + 1;
              st.reddit.updatedAt = rsNowIso();
              rsSafeSetState(st);
            } catch {}

            rsLog(modal, state, "➕🧩 Explore: clicked ‘Show more community recommendations’");
          } catch {}

          await rsSleep(1000);
        }
      } catch {}

      return clicked;
    }

    function rsFindExploreGridAnchors() {
      try {
        const all = Array.from(document.querySelectorAll(__RS_EXPLORE_GRID_LINK_SELECTOR) || []);
        const out = [];
        const cur = rsCanonicalUrl(location.href);

        for (const a of all) {
          try {
            if (!a) continue;
            if (a.closest("[data-qcore-reddit-scrape-modal='1']")) continue;

            const u = rsAnchorUrl(a);
            if (!u) continue;
            if (!rsIsRedditHost(u.href)) continue;
            if (rsIsLoginGatePage(u.href)) continue;

            const canon = rsCanonicalUrl(u.href);
            if (!canon || canon === cur) continue;

            out.push({ a, href: u.href, canon });
          } catch {}
        }

        return out;
      } catch {
        return [];
      }
    }


    // Detect rate-limit / 429 pages (Reddit sometimes serves an interstitial "Too Many Requests").
    function rsIs429TooManyRequestsPage() {
      try {
        const t = String(document.title || "").toLowerCase();
        if (t.includes("too many requests") || t.includes("error 429") || t.includes("429")) return true;

        const body = String(document.body?.innerText || "").toLowerCase();
        if (!body) return false;

        if (body.includes("too many requests")) return true;
        if (body.includes("error 429") || body.includes("http 429")) return true;
        if (body.includes("we've detected unusual activity")) return true;
        return false;
      } catch {
        return false;
      }
    }

    function rsClearDocumentCookiesBestEffort() {
      try {
        const parts = String(document.cookie || "").split(";");
        for (const p of parts) {
          const eq = p.indexOf("=");
          const name = (eq >= 0 ? p.slice(0, eq) : p).trim();
          if (!name) continue;

          // path-only
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;

          // domain variants (best-effort)
          try {
            const host = String(location.hostname || "");
            const base = host.replace(/^www\./, "");
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${host};`;
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${base};`;
          } catch {}
        }
      } catch {}
    }

    // Requested: if we hit 429s, attempt to delete cookies for the site (without nuking localStorage/state).
    async function rsClearSiteCookiesFor429() {
      // 1) Clear non-HttpOnly cookies via document.cookie
      try {
        rsClearDocumentCookiesBestEffort();
      } catch {}

      // 2) Clear HttpOnly cookies via background browsingData helper (if available)
      try {
        if (!(chrome && chrome.runtime && chrome.runtime.sendMessage)) return false;

        const res = await chrome.runtime.sendMessage({
          type: "CLEAR_BROWSING_DATA",
          origins: [location.origin],
          types: ["cookies"],
        });

        return !!res?.ok;
      } catch {
        return false;
      }
    }



    // NEW (requested): nuke Reddit cookies while the RedditScrape runner is actively running.
    //
    // IMPORTANT: doing this too aggressively breaks Reddit (feed fails to load / GraphQL 400s).
    // So we:
    //  - only nuke while state.reddit.running && !paused
    //  - throttle background cookie clears heavily
    //  - keep interval modest (1s)
    const __RS_COOKIE_NUKE_INTERVAL_MS = 1000;
    const __RS_COOKIE_BG_THROTTLE_MS = 8000;

    // Persist across SPA navigations (window-scoped)
    if (typeof window.__rsCookieNukeInFlight !== "boolean") window.__rsCookieNukeInFlight = false;
    if (!Number.isFinite(Number(window.__rsCookieNukeLastBgAtMs))) window.__rsCookieNukeLastBgAtMs = 0;

    function rsEnsureCookieNuker() {
      try {
        // reuse existing interval if already installed
        if (window.__rsCookieNukeIv) return;

        window.__rsCookieNukeIv = setInterval(async () => {
          try {
            if (!rsIsRedditHost()) return;

            // Only while runner is actively running
            try {
              const s = rsEnsureInit();
              const rs = s.reddit || {};
              if (!rs.running || rs.paused) return;
            } catch {}

            // 1) Clear non-HttpOnly cookies via document.cookie (best-effort)
            try {
              rsClearDocumentCookiesBestEffort();
            } catch {}

            // 2) Clear HttpOnly cookies via background browsingData helper (if available) — throttled
            if (window.__rsCookieNukeInFlight) return;

            const nowMs = rsNowMs();
            if (nowMs - Number(window.__rsCookieNukeLastBgAtMs || 0) < __RS_COOKIE_BG_THROTTLE_MS) return;
            window.__rsCookieNukeLastBgAtMs = nowMs;

            window.__rsCookieNukeInFlight = true;

            try {
              const hasBg =
                typeof chrome !== "undefined" &&
                chrome &&
                chrome.runtime &&
                typeof chrome.runtime.sendMessage === "function";

              if (hasBg) {
                await chrome.runtime.sendMessage({
                  type: "CLEAR_BROWSING_DATA",
                  origins: [location.origin],
                  types: ["cookies"],
                });
              }
            } catch {}

            window.__rsCookieNukeInFlight = false;
          } catch {
            window.__rsCookieNukeInFlight = false;
          }
        }, __RS_COOKIE_NUKE_INTERVAL_MS);
      } catch {}
    }

    // NOTE: we do not auto-start this on page load anymore.
    // The runner calls rsEnsureCookieNuker() when it starts/ticks.

  function rsCanonicalUrl(u) {
      try {
        const url = new URL(String(u || ""), location.href);
        url.hash = "";

        // Drop noisy tracking params (keep it stable so dedupe works)
        try {
          const strip = [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "utm_name",
            "rdt",
            "share_id",
            "sh",
            "si",
          ];
          for (const k of strip) url.searchParams.delete(k);
        } catch {}

        // For reddit posts, the canonical "identity" is basically origin+pathname.
        // We keep search only if it still has something meaningful after stripping.
        const base = url.origin + url.pathname;
        const q = String(url.search || "");
        return (q && q !== "?") ? base + q : base;
      } catch {
        return String(u || "").trim();
      }
    }

    function rsEnsureInit() {
      const state = window?.QCoreContent?.getState() || {};

      // Required by request: state.reddit.records is the canonical record array.
      // Migration: older builds stored the array directly at state.reddit.
      try {
        const legacy = state.reddit;

        if (Array.isArray(legacy)) {
          state.reddit = { records: legacy };
        } else if (!legacy || typeof legacy !== "object") {
          state.reddit = { records: [] };
        } else {
          // ensure records array
          if (!Array.isArray(legacy.records)) legacy.records = [];
        }

        if (!Array.isArray(state.reddit.records)) state.reddit.records = [];
      } catch {
        state.reddit = { records: [] };
      }

      // Runner blob lives in state.reddit
      state.reddit = state.reddit && typeof state.reddit === "object" ? state.reddit : {};
      const rs = state.reddit;

      const now = rsNowIso();
      rs.version = Number(rs.version || 1);
      rs.createdAt = String(rs.createdAt || now);
      rs.updatedAt = String(rs.updatedAt || now);

      rs.running = !!rs.running;
      rs.paused = !!rs.paused;
      rs.uiHidden = !!rs.uiHidden;

      const playbackStatusRaw = String(state?.status || rs.status || "").trim().toLowerCase();
      if (playbackStatusRaw) {
        if (playbackStatusRaw === "paused") {
          rs.running = false;
          rs.paused = true;
        } else if (playbackStatusRaw === "play" || playbackStatusRaw === "run" || playbackStatusRaw === "running") {
          rs.running = true;
          rs.paused = false;
        } else {
          rs.running = false;
          rs.paused = false;
        }
      }

      const normalizedPlaybackStatus = playbackStatusRaw || (rs.paused ? "paused" : (rs.running ? "run" : "idle"));
      state.status = normalizedPlaybackStatus;
      rs.status = normalizedPlaybackStatus;

      rs.stage = String(rs.stage || "idle");
      rs.tickId = Number(rs.tickId || 0);

      // rate-limit / backoff support
      rs.rateLimitUntilMs = Number.isFinite(Number(rs.rateLimitUntilMs)) ? Number(rs.rateLimitUntilMs) : 0;

      rs.lastTickInfo = String(rs.lastTickInfo || "");
      rs.lastLog = String(rs.lastLog || "");

      rs.lastPageHref = String(rs.lastPageHref || "");
      rs.pageTicks = Number(rs.pageTicks || 0);

      // page scroll/end detection (explore hub loop)
      rs.pageScrolls = Number(rs.pageScrolls || 0);
      rs.pageNoGrowthStreak = Number(rs.pageNoGrowthStreak || 0);
      rs.pageLastScrollHeight = Number(rs.pageLastScrollHeight || 0);
      rs.exploreShowMoreClicks = Number(rs.exploreShowMoreClicks || 0);
      rs.exploreLastGridClickAtMs = Number(rs.exploreLastGridClickAtMs || 0);

      rs.lastClickHref = String(rs.lastClickHref || "");
      rs.lastSavedHref = String(rs.lastSavedHref || "");
      rs.lastSavedTitle = String(rs.lastSavedTitle || "");

      rs.logs = Array.isArray(rs.logs) ? rs.logs : [];

      // fast dedupe map (keys -> 1). Historically this was URL-only; now it's record keys.
      rs.__urlKeys = rs.__urlKeys && typeof rs.__urlKeys === "object" && !Array.isArray(rs.__urlKeys) ? rs.__urlKeys : {};

      // Rebuild dedupe keys if missing/empty (or after compaction)
      try {
        if (!rs.__urlKeys || typeof rs.__urlKeys !== "object") rs.__urlKeys = {};
        const keys = Object.keys(rs.__urlKeys);
        const records = Array.isArray(state?.reddit?.records) ? state.reddit.records : [];
        if (!keys.length && records.length) {
          for (const rec of records) {
            const k = String(rec?.key || rec?.url || "").trim();
            if (k) rs.__urlKeys[k] = 1;
          }
        }
      } catch {}

      // Hard cap safety (keeps localStorage/window.name writes from failing silently)
      try {
        if (Array.isArray(state?.reddit?.records) && state.reddit.records.length > __RS_MAX_RECORDS_HARD) {
          state.reddit.records = state.reddit.records.slice(-__RS_MAX_RECORDS_HARD);
          // rebuild keys
          rs.__urlKeys = {};
          for (const rec of state.reddit.records) {
            const k = String(rec?.key || rec?.url || "").trim();
            if (k) rs.__urlKeys[k] = 1;
          }
        }
      } catch {}

      // "Ever" counter (monotonic): keeps increasing even if we trim stored records.
      try {
        const recLen = Array.isArray(state?.reddit?.records) ? state.reddit.records.length : 0;
        rs.totalCapturedEver = Number.isFinite(Number(rs.totalCapturedEver)) ? Number(rs.totalCapturedEver) : recLen;
        if (rs.totalCapturedEver < recLen) rs.totalCapturedEver = recLen;
      } catch {}

      state.reddit = rs;
      return state;
    }



    function rsGetCtl() {
      try {
        return window.__qcoreRedditScrapeCtl || null;
      } catch {
        return null;
      }
    }

    function rsSetCtl(modal) {
      try {
        window.__qcoreRedditScrapeCtl = { modal };
      } catch {}
    }

    function rsPushLogLine(state, line) {
      try {
        const s = state && typeof state === "object" ? state : rsEnsureInit();
        const rs = s.reddit || {};
        rs.logs = Array.isArray(rs.logs) ? rs.logs : [];
        rs.logs.push(String(line || ""));
        if (rs.logs.length > __RS_MAX_LOGS) rs.logs = rs.logs.slice(-__RS_MAX_LOGS);
        rs.lastLog = String(line || "");
        rs.updatedAt = rsNowIso();
        s.reddit = rs;
        return s;
      } catch {
        return state;
      }
    }

    function rsLog(modal, state, msg, extra) {
      const line = `${msg || ""}`;
      const ts = (() => {
        try {
          return new Date().toLocaleTimeString("en-US");
        } catch {
          return String(Date.now());
        }
      })();

      // console: loud
      try {
        if (extra !== undefined) {
          console.log(`🧵🤖 [RedditScrape] ${ts}  ${line}`, extra);
        } else {
          console.log(`🧵🤖 [RedditScrape] ${ts}  ${line}`);
        }
      } catch {}

      // modal
      try {
        modal?.addLog?.(line);
      } catch {}

      // state log (persist across navigations)
      try {
        const st = rsPushLogLine(state, `${ts}  ${line}`);
        rsSafeSetState(st);
      } catch {}
    }

  // --- Storage / record normalization helpers -----------------------------------------
  function rsTrimString(s, maxLen) {
    try {
      const str = String(s == null ? "" : s);
      const lim = Math.max(0, Number(maxLen || 0) || 0);
      if (!lim) return str;
      return str.length > lim ? str.slice(0, lim) : str;
    } catch {
      return "";
    }
  }

  function rsTrimArray(arr, maxLen, mapFn) {
    try {
      const a = Array.isArray(arr) ? arr : [];
      const lim = Math.max(0, Number(maxLen || 0) || 0);
      const sliced = lim ? a.slice(0, lim) : a.slice(0);
      if (typeof mapFn === "function") {
        return sliced
          .map((v) => {
            try { return mapFn(v); } catch { return null; }
          })
          .filter((v) => v != null);
      }
      return sliced;
    } catch {
      return [];
    }
  }

  function rsNormalizeRecordForStorage(rec) {
    try {
      const r = rec && typeof rec === "object" ? rec : {};

      const title = rsTrimString(r.title || "", __RS_MAX_TEXT_LEN);
      const page = rsTrimString(r.page || "", __RS_MAX_URL_LEN);
      const url = rsTrimString(r.url || "", __RS_MAX_URL_LEN);
      const key = rsTrimString(r.key || url || "", __RS_MAX_URL_LEN);

      // Keep only small text/link/image snapshots in the main record.
      // (Full DOM captures can explode localStorage and make state appear "stuck".)
      const links = rsTrimArray(r.links, __RS_MAX_LINKS_PER_RECORD, (t) => rsTrimString(String(t || ""), __RS_MAX_TEXT_LEN));
      const images = rsTrimArray(r.images, __RS_MAX_IMAGES_PER_RECORD, (u) => rsTrimString(String(u || ""), __RS_MAX_URL_LEN));

      // media is structured; keep only a few and trim strings
      const media = rsTrimArray(r.media, __RS_MAX_MEDIA_PER_RECORD, (m) => {
        try {
          const mm = m && typeof m === "object" ? m : {};
          return {
            bestUrl: rsTrimString(mm.bestUrl || "", __RS_MAX_URL_LEN),
            directUrl: rsTrimString(mm.directUrl || "", __RS_MAX_URL_LEN),
            baseUrl: rsTrimString(mm.baseUrl || "", __RS_MAX_URL_LEN),
            alt: rsTrimString(mm.alt || "", __RS_MAX_TEXT_LEN),
            id: rsTrimString(mm.id || "", 80),
            from: rsTrimString(mm.from || "", 40),
          };
        } catch {
          return null;
        }
      });

      const out = {
        collectedAt: rsTrimString(r.collectedAt || rsNowIso(), 40),
        key,
        page,
        url,
        title,
        links,
        images,
        linkCount: Number.isFinite(Number(r.linkCount)) ? Number(r.linkCount) : links.length,
        imageCount: Number.isFinite(Number(r.imageCount)) ? Number(r.imageCount) : images.length,
        source: rsTrimString(r.source || "", 30),
      };

      // Only include media if present (keeps JSON smaller)
      if (media && media.length) out.media = media;

      return out;
    } catch {
      return rec;
    }
  }

  function rsApproxByteSize(obj) {
    try {
      return new Blob([JSON.stringify(obj)]).size;
    } catch {
      try {
        // very rough fallback
        return String(JSON.stringify(obj) || "").length * 2;
      } catch {
        return 0;
      }
    }
  }

  function rsCompactState(state, { targetBytes = 3800000 } = {}) {
    try {
      const st = state && typeof state === "object" ? state : rsEnsureInit();
      st.reddit = st.reddit && typeof st.reddit === "object" ? st.reddit : {};
      const rs = st.reddit;

      // Trim logs (they grow fast)
      try {
        if (Array.isArray(rs.logs) && rs.logs.length > __RS_MAX_LOGS) {
          rs.logs = rs.logs.slice(-__RS_MAX_LOGS);
        }
      } catch {}

      // Soft-cap records (keep newest) — optional.
      // If __RS_MAX_RECORDS_SOFT is 0/falsey, we rely on byte-size compaction below instead.
      try {
        if (__RS_MAX_RECORDS_SOFT && Array.isArray(rs.records) && rs.records.length > __RS_MAX_RECORDS_SOFT) {
          rs.records = rs.records.slice(-__RS_MAX_RECORDS_SOFT);
        }
      } catch {}

      // Rebuild dedupe index from kept records
      try {
        rs.__urlKeys = {};
        const recs = Array.isArray(rs.records) ? rs.records : [];
        for (const rec of recs) {
          const k = String(rec?.key || rec?.url || "").trim();
          if (k) rs.__urlKeys[k] = 1;
        }
      } catch {}

      // If still too big, progressively trim record payload fields
      try {
        let bytes = rsApproxByteSize(st);
        if (bytes > targetBytes) {
          const recs = Array.isArray(rs.records) ? rs.records : [];
          // shrink each record's link/image arrays
          for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!r || typeof r !== "object") continue;
            try {
              if (Array.isArray(r.links) && r.links.length > 40) r.links = r.links.slice(0, 40);
              if (Array.isArray(r.images) && r.images.length > 25) r.images = r.images.slice(0, 25);
              if (Array.isArray(r.media) && r.media.length > 6) r.media = r.media.slice(0, 6);
            } catch {}
            if (i % 50 === 0) {
              bytes = rsApproxByteSize(st);
              if (bytes <= targetBytes) break;
            }
          }
        }

        // still too big -> drop oldest records until under target
        let bytes2 = rsApproxByteSize(st);
        if (bytes2 > targetBytes) {
          let recs = Array.isArray(rs.records) ? rs.records : [];
          while (recs.length > 200 && bytes2 > targetBytes) {
            recs = recs.slice(-Math.max(200, Math.floor(recs.length * 0.85)));
            rs.records = recs;
            bytes2 = rsApproxByteSize(st);
          }
          // rebuild keys again
          rs.__urlKeys = {};
          for (const rec of rs.records || []) {
            const k = String(rec?.key || rec?.url || "").trim();
            if (k) rs.__urlKeys[k] = 1;
          }
        }
      } catch {}

      rs.updatedAt = rsNowIso();
      st.reddit = rs;
      return st;
    } catch {
      return state;
    }
  }

  function rsSafeSetState(state, { compactOnFail = true } = {}) {
    try {
      window?.QCoreContent?.setState(state);
      return true;
    } catch (e) {
      if (!compactOnFail) return false;
      try {
        const compacted = rsCompactState(state);
        window?.QCoreContent?.setState(compacted);
        return true;
      } catch {
        return false;
      }
    }
  }

  function rsDedupPush(state, rec) {
    try {
      const st = state && typeof state === "object" ? state : rsEnsureInit();
      st.reddit = st.reddit && typeof st.reddit === "object" ? st.reddit : {};
      const rs = st.reddit;

      rs.records = Array.isArray(rs.records) ? rs.records : [];
      rs.__urlKeys = rs.__urlKeys && typeof rs.__urlKeys === "object" && !Array.isArray(rs.__urlKeys) ? rs.__urlKeys : {};

      const normalized = rsNormalizeRecordForStorage(rec);
      const key = String(normalized?.key || normalized?.url || "").trim();
      if (!key) return false;

      if (rs.__urlKeys[key]) {
        return false;
      }

      rs.__urlKeys[key] = 1;
      rs.records.push(normalized);
      // Monotonic total (does not decrease when we compact/trim stored records)
      try {
        const base = Number.isFinite(Number(rs.totalCapturedEver))
          ? Number(rs.totalCapturedEver)
          : Math.max(0, (rs.records.length || 1) - 1); // records already includes this push
        rs.totalCapturedEver = base + 1;
      } catch {}


      // Keep state small + persist reliably
      const compacted = rsCompactState(st);
      rsSafeSetState(compacted);

      return true;
    } catch {
      try {
        // last-ditch: try to persist at least something
        rsSafeSetState(state);
      } catch {}
      return false;
    }
  }

    function rsFindPostTitleH1() {
      try {
        // Primary (requested): <h1 id^="post-title">
        let el = document.querySelector(__RS_POST_H1_SELECTOR);

        // Fallbacks (Reddit UI variants): keep conservative so we don't grab random headings
        if (!el) {
          el =
            document.querySelector('h1[data-testid="post-title"]') ||
            document.querySelector("shreddit-post h1") ||
            null;
        }

        if (!el) return null;

        const title = String(el.textContent || "").trim();
        if (!title) return null;

        // Strict validation when we have an id; otherwise sanity-check.
        const id = String(el.getAttribute("id") || "");
        const strictHit = !!(id && id.startsWith("post-title"));

        if (!strictHit) {
          if (title.length < 3 || title.length > 300) return null;
        }

        return { el, title };
      } catch {
        return null;
      }
    }
  // ---------- Images ----------
  // Reddit now renders media in a few different patterns; per request we explicitly grab:
  //  - img#post-image (and id^="post-image")
  //  - any other meaningful <img> URLs in/near the post container
  //
  // We store BOTH:
  //  - bestUrl   (best/largest candidate we can infer from src/srcset/currentSrc)
  //  - directUrl (a queryless / host-swapped variant when possible)
  //
  // NOTE: "directUrl" is best-effort; some previews are signed. We keep both.
  function rsDecodeUrl(u) {
    try {
      return String(u || "").replace(/&amp;/g, "&").trim();
    } catch {
      return "";
    }
  }

  function rsLooksLikeMediaUrl(u) {
    try {
      const s = rsDecodeUrl(u);
      if (!s) return false;
      if (s.startsWith("data:")) return false;

      // Ignore Reddit static assets / sprites
      if (/redditstatic\.com/i.test(s)) return false;
      if (/styles\.redditmedia\.com/i.test(s)) return false;

      // Keep likely media hosts
      return /(\b|\/)(i\.redd\.it|preview\.redd\.it|external-preview\.redd\.it|i\.redd\.it|redditmedia\.com|redd\.it)\b/i.test(s);
    } catch {
      return false;
    }
  }

  function rsParseSrcset(srcset) {
    const out = [];
    try {
      const s = String(srcset || "").trim();
      if (!s) return out;
      const parts = s.split(",");
      for (const part of parts) {
        const p = String(part || "").trim();
        if (!p) continue;
        const segs = p.split(/\s+/).filter(Boolean);
        const url = rsDecodeUrl(segs[0] || "");
        if (!url) continue;
        let w = 0;
        const d = String(segs[1] || "").trim();
        if (d && /w$/i.test(d)) {
          const n = parseInt(d.replace(/[^0-9]/g, ""), 10);
          if (Number.isFinite(n)) w = n;
        }
        out.push({ url, w });
      }
    } catch {}
    return out;
  }

  function rsPickBestSrcsetUrl(list) {
    try {
      const arr = Array.isArray(list) ? list : [];
      if (!arr.length) return "";
      // Prefer the largest width candidate
      let best = arr[0];
      for (const it of arr) {
        if (!it || !it.url) continue;
        if ((it.w || 0) > (best.w || 0)) best = it;
      }
      return rsDecodeUrl(best.url || "");
    } catch {
      return "";
    }
  }

  function rsNormalizeMediaUrl(u) {
    try {
      const s = rsDecodeUrl(u);
      if (!s) return "";
      const url = new URL(s, location.href);
      return url.href;
    } catch {
      return rsDecodeUrl(u);
    }
  }

  function rsDeriveDirectMediaUrl(u) {
    try {
      const raw = rsNormalizeMediaUrl(u);
      if (!raw) return { bestUrl: "", directUrl: "", baseUrl: "" };

      const url = new URL(raw);
      const baseUrl = url.origin + url.pathname; // queryless

      // Best-effort "direct" for preview.redd.it -> i.redd.it (original host)
      let directUrl = baseUrl;
      try {
        if (/^preview\.redd\.it$/i.test(url.hostname)) {
          directUrl = "https://i.redd.it" + url.pathname;
        } else if (/^external-preview\.redd\.it$/i.test(url.hostname)) {
          // keep queryless base (can't reliably swap host)
          directUrl = baseUrl;
        } else if (/^i\.redd\.it$/i.test(url.hostname)) {
          directUrl = baseUrl;
        }
      } catch {}

      return { bestUrl: raw, directUrl, baseUrl };
    } catch {
      const s = rsDecodeUrl(u);
      return { bestUrl: s, directUrl: s, baseUrl: s };
    }
  }

  function rsBestImageUrlFromImg(img) {
    try {
      if (!img) return "";
      const candidates = [];

      try {
        const cs = rsDecodeUrl(img.currentSrc || "");
        if (cs) candidates.push(cs);
      } catch {}

      try {
        const src = rsDecodeUrl(img.src || "");
        if (src) candidates.push(src);
      } catch {}

      try {
        const attr = rsDecodeUrl(img.getAttribute("src") || "");
        if (attr) candidates.push(attr);
      } catch {}

      // srcset: choose largest
      try {
        const ss = img.getAttribute("srcset") || "";
        const parsed = rsParseSrcset(ss);
        const bestFromSet = rsPickBestSrcsetUrl(parsed);
        if (bestFromSet) candidates.unshift(bestFromSet);
        // also push all srcset urls (so we can choose queryless later if needed)
        for (const it of parsed) {
          if (it?.url) candidates.push(rsDecodeUrl(it.url));
        }
      } catch {}

      // Choose first "media-looking" candidate
      for (const c of candidates) {
        const url = rsNormalizeMediaUrl(c);
        if (url && rsLooksLikeMediaUrl(url)) return url;
      }

      // Fallback: first candidate
      return rsNormalizeMediaUrl(candidates[0] || "");
    } catch {
      return "";
    }
  }

  function rsCollectImagesNearPost(foundTitleEl) {
    const seen = new Set();
    const out = [];

    const push = (imgEl, urlLike, meta = {}) => {
      try {
        const best = rsNormalizeMediaUrl(urlLike || "");
        if (!best) return;

        const { bestUrl, directUrl, baseUrl } = rsDeriveDirectMediaUrl(best);

        const key = String(directUrl || bestUrl || baseUrl || "").trim();
        if (!key) return;
        if (seen.has(key)) return;
        seen.add(key);

        out.push({
          bestUrl: bestUrl || "",
          directUrl: directUrl || "",
          baseUrl: baseUrl || "",
          alt: String(meta.alt || "").trim(),
          id: String(meta.id || "").trim(),
          from: String(meta.from || "").trim(),
        });
      } catch {}
    };

    try {
      // 1) Explicit per-request selector: img#post-image (+ id^=post-image)
      const explicit = Array.from(document.querySelectorAll(__RS_POST_IMAGE_SELECTOR) || []);
      for (const img of explicit) {
        const best = rsBestImageUrlFromImg(img);
        push(img, best, { id: img.id || "", alt: img.alt || "", from: "post-image" });
      }
    } catch {}

    try {
      // 2) Prefer searching within the post container (less noise)
      const root =
        (foundTitleEl && (foundTitleEl.closest("shreddit-post") || foundTitleEl.closest('div[data-testid="post-container"]') || foundTitleEl.closest("article"))) ||
        null;

      const scope = root || document;
      const imgs = Array.from(scope.querySelectorAll("img") || []);

      for (const img of imgs) {
        // Skip if already handled by explicit selector
        if (String(img?.id || "").startsWith("post-image")) {
          const best = rsBestImageUrlFromImg(img);
          push(img, best, { id: img.id || "", alt: img.alt || "", from: "scope" });
          continue;
        }

        const best = rsBestImageUrlFromImg(img);
        if (!best) continue;

        // Keep only likely media URLs (avoid sprites / UI icons)
        if (!rsLooksLikeMediaUrl(best)) continue;

        // Avoid tiny icons
        try {
          const r = img.getBoundingClientRect();
          if (r && (r.width < 40 || r.height < 40)) continue;
        } catch {}

        push(img, best, { id: img.id || "", alt: img.alt || "", from: "scope" });
      }
    } catch {}

    // Dedupe already handled via Set
    return out;
  }


    function rsIsProbablyPostUrl(urlObj) {
      try {
        if (!urlObj) return false;
        const u = urlObj instanceof URL ? urlObj : new URL(String(urlObj), location.href);
        if (!rsIsRedditHost(u.href)) return false;

        // Prefer comment-thread style URLs.
        // Examples:
        //  - /r/sub/comments/abc123/title/
        //  - /comments/abc123/title/
        if (!/\/comments\//i.test(String(u.pathname || ""))) return false;

        return true;
      } catch {
        return false;
      }
    }

    function rsAnchorUrl(a) {
      try {
        if (!a) return null;

        let href = "";
        if (typeof a === "string") {
          href = a;
        } else {
          href = String(a.getAttribute?.("href") || a.href || "");
        }

        href = String(href || "").trim();
        if (!href) return null;
        if (href === "#" || href.startsWith("javascript:")) return null;

        return new URL(href, location.href);
      } catch {
        return null;
      }
    }



    function rsIsVisible(el) {
      try {
        const r = el.getBoundingClientRect();
        if (!r) return false;
        if (r.width < 2 || r.height < 2) return false;
        return true;
      } catch {
        return true;
      }
    }

    // Collect raw <a> text + <img> srcs in a scope (per-request: article → { links, images }).
    function rsCollectLinkTextsInScope(scopeEl, { max = 220 } = {}) {
      try {
        const scope = scopeEl || document;
        const out = [];
        const seen = new Set();

        const anchors = Array.from(scope.querySelectorAll("a"));
        for (const a of anchors) {
          const t = String(a?.textContent || "")
            .trim()
            .replace(/\s+/g, " ");
          if (!t) continue;
          if (t.length > 600) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          out.push(t);
          if (out.length >= (max || 220)) break;
        }

        return out;
      } catch {
        return [];
      }
    }

    function rsCollectImageSrcsInScope(scopeEl, { max = 120 } = {}) {
      try {
        const scope = scopeEl || document;
        const out = [];
        const seen = new Set();

        const imgs = Array.from(scope.querySelectorAll("img"));
        for (const img of imgs) {
          let src = "";
          try {
            src = rsDecodeUrl(img.currentSrc || img.src || img.getAttribute("src") || "");
          } catch {
            src = "";
          }
          src = String(src || "").trim();
          if (!src) continue;
          if (src.startsWith("data:")) continue;
          if (seen.has(src)) continue;
          seen.add(src);
          out.push(src);
          if (out.length >= (max || 120)) break;
        }

        return out;
      } catch {
        return [];
      }
    }

    function rsHash32(str) {
      // djb2 -> unsigned 32-bit -> base36
      try {
        const s = String(str || "");
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
          h = ((h << 5) + h) + s.charCodeAt(i);
          h = h >>> 0;
        }
        return h.toString(36);
      } catch {
        try { return String(Date.now()); } catch { return "0"; }
      }
    }

    function rsMakeRecordKey({ url = "", page = "", links = [], images = [] } = {}) {
      try {
        const u = String(url || "").trim();
        if (u) return u;

        const p = String(page || "").trim();
        const l = Array.isArray(links) ? links : [];
        const im = Array.isArray(images) ? images : [];

        const raw = [p, ...l, ...im].join("|");
        return "a_" + rsHash32(raw);
      } catch {
        return "a_" + rsHash32(String(Date.now()));
      }
    }

    // Collect images strictly within a given DOM scope (used for listing posts).
    function rsCollectImagesInScope(scopeEl, { max = 8 } = {}) {
      try {
        const scope = scopeEl || document;
        const out = [];
        const seen = new Set();

        const push = (url, meta = {}) => {
          const u = rsCanonicalUrl(url);
          if (!u) return;
          if (seen.has(u)) return;
          seen.add(u);
          out.push({ url: u, ...meta });
        };

        const imgs = Array.from(scope.querySelectorAll("img"));
        for (const img of imgs) {
          const u = rsBestImageUrlFromImg(img);
          if (!u) continue;
          if (!rsLooksLikeMediaUrl(u)) continue;

          const w = Number(img.naturalWidth || img.width || 0) || 0;
          const h = Number(img.naturalHeight || img.height || 0) || 0;

          // Skip tiny icons
          if (w && h && w < 120 && h < 120) continue;

          push(u, { w, h, alt: String(img.getAttribute("alt") || "") });
          if (out.length >= (max || 8)) break;
        }

        // Some Reddit layouts use <source srcset> inside <picture>
        if (out.length < (max || 8)) {
          const sources = Array.from(scope.querySelectorAll("source[srcset]"));
          for (const s of sources) {
            const ss = String(s.getAttribute("srcset") || "").trim();
            if (!ss) continue;
            const first = ss.split(",")[0]?.trim()?.split(/\s+/)[0] || "";
            if (!first) continue;
            if (!rsLooksLikeMediaUrl(first)) continue;
            push(first, { srcset: ss });
            if (out.length >= (max || 8)) break;
          }
        }

        return out;
      } catch {
        return [];
      }
    }

    function rsGuessListingTitleFromPostEl(postEl) {
      try {
        if (!postEl) return "";
        const nodes = Array.from(
          postEl.querySelectorAll('h1, h2, h3, [data-testid="post-title"], a[data-click-id="body"] h3')
        ).filter(Boolean);

        const texts = nodes
          .map((el) => String(el.textContent || "").trim().replace(/\s+/g, " "))
          .filter((t) => t && t.length >= 3 && t.length <= 400);

        if (!texts.length) return "";

        // Heuristic: pick the longest reasonable title
        texts.sort((a, b) => b.length - a.length);
        return texts[0] || "";
      } catch {
        return "";
      }
    }

    function rsFindListingPermalink(postEl) {
      try {
        if (!postEl) return "";

        // New Reddit: <shreddit-post permalink="/r/.../comments/...">
        const attrPerm =
          (typeof postEl.getAttribute === "function" &&
            (postEl.getAttribute("permalink") || postEl.getAttribute("data-permalink") || "")) ||
          "";
        const attrHref =
          (typeof postEl.getAttribute === "function" && (postEl.getAttribute("content-href") || postEl.getAttribute("href") || "")) || "";

        const raw = String(attrPerm || attrHref || "").trim();
        if (raw && raw.includes("/comments/")) return rsAnchorUrl(raw);

        // Generic: first anchor that looks like a comments permalink
        const a =
          postEl.querySelector('a[href*="/comments/"]') ||
          postEl.querySelector('a[data-testid="post-title"]') ||
          null;

        const href = a ? rsAnchorUrl(a.getAttribute("href") || a.href || "") : null;
        try {
          if (href && /\/comments\//i.test(String(href.href || href))) return href;
        } catch {}

        return "";
      } catch {
        return "";
      }
    }

    function rsScrapeListingOnce(state, { maxPosts = 120 } = {}) {
      const root = state && typeof state === "object" ? state : rsEnsureInit();

      let added = 0;
      let found = 0;

      try {
        // Per-request: this path is based on <article> scraping (links + images).
        // Fallback to other post containers if <article> isn't present in this Reddit UI variant.
        let posts = Array.from(document.querySelectorAll("article")).filter(Boolean);
        if (!posts.length) {
          posts = Array.from(document.querySelectorAll("shreddit-post, div[data-testid='post-container']")).filter(Boolean);
        }

        const slice = posts.slice(0, Math.max(10, Math.min(900, Number(maxPosts) || 120)));

        const page = rsCanonicalUrl(location.href);

        for (let i = 0; i < slice.length; i++) {
          const postEl = slice[i];
          if (!postEl) continue;

          // never scrape inside our own UI
          try {
            if (postEl.closest("[data-qcore-reddit-scrape-modal='1']")) continue;
          } catch {}

          // Extract content like the user's snippet
          const links = rsCollectLinkTextsInScope(postEl, { max: 260 });
          const images = rsCollectImageSrcsInScope(postEl, { max: 140 });

          let urlObj = null;
          try {
            urlObj = rsFindListingPermalink(postEl) || null;
          } catch {}

          const canon = urlObj ? rsCanonicalUrl(urlObj) : "";

          // Skip totally empty articles (usually layout containers)
          if (!canon && !links.length && !images.length) continue;

          found++;

          const title = rsGuessListingTitleFromPostEl(postEl) || canon || (links[0] || `article_${i + 1}`);
          const key = rsMakeRecordKey({ url: canon, page, links, images });

          const rec = {
            collectedAt: rsNowIso(),
            key,
            page,
            url: canon,
            title,
            links,
            images,
            linkCount: links.length,
            imageCount: images.length,
            source: "article",
          };

          const ok = rsDedupPush(root, rec);
          if (ok) added++;
        }
      } catch {}

      return { found, added };
    }

    // --- Scroll helpers (Reddit is infinite-scroll; without scrolling we keep seeing the same top links) ---
    function rsFindScrollContainer() {
      try {
        const cands = [];

        // Prefer app main containers when present
        try { cands.push(document.querySelector('[role="main"]')); } catch {}
        try { cands.push(document.querySelector("main")); } catch {}

        // Fallbacks
        try { cands.push(document.scrollingElement); } catch {}
        try { cands.push(document.documentElement); } catch {}
        try { cands.push(document.body); } catch {}

        let best = null;
        let bestScore = 0;

        for (const el of cands) {
          if (!el) continue;
          try {
            const sh = Number(el.scrollHeight || 0);
            const ch = Number(el.clientHeight || 0);
            if (sh <= ch + 200) continue;
            const score = sh - ch;
            if (score > bestScore) {
              best = el;
              bestScore = score;
            }
          } catch {}
        }

        return best || document.scrollingElement || document.documentElement || document.body;
      } catch {
        return document.scrollingElement || document.documentElement || document.body;
      }
    }
async function rsScrollListingOnce(modal, state, runToken, opts = {}) {
  let beforeSh = 0;
  let beforeMax = 0;
  let beforeTop = 0;
  let afterSh = 0;
  let afterMax = 0;
  let afterTop = 0;

  try {
    rsAssertStillRunning(runToken);

    const el = rsFindScrollContainer();
    const isDoc =
      el === document.scrollingElement ||
      el === document.documentElement ||
      el === document.body;

    const vh = Math.max(300, Number(window.innerHeight || 800));

    const kind = String(opts?.kind || "listing");

    // persistent bottom counter
    state.reddit.__bottomHits = state.reddit.__bottomHits || 0;

    // =========================
    // BEFORE METRICS
    // =========================
    try {
      beforeTop = isDoc
        ? Number(window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0)
        : Number(el.scrollTop || 0);
    } catch {
      beforeTop = 0;
    }

    beforeSh = isDoc
      ? Number(document.scrollingElement?.scrollHeight || document.body.scrollHeight || 0)
      : Number(el.scrollHeight || 0);

    const beforeCh = isDoc ? vh : Number(el.clientHeight || vh);
    beforeMax = Math.max(0, beforeSh - beforeCh);

    // =========================
    // SCROLL TO END
    // =========================
    if (isDoc) {
      window.scrollTo({ top: beforeMax, behavior: "instant" });
    } else {
      try {
        el.scrollTo({ top: beforeMax, behavior: "instant" });
      } catch {
        el.scrollTop = beforeMax;
      }
      try {
        el.dispatchEvent(new Event("scroll", { bubbles: true }));
      } catch {}
    }

    rsLog(
      modal,
      state,
      kind === "explore"
        ? "🧭🧩 Scrolled explore page to END"
        : "🧭⬇️ Scrolled listing feed to END",
      { to: beforeMax }
    );

    // Give the app a moment to fetch/render more items after the scroll.
    await rsSleep(1000);

    // =========================
    // AFTER METRICS
    // =========================
    try {
      afterTop = isDoc
        ? Number(window.scrollY || window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0)
        : Number(el.scrollTop || 0);
    } catch {
      afterTop = 0;
    }

    afterSh = isDoc
      ? Number(document.scrollingElement?.scrollHeight || document.body.scrollHeight || 0)
      : Number(el.scrollHeight || 0);

    const afterCh = isDoc ? vh : Number(el.clientHeight || vh);
    afterMax = Math.max(0, afterSh - afterCh);

    const grew = afterSh > beforeSh + 80;

    const atBottom = afterTop >= afterMax - 5;
    const noGrowth = !grew;

    // =========================
    // BOTTOM HIT LOGIC
    // =========================
    // Bottom hit = after scrolling to the end we are still at (or near) the bottom AND the feed did not grow.
    // Count consecutive bottom hits; reset on growth or when we are not at bottom.
    if (kind === "explore") {
      // Explore is a hub; don't track bottom-hits rotation here.
      state.reddit.__bottomHits = 0;
    } else if (atBottom && noGrowth) {
      state.reddit.__bottomHits = Number(state.reddit.__bottomHits || 0) + 1;
      rsLog(modal, state, `🧱 Bottom hit ${state.reddit.__bottomHits}/${__RS_BOTTOM_HITS_TO_EXPLORE}`);
    } else {
      if (Number(state.reddit.__bottomHits || 0) !== 0) {
        state.reddit.__bottomHits = 0;
      }
      if (grew) {
        rsLog(modal, state, "📈 Feed grew — reset bottom counter");
      }
    }

    // Persist the counter so it survives navigation
    try {
      state.reddit.updatedAt = rsNowIso();
      rsSafeSetState(state);
    } catch {}
// =========================
    // REDIRECT CONDITION
    // =========================
    if (kind !== "explore" && Number(state.reddit.__bottomHits || 0) >= __RS_BOTTOM_HITS_TO_EXPLORE) {
      rsLog(modal, state, `🚀 ${__RS_BOTTOM_HITS_TO_EXPLORE} bottom hits reached — redirecting to /explore`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      state.reddit.__bottomHits = 0;
      rsSafeSetState(state);
      await new Promise(resolve => setTimeout(resolve, 1000));
      window.location.href = "https://www.reddit.com/explore/";
      await new Promise(resolve => setTimeout(resolve, 10000));

      return {
        kind,
        beforeSh,
        afterSh,
        beforeMax,
        afterMax,
        beforeTop,
        afterTop,
        grew,
        redirected: true
      };
    }

    return {
      kind,
      beforeSh,
      afterSh,
      beforeMax,
      afterMax,
      beforeTop,
      afterTop,
      grew
    };

  } catch {
    try {
      const kind = String(opts?.kind || "listing");
      return {
        kind,
        beforeSh,
        afterSh,
        beforeMax,
        afterMax,
        beforeTop,
        afterTop,
        grew: false,
        error: true
      };
    } catch {
      return {
        kind: "listing",
        beforeSh: 0,
        afterSh: 0,
        beforeMax: 0,
        afterMax: 0,
        beforeTop: 0,
        afterTop: 0,
        grew: false,
        error: true
      };
    }
  }
}

    function rsFindCandidateAnchors(state, { tier = "post", preferUnseen = true } = {}) {
      try {
        const st = state && typeof state === "object" ? state : rsEnsureInit();
        const rs = st.reddit || {};
        const keys = rs.__urlKeys && typeof rs.__urlKeys === "object" ? rs.__urlKeys : {};

        const all = Array.from(document.querySelectorAll("a[href]"));
        const currentCanon = rsCanonicalUrl(location.href);

        const candidates = [];
        for (const a of all) {
          try {
            // never click inside our own UI
            if (a.closest("[data-qcore-reddit-scrape-modal='1']")) continue;

            const u = rsAnchorUrl(a);
            if (!u) continue;

            // Never chase login/register gates (prevents infinite loops)
            if (rsIsLoginGatePage(u.href)) continue;

            // Only http(s) — avoids mailto:, chrome:, etc
            try {
              if (!/^https?:$/i.test(String(u.protocol || ""))) continue;
            } catch {}

            const t = String(tier || "post");

            // Tier filtering
            if (t === "post") {
              if (!rsIsProbablyPostUrl(u)) continue;
            } else if (t === "internal") {
              if (!rsIsRedditHost(u.href)) continue;
            } else if (t === "any") {
              // no-op
            } else {
              // unknown -> treat as any
            }

            // avoid same-page anchors
            const canon = rsCanonicalUrl(u.href);
            if (!canon) continue;
            if (canon === currentCanon) continue;

            // Dedupe filter only for post-tier when requested
            if (t === "post" && preferUnseen && keys[canon]) continue;

            // avoid hidden/zero-size links when possible
            if (!rsIsVisible(a)) continue;

            candidates.push({ a, canon, href: u.href });
          } catch {}
        }

        return candidates;
      } catch {
        return [];
      }
    }

    function rsPickRandom(cands) {
      try {
        const n = Array.isArray(cands) ? cands.length : 0;
        if (!n) return null;
        const idx = Math.floor(Math.random() * n);
        return cands[idx] || null;
      } catch {
        return null;
      }
    }

    // ---------- Modal UI ----------
    function __qcoreMakeRedditScrapeModal({ title = "Reddit Scrape", subtitle = "" } = {}) {
      const root = document.createElement("div");
      root.dataset.qcoreRedditScrapeModal = "1";
      root.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px";

      const card = document.createElement("div");
      card.style.cssText =
        "width:min(980px,96vw);max-height:88vh;overflow:hidden;background:#0b1117;border:1px solid rgba(255,255,255,.10);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.65);display:flex;flex-direction:column;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Ubuntu;color:#e5e7eb";

      const head = document.createElement("div");
      head.style.cssText =
        "padding:14px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:12px;align-items:flex-start;justify-content:space-between";

      const left = document.createElement("div");
      const h1 = document.createElement("div");
      h1.textContent = String(title || "Reddit Scrape");
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
      const btnReset = btn("Reset (wipe state.reddit.records)", "#a855f7");
      const btnExport = btn("Export JSON", "#16a34a");
      const btnGoReddit = btn("Go → Reddit", "#1f2937");
      const btnClose = btn("Close (hide)", "#111827");

      right.appendChild(btnStart);
      right.appendChild(btnPause);
      right.appendChild(btnReset);
      right.appendChild(btnExport);
      right.appendChild(btnGoReddit);
      right.appendChild(btnClose);

      head.appendChild(left);
      head.appendChild(right);

      const stats = document.createElement("div");
      stats.style.cssText =
        "padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.82);display:flex;flex-direction:column;gap:2px";

      const lineRun = document.createElement("div");
      const lineStage = document.createElement("div");
      const lineTotals = document.createElement("div");
      const lineLast = document.createElement("div");
      stats.appendChild(lineRun);
      stats.appendChild(lineStage);
      stats.appendChild(lineTotals);
      stats.appendChild(lineLast);

      const body = document.createElement("div");
      body.style.cssText = "display:grid;grid-template-columns: 1fr;gap:10px;padding:10px 14px;overflow:auto";

      const logWrap = document.createElement("div");
      logWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const logHead = document.createElement("div");
      logHead.textContent = "Log";
      logHead.style.cssText =
        "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";
      const log = document.createElement("pre");
      log.style.cssText =
        "margin:0;padding:10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.25;color:#e5e7eb";
      log.textContent = "";

      logWrap.appendChild(logHead);
      logWrap.appendChild(log);

      const tableWrap = document.createElement("div");
      tableWrap.style.cssText = "background:#0a1020;border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden";
      const tableHead = document.createElement("div");
      tableHead.textContent = "Captured posts (latest)";
      tableHead.style.cssText =
        "padding:8px 10px;font-weight:800;border-bottom:1px solid rgba(255,255,255,.08);color:#cbd5e1;font-size:12px";

      const table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px";
      const thead = document.createElement("thead");
  thead.innerHTML =
    '<tr style="text-align:left;color:rgba(255,255,255,.75)">' +
    '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);width:92px">Img</th>' +
    '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">Title</th>' +
    '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">URL</th>' +
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
      dock.textContent = "Reddit Scrape • show";

      const __RS_MODAL_Z = 2147483647;

      const applyHiddenStyle = (hidden) => {
        try {
          root.style.display = "flex";
          if (hidden) {
            root.style.zIndex = "-999";
            root.style.pointerEvents = "none";
            root.style.opacity = "0";
            root.style.transform = "translateX(-9999px)";
          } else {
            root.style.zIndex = String(__RS_MODAL_Z);
            root.style.pointerEvents = "auto";
            root.style.opacity = "1";
            root.style.transform = "";
          }
        } catch {}
      };

      const persistUiHidden = (hidden) => {
        try {
          let state = rsEnsureInit();
          state.reddit.uiHidden = !!hidden;
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
        } catch {}
      };

      const setHidden = (hidden, { persist = true } = {}) => {
        const h = !!hidden;
        if (persist) persistUiHidden(h);
        applyHiddenStyle(h);
        if (h) dock.textContent = "Reddit Scrape • show";
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
        btnGoReddit,
        btnClose,

        setStats({ page, running, stage, totals, last } = {}) {
          lineRun.textContent = `Page: ${page || location.href}`;
          lineStage.textContent = `Run: ${running ? "🟢 running" : "⚪ stopped"}   •   Stage: ${stage || "-"}`;
          const stored = (totals?.storedCount ?? totals?.count ?? "-");
          const total = (totals?.totalEver ?? stored);
          lineTotals.textContent = `Stored: ${stored}   •   Captured total: ${total}   •   Last saved: ${totals?.lastSaved ?? "-"}`;
          lineLast.textContent = last ? `Last: ${last}` : "Last: -";
        },

        setLogs(lines) {
          try {
            log.textContent = String(lines || "");
          } catch {}
        },

        addLog(msg) {
          try {
            const ts = new Date().toLocaleTimeString("en-US");
            log.textContent = `${ts}  ${msg}\n` + log.textContent;
          } catch {}
        },

        setRows(rows) {
          while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
          (rows || []).slice(0, 80).forEach((r) => {
            const title = rsEscapeHtml(r.title || "");
            const url = rsEscapeHtml(r.url || r.page || "");

            const imgs = Array.isArray(r.images) ? r.images : [];
            let img0 = "";
            try {
              if (imgs && imgs.length) {
                const first = imgs[0];
                img0 =
                  typeof first === "string"
                    ? first
                    : String(first?.directUrl || first?.bestUrl || first?.baseUrl || first?.url || "");
              }
            } catch {}
            const img0Esc = rsEscapeHtml(img0 || "");
            const imgCount = Number.isFinite(Number(r.imageCount)) ? Number(r.imageCount) : (imgs ? imgs.length : 0);

            const imgCell = img0Esc
              ? `<a href="${img0Esc}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;color:#93c5fd">` +
                `<img src="${img0Esc}" loading="lazy" style="width:78px;height:52px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#0b1117" />` +
                `</a>` +
                `<div style="margin-top:4px;opacity:.75;font-size:11px;line-height:1">🖼️ ${imgCount}</div>`
              : `<div style="opacity:.55;font-size:11px;line-height:1">—</div>`;

            const tr = document.createElement("tr");
            tr.innerHTML =
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top">${imgCell}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</td>` +
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);word-break:break-all"><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;text-decoration:none">${url}</a></td>`;
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

    function rsUpdateModal(modal, state) {
      try {
        if (!modal) return;
        const st = state && typeof state === "object" ? state : rsEnsureInit();
        const rs = st.reddit || {};

        const records = Array.isArray(st?.reddit?.records) ? st.reddit.records : [];
        const storedCount = records.length;
        const totalEver = Number.isFinite(Number(rs.totalCapturedEver)) ? Number(rs.totalCapturedEver) : storedCount;
        const lastSaved = rs.lastSavedTitle ? `${rs.lastSavedTitle}` : (rs.lastSavedHref ? rs.lastSavedHref : "-");

        modal.setStats({
          page: location.href,
          running: !!rs.running && !rs.paused,
          stage: rs.stage || "-",
          totals: { storedCount, totalEver, lastSaved },
          last: rs.lastTickInfo || rs.lastLog || "",
        });

        // latest rows (reverse chronological)
        const latest = records.slice(-60).reverse();
        modal.setRows(latest);

        // logs (most recent first)
        try {
          const lines = (Array.isArray(rs.logs) ? rs.logs : []).slice(-160).reverse().join("\n");
          modal.setLogs(lines);
        } catch {}

        const dockCount = totalEver > storedCount ? `${storedCount}/${totalEver}` : `${storedCount}`;
        modal.dock.textContent = rs.uiHidden
          ? `Reddit Scrape • ${dockCount} • hidden (click to show)`
          : `Reddit Scrape • ${dockCount} • ${rs.running && !rs.paused ? "running" : "stopped"}`;

        // Apply hide/show without blocking runner
        try {
          if (typeof modal.setHidden === "function") {
            modal.setHidden(!!rs.uiHidden, { persist: false });
          }
        } catch {}

        // Keep visible while running unless user hid it
        try {
          if (rs.running && !rs.paused && !rs.uiHidden) modal.el.style.display = "flex";
        } catch {}
      } catch {}
    }



    function rsExportJson(state) {
      try {
        const st = state && typeof state === "object" ? state : rsEnsureInit();
        const rs = st.reddit && typeof st.reddit === "object" ? st.reddit : {};

        // Split out "index" + "database" explicitly (per request)
        const index = rs.__urlKeys && typeof rs.__urlKeys === "object" && !Array.isArray(rs.__urlKeys) ? { ...rs.__urlKeys } : {};
        const database = Array.isArray(st?.reddit?.records) ? st.reddit.records : [];

        // Export runner metadata, but DO NOT include the noisy runner.logs array (per request).
        const runner = { ...rs };
        try { delete runner.logs; } catch {}
        try { delete runner.__urlKeys; } catch {}

        const payload = {
          exportedAt: rsNowIso(),
          page: String(location.href || ""),
          // requested keys
          index,
          database,
          // backward-compat keys (older exports)
          reddit: database,
          runner,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = __qcoreMakeScrapeFilename("reddit", "json");
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(a.href);
            a.remove();
          } catch {}
        }, 400);
      } catch {}
    }


    function rsResetAll(modal) {
      try {
        // Stop any heartbeat loop
        rsStopHeartbeat();
        const st = rsEnsureInit();
        st.reddit = { records: [] };

        st.reddit = st.reddit && typeof st.reddit === "object" ? st.reddit : {};
        const rs = st.reddit;

        rs.running = false;
        rs.paused = false;
        rs.status = "idle";
        st.status = "idle";
        rs.uiHidden = false;
        rs.stage = "idle";
        rs.tickId = 0;

        // reset per-page scroll/end detection
        rs.pageScrolls = 0;
        rs.pageNoGrowthStreak = 0;
        rs.pageLastScrollHeight = 0;
        rs.exploreShowMoreClicks = 0;
        rs.exploreLastGridClickAtMs = 0;

        rs.lastTickInfo = "reset";
        rs.lastLog = "reset";

        rs.lastPageHref = "";
        rs.pageTicks = 0;

        rs.lastClickHref = "";
        rs.lastSavedHref = "";
        rs.lastSavedTitle = "";

        rs.totalCapturedEver = 0;

        rs.logs = [];
        rs.__urlKeys = {};

        rs.updatedAt = rsNowIso();
        st.reddit = rs;

        rsSafeSetState(st);
        rsLog(modal, st, "🧹 Reset: cleared state.reddit.records + runner state");
        rsUpdateModal(modal, st);
      } catch {}
    }

    function rsStart(modal) {
      const st = rsEnsureInit();
      const rs = st.reddit;

      // increment tickId so any in-flight async work aborts immediately
      rs.tickId = Number(rs.tickId || 0) + 1;

      // Clear any stale in-flight lock (can happen if a previous tick got stuck mid-await)
      try {
        __rsTickInFlight = false;
        window.__rsTickInFlight = false;
        __rsTickStartedAtMs = 0;
        window.__rsTickStartedAtMs = 0;
      } catch {}

      rs.running = true;
      rs.paused = false;
      rs.status = "run";
      st.status = "run";
      rs.stage = "run";
      rs.lastTickInfo = "start/resume";
      rs.updatedAt = rsNowIso();

      st.reddit = rs;
      rsSafeSetState(st);

      // Keep a 1s heartbeat so the loop survives SPA navigation
      rsEnsureHeartbeat();

      rsLog(modal, st, "🚀 Start / Resume clicked");
      rsUpdateModal(modal, st);

      // If not on Reddit, jump there (autoboot continues the loop)
      try {
        if (!rsIsRedditHost()) {
          rsLog(modal, st, "↪️ Not on reddit.com — redirecting to Reddit home", { to: __RS_HOME_URL });
          location.replace(__RS_HOME_URL);
          return;
        }
      } catch {}

      setTimeout(() => rsAutoTick("start_btn"), 375);
    }

    function rsPause(modal) {
      const st = rsEnsureInit();
      const rs = st.reddit;

      // IMPORTANT: increment tickId so any in-flight async work aborts immediately
      rs.tickId = Number(rs.tickId || 0) + 1;

      rs.paused = true;
      rs.running = false;
      rs.status = "paused";
      st.status = "paused";
      rs.stage = "paused";
      rs.lastTickInfo = "paused";
      rs.updatedAt = rsNowIso();

      st.reddit = rs;
      rsSafeSetState(st);

      // Stop heartbeat while paused
      rsStopHeartbeat();

      rsLog(modal, st, "⏸️ Paused (progress frozen)");
      rsUpdateModal(modal, st);
    }

    function showRedditScrapeModal({ reason = "tools_modal" } = {}) {
      let st = rsEnsureInit();
      const r = String(reason || "");
      const isAuto = r === "autoboot" || r.startsWith("auto_reopen:");

      // If the user explicitly opened the modal, clear the hidden flag.
      if (!isAuto) {
        st.reddit.uiHidden = false;
        st.reddit.updatedAt = rsNowIso();
        rsSafeSetState(st);
      }

      const existing = rsGetCtl();
      if (existing && existing.modal && document.body.contains(existing.modal.el)) {
        try {
          // Refresh from storage in case it changed since modal creation.
          st = rsEnsureInit();

          // Respect hidden state on auto-reopen.
          if (st.reddit.uiHidden && isAuto) {
            existing.modal.setHidden?.(true, { persist: false });
          } else {
            existing.modal.setHidden?.(false, { persist: false });
          }

          rsUpdateModal(existing.modal, st);
          existing.modal.addLog(`Modal opened (reuse) — ${reason}`);
        } catch {}
        return;
      }

      const modal = __qcoreMakeRedditScrapeModal({
        title: "Reddit Scrape",
        subtitle: "🎲 random <a> clicker • 🧵 post-title collector",
      });

      rsSetCtl(modal);

      rsUpdateModal(modal, st);
      modal.addLog(`Modal opened — ${reason}`);

      // Respect hidden state on auto-open
      try {
        if (st.reddit.uiHidden && isAuto) modal.setHidden?.(true, { persist: false });
      } catch {}

      // Button handlers
      modal.btnGoReddit.onclick = () => {
        try {
          const s = rsEnsureInit();
          rsSafeSetState(s);
          location.replace(__RS_HOME_URL);
        } catch {}
      };

      modal.btnStart.onclick = () => {
        try {
          flashEmoji(modal.btnStart, "🧵");
        } catch {}
        rsStart(modal);
      };
      modal.btnPause.onclick = () => {
        try {
          flashEmoji(modal.btnPause, "🟡");
        } catch {}
        rsPause(modal);
      };
      modal.btnReset.onclick = () => {
        try {
          flashEmoji(modal.btnReset, "🧹");
        } catch {}
        rsResetAll(modal);
      };
      modal.btnExport.onclick = () => {
        try {
          const s = rsEnsureInit();
          rsExportJson(s);
          rsLog(modal, s, "⬇️ Exported JSON");
          rsUpdateModal(modal, s);
        } catch {}
      };

      // Resume quickly if already running
      try {
        const s = rsEnsureInit();
        if (s.reddit.running && !s.reddit.paused) setTimeout(() => rsAutoTick("modal_open_resume"), 450);
      } catch {}
    }


    // ---------- Runner ----------
    // Heartbeat keeps the loop alive even when Reddit uses client-side navigation (SPA)

    let __rsTickInFlight = window.__rsTickInFlight ?? (window.__rsTickInFlight = false);

    // Watchdog: if a tick ever gets stuck (never reaching finally), allow future ticks to recover.
    let __rsTickStartedAtMs = window.__rsTickStartedAtMs ?? (window.__rsTickStartedAtMs = 0);


    let __rsHeartbeatIv = window.__rsHeartbeatIv ?? (window.__rsHeartbeatIv = null);



    // Navigation guard (prevents Chrome IPC flooding protection from triggering)
    let __rsNavLockUntilMs = window.__rsNavLockUntilMs ?? (window.__rsNavLockUntilMs = 0);
    let __rsNavLastNavMs = window.__rsNavLastNavMs ?? (window.__rsNavLastNavMs = 0);
    let __rsNavWindowStartMs = window.__rsNavWindowStartMs ?? (window.__rsNavWindowStartMs = 0);
    let __rsNavWindowCount = window.__rsNavWindowCount ?? (window.__rsNavWindowCount = 0);



    const __RS_NAV_MIN_GAP_MS = 1350;   // slowed down 50% (min gap between nav attempts)   // minimum gap between navigation attempts
    const __RS_NAV_LOCK_MS = 2100;     // slowed down 50% (lock window after a nav attempt)     // lock window after a nav attempt
    const __RS_NAV_WINDOW_MS = 15000;  // rolling window for flood detection
    const __RS_NAV_WINDOW_MAX = 10;    // max nav attempts per window before pausing

    function rsNavGuardBegin({ fromHref = "", toHref = "", reason = "" } = {}) {
      try {
        const now = rsNowMs();
        if (now < __rsNavLockUntilMs) return { ok: false, why: "lock", now };
        if (__rsNavLastNavMs && now - __rsNavLastNavMs < __RS_NAV_MIN_GAP_MS) return { ok: false, why: "min_gap", now };

        if (!__rsNavWindowStartMs || now - __rsNavWindowStartMs > __RS_NAV_WINDOW_MS) {
          __rsNavWindowStartMs = now;
          __rsNavWindowCount = 0;
        }
        __rsNavWindowCount += 1;

        __rsNavLastNavMs = now;
        __rsNavLockUntilMs = now + __RS_NAV_LOCK_MS;

        if (__rsNavWindowCount > __RS_NAV_WINDOW_MAX) {
          return { ok: false, why: "flood", now, count: __rsNavWindowCount, windowStartMs: __rsNavWindowStartMs };
        }

        return { ok: true, now, count: __rsNavWindowCount, windowStartMs: __rsNavWindowStartMs };
      } catch {
        return { ok: true, now: rsNowMs(), count: 0, windowStartMs: 0 };
      }
    }

    function rsNavGuardLock(extraMs = 0) {
      try {
        const now = rsNowMs();
        __rsNavLockUntilMs = Math.max(__rsNavLockUntilMs || 0, now + Number(extraMs || 0));
      } catch {}
    }


    function rsEnsureHeartbeat() {
      try {
        if (__rsHeartbeatIv) return;
        __rsHeartbeatIv = setInterval(() => {
          try {
            const st = rsEnsureInit();
            const rs = st.reddit || {};
            if (!rs.running || rs.paused) return;
            rsAutoTick("heartbeat");
          } catch {}
        }, __RS_STEP_DELAY_MS);
      } catch {}
    }

    function rsStopHeartbeat() {
      try {
        if (!__rsHeartbeatIv) return;
        clearInterval(__rsHeartbeatIv);
        __rsHeartbeatIv = null;
      } catch {}
    }


    function rsAbortError() {
      const e = new Error("__RS_ABORT__");
      e.__rsAbort = true;
      return e;
    }

    function rsIsStillRunning(runToken) {
      try {
        const st = rsEnsureInit();
        const rs = st.reddit || {};
        if (!rs.running || rs.paused) return false;
        if (Number(rs.tickId || 0) !== Number(runToken || 0)) return false;
        return true;
      } catch {
        return false;
      }
    }

    function rsAssertStillRunning(runToken) {
      if (!rsIsStillRunning(runToken)) throw rsAbortError();
    }

    async function rsAutoTick(reason = "tick") {

      // Allow only one tick at a time, but recover if a previous tick got stuck mid-await.
      const __now = rsNowMs();
      if (__rsTickInFlight) {
        const age = __rsTickStartedAtMs ? (__now - __rsTickStartedAtMs) : 0;
        if (age > 30000) {
          try { console.warn("🧵🤖 [RedditScrape] releasing stuck tick lock", { ageMs: age }); } catch {}
          __rsTickInFlight = false;
          window.__rsTickInFlight = false;
        } else {
          return;
        }
      }
      __rsTickInFlight = true;
      window.__rsTickInFlight = true;
      __rsTickStartedAtMs = __now;
      window.__rsTickStartedAtMs = __now;

      // Requested: delete Reddit cookies constantly while on reddit.com
      if (__RS_COOKIE_NUKE_ENABLED) {
        try { rsEnsureCookieNuker(); } catch {}
      }

      let ctl = rsGetCtl();
      let modal = ctl?.modal || null;

      // Refresh state each tick (Pause must freeze)
      let state = rsEnsureInit();
      const rs = state.reddit || {};
      const runToken = Number(rs.tickId || 0);

      // Keep the modal visible while running (across navigations / reloads)
      if (rs.running && !rs.paused) {
        try {
          if (!modal || !modal.el || !document.body.contains(modal.el)) {
            showRedditScrapeModal({ reason: `auto_reopen:${reason}` });
            ctl = rsGetCtl();
            modal = ctl?.modal || null;
          }
          if (modal && modal.el && !rs.uiHidden) modal.el.style.display = "flex";
        } catch {}
      }

      // Gate: pause if Press & Hold is active
      if (typeof __qcorePressHoldActive !== "undefined" && __qcorePressHoldActive) {
        try {
          state.reddit.lastTickInfo = "paused_for_press_hold";
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
          if (modal) rsUpdateModal(modal, state);
          rsLog(modal, state, "✋🧱 Press & Hold gate active — waiting…");
        } catch {}
        __rsTickInFlight = false;
        setTimeout(() => rsAutoTick("press_hold_gate"), __RS_STEP_DELAY_MS);
        return;
      }

      // Not running
      if (!rs.running || rs.paused) {
        try {
          rsStopHeartbeat();
        } catch {}
        if (modal) rsUpdateModal(modal, state);
        __rsTickInFlight = false;
        return;
      }

      try {
        rsLog(modal, state, `🔁 Tick → ${reason}`);

        // Ensure still running
        rsAssertStillRunning(runToken);

        // Preflight: fetch reddit.com to see if we're about to hit a 429.
        // If so, clear cookies again and refresh immediately.
        try {
          const pf = await rsPreflightHome429({ timeoutMs: 6500 });
          if (pf && pf.ok && Number(pf.status || 0) === 429) {
            try {
              state.reddit.stage = "preflight_429";
              state.reddit.lastTickInfo = "preflight_fetch_429_clear_cookies_then_reload";
              state.reddit.updatedAt = rsNowIso();
              rsSafeSetState(state);
              if (modal) rsUpdateModal(modal, state);
            } catch {}

            rsLog(modal, state, "⚠️ Preflight 429 from reddit.com — clearing cookies and reloading now");
            try {
              await rsClearSiteCookiesFor429();
            } catch {}
            try {
              location.reload();
            } catch {
              try { location.replace(__RS_HOME_URL); } catch {}
            }
            return;
          }
        } catch {}

        // Requested: refresh the page every 100s (export first), with a 50s wait before reload.
        try {
          const pr = __qcoreMaybePlanForcedRefresh({
            runner: state.reddit,
            exportFn: () => {
              try {
                const s2 = rsEnsureInit();
                rsExportJson(s2);
              } catch {}
            },
            note: "reddit_scrape",
          });
          if (pr && pr.pending) {
            try {
              state.reddit.stage = "force_refresh_wait";
              state.reddit.updatedAt = rsNowIso();
              rsSafeSetState(state);
              if (modal) rsUpdateModal(modal, state);
            } catch {}
            rsLog(modal, state, "♻️ Forced refresh planned — exported JSON, reloading in 50s");
            return;
          }
        } catch {}

        // Backoff window (429 rate-limit)
        const tickNowMs = rsNowMs();
        const untilMs = Number(state.reddit?.rateLimitUntilMs || 0);
        if (untilMs && tickNowMs < untilMs) {
          const remain = Math.max(0, untilMs - tickNowMs);
          try {
            state.reddit.stage = "rate_limited_429";
            state.reddit.lastTickInfo = `429_backoff (${Math.ceil(remain / 1000)}s remaining)`;
            state.reddit.updatedAt = rsNowIso();
            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);
          } catch {}
          // Heartbeat will also keep ticking, but scheduling a longer tick reduces busy-waiting.
          setTimeout(() => rsAutoTick("429_backoff"), Math.min(remain, __RS_STEP_DELAY_MS * 4));
          return;
        }

        const href = String(location.href || "");

        // If we hit Reddit rate limiting (429), clear cookies for the site and back off.
        // if (rsIsRedditHost(href) && rsIs429TooManyRequestsPage()) {
          
        //   try {
        //     const nowMs = rsNowMs();
        //     state.reddit.rateLimitUntilMs = nowMs + __RS_429_BACKOFF_MS;
        //     state.reddit.stage = "rate_limited_429";
        //     state.reddit.lastTickInfo = "429_detected_clear_cookies";
        //     state.reddit.updatedAt = rsNowIso();
        //     rsSafeSetState(state);
        //     if (modal) rsUpdateModal(modal, state);
        //     rsLog(modal, state, `⚠️ 429 Too Many Requests — clearing Reddit cookies and backing off ${Math.round(__RS_429_BACKOFF_MS / 1000)}s`);
        //   } catch {}

        //   try {
        //     await rsClearSiteCookiesFor429();
        //   } catch {}

        //   try {
        //     location.replace(__RS_HOME_URL);
        //   } catch {}

        //   return;
        // }

        // If we land on Reddit's login/register gate, bounce home fast (and avoid Chrome nav-throttling).
        if (rsIsRedditHost(href) && rsIsLoginGatePage(href)) {
          try {
            const nowMs = rsNowMs();
            const winMs = 30000;

            const blob = state.reddit || {};
            const wstart = Number(blob.loginBounceWindowStartMs || 0);

            if (!wstart || nowMs - wstart > winMs) {
              blob.loginBounceWindowStartMs = nowMs;
              blob.loginBounceCount = 0;
            }

            blob.loginBounceCount = Number(blob.loginBounceCount || 0) + 1;
            blob.stage = "login_bounce";
            blob.lastTickInfo = `login_gate_bounce (${blob.loginBounceCount})`;
            blob.updatedAt = rsNowIso();
            state.reddit = blob;

            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);

            rsLog(modal, state, "🔒 Login gate detected — going back to Reddit home", {
              from: href,
              to: __RS_HOME_URL,
              count: blob.loginBounceCount,
            });

            // Too many bounces -> pause to avoid infinite navigation flood.
            if (Number(blob.loginBounceCount || 0) >= 4) {
              blob.running = false;
              blob.paused = true;
              blob.status = "paused";
              state.status = "paused";
              blob.stage = "blocked_login_gate";
              blob.lastTickInfo = "paused_due_to_login_gate_loop";
              blob.updatedAt = rsNowIso();
              state.reddit = blob;

              rsSafeSetState(state);
              try {
                rsStopHeartbeat();
              } catch {}
              if (modal) rsUpdateModal(modal, state);

              rsLog(modal, state, "🛑 Paused: repeated login redirects. Log in (if needed) then hit Start/Resume to continue.");
              return;
            }

            const g = rsNavGuardBegin({ fromHref: href, toHref: __RS_HOME_URL, reason: "login_bounce" });
            if (!g.ok) {
              rsLog(modal, state, `⛔ Navigation throttled (${g.why}) — waiting…`, { from: href, to: __RS_HOME_URL });
              return;
            }

            // Replace (not assign) to avoid stacking history entries
            try {
              location.replace(__RS_HOME_URL);
              return;
            } catch {}

            // Fallback
            try {
              location.href = __RS_HOME_URL;
              return;
            } catch {}
          } catch {}
        }

        // Track per-page ticks (helps us wait for dynamic reddit DOM)
        if (href !== String(state.reddit.lastPageHref || "")) {
          state.reddit.lastPageHref = href;
          state.reddit.pageTicks = 0;
          // reset per-page scroll/end detectors
          state.reddit.pageScrolls = 0;
          state.reddit.pageNoGrowthStreak = 0;
          state.reddit.pageLastScrollHeight = 0;
          state.reddit.exploreShowMoreClicks = 0;
          state.reddit.stage = "page_load";
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
        } else {
          state.reddit.pageTicks = Number(state.reddit.pageTicks || 0) + 1;
        }

        const pageTicks = Number(state.reddit.pageTicks || 0);

        // 1) Capture post title if present
        const found = rsFindPostTitleH1();
        if (found) {
          const url = rsCanonicalUrl(href);

          // Per-request: capture raw <a> text + <img> srcs within the post container.
          const scope =
            (found?.el &&
              (found.el.closest("article") ||
                found.el.closest("shreddit-post") ||
                found.el.closest("div[data-testid='post-container']"))) ||
            document;

          let links = [];
          let images = [];
          try {
            links = rsCollectLinkTextsInScope(scope, { max: 260 }) || [];
          } catch {
            links = [];
          }
          try {
            images = rsCollectImageSrcsInScope(scope, { max: 140 }) || [];
          } catch {
            images = [];
          }

          // Optional: keep a small structured media snapshot for debugging / richer exports
          let media = [];
          try {
            media = (rsCollectImagesNearPost(found.el) || []).slice(0, 18);
          } catch {
            media = [];
          }

          const rec = {
            collectedAt: rsNowIso(),
            key: url,
            page: rsCanonicalUrl(location.href),
            url,
            title: found.title,
            links: Array.isArray(links) ? links : [],
            images: Array.isArray(images) ? images : [],
            linkCount: Array.isArray(links) ? links.length : 0,
            imageCount: Array.isArray(images) ? images.length : 0,
            media,
            source: "post",
          };

          const added = rsDedupPush(state, rec);

          // Save runner "last saved"
          try {
            state.reddit.lastSavedHref = url;
            state.reddit.lastSavedTitle = found.title;
            state.reddit.lastTickInfo = added ? "saved_post_title" : "duplicate_post_title";
            state.reddit.stage = "captured";
            state.reddit.updatedAt = rsNowIso();
          } catch {}

          rsSafeSetState(state);
          if (modal) rsUpdateModal(modal, state);

          rsLog(modal, state, added ? "✅🧵 Captured post-title (saved)" : "♻️🧵 Captured post-title (duplicate; skipped)", {
            url,
            title: found.title,
            imageCount: rec.imageCount,
            images: (rec.images || []).slice(0, 6),
          });

          // Redirect back to reddit.com after capture (as requested)
          try {
            rsLog(modal, state, "↩️🏠 Redirecting to reddit.com (loop continues) …", { to: __RS_HOME_URL });
          } catch {}

          try {
            location.replace(__RS_HOME_URL);
            return;
          } catch {}
        }

        // If we're on a likely post page but title isn't loaded yet, wait a few seconds before giving up.
        const isPostPath = (() => {
          try {
            return /\/comments\//i.test(String(location.pathname || ""));
          } catch {
            return false;
          }
        })();

        if (rsIsRedditHost() && isPostPath && pageTicks < 12) {
          state.reddit.stage = "wait_post_title";
          state.reddit.lastTickInfo = `waiting_for_post_title (${pageTicks}s)`;
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
          if (modal) rsUpdateModal(modal, state);
          rsLog(modal, state, `⏳ Waiting for <h1 id^="post-title">… (${pageTicks}s)`);
          setTimeout(() => rsAutoTick("wait_for_title"), __RS_STEP_DELAY_MS);
          return;
        }

        // If we're on reddit.com:
        //  - If we're on a post page AND we couldn't find <h1 id^="post-title"> after waiting, bounce home.
        //  - Otherwise, click a random <a> on *whatever listing page we're on* (/, /r/popular, /r/all, /r/<sub>, etc).
        //    This avoids getting stuck in "home redirect loops" when Reddit redirects / -> /r/popular (or similar).
        if (rsIsRedditHost()) {
          // Post page without a title after our wait window -> go home and keep looping.
          if (isPostPath) {
            state.reddit.stage = "redirect_home";
            state.reddit.lastTickInfo = `post_page_no_title_timeout (${pageTicks}s)`;
            state.reddit.updatedAt = rsNowIso();
            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);

            rsLog(modal, state, "↩️🏠 Post page had no <h1 id^=\"post-title\"> — going home to keep looping", {
              to: __RS_HOME_URL,
              from: location.href,
            });

            location.replace(__RS_HOME_URL);
            return;
          }

          // Explore hub: expand recommendations, then click a random grid item.
          const isExplore = rsIsExplorePage(href);

          if (isExplore) {
            state.reddit.stage = "explore_hub";
            state.reddit.__bottomHits = 0;
            state.reddit.updatedAt = rsNowIso();
            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);

            // Give the Explore DOM a moment to hydrate (React / SPA).
            if (pageTicks < 3) {
              state.reddit.lastTickInfo = `explore_wait_dom (${pageTicks}s)`;
              state.reddit.updatedAt = rsNowIso();
              rsSafeSetState(state);
              if (modal) rsUpdateModal(modal, state);
              setTimeout(() => rsAutoTick("explore_wait_dom"), __RS_STEP_DELAY_MS);
              return;
            }

            // Click the “Show more community recommendations” button(s) if present.
            try {
              await rsClickExploreShowMoreButtons(modal, state, runToken, { maxClicks: 4 });
            } catch {}

            // Then: click a random .show-more-grid-item a (per request).
            const cands = rsFindExploreGridAnchors();
            const pick = rsPickRandom(cands);

            if (!pick || !pick.a) {
              rsLog(modal, state, "🧩 Explore: no .show-more-grid-item links found yet — scrolling + retry");
              try {
                await rsScrollListingOnce(modal, state, runToken, { kind: "explore" });
              } catch {}
              setTimeout(() => rsAutoTick("explore_retry"), __RS_STEP_DELAY_MS);
              return;
            }

            const nav = rsNavGuardBegin({ fromHref: href, toHref: pick.href, reason: "explore_grid_pick" });
            if (!nav.ok) {
              rsLog(modal, state, `⛔ Explore navigation throttled (${nav.why}) — waiting…`, { to: pick.href });
              setTimeout(() => rsAutoTick("explore_nav_throttled"), __RS_STEP_DELAY_MS);
              return;
            }

            // Persist "last click"
            try {
              state.reddit.lastClickHref = String(pick.href || "");
              state.reddit.exploreLastGridClickAtMs = rsNowMs();
              state.reddit.stage = "explore_nav";
              state.reddit.lastTickInfo = "explore_pick_grid_item";
              state.reddit.updatedAt = rsNowIso();
              rsSafeSetState(state);
              if (modal) rsUpdateModal(modal, state);
            } catch {}

            rsLog(modal, state, "🎲🧩 Explore: clicking random .show-more-grid-item a", { href: pick.href });

            try {
              pick.a.click();
            } catch {
              try {
                location.href = pick.href;
              } catch {
                try { location.replace(pick.href); } catch {}
              }
            }
            return;
          }

          // Listing page: scroll + scrape visible posts.
          state.reddit.stage = "scrape_listing";
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
          if (modal) rsUpdateModal(modal, state);

          const res = rsScrapeListingOnce(state, { maxPosts: 220 });

          // Persist scraped records + tick info
          state.reddit.lastTickInfo = `listing: +${res.added} (seen=${res.found})`;
          state.reddit.stage = "scroll_listing";
          state.reddit.updatedAt = rsNowIso();
          rsSafeSetState(state);
          if (modal) rsUpdateModal(modal, state);

          rsLog(modal, state, `📜 Listing scrape: +${res.added}/${res.found} (total=${(Array.isArray(state?.reddit?.records) ? state.reddit.records.length : 0)})`);

          // If the feed hasn't populated yet, wait/scroll a bit before giving up.
          if (!res.found && pageTicks < 10) {
            try {
              await rsScrollListingOnce(modal, state, runToken, { direction: "down", kind: "listing" });
            } catch {}
            setTimeout(() => rsAutoTick("wait_feed"), __RS_STEP_DELAY_MS);
            return;
          }

          // If we still can't see posts after waiting, refresh hub once (helps after cookie nukes)
          if (!res.found) {
            state.reddit.stage = "redirect_home";
            state.reddit.lastTickInfo = `no_posts_detected (${pageTicks}s)`;
            state.reddit.updatedAt = rsNowIso();
            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);

            rsLog(modal, state, "🤷‍♂️ No posts detected — reloading hub", { to: __RS_HOME_URL });
            location.replace(__RS_HOME_URL);
            return;
          }

          // Scroll down to load more content
          let scrollInfo = null;
          try {
            scrollInfo = await rsScrollListingOnce(modal, state, runToken, { direction: "down", kind: "listing" });
          } catch {}

          // Update "end of page" detectors
          try {
            const prevScrolls = Number(state.reddit.pageScrolls || 0);
            const nextScrolls = prevScrolls + 1;
            state.reddit.pageScrolls = nextScrolls;

            const grew = !!(scrollInfo && scrollInfo.grew);
            const prevStreak = Number(state.reddit.pageNoGrowthStreak || 0);
            state.reddit.pageNoGrowthStreak = grew ? 0 : (prevStreak + 1);

            const afterH = Number(scrollInfo?.afterSh || 0);
            if (afterH) state.reddit.pageLastScrollHeight = afterH;

            state.reddit.updatedAt = rsNowIso();
            rsSafeSetState(state);
            if (modal) rsUpdateModal(modal, state);

            const streak = Number(state.reddit.pageNoGrowthStreak || 0);

            const reachedEnd = (streak >= __RS_END_NO_GROWTH_STREAK) || (nextScrolls >= __RS_MAX_SCROLLS_PER_PAGE);

            if (reachedEnd) {
              const why = streak >= __RS_END_NO_GROWTH_STREAK
                ? `end_of_scroll (no_growth_streak=${streak})`
                : `page_scroll_cap (${nextScrolls}/${__RS_MAX_SCROLLS_PER_PAGE})`;

              state.reddit.stage = "goto_explore";
              state.reddit.lastTickInfo = why;
              state.reddit.updatedAt = rsNowIso();
              rsSafeSetState(state);
              if (modal) rsUpdateModal(modal, state);

        
              return;
            }
          } catch {}

          setTimeout(() => rsAutoTick("listing_loop"), __RS_STEP_DELAY_MS);
          return;

        }

        // Not on reddit -> go to reddit.com
        state.reddit.stage = "redirect_home";
        state.reddit.lastTickInfo = "not_on_reddit_redirecting";
        state.reddit.updatedAt = rsNowIso();
        rsSafeSetState(state);
        if (modal) rsUpdateModal(modal, state);

        rsLog(modal, state, "↪️ Not on reddit.com — redirecting to Reddit home", { to: __RS_HOME_URL });
        location.replace(__RS_HOME_URL);
        return;
      } catch (e) {
        // Abort is expected when paused — do NOT mark as error
        if (e && (e.__rsAbort || String(e?.message || "") === "__RS_ABORT__")) {
          try {
            const st = rsEnsureInit();
            if (modal) {
              rsLog(modal, st, "🧊 Tick aborted (paused/resumed) — progress frozen");
              rsUpdateModal(modal, st);
            }
          } catch {}
          return;
        }

        // Real error
        try {
          const st = rsEnsureInit();
          st.reddit.lastTickInfo = `error: ${String(e?.message || e || "error")}`;
          st.reddit.stage = "error";
          st.reddit.updatedAt = rsNowIso();
          rsSafeSetState(st);
          if (modal) rsUpdateModal(modal, st);
          rsLog(modal, st, `💥 ERROR → ${st.reddit.lastTickInfo}`);
        } catch {}

        // Slow retry
        setTimeout(() => rsAutoTick("retry_after_error"), 2625);
      } finally {
        __rsTickInFlight = false;
        window.__rsTickInFlight = false;
        __rsTickStartedAtMs = 0;
        window.__rsTickStartedAtMs = 0;
      }
    }


  // Use window.QCoreGlobal.initCoreData() as the canonical "city list" (no dedupe, no truncation).
  // We DO NOT store the full derived list in state to keep localStorage smaller; we index window.QCoreGlobal.initCoreData() directly.
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
        rsSafeSetState(st);
      } catch {}
    }
    function zlBuildDefaultCities() {
    // Prefer the "big airports" list we already use for Google Flights origins,
    // mapping airport code → (city, region) from window.QCoreGlobal.initCoreData().
    try {
      const codes = Array.isArray(__GF_DEFAULT_AIRPORTS) ? __GF_DEFAULT_AIRPORTS : [];
      // NEW RULE: window.QCoreGlobal.initCoreData() loops only country === "USA"
      const list = Array.isArray(window.QCoreGlobal.initCoreData()) ? window.QCoreGlobal.initCoreData().filter((a) => a && a.country === "USA") : [];
      const out = [];
      const seen = new Set();

      for (const codeRaw of codes) {
        const code = String(codeRaw || "").toUpperCase();
        const ap = list.find((a) => String(a?.code || "").toUpperCase() === code);
        if (!ap) continue;

        const city = String(ap.city || "").trim();
        const region = String(ap.region || "").trim();

        const query = region ? `${city}, ${region}` : city;
        const key = String(query || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(query);
      }

      if (out.length) return out;
    } catch {}

    }

      const FFS_DEFAULTS = {
      running: false,
      autoShowModal: true,
      startOrigin: "LAX",
      maxHops: 3,
      runId: 0,
      startedAt: 0,
      stoppedAt: 0,
      lastTickAt: 0,
      lastTickInfo: "",
      lastError: "",
      // plan.phase = legIndex (0 = first hop, 1 = second hop, 2 = third hop)
      plan: {
        phase: 0,
        origins: ["LAX"],
        originIdx: 0,
        destIdx: 0,
        phaseStartedAt: 0,
        phaseCompletedAt: 0,
      },
      jobs: [],
      foundPaths: [],
    };
    function ffsEnsureFfsState(root) {
      const r = root && typeof root === "object" ? root : {};
      const cur = r.frontierFlightSearch;
      const merged = {
        ...FFS_DEFAULTS,
        ...(cur && typeof cur === "object" ? cur : {}),
      };

      // Normalize nested plan
      merged.plan = {
        ...FFS_DEFAULTS.plan,
        ...(merged.plan && typeof merged.plan === "object" ? merged.plan : {}),
      };

      // Ensure arrays
      merged.jobs = Array.isArray(merged.jobs) ? merged.jobs : [];
      merged.foundPaths = Array.isArray(merged.foundPaths) ? merged.foundPaths : [];

      // Normalize airports in plan
      merged.startOrigin = ffsNormalizeAirport(merged.startOrigin || "LAX") || "LAX";
      merged.maxHops = Math.max(1, Math.min(3, Number(merged.maxHops || 3)));
      merged.plan.origins = Array.isArray(merged.plan.origins) && merged.plan.origins.length ? merged.plan.origins.map(ffsNormalizeAirport) : [merged.startOrigin];
      merged.plan.originIdx = Math.max(0, Number(merged.plan.originIdx || 0));
      merged.plan.destIdx = Math.max(0, Number(merged.plan.destIdx || 0));
      merged.plan.phase = Math.max(0, Math.min(merged.maxHops - 1, Number(merged.plan.phase || 0)));

      r.frontierFlightSearch = merged;
      return merged;
    }



  function rsAutoBoot() {
      try {
        const state = rsEnsureInit();
        const rs = state.reddit || {};
        if (rs && rs.running && !rs.paused) {
          try {
            showRedditScrapeModal({ reason: "autoboot" });
          } catch {}
          // Ensure heartbeat continues after refresh/navigation
          rsEnsureHeartbeat();
          setTimeout(() => rsAutoTick("autoboot"), __RS_STEP_DELAY_MS);
          try {
            console.log("🧵✅ [RedditScrape] autoboot", { href: location.href, tickId: rs.tickId });
          } catch {}
        }
      } catch {}
    }

  function __register() {
    const QQ = window.QCoreToolsModal;
    if (!QQ || typeof QQ.registerTool !== 'function') return false;
    
    QQ.registerTool({
      id: "reddit",
      title: "Reddit Scrape",
      icon: "🧵",
      description: "Scrape Reddit posts/comments into JSON.",
      order: 180,
      onClick: () => { try { showRedditScrapeModal(); } catch (e) { console.error(e); } },
      autoBoot: () => { try { rsAutoBoot(); } catch {} },
    });
    try { QQ.showRedditScrapeModal = showRedditScrapeModal; } catch {}
    return true;
  }
  if (!__register()) {
    (window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || []).push(__register);
  }
})();