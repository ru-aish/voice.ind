require('dotenv').config();
const { GroqProvider } = require('../src/core/llm/groq-provider');
const { toolDefinitions } = require('../src/tools');

function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

async function runTest(prompt, testLabel) {
  console.log(`\n=== ${testLabel} ===`);
  console.log(`Prompt: "${prompt}"\n`);

  const config = {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: parseFloat(process.env.GROQ_TEMPERATURE) || 0.2,
    maxCompletionTokens: parseInt(process.env.GROQ_MAX_TOKENS) || 400,
    topP: parseFloat(process.env.GROQ_TOP_P) || 1,
    reasoningEffort: process.env.GROQ_REASONING_EFFORT || 'low',
    stop: process.env.GROQ_STOP === 'null' ? null : process.env.GROQ_STOP,
    allowReasoningFallback: process.env.GROQ_ALLOW_REASONING_FALLBACK === 'true',
  };

  const provider = new GroqProvider(config);

  const toolCalls = [];
  const tokens = [];

  const groqTools = toolDefinitions.map(tool => ({
    type: 'function',
    function: tool,
  }));

  const result = await provider.streamText({
    prompt,
    tools: groqTools,
    onToken: (token) => {
      tokens.push(token);
    },
    onToolCall: (toolCall) => {
      toolCalls.push(toolCall);
      console.log('Tool call detected:', JSON.stringify(toolCall, null, 2));
    },
  });

  console.log('\n--- Results ---');
  console.log('Generated text:', result.generatedText || '(none)');
  console.log('Finish reason:', result.finishReason);
  console.log('Tool calls count:', result.toolCalls.length);
  
  if (result.toolCalls.length > 0) {
    console.log('\nTool calls:');
    for (const tc of result.toolCalls) {
      console.log(`  - ${tc.function.name}: ${tc.function.arguments}`);
    }
  }

  console.log('\nMetrics:');
  console.log(`  - Tokens (approx): ${result.tokenCountApprox}`);
  console.log(`  - TPS: ${result.tpsApprox}`);
  console.log(`  - Duration: ${result.streamCompletedAtMs - result.promptSentAtMs}ms`);

  return result;
}

async function main() {
  console.log('=== Groq Provider Tool Calling Test ===');
  console.log('Model:', process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
  console.log('Available tools:', toolDefinitions.map(t => t.name).join(', '));

  if (!process.env.GROQ_API_KEY) {
    console.error('ERROR: GROQ_API_KEY not found in environment');
    process.exit(1);
  }

  const tomorrow = getTomorrowDate();

  await runTest(
    `What time slots are available on ${tomorrow} for a demo?`,
    'Test 1: Check Availability'
  );

  await runTest(
    `My name is John and I want to book a demo for ${tomorrow} at 10am. My email is john@test.com`,
    'Test 2: Book Demo with Lead Info'
  );

  console.log('\n=== All tests completed ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
