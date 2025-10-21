let currentText = '';
let debounceTimer = null;
let lastTarget = null;
let popup = null;
let overlayWrapper = null;
let currentIndicator = null;
let workingIndicator = null; // Indicator showing the extension is processing
let suggestionCache = new Map(); // Map to store suggestion -> original text pairs (for looking up what to replace)
let acceptedSuggestions = new Set(); // Set to store accepted suggestions that shouldn't be re-suggested
let sentenceCache = new Map(); // Cache for sentence -> {suggestion, usefulness} results
let activeProcessingId = null; // Track current processing session to cancel outdated requests
let extensionEnabled = true; // Track if extension is enabled for this page
let lastAcceptedSuggestion = null; // Store last accepted suggestion for undo
let currentSuggestionContext = null; // Store current suggestion context (target, original, suggestion, etc.)

// Persistent bottom-right icon management
let persistentIcon = null;
let persistentIconVisible = true; // default; persisted in storage
let persistentIconTarget = null; // Track which input the icon is attached to

// Create the persistent icon element for a specific target input
function createPersistentIcon(target) {
  if (persistentIcon) {
    // If icon exists, just reposition it for the new target
    persistentIconTarget = target;
    updatePersistentIconPosition();
    return persistentIcon;
  }

  persistentIcon = document.createElement('div');
  persistentIcon.className = 'bridge-persistent-icon';
  persistentIconTarget = target;

  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('assets/logo.png');
  img.alt = 'CTB';
  persistentIcon.appendChild(img);

  // Append to body
  document.body.appendChild(persistentIcon);

  // Position the icon
  updatePersistentIconPosition();

  // Update position on scroll/resize
  window.addEventListener('scroll', updatePersistentIconPosition, true);
  window.addEventListener('resize', updatePersistentIconPosition);

  return persistentIcon;
}

// Update persistent icon position relative to its target input
function updatePersistentIconPosition() {
  if (!persistentIcon || !persistentIconTarget) return;

  const rect = persistentIconTarget.getBoundingClientRect();
  const iconSize = 24; // Smaller icon size
  const offset = 6; // Internal padding from corner

  // Position at bottom-right corner INSIDE the input/dialog bounds
  persistentIcon.style.position = 'fixed';
  persistentIcon.style.left = `${rect.right - iconSize - offset}px`;
  persistentIcon.style.top = `${rect.bottom - iconSize - offset}px`;
  
  // Ensure icon stays within viewport bounds
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  const currentLeft = parseFloat(persistentIcon.style.left);
  const currentTop = parseFloat(persistentIcon.style.top);
  
  // Adjust if icon would overflow viewport
  if (currentLeft + iconSize > viewportWidth) {
    persistentIcon.style.left = `${viewportWidth - iconSize - offset}px`;
  }
  if (currentTop + iconSize > viewportHeight) {
    persistentIcon.style.top = `${viewportHeight - iconSize - offset}px`;
  }
  
  // Also ensure icon doesn't go beyond input left/top bounds
  if (currentLeft < rect.left) {
    persistentIcon.style.left = `${rect.left + offset}px`;
  }
  if (currentTop < rect.top) {
    persistentIcon.style.top = `${rect.top + offset}px`;
  }
}

// Initialize persistent icon visibility from storage (async)
async function initPersistentIconSettings() {
  try {
    const stored = await chrome.storage.sync.get(['bridge_icon_visible']);
    if (stored && typeof stored.bridge_icon_visible === 'boolean') {
      persistentIconVisible = stored.bridge_icon_visible;
    }
  } catch (err) {
    console.warn('Error reading icon visibility from storage', err);
  }
}

// Show spinner state on the persistent icon (processing)
function setPersistentIconProcessing(on = true) {
  if (!persistentIcon) return;

  // Clear children
  while (persistentIcon.firstChild) persistentIcon.removeChild(persistentIcon.firstChild);

  if (on) {
    const spinner = document.createElement('div');
    spinner.className = 'bridge-persistent-spinner';
    persistentIcon.appendChild(spinner);
  } else {
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('assets/logo.png');
    img.alt = 'CTB';
    persistentIcon.appendChild(img);
  }
}

// Load icon settings when the script runs
initPersistentIconSettings().catch(err => console.warn('initPersistentIconSettings error', err));

// Check if extension should be enabled on this page
async function checkIfEnabled() {
  try {
    const currentUrl = window.location.href;
    const settings = await chrome.storage.sync.get(['listMode', 'urlPatterns']);
    const listMode = settings.listMode || 'blocklist';
    const urlPatterns = settings.urlPatterns || [];

    // If no patterns, use default behavior
    if (urlPatterns.length === 0) {
      return listMode === 'blocklist'; // Enabled by default in blocklist mode
    }

    // Check if URL matches any pattern
    const matches = urlPatterns.some(pattern => {
      try {
        const regex = new RegExp(pattern);
        return regex.test(currentUrl);
      } catch (e) {
        console.error('Invalid regex pattern:', pattern, e);
        return false;
      }
    });

    // In blocklist mode: enabled if URL does NOT match
    // In allowlist mode: enabled if URL DOES match
    return listMode === 'blocklist' ? !matches : matches;
  } catch (error) {
    console.warn('Error checking if extension should be enabled:', error.message);
    return true; // Default to enabled if error occurs
  }
}

