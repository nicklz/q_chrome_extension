# [Q] Chrome Extension – Local Automation Framework 🧠

---

## 📘 Overview

The **Q Chrome Extension** is a local-first automation framework that bridges browser interaction, terminal command execution, and AI-driven file mutation — all inside your development environment. It’s built to support autonomous workflows, iterative app development, and secure, auditable automation using JSON-defined logic.

---

## 🔧 Key Features

* **Fully local sandbox** — every command, edit, and process executes on your machine with no remote side effects
* **Strict JSON command interface (FAAS / QID)** — all automation is defined through a structured, auditable Functions and Arrays System
* **Read-before-write enforcement** — files are always inspected before modification; blind writes are disallowed by design
* **Prompt-driven intelligent mutation** — controlled code edits performed via QID system
* **Optional Chrome extension layer** — enables browser-based UI automation without requiring it for core operation
* **Mandatory Git diff validation** — every file mutation must be verified and reviewed through diffs
* **Cross-platform compatibility** — runs on macOS, Linux, and WSL2 without platform-specific rewrites

---

## 🚀 Quick Start

### 1. Prerequisites

- [ ] Bash shell or compatible terminal  
- [ ] macOS or Linux system (WSL2 also supported)  
- [ ] Basic knowledge of CLI and file paths  

---

### 2. Install Q Locally

Run:

make install

You’ll be prompted for:

- Project path token (defaults to current working directory)  

The installer performs:

- Deletes any existing `.env`  
- Copies `.env_EXAMPLE` → `.env`  
- Writes API install path, user data into `.env`  
- Copies and updates `Q_MEMORY_INTERNAL_EXAMPLE.json` → `Q_MEMORY_INTERNAL.json`  
- Installs system packages via `brew` (macOS) or `apt` (Linux)  
- Installs Python and Node dependencies  
- Builds virtual environment `tts_env`  
- Displays animated `[Q] Version 2.7` mosaic using `figlet` and `lolcat`  

---

## 🟢 Start the Application

make up

This command:

- Validates `.env` and Python venv  
- Stops nginx (if running) to clear port 80  
- Kills any process occupying port 3666  
- Starts a local PHP server at `localhost:3666`  

---

## 🔴 Stop the Application

make down

Shuts down the local server and any linked services.

---

## 🔁 Restart the App

make restart

Performs `make down` and `make up` together.

---

## 🧹 Maintenance Commands

| Command           | Description                                                        |
|-------------------|--------------------------------------------------------------------|
| make clear        | Deletes temporary files (`*.log`, `ticket_*.json`, etc.)          |
| make logs         | Displays logs (if implemented)                                     |
| make backup       | Copies logs and project folders to a `/backups/` directory         |
| make reset        | Soft reset without destroying `.env` or venv                       |
| make hard-reset   | Full reset. Deletes `.env`, venv, and logs, then reinstalls all    |
| make env          | Rebuilds Python virtual environment and reinstalls dependencies    |
| make deploy       | Triggers `q_deploy` for code delivery                              |
| make registry     | Refreshes asset registry (for Unreal integration)                  |
| make download     | Downloads Nexus.zip archive into current working folder            |

---

## 🧠 Python Edit Utility

All file modifications must go through:

python3 tools/edit_file_with_prompt.py --file target.js --prompt 'Add logging and refactor this block'

Inline comments must reference the ticket, e.g.:

// NEXUS-001: Refactored for better logging

---

## 🧾 FAAS Command Format

All automation runs through FAAS: a JSON-based command schema used for defining one "batch" of operations.

Example:

{
  "run": "01",
  "uuid": "nexus-001-edit-prompt-ui",
  "title": "Edit Prompt Handler",
  "type": "command",
  "subtype": "edit",
  "content": "python3 tools/edit_file_with_prompt.py --file src/Prompt.js --prompt 'Add new onChange handler'",
  "summary": {
    "strategy": "Locate file, validate structure, inject feature using prompt",
    "next_steps": "Run git diff, verify correctness, update ticket status",
    "prompt_advice": "Use precise language and ticket references in all prompts",
    "ticket_statuses": [
      { "requirement": "Validate change with git diff", "status": "pending" },
      { "requirement": "Log change inline with comment", "status": "pending" }
    ],
    "history": [
      "Ran grep to find source",
      "Used Python prompt edit",
      "Captured diff"
    ],
    "summary": "Functionality injected and awaiting validation"
  }
}

---

## 🧪 Server Testing

To verify server status, run:

curl http://localhost:3666/test

Expected output:

{
  "overall": 1,
  "totalTests": 1,
  "passedTests": 1,
  "results": 1,
  "timestamp": "..."
}

---

## 🧯 Troubleshooting

### Port 3666 in use?

Run:

lsof -t -i:3666 | xargs kill -9

Then:

make up

---

### .env missing?

Just run:

make install

---

### Python venv broken?

rm -rf tts_env  
make env

---

## 📦 Architecture

- PHP local server for file routing
- Chrome Extension UI for interaction
- Node.js backend for FAAS command relay
- Python scripts for editing and validation
- Local shell execution for Bash commands
- `.env`-driven config system
- `.json`-based ticket state memory

---

## 🔐 Security Model

- Fully local execution only  
- No shell commands accepted without review  
- Git diff always required after any write  
- No auto-exec or destructive defaults  

---

## ✅ Summary

- The Q Chrome Extension enables automated file editing, app building, and shell orchestration using structured JSON commands.
- It is safe, transparent, traceable, and designed for fully autonomous workflows.
- The extension is modular, open-ended, and built to scale into larger agent networks or app creation engines.

---  

