// UI panels extracted from newtab.js: the Vault panel, the Connections
// catalog (AI + VPN providers), and the Settings panel. Loaded as a classic
// script AFTER newtab.js, sharing its global scope (utilList, showToast, etc.).
/* exported renderVault, renderSettings, renderKnowledge, renderTools, renderShare, extractMedia */ // invoked cross-file by newtab.js
// --- Vault panel: create / unlock / manage. All crypto is in main; this UI only
// sends the master password + entries and shows what main returns. ---------------
async function renderVault() {
  const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fieldCss = "background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:9px 12px;font-size:13px;outline:none;width:100%;box-sizing:border-box;";
  const btnCss = "width:100%;background:#C8A24A;border:none;border-radius:8px;padding:10px;color:#0B0B0D;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;";
  let status = { exists:false, unlocked:false };
  try { status = await window.rekhAPI.vaultStatus(); } catch(e){}

  if (!status.exists) {
    utilList.innerHTML = `<div style="padding:16px;display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:13px;color:rgba(var(--ink),0.6);line-height:1.5;">Create a master password to encrypt your vault. It never leaves this device and is <b>not recoverable</b> — if you forget it, the data is gone.</div>
      <input id="v-new" type="password" placeholder="Master password (min 8 chars)" style="${fieldCss}" />
      <input id="v-new2" type="password" placeholder="Confirm master password" style="${fieldCss}" />
      <button id="v-create" style="${btnCss}">Create Vault</button>
      <div id="v-msg" style="font-size:12px;color:#c86a6a;min-height:14px;"></div></div>`;
    document.getElementById('v-create').addEventListener('click', async () => {
      const a=document.getElementById('v-new').value, b=document.getElementById('v-new2').value, msg=document.getElementById('v-msg');
      if(a.length<8){ msg.textContent='At least 8 characters.'; return; }
      if(a!==b){ msg.textContent='Passwords do not match.'; return; }
      const r=await window.rekhAPI.vaultCreate(a);
      if(r.ok){ showToast('🔐 Vault created',1500); renderVault(); } else { msg.textContent=r.error||'Failed.'; }
    });
    return;
  }
  if (!status.unlocked) {
    utilList.innerHTML = `<div style="padding:16px;display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:13px;color:rgba(var(--ink),0.6);">Enter your master password to unlock.</div>
      <input id="v-unlock" type="password" placeholder="Master password" style="${fieldCss}" />
      <button id="v-unlock-btn" style="${btnCss}">Unlock</button>
      <div id="v-msg" style="font-size:12px;color:#c86a6a;min-height:14px;"></div></div>`;
    const tryUnlock = async () => {
      const msg=document.getElementById('v-msg');
      const r=await window.rekhAPI.vaultUnlock(document.getElementById('v-unlock').value);
      if(r.ok){ showToast('🔓 Vault unlocked',1200); renderVault(); } else { msg.textContent=r.error||'Failed.'; }
    };
    document.getElementById('v-unlock-btn').addEventListener('click', tryUnlock);
    document.getElementById('v-unlock').addEventListener('keydown', (e)=>{ if(e.key==='Enter') tryUnlock(); });
    return;
  }
  // Unlocked
  let list = { items:[] };
  try { list = await window.rekhAPI.vaultList(); } catch(e){}
  const rows = (list.items||[]).map(it => `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(var(--ink),0.05);">
      <div style="flex:1;min-width:0;"><div style="font-size:13px;">${esc(it.label)}</div><div style="font-size:11px;color:rgba(var(--ink),0.4);">${esc(it.username)}</div></div>
      <button class="v-reveal" data-id="${it.id}" style="background:rgba(var(--ink),0.06);border:none;border-radius:6px;color:rgb(var(--ink));padding:5px 9px;font-size:11px;cursor:pointer;">Reveal</button>
      <button class="v-copy" data-id="${it.id}" style="background:rgba(var(--ink),0.06);border:none;border-radius:6px;color:rgb(var(--ink));padding:5px 9px;font-size:11px;cursor:pointer;">Copy</button>
      <button class="v-del" data-id="${it.id}" style="background:none;border:none;color:rgba(var(--ink),0.4);cursor:pointer;font-size:14px;">✕</button></div>`).join('')
    || `<div style="padding:16px;color:rgba(var(--ink),0.4);font-size:13px;">No entries yet. Add one below.</div>`;
  utilList.innerHTML = `<div style="display:flex;justify-content:flex-end;padding:8px 12px;"><button id="v-lock" style="background:rgba(var(--ink),0.06);border:none;border-radius:6px;color:rgb(var(--ink));padding:6px 12px;font-size:12px;cursor:pointer;">🔒 Lock</button></div>
    <div id="v-reveal-box" style="padding:0 12px 8px;"></div>
    <div>${rows}</div>
    <div style="padding:14px 12px;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(var(--ink),0.05);">
      <div style="font-size:11px;color:rgba(var(--ink),0.35);letter-spacing:1px;">ADD ENTRY</div>
      <input id="v-label" type="text" placeholder="Label (e.g. GitHub)" style="${fieldCss}" />
      <input id="v-user" type="text" placeholder="Username / email (optional)" style="${fieldCss}" />
      <input id="v-secret" type="password" placeholder="Password / secret" style="${fieldCss}" />
      <button id="v-add" style="${btnCss}">Add to Vault</button></div>`;
  document.getElementById('v-lock').addEventListener('click', async ()=>{ await window.rekhAPI.vaultLock(); showToast('🔒 Vault locked',1200); renderVault(); });
  document.getElementById('v-add').addEventListener('click', async ()=>{
    const label=document.getElementById('v-label').value.trim();
    if(!label){ showToast('Label required',1500); return; }
    const entry={ label, username:document.getElementById('v-user').value.trim(), secret:document.getElementById('v-secret').value, type:'login' };
    const r=await window.rekhAPI.vaultAdd(entry);
    if(r.ok){ showToast('✓ Saved',1200); renderVault(); } else { showToast(r.error||'Failed',1500); }
  });
  utilList.querySelectorAll('.v-reveal').forEach(b=>b.addEventListener('click', async ()=>{
    const r=await window.rekhAPI.vaultGet(b.dataset.id); const box=document.getElementById('v-reveal-box');
    if(r.ok && box){ box.textContent=''; const d=document.createElement('div'); d.style.cssText='padding:8px 10px;background:rgba(var(--ink),0.05);border-radius:6px;font-size:12px;word-break:break-all;'; d.textContent=`${r.item.label} — ${r.item.secret}`; box.appendChild(d); }
  }));
  utilList.querySelectorAll('.v-copy').forEach(b=>b.addEventListener('click', async ()=>{
    const r=await window.rekhAPI.vaultGet(b.dataset.id);
    if(r.ok){ try { await navigator.clipboard.writeText(r.item.secret); showToast('📋 Copied — clears in 20s',1500); setTimeout(()=>navigator.clipboard.writeText('').catch(()=>{}),20000); } catch(e){ showToast('Copy failed',1500); } }
  }));
  utilList.querySelectorAll('.v-del').forEach(b=>b.addEventListener('click', async ()=>{ await window.rekhAPI.vaultDelete(b.dataset.id); renderVault(); }));
}
function closeUtility() { utilSidebar.classList.remove('open'); overlay.classList.remove('open'); utilOpen=false; }
utilClose.addEventListener('click', closeUtility);