// Initialize extension
(async () => {
  extensionEnabled = await checkIfEnabled();
  console.log('Extension enabled:', extensionEnabled);

  if (!extensionEnabled) {
    console.log('Extension disabled for this page');
    return;
  }

  // Inject CSS only if enabled
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('overlay.css');
  document.head.appendChild(link);
})();

// Chunking functions

// Count words in a string (works for both Chinese and English)
function countWords(text) {
  // Remove leading/trailing whitespace
  text = text.trim();
  if (!text) return 0;
  
  // Count Chinese characters as individual words
  const chineseChars = text.match(/[\u4e00-\u9fff]/g);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  
  // Count English words (sequences of non-Chinese, non-whitespace characters)
  const englishWords = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/\S+/g);
  const englishCount = englishWords ? englishWords.length : 0;
  
  return chineseCount + englishCount;
}

// Split text into sentences by period (both Chinese 。 and English .)
function splitIntoSentences(text) {
  if (!text || text.trim().length === 0) return [];
  
  // Split by both English period and Chinese period while preserving punctuation
  // Regex capture group /([。\.])/ includes periods in the result
  // This creates an alternating array: [text, period, text, period, ...]
  // e.g., "Hello. 你好。" → ["Hello", ".", " 你好", "。", ""]
  // Then reduce processes only even indices (text parts), attaching the next period to each
  const sentences = text.split(/([。\.])/).reduce((acc, part, index, array) => {
    if (index % 2 === 0 && part.trim()) {
      // Process even indices (0, 2, 4...) which are the text parts
      const period = array[index + 1] || ''; // Get the following period (odd index)
      acc.push((part + period).trim()); // Combine text + period
    }
    return acc;
  }, []);
  
  return sentences.filter(s => s.length > 0);
}

// Filter and process text for LLM
// Returns an array of sentences that need processing
function filterAndChunkText(text) {
  // Check minimum word count
  const wordCount = countWords(text);
  if (wordCount < 4) {
    console.log(`Text too short (${wordCount} words), skipping`);
    return [];
  }
  
  // Split into sentences
  const sentences = splitIntoSentences(text);
  console.log('Split into sentences:', sentences);
  
  // Filter out sentences that are already in cache or accepted
  const sentencesToProcess = sentences.filter(sentence => {
    const trimmedSentence = sentence.trim();
    
    // Skip if already processed and cached
    if (sentenceCache.has(trimmedSentence)) {
      console.log('Sentence already cached:', trimmedSentence);
      return false;
    }
    
    // Skip if it's an accepted suggestion
    if (acceptedSuggestions.has(trimmedSentence)) {
      console.log('Sentence already accepted:', trimmedSentence);
      return false;
    }
    
    // Skip if not enough words
    if (countWords(trimmedSentence) < 4) {
      console.log('Sentence too short:', trimmedSentence);
      return false;
    }
    
    return true;
  });
  
  console.log('Sentences to process:', sentencesToProcess);
  return sentencesToProcess;
}

// Show working indicator - now only uses persistent icon
function showWorkingIndicator(target) {
  // Remove any existing old-style working indicator (if present)
  if (workingIndicator) {
    workingIndicator.remove();
    workingIndicator = null;
  }

  // Ensure persistent icon exists (create if needed)
  if (!persistentIcon) {
    createPersistentIcon(target);
  }

  // Set persistent icon to processing state (blue spinner)
  try { 
    setPersistentIconProcessing(true);
    // Show icon during processing even if user preference is hidden
    if (persistentIcon && persistentIconVisible) {
      persistentIcon.style.display = 'flex';
    }
  } catch (e) { 
    console.warn('Could not set persistent icon processing state', e);
  }
}

// Hide working indicator
function hideWorkingIndicator() {
  // Remove any old-style working indicator if it exists
  if (workingIndicator) {
    if (workingIndicator._cleanup) {
      workingIndicator._cleanup();
    }
    workingIndicator.remove();
    workingIndicator = null;
  }
  
  // Restore persistent icon to normal state (logo)
  try { 
    setPersistentIconProcessing(false); 
  } catch (e) { 
    console.warn('Could not restore persistent icon state', e);
  }
}

// Create popup element
function createPopup() {
  if (popup) return popup;

  popup = document.createElement('div');
  popup.className = 'bridge-popup';
  popup.innerHTML = `
    <div class="bridge-popup-arrow"></div>
    <div class="bridge-popup-suggestion"></div>
    <div class="bridge-popup-original"></div>
    <div class="bridge-popup-shortcuts">Tab: Accept • Esc: Reject • Shift+Tab: Undo</div>
  `;
  document.body.appendChild(popup);
  return popup;
}

