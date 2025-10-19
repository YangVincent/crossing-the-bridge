// Side panel script for page summarization

let currentTab = null;

// Get current active tab when panel opens
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Extract Chinese text from the page
async function extractChineseText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Function to check if text contains Chinese
        function containsChinese(text) {
          return /[\u4e00-\u9fff]/.test(text);
        }

        // Get all text content from the page
        const body = document.body.innerText || document.body.textContent;

        // Split into paragraphs and filter for Chinese text
        const paragraphs = body
          .split('\n')
          .map(p => p.trim())
          .filter(p => p.length > 0 && containsChinese(p));

        return paragraphs.join('\n\n');
      }
    });

    return results[0].result;
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error('Failed to extract text from page. Make sure you have permission to access this page.');
  }
}

// Summarize text using the selected model
async function summarizeText(text, hskLevel) {
  // Get the selected model from settings
  const settings = await chrome.storage.sync.get(['selectedModel']);
  const selectedModel = settings.selectedModel || 'local';

  const hskDescriptions = {
    1: 'HSK 1 (150个基础词汇)',
    2: 'HSK 2 (300个词汇)',
    3: 'HSK 3 (600个词汇)',
    4: 'HSK 4 (1200个词汇)',
    5: 'HSK 5 (2500个词汇)',
    6: 'HSK 6 (5000+个词汇)'
  };

  const prompt = `Summarize the following Chinese text using only ${hskDescriptions[hskLevel]} vocabulary. Keep it concise (about 1/4 of original length) and use simple sentences.

Text to summarize:
${text}

Summary:`;

  // Choose the appropriate action based on selected model
  const action = selectedModel === 'cloud' ? 'getIdiomaticPhrasing' : 'summarizeWithLocalLLM';

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: action,
        chineseText: prompt,
        hskLevel: hskLevel
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.success) {
          // Clean up the response to remove any prompt echoing
          let summary = response.text;

          // Remove the prompt if it was echoed back
          const summaryMarker = 'Summary:';
          const markerIndex = summary.lastIndexOf(summaryMarker);
          if (markerIndex !== -1) {
            summary = summary.substring(markerIndex + summaryMarker.length).trim();
          }

          // Remove the original prompt text if present
          const textMarker = 'Text to summarize:';
          const textMarkerIndex = summary.indexOf(textMarker);
          if (textMarkerIndex !== -1) {
            const afterMarker = summary.substring(textMarkerIndex);
            const summaryStart = afterMarker.indexOf(summaryMarker);
            if (summaryStart !== -1) {
              summary = afterMarker.substring(summaryStart + summaryMarker.length).trim();
            }
          }

          // Remove any leading/trailing quotes or whitespace
          summary = summary.replace(/^["'"\s]+|["'"\s]+$/g, '').trim();

          resolve(summary);
        } else {
          reject(new Error(response?.error || 'Failed to generate summary'));
        }
      }
    );
  });
}

// Show status message
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = `status-message visible ${type}`;

  if (type !== 'error') {
    setTimeout(() => {
      statusEl.classList.remove('visible');
    }, 5000);
  }
}

// Show loading state
function showLoading(show) {
  const loadingEl = document.getElementById('loading');
  const btnEl = document.getElementById('summarize-btn');
  const resultEl = document.getElementById('result-container');

  if (show) {
    loadingEl.style.display = 'block';
    btnEl.disabled = true;
    resultEl.classList.remove('visible');
  } else {
    loadingEl.style.display = 'none';
    btnEl.disabled = false;
  }
}

// Display result
function showResult(summary, hskLevel) {
  const resultEl = document.getElementById('result-container');
  const textEl = document.getElementById('result-text');
  const badgeEl = document.getElementById('result-badge');

  textEl.textContent = summary;
  badgeEl.textContent = `HSK ${hskLevel}`;
  resultEl.classList.add('visible');
}

// Main summarize handler
document.getElementById('summarize-btn').addEventListener('click', async () => {
  console.log('Summarize button clicked!');

  try {
    showLoading(true);
    console.log('Loading state shown');

    // Get current tab
    currentTab = await getCurrentTab();
    console.log('Current tab:', currentTab);

    if (!currentTab) {
      throw new Error('No active tab found');
    }

    // Get HSK level
    const hskLevel = document.getElementById('hsk-level').value;
    console.log('HSK Level:', hskLevel);

    // Extract Chinese text
    showStatus('Extracting Chinese text from page...', 'info');
    console.log('Extracting text from tab:', currentTab.id);

    const chineseText = await extractChineseText(currentTab.id);
    console.log('Extracted text length:', chineseText?.length);
    console.log('First 200 chars:', chineseText?.substring(0, 200));

    if (!chineseText || chineseText.trim().length === 0) {
      throw new Error('No Chinese text found on this page');
    }

    // Limit text length to avoid overwhelming the LLM
    const maxLength = 3000;
    const textToSummarize = chineseText.length > maxLength
      ? chineseText.substring(0, maxLength) + '...'
      : chineseText;

    console.log('Text to summarize length:', textToSummarize.length);

    // Summarize
    showStatus('Generating summary...', 'info');
    console.log('Calling summarizeText...');

    const summary = await summarizeText(textToSummarize, hskLevel);
    console.log('Summary received:', summary);

    // Show result
    showLoading(false);
    showResult(summary, hskLevel);
    showStatus('Summary generated successfully!', 'info');

  } catch (error) {
    console.error('Error in summarize handler:', error);
    showLoading(false);
    showStatus(error.message, 'error');
  }
});

// Copy button handler
document.getElementById('copy-btn').addEventListener('click', async () => {
  const textEl = document.getElementById('result-text');
  const btnEl = document.getElementById('copy-btn');

  try {
    await navigator.clipboard.writeText(textEl.textContent);
    btnEl.textContent = '✓ Copied';
    btnEl.classList.add('copied');

    setTimeout(() => {
      btnEl.textContent = 'Copy';
      btnEl.classList.remove('copied');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
    showStatus('Failed to copy text', 'error');
  }
});

// Initialize when panel opens
document.addEventListener('DOMContentLoaded', async () => {
  currentTab = await getCurrentTab();
  console.log('Side panel loaded for tab:', currentTab?.id);
});
