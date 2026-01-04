// YouTube Main World Script - Runs in page context to access YouTube's DOM

// Listen for transcript requests from the content script
window.addEventListener('ytTranscriptRequest', async (event) => {
  const requestId = event.detail.requestId;
  console.log('MainWorld: Received transcript request', requestId);

  try {
    const segments = await getTranscriptFromPanel();

    if (!segments || segments.length === 0) {
      throw new Error('Could not load transcript');
    }

    console.log('MainWorld: Got segments:', segments.length);

    window.dispatchEvent(new CustomEvent('ytTranscriptResponse', {
      detail: {
        requestId,
        success: true,
        transcript: segments,
        language: 'zh',
        languageName: 'Chinese'
      }
    }));

  } catch (e) {
    console.error('MainWorld: Error:', e);
    window.dispatchEvent(new CustomEvent('ytTranscriptResponse', {
      detail: {
        requestId,
        success: false,
        error: e.message
      }
    }));
  }
});

// Get transcript by opening YouTube's native transcript panel and scraping from DOM
async function getTranscriptFromPanel() {
  console.log('MainWorld: Getting transcript from panel...');

  // Check if transcript panel already has content
  let panel = document.querySelector('ytd-transcript-segment-list-renderer');
  let segments = panel?.querySelectorAll('ytd-transcript-segment-renderer');

  if (segments && segments.length > 0) {
    console.log('MainWorld: Panel already has segments:', segments.length);
    return parseSegments(segments);
  }

  // Need to open the transcript panel
  console.log('MainWorld: Opening transcript panel...');

  // First, expand the description if collapsed
  const expandButton = document.querySelector('#expand') ||
                       document.querySelector('tp-yt-paper-button#expand') ||
                       document.querySelector('[id="description-inline-expander"] #expand');
  if (expandButton) {
    console.log('MainWorld: Expanding description...');
    expandButton.click();
    await sleep(500);
  }

  // Look for "Show transcript" button in the description
  const transcriptSection = document.querySelector('ytd-video-description-transcript-section-renderer');
  if (transcriptSection) {
    const transcriptBtn = transcriptSection.querySelector('button') ||
                          transcriptSection.querySelector('[role="button"]');
    if (transcriptBtn) {
      console.log('MainWorld: Clicking transcript button...');
      transcriptBtn.click();
      await sleep(2000);
    }
  }

  // Check if panel loaded
  panel = document.querySelector('ytd-transcript-segment-list-renderer');
  segments = panel?.querySelectorAll('ytd-transcript-segment-renderer');

  if (segments && segments.length > 0) {
    console.log('MainWorld: Panel loaded with segments:', segments.length);
    return parseSegments(segments);
  }

  // Try the "more actions" menu as fallback
  console.log('MainWorld: Trying more actions menu...');
  const moreButtons = document.querySelectorAll('ytd-menu-renderer button, #top-level-buttons-computed button');

  for (const btn of moreButtons) {
    const label = btn.getAttribute('aria-label') || '';
    if (label.toLowerCase().includes('more') || label.includes('更多')) {
      console.log('MainWorld: Found more button, clicking...');
      btn.click();
      await sleep(800);

      // Look for transcript option
      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item');
      for (const item of menuItems) {
        const text = item.textContent?.toLowerCase() || '';
        if (text.includes('transcript') || text.includes('显示文字记录') ||
            text.includes('字幕') || text.includes('文字記錄') || text.includes('逐字稿')) {
          console.log('MainWorld: Found transcript menu item, clicking...');
          item.click();
          await sleep(2000);
          break;
        }
      }

      // Close menu
      document.body.click();
      break;
    }
  }

  // Wait for panel to load with polling
  for (let attempt = 0; attempt < 10; attempt++) {
    panel = document.querySelector('ytd-transcript-segment-list-renderer');
    segments = panel?.querySelectorAll('ytd-transcript-segment-renderer');

    if (segments && segments.length > 0) {
      console.log('MainWorld: Panel loaded after', attempt + 1, 'attempts');
      return parseSegments(segments);
    }

    await sleep(500);
  }

  console.log('MainWorld: Could not load transcript panel');
  return null;
}

// Parse segment elements into transcript data
function parseSegments(segmentElements) {
  const segments = [];

  for (const el of segmentElements) {
    const timeEl = el.querySelector('.segment-timestamp') ||
                   el.querySelector('[class*="timestamp"]');
    const textEl = el.querySelector('.segment-text') ||
                   el.querySelector('yt-formatted-string');

    if (timeEl && textEl) {
      const timeStr = timeEl.textContent.trim();
      const text = textEl.textContent.trim();

      // Parse time (format: "0:00" or "1:23:45")
      const start = parseTime(timeStr);

      if (text && !isNaN(start)) {
        segments.push({
          text,
          start,
          duration: 0,
          end: start
        });
      }
    }
  }

  return segments;
}

// Parse time string to seconds
function parseTime(timeStr) {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

// Helper sleep function
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log('MainWorld: YouTube transcript helper loaded');