// Function to accept a suggestion
function acceptSuggestion(target, originalText, suggestion, indicator) {
  console.log('Accepting suggestion:', suggestion);
  console.log('Target tag:', target.tagName);
  console.log('Is contentEditable:', target.isContentEditable);

  // Store the original text for undo
  lastAcceptedSuggestion = {
    target: target,
    originalText: originalText,
    suggestion: suggestion,
    indicator: indicator
  };

  // Simply replace all content with the suggestion
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    console.log('Setting value on input/textarea');
    const nativeInputValueSetter = target.tagName === 'TEXTAREA'
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeInputValueSetter.call(target, suggestion);
    target.setSelectionRange(suggestion.length, suggestion.length);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
  } else if (target.isContentEditable) {
    console.log('Setting content on contentEditable with execCommand');

    // Select all content and replace with suggestion
    target.focus();
    const selection = window.getSelection();
    const range = document.createRange();

    // Select all content
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);

    // Replace with suggestion
    const success = document.execCommand('insertText', false, suggestion);
    console.log('execCommand insertText returned:', success);

    // Verify what happened
    setTimeout(() => {
      const newContent = target.innerText || target.textContent;
      console.log('Content after replacement:', newContent);
    }, 10);
  }

  // Add to accepted suggestions cache
  acceptedSuggestions.add(suggestion);
  console.log('Added to accepted suggestions:', suggestion);

  // Clean up cache entry
  suggestionCache.delete(suggestion);
  console.log('Text replacement complete');

  // Hide popup and indicator
  console.log('Hiding popup and indicator');
  if (popup) {
    popup.classList.remove('visible');
  }
  if (indicator && indicator.parentNode) {
    indicator.remove();
  }
}

// Show popup with suggestion
function showPopup(target, originalText, suggestion, textWidth, textLeft, indicator, semanticDifference = 0) {
  const popup = createPopup();
  const suggestionEl = popup.querySelector('.bridge-popup-suggestion');
  const originalEl = popup.querySelector('.bridge-popup-original');

  suggestionEl.textContent = suggestion;

  // Include semantic difference in the original text display if available
  if (semanticDifference > 0) {
    originalEl.textContent = `Original: ${originalText} (Difference: ${(semanticDifference * 100).toFixed(0)}%)`;
  } else {
    originalEl.textContent = `Original: ${originalText}`;
  }

  // Store current suggestion context for Tab key
  currentSuggestionContext = {
    target: target,
    originalText: originalText,
    suggestion: suggestion,
    indicator: indicator,
    semanticDifference: semanticDifference
  };

  // Position popup above the target
  const rect = target.getBoundingClientRect();

  // Make popup visible first to get its dimensions
  popup.classList.add('visible');

  // Position after making visible - centered on the text
  setTimeout(() => {
    const popupHeight = popup.offsetHeight;
    const popupWidth = popup.offsetWidth;

    // Center the popup over the text
    const textCenterX = textLeft + (textWidth / 2);
    const left = textCenterX - (popupWidth / 2);
    const top = rect.top - popupHeight - 10;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.position = 'fixed';
  }, 0);

  // Store reference for updating position
  popup.dataset.originalText = originalText;
  popup.updatePosition = (newTextWidth, newTextLeft) => {
    const popupWidth = popup.offsetWidth;
    const popupHeight = popup.offsetHeight;
    const textCenterX = newTextLeft + (newTextWidth / 2);
    const left = textCenterX - (popupWidth / 2);
    const newRect = target.getBoundingClientRect();
    const top = newRect.top - popupHeight - 10;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  };

  // Left click: Accept the suggestion
  popup.addEventListener('click', (e) => {
    console.log('Popup clicked!');
    e.preventDefault();
    e.stopPropagation();

    acceptSuggestion(target, originalText, suggestion, indicator);
  });

  // Right click: Dismiss the popup
  popup.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Hide popup and indicator
    popup.classList.remove('visible');
    if (indicator && indicator.parentNode) {
      indicator.remove();
    }
  });

  // Hide popup when clicking outside
  const hidePopup = (e) => {
    if (!popup.contains(e.target)) {
      popup.classList.remove('visible');
      document.removeEventListener('click', hidePopup);
    }
  };
  setTimeout(() => document.addEventListener('click', hidePopup), 100);

  return popup;
}

