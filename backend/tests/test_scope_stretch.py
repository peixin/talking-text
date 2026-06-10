"""Pure-function tests for scope V2 stretch selection and sibling ordering.

DB-backed tests for V2ScopeComputer / next_sibling_group_id need the Postgres
test fixture (still a TODO in CLAUDE.md); these lock the pure parts.
"""

from app.core.scope.siblings import natural_sort_key, sibling_sort_key
from app.core.scope.v2 import select_stretch_words

BASE = ["red", "blue", "green", "yellow", "black", "white", "pink", "brown", "orange", "tall"]


def test_natural_sort_orders_numbered_units():
    names = ["Unit 10", "Unit 2", "Unit 1"]
    assert sorted(names, key=natural_sort_key) == ["Unit 1", "Unit 2", "Unit 10"]


def test_natural_sort_is_case_insensitive():
    assert natural_sort_key("UNIT 3") == natural_sort_key("unit 3")


def test_position_wins_over_name():
    # position NULLS LAST: explicit positions sort before name-ordered rest.
    rows = [(None, "Unit 1"), (1, "Zebra"), (None, "Apple"), (0, "Unit 9")]
    ordered = sorted(rows, key=lambda r: sibling_sort_key(r[0], r[1]))
    assert [r[1] for r in ordered] == ["Unit 9", "Zebra", "Apple", "Unit 1"]


def test_budget_is_ratio_of_base_capped():
    # 10 base words * 0.10 → 1 word.
    picked = select_stretch_words(["cat", "dog", "fox"], BASE, {}, ratio=0.10, max_words=8, seed=42)
    assert len(picked) == 1
    # Cap applies when the ratio would allow more.
    picked = select_stretch_words(["cat", "dog", "fox"], BASE, {}, ratio=1.0, max_words=2, seed=42)
    assert len(picked) == 2


def test_zero_ratio_or_empty_base_yields_nothing():
    assert select_stretch_words(["cat"], BASE, {}, ratio=0.0, max_words=8, seed=1) == []
    assert select_stretch_words(["cat"], [], {}, ratio=0.10, max_words=8, seed=1) == []


def test_base_words_and_mastered_words_are_excluded():
    stats = {"dog": (5, True)}  # mastered → never stretch
    picked = select_stretch_words(
        ["red", "dog", "fox"], BASE, stats, ratio=1.0, max_words=8, seed=7
    )
    assert picked == ["fox"]  # "red" is base, "dog" is mastered


def test_glimpsed_words_come_before_unseen():
    stats = {"fox": (2, False)}  # glimpsed but not mastered
    picked = select_stretch_words(
        ["cat", "dog", "fox"], BASE, stats, ratio=1.0, max_words=8, seed=3
    )
    assert picked[0] == "fox"


def test_selection_is_deterministic_per_seed_and_rotates_across_seeds():
    candidates = [f"word{i}" for i in range(30)]
    a1 = select_stretch_words(candidates, BASE, {}, ratio=0.5, max_words=5, seed=111)
    a2 = select_stretch_words(candidates, BASE, {}, ratio=0.5, max_words=5, seed=111)
    assert a1 == a2  # same session → same words every turn
    b = select_stretch_words(candidates, BASE, {}, ratio=0.5, max_words=5, seed=222)
    assert a1 != b  # different session → rotation


def test_candidates_deduped_case_insensitively():
    picked = select_stretch_words(["Fox", "fox", "FOX"], BASE, {}, ratio=1.0, max_words=8, seed=5)
    assert picked == ["Fox"]
