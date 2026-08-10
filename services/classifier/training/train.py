#!/usr/bin/env python3
"""Train EfficientNet document-type classifier and save a Lightning checkpoint."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SERVICE_ROOT / "training" / "configs" / "default.yaml"
DEFAULT_MANIFEST = SERVICE_ROOT / "training" / "datasets" / "manifest.json"
DEFAULT_CKPT_DIR = SERVICE_ROOT / "training" / "checkpoints"


class DocDataset:
    """Simple image dataset — top-level so multiprocessing can pickle it."""

    def __init__(self, rows, root, class_to_idx, tf):
        self.rows = rows
        self.root = root
        self.class_to_idx = class_to_idx
        self.tf = tf

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        from PIL import Image

        row = self.rows[index]
        path = self.root / row["path"]
        image = Image.open(path).convert("RGB")
        return self.tf(image), self.class_to_idx[row["label"]]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--ckpt-dir", default=str(DEFAULT_CKPT_DIR))
    parser.add_argument("--max-epochs", type=int, default=None)
    parser.add_argument("--fast-dev-run", action="store_true")
    args = parser.parse_args()

    try:
        import pytorch_lightning as pl
        import torch
        import timm
        from PIL import Image
        from torch.utils.data import DataLoader, Dataset
        from torchvision import transforms
    except Exception as exc:
        print("Missing training deps:", exc, file=sys.stderr)
        print("pip install -r services/classifier/requirements.txt", file=sys.stderr)
        return 2

    config = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    classes: List[str] = [str(c) for c in config["classes"]]
    class_to_idx = {c: i for i, c in enumerate(classes)}
    img_size = int(config.get("img_size") or 224)
    max_epochs = int(args.max_epochs or config.get("max_epochs") or 8)

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    dataset_root = Path(args.manifest).resolve().parent

    train_rows = [r for r in manifest if r.get("split") != "val"]
    val_rows = [r for r in manifest if r.get("split") == "val"]
    if not val_rows:
        val_rows = train_rows[::5] or train_rows[:1]

    train_tf = transforms.Compose(
        [
            transforms.Resize((img_size, img_size)),
            # No horizontal flip — mirrored KYC cards teach the wrong geometry.
            transforms.RandomRotation(degrees=6, fill=40),
            transforms.ColorJitter(0.15, 0.15, 0.1, 0.05),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    val_tf = transforms.Compose(
        [
            transforms.Resize((img_size, img_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )

    train_loader = DataLoader(
        DocDataset(train_rows, dataset_root, class_to_idx, train_tf),
        batch_size=int(config.get("batch_size") or 16),
        shuffle=True,
        num_workers=0,
    )
    val_loader = DataLoader(
        DocDataset(val_rows, dataset_root, class_to_idx, val_tf),
        batch_size=int(config.get("batch_size") or 16),
        shuffle=False,
        num_workers=0,
    )

    class Module(pl.LightningModule):
        def __init__(self) -> None:
            super().__init__()
            self.save_hyperparameters(
                {
                    "classes": classes,
                    "model_name": config.get("model_name") or "efficientnet_b0",
                    "learning_rate": float(config.get("learning_rate") or 3e-4),
                    "img_size": img_size,
                }
            )
            self.model = timm.create_model(
                str(config.get("model_name") or "efficientnet_b0"),
                pretrained=True,
                num_classes=len(classes),
            )

        def forward(self, x: Any) -> Any:
            return self.model(x)

        def training_step(self, batch: Any, batch_idx: int) -> Any:
            x, y = batch
            logits = self(x)
            loss = torch.nn.functional.cross_entropy(logits, y)
            self.log("train_loss", loss, prog_bar=True)
            return loss

        def validation_step(self, batch: Any, batch_idx: int) -> None:
            x, y = batch
            logits = self(x)
            loss = torch.nn.functional.cross_entropy(logits, y)
            acc = (logits.argmax(dim=1) == y).float().mean()
            self.log("val_loss", loss, prog_bar=True)
            self.log("val_acc", acc, prog_bar=True)

        def configure_optimizers(self) -> Any:
            return torch.optim.AdamW(
                self.parameters(),
                lr=float(config.get("learning_rate") or 3e-4),
            )

    ckpt_dir = Path(args.ckpt_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    trainer = pl.Trainer(
        max_epochs=max_epochs,
        default_root_dir=str(ckpt_dir),
        accelerator="auto",
        devices=1,
        enable_checkpointing=True,
        fast_dev_run=args.fast_dev_run,
        log_every_n_steps=5,
    )
    module = Module()
    trainer.fit(module, train_loader, val_loader)

    out = ckpt_dir / "last.ckpt"
    trainer.save_checkpoint(str(out))
    # Also dump class list next to checkpoint for export / runtime
    (ckpt_dir / "classes.json").write_text(json.dumps(classes, indent=2), encoding="utf-8")
    print("Saved", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
