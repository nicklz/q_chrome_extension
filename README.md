
Q CHROME EXTENSION – LOCAL AUTOMATION FRAMEWORK
=============================================

OVERVIEW
--------
The [Q] Chrome Extension is a local-first automation framework that connects browser interaction, terminal execution, and structured AI-driven file mutation entirely on your own machine.

Nothing runs remotely.
Nothing executes without visibility.
Everything is auditable via git.

The Chrome extension is the control surface.
The local repo is the engine.



QUICK START 

--------------------------------

This installs the local automation engine.

From INSIDE the installed directory:

- make install && make up




PREREQUISITES 
-----------------------------------


1. Git MUST be installed

Verify:
  git --version

Install:

macOS:
  https://git-scm.com/download/mac

Linux:
  https://git-scm.com/book/en/v2/Getting-Started-Installing-Git

Windows (WSL2):
  https://learn.microsoft.com/en-us/windows/wsl/install


2. You need a copy of this repository

Either:
- Clone via git
- OR download ZIP and extract

This directory MUST live on your local filesystem.
The Chrome extension points at it directly.


3. Install Chrome and ensure extensions are enabled

Official Chrome instructions:
https://support.google.com/chrome_webstore/answer/2664769?hl=en


MACOS SETUP
----------------------

1. Install Homebrew:
   https://brew.sh

2. Install required tools:
   brew install git make

3. Verify:
   git --version
   make --version

4. Download or clone the repo:
   git clone <REPO_URL>

5. Change into the repo directory:
   cd <repo-directory>


WINDOWS + WSL2 SETUP
-------------------

1. Install WSL2:
   https://learn.microsoft.com/en-us/windows/wsl/install

2. Install Ubuntu from Microsoft Store

3. Open Ubuntu (WSL terminal)

4. Install tools:
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git make

5. Verify:
   git --version
   make --version

6. Clone or extract the repo inside WSL:
   git clone <REPO_URL>

7. Change into the repo directory:
   cd <repo-directory>


CHROME EXTENSION INSTALL
-----------------------------------

This installs the UI control surface.

1. Open Chrome
2. Go to:
   chrome://extensions
3. Enable "Developer mode" (top-right)
4. Click "Load unpacked"
5. Select the Chrome extension folder from the repo
6. Confirm the extension is enabled

LOCAL INSTALLATION 

--------------------------------

This installs the local automation engine.

From INSIDE the repository directory:

1. Install everything:
   make install

What this does:
- Creates .env from example
- Installs system packages
- Installs Node + Python deps
- Builds Python virtual environment
- Initializes local memory files

2. Start the system:
   make up

What this does:
- Validates environment
- Clears conflicting ports
- Starts local services
- Brings the automation engine online



STOP / RESTART
--------------

Stop:
  make down

Restart:
  make restart


THE QID SYSTEM
-----------------------------------------

All automation is defined through QID objects.

A QID object:
- Fully declares a file
- Includes full contents
- Includes role, context, guarantees
- Is auditable and diffable

- q_type_hash_number
- q_command_h412_02
- q_write_a231_12

There are NO blind edits.
There are NO partial writes.





AUTOMATION FLOW
----------------------------

qinterest.me
   feeds
runitby.com
   feeds
ChatGPT
   feeds
Q Chrome Extension
   drives
Local repo + terminal
   verified by
Git diff + human review

The extension orchestrates.
The repo executes.
The human approves.


SECURITY MODEL
--------------
- Local-only execution
- No remote shell
- No auto-exec
- Git diff required
- Reversible by design


STATUS
------
Chrome Web Store release: coming soon

Current:
- Public
- Open source
- Manual install for transparency


FINAL GUARANTEE
---------------
No critical data is lost.
