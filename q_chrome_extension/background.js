// background.js (MV3)

// ---- Version & update note
const currentVersion = "1.5.3";
const updateDescription = "Fixed new update on the UI of ChatGPT causing issues on the Auto Full Mode.";

// ---- Helpers (promisified wrappers for Chrome callback APIs)
const pTabsQuery = (q) => new Promise(res => chrome.tabs.query(q, res));
const pWindowsCreate = (opts) => new Promise(res => chrome.windows.create(opts, res));
const pScriptingExec = (args) => new Promise((res, rej) => {
  chrome.scripting.executeScript(args, (r) => {
    const e = chrome.runtime.lastError;
    if (e) rej(new Error(e.message)); else res(r);
  });
});
const pNotificationsCreate = (id, opts) => new Promise(res => chrome.notifications.create(id, opts, res));

// ---- Tab filter
const MATCH_HOSTS = [
  "chatgpt.com",
  "openai.com",
  "instagram.com",
  "reddit.com",
  'distrokid.com',
  "facebook.com",
  "blockchain.com",
  "virginwifi.com",
  'runitbyq.com'
];
function urlMatches(u = "") {
  try {
    const h = new URL(u).hostname;
    return MATCH_HOSTS.some(dom => h === dom || h.endsWith("." + dom));
  } catch { return false; }
}



// ---- Programmatic tabs->urls provider (used by Tools modal)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "GET_TABS_URLS") {
    const query = msg.scope === "all" ? {} : { currentWindow: true };
    chrome.tabs.query(query, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message || "tabs.query failed" });
        return;
      }
      const urls = (tabs || [])
        .map(t => t.url || "")
        .filter(u =>
          u &&
          !u.startsWith("chrome://") &&
          !u.startsWith("edge://") &&
          !u.startsWith("about:") &&
          !u.startsWith("chrome-extension://") &&
          !/chrome\.google\.com\/webstore/.test(u)
        );
      sendResponse({ ok: true, urls });
    });
    return true;
  }
});

// ---- Install/Update notifications
chrome.runtime.onInstalled.addListener((details) => {
  const notify = async (title, message) => {
    const tabs = await pTabsQuery({ url: "https://chatgpt.com/*" });
    if (!tabs.length) return;
    await pNotificationsCreate("", {
      type: "basic",
      iconUrl: "images/icon128.png",
      title,
      message,
      buttons: [{ title: "Reload OpenAI Tabs" }],
      priority: 2
    });
  };

  if (details.reason === "install") {
    notify("Reload OpenAI Tabs?", "Would you like to reload your OpenAI tabs to activate the extension?");
  } else if (details.reason === "update") {
    notify("Continue Generating updated!", `Your extension was updated to ${currentVersion}.\n${updateDescription}`);
  }
});

chrome.notifications.onButtonClicked.addListener(async () => {
  const tabs = await pTabsQuery({ url: "https://chatgpt.com/*" });
  tabs.forEach(t => chrome.tabs.reload(t.id));
});



// ---- Injection list (ALWAYS) — used by your loader
const ALWAYS = [
  "core/QCoreModalBase.js",
  "core/QCoreQueueClient.js",
  "core/QCorePromptChunker.js",
  "core/QCorePlayControls.js",
  "core/QCorePeopleManager.js",
  "core/QCoreTerminalModal.js",
  "core/QCoreFilesModal.js",
  "core/QCoreTicketModal.js",
  "core/QCoreDocumentation.js",
  "core/QCoreSettingsModal.js",
  "core/QCoreToolsModal.js",
  "core/QCoreGlobal.js",
  "core/QCoreSkynet.js",
  "core/QCoreContent.js",
  "core/QCoreStatusPanel.js",
  "core/QCoreStatusLoop.js",
  "core/QCoreRemote.js",
  "core/QCoreInit.js"
];

const CONDITIONAL = [
  "plugins/blockchaincom.js",
  "plugins/instagramcom.js",
  "plugins/facebookcom.js",
  "plugins/distrokidcom.js",
  "plugins/redditcom.js",
  // "plugins/sunocom.js",
  "plugins/virginwifi.js"
];

function pickConditionals(url) {
  return CONDITIONAL.filter(p => {
    const name = p.replace("plugins/", "").replace(".js", "");
    const key = name.replace("com", "");
    return url.includes(key);
  });
}

async function injectIfMatch(tabId, url) {
  if (!urlMatches(url)) return;
  const files = [...ALWAYS, ...pickConditionals(url)];
  try {
    await pScriptingExec({ target: { tabId }, files });
    // success log in SW console
  } catch (e) {
    // visible in SW console (chrome://extensions → Inspect service worker)
    console.warn("Script injection failed:", e.message, { tabId, url, files });
  }
}

