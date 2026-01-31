// ============ Chat Test Page JS ============

// State variables
let chatHistory = [];
let isStreaming = false;
let currentChatAccountId = null;
let currentGeminiAccountId = null;
let chatApiEndpoint = localStorage.getItem('chatApiEndpoint') || '';
let chatApiKey = localStorage.getItem('chatApiKey') || '';

// DOM elements
let chatMessages, chatInput, chatSendBtn, chatModel, chatSettingsModal;

// Check if it's a Gemini model
function isGeminiModel(model) {
    return model && model.startsWith('gemini-');
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Get DOM elements
    chatMessages = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    chatSendBtn = document.getElementById('chat-send-btn');
    chatModel = document.getElementById('chat-model');
    chatSettingsModal = document.getElementById('chat-settings-modal');

    // Load site settings first
    await loadSiteSettings();

    // Inject sidebar
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('chat');

    // Update page title and model group labels
    const settings = window.siteSettings;
    document.title = `Chat Test - ${settings.siteName} ${settings.siteSubtitle}`;

    // Update "Kiro" in model group labels
    const kiroOptgroup = chatModel.querySelector('optgroup[label*="Kiro"]');
    if (kiroOptgroup) {
        kiroOptgroup.label = `Claude (${settings.siteName})`;
    }

    if (!await checkAuth()) return;

    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const accountId = urlParams.get('account');
    const geminiId = urlParams.get('gemini');

    if (accountId) {
        currentChatAccountId = parseInt(accountId);
        loadAccountInfo(currentChatAccountId, 'kiro');
    } else if (geminiId) {
        currentGeminiAccountId = parseInt(geminiId);
        loadAccountInfo(currentGeminiAccountId, 'gemini');
        // Automatically select Gemini model
        chatModel.value = 'gemini-3-flash-preview';
    }

    setupEventListeners();
    updateSidebarStats();
    updateSendButtonState();
});

// Load account info
async function loadAccountInfo(id, type = 'kiro') {
    try {
        const apiPath = type === 'gemini' ? '/api/gemini/credentials/' : '/api/credentials/';
        const res = await fetch(apiPath + id, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const accountName = result.data.email || result.data.name;
            const prefix = type === 'gemini' ? '[Gemini] ' : '';
            document.getElementById('chat-current-account').textContent = prefix + accountName;
            document.getElementById('chat-subtitle').textContent = 'Using account: ' + prefix + accountName;
        }
    } catch (err) {
        console.error('Load account info error:', err);
    }
}

// Event listeners
function setupEventListeners() {
    // Input field
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
        updateSendButtonState();
    });

    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Send button
    chatSendBtn.addEventListener('click', sendMessage);

    // Update button state when model changes
    chatModel.addEventListener('change', updateSendButtonState);

    // Clear button
    document.getElementById('chat-clear-btn').addEventListener('click', clearChat);

    // Settings button
    document.getElementById('chat-settings-btn').addEventListener('click', openChatSettings);
    document.getElementById('settings-modal-close').addEventListener('click', closeChatSettings);
    document.getElementById('settings-modal-cancel').addEventListener('click', closeChatSettings);
    document.getElementById('settings-modal-save').addEventListener('click', saveChatSettings);
    chatSettingsModal.addEventListener('click', function(e) {
        if (e.target === chatSettingsModal) closeChatSettings();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeChatSettings();
        }
    });
}

// Update send button state
function updateSendButtonState() {
    const hasText = chatInput.value.trim().length > 0;
    const model = chatModel.value;
    const isGemini = isGeminiModel(model);

    // Gemini models require Gemini account, Claude models require Kiro account or API endpoint
    let canChat = false;
    if (isGemini) {
        canChat = currentGeminiAccountId !== null;
    } else {
        canChat = chatApiEndpoint || currentChatAccountId !== null;
    }

    chatSendBtn.disabled = !hasText || isStreaming || !canChat;
}

