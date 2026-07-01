// On macOS the native traffic-light buttons live top-left — shift our toolbar clear of them.
if (window.rekhAPI.isMac) document.body.classList.add('is-mac');

// Window Controls
document.getElementById('btn-minimize').addEventListener('click', () => window.rekhAPI.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.rekhAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.rekhAPI.close());

// DOM refs
const omnibox = document.getElementById('omnibox');
const tabList = document.getElementById('tab-list');
const tabContainer = document.getElementById('tab-container');
const newTabBtn = document.getElementById('new-tab-btn');
const vpnIndicator = document.getElementById('vpn-indicator');
const startPage = document.getElementById('start-page');
const startSearch = document.getElementById('start-search');
const startForm = document.getElementById('start-search-form');
const btnTheme = document.getElementById('btn-theme');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const btnBookmark = document.getElementById('btn-bookmark');
const btnLibrary = document.getElementById('btn-library');
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const trackerCount = document.getElementById('tracker-count');

// Privacy state (mirrored from main; source of truth is rekh-config.json).
let privacyState = { blockAds:true, hideSearchAds:true, httpsOnly:false, doh:false, clearOnExit:false, blocked:0 };
function updateTrackerCount(n) { privacyState.blocked = n||0; trackerCount.textContent = n>0 ? Number(n).toLocaleString() : ''; }
window.rekhAPI.onBlockedCount((n) => updateTrackerCount(n));
let tabs = [], activeTabId = null, tabIdCounter = 0;

// All tabs share one proxied partition so the VPN/proxy + kill switch actually
// cover browsing traffic. main.js also forces this partition via will-attach-webview.
const WEB_PARTITION = 'persist:rekh-web';

// --- AI API key lives ONLY in the main process (OS keychain). The renderer
// never holds the plaintext — it only knows whether a key is set. ------------
let aiKeyStatus = { has: false, enc: false, encAvailable: false };
async function loadAiKeyStatus() {
  // Migrate keys saved by older builds into main, then purge them from the renderer.
  const legacyEnc = localStorage.getItem('rekh_ai_apikey_enc');
  const legacyPlain = localStorage.getItem('rekh_ai_apikey');
  try {
    if (legacyEnc) { await window.rekhAPI.importAiKeyEnc(legacyEnc); }
    else if (legacyPlain) { await window.rekhAPI.setAiKey(legacyPlain); }
  } catch (e) {}
  localStorage.removeItem('rekh_ai_apikey_enc');
  localStorage.removeItem('rekh_ai_apikey');
  try { aiKeyStatus = await window.rekhAPI.aiStatus(); } catch (e) {}
}

// Toast
function showToast(msg, duration=3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._hide); t._hide = setTimeout(() => t.classList.remove('show'), duration);
}