// ---- Inject on load complete
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab && tab.url) {
    injectIfMatch(tabId, tab.url);
  }
});

// ---- Also inject on activation (switching tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    injectIfMatch(activeInfo.tabId, tab.url);
  });
});

// ---- Message: full extension reload from page
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === "reloadExtension") {
    chrome.runtime.reload();
  }
});

// ---- Message: open ChatGPT then read title (MV3-compliant)
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === "openChatGPTTab") {
    chrome.tabs.create({ url: "https://chatgpt.com" }, (tab) => {
      const id = tab.id;
      const listener = async (tabId, info, changedTab) => {
        if (tabId === id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          try {
            await pScriptingExec({
              target: { tabId: id },
              func: () => document.title
            });
          } catch {}
          chrome.tabs.remove(id);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
});

// ---- Message: reload all tabs in current window
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === "restartTabs") {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      tabs.forEach(t => chrome.tabs.reload(t.id));
    });
  }
});


// ---- Message: CHECK_SITES (health checks from MV3 SW; avoids page CORS)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CHECK_SITES") return;

  const sites = Array.isArray(msg.sites) ? msg.sites : [];
  const timeoutMs = Number(msg.timeoutMs || 9000);

  const normUrl = (u) => {
    const raw = String(u || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return "https://" + raw.replace(/^\/+/, "");
  };

  const fetchWithTimeout = async (url) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    const started = Date.now();

    try {
      // HEAD first (fast), GET fallback
      let resp;
      try {
        resp = await fetch(url, {
          method: "HEAD",
          cache: "no-store",
          redirect: "follow",
          signal: ctl.signal,
        });
      } catch (_e) {
        resp = await fetch(url, {
          method: "GET",
          cache: "no-store",
          redirect: "follow",
          signal: ctl.signal,
        });
      }

      clearTimeout(to);

      const ms = Date.now() - started;
      const status = typeof resp.status === "number" ? resp.status : 0;
      const ok = resp && (resp.ok === true || (status >= 200 && status < 400));

      return {
        ok: !!ok,
        status,
        ms,
        finalUrl: resp && resp.url ? resp.url : url,
        error: "",
      };
    } catch (e) {
      clearTimeout(to);
      const ms = Date.now() - started;
      return {
        ok: false,
        status: 0,
        ms,
        finalUrl: url,
        error: e && e.message ? String(e.message) : "fetch failed",
      };
    }
  };

  const run = async () => {
    // Concurrency cap (prevents SW spikes)
    const limit = 6;
    const results = new Array(sites.length);
    let i = 0;

    const worker = async () => {
      while (i < sites.length) {
        const idx = i++;
        const s = sites[idx] || {};
        const name = String(s.name || `site_${idx}`);
        const url = normUrl(s.url);

        if (!url) {
          results[idx] = { name, url: "", ok: false, status: 0, ms: 0, error: "missing url" };
          continue;
        }

        const r = await fetchWithTimeout(url);
        results[idx] = { name, url, ...r };
      }
    };

    const workers = [];
    for (let k = 0; k < Math.min(limit, sites.length); k++) workers.push(worker());
    await Promise.all(workers);

    return results;
  };

  run()
    .then((results) => sendResponse({ ok: true, results }))
    .catch((e) => sendResponse({ ok: false, error: e && e.message ? String(e.message) : "CHECK_SITES failed" }));

  return true; // async response
});



// background.js ADD THIS LISTENER (append at bottom; no refactors)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== 'reloadTabsByTitle') return;

  const titles = Array.isArray(message.titles) ? message.titles.map(t => (t || '').trim()).filter(Boolean) : [];
  const bypassCache = !!message.bypassCache;
  const wanted = new Set(titles);

  chrome.tabs.query({}, (tabs) => {
    const reloaded = [];
    const skipped = [];

    (tabs || []).forEach((t) => {
      const tabId = t?.id;
      const title = (t?.title || '').trim();
      if (!tabId) return;

      if (wanted.has(title)) {
        try {
          chrome.tabs.reload(tabId, { bypassCache });
          reloaded.push({ tabId, windowId: t.windowId, title });
        } catch (e) {
          skipped.push({ tabId, windowId: t.windowId, title, error: String(e) });
        }
      }
    });

    sendResponse({ ok: true, wanted: titles, reloaded, skipped });
  });

  return true;
});
