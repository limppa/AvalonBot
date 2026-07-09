'use strict'

const { ipcRenderer } = require('electron')
const {
  QUOTES,
  QUEST_SIZES,
  TEAM_ROLES,
  CHAR_DESC,
  SPEED_ORDER,
  SPEED_LABELS,
  QUEST_ALLOTTED_BASE,
  QUEST_ALLOTTED_LOTL,
  QUEST_ALLOTTED_SUM,
  ASSN_QUEST_INDEX,
  ASSN_POOL_REF,
  ASSN_EVIL_PCT_REF,
  ASSN_BASE_RATE,
  OBERON_POOL_WEIGHT,
  QUEST_CARD_TIME,
  SPEED_ANCHOR_7P,
  DISCUSSION_RATE,
} = require('./gameData')
const MusicPlayer = require('./music')
const gameLogs    = require('./gameLogs')
const players     = require('./players')

// ── Theme tokens ─────────────────────────────────────────────────────────────
// Reads CSS variables once at startup — change values in :root to reskin canvas
// drawing code without ever touching JS. All canvas hex literals now live here.
const THEME = (() => {
  const s = getComputedStyle(document.documentElement)
  const v = n => s.getPropertyValue(n).trim()
  return {
    bg:         v('--bg0'),
    bgRaised:   v('--bg1'),
    stone:      v('--stone'),
    coin:       v('--coin'),
    accent:     v('--accent'),
    accentDim:  v('--accent-dim'),
    cream:      v('--cream'),
    dim:        v('--dim'),
    goodFill:   v('--good-fill'),
    goodEdge:   v('--good-edge'),
    goodText:   v('--good-txt'),
    evilFill:   v('--evil-fill'),
    evilEdge:   v('--evil-edge'),
    evilText:   v('--evil-txt'),
    evilCircText: v('--evil-circ'),
    warn:       v('--warn'),
  }
})()

// Role accent colors — derived from THEME so they follow the active color scheme
const ROLE_COLOR = {
  'Merlin':        THEME.goodText,
  'Percival':      THEME.goodText,
  'Loyal Servant': THEME.goodText,
  'Morgana':       THEME.evilText,
  'Assassin':      THEME.evilText,
  'Minion':        THEME.evilText,
  'Oberon':        THEME.evilText,
  'Mordred':       THEME.evilText,
}