// --- Connections catalog: data-driven registry of AI + VPN providers a user can
// connect AFTER install. Each entry carries the link to get set up + prefilled
// config, so adding a provider is a one-line change (later: fetch remotely). -----
const AI_PROVIDERS = {
  tinfoil:    { label:'Tinfoil', tag:'private · verifiable TEE', endpoint:'https://inference.tinfoil.sh/v1/chat/completions', model:'llama3-3-70b', connectUrl:'https://tinfoil.sh/', keyHelp:'Dashboard → Private Inference → API Keys', note:'Runs in a hardware enclave the provider can’t read — the private engine behind DuckDuckGo’s Duck.ai.' },
  anthropic:  { label:'Anthropic (Claude)', endpoint:'https://api.anthropic.com/v1/messages', model:'claude-opus-4-8', connectUrl:'https://console.anthropic.com/settings/keys', keyHelp:'Console → Settings → API Keys', note:'' },
  openai:     { label:'OpenAI', endpoint:'https://api.openai.com/v1/chat/completions', model:'gpt-4o-mini', connectUrl:'https://platform.openai.com/api-keys', keyHelp:'Platform → API keys', note:'' },
  openrouter: { label:'OpenRouter', endpoint:'https://openrouter.ai/api/v1/chat/completions', model:'openai/gpt-4o-mini', connectUrl:'https://openrouter.ai/keys', keyHelp:'openrouter.ai/keys', note:'One key → hundreds of models.' },
  ollama:     { label:'Ollama (local)', endpoint:'http://localhost:11434/api/generate', model:'llama3', connectUrl:'https://ollama.com/download', keyHelp:'no key needed', note:'Runs fully on your machine — nothing leaves the device.' },
  custom:     { label:'Custom', endpoint:'', model:'', connectUrl:'', keyHelp:'', note:'Any OpenAI-compatible endpoint.' },
};
const VPN_PROVIDERS = {
  tor:        { label:'Tor', tag:'free', proxyRules:'socks5://localhost:9050', connectUrl:'https://www.torproject.org/download/', note:'Free. Run the Tor app locally, then connect.' },
  mullvad:    { label:'Mullvad', tag:'recommended', proxyRules:'socks5://10.64.0.1:1080', connectUrl:'https://mullvad.net/', note:'Privacy gold-standard: no logs, no email, pay with cash/crypto. Connect Mullvad, then use its SOCKS5. (We earn nothing from this — that’s the point.)' },
  pia:        { label:'Private Internet Access', proxyRules:'', connectUrl:'https://www.privateinternetaccess.com/', note:'Court-proven no-logs, cheap, SOCKS5. Get your SOCKS5 host/port from PIA and paste it below.' },
  windscribe: { label:'Windscribe', tag:'free tier', proxyRules:'', connectUrl:'https://windscribe.com/', note:'Has a free tier; privacy-friendly. Grab your SOCKS5 endpoint from Windscribe and paste it below.' },
};
// Open a provider's setup page as a REKH tab, and close the settings panel.
function connectOpen(url) { if (!url) return; try { createTab(url); } catch (e) {} closeUtility(); }
// Render the "get your key ↗" line + note for the selected AI provider.
function updateAiConnectInfo(id) {
  const box = document.getElementById('ai-connect-info'); if (!box) return;
  const p = AI_PROVIDERS[id];
  if (!p || id === 'off') { box.innerHTML = ''; return; }
  const link = p.connectUrl ? `<a href="#" id="ai-connect-link" style="color:#C8A24A;text-decoration:none;">Get your ${p.label} key ↗</a>` : '';
  const help = p.keyHelp ? `<span style="opacity:.55;">${link ? ' · ' : ''}${p.keyHelp}</span>` : '';
  box.innerHTML = `${p.note ? `<div style="font-size:11px;color:rgba(var(--ink),0.5);line-height:1.5;">${p.note}</div>` : ''}<div style="font-size:12px;margin-top:4px;">${link}${help}</div>`;
  const a = document.getElementById('ai-connect-link');
  if (a) a.addEventListener('click', (e) => {
    e.preventDefault();
    // Persist the selection so it survives while the user goes to fetch their key.
    localStorage.setItem('rekh_ai_provider', id);
    if (p.endpoint) localStorage.setItem('rekh_ai_endpoint', p.endpoint);
    if (p.model) localStorage.setItem('rekh_ai_model', p.model);
    connectOpen(p.connectUrl);
  });
}

