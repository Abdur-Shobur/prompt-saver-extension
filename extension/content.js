// Prompt Saver — captures the prompt text right before ChatGPT / Claude sends it.
// Listeners run in the capture phase, so we read the composer before the app clears it.
(() => {
  const host = location.hostname;
  const SITE = host.includes('claude.ai') ? 'claude' : 'chatgpt';

  const COMPOSER_SELECTORS = [
    '#prompt-textarea',                               // ChatGPT
    'div.ProseMirror[contenteditable="true"]',        // Claude (and ChatGPT)
    '[contenteditable="true"][role="textbox"]',
    'textarea'
  ];

  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',              // ChatGPT
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',              // Claude
    'button[aria-label="Send Message"]',
    'button[aria-label*="Send" i]'
  ].join(',');

  let last = { text: '', t: 0 };

  function findComposer() {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function readText(el) {
    if (!el) return '';
    const raw = el.tagName === 'TEXTAREA' ? el.value : el.innerText;
    return (raw || '').replace(/​/g, '').trim();
  }

  function capture(el) {
    const text = readText(el);
    if (!text) return;
    const now = Date.now();
    // Enter + button click can both fire for one send; ignore the repeat.
    if (text === last.text && now - last.t < 5000) return;
    last = { text, t: now };
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_PROMPT',
        prompt: { text, site: SITE, url: location.href, title: document.title }
      });
    } catch (_) {
      // Extension was reloaded/updated — page needs a refresh. Ignore.
    }
  }

  // Enter to send (Shift+Enter is a newline, IME composition is ignored)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    const el = e.target?.closest?.('[contenteditable="true"], textarea');
    if (!el) return;
    capture(el);
  }, true);

  // Clicking the send button
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target?.closest?.(SEND_SELECTORS);
    if (!btn || btn.disabled) return;
    capture(findComposer());
  }, true);

  // Keyboard activation of the send button (Tab + Space/Enter)
  document.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // real mouse clicks are already handled by pointerdown
    const btn = e.target?.closest?.(SEND_SELECTORS);
    if (!btn) return;
    capture(findComposer());
  }, true);
})();