// this is to collect information about crashes
window.addEventListener('error', e => {
  ipcRenderer.send('renderer-error', `${e.message} @ ${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', e => {
  ipcRenderer.send('renderer-error', `Unhandled rejection: ${e.reason}`)
})

// ── Game speed ───────────────────────────────────────────────────────────────
// Game length is computed from: night(p) + cards(p, speed) + D[speed] × p × mult[speed]
// where D[speed] is anchored so 7-player games hit SPEED_ANCHOR_7P.
// Constants (QUEST_CARD_TIME, ASSN_QUEST_INDEX, DISCUSSION_RATE) are defined in gameData.js.

function speedFromTime(players, time) {
  for (const s of SPEED_ORDER) {
    if (timeFromSpeed(players, s) === time) return s
  }
  return null
}

// Returns the speed tier whose anchors govern a given target time.
// Floors to the fastest preset whose anchor ≤ time, so 31 min stays in
// 'fast' territory (card times, assn index) until 'normal's anchor is reached.
function effectiveSpeed(time) {
  let result = SPEED_ORDER[0]
  for (const s of SPEED_ORDER) {
    if (timeFromSpeed(settings.players, s) <= time) result = s
  }
  return result
}

function timeFromSpeed(players, speed) {
  const cardTimes  = QUEST_CARD_TIME[speed]
  const questSizes = QUEST_SIZES[players]
  const cardTotal  = questSizes.reduce((sum, sz) => sum + cardTimes[sz], 0)
  const assnW      = QUEST_ALLOTTED_BASE[ASSN_QUEST_INDEX[speed]]
  const mult       = (QUEST_ALLOTTED_SUM + assnW) / QUEST_ALLOTTED_SUM
  return Math.round((calcNightExpected() + cardTotal + DISCUSSION_RATE[speed] * players * mult) / 60)
}

// ── Log screen labels ────────────────────────────────────────────────────────

const BALANCE_LABELS = {
  '-3': 'Evil dominated', '-2': 'Evil-leaning', '-1': 'Slightly evil',
  '0':  'Balanced',
  '1':  'Slightly good',  '2': 'Good-leaning',  '3': 'Good dominated',
}
const CONFIDENCE_LABELS = {
  '1': 'Complete guess', '2': 'Weakly suspected', '3': 'Two suspects',
  '4': 'Strongly suspected', '5': 'Certain',
}

// ── Settings (persist across games) ─────────────────────────────────────────

const settings = {
  players:    7,
  gameSpeed:  'normal',
  targetTime: 45,   // = timeFromSpeed(7, 'normal')
  characters: { merlin: true, assassin: true, percival: true, morgana: true, oberon: false, mordred: false },
  abilities:  { lotl: false, excalibur: false },
  menuRow:     0,
  menuPage:    'main',   // 'main' | 'characters'
  medievalOnly: false,   // when true, skip non-medieval songs (see music/metadata.json)
}

// Optional pre-game table setup. Seating persists across games in a session
// (same table), while firstLeader is re-rolled/cleared each game. Fed into
// gameLogs.init() so it lands in the log; never required to start a game.
const preGame = {
  seating:     [],    // names in clockwise seat order, indexed by seat (0-based)
  firstLeader: null,  // name (if seats named) or seat number 1..N (if not)
}

// Set true once the log screen's character/settings mismatch warning has shown,
// so a second Submit press lets an intentional mismatch through. Reset on open.
let _logCharWarned = false

// Draft of the log form, captured on ESC so re-opening the log screen restores
// the in-progress inputs. Cleared once the game is submitted. null = no draft.
let logDraft = null

// The character-column auto-open chain runs only the first time the log screen
// appears for a given game. Set true after that first run; reset per new game.
let logChainDone = false

// Where the 'setup' (add-players) screen returns to on Done/ESC: the main menu,
// or the post-night 'leader' screen when opened from its [P] Add players button.
let setupReturnPhase = 'menu'

// True while the leader screen is waiting for a second confirm to continue with
// no leader chosen (first ENTER arms it, second ENTER proceeds).
let _leaderConfirm = false

// Minimal HTML-escape for injecting saved values into markup.
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Pick who starts as first leader: choose a random seat 1..players and
// return that seat's name if it has one, else the seat number itself.
function randomizeFirstLeader(names, players) {
  const seat = Math.floor(Math.random() * players) + 1
  const nm = (names[seat - 1] || '').trim()
  return nm || seat
}

// Read the seat-name inputs (setup or log screen) back into preGame.seating,
// preserving seat positions (empty seats become '').
function syncSeatsToPreGame() {
  const arr = []
  document.querySelectorAll('[data-seat-idx]').forEach(el => {
    arr[parseInt(el.dataset.seatIdx)] = el.value.trim()
  })
  preGame.seating = arr
}

// True if any two filled seat-name inputs match (case-insensitive) — used to
// block submitting a roster with the same person entered twice.
function hasDuplicateNames() {
  const seen = new Set()
  let dup = false
  document.querySelectorAll('[data-seat-idx]').forEach(el => {
    const v = el.value.trim().toLowerCase()
    if (!v) return
    if (seen.has(v)) dup = true
    seen.add(v)
  })
  return dup
}

// ── Pre-night leader screen ──────────────────────────────────────────────────

let _leaderShuffleTimer = null   // active while the randomize shuffle is running
const _shuffleSfx = new Audio('sfx/shuffle.wav')   // "krrrrr, tschh!" on randomize
_shuffleSfx.volume = 0.7

function leaderHasChoice() {
  return preGame.firstLeader != null && preGame.firstLeader !== ''
}

// Snap a running shuffle straight to its final value (e.g. when the user
// continues or navigates away mid-animation).
function finishLeaderShuffle() {
  if (!_leaderShuffleTimer) return
  clearTimeout(_leaderShuffleTimer)
  _leaderShuffleTimer = null
  const el = document.getElementById('leader-input')
  if (el) {
    el.readOnly = false
    el.classList.remove('shuffling')
    el.classList.add('locked-in')
    el.value = (typeof preGame.firstLeader === 'number') ? String(preGame.firstLeader) : (preGame.firstLeader || '')
  }
}

// Read the leader screen's manual input into preGame.firstLeader (number if the
// text is purely digits — a seat — otherwise the typed name).
function syncLeaderInput() {
  const el = document.getElementById('leader-input')
  if (!el) return
  const v = el.value.trim()
  preGame.firstLeader = v === '' ? null : (/^\d+$/.test(v) ? Number(v) : v)
}

// Reset the "no leader chosen" confirm state back to the normal Continue button.
function leaderResetConfirm() {
  _leaderConfirm = false
  const btn = document.getElementById('leader-continue')
  if (btn) btn.textContent = '[ENTER]  Continue'
  document.getElementById('leader-warning')?.classList.remove('show')
}

function leaderRandomize() {
  if (_leaderShuffleTimer) return   // a shuffle is already running
  const el = document.getElementById('leader-input')
  if (!el) return

  // Candidate pool = each seat's name, or its number if unnamed.
  const pool = []
  for (let i = 0; i < gs.players; i++) {
    const nm = (preGame.seating[i] || '').trim()
    pool.push(nm || String(i + 1))
  }
  const res      = randomizeFirstLeader(preGame.seating.slice(0, gs.players), gs.players)
  const finalStr = (typeof res === 'number') ? String(res) : res
  preGame.firstLeader = res       // truth is set immediately; the shuffle is cosmetic
  leaderResetConfirm()

  // "krrrrr, tschh!" — shuffle runs for the clip length so the snap lands on the "tschh".
  try { _shuffleSfx.currentTime = 0; _shuffleSfx.play().catch(() => {}) } catch (_) {}

  // Slot-machine shuffle: cycle random candidates at a constant flip speed.
  el.readOnly = true
  el.classList.remove('locked-in')
  el.classList.add('shuffling')
  const start    = performance.now()
  const DURATION = 350            // snaps on the ~360ms tick, matching sfx/shuffle.wav (0.363s)
  let last = ''
  const tick = () => {
    if (!document.body.contains(el)) { _leaderShuffleTimer = null; return }
    const t = performance.now() - start
    if (t >= DURATION) {
      _leaderShuffleTimer = null
      el.readOnly = false
      el.classList.remove('shuffling')
      el.classList.add('locked-in')
      el.value = finalStr
      el.classList.remove('leader-settle'); void el.offsetWidth; el.classList.add('leader-settle')
      return
    }
    let v = pool[0] || finalStr
    if (pool.length > 1) { do { v = pool[(Math.random() * pool.length) | 0] } while (v === last) }
    last = v
    el.value = v
    _leaderShuffleTimer = setTimeout(tick, 40)   // ~25 flips/sec (unchanged rate)
  }
  tick()
}

function leaderContinue() {
  finishLeaderShuffle()
  syncLeaderInput()
  if (!leaderHasChoice() && !_leaderConfirm) {
    _leaderConfirm = true
    const btn = document.getElementById('leader-continue')
    if (btn) btn.textContent = '[ENTER]  Yes, continue'
    document.getElementById('leader-warning')?.classList.add('show')
    return
  }
  startNightFromLeader()
}

function leaderAddPlayers() {
  finishLeaderShuffle()
  syncLeaderInput()
  setupReturnPhase = 'leader'
  gs.phase = 'setup'
  renderOverlay()
}

// Leave the leader screen and begin the night phase (leader is picked BEFORE
// night so the timer can run straight through night → game with no pause).
function startNightFromLeader() {
  _leaderConfirm = false
  // Record the seating + chosen leader into the log now (re-confirmed at submit).
  if (preGame.seating.some(Boolean)) gameLogs.setSeating(preGame.seating.slice(0, gs.players))
  if (leaderHasChoice()) gameLogs.setFirstLeader(preGame.firstLeader)
  gs.phase = 'night'
  music.resetSession()
  music.fadeToFolder('Night phase')
  music.preload('Round 1', 'a')         // pre-buffer Round 1 for when night ends
  logEvent('Night phase')
  render()
}

function applyDefaultCharacters(players) {
  settings.characters.merlin   = true
  settings.characters.assassin = true
  settings.characters.percival = true
  settings.characters.morgana  = true
  settings.characters.oberon   = (players === 7 || players >= 10)
  settings.characters.mordred  = (players === 9 || players >= 10)
  settings.abilities.lotl      = (players >= 7)
  // excalibur is never suggested by default
}

// Can the character be enabled (considering evil slot capacity + cascade)?
function canEnableCharacter(key) {
  const c = settings.characters
  if (c[key]) return true  // already ON → can always be turned off
  const evilSlots = settings.players <= 6 ? 2 : settings.players <= 9 ? 3 : 4
  const curEvil   = ['assassin','morgana','mordred','oberon'].filter(k => c[k]).length
  // Count new evil slots needed by this key + cascade
  const needAssassin = c.assassin ? 0 : 1
  let need = 0
  if      (key === 'assassin')                     need = 1
  else if (key === 'morgana')                      need = 1 + needAssassin  // cascade to Assassin+Merlin
  else if (key === 'mordred')                      need = 1 + needAssassin  // cascade to Merlin+Assassin
  else if (key === 'oberon')                       need = 1
  else if (key === 'merlin' || key === 'percival') need = needAssassin  // good chars, only cascade to Assassin
  if (curEvil + need <= evilSlots) return true
  // Allow if Morgana+Assassin can merge to free one slot
  if ((key === 'morgana' || key === 'oberon' || key === 'mordred') && need === 1) {
    if (key === 'morgana') return c.assassin && curEvil === evilSlots
    return c.morgana && c.assassin && curEvil === evilSlots
  }
  return false
}

// True when Morgana+Assassin are combined into one slot to fit an extra evil.
function isMorganaAssnMerged() {
  const c = settings.characters
  if (!c.morgana || !c.assassin) return false
  const evilSlots = settings.players <= 6 ? 2 : settings.players <= 9 ? 3 : 4
  return ['assassin','morgana','mordred','oberon'].filter(k => c[k]).length > evilSlots
}

// Toggle a character with cascade rules:
//   Merlin ↔ Assassin (always together)
//   Percival requires Merlin; Morgana requires Percival
function toggleCharacter(key) {
  const c = settings.characters
  const turningOn = !c[key]

  if (!turningOn) {
    // Cascade OFF to dependents
    c[key] = false
    if (key === 'merlin' || key === 'assassin') {
      c.merlin = c.assassin = c.percival = c.morgana = c.mordred = false
    } else if (key === 'percival') {
      c.morgana = false
    }
    // morgana / oberon / mordred: no further cascade
  } else {
    if (!canEnableCharacter(key)) return  // no slots available or prerequisite missing
    c[key] = true
    // Cascade ON prerequisites
    if (key === 'merlin')   { c.assassin = true }
    if (key === 'assassin') { c.merlin   = true }
    if (key === 'percival') { c.merlin = c.assassin = true }
    if (key === 'morgana')  { c.percival = c.merlin = c.assassin = true }
    if (key === 'mordred') { c.merlin = c.assassin = true }  // Mordred cascades Merlin+Assassin on
  }
}

function buildTeamRoles(players, characters) {
  const evilCount = players <= 6 ? 2 : players <= 9 ? 3 : 4
  const goodCount = players - evilCount

  const evil = []
  if (characters.assassin) evil.push('Assassin')
  if (characters.morgana)  evil.push('Morgana')
  if (characters.mordred)  evil.push('Mordred')
  if (characters.oberon)   evil.push('Oberon')
  while (evil.length < evilCount) evil.push('Minion')

  const good = []
  if (characters.merlin)   good.push('Merlin')
  if (characters.percival) good.push('Percival')
  while (good.length < goodCount) good.push('Loyal Servant')

  return { good, evil }
}

// Fraction of the Q1-Q5 discussion budget that Assassination takes.
// Used by calcDiscussionBudget() and newGame() to split available time between quests and Assassination.
// assnFraction = ASSN_BASE_RATE × poolFactor × evilFactor
function calcAssnFraction() {
  const evilCount   = settings.players <= 6 ? 2 : settings.players <= 9 ? 3 : 4
  const goodCount   = settings.players - evilCount
  const pool        = goodCount + (settings.characters.oberon ? OBERON_POOL_WEIGHT : 0)
  const poolFactor  = Math.sqrt(pool / ASSN_POOL_REF)
  const evilPct     = evilCount / settings.players
  const evilFactor  = ASSN_EVIL_PCT_REF / evilPct
  return ASSN_BASE_RATE * poolFactor * evilFactor
}

// Returns the discussion-only budget in seconds for the current settings.
// Assassination's slice is split off via calcAssnFraction(); the rest is the Q1-Q5 pool.
function calcDiscussionBudget() {
  const speed     = effectiveSpeed(settings.targetTime)
  const cardTimes = QUEST_CARD_TIME[speed]
  const cardTotal = gs.questSizes.reduce((sum, size) => sum + (cardTimes[size] || 60), 0)
  const nightSecs = calcNightExpected()
  const available = Math.max(0, settings.targetTime * 60 - nightSecs - cardTotal)
  const budget    = available / (1 + calcAssnFraction())
  return Math.max(60, Math.round(budget))
}

function updateQuestAllotted() {
  const budget   = calcDiscussionBudget()
  const weights  = settings.abilities.lotl ? QUEST_ALLOTTED_LOTL : QUEST_ALLOTTED_BASE
  const allotted = weights.map(t => Math.round(t / QUEST_ALLOTTED_SUM * budget))
  gs.questAllotted = [...allotted]
}

function setMenuPlayers(n) {
  settings.players = n
  applyDefaultCharacters(n)
  if (settings.gameSpeed) {
    settings.targetTime = timeFromSpeed(n, settings.gameSpeed)
  } else {
    settings.gameSpeed = speedFromTime(n, settings.targetTime)
  }
  updateQuestAllotted()
  gs.players    = n
  gs.questSizes = [...QUEST_SIZES[n]]
  renderOverlay()
  renderCharPanel()
  renderSplitPanel()
}

function applyMenuChange(row, delta) {
  if (settings.menuPage === 'main') {
    // row 0=players, 1=gameSpeed, 2=targetTime, 3=characters(submenu), 4=lotl, 5=excalibur, 6=start
    if (row === 0) {
      const next = Math.min(10, Math.max(5, settings.players + delta))
      if (next !== settings.players) setMenuPlayers(next)
    } else if (row === 1) {
      // GAME SPEED: step through options, no wrap-around
      const cur     = settings.gameSpeed || effectiveSpeed(settings.targetTime)
      const idx     = SPEED_ORDER.indexOf(cur)
      const nextIdx = Math.max(0, Math.min(SPEED_ORDER.length - 1, idx + delta))
      if (nextIdx !== idx) {
        settings.gameSpeed  = SPEED_ORDER[nextIdx]
        settings.targetTime = timeFromSpeed(settings.players, settings.gameSpeed)
        updateQuestAllotted()
        renderOverlay()
        renderSplitPanel()
      }
    } else if (row === 2) {
      // GAME LENGTH: adjust in 5 min increments
      settings.targetTime = Math.min(150, Math.max(5, settings.targetTime + delta))
      settings.gameSpeed  = speedFromTime(settings.players, settings.targetTime)
      updateQuestAllotted()
      renderOverlay()
      renderSplitPanel()
    } else if (row === 3) {
      // CHARACTERS row — open submenu on right arrow
      if (delta > 0) {
        settings.menuPage = 'characters'
        settings.menuRow  = 0
        renderOverlay()
      }
    } else if (row === 4) {
      settings.abilities.lotl = !settings.abilities.lotl
      updateQuestAllotted()
      renderOverlay()
      renderCharPanel()
      renderSplitPanel()
    } else if (row === 5) {
      settings.abilities.excalibur = !settings.abilities.excalibur
      renderOverlay()
      renderCharPanel()
    } else if (row === 6) {
      // ADD PLAYERS — open on right arrow (also opens on Enter, see keydown)
      if (delta > 0) { setupReturnPhase = 'menu'; gs.phase = 'setup'; renderOverlay() }
    }
  } else if (settings.menuPage === 'characters') {
    // row 0=merlin, 1=percival, 2=assassin, 3=morgana, 4=mordred, 5=oberon, 6=back
    const keys = ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon', 'back']
    const key = keys[row]
    if (key === 'back') {
      settings.menuPage = 'main'
      settings.menuRow  = 3
      renderOverlay()
    } else if (key) {
      toggleCharacter(key)
      updateQuestAllotted()   // night phase changed → discussion budget changes
      renderOverlay()
      renderCharPanel()
      renderSplitPanel()
    }
  }
}

function startGameFromMenu() {
  // Pick the first leader BEFORE night, then night runs with the timer going.
  gameLogs.init(settings, preGame)
  gs.phase = 'leader'
  render()
}

// Click handler for a menu row (mirrors keyboard nav). Steppers advance forward
// with wrap so a click is never a no-op; toggles flip; action rows activate.
function handleMenuClick(key) {
  if (settings.menuPage === 'main') {
    const order = ['players', 'speed', 'time', 'chars', 'lotl', 'excalibur', 'setup', 'start']
    const idx = order.indexOf(key)
    if (idx < 0) return
    settings.menuRow = idx
    if (key === 'players') {
      setMenuPlayers(settings.players >= 10 ? 5 : settings.players + 1)
    } else if (key === 'speed') {
      const cur  = settings.gameSpeed || effectiveSpeed(settings.targetTime)
      const next = SPEED_ORDER[(SPEED_ORDER.indexOf(cur) + 1) % SPEED_ORDER.length]
      settings.gameSpeed  = next
      settings.targetTime = timeFromSpeed(settings.players, next)
      updateQuestAllotted(); renderOverlay(); renderSplitPanel()
    } else if (key === 'time') {
      settings.targetTime = settings.targetTime >= 150 ? 5 : Math.min(150, settings.targetTime + 5)
      settings.gameSpeed  = speedFromTime(settings.players, settings.targetTime)
      updateQuestAllotted(); renderOverlay(); renderSplitPanel()
    } else if (key === 'lotl' || key === 'excalibur') {
      applyMenuChange(idx, 1)   // toggle (delta ignored)
    } else if (key === 'chars') {
      settings.menuPage = 'characters'; settings.menuRow = 0; renderOverlay()
    } else if (key === 'setup') {
      setupReturnPhase = 'menu'; gs.phase = 'setup'; renderOverlay()
    } else if (key === 'start') {
      startGameFromMenu()
    }
  } else if (settings.menuPage === 'characters') {
    const order = ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon', 'back']
    const idx = order.indexOf(key)
    if (idx < 0) return
    settings.menuRow = idx
    if (key === 'back') {
      settings.menuPage = 'main'; settings.menuRow = 3; renderOverlay()
    } else {
      toggleCharacter(key)
      updateQuestAllotted()
      renderOverlay(); renderCharPanel(); renderSplitPanel()
    }
  }
}

// Apply initial defaults for the starting player count
applyDefaultCharacters(settings.players)

// ── Music ────────────────────────────────────────────────────────────────────

const music = new MusicPlayer()
music.onTrackChange = () => renderNowPlaying()

// ── Game state ───────────────────────────────────────────────────────────────

function newGame(players = settings.players) {
  const questSizes_ = [...QUEST_SIZES[players]]
  const speed_      = effectiveSpeed(settings.targetTime)
  const cardTimes_  = QUEST_CARD_TIME[speed_]
  const cardTotal_  = questSizes_.reduce((sum, size) => sum + (cardTimes_[size] || 60), 0)
  const nightSecs_  = calcNightExpected()   // hoisted — safe to call before definition
  const available_  = Math.max(0, settings.targetTime * 60 - nightSecs_ - cardTotal_)
  const budget_     = Math.max(60, Math.round(available_ / (1 + calcAssnFraction())))
  const assn_       = available_ - budget_
  const weights_    = settings.abilities.lotl ? QUEST_ALLOTTED_LOTL : QUEST_ALLOTTED_BASE
  const allotted    = weights_.map(t => Math.round(t / QUEST_ALLOTTED_SUM * budget_))
  return {
    phase:         'menu',
    players,
    questSizes:    questSizes_,
    results:          [null, null, null, null, null],
    questTimes:       [0, 0, 0, 0, 0],
    questVotingFrozen:[0, 0, 0, 0, 0],
    questEndTimes:    [0, 0, 0, 0, 0],
    eventLog:         [],
    questAllotted:    [...allotted],
    currentQuest:  0,
    voteCount:     0,
    voting:        true,
    successCount:  0,
    failCount:     0,
    merlin:        'hiding',
    quote:         QUOTES[Math.floor(Math.random() * QUOTES.length)],

    totalSecs:        0,
    nightSecs:        0,
    assnStart:        0,
    assnSecs:         0,
    assnEndTime:      0,
    assnRef:          assn_,
    questSecs:        0,
    questPhaseOffset: 0,
    panelOpen:        false,
    lotlPromptActive: false,
  }
}

let gs = newGame()
let sidebarAnimatePending  = false
// One-shot "pop" request for the split panel, consumed by the next renderSplitPanel().
//   { type: 'freeze' }               → pop the live active-quest row (voting timer froze)
//   { type: 'resolve', index: i }    → pop the just-resolved Q row (label flipped red/blue)
let sidebarPop             = null
let _prevPanelOpen         = false
let _charPanelFingerprint  = ''
let _lotlPromptTimer       = null
let _lotlFlipTimers        = []
let _lotlRepeatTimer       = null

// ── Second ticker ────────────────────────────────────────────────────────────

setInterval(() => {
  if (gs.phase !== 'game' && gs.phase !== 'assassination' && gs.phase !== 'night') return
  gs.totalSecs++
  if (gs.phase === 'game') {
    gs.questSecs++
    redrawActiveArc()
  }
  updateTimerBar()
  updateTotalTime()
}, 1000)

// ── Arc timer canvas ─────────────────────────────────────────────────────────

const ARC_SIZE    = 234
const ARC_CX      = ARC_SIZE / 2
const ARC_CY      = ARC_SIZE / 2
const ARC_R       = 105
const ARC_HOLE    = 77
const OUTER_R_IN  = 111
const OUTER_R_OUT = 116
const OUTER_MID   = (OUTER_R_IN + OUTER_R_OUT) / 2
const OUTER_W     = OUTER_R_OUT - OUTER_R_IN
const PI          = Math.PI
const TAU         = 2 * PI

function questCardRef(teamSize) {
  return QUEST_CARD_TIME[effectiveSpeed(settings.targetTime)][teamSize] || 60
}

// state: 'pending' | 'voting' | 'card' | 'resolved-success' | 'resolved-fail'
// opts: { votingElapsed, votingRef, cardElapsed, cardRef }
// layer: 'all' | 'outer' | 'inner' — the coin flip splits the circle across two
//   canvases: a static base ('outer' ring/timer) and a flipping face ('inner'
//   disc: voting pie, hole, spokes). 'all' renders both onto one canvas.
function drawArc(canvas, state, playerCount, opts = {}, layer = 'all') {
  const {
    votingElapsed = 0,
    votingRef     = 300,
    cardElapsed   = 0,
    cardRef       = 54,
  } = opts

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, ARC_SIZE, ARC_SIZE)
  ctx.lineCap = 'butt'

  const isResolved = state === 'resolved-success' || state === 'resolved-fail'
  const showCard   = state === 'card' || isResolved
  const isPending  = state === 'pending'
  const drawOuter  = layer === 'all' || layer === 'outer'
  const drawInner  = layer === 'all' || layer === 'inner'

  // Everything except the donut-hole fill lives on the outer/base layer. Only the
  // innermost circle (the hole) sits on the flipping inner face, so the voting
  // ring, spokes and outer ring all stay static while the hole flips.
  if (drawOuter) {
    // Background disc (covers inner + gap + outer ring area)
    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, OUTER_R_OUT, 0, TAU)
    ctx.fillStyle = THEME.bg
    ctx.fill()

    // Inner ring: voting time arc (accent → warn overtime)
    if (!isPending && votingElapsed > 0) {
      const frac = Math.min(votingElapsed / votingRef, 1)
      ctx.beginPath()
      ctx.moveTo(ARC_CX, ARC_CY)
      ctx.arc(ARC_CX, ARC_CY, ARC_R, -PI / 2, -PI / 2 + frac * TAU)
      ctx.closePath()
      ctx.fillStyle = THEME.accent
      ctx.fill()

      if (votingElapsed > votingRef) {
        const otFrac = Math.min((votingElapsed - votingRef) / votingRef, 1)
        ctx.beginPath()
        ctx.moveTo(ARC_CX, ARC_CY)
        ctx.arc(ARC_CX, ARC_CY, ARC_R, -PI / 2, -PI / 2 + otFrac * TAU)
        ctx.closePath()
        ctx.fillStyle = THEME.warn
        ctx.fill()
      }
    }

    // Punch a dark socket so the base reads as a donut on its own AND gives the
    // flip contrast — the coin-colored face sits on top of this darker background,
    // so mid-flip the dark socket shows through and the turn reads with depth.
    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, ARC_HOLE, 0, TAU)
    ctx.fillStyle = THEME.bg
    ctx.fill()

    // The donut-timer edges (inner ring at 105, hole ring at 77, spokes) are drawn
    // as a static SVG overlay (.q-donut) so their colour can CSS-transition
    // together — canvas pixels can't be transitioned.
  }

  if (drawInner) {
    // Innermost circle: the donut-hole face that flips. Opaque so it reads as a
    // coin side; outcome color appears here for resolved quests.
    const holeFill = state === 'resolved-success' ? THEME.goodFill
                   : state === 'resolved-fail'    ? THEME.evilFill
                   : THEME.coin
    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, ARC_HOLE, 0, TAU)
    ctx.fillStyle = holeFill
    ctx.fill()
  }

  if (drawOuter) {
    // Outer ring: dark track (always visible as a slot)
    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, OUTER_MID, 0, TAU)
    ctx.strokeStyle = THEME.stone; ctx.lineWidth = OUTER_W; ctx.stroke()

    // Outer ring: card time arc fill (accent → warn overtime)
    if (showCard && cardElapsed > 0) {
      const frac = Math.min(cardElapsed / cardRef, 1)
      ctx.beginPath()
      ctx.arc(ARC_CX, ARC_CY, OUTER_MID, -PI / 2, -PI / 2 + frac * TAU)
      ctx.strokeStyle = THEME.accent; ctx.lineWidth = OUTER_W; ctx.stroke()

      if (cardElapsed > cardRef) {
        const otFrac = Math.min((cardElapsed - cardRef) / cardRef, 1)
        ctx.beginPath()
        ctx.arc(ARC_CX, ARC_CY, OUTER_MID, -PI / 2, -PI / 2 + otFrac * TAU)
        ctx.strokeStyle = THEME.warn; ctx.lineWidth = OUTER_W; ctx.stroke()
      }
    }

    // Outer ring border lines
    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, OUTER_R_OUT, 0, TAU)
    ctx.strokeStyle = THEME.stone; ctx.lineWidth = 1; ctx.stroke()

    ctx.beginPath()
    ctx.arc(ARC_CX, ARC_CY, OUTER_R_IN, 0, TAU)
    ctx.strokeStyle = THEME.stone; ctx.lineWidth = 1; ctx.stroke()
  }
}

// Paint a quest's two-canvas circle: the static outer ring (base) and the
// flipping inner disc (face).
function paintArc(i, state, size, opts = {}) {
  const base  = document.getElementById(`arc-${i}`)
  const inner = document.getElementById(`arcin-${i}`)
  if (base)  drawArc(base,  state, size, opts, 'outer')
  if (inner) drawArc(inner, state, size, opts, 'inner')
}

// Toggle a state class (overtime/warning/locking/…) on both of a quest's canvases
// so the whole coin reacts as one.
function toggleArcClass(i, cls, on) {
  document.getElementById(`arc-${i}`)?.classList.toggle(cls, on)
  document.getElementById(`arcin-${i}`)?.classList.toggle(cls, on)
}

// Per-second timer tick. Only the base canvas carries the ticking arcs (voting
// pie / card ring); the inner hole face and the number are static between events
// (drawn by renderQuests on A: pending→active, B: vote→card, C: resolve), so the
// tick never touches them — which also avoids invalidating the flip layer's
// texture mid-rotation.
function redrawActiveArc() {
  if (gs.successCount >= 3 || gs.failCount >= 3) return
  const i    = gs.currentQuest
  const base = document.getElementById(`arc-${i}`)
  if (!base) return
  const size    = gs.questSizes[i]
  const cardRef = questCardRef(size)

  if (gs.voting) {
    const elapsed = phaseElapsed()
    const ref     = phaseRef()
    drawArc(base, 'voting', size, { votingElapsed: elapsed, votingRef: ref }, 'outer')
    const isOT   = elapsed > ref
    const isWarn = !isOT && elapsed / ref >= 0.9
    toggleArcClass(i, 'overtime', isOT)
    toggleArcClass(i, 'warning',  isWarn)
  } else {
    const cardElapsed = phaseElapsed()
    drawArc(base, 'card', size, {
      votingElapsed: gs.questVotingFrozen[i],
      votingRef:     gs.questAllotted[i],
      cardElapsed,
      cardRef,
    }, 'outer')
    const isOT   = cardElapsed > cardRef
    const isWarn = !isOT && cardElapsed / cardRef >= 0.9
    toggleArcClass(i, 'overtime', isOT)
    toggleArcClass(i, 'warning',  isWarn)
  }
}

function updateArcNum(i, playerCount, state) {
  const el = document.getElementById(`arcnum-${i}`)
  if (!el) return
  el.textContent = String(playerCount)
  const color = state === 'resolved-success' ? THEME.goodText
              : state === 'resolved-fail'    ? THEME.evilCircText
              : state === 'pending'          ? THEME.dim
              : THEME.cream
  el.style.color = color
  // Lady-of-the-Lake teardrop tracks the number's colour exactly (fill: currentColor)
  const drop = document.getElementById(`lotl-badge-${i}`)
  if (drop) drop.style.color = color
}

// ── DOM construction (run once) ──────────────────────────────────────────────

function buildStaticDOM() {
  // Timer bar dividers at 20% / 40% / 60% / 80%
  const bar = document.getElementById('timer-bar')
  for (let i = 1; i <= 4; i++) {
    const d = document.createElement('div')
    d.className = 't-div'
    d.style.left = `${i * 20}%`
    bar.append(d)
  }

  // Quest circles. The circle is split across two stacked layers so only the
  // inner disc flips on a Lady-of-the-Lake check:
  //   • base canvas (arc-i)  — static outer ring + timer track + background disc
  //   • flipper front canvas (arcin-i) + number — the inner disc that flips
  //   • flipper back — the LotL symbol (Q3/Q4/Q5 only)
  const questRow = document.getElementById('quests')
  for (let i = 0; i < 5; i++) {
    const wrap = document.createElement('div')
    wrap.className = 'q-wrap'
    wrap.id = `qw-${i}`

    // Static base: outer ring + background disc (never flips). In-flow child, so
    // it also sizes the wrap.
    const base = document.createElement('canvas')
    base.className = 'arc arc-base'
    base.id = `arc-${i}`
    base.width  = ARC_SIZE
    base.height = ARC_SIZE
    wrap.append(base)

    // Flipper overlays the base exactly.
    const flipper = document.createElement('div')
    flipper.className = 'q-flipper'
    flipper.id = `qflip-${i}`

    const front = document.createElement('div')
    front.className = 'q-face q-front'

    const inner = document.createElement('canvas')
    inner.className = 'arc arc-inner'
    inner.id = `arcin-${i}`
    inner.width  = ARC_SIZE
    inner.height = ARC_SIZE

    const numEl = document.createElement('div')
    numEl.className = 'arc-num'
    numEl.id = `arcnum-${i}`

    front.append(inner, numEl)

    // Lady-of-the-Lake teardrop — flat icon inside the hole, left of the number,
    // on quests 3/4/5. Lives on the front face so it flips with the number.
    if (i >= 2) {
      const badge = document.createElement('div')
      badge.className = 'lotl-badge'
      badge.id = `lotl-badge-${i}`
      badge.innerHTML =
        '<svg class="lotl-drop-svg" viewBox="0 0 24 32">' +
        '<path d="M12 1 C12 1 4 12 4 20 A8 8 0 1 0 20 20 C20 12 12 1 12 1 Z"/></svg>'
      front.append(badge)
    }

    flipper.append(front)

    if (i >= 2) {
      const back = document.createElement('div')
      back.className = 'q-face q-back'

      // Background disc (not <img>) so we can zoom the blue past the black margin
      // in the source PNG, and so a blink sprite can later step the position.
      const face = document.createElement('div')
      face.className = 'lotl-face'
      face.id = `lotl-face-${i}`

      const shimmer = document.createElement('div')
      shimmer.className = 'lotl-shimmer'
      shimmer.id = `lotl-shimmer-${i}`

      back.append(face, shimmer)
      flipper.append(back)
    }

    wrap.append(flipper)

    // Donut-timer edges (hole ring at 77, inner ring at 105, 5 spokes) as a static
    // SVG overlay above the flipper, so all three share one stroke colour that can
    // CSS-transition on activation. Geometry mirrors the old canvas strokes.
    const SVGNS = 'http://www.w3.org/2000/svg'
    const donut = document.createElementNS(SVGNS, 'svg')
    donut.setAttribute('class', 'q-donut')
    donut.setAttribute('viewBox', `0 0 ${ARC_SIZE} ${ARC_SIZE}`)
    for (const r of [ARC_HOLE, ARC_R]) {
      const c = document.createElementNS(SVGNS, 'circle')
      c.setAttribute('cx', ARC_CX)
      c.setAttribute('cy', ARC_CY)
      c.setAttribute('r', r)
      donut.append(c)
    }
    for (let s = 0; s < 5; s++) {
      const a = -PI / 2 + s * TAU / 5
      const ln = document.createElementNS(SVGNS, 'line')
      ln.setAttribute('x1', ARC_CX + (ARC_HOLE + 3) * Math.cos(a))
      ln.setAttribute('y1', ARC_CY + (ARC_HOLE + 3) * Math.sin(a))
      ln.setAttribute('x2', ARC_CX + (ARC_R    - 3) * Math.cos(a))
      ln.setAttribute('y2', ARC_CY + (ARC_R    - 3) * Math.sin(a))
      donut.append(ln)
    }
    wrap.append(donut)

    // Quest 4 needs two fails at 7+ players — static arced label above the circle.
    if (i === 3) {
      const twoFail = document.createElement('div')
      twoFail.className = 'q4-twofail'
      twoFail.id = 'q4-twofail'
      twoFail.innerHTML =
        '<svg viewBox="0 0 240 100" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><path id="q4-arc-path" d="M 22,94 Q 120,14 218,94"/></defs>' +
        '<text><textPath href="#q4-arc-path" startOffset="50%" text-anchor="middle">' +
        'Two fails required</textPath></text></svg>'
      wrap.append(twoFail)
    }

    const slot = document.createElement('div')
    slot.className = 'q-arc-slot'
    slot.dataset.qi = i
    slot.append(wrap)
    questRow.append(slot)
  }

  // Vote dots
  const voteRow = document.getElementById('votes')
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('div')
    dot.className = 'v-dot'
    dot.id = `vd-${i}`
    voteRow.append(dot)
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

// ── Log screen ───────────────────────────────────────────────────────────────

// Custom autocomplete for log-screen text inputs — replaces native datalist.
// getOptions() is called live each time the dropdown opens so it always reflects
// the latest typed values in other inputs. onSelect(opt) (optional) fires when an
// option is committed via click or Enter. Returns a handle for programmatic control.
function attachLogAutocomplete(input, getOptions, onSelect, onEnterAdvance, dropdownClass) {
  let dropdown       = null
  let focusedIdx     = -1
  let _skipNextFocus = false

  const wrap = input.closest('.log-input-wrap')
  const btn  = wrap?.querySelector('.log-ac-btn')

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null }
    focusedIdx = -1
    btn?.classList.remove('open')
  }

  function commit(opt) {
    input.value = opt
    removeDropdown()
    input.dispatchEvent(new Event('input'))
    if (onSelect) onSelect(opt)
  }

  function showDropdown(opts) {
    removeDropdown()
    if (!opts.length) return
    const rect = input.getBoundingClientRect()
    dropdown = document.createElement('div')
    dropdown.className = 'log-autocomplete' + (dropdownClass ? ' ' + dropdownClass : '')
    dropdown.style.top   = rect.bottom + 'px'
    dropdown.style.left  = rect.left   + 'px'
    dropdown.style.width = rect.width  + 'px'
    opts.forEach(opt => {
      const item = document.createElement('div')
      item.className = 'log-ac-item'
      item.textContent = opt
      item.addEventListener('mousedown', e => { e.preventDefault(); commit(opt) })
      dropdown.append(item)
    })
    document.body.append(dropdown)
    btn?.classList.add('open')
  }

  function refresh() {
    const val   = input.value.trim()
    const lower = val.toLowerCase()
    const opts  = getOptions().filter(o =>
      !val || (o.toLowerCase().includes(lower) && o.toLowerCase() !== lower)
    )
    if (!opts.length || !val) { removeDropdown(); return }
    showDropdown(opts)
  }

  // Open the full option list programmatically (also used by the ▾ button).
  function openAll() {
    const opts = getOptions()
    if (!opts.length) return
    _skipNextFocus = true               // suppress the focus-triggered refresh
    showDropdown(opts)
    input.focus()
  }

  // ▾ button: toggle all-options dropdown
  if (btn) {
    btn.addEventListener('mousedown', e => {
      e.preventDefault()               // keep input focused
      if (dropdown) removeDropdown()
      else openAll()
    })
  }

  input.addEventListener('input', refresh)
  input.addEventListener('focus', () => {
    if (_skipNextFocus) { _skipNextFocus = false; return }
    refresh()
  })
  // Clicking anywhere in the field opens the full option list (typing still filters).
  input.addEventListener('click', () => {
    if (dropdown) return                 // already open — let the click place the cursor
    const opts = getOptions()
    if (opts.length) showDropdown(opts)
  })
  input.addEventListener('blur', () => setTimeout(removeDropdown, 120))

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (dropdown) {
        // Menu open: choose the highlighted option, else just close it. Consume.
        e.preventDefault(); e.stopPropagation()
        if (focusedIdx >= 0) {
          const items = [...dropdown.querySelectorAll('.log-ac-item')]
          commit(items[focusedIdx].textContent)
        } else {
          removeDropdown()
        }
        return
      }
      // Menu closed: advance to the next field / submit (like Tab), if wired.
      if (onEnterAdvance) { e.preventDefault(); e.stopPropagation(); onEnterAdvance() }
      return
    }
    if (!dropdown) return
    const items = [...dropdown.querySelectorAll('.log-ac-item')]
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      focusedIdx = Math.min(focusedIdx + 1, items.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      focusedIdx = Math.max(focusedIdx - 1, -1)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      removeDropdown()
    }
    items.forEach((el, i) => el.classList.toggle('focused', i === focusedIdx))
    if (focusedIdx >= 0) items[focusedIdx].scrollIntoView({ block: 'nearest' })
  })

  return { openAll, close: removeDropdown }
}

// Move focus to the next text field after `input` (DOM order within the overlay).
// Returns false if `input` was the last one — the caller then submits.
function focusNextLogField(input) {
  const fields = [...document.querySelectorAll(
    '#overlay-body .log-player-input, #overlay-body .log-textarea')]
  const i = fields.indexOf(input)
  if (i >= 0 && i + 1 < fields.length) { fields[i + 1].focus(); return true }
  return false
}

// Shared markup for a column of seat-name inputs (used by setup + log screens).
function seatingRowsHTML(count) {
  let rows = ''
  for (let i = 0; i < count; i++) {
    const val = (preGame.seating[i] || '').replace(/"/g, '&quot;')
    rows += `
      <div class="log-roster-row">
        <span class="log-seat-num">${i + 1}.</span>
        <div class="log-input-wrap">
          <input type="text" class="log-player-input" data-seat-idx="${i}"
                 value="${val}" placeholder="—" autocomplete="off" spellcheck="false">
          <button class="log-ac-btn" tabindex="-1">▾</button>
        </div>
      </div>`
  }
  return rows
}

function buildSetupHTML() {
  return `
    <div class="log-header grad-title">Add names</div>
    <div class="log-rule"></div>
    <div id="setup-dup-warning" class="name-warning">duplicate name</div>
    <div class="log-roster">${seatingRowsHTML(gs.players)}</div>
    <button id="setup-done" class="log-submit-btn" style="margin-top:22px">Done</button>
    <div class="log-bottom-pad"></div>`
}

function buildLeaderHTML() {
  const fl    = preGame.firstLeader
  const flStr = fl == null ? '' : (typeof fl === 'number' ? String(fl) : fl)
  return `
    <div class="ov-title grad-title leader-title">First leader</div>
    <div class="ov-rule"></div>
    <div class="leader-pick">
      <div class="log-input-wrap leader-input-wrap">
        <input type="text" id="leader-input" class="log-player-input leader-value" value="${_esc(flStr)}"
               placeholder="—" autocomplete="off" spellcheck="false">
        <button class="log-ac-btn leader-ac-btn" tabindex="-1">▾</button>
      </div>
      <div id="leader-warning" class="leader-warning">no leader chosen</div>
    </div>
    <div class="leader-btns">
      <button id="leader-randomize" class="log-submit-btn">[SPACE]  Randomize leader</button>
      <button id="leader-addplayers" class="log-submit-btn">[P]  Add names</button>
      <button id="leader-continue" class="log-submit-btn">[ENTER]  Continue</button>
    </div>`
}

// Distinct character options for the log dropdown, from the game's settings —
// each specific role once, generics (Loyal Servant / Minion) shown a single time.
function logCharOptions() {
  const roles = buildTeamRoles(gs.players, settings.characters)
  const seen = new Set(); const opts = []
  ;[...roles.good, ...roles.evil].forEach(r => { if (!seen.has(r)) { seen.add(r); opts.push(r) } })
  return opts
}

// Which team a chosen character belongs to, per settings. null = freely-typed
// character not in this game's line-up (an intentional mismatch).
function logTeamForRole(role) {
  if (!role) return null
  const roles = buildTeamRoles(gs.players, settings.characters)
  if (roles.good.some(r => r.toLowerCase() === role.toLowerCase())) return 'good'
  if (roles.evil.some(r => r.toLowerCase() === role.toLowerCase())) return 'evil'
  return null
}

// True when the characters entered in the roster don't match the settings line-up
// (as a multiset). An all-blank character column is treated as "not logged" — no warning.
function logCharMismatch() {
  const roles    = buildTeamRoles(gs.players, settings.characters)
  const expected = [...roles.good, ...roles.evil].map(s => s.toLowerCase()).sort()
  const chosen   = []
  document.querySelectorAll('[data-char-idx]').forEach(el => {
    const v = el.value.trim(); if (v) chosen.push(v.toLowerCase())
  })
  if (!chosen.length) return false
  chosen.sort()
  return chosen.length !== expected.length || chosen.some((c, i) => c !== expected[i])
}

function buildLogHTML() {
  // One row per player (seat order): number · name · character. Values prefill
  // from a saved draft (ESC-restore) if present, else from pre-game seating.
  let rosterRows = ''
  for (let i = 0; i < gs.players; i++) {
    const nm = _esc(logDraft ? logDraft.seats[i] : preGame.seating[i])
    const ch = _esc(logDraft ? logDraft.chars[i] : '')
    rosterRows += `
      <div class="log-roster-row">
        <span class="log-seat-num">${i + 1}.</span>
        <div class="log-input-wrap">
          <input type="text" class="log-player-input" data-seat-idx="${i}"
                 value="${nm}" placeholder="name" autocomplete="off" spellcheck="false">
          <button class="log-ac-btn" tabindex="-1">▾</button>
        </div>
        <div class="log-input-wrap">
          <input type="text" class="log-player-input" data-char-idx="${i}"
                 value="${ch}" placeholder="character" autocomplete="off" spellcheck="false">
          <button class="log-ac-btn" tabindex="-1">▾</button>
        </div>
      </div>`
  }
  const characterSection = `
    <div class="log-section-hd">Players &amp; characters</div>
    <div id="log-dup-warning" class="name-warning">duplicate name</div>
    <div id="log-char-warning" class="log-warning">characters do not match settings</div>
    <div class="log-roster log-roster-chars">${rosterRows}</div>`

  const balVal     = (logDraft && logDraft.balance != null) ? logDraft.balance : 0
  const balTouched = (logDraft && logDraft.balance != null) ? ' touched' : ''
  const balanceHTML = `
    <div class="log-field">
      <div class="log-field-label">Game balance</div>
      <div class="log-scale-row">
        <span class="log-scale-cap">Evil</span>
        <input type="range" id="log-balance" class="log-range${balTouched}" min="-3" max="3" step="1" value="${balVal}">
        <span class="log-scale-cap">Good</span>
      </div>
      <div class="log-scale-desc" id="log-balance-desc">—</div>
    </div>`

  const confValRaw = (logDraft && logDraft.conf != null) ? logDraft.conf : 3
  const confTouched = (logDraft && logDraft.conf != null) ? ' touched' : ''
  const confHTML = gs.assnStart > 0 ? `
    <div class="log-field">
      <div class="log-field-label">Assassin confidence</div>
      <div class="log-scale-row">
        <span class="log-scale-cap">Guess</span>
        <input type="range" id="log-conf" class="log-range${confTouched}" min="1" max="5" step="1" value="${confValRaw}">
        <span class="log-scale-cap">Certain</span>
      </div>
      <div class="log-scale-desc" id="log-conf-desc">—</div>
    </div>` : ''

  const targetHTML = gs.merlin === 'survived' ? `
    <div class="log-field">
      <div class="log-field-label">Assassination target</div>
      <div class="log-input-wrap">
        <input type="text" id="log-assn-target" class="log-player-input" value="${_esc(logDraft ? logDraft.target : '')}"
               placeholder="—" autocomplete="off" spellcheck="false">
        <button class="log-ac-btn" tabindex="-1">▾</button>
      </div>
    </div>` : ''

  const flPre = preGame.firstLeader == null ? ''
    : (typeof preGame.firstLeader === 'number' ? String(preGame.firstLeader) : preGame.firstLeader)
  const flVal = logDraft ? _esc(logDraft.firstLeader) : _esc(flPre)
  const firstLeaderHTML = `
    <div class="log-field">
      <div class="log-field-label">First leader</div>
      <div class="log-input-wrap">
        <input type="text" id="log-first-leader" class="log-player-input"
               value="${flVal}" placeholder="—" autocomplete="off" spellcheck="false">
        <button class="log-ac-btn" tabindex="-1">▾</button>
      </div>
    </div>`

  const notesHTML = `
    <div class="log-field">
      <div class="log-field-label">Notes</div>
      <textarea id="log-notes" class="log-textarea" placeholder="(optional)" rows="2">${_esc(logDraft ? logDraft.notes : '')}</textarea>
    </div>`

  return `
    <div class="log-header grad-title">Log this game</div>
    <div class="log-rule"></div>
    ${characterSection}
    <div class="log-sep"></div>
    ${balanceHTML}
    ${confHTML}
    ${targetHTML}
    <div class="log-sep"></div>
    ${firstLeaderHTML}
    <div class="log-sep"></div>
    ${notesHTML}
    <button id="log-submit" class="log-submit-btn">Submit &amp; return to main menu</button>
    <div class="log-bottom-pad"></div>`
}

// Capture the current log-form inputs into logDraft so an ESC-and-reopen restores
// them. No-op unless the log screen is mounted.
function captureLogDraft() {
  if (gs.phase !== 'log') return
  const seats = [], chars = []
  document.querySelectorAll('[data-seat-idx]').forEach(el => { seats[+el.dataset.seatIdx] = el.value })
  document.querySelectorAll('[data-char-idx]').forEach(el => { chars[+el.dataset.charIdx] = el.value })
  const balEl = document.getElementById('log-balance')
  const conEl = document.getElementById('log-conf')
  logDraft = {
    seats, chars,
    firstLeader: document.getElementById('log-first-leader')?.value || '',
    target:      document.getElementById('log-assn-target')?.value || '',
    notes:       document.getElementById('log-notes')?.value || '',
    balance:     (balEl && balEl.classList.contains('touched')) ? balEl.value : null,
    conf:        (conEl && conEl.classList.contains('touched')) ? conEl.value : null,
  }
}

// Reads the seat-order roster: one entry per row that has a name and/or a
// character. team is derived from the chosen character (null if freely typed).
function buildRosterFromDOM() {
  const roster = []
  document.querySelectorAll('[data-char-idx]').forEach(charEl => {
    const i    = charEl.dataset.charIdx
    const role = charEl.value.trim()
    const name = document.querySelector(`[data-seat-idx="${i}"]`)?.value?.trim() || ''
    if (!name && !role) return
    if (name) players.findOrCreate(name)
    roster.push({ seat: Number(i) + 1, name, role, team: logTeamForRole(role) })
  })
  return roster
}

function render() {
  renderOverlay()
  renderPhaseStatus()
  renderScrollQuote()
  renderQuests()
  renderLotlIndicators()
  renderLotlBanner()
  renderVoteTrack()
  renderCharPanel()
  renderSplitPanel()
  renderNowPlaying()
  renderHint()
  renderModal()
  renderAssassinationArea()
  updateTimerBar()
  updateTotalTime()
}

function logEvent(msg) {
  gs.eventLog.unshift(msg)
  if (gs.eventLog.length > 6) gs.eventLog.pop()
  // Note: callers that are followed by render() should NOT call renderSplitPanel here,
  // as that would consume sidebarAnimatePending before render() can use it for animations.
  // The vote-pass handler calls renderSplitPanel() explicitly after logEvent instead.
}

function calcNightExpected() {
  const c = settings.characters
  const evilCount = settings.players <= 6 ? 2 : settings.players <= 9 ? 3 : 4
  return 20
    + (evilCount - 2) * 5
    + (c.morgana  ? 10 : 0)
    + (c.oberon   ?  5 : 0)
    + (c.mordred  ?  5 : 0)
    + (c.merlin   ? 20 : 0)
    + (c.percival ? 15 : 0)
}

function calcAssnBudget() {
  return settings.targetTime * 60  // game length in seconds = assassination target end timestamp
}

// Q5's end timestamp is pinned: total target minus assassination buffer.
// Assassination buffer = available/6 (the 1/6 not given to quest discussions).
// This value is fixed for the duration of the game.
function calcQ5TargetEnd() {
  const speed     = effectiveSpeed(settings.targetTime)
  const cardTimes = QUEST_CARD_TIME[speed]
  const cardTotal = gs.questSizes.reduce((sum, size) => sum + (cardTimes[size] || 60), 0)
  return calcNightExpected() + cardTotal + calcDiscussionBudget()
}

// Crossed-daggers crest for the Assassination row — inline SVG traced from
// images/daggers.png (all three daggers), so it needs no image asset and
// fill:currentColor recolors it to match the label, mirroring makeMoon().
function makeDagger() {
  const el = document.createElement('span')
  el.className = 'sp-dagger'
  el.innerHTML =
    `<svg viewBox="0 0 577 648" width="23" height="26" aria-hidden="true"><g transform="translate(0.463786,648.417659) scale(0.100000,-0.100000)"><path d="M2805 6467 c-195 -77 -247 -284 -105 -422 46 -44 47 -51 20 -85 -27
-35 -25 -61 10 -93 30 -29 39 -60 20 -72 -5 -3 -10 -21 -10 -38 0 -27 -5 -35
-31 -44 -29 -11 -31 -15 -25 -47 7 -34 7 -34 -81 -40 -111 -8 -355 -36 -366
-43 -4 -2 -21 7 -38 21 -136 115 -323 -15 -255 -177 44 -108 210 -118 269 -17
20 33 48 44 142 59 313 47 372 50 384 20 11 -31 1 -34 -117 -42 -62 -5 -105
-13 -132 -27 -41 -21 -75 -60 -62 -71 11 -9 120 -29 162 -29 56 0 90 -38 91
-104 1 -28 3 -67 5 -86 3 -43 22 -634 34 -1100 14 -525 21 -670 34 -670 6 0
74 67 152 148 l141 148 6 200 c4 109 11 379 17 599 23 881 19 802 47 836 19
22 33 29 62 29 44 0 152 20 164 30 12 11 -32 59 -68 74 -18 8 -64 17 -102 21
-158 15 -145 11 -136 43 6 26 56 25 258 -4 231 -33 234 -33 259 -75 59 -99
213 -92 267 12 75 149 -108 297 -238 193 -38 -31 -38 -31 -158 -13 -66 10
-143 18 -171 19 -139 1 -175 10 -169 44 5 27 2 33 -23 49 -22 12 -29 22 -25
37 4 13 -3 30 -17 45 -22 23 -22 23 20 69 42 46 42 46 15 92 -27 46 -27 46 13
88 186 193 -17 519 -263 423z m178 -1004 c-13 -2 -33 -2 -45 0 -13 2 -3 4 22
4 25 0 35 -2 23 -4z m-186 -366 c10 -13 18 -38 17 -58 -5 -174 -5 -175 -15
-149 -9 21 -39 194 -39 222 0 15 19 8 37 -15z M288 6236 c-194 -53 -276 -325
-133 -443 37 -31 37 -31 -5 -103 -250 -427 -195 -864 149 -1193 167 -159 373
-267 681 -356 156 -45 175 -52 222 -82 27 -17 57 -43 68 -57 24 -30 23 -30 39
30 19 67 71 116 95 89 10 -11 31 -23 47 -26 33 -7 38 -25 11 -41 -21 -14 -55
-80 -78 -153 -78 -246 -362 -373 -579 -259 -85 44 -164 143 -165 206 0 28 -19
28 -54 1 -21 -16 -26 -17 -26 -5 0 25 54 56 98 56 45 0 72 -25 72 -67 0 -44
51 -18 71 36 26 66 -66 171 -148 171 -237 0 -342 -329 -161 -510 151 -152 441
-172 705 -50 114 53 158 86 281 209 113 114 132 127 163 111 20 -11 27 -64 9
-75 -15 -10 -2 -25 22 -25 46 0 100 -26 145 -69 43 -42 289 -317 338 -378 57
-72 242 -277 252 -280 11 -4 25 9 122 121 58 67 60 57 -32 159 -37 41 -77 86
-88 98 -11 13 -44 49 -72 79 -29 30 -84 91 -123 135 -39 44 -97 107 -128 140
-31 33 -56 64 -56 68 0 12 108 -82 160 -140 24 -26 71 -77 104 -113 34 -36 99
-108 146 -160 176 -197 162 -185 183 -159 17 21 17 23 -1 43 -58 67 -189 213
-202 226 -130 127 -288 324 -333 416 -72 144 -99 292 -34 186 17 -28 124 -149
251 -282 39 -41 129 -137 200 -212 150 -161 156 -164 156 -69 0 69 0 69 -132
197 -443 432 -469 469 -407 554 18 23 21 37 16 74 -7 46 -7 46 33 46 125 0
227 -105 160 -165 -27 -24 -26 -30 14 -53 40 -24 66 -60 75 -105 17 -82 80 38
81 154 1 340 -472 452 -618 146 -55 -115 -72 -155 -72 -165 0 -21 -14 -13 -67
38 -65 62 -65 65 0 94 29 14 85 56 127 95 116 110 187 141 325 141 107 0 245
-40 245 -71 0 -5 9 -9 20 -9 11 0 20 3 20 6 0 32 -86 263 -106 283 -2 2 -23
-16 -46 -40 -33 -34 -59 -50 -112 -67 -83 -26 -81 -27 -60 38 19 58 15 199 -8
258 -15 38 -22 40 -43 9 -19 -30 -85 -67 -119 -67 -32 0 -33 -11 -5 -36 70
-63 20 -177 -147 -333 -123 -115 -128 -117 -158 -84 -39 41 -35 46 77 93 144
60 146 63 92 98 -48 31 -48 31 -205 -47 -77 -38 -140 -66 -140 -61 0 19 153
110 185 110 8 0 15 9 15 20 0 11 -4 20 -8 20 -5 0 -8 10 -8 22 2 41 -97 80
-213 84 -53 1 -96 6 -96 11 0 19 81 35 153 28 88 -7 88 -4 9 72 -76 73 -113
87 -226 82 -87 -4 -100 5 -35 28 26 10 59 13 102 8 74 -7 73 -7 20 44 -68 65
-118 84 -223 87 -49 1 -92 3 -95 4 -3 0 6 7 20 15 29 16 127 20 164 5 44 -17
43 11 -3 50 -55 48 -112 63 -186 49 -31 -6 -59 -8 -62 -6 -11 11 64 37 109 37
54 0 58 7 24 39 -40 37 -118 61 -203 61 -60 0 -74 3 -65 12 7 7 45 12 97 12
97 1 99 3 48 44 -56 43 -93 60 -177 78 -76 17 -92 34 -33 34 18 0 49 -5 70
-11 53 -14 59 -3 17 33 -63 53 -150 81 -204 67 -36 -10 -43 -5 -26 16 7 9 29
15 51 15 45 0 49 13 19 62 -32 53 -28 127 10 163 34 33 37 53 13 81 -10 10
-29 36 -43 56 -36 55 -120 44 -267 -33 -29 -15 -53 -25 -53 -22 0 12 57 54
103 75 52 24 53 29 15 84 -46 67 -138 96 -230 70z m130 -76 c37 -23 41 -43 10
-64 -20 -14 -24 -14 -52 9 -17 14 -41 30 -53 35 -23 10 -29 21 -16 33 13 14
79 6 111 -13z m247 -150 c18 -19 17 -20 -39 -45 -71 -31 -90 -32 -52 -2 16 13
26 29 22 35 -6 11 19 31 40 32 6 0 19 -9 29 -20z m-309 -423 c5 -14 11 -56 13
-94 1 -21 5 -22 45 -17 63 9 84 -9 184 -160 178 -268 363 -515 551 -735 58
-68 121 -141 140 -163 34 -39 34 -39 10 -64 -47 -50 -76 -59 -189 -58 -194 3
-455 119 -657 292 -59 51 -81 86 -32 52 40 -29 49 -18 13 17 -82 79 -178 244
-205 353 -19 73 -19 318 0 385 37 137 107 243 127 192z M5370 6244 c-60 -11
-112 -50 -137 -102 -9 -18 -14 -34 -12 -36 2 -2 24 -14 48 -26 48 -24 77 -48
68 -56 -2 -3 -20 4 -38 14 -61 34 -149 62 -192 61 -40 0 -44 -3 -85 -65 -43
-64 -43 -64 -10 -105 41 -51 45 -131 9 -179 -30 -41 -27 -50 17 -50 21 0 48
-9 62 -20 25 -19 25 -19 -41 -13 -74 6 -144 -19 -203 -72 -38 -34 -30 -39 43
-24 45 10 64 10 72 2 12 -12 -43 -33 -85 -33 -43 0 -192 -93 -180 -112 4 -5
21 -7 40 -4 40 8 134 -3 134 -15 0 -5 -26 -9 -57 -9 -76 0 -156 -22 -199 -55
-46 -35 -43 -45 14 -45 45 0 120 -26 108 -37 -3 -3 -27 1 -54 8 -64 16 -124 0
-187 -48 -45 -34 -63 -73 -27 -58 52 23 192 13 192 -14 0 -3 -42 -7 -93 -8
-102 -1 -138 -15 -211 -80 -50 -44 -47 -57 10 -48 48 7 138 -10 154 -30 6 -8
-17 -10 -83 -7 -114 5 -148 -8 -229 -85 -64 -62 -75 -88 -30 -76 66 19 212 1
212 -27 0 -3 -45 -6 -100 -7 -139 -3 -228 -42 -226 -99 1 -32 6 -38 51 -63 84
-45 114 -64 120 -78 2 -8 1 -12 -3 -10 -86 45 -263 127 -273 127 -8 0 -27 -11
-44 -24 -43 -35 -40 -38 138 -120 59 -27 59 -27 35 -58 -35 -45 -38 -45 -109
19 -217 196 -288 332 -203 388 33 21 30 35 -6 35 -41 0 -83 23 -113 61 -31 40
-40 34 -58 -38 -19 -79 -18 -178 4 -232 21 -51 18 -57 -20 -44 -15 6 -47 17
-71 24 -25 7 -60 29 -81 51 -21 21 -43 38 -48 38 -20 0 -103 -215 -103 -266 0
-30 2 -30 51 6 59 42 131 60 244 60 123 0 187 -28 290 -125 92 -88 123 -110
168 -125 47 -15 47 -16 -16 -78 -57 -57 -77 -64 -77 -29 0 12 -7 32 -15 43 -8
12 -24 46 -35 77 -23 61 -82 134 -134 167 -263 162 -606 -125 -478 -401 32
-70 46 -77 60 -30 15 48 45 87 84 107 30 16 30 16 9 38 -73 77 24 185 156 174
40 -3 40 -5 27 -60 -4 -19 0 -36 15 -57 59 -83 44 -103 -421 -570 -216 -218
-420 -425 -453 -461 -32 -36 -86 -94 -120 -130 -121 -129 -494 -549 -675 -760
-30 -36 -71 -83 -90 -105 -20 -22 -56 -65 -80 -95 -24 -30 -75 -92 -113 -137
-146 -174 -48 -90 288 249 321 323 398 403 640 658 44 47 204 214 355 370 151
157 311 323 355 370 44 47 119 125 166 175 102 107 185 199 237 265 32 39 32
22 1 -72 -26 -81 -38 -109 -84 -197 -20 -38 -106 -141 -244 -293 -125 -137
-239 -263 -287 -318 -21 -25 -41 -47 -44 -50 -3 -3 -43 -48 -90 -100 -47 -52
-87 -97 -90 -100 -72 -69 -175 -219 -161 -233 9 -9 26 2 68 48 129 137 183
195 263 285 47 52 92 102 100 110 8 8 44 49 80 90 63 73 94 108 210 235 100
110 242 247 248 240 4 -3 2 -9 -3 -13 -6 -4 -44 -45 -85 -92 -41 -47 -82 -92
-90 -100 -9 -8 -90 -98 -180 -200 -91 -102 -167 -187 -170 -190 -3 -3 -39 -43
-80 -90 -41 -47 -98 -110 -126 -140 -28 -30 -69 -75 -90 -100 -21 -25 -59 -67
-84 -93 -60 -64 -58 -56 -59 -264 -2 -214 -2 -214 81 -110 32 40 68 83 80 97
13 14 68 77 122 140 54 63 117 135 140 160 113 123 402 450 516 584 25 30 43
50 204 234 93 106 130 132 204 140 35 4 42 8 36 21 -21 46 -11 76 28 79 33 3
41 -2 95 -59 111 -119 128 -136 192 -183 314 -231 778 -200 905 60 79 161 -2
370 -159 414 -143 40 -279 -107 -186 -201 38 -38 51 -37 51 4 0 64 88 93 138
47 23 -22 29 -40 12 -40 -5 0 -10 4 -10 8 0 12 -46 32 -54 25 -3 -4 -6 -20 -6
-38 0 -111 -177 -235 -334 -235 -201 1 -342 115 -423 345 -9 27 -32 68 -50 92
-40 52 -39 49 -5 58 15 3 35 13 44 22 35 31 108 -43 108 -110 0 -34 -1 -34 51
12 56 52 114 80 224 109 418 112 670 264 862 521 218 290 225 734 16 1043 -46
67 -46 73 -7 103 183 139 -1 490 -236 449z m74 -70 c21 -8 20 -30 -1 -37 -10
-4 -32 -18 -49 -32 -31 -25 -31 -25 -58 -4 -30 23 -27 33 18 60 32 19 62 24
90 13z m-274 -173 c0 -11 10 -27 22 -35 36 -25 12 -30 -37 -7 -24 11 -49 21
-55 21 -12 0 -12 3 -4 24 10 25 74 22 74 -3z m298 -443 c59 -87 101 -283 89
-417 -11 -122 -80 -316 -132 -368 -8 -8 -15 -17 -15 -21 0 -4 -25 -33 -55 -66
-52 -56 -65 -76 -47 -76 4 0 20 11 35 25 15 14 27 21 27 16 0 -19 -129 -125
-217 -179 -285 -175 -547 -228 -668 -136 -57 44 -59 33 36 139 183 201 450
551 639 835 111 165 120 174 193 168 42 -3 42 -3 45 47 6 85 27 95 70 33z
M800 4054 c0 -3 14 -22 30 -43 39 -47 70 -129 70 -181 0 -49 12 -51 28 -7 30
82 3 171 -63 215 -33 21 -65 29 -65 16z M4896 4031 c-69 -49 -93 -130 -62
-206 21 -49 34 -43 34 14 0 53 41 158 73 187 45 41 11 45 -45 5z M2558 2767
c-141 -141 -453 -466 -648 -677 -74 -80 -142 -152 -150 -160 -8 -8 -39 -42
-69 -75 -30 -33 -93 -101 -140 -150 -47 -50 -124 -133 -171 -185 -47 -52 -112
-124 -146 -160 -57 -60 -127 -138 -264 -295 -239 -273 -306 -356 -368 -457
-91 -149 -281 -428 -330 -486 -61 -72 -61 -78 -6 -58 169 63 200 76 374 163
425 213 650 406 1255 1078 59 66 205 228 324 360 475 527 417 441 425 631 10
235 23 236 -198 -11 -55 -60 -136 -150 -180 -199 -45 -49 -85 -94 -91 -100 -5
-6 -28 -31 -49 -56 -21 -25 -67 -74 -100 -110 -34 -36 -74 -81 -90 -100 -15
-19 -47 -55 -70 -80 -22 -25 -84 -92 -136 -150 -52 -58 -120 -132 -151 -165
-31 -33 -76 -82 -100 -109 -42 -47 -145 -158 -271 -291 -32 -33 -58 -57 -58
-53 0 4 10 18 22 30 13 13 48 53 78 88 30 36 61 72 70 80 8 8 28 31 44 50 15
19 51 60 80 90 28 31 66 73 85 95 18 22 54 63 80 90 25 28 80 88 121 135 41
47 98 110 126 140 46 50 100 110 303 340 36 41 111 124 166 184 291 319 325
360 325 397 0 41 -11 37 -74 -28 -37 -38 -56 -52 -56 -41 0 9 5 20 10 23 6 3
10 13 10 22 0 8 29 73 65 144 93 186 89 191 -47 56z M3316 2809 c-14 -17 -26
-35 -26 -40 0 -14 520 -544 773 -789 67 -65 109 -89 60 -34 -10 10 -30 35 -45
56 -15 20 -33 42 -40 50 -7 7 -25 29 -40 50 -15 20 -34 42 -41 50 -7 7 -49 56
-92 108 -72 87 -281 328 -295 340 -3 3 -52 58 -109 123 -116 132 -110 128
-145 86z M3222 2697 c-22 -24 -28 -55 -14 -72 13 -17 34 -86 27 -93 -3 -3 -23
14 -44 38 -34 39 -40 43 -55 31 -25 -21 -19 -42 22 -86 40 -42 333 -370 416
-464 85 -97 290 -325 316 -351 3 -3 39 -43 80 -90 41 -47 77 -87 80 -90 3 -3
34 -39 70 -80 36 -41 67 -77 70 -80 3 -3 43 -48 90 -100 278 -310 360 -405
360 -414 0 -13 -147 141 -350 364 -52 58 -97 107 -100 110 -3 3 -68 75 -144
160 -77 85 -174 193 -216 240 -42 47 -123 137 -180 200 -57 63 -122 135 -144
160 -23 25 -79 88 -126 140 -47 52 -89 100 -95 106 -5 6 -41 45 -79 88 -37 42
-72 76 -77 76 -5 0 -9 -79 -9 -174 0 -191 -1 -189 184 -386 28 -30 85 -93 126
-140 41 -47 77 -87 80 -90 13 -13 123 -135 200 -220 69 -77 196 -216 220 -240
3 -3 25 -27 49 -55 370 -417 661 -682 931 -845 87 -53 378 -200 395 -200 2 0
28 -11 57 -24 74 -34 166 -65 172 -59 3 3 -21 38 -53 77 -32 39 -102 139 -156
221 -54 83 -127 195 -163 250 -105 161 -293 386 -606 725 -28 30 -71 78 -95
105 -114 129 -331 363 -411 445 -14 14 -72 77 -130 140 -123 135 -240 259
-401 425 -64 66 -149 155 -189 198 -83 87 -79 85 -108 54z M2900 2324 c-192
-222 -172 -170 -165 -434 7 -285 33 -771 55 -1042 26 -313 31 -371 41 -473 28
-294 48 -412 63 -364 9 30 37 273 56 494 6 66 15 167 20 225 20 214 39 512 60
935 12 233 13 805 3 804 -5 0 -64 -65 -133 -145z"/></g></svg>`
  return el
}

// Crescent moon glyph for the Night row — inline SVG (a disc minus an offset
// disc) so it needs no image asset; fill:currentColor makes it match the label.
let _moonId = 0
function makeMoon() {
  const el = document.createElement('span')
  el.className = 'sp-moon'
  const id = 'sp-moon-mask-' + (_moonId++)
  el.innerHTML =
    `<svg viewBox="0 0 24 24" width="22" height="22">` +
    `<defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/>` +
    `<circle cx="15.5" cy="10.5" r="8.5" fill="#000"/></mask></defs>` +
    `<circle cx="12" cy="12" r="9.5" mask="url(#${id})"/></svg>`
  return el
}

function renderSplitPanel() {
  const panel = document.getElementById('split-panel')

  // Consume the animation flag immediately so it's always reset,
  // even if no new target row ends up being rendered (e.g. game-over state).
  const animateTarget = sidebarAnimatePending
  sidebarAnimatePending = false

  // Consume the one-shot pop request the same way, so it never lingers to a later render.
  const popRequest = sidebarPop
  sidebarPop = null

  // Pre-night phases (menu, add-players setup, first-leader screen) all show the
  // same full projected preview, so the panel keeps one layout from menu through
  // to when night actually begins.
  const preNight = gs.phase === 'menu' || gs.phase === 'setup' || gs.phase === 'leader'

  // When a new target row is about to appear, animate the old one out simultaneously.
  // Clone it as a fixed-position ghost so the panel can be cleared freely,
  // then apply the exit animation while the new row slides in.
  if (animateTarget) {
    const oldTarget = panel.querySelector('.sp-target')
    if (oldTarget) {
      const rect = oldTarget.getBoundingClientRect()
      if (rect.width > 0) {
        const ghost = oldTarget.cloneNode(true)
        Object.assign(ghost.style, {
          position:      'fixed',
          top:           rect.top  + 'px',
          left:          rect.left + 'px',
          width:         rect.width + 'px',
          margin:        '0',
          zIndex:        '999',
          pointerEvents: 'none',
        })
        document.body.appendChild(ghost)
        void ghost.offsetHeight
        ghost.classList.add('sp-exiting')
        setTimeout(() => ghost.remove(), 500)
      }
    }
  }

  panel.innerHTML = ''

  function budgetEntry(label, secs, dur = null) {
    const entry = document.createElement('div')
    entry.className = 'sp-entry'
    const labelEl = document.createElement('span')
    labelEl.className = 'sp-label sp-opt-label'
    if (label instanceof Node) {
      labelEl.append(label)
      entry.style.alignItems = 'center'
    } else labelEl.textContent = label
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
    timeEl.style.color = 'var(--dim)'
    timeEl.textContent = fmt(secs)
    if (dur !== null) {
      const splitEl = document.createElement('span')
      splitEl.className = 'sp-split'
      splitEl.textContent = `(${fmt(dur)})`
      entry.append(labelEl, timeEl, splitEl)
    } else {
      entry.append(labelEl, timeEl)
    }
    return entry
  }

  // Total-time header — stacked: label, big elapsed clock, target duration beneath
  const totalHeader = document.createElement('div')
  totalHeader.id = 'sp-total-header'
  const totalLabel = document.createElement('div')
  totalLabel.className = 'sp-tt-label'
  totalLabel.textContent = 'TOTAL'
  const totalTimeEl = document.createElement('div')
  totalTimeEl.id = 'total-time'
  totalTimeEl.textContent = fmt(gs.totalSecs)
  const totalOf = document.createElement('div')
  totalOf.className = 'sp-tt-of'
  totalOf.innerHTML = `of <b>${fmt(settings.targetTime * 60)}</b> target`
  totalHeader.append(totalLabel, totalTimeEl, totalOf)
  panel.append(totalHeader)

  const topSep = document.createElement('div')
  topSep.className = 'sp-sep'
  panel.append(topSep)

  const splitsWrap = document.createElement('div')
  splitsWrap.className = 'sp-splits-wrap'

  // Frozen night entry — shown once night phase is complete
  if (gs.nightSecs > 0) {
    const entry = document.createElement('div')
    entry.className = 'sp-entry sp-night-frozen'  // extra gap below, before the Q rows
    const label = document.createElement('span')
    label.className = 'sp-label sp-label-active sp-opt-label'
    label.appendChild(makeMoon())
    entry.style.alignItems = 'center'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
    // Pop the night time on the render right after it freezes (night → game).
    if (popRequest && popRequest.type === 'night') timeEl.classList.add('sp-pop-t')
    timeEl.style.color = 'var(--accent)'
    timeEl.textContent = fmt(gs.nightSecs)
    entry.append(label, timeEl)
    splitsWrap.append(entry)
  }

  // Live night entry — only while still in night phase
  if (gs.phase === 'night') {
    const entry = document.createElement('div')
    entry.className = 'sp-entry'
    const label = document.createElement('span')
    label.className = 'sp-label sp-label-active sp-opt-label'
    label.appendChild(makeMoon())
    entry.style.alignItems = 'center'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
    timeEl.style.color = 'var(--cream)'   // running timer matches the total clock
    timeEl.innerHTML = `<span id="sp-night-tt">${fmt(gs.totalSecs)}</span>`
    entry.append(label, timeEl)
    splitsWrap.append(entry)

    // Night Target row
    const targetEntry = document.createElement('div')
    targetEntry.className = 'sp-entry sp-target' + (animateTarget ? ' sp-future' : '')
    targetEntry.innerHTML =
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">goal:</span>` +
      `<span class="sp-time" style="color:var(--dim)">${fmt(calcNightExpected())}</span>`
    splitsWrap.append(targetEntry)
  }

  // Quest splits (resolved quests)
  for (let i = 0; i < 5; i++) {
    const res = gs.results[i]
    if (!res) continue
    const votingDur = gs.questVotingFrozen[i]
    const cardDur   = gs.questTimes[i]
    const col       = res === 'success' ? 'var(--good-fill)' : 'var(--evil-fill)'
    const entry     = document.createElement('div')
    entry.className = 'sp-entry'
    // On the render where this quest flips to its resolved color, pop just the two
    // elements the outcome keypress changed: the Q-label (now red/blue) and the
    // card timer (right split, now frozen). The middle voting time already popped
    // on the earlier vote-pass, so it stays put. This matches the circle's lock-in
    // (0.85s), so the two-element pop syncs with the big circle's resolve animation.
    const popOutcome = popRequest && popRequest.type === 'resolve' && popRequest.index === i
    const outcomeDur = popOutcome ? ';--sp-pop-dur:0.85s' : ''
    entry.innerHTML = `<span class="sp-label sp-q-label${popOutcome ? ' sp-pop' : ''}" style="color:${col}${outcomeDur}">Q${i + 1}</span>` +
      `<span class="sp-time" style="color:var(--accent)">${fmt(votingDur)}</span>` +
      `<span class="sp-split${popOutcome ? ' sp-pop-t' : ''}" style="color:var(--accent)${outcomeDur}">(${fmt(cardDur)})</span>`
    splitsWrap.append(entry)
  }

  // Active quest live entry (currentQuest < 5 guards against a transient Q6 after Q5 resolves)
  if (gs.phase === 'game' && gs.currentQuest < 5) {
    const i     = gs.currentQuest
    const entry = document.createElement('div')
    entry.className = 'sp-entry'

    const label = document.createElement('span')
    label.className = 'sp-label sp-q-label sp-label-active'
    label.textContent = `Q${i + 1}`

    const timeWrap = document.createElement('span')
    timeWrap.className = 'sp-time'
    // Pop only the middle timer on the render right after the voting timer froze
    // (vote pass) — that single value is the element the keypress changed.
    if (popRequest && popRequest.type === 'freeze') {
      timeWrap.classList.add('sp-pop-t')
    }
    // Running quest timer matches the total clock's running color (cream);
    // once voting freezes it reverts to the accent used by resolved splits.
    timeWrap.style.color = gs.voting ? 'var(--cream)' : 'var(--accent)'

    const ttSpan = document.createElement('span')
    ttSpan.id = 'sp-active-tt'
    ttSpan.textContent = gs.voting
      ? fmt(gs.questSecs)
      : fmt(gs.questVotingFrozen[i])

    const qtSpan = document.createElement('span')
    qtSpan.className = 'sp-split'
    qtSpan.id = 'sp-active-qt'
    qtSpan.textContent = gs.voting
      ? `(${fmt(0)})`
      : `(${fmt(gs.questSecs - gs.questVotingFrozen[i])})`
    // In the card phase the split is the live-running counter — match the total clock (cream).
    if (!gs.voting) qtSpan.style.color = 'var(--cream)'

    timeWrap.append(ttSpan)
    entry.append(label, timeWrap, qtSpan)
    splitsWrap.append(entry)
  }

  // Target row: expected end time for the active quest.
  // Sits between the live active-quest row and the future projections so the
  // player can glance at the target without losing sight of future quests.
  // Slides in only when the active quest changes (sidebarAnimatePending flag).
  if (gs.phase === 'game' && gs.currentQuest < 5 && gs.successCount < 3 && gs.failCount < 3) {
    const qi = gs.currentQuest
    const votingAlloc = gs.questAllotted[qi]
    const cardAlloc   = questCardRef(gs.questSizes[qi])
    const entry     = document.createElement('div')
    entry.className = 'sp-entry sp-target' + (animateTarget ? ' sp-future' : '')
    entry.innerHTML =
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">goal:</span>` +
      `<span class="sp-time" style="color:var(--dim)">${fmt(votingAlloc)}</span>` +
      `<span class="sp-split">(${fmt(cardAlloc)})</span>`
    splitsWrap.append(entry)
  }

  // Projected schedule: each upcoming phase as a target timestamp —
  // "what should the total-time clock read when this phase is done?"
  {
    const firstFuture = preNight || gs.phase === 'night' ? 0
                      : gs.phase === 'game' ? gs.currentQuest + 1 : 5
    let cursor
    if (preNight) {
      // Full pre-game preview: show NIGHT target first, then quests
      cursor = calcNightExpected()
      splitsWrap.append(budgetEntry(makeMoon(), cursor))
    } else if (gs.phase === 'night') {
      // Night in progress: project quests from when night is expected to end
      cursor = Math.max(gs.totalSecs, calcNightExpected())
    } else {
      // Game: project from the active quest's expected end so timestamps are stable
      // and only change when carry-over updates questAllotted on quest completion.
      const qi = gs.currentQuest
      cursor = qi < 5
        ? gs.totalSecs - gs.questSecs + gs.questAllotted[qi] + questCardRef(gs.questSizes[qi])
        : gs.totalSecs
    }
    for (let i = firstFuture; i < 5; i++) {
      let endTimestamp, qDur
      if (i === 4) {
        // Q5's end is pinned; its displayed duration is whatever gap remains after Q4
        endTimestamp = calcQ5TargetEnd()
        qDur         = Math.max(0, endTimestamp - cursor)
      } else {
        qDur         = gs.questAllotted[i] + questCardRef(gs.questSizes[i])
        endTimestamp = cursor + qDur
      }
      cursor = endTimestamp
      const entry = document.createElement('div')
      entry.className = 'sp-entry'
      entry.innerHTML =
        `<span class="sp-label sp-q-label">Q${i + 1}</span>` +
        `<span class="sp-time" style="color:var(--dim)">${fmt(gs.questAllotted[i])}</span>` +
        `<span class="sp-split">(${fmt(questCardRef(gs.questSizes[i]))})</span>`
      splitsWrap.append(entry)
    }
  }

  // Frozen assassination entry
  if (gs.assnSecs > 0) {
    const entry = document.createElement('div')
    entry.className = 'sp-entry'
    const labelEl = document.createElement('span')
    labelEl.className = 'sp-label sp-opt-label'
    labelEl.appendChild(makeDagger())
    entry.style.alignItems = 'center'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
    // Pop the assassination time on the render right after it freezes (G/E keypress).
    if (popRequest && popRequest.type === 'assn') timeEl.classList.add('sp-pop-t')
    timeEl.style.color = 'var(--accent)'
    timeEl.textContent = fmt(gs.assnSecs)
    entry.append(labelEl, timeEl)
    splitsWrap.append(entry)
  }

  // Live assassination timer + target
  if (gs.phase === 'assassination') {
    const timerEntry = document.createElement('div')
    timerEntry.className = 'sp-entry'
    const timerLabel = document.createElement('span')
    timerLabel.className = 'sp-label sp-label-active sp-opt-label'
    timerLabel.appendChild(makeDagger())
    timerEntry.style.alignItems = 'center'
    const timeWrap = document.createElement('span')
    timeWrap.className = 'sp-time'
    timeWrap.style.color = 'var(--cream)'   // running timer matches the total clock
    const ttSpan = document.createElement('span')
    ttSpan.id = 'sp-assn-tt'
    ttSpan.textContent = fmt(gs.totalSecs - gs.assnStart)
    timeWrap.append(ttSpan)
    timerEntry.append(timerLabel, timeWrap)
    splitsWrap.append(timerEntry)

    const assnTarget = document.createElement('div')
    assnTarget.className = 'sp-entry sp-target' + (animateTarget ? ' sp-future' : '')
    assnTarget.innerHTML =
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">goal:</span>` +
      `<span class="sp-time" style="color:var(--dim)">${fmt(gs.assnRef)}</span>`
    splitsWrap.append(assnTarget)
  }

  // Assassination budget lookahead — shown when not yet reached and Merlin is in play
  if ((preNight || gs.phase === 'night' || gs.phase === 'game') && settings.characters.merlin) {
    splitsWrap.append(budgetEntry(makeDagger(), calcAssnBudget() - calcQ5TargetEnd()))
  }

  panel.append(splitsWrap)

  // Spacer pushes console to bottom
  const spacer = document.createElement('div')
  spacer.style.flex = '1'
  panel.append(spacer)

  // Console
  const hasNp = !!music.currentTrack
  if (gs.eventLog.length > 0 || hasNp) {
    const sep = document.createElement('div')
    sep.className = 'sp-sep'
    panel.append(sep)
    gs.eventLog.forEach((msg, idx) => {
      const line = document.createElement('div')
      line.className = 'sp-log' + (idx === 0 ? ' sp-log-recent' : '')
      line.textContent = msg
      panel.append(line)
    })
  }
}

let _npCurrentTrack = null

function renderNowPlaying() {
  const track  = music.currentTrack
  const area   = document.getElementById('sp-np-area')
  const sep    = document.getElementById('sp-np-sep')
  const textEl = document.getElementById('sp-np-text')

  if (!track) {
    area.classList.add('sp-np-hidden')
    _npCurrentTrack = null
    return
  }

  area.classList.remove('sp-np-hidden')
  // Separator only needed when there are no event log entries (log section has its own sep otherwise)
  sep.classList.toggle('sp-np-hidden', gs.eventLog.length === 0)

  if (track === _npCurrentTrack) return
  _npCurrentTrack = track

  // Reset scroll state for new track
  textEl.classList.remove('scrolling')
  textEl.style.removeProperty('--np-dx')
  textEl.style.removeProperty('--np-dur')
  textEl.textContent = '♪ ' + track

  requestAnimationFrame(() => {
    const clip  = document.getElementById('sp-np-clip')
    const style = getComputedStyle(clip)
    const available = clip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const overflow  = textEl.scrollWidth - available
    if (overflow > 4) {
      const dur = Math.max(2, overflow / 40 + 1.5)
      textEl.style.setProperty('--np-dx',  `-${overflow}px`)
      textEl.style.setProperty('--np-dur', `${dur.toFixed(1)}s`)
      textEl.classList.add('scrolling')
    }
  })
}

function renderScrollQuote() {
  const el = document.getElementById('scroll-quote')
  const shouldShow = gs.phase !== 'menu' && gs.phase !== 'night'
  if (shouldShow) {
    document.getElementById('quote-wave-tp').textContent = gs.quote
    document.fonts.ready.then(buildQuoteWavePath)
    el.classList.remove('hidden')
  } else {
    el.classList.add('hidden')
  }
}

function buildQuoteWavePath() {
  const FONT      = 'AnglicanText, Georgia, serif'
  const BASE_SIZE = 43
  const HALF_PER  = 72      // half wave period — zero-crossings at multiples of this
  const Y         = 58
  const AMP       = 3
  const PERIOD    = 144

  const tp   = document.getElementById('quote-wave-tp')
  const rect = document.getElementById('quote-rect')
  if (!tp || !rect) return

  const text = tp.textContent.trim()

  const bestSize = BASE_SIZE
  // Apply the font size to the real SVG text before measuring it.
  tp.parentElement.setAttribute('font-size', bestSize)

  // Measure the ACTUAL SVG text element, not a separate HTML span: SVG lays
  // glyphs along the textPath with slightly different metrics than HTML text,
  // and for some quotes it rendered wider than the span measured — leaving the
  // parchment too narrow so the text overflowed past the right scroll cap.
  let measured = 0
  if (typeof tp.getComputedTextLength === 'function') measured = tp.getComputedTextLength()
  if (!measured) {
    // Fallback (e.g. fonts not yet ready): measure with a hidden HTML span.
    const span = document.createElement('span')
    span.style.cssText = `position:fixed;top:-9999px;left:-9999px;white-space:nowrap;` +
                         `font-family:${FONT};font-size:${BASE_SIZE}px;`
    span.textContent = text
    document.body.appendChild(span)
    measured = span.getBoundingClientRect().width
    document.body.removeChild(span)
  }
  // Each scroll-roll image overlaps the parchment end by ROLL_OVERLAP px and sits
  // on top of it (z-index 4). The text must be inset past that overlap plus a small
  // blank gap, or its ends render on top of / past the rolls. A previous version
  // aligned the right roll to a wave zero-crossing, which could push the overlap up
  // to ~50px and cover the tail of longer quotes ("text too far right at the end").
  // Fixed, symmetric insets keep the text clear of both rolls for every quote.
  const ROLL_OVERLAP = 20                  // how much each roll image sits over the parchment
  const EDGE_GAP     = 10                  // blank parchment between a roll and the text
  const INSET        = ROLL_OVERLAP + EDGE_GAP
  const textW  = Math.ceil(measured + 4)   // +4 px safety buffer — tight fit around the text
  const bestW  = INSET + textW + INSET

  // Apply rect width (font size already set above, before measuring)
  rect.style.width    = bestW + 'px'
  rect.style.minWidth = 'unset'
  // Centre the text within its inset region so it clears both rolls symmetrically.
  tp.setAttribute('startOffset', INSET + textW / 2)

  // Constant right-roll overlap (left roll uses the CSS margin-right; both = ROLL_OVERLAP).
  const scrollRight = document.querySelector('.scroll-img-right')
  if (scrollRight) scrollRight.style.marginLeft = -ROLL_OVERLAP + 'px'

  // Fade the valley shade out under each roll so the parchment matches the roll at the seam.
  const valleyShade = document.querySelector('.quote-valley-shade')
  if (valleyShade) {
    const mask = `linear-gradient(to right, transparent ${ROLL_OVERLAP}px, black 80px, black calc(100% - 80px), transparent calc(100% - ${ROLL_OVERLAP}px))`
    valleyShade.style.webkitMaskImage = mask
    valleyShade.style.maskImage       = mask
  }

  // Position the floating text SVG (sibling of parchment) to overlay it exactly.
  // It sits outside the masked parchment div so it renders above the scroll images.
  const textSvg = document.querySelector('.quote-text-svg')
  if (textSvg) {
    const sqBounds   = document.getElementById('scroll-quote').getBoundingClientRect()
    const rectBounds = rect.getBoundingClientRect()
    textSvg.style.left  = (rectBounds.left - sqBounds.left) + 'px'
    textSvg.setAttribute('width',  bestW)
    textSvg.setAttribute('height', '100')
  }

  // Build wave path — runs the full bestW; the text is centred within its inset
  // region (see above), leaving blank parchment under each roll.
  const f = n => n.toFixed(1)
  let d = `M 0,${Y}`
  for (let x = 0; x + PERIOD <= bestW; x += PERIOD) {
    d += ` C ${f(x+19.2)},${Y}   ${f(x+52.8)},${Y-AMP} ${f(x+72)},${Y}`
    d += ` C ${f(x+91.2)},${Y+AMP} ${f(x+124.8)},${Y} ${f(x+144)},${Y}`
  }
  d += ` L ${f(bestW)},${Y}`
  document.getElementById('quote-wave-path').setAttribute('d', d)
}

function resetTimerBar() {
  const fill = document.getElementById('timer-fill')
  fill.style.width = '0%'
  fill.style.animationPlayState = ''   // resume shimmer (in case a death card paused it)
  document.getElementById('timer-overtime').style.width = '0%'
}

// Tracks which content tag is currently in the overlay body.
// Used to decide whether to animate on content change vs just update in place.
let _ovPhase = null

function renderOverlay() {
  const overlay = document.getElementById('phase-overlay')
  const body    = document.getElementById('overlay-body')
  const hint    = document.getElementById('overlay-hint')
  body.classList.remove('setup-centered')   // only the Add-names screen re-adds it

  // Replaces overlay body content.
  // Triggers a fade-in animation when the content category (tag) changes —
  // e.g. menu → night. Same-tag updates (menu row navigation) are instant.
  function setBody(tag, html) {
    if (tag !== _ovPhase) {
      body.classList.remove('ov-appearing')
      body.innerHTML = html
      void body.offsetWidth  // force reflow so the animation restarts cleanly
      body.classList.add('ov-appearing')
      _ovPhase = tag
    } else {
      body.innerHTML = html  // same category — instant update, no animation
    }
  }

  if (gs.phase === 'menu') {
    overlay.classList.remove('hidden')
    overlay.classList.add('overlay-raised')
    body.classList.remove('log-active')

    const buildMenuHTML = (rowDefs) => {
      // Selectable = rows that have a label and are not info-only
      const selectableKeys = rowDefs.reduce((acc, r, i) => { if (r.label && !r.info) acc.push(i); return acc }, [])
      const focusedRowIdx  = selectableKeys[settings.menuRow] ?? selectableKeys[0]
      return rowDefs.map((row, i) => {
        if (!row.label) return `<div class="menu-sep"></div>`
        const focused  = i === focusedRowIdx
        const extra    = (row.info ? ' info' : '') + (row.disabled && !row.info ? ' disabled' : '') + (focused ? ' focused' : '')
        const cls      = 'menu-row' + extra
        const valClass = 'menu-row-value' + (row.isOn || focused ? ' menu-val-on' : '')
        const labelInner = row.desc
          ? `${row.label}<span class="menu-row-desc">${row.desc}</span>`
          : row.label
        return `<div class="${cls}" data-menu-key="${row.key}"><span class="menu-row-label">${labelInner}</span>` +
               `<span class="${valClass}">${row.value}</span></div>`
      }).join('')
    }

    if (settings.menuPage === 'main') {
      // Show what differs from per-player defaults
      const def = {
        merlin: true, assassin: true, percival: true, morgana: true,
        oberon:  (settings.players === 7 || settings.players >= 10),
        mordred: (settings.players === 9 || settings.players >= 10),
      }
      const diffs = Object.entries(def)
        .filter(([k, d]) => settings.characters[k] !== d)
      const charValue = (diffs.length ? 'custom' : 'defaults') + ' ▸'

      const speedLabel = settings.gameSpeed ? SPEED_LABELS[settings.gameSpeed] : 'Custom'
      const rowDefs = [
        { key: 'players',   label: 'PLAYERS',          value: String(settings.players) },
        { key: 'speed',     label: 'GAME SPEED',        value: speedLabel },
        { key: 'time',      label: 'GAME LENGTH',       value: settings.targetTime + ' min' },
        { key: 'sep1' },
        { key: 'chars',     label: 'CHARACTERS',        value: charValue, isOn: diffs.length > 0 },
        { key: 'sep2' },
        { key: 'lotl',      label: 'LADY OF THE LAKE',  value: settings.abilities.lotl      ? 'ON' : 'OFF',
          isOn: settings.abilities.lotl },
        { key: 'excalibur', label: 'EXCALIBUR',         value: settings.abilities.excalibur ? 'ON' : 'OFF',
          isOn: settings.abilities.excalibur },
        { key: 'sep3' },
        { key: 'setup',     label: 'ADD NAMES',         value: (() => {
            const n = preGame.seating.filter(x => x && x.trim()).length
            return n ? `${n} ▸` : '▸'
          })() },
        { key: 'start',     label: 'START GAME',        value: '▸', isOn: true },
      ]
      setBody('menu-main', `
        <div class="ov-title grad-title" style="font-family:'EnchantedLand',Georgia,serif">Avalon</div>
        <div class="ov-rule" style="margin:20px 0"></div>
        <div class="menu-settings">${buildMenuHTML(rowDefs)}</div>
      `)
      hint.textContent = '[↑↓] navigate   [←→] change   [ENTER] confirm'

    } else if (settings.menuPage === 'characters') {
      const cv = (key) => settings.characters[key]
      const rowDefs = [
        { key: 'merlin',   label: 'Merlin',   desc: CHAR_DESC.Merlin,   value: cv('merlin')   ? 'ON' : 'OFF', isOn: cv('merlin'),   disabled: !canEnableCharacter('merlin') },
        { key: 'percival', label: 'Percival', desc: CHAR_DESC.Percival, value: cv('percival') ? 'ON' : 'OFF', isOn: cv('percival'), disabled: !canEnableCharacter('percival') },
        { key: 'sep1' },
        { key: 'assassin', label: 'Assassin', desc: CHAR_DESC.Assassin, value: cv('assassin') ? 'ON' : 'OFF', isOn: cv('assassin'), disabled: !canEnableCharacter('assassin') },
        { key: 'morgana',  label: 'Morgana',  desc: CHAR_DESC.Morgana,  value: cv('morgana')  ? 'ON' : 'OFF', isOn: cv('morgana'),  disabled: !canEnableCharacter('morgana') },
        { key: 'mordred',  label: 'Mordred',  desc: CHAR_DESC.Mordred,  value: cv('mordred')  ? 'ON' : 'OFF', isOn: cv('mordred'),  disabled: !canEnableCharacter('mordred') },
        { key: 'oberon',   label: 'Oberon',   desc: CHAR_DESC.Oberon,   value: cv('oberon')   ? 'ON' : 'OFF', isOn: cv('oberon'),   disabled: !canEnableCharacter('oberon') },
        { key: 'sep2' },
        { key: 'back',     label: '← back',   value: '' },
      ]
      setBody('menu-chars', `
        <div class="ov-title grad-title" style="font-size:56px; letter-spacing:2px">Characters</div>
        <div class="ov-rule" style="margin:16px 0"></div>
        <div class="menu-settings">${buildMenuHTML(rowDefs)}</div>
      `)
      hint.textContent = '[↑↓] select   [←→] toggle   [ESC] back'
    }

    // Menu rows are clickable too (mirrors keyboard navigation).
    body.querySelector('.menu-settings')?.addEventListener('click', e => {
      const row = e.target.closest('.menu-row[data-menu-key]')
      if (row) handleMenuClick(row.dataset.menuKey)
    })

  } else if (gs.phase === 'setup') {
    overlay.classList.remove('hidden')
    overlay.classList.remove('overlay-raised')
    body.classList.add('log-active')
    body.classList.add('setup-centered')
    setBody('setup', buildSetupHTML())

    // Seat-name autocomplete (known players + whatever is typed in other seats)
    const seatOptions = () => {
      const known = new Set(players.getAll())
      document.querySelectorAll('[data-seat-idx]').forEach(el => {
        const v = el.value.trim(); if (v) known.add(v)
      })
      return [...known]
    }
    // Auto-open chain: on entry, open the first unfilled seat's dropdown, then
    // advance to the next unfilled seat on each pick. Clicking outside stops it.
    const seatInputs = [...document.querySelectorAll('[data-seat-idx]')]
    const seatHandles = new Map()
    let seatChainActive = true
    const seatOnOutside = e => { if (!e.target.closest('.log-ac-item')) seatEndChain() }
    function seatEndChain() {
      seatChainActive = false
      document.removeEventListener('mousedown', seatOnOutside, true)
    }
    function seatAdvance(fromIdx) {
      if (!seatChainActive) return
      const next = seatInputs.find(inp => +inp.dataset.seatIdx >= fromIdx && !inp.value.trim())
      if (next) seatHandles.get(next).openAll()
      else seatEndChain()
    }
    const submitSetup = () => {
      if (hasDuplicateNames()) {
        document.getElementById('setup-dup-warning')?.classList.add('show')
        return
      }
      syncSeatsToPreGame()
      preGame.seating.forEach(nm => { if (nm) players.findOrCreate(nm) })
      gs.phase = setupReturnPhase
      renderOverlay()
    }
    // Enter (menu closed) tabs to the next seat, or Done from the last one.
    const seatAdvanceKey = input => () => { if (!focusNextLogField(input)) submitSetup() }

    seatInputs.forEach(input => {
      const h = attachLogAutocomplete(input, seatOptions,
        () => seatAdvance(+input.dataset.seatIdx + 1), seatAdvanceKey(input), 'ac-big')
      seatHandles.set(input, h)
      input.addEventListener('input', syncSeatsToPreGame)
      input.addEventListener('blur', () => {
        const name = input.value.trim()
        if (name) players.findOrCreate(name)
      })
    })
    document.addEventListener('mousedown', seatOnOutside, true)
    setTimeout(() => seatAdvance(0), 0)   // open the first unfilled seat

    document.getElementById('setup-done')?.addEventListener('click', submitSetup)

    hint.textContent = '[ESC] back'

  } else if (gs.phase === 'leader') {
    overlay.classList.remove('hidden')
    overlay.classList.add('overlay-raised')
    body.classList.remove('log-active')
    _leaderConfirm = false                    // fresh each time the screen renders
    setBody('leader', buildLeaderHTML())

    const leaderInput = document.getElementById('leader-input')
    if (leaderInput) {
      // dropdown / free-type manual entry, suggesting the entered seat names
      attachLogAutocomplete(leaderInput, () =>
        preGame.seating.map(n => (n || '').trim()).filter(Boolean))
      leaderInput.addEventListener('input', () => {
        leaderInput.classList.remove('locked-in')   // manual edit drops the glow
        syncLeaderInput()
        if (leaderHasChoice()) leaderResetConfirm()
      })
    }
    document.getElementById('leader-randomize')?.addEventListener('click', leaderRandomize)
    document.getElementById('leader-addplayers')?.addEventListener('click', leaderAddPlayers)
    document.getElementById('leader-continue')?.addEventListener('click', leaderContinue)

    hint.textContent = '[SPACE] randomize   [P] add names   [ENTER] continue'

  } else if (gs.phase === 'night') {
    overlay.classList.remove('hidden')
    overlay.classList.add('overlay-raised')
    setBody('night', `
      <div class="ov-title grad-title" style="font-size:120px; letter-spacing:4px">Night phase</div>
      <div class="ov-rule"></div>
      <div class="ov-body">
        <div class="grad-line">Memorise your character card.</div>
        <div class="grad-line">Close your eyes.</div>
        <div class="grad-line">Form a fist in front of you.</div>
        <div class="grad-line">Listen for further instructions.</div>
      </div>
    `)
    hint.textContent = '[ENTER] continue'

  } else if (gs.phase === 'log') {
    overlay.classList.remove('hidden')
    overlay.classList.remove('overlay-raised')
    body.classList.add('log-active')
    setBody('log', buildLogHTML())
    _logCharWarned = false   // reset the character/settings mismatch warning
    // Live-update the scale descriptions as sliders move; mark as touched on first interaction
    const balEl = document.getElementById('log-balance')
    const conEl = document.getElementById('log-conf')
    if (balEl) {
      const updateBal = () => {
        balEl.classList.add('touched')
        const el = document.getElementById('log-balance-desc')
        if (el) { el.style.color = 'var(--accent-brt)'; el.textContent = `${balEl.value > 0 ? '+' : ''}${balEl.value} · ${BALANCE_LABELS[balEl.value]}` }
      }
      balEl.addEventListener('input', updateBal)
      balEl.addEventListener('click', updateBal)
      if (balEl.classList.contains('touched')) updateBal()  // restore desc from draft
    }
    if (conEl) {
      const updateConf = () => {
        conEl.classList.add('touched')
        const el = document.getElementById('log-conf-desc')
        if (el) { el.style.color = 'var(--accent-brt)'; el.textContent = `${conEl.value} · ${CONFIDENCE_LABELS[conEl.value]}` }
      }
      conEl.addEventListener('input', updateConf)
      conEl.addEventListener('click', updateConf)
      if (conEl.classList.contains('touched')) updateConf()  // restore desc from draft
    }

    // ── Roster autocomplete ──────────────────────────────────────────────
    // Name column: suggest every known player from memory (plus anything typed
    // in other seats), not just the pre-entered ones. You can still type freely.
    const _getNameOptions = () => {
      const known = new Set(players.getAll())
      document.querySelectorAll('[data-seat-idx]').forEach(el => {
        const v = el.value.trim(); if (v) known.add(v)
      })
      return [...known]
    }
    // Names currently entered in the roster (for first-leader suggestions).
    const _getEnteredNames = () => {
      const names = []
      document.querySelectorAll('[data-seat-idx]').forEach(el => {
        const v = el.value.trim(); if (v) names.push(v)
      })
      return names
    }
    // Assassination target: good, non-Merlin players; falls back to all names.
    const _getAssnTargetOptions = () => {
      const names = []
      document.querySelectorAll('[data-char-idx]').forEach(el => {
        const role = el.value.trim()
        if (role && logTeamForRole(role) === 'good' && role.toLowerCase() !== 'merlin') {
          const nm = document.querySelector(`[data-seat-idx="${el.dataset.charIdx}"]`)?.value.trim()
          if (nm) names.push(nm)
        }
      })
      return names.length ? names : _getEnteredNames()
    }

    // Auto-open chain over BOTH columns, row-major (name then character per row).
    // First time the log appears for a game it opens the first unfilled cell and
    // advances on each pick, to speed up logging; clicking outside a dropdown stops it.
    const cells = []  // flat order: name0, char0, name1, char1, …
    for (let i = 0; i < gs.players; i++) {
      cells.push(document.querySelector(`[data-seat-idx="${i}"]`))
      cells.push(document.querySelector(`[data-char-idx="${i}"]`))
    }
    const handles = new Map()
    let   chainActive = !logChainDone

    const onOutside = e => { if (!e.target.closest('.log-ac-item')) endChain() }
    function endChain() {
      chainActive = false
      document.removeEventListener('mousedown', onOutside, true)
    }
    function advanceChain(fromPos) {
      if (!chainActive) return
      for (let p = fromPos; p < cells.length; p++) {
        if (cells[p] && !cells[p].value.trim()) { handles.get(cells[p]).openAll(); return }
      }
      endChain()
    }

    // Enter (with the menu closed) tabs to the next field, or submits if last.
    const logAdvance = input => () => { if (!focusNextLogField(input)) _submitLog() }

    cells.forEach((cell, pos) => {
      if (!cell) return
      const isName = cell.hasAttribute('data-seat-idx')
      const h = attachLogAutocomplete(cell, isName ? _getNameOptions : logCharOptions,
        () => advanceChain(pos + 1), logAdvance(cell))
      handles.set(cell, h)
      if (isName) {
        cell.addEventListener('blur', () => {
          const name = cell.value.trim()
          if (name) players.findOrCreate(name)
        })
      }
    })

    if (!logChainDone) {
      logChainDone = true
      document.addEventListener('mousedown', onOutside, true)
      setTimeout(() => advanceChain(0), 0)  // open the first unfilled cell (left-first)
    }

    const assnTargetEl = document.getElementById('log-assn-target')
    if (assnTargetEl) attachLogAutocomplete(assnTargetEl, _getAssnTargetOptions, null, logAdvance(assnTargetEl))

    const firstLeaderEl = document.getElementById('log-first-leader')
    if (firstLeaderEl) attachLogAutocomplete(firstLeaderEl, _getEnteredNames, null, logAdvance(firstLeaderEl))

    hint.textContent = '[ESC] back'

    document.getElementById('log-submit')?.addEventListener('click', () => _submitLog())

  } else {
    overlay.classList.add('hidden')
    body.classList.remove('log-active')
    // overlay-raised is intentionally kept so the content doesn't shift
    // downward during the opacity fade-out — it's invisible by then anyway.
    hint.textContent = ''
    _ovPhase = null  // next visible state will always fade in fresh
  }
}

function renderQuests() {
  for (let i = 0; i < 5; i++) {
    const wrap    = document.getElementById(`qw-${i}`)
    const res     = gs.results[i]
    const isCurr  = (i === gs.currentQuest) && gs.phase === 'game' && gs.successCount < 3 && gs.failCount < 3
    wrap.classList.toggle('current', isCurr)
    // Pending = neither resolved nor active; its donut edges (and hole rim) are stone.
    wrap.classList.toggle('q-pending', !gs.results[i] && !isCurr)
    const size    = gs.questSizes[i]
    const cardRef = questCardRef(size)

    if (res) {
      const state = `resolved-${res}`
      if (!wrap.classList.contains('locked') && !wrap.classList.contains('locking')) {
        wrap.classList.add('locking')
        toggleArcClass(i, 'locking', true)
        setTimeout(() => {
          wrap.classList.remove('locking')
          toggleArcClass(i, 'locking', false)
          wrap.classList.add('locked')
        }, 850)
      }
      toggleArcClass(i, 'overtime', false)
      toggleArcClass(i, 'warning',  false)
      paintArc(i, state, size, {
        votingElapsed: gs.questVotingFrozen[i],
        votingRef:     gs.questAllotted[i],
        cardElapsed:   gs.questTimes[i],
        cardRef,
      })
      updateArcNum(i, size, state)
    } else if (isCurr) {
      wrap.classList.remove('locked')
      if (gs.voting) {
        paintArc(i, 'voting', size, {
          votingElapsed: phaseElapsed(),
          votingRef:     phaseRef(),
        })
        updateArcNum(i, size, 'voting')
      } else {
        paintArc(i, 'card', size, {
          votingElapsed: gs.questVotingFrozen[i],
          votingRef:     gs.questAllotted[i],
          cardElapsed:   phaseElapsed(),
          cardRef,
        })
        updateArcNum(i, size, 'card')
      }
    } else {
      wrap.classList.remove('locked')
      paintArc(i, 'pending', size)
      updateArcNum(i, size, 'pending')
    }
  }

  // Q4 needs two fails at 7+ players — persist through assassination with the drops.
  document.getElementById('q4-twofail')
    ?.classList.toggle('visible', gs.players >= 7 && (gs.phase === 'game' || gs.phase === 'assassination'))
}

// Lady of the Lake is a passive, no-input indicator: a teardrop inside the hole
// of quests 3/4/5 (its colour tracks the number via updateArcNum). When a check
// comes into play the circle flips to the symbol side, shimmers, then flips back,
// and the banner prompt appears (see scheduleLotlPrompt / triggerCoinFlip).
function renderLotlIndicators() {
  // Keep the drop icons visible through assassination, alongside the quest circles.
  const on = settings.abilities.lotl && (gs.phase === 'game' || gs.phase === 'assassination')
  document.getElementById('quests').classList.toggle('lotl-on', on)
}

function renderLotlBanner() {
  const el = document.getElementById('lotl-banner')
  if (!el) return
  const show = settings.abilities.lotl && gs.phase === 'game' && gs.lotlPromptActive
  el.classList.toggle('visible', show)
  if (show) el.textContent = "Use Lady of the Lake to check one player's loyalty"
}

// Coin-flip timing (ms)
const LOTL_FLIP_MS    = 750   // rotate to / from the symbol side
const LOTL_SHIMMER_MS = 2000  // shimmer hold while the symbol side is showing

const LOTL_REPEAT_MS = 15000  // re-run the flip + shimmer every 15s until first vote

// True while the prompt should be live: still on this quest, voting, no outcome yet.
function isLotlPromptLive(qi) {
  return gs.phase === 'game' && gs.currentQuest === qi && gs.voting && gs.voteCount === 0
}

// Called from resolveQuest when Q3/Q4/Q5 comes into play. Waits for the new
// quest circle's tween to finish, then runs the coin flip and shows the prompt,
// repeating the flip + shimmer every 15s until the players enter a vote outcome —
// unless one is already in before the initial delay elapses.
function scheduleLotlPrompt(qi) {
  if (_lotlPromptTimer) clearTimeout(_lotlPromptTimer)
  if (_lotlRepeatTimer) { clearInterval(_lotlRepeatTimer); _lotlRepeatTimer = null }
  _lotlPromptTimer = setTimeout(() => {
    _lotlPromptTimer = null
    if (!isLotlPromptLive(qi)) return
    gs.lotlPromptActive = true
    renderLotlBanner()
    triggerCoinFlip(qi)
    _lotlRepeatTimer = setInterval(() => {
      if (isLotlPromptLive(qi)) triggerCoinFlip(qi)
      else dismissLotlPrompt()
    }, LOTL_REPEAT_MS)
  }, 1000)  // matches the .q-wrap.current tween (0.5s delay + 0.5s)
}

// Flip the quest circle to the LotL symbol, shimmer, then flip back.
function triggerCoinFlip(qi) {
  const flipper = document.getElementById(`qflip-${qi}`)
  if (!flipper) return
  _lotlFlipTimers.forEach(clearTimeout)  // clear any stragglers before re-arming
  _lotlFlipTimers = []
  const sh = document.getElementById(`lotl-shimmer-${qi}`)
  flipper.classList.add('lotl-flip')
  // Kick off the shimmer once the symbol side is facing the viewer.
  _lotlFlipTimers.push(setTimeout(() => {
    if (sh) { sh.classList.remove('go'); void sh.offsetWidth; sh.classList.add('go') }
  }, LOTL_FLIP_MS))
  // Flip back once the shimmer has run its course.
  _lotlFlipTimers.push(setTimeout(() => endCoinFlip(qi), LOTL_FLIP_MS + LOTL_SHIMMER_MS))
}

function endCoinFlip(qi) {
  const flipper = document.getElementById(`qflip-${qi}`)
  if (flipper) flipper.classList.remove('lotl-flip')
  const sh = document.getElementById(`lotl-shimmer-${qi}`)
  if (sh) sh.classList.remove('go')
}

// The prompt clears the moment the players enter their first vote outcome.
function dismissLotlPrompt() {
  if (_lotlPromptTimer) { clearTimeout(_lotlPromptTimer); _lotlPromptTimer = null }
  if (_lotlRepeatTimer) { clearInterval(_lotlRepeatTimer); _lotlRepeatTimer = null }
  _lotlFlipTimers.forEach(clearTimeout)
  _lotlFlipTimers = []
  for (let i = 2; i < 5; i++) endCoinFlip(i)
  if (gs.lotlPromptActive) { gs.lotlPromptActive = false; renderLotlBanner() }
}

function renderVoteTrack() {
  for (let i = 0; i < 5; i++) {
    const dot = document.getElementById(`vd-${i}`)
    dot.className = 'v-dot' + (i < gs.voteCount ? ' used' : '')
  }
}

function charDesc(role) {
  const c = settings.characters
  if (role === 'Merlin')   return c.mordred ? 'Knows all Evil except Mordred' : 'Knows all Evil'
  if (role === 'Percival') return c.morgana ? 'Sees Merlin and Morgana' : 'Sees Merlin'
  return CHAR_DESC[role] || ''
}

function renderCharPanel() {
  const panel = document.getElementById('char-panel')

  // Fingerprint the content so we only rebuild the DOM when something actually
  // changed. Pure open/close just toggles the `expanded` class, which lets the
  // CSS grid-template-rows transition animate in both directions.
  const fp = `${gs.players}|${JSON.stringify(settings.characters)}|${settings.abilities.lotl}|${settings.abilities.excalibur}`
  const contentChanged  = fp !== _charPanelFingerprint
  const panelJustOpened = gs.panelOpen && !_prevPanelOpen
  const panelJustClosed = !gs.panelOpen && _prevPanelOpen
  _charPanelFingerprint = fp
  _prevPanelOpen        = gs.panelOpen

  // Let viewport-fixed overlays (scroll quote, win reveal, death card) slide
  // along with the center column when the panel expands.
  document.body.classList.toggle('panel-open', gs.panelOpen)

  if (contentChanged) {
    panel.className = ''  // clear before rebuild; expanded added after if needed

    const roles = buildTeamRoles(gs.players, settings.characters)

    const addEntry = (container, name, color, descs) => {
      const entry = document.createElement('div')
      entry.className = 'cp-entry'
      const nameDiv = document.createElement('div')
      nameDiv.className = 'cp-name'
      nameDiv.style.color = color
      nameDiv.textContent = name
      entry.append(nameDiv)
      // Always keep descs in the DOM; CSS grid-template-rows controls visibility.
      if (descs.length > 0) {
        entry.classList.add('cp-has-desc')
        const wrap = document.createElement('div')
        wrap.className = 'cp-descs-wrap'
        for (const d of descs) {
          const descEl = document.createElement('div')
          descEl.className = 'cp-desc'
          descEl.textContent = d
          wrap.append(descEl)
        }
        entry.append(wrap)
      }
      container.append(entry)
    }

    const fillSection = (containerId, roleList) => {
      const el = document.getElementById(containerId)
      el.innerHTML = ''
      for (const role of roleList) {
        const hasDesc = role !== 'Loyal Servant' && role !== 'Minion' && charDesc(role)
        addEntry(el, role, ROLE_COLOR[role] || THEME.cream, hasDesc ? [charDesc(role)] : [])
      }
    }

    fillSection('good-chars', roles.good)

    if (isMorganaAssnMerged()) {
      const evilEl = document.getElementById('evil-chars')
      evilEl.innerHTML = ''
      addEntry(evilEl, 'Morgana/Assn', ROLE_COLOR['Morgana'],
        [charDesc('Morgana'), charDesc('Assassin')])
      for (const role of roles.evil.filter(r => r !== 'Morgana' && r !== 'Assassin')) {
        const hasDesc = role !== 'Minion' && charDesc(role)
        addEntry(evilEl, role, ROLE_COLOR[role] || THEME.cream, hasDesc ? [charDesc(role)] : [])
      }
    } else {
      fillSection('evil-chars', roles.evil)
    }

    // Abilities section
    const abilityEl = document.getElementById('ability-chars')
    abilityEl.innerHTML = ''
    const activeAbilities = []
    if (settings.abilities.lotl)      activeAbilities.push('Lady of the Lake')
    if (settings.abilities.excalibur) activeAbilities.push('Excalibur')
    if (activeAbilities.length > 0) {
      abilityEl.classList.remove('hidden')
      for (const name of activeAbilities) {
        const entry = document.createElement('div')
        entry.className = 'cp-entry'
        const nameDiv = document.createElement('div')
        nameDiv.className = 'cp-name cp-ability-name'
        nameDiv.textContent = name
        entry.append(nameDiv)
        const desc = charDesc(name)
        if (desc) {
          entry.classList.add('cp-has-desc')
          const wrap = document.createElement('div')
          wrap.className = 'cp-descs-wrap'
          const descEl = document.createElement('div')
          descEl.className = 'cp-desc'
          descEl.textContent = desc
          wrap.append(descEl)
          entry.append(wrap)
        }
        abilityEl.append(entry)
      }
    } else {
      abilityEl.classList.add('hidden')
    }

    // After rebuild, restore expanded state.
    // Use reflow trick only if the panel is freshly opening at the same time.
    if (gs.panelOpen) {
      if (panelJustOpened) void panel.offsetHeight
      panel.classList.add('expanded')
    }

  } else if (panelJustOpened) {
    // Content unchanged, panel opening: reflow so transition starts from 0fr.
    void panel.offsetHeight
    panel.classList.add('expanded')
  } else if (panelJustClosed) {
    // Content unchanged, panel closing: just remove the class — CSS transition
    // animates descriptions back to 0fr and width back to 200px.
    panel.classList.remove('expanded')
  }
  // No change at all: skip entirely so ongoing CSS transitions aren't disturbed.

  const tabHint = document.getElementById('char-tab-hint')
  if (tabHint) tabHint.textContent = gs.panelOpen ? '[C] hide descriptions' : '[C] expand'
}

function renderPhaseStatus() {
  const el = document.getElementById('phase-status')
  if (!el) return
  if (gs.phase === 'game') {
    const q = gs.currentQuest + 1
    el.textContent = gs.voting ? `Quest ${q}: Choose a team` : `Quest ${q}: Play your cards`
  } else {
    el.textContent = ''
  }
}

function renderHint() {
  const el = document.getElementById('hint')
  // Assassination guide drops to the low win-hint spot; game hints stay in flow.
  el.classList.toggle('hint-bottom', gs.phase === 'assassination')
  if (gs.phase === 'game') {
    if (gs.voting) {
      el.innerHTML =
        '<span class="hint-action">Input outcome of team vote</span>' +
        '<span class="hint-key">[S] pass / [F] fail</span>'
    } else {
      el.innerHTML =
        `<span class="hint-action">Input outcome of quest ${gs.currentQuest + 1}</span>` +
        '<span class="hint-key">[S] success / [F] fail</span>'
    }
  } else if (gs.phase === 'assassination') {
    el.innerHTML =
      '<span class="hint-key">[E] Evil wins&nbsp;&nbsp;&nbsp;[G] Good wins</span>'
  } else {
    el.innerHTML = ''
  }
}

function renderModal() {
  const modal = document.getElementById('game-modal')
  const death = document.getElementById('death-overlay')
  const bats  = document.getElementById('bat-swarm')

  // No win uses the old modal anymore — every win screen is a full reveal:
  //   assassination -> "MERLIN DIED" card (death-overlay);
  //   good / three failed quests -> win reveal (bat-swarm overlay).
  modal.classList.add('hidden')

  if (gs.phase === 'win') {
    // A reveal owns the screen; leave its overlay up, hide the other one.
    if (gs.merlin === 'died') { if (bats) bats.classList.add('hidden') }
    else                      { if (death) death.classList.add('hidden') }
  } else {
    if (death) death.classList.add('hidden')
    if (bats)  bats.classList.add('hidden')
  }
}

// True once [ESC] has dismissed the death card / win reveal to reveal the
// frozen game screen underneath.
let _merlinUnfaded = false
let _winUnfaded    = false

// Dark-Souls-style "MERLIN DIED" card. This IS the final screen on the
// assassination path — it fades in and stays up until [ENTER] → log.
function playMerlinDeath() {
  const overlay = document.getElementById('death-overlay')
  const text    = document.getElementById('death-text')
  const hint    = document.getElementById('death-hint')
  if (!overlay) return

  const EASE = 'cubic-bezier(.22,.61,.36,1)'
  _merlinUnfaded = false

  // Cancel any leftover animations, then reset to the pre-fade base state
  // synchronously so the text can't flash its previous end-state for a frame.
  ;[overlay, text, hint].forEach(el => el.getAnimations().forEach(a => a.cancel()))
  overlay.classList.remove('hidden', 'unfaded')
  hint.style.opacity = ''
  hint.innerHTML = '[ENTER] Continue&nbsp;&nbsp;&nbsp;&nbsp;[ESC] Return'

  // Freeze the top-bar shimmer so the whole frame is fully static.
  document.getElementById('timer-fill').style.animationPlayState = 'paused'

  // 1. screen darkens ('both' so it holds opacity 0 before it starts)
  overlay.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 1800, easing: EASE, fill: 'both' })

  // 2. text resolves from soft+zoomed to sharp ('both' holds the hidden first
  //    keyframe through the delay, preventing a one-frame flash)
  text.animate(
    [{ opacity: 0, transform: 'scale(1.15)', filter: 'blur(6px)' },
     { opacity: 1, transform: 'scale(1)',    filter: 'blur(0px)' }],
    { duration: 2800, delay: 500, easing: EASE, fill: 'both' })

  // 3. the [ENTER] Continue hint fades in once the card has settled
  hint.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 1800, delay: 3600, easing: 'ease-out', fill: 'both' })
}

