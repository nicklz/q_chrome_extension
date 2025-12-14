# makefile.sh
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OS="$(uname)"
PY="python3"
VENV="tts_env"

install() {
  echo "🔧 Installing [Q]..."

  rm -f .env || true

  # PROJECT_PATH_TOKEN
  read -p "🔑 Enter PROJECT_PATH_TOKEN (Leave empty for current directory): " project_path_token
  if [ -z "$project_path_token" ]; then
    project_path_token="$(pwd)"
  fi

  echo "✅ Generating .env file..."
  if [ ! -f .env_EXAMPLE ]; then
    echo "❌ .env_EXAMPLE not found in $(pwd)"
    exit 1
  fi

  cp .env_EXAMPLE .env

  if [ "$OS" = "Darwin" ]; then
    sed -i "" "s|^PROJECT_PATH_TOKEN=.*|PROJECT_PATH_TOKEN=${project_path_token}|" .env
    sed -i "" "s|^INSTALL_PATH=.*|INSTALL_PATH=$(pwd)|" .env
    sed -i "" "s|^USER=.*|USER=$(whoami):$(id -gn)|" .env
  else
    sed -i "s|^PROJECT_PATH_TOKEN=.*|PROJECT_PATH_TOKEN=${project_path_token}|" .env
    sed -i "s|^INSTALL_PATH=.*|INSTALL_PATH=$(pwd)|" .env
    sed -i "s|^USER=.*|USER=$(whoami):$(id -gn)|" .env
  fi

  echo "✨ Installing system dependencies..."
  if [ "$OS" = "Darwin" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      echo "❌ Homebrew not found. Install Homebrew first: https://brew.sh/"
      exit 1
    fi
    brew update
    brew install \
      memcached figlet toilet tree node php curl git wget unzip htop lolcat python3 nginx bat eza ripgrep fd fzf neovim tmux gh deno yarn pnpm nvm \
      zsh-autosuggestions zsh-syntax-highlighting fortune cowsay watch midnight-commander jq httpie ffmpeg || true
    brew services restart memcached || true
  else
    sudo apt update -y
    sudo apt upgrade -y
    sudo apt install -y memcached php-memcached netcat-openbsd \
      figlet toilet nginx tree nodejs npm php php-cli php-common php-curl php-mysql curl git wget unzip build-essential htop net-tools lolcat \
      python3 python3-pip python3-venv ffmpeg jq
    if ! grep -q "^-l 127.0.0.1" /etc/memcached.conf; then
      echo "-l 127.0.0.1" | sudo tee -a /etc/memcached.conf >/dev/null
    fi
    sudo systemctl enable memcached >/dev/null 2>&1 || true
    sudo systemctl restart memcached || sudo service memcached restart
  fi

  echo "✨ Setting up Python venv..."
  rm -rf "${VENV}"
  ${PY} -m venv --without-pip "${VENV}"

  if [ ! -x "${VENV}/bin/python" ]; then
    echo "❌ venv creation failed. Ensure python3-venv is installed."
    exit 1
  fi

  curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
  "${VENV}/bin/python" /tmp/get-pip.py
  "${VENV}/bin/pip" install -U pip

  if [ -f requirements.txt ]; then
    "${VENV}/bin/pip" install -r requirements.txt
  else
    "${VENV}/bin/pip" install openai
  fi

  echo "✨ Installing npm deps..."
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    echo "⚠️ npm not found; skipping npm install."
  fi

  if [ -d "/Applications/Xcode.app/Contents/Developer/usr/bin" ]; then
    echo "✨ Xcode toolchain detected; running 'make mosaic'..."
    make mosaic || true
  fi

  echo ""
  echo "✨ Run 'make up' next!"
  echo ""
}

case "${1:-install}" in
  install)
    install
    ;;
  *)
    echo "Usage: $0 install"
    exit 1
    ;;
esac

