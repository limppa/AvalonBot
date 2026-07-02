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
function init(settings) {
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
      newPlayers:          { good: null, evil: null },
      notes:               '',
    },
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

function finalizeGoodWin(totalSeconds) {
  if (!_log) return
  _log.outcome = { winner: 'good', reason: 'merlin-survived', totalSeconds: Math.round(totalSeconds) }
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

function setBalance(value) {
  if (!_log) return
  _log.optional.balance = value
}

function setAssassinConfidence(value) {
  if (!_log) return
  _log.optional.assassinConfidence = value
}

function setNewPlayers(good, evil) {
  if (!_log) return
  _log.optional.newPlayers = {
    good: (good !== null && good !== '' && !isNaN(good)) ? Number(good) : null,
    evil: (evil !== null && evil !== '' && !isNaN(evil)) ? Number(evil) : null,
  }
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
  setBalance,
  setAssassinConfidence,
  setNewPlayers,
  setRoster,
  setNotes,
  save,
}