// The shared win-reveal screen: EL verdict text fades in over a faded
// background, with the quests pushed down into the lower area. Evil (three
// failed quests) additionally erupts a bat swarm; good just brings the text in.
// The MERLIN DIED card is separate. team = 'evil' | 'good'.
function playWinReveal(team) {
  const overlay = document.getElementById('bat-swarm')
  const wash    = document.getElementById('bat-wash')
  const layer   = document.getElementById('bat-layer')
  const title   = document.querySelector('#bat-reveal .bat-title')
  const hint    = document.getElementById('bat-hint')
  if (!overlay) return

  const EASE        = 'cubic-bezier(.22,.61,.36,1)'
  const FLIGHT_EASE = 'cubic-bezier(.45,.05,.55,.95)'
  const rand = (a, b) => a + Math.random() * (b - a)
  const N = 250, pace = 1.8
  const bats = team === 'evil'

  _winUnfaded = false
  ;[overlay, wash, title, hint].forEach(el => el.getAnimations().forEach(a => a.cancel()))
  overlay.classList.remove('hidden', 'unfaded', 'evil', 'good')
  overlay.classList.add(team)
  title.innerHTML = bats ? 'Evil&nbsp;triumphs!' : 'Goodness&nbsp;prevails!'
  hint.style.opacity = ''
  hint.innerHTML = '[ENTER] Continue&nbsp;&nbsp;&nbsp;&nbsp;[ESC] Return'
  layer.innerHTML = ''
  document.getElementById('timer-fill').style.animationPlayState = 'paused'

  wash.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-out', fill: 'both' })

  if (bats) buildBatSwarm(layer, EASE, FLIGHT_EASE, rand, N, pace)

  // verdict text now starts with the bats (delay 0) and animates longer — it
  // was delayed 1000ms with a 1500ms grow, so a 2500ms grow finishes at the
  // same moment. Then the hint.
  const titleEnd   = 2500
  const startDelay = 1000
  title.animate(
    [{ opacity: 0, transform: 'scale(0.25)', filter: 'blur(6px)' },
     { opacity: 1, transform: 'scale(1)',    filter: 'blur(0px)' }],
    { duration: titleEnd, delay: startDelay, easing: EASE, fill: 'both' })
  hint.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: 1200, delay: startDelay + titleEnd - 300, easing: 'ease-out', fill: 'both' })
}

