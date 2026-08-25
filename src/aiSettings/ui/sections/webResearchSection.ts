// webResearchSection.ts — Web Research settings section (M65 Iter 1).
//
// Brave API key is stored via the safeStorage-backed secret store
// (parallxElectron.secret → electron/main.cjs:1246-1290), NEVER in
// data/global-storage.json. The daily budget and ambient-enabled flag
// are non-secrets and stay in IGlobalStorageService.

import { $, addDisposableListener } from '../../../ui/dom.js';
import { InputBox } from '../../../ui/inputBox.js';
import { Toggle } from '../../../ui/toggle.js';
import { SettingsSection, createSettingRow } from '../sectionBase.js';
import type { IAISettingsService, AISettingsProfile } from '../../aiSettingsTypes.js';
import type { IStorage } from '../../../platform/storage.js';
import { createSecretStorageService } from '../../../services/secretStorageService.js';

const KEY_BRAVE_API_KEY   = 'webResearch.braveApiKey';
const KEY_DAILY_BUDGET    = 'webResearch.dailyBudget';
const KEY_AMBIENT_ENABLED = 'webResearch.ambientEnabled';
const KEY_PER_TURN_SEARCH_CAP = 'webResearch.perTurnSearchCap';
const KEY_PER_TURN_FETCH_CAP  = 'webResearch.perTurnFetchCap';
const DEFAULT_DAILY_BUDGET = 100;
const DEFAULT_PER_TURN_SEARCH_CAP = 20;
const DEFAULT_PER_TURN_FETCH_CAP  = 20;

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
      const keyRow = createSettingRow({
        label: 'Brave Search API key',
        description: 'Required for webSearch. Get a key at https://brave.com/search/api/. Stored encrypted-at-rest via safeStorage (DPAPI/Keychain/libsecret).',
        key: KEY_BRAVE_API_KEY,
        onReset: () => {
          keyInput.value = '';
          void secrets.delete(KEY_BRAVE_API_KEY).then(() => this._notifySaved(KEY_BRAVE_API_KEY));
        },
      });
      const keyInput = this._register(new InputBox(keyRow.controlSlot, {
        type: 'password',
        placeholder: 'BSA…',
        ariaLabel: 'Brave Search API key',
      }));
      const saveKey = () => {
        const v = keyInput.value.trim();
        const op = v.length === 0
          ? secrets.delete(KEY_BRAVE_API_KEY)
          : secrets.setString(KEY_BRAVE_API_KEY, v);
        void op.then(() => this._notifySaved(KEY_BRAVE_API_KEY));
      };
      this._register(keyInput.onDidSubmit(saveKey));
      this._register(addDisposableListener(keyInput.inputElement, 'blur', saveKey));
      this._addRow(keyRow.row);

      void secrets.getString(KEY_BRAVE_API_KEY).then((r) => {
        keyInput.value = r.ok && typeof r.value === 'string' ? r.value : '';
      });
    }

    // ── Daily budget (number) ──
    {
      const budgetRow = createSettingRow({
        label: 'Daily search budget',
        description: 'Maximum Brave Search API calls allowed per local-time day. Resets at local midnight. Default 100.',
        key: KEY_DAILY_BUDGET,
        onReset: () => {
          budgetInput.value = String(DEFAULT_DAILY_BUDGET);
          void this._storage!.set(KEY_DAILY_BUDGET, String(DEFAULT_DAILY_BUDGET))
            .then(() => this._notifySaved(KEY_DAILY_BUDGET));
        },
      });
      const budgetInput = this._register(new InputBox(budgetRow.controlSlot, {
        value: String(DEFAULT_DAILY_BUDGET),
        placeholder: String(DEFAULT_DAILY_BUDGET),
        ariaLabel: 'Daily search budget',
        validationFn: (raw) => {
          const n = Number(raw);
          return Number.isFinite(n) && n >= 1 ? null : 'Enter a whole number greater than 0';
        },
      }));
      budgetInput.element.classList.add('ai-settings-number-input');
      budgetInput.inputElement.type = 'number';
      budgetInput.inputElement.min = '1';
      budgetInput.inputElement.step = '1';

      const saveBudget = () => {
        const n = Math.max(1, Math.floor(Number(budgetInput.value) || DEFAULT_DAILY_BUDGET));
        budgetInput.value = String(n);
        void this._storage!.set(KEY_DAILY_BUDGET, String(n)).then(() => this._notifySaved(KEY_DAILY_BUDGET));
      };
      this._register(budgetInput.onDidSubmit(saveBudget));
      this._register(addDisposableListener(budgetInput.inputElement, 'blur', saveBudget));
      this._addRow(budgetRow.row);

      void this._storage.get(KEY_DAILY_BUDGET).then((v) => {
        budgetInput.value = v ?? String(DEFAULT_DAILY_BUDGET);
      });
    }

    // ── Per-turn caps (numbers) ──
    // How many webSearch / webFetch calls the agent may make within ONE response
    // turn. The extension reads these at runtime; blank/invalid → the defaults.
    const addCapRow = (label: string, description: string, key: string, def: number): void => {
      const row = createSettingRow({
        label,
        description,
        key,
        onReset: () => {
          input.value = String(def);
          void this._storage!.set(key, String(def)).then(() => this._notifySaved(key));
        },
      });
      const input = this._register(new InputBox(row.controlSlot, {
        value: String(def),
        placeholder: String(def),
        ariaLabel: label,
        validationFn: (raw) => {
          const n = Number(raw);
          return Number.isFinite(n) && n >= 1 ? null : 'Enter a whole number greater than 0';
        },
      }));
      input.element.classList.add('ai-settings-number-input');
      input.inputElement.type = 'number';
      input.inputElement.min = '1';
      input.inputElement.step = '1';
      const save = () => {
        const n = Math.max(1, Math.floor(Number(input.value) || def));
        input.value = String(n);
        void this._storage!.set(key, String(n)).then(() => this._notifySaved(key));
      };
      this._register(input.onDidSubmit(save));
      this._register(addDisposableListener(input.inputElement, 'blur', save));
      this._addRow(row.row);
      void this._storage!.get(key).then((v) => { input.value = v ?? String(def); });
    };

    addCapRow(
      'Per-turn search cap',
      'Maximum webSearch calls the agent may make within a single response turn. Higher = deeper research per turn (still bounded by the daily budget). Default 20.',
      KEY_PER_TURN_SEARCH_CAP,
      DEFAULT_PER_TURN_SEARCH_CAP,
    );
    addCapRow(
      'Per-turn fetch cap',
      'Maximum webFetch calls (page reads) the agent may make within a single response turn. Default 20.',
      KEY_PER_TURN_FETCH_CAP,
      DEFAULT_PER_TURN_FETCH_CAP,
    );

    // ── Ambient enabled (checkbox) ──
    {
      const ambientRow = createSettingRow({
        label: 'Allow ambient web use',
        description: 'When on, the agent may autonomously invoke webSearch/webFetch without an explicit user ask. Off by default to bound free-tier query spend.',
        key: KEY_AMBIENT_ENABLED,
        onReset: () => {
          ambientToggle.checked = false;
          void this._storage!.set(KEY_AMBIENT_ENABLED, 'false').then(() => this._notifySaved(KEY_AMBIENT_ENABLED));
        },
      });
      const ambientToggle = this._register(new Toggle(ambientRow.controlSlot, {
        checked: false,
        ariaLabel: 'Allow ambient web use',
      }));
      this._register(ambientToggle.onDidChange((checked) => {
        void this._storage!.set(KEY_AMBIENT_ENABLED, checked ? 'true' : 'false')
          .then(() => this._notifySaved(KEY_AMBIENT_ENABLED));
      }));
      this._addRow(ambientRow.row);

      void this._storage.get(KEY_AMBIENT_ENABLED).then((v) => {
        ambientToggle.checked = v === 'true';
      });
    }
  }

  update(_profile: AISettingsProfile): void {
    // Values are bound directly to storage; nothing per-profile.
  }
}
