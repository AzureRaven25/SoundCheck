"""SoundCheck processing worker: turns uploaded originals into karaoke assets.

Consumes the `audio_processing` pgmq queue through the service-role RPCs (worker_claim_jobs /
worker_update_job / worker_finish_job), so it needs only SUPABASE_URL + SUPABASE_SECRET_KEY: no database
password. Runs anywhere with a GPU (Modal/RunPod in production; the Mac's Apple GPU in development).
All persistent results go to Supabase (Storage + tables); local files are temporary.

    karaoke-pipeline worker            # loop forever
    karaoke-pipeline worker --once     # process at most one job (tests, cron)
"""

from __future__ import annotations

import json
import os
import socket
import tempfile
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

import httpx
from urllib.parse import urlparse
import numpy as np

from . import __version__

PIPELINE_VERSION = f"karaoke-pipeline/{__version__}"


# Hosts the worker may download open-licensed originals from (acquire / open-music Edge Functions).
ALLOWED_HOSTS = ("archive.org", "api.audius.co", "storage.jamendo.com", "upload.wikimedia.org")


def _host_ok(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS)


def _public_host(host: str) -> bool:
    """False for literal private/loopback/link-local addresses and localhost names."""
    import ipaddress

    if not host or host == "localhost" or host.endswith(".localhost") or host.endswith(".internal"):
        return False
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return True
    return ip.is_global


def _positive(x: object) -> float | None:
    """Tempo/other measurements the database requires to be > 0: drums-free or beatless audio gives 0 or NaN."""
    try:
        v = float(x)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return v if v > 0 and v == v and v != float("inf") else None


def url_allowed(url: str) -> bool:
    u = urlparse(url)
    return u.scheme == "https" and _host_ok(u.hostname or "")


def redirect_allowed(start_host: str, final_url: str) -> bool:
    """Most sources must stay on the allow-list. Audius's API redirects to whichever content node holds the file,
    so from api.audius.co any public https host is accepted."""
    u = urlparse(final_url)
    if u.scheme != "https":
        return False
    host = u.hostname or ""
    if _host_ok(host):
        return True
    return start_host == "api.audius.co" and _public_host(host)


class Supabase:
    """Minimal service-role client (REST, RPC, Storage) over httpx."""

    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}
        self.http = httpx.Client(timeout=300, headers=self.h)

    def rpc(self, fn: str, args: dict):
        r = self.http.post(f"{self.url}/rest/v1/rpc/{fn}", json=args)
        r.raise_for_status()
        return r.json() if r.content else None

    def select(self, table: str, params: dict) -> list[dict]:
        r = self.http.get(f"{self.url}/rest/v1/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, rows: list[dict] | dict, upsert_on: str | None = None) -> list[dict]:
        prefer = "return=representation" + (",resolution=merge-duplicates" if upsert_on else "")
        params = {"on_conflict": upsert_on} if upsert_on else {}
        r = self.http.post(f"{self.url}/rest/v1/{table}", params=params, json=rows, headers={"Prefer": prefer})
        if r.is_error:  # keep PostgREST's reason (constraint name, bad value) in the job's error
            raise RuntimeError(f"insert into {table} failed ({r.status_code}): {r.text[:300]}")
        return r.json()

    def update(self, table: str, match: dict, values: dict) -> None:
        r = self.http.patch(f"{self.url}/rest/v1/{table}", params={k: f"eq.{v}" for k, v in match.items()}, json=values)
        r.raise_for_status()

    def download(self, bucket: str, path: str, dest: Path) -> None:
        with self.http.stream("GET", f"{self.url}/storage/v1/object/{bucket}/{path}") as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)

    def fetch_url(self, url: str, dest: Path) -> None:
        """Download an open-licensed original. Only allow-listed hosts: never an arbitrary URL from the queue."""
        if not url_allowed(url):
            raise ValueError(f"refusing to download from {urlparse(url).hostname or url!r}")
        start = urlparse(url).hostname or ""
        # an honest, descriptive User-Agent: Wikimedia's policy refuses generic HTTP-library agents
        headers = {"User-Agent": "SoundCheck/0.2 (karaoke pipeline; https://soundcheck-gules.vercel.app)"}
        with httpx.Client(follow_redirects=True, timeout=120, headers=headers) as c, c.stream("GET", url) as r:
            r.raise_for_status()
            final = str(r.url)
            if not redirect_allowed(start, final):
                raise ValueError(f"redirected off the allow-list to {urlparse(final).hostname!r}")
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        r = self.http.post(f"{self.url}/storage/v1/object/{bucket}/{path}", content=data,
                           headers={"Content-Type": content_type, "x-upsert": "true"})
        r.raise_for_status()

    def invoke(self, fn: str, body: dict) -> dict:
        r = self.http.post(f"{self.url}/functions/v1/{fn}", json=body)
        r.raise_for_status()
        return r.json()


