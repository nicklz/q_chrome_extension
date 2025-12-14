# Makefile
# Nexus Makefile - Cross-Platform Compatible for [Q] Installation

PROJECT_NAME := Nexus
LOG_DIR := logs
BACKUP_DIR := backups
VENV := tts_env
OS := $(shell uname)
PY := python3
VENV_BIN := $(VENV)/bin
ACT := $(VENV_BIN)/activate

# Load .env if exists
ifneq (,$(wildcard .env))
	include .env
	export
endif

.PHONY: install clear-env env compile rebuild registry download backup clear hard-reset up down restart logs reset deploy venv mosaic print_q memcache-status memcache-flush status

define sed_replace
ifeq ($(OS),Darwin)
	sed -i '' $(1)
else
	sed -i $(1)
endif
endef

install:
	@bash ./makefile.sh install

mosaic:
	@$(MAKE) print_q
	@figlet "[Q] Version 5.0" | lolcat -S 120
	@figlet "Install Complete" | lolcat -S 1
	@echo "\n✅ [Q] Installation Complete! ✔️✔️✔️\n"

print_q:
	@bash -c '\
	size=50; radius_outer=20; radius_inner=12; cx=$$((size / 2)); cy=$$((size / 2)); \
	for ((y=0; y<size; y++)); do \
		line=""; \
		for ((x=0; x<size; x++)); do \
			dx=$$((x - cx)); dy=$$((y - cy)); dist_sq=$$((dx * dx + dy * dy)); \
			if ((dist_sq >= radius_inner * radius_inner && dist_sq <= radius_outer * radius_outer)); then \
				line+="🟢🟢🟢"; \
			elif ((x > cx && y > cy && x - cx >= y - cy - 1 && x - cx <= y - cy + 1 && x - cx <= radius_outer / 2 && x - cx >= radius_inner / 3)); then \
				line+="🟢🟢🟢"; \
			else \
				line+="⚫"; \
			fi; \
		done; echo "$$line"; \
	done'

# Create/repair venv and ensure deps
venv:
	@echo "🧰 Ensuring Python virtual environment..."
	@bash -euo pipefail -c '\
	if [ ! -f "$(ACT)" ]; then \
		echo "⚠️  $(ACT) missing. Creating venv..."; \
		rm -rf "$(VENV)"; \
		$(PY) -m venv --without-pip "$(VENV)"; \
		curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py; \
		"./$(VENV)/bin/python" /tmp/get-pip.py; \
	fi; \
	if [ ! -f "$(ACT)" ]; then \
		echo "❌ Failed to create venv (activate missing). On Linux, install python3-venv."; \
		exit 1; \
	fi; \
	if ! "./$(VENV)/bin/pip" --version >/dev/null 2>&1; then \
		echo "⚠️ pip missing in venv; bootstrapping..."; \
		curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py; \
		"./$(VENV)/bin/python" /tmp/get-pip.py; \
	fi; \
	"./$(VENV)/bin/pip" install -U pip; \
	if [ -f requirements.txt ]; then "./$(VENV)/bin/pip" install -r requirements.txt; else "./$(VENV)/bin/pip" install openai; fi; \
	echo "✅ venv ready."'

up: venv
	@echo "🚀 Starting the application..."
	@echo "🔄 Running rsync to update desktop folder because fuck chrome..."
	@figlet "[Q] Starting" | lolcat
	@bash -euo pipefail -c '\
	if [ ! -f .env ]; then \
		echo "⚠️ .env file is missing. Run '\''make install'\'' first."; \
		exit 1; \
	fi; \
	if [ "$(OS)" = "Darwin" ]; then \
		brew services stop nginx >/dev/null 2>&1 && echo "✅ Nginx stopped, port 80 cleared." || echo "ℹ️ Nginx already stopped."; \
		brew services restart memcached || true; \
		echo "✅ Memcached running (brew services)"; \
	else \
		echo "🔄 Running rsync to update desktop folder because fuck chrome..."; \
		rsync -az /home/nick/sites/waypoints/nexus/scripts/q_chrome_extension/ /mnt/c/Users/nkuhn/Desktop/q_chrome_extension/ & \
		sudo service nginx stop >/dev/null 2>&1 || echo "ℹ️ Nginx not running."; \
		sudo systemctl restart memcached || sudo service memcached restart; \
		echo "✅ Memcached running on 127.0.0.1:11211"; \
	fi; \
	PID=$$(lsof -t -i:3666 || true); \
	if [ -n "$$PID" ]; then \
		echo "⚠️ Port 3666 in use by PID $$PID. Killing..."; \
		kill -9 $$PID || true; \
		echo "✅ Port 3666 freed."; \
	fi; \
	export PATH="$(PWD)/$(VENV)/bin:$$PATH"; \
	if [ ! -f "$(INSTALL_PATH)/router.php" ]; then \
		echo "⚠️ router.php not found at $(INSTALL_PATH). Using docroot only."; \
		php -S localhost:3666 -t "$(INSTALL_PATH)"; \
	else \
		php -S localhost:3666 -t "$(INSTALL_PATH)" "$(INSTALL_PATH)/router.php"; \
	fi'