function buildBatSwarm(layer, EASE, FLIGHT_EASE, rand, N, pace) {
  const R = Math.max(window.innerWidth, window.innerHeight) * 0.72
  const frag = document.createDocumentFragment()
  const flights = []
  const tpl = document.createElement('div')
  tpl.className = 'bat'
  tpl.innerHTML = '<svg class="bat-svg" viewBox="0 0 800 600"><use href="#batsym"/></svg>'

  for (let i = 0; i < N; i++) {
    const bat = tpl.cloneNode(true)
    bat.querySelector('.bat-svg').style.setProperty('--flap', rand(0.20, 0.25).toFixed(3) + 's')
    frag.appendChild(bat)

    const scale = rand(0.35, 1.15)
    const angle = rand(0, Math.PI * 2)
    const dist  = R * rand(0.85, 1.25)
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist
    const tilt = rand(-20, 20)
    const bow  = rand(-0.22, 0.22)
    const mx = dx * 0.5 - Math.sin(angle) * dist * bow
    const my = dy * 0.5 + Math.cos(angle) * dist * bow
    const base = 'translate(-50%,-50%)'
    flights.push([bat, [
      { transform: `${base} translate(0,0) scale(${scale * 0.3}) rotate(${tilt}deg)`, opacity: 0 },
      { opacity: 1, offset: 0.08 },
      { transform: `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px)) scale(${scale}) rotate(${tilt}deg)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale * 1.1}) rotate(${tilt}deg)`, opacity: 1 }
    ], { duration: rand(1900, 2900) * pace, delay: rand(0, 400) * pace, easing: FLIGHT_EASE, fill: 'both' }])
  }
  layer.appendChild(frag)
  flights.forEach(([el, kf, opt]) => el.animate(kf, opt))
}

