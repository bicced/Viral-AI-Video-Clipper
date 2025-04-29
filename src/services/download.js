/**
 * Video download service
 * Handles downloading videos from YouTube and other platforms
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { appendToLog } = require('../utils/logger');
const { DIRS } = require('../config/constants');

/**
 * Download a video from YouTube or other supported platforms
 * @param {string} url - URL of the video
 * @param {string} outputPath - Path to save the video
 * @returns {Promise<string>} - Path to the downloaded video
 */
async function downloadVideo(url, outputPath) {
  appendToLog(`Downloading video from ${url}`, 'INFO');
  const startTime = Date.now();
  
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      appendToLog(`Creating video directory: ${dir}`, 'INFO');
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Check if yt-dlp is installed
    try {
      execSync('yt-dlp --version');
    } catch (error) {
      appendToLog('yt-dlp not found. Please install it: npm install -g yt-dlp', 'ERROR');
      throw new Error('yt-dlp not installed. Please install it first.');
    }
    
    // Download video using yt-dlp
    appendToLog(`Running yt-dlp to download from ${url}`, 'INFO');
    execSync(`yt-dlp -f best -o "${outputPath}" "${url}"`, { stdio: 'inherit' });
    
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Download completed but video file not found at ${outputPath}`);
    }
    
    const fileSize = fs.statSync(outputPath).size;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    appendToLog(`Video downloaded successfully in ${duration} seconds. File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`, 'INFO');
    return outputPath;
  } catch (error) {
    appendToLog(`Error downloading video: ${error.message}`, 'ERROR');
    throw error;
  }
}

module.exports = {
  downloadVideo
}; 