<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Darkmode Selector & Loader</title>
  <style>
    body {
      margin: 0;
      font-family: sans-serif;
    }

    .darkmode-checkbox {
      margin-left: 10px;
      transform: scale(1.2);
    }

    .floating-ui {
      position: fixed;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(to right, #1f1f1f, #333);
      color: #fff;
      padding: 12px 24px;
      display: flex;
      gap: 12px;
      align-items: center;
      border-radius: 16px 16px 0 0;
      z-index: 10000;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.5);
    }

    .floating-ui button {
      background: linear-gradient(135deg, #4caf50, #81c784);
      border: none;
      padding: 8px 14px;
      color: white;
      font-weight: bold;
      border-radius: 8px;
      cursor: pointer;
    }

    .floating-ui .count {
      font-size: 14px;
      font-weight: bold;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(3px);
      z-index: 9999;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-direction: column;
      color: white;
    }

    .progress-bar-container {
      width: 60%;
      height: 30px;
      background: #444;
      border-radius: 15px;
      overflow: hidden;
      margin-top: 20px;
      box-shadow: 0 0 10px #2e7d32;
    }

    .progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(to right, #00e676, #1de9b6, #69f0ae);
      animation: pulse 2s infinite alternate ease-in-out;
    }

    @keyframes pulse {
      0% {
        filter: brightness(1);
      }
      100% {
        filter: brightness(1.3);
      }
    }
  </style>
</head>
<body>

<script>
(function () {
  const STORAGE_KEY = "darkmode_state_v1";
  const overlayId = "screen-overlay-progress";

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function createUI(state) {
    const rows = document.querySelectorAll('[role="row"]');
    rows.forEach(row => {
      const clipId = row.getAttribute("data-key");
      if (!clipId) return;

      // Prevent double injection
      if (row.querySelector('.darkmode-checkbox')) return;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "darkmode-checkbox";
      checkbox.checked = !!state[clipId];

      checkbox.addEventListener("change", () => {
        state[clipId] = checkbox.checked;
        saveState(state);
        updateFloatingUI(state);
      });

      const labelTarget = row.querySelector("span[title]");
      if (labelTarget) labelTarget.parentElement.appendChild(checkbox);
    });
  }

  function updateFloatingUI(state) {
    const count = Object.values(state).filter(Boolean).length;
    const countSpan = document.getElementById("floating-count");
    if (countSpan) countSpan.textContent = `${count} selected`;
  }

  function injectFloatingUI(state) {
    const container = document.createElement("div");
    container.className = "floating-ui";

    const count = document.createElement("span");
    count.id = "floating-count";
    count.className = "count";
    count.textContent = "0 selected";

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "Download";
    // Placeholder

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start";
    startBtn.onclick = () => startProcess(state);

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop";
    stopBtn.onclick = () => {
      const overlay = document.getElementById(overlayId);
      if (overlay) overlay.remove();
    };

    container.append(count, downloadBtn, startBtn, stopBtn);
    document.body.appendChild(container);
  }

  function startProcess(state) {
    const selected = Object.entries(state).filter(([_, v]) => v).map(([k]) => k);
    if (selected.length === 0) return;

    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "overlay";

    const label = document.createElement("div");
    label.textContent = "Processing...";

    const barContainer = document.createElement("div");
    barContainer.className = "progress-bar-container";

    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";

    barContainer.appendChild(progressBar);
    overlay.append(label, barContainer);
    document.body.appendChild(overlay);

    let index = 0;
    const interval = setInterval(() => {
      const percent = Math.min(100, Math.floor(((index + 1) / selected.length) * 100));
      progressBar.style.width = `${percent}%`;
      console.log("Processing row ID:", selected[index]);
      index++;
      if (index >= selected.length) {
        clearInterval(interval);
        setTimeout(() => overlay.remove(), 800);
      }
    }, 500);
  }

  // Execute
  const currentState = loadState();
  createUI(currentState);
  injectFloatingUI(currentState);
  updateFloatingUI(currentState);
})();
</script>

</body>
</html>
