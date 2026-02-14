import { LitElement, css, html } from 'lit';
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

@customElement('gdm-settings-modal')
export class GdmSettingsModal extends LitElement {
  @property({ type: Boolean }) declare isOpen: boolean;

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
  @state() declare prompts: PromptOption[];
  @state() declare loadingPrompts: boolean;
  @state() declare advancedOpen: boolean;

  static styles = css`
    :host {
      --panel-bg: rgba(8, 12, 18, 0.97);
      --panel-border: rgba(148, 176, 201, 0.24);
      --field-bg: rgba(255, 255, 255, 0.06);
      --field-border: rgba(176, 202, 221, 0.28);
      --text-main: #f1f7fd;
      --text-subtle: #9fb4c6;
      --accent: #31d7a5;
      --accent-hover: #64e4bb;
      --danger: #ff7a7a;
      font-family: 'Avenir Next', 'Trebuchet MS', 'Segoe UI', sans-serif;
    }

    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 999;
      background:
        radial-gradient(circle at 20% 15%, rgba(49, 215, 165, 0.2), transparent 38%),
        radial-gradient(circle at 85% 80%, rgba(78, 151, 255, 0.15), transparent 34%),
        rgba(0, 0, 0, 0.72);
      padding: 20px;
      box-sizing: border-box;
    }

    .modal-overlay[open] {
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-content {
      width: min(880px, 96vw);
      max-height: min(92vh, 980px);
      overflow: auto;
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 18px;
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.62);
      padding: 22px;
      color: var(--text-main);
      animation: slideUp 0.28s ease-out;
    }

    @keyframes slideUp {
      from {
        transform: translateY(14px) scale(0.99);
        opacity: 0;
      }
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .title-wrap h2 {
      margin: 0 0 4px;
      font-size: 24px;
      line-height: 1.15;
      letter-spacing: 0.2px;
    }

    .title-wrap p {
      margin: 0;
      color: var(--text-subtle);
      font-size: 13px;
      line-height: 1.45;
      max-width: 540px;
    }

    .close-btn {
      border: 1px solid var(--field-border);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-main);
      border-radius: 10px;
      width: 38px;
      height: 38px;
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
    }

    .close-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .quick-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 16px;
    }

    .card {
      border: 1px solid var(--panel-border);
      border-radius: 14px;
      padding: 14px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
        rgba(12, 18, 25, 0.92);
    }

    .card h3 {
      margin: 0 0 4px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.9px;
      color: var(--accent);
    }

    .card .section-note {
      margin: 0 0 14px;
      font-size: 12px;
      color: var(--text-subtle);
    }

    .form-group {
      margin-bottom: 11px;
    }

    .form-group:last-child {
      margin-bottom: 0;
    }

    label {
      display: block;
      margin: 0 0 6px;
      font-size: 12px;
      letter-spacing: 0.35px;
      text-transform: uppercase;
      color: var(--text-subtle);
      font-weight: 650;
    }

    .description {
      margin-top: 6px;
      color: var(--text-subtle);
      font-size: 11px;
      line-height: 1.35;
    }

    input,
    select,
    textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: 10px;
      border: 1px solid var(--field-border);
      background: var(--field-bg);
      color: var(--text-main);
      font-size: 14px;
      font-family: 'Consolas', 'SFMono-Regular', 'Liberation Mono', monospace;
      padding: 10px 12px;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    textarea {
      min-height: 110px;
      resize: vertical;
      line-height: 1.5;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(49, 215, 165, 0.16);
    }

    select option {
      background: #101820;
      color: #eaf3fb;
    }

    .active-route {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(49, 215, 165, 0.12);
      border: 1px solid rgba(49, 215, 165, 0.3);
      font-size: 12px;
      color: #c4fae8;
    }

    .advanced {
      margin-top: 14px;
      border: 1px solid var(--panel-border);
      border-radius: 14px;
      overflow: hidden;
      background: rgba(7, 12, 18, 0.75);
    }

    .advanced summary {
      cursor: pointer;
      list-style: none;
      user-select: none;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--text-main);
      background: linear-gradient(90deg, rgba(49, 215, 165, 0.1), rgba(49, 215, 165, 0.01));
    }

    .advanced summary::-webkit-details-marker {
      display: none;
    }

    .advanced .badge {
      color: var(--text-subtle);
      font-size: 11px;
      font-weight: 600;
      text-transform: none;
      letter-spacing: normal;
    }

    .advanced-body {
      padding: 14px;
      display: grid;
      gap: 14px;
      grid-template-columns: 1fr 1fr;
      border-top: 1px solid var(--panel-border);
    }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .provider-block {
      border: 1px solid var(--field-border);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
      margin-bottom: 10px;
    }

    .provider-block h4 {
      margin: 0 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: var(--accent);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border: 1px solid var(--field-border);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
    }

    .toggle-title {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: var(--text-main);
    }

    .toggle-description {
      margin-top: 4px;
      color: var(--text-subtle);
      font-size: 11px;
      line-height: 1.35;
    }

    .toggle-switch {
      accent-color: var(--accent);
      width: 18px;
      height: 18px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .preview {
      margin-top: 8px;
      border-radius: 10px;
      border: 1px solid var(--field-border);
      background: rgba(0, 0, 0, 0.22);
      padding: 10px;
      font-size: 12px;
      color: #d7e8f5;
      line-height: 1.45;
      max-height: 130px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .char-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-subtle);
    }

    .footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--panel-border);
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .btn {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.35px;
      transition: transform 0.15s ease, background 0.2s ease, border-color 0.2s ease;
    }

    .btn:hover {
      transform: translateY(-1px);
    }

    .btn-primary {
      background: var(--accent);
      color: #052117;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.09);
      color: var(--text-main);
      border-color: var(--field-border);
    }

    .btn-reset {
      background: rgba(255, 122, 122, 0.12);
      border-color: rgba(255, 122, 122, 0.4);
      color: #ffc8c8;
    }

    .btn-reset:hover {
      background: rgba(255, 122, 122, 0.18);
    }

    @media (max-width: 840px) {
      .quick-grid,
      .advanced-body {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .modal-overlay {
        padding: 10px;
      }

      .modal-content {
        padding: 14px;
      }

      .two-col {
        grid-template-columns: 1fr;
      }

      .footer {
        flex-direction: column;
      }
    }
  `;