function renderAssassinationArea() {
  const header    = document.getElementById('assassination-header')
  const voteArea  = document.getElementById('vote-area')
  const questArea = document.getElementById('quest-area')
  const votes = document.getElementById('votes')
  // Quests shift down (and stale vote dots hide) during assassination AND on
  // every win reveal — opening the upper 0.618 space for the verdict text.
  const pushLayout = gs.phase === 'assassination' || gs.phase === 'win'
  // The "Assassination" header belongs only to the assassination phase itself
  // and the frozen MERLIN DIED screen.
  const showAssnHeader = gs.phase === 'assassination' ||
                         (gs.phase === 'win' && gs.merlin === 'died')

  voteArea.style.display = ''
  votes.style.display = pushLayout ? 'none' : ''
  questArea.classList.toggle('assn-pushed', pushLayout)

  if (showAssnHeader) {
    if (!header.classList.contains('visible')) {
      header.innerHTML = `
        <div class="assn-title">Assassination</div>
        <div class="assn-body">
          <div class="grad-line">Keep character cards hidden.</div>
          <div class="grad-line">Assassin may reveal their card and choose a target.</div>
        </div>
      `
      void header.offsetHeight  // force reflow so opacity/transform transitions start from initial values
      header.classList.add('visible')
    }
  } else {
    header.classList.remove('visible')
  }
}

