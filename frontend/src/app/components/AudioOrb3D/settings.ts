import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface AgentSettings {
  languageCode: 'hi-IN' | 'en-IN' | 'gu-IN';
  speaker: string;
  provider: 'groq' | 'cerebras';
  groqModel: string;
  cerebrasModel: string;
  groqTemperature: number;
  cerebrasTemperature: number;
  groqMaxTokens: number;
  cerebrasMaxTokens: number;
  promptId: string;
  promptContent: string;
  greeting: string;
  showDebugLogs: boolean;
  useDeployedServer: boolean;
  customServerUrl: string;
}

export interface PromptOption {
  id: string;
  title: string;
  filename: string;
  content: string;
}

export const SPEAKERS = [
  { id: 'shubh', name: 'Shubh (Male, Hindi)', gender: 'male' },
  { id: 'amit', name: 'Amit (Male, Hindi)', gender: 'male' },
  { id: 'hitesh', name: 'Hitesh (Male, Hindi)', gender: 'male' },
  { id: 'divya', name: 'Divya (Female, Hindi)', gender: 'female' },
  { id: 'kavya', name: 'Kavya (Female, Hindi)', gender: 'female' },
];

export const LANGUAGES = [
  { code: 'gu-IN', name: 'Gujarati' },
  { code: 'hi-IN', name: 'Hindi' },
  { code: 'en-IN', name: 'English (Indian)' },
];

const GROQ_MODELS = [
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
];

const CEREBRAS_MODELS = [
  'gpt-oss-120b',
  'gpt-oss-20b',
];

type SettingsTab = 'general' | 'model' | 'prompt';

@customElement('gdm-settings-modal')
export class GdmSettingsModal extends LitElement {
  @property({ type: Boolean }) declare isOpen: boolean;

  @state() declare activeTab: SettingsTab;
  @state() declare languageCode: string;
  @state() declare speaker: string;
  @state() declare provider: string;
  @state() declare groqModel: string;
  @state() declare cerebrasModel: string;
  @state() declare groqTemperature: number;
  @state() declare cerebrasTemperature: number;
  @state() declare groqMaxTokens: number;
  @state() declare cerebrasMaxTokens: number;
  @state() declare promptId: string;
  @state() declare promptContent: string;
  @state() declare greeting: string;
  @state() declare showDebugLogs: boolean;
  @state() declare useDeployedServer: boolean;
  @state() declare customServerUrl: string;
  @state() declare prompts: PromptOption[];
  @state() declare loadingPrompts: boolean;
  @state() declare hasUnsavedChanges: boolean;
  @state() declare savedSnapshot: string;

