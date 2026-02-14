import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './visual-3d';
import './settings';
import type { AgentSettings } from './settings';

// Voice server URL configuration
// Priority: window.VOICE_SERVER_URL (runtime) > env var (build time) > default
declare global {
  interface Window {
    VOICE_SERVER_URL?: string;
  }
}

// Get URL at runtime (not at module load time)
const getVoiceServerUrl = (): string => {
  if (typeof window !== 'undefined') {
    // Runtime config from config.js
    if (window.VOICE_SERVER_URL) {
      return window.VOICE_SERVER_URL;
    }
    // Auto-detect localhost
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
      return 'ws://localhost:8081/';
    }
  }
  // Build-time env var
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_VOICE_SERVER_URL) {
    return process.env.NEXT_PUBLIC_VOICE_SERVER_URL;
  }
  // Production fallback
  return 'wss://voice-ind.onrender.com/';
};

interface ReadyMessage {
  sessionId: string;
  provider: string;
  sttLanguage: string;
  ttsLanguage?: string;
  startedAtMs: number;
}

interface TranscriptMessage {
  transcript: string;
  isFinal: boolean;
  segmentIndex: number | null;
  speechActive: boolean;
}

interface AudioMessage {
  audio: string;
  segmentIndex: number;
  requestId: number;
}

interface VadMessage {
  vadSignal: 'START_SPEECH' | 'END_SPEECH';
  segmentIndex: number;
  durationMs?: number;
  startedAtMs?: number;
  endedAtMs?: number;
}

interface MetricsMessage {
  type: string;
  requestId?: number;
  provider?: string;
  reason?: string;
  [key: string]: unknown;
}

interface ErrorMessage {
  error: string;
}