// Send message
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || isStreaming) return;

    // Add user message to UI
    addMessageToUI('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendButtonState();

    // Add to history
    chatHistory.push({ role: 'user', content: message });

    // Show typing indicator
    const typingEl = addTypingIndicator();
    isStreaming = true;
    updateSendButtonState();

    try {
        const model = chatModel.value;
        const isGemini = isGeminiModel(model);
        let response;

        if (isGemini && currentGeminiAccountId) {
            // Gemini models use Gemini API
            response = await fetch('/api/gemini/chat/' + currentGeminiAccountId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1)
                })
            });
        } else if (chatApiEndpoint) {
            response = await fetch('/api/claude-proxy/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1),
                    apiKey: chatApiKey,
                    endpoint: chatApiEndpoint
                })
            });
        } else if (currentChatAccountId) {
            response = await fetch('/api/chat/' + currentChatAccountId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1)
                })
            });
        } else {
            throw new Error(isGemini ? 'Please select a Gemini account first' : 'Please set API endpoint or select an account first');
        }

        typingEl.remove();

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Request failed');
        }

        // Process SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let messageEl = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            assistantMessage += data.content;
                            if (!messageEl) {
                                messageEl = addMessageToUI('assistant', assistantMessage);
                            } else {
                                updateMessageContent(messageEl, assistantMessage);
                            }
                            scrollToBottom();
                        }
                        if (data.error) {
                            throw new Error(data.error);
                        }
                    } catch (e) {
                        if (e.message !== 'Unexpected end of JSON input') {
                            console.error('Parse error:', e);
                        }
                    }
                }
            }
        }

        if (assistantMessage) {
            chatHistory.push({ role: 'assistant', content: assistantMessage });
        }

    } catch (err) {
        if (typingEl && typingEl.parentNode) typingEl.remove();
        showToast('Send failed: ' + err.message, 'error');
        chatHistory.pop();
    } finally {
        isStreaming = false;
        updateSendButtonState();
    }
}

// Add message to UI
function addMessageToUI(role, content) {
    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const messageEl = document.createElement('div');
    messsName = 'chat-message ' + role;

    const avatarText = role === 'user' ? 'U' : 'AI';
    messageEl.innerHTML = '<div class="chat-message-avatar">' + avatarText + '</div>' +
        '<div class="chat-message-content">' + formatMessageContent(content) + '</div>';

    chatMessages.appendChild(messageEl);
    scrollToBottom();

    return messageEl;
}

// Update message content
function updateMessageContent(messageEl, content) {
    const contentEl = messageEl.querySelector('.chat-message-content');
    if (contentEl) {
        contentEl.innerHTML = formatMessageContent(content);
    }
}

// Format message content
function formatMessageContent(content) {
    // Simple Markdown processing
    let html = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    return html;
}

// Add typing indicator
function addTypingIndicator() {
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-typing';
    typingEl.innerHTML = '<div class="chat-typing-dots"><span></span><span></span><span></span></div><span>Thinking...</span>';
    chatMessages.appendChild(typingEl);
    scrollToBottom();
    return typingEl;
}

// Scroll to bottom
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Clear chat
function clearChat() {
    chatHistory = [];
    chatMessages.innerHTML = '<div class="chat-welcome">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '</svg>' +
        '<h3>Start Conversation</h3>' +
        '<p>Enter a message to start chatting with Claude</p>' +
        '</div>';
    showToast('Chat cleared', 'success');
}

// Settings modal
function openChatSettings() {
    document.getElementById('chat-api-endpoint').value = chatApiEndpoint;
    document.getElementById('chat-api-key').value = chatApiKey;
    chatSettingsModal.classList.add('active');
}

function closeChatSettings() {
    chatSettingsModal.classList.remove('active');
}

function saveChatSettings() {
    chatApiEndpoint = document.getElementById('chat-api-endpoint').value.trim();
    chatApiKey = document.getElementById('chaey').value.trim();
    localStorage.setItem('chatApiEndpoint', chatApiEndpoint);
    localStorage.setItem('chatApiKey', chatApiKey);
    closeChatSettings();
    showToast('API settings saved', 'success');
    updateSendButtonState();
}
