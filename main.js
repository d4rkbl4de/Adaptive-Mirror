'use strict';

/**
 * Adaptive Mirror - Behavioral Analysis System (Corrected)
 * Bug-free, accessible, performance-optimized implementation
 */

// Fallback for performance.now() in older browsers
if (!window.performance || !window.performance.now) {
  window.performance = {
    now: function() {
      return Date.now();
    }
  };
}

class AdaptiveMirror {
  constructor() {
    this.state = {
      isObserving: false,
      startTime: null,
      duration: 30000,
      timeRemaining: 30,
      pausedTime: 0, // For visibility changes
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
        lastActivityTime: null,
        directionChanges: 0,
        maxScrollVelocity: 0
      },
      personality: null,
      scores: {},
      soundEnabled: false,
      audioContext: null,
      themeApplied: false,
      reducedMotion: false,
      hidden: false
    };

    this.elements = {};
    this.particles = [];
    this.animationFrame = null;
    this.timers = {};
    this.lastMouse = { x: 0, y: 0, time: 0, vx: 0, vy: 0 };
    this.idleStart = null;
    this.canvas = null;
    this.ctx = null;
    
    // Bound methods for proper cleanup
    this.handleMouseMove = this.throttle(this.handleMouseMove.bind(this), 16); // ~60fps
    this.handleScroll = this.throttle(this.handleScroll.bind(this), 100);
    this.handleResize = this.debounce(this.handleResize.bind(this), 200);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.startRenderLoop = this.startRenderLoop.bind(this);
    this.checkIdle = this.checkIdle.bind(this);
    this.boundKeyDownHandler = this.handleKeyDown.bind(this); // Add this binding
    
