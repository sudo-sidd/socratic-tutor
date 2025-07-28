export function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="vscode-resource:/src/webview-ui.css">
      <title>Socratic Code Tutor</title>
      <style>
        /* fallback for VSCode resource loading */
        @import url('vscode-resource:/src/webview-ui.css');
      </style>
    </head>
    <body>
      <div id="chat-container">
        <div id="toolbar">
          <select id="model-select"></select>
          <span id="status-group"></span>
          <button id="clear-btn" title="Clear chat">🧹</button>
          <button id="regen-btn" title="Regenerate">🔄</button>
          <button id="copy-btn" title="Copy reply">📋</button>
        </div>
        <div id="chat"></div>
        <div id="typing-indicator" style="display:none;">Typing...</div>
        <div id="input-row">
          <input id="input" type="text" placeholder="Ask your question..." autocomplete="off" />
          <button id="send-btn">Send</button>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        let config = {};
        let ollamaModels = [];
        let chatHistory = [];
        let lastAssistantMsg = '';
        let scrollPinned = true;
        let streaming = false;

        // Model dropdown and status
        function updateModelDropdown() {
          const select = document.getElementById('model-select');
          select.innerHTML = '';
          const providers = ['OpenAI', 'Claude', 'Gemini', 'OpenRouter', 'Ollama'];
          providers.forEach(provider => {
            let models = [];
            if (provider === 'Ollama') models = ollamaModels;
            else if (config.models && config.models[provider]) models = config.models[provider];
            else models = [config.model || ''];
            models.forEach(model => {
              const opt = document.createElement('option');
              opt.value = provider + ':' + model;
              opt.textContent = provider + ' - ' + model;
              if (config.provider === provider && config.model === model) opt.selected = true;
              select.appendChild(opt);
            });
          });
        }

        function updateStatusIndicators() {
          const statusGroup = document.getElementById('status-group');
          statusGroup.innerHTML = '';
          const providers = ['OpenAI', 'Claude', 'Gemini', 'OpenRouter', 'Ollama'];
          providers.forEach(provider => {
            const span = document.createElement('span');
            span.className = 'status-indicator status-yellow';
            span.title = provider + ' (checking...)';
            span.id = 'status-' + provider;
            statusGroup.appendChild(span);
          });
        }

        function setStatus(provider, status) {
          const el = document.getElementById('status-' + provider);
          if (!el) return;
          el.className = 'status-indicator status-' + status;
          el.title = provider + ' (' + status + ')';
        }

        // Chat rendering
        function renderChat() {
          const chatDiv = document.getElementById('chat');
          chatDiv.innerHTML = '';
          chatHistory.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = 'bubble ' + msg.role + (msg.error ? ' error' : '');
            if (msg.role === 'assistant') {
              bubble.innerHTML = marked.parse(msg.text || '');
            } else {
              bubble.textContent = msg.text;
            }
            chatDiv.appendChild(bubble);
          });
          if (scrollPinned) chatDiv.scrollTop = chatDiv.scrollHeight;
        }

        // Typing indicator
        function showTyping(show) {
          document.getElementById('typing-indicator').style.display = show ? '' : 'none';
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

        // Send message
        document.getElementById('send-btn').onclick = () => {
          const input = document.getElementById('input');
          const text = input.value.trim();
          if (!text) return;
          sendMessage(text);
        };
        document.getElementById('input').onkeydown = e => {
          if (e.key === 'Enter') {
            document.getElementById('send-btn').click();
          }
        };

        // Model selection
        document.getElementById('model-select').onchange = e => {
          const val = e.target.value;
          const [provider, model] = val.split(':');
          vscode.postMessage({ type: 'providerConfig', provider, model });
        };

        // Scroll pinning
        document.getElementById('chat').onscroll = () => {
          const chatDiv = document.getElementById('chat');
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
              setTimeout(update, 12);
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
            updateStatusIndicators();
            // TODO: test backend status and update indicators
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
          }
        });

        // Markdown rendering
        // Use CDN for marked.js
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
        document.head.appendChild(script);
      </script>
    </body>
    </html>
  `;
}
