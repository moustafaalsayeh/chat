class LongPollingChat {
    constructor() {
        this.serverUrl = 'longpoll.php';
        this.lastUpdate = 0;
        this.isPolling = false;
        this.pollTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // Start with 1 second
        
        // Performance optimizations
        this.messageCache = new Map(); // Cache messages to prevent duplicates
        this.performanceMetrics = {
            requestCount: 0,
            totalResponseTime: 0,
            averageResponseTime: 0,
            lastResponseTime: 0
        };
        this.maxDOMMessages = 50; // Limit DOM messages for performance
        this.debounceTimeout = null;
        
        // Request pooling and reuse
        this.abortController = null;
        
        this.initializeElements();
        this.bindEvents();
        this.startPolling();
        
        console.log('🚀 Long Polling Chat initialized with performance optimizations');
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
        
        // Performance dashboard toggle
        const perfToggle = document.getElementById('performance-toggle');
        if (perfToggle) {
            perfToggle.addEventListener('click', () => {
                const dashboard = document.getElementById('performance-dashboard');
                if (dashboard) {
                    const isVisible = dashboard.style.display !== 'none';
                    dashboard.style.display = isVisible ? 'none' : 'block';
                    perfToggle.classList.toggle('active', !isVisible);
                }
            });
        }
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
        
        const requestStartTime = performance.now();
        
        try {
            this.updateConnectionStatus('connected');
            
            // Reuse abort controller for better performance
            if (this.abortController) {
                this.abortController.abort();
            }
            this.abortController = new AbortController();
            
            const timeoutId = setTimeout(() => this.abortController.abort(), 30000); // Reduced timeout
            
            const response = await fetch(`${this.serverUrl}?lastUpdate=${this.lastUpdate}`, {
                method: 'GET',
                signal: this.abortController.signal,
                // Performance optimizations
                cache: 'no-cache',
                keepalive: true
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            // Update performance metrics
            const responseTime = performance.now() - requestStartTime;
            this.updatePerformanceMetrics(responseTime);
            
            // Log server performance if available
            if (result.performance) {
                console.log(`⚡ Server execution: ${result.performance.execution_time_ms}ms, Client total: ${responseTime.toFixed(2)}ms`);
            }
            
            if (result.status === 'success' && result.messages.length > 0) {
                // Batch process messages for better performance
                this.batchDisplayMessages(result.messages);
                
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
    
    // Performance metrics tracking
    updatePerformanceMetrics(responseTime) {
        this.performanceMetrics.requestCount++;
        this.performanceMetrics.totalResponseTime += responseTime;
        this.performanceMetrics.lastResponseTime = responseTime;
        this.performanceMetrics.averageResponseTime = 
            this.performanceMetrics.totalResponseTime / this.performanceMetrics.requestCount;
    }
    
    // Optimized batch message display
    batchDisplayMessages(messages) {
        const fragment = document.createDocumentFragment();
        
        messages.forEach(message => {
            // Skip if already displayed (prevent duplicates)
            if (this.messageCache.has(message.id)) {
                return;
            }
            
            this.messageCache.set(message.id, true);
            const messageElement = this.createMessageElement(message);
            fragment.appendChild(messageElement);
        });
        
        // Single DOM update for all messages
        this.elements.messages.appendChild(fragment);
        
        // Cleanup old messages and cache
        this.cleanupOldMessages();
        
        // Auto-scroll to bottom (debounced)
        this.debouncedScrollToBottom();
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
    
    // Optimized message element creation
    createMessageElement(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.dataset.messageId = message.id; // For efficient cleanup
        
        // Use template literals for better performance
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-user">${this.escapeHtml(message.user)}</span>
                <span class="message-time">${message.timestamp}</span>
            </div>
            <div class="message-content">${this.escapeHtml(message.message)}</div>
        `;
        
        return messageElement;
    }
    
    // Legacy method for backward compatibility
    displayMessage(message) {
        if (this.messageCache.has(message.id)) {
            return; // Prevent duplicates
        }
        
        this.messageCache.set(message.id, true);
        const messageElement = this.createMessageElement(message);
        this.elements.messages.appendChild(messageElement);
        
        this.cleanupOldMessages();
        this.debouncedScrollToBottom();
    }
    
    // Optimized cleanup of old messages
    cleanupOldMessages() {
        const messages = this.elements.messages.querySelectorAll('.message');
        if (messages.length > this.maxDOMMessages) {
            const toRemove = messages.length - this.maxDOMMessages;
            for (let i = 0; i < toRemove; i++) {
                const messageId = messages[i].dataset.messageId;
                if (messageId) {
                    this.messageCache.delete(messageId);
                }
                messages[i].remove();
            }
        }
    }
    
    // Debounced scroll to bottom
    debouncedScrollToBottom() {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        
        this.debounceTimeout = setTimeout(() => {
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
        }, 50); // 50ms debounce
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
            reconnectAttempts: this.reconnectAttempts,
            performance: this.performanceMetrics,
            cacheSize: this.messageCache.size
        };
    }
    
    // Performance monitoring methods
    getPerformanceReport() {
        const memoryInfo = performance.memory || {};
        return {
            ...this.performanceMetrics,
            memoryUsage: {
                usedJSHeapSize: memoryInfo.usedJSHeapSize || 'N/A',
                totalJSHeapSize: memoryInfo.totalJSHeapSize || 'N/A',
                jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit || 'N/A'
            },
            cacheStats: {
                messagesCached: this.messageCache.size,
                maxDOMMessages: this.maxDOMMessages
            },
            connectionStats: {
                reconnectAttempts: this.reconnectAttempts,
                maxReconnectAttempts: this.maxReconnectAttempts,
                currentDelay: this.reconnectDelay
            }
        };
    }
    
    // Enable/disable performance logging
    enablePerformanceLogging() {
        this.performanceLogging = true;
        console.log('📊 Performance logging enabled');
    }
    
    disablePerformanceLogging() {
        this.performanceLogging = false;
        console.log('📊 Performance logging disabled');
    }
    
    // Clear performance metrics
    resetPerformanceMetrics() {
        this.performanceMetrics = {
            requestCount: 0,
            totalResponseTime: 0,
            averageResponseTime: 0,
            lastResponseTime: 0
        };
        console.log('🧹 Performance metrics reset');
    }
}

// Utility functions
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Performance monitoring dashboard
function createPerformanceDashboard() {
    const dashboard = document.createElement('div');
    dashboard.id = 'performance-dashboard';
    dashboard.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 12px;
        z-index: 1000;
        min-width: 200px;
        display: none;
    `;
    
    document.body.appendChild(dashboard);
    
    // Update dashboard every 5 seconds
    setInterval(() => {
        if (window.chatApp && dashboard.style.display !== 'none') {
            const report = window.chatApp.getPerformanceReport();
            dashboard.innerHTML = `
                <div style="margin-bottom: 8px; font-weight: bold;">📊 Performance Monitor</div>
                <div>Requests: ${report.requestCount}</div>
                <div>Avg Response: ${report.averageResponseTime.toFixed(2)}ms</div>
                <div>Last Response: ${report.lastResponseTime.toFixed(2)}ms</div>
                <div>Cache Size: ${report.cacheStats.messagesCached}</div>
                <div>Memory: ${formatBytes(report.memoryUsage.usedJSHeapSize)}</div>
                <div>Reconnects: ${report.connectionStats.reconnectAttempts}</div>
            `;
        }
    }, 5000);
    
    return dashboard;
}

function formatBytes(bytes) {
    if (bytes === 'N/A') return 'N/A';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Initialize the chat when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new LongPollingChat();
    window.performanceDashboard = createPerformanceDashboard();
    
    // Add some helpful console commands
    console.log('🎮 Enhanced commands available:');
    console.log('chatApp.reconnect() - Manually reconnect');
    console.log('chatApp.getStatus() - Get connection status');
    console.log('chatApp.getPerformanceReport() - Get detailed performance report');
    console.log('chatApp.resetPerformanceMetrics() - Reset performance counters');
    console.log('chatApp.enablePerformanceLogging() - Enable performance logging');
    console.log('chatApp.disablePerformanceLogging() - Disable performance logging');
    console.log('performanceDashboard.style.display = "block" - Show performance dashboard');
    console.log('performanceDashboard.style.display = "none" - Hide performance dashboard');
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