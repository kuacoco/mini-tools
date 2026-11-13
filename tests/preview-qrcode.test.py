import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("preview_qrcode", Path(__file__).resolve().parents[1] / "scripts/preview-qrcode.py")
qr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qr)


class PreviewQrcodeTests(unittest.TestCase):
    def setUp(self):
        self.image = b"\xff\xd8\xff" + bytes(range(256)) * 20 + b"\xff\xd9"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "qr.jpg"
            path.write_bytes(self.image)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                qr.export_image(path)
            self.lines = output.getvalue().splitlines()

    def test_actions_log_prefix_roundtrip(self):
        log = "unrelated log\n" + "\n".join("ci\tstep\t2026-11-13T00:00:00Z " + line for line in self.lines)
        self.assertEqual(qr.decode_log(log), self.image)

    def test_missing_reordered_duplicate_chunks_fail(self):
        for lines in (self.lines[:2] + self.lines[3:], self.lines[:1] + self.lines[2:3] + self.lines[1:2] + self.lines[3:], self.lines + self.lines[1:2]):
            with self.subTest(lines=lines), self.assertRaises(ValueError):
                qr.decode_log("\n".join(lines))

    def test_corruption_fails_hash(self):
        with self.assertRaises(ValueError):
            qr.decode_log("\n".join(self.lines).replace('"sha256": "', '"sha256": "0', 1))

    def test_old_logs_and_non_images_fail(self):
        with self.assertRaises(ValueError):
            qr.decode_log("no backup data")
        with self.assertRaises(ValueError):
            qr.validate(b"not an image")


if __name__ == "__main__":
    unittest.main()
