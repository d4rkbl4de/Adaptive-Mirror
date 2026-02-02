'use strict';

/**
 * Adaptive Mirror - Behavioral Analysis System (Hardened v3.0)
 * All critical bugs from v2.1 corrected
 */

// Fallback for performance.now() in older browsers
if (!window.performance || !window.performance.now) {
  window.performance = Date;
}

// Safe random generator fallback
const safeRandom = () => {
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    return arr[0] / (0xFFFFFFFF + 1);
  }
  return Math.random();
};

class AdaptiveMirror {
  constructor() {
    // State with safe defaults
    this.state = {
      isObserving: false,
      startTime: null,
      duration: 30000,
      timeRemaining: 30,
      pausedTime: 0,
      hiddenTime: 0,
      metrics: {
        mouseDistance: 0,
        velocitySum: 0,
        velocityCount: 0,
        maxVelocity: 0,
        jitterCount: 0,
        scrollCount: 0,
        clickCount: 0,
        keystrokes: 0,
        backspaces: 0,
        idleTime: 0,
        lastActivityTime: 0,
        directionChanges: 0,
        maxScrollVelocity: 0,
        // Track timestamps for proper duration calculation
        firstActivityTime: null
      },
      personality: null,
      scores: {},
      soundEnabled: false,
      audioContext: null,
      themeApplied: false,
      reducedMotion: false,
      hidden: false
    };

    // DOM references cache
    this.elements = {};
    this.particles = [];
    this.animationFrame = null;
    this.timers = {};
    this.timeouts = new Set(); // Track all timeouts for cleanup
    this.lastMouse = { x: 0, y: 0, time: 0, vx: 0, vy: 0 };
    this.idleStart = null;
    this.canvas = null;
    this.ctx = null;
    this.isDestroyed = false;
    
    // Bind all methods to ensure correct 'this' context
    this.handleMouseMove = this.throttle(this.handleMouseMove.bind(this), 16);
    this.handleScroll = this.throttle(this.handleScroll.bind(this), 100);
    this.handleWheel = this.throttle(this.handleWheel.bind(this), 50);
    this.handleResize = this.debounce(this.handleResize.bind(this), 200);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.startRenderLoop = this.startRenderLoop.bind(this);
    this.checkIdle = this.checkIdle.bind(this);
    this.boundKeyDownHandler = this.handleKeyDown.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    
    this.init();
  }

  init() {
    if (this.isDestroyed) return;
    
    this.checkReducedMotion();
    this.cacheDOM();
    this.setupAudio();
    this.initCanvas();
    this.bindEvents();
    this.loadPreviousResult();
    this.startRenderLoop();
    
    console.log('%cAdaptive Mirror v3.0 (Hardened)', 'color: #00ff88; font-family: monospace;');
  }