  constructor() {
    super();
    this.isOpen = false;
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
    this.prompts = [];
    this.loadingPrompts = true;
    this.advancedOpen = false;
    this.loadPrompts();
  }

  private async loadPrompts() {
    try {
      const response = await fetch('/api/prompts');
      const data = await response.json();
      if (data.prompts) {
        this.prompts = data.prompts;
        const selected = this.prompts.find((p: PromptOption) => p.id === this.promptId);
        if (selected && !this.promptContent) {
          this.promptContent = selected.content;
        }
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      this.loadingPrompts = false;
    }
  }

  private handlePromptChange(event: Event) {
    const selectedId = (event.target as HTMLSelectElement).value;
    const selectedPrompt = this.prompts.find((p: PromptOption) => p.id === selectedId);
    if (!selectedPrompt) return;
    this.promptId = selectedId;
    this.promptContent = selectedPrompt.content;
  }

  private getActiveModel(): string {
    return this.provider === 'cerebras' ? this.cerebrasModel : this.groqModel;
  }

  private setActiveModel(model: string) {
    if (this.provider === 'cerebras') {
      this.cerebrasModel = model;
      return;
    }
    this.groqModel = model;
  }

  private toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
    const normalized = this.toBoundedNumber(value, fallback, min, max);
    return Math.round(normalized);
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
    };

