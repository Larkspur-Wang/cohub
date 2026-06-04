import { PUBLIC_GATEWAY_ORIGIN } from "$env/static/public";
import { getAuthToken } from "$lib/auth";

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

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_MS = 200;
const CHUNK_SAMPLES = (TARGET_SAMPLE_RATE * CHUNK_MS) / 1000;

const getGatewayWsUrl = () => {
	const origin = PUBLIC_GATEWAY_ORIGIN || window.location.origin;
	const wsOrigin = origin
		.replace(/^https:/, "wss:")
		.replace(/^http:/, "ws:")
		.replace(/\/$/, "");
	return `${wsOrigin}/asr/ws`;
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
		output[i] =
			(input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight;
	}
	return output;
};

const bytesToBase64 = (bytes: Uint8Array) => {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1)
		binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
};

export class VoiceInputClient {
	private socket: WebSocket | null = null;
	private stream: MediaStream | null = null;
	private audioContext: AudioContext | null = null;
	private processor: ScriptProcessorNode | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private pendingSamples: number[] = [];
	private started = false;
	private intentionalClose = false;

	constructor(private readonly callbacks: VoiceInputCallbacks = {}) {}

	async start() {
		if (this.started) return;
		this.started = true;
		this.intentionalClose = false;

		try {
			await this.setupAudio();

			const token = await getAuthToken();
			if (!token) throw new Error("Sign in to use voice input");

			this.socket = new WebSocket(getGatewayWsUrl());
			await new Promise<void>((resolve, reject) => {
				if (!this.socket) return reject(new Error("Voice service unavailable"));
				let settled = false;
				const timeout = window.setTimeout(
					() => fail(new Error("Voice connection timed out")),
					10_000,
				);
				const succeed = () => {
					if (settled) return;
					settled = true;
					window.clearTimeout(timeout);
					resolve();
				};
				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					window.clearTimeout(timeout);
					this.cleanupAudio();
					this.started = false;
					this.intentionalClose = true;
					this.socket?.close();
					reject(error);
				};

				this.socket.onopen = () => {
					this.send({ type: "auth", payload: { token } });
				};
				this.socket.onerror = () =>
					fail(new Error("Voice service unavailable"));
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
					const data = this.handleMessage(event);
					if (data?.type === "system.auth.ok") this.send({ type: "asr.start" });
					if (data?.type === "asr.started") succeed();
					if (data?.type === "asr.error")
						fail(
							new Error(String(data.payload?.message ?? "Voice input failed")),
						);
				};
			});
		} catch (error) {
			this.close();
			throw error;
		}
	}

	private async setupAudio() {
		this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		this.audioContext = new AudioContext();
		await this.audioContext.resume().catch(() => undefined);
		this.source = this.audioContext.createMediaStreamSource(this.stream);
		this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
		this.processor.onaudioprocess = (event) => {
			const samples = event.inputBuffer.getChannelData(0);
			const resampled = resampleTo16k(
				samples,
				this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE,
			);
			for (const sample of resampled) this.pendingSamples.push(sample);
			while (this.pendingSamples.length >= CHUNK_SAMPLES) {
				const chunk = this.pendingSamples.splice(0, CHUNK_SAMPLES);
				this.sendAudio(new Float32Array(chunk));
			}
		};
		this.source.connect(this.processor);
		this.processor.connect(this.audioContext.destination);
	}

	stop() {
		if (this.pendingSamples.length > 0) {
			this.sendAudio(new Float32Array(this.pendingSamples.splice(0)));
		}
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

	private sendAudio(samples: Float32Array) {
		const audio = bytesToBase64(floatToPcm16(samples));
		this.send({ type: "asr.audio", payload: { audio } });
	}

	private send(message: Record<string, unknown>) {
		if (this.socket?.readyState === WebSocket.OPEN)
			this.socket.send(JSON.stringify(message));
	}

	private handleMessage(event: MessageEvent) {
		const data = JSON.parse(String(event.data)) as VoiceInputEvent;
		const text =
			typeof data.payload?.text === "string" ? data.payload.text : "";
		if (data.type === "asr.partial") this.callbacks.onPartial?.(text);
		if (data.type === "asr.final") this.callbacks.onFinal?.(text);
		if (data.type === "asr.error")
			this.callbacks.onError?.(
				String(data.payload?.message ?? "Voice input failed"),
			);
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