// Create overlay wrapper for contentEditable elements
function createOverlayForContentEditable(target, originalText, suggestion, semanticDifference = 0) {
  // Remove any existing indicator
  if (currentIndicator) {
    currentIndicator.remove();
    currentIndicator = null;
  }

  console.log(`Creating overlay - Semantic difference: ${semanticDifference}`);

  // Calculate the width of the actual text
  const measureText = (text, element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const styles = window.getComputedStyle(element);
    context.font = `${styles.fontSize} ${styles.fontFamily}`;
    return context.measureText(text).width;
  };

  // Function to replace text in contentEditable
  const replaceText = (oldText, newText) => {
    const currentContent = getTextFromElement(target);

    if (!currentContent.includes(oldText)) {
      return false;
    }

    const oldTextIndex = currentContent.indexOf(oldText);
    const beforeReplacement = currentContent.substring(0, oldTextIndex);
    const afterReplacement = currentContent.substring(oldTextIndex + oldText.length);
    const newContent = beforeReplacement + newText + afterReplacement;

    // Calculate cursor position: everything before + new text length
    const cursorPosition = beforeReplacement.length + newText.length;

    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      target.value = newContent;
      // Set cursor to end of replaced text
      target.setSelectionRange(cursorPosition, cursorPosition);
      target.focus();
    } else if (target.isContentEditable) {
      // For contentEditable, replace the entire content and set cursor
      target.textContent = newContent;

      // Set cursor to end of replaced text
      const range = document.createRange();
      const sel = window.getSelection();

      // Walk through text nodes to find the right position
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let currentPos = 0;
      let targetNode = null;
      let offsetInNode = 0;

      let node;
      while (node = walker.nextNode()) {
        const nodeLength = node.nodeValue.length;
        if (currentPos + nodeLength >= cursorPosition) {
          targetNode = node;
          offsetInNode = cursorPosition - currentPos;
          break;
        }
        currentPos += nodeLength;
      }

      if (targetNode) {
        try {
          range.setStart(targetNode, Math.min(offsetInNode, targetNode.nodeValue.length));
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          target.focus();
        } catch (e) {
          // Fallback: set cursor at the end
          range.selectNodeContents(target);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          target.focus();
        }
      }
    }

    // Trigger input event so other listeners know the content changed
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  const textWidth = measureText(originalText, target);
  const rect = target.getBoundingClientRect();

  // Get padding to offset the text start position
  const styles = window.getComputedStyle(target);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;

  // Create a visual indicator (underline effect)
  const indicator = document.createElement('div');
  indicator.className = 'bridge-suggestion-underline';
  indicator.style.position = 'fixed'; // Use fixed instead of absolute for better positioning
  indicator.style.left = `${rect.left + paddingLeft}px`;
  indicator.style.top = `${rect.bottom - 5}px`;
  indicator.style.width = '0px'; // Start with 0 width for animation
  indicator.style.height = '3px'; // Thinner underline
  indicator.style.backgroundColor = '#1a73e8';
  indicator.style.cursor = 'pointer';
  indicator.style.zIndex = '999999';
  indicator.style.pointerEvents = 'auto';
  indicator.style.borderRadius = '2px'; // Round the edges
  indicator.style.transition = 'width 0.1s ease-out'; // Smooth animation
  indicator.dataset.suggestion = suggestion;
  indicator.dataset.original = originalText;
  indicator.title = 'Click to see suggestion'; // Add tooltip

  document.body.appendChild(indicator);
  currentIndicator = indicator;

  // Trigger animation by setting width after a tiny delay
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      indicator.style.width = `${textWidth}px`;
    });
  });

  // Show popup immediately when overlay is created
  const currentPopup = showPopup(target, originalText, suggestion, textWidth, rect.left + paddingLeft, indicator, semanticDifference);

  // Update indicator position and size on scroll/resize
  const updateIndicatorPosition = () => {
    if (!indicator.parentNode) return; // Indicator was removed
    const newRect = target.getBoundingClientRect();
    const newTextWidth = measureText(originalText, target);
    const newStyles = window.getComputedStyle(target);
    const newPaddingLeft = parseFloat(newStyles.paddingLeft) || 0;
    const newLeft = newRect.left + newPaddingLeft;

    indicator.style.left = `${newLeft}px`;
    indicator.style.top = `${newRect.bottom - 5}px`;
    indicator.style.width = `${newTextWidth}px`;

    // Update popup position as well
    if (currentPopup && currentPopup.updatePosition) {
      currentPopup.updatePosition(newTextWidth, newLeft);
    }
  };

  window.addEventListener('scroll', updateIndicatorPosition, true);
  window.addEventListener('resize', updateIndicatorPosition);

  // Monitor text changes to update or hide popup
  const cleanupListeners = () => {
    target.removeEventListener('input', checkTextChanges);
    target.removeEventListener('keyup', checkTextChanges);
    window.removeEventListener('scroll', updateIndicatorPosition, true);
    window.removeEventListener('resize', updateIndicatorPosition);
  };

  const checkTextChanges = () => {
    // Check if target still exists and is connected to the DOM
    if (!target.isConnected || !document.contains(target)) {
      if (currentPopup) {
        currentPopup.classList.remove('visible');
      }
      if (indicator && indicator.parentNode) {
        indicator.remove();
      }
      if (currentIndicator === indicator) {
        currentIndicator = null;
      }
      cleanupListeners();
      return;
    }

    const currentContent = getTextFromElement(target);

    // If content is empty (e.g., message sent, deleted, or cut), clean up and clear caches
    if (!currentContent || currentContent.trim() === '') {
      console.log('Text box is empty, clearing caches');

      // Clear all caches
      suggestionCache.clear();
      acceptedSuggestions.clear();
      sentenceCache.clear();
      lastAcceptedSuggestion = null; // Clear undo state
      currentSuggestionContext = null; // Clear current suggestion context
      console.log('Caches cleared');

      if (currentPopup) {
        currentPopup.classList.remove('visible');
      }
      if (indicator && indicator.parentNode) {
        indicator.remove();
      }
      if (currentIndicator === indicator) {
        currentIndicator = null;
      }
      cleanupListeners();
      return;
    }

    // If the original text is no longer in the content, hide everything
    if (!currentContent.includes(originalText)) {
      if (currentPopup) {
        currentPopup.classList.remove('visible');
      }
      if (indicator && indicator.parentNode) {
        indicator.remove();
      }
      if (currentIndicator === indicator) {
        currentIndicator = null;
      }
      cleanupListeners();
    }
  };

  target.addEventListener('input', checkTextChanges);

  // Also listen for keyup to catch select-all + delete scenarios
  target.addEventListener('keyup', checkTextChanges);

  // Listen for cut/paste events
  target.addEventListener('cut', () => setTimeout(checkTextChanges, 0));
  target.addEventListener('paste', () => setTimeout(checkTextChanges, 0));

  // Show popup when clicking the indicator or the input
  const showSuggestion = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentPopup && currentPopup.classList) {
      currentPopup.classList.add('visible');
    }
  };

  indicator.addEventListener('click', showSuggestion);
}