function phaseElapsed() {
  return gs.questSecs - gs.questPhaseOffset
}

function phaseRef() {
  if (gs.voting) return gs.questAllotted[Math.min(gs.currentQuest, 4)]
  const size = gs.questSizes[gs.currentQuest]
  return questCardRef(size)
}

function updateTimerBar() {
  let elapsed, ref
  if (gs.phase === 'night') {
    elapsed = gs.totalSecs
    ref     = calcNightExpected()
  } else if (gs.phase === 'assassination') {
    elapsed = gs.totalSecs - gs.assnStart
    ref     = gs.assnRef
  } else {
    elapsed = phaseElapsed()
    ref     = phaseRef()
  }
  const frac     = elapsed / ref
  const goldPct  = Math.min(frac * 100, 100)
  document.getElementById('timer-fill').style.width = goldPct + '%'

  const otEl = document.getElementById('timer-overtime')
  if (elapsed > ref) {
    otEl.style.width = Math.min((elapsed - ref) / ref * 100, 100) + '%'
  } else {
    otEl.style.width = '0%'
  }

  const bar    = document.getElementById('timer-bar')
  const isOT   = elapsed > ref
  const isWarn = !isOT && frac >= 0.9
  if (gs.phase === 'game' || gs.phase === 'night' || gs.phase === 'assassination') {
    bar.classList.toggle('warning',  isWarn)
    bar.classList.toggle('overtime', isOT)
  } else {
    bar.classList.remove('warning', 'overtime')
  }

  // Bar clock: rides the fill's right edge counting down to 00:00,
  // then anchors to the right edge and counts up in red during overtime.
  const clock = document.getElementById('bar-clock')
  if (clock) {
    if (gs.phase === 'game' || gs.phase === 'night' || gs.phase === 'assassination') {
      if (isOT) {
        // Anchor at the right end; count up
        clock.classList.remove('tracking')
        clock.style.left = ''
        clock.classList.add('overtime')
        clock.textContent = '+' + fmt(elapsed - ref)
      } else {
        // Follow the fill edge; clamp so the text never clips past the right boundary
        clock.classList.add('tracking')
        clock.style.left = `min(${goldPct.toFixed(1)}%, calc(100% - 60px))`
        clock.classList.remove('overtime')
        clock.textContent = fmt(Math.max(0, ref - elapsed))
      }
    } else {
      clock.classList.remove('tracking', 'overtime')
      clock.style.left = ''
      clock.textContent = ''
    }
  }
}