// Settings
const PROVIDER_OPTIONS = [['off','Off'],['tinfoil','Tinfoil (private · TEE)'],['anthropic','Anthropic (Claude)'],['openai','OpenAI'],['openrouter','OpenRouter'],['ollama','Ollama'],['custom','Custom']];
const PRIVACY_TOGGLES = [['blockAds','🛡️ Block ads &amp; trackers'],['hideSearchAds','🔎 Hide sponsored search results'],['clickPrivacy','🎯 Block click tracking'],['httpsOnly','🔐 HTTPS-only mode'],['doh','🌐 DNS-over-HTTPS'],['clearOnExit','🧹 Clear data on exit']];
const FIELD_CSS = "background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:8px 12px;font-size:13px;outline:none;";
// Build the settings panel HTML. Repetitive rows are generated via maps so the
// function stays low-complexity (no long ternary chains).
function settingsMarkup(sp, se, sm, vpn, proxyRules) {
  const attr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const providerOpts = PROVIDER_OPTIONS.map(([v,label]) => `<option value="${v}" ${sp===v?'selected':''}>${label}</option>`).join('');
  const vpnPicks = Object.entries(VPN_PROVIDERS).map(([id,v]) => `<button class="vpn-pick" data-vpn="${id}" style="background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.1);border-radius:999px;color:rgb(var(--ink));padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit;">${v.label}${v.tag?` · ${v.tag}`:''}</button>`).join('');
  const privToggles = PRIVACY_TOGGLES.map(([key,label]) => `<div class="setting-item"><label>${label}</label><div class="toggle ${privacyState[key]?'active':''}" data-priv="${key}"></div></div>`).join('');
  const keyExtra = aiKeyStatus.has ? '· <span style="color:#7bbf7b;">set ✓</span> · <a id="ai-key-clear" href="#" style="color:rgba(var(--ink),0.4);">clear</a>' : '';
  const keyPh = aiKeyStatus.has ? '•••••••• stored — type to replace' : 'sk-...';
  const keyNote = aiKeyStatus.encAvailable ? '🔒 Encrypted in your OS keychain — stays on this device (sent only to your AI provider); the browser UI cannot read it back.' : '⚠️ OS encryption unavailable — key stored unencrypted on disk.';
  return `
    <div class="setting-item"><label>🔒 Privacy (VPN)</label><div class="toggle ${vpn?'active':''}" data-setting="vpn"></div></div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Proxy rules</label>
      <input id="proxy-rules-input" type="text" placeholder="socks5://localhost:9050" value="${attr(proxyRules)}" style="${FIELD_CSS}" />
    </div>
    <div style="padding:4px 16px 10px;">
      <div style="font-size:11px;color:rgba(var(--ink),0.35);margin-bottom:6px;">Recommended VPNs (SOCKS5) — tap to set up:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${vpnPicks}</div>
    </div>
    <div style="padding:12px 0 4px 16px;color:rgba(var(--ink),0.3);font-size:10px;border-top:1px solid rgba(var(--ink),0.03);letter-spacing:1px;">PRIVACY</div>
    ${privToggles}
    <div style="padding:4px 16px 8px;font-size:12px;color:rgba(var(--ink),0.3);">${(privacyState.blocked||0).toLocaleString()} trackers blocked this session</div>
    <div style="padding:12px 0 4px 16px;color:rgba(var(--ink),0.3);font-size:10px;border-top:1px solid rgba(var(--ink),0.03);letter-spacing:1px;">AI CONFIG</div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Provider</label>
      <select id="ai-provider-select" style="${FIELD_CSS}">${providerOpts}</select>
    </div>
    <div id="ai-connect-info" style="padding:0 16px 4px;"></div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Endpoint</label>
      <input id="ai-endpoint-input" type="text" placeholder="http://localhost:11434/api/generate" value="${attr(se)}" style="${FIELD_CSS}" />
    </div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">API Key ${keyExtra}</label>
      <input id="ai-key-input" type="password" placeholder="${keyPh}" value="" style="${FIELD_CSS}" />
      <div style="font-size:11px;color:rgba(var(--ink),0.28);line-height:1.4;">${keyNote}</div>
    </div>
    <div class="setting-item" style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;">
      <label style="font-size:12px;color:rgba(var(--ink),0.3);">Model</label>
      <input id="ai-model-input" type="text" placeholder="llama3" value="${attr(sm)}" style="${FIELD_CSS}" />
    </div>
    <div style="padding:12px 16px;"><button id="ai-save-settings" style="width:100%;background:#C8A24A;border:none;border-radius:8px;padding:10px;color:#0B0B0D;font-weight:600;font-size:13px;font-family:'Inter',sans-serif;cursor:pointer;">Save AI Settings</button></div>
  `;
}
function renderSettings() {
  const sp=localStorage.getItem('rekh_ai_provider')||'off', se=localStorage.getItem('rekh_ai_endpoint')||'', sm=localStorage.getItem('rekh_ai_model')||'', vpn=localStorage.getItem('rekh_vpn')==='true';
  const proxyRules = localStorage.getItem('rekh_proxy_rules')||'socks5://localhost:9050';
  utilList.innerHTML = settingsMarkup(sp, se, sm, vpn, proxyRules);
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
    const names = { blockAds:'Ad & tracker blocking', hideSearchAds:'Hide sponsored search results', clickPrivacy:'Click-tracking protection', httpsOnly:'HTTPS-only mode', doh:'DNS-over-HTTPS', clearOnExit:'Clear data on exit' };
    showToast((privacyState[key]?'On — ':'Off — ')+names[key], 1400);
  }));
  document.getElementById('ai-save-settings')?.addEventListener('click', () => {
    const p=document.getElementById('ai-provider-select').value;
    const e=document.getElementById('ai-endpoint-input').value.trim();
    const k=document.getElementById('ai-key-input').value.trim();
    const m=document.getElementById('ai-model-input').value.trim();
    localStorage.setItem('rekh_ai_provider',p); localStorage.setItem('rekh_ai_endpoint',e);
    localStorage.setItem('rekh_ai_model',m);
    if (k) { window.rekhAPI.setAiKey(k).then(s => { aiKeyStatus = s; }); }
    const b=document.getElementById('ai-save-settings'); b.textContent='✓ Saved'; setTimeout(()=>{b.textContent='Save AI Settings';},1500);
  });
  document.getElementById('ai-provider-select')?.addEventListener('change', (ev) => {
    const p = ev.target.value;
    const epEl = document.getElementById('ai-endpoint-input');
    const mdEl = document.getElementById('ai-model-input');
    const prov = AI_PROVIDERS[p];
    if (epEl && prov && prov.endpoint && !epEl.value.trim()) epEl.value = prov.endpoint;
    if (mdEl && prov && prov.model && !mdEl.value.trim()) mdEl.value = prov.model;
    updateAiConnectInfo(p);
  });
  document.getElementById('ai-key-clear')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    window.rekhAPI.setAiKey('').then(s => { aiKeyStatus = s; renderSettings(); });
  });
  updateAiConnectInfo(sp);
  utilList.querySelectorAll('.vpn-pick').forEach(b => b.addEventListener('click', () => {
    const v = VPN_PROVIDERS[b.dataset.vpn]; if (!v) return;
    const pr = document.getElementById('proxy-rules-input');
    if (pr && v.proxyRules) { pr.value = v.proxyRules; localStorage.setItem('rekh_proxy_rules', v.proxyRules); }
    showToast(v.note, 5000);
    connectOpen(v.connectUrl);
  }));
}


