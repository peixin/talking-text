"""Model probe — hit a provider's real API through our actual adapters and print
the raw response. Decoupled from config.toml: pass provider/model directly so you
can test a model BEFORE wiring it in. API keys are read from .env by provider name.

Run from backend/ (or `just probe ...`). See probes/README.md for full usage.
Add --raw to dump the full JSON response.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import sys
import time
from pathlib import Path

from app.adapters.stt.protocol import AudioFormat
from app.config import settings

# provider name -> (base_url, api_key) from .env. Add a row to test a new vendor.
_LLM_PROVIDERS: dict[str, tuple[str, str]] = {
    "deepseek": (settings.deepseek_base_url, settings.deepseek_api_key),
    "volc_ark": (settings.volc_ark_base_url, settings.volc_ark_api_key),
    "aliyun": (settings.dashscope_base_url, settings.dashscope_api_key),
    "xiaomi": (settings.xiaomi_base_url, settings.xiaomi_api_key),
}

_AUDIO_FMT: dict[str, AudioFormat] = {".ogg": "ogg", ".wav": "wav", ".mp3": "mp3", ".pcm": "pcm"}
_TTS_OUT_EXT = {"mp3": "mp3", "ogg_opus": "ogg", "pcm": "pcm"}


def _resolve_llm(provider: str) -> tuple[str, str]:
    if provider not in _LLM_PROVIDERS:
        sys.exit(f"unknown LLM provider {provider!r}; pick from {list(_LLM_PROVIDERS)}")
    base_url, key = _LLM_PROVIDERS[provider]
    if not key:
        sys.exit(f"no API key for {provider!r} in .env")
    return base_url, key


def _header(title: str) -> None:
    print(f"\n=== {title} ===")


def _dump_raw(raw: dict) -> None:
    print("raw:\n" + json.dumps(raw, ensure_ascii=False, indent=2))


async def cmd_llm(a: argparse.Namespace) -> None:
    from app.adapters.llm.openai_compatible import OpenAICompatibleLLMAdapter
    from app.adapters.llm.protocol import LLMMessage

    base_url, key = _resolve_llm(a.provider)
    extra: dict = {}
    reasoning: str | None = None
    if a.thinking:
        extra = {"thinking": {"type": a.thinking}}
        reasoning = a.reasoning_effort if a.thinking == "enabled" else None

    adapter = OpenAICompatibleLLMAdapter(
        api_key=key, base_url=base_url, model=a.model, extra_body=extra, reasoning_effort=reasoning
    )
    messages = []
    if a.system:
        messages.append(LLMMessage(role="system", content=a.system))
    messages.append(LLMMessage(role="user", content=a.prompt))

    _header(f"LLM  {a.provider} / {a.model}")
    t = time.monotonic()
    if a.stream:
        print("text (stream): ", end="", flush=True)
        async for delta in adapter.stream(
            messages, max_tokens=a.max_tokens, temperature=a.temperature
        ):
            print(delta, end="", flush=True)
        print(f"\nlatency : {time.monotonic() - t:.2f}s")
        return
    r = await adapter.invoke(messages, max_tokens=a.max_tokens, temperature=a.temperature)
    print(f"latency : {time.monotonic() - t:.2f}s")
    print(f"model   : {r.model}")
    print(f"tokens  : in={r.input_tokens} out={r.output_tokens}")
    print(f"text    : {r.text}")
    if a.raw:
        _dump_raw(r.raw)


async def cmd_vision(a: argparse.Namespace) -> None:
    from app.adapters.llm.openai_compatible import OpenAICompatibleLLMAdapter
    from app.adapters.llm.protocol import ImagePart, LLMMessage

    base_url, key = _resolve_llm(a.provider)
    content: list = [a.prompt]
    for path in a.image:
        data = Path(path).read_bytes()
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        content.append(ImagePart(data=data, mime=mime))

    adapter = OpenAICompatibleLLMAdapter(
        api_key=key, base_url=base_url, model=a.model, modalities=frozenset({"text", "image"})
    )
    _header(f"VISION  {a.provider} / {a.model}  ({len(a.image)} image(s))")
    t = time.monotonic()
    r = await adapter.invoke(
        [LLMMessage(role="user", content=content)], max_tokens=a.max_tokens, temperature=0.2
    )
    print(f"latency : {time.monotonic() - t:.2f}s")
    print(f"tokens  : in={r.input_tokens} out={r.output_tokens}")
    print(f"text    : {r.text}")
    if a.raw:
        _dump_raw(r.raw)


async def cmd_asr(a: argparse.Namespace) -> None:
    from app.adapters.stt.protocol import STTAdapter, STTRequest

    fmt = _AUDIO_FMT.get(Path(a.audio).suffix.lower())
    if not fmt:
        sys.exit(f"unsupported audio extension for {a.audio!r}; use .ogg/.wav/.mp3/.pcm")
    audio = Path(a.audio).read_bytes()
    req = STTRequest(audio=audio, audio_format=fmt, sample_rate=a.sample_rate, language=a.language)

    adapter: STTAdapter
    if a.provider == "volc":
        from app.adapters.stt.volc import VolcSTTAdapter

        adapter = VolcSTTAdapter()
    elif a.provider in ("aliyun", "dashscope"):
        from app.adapters.stt.dashscope import DashScopeQwenASRAdapter

        adapter = DashScopeQwenASRAdapter(model=a.model)
    else:
        sys.exit(f"unknown STT provider {a.provider!r}; pick volc | aliyun")

    _header(f"ASR  {a.provider}  ({fmt}, {len(audio)} bytes)")
    t = time.monotonic()
    r = await adapter.invoke(req)
    print(f"latency : {time.monotonic() - t:.2f}s")
    print(f"seconds : {r.audio_seconds}")
    print(f"tokens  : in={r.input_tokens} out={r.output_tokens}")
    print(f"text    : {r.text}")
    if a.raw:
        _dump_raw(r.raw)


async def cmd_tts(a: argparse.Namespace) -> None:
    from app.adapters.tts.protocol import TTSAdapter, TTSRequest

    req = TTSRequest(
        text=a.text,
        voice=a.voice or settings.volc_tts_default_voice,
        audio_format=a.format,
        sample_rate=a.sample_rate,
    )
    adapter: TTSAdapter
    if a.provider == "volc":
        from app.adapters.tts.volc import VolcTTSAdapter

        adapter = VolcTTSAdapter()
    elif a.provider == "openai_compatible":
        from app.adapters.tts.openai_compatible import OpenAITTSAdapter

        adapter = OpenAITTSAdapter(
            api_key=a.key or None, base_url=a.base_url or None, model=a.model or None
        )
    else:
        sys.exit(f"unknown TTS provider {a.provider!r}; pick volc | openai_compatible")

    _header(f"TTS  {a.provider}  fmt={a.format}")
    t = time.monotonic()
    r = await adapter.invoke(req)
    out = a.out or f"probe_tts.{_TTS_OUT_EXT.get(a.format, 'bin')}"
    Path(out).write_bytes(r.audio)
    print(f"latency : {time.monotonic() - t:.2f}s")
    print(f"voice   : {r.voice}")
    print(f"chars   : {r.chars}")
    print(f"bytes   : {len(r.audio)} -> {out}")


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="probes", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    llm = sub.add_parser("llm", help="chat completion")
    llm.add_argument("--provider", required=True, help="deepseek|volc_ark|aliyun|xiaomi")
    llm.add_argument("--model", required=True)
    llm.add_argument("--prompt", default="Say hi to me in one short, friendly sentence.")
    llm.add_argument("--system", default=None)
    llm.add_argument("--max-tokens", type=int, default=128)
    llm.add_argument("--temperature", type=float, default=0.7)
    llm.add_argument("--thinking", choices=["disabled", "enabled"], default=None)
    llm.add_argument("--reasoning-effort", default="low")
    llm.add_argument("--stream", action="store_true")
    llm.add_argument("--raw", action="store_true")
    llm.set_defaults(fn=cmd_llm)

    vis = sub.add_parser("vision", help="multimodal chat (text + image)")
    vis.add_argument("--provider", required=True, help="volc_ark|aliyun|xiaomi")
    vis.add_argument("--model", required=True)
    vis.add_argument("--image", action="append", required=True, help="path; repeatable")
    vis.add_argument("--prompt", default="Transcribe and describe what is on this page.")
    vis.add_argument("--max-tokens", type=int, default=1024)
    vis.add_argument("--raw", action="store_true")
    vis.set_defaults(fn=cmd_vision)

    asr = sub.add_parser("asr", help="speech-to-text")
    asr.add_argument("--provider", default="aliyun", help="volc|aliyun")
    asr.add_argument("--model", default="qwen3-asr-flash", help="for aliyun")
    asr.add_argument("--audio", required=True, help="path (.ogg/.wav/.mp3/.pcm)")
    asr.add_argument("--language", default=None, help="omit for zh+en multilingual")
    asr.add_argument("--sample-rate", type=int, default=16000)
    asr.add_argument("--raw", action="store_true")
    asr.set_defaults(fn=cmd_asr)

    tts = sub.add_parser("tts", help="text-to-speech")
    tts.add_argument("--provider", default="volc", help="volc|openai_compatible")
    tts.add_argument("--text", default="Hello! Let's practice English together.")
    tts.add_argument("--voice", default=None)
    tts.add_argument("--format", default="mp3", choices=["mp3", "ogg_opus", "pcm"])
    tts.add_argument("--sample-rate", type=int, default=24000)
    tts.add_argument("--base-url", default=None, help="openai_compatible override")
    tts.add_argument("--key", default=None, help="openai_compatible override")
    tts.add_argument("--model", default=None, help="openai_compatible override")
    tts.add_argument("--out", default=None, help="output audio file path")
    tts.set_defaults(fn=cmd_tts)

    return p


def main() -> None:
    args = _build_parser().parse_args()
    asyncio.run(args.fn(args))


if __name__ == "__main__":
    main()
