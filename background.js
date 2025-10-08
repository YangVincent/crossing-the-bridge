// Background service worker to handle API calls
importScripts('config.js');

// --- 1️⃣ Local LLM (Gemini Nano) helper functions ---
async function ensureModelAvailable() {
  if (typeof LanguageModel === "undefined") {
    console.warn("LanguageModel API not available in this browser");
    return false;
  }
  try {
    const status = await LanguageModel.availability();
    return status === "available";
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function rephraseChinese(text, hint = "自然、礼貌的改写") {
  if (!await ensureModelAvailable()) {
    throw new Error("Local LLM not available. Try updating Chrome.");
  }

  const session = await LanguageModel.create();
  const prompt = `请你自然地改写以下中文，使其更通顺和地道，不改变原意。
文本: ${text}`;

  const response = await session.prompt({ prompt });
  return response.output_text || response.output || "（无输出）";
}

// --- 2️⃣ Chrome message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // a) Local rephrasing (Gemini Nano)
  if (request.action === "getIdiomaticPhrasingLocal") {
    rephraseChinese(request.chineseText)
      .then(result => sendResponse({ success: true, text: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; //
  }

  // b) Cloud rephrasing (Anthropic Claude)    
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
