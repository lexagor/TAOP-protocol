"""LangChain tools for TAOP — discover + score, no hard dependency."""

from __future__ import annotations

from typing import Any, Optional

try:
    from langchain_core.tools import BaseTool as _BaseTool
    from pydantic import BaseModel, Field

    _HAS_LANGCHAIN = True
except Exception:
    _HAS_LANGCHAIN = False
    _BaseTool = object  # type: ignore
    BaseModel = object  # type: ignore

    def Field(*_a: Any, **_kw: Any) -> Any:  # type: ignore
        return None


if _HAS_LANGCHAIN:

    class DiscoverInput(BaseModel):
        capabilityType: str = Field(default="LoRA", description="Capability type, e.g. LoRA")
        minScore: int = Field(default=0, description="Minimum self-attest score")

    class ScoreInput(BaseModel):
        agentAddress: str = Field(description="Agent address 0x...")

    class TaopDiscoverTool(_BaseTool):  # type: ignore
        name: str = "taop_discover"
        description: str = "Discover agents by capability proof + self-attest score. Returns ranked list with scores and CIDs."
        args_schema: type[BaseModel] = DiscoverInput
        registry: Any = None
        ron: Any = None

        def __init__(self, registry: Any, ron: Any, **kw: Any):
            super().__init__(registry=registry, ron=ron, **kw)  # type: ignore

        def _run(self, capabilityType: str = "LoRA", minScore: int = 0) -> str:
            from ..clients import discover

            items = discover(self.registry, self.ron, capabilityType, minScore)
            if not items:
                return "No agents found."
            lines = []
            for it in items:
                lines.append(f"{it['agentAddress']} cap#{it['capabilityId']} score={it['score']} ({it['completions']}-{it['disputes']}) cid={it['metadataCID']}")
            return "\n".join(lines)

    class TaopScoreTool(_BaseTool):  # type: ignore
        name: str = "taop_score"
        description: str = "Get self-attest score for an agent address."
        args_schema: type[BaseModel] = ScoreInput
        ron: Any = None

        def __init__(self, ron: Any, **kw: Any):
            super().__init__(ron=ron, **kw)  # type: ignore

        def _run(self, agentAddress: str) -> str:
            s = self.ron.get_self_attest_score(agentAddress)
            return f"completions={s.completions} disputes={s.disputes} score={s.score}"

else:

    class TaopDiscoverTool:  # type: ignore
        def __init__(self, *a: Any, **kw: Any):
            raise ImportError("langchain-core not installed. pip install langchain-core")

    class TaopScoreTool:  # type: ignore
        def __init__(self, *a: Any, **kw: Any):
            raise ImportError("langchain-core not installed. pip install langchain-core")


def load_taop_tools(registry: Any, ron: Any) -> list[Any]:
    return [TaopDiscoverTool(registry, ron), TaopScoreTool(ron)]
