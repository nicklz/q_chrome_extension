

// Check if the current page is Facebook
state = getState()

console.log('state instagram', state)
 
// Check if the current page is Facebook
if ( window.location.hostname === 'www.instagram.com' && state.status === 'play') {

    // Function to create the menu bar
    function createMenuBar() {
        const menuBar = document.createElement('div');
        menuBar.style.cssText = `
            position: sticky;
            top: 0;
            width: 100vw;
            height: 100px;
            background: lime;
            font-weight: bold;
            font-size: 24px;
            text-transform: uppercase;
            display: flex;
  
            align-items: center;
            padding: 0 20px;
            z-index: 9999;
            border-bottom: 10px solid black;
        `;
        menuBar.innerHTML = `
            <div style="margin-right: 40px;">Nexus Platforms [Q] Extension: Facebook Messenger Download</div>
            <div >
                <button id="refreshBtn">Refresh</button>
                <button id="downloadBtn">Download</button>
                <button id="clearBtn">Clear</button>
            </div>
        `;
        document.body.prepend(menuBar);
  
        // Style the buttons
        const buttons = menuBar.querySelectorAll('button');
        buttons.forEach(button => {
            button.style.cssText = `
                background: lime;
                border: 2px solid black;
                border-radius: 10px;
                padding: 10px;
                font-weight: bold;
                cursor: pointer;
            `;
        });
  
        // Add event listeners
        document.getElementById('refreshBtn').addEventListener('click', refreshScript);
        document.getElementById('downloadBtn').addEventListener('click', runDownload);
        document.getElementById('clearBtn').addEventListener('click', clearLocalStorage);
    }
  
    // Function to create the download screen
    function createDownloadScreen() {
        const downloadScreen = document.createElement('div');
        downloadScreen.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            width: 50vw;
            height: 40vh;
            background: transparent;
            color: white;
            border: 5px solid black;
            overflow-y: scroll;
            padding: 10px;
            z-index: 9999;
        `;
        downloadScreen.id = 'downloadScreen';
  
        // Add a copy button
        const copyButton = document.createElement('button');
        copyButton.innerText = 'Copy';
        copyButton.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: lime;
            color: black;
            font-weight: bold;
            padding: 5px 10px;
            border: 2px solid black;
            border-radius: 10px;
            cursor: pointer;
        `;
        copyButton.addEventListener('click', copyToClipboard);
        downloadScreen.appendChild(copyButton);
  
        // Add content container
        const contentContainer = document.createElement('div');
        contentContainer.id = 'contentContainer';
        downloadScreen.appendChild(contentContainer);
  
        document.body.appendChild(downloadScreen);
  
        // Load any existing messages from localStorage
        loadMessages();
  
        // Style scrollbar for dark mode
        downloadScreen.style.scrollbarWidth = 'thin';
        downloadScreen.style.scrollbarColor = '#888 #333';
    }
  
    // Function to refresh the script without reloading the page
    function refreshScript() {
        console.log('Refreshing script...');
        window.location.reload();
    }
  
    // Function to clear local storage and reset the screen
    function clearLocalStorage() {
        localStorage.removeItem('downloadedMessages');
        document.getElementById('contentContainer').innerHTML = '';
        console.log('Local storage cleared.');
    }
  
    // Function to copy the text from the download screen to the clipboard
    function copyToClipboard() {
        const textToCopy = document.getElementById('contentContainer').innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
            alert('Copied to clipboard!');
        }).catch(err => {
            console.error('Could not copy text: ', err);
        });
    }
  
    // Function to load messages from local storage
    function loadMessages() {
        const savedMessages = JSON.parse(localStorage.getItem('downloadedMessages')) || [];
        const contentContainer = document.getElementById('contentContainer');
        savedMessages.forEach((msg, index) => {
            const messageElement = document.createElement('div');
            messageElement.innerHTML = `
                ========================<br>
                <b>NAME</b><br>
                _______________________________________ <br>
                ${msg}<br>
                ========================
            `;
            contentContainer.appendChild(messageElement);
        });
    }
  
    // Continuous scrolling function
    async function continuousScroll(gridDiv) {
        while (true) {
            gridDiv.scrollTop -= 1000;  // Scroll up by 1000 pixels
            await new Promise(resolve => setTimeout(resolve, 10000));  // Wait 3 seconds
            runDownload();  // Run the download function after each scroll
        }
    }
  
  
  
  
  
  
  
  
  // Function to scroll and download the messages
  function runDownload() {
    let parentDiv = document.querySelector('div[style^="--chat"]');
  
    if (!parentDiv) {
        parentDiv = document.querySelector('div[aria-label^="Messages in conversation"]');
    }
  
    if (parentDiv) {
        let gridDiv = parentDiv.querySelector('div[style^="--card-background"]');
  
        if (!gridDiv) {
            gridDiv = parentDiv.querySelector('div[role="grid"] div div');
        }
  
        if (gridDiv) {
            let downloadedMessages = JSON.parse(localStorage.getItem('downloadedMessages')) || [];
  
            // Scroll and capture messages
            const messages = document.querySelectorAll('span[dir="auto"] div[dir="auto"]');
            messages.forEach(msg => {
                const nameContainer = msg.closest('[role="row"]');
                let name = 'Nick'; // Default name is Nick
  
                // Try to find the username in the aria-label div (e.g., "Open the profile page of cincinnatizach")
                if (nameContainer) {
                    const profileDiv = nameContainer.querySelector('a[aria-label^="Open the profile page of"]');
                    if (profileDiv) {
                        const ariaLabel = profileDiv.getAttribute('aria-label');
                        // Extract username from the aria-label (e.g., "Open the profile page of cincinnatizach")
                        const usernameMatch = ariaLabel.match(/Open the profile page of (.+)/);
                        if (usernameMatch && usernameMatch[1]) {
                            name = usernameMatch[1].trim();
                        }
                    }
                }
  
                const textContent = msg.innerText.trim();
  
                if (textContent && !downloadedMessages.includes(textContent)) {
                    downloadedMessages.push(textContent); // Avoid duplicates
  
                    // Display in the download screen
                    const messageElement = document.createElement('div');
                    messageElement.innerHTML = `
                        ___________________________________________________________________<br>
                        <b>${name}</b><br>
                        ${textContent}<br>
                        ___________________________________________________________________<br>
                    `;
                    document.getElementById('contentContainer').appendChild(messageElement);
                }
            });
  
            // Save to localStorage
            localStorage.setItem('downloadedMessages', JSON.stringify(downloadedMessages));
            console.log('Messages saved to localStorage:', downloadedMessages);
  
            // Start continuous scrolling
            continuousScroll(gridDiv);
        } else {
            console.log("No grid div found with role='grid'.");
        }
    } else {
        console.log("No parent div found with '--chat' style.");
    }
  }
  
  
  
  
  
  
  
  
  
  
    // Initialize the script
    createMenuBar();
    createDownloadScreen();
  }
  
  