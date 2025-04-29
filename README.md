# 🎬 AI Video Clipper

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/Bun-1.0.0+-brightgreen)](https://bun.sh)
[![Next.js](https://img.shields.io/badge/Next.js-15.0.0+-black)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.0.0+-blue)](https://react.dev)

AI-powered tool to automatically extract and create viral-worthy clips from videos for social media platforms like TikTok, Instagram Reels, and YouTube Shorts.

## ✨ Key Features

- 🎥 **Smart Video Download**: Download videos from YouTube, TikTok, Instagram, and more
- 🔊 **Audio Processing**: High-quality audio extraction and processing
- 🤖 **AI-Powered Analysis**: 
  - Automatic transcription using AssemblyAI
  - Intelligent clip identification using advanced AI algorithms
  - Engagement prediction for viral potential
- ✂️ **Professional Clip Generation**:
  - Customizable clip durations
  - Automatic caption generation
  - Social media optimized formats
  - High-quality video encoding

## 🚀 Quick Start

1. **Clone and Install**:
```bash
git clone https://github.com/yourusername/ai-video-clipper.git
cd ai-video-clipper
bun install
```

2. **Environment Setup**:
```bash
cp .env.example .env
```

3. **Configure API Keys**:
```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
OPENAI_API_KEY=your_openai_api_key
```

4. **Run the Application**:
```bash
bun dev
```

## 📋 Prerequisites

- Node.js 16+ or Bun 1.0+
- ffmpeg (for video processing)
- yt-dlp (for downloading videos)

## 💡 Usage Examples

### Basic Usage
```bash
# Process a YouTube video
bun start -- -u https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Advanced Options
```bash
# Use existing media files
bun start -- -v media/videos/video.mp4
bun start -- -a media/audio/audio.mp3
bun start -- -t media/transcripts/transcript.json

# Customize output
bun start -- -u <url> -o custom-clips --duration 30 --format tiktok
```

## 🔧 Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `-u, --url` | YouTube URL to process | - |
| `-v, --video` | Path to existing video file | - |
| `-a, --audio` | Path to existing audio file | - |
| `-t, --transcript` | Path to existing transcript file | - |
| `-s, --skip-download` | Skip video download | false |
| `-x, --skip-transcription` | Skip transcription | false |
| `-o, --output` | Output directory for clips | clips/ |
| `--duration` | Maximum clip duration (seconds) | 60 |
| `--format` | Output format (tiktok, instagram, youtube) | tiktok |

## 🏗️ Project Structure

```
ai-video-clipper/
├── src/
│   ├── components/     # React components
│   ├── lib/           # Core functionality
│   ├── pages/         # Next.js pages
│   └── styles/        # Tailwind styles
├── public/            # Static assets
├── media/            # Media files
│   ├── videos/       # Source videos
│   ├── audio/        # Extracted audio
│   ├── transcripts/  # Transcription files
│   └── clips/        # Generated clips
└── logs/             # Application logs
```

## 🤝 Contributing

We welcome contributions! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## 📝 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [AssemblyAI](https://www.assemblyai.com/) for transcription services
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for video downloading
- [ffmpeg](https://ffmpeg.org/) for video processing

## 📈 Performance

- ⚡ Fast video processing with optimized ffmpeg settings
- 🎯 High accuracy transcription and clip detection
- 📊 Detailed analytics and engagement metrics

## 🔍 SEO Keywords

video clipping, social media content, viral clips, AI video editing, content creation, video automation, TikTok clips, Instagram Reels, YouTube Shorts, video processing, AI transcription, content optimization 