import json

from conftest import gid
from karaoke_catalog.turso_export import SqliteExecutor, _hrana_value, export, match_query, search
from test_supabase_sync import run_ranked_subset
from karaoke_catalog.importer import load_staging


def test_match_query_is_safe_and_prefixes_last_word():
    assert match_query("Stand by Me") == '"stand" "by" "me"*'
    assert match_query('a" OR title:x') == '"a" "or" "title" "x"'
    assert match_query("!!!") == ""


def test_hrana_values():
    assert _hrana_value(None) == {"type": "null"}
    assert _hrana_value(3) == {"type": "integer", "value": "3"}
    assert _hrana_value("x") == {"type": "text", "value": "x"}


def test_export_and_search_long_tail(conn, fake_dump):
    load_staging(conn, fake_dump)
    run_ranked_subset(conn)
    ex = SqliteExecutor()
    assert export(conn, ex, 1, 100, log=lambda *_: None) == 4
    rows = ex.execute_many([("select id, album_id, credits, recordings, isrcs from songs where id = ?", (gid(101),))])[0]
    _, album_id, credits, recordings, isrcs = rows[0]
    assert album_id == gid(500_000 + 501)
    assert json.loads(credits)[0]["artist_id"] == gid(1)
    assert set(json.loads(recordings)) == {gid(101), gid(102)}
    hits = search(ex, "midnight sig")
    assert [h[3] for h in hits] == ["Aurora Vale", "The Night Owls"]       # popularity order
    assert search(ex, "zoe lantern")[0][2] == "Paper Lanterns"              # diacritics removed
    assert export(conn, ex, 1, 100, log=lambda *_: None) == 4               # re-export is idempotent
    assert ex.execute_many([("select count(*) from songs", ())])[0][0][0] == 4
