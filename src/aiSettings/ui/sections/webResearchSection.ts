// webResearchSection.ts — Web Research settings section (M65 Iter 1).
//
// Brave API key is stored via the safeStorage-backed secret store
// (parallxElectron.secret → electron/main.cjs:1246-1290), NEVER in
// data/global-storage.json. The daily budget and ambient-enabled flag
// are non-secrets and stay in IGlobalStorageService.

import { $ } from '../../../ui/dom.js';
import { SettingsSection } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IStorage } from '../../../platform/storage.js';
import { createSecretStorageService } from '../../../services/secretStorageService.js';

const KEY_BRAVE_API_KEY   = 'webResearch.braveApiKey';
const KEY_DAILY_BUDGET    = 'webResearch.dailyBudget';
const KEY_AMBIENT_ENABLED = 'webResearch.ambientEnabled';
const DEFAULT_DAILY_BUDGET = 100;

export class WebResearchSection extends SettingsSection {

  private readonly _storage: IStorage | undefined;

  constructor(service: IAISettingsService, storage?: IStorage) {
    super(service, 'web-research', 'Web Research');
    this._storage = storage;
  }

  build(): void {
    if (!this._storage) {
      const warn = $('div.ai-settings-row__description');
      warn.textContent = 'Global storage unavailable; Web Research settings cannot be edited.';
      this.contentElement.appendChild(warn);
      return;
    }

    // ── Brave API key (password input, encrypted at rest via safeStorage) ──
    {
      const secrets = createSecretStorageService();
      const row = $('div.ai-settings-row');
      row.dataset.settingKey = KEY_BRAVE_API_KEY;
      row.dataset.searchLabel = 'brave search api key web research';
      row.dataset.searchDesc = 'brave search api key';
      const header = $('div.ai-settings-row__header');
      header.appendChild($('div.ai-settings-row__label', 'Brave Search API key'));
      row.appendChild(header);
      const desc = $('div.ai-settings-row__description',
        'Required for webSearch. Get a key at https://brave.com/search/api/. Stored encrypted-at-rest via safeStorage (DPAPI/Keychain/libsecret).');
      row.appendChild(desc);
      const slot = $('div.ai-settings-row__control');
      const input = document.createElement('input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.className = 'ai-settings-input';
      input.placeholder = 'BSA…';
      slot.appendChild(input);
      row.appendChild(slot);
      this.contentElement.appendChild(row);
      (this as unknown as { _rows: HTMLElement[] })._rows.push(row);

      void secrets.getString(KEY_BRAVE_API_KEY).then((r) => {
        input.value = r.ok && typeof r.value === 'string' ? r.value : '';
      });
      input.addEventListener('change', () => {
        const v = input.value.trim();
        if (v.length === 0) {
          void secrets.delete(KEY_BRAVE_API_KEY);
        } else {
          void secrets.setString(KEY_BRAVE_API_KEY, v);
        }
      });
    }

    // ── Daily budget (number) ──
    {
      const row = $('div.ai-settings-row');
      row.dataset.settingKey = KEY_DAILY_BUDGET;
      row.dataset.searchLabel = 'daily budget searches web research';
      row.dataset.searchDesc = 'daily search budget';
      const header = $('div.ai-settings-row__header');
      header.appendChild($('div.ai-settings-row__label', 'Daily search budget'));
      row.appendChild(header);
      row.appendChild($('div.ai-settings-row__description',
        'Maximum Brave Search API calls allowed per local-time day. Resets at local midnight. Default 100.'));
      const slot = $('div.ai-settings-row__control');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.className = 'ai-settings-input';
      input.placeholder = String(DEFAULT_DAILY_BUDGET);
      slot.appendChild(input);
      row.appendChild(slot);
      this.contentElement.appendChild(row);
      (this as unknown as { _rows: HTMLElement[] })._rows.push(row);

      void this._storage.get(KEY_DAILY_BUDGET).then((v) => { input.value = v ?? String(DEFAULT_DAILY_BUDGET); });
      input.addEventListener('change', () => {
        const n = Math.max(1, Math.floor(Number(input.value) || DEFAULT_DAILY_BUDGET));
        input.value = String(n);
        void this._storage!.set(KEY_DAILY_BUDGET, String(n));
      });
    }

    // ── Ambient enabled (checkbox) ──
    {
      const row = $('div.ai-settings-row');
      row.dataset.settingKey = KEY_AMBIENT_ENABLED;
      row.dataset.searchLabel = 'ambient web research enabled';
      row.dataset.searchDesc = 'allow agent autonomous web access';
      const header = $('div.ai-settings-row__header');
      header.appendChild($('div.ai-settings-row__label', 'Allow ambient web use'));
      row.appendChild(header);
      row.appendChild($('div.ai-settings-row__description',
        'When on, the agent may autonomously invoke webSearch/webFetch without an explicit user ask. Off by default to bound free-tier query spend.'));
      const slot = $('div.ai-settings-row__control');
      const input = document.createElement('input');
      input.type = 'checkbox';
      slot.appendChild(input);
      row.appendChild(slot);
      this.contentElement.appendChild(row);
      (this as unknown as { _rows: HTMLElement[] })._rows.push(row);

      void this._storage.get(KEY_AMBIENT_ENABLED).then((v) => { input.checked = v === 'true'; });
      input.addEventListener('change', () => {
        void this._storage!.set(KEY_AMBIENT_ENABLED, input.checked ? 'true' : 'false');
      });
    }
  }

  update(_profile: AISettingsProfile): void {
    // Values are bound directly to storage; nothing per-profile.
  }
}
