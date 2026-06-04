# screen-recorder

Browser-based screen recorder with live AI transcription. There is **no backend**:
the static frontend talks directly to a vLLM Whisper server over its
OpenAI-compatible API.

```
./scripts/start-dev.sh
```

This builds and starts the vLLM container on `http://localhost:8003`.
You can serve the static frontend any way you like (e.g. `python3 -m http.server`).

| Component    | Tech                                     | URL                        |
| ------------ | ---------------------------------------- | -------------------------- |
| **Frontend** | Vanilla HTML/JS/CSS (no build, no server) | `http://localhost:8000`    |
| **vLLM**     | `openai/whisper-large-v3` (GPU)          | `http://localhost:8003/v1` |

## How it works

- Screen + (optional) mic are captured via `getDisplayMedia` / `getUserMedia`
  and recorded locally with `MediaRecorder`; the `.webm` is auto-downloaded.
- When live transcription is enabled, audio is downsampled to 16 kHz in the
  browser, buffered, and every ~0.8 s the un-committed tail is POSTed as a WAV
  file to vLLM's `/v1/audio/transcriptions` endpoint. The commit/interim
  streaming heuristic runs entirely client-side in `index.js`
  (`TranscriptionSession`).

## Configuration

The frontend defaults to `http://localhost:8003` and model
`openai/whisper-large-v3`. Override before `index.js` loads by setting globals,
e.g. in `index.html`:

```html
<script>
  window.VLLM_BASE_URL = "http://my-host:8003";
  window.VLLM_MODEL = "openai/whisper-large-v3";
</script>
```

CORS is enabled on vLLM via `--allowed-origins ["*"]` passed to the container in `start-dev.sh`.

## Type checking

```
npx tsc --noEmit
```