  static styles = css`
    :host {
      --bg: #0a0a0a;
      --surface: #111111;
      --surface-hover: #161616;
      --border: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.14);
      --text: #f0f0f0;
      --text-2: rgba(255, 255, 255, 0.55);
      --text-3: rgba(255, 255, 255, 0.3);
      --accent: #00e09e;
      --accent-dim: rgba(0, 224, 158, 0.1);
      --accent-hover: #33e8b4;
      --danger: #ff5c5c;
      --danger-dim: rgba(255, 92, 92, 0.08);
      --radius: 10px;
      --radius-lg: 16px;
      --font-sans: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', monospace;

      font-family: var(--font-sans);
    }

    /* ---- Overlay ---- */
    .overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 16px;
      box-sizing: border-box;
    }

    .overlay[open] {
      display: flex;
      align-items: center;
      justify-content: center;
      animation: overlayIn 0.18s ease-out;
    }

    @keyframes overlayIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ---- Modal shell ---- */
    .modal {
      width: min(720px, 100%);
      max-height: min(88vh, 860px);
      display: flex;
      flex-direction: column;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04);
      animation: modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }

    @keyframes modalIn {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* ---- Header ---- */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 22px 0 22px;
      flex-shrink: 0;
    }

    .header h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--text);
    }

    .close-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      color: var(--text-3);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: var(--text);
    }

    /* ---- Tabs ---- */
    .tabs {
      display: flex;
      gap: 2px;
      padding: 14px 22px 0;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .tab {
      padding: 8px 16px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-3);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: -1px;
      letter-spacing: 0.01em;
      font-family: var(--font-sans);
    }

    .tab:hover {
      color: var(--text-2);
    }

    .tab[data-active] {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    /* ---- Body ---- */
    .body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 22px;
    }

    .body::-webkit-scrollbar {
      width: 4px;
    }

    .body::-webkit-scrollbar-track {
      background: transparent;
    }

    .body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 2px;
    }

    /* ---- Section within body ---- */
    .section {
      margin-bottom: 24px;
    }

    .section:last-child {
      margin-bottom: 0;
    }

    .section-label {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-3);
    }

    .section-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ---- Fields ---- */
    .field {
      margin-bottom: 16px;
    }

    .field:last-child {
      margin-bottom: 0;
    }

    .field-label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-2);
    }

    .field-hint {
      margin-top: 5px;
      font-size: 11.5px;
      color: var(--text-3);
      line-height: 1.4;
    }

    .field-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* ---- Inputs ---- */
    select,
    input[type="text"],
    input[type="number"] {
      width: 100%;
      box-sizing: border-box;
      padding: 9px 12px;
      font-size: 13.5px;
      font-family: var(--font-sans);
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: border-color 0.15s, box-shadow 0.15s;
      appearance: none;
      -webkit-appearance: none;
    }

    select {
      background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
      cursor: pointer;
    }

    select option {
      background: #111;
      color: #eee;
    }

    input[type="number"] {
      font-family: var(--font-mono);
      font-size: 13px;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-dim);
    }

    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      resize: vertical;
      min-height: 120px;
      line-height: 1.6;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    input[list] {
      font-family: var(--font-mono);
      font-size: 13px;
    }

    /* ---- Toggle row ---- */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .toggle-info {
      flex: 1;
    }

    .toggle-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      margin: 0;
    }

    .toggle-desc {
      font-size: 11.5px;
      color: var(--text-3);
      margin-top: 2px;
    }

    /* Custom toggle switch */
    .switch {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .switch-track {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 11px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .switch-track::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s;
    }

    .switch input:checked + .switch-track {
      background: var(--accent);
    }

    .switch input:checked + .switch-track::after {
      transform: translateX(18px);
      background: #fff;
    }

    /* ---- Provider selector (segmented control) ---- */
    .provider-segmented {
      display: flex;
      gap: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 3px;
      overflow: hidden;
    }

    .provider-option {
      flex: 1;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      color: var(--text-3);
      background: transparent;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      transition: all 0.15s;
      font-family: var(--font-sans);
    }

    .provider-option:hover {
      color: var(--text-2);
    }

    .provider-option[data-active] {
      background: rgba(0, 224, 158, 0.1);
      color: var(--accent);
      font-weight: 600;
    }

    /* ---- Provider-specific model config ---- */
    .model-config {
      margin-top: 16px;
      padding: 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .model-config-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: var(--accent);
    }

    .model-config-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }

    /* ---- Char counter ---- */
    .char-count {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-3);
    }

    /* ---- Footer ---- */
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 22px;
      border-top: 1px solid var(--border);
      flex-shrink: 0;
      gap: 10px;
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .footer-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      font-family: var(--font-sans);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      letter-spacing: 0.01em;
    }

    .btn-primary {
      background: var(--accent);
      color: #050505;
      border-color: var(--accent);
    }

    .btn-primary:hover {
      background: var(--accent-hover);
      border-color: var(--accent-hover);
    }

    .btn-ghost {
      background: transparent;
      color: var(--text-2);
      border-color: var(--border);
    }

    .btn-ghost:hover {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      border-color: var(--border-hover);
    }

    .btn-danger {
      background: transparent;
      color: var(--danger);
      border-color: var(--danger-dim);
    }

    .btn-danger:hover {
      background: var(--danger-dim);
      border-color: rgba(255, 92, 92, 0.3);
    }

    /* ---- Unsaved indicator ---- */
    .unsaved-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulseDot 1.5s ease-in-out infinite;
    }

    @keyframes pulseDot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .unsaved-text {
      font-size: 11px;
      color: var(--text-3);
    }

    /* ---- Responsive ---- */
    @media (max-width: 560px) {
      .overlay {
        padding: 8px;
      }

      .modal {
        max-height: 95vh;
        border-radius: 14px;
      }

      .header {
        padding: 14px 16px 0;
      }

      .tabs {
        padding: 12px 16px 0;
        overflow-x: auto;
      }

      .body {
        padding: 16px;
      }

      .footer {
        padding: 12px 16px;
        flex-direction: column;
      }

      .footer-left,
      .footer-right {
        width: 100%;
        justify-content: center;
      }

      .field-row {
        grid-template-columns: 1fr;
      }

      .provider-segmented {
        flex-direction: column;
      }
    }
  `;

