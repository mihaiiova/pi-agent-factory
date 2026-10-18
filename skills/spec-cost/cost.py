#!/usr/bin/env python3
"""Compatibility entry point; all accounting runs in the shared Node engine."""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    try:
        result = subprocess.run(["node", str(Path(__file__).with_suffix(".mjs")), *sys.argv[1:]])
        raise SystemExit(result.returncode)
    except FileNotFoundError:
        print("Cost unavailable: Node.js is required (the same runtime as Pi).", file=sys.stderr)
        raise SystemExit(1)
