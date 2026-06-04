const enableTranscriptionCheckbox = /** @type {HTMLInputElement} */ (
  document.getElementById("enable-transcription")
);
const enableTranscriptionLabel = /** @type {HTMLLabelElement} */ (
  document.getElementById("enable-transcription-label")
);
const transcriptionPanel = /** @type {HTMLDivElement} */ (
  document.getElementById("transcription-panel")
);
const committedEl = /** @type {HTMLDivElement} */ (
  document.getElementById("transcription-committed")
);

const logElement = /** @type {HTMLPreElement} */ (
  document.getElementById("log")
);

/**
 * Logs to an element on screen.
 * @param {string} msg
 */
function log(msg) {
  logElement.innerHTML += `${msg}\n`;
}

// ── Transcription config ──────────────────────────────────────────────
// The browser talks to the vLLM OpenAI-compatible server directly.
// Set window.VLLM_BASE_URL via localStorage to enable transcription, e.g.:
//   localStorage.setItem("VLLM_BASE_URL", "http://localhost:8003")

const VLLM_BASE_URL = /** @type {string | null} */ (
  localStorage.getItem("VLLM_BASE_URL")
);
const VLLM_MODEL = "openai/whisper-large-v3";

console.log(`localStorage.setItem("VLLM_BASE_URL", "http://localhost:8003")`);
if (VLLM_BASE_URL !== null) {
  enableTranscriptionCheckbox.classList.remove("invisible");
  enableTranscriptionLabel.classList.remove("invisible");
}

const RATE = 16000; // Hz – sample rate sent to Whisper

// ── Voice-activity / chunking parameters ──────────────────────────────
const SILENCE_RMS = 0.01; // amplitude below this counts as "silence"
const SILENCE_HANG_MS = 700; // pause length that closes a chunk
const MIN_CHUNK_MS = 500; // ignore chunks shorter than this (noise)
const MAX_CHUNK_MS = 25000; // force-flush cap (~Whisper's native window)

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {ScriptProcessorNode | null} */
let processor = null;
/** @type {MediaStreamAudioSourceNode | null} */
let audioSource = null;
/** @type {GainNode | null} */
let zeroGain = null;
/** @type {TranscriptionSession | null} */
let session = null;

/**
 * Pack float32 [-1, 1] mono audio into an in-memory 16-bit PCM WAV Blob.
 * @param {Float32Array} audio
 * @returns {Blob}
 */
function audioToWavBlob(audio) {
  const numSamples = audio.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  /** @param {number} offset @param {string} str */
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const byteRate = RATE * 2; // mono, 16-bit
  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size (PCM)
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = 1
  view.setUint32(24, RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Concatenate two Float32Arrays into a new one.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {Float32Array}
 */
function concatFloat32(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Root-mean-square amplitude of a frame – used for voice-activity detection.
 * @param {Float32Array} frame
 * @returns {number}
 */
function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

/**
 * Buffers 16 kHz mono audio and flushes a chunk to Whisper whenever a natural
 * pause is detected (or a hard length cap is reached). Each chunk is
 * transcribed exactly once and appended to the committed transcript – no
 * interim/flicker logic.
 */
class TranscriptionSession {
  constructor() {
    /** @type {Float32Array} buffered speech for the current chunk */
    this.frames = new Float32Array(0);
    /** running silence duration in ms */
    this.silenceMs = 0;
    /** whether the current buffer contains any speech yet */
    this.hasSpeech = false;
    this.committedText = "";
    this.exit = false;
    /** serialize uploads so chunks commit in order */
    this.chain = Promise.resolve();
  }

  /**
   * Feed a freshly captured 16 kHz mono frame and update VAD state.
   * @param {Float32Array} frame
   */
  addAudio(frame) {
    if (this.exit) return;

    const frameMs = (frame.length / RATE) * 1000;
    const loud = rms(frame) >= SILENCE_RMS;

    if (loud) {
      this.hasSpeech = true;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }

    this.frames = concatFloat32(this.frames, frame);

    const chunkMs = (this.frames.length / RATE) * 1000;
    const pauseClosed = this.hasSpeech && this.silenceMs >= SILENCE_HANG_MS;
    const capReached = chunkMs >= MAX_CHUNK_MS;

    if (pauseClosed || capReached) {
      this.flush();
    }
  }

  /** Cut the current buffer and queue it for transcription. */
  flush() {
    const chunk = this.frames;
    this.frames = new Float32Array(0);
    this.silenceMs = 0;
    this.hasSpeech = false;

    const chunkMs = (chunk.length / RATE) * 1000;
    if (chunkMs < MIN_CHUNK_MS) return;

    const prompt = this.committedText.slice(-2000);
    // Queue so commits stay in spoken order even if requests overlap.
    this.chain = this.chain.then(async () => {
      const text = await this.transcribe(chunk, prompt);
      if (text) {
        this.committedText += (this.committedText ? " " : "") + text.trim();
        this.render();
      }
    });
  }

  /**
   * Send one audio chunk to vLLM and return the transcribed text.
   * @param {Float32Array} audio
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async transcribe(audio, prompt) {
    const wav = audioToWavBlob(audio);

    const form = new FormData();
    form.append("file", wav, "chunk.wav");
    form.append("model", VLLM_MODEL);
    form.append("response_format", "json");
    form.append("prompt", prompt);

    try {
      const resp = await fetch(`${VLLM_BASE_URL}/v1/audio/transcriptions`, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const result = await resp.json();
      return result.text ?? "";
    } catch (exc) {
      log(`transcription error: ${exc}`);
      return "";
    }
  }

  /** Push the committed transcript to the DOM. */
  render() {
    committedEl.textContent = this.committedText.trim();
  }

  /** Flush whatever is buffered and stop accepting audio. */
  async finalize() {
    this.exit = true;
    this.flush();
    await this.chain;
  }
}

/**
 * Start capturing audio from the given MediaStream and transcribing it
 * directly against the vLLM Whisper endpoint (no backend involved).
 * @param {MediaStream} stream
 */
function startTranscription(stream) {
  if (!enableTranscriptionCheckbox.checked) return;

  transcriptionPanel.classList.remove("invisible");
  committedEl.textContent = "";

  session = new TranscriptionSession();

  // Ask the browser for a 16 kHz context so it performs proper, anti-aliased
  // resampling for us – no manual decimation needed.
  audioCtx = new AudioContext({ sampleRate: RATE });
  audioSource = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);

  // Keep the graph active but silent.
  zeroGain = audioCtx.createGain();
  zeroGain.gain.value = 0;
  audioSource.connect(processor);
  processor.connect(zeroGain);
  zeroGain.connect(audioCtx.destination);

  processor.onaudioprocess = (e) => {
    if (!session || session.exit) return;
    // Copy: the underlying buffer is reused by the audio thread.
    const input = e.inputBuffer.getChannelData(0);
    session.addAudio(new Float32Array(input));
  };
}

/**
 * Flush remaining audio, then tear down transcription resources.
 */
function stopTranscription() {
  const finishing = session ? session.finalize() : Promise.resolve();
  finishing.finally(() => {
    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (audioSource) {
      audioSource.disconnect();
      audioSource = null;
    }
    if (zeroGain) {
      zeroGain.disconnect();
      zeroGain = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    session = null;
  });
}

export {
  enableTranscriptionCheckbox,
  enableTranscriptionLabel,
  startTranscription,
  stopTranscription,
};
