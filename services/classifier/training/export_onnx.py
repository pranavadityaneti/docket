#!/usr/bin/env python3
"""Export a trained Lightning checkpoint to ONNX for local inference."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import yaml

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SERVICE_ROOT / "training" / "configs" / "default.yaml"
DEFAULT_CKPT = SERVICE_ROOT / "training" / "checkpoints" / "last.ckpt"
DEFAULT_OUTPUT = SERVICE_ROOT / "models" / "onnx" / "classifier.onnx"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CKPT))
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    ckpt = Path(args.checkpoint)
    if not ckpt.exists():
        print("Checkpoint missing:", ckpt, file=sys.stderr)
        return 1

    try:
        import pytorch_lightning as pl
        import timm
        import torch
    except Exception as exc:
        print("Missing deps:", exc, file=sys.stderr)
        return 2

    config = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    classes: List[str] = [str(c) for c in config["classes"]]
    img_size = int(config.get("img_size") or 224)
    model_name = str(config.get("model_name") or "efficientnet_b0")

    class Module(pl.LightningModule):
        def __init__(self) -> None:
            super().__init__()
            self.model = timm.create_model(model_name, pretrained=False, num_classes=len(classes))

        def forward(self, x: Any) -> Any:
            return self.model(x)

    module = Module()
    raw = torch.load(str(ckpt), map_location="cpu", weights_only=False)
    state = raw.get("state_dict", raw)
    # Lightning prefixes keys with "model." for nested nn.Module named self.model
    cleaned = {}
    for key, value in state.items():
        if key.startswith("model."):
            cleaned[key] = value
        elif not key.startswith("model."):
            cleaned["model." + key if not key.startswith("model") else key] = value
    # Prefer loading into module.state_dict
    try:
        module.load_state_dict(state, strict=False)
    except Exception:
        module.load_state_dict(cleaned, strict=False)
    module.eval()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 3, img_size, img_size)
    torch.onnx.export(
        module,
        dummy,
        str(output),
        input_names=["image"],
        output_names=["logits"],
        dynamic_axes={"image": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
    )
    meta = {
        "classes": classes,
        "img_size": img_size,
        "model_name": model_name,
        "onnx": str(output.name),
    }
    output.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    # Also mirror into apps/api for Nest runtime
    api_model_dir = SERVICE_ROOT.parents[1] / "apps" / "api" / "models" / "onnx"
    api_model_dir.mkdir(parents=True, exist_ok=True)
    api_out = api_model_dir / "classifier.onnx"
    api_out.write_bytes(output.read_bytes())
    (api_model_dir / "classifier.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Wrote", output)
    print("Wrote", api_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
