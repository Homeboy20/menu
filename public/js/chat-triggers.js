/**
 * RestOrder Live Chat Triggers
 * 
 * This script adds proactive chat messages based on user behavior.
 * Compatible with: Intercom, Drift, Crisp, Tawk.to, LiveChat
 * 
 * Installation:
 * 1. Install your preferred chat widget (e.g., Crisp, Intercom)
 * 2. Add this script after your chat widget initialization
 * 3. Customize triggers based on your needs
 * 4. Test on staging before deploying to production
 */

// Configuration
const CHAT_CONFIG = {
  // Time delays (milliseconds)
  INITIAL_GREETING_DELAY: 5000,        // 5 seconds after page load
  PRICING_PAGE_DELAY: 15000,           // 15 seconds on pricing page
  EXIT_INTENT_DELAY: 1000,             // 1 second after exit intent detected
  SCROLL_DEPTH_TRIGGER: 50,            // Trigger at 50% scroll
  IDLE_TIME_TRIGGER: 45000,            // 45 seconds of inactivity
  
  // Enable/disable specific triggers
  ENABLE_INITIAL_GREETING: true,
  ENABLE_PRICING_HELP: true,
  ENABLE_EXIT_INTENT: true,
  ENABLE_SCROLL_TRIGGER: true,
  ENABLE_IDLE_TRIGGER: true,
  
  // Prevent spam
  MAX_TRIGGERS_PER_SESSION: 2,
  COOLDOWN_BETWEEN_TRIGGERS: 60000     // 1 minute cooldown
};

// Session state
let triggersShown = 0;
let lastTriggerTime = 0;
let userHasInteracted = false;

/**
 * Check if we can show another trigger
 */
function canShowTrigger() {
  const now = Date.now();
  const cooldownPassed = (now - lastTriggerTime) > CHAT_CONFIG.COOLDOWN_BETWEEN_TRIGGERS;
  const underLimit = triggersShown < CHAT_CONFIG.MAX_TRIGGERS_PER_SESSION;
  
  return cooldownPassed && underLimit && !userHasInteracted;
}

/**
 * Show chat message (adapt this to your chat platform)
 */
function showChatMessage(message) {
  if (!canShowTrigger()) return;
  
  // Update state
  triggersShown++;
  lastTriggerTime = Date.now();
  
  // Intercom
  if (typeof Intercom !== 'undefined') {
    Intercom('showNewMessage', message);
  }
  
  // Drift
  if (typeof drift !== 'undefined') {
    drift.api.startInteraction({ interactionId: Math.random() });
    drift.api.showWelcomeMessage({ message: message });
  }
  
  // Crisp
  if (typeof $crisp !== 'undefined') {
    $crisp.push(['do', 'message:show', ['text', message]]);
  }
  
  // Tawk.to
  if (typeof Tawk_API !== 'undefined') {
    Tawk_API.addEvent('trigger', { message: message });
  }
  
  // LiveChat
  if (typeof LC_API !== 'undefined') {
    LC_API.open_chat_window();
  }
  
  console.log('[RestOrder Chat] Triggered:', message);
}

/**
 * Trigger 1: Initial Greeting
 */
function initialGreeting() {
  if (!CHAT_CONFIG.ENABLE_INITIAL_GREETING) return;
  
  const messages = [
    "👋 Hi! I'm Alex from RestOrder. Need help setting up your digital menu?",
    "Hey there! 👋 Questions about RestOrder? I'm here to help!",
    "Welcome! 🍽️ Whether you're a restaurant, cafe, bar or juice bar - I can help you get started!",
  ];
  
  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  
  setTimeout(() => {
    showChatMessage(randomMessage);
  }, CHAT_CONFIG.INITIAL_GREETING_DELAY);
}

/**
 * Trigger 2: Pricing Page Assistance
 */
function pricingPageHelp() {
  if (!CHAT_CONFIG.ENABLE_PRICING_HELP) return;
  
  const isPricingPage = window.location.pathname.includes('pricing') || 
                        window.location.hash.includes('pricing');
  
  if (!isPricingPage) return;
  
  setTimeout(() => {
    showChatMessage(
      "💡 Comparing plans? I can help you choose the best option for your business. What's your main priority?"
    );
  }, CHAT_CONFIG.PRICING_PAGE_DELAY);
}

/**
 * Trigger 3: Exit Intent Detection
 */
function exitIntentDetection() {
  if (!CHAT_CONFIG.ENABLE_EXIT_INTENT) return;
  
  let exitIntentShown = false;
  
  document.addEventListener('mouseleave', (e) => {
    if (exitIntentShown) return;
    if (e.clientY <= 0 && canShowTrigger()) {
      exitIntentShown = true;
      showChatMessage(
        "😊 Before you go - is there anything I can help clarify? I'm here if you have questions!"
      );
    }
  });
}

/**
 * Trigger 4: Scroll Depth (engagement signal)
 */
