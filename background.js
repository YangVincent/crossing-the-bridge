// Background service worker to handle API calls
importScripts('config.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getIdiomaticPhrasing') {
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Please provide a more idiomatic and natural phrasing for this text: "${request.chineseText}". The text may contain both Chinese and English. If there are English words mixed in, translate them to Chinese if appropriate. Only respond with the improved text, nothing else.`
        }]
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.content && data.content[0] && data.content[0].text) {
        sendResponse({ success: true, text: data.content[0].text });
      } else if (data.error) {
        sendResponse({ success: false, error: data.error.message || JSON.stringify(data.error) });
      } else {
        sendResponse({ success: false, error: 'Unexpected response format' });
      }
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep the message channel open for async response
  }
});
