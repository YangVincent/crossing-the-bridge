// Settings page script
const DEFAULT_MODEL = 'local';
const DEFAULT_LIST_MODE = 'blocklist';

// Load saved settings when page opens
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const result = await chrome.storage.sync.get([
    'selectedModel',
    'anthropicApiKey',
    'listMode',
    'urlPatterns'
  ]);

  const selectedModel = result.selectedModel || DEFAULT_MODEL;
  const apiKey = result.anthropicApiKey || '';
  const listMode = result.listMode || DEFAULT_LIST_MODE;
  const urlPatterns = result.urlPatterns || [];

  // Set the radio button
  const radioButton = document.getElementById(`model-${selectedModel}`);
  if (radioButton) {
    radioButton.checked = true;
    updateRadioStyles();
  }

  // Set API key if saved
  if (apiKey) {
    document.getElementById('api-key').value = apiKey;
  }

  // Show API key section if cloud is selected
  if (selectedModel === 'cloud') {
    document.getElementById('api-key-section').style.display = 'block';
  }

  // Set list mode
  setListMode(listMode);

  // Render URL patterns
  renderUrlList(urlPatterns);
});

// Update visual styles when radio selection changes
function updateRadioStyles() {
  document.querySelectorAll('.radio-option').forEach(option => {
    const radio = option.querySelector('input[type="radio"]');
    if (radio.checked) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });
}

// Handle radio button changes
document.querySelectorAll('input[name="model"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    updateRadioStyles();

    // Show/hide API key section based on selection
    const apiKeySection = document.getElementById('api-key-section');
    if (e.target.value === 'cloud') {
      apiKeySection.style.display = 'block';
    } else {
      apiKeySection.style.display = 'none';
    }
  });
});

// Handle clicking on the label to select radio
document.querySelectorAll('.radio-option').forEach(option => {
  option.addEventListener('click', (e) => {
    // Don't double-trigger if clicking the radio button itself
    if (e.target.tagName !== 'INPUT') {
      const radio = option.querySelector('input[type="radio"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
  });
});

// List mode management
let currentListMode = DEFAULT_LIST_MODE;
let currentUrlPatterns = [];

function setListMode(mode) {
  currentListMode = mode;

  // Update button styles
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update descriptions
  if (mode === 'blocklist') {
    document.getElementById('blocklist-description').style.display = 'block';
    document.getElementById('allowlist-description').style.display = 'none';
  } else {
    document.getElementById('blocklist-description').style.display = 'none';
    document.getElementById('allowlist-description').style.display = 'block';
  }
}

// Mode button handlers
document.getElementById('mode-blocklist').addEventListener('click', () => {
  setListMode('blocklist');
});

document.getElementById('mode-allowlist').addEventListener('click', () => {
  setListMode('allowlist');
});

// Render URL list
function renderUrlList(patterns) {
  currentUrlPatterns = patterns || [];
  const listEl = document.getElementById('url-list');

  if (patterns.length === 0) {
    listEl.innerHTML = '<div class="empty-list-message">No patterns added yet</div>';
    return;
  }

  listEl.innerHTML = patterns.map((pattern, index) => `
    <div class="url-item">
      <span class="url-item-text">${escapeHtml(pattern)}</span>
      <button class="remove-btn" data-index="${index}">Remove</button>
    </div>
  `).join('');

  // Add event listeners to remove buttons
  listEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      removePattern(index);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Add pattern
document.getElementById('add-pattern-btn').addEventListener('click', () => {
  const input = document.getElementById('url-pattern-input');
  const pattern = input.value.trim();

  if (!pattern) {
    return;
  }

  // Validate regex
  try {
    new RegExp(pattern);
  } catch (e) {
    alert('Invalid regex pattern: ' + e.message);
    return;
  }

  // Add to list if not already present
  if (!currentUrlPatterns.includes(pattern)) {
    currentUrlPatterns.push(pattern);
    renderUrlList(currentUrlPatterns);
    input.value = '';
  }
});

// Allow Enter key to add pattern
document.getElementById('url-pattern-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('add-pattern-btn').click();
  }
});

// Remove pattern
function removePattern(index) {
  currentUrlPatterns.splice(index, 1);
  renderUrlList(currentUrlPatterns);
}

// Save settings
document.getElementById('save-button').addEventListener('click', async () => {
  const selectedModel = document.querySelector('input[name="model"]:checked')?.value || DEFAULT_MODEL;
  const apiKey = document.getElementById('api-key').value.trim();
  const statusMessage = document.getElementById('status-message');

  // Validate cloud model has API key
  if (selectedModel === 'cloud' && !apiKey) {
    statusMessage.textContent = 'Please enter an API key for Claude AI';
    statusMessage.className = 'status-message error';
    return;
  }

  try {
    // Save to chrome storage
    await chrome.storage.sync.set({
      selectedModel: selectedModel,
      anthropicApiKey: apiKey,
      listMode: currentListMode,
      urlPatterns: currentUrlPatterns
    });

    // Show success message
    statusMessage.textContent = 'Settings saved successfully!';
    statusMessage.className = 'status-message success';

    // Hide success message after 3 seconds
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);

  } catch (error) {
    statusMessage.textContent = `Error saving settings: ${error.message}`;
    statusMessage.className = 'status-message error';
  }
});
