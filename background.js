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
let translatorSession = null;

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

// --- Translation API helper functions ---
async function ensureTranslatorAvailable() {
  if (typeof translation === "undefined" || !translation.canTranslate) {
    console.warn("Translation API not available in this browser");
    return false;
  }
  try {
    const availability = await translation.canTranslate({
      sourceLanguage: 'en',
      targetLanguage: 'zh'
    });
    console.log("Translator availability:", availability);
    return availability === "readily" || availability === "after-download";
  } catch (e) {
    console.error("Error checking translator availability:", e);
    return false;
  }
}

async function getOrCreateTranslator() {
  if (!translatorSession) {
    const canTranslate = await ensureTranslatorAvailable();
    if (!canTranslate) {
      throw new Error("Translation API not available. Try updating Chrome.");
    }
    
    console.log("Creating translator session...");
    translatorSession = await translation.createTranslator({
      sourceLanguage: 'en',
      targetLanguage: 'zh'
    });
    console.log("Translator session ready");
  }
  return translatorSession;
}

// --- Proofreader API helper functions ---
// Note: Chrome Proofreader API is experimental/not yet available
// Using LLM-based error detection as fallback

// Detect errors in Chinese text using LLM with few-shot learning
async function detectErrors(text) {
  try {
    const session = await getOrCreateSession();
    
    // Use few-shot learning with specific examples to guide the LLM
    const errorDetectionPrompt = `你是专业的中文校对专家。请仔细检查文本中的所有错误。

## 错误类型：
1. 字词错误：只标记明显的错别字和用词完全错误的情况（如"世界文明"应为"世界闻名"）
2. 标点误用：英文标点应改为中文标点（如","改为"，"、"."改为"。"）
3. 语法问题：真正的语法错误、搭配不当
4. 语序问题：词序不当

## 严格禁止的行为：
❌ 绝对不要将"闻名"改为"著名"或将"著名"改为"闻名"
❌ 绝对不要将"到现在"改为"至今"或将"至今"改为"到现在"
❌ 不要替换任何意思相近的正确用词
❌ 不要过度纠正风格问题
❌ 只标记明显的错误

## 必须遵守的规则：
✅ 如果一个句子有多个错误，必须全部列出
✅ 不要遗漏任何明显的错误
✅ "因为...所以..."是正确用法
✅ "之所以...是因为..."是正确用法
✅ "世界闻名"是完全正确的表达，比"世界著名"更好
✅ 只有真正用错的词才标记（如"涉及"误用为"设计"的场合）
❌ 只标记明显的错误

## 学习示例：

【示例1 - 正确用法：世界闻名不要改】
输入："河北省赵县的洨河上，有一座世界闻名的石拱桥。"
输出：[]

【示例2 - 正确用法：世界著名不要改】
输入："河北省赵县的洨河上，有一座世界著名的石拱桥。"
输出：[]

【示例3 - 错误用法：文明改为闻名】
输入："河北省赵县的洨河上，有一座世界文明的石拱桥。"
输出：[{"text":"文明","type":"字词错误","suggestion":"闻名","explanation":"此处应为世界闻名，文明是错误用词"}]

【示例4 - 字词错误：涉及vs设计】
输入："这个桥梁的涉及很独特。"
输出：[{"text":"涉及","type":"字词错误","suggestion":"设计","explanation":"涉及指关联到、牵涉到。设计指根据要求预先制定图样、方案。此处应为设计"}]

【示例5 - 正确用法：到现在】
输入："到现在已经有一千多年了。"
输出：[]

【示例6 - 正确用法：至今】
输入："至今已经有一千多年了。"
输出：[]

【示例7 - 单个标点错误】
输入："这是一个很好的想法,我们应该试试。"
输出：[{"text":",","type":"标点误用","suggestion":"，","explanation":"应使用中文逗号"}]

【示例8 - 多个标点错误】
输入："你好,我叫小明.你叫什么名字?"
输出：[{"text":",","type":"标点误用","suggestion":"，","explanation":"应使用中文逗号"},{"text":".","type":"标点误用","suggestion":"。","explanation":"应使用中文句号"},{"text":"?","type":"标点误用","suggestion":"？","explanation":"应使用中文问号"}]

【示例9 - 多个错误同时存在】
输入："河北省赵县的洨河上,有一座世界文明的石拱桥。"
输出：[{"text":"文明","type":"字词错误","suggestion":"闻名","explanation":"此处应为世界闻名，文明是错误用词"},{"text":",","type":"标点误用","suggestion":"，","explanation":"应使用中文逗号"}]

【示例10 - 正确用法】
输入："因为下雨，所以我没去。"
输出：[]

## 现在检查以下文本的所有错误：
文本：${text}

要求：
1. 找出所有字词错误（只标记真正用错的词，不要替换意思相近的正确词）
2. 找出所有标点错误
3. 找出所有语法错误
4. 找出所有语序错误
5. 如果有多个错误，必须全部返回

请只返回纯JSON数组，不要任何额外说明：`;

    console.log("🔍 Detecting errors with LLM...");
    
    const response = await session.prompt(errorDetectionPrompt);
    console.log("📝 Raw error detection response:", response);
    
    // Parse the JSON response
    try {
      // Clean up the response - remove markdown code blocks if present
      let cleanResponse = response.trim();
      
      // Remove markdown code blocks
      if (cleanResponse.includes('```')) {
        cleanResponse = cleanResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      }
      
      // Find JSON array in the response
      const jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }
      
      const errors = JSON.parse(cleanResponse);
      console.log("✅ Parsed errors:", errors);
      
      return Array.isArray(errors) ? errors : [];
    } catch (parseError) {
      console.warn("⚠️ Could not parse error detection response:", parseError);
      console.warn("Raw response was:", response);
      // Return empty array instead of failing
      return [];
    }
  } catch (error) {
    console.error("❌ Error detecting errors:", error);
    return []; // Return empty array if detection fails
  }
}

