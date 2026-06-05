# Model probes

Quickly hit a provider's **real** API through our actual adapters and print the
raw response — for evaluating models, verifying a blindly-written adapter, or
trying a model before wiring it into `config.toml`.

- Decoupled from `config.toml`: pass `--provider` / `--model` directly.
- API keys come from `.env` (by provider name). Set them first.
- These hit **paid** endpoints. They write audio files to the current dir.
- Dev-only; not imported by the app.

## Run

From the repo root:

```bash
just probe llm --provider deepseek --model deepseek-v4-flash --prompt "Say hi"
```

…or from `backend/`:

```bash
poetry run python -m probes llm --provider deepseek --model deepseek-v4-flash
```

Add `--raw` to any command to dump the full JSON response.

## Examples

```bash
# LLM chat — try each vendor / model
just probe llm --provider deepseek --model deepseek-v4-flash
just probe llm --provider aliyun   --model qwen-flash
just probe llm --provider xiaomi   --model mimo-v2.5
just probe llm --provider deepseek --model deepseek-v4-pro --thinking enabled --reasoning-effort medium
just probe llm --provider deepseek --model deepseek-v4-flash --stream

# Vision / multimodal — pass one or more --image
just probe vision --provider aliyun --model qwen3-vl-plus --image page.jpg
just probe vision --provider xiaomi --model mimo-v2.5-pro --image page.jpg --image page2.jpg

# STT
just probe asr --provider aliyun --audio clip.wav            # Qwen3-ASR (zh+en)
just probe asr --provider aliyun --audio clip.wav --language zh
just probe asr --provider volc   --audio clip.ogg            # Volc WebSocket

# TTS (writes an audio file)
just probe tts --provider volc --text "Hello there" --out hi.mp3
just probe tts --provider openai_compatible --base-url <url> --key <key> --model <m> --voice alloy --text "Hi"
```

## Adding a new vendor to probe

1. Add its key/base_url to `.env` + `app/config.py` (`Settings`).
2. Add a row to `_LLM_PROVIDERS` in `__main__.py` (for chat/vision), or a `case`
   in `cmd_asr` / `cmd_tts` for a new STT/TTS adapter.

## Workflow with Claude

Run a probe, paste the printed block (and `--raw` JSON when an adapter looks
wrong) back into the chat. Share the vendor's API doc and we adjust the adapter
to match the real response shape.
