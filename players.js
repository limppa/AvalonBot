'use strict'

const path = require('path')
const fs   = require('fs')

const FILE = path.join(__dirname, 'players.json')
let _cache = null

function _load() {
  if (_cache) return
  try {
    _cache = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (!Array.isArray(_cache)) _cache = []
  } catch {
    _cache = []
  }
}

function _save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(_cache, null, 2))
  } catch (e) {
    console.warn('players: save failed:', e.message)
  }
}

function getAll() {
  _load()
  return [..._cache]
}

// Finds an existing name (case-insensitive) or adds it and saves.
function findOrCreate(name) {
  _load()
  const norm = name.trim()
  if (!norm) return null
  const existing = _cache.find(n => n.toLowerCase() === norm.toLowerCase())
  if (!existing) {
    _cache.push(norm)
    _save()
  }
  return existing || norm
}

module.exports = { getAll, findOrCreate }
