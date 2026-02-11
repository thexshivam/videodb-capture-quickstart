#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FACT_DETECTOR_DIR="$(cd "$APP_DIR/../../fact-detector" && pwd)"

echo "============================================================"
echo "  Fact Detector - Desktop App"
echo "============================================================"
echo ""

# 1. Check node_modules
if [ ! -d "$APP_DIR/node_modules" ]; then
  echo "[ERROR] node_modules not found."
  echo "  Run: npm run setup"
  exit 1
fi

# 2. Ensure uv is installed
if ! command -v uv &>/dev/null; then
  echo "[SETUP] Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

# 3. Setup Python venv if needed
if [ ! -d "$FACT_DETECTOR_DIR/venv" ]; then
  echo "[SETUP] Creating Python virtual environment..."
  uv venv "$FACT_DETECTOR_DIR/venv" --python 3.12
fi

# 4. Install Python dependencies
echo "[SETUP] Installing Python dependencies..."
uv pip install -r "$FACT_DETECTOR_DIR/requirements.txt" \
  --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  --python "$FACT_DETECTOR_DIR/venv/bin/python" --quiet

# 5. Copy .env if needed
if [ ! -f "$FACT_DETECTOR_DIR/.env" ] && [ -f "$APP_DIR/.env" ]; then
  echo "[SETUP] Copying .env to fact-detector directory..."
  cp "$APP_DIR/.env" "$FACT_DETECTOR_DIR/.env"
fi

if [ ! -f "$FACT_DETECTOR_DIR/.env" ]; then
  echo "[ERROR] No .env file found."
  echo "  Create $APP_DIR/.env with VIDEO_DB_API_KEY and GEMINI_API_KEY"
  echo "  Or run: npm run setup"
  exit 1
fi

# 6. Launch Electron (backend is spawned by main.js)
echo "[START] Launching Electron app..."
cd "$APP_DIR"
npx electron .
