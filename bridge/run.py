from __future__ import annotations

import argparse
import json

from openpod_bridge.pipeline import make_shorts


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenPod short-form prototype")
    parser.add_argument("media", help="Path to a long-form podcast video")
    parser.add_argument("--count", type=int, default=5, help="Number of clips to render")
    args = parser.parse_args()
    result = make_shorts(args.media, count=args.count)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
