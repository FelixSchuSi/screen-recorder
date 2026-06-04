const preview = /** @type {HTMLVideoElement} */ (
  document.getElementById("preview")
);
const startButton = /** @type {HTMLButtonElement} */ (
  document.getElementById("startButton")
);
const stopButton = /** @type {HTMLButtonElement} */ (
  document.getElementById("stopButton")
);
const recordMicCheckbox = /** @type {HTMLInputElement} */ (
  document.getElementById("record-mic")
);
const labelElement = /** @type {HTMLInputElement} */ (
  document.getElementById("record-mic-label")
);
const logElement = /** @type {HTMLPreElement} */ (
  document.getElementById("log")
);
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
const interimEl = /** @type {HTMLSpanElement} */ (
  document.getElementById("transcription-interim")
);

// ── Transcription config ──────────────────────────────────────────────
// The browser talks to the vLLM OpenAI-compatible server directly.
// Override these at runtime via window.VLLM_BASE_URL / window.VLLM_MODEL if needed.

const VLLM_BASE_URL = /** @type {string | null} */ localStorage.getItem("VLLM_BASE_URL");
const VLLM_MODEL =
  /** @type {string} */ "openai/whisper-large-v3";

console.log(`localStorage.setItem("VLLM_BASE_URL", "http://localhost:8003")`)
if (VLLM_BASE_URL !== null) {
  enableTranscriptionCheckbox.classList.remove("invisible");
  enableTranscriptionLabel.classList.remove("invisible");
}

const RATE = 16000; // Hz – sample rate sent to Whisper

/** @type {number} */
let recordingStart;

/** @type {AudioContext | null} */
let audioCtx = null;
/** @type {ScriptProcessorNode | null} */
let processor = null;
/** @type {MediaStreamAudioSourceNode | null} */
let audioSource = null;
/** @type {TranscriptionSession | null} */
let session = null;

/**
 * Logs to an element on screen.
 * @param {string} msg
 */
function log(msg) {
  logElement.innerHTML += `${msg}\n`;
}

/**
 * Records a Mediastream and writes it to a array of Blobs.
 * @param {MediaStream} mediaStream
 * @param {Blob[]} chunks
 * @returns {Promise<void>}
 */
function record(mediaStream, chunks) {
  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(mediaStream);
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => reject(event);
    recorder.start();
  });
}

/**
 * Merges a Videostream containing Audio- and Videotracks with an
 * Audiostream that only contains an Audiotrack.
 * In the Outputstream you can hear both Audiotracks.
 * @param {MediaStream} videoStream
 * @param {MediaStream} audioStream
 * @returns {MediaStream} the merged stream
 */
function mergeVideoAndAudioStream(videoStream, audioStream) {
  const audioContext = new AudioContext();

  const mediaStreamDestination = audioContext.createMediaStreamDestination();
  if (videoStream.getAudioTracks().length > 0) {
    audioContext
      .createMediaStreamSource(videoStream)
      .connect(mediaStreamDestination);
  }

  audioContext
    .createMediaStreamSource(audioStream)
    .connect(mediaStreamDestination);

  const mergedStream = new MediaStream();
  videoStream.getVideoTracks().forEach((track) => {
    mergedStream.addTrack(track);
  });
  mediaStreamDestination.stream.getAudioTracks().forEach((track) => {
    mergedStream.addTrack(track);
  });
  return mergedStream;
}

/**
 * Formats the size of a file using IEC prefix names (e. g. KiB, MiB, etc.)
 * @param {number} bytes number of bytes
 * @returns {string} formatted file size
 */
function formatFileSizeIEC(bytes) {
  const binaryKilo = 1024;
  const unit = (Math.log(bytes) / Math.log(binaryKilo)) | 0;
  const value = (bytes / Math.pow(binaryKilo, unit)).toFixed(2);
  const postfix = unit ? "KMGTPEZY"[unit - 1] + "iB" : "Bytes";
  return `${value} ${postfix}`;
}

/**
 * Formats a duration of time.
 * @param {number} milliseconds
 * @returns {string} formatted duration
 */
