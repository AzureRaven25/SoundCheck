"""KaraokeApp HTTP API."""


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(prog="karaoke-api")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 so a Fire TV / phone on your Wi-Fi can reach it")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    uvicorn.run("karaoke_api.app:app", host=args.host, port=args.port, reload=args.reload)
