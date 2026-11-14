"""Compatibility wrapper; release packages are built by Microsoft vsce."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
node = shutil.which("node")
if not node:
    raise SystemExit("Node.js is required. Run npm ci before packaging.")
raise SystemExit(subprocess.call([node, str(root / "scripts/package.js")], cwd=root))
