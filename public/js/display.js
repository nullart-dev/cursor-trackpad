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

        // Mouse follower instance
        this.cursor = null;
        this.cursorEl = null;

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;

        // Hover tracking
        this.lastHoveredElement = null;
        this.wasSticking = false;
        this.hadText = false;
        this.hadImg = false;

        this.init();
    }

    init() {
        this.initMouseFollower();
        this.connectWebSocket();
        this.bindEvents();
    }

    // ==================== Mouse Follower Setup ====================

    initMouseFollower() {
        // Register GSAP with MouseFollower
        MouseFollower.registerGSAP(gsap);

        // Create cursor instance
        this.cursor = new MouseFollower({
            speed: 0.55,
            ease: 'expo.out',
            skewing: 2,
            skewingText: 2,
            skewingIcon: 2,
            skewingMedia: 2,
            skewingDelta: 0.001,
            skewingDeltaMax: 0.15,
            stickDelta: 0.15,
            showTimeout: 0,
            hideOnLeave: false,
            stateDetection: {
                '-pointer': 'a, button, .demo-btn, .demo-link, .card, .image-item',
            }
        });

        // Get cursor element reference
        this.cursorEl = document.querySelector('.mf-cursor');

        // Set initial position immediately (no animation)
        if (this.cursorEl) {
            gsap.set(this.cursorEl, { x: this.cursorX, y: this.cursorY });
        }

        // Listen to cursor events
        this.cursor.on('render', () => {
            this.updatePositionDisplay();
        });
    }

    // ==================== WebSocket ====================

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

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
        if (data.type === 'move' || data.type === 'click') {
            this.updateStatus(true, 'Trackpad connected');
        }
    }

    handleMove(deltaX, deltaY) {
        // Update cursor position
        this.cursorX = Math.max(0, Math.min(window.innerWidth, this.cursorX + deltaX));
        this.cursorY = Math.max(0, Math.min(window.innerHeight, this.cursorY + deltaY));

        this.moveCursor(this.cursorX, this.cursorY);
        this.checkHoverState();
    }

    handleClick(button = 'left') {
        // Visual feedback
        this.cursor.addState('-active');
        setTimeout(() => this.cursor.removeState('-active'), 150);

        // Find element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            if (button === 'left') {
                // Simulate click
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY
                });
                element.dispatchEvent(clickEvent);

                // Also trigger focus for interactive elements
                if (element.matches('button, a, input, select, textarea')) {
                    element.focus();
                }
            } else if (button === 'right') {
                // Simulate context menu (optional)
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

    // ==================== Cursor Movement ====================

    moveCursor(x, y) {
        if (!this.cursorEl) {
            this.cursorEl = document.querySelector('.mf-cursor');
        }
        
        if (this.cursorEl) {
            // Kill any existing animations to prevent conflicts
            gsap.killTweensOf(this.cursorEl);
            
            // Animate to new position from CURRENT position (not from 0,0)
            gsap.to(this.cursorEl, {
                x: x,
                y: y,
                duration: 0.15,  // Shorter duration for more responsive feel
                ease: 'power2.out',
                overwrite: 'auto'  // Automatically handle conflicting tweens
            });
        }
    }

    // ==================== Hover State Detection ====================

    checkHoverState() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (!element) return;

        // Trigger mouseenter/mouseleave for state detection
        this.simulateHover(element);

        // Check for data attributes
        this.checkCursorAttributes(element);
    }

    simulateHover(element) {
        // Store last hovered element
        if (this.lastHoveredElement && this.lastHoveredElement !== element) {
            // Mouse leave old element
            const leaveEvent = new MouseEvent('mouseleave', {
                bubbles: false,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            this.lastHoveredElement.dispatchEvent(leaveEvent);
            
            // Also dispatch mouseout for bubbling
            const outEvent = new MouseEvent('mouseout', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: element
            });
            this.lastHoveredElement.dispatchEvent(outEvent);
        }

        if (element !== this.lastHoveredElement) {
            // Mouse enter new element
            const enterEvent = new MouseEvent('mouseenter', {
                bubbles: false,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY
            });
            element.dispatchEvent(enterEvent);
            
            // Also dispatch mouseover for bubbling
            const overEvent = new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: this.lastHoveredElement
            });
            element.dispatchEvent(overEvent);
        }

        this.lastHoveredElement = element;
    }

    checkCursorAttributes(element) {
        // Walk up the DOM to find cursor attributes
        let current = element;
        let foundStick = false;
        let foundText = null;
        let foundImg = null;
        let foundState = null;

        while (current && current !== document.body) {
            // Check for stick
            if (current.hasAttribute('data-cursor-stick') && !foundStick) {
                foundStick = true;
                const stickTarget = current.getAttribute('data-cursor-stick');
                const target = stickTarget ? document.querySelector(stickTarget) : current;
                this.cursor.setStick(target);
            }

            // Check for text
            if (current.hasAttribute('data-cursor-text') && !foundText) {
                foundText = current.getAttribute('data-cursor-text');
                this.cursor.setText(foundText);
            }

            // Check for image
            if (current.hasAttribute('data-cursor-img') && !foundImg) {
                foundImg = current.getAttribute('data-cursor-img');
                this.cursor.setImg(foundImg);
            }

            // Check for custom state (like -inverse)
            if (current.hasAttribute('data-cursor') && !foundState) {
                foundState = current.getAttribute('data-cursor');
                this.cursor.addState(foundState);
            }

            current = current.parentElement;
        }

        // Clear states if not found
        if (!foundStick && this.wasSticking) {
            this.cursor.removeStick();
        }
        if (!foundText && this.hadText) {
            this.cursor.removeText();
        }
        if (!foundImg && this.hadImg) {
            this.cursor.removeImg();
        }
        if (!foundState && this.hadState) {
            this.cursor.removeState(this.hadState);
        }

        this.wasSticking = foundStick;
        this.hadText = !!foundText;
        this.hadImg = !!foundImg;
        this.hadState = foundState;
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
            // Keep cursor in bounds
            this.cursorX = Math.min(this.cursorX, window.innerWidth);
            this.cursorY = Math.min(this.cursorY, window.innerHeight);
        });

        // Prevent default cursor on everything
        document.addEventListener('mousemove', (e) => {
            // Optional: sync with real mouse for testing
            // this.cursorX = e.clientX;
            // this.cursorY = e.clientY;
            // this.moveCursor(this.cursorX, this.cursorY);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Display();
});
