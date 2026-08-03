'use strict'

const path = require('path')
const fs   = require('fs')
const { pathToFileURL } = require('url')
const audioSettings      = require('../audioSettings')

const DIR = path.join(__dirname, 'night_narration_audio')

// Placeholder — tune per-step once real timing is worked out.
const DEFAULT_GAP_MS = 500

// Real elapsed time either side of the narration script itself — kept here
// (not just in renderer.js) so expectedNightSecs() below can't drift from
// what startNightFromLeader()/beginNightOutro() actually do:
//   - narration only starts NIGHT_NARRATION_DELAY_MS after night music does
//   - the phase only ends NIGHT_OUTRO_DELAY_MS after the closing (8a/8b)
//     clip *starts* playing (see beginNightOutro() in renderer.js)
const NIGHT_NARRATION_DELAY_MS = 5000
const NIGHT_OUTRO_DELAY_MS     = 5000

// Per-clip playback lengths (seconds), probed with ffprobe — see durations.json.
// Regenerate after adding/replacing a narration clip.
const CLIP_DURATIONS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'durations.json'), 'utf8'))
  } catch { return {} }
})()
const FALLBACK_CLIP_SECS = 3  // used only if a script references a file missing from durations.json

// Shared per-unit wait constants — tune once here rather than at each call site.
const THUMB_WAIT_MS  = 3000  // per thumb someone has to find and count
const WOKEN_WAIT_MS  = 2500  // per player who opens eyes for a simple mutual look
const PLAYER_WAIT_MS = 500   // per player, for the very first "everyone comply" beat

// Evil headcount by player count — mirrors evilSlotsFor() in renderer.js.
// Kept as its own small copy rather than importing, same pattern gameData.js
// already uses for its own per-count formulas (see _defaultNight).
function evilCountFor(players) {
  return players <= 6 ? 2 : players <= 9 ? 3 : 4
}

// Extra search-difficulty time for "eyes open / find your thumb(s)" moments —
// evilCountFor() alone ties 7p and 9p together (3 evil either way), but a
// bigger table is genuinely harder to visually search. Centered on 7p so it
// adds exactly nothing there (today's tuning stays put), scales negative
// below it and positive above, maxing out at 10p.
const TABLE_BONUS_MS = 1000
function tableBonus(players) {
  return TABLE_BONUS_MS * (players - 7)
}

