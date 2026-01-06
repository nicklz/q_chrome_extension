# 🧠⚙️ Q Chrome Extension – Local Automation Framework

## 🚀 Quick Start

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
