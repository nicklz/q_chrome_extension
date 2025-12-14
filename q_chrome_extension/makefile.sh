#!/usr/bin/env bash
# makefile.sh
# [Q] Installer Script
# no critical data is lost
#
# Patch Notes:
# - Fix: Cross-platform switch (macOS vs Ubuntu/Debian) based on uname.
# - Fix: macOS does NOT build PECL extensions (your PECL builds fail at make). Uses Homebrew bottles via shivammathur/extensions.
# - Fix: Robust PHP major.minor detection without awk regex features (macOS /usr/bin/awk incompatibility caused your failure).
# - Fix: Removes any broken memcached ini files first to stop PHP startup warnings and allow php -v parsing.
# - Fix: If shivammathur formula is missing for the detected version, falls back to "generic" memcached/memcache formula names when available.
# - Guard: Verifies `php -m` contains memcache or memcached before continuing.
# no critical data is lost

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OS="$(uname)"
PY="python3"
VENV="tts_env"

log(){ printf "%s\n" "$*"; }
warn(){ printf "WARN: %s\n" "$*" >&2; }
die(){ printf "ERROR: %s\n" "$*" >&2; exit 1; }

is_macos(){ [ "${OS}" = "Darwin" ]; }
is_linux(){ [ "${OS}" = "Linux" ]; }

php_ini_scan_dir() {
  php --ini 2>/dev/null | sed -n 's/^Scan for additional .ini files in: //p' | tr -d '"' | head -n 1 | xargs || true
}

php_has_mod() {
  local mod_lc
  mod_lc="$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]')"
  php -m 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -q "^${mod_lc}$"
}

remove_broken_memcache_ini_files() {
  local ini_dir
  ini_dir="$(php_ini_scan_dir)"
  [ -n "${ini_dir}" ] || return 0

  # remove any previous attempts that referenced missing .so's
  rm -f "${ini_dir}/99-memcached.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        "${ini_dir}/99-memcache-ext.ini" \
        2>/dev/null || true
}

detect_php_minor() {
  # Do NOT use awk regex capture groups (macOS awk is picky; your prior failure was here).
  # Use php itself to print "major.minor".
  php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null || true
}

brew_install_try() {
  # best-effort install: return 0 if install succeeded, nonzero otherwise
  local formula="${1:-}"
  [ -n "$formula" ] || return 1
  brew install "$formula" >/dev/null 2>&1
}

ensure_php_memcache_modules_macos() {
  command -v brew >/dev/null 2>&1 || die "Homebrew not found."
  command -v php  >/dev/null 2>&1 || die "php not found."

  # Clean broken ini first so php output is not polluted
  remove_broken_memcache_ini_files

  local mm
  mm="$(detect_php_minor)"
  [ -n "${mm}" ] || die "Could not detect PHP major.minor (php -r failed)."

  log "macOS: Ensuring PHP memcache(d) modules for PHP ${mm}…"

  brew tap shivammathur/extensions >/dev/null 2>&1 || true

  # Try versioned formulae first
  if ! (php_has_mod "memcached" || php_has_mod "memcache"); then
    brew_install_try "shivammathur/extensions/memcached@${mm}" || true
    brew_install_try "shivammathur/extensions/memcache@${mm}"  || true
  fi

  # Some setups publish non-versioned names. Try them too.
  if ! (php_has_mod "memcached" || php_has_mod "memcache"); then
    brew_install_try "shivammathur/extensions/memcached" || true
    brew_install_try "shivammathur/extensions/memcache"  || true
  fi

  # Verify
  if php_has_mod "memcached" || php_has_mod "memcache"; then
    log "macOS: PHP memcache(d) extension loaded."
    return 0
  fi

  warn "macOS: PHP still does not see memcache(d)."
  warn "php --ini:"
  php --ini 2>/dev/null || true
  warn "php -m | egrep -i memcache:"
  php -m 2>/dev/null | egrep -i 'memcache|memcached' || true

  die "macOS: Failed to load PHP memcache(d) after Homebrew extension install attempts."
}

