
// Self-executing function for script initialization
(async () => {
    

    let state = getState();


    

    if (!window.location.hostname.includes("blockchain.com")) {
        console.log("[LOG] Script aborted: Not on blockchain.com.");
        return;
    }

    console.log("[LOG] Script running on blockchain.com");

    if (state.status === 'play') {
        let globalState = await getGlobalState();
        let intervalId = null;
    
        // If globalState is null, initialize it
        if (!globalState) {
            globalState = { transactions: [], status: 'play' };
            await setGlobalState(globalState);
        }
    
        // Create and display the log panel
        await createLogPanel();
        await updateLogPanel();
    
        // Start the extraction loop if status is "play"
        if (globalState.status === "play") {
            startExtractionLoop();
        }
    
        // Update the title to include the total number of transactions
        async function updateLogPanelTitle() {
            const logPanelTitle = document.querySelector("#btc-log-panel h3");
            if (logPanelTitle) {
                logPanelTitle.textContent = `BTC Transaction Tracker [Total Addresses Found: ${globalState.transactions.length}]`;
            }
        }
    
        // Create and display the log panel
        async function createLogPanel() {
            // Get the current global state
            let globalState = await getGlobalState();
    
            // Get the current URL
            let currentUrl = window.location.href;
        
             
    
                                    
            let logPanel = document.createElement("div");
            logPanel.id = "btc-log-panel";
            logPanel.style = `
                position: fixed; top: 0; left: 0; width: 350px; height: 100vh; background: rgba(0, 0, 0, 0.95);
                color: #fff; padding: 10px; overflow-y: auto; z-index: 99999; display: flex; flex-direction: column;
                box-shadow: 2px 0 10px rgba(0, 0, 0, 0.5); transition: all 0.3s ease-in-out;
            `;
    
            logPanel.innerHTML = `
                <h3 style="margin: 0 0 10px;">BTC Transaction Tracker [Total Addresses Found: 0]</h3>
                <button id="clear-storage" style="margin-bottom: 10px; padding: 8px; background: red; color: white; border: none; cursor: pointer; font-size: 14px;">Clear Storage</button>
                <button id="toggle-status" style="margin-bottom: 10px; padding: 8px; background: green; color: white; border: none; cursor: pointer; font-size: 14px;">Pause</button>
                <button id="run-links" style="margin-bottom: 10px; padding: 8px; background: blue; color: white; border: none; cursor: pointer; font-size: 14px;">Run</button>
                <ul id="btc-log-list" style="list-style: none; padding: 0; margin: 0;"></ul>
            `;
    
            document.body.appendChild(logPanel);
    
            // Add event listener for clear storage button
            document.getElementById("clear-storage").addEventListener("click", async () => {
                globalState.transactions = [];
                await setGlobalState(globalState);
                updateLogPanel();
                console.log("[LOG] Storage cleared.");
            });
    
            // Add event listener for toggle status button
            document.getElementById("toggle-status").addEventListener("click", async () => {
                globalState.status = globalState.status === "play" ? "paused" : "play";
                document.getElementById("toggle-status").textContent = globalState.status === "play" ? "Pause" : "Play";
                await setGlobalState(globalState);
    
                if (globalState.status === "play") {
                    startExtractionLoop();
                } else {
                    clearInterval(intervalId);
                }
            });
    
            // Add event listener for run button
            document.getElementById("run-links").addEventListener("click", async () => {
                const links = [...document.querySelectorAll("#btc-log-list a")];
                let index = 0;
    
                function openNextLink() {
                    if (index < links.length) {
                        links[index].click();
    
    
                        
                        index++;
                        setTimeout(openNextLink, 5000); // 200ms delay
                    }
                }
                    // Check if the current URL is already in the transactions
                if (!globalState.transactions.some(entry => currentUrl.includes(entry.address))) {
                  openNextLink();
                }
            });
    
            console.log("[LOG] Log panel initialized.");
        }
    
        // Update log panel with stored data
        function updateLogPanel() {
            let logList = document.getElementById("btc-log-list");
            if (!logList) return;
            logList.innerHTML = "";
    
            globalState.transactions.forEach(entry => {
                let li = document.createElement("li");
                li.innerHTML = `
                    <a href="https://www.blockchain.com/explorer/addresses/BTC/${entry.address}" 
                       target="_blank" 
                       style="color: #00ffff; text-decoration: none;">
                       ${entry.address}
                    </a> → ${entry.amount} BTC
                `;
                logList.appendChild(li);
            });
    
            // Update the panel title with the transaction count
            updateLogPanelTitle();
        }
    
    
        async function extractBitcoinTransactions() {
          // Get the current global state
          let globalState = await getGlobalState();
          
          // Get the current URL
          let currentUrl = window.location.href;
      
          // Check if the current URL is already in the transactions
          if (globalState.transactions.some(entry => currentUrl.includes(entry.address))) {
              console.log("[LOG] Transaction already exists in global state. Skipping extraction.");
              return; // Exit the function if the transaction already exists
          }
      
          // Proceed with extraction if the transaction is not in the global state
          try {
              // Find all "To" sections with addresses
              let transactionSections = [...document.querySelectorAll("div")]
                  .filter(div => div.innerText.trim().startsWith("To"));
      
              let section = transactionSections[8];
              console.log('section', section);
      
              let links = [...section.querySelectorAll("a[href^='/explorer/addresses/BTC/']")];
              let amounts = [...section.querySelectorAll("div")]
                  .map(div => parseFloat(div.innerText.replace("BTC", "").trim()))
                  .filter(num => !isNaN(num));
      
              console.log('links', links);
              console.log('amounts', amounts);
      
              if (links.length >= 1 && amounts.length >= 1) {
                  let firstAddress = links[0].innerText.trim();
                  let secondAddress = firstAddress;
                  let firstAmount = parseFloat(amounts[5]).toFixed(8);
                  let secondAmount = -0.000001;
      
                  if (links.length >= 2) {
                      secondAddress = links[1].innerText.trim();
                  }
      
                  if (amounts.length > 10) {
                      secondAmount = parseFloat(amounts[13]).toFixed(8);
                  }
      
                  let linkToClick = 1;
                  let finalAddress = firstAddress;
                  let finalAmount = firstAmount;
                  let finalSecondAddress = secondAddress;
                  let finalSecondAmount = secondAmount;
      
                  if (firstAmount < secondAmount) {
                      linkToClick = 2;
                      finalAddress = secondAddress;
                      finalAmount = secondAmount;
                      finalSecondAddress = firstAddress;
                      finalSecondAmount = firstAmount;
                  }
      
                  // Check if the transaction already exists
                  if (!globalState.transactions.some(entry => entry.address === firstAddress && entry.amount === firstAmount)) {
                      console.log(`[LOG] Top level: ${finalAddress} → ${finalAmount} BTC`);
                      console.log(`[LOG] Second level: ${finalSecondAddress} → ${finalSecondAmount} BTC`);
      
                      globalState.transactions.push({ address: finalAddress, amount: finalAmount });
      
                      if (finalSecondAmount > 0) {
                          globalState.transactions.push({ address: finalSecondAddress, amount: finalSecondAmount });
                      }
      
                      // Save updated state
                      await setGlobalState(globalState);
                      updateLogPanel();
                  }
      
                  // Click second address to follow the transaction trail
                  setTimeout(() => {
                      console.log(`[LOG] Clicking next address: ${linkToClick}`);
                      links[linkToClick - 1].click();
                  }, 1000);
              }
          } catch (error) {
              console.error("[ERROR] Failed to extract transaction data:", error);
          }
      }
      
        // New function to find #run-links and click it
        async function runAllCommand() {
          const runLinks = document.querySelectorAll("#run-links");
          runLinks.forEach(() => {
              link => link.click();
              console.log('RUN CLICKED');
            }
          )
        }
    
        // Start the extraction loop
        function startExtractionLoop() {
            clearInterval(intervalId); // Ensure no duplicate loops
            intervalId = setInterval(async () => {
                if (globalState.status === "play") {
                    await extractBitcoinTransactions();
                    await runAllCommand();
                }
            }, 1000);
        }
    }

 
})();







