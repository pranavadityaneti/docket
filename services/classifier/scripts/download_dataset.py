#!/usr/bin/env python3
"""Build training blobs for the document-type classifier.

Sole dataset pipeline for services/classifier. Collects:
  1) Curated public specimen image / PDF URLs
  2) Wikimedia Commons search (public files only)
  3) Class-specific synthetic templates (layout must DISTINCTLY differ —
     pan vs aadhaar used to share one silhouette and confused inference)

Never scrapes personal KYC dumps, digilocker leaks, or face+ID folders from
random websites. Real Aadhaar / PAN of living people is off-limits.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

SERVICE_ROOT = Path(__file__).resolve().parents[1]
ONTOLOGY_PATH = SERVICE_ROOT / "models" / "ontology.yaml"
DEFAULT_OUTPUT = SERVICE_ROOT / "training" / "datasets" / "blobs"
DEFAULT_MANIFEST = SERVICE_ROOT / "training" / "datasets" / "manifest.json"

USER_AGENT = (
    "DocketClassifierTrain/2.0 (educational KYC doc-type training; "
    "+https://github.com/ezfundz/docket)"
)
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# Direct public specimen URLs (images + PDFs). Keys = ontology ids.
PUBLIC_SEEDS: Dict[str, List[str]] = {
    "aadhaar_front": [
        "https://upload.wikimedia.org/wikipedia/commons/8/8a/Specimen_of_an_Aadhaar_Card_2024.png",
        "https://upload.wikimedia.org/wikipedia/commons/4/49/A_sample_of_Aadhaar_card.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Specimen_of_an_Aadhaar_Card_2024.png/960px-Specimen_of_an_Aadhaar_Card_2024.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/A_sample_of_Aadhaar_card.jpg/800px-A_sample_of_Aadhaar_card.jpg",
    ],
    "aadhaar_back": [
        "https://upload.wikimedia.org/wikipedia/commons/8/8a/Specimen_of_an_Aadhaar_Card_2024.png",
        "https://upload.wikimedia.org/wikipedia/commons/4/49/A_sample_of_Aadhaar_card.jpg",
    ],
    "pan_card": [
        "https://upload.wikimedia.org/wikipedia/commons/9/9a/Permanent_Account_Number_Card.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/3/3b/PAN_card.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Permanent_Account_Number_Card.jpg/800px-Permanent_Account_Number_Card.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/PAN_card.jpg/640px-PAN_card.jpg",
    ],
    "passport": [
        "https://upload.wikimedia.org/wikipedia/commons/2/28/Indian_Passport.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/8/80/Indian_passport_biodata_page.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Indian_Passport.jpg/800px-Indian_Passport.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/7/7e/German_passport_data_page.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/4/4a/US_passport_card.jpg",
    ],
    "photograph": [
        "https://upload.wikimedia.org/wikipedia/commons/5/5a/Photo_placeholder.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/7/7e/Portrait_Placeholder.png",
        "https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Unknown_person.jpg/440px-Unknown_person.jpg",
    ],
    "bank_statement": [
        # Open educational / blank templates — not customer statements
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
        "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf",
    ],
    "utility_bill": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
    ],
    "form_16": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
    ],
    "gst_certificate": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
    ],
    "rental_agreement": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
    ],
    "cancelled_cheque": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
        "https://upload.wikimedia.org/wikipedia/commons/1/15/BlankCheque.JPG",
    ],
    "salary_slip": [
        "https://upload.wikimedia.org/wikipedia/commons/4/4f/Blank_document.png",
    ],
    "other": [
        "https://upload.wikimedia.org/wikipedia/commons/3/3f/Placeholder_view_vector.svg",
        "https://upload.wikimedia.org/wikipedia/commons/6/65/No-Image-Placeholder.svg",
        "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/640px-Camponotus_flavomarginatus_ant.jpg",
    ],
}

# Wikimedia Commons file-namespace search terms (public educational hits).
COMMONS_QUERIES: Dict[str, List[str]] = {
    "aadhaar_front": ["Aadhaar card specimen", "Aadhaar UIDAI sample", "Aadhaar card India"],
    "aadhaar_back": ["Aadhaar card specimen", "Aadhaar card back"],
    "pan_card": ["Permanent Account Number Card", "PAN card India", "Income Tax PAN"],
    "passport": ["Indian passport biodata", "passport data page", "passport MRZ"],
    "photograph": ["passport photo placeholder", "portrait placeholder"],
    "bank_statement": ["bank statement sample", "account statement form"],
    "utility_bill": ["electricity bill sample", "utility bill form"],
    "form_16": ["Form 16 India tax", "TDS certificate"],
    "gst_certificate": ["GST registration certificate India"],
    "rental_agreement": ["rental agreement sample", "lease agreement form"],
    "cancelled_cheque": ["cancelled cheque", "blank cheque India"],
    "salary_slip": ["payslip sample", "salary slip template"],
    "other": ["receipt photo", "random document scan", "meme image"],
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--per-class", type=int, default=80, help="Target images per class")
    parser.add_argument("--commons-limit", type=int, default=12, help="Max Commons hits / query")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--skip-commons", action="store_true")
    parser.add_argument(
        "--extra-seed",
        action="append",
        default=[],
        help="Extra local image: LABEL=/abs/path.png (repeatable)",
    )
    args = parser.parse_args()

    labels = _load_labels()
    output = Path(args.output)
    if output.exists():
        # Wipe previous generation so stale twin-template blobs cannot linger.
        import shutil

        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})

    extras: Dict[str, List[Path]] = {}
    for item in args.extra_seed:
        if "=" not in item:
            print("bad --extra-seed", item, file=sys.stderr)
            continue
        label_id, path_s = item.split("=", 1)
        path = Path(path_s)
        if path.is_file():
            extras.setdefault(label_id, []).append(path)

    manifest: List[Dict[str, str]] = []
    for label in labels:
        label_id = str(label["id"])
        class_dir = output / label_id
        class_dir.mkdir(parents=True, exist_ok=True)
        seeds: List[Image.Image] = []

        if not args.skip_download:
            urls = list(PUBLIC_SEEDS.get(label_id, []))
            if not args.skip_commons:
                urls.extend(
                    _commons_urls(session, COMMONS_QUERIES.get(label_id, []), args.commons_limit)
                )
            # Dedup preserve order
            seen = set()
            for url in urls:
                if url in seen:
                    continue
                seen.add(url)
                for img in _load_url_images(session, url):
                    seeds.append(img)
                    path = class_dir / f"seed_{_hash(url)[:10]}_{len(seeds):02d}.jpg"
                    img.save(path, quality=90)
                    print("downloaded", label_id, path.name)

        for path in extras.get(label_id, []):
            try:
                img = Image.open(path).convert("RGB")
                seeds.append(img)
                dest = class_dir / f"extra_{_hash(str(path))[:10]}.jpg"
                img.save(dest, quality=90)
                print("extra", label_id, dest.name)
            except Exception as exc:
                print("skip extra", path, exc, file=sys.stderr)

        # Class-specific synthetics — deliberately NOT one shared card template.
        for i in range(10):
            seeds.append(_make_synthetic(label, i))

        if not seeds:
            seeds.append(_make_synthetic(label, 0))

        produced = 0
        target = args.per_class
        while produced < target:
            base = seeds[produced % len(seeds)]
            aug = _augment(base, seed=f"{label_id}-{produced}")
            # Dual-card layout variants teach side-by-side stock photos.
            if label_id in {"pan_card", "aadhaar_front"} and produced % 7 == 0:
                aug = _make_dual_layout(base, label_id, produced)
            path = class_dir / f"{label_id}_{produced:03d}.jpg"
            aug.save(path, quality=88)
            split = "val" if produced % 5 == 0 else "train"
            manifest.append(
                {
                    "path": str(path.relative_to(output.parent)),
                    "label": label_id,
                    "split": split,
                }
            )
            produced += 1
        print("class", label_id, "->", produced, "images, seeds=", len(seeds))

    Path(args.manifest).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Wrote manifest", args.manifest, "entries=", len(manifest))
    return 0


def _load_labels() -> List[Dict[str, Any]]:
    import yaml

    with ONTOLOGY_PATH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return [x for x in data.get("labels", []) if x.get("id")]


def _hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def _commons_urls(session: requests.Session, queries: List[str], limit: int) -> List[str]:
    import time

    urls: List[str] = []
    for q in queries:
        try:
            time.sleep(0.8)  # be kind to Commons — they 429 aggressive scrapers
            resp = session.get(
                COMMONS_API,
                params={
                    "action": "query",
                    "format": "json",
                    "list": "search",
                    "srsearch": q,
                    "srnamespace": 6,  # File:
                    "srlimit": min(limit, 8),
                },
                timeout=30,
            )
            if resp.status_code == 429:
                print("commons rate-limited, backing off", q, file=sys.stderr)
                time.sleep(8)
                continue
            if resp.status_code != 200:
                print("commons search fail", q, resp.status_code, file=sys.stderr)
                continue
            for hit in resp.json().get("query", {}).get("search", []):
                title = hit.get("title") or ""
                if not title.startswith("File:"):
                    continue
                # Drop obvious unrelated Commons hits from broad queries
                title_l = title.lower()
                needle = q.split()[0].lower()
                if needle not in title_l and not any(
                    tok in title_l
                    for tok in (
                        "aadhaar",
                        "aadhar",
                        "pan",
                        "passport",
                        "cheque",
                        "payslip",
                        "gst",
                        "form",
                        "portrait",
                        "placeholder",
                        "lease",
                        "rent",
                        "bill",
                        "statement",
                    )
                ):
                    continue
                time.sleep(0.5)
                info = session.get(
                    COMMONS_API,
                    params={
                        "action": "query",
                        "format": "json",
                        "titles": title,
                        "prop": "imageinfo",
                        "iiprop": "url|mime",
                    },
                    timeout=30,
                )
                if info.status_code == 429:
                    print("commons imageinfo 429", title, file=sys.stderr)
                    time.sleep(8)
                    continue
                if info.status_code != 200:
                    continue
                pages = info.json().get("query", {}).get("pages", {})
                for page in pages.values():
                    for ii in page.get("imageinfo") or []:
                        url = ii.get("url")
                        mime = (ii.get("mime") or "").lower()
                        if url and (
                            mime.startswith("image/")
                            or mime == "application/pdf"
                            or url.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".pdf"))
                        ):
                            # Strip tracking junk Commons sometimes appends
                            urls.append(url.split("?")[0])
        except Exception as exc:
            print("commons", q, exc, file=sys.stderr)
    return urls


def _load_url_images(session: requests.Session, url: str) -> List[Image.Image]:
    import time

    try:
        resp = session.get(url, timeout=45)
        if resp.status_code == 429:
            time.sleep(5)
            resp = session.get(url, timeout=45)
        if resp.status_code != 200:
            print("skip", url, "status", resp.status_code, file=sys.stderr)
            return []
        ctype = (resp.headers.get("content-type") or "").lower()
        data = resp.content
        if "pdf" in ctype or url.lower().endswith(".pdf"):
            return _rasterize_pdf(data)
        img = Image.open(io.BytesIO(data))
        if getattr(img, "n_frames", 1) > 1:
            out = []
            for i in range(min(2, img.n_frames)):
                img.seek(i)
                out.append(img.convert("RGB"))
            return out
        return [img.convert("RGB")]
    except Exception as exc:
        print("skip", url, exc, file=sys.stderr)
        return []


def _rasterize_pdf(data: bytes) -> List[Image.Image]:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("pymupdf missing — PDF skipped (pip install pymupdf)", file=sys.stderr)
        return []
    out: List[Image.Image] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        for i, page in enumerate(doc):
            if i >= 3:
                break
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            out.append(img)
        doc.close()
    except Exception as exc:
        print("pdf raster fail", exc, file=sys.stderr)
    return out


def _make_synthetic(label: Dict[str, Any], index: int) -> Image.Image:
    label_id = str(label["id"])
    title = str(label.get("title") or label_id)
    rng = random.Random("%s-%d" % (label_id, index))

    if label_id == "pan_card":
        return _synth_pan(rng, index)
    if label_id == "aadhaar_front":
        return _synth_aadhaar_front(rng, index)
    if label_id == "aadhaar_back":
        return _synth_aadhaar_back(rng, index)
    if label_id == "cancelled_cheque":
        return _synth_cheque(rng, title)
    if label_id == "photograph":
        return _synth_photo(rng)
    if label_id == "passport":
        return _synth_passport(rng)
    return _synth_form_doc(label_id, title, rng)


def _synth_pan(rng: random.Random, index: int) -> Image.Image:
    """Classic Indian PAN: blue/pink wash, emblem area, NO tall aadhaar photo."""
    w, h = 900, 560
    # Soft blue-pink like the stock specimen user tested
    image = Image.new("RGB", (w, h), (210, 220, 235))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    # Card body
    draw.rounded_rectangle([40, 40, w - 40, h - 40], radius=12, fill=(232, 220, 228), outline=(180, 40, 40), width=3)
    draw.text((60, 55), "INCOME TAX DEPARTMENT", fill=(180, 30, 30), font=font)
    draw.text((w - 280, 55), "GOVERNMENT OF INDIA", fill=(180, 30, 30), font=font)
    draw.ellipse([420, 70, 480, 130], outline=(120, 80, 40), width=2)
    draw.text((70, 150), "YOUR NAME HERE" if index % 2 == 0 else "SAMPLE NAME", fill=(30, 30, 30), font=font)
    draw.text((70, 185), "DOB : 00/00/0000", fill=(40, 40, 40), font=font)
    draw.text((70, 230), "PERMANENT ACCOUNT NUMBER", fill=(20, 20, 20), font=font)
    pan = "ABCDE%dF" % (1000 + rng.randint(0, 8999))
    draw.text((70, 260), pan, fill=(20, 20, 120), font=font)
    # Small photo bottom-right (PAN style), not left column like Aadhaar
    draw.rectangle([w - 200, h - 220, w - 70, h - 70], fill=(160, 160, 165), outline=(80, 80, 80))
    draw.rectangle([w - 250, 100, w - 140, 180], fill=(200, 200, 205), outline=(140, 140, 140))  # hologram square
    draw.text((w - 190, h - 60), "SIGNATURE", fill=(60, 60, 60), font=font)
    return image


def _synth_aadhaar_front(rng: random.Random, index: int) -> Image.Image:
    """Aadhaar front: deep red header band, left photo, UID mask, QR-ish square."""
    w, h = 960, 600
    image = Image.new("RGB", (w, h), (245, 245, 248))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.rectangle([0, 0, w, 70], fill=(180, 40, 50))
    draw.text((24, 24), "भारत सरकार  |  GOVERNMENT OF INDIA  |  Aadhaar", fill=(255, 255, 255), font=font)
    # Tall photo left
    draw.rectangle([40, 100, 220, 340], fill=(200, 190, 180), outline=(60, 60, 60), width=2)
    draw.ellipse([70, 130, 190, 250], fill=(170, 150, 130))
    draw.text((250, 110), "Name: Sample Resident", fill=(20, 20, 20), font=font)
    draw.text((250, 150), "DOB: 01/01/1990", fill=(20, 20, 20), font=font)
    draw.text((250, 190), "Gender: M/F", fill=(20, 20, 20), font=font)
    uid = "XXXX XXXX %04d" % rng.randint(1000, 9999)
    draw.text((250, 250), uid, fill=(20, 20, 20), font=font)
    # QR block lower right
    draw.rectangle([w - 180, h - 200, w - 40, h - 60], fill=(30, 30, 30))
    for _ in range(40):
        x = rng.randint(w - 170, w - 50)
        y = rng.randint(h - 190, h - 70)
        draw.rectangle([x, y, x + 4, y + 4], fill=(240, 240, 240))
    draw.rectangle([0, h - 36, w, h], fill=(40, 100, 180))
    draw.text((24, h - 28), "UIDAI  —  Unique Identification Authority of India", fill=(255, 255, 255), font=font)
    return image


def _synth_aadhaar_back(rng: random.Random, index: int) -> Image.Image:
    w, h = 960, 600
    image = Image.new("RGB", (w, h), (250, 250, 252))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.rectangle([0, 0, w, 50], fill=(40, 100, 180))
    draw.text((24, 16), "Aadhaar — Address side", fill=(255, 255, 255), font=font)
    y = 80
    for line in [
        "S/O: Example Father",
        "House No. 12, Example Street",
        "Example Nagar, Example City",
        "Example State - 560001",
        "XXXX XXXX %04d" % rng.randint(1000, 9999),
    ]:
        draw.text((40, y), line, fill=(30, 30, 30), font=font)
        y += 36
    draw.rectangle([w - 200, 80, w - 40, 240], fill=(30, 30, 30))
    return image


def _synth_cheque(rng: random.Random, title: str) -> Image.Image:
    w, h = 1000, 420
    image = Image.new("RGB", (w, h), (235, 245, 235))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.rectangle([20, 20, w - 20, h - 20], outline=(30, 90, 40), width=3)
    draw.text((40, 40), "BANK OF EXAMPLE  —  " + title.upper(), fill=(20, 60, 20), font=font)
    draw.text((40, 100), "Pay _______________________________", fill=(20, 20, 20), font=font)
    draw.text((40, 150), "A/C No. ****************", fill=(20, 20, 20), font=font)
    draw.text((40, 200), "IFSC: EXMP0001234", fill=(20, 20, 20), font=font)
    draw.text((w // 2, h // 2), "CANCELLED", fill=(200, 40, 40), font=font)
    draw.line([40, 280, 400, 280], fill=(20, 20, 20), width=2)
    return image


def _synth_photo(rng: random.Random) -> Image.Image:
    image = Image.new("RGB", (512, 640), (220, 220, 230))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.ellipse([120, 80, 390, 360], fill=(180, 160, 140))
    draw.rectangle([90, 370, 420, 600], fill=(60, 80, 120))
    draw.text((160, 20), "PASSPORT PHOTO", fill=(40, 40, 40), font=font)
    return image


def _synth_passport(rng: random.Random) -> Image.Image:
    w, h = 900, 640
    image = Image.new("RGB", (w, h), (245, 245, 250))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    margin = 30
    draw.rectangle([margin, margin, w - margin, h - margin], outline=(20, 40, 100), width=5)
    draw.text((margin + 30, margin + 30), "REPUBLIC OF INDIA — PASSPORT", fill=(20, 40, 100), font=font)
    draw.rectangle([margin + 30, margin + 90, margin + 220, margin + 330], fill=(190, 190, 200))
    draw.text((margin + 250, margin + 100), "Surname / Given names", fill=(20, 20, 20), font=font)
    draw.text((margin + 250, margin + 160), "Date of birth / Sex / Nationality", fill=(20, 20, 20), font=font)
    draw.text((margin + 30, h - margin - 60), "P<INDXXXXXXXX<<<<<<<<<<<<<<<<<<<", fill=(20, 20, 20), font=font)
    return image


def _synth_form_doc(label_id: str, title: str, rng: random.Random) -> Image.Image:
    w, h = 960, 1280 if label_id in {"bank_statement", "rental_agreement", "form_16"} else 960
    accent = _color(label_id, 90)
    image = Image.new("RGB", (w, h), (250, 250, 252))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.rectangle([0, 0, w, 70], fill=accent)
    draw.text((24, 24), title.upper(), fill=(255, 255, 255), font=font)
    y = 100
    if label_id == "gst_certificate":
        draw.text((40, 90), "GSTIN: 29AABCT1332L1Z5", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "form_16":
        draw.text((40, 90), "FORM NO. 16  —  TDS Certificate", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "bank_statement":
        draw.text((40, 90), "Account Statement  —  Opening / Closing Balance", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "salary_slip":
        draw.text((40, 90), "Payslip / Salary Slip — Earnings & Deductions", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "utility_bill":
        draw.text((40, 90), "Electricity / Water Bill — Consumer No.", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "rental_agreement":
        draw.text((40, 90), "RENTAL / LEASE AGREEMENT", fill=(20, 20, 20), font=font)
        y = 130
    if label_id == "other":
        draw.text((40, h // 2), "RANDOM PHOTO / RECEIPT / MEME", fill=(80, 80, 80), font=font)
    rows = 22 if h > 900 else 14
    for _ in range(rows):
        lw = rng.randint(280, w - 80)
        draw.rectangle([40, y, 40 + lw, y + 8], fill=(200, 205, 215))
        y += 28
        if y > h - 40:
            break
    return image


def _make_dual_layout(base: Image.Image, label_id: str, produced: int) -> Image.Image:
    """Front+back side-by-side — matches Adobe-stock style dual cards."""
    rng = random.Random(f"dual-{label_id}-{produced}")
    left = base.convert("RGB").resize((480, 300), Image.Resampling.BILINEAR)
    if label_id == "pan_card":
        right = _synth_pan(rng, produced + 99).resize((480, 300), Image.Resampling.BILINEAR)
    else:
        right = _synth_aadhaar_back(rng, produced + 99).resize((480, 300), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (1000, 500), (200 + rng.randint(0, 30), 210, 230))
    canvas.paste(left, (20, 100))
    canvas.paste(right, (520, 100))
    return _augment(canvas, seed=f"dual-aug-{label_id}-{produced}")


def _augment(image: Image.Image, seed: str) -> Image.Image:
    rng = random.Random(seed)
    img = image.convert("RGB")
    w, h = img.size
    scale = rng.uniform(0.85, 1.15)
    img = img.resize((max(180, int(w * scale)), max(180, int(h * scale))), Image.Resampling.BILINEAR)
    if rng.random() < 0.5:
        img = ImageOps.autocontrast(img)
    if rng.random() < 0.4:
        img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.7, 1.3))
    if rng.random() < 0.4:
        img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.75, 1.35))
    if rng.random() < 0.35:
        img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 1.4)))
    if rng.random() < 0.5:
        angle = rng.uniform(-8, 8)
        img = img.rotate(angle, expand=True, fillcolor=(30, 30, 30))
    # Letterbox onto 960x640 (keep aspect) — better match of wide dual cards
    canvas = Image.new("RGB", (960, 640), (rng.randint(20, 60),) * 3)
    iw, ih = img.size
    scale2 = min(920 / iw, 600 / ih)
    img = img.resize((max(1, int(iw * scale2)), max(1, int(ih * scale2))), Image.Resampling.BILINEAR)
    x = rng.randint(10, max(10, 960 - img.size[0] - 10))
    y = rng.randint(10, max(10, 640 - img.size[1] - 10))
    canvas.paste(img, (x, y))
    return canvas


def _color(label_id: str, offset: int) -> Tuple[int, int, int]:
    seed = sum(ord(c) for c in label_id) + offset
    rng = random.Random(seed)
    return (rng.randint(70, 180), rng.randint(80, 190), rng.randint(90, 210))


if __name__ == "__main__":
    raise SystemExit(main())
