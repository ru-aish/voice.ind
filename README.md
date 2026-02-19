# voice.ai - Real-time Voice AI Server

This project is a WebSocket server for real-time voice conversations using Speech-to-Text (STT), Large Language Models (LLM), and Text-to-Speech (TTS).

## Project Structure

The project is organized into several key directories:

* src: Contains the backend source code.
* src/app: Application-specific logic, including the live voice client.
* src/config: Configuration settings and provider setups.
* src/core: Core modules for the voice pipeline, including STT, LLM, and TTS integrations.
* src/server: WebSocket server implementation and handling.
* src/tools: Utility tools used across the backend.
* src/types: Type definitions for the project.
* src/utils: General utility functions.
* frontend: A Next.js based web interface for interacting with the voice server.
* docs: Project documentation.
* prompts: System prompts used by the LLM.
* scripts: Helper scripts for development and deployment.
* tests: Test suites for verifying project functionality.

## Input and Output Formats

The server communicates via WebSockets using JSON-formatted messages.

### Input Formats

* Audio Data: A message with the type set to audio. The data should contain an audio field with a base64-encoded WAV string. Alternatively, raw binary WebSocket frames can be sent for lower latency.
* Configuration: A message with the type set to config. The data should include a configuration object with fields for language (such as hi-IN) and provider (such as groq).
* Text Input: A message with the type set to text. The data should contain a text field with the string to be processed by the LLM, bypassing the STT step.

### Output Formats

* Audio Output: A message with the type set to audio. The data contains a base64-encoded audio chunk and a segment index.
* Ready Event: A message with the type set to ready, indicating the session is initialized.
* Transcript Event: A message with the type set to transcript, containing the transcribed text from the user's speech.
* Voice Activity: A message with the type set to vad, indicating speech start or end (START_SPEECH or END_SPEECH).
* Metrics: A message with the type set to metrics, providing latency and timing information.
* Error: A message with the type set to error, containing error details if something goes wrong.

## How to Use

### Setup

1. Clone the repository and navigate to the project root.
2. Install backend dependencies using the command: npm install
3. Set up environment variables by creating a .env file in the root. Refer to .env.example for the required keys such as SARVAM_API_KEY and GROQ_API_KEY.
4. Navigate to the frontend directory and install frontend dependencies using: npm install

### Running the Project

1. Start the backend server from the root directory using the command: npm start
   The server will run on ws://localhost:8081 by default.
2. In a separate terminal, navigate to the frontend directory and start the development server using the command: npm run dev
3. Open your browser and navigate to the local frontend address (usually http://localhost:3000) to start the voice interaction.
4. Alternatively, you can run a live voice client from the terminal using the command: npm run client:live