function updateTotalTime() {
  const el = document.getElementById('total-time')
  if (el) el.textContent = fmt(gs.totalSecs)

  const ttEl = document.getElementById('sp-active-tt')
  const qtEl = document.getElementById('sp-active-qt')
  if (ttEl || qtEl) {
    const qi = gs.currentQuest
    if (ttEl) ttEl.textContent = gs.voting
      ? fmt(gs.questSecs)
      : fmt(gs.questVotingFrozen[qi])
    if (qtEl) qtEl.textContent = gs.voting
      ? `(${fmt(0)})`
      : `(${fmt(gs.questSecs - gs.questVotingFrozen[qi])})`
  }

  const nightEl = document.getElementById('sp-night-tt')
  if (nightEl) nightEl.textContent = fmt(gs.totalSecs)

  const assnTtEl = document.getElementById('sp-assn-tt')
  if (assnTtEl) assnTtEl.textContent = fmt(gs.totalSecs - gs.assnStart)
}

function fmt(secs) {
  const s = Math.round(secs)  // fractional carry-over values → whole seconds
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
}

// ── Input ────────────────────────────────────────────────────────────────────

// [Q] opens a quit-to-desktop prompt from anywhere (except while typing in a
// text field). While it's open it swallows all other input. Escape is now a
// contextual "back" that never quits.
let quitPromptOpen = false

