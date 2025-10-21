# Chrome Summarizer API Integration

## Overview
We've integrated Chrome's built-in Summarizer API for generating page summaries at different HSK levels.

## API Documentation
- **Official Docs**: https://developer.chrome.com/docs/ai/summarizer-api
- **Requirements**: Chrome 128+ with AI features enabled

## Implementation Details

### Main Functions

#### `getSummary(text, hskLevel)`
Uses Chrome's Summarizer API with HSK-level adaptations:

```javascript
// Summary types based on HSK level
HSK 1-2: 'key-points'  // Most concise for beginners
HSK 3-4: 'tl;dr'       // Medium length
HSK 5-6: 'teaser'      // Longer for advanced learners

// Length settings
HSK 1-2: 'short'
HSK 3-4: 'medium'
HSK 5-6: 'long'

// Format
HSK 1-5: 'plain-text'
HSK 6:   'markdown'    // Advanced users can handle markdown
```

#### Features
1. **Auto-download**: Automatically downloads AI model if needed
2. **Progress tracking**: Shows download progress
3. **Fallback**: Falls back to Language Model API if Summarizer fails
4. **HSK-adapted**: Adjusts summary type and length based on HSK level
5. **Shared context**: Guides the model to use appropriate vocabulary

### API Options Used

```javascript
{
  type: 'key-points' | 'tl;dr' | 'teaser',
  format: 'plain-text' | 'markdown',
  length: 'short' | 'medium' | 'long',
  sharedContext: 'Use only HSK X vocabulary...'
}
```

### Capabilities Check

```javascript
const capabilities = await window.ai.summarizer.capabilities();
// Returns: { available: 'readily' | 'after-download' | 'no' }
```

### Download Progress

```javascript
summarizer.addEventListener('downloadprogress', (e) => {
  console.log(`${e.loaded}/${e.total}`);
});
```

## HSK Level Mapping

| HSK Level | Summary Type | Length | Format | Vocabulary Size |
|-----------|--------------|--------|--------|-----------------|
| 1 | key-points | short | plain-text | 150 words |
| 2 | key-points | short | plain-text | 300 words |
| 3 | tl;dr | medium | plain-text | 600 words |
| 4 | tl;dr | medium | plain-text | 1200 words |
| 5 | teaser | long | plain-text | 2500 words |
| 6 | teaser | long | markdown | 5000+ words |

## Fallback Mechanism

If Summarizer API fails, the system automatically falls back to:
1. **Language Model API** (`window.ai.languageModel`)
2. Uses system prompt to guide vocabulary level
3. Same HSK-level awareness

```javascript
async function getSummaryWithLanguageModel(text, hskLevel) {
  const session = await window.ai.languageModel.create({
    systemPrompt: `You are a Chinese language tutor...`
  });
  // ... generate summary
}
```

## Error Handling

### Common Errors
1. **API not available**: Chrome version too old
2. **Model download failed**: Network issues
3. **No Chinese text**: Empty page or no Chinese content

### User-friendly Messages
```javascript
'AI Summarizer not available. Please update Chrome to version 128+ 
and enable AI features in chrome://flags'
```

## Usage Example

```javascript
// User selects HSK 3
const text = extractChineseFromPage();
const summary = await getSummary(text, 3);
// Returns: Medium-length summary using HSK 3 vocabulary
```

## Benefits Over Previous Implementation

### Before (Custom LLM)
- ❌ Required background script communication
- ❌ Complex prompt engineering
- ❌ Response parsing needed
- ❌ Cloud/local model switching

### Now (Summarizer API)
- ✅ Native Chrome API
- ✅ Optimized for summarization
- ✅ Built-in download management
- ✅ Direct client-side processing
- ✅ Consistent results
- ✅ Better performance

## Testing

### Check API Availability
```javascript
if (window.ai && window.ai.summarizer) {
  const caps = await window.ai.summarizer.capabilities();
  console.log('Available:', caps.available);
}
```

### Test Summary Generation
```javascript
const text = "河北省赵县的洨河上，有一座世界闻名的石拱桥...";
const summary = await getSummary(text, 3);
console.log(summary);
```

## Chrome Flags Required

Enable these flags in `chrome://flags`:
1. **Prompt API for Gemini Nano** - Enabled
2. **Summarization API for Gemini Nano** - Enabled
3. **Optimization Guide On Device Model** - Enabled BypassPerfRequirement

## Browser Requirements

- **Minimum**: Chrome 128+
- **Recommended**: Chrome 131+ (latest stable)
- **Platform**: Desktop (Windows, macOS, Linux, ChromeOS)
- **Note**: Not available in Incognito mode

## Performance Characteristics

- **First use**: ~500MB model download (one-time)
- **Subsequent uses**: Fast (local processing)
- **Max input**: ~4000 characters
- **Processing time**: 1-3 seconds

## Future Enhancements

1. **Streaming**: Use `summarizeStreaming()` for real-time results
2. **Custom prompts**: Fine-tune for specific Chinese learning contexts
3. **Multi-page**: Summarize multiple pages together
4. **Export**: Save summaries with HSK level metadata
5. **Vocabulary analysis**: Highlight HSK-level words in summary
