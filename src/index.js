#!/usr/bin/env node

/**
 * AI Video Clipper
 * Main entry point for the application
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const chalk = require('chalk');
const { setupLogger, appendToLog } = require('./utils/logger');
const { downloadVideo } = require('./services/download');
const { extractAudio } = require('./services/media');
const { transcribeAudio } = require('./services/transcription');
const { identifyClipsWithAI, generateClips } = require('./services/clipper');
const { DIRS, YOUTUBE_URL, VIDEO_FILE, AUDIO_FILE, CLIPS_DIR, TRANSCRIPT_FILE, LOG_FILE, FILES } = require('./config/constants');

// Initialize program
const program = new Command();
program
  .name('ai-video-clipper')
  .description('AI-powered tool to extract and create engaging clips from videos')
  .version('1.0.0');

program
  .option('-u, --url <url>', 'YouTube URL to process')
  .option('-v, --video <path>', 'Path to existing video file')
  .option('-a, --audio <path>', 'Path to existing audio file')
  .option('-t, --transcript <path>', 'Path to existing transcript file')
  .option('-s, --skip-download', 'Skip video download')
  .option('-x, --skip-transcription', 'Skip transcription')
  .option('-o, --output <directory>', 'Output directory for clips')
  .option('-c, --cleanup', 'Clean up clips directory before running');

async function main() {
  try {
    // Parse arguments
    program.parse();
    const options = program.opts();
    
    // Add cleanup option
    const shouldCleanup = options.cleanup || false;
    
    // Setup logger
    setupLogger();
    appendToLog('Starting AI Video Clipper', 'INFO');
    
    // Ensure media directories exist
    for (const [key, dir] of Object.entries(DIRS)) {
      if (!fs.existsSync(dir)) {
        appendToLog(`Creating ${key} directory: ${dir}`, 'INFO');
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Create unique timestamp for this run to avoid overwriting files
    const runTimestamp = Date.now();
    const uniqueId = `${runTimestamp}`;
    
    // Determine paths based on options with unique filenames
    const videoUrl = options.url || YOUTUBE_URL;
    const videoFilename = `video_${uniqueId}.mp4`;
    const videoPath = options.video || VIDEO_FILE || path.join(DIRS.VIDEO, videoFilename);
    const audioFilename = `audio_${uniqueId}.mp3`;
    const audioPath = options.audio || AUDIO_FILE || path.join(DIRS.AUDIO, audioFilename);
    const transcriptFilename = `transcript_${uniqueId}.json`;
    const transcriptPath = options.transcript || TRANSCRIPT_FILE || path.join(DIRS.TRANSCRIPT, transcriptFilename);
    const clipsDir = options.output || CLIPS_DIR;
    
    // Store the unique filenames in a global context for other modules to access
    global.currentRun = {
      timestamp: runTimestamp,
      videoPath,
      audioPath,
      transcriptPath,
      clipsDir
    };
    
    appendToLog(`Using unique ID for this run: ${uniqueId}`, 'INFO');
    appendToLog(`Using video: ${videoPath}`, 'INFO');
    appendToLog(`Using audio: ${audioPath}`, 'INFO');
    appendToLog(`Using transcript: ${transcriptPath}`, 'INFO');
    
    // Clean up clips directory if requested
    if (shouldCleanup) {
      appendToLog('Cleaning up clips directory...', 'INFO');
      const clipFiles = fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4'));
      clipFiles.forEach(file => {
        fs.unlinkSync(path.join(clipsDir, file));
        appendToLog(`Deleted ${file}`, 'INFO');
      });
      appendToLog(`Removed ${clipFiles.length} existing clip files`, 'INFO');
    }
    
    // Create clips directory if it doesn't exist (in case it's a custom path)
    if (!fs.existsSync(clipsDir)) {
      appendToLog(`Creating output directory: ${clipsDir}`, 'INFO');
      fs.mkdirSync(clipsDir, { recursive: true });
    }
    
    let transcript = null;
    
    // Check if files already exist to avoid redownloading/reprocessing
    const videoExists = fs.existsSync(videoPath);
    const audioExists = fs.existsSync(audioPath);
    const transcriptExists = fs.existsSync(transcriptPath);
    
    // Step 1: Download video if needed
    if (!options.skipDownload && !videoExists) {
      appendToLog(`Downloading video from ${videoUrl} to ${videoPath}`, 'INFO');
      await downloadVideo(videoUrl, videoPath);
    } else {
      appendToLog(`Skipping video download, using existing file: ${videoPath}`, 'INFO');
    }
    
    // Step 2: Extract audio if needed
    if (!audioExists && fs.existsSync(videoPath)) {
      appendToLog(`Extracting audio from ${videoPath} to ${audioPath}`, 'INFO');
      await extractAudio(videoPath, audioPath);
    } else {
      appendToLog(`Skipping audio extraction, using existing file: ${audioPath}`, 'INFO');
    }
    
    // Step 3: Transcribe audio if needed
    if (!transcriptExists && fs.existsSync(audioPath)) {
      appendToLog(`Transcribing audio from ${audioPath} to ${transcriptPath}`, 'INFO');
      transcript = await transcribeAudio(audioPath, transcriptPath);
    } else if (transcriptExists) {
      appendToLog(`Loading existing transcript from ${transcriptPath}`, 'INFO');
      try {
        transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
      } catch (error) {
        appendToLog(`Error loading transcript: ${error.message}`, 'ERROR');
        throw new Error(`Failed to load transcript: ${error.message}`);
      }
    } else {
      appendToLog('Skipping transcription', 'INFO');
    }
    
    // Step 4: Identify clips
    if (transcript) {
      appendToLog('Identifying engaging clips', 'INFO');
      const clips = await identifyClipsWithAI(transcript);
      
      if (clips && clips.length > 0) {
        appendToLog(`Identified ${clips.length} clips`, 'INFO');
        
        // Step 5: Generate clips
        appendToLog('Generating video clips', 'INFO');
        await generateClips(clips, videoPath, clipsDir);
        
        appendToLog('Clip generation completed successfully', 'INFO');
        appendToLog(`Generated clips can be found in: ${path.resolve(clipsDir)}`, 'INFO');
      } else {
        appendToLog('No clips identified', 'WARNING');
      }
    } else {
      appendToLog('No transcript data available, cannot identify clips', 'ERROR');
    }
    
    // Final summary
    appendToLog('\n===== RUN SUMMARY =====', 'INFO');
    console.log(chalk.bold('\n===== AI VIDEO CLIPPER RUN SUMMARY ====='));
    console.log(chalk.cyan('Source:'), videoPath);
    console.log(chalk.cyan('Audio:'), audioPath);
    console.log(chalk.cyan('Transcript:'), transcriptPath);
    console.log(chalk.cyan('Clips directory:'), clipsDir);
    
    // List generated clips if any
    const clipFiles = fs.readdirSync(clipsDir)
      .filter(f => f.startsWith(`clip_${uniqueId}`))
      .map(f => path.join(clipsDir, f));
    
    if (clipFiles.length > 0) {
      console.log(chalk.green(`\nGenerated ${clipFiles.length} clips:`));
      
      // Try to get clips info from the log file for better details
      let clipsWithDetails = [];
      
      try {
        if (fs.existsSync(FILES.SELECTED_CLIPS_DATA)) {
          const clipsData = JSON.parse(fs.readFileSync(FILES.SELECTED_CLIPS_DATA, 'utf8'));
          clipsWithDetails = clipsData.clips;
        }
      } catch (error) {
        appendToLog(`Error loading clips details: ${error.message}`, 'WARNING');
      }
      
      // Display clips with more information if available
      clipFiles.forEach((clipPath, index) => {
        const fileName = path.basename(clipPath);
        const fileSizeBytes = fs.statSync(clipPath).size;
        const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2);
        
        // Try to find matching clip details
        const parsedTimestamps = fileName.match(/clip_\d+_(\d+)_(\d+)\.mp4/);
        let clipDetail = null;
        
        if (parsedTimestamps && clipsWithDetails.length > 0) {
          const startTime = parseInt(parsedTimestamps[1], 10);
          
          // Find the closest matching clip by start time
          clipDetail = clipsWithDetails.find(c => 
            Math.abs(Math.floor(c.start) - startTime) < 5
          );
        }
        
        if (clipDetail) {
          // Format duration as MM:SS
          const durationSec = clipDetail.duration;
          const minutes = Math.floor(durationSec / 60);
          const seconds = Math.floor(durationSec % 60);
          const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          // Get a short reason snippet
          const reason = clipDetail.reason ? 
            clipDetail.reason.substring(0, 60) + (clipDetail.reason.length > 60 ? '...' : '') : 
            'No reason provided';
          
          console.log(chalk.green(`  ${index + 1}. ${fileName} (${fileSizeMB} MB)`));
          console.log(chalk.yellow(`     Duration: ${formattedDuration} | Quality: ${clipDetail.qualityScore?.toFixed(2) || 'N/A'}`));
          console.log(chalk.yellow(`     Selection reason: ${reason}`));
        } else {
          console.log(chalk.green(`  ${index + 1}. ${fileName} (${fileSizeMB} MB)`));
        }
      });
      
      console.log(chalk.green(`\nClips are available in: ${path.resolve(clipsDir)}`));
      console.log(chalk.yellow('\nTo review the clips in order, you can run:'));
      console.log(`cd ${clipsDir} && ls -la | grep clip_${uniqueId} | sort -k 9`);
    } else {
      console.log(chalk.yellow('\nNo clips were generated in this run.'));
    }
    
    console.log(chalk.cyan('\nLog file:'), LOG_FILE);
    console.log(chalk.cyan('Clips data:'), FILES.SELECTED_CLIPS_DATA);
    console.log(chalk.bold('=========================================\n'));
    
  } catch (error) {
    appendToLog(`Error in main process: ${error.message}`, 'ERROR');
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

// Run the main function
main()
  .then(() => {
    appendToLog('AI Video Clipper execution completed', 'INFO');
  })
  .catch(error => {
    appendToLog(`Unhandled error: ${error.message}`, 'ERROR');
    console.error(chalk.red(`Unhandled error: ${error.message}`));
    process.exit(1);
  }); 