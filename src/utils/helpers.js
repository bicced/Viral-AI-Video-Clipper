/**
 * Extract YouTube video ID from URL
 * @param {string} url - YouTube URL
 * @returns {string} - Video ID
 */
function getVideoId(url) {
  try {
    const urlObj = new URL(url);
    
    // Handle youtube.com URLs
    if (urlObj.hostname.includes('youtube.com')) {
      return urlObj.searchParams.get('v') || 'video';
    }
    
    // Handle youtu.be URLs
    if (urlObj.hostname.includes('youtu.be')) {
      return urlObj.pathname.substring(1) || 'video';
    }
    
    // Fallback for other formats
    return 'video';
  } catch (error) {
    return 'video';
  }
}

/**
 * Extract a key phrase from text for captioning
 * @param {string} text - The text to extract a phrase from
 * @returns {string} - Selected phrase for caption
 */
function getKeyPhrase(text) {
  if (!text) return "No text available";
  
  // Try to find a sentence that contains keywords
  const keywords = [
    'important', 'key', 'essential', 'crucial', 'must', 
    'best', 'top', 'first', 'finally', 'remember', 'strategy'
  ];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  
  for (const keyword of keywords) {
    const matchingSentence = sentences.find(s => 
      s.toLowerCase().includes(keyword.toLowerCase())
    );
    if (matchingSentence) {
      // Clean up and truncate the sentence if needed
      return matchingSentence.trim().substring(0, 100) + 
        (matchingSentence.length > 100 ? '...' : '');
    }
  }
  
  // If no keyword matches, take the first sentence or truncate text
  if (sentences.length > 0) {
    return sentences[0].trim().substring(0, 100) + 
      (sentences[0].length > 100 ? '...' : '');
  }
  
  // Last resort: truncate the original text
  return text.substring(0, 100) + (text.length > 100 ? '...' : '');
}

/**
 * Ensure all required directories exist
 * @param {Array<string>} dirs - List of directories to create
 */
function setupOutputDirectories(dirs) {
  const fs = require('fs');
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Validate clip parameters and fix if necessary
 * @param {Object} clip - Clip object with start, end, duration
 * @param {Object} constraints - Min/max constraints
 * @returns {Object} - Validated clip
 */
function validateClipTiming(clip, constraints) {
  const { MIN_DURATION, MAX_DURATION } = constraints;
  
  // Make a copy to avoid modifying the original
  const validatedClip = { ...clip };
  
  // Fix start time
  if (isNaN(validatedClip.start) || validatedClip.start < 0) {
    validatedClip.start = 0;
  }
  
  // Fix end time
  if (isNaN(validatedClip.end) || validatedClip.end <= validatedClip.start) {
    validatedClip.end = validatedClip.start + Math.max(MIN_DURATION, 15);
  }
  
  // Calculate duration
  validatedClip.duration = validatedClip.end - validatedClip.start;
  
  // Fix duration if needed
  if (validatedClip.duration > MAX_DURATION) {
    validatedClip.end = validatedClip.start + MAX_DURATION;
    validatedClip.duration = MAX_DURATION;
  } else if (validatedClip.duration < MIN_DURATION) {
    validatedClip.end = validatedClip.start + MIN_DURATION;
    validatedClip.duration = MIN_DURATION;
  }
  
  return validatedClip;
}

module.exports = {
  getVideoId,
  getKeyPhrase,
  setupOutputDirectories,
  validateClipTiming
}; 