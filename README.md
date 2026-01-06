
[Q] CHROME EXTENSION – LOCAL AUTOMATION FRAMEWORK
https://nexus-platforms.com
============================================================

OVERVIEW
--------
The [Q] Chrome Extension is a local-first automation framework designed to connect browser interaction, terminal command execution, and AI-assisted file mutation inside a developer’s own machine. Nothing runs remotely. Nothing executes without visibility. Every action is auditable, deterministic, and reviewable.

This system is designed for:
- Local automation
- Iterative application development
- Controlled AI-assisted refactors
- Transparent, inspectable workflows

The extension is open source for transparency. Chrome Web Store publication is planned, but until then it is installed manually in developer mode.


WHAT THIS IS (AND IS NOT)
-------------------------
- This is NOT a cloud service
- This is NOT a SaaS automation bot
- This is NOT remote execution
- This IS a local automation controller
- This IS a structured, auditable system
- This IS designed for developers who want full control


ABSOLUTE PREREQUISITES (DO NOT SKIP)
-----------------------------------

1. YOU MUST HAVE GIT INSTALLED
   If git is not installed, nothing works.

   Verify:
     git --version

   If missing:

   macOS:
     https://git-scm.com/download/mac

   Linux:
     https://git-scm.com/book/en/v2/Getting-Started-Installing-Git

   Windows (WSL2):
     https://learn.microsoft.com/en-us/windows/wsl/install


2. YOU MUST HAVE A LOCAL COPY OF THE REPOSITORY
   This repository must exist locally on disk.
   Either:
   - Cloned with git
   - OR downloaded as a ZIP and extracted

   This directory MUST remain on your machine.
   The Chrome extension will reference it locally.


3. YOU MUST INSTALL THE CHROME EXTENSION IN DEVELOPER MODE
   This is not optional.

   Official Chrome instructions:
   https://support.google.com/chrome_webstore/answer/2664769?hl=en


MACOS SETUP (CLEAN MACHINE)
--------------------------

1. Install Homebrew:
   https://brew.sh

2. Install git and make:
   brew install git make

3. Verify:
   git --version
   make --version

4. Clone or download the repository into a stable directory:
   Example:
     ~/projects/q-extension


WINDOWS + WSL2 SETUP
-------------------

1. Install WSL2:
   https://learn.microsoft.com/en-us/windows/wsl/install

2. Install Ubuntu from Microsoft Store

3. Inside WSL:
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git make

4. Verify:
   git --version
   make --version

5. Clone or extract the repository inside WSL filesystem


CHROME EXTENSION INSTALLATION
-----------------------------

1. Open Chrome
2. Navigate to:
   chrome://extensions
3. Enable "Developer mode" (top-right)
4. Click "Load unpacked"
5. Select the extension directory inside the repository
6. Confirm extension appears and is enabled


THE QID SYSTEM (CORE CONCEPT)
-----------------------------

All automation in this system is driven by QID objects.

A QID object is a structured JSON definition that describes:
- A file
- Its role
- Its full contents
- Its intent
- Its guarantees

QID objects are NOT commands.
They are declarations.

Example structure (conceptual):

{
  "qid": "q_file_xxxx_1",
  "filepath": "src/example.js",
  "content": "FULL FILE CONTENT WITH HEADER"
}

Rules:
- Every file is fully declared
- No partial context
- No blind writes
- Every change is inspectable
- Every mutation is reversible via git


NO FAAS
-------
This system no longer exposes or documents FAAS.

Only the QID system is used.

QID is the canonical, authoritative format.
All automation is driven by QID-defined state, files, and transitions.


HOW AUTOMATION FLOWS (HIGH LEVEL)
---------------------------------

qinterest.me
   ↓
runitby.com
   ↓
ChatGPT
   ↓
Q Chrome Extension
   ↓
Local filesystem + terminal
   ↓
Git diff review
   ↓
Human approval

Each layer feeds the next.
Nothing auto-executes.
Everything is observable.


SECURITY MODEL
--------------
- Local execution only
- No remote shell
- No hidden execution
- Git diff required for every write
- Human review always possible
- Zero destructive defaults


COMING SOON
-----------
- Chrome Web Store listing
- Signed builds
- Simplified onboarding

CURRENT STATUS
--------------
Public.
Open source.
Manual install.
Transparent by design.


FINAL GUARANTEE
---------------
No critical data is lost.
