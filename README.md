# 🧠⚙️ Q Chrome Extension – Local Automation Framework

## 🚀 Quick Start

NO LONGER UPDATED SEE CHROME STORE:
https://chromewebstore.google.com/detail/nexus-platforms-q-browser/olcjonjpklkacajlegajfegbialmcphh

1. Install the Chrome extension (manual install).
2. Locate the repository on your local machine.
3. Run:

```
make install && make up
```

---

## 🧩 Overview

The **Q Chrome Extension** is a **local-first automation framework** that unifies:

- 🌐 Browser interaction  
- 🖥 Terminal command execution  
- 🧠 Structured, AI-driven file mutation  

All execution happens **entirely on your machine**.

- ❌ Nothing runs remotely  
- 👁 Nothing executes without visibility  
- 🔍 Every change is auditable via Git  

The Chrome extension is the **control surface**.  
The local repository is the **execution engine**.

---

## 🧱 Prerequisites

### 1️⃣ Git (Required)

Verify:
```
git --version
```

Install:
- macOS: https://git-scm.com/download/mac  
- Linux: https://git-scm.com/book/en/v2/Getting-Started-Installing-Git  
- Windows (WSL2): https://learn.microsoft.com/en-us/windows/wsl/install  

---

### 2️⃣ Local Repository

You must have a local copy of this repository.

Options:
- Clone via Git  
- Download ZIP and extract  

⚠️ The repository **must live locally**.  
The Chrome extension points to it directly.

---

### 3️⃣ Google Chrome

- Chrome installed
- Extensions enabled

https://support.google.com/chrome_webstore/answer/2664769

---

## 🍎 macOS Setup

```
brew install git make
git clone <REPO_URL>
cd <repo-directory>
```

---

## 🪟 Windows + WSL2 Setup

```
sudo apt update && sudo apt upgrade -y
sudo apt install -y git make
git clone <REPO_URL>
cd <repo-directory>
```

---

## 🧩 Chrome Extension Install

1. Open Chrome  
2. Go to `chrome://extensions`  
3. Enable **Developer mode**  
4. Click **Load unpacked**  
5. Select the extension folder  
6. Confirm enabled  

---

## ⚙️ Local Installation

Install:
```
make install
```

Start:
```
make up
```

Stop:
```
make down
```

Restart:
```
make restart
```

---

## 🆔 The QID System

All automation is defined using **QID objects**.

- Fully declares a file
- Contains complete contents
- Encodes role, context, guarantees
- Auditable and diffable

No blind edits.  
No partial writes.  
No implicit mutation.

---

## 🔄 Automation Flow

External feeds → ChatGPT → Q Extension → Local Repo → Git Diff → Human Approval

---

## 🔐 Security Model

- Local-only execution
- No remote shell
- No auto-exec
- Git diff required
- Fully reversible

---

## 📦 Status

🛒 Chrome Web Store: *Coming Soon*

Current:
- Public
- Open source
- Manual install for transparency

---

## ✅ Final Guarantee

**No critical data is lost.**

---

## ❓ FAQ — Common Questions & Fixes

### 1️⃣ How do I install a downloaded ZIP as a Chrome extension?
1. Unzip the downloaded file
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked**
5. Select the **unzipped extension folder**
6. Confirm the extension is enabled ✅

---

### 2️⃣ Chrome says “Manifest file missing or unreadable” — what’s wrong?
You selected the wrong folder.  
Make sure the folder contains `manifest.json` at its root.

---

### 3️⃣ Can I install the extension directly from WSL?
❌ No. Chrome extensions must be loaded from the **Windows or macOS filesystem**, not the Linux filesystem inside WSL.

Recommended:
- Keep the extension folder on Windows/macOS
- Keep the automation repo inside WSL

---

### 4️⃣ Where should the repo live when using WSL2?
Inside WSL’s Linux filesystem:
```
/home/<user>/q/
```
Avoid `/mnt/c` for performance and file watcher stability.

---

### 5️⃣ Git is not found — how do I fix this?
Install Git:

Ubuntu / WSL:
```
sudo apt install -y git
```

macOS:
```
brew install git
```

---

### 6️⃣ Homebrew isn’t installed on macOS — what’s the fastest way?
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Restart your terminal after install.

---

### 7️⃣ Should I install Homebrew inside WSL?
❌ No. Homebrew is **macOS-only**.  
Use `apt` inside WSL instead.

---

### 8️⃣ `make` is missing — how do I install it?
Ubuntu / WSL:
```
sudo apt install -y make
```

macOS:
```
brew install make
```

---

### 9️⃣ `make install` fails — what should I check first?
- Git installed
- Make installed
- Correct directory
- No permission errors
- `.env.example` exists

---

### 🔟 Ports are already in use — what do I do?
Stop existing processes:
```
make down
```
Or kill manually:
```
lsof -i :PORT
kill -9 PID
```

---

### 1️⃣1️⃣ Can this run without the Chrome extension?
⚠️ Partially.  
The repo can run standalone, but **automation orchestration requires the extension**.

---

### 1️⃣2️⃣ Does this execute anything automatically?
❌ No.  
Every command is explicit, visible, and reviewable.

---

### 1️⃣3️⃣ Is internet access required?
Only for:
- Dependency installation
- Git cloning

All execution is local.

---

### 1️⃣4️⃣ Where are automation state and memory stored?
Inside the repository:
- `.q/`
- `.state/`
- Local JSON + logs

---

### 1️⃣5️⃣ Can I undo changes?
✅ Yes.
All changes are Git-diffed and reversible.

---

### 1️⃣6️⃣ Is Windows (non‑WSL) supported?
❌ No.  
WSL2 is required for Linux parity and tooling.

---

### 1️⃣7️⃣ Node or Python version errors?
Use system defaults first.  
Avoid `nvm` or `pyenv` until stable.

---

### 1️⃣8️⃣ Why not Docker?
Docker hides file mutations and diffs.  
Q requires **transparent filesystem access**.

---

### 1️⃣9️⃣ Is any data sent to remote servers?
❌ No.  
No telemetry. No remote shell. No background sync.

---

### 2️⃣0️⃣ What happens if something breaks?
- Execution halts
- State is preserved
- Git diff shows exactly what changed
- No critical data is lost

---
