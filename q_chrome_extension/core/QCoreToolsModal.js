(() => { const __QCORE_TOOLS_MODAL_VERSION = "6.1-split"; const __QCORE_BUILD = "__QCORE_TOOLS_MODAL_BUILD__:v6.1_2026-02-19_split_utilfix"; if ((window.__QCORE_TOOLS_MODAL_BUILD__ === __QCORE_BUILD && (window.QCoreToolsModal))) return; window.__QCORE_TOOLS_MODAL_BUILD__ = __QCORE_BUILD; try { window.__QCORE_TOOLS_MODAL_VERSION__ = __QCORE_TOOLS_MODAL_VERSION; } catch {};
// ------------------------------ HARD PAGE GATE (google.com) ------------------------------
// Requirement:
// - Do absolutely nothing on google.com unless the path starts with /travel/explore (querystring OK).
// - Never auto-redirect to /travel/explore (or anywhere).
const __QCORE_TOOLS_MODAL_PAGE_GATE = (() => {
  try {
    const host = String(location.hostname || "").replace(/^www\./, "").toLowerCase();
    const path = String(location.pathname || "/");
    const isGoogle = host === "google.com" || host.endsWith(".google.com");
    const isExplore = path.startsWith("/travel/explore");
    if (isGoogle && !isExplore) return { allowed: false, why: "google_non_explore" };
    return { allowed: true, why: "ok" };
  } catch {
    return { allowed: true, why: "exception" };
  }
})();
if (!__QCORE_TOOLS_MODAL_PAGE_GATE.allowed) return;

// core/QCoreToolsModal.js
// QCoreToolsModal — “[Tools]” popup (full fat, now with lazy-loading for QCorePeopleManager)
// Fix: Clicking “People Manager” no longer fails with “QCorePeopleManager not loaded”.
//      We add a robust lazy loader that injects /core/QCorePeopleManager.js (MV3-safe) and waits for window.QCorePeopleManager.
//
// UPDATE: Added “Dashboard Panel” button + live health checks for your /var/www domain symlinks.
// - Performs async checks for each site (green/red/yellow) via background message if available (best), else falls back to page fetch (limited by CORS).
// - Totals + per-site list + last-checked timestamp.
// - Hardcoded site list inside this file (as requested).
// ============================================================================
// [Q] FILE HEADER — QCoreToolsModal
// ============================================================================
// 📄 File: core/QCoreToolsModal.js
// 🧠 What it does:
//   - Injects the in-page “[Tools]” modal + multiple site automations (“tools”).
//   - Persists runner progress in shared Q state (window?.QCoreContent?.getState/window?.QCoreContent?.setState), mirrored to localStorage + window.name.
//   - Auto-boots long-running tools after navigation when their state says "running".
//
// ✅ How to use (quick):
//   1) Open the “[Tools]” popup.
//   2) Click a tool button. Many tools open their own mini-modal with Start/Pause/Export.
//   3) While a runner is active, you can navigate; it will auto-resume via state.
//
// Tools (quick guide):
//   - People Manager: Lazy-loads /core/QCorePeopleManager.js then opens the People UI.
//   - Dashboard Panel: Runs /var/www symlink health checks (background helper if available).
//   - Copy URLs / Clear Site Data: Utility helpers (chrome.runtime messaging).
//   - Google Flights (Explore): Collects price cards ONLY on https://www.google.com/travel/explore.
//   - Zillow: Collects property cards into state.zillow.
//   - Reddit Scrape: Randomly clicks reddit links, captures post titles + images into state.reddit.
//   - Amazon Scrape: Runs many search queries and saves deduped products into state.amazon.products.
//   - Frontier Flight Search / Epstein Files Helper / Suno Download / Grok Download: Misc runners & helpers.
//
// ⚠️ Page gating:
//   - On google.com regular Search pages, we do NOT bootstrap ToolsModal.
//     Only the Google Travel Explore page is allowed (prevents accidental scraping).
// ============================================================================

// ------------------------------ Page Gate (google.com) ------------------------------
  const __qcoreSleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms || 0))));






  // ------------------------------ NEW: Robust Lazy Loader for Plugins ------------------------------
  // MV3-safe loader that injects a <script src="chrome-extension://.../core/FILE.js"> into the *page* context,
  // resolves when the global symbol appears or rejects on timeout.
  async function loadPluginIfNeeded({ globalCheck, filePath, symbolPath, timeoutMs = 15000 }) {
    // If already present, resolve fast
    try {
      const existing = globalCheck();
      if (existing) return existing;
    } catch {}

    // Build extension URL if possible; else try relative (best-effort in dev)
    let url = filePath;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        url = chrome.runtime.getURL(filePath);
      }
    } catch {}

    // Avoid double-inject by src
    const already = Array.from(document.querySelectorAll("script[src]")).some((s) => s.src === url);
    if (!already) {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.crossOrigin = "anonymous";
      // Ensure it runs in page context (content scripts append to document)
      (document.head || document.documentElement).appendChild(s);
    }

    // Wait for symbol to appear
    const started = Date.now();
    return await new Promise((resolve, reject) => {
      const iv = setInterval(() => {
        try {
          // resolve on first truthy global
          const ok = globalCheck();
          if (ok) {
            clearInterval(iv);
            resolve(ok);
            return;
          }
          // timeout
          if (Date.now() - started > timeoutMs) {
            clearInterval(iv);
            reject(new Error(`Timeout loading ${symbolPath} from ${filePath}`));
          }
        } catch (e) {
          clearInterval(iv);
          reject(e);
        }
      }, 150);
    });
  }

  // Specialized helper for People Manager
  async function ensurePeopleManager(btn) {
    const flash = (el, emoji) => {
      try {
        flashEmoji(el, emoji);
      } catch {}
    };
    try {
      const PM = await loadPluginIfNeeded({
        globalCheck: () =>
          window.QCorePeopleManager && typeof window.QCorePeopleManager.QPeopleManagerView === "function"
            ? window.QCorePeopleManager
            : null,
        filePath: "core/QCorePeopleManager.js",
        symbolPath: "window.QCorePeopleManager",
      });
      flash(btn, "🟢");
      return PM;
    } catch (e) {
      console.error("[QCoreToolsModal] Failed to load QCorePeopleManager:", e);
      flash(btn, "🔴");
      throw e;
    }
  }

  // ------------------------------ UI Helpers ------------------------------
  function flashEmoji(target, emoji = "🟢") {
    try {
      // micro click/scale feedback
      const prevT = target.style.transition;
      const prevX = target.style.transform;
      target.style.transition = "transform 120ms ease";
      target.style.transform = "scale(0.97)";
      setTimeout(() => {
        target.style.transform = prevX || "scale(1)";
        target.style.transition = prevT || "";
      }, 120);

      // bubble
      const parent = target.parentElement || document.body;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      const span = document.createElement("span");
      span.textContent = emoji;
      span.style.cssText =
        "position:absolute;right:-10px;top:-8px;opacity:1;transition:opacity .6s ease,transform .6s ease;pointer-events:none";
      parent.appendChild(span);
      requestAnimationFrame(() => {
        span.style.opacity = "0";
        span.style.transform = "translateY(-10px)";
      });
      setTimeout(() => span.remove(), 650);
    } catch {}
  }

  function safeNowIso() {
    try {
      return new Date().toISOString();
    } catch {
      return "1970-01-01T00:00:00.000Z";
    }
  }









































  

  // ------------------------------ Uniq ID helper (back-compat) ------------------------------
  // Legacy scripts sometimes call `qcoreUniq()` directly. We keep that global alias.
  let __qcoreUniqSeq = 0;
  function __qcoreUniq(prefix = "q") {
    try {
      __qcoreUniqSeq = (__qcoreUniqSeq + 1) % 1000000000;
      const p = String(prefix || "q").trim().replace(/[^a-z0-9_-]+/gi, "_") || "q";
      const t = Date.now().toString(36);
      const s = __qcoreUniqSeq.toString(36);
      const r = Math.random().toString(36).slice(2, 8);
      return `${p}_${t}_${s}_${r}`;
    } catch {
      return `q_${Date.now()}`;
    }
  }

  try {
    if (!window.qcoreUniq) window.qcoreUniq = __qcoreUniq;
  } catch {}
function __qcoreSanitizeProjectName(name) {
  try {
    let s = String(name || "").trim();
    if (!s) return "";
    s = s.toLowerCase();
    s = s.replace(/^database[_-]+/i, "");
    s = s.replace(/^q_scrape[_-]+/i, "");
    s = s.replace(/[\s\-]+/g, "_");
    s = s.replace(/[^a-z0-9_]/g, "");
    s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    return s;
  } catch {
    return "";
  }
}

