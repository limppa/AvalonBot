'use strict'

// ── Quotes ───────────────────────────────────────────────────────────────────

const QUOTES = [
  'A lie can run round the world before the truth has got its boots on.',
  'A truth that\'s told with bad intent beats all the lies you can invent.',
  'All spirits are enslaved which serve things evil.',
  'Amateurs chase the sun and get burned. Power stays in the shadows.',
  'Better to get hurt by the truth than comforted with a lie.',
  'Death smiles on us all. All a man can do is smile back.',
  'Deception is the key to victory.',
  'Do not be overcome by evil, but overcome evil with good.',
  'Even though I walk through the valley of the shadow of death, I will fear no evil.',
  'For even the very wise cannot see all ends.',
  'If you tell the truth, you don\'t have to remember anything.',
  'It is more shameful to distrust our friends than to be deceived by them.',
  'Lies are like cockroaches, for every one you discover there are many more that are hidden.',
  'Lying is a thriving vocation.',
  'Lying is done with words, and also with silence.',
  'Man is not what he thinks he is, he is what he hides.',
  'Never attempt to win by force what can be won by deception.',
  'Now I am become Death, the destroyer of worlds.',
  'One who speaks mere portions of truth in order to deceive is a craftsman of destruction.',
  'See no evil, hear no evil, speak no evil.',
  'Silence in the face of evil is itself evil.',
  'The devil\'s finest trick is to persuade you that he does not exist.',
  'The future depends on what we do in the present.',
  'The gift of words is the gift of deception and illusion.',
  'The more deceptive the lie, the more persuasive it is.',
  'The only good is knowledge, and the only evil is ignorance.',
  'The only thing necessary for the triumph of evil is for good men to do nothing.',
  'The treacherous are ever distrustful.',
  'The truest way to be deceived is to think oneself more knowing than others.',
  'The truth will set you free, but first it will make you miserable.',
  'There has to be evil so that good can prove its purity above it.',
  'There\'s small choice in rotten apples.',
  'Truth is the best good. It is the everlasting light.',
  'When truth is replaced by silence, the silence is a lie.',
  'Woe unto them that call evil good, and good evil.',
  'You will know the truth, and the truth will set you free.',
]

// ── Game data ────────────────────────────────────────────────────────────────

const QUEST_SIZES = {
  5:  [2,3,2,3,3],
  6:  [2,3,4,3,4],
  7:  [2,3,3,4,4],
  8:  [3,4,4,5,5],
  9:  [3,4,4,5,5],
  10: [3,4,4,5,5],
}

const TEAM_ROLES = {
  5:  { good: ['Merlin','Percival','Loyal Servant'],
        evil: ['Morgana','Assassin'] },
  6:  { good: ['Merlin','Percival','Loyal Servant','Loyal Servant'],
        evil: ['Morgana','Assassin'] },
  7:  { good: ['Merlin','Percival','Loyal Servant','Loyal Servant'],
        evil: ['Morgana','Assassin','Minion'] },
  8:  { good: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant'],
        evil: ['Morgana','Assassin','Minion'] },
  9:  { good: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant'],
        evil: ['Morgana','Assassin','Minion'] },
  10: { good: ['Merlin','Percival','Loyal Servant','Loyal Servant','Loyal Servant','Loyal Servant'],
        evil: ['Morgana','Assassin','Minion','Minion'] },
}

const CHAR_DESC = require('./content.json').characterDescriptions

// ── Game speed ───────────────────────────────────────────────────────────────

const SPEED_ORDER  = ['speedrun', 'fast', 'normal', 'slow', 'saga']
const SPEED_LABELS = { saga: 'Saga', slow: 'Slow', normal: 'Normal', fast: 'Fast', speedrun: 'Speedrun' }

// ── Quest discussion time: base proportions for allotting time across quests ──
// Sum = 2250. Used as ratio weights, not absolute seconds.
const QUEST_ALLOTTED_BASE = [300, 375, 450, 525, 600]
const QUEST_ALLOTTED_SUM  = 2250  // sum of QUEST_ALLOTTED_BASE

// LotL variant: shifts 54 weight units from Q1 and Q2 to Q3–Q5 (36 each).
// Calibrated so a 7p 45min game loses ~45s from Q1/Q2 and gains ~30s on Q3–Q5.
// Assassination buffer is unaffected (calcDiscussionBudget uses BASE, not this).
const QUEST_ALLOTTED_LOTL = [246, 321, 486, 561, 636]

// ── Assassination buffer ──────────────────────────────────────────────────────
// Assassination gets the same duration as a specific quest's discussion slice.
// Saga/Slow/Normal: Q3 (index 2 — the middle quest). Fast: Q2. Speedrun: Q1.
const ASSN_QUEST_INDEX = { saga: 2, slow: 2, normal: 2, fast: 1, speedrun: 0 }

// ── Assassination time formula (pool/evil-share based) ───────────────────────
// Used by calcAssnFraction() in renderer.js, wired into calcDiscussionBudget() and newGame().
// ASSN_POOL_REF: median (good-players + Oberon-in-play) pool across default 5-10p configs.
// ASSN_EVIL_PCT_REF: evil-player share at 8 players, used as the reference share.
const ASSN_POOL_REF     = 5
const ASSN_EVIL_PCT_REF = 3 / 8

// Oberon is not known by Evil, and is therefore a part of the "potential Merlin"
// pool. He counts as 0.5 because it is easier for Evil to discount him as Merlin
// compared to a Good player.
const OBERON_POOL_WEIGHT = 0.5

// ── Quest card-play time (seconds) per team size, by speed ───────────────────
// All speeds use +10s per extra player. Controls the outer-ring card timer.
const QUEST_CARD_TIME = {
  saga:     { 2: 170, 3: 180, 4: 190, 5: 200 },
  slow:     { 2:  90, 3: 100, 4: 110, 5: 120 },
  normal:   { 2:  60, 3:  70, 4:  80, 5:  90 },
  fast:     { 2:  40, 3:  50, 4:  60, 5:  70 },
  speedrun: { 2:  20, 3:  30, 4:  40, 5:  50 },
}

// ── Discussion rate per speed ─────────────────────────────────────────────────
// D[speed] = discussion seconds per player, derived from 7-player anchor times.
// Game length formula: night(p) + cards(p,speed) + D[speed] × p × (1 + assnW/SUM)
const SPEED_ANCHOR_7P = { saga: 75, slow: 60, normal: 45, fast: 30, speedrun: 15 }

function _defaultNight(players) {
  const evilCount = players <= 6 ? 2 : players <= 9 ? 3 : 4
  const oberon    = players === 7 || players >= 10
  const mordred   = players === 9 || players >= 10
  return 20 + (evilCount - 2)*5 + 10 + (oberon?5:0) + (mordred?5:0) + 20 + 15
}

const DISCUSSION_RATE = (() => {
  const rates = {}
  for (const speed of SPEED_ORDER) {
    const p7night = _defaultNight(7)
    const p7cards = QUEST_SIZES[7].reduce((s, sz) => s + QUEST_CARD_TIME[speed][sz], 0)
    const assnW   = QUEST_ALLOTTED_BASE[ASSN_QUEST_INDEX[speed]]
    const mult    = (QUEST_ALLOTTED_SUM + assnW) / QUEST_ALLOTTED_SUM
    rates[speed]  = (SPEED_ANCHOR_7P[speed] * 60 - p7night - p7cards) / (7 * mult)
  }
  return rates
})()

module.exports = {
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
}
