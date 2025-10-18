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

// Inject CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = chrome.runtime.getURL('overlay.css');
document.head.appendChild(link);

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

// Show working indicator to the right of the input field
function showWorkingIndicator(target) {
  // Remove any existing working indicator
  if (workingIndicator) {
    workingIndicator.remove();
  }

  const rect = target.getBoundingClientRect();
  workingIndicator = document.createElement('div');
  workingIndicator.className = 'bridge-working-indicator';
  
  // Position to the right of the input field
  workingIndicator.style.position = 'fixed';
  workingIndicator.style.left = `${rect.right + 8}px`;
  workingIndicator.style.top = `${rect.top + (rect.height / 2) - 10}px`;
  
  document.body.appendChild(workingIndicator);

  // Update position on scroll/resize
  const updatePosition = () => {
    if (!workingIndicator || !workingIndicator.parentNode) return;
    const newRect = target.getBoundingClientRect();
    workingIndicator.style.left = `${newRect.right + 8}px`;
    workingIndicator.style.top = `${newRect.top + (newRect.height / 2) - 10}px`;
  };

  window.addEventListener('scroll', updatePosition, true);
  window.addEventListener('resize', updatePosition);

  // Store cleanup function
  workingIndicator._cleanup = () => {
    window.removeEventListener('scroll', updatePosition, true);
    window.removeEventListener('resize', updatePosition);
  };
}

// Hide working indicator
function hideWorkingIndicator() {
  if (workingIndicator) {
    if (workingIndicator._cleanup) {
      workingIndicator._cleanup();
    }
    workingIndicator.remove();
    workingIndicator = null;
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
  `;
  document.body.appendChild(popup);
  return popup;
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

    console.log('Suggestion to insert:', suggestion);
    console.log('Target tag:', target.tagName);
    console.log('Is contentEditable:', target.isContentEditable);

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
    popup.classList.remove('visible');
    if (indicator && indicator.parentNode) {
      indicator.remove();
    }
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
  return new Promise((resolve) => {
    // Check if already in cache
    if (sentenceCache.has(sentence)) {
      console.log('Using cached result for:', sentence);
      resolve(sentenceCache.get(sentence));
      return;
    }

    // Make API call for this sentence
    chrome.runtime.sendMessage(
      { action: 'getIdiomaticPhrasingLocal', chineseText: sentence },
      (response) => {
        // Check if this processing session has been cancelled
        if (processingId !== activeProcessingId) {
          console.log('Discarding outdated response for:', sentence);
          resolve(null);
          return;
        }

        if (response && response.success) {
          const result = {
            suggestion: response.text,
            usefulness: response.semanticDifference,
            originalSentence: sentence
          };
          
          // Cache the result
          sentenceCache.set(sentence, result);
          console.log('Cached sentence result:', sentence, '->', result);
          
          resolve(result);
        } else {
          resolve(null);
        }
      }
    );
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
  // Check if the event target is a text input element
  const target = event.target;
  const isTextInput =
    target.tagName === 'INPUT' &&
    ['text', 'email', 'password', 'search', 'tel', 'url', 'textarea', 'div'].includes(target.type) ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;

  if (isTextInput) {
    lastTarget = target;

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