function __qcoreUnixTimestamp() {
  try {
    return Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

function __qcoreMakeScrapeFilename(projectName) {
  try {
    let proj = __qcoreSanitizeProjectName(projectName);
    if (!proj || proj === "unknown") {
      try {
        const host = String(location.hostname || "")
          .trim()
          .toLowerCase()
          .replace(/^www\./, "");
        proj = __qcoreSanitizeProjectName(host.replace(/\./g, "_"));
      } catch {}
    }
    if (!proj) proj = "unknown";
    const ts = __qcoreUnixTimestamp() || 0;
    return `q_scrape_${proj}_${ts}.json`;
  } catch {
    return `q_scrape_unknown_${__qcoreUnixTimestamp() || 0}.json`;
  }
}

function __qcoreDeriveProjectFromFile(file) {
  try {
    const n = String((file && file.name) || "").trim();
    if (!n) return "unknown";
    const m = n.match(/^q_scrape_(.+?)_\d{9,13}\.(json|txt)$/i);
    if (m && m[1]) return __qcoreSanitizeProjectName(m[1]) || "unknown";
    const base = n.replace(/\.[^.]+$/, "");
    return __qcoreSanitizeProjectName(base) || "unknown";
  } catch {
    return "unknown";
  }
}

function __qcoreNormalizeInstagramUrl(u) {
  try {
    let s = String(u || "").trim();
    if (!s) return "";
    s = s.replace(/^['"]+|['"]+$/g, "");
    s = s.replace(/^http:\/\//i, "https://");
    s = s.replace(/^https:\/\/(m\.)?instagram\.com\//i, "https://www.instagram.com/");
    s = s.replace(/^https:\/\/www\.instagram\.com\/+/i, "https://www.instagram.com/");
    s = s.replace(/^(www\.)?instagram\.com\//i, "https://www.instagram.com/");
    try {
      const url = new URL(s);
      url.hash = "";
      url.search = "";
      s = url.toString();
    } catch {}
    return s;
  } catch {
    return "";
  }
}

function __qcoreUniqUrls(arr) {
  try {
    const out = [];
    const seen = new Set();
    for (const v of Array.isArray(arr) ? arr : []) {
      const s = __qcoreNormalizeInstagramUrl(v);
      if (!s) continue;
      const key = s.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

function __qcoreSplitPreBlocks(text) {
  try {
    const s = String(text || "");
    return s
      .split(/=====+\s*PRE\s*\d+\s*\/\s*\d+\s*=====+/gi)
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function __qcoreTryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {}
  try {
    const str = String(s || "");
    const a0 = str.indexOf("[");
    const a1 = str.lastIndexOf("]");
    if (a0 !== -1 && a1 !== -1 && a1 > a0) {
      try {
        return JSON.parse(str.slice(a0, a1 + 1));
      } catch {}
    }
    const o0 = str.indexOf("{");
    const o1 = str.lastIndexOf("}");
    if (o0 !== -1 && o1 !== -1 && o1 > o0) {
      try {
        return JSON.parse(str.slice(o0, o1 + 1));
      } catch {}
    }
  } catch {}
  return null;
}

function __qcoreCollectUrlsFromJsonValue(val, out) {
  try {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const x of val) {
        if (typeof x === "string") out.push(x);
        else if (x && typeof x === "object") {
          if (typeof x.url === "string") out.push(x.url);
          if (typeof x.href === "string") out.push(x.href);
        }
      }
      return;
    }
    if (val && typeof val === "object") {
      if (Array.isArray(val.urls)) {
        for (const x of val.urls) out.push(x);
        return;
      }
    }
  } catch {}
}

function __qcoreExtractInstagramUrlsByRegex(text) {
  try {
    const s = String(text || "");
    const re = /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>]+/gi;
    const m = s.match(re) || [];
    return m.map((x) => String(x || "").replace(/[),\]}>"';]+$/g, ""));
  } catch {
    return [];
  }
}

function __qcoreTextToFlatInstagramUrlArray(text) {
  try {
    const collected = [];
    const direct = __qcoreTryParseJson(text);
    __qcoreCollectUrlsFromJsonValue(direct, collected);

    const blocks = __qcoreSplitPreBlocks(text);
    for (const b of blocks) {
      const parsed = __qcoreTryParseJson(b);
      __qcoreCollectUrlsFromJsonValue(parsed, collected);
      const rx = __qcoreExtractInstagramUrlsByRegex(b);
      for (const u of rx) collected.push(u);
    }

    const rxAll = __qcoreExtractInstagramUrlsByRegex(text);
    for (const u of rxAll) collected.push(u);

    const cleaned = __qcoreUniqUrls(collected).filter((u) =>
      u.includes("https://www.instagram.com/")
    );
    return cleaned;
  } catch {
    return [];
  }
}

function __qcoreDownloadBlob(blob, filename) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
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

async function __qcoreConvertScrapeFileToJsonDownload(file, projectName) {
  try {
    const proj =
      __qcoreSanitizeProjectName(projectName) ||
      __qcoreDeriveProjectFromFile(file) ||
      "unknown";

    const text = await (file && typeof file.text === "function"
      ? file.text()
      : Promise.resolve(String(file || "")));

    const urls = __qcoreTextToFlatInstagramUrlArray(text);

    const blob = new Blob([JSON.stringify(urls, null, 2)], {
      type: "application/json",
    });

    const name = __qcoreMakeScrapeFilename(proj);
    __qcoreDownloadBlob(blob, name);
    return { project: proj, filename: name, urls };
  } catch {
    return {
      project: "unknown",
      filename: __qcoreMakeScrapeFilename("unknown"),
      urls: [],
    };
  }
}

async function __qcoreConvertScrapeFilesToJsonDownload(fileList, projectName) {
  try {
    const files = Array.from(fileList || []);
    const results = [];
    for (const f of files) results.push(await __qcoreConvertScrapeFileToJsonDownload(f, projectName));
    return results;
  } catch {
    return [];
  }
}

function __qcoreNormalizeTimestamp(ts) {
  // Accept:
  // - number ms (Date.now())
  // - Date
  // - numeric string
  // - undefined/null => Date.now()
  try {
    if (ts == null) return Date.now();

    if (ts instanceof Date) {
      const n = ts.getTime();
      return Number.isFinite(n) ? n : Date.now();
    }

    const n = typeof ts === "number" ? ts : Number(String(ts).trim());
    return Number.isFinite(n) ? Math.trunc(n) : Date.now();
  } catch {
    return Date.now();
  }
}

function __qcoreMakeExportFilename(projectName, timestamp) {
  const project = __qcoreSanitizeProjectName(projectName) || "untitled";
  const ts = __qcoreNormalizeTimestamp(timestamp);
  return `q_scrape_${project}_${ts}.json`;
}



function __qcoreNormalizeTimestamp(ts) {
  // Accept:
  // - number ms (Date.now())
  // - Date
  // - numeric string
  // - undefined/null => Date.now()
  try {
    if (ts == null) return Date.now();

    if (ts instanceof Date) {
      const n = ts.getTime();
      return Number.isFinite(n) ? n : Date.now();
    }

    const n = typeof ts === "number" ? ts : Number(String(ts).trim());
    return Number.isFinite(n) ? Math.trunc(n) : Date.now();
  } catch {
    return Date.now();
  }
}

function __qcoreMakeExportFilename(projectName, timestamp) {
  const project = __qcoreSanitizeProjectName(projectName) || "untitled";
  const ts = __qcoreNormalizeTimestamp(timestamp);
  return `q_scrape_${project}_${ts}.json`;
}


  // Background-friendly “Copy All Tab URLs” (content cannot call chrome.tabs.*)
  async function copyAllTabUrls(btn, onlyCurrentWindow = true) {
    try {
      // NOTE: use typeof to avoid ReferenceError in page-context injections.
      const cr =
        typeof chrome !== "undefined"
          ? chrome
          : typeof globalThis !== "undefined"
            ? globalThis.chrome
            : null;

      if (!(cr && cr.runtime && cr.runtime.sendMessage)) {
        throw new Error("chrome.runtime.sendMessage not available");
      }

      const res = await cr.runtime.sendMessage({
        type: "GET_TABS_URLS",
        scope: onlyCurrentWindow ? "current" : "all",
      });
      if (!res || !res.ok) throw new Error(res?.error || "background failed");

      const json = JSON.stringify(res.urls || [], null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (btn) flashEmoji(btn, "🟢");
    } catch (e) {
      console.error("Copy tabs failed:", e);
      if (btn) flashEmoji(btn, "🔴");
    }
  }

  // ------------------------------ Cache/Clearing Helpers ------------------------------
  async function clearLocalStorage(btn) {
    try {
      localStorage.clear();
      flashEmoji(btn, "🟢");
    } catch {
      flashEmoji(btn, "🔴");
    }
  }

  async function clearSessionStorage(btn) {
    try {
      sessionStorage.clear();
      flashEmoji(btn, "🟢");
    } catch {
      flashEmoji(btn, "🔴");
    }
  }

  async function clearIndexedDB(btn) {
    try {
      let dbs = [];
      if (indexedDB && typeof indexedDB.databases === "function") {
        try {
          dbs = await indexedDB.databases();
        } catch {}
      }
      const names = Array.from(
        new Set(
          []
            .concat((dbs?.map((d) => d.name).filter(Boolean) || []))
            .concat(["keyval-store", "localforage", "idb-keyval", "qpm-db", "nexus-db"])
        )
      );
      await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
            })
        )
      );
      flashEmoji(btn, "🟢");
    } catch {
      flashEmoji(btn, "🔴");
    }
  }

  async function clearCacheStorage(btn) {
    try {
      if (!("caches" in window)) throw new Error("CacheStorage not supported");
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      flashEmoji(btn, "🟢");
    } catch {
      flashEmoji(btn, "🔴");
    }
  }

    // Alias (back-compat)
  async function clearCache(btn) {
    return clearCacheStorage(btn);
  }

async function clearChromeBrowsingData(btn) {
    try {
      // NOTE: guard `chrome` so this doesn't throw in non-extension contexts.
      const cr =
        typeof chrome !== "undefined"
          ? chrome
          : typeof globalThis !== "undefined"
            ? globalThis.chrome
            : null;

      if (!(cr && cr.runtime && cr.runtime.sendMessage)) throw new Error("no runtime messaging");

      const res = await cr.runtime.sendMessage({
        type: "CLEAR_BROWSING_DATA",
        options: { since: 0, origins: [location.origin] },
      });
      if (!res || !res.ok) throw new Error(res?.error || "background failed");
      flashEmoji(btn, "🟢");
    } catch (e) {
      console.warn("CLEAR_BROWSING_DATA not available from this context", e);
      flashEmoji(btn, "🔴");
    }
  }



  // ------------------------------ Global storage helpers ------------------------------
  // Uses chrome.storage.local when available (extension context), else falls back to localStorage["__GLOBAL__"].
  function __qcoreHasChromeStorageLocal() {
    try {
      return (
        typeof chrome !== "undefined" &&
        !!chrome &&
        !!chrome.storage &&
        !!chrome.storage.local &&
        typeof chrome.storage.local.get === "function" &&
        typeof chrome.storage.local.set === "function"
      );
    } catch {
      return false;
    }
  }

  function __qcoreGlobalSet(obj, cb) {
    const done = () => {
      try { cb && cb(true); } catch {}
    };
    try {
      if (__qcoreHasChromeStorageLocal()) {
        chrome.storage.local.set(obj || {}, () => done());
        return;
      }
    } catch {}
    try {
      const key = "__GLOBAL__";
      const raw = localStorage.getItem(key);
      const cur = raw ? JSON.parse(raw) : {};
      const next = Object.assign({}, cur || {}, obj || {});
      localStorage.setItem(key, JSON.stringify(next));
      done();
      return;
    } catch {}
    done();
  }

  function __qcoreGlobalGetAll(cb) {
    const done = (data) => {
      try { cb && cb(data || {}); } catch {}
    };
    try {
      if (__qcoreHasChromeStorageLocal()) {
        chrome.storage.local.get(null, (data) => done(data || {}));
        return;
      }
    } catch {}
    try {
      const raw = localStorage.getItem("__GLOBAL__");
      done(raw ? JSON.parse(raw) : {});
      return;
    } catch {}
    done({});
  }

  function __qcoreGlobalClear(cb) {
    const done = () => {
      try { cb && cb(true); } catch {}
    };
    try {
      if (__qcoreHasChromeStorageLocal()) {
        chrome.storage.local.clear(() => done());
        return;
      }
    } catch {}
    try {
      localStorage.removeItem("__GLOBAL__");
    } catch {}
    done();
  }

// ------------------------------ Instagram Extractor Box ------------------------------
// Paste anything -> click "Convert to Instagram JSON" -> textarea becomes a JSON array of Instagram profile URLs.
function makeInstagramExtractorBox() {
  const box = document.createElement("div");
  box.style.cssText = "margin-top:8px;display:flex;flex-direction:column;gap:8px";

  const ta = document.createElement("textarea");
  ta.classList.add("ig-extractor-textarea");
  ta.placeholder =
    'Paste anything here.\nClick "Convert to Instagram JSON" to turn it into a JSON array of Instagram profile URLs.';
  ta.style.cssText =
    "width:100%;min-height:180px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:1.35";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:10px";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Convert to Instagram JSON";
  btn.style.cssText =
    "background:#052e16;border:1px solid #22c55e;color:#dcfce7;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy";
  copyBtn.style.cssText =
    "background:#111827;border:1px solid #334155;color:#e5e7eb;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer";

  const status = document.createElement("div");
  status.classList.add("ig-extractor-status");
  status.textContent = "Idle";
  status.style.cssText = "color:#94a3b8;font-size:12px;margin-left:auto;white-space:nowrap";

  const loader = document.createElement("span");
  loader.textContent = "⏳";
  loader.style.cssText = "display:none;opacity:.85";

  row.appendChild(btn);
  row.appendChild(copyBtn);
  row.appendChild(loader);
  row.appendChild(status);

  // ---- helpers ----
  function setBusy(isBusy, msg) {
    loader.style.display = isBusy ? "inline" : "none";
    btn.disabled = isBusy;
    btn.style.opacity = isBusy ? "0.7" : "1";
    btn.style.cursor = isBusy ? "not-allowed" : "pointer";
    status.textContent = msg || (isBusy ? "Working…" : "Idle");
  }

  function tryParseJsonArrayOfStrings(s) {
    try {
      const v = JSON.parse(s);
      if (!Array.isArray(v)) return null;
      for (const x of v) if (typeof x !== "string") return null;
      return v;
    } catch {
      return null;
    }
  }

  function normalizeIgUrl(url) {
    let u = String(url || "").trim();
    if (!u) return null;

    // Fix broken scheme like ://www.instagram.com/x
    if (u.startsWith("://")) u = "https" + u;

    // Allow bare instagram.com/handle
    if (/^instagram\.com\//i.test(u)) u = "https://www." + u;
    if (/^www\.instagram\.com\//i.test(u)) u = "https://" + u;

    // Must be on instagram.com
    if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(u)) return null;

    // Strip surrounding quotes/punctuation
    u = u.replace(/^["'`]+|["'`]+$/g, "");
    u = u.replace(/[),.;]+$/g, "");

    // Extract first path segment
    const m = u.match(/^https?:\/\/(?:www\.)?instagram\.com\/([^\/?#]+)/i);
    if (!m) return null;

    const handle = (m[1] || "").trim();
    if (!handle) return null;

    const banned = new Set([
      "p",
      "reel",
      "tv",
      "stories",
      "explore",
      "accounts",
      "about",
      "developer",
      "directory",
      "privacy",
      "terms",
      "api",
      "press",
      "help",
    ]);

    if (banned.has(handle.toLowerCase())) return null;

    return `https://www.instagram.com/${handle}/`;
  }

  function extractInstagramUrlsFromText(raw) {
    const text = String(raw || "");

    // Find instagram.com/<slug> (scheme optional, even broken ://)
    const re = /(?:(?:https?:\/\/)|:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._]+/gi;

    const urls = [];
    const seen = new Set();

    let m;
    while ((m = re.exec(text)) !== null) {
      const candidate = m[0];
      const normalized = normalizeIgUrl(candidate);
      if (!normalized) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    }

    // Also handle cases where a URL is quoted with trailing slash already but punctuation breaks regex.
    // Quick fallback scan for "instagram.com/" fragments:
    if (!urls.length && text.toLowerCase().includes("instagram.com/")) {
      const re2 = /instagram\.com\/([A-Za-z0-9._]+)/gi;
      while ((m = re2.exec(text)) !== null) {
        const normalized = normalizeIgUrl(`https://www.instagram.com/${m[1]}/`);
        if (!normalized) continue;
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      }
    }

    return urls;
  }

  function convert() {
    const raw = ta.value || "";
    setBusy(true, "Converting…");

    // micro-delay so loader paints
    setTimeout(() => {
      const parsed = tryParseJsonArrayOfStrings(raw.trim());

      let urls;
      if (parsed) {
        // If user already gave a JSON string array, normalize/filter to IG profile URLs.
        const seen = new Set();
        urls = [];
        for (const s of parsed) {
          const n = normalizeIgUrl(s);
          if (!n) continue;
          if (!seen.has(n)) {
            seen.add(n);
            urls.push(n);
          }
        }
      } else {
        // Not a JSON array => extract from text
        urls = extractInstagramUrlsFromText(raw);
      }

      ta.value = JSON.stringify(urls, null, 2);
      setBusy(false, `Done. URLs: ${urls.length}`);
    }, 60);
  }

  btn.addEventListener("click", convert);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ta.value || "[]");
      const old = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = old), 900);
    } catch {
      const old = copyBtn.textContent;
      copyBtn.textContent = "Copy failed";
      setTimeout(() => (copyBtn.textContent = old), 900);
    }
  });

  box.appendChild(row);
  box.appendChild(ta);

  return box;
}
  function makeDownloaderSection() {
    const fieldset = document.createElement("fieldset");
    fieldset.classList.add("downloader-fieldset");
    fieldset.style.cssText =
      "border:1px solid #273449;border-radius:10px;padding:12px;margin-bottom:12px;background:linear-gradient(180deg,#0f1623 0%,#0b1117 100%)";

    const legend = document.createElement("legend");
    legend.textContent = "Direct Video Download";
    legend.style.cssText = "padding:0 6px;color:#93c5fd";
    fieldset.appendChild(legend);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Enter video URL…";
    input.classList.add("yt-url-input");
    input.style.cssText =
      "width:100%;padding:8px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1";
    fieldset.appendChild(input);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;margin-top:8px;position:relative;flex-wrap:wrap";
    fieldset.appendChild(row);

    const mkBtn = (txt) => {
      const b = document.createElement("button");
      b.textContent = txt;
      b.classList.add("yt-download-button");
      b.style.cssText =
        "padding:8px 10px;border-radius:8px;background:#334155;color:#e2e8f0;border:1px solid rgba(255,255,255,.08);font-weight:600;cursor:pointer";
      return b;
    };

    const wavBtn = mkBtn("Download WAV");
    const mp3Btn = mkBtn("Download MP3");
    const mp4Btn = mkBtn("Download MP4");
    row.append(mp3Btn, mp4Btn, wavBtn);

    const status = document.createElement("div");
    status.classList.add("yt-download-status");
    status.textContent = "⏳ Idle";
    status.style.cssText = "margin-top:6px;color:#94a3b8;font-size:12px";
    fieldset.appendChild(status);

    function runDownload(url, format, originBtn) {
      status.textContent = `⬇️ Downloading as ${String(format).toUpperCase()}…`;
      const titleLower = String(document.title || "").trim().toLowerCase();
      const qid = titleLower.startsWith("q_command_download")
        ? titleLower
        : `q_command_download${String(format).toLowerCase()}_01`;

      const body = {
        prompt: `yt-dlp ${url}`,
        qid,
        content: url,
      };

      fetch("http://localhost:3666/q_run_video_download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => res.json())
        .then((res) => {
          console.log('HERE res!!!!!!!!!!!!!!!', res);
          const ok = !!res?.result?.status;
          status.textContent = ok
            ? `✅ ${String(format).toUpperCase()} Download Complete`
            : `❌ Download Failed (${String(format).toUpperCase()}): ` + (res?.[0]?.error || "Unknown");
          flashEmoji(originBtn, ok ? "🟢" : "🔴");
        })
        .catch((err) => {
          status.textContent = `❌ Error (${String(format).toUpperCase()}): ${err.message}`;
          flashEmoji(originBtn, "🔴");
        });
    }

    const guardAndGo = (btn, fmt) => {
      const url = input.value.trim();
      if (!url) {
        status.textContent = "❌ Please enter a URL.";
        flashEmoji(btn, "🔴");
        return;
      }
      runDownload(url, fmt, btn);
    };

    wavBtn.onclick = () => guardAndGo(wavBtn, "wav");
    mp3Btn.onclick = () => guardAndGo(mp3Btn, "mp3");
    mp4Btn.onclick = () => guardAndGo(mp4Btn, "mp4");

    return fieldset;
  }

  // Alias (back-compat)
  function makeDownloader() {
    return makeDownloaderSection();
  }

  // ------------------------------ Word/Token Counter ------------------------------
  function makeWordCounter() {
    const box = document.createElement("div");
    box.style.cssText = "margin-top:8px;display:flex;flex-direction:column;gap:6px";

    const ta = document.createElement("textarea");
    ta.classList.add("word-count-textarea");
    ta.placeholder = "Paste text here…";
    ta.style.cssText =
      "width:100%;min-height:120px;border-radius:8px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;padding:8px";

    const lbl = document.createElement("label");
    lbl.classList.add("word-count-label");
    lbl.textContent = "Token Count: 0";
    lbl.style.cssText = "color:#94a3b8;font-size:12px";

    ta.addEventListener("input", () => {
      const text = ta.value.trim();
      const tokens = text
        ? text.split(/\s+/).reduce((acc, token) => {
            const sub = token.split(/(?=[.,!?;(){}\[\]'"<>:\/\\|])/);
            return acc.concat(sub.filter(Boolean));
          }, [])
        : [];
      lbl.textContent = `Token Count: ${tokens.length}`;
    });

    box.appendChild(ta);
    box.appendChild(lbl);
    return box;
  }


  

  // =============================================================================
  // Split Architecture Core (Tool registry + reusable modals + Tools UI shell)
  // =============================================================================

  // A shared queue so tool modules can register even if they load before core.
  window.__QCORE_TOOLS_PENDING__ = window.__QCORE_TOOLS_PENDING__ || [];

  // Ensure global namespace exists early (tools can attach helpers onto it).
  window.QCoreToolsModal = window.QCoreToolsModal || {};

  // ------------------------------
  // Tool Registry
  // ------------------------------
  const __qcoreToolRegistry = new Map();

  function __qcoreFlushPendingToolRegistrations() {
    const q = window.__QCORE_TOOLS_PENDING__ || [];
    if (!q.length) return;
    // Drain the queue in FIFO order; allow re-entrancy safely.
    const items = q.splice(0, q.length);
    for (const fn of items) {
      try {
        if (typeof fn === "function") fn();
      } catch (e) {
        console.warn("[QCoreToolsModal] Pending tool registration failed:", e);
      }
    }
  }

  function registerTool(def) {
    if (!def || typeof def !== "object") throw new Error("registerTool(def): def must be an object");
    if (!def.id || typeof def.id !== "string") throw new Error("registerTool(def): def.id must be a string");
    if (!def.title || typeof def.title !== "string") throw new Error("registerTool(def): def.title must be a string");
    const prev = __qcoreToolRegistry.get(def.id);
    __qcoreToolRegistry.set(def.id, Object.assign({ order: 1000 }, def));

    // If core already ran auto-boot, auto-boot this tool on registration (helps multi-script setups).
    try {
      if (window.QCoreToolsModal && window.QCoreToolsModal.__autoBootRan && typeof def.autoBoot === "function") {
        setTimeout(() => {
          try { def.autoBoot(); } catch (e) { console.warn("[QCoreToolsModal] autoBoot failed:", def.id, e); }
        }, 0);
      }
    } catch {}

    // If Tools modal is open, re-render tool buttons.
    try { window.QCoreToolsModal.__rerenderToolsButtons?.(); } catch {}
    return prev || null;
  }

  function unregisterTool(id) {
    __qcoreToolRegistry.delete(id);
    try { window.QCoreToolsModal.__rerenderToolsButtons?.(); } catch {}
  }

  function getTools() {
    return Array.from(__qcoreToolRegistry.values()).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  }

  // ------------------------------
  // Reusable Modal (Google Flights-ish quality)
  // ------------------------------
  function __qcoreInjectStyleOnce(id, cssText) {
    try {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.textContent = cssText;
      document.head.appendChild(style);
    } catch (e) {
      // If style injection fails (rare CSP), we still try to function with inline styles.
      console.warn("[QCoreToolsModal] style injection failed:", e);
    }
  }

  function createToolModal(opts = {}) {
    const {
      id = "qcore_tool_modal",
      title = "Tool",
      subtitle = "",
      icon = "",
      width = 900,
      minWidth = 360,
      maxWidth = 1200,
      showClose = true,
      // content builder:
      onMount = null,
      // footer actions:
      actions = [],
      // default focus selector:
      initialFocusSelector = null,
    } = opts;

    __qcoreInjectStyleOnce("qcore_tools_modal_styles_split", `
      .qcoretm_overlay{
        position:fixed; inset:0; z-index:2147483646;
        background:rgba(0,0,0,.46);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display:flex; align-items:flex-start; justify-content:center;
        padding: 36px 14px;
      }
      .qcoretm_card{
        width: min(${maxWidth}px, max(${minWidth}px, ${width}px));
        max-width: ${maxWidth}px;
        background: rgba(255,255,255,.96);
        color: #111;
        border-radius: 18px;
        box-shadow: 0 24px 80px rgba(0,0,0,.55);
        overflow: hidden;
        border: 1px solid rgba(0,0,0,.10);
        display:flex; flex-direction:column;
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_card{
          background: rgba(20,20,20,.92);
          color: #f5f5f5;
          border: 1px solid rgba(255,255,255,.10);
        }
      }
      .qcoretm_header{
        display:flex; align-items:center; justify-content:space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(0,0,0,.08);
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_header{ border-bottom: 1px solid rgba(255,255,255,.10); }
      }
      .qcoretm_titleWrap{ display:flex; gap:10px; align-items:center; min-width:0; }
      .qcoretm_icon{ font-size: 20px; line-height: 1; }
      .qcoretm_titles{ display:flex; flex-direction:column; min-width:0; }
      .qcoretm_title{ font: 600 15px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .qcoretm_subtitle{ font: 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .qcoretm_close{
        border:none; background:transparent; cursor:pointer;
        font-size: 18px; padding: 6px 8px; border-radius: 10px;
        color: inherit; opacity:.8;
      }
      .qcoretm_close:hover{ background: rgba(0,0,0,.06); opacity:1; }
      @media (prefers-color-scheme: dark) {
        .qcoretm_close:hover{ background: rgba(255,255,255,.10); }
      }
      .qcoretm_body{
        padding: 14px 16px;
        max-height: min(78vh, 840px);
        overflow:auto;
      }
      .qcoretm_footer{
        display:flex; gap:10px; justify-content:flex-end; align-items:center;
        padding: 12px 16px;
        border-top: 1px solid rgba(0,0,0,.08);
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_footer{ border-top: 1px solid rgba(255,255,255,.10); }
      }
      .qcoretm_btn{
        appearance:none; border: 1px solid rgba(0,0,0,.14);
        background: rgba(255,255,255,.8);
        color: inherit;
        border-radius: 12px;
        padding: 9px 12px;
        cursor:pointer;
        font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      }
      .qcoretm_btn:hover{ background: rgba(0,0,0,.05); }
      .qcoretm_btnPrimary{
        border: 1px solid rgba(0,0,0,.0);
        background: rgba(0,0,0,.86);
        color: #fff;
      }
      .qcoretm_btnPrimary:hover{ background: rgba(0,0,0,.75); }
      @media (prefers-color-scheme: dark) {
        .qcoretm_btn{ border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); }
        .qcoretm_btn:hover{ background: rgba(255,255,255,.10); }
        .qcoretm_btnPrimary{ background: rgba(255,255,255,.92); color: #111; }
        .qcoretm_btnPrimary:hover{ background: rgba(255,255,255,.80); }
      }
      .qcoretm_sectionTitle{
        font: 700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        letter-spacing: .06em;
        text-transform: uppercase;
        opacity: .75;
        margin: 14px 0 8px;
      }
      .qcoretm_grid{
        display:grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 10px;
      }
      .qcoretm_toolBtn{
        display:flex; gap:10px; align-items:flex-start;
        text-align:left;
        border-radius: 14px;
        padding: 10px 12px;
        border: 1px solid rgba(0,0,0,.12);
        background: rgba(255,255,255,.70);
        cursor:pointer;
      }
      .qcoretm_toolBtn:hover{ background: rgba(0,0,0,.04); }
      .qcoretm_toolBtn[disabled]{
        opacity:.45; cursor:not-allowed;
      }
      .qcoretm_toolIcon{ font-size: 18px; line-height: 1; margin-top:1px; }
      .qcoretm_toolMeta{ display:flex; flex-direction:column; gap:3px; min-width:0; }
      .qcoretm_toolTitle{ font: 700 13px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
      .qcoretm_toolDesc{ font: 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; opacity:.7; }
      @media (prefers-color-scheme: dark) {
        .qcoretm_toolBtn{
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.06);
        }
        .qcoretm_toolBtn:hover{ background: rgba(255,255,255,.10); }
      }
      .qcoretm_hr{
        height:1px; background: rgba(0,0,0,.10); border:none; margin: 14px 0;
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_hr{ background: rgba(255,255,255,.12); }
      }
      .qcoretm_kv{
        display:flex; gap:10px; align-items:center; flex-wrap:wrap;
        font: 600 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        opacity:.85;
      }
      .qcoretm_badge{
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,.12);
        background: rgba(0,0,0,.04);
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_badge{ border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.08); }
      }
      .qcoretm_textarea{
        width:100%;
        min-height: 260px;
        resize: vertical;
        border-radius: 12px;
        border: 1px solid rgba(0,0,0,.14);
        background: rgba(255,255,255,.85);
        padding: 10px 12px;
        font: 500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New";
        color: inherit;
      }
      @media (prefers-color-scheme: dark) {
        .qcoretm_textarea{ border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.35); }
      }
    `);

    // Create DOM
    const overlay = document.createElement("div");
    overlay.className = "qcoretm_overlay";
    overlay.dataset.qcoreModalId = id;

    const card = document.createElement("div");
    card.className = "qcoretm_card";

    const header = document.createElement("div");
    header.className = "qcoretm_header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "qcoretm_titleWrap";

    const iconEl = document.createElement("div");
    iconEl.className = "qcoretm_icon";
    iconEl.textContent = icon || "";

    const titles = document.createElement("div");
    titles.className = "qcoretm_titles";

    const titleEl = document.createElement("div");
    titleEl.className = "qcoretm_title";
    titleEl.textContent = title || "Tool";

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "qcoretm_subtitle";
    subtitleEl.textContent = subtitle || "";

    titles.appendChild(titleEl);
    if (subtitle) titles.appendChild(subtitleEl);

    titleWrap.appendChild(iconEl);
    titleWrap.appendChild(titles);

    const closeBtn = document.createElement("button");
    closeBtn.className = "qcoretm_close";
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    if (!showClose) closeBtn.style.display = "none";

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "qcoretm_body";

    const footer = document.createElement("div");
    footer.className = "qcoretm_footer";

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);

    function close() {
      try { overlay.remove(); } catch {}
      try { opts.onClose?.(); } catch {}
    }

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // Actions
    const actionButtons = [];
    for (const a of (actions || [])) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qcoretm_btn" + (a.primary ? " qcoretm_btnPrimary" : "");
      btn.textContent = a.label || "Action";
      btn.addEventListener("click", async () => {
        try { await a.onClick?.(api); } catch (e) { console.error(e); }
      });
      footer.appendChild(btn);
      actionButtons.push(btn);
    }

    // Always include a Close button if no actions provided (or if requested)
    if (!actions || actions.length === 0) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qcoretm_btn";
      btn.textContent = "Close";
      btn.addEventListener("click", close);
      footer.appendChild(btn);
      actionButtons.push(btn);
    }

    const api = {
      overlay,
      card,
      header,
      body,
      footer,
      close,
      setTitle: (t) => { titleEl.textContent = t ?? ""; },
      setSubtitle: (t) => { subtitleEl.textContent = t ?? ""; if (!subtitleEl.parentNode) titles.appendChild(subtitleEl); },
      addSectionTitle: (t) => {
        const el = document.createElement("div");
        el.className = "qcoretm_sectionTitle";
        el.textContent = t;
        body.appendChild(el);
        return el;
      },
      addHr: () => {
        const hr = document.createElement("hr");
        hr.className = "qcoretm_hr";
        body.appendChild(hr);
        return hr;
      },
      addKv: (text) => {
        const el = document.createElement("div");
        el.className = "qcoretm_kv";
        el.textContent = text;
        body.appendChild(el);
        return el;
      },
      addBadge: (text) => {
        const el = document.createElement("span");
        el.className = "qcoretm_badge";
        el.textContent = text;
        return el;
      },
      addButton: ({ label, primary = false, onClick }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "qcoretm_btn" + (primary ? " qcoretm_btnPrimary" : "");
        btn.textContent = label || "Button";
        btn.addEventListener("click", async () => {
          try { await onClick?.(api); } catch (e) { console.error(e); }
        });
        body.appendChild(btn);
        return btn;
      },
      addTextarea: ({ value = "", placeholder = "", className = "" } = {}) => {
        const ta = document.createElement("textarea");
        ta.className = "qcoretm_textarea " + (className || "");
        ta.value = value;
        ta.placeholder = placeholder;
        body.appendChild(ta);
        return ta;
      },
      addDiv: (className = "", text = "") => {
        const el = document.createElement("div");
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = String(text);
        body.appendChild(el);
        return el;
      },
    };

    // Mount
    document.body.appendChild(overlay);

    try { onMount?.(api); } catch (e) { console.error(e); }

    // Focus
    try {
      if (initialFocusSelector) {
        const focusEl = overlay.querySelector(initialFocusSelector);
        focusEl?.focus?.();
      } else {
        // focus close to enable Esc? We'll keep.
        closeBtn?.focus?.();
      }
    } catch {}

    // Escape closes
    const escHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", escHandler, { capture: true });
    const originalClose = api.close;
    api.close = () => {
      window.removeEventListener("keydown", escHandler, { capture: true });
      originalClose();
    };

    return api;
  }

  // ------------------------------
  // JSON Download Modal (shared)
  // ------------------------------
  function __qcoreMakeJsonDownloadModal(opts = {}) {
    const {
      title = "Download JSON",
      subtitle = location.hostname,
      icon = "🧾",
      initialJson = null,
      defaultFilename = `qcore_${safeNowIso().replace(/[:.]/g, "-")}.json`,
    } = opts;

    let currentJson = initialJson;

    const modal = createToolModal({
      id: "qcore_json_download_modal",
      title,
      subtitle,
      icon,
      width: 980,
      actions: [
        { label: "Copy", onClick: () => {
            try {
              const txt = typeof currentJson === "string" ? currentJson : JSON.stringify(currentJson ?? null, null, 2);
              navigator.clipboard?.writeText?.(txt);
            } catch (e) { console.warn(e); }
          }
        },
        { label: "Download", primary: true, onClick: () => modalApi.download() },
        { label: "Close", onClick: (api) => api.close() },
      ],
      onMount: (api) => {
        api.addSectionTitle("JSON");
      },
    });

    // We need access to api from actions above; createToolModal returns api directly.
    const modalApi = modal;

    const statusEl = document.createElement("div");
    statusEl.className = "qcoretm_kv";
    statusEl.textContent = "Ready.";
    modalApi.body.appendChild(statusEl);

    const ta = document.createElement("textarea");
    ta.className = "qcoretm_textarea";
    ta.placeholder = "JSON will appear here…";
    modalApi.body.appendChild(ta);

    function setJsonValue(v) {
      currentJson = v;
      try {
        ta.value = typeof v === "string" ? v : JSON.stringify(v ?? null, null, 2);
      } catch (e) {
        ta.value = String(v);
      }
    }

    function setStatus(text, kind = "") {
      statusEl.textContent = text || "";
      statusEl.dataset.kind = kind || "";
    }

    function download(filename = defaultFilename) {
      const jsonText = ta.value || "";
      const blob = new Blob([jsonText], { type: "application/json" });
      __qcoreDownloadBlob(blob, filename);
    }

    setJsonValue(currentJson);

    return {
      show: () => modalApi,
      close: () => modalApi.close(),
      textarea: ta,
      setStatus,
      setJsonValue,
      download,
      get json() { return currentJson; },
      set json(v) { setJsonValue(v); },
    };
  }

  function __qcoreMakeGrokDownloadModal(opts = {}) {
    const m = __qcoreMakeJsonDownloadModal(Object.assign({ title: "Grok → JSON", icon: "🧩" }, opts));
    // Slight visual cue (Grok tool in original used red accents; we'll keep subtle)
    try { m.textarea && (m.textarea.style.borderColor = "rgba(255,80,80,.55)"); } catch {}
    return m;
  }

  // ------------------------------
  // Root State helpers (best-effort; uses QCoreContent if present)
  // ------------------------------
  function __qcoreGetRootStateSafe() {
    try { return window.QCoreContent?.getState?.() || {}; } catch { return {}; }
  }
  function __qcoreSetRootStateSafe(state) {
    try { window.QCoreContent?.setState?.(state); return true; } catch {}
    try { localStorage.setItem("__QCORE_TOOLS_STATE__", JSON.stringify(state || {})); return true; } catch {}
    return false;
  }

  // ------------------------------
  // Skynet container visibility (per-site)
  // ------------------------------
  const __qcoreUnixTs = () => Math.floor(Date.now() / 1000);

  function __qcoreNormSiteUrl(url = "") {
    try {
      const u = new URL(url, location.href);
      // Normalize: origin + pathname (no query/hash)
      const path = (u.pathname || "/").replace(/\/+$/, "/");
      return `${u.origin}${path}`;
    } catch {
      return String(url || "");
    }
  }

  const __qcoreCurrentSiteUrl = () => __qcoreNormSiteUrl(location.href);

  const __qcoreDetectApplicationName = (url = "") => {
    try {
      const host = new URL(url, location.href).hostname || "";
      // Keep this intentionally simple & stable.
      if (host.includes("chatgpt")) return "ChatGPT";
      if (host.includes("claude")) return "Claude";
      if (host.includes("grok")) return "Grok";
      if (host.includes("google")) return "Google";
      if (host.includes("linkedin")) return "LinkedIn";
      if (host.includes("facebook")) return "Facebook";
      if (host.includes("reddit")) return "Reddit";
      if (host.includes("zillow")) return "Zillow";
      if (host.includes("amazon")) return "Amazon";
      return host || "Unknown";
    } catch {
      return "Unknown";
    }
  };

  function __qcoreEnsureVisibilityArray(state) {
    state.visibility = Array.isArray(state.visibility) ? state.visibility : [];
    return state.visibility;
  }

  function __qcoreFindVisibilityRecord(state, url) {
    const vis = __qcoreEnsureVisibilityArray(state);
    return vis.find((r) => r && r.url === url) || null;
  }

  function __qcoreUpdateVisibilityRecord(state, record) {
    const vis = __qcoreEnsureVisibilityArray(state);
    const idx = vis.findIndex((r) => r && r.url === record.url);
    if (idx >= 0) vis[idx] = record;
    else vis.push(record);
  }

  function __qcoreApplySkynetContainerVisibility(visibility) {
    const el = document.getElementById("skynet-container");
    if (!el) return;
    el.style.display = visibility ? "" : "none";
  }

  function __qcoreGetSkynetVisibilityForSite(state, url = __qcoreCurrentSiteUrl()) {
    url = __qcoreNormSiteUrl(url);
    const rec = __qcoreFindVisibilityRecord(state, url);
    if (!rec) return true; // default visible
    return rec.visibility !== false;
  }

  function __qcoreSetSkynetVisibilityForSite(state, url, visibility) {
    url = __qcoreNormSiteUrl(url);
    const ts = __qcoreUnixTs();
    const rec = __qcoreFindVisibilityRecord(state, url) || {
      url,
      applicationname: __qcoreDetectApplicationName(url),
      createdTs: ts,
    };
    rec.visibility = !!visibility;
    rec.lastUpdated = ts;
    __qcoreUpdateVisibilityRecord(state, rec);
  }

  function __qcoreApplySkynetContainerVisibilityFromState(state) {
    try {
      const vis = __qcoreGetSkynetVisibilityForSite(state, __qcoreCurrentSiteUrl());
      __qcoreApplySkynetContainerVisibility(vis);
    } catch {}
  }

  function __qcoreToggleSkynetContainerVisibilityForThisSite(state) {
    const url = __qcoreCurrentSiteUrl();
    const current = __qcoreGetSkynetVisibilityForSite(state, url);
    __qcoreSetSkynetVisibilityForSite(state, url, !current);
    __qcoreApplySkynetContainerVisibilityFromState(state);
    __qcoreSetRootStateSafe(state);
    return !current;
  }

  function __qcoreEnsureVisibilityRegistry(state, opts = {}) {
    state = state || {};
    __qcoreEnsureVisibilityArray(state);

    const url = __qcoreCurrentSiteUrl();
    if (!__qcoreFindVisibilityRecord(state, url)) {
      __qcoreSetSkynetVisibilityForSite(state, url, true);
    }

    if (opts.persist) __qcoreSetRootStateSafe(state);

    __qcoreApplySkynetContainerVisibilityFromState(state);
    return state;
  }

  // ------------------------------
  // Tools Modal UI (shell only; tool buttons are registered by modules)
  // ------------------------------
  let __qcoreToolsModalApi = null;
  let __qcoreToolsButtonsContainer = null;

  function __qcoreRenderToolsButtons() {
    if (!__qcoreToolsButtonsContainer) return;
    __qcoreToolsButtonsContainer.innerHTML = "";

    const tools = getTools();
    for (const t of tools) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qcoretm_toolBtn";

      const iconEl = document.createElement("div");
      iconEl.className = "qcoretm_toolIcon";
      iconEl.textContent = t.icon || "🧰";

      const meta = document.createElement("div");
      meta.className = "qcoretm_toolMeta";

      const title = document.createElement("div");
      title.className = "qcoretm_toolTitle";
      title.textContent = t.title;

      const desc = document.createElement("div");
      desc.className = "qcoretm_toolDesc";
      desc.textContent = t.description || "";

      meta.appendChild(title);
      if (t.description) meta.appendChild(desc);

      btn.appendChild(iconEl);
      btn.appendChild(meta);

      let enabled = true;
      try {
        enabled = typeof t.isEnabled === "function" ? !!t.isEnabled() : true;
      } catch { enabled = true; }
      if (!enabled) btn.setAttribute("disabled", "disabled");

      btn.addEventListener("click", async () => {
        if (!enabled) return;
        try { flashEmoji(btn, "✨"); } catch {}
        try {
          const ctx = {
            modal: __qcoreToolsModalApi,
            closeToolsModal: () => { try { __qcoreToolsModalApi?.close(); } catch {} },
            getState: __qcoreGetRootStateSafe,
            setState: __qcoreSetRootStateSafe,
          };
          await t.onClick?.(ctx);
        } catch (e) {
          console.error("[QCoreToolsModal] Tool click failed:", t.id, e);
          try { alert(`Tool failed: ${t.title}\n\n${e?.message || e}`); } catch {}
        }
      });

      __qcoreToolsButtonsContainer.appendChild(btn);
    }
  }

  function showToolsModal() {
    __qcoreFlushPendingToolRegistrations();

    // If already open, bring to front by re-creating.
    try { __qcoreToolsModalApi?.close?.(); } catch {}
    __qcoreToolsModalApi = null;

    const state = __qcoreEnsureVisibilityRegistry(__qcoreGetRootStateSafe(), { persist: true });

    __qcoreToolsModalApi = createToolModal({
      id: "qcore_tools_modal",
      title: "QCore Tools",
      subtitle: `${location.hostname}${location.pathname ? " — " + location.pathname : ""}`,
      icon: "🧰",
      width: 1040,
      actions: [
        { label: "Copy Tab URLs", onClick: async () => {
            try {
              await copyAllTabUrls(null, true);
            } catch (e) { console.warn(e); }
          }
        },
        { label: "Close", onClick: (api) => api.close() },
      ],
      onMount: (api) => {
        // Top status row
        const kv = api.addDiv("qcoretm_kv");
        const gateBadge = api.addBadge(window.__QCORE_TOOLS_MODAL_PAGE_GATE?.allowed ? "Page gate: allowed" : "Page gate: blocked");
        kv.appendChild(gateBadge);

        const visBadge = api.addBadge(__qcoreGetSkynetVisibilityForSite(state) ? "Skynet: visible" : "Skynet: hidden");
        kv.appendChild(visBadge);

        const btnRow = document.createElement("div");
        btnRow.style.display = "flex";
        btnRow.style.gap = "10px";
        btnRow.style.flexWrap = "wrap";
        btnRow.style.marginTop = "10px";

        const mkBtn = (label, primary, onClick) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "qcoretm_btn" + (primary ? " qcoretm_btnPrimary" : "");
          b.textContent = label;
          b.addEventListener("click", async () => {
            try { await onClick?.(); } catch (e) { console.warn(e); }
          });
          return b;
        };

        // Local AI connection test (kept from original behavior)
        const connLabel = document.createElement("span");
        connLabel.textContent = "Connection: (not tested)";
        connLabel.style.opacity = ".85";
        connLabel.style.fontWeight = "700";
        connLabel.style.alignSelf = "center";


        const breakLockBtn = mkBtn("Break Lock", false, async () => {
          try {
            const state = window.QCoreContent?.getState?.();
            if (!state) {
              connLabel.textContent = "Break Lock: ERROR (no state)";
              return;
            }

            // first mutation
            state.locked = false;
            state.lockedOverride = true;
            window.QCoreContent?.setState?.(state);

            // second mutation (release override flag)
            state.lockedOverride = false;
            window.QCoreContent?.setState?.(state);

            connLabel.textContent = "Break Lock: OK";
          } catch (e) {
            connLabel.textContent = `Break Lock: ERROR (${e?.message || e})`;
          }
        });

const testConn = mkBtn("Test Local Connection", false, async () => {
  connLabel.textContent = "Connection: testing…";

  try {
    let qid = null;

    // 1️⃣ try window title
    if (window?.document?.title) {
      qid = window.document.title.replace(/\s+/g, "_");
    }

    // 2️⃣ try state.qid
    try {
      const state = window.QCoreContent?.getState?.();
      if (state?.qid) qid = state.qid;
    } catch (_) {}

    // 3️⃣ fallback
    if (!qid) qid = "q_test_1";

    const res = await fetch("http://localhost:3666/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qid,
        msg: "ping",
        ts: Date.now()
      }),
    });

    const data = await res.json().catch(() => ({}));

    connLabel.textContent = res.ok
      ? `Connection: OK (${data?.status || "ok"})`
      : `Connection: FAIL (${res.status})`;

  } catch (e) {
    connLabel.textContent = `Connection: ERROR (${e?.message || e})`;
  }
});
        const toggleSkynet = mkBtn("Toggle Skynet (this site)", false, () => {
          const nowVisible = __qcoreToggleSkynetContainerVisibilityForThisSite(state);
          visBadge.textContent = nowVisible ? "Skynet: visible" : "Skynet: hidden";
        });

        const clearLSBtn = mkBtn("Clear LocalStorage", false, async () => {
          try { await clearLocalStorage(clearLSBtn); } catch {}
        });

        btnRow.appendChild(testConn);
        btnRow.appendChild(breakLockBtn);
        btnRow.appendChild(toggleSkynet);
        btnRow.appendChild(clearLSBtn);
        btnRow.appendChild(connLabel);

        api.body.appendChild(btnRow);

        api.addHr();

        // Tools grid
        api.addSectionTitle("Tools");
        __qcoreToolsButtonsContainer = document.createElement("div");
        __qcoreToolsButtonsContainer.className = "qcoretm_grid";
        api.body.appendChild(__qcoreToolsButtonsContainer);

        __qcoreRenderToolsButtons();

        api.addHr();

                // Utilities (non-tool blocks)
        api.addSectionTitle("Utilities");

        // ---- Direct Video Download ----
        try { api.body.appendChild(makeDownloaderSection()); } catch (e) { console.warn(e); }

        // ---- Notes / Global / Clearers / Emoji Pad (restored) ----
        try {
          // Hidden notes textarea (source-of-truth for buttons; keeps UI clean).
          const notes = document.createElement("textarea");
          notes.className = "qcoretm_textarea";
          notes.placeholder = "Notes…";
          notes.style.cssText =
            "display:none;width:100%;min-height:120px;border-radius:12px;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.12);color:inherit;padding:10px;margin-top:6px";
          if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
            notes.style.background = "rgba(255,255,255,.06)";
            notes.style.border = "1px solid rgba(255,255,255,.12)";
          }
          try {
            const prior = localStorage.getItem("q.tools.notes");
            notes.value = prior || "make install && make up";
          } catch {
            notes.value = "make install && make up";
          }
          api.body.appendChild(notes);

          // Save Notes → localStorage (green)
          const saveLocalNotes = mkBtn("Save Notes → localStorage", true, () => {
            try {
              localStorage.setItem("q.tools.notes", notes.value);
              flashEmoji(saveLocalNotes, "🟢");
            } catch {
              flashEmoji(saveLocalNotes, "🔴");
            }
          });
          saveLocalNotes.style.background = "#65a30d";
          saveLocalNotes.style.color = "#0b1117";
          saveLocalNotes.style.borderColor = "rgba(255,255,255,.12)";
          saveLocalNotes.style.fontWeight = "800";
          api.body.appendChild(saveLocalNotes);

          // ---- Global storage suite ----
          const globalRow = document.createElement("div");
          globalRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
          api.body.appendChild(globalRow);

          const saveGlobalBtn = mkBtn("Save Notes → Global", false, () => {
            __qcoreGlobalSet({ notes: notes.value }, () => flashEmoji(saveGlobalBtn, "🟢"));
          });
          globalRow.appendChild(saveGlobalBtn);

          const viewGlobalBtn = mkBtn("View Global", false, () => {
            const pre = document.createElement("pre");
            pre.style.cssText =
              "margin-top:8px;white-space:pre-wrap;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:10px;color:inherit;font-size:12px;max-height:240px;overflow:auto";
            if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
              pre.style.background = "rgba(255,255,255,.06)";
              pre.style.border = "1px solid rgba(255,255,255,.12)";
            }
            pre.textContent = "Loading…";
            api.body.appendChild(pre);
            __qcoreGlobalGetAll((data) => {
              try {
                pre.textContent = JSON.stringify(data || {}, null, 2);
              } catch {
                pre.textContent = String(data || "");
              }
            });
            flashEmoji(viewGlobalBtn, "🟢");
          });
          globalRow.appendChild(viewGlobalBtn);

          const clearGlobalBtn = mkBtn("Clear Global", false, () => {
            __qcoreGlobalClear(() => flashEmoji(clearGlobalBtn, "🟢"));
          });
          globalRow.appendChild(clearGlobalBtn);

          // ---- Cache/Clearers ----
          const clearers = document.createElement("div");
          clearers.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
          api.body.appendChild(clearers);

          const btnLS = mkBtn("Clear LocalStorage", false, () => clearLocalStorage(btnLS));
          clearers.appendChild(btnLS);

          const btnSS = mkBtn("Clear SessionStorage", false, () => clearSessionStorage(btnSS));
          clearers.appendChild(btnSS);

          const btnIDB = mkBtn("Clear IndexedDB", false, () => clearIndexedDB(btnIDB));
          clearers.appendChild(btnIDB);

          const btnCS = mkBtn("Clear CacheStorage", false, () => clearCacheStorage(btnCS));
          clearers.appendChild(btnCS);

          const btnChrome = mkBtn("Clear Chrome Cache (bg)", false, () => clearChromeBrowsingData(btnChrome));
          clearers.appendChild(btnChrome);

          const btnAll = mkBtn("Clear ALL (Local/Session/IDB/Cache)", false, async () => {
            try { await clearLocalStorage(btnAll); } catch {}
            try { await clearSessionStorage(btnAll); } catch {}
            try { await clearIndexedDB(btnAll); } catch {}
            try { await clearCacheStorage(btnAll); } catch {}
            flashEmoji(btnAll, "🟢");
          });
          btnAll.style.background = "#7f1d1d";
          btnAll.style.borderColor = "rgba(255,255,255,.12)";
          btnAll.style.fontWeight = "800";
          clearers.appendChild(btnAll);

          // ---- Emoji pad ----
          const emojiTa = document.createElement("textarea");
          emojiTa.className = "qcoretm_textarea";
          emojiTa.placeholder = "Emojis…";
          emojiTa.style.cssText =
            "width:100%;min-height:220px;border-radius:12px;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.12);color:inherit;padding:10px;margin-top:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;line-height:1.35";
          if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
            emojiTa.style.background = "rgba(255,255,255,.06)";
            emojiTa.style.border = "1px solid rgba(255,255,255,.12)";
          }
          emojiTa.value = ["🟠","🟡","🟢","🔵","🟣","🟤","🟥","🟩","🟦","🟧","🟨","🟪","🟫","🔴","⚪","⚫","🔶","🔷","🔳","🔲","🔘","🔺","🔻","🔹","🔸","😀","😁","😂","😃","😄","😅","😆","😇","😈","👿","😋","😎","😍","😘","😗","😙","😚","🙂","🙃","🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥","😮","🤐","😯","😪","😫","😴","😌","😛","😜","😝","🤓","🧐","🥳","🤠","😤","😡","😠","🤬","🥶","🥵","💀","☠️","🌞","🌝","🌚","🌟","✨","⚡","🔥","💧","🌊","🍀","🌻","🌷","🌹","💐","🌼","🍂","🍁","🍃","🌱","🌲","🌳","🌴","🌵","🌾","🌿","🌺","🍄","🌰","🦋","🐝","🐞","🦗","🐛","🐢","🐍","🦎","🐅","🐆","🦓","🐘","🦏","🐪","🐫","🦙","🐎","🐄","🐖","🐑","🐏","🐐","🦌","🦒","🐕","🐈","🐁","🐇","🐿","🦔","🦢","🦜","🦩","🦚","🦘","🦡","🦥","🦦","🦄","🐉","🦖","🦕","🐳","🐬","🐡","🦑","🐙","🦀","🦞","🐌","🐚","🦠","🦍","🦧","🦨","🐕‍🦺","🐩","🐾","🙅","🚫","🖐","🚥","🚦","🚳","🚷","⛔","👋","📵","🚏","🚭","🚯","🚱","⏹️","✋","❌","❎","🚨","🛑","⏸️","⏯️","🔕","🔇","🤕","💊","👾","🥸","🎃","👹","👺","💩","🤡","👽","🤖","🚀","✔️","✪","✤","🎁","⚒","🏠","🍭","🌏","👻","🤑","🖥️","💻","⌨️","🖱️","🖲️","📱","📲","📡","🛰️","💽","💾","💿","📀","🔌","🔋","🔧","🛠️","⚙️","🔩","🔨","🧰","🧲","📂","📁","🗂️","🗄️","💼","📊","📈","📉","📋","📝","🗒️","📄","📃","📑","🔐","🔓","🔏","🔒","🛜","🌐","🕹️","🎮","🧩","🧪","🧬","💡","🔦","💳","🆙","🆒","🆕","🆓","🔖","🏷️","🔗","🪪","🧾","🧮","💰","💸","💲","💹","🧱","🧵","🧶","📦","📌","📍","📎","🖇️","✂️","🗜️","📐","📏","🧯","🥽"].join(" ");
          api.body.appendChild(emojiTa);
        } catch (e) { console.warn(e); }

        // ---- Token/Word Counter ----
        try { api.body.appendChild(makeWordCounter()); } catch (e) { console.warn(e); }

        // ---- Instagram Extractor ----
        try { api.body.appendChild(makeInstagramExtractorBox()); } catch (e) { console.warn(e); }
api.addHr();

        // Visibility registry view
        api.addSectionTitle("Skynet Visibility Registry");
        const listWrap = document.createElement("div");
        listWrap.style.display = "flex";
        listWrap.style.flexDirection = "column";
        listWrap.style.gap = "8px";

        const renderVisibilityList = () => {
          listWrap.innerHTML = "";
          const vis = (state.visibility || []).slice().sort((a,b) => (b.lastUpdated||0) - (a.lastUpdated||0));
          if (!vis.length) {
            const empty = document.createElement("div");
            empty.style.opacity = ".7";
            empty.textContent = "(No records yet)";
            listWrap.appendChild(empty);
            return;
          }
          for (const rec of vis) {
            if (!rec || !rec.url) continue;
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.gap = "10px";
            row.style.alignItems = "center";
            row.style.justifyContent = "space-between";
            row.style.border = "1px solid rgba(0,0,0,.10)";
            row.style.borderRadius = "12px";
            row.style.padding = "8px 10px";
            row.style.background = "rgba(255,255,255,.6)";
            if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
              row.style.border = "1px solid rgba(255,255,255,.10)";
              row.style.background = "rgba(255,255,255,.06)";
            }

            const left = document.createElement("div");
            left.style.display = "flex";
            left.style.flexDirection = "column";
            left.style.gap = "2px";
            left.style.minWidth = "0";

            const t = document.createElement("div");
            t.style.fontWeight = "800";
            t.style.fontSize = "12px";
            t.style.whiteSpace = "nowrap";
            t.style.overflow = "hidden";
            t.style.textOverflow = "ellipsis";
            t.textContent = rec.applicationname || "Site";

            const u = document.createElement("div");
            u.style.opacity = ".75";
            u.style.fontSize = "12px";
            u.style.whiteSpace = "nowrap";
            u.style.overflow = "hidden";
            u.style.textOverflow = "ellipsis";
            u.textContent = rec.url;

            left.appendChild(t);
            left.appendChild(u);

            const right = document.createElement("div");
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "qcoretm_btn";
            toggle.textContent = rec.visibility === false ? "Show" : "Hide";
            toggle.addEventListener("click", () => {
              __qcoreSetSkynetVisibilityForSite(state, rec.url, rec.visibility === false);
              __qcoreSetRootStateSafe(state);
              if (__qcoreNormSiteUrl(rec.url) === __qcoreCurrentSiteUrl()) {
                __qcoreApplySkynetContainerVisibilityFromState(state);
                visBadge.textContent = __qcoreGetSkynetVisibilityForSite(state) ? "Skynet: visible" : "Skynet: hidden";
              }
              renderVisibilityList();
            });
            right.appendChild(toggle);

            row.appendChild(left);
            row.appendChild(right);
            listWrap.appendChild(row);
          }
        };

        renderVisibilityList();
        api.body.appendChild(listWrap);

        // Re-render tools if tools register while modal open
        window.QCoreToolsModal.__rerenderToolsButtons = () => {
          try { __qcoreRenderToolsButtons(); } catch {}
        };
      },
      onClose: () => {
        try { window.QCoreToolsModal.__rerenderToolsButtons = null; } catch {}
        __qcoreToolsButtonsContainer = null;
        __qcoreToolsModalApi = null;
      },
    });

    return __qcoreToolsModalApi;
  }

  // ------------------------------
  // Auto-boot (resume-running tools) – tools provide their own autoBoot handlers
  // ------------------------------
  function __qcoreAutoBootAllTools() {
    __qcoreFlushPendingToolRegistrations();
    const tools = getTools();
    for (const t of tools) {
      if (typeof t.autoBoot !== "function") continue;
      try { t.autoBoot(); } catch (e) { console.warn("[QCoreToolsModal] autoBoot error:", t.id, e); }
    }
    try { window.QCoreToolsModal.__autoBootRan = true; } catch {}
  }

  // Run after script load (in a glued bundle this happens after all modules are evaluated).
  try { setTimeout(__qcoreAutoBootAllTools, 0); } catch {}

  // ------------------------------
  // Export Core API
  // ------------------------------
  window.QCoreToolsModal = Object.assign(window.QCoreToolsModal || {}, {
    version: __QCORE_TOOLS_MODAL_VERSION,
    build: __QCORE_BUILD,
    pageGate: window.__QCORE_TOOLS_MODAL_PAGE_GATE,

    // registry
    registerTool,
    unregisterTool,
    getTools,
    flushPendingToolRegistrations: __qcoreFlushPendingToolRegistrations,

    // modals
    createToolModal,
    makeJsonDownloadModal: __qcoreMakeJsonDownloadModal,
    makeGrokDownloadModal: __qcoreMakeGrokDownloadModal,

    // state helpers
    getRootStateSafe: __qcoreGetRootStateSafe,
    setRootStateSafe: __qcoreSetRootStateSafe,

    // visibility
    ensureVisibilityRegistry: __qcoreEnsureVisibilityRegistry,
    toggleSkynetContainerVisibilityForThisSite: __qcoreToggleSkynetContainerVisibilityForThisSite,
    getSkynetVisibilityForSite: __qcoreGetSkynetVisibilityForSite,
    setSkynetVisibilityForSite: __qcoreSetSkynetVisibilityForSite,
    applySkynetContainerVisibilityFromState: __qcoreApplySkynetContainerVisibilityFromState,

    // main entry
    showToolsModal,

    // auto-boot
    autoBootAllTools: __qcoreAutoBootAllTools,

    // shared helpers already defined above in the original core block
    sleep: __qcoreSleep,
    loadPluginIfNeeded,
    ensurePeopleManager,
    flashEmoji,
    safeNowIso,
    __qcoreSanitizeProjectName,
    __qcoreMakeScrapeFilename,
    __qcoreDownloadBlob,
    __qcoreConvertScrapeFileToJsonDownload,
    __qcoreConvertScrapeFilesToJsonDownload,
    __qcoreCollectUrlsFromJsonValue,
    __qcoreUniq,
    qcoreUniq: __qcoreUniq,
    copyAllTabUrls,
    clearLocalStorage,
    clearSessionStorage,
    clearIndexedDB,
    clearCacheStorage,
    clearCache,
    clearChromeBrowsingData,
    globalSet: __qcoreGlobalSet,
    globalGetAll: __qcoreGlobalGetAll,
    globalClear: __qcoreGlobalClear,
    makeDownloader,
    makeDownloaderSection,
    makeInstagramExtractorBox,
    makeWordCounter,
  });

  // Execute any pending tool registrations now that core API exists.
  __qcoreFlushPendingToolRegistrations();
  // ------------------------------ PromptChunker Compatibility Patch (ChatGPT DOM) ------------------------------
  // Fixes: getResponse() returning [] / empty on modern ChatGPT DOM, which breaks the Automate loop (Q_WRITE never fills).
  function __qcoreChatGPT_isChatGPTHost() {
    try {
      const h = String(location.hostname || "").toLowerCase();
      return h.includes("chatgpt.com") || h.includes("chat.openai.com");
    } catch {
      return false;
    }
  }

  function __qcoreChatGPT_findAssistantNodes() {
    try {
      // Primary selector used by ChatGPT webapp (new + stable across multiple UI revs):
      //   div[data-message-author-role="assistant"]
      const direct = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
      if (direct.length) return direct;

      // Fallback: some layouts wrap turns in articles
      const turns = Array.from(document.querySelectorAll('article[data-testid="conversation-turn"]'));
      const viaTurns = [];
      for (const t of turns) {
        const a = t.querySelector('div[data-message-author-role="assistant"]');
        if (a) viaTurns.push(a);
      }
      if (viaTurns.length) return viaTurns;

      // Last-ditch fallback
      return Array.from(document.querySelectorAll('[data-testid*="assistant"]'));
    } catch {
      return [];
    }
  }

  function __qcoreChatGPT_extractAssistantText(node) {
    try {
      if (!node) return "";
      const content =
        node.querySelector(".markdown") ||
        node.querySelector('[data-testid="markdown"]') ||
        node.querySelector('[data-message-content="true"]') ||
        node;
      const t = content?.innerText || content?.textContent || "";
      return String(t || "").trim();
    } catch {
      return "";
    }
  }

  function __qcoreChatGPT_lastAssistantText() {
    try {
      const nodes = __qcoreChatGPT_findAssistantNodes();
      if (!nodes.length) return "";
      return __qcoreChatGPT_extractAssistantText(nodes[nodes.length - 1]);
    } catch {
      return "";
    }
  }

  async function __qcoreChatGPT_waitForStableResponse({ timeoutMs = 180_000, stableMs = 1200 } = {}) {
    try {
      const start = Date.now();
      let last = "";
      let lastChange = Date.now();

      while (Date.now() - start < timeoutMs) {
        const t = __qcoreChatGPT_lastAssistantText();

        // Streaming indicator (varies by build)
        const stopBtn =
          document.querySelector('button[aria-label="Stop generating"]') ||
          document.querySelector('button[data-testid="stop-button"]') ||
          null;

        const streaming = !!stopBtn;

        if (t && t !== last) {
          last = t;
          lastChange = Date.now();
        }

        const stable = t && Date.now() - lastChange >= stableMs;
        if (stable && !streaming) return t;

        await new Promise((r) => setTimeout(r, 350));
      }

      return last || "";
    } catch {
      return "";
    }
  }

  function __qcoreChatGPT_sendPromptFallback(promptText) {
    try {
      const ta =
        document.querySelector("textarea#prompt-textarea") ||
        document.querySelector('textarea[data-testid="prompt-textarea"]') ||
        document.querySelector('textarea[placeholder*="Message"]') ||
        document.querySelector("textarea");

      if (!ta) return false;

      ta.focus();
      ta.value = String(promptText || "");
      ta.dispatchEvent(new Event("input", { bubbles: true }));

      const sendBtn =
        document.querySelector('button[data-testid="send-button"]') ||
        document.querySelector('button[aria-label="Send prompt"]') ||
        document.querySelector('button[aria-label="Send"]') ||
        null;

      if (sendBtn) {
        sendBtn.click();
        return true;
      }

      // Fallback: "Enter" to send (may insert newline if UI expects shift+enter; still better than nothing)
      try {
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      } catch {}
      return true;
    } catch {
      return false;
    }
  }

  function __qcorePatchPromptChunker() {
    try {
      const PC = window?.QCorePromptChunker;
      if (!PC || typeof PC !== "object") return false;
      if (PC.__qcore_patched_v1) return true;

      const origGet = typeof PC.getResponse === "function" ? PC.getResponse.bind(PC) : null;
      const origSend = typeof PC.sendPrompt === "function" ? PC.sendPrompt.bind(PC) : null;

      PC.getResponse = async function patchedGetResponse(opts) {
        // Prefer original implementation if it returns meaningful content.
        try {
          if (origGet) {
            const r = await origGet(opts);
            const txt = Array.isArray(r) ? r.join("\n") : r == null ? "" : String(r);
            if (String(txt || "").trim().length) return String(txt).trim();
          }
        } catch {}

        // Fallback: scrape ChatGPT DOM
        if (__qcoreChatGPT_isChatGPTHost()) {
          const t = await __qcoreChatGPT_waitForStableResponse({ timeoutMs: 180_000 });
          return String(t || "").trim();
        }

        return "";
      };

      PC.sendPrompt = async function patchedSendPrompt(promptText, opts) {
        // Try original first.
        try {
          if (origSend) {
            const r = await origSend(promptText, opts);
            if (r !== false) return r;
          }
        } catch {}

        // Fallback: DOM-based send on ChatGPT
        if (__qcoreChatGPT_isChatGPTHost()) {
          return __qcoreChatGPT_sendPromptFallback(promptText);
        }

        return false;
      };

      PC.__qcore_patched_v1 = true;
      try {
        console.log("🧩✅ QCorePromptChunker patched (ChatGPT DOM fallback enabled)");
      } catch {}
      return true;
    } catch {
      return false;
    }
  }

  // Install patch with retries (PromptChunker may load after ToolsModal on some pages)
  (function __qcorePromptChunkerPatchRetry() {
    try {
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        const ok = __qcorePatchPromptChunker();
        if (ok || tries >= 20) clearInterval(iv);
      }, 500);
    } catch {}
  })();


})();