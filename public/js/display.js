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

        // Hover tracking
        this.lastHoveredElement = null;
        this.currentStickTarget = null;
        this.currentTextTarget = null;
        this.currentImgTarget = null;
        this.currentStateTarget = null;

        // Smooth scrolling
        this.scrollVelocityX = 0;
        this.scrollVelocityY = 0;
        this.scrollFriction = 0.92;
        this.scrollMultiplier = 2.5;
        this.isScrolling = false;
        this.currentScrollTarget = null;

        // Mouse follower instance
        this.cursor = null;

        // WebSocket
        this.ws = null;
        this.reconnectAttempts = 0;

        this.init();
    }

    init() {
        this.initMouseFollower();
        this.connectWebSocket();
        this.bindEvents();
        this.startScrollLoop();
        this.startHoverLoop();
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
            stateDetection: false  // We'll handle this manually for virtual cursor
        });

        // Set initial position
        this.moveCursor(this.cursorX, this.cursorY);

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
    }

    handleClick(button = 'left') {
        // Visual feedback
        this.cursor.addState('-active');
        setTimeout(() => this.cursor.removeState('-active'), 150);

        // Find element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (element) {
            if (button === 'left') {
                // Simulate full click sequence
                const events = ['mousedown', 'mouseup', 'click'];
                events.forEach(eventType => {
                    const event = new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: this.cursorX,
                        clientY: this.cursorY
                    });
                    element.dispatchEvent(event);
                });

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

    // ==================== Smooth Scrolling ====================

    handleScroll(deltaX, deltaY) {
        // Add to velocity for momentum
        this.scrollVelocityX += deltaX * this.scrollMultiplier;
        this.scrollVelocityY += deltaY * this.scrollMultiplier;
        
        // Find scrollable element under cursor
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        this.currentScrollTarget = this.findScrollableParent(element);
    }

    startScrollLoop() {
        const scrollLoop = () => {
            // Apply friction
            this.scrollVelocityX *= this.scrollFriction;
            this.scrollVelocityY *= this.scrollFriction;

            // Apply scroll if velocity is significant
            if (Math.abs(this.scrollVelocityX) > 0.5 || Math.abs(this.scrollVelocityY) > 0.5) {
                if (this.currentScrollTarget) {
                    this.currentScrollTarget.scrollBy({
                        top: this.scrollVelocityY,
                        left: this.scrollVelocityX,
                        behavior: 'auto'
                    });
                } else {
                    window.scrollBy({
                        top: this.scrollVelocityY,
                        left: this.scrollVelocityX,
                        behavior: 'auto'
                    });
                }
            } else {
                // Stop completely when velocity is very low
                this.scrollVelocityX = 0;
                this.scrollVelocityY = 0;
            }

            requestAnimationFrame(scrollLoop);
        };

        requestAnimationFrame(scrollLoop);
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
        // Get the cursor element
        const cursorEl = document.querySelector('.mf-cursor');
        
        if (cursorEl) {
            // Use GSAP for smooth animation
            gsap.to(cursorEl, {
                x: x,
                y: y,
                duration: 0.55,
                ease: 'expo.out',
                overwrite: true
            });
        }
    }

    // ==================== Continuous Hover Detection ====================

    startHoverLoop() {
        const hoverLoop = () => {
            this.checkHoverState();
            requestAnimationFrame(hoverLoop);
        };
        requestAnimationFrame(hoverLoop);
    }

    checkHoverState() {
        const element = document.elementFromPoint(this.cursorX, this.cursorY);
        
        if (!element) {
            this.clearAllStates();
            return;
        }

        // Simulate mouse events for proper hover
        this.simulateHover(element);

        // Check for cursor attributes
        this.checkCursorAttributes(element);
    }

    simulateHover(element) {
        // Mouse leave old element
        if (this.lastHoveredElement && this.lastHoveredElement !== element) {
            // Check if we're leaving to a child or parent
            const isRelated = this.lastHoveredElement.contains(element) || element.contains(this.lastHoveredElement);
            
            if (!isRelated) {
                const leaveEvent = new MouseEvent('mouseleave', {
                    bubbles: false,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY,
                    relatedTarget: element
                });
                this.lastHoveredElement.dispatchEvent(leaveEvent);

                const outEvent = new MouseEvent('mouseout', {
                    bubbles: true,
                    cancelable: true,
                    clientX: this.cursorX,
                    clientY: this.cursorY,
                    relatedTarget: element
                });
                this.lastHoveredElement.dispatchEvent(outEvent);
            }
        }

        // Mouse enter new element
        if (element !== this.lastHoveredElement) {
            const enterEvent = new MouseEvent('mouseenter', {
                bubbles: false,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: this.lastHoveredElement
            });
            element.dispatchEvent(enterEvent);

            const overEvent = new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                clientX: this.cursorX,
                clientY: this.cursorY,
                relatedTarget: this.lastHoveredElement
            });
            element.dispatchEvent(overEvent);
        }

        // Always dispatch mousemove
        const moveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: this.cursorX,
            clientY: this.cursorY
        });
        element.dispatchEvent(moveEvent);

        this.lastHoveredElement = element;
    }

    checkCursorAttributes(element) {
        // Walk up the DOM to find cursor attributes
        let current = element;
        let foundStick = null;
        let foundText = null;
        let foundImg = null;
        let foundState = null;

        while (current && current !== document.body) {
            // Check for stick
            if (current.hasAttribute('data-cursor-stick') && !foundStick) {
                const stickTarget = current.getAttribute('data-cursor-stick');
                foundStick = stickTarget ? document.querySelector(stickTarget) : current;
            }

            // Check for text
            if (current.hasAttribute('data-cursor-text') && foundText === null) {
                foundText = current.getAttribute('data-cursor-text');
            }

            // Check for image
            if (current.hasAttribute('data-cursor-img') && foundImg === null) {
                foundImg = current.getAttribute('data-cursor-img');
            }

            // Check for state
            if (current.hasAttribute('data-cursor') && foundState === null) {
                foundState = current.getAttribute('data-cursor');
            }

            current = current.parentElement;
        }

        // Handle stick
        if (foundStick !== this.currentStickTarget) {
            if (foundStick) {
                this.cursor.setStick(foundStick);
            } else if (this.currentStickTarget) {
                this.cursor.removeStick();
            }
            this.currentStickTarget = foundStick;
        }

        // Handle text
        if (foundText !== this.currentTextTarget) {
            if (foundText) {
                this.cursor.setText(foundText);
            } else if (this.currentTextTarget) {
                this.cursor.removeText();
            }
            this.currentTextTarget = foundText;
        }

        // Handle image
        if (foundImg !== this.currentImgTarget) {
            if (foundImg) {
                this.cursor.setImg(foundImg);
            } else if (this.currentImgTarget) {
                this.cursor.removeImg();
            }
            this.currentImgTarget = foundImg;
        }

        // Handle state
        if (foundState !== this.currentStateTarget) {
            if (this.currentStateTarget) {
                this.cursor.removeState(this.currentStateTarget);
            }
            if (foundState) {
                this.cursor.addState(foundState);
            }
            this.currentStateTarget = foundState;
        }

        // Auto-detect interactive elements for pointer state
        const isInteractive = this.isElementInteractive(element);
        if (isInteractive && !foundState) {
            this.cursor.addState('-pointer');
        } else if (!isInteractive && !foundState) {
            this.cursor.removeState('-pointer');
        }
    }

    isElementInteractive(element) {
        if (!element) return false;
        
        // Check the element and its parents
        let current = element;
        while (current && current !== document.body) {
            if (current.matches('a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"]), .demo-btn, .demo-link, .card, .image-item')) {
                return true;
            }
            // Check for click handlers (approximate)
            if (current.onclick || current.hasAttribute('data-cursor-stick')) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    clearAllStates() {
        if (this.currentStickTarget) {
            this.cursor.removeStick();
            this.currentStickTarget = null;
        }
        if (this.currentTextTarget) {
            this.cursor.removeText();
            this.currentTextTarget = null;
        }
        if (this.currentImgTarget) {
            this.cursor.removeImg();
            this.currentImgTarget = null;
        }
        if (this.currentStateTarget) {
            this.cursor.removeState(this.currentStateTarget);
            this.currentStateTarget = null;
        }
        this.cursor.removeState('-pointer');
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
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new Display();
});
