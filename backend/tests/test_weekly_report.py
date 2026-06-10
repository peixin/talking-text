"""Pure-function tests for the weekly report (tagging + tokenization).

The DB-walking part of ``weekly_new_words`` needs the Postgres test fixture
(still a TODO in CLAUDE.md).
"""

from app.core.report import TAG_CURRICULUM, TAG_STRETCH, TAG_WILD, tag_word
from app.core.text import tokenize_words


def test_stretch_beats_curriculum():
    # Next-unit words are usually also inside the assigned tree — stretch wins.
    assert tag_word("fox", {"fox"}, {"fox", "red"}) == TAG_STRETCH


def test_curriculum_when_not_stretch():
    assert tag_word("red", {"fox"}, {"fox", "red"}) == TAG_CURRICULUM


def test_wild_when_unknown():
    assert tag_word("dinosaur", {"fox"}, {"red"}) == TAG_WILD


def test_tokenize_lowercases_and_keeps_contractions():
    assert tokenize_words("I DON'T like it!") == ["i", "don't", "like", "it"]


def test_tokenize_drops_digits_and_punctuation():
    assert tokenize_words("2 cats, 3 dogs...") == ["cats", "dogs"]
