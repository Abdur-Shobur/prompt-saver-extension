// Service workers can't create blob URLs, so the backup file is built here.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'OFFSCREEN_BLOB') return false;
  const url = URL.createObjectURL(new Blob([msg.data], { type: msg.mime || 'application/octet-stream' }));
  sendResponse({ url });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  return false;
});
