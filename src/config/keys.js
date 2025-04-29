/**
 * API keys configuration
 * Loads API keys from environment variables
 */

require('dotenv').config();
const { appendToLog } = require('../utils/logger');

// Load AssemblyAI API key
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
if (!ASSEMBLYAI_API_KEY) {
  console.warn('AssemblyAI API key not found in environment variables. Transcription will not work.');
}

// Load OpenAI API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('OpenAI API key not found in environment variables. AI clip selection will not work.');
}

module.exports = {
  ASSEMBLYAI_API_KEY,
  OPENAI_API_KEY
}; 