    this.dispatchEvent(
      new CustomEvent('settings-save', {
        detail: settings,
        bubbles: true,
        composed: true,
      })
    );

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
    const defaultPrompt = this.prompts.find((p: PromptOption) => p.id === 'default');
    if (defaultPrompt) {
      this.promptContent = defaultPrompt.content;
    }
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
    }
    this.isOpen = true;
  }

  public close() {
    this.isOpen = false;
  }

  render() {
    return html`
      <div
        class="modal-overlay"
        ?open=${this.isOpen}
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div class="modal-content" @click=${(e: MouseEvent) => e.stopPropagation()}>
          <div class="header">
            <div class="title-wrap">
              <h2>Voice Agent Settings</h2>
              <p>
                Core controls are on top for quick use. Additional prompt and tuning options are in
                <strong>Advanced</strong>.
              </p>
            </div>
            <button class="close-btn" @click=${() => this.close()} aria-label="Close settings">
              ×
            </button>
          </div>

          <div class="quick-grid">
            <div class="card">
              <h3>Language and Voice</h3>
              <p class="section-note">Practical defaults for everyday conversations.</p>

              <div class="form-group">
                <label for="language">Language</label>
                <select
                  id="language"
                  .value=${this.languageCode}
                  @change=${(e: Event) => {
                    this.languageCode = (e.target as HTMLSelectElement).value;
                  }}
                >
                  ${LANGUAGES.map(
                    (lang) => html`<option value=${lang.code}>${lang.name}</option>`
                  )}
                </select>
                <div class="description">
                  ${this.languageCode === 'gu-IN'
                    ? 'Input and spoken response language are Gujarati.'
                    : 'Input and spoken response language follow this selection.'}
                </div>
              </div>

              <div class="form-group">
                <label for="speaker">Voice</label>
                <select
                  id="speaker"
                  .value=${this.speaker}
                  @change=${(e: Event) => {
                    this.speaker = (e.target as HTMLSelectElement).value;
                  }}
                >
                  ${SPEAKERS.map(
                    (speaker) => html`<option value=${speaker.id}>${speaker.name}</option>`
                  )}
                </select>
              </div>
            </div>

            <div class="card">
              <h3>Model Routing</h3>
              <p class="section-note">Choose provider and live model used for next responses.</p>

              <div class="form-group">
                <label for="provider">Provider</label>
                <select
                  id="provider"
                  .value=${this.provider}
                  @change=${(e: Event) => {
                    this.provider = (e.target as HTMLSelectElement).value;
                  }}
                >
                  <option value="groq">Groq</option>
                  <option value="cerebras">Cerebras</option>
                </select>
              </div>

              <div class="form-group">
                <label for="active-model">Active Model ID</label>
                <input
                  id="active-model"
                  list=${this.provider === 'cerebras' ? 'cerebras-model-list' : 'groq-model-list'}
                  .value=${this.getActiveModel()}
                  @input=${(e: Event) => {
                    this.setActiveModel((e.target as HTMLInputElement).value);
                  }}
                  placeholder="Enter model id"
                />
                <div class="description">You can type custom model IDs manually.</div>
              </div>

              <div class="active-route">
                Active route: <strong>${this.provider}</strong> -> <strong>${this.getActiveModel()}</strong>
              </div>
            </div>
          </div>

          <details
            class="advanced"
            ?open=${this.advancedOpen}
            @toggle=${(e: Event) => {
              this.advancedOpen = (e.currentTarget as HTMLDetailsElement).open;
            }}
          >
            <summary>
              <span>Advanced</span>
              <span class="badge">Prompt tuning, greeting, provider-specific controls</span>
            </summary>

            <div class="advanced-body">
              <div class="card">
                <h3>Behavior and Prompt</h3>
                <p class="section-note">
                  These are optional and can stay at defaults unless you need custom behavior.
                </p>

                <div class="form-group">
                  <label for="prompt-select">Prompt Template</label>
                  <select
                    id="prompt-select"
                    .value=${this.promptId}
                    @change=${(e: Event) => this.handlePromptChange(e)}
                    ?disabled=${this.loadingPrompts}
                  >
                    ${this.prompts.map(
                      (prompt: PromptOption) =>
                        html`<option value=${prompt.id}>${prompt.title}</option>`
                    )}
                  </select>
                  <div class="description">Start from a preset, then customize if needed.</div>
                </div>

                <div class="form-group">
                  <label for="prompt-content">System Prompt Content</label>
                  <textarea
                    id="prompt-content"
                    .value=${this.promptContent}
                    @input=${(e: Event) => {
                      this.promptContent = (e.target as HTMLTextAreaElement).value;
                    }}
                  ></textarea>
                  <div class="char-row">
                    <span>Used as system prompt</span>
                    <span>${this.promptContent.length} chars</span>
                  </div>
                </div>

                ${this.promptContent
                  ? html`
                      <div class="preview">${this.promptContent}</div>
                    `
                  : ''}
              </div>

              <div class="card">
                <h3>Provider Fine-Tuning</h3>
                <p class="section-note">Tune each provider profile once, then switch instantly.</p>

                <div class="form-group">
                  <label for="greeting">Greeting Message</label>
                  <input
                    id="greeting"
                    type="text"
                    .value=${this.greeting}
                    @input=${(e: Event) => {
                      this.greeting = (e.target as HTMLInputElement).value;
                    }}
                    placeholder="Hello! How can I help you today?"
                  />
                </div>

                <div class="form-group">
                  <div class="toggle-row">
                    <div>
                      <p class="toggle-title">Frontend Debug Logs</p>
                      <div class="toggle-description">
                        Show detailed browser console logs and the live debug panel.
                      </div>
                    </div>
                    <input
                      id="show-debug-logs"
                      class="toggle-switch"
                      type="checkbox"
                      .checked=${this.showDebugLogs}
                      @change=${(e: Event) => {
                        this.showDebugLogs = (e.target as HTMLInputElement).checked;
                      }}
                    />
                  </div>
                </div>

                <div class="provider-block">
                  <h4>Groq Profile</h4>
                  <div class="form-group">
                    <label for="groq-model">Groq Model ID</label>
                    <input
                      id="groq-model"
                      list="groq-model-list"
                      .value=${this.groqModel}
                      @input=${(e: Event) => {
                        this.groqModel = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div class="two-col">
                    <div class="form-group">
                      <label for="groq-temp">Temperature</label>
                      <input
                        id="groq-temp"
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        .value=${String(this.groqTemperature)}
                        @input=${(e: Event) => {
                          this.groqTemperature = this.toBoundedNumber(
                            (e.target as HTMLInputElement).value,
                            this.groqTemperature,
                            0,
                            2
                          );
                        }}
                      />
                    </div>
                    <div class="form-group">
                      <label for="groq-tokens">Max Tokens</label>
                      <input
                        id="groq-tokens"
                        type="number"
                        step="1"
                        min="32"
                        max="8192"
                        .value=${String(this.groqMaxTokens)}
                        @input=${(e: Event) => {
                          this.groqMaxTokens = this.toBoundedInt(
                            (e.target as HTMLInputElement).value,
                            this.groqMaxTokens,
                            32,
                            8192
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div class="provider-block">
                  <h4>Cerebras Profile</h4>
                  <div class="form-group">
                    <label for="cerebras-model">Cerebras Model ID</label>
                    <input
                      id="cerebras-model"
                      list="cerebras-model-list"
                      .value=${this.cerebrasModel}
                      @input=${(e: Event) => {
                        this.cerebrasModel = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div class="two-col">
                    <div class="form-group">
                      <label for="cerebras-temp">Temperature</label>
                      <input
                        id="cerebras-temp"
                        type="number"
                        step="0.05"
                        min="0"
                        max="2"
                        .value=${String(this.cerebrasTemperature)}
                        @input=${(e: Event) => {
                          this.cerebrasTemperature = this.toBoundedNumber(
                            (e.target as HTMLInputElement).value,
                            this.cerebrasTemperature,
                            0,
                            2
                          );
                        }}
                      />
                    </div>
                    <div class="form-group">
                      <label for="cerebras-tokens">Max Tokens</label>
                      <input
                        id="cerebras-tokens"
                        type="number"
                        step="1"
                        min="32"
                        max="8192"
                        .value=${String(this.cerebrasMaxTokens)}
                        @input=${(e: Event) => {
                          this.cerebrasMaxTokens = this.toBoundedInt(
                            (e.target as HTMLInputElement).value,
                            this.cerebrasMaxTokens,
                            32,
                            8192
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </details>

          <div class="footer">
            <button class="btn btn-reset" @click=${() => this.handleReset()}>Reset Defaults</button>
            <button class="btn btn-secondary" @click=${() => this.close()}>Cancel</button>
            <button class="btn btn-primary" @click=${() => this.handleSave()}>Save Settings</button>
          </div>
        </div>
      </div>

      <datalist id="groq-model-list">
        ${GROQ_MODELS.map((model) => html`<option value=${model}></option>`)}
      </datalist>
      <datalist id="cerebras-model-list">
        ${CEREBRAS_MODELS.map((model) => html`<option value=${model}></option>`)}
      </datalist>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-settings-modal': GdmSettingsModal;
  }
}
