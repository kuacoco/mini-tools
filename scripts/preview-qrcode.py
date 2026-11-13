#!/usr/bin/env python3
"""Export a preview image to Actions logs, or download it with a verified fallback."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO = "kuacoco/mini-tools"
MARKER = "MP_PREVIEW_QR_V1:"
MAX_SIZE = 1024 * 1024


def validate(data):
    if not 4 <= len(data) <= MAX_SIZE or not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
        raise ValueError("预览图片不是有效的 JPEG，或超出大小限制")
    return data


def export_image(path):
    data = validate(Path(path).read_bytes())
    encoded = base64.b64encode(data).decode("ascii")
    # Only the preview image is exported; never read the upload private key.
    print(MARKER + json.dumps({"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}))
    for offset in range(0, len(encoded), 1024):
        print(MARKER + json.dumps({"offset": offset, "data": encoded[offset:offset + 1024]}))


def decode_log(log):
    records = [json.loads(line.split(MARKER, 1)[1]) for line in log.splitlines() if re.search(re.escape(MARKER) + r"\{", line)]
    if not records or set(records[0]) != {"sha256", "size"}:
        raise ValueError("本次运行日志没有二维码备用数据")
    meta, chunks = records[0], records[1:]
    if not isinstance(meta["size"], int) or not 4 <= meta["size"] <= MAX_SIZE:
        raise ValueError("二维码大小无效")
    encoded = ""
    for chunk in chunks:
        if set(chunk) != {"offset", "data"} or chunk["offset"] != len(encoded):
            raise ValueError("二维码日志缺失、乱序或重复")
        encoded += chunk["data"]
        if len(encoded) > 4 * ((MAX_SIZE + 2) // 3):
            raise ValueError("二维码日志超出大小限制")
    data = validate(base64.b64decode(encoded, validate=True))
    if len(data) != meta["size"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
        raise ValueError("二维码完整性校验失败")
    return data


def gh(*args):
    # Capture stderr: failed artifact URLs can contain temporary access signatures.
    result = subprocess.run(["gh", *args], capture_output=True)
    if result.returncode:
        raise RuntimeError("GitHub 请求失败：" + " ".join(args[:2]))
    return result.stdout.decode("utf-8")


def download(run_id, directory):
    run = json.loads(gh("run", "view", run_id, "--repo", REPO, "--json", "status,conclusion"))
    if run != {"status": "completed", "conclusion": "success"}:
        raise ValueError("只允许下载已成功完成的运行")
    dest = Path(directory)
    dest.mkdir(parents=True, exist_ok=True)
    image = dest / "preview-qrcode.jpg"
    if image.exists():
        raise ValueError("目标图片已存在，请使用独立的空目录")
    try:
        gh("run", "download", run_id, "--repo", REPO, "--name", "preview-qrcode", "--dir", str(dest))
        validate(image.read_bytes())
        print("已通过 Actions 产物下载：", image)
    except (RuntimeError, OSError, ValueError):
        print("产物下载不可用，改用本次运行日志并校验 SHA-256。")
        data = decode_log(gh("run", "view", run_id, "--repo", REPO, "--log"))
        image.write_bytes(data)
        print("已通过日志恢复并校验：", image)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("image")
    fetch = commands.add_parser("download")
    fetch.add_argument("run_id", type=int)
    fetch.add_argument("directory")
    args = parser.parse_args()
    try:
        if args.command == "export":
            export_image(args.image)
        else:
            download(str(args.run_id), args.directory)
    except (RuntimeError, ValueError, OSError) as error:
        parser.exit(1, str(error) + "\n")
