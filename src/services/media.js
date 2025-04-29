/**
 * Media service
 * Handles audio extraction and other media operations
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const { appendToLog } = require('../utils/logger');
const { DIRS } = require('../config/constants');

/**
 * Extract audio from video file
 * @param {string} videoPath - Path to video file
 * @param {string} outputPath - Path to save audio file
 * @returns {Promise<string>} - Path to the extracted audio
 */
async function extractAudio(videoPath, outputPath) {
  appendToLog(`Extracting audio from ${videoPath}`, 'INFO');
  const startTime = Date.now();
  
  try {
    // Check if video file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found at ${videoPath}`);
    }
    
    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      appendToLog(`Creating audio directory: ${dir}`, 'INFO');
      fs.mkdirSync(dir, { recursive: true });
    }
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(outputPath)
        .noVideo()
        .audioQuality(0)
        .on('end', () => {
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          const fileSize = fs.statSync(outputPath).size;
          appendToLog(`Audio extracted successfully in ${duration} seconds. File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`, 'INFO');
          resolve(outputPath);
        })
        .on('error', (err) => {
          appendToLog(`Error extracting audio: ${err.message}`, 'ERROR');
          
          // Fallback to ffmpeg command line if fluent-ffmpeg fails
          try {
            appendToLog('Attempting fallback to ffmpeg command line', 'WARNING');
            execSync(`ffmpeg -i "${videoPath}" -q:a 0 -map a "${outputPath}" -y`, { stdio: 'inherit' });
            
            if (fs.existsSync(outputPath)) {
              const duration = ((Date.now() - startTime) / 1000).toFixed(2);
              const fileSize = fs.statSync(outputPath).size;
              appendToLog(`Audio extracted with fallback method in ${duration} seconds. File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`, 'INFO');
              resolve(outputPath);
            } else {
              reject(new Error('Fallback audio extraction failed'));
            }
          } catch (fallbackError) {
            appendToLog(`Fallback extraction failed: ${fallbackError.message}`, 'ERROR');
            reject(fallbackError);
          }
        })
        .run();
    });
  } catch (error) {
    appendToLog(`Error in audio extraction: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Generate a clip from a video file
 * @param {Object} clip - Clip information
 * @param {string} videoPath - Path to source video
 * @param {string} outputDir - Directory to save the clip
 * @returns {Promise<string>} - Path to the generated clip
 */
async function generateClip(clip, videoPath, outputDir) {
  // Use the global run timestamp if available, or generate a new one
  const timestamp = global.currentRun?.timestamp || Date.now();
  const clipName = `clip_${timestamp}_${Math.floor(clip.start)}_${Math.floor(clip.end)}.mp4`;
  const outputPath = path.join(outputDir, clipName);
  
  appendToLog(`Generating clip: ${clipName} (${clip.start.toFixed(2)}s to ${clip.end.toFixed(2)}s)`, 'INFO');
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    appendToLog(`Creating clips directory: ${outputDir}`, 'INFO');
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // First, check the duration of the source video to ensure our clip is valid
  try {
    // Use ffprobe to get video duration
    const durationCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const videoDuration = parseFloat(execSync(durationCommand).toString().trim());
    
    appendToLog(`Source video duration: ${videoDuration}s`, 'DEBUG');
    
    // Validate clip timestamps against video duration
    if (isNaN(videoDuration)) {
      appendToLog(`Could not determine video duration for ${videoPath}`, 'ERROR');
      throw new Error('Invalid video duration');
    }
    
    // Check if clip is within video bounds
    if (clip.start >= videoDuration) {
      appendToLog(`Clip start time (${clip.start}s) is beyond video duration (${videoDuration}s)`, 'ERROR');
      throw new Error('Clip start time is beyond video duration');
    }
    
    // Adjust start and end times to ensure we don't cut off important content
    // Add variable padding based on clip length for more natural-feeling clips
    const baseClipDuration = clip.end - clip.start;
    
    // Use proportional padding to avoid uniform clip durations
    // Shorter clips get less padding, longer clips get more
    // Cap padding to reasonable limits to prevent excessive padding
    const PADDING_START = Math.min(1.5, Math.max(0.3, baseClipDuration * 0.03));
    const PADDING_END = Math.min(2.5, Math.max(0.5, baseClipDuration * 0.07));
    
    let adjustedStart = Math.max(0, clip.start - PADDING_START);
    let adjustedEnd = Math.min(videoDuration, clip.end + PADDING_END);
    
    appendToLog(`Adjusted clip timestamps with padding: ${adjustedStart.toFixed(2)}s to ${adjustedEnd.toFixed(2)}s`, 'INFO');
    appendToLog(`Padding applied: start=${PADDING_START.toFixed(2)}s, end=${PADDING_END.toFixed(2)}s`, 'DEBUG');
    
    // Update clip duration
    const originalDuration = clip.end - clip.start;
    const adjustedDuration = adjustedEnd - adjustedStart;
    
    appendToLog(`Original duration: ${originalDuration.toFixed(2)}s, Adjusted duration: ${adjustedDuration.toFixed(2)}s`, 'INFO');
    
    // Update clip with adjusted times
    clip.start = adjustedStart;
    clip.end = adjustedEnd;
    clip.duration = adjustedDuration;
    
    // For very short clips (under 6 seconds), we need special handling
    const isVeryShortClip = originalDuration < 6;
    if (isVeryShortClip) {
      // For very short clips, extend them slightly to avoid issues with platforms that have minimum durations
      const MIN_VIABLE_DURATION = 6.0; // Most platforms require at least 5-6 seconds
      
      if (adjustedDuration < MIN_VIABLE_DURATION) {
        const additionalPadding = Math.min(2, MIN_VIABLE_DURATION - adjustedDuration);
        
        // Try to extend the end first, then the start if needed
        let newEnd = Math.min(videoDuration, adjustedEnd + additionalPadding);
        let newStart = adjustedStart;
        
        // If we still need more duration, adjust the start time
        const newDuration = newEnd - newStart;
        if (newDuration < MIN_VIABLE_DURATION) {
          newStart = Math.max(0, newStart - (MIN_VIABLE_DURATION - newDuration));
        }
        
        clip.start = newStart;
        clip.end = newEnd;
        clip.duration = newEnd - newStart;
        
        appendToLog(`Extended very short clip to meet minimum duration: ${clip.duration.toFixed(2)}s`, 'INFO');
      }
    }
    
    // Ensure clip has positive duration
    if (clip.duration <= 0) {
      appendToLog(`Invalid clip duration: ${clip.duration}s`, 'ERROR');
      throw new Error('Invalid clip duration');
    }
  } catch (error) {
    appendToLog(`Error validating clip times: ${error.message}`, 'ERROR');
    throw new Error(`Cannot generate clip: ${error.message}`);
  }
  
  return new Promise((resolve, reject) => {
    // Use better ffmpeg options for higher quality clips
    ffmpeg(videoPath)
      .setStartTime(clip.start)
      .setDuration(clip.duration)
      .output(outputPath)
      // Use copy codec for faster processing and to avoid re-encoding issues
      // This maintains the original quality of the video
      .outputOptions([
        '-c:v libx264', // Use H.264 codec for better compatibility
        '-preset fast',  // Balance between speed and quality
        '-crf 20',       // Quality level - lower is better, 20 is good quality
        '-c:a aac',      // AAC audio codec
        '-b:a 128k',     // Audio bitrate
        '-movflags +faststart' // Optimize for web streaming
      ])
      .on('start', (command) => {
        appendToLog(`FFmpeg command: ${command}`, 'DEBUG');
      })
      .on('end', () => {
        // Validate the generated clip
        try {
          const fileSize = fs.statSync(outputPath).size;
          if (fileSize < 10000) { // Less than 10KB is probably not a valid video
            appendToLog(`Generated clip is too small (${fileSize} bytes), likely an error occurred`, 'ERROR');
            // Try fallback method
            throw new Error('Generated clip file is too small');
          }
          appendToLog(`Clip generated successfully: ${outputPath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`, 'INFO');
          resolve(outputPath);
        } catch (error) {
          reject(new Error(`Clip validation failed: ${error.message}`));
        }
      })
      .on('error', (err) => {
        appendToLog(`Error generating clip: ${err.message}`, 'ERROR');
        
        // Fallback to simpler ffmpeg command if complex operation fails
        try {
          appendToLog('Attempting fallback clip generation', 'WARNING');
          execSync(`ffmpeg -i "${videoPath}" -ss ${clip.start} -t ${clip.duration} -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y`, { stdio: 'inherit' });
          
          if (fs.existsSync(outputPath)) {
            const fileSize = fs.statSync(outputPath).size;
            if (fileSize < 10000) { // Less than 10KB is probably not a valid video
              appendToLog(`Fallback generated clip is too small (${fileSize} bytes), likely an error occurred`, 'ERROR');
              throw new Error('Generated clip file is too small');
            }
            appendToLog(`Clip generated with fallback method: ${outputPath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`, 'INFO');
            resolve(outputPath);
          } else {
            reject(new Error('Fallback clip generation failed'));
          }
        } catch (fallbackError) {
          appendToLog(`Fallback clip generation failed: ${fallbackError.message}`, 'ERROR');
          reject(fallbackError);
        }
      })
      .run();
  });
}

module.exports = {
  extractAudio,
  generateClip
}; 