  constructor() {
    super();
    this.isOpen = false;
    this.activeTab = 'general';
    this.languageCode = 'gu-IN';
    this.speaker = 'shubh';
    this.provider = 'groq';
    this.groqModel = 'openai/gpt-oss-20b';
    this.cerebrasModel = 'gpt-oss-120b';
    this.groqTemperature = 0.2;
    this.cerebrasTemperature = 0.2;
    this.groqMaxTokens = 2000;
    this.cerebrasMaxTokens = 2000;
    this.promptId = 'default';
    this.promptContent = 'You are a helpful voice assistant. Respond concisely and naturally.';
    this.greeting = 'Hello! How can I help you today?';
    this.showDebugLogs = false;
    this.useDeployedServer = false;
    this.customServerUrl = 'wss://voice-ind.onrender.com/';
    this.prompts = [];
    this.loadingPrompts = true;
    this.hasUnsavedChanges = false;
    this.savedSnapshot = '';
    this.loadPrompts();
  }

  private async loadPrompts() {
    try {
      const response = await fetch('/api/prompts');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      if (data.prompts) {
        this.prompts = data.prompts;
        const selected = this.prompts.find((p: PromptOption) => p.id === this.promptId);
        if (selected) {
          this.promptContent = selected.content;
        }
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      this.loadingPrompts = false;
    }
  }

  private takeSnapshot(): string {
    return JSON.stringify({
      languageCode: this.languageCode,
      speaker: this.speaker,
      provider: this.provider,
      groqModel: this.groqModel,
      cerebrasModel: this.cerebrasModel,
      groqTemperature: this.groqTemperature,
      cerebrasTemperature: this.cerebrasTemperature,
      groqMaxTokens: this.groqMaxTokens,
      cerebrasMaxTokens: this.cerebrasMaxTokens,
      promptId: this.promptId,
      promptContent: this.promptContent,
      greeting: this.greeting,
      showDebugLogs: this.showDebugLogs,
      useDeployedServer: this.useDeployedServer,
      customServerUrl: this.customServerUrl,
    });
  }

  private checkUnsaved() {
    this.hasUnsavedChanges = this.takeSnapshot() !== this.savedSnapshot;
  }

  private handlePromptChange(event: Event) {
    const selectedId = (event.target as HTMLSelectElement).value;
    const selectedPrompt = this.prompts.find((p: PromptOption) => p.id === selectedId);
    if (!selectedPrompt) return;
    this.promptId = selectedId;
    this.promptContent = selectedPrompt.content;
    this.checkUnsaved();
  }

  private getActiveModel(): string {
    return this.provider === 'cerebras' ? this.cerebrasModel : this.groqModel;
  }

  private getActiveModels(): string[] {
    return this.provider === 'cerebras' ? CEREBRAS_MODELS : GROQ_MODELS;
  }

  private setActiveModel(model: string) {
    if (this.provider === 'cerebras') {
      this.cerebrasModel = model;
    } else {
      this.groqModel = model;
    }
    this.checkUnsaved();
  }

  private getActiveTemperature(): number {
    return this.provider === 'cerebras' ? this.cerebrasTemperature : this.groqTemperature;
  }

  private setActiveTemperature(value: number) {
    if (this.provider === 'cerebras') {
      this.cerebrasTemperature = value;
    } else {
      this.groqTemperature = value;
    }
    this.checkUnsaved();
  }

  private getActiveMaxTokens(): number {
    return this.provider === 'cerebras' ? this.cerebrasMaxTokens : this.groqMaxTokens;
  }

  private setActiveMaxTokens(value: number) {
    if (this.provider === 'cerebras') {
      this.cerebrasMaxTokens = value;
    } else {
      this.groqMaxTokens = value;
    }
    this.checkUnsaved();
  }

  private toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
    return Math.round(this.toBoundedNumber(value, fallback, min, max));
  }

