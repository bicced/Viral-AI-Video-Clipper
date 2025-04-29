/**
 * Logger utility
 * Handles logging to files and console
 */

const fs = require('fs');
const path = require('path');
const { LOG_DIR, LOG_FILE } = require('../config/constants');

/**
 * Set up the logger by creating the log directory and initializing the log file
 */
function setupLogger() {
  // Create logs directory if it doesn't exist
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  
  // Initialize log file with header
  const header = `
========================================
AI Video Clipper - Log started at ${new Date().toISOString()}
----------------------------------------
System info:
- Node.js: ${process.version}
- Platform: ${process.platform} ${process.arch}
- Memory: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB (heap total)
========================================
`;
  
  fs.writeFileSync(LOG_FILE, header);
  console.log(`Logging to: ${LOG_FILE}`);
}

/**
 * Append a message to the log file
 * @param {string} message - Message to log
 * @param {string} level - Log level (INFO, WARNING, ERROR, DEBUG)
 */
function appendToLog(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  // Ensure log directory exists
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  
  // Write to log file
  fs.appendFileSync(LOG_FILE, logMessage);
  
  // Also print to console unless it's a data dump
  if (!message.includes('DATA:') && !message.startsWith('```') && !message.includes('RAW AI RESPONSE') && level !== 'DEBUG') {
    // Color output based on level
    switch (level) {
      case 'WARNING':
        console.log(`\x1b[33m[${level}]\x1b[0m ${message}`);
        break;
      case 'ERROR':
        console.log(`\x1b[31m[${level}]\x1b[0m ${message}`);
        break;
      case 'DEBUG':
        if (process.env.DEBUG) {
          console.log(`\x1b[36m[${level}]\x1b[0m ${message}`);
        }
        break;
      default:
        console.log(`${message}`);
    }
  }
}

module.exports = {
  setupLogger,
  appendToLog
}; 