// Detect and translate English words/phrases in Chinese text
async function translateEnglishInText(text) {
  // Check if text contains English
  const englishRegex = /[a-zA-Z]+/g;
  const englishMatches = text.match(englishRegex);
  
  if (!englishMatches || englishMatches.length === 0) {
    return text; // No English to translate
  }

  try {
    const translator = await getOrCreateTranslator();
    let translatedText = text;
    
    // Translate each English word/phrase
    for (const englishWord of englishMatches) {
      const translation = await translator.translate(englishWord);
      // Replace first occurrence of the English word with its translation
      translatedText = translatedText.replace(englishWord, translation);
    }
    
    console.log("Translated English in text:", text, "->", translatedText);
    return translatedText;
  } catch (error) {
    console.error("Error translating English in text:", error);
    return text; // Return original if translation fails
  }
}

async function rephraseChinese(text, hint = "自然、礼貌的改写") {
  console.log("🚀 Starting rephraseChinese for:", text);
  
  // First, detect errors using LLM-based error detection
  let errors = [];
  try {
    console.log("🔍 Step 1: Detecting errors...");
    errors = await detectErrors(text);
    console.log("✅ Detected errors:", errors);
  } catch (error) {
    console.warn("⚠️ Could not detect errors, continuing:", error);
  }

  // Second, translate any English words to Chinese using the Translator API
  let processedText = text;
  try {
    console.log("🌐 Step 2: Translating English words...");
    processedText = await translateEnglishInText(text);
    console.log("✅ Text after English translation:", processedText);
  } catch (error) {
    console.warn("⚠️ Could not translate English words, continuing with original text:", error);
  }

  console.log("📝 Step 3: Getting LLM suggestion...");
  const session = await getOrCreateSession();
  
  // If we found errors, incorporate them into the prompt
  let prompt = '';
  if (errors.length > 0) {
    const errorContext = errors.map(e => `"${e.text}"应改为"${e.suggestion}"`).join('，');
    prompt = `你是一位汉语老师，正在建议使用惯用语。

已检测到以下错误：${errorContext}

请提供改进后的完整句子。只返回改进后的文本，不要其他内容。

原文：${processedText}`;
  } else {
    prompt = `你是一位汉语老师，正在建议使用惯用语。
  首先，判断文本是否足够长，需要改写。如果不是，则返回
  一个空字符串。然后，判断文本是否自然、地道。
  如果是，则返回一个空字符串。最后，只有当句子不够地道时，
  才将整个句子翻译成惯用的汉语。
  只返回一个答案。
  除了改写的文本外，不要返回任何其他内容。
  不要包含解释或你的想法。
  消息如下： ${processedText}`;
  }

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

原句：${processedText}
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

  return { text: suggestion, semanticDifference, errors };
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
    console.log("📨 Received getIdiomaticPhrasingLocal request");
    
    rephraseChinese(request.chineseText)
      .then(result => {
        console.log("✅ Sending success response:", result);
        sendResponse({
          success: true,
          text: result.text,
          semanticDifference: result.semanticDifference,
          errors: result.errors || []
        });
      })
      .catch(err => {
        console.error("❌ Error in rephraseChinese:", err);
        sendResponse({ 
          success: false, 
          error: err.message,
          errors: []
        });
      });
    return true; // Keep channel open for async response
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
