/** @type {HTMLVideoElement} */
const preview = document.getElementById("preview");
/** @type {HTMLButtonElement} */
const startButton = document.getElementById("startButton");
/** @type {HTMLButtonElement} */
const stopButton = document.getElementById("stopButton");
/** @type {HTMLPreElement} */
const logElement = document.getElementById("log");
/** @type {WritableStream<Blob>} */
let writableStream;
/** @type {FileSystemHandle} */
let fileHandle;
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
 * Records a Mediastream and writes it to a WritableStream.
 * @param {MediaStream} mediaStream 
 * @param {WritableStream<Blob>} writableStream 
 * @returns {Promise<void>} the recorded stream
 */
function startRecording(mediaStream, writableStream) {
    return new Promise((resolve, reject) => {
        let recorder = new MediaRecorder(mediaStream);
        recorder.ondataavailable = (event) => writableStream.write(event.data);
        recorder.start();
        recorder.onstop = resolve;
        mediaStream.onstop = resolve;
        recorder.onerror = (event) => reject(event.name);
        mediaStream.onerror = (event) => reject(event.name);
    }).finally(() => writableStream.close());
}

/**
 * @param {number} bytes 
 * @returns {string} formatted file size
 */
function formatFileSizeIEC(bytes) {
    const binaryKilo = 1024;
    const unit = Math.log(bytes) / Math.log(binaryKilo) | 0;
    const value = (bytes / Math.pow(binaryKilo, unit)).toFixed(2);
    const postfix = unit ? 'KMGTPEZY'[unit - 1] + 'iB' : 'Bytes';
    return `${value} ${postfix}`;
}

/**
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

function main() {
    window.showSaveFilePicker({ suggestedName: new Date().toISOString() + ".webm", accept: { "video/webm": [".webm"] } })
        .then((newHandle) => {
            fileHandle = newHandle;
            return newHandle.createWritable();
        }).then((ws) => {
            writableStream = ws;
        })
        .then(() => navigator.mediaDevices
            .getDisplayMedia({
                video: {
                    displaySurface: "monitor",

                },
                audio: true,
            }))
        .then((stream) => {
            preview.srcObject = stream;
            return new Promise((resolve) => (preview.onplaying = resolve));
        })
        .then(() => {
            window.onbeforeunload = (event) => event.preventDefault()
            startButton.classList.add("invisible");
            stopButton.classList.remove("invisible");
            recordingStart = performance.now();
            log(`recording started 🔴`);
            return startRecording(preview.captureStream(), writableStream);
        })
        .then(() => fileHandle.getFile())
        .then((file) => {
            window.onbeforeunload = () => { };
            preview.srcObject = null;

            preview.src = URL.createObjectURL(file);

            startButton.classList.add("invisible");
            stopButton.classList.add("invisible");

            log(`recording stopped ⬛`);
            log(`Successfully recorded:`)
            log(`  ${file.name}`)
            log(`  ${formatDuration(performance.now() - recordingStart)}`)
            log(`  ${formatFileSizeIEC(file.size)} of ${file.type} media.`)
        })
        .catch((error) => log(error));
}

startButton.addEventListener("click", main);
stopButton.addEventListener(
    "click",
    () => preview.srcObject.getTracks().forEach((track) => track.stop())
);
