// Settings page script
const DEFAULT_MODEL = 'local';

// Load saved settings when page opens
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved model preference
  const result = await chrome.storage.sync.get(['selectedModel', 'anthropicApiKey']);
  const selectedModel = result.selectedModel || DEFAULT_MODEL;
  const apiKey = result.anthropicApiKey || '';

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
      anthropicApiKey: apiKey
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
