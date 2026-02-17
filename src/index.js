require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { VoiceWebSocketServer } = require('./server/websocket-server');

async function main() {
  const config = loadConfig();
  const defaultProvider = String(process.env.DEFAULT_PROVIDER || '').trim();
  const pipelineProvider = String(process.env.VOICE_PIPELINE_PROVIDER || '').trim();
  if (
    defaultProvider &&
    pipelineProvider &&
    defaultProvider.toLowerCase() !== pipelineProvider.toLowerCase()
  ) {
    console.warn(
      `[voice.ai] provider_env_conflict DEFAULT_PROVIDER=${defaultProvider} VOICE_PIPELINE_PROVIDER=${pipelineProvider} effective_provider=${config.llm.provider}`
    );
  }

  const server = new VoiceWebSocketServer(config);
  const started = await server.start();

  console.log('[voice.ai] websocket server started');
  console.log(
    `[voice.ai] ws://0.0.0.0:${started.port}${started.path} provider_default=${config.llm.provider} stt_language=${config.stt.languageCode} log_level=${config.server.logLevel}`
  );
  console.log(
    `[voice.ai] groq_model=${config.groq.model} groq_max_tokens=${config.groq.maxCompletionTokens} cerebras_model=${config.cerebras.model} cerebras_max_tokens=${config.cerebras.maxCompletionTokens}`
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
