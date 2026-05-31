"""
Live transcription backend for screen-recorder.

Run:
    cd backend
    uv sync
    uv run python src/main.py

Requires:
    - NVIDIA GPU with CUDA 12 + cuDNN 9 (for faster-whisper GPU acceleration)
    - uv (https://docs.astral.sh/uv/)
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager
from typing import Any

import ctranslate2
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from faster_whisper import WhisperModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Globals – model is loaded once on startup
# ---------------------------------------------------------------------------
MODEL: WhisperModel | None = None
RATE = 16000  # Hz – expected sample rate from browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the Whisper model once when the server starts."""
    global MODEL
    device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    logger.info("Loading faster-whisper large-v3-turbo on %s (%s)...", device, compute_type)
    MODEL = WhisperModel("large-v3-turbo", device=device, compute_type=compute_type)
    logger.info("Model ready.")
    yield
    logger.info("Shutting down.")


app = FastAPI(title="Screen Recorder Transcription", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_float32(audio_int16: bytes) -> np.ndarray:
    """Convert raw Int16 PCM bytes to float32 [-1.0, 1.0]."""
    arr = np.frombuffer(audio_int16, dtype=np.int16)
    return arr.astype(np.float32) / 32768.0


# ---------------------------------------------------------------------------
# Transcription session – one instance per WebSocket client
# ---------------------------------------------------------------------------
class TranscriptionSession:
    def __init__(self, websocket: WebSocket, language: str | None) -> None:
        self.websocket = websocket
        self.language = language  # None = auto-detect
        self.frames = np.array([], dtype=np.float32)
        self.timestamp_offset = 0.0  # seconds already committed
        self.committed_text = ""
        self.interim_text = ""
        self.last_interim = ""
        self.last_interim_count = 0
        self.lock = asyncio.Lock()
        self.exit = False
        self.task: asyncio.Task[Any] | None = None

    def add_audio(self, audio_np: np.ndarray) -> None:
        self.frames = np.concatenate((self.frames, audio_np))
        # Trim old audio to prevent unbounded growth (keep last ~45 s)
        max_samples = 45 * RATE
        if len(self.frames) > max_samples:
            trim_samples = 30 * RATE
            self.frames = self.frames[trim_samples:]
            self.timestamp_offset = max(0.0, self.timestamp_offset - 30.0)

    async def run_loop(self) -> None:
        """Background task: transcribe buffered audio every ~0.8 s."""
        while not self.exit:
            await asyncio.sleep(0.8)

            async with self.lock:
                samples_processed = int(self.timestamp_offset * RATE)
                input_bytes = self.frames[samples_processed:].copy()

            duration = len(input_bytes) / RATE
            if duration < 1.0:
                continue

            # faster-whisper is blocking / CUDA-synchronous → run in thread pool
            segments = await asyncio.to_thread(self._transcribe, input_bytes)
            if not segments:
                continue

            await self._process_segments(segments, duration)

    def _transcribe(self, audio: np.ndarray) -> list[Any]:
        """Blocking call inside thread pool."""
        assert MODEL is not None
        segs, _info = MODEL.transcribe(
            audio,
            language=self.language,
            task="transcribe",
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=True,
        )
        return list(segs)

    async def _process_segments(self, segments: list[Any], duration: float) -> None:
        """
        Split Whisper output into committed (final) and interim (unfinished) text.
        All segments except the last one are treated as complete.
        The last segment is interim; if it repeats unchanged 3× we commit it.
        """
        if len(segments) >= 2:
            # Commit all but last
            committed = ""
            offset = 0.0
            for s in segments[:-1]:
                committed += s.text
                offset = max(offset, s.end)

            self.committed_text += committed
            self.timestamp_offset += offset
            self.last_interim = ""
            self.last_interim_count = 0

            # Last segment becomes interim
            interim = segments[-1].text
            self.interim_text = interim
            self.last_interim = interim
            self.last_interim_count = 0
        else:
            # Only one segment → interim
            interim = segments[0].text
            self.interim_text = interim

            if interim == self.last_interim and interim:
                self.last_interim_count += 1
                if self.last_interim_count >= 3:
                    # Repeated often enough → commit
                    self.committed_text += interim
                    self.timestamp_offset += min(duration, segments[0].end)
                    self.interim_text = ""
                    self.last_interim = ""
                    self.last_interim_count = 0
            else:
                self.last_interim = interim
                self.last_interim_count = 0

        await self._send()

    async def _send(self) -> None:
        try:
            await self.websocket.send_json(
                {
                    "type": "transcript",
                    "committed": self.committed_text.strip(),
                    "interim": self.interim_text.strip(),
                }
            )
        except Exception:
            pass  # Client may have disconnected

    async def finalize(self) -> None:
        """Flush any remaining interim text as committed on disconnect."""
        self.exit = True
        if self.interim_text:
            self.committed_text += self.interim_text
            self.interim_text = ""
        await self._send()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    # 1. Receive client config (language, model, etc.)
    raw = await websocket.receive_text()
    config = json.loads(raw)
    lang = config.get("language")
    if lang == "auto":
        lang = None

    session = TranscriptionSession(websocket, lang)
    session.task = asyncio.create_task(session.run_loop())

    try:
        while True:
            data = await websocket.receive_bytes()
            audio_np = _to_float32(data)
            session.add_audio(audio_np)
    except WebSocketDisconnect:
        logger.info("Client disconnected.")
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        session.exit = True
        if session.task:
            session.task.cancel()
            try:
                await session.task
            except asyncio.CancelledError:
                pass
        await session.finalize()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
