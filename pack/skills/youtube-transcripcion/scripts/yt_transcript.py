#!/usr/bin/env python3
"""Obtiene metadatos y transcripcion de un video de YouTube.

Uso:
  yt_transcript.py URL_O_ID [--langs es,en,pt] [--list] [--timestamps] [--json]

Sin dependencias mas que youtube-transcript-api y yt-dlp (pip install).
Imprime metadatos + texto; con --json devuelve todo estructurado.
"""
import argparse
import json
import re
import subprocess
import sys

URL_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_video_id(s):
    s = s.strip()
    m = URL_RE.search(s)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    raise SystemExit("No pude interpretar la URL/ID: " + repr(s))


def get_meta(video_id):
    """Metadatos via yt-dlp. Falla blando: devuelve solo el id si no hay red/yt-dlp."""
    try:
        out = subprocess.run(
            [
                "yt-dlp", "--skip-download", "--no-warnings",
                "--print",
                "%(title)s\t%(channel)s\t%(duration_string)s\t%(upload_date)s\t%(view_count)s",
                "https://www.youtube.com/watch?v=" + video_id,
            ],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0 and out.stdout.strip():
            title, channel, dur, up, views = out.stdout.strip().split("\t")
            return {
                "id": video_id, "title": title, "channel": channel,
                "duration": dur, "upload_date": up, "views": views,
                "url": "https://www.youtube.com/watch?v=" + video_id,
            }
    except Exception:
        pass
    return {"id": video_id, "url": "https://www.youtube.com/watch?v=" + video_id}


def get_tracks(video_id):
    from youtube_transcript_api import YouTubeTranscriptApi

    api = YouTubeTranscriptApi()
    try:
        listing = api.list(video_id)
    except Exception as e:
        raise SystemExit("ERROR transcript: %s: %s" % (type(e).__name__, str(e)[:300]))
    tracks = []
    for t in listing:
        tracks.append({
            "language": t.language,
            "language_code": t.language_code,
            "kind": "auto" if t.is_generated else "manual",
            "translatable": t.is_translatable,
        })
    return listing, tracks


def fetch_transcript(listing, langs):
    last_err = None
    for lang in langs:
        try:
            tr = listing.find_transcript([lang])
        except Exception as e:
            last_err = e
            continue
        tr = tr.fetch()
        segs = tr.to_raw_data()
        return {
            "language": tr.language,
            "language_code": tr.language_code,
            "kind": "auto" if tr.is_generated else "manual",
            "segments": segs,
            "text": " ".join(s["text"].replace("\n", " ") for s in segs).strip(),
            "duration_s": round(segs[-1]["start"] + segs[-1]["duration"]) if segs else 0,
        }
    raise SystemExit("Sin transcript para idiomas %s. Ultimo error: %s" % (langs, last_err))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("url", help="URL de YouTube o video ID")
    p.add_argument("--langs", default="es,en,pt",
                   help="idiomas preferidos, separados por coma (default: es,en,pt)")
    p.add_argument("--list", action="store_true",
                   help="solo listar pistas de subtitulos")
    p.add_argument("--timestamps", action="store_true",
                   help="incluir marcas de tiempo")
    p.add_argument("--json", action="store_true", help="salida JSON completa")
    a = p.parse_args()

    vid = extract_video_id(a.url)
    meta = get_meta(vid)
    listing, tracks = get_tracks(vid)

    if a.list:
        if a.json:
            print(json.dumps({"meta": meta, "tracks": tracks},
                             ensure_ascii=False, indent=2))
        else:
            print("Video: {} ({})".format(meta.get("title", "?"),
                                          meta.get("duration", "?")))
            print("Pistas disponibles:")
            for t in tracks:
                print("  {:5} {:6} {}".format(
                    t["language_code"], t["kind"],
                    "translatable" if t["translatable"] else ""))
        return

    langs = [x.strip() for x in a.langs.split(",") if x.strip()]
    # agregar cualquier pista manual disponible como candidata final
    for t in tracks:
        if t["kind"] == "manual" and t["language_code"] not in langs:
            langs.append(t["language_code"])
    tr = fetch_transcript(listing, langs)

    if a.timestamps:
        lines = []
        for s in tr["segments"]:
            m, sec = divmod(int(s["start"]), 60)
            lines.append("[%02d:%02d] %s" % (m, sec, s["text"].replace("\n", " ")))
        tr["timed_text"] = "\n".join(lines)

    if a.json:
        print(json.dumps({"meta": meta, "tracks": tracks, "transcript": tr},
                         ensure_ascii=False))
        return

    ts = tr["timed_text"] if a.timestamps else tr["text"]
    dur = meta.get("duration", str(tr["duration_s"]) + "s")
    print("# " + meta.get("title", tr["language"]))
    print("Canal: {} | Duracion: {} | {}".format(
        meta.get("channel", "?"), dur, meta.get("url")))
    print("Transcript: {} ({})".format(tr["language_code"], tr["kind"]))
    print("")
    print(ts)


if __name__ == "__main__":
    main()