function formatDuration(milliseconds) {
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)} seconds`;
  }
  const minutes = seconds / 60;
  return `${Math.trunc(minutes)} minutes and ${(seconds % 60).toFixed(2)} seconds`;
}

/**
 * @returns {{ recordingStart: number; }}
 */
function onRecordStart() {
  window.onbeforeunload = (event) => event.preventDefault();
  startButton.classList.add("invisible");
  recordMicCheckbox.classList.add("invisible");
  labelElement.classList.add("invisible");
  enableTranscriptionCheckbox.classList.add("invisible");
  stopButton.classList.remove("invisible");
  recordingStart = performance.now();
  log(`recording started 🔴`);
  return { recordingStart };
}

/**
 * @param {{chunks: Blob[], duration: number}} param
 */
async function onRecordFinish({ chunks, duration }) {
  window.onbeforeunload = () => {};
  /** @type {MediaStream} */ (preview.srcObject)
    ?.getTracks()
    ?.forEach((track) => track.stop());
  preview.srcObject = null;
  const blob = new Blob(chunks, {
    type: "video/webm",
  });

  preview.src = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = preview.src;
  a.download = `${new Date().toISOString()}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  stopButton.classList.add("invisible");
  log(`recording stopped ⬛`);
  log(`Successfully recorded:`);
  log(`  ${formatFileSizeIEC(blob.size)} of ${blob.type}`);
  log(`  ${formatDuration(duration)}`);
}

/**
 * Pack float32 [-1, 1] mono audio into an in-memory 16-bit PCM WAV Blob.
 * Mirrors the backend's `_audio_to_wav_buffer`.
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
 * @typedef {{ text: string, start: number, end: number }} Segment
 */

/**
 * Client-side port of the former Python `TranscriptionSession`.
 *
 * Buffers incoming 16 kHz mono float32 audio, and every ~0.8 s sends the
 * un-committed tail to the vLLM Whisper endpoint, then splits the result into
 * committed (final) and interim (unfinished) text using the same heuristic as
 * the original backend.
 */
class TranscriptionSession {
  constructor() {
    /** @type {Float32Array} */
    this.frames = new Float32Array(0);
    this.timestampOffset = 0.0; // seconds already committed
    this.committedText = "";
    this.interimText = "";
    this.lastInterim = "";
    this.lastInterimCount = 0;
    this.exit = false;
    /** @type {boolean} */
    this.busy = false;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.timer = null;
  }

  /**
   * Append newly captured audio to the rolling buffer.
   * @param {Float32Array} audio
   */
  addAudio(audio) {
    this.frames = concatFloat32(this.frames, audio);
    // Trim old audio to prevent unbounded growth (keep last ~45 s)
    const maxSamples = 45 * RATE;
    if (this.frames.length > maxSamples) {
      const trimSamples = 30 * RATE;
      this.frames = this.frames.slice(trimSamples);
      this.timestampOffset = Math.max(0.0, this.timestampOffset - 30.0);
    }
  }

  /** Start the background polling loop. */
  start() {
    this.timer = setInterval(() => this.tick(), 800);
  }

