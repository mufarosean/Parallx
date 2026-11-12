"""The document reader's self-test, run once at the end of setting it up.

It lays the model files out, then reads a small page it draws itself, as a
scan (from the pixels), and checks that the words and their boxes come back.
Nothing is fetched: a missing file fails here, not on the user's first PDF.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def main() -> int:
    from PIL import Image, ImageDraw, ImageFont

    from parallx_docling import server

    if not server.lay_out_models():
        print("The model files are not in place.", file=sys.stderr)
        return 1

    page = Image.new("RGB", (1240, 700), "white")
    draw = ImageDraw.Draw(page)
    try:
        font = ImageFont.truetype("arial.ttf", 44)
    except OSError:
        font = ImageFont.load_default(size=44)
    draw.text((90, 120), "Parallx reads this page.", fill="black", font=font)
    draw.text((90, 220), "The ultimate loss is 1,250.", fill="black", font=font)

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "selftest.png"
        page.save(path)
        out = server._convert_document(str(path), ocr=True)

    text = out["markdown"].lower()
    first = (out.get("reading") or {}).get("pages", [{}])[0]
    lines = first.get("lines", [])
    placed = first.get("page") == 1 and first.get("width", 0) > 0 and first.get("height", 0) > 0
    ok = "parallx" in text and "1,250" in text and placed and len(lines) >= 2 and all(len(l["box"]) == 4 for l in lines)
    print(json.dumps({"ok": ok, "lines": len(lines), "ms": out["elapsed_ms"]}))
    if not ok:
        print(f"The reader ran but did not read its test page: {out['markdown'][:200]!r}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
