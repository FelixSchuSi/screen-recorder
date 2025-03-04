import { fixWebmDuration } from "./lib.js";

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
/** @type {number} */
let recordingStart;

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
    debugger;
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
  const buggyBlob = new Blob(chunks, {
    type: "video/webm",
  });

  const newBlob = await fixWebmDuration(buggyBlob, duration);
  preview.src = URL.createObjectURL(newBlob);
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
  log(`  ${formatFileSizeIEC(newBlob.size)} of ${buggyBlob.type}`);
  log(`  ${formatDuration(duration)}`);
}

async function main() {
  const videoStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: "monitor",
    },
    systemAudio: "include",
    audio: true,
  });

  let audioStream;
  if (recordMicCheckbox.checked) {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    preview.srcObject = mergeVideoAndAudioStream(videoStream, audioStream);
  } else {
    preview.srcObject = videoStream;
  }

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

  /** @type {MediaStream} */ // @ts-ignore
  const captureStream =
    preview.captureStream?.() ?? preview.mozCaptureStream?.();
  await record(captureStream, chunks);
  const duration = performance.now() - recordingStart;
  await onRecordFinish({ chunks, duration });
}

startButton.addEventListener("click", () => main().catch((e) => log(e)));
stopButton.addEventListener("click", () =>
  /** @type {MediaStream} */ (preview.srcObject)
    ?.getTracks()
    ?.forEach((track) => track.stop()),
);
