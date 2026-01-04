// YouTube Panel - Caption display and sync

let transcript = [];
let currentVideoId = null;
let currentActiveIndex = -1;
let autoScrollEnabled = true;

// DOM elements
const captionContainer = document.getElementById('caption-container');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const currentTimeDisplay = document.getElementById('current-time');
const autoScrollToggle = document.getElementById('auto-scroll');

// Format time as M:SS or H:MM:SS
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Get current tab's video ID
async function getCurrentVideoId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          if (url.hostname.includes('youtube.com')) {
            resolve(url.searchParams.get('v'));
            return;
          }
        } catch (e) {}
      }
      resolve(null);
    });
  });
}

// Show loading state
function showLoading() {
  captionContainer.innerHTML = `
    <div class="loading-container">
      <div class="spinner"></div>
      <div class="loading-text">Loading captions...</div>
    </div>
  `;
  statusDot.className = 'status-dot loading';
  statusText.textContent = 'Loading...';
}

// Show error state
function showError(message) {
  captionContainer.innerHTML = `
    <div class="error-container">
      <div class="error-icon">😕</div>
      <div class="error-message">${message}</div>
      <button class="retry-btn" id="retry-btn">Try Again</button>
    </div>
  `;
  statusDot.className = 'status-dot error';
  statusText.textContent = 'Error';

  document.getElementById('retry-btn')?.addEventListener('click', () => {
    loadTranscript();
  });
}

// Show empty state (no video)
function showEmpty(message = 'Open a YouTube video with Chinese captions') {
  captionContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📺</div>
      <div>${message}</div>
    </div>
  `;
  statusDot.className = 'status-dot';
  statusText.textContent = 'Waiting for video';
}

// Render captions
function renderCaptions() {
  if (transcript.length === 0) {
    showEmpty('No captions found');
    return;
  }

  captionContainer.innerHTML = transcript.map((item, index) => `
    <div class="caption-item" data-index="${index}" data-start="${item.start}">
      <div class="caption-time">${formatTime(item.start)}</div>
      <div class="caption-text">${escapeHtml(item.text)}</div>
    </div>
  `).join('');

  // Add click handlers
  captionContainer.querySelectorAll('.caption-item').forEach(item => {
    item.addEventListener('click', () => {
      const time = parseFloat(item.dataset.start);
      seekToTime(time);
    });
  });

  statusDot.className = 'status-dot';
  statusText.textContent = `${transcript.length} captions loaded`;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Seek video to specific time
function seekToTime(time) {
  chrome.runtime.sendMessage({
    action: 'seekYoutubeVideoFromPanel',
    time: time
  });
}

// Find the caption index for current time
function findCurrentCaptionIndex(currentTime) {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (currentTime >= transcript[i].start) {
      return i;
    }
  }
  return -1;
}

// Update active caption highlight
function updateActiveCaption(currentTime) {
  const newIndex = findCurrentCaptionIndex(currentTime);

  if (newIndex === currentActiveIndex) return;

  // Remove previous active
  if (currentActiveIndex >= 0) {
    const prevItem = captionContainer.querySelector(`[data-index="${currentActiveIndex}"]`);
    if (prevItem) {
      prevItem.classList.remove('active');
    }
  }

  // Add new active
  if (newIndex >= 0) {
    const newItem = captionContainer.querySelector(`[data-index="${newIndex}"]`);
    if (newItem) {
      newItem.classList.add('active');

      // Auto-scroll to keep active item visible
      if (autoScrollEnabled) {
        newItem.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }

  currentActiveIndex = newIndex;
  currentTimeDisplay.textContent = formatTime(currentTime);
}

// Load transcript for current video
async function loadTranscript() {
  showLoading();

  const videoId = await getCurrentVideoId();
  console.log('Panel: Got video ID:', videoId);

  if (!videoId) {
    showEmpty('Open a YouTube video to see captions');
    return;
  }

  currentVideoId = videoId;

  try {
    // Get the active tab to send message to content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('Could not find active tab');
      return;
    }

    console.log('Panel: Requesting transcript from content script for', videoId);

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'fetchTranscriptFromContent',
      videoId: videoId
    });

    console.log('Panel: Got response:', response);

    if (response && response.success) {
      transcript = response.transcript || [];
      console.log('Panel: Transcript length:', transcript.length);
      renderCaptions();
    } else {
      console.error('Panel: Error response:', response);
      showError(response?.error || 'Failed to load captions');
    }
  } catch (error) {
    console.error('Panel: Exception:', error);
    showError(error.message || 'Failed to load captions');
  }
}

// Listen for time updates from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'youtubeTimeUpdateForPanel') {
    // Only update if it's for the current video
    if (request.videoId === currentVideoId) {
      updateActiveCaption(request.currentTime);
    }
  }

  if (request.action === 'youtubeVideoChangedForPanel') {
    // Video changed, reload transcript
    if (request.videoId !== currentVideoId) {
      loadTranscript();
    }
  }
});

// Auto-scroll toggle
autoScrollToggle.addEventListener('change', (e) => {
  autoScrollEnabled = e.target.checked;
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadTranscript();
});

// Also reload when the panel becomes visible (in case video changed while panel was closed)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    getCurrentVideoId().then(videoId => {
      if (videoId && videoId !== currentVideoId) {
        loadTranscript();
      }
    });
  }
});
