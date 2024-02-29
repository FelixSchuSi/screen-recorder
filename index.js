/** @type {HTMLVideoElement} */
const preview = document.getElementById("preview");
/** @type {HTMLButtonElement} */
const startButton = document.getElementById("startButton");
/** @type {HTMLButtonElement} */
const stopButton = document.getElementById("stopButton");
/** @type {HTMLInputElement} */
const recordMicCheckbox = document.getElementById("record-mic");

/** @type {HTMLPreElement} */
const logElement = document.getElementById("log");

/**
 * Logs to an element on screen.
 * @param {string} msg
 */
function log(msg) {
    logElement.innerHTML += `${msg}\n`;
}

/**
 * Records a Mediastream and writes it to a WritableStream.
 * @param {MediaStream} mediaStream
 * @param {WritableStream<Blob>} writableStream
 * @returns {Promise<void>} the recorded stream
 */
function startRecording(mediaStream, writableStream) {
    return new Promise((resolve, reject) => {
        const recorder = new MediaRecorder(mediaStream);
        recorder.ondataavailable = (event) => writableStream.write(event.data);
        recorder.start();
        recorder.onstop = resolve;
        recorder.onerror = (event) => reject(event.name);
    }).finally(() => writableStream.close());
}

/**
 * Merges a Videostream containing Audio- and Videotracks with an
 * Audiostream that only contains an Audiotrack.
 * In the Outputstream you can hear both Audiotracks.
 * @param {MediaStream} videoStream 
 * @param {MediaStream} audioStream 
 */
function mergeVideoAndAudioStream(videoStream, audioStream) {
    const audioContext = new AudioContext();

    const mediaStreamDestination = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(videoStream).connect(mediaStreamDestination);
    audioContext.createMediaStreamSource(audioStream).connect(mediaStreamDestination);

    const mergedStream = new MediaStream();
    videoStream.getVideoTracks().forEach(track => {
        mergedStream.addTrack(track);
    });
    mediaStreamDestination.stream.getAudioTracks().forEach(track => {
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
        return `${seconds} seconds`;
    }
    const minutes = seconds / 60;
    return `${minutes} minutes and ${seconds % 60} seconds`;
}

async function main() {
    /** @type {FileSystemHandle} */
    const fileHandle = await window.showSaveFilePicker({
        startIn: "downloads",
        suggestedName: new Date().toISOString() + ".webm",
        accept: { "video/webm": [".webm"] },
    });
    /** @type {WritableStream<Blob>} */
    const writableStream = await fileHandle.createWritable();
    const videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            displaySurface: "monitor",
        },
        audio: true,
    });

    if (recordMicCheckbox.checked) {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        preview.srcObject = mergeVideoAndAudioStream(videoStream, audioStream);
    } else {
        preview.srcObject = videoStream;
    }

    await new Promise((resolve) => (preview.onplaying = resolve));

    window.onbeforeunload = (event) => event.preventDefault();
    startButton.classList.add("invisible");
    stopButton.classList.remove("invisible");
    const recordingStart = performance.now();
    log(`recording started 🔴`);
    await startRecording(preview.captureStream(), writableStream);

    window.onbeforeunload = () => { };
    preview.srcObject = null;

    preview.src = URL.createObjectURL(fileHandle);

    stopButton.classList.add("invisible");

    log(`recording stopped ⬛`);
    log(`Successfully recorded:`);
    log(`  ${fileHandle.name}`);
    log(`  ${formatDuration(performance.now() - recordingStart)}`);
    log(`  ${formatFileSizeIEC(fileHandle.size)} of ${fileHandle.type} media.`);
}

startButton.addEventListener("click", () => main().catch((e) => log(e)));
stopButton.addEventListener("click", () =>
    preview.srcObject.getTracks().forEach((track) => track.stop())
);
