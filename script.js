class LongPollingChat {
    constructor() {
        this.serverUrl = 'longpoll.php';
        this.lastUpdate = 0;
        this.isPolling = false;
        this.pollTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        
        this.initializeElements();
        this.bindEvents();
        this.startPolling();
        
        console.log('🚀 Long Polling Chat initialized');
    }
    
    initializeElements() {
        this.elements = {
            messages: document.getElementById('messages'),
            messageInput: document.getElementById('message-input'),
            sendButton: document.getElementById('send-button'),
            username: document.getElementById('username'),
            connectionStatus: document.getElementById('connection-status'),
            userCount: document.getElementById('user-count')
        };
        
        // Validate all elements exist
        Object.entries(this.elements).forEach(([key, element]) => {
            if (!element) {
                console.error(`Element not found: ${key}`);
            }
        });
    }
    
    bindEvents() {
        // Send button click
        this.elements.sendButton.addEventListener('click', () => this.sendMessage());
        
        // Enter key in message input
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Auto-resize message input (optional enhancement)
        this.elements.messageInput.addEventListener('input', () => {
            this.elements.messageInput.style.height = 'auto';
            this.elements.messageInput.style.height = this.elements.messageInput.scrollHeight + 'px';
        });
        
        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else {
                this.startPolling();
            }
        });
        
        // Handle page unload
        window.addEventListener('beforeunload', () => {
            this.stopPolling();
        });
    }
    
    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        const username = this.elements.username.value.trim() || 'Anonymous';
        
        if (!message) {
            this.elements.messageInput.focus();
            return;
        }
        
        // Disable send button temporarily
        this.elements.sendButton.disabled = true;
        this.elements.sendButton.textContent = 'Sending...';
        
        try {
            const response = await fetch(this.serverUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    user: username
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.status === 'success') {
                // Clear input
                this.elements.messageInput.value = '';
                this.elements.messageInput.style.height = 'auto';
                
                // Add message immediately to UI for better UX
                this.displayMessage(result.message);
                
                // Update last update time
                this.lastUpdate = Math.floor(Date.now() / 1000);
                
                console.log('✅ Message sent successfully');
            } else {
                throw new Error(result.message || 'Failed to send message');
            }
            
        } catch (error) {
            console.error('❌ Error sending message:', error);
            this.showSystemMessage(`Error sending message: ${error.message}`, 'error');
        } finally {
            // Re-enable send button
            this.elements.sendButton.disabled = false;
            this.elements.sendButton.textContent = 'Send';
            this.elements.messageInput.focus();
        }
    }
    
    async startPolling() {
        if (this.isPolling) {
            console.log('⚠️ Polling already active');
            return;
        }
        
        this.isPolling = true;
        this.updateConnectionStatus('connected');
        console.log('🔄 Starting long polling...');
        
        await this.poll();
    }
    
    stopPolling() {
        this.isPolling = false;
        
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
            this.pollTimeout = null;
        }
        
        this.updateConnectionStatus('disconnected');
        console.log('⏹️ Stopped long polling');
    }
    
    async poll() {
        if (!this.isPolling) return;
        
        try {
            this.updateConnectionStatus('connected');
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000); // 35 second timeout
            
            const response = await fetch(`${this.serverUrl}?lastUpdate=${this.lastUpdate}`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.status === 'success' && result.messages.length > 0) {
                // Display new messages
                result.messages.forEach(message => {
                    this.displayMessage(message);
                });
                
                // Update last update time
                this.lastUpdate = result.lastUpdate;
                
                console.log(`📨 Received ${result.messages.length} new message(s)`);
            } else if (result.status === 'timeout') {
                console.log('⏰ Long polling timeout, reconnecting...');
            }
            
            // Reset reconnection attempts on successful response
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('🔄 Request aborted, reconnecting...');
            } else {
                console.error('❌ Polling error:', error);
                this.handleConnectionError();
            }
        }
        
        // Schedule next poll if still active
        if (this.isPolling) {
            this.scheduleNextPoll();
        }
    }
    
    scheduleNextPoll() {
        const delay = this.reconnectAttempts > 0 ? this.reconnectDelay : 100; // Immediate retry for normal operation
        
        this.pollTimeout = setTimeout(() => {
            this.poll();
        }, delay);
    }
    
    handleConnectionError() {
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            this.updateConnectionStatus('error');
            this.showSystemMessage('Connection lost. Please refresh the page.', 'error');
            this.stopPolling();
            return;
        }
        
        this.updateConnectionStatus('connecting');
        
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30 seconds
        
        console.log(`🔄 Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    }
    
    displayMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-user">${this.escapeHtml(message.user)}</span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-content">${this.escapeHtml(message.message)}</div>
        `;
        
        this.elements.messages.appendChild(messageElement);
        
        // Auto-scroll to bottom
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
        
        // Remove old messages if too many (keep last 50)
        const messages = this.elements.messages.querySelectorAll('.message');
        if (messages.length > 50) {
            messages[0].remove();
        }
    }
    
    showSystemMessage(message, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.className = `system-message system-${type}`;
        messageElement.textContent = message;
        
        this.elements.messages.appendChild(messageElement);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
        
        // Auto-remove system messages after 5 seconds
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.remove();
            }
        }, 5000);
    }
    
    updateConnectionStatus(status) {
        const statusElement = this.elements.connectionStatus;
        
        // Remove all status classes
        statusElement.classList.remove('connected', 'connecting', 'error');
        statusElement.classList.add(status);
        
        const statusMessages = {
            connected: '🟢 Connected',
            connecting: '🟡 Connecting...',
            disconnected: '🔴 Disconnected',
            error: '🔴 Connection Error'
        };
        
        statusElement.textContent = statusMessages[status] || statusMessages.disconnected;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Public methods for external control
    reconnect() {
        console.log('🔄 Manual reconnection requested');
        this.stopPolling();
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        setTimeout(() => this.startPolling(), 1000);
    }
    
    getStatus() {
        return {
            isPolling: this.isPolling,
            lastUpdate: this.lastUpdate,
            reconnectAttempts: this.reconnectAttempts
        };
    }
}

// Utility functions
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Initialize the chat when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new LongPollingChat();
    
    // Add some helpful console commands
    console.log('🎮 Available commands:');
    console.log('chatApp.reconnect() - Manually reconnect');
    console.log('chatApp.getStatus() - Get connection status');
    console.log('chatApp.stopPolling() - Stop long polling');
    console.log('chatApp.startPolling() - Start long polling');
});

// Handle errors globally
window.addEventListener('error', (event) => {
    console.error('💥 Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('💥 Unhandled promise rejection:', event.reason);
});