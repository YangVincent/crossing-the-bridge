// content-script.js - interacts with the webpage

document.addEventListener("mouseup", () => {
  const selectedText = window.getSelection().toString().trim();
  if (!selectedText) return;

  // simple test: right now, just logs rephrasing
  chrome.runtime.sendMessage({ type: "REPHRASE", text: selectedText }, (resp) => {
    if (!resp) return;
    if (resp.ok) {
      showPopup(resp.text);
    } else {
      showPopup("⚠️ " + resp.error);
    }
  });
});

function showPopup(text) {
  const box = document.createElement("div");
  box.textContent = text;
  Object.assign(box.style, {
    position: "fixed",
    bottom: "10px",
    right: "10px",
    background: "#fff",
    color: "#000",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    zIndex: 999999,
    maxWidth: "300px"
  });
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}