down:
	@echo "🛑 Shutting down the application..."
	@bash -c '\
	PID=$$(lsof -t -i:3666 || true); \
	if [ -n "$$PID" ]; then \
		kill -9 $$PID || true; \
		echo "✅ Port 3666 freed."; \
	else \
		echo "ℹ️ No process on port 3666."; \
	fi; \
	echo "✅ All processes stopped."'

restart: down up

logs:
	@echo "📜 Displaying logs..."
	@mkdir -p $(LOG_DIR)
	@echo "No logs available."

backup:
	@echo "📦 Backing up volatile data..."
	mkdir -p $(BACKUP_DIR)
	cp -r $(LOG_DIR) $(BACKUP_DIR)/ 2>/dev/null || true
	cp -r $(PROJECT_NAME) $(BACKUP_DIR)/ 2>/dev/null || true
	@echo "✅ Backup complete."

reset:
	@echo "♻️ Resetting the system to default state..."
	@echo "✅ Reset complete."

clear:
	@echo "🧹 Cleaning up temporary files..."
	@find /tmp -maxdepth 1 -type f -name 'q_chrome_extension_*.log' -delete
	@find /tmp -maxdepth 1 -type f -name 'ticket_*.json' -delete
	@echo "🧽 Flushing Memcached on 127.0.0.1:11211 ..."
	@bash -euo pipefail -c '\
	if command -v nc >/dev/null 2>&1; then \
		if printf "version\r\nquit\r\n" | nc -w 2 127.0.0.1 11211 >/dev/null 2>&1; then \
			printf "flush_all\r\nquit\r\n" | nc -w 2 127.0.0.1 11211 >/dev/null 2>&1 && echo "✅ Memcached flushed."; \
		else \
			echo "⚠️  Memcached not reachable — skipping flush."; \
		fi; \
	else \
		echo "⚠️  netcat (nc) not available — skipping memcache flush."; \
	fi'
	@echo "✅ Clean complete."
	@rm -f /tmp/q_chrome_extension.log

status:
	@echo "🔍 Scanning Memcached on 127.0.0.1:11211 ..."
	@bash -euo pipefail -c '\
	HOST=127.0.0.1; PORT=11211; \
	if ! command -v nc >/dev/null 2>&1; then \

deploy:
	@echo "🚀🚀🚀 DEPLOYING PACKAGE TO GITHUB... 🚀🚀🚀"
	@echo "📍 saving original directory"
	@ORIG_DIR="$$(pwd)"; \
	echo "🧮 generating tmp hash"; \
	HASH="$$(date +%s%N | sha256sum | awk '{print $$1}' | cut -c1-10)"; \
	TMP_CLONE_DIR="/tmp/q_chrome_extension_$${HASH}"; \
	echo "🧹 ensuring clean tmp directory: $${TMP_CLONE_DIR}"; \
	rm -rf "$${TMP_CLONE_DIR}"; \
	mkdir -p "$${TMP_CLONE_DIR}" || exit 1; \
	echo "📥 cloning repo into $${TMP_CLONE_DIR} (no extra folder)"; \
	git clone "git@github.com:nicklz/q_chrome_extension.git" "$${TMP_CLONE_DIR}" || exit 1; \
	echo "📦 copying ALL original directory contents into tmp/q_chrome_extension (including dotfiles)"; \
	cp -a "$${ORIG_DIR}/." "$${TMP_CLONE_DIR}/q_chrome_extension/" || exit 1; \
	echo "➡️ entering temp working directory: $${TMP_CLONE_DIR}/q_chrome_extension"; \
	cd "$${TMP_CLONE_DIR}/q_chrome_extension" || exit 1; \
	echo "🧹 removing ./sandbox tts_env"; \
	rm -rf "./sandbox"; \
	rm -rf "./tts_env"; \
	rm -rf "./package-lock.json"; \
	rm -rf "./node_modules"; \
	rm -rf "./git"; \
	rm  "./.env"; \
	echo "🧼 clearing ./data contents (preserve ./data folder)"; \
	rm -rf "./data/"*; \
	echo "⬆️ about to push to github"; \
	echo "about to push to github..."; \
	echo "🧾 running: gitq"; \
	git add . && git commit -m "[Q] Deployment $${HASH} 🚀✅"  && git push origin main || exit 1; \
	echo "↩️ returning to original directory: $${ORIG_DIR}"; \
	cd "$${ORIG_DIR}" || exit 1; \
	echo "🔥 removing temp directory $${TMP_CLONE_DIR}"; \
	rm -rf "$${TMP_CLONE_DIR}"; \
	echo "ALL COMPLETE DEPLOY 🚀🚀🚀✅✅✅🎉🎉🎉🔥🔥🔥🤖🤖🤖💥💥💥🏁🏁🏁"