@dataclass
class Job:
    msg_id: int
    job_id: str
    asset_id: str
    track_id: str
    storage_path: str | None
    external_url: str | None = None


def _stage(sb: Supabase, job: Job, stage: str, progress: float) -> None:
    print(f"  [{job.job_id[:8]}] {stage} ({progress:.0%})", flush=True)
    sb.rpc("worker_update_job", {"p_job_id": job.job_id, "p_stage": stage, "p_progress": progress})


def _lyric_lines(sb: Supabase, track_id: str) -> list[dict] | None:
    """Line-synced lyrics for the track (fetching them from LRCLIB on demand)."""
    rows = sb.select("lyrics", {"track_id": f"eq.{track_id}", "select": "provider,granularity,content", "order": "is_primary.desc"})
    synced = [r for r in rows if r["granularity"] in ("line", "word") and r["provider"] != "aligned"]
    if not synced:
        try:
            got = sb.invoke("fetch-lyrics", {"track_id": track_id})
            if got.get("granularity") in ("line", "word"):
                return got["lines"]
        except httpx.HTTPError:
            return None
        return None
    return synced[0]["content"]["lines"]


def process(sb: Supabase, job: Job, model: str = "htdemucs", crepe_model: str = "full", asr_model: str = "small") -> str:
    """Run the full pipeline for one job. Returns the karaoke_analysis id."""
    from .analysis import analyze
    from .alignment import add_word_timing
    from .audio_io import SAMPLE_RATE, encode_aac, load_audio
    from .melody import extract_melody
    from .separate import separate
    from .structure import phrases_from_gaps, phrases_from_lines, split_repeated_notes

    asset = sb.select("audio_assets", {"id": f"eq.{job.asset_id}", "select": "id,owner_id,track_id,provider"})[0]
    owner_folder = asset["owner_id"] or "shared"
    base = f"{owner_folder}/{job.track_id}/{job.asset_id}"

    with tempfile.TemporaryDirectory(prefix="soundcheck-") as td:
        tmp = Path(td)
        _stage(sb, job, "download", 0.05)
        if job.storage_path:
            src = tmp / ("original" + Path(job.storage_path).suffix)
            sb.download("audio", job.storage_path, src)
        elif job.external_url:
            src = tmp / ("original" + (Path(urlparse(job.external_url).path).suffix or ".mp3"))
            sb.fetch_url(job.external_url, src)
        else:
            raise ValueError("job has neither a storage path nor a source URL")
        audio = load_audio(src, SAMPLE_RATE)
        duration_ms = int(audio.shape[1] / SAMPLE_RATE * 1000)
        if asset.get("provider") == "internet_archive":
            # archive metadata lengths can be seconds off (VBR MP3s); record the decoded duration
            sb.update("tracks", {"id": job.track_id}, {"duration_ms": duration_ms})
            sb.update("track_sources", {"track_id": job.track_id, "provider": "internet_archive"}, {"duration_ms": duration_ms})
            sb.update("audio_assets", {"id": job.asset_id}, {"duration_ms": duration_ms})

        _stage(sb, job, "separate", 0.15)
        stems = separate(audio, SAMPLE_RATE, model_name=model)

        _stage(sb, job, "melody", 0.5)
        melody = extract_melody(stems.vocals, SAMPLE_RATE, crepe_model=crepe_model)
        notes = split_repeated_notes(melody["notes"], stems.vocals, SAMPLE_RATE)

        _stage(sb, job, "lyrics", 0.65)
        lines = _lyric_lines(sb, job.track_id)
        word_stats = None
        lyrics_source = None
        if lines:
            _stage(sb, job, "align", 0.7)
            lines, word_stats = add_word_timing(lines, stems.vocals, SAMPLE_RATE, notes)
            lyrics_source = "lrclib"
        elif asr_model != "none":
            # no published lyrics (indie / open-licensed / your own recordings): transcribe the vocal stem
            _stage(sb, job, "transcribe", 0.7)
            from .transcribe import transcribe_vocals

            heard = transcribe_vocals(stems.vocals, SAMPLE_RATE, model_size=asr_model)
            if heard:
                lines, language = heard
                word_stats = {"aligned": len(lines), "fallback": 0}
                lyrics_source = f"transcribed:{language or 'unknown'}"
        phrases = phrases_from_lines(lines, notes) if lines else phrases_from_gaps(notes)

        _stage(sb, job, "analyze", 0.8)
        info = analyze(stems.instrumental, SAMPLE_RATE)

        _stage(sb, job, "upload", 0.85)
        for kind, data in (("instrumental", stems.instrumental), ("vocals", stems.vocals)):
            out = tmp / f"{kind}.m4a"
            encode_aac(data, out)
            sb.upload("audio", f"{base}/{kind}.m4a", out.read_bytes(), "audio/mp4")
        contour = {"hop": melody["hop"], "contour": melody["contour"]}
        sb.upload("audio", f"{base}/contour.json", json.dumps(contour, separators=(",", ":")).encode(), "application/json")

        for kind in ("instrumental", "vocals"):
            existing = sb.select("audio_assets", {"source_asset_id": f"eq.{job.asset_id}", "kind": f"eq.{kind}", "select": "id"})
            if not existing:
                sb.insert("audio_assets", {
                    "track_id": job.track_id, "owner_id": asset["owner_id"], "kind": kind, "provider": "pipeline",
                    "storage_path": f"{base}/{kind}.m4a", "source_asset_id": job.asset_id, "mime_type": "audio/mp4",
                    "duration_ms": duration_ms, "bitrate_kbps": 256,
                })

        analysis = sb.insert("karaoke_analysis", {
            "track_id": job.track_id, "source_asset_id": job.asset_id, "pipeline_version": PIPELINE_VERSION,
            "separation_model": stems.model, "pitch_model": f"crepe-{crepe_model}",
            "musical_key": info["key"]["name"], "tempo_bpm": _positive(info["tempo_bpm"]), "vocal_range": melody["range"],
            "notes": [{**n, "conf": 1.0} for n in notes], "phrases": phrases, "contour_path": f"{base}/contour.json",
            # word timing is specific to this upload's audio, so it lives on the analysis (not the shared lyrics)
            "word_lyrics": {"lines": lines, "source": lyrics_source} if lines and word_stats and word_stats["aligned"] else None,
        }, upsert_on="source_asset_id")[0]
        sb.update("audio_assets", {"id": job.asset_id}, {"duration_ms": duration_ms})
        return analysis["id"]


