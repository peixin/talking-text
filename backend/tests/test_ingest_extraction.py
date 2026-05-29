"""Unit tests for the pure parsing/normalization helpers in app.api.ingest.

These lock in the contract established 2026-05-30 (docs/content-lifecycle.md §8):
extraction returns items + a suggested name + CEFR only — it never infers
hierarchy placement, so the parsed metadata carries no levels/parent_id.
"""

from app.api.ingest import (
    ExtractedItem,
    ExtractedMetadata,
    IngestionResult,
    _dedupe_items,
    _looks_english,
    _normalize_anchor,
    _parse_extraction,
)

# ── _looks_english ────────────────────────────────────────────────────────────


def test_looks_english_accepts_ascii_words_and_punctuation():
    assert _looks_english("hello world")
    assert _looks_english("by the way")
    assert _looks_english("I like ___.")


def test_looks_english_rejects_chinese_and_accents():
    assert not _looks_english("苹果")
    assert not _looks_english("café")  # non-ASCII accent


# ── _normalize_anchor ──────────────────────────────────────────────────────────


def test_normalize_anchor_word_defaults_to_lowercased_text():
    item = ExtractedItem(text="Apple", type="word")
    assert _normalize_anchor(item).anchor == "apple"


def test_normalize_anchor_pattern_derives_from_text_blanks_collapsed():
    item = ExtractedItem(text="I like ___", type="pattern")
    assert _normalize_anchor(item).anchor == "i like"


def test_normalize_anchor_preserves_explicit_anchor():
    item = ExtractedItem(text="look after", type="phrase", anchor="look after")
    assert _normalize_anchor(item).anchor == "look after"


# ── _dedupe_items ──────────────────────────────────────────────────────────────


def test_dedupe_filters_non_english_items():
    items = [
        ExtractedItem(text="apple", type="word"),
        ExtractedItem(text="苹果", type="word"),
    ]
    out = _dedupe_items(items)
    assert [i.text for i in out] == ["apple"]


def test_dedupe_collapses_duplicate_type_text_pairs():
    items = [
        ExtractedItem(text="run", type="word"),
        ExtractedItem(text="run", type="word"),
        ExtractedItem(text="run", type="phrase"),  # different type → kept
    ]
    out = _dedupe_items(items)
    assert len(out) == 2
    assert {(i.type, i.text) for i in out} == {("word", "run"), ("phrase", "run")}


def test_dedupe_normalizes_anchor_on_kept_items():
    items = [ExtractedItem(text="Blue", type="word")]
    assert _dedupe_items(items)[0].anchor == "blue"


# ── _parse_extraction ──────────────────────────────────────────────────────────


def test_parse_extraction_reads_new_metadata_shape():
    raw = (
        '{"source_type": "flashcards", '
        '"metadata": {"suggested_name": "Animals", "cefr_level": "A1", "confidence": "high"}, '
        '"items": [{"text": "cat", "type": "word"}], "warnings": []}'
    )
    result = _parse_extraction(raw)
    assert isinstance(result, IngestionResult)
    assert result.metadata.suggested_name == "Animals"
    assert result.metadata.cefr_level == "A1"
    assert result.items[0].text == "cat"
    assert result.items[0].anchor == "cat"  # normalized


def test_parse_extraction_strips_json_code_fence():
    raw = '```json\n{"metadata": {"suggested_name": "Colors"}, "items": []}\n```'
    result = _parse_extraction(raw)
    assert result.metadata.suggested_name == "Colors"


def test_parse_extraction_dedupes_items():
    raw = (
        '{"metadata": {}, "items": ['
        '{"text": "red", "type": "word"}, {"text": "red", "type": "word"}]}'
    )
    result = _parse_extraction(raw)
    assert len(result.items) == 1


def test_parse_extraction_metadata_carries_no_hierarchy_fields():
    """Regression guard: extraction is not a librarian (content-lifecycle.md §8)."""
    raw = '{"metadata": {"suggested_name": "X"}, "items": []}'
    result = _parse_extraction(raw)
    for forbidden in ("levels", "parent_id", "book_name", "unit", "lesson", "kind_label"):
        assert not hasattr(result.metadata, forbidden), f"metadata should not expose {forbidden}"


def test_parse_extraction_tolerates_absent_metadata():
    result = _parse_extraction('{"items": []}')
    assert result.metadata == ExtractedMetadata()
    assert result.metadata.suggested_name is None
