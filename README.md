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
- Displays animated `[Q] Version 5.3` mosaic using `figlet` and `lolcat`  

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

## 🧾 QID Command Format

All non manifest generation output should be rendered in new QID format, list items are of this example:

Example:
[
  {
  "qid": "q_file_ab12_1",
  "filepath": "src/Prompt.js",
  "content": "FILE HEADER DOCUMENTATION (MUST BE WRITTEN INTO THE TOP COMMENT BLOCK OF THIS FILE)\n\nFile Path:\n- src/Prompt.js\n\nRole in System:\n- UI-layer prompt input module responsible for collecting user-entered prompt text, validating/sanitizing it, and dispatching updates to upstream state management (parent component, controller, or store).\n\nSystem Layer:\n- Frontend / UI\n\nTech Stack:\n- JavaScript (or TypeScript if the repo uses TS), React (if applicable), DOM events, and local logging utilities.\n\nArchitectural Context:\n- This file sits at the UI boundary where human input becomes application state.\n- It must be stable, deterministic, and safe: input is high-risk for injection, state corruption, and UX regressions.\n- It should minimize coupling by exporting a small interface: a component or handler with clearly defined inputs/outputs.\n\nBusiness Analysis (Why This Exists):\n- Collects prompt text used to drive the automation pipeline.\n- Ensures prompt state is correct before it is used to generate tickets, run FAAS commands, or mutate files.\n- Prevents invalid prompts from entering the system, improving reliability and reducing error cascades.\n- Improves auditability by emitting consistent logs and embedding QID/ticket references.\n\nFunctional Responsibilities:\n1) Render and maintain prompt input UI (textbox / textarea / editor surface).\n2) Track current value and report deltas.\n3) Validate / normalize prompt content (trim rules, max length rules, forbidden characters rules if applicable).\n4) Emit events to parent/controller/store.\n5) Provide optional UX behaviors (enter-to-submit, shift-enter newline, disabled state, placeholder text, character counter).\n6) Log prompt changes in a controlled and non-noisy way.\n\nREQUIRED INVENTORY (LIST ALL FUNCTIONS, VARIABLES, IMPORTS/LIBRARIES, AND RELATED FILES USED IN THIS FILE)\n\nA) Imports / Libraries Used (Enumerate, even if currently empty):\n- React: useState, useEffect, useMemo, useCallback (only those actually used)\n- PropTypes (if used)\n- Any local logging utility (examples: src/utils/logger.js, src/lib/log.js)\n- Any shared constants (examples: src/constants/ui.js, src/constants/limits.js)\n- Any shared sanitization/validation utilities (examples: src/utils/sanitize.js, src/utils/validatePrompt.js)\n- Any styling solution (CSS module, styled-components, Tailwind classes, or plain CSS imports)\n\nB) Functions Used (List every function defined OR invoked within this file, including callbacks):\n- Component export function (example: function Prompt(props) or const Prompt = (props) => ...)\n- onChange handler function (example: handleChange(event))\n- onKeyDown handler function (example: handleKeyDown(event))\n- sanitize/normalize function (example: normalizePrompt(rawValue))\n- validation function (example: validatePrompt(value))\n- logging function invocations (example: log.info(...), log.debug(...))\n- any helper functions for:\n  - trimming\n  - max-length enforcement\n  - debouncing/throttling\n  - diff detection (previous vs next)\n  - deriving UI labels\n\nC) Variables / Constants Used (List all state + derived values):\n- promptValueString (current prompt input)\n- setPromptValueFn (state setter)\n- isDisabledBoolean\n- maxLengthNumber\n- trimmedValueString\n- sanitizedValueString\n- validationErrorString or validationStateObject\n- lastLoggedValueString (if used to reduce log spam)\n- props fields (must be listed explicitly):\n  - value\n  - onChange\n  - onSubmit\n  - disabled\n  - placeholder\n  - maxLength\n  - qid\n  - ticketId\n  - any additional props\n\nD) Related Files / Modules (MUST BE REFERENCED IN HEADER WITH RELATIONSHIP NOTES)\n- Parent component that renders Prompt (example: src/App.js, src/components/ChatPanel.js, src/pages/HomePage.js)\n- State/store module that consumes prompt updates (example: src/state/promptStore.js, src/context/PromptContext.js)\n- Ticket/FAAS builder that consumes final prompt value (example: src/lib/faas/buildCommand.js, tools/ticket_wizard/*)\n- Logging utility (example: src/utils/logger.js)\n- Validation/sanitization utilities (example: src/utils/sanitize.js, src/utils/validatePrompt.js)\n- UI stylesheets or theme tokens (example: src/styles/*)\n\nCONTROL FLOW AND MAJOR LOGIC BRANCHES (MUST BE DOCUMENTED IN HEADER)\n\n1) Initialization:\n- Determine initial prompt value from props, store, or default.\n- Initialize local state.\n\n2) Input Change Flow:\n- Receive DOM/React change event.\n- Extract raw value.\n- Normalize/sanitize.\n- Validate.\n- Update local state.\n- Emit upstream onChange callback with sanitized value.\n- Emit structured log event (should include QID/ticket reference if available).\n\n3) Submit Flow (if applicable):\n- On Enter (or explicit button), verify validation passes.\n- Call onSubmit with final prompt.\n- Log submit action.\n\n4) Disabled / Error States:\n- If disabled, block editing and block submit.\n- If invalid, show error state and block submit (or warn depending on policy).\n\nCROSS-CUTTING CONCERNS (MUST BE INCLUDED)\n- Logging:\n  - Every meaningful mutation logs a compact event; avoid per-keystroke noise if needed.\n  - Logs must not include secrets.\n- Validation:\n  - Enforce max length and basic content constraints.\n- Observability:\n  - Provide consistent log event names so upstream tooling can track prompt lifecycle.\n- Auditability:\n  - Embed QID in header comment and reference it in patch notes.\n\nOPERATIONAL NOTES\n- Performance: avoid heavy computation per keystroke; debounce if needed.\n- Idempotency: sanitization should be stable (same input -> same output).\n- Reliability: do not break existing exports/props; additive-only changes.\n\nPATCH NOTES REQUIREMENTS (MUST BE WRITTEN IN HEADER)\n- Add emoji-prefixed patch notes.\n- Include at least one patch note with the exact phrase: \"no critical data is lost\".\n- Patch notes must be append-only.\n\nFINAL GUARANTEE (MUST BE THE LAST LINE OF THE HEADER COMMENT BLOCK)\n- no critical data is lost\n"
},

...

]


---

---

## 🧾 LEGACY FAAS Command Format

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