  checkReducedMotion() {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.state.reducedMotion = mediaQuery.matches;
    
    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', (e) => {
        this.state.reducedMotion = e.matches;
        if (e.matches) {
          this.particles = [];
          this.stopRenderLoop();
        } else {
          this.createParticles();
          this.startRenderLoop();
        }
      });
    } else if (mediaQuery.addListener) {
      // Older Safari
      mediaQuery.addListener((e) => {
        this.state.reducedMotion = e.matches;
      });
    }
  }

  cacheDOM() {
    const selectors = {
      screens: ['intro-screen', 'observation-screen', 'transition-screen', 'result-screen'],
      buttons: ['begin-btn', 'restart-btn', 'sound-toggle', 'abort-btn', 'export-btn'],
      displays: ['timer-display', 'timer-progress', 'primary-trait', 'interpretation', 'result-timestamp'],
      inputs: ['typing-field'],
      metrics: ['focus-bar', 'focus-value', 'hesitation-bar', 'hesitation-value', 'control-bar', 'control-value', 'energy-bar', 'energy-value'],
      misc: ['returning-message', 'sound-icon', 'ambient-canvas', 'session-id']
    };

    Object.entries(selectors).forEach(([category, ids]) => {
      ids.forEach(id => {
        this.elements[id] = document.getElementById(id);
      });
    });
    
    this.canvas = this.elements['ambient-canvas'];
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      // Handle context loss/restoration
      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.stopRenderLoop();
      });
      this.canvas.addEventListener('webglcontextrestored', () => {
        this.initCanvas();
      });
    }
    
    // Generate session ID
    if (this.elements['session-id']) {
      if (!this.elements['session-id'].textContent || this.elements['session-id'].textContent === '———') {
        this.elements['session-id'].textContent = 
          Math.random().toString(36).substring(2, 10).toUpperCase();
      }
    }
  }

  setupAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      
      this.state.audioContext = new AudioContext();
      
      // Resume on first user interaction - use named function for removal
      const resumeAudio = () => {
        if (this.state.audioContext?.state === 'suspended') {
          this.state.audioContext.resume().catch(() => {});
        }
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
        document.removeEventListener('touchstart', resumeAudio);
      };
      
      document.addEventListener('click', resumeAudio, { once: true });
      document.addEventListener('keydown', resumeAudio, { once: true });
      document.addEventListener('touchstart', resumeAudio, { once: true });
    } catch (e) {
      console.warn('Audio context not available');
      this.state.soundEnabled = false;
    }
  }

  initCanvas() {
    if (!this.canvas || !this.ctx || this.isDestroyed) return;
    
    this.resizeCanvas();
    this.createParticles();
    
    // ResizeObserver with proper reference
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver((entries) => {
        // Use requestAnimationFrame to avoid ResizeObserver loop limit exceeded
        window.requestAnimationFrame(() => {
          if (!Array.isArray(entries) || !entries.length) return;
          this.handleResize();
        });
      });
      this.resizeObserver.observe(document.body);
    } else {
      window.addEventListener('resize', this.handleResize, { passive: true });
    }
  }

  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  handleResize() {
    if (!this.canvas || this.isDestroyed) return;
    this.resizeCanvas();
    // Only recreate particles if count needs to change significantly
    if (this.particles.length === 0 && !this.state.reducedMotion) {
      this.createParticles();
    }
  }

  createParticles() {
    if (this.state.reducedMotion || !this.canvas) {
      this.particles = [];
      return;
    }
    
    // Clamp particle count based on area
    const area = window.innerWidth * window.innerHeight;
    const count = Math.min(25, Math.max(5, Math.floor(area / 50000)));
    
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.1 + 0.02,
        phase: Math.random() * Math.PI * 2,
        originalVx: 0, // Store for reset
        originalVy: 0
      });
    }
    // Store original velocities
    this.particles.forEach(p => {
      p.originalVx = p.vx;
      p.originalVy = p.vy;
    });
  }

  bindEvents() {
    if (this.isDestroyed) return;
    
    // Main controls
    this.elements['begin-btn']?.addEventListener('click', () => this.beginObservation());
    this.elements['restart-btn']?.addEventListener('click', () => this.reset());
    this.elements['sound-toggle']?.addEventListener('click', () => this.toggleAudio());
    this.elements['abort-btn']?.addEventListener('click', () => this.reset());
    this.elements['export-btn']?.addEventListener('click', () => this.exportData());
    
    // Input tracking - use beforeinput for better IME handling
    const inputField = this.elements['typing-field'];
    if (inputField) {
      inputField.addEventListener('beforeinput', (e) => this.handleBeforeInput(e));
      inputField.addEventListener('keydown', (e) => this.handleKeyDown(e));
      inputField.addEventListener('keyup', () => {
        if (this.state.isObserving) {
          this.state.metrics.lastActivityTime = performance.now();
        }
      });
      // Composition events for IME
      inputField.addEventListener('compositionstart', () => { this.isComposing = true; });
      inputField.addEventListener('compositionend', () => { this.isComposing = false; });
    }
    
    // Global tracking
    document.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    document.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('click', (e) => this.handleClick(e), { passive: true });
    
    // Touch support
    document.addEventListener('touchstart', (e) => this.handleTouch(e), { passive: true });
    document.addEventListener('touchmove', (e) => this.handleTouch(e), { passive: true });
    document.addEventListener('touchend', () => this.endTouch(), { passive: true });
    
    // Wheel events
    document.addEventListener('wheel', this.handleWheel, { passive: true });
    
    // Visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // Before unload cleanup
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', this.boundKeyDownHandler);
    
    // Prevent context menu during observation only
    this.contextMenuHandler = (e) => {
      if (this.state.isObserving) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('contextmenu', this.contextMenuHandler);
  }

  handleBeforeUnload() {
    this.destroy();
  }

  // Thorough cleanup method
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    this.stopObservation();
    
    // Remove document event listeners
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('scroll', this.handleScroll);
    document.removeEventListener('click', this.handleClick);
    document.removeEventListener('touchstart', this.handleTouch);
    document.removeEventListener('touchmove', this.handleTouch);
    document.removeEventListener('touchend', this.endTouch);
    document.removeEventListener('wheel', this.handleWheel);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('contextmenu', this.contextMenuHandler);
    document.removeEventListener('keydown', this.boundKeyDownHandler);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    
    window.removeEventListener('resize', this.handleResize);
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    // Clear animation frame
    this.stopRenderLoop();
    
    // Clear all tracked timeouts
    this.timeouts.forEach(id => clearTimeout(id));
    this.timeouts.clear();
    
    // Clear all intervals
    Object.values(this.timers).forEach(timer => {
      if (timer) clearInterval(timer);
    });
    this.timers = {};
    
    // Clear glitch timeout specifically
    if (this.timers.glitch) {
      clearTimeout(this.timers.glitch);
    }
    
    // Revoke any object URLs
    if (this.exportUrl) {
      URL.revokeObjectURL(this.exportUrl);
      this.exportUrl = null;
    }
  }

  stopRenderLoop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  handleVisibilityChange() {
    if (!this.state.isObserving) return;
    
    if (document.hidden) {
      this.state.hidden = true;
      this.state.hiddenTime = performance.now();
      // Clear intervals to pause tracking
      clearInterval(this.timers.countdown);
      clearInterval(this.timers.idle);
      this.stopRenderLoop();
    } else {
      this.state.hidden = true;
      const now = performance.now();
      const hiddenDuration = now - this.state.hiddenTime;
      
      // Adjust start time to account for hidden duration
      this.state.startTime += hiddenDuration;
      this.state.hidden = false;
      
      // Resume if still observing
      if (this.state.isObserving) {
        this.startTimer();
        this.startIdleTracker();
        this.startRenderLoop();
      }
    }
  }

  beginObservation() {
    if (this.state.isObserving) return;
    
    this.state.isObserving = true;
    this.state.startTime = performance.now();
    this.state.timeRemaining = 30;
    this.state.pausedTime = 0;
    this.state.metrics.lastActivityTime = performance.now();
    this.state.metrics.firstActivityTime = null;
    this.resetMetrics();
    
    this.switchScreen('observation-screen');
    this.startTimer();
    this.startIdleTracker();
    this.playTone(440, 0.1, 'sine');
    
    // Safe focus with visibility check
    setTimeout(() => {
      const input = this.elements['typing-field'];
      if (input && document.visibilityState === 'visible' && document.activeElement !== input) {
        // Only focus if user hasn't manually focused something else
        if (document.activeElement === document.body) {
          input.focus({ preventScroll: true });
        }
      }
    }, 100);
  }

  resetMetrics() {
    this.state.metrics = {
      mouseDistance: 0,
      velocitySum: 0,
      velocityCount: 0,
      maxVelocity: 0,
      jitterCount: 0,
      scrollCount: 0,
      clickCount: 0,
      keystrokes: 0,
      backspaces: 0,
      idleTime: 0,
      lastActivityTime: performance.now(),
      firstActivityTime: null,
      directionChanges: 0,
      maxScrollVelocity: 0
    };
    
    this.lastMouse = { x: 0, y: 0, time: 0, vx: 0, vy: 0 };
    this.idleStart = null;
    this.isComposing = false;
  }

  startTimer() {
    // Clear existing to prevent duplicates
    clearInterval(this.timers.countdown);
    
    let lastAnnouncement = 30;
    
    const update = () => {
      if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
      
      const elapsed = performance.now() - this.state.startTime;
      const progress = Math.min(1, elapsed / this.state.duration);
      const remaining = Math.max(0, Math.ceil((this.state.duration - elapsed) / 1000));
      
      if (remaining !== this.state.timeRemaining) {
        this.state.timeRemaining = remaining;
        const display = this.elements['timer-display'];
        if (display) {
          display.textContent = remaining.toString().padStart(2, '0');
          
          // Add warning class when time is running low
          if (remaining <= 5) {
            display.classList.add('warning');
          } else {
            display.classList.remove('warning');
          }
          
          // FIXED: Only announce every 5 seconds or at 10/5/0 to prevent spam
          if (remaining === 0 || remaining === 5 || remaining === 10 || 
              (remaining % 5 === 0 && remaining !== lastAnnouncement)) {
            display.setAttribute('aria-live', 'polite');
            lastAnnouncement = remaining;
            const timeoutId = setTimeout(() => {
              if (display) display.removeAttribute('aria-live');
            }, 1000);
            this.trackTimeout(timeoutId);
          }
        }
      }
      
      if (this.elements['timer-progress']) {
        const scale = 1 - progress;
        this.elements['timer-progress'].style.transform = `scaleX(${Math.max(0, Math.min(1, scale))})`;
      }
      
      if (elapsed >= this.state.duration) {
        this.completeObservation();
      }
    };
    
    update(); // Immediate update
    this.timers.countdown = setInterval(update, 100); // Update 10x per second for smooth progress
  }

  trackTimeout(id) {
    this.timeouts.add(id);
  }

  clearTimeout(id) {
    clearTimeout(id);
    this.timeouts.delete(id);
  }

  startIdleTracker() {
    clearInterval(this.timers.idle);
    this.timers.idle = setInterval(this.checkIdle, 100);
  }

  checkIdle() {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    
    const now = performance.now();
    const timeSinceActivity = now - this.state.metrics.lastActivityTime;
    
    if (this.idleStart && timeSinceActivity < 100) {
      const idleDuration = now - this.idleStart;
      if (idleDuration > 500) {
        this.state.metrics.idleTime += idleDuration;
      }
      this.idleStart = null;
    } else if (!this.idleStart && timeSinceActivity > 400) {
      this.idleStart = now;
    }
  }

  handleMouseMove(e) {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    
    const now = e.timeStamp || performance.now();
    const x = e.clientX;
    const y = e.clientY;
    
    this.updateMetricIndicator('movement', true);
    
    // Initialize first activity time
    if (!this.state.metrics.firstActivityTime) {
      this.state.metrics.firstActivityTime = now;
    }
    
    if (this.lastMouse.time) {
      const dt = now - this.lastMouse.time;
      if (dt > 16) { // At least one frame (60fps)
        const dx = x - this.lastMouse.x;
        const dy = y - this.lastMouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          const vx = dx / dt;
          const vy = dy / dt;
          const velocity = Math.sqrt(vx * vx + vy * vy);
          
          this.state.metrics.mouseDistance += distance;
          this.state.metrics.velocitySum += velocity;
          this.state.metrics.velocityCount++;
          
          if (isFinite(velocity) && velocity > this.state.metrics.maxVelocity) {
            this.state.metrics.maxVelocity = velocity;
          }
          
          if (distance < 5 && dt < 50) {
            this.state.metrics.jitterCount++;
          }
          
          // FIXED: Check direction changes using current and stored velocity
          if (this.lastMouse.vx !== 0 || this.lastMouse.vy !== 0) {
            const dotProduct = (vx * this.lastMouse.vx) + (vy * this.lastMouse.vy);
            if (dotProduct < 0 && velocity > 0.3) {
              this.state.metrics.directionChanges++;
            }
          }
          
          this.lastMouse.vx = vx;
          this.lastMouse.vy = vy;
        }
      }
    }
    
    this.lastMouse = { x, y, time: now, vx: this.lastMouse.vx, vy: this.lastMouse.vy };
    this.state.metrics.lastActivityTime = now;
  }

  handleTouch(e) {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    const touch = e.touches[0];
    if (!touch) return;
    
    // FIXED: Proper synthetic event with timestamp
    this.handleMouseMove({
      clientX: touch.clientX,
      clientY: touch.clientY,
      timeStamp: e.timeStamp || performance.now()
    });
  }

  endTouch() {
    this.lastMouse.time = 0; // Reset velocity calculation between touches
    this.lastMouse.vx = 0;
    this.lastMouse.vy = 0;
  }

  handleWheel(e) {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    const velocity = Math.abs(e.deltaY);
    if (isFinite(velocity) && velocity > this.state.metrics.maxScrollVelocity) {
      this.state.metrics.maxScrollVelocity = velocity;
    }
  }

  handleScroll() {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    this.state.metrics.scrollCount++;
    this.state.metrics.lastActivityTime = performance.now();
  }

  handleClick(e) {
    if (!this.state.isObserving || this.state.hidden || this.isDestroyed) return;
    if (e.target?.closest('#sound-toggle')) return;
    
    this.updateMetricIndicator('interaction', true);
    this.state.metrics.clickCount++;
    this.state.metrics.lastActivityTime = performance.now();
    
    if (!this.state.reducedMotion) {
      this.createRipple(e.clientX, e.clientY);
    }
  }

  updateMetricIndicator(metric, active) {
    const dot = document.querySelector(`[data-metric="${metric}"]`);
    if (!dot) return;
    
    if (active) {
      dot.classList.add('active');
      const timeoutId = setTimeout(() => {
        dot.classList.remove('active');
        this.timeouts.delete(timeoutId);
      }, 500);
      this.trackTimeout(timeoutId);
    }
  }

  createRipple(x, y) {
    if (!this.state.isObserving || this.isDestroyed) return;
    
    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: 20px;
      height: 20px;
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      transform: translate(-50%, -50%) scale(0);
      pointer-events: none;
      z-index: 9999;
      animation: rippleExpand 0.6s ease-out forwards;
    `;
    
    document.body.appendChild(ripple);
    
    // FIXED: Store reference to remove even if reset early
    const timeoutId = setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
      this.timeouts.delete(timeoutId);
    }, 600);
    this.trackTimeout(timeoutId);
  }

  handleKeyDown(e) {
    if (!this.state.isObserving || this.isDestroyed) return;
    
    // Ignore IME composition events
    if (this.isComposing || e.key === 'Dead' || e.isComposing) return;
    
    const now = performance.now();
    
    if (e.key === 'Backspace') {
      this.state.metrics.backspaces++;
      const field = this.elements['typing-field'];
      if (field) {
        field.style.borderColor = 'rgba(255, 100, 100, 0.6)';
        const timeoutId = setTimeout(() => {
          if (field) field.style.borderColor = '';
          this.timeouts.delete(timeoutId);
        }, 100);
        this.trackTimeout(timeoutId);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.state.metrics.keystrokes++;
    }
    
    this.state.metrics.lastActivityTime = now;
  }

  handleBeforeInput(e) {
    if (!this.state.isObserving) return;
    this.state.metrics.lastActivityTime = performance.now();
  }

  stopObservation() {
    this.state.isObserving = false;
    clearInterval(this.timers.countdown);
    clearInterval(this.timers.idle);
    this.stopRenderLoop();
  }

  completeObservation() {
    this.stopObservation();
    this.switchScreen('transition-screen');
    
    try {
      this.calculateResults();
    } catch (error) {
      console.error('Calculation error:', error);
      this.state.personality = 'Observer'; // Fallback
      this.state.scores = { focus: 50, hesitation: 50, controlBias: 50, energy: 50 };
    }
    
    const timeoutId = setTimeout(() => {
      if (!this.state.isObserving && !this.isDestroyed) {
        this.applyTheme();
        this.displayResults();
        this.persistResult();
      }
    }, 2500);
    this.trackTimeout(timeoutId);
  }

  calculateResults() {
    const m = this.state.metrics;
    // FIXED: Calculate actual duration to account for pauses/corrections
    const actualDuration = ((m.lastActivityTime || performance.now()) - (m.firstActivityTime || this.state.startTime)) / 1000;
    const durationSec = Math.max(1, Math.min(30, actualDuration || 30)); // Clamp 1-30
    
    const avgVelocity = m.velocityCount > 0 ? m.velocitySum / m.velocityCount : 0;
    const clickRate = m.clickCount / durationSec;
    const scrollRate = m.scrollCount / durationSec;
    const activityDensity = (m.clickCount + m.scrollCount + m.keystrokes) / durationSec;
    const deletionRate = m.keystrokes > 0 ? m.backspaces / m.keystrokes : 0;
    const avgIdleGap = m.clickCount > 0 ? m.idleTime / m.clickCount : 0;
    
    const scores = {
      Impulsive: 0,
      Analytical: 0,
      Perfectionist: 0,
      Observer: 0,
      Restless: 0
    };
    
    // Algorithmic scoring
    if (avgVelocity > 1.2 || clickRate > 0.4) scores.Impulsive += 20;
    if (m.maxVelocity > 3) scores.Impulsive += 15;
    if (m.jitterCount > 40) scores.Impulsive += 15;
    
    if (avgVelocity < 0.5 && avgIdleGap > 2000) scores.Analytical += 25;
    if (m.idleTime > 10000) scores.Analytical += 15;
    if (m.keystrokes > 50 && deletionRate < 0.1) scores.Analytical += 10;
    
    if (deletionRate > 0.15) scores.Perfectionist += 25;
    if (m.backspaces > 3) scores.Perfectionist += 15;
    if (avgVelocity < 0.8 && m.jitterCount < 20) scores.Perfectionist += 10;
    
    if (m.mouseDistance < 600 && m.clickCount < 3) scores.Observer += 30;
    if (m.keystrokes < 5 && m.scrollCount < 5) scores.Observer += 20;
    
    if (activityDensity > 0.8) scores.Restless += 20;
    if (m.directionChanges > 30) scores.Restless += 15;
    if (scrollRate > 0.5) scores.Restless += 15;
    
    let dominant = 'Observer';
    let maxScore = -1;
    
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    
    if (entries[0][1] > 0) {
      dominant = entries[0][0];
      if (entries[1] && entries[0][1] === entries[1][1]) {
        // Tie-breaker logic (simplified)
        if (entries[1][0] === 'Impulsive' && avgVelocity > 1) dominant = 'Impulsive';
        else if (entries[1][0] === 'Analytical' && avgIdleGap > 2000) dominant = 'Analytical';
      }
    } else {
      if (m.mouseDistance > 2000) dominant = 'Restless';
      else if (m.backspaces > 0) dominant = 'Perfectionist';
      else if (m.clickCount > 5) dominant = 'Impulsive';
    }
    
    this.state.personality = dominant;
    
    // FIXED: Better NaN handling and bounds
    const safeNum = (val, def = 0) => (isFinite(val) && !isNaN(val)) ? val : def;
    
    const focusScore = safeNum((avgVelocity * 20) + (activityDensity * 10));
    const hesitationScore = safeNum((deletionRate * 50) + (avgIdleGap / 100));
    const clickScrollSum = clickRate + scrollRate;
    const controlScore = clickScrollSum > 0 
      ? (clickRate / clickScrollSum) * 100 
      : 50;
    const energyScore = safeNum(Math.min(100, activityDensity * 10));
    
    this.state.scores = {
      focus: this.normalizeScore(focusScore, 50),
      hesitation: this.normalizeScore(hesitationScore, 50),
      controlBias: Math.round(controlScore),
      energy: this.normalizeScore(energyScore, 50)
    };
    
    // Clamp controlBias to 0-100 explicitly
    this.state.scores.controlBias = Math.max(0, Math.min(100, this.state.scores.controlBias));
  }

  normalizeScore(val, center = 50) {
    return Math.max(5, Math.min(95, Math.round(val)));
  }

  applyTheme() {
    if (!this.state.personality || this.state.themeApplied || this.isDestroyed) return;
    
    // Remove previous themes safely - convert to array first to avoid live collection issues
    const classes = Array.from(document.body.classList);
    classes.forEach(cls => {
      if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    });
    
    document.body.classList.add(`theme-${this.state.personality.toLowerCase()}`);
    this.state.themeApplied = true;
    
    if (this.state.reducedMotion) return;
    
    // FIXED: Cap velocity multipliers to prevent runaway particles
    if (this.state.personality === 'Impulsive') {
      this.particles.forEach(p => {
        p.vx = Math.max(-2, Math.min(2, p.vx * 1.5)); // Cap at 2px/frame
        p.vy = Math.max(-2, Math.min(2, p.vy * 1.5));
      });
    } else if (this.state.personality === 'Restless') {
      this.addGlitchEffect();
    }
  }

  addGlitchEffect() {
    if (this.state.reducedMotion || this.isDestroyed) return;
    
    const glitch = () => {
      if (!document.body.classList.contains('theme-restless') || this.isDestroyed) return;
      if (Math.random() > 0.3 || this.state.reducedMotion) return;
      
      const screens = document.querySelectorAll('.screen.active');
      screens.forEach(screen => {
        const x = (Math.random() * 4 - 2).toFixed(2);
        const y = (Math.random() * 4 - 2).toFixed(2);
        screen.style.transform = `translate(${x}px, ${y}px)`;
        const timeoutId = setTimeout(() => {
          if (screen) screen.style.transform = '';
          this.timeouts.delete(timeoutId);
        }, 50);
        this.trackTimeout(timeoutId);
      });
      
      this.timers.glitch = setTimeout(glitch, Math.random() * 8000 + 5000);
    };
    
    this.timers.glitch = setTimeout(glitch, 3000);
  }

  displayResults() {
    if (this.isDestroyed) return;
    
    const interpretations = {
      Impulsive: "You act quickly and adjust later. You explore aggressively and trust instinct more than analysis. Your movements reveal decisive intent with minimal deliberation.",
      Analytical: "You measure before moving. You prefer understanding over action, depth over breadth. Your pace suggests systematic processing and careful consideration.",
      Perfectionist: "You refine continuously. Each deletion is a step toward precision. You see what others miss and cannot tolerate approximation.",
      Observer: "You watch before engaging. Silence is your tool. You gather more than you reveal, exercising restraint in a world that demands reaction.",
      Restless: "Your mind moves constantly. Stillness feels foreign. You seek the next thing before the current ends, driven by an insatiable momentum."
    };
    
    const traitEl = this.elements['primary-trait'];
    if (traitEl) {
      traitEl.textContent = this.state.personality;
      traitEl.setAttribute('aria-label', `Your personality type is ${this.state.personality}`);
    }
    
    const interpEl = this.elements['interpretation'];
    if (interpEl) {
      interpEl.textContent = interpretations[this.state.personality] || 'Analysis complete.';
    }
    
    // Animate metrics with safety checks
    const metrics = ['focus', 'hesitation', 'controlBias', 'energy'];
    metrics.forEach((metric, index) => {
      const timeoutId = setTimeout(() => {
        if (this.isDestroyed) return;
        const bar = this.elements[`${metric.toLowerCase()}-bar`];
        const value = this.elements[`${metric.toLowerCase()}-value`];
        
        if (bar && value) {
          const score = this.state.scores[metric] || 0;
          const displayValue = metric === 'controlBias' ? `${score}%` : score;
          
          bar.style.width = `${score}%`;
          bar.setAttribute('aria-valuenow', score);
          value.textContent = displayValue;
        }
      }, 200 + (index * 150));
      this.trackTimeout(timeoutId);
    });
    
    this.switchScreen('result-screen');
    this.playSuccessSound();
  }

  persistResult() {
    try {
      const data = {
        personality: this.state.personality,
        scores: this.state.scores,
        timestamp: Date.now(),
        metrics: {
          distance: Math.round(this.state.metrics.mouseDistance),
          interactions: this.state.metrics.clickCount + this.state.metrics.scrollCount
        }
      };
      localStorage.setItem('adaptiveMirror_result_v2', JSON.stringify(data));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded');
      } else {
        console.warn('Failed to save result:', e);
      }
    }
  }

  loadPreviousResult() {
    try {
      const saved = localStorage.getItem('adaptiveMirror_result_v2');
      if (!saved) return;
      
      // FIXED: Wrap JSON parse in try-catch
      let data;
      try {
        data = JSON.parse(saved);
      } catch (parseError) {
        throw new Error('Invalid JSON');
      }
      
      // Validate data structure
      if (data && typeof data === 'object' && this.elements['returning-message']) {
        this.elements['returning-message'].classList.remove('hidden');
        this.elements['returning-message'].hidden = false;
      }
    } catch (e) {
      console.warn('Failed to load previous result:', e);
      try {
        localStorage.removeItem('adaptiveMirror_result_v2');
      } catch (removeError) {
        // Ignore removal errors
      }
    }
  }

  switchScreen(screenId) {
    if (this.isDestroyed) return;
    
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
      screen.style.visibility = 'hidden';
      screen.setAttribute('aria-hidden', 'true');
      screen.hidden = true;
    });
    
    const target = document.getElementById(screenId);
    if (target) {
      target.hidden = false;
      target.style.visibility = 'visible';
      target.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        target.classList.add('active');
      });
      
      document.title = `Adaptive Mirror | ${screenId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
    }
  }

  toggleAudio() {
    this.state.soundEnabled = !this.state.soundEnabled;
    
    if (this.elements['sound-icon']) {
      this.elements['sound-icon'].textContent = this.state.soundEnabled ? '◬' : '◯';
    }
    
    if (this.elements['sound-toggle']) {
      this.elements['sound-toggle'].setAttribute('aria-pressed', this.state.soundEnabled);
    }
    
    if (this.state.soundEnabled && this.state.audioContext?.state === 'suspended') {
      this.state.audioContext.resume().catch(() => {});
    }
    
    this.playTone(600, 0.05, 'sine');
  }

  playTone(frequency, duration, type = 'sine') {
    if (!this.state.soundEnabled || !this.state.audioContext || this.isDestroyed) return;
    
    try {
      const now = this.state.audioContext.currentTime;
      const osc = this.state.audioContext.createOscillator();
      const gain = this.state.audioContext.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      
      osc.connect(gain);
      gain.connect(this.state.audioContext.destination);
      
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {
      // Silently fail
    }
  }

  playSuccessSound() {
    if (!this.state.soundEnabled || !this.state.audioContext || this.isDestroyed) return;
    
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      const timeoutId = setTimeout(() => {
        if (!this.isDestroyed) this.playTone(freq, 0.2, 'sine');
      }, i * 100);
      this.trackTimeout(timeoutId);
    });
  }

  startRenderLoop() {
    if (this.isDestroyed || this.state.reducedMotion || document.hidden) return;
    if (this.animationFrame) return; // Already running
    
    const render = (time) => {
      if (this.isDestroyed || !this.ctx || document.hidden || this.state.reducedMotion) {
        this.animationFrame = null;
        return;
      }
      
      try {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const t = time * 0.001;
        
        this.particles.forEach((p, i) => {
          this.updateParticle(p, t, i);
          this.drawParticle(p);
        });
        
        this.drawConnections();
      } catch (e) {
        console.error('Render error', e);
        this.stopRenderLoop();
        return;
      }
      
      this.animationFrame = requestAnimationFrame(render);
    };
    
    this.animationFrame = requestAnimationFrame(render);
  }

  updateParticle(p, time, index) {
    if (this.state.reducedMotion) return;
    
    let speed = 1;
    if (this.state.personality === 'Impulsive') speed = 1.5;
    else if (this.state.personality === 'Restless') speed = 1.2;
    else if (this.state.personality === 'Analytical') speed = 0.5;
    
    p.x += p.vx * speed;
    p.y += p.vy * speed;
    
    if (this.state.personality === 'Restless') {
      p.vx += Math.sin(time + index) * 0.01;
      p.vy += Math.cos(time * 1.5 + index) * 0.01;
      // Dampen to prevent acceleration
      p.vx *= 0.99;
      p.vy *= 0.99;
    }
    
    // Bounce with padding
    const padding = 10;
    if (p.x < padding) { p.x = padding; p.vx *= -1; }
    else if (p.x > window.innerWidth - padding) { p.x = window.innerWidth - padding; p.vx *= -1; }
    
    if (p.y < padding) { p.y = padding; p.vy *= -1; }
    else if (p.y > window.innerHeight - padding) { p.y = window.innerHeight - padding; p.vy *= -1; }
  }

  drawParticle(p) {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    
    let color = '128, 128, 128';
    switch(this.state.personality) {
      case 'Restless': color = '0, 255, 136'; break;
      case 'Impulsive': color = '255, 0, 110'; break;
      case 'Analytical': color = '139, 148, 158'; break;
      case 'Perfectionist': color = '108, 117, 125'; break;
      case 'Observer': color = '100, 100, 120'; break;
    }
    
    this.ctx.fillStyle = `rgba(${color}, ${p.opacity})`;
    this.ctx.fill();
  }

  drawConnections() {
    if (this.state.personality === 'Observer' || this.particles.length < 2 || this.state.reducedMotion) return;
    
    const maxDistance = this.state.personality === 'Impulsive' ? 100 : 120;
    const maxConnections = 3;
    const maxDistSq = maxDistance * maxDistance; // FIXED: Use squared distance
    
    this.particles.forEach((p1, i) => {
      let connections = 0;
      for (let j = i + 1; j < this.particles.length && connections < maxConnections; j++) {
        const p2 = this.particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distSq = dx * dx + dy * dy; // Avoid sqrt
        
        if (distSq < maxDistSq) {
          const distance = Math.sqrt(distSq); // Only sqrt when needed
          const alpha = (1 - distance / maxDistance) * 0.15;
          this.ctx.strokeStyle = this.state.personality === 'Restless' 
            ? `rgba(0, 255, 136, ${alpha})` 
            : `rgba(255, 255, 255, ${alpha})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.beginPath();
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.stroke();
          connections++;
        }
      }
    });
  }

  exportData() {
    if (this.isDestroyed) return;
    
    try {
      const data = {
        personality: this.state.personality,
        scores: this.state.scores,
        timestamp: new Date().toISOString(),
        // FIXED: Don't include user agent without consent (privacy)
        sessionId: this.elements['session-id']?.textContent || 'N/A',
        screen: {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth
        }
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      
      // FIXED: Revoke previous URL if exists to prevent memory leak
      if (this.exportUrl) {
        URL.revokeObjectURL(this.exportUrl);
      }
      
      this.exportUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = this.exportUrl;
      a.download = `adaptive-mirror-result-${Date.now()}-${safeRandom().toString(36).substring(2, 6)}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      try {
        a.click();
      } finally {
        document.body.removeChild(a);
      }
      
      // Visual feedback
      const btn = this.elements['export-btn'];
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="btn-icon" aria-hidden="true">✓</span><span class="btn-text">Exported!</span>';
        btn.disabled = true;
        
        const timeoutId = setTimeout(() => {
          if (btn && !this.isDestroyed) {
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
          this.timeouts.delete(timeoutId);
        }, 2000);
        this.trackTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  }

  reset() {
    this.stopObservation();
    
    // Clear glitch timer
    if (this.timers.glitch) {
      clearTimeout(this.timers.glitch);
      this.timers.glitch = null;
    }
    
    this.state.personality = null;
    this.state.themeApplied = false;
    this.state.scores = {};
    
    // Remove theme classes
    const classes = Array.from(document.body.classList);
    classes.forEach(cls => {
      if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    });
    
    // Reset particle velocities
    this.createParticles();
    this.switchScreen('intro-screen');
    
    // Reset metrics display with safety checks
    ['focus', 'hesitation', 'control', 'energy'].forEach(type => {
      const bar = this.elements[`${type}-bar`];
      const value = this.elements[`${type}-value`];
      if (bar) {
        bar.style.width = '0%';
        bar.setAttribute('aria-valuenow', '0');
      }
      if (value) {
        value.textContent = type === 'control' ? '0%' : '0';
      }
    });
    
    if (this.elements['primary-trait']) {
      this.elements['primary-trait'].textContent = '—';
    }
    
    if (this.elements['interpretation']) {
      this.elements['interpretation'].textContent = 'Click "Initialize Session" to begin analysis.';
    }
    
    if (this.elements['typing-field']) {
      this.elements['typing-field'].value = '';
    }
    
    this.playTone(440, 0.1, 'sine');
  }

  handleKeyDown(e) {
    if (e.key === 'Escape' && this.state.isObserving) {
      this.reset();
    }
    if (e.key === ' ' && e.target === document.body) {
      e.preventDefault();
    }
  }

  // Utility methods with proper context preservation
  throttle(fn, limit) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        const timeoutId = setTimeout(() => {
          inThrottle = false;
          this.timeouts?.delete(timeoutId);
        }, limit);
        this.timeouts?.add(timeoutId);
      }
    };
  }

  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fn.apply(this, args);
        this.timeouts?.delete(timer);
      }, delay);
      this.timeouts?.add(timer);
    };
  }
}

// Initialize application safely
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.adaptiveMirror = new AdaptiveMirror();
  }, { once: true });
} else {
  window.adaptiveMirror = new AdaptiveMirror();
}

// Inject ripple keyframes safely
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes rippleExpand {
      to {
        transform: translate(-50%, -50%) scale(4);
        opacity: 0;
      }
    }
    .click-ripple {
      will-change: transform, opacity;
    }
  `;
  document.head.appendChild(style);
}