// --- Knowledge Base: personal context the user sets about themselves. Stored
// locally (localStorage); included in AI chats so the assistant knows who it helps.
// Luhn check — reduces false positives when detecting card numbers.
function luhn(num) {
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = +num[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
// Reject obviously-sensitive data from the Knowledge Base (it's sent to the AI):
// card numbers (Luhn-valid), SSNs, API keys/tokens, labelled passwords/secrets.
function kbScan(text) {
  const issues = new Set();
  for (const seq of (text.match(/\d[\d ,.-]{11,}\d/g) || [])) {
    const d = seq.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) issues.add('a card number');
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) issues.add('an SSN');
  if (/\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[posru]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(text)) issues.add('an API key or token');
  if (/\b(pass(word|phrase|wd)|secret|api[_-]?key)\b\s*[:=]\s*\S+/i.test(text)) issues.add('a password/secret');
  return [...issues];
}
function renderKnowledge() {
  let kb; try { kb = JSON.parse(localStorage.getItem('rekh_kb') || '{}'); } catch (e) { kb = {}; }
  const on = localStorage.getItem('rekh_kb_on') !== 'false';
  const attr = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const F = "background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:9px 12px;font-size:13px;outline:none;width:100%;box-sizing:border-box;";
  utilList.innerHTML = `<div style="padding:16px;display:flex;flex-direction:column;gap:10px;">
    <div style="font-size:12px;color:rgba(var(--ink),0.55);line-height:1.5;">Tell your assistant about you. Stored only on this device; included as context in your AI chats so answers fit you. Nothing is sent anywhere until you use the AI.</div>
    <input id="kb-name" type="text" placeholder="Your name" value="${attr(kb.name)}" style="${F}" />
    <input id="kb-role" type="text" placeholder="What you do (role / title)" value="${attr(kb.role)}" style="${F}" />
    <input id="kb-business" type="text" placeholder="Your business / company" value="${attr(kb.business)}" style="${F}" />
    <input id="kb-location" type="text" placeholder="Location (city, region)" value="${attr(kb.location)}" style="${F}" />
    <textarea id="kb-notes" placeholder="Anything else the assistant should know (goals, preferences, projects)…" style="${F};min-height:90px;resize:vertical;font-family:inherit;">${attr(kb.notes)}</textarea>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(var(--ink),0.6);cursor:pointer;"><input id="kb-on" type="checkbox" ${on?'checked':''} /> Include this in my AI chats</label>
    <div style="font-size:11px;color:rgba(var(--ink),0.35);line-height:1.4;">⚠️ This is sent to your AI provider — don't put passwords, card numbers, SSNs, or API keys here. Keep secrets in the 🔐 Vault.</div>
    <div id="kb-msg" style="font-size:12px;color:#c86a6a;min-height:14px;"></div>
    <button id="kb-save" style="width:100%;background:#C8A24A;border:none;border-radius:8px;padding:10px;color:#0B0B0D;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">Save</button>
  </div>`;
  document.getElementById('kb-save').addEventListener('click', () => {
    const data = {
      name: document.getElementById('kb-name').value.trim(),
      role: document.getElementById('kb-role').value.trim(),
      business: document.getElementById('kb-business').value.trim(),
      location: document.getElementById('kb-location').value.trim(),
      notes: document.getElementById('kb-notes').value.trim(),
    };
    const msg = document.getElementById('kb-msg');
    const issues = kbScan(Object.values(data).join('  '));
    if (issues.length) { if (msg) msg.textContent = '⚠️ That looks like ' + issues.join(' and ') + '. This gets sent to your AI — put secrets in the 🔐 Vault instead.'; return; }
    localStorage.setItem('rekh_kb', JSON.stringify(data));
    localStorage.setItem('rekh_kb_on', document.getElementById('kb-on').checked ? 'true' : 'false');
    if (msg) msg.textContent = '';
    showToast('🧠 Saved', 1400);
  });
}

// --- Tools (prototype): connect external services (Composio / MCP) so the AI can
// take real actions. Real connections require the REKH AI+ backend (which holds the
// Composio key server-side); this shell shows the intended flow + confirm-before-act.
const TOOL_SERVICES = [
  { id: 'gmail', label: 'Gmail', desc: 'Read & send email' },
  { id: 'gcal', label: 'Google Calendar', desc: 'Events & scheduling' },
  { id: 'github', label: 'GitHub', desc: 'Issues, PRs, repos' },
  { id: 'slack', label: 'Slack', desc: 'Messages & channels' },
  { id: 'notion', label: 'Notion', desc: 'Pages & databases' },
  { id: 'mcp', label: 'Self-hosted MCP server', desc: 'Your own tools — tokens stay local' },
];
function renderTools() {
  const rows = TOOL_SERVICES.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(var(--ink),0.05);">
      <div style="flex:1;min-width:0;"><div style="font-size:13px;">${s.label}</div><div style="font-size:11px;color:rgba(var(--ink),0.4);">${s.desc}</div></div>
      <button class="tool-connect" data-tool="${s.id}" style="background:rgba(var(--ink),0.06);border:none;border-radius:6px;color:rgb(var(--ink));padding:6px 12px;font-size:12px;cursor:pointer;">Connect</button>
    </div>`).join('');
  utilList.innerHTML = `<div style="padding:14px 12px;font-size:12px;color:rgba(var(--ink),0.55);line-height:1.5;">Let your assistant take real actions in your apps. Connecting uses a secure hosted sign-in — your passwords never touch REKH — and you approve every action before it runs.</div>
    ${rows}
    <div style="padding:14px 12px;font-size:11px;color:rgba(var(--ink),0.4);">Live connections ship with <b>REKH AI+</b> — the backend that holds the connection securely.</div>`;
  utilList.querySelectorAll('.tool-connect').forEach(b => b.addEventListener('click', () => {
    const svc = TOOL_SERVICES.find(s => s.id === b.dataset.tool);
    showToast('🔧 ' + (svc ? svc.label : 'Tool') + ' — connecting ships with REKH AI+', 3000);
  }));
}

// --- Invite a friend: opens the user's own email app with a prefilled invite
// (mailto — REKH never stores the friend's address). The referral code slot is
// ready for backend attribution/rewards later. -----------------------------------
const REKH_INVITE_URL = 'https://rekh.dev/download'; // TODO: point at the real download page when live
function renderShare() {
  const F = "background:rgba(var(--ink),0.05);border:1px solid rgba(var(--ink),0.08);border-radius:6px;color:rgb(var(--ink));padding:9px 12px;font-size:13px;outline:none;width:100%;box-sizing:border-box;";
  const ref = localStorage.getItem('rekh_ref_code') || '';
  const link = REKH_INVITE_URL + (ref ? '?ref=' + encodeURIComponent(ref) : '');
  const msg = `Hey — I've been using REKH, a private browser with built-in AI, ad & tracker blocking, a VPN, and an encrypted vault. Thought you'd like it:\n${link}`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  utilList.innerHTML = `<div style="padding:16px;display:flex;flex-direction:column;gap:10px;">
    <div style="font-size:12px;color:rgba(var(--ink),0.55);line-height:1.5;">Invite a friend to REKH. This opens your own email app with the message ready — we never store your friend's address.</div>
    <input id="sh-email" type="email" placeholder="friend@example.com" style="${F}" />
    <textarea id="sh-msg" style="${F};min-height:110px;resize:vertical;font-family:inherit;">${esc(msg)}</textarea>
    <button id="sh-send" style="width:100%;background:#C8A24A;border:none;border-radius:8px;padding:10px;color:#0B0B0D;font-weight:600;font-size:13px;cursor:pointer;font-family:inherit;">✉ Open email invite</button>
    <button id="sh-copy" style="width:100%;background:rgba(var(--ink),0.06);border:none;border-radius:8px;padding:9px;color:rgb(var(--ink));font-size:13px;cursor:pointer;font-family:inherit;">Copy invite link</button>
    <div id="sh-status" style="font-size:12px;color:rgba(var(--ink),0.4);min-height:14px;"></div>
    <div style="font-size:11px;color:rgba(var(--ink),0.3);line-height:1.4;">Referral rewards for sharing are on the way — your invite link is already set up to credit you later.</div>
  </div>`;
  document.getElementById('sh-send').addEventListener('click', () => {
    const to = document.getElementById('sh-email').value.trim();
    const body = document.getElementById('sh-msg').value;
    const mailto = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent('Try REKH — a private browser') + '&body=' + encodeURIComponent(body);
    window.rekhAPI.openExternal(mailto);
    document.getElementById('sh-status').textContent = 'Opening your email app…';
  });
  document.getElementById('sh-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); showToast('📋 Invite link copied', 1500); } catch (e) { showToast('Copy failed', 1500); }
  });
}

// --- Media extractor (renders into the AI thread; shares newtab.js globals) ---
// --- Media extractor: pull the page's images (paired with their product links)
// + filtered content links. Skips site chrome (nav/header/footer) so shopping /
// research pages stay uncluttered. Each image has a reverse-image "find source".
const reverseSearchUrl = (u) => 'https://tineye.com/search?url=' + encodeURIComponent(u);
const shopSearchUrl = (q) => 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(q);
// Strip tracking params from extracted links so what you see/click/copy is clean.
function cleanTrackingUrl(raw) {
  try {
    const u = new URL(raw); let changed = false;
    for (const k of [...u.searchParams.keys()]) {
      const n = k.toLowerCase();
      if (n.startsWith('utm_') || n.startsWith('pk_') || n.startsWith('matomo_') || ['fbclid','gclid','gclsrc','dclid','gbraid','wbraid','msclkid','yclid','twclid','igshid','mkt_tok','ref_','ref_src','_openstat','oly_enc_id','oly_anon_id','wickedid','spm','mc_eid','mc_cid','_hsenc','_hsmi','sca_esv','ei','ved','uact','oq','gs_lp','gs_lcp','gs_lcrp','gs_ssp','sclient','biw','bih','sxsrf','aqs','sourceid','gs_id','gs_rn','cvid','sk','sp','qs','sc','form'].includes(n)) { u.searchParams.delete(k); changed = true; }
    }
    return changed ? u.toString() : raw;
  } catch (e) { return raw; }
}
async function extractMedia() {
  const a = getActiveTab();
  if (!a || !a.webview || !a.url || a.url === 'about:blank') { aiAddBubble('assistant', 'Open a web page first, then tap 🖼 Media.'); return; }
  let data;
  try {
    data = await a.webview.executeJavaScript(`(() => {
      const abs = (u) => { try { return new URL(String(u), location.href).href; } catch(e){ return null; } };
      const ok = (u) => u && /^https?:/.test(u);
      const CUR = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', CAD:'C$', AUD:'A$', INR:'₹' };
      const price = (v, c) => { if (v == null || v === '') return ''; return ((CUR[c] || (c ? c + ' ' : '')) + String(v)).slice(0, 24); };
      const trim = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
      const products = [], seen = new Set();
      const add = (name, img, pr, url) => {
        if (img && typeof img === 'object') img = img.url || img[0];
        if (Array.isArray(img)) img = img[0];
        img = abs(img); url = url ? abs(url) : null;
        const key = url || img || name; if (!key || seen.has(key)) return; seen.add(key);
        if (products.length < 60) products.push({ title: trim(name).slice(0, 140), src: ok(img) ? img : null, price: pr || '', href: ok(url) ? url : null });
      };
      // JSON-LD (walk graphs + item lists; collect all Product nodes)
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        const t = [].concat(n['@type'] || []);
        if (t.some(x => /product/i.test(x))) {
          let of = n.offers; if (Array.isArray(of)) of = of[0];
          add(n.name, n.image, price(of && (of.price || of.lowPrice), of && of.priceCurrency), n.url || (of && of.url));
        }
        if (n.itemListElement) walk(n.itemListElement);
        if (n['@graph']) walk(n['@graph']);
        if (n.item) walk(n.item);
      };
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(s.textContent)); } catch(e){} if (products.length > 60) break; }
      // Microdata Product
      for (const el of document.querySelectorAll('[itemtype*="Product" i]')) {
        const g = (p, at) => { const x = el.querySelector('[itemprop="' + p + '"]'); return x ? (x.getAttribute(at) || x.getAttribute('content') || x.textContent || '') : ''; };
        add(g('name'), g('image', 'src'), price(g('price', 'content'), g('priceCurrency', 'content')), g('url', 'href'));
      }
      // Open Graph (page-level product) — only if nothing structured found yet
      if (!products.length) {
        const og = (p) => { const m = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]'); return m ? m.getAttribute('content') : ''; };
        if (og('og:image') && og('og:title')) add(og('og:title'), og('og:image'), price(og('product:price:amount') || og('og:price:amount'), og('product:price:currency') || og('og:price:currency')), og('og:url') || location.href);
      }
      if (products.length) return { cards: products, links: [], structured: true };
      // Fallback: heuristic images scoped to main content, skipping logos/chrome
      const small = (i) => (i.naturalWidth && i.naturalWidth < 64) || (i.naturalHeight && i.naturalHeight < 64);
      const isLogo = (i) => /logo|sprite|icon|avatar/i.test((i.alt || '') + ' ' + (i.className || ''));
      const here = location.href.split('#')[0];
      const scope = document.querySelector('main, [role="main"], article') || document.body;
      const cards = [];
      for (const img of scope.querySelectorAll('img')) {
        const src = abs(img.currentSrc || img.src);
        if (!ok(src) || small(img) || isLogo(img)) continue;
        if (img.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]')) continue;
        const link = img.closest('a[href]');
        let href = link ? abs(link.getAttribute('href')) : null; if (!ok(href)) href = null;
        if (href && (href.split('#')[0] === here || /[?&](q|search_query)=|\\/search\\?/i.test(href))) href = null;
        if (seen.has(href || src)) continue; seen.add(href || src);
        cards.push({ src: src, href: href, title: trim(img.alt).slice(0, 120), price: '' });
        if (cards.length >= 48) break;
      }
      const CHROME = /\\/(login|sign-?in|sign-?up|register|account|cart|checkout|wishlist|help|support|contact|about|privacy|terms|cookies?|careers|jobs|press|sitemap|settings|preferences|logout|orders|returns|faq|subscribe)(\\/|\\?|#|$)/i;
      const seenL = new Set(), links = [];
      for (const el of scope.querySelectorAll('a[href]')) {
        if (el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-label*="menu" i]')) continue;
        const href = abs(el.getAttribute('href')); const text = trim(el.textContent);
        if (!ok(href) || seenL.has(href) || CHROME.test(href)) continue;
        if (text.length < 15 && text.split(' ').length < 2) continue;
        seenL.add(href); links.push({ href: href, text: text.slice(0, 90) });
        if (links.length >= 20) break;
      }
      return { cards: cards, links: links, structured: false };
    })()`);
  } catch (e) { aiAddBubble('assistant', 'Couldn’t read this page: ' + e.message); return; }
  const cards = (data.cards || []).map(c => ({ ...c, href: c.href ? cleanTrackingUrl(c.href) : c.href }));
  const links = (data.links || []).map(l => ({ ...l, href: cleanTrackingUrl(l.href) }));
  renderMedia(cards, links, !!data.structured);
}
// One media card: thumbnail + 🔍/💲 overlays + optional price/title caption.
function mediaCard(c) {
  const cell = document.createElement('div');
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;';
  const img = document.createElement('img'); img.src = c.src || ''; img.loading = 'lazy'; img.title = c.title || c.href || c.src || '';
  img.style.cssText = 'width:100%;height:64px;object-fit:cover;border-radius:6px;background:rgba(var(--ink),0.06);cursor:pointer;display:block;';
  img.addEventListener('click', () => createTab(c.href || c.src));
  wrap.appendChild(img);
  if (c.src) {
    const find = document.createElement('button'); find.textContent = '🔍'; find.title = 'Find image source (reverse search)';
    find.style.cssText = 'position:absolute;bottom:3px;right:3px;background:rgba(0,0,0,0.6);border:none;border-radius:5px;color:#fff;font-size:11px;padding:2px 5px;cursor:pointer;';
    find.addEventListener('click', (e) => { e.stopPropagation(); createTab(reverseSearchUrl(c.src)); });
    wrap.appendChild(find);
  }
  if (c.title) {
    const cmp = document.createElement('button'); cmp.textContent = '💲'; cmp.title = 'Compare prices elsewhere';
    cmp.style.cssText = 'position:absolute;bottom:3px;left:3px;background:rgba(0,0,0,0.6);border:none;border-radius:5px;color:#fff;font-size:11px;padding:2px 5px;cursor:pointer;';
    cmp.addEventListener('click', (e) => { e.stopPropagation(); createTab(shopSearchUrl(c.title)); });
    wrap.appendChild(cmp);
  }
  cell.appendChild(wrap);
  if (c.price || c.title) {
    const cap = document.createElement('div'); cap.style.cssText = 'margin-top:3px;font-size:10px;line-height:1.25;';
    if (c.price) { const p = document.createElement('div'); p.textContent = c.price; p.style.cssText = 'color:#7bbf7b;font-weight:600;'; cap.appendChild(p); }
    if (c.title) { const t = document.createElement('div'); t.textContent = c.title; t.style.cssText = 'color:rgba(var(--ink),0.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'; cap.appendChild(t); }
    cell.appendChild(cap);
  }
  return cell;
}
function renderMedia(cards, links, structured) {
  const ph = aiThread.querySelector('.ai-placeholder'); if (ph) ph.remove();
  const box = document.createElement('div'); box.className = 'ai-msg assistant';
  const head = document.createElement('div'); head.style.cssText = 'font-size:12px;color:rgba(var(--ink),0.5);margin-bottom:8px;';
  head.textContent = structured ? `🛍️ ${cards.length} product${cards.length !== 1 ? 's' : ''} found` : `${cards.length} image${cards.length !== 1 ? 's' : ''} · ${links.length} link${links.length !== 1 ? 's' : ''}`;
  box.appendChild(head);
  if (cards.length) {
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;';
    for (const c of cards) grid.appendChild(mediaCard(c));
    box.appendChild(grid);
  }
  if (links.length) {
    const details = document.createElement('details');
    const sum = document.createElement('summary'); sum.textContent = `🔗 ${links.length} content link${links.length !== 1 ? 's' : ''}`;
    sum.style.cssText = 'font-size:12px;color:rgba(var(--ink),0.5);cursor:pointer;margin:2px 0;'; details.appendChild(sum);
    const ll = document.createElement('div'); ll.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-top:6px;';
    for (const l of links) {
      const a = document.createElement('a'); a.href = '#'; a.textContent = l.text; a.title = l.href;
      a.style.cssText = 'font-size:12px;color:#C8A24A;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      a.addEventListener('click', (e) => { e.preventDefault(); createTab(l.href); });
      ll.appendChild(a);
    }
    details.appendChild(ll); box.appendChild(details);
  }
  if (!cards.length && !links.length) { const d = document.createElement('div'); d.style.cssText = 'font-size:12px;color:rgba(var(--ink),0.4);'; d.textContent = 'No products, images, or links found on this page.'; box.appendChild(d); }
  aiThread.appendChild(box);
  const wrap = document.getElementById('ai-output-wrapper'); if (wrap) wrap.scrollTop = wrap.scrollHeight;
}