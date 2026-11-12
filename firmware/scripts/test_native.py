#!/usr/bin/env python3
"""Compile and run portable firmware regression tests without a connected badge."""
import pathlib
import subprocess
import tempfile

firmware = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="coco-firmware-tests-") as directory:
    for source in sorted((firmware / "test").glob("*_test.cpp")):
        binary = pathlib.Path(directory) / source.stem
        subprocess.run([
            "c++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
            f"-I{firmware / 'include'}", str(source), "-o", str(binary),
        ], check=True)
        subprocess.run([str(binary)], check=True)
        print(f"PASS {source.name}", flush=True)
