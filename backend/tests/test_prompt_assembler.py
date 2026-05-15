from app.core.prompt.assembler import _TINA_PERSONA, build_system_prompt
from app.core.scope.protocol import PatternItem, ScopeResult


def test_empty_scope_returns_persona_and_nudges():
    # Default mode is "free" with no cefr_level → persona + nudges.
    result = build_system_prompt(ScopeResult())
    assert result.startswith(_TINA_PERSONA)
    assert "Subtle nudges" in result


def test_calibration_mode_appends_calibration_instructions():
    result = build_system_prompt(ScopeResult(mode="calibration"))
    assert result.startswith(_TINA_PERSONA)
    assert "FIRST conversation" in result
    assert "CEFR" not in result  # no level hint in calibration mode
    assert "Subtle nudges" not in result  # nudges suppressed during calibration


def test_free_mode_with_cefr_level_appends_level_hint():
    result = build_system_prompt(ScopeResult(mode="free", cefr_level="A1"))
    assert "CEFR A1" in result
    assert "Subtle nudges" in result


def test_group_mode_words_appear_in_vocab_section():
    scope = ScopeResult(mode="group", words=["red", "blue"], phrases=[])
    result = build_system_prompt(scope)
    assert "Words: red, blue" in result
    assert "The child has learned" in result


def test_group_mode_phrases_appear_in_vocab_section():
    scope = ScopeResult(mode="group", phrases=["draw and color"])
    result = build_system_prompt(scope)
    assert "Phrases: draw and color" in result


def test_group_mode_patterns_appear_in_patterns_section():
    scope = ScopeResult(
        mode="group",
        patterns=[PatternItem(text="I like ___ and ___.", anchor="i like")],
    )
    result = build_system_prompt(scope)
    assert '"I like ___ and ___."' in result
    assert "Practice these sentence patterns" in result


def test_group_mode_prompt_notes_appear():
    scope = ScopeResult(mode="group", prompt_notes="Use 'has' for he/she.")
    result = build_system_prompt(scope)
    assert "Grammar notes" in result
    assert "Use 'has' for he/she." in result


def test_group_mode_sections_separated_by_double_newline():
    scope = ScopeResult(mode="group", words=["red"], prompt_notes="Use has.")
    result = build_system_prompt(scope)
    assert "\n\n" in result


def test_persona_always_first():
    scope = ScopeResult(
        mode="group", words=["red"], patterns=[PatternItem("I like ___.", "i like")]
    )
    result = build_system_prompt(scope)
    assert result.startswith(_TINA_PERSONA)


def test_custom_persona_prompt_replaces_tina_persona():
    scope = ScopeResult()
    result = build_system_prompt(scope, persona_prompt="You are Bob, a friendly tutor.")
    assert result.startswith("You are Bob, a friendly tutor.")
    assert "Tina" not in result
    assert "Subtle nudges" in result  # free mode still appends nudges


def test_learner_name_injected_after_persona():
    result = build_system_prompt(ScopeResult(), learner_name="Emma")
    assert "Emma" in result
    persona_pos = result.index(_TINA_PERSONA)
    name_pos = result.index("Emma")
    assert name_pos > persona_pos


def test_learner_name_with_custom_persona():
    scope = ScopeResult(mode="group", words=["red"])
    result = build_system_prompt(
        scope,
        persona_prompt="You are Lily, a kind teacher.",
        learner_name="Tom",
    )
    assert "Lily" in result
    assert "Tom" in result
    assert "red" in result


def test_no_learner_name_no_name_section():
    result = build_system_prompt(ScopeResult())
    assert "child's name is" not in result


def test_custom_persona_with_group_scope():
    scope = ScopeResult(
        mode="group",
        words=["blue"],
        patterns=[PatternItem("I see ___.", "i see")],
    )
    result = build_system_prompt(
        scope,
        persona_prompt="You are Max, a cool teacher.",
        learner_name="Lily",
    )
    assert "You are Max" in result
    assert "Lily" in result
    assert "blue" in result
    assert '"I see ___."' in result