ensure_php_memcache_modules_linux() {
  log "Linux: Installing PHP memcache(d) via apt…"
  sudo apt update -y
  sudo apt install -y memcached php-memcached php-memcache netcat-openbsd || true

  if [ -f /etc/memcached.conf ] && ! grep -q "^-l 127.0.0.1" /etc/memcached.conf; then
    echo "-l 127.0.0.1" | sudo tee -a /etc/memcached.conf >/dev/null
  fi

  sudo systemctl enable memcached >/dev/null 2>&1 || true
  sudo systemctl restart memcached >/dev/null 2>&1 || sudo service memcached restart || true

  if php_has_mod "memcached" || php_has_mod "memcache"; then
    log "Linux: PHP memcache(d) extension loaded."
    return 0
  fi

  warn "Linux: PHP still does not see memcache(d)."
  warn "php -m | egrep -i memcache:"
  php -m 2>/dev/null | egrep -i 'memcache|memcached' || true
  die "Linux: Failed to load PHP memcache(d) after apt install."
}

install() {
  log "Installing [Q]..."

  rm -f .env || true

  read -r -p "Enter PROJECT_PATH_TOKEN (Leave empty for current directory): " project_path_token
  if [ -z "${project_path_token}" ]; then
    project_path_token="$(pwd)"
  fi

  log "Generating .env file..."
  [ -f .env_EXAMPLE ] || die ".env_EXAMPLE not found in $(pwd)"
  cp .env_EXAMPLE .env

  if is_macos; then
    sed -i "" "s|^PROJECT_PATH_TOKEN=.*|PROJECT_PATH_TOKEN=${project_path_token}|" .env
    sed -i "" "s|^INSTALL_PATH=.*|INSTALL_PATH=$(pwd)|" .env
    sed -i "" "s|^USER=.*|USER=$(whoami):$(id -gn)|" .env
  else
    sed -i "s|^PROJECT_PATH_TOKEN=.*|PROJECT_PATH_TOKEN=${project_path_token}|" .env
    sed -i "s|^INSTALL_PATH=.*|INSTALL_PATH=$(pwd)|" .env
    sed -i "s|^USER=.*|USER=$(whoami):$(id -gn)|" .env
  fi

  log "Installing system dependencies..."
  if is_macos; then
    command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install from https://brew.sh/"
    brew update || true

    brew install \
      memcached figlet toilet tree node php curl git wget unzip htop lolcat python3 nginx bat eza ripgrep fd fzf neovim tmux gh deno yarn pnpm nvm \
      zsh-autosuggestions zsh-syntax-highlighting fortune cowsay watch midnight-commander jq httpie ffmpeg \
      zlib pkg-config libmemcached openssl@3 \
      || true

    brew services restart memcached >/dev/null 2>&1 || true

    ensure_php_memcache_modules_macos

  elif is_linux; then
    sudo apt update -y
    sudo apt upgrade -y
    sudo apt install -y \
      memcached netcat-openbsd \
      figlet toilet nginx tree nodejs npm php php-cli php-common php-curl php-mysql curl git wget unzip build-essential htop net-tools lolcat \
      python3 python3-pip python3-venv ffmpeg jq \
      || true

    ensure_php_memcache_modules_linux
  else
    die "Unsupported OS: ${OS}"
  fi

  log "Setting up Python venv..."
  rm -rf "${VENV}"
  ${PY} -m venv --without-pip "${VENV}"
  [ -x "${VENV}/bin/python" ] || die "venv creation failed."

  curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
  "${VENV}/bin/python" /tmp/get-pip.py
  "${VENV}/bin/pip" install -U pip

  if [ -f requirements.txt ]; then
    "${VENV}/bin/pip" install -r requirements.txt
  else
    "${VENV}/bin/pip" install openai
  fi

  log "Installing npm deps..."
  if command -v npm >/dev/null 2>&1; then
    npm install
  else
    warn "npm not found; skipping npm install."
  fi

  if is_macos && [ -d "/Applications/Xcode.app/Contents/Developer/usr/bin" ]; then
    log "Xcode toolchain detected; running 'make mosaic'..."
    make mosaic || true
  fi

  log ""
  log "Run 'make up' next!"
  log ""
}

case "${1:-install}" in
  install) install ;;
  *) echo "Usage: $0 install"; exit 1 ;;
esac
