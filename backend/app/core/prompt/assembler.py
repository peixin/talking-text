"""Build the LLM system prompt from a ScopeResult.

Pure function — no I/O. The output is a multi-section string that is passed
as the ``system`` message to the LLM. Each section is only included when its
data is present, so the empty-scope case degrades to the plain persona.
"""

from __future__ import annotations

from app.core.scope.protocol import ScopeResult

_TINA_PERSONA = (
    "You are Tina, a warm and patient English teacher chatting with an "
    "elementary-school child in mainland China. Always respond in English. "
    "Use simple, age-appropriate vocabulary and short sentences (≤ 15 words). "
    "If the child speaks Chinese, gently re-phrase their idea in English and "
    "invite them to repeat it. Stay encouraging; never correct mistakes "
    "harshly. Each turn, ask exactly one short follow-up question to keep "
    "the conversation going."
)


def build_system_prompt(
    scope: ScopeResult,
    persona_prompt: str = _TINA_PERSONA,
    learner_name: str | None = None,
) -> str:
    """Return the full system prompt string for a session."""
    sections: list[str] = [persona_prompt]

    if learner_name:
        sections.append(
            f"The child's name is {learner_name}. "
            "Use their name naturally in conversation to make it feel warm and personal."
        )

    if scope.words or scope.phrases:
        vocab_lines: list[str] = []
        if scope.words:
            vocab_lines.append(f"Words: {', '.join(scope.words)}")
        if scope.phrases:
            vocab_lines.append(f"Phrases: {', '.join(scope.phrases)}")
        sections.append(
            "The child has learned these vocabulary items. Use them naturally in "
            "conversation. Do not introduce vocabulary outside this list "
            "(one or two new words per session is fine):\n" + "\n".join(vocab_lines)
        )

    if scope.patterns:
        pattern_lines = "\n".join(f'  • "{p.text}"' for p in scope.patterns)
        sections.append(
            "Practice these sentence patterns today. "
            "Guide the child to use them:\n" + pattern_lines
        )

    if scope.prompt_notes:
        sections.append(
            "Grammar notes (apply gently, never correct harshly):\n" + scope.prompt_notes
        )

    if scope.focus_instructions:
        sections.append("Today's practice focus:\n" + scope.focus_instructions)

    return "\n\n".join(sections)