// Tab Manager
function createTab(url='about:blank', title='New Tab') {
  const id = ++tabIdCounter;
  const webview = document.createElement('webview');
  webview.id = `webview-${id}`; webview.src = url; webview.style.display = 'none';
  webview.setAttribute('partition', WEB_PARTITION);
  tabContainer.appendChild(webview);

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item'; tabEl.dataset.tabId = id;
  // Build with textContent so a hostile page <title> can't inject markup.
  tabEl.innerHTML = `<span class="tab-favicon">🌐</span><span class="tab-title"></span><button class="tab-close" data-tab-id="${id}">✕</button>`;
  tabEl.querySelector('.tab-title').textContent = title;
  tabEl.addEventListener('click', (e) => { if (!e.target.closest('.tab-close')) switchTab(id); });
  tabEl.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  tabList.appendChild(tabEl);

  webview.addEventListener('did-navigate', (e) => {
    const blank = !e.url || e.url === 'about:blank';
    const t=tabs.find(x=>x.id===id); if(t){ t.url=e.url; t.faviconUrl=null; }
    if (getActiveTab()?.id===id) { omnibox.value = blank ? '' : e.url; updateStartPage(); updateNavButtons(); updateBookmarkStar(); }
    updateTabTitle(id, blank ? 'New Tab' : e.url);
    if (!blank) pushHistory(e.url, t ? t.title : e.url);
    saveSession();
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    if (!e.isMainFrame) return;
    const t=tabs.find(x=>x.id===id); if(t) t.url=e.url;
    if (getActiveTab()?.id===id) { omnibox.value=e.url; updateNavButtons(); updateBookmarkStar(); }
  });
  webview.addEventListener('page-title-updated', (e) => { updateTabTitle(id,e.title||'Untitled'); const t=tabs.find(x=>x.id===id); if(t) updateHistoryTitle(t.url, e.title); });
  webview.addEventListener('did-start-loading', () => { updateTabFavicon(id,'⏳'); if(getActiveTab()?.id===id) updateNavButtons(); });
  webview.addEventListener('did-stop-loading', () => { const t=tabs.find(x=>x.id===id); if(t && t.url && t.url!=='about:blank') setTabFaviconImg(id, t.faviconUrl); else updateTabFavicon(id,'🌐'); if(getActiveTab()?.id===id) updateNavButtons(); });
  webview.addEventListener('page-favicon-updated', (e) => { const t=tabs.find(x=>x.id===id); if(t && e.favicons && e.favicons.length){ t.faviconUrl=e.favicons[0]; setTabFaviconImg(id, t.faviconUrl); } });
  webview.addEventListener('found-in-page', (e) => { if(getActiveTab()?.id===id && e.result){ findCount.textContent = e.result.matches ? `${e.result.activeMatchOrdinal}/${e.result.matches}` : 'No results'; } });

  tabs.push({ id, webview, element: tabEl, url, title, loading: false });
  switchTab(id);
  if (url==='about:blank') { omnibox.value=''; }
  return tabs[tabs.length-1];
}
function switchTab(id) {
  activeTabId = id;
  tabs.forEach(t => { t.webview.style.display = t.id===id ? 'inline-flex' : 'none'; t.element.classList.toggle('active', t.id===id); });
  const active = getActiveTab();
  if (active) { omnibox.value = active.url!=='about:blank' ? active.url : ''; }
  updateStartPage();
  updateNavButtons();
  updateBookmarkStar();
}
function closeTab(id) {
  if (tabs.length<=1) { const t=tabs.find(x=>x.id===id); if(t){ t.webview.src='about:blank'; t.url='about:blank'; t.title='New Tab'; updateTabTitle(id,'New Tab'); switchTab(id); } return; }
  const idx = tabs.findIndex(t=>t.id===id);
  if (idx===-1) return;
  tabs[idx].webview.remove(); tabs[idx].element.remove();
  tabs.splice(idx,1);
  if (activeTabId===id) switchTab(tabs[Math.min(idx,tabs.length-1)].id);
  saveSession();
}
function getActiveTab() { return tabs.find(t=>t.id===activeTabId)||null; }
function updateTabTitle(id,title) { const t=tabs.find(x=>x.id===id); if(!t) return; const clean = (!title || title==='about:blank') ? 'New Tab' : title; t.title=clean; const el=t.element.querySelector('.tab-title'); if(el) el.textContent=clean; }
function updateTabFavicon(id,icon) { const t=tabs.find(x=>x.id===id); if(!t) return; const el=t.element.querySelector('.tab-favicon'); if(el) el.textContent=icon; }
function setTabFaviconImg(id, url) {
  const t=tabs.find(x=>x.id===id); if(!t) return;
  const el=t.element.querySelector('.tab-favicon'); if(!el) return;
  // Fall back to the site's root /favicon.ico (many sites don't declare a
  // <link rel="icon">), then to the globe glyph if that also fails.
  let fav=null; try { if(t.url && /^https?:/i.test(t.url)) fav=new URL(t.url).origin + '/favicon.ico'; } catch(e){}
  const primary = url || fav;
  if(!primary){ el.textContent='🌐'; return; }
  let triedFallback=false;
  const img=document.createElement('img'); img.alt='';
  img.onerror=()=>{ if(!triedFallback && fav && fav!==img.getAttribute('src')){ triedFallback=true; img.src=fav; return; } el.textContent='🌐'; };
  el.textContent=''; el.appendChild(img);
  img.src=primary;
}

