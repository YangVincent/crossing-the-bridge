let currentText = '';
let debounceTimer = null;
let lastTarget = null;
let popup = null;
let overlayWrapper = null;
let currentIndicator = null;

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
function showPopup(target, originalText, suggestion, textWidth, textLeft) {
  console.log('showPopup called with:', { target, originalText, suggestion, textWidth, textLeft });
  const popup = createPopup();
  const suggestionEl = popup.querySelector('.bridge-popup-suggestion');
  const originalEl = popup.querySelector('.bridge-popup-original');

  suggestionEl.textContent = suggestion;
  originalEl.textContent = `Original: ${originalText}`;

  // Position popup above the target
  const rect = target.getBoundingClientRect();
  console.log('Target rect:', rect);

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

    console.log('Popup positioned at:', { left, top, popupHeight, textCenterX });
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
function createOverlayForContentEditable(target, originalText, suggestion) {
  console.log('Creating overlay for contentEditable', originalText, suggestion);

  // Remove any existing indicator
  if (currentIndicator) {
    currentIndicator.remove();
    currentIndicator = null;
  }

  // Calculate the width of the actual text
  const measureText = (text, element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const styles = window.getComputedStyle(element);
    context.font = `${styles.fontSize} ${styles.fontFamily}`;
    return context.measureText(text).width;
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
  indicator.style.width = `${textWidth}px`;
  indicator.style.height = '3px'; // Thinner underline
  indicator.style.backgroundColor = '#1a73e8';
  indicator.style.cursor = 'pointer';
  indicator.style.zIndex = '999999';
  indicator.style.pointerEvents = 'auto';
  indicator.dataset.suggestion = suggestion;
  indicator.dataset.original = originalText;
  indicator.title = 'Click to see suggestion'; // Add tooltip

  console.log('Indicator created at:', { left: rect.left + paddingLeft, top: rect.bottom - 5, width: textWidth });

  document.body.appendChild(indicator);
  currentIndicator = indicator;

  // Show popup immediately when overlay is created
  const currentPopup = showPopup(target, originalText, suggestion, textWidth, rect.left + paddingLeft);

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
  const checkTextChanges = () => {
    const currentContent = getTextFromElement(target);

    // If the original text is no longer in the content, hide everything
    if (!currentContent.includes(originalText)) {
      console.log('Original text removed, hiding popup and indicator');
      if (currentPopup) {
        currentPopup.classList.remove('visible');
      }
      if (indicator.parentNode) {
        indicator.remove();
        currentIndicator = null;
      }
      target.removeEventListener('input', checkTextChanges);
      window.removeEventListener('scroll', updateIndicatorPosition, true);
      window.removeEventListener('resize', updateIndicatorPosition);
    }
  };

  target.addEventListener('input', checkTextChanges);

  // Show popup when clicking the indicator or the input
  const showSuggestion = (e) => {
    console.log('showSuggestion clicked!');
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

// Function to call Claude API for idiomatic phrasing via background script
async function getIdiomaticPhrasing(chineseText, target) {
  console.log('Getting idiomatic phrasing for:', chineseText);
  try {
    chrome.runtime.sendMessage(
      { action: 'getIdiomaticPhrasing', chineseText: chineseText },
      (response) => {
        console.log('API response received:', response);
        if (response && response.success) {
          console.log('More idiomatic phrasing:', response.text);
          // Show the suggestion in the overlay
          if (target.isContentEditable) {
            console.log('Target is contentEditable, creating overlay');
            createOverlayForContentEditable(target, chineseText, response.text);
          } else {
            // For regular input/textarea, show popup near the input
            console.log('Target is regular input, showing popup');
            showPopup(target, chineseText, response.text);
          }
        } else {
          console.error('Error calling Claude API:', response ? response.error : 'No response');
        }
      }
    );
  } catch (error) {
    console.error('Error sending message to background script:', error);
  }
}

// Listen for keyboard events on input fields
document.addEventListener('keydown', (event) => {
  // Check if the event target is a text input element
  const target = event.target;
  const isTextInput =
    target.tagName === 'INPUT' &&
    ['text', 'email', 'password', 'search', 'tel', 'url'].includes(target.type) ||
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
      console.log('Current text:', currentText, 'Contains Chinese:', containsChinese(currentText));

      // Check if text contains Chinese
      if (containsChinese(currentText)) {
        console.log('Chinese detected, setting debounce timer');
        // Set debounce timer for 0.5 seconds
        debounceTimer = setTimeout(() => {
          console.log('Debounce complete, calling API');
          getIdiomaticPhrasing(currentText, target);
        }, 500);
      }
    }, 0);
  }
});
