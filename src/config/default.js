// Default configuration object (can be overridden by command line args)
const { CLIP, VIDEO, AUDIO, CAPTIONS } = require('./constants');

// Default YouTube URL to process if none provided
const DEFAULT_YOUTUBE_URL = 'https://www.youtube.com/watch?v=0siE31sqz0Q';

const DEFAULT_CONFIG = {
  // Clip parameters
  clipMinDuration: CLIP.MIN_DURATION,
  clipMaxDuration: CLIP.MAX_DURATION,
  clipIdealDuration: CLIP.IDEAL_DURATION,
  
  // Video format
  videoWidth: VIDEO.WIDTH,
  videoHeight: VIDEO.HEIGHT,
  videoBitrate: VIDEO.BITRATE,
  videoQuality: VIDEO.QUALITY,
  
  // Audio format
  audioBitrate: AUDIO.BITRATE,
  
  // Caption settings
  captionFontSize: CAPTIONS.FONT_SIZE,
  captionPosition: CAPTIONS.POSITION,
  
  // Source video customization
  youtubeUrl: DEFAULT_YOUTUBE_URL,
  
  // Process flags
  skipDownload: false,
  skipTranscription: false,
  useExistingTranscript: false
};

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_YOUTUBE_URL
}; 