  private handleSave() {
    const settings: AgentSettings = {
      languageCode: this.languageCode as AgentSettings['languageCode'],
      speaker: this.speaker,
      provider: this.provider as AgentSettings['provider'],
      groqModel: this.groqModel.trim() || 'openai/gpt-oss-20b',
      cerebrasModel: this.cerebrasModel.trim() || 'gpt-oss-120b',
      groqTemperature: this.toBoundedNumber(this.groqTemperature, 0.2, 0, 2),
      cerebrasTemperature: this.toBoundedNumber(this.cerebrasTemperature, 0.2, 0, 2),
      groqMaxTokens: this.toBoundedInt(this.groqMaxTokens, 2000, 32, 8192),
      cerebrasMaxTokens: this.toBoundedInt(this.cerebrasMaxTokens, 2000, 32, 8192),
      promptId: this.promptId,
      promptContent: this.promptContent.trim(),
      greeting: this.greeting.trim(),
      showDebugLogs: Boolean(this.showDebugLogs),
      useDeployedServer: Boolean(this.useDeployedServer),
      customServerUrl: this.customServerUrl.trim(),
    };

    this.dispatchEvent(
      new CustomEvent('settings-save', {
        detail: settings,
        bubbles: true,
        composed: true,
      })
    );

    this.savedSnapshot = this.takeSnapshot();
    this.hasUnsavedChanges = false;
    this.close();
  }

  private handleReset() {
    this.languageCode = 'gu-IN';
    this.speaker = 'shubh';
    this.provider = 'groq';
    this.groqModel = 'openai/gpt-oss-20b';
    this.cerebrasModel = 'gpt-oss-120b';
    this.groqTemperature = 0.2;
    this.cerebrasTemperature = 0.2;
    this.groqMaxTokens = 2000;
    this.cerebrasMaxTokens = 2000;
    this.promptId = 'default';
    this.greeting = 'Hello! How can I help you today?';
    this.showDebugLogs = false;
    this.useDeployedServer = false;
    this.customServerUrl = 'wss://voice-ind.onrender.com/';
    const defaultPrompt = this.prompts.find((p: PromptOption) => p.id === 'default');
    if (defaultPrompt) {
      this.promptContent = defaultPrompt.content;
    }
    this.checkUnsaved();
  }

  public open(settings?: AgentSettings) {
    if (settings) {
      this.languageCode = settings.languageCode ?? 'gu-IN';
      this.speaker = settings.speaker ?? 'shubh';
      this.provider = settings.provider ?? 'groq';
      this.groqModel = settings.groqModel ?? 'openai/gpt-oss-20b';
      this.cerebrasModel = settings.cerebrasModel ?? 'gpt-oss-120b';
      this.groqTemperature = settings.groqTemperature ?? 0.2;
      this.cerebrasTemperature = settings.cerebrasTemperature ?? 0.2;
      this.groqMaxTokens = settings.groqMaxTokens ?? 2000;
      this.cerebrasMaxTokens = settings.cerebrasMaxTokens ?? 2000;
      this.promptId = settings.promptId ?? 'default';
      this.promptContent = settings.promptContent ?? this.promptContent;
      this.greeting = settings.greeting ?? 'Hello! How can I help you today?';
      this.showDebugLogs = settings.showDebugLogs ?? false;
      this.useDeployedServer = settings.useDeployedServer ?? false;
      this.customServerUrl = settings.customServerUrl ?? 'wss://voice-ind.onrender.com/';
    }
    this.savedSnapshot = this.takeSnapshot();
    this.hasUnsavedChanges = false;
    this.activeTab = 'general';
    this.isOpen = true;
  }

  public close() {
    this.isOpen = false;
  }

