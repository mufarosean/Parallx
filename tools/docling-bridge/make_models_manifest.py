"""Write models.json: every model file the reader needs, pinned.

A maintenance script, run by hand when Docling is upgraded, not by the app:

    python make_models_manifest.py <artifacts dir made by docling's downloader>

For each file the reader loads it records where the app fetches it (a pinned
revision, never a moving branch), its size, its SHA-256, the flat name the
runtime keeps it under and the path the reader expects it at. The revisions
below are the ones Docling's own downloader resolved when the lock file was
made; change them together with the lock.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HF = "https://huggingface.co"
MODELSCOPE = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0"

# folder in the artifacts dir -> (address prefix, the files the reader loads)
SOURCES = {
    "docling-project--docling-layout-heron": (
        f"{HF}/docling-project/docling-layout-heron/resolve/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8",
        ["config.json", "model.safetensors", "preprocessor_config.json"],
    ),
    "docling-project--docling-models": (
        f"{HF}/docling-project/docling-models/resolve/fc0f2d45e2218ea24bce5045f58a389aed16dc23",
        [
            "config.json",
            "model_artifacts/tableformer/accurate/tableformer_accurate.safetensors",
            "model_artifacts/tableformer/accurate/tm_config.json",
            "model_artifacts/tableformer/fast/tableformer_fast.safetensors",
            "model_artifacts/tableformer/fast/tm_config.json",
        ],
    ),
    "docling-project--CodeFormulaV2": (
        f"{HF}/docling-project/CodeFormulaV2/resolve/ecedbe111d15c2dc60bfd4a823cbe80127b58af4",
        [
            "added_tokens.json", "chat_template.json", "config.json", "generation_config.json",
            "model.safetensors", "preprocessor_config.json", "processor_config.json",
            "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "vocab.json",
        ],
    ),
}
RAPIDOCR = {
    "RapidOcr/PP-OCRv6_det_small.onnx": f"{MODELSCOPE}/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
    "RapidOcr/PP-OCRv6_rec_small.onnx": f"{MODELSCOPE}/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
    "RapidOcr/ch_ppocr_mobile_v2.0_cls_mobile.onnx": f"{MODELSCOPE}/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "RapidOcr/ppocrv6_dict.txt": f"{MODELSCOPE}/paddle/PP-OCRv6/rec/PP-OCRv6_rec_small/ppocrv6_dict.txt",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    root = Path(sys.argv[1])
    entries = []
    wanted = [(f"{folder}/{rel}", f"{prefix}/{rel}") for folder, (prefix, files) in SOURCES.items() for rel in files]
    wanted += list(RAPIDOCR.items())
    for rel, url in wanted:
        p = root / rel
        if not p.is_file():
            raise SystemExit(f"missing: {rel}")
        # Flat, plain name for the runtime's files folder; `path` is where the reader wants it.
        name = rel.replace("/", "__")
        entries.append({"name": name, "path": rel, "url": url, "bytes": p.stat().st_size, "sha256": sha256(p)})
    out = Path(__file__).with_name("models.json")
    out.write_text(json.dumps({"files": entries}, indent=2) + "\n", encoding="utf-8")
    print(f"{len(entries)} files, {sum(e['bytes'] for e in entries) / 1e6:.0f} MB -> {out}")


if __name__ == "__main__":
    main()
