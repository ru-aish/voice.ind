require('dotenv').config({ quiet: true });

const { loadConfig, validateStartupConfig } = require('./config');
const { VoiceWebSocketServer } = require('./server/websocket-server');

async function main() {
  const config = loadConfig();
  validateStartupConfig(config);

  const server = new VoiceWebSocketServer(config);
  const started = await server.start();

  if (!config.keys.sarvamApiKey) {
    console.warn(
      '[voice.ai] SARVAM_API_KEY not set — STT/TTS disabled until configured (LLM/personalization still work)'
    );
  }

  console.log('[voice.ai] websocket server started');
  console.log(
    `[voice.ai] ws://0.0.0.0:${started.port}${started.path} llm=${config.llm.provider} stt=${config.stt.provider} tts=${config.tts.provider} log_level=${config.server.logLevel}`
  );
  console.log(
    `[voice.ai] groq_model=${config.groq.model} groq_max_tokens=${config.groq.maxCompletionTokens} cerebras_model=${config.cerebras.model} cerebras_max_tokens=${config.cerebras.maxCompletionTokens}`
  );
  console.log(
    `[voice.ai] prompt_source=${config.diagnostics.sharedPromptSource} prompt_file=${config.diagnostics.promptFilePath} prompt_chars=${config.diagnostics.sharedPromptChars} overrides(groq=${config.diagnostics.groqPromptOverride},cerebras=${config.diagnostics.cerebrasPromptOverride},sarvam=${config.diagnostics.sarvamPromptOverride},gemini=${config.diagnostics.geminiPromptOverride})`
  );

  const shutdown = async (signal) => {
    console.log(`[voice.ai] stopping on ${signal}...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((err) => {
      console.error(`[voice.ai] shutdown error: ${err?.message || err}`);
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((err) => {
      console.error(`[voice.ai] shutdown error: ${err?.message || err}`);
      process.exit(1);
    });
  });
}

main().catch((err) => {
  console.error(`[voice.ai] fatal: ${err?.message || err}`);
  process.exit(1);
});
