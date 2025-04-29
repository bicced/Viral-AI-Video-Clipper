const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { appendToLog } = require('../utils/logger');
const { ASSEMBLYAI_API_KEY } = require('../config/keys');
const { DIRS } = require('../config/constants');

/**
 * Upload audio file to AssemblyAI
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<string>} - Upload URL
 */
async function uploadAudioToAssemblyAI(audioFilePath) {
  appendToLog('Uploading audio to AssemblyAI...', 'INFO');
  const startTime = Date.now();
  
  if (!ASSEMBLYAI_API_KEY) {
    throw new Error('AssemblyAI API key is not set');
  }
  
  if (!fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found at ${audioFilePath}`);
  }
  
  try {
    const response = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fs.createReadStream(audioFilePath),
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': ASSEMBLYAI_API_KEY
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    appendToLog(`Audio uploaded in ${duration} seconds. Upload URL: ${response.data.upload_url}`, 'INFO');
    
    return response.data.upload_url;
  } catch (error) {
    appendToLog(`Error uploading audio: ${error.message}`, 'ERROR');
    if (error.response) {
      appendToLog(`AssemblyAI response: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    throw error;
  }
}

/**
 * Submit transcription job to AssemblyAI
 * @param {string} audioUrl - URL of uploaded audio
 * @param {Object} options - Transcription options
 * @returns {Promise<string>} - Transcription ID
 */
async function submitTranscriptionJob(audioUrl, options = {}) {
  appendToLog('Submitting transcription job to AssemblyAI...', 'INFO');
  
  const transcriptionOptions = {
    audio_url: audioUrl,
    speaker_labels: true,
    auto_chapters: true,
    ...options
  };
  
  try {
    const response = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      transcriptionOptions,
      {
        headers: {
          'Authorization': ASSEMBLYAI_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    appendToLog(`Transcription job submitted. ID: ${response.data.id}`, 'INFO');
    return response.data.id;
  } catch (error) {
    appendToLog(`Error submitting transcription job: ${error.message}`, 'ERROR');
    if (error.response) {
      appendToLog(`AssemblyAI response: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    throw error;
  }
}

/**
 * Check transcription status
 * @param {string} transcriptionId - Transcription ID
 * @returns {Promise<Object>} - Transcription status
 */
async function checkTranscriptionStatus(transcriptionId) {
  try {
    const response = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptionId}`,
      {
        headers: {
          'Authorization': ASSEMBLYAI_API_KEY
        }
      }
    );
    
    return response.data;
  } catch (error) {
    appendToLog(`Error checking transcription status: ${error.message}`, 'ERROR');
    if (error.response) {
      appendToLog(`AssemblyAI response: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    throw error;
  }
}

/**
 * Poll for transcription completion
 * @param {string} transcriptionId - Transcription ID
 * @returns {Promise<Object>} - Completed transcription
 */
async function pollForTranscriptionCompletion(transcriptionId) {
  appendToLog(`Polling for transcription completion. ID: ${transcriptionId}`, 'INFO');
  const startTime = Date.now();
  
  // Poll every 5 seconds
  const pollingInterval = 5000;
  let transcription;
  
  while (true) {
    transcription = await checkTranscriptionStatus(transcriptionId);
    
    if (transcription.status === 'completed') {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      appendToLog(`Transcription completed in ${duration} seconds`, 'INFO');
      break;
    } else if (transcription.status === 'error') {
      appendToLog(`Transcription failed: ${transcription.error}`, 'ERROR');
      throw new Error(`Transcription failed: ${transcription.error}`);
    } else {
      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(0);
      appendToLog(`Transcription in progress (${elapsedTime}s elapsed). Status: ${transcription.status}`, 'INFO');
      await new Promise(resolve => setTimeout(resolve, pollingInterval));
    }
  }
  
  return transcription;
}

/**
 * Transcribe audio file using AssemblyAI
 * @param {string} audioPath - Path to audio file
 * @param {string} outputPath - Path to save transcription
 * @param {Object} options - Transcription options
 * @returns {Promise<Object>} - Transcription data
 */
async function transcribeAudio(audioPath, outputPath, options = {}) {
  appendToLog(`Transcribing audio file: ${audioPath}`, 'INFO');
  
  // Check if output file already exists
  if (fs.existsSync(outputPath)) {
    appendToLog(`Transcription already exists at ${outputPath}. Loading from file.`, 'INFO');
    try {
      const transcriptionData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      return transcriptionData;
    } catch (error) {
      appendToLog(`Error reading existing transcription: ${error.message}. Will retranscribe.`, 'WARNING');
    }
  }
  
  try {
    // Upload audio file
    const uploadUrl = await uploadAudioToAssemblyAI(audioPath);
    
    // Submit transcription job
    const transcriptionId = await submitTranscriptionJob(uploadUrl, options);
    
    // Poll for completion
    const transcription = await pollForTranscriptionCompletion(transcriptionId);
    
    // Log transcription statistics
    appendToLog(`Transcription completed with ${transcription.words?.length || 0} words, ${transcription.utterances?.length || 0} utterances, ${transcription.chapters?.length || 0} chapters`, 'INFO');
    
    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      appendToLog(`Creating transcript directory: ${dir}`, 'INFO');
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Save transcription to file
    fs.writeFileSync(outputPath, JSON.stringify(transcription, null, 2));
    appendToLog(`Transcription saved to ${outputPath}`, 'INFO');
    
    return transcription;
  } catch (error) {
    appendToLog(`Error in transcription process: ${error.message}`, 'ERROR');
    throw error;
  }
}

module.exports = {
  uploadAudioToAssemblyAI,
  submitTranscriptionJob,
  checkTranscriptionStatus,
  pollForTranscriptionCompletion,
  transcribeAudio
}; 