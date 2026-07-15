// Encrypted vault (zero-knowledge): master password → scrypt key → AES-256-GCM.
// The derived key and decrypted items live ONLY here in the main process, only
// while unlocked. The renderer never sees the key or the ciphertext. A wrong
// password is detected by GCM auth failure on decrypt (no password is stored).
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_PATH = path.join(app.getPath('userData'), 'rekh-vault.json');
const VAULT_KDF = { N: 65536, r: 8, p: 1 }; // scrypt cost for NEW vaults; params stored per-vault
const VAULT_IDLE_MS = 15 * 60 * 1000;        // auto-lock after 15 min inactivity
let vaultKey = null, vaultItems = null, vaultIdleTimer = null; // in-memory only, while unlocked

function vaultExists() { try { return fs.existsSync(VAULT_PATH); } catch (e) { return false; } }
function vaultDeriveKey(password, saltB64, kdf) {
  const p = kdf || VAULT_KDF;
  return crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * 1024 * 1024 });
}
// Auto-lock after inactivity: wipe the key + items from memory.
function vaultTouch() { if (vaultIdleTimer) clearTimeout(vaultIdleTimer); vaultIdleTimer = setTimeout(() => { vaultKey = null; vaultItems = null; vaultIdleTimer = null; }, VAULT_IDLE_MS); }
function vaultEncrypt(key, str) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(str, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function vaultDecrypt(key, blob) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.data, 'base64')), d.final()]).toString('utf8');
}
function vaultPersist() {
  const meta = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  meta.blob = vaultEncrypt(vaultKey, JSON.stringify(vaultItems));
  fs.writeFileSync(VAULT_PATH, JSON.stringify(meta));
}

// Register the vault IPC handlers on the main process.
function register() {
  ipcMain.handle('vault-status', () => ({ exists: vaultExists(), unlocked: !!vaultKey }));
  ipcMain.handle('vault-create', (e, { password }) => {
    if (vaultExists()) return { ok: false, error: 'Vault already exists.' };
    if (!password || String(password).length < 8) return { ok: false, error: 'Master password must be at least 8 characters.' };
    const salt = crypto.randomBytes(16).toString('base64');
    vaultKey = vaultDeriveKey(password, salt, VAULT_KDF);
    vaultItems = [];
    fs.writeFileSync(VAULT_PATH, JSON.stringify({ v: 1, salt, kdf: VAULT_KDF, blob: vaultEncrypt(vaultKey, JSON.stringify(vaultItems)) }));
    vaultTouch();
    return { ok: true };
  });
  ipcMain.handle('vault-unlock', (e, { password }) => {
    if (!vaultExists()) return { ok: false, error: 'No vault yet.' };
    try {
      const meta = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
      const key = vaultDeriveKey(password, meta.salt, meta.kdf);
      const items = JSON.parse(vaultDecrypt(key, meta.blob)); // throws on wrong password (GCM auth)
      vaultKey = key; vaultItems = items; vaultTouch();
      return { ok: true };
    } catch (err) { return { ok: false, error: 'Wrong master password.' }; }
  });
  ipcMain.handle('vault-lock', () => { vaultKey = null; vaultItems = null; if (vaultIdleTimer) { clearTimeout(vaultIdleTimer); vaultIdleTimer = null; } return { ok: true }; });
  ipcMain.handle('vault-list', () => {
    if (!vaultKey) return { ok: false, locked: true };
    vaultTouch();
    return { ok: true, items: vaultItems.map(it => ({ id: it.id, label: it.label, type: it.type || 'login', username: it.username || '' })) };
  });
  ipcMain.handle('vault-get', (e, { id }) => {
    if (!vaultKey) return { ok: false, locked: true };
    vaultTouch();
    const it = vaultItems.find(x => x.id === id);
    return it ? { ok: true, item: it } : { ok: false, error: 'Not found.' };
  });
  ipcMain.handle('vault-add', (e, { entry }) => {
    if (!vaultKey) return { ok: false, locked: true };
    vaultTouch();
    if (!entry || !entry.label) return { ok: false, error: 'A label is required.' };
    const now = Date.now();
    if (entry.id) {
      const i = vaultItems.findIndex(x => x.id === entry.id);
      if (i >= 0) vaultItems[i] = { ...vaultItems[i], ...entry, updated: now };
    } else {
      entry.id = crypto.randomBytes(8).toString('hex'); entry.created = now; entry.updated = now;
      vaultItems.push(entry);
    }
    vaultPersist();
    return { ok: true, id: entry.id };
  });
  ipcMain.handle('vault-delete', (e, { id }) => {
    if (!vaultKey) return { ok: false, locked: true };
    vaultTouch();
    vaultItems = vaultItems.filter(x => x.id !== id);
    vaultPersist();
    return { ok: true };
  });
}

module.exports = { register };
