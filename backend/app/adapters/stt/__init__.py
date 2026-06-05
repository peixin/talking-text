from app.adapters.stt.dashscope import DashScopeQwenASRAdapter
from app.adapters.stt.protocol import AudioFormat, STTAdapter, STTRequest, STTResult
from app.adapters.stt.volc import VolcSTTAdapter

__all__ = [
    "AudioFormat",
    "DashScopeQwenASRAdapter",
    "STTAdapter",
    "STTRequest",
    "STTResult",
    "VolcSTTAdapter",
]
