let currentText = '';
let debounceTimer = null;
let lastTarget = null;

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
async function getIdiomaticPhrasing(chineseText) {
  try {
    chrome.runtime.sendMessage(
      { action: 'getIdiomaticPhrasing', chineseText: chineseText },
      (response) => {
        if (response.success) {
          console.log('More idiomatic phrasing:', response.text);
        } else {
          console.error('Error calling Claude API:', response.error);
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
    // Clear previous debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Get current text from the input field
    setTimeout(() => {
      currentText = getTextFromElement(target);

      // Check if text contains Chinese
      if (containsChinese(currentText)) {
        // Set debounce timer for 1 second
        debounceTimer = setTimeout(() => {
          getIdiomaticPhrasing(currentText);
        }, 1000);
      }
    }, 0);
  }
});
