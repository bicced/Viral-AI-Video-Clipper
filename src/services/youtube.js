const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const { appendToLog } = require('../utils/logger');
const { getVideoId } = require('../utils/helpers');
const { DIRS } = require('../config/constants');

/**
 * Download a YouTube video
 * @param {string} url - YouTube URL
 * @param {string} outputPath - Path to save the video
 * @param {string} videoId - Video ID
 * @returns {Promise<string>} - Path to the downloaded video
 */
async function downloadYouTubeVideo(url, outputPath, videoId) {
  appendToLog('Downloading YouTube video...', 'INFO');
  const startTime = Date.now();

  // Check if yt-dlp is installed
  try {
    await new Promise((resolve, reject) => {
      exec('which yt-dlp', (error) => {
        if (error) {
          appendToLog('yt-dlp not found. Please install yt-dlp: brew install yt-dlp', 'ERROR');
          reject(new Error('yt-dlp not found'));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    throw error;
  }

  // Download video using yt-dlp
  return new Promise((resolve, reject) => {
    const videoPath = path.join(outputPath, `${videoId}.mp4`);
    
    // Check if video already exists
    if (fs.existsSync(videoPath)) {
      appendToLog(`Video already exists at ${videoPath}`, 'INFO');
      resolve(videoPath);
      return;
    }
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    
    // Command to download video
    const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${url}" -o "${videoPath}"`;
    
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        appendToLog(`Error downloading video: ${error.message}`, 'ERROR');
        appendToLog(stderr, 'ERROR');
        reject(error);
        return;
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      appendToLog(`Video downloaded to ${videoPath} in ${duration} seconds`, 'INFO');
      resolve(videoPath);
    });
  });
}

/**
 * Extract audio from video
 * @param {string} videoPath - Path to the video
 * @param {string} audioPath - Path to save the audio
 * @returns {Promise<string>} - Path to the extracted audio
 */
async function extractAudio(videoPath, audioPath) {
  appendToLog('Extracting audio from video...', 'INFO');
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    // Check if video exists
    if (!fs.existsSync(videoPath)) {
      appendToLog(`Video file not found at ${videoPath}`, 'ERROR');
      reject(new Error(`Video file not found at ${videoPath}`));
      return;
    }
    
    // Create output directory if it doesn't exist
    const audioDir = path.dirname(audioPath);
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Check if audio already exists
    if (fs.existsSync(audioPath)) {
      appendToLog(`Audio already exists at ${audioPath}`, 'INFO');
      resolve(audioPath);
      return;
    }
    
    // Command to extract audio
    const cmd = `ffmpeg -i "${videoPath}" -q:a 0 -map a "${audioPath}" -y`;
    
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        appendToLog(`Error extracting audio: ${error.message}`, 'ERROR');
        appendToLog(stderr, 'ERROR');
        reject(error);
        return;
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      appendToLog(`Audio extracted to ${audioPath} in ${duration} seconds`, 'INFO');
      resolve(audioPath);
    });
  });
}

/**
 * Download a YouTube video and extract its audio
 * @param {string} youtubeUrl - YouTube URL
 * @param {Object} options - Options for downloading
 * @returns {Promise<Object>} - Paths to video and audio
 */
async function processYouTubeVideo(youtubeUrl, options = {}) {
  if (!youtubeUrl) {
    throw new Error('YouTube URL is required');
  }
  
  const videoId = getVideoId(youtubeUrl);
  const videoPath = path.join(DIRS.VIDEO, `${videoId}.mp4`);
  const audioPath = path.join(DIRS.AUDIO, `${videoId}.mp3`);
  
  let finalVideoPath = videoPath;
  
  // Download video if not skipping
  if (!options.skipDownload) {
    finalVideoPath = await downloadYouTubeVideo(youtubeUrl, DIRS.VIDEO, videoId);
  } else {
    appendToLog('Skipping video download as requested', 'INFO');
    // Check if video exists when skipping download
    if (!fs.existsSync(videoPath)) {
      appendToLog(`Warning: Skipping download but video file not found at ${videoPath}`, 'WARNING');
    }
  }
  
  // Extract audio if not skipping
  let finalAudioPath = audioPath;
  if (!options.skipAudioExtraction) {
    finalAudioPath = await extractAudio(finalVideoPath, audioPath);
  } else {
    appendToLog('Skipping audio extraction as requested', 'INFO');
    // Check if audio exists when skipping extraction
    if (!fs.existsSync(audioPath)) {
      appendToLog(`Warning: Skipping audio extraction but audio file not found at ${audioPath}`, 'WARNING');
    }
  }
  
  return {
    videoPath: finalVideoPath,
    audioPath: finalAudioPath,
    videoId
  };
}

module.exports = {
  downloadYouTubeVideo,
  extractAudio,
  processYouTubeVideo
}; 