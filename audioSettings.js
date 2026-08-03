'use strict'

const path = require('path')
const fs   = require('fs')

const FILE = path.join(__dirname, 'audioSettings.json')

// Percentages (0-100), not raw 0-1 fractions — keeps ±5% menu steps exact
// instead of drifting through floating point.
const DEFAULTS = { music: 10, narrator: 100 }

let _cache = null

function _load() {
  if (_cache) return
  try {
    _cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
  } catch {
    _cache = { ...DEFAULTS }
  }
}

function _save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(_cache, null, 2))
  } catch (e) {
    console.warn('audioSettings: save failed:', e.message)
  }
}

function get() {
  _load()
  return { ..._cache }
}

function setMusic(pct) {
  _load()
  _cache.music = Math.max(0, Math.min(100, pct))
  _save()
}

function setNarrator(pct) {
  _load()
  _cache.narrator = Math.max(0, Math.min(100, pct))
  _save()
}

module.exports = { get, setMusic, setNarrator }
