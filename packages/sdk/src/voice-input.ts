import type { CohubEnvironment } from "./environment.js";
import { resolveVoiceInputWebsocketUrl } from "./environment.js";

export type VoiceInputEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export type VoiceInputCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
};

export type VoiceInputClientOptions = {
  env?: CohubEnvironment;
  url?: string;
  getAccessToken?: (options?: { forceRefresh?: boolean }) => Promise<string | null> | string | null;
  WebSocketImpl?: WebSocketConstructor;
  connectionTimeoutMs?: number;
  callbacks?: VoiceInputCallbacks;
};

export type VoiceInputCreateOptions = Omit<VoiceInputClientOptions, "callbacks">;

export type WebSocketLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_MS = 200;
const CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const WEBSOCKET_OPEN = 1;

const getDefaultWebSocket = (): WebSocketConstructor => {
  const WebSocketImpl = globalThis.WebSocket;
  if (!WebSocketImpl) throw new Error("WebSocket is not available in this environment");
  return WebSocketImpl;
};

const getDefaultAudioContext = () => {
  const context = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return context.AudioContext ?? context.webkitAudioContext;
};

const encodeBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
    return btoa(binary);
  }
  const maybeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): { toString(encoding: "base64"): string } };
  }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(bytes).toString("base64");
  throw new Error("Base64 encoding is not available in this environment");
};

const floatToPcm16 = (samples: Float32Array) => {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
};

const resampleTo16k = (input: Float32Array, inputSampleRate: number) => {
  if (inputSampleRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const index = i * ratio;
    const left = Math.floor(index);
    const right = Math.min(left + 1, input.length - 1);
    const weight = index - left;
    output[i] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight;
  }
  return output;
};

export class VoiceInputClient {
  private readonly url: string;
  private readonly getAccessToken?: VoiceInputClientOptions["getAccessToken"];
  private readonly WebSocketImpl: WebSocketConstructor;
  private readonly connectionTimeoutMs: number;
  private readonly callbacks: VoiceInputCallbacks;

  private socket: WebSocketLike | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pendingSamples: number[] = [];
  private started = false;
  private intentionalClose = false;

  constructor(options: VoiceInputClientOptions = {}) {
    this.url = resolveVoiceInputWebsocketUrl({ env: options.env, url: options.url });
    this.getAccessToken = options.getAccessToken;
    this.WebSocketImpl = options.WebSocketImpl ?? getDefaultWebSocket();
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
    this.callbacks = options.callbacks ?? {};
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.intentionalClose = false;

    try {
      const token = await this.getAccessToken?.();
      if (!token) throw new Error("Sign in to use voice input");

      await this.setupAudio();

      this.socket = new this.WebSocketImpl(this.url);
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) return reject(new Error("Voice service unavailable"));
        let settled = false;
        const timeout = globalThis.setTimeout(
          () => fail(new Error("Voice connection timed out")),
          this.connectionTimeoutMs,
        );
        const succeed = () => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeout);
          resolve();
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeout);
          this.cleanupAudio();
          this.started = false;
          this.intentionalClose = true;
          this.socket?.close();
          reject(error);
        };

        this.socket.onopen = () => {
          this.send({ type: "auth", payload: { token } });
        };
        this.socket.onerror = () => fail(new Error("Voice service unavailable"));
        this.socket.onclose = () => {
          if (!settled) {
            fail(new Error("Voice connection closed"));
            return;
          }
          if (!this.intentionalClose) {
            this.cleanupAudio();
            this.started = false;
            this.callbacks.onError?.("Voice connection closed. Try again.");
            this.callbacks.onDone?.();
          }
        };
        this.socket.onmessage = (event) => {
          try {
            const data = this.handleMessage(event);
            if (data.type === "system.auth.ok") this.send({ type: "asr.start" });
            if (data.type === "asr.started") succeed();
            if (data.type === "asr.error") fail(new Error(String(data.payload?.message ?? "Voice input failed")));
          } catch {
            const error = new Error("Voice service sent invalid data. Try again.");
            if (!settled) {
              fail(error);
              return;
            }
            this.closeWithError(error.message);
          }
        };
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  stop() {
    if (this.pendingSamples.length > 0) this.sendAudio(new Float32Array(this.pendingSamples.splice(0)));
    this.send({ type: "asr.stop" });
    this.cleanupAudio();
  }

  cancel() {
    this.send({ type: "asr.cancel" });
    this.intentionalClose = true;
    this.close();
  }

  close() {
    this.intentionalClose = true;
    this.cleanupAudio();
    this.socket?.close();
    this.socket = null;
    this.started = false;
  }

  private closeWithError(message: string) {
    this.callbacks.onError?.(message);
    this.close();
    this.callbacks.onDone?.();
  }

  private async setupAudio() {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices) throw new Error("Microphone input is not available in this environment");
    const AudioContextImpl = getDefaultAudioContext();
    if (!AudioContextImpl) throw new Error("AudioContext is not available in this environment");

    this.stream = await mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContextImpl();
    await this.audioContext.resume().catch(() => undefined);
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const samples = event.inputBuffer.getChannelData(0);
      const resampled = resampleTo16k(samples, this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE);
      for (const sample of resampled) this.pendingSamples.push(sample);
      while (this.pendingSamples.length >= CHUNK_SAMPLES) {
        const chunk = this.pendingSamples.splice(0, CHUNK_SAMPLES);
        this.sendAudio(new Float32Array(chunk));
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private sendAudio(samples: Float32Array) {
    const audio = encodeBase64(floatToPcm16(samples));
    this.send({ type: "asr.audio", payload: { audio } });
  }

  private send(message: Record<string, unknown>) {
    if (this.socket?.readyState === WEBSOCKET_OPEN) this.socket.send(JSON.stringify(message));
  }

  private handleMessage(event: MessageEvent) {
    const data = JSON.parse(String(event.data)) as VoiceInputEvent;
    const text = typeof data.payload?.text === "string" ? data.payload.text : "";
    if (data.type === "asr.partial") this.callbacks.onPartial?.(text);
    if (data.type === "asr.final") this.callbacks.onFinal?.(text);
    if (data.type === "asr.error") this.callbacks.onError?.(String(data.payload?.message ?? "Voice input failed"));
    if (data.type === "asr.done") {
      this.intentionalClose = true;
      this.callbacks.onDone?.();
    }
    return data;
  }

  private cleanupAudio() {
    this.processor?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    void this.audioContext?.close().catch(() => undefined);
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;
    this.pendingSamples = [];
  }
}

export class VoiceApi {
  constructor(private readonly defaults: VoiceInputCreateOptions = {}) {}

  createInputClient(callbacks: VoiceInputCallbacks = {}, options: VoiceInputCreateOptions = {}) {
    return new VoiceInputClient({
      ...this.defaults,
      ...options,
      callbacks,
    });
  }
}

export const createVoiceInputClient = (options?: VoiceInputClientOptions) => new VoiceInputClient(options);
