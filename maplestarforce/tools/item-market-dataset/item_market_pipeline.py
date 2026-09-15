#!/usr/bin/env python3
"""Local-only MapleStory equipment screenshot dataset pipeline.

The raw screenshots and OCR output stay on this VM.  Only rows that a human has
marked ``approved`` can be exported or used to train the small JSON price model.

Typical flow::

    python3 item_market_pipeline.py ingest ./photos --out ./market-data \
        --price-kind listing --observed-at 2026-09-01 --auction-group 1
    # Review and edit ./market-data/review.csv, then set review_status=approved.
    python3 item_market_pipeline.py validate ./market-data/review.csv
    python3 item_market_pipeline.py export ./market-data/review.csv \
        --out ./market-data/public
    python3 item_market_pipeline.py train ./market-data/review.csv \
        --out ./market-data/public/price-model.v1.json --price-kind sold

OCR is optional.  ``--ocr auto`` uses the local Tesseract binary when present;
otherwise the image is still indexed and left in ``pending_manual`` state.
"""

from __future__ import annotations

import argparse
import csv
from difflib import SequenceMatcher
import hashlib
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore
except ImportError:  # pragma: no cover - handled with a useful runtime error
    cv2 = None
    np = None

try:
    from PIL import Image, ImageOps  # type: ignore
except ImportError:  # pragma: no cover - handled with a useful runtime error
    Image = None
    ImageOps = None


SCHEMA_VERSION = "1.0"
FEATURE_VERSION = "maple-market-ridge-v1"
TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_STARFORCE_CALC = TOOL_DIR.parents[1] / "src" / "calc.js"
DEFAULT_PRESET_ALIASES = TOOL_DIR / "starforce_preset_aliases.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
PRICE_KIND_VALUES = {"listing", "sold"}
REVIEW_STATUS_VALUES = {"pending", "approved", "rejected"}
POTENTIAL_GRADES = {"없음", "레어", "에픽", "유니크", "레전드리"}

POTENTIAL_LINE_COLUMNS = {
    "main": [f"main_potential_line_{index}" for index in range(1, 4)],
    "additional": [f"additional_potential_line_{index}" for index in range(1, 4)],
}

APPROVED_REQUIRED_TEXT_FIELDS = [
    "record_id",
    "price_meso",
    "price_kind",
    "observed_at",
    "auction_group",
    "item_name",
    "item_category",
    "required_job",
    "scroll_kind",
    "main_potential_grade",
    "additional_potential_grade",
    "tradeability",
    "clean_price_meso",
]

APPROVED_REQUIRED_NUMERIC_FIELDS = [
    "item_level",
    "starforce",
    "upgrade_applied",
    "upgrade_remaining",
    "upgrade_recoverable",
    "scroll_main_stat",
    "scroll_attack",
    "scroll_magic",
    "flame_main_stat",
    "flame_sub_stat",
    "flame_all_stat_pct",
    "flame_attack",
    "flame_score",
    "scissors_remaining",
    "scissors_total",
]

LOCAL_ONLY_COLUMNS = {
    "source_filename",
    "source_relative_path",
    "source_sha256",
    "pixel_sha256",
    "phash",
    "duplicate_group_id",
    "ocr_engine",
    "ocr_confidence",
    "ocr_text",
    "reviewer",
    "review_notes",
}

PUBLIC_ITEM_FIELDS = [
    "item_name",
    "starforce_preset_id",
    "item_level",
    "item_category",
    "required_job",
    "starforce",
    "upgrade_applied",
    "upgrade_remaining",
    "upgrade_recoverable",
    "scroll_kind",
    "scroll_main_stat",
    "scroll_attack",
    "scroll_magic",
    "flame_main_stat",
    "flame_sub_stat",
    "flame_all_stat_pct",
    "flame_attack",
    "flame_score",
    "main_potential_grade",
    "main_potential_line_1",
    "main_potential_line_2",
    "main_potential_line_3",
    "main_potential_equiv_pct",
    "additional_potential_grade",
    "additional_potential_line_1",
    "additional_potential_line_2",
    "additional_potential_line_3",
    "additional_potential_equiv_pct",
    "tradeability",
    "scissors_remaining",
    "scissors_total",
    "clean_price_meso",
]

NUMERIC_CSV_COLUMNS = {
    "price_meso",
    "price_eok",
    "item_level",
    "starforce",
    "upgrade_applied",
    "upgrade_remaining",
    "upgrade_recoverable",
    "scroll_main_stat",
    "scroll_attack",
    "scroll_magic",
    "flame_main_stat",
    "flame_sub_stat",
    "flame_all_stat_pct",
    "flame_attack",
    "flame_score",
    "main_potential_equiv_pct",
    "additional_potential_equiv_pct",
    "scissors_remaining",
    "scissors_total",
    "clean_price_meso",
    "image_width",
    "image_height",
    "ocr_confidence",
}

REVIEW_COLUMNS = [
    "schema_version",
    "record_id",
    "review_status",
    "price_meso",
    "price_eok",
    "price_kind",
    "observed_at",
    "auction_group",
    "world",
    "item_name",
    "starforce_preset_id",
    "item_level",
    "item_category",
    "required_job",
    "starforce",
    "upgrade_applied",
    "upgrade_remaining",
    "upgrade_recoverable",
    "scroll_kind",
    "scroll_main_stat",
    "scroll_attack",
    "scroll_magic",
    "flame_main_stat",
    "flame_sub_stat",
    "flame_all_stat_pct",
    "flame_attack",
    "flame_score",
    "main_potential_grade",
    "main_potential_line_1",
    "main_potential_line_2",
    "main_potential_line_3",
    "main_potential_equiv_pct",
    "additional_potential_grade",
    "additional_potential_line_1",
    "additional_potential_line_2",
    "additional_potential_line_3",
    "additional_potential_equiv_pct",
    "tradeability",
    "scissors_remaining",
    "scissors_total",
    "clean_price_meso",
    "displayed_stats_json",
    "extraction_status",
    "validation_flags",
    "source_filename",
    "source_relative_path",
    "source_sha256",
    "pixel_sha256",
    "phash",
    "duplicate_group_id",
    "image_width",
    "image_height",
    "ocr_engine",
    "ocr_confidence",
    "ocr_text",
    "reviewer",
    "reviewed_at",
    "review_notes",
]

NUMERIC_FEATURES = [
    "item_level",
    "starforce",
    "upgrade_applied",
    "scroll_main_stat",
    "scroll_attack",
    "scroll_magic",
    "flame_main_stat",
    "flame_sub_stat",
    "flame_all_stat_pct",
    "flame_attack",
    "flame_score",
    "main_potential_equiv_pct",
    "additional_potential_equiv_pct",
    "scissors_remaining",
    "clean_price_eok",
]

CATEGORICAL_FEATURES = [
    "item_name",
    "starforce_preset_id",
    "item_category",
    "auction_group",
    "required_job",
    "scroll_kind",
    "main_potential_grade",
    "additional_potential_grade",
    "tradeability",
]


class PipelineError(RuntimeError):
    """An expected, user-fixable pipeline error."""


@dataclass(frozen=True)
class PriceResult:
    token: str
    meso: int

    @property
    def eok(self) -> float:
        return self.meso / 100_000_000


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value)
    value = value.replace("，", ",").replace("％", "%").replace("＋", "+")
    value = re.sub(r"[\u200b-\u200f\ufeff]", "", value)
    return value.strip()


