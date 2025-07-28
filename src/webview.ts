export function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="vscode-resource:/src/webview.css">
      <title>Socratic Tutor Chat</title>
    </head>
    <body>
      <div id="chat-header" style="display:flex;align-items:center;justify-content:space-between;padding:1rem 2vw 0 2vw;">
        <div style="display:flex;align-items:center;gap:1rem;">
          <label for="model-select" style="font-weight:500;">Model:</label>
          <select id="model-select" class="model-select"></select>
          <span id="model-status"></span>
        </div>
        <div id="toolbar" style="display:flex;align-items:center;gap:0.5rem;">
          <button id="clear-btn" class="toolbar-btn" title="Clear chat">🧹</button>
          <button id="copy-btn" class="toolbar-btn" title="Copy reply">�</button>
          <button id="regen-btn" class="toolbar-btn" title="Regenerate">🔄</button>
          <button id="settings-btn" class="toolbar-btn" title="Settings">⚙️</button>
        </div>
      </div>
      <div id="chat-window"></div>
      <div id="input-bar">
        <input id="chat-input" type="text" placeholder="Type your question..." autocomplete="off" />
        <button id="send-btn">Send</button>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script>
        const vscode = acquireVsCodeApi();
        let config = {};
        let ollamaModels = [];
        let chatHistory = [];
        let lastAssistantMsg = '';
        let streaming = false;
        let scrollPinned = true;
        let statusMap = {};

        // Model dropdown and status
        function updateModelDropdown() {
          const select = document.getElementById('model-select');
          select.innerHTML = '';
          if (!config.models) return;
          console.log('[DEBUG] Models received:', config.models);
          if (config.models.Ollama) {
            console.log('[DEBUG] Ollama models:', config.models.Ollama);
          }
          let selectedValue = '';
          Object.entries(config.models).forEach(([provider, models]) => {
            if (!models || !models.length) return;
            const group = document.createElement('optgroup');
            group.label = provider;
            models.forEach(model => {
              const opt = document.createElement('option');
              opt.value = provider + ':' + model;
              opt.textContent = model;
              // Normalize whitespace for comparison
              const normalizedModel = (model + '').replace(/\s+/g, '').toLowerCase();
              const normalizedConfigModel = (config.model + '').replace(/\s+/g, '').toLowerCase();
              if (config.provider === provider && normalizedConfigModel === normalizedModel) {
                selectedValue = opt.value;
              }
              group.appendChild(opt);
            });
            select.appendChild(group);
          });
          // Explicitly set dropdown value to ensure correct selection
          if (selectedValue) {
            select.value = selectedValue;
            console.log('[DEBUG] Forced dropdown value:', select.value);
          } else if (
            config.provider === 'Ollama' &&
            config.models.Ollama &&
            config.models.Ollama.length &&
            (!config.model || !config.models.Ollama.some(m => (m + '').replace(/\s+/g, '').toLowerCase() === (config.model + '').replace(/\s+/g, '').toLowerCase()))
          ) {
            // Fallback: select first Ollama model only if config.model is empty or not found
            select.value = 'Ollama:' + config.models.Ollama[0];
            console.log('[DEBUG] Fallback to first Ollama model:', select.value);
          }
          console.log('[DEBUG] Selected provider/model:', config.provider, config.model);
        }

        function updateStatusIcons() {
          const statusSpan = document.getElementById('model-status');
          statusSpan.innerHTML = '';
          if (!config.models) return;
          Object.keys(config.models).forEach(provider => {
            const icon = document.createElement('span');
            let status = statusMap[provider] || 'yellow';
            icon.className = 'status-icon status-' + status;
            icon.title = provider + ' (' + status + ')';
            icon.id = 'status-' + provider;
            icon.textContent = status === 'green' ? '✅' : status === 'red' ? '❌' : '⚠️';
            statusSpan.appendChild(icon);
          });
        }

        function setStatus(provider, status) {
          statusMap[provider] = status;
          updateStatusIcons();
        }

        // Chat rendering
        function renderChat() {
          const chatDiv = document.getElementById('chat-window');
          chatDiv.innerHTML = '';
          chatHistory.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = 'bubble ' + msg.role + (msg.error ? ' error' : '');
            if (msg.role === 'assistant') {
              bubble.innerHTML = marked.parse(msg.text || '');
              bubble.style.alignSelf = 'flex-end';
            } else {
              bubble.textContent = msg.text;
              bubble.style.alignSelf = 'flex-start';
            }
            chatDiv.appendChild(bubble);
          });
          if (scrollPinned) chatDiv.scrollTop = chatDiv.scrollHeight;
        }

        // Typing indicator and spinner
        function showTyping(show) {
          let indicator = document.getElementById('typing-indicator');
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'typing-indicator';
            indicator.innerHTML = '<span class="spinner"></span> ...';
            document.getElementById('chat-window').appendChild(indicator);
          }
          indicator.style.display = show ? '' : 'none';
        }

        // Toolbar actions
        document.getElementById('clear-btn').onclick = () => {
          chatHistory = [];
          renderChat();
        };
        document.getElementById('regen-btn').onclick = () => {
          if (chatHistory.length === 0) return;
          const lastUser = chatHistory.filter(m => m.role === 'user').slice(-1)[0];
          if (lastUser) sendMessage(lastUser.text, true);
        };
        document.getElementById('copy-btn').onclick = () => {
          if (lastAssistantMsg) navigator.clipboard.writeText(lastAssistantMsg);
        };
        document.getElementById('settings-btn').onclick = () => {
          vscode.postMessage({ type: 'settings' });
        };

        // Send message
        document.getElementById('send-btn').onclick = () => {
          const input = document.getElementById('chat-input');
          const text = input.value.trim();
          if (!text) return;
          sendMessage(text);
        };
        document.getElementById('chat-input').onkeydown = e => {
          if (e.key === 'Enter') {
            document.getElementById('send-btn').click();
          }
        };

        // Model selection
        document.getElementById('model-select').onchange = e => {
          const val = e.target.value;
          // Fix: preserve full model name (may contain colons)
          const firstColon = val.indexOf(':');
          const provider = val.substring(0, firstColon);
          const model = val.substring(firstColon + 1);
          console.log('[DEBUG] Model selected:', provider, model);
          vscode.postMessage({ type: 'providerConfig', provider, model });
        };

        // Scroll pinning
        document.getElementById('chat-window').onscroll = () => {
          const chatDiv = document.getElementById('chat-window');
          scrollPinned = chatDiv.scrollTop + chatDiv.clientHeight >= chatDiv.scrollHeight - 8;
        };

        // Streaming support
        function streamAssistant(text) {
          streaming = true;
          let msg = { role: 'assistant', text: '', error: false };
          chatHistory.push(msg);
          renderChat();
          let i = 0;
          function update() {
            if (i < text.length) {
              msg.text += text[i++];
              renderChat();
              if (scrollPinned) document.getElementById('chat-window').scrollTop = document.getElementById('chat-window').scrollHeight;
              setTimeout(update, 10);
            } else {
              streaming = false;
              lastAssistantMsg = msg.text;
              showTyping(false);
            }
          }
          update();
        }

        // Send message logic
        function sendMessage(text, isRegen) {
          chatHistory.push({ role: 'user', text, error: false });
          renderChat();
          showTyping(true);
          vscode.postMessage({ text });
        }

        // Message from extension
        window.addEventListener('message', event => {
          const data = event.data;
          if (data.type === 'config') {
            config = data.config || {};
            ollamaModels = data.ollamaModels || [];
            updateModelDropdown();
            updateStatusIcons();
          } else if (data.type === 'response') {
            showTyping(false);
            if (typeof data.text === 'object' && data.text.text) {
              streamAssistant(data.text.text);
            } else if (typeof data.text === 'string') {
              streamAssistant(data.text);
            } else if (data.text && data.text.error) {
              chatHistory.push({ role: 'assistant', text: data.text.error, error: true });
              renderChat();
            }
          } else if (data.type === 'testStatus') {
            Object.entries(data.status).forEach(([provider, status]) => setStatus(provider, status));
          }
        });
      </script>
    </body>
    </html>
  `;
}
