// Background service worker to handle API calls
importScripts('config.js');

// --- 1️⃣ Local LLM (Gemini Nano) helper functions ---
async function downloadModel() {
  if (typeof LanguageModel === "undefined") {
    throw new Error("LanguageModel API not available in this browser");
  }

  try {
    const availability = await LanguageModel.availability();
    console.log("Model availability status:", availability);

    if (availability === "available") {
      console.log("Model already available");
      return true;
    }

    if (availability === "downloading") {
      console.log("Model is already downloading, waiting...");
      // Model is already downloading, we'll create a session to wait for it
    }

    if (availability === "downloadable" || availability === "downloading") {
      console.log("Starting model download...");

      // Create session with download progress monitoring
      const session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            const progress = Math.round(e.loaded * 100);
            console.log(`Model download progress: ${progress}%`);
          });
        }
      });

      console.log("Model download complete and session created");
      await session.destroy(); // Clean up the session
      return true;
    }

    // Status is "unavailable" or other
    throw new Error(`Model is unavailable. Status: ${availability}`);
  } catch (e) {
    console.error("Error downloading model:", e);
    throw e;
  }
}

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

// Reuse a single session for better performance
let modelSession = null;

async function getOrCreateSession() {
  if (!modelSession) {
    if (!await ensureModelAvailable()) {
      throw new Error("Local LLM not available. Try updating Chrome.");
    }
    // Create session with optimized parameters for faster responses
    modelSession = await LanguageModel.create({
      temperature: 0.7, // Lower temperature for more focused/faster responses
      topK: 3 // Reduce topK for faster sampling
    });
  }
  return modelSession;
}

async function rephraseChinese(text, hint = "自然、礼貌的改写") {
  const session = await getOrCreateSession();

  // Simplified, more direct prompt for faster processing
  const prompt = `请提供更自然、地道的改写。如果文本已经很自然、地道，不需要改动，请返回空字符串。只返回改写后的文本，不要其他内容。

文本：${text}`;

  console.log("Prompt being sent to Gemini Nano:", prompt);

  const response = await session.prompt(prompt);
  console.log("Raw response from model:", response);
  console.log("Response type:", typeof response);
  console.log("Response keys:", Object.keys(response || {}));

  return response || "（无输出）";
}

// --- 2️⃣ Download model and create session on startup ---
downloadModel()
  .then(async () => {
    console.log("Creating model session...");
    modelSession = await LanguageModel.create();
    console.log("Model session ready");
  })
  .catch(err => {
    console.error("Failed to initialize model on startup:", err);
  });

// --- 3️⃣ Chrome message listener ---
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