  // ──── TAB: General ────
  private renderGeneralTab() {
    return html`
      <!-- Language & Voice -->
      <div class="section">
        <div class="section-label">Language & Voice</div>

        <div class="field-row">
          <div class="field">
            <label class="field-label">Language</label>
            <select
              .value=${this.languageCode}
              @change=${(e: Event) => {
                this.languageCode = (e.target as HTMLSelectElement).value;
                this.checkUnsaved();
              }}
            >
              ${LANGUAGES.map(
                (lang) => html`<option value=${lang.code}>${lang.name}</option>`
              )}
            </select>
          </div>

          <div class="field">
            <label class="field-label">Voice</label>
            <select
              .value=${this.speaker}
              @change=${(e: Event) => {
                this.speaker = (e.target as HTMLSelectElement).value;
                this.checkUnsaved();
              }}
            >
              ${SPEAKERS.map(
                (s) => html`<option value=${s.id}>${s.name}</option>`
              )}
            </select>
          </div>
        </div>
      </div>

      <!-- Greeting -->
      <div class="section">
        <div class="section-label">Greeting</div>
        <div class="field">
          <label class="field-label">First message sent when a session starts</label>
          <input
            type="text"
            .value=${this.greeting}
            @input=${(e: Event) => {
              this.greeting = (e.target as HTMLInputElement).value;
              this.checkUnsaved();
            }}
            placeholder="Hello! How can I help you today?"
          />
        </div>
      </div>

      <!-- Debug -->
      <div class="section">
        <div class="section-label">Developer</div>
        
        <div class="field" style="margin-bottom: 20px;">
          <div class="toggle-row">
            <div class="toggle-info">
              <p class="toggle-title">Use Deployed Server</p>
              <div class="toggle-desc">Switch from localhost to production voice server</div>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                .checked=${this.useDeployedServer}
                @change=${(e: Event) => {
                  this.useDeployedServer = (e.target as HTMLInputElement).checked;
                  this.checkUnsaved();
                }}
              />
              <span class="switch-track"></span>
            </label>
          </div>
        </div>

        ${this.useDeployedServer ? html`
          <div class="field" style="margin-bottom: 20px;">
            <label class="field-label">Server URL</label>
            <input
              type="text"
              .value=${this.customServerUrl}
              @input=${(e: Event) => {
                this.customServerUrl = (e.target as HTMLInputElement).value;
                this.checkUnsaved();
              }}
              placeholder="wss://..."
            />
            <div class="field-hint">The WebSocket URL of the voice server</div>
          </div>
        ` : nothing}

        <div class="toggle-row">
          <div class="toggle-info">
            <p class="toggle-title">Debug Logs</p>
            <div class="toggle-desc">Show live event log panel and detailed browser console output</div>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              .checked=${this.showDebugLogs}
              @change=${(e: Event) => {
                this.showDebugLogs = (e.target as HTMLInputElement).checked;
                this.checkUnsaved();
              }}
            />
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
    `;
  }

