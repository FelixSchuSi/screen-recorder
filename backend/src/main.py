from __future__ import annotations
import asyncio
import io
import logging
import os
import wave
from contextlib import asynccontextmanager
from typing import Any

import httpx
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

RATE = 16000  # Hz – expected sample rate from browser

VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "http://localhost:8003")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "openai/whisper-large-v3")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Verify vLLM is reachable on startup."""
    logger.info("Checking vLLM at %s ...", VLLM_BASE_URL)
    async with httpx.AsyncClient(base_url=VLLM_BASE_URL, timeout=10.0) as client:
        try:
            resp = await client.get("/health")
            resp.raise_for_status()
            logger.info("vLLM reachable: %s", resp.status_code)
        except Exception as exc:
            logger.warning("vLLM health-check failed (will retry on requests): %s", exc)
    yield
    logger.info("Shutting down.")


app = FastAPI(title="Screen Recorder Transcription", lifespan=lifespan)


def _to_float32(audio_int16: bytes) -> np.ndarray:
    """Convert raw Int16 PCM bytes to float32 [-1.0, 1.0]."""
    arr = np.frombuffer(audio_int16, dtype=np.int16)
    return arr.astype(np.float32) / 32768.0


def _audio_to_wav_buffer(audio_np: np.ndarray) -> io.BytesIO:
    """Pack float32 [-1, 1] mono audio into an in-memory WAV file."""
    buf = io.BytesIO()
    # Convert float32 -> int16 PCM
    pcm = (np.clip(audio_np, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(pcm.tobytes())
    buf.seek(0)
    return buf


class TranscriptionSession:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
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
                new_audio = self.frames[samples_processed:].copy()
                prompt = self.committed_text

            duration = len(new_audio) / RATE
            if duration < 1.0:
                continue

            segments = await self._transcribe(new_audio, prompt)
            if not segments:
                continue

            await self._process_segments(segments, duration)

    async def _transcribe(self, audio: np.ndarray, prompt: str) -> list[Any]:
        """Send audio to vLLM and return segments."""
        buf = _audio_to_wav_buffer(audio)
        # Truncate prompt to avoid token-limit issues (whisper prompt ~224 tokens)
        safe_prompt = prompt[-2000:] if prompt else ""

        async with httpx.AsyncClient(base_url=VLLM_BASE_URL, timeout=30.0) as client:
            try:
                resp = await client.post(
                    "/v1/audio/transcriptions",
                    files={"file": ("chunk.wav", buf, "audio/wav")},
                    data={
                        "model": VLLM_MODEL,
                        "response_format": "verbose_json",
                        "prompt": safe_prompt,
                    },
                )
                resp.raise_for_status()
                result = resp.json()
            except Exception as exc:
                logger.error("vLLM transcription error: %s", exc)
                return []

        # vLLM verbose_json returns a list of segments under "segments" key
        segments = result.get("segments", [])
        # Normalize to simple dicts so _process_segments stays happy
        return [
            {"text": seg.get("text", ""), "start": seg.get("start", 0.0), "end": seg.get("end", 0.0)}
            for seg in segments
        ]

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
                committed += s["text"]
                offset = max(offset, s["end"])

            self.committed_text += committed
            self.timestamp_offset += offset
            self.last_interim = ""
            self.last_interim_count = 0

            # Last segment becomes interim
            interim = segments[-1]["text"]
            self.interim_text = interim
            self.last_interim = interim
            self.last_interim_count = 0
        else:
            # Only one segment → interim
            interim = segments[0]["text"]
            self.interim_text = interim

            if interim == self.last_interim and interim:
                self.last_interim_count += 1
                if self.last_interim_count >= 3:
                    # Repeated often enough → commit
                    self.committed_text += interim
                    self.timestamp_offset += min(duration, segments[0]["end"])
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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket) -> None:
    await websocket.accept()

    session = TranscriptionSession(websocket)
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


# mounted *after* API routes so they don't shadow them
app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
