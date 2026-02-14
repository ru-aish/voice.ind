// Runtime configuration for the voice AI frontend
// This file is loaded before the app and sets window.VOICE_SERVER_URL
// For local development, change this to your local backend URL

(function() {
  // Detect if we're in local development
  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname.startsWith('192.168.');
  
  if (isLocalhost) {
    // Local development - connect to local backend
    window.VOICE_SERVER_URL = 'ws://localhost:8081/';
    console.log('[VoiceAI Config] Local development mode - connecting to:', window.VOICE_SERVER_URL);
  } else {
    // Production - use the deployed backend
    window.VOICE_SERVER_URL = 'wss://voice-ind.onrender.com/';
    console.log('[VoiceAI Config] Production mode - connecting to:', window.VOICE_SERVER_URL);
  }
})();