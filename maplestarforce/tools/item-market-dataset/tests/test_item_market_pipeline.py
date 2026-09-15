import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "item_market_pipeline.py"
SPEC = importlib.util.spec_from_file_location("item_market_pipeline", MODULE_PATH)
pipeline = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = pipeline
SPEC.loader.exec_module(pipeline)


class PriceParserTests(unittest.TestCase):
    def test_korean_units(self):
        cases = {
            "75억.jpg": 7_500_000_000,
            "75억_데브펜01.png": 7_500_000_000,
            "75.5억__01.png": 7_550_000_000,
            "75억5000만.jpg": 7_550_000_000,
            "1000만.webp": 10_000_000,
            "7500000000메소.jpg": 7_500_000_000,
            "75.jpg": 7_500_000_000,
        }
        for filename, expected in cases.items():
            with self.subTest(filename=filename):
                self.assertEqual(pipeline.parse_price_filename(filename).meso, expected)

    def test_bad_price_is_rejected(self):
        with self.assertRaises(pipeline.PipelineError):
            pipeline.parse_price_filename("시세미정.jpg")

    def test_reference_price_does_not_look_into_future(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "reference.csv"
            path.write_text(
                "item_name,clean_price_meso,observed_at\n"
                "데이브레이크 펜던트,15000000,2026-01-01\n"
                "데이브레이크 펜던트,10000000,2026-09-01\n",
                encoding="utf-8",
            )
            prices = pipeline.load_reference_prices(str(path), "2026-06-01")
            self.assertEqual(prices["데이브레이크 펜던트"], 15_000_000)

    def test_starforce_default_price_is_single_source(self):
        presets = pipeline.load_starforce_presets()
        aliases = pipeline.load_preset_aliases(pipeline.DEFAULT_PRESET_ALIASES, presets)
        preset = pipeline.resolve_starforce_preset("데이브레이크 펜던트", presets, aliases)
        self.assertIsNotNone(preset)
        self.assertEqual(preset["id"], "daybreak-pendant")
        self.assertEqual(preset["price_meso"], 15_000_000)

        row = {column: "" for column in pipeline.REVIEW_COLUMNS}
        row["item_name"] = "데이브레이크 펜던트"
        changed = pipeline.apply_starforce_defaults_to_rows([row])
        self.assertEqual(changed, 2)
        self.assertEqual(row["starforce_preset_id"], "daybreak-pendant")
        self.assertEqual(row["clean_price_meso"], "15000000")


class OcrParserTests(unittest.TestCase):
    def test_daybreak_tooltip_text(self):
        text = """
        데이브레이크 펜던트 (+6)
        1회 교환 가능 (거래 후 교환 불가)
        가위 사용 잔여 횟수 : 9 / 10
        요구레벨 Lv. 140
        착용 직업 궁수
        DEX +190 (8+94+8+80)
        공격력 +85 (2+63+20)
        주문서 강화 6회 (잔여 0회, 복구 가능 0회)
        잠재능력 : 레전드리
        올스탯 +9%
        DEX +9%
        DEX +9%
        에디셔널 잠재능력 : 에픽
        DEX +5
        올스탯 +3
        최대 HP +100
        """
        parsed = pipeline.parse_ocr_fields(text, 21)
        self.assertEqual(parsed["item_name"], "데이브레이크 펜던트")
        self.assertEqual(parsed["starforce"], 21)
        self.assertEqual(parsed["upgrade_applied"], 6)
        self.assertEqual(parsed["upgrade_remaining"], 0)
        self.assertEqual(parsed["main_potential_grade"], "레전드리")
        self.assertEqual(parsed["main_potential_equiv_pct"], 27)
        self.assertEqual(parsed["additional_potential_grade"], "에픽")
        self.assertEqual(parsed["scissors_remaining"], 9)
        self.assertNotIn("raw", parsed["displayed_stats"]["DEX"])

    def test_tsv_lines_use_numeric_order(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
        row_10 = "5\t1\t1\t1\t10\t1\t0\t20\t10\t10\t90\t열번째"
        row_2 = "5\t1\t1\t1\t2\t1\t0\t10\t10\t10\t90\t두번째"
        lines, _ = pipeline.tsv_to_lines("\n".join([header, row_10, row_2]))
        self.assertEqual(lines, ["두번째", "열번째"])

    def test_noisy_daybreak_tesseract_text_keeps_reviewable_fields(self):
        text = """
        데 이 브 이크 레 펜던트 (+6)
        1 회 교환 가능 (거래 후 교환 불가)
        (가위 사용 잔여 윗 수 : 9 7 10)
        장신구 펜던트
        착 용 직업 공용
        Lv. 140
        eM 강화 6 희 (잔여 0 회, 복구 가능 0 회)
        매 잠 재 능력 : 레전드
        SAA +9%
        DEX +9%
        DEX +9%
        에 디 셔널 잠 재 능력 : 에픽
        DEX +4%
        SAR +3
        4/Cj HP +100
        """
        parsed = pipeline.parse_ocr_fields(text, 21)
        self.assertEqual(parsed["required_job"], "공용")
        self.assertEqual(parsed["item_category"], "펜던트")
        self.assertEqual(parsed["upgrade_remaining"], 0)
        self.assertEqual(parsed["upgrade_recoverable"], 0)
        self.assertEqual(parsed["tradeability"], "1회 교환 가능")
        self.assertEqual(parsed["scissors_remaining"], 9)
        self.assertEqual(parsed["scissors_total"], 10)
        self.assertEqual(parsed["main_potential_grade"], "레전드리")
        self.assertEqual(parsed["main_potential_lines"], ["올스탯 +9%", "DEX +9%", "DEX +9%"])
        self.assertEqual(parsed["main_potential_equiv_pct"], 27)
        self.assertEqual(parsed["additional_potential_lines"][-2:], ["올스탯 +3", "최대 HP +100"])

    def test_noisy_title_only_fuzzy_matches_with_review_flag(self):
        presets = pipeline.load_starforce_presets()
        aliases = pipeline.load_preset_aliases(pipeline.DEFAULT_PRESET_ALIASES, presets)
        preset, fuzzy = pipeline.resolve_ocr_starforce_preset(
            "데 이 브 이크 레 펜던트", presets, aliases
        )
        self.assertTrue(fuzzy)
        self.assertIsNotNone(preset)
        self.assertEqual(preset["id"], "daybreak-pendant")

    def test_flat_and_percent_hp_do_not_overwrite_each_other(self):
        parsed = pipeline.parse_ocr_fields("최대 HP +255 (0+255)\n최대 HP +5%", None)
        self.assertEqual(parsed["displayed_stats"]["최대 HP"]["total"], "255")
        self.assertEqual(parsed["displayed_stats"]["최대 HP %"]["total"], "5%")


class PipelineTests(unittest.TestCase):
    def test_incomplete_approved_row_is_rejected(self):
        row = {column: "" for column in pipeline.REVIEW_COLUMNS}
        row.update(
            {
                "record_id": "incomplete",
                "review_status": "approved",
                "price_meso": "7500000000",
                "price_kind": "sold",
                "observed_at": "2026-09-01",
                "item_name": "데이브레이크 펜던트",
                "starforce": "21",
            }
        )
        errors = pipeline.validation_errors(row, approved_only=True)
        self.assertIn("scroll_kind_missing", errors)
        self.assertIn("main_potential_grade_missing", errors)

    def test_strict_time_split_excludes_bridge_group(self):
        groups = {
            "bridge": [
                {"record_id": "a", "observed_at": "2026-01-01"},
                {"record_id": "b", "observed_at": "2026-12-01"},
            ],
            "early": [{"record_id": "c", "observed_at": "2026-02-01"}],
            "late": [{"record_id": "d", "observed_at": "2026-11-01"}],
        }
        train, test, excluded, _ = pipeline.strict_time_group_split(groups)
        self.assertLess(
            max(row["observed_at"] for row in train),
            min(row["observed_at"] for row in test),
        )
        self.assertEqual({row["record_id"] for row in excluded}, {"a", "b"})

    def test_ingest_without_ocr_and_export_only_approved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            photos = root / "photos"
            output = root / "market-data"
            public = root / "public"
            photos.mkdir()
            Image.new("RGB", (315, 781), (25, 27, 34)).save(photos / "75억.jpg")
            reference = root / "reference.csv"
            reference.write_text("item_name,clean_price_meso,observed_at\n", encoding="utf-8")

            exit_code = pipeline.main(
                [
                    "ingest",
                    str(photos),
                    "--out",
                    str(output),
                    "--price-kind",
                    "listing",
                    "--observed-at",
                    "2026-09-01",
                    "--ocr",
                    "none",
                    "--reference-prices",
                    str(reference),
                ]
            )
            self.assertEqual(exit_code, 0)
            rows = pipeline.read_csv_rows(output / "review.csv")
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["price_meso"], "7500000000")
            self.assertEqual(rows[0]["review_status"], "pending")

            rows[0].update(
                {
                    "review_status": "approved",
                    "auction_group": "1",
                    "item_name": "데이브레이크 펜던트",
                    "item_level": "140",
                    "item_category": "펜던트",
                    "required_job": "궁수",
                    "starforce": "21",
                    "upgrade_applied": "6",
                    "upgrade_remaining": "0",
                    "upgrade_recoverable": "0",
                    "scroll_kind": "혼돈류 결과",
                    "scroll_main_stat": "8",
                    "scroll_attack": "20",
                    "scroll_magic": "7",
                    "flame_main_stat": "80",
                    "flame_sub_stat": "0",
                    "flame_all_stat_pct": "5",
                    "flame_attack": "0",
                    "flame_score": "120",
                    "main_potential_grade": "레전드리",
                    "main_potential_line_1": "올스탯 +9%",
                    "main_potential_line_2": "DEX +9%",
                    "main_potential_line_3": "DEX +9%",
                    "additional_potential_grade": "에픽",
                    "additional_potential_line_1": "DEX +5",
                    "additional_potential_line_2": "올스탯 +3",
                    "additional_potential_line_3": "최대 HP +100",
                    "tradeability": "1회 교환 가능",
                    "scissors_remaining": "9",
                    "scissors_total": "10",
                    "clean_price_meso": "10000000",
                }
            )
            pipeline.write_csv_rows(output / "review.csv", rows, pipeline.REVIEW_COLUMNS)
            self.assertEqual(
                pipeline.main(["export", str(output / "review.csv"), "--out", str(public)]),
                0,
            )
            manifest = json.loads((public / "market-artifacts.json").read_text(encoding="utf-8"))
            comparable = json.loads(
                (public / manifest["comparables"]["file"]).read_text(encoding="utf-8")
            )["comparables"][0]
            self.assertNotIn("source_filename", comparable["item"])
            self.assertNotIn("ocr_text", comparable["item"])

    def test_same_image_on_another_date_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            photos = root / "photos"
            output = root / "market-data"
            photos.mkdir()
            Image.new("RGB", (120, 300), (25, 27, 34)).save(photos / "75억.jpg")
            reference = root / "reference.csv"
            reference.write_text("item_name,clean_price_meso,observed_at\n", encoding="utf-8")
            common = [
                "ingest",
                str(photos),
                "--out",
                str(output),
                "--price-kind",
                "listing",
                "--ocr",
                "none",
                "--reference-prices",
                str(reference),
            ]
            self.assertEqual(pipeline.main([*common, "--observed-at", "2026-09-01"]), 0)
            self.assertEqual(pipeline.main([*common, "--observed-at", "2026-09-02"]), 0)
            rows = pipeline.read_csv_rows(output / "review.csv")
            self.assertEqual(len(rows), 2)
            self.assertNotEqual(rows[0]["record_id"], rows[1]["record_id"])
            self.assertEqual(rows[0]["duplicate_group_id"], rows[1]["duplicate_group_id"])

    def test_public_export_uses_allowlist(self):
        row = {column: "" for column in pipeline.REVIEW_COLUMNS}
        row.update(
            {
                "record_id": "random-public-id",
                "price_meso": "7500000000",
                "price_kind": "sold",
                "observed_at": "2026-09-01",
                "item_name": "데이브레이크 펜던트",
                "starforce": "21",
                "displayed_stats_json": json.dumps(
                    {"DEX": {"total": "190", "components": ["8", "94", "8", "80"], "raw": "private"}}
                ),
                "private_email": "user@example.com",
            }
        )
        public = pipeline.public_comparable(row)
        self.assertNotIn("private_email", public["item"])
        self.assertNotIn("raw", public["item"]["displayed_stats"]["DEX"])

    def test_csv_formula_strings_are_escaped_and_round_trip(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "review.csv"
            row = {column: "" for column in pipeline.REVIEW_COLUMNS}
            row["record_id"] = "safe-id"
            row["source_filename"] = "=HYPERLINK(\"bad\")"
            pipeline.write_csv_rows(path, [row], pipeline.REVIEW_COLUMNS)
            raw = path.read_text(encoding="utf-8-sig")
            self.assertIn("'=HYPERLINK", raw)
            loaded = pipeline.read_csv_rows(path)
            self.assertEqual(loaded[0]["source_filename"], '=HYPERLINK("bad")')

    def test_train_json_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            review = root / "review.csv"
            rows = []
            start = date(2026, 1, 1)
            for index in range(24):
                row = {column: "" for column in pipeline.REVIEW_COLUMNS}
                starforce = 17 + index % 6
                potential = 18 + (index % 4) * 3
                price_eok = 10 + starforce * 1.7 + potential * 0.8 + index * 0.05
                row.update(
                    {
                        "schema_version": pipeline.SCHEMA_VERSION,
                        "record_id": f"record-{index:03d}",
                        "duplicate_group_id": f"dup-{index:03d}",
                        "review_status": "approved",
                        "price_meso": str(round(price_eok * 100_000_000)),
                        "price_eok": str(price_eok),
                        "price_kind": "sold",
                        "observed_at": (start + timedelta(days=index)).isoformat(),
                        "auction_group": "1",
                        "item_name": "데이브레이크 펜던트",
                        "item_level": "140",
                        "item_category": "펜던트",
                        "required_job": "궁수",
                        "starforce": str(starforce),
                        "upgrade_applied": "6",
                        "upgrade_remaining": "0",
                        "upgrade_recoverable": "0",
                        "scroll_kind": "혼돈류 결과",
                        "scroll_main_stat": str(index % 9),
                        "scroll_attack": str(15 + index % 8),
                        "scroll_magic": "0",
                        "flame_main_stat": str(40 + index % 60),
                        "flame_sub_stat": str(index % 20),
                        "flame_all_stat_pct": str(index % 7),
                        "flame_attack": "0",
                        "flame_score": str(70 + index % 50),
                        "main_potential_grade": "레전드리",
                        "main_potential_line_1": "올스탯 +9%",
                        "main_potential_line_2": "DEX +9%",
                        "main_potential_line_3": "DEX +9%",
                        "main_potential_equiv_pct": str(potential),
                        "additional_potential_grade": "에픽",
                        "additional_potential_line_1": "DEX +5",
                        "additional_potential_line_2": "올스탯 +3",
                        "additional_potential_line_3": "최대 HP +100",
                        "additional_potential_equiv_pct": "0",
                        "tradeability": "1회 교환 가능",
                        "scissors_remaining": "9",
                        "scissors_total": "10",
                        "clean_price_meso": "10000000",
                    }
                )
                rows.append(row)
            pipeline.write_csv_rows(review, rows, pipeline.REVIEW_COLUMNS)
            model_path = root / "price-model.v1.json"
            exit_code = pipeline.main(
                [
                    "train",
                    str(review),
                    "--out",
                    str(model_path),
                    "--price-kind",
                    "sold",
                    "--min-samples",
                    "20",
                ]
            )
            self.assertEqual(exit_code, 0)
            model = json.loads(model_path.read_text(encoding="utf-8"))
            self.assertEqual(model["model_type"], "ridge_log_price")
            self.assertEqual(model["training_rows"], 24)
            self.assertEqual(model["training_independent_groups"], 24)
            self.assertEqual(len(model["feature_names"]), len(model["coefficients"]))
            self.assertIn("main_option=DEX+9%", model["feature_names"])
            manifest = json.loads((root / "market-artifacts.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["models"]["sold"]["file"], model_path.name)
            self.assertEqual(
                pipeline.main(["export", str(review), "--out", str(root)]),
                0,
            )
            manifest_after_export = json.loads(
                (root / "market-artifacts.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                manifest_after_export["models"]["sold"]["file"], model_path.name
            )

            changed_rows = [dict(row) for row in rows]
            before = pipeline.training_snapshot_sha256(rows)
            changed_rows[0]["main_potential_line_1"] = "공격력 +12%"
            after = pipeline.training_snapshot_sha256(changed_rows)
            self.assertNotEqual(before, after)


if __name__ == "__main__":
    unittest.main()
