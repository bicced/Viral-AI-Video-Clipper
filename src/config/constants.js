/**
 * Application constants
 */

const path = require('path');
const fs = require('fs');

// Directory constants
const MEDIA_DIR = 'media'; // Base media directory
const VIDEO_DIR = path.join(MEDIA_DIR, 'videos');
const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');
const CLIPS_DIR = path.join(MEDIA_DIR, 'clips');
const TRANSCRIPT_DIR = path.join(MEDIA_DIR, 'transcripts');
const LOGS_DIR = 'logs';

// Directory and file paths
const DIRS = {
  MEDIA: MEDIA_DIR,
  VIDEO: VIDEO_DIR,
  AUDIO: AUDIO_DIR,
  CLIPS: CLIPS_DIR,
  TRANSCRIPT: TRANSCRIPT_DIR,
  LOGS: LOGS_DIR
};

// Ensure all directories exist
for (const dir of Object.values(DIRS)) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Filename constants
const FILES = {
  TRANSCRIPT_JSON: path.join(DIRS.TRANSCRIPT, 'transcript.json'),
  LOG_FILE: path.join(DIRS.LOGS, `run_${new Date().toISOString().replace(/:/g, '-')}.log`),
  SELECTED_CLIPS_DATA: path.join(DIRS.LOGS, 'selected_clips_data.json'),
};

// Clip parameters
const CLIP = {
  MIN_DURATION: 8, // seconds
  MAX_DURATION: 30, // seconds
  IDEAL_DURATION: 15, // seconds - ideal length for reels
  SENTENCES_PER_CLIP: 3
};

// Default video parameters for processing
const VIDEO = {
  WIDTH: 1080,
  HEIGHT: 1920, // Default 9:16 aspect ratio for vertical video
  BITRATE: '2000k',
  QUALITY: 23 // Lower is better quality (23 is a good balance)
};

// Audio parameters
const AUDIO = {
  BITRATE: '128k'
};

// Caption parameters
const CAPTIONS = {
  FONT_SIZE: 36,
  POSITION: 'bottom' // 'top', 'middle', 'bottom'
};

// API URLs
const API = {
  ASSEMBLYAI_UPLOAD: 'https://api.assemblyai.com/v2/upload',
  ASSEMBLYAI_TRANSCRIPT: 'https://api.assemblyai.com/v2/transcript',
  OPENAI: 'https://api.openai.com/v1/chat/completions'
};

// Regular expressions
const REGEX = {
  VALUABLE_CONTENT: /(important|key|essential|crucial|must|best|top|lesson|learn|discover|strategy|success|growth|tips|advice|how to|problem|solution|benefit|result|outcome|process|method|technique|framework|principle|concept)/i,
  SENTENCES: /[^.!?]+[.!?]+/g,
  WORDS: /\s+/
};

// Default file paths (with new directory structure)
const YOUTUBE_URL = process.env.YOUTUBE_URL || 'https://www.youtube.com/watch?v=0siE31sqz0Q';
const VIDEO_FILE = process.env.VIDEO_FILE || path.join(VIDEO_DIR, 'video.mp4');
const AUDIO_FILE = process.env.AUDIO_FILE || path.join(AUDIO_DIR, 'audio.mp3');
const TRANSCRIPT_FILE = process.env.TRANSCRIPT_FILE || path.join(TRANSCRIPT_DIR, 'transcript.json');

// Logs
const LOG_DIR = process.env.LOG_DIR || LOGS_DIR;
const LOG_FILE = process.env.LOG_FILE || path.join(LOG_DIR, `run_${new Date().toISOString().replace(/:/g, '-')}.log`);

// Clip parameters
const CLIP_MIN_DURATION = parseInt(process.env.CLIP_MIN_DURATION || '8', 10);
const CLIP_MAX_DURATION = parseInt(process.env.CLIP_MAX_DURATION || '30', 10);
const CLIP_IDEAL_DURATION = parseInt(process.env.CLIP_IDEAL_DURATION || '15', 10);

// API endpoints
const API_ENDPOINTS = {
  ASSEMBLYAI_UPLOAD: 'https://api.assemblyai.com/v2/upload',
  ASSEMBLYAI_TRANSCRIPT: 'https://api.assemblyai.com/v2/transcript',
  OPENAI: 'https://api.openai.com/v1/chat/completions'
};

module.exports = {
  DIRS,
  FILES,
  CLIP,
  VIDEO,
  AUDIO,
  CAPTIONS,
  API,
  REGEX,
  YOUTUBE_URL,
  VIDEO_FILE,
  AUDIO_FILE,
  CLIPS_DIR,
  TRANSCRIPT_FILE,
  LOG_DIR,
  LOG_FILE,
  CLIP_MIN_DURATION,
  CLIP_MAX_DURATION,
  CLIP_IDEAL_DURATION,
  API_ENDPOINTS
}; 