// Function to check if text contains Chinese characters
function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

// Function to get current text from various input types
function getTextFromElement(element) {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return element.value;
  } else if (element.isContentEditable) {
    return element.innerText || element.textContent;
  }
  return '';
}

// Function to remove accepted suggestions from text before sending to LLM
function removeAcceptedSuggestions(text) {
  let filteredText = text;

  // Remove each accepted suggestion from the text
  for (const acceptedSuggestion of acceptedSuggestions) {
    // Use a more careful replacement to avoid partial matches
    if (filteredText.includes(acceptedSuggestion)) {
      filteredText = filteredText.replace(acceptedSuggestion, '');
    }
  }

  // Trim whitespace
  filteredText = filteredText.trim();

  console.log('Original text:', text);
  console.log('After removing accepted suggestions:', filteredText);
  console.log('Accepted suggestions:', Array.from(acceptedSuggestions));

  return filteredText;
}

// Clean up cache entries that are substrings of completed sentences
function cleanupCacheForCompletedSentences(text) {
  const completedSentences = splitIntoSentences(text);
  let removedCount = 0;
  
  completedSentences.forEach(sentence => {
    // Remove cache entries where the key is a substring of this sentence
    for (const [cachedKey, cachedValue] of sentenceCache.entries()) {
      if (sentence.includes(cachedKey) && cachedKey !== sentence) {
        sentenceCache.delete(cachedKey);
        removedCount++;
        console.log('Removed substring cache entry:', cachedKey, 'from sentence:', sentence);
      }
    }
  });
  
  if (removedCount > 0) {
    console.log(`Cleaned up ${removedCount} substring cache entries`);
  }
}

