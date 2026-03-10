class Display {
    constructor() {
        // Elements
        this.statusEl = document.getElementById('connection-status');
        this.statusText = this.statusEl.querySelector('.status-text');
        this.positionEl = document.getElementById('cursor-position');
        this.scrollArea = document.getElementById('scroll-area');

        // Cursor state
        this.cursorX = window.innerWidth / 2;
        this.cursorY = window.innerHeight / 2;
        this.isConnected = false;

        // Cursor elements (we'll create our own)
        this.cursorOuter = null;
        this.cursorInner = null;
        this.cursorText = null;

        // Animation state
        this.currentX = this.cursorX;
        this.currentY = this.cursorY;

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;

        this.init();
    }

    init() {
        this.createCursor();
        this.connectWebSocket();
        this.bindEvents();
        this.startRenderLoop();
    }

    // ==================== Custom Cursor Setup ====================

    createCursor() {
        // Create cursor container
        const cursor = document.createElement('div');
        cursor.className = 'custom-cursor';
        cursor.innerHTML = `
            <div class="cursor-outer"></div>
            <div class="cursor-inner"></div>
            <div class="cursor-text"></div>
        `;
        document.body.appendChild(cursor);

        this.cursorEl = cursor;
        this.cursorOuter = cursor.querySelector('.cursor-outer');
        this.cursorInner = cursor.querySelector('.cursor-inner');
        this.cursorText = cursor.querySelector('.cursor-text');

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .custom-cursor {
                position: fixed;
                top: 0;
                left: 0;
                pointer-events: none;
                z-index: 99999;
                will-change: transform;
            }
            .cursor-outer {
                position: absolute;
                width: 40px;
                height: 40px;
                border: 1px solid rgba(255, 255, 255, 0.5);
                border-radius: 50%;
                transform: translate(-50%, -50%);
                transition: width 0.3s, height 0.3s, background 0.3s;
            }
            .cursor-inner {
                position: absolute;
                width: 8px;
                height: 8px;
                background: #fff;
                border-radius: 50%;
                transform: translate(-50%, -50%);
                transition: transform 0.1s;
            }
            .cursor-text {
                position: absolute;
                transform: translate(-50%, -50%);
                color: #fff;
                font-size: 12px;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                transition: opacity 0.2s;
            }
            .custom-cursor.pointer .cursor-outer {
                width: 50px;
                height: 50px;
                background: rgba(255, 255, 255, 0.1);
            }
            .custom-cursor.clicking .cursor-inner {
                transform: translate(-50%, -50%) scale(0.5);
            }
            .custom-cursor.clicking .cursor-outer {
                transform: translate(-50%, -50%) scale(0.8);
            }
            .custom-cursor.has-text .cursor-outer {
                width: 80px;
                height: 80px;
                background: rgba(74, 158, 255, 0.9);
                border-color: transparent;
            }
            .custom-cursor.has-text .cursor-inner {
                opacity: 0;
            }
            .custom-cursor.has-text .cursor-text {
                opacity: 1;
            }
            .custom-cursor.magnetic .cursor-outer {
                width: 60px;
                height: 60px;
                background: rgba(74, 158, 255, 0.2);
            }
        `;
        document.head.appendChild(style);

        // Set initial position
        this.updateCursorPosition();
    }

    startRenderLoop() {
        const render = () => {
            // Smooth interpolation (easing)
            const ease = 0.15;
            this.currentX += (this.cursorX - this.currentX) * ease;
            this.currentY += (this.cursorY - this.currentY) * ease;

            // Apply position
            this.cursorEl.style.transform = `translate3d(${this.currentX}px, ${this.currentY}px, 0)`;

            // Calculate velocity for skewing
            const velocityX = this.cursorX - this.currentX;
            const velocityY = this.cursorY - this.currentY;
            const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
            const angle = Math.atan2(velocityY, velocityX) * (180 / Math.PI);

            // Apply skew based on velocity
            const skewAmount = Math.min(speed * 0.5, 20);
            this.cursorOuter.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scaleX(${1 + skewAmount * 0.02}) scaleY(${1 - skewAmount * 0.01})`;

            // Update position display
            this.updatePositionDisplay();

            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    updateCursorPosition() {
        this.cursorEl.style.transform = `translate3d(${this.cursorX}px, ${this.cursorY}px, 0)`;
    }

    // ==================== WebSocket ====================

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        console.log('Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to server');
            this.reconnectAttempts = 0;

            // Register as display
            this.send({
                type: 'register',
                clientType: 'display'
            });
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('Received:', data);
            this.handleMessage(data);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.updateStatus(false, 'Disconnected');
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < 10) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 5000);
            setTimeout(() => this.connectWebSocket(), delay);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    // ==================== Message Handling ====================

    handleMessage(data) {
        switch (data.type) {
            case 'registered':
                this.updateStatus(true, 'Waiting for trackpad...');
                break;

            case 'move':
                this.handleMove(data.deltaX, data.deltaY);
                break;

            case 'click':
                this.handleClick(data.button);
                break;

            case 'doubleclick':
                this.handleDoubleClick();
                break;

            case 'scroll':
                this.handleScroll(data.deltaX, data.deltaY);
                break;
        }

        // Update connection status when receiving trackpad data
        if (data.type === 'move' || data.type === 'click' || data.type === 'scroll') {
            this.updateStatus(true, 'Trackpad connected');
        }
    }

    handleMove(deltaX, deltaY) {
        // Update cursor position
        this.cursorX = Math.max(0, Math.min(window.innerWidth, this.cursorX + deltaX));
        this.cursorY = Math.max(0, Math.min(window.innerHeight, this.cursorY + deltaY));

        this.checkHoverState();
    }

    handleClick(button = 'left') {
        // Visual feedback
        this.cursorEl.classList.add('clicking');
        setTimeout(() => this.cursorEl.classList.remove('clicking'), 150);

        // Find element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            console.log('Clicking on:', element);
            
            if (button === 'left') {
                // Simulate click
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY,
                    view: window
                });
                element.dispatchEvent(clickEvent);

                // Also trigger focus for interactive elements
                if (element.matches('button, a, input, select, textarea, [tabindex]')) {
                    element.focus();
                }
            } else if (button === 'right') {
                const contextEvent = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY
                });
                element.dispatchEvent(contextEvent);
            }
        }
    }

    handleDoubleClick() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            const dblClickEvent = new MouseEvent('dblclick', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            element.dispatchEvent(dblClickEvent);
        }
    }

    handleScroll(deltaX, deltaY) {
        // Find scrollable element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        const scrollable = this.findScrollableParent(element);

        if (scrollable) {
            scrollable.scrollBy({
                top: deltaY,
                left: deltaX,
                behavior: 'auto'
            });
        } else {
            // Scroll the main window
            window.scrollBy({
                top: deltaY,
                left: deltaX,
                behavior: 'auto'
            });
        }

        // Content moved under cursor — re-check what we're hovering
        this.checkHoverState();
    }

    findScrollableParent(element) {
        while (element && element !== document.body) {
            const style = window.getComputedStyle(element);
            const overflowY = style.overflowY;
            const overflowX = style.overflowX;

            if (
                (overflowY === 'auto' || overflowY === 'scroll') &&
                element.scrollHeight > element.clientHeight
            ) {
                return element;
            }

            if (
                (overflowX === 'auto' || overflowX === 'scroll') &&
                element.scrollWidth > element.clientWidth
            ) {
                return element;
            }

            element = element.parentElement;
        }
        return null;
    }

    // ==================== Hover State Detection ====================

    checkHoverState() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (!element) return;

        // Check for interactive elements
        const isInteractive = element.matches('a, button, .demo-btn, .demo-link, .card, .image-item, [data-cursor-stick], [data-cursor-text]');
        
        if (isInteractive) {
            this.cursorEl.classList.add('pointer');
        } else {
            this.cursorEl.classList.remove('pointer');
        }

        // Check for cursor text
        const textEl = element.closest('[data-cursor-text]');
        if (textEl) {
            const text = textEl.getAttribute('data-cursor-text');
            this.cursorText.textContent = text;
            this.cursorEl.classList.add('has-text');
        } else {
            this.cursorEl.classList.remove('has-text');
        }

        // Check for magnetic/sticky
        const stickyEl = element.closest('[data-cursor-stick]');
        if (stickyEl) {
            this.cursorEl.classList.add('magnetic');
            
            // Pull cursor toward element center
            const rect = stickyEl.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            // Magnetic effect - gently pull toward center
            this.cursorX += (centerX - this.cursorX) * 0.1;
            this.cursorY += (centerY - this.cursorY) * 0.1;
        } else {
            this.cursorEl.classList.remove('magnetic');
        }

        // Trigger mouseenter/mouseleave
        this.simulateHover(element);
    }

    simulateHover(element) {
        const prev = this.lastHoveredElement;

        if (prev === element) return;

        // --- Leave the previous element and its ancestors ---
        if (prev) {
            // Remove .is-hovered from prev and all its ancestors
            let el = prev;
            while (el && el !== document.documentElement) {
                el.classList.remove('is-hovered');
                el = el.parentElement;
            }

            // mouseout bubbles (useful for delegated listeners)
            prev.dispatchEvent(new MouseEvent('mouseout', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: element,
                view: window
            }));

            // mouseleave does NOT bubble — fire on prev and each ancestor
            // that the new element is NOT inside of
            let leaveTarget = prev;
            while (leaveTarget && leaveTarget !== document.documentElement) {
                if (element && leaveTarget.contains(element)) break;
                leaveTarget.dispatchEvent(new MouseEvent('mouseleave', {
                    bubbles: false,
                    cancelable: false,
                    clientX: this.cursorX,
                    clientY: this.cursorY,
                    relatedTarget: element,
                    view: window
                }));
                leaveTarget = leaveTarget.parentElement;
            }
        }

        // --- Enter the new element and its ancestors ---
        if (element) {
            // Add .is-hovered to element and all ancestors
            let el = element;
            while (el && el !== document.documentElement) {
                el.classList.add('is-hovered');
                el = el.parentElement;
            }

            // mouseover bubbles
            element.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: prev,
                view: window
            }));

            // mouseenter does NOT bubble — fire on element and each ancestor
            // that the previous element was NOT inside of
            let enterTarget = element;
            while (enterTarget && enterTarget !== document.documentElement) {
                if (prev && enterTarget.contains(prev)) break;
                enterTarget.dispatchEvent(new MouseEvent('mouseenter', {
                    bubbles: false,
                    cancelable: false,
                    clientX: this.cursorX,
                    clientY: this.cursorY,
                    relatedTarget: prev,
                    view: window
                }));
                enterTarget = enterTarget.parentElement;
            }
        }

        this.lastHoveredElement = element;
    }

    // ==================== UI Updates ====================

    updateStatus(connected, message) {
        this.isConnected = connected;
        this.statusEl.className = connected ? 'connected' : 'disconnected';
        this.statusText.textContent = message;
    }

    updatePositionDisplay() {
        this.positionEl.textContent = `X: ${Math.round(this.cursorX)} | Y: ${Math.round(this.cursorY)}`;
    }

    // ==================== Event Binding ====================

    bindEvents() {
        // Handle window resize
        window.addEventListener('resize', () => {
            this.cursorX = Math.min(this.cursorX, window.innerWidth);
            this.cursorY = Math.min(this.cursorY, window.innerHeight);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.display = new Display();
});
