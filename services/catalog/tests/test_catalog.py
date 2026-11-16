import json
from pathlib import Path

import pytest

from conftest import gid
from karaoke_catalog.importer import import_musicbrainz, load_staging
from karaoke_catalog.library import clean_title, link_library, relink_all
from karaoke_catalog.search import search, to_prefix_tsquery


def songs(conn):
    return {(t, a): (i, rc, d) for i, t, a, rc, d in conn.execute(
        "SELECT id, title, artist_name, release_count, first_release_date FROM catalog.song")}


def test_import_applies_eligibility_rules(imported):
    s = songs(imported)
    assert set(s) == {
        ("Midnight Signal", "Aurora Vale"),
        ("Midnight Signal", "The Night Owls"),
        ("Paper Lanterns", "Zoë Marlowe"),
        ("Static Hearts", "Aurora Vale & The Night Owls"),
    }  # live, instrumental, bootleg-only and video recordings are gone


def test_remasters_collapse_into_one_song(imported):
    song_id, release_count, first_date = songs(imported)[("Midnight Signal", "Aurora Vale")]
    assert song_id == 101            # earliest recording represents the song
    assert release_count == 2         # album + compilation
    assert first_date == 20150302
    mapped = {r[0] for r in imported.execute(
        "SELECT recording_mbid::text FROM catalog.song_recording WHERE song_id = 101")}
    assert mapped == {gid(101), gid(102)}  # not the live recording 103


def test_unknown_country_dates_and_isrcs_and_artists(imported):
    song_id, _, first_date = songs(imported)[("Paper Lanterns", "Zoë Marlowe")]
    assert first_date == 20180504
    assert imported.execute("SELECT song_id FROM catalog.song_isrc WHERE isrc = 'USABC1800001'").fetchone()[0] == song_id
    duet = songs(imported)[("Static Hearts", "Aurora Vale & The Night Owls")][0]
    assert [r[0] for r in imported.execute(
        "SELECT a.name FROM catalog.song_artist sa JOIN catalog.artist a ON a.id = sa.artist_id "
        "WHERE sa.song_id = %s ORDER BY position", (duet,))] == ["Aurora Vale", "The Night Owls"]
    assert imported.execute("SELECT count(*) FROM pg_namespace WHERE nspname = 'mb'").fetchone()[0] == 0


def test_search_prefix_ranking_and_accents(imported):
    hits = search(imported, "midnight sig")
    assert [(h.title, h.artist_name) for h in hits] == [
        ("Midnight Signal", "Aurora Vale"),      # more releases ranks first
        ("Midnight Signal", "The Night Owls"),
    ]
    assert hits[0].year == 2015 and hits[0].cover_url.endswith("/front-250")
    assert [h.title for h in search(imported, "zoe lanterns")] == ["Paper Lanterns"]
    assert [h.title for h in search(imported, "night owls static")] == ["Static Hearts"]


def test_search_fuzzy_fallback_for_typos(imported):
    hits = search(imported, "midnite signall")
    assert hits and hits[0].title == "Midnight Signal"


def _bundle(root: Path, bundle_id: str, **meta) -> None:
    d = root / bundle_id
    d.mkdir(parents=True)
    (d / "meta.json").write_text(json.dumps({"id": bundle_id, **meta}))


def test_link_library_methods_and_relink_after_reimport(imported, fake_dump, tmp_path):
    lib = tmp_path / "library"
    _bundle(lib, "a-mbid", title="whatever", artist="x", duration=201.0, musicbrainz_recording_id=gid(102))
    _bundle(lib, "b-isrc", title="Paper Lanterns", artist="Zoe Marlowe", duration=185.0, isrc="US-ABC-18-00001")
    _bundle(lib, "c-exact", title="Midnight Signal (2021 Remaster)", artist="aurora vale", duration=199.5)
    _bundle(lib, "d-fuzzy", title="Static Heart", artist="Aurora Vale and The Night Owls", duration=221.0)
    _bundle(lib, "e-unknown", title="Not A Real Song", artist="Nobody", duration=100.0)
    (lib / "c-exact" / "lyrics.json").write_text("{}")

    results = dict(link_library(imported, lib))
    assert (results["a-mbid"].song_id, results["a-mbid"].method) == (101, "recording_mbid")
    assert results["b-isrc"].method == "isrc"
    assert (results["c-exact"].song_id, results["c-exact"].method) == (101, "exact")
    assert results["d-fuzzy"].method == "fuzzy" and results["d-fuzzy"].song_id == 109
    assert results["e-unknown"].song_id is None

    assert [h.bundle_id for h in search(imported, "midnight", available_only=True)] == ["a-mbid"]
    assert imported.execute("SELECT has_lyrics FROM catalog.library_item WHERE bundle_id = 'c-exact'").fetchone()[0]

    # Wishlist + library links survive a full re-import.
    imported.execute("INSERT INTO catalog.wishlist (recording_mbid) VALUES (%s::uuid)", (gid(108),))
    imported.commit()
    import_musicbrainz(imported, fake_dump)
    assert relink_all(imported) == 5
    assert imported.execute("SELECT song_id FROM catalog.library_item WHERE bundle_id = 'c-exact'").fetchone()[0] == 101
    assert imported.execute("SELECT count(*) FROM catalog.wishlist").fetchone()[0] == 1


def test_schema_drift_is_detected(conn, fake_dump, tmp_path):
    broken = tmp_path / "broken"
    (broken / "mbdump").mkdir(parents=True)
    for f in (fake_dump / "mbdump").iterdir():
        text = f.read_text()
        if f.name == "recording":
            text = text.replace("\n", "\textra_new_column\n")
        (broken / "mbdump" / f.name).write_text(text)
    with pytest.raises(RuntimeError, match="schema changed"):
        load_staging(conn, broken)


@pytest.mark.parametrize("text,expected", [
    ("bohemian rhaps", "bohemian & rhaps:*"),
    ("  Queen ", "queen:*"),
    ("a", "a"),
    ("it's a test!", "it & s & a & test:*"),
    ("'; drop table --", "drop & table:*"),
    ("", None),
])
def test_to_prefix_tsquery(text, expected):
    assert to_prefix_tsquery(text) == expected


def test_clean_title():
    assert clean_title("Song (2011 Remaster)") == "Song"
    assert clean_title("Song - Remastered 2009") == "Song"
    assert clean_title("Song [Mono]") == "Song"
    assert clean_title("Song (Live Wire)") == "Song (Live Wire)"
