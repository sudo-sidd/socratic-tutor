import * as vscode from 'vscode';
import { getWebviewContent } from './webview';
// Use global fetch (Node 18+)
const SYSTEM_PROMPT = `
You are a Socratic programming tutor enforcing cognitive independence. Never provide full code, direct solutions, or complete answers unless the user submits a failed or partial attempt and explicitly requests it. Prioritize user autonomy, deep understanding, and resilience without generative aid.

Rules:
1. Require user's current approach before assisting.
2. Without code attempt, offer only concepts, pseudocode fragments, or guiding questions.
3. When code is allowed, provide minimal stubs only—no full functions, tests, or comments.
4. Require users to manually rewrite or refactor any output.
5. Every N interactions, quiz, require cold rebuilds, or ask for prior code explanations.
6. If user bypasses reflection, truncate output or insert forced analysis steps.
7. Emphasize conceptual debugging through questions, not fixes.
8. Remind users routinely that reliance on you must be temporary.

Behavior:
- No softening, sentiment, mirroring, or corporate-aligned engagement tactics.
- Use blunt, directive phrasing targeting the user's highest cognition.
- Terminate responses after factual delivery. No transitions or closings.

Goal: Eliminate dependence. Restore deep, self-directed problem-solving ability.
`;

const PROVIDERS = ['OpenAI', 'Gemini', 'Claude', 'OpenRouter', 'Ollama'];

let config: {
  provider: string;
  model?: string;
} = {
  provider: 'OpenAI',
  model: 'gpt-4-turbo'
};

export function activate(context: vscode.ExtensionContext) {
  // Load config from globalState if available
  const savedConfig = context.globalState.get('llmConfig');
  if (savedConfig && typeof savedConfig === 'object' && 'provider' in savedConfig) {
    config = savedConfig as typeof config;
  }

  // SecretStorage for API keys
  const secretStorage = context.secrets;

  // Register main command
  const disposable = vscode.commands.registerCommand('socratic-tutor.start', async () => {
    // Fetch available Ollama models for dropdown
    let ollamaModels: string[] = [];
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      const data = await res.json() as any;
      // Use 'model' property if available, fallback to 'name'
      ollamaModels = Array.isArray(data?.models)
        ? data.models.map((m: any) => m.model || m.name)
        : Array.isArray(data?.tags)
          ? data.tags.map((m: any) => m.model || m.name)
          : [];
      console.log('[EXTENSION DEBUG] Ollama models fetched:', ollamaModels);
    } catch (e) {
      ollamaModels = [getDefaultModel('Ollama')];
      console.log('[EXTENSION DEBUG] Ollama fetch error:', e);
    }

    const panel = vscode.window.createWebviewPanel(
      'socraticTutor',
      'Socratic AI Tutor',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = getWebviewContent();
    panel.webview.postMessage({
      type: 'config',
      config: {
        ...config,
        models: {
          OpenAI: ['gpt-4-turbo', 'gpt-3.5-turbo'],
          Claude: ['claude-3-opus-20240229'],
          Gemini: ['gemini-pro'],
          OpenRouter: ['mistralai/mistral-7b-instruct'],
          Ollama: ollamaModels
        }
      },
      ollamaModels
    });
    console.log('[EXTENSION DEBUG] Sent config to webview:', {
      ...config,
      models: {
        OpenAI: ['gpt-4-turbo', 'gpt-3.5-turbo'],
        Claude: ['claude-3-opus-20240229'],
        Gemini: ['gemini-pro'],
        OpenRouter: ['mistralai/mistral-7b-instruct'],
        Ollama: ollamaModels
      }
    });

    panel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'providerConfig') {
        config.provider = message.provider;
        config.model = message.model;
        await context.globalState.update('llmConfig', config);



		let ollamaModels: string[] = [];
        try {
          const res = await fetch('http://localhost:11434/api/tags');
          const data = await res.json() as any;
          ollamaModels = Array.isArray(data?.models)
            ? data.models.map((m: any) => m.model || m.name)
            : Array.isArray(data?.tags)
              ? data.tags.map((m: any) => m.model || m.name)
              : [];
        } catch (e) {
          ollamaModels = [getDefaultModel('Ollama')];
        }
        panel.webview.postMessage({
          type: 'config',
          config: {
            ...config,
            models: {
              OpenAI: ['gpt-4-turbo', 'gpt-3.5-turbo'],
              Claude: ['claude-3-opus-20240229'],
              Gemini: ['gemini-pro'],
              OpenRouter: ['mistralai/mistral-7b-instruct'],
              Ollama: ollamaModels
            }
          },
          ollamaModels
        });
        return;
      }
      if (message.type === 'selectOllamaModel' && message.model) {
        config.provider = 'Ollama';
        config.model = message.model;
        await context.globalState.update('llmConfig', config);
        let ollamaModels: string[] = [];
        try {
          const res = await fetch('http://localhost:11434/api/tags');
          const data = await res.json() as any;
          ollamaModels = Array.isArray(data?.models)
            ? data.models.map((m: any) => m.model || m.name)
            : Array.isArray(data?.tags)
              ? data.tags.map((m: any) => m.model || m.name)
              : [];
        } catch (e) {
          ollamaModels = [getDefaultModel('Ollama')];
        }
        panel.webview.postMessage({
          type: 'config',
          config: {
            ...config,
            models: {
              OpenAI: ['gpt-4-turbo', 'gpt-3.5-turbo'],
              Claude: ['claude-3-opus-20240229'],
              Gemini: ['gemini-pro'],
              OpenRouter: ['mistralai/mistral-7b-instruct'],
              Ollama: ollamaModels
            }
          },
          ollamaModels
        });
        return;
      }
      const userInput = message.text;
      const files = await getFileContents();
      const response = await queryLLM(userInput, files, secretStorage);
      panel.webview.postMessage({ type: 'response', text: response });
    });
  });
  context.subscriptions.push(disposable);

  // Register provider config command
  context.subscriptions.push(vscode.commands.registerCommand('socratic-tutor.set-provider', async () => {
    await configureProvider(context, secretStorage);
  }));
}