    this.init();
  }

  init() {
    this.checkReducedMotion();
    this.cacheDOM();
    this.setupAudio();
    this.initCanvas();
    this.bindEvents();
    this.loadPreviousResult();
    this.startRenderLoop();
    this.updateTimestamp();
    
    console.log('%cAdaptive Mirror v2.1 (Corrected)', 'color: #00ff88; font-family: monospace;');
  }

  checkReducedMotion() {
    this.state.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    }
  }

  setupAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.state.audioContext = new AudioContext();
        // Resume on first user interaction to satisfy autoplay policies
        const resumeAudio = () => {
          if (this.state.audioContext?.state === 'suspended') {
            this.state.audioContext.resume();
          }
          document.removeEventListener('click', resumeAudio);
          document.removeEventListener('keydown', resumeAudio);
        };
        document.addEventListener('click', resumeAudio, { once: true });
        document.addEventListener('keydown', resumeAudio, { once: true });
      }
    } catch (e) {
      console.warn('Audio context not available');
      this.state.soundEnabled = false;
    }
  }

  initCanvas() {
    if (!this.canvas || !this.ctx) return;
    
    this.resizeCanvas();
    this.createParticles();
    
    // Use ResizeObserver for container changes
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(document.body);
    } else {
      window.addEventListener('resize', this.handleResize, { passive: true });
    }
  }

  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
    
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap DPR for performance
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Use setTransform instead of scale
  }

  handleResize() {
    if (!this.canvas) return;
    this.resizeCanvas();
    this.createParticles();
  }

  createParticles() {
    if (this.state.reducedMotion) {
      this.particles = [];
      return;
    }
    
    this.particles = [];
    // Clamp particle count for performance
    const area = window.innerWidth * window.innerHeight;
    const count = Math.min(20, Math.floor(area / 60000));
    
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.1 + 0.02,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  bindEvents() {
    // Main controls
    this.elements['begin-btn']?.addEventListener('click', () => this.beginObservation());
    this.elements['restart-btn']?.addEventListener('click', () => this.reset());
    this.elements['sound-toggle']?.addEventListener('click', () => this.toggleAudio());
    this.elements['abort-btn']?.addEventListener('click', () => this.reset());
    this.elements['export-btn']?.addEventListener('click', () => this.exportData()); // Add export handler
    
    // Input tracking
    this.elements['typing-field']?.addEventListener('keydown', (e) => this.handleTyping(e));
    this.elements['typing-field']?.addEventListener('input', (e) => this.handleInput(e));
    this.elements['typing-field']?.addEventListener('keyup', () => {
      if (this.state.isObserving) {
        this.state.metrics.lastActivityTime = performance.now();
      }
    });
    
    // Global tracking - passive where possible
    document.addEventListener('mousemove', this.handleMouseMove, { passive: true });
    document.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('click', (e) => this.handleClick(e), { passive: true });
    
    // Touch support
    document.addEventListener('touchstart', (e) => this.handleTouch(e), { passive: true });
    document.addEventListener('touchmove', (e) => this.handleTouch(e), { passive: true });
    document.addEventListener('touchend', () => this.endTouch(), { passive: true });
    
    // Wheel events for scroll intent
    document.addEventListener('wheel', (e) => this.handleWheel(e), { passive: true });
    
    // Visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    
    // Reduced motion changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.state.reducedMotion = e.matches;
      if (e.matches) this.particles = [];
      else this.createParticles();
    });
    
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

  // Proper cleanup method to prevent memory leaks
  destroy() {
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
    document.removeEventListener('keydown', this.boundKeyDownHandler); // Add this
    
    // Remove window event listeners
    window.removeEventListener('resize', this.handleResize);
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    
    // Clear all timers
    Object.values(this.timers).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    this.timers = {};
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.state.hidden = true;
      if (this.state.isObserving) {
        this.state.pausedTime = performance.now();
        clearInterval(this.timers.countdown);
        cancelAnimationFrame(this.timers.main);
      }
    } else {
      this.state.hidden = false;
      if (this.state.isObserving && this.state.pausedTime) {
        const pauseDuration = performance.now() - this.state.pausedTime;
        this.state.startTime += pauseDuration; // Adjust start time
        this.startTimer(); // Resume
      }
    }
  }

  beginObservation() {
    this.state.isObserving = true;
    this.state.startTime = performance.now();
    this.state.timeRemaining = 30;
    this.state.pausedTime = 0;
    this.state.metrics.lastActivityTime = performance.now();
    this.resetMetrics();
    
    this.switchScreen('observation-screen');
    this.startTimer();
    this.startIdleTracker();
    this.playTone(440, 0.1, 'sine');
    
    // Safe focus with check
    setTimeout(() => {
      const input = this.elements['typing-field'];
      if (input && document.visibilityState === 'visible') {
        input.focus({ preventScroll: true });
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
      directionChanges: 0,
      maxScrollVelocity: 0
    };
    
    this.lastMouse = { x: 0, y: 0, time: performance.now(), vx: 0, vy: 0 };
    this.idleStart = null;
  }

  startTimer() {
    // Use interval for display updates (1s), precise timing via Date
    const update = () => {
      if (!this.state.isObserving || this.state.hidden) return;
      
      const elapsed = performance.now() - this.state.startTime;
      const progress = Math.min(1, elapsed / this.state.duration);
      const remaining = Math.max(0, Math.ceil((this.state.duration - elapsed) / 1000));
      
      // Only update DOM when value actually changes to reduce accessibility noise
      if (remaining !== this.state.timeRemaining) {
        this.state.timeRemaining = remaining;
        if (this.elements['timer-display']) {
          this.elements['timer-display'].textContent = remaining.toString().padStart(2, '0');
          
          // Add warning class when time is running low
          if (remaining <= 5) {
            this.elements['timer-display'].classList.add('warning');
          } else {
            this.elements['timer-display'].classList.remove('warning');
          }
          
          // Only announce significant changes to screen readers
          if (remaining % 5 === 0 || remaining <= 5) {
            this.elements['timer-display'].setAttribute('aria-live', 'polite');
            setTimeout(() => {
              if (this.elements['timer-display']) {
                this.elements['timer-display'].removeAttribute('aria-live');
              }
            }, 1000);
          }
        }
      }
      
      if (this.elements['timer-progress']) {
        const scale = 1 - progress;
        this.elements['timer-progress'].style.transform = `scaleX(${scale})`;
      }
      
      if (elapsed >= this.state.duration) {
        this.completeObservation();
      }
    };
    
    this.timers.countdown = setInterval(update, 100);
  }

  startIdleTracker() {
    clearInterval(this.timers.idle);
    this.timers.idle = setInterval(this.checkIdle, 100);
  }

  checkIdle() {
    if (!this.state.isObserving || this.state.hidden) return;
    
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
    if (!this.state.isObserving || this.state.hidden) return;
    
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;
    
    // Update movement metric indicator
    this.updateMetricIndicator('movement', true);
    
    if (this.lastMouse.time) {
      const dt = now - this.lastMouse.time;
      if (dt > 0) {
        const dx = x - this.lastMouse.x;
        const dy = y - this.lastMouse.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Prevent division by very small numbers
        if (dt > 10 && distance > 0) {
          const vx = dx / dt;
          const vy = dy / dt;
          const velocity = Math.sqrt(vx * vx + vy * vy);
          
          this.state.metrics.mouseDistance += distance;
          this.state.metrics.velocitySum += velocity;
          this.state.metrics.velocityCount++;
          
          if (velocity > this.state.metrics.maxVelocity) {
            this.state.metrics.maxVelocity = velocity;
          }
          
          if (distance < 5 && dt < 50) {
            this.state.metrics.jitterCount++;
          }
          
          if ((vx * this.lastMouse.vx < 0) || (vy * this.lastMouse.vy < 0)) {
            if (velocity > 0.5) this.state.metrics.directionChanges++;
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
    if (!this.state.isObserving || this.state.hidden) return;
    const touch = e.touches[0];
    if (touch) {
      this.handleMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY
      });
    }
  }

  endTouch() {
    this.lastMouse.time = 0; // Reset velocity calculation between touches
  }

  handleWheel(e) {
    if (!this.state.isObserving || this.state.hidden) return;
    // Track scroll velocity
    const velocity = Math.abs(e.deltaY);
    if (velocity > this.state.metrics.maxScrollVelocity) {
      this.state.metrics.maxScrollVelocity = velocity;
    }
  }

  handleScroll() {
    if (!this.state.isObserving || this.state.hidden) return;
    this.state.metrics.scrollCount++;
    this.state.metrics.lastActivityTime = performance.now();
  }

  handleClick(e) {
    if (!this.state.isObserving || this.state.hidden) return;
    if (e.target.closest('#sound-toggle')) return;
    
    // Update interaction metric indicator
    this.updateMetricIndicator('interaction', true);
    
    this.state.metrics.clickCount++;
    this.state.metrics.lastActivityTime = performance.now();
    
    if (!this.state.reducedMotion) {
      this.createRipple(e.clientX, e.clientY);
    }
  }

  updateMetricIndicator(metric, active) {
    const dot = document.querySelector(`[data-metric="${metric}"]`);
    if (dot) {
      if (active) {
        dot.classList.add('active');
        // Auto-remove active class after a short delay
        setTimeout(() => {
          dot.classList.remove('active');
        }, 500);
      }
    }
  }

  createRipple(x, y) {
    if (!this.state.isObserving) return;
    
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
    setTimeout(() => ripple.remove(), 600);
  }

  handleTyping(e) {
    if (!this.state.isObserving) return;
    
    // Ignore IME composition events
    if (e.isComposing || e.key === 'Dead') return;
    
    // Update input metric indicator
    this.updateMetricIndicator('input', true);
    
    const now = performance.now();
    
    if (e.key === 'Backspace') {
      this.state.metrics.backspaces++;
      const field = this.elements['typing-field'];
      if (field) {
        field.style.borderColor = 'rgba(255, 100, 100, 0.6)';
        setTimeout(() => {
          field.style.borderColor = '';
        }, 100);
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.state.metrics.keystrokes++;
    }
    
    this.state.metrics.lastActivityTime = now;
  }

  handleInput(e) {
    if (!this.state.isObserving) return;
    // Use input event only for composition end detection (mobile)
    this.state.metrics.lastActivityTime = performance.now();
  }

  stopObservation() {
    this.state.isObserving = false;
    clearInterval(this.timers.countdown);
    clearInterval(this.timers.idle);
    cancelAnimationFrame(this.timers.main);
  }

  completeObservation() {
    this.stopObservation();
    this.switchScreen('transition-screen');
    this.calculateResults();
    
    setTimeout(() => {
      if (!this.state.isObserving) { // Check not reset
        this.applyTheme();
        this.displayResults();
        this.persistResult();
      }
    }, 2500);
  }

  calculateResults() {
    const m = this.state.metrics;
    const durationSec = 30;
    
    // Safe calculations avoiding division by zero
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
    
    // Algorithmic scoring (balanced)
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
    
    // Determine dominant (with tie-breakers)
    let dominant = 'Observer';
    let maxScore = -1;
    
    const entries = Object.entries(scores);
    entries.sort((a, b) => b[1] - a[1]);
    
    if (entries[0][1] > 0) {
      dominant = entries[0][0];
      // Tie-breaker logic
      if (entries[1] && entries[0][1] === entries[1][1]) {
        if (entries[1][0] === 'Impulsive' && avgVelocity > 1) dominant = 'Impulsive';
        else if (entries[1][0] === 'Analytical' && avgIdleGap > 2000) dominant = 'Analytical';
      }
    } else {
      // Fallbacks with safe guards
      if (m.mouseDistance > 2000 && !isNaN(m.mouseDistance)) dominant = 'Restless';
      else if (m.backspaces > 0) dominant = 'Perfectionist';
      else if (m.clickCount > 5) dominant = 'Impulsive';
    }
    
    this.state.personality = dominant;
    
    // Sub-scores with bounds checking and NaN protection
    this.state.scores = {
      focus: this.normalizeScore((avgVelocity * 20) + (activityDensity * 10)),
      hesitation: this.normalizeScore((deletionRate * 50) + (avgIdleGap / 50)),
      controlBias: this.normalizeScore(
        clickRate + scrollRate > 0 
          ? (clickRate / (clickRate + scrollRate)) * 100 
          : 50, 
        50
      ),
      energy: this.normalizeScore(Math.min(100, activityDensity * 10))
    };
    
    // Ensure all scores are valid numbers
    Object.keys(this.state.scores).forEach(key => {
      if (isNaN(this.state.scores[key]) || !isFinite(this.state.scores[key])) {
        this.state.scores[key] = 50; // Default middle value
      }
    });
  }

  normalizeScore(val, center = 50) {
    return Math.max(5, Math.min(95, Math.round(val)));
  }

  applyTheme() {
    if (!this.state.personality || this.state.themeApplied) return;
    
    // Remove previous theme classes safely
    Array.from(document.body.classList).forEach(cls => {
      if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    });
    
    document.body.classList.add(`theme-${this.state.personality.toLowerCase()}`);
    this.state.themeApplied = true;
    
    if (this.state.reducedMotion) return;
    
    // Personality visual adjustments
    if (this.state.personality === 'Impulsive') {
      this.particles.forEach(p => {
        p.vx *= 3;
        p.vy *= 3;
      });
    } else if (this.state.personality === 'Restless') {
      // Limit glitch to non-reduced-motion
      this.addGlitchEffect();
    }
  }

  addGlitchEffect() {
    if (this.state.reducedMotion) return;
    
    const glitch = () => {
      if (!document.body.classList.contains('theme-restless')) return;
      if (Math.random() > 0.3) return; // Only 30% of scheduled times
      
      const screens = document.querySelectorAll('.screen.active');
      screens.forEach(screen => {
        const x = (Math.random() * 4 - 2).toFixed(2);
        const y = (Math.random() * 4 - 2).toFixed(2);
        screen.style.transform = `translate(${x}px, ${y}px)`;
        setTimeout(() => {
          screen.style.transform = '';
        }, 50);
      });
      
      // Schedule next glitch (randomized)
      this.timers.glitch = setTimeout(glitch, Math.random() * 8000 + 5000);
    };
    
    this.timers.glitch = setTimeout(glitch, 3000);
  }

  displayResults() {
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
      // Announce to screen readers
      traitEl.setAttribute('aria-label', `Your personality type is ${this.state.personality}`);
    }
    
    const interpEl = this.elements['interpretation'];
    if (interpEl) {
      interpEl.textContent = interpretations[this.state.personality] || 'Analysis complete.';
    }
    
    // Animate metrics with IntersectionObserver or setTimeout
    const metrics = ['focus', 'hesitation', 'controlBias', 'energy'];
    metrics.forEach((metric, index) => {
      setTimeout(() => {
        const bar = this.elements[`${metric.toLowerCase()}-bar`];
        const value = this.elements[`${metric.toLowerCase()}-value`];
        
        if (bar && value) {
          const score = this.state.scores[metric];
          const displayValue = metric === 'controlBias' ? `${score}%` : score;
          
          bar.style.width = `${score}%`;
          bar.setAttribute('aria-valuenow', score);
          value.textContent = displayValue;
        }
      }, 200 + (index * 150));
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
        console.warn('Failed to save result');
      }
    }
  }

  loadPreviousResult() {
    try {
      const saved = localStorage.getItem('adaptiveMirror_result_v2');
      if (saved && this.elements['returning-message']) {
        // Verify it's valid JSON
        JSON.parse(saved);
        this.elements['returning-message'].classList.remove('hidden');
      }
    } catch (e) {
      // Invalid JSON or other error
      localStorage.removeItem('adaptiveMirror_result_v2');
    }
  }

  switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
      screen.style.visibility = 'hidden';
      
      // Only set aria-hidden if no element within this screen has focus
      if (!screen.contains(document.activeElement)) {
        screen.setAttribute('aria-hidden', 'true');
      }
    });
    
    const target = document.getElementById(screenId);
    if (target) {
      target.style.visibility = 'visible';
      target.setAttribute('aria-hidden', 'false');
      // Force reflow
      void target.offsetWidth;
      target.classList.add('active');
      
      // Update title for accessibility
      document.title = `Adaptive Mirror | ${screenId.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
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
      this.state.audioContext.resume();
    }
    
    this.playTone(600, 0.05, 'sine');
  }

  playTone(frequency, duration, type = 'sine') {
    if (!this.state.soundEnabled || !this.state.audioContext) return;
    
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
    if (!this.state.soundEnabled || !this.state.audioContext) return;
    
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.2, 'sine'), i * 100);
    });
  }

  startRenderLoop() {
    // Pause when hidden to save battery
    if (document.hidden || this.state.reducedMotion) {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
      }
      return;
    }
    
    const render = () => {
      if (!this.ctx || document.hidden || this.state.reducedMotion) {
        if (this.animationFrame) {
          cancelAnimationFrame(this.animationFrame);
          this.animationFrame = null;
        }
        return;
      }
      
      try {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        const time = Date.now() * 0.001;
        
        // Update particles
        this.particles.forEach((p, i) => {
          this.updateParticle(p, time, i);
          this.drawParticle(p);
        });
        
        this.drawConnections();
      } catch (e) {
        console.error('Render error', e);
      }
      
      this.animationFrame = requestAnimationFrame(render);
    };
    
    this.animationFrame = requestAnimationFrame(render);
  }

  updateParticle(p, time, index) {
    if (this.state.reducedMotion) return;
    
    let speed = 1;
    if (this.state.personality === 'Impulsive') speed = 2.5;
    else if (this.state.personality === 'Restless') speed = 1.8;
    else if (this.state.personality === 'Analytical') speed = 0.3;
    
    p.x += p.vx * speed;
    p.y += p.vy * speed;
    
    if (this.state.personality === 'Restless') {
      p.vx += Math.sin(time + index) * 0.02;
      p.vy += Math.cos(time * 1.5 + index) * 0.02;
    }
    
    // Bounce instead of wrap (less jarring)
    if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
    if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
  }

  drawParticle(p) {
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
    const maxConnections = 3; // Limit connections per particle
    
    this.particles.forEach((p1, i) => {
      let connections = 0;
      for (let j = i + 1; j < this.particles.length && connections < maxConnections; j++) {
        const p2 = this.particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < maxDistance) {
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

  updateTimestamp() {
    if (this.elements['result-timestamp']) {
      // Use ISO format for datetime attribute
      const now = new Date();
      this.elements['result-timestamp'].dateTime = now.toISOString();
      this.elements['result-timestamp'].textContent = 
        now.toLocaleDateString(undefined, { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        }) + ' ' + 
        now.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        });
    }
    
    if (this.elements['session-id']) {
      // Only generate if empty to avoid changing on reload
      if (!this.elements['session-id'].textContent || this.elements['session-id'].textContent === '———') {
        this.elements['session-id'].textContent = 
          Math.random().toString(36).substring(2, 10).toUpperCase();
      }
    }
  }

  exportData() {
    try {
      const data = {
        personality: this.state.personality,
        scores: this.state.scores,
        timestamp: new Date().toISOString(),
        metrics: this.state.metrics,
        sessionId: this.elements['session-id']?.textContent || 'N/A',
        userAgent: navigator.userAgent,
        screen: {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth
        }
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `adaptive-mirror-result-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Visual feedback
      const btn = this.elements['export-btn'];
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="btn-icon" aria-hidden="true">✓</span><span class="btn-text">Exported!</span>';
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 2000);
      }
    } catch (error) {
      console.error('Export failed:', error);
      // Show error to user
      alert('Export failed. Please try again.');
    }
  }

  reset() {
    this.stopObservation();
    
    // Clear any pending glitch timers
    if (this.timers.glitch) clearTimeout(this.timers.glitch);
    
    this.state.personality = null;
    this.state.themeApplied = false;
    this.state.scores = {};
    
    // Remove theme classes safely
    document.body.classList.forEach(cls => {
      if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    });
    
    this.createParticles();
    this.switchScreen('intro-screen');
    
    // Reset metrics display
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

  // Utility methods
  throttle(fn, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
}

// Initialize application safely
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.adaptiveMirror = new AdaptiveMirror();
  });
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