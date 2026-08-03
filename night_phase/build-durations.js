'use strict'

// Regenerates night_narration_audio/durations.json from the actual mp3s.
// Run this any time you add, remove, or re-record a narration clip —
// nightNarration.js's expectedNightSecs() (which drives the sidebar's Night
// row and the Q1-Q5/Assassination time budget) reads that file directly and
// won't notice new/changed clips until it's regenerated.
//
// Requires ffprobe (part of ffmpeg: `brew install ffmpeg`).
//
// Usage:  node night_phase/build-durations.js

const fs   = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DIR          = path.join(__dirname, 'night_narration_audio')
const DURATIONS_OUT = path.join(DIR, 'durations.json')

const files = fs.readdirSync(DIR).filter(f => /\.mp3$/i.test(f))
const out = {}
for (const f of files) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path.join(DIR, f),
  ]).toString().trim()
  out[f] = Math.round(parseFloat(raw) * 1000) / 1000
}

fs.writeFileSync(DURATIONS_OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`Probed ${Object.keys(out).length} clips -> ${path.relative(process.cwd(), DURATIONS_OUT)}`)