function isTypingInField() {
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}
function openQuitPrompt() {
  quitPromptOpen = true
  document.getElementById('quit-modal').classList.remove('hidden')
}
function closeQuitPrompt() {
  quitPromptOpen = false
  document.getElementById('quit-modal').classList.add('hidden')
}

document.addEventListener('keydown', e => {
  if (e.repeat) return

  // Quit prompt has top priority: it swallows all input while open.
  if (quitPromptOpen) {
    e.preventDefault()
    if (e.key === 'q' || e.key === 'Q' || e.key === 'Enter') window.close()
    else if (e.key === 'Escape') closeQuitPrompt()
    return
  }
  // [Q] opens it — anywhere except while typing a name/target during logging.
  if ((e.key === 'q' || e.key === 'Q') && !isTypingInField()) {
    e.preventDefault()
    openQuitPrompt()
    return
  }

  // Escape = contextual "back" (quitting is [Q] now).
  if (e.key === 'Escape') {
    if (gs.phase === 'menu' && settings.menuPage === 'characters') {
      e.preventDefault()
      settings.menuPage = 'main'
      settings.menuRow  = 3
      renderOverlay()
      return
    }
    if (gs.phase === 'setup') {
      e.preventDefault()
      syncSeatsToPreGame()
      preGame.seating.forEach(nm => { if (nm) players.findOrCreate(nm) })
      gs.phase = setupReturnPhase
      renderOverlay()
      return
    }
    if (gs.phase === 'leader') {
      e.preventDefault()
      gs.phase = 'menu'
      renderOverlay()
      return
    }
    if (gs.phase === 'log') {
      e.preventDefault()
      captureLogDraft()   // preserve in-progress inputs for when the log reopens
      gs.phase = 'win'
      renderOverlay()
      renderModal()
      return
    }
    // MERLIN DIED screen: Escape dismisses the dark fade to reveal the frozen
    // game screen with an [ENTER] Log guide.
    if (gs.phase === 'win' && gs.merlin === 'died' && !_merlinUnfaded) {
      e.preventDefault()
      _merlinUnfaded = true
      const overlay = document.getElementById('death-overlay')
      const hint    = document.getElementById('death-hint')
      overlay.classList.add('unfaded')
      hint.getAnimations().forEach(a => a.cancel())
      hint.style.opacity = '1'
      hint.innerHTML = '[ENTER] Log'
      // Clear the frozen assassination guide so it doesn't sit under [ENTER] Log.
      document.getElementById('hint').innerHTML = ''
      return
    }
    // WIN REVEAL (good / three failed quests): Escape drops the wash + bats +
    // title to reveal the frozen board with an [ENTER] Log guide.
    if (gs.phase === 'win' && gs.merlin !== 'died' && !_winUnfaded) {
      e.preventDefault()
      _winUnfaded = true
      const overlay = document.getElementById('bat-swarm')
      const hint    = document.getElementById('bat-hint')
      overlay.classList.add('unfaded')
      hint.getAnimations().forEach(a => a.cancel())
      hint.style.opacity = '1'
      hint.innerHTML = '[ENTER] Log'
      return
    }
    return   // Escape no longer quits
  }

  if (e.key === 'c' || e.key === 'C') {
    gs.panelOpen = !gs.panelOpen
    renderCharPanel()
    renderSplitPanel()
    return
  }

  if (gs.phase === 'menu') {
    const numMap = {'5':5,'6':6,'7':7,'8':8,'9':9,'0':10}

    if (settings.menuPage === 'main') {
      const SELECTABLE = 8  // players, speed, length, characters, lotl, excalibur, setup, start
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        settings.menuRow = (settings.menuRow - 1 + SELECTABLE) % SELECTABLE
        renderOverlay()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        settings.menuRow = (settings.menuRow + 1) % SELECTABLE
        renderOverlay()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        applyMenuChange(settings.menuRow, e.key === 'ArrowRight' ? 1 : -1)
      } else if (numMap[e.key] !== undefined) {
        setMenuPlayers(numMap[e.key])
      } else if (e.key === 'Enter') {
        if (settings.menuRow === 3) {
          // Open characters submenu
          settings.menuPage = 'characters'
          settings.menuRow  = 0
          renderOverlay()
        } else if (settings.menuRow === 6) {
          // Open the add-names (seating) screen
          setupReturnPhase = 'menu'
          gs.phase = 'setup'
          renderOverlay()
        } else if (settings.menuRow === 7) {
          startGameFromMenu()
        }
      }

    } else if (settings.menuPage === 'characters') {
      const SELECTABLE = 7  // merlin, percival, assassin, morgana, oberon, mordred, back
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        settings.menuRow = (settings.menuRow - 1 + SELECTABLE) % SELECTABLE
        renderOverlay()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        settings.menuRow = (settings.menuRow + 1) % SELECTABLE
        renderOverlay()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        applyMenuChange(settings.menuRow, 1)
      }
    }

  } else if (gs.phase === 'night') {
    if (e.key === 'Enter') {
      gs.nightSecs = gs.totalSecs
      gs.phase = 'game'
      sidebarAnimatePending = true  // slide in Quest 1 target row
      sidebarPop = { type: 'night' }  // pop the night time that just froze
      gameLogs.recordNightEnd(gs.nightSecs)

      // Carry-over: redistribute night spare/overtime to all quest discussions proportionally
      const nightDelta = calcNightExpected() - gs.nightSecs
      if (nightDelta !== 0) {
        for (let j = 0; j < 5; j++) {
          gs.questAllotted[j] = Math.max(0,
            gs.questAllotted[j] + nightDelta * (QUEST_ALLOTTED_BASE[j] / QUEST_ALLOTTED_SUM)
          )
        }
      }

      resetTimerBar()
      music.playPreloaded('a', { fallbackFolder: 'Round 1' })
      logEvent('Quest 1 begins')
      render()
    }

  } else if (gs.phase === 'leader') {
    if (e.key === 'Enter') {
      e.preventDefault()
      leaderContinue()
    } else if ((e.key === ' ' || e.key === 'Spacebar') && !isTypingInField()) {
      e.preventDefault()
      leaderRandomize()
    } else if ((e.key === 'p' || e.key === 'P') && !isTypingInField()) {
      e.preventDefault()
      leaderAddPlayers()
    }

  } else if (gs.phase === 'game') {
    if (gs.voting) {
      // First vote outcome (pass or reject) clears the Lady-of-the-Lake prompt.
      if (e.key === 's' || e.key === 'S' || e.key === 'f' || e.key === 'F') dismissLotlPrompt()
      if (e.key === 's' || e.key === 'S') {
        const qi = gs.currentQuest
        gs.voting                = false
        gameLogs.recordVotePass(qi, gs.voteCount)
        gs.questVotingFrozen[qi] = gs.questSecs
        gs.questPhaseOffset      = gs.questSecs
        renderPhaseStatus()
        renderVoteTrack()
        renderQuests()
        renderHint()
        const wrap   = document.getElementById(`qw-${qi}`)
        if (wrap) {
          wrap.classList.remove('vote-locking')
          toggleArcClass(qi, 'vote-locking', false)
          void wrap.offsetWidth
          wrap.classList.add('vote-locking')
          toggleArcClass(qi, 'vote-locking', true)
          setTimeout(() => {
            wrap.classList.remove('vote-locking')
            toggleArcClass(qi, 'vote-locking', false)
          }, 600)
        }
        logEvent(`Q${qi + 1} vote pass`)
        sidebarPop = { type: 'freeze' }  // pop the row whose voting timer just froze
        renderSplitPanel()  // no render() follows here, so update panel explicitly
        // Card-phase music: snap to a fresh track from the same round folder
        music.fadeToFolder(`Round ${qi + 1}`, 400)
        // Pre-buffer both possible outcome tracks for the upcoming S/F keypress
        const successFolder = gs.successCount === 2 ? 'Assassination' : 'After success'
        const failFolder    = gs.failCount === 0 ? 'After 1st fail'
                            : gs.failCount === 1 ? 'After 2nd fail'
                            : 'Evil songs'
        music.preloadDual(successFolder, failFolder)
      } else if (e.key === 'f' || e.key === 'F') {
        if (gs.voteCount < 5) {
          const dotIndex = gs.voteCount
          gs.voteCount++
          renderVoteTrack()
          const dot = document.getElementById(`vd-${dotIndex}`)
          if (dot) {
            dot.classList.add('marking')
            setTimeout(() => dot.classList.remove('marking'), 350)
          }
        }
      }
    } else {
      if      (e.key === 's' || e.key === 'S') resolveQuest('success')
      else if (e.key === 'f' || e.key === 'F') resolveQuest('fail')
    }

  } else if (gs.phase === 'assassination') {
    if (e.key === 'g' || e.key === 'G') {
      gs.assnSecs    = gs.totalSecs - gs.assnStart
      gs.assnEndTime = gs.totalSecs
      gs.merlin      = 'survived'
      gs.phase       = 'win'
      gameLogs.recordAssassination(gs.assnSecs)
      gameLogs.finalizeGoodWin(gs.totalSecs)
      gameLogs.save()
      music.playPreloaded('a', { fallbackFolder: 'Good songs' })
      logEvent('Merlin survived')
      sidebarPop = { type: 'assn' }  // pop the assassination time that just froze
      render()               // drop the assassination header, keep quests pushed
      playWinReveal('good')  // "Goodness prevails" fades in — no bats
    } else if (e.key === 'e' || e.key === 'E') {
      gs.assnSecs    = gs.totalSecs - gs.assnStart
      gs.assnEndTime = gs.totalSecs
      gs.merlin      = 'died'
      gs.phase       = 'win'
      gameLogs.recordAssassination(gs.assnSecs)
      gameLogs.finalizeEvilWin('merlin-killed', gs.totalSecs)
      gameLogs.save()
      music.playPreloaded('b', { fallbackFolder: 'Evil songs' })
      logEvent('Merlin killed')
      // Deliberately skip render() so the assassination frame stays frozen
      // underneath — the death card just fades in over it. Still refresh just the
      // split panel so the assassination time freezes and pops (the death screen
      // only slightly darkens it, which is fine).
      sidebarPop = { type: 'assn' }
      renderSplitPanel()
      playMerlinDeath()
    }

  } else if (gs.phase === 'win') {
    // Every win screen is a reveal now (MERLIN DIED card / good / evil).
    // [ENTER] or [L] → log; [ESC] unfade is handled in the top-level Escape block.
    if (e.key === 'Enter' || e.key === 'l' || e.key === 'L') {
      gs.phase = 'log'
      render()
    }
  }
})

function _submitLog() {
  // Hard block: the same player name entered in two seats.
  if (hasDuplicateNames()) {
    document.getElementById('log-dup-warning')?.classList.add('show')
    document.getElementById('overlay-body')?.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  document.getElementById('log-dup-warning')?.classList.remove('show')
  // Guard: if the entered characters don't match the settings line-up, warn once
  // (surface the roster + red banner) before allowing an intentional mismatch through.
  if (logCharMismatch() && !_logCharWarned) {
    _logCharWarned = true
    document.getElementById('log-char-warning')?.classList.add('show')
    document.getElementById('overlay-body')?.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  const roster = buildRosterFromDOM()
  if (roster.length) gameLogs.setRoster(roster)
  const balEl     = document.getElementById('log-balance')
  const conEl     = document.getElementById('log-conf')
  const targetEl  = document.getElementById('log-assn-target')
  const notesEl   = document.getElementById('log-notes')
  if (balEl?.classList.contains('touched'))  gameLogs.setBalance(parseInt(balEl.value))
  if (conEl?.classList.contains('touched'))  gameLogs.setAssassinConfidence(parseInt(conEl.value))
  gameLogs.setAssassinationTarget(targetEl?.value?.trim() || '')
  // Seating + first leader (optional) — derives the initial LotL token holder
  syncSeatsToPreGame()
  if (preGame.seating.some(Boolean)) gameLogs.setSeating(preGame.seating.slice(0, gs.players))
  const flText = document.getElementById('log-first-leader')?.value?.trim()
  if (flText) gameLogs.setFirstLeader(/^\d+$/.test(flText) ? Number(flText) : flText)
  gameLogs.setNotes(notesEl?.value?.trim() || '')
  gameLogs.save()
  logDraft = null              // game logged — discard the in-progress draft
  logChainDone = false         // re-arm the character auto-open chain for next game
  preGame.firstLeader = null   // re-roll next game; seating persists for the table
  settings.menuRow  = 0
  settings.menuPage = 'main'
  gs = newGame(gs.players)
  resetTimerBar()
  music.fadeToFolder('Main menu')
  render()
}

function resolveQuest(result) {
  const i        = gs.currentQuest
  const elapsed  = gs.questSecs
  const allotted = gs.questAllotted[i]
  const delta    = allotted - elapsed  // positive = spare, negative = overtime

  gs.results[i]       = result
  gs.questTimes[i]    = phaseElapsed()
  gs.questEndTimes[i] = gs.totalSecs
  gameLogs.recordQuestEnd(i, result, gs.questTimes[i], gs.questVotingFrozen[i], gs.questEndTimes[i])
  gs.questSecs        = 0
  gs.questPhaseOffset = 0

  // ── Carry-over ──────────────────────────────────────────────────────────
  // Distribute spare/overtime proportionally across remaining quest discussions,
  // using the same base ratios as the initial allotment. Card times are untouched.
  if (delta !== 0 && i < 4) {
    const remainingSum = QUEST_ALLOTTED_BASE.slice(i + 1).reduce((s, w) => s + w, 0)
    for (let j = i + 1; j <= 4; j++) {
      gs.questAllotted[j] = Math.max(0,
        gs.questAllotted[j] + delta * (QUEST_ALLOTTED_BASE[j] / remainingSum)
      )
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  toggleArcClass(i, 'overtime', false)
  toggleArcClass(i, 'warning',  false)

  if (result === 'success') gs.successCount++
  else                       gs.failCount++

  gs.currentQuest++
  gs.voteCount = 0
  gs.voting = true
  sidebarAnimatePending = true
  sidebarPop = { type: 'resolve', index: i }  // pop the row that just flipped red/blue

  logEvent(`Q${i + 1} ${result}`)

  if (gs.successCount >= 3) {
    gs.phase     = 'assassination'
    gs.assnStart = gs.totalSecs
    music.playPreloaded('a', { fallbackFolder: 'Assassination' })
    music.preloadDual('Good songs', 'Evil songs')  // pre-buffer for G/E keypress
    logEvent('Assassination')
    render()
    return
  }
  if (gs.failCount >= 3) {
    gs.phase = 'win'
    gameLogs.finalizeEvilWin('quests-failed', gs.totalSecs)
    gameLogs.save()
    music.playPreloaded('b', { fallbackFolder: 'Evil songs' })
    logEvent('Evil wins')
    render()             // show the resolved 3rd fail + push the quests down
    playWinReveal('evil') // bats erupt over the board → "Evil triumphs"
    return
  }

  // Outcome track plays once (one-shot), then fades into the next round's voting music
  const _nextRound  = `Round ${gs.currentQuest + 1}`
  const _slot       = result === 'success' ? 'a' : 'b'
  const _fallback   = result === 'success' ? 'After success'
                    : gs.failCount === 1   ? 'After 1st fail'
                    : 'After 2nd fail'
  music.playPreloaded(_slot, { oneShot: true, nextFolder: _nextRound, fallbackFolder: _fallback })
  logEvent(`Quest ${gs.currentQuest + 1} begins`)
  render()

  // Quests 3/4/5 (index 2/3/4) each carry a Lady-of-the-Lake check at their start.
  if (settings.abilities.lotl && gs.currentQuest >= 2) {
    scheduleLotlPrompt(gs.currentQuest)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

buildStaticDOM()
// Wait for custom fonts before first draw so numbers render in EnchantedLand
document.fonts.ready.then(() => {
  render()
  music.playFolder('Main menu')
})
