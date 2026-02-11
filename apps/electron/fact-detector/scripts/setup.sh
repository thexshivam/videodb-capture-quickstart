#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FACT_DETECTOR_DIR="$(cd "$APP_DIR/../../fact-detector" && pwd)"

echo "============================================================"
echo "  Fact Detector - First Time Setup"
echo "============================================================"
echo ""

# 1. Prompt for API keys
ENV_FILE="$APP_DIR/.env"
FD_ENV_FILE="$FACT_DETECTOR_DIR/.env"

if [ -f "$FD_ENV_FILE" ]; then
  echo "[INFO] Found existing .env at $FD_ENV_FILE"
  echo "  Skipping API key prompts. Delete it to re-enter keys."
  echo ""
else
  echo "Enter your API keys (or press Enter to skip):"
  echo ""

  read -rp "  VideoDB API Key: " VIDEODB_KEY
  read -rp "  Gemini API Key:  " GEMINI_KEY
  echo ""

  if [ -n "$VIDEODB_KEY" ] && [ -n "$GEMINI_KEY" ]; then
    cat > "$ENV_FILE" <<EOF
VIDEO_DB_API_KEY=$VIDEODB_KEY
GEMINI_API_KEY=$GEMINI_KEY
EOF
    cp "$ENV_FILE" "$FD_ENV_FILE"
    echo "[OK] API keys saved to .env"
  else
    echo "[WARN] Skipped. You'll need to create .env manually before running."
  fi
fi

# 2. Install npm dependencies
echo ""
echo "[SETUP] Installing npm dependencies..."
cd "$APP_DIR"
npm install

# 3. Setup Python environment
if ! command -v uv &>/dev/null; then
  echo "[SETUP] Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

if [ ! -d "$FACT_DETECTOR_DIR/venv" ]; then
  echo "[SETUP] Creating Python virtual environment..."
  uv venv "$FACT_DETECTOR_DIR/venv" --python 3.12
fi

echo "[SETUP] Installing Python dependencies..."
uv pip install -r "$FACT_DETECTOR_DIR/requirements.txt" \
  --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  --python "$FACT_DETECTOR_DIR/venv/bin/python" --quiet

echo ""
echo "============================================================"
echo "  Setup complete! Run: npm start"
echo "============================================================"
