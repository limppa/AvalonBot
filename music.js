'use strict'

const path = require('path')
const fs   = require('fs')
const { pathToFileURL } = require('url')

class MusicPlayer {
  constructor() {
    this.a = new Audio()
    this.a.volume = 0.10
    this.a.addEventListener('ended', () => this._onMainEnded())

    this.folder         = null
    this.playlist       = []        // tracks queued for current folder (loop mode)
    this._fade          = null
    this._played        = new Set() // filenames heard this session
    this._oneShotNext   = null      // folder to fade to after a one-shot track ends
    this._filter        = { medievalOnly: false }
    this._meta          = this._loadMeta()
    this.onTrackChange  = null      // callback fired whenever a new track src is set

    // Two preload slots — 'a' for success/good outcomes, 'b' for fail/evil outcomes
    this._pre = {
      a: { audio: new Audio(), folder: null, file: null, url: null },
      b: { audio: new Audio(), folder: null, file: null, url: null },
    }
  }

  // ── Metadata & filter ─────────────────────────────────────────────────────

  _loadMeta() {
    try {
      return JSON.parse(fs.readFileSync(
        path.join(__dirname, 'music', 'metadata.json'), 'utf8'))
    } catch { return {} }
  }

  // Call whenever the medieval filter setting changes.
  setFilter(opts) {
    Object.assign(this._filter, opts)
  }

  // ── Track selection ───────────────────────────────────────────────────────

  _filesForFolder(folder) {
    const dir = path.join(__dirname, 'music', folder)
    try {
      let files = fs.readdirSync(dir).filter(f => /\.(mp3|ogg)$/i.test(f))
      if (this._filter.medievalOnly) {
        const filtered = files.filter(f => this._meta[f]?.medieval !== false)
        if (filtered.length) files = filtered
        // else: no medieval tracks in this folder — fall back to all
      }
      return files
    } catch { return [] }
  }

  // Pick one track, preferring unplayed. Does NOT mark as played.
  _pickTrack(folder) {
    const files   = this._filesForFolder(folder)
    if (!files.length) return null
    const unplayed = files.filter(f => !this._played.has(f))
    const pool     = unplayed.length ? unplayed : files
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // Shuffled playlist: unplayed tracks first, then already-played ones.
  _buildPlaylist(folder) {
    const files   = this._filesForFolder(folder)
    const shuffle = arr => [...arr].sort(() => Math.random() - 0.5)
    return [
      ...shuffle(files.filter(f => !this._played.has(f))),
      ...shuffle(files.filter(f =>  this._played.has(f))),
    ]
  }

  // ── Continuous playback ───────────────────────────────────────────────────

  playFolder(folderName) {
    this.folder       = folderName
    this._oneShotNext = null
    clearInterval(this._fade)
    this.a.volume = 0.10
    this.playlist = this._buildPlaylist(folderName)
    this._advance()
  }

  _advance() {
    if (!this.playlist.length) return
    const file = this.playlist.shift()
    this._played.add(file)
    this.a.src = pathToFileURL(path.join(__dirname, 'music', this.folder, file)).href
    this.a.play().catch(e => console.warn('Audio:', e.message))
    if (this.onTrackChange) this.onTrackChange()
  }

  _onMainEnded() {
    if (this._oneShotNext) {
      const next        = this._oneShotNext
      this._oneShotNext = null
      this.fadeToFolder(next)
      return
    }
    if (!this.playlist.length) this.playlist = this._buildPlaylist(this.folder)
    this._advance()
  }

  fadeToFolder(folderName, ms = 1800) {
    clearInterval(this._fade)
    const startVol = this.a.volume
    const steps    = 24
    const dt       = ms / steps
    let   n        = 0
    this._fade = setInterval(() => {
      n++
      this.a.volume = Math.max(0, startVol * (1 - n / steps))
      if (n >= steps) {
        clearInterval(this._fade)
        this.a.pause()
        this.playFolder(folderName)
      }
    }, dt)
  }

  // ── Preloading ────────────────────────────────────────────────────────────

  // Buffer one track from folder into slot 'a' or 'b'.
  // Marks the file as claimed so nothing else picks the same track this session.
  preload(folder, slot = 'a') {
    const file = this._pickTrack(folder)
    if (!file) return
    const pre  = this._pre[slot]
    pre.folder = folder
    pre.file   = file
    pre.url    = pathToFileURL(path.join(__dirname, 'music', folder, file)).href
    pre.audio.src = pre.url  // browser starts buffering silently
    this._played.add(file)   // claim it — prevents double-picks
  }

  // Buffer one track from each of two folders, for moments where the outcome
  // depends on the next keypress (S/F or G/E).
  preloadDual(folderA, folderB) {
    this.preload(folderA, 'a')
    this.preload(folderB, 'b')
  }

  // Play a preloaded track after a very short (~90 ms) fade-out of the current track.
  // Because the file is already buffered, playback starts with near-zero latency.
  //
  // opts.oneShot {bool}     — play the track once, then fade to opts.nextFolder
  // opts.nextFolder {str}   — folder to transition to after a one-shot ends
  // opts.fallbackFolder     — used if no preload is ready (falls back to fadeToFolder)
  playPreloaded(slot, opts = {}) {
    const pre = this._pre[slot]

    // Capture values now — the slot may be overwritten before the fade finishes
    const urlToPlay    = pre.url
    const folderToPlay = pre.folder
    const preAudio     = pre.audio

    if (!urlToPlay) {
      const folder = folderToPlay ?? opts.fallbackFolder
      if (folder) this.fadeToFolder(folder)
      return
    }

    clearInterval(this._fade)
    const startVol = this.a.volume
    const steps    = 8        // ~90 ms total fade-out
    const dt       = 90 / steps
    let   n        = 0

    this._fade = setInterval(() => {
      n++
      this.a.volume = Math.max(0, startVol * (1 - n / steps))
      if (n >= steps) {
        clearInterval(this._fade)
        this.a.pause()

        this.folder       = folderToPlay
        this._oneShotNext = (opts.oneShot && opts.nextFolder) ? opts.nextFolder : null
        this.playlist     = opts.oneShot ? [] : this._buildPlaylist(folderToPlay)

        this.a.src    = urlToPlay  // already buffered → near-instant start
        this.a.volume = 0.10
        this.a.play().catch(e => console.warn('Audio:', e.message))
        if (this.onTrackChange) this.onTrackChange()

        // Release the slot so it can be reused immediately
        preAudio.src   = ''
        pre.file       = null
        pre.folder     = null
        pre.url        = null
      }
    }, dt)
  }

  // ── Session ───────────────────────────────────────────────────────────────

  // Clear the played-this-session set. Call at the start of each new game.
  resetSession() {
    this._played.clear()
  }

  stop() {
    clearInterval(this._fade)
    this._oneShotNext = null
    this.a.pause()
    this.a.src = ''
  }

  get currentTrack() {
    const src = this.a.src
    if (!src) return null
    try {
      const name = decodeURIComponent(new URL(src).pathname.split('/').pop())
      return name.replace(/\.(mp3|ogg)$/i, '') || null
    } catch { return null }
  }
}

module.exports = MusicPlayer
