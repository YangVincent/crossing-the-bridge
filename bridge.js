let currentText = '';
let debounceTimer = null;
let lastTarget = null;
let popup = null;
let overlayWrapper = null;
let currentIndicator = null;
let suggestionCache = new Map(); // Map to store suggestion -> original text pairs (for looking up what to replace)
let acceptedSuggestions = new Set(); // Set to store accepted suggestions that shouldn't be re-suggested

// Inject CSS
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = chrome.runtime.getURL('overlay.css');
document.head.appendChild(link);

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

// Function to call Claude API for idiomatic phrasing via background script
async function getIdiomaticPhrasing(chineseText, target) {
  // Filter out accepted suggestions
  const filteredText = removeAcceptedSuggestions(chineseText);

  // If nothing left after filtering, don't make API call
  if (!filteredText || !containsChinese(filteredText)) {
    console.log('No new Chinese text to suggest after filtering');
    return;
  }

  if (filteredText.length < 4) {
    console.log('Chinese text too short, skipping API call');
    return;
  }

  try {
    chrome.runtime.sendMessage(
      { action: 'getIdiomaticPhrasingLocal', chineseText: filteredText },
      (response) => {
        if (response && response.success) {
          console.log('Semantic difference score:', response.semanticDifference);
          
          // Only show popup if semantic difference is > 0.5
          if (response.semanticDifference > 0.5) {
            // Cache the filtered text -> suggestion mapping
            suggestionCache.set(response.text, filteredText);
            console.log('Cached mapping:', filteredText, '->', response.text);

            // Always use the contentEditable overlay approach
            createOverlayForContentEditable(target, filteredText, response.text, response.semanticDifference);
          } else {
            console.log('Semantic difference too small, not showing suggestion');
          }
        }
      }
    );
  } catch (error) {
    // Silent error handling
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
        // Set debounce timer for 0.5 seconds
        debounceTimer = setTimeout(() => {
          getIdiomaticPhrasing(currentText, target);
        }, 500);
      }
    }, 0);
  }
});