// Resolves the ordered script for a given character config as a list of
// { file, gap } steps — `gap` is the wait (ms) AFTER that clip, overriding
// the player's default when set. Left undefined, the default gap applies.
function resolveNightScript(characters, players) {
  const c = characters
  const steps = []
  const push = (file, gap) => steps.push({ file, gap })

  // Everyone closes their eyes and forms a fist — always first. Wait scales
  // with the whole table, not just evil — everyone has to comply here.
  push('0 everyone close eyes form fist.mp3', PLAYER_WAIT_MS * players)

  // Evil open eyes, look at each other — always happens; wording varies by
  // which evil-aligned characters must sit out mutual recognition.
  const usesLancelotVariant = c.oberon && c.lancelot ? true
                            : c.oberon              ? false
                            : c.lancelot             ? true
                            : false
  if (c.oberon && c.lancelot)  push('1d oberon lancelot.mp3')
  else if (c.oberon)           push('1b oberon.mp3')
  else if (c.lancelot)         push('1c lancelot.mp3')
  else                         push('1a evil.mp3')

  // How many evil players are actually looking around at each other — total
  // evil headcount minus Oberon and Lancelot, neither of whom take part in
  // this mutual recognition. Mordred never factors in here — nothing before
  // 2b (his own clip, in the Merlin block below) is affected by his status.
  // No clip exists below 1, so skip entirely in that (currently theoretical) case.
  // When it comes out to exactly 1, "should see 1 thumb" replaces this whole
  // block outright — Lancelot's own line never plays after it, even if he's on.
  const eyesOpen = evilCountFor(players) - (c.oberon ? 1 : 0) - (c.lancelot ? 1 : 0)
  if (eyesOpen === 1) {
    push('should see 1 thumb.mp3')
  } else {
    if (eyesOpen >= 2) push(`should be ${eyesOpen} eyes open.mp3`)
    if (c.lancelot) push('should see thumb lancelot.mp3')
  }

  // The wait for this whole "evil recognize each other" block lands on
  // whichever clip actually played last within it — Lancelot's own line if
  // he's in play, else the eyes-open count (or 1abcd itself, in the edge
  // case where even that gets skipped).
  steps[steps.length - 1].gap = WOKEN_WAIT_MS * (evilCountFor(players) - (c.oberon ? 1 : 0)) + tableBonus(players)

  // With no Merlin to hand off to, step 1 needs its own close-eyes filler —
  // which one depends on the same 1a/1b vs 1c/1d split as above.
  if (!c.merlin) {
    push(usesLancelotVariant ? 'close eyes thumbs down.mp3' : 'close eyes 3.mp3')
  }

  // Merlin sees evil, then closes eyes — only if Merlin's in play.
  if (c.merlin) {
    if (c.mordred) {
      push('close eyes 3.mp3')
      push('2b mordred.mp3')
    } else {
      push('2a evil.mp3')
    }
    push('3 merlin.mp3')
    // How many thumbs Merlin himself should count — total evil headcount,
    // minus one if Mordred's in play (he's the only one hidden from Merlin
    // specifically; Oberon/Lancelot only hide from the OTHER evil, above).
    // One wait after both "3 merlin" and the thumb-count line have played,
    // scaled to that number — more thumbs to process, more time to take it in.
    const thumbs = evilCountFor(players) - (c.mordred ? 1 : 0)
    if (thumbs >= 1) {
      push(thumbs === 1 ? 'should see 1 thumb.mp3' : `should see ${thumbs} thumbs.mp3`, THUMB_WAIT_MS * thumbs + tableBonus(players))
    }
    // Skip the filler close-eyes if nothing else needs eyes closed before the
    // final "everyone" wrap-up — no point resetting for a reveal that never comes.
    if (c.percival || c.guinevere || c.tristanIsolde) push('close eyes thumbs down.mp3')
  }

  // Percival sees Merlin (and Morgana, if she's in play too) — 1 or 2 thumbs to find.
  if (c.percival) {
    const percivalThumbs = c.morgana ? 2 : 1
    push(c.morgana ? '4b morgana.mp3' : '4a percival.mp3', THUMB_WAIT_MS * percivalThumbs + tableBonus(players))
    if (c.guinevere || c.tristanIsolde) push('close eyes thumbs down.mp3')
  }

  // What plays at the final "everyone closes eyes" wrap-up — normally the
  // plain step 7 take, but a couple of branches below override or drop it
  // because an earlier clip already did (part of) that job.
  let step7 = '7 everyone close eyes thumbs down.mp3'

  // Guinevere — only if she's in play. When she's the last individual reveal
  // (no Lovers to follow), skip the usual filler close-eyes and go straight
  // to the "2" take of step 7 instead — one fewer clip than the normal path.
  if (c.guinevere) {
    // Always exactly 2 thumbs to find — both Lancelots — regardless of player count.
    push('5 guinevere.mp3', THUMB_WAIT_MS * 2 + tableBonus(players))
    if (c.tristanIsolde) {
      push('close eyes thumbs down.mp3')
    } else {
      step7 = '7 everyone close eyes thumbs down 2.mp3'
    }
  }

  // Lovers — simple mutual reveal, or the three-way version if Mark's in too.
  // The simple (6a) reveal's "everyone close eyes" already covers step 7's
  // job, so step 7 is skipped entirely in that branch to avoid saying it twice.
  if (c.tristanIsolde) {
    if (c.mark) {
      push('6b1 mark.mp3')
      push('6b2 should see lover mark.mp3')          // no extra wait — already built into this clip
      push('6b3 iseult.mp3', THUMB_WAIT_MS * 2 + tableBonus(players))       // Iseult counting 2 thumbs (Tristan + Mark)
    } else {
      push('6a tristan iseult.mp3', WOKEN_WAIT_MS * 2 + tableBonus(players)) // both lovers open eyes to look
      push('everyone close eyes.mp3')
      step7 = null
    }
  }

  if (step7) push(step7)

  // Player-count-dependent close.
  push(players <= 7 ? '8a 5p 6p 7p.mp3' : '8b 8p 9p 10p.mp3')

  return steps
}

