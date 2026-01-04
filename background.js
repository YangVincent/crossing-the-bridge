// Background service worker to handle API calls

// Default settings
const DEFAULT_SETTINGS = {
  selectedModel: 'local',
  anthropicApiKey: ''
};

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
  /*const prompt = `请提供更自然、地道的改写。如果文本已经很自然、地道，不需要改动，请返回空字符串。只返回改写后的文本，不要其他内容。

文本：${text}`;*/
  
  const prompt = `你是一位汉语老师，正在建议使用惯用语。
  首先，判断文本是否足够长，需要改写。如果不是，则返回
  一个空字符串。然后，判断文本是否自然、地道。
  如果是，则返回一个空字符串。最后，只有当句子完全错误，或者句子包含英语时，
  才将整个句子翻译成惯用的汉语。
  只返回一个答案。
  除了改写的文本外，不要返回任何其他内容。
  不要包含解释或你的想法。
  消息如下： ${text}`;

  console.log("Prompt being sent to Gemini Nano:", prompt);

  const response = await session.prompt(prompt);
  console.log("Raw response from model:", response);
  console.log("Response type:", typeof response);
  console.log("Response keys:", Object.keys(response || {}));

  const suggestion = response || "（无输出）";
  
  // If we got a suggestion, rate the usefulness
  let semanticDifference = 0;
  if (suggestion && suggestion !== "（无输出）" && suggestion.trim() !== "") {
    const ratingPrompt = `你是一位汉语老师，正在帮助学习中文的学生。评估以下建议的有用性。

一个有用的建议应该：
1. 保留原句的意思
2. 在措辞上提供有意义的改进
3. 与原句有明显不同

用0到1之间的数字评分，其中：
1 表示非常有用（意思相同，措辞明显更好）
0 表示没有用（意思不同、改进不明显）

重要：如果建议与原句相似或完全一样，必须评分为 0（没有用）。

只返回一个数字（例如：0.7），不要解释。

原句：${text}
建议：${suggestion}`;

    console.log("Usefulness rating prompt:", ratingPrompt);
    
    const ratingResponse = await session.prompt(ratingPrompt);
    console.log("Raw rating response:", ratingResponse);
    
    // Extract the number from the response
    const match = ratingResponse.match(/([0-9]*\.?[0-9]+)/);
    if (match) {
      semanticDifference = parseFloat(match[1]);
      // Clamp to 0-1 range
      semanticDifference = Math.max(0, Math.min(1, semanticDifference));
    }
    
    console.log("Usefulness score:", semanticDifference);
  }

  return { text: suggestion, semanticDifference };
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
      .then(result => sendResponse({
        success: true,
        text: result.text,
        semanticDifference: result.semanticDifference
      }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; //
  }

  // c) Local summarization (Gemini Nano)
  if (request.action === "summarizeWithLocalLLM") {
    console.log('Received summarizeWithLocalLLM request');
    console.log('Text length:', request.chineseText?.length);

    getOrCreateSession()
      .then(session => {
        console.log('Session created, prompting...');
        return session.prompt(request.chineseText);
      })
      .then(result => {
        console.log('Got result from LLM:', result?.substring(0, 100));
        sendResponse({
          success: true,
          text: result
        });
      })
      .catch(err => {
        console.error('Error in summarization:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // d) Cloud summarization (Anthropic Claude)
  if (request.action === 'summarizeWithCloudLLM') {
    chrome.storage.sync.get(['anthropicApiKey'], async (result) => {
      const apiKey = result.anthropicApiKey;

      if (!apiKey) {
        sendResponse({ success: false, error: 'API key not configured. Please set it in the extension settings.' });
        return;
      }

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2048,
            messages: [{
              role: 'user',
              content: request.chineseText
            }]
          })
        });

        const data = await response.json();

        if (data.error) {
          sendResponse({ success: false, error: data.error.message || JSON.stringify(data.error) });
          return;
        }

        if (!data.content || !data.content[0] || !data.content[0].text) {
          sendResponse({ success: false, error: 'Unexpected response format' });
          return;
        }

        sendResponse({
          success: true,
          text: data.content[0].text
        });

      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true;
  }

  // b) Cloud rephrasing (Anthropic Claude)
  if (request.action === 'getIdiomaticPhrasing') {
    // Get API key from storage
    chrome.storage.sync.get(['anthropicApiKey'], async (result) => {
      const apiKey = result.anthropicApiKey;

      if (!apiKey) {
        sendResponse({ success: false, error: 'API key not configured. Please set it in the extension settings.' });
        return;
      }

      try {
        // First API call: Get the suggestion
        const suggestionResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
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
        });

        const suggestionData = await suggestionResponse.json();

        if (suggestionData.error) {
          sendResponse({ success: false, error: suggestionData.error.message || JSON.stringify(suggestionData.error) });
          return;
        }

        if (!suggestionData.content || !suggestionData.content[0] || !suggestionData.content[0].text) {
          sendResponse({ success: false, error: 'Unexpected response format' });
          return;
        }

        const suggestion = suggestionData.content[0].text;

        // Second API call: Rate the usefulness
        const ratingResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 50,
            messages: [{
              role: 'user',
              content: `你是一位汉语老师，正在帮助学习中文的学生。评估以下建议的有用性。

一个有用的建议应该：
1. 保留原句的意思
2. 在措辞上提供有意义的改进
3. 与原句有明显不同

用0到1之间的数字评分，其中：
1 表示非常有用（意思相同，措辞明显更好）
0 表示没有用（意思不同、改进不明显）

重要：如果建议与原句相似或完全一样，必须评分为 0（没有用）。

只返回一个数字（例如：0.7），不要解释。

原句：${request.chineseText}
建议：${suggestion}`
            }]
          })
        });

        const ratingData = await ratingResponse.json();

        let semanticDifference = 0.8; // Default fallback

        if (ratingData.content && ratingData.content[0] && ratingData.content[0].text) {
          const ratingText = ratingData.content[0].text;
          const match = ratingText.match(/([0-9]*\.?[0-9]+)/);
          if (match) {
            semanticDifference = parseFloat(match[1]);
            // Clamp to 0-1 range
            semanticDifference = Math.max(0, Math.min(1, semanticDifference));
          }
        }

        console.log('Claude usefulness score:', semanticDifference);

        sendResponse({
          success: true,
          text: suggestion,
          semanticDifference: semanticDifference
        });

      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });

    return true; // Keep the message channel open for async response
  }
});