def run(once: bool = False, poll_seconds: float = 5.0, visibility: int = 1800, **kw) -> int:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")
    sb = Supabase(url, key)
    worker = f"{socket.gethostname()}:{os.getpid()}"
    done = 0
    print(f"worker {worker} polling {url}", flush=True)
    while True:
        claimed = sb.rpc("worker_claim_jobs", {"p_worker": worker, "p_visibility_seconds": visibility, "p_qty": 1}) or []
        if not claimed:
            if once:
                return done
            time.sleep(poll_seconds)
            continue
        msg = claimed[0]
        j = msg["job"]
        job = Job(msg["msg_id"], j["job_id"], j["asset_id"], j["track_id"], j.get("storage_path"), j.get("external_url"))
        t0 = time.perf_counter()
        print(f"job {job.job_id} (track {job.track_id}, attempt {msg['read_ct']})", flush=True)
        try:
            process(sb, job, **kw)
            sb.rpc("worker_finish_job", {"p_msg_id": job.msg_id, "p_job_id": job.job_id, "p_ok": True, "p_error": None})
            print(f"  done in {time.perf_counter() - t0:.0f}s", flush=True)
        except Exception as e:  # record the failure on the job so the user sees it; keep the worker alive
            traceback.print_exc()
            sb.rpc("worker_finish_job", {"p_msg_id": job.msg_id, "p_job_id": job.job_id, "p_ok": False,
                                         "p_error": f"{type(e).__name__}: {e}"[:500]})
        done += 1
        if once:
            return done
