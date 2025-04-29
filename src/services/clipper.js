/**
 * Clipper service
 * Handles identification and generation of engaging clips
 */

const fs = require('fs');
const path = require('path');
const { Configuration, OpenAIApi } = require('openai');
const { v4: uuidv4 } = require('uuid');
const { appendToLog } = require('../utils/logger');
const { generateClip } = require('./media');
const { OPENAI_API_KEY } = require('../config/keys');
const { DIRS, CLIP_MIN_DURATION, CLIP_MAX_DURATION, CLIP_IDEAL_DURATION, FILES } = require('../config/constants');

// Initialize OpenAI
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**
 * Identify engaging clips using AI from transcript data
 * @param {Object} transcriptData - Transcript data from AssemblyAI
 * @returns {Promise<Array>} - Array of clip objects
 */
async function identifyClipsWithAI(transcriptData) {
  appendToLog('Identifying engaging clips using AI...', 'INFO');
  
  // Determine which method to use based on transcript structure
  if (transcriptData && transcriptData.text) {
    appendToLog('Using full transcript text for clip identification', 'INFO');
    return identifyClipsFromFullText(transcriptData);
  } else if (transcriptData && transcriptData.utterances && transcriptData.utterances.length > 0) {
    appendToLog('Using utterances for clip identification', 'INFO');
    return identifyClipsFromUtterances(transcriptData.utterances);
  } else if (transcriptData && transcriptData.words && transcriptData.words.length > 0) {
    appendToLog('Using words for clip identification', 'INFO');
    return identifyClipsFromWords(transcriptData.words);
  } else if (transcriptData && transcriptData.chapters && transcriptData.chapters.length > 0) {
    appendToLog('Using chapters for clip identification', 'INFO');
    return identifyClipsFromChapters(transcriptData.chapters);
  } else {
    appendToLog('No suitable transcript structure found. Using basic clip identification...', 'WARNING');
    return identifyClips(transcriptData);
  }
}

/**
 * Create potential clips with different sentence groupings
 * @param {Array} sentences - Array of sentences
 * @param {number} timePerWord - Time per word in seconds
 * @param {string} contentType - Content type
 * @returns {Array} - Array of potential clips
 */