function scrollDepthTrigger() {
  if (!CHAT_CONFIG.ENABLE_SCROLL_TRIGGER) return;
  
  let triggered = false;
  
  window.addEventListener('scroll', () => {
    if (triggered) return;
    
    const scrollPercent = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
    
    if (scrollPercent >= CHAT_CONFIG.SCROLL_DEPTH_TRIGGER && canShowTrigger()) {
      triggered = true;
      showChatMessage(
        "👀 I see you're checking out our features! Any questions so far?"
      );
    }
  });
}

/**
 * Trigger 5: Idle Time (user stuck?)
 */
function idleTimeTrigger() {
  if (!CHAT_CONFIG.ENABLE_IDLE_TRIGGER) return;
  
  let idleTimer;
  
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (canShowTrigger()) {
        showChatMessage(
          "🤔 Still there? Let me know if you need help with anything!"
        );
      }
    }, CHAT_CONFIG.IDLE_TIME_TRIGGER);
  }
  
  // Reset idle timer on user activity
  ['mousedown', 'keypress', 'scroll', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetIdleTimer);
  });
  
  resetIdleTimer();
}

/**
 * Track user interactions with chat
 */
function trackChatInteraction() {
  userHasInteracted = true;
  console.log('[RestOrder Chat] User has interacted with chat');
}

/**
 * Page-specific triggers
 */
function pageSpecificTriggers() {
  const path = window.location.pathname;
  
  // Demo page
  if (path.includes('demo')) {
    setTimeout(() => {
      showChatMessage(
        "🎥 Enjoying the demo? Want to see how it works for your specific business type?"
      );
    }, 20000);
  }
  
  // Features page
  if (path.includes('features')) {
    setTimeout(() => {
      showChatMessage(
        "💡 Curious about a specific feature? Ask me anything about table management, analytics, or ordering!"
      );
    }, 12000);
  }
  
  // Registration page (abandoned signup)
  if (path.includes('register')) {
    setTimeout(() => {
      if (!document.querySelector('input[type="email"]').value) {
        showChatMessage(
          "✋ Need help getting started? I can walk you through the signup process!"
        );
      }
    }, 30000);
  }
}

/**
 * Advanced: A/B Test Chat Triggers
 */
function abTestTriggers() {
  // Randomly assign user to variant
  const variant = Math.random() > 0.5 ? 'A' : 'B';
  
  if (variant === 'A') {
    // Variant A: Friendly and casual
    CHAT_CONFIG.INITIAL_GREETING_DELAY = 5000;
    console.log('[RestOrder Chat] A/B Test: Variant A (Casual)');
  } else {
    // Variant B: Professional and direct
    CHAT_CONFIG.INITIAL_GREETING_DELAY = 10000;
    console.log('[RestOrder Chat] A/B Test: Variant B (Professional)');
  }
  
  // Track variant in analytics
  if (typeof gtag !== 'undefined') {
    gtag('event', 'chat_variant', {
      'variant': variant
    });
  }
}

/**
 * Initialize all triggers
 */
function initChatTriggers() {
  console.log('[RestOrder Chat] Initializing triggers...');
  
  // A/B test (optional)
  // abTestTriggers();
  
  // Initialize triggers
  initialGreeting();
  pricingPageHelp();
  exitIntentDetection();
  scrollDepthTrigger();
  idleTimeTrigger();
  pageSpecificTriggers();
  
  // Track chat interactions
  // This needs to be adapted to your specific chat platform
  if (typeof Intercom !== 'undefined') {
    Intercom('onShow', trackChatInteraction);
    Intercom('onUserEmailSupplied', trackChatInteraction);
  }
  
  if (typeof $crisp !== 'undefined') {
    $crisp.push(['on', 'chat:opened', trackChatInteraction]);
  }
  
  if (typeof drift !== 'undefined') {
    drift.on('startConversation', trackChatInteraction);
  }
}

/**
 * Wait for chat widget to load, then initialize
 */
function waitForChatWidget() {
  const checkInterval = setInterval(() => {
    // Check if any chat platform is loaded
    const chatLoaded = typeof Intercom !== 'undefined' || 
                      typeof $crisp !== 'undefined' ||
                      typeof drift !== 'undefined' ||
                      typeof Tawk_API !== 'undefined' ||
                      typeof LC_API !== 'undefined';
    
    if (chatLoaded) {
      clearInterval(checkInterval);
      initChatTriggers();
    }
  }, 500);
  
  // Stop checking after 15 seconds
  setTimeout(() => clearInterval(checkInterval), 15000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForChatWidget);
} else {
  waitForChatWidget();
}

/**
 * USAGE EXAMPLES:
 * 
 * 1. Add to your HTML (after chat widget):
 *    <script src="/js/chat-triggers.js"></script>
 * 
 * 2. Customize messages in showChatMessage() for your brand voice
 * 
 * 3. Adjust delays in CHAT_CONFIG for your audience
 * 
 * 4. Track conversions in your analytics platform
 * 
 * 5. Test different variants with A/B testing
 * 
 * BEST PRACTICES:
 * - Don't trigger too frequently (respect user attention)
 * - Use friendly, helpful language (not salesy)
 * - Provide value in every message (answer questions, offer help)
 * - Track which triggers convert best
 * - Adjust based on user feedback
 */