def decimal_to_int(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_price_filename(path: Path | str, bare_unit: str = "eok") -> PriceResult:
    """Parse a price from the part before the first ``_`` in an image filename.

    Supported examples: ``75억.jpg``, ``75.5억_데브펜01.png``,
    ``75억5000만.jpg``, ``1000만.jpg``, ``7500000000메소.jpg``.
    A bare small number uses ``bare_unit`` (default: 억); a bare number of at
    least one million is treated as raw meso.
    """

    stem = Path(path).stem
    # Everything after the first underscore is a human-readable item tag.
    # Both 75억_데브펜01.png and the older 75억__01.png form are accepted.
    token = normalize_text(stem.split("_", 1)[0]).replace(",", "").replace(" ", "")
    if not token:
        raise PipelineError("파일명에 가격이 없습니다")

    unit_matches = list(re.finditer(r"(\d+(?:\.\d+)?)(조|억|만|메소)", token))
    if unit_matches:
        consumed = "".join(match.group(0) for match in unit_matches)
        if consumed != token:
            raise PipelineError(f"가격 형식을 해석할 수 없습니다: {token}")
        units = {match.group(2) for match in unit_matches}
        if "메소" in units and len(units) > 1:
            raise PipelineError("메소 단위와 조·억·만 단위를 섞을 수 없습니다")
        multipliers = {
            "조": Decimal("1000000000000"),
            "억": Decimal("100000000"),
            "만": Decimal("10000"),
            "메소": Decimal("1"),
        }
        total = sum(
            (Decimal(match.group(1)) * multipliers[match.group(2)] for match in unit_matches),
            Decimal(0),
        )
    else:
        try:
            number = Decimal(token)
        except InvalidOperation as exc:
            raise PipelineError(f"가격 형식을 해석할 수 없습니다: {token}") from exc
        if number >= 1_000_000:
            total = number
        elif bare_unit == "eok":
            total = number * Decimal("100000000")
        elif bare_unit == "meso":
            total = number
        else:
            raise PipelineError(f"지원하지 않는 단위 없는 숫자 기준: {bare_unit}")

    meso = decimal_to_int(total)
    if meso <= 0:
        raise PipelineError("가격은 0보다 커야 합니다")
    return PriceResult(token=token, meso=meso)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def json_dumps(value: Any, *, pretty: bool = False) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        indent=2 if pretty else None,
        sort_keys=pretty,
        separators=None if pretty else (",", ":"),
    )


def require_image_dependencies() -> None:
    if Image is None or ImageOps is None or cv2 is None or np is None:
        raise PipelineError("Pillow, OpenCV, numpy가 필요합니다")


def load_normalized_image(path: Path) -> tuple[Any, Any]:
    require_image_dependencies()
    try:
        with Image.open(path) as source:
            rgb_image = ImageOps.exif_transpose(source).convert("RGB")
            rgb_array = np.array(rgb_image)
    except Exception as exc:
        raise PipelineError(f"이미지를 열 수 없습니다: {exc}") from exc
    return rgb_image, rgb_array


def normalized_pixel_hash(rgb_array: Any) -> str:
    height, width = rgb_array.shape[:2]
    payload = f"{width}x{height}:RGB:".encode("ascii") + rgb_array.tobytes()
    return sha256_bytes(payload)


def perceptual_hash(rgb_array: Any) -> str:
    gray = cv2.cvtColor(rgb_array, cv2.COLOR_RGB2GRAY)
    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(np.float32(resized))[:8, :8]
    values = dct.flatten()[1:]
    median = float(np.median(values))
    bits = [bool(value > median) for value in values]
    number = 0
    for bit in bits:
        number = (number << 1) | int(bit)
    return f"{number:016x}"


def phash_distance(left: str, right: str) -> int:
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except (TypeError, ValueError):
        return 64


