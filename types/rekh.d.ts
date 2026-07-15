// Ambient types for REKH's IPC surface + vault. Powers editor autocomplete/hover
// and documents the renderer↔main contract. Not compiled (jsconfig checkJs:false);
// to opt a file into real type-checking, add `// @ts-check` at its top.

/** A single secret stored in the encrypted vault. */
interface VaultEntry {
  id: string;
  label: string;
  type?: string;
  username?: string;
  secret?: string;
  note?: string;
  created?: number;
  updated?: number;
}

/** One turn in an AI chat request. */
interface AiMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** The bridge the preload exposes to the renderer as `window.rekhAPI`. */
interface RekhAPI {
  isMac: boolean;
  minimize(): void; maximize(): void; close(): void;
  getProxyState(): Promise<{ vpnEnabled: boolean; proxyRules: string }>;
  setProxy(config: { vpnEnabled: boolean; proxyRules: string }): Promise<{ success: boolean; vpnEnabled: boolean; error?: string }>;
  getPrivacy(): Promise<{ blockAds: boolean; hideSearchAds: boolean; httpsOnly: boolean; doh: boolean; clearOnExit: boolean; blocked: number }>;
  setPrivacy(p: Record<string, unknown>): Promise<{ ok: boolean }>;
  onBlockedCount(cb: (n: number) => void): void;
  aiStatus(): Promise<{ has: boolean; enc: boolean; encAvailable: boolean }>;
  setAiKey(key: string): Promise<{ has: boolean; enc: boolean; encAvailable: boolean }>;
  importAiKeyEnc(b64: string): Promise<{ ok: boolean }>;
  aiRequest(opts: { provider: string; endpoint: string; model: string; messages: AiMessage[] }): Promise<{ text?: string; error?: string }>;
  onVpnHealthStatus(cb: (d: { healthy: boolean; attempts?: number }) => void): void;
  onVpnKillSwitch(cb: (d: { reason: string }) => void): void;
  onUpdateAvailable(cb: (d: unknown) => void): void;
  onUpdateDownloaded(cb: () => void): void;
  onOpenNewTab(cb: (url: string) => void): void;
  onDownloadUpdate(cb: (d: unknown) => void): void;
  // Encrypted vault
  vaultStatus(): Promise<{ exists: boolean; unlocked: boolean }>;
  vaultCreate(password: string): Promise<{ ok: boolean; error?: string }>;
  vaultUnlock(password: string): Promise<{ ok: boolean; error?: string }>;
  vaultLock(): Promise<{ ok: boolean }>;
  vaultList(): Promise<{ ok: boolean; locked?: boolean; items?: VaultEntry[] }>;
  vaultGet(id: string): Promise<{ ok: boolean; locked?: boolean; item?: VaultEntry; error?: string }>;
  vaultAdd(entry: Partial<VaultEntry>): Promise<{ ok: boolean; id?: string; locked?: boolean; error?: string }>;
  vaultDelete(id: string): Promise<{ ok: boolean; locked?: boolean }>;
}

interface Window { rekhAPI: RekhAPI; }
