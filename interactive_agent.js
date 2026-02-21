const { DeepgramClient, AgentEvents } = require("@deepgram/sdk");
require("dotenv").config();
const readline = require("readline");

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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
        console.error("Error: DEEPGRAM_API_KEY not found in environment variables.");
        process.exit(1);
    }

    console.log("\nAvailable Models:");
    workingModels.forEach((m, i) => {
        console.log(`${i + 1}. ${m.model} (${m.provider})`);
    });

    let selectedModelIndex = -1;
    while (selectedModelIndex < 0 || selectedModelIndex >= workingModels.length) {
        const answer = await askQuestion("\nSelect a model (number): ");
        const num = parseInt(answer.trim());
        if (!isNaN(num) && num >= 1 && num <= workingModels.length) {
            selectedModelIndex = num - 1;
        } else {
            console.log("Invalid selection. Please try again.");
        }
    }

    const selectedModel = workingModels[selectedModelIndex];
    console.log(`\nStarting interactive session with ${selectedModel.model}...`);
    console.log("(Note: Audio output is enabled in config but not played in terminal)");

    const deepgram = new DeepgramClient(apiKey);
    const client = deepgram.agent();

    let keepAliveInterval;
    let injectTime = 0;
    let responseStartTime = -1;
    let lastTextTime = -1;
    let responseText = "";
    let isWaitingForResponse = false;

    const cleanup = () => {
        clearInterval(keepAliveInterval);
        try { client.disconnect(); } catch (e) {}
        rl.close();
        process.exit(0);
    };

    client.on(AgentEvents.Open, () => {
        console.log(">> Connected to Deepgram Agent.");

        // Start KeepAlive immediately upon open
        keepAliveInterval = setInterval(() => {
            try { client.keepAlive(); } catch (e) {}
        }, 3000);
        
        // Configure the agent
        client.configure({
            audio: {
                input: { encoding: "linear16", sample_rate: 16000 },
                output: { encoding: "linear16", sample_rate: 16000, container: "none" }
            },
            agent: {
                think: {
                    provider: {
                        type: selectedModel.provider,
                        model: selectedModel.model
                    }
                },
                speak: {
                    provider: {
                        type: "deepgram",
                        model: "aura-asteria-en"
                    }
                }
            }
        });
    });

    client.on(AgentEvents.SettingsApplied, () => {
        console.log(">> Settings Applied. Ready to chat.\n");
        promptUser();
    });

    client.on(AgentEvents.ConversationText, (message) => {
        if (message.role === "assistant") {
            if (responseStartTime === -1) {
                responseStartTime = Date.now();
                const latency = responseStartTime - injectTime;
                process.stdout.write(`\n(TTFT: ${latency}ms)\nAssistant: `);
            }
            process.stdout.write(message.content);
            responseText += message.content;
            lastTextTime = Date.now();
        }
    });

    client.on(AgentEvents.AgentAudioDone, () => {
        if (isWaitingForResponse) {
            const responseEndTime = Date.now();
            
            // Calculate LLM Generation Speed (based on text arrival)
            // If text arrives in one chunk, duration is 0. Clamp to 100ms for realistic peak calculation.
            let llmDurationSec = (lastTextTime - responseStartTime) / 1000;
            if (llmDurationSec < 0.1) llmDurationSec = 0.1; 

            const audioDurationSec = (responseEndTime - responseStartTime) / 1000;
            
            const words = responseText.trim().split(/\s+/).length;
            const tokensEstimated = Math.ceil(words * 1.33); // Rough estimation
            
            const llmTps = tokensEstimated / llmDurationSec;
            const audioTps = audioDurationSec > 0 ? tokensEstimated / audioDurationSec : 0;
            
            console.log(`\n\n[Metrics]`);
            console.log(`TTFT: ${(responseStartTime - injectTime)}ms`);
            console.log(`LLM Speed: ~${llmTps.toFixed(2)} tokens/sec (Duration: ${llmDurationSec.toFixed(2)}s)`);
            console.log(`TTS Speed: ~${audioTps.toFixed(2)} tokens/sec (Duration: ${audioDurationSec.toFixed(2)}s)`);
            console.log(`Total Words: ${words}`);
            
            isWaitingForResponse = false;
            promptUser();
        }
    });

    client.on(AgentEvents.Error, (err) => {
        console.error("\n>> Agent Error:", err);
        // Don't exit immediately on transient errors, but log them
    });

    client.on(AgentEvents.Close, () => {
        console.log("\n>> Connection closed.");
        cleanup();
    });

    function promptUser() {
        rl.question("\nYou: ", (input) => {
            if (input.trim().toLowerCase() === "exit") {
                console.log("Exiting...");
                cleanup();
                return;
            }
            if (!input.trim()) {
                promptUser();
                return;
            }
            
            injectTime = Date.now();
            responseStartTime = -1;
            lastTextTime = -1;
            responseText = "";
            isWaitingForResponse = true;
            client.injectUserMessage(input);
        });
    }
}

main();
