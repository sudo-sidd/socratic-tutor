
export function getWebviewContent(): string {
  const fs = require('fs');
  const path = require('path');
  // Always load from src/webview.html, not from out/
  const htmlPath = path.join(__dirname, 'webview.html');
  if (!fs.existsSync(htmlPath)) {
    // Try to load from src/ if running from out/
    const srcPath = path.join(__dirname, '../src/webview.html');
    if (fs.existsSync(srcPath)) {
      return fs.readFileSync(srcPath, 'utf8');
    }
    throw new Error('webview.html not found at ' + htmlPath + ' or ' + srcPath);
  }
  return fs.readFileSync(htmlPath, 'utf8');
}
