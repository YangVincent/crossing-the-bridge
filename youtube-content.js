// YouTube Content Script - Handles video detection, time sync, and transcript fetching

let currentVideoId = null;
let videoElement = null;
let timeUpdateThrottle = null;

// Extract video ID from YouTube URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Check if we're on a video watch page
function isWatchPage() {
  return window.location.pathname === '/watch' && getVideoId();
}

// Find the video element
function findVideoElement() {
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

// Send time update to background/panel (throttled)
function sendTimeUpdate(time) {
  if (timeUpdateThrottle) return;

  timeUpdateThrottle = setTimeout(() => {
    timeUpdateThrottle = null;
  }, 250); // Throttle to 4 updates per second

  chrome.runtime.sendMessage({
    action: 'youtubeTimeUpdate',
    videoId: currentVideoId,
    currentTime: time
  }).catch(() => {
    // Panel might not be open, ignore errors
  });
}

// Handle video timeupdate event
function onTimeUpdate() {
  if (videoElement && currentVideoId) {
    sendTimeUpdate(videoElement.currentTime);
  }
}

// Set up video monitoring
function setupVideoMonitoring() {
  if (!isWatchPage()) {
    cleanup();
    return;
  }

  const newVideoId = getVideoId();

  // Check if video changed
  if (newVideoId !== currentVideoId) {
    cleanup();
    currentVideoId = newVideoId;

    // Notify background that video changed
    chrome.runtime.sendMessage({
      action: 'youtubeVideoChanged',
      videoId: currentVideoId
    }).catch(() => {});
  }

  // Find and attach to video element
  videoElement = findVideoElement();

  if (videoElement) {
    videoElement.removeEventListener('timeupdate', onTimeUpdate);
    videoElement.addEventListener('timeupdate', onTimeUpdate);

    // Send initial time
    sendTimeUpdate(videoElement.currentTime);
  } else {
    // Video element not ready, try again
    setTimeout(setupVideoMonitoring, 500);
  }
}

// Clean up when leaving video page
function cleanup() {
  if (videoElement) {
    videoElement.removeEventListener('timeupdate', onTimeUpdate);
    videoElement = null;
  }
  currentVideoId = null;
}

// Fetch transcript via main world script
async function fetchTranscriptFromPage(videoId) {
  console.log('Content: Fetching transcript for', videoId);

  return new Promise((resolve, reject) => {
    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Listen for response from main world script
    const handler = (event) => {
      if (event.detail.requestId !== requestId) return;

      window.removeEventListener('ytTranscriptResponse', handler);
      console.log('Content: Got response from main world');

      if (event.detail.success) {
        resolve({
          transcript: event.detail.transcript,
          language: event.detail.language,
          languageName: event.detail.languageName
        });
      } else {
        reject(new Error(event.detail.error || 'Failed to fetch transcript'));
      }
    };

    window.addEventListener('ytTranscriptResponse', handler);

    // Send request to main world script
    window.dispatchEvent(new CustomEvent('ytTranscriptRequest', {
      detail: { requestId, videoId }
    }));

    // Timeout after 30 seconds (panel loading can take a while)
    setTimeout(() => {
      window.removeEventListener('ytTranscriptResponse', handler);
      reject(new Error('Transcript fetch timeout'));
    }, 30000);
  });
}

// Handle messages from background/panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'seekYoutubeVideo') {
    if (videoElement) {
      videoElement.currentTime = request.time;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Video element not found' });
    }
    return true;
  }

  if (request.action === 'getYoutubeVideoInfo') {
    sendResponse({
      videoId: currentVideoId,
      currentTime: videoElement?.currentTime || 0,
      duration: videoElement?.duration || 0,
      isWatchPage: isWatchPage()
    });
    return true;
  }

  if (request.action === 'fetchTranscriptFromContent') {
    const videoId = request.videoId || currentVideoId || getVideoId();
    if (!videoId) {
      sendResponse({ success: false, error: 'No video ID' });
      return true;
    }

    fetchTranscriptFromPage(videoId)
      .then(result => {
        sendResponse({ success: true, ...result });
      })
      .catch(err => {
        console.error('Content: Transcript fetch error:', err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep channel open for async
  }
});

// Listen for YouTube's SPA navigation
window.addEventListener('yt-navigate-finish', () => {
  setupVideoMonitoring();
});

// Also handle popstate for browser back/forward
window.addEventListener('popstate', () => {
  setTimeout(setupVideoMonitoring, 100);
});

// Initial setup
if (document.readyState === 'complete') {
  setupVideoMonitoring();
} else {
  window.addEventListener('load', setupVideoMonitoring);
}

// Re-check periodically in case video element loads late
setInterval(() => {
  if (isWatchPage() && !videoElement) {
    const video = findVideoElement();
    if (video) {
      setupVideoMonitoring();
    }
  }
}, 1000);