// Navigation shared by the top address bar and the centered start-page search.
function navigate(query) {
  const q = (query || '').trim();
  if (!q) return;
  const url = q.includes('.') || q.startsWith('http') ? (q.startsWith('http') ? q : `https://${q}`) : `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  const active = getActiveTab();
  if (!active) return;
  active.webview.src = url; active.url = url; omnibox.value = url;
  switchTab(active.id);
  saveSession();
}
// Show the centered REKH start page whenever the active tab is empty.
function updateStartPage() {
  const active = getActiveTab();
  const isHome = !active || !active.url || active.url === 'about:blank';
  startPage.classList.toggle('visible', isHome);
  if (isHome) { startSearch.value = ''; setTimeout(() => startSearch.focus(), 0); }
}
// Omnibox
omnibox.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(omnibox.value); });
startForm.addEventListener('submit', (e) => { e.preventDefault(); navigate(startSearch.value); });
newTabBtn.addEventListener('click', () => createTab('about:blank','New Tab'));
document.addEventListener('keydown', (e) => { if ((e.ctrlKey||e.metaKey) && e.key==='t') { e.preventDefault(); createTab('about:blank','New Tab'); } });
// Open Settings (the only place the VPN can be toggled) — titlebar gear or Ctrl/Cmd+,
document.getElementById('btn-settings').addEventListener('click', () => openUtilityPanel('settings'));
document.addEventListener('keydown', (e) => { if ((e.ctrlKey||e.metaKey) && e.key===',') { e.preventDefault(); openUtilityPanel('settings'); } });

// VPN
function updateVpnIndicator(state) {
  vpnIndicator.classList.remove('active','error');
  if (state==='active') { vpnIndicator.classList.add('active'); vpnIndicator.title='Privacy Mode: ON'; }
  else if (state==='error') { vpnIndicator.classList.add('error'); vpnIndicator.title='⚠️ VPN Failed!'; }
  else { vpnIndicator.title='Privacy Mode: OFF'; }
}
window.rekhAPI.onVpnHealthStatus((data) => { if (data.healthy) updateVpnIndicator('active'); });
window.rekhAPI.onVpnKillSwitch((data) => { updateVpnIndicator('error'); showToast(`🔒 ${data.reason}`, 6000); });
async function syncVpnState() {
  try { const state = await window.rekhAPI.getProxyState(); if(state && state.vpnEnabled!==undefined) { localStorage.setItem('rekh_vpn', state.vpnEnabled?'true':'false'); updateVpnIndicator(state.vpnEnabled?'active':'off'); } }
  catch(e) { const saved=localStorage.getItem('rekh_vpn')==='true'; updateVpnIndicator(saved?'active':'off'); }
}

// Utility Sidebar (simplified)
const utilSidebar = document.getElementById('utility-sidebar');
const utilTitle = document.getElementById('utility-sidebar-title');
const utilList = document.getElementById('utility-list');
const utilClose = document.getElementById('utility-sidebar-close');
const overlay = document.getElementById('ai-overlay');
let utilOpen=false;
function openUtilityPanel(type) {
  if (aiOpen) closeAI();
  let title='', items=[];
  switch(type) {
    case 'bookmarks': title='📚 Bookmarks'; items=[{favicon:'🔖',title:'REKH Docs',url:'https://rekh.dev'},{favicon:'🔖',title:'Chromium',url:'https://chromium.org'}]; break;
    case 'history': title='🕒 History'; items=[{favicon:'🌐',title:'Google',url:'https://google.com'},{favicon:'🌐',title:'GitHub',url:'https://github.com'}]; break;
    case 'downloads': title='⬇️ Downloads'; items=[{favicon:'📄',title:'No downloads yet',url:''}]; break;
    case 'settings': title='⚙️ Settings'; renderSettings(); utilTitle.textContent=title; utilSidebar.classList.add('open'); overlay.classList.add('open'); utilOpen=true; return;
  }
  utilTitle.textContent=title;
  utilList.innerHTML = items.map(it => `<li><span class="favicon">${it.favicon}</span><span class="title">${it.title}</span><span class="url">${it.url}</span></li>`).join('');
  utilSidebar.classList.add('open'); overlay.classList.add('open'); utilOpen=true;
}
function closeUtility() { utilSidebar.classList.remove('open'); overlay.classList.remove('open'); utilOpen=false; }
utilClose.addEventListener('click', closeUtility);

// Settings
function renderSettings() {
  const sp=localStorage.getItem('rekh_ai_provider')||'off', se=localStorage.getItem('rekh_ai_endpoint')||'', sm=localStorage.getItem('rekh_ai_model')||'', vpn=localStorage.getItem('rekh_vpn')==='true';
  const proxyRules = localStorage.getItem('rekh_proxy_rules')||'socks5://localhost:9050';
  // attr() escapes values placed inside HTML attributes so a stray quote can't break out.
  const attr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  utilList.innerHTML = `
    <div class="setting-item"><label>🔒 Privacy (VPN)</label><div class="toggle ${vpn?'active':''}" data-setting="vpn"></div></div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Proxy rules</label>
      <input id="proxy-rules-input" type="text" placeholder="socks5://localhost:9050" value="${attr(proxyRules)}" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;" />
    </div>
    <div style="padding:12px 0 4px 16px;color:rgba(var(--ink),0.3);font-size:10px;border-top:1px solid rgba(var(--ink),0.03);letter-spacing:1px;">PRIVACY</div>
    <div class="setting-item"><label>🛡️ Block ads &amp; trackers</label><div class="toggle ${privacyState.blockAds?'active':''}" data-priv="blockAds"></div></div>
    <div class="setting-item"><label>🔎 Hide sponsored search results</label><div class="toggle ${privacyState.hideSearchAds?'active':''}" data-priv="hideSearchAds"></div></div>
    <div class="setting-item"><label>🔐 HTTPS-only mode</label><div class="toggle ${privacyState.httpsOnly?'active':''}" data-priv="httpsOnly"></div></div>
    <div class="setting-item"><label>🌐 DNS-over-HTTPS</label><div class="toggle ${privacyState.doh?'active':''}" data-priv="doh"></div></div>
    <div class="setting-item"><label>🧹 Clear data on exit</label><div class="toggle ${privacyState.clearOnExit?'active':''}" data-priv="clearOnExit"></div></div>
    <div style="padding:4px 16px 8px;font-size:12px;color:rgba(var(--ink),0.3);">${(privacyState.blocked||0).toLocaleString()} trackers blocked this session</div>
    <div style="padding:12px 0 4px 16px;color:rgba(var(--ink),0.3);font-size:10px;border-top:1px solid rgba(var(--ink),0.03);letter-spacing:1px;">AI CONFIG</div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Provider</label>
      <select id="ai-provider-select" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;">
        <option value="off" ${sp==='off'?'selected':''}>Off</option>
        <option value="anthropic" ${sp==='anthropic'?'selected':''}>Anthropic (Claude)</option>
        <option value="openai" ${sp==='openai'?'selected':''}>OpenAI</option>
        <option value="openrouter" ${sp==='openrouter'?'selected':''}>OpenRouter</option>
        <option value="ollama" ${sp==='ollama'?'selected':''}>Ollama</option>
        <option value="custom" ${sp==='custom'?'selected':''}>Custom</option>
      </select>
    </div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Endpoint</label>
      <input id="ai-endpoint-input" type="text" placeholder="http://localhost:11434/api/generate" value="${attr(se)}" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;" />
    </div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">API Key ${aiKeyStatus.has ? '· <span style="color:#7bbf7b;">set ✓</span> · <a id="ai-key-clear" href="#" style="color:rgba(var(--ink),0.4);">clear</a>' : ''}</label>
      <input id="ai-key-input" type="password" placeholder="${aiKeyStatus.has ? '•••••••• stored — type to replace' : 'sk-...'}" value="" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;" />
      <div style="font-size:11px;color:rgba(var(--ink),0.28);line-height:1.4;">${aiKeyStatus.encAvailable ? '🔒 Encrypted in your OS keychain — stays on this device (sent only to your AI provider); the browser UI cannot read it back.' : '⚠️ OS encryption unavailable — key stored unencrypted on disk.'}</div>
    </div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Model</label>
      <input id="ai-model-input" type="text" placeholder="llama3" value="${attr(sm)}" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;" />
    </div>
    <div style="padding:12px 16px;"><button id="ai-save-settings" style="width:100%;background:#C8A24A;border:none;border-radius:8px;padding:10px;color:#0B0B0D;font-weight:600;font-size:13px;font-family:'Inter',sans-serif;cursor:pointer;">Save AI Settings</button></div>
  `;
  // VPN toggle
  const vt = document.querySelector('.setting-item .toggle[data-setting="vpn"]');
  if (vt) vt.addEventListener('click', async (e) => {
    e.stopPropagation(); vt.classList.toggle('active');
    const en = vt.classList.contains('active');
    const pr = document.getElementById('proxy-rules-input')?.value.trim() || 'socks5://localhost:9050';
    localStorage.setItem('rekh_proxy_rules', pr);
    try {
      const r = await window.rekhAPI.setProxy({ vpnEnabled: en, proxyRules: pr });
      if(r.success) { localStorage.setItem('rekh_vpn', en?'true':'false'); updateVpnIndicator(en?'active':'off'); showToast(en?'🛡️ VPN enabled':'🔓 VPN disabled',1500); }
      else { vt.classList.toggle('active'); showToast('❌ Failed to apply proxy',2000); }
    }
    catch(err) { vt.classList.toggle('active'); showToast('❌ Failed to enable VPN',2000); }
  });
  utilList.querySelectorAll('.toggle[data-priv]').forEach(tg => tg.addEventListener('click', (e) => {
    e.stopPropagation(); tg.classList.toggle('active');
    const key = tg.getAttribute('data-priv');
    privacyState[key] = tg.classList.contains('active');
    window.rekhAPI.setPrivacy(privacyState);
    const names = { blockAds:'Ad & tracker blocking', hideSearchAds:'Hide sponsored search results', httpsOnly:'HTTPS-only mode', doh:'DNS-over-HTTPS', clearOnExit:'Clear data on exit' };
    showToast((privacyState[key]?'On — ':'Off — ')+names[key], 1400);
  }));
  document.getElementById('ai-save-settings')?.addEventListener('click', () => {
    const p=document.getElementById('ai-provider-select').value;
    const e=document.getElementById('ai-endpoint-input').value.trim();
    const k=document.getElementById('ai-key-input').value.trim();
    const m=document.getElementById('ai-model-input').value.trim();
    localStorage.setItem('rekh_ai_provider',p); localStorage.setItem('rekh_ai_endpoint',e);
    localStorage.setItem('rekh_ai_model',m);
    if (k) { window.rekhAPI.setAiKey(k).then(s => { aiKeyStatus = s; }); } // only when a new key is typed
    const b=document.getElementById('ai-save-settings'); b.textContent='✓ Saved'; setTimeout(()=>{b.textContent='Save AI Settings';},1500);
  });
  // Prefill endpoint/model with sane defaults when a provider is chosen (only
  // if those fields are empty, so it never clobbers a user's own values).
  document.getElementById('ai-provider-select')?.addEventListener('change', (ev) => {
    const p = ev.target.value;
    const epEl = document.getElementById('ai-endpoint-input');
    const mdEl = document.getElementById('ai-model-input');
    const ENDPOINTS = { anthropic:'https://api.anthropic.com/v1/messages', openai:'https://api.openai.com/v1/chat/completions', openrouter:'https://openrouter.ai/api/v1/chat/completions', ollama:'http://localhost:11434/api/generate' };
    const MODELS = { anthropic:'claude-opus-4-8', ollama:'llama3' };
    if (epEl && ENDPOINTS[p] && !epEl.value.trim()) epEl.value = ENDPOINTS[p];
    if (mdEl && MODELS[p] && !mdEl.value.trim()) mdEl.value = MODELS[p];
  });
  document.getElementById('ai-key-clear')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    window.rekhAPI.setAiKey('').then(s => { aiKeyStatus = s; renderSettings(); });
  });
}

// AI Sidebar
const aiSidebar = document.getElementById('ai-sidebar');
const aiToggle = document.getElementById('btn-ai-toggle');
const aiClose = document.getElementById('ai-sidebar-close');
const aiThread = document.getElementById('ai-thread');
const aiInput = document.getElementById('ai-input');
const aiSend = document.getElementById('ai-send');
const aiClearBtn = document.getElementById('ai-clear');
const aiStatus = document.getElementById('ai-status');
const aiActions = document.querySelectorAll('.ai-action-btn');
let aiConversation = [], aiBusy = false;
let aiOpen = false;
function openAI() { closeUtility(); aiSidebar.classList.add('open'); overlay.classList.add('open'); aiToggle.classList.add('active'); aiOpen=true; }
function closeAI() { aiSidebar.classList.remove('open'); overlay.classList.remove('open'); aiToggle.classList.remove('active'); aiOpen=false; }
aiToggle.addEventListener('click', () => aiOpen ? closeAI() : openAI());
aiClose.addEventListener('click', closeAI);
overlay.addEventListener('click', () => { if (utilOpen) closeUtility(); if (aiOpen) closeAI(); });

// --- Chat with the page. Untrusted model output is inserted as TEXT only. ----
function aiAddBubble(role, text) {
  const ph = aiThread.querySelector('.ai-placeholder'); if (ph) ph.remove();
  const el = document.createElement('div');
  el.className = 'ai-msg ' + (role === 'user' ? 'user' : 'assistant');
  el.textContent = text;
  aiThread.appendChild(el);
  const wrap = document.getElementById('ai-output-wrapper');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
  return el;
}
async function capturePageText() {
  const a = getActiveTab();
  if (a && a.webview && a.url && a.url !== 'about:blank') {
    try { return await a.webview.executeJavaScript('document.body.innerText.slice(0,6000)'); } catch (e) {}
  }
  return '';
}
function autoGrowInput() { aiInput.style.height = 'auto'; aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px'; }
async function aiAsk(text) {
  text = (text || '').trim();
  if (aiBusy || !text) return;
  const provider = localStorage.getItem('rekh_ai_provider') || 'off';
  const endpoint = localStorage.getItem('rekh_ai_endpoint') || '';
  const model = localStorage.getItem('rekh_ai_model') || '';
  if (provider === 'off' || !endpoint) { aiAddBubble('assistant', '⚠️ AI not configured — open Settings (⚙) and choose a provider.'); return; }
  aiBusy = true; aiSend.disabled = true;
  aiAddBubble('user', text);
  aiConversation.push({ role: 'user', content: text });
  aiInput.value = ''; autoGrowInput();
  const thinking = aiAddBubble('assistant', '✦ thinking…'); thinking.classList.add('ai-thinking');
  aiStatus.textContent = 'Processing…';
  const pageText = await capturePageText();
  const messages = [];
  if (pageText) messages.push({ role: 'system', content: "You are REKH's built-in assistant. The user is viewing a web page; use its content to answer their questions.\n\n--- PAGE CONTENT ---\n" + pageText });
  for (const m of aiConversation) messages.push(m);
  try {
    const result = await window.rekhAPI.aiRequest({ provider, endpoint, model, messages });
    thinking.remove();
    if (result.error) { aiAddBubble('assistant', 'Error: ' + result.error); aiStatus.textContent = 'Error'; }
    else { aiAddBubble('assistant', result.text); aiConversation.push({ role: 'assistant', content: result.text }); aiStatus.textContent = 'Ready'; }
  } catch (err) { thinking.remove(); aiAddBubble('assistant', 'Error: ' + err.message); aiStatus.textContent = 'Error'; }
  aiBusy = false; aiSend.disabled = false; aiInput.focus();
}
const AI_ACTION_PROMPTS = {
  summarize: 'Summarize this page concisely.',
  explain: 'Explain what this page is about in simple terms.',
  extract: 'Extract the key points from this page as a bullet list.',
  rewrite: 'Rewrite the main content of this page more clearly.'
};
aiActions.forEach(b => b.addEventListener('click', () => aiAsk(AI_ACTION_PROMPTS[b.dataset.action] || b.dataset.action)));
aiInput.addEventListener('input', autoGrowInput);
aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiAsk(aiInput.value); } });
aiSend.addEventListener('click', () => aiAsk(aiInput.value));
aiClearBtn.addEventListener('click', () => { aiConversation = []; aiThread.innerHTML = '<span class="ai-placeholder">Ask about this page, or pick an action above.</span>'; aiStatus.textContent = 'Ready'; });

// Theme: Auto (time-of-day) / Light / Dark, cycled via the title-bar button.
function applyTheme() {
  const mode = localStorage.getItem('rekh_theme') || 'auto';
  let light;
  if (mode === 'light') light = true;
  else if (mode === 'dark') light = false;
  else { const h = new Date().getHours(); light = h >= 7 && h < 19; } // day = light
  document.body.classList.toggle('theme-light', light);
  if (btnTheme) {
    btnTheme.textContent = mode === 'auto' ? '◐' : (mode === 'light' ? '☀' : '☾');
    btnTheme.title = 'Theme: ' + mode.charAt(0).toUpperCase() + mode.slice(1);
  }
}
btnTheme.addEventListener('click', () => {
  const order = ['auto', 'light', 'dark'];
  const cur = localStorage.getItem('rekh_theme') || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  localStorage.setItem('rekh_theme', next);
  applyTheme();
  showToast('Theme: ' + next.charAt(0).toUpperCase() + next.slice(1), 1200);
});
applyTheme();
setInterval(applyTheme, 60 * 1000); // re-evaluate so Auto flips when the hour crosses

// ---- Navigation buttons (back / forward / reload) ----
function updateNavButtons() {
  const a = getActiveTab();
  let back = false, fwd = false;
  if (a && a.url && a.url !== 'about:blank') {
    try { back = a.webview.canGoBack(); fwd = a.webview.canGoForward(); } catch (e) {}
  }
  btnBack.disabled = !back; btnForward.disabled = !fwd;
}
btnBack.addEventListener('click', () => { const a=getActiveTab(); try { if(a&&a.webview.canGoBack()) a.webview.goBack(); } catch(e){} });
btnForward.addEventListener('click', () => { const a=getActiveTab(); try { if(a&&a.webview.canGoForward()) a.webview.goForward(); } catch(e){} });
btnReload.addEventListener('click', () => { const a=getActiveTab(); if(a&&a.url&&a.url!=='about:blank') try { a.webview.reload(); } catch(e){} });

// ---- Bookmarks ----
function getBookmarks(){ try { return JSON.parse(localStorage.getItem('rekh_bookmarks')||'[]'); } catch(e){ return []; } }
function setBookmarks(b){ localStorage.setItem('rekh_bookmarks', JSON.stringify(b)); }
function isBookmarked(url){ return getBookmarks().some(x=>x.url===url); }
function toggleBookmark(){
  const a=getActiveTab(); if(!a||!a.url||a.url==='about:blank') return;
  const b=getBookmarks(); const i=b.findIndex(x=>x.url===a.url);
  if(i>=0){ b.splice(i,1); showToast('Bookmark removed',1200); }
  else { b.unshift({ title:a.title||a.url, url:a.url }); showToast('★ Bookmarked',1200); }
  setBookmarks(b); updateBookmarkStar();
  if(utilOpen && currentLibrarySection==='bookmarks') renderLibrary('bookmarks');
}
function updateBookmarkStar(){
  const a=getActiveTab();
  const real = a && a.url && a.url!=='about:blank';
  const on = real && isBookmarked(a.url);
  btnBookmark.textContent = on ? '★' : '☆';
  btnBookmark.classList.toggle('active', !!on);
  btnBookmark.style.visibility = real ? 'visible' : 'hidden';
}
btnBookmark.addEventListener('click', toggleBookmark);

// ---- History ----
function getHistory(){ try { return JSON.parse(localStorage.getItem('rekh_history')||'[]'); } catch(e){ return []; } }
function pushHistory(url, title){
  if(!url || url==='about:blank') return;
  let h=getHistory();
  if(h[0] && h[0].url===url){ h[0].title=title||h[0].title; }
  else { h.unshift({ url, title:title||url, ts:Date.now() }); }
  if(h.length>1000) h=h.slice(0,1000);
  localStorage.setItem('rekh_history', JSON.stringify(h));
}
function updateHistoryTitle(url, title){
  if(!url || !title) return;
  const h=getHistory();
  if(h[0] && h[0].url===url && h[0].title!==title){ h[0].title=title; localStorage.setItem('rekh_history', JSON.stringify(h)); }
}

// ---- Downloads (state pushed from main) ----
let downloads = [];
try { downloads = JSON.parse(localStorage.getItem('rekh_downloads')||'[]'); } catch(e){ downloads=[]; }
window.rekhAPI.onDownloadUpdate((d) => {
  const i=downloads.findIndex(x=>x.id===d.id);
  if(i>=0) downloads[i]=d; else downloads.unshift(d);
  localStorage.setItem('rekh_downloads', JSON.stringify(downloads.slice(0,100)));
  if(utilOpen && currentLibrarySection==='downloads') renderLibrary('downloads');
  if(d.state==='completed') showToast('⬇ '+d.filename, 1800);
});

// ---- Links that open new tabs (from main's window-open handler) ----
window.rekhAPI.onOpenNewTab((url) => { if(url) createTab(url, url); });

// ---- Session save / restore ----
function saveSession(){
  const urls = tabs.map(t=>t.url).filter(u=>u && u!=='about:blank');
  localStorage.setItem('rekh_session', JSON.stringify(urls));
}
function restoreSession(){
  let urls=[]; try { urls=JSON.parse(localStorage.getItem('rekh_session')||'[]'); } catch(e){}
  if(urls.length){ urls.forEach(u => createTab(u, u)); }
  else { createTab('about:blank','New Tab'); }
}

// ---- Find in page ----
function openFind(){ findBar.classList.add('open'); findInput.focus(); findInput.select(); }
function closeFind(){ findBar.classList.remove('open'); const a=getActiveTab(); if(a) try { a.webview.stopFindInPage('clearSelection'); } catch(e){} findInput.value=''; findCount.textContent=''; }
function doFind(forward, findNext){
  const a=getActiveTab(); const q=findInput.value;
  if(!a || !q){ findCount.textContent=''; if(a) try { a.webview.stopFindInPage('clearSelection'); } catch(e){} return; }
  try { a.webview.findInPage(q, { forward: forward!==false, findNext: !!findNext }); } catch(e){}
}
findInput.addEventListener('input', () => doFind(true, false));
findInput.addEventListener('keydown', (e) => { if(e.key==='Enter'){ e.preventDefault(); doFind(!e.shiftKey, true); } else if(e.key==='Escape'){ closeFind(); } });
document.getElementById('find-next').addEventListener('click', () => doFind(true, true));
document.getElementById('find-prev').addEventListener('click', () => doFind(false, true));
document.getElementById('find-close').addEventListener('click', closeFind);

// ---- Library panel (Bookmarks / History / Downloads) ----
let currentLibrarySection = 'bookmarks';
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function openLibrary(section){
  if(aiOpen) closeAI();
  renderLibrary(section||'bookmarks');
  utilSidebar.classList.add('open'); overlay.classList.add('open'); utilOpen=true;
}
btnLibrary.addEventListener('click', () => openLibrary('bookmarks'));
function libRow(title, url, kind){
  return `<li data-open="${escAttr(url)}"><span class="favicon">${kind==='bm'?'🔖':'🌐'}</span><span class="title">${esc(title||url)}</span><button class="lib-del" data-del="${escAttr(url)}" data-kind="${kind}" title="Remove">✕</button></li>`;
}
function downloadRow(d){
  const pct = d.total>0 ? Math.round(d.received/d.total*100) : 0;
  const status = d.state==='completed' ? '✓' : (d.state==='progressing'||d.state==='started') ? pct+'%' : esc(d.state||'');
  return `<li><span class="favicon">📄</span><span class="title">${esc(d.filename)}</span><span class="url">${status}</span></li>`;
}
function emptyMsg(m){ return `<li style="color:rgba(var(--ink),0.3);justify-content:center;">${esc(m)}</li>`; }
function renderLibrary(section){
  currentLibrarySection = section;
  utilTitle.textContent = '📚 Library';
  const seg = `<div id="lib-seg">
    <button data-sec="bookmarks" class="${section==='bookmarks'?'active':''}">Bookmarks</button>
    <button data-sec="history" class="${section==='history'?'active':''}">History</button>
    <button data-sec="downloads" class="${section==='downloads'?'active':''}">Downloads</button>
  </div>`;
  let body='';
  if(section==='bookmarks'){
    const b=getBookmarks();
    body = b.length ? b.map(it=>libRow(it.title,it.url,'bm')).join('') : emptyMsg('No bookmarks yet — click ☆ in the toolbar.');
  } else if(section==='history'){
    const h=getHistory();
    body = h.length ? h.slice(0,300).map(it=>libRow(it.title,it.url,'hist')).join('') : emptyMsg('No history yet.');
    if(h.length) body += `<div style="padding:12px 16px;"><button id="clear-history" class="lib-clear">Clear history</button></div>`;
  } else if(section==='downloads'){
    body = downloads.length ? downloads.map(downloadRow).join('') : emptyMsg('No downloads yet.');
  }
  utilList.innerHTML = seg + body;
  utilList.querySelectorAll('#lib-seg button').forEach(btn => btn.addEventListener('click', () => renderLibrary(btn.dataset.sec)));
  utilList.querySelectorAll('li[data-open]').forEach(el => el.addEventListener('click', (e) => { if(e.target.closest('.lib-del')) return; openInTab(el.getAttribute('data-open')); }));
  utilList.querySelectorAll('.lib-del').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const url=el.getAttribute('data-del');
    if(el.getAttribute('data-kind')==='bm'){ setBookmarks(getBookmarks().filter(x=>x.url!==url)); updateBookmarkStar(); }
    else { localStorage.setItem('rekh_history', JSON.stringify(getHistory().filter(x=>x.url!==url))); }
    renderLibrary(section);
  }));
  const ch=document.getElementById('clear-history'); if(ch) ch.addEventListener('click', () => { localStorage.removeItem('rekh_history'); renderLibrary('history'); });
}
function openInTab(url){
  if(!url) return;
  closeUtility();
  const a=getActiveTab();
  if(a && (!a.url || a.url==='about:blank')){ a.webview.src=url; a.url=url; omnibox.value=url; switchTab(a.id); saveSession(); }
  else createTab(url, url);
}

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if(!mod) return;
  if(e.key==='f'){ e.preventDefault(); openFind(); }
  else if(e.key==='l'){ e.preventDefault(); omnibox.focus(); omnibox.select(); }
  else if(e.key==='r'){ e.preventDefault(); const a=getActiveTab(); if(a&&a.url&&a.url!=='about:blank') try { a.webview.reload(); } catch(err){} }
  else if(e.key==='w'){ e.preventDefault(); if(activeTabId!=null) closeTab(activeTabId); }
  else if(e.key==='d'){ e.preventDefault(); toggleBookmark(); }
});

// Init
loadAiKeyStatus();
restoreSession();
syncVpnState();
window.rekhAPI.getPrivacy().then((p) => { if(p){ privacyState = Object.assign(privacyState, p); updateTrackerCount(p.blocked||0); } });