// Function to process a single sentence and get idiomatic suggestion
async function processSentence(sentence, target, processingId) {
  return new Promise(async (resolve) => {
    // Check if already in cache
    if (sentenceCache.has(sentence)) {
      console.log('Using cached result for:', sentence);
      resolve(sentenceCache.get(sentence));
      return;
    }

    try {
      // Get the selected model from settings
      const settings = await chrome.storage.sync.get(['selectedModel']);
      const selectedModel = settings.selectedModel || 'local';

      // Choose the appropriate action based on selected model
      const action = selectedModel === 'cloud' ? 'getIdiomaticPhrasing' : 'getIdiomaticPhrasingLocal';

      console.log(`Using ${selectedModel} model for translation`);

      // Make API call for this sentence
      chrome.runtime.sendMessage(
        { action: action, chineseText: sentence },
        (response) => {
          // Check for extension context invalidation
          if (chrome.runtime.lastError) {
            console.warn('Extension context invalidated:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }

          // Check if this processing session has been cancelled
          if (processingId !== activeProcessingId) {
            console.log('Discarding outdated response for:', sentence);
            resolve(null);
            return;
          }

        if (response && response.success) {
          const result = {
            suggestion: response.text,
            usefulness: response.semanticDifference || 0, // Use the returned score from either model
            originalSentence: sentence
          };

          // Cache the result
          sentenceCache.set(sentence, result);
          console.log('Cached sentence result:', sentence, '->', result);

          resolve(result);
        } else {
          console.error('Error from API:', response?.error);
          resolve(null);
        }
      }
    );
    } catch (error) {
      // Handle extension context invalidation or other errors
      console.warn('Error in processSentence:', error.message);
      resolve(null);
    }
  });
}

// Function to call Claude API for idiomatic phrasing via background script
async function getIdiomaticPhrasing(chineseText, target) {
  // Generate a unique ID for this processing session
  const processingId = Date.now();
  activeProcessingId = processingId;
  console.log('Starting processing session:', processingId);

  // Filter out accepted suggestions
  const filteredText = removeAcceptedSuggestions(chineseText);

  // If nothing left after filtering, don't make API call
  if (!filteredText || !containsChinese(filteredText)) {
    console.log('No new Chinese text to suggest after filtering');
    return;
  }

  // Clean up cache for completed sentences
  cleanupCacheForCompletedSentences(chineseText);

  // Use chunking to filter and split text
  const sentencesToProcess = filterAndChunkText(filteredText);
  
  if (sentencesToProcess.length === 0) {
    console.log('No sentences to process after filtering');
    return;
  }

  // Show working indicator
  showWorkingIndicator(target);

  try {
    // Process each sentence with the processing ID
    const results = await Promise.all(
      sentencesToProcess.map(sentence => processSentence(sentence, target, processingId))
    );

    // Check if this session is still active
    if (processingId !== activeProcessingId) {
      console.log('Processing session cancelled:', processingId);
      hideWorkingIndicator();
      return;
    }

    // Hide working indicator when all processing is complete
    hideWorkingIndicator();

    // Combine all useful suggestions into one complete text
    const usefulResults = results.filter(result => result && result.usefulness > 0.5);
    
    if (usefulResults.length === 0) {
      console.log('No useful suggestions found');
      return;
    }

    console.log(`Found ${usefulResults.length} useful suggestions, combining...`);

    // Reconstruct the full text with improvements
    let combinedOriginal = filteredText;
    let combinedSuggestion = filteredText;
    let maxUsefulness = 0;

    // Replace each original sentence with its suggestion in the combined text
    usefulResults.forEach(result => {
      console.log('Processing useful result:', result);
      
      // Replace the original sentence with the suggestion
      combinedSuggestion = combinedSuggestion.replace(result.originalSentence, result.suggestion);
      
      // Track the highest usefulness score
      maxUsefulness = Math.max(maxUsefulness, result.usefulness);
      
      // Cache individual mappings
      suggestionCache.set(result.suggestion, result.originalSentence);
    });

    console.log('Combined original:', combinedOriginal);
    console.log('Combined suggestion:', combinedSuggestion);
    console.log('Max usefulness:', maxUsefulness);

    // Show one overlay for the entire combined suggestion
    if (combinedSuggestion !== combinedOriginal) {
      createOverlayForContentEditable(target, combinedOriginal, combinedSuggestion, maxUsefulness);
    } else {
      console.log('Combined suggestion identical to original, not showing');
    }

  } catch (error) {
    // Hide working indicator on error
    hideWorkingIndicator();
    console.error('Error processing sentences:', error);
  }
}

// Listen for keyboard events on input fields
document.addEventListener('keydown', (event) => {
  // Skip if extension is disabled
  if (!extensionEnabled) {
    return;
  }

  const target = event.target;
  const isTextInput =
    target.tagName === 'INPUT' &&
    ['text', 'email', 'password', 'search', 'tel', 'url', 'textarea', 'div'].includes(target.type) ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;

  // Handle Tab key to accept suggestion
  if (event.key === 'Tab' && !event.shiftKey && isTextInput && currentSuggestionContext && popup && popup.classList.contains('visible')) {
    event.preventDefault();
    console.log('Tab pressed - accepting suggestion');
    acceptSuggestion(
      currentSuggestionContext.target,
      currentSuggestionContext.originalText,
      currentSuggestionContext.suggestion,
      currentSuggestionContext.indicator
    );
    currentSuggestionContext = null;
    return;
  }

  // Handle Escape key to reject suggestion
  if (event.key === 'Escape' && currentSuggestionContext && popup && popup.classList.contains('visible')) {
    event.preventDefault();
    console.log('Escape pressed - rejecting suggestion');
    
    // Hide popup
    popup.classList.remove('visible');
    
    // Remove indicator
    if (currentSuggestionContext.indicator && currentSuggestionContext.indicator.parentNode) {
      currentSuggestionContext.indicator.remove();
    }
    
    // Clear context
    currentSuggestionContext = null;
    return;
  }

  // Handle Shift+Tab to undo last acceptance
  if (event.key === 'Tab' && event.shiftKey && isTextInput && lastAcceptedSuggestion) {
    event.preventDefault();
    console.log('Shift+Tab pressed - undoing last acceptance');

    const undo = lastAcceptedSuggestion;

    // Restore original text
    if (undo.target.tagName === 'INPUT' || undo.target.tagName === 'TEXTAREA') {
      const nativeInputValueSetter = undo.target.tagName === 'TEXTAREA'
        ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set
        : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(undo.target, undo.originalText);
      undo.target.setSelectionRange(undo.originalText.length, undo.originalText.length);
      undo.target.dispatchEvent(new Event('input', { bubbles: true }));
      undo.target.focus();
    } else if (undo.target.isContentEditable) {
      undo.target.focus();
      const selection = window.getSelection();
      const range = document.createRange();

      range.selectNodeContents(undo.target);
      selection.removeAllRanges();
      selection.addRange(range);

      document.execCommand('insertText', false, undo.originalText);
    }

    // Remove from accepted suggestions
    acceptedSuggestions.delete(undo.suggestion);

    // Re-show the popup with the suggestion
    const measureText = (text, element) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const styles = window.getComputedStyle(element);
      context.font = `${styles.fontSize} ${styles.fontFamily}`;
      return context.measureText(text).width;
    };

    const textWidth = measureText(undo.originalText, undo.target);
    const rect = undo.target.getBoundingClientRect();
    const styles = window.getComputedStyle(undo.target);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;

    // Recreate the overlay
    createOverlayForContentEditable(undo.target, undo.originalText, undo.suggestion, 0.8);

    // Clear the undo state
    lastAcceptedSuggestion = null;

    return;
  }

  // Check if the event target is a text input element
  if (isTextInput) {
    lastTarget = target;

    // Always create/update persistent icon for this input (for processing state tracking)
    // But only show it if user preference is to show it
    createPersistentIcon(target);
    if (persistentIcon) {
      persistentIcon.style.display = persistentIconVisible ? 'flex' : 'none';
    }

    // Clear previous debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Get current text from the input field
    setTimeout(() => {
      currentText = getTextFromElement(target);

      // Check if text contains Chinese
      if (containsChinese(currentText)) {
        // Set debounce timer for 1 second (increased from 0.5s to reduce lag)
        debounceTimer = setTimeout(() => {
          getIdiomaticPhrasing(currentText, target);
        }, 1000);
      }
    }, 0);
  }
});

// Listen for focus events to show persistent icon on input fields
document.addEventListener('focus', (event) => {
  if (!extensionEnabled) return;

  const target = event.target;
  const isTextInput =
    target.tagName === 'INPUT' &&
    ['text', 'email', 'password', 'search', 'tel', 'url', 'textarea', 'div'].includes(target.type) ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;

  if (isTextInput) {
    // Always create icon (for processing state tracking)
    // But only show it if user preference is to show it
    createPersistentIcon(target);
    if (persistentIcon) {
      persistentIcon.style.display = persistentIconVisible ? 'flex' : 'none';
    }
  }
}, true);

// Listen for messages from popup to disable extension for current page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle icon visibility updates from settings page
  if (request.action === 'updateIconVisibility') {
    persistentIconVisible = request.visible;
    if (persistentIcon) {
      persistentIcon.style.display = request.visible ? 'flex' : 'none';
    }
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'disableForCurrentPage') {
    const currentUrl = window.location.href;
    chrome.storage.sync.get(['urlPatterns', 'listMode'], (result) => {
      const urlPatterns = result.urlPatterns || [];
      const listMode = result.listMode || 'blocklist';

      // Generate a regex pattern for the current domain
      const url = new URL(currentUrl);
      const pattern = `.*${url.hostname.replace(/\./g, '\\.')}.*`;

      // Add to blocklist (if in blocklist mode) or remove from allowlist (if in allowlist mode)
      if (listMode === 'blocklist') {
        if (!urlPatterns.includes(pattern)) {
          urlPatterns.push(pattern);
        }
      } else {
        // In allowlist mode, remove this pattern if it exists
        const index = urlPatterns.findIndex(p => p === pattern);
        if (index !== -1) {
          urlPatterns.splice(index, 1);
        }
      }

      // Save updated patterns
      chrome.storage.sync.set({ urlPatterns }, () => {
        sendResponse({ success: true, pattern });
        // Disable extension immediately
        extensionEnabled = false;
        console.log('Extension disabled for', url.hostname);
      });
    });
    return true; // Keep message channel open
  }

  // Show summary panel
  if (request.action === 'showSummaryPanel') {
    showSummaryPanel();
    sendResponse({ success: true });
    return true;
  }
});

