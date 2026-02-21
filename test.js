const { DeepgramClient, AgentEvents } = require("@deepgram/sdk");
require("dotenv").config();

const workingModels = [
    { provider: "open_ai", model: "gpt-4.1-nano" },
    { provider: "open_ai", model: "gpt-4.1-mini" },
    { provider: "open_ai", model: "gpt-4o-mini" },
    { provider: "open_ai", model: "gpt-4o" },
    { provider: "open_ai", model: "gpt-5.2" },
    { provider: "open_ai", model: "gpt-5-mini" },
    { provider: "open_ai", model: "gpt-5" },
    { provider: "open_ai", model: "gpt-5-nano" }
];

async function benchmarkModel(apiKey, provider, model) {
    return new Promise((resolve) => {
        const deepgram = new DeepgramClient(apiKey);
        const client = deepgram.agent();
        
        let connectTime = Date.now();
        let openLatency = -1;
        let firstTokenLatency = -1;
        let injectTime = -1;
        let responseStartTime = -1;
        let responseEndTime = -1;
        let responseText = "";
        let timeoutHandle;
        let finished = false;
        let keepAliveInterval;

        const cleanup = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timeoutHandle);
            clearInterval(keepAliveInterval);
            try { client.disconnect(); } catch (e) {}
        };

        timeoutHandle = setTimeout(() => {
            cleanup();
            resolve({ model, success: false, error: "Timeout after 45s" });
        }, 45000);

        client.on(AgentEvents.Open, () => {
            openLatency = Date.now() - connectTime;
            keepAliveInterval = setInterval(() => {
                try { client.keepAlive(); } catch (e) {}
            }, 3000);
        });

        client.on(AgentEvents.Welcome, () => {
            const settings = {
                audio: {
                    input: { encoding: "linear16", sample_rate: 16000 },
                    output: { encoding: "linear16", sample_rate: 16000, container: "none" }
                },
                agent: {
                    think: {
                        provider: {
                            type: provider,
                            model: model // Correct nesting found in successful run
                        },
                        prompt: "Explain the concept of entropy in 2 sentences."
                    },
                    speak: {
                        provider: {
                            type: "deepgram",
                            model: "aura-asteria-en"
                        }
                    }
                }
            };
            client.configure(settings);
        });

        client.on(AgentEvents.SettingsApplied, () => {
            injectTime = Date.now();
            client.injectUserMessage("What is entropy?");
        });

        client.on(AgentEvents.ConversationText, (message) => {
            if (message.role === "assistant") {
                if (responseStartTime === -1) {
                    responseStartTime = Date.now();
                    firstTokenLatency = responseStartTime - injectTime;
                }
                responseText += message.content;
            }
        });

        client.on(AgentEvents.AgentAudioDone, () => {
            responseEndTime = Date.now();
            const totalResponseTimeSec = (responseEndTime - responseStartTime) / 1000;
            const words = responseText.trim().split(/\s+/).length;
            const tokensEstimated = Math.ceil(words * 1.33);
            const tps = totalResponseTimeSec > 0 ? tokensEstimated / totalResponseTimeSec : 0;
            
            cleanup();
            resolve({
                model,
                success: true,
                openLatencyMs: openLatency,
                firstTokenLatencyMs: firstTokenLatency,
                totalTps: tps.toFixed(2)
            });
        });

        client.on(AgentEvents.Error, (err) => {
            cleanup();
            resolve({ model, success: false, error: err.message || JSON.stringify(err) });
        });
    });
}

async function run() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    const results = [];
    console.log("Retesting working models (2 iterations each)...\n");

    for (const m of workingModels) {
        for (let i = 0; i < 2; i++) {
            process.stdout.write(`Testing ${m.model} [Iter ${i+1}] ... `);
            const res = await benchmarkModel(apiKey, m.provider, m.model);
            if (res.success) {
                console.log("✅");
                results.push({
                    Model: res.model,
                    Iteration: i + 1,
                    "Open Latency (ms)": res.openLatencyMs,
                    "FTL (ms)": res.firstTokenLatencyMs,
                    "TPS": res.totalTps
                });
            } else {
                console.log(`❌ (${res.error})`);
            }
        }
    }
    console.table(results);
}

run();