// Expected total real-world duration (seconds) of the night phase for a given
// config: the delay before narration starts, the narration itself up through
// the point the closing (8a/8b) clip *begins* — that's what actually ends the
// phase, not when it finishes — plus the fixed outro delay after that. See the
// NIGHT_NARRATION_DELAY_MS/NIGHT_OUTRO_DELAY_MS comment above for why this
// mirrors startNightFromLeader()/beginNightOutro() in renderer.js.
function expectedNightSecs(characters, players) {
  const steps = resolveNightScript(characters, players)
  let ms = NIGHT_NARRATION_DELAY_MS
  for (let i = 0; i < steps.length - 1; i++) {
    const { file, gap } = steps[i]
    const durSecs = CLIP_DURATIONS[file] ?? FALLBACK_CLIP_SECS
    ms += durSecs * 1000 + (gap ?? DEFAULT_GAP_MS)
  }
  ms += NIGHT_OUTRO_DELAY_MS
  return ms / 1000
}

// Sequential clip player: preloads every clip up front so playback never
// stalls on disk I/O mid-sequence, then steps through the resolved script
// back to back, waiting each step's own gap (or the default) between clips.
class NightNarrator {
  constructor() {
    this._steps   = []
    this._audios  = []
    this._timer   = null
    this._playing = false
    this._volume  = audioSettings.get().narrator / 100
    // Fired with (file, index) right as each clip starts — lets a caller react
    // to a specific clip (e.g. the player-count close) without needing to
    // predict audio durations itself.
    this.onClipStart = null
  }

  // Live volume control (0-100), persisted by the caller via audioSettings.
  setVolume(pct) {
    this._volume = Math.max(0, Math.min(100, pct)) / 100
    this._audios.forEach(a => { a.volume = this._volume })
  }

  preload(steps) {
    this.stop()
    this._steps  = steps
    this._audios = steps.map(({ file }) => {
      const a = new Audio()
      a.preload = 'auto'
      a.volume = this._volume
      a.src = pathToFileURL(path.join(DIR, file)).href
      return a
    })
  }

  play(steps, defaultGapMs = DEFAULT_GAP_MS) {
    this.preload(steps)
    this._playing = true
    this._playIndex(0, defaultGapMs)
  }

  _playIndex(i, defaultGapMs) {
    if (!this._playing || i >= this._audios.length) { this._playing = false; return }
    const audio = this._audios[i]
    const gapMs = this._steps[i].gap ?? defaultGapMs
    const onEnded = () => {
      audio.removeEventListener('ended', onEnded)
      if (!this._playing) return
      this._timer = setTimeout(() => this._playIndex(i + 1, defaultGapMs), gapMs)
    }
    audio.addEventListener('ended', onEnded)
    audio.play().catch(e => console.warn('Narration:', e.message))
    if (this.onClipStart) this.onClipStart(this._steps[i].file, i)
  }

  stop() {
    clearTimeout(this._timer)
    this._playing = false
    this._audios.forEach(a => { a.pause(); a.src = '' })
    this._audios = []
    this._steps  = []
  }
}

module.exports = {
  NightNarrator,
  resolveNightScript,
  expectedNightSecs,
  NIGHT_NARRATION_DELAY_MS,
  NIGHT_OUTRO_DELAY_MS,
}