def assign_near_duplicate_groups(records: Sequence[dict[str, Any]], max_distance: int = 4) -> None:
    """Assign a stable group id without deleting probable relistings.

    A near duplicate can be a legitimate later listing at another price, so it
    remains in the data.  The group is used to keep related screenshots on the
    same side of a training/validation split.
    """

    parent = list(range(len(records)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[max(left_root, right_root)] = min(left_root, right_root)

    for left in range(len(records)):
        left_source = records[left]["source"]
        for right in range(left + 1, len(records)):
            right_source = records[right]["source"]
            width_ratio = left_source["width"] / max(right_source["width"], 1)
            height_ratio = left_source["height"] / max(right_source["height"], 1)
            if not 0.9 <= width_ratio <= 1.1 or not 0.9 <= height_ratio <= 1.1:
                continue
            if phash_distance(left_source["phash"], right_source["phash"]) <= max_distance:
                union(left, right)

    grouped_ids: dict[int, list[str]] = defaultdict(list)
    for index, record in enumerate(records):
        grouped_ids[find(index)].append(record["record_id"])
    for index, record in enumerate(records):
        stable_id = min(grouped_ids[find(index)])
        record["source"]["duplicate_group_id"] = f"dup-{stable_id}"


def detect_starforce(rgb_array: Any) -> tuple[int | None, float]:
    """Conservative yellow-star counter for a cropped Maple tooltip.

    The result is a suggestion only.  It is always shown in review.csv and must
    be confirmed by a human before approval.
    """

    height, width = rgb_array.shape[:2]
    crop = rgb_array[: max(24, int(height * 0.12)), :]
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
    mask = cv2.inRange(hsv, np.array([10, 100, 120]), np.array([45, 255, 255]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    candidates: list[tuple[float, float, int, int, int]] = []
    for index in range(1, count):
        x, y, component_width, component_height, area = map(int, stats[index])
        if area < 8 or area > 500:
            continue
        if component_width < 3 or component_height < 3:
            continue
        if component_width > width * 0.09 or component_height > height * 0.05:
            continue
        ratio = component_width / max(component_height, 1)
        if not 0.45 <= ratio <= 1.9:
            continue
        candidates.append(
            (float(centroids[index][0]), float(centroids[index][1]), component_width, component_height, area)
        )

    rows: list[list[tuple[float, float, int, int, int]]] = []
    tolerance = max(3.0, height * 0.008)
    for candidate in sorted(candidates, key=lambda item: (item[1], item[0])):
        for row in rows:
            if abs(statistics.median(item[1] for item in row) - candidate[1]) <= tolerance:
                row.append(candidate)
                break
        else:
            rows.append([candidate])

    plausible: list[list[tuple[float, float, int, int, int]]] = []
    for row in rows:
        if len(row) < 4:
            continue
        widths = [item[2] for item in row]
        heights = [item[3] for item in row]
        median_width = statistics.median(widths)
        median_height = statistics.median(heights)
        filtered = [
            item
            for item in row
            if 0.55 * median_width <= item[2] <= 1.8 * median_width
            and 0.55 * median_height <= item[3] <= 1.8 * median_height
        ]
        if len(filtered) >= 4:
            plausible.append(filtered)

    plausible.sort(key=lambda row: (statistics.median(item[1] for item in row), -len(row)))
    selected = plausible[:2]
    total = sum(len(row) for row in selected)
    if not 1 <= total <= 30:
        return None, 0.0
    regularity = sum(
        min(1.0, len(row) / 10) * (1.0 / (1.0 + statistics.pstdev(item[3] for item in row)))
        for row in selected
    ) / max(len(selected), 1)
    return total, round(max(0.2, min(0.9, regularity)), 3)


def tesseract_languages() -> set[str]:
    executable = shutil.which("tesseract")
    if not executable:
        return set()
    result = subprocess.run(
        [executable, "--list-langs"], capture_output=True, text=True, check=False
    )
    lines = (result.stdout + "\n" + result.stderr).splitlines()
    return {line.strip() for line in lines if re.fullmatch(r"[a-zA-Z_]+", line.strip())}


def ocr_variants(rgb_array: Any) -> list[tuple[str, Any]]:
    gray = cv2.cvtColor(rgb_array, cv2.COLOR_RGB2GRAY)
    scale = 3 if max(gray.shape[:2]) < 1400 else 2
    upscaled = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    denoised = cv2.bilateralFilter(upscaled, 5, 35, 35)
    _, otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if float(np.mean(otsu)) < 127:
        otsu = cv2.bitwise_not(otsu)
    adaptive = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 9
    )
    if float(np.mean(adaptive)) < 127:
        adaptive = cv2.bitwise_not(adaptive)
    original = cv2.cvtColor(
        cv2.resize(rgb_array, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC),
        cv2.COLOR_RGB2BGR,
    )
    return [("original", original), ("otsu", otsu), ("adaptive", adaptive)]


def tsv_to_lines(tsv_text: str) -> tuple[list[str], float]:
    reader = csv.DictReader(tsv_text.splitlines(), delimiter="\t")
    groups: dict[tuple[int, int, int, int], list[tuple[int, str, float]]] = defaultdict(list)
    confidences: list[float] = []
    for row in reader:
        text = normalize_text(row.get("text", ""))
        if not text:
            continue
        try:
            confidence = float(row.get("conf", "-1"))
        except ValueError:
            confidence = -1
        if confidence >= 0:
            confidences.append(confidence)
        try:
            key = (
                int(row.get("page_num", "0")),
                int(row.get("block_num", "0")),
                int(row.get("par_num", "0")),
                int(row.get("line_num", "0")),
            )
        except ValueError:
            key = (0, 0, 0, 0)
        try:
            left = int(row.get("left", "0"))
        except ValueError:
            left = 0
        groups[key].append((left, text, confidence))
    lines = [
        " ".join(value[1] for value in sorted(values, key=lambda item: item[0]))
        for _, values in sorted(groups.items(), key=lambda item: item[0])
    ]
    return lines, (statistics.mean(confidences) if confidences else 0.0)


def run_tesseract(rgb_array: Any, requested_language: str = "kor+eng") -> dict[str, Any]:
    executable = shutil.which("tesseract")
    if not executable:
        return {
            "status": "pending_manual",
            "engine": "none",
            "confidence": 0.0,
            "text": "",
            "warning": "Tesseract가 설치되어 있지 않습니다",
        }

    available = tesseract_languages()
    requested = requested_language.split("+")
    selected = [language for language in requested if language in available]
    if not selected and "eng" in available:
        selected = ["eng"]
    if not selected:
        return {
            "status": "pending_manual",
            "engine": "tesseract",
            "confidence": 0.0,
            "text": "",
            "warning": "사용 가능한 OCR 언어팩이 없습니다",
        }

    keywords = ["잠재", "에디", "스타", "주문서", "STR", "DEX", "INT", "LUK", "공격력"]
    candidates: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="maple-ocr-") as temp_dir:
        for variant_name, variant in ocr_variants(rgb_array):
            image_path = Path(temp_dir) / f"{variant_name}.png"
            cv2.imwrite(str(image_path), variant)
            for psm in (6, 11):
                result = subprocess.run(
                    [
                        executable,
                        str(image_path),
                        "stdout",
                        "-l",
                        "+".join(selected),
                        "--psm",
                        str(psm),
                        "tsv",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if result.returncode != 0:
                    continue
                lines, confidence = tsv_to_lines(result.stdout)
                text = "\n".join(lines)
                keyword_score = sum(1 for keyword in keywords if keyword in text)
                score = confidence + keyword_score * 12 + min(len(lines), 50) * 0.25
                candidates.append(
                    {
                        "variant": variant_name,
                        "psm": psm,
                        "lines": lines,
                        "text": text,
                        "confidence": confidence,
                        "score": score,
                    }
                )

    if not candidates:
        return {
            "status": "pending_manual",
            "engine": "tesseract",
            "confidence": 0.0,
            "text": "",
            "warning": "OCR 실행 결과가 없습니다",
        }
    best = max(candidates, key=lambda candidate: candidate["score"])
    return {
        "status": "needs_review",
        "engine": f"tesseract:{'+'.join(selected)}:{best['variant']}:psm{best['psm']}",
        "confidence": round(best["confidence"], 2),
        "text": best["text"],
        "lines": best["lines"],
        "warning": "",
    }


GRADE_PATTERN = re.compile(r"(레전드(?:리)?|유니크|에픽|레어)")
OPTION_PATTERN = re.compile(
    r"(올\s*스\s*탯|SAA|SAR|STR|DEX|INT|LUK|공격력|마력|보스[^+%]*데미지|몬스터[^+%]*방어율[^+%]*무시|최대\s*HP|HP)\s*[:：]?\s*\+?\s*(-?\d+(?:\.\d+)?)\s*(%)?",
    re.IGNORECASE,
)
STAT_LABEL_PATTERN = re.compile(
    r"^(STR|DEX|INT|LUK|올스탯|최대\s*HP|최대\s*MP|공격력|마력|방어력)\s*[:：]?\s*\+?\s*(-?\d+(?:\.\d+)?)\s*(%)?\s*(?:\(([^)]*)\))?",
    re.IGNORECASE,
)


def normalize_ocr_line(line: str) -> str:
    line = normalize_text(line)
    line = line.replace("|", "I")
    line = re.sub(r"^[■●▪◆▶▷□◆\-·•\s]+", "", line)
    line = re.sub(r"\s+", " ", line)
    return line.strip()


def canonical_option_label(label: str) -> str:
    compact = re.sub(r"\s+", "", label).upper()
    if compact in {"올스탯", "SAA", "SAR"}:
        return "올스탯"
    if compact in {"HP", "최대HP"}:
        return "최대 HP"
    return re.sub(r"\s+", " ", label.strip())


def extract_option_lines(lines: Sequence[str], start: int, end: int) -> list[str]:
    options: list[str] = []
    for line in lines[start:end]:
        match = OPTION_PATTERN.search(line)
        if match:
            label, value, percent = match.groups()
            label = canonical_option_label(label)
            options.append(f"{label} +{value}{percent or ''}")
        if len(options) == 3:
            break
    return options


def potential_equivalent_percent(option_lines: Sequence[str]) -> float | None:
    parsed: list[tuple[str, float]] = []
    for line in option_lines:
        match = OPTION_PATTERN.search(line)
        if not match or not match.group(3):
            continue
        label = canonical_option_label(match.group(1)).upper().replace(" ", "")
        if label not in {"STR", "DEX", "INT", "LUK", "올스탯"}:
            continue
        parsed.append((label, float(match.group(2))))
    if not parsed:
        return None
    stat_totals = {
        stat: sum(value for label, value in parsed if label in {stat, "올스탯"})
        for stat in ("STR", "DEX", "INT", "LUK")
    }
    return max(stat_totals.values())


def parse_ocr_fields(ocr_text: str, detected_starforce: int | None) -> dict[str, Any]:
    lines = [normalize_ocr_line(line) for line in ocr_text.splitlines()]
    lines = [line for line in lines if line]
    result: dict[str, Any] = {
        "item_name": "",
        "starforce_preset_id": "",
        "item_level": "",
        "item_category": "",
        "required_job": "",
        "starforce": detected_starforce if detected_starforce is not None else "",
        "upgrade_applied": "",
        "upgrade_remaining": "",
        "upgrade_recoverable": "",
        "main_potential_grade": "",
        "main_potential_lines": [],
        "main_potential_equiv_pct": "",
        "additional_potential_grade": "",
        "additional_potential_lines": [],
        "additional_potential_equiv_pct": "",
        "tradeability": "",
        "scissors_remaining": "",
        "scissors_total": "",
        "displayed_stats": {},
    }

    title_pattern = re.compile(r"^(.{2,80}?)\s*\(\s*\+\s*(\d+)\s*\)\s*$")
    for line in lines:
        title_match = title_pattern.search(line)
        if title_match and not result["item_name"]:
            result["item_name"] = title_match.group(1).strip()
            result["upgrade_applied"] = int(title_match.group(2))
        level_match = re.search(r"(?:요구\s*레벨|Lv\.?)\s*[:：]?\s*(\d{1,3})", line, re.IGNORECASE)
        if level_match and not result["item_level"]:
            result["item_level"] = int(level_match.group(1))
        job_match = re.search(r"착\s*용\s*직업\s*[:：]?\s*(.+)$", line)
        if job_match:
            result["required_job"] = job_match.group(1).strip()
        category_match = re.search(
            r"장신구\s+(펜던트|반지|귀고리|얼굴장식|눈장식|벨트|뱃지|포켓 아이템)",
            line,
        )
        if category_match:
            result["item_category"] = category_match.group(1)
        upgrade_match = re.search(
            r"(?:주문서\s*)?강화\s*(\d+)\s*[회희].*?잔여\s*(\d+)\s*회.*?복구\s*가능\s*(\d+)\s*회",
            line,
        )
        if upgrade_match:
            result["upgrade_applied"] = int(upgrade_match.group(1))
            result["upgrade_remaining"] = int(upgrade_match.group(2))
            result["upgrade_recoverable"] = int(upgrade_match.group(3))
        scissors_match = re.search(
            r"가위\s*사용\s*잔여\s*(?:횟|윗)\s*수\s*[:：]?\s*(\d+)\s*(?:/|7)\s*(\d+)",
            line,
        )
        if scissors_match:
            result["scissors_remaining"] = int(scissors_match.group(1))
            result["scissors_total"] = int(scissors_match.group(2))
        if re.search(r"1\s*회\s*교환\s*가능", line):
            result["tradeability"] = "1회 교환 가능"
        elif "교환 불가" in line and not result["tradeability"]:
            result["tradeability"] = "교환 불가"

        stat_match = STAT_LABEL_PATTERN.search(line)
        if stat_match:
            label, total, unit, components = stat_match.groups()
            component_values = []
            if components:
                component_values = [
                    value
                    for value in re.findall(r"[+-]?\d+(?:\.\d+)?%?", components.replace(" ", ""))
                ]
            normalized_label = re.sub(r"\s+", " ", label.upper())
            if unit == "%" and normalized_label in {"최대 HP", "최대 MP"}:
                normalized_label += " %"
            result["displayed_stats"][normalized_label] = {
                "total": f"{total}{unit or ''}",
                "components": component_values,
            }

    main_index = None
    additional_index = None
    for index, line in enumerate(lines):
        has_potential = re.search(r"잠\s*재", line) is not None
        has_additional = re.search(r"에\s*디\s*셔\s*널", line) is not None
        if has_additional and has_potential:
            additional_index = index
        elif has_potential and main_index is None:
            main_index = index
    if main_index is not None:
        main_end = additional_index if additional_index is not None else len(lines)
        grade_match = GRADE_PATTERN.search(lines[main_index])
        grade = grade_match.group(1) if grade_match else ""
        result["main_potential_grade"] = "레전드리" if grade == "레전드" else grade
        options = extract_option_lines(lines, main_index + 1, main_end)
        result["main_potential_lines"] = options
        equivalent = potential_equivalent_percent(options)
        result["main_potential_equiv_pct"] = equivalent if equivalent is not None else ""
    if additional_index is not None:
        grade_match = GRADE_PATTERN.search(lines[additional_index])
        grade = grade_match.group(1) if grade_match else ""
        result["additional_potential_grade"] = "레전드리" if grade == "레전드" else grade
        options = extract_option_lines(lines, additional_index + 1, len(lines))
        result["additional_potential_lines"] = options
        equivalent = potential_equivalent_percent(options)
        result["additional_potential_equiv_pct"] = equivalent if equivalent is not None else ""
    return result


def blank_review_row() -> dict[str, Any]:
    return {column: "" for column in REVIEW_COLUMNS}


def flatten_record_for_review(record: dict[str, Any]) -> dict[str, Any]:
    row = blank_review_row()
    market = record["market"]
    item = record["item"]
    extraction = record["extraction"]
    source = record["source"]
    row.update(
        {
            "schema_version": SCHEMA_VERSION,
            "record_id": record["record_id"],
            "review_status": "pending",
            "price_meso": market["price_meso"],
            "price_eok": market["price_eok"],
            "price_kind": market["price_kind"],
            "observed_at": market["observed_at"],
            "auction_group": market["auction_group"],
            "world": market["world"],
            "clean_price_meso": market.get("clean_price_meso", ""),
            "item_name": item.get("item_name", ""),
            "starforce_preset_id": item.get("starforce_preset_id", ""),
            "item_level": item.get("item_level", ""),
            "item_category": item.get("item_category", ""),
            "required_job": item.get("required_job", ""),
            "starforce": item.get("starforce", ""),
            "upgrade_applied": item.get("upgrade_applied", ""),
            "upgrade_remaining": item.get("upgrade_remaining", ""),
            "upgrade_recoverable": item.get("upgrade_recoverable", ""),
            "main_potential_grade": item.get("main_potential_grade", ""),
            "main_potential_equiv_pct": item.get("main_potential_equiv_pct", ""),
            "additional_potential_grade": item.get("additional_potential_grade", ""),
            "additional_potential_equiv_pct": item.get("additional_potential_equiv_pct", ""),
            "tradeability": item.get("tradeability", ""),
            "scissors_remaining": item.get("scissors_remaining", ""),
            "scissors_total": item.get("scissors_total", ""),
            "displayed_stats_json": json_dumps(item.get("displayed_stats", {})),
            "extraction_status": extraction["status"],
            "validation_flags": "|".join(extraction.get("validation_flags", [])),
            "source_filename": source["filename"],
            "source_relative_path": source["relative_path"],
            "source_sha256": source["sha256"],
            "pixel_sha256": source["pixel_sha256"],
            "phash": source["phash"],
            "duplicate_group_id": source.get("duplicate_group_id", f"dup-{record['record_id']}"),
            "image_width": source["width"],
            "image_height": source["height"],
            "ocr_engine": extraction["engine"],
            "ocr_confidence": extraction["confidence"],
            "ocr_text": extraction["raw_text"],
        }
    )
    for index, option in enumerate(item.get("main_potential_lines", [])[:3], 1):
        row[f"main_potential_line_{index}"] = option
    for index, option in enumerate(item.get("additional_potential_lines", [])[:3], 1):
        row[f"additional_potential_line_{index}"] = option
    return row


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise PipelineError(f"{path}:{line_number} JSON 오류: {exc}") from exc
    return records


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        for key, value in row.items():
            if isinstance(value, str) and len(value) >= 2 and value[0] == "'" and value[1] in "=+-@\t\r":
                row[key] = value[1:]
    return rows


def safe_csv_cell(value: Any, column: str) -> Any:
    if value is None:
        return ""
    if column in NUMERIC_CSV_COLUMNS:
        return value
    text = str(value)
    if text and text[0] in "=+-@\t\r":
        return "'" + text
    return text


def write_csv_rows(path: Path, rows: Sequence[dict[str, Any]], columns: Sequence[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(columns), extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {column: safe_csv_cell(row.get(column, ""), column) for column in columns}
                )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def iso_date(value: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise PipelineError(f"날짜는 YYYY-MM-DD 형식이어야 합니다: {value}") from exc


def item_name_key(value: str) -> str:
    return re.sub(r"\s+", "", normalize_text(value)).casefold()


def load_starforce_presets(path: str | Path = DEFAULT_STARFORCE_CALC) -> dict[str, dict[str, Any]]:
    source_path = Path(path).resolve()
    if not source_path.exists():
        raise PipelineError(f"스타포스 장비 기본값 파일을 찾을 수 없습니다: {source_path}")
    source = source_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"\{\s*id:\s*\"([^\"]+)\"\s*,\s*name:\s*\"([^\"]+)\"\s*,"
        r"\s*level:\s*(\d+)\s*,\s*price:\s*(\d+(?:\.\d+)?)"
    )
    presets: dict[str, dict[str, Any]] = {}
    for preset_id, name, level, price_eok in pattern.findall(source):
        price = Decimal(price_eok)
        presets[preset_id] = {
            "id": preset_id,
            "name": name,
            "level": int(level),
            "price_eok": float(price),
            "price_meso": decimal_to_int(price * Decimal("100000000")),
        }
    if not presets:
        raise PipelineError(f"스타포스 장비 기본값을 읽지 못했습니다: {source_path}")
    return presets


def load_preset_aliases(
    path: str | Path, presets: dict[str, dict[str, Any]]
) -> dict[str, str]:
    alias_path = Path(path).resolve()
    try:
        raw = json.loads(alias_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PipelineError(f"스타포스 장비 별칭 파일을 찾을 수 없습니다: {alias_path}") from exc
    except json.JSONDecodeError as exc:
        raise PipelineError(f"스타포스 장비 별칭 JSON 오류: {alias_path}") from exc
    if not isinstance(raw, dict):
        raise PipelineError("스타포스 장비 별칭은 JSON 객체여야 합니다")
    aliases = {
        item_name_key(preset["name"]): preset_id for preset_id, preset in presets.items()
    }
    aliases.update({item_name_key(preset_id): preset_id for preset_id in presets})
    for alias, preset_id in raw.items():
        if not isinstance(alias, str) or not isinstance(preset_id, str) or preset_id not in presets:
            raise PipelineError(f"잘못된 스타포스 장비 별칭: {alias!r} -> {preset_id!r}")
        aliases[item_name_key(alias)] = preset_id
    return aliases


def resolve_starforce_preset(
    item_name: str,
    presets: dict[str, dict[str, Any]],
    aliases: dict[str, str],
) -> dict[str, Any] | None:
    preset_id = aliases.get(item_name_key(item_name))
    return presets.get(preset_id) if preset_id else None


def resolve_ocr_starforce_preset(
    item_name: str,
    presets: dict[str, dict[str, Any]],
    aliases: dict[str, str],
    *,
    minimum_score: float = 0.84,
    minimum_margin: float = 0.06,
) -> tuple[dict[str, Any] | None, bool]:
    """Resolve a noisy OCR title without silently accepting a close ambiguity.

    Exact aliases remain authoritative. A fuzzy result is only accepted when it
    is both close to a known name and clearly better than the runner-up; callers
    keep it flagged for human review.
    """

    exact = resolve_starforce_preset(item_name, presets, aliases)
    if exact is not None:
        return exact, False
    key = item_name_key(item_name)
    if len(key) < 4:
        return None, False

    scores: dict[str, float] = defaultdict(float)
    for alias, preset_id in aliases.items():
        scores[preset_id] = max(scores[preset_id], SequenceMatcher(None, key, alias).ratio())
    ranking = sorted(((score, preset_id) for preset_id, score in scores.items()), reverse=True)
    if not ranking or ranking[0][0] < minimum_score:
        return None, False
    runner_up = ranking[1][0] if len(ranking) > 1 else 0.0
    if ranking[0][0] - runner_up < minimum_margin:
        return None, False
    return presets.get(ranking[0][1]), True


def apply_starforce_defaults_to_rows(rows: Sequence[dict[str, str]]) -> int:
    presets = load_starforce_presets()
    aliases = load_preset_aliases(DEFAULT_PRESET_ALIASES, presets)
    changed = 0
    for row in rows:
        preset_id = row.get("starforce_preset_id", "").strip()
        preset = presets.get(preset_id)
        if preset is None:
            preset = resolve_starforce_preset(row.get("item_name", ""), presets, aliases)
        if preset is None:
            continue
        if row.get("starforce_preset_id", "") != preset["id"]:
            row["starforce_preset_id"] = preset["id"]
            changed += 1
        if not row.get("clean_price_meso", "").strip():
            row["clean_price_meso"] = str(preset["price_meso"])
            changed += 1
    return changed


def load_reference_prices(path: str | None, as_of: str) -> dict[str, int]:
    if not path:
        return {}
    reference_path = Path(path).resolve()
    if not reference_path.exists():
        raise PipelineError(f"노작 시세 파일을 찾을 수 없습니다: {reference_path}")
    candidates: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for row_number, row in enumerate(read_csv_rows(reference_path), 2):
        name = normalize_text(row.get("item_name", ""))
        price = parse_optional_int(row.get("clean_price_meso"))
        observed_at = row.get("observed_at", "").strip()
        try:
            observed_at = iso_date(observed_at)
        except PipelineError as exc:
            raise PipelineError(f"노작 시세 파일 {row_number}행 날짜가 올바르지 않습니다") from exc
        if not name or price is None or price <= 0:
            raise PipelineError(f"노작 시세 파일 {row_number}행이 올바르지 않습니다")
        if observed_at <= as_of:
            candidates[name].append((observed_at, price))
    return {
        name: max(values, key=lambda value: value[0])[1]
        for name, values in candidates.items()
    }


def build_record(
    image_path: Path,
    input_root: Path,
    args: argparse.Namespace,
) -> dict[str, Any]:
    price = parse_price_filename(image_path, args.bare_unit)
    file_bytes = image_path.read_bytes()
    rgb_image, rgb_array = load_normalized_image(image_path)
    pixel_hash = normalized_pixel_hash(rgb_array)
    context_payload = "|".join(
        [pixel_hash, args.price_kind, args.observed_at, args.auction_group, args.world]
    ).encode("utf-8")
    observation_context_key = sha256_bytes(context_payload)
    observation_key = sha256_bytes(context_payload + f"|{price.meso}".encode("ascii"))
    record_id = uuid.uuid4().hex
    starforce, star_confidence = detect_starforce(rgb_array)

    if args.ocr == "none":
        ocr_result = {
            "status": "pending_manual",
            "engine": "none",
            "confidence": 0.0,
            "text": "",
            "warning": "OCR 비활성화",
        }
    else:
        ocr_result = run_tesseract(rgb_array, args.ocr_language)

    fields = parse_ocr_fields(ocr_result.get("text", ""), starforce)
    preset, item_name_fuzzy_matched = resolve_ocr_starforce_preset(
        fields.get("item_name", ""), args.starforce_presets, args.preset_aliases
    )
    if preset:
        fields["starforce_preset_id"] = preset["id"]
        if item_name_fuzzy_matched:
            fields["item_name"] = preset["name"]
    clean_price = preset["price_meso"] if preset else ""
    explicit_override = args.reference_price_map.get(normalize_text(fields.get("item_name", "")))
    if explicit_override is not None:
        clean_price = explicit_override
    validation_flags: list[str] = []
    if item_name_fuzzy_matched:
        validation_flags.append("item_name_fuzzy_matched")
    if not fields["item_name"]:
        validation_flags.append("item_name_missing")
    if starforce is None:
        validation_flags.append("starforce_unconfirmed")
    if ocr_result.get("warning"):
        validation_flags.append("ocr_unavailable")
    if star_confidence < 0.6 and starforce is not None:
        validation_flags.append("starforce_low_confidence")

    return {
        "schema_version": SCHEMA_VERSION,
        "record_id": record_id,
        "source": {
            "filename": image_path.name,
            "relative_path": image_path.relative_to(input_root).as_posix(),
            "sha256": sha256_bytes(file_bytes),
            "pixel_sha256": pixel_hash,
            "phash": perceptual_hash(rgb_array),
            "observation_context_key": observation_context_key,
            "observation_key": observation_key,
            "width": rgb_image.width,
            "height": rgb_image.height,
        },
        "market": {
            "price_text": price.token,
            "price_meso": price.meso,
            "price_eok": price.eok,
            "price_kind": args.price_kind,
            "observed_at": args.observed_at,
            "auction_group": args.auction_group,
            "world": args.world,
            "clean_price_meso": clean_price,
        },
        "item": fields,
        "extraction": {
            "status": ocr_result["status"],
            "engine": ocr_result["engine"],
            "confidence": ocr_result["confidence"],
            "starforce_confidence": star_confidence,
            "raw_text": ocr_result.get("text", ""),
            "warning": ocr_result.get("warning", ""),
            "validation_flags": validation_flags,
        },
        "review": {"status": "pending"},
    }


def command_ingest(args: argparse.Namespace) -> int:
    input_root = Path(args.input).resolve()
    output_root = Path(args.out).resolve()
    if not input_root.is_dir():
        raise PipelineError(f"사진 폴더를 찾을 수 없습니다: {input_root}")
    args.observed_at = iso_date(args.observed_at)
    if args.price_kind not in PRICE_KIND_VALUES:
        raise PipelineError("price-kind는 listing 또는 sold여야 합니다")
    args.starforce_presets = load_starforce_presets(args.starforce_calc)
    args.preset_aliases = load_preset_aliases(args.preset_aliases, args.starforce_presets)
    args.reference_price_map = load_reference_prices(args.reference_prices, args.observed_at)

    raw_path = output_root / "records.raw.jsonl"
    review_path = output_root / "review.csv"
    errors_path = output_root / "errors.csv"
    existing_records = {record["record_id"]: record for record in read_jsonl(raw_path)}
    existing_by_observation = {
        record.get("source", {}).get("observation_key", record["record_id"]): record
        for record in existing_records.values()
    }
    existing_by_context: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in existing_records.values():
        context_key = record.get("source", {}).get("observation_context_key", "")
        if context_key:
            existing_by_context[context_key].append(record)
    existing_review = {row.get("record_id", ""): row for row in read_csv_rows(review_path)}
    records = dict(existing_records)
    errors: list[dict[str, str]] = []
    added = 0
    skipped = 0

    image_paths = sorted(
        path for path in input_root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    for image_path in image_paths:
        try:
            record = build_record(image_path, input_root, args)
            record_id = record["record_id"]
            source = record["source"]
            if source["observation_key"] in existing_by_observation:
                skipped += 1
                continue
            same_context = existing_by_context.get(source["observation_context_key"], [])
            if same_context:
                old_prices = sorted({int(item["market"]["price_meso"]) for item in same_context})
                new_price = int(record["market"]["price_meso"])
                errors.append(
                    {
                        "source_filename": image_path.name,
                        "error": "price_conflict",
                        "detail": f"동일 이미지·관측조건 기존 {old_prices} / 신규 {new_price}",
                    }
                )
                continue
            records[record_id] = record
            existing_by_observation[source["observation_key"]] = record
            existing_by_context[source["observation_context_key"]].append(record)
            added += 1
        except Exception as exc:
            errors.append(
                {
                    "source_filename": image_path.name,
                    "error": exc.__class__.__name__,
                    "detail": str(exc),
                }
            )

    ordered_records = sorted(records.values(), key=lambda record: record["record_id"])
    assign_near_duplicate_groups(ordered_records)
    raw_text = "".join(json_dumps(record) + "\n" for record in ordered_records)
    atomic_write_text(raw_path, raw_text)

    review_rows = []
    for record in ordered_records:
        if record["record_id"] in existing_review:
            existing = existing_review[record["record_id"]]
            preserved = {column: existing.get(column, "") for column in REVIEW_COLUMNS}
            # This is derived data, not a reviewer field.  Always refresh it so a
            # newly ingested bridge image cannot split a duplicate cluster.
            preserved["duplicate_group_id"] = record["source"]["duplicate_group_id"]
            review_rows.append(preserved)
        else:
            review_rows.append(flatten_record_for_review(record))
    write_csv_rows(review_path, review_rows, REVIEW_COLUMNS)
    write_csv_rows(errors_path, errors, ["source_filename", "error", "detail"])

    print(f"사진 {len(image_paths)}개 확인 · 신규 {added}개 · 중복 {skipped}개 · 오류 {len(errors)}개")
    print(f"검수 파일: {review_path}")
    if args.ocr != "none" and not shutil.which("tesseract"):
        print("주의: Tesseract가 없어 항목은 수동 검수 대기로 저장했습니다.", file=sys.stderr)
    return 0 if not errors else 2


def parse_optional_float(value: Any) -> float | None:
    text = str(value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def parse_optional_int(value: Any) -> int | None:
    number = parse_optional_float(value)
    if number is None or not number.is_integer():
        return None
    return int(number)


def validation_errors(row: dict[str, str], *, approved_only: bool = False) -> list[str]:
    errors: list[str] = []
    status = row.get("review_status", "").strip()
    if status not in REVIEW_STATUS_VALUES:
        errors.append("review_status_invalid")
    if approved_only and status != "approved":
        return errors
    if status != "approved":
        return errors

    for required in APPROVED_REQUIRED_TEXT_FIELDS:
        if not row.get(required, "").strip():
            errors.append(f"{required}_missing")
    for required in APPROVED_REQUIRED_NUMERIC_FIELDS:
        if parse_optional_float(row.get(required)) is None:
            errors.append(f"{required}_missing_or_invalid")
    if row.get("price_kind") not in PRICE_KIND_VALUES:
        errors.append("price_kind_invalid")
    try:
        iso_date(row.get("observed_at", ""))
    except PipelineError:
        errors.append("observed_at_invalid")
    price = parse_optional_int(row.get("price_meso"))
    if price is None or price <= 0:
        errors.append("price_meso_invalid")
    starforce = parse_optional_int(row.get("starforce"))
    if starforce is None or not 0 <= starforce <= 30:
        errors.append("starforce_invalid")
    item_level = parse_optional_int(row.get("item_level"))
    if item_level is None or not 0 <= item_level <= 300:
        errors.append("item_level_invalid")
    for column in ("upgrade_applied", "upgrade_remaining", "upgrade_recoverable"):
        value = parse_optional_int(row.get(column))
        if value is None or not 0 <= value <= 30:
            errors.append(f"{column}_invalid")
    for column in (
        "scroll_main_stat",
        "scroll_attack",
        "scroll_magic",
        "flame_main_stat",
        "flame_sub_stat",
        "flame_all_stat_pct",
        "flame_attack",
        "flame_score",
        "scissors_remaining",
        "scissors_total",
        "clean_price_meso",
    ):
        value = parse_optional_float(row.get(column))
        if value is None or value < 0:
            errors.append(f"{column}_invalid")
    for column in ("main_potential_grade", "additional_potential_grade"):
        grade = row.get(column, "").strip()
        if grade not in POTENTIAL_GRADES:
            errors.append(f"{column}_invalid")
    for section, columns in POTENTIAL_LINE_COLUMNS.items():
        grade = row.get(f"{section}_potential_grade", "").strip()
        option_lines = [row.get(column, "").strip() for column in columns]
        if grade == "없음":
            if any(option_lines):
                errors.append(f"{section}_potential_lines_present_with_none_grade")
        elif grade in POTENTIAL_GRADES and any(not line for line in option_lines):
            errors.append(f"{section}_potential_lines_incomplete")
    return errors


def command_validate(args: argparse.Namespace) -> int:
    review_path = Path(args.review).resolve()
    rows = read_csv_rows(review_path)
    apply_starforce_defaults_to_rows(rows)
    if not rows:
        raise PipelineError(f"검수 행이 없습니다: {review_path}")
    invalid: list[dict[str, str]] = []
    approved = 0
    for row_number, row in enumerate(rows, 2):
        errors = validation_errors(row)
        if row.get("review_status") == "approved":
            approved += 1
        if errors:
            invalid.append(
                {
                    "row": str(row_number),
                    "record_id": row.get("record_id", ""),
                    "errors": "|".join(errors),
                }
            )
    if invalid:
        for item in invalid:
            print(f"{item['row']}행 {item['record_id']}: {item['errors']}", file=sys.stderr)
        return 2
    print(f"검증 완료 · 전체 {len(rows)}건 · 승인 {approved}건")
    return 0


def public_comparable(row: dict[str, str]) -> dict[str, Any]:
    public = {
        "id": row["record_id"],
        "market": {
            "price_meso": str(parse_optional_int(row["price_meso"])),
            "price_eok": float(row["price_meso"]) / 100_000_000,
            "price_kind": row["price_kind"],
            "observed_at": row["observed_at"],
            "auction_group": row.get("auction_group", ""),
            "world": row.get("world", ""),
        },
        "item": {},
    }
    for key in PUBLIC_ITEM_FIELDS:
        value = row.get(key, "")
        if value == "":
            continue
        numeric = parse_optional_float(value)
        public["item"][key] = (
            numeric
            if key in NUMERIC_CSV_COLUMNS
            and numeric is not None
            and re.fullmatch(r"-?\d+(?:\.\d+)?", value)
            else value
        )

    displayed_stats = row.get("displayed_stats_json", "")
    if displayed_stats:
        try:
            parsed_stats = json.loads(displayed_stats)
        except json.JSONDecodeError:
            parsed_stats = {}
        safe_stats = {}
        allowed_labels = {
            "STR",
            "DEX",
            "INT",
            "LUK",
            "올스탯",
            "최대 HP",
            "최대 HP %",
            "최대 MP",
            "최대 MP %",
            "공격력",
            "마력",
            "방어력",
        }
        if isinstance(parsed_stats, dict):
            for label, value in parsed_stats.items():
                if label not in allowed_labels or not isinstance(value, dict):
                    continue
                total = str(value.get("total", ""))
                components = value.get("components", [])
                if not re.fullmatch(r"-?\d+(?:\.\d+)?%?", total):
                    continue
                safe_components = [
                    str(component)
                    for component in components
                    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?%?", str(component))
                ]
                safe_stats[label] = {"total": total, "components": safe_components}
        if safe_stats:
            public["item"]["displayed_stats"] = safe_stats
    return public


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_export(args: argparse.Namespace) -> int:
    review_path = Path(args.review).resolve()
    out_dir = Path(args.out).resolve()
    rows = read_csv_rows(review_path)
    apply_starforce_defaults_to_rows(rows)
    approved: list[dict[str, str]] = []
    invalid = []
    for row_number, row in enumerate(rows, 2):
        if row.get("review_status") != "approved":
            continue
        errors = validation_errors(row, approved_only=True)
        if errors:
            invalid.append((row_number, row.get("record_id", ""), errors))
        else:
            approved.append(row)
    if invalid:
        detail = "; ".join(f"{number}행 {record_id}: {','.join(errors)}" for number, record_id, errors in invalid)
        raise PipelineError(f"승인 행 검증 실패: {detail}")
    if not approved:
        raise PipelineError("내보낼 승인 행이 없습니다")

    cutoff = max(row["observed_at"] for row in approved)
    suffix = cutoff.replace("-", "")
    out_dir.mkdir(parents=True, exist_ok=True)
    comparable_path = out_dir / f"comparables.v1.{suffix}.json"
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "cutoff": cutoff,
        "count": len(approved),
        "comparables": [public_comparable(row) for row in approved],
    }
    atomic_write_text(comparable_path, json_dumps(payload, pretty=True) + "\n")
    manifest_path = out_dir / "market-artifacts.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise PipelineError(f"활성 파일 목록 JSON 오류: {manifest_path}") from exc
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise PipelineError("기존 활성 파일 목록의 스키마 버전이 다릅니다")
    else:
        manifest = {"schema_version": SCHEMA_VERSION}
    manifest["generated_at"] = payload["generated_at"]
    manifest["comparables"] = {
        "file": comparable_path.name,
        "sha256": sha256_file(comparable_path),
        "row_count": len(approved),
        "cutoff": cutoff,
    }
    atomic_write_text(manifest_path, json_dumps(manifest, pretty=True) + "\n")
    print(f"승인 비교매물 {len(approved)}건 내보냄: {comparable_path}")
    print(f"활성 파일 목록: {manifest_path}")
    return 0


def clean_price_eok(row: dict[str, str]) -> float | None:
    value = parse_optional_float(row.get("clean_price_meso"))
    return None if value is None else value / 100_000_000


def numeric_value(row: dict[str, str], feature: str) -> float | None:
    if feature == "clean_price_eok":
        return clean_price_eok(row)
    return parse_optional_float(row.get(feature))


def canonical_option_token(value: str) -> str:
    token = normalize_text(value).upper()
    replacements = {
        "보스 공격 시 데미지": "보스데미지",
        "보스 몬스터 공격 시 데미지": "보스데미지",
        "몬스터 방어율 무시": "방어율무시",
        "아이템 드롭률": "드롭률",
        "메소 획득량": "메획",
    }
    for source, target in replacements.items():
        token = token.replace(source.upper(), target.upper())
    token = re.sub(r"[\s:：]", "", token)
    token = re.sub(r"^[■●▪◆▶▷□·•]+", "", token)
    return token[:120]


def row_option_tokens(row: dict[str, str], section: str) -> list[str]:
    tokens = [canonical_option_token(row.get(column, "")) for column in POTENTIAL_LINE_COLUMNS[section]]
    return [token for token in tokens if token]


def fit_feature_contract(rows: Sequence[dict[str, str]]) -> dict[str, Any]:
    numeric: dict[str, dict[str, float]] = {}
    for feature in NUMERIC_FEATURES:
        values = [value for row in rows if (value := numeric_value(row, feature)) is not None]
        median = statistics.median(values) if values else 0.0
        scale = statistics.pstdev(values) if len(values) > 1 else 1.0
        if scale < 1e-9:
            scale = 1.0
        numeric[feature] = {"median": float(median), "scale": float(scale)}
    categories = {
        feature: sorted({row.get(feature, "").strip() or "__MISSING__" for row in rows})
        for feature in CATEGORICAL_FEATURES
    }
    option_tokens = {
        section: sorted({token for row in rows for token in row_option_tokens(row, section)})
        for section in POTENTIAL_LINE_COLUMNS
    }
    return {"numeric": numeric, "categories": categories, "option_tokens": option_tokens}


def encode_rows(rows: Sequence[dict[str, str]], contract: dict[str, Any]) -> tuple[Any, list[str]]:
    if np is None:
        raise PipelineError("가격 모델 학습에는 numpy가 필요합니다")
    names: list[str] = []
    for feature in NUMERIC_FEATURES:
        names.extend([feature, f"{feature}__missing"])
    for feature in CATEGORICAL_FEATURES:
        names.extend(f"{feature}={category}" for category in contract["categories"][feature])
    for section in POTENTIAL_LINE_COLUMNS:
        names.extend(f"{section}_option={token}" for token in contract["option_tokens"][section])
    names.extend(["starforce_squared", "starforce_x_main_potential", "main_x_additional_potential"])

    matrix = []
    for row in rows:
        values: list[float] = []
        normalized: dict[str, float] = {}
        for feature in NUMERIC_FEATURES:
            raw = numeric_value(row, feature)
            config = contract["numeric"][feature]
            missing = raw is None
            filled = config["median"] if missing else float(raw)
            standard = (filled - config["median"]) / config["scale"]
            normalized[feature] = standard
            values.extend([standard, float(missing)])
        for feature in CATEGORICAL_FEATURES:
            category = row.get(feature, "").strip() or "__MISSING__"
            values.extend(float(category == known) for known in contract["categories"][feature])
        for section in POTENTIAL_LINE_COLUMNS:
            counts: dict[str, int] = defaultdict(int)
            for token in row_option_tokens(row, section):
                counts[token] += 1
            values.extend(float(counts.get(known, 0)) for known in contract["option_tokens"][section])
        star = normalized["starforce"]
        main = normalized["main_potential_equiv_pct"]
        additional = normalized["additional_potential_equiv_pct"]
        values.extend([star * star, star * main, main * additional])
        matrix.append(values)
    return np.asarray(matrix, dtype=float), names


def ridge_fit(
    matrix: Any, target: Any, alpha: float, sample_weights: Any | None = None
) -> tuple[float, Any]:
    ones = np.ones((matrix.shape[0], 1), dtype=float)
    design = np.concatenate([ones, matrix], axis=1)
    if sample_weights is not None:
        roots = np.sqrt(np.asarray(sample_weights, dtype=float)).reshape(-1, 1)
        design_for_fit = design * roots
        target_for_fit = target * roots[:, 0]
    else:
        design_for_fit = design
        target_for_fit = target
    penalty = np.eye(design.shape[1], dtype=float) * alpha
    penalty[0, 0] = 0.0
    coefficients = (
        np.linalg.pinv(design_for_fit.T @ design_for_fit + penalty)
        @ design_for_fit.T
        @ target_for_fit
    )
    return float(coefficients[0]), coefficients[1:]


def predict_matrix(matrix: Any, intercept: float, coefficients: Any) -> Any:
    return np.expm1(intercept + matrix @ coefficients)


def weighted_quantile(values: Any, weights: Any, quantile: float) -> float:
    order = np.argsort(values)
    sorted_values = np.asarray(values)[order]
    sorted_weights = np.asarray(weights, dtype=float)[order]
    cumulative = np.cumsum(sorted_weights)
    cutoff = quantile * float(cumulative[-1])
    return float(sorted_values[min(int(np.searchsorted(cumulative, cutoff, side="left")), len(sorted_values) - 1)])


def regression_metrics(actual: Any, predicted: Any, sample_weights: Any | None = None) -> dict[str, float]:
    errors = np.abs(actual - predicted)
    denominator = np.maximum(np.abs(actual), 0.01)
    weights = np.ones_like(errors, dtype=float) if sample_weights is None else np.asarray(sample_weights, dtype=float)
    return {
        "mae_eok": round(float(np.average(errors, weights=weights)), 4),
        "median_absolute_percentage_error": round(
            weighted_quantile(errors / denominator, weights, 0.5), 6
        ),
        "p80_absolute_error_eok": round(weighted_quantile(errors, weights, 0.8), 4),
    }


def duplicate_group_weights(rows: Sequence[dict[str, str]]) -> Any:
    counts: dict[str, int] = defaultdict(int)
    group_ids = []
    for row in rows:
        group_id = row.get("duplicate_group_id", "").strip() or row["record_id"]
        group_ids.append(group_id)
        counts[group_id] += 1
    return np.asarray([1.0 / counts[group_id] for group_id in group_ids], dtype=float)


def strict_time_group_split(
    duplicate_groups: dict[str, list[dict[str, str]]]
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]], str]:
    unique_dates = sorted({row["observed_at"] for group in duplicate_groups.values() for row in group})
    choices = []
    for cutoff in unique_dates[:-1]:
        train_groups = []
        test_groups = []
        bridge_groups = []
        for group in duplicate_groups.values():
            minimum = min(row["observed_at"] for row in group)
            maximum = max(row["observed_at"] for row in group)
            if maximum <= cutoff:
                train_groups.append(group)
            elif minimum > cutoff:
                test_groups.append(group)
            else:
                bridge_groups.append(group)
        if not train_groups or not test_groups:
            continue
        usable_group_count = len(train_groups) + len(test_groups)
        ratio = len(train_groups) / usable_group_count
        score = abs(ratio - 0.8) + len(bridge_groups) / max(len(duplicate_groups), 1)
        choices.append((score, cutoff, train_groups, test_groups, bridge_groups))
    if not choices:
        raise PipelineError(
            "중복 그룹을 보존하면서 엄격한 시간순 검증을 만들 수 없습니다. 관측일이 다른 독립 표본이 필요합니다"
        )
    _, cutoff, train_groups, test_groups, bridge_groups = min(choices, key=lambda value: value[0])
    train_rows = [row for group in train_groups for row in group]
    test_rows = [row for group in test_groups for row in group]
    excluded_rows = [row for group in bridge_groups for row in group]
    if max(row["observed_at"] for row in train_rows) >= min(row["observed_at"] for row in test_rows):
        raise PipelineError("내부 오류: 학습·검증 기간이 겹칩니다")
    return train_rows, test_rows, excluded_rows, cutoff


def training_snapshot_sha256(rows: Sequence[dict[str, str]]) -> str:
    columns = sorted(
        {
            "record_id",
            "duplicate_group_id",
            "price_meso",
            "price_kind",
            "observed_at",
            *NUMERIC_FEATURES,
            *CATEGORICAL_FEATURES,
            *(column for columns in POTENTIAL_LINE_COLUMNS.values() for column in columns),
            "clean_price_meso",
        }
    )
    canonical_rows = [
        {column: row.get(column, "") for column in columns}
        for row in sorted(rows, key=lambda item: item["record_id"])
    ]
    return sha256_bytes(json_dumps(canonical_rows).encode("utf-8"))


def command_train(args: argparse.Namespace) -> int:
    review_path = Path(args.review).resolve()
    out_path = Path(args.out).resolve()
    all_rows = read_csv_rows(review_path)
    apply_starforce_defaults_to_rows(all_rows)
    rows = [
        row
        for row in all_rows
        if row.get("review_status") == "approved" and row.get("price_kind") == args.price_kind
    ]
    invalid_rows = [
        (index, row, validation_errors(row, approved_only=True))
        for index, row in enumerate(rows, 1)
        if validation_errors(row, approved_only=True)
    ]
    if invalid_rows:
        details = "; ".join(
            f"{row.get('record_id', index)}: {','.join(errors)}"
            for index, row, errors in invalid_rows[:10]
        )
        raise PipelineError(f"승인된 {args.price_kind} 행 검증 실패: {details}")
    valid_rows = rows
    duplicate_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in valid_rows:
        group_id = row.get("duplicate_group_id", "").strip() or row["record_id"]
        duplicate_groups[group_id].append(row)
    if len(duplicate_groups) < args.min_samples:
        raise PipelineError(
            f"{args.price_kind} 승인 독립 이미지 그룹이 {len(duplicate_groups)}개입니다. "
            f"최소 {args.min_samples}개가 필요합니다"
        )

    valid_rows.sort(key=lambda row: (row["observed_at"], row["record_id"]))
    train_rows, test_rows, excluded_rows, evaluation_cutoff = strict_time_group_split(
        duplicate_groups
    )
    evaluation_contract = fit_feature_contract(train_rows)
    train_matrix, _ = encode_rows(train_rows, evaluation_contract)
    test_matrix, _ = encode_rows(test_rows, evaluation_contract)
    train_target_eok = np.asarray([float(row["price_meso"]) / 100_000_000 for row in train_rows])
    test_target_eok = np.asarray([float(row["price_meso"]) / 100_000_000 for row in test_rows])
    train_weights = duplicate_group_weights(train_rows)
    test_weights = duplicate_group_weights(test_rows)
    intercept, coefficients = ridge_fit(
        train_matrix, np.log1p(train_target_eok), args.alpha, train_weights
    )
    test_prediction = predict_matrix(test_matrix, intercept, coefficients)
    metrics = regression_metrics(test_target_eok, test_prediction, test_weights)

    final_contract = fit_feature_contract(valid_rows)
    final_matrix, feature_names = encode_rows(valid_rows, final_contract)
    final_target_eok = np.asarray([float(row["price_meso"]) / 100_000_000 for row in valid_rows])
    final_weights = duplicate_group_weights(valid_rows)
    final_intercept, final_coefficients = ridge_fit(
        final_matrix, np.log1p(final_target_eok), args.alpha, final_weights
    )
    in_sample_prediction = predict_matrix(final_matrix, final_intercept, final_coefficients)
    residuals = np.abs(final_target_eok - in_sample_prediction)

    model = {
        "schema_version": SCHEMA_VERSION,
        "feature_version": FEATURE_VERSION,
        "model_type": "ridge_log_price",
        "price_kind": args.price_kind,
        "trained_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "training_cutoff": max(row["observed_at"] for row in valid_rows),
        "training_rows": len(valid_rows),
        "training_independent_groups": len(duplicate_groups),
        "training_snapshot_sha256": training_snapshot_sha256(valid_rows),
        "target": "log1p(price_eok)",
        "alpha": args.alpha,
        "contract": final_contract,
        "feature_names": feature_names,
        "intercept": final_intercept,
        "coefficients": [float(value) for value in final_coefficients],
        "evaluation": {
            "method": "strict_time_cutoff_grouped_holdout",
            "cutoff": evaluation_cutoff,
            "train_rows": len(train_rows),
            "test_rows": len(test_rows),
            "excluded_bridge_rows": len(excluded_rows),
            "train_independent_groups": len(
                {row.get("duplicate_group_id") or row["record_id"] for row in train_rows}
            ),
            "test_independent_groups": len(
                {row.get("duplicate_group_id") or row["record_id"] for row in test_rows}
            ),
            **metrics,
        },
        "uncertainty": {
            "in_sample_absolute_error_eok_p50": round(
                weighted_quantile(residuals, final_weights, 0.5), 4
            ),
            "in_sample_absolute_error_eok_p80": round(
                weighted_quantile(residuals, final_weights, 0.8), 4
            ),
        },
        "warnings": [
            "항목별 계수는 인과적인 실제 가격이 아니라 모델의 추정 기여도입니다.",
            "현재 등록가(listing)와 거래 완료가(sold)는 별도 모델입니다.",
        ],
    }
    atomic_write_text(out_path, json_dumps(model, pretty=True) + "\n")
    manifest_path = out_path.parent / "market-artifacts.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise PipelineError(f"활성 파일 목록 JSON 오류: {manifest_path}") from exc
        if manifest.get("schema_version") != SCHEMA_VERSION:
            raise PipelineError("기존 활성 파일 목록의 스키마 버전이 다릅니다")
    else:
        manifest = {"schema_version": SCHEMA_VERSION}
    manifest["generated_at"] = model["trained_at"]
    manifest.setdefault("models", {})[args.price_kind] = {
        "file": out_path.name,
        "sha256": sha256_file(out_path),
        "row_count": len(valid_rows),
        "independent_group_count": len(duplicate_groups),
        "cutoff": model["training_cutoff"],
        "feature_version": FEATURE_VERSION,
    }
    atomic_write_text(manifest_path, json_dumps(manifest, pretty=True) + "\n")
    print(
        f"{args.price_kind} 모델 {len(valid_rows)}건 학습 · "
        f"시간순 검증 MAE {metrics['mae_eok']:.4f}억: {out_path}"
    )
    return 0


def command_sync_prices(args: argparse.Namespace) -> int:
    review_path = Path(args.review).resolve()
    rows = read_csv_rows(review_path)
    if not rows:
        raise PipelineError(f"검수 행이 없습니다: {review_path}")
    changed = apply_starforce_defaults_to_rows(rows)
    write_csv_rows(review_path, rows, REVIEW_COLUMNS)
    print(f"스타포스 장비 기본값 동기화 · 수정된 칸 {changed}개: {review_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="메이플 장비 스크린샷을 로컬 검수 데이터와 가격 모델로 변환합니다."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="사진 폴더를 OCR하고 검수 CSV를 만듭니다")
    ingest.add_argument("input", help="가격을 파일명으로 적은 사진 폴더")
    ingest.add_argument("--out", default="market-data", help="로컬 산출물 폴더")
    ingest.add_argument("--price-kind", choices=sorted(PRICE_KIND_VALUES), required=True)
    ingest.add_argument("--observed-at", required=True, help="관측일 YYYY-MM-DD")
    ingest.add_argument("--auction-group", default="", help="메이플 옥션 그룹")
    ingest.add_argument("--world", default="", help="월드 메모")
    ingest.add_argument(
        "--starforce-calc",
        default=str(DEFAULT_STARFORCE_CALC),
        help="EQUIPMENT_PRESETS가 있는 스타포스 calc.js",
    )
    ingest.add_argument(
        "--preset-aliases",
        default=str(DEFAULT_PRESET_ALIASES),
        help="툴팁 장비명과 스타포스 preset id 별칭 JSON",
    )
    ingest.add_argument(
        "--reference-prices",
        default="",
        help="선택 사항: 스타포스 기본값을 덮어쓸 아이템명별 노작 시세 CSV",
    )
    ingest.add_argument("--bare-unit", choices=("eok", "meso"), default="eok")
    ingest.add_argument("--ocr", choices=("auto", "none"), default="auto")
    ingest.add_argument("--ocr-language", default="kor+eng")
    ingest.set_defaults(handler=command_ingest)

    validate = subparsers.add_parser("validate", help="review.csv를 검증합니다")
    validate.add_argument("review")
    validate.set_defaults(handler=command_validate)

    sync_prices = subparsers.add_parser(
        "sync-prices", help="스타포스 프리셋의 노작 기본값을 review.csv에 채웁니다"
    )
    sync_prices.add_argument("review")
    sync_prices.set_defaults(handler=command_sync_prices)

    export = subparsers.add_parser("export", help="승인된 행만 공개용 JSON으로 내보냅니다")
    export.add_argument("review")
    export.add_argument("--out", required=True)
    export.set_defaults(handler=command_export)

    train = subparsers.add_parser("train", help="승인된 데이터로 경량 가격 모델을 학습합니다")
    train.add_argument("review")
    train.add_argument("--out", required=True)
    train.add_argument("--price-kind", choices=sorted(PRICE_KIND_VALUES), required=True)
    train.add_argument("--min-samples", type=int, default=20)
    train.add_argument("--alpha", type=float, default=10.0)
    train.set_defaults(handler=command_train)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except PipelineError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("중단했습니다.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
