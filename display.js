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

    // Selector for elements that should receive .is-hovered
    static HOVERABLE_SELECTOR = 'a, button, .demo-btn, .demo-link, .card, .image-item, [data-cursor-stick], [data-cursor-text], [data-cursor]';

    checkHoverState() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (!element) {
            this.cursorEl.classList.remove('pointer');
            this.cursorEl.classList.remove('has-text');
            this.cursorEl.classList.remove('magnetic');
            this.simulateHover(null);
            return;
        }

        // Check for interactive elements (use closest so children of cards etc. still match)
        const interactive = element.closest(Display.HOVERABLE_SELECTOR);
        
        if (interactive) {
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

        // Trigger hover — pass the resolved hoverable target (not the raw leaf element)
        // so that moving between <h3> and <p> inside the same .card doesn't cause flicker
        this.simulateHover(interactive || element);
    }

    simulateHover(element) {
        const prev = this.lastHoveredElement;

        if (prev === element) return;

        // --- Collect all hoverable ancestors for old and new elements ---
        const getHoverTargets = (el) => {
            const targets = new Set();
            while (el && el !== document.documentElement) {
                targets.add(el);
                // Also find any hoverable ancestors above this element
                const parent = el.parentElement;
                if (parent) {
                    const hoverableParent = parent.closest(Display.HOVERABLE_SELECTOR);
                    if (hoverableParent) {
                        let p = el;
                        while (p && p !== document.documentElement) {
                            targets.add(p);
                            p = p.parentElement;
                        }
                        break;
                    }
                }
                el = el.parentElement;
            }
            return targets;
        };

        const prevTargets = prev ? getHoverTargets(prev) : new Set();
        const newTargets = element ? getHoverTargets(element) : new Set();

        // Remove .is-hovered from elements no longer hovered
        for (const el of prevTargets) {
            if (!newTargets.has(el)) {
                el.classList.remove('is-hovered');
            }
        }

        // Add .is-hovered to newly hovered elements
        for (const el of newTargets) {
            el.classList.add('is-hovered');
        }

        // --- Dispatch mouse events ---
        if (prev) {
            // mouseout bubbles
            prev.dispatchEvent(new MouseEvent('mouseout', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: element,
                view: window
            }));

            // mouseleave doesn't bubble — fire up the tree until shared ancestor
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

        if (element) {
            // mouseover bubbles
            element.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: prev,
                view: window
            }));

            // mouseenter doesn't bubble — fire up the tree until shared ancestor
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
