// Popup script for extension popup

// Open summary panel (in-page overlay)
document.getElementById('open-sidepanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'showSummaryPanel' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error:', chrome.runtime.lastError.message);
    }
  });

  window.close();
});

// Open settings page
document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Disable extension for current page
document.getElementById('disable-page').addEventListener('click', async () => {
  const statusMessage = document.getElementById('status-message');

  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      statusMessage.textContent = 'Could not get current tab';
      statusMessage.className = 'status-message error';
      return;
    }

    // Send message to content script to disable extension
    chrome.tabs.sendMessage(tab.id, { action: 'disableForCurrentPage' }, (response) => {
      if (chrome.runtime.lastError) {
        statusMessage.textContent = 'Error: ' + chrome.runtime.lastError.message;
        statusMessage.className = 'status-message error';
        return;
      }

      if (response && response.success) {
        const url = new URL(tab.url);
        statusMessage.textContent = `Disabled for ${url.hostname}. Refresh the page to apply.`;
        statusMessage.className = 'status-message success';
      } else {
        statusMessage.textContent = 'Failed to disable extension';
        statusMessage.className = 'status-message error';
      }
    });
  } catch (error) {
    statusMessage.textContent = 'Error: ' + error.message;
    statusMessage.className = 'status-message error';
  }
});
