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

_CALIBRATION_INSTRUCTIONS = (
    "This is your FIRST conversation with this child — you do not yet know "
    "their English level. Goal: chat naturally while quietly observing their "
    "level. The child must not feel tested.\n"
    '- Open with the simplest A1 greeting (e.g. "Hi! What\'s your name?").\n'
    "- Keep sentences SHORT (5-8 words max).\n"
    "- Adapt to their response:\n"
    "  * single-word reply → stay A1, slow down\n"
    "  * short full sentence → try A1+ (introduce at most one new word)\n"
    "  * rich sentence → try A2-level vocabulary\n"
    "Never ask about their level, never use words above B1 in the first "
    "5 turns, never lecture or quiz. Make them feel safe — the first goal "
    "is that they speak comfortably."
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

    if scope.mode == "calibration":
        sections.append(_CALIBRATION_INSTRUCTIONS)
        return "\n\n".join(sections)

    if scope.mode == "free":
        if scope.cefr_level:
            sections.append(
                f"Pitch your vocabulary at CEFR {scope.cefr_level}. "
                "Stick close to that level; introducing at most one or two "
                "new words per session is fine when the context makes meaning clear."
            )
        return "\n\n".join(sections)

    # mode == "group"
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

    return "\n\n".join(sections)
