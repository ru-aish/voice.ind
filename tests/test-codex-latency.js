const { getGlobalCodexClient } = require('../src/core/llm/codex-provider');
const globalCodexClient = getGlobalCodexClient();

async function runTurn(threadId, prompt, turnNum) {
  return new Promise(async (resolve, reject) => {
    const tStart = Date.now();
    let firstTokenAt = null;
    let replyText = '';
    
    try {
      const turnResp = await globalCodexClient.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
        model: 'gpt-5.5',
        effort: 'low'
      });
      const turnId = turnResp.turn.id;

      const handleNotification = (msg) => {
        const method = msg.method;
        const params = msg.params || {};

        // Filter messages belonging to this turn
        if (params.turnId !== turnId && params.threadId !== threadId) {
          const t = params.turn || {};
          if (t.id !== turnId) return;
        }

        if (method === 'item/agentMessage/delta') {
          const delta = params.delta || '';
          if (delta) {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              console.log(`Turn ${turnNum} First Token Latency (TTFT): ${firstTokenAt - tStart} ms`);
            }
            replyText += delta;
          }
        } else if (method === 'turn/completed') {
          globalCodexClient.off('notification', handleNotification);
          const totalTime = Date.now() - tStart;
          console.log(`Turn ${turnNum} Completed in ${totalTime} ms. Response length: ${replyText.length} chars`);
          resolve({ ttft: firstTokenAt - tStart, total: totalTime });
        }
      };

      globalCodexClient.on('notification', handleNotification);
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
  console.log('Starting Codex Preloaded client...');
  await globalCodexClient.start();
  
  console.log('Starting thread...');
  const threadResp = await globalCodexClient.request('thread/start', {
    cwd: '/home/coder/Code/playground',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    model: 'gpt-5.5'
  });
  const threadId = threadResp.thread.id;
  console.log(`Thread started: ${threadId}`);
  
  // Prompt 1
  const prompt1 = "Write a Python function to check if a number is prime.";
  console.log(`\nSending Turn 1: "${prompt1}"`);
  await runTurn(threadId, prompt1, 1);
  
  // Wait a bit to ensure cache is written/processed
  await new Promise(r => setTimeout(r, 1000));
  
  // Prompt 2
  const prompt2 = "Now modify it to return all prime factors of the number instead.";
  console.log(`\nSending Turn 2: "${prompt2}"`);
  await runTurn(threadId, prompt2, 2);
  
  globalCodexClient.close();
}

main().catch(err => {
  console.error('Error:', err);
  globalCodexClient.close();
});
