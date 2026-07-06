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
    accentBrt:  v('--accent-brt'),
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
// assnFraction = 0.10 × poolFactor × evilFactor
function calcAssnFraction() {
  const evilCount   = settings.players <= 6 ? 2 : settings.players <= 9 ? 3 : 4
  const goodCount   = settings.players - evilCount
  const pool        = goodCount + (settings.characters.oberon ? OBERON_POOL_WEIGHT : 0)
  const poolFactor  = Math.sqrt(pool / ASSN_POOL_REF)
  const evilPct     = evilCount / settings.players
  const evilFactor  = ASSN_EVIL_PCT_REF / evilPct
  return 0.10 * poolFactor * evilFactor
}

// Returns the discussion-only budget in seconds for the current settings.
// Assassination gets the same duration as quest Q3 (saga/slow/normal), Q2 (fast), or Q1 (speedrun).
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
// the latest typed values in other inputs.
function attachLogAutocomplete(input, getOptions) {
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

  function showDropdown(opts) {
    removeDropdown()
    if (!opts.length) return
    const rect = input.getBoundingClientRect()
    dropdown = document.createElement('div')
    dropdown.className = 'log-autocomplete'
    dropdown.style.top   = rect.bottom + 'px'
    dropdown.style.left  = rect.left   + 'px'
    dropdown.style.width = rect.width  + 'px'
    opts.forEach(opt => {
      const item = document.createElement('div')
      item.className = 'log-ac-item'
      item.textContent = opt
      item.addEventListener('mousedown', e => {
        e.preventDefault()
        input.value = opt
        removeDropdown()
        input.dispatchEvent(new Event('input'))
      })
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

  // ▾ button: toggle all-options dropdown
  if (btn) {
    btn.addEventListener('mousedown', e => {
      e.preventDefault()               // keep input focused
      if (dropdown) {
        removeDropdown()
      } else {
        const opts = getOptions()
        if (opts.length) {
          _skipNextFocus = true         // suppress the focus-triggered refresh
          showDropdown(opts)
          input.focus()
        }
      }
    })
  }

  input.addEventListener('input', refresh)
  input.addEventListener('focus', () => {
    if (_skipNextFocus) { _skipNextFocus = false; return }
    refresh()
  })
  input.addEventListener('blur', () => setTimeout(removeDropdown, 120))

  input.addEventListener('keydown', e => {
    if (!dropdown) return
    const items = [...dropdown.querySelectorAll('.log-ac-item')]
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      focusedIdx = Math.min(focusedIdx + 1, items.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      focusedIdx = Math.max(focusedIdx - 1, -1)
    } else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault(); e.stopPropagation()
      input.value = items[focusedIdx].textContent
      removeDropdown()
      input.dispatchEvent(new Event('input'))
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      removeDropdown()
    }
    items.forEach((el, i) => el.classList.toggle('focused', i === focusedIdx))
    if (focusedIdx >= 0) items[focusedIdx].scrollIntoView({ block: 'nearest' })
  })
}

function buildLogHTML() {
  const roles = buildTeamRoles(gs.players, settings.characters)

  function rosterSection(roleList, startIdx) {
    const rows = roleList.map((role, i) => {
      const color = ROLE_COLOR[role] || THEME.cream
      return `
      <div class="log-roster-row">
        <span class="log-role-name" style="color:${color}">${role}</span>
        <div class="log-input-wrap">
          <input type="text" class="log-player-input"
                 data-roster-idx="${startIdx + i}" placeholder="—" autocomplete="off" spellcheck="false">
          <button class="log-ac-btn" tabindex="-1">▾</button>
        </div>
      </div>`
    }).join('')
    return `<div class="log-roster">${rows}</div>`
  }

  const characterSection = `<div class="log-section-hd">Characters</div>
    ${rosterSection(roles.good, 0)}
    ${rosterSection(roles.evil, roles.good.length)}`

  const balanceHTML = `
    <div class="log-field">
      <div class="log-field-label">Game balance</div>
      <div class="log-scale-row">
        <span class="log-scale-cap">Evil</span>
        <input type="range" id="log-balance" class="log-range" min="-3" max="3" step="1" value="0">
        <span class="log-scale-cap">Good</span>
      </div>
      <div class="log-scale-desc" id="log-balance-desc">—</div>
    </div>`

  const confHTML = gs.assnStart > 0 ? `
    <div class="log-field">
      <div class="log-field-label">Assassin confidence</div>
      <div class="log-scale-row">
        <span class="log-scale-cap">Guess</span>
        <input type="range" id="log-conf" class="log-range" min="1" max="5" step="1" value="3">
        <span class="log-scale-cap">Certain</span>
      </div>
      <div class="log-scale-desc" id="log-conf-desc">—</div>
    </div>` : ''

  const targetHTML = gs.merlin === 'survived' ? `
    <div class="log-field">
      <div class="log-field-label">Assassination target</div>
      <div class="log-input-wrap">
        <input type="text" id="log-assn-target" class="log-player-input"
               placeholder="—" autocomplete="off" spellcheck="false">
        <button class="log-ac-btn" tabindex="-1">▾</button>
      </div>
    </div>` : ''

  const newPlayersHTML = `
    <div class="log-field">
      <div class="log-field-label">New to the game</div>
      <div class="log-new-row">
        <span class="log-sub-label">Good</span>
        <div class="log-num-wrap">
          <input type="number" id="log-new-good" class="log-num" min="0" max="${gs.players}" placeholder="—">
          <div class="log-num-btns">
            <button class="log-num-btn" data-delta="1" tabindex="-1">▲</button>
            <button class="log-num-btn" data-delta="-1" tabindex="-1">▼</button>
          </div>
        </div>
        <span class="log-sub-label">Evil</span>
        <div class="log-num-wrap">
          <input type="number" id="log-new-evil" class="log-num" min="0" max="${gs.players}" placeholder="—">
          <div class="log-num-btns">
            <button class="log-num-btn" data-delta="1" tabindex="-1">▲</button>
            <button class="log-num-btn" data-delta="-1" tabindex="-1">▼</button>
          </div>
        </div>
      </div>
    </div>`

  const notesHTML = `
    <div class="log-field">
      <div class="log-field-label">Notes</div>
      <textarea id="log-notes" class="log-textarea" placeholder="(optional)" rows="2"></textarea>
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
    ${newPlayersHTML}
    <div class="log-sep"></div>
    ${notesHTML}
    <button id="log-submit" class="log-submit-btn">Submit &amp; return to main menu</button>
    <div class="log-bottom-pad"></div>`
}

function buildRosterFromDOM() {
  const roles    = buildTeamRoles(gs.players, settings.characters)
  const allRoles = [
    ...roles.good.map(r => ({ role: r, team: 'good' })),
    ...roles.evil.map(r => ({ role: r, team: 'evil' })),
  ]
  const roster = []
  allRoles.forEach((item, idx) => {
    const input = document.querySelector(`[data-roster-idx="${idx}"]`)
    const name = input?.value?.trim() || ''
    if (!name) return
    players.findOrCreate(name)
    roster.push({ name, team: item.team, role: item.role })
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

function makeDagger() {
  const el = document.createElement('span')
  el.className = 'sp-dagger'
  return el
}

function renderSplitPanel() {
  const panel = document.getElementById('split-panel')

  // Consume the animation flag immediately so it's always reset,
  // even if no new target row ends up being rendered (e.g. game-over state).
  const animateTarget = sidebarAnimatePending
  sidebarAnimatePending = false

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
    labelEl.className = 'sp-label'
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

  // Total time header
  const totalEntry = document.createElement('div')
  totalEntry.className = 'sp-entry'
  const totalLabel = document.createElement('span')
  totalLabel.className = 'sp-label sp-label-active'
  totalLabel.textContent = 'TOTAL'
  const totalTimeEl = document.createElement('span')
  totalTimeEl.id = 'total-time'
  totalTimeEl.textContent = fmt(gs.totalSecs)
  totalEntry.append(totalLabel, totalTimeEl)
  panel.append(totalEntry)

  const topSep = document.createElement('div')
  topSep.className = 'sp-sep'
  panel.append(topSep)

  const splitsWrap = document.createElement('div')
  splitsWrap.className = 'sp-splits-wrap'

  // Frozen night entry — shown once night phase is complete
  if (gs.nightSecs > 0) {
    const entry = document.createElement('div')
    entry.className = 'sp-entry'
    const label = document.createElement('span')
    label.className = 'sp-label sp-label-active sp-mono-label'
    label.textContent = 'Nite'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
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
    label.className = 'sp-label sp-label-active sp-mono-label'
    label.textContent = 'Nite'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
    timeEl.innerHTML = `<span id="sp-night-tt">${fmt(gs.totalSecs)}</span>`
    entry.append(label, timeEl)
    splitsWrap.append(entry)

    // Night Target row
    const targetEntry = document.createElement('div')
    targetEntry.className = 'sp-entry sp-target' + (animateTarget ? ' sp-future' : '')
    targetEntry.innerHTML =
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">target:</span>` +
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
    entry.innerHTML = `<span class="sp-label sp-q-label" style="color:${col}">Q${i + 1}</span>` +
      `<span class="sp-time" style="color:var(--accent)">${fmt(votingDur)}</span>` +
      `<span class="sp-split" style="color:var(--accent)">(${fmt(cardDur)})</span>`
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
    if (!gs.voting) timeWrap.style.color = 'var(--accent)'

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
    if (!gs.voting) qtSpan.style.color = 'var(--sb-val)'

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
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">target:</span>` +
      `<span class="sp-time" style="color:var(--dim)">${fmt(votingAlloc)}</span>` +
      `<span class="sp-split">(${fmt(cardAlloc)})</span>`
    splitsWrap.append(entry)
  }

  // Projected schedule: each upcoming phase as a target timestamp —
  // "what should the total-time clock read when this phase is done?"
  {
    const firstFuture = gs.phase === 'menu' || gs.phase === 'night' ? 0
                      : gs.phase === 'game' ? gs.currentQuest + 1 : 5
    let cursor
    if (gs.phase === 'menu') {
      // Full pre-game preview: show NIGHT target first, then quests
      cursor = calcNightExpected()
      splitsWrap.append(budgetEntry('Night', cursor))
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
    labelEl.className = 'sp-label sp-mono-label'
    labelEl.textContent = 'Assn'
    const timeEl = document.createElement('span')
    timeEl.className = 'sp-time'
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
    timerLabel.className = 'sp-label sp-label-active sp-mono-label'
    timerLabel.textContent = 'Assn'
    const timeWrap = document.createElement('span')
    timeWrap.className = 'sp-time'
    const ttSpan = document.createElement('span')
    ttSpan.id = 'sp-assn-tt'
    ttSpan.textContent = fmt(gs.totalSecs - gs.assnStart)
    timeWrap.append(ttSpan)
    timerEntry.append(timerLabel, timeWrap)
    splitsWrap.append(timerEntry)

    const assnTarget = document.createElement('div')
    assnTarget.className = 'sp-entry sp-target' + (animateTarget ? ' sp-future' : '')
    assnTarget.innerHTML =
      `<span class="sp-label sp-mono-label" style="font-size:11px;letter-spacing:0.5px">target:</span>` +
      `<span class="sp-time" style="color:var(--dim)">${fmt(gs.assnRef)}</span>`
    splitsWrap.append(assnTarget)
  }

  // Assassination budget lookahead — shown when not yet reached and Merlin is in play
  if ((gs.phase === 'menu' || gs.phase === 'night' || gs.phase === 'game') && settings.characters.merlin) {
    splitsWrap.append(budgetEntry('Assn', calcAssnBudget() - calcQ5TargetEnd()))
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
  const FONT      = 'Franken, Georgia, serif'
  const BASE_SIZE = 43
  const HALF_PER  = 72      // half wave period — zero-crossings at multiples of this
  const Y         = 58
  const AMP       = 3
  const PERIOD    = 144

  const tp   = document.getElementById('quote-wave-tp')
  const rect = document.getElementById('quote-rect')
  if (!tp || !rect) return

  const text = tp.textContent.trim()

  // Measure text width, then round up to nearest half-period so the right edge
  // lands on a wave zero-crossing and the seam matches the scroll PNG images.
  const span = document.createElement('span')
  span.style.cssText = `position:fixed;top:-9999px;left:-9999px;white-space:nowrap;` +
                       `font-family:${FONT};font-size:${BASE_SIZE}px;`
  span.textContent = text
  document.body.appendChild(span)
  const measured = span.getBoundingClientRect().width
  document.body.removeChild(span)

  const bestSize = BASE_SIZE
  // Scroll images sit on top (z-index 4), hiding the seam — no need to align
  // the right edge to a wave zero-crossing, so use exact measured width.
  const textW  = Math.ceil(measured + 4)   // +4 px safety buffer — tight fit around the text
  const END_PAD = 14                       // extra blank scroll between text and the right cap
  const bestW  = textW + END_PAD

  // Apply font size and rect width
  tp.parentElement.setAttribute('font-size', bestSize)
  rect.style.width    = bestW + 'px'
  rect.style.minWidth = 'unset'
  // Anchor text at the tight-fit centre (not bestW's centre) so the extra
  // END_PAD only opens up space on the right, before the scroll cap.
  tp.setAttribute('startOffset', textW / 2)

  // Dynamic right margin: find the overlap value (in [0, rightImgW]) that places
  // the right junction at a wave zero-crossing (x % 72 = 0), so the parchment
  // top/bottom edges are always at their baseline height where they meet the scroll cap.
  const RIGHT_IMG_W  = 50
  const RIGHT_BASE   = 18
  const HALF_PER_DYN = 72
  const refJunction  = bestW - RIGHT_BASE
  const crossings = [
    Math.floor(refJunction / HALF_PER_DYN) * HALF_PER_DYN,
    Math.ceil(refJunction  / HALF_PER_DYN) * HALF_PER_DYN,
  ]
  let rightMargin = RIGHT_BASE, bestDiff = Infinity
  for (const c of crossings) {
    const m = bestW - c
    if (m >= 0 && m <= RIGHT_IMG_W) {
      const diff = Math.abs(m - RIGHT_BASE)
      if (diff < bestDiff) { bestDiff = diff; rightMargin = m }
    }
  }
  const scrollRight = document.querySelector('.scroll-img-right')
  if (scrollRight) scrollRight.style.marginLeft = -rightMargin + 'px'

  // Keep the valley-shade seam fade boundary in sync with the dynamic margin.
  const valleyShade = document.querySelector('.quote-valley-shade')
  if (valleyShade) {
    const mask = `linear-gradient(to right, transparent 20px, black 80px, black calc(100% - 80px), transparent calc(100% - ${rightMargin}px))`
    valleyShade.style.webkitMaskImage = mask
    valleyShade.style.maskImage       = mask
  }

  // Position the floating text SVG (sibling of parchment) to overlay it exactly.
  // It sits outside the masked parchment div so it renders above the scroll images.
  const textSvg = document.querySelector('.quote-text-svg')
  if (textSvg) {
    const sqBounds   = document.getElementById('scroll-quote').getBoundingClientRect()
    const rectBounds = rect.getBoundingClientRect()
    textSvg.style.left  = (rectBounds.left - sqBounds.left + 8) + 'px'
    textSvg.setAttribute('width',  bestW)
    textSvg.setAttribute('height', '100')
  }

  // Build wave path — runs the full padded bestW; text stops short of the end
  // because startOffset is pinned to textW's centre (see above), leaving END_PAD blank.
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
        return `<div class="${cls}"><span class="menu-row-label">${labelInner}</span>` +
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
        { key: 'start',     label: 'START GAME',        value: '▸', isOn: true },
      ]
      setBody('menu-main', `
        <div class="ov-title grad-title">Avalon</div>
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
        <div class="ov-title grad-title" style="font-family:'Franken',Georgia,serif; font-size:56px; letter-spacing:2px">Characters</div>
        <div class="ov-rule" style="margin:16px 0"></div>
        <div class="menu-settings">${buildMenuHTML(rowDefs)}</div>
      `)
      hint.textContent = '[↑↓] select   [←→] toggle   [ESC] back'
    }

  } else if (gs.phase === 'night') {
    overlay.classList.remove('hidden')
    overlay.classList.add('overlay-raised')
    setBody('night', `
      <div class="ov-title grad-title" style="font-family:'Franken',Georgia,serif; font-size:120px; letter-spacing:4px">Night phase</div>
      <div class="ov-rule"></div>
      <div class="ov-body">
        Memorise your character card.<br>
        Close your eyes.<br>
        Form a fist in front of you.<br>
        Listen for further instructions.
      </div>
    `)
    hint.textContent = '[ENTER] continue'

  } else if (gs.phase === 'log') {
    overlay.classList.remove('hidden')
    overlay.classList.remove('overlay-raised')
    body.classList.add('log-active')
    setBody('log', buildLogHTML())
    // Spinner buttons for new-player count inputs
    body.addEventListener('click', e => {
      const btn = e.target.closest('.log-num-btn')
      if (!btn) return
      const input = btn.closest('.log-num-wrap')?.querySelector('input')
      if (!input) return
      const delta = parseInt(btn.dataset.delta)
      const max   = parseInt(input.max) || Infinity
      const min   = parseInt(input.min) || 0
      input.value = Math.min(max, Math.max(min, (parseInt(input.value) || 0) + delta))
    })
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
    }
    if (conEl) {
      const updateConf = () => {
        conEl.classList.add('touched')
        const el = document.getElementById('log-conf-desc')
        if (el) { el.style.color = 'var(--accent-brt)'; el.textContent = `${conEl.value} · ${CONFIDENCE_LABELS[conEl.value]}` }
      }
      conEl.addEventListener('input', updateConf)
      conEl.addEventListener('click', updateConf)
    }

    // Autocomplete for roster and assassination target inputs
    const _logRoles = buildTeamRoles(gs.players, settings.characters)

    function _getPlayerOptions() {
      const known = new Set(players.getAll())
      document.querySelectorAll('[data-roster-idx]').forEach(el => {
        const v = el.value.trim(); if (v) known.add(v)
      })
      return [...known]
    }

    function _getAssnTargetOptions() {
      const names = []
      _logRoles.good.forEach((role, i) => {
        if (role === 'Merlin') return
        const inp = document.querySelector(`[data-roster-idx="${i}"]`)
        const name = inp?.value?.trim()
        if (name) names.push(name)
      })
      return names
    }

    document.querySelectorAll('[data-roster-idx]').forEach(input => {
      attachLogAutocomplete(input, _getPlayerOptions)
      input.addEventListener('blur', () => {
        const name = input.value.trim()
        if (name) players.findOrCreate(name)
      })
    })

    const assnTargetEl = document.getElementById('log-assn-target')
    if (assnTargetEl) attachLogAutocomplete(assnTargetEl, _getAssnTargetOptions)

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
  const box   = document.getElementById('gm-box')
  const death = document.getElementById('death-overlay')

  // Assassination path: the "MERLIN DIED" card (driven by playMerlinDeath)
  // is the whole win screen — no modal.
  if (gs.phase === 'win' && gs.merlin === 'died') {
    modal.classList.add('hidden')
    return
  }
  // Any other screen: ensure a lingering death card is cleared.
  if (death) death.classList.add('hidden')

  if (gs.phase === 'win') {
    modal.classList.remove('hidden')
    const evil   = gs.failCount >= 3
    const time   = fmt(gs.totalSecs)
    const reason = evil ? 'Three quests failed.' : 'Merlin remains hidden.'
    const title  = evil ? 'Evil triumphs' : 'Goodness prevails'
    box.className = `gm-box ${evil ? 'evil-win' : 'good-win'}`
    box.innerHTML = `
      <div class="gm-title" style="color:${evil ? 'var(--evil-txt)' : 'var(--good-txt)'}; font-family:'Franken',Georgia,serif">
        ${title}
      </div>
      <div class="gm-rule" style="background:${evil ? 'var(--evil-edge)' : 'var(--good-edge)'}"></div>
      <div class="gm-body" style="font-family:'Franken',Georgia,serif">${reason}</div>
      <div class="gm-time">Game time: ${time}</div>
      <div class="gm-hint">[ENTER] new game   [L] log</div>
    `
  } else {
    modal.classList.add('hidden')
  }
}

// True once [ESC] has dismissed the death card to reveal the frozen screen.
// A second [ESC] then quits, rather than re-fading.
let _merlinUnfaded = false

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

function renderAssassinationArea() {
  const header    = document.getElementById('assassination-header')
  const voteArea  = document.getElementById('vote-area')
  const questArea = document.getElementById('quest-area')
  // The frozen "MERLIN DIED" screen keeps the assassination layout underneath.
  const keepAssnLayout = gs.phase === 'assassination' ||
                         (gs.phase === 'win' && gs.merlin === 'died')
  const votes = document.getElementById('votes')
  if (keepAssnLayout) {
    // Keep vote-area visible so the bottom #hint bar can show the assassination
    // guide, but hide the stale vote dots from the last quest.
    voteArea.style.display = ''
    votes.style.display = 'none'
    if (!header.classList.contains('visible')) {
      header.innerHTML = `
        <div class="assn-title">Assassination</div>
        <div class="assn-rule"></div>
        <div class="assn-body">Keep character cards hidden.<br>Assassin may reveal their card and choose a target.</div>
      `
      void header.offsetHeight  // force reflow so opacity/transform transitions start from initial values
      header.classList.add('visible')
      questArea.classList.add('assn-pushed')
    }
  } else {
    header.classList.remove('visible')
    questArea.classList.remove('assn-pushed')
    voteArea.style.display = ''
    votes.style.display = ''
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
    if (gs.phase === 'log') {
      e.preventDefault()
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
      const SELECTABLE = 7  // players, speed, length, characters, lotl, excalibur, start
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
          // Start game
          gs.phase = 'night'
          sidebarAnimatePending = true   // slide in the night Target row
          music.resetSession()
          music.fadeToFolder('Night phase')
          music.preload('Round 1', 'a')  // pre-buffer Round 1 for when night ends
          gameLogs.init(settings)
          logEvent('Night phase')
          render()
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
      render()
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
      // underneath — the death card just fades in over it.
      playMerlinDeath()
    }

  } else if (gs.phase === 'win') {
    // MERLIN DIED screen: [ENTER] (or L) → log, from faded or unfaded state.
    // ([ESC] toggling the fade is handled in the top-level Escape block.)
    if (gs.merlin === 'died') {
      if (e.key === 'Enter' || e.key === 'l' || e.key === 'L') {
        gs.phase = 'log'
        render()
      }
    } else if (e.key === 'Enter') {
      settings.menuRow  = 0
      settings.menuPage = 'main'
      gs = newGame(gs.players)
      resetTimerBar()
      music.fadeToFolder('Main menu')
      render()
    } else if (e.key === 'l' || e.key === 'L') {
      gs.phase = 'log'
      render()
    }

  }
})

function _submitLog() {
  const roster = buildRosterFromDOM()
  if (roster.length) gameLogs.setRoster(roster)
  const balEl     = document.getElementById('log-balance')
  const conEl     = document.getElementById('log-conf')
  const targetEl  = document.getElementById('log-assn-target')
  const newGoodEl = document.getElementById('log-new-good')
  const newEvilEl = document.getElementById('log-new-evil')
  const notesEl   = document.getElementById('log-notes')
  if (balEl?.classList.contains('touched'))  gameLogs.setBalance(parseInt(balEl.value))
  if (conEl?.classList.contains('touched'))  gameLogs.setAssassinConfidence(parseInt(conEl.value))
  gameLogs.setAssassinationTarget(targetEl?.value?.trim() || '')
  gameLogs.setNewPlayers(newGoodEl?.value, newEvilEl?.value)
  gameLogs.setNotes(notesEl?.value?.trim() || '')
  gameLogs.save()
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
    render()
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