  // ──── TAB: Model ────
  private renderModelTab() {
    return html`
      <!-- Provider picker -->
      <div class="section">
        <div class="section-label">Provider</div>
        <div class="provider-segmented">
          <button
            class="provider-option"
            ?data-active=${this.provider === 'groq'}
            @click=${() => { this.provider = 'groq'; this.checkUnsaved(); }}
          >Groq</button>
          <button
            class="provider-option"
            ?data-active=${this.provider === 'cerebras'}
            @click=${() => { this.provider = 'cerebras'; this.checkUnsaved(); }}
          >Cerebras</button>
        </div>
      </div>

      <!-- Active model config (shows only active provider) -->
      <div class="section">
        <div class="section-label">
          ${this.provider === 'groq' ? 'Groq' : 'Cerebras'} Configuration
        </div>

        <div class="field">
          <label class="field-label">Model</label>
          <input
            type="text"
            list="${this.provider}-models"
            .value=${this.getActiveModel()}
            @input=${(e: Event) => {
              this.setActiveModel((e.target as HTMLInputElement).value);
            }}
            placeholder="Enter or select a model ID"
          />
          <div class="field-hint">Select from the list or type a custom model ID.</div>
        </div>

        <div class="field-row">
          <div class="field">
            <label class="field-label">Temperature</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="2"
              .value=${String(this.getActiveTemperature())}
              @input=${(e: Event) => {
                const val = this.toBoundedNumber(
                  (e.target as HTMLInputElement).value,
                  this.getActiveTemperature(),
                  0, 2
                );
                this.setActiveTemperature(val);
              }}
            />
            <div class="field-hint">0 = deterministic, 2 = most creative</div>
          </div>
          <div class="field">
            <label class="field-label">Max Tokens</label>
            <input
              type="number"
              step="1"
              min="32"
              max="8192"
              .value=${String(this.getActiveMaxTokens())}
              @input=${(e: Event) => {
                const val = this.toBoundedInt(
                  (e.target as HTMLInputElement).value,
                  this.getActiveMaxTokens(),
                  32, 8192
                );
                this.setActiveMaxTokens(val);
              }}
            />
            <div class="field-hint">Maximum response length (32 - 8192)</div>
          </div>
        </div>
      </div>

      <datalist id="groq-models">
        ${GROQ_MODELS.map((m) => html`<option value=${m}></option>`)}
      </datalist>
      <datalist id="cerebras-models">
        ${CEREBRAS_MODELS.map((m) => html`<option value=${m}></option>`)}
      </datalist>
    `;
  }

  // ──── TAB: Prompt ────
  private renderPromptTab() {
    return html`
      <div class="section">
        <div class="section-label">Prompt Template</div>
        <div class="field">
          <label class="field-label">Base template</label>
          <select
            .value=${this.promptId}
            @change=${(e: Event) => this.handlePromptChange(e)}
            ?disabled=${this.loadingPrompts}
          >
            ${this.prompts.map(
              (p: PromptOption) =>
                html`<option value=${p.id}>${p.title}</option>`
            )}
          </select>
          <div class="field-hint">Choose a preset, then customise below.</div>
        </div>
      </div>

      <div class="section">
        <div class="section-label">System Prompt</div>
        <div class="field">
          <textarea
            .value=${this.promptContent}
            @input=${(e: Event) => {
              this.promptContent = (e.target as HTMLTextAreaElement).value;
              this.checkUnsaved();
            }}
            placeholder="Describe how the voice agent should behave..."
          ></textarea>
          <div class="char-count">${this.promptContent.length} chars</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div
        class="overlay"
        ?open=${this.isOpen}
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div class="modal" @click=${(e: MouseEvent) => e.stopPropagation()}>
          <!-- Header -->
          <div class="header">
            <h2>Settings</h2>
            <button class="close-btn" @click=${() => this.close()} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- Tabs -->
          <div class="tabs">
            <button
              class="tab"
              ?data-active=${this.activeTab === 'general'}
              @click=${() => { this.activeTab = 'general'; }}
            >General</button>
            <button
              class="tab"
              ?data-active=${this.activeTab === 'model'}
              @click=${() => { this.activeTab = 'model'; }}
            >Model</button>
            <button
              class="tab"
              ?data-active=${this.activeTab === 'prompt'}
              @click=${() => { this.activeTab = 'prompt'; }}
            >Prompt</button>
          </div>

          <!-- Body -->
          <div class="body">
            ${this.activeTab === 'general' ? this.renderGeneralTab() : nothing}
            ${this.activeTab === 'model' ? this.renderModelTab() : nothing}
            ${this.activeTab === 'prompt' ? this.renderPromptTab() : nothing}
          </div>

          <!-- Footer -->
          <div class="footer">
            <div class="footer-left">
              ${this.hasUnsavedChanges ? html`
                <span class="unsaved-dot"></span>
                <span class="unsaved-text">Unsaved changes</span>
              ` : nothing}
            </div>
            <div class="footer-right">
              <button class="btn btn-danger" @click=${() => this.handleReset()}>Reset</button>
              <button class="btn btn-ghost" @click=${() => this.close()}>Cancel</button>
              <button class="btn btn-primary" @click=${() => this.handleSave()}>Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-settings-modal': GdmSettingsModal;
  }
}