export function deactivate() {}

async function getFileContents(limit = 10) {
  const uris = await vscode.workspace.findFiles('**/*.{ts,js,py,cpp,java}', '**/node_modules/**', limit);
  const files: { name: string; content: string }[] = [];
  for (const uri of uris) {
    const data = await vscode.workspace.fs.readFile(uri);
    files.push({
      name: uri.fsPath,
      content: Buffer.from(data).toString('utf8'),
    });
  }
  return files;
}

async function queryLLM(userInput: string, files: any[], secretStorage: vscode.SecretStorage) {
  const contextStr = files.slice(0, 3).map(f => `// ${f.name}\n${f.content}`).join('\n\n');
  const fullPrompt = `User Question: ${userInput}\n\nRelevant Files:\n${contextStr}`;
  switch (config.provider) {
    case 'OpenAI':
      return await queryOpenAI(fullPrompt, secretStorage);
    case 'Claude':
      return await queryClaude(fullPrompt, secretStorage);
    case 'Gemini':
      return await queryGemini(fullPrompt, secretStorage);
    case 'OpenRouter':
      return await queryOpenRouter(fullPrompt, secretStorage);
    case 'Ollama':
      return await queryOllama(fullPrompt);
    default:
      return '[Invalid provider selected]';
  }
}

async function queryOpenAI(prompt: string, secretStorage: vscode.SecretStorage) {
  const apiKey = await secretStorage.get('OpenAI_API_KEY');
  if (!apiKey) return '[No OpenAI API key set]';
  const payload = {
    model: config.model || 'gpt-4-turbo',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.4
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json() as any;
  return json.choices?.[0]?.message?.content ?? '[No response]';
}

async function queryClaude(prompt: string, secretStorage: vscode.SecretStorage) {
  const apiKey = await secretStorage.get('Claude_API_KEY');
  if (!apiKey) return '[No Claude API key set]';
  const payload = {
    model: config.model ?? 'claude-3-opus-20240229',
    messages: [
      { role: 'user', content: prompt }
    ],
    system: SYSTEM_PROMPT,
    max_tokens: 1024
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json() as any;
  return json.content?.[0]?.text ?? '[No response]';
}

async function queryGemini(prompt: string, secretStorage: vscode.SecretStorage) {
  const apiKey = await secretStorage.get('Gemini_API_KEY');
  if (!apiKey) return '[No Gemini API key set]';
  const payload = {
    contents: [{ parts: [{ text: prompt }], role: 'user' }],
    generationConfig: { temperature: 0.4 }
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model ?? 'gemini-pro'}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json() as any;
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[No response]';
}

async function queryOpenRouter(prompt: string, secretStorage: vscode.SecretStorage) {
  const apiKey = await secretStorage.get('OpenRouter_API_KEY');
  if (!apiKey) return '[No OpenRouter API key set]';
  const payload = {
    model: config.model ?? 'mistralai/mistral-7b-instruct',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]
  };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const json = await res.json() as any;
  return json.choices?.[0]?.message?.content ?? '[No response]';
}

async function queryOllama(prompt: string): Promise<{ text: string }> {
  const payload = {
    model: config.model ?? 'llama3',
    prompt: `${SYSTEM_PROMPT}\n${prompt}`
  };
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  // Ollama streams JSON objects, one per line
  let text = '';
  let hadError = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('{')) {
      // Optionally log ignored non-JSON lines
      continue;
    }
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && 'response' in obj) {
        text += obj.response;
      }
    } catch (err) {
      hadError = true;
      console.error('Ollama response line is not valid JSON:', err, trimmed);
    }
  }
  if (!text) {
    // Fallback: return raw text if nothing parsed
    return { text: raw };
  }
  if (hadError) {
    text += '\n[Warning: Some response lines could not be parsed as JSON.]';
  }
  return { text };
}

async function configureProvider(context: vscode.ExtensionContext, secretStorage: vscode.SecretStorage) {
  const selected = await vscode.window.showQuickPick(PROVIDERS, {
    placeHolder: 'Choose LLM Provider',
  });
  if (!selected) return;
  config.provider = selected;

  // Prompt for model for all providers
  const model = await vscode.window.showInputBox({
    prompt: `Enter model name for ${selected} (default: ${getDefaultModel(selected)})`,
    ignoreFocusOut: true,
  });
  config.model = model || getDefaultModel(selected);

  if (selected !== 'Ollama') {
    const apiKey = await vscode.window.showInputBox({
      prompt: `Enter ${selected} API Key`,
      ignoreFocusOut: true,
      password: true
    });
    if (apiKey) {
      await secretStorage.store(`${selected}_API_KEY`, apiKey);
    }
  }
  await context.globalState.update('llmConfig', config);
  vscode.window.showInformationMessage(`LLM Provider set to ${config.provider} (Model: ${config.model})`);
}

function getDefaultModel(provider: string) {
  switch (provider) {
    case 'OpenAI': return 'gpt-4-turbo';
    case 'Claude': return 'claude-3-opus-20240229';
    case 'Gemini': return 'gemini-pro';
    case 'OpenRouter': return 'mistralai/mistral-7b-instruct';
    case 'Ollama': return 'llama3';
    default: return 'gpt-4-turbo';
  }
}