function createPotentialClips(sentences, timePerWord, contentType) {
  const potentialClips = [];
  
  // Adjust sentence groupings based on content type
  const MAX_SENTENCES_PER_CLIP = contentType === 'music' ? 7 : 6; // Increased for more flexibility
  const MIN_SENTENCES_PER_CLIP = 1; // Allow even single sentences if they're impactful
  
  // Use varying sentence groups to create a diverse set of potential clips
  for (let sentencesPerGroup = MAX_SENTENCES_PER_CLIP; sentencesPerGroup >= MIN_SENTENCES_PER_CLIP; sentencesPerGroup--) {
    // Use sliding window with more overlap for better natural boundaries
    const STEP_SIZE = 1; // Move one sentence at a time for more options
    
    for (let i = 0; i <= sentences.length - sentencesPerGroup; i += STEP_SIZE) {
      const sentenceGroup = sentences.slice(i, i + sentencesPerGroup);
      const text = sentenceGroup.join(' ');
      const wordCount = text.split(/\s+/).length;
      
      // Minimum words to consider for a clip (to avoid very short clips)
      const MIN_WORDS = 5;
      if (wordCount < MIN_WORDS) continue;
      
      // Calculate estimated start time based on word position
      let wordsSoFar = 0;
      for (let j = 0; j < i; j++) {
        wordsSoFar += sentences[j].split(/\s+/).length;
      }
      
      // Estimate duration based on word count
      const estimatedDuration = wordCount * timePerWord;
      
      // Variable padding based on content type and estimated duration
      // Shorter clips get less padding, longer clips get more
      const dynamicStartPadding = Math.min(1.5, Math.max(0.5, estimatedDuration * 0.05));
      const dynamicEndPadding = Math.min(2.5, Math.max(1.0, estimatedDuration * 0.1));
      
      const estimatedStartTime = Math.max(0, (wordsSoFar * timePerWord) - dynamicStartPadding);
      const estimatedEndTime = (wordsSoFar * timePerWord) + estimatedDuration + dynamicEndPadding;
      
      // Adjusted duration with padding
      const adjustedDuration = estimatedEndTime - estimatedStartTime;
      
      // More flexible duration constraints based on content quality
      // Allow longer clips for high-quality content, shorter clips for punchier content
      const minDuration = Math.max(5, CLIP_MIN_DURATION * 0.7); // As low as 5 seconds for very impactful content
      const maxDuration = Math.min(60, CLIP_MAX_DURATION * 1.5); // Up to 60 seconds for high-value content
      
      if (adjustedDuration >= minDuration && adjustedDuration <= maxDuration) {
        // Quality score calculation now includes impact of content
        const durationQuality = 1 - Math.abs(adjustedDuration - CLIP_IDEAL_DURATION) / CLIP_IDEAL_DURATION;
        
        // Check for high-impact indicators like questions, powerful statements
        const hasQuestion = text.includes('?');
        const hasPowerfulWords = /(amazing|incredible|never|always|best|worst|must|essential|critical|vital|key|revolutionary|game-changing|mind-blowing)/i.test(text);
        const hasNumbers = /\b(one|two|three|four|five|ten|1|2|3|4|5|10|hundred|thousand|million|billion)\b/i.test(text);
        
        // Impact bonus for shorter clips with powerful content
        const impactBonus = (hasQuestion ? 0.1 : 0) + (hasPowerfulWords ? 0.15 : 0) + (hasNumbers ? 0.1 : 0);
        
        // Check if this clip ends on a complete sentence or not
        const endsWithCompleteSentence = /[.!?][\s"']*$/.test(text.trim());
        
        // Adjust the quality score to heavily prioritize complete sentences
        // This will make clips that end with complete sentences always rank higher
        const sentenceCompletionBonus = endsWithCompleteSentence ? 0.5 : 0;
        const qualityScore = durationQuality + impactBonus + sentenceCompletionBonus;
        
        potentialClips.push({
          text,
          duration: adjustedDuration,
          wordCount,
          sentenceCount: sentencesPerGroup,
          start: estimatedStartTime,
          end: estimatedEndTime,
          sentenceGroup: i,
          qualityScore,
          impactFactors: {
            hasQuestion,
            hasPowerfulWords,
            hasNumbers,
            impactBonus
          },
          endsWithCompleteSentence // track whether the clip ends with a complete sentence
        });
      }
    }
    
    // If we have plenty of clips, we can stop creating more
    if (potentialClips.length >= 150) { // Increased from 100 to get more variety
      break;
    }
  }
  
  return potentialClips;
}

/**
 * Identify engaging clips from the full transcript text
 * @param {Object} transcriptData - The full transcript data object
 * @returns {Promise<Array>} - Array of clip objects
 */
async function identifyClipsFromFullText(transcriptData) {
  const transcriptText = transcriptData.text || '';
  appendToLog('Creating clips from full transcript text...', 'INFO');
  
  // Get actual audio duration if available
  const audioDuration = transcriptData.audio_duration || transcriptData.audioDuration;
  if (audioDuration) {
    appendToLog(`Transcript has audio duration: ${audioDuration} seconds`, 'INFO');
  }
  
  // Split text into sentences with improved sentence detection
  const sentences = transcriptText.match(/[^.!?]+[.!?]+/g) || [];
  
  if (sentences.length === 0) {
    appendToLog('No sentences found in transcript text', 'WARNING');
    return [];
  }
  
  appendToLog(`Split transcript into ${sentences.length} sentences`, 'INFO');
  
  // Detect content type based on transcript
  const contentType = detectContentType(transcriptText);
  appendToLog(`Detected content type: ${contentType}`, 'INFO');
  
  // Calculate approximate duration parameters
  const totalWords = transcriptText.split(/\s+/).length;
  let timePerWord;
  
  if (audioDuration && totalWords > 0) {
    timePerWord = audioDuration / totalWords;
    appendToLog(`Using actual audio duration for timing: ${timePerWord.toFixed(3)} seconds per word`, 'INFO');
  } else {
    // Fallback to estimates
    timePerWord = 0.4; // General estimate
    appendToLog(`Using estimated timing: ${timePerWord.toFixed(3)} seconds per word`, 'INFO');
  }
  
  // Create potential clips with flexible durations
  const potentialClips = createPotentialClips(sentences, timePerWord, contentType);
  
  appendToLog(`Created ${potentialClips.length} potential clips from text`, 'INFO');
  
  // Make sure clip timestamps are valid by checking against audio duration
  const validatedClips = potentialClips.map(clip => {
    // Make sure timestamps are within bounds of audio duration
    const maxTime = audioDuration || 24 * 60 * 60; // Default to 24 hours if no duration available
    
    let validatedStart = Math.max(0, Math.min(clip.start, maxTime - CLIP_MIN_DURATION * 0.7));
    let validatedEnd = Math.min(maxTime, Math.max(validatedStart + CLIP_MIN_DURATION * 0.7, clip.end));
    
    // If start or end times were adjusted, update the duration
    if (validatedStart !== clip.start || validatedEnd !== clip.end) {
      appendToLog(`Adjusted clip timestamps from [${clip.start.toFixed(2)}s-${clip.end.toFixed(2)}s] to [${validatedStart.toFixed(2)}s-${validatedEnd.toFixed(2)}s]`, 'WARNING');
    }
    
    return {
      ...clip,
      start: validatedStart,
      end: validatedEnd,
      duration: validatedEnd - validatedStart
    };
  });
  
  // Sort by quality score initially but provide more diverse options to AI
  const sortedClips = [...validatedClips].sort((a, b) => b.qualityScore - a.qualityScore);
  
  // Increase clips for AI to allow for more diverse content and trust AI judgment more
  const CLIPS_FOR_AI = 60; // Increased from 40 to provide more options for AI to evaluate
  let clipsForAI = [];
  
  // Include a balanced mix of clips with different characteristics
  if (sortedClips.length > CLIPS_FOR_AI) {
    // Get top clips by quality score (still important)
    const topByQuality = sortedClips.slice(0, Math.floor(CLIPS_FOR_AI * 0.5));
    
    // Get diverse clips from throughout the content
    clipsForAI = [...topByQuality];
    
    // Create duration buckets to ensure we have clips of varying lengths
    const remainingClips = sortedClips.slice(Math.floor(CLIPS_FOR_AI * 0.5));
    const durationBuckets = {
      veryShort: { min: 3, max: 10, clips: [] },  // Very short clips (3-10s)
      short: { min: 10, max: 20, clips: [] },     // Short clips (10-20s)
      medium: { min: 20, max: 30, clips: [] },    // Medium clips (20-30s)
      long: { min: 30, max: 60, clips: [] }       // Long clips (30-60s)
    };
    
    // Distribute remaining clips by duration
    remainingClips.forEach(clip => {
      if (clip.duration >= 3 && clip.duration < 10) {
        durationBuckets.veryShort.clips.push(clip);
      } else if (clip.duration >= 10 && clip.duration < 20) {
        durationBuckets.short.clips.push(clip);
      } else if (clip.duration >= 20 && clip.duration < 30) {
        durationBuckets.medium.clips.push(clip);
      } else if (clip.duration >= 30 && clip.duration <= 60) {
        durationBuckets.long.clips.push(clip);
      }
    });
    
    // Get clips from each bucket, prioritizing higher quality clips in each duration range
    Object.values(durationBuckets).forEach(bucket => {
      if (bucket.clips.length > 0) {
        // Sort each bucket by quality score
        bucket.clips.sort((a, b) => b.qualityScore - a.qualityScore);
        
        // Take a proportional number from each bucket
        const bucketContribution = Math.min(
          bucket.clips.length,
          Math.ceil(CLIPS_FOR_AI * 0.5 * (bucket.clips.length / remainingClips.length))
        );
        
        clipsForAI.push(...bucket.clips.slice(0, bucketContribution));
      }
    });
  } else {
    clipsForAI = sortedClips;
  }
  
  // Shuffle clips slightly to reduce position bias in AI evaluation
  for (let i = clipsForAI.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clipsForAI[i], clipsForAI[j]] = [clipsForAI[j], clipsForAI[i]];
  }
  
  // Limit to maximum clips for AI
  clipsForAI = clipsForAI.slice(0, CLIPS_FOR_AI);
  
  appendToLog(`Selected ${clipsForAI.length} diverse clips for AI analysis`, 'INFO');
  
  if (clipsForAI.length === 0) {
    appendToLog('No suitable clips found after filtering, returning empty array', 'WARNING');
    return [];
  }
  
  try {
    // Use ChatGPT to select the most valuable clips with enhanced context
    appendToLog('Asking GPT-4o to select the most viral-worthy clips...', 'INFO');
    
    // Customize prompt based on content type
    const prompt = createPromptForContentType(contentType, clipsForAI);
    
    const startTime = Date.now();
    const response = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: getSystemPromptForContentType(contentType) },
        { role: "user", content: prompt }
      ],
      temperature: 0.7, // Slightly higher temperature for more creative clip selection
      max_tokens: 2500, // Increased token limit for more detailed analysis
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    appendToLog(`Received response from GPT-4o in ${duration} seconds`, 'INFO');
    
    // Parse AI response to extract clip selections
    const aiResponseText = response.data.choices[0].message.content;
    
    // Save raw response for debugging
    appendToLog(`AI RESPONSE TEXT:\n${aiResponseText}`, 'DEBUG');
    
    // Improved parsing approach to handle various AI response formats
    let selectedClips = [];
    
    try {
      // Try to extract clip selections based on different possible formats
      // Format 1: SELECTED CLIP #: [clip number]
      const selectedClipRegex = /SELECTED(?:\s+)CLIP(?:\s+)(?:#|NUMBER)?(?:\s*):?\s*(\d+)/gi;
      let selectedClipMatches = [...aiResponseText.matchAll(selectedClipRegex)];
      
      // Format 2: CLIP #: [clip number]
      if (selectedClipMatches.length === 0) {
        const clipNumberRegex = /CLIP(?:\s+)(?:#|NUMBER)?(?:\s*):?\s*(\d+)/gi;
        selectedClipMatches = [...aiResponseText.matchAll(clipNumberRegex)];
      }
      
      // Format 3: Looking for any mentions of clip numbers with reasons
      if (selectedClipMatches.length === 0) {
        const viralPotentialRegex = /(?:CLIP|SELECTION)\s*(?:\d+|#\d+).*?\n.*?VIRAL\s*POTENTIAL\s*:(.+?)(?:\n\n|\nTARGET|\Z)/gis;
        const potentialMatches = [...aiResponseText.matchAll(viralPotentialRegex)];
        
        if (potentialMatches.length > 0) {
          // Extract clip numbers from context around viral potential mentions
          const clipNumberExtract = /(?:CLIP|SELECTION)\s*(?:#?\s*)?(\d+)/i;
          
          selectedClipMatches = potentialMatches.map(match => {
            const contextBefore = match[0].split('VIRAL POTENTIAL')[0];
            const clipNumberMatch = contextBefore.match(clipNumberExtract);
            if (clipNumberMatch) {
              return [null, clipNumberMatch[1], match[1].trim()];
            }
            return null;
          }).filter(Boolean);
        }
      }
      
      // If we found clip numbers, create the selected clips array
      if (selectedClipMatches.length > 0) {
        appendToLog(`Found ${selectedClipMatches.length} selected clips in AI response`, 'INFO');
        
        // Log the selected clip matches for debugging
        appendToLog(`Selected clip matches: ${JSON.stringify(selectedClipMatches.map(match => ({
          clipNumber: match[1],
          fullMatch: match[0] ? match[0].substring(0, 50) + '...' : 'N/A',
        })))}`, 'DEBUG');
        
        // Extract the clip numbers and their associated reasons
        selectedClips = selectedClipMatches.map(match => {
          const clipNumber = parseInt(match[1], 10) - 1; // Convert to 0-based index
          
          // Try to find the viral potential explanation
          let reason = '';
          let audience = '';
          
          // Look for viral potential near this clip number mention
          const clipMention = match[0] || `CLIP ${match[1]}`;
          const contextAfter = aiResponseText.substring(aiResponseText.indexOf(clipMention));
          
          // Extract viral potential - improved pattern to capture full text
          const potentialRegex = /VIRAL\s*POTENTIAL\s*:?\s*([\s\S]+?)(?:\n\nTARGET|\nTARGET|\n\nSELECTED|\nSELECTED|\n\nDURATION|\nDURATION|\n\n\s*$|$)/i;
          const potentialMatch = contextAfter.match(potentialRegex);
          
          if (potentialMatch) {
            reason = potentialMatch[1].trim();
          } else if (match[2]) {
            // If reason was captured in the third group of the regex
            reason = match[2].trim();
          }
          
          // Extract target audience if available - improved pattern for full text capture
          const audienceRegex = /TARGET\s*AUDIENCE\s*:?\s*([\s\S]+?)(?:\n\nSELECTED|\nSELECTED|\n\nDURATION|\nDURATION|\n\n\s*$|$)/i;
          const audienceMatch = contextAfter.match(audienceRegex);
          
          if (audienceMatch) {
            audience = audienceMatch[1].trim();
          }
          
          // Extract duration effectiveness information if available
          let durationEffectiveness = '';
          const durationRegex = /DURATION\s*EFFECTIVENESS\s*:?\s*([\s\S]+?)(?:\n\nSELECTED|\nSELECTED|\n\n\s*$|$)/i;
          const durationMatch = contextAfter.match(durationRegex);
          
          if (durationMatch) {
            durationEffectiveness = durationMatch[1].trim();
          }
          
          // Log extracted data for debugging
          appendToLog(`For clip ${clipNumber + 1}:
            - Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}
            - Audience: ${audience.substring(0, 100)}${audience.length > 100 ? '...' : ''}
            - Duration: ${durationEffectiveness.substring(0, 100)}${durationEffectiveness.length > 100 ? '...' : ''}`, 'DEBUG');
          
          if (clipNumber >= 0 && clipNumber < clipsForAI.length) {
            return {
              ...clipsForAI[clipNumber],
              reason: reason || `Selected by AI (Clip ${clipNumber + 1})`,
              targetAudience: audience || 'General audience',
              durationEffectiveness: durationEffectiveness || '',
              aiSelected: true
            };
          }
          return null;
        }).filter(Boolean); // Remove any null entries
      }
      
      if (selectedClips.length > 0) {
        appendToLog(`Successfully parsed ${selectedClips.length} clips from AI response`, 'INFO');
        
        // Log the selected clips for analysis
        appendToLog(`SELECTED CLIPS FROM AI:\n${JSON.stringify(selectedClips.map(clip => ({
          clipNumber: clipsForAI.indexOf(clip) + 1,
          start: clip.start.toFixed(2),
          end: clip.end.toFixed(2),
          duration: clip.duration.toFixed(2),
          reason: clip.reason,
          audience: clip.targetAudience,
          text: clip.text.substring(0, 100) + (clip.text.length > 100 ? '...' : '')
        })), null, 2)}`, 'DEBUG');
        
        return selectedClips;
      }
      
      appendToLog('Could not parse clip selections from AI response using standard patterns', 'WARNING');
      
      // Try one more approach: just look for any clip numbers mentioned prominently
      const mentionedClipNumbers = aiResponseText.match(/(?:^|\n)(?:.*?)(CLIP|clip)\s+(\d+)(?:$|\n|:)/g);
      
      if (mentionedClipNumbers && mentionedClipNumbers.length > 0) {
        appendToLog(`Found ${mentionedClipNumbers.length} clip number mentions, trying to extract`, 'INFO');
        
        // Extract just the numbers
        const clipIndices = mentionedClipNumbers.map(mention => {
          const match = mention.match(/\b(\d+)\b/);
          return match ? parseInt(match[1], 10) - 1 : -1;
        }).filter(index => index >= 0 && index < clipsForAI.length);
        
        // Get unique clip indices
        const uniqueIndices = [...new Set(clipIndices)];
        
        if (uniqueIndices.length > 0) {
          appendToLog(`Extracted ${uniqueIndices.length} unique clip indices from mentions`, 'INFO');
          
          selectedClips = uniqueIndices.map(index => ({
            ...clipsForAI[index],
            reason: `Mentioned by AI as Clip ${index + 1}`,
            aiSelected: true
          }));
          
          return selectedClips;
        }
      }
      
      // If all else fails, use fallback selection
      appendToLog('AI couldn\'t identify clips properly. Using fallback selection.', 'WARNING');
      return fallbackClipSelection(clipsForAI);
      
    } catch (error) {
      appendToLog(`Error parsing AI response: ${error.message}`, 'ERROR');
      return fallbackClipSelection(clipsForAI);
    }
  } catch (error) {
    appendToLog(`Error in AI clip selection: ${error.message}`, 'ERROR');
    return fallbackClipSelection(clipsForAI);
  }
}

/**
 * Detect the type of content from the transcript text
 * @param {string} text - Transcript text
 * @returns {string} - Content type ('music', 'educational', 'interview', etc.)
 */
function detectContentType(text) {
  // Simple heuristics to detect music
  const musicKeywords = /(chorus|verse|never gonna give you up|lyrics|singing|song|music|beat|melody|rhyme)/i;
  const repeatedPhrases = findRepeatedPhrases(text);
  
  // Music often has many repeated phrases and shorter sentences
  if (musicKeywords.test(text) || repeatedPhrases.length > 3) {
    return 'music';
  }
  
  // Check for educational content
  const educationalKeywords = /(learn|teach|strategy|concept|principle|important|key|idea|method|technique|framework|step|process|solution)/i;
  if (educationalKeywords.test(text)) {
    return 'educational';
  }
  
  // Check for interview content
  const interviewKeywords = /(interview|question|answer|asked|tell me about|talk about|discussed|conversation)/i;
  if (interviewKeywords.test(text)) {
    return 'interview';
  }
  
  // Default to generic
  return 'generic';
}

/**
 * Get appropriate value keywords for content type
 * @param {string} contentType - Content type
 * @returns {string} - Regex string for value keywords
 */
function getValueKeywordsForContentType(contentType) {
  switch (contentType) {
    case 'music':
      return '(chorus|love|heart|feel|never gonna give you up|together|forever|baby|dance|rhythm|beat|soul|life)';
    case 'educational':
      return '(important|key|essential|crucial|must|best|top|lesson|learn|discover|strategy|success|growth|tips|advice|how to|problem|solution|benefit|result|outcome|process|method|technique|framework|principle|concept)';
    case 'interview':
      return '(fascinating|interesting|insight|perspective|experience|opinion|believe|think|feel|important|success|challenge|opportunity|learned|discovered|developed)';
    default:
      return '(important|key|interesting|value|quality|beneficial|useful|helpful|significant|meaningful|memorable|powerful|effective|impactful)';
  }
}

/**
 * Find repeated phrases in text (potential chorus in music)
 * @param {string} text - Full text
 * @returns {Array} - Array of repeated phrases and their counts
 */
function findRepeatedPhrases(text) {
  const words = text.split(/\s+/);
  const phrases = [];
  const minPhraseLength = 3;
  const maxPhraseLength = 8;
  
  // Look for phrases of different lengths
  for (let phraseLength = minPhraseLength; phraseLength <= maxPhraseLength; phraseLength++) {
    const phraseCounts = {};
    
    // Generate all phrases of current length
    for (let i = 0; i <= words.length - phraseLength; i++) {
      const phrase = words.slice(i, i + phraseLength).join(' ').toLowerCase();
      phraseCounts[phrase] = (phraseCounts[phrase] || 0) + 1;
    }
    
    // Filter to phrases that appear more than once
    for (const [phrase, count] of Object.entries(phraseCounts)) {
      if (count > 1) {
        phrases.push({ phrase, count });
      }
    }
  }
  
  // Sort by count (most frequent first)
  return phrases.sort((a, b) => b.count - a.count);
}

/**
 * Check if a text snippet is a repeated phrase in the full text
 * @param {string} snippet - Text snippet
 * @param {string} fullText - Full text
 * @returns {boolean} - Whether the snippet appears multiple times
 */
function isRepeatedPhrase(snippet, fullText) {
  // Normalize both texts
  const normalizedSnippet = snippet.toLowerCase().trim();
  const normalizedFullText = fullText.toLowerCase();
  
  // Count occurrences (subtract 1 for the original instance)
  const occurrences = (normalizedFullText.match(new RegExp(escapeRegExp(normalizedSnippet), 'g')) || []).length;
  
  return occurrences > 1;
}

/**
 * Escape string for use in RegExp
 * @param {string} string - String to escape
 * @returns {string} - Escaped string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create prompt for content type
 * @param {string} contentType - Content type
 * @param {Array} filteredClips - Array of filtered clips
 * @returns {string} - Prompt for AI
 */
function createPromptForContentType(contentType, filteredClips) {
  // Limit number of clips to send to GPT to avoid token limits
  const clipCount = contentType === 'music' ? 5 : 5; // Reduced for more focused selection
  
  // Create a description of each potential clip
  const clipDescriptions = filteredClips.map((clip, index) => {
    // Format duration as MM:SS
    const durationMinutes = Math.floor(clip.duration / 60);
    const durationSeconds = Math.floor(clip.duration % 60);
    const formattedDuration = `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`;
    
    // Highlight whether the clip has a complete ending to draw attention to this critical factor
    const completionStatus = clip.endsWithCompleteSentence 
      ? "COMPLETE ENDING: ✓" 
      : "INCOMPLETE ENDING: ✗";
    
    // Include more information about the content for better context
    return `CLIP ${index + 1} (${formattedDuration}):\n"${clip.text.trim()}"\n` +
           `${completionStatus}\n` +
           `IMPACT FACTORS: ${clip.impactFactors.hasQuestion ? 'Contains questions' : ''} ${clip.impactFactors.hasPowerfulWords ? 'Uses powerful words' : ''} ${clip.impactFactors.hasNumbers ? 'Contains numbers/statistics' : ''}\n\n`;
  }).join('');
  
  // Create a base prompt for GPT
  const basePrompt = `You are a world-class content strategist specialized in identifying the most engaging and viral-worthy clips from long-form content.

Analyze these ${filteredClips.length} potential clips and select the ${clipCount} that would be MOST LIKELY TO PERFORM WELL on social media platforms.

${clipDescriptions}

WHAT MAKES CONTENT PERFORM WELL:
- COMPLETE ENDINGS ARE ESSENTIAL - clips that cut off mid-sentence create a terrible user experience and will be immediately skipped
- Clear beginnings and endings - viewers need natural entry and exit points
- Intriguing hooks that make viewers want to know more
- Stories with emotional impact (surprising, shocking, heartwarming, inspiring)
- Educational content that teaches something valuable in a concise way
- Content that challenges assumptions or presents unexpected perspectives
- Clips that feel complete on their own and don't require additional context
- Authentic moments that resonate with viewers (vulnerability, genuine emotion, honesty)
- Content that sparks conversation, debate, or makes viewers want to share with others

CRITICAL SELECTION CRITERIA (IN ORDER OF IMPORTANCE):
1. COMPLETE SENTENCES - NEVER select clips that cut off mid-sentence. This is the #1 most important factor.
2. NATURAL ENDINGS - The clip should end at a logical conclusion point that feels satisfying
3. DIVERSE DURATIONS - Include varied clip lengths (short, medium, long) for different platform requirements
4. ENGAGING CONTENT - Select clips with strong hooks and valuable content

For each clip you select, provide:
1. The clip number (e.g., "CLIP 3")
2. A detailed explanation of WHY this clip has strong potential
3. What specific elements make it shareable or engaging
4. Why this clip's particular duration is effective for the content
5. The target audience who would engage most with this content

Format your response as:

SELECTED CLIP #: [clip number]
VIRAL POTENTIAL: [detailed explanation of viral potential elements]
TARGET AUDIENCE: [who would engage with this content most]
DURATION EFFECTIVENESS: [why this duration works for this clip]

Select exactly ${clipCount} clips that you believe have the STRONGEST POTENTIAL, with varied durations. ONLY SELECT CLIPS WITH COMPLETE ENDINGS.`;

  return basePrompt;
}

/**
 * Get system prompt for content type
 * @param {string} contentType - Content type
 * @returns {string} - System prompt
 */
function getSystemPromptForContentType(contentType) {
  // Create a more powerful and nuanced system prompt for viral content detection
  return `You are a legendary social media content strategist who has helped create dozens of viral videos with billions of combined views. 

You have an exceptional ability to identify moments that will captivate audiences and perform well. You understand that effective content typically contains one or more of these elements:

1. EMOTIONAL IMPACT - Content that makes people feel something deeply (joy, surprise, awe, inspiration)
2. STORYTELLING - Concise narratives with clear beginnings, middles, and ends that resonate
3. VALUABLE INSIGHTS - Educational content that teaches something useful quickly
4. AUTHENTICITY - Real, genuine moments that feel honest and relatable
5. CURIOSITY TRIGGERS - Content that makes viewers want to know more
6. CONVERSATION STARTERS - Content that makes people want to comment, debate, or share with friends
7. UNIQUE PERSPECTIVE - Content that offers a fresh viewpoint or challenges assumptions

THE ABSOLUTE MOST IMPORTANT RULE: Never select clips that cut off mid-sentence or thought. Always prioritize clips with natural endings and complete thoughts. A clip that feels complete and satisfying is significantly more effective than one that feels abruptly cut.

Users IMMEDIATELY close videos that cut off mid-sentence, making this the #1 factor in determining clip success. Incomplete clips create a jarring, unprofessional experience that destroys engagement.

Your expertise transcends rigid rules about duration or format - you can identify the potential in content regardless of length, but you understand the importance of varied clip durations for different platforms and testing purposes. But above all else, clips MUST have complete sentence endings.`;
}

/**
 * Get a diverse selection of clips with varied durations
 * @param {Array} scoredClips - Array of clips with quality scores
 * @param {number} maxClips - Maximum number of clips to return
 * @returns {Array} - Array of diverse high-quality clips
 */
function getDiverseClipSelectionWithDurations(scoredClips, maxClips) {
  // First, strictly prioritize clips that end with complete sentences
  const clipsByCompleteness = {
    complete: scoredClips.filter(clip => clip.endsWithCompleteSentence),
    incomplete: scoredClips.filter(clip => !clip.endsWithCompleteSentence)
  };
  
  // If we have enough complete-sentence clips, use ONLY those
  // Only fall back to incomplete clips if absolutely necessary
  let preferredClips = clipsByCompleteness.complete.length >= Math.ceil(maxClips * 0.5)
    ? clipsByCompleteness.complete 
    : scoredClips;
  
  // If we have very few complete-sentence clips, log a warning
  if (clipsByCompleteness.complete.length < 3 && scoredClips.length > 10) {
    appendToLog(`WARNING: Only found ${clipsByCompleteness.complete.length} clips with complete sentence endings out of ${scoredClips.length} total clips. Clip quality may be affected.`, 'WARNING');
  } else {
    appendToLog(`Found ${clipsByCompleteness.complete.length} clips with complete sentence endings. Prioritizing these for selection.`, 'INFO');
  }
  
  // Always include highest quality clips regardless of duration
  const topClips = preferredClips.slice(0, Math.ceil(maxClips * 0.2)); // Top 20%
  
  // Group remaining clips by duration ranges to ensure variety
  const remainingClips = preferredClips.slice(Math.ceil(maxClips * 0.2));
  
  // Define duration buckets (in seconds)
  const durationBuckets = [
    { min: 5, max: 10, clips: [] },    // Very short clips (5-10s)
    { min: 10, max: 15, clips: [] },   // Short clips (10-15s)
    { min: 15, max: 20, clips: [] },   // Medium clips (15-20s)
    { min: 20, max: 30, clips: [] },   // Long clips (20-30s) 
    { min: 30, max: 60, clips: [] }    // Very long clips (30-60s)
  ];
  
  // Distribute clips into duration buckets
  remainingClips.forEach(clip => {
    for (const bucket of durationBuckets) {
      if (clip.duration >= bucket.min && clip.duration <= bucket.max) {
        bucket.clips.push(clip);
        break;
      }
    }
  });
  
  // Sort clips in each bucket by quality score
  durationBuckets.forEach(bucket => {
    bucket.clips.sort((a, b) => b.qualityScore - a.qualityScore);
  });
  
  // Calculate how many clips to take from each bucket (proportional allocation)
  const remainingSlots = maxClips - topClips.length;
  const totalClipsInBuckets = durationBuckets.reduce((sum, bucket) => sum + bucket.clips.length, 0);
  
  // Select top clips from each bucket
  const selectedFromBuckets = [];
  
  if (totalClipsInBuckets > 0) {
    // Minimum number of clips from each non-empty bucket
    let clipsPerBucket = Math.max(1, Math.floor(remainingSlots / durationBuckets.filter(b => b.clips.length > 0).length));
    
    durationBuckets.forEach(bucket => {
      // Take top N clips from each bucket, where N is proportional to bucket size
      if (bucket.clips.length > 0) {
        const bucketSelections = bucket.clips.slice(0, clipsPerBucket);
        selectedFromBuckets.push(...bucketSelections);
      }
    });
    
    // If we have slots remaining, fill them with the highest quality clips from any bucket
    const usedSlots = selectedFromBuckets.length;
    if (usedSlots < remainingSlots) {
      // Get all remaining clips from all buckets
      const allRemainingClips = durationBuckets.flatMap(bucket => 
        bucket.clips.slice(clipsPerBucket)
      ).sort((a, b) => b.qualityScore - a.qualityScore);
      
      // Add highest quality clips to fill remaining slots
      selectedFromBuckets.push(...allRemainingClips.slice(0, remainingSlots - usedSlots));
    }
  }
  
  // Combine clips from all sources
  const combinedSelection = [...topClips, ...selectedFromBuckets];
  
  // Filter out very similar clips (close timestamps)
  const uniqueSelection = [];
  combinedSelection.forEach(clip => {
    // More aggressive similarity check - looking at both timestamp and content similarity
    const isDuplicate = uniqueSelection.some(c => {
      // Check for timestamp proximity
      const timeOverlap = Math.abs(c.start - clip.start) < 10;
      
      // Check for text similarity (if they share most of the same text)
      const textSimilarity = c.text.includes(clip.text.substring(0, 50)) || 
                           clip.text.includes(c.text.substring(0, 50));
      
      return timeOverlap && textSimilarity;
    });
    
    if (!isDuplicate) {
      uniqueSelection.push(clip);
    }
  });
  
  // Still respect max clips limit
  const finalSelection = uniqueSelection.slice(0, maxClips);
  
  // Log how many of our selected clips have complete sentences
  const completeEndingCount = finalSelection.filter(clip => clip.endsWithCompleteSentence).length;
  appendToLog(`Final clip selection: ${completeEndingCount}/${finalSelection.length} clips have complete sentence endings`, 'INFO');
  
  return finalSelection;
}

/**
 * Generate clips from a source video file
 * @param {Array} clips - Array of clip objects
 * @param {string} videoPath - Path to source video
 * @param {string} outputDir - Directory to save clips
 * @returns {Promise<Array>} - Array of paths to generated clips
 */
async function generateClips(clips, videoPath, outputDir) {
  appendToLog(`Generating ${clips.length} clips from ${videoPath} to ${outputDir}`, 'INFO');
  
  // Save clips data for analysis
  try {
    const selectedClipsData = {
      timestamp: new Date().toISOString(),
      source_video: videoPath,
      clips: clips.map(clip => ({
        ...clip,
        duration: clip.end - clip.start
      }))
    };
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(DIRS.LOGS)) {
      fs.mkdirSync(DIRS.LOGS, { recursive: true });
    }
    
    // Save the data to a JSON file for analysis
    fs.writeFileSync(
      FILES.SELECTED_CLIPS_DATA, 
      JSON.stringify(selectedClipsData, null, 2)
    );
    
    appendToLog(`Saved clips data to ${FILES.SELECTED_CLIPS_DATA} for analysis`, 'INFO');
  } catch (error) {
    appendToLog(`Failed to save clips data: ${error.message}`, 'WARNING');
  }
  
  // Validate clips before processing
  const validClips = clips.filter(clip => {
    if (typeof clip.start !== 'number' || typeof clip.end !== 'number') {
      appendToLog(`Skipping clip with invalid start/end times: ${JSON.stringify(clip)}`, 'WARNING');
      return false;
    }
    
    if (clip.start >= clip.end) {
      appendToLog(`Skipping clip with invalid duration (start >= end): ${JSON.stringify(clip)}`, 'WARNING');
      return false;
    }
    
    // Don't skip very short clips anymore - our media.js improvements will handle them
    // Instead, just log that we're keeping the short clip
    if (clip.end - clip.start < 5) {
      appendToLog(`Processing short clip with duration: ${(clip.end - clip.start).toFixed(2)}s`, 'INFO');
    }
    
    return true;
  });
  
  if (validClips.length === 0) {
    appendToLog('No valid clips to generate', 'WARNING');
    return [];
  }
  
  appendToLog(`${validClips.length} valid clips to generate`, 'INFO');
  
  // Get video duration to validate clip times
  try {
    // Get the duration of the video file to make sure our clips are within bounds
    const { execSync } = require('child_process');
    const durationCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const videoDuration = parseFloat(execSync(durationCommand).toString().trim());
    
    appendToLog(`Source video duration: ${videoDuration} seconds`, 'INFO');
    
    // Filter out clips that are entirely beyond the video duration
    const validatedClips = validClips.filter(clip => {
      if (clip.start > videoDuration) {
        appendToLog(`Skipping clip with start time beyond video duration: ${clip.start}s > ${videoDuration}s`, 'WARNING');
        return false;
      }
      return true;
    });
    
    appendToLog(`${validatedClips.length} clips are within the video duration and will be generated`, 'INFO');
    
    // Function to generate a single clip with progress indication
    async function processClip(clip, index, total) {
      appendToLog(`Processing clip ${index + 1}/${total}: ${clip.start.toFixed(2)}s - ${clip.end.toFixed(2)}s`, 'INFO');
      
      const clipText = (clip.text || '').substring(0, 250) + (clip.text?.length > 250 ? '...' : '');
      const clipReason = (clip.reason || '').substring(0, 100) + (clip.reason?.length > 100 ? '...' : '');
      const clipScore = clip.qualityScore || 'N/A';
      
      appendToLog(`Clip ${index + 1} text: ${clipText}`, 'INFO');
      appendToLog(`Clip ${index + 1} reason: ${clipReason}`, 'INFO');
      appendToLog(`Clip ${index + 1} quality score: ${clipScore}`, 'INFO');
      
      try {
        const generatedPath = await generateClip(clip, videoPath, outputDir);
        return { success: true, path: generatedPath, clip };
      } catch (error) {
        appendToLog(`Failed to generate clip ${index + 1}: ${error.message}`, 'ERROR');
        return { success: false, error: error.message, clip };
      }
    }
    
    // Process all clips in series to avoid overwhelming system resources
    const results = [];
    for (let i = 0; i < validatedClips.length; i++) {
      const result = await processClip(validatedClips[i], i, validatedClips.length);
      results.push(result);
    }
    
    // Count successes and failures
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    appendToLog(`Generated ${successCount} clips successfully`, 'INFO');
    if (failureCount > 0) {
      appendToLog(`Failed to generate ${failureCount} clips`, 'WARNING');
    }
    
    // Generate a detailed summary for the log
    appendToLog('\n===== CLIP GENERATION SUMMARY =====', 'INFO');
    appendToLog(`Total selected clips: ${clips.length}`, 'INFO');
    appendToLog(`Valid clips: ${validClips.length}`, 'INFO');
    appendToLog(`Clips within video duration: ${validatedClips.length}`, 'INFO');
    appendToLog(`Successfully generated clips: ${successCount}`, 'INFO');
    appendToLog(`Failed clips: ${failureCount}`, 'INFO');
    
    // Add detailed information about each successfully generated clip
    appendToLog('\n----- SUCCESSFUL CLIPS -----', 'INFO');
    results.filter(r => r.success).forEach((result, index) => {
      const clip = result.clip;
      appendToLog(`\nCLIP ${index + 1}: ${path.basename(result.path)}`, 'INFO');
      appendToLog(`Timestamp: ${clip.start.toFixed(2)}s - ${clip.end.toFixed(2)}s (${clip.duration.toFixed(2)}s)`, 'INFO');
      appendToLog(`Text: ${clip.text}`, 'INFO');
      appendToLog(`Selection reason: ${clip.reason}`, 'INFO');
      appendToLog(`Quality score: ${clip.qualityScore}`, 'INFO');
    });
    
    // Add information about failed clips if any
    if (failureCount > 0) {
      appendToLog('\n----- FAILED CLIPS -----', 'INFO');
      results.filter(r => !r.success).forEach((result, index) => {
        const clip = result.clip;
        appendToLog(`\nFAILED CLIP ${index + 1}:`, 'INFO');
        appendToLog(`Timestamp: ${clip.start.toFixed(2)}s - ${clip.end.toFixed(2)}s (${(clip.end - clip.start).toFixed(2)}s)`, 'INFO');
        appendToLog(`Error: ${result.error}`, 'INFO');
      });
    }
    
    appendToLog('===================================', 'INFO');
    
    // Return the paths of successfully generated clips
    return results.filter(r => r.success).map(r => r.path);
  } catch (error) {
    appendToLog(`Error in clip generation process: ${error.message}`, 'ERROR');
    throw error;
  }
}

/**
 * Analyzes clips for quality and overlap, returning an improved set of clips
 * @param {Array} clips - Array of clip objects
 * @returns {Array} - Array of improved clip objects
 */
function analyzeClipsForQualityAndOverlap(clips) {
  // First, sort clips by quality score if available, or by relevance from AI
  const sortedClips = [...clips].sort((a, b) => {
    // First priority: clips with higher quality scores
    if (a.qualityScore && b.qualityScore) {
      return b.qualityScore - a.qualityScore;
    }
    
    // If no quality score, prioritize clips with reasons provided by AI
    if (a.reason && !b.reason) return -1;
    if (!a.reason && b.reason) return 1;
    
    // If both have reasons, use original order (lower index = higher priority)
    return clips.indexOf(a) - clips.indexOf(b);
  });
  
  // Check for overlapping clips and resolve conflicts
  const finalClips = [];
  const OVERLAP_THRESHOLD = 0.5; // 50% overlap is considered significant
  
  for (const clip of sortedClips) {
    // Calculate clip duration
    const clipDuration = clip.end - clip.start;
    
    // Check if this clip significantly overlaps with any already selected clip
    const overlapsWithExisting = finalClips.some(existingClip => {
      const existingDuration = existingClip.end - existingClip.start;
      
      // Calculate overlap start and end
      const overlapStart = Math.max(clip.start, existingClip.start);
      const overlapEnd = Math.min(clip.end, existingClip.end);
      
      // Calculate overlap amount
      if (overlapEnd <= overlapStart) return false; // No overlap
      
      const overlapDuration = overlapEnd - overlapStart;
      const overlapRatio = overlapDuration / Math.min(clipDuration, existingDuration);
      
      return overlapRatio > OVERLAP_THRESHOLD;
    });
    
    // If no significant overlap, add the clip
    if (!overlapsWithExisting) {
      finalClips.push(clip);
    } else {
      // If there's overlap, we might still want to keep the clip if it's significantly better
      const overlappingClip = finalClips.find(existingClip => {
        const existingDuration = existingClip.end - existingClip.start;
        const overlapStart = Math.max(clip.start, existingClip.start);
        const overlapEnd = Math.min(clip.end, existingClip.end);
        if (overlapEnd <= overlapStart) return false;
        
        const overlapDuration = overlapEnd - overlapStart;
        const overlapRatio = overlapDuration / Math.min(clipDuration, existingDuration);
        return overlapRatio > OVERLAP_THRESHOLD;
      });
      
      if (overlappingClip && clip.qualityScore && overlappingClip.qualityScore && 
          clip.qualityScore > overlappingClip.qualityScore * 1.2) { // 20% better quality
        // Replace the existing clip with this one
        const index = finalClips.indexOf(overlappingClip);
        finalClips.splice(index, 1, clip);
      }
    }
  }
  
  return finalClips;
}

/**
 * Identify clips from words array
 * @param {Array} words - Array of word objects
 * @returns {Promise<Array>} - Array of clip objects
 */
async function identifyClipsFromWords(words) {
  appendToLog(`Processing ${words.length} words for clips`, 'INFO');
  
  // Group words into utterances for easier processing
  const utterances = [];
  let currentUtterance = { words: [], start: 0, end: 0, text: '', speaker: null };
  
  words.forEach(word => {
    if (word.speaker !== currentUtterance.speaker && currentUtterance.words.length > 0) {
      utterances.push({ ...currentUtterance });
      currentUtterance = { words: [], start: word.start, end: word.end, text: '', speaker: word.speaker };
    }
    currentUtterance.words.push(word);
    currentUtterance.text += word.text + ' ';
    currentUtterance.end = word.end;
    currentUtterance.speaker = word.speaker;
  });
  
  if (currentUtterance.words.length > 0) {
    utterances.push({ ...currentUtterance });
  }
  
  appendToLog(`Grouped words into ${utterances.length} utterances.`, 'INFO');
  return identifyClipsFromUtterances(utterances);
}

/**
 * Filter and enhance clips based on quality markers
 * @param {Array} potentialClips - Array of potential clip objects
 * @param {string} contentType - Type of content (e.g., music, educational)
 * @returns {Array} - Array of filtered and enhanced clip objects
 */
function filterClipsForQuality(potentialClips, contentType) {
  appendToLog(`Filtering and enhancing ${potentialClips.length} potential clips for quality`, 'INFO');
  
  if (potentialClips.length === 0) {
    return [];
  }
  
  // Define relevance markers based on content type
  const relevanceMarkers = getRelevanceMarkersForContentType(contentType);
  
  // Score each clip on multiple dimensions
  const scoredClips = potentialClips.map(clip => {
    // Base quality score from original calculation
    let qualityScore = clip.qualityScore || 0;
    
    // Content relevance score
    const relevanceRegex = new RegExp(relevanceMarkers.join('|'), 'gi');
    const relevanceMatches = (clip.text.match(relevanceRegex) || []).length;
    const wordCount = clip.text.split(/\s+/).length;
    const relevanceScore = wordCount > 5 ? relevanceMatches / (wordCount / 5) : 0;
    
    // Narrative completeness score (complete thoughts)
    const sentences = clip.text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const sentenceCompletionScore = sentences.length > 0 ? 
      sentences.filter(s => s.trim().length > 10).length / sentences.length : 0;
    
    // Transition quality - does clip start/end at natural points?
    let transitionScore = 0;
    
    // Check for good starts (natural openings)
    const goodStarts = [
      /^(so |now |here |let me |let's |I'm going to |today |if you |when you |what |how |why )/i,
      /^(the |this |these |those |a |one |two |first |second |third )/i,
      /^(in |on |at |by |for |with |about |before |after )/i
    ];
    
    // Check for good endings (natural conclusions)
    const goodEndings = [
      /(\.|\!|\?)$/,
      /(right|okay|got it|understand|see that|there you go|makes sense)\.?$/i,
      /(thank you|in conclusion|to summarize|in summary|remember|that's all|as you can see)\.?$/i
    ];
    
    // Score transitions
    const firstSentence = sentences[0] || '';
    const lastSentence = sentences[sentences.length - 1] || '';
    
    for (const pattern of goodStarts) {
      if (pattern.test(firstSentence.trim())) {
        transitionScore += 0.15;
        break;
      }
    }
    
    for (const pattern of goodEndings) {
      if (pattern.test(lastSentence.trim())) {
        transitionScore += 0.15;
        break;
      }
    }
    
    // Avoid clips starting with conjunctions or transitions without context
    const startsWithTransition = /^\s*(and|but|so|because|however|therefore|thus|hence|otherwise|anyway)/i.test(clip.text);
    if (startsWithTransition) {
      transitionScore -= 0.2;
    }
    
    // Density score - information density relative to time
    const contentDensity = wordCount / clip.duration;
    const densityScore = Math.min(0.3, contentDensity / 2.5); // Cap at 0.3
    
    // Duration quality - how close to ideal duration
    const idealDuration = CLIP_IDEAL_DURATION;
    const durationScore = 1 - Math.min(1, Math.abs(clip.duration - idealDuration) / idealDuration);
    
    // Content type specific scoring
    let contentTypeScore = 0;
    
    if (contentType === 'music') {
      // For music, prioritize repetition and hooks
      const repeatedPhraseBonus = clip.isRepeatedPhrase ? 0.5 : 0;
      const containsTitle = clip.containsTitle ? 0.3 : 0;
      contentTypeScore = repeatedPhraseBonus + containsTitle;
    } 
    else if (contentType === 'educational') {
      // For educational, prioritize definitional content and clear explanations
      const hasDefinition = /\b(means|is defined as|refers to|is when|is a|are when|are|is)\b/i.test(clip.text);
      const hasExample = /\b(example|instance|like|such as|for instance|imagine|consider)\b/i.test(clip.text);
      contentTypeScore = (hasDefinition ? 0.3 : 0) + (hasExample ? 0.3 : 0);
    }
    else if (contentType === 'interview' || contentType === 'conversation') {
      // For interviews, prioritize complete Q&A exchanges and insightful responses
      const hasQuestion = /\?/.test(clip.text);
      const hasResponse = clip.text.split('?').length > 1 && clip.text.split('?')[1].length > 30;
      contentTypeScore = (hasQuestion && hasResponse) ? 0.5 : (hasQuestion ? 0.2 : 0);
    }
    
    // Combine all scores with appropriate weights
    const finalScore = (
      (qualityScore * 0.3) +        // Original quality score (30%)
      (relevanceScore * 0.15) +     // Relevance to important topics (15%)
      (sentenceCompletionScore * 0.15) + // Complete thoughts (15%)
      (transitionScore * 0.15) +    // Natural transitions (15%)
      (densityScore * 0.05) +       // Information density (5%)
      (durationScore * 0.1) +       // Duration quality (10%)
      (contentTypeScore * 0.1)      // Content type specific score (10%)
    );
    
    return {
      ...clip,
      qualityScore: finalScore,
      relevanceScore,
      sentenceCompletionScore,
      transitionScore,
      contentTypeScore,
      scoringDetails: {
        originalQuality: qualityScore,
        relevance: relevanceScore,
        sentenceCompletion: sentenceCompletionScore,
        transitions: transitionScore,
        density: densityScore,
        duration: durationScore,
        contentType: contentTypeScore
      }
    };
  });
  
  // Sort by final quality score
  scoredClips.sort((a, b) => b.qualityScore - a.qualityScore);
  
  // Take top candidates, but ensure diversity
  const diverseTopClips = getDiverseClipSelectionWithDurations(scoredClips, 15);
  
  appendToLog(`Selected ${diverseTopClips.length} diverse high-quality clips for consideration`, 'INFO');
  
  // Log detailed scores for top clips
  appendToLog(`TOP CLIPS QUALITY SCORES:\n${JSON.stringify(diverseTopClips.slice(0, 5).map(clip => ({
    quality: clip.qualityScore.toFixed(2),
    relevance: clip.relevanceScore.toFixed(2),
    completeness: clip.sentenceCompletionScore.toFixed(2),
    transitions: clip.transitionScore.toFixed(2),
    duration: clip.duration.toFixed(1),
    text: clip.text.substring(0, 70) + (clip.text.length > 70 ? '...' : '')
  })), null, 2)}`, 'DEBUG');
  
  return diverseTopClips;
}

/**
 * Get relevance markers based on content type
 * @param {string} contentType - Type of content
 * @returns {Array} - Array of relevance marker patterns
 */
function getRelevanceMarkersForContentType(contentType) {
  // Common valuable content markers that apply to all content types
  const commonMarkers = [
    'important', 'key', 'essential', 'crucial', 'must', 'best', 'top',
    'lesson', 'learn', 'discover', 'strategy', 'success', 'growth',
    'tips', 'advice', 'how to', 'problem', 'solution', 'benefit',
    'result', 'outcome', 'process', 'method', 'technique', 'framework',
    'principle', 'concept'
  ];
  
  // Content-specific markers
  switch (contentType) {
    case 'music':
      return [
        ...commonMarkers,
        'chorus', 'hook', 'beat', 'rhythm', 'melody', 'lyric', 'song', 'verse',
        'bridge', 'album', 'track', 'artist', 'vocal', 'sing', 'rap', 'performance'
      ];
      
    case 'educational':
      return [
        ...commonMarkers,
        'understand', 'explanation', 'explain', 'definition', 'define', 'example',
        'demonstrate', 'illustration', 'case study', 'research', 'analysis', 'theory',
        'practice', 'application', 'skill', 'knowledge', 'study', 'learning'
      ];
      
    case 'interview':
    case 'conversation':
      return [
        ...commonMarkers,
        'experience', 'opinion', 'perspective', 'view', 'insight', 'thought',
        'belief', 'story', 'anecdote', 'question', 'answer', 'response',
        'challenge', 'opportunity', 'reflection', 'comment', 'point'
      ];
      
    default:
      return commonMarkers;
  }
}

/**
 * Identify clips from utterances
 * @param {Array} utterances - Array of utterance objects
 * @returns {Promise<Array>} - Array of clip objects
 */
async function identifyClipsFromUtterances(utterances) {
  // Create potential clip windows
  const potentialClips = [];

  appendToLog('Looking for potential viral clips from utterances...', 'INFO');

  // Create sliding windows of utterances with more granular steps
  for (let i = 0; i < utterances.length; i++) {
    let windowUtterances = [];
    let windowStart = utterances[i].start / 1000;
    let windowEnd = windowStart;
    
    // Collect utterances within the window
    for (let j = i; j < utterances.length; j++) {
      const utterance = utterances[j];
      const utteranceEnd = utterance.end / 1000;
      
      // Allow for a more generous maximum duration to give AI more options
      const MAX_WINDOW = 60; // 60 seconds max window
      
      // Stop if adding this utterance would make the clip too long
      if (utteranceEnd - windowStart > MAX_WINDOW) {
        // Check if we're in the middle of a sentence in the last utterance
        if (windowUtterances.length > 0) {
          const lastUtterance = windowUtterances[windowUtterances.length - 1];
          const lastText = lastUtterance.text.trim();
          
          // Don't end mid-sentence - only keep if it ends with sentence terminator
          const endsWithSentenceTerminator = /[.!?]\s*$/.test(lastText);
          
          // If it doesn't end with sentence terminator, and there's more than one utterance,
          // remove the last utterance to avoid cutting mid-sentence
          if (!endsWithSentenceTerminator && windowUtterances.length > 1) {
            windowUtterances.pop();
            windowEnd = lastUtterance.start / 1000; // Use start of incomplete utterance as end
          }
        }
        break;
      }
      
      windowUtterances.push(utterance);
      windowEnd = utteranceEnd;

      // Once we reach minimum duration, consider adding as a potential clip
      const duration = windowEnd - windowStart;
      
      // Use a lower minimum (5 seconds) to allow for very punchy viral clips
      if (duration >= 5) {
        // Verify the last utterance ends with a sentence terminator
        const lastUtterance = windowUtterances[windowUtterances.length - 1];
        const lastText = lastUtterance.text.trim();
        const endsWithSentenceTerminator = /[.!?]\s*$/.test(lastText);
        
        // For clips ending without a sentence terminator, try to find the last complete sentence
        if (!endsWithSentenceTerminator && windowUtterances.length > 1) {
          // Try to find the last complete sentence boundary within the last utterance
          const sentenceBoundaries = [...lastText.matchAll(/[.!?]\s+/g)];
          
          if (sentenceBoundaries.length > 0) {
            // Get the last complete sentence boundary
            const lastBoundary = sentenceBoundaries[sentenceBoundaries.length - 1];
            const boundaryIndex = lastBoundary.index + lastBoundary[0].length;
            
            // Calculate how much of the utterance to include (up to the last sentence boundary)
            const utteranceDuration = (lastUtterance.end - lastUtterance.start) / 1000;
            const boundaryRatio = boundaryIndex / lastText.length;
            const partialUtteranceTime = utteranceDuration * boundaryRatio;
            
            // Adjust end time to end at the last complete sentence
            const adjustedEndTime = (lastUtterance.start / 1000) + partialUtteranceTime;
            windowEnd = adjustedEndTime;
            
            // Update the last utterance text to include only complete sentences
            const completeText = lastText.substring(0, boundaryIndex).trim();
            windowUtterances[windowUtterances.length - 1] = {
              ...lastUtterance,
              text: completeText,
              end: lastUtterance.start + (partialUtteranceTime * 1000)
            };
          } else if (windowUtterances.length > 1) {
            // If no sentence boundary found and we have multiple utterances, 
            // remove the last utterance to avoid mid-sentence cutoff
            windowUtterances.pop();
            windowEnd = lastUtterance.start / 1000;
          }
        }
        
        // Recalculate duration after adjustments
        const adjustedDuration = windowEnd - windowStart;
        
        // Only add if still meets minimum duration after adjustments (5 seconds)
        if (adjustedDuration >= 5) {
        const text = windowUtterances.map(u => u.text).join(' ');
        const wordCount = text.split(/\s+/).length;
        const sentenceCount = (text.match(/[.!?]+/g) || []).length;
          
          // Add viral indicator heuristics
          const hasEmotionalLanguage = /amazing|incredible|surprising|shocking|never|always|changed|stunned|realized|discovered|astonishing|powerful/i.test(text);
          const hasStoryElement = /when|there was|once|eventually|at first|finally|ultimately/i.test(text);
          const hasEducationalValue = /learn|understand|know|explain|how to|works|actually|truth|fact|research|found|most people don't|realize|secret/i.test(text);
          const hasCuriosityHook = /what if|here's why|the truth about|most people don't know|the secret to|this is how|you won't believe|the real reason/i.test(text);
          
          let viralScore = 0;
          if (hasEmotionalLanguage) viralScore += 0.15;
          if (hasStoryElement) viralScore += 0.15;
          if (hasEducationalValue) viralScore += 0.15;
          if (hasCuriosityHook) viralScore += 0.25;
        
        // Quality score factors:
        // 1. How close to ideal duration?
        // 2. How many complete sentences?
        // 3. Word density?
          // 4. Viral indicators
          let qualityScore = 0.3 * (1 - Math.abs(adjustedDuration - 15) / 15); // Less emphasis on ideal duration
        qualityScore += 0.1 * sentenceCount;
          qualityScore += (wordCount / adjustedDuration) / 5;
          qualityScore += 0.5 * viralScore; // More emphasis on viral indicators
        
        potentialClips.push({
          start: windowStart,
          end: windowEnd,
            duration: adjustedDuration,
          text,
          wordCount,
          sentenceCount,
          utterances: windowUtterances,
            qualityScore,
            viralScore,
            completeEnding: true,
            viralElements: {
              emotionalLanguage: hasEmotionalLanguage,
              storyElement: hasStoryElement,
              educationalValue: hasEducationalValue,
              curiosityHook: hasCuriosityHook
            }
          });
        }
      }
    }
    
    // Also consider single utterances if they are substantial
    const singleUtteranceDuration = (utterances[i].end - utterances[i].start) / 1000;
    
    // Allow shorter minimum for impactful single utterances (5 seconds)
    if (singleUtteranceDuration >= 5 && singleUtteranceDuration <= 60) {
      const text = utterances[i].text;
      const wordCount = text.split(/\s+/).length;
      
      // Only include substantial single utterances
      if (wordCount >= 10) { // Lower word count minimum
        const sentenceCount = (text.match(/[.!?]+/g) || []).length;
        const endsWithSentenceTerminator = /[.!?]\s*$/.test(text.trim());
        
        // Only include if it contains complete thoughts
        if (sentenceCount >= 1) {
          let adjustedEndTime = utterances[i].end / 1000;
          let adjustedText = text;
          
          // If it doesn't end with a sentence terminator, try to find the last complete sentence
          if (!endsWithSentenceTerminator) {
            const sentenceBoundaries = [...text.matchAll(/[.!?]\s+/g)];
            
            if (sentenceBoundaries.length > 0) {
              // Get the last complete sentence boundary
              const lastBoundary = sentenceBoundaries[sentenceBoundaries.length - 1];
              const boundaryIndex = lastBoundary.index + lastBoundary[0].length;
              
              // Calculate adjusted end time based on the boundary position
              const utteranceDuration = singleUtteranceDuration;
              const boundaryRatio = boundaryIndex / text.length;
              const partialUtteranceTime = utteranceDuration * boundaryRatio;
              
              adjustedEndTime = (utterances[i].start / 1000) + partialUtteranceTime;
              adjustedText = text.substring(0, boundaryIndex).trim();
            }
          }
          
          const adjustedDuration = adjustedEndTime - (utterances[i].start / 1000);
          
          // Only add if still meets minimum duration (5 seconds)
          if (adjustedDuration >= 5) {
            const adjustedWordCount = adjustedText.split(/\s+/).length;
            const adjustedSentenceCount = (adjustedText.match(/[.!?]+/g) || []).length;
            
            // Check for viral indicators
            const hasEmotionalLanguage = /amazing|incredible|surprising|shocking|never|always|changed|stunned|realized|discovered|astonishing|powerful/i.test(adjustedText);
            const hasStoryElement = /when|there was|once|eventually|at first|finally|ultimately/i.test(adjustedText);
            const hasEducationalValue = /learn|understand|know|explain|how to|works|actually|truth|fact|research|found|most people don't|realize|secret/i.test(adjustedText);
            const hasCuriosityHook = /what if|here's why|the truth about|most people don't know|the secret to|this is how|you won't believe|the real reason/i.test(adjustedText);
            
            let viralScore = 0;
            if (hasEmotionalLanguage) viralScore += 0.15;
            if (hasStoryElement) viralScore += 0.15;
            if (hasEducationalValue) viralScore += 0.15;
            if (hasCuriosityHook) viralScore += 0.25;
            
            let qualityScore = 0.3 * (1 - Math.abs(adjustedDuration - 15) / 15);
            qualityScore += 0.1 * adjustedSentenceCount;
            qualityScore += 0.5 * viralScore; // Higher weight for viral indicators
          
          potentialClips.push({
              start: utterances[i].start / 1000,
              end: adjustedEndTime,
              duration: adjustedDuration,
              text: adjustedText,
              wordCount: adjustedWordCount,
              sentenceCount: adjustedSentenceCount,
            utterances: [utterances[i]],
              qualityScore,
              viralScore,
              completeEnding: true,
              viralElements: {
                emotionalLanguage: hasEmotionalLanguage,
                storyElement: hasStoryElement,
                educationalValue: hasEducationalValue,
                curiosityHook: hasCuriosityHook
              }
            });
          }
        }
      }
    }
  }

  appendToLog(`Created ${potentialClips.length} potential clips from utterances.`, 'INFO');
  
  if (potentialClips.length === 0) {
    appendToLog('No potential clips found. Using basic clip identification...', 'WARNING');
    return identifyClips({ utterances });
  }

  // Sort by combined quality and viral score
  potentialClips.sort((a, b) => b.qualityScore - a.qualityScore);
  
  // Take a larger sample for AI to evaluate (up to 40 clips)
  const MAX_CLIPS_FOR_AI = 40; 
  
  // Get a diverse set of clips
  let clipsForAI = [];
  
  if (potentialClips.length > MAX_CLIPS_FOR_AI) {
    // Take top clips
    const topClips = potentialClips.slice(0, Math.ceil(MAX_CLIPS_FOR_AI * 0.5));
    clipsForAI = [...topClips];
    
    // Group remaining clips by viral characteristics
    const remainingClips = potentialClips.slice(Math.ceil(MAX_CLIPS_FOR_AI * 0.5));
    
    // Viral categories
    const viralCategories = {
      emotionalClips: remainingClips.filter(c => c.viralElements?.emotionalLanguage),
      storyClips: remainingClips.filter(c => c.viralElements?.storyElement),
      educationalClips: remainingClips.filter(c => c.viralElements?.educationalValue),
      curiosityClips: remainingClips.filter(c => c.viralElements?.curiosityHook)
    };
    
    // Add some from each category
    Object.values(viralCategories).forEach(categoryClips => {
      if (categoryClips.length > 0) {
        // Sort by quality score
        categoryClips.sort((a, b) => b.qualityScore - a.qualityScore);
        
        // Add top clips from this category (up to ~12.5% of total)
        const toAdd = Math.min(
          categoryClips.length,
          Math.ceil(MAX_CLIPS_FOR_AI * 0.125)
        );
        
        clipsForAI.push(...categoryClips.slice(0, toAdd));
      }
    });
  } else {
    clipsForAI = potentialClips;
  }
  
  // Limit to maximum
  clipsForAI = clipsForAI.slice(0, MAX_CLIPS_FOR_AI);
  
  // Shuffle slightly to remove position bias
  for (let i = clipsForAI.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clipsForAI[i], clipsForAI[j]] = [clipsForAI[j], clipsForAI[i]];
  }
  
  appendToLog(`Selected ${clipsForAI.length} diverse clips for AI viral analysis`, 'INFO');
  
  try {
    // Use GPT-4o to select the most viral-worthy clips
    appendToLog('Asking GPT-4o to select clips with highest viral potential...', 'INFO');
    
    const prompt = createPromptForContentType('generic', clipsForAI);
    
    const startTime = Date.now();
    const response = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: getSystemPromptForContentType('generic') },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2500,
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    appendToLog(`Received response from GPT-4o in ${duration} seconds`, 'INFO');
    
    // Parse AI response to extract clip selections
    const aiResponseText = response.data.choices[0].message.content;
    
    // Save raw response for debugging
    appendToLog(`AI RESPONSE TEXT:\n${aiResponseText}`, 'DEBUG');
    
    // Use same parsing logic as identifyClipsFromFullText
    let selectedClips = [];
    
    try {
      // Try to extract clip selections based on different possible formats
      // Format 1: SELECTED CLIP #: [clip number]
      const selectedClipRegex = /SELECTED(?:\s+)CLIP(?:\s+)(?:#|NUMBER)?(?:\s*):?\s*(\d+)/gi;
      let selectedClipMatches = [...aiResponseText.matchAll(selectedClipRegex)];
      
      // Format 2: CLIP #: [clip number]
      if (selectedClipMatches.length === 0) {
        const clipNumberRegex = /CLIP(?:\s+)(?:#|NUMBER)?(?:\s*):?\s*(\d+)/gi;
        selectedClipMatches = [...aiResponseText.matchAll(clipNumberRegex)];
      }
      
      // Format 3: Looking for any mentions of clip numbers with viral potential
      if (selectedClipMatches.length === 0) {
        const viralPotentialRegex = /(?:CLIP|SELECTION)\s*(?:\d+|#\d+).*?\n.*?VIRAL\s*POTENTIAL\s*:(.+?)(?:\n\n|\nTARGET|\Z)/gis;
        const potentialMatches = [...aiResponseText.matchAll(viralPotentialRegex)];
        
        if (potentialMatches.length > 0) {
          // Extract clip numbers from context around viral potential mentions
          const clipNumberExtract = /(?:CLIP|SELECTION)\s*(?:#?\s*)?(\d+)/i;
          
          selectedClipMatches = potentialMatches.map(match => {
            const contextBefore = match[0].split('VIRAL POTENTIAL')[0];
            const clipNumberMatch = contextBefore.match(clipNumberExtract);
            if (clipNumberMatch) {
              return [null, clipNumberMatch[1], match[1].trim()];
            }
            return null;
          }).filter(Boolean);
        }
      }
      
      // If we found clip numbers, create the selected clips array
      if (selectedClipMatches.length > 0) {
        appendToLog(`Found ${selectedClipMatches.length} selected clips in AI response`, 'INFO');
        
        // Log the selected clip matches for debugging
        appendToLog(`Selected clip matches: ${JSON.stringify(selectedClipMatches.map(match => ({
          clipNumber: match[1],
          fullMatch: match[0] ? match[0].substring(0, 50) + '...' : 'N/A',
        })))}`, 'DEBUG');
        
        // Extract the clip numbers and their associated reasons
        selectedClips = selectedClipMatches.map(match => {
          const clipNumber = parseInt(match[1], 10) - 1; // Convert to 0-based index
          
          // Try to find the viral potential explanation
          let reason = '';
          let audience = '';
          
          // Look for viral potential near this clip number mention
          const clipMention = match[0] || `CLIP ${match[1]}`;
          const contextAfter = aiResponseText.substring(aiResponseText.indexOf(clipMention));
          
          // Extract viral potential - improved pattern to capture full text
          const potentialRegex = /VIRAL\s*POTENTIAL\s*:?\s*([\s\S]+?)(?:\n\nTARGET|\nTARGET|\n\nSELECTED|\nSELECTED|\n\nDURATION|\nDURATION|\n\n\s*$|$)/i;
          const potentialMatch = contextAfter.match(potentialRegex);
          
          if (potentialMatch) {
            reason = potentialMatch[1].trim();
          } else if (match[2]) {
            // If reason was captured in the third group of the regex
            reason = match[2].trim();
          }
          
          // Extract target audience if available - improved pattern for full text capture
          const audienceRegex = /TARGET\s*AUDIENCE\s*:?\s*([\s\S]+?)(?:\n\nSELECTED|\nSELECTED|\n\nDURATION|\nDURATION|\n\n\s*$|$)/i;
          const audienceMatch = contextAfter.match(audienceRegex);
          
          if (audienceMatch) {
            audience = audienceMatch[1].trim();
          }
          
          // Extract duration effectiveness information if available
          let durationEffectiveness = '';
          const durationRegex = /DURATION\s*EFFECTIVENESS\s*:?\s*([\s\S]+?)(?:\n\nSELECTED|\nSELECTED|\n\n\s*$|$)/i;
          const durationMatch = contextAfter.match(durationRegex);
          
          if (durationMatch) {
            durationEffectiveness = durationMatch[1].trim();
          }
          
          // Log extracted data for debugging
          appendToLog(`For clip ${clipNumber + 1}:
            - Reason: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}
            - Audience: ${audience.substring(0, 100)}${audience.length > 100 ? '...' : ''}
            - Duration: ${durationEffectiveness.substring(0, 100)}${durationEffectiveness.length > 100 ? '...' : ''}`, 'DEBUG');
          
          if (clipNumber >= 0 && clipNumber < clipsForAI.length) {
            return {
              ...clipsForAI[clipNumber],
              reason: reason || `Selected by AI (Clip ${clipNumber + 1})`,
              targetAudience: audience || 'General audience',
              durationEffectiveness: durationEffectiveness || '',
              aiSelected: true
            };
          }
          return null;
        }).filter(Boolean); // Remove any null entries
      }
      
      if (selectedClips.length > 0) {
        appendToLog(`Successfully parsed ${selectedClips.length} clips from AI response`, 'INFO');
        
        // Log the selected clips for analysis
        appendToLog(`SELECTED CLIPS FROM AI:\n${JSON.stringify(selectedClips.map(clip => ({
          clipNumber: clipsForAI.indexOf(clip) + 1,
          start: clip.start.toFixed(2),
          end: clip.end.toFixed(2),
          duration: clip.duration.toFixed(2),
          reason: clip.reason,
          audience: clip.targetAudience,
          text: clip.text.substring(0, 100) + (clip.text.length > 100 ? '...' : '')
        })), null, 2)}`, 'DEBUG');
        
        return selectedClips;
      }
      
      // If all parsing attempts fail, use the fallback
      appendToLog('Could not parse clip selections from AI response using standard patterns', 'WARNING');
      return fallbackClipSelection(clipsForAI);
      
    } catch (error) {
      appendToLog(`Error parsing AI response: ${error.message}`, 'ERROR');
      return fallbackClipSelection(clipsForAI);
    }
  } catch (error) {
    appendToLog(`Error in AI clip selection: ${error.message}`, 'ERROR');
    return fallbackClipSelection(clipsForAI);
  }
}

/**
 * Identify clips from chapters
 * @param {Array} chapters - Array of chapter objects
 * @returns {Promise<Array>} - Array of clip objects
 */
async function identifyClipsFromChapters(chapters) {
  appendToLog(`Processing ${chapters.length} chapters for clips`, 'INFO');
  
  // Filter chapters that meet duration requirements
  const potentialClips = chapters
    .filter(chapter => {
      const duration = (chapter.end - chapter.start) / 1000;
      return duration >= CLIP_MIN_DURATION && duration <= CLIP_MAX_DURATION;
    })
    .map(chapter => {
      const start = chapter.start / 1000;
      const end = chapter.end / 1000;
      return {
        start,
        end,
        duration: end - start,
        text: chapter.headline || chapter.summary || '',
        gist: chapter.gist || '',
        reason: `Chapter: ${chapter.headline || 'Untitled'}`
      };
    });
  
  appendToLog(`Found ${potentialClips.length} chapters that match clip duration requirements`, 'INFO');
  
  if (potentialClips.length === 0) {
    return identifyClips({ chapters });
  }
  
  // Sort by quality or other metrics if needed
  return potentialClips.slice(0, 5);
}

/**
 * Basic clip identification (fallback)
 * @param {Object} transcriptData - Transcript data
 * @returns {Array} - Array of clip objects
 */
function identifyClips(transcriptData) {
  appendToLog('Using basic clip identification...', 'WARNING');
  
  const utterances = transcriptData.utterances || [];
  
  if (utterances.length === 0) {
    appendToLog('No utterances found for basic clip identification.', 'WARNING');
    return [];
  }
  
  appendToLog(`Found ${utterances.length} utterances for basic clip identification.`, 'INFO');
  
  const clips = [];
  let currentClip = {
    start: utterances[0].start / 1000,
    end: utterances[0].end / 1000,
    text: utterances[0].text,
    reason: 'Basic clip identification'
  };
  
  // Calculate duration
  currentClip.duration = currentClip.end - currentClip.start;
  
  for (let i = 1; i < utterances.length; i++) {
    const utterance = utterances[i];
    const utteranceStart = utterance.start / 1000;
    const utteranceEnd = utterance.end / 1000;
    
    // If adding this utterance would make the clip too long, start a new clip
    if (utteranceEnd - currentClip.start > CLIP_MAX_DURATION) {
      // Before adding the clip, check if it ends with a complete sentence
      const endsWithSentenceTerminator = /[.!?]\s*$/.test(currentClip.text.trim());
      
      // If it doesn't end with a sentence terminator and there's more than one utterance in the current clip,
      // try to find the last sentence boundary within the text
      if (!endsWithSentenceTerminator) {
        const sentenceBoundaries = [...currentClip.text.matchAll(/[.!?]\s+/g)];
        
        if (sentenceBoundaries.length > 0) {
          // Get the last complete sentence boundary
          const lastBoundary = sentenceBoundaries[sentenceBoundaries.length - 1];
          const boundaryIndex = lastBoundary.index + lastBoundary[0].length;
          
          // Trim the text to end at the last complete sentence
          currentClip.text = currentClip.text.substring(0, boundaryIndex).trim();
          
          // Adjust the end time proportionally
          const textRatio = boundaryIndex / currentClip.text.length;
          const clipDuration = currentClip.duration;
          const adjustedDuration = clipDuration * textRatio;
          
          currentClip.end = currentClip.start + adjustedDuration;
          currentClip.duration = adjustedDuration;
        }
      }
      
      // Only add clips that meet minimum duration
      if (currentClip.duration >= CLIP_MIN_DURATION) {
        clips.push(currentClip);
      }
      
      currentClip = {
        start: utteranceStart,
        end: utteranceEnd,
        text: utterance.text,
        reason: 'Basic clip identification'
      };
      
      // Calculate duration
      currentClip.duration = currentClip.end - currentClip.start;
    } else {
      // Otherwise, extend the current clip
      currentClip.end = utteranceEnd;
      currentClip.text += ' ' + utterance.text;
      
      // Recalculate duration
      currentClip.duration = currentClip.end - currentClip.start;
    }
  }
  
  // Process the last clip to ensure it doesn't end mid-sentence
  const endsWithSentenceTerminator = /[.!?]\s*$/.test(currentClip.text.trim());
  
  if (!endsWithSentenceTerminator) {
    const sentenceBoundaries = [...currentClip.text.matchAll(/[.!?]\s+/g)];
    
    if (sentenceBoundaries.length > 0) {
      // Get the last complete sentence boundary
      const lastBoundary = sentenceBoundaries[sentenceBoundaries.length - 1];
      const boundaryIndex = lastBoundary.index + lastBoundary[0].length;
      
      // Trim the text to end at the last complete sentence
      currentClip.text = currentClip.text.substring(0, boundaryIndex).trim();
      
      // Adjust the end time proportionally
      const textRatio = boundaryIndex / currentClip.text.length;
      const clipDuration = currentClip.duration;
      const adjustedDuration = clipDuration * textRatio;
      
      currentClip.end = currentClip.start + adjustedDuration;
      currentClip.duration = adjustedDuration;
    }
  }
  // Add the last clip if it meets minimum duration
  if (currentClip.duration >= CLIP_MIN_DURATION) {
    clips.push(currentClip);
  }
  
  appendToLog(`Created ${clips.length} basic clips`, 'INFO');
  return clips.slice(0, 5); // Limit to 5 clips
}

/**
 * Fallback clip selection when AI fails
 * @param {Array} filteredClips - Filtered clips
 * @returns {Array} - Selected clips
 */
function fallbackClipSelection(filteredClips) {
  appendToLog('Using fallback clip selection method with viral focus and duration diversity', 'INFO');
  
  if (filteredClips.length === 0) {
    appendToLog('No clips to select from', 'WARNING');
    return [];
  }
  
  // Score clips based on indicators of viral potential
  const scoredClips = filteredClips.map(clip => {
    let viralScore = 0;
    const text = clip.text.toLowerCase();
    
    // Look for storytelling elements
    if (
      /^(when|once|there was|i|we|they|if you|eventually|at first|finally|ultimately)/i.test(text) &&
      text.length > 50
    ) {
      viralScore += 0.3; // Narrative opening
    }
    
    // Look for emotional impact words
    const emotionalImpact = (
      text.match(/amazing|incredible|surprising|shocking|mind-blowing|never|always|changed|stunned|couldn't believe|realized|discovered|astonishing|powerful|transformative|fascinating/gi) || []
    ).length;
    
    viralScore += Math.min(0.4, emotionalImpact * 0.1); // Cap at 0.4
    
    // Look for educational value
    const educationalValue = (
      text.match(/learn|understand|know|explain|how to|works|actually|truth|fact|study|research|found|most people don't|realize|secret|technique|method|steps/gi) || []
    ).length;
    
    viralScore += Math.min(0.4, educationalValue * 0.1); // Cap at 0.4
    
    // Look for hooks that create curiosity
    if (
      /^(what if|here's why|the truth about|most people don't know|the secret to|this is how|i never knew|you won't believe|the real reason)/i.test(text)
    ) {
      viralScore += 0.3; // Curiosity hook
    }
    
    // Look for contradictions or surprising elements (often viral)
    if (
      /but|however|surprisingly|instead|contrary|opposite|unlike|unexpected|twist|plot twist|actually|reality|truth/i.test(text)
    ) {
      viralScore += 0.2;
    }
    
    // Prefer concise but substantive clips
    const wordCount = text.split(/\s+/).length;
    const densityScore = (wordCount > 15 && wordCount < 50) ? 0.2 : 0;
    viralScore += densityScore;
    
    // If clip already has a quality score, blend with the viral score
    const finalScore = clip.qualityScore ? 
      (clip.qualityScore * 0.4) + (viralScore * 0.6) : 
      viralScore;
    
    // Create a duration category for each clip
    let durationCategory = '';
    if (clip.duration < 10) durationCategory = 'very_short';
    else if (clip.duration < 20) durationCategory = 'short';
    else if (clip.duration < 30) durationCategory = 'medium';
    else durationCategory = 'long';
    
    return {
    ...clip,
      viralScore,
      finalScore,
      durationCategory,
      reason: `Selected for likely viral elements: ${
        viralScore > 0.5 ? 'High viral potential' :
        viralScore > 0.3 ? 'Moderate viral potential' : 
        'Potential interest elements'
      }`
    };
  });
  
  // Sort by final score within each duration category
  const clipsByDuration = {
    very_short: scoredClips.filter(c => c.durationCategory === 'very_short').sort((a, b) => b.finalScore - a.finalScore),
    short: scoredClips.filter(c => c.durationCategory === 'short').sort((a, b) => b.finalScore - a.finalScore),
    medium: scoredClips.filter(c => c.durationCategory === 'medium').sort((a, b) => b.finalScore - a.finalScore),
    long: scoredClips.filter(c => c.durationCategory === 'long').sort((a, b) => b.finalScore - a.finalScore)
  };
  
  // Ensure we get clips from each duration category if available
  const selectedClips = [];
  
  // Get the count of non-empty categories
  const nonEmptyCategories = Object.values(clipsByDuration).filter(clips => clips.length > 0).length;
  
  // Try to select at least one clip from each category if available
  Object.entries(clipsByDuration).forEach(([category, clips]) => {
    if (clips.length > 0) {
      // Add top clip from each non-empty category
      selectedClips.push(clips[0]);
    }
  });
  
  // If we have more than 5 clips, trim to best 5
  if (selectedClips.length > 5) {
    selectedClips.sort((a, b) => b.finalScore - a.finalScore);
    return selectedClips.slice(0, 5);
  }
  
  // If we have less than 5 clips, add more high-scoring clips regardless of duration
  if (selectedClips.length < 5) {
    // Create a list of remaining clips that aren't already selected
    const remainingClips = scoredClips.filter(clip => !selectedClips.includes(clip))
                                     .sort((a, b) => b.finalScore - a.finalScore);
    
    // Add remaining clips until we reach 5 or run out of clips
    while (selectedClips.length < 5 && remainingClips.length > 0) {
      // Take the top remaining clip
      const nextBestClip = remainingClips.shift();
      
      // Check if this clip overlaps significantly with any already selected clips
      const overlapsWithExisting = selectedClips.some(existingClip => {
        // Check for overlap in timestamps
        const timeOverlap = Math.max(0, 
          Math.min(nextBestClip.end, existingClip.end) - 
          Math.max(nextBestClip.start, existingClip.start)
        );
        
        const shortestDuration = Math.min(
          nextBestClip.end - nextBestClip.start,
          existingClip.end - existingClip.start
        );
        
        // If overlap is more than 40% of the shorter clip, consider it significant
        return timeOverlap > (shortestDuration * 0.4);
      });
      
      if (!overlapsWithExisting) {
        selectedClips.push(nextBestClip);
      }
    }
  }
  
  appendToLog(`Selected ${selectedClips.length} clips using viral-focused fallback method with duration diversity`, 'INFO');
  const durationDistribution = selectedClips.reduce((acc, clip) => {
    acc[clip.durationCategory] = (acc[clip.durationCategory] || 0) + 1;
    return acc;
  }, {});
  
  appendToLog(`Duration distribution: ${JSON.stringify(durationDistribution)}`, 'INFO');
  
  return selectedClips;
}

module.exports = {
  identifyClipsWithAI,
  generateClips,
  identifyClips,
  identifyClipsFromFullText,
  identifyClipsFromUtterances,
  identifyClipsFromWords,
  identifyClipsFromChapters,
  filterClipsForQuality,
  getDiverseClipSelectionWithDurations,
  getRelevanceMarkersForContentType
}; 