  /** One iteration of the transcription loop (every ~0.8 s). */
  async tick() {
    if (this.exit || this.busy) return;

    const samplesProcessed = Math.floor(this.timestampOffset * RATE);
    const newAudio = this.frames.slice(samplesProcessed);
    const prompt = this.committedText;

    const duration = newAudio.length / RATE;
    if (duration < 1.0) return;

    this.busy = true;
    try {
      const segments = await this.transcribe(newAudio, prompt);
      if (segments.length) {
        this.processSegments(segments, duration);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Send audio to vLLM and return parsed segments.
   * @param {Float32Array} audio
   * @param {string} prompt
   * @returns {Promise<Segment[]>}
   */
  async transcribe(audio, prompt) {
    const wav = audioToWavBlob(audio);
    // Truncate prompt to avoid token-limit issues (whisper prompt ~224 tokens)
    const safePrompt = prompt ? prompt.slice(-2000) : "";

    const form = new FormData();
    form.append("file", wav, "chunk.wav");
    form.append("model", VLLM_MODEL);
    form.append("response_format", "verbose_json");
    form.append("prompt", safePrompt);

    try {
      const resp = await fetch(`${VLLM_BASE_URL}/v1/audio/transcriptions`, {
        method: "POST",
        body: form,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const result = await resp.json();
      const segments = result.segments ?? [];
      return segments.map(
        /** @param {any} seg */ (seg) => ({
          text: seg.text ?? "",
          start: seg.start ?? 0.0,
          end: seg.end ?? 0.0,
        }),
      );
    } catch (exc) {
      log(`transcription error: ${exc}`);
      return [];
    }
  }

  /**
   * Split Whisper output into committed (final) and interim (unfinished) text.
   * All segments except the last are treated as complete. The last segment is
   * interim; if it repeats unchanged 3× we commit it.
   * @param {Segment[]} segments
   * @param {number} duration
   */
  processSegments(segments, duration) {
    if (segments.length >= 2) {
      // Commit all but last
      let committed = "";
      let offset = 0.0;
      for (const s of segments.slice(0, -1)) {
        committed += s.text;
        offset = Math.max(offset, s.end);
      }

      this.committedText += committed;
      this.timestampOffset += offset;
      this.lastInterim = "";
      this.lastInterimCount = 0;

      // Last segment becomes interim
      const interim = segments[segments.length - 1].text;
      this.interimText = interim;
      this.lastInterim = interim;
      this.lastInterimCount = 0;
    } else {
      // Only one segment → interim
      const interim = segments[0].text;
      this.interimText = interim;

      if (interim === this.lastInterim && interim) {
        this.lastInterimCount += 1;
        if (this.lastInterimCount >= 3) {
          // Repeated often enough → commit
          this.committedText += interim;
          this.timestampOffset += Math.min(duration, segments[0].end);
          this.interimText = "";
          this.lastInterim = "";
          this.lastInterimCount = 0;
        }
      } else {
        this.lastInterim = interim;
        this.lastInterimCount = 0;
      }
    }

    this.render();
  }

  /** Push the current committed/interim text to the DOM. */
  render() {
    committedEl.textContent = this.committedText.trim();
    interimEl.textContent = this.interimText.trim();
  }

  /** Flush any remaining interim text as committed and stop the loop. */
  finalize() {
    this.exit = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.interimText) {
      this.committedText += this.interimText;
      this.interimText = "";
    }
    this.render();
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
  interimEl.textContent = "";

  session = new TranscriptionSession();
  session.start();

  audioCtx = new AudioContext({ sampleRate: 48000 });
  audioSource = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);

  // Keep graph active but silent
  const zeroGain = audioCtx.createGain();
  zeroGain.gain.value = 0;
  audioSource.connect(processor);
  processor.connect(zeroGain);
  zeroGain.connect(audioCtx.destination);

  processor.onaudioprocess = (e) => {
    if (!session || session.exit) return;

    const inputData = e.inputBuffer.getChannelData(0); // 48 kHz float32
    // Downsample to 16 kHz (factor 3)
    const downLen = Math.floor(inputData.length / 3);
    const down = new Float32Array(downLen);
    for (let i = 0; i < downLen; i++) {
      down[i] = inputData[i * 3];
    }
    session.addAudio(down);
  };
}

/**
 * Clean up transcription resources.
 */
function stopTranscription() {
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  if (session) {
    session.finalize();
    session = null;
  }
}

async function main() {
  const videoStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: "monitor",
    },
    // @ts-ignore
    systemAudio: "include",
    audio: true,
  });

  /** @type {MediaStream | undefined} */
  let audioStream;
  if (recordMicCheckbox.checked) {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    preview.srcObject = mergeVideoAndAudioStream(videoStream, audioStream);
  } else {
    preview.srcObject = videoStream;
  }

  startTranscription(/** @type {MediaStream} */ (preview.srcObject));

  await new Promise((resolve) => (preview.onplaying = resolve));
  const { recordingStart } = onRecordStart();

  // When the user clicks the "stop sharing" button that the browser provides,
  // the stream ends silently.
  // If that happens, we force the recording to stop.
  const intervallId = setInterval(() => {
    const videoTracks = /** @type {MediaStream} */ (
      preview.srcObject
    )?.getVideoTracks();
    const videoTrackEnded = !!videoTracks?.find(
      (t) => t.readyState === "ended",
    );
    if (videoTrackEnded || videoTracks === undefined || videoTracks === null) {
      stopTranscription();
      /** @type {MediaStream} */ (preview.srcObject)
        ?.getTracks()
        ?.forEach((track) => track.stop());
      audioStream?.getTracks()?.forEach((track) => track.stop());
      videoStream?.getTracks()?.forEach((track) => track.stop());
      clearInterval(intervallId);
      return;
    }
  }, 1000);

  /** @type {Blob[]} */
  const chunks = [];

  /** @type {MediaStream} */
  const captureStream = // @ts-ignore
    preview.captureStream?.() ?? preview.mozCaptureStream?.();
  await record(captureStream, chunks);
  const duration = performance.now() - recordingStart;
  stopTranscription();
  await onRecordFinish({ chunks, duration });
}

startButton.addEventListener("click", () => main().catch((e) => {
  log(e);
  stopTranscription();
}));
stopButton.addEventListener("click", () => {
  stopTranscription();
  /** @type {MediaStream} */ (preview.srcObject)
    ?.getTracks()
    ?.forEach((track) => track.stop());
});

