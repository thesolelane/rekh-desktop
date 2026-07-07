const { app, BrowserWindow, ipcMain, session, net, safeStorage } = require('electron');
// Optional at runtime: if the module isn't bundled, auto-update just no-ops
// rather than crashing the whole app at load with a dialog.
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { console.error('[REKH] electron-updater unavailable:', e && e.message ? e.message : e); }
const fs = require('fs');
const path = require('path');
// Use the real product name in dev too, so the app/menu name and the userData
// directory (config, AI key, adblock cache) match the packaged "REKH" build.
// Must run before any app.getPath('userData') call below.
app.setName('REKH');
const APP_ICON = path.join(__dirname, 'build', 'icon.png');

// Safety net: a stray uncaught error in the main process must not kill the
// browser with the default "A JavaScript error occurred" dialog. Log it and
// keep running so one bad handler never takes down the whole app.
function logMainError(kind, err) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : err}\n`;
    fs.appendFileSync(path.join(dir, 'rekh-error.log'), line);
  } catch (e) {}
  console.error(`[REKH] ${kind}:`, err && err.message ? err.message : err);
}
process.on('uncaughtException', (err) => logMainError('uncaughtException', err));
process.on('unhandledRejection', (err) => logMainError('unhandledRejection', err));
let ElectronBlocker = null, AdblockRequest = null;
try { const m = require('@ghostery/adblocker-electron'); ElectronBlocker = m.ElectronBlocker; AdblockRequest = m.Request; } catch (e) {}
let fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
if (!fetchFn) { try { const cf = require('cross-fetch'); fetchFn = cf.default || cf; } catch (e) {} }
let tldts = null;
try { tldts = require('tldts-experimental'); } catch (e) { try { tldts = require('tldts'); } catch (_) {} }

let mainWindow;
let currentConfig = {};
let vpnHealthInterval = null;
let vpnFailCount = 0;
let killSwitchActive = false;
let realIp = null; // baseline "real" IP (direct probe) used to detect proxy leaks
let engine = null; // Ghostery ad/tracker engine (null until loaded / if unavailable)
const VPN_CHECK_INTERVAL = 15000;
const VPN_FAIL_THRESHOLD = 2;
// All browsing tabs run in this one partition so the proxy + kill switch
// actually cover web traffic. (Partitioned webview sessions do NOT inherit
// defaultSession's proxy — the original per-tab partitions bypassed the VPN.)
const WEB_PARTITION = 'persist:rekh-web';
const CONFIG_PATH = path.join(app.getPath('userData'), 'rekh-config.json');

function getWebSession() { return session.fromPartition(WEB_PARTITION); }

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) {}
  return { vpnEnabled: false, proxyRules: 'socks5://localhost:9050', blockAds: true, httpsOnly: false, doh: false, clearOnExit: false, hideSearchAds: true };
}
function saveConfig(config) { try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) {} }

async function applyProxy(config) {
  const mode = config.vpnEnabled ? 'fixed_servers' : 'direct';
  const proxyRules = config.vpnEnabled ? config.proxyRules : '';
  const proxyBypassRules = 'localhost;127.0.0.1';
  try {
    // Apply to BOTH the default session AND the browsing partition. The
    // webviews live in WEB_PARTITION, so without this the proxy did nothing
    // for actual page loads.
    await session.defaultSession.setProxy({ mode, proxyRules, proxyBypassRules });
    await getWebSession().setProxy({ mode, proxyRules, proxyBypassRules });
    if (config.vpnEnabled) {
      // Best-effort: learn the real IP via a one-off DIRECT probe so we can
      // detect a leak (proxy up but traffic not actually anonymized).
      probeRealIp().then((ip) => { realIp = ip; });
      startVpnHealthCheck();
    } else {
      // User explicitly turned privacy off — going direct is intentional here.
      stopVpnHealthCheck();
      liftKillSwitch();
      vpnFailCount = 0;
      realIp = null;
    }
    return true;
  } catch (err) { return false; }
}

function webProxySettings() {
  const proxyBypassRules = 'localhost;127.0.0.1';
  return currentConfig.vpnEnabled
    ? { mode: 'fixed_servers', proxyRules: currentConfig.proxyRules, proxyBypassRules }
    : { mode: 'direct', proxyBypassRules };
}

// --- Kill switch: FAIL CLOSED -------------------------------------------------
// On proxy failure we route the browsing session to a dead proxy so nothing
// connects — rather than falling back to a direct (deanonymizing) connection.
// (Done via proxy, not the request layer, so the ad blocker can own that layer.)
function engageKillSwitch(reason) {
  if (killSwitchActive) return;
  killSwitchActive = true;
  getWebSession().setProxy({ mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:1' });
  if (mainWindow) mainWindow.webContents.send('vpn-kill-switch', { reason: reason || 'Proxy unreachable — traffic blocked.' });
}
function liftKillSwitch() {
  if (!killSwitchActive) return;
  killSwitchActive = false;
  getWebSession().setProxy(webProxySettings());
}

// --- Privacy: ad/tracker blocking, HTTPS-only, DoH ---------------------------
// Curated list of high-impact ad/analytics/tracker domains. Suffix-matched, so
// e.g. "doubleclick.net" also covers "ads.g.doubleclick.net".
const BLOCKLIST = [
  'doubleclick.net','googlesyndication.com','googleadservices.com','google-analytics.com',
  'googletagmanager.com','googletagservices.com','adservice.google.com','app-measurement.com',
  '2mdn.net','doubleverify.com','adsafeprotected.com','moatads.com','scorecardresearch.com',
  'quantserve.com','quantcount.com','adnxs.com','adsrvr.org','rubiconproject.com','pubmatic.com',
  'openx.net','casalemedia.com','criteo.com','criteo.net','taboola.com','outbrain.com',
  'amazon-adsystem.com','advertising.com','adform.net','smartadserver.com','teads.tv',
  'sharethrough.com','contextweb.com','gumgum.com','indexww.com','yieldmo.com','33across.com',
  'bidswitch.net','mathtag.com','spotxchange.com','sonobi.com','districtm.io','demdex.net',
  'omtrdc.net','2o7.net','everesttech.net','krxd.net','bluekai.com','agkn.com','rlcdn.com',
  'crwdcntrl.net','bidr.io','adroll.com','adcolony.com','applovin.com','inmobi.com','mopub.com',
  'chartbeat.com','hotjar.com','mixpanel.com','segment.io','amplitude.com','fullstory.com',
  'mouseflow.com','crazyegg.com','newrelic.com','nr-data.net','branch.io','kochava.com',
  'appsflyer.com','adjust.com','bat.bing.com','analytics.twitter.com','ads-twitter.com',
  'analytics.tiktok.com','ct.pinterest.com','px.ads.linkedin.com','tr.snapchat.com',
  'connect.facebook.net','hs-analytics.net','mc.yandex.ru','pixel.wp.com'
];
const blockSet = new Set(BLOCKLIST);
function isBlockedHost(hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (blockSet.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

let blockedCount = 0, blockedDirty = false, blockedTimer = null;
function emitBlocked() {
  blockedDirty = true;
  if (blockedTimer) return;
  blockedTimer = setTimeout(() => {
    blockedTimer = null;
    if (blockedDirty && mainWindow) { mainWindow.webContents.send('blocked-count', blockedCount); blockedDirty = false; }
  }, 800);
}

// Single request-layer handler on the browsing session: HTTPS upgrade + ad block.
// Map Electron resource types to adblocker request types for accurate matching.
const RESOURCE_TYPE_MAP = { mainFrame:'main_frame', subFrame:'sub_frame', stylesheet:'stylesheet', script:'script', image:'image', font:'font', object:'object', xhr:'xhr', ping:'ping', cspReport:'csp_report', media:'media', webSocket:'websocket', other:'other' };

// Single request-layer handler. Uses the Ghostery engine (EasyList/EasyPrivacy
// + tracking) once it's loaded, falling back to the curated domain list before
// then / offline. HTTPS-only is handled at the navigation layer so this handler
// owns the request layer exclusively.
function adblockFilter(details, cb) {
  if (!currentConfig.blockAds) { cb({}); return; }
  try {
    if (engine && AdblockRequest) {
      const req = AdblockRequest.fromRawDetails({ url: details.url, type: RESOURCE_TYPE_MAP[details.resourceType] || 'other', sourceUrl: details.referrer || '' });
      const r = engine.match(req);
      if (r && r.redirect && r.redirect.dataUrl) { blockedCount++; emitBlocked(); cb({ redirectURL: r.redirect.dataUrl }); return; }
      if (r && r.match) { blockedCount++; emitBlocked(); cb({ cancel: true }); return; }
    } else {
      const u = new URL(details.url);
      if (u.hostname && isBlockedHost(u.hostname)) { blockedCount++; emitBlocked(); cb({ cancel: true }); return; }
    }
  } catch (e) {}
  cb({});
}
function applyAdblock(enabled) {
  const ses = getWebSession();
  if (enabled) ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, adblockFilter);
  else ses.webRequest.onBeforeRequest(null);
}
// "full" prebuilt = ads + tracking + annoyances + cookie-notices + social,
// plus the element-hiding (cosmetic) rules used by injectCosmetics().
const ENGINE_CACHE = path.join(app.getPath('userData'), 'adblock-engine-full.bin');
async function loadAdblockEngine() {
  if (!ElectronBlocker || !fetchFn) return;
  // Fast path: cached serialized engine (offline, instant).
  try { if (fs.existsSync(ENGINE_CACHE)) { engine = ElectronBlocker.deserialize(fs.readFileSync(ENGINE_CACHE)); return; } } catch (e) { engine = null; }
  // Slow path: fetch the full list set, then cache it.
  try {
    engine = await ElectronBlocker.fromPrebuiltFull(fetchFn);
    try { fs.writeFileSync(ENGINE_CACHE, Buffer.from(engine.serialize())); } catch (e) {}
  } catch (e) { engine = null; }
}
async function setupAdblock() {
  applyAdblock(currentConfig.blockAds); // curated list blocks immediately
  await loadAdblockEngine();            // adblockFilter starts using the engine live once set
}

// Search-engine ad removal. Sponsored results use obfuscated first-party markup,
// so we match by selector AND by the "Sponsored" label at runtime, re-scanning
// as late results load in.
const SEARCH_AD_SCRIPT = `(function(){
  if (window.__rekhScrub) return; window.__rekhScrub = true;
  var h = location.hostname, sel = [];
  if (/(^|\\.)google\\./.test(h)) sel = ['#tads','#tadsb','#bottomads','[data-text-ad]','.commercial-unit-desktop-top','.cu-container'];
  else if (/(^|\\.)bing\\./.test(h)) sel = ['.b_ad','.b_adTop','.b_adBottom','.b_adLastChild','.sb_adTA'];
  else if (/(^|\\.)duckduckgo\\./.test(h)) sel = ['.result--ad','[data-testid="ad"]','[data-area="ad"]','.badge--ad','ol.react-results--ad'];
  else if (/(^|\\.)yahoo\\./.test(h)) sel = ['ol.searchCenterTopAds','ol.searchCenterBottomAds','.ads'];
  else if (/(^|\\.)ecosia\\./.test(h)) sel = ['.card-ad','.result-ads','.ad-title'];
  else return;
  function hide(el){ if(el&&el.style) el.style.setProperty('display','none','important'); }
  function scrub(){
    for (var i=0;i<sel.length;i++){ var n=document.querySelectorAll(sel[i]); for (var j=0;j<n.length;j++) hide(n[j]); }
    var labels=document.querySelectorAll('span,div,cite,a');
    for (var k=0;k<labels.length;k++){ var el=labels[k];
      if (el.childElementCount===0 && /^\\s*Sponsored\\s*$/.test(el.textContent||'')){
        var c=el.closest('[data-text-ad],.g,li.b_algo,article,.result,div[data-hveid]')||el.parentElement; hide(c);
      }
    }
  }
  scrub();
  var pending=false;
  var mo=new MutationObserver(function(){ if(pending) return; pending=true; setTimeout(function(){ pending=false; scrub(); },250); });
  try { mo.observe(document.body||document.documentElement,{childList:true,subtree:true}); } catch(e){}
})();`;
function injectSearchScrub(contents) {
  if (!currentConfig.hideSearchAds) return;
  try {
    const url = contents.getURL();
    if (!/^https?:/i.test(url)) return;
    if (!/(^|\.)(google|bing|duckduckgo|yahoo|ecosia)\./.test(new URL(url).hostname)) return;
    contents.executeJavaScript(SEARCH_AD_SCRIPT).catch(() => {});
  } catch (e) {}
}

// Cosmetic filtering: inject the engine's element-hiding CSS so leftover empty
// ad slots / cookie banners collapse. Re-runs per document (dom-ready).
function injectCosmetics(contents) {
  if (!engine || !currentConfig.blockAds || !tldts) return;
  try {
    const url = contents.getURL();
    if (!/^https?:/i.test(url)) return;
    const p = tldts.parse(url);
    const { styles } = engine.getCosmeticsFilters({ url, hostname: p.hostname || '', domain: p.domain || '' });
    if (styles && styles.length) contents.insertCSS(styles);
  } catch (e) {}
}

function applyDoh(enabled) {
  try { app.configureHostResolver(enabled ? { secureDnsMode: 'secure', secureDnsServers: ['https://cloudflare-dns.com/dns-query'] } : { secureDnsMode: 'off' }); } catch (e) {}
}

// One-off DIRECT (un-proxied) probe to learn the user's real IP. Uses a separate
// session forced to mode 'direct' so it isn't affected by the proxy config.
function probeRealIp() {
  return new Promise((resolve) => {
    const probe = session.fromPartition('rekh-direct-probe');
    probe.setProxy({ mode: 'direct' }).then(() => {
      const req = net.request({ session: probe, method: 'GET', protocol: 'https:', hostname: 'api.ipify.org', path: '/?format=json' });
      let data = '';
      req.on('response', (res) => { res.on('data', (c) => { data += c; }); res.on('end', () => { try { resolve(JSON.parse(data).ip || null); } catch (e) { resolve(null); } }); });
      req.on('error', () => resolve(null));
      req.end();
    }).catch(() => resolve(null));
  });
}

function checkVpnHealth() {
  if (!currentConfig.vpnEnabled) { stopVpnHealthCheck(); return; }
  const request = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.ipify.org', path: '/?format=json' });
  request.on('response', (response) => {
    let data = '';
    response.on('data', (chunk) => { data += chunk; });
    response.on('end', () => {
      try {
        const ip = JSON.parse(data).ip || null;
        if (realIp && ip && ip === realIp) {
          // Proxy is reachable but the exit IP equals the real IP → not
          // anonymized. Treat as a leak and block traffic.
          engageKillSwitch('Traffic not routed through proxy (IP leak) — blocked.');
          return;
        }
        vpnFailCount = 0;
        liftKillSwitch(); // proxy healthy — restore traffic
        if (mainWindow) mainWindow.webContents.send('vpn-health-status', { healthy: true });
      } catch (e) { handleVpnFailure(); }
    });
  });
  request.on('error', () => handleVpnFailure());
  request.end();
}

function handleVpnFailure() {
  vpnFailCount++;
  if (vpnFailCount >= VPN_FAIL_THRESHOLD) {
    // Fail closed. Keep vpnEnabled true and keep probing so we can auto-recover,
    // but block all web traffic in the meantime so nothing leaks to clearnet.
    engageKillSwitch('Proxy failed health check — traffic blocked until it recovers.');
  } else if (mainWindow) {
    mainWindow.webContents.send('vpn-health-status', { healthy: false, attempts: vpnFailCount });
  }
}
function startVpnHealthCheck() { stopVpnHealthCheck(); setTimeout(checkVpnHealth, 1000); vpnHealthInterval = setInterval(checkVpnHealth, VPN_CHECK_INTERVAL); }
function stopVpnHealthCheck() { if (vpnHealthInterval) { clearInterval(vpnHealthInterval); vpnHealthInterval = null; } vpnFailCount = 0; }

function setupDownloads() {
  getWebSession().on('will-download', (event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    const id = `${item.getStartTime()}-${item.getFilename()}`;
    const send = (state) => { if (mainWindow) mainWindow.webContents.send('download-update', { id, filename: item.getFilename(), url: item.getURL(), savePath, received: item.getReceivedBytes(), total: item.getTotalBytes(), state }); };
    send('started');
    item.on('updated', (e, state) => send(state === 'interrupted' ? 'interrupted' : 'progressing'));
    item.once('done', (e, state) => send(state));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, frame: false, transparent: false, backgroundColor: '#0B0B0D',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
    titleBarStyle: 'hidden',
    ...(fs.existsSync(APP_ICON) ? { icon: APP_ICON } : {})
  });

  // Lock down every <webview> the renderer creates AND force it onto the
  // proxied/kill-switched partition, regardless of what the renderer requests.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    params.partition = WEB_PARTITION;
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'newtab.html'));
  if (process.env.REKH_RESET_AI) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => { mainWindow.webContents.executeJavaScript("localStorage.removeItem('rekh_ai_provider');localStorage.removeItem('rekh_ai_endpoint');localStorage.removeItem('rekh_ai_model');").catch(() => {}); }, 800);
    });
  }
  mainWindow.on('closed', () => { mainWindow = null; stopVpnHealthCheck(); });
}

function setupAutoUpdater() {
  // Only meaningful in a packaged build with the module present; skip otherwise.
  if (!autoUpdater || !app.isPackaged) return;
  // Attach listeners FIRST — an EventEmitter 'error' with no listener throws an
  // uncaught exception (the "A JavaScript error occurred" dialog).
  autoUpdater.on('error', (err) => console.error('[REKH] Update error:', err && err.message ? err.message : err));
  autoUpdater.on('update-available', (info) => { if (mainWindow) mainWindow.webContents.send('update-available', info); });
  autoUpdater.on('update-downloaded', () => { if (mainWindow) mainWindow.webContents.send('update-downloaded'); });
  const check = () => { try { const p = autoUpdater.checkForUpdatesAndNotify(); if (p && p.catch) p.catch((e) => console.error('[REKH] Update check failed:', e && e.message ? e.message : e)); } catch (e) { console.error('[REKH] Update check threw:', e && e.message ? e.message : e); } };
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  // Replace Electron's default dock icon with the REKH mark (dev + any run where the icon ships).
  if (process.platform === 'darwin' && app.dock && fs.existsSync(APP_ICON)) {
    try { app.dock.setIcon(APP_ICON); } catch (e) {}
  }
  currentConfig = loadConfig();
  if (currentConfig.blockAds === undefined) currentConfig.blockAds = true;
  if (currentConfig.hideSearchAds === undefined) currentConfig.hideSearchAds = true;
  currentConfig.httpsOnly = !!currentConfig.httpsOnly;
  currentConfig.doh = !!currentConfig.doh;
  currentConfig.clearOnExit = !!currentConfig.clearOnExit;
  applyDoh(currentConfig.doh);
  applyProxy(currentConfig);
  createWindow();
  setupAdblock();
  setupDownloads();
  setupAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
// Links that try to open a new window/tab (target=_blank, window.open) become
// new REKH tabs instead of detached Electron windows.
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (mainWindow && url && /^https?:\/\//i.test(url)) mainWindow.webContents.send('open-new-tab', url);
      return { action: 'deny' };
    });
    // HTTPS-only mode: upgrade top-level http navigations to https.
    contents.on('will-navigate', (e, url) => {
      if (currentConfig.httpsOnly && /^http:\/\//i.test(url)) { e.preventDefault(); contents.loadURL('https://' + url.slice(7)); }
    });
    // Cosmetic filtering + search-ad removal once the DOM is ready.
    contents.on('dom-ready', () => { injectCosmetics(contents); injectSearchScrub(contents); });
  }
});

let didClearOnExit = false;
app.on('before-quit', (e) => {
  if (currentConfig.clearOnExit && !didClearOnExit) {
    e.preventDefault(); didClearOnExit = true;
    Promise.allSettled([getWebSession().clearStorageData(), getWebSession().clearCache()]).finally(() => app.quit());
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });
ipcMain.on('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('rekh-get-proxy-state', () => ({ vpnEnabled: currentConfig.vpnEnabled, proxyRules: currentConfig.proxyRules }));
ipcMain.handle('rekh-set-proxy', async (event, newConfig) => {
  const enabled = !!newConfig.vpnEnabled;
  const rules = (newConfig.proxyRules || 'socks5://localhost:9050').trim();
  // Reject malformed proxy rules instead of silently passing them to Chromium.
  if (enabled && !/^(socks5|socks4|https?):\/\/[^\s/]+(:\d+)?$/i.test(rules)) {
    return { success: false, vpnEnabled: currentConfig.vpnEnabled, error: 'Invalid proxy rules' };
  }
  currentConfig.vpnEnabled = enabled;
  currentConfig.proxyRules = rules;
  saveConfig(currentConfig);
  const success = await applyProxy(currentConfig);
  return { success, vpnEnabled: currentConfig.vpnEnabled };
});

// Secret storage via the OS keychain (Keychain / DPAPI / libsecret). Falls back
// to returning plaintext (ok:false) when encryption isn't available so the
// renderer can decide how to handle it.
ipcMain.handle('rekh-get-privacy', () => ({ blockAds: currentConfig.blockAds, hideSearchAds: currentConfig.hideSearchAds, httpsOnly: currentConfig.httpsOnly, doh: currentConfig.doh, clearOnExit: currentConfig.clearOnExit, blocked: blockedCount }));
ipcMain.handle('rekh-set-privacy', (event, p) => {
  currentConfig.blockAds = !!p.blockAds;
  currentConfig.hideSearchAds = !!p.hideSearchAds;
  currentConfig.httpsOnly = !!p.httpsOnly;
  currentConfig.doh = !!p.doh;
  currentConfig.clearOnExit = !!p.clearOnExit;
  saveConfig(currentConfig);
  applyDoh(currentConfig.doh);
  applyAdblock(currentConfig.blockAds);
  return { ok: true };
});
// --- AI API key: kept ONLY in the main process; the renderer never sees it. --
function encAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // On Linux, isEncryptionAvailable() can report true while using the insecure
    // "basic_text" backend (a hardcoded password — effectively unencrypted).
    // Require a real OS keystore there.
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch (e) { return false; }
}
function readAiKey() {
  const k = currentConfig.aiKey;
  if (!k || !k.data) return '';
  if (k.enc) { try { return safeStorage.decryptString(Buffer.from(k.data, 'base64')); } catch (e) { return ''; } }
  return k.data;
}
// Report only whether a key exists (never its value) + how it's protected.
ipcMain.handle('rekh-ai-status', () => ({ has: !!(currentConfig.aiKey && currentConfig.aiKey.data), enc: !!(currentConfig.aiKey && currentConfig.aiKey.enc), encAvailable: encAvailable() }));
ipcMain.handle('rekh-set-ai-key', (event, key) => {
  if (!key) { delete currentConfig.aiKey; saveConfig(currentConfig); return { has: false, enc: false, encAvailable: encAvailable() }; }
  let enc = false, data = key;
  try { if (encAvailable()) { data = safeStorage.encryptString(key).toString('base64'); enc = true; } } catch (e) {}
  currentConfig.aiKey = { enc, data };
  saveConfig(currentConfig);
  return { has: true, enc, encAvailable: encAvailable() };
});
// One-time migration of a key an older build left in the renderer's localStorage.
ipcMain.handle('rekh-import-ai-key-enc', (event, b64) => {
  if (b64 && !(currentConfig.aiKey && currentConfig.aiKey.data)) { currentConfig.aiKey = { enc: true, data: b64 }; saveConfig(currentConfig); }
  return { ok: true };
});
// The AI request runs here, in main, so the key never enters page-facing code.
ipcMain.handle('rekh-ai-request', async (event, opts) => {
  const { provider, endpoint, model } = opts || {};
  if (!endpoint || !fetchFn) return { error: 'AI not configured.' };
  // Accept a full chat history (messages) or a single prompt (back-compat).
  const messages = (Array.isArray(opts.messages) && opts.messages.length)
    ? opts.messages
    : [{ role: 'user', content: (opts && opts.prompt) || '' }];
  const key = readAiKey();
  try {
    const headers = { 'Content-Type': 'application/json' };
    let body;
    if (provider === 'anthropic') {
      // Claude uses x-api-key + anthropic-version, requires max_tokens, takes
      // system as a top-level field, and returns content[] rather than choices[].
      if (key) headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const chat = messages.filter(m => m.role !== 'system');
      const payload = { model: model || 'claude-opus-4-8', max_tokens: 4096, messages: chat };
      if (system) payload.system = system;
      body = JSON.stringify(payload);
    } else if (provider === 'ollama') {
      // Native /api/generate takes a single prompt — flatten the chat.
      const flat = messages.map(m => (m.role === 'assistant' ? 'Assistant: ' : m.role === 'system' ? '' : 'User: ') + m.content).join('\n\n');
      body = JSON.stringify({ model, prompt: flat, stream: false });
    } else {
      if (key) headers['Authorization'] = 'Bearer ' + key;
      if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://rekh.dev'; headers['X-Title'] = 'REKH'; }
      body = JSON.stringify({ model, messages, stream: false });
    }
    const res = await fetchFn(endpoint, { method: 'POST', headers, body });
    const d = await res.json();
    let text;
    if (provider === 'anthropic') {
      text = Array.isArray(d.content)
        ? (d.content.filter(b => b && b.type === 'text').map(b => b.text).join('') || 'No response.')
        : (d.error && d.error.message) || JSON.stringify(d);
    } else if (provider === 'ollama') {
      text = d.response || (d.message && d.message.content) || 'No response.';
    } else {
      text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || (d.message && d.message.content) || (d.error && d.error.message) || JSON.stringify(d);
    }
    return { text };
  } catch (e) { return { error: e.message }; }
});