type IncomingMessage = 
  | { type: 'ready'; data: ReadyMessage }
  | { type: 'transcript'; data: TranscriptMessage }
  | { type: 'audio'; data: AudioMessage }
  | { type: 'vad'; data: VadMessage }
  | { type: 'metrics'; data: MetricsMessage }
  | { type: 'error'; data: ErrorMessage };

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() declare isRecording: boolean;
  @state() declare status: string;
  @state() declare error: string;

  @state() declare ccChunks: string[];
  @state() declare ccCurrentIndex: number;
  @state() declare ccVisible: boolean;
  @state() declare ccExiting: boolean;
  @state() declare debugEvents: string[];

  private ccTimeouts: ReturnType<typeof setTimeout>[] = [];
  private ccSequenceComplete: boolean = false;
  private outboundAudioPackets = 0;
  private inboundAudioPackets = 0;

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 2000;
  
  private inputAudioContext!: AudioContext;
  private outputAudioContext!: AudioContext;
  @state() declare inputNode: GainNode;
  @state() declare outputNode: GainNode;
  
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private audioQueue: Uint8Array[] = [];
  private isUserSpeaking = false;
  private isConnecting = false;
  private activeRequestId: number | null = null;
  private droppedRequestIds = new Set<number>();

  @state() declare currentSettings: AgentSettings;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh;
      background: #050505;
      margin: 0;
      padding: 0;
      font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    /* ---- Status bar ---- */
    #status {
      position: absolute;
      bottom: 4.5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      font-size: 12px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.35);
      letter-spacing: 0.03em;
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
    }

    /* ---- Controls ---- */
    .controls {
      z-index: 10;
      position: absolute;
      bottom: 9vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }

    .controls button {
      outline: none;
      border: none;
      color: rgba(255, 255, 255, 0.85);
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      cursor: pointer;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .controls button:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.16);
      transform: scale(1.05);
    }

    .controls button:active {
      transform: scale(0.97);
    }

    .controls button[disabled] {
      display: none;
    }

    .controls .mic-btn {
      width: 64px;
      height: 64px;
      background: transparent;
      border: none;
      color: #ffffff;
      border-radius: 12px;
      box-shadow: none;
    }

    .controls .mic-btn:hover {
      transform: scale(1.1);
      color: #ffffff;
    }

    .controls .stop-btn {
      width: 64px;
      height: 64px;
      background: rgba(255, 92, 92, 0.1);
      border-color: rgba(255, 92, 92, 0.2);
      color: #ff5c5c;
    }

    .controls .stop-btn:hover {
      background: rgba(255, 92, 92, 0.16);
      border-color: rgba(255, 92, 92, 0.3);
      box-shadow: 0 0 24px rgba(255, 92, 92, 0.1);
    }

    /* ---- Captions ---- */
    .cc-container {
      position: absolute;
      bottom: 20vh;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      width: 88%;
      max-width: 640px;
      text-align: center;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 48px;
    }

    .cc-text {
      display: inline-block;
      background: rgba(5, 5, 5, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: rgba(255, 255, 255, 0.9);
      padding: 12px 22px;
      border-radius: 12px;
      font-size: clamp(14px, 2.2vw, 17px);
      font-weight: 400;
      line-height: 1.55;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      text-align: center;
      max-width: 100%;
      letter-spacing: 0.01em;
    }

    .cc-text.entering {
      animation: ccIn 0.18s ease-out forwards;
    }

    .cc-text.exiting {
      animation: ccOut 0.14s ease-in forwards;
    }

    .cc-text.hidden {
      display: none;
    }

    @keyframes ccIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes ccOut {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-8px);
      }
    }

    /* ---- Settings button ---- */
    .settings-btn {
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 100;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.4);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      padding: 0;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .settings-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.7);
    }

    /* ---- Debug panel ---- */
    .debug-panel {
      position: absolute;
      top: 72px;
      right: 20px;
      width: min(400px, calc(100vw - 40px));
      max-height: 40vh;
      overflow: auto;
      z-index: 30;
      border-radius: 12px;
      border: 1px solid rgba(0, 224, 158, 0.15);
      background: rgba(5, 5, 5, 0.88);
      color: rgba(200, 240, 225, 0.85);
      padding: 12px;
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 11px;
      line-height: 1.45;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .debug-panel::-webkit-scrollbar {
      width: 4px;
    }

    .debug-panel::-webkit-scrollbar-thumb {
      background: rgba(0, 224, 158, 0.15);
      border-radius: 2px;
    }

    .debug-title {
      font-weight: 600;
      font-size: 10px;
      color: rgba(0, 224, 158, 0.6);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .debug-line {
      white-space: pre-wrap;
      word-break: break-word;
      padding: 2px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      color: rgba(200, 240, 225, 0.65);
    }
  `;

  constructor() {
    super();
    this.isRecording = false;
    this.status = '';
    this.error = '';
    this.ccChunks = [];
    this.ccCurrentIndex = -1;
    this.ccVisible = false;
    this.ccExiting = false;
    this.debugEvents = [];
    
    this.inputAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 24000 });
    this.inputNode = this.inputAudioContext.createGain();
    this.outputNode = this.outputAudioContext.createGain();
    
    this.currentSettings = {
      languageCode: 'gu-IN',
      speaker: 'shubh',
      provider: 'groq',
      groqModel: 'openai/gpt-oss-20b',
      cerebrasModel: 'gpt-oss-120b',
      groqTemperature: 0.2,
      cerebrasTemperature: 0.2,
      groqMaxTokens: 2000,
      cerebrasMaxTokens: 2000,
      promptId: 'default',
      promptContent: 'You are a helpful voice assistant. Respond concisely and naturally.',
      greeting: 'Hello! How can I help you today?',
      showDebugLogs: false,
      useDeployedServer: false,
      customServerUrl: 'wss://voice-ind.onrender.com/',
    };
  }

  private shouldLogDebug(): boolean {
    return process.env.NODE_ENV === 'development' && Boolean(this.currentSettings.showDebugLogs);
  }

  private infoLog(...args: unknown[]) {
    if (!this.shouldLogDebug()) return;
    console.log(...args);
  }

  private warnLog(...args: unknown[]) {
    if (!this.shouldLogDebug()) return;
    console.warn(...args);
  }

  private errorLog(...args: unknown[]) {
    console.error(...args);
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.outputNode.connect(this.outputAudioContext.destination);
  }

  private resolveTtsLanguage(sttLanguage: string): string {
    const normalized = String(sttLanguage || '').trim().toLowerCase();
    if (normalized === 'gu' || normalized === 'gu-in') return 'gu-IN';
    if (normalized === 'en' || normalized === 'en-in') return 'en-IN';
    if (normalized === 'hi' || normalized === 'hi-in') return 'hi-IN';
    return 'gu-IN';
  }

  private splitTextIntoChunks(text: string): string[] {
    const sentenceRegex = /[^.!?]*[.!?]+/g;
    const sentences: string[] = [];
    let match;

    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(match[0].trim());
    }

    if (sentences.length === 0 && text.trim()) {
      sentences.push(text.trim());
    }

    const chunks: string[] = [];
    const MAX_WORDS = 20;

    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      if (words.length <= MAX_WORDS) {
        chunks.push(sentence);
      } else {
        for (let i = 0; i < words.length; i += MAX_WORDS) {
          chunks.push(words.slice(i, i + MAX_WORDS).join(' '));
        }
      }
    }

    return chunks.filter(c => c.trim().length > 0);
  }

  private calculateChunkDurations(chunks: string[]): number[] {
    const MS_PER_CHAR = 40;
    const MIN_DURATION = 750;
    return chunks.map(chunk => Math.max(MIN_DURATION, chunk.length * MS_PER_CHAR));
  }

  private clearCCTimeouts() {
    this.ccTimeouts.forEach(timeout => { clearTimeout(timeout); });
    this.ccTimeouts = [];
  }

  private resetCC() {
    this.clearCCTimeouts();
    this.ccChunks = [];
    this.ccCurrentIndex = -1;
    this.ccVisible = false;
    this.ccExiting = false;
    this.ccSequenceComplete = false;
  }

  private startCCSequence(text: string) {
    this.clearCCTimeouts();
    this.ccChunks = this.splitTextIntoChunks(text);
    
    if (this.ccChunks.length === 0) return;

    const durations = this.calculateChunkDurations(this.ccChunks);
    this.ccCurrentIndex = 0;
    this.ccVisible = true;
    this.ccExiting = false;
    this.ccSequenceComplete = false;

    const TRANSITION_TIME = 130;
    let time = 0;

    for (let i = 0; i < this.ccChunks.length; i++) {
      const chunkIndex = i;
      const duration = durations[i];

      if (i > 0) {
        const showTimeout = setTimeout(() => {
          this.ccExiting = false;
          this.ccCurrentIndex = chunkIndex;
        }, time);
        this.ccTimeouts.push(showTimeout);
      }

      time += duration;

      if (i < this.ccChunks.length - 1) {
        const exitTimeout = setTimeout(() => {
          this.ccExiting = true;
        }, time);
        this.ccTimeouts.push(exitTimeout);
        time += TRANSITION_TIME;
      }
    }

    const completeTimeout = setTimeout(() => {
      this.ccSequenceComplete = true;
    }, time);
    this.ccTimeouts.push(completeTimeout);
  }

  private hideCCAfterDelay(delay: number = 1000) {
    const timeout = setTimeout(() => {
      if (!this.ccSequenceComplete && this.ccVisible) {
        this.hideCCAfterDelay(500);
        return;
      }
      if (!this.ccVisible) return;
      this.ccExiting = true;
      const hideTimeout = setTimeout(() => {
        this.ccVisible = false;
        this.ccExiting = false;
      }, 150);
      this.ccTimeouts.push(hideTimeout);
    }, delay);
    this.ccTimeouts.push(timeout);
  }

  private async connectWebSocket(): Promise<void> {
    if (this.isConnecting) {
      this.infoLog('[VoiceAI] Already connecting, waiting...');
      return new Promise((resolve, reject) => {
        const maxWaitMs = 10000;
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          if (!this.isConnecting && this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            resolve();
          } else if (!this.isConnecting && this.ws?.readyState !== WebSocket.OPEN) {
            clearInterval(checkInterval);
            reject(new Error('Connection failed while waiting'));
          } else if (elapsed >= maxWaitMs) {
            clearInterval(checkInterval);
            reject(new Error('Connection wait timeout'));
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        let serverUrl = '';
        if (this.currentSettings.useDeployedServer && this.currentSettings.customServerUrl) {
          serverUrl = this.currentSettings.customServerUrl;
        } else {
          serverUrl = getVoiceServerUrl();
        }
        
        this.infoLog(`[VoiceAI] Connecting to ${serverUrl}...`);
        this.debugLog('ws_connect_attempt', { serverUrl });
        this.ws = new WebSocket(serverUrl);

        const connectionTimeout = setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.errorLog('[VoiceAI] Connection timeout');
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.infoLog('[VoiceAI] WebSocket connected');
          this.debugLog('ws_open');
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.updateStatus('Connected to voice server...');
          resolve();
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.infoLog(`[VoiceAI] WebSocket closed (code: ${event.code}, reason: ${event.reason})`);
          this.debugLog('ws_close', { code: event.code, reason: event.reason });
          this.isConnecting = false;
          this.sessionId = null;
          
          // Attempt reconnection if not intentional close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.updateStatus(`Connection lost. Reconnecting... (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
              this.reconnectAttempts++;
              this.connectWebSocket().catch((err) => {
                this.errorLog('[VoiceAI] Reconnect failed:', err);
              });
            }, this.reconnectDelay);
          }
        };

        this.ws.onerror = (event) => {
          clearTimeout(connectionTimeout);
          this.errorLog('[VoiceAI] WebSocket error:', event);
          this.debugLog('ws_error', String((event as unknown as { type?: string })?.type || 'unknown'));
          this.isConnecting = false;
          this.updateError('Connection error. Please check if the server is running.');
          reject(new Error('WebSocket error'));
        };

        this.ws.onmessage = (event) => {
          try {
            if (typeof event.data !== 'string') {
              this.warnLog('[VoiceAI] Ignoring non-text websocket message');
              this.debugLog('ws_message_non_text');
              return;
            }
            const message: IncomingMessage = JSON.parse(event.data);
            this.debugLog('ws_message_in', {
              type: (message as { type?: string }).type || 'unknown',
              bytes: event.data.length,
            });
            this.handleMessage(message);
          } catch (err) {
            this.errorLog('[VoiceAI] Failed to parse message:', err);
            this.debugLog('ws_message_parse_error', String((err as Error)?.message || err));
          }
        };
      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  private handleMessage(message: IncomingMessage) {
    switch (message.type) {
      case 'ready':
        this.handleReady(message.data);
        break;
      case 'transcript':
        this.handleTranscript(message.data);
        break;
      case 'audio':
        this.handleAudio(message.data);
        break;
      case 'vad':
        this.handleVad(message.data);
        break;
      case 'metrics':
        this.handleMetrics(message.data);
        break;
      case 'error':
        this.updateError(message.data.error);
        break;
      default:
        this.warnLog('[VoiceAI] Unknown message type:', (message as { type: string }).type);
    }
  }

  private handleReady(data: ReadyMessage) {
    this.sessionId = data.sessionId;
    this.infoLog(`[VoiceAI] Session ready: ${data.sessionId}`);
    this.infoLog(`  Provider: ${data.provider}`);
    this.infoLog(`  Language: ${data.sttLanguage}`);
    if (data.ttsLanguage) {
      this.infoLog(`  TTS Language: ${data.ttsLanguage}`);
      this.debugLog('ready_tts_language', data.ttsLanguage);
    }
    
    this.updateStatus('Ready! Click the mic to start.');

    this.sendConfig({
      language: this.currentSettings.languageCode,
      ttsLanguage: this.resolveTtsLanguage(this.currentSettings.languageCode),
      speaker: this.currentSettings.speaker,
      provider: this.currentSettings.provider,
      groqModel: this.currentSettings.groqModel,
      cerebrasModel: this.currentSettings.cerebrasModel,
      groqTemperature: this.currentSettings.groqTemperature,
      cerebrasTemperature: this.currentSettings.cerebrasTemperature,
      groqMaxTokens: this.currentSettings.groqMaxTokens,
      cerebrasMaxTokens: this.currentSettings.cerebrasMaxTokens,
      systemPrompt: this.currentSettings.promptContent,
      greeting: this.currentSettings.greeting,
    });
  }

  private handleTranscript(data: TranscriptMessage) {
    this.infoLog(`[VoiceAI] Transcript: "${data.transcript}" (isFinal: ${data.isFinal})`);
    
    if (data.isFinal) {
      this.startCCSequence(data.transcript);
    }
    
    if (!data.speechActive && data.isFinal) {
      this.isUserSpeaking = false;
    }
  }

  private handleAudio(data: AudioMessage) {
    if (this.isUserSpeaking) {
      this.infoLog('[VoiceAI] Discarding audio (user speaking - barge-in)');
      this.debugLog('audio_drop_user_speaking');
      return;
    }

    // Check for dropped request IDs (barge-in handling)
    if (data.requestId && this.droppedRequestIds.has(data.requestId)) {
      this.debugLog('audio_drop_request_marked', { requestId: data.requestId });
      return;
    }

    // Track active request ID
    if (!this.activeRequestId && data.requestId) {
      this.activeRequestId = data.requestId;
    }
    if (this.activeRequestId && data.requestId && data.requestId !== this.activeRequestId) {
      this.debugLog('audio_drop_request_mismatch', {
        activeRequestId: this.activeRequestId,
        requestId: data.requestId,
      });
      return;
    }

    try {
      const base64Audio = data.audio;
      if (!base64Audio || typeof base64Audio !== 'string') {
        this.warnLog('[VoiceAI] Invalid audio data - empty or wrong type');
        return;
      }

      const audioBuffer = this.decodeBase64Audio(base64Audio);
      if (!audioBuffer) {
        this.warnLog('[VoiceAI] Failed to decode audio chunk');
        this.debugLog('audio_decode_failed');
        return;
      }

      // Strip WAV header if present (44 bytes)
      const WAV_HEADER_SIZE = 44;
      let pcmData = audioBuffer;
      if (audioBuffer.length > WAV_HEADER_SIZE) {
        const header = String.fromCharCode(
          audioBuffer[0],
          audioBuffer[1],
          audioBuffer[2],
          audioBuffer[3]
        );
        if (header === 'RIFF') {
          pcmData = audioBuffer.slice(WAV_HEADER_SIZE);
        }
      }

      this.audioQueue.push(pcmData);
      this.inboundAudioPackets += 1;
      this.debugLog('audio_chunk_in', {
        requestId: data.requestId,
        bytes: pcmData.byteLength,
        queue: this.audioQueue.length,
        count: this.inboundAudioPackets,
      });
      this.processAudioQueue();
    } catch (err) {
      this.errorLog('[VoiceAI] Failed to decode audio:', err);
      this.debugLog('audio_decode_exception', String((err as Error)?.message || err));
    }
  }

  private handleVad(data: VadMessage) {
    this.infoLog(`[VoiceAI] VAD: ${data.vadSignal}`);
    
    if (data.vadSignal === 'START_SPEECH') {
      this.isUserSpeaking = true;
      // Mark active request as dropped on VAD start
      if (this.activeRequestId) {
        this.droppedRequestIds.add(this.activeRequestId);
      }
      this.activeRequestId = null;
      this.stopCurrentAudio();
      this.audioQueue = [];
      this.nextStartTime = this.outputAudioContext.currentTime;
      this.resetCC();
    } else if (data.vadSignal === 'END_SPEECH') {
      this.isUserSpeaking = false;
    }
  }

  private handleMetrics(data: MetricsMessage) {
    this.infoLog(`[VoiceAI] Metrics: ${data.type}`);
    
    if (data.type === 'provider_dispatch') {
      // New request dispatched - track it
      if (data.requestId) {
        this.activeRequestId = data.requestId;
        this.droppedRequestIds.delete(data.requestId);
      }
      return;
    }

    if (data.type === 'provider_discarded') {
      if (data.requestId) {
        this.droppedRequestIds.add(data.requestId);
      }
      if (this.activeRequestId === data.requestId) {
        this.activeRequestId = null;
      }
      this.stopCurrentAudio();
      return;
    }

    if (data.type === 'provider_result') {
      this.activeRequestId = data.requestId || this.activeRequestId;
      if (this.activeRequestId) {
        this.droppedRequestIds.delete(this.activeRequestId);
      }
      this.hideCCAfterDelay(1000);
      return;
    }

    if (data.type === 'barge_in') {
      if (data.requestId) {
        this.droppedRequestIds.add(data.requestId);
      }
      if (this.activeRequestId === data.requestId) {
        this.activeRequestId = null;
      }
      this.stopCurrentAudio();
      return;
    }

    if (data.type === 'provider_aborted') {
      if (data.requestId) {
        this.droppedRequestIds.add(data.requestId);
      }
      if (this.activeRequestId === data.requestId) {
        this.activeRequestId = null;
      }
      this.stopCurrentAudio();
      return;
    }

    if (data.type === 'skip_tts_segment') {
      this.debugLog('skip_tts_segment', data);
      return;
    }

    if (data.type === 'tts_language_fallback') {
      this.debugLog('tts_language_fallback', data);
      return;
    }

    if (data.type === 'llm_config_updated') {
      this.debugLog('llm_config_updated', data);
      return;
    }

    this.debugLog('metric_other', data);
  }

  private sendConfig(config: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.debugLog('ws_message_out', { type: 'config', config });
      this.ws.send(JSON.stringify({
        type: 'config',
        data: { config },
      }));
    }
  }

  private sendAudio(audioData: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const base64 = this.arrayBufferToBase64(audioData);
      this.outboundAudioPackets += 1;
      this.debugLog('ws_message_out', {
        type: 'audio',
        bytes: audioData.byteLength,
        packet: this.outboundAudioPackets,
      });
      this.ws.send(JSON.stringify({
        type: 'audio',
        data: { audio: base64 },
      }));
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private decodeBase64Audio(rawAudio: string): Uint8Array | null {
    const trimmed = String(rawAudio || '').trim();
    if (!trimmed) return null;

    // Allow both plain base64 and data URI payloads.
    const withoutDataUri = trimmed.startsWith('data:')
      ? (trimmed.split(',', 2)[1] || '')
      : trimmed;

    const withoutWhitespace = withoutDataUri.replace(/\s+/g, '');
    if (!withoutWhitespace) return null;

    // Browser atob expects standard base64; normalize base64url first.
    const normalized = withoutWhitespace.replace(/-/g, '+').replace(/_/g, '/');
    const stripped = normalized.replace(/[^A-Za-z0-9+/=]/g, '');
    if (!stripped) return null;

    const padLen = (4 - (stripped.length % 4)) % 4;
    const padded = stripped + '='.repeat(padLen);

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) {
      return null;
    }

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private stopCurrentAudio() {
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {}
    });
    this.sources.clear();
  }

  private async processAudioQueue() {
    if (this.audioQueue.length === 0) return;

    const currentTime = this.outputAudioContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    while (this.audioQueue.length > 0) {
      const audioChunk = this.audioQueue.shift();
      if (!audioChunk) continue;

      const evenByteLength = audioChunk.byteLength - (audioChunk.byteLength % 2);
      if (evenByteLength <= 0) continue;
      const audioData = new Int16Array(
        audioChunk.buffer,
        audioChunk.byteOffset,
        evenByteLength / 2
      );

      if (audioData.length === 0) continue;

      const buffer = this.outputAudioContext.createBuffer(1, audioData.length, 24000);
      const channelData = buffer.getChannelData(0);

      for (let i = 0; i < audioData.length; i++) {
        channelData[i] = audioData[i] / 0x7FFF;
      }

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.outputNode);

      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime = this.nextStartTime + buffer.duration;
      this.sources.add(source);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
    this.debugLog('error', msg);
  }

  private debugLog(scope: string, payload?: unknown) {
    if (!this.shouldLogDebug()) return;
    const stamp = new Date().toISOString().split('T')[1]?.replace('Z', '') || '';
    let text = '';
    if (payload !== undefined) {
      if (typeof payload === 'string') {
        text = payload;
      } else {
        try {
          text = JSON.stringify(payload);
        } catch {
          text = String(payload);
        }
      }
    }
    const line = `[${stamp}] ${scope}${text ? ` :: ${text}` : ''}`;
    this.debugEvents = [...this.debugEvents.slice(-199), line];
    this.infoLog(`[VoiceAI][debug] ${line}`);
  }

  private async startRecording() {
    if (this.isRecording) return;

    this.infoLog('[VoiceAI] Starting recording...');

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.updateStatus('Connecting...');
      await this.connectWebSocket();
    }

    await this.inputAudioContext.resume();
    await this.outputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      this.infoLog('[VoiceAI] Microphone access granted');
      this.updateStatus('Microphone ready. Starting...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);

      let packetCount = 0;
      this.scriptProcessorNode.onaudioprocess = (event) => {
        if (!this.isRecording || !this.ws) return;

        packetCount++;
        if (packetCount % 100 === 0) {
          this.infoLog(`[VoiceAI] Sent ${packetCount} audio packets`);
        }

        const inputBuffer = event.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        const int16Data = new Int16Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          const s = Math.max(-1, Math.min(1, pcmData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        this.sendAudio(int16Data.buffer);
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('Recording... Speak now!');
    } catch (err) {
      this.errorLog('[VoiceAI] Error starting recording:', err);
      this.updateError(`Microphone error: ${(err as Error).message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    this.infoLog('[VoiceAI] Stopping recording...');
    this.updateStatus('Stopping...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Stopped. Click mic to start again.');
  }

  private reset() {
    this.infoLog('[VoiceAI] Resetting session...');
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.stopCurrentAudio();
    this.audioQueue = [];
    this.nextStartTime = 0;
    this.isUserSpeaking = false;
    this.sessionId = null;
    this.resetCC();
    
    this.updateStatus('Session reset.');
  }

  public pause() {
    this.infoLog('[VoiceAI] Pausing...');
    
    if (this.isRecording) {
      this.stopRecording();
    }
    
    this.stopCurrentAudio();
    this.audioQueue = [];
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.inputAudioContext.state === 'running') {
      this.inputAudioContext.suspend();
    }
    
    if (this.outputAudioContext.state === 'running') {
      this.outputAudioContext.suspend();
    }
    
    this.resetCC();
    this.updateStatus('Paused');
  }

  public async resume() {
    this.infoLog('[VoiceAI] Resuming...');
    
    if (this.inputAudioContext.state === 'suspended') {
      await this.inputAudioContext.resume();
    }
    
    if (this.outputAudioContext.state === 'suspended') {
      await this.outputAudioContext.resume();
    }
    
    this.isRecording = false;
    this.updateStatus('Ready. Click the mic to start.');
  }

  private openSettings() {
    const modal = this.shadowRoot?.querySelector('gdm-settings-modal') as HTMLElement & { open?: (settings: AgentSettings) => void };
    if (modal && modal.open) {
      modal.open(this.currentSettings);
    }
  }

  protected async firstUpdated() {
    this.initAudio();

    try {
      const response = await fetch('/api/prompts');
      if (!response.ok) {
        this.errorLog(`[VoiceAI] Failed to load prompts: HTTP ${response.status} ${response.statusText}`);
      } else {
        const data = await response.json();
        if (data.prompts && data.prompts.length > 0) {
          const defaultPrompt = data.prompts.find((p: { id: string }) => p.id === 'default');
          if (defaultPrompt) {
            this.currentSettings.promptContent = defaultPrompt.content;
          }
        }
      }
    } catch (error) {
      this.errorLog('[VoiceAI] Failed to load prompts:', error);
    }

    this.addEventListener('settings-save', ((e: Event) => {
      const event = e as CustomEvent<AgentSettings>;
      const wasDebugEnabled = Boolean(this.currentSettings.showDebugLogs);
      this.currentSettings = event.detail;
      if (wasDebugEnabled && !this.currentSettings.showDebugLogs) {
        this.debugEvents = [];
      }
      this.infoLog('[VoiceAI] Settings updated:', event.detail);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendConfig({
          language: this.currentSettings.languageCode,
          ttsLanguage: this.resolveTtsLanguage(this.currentSettings.languageCode),
          speaker: this.currentSettings.speaker,
          provider: this.currentSettings.provider,
          groqModel: this.currentSettings.groqModel,
          cerebrasModel: this.currentSettings.cerebrasModel,
          groqTemperature: this.currentSettings.groqTemperature,
          cerebrasTemperature: this.currentSettings.cerebrasTemperature,
          groqMaxTokens: this.currentSettings.groqMaxTokens,
          cerebrasMaxTokens: this.currentSettings.cerebrasMaxTokens,
          systemPrompt: this.currentSettings.promptContent,
          greeting: this.currentSettings.greeting,
        });
      }

      this.updateStatus('Settings updated!');
    }) as EventListener);
  }

  render() {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const showDebugPanel = isDevelopment && this.currentSettings.showDebugLogs;

    return html`
      <div>
        ${isDevelopment ? html`
          <button
            class="settings-btn"
            @click=${() => this.openSettings()}
            aria-label="Open settings"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.5 2.25H10.5L11.25 4.5L13.5 5.25L15.75 4.5L17.25 7.5L15.75 9L16.5 11.25L15.75 13.5L13.5 12.75L11.25 13.5L10.5 15.75H7.5L6.75 13.5L4.5 12.75L2.25 13.5L0.75 10.5L2.25 9L1.5 6.75L2.25 4.5L4.5 5.25L6.75 4.5L7.5 2.25Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
        ` : ''}

        ${this.ccVisible && this.ccChunks.length > 0 && this.ccCurrentIndex >= 0 ? html`
          <div class="cc-container">
            <div class="cc-text ${this.ccExiting ? 'exiting' : 'entering'}">
              ${this.ccChunks[this.ccCurrentIndex]}
            </div>
          </div>
        ` : ''}

        <div class="controls">
          ${!this.isRecording ? html`
            <button class="mic-btn" @click=${() => this.startRecording()} aria-label="Start recording">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
              </svg>
            </button>
          ` : html`
            <button class="stop-btn" @click=${() => this.pause()} aria-label="Stop recording">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            <button @click=${this.reset} aria-label="Reset session">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"></path>
              </svg>
            </button>
          `}
        </div>

        <div id="status">
          ${this.error ? html`<span style="color: #ff5c5c;">${this.error}</span>` : this.status}
        </div>

        ${showDebugPanel ? html`
          <div class="debug-panel">
            <div class="debug-title">Debug (${this.debugEvents.length})</div>
            ${this.debugEvents.length === 0
              ? html`<div class="debug-line">Waiting for events...</div>`
              : this.debugEvents.map((line) => html`<div class="debug-line">${line}</div>`)}
          </div>
        ` : ''}

        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
        ></gdm-live-audio-visuals-3d>

        <gdm-settings-modal></gdm-settings-modal>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio': GdmLiveAudio;
  }
}
