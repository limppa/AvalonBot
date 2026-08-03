'use strict'

const path = require('path')
const fs   = require('fs')

const LOG_DIR = path.join(__dirname, 'logs')

let _log      = null
let _logPath  = null
let _questFailedVotes = [0, 0, 0, 0, 0]

function _ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

// Called when the night phase begins (i.e. the game is started).
// preGame (optional): { seating: [names in clockwise order], firstLeader: name|seatNumber }
function init(settings, preGame) {
  const now = new Date()
  _questFailedVotes = [0, 0, 0, 0, 0]
  _log = {
    version:  1,
    date:     now.toISOString(),
    settings: {
      players:    settings.players,
      gameSpeed:  settings.gameSpeed,
      targetTime: settings.targetTime,
      characters: { ...settings.characters },
      abilities:  { ...settings.abilities },
    },
    night:         null,
    quests:        [],
    assassination: null,
    outcome:       null,
    optional: {
      balance:             null,  // -3 (evil-favored) → 0 → +3 (good-favored)
      assassinConfidence:  null,  // 1 (total guess) → 5 (certain); only when assassination happened
      assassinationTarget: null,  // good character targeted (if not Merlin)
      assassinationVictim: null,  // 'merlin' | 'guinevere' — only asked when Guinevere is in play
      seating:             [],    // player names in clockwise seat order (optional)
      firstLeader:         null,  // name, or seat number (1..N) if no names entered
      lotlHolder:          null,  // derived: player counter-clockwise of first leader
      notes:               '',
    },
  }
  if (preGame) {
    _log.optional.seating     = Array.isArray(preGame.seating)
      ? preGame.seating.map(n => (n == null ? '' : String(n).trim())) : []
    _log.optional.firstLeader = (preGame.firstLeader === '' || preGame.firstLeader == null)
      ? null : preGame.firstLeader
    _deriveLotlHolder()
  }
  const ts = now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
  _logPath = path.join(LOG_DIR, `${ts}.json`)
}

function recordNightEnd(nightSecs) {
  if (!_log) return
  _log.night = { seconds: nightSecs }
}

// Call just BEFORE gs.voteCount is reset to zero on a vote passing.
function recordVotePass(questIdx, failedVotesBefore) {
  if (!_log) return
  _questFailedVotes[questIdx] = failedVotesBefore
}

function recordQuestEnd(questIdx, result, cardSeconds, votingSeconds, endTimestamp) {
  if (!_log) return
  _log.quests.push({
    questNumber:   questIdx + 1,
    failedVotes:   _questFailedVotes[questIdx],
    result,
    votingSeconds: Math.round(votingSeconds),
    cardSeconds:   Math.round(cardSeconds),
    endTimestamp:  Math.round(endTimestamp),
  })
}

function recordAssassination(assnSecs) {
  if (!_log) return
  _log.assassination = { seconds: Math.round(assnSecs) }
}

function finalizeGoodWin(totalSeconds, reason = 'merlin-survived') {
  if (!_log) return
  _log.outcome = { winner: 'good', reason, totalSeconds: Math.round(totalSeconds) }
}

function finalizeEvilWin(reason, totalSeconds) {
  // reason: 'merlin-killed' | 'quests-failed'
  if (!_log) return
  _log.outcome = { winner: 'evil', reason, totalSeconds: Math.round(totalSeconds) }
}

function setAssassinationTarget(characterName) {
  if (!_log) return
  _log.optional.assassinationTarget = characterName || null
}

function setAssassinationVictim(value) {
  if (!_log) return
  _log.optional.assassinationVictim = value || null
}

function setBalance(value) {
  if (!_log) return
  _log.optional.balance = value
}

function setAssassinConfidence(value) {
  if (!_log) return
  _log.optional.assassinConfidence = value
}

// The Lady of the Lake token starts with the player "to the right" of the first
// leader, which at the table means counter-clockwise = the PREVIOUS player in
// seating order (wrapping). Seats are positional, so we look ONLY at the seat
// immediately counter-clockwise: if that seat is unnamed the holder is unknown
// (null) — we don't skip past blanks, which would name the wrong player.
function _deriveLotlHolder() {
  if (!_log) return
  _log.optional.lotlHolder = null
  const s  = _log.optional.seating
  const fl = _log.optional.firstLeader
  if (!Array.isArray(s) || !s.length || fl == null || fl === '') return
  // firstLeader is either a seat number (1..N) or a name to locate in seating.
  const idx = (typeof fl === 'number')
    ? fl - 1
    : s.findIndex(x => x && String(x).toLowerCase() === String(fl).toLowerCase())
  if (idx < 0 || idx >= s.length) return
  const n    = s.length
  const prev = s[((idx - 1) % n + n) % n]
  if (prev && String(prev).trim()) _log.optional.lotlHolder = prev
}

function setSeating(seating) {
  if (!_log) return
  _log.optional.seating = Array.isArray(seating)
    ? seating.map(n => (n == null ? '' : String(n).trim())) : []
  _deriveLotlHolder()
}

function setFirstLeader(value) {
  if (!_log) return
  _log.optional.firstLeader = (value === '' || value == null) ? null : value
  _deriveLotlHolder()
}

function setRoster(roster) {
  if (!_log) return
  _log.roster = roster
}

function setNotes(text) {
  if (!_log) return
  _log.optional.notes = text
}

function save() {
  if (!_log || !_logPath) return
  _ensureDir()
  try {
    fs.writeFileSync(_logPath, JSON.stringify(_log, null, 2))
  } catch (e) {
    console.warn('gameLogs: save failed:', e.message)
  }
}

module.exports = {
  init,
  recordNightEnd,
  recordVotePass,
  recordQuestEnd,
  recordAssassination,
  finalizeGoodWin,
  finalizeEvilWin,
  setAssassinationTarget,
  setAssassinationVictim,
  setBalance,
  setAssassinConfidence,
  setSeating,
  setFirstLeader,
  setRoster,
  setNotes,
  save,
}