// ===== SUMMARY PANEL =====
let summaryPanel = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function createSummaryPanel() {
  if (summaryPanel) return summaryPanel;

  const panel = document.createElement('div');
  panel.className = 'bridge-summary-panel';
  panel.innerHTML = `
    <div class="bridge-panel-header" id="bridge-panel-header">
      <div class="bridge-panel-title">
        <img src="${chrome.runtime.getURL('assets/logo.png')}" class="bridge-panel-logo" alt="Logo">
        <span>Page Summary</span>
      </div>
      <div class="bridge-panel-controls">
        <button class="bridge-panel-btn" id="bridge-minimize-btn" title="Close">×</button>
      </div>
    </div>
    <div class="bridge-panel-content">
      <div class="bridge-panel-controls-section">
        <div class="bridge-hsk-selector">
          <label>HSK Level:</label>
          <select id="bridge-hsk-select">
            <option value="1">HSK 1</option>
            <option value="2">HSK 2</option>
            <option value="3">HSK 3</option>
            <option value="4">HSK 4</option>
            <option value="5" selected>HSK 5</option>
            <option value="6">HSK 6</option>
          </select>
        </div>
        <button class="bridge-summarize-btn" id="bridge-summarize-now-btn">Summarize This Page</button>
      </div>
      <div class="bridge-panel-status" id="bridge-panel-status"></div>
      <div class="bridge-panel-loading" id="bridge-panel-loading">
        <img src="${chrome.runtime.getURL('assets/logo.png')}" class="bridge-loading-spinner" alt="Loading">
        <div>Analyzing and summarizing...</div>
      </div>
      <div class="bridge-panel-result" id="bridge-panel-result">
        <div class="bridge-result-header">
          <span class="bridge-result-badge" id="bridge-result-badge">HSK 5</span>
          <button class="bridge-copy-btn" id="bridge-copy-result-btn">Copy</button>
        </div>
        <div class="bridge-result-text" id="bridge-result-text"></div>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  summaryPanel = panel;

  // Set up dragging - only on the title area, not the whole header
  const headerTitle = panel.querySelector('.bridge-panel-title');
  headerTitle.addEventListener('mousedown', startDrag);

  // Close button
  panel.querySelector('#bridge-minimize-btn').addEventListener('click', () => {
    panel.classList.remove('visible');
  });

  // Summarize button
  panel.querySelector('#bridge-summarize-now-btn').addEventListener('click', handleSummarize);

  // Copy button
  panel.querySelector('#bridge-copy-result-btn').addEventListener('click', handleCopy);

  return panel;
}

function startDrag(e) {
  // Don't start drag if clicking on interactive elements
  if (e.target.closest('.bridge-panel-btn') ||
      e.target.closest('select') ||
      e.target.closest('button') ||
      e.target.closest('.bridge-panel-content')) {
    return;
  }

  isDragging = true;
  const rect = summaryPanel.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;

  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
}

function drag(e) {
  if (!isDragging) return;

  const x = e.clientX - dragOffset.x;
  const y = e.clientY - dragOffset.y;

  summaryPanel.style.left = `${x}px`;
  summaryPanel.style.top = `${y}px`;
  summaryPanel.style.right = 'auto';
}

function stopDrag() {
  isDragging = false;
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', stopDrag);
}

async function handleSummarize() {
  const btn = summaryPanel.querySelector('#bridge-summarize-now-btn');
  const status = summaryPanel.querySelector('#bridge-panel-status');
  const loading = summaryPanel.querySelector('#bridge-panel-loading');
  const result = summaryPanel.querySelector('#bridge-panel-result');
  const hskLevel = summaryPanel.querySelector('#bridge-hsk-select').value;

  try {
    btn.disabled = true;
    status.classList.remove('visible');
    result.classList.remove('visible');
    loading.classList.add('visible');

    // Extract Chinese text from page
    const chineseText = extractChineseFromPage();

    if (!chineseText || chineseText.trim().length === 0) {
      throw new Error('No Chinese text found on this page');
    }

    // Limit text length
    const maxLength = 3000;
    const textToSummarize = chineseText.length > maxLength
      ? chineseText.substring(0, maxLength) + '...'
      : chineseText;

    // Get summary
    const summary = await getSummary(textToSummarize, hskLevel);

    // Display result
    loading.classList.remove('visible');
    result.classList.add('visible');
    summaryPanel.querySelector('#bridge-result-text').textContent = summary;
    summaryPanel.querySelector('#bridge-result-badge').textContent = `HSK ${hskLevel}`;

  } catch (error) {
    console.error('Summarization error:', error);
    loading.classList.remove('visible');
    status.textContent = error.message;
    status.className = 'bridge-panel-status visible error';
  } finally {
    btn.disabled = false;
  }
}

function extractChineseFromPage() {
  function containsChinese(text) {
    return /[\u4e00-\u9fff]/.test(text);
  }

  const body = document.body.innerText || document.body.textContent;
  const paragraphs = body
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0 && containsChinese(p));

  return paragraphs.join('\n\n');
}

async function getSummary(text, hskLevel) {
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

  const action = selectedModel === 'cloud' ? 'getIdiomaticPhrasing' : 'summarizeWithLocalLLM';

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: action, chineseText: prompt, hskLevel: hskLevel },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.success) {
          let summary = response.text;

          // Clean up response
          const summaryMarker = 'Summary:';
          const markerIndex = summary.lastIndexOf(summaryMarker);
          if (markerIndex !== -1) {
            summary = summary.substring(markerIndex + summaryMarker.length).trim();
          }

          summary = summary.replace(/^["'"\s]+|["'"\s]+$/g, '').trim();
          resolve(summary);
        } else {
          reject(new Error(response?.error || 'Failed to generate summary'));
        }
      }
    );
  });
}

function handleCopy() {
  const text = summaryPanel.querySelector('#bridge-result-text').textContent;
  const btn = summaryPanel.querySelector('#bridge-copy-result-btn');

  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.style.color = '#1e8e3e';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.color = '';
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

function showSummaryPanel() {
  const panel = createSummaryPanel();
  panel.classList.add('visible');
}
