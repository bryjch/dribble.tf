//! Objectives (control points, carts, flags) and the round state (timers, score, stopwatch).
//!
//! These change rarely, so each is kept as keys: its state at a tick, written only when it
//! differs from what the last key gives. Clocks (timers, capture progress) are kept as a value
//! and a rate, so one counting down needs no new key until it stops or jumps. What moves (a
//! cart, a dropped flag) gets a key per sample while it moves, and the viewer interpolates.
//!
//! `src/components/Analyse/Data/ObjectiveTimeline.ts` reads the keys, and builds the same from a
//! live match's snapshots.

use std::collections::HashMap;

use serde_json::{Value, json};
use stvtf::output::{Objective, Position, Snapshot};

/// Objectives are looked at every this many ticks.
pub const OBJECTIVE_STEP: u32 = 4;

/// A value changing at a steady rate per second: a timer, a capture in progress.
#[derive(Clone, Copy)]
struct Clock {
    value: f64,
    rate: f64,
}

impl Clock {
    fn new(value: f64, rate: f64) -> Self {
        Self { value, rate }
    }

    fn json(self) -> Value {
        json!([round(self.value, 100.0), self.rate])
    }
}

/// What is compared between samples: fields that must match, clocks that must keep to their
/// rate (within a slack), and values that must stay within a tolerance.
struct Sample {
    fixed: Value,
    clocks: Vec<(Option<Clock>, f64)>,
    smooth: Vec<(Vec<f64>, f64)>,
}

/// The keys of one objective, or of the round state.
#[derive(Default)]
pub struct Keys {
    last: Option<(u32, Sample)>,
    pub keys: Vec<Value>,
}

impl Keys {
    /// Keeps `sample` as a key (built by `key`) if it differs from the last one.
    fn offer(&mut self, tick: u32, sample: Sample, interval: f64, key: impl FnOnce() -> Value) {
        if let Some((at, last)) = &self.last
            && !changed(*at, last, tick, &sample, interval)
        {
            return;
        }
        let mut key = key();
        key["tick"] = json!(tick);
        self.keys.push(key);
        self.last = Some((tick, sample));
    }

    /// The objective is no longer there.
    fn gone(&mut self, tick: u32) {
        if self.last.take().is_some() {
            self.keys.push(json!({ "tick": tick, "gone": true }));
        }
    }
}

fn changed(at: u32, last: &Sample, tick: u32, now: &Sample, interval: f64) -> bool {
    if last.fixed != now.fixed || last.clocks.len() != now.clocks.len() || last.smooth.len() != now.smooth.len() {
        return true;
    }
    let elapsed = f64::from(tick - at) * interval;
    let clocks = last.clocks.iter().zip(&now.clocks).any(|((a, _), (b, slack))| match (a, b) {
        (None, None) => false,
        (Some(a), Some(b)) => (a.rate - b.rate).abs() > 1e-4 || (a.value + a.rate * elapsed - b.value).abs() > *slack,
        _ => true,
    });
    let smooth = last.smooth.iter().zip(&now.smooth).any(|((a, _), (b, tolerance))| {
        a.len() != b.len() || a.iter().zip(b).any(|(x, y)| (x - y).abs() > *tolerance)
    });
    clocks || smooth
}

fn round(value: f64, scale: f64) -> f64 {
    (value * scale).round() / scale
}

/// An stvtf enum (a team, a flag's status) as its JSON name.
macro_rules! to_json {
    ($value:expr) => {
        serde_json::to_value($value).unwrap_or(Value::Null)
    };
}

/// Seconds a clock may drift from its rate before it gets a new key (stvtf rounds them to 0.1).
const CLOCK_SLACK: f64 = 0.15;
const TIME_LEFT_SLACK: f64 = 0.25;

/// Every objective's keys, and the round state's.
#[derive(Default)]
pub struct Objectives {
    pub round: Keys,
    /// By objective (`point:2`, `cart:345`), in the order first seen.
    pub tracks: Vec<(&'static str, u32, Keys)>,
    index: HashMap<(&'static str, u32), usize>,
    /// `time_left` as of its last key (tick, seconds, rate), to tell whether it is counting.
    time_left: Option<(u32, f64, f64)>,
    next_tick: u32,
}

impl Objectives {
    /// Looks at a snapshot (local `tick`) if a step has passed since the last one looked at.
    /// `entity_of` gives a player's entity index from their stvtf id.
    pub fn add(&mut self, s: &Snapshot, tick: u32, interval: f64, origin: Position, entity_of: &HashMap<u16, u32>) {
        if tick < self.next_tick {
            return;
        }
        self.next_tick = tick + OBJECTIVE_STEP;
        self.add_round(s, tick, interval);

        let relative = |p: Position| -> Vec<f64> { (0..3).map(|i| round(p[i] - origin[i], 10.0)).collect() };
        let mut seen = Vec::with_capacity(s.objectives.len());
        for objective in &s.objectives {
            let (kind, id, sample, key) = match objective {
                Objective::ControlPoint {
                    index,
                    pos,
                    owner,
                    capping_team,
                    cap_progress,
                    cap_rate,
                    locked,
                    blocked,
                    on_point,
                } => {
                    let fixed = json!({
                        "owner": to_json!(owner),
                        "capping": to_json!(capping_team),
                        "locked": locked,
                        "blocked": blocked,
                        "red": on_point.red,
                        "blue": on_point.blue,
                    });
                    let pos = pos.map(relative).unwrap_or_default();
                    let progress = Clock::new(*cap_progress, *cap_rate);
                    let mut key = fixed.clone();
                    key["pos"] = if pos.is_empty() { Value::Null } else { json!(pos) };
                    key["progress"] = json!([round(progress.value, 10000.0), round(progress.rate, 10000.0)]);
                    let sample = Sample { fixed, clocks: vec![(Some(progress), 0.01)], smooth: vec![(pos, 1.0)] };
                    ("point", u32::from(*index), sample, key)
                }
                Objective::Cart { id, pos, team, progress, cappers, speed } => {
                    let fixed = json!({ "team": to_json!(team), "cappers": cappers, "speed": speed });
                    let pos = relative(*pos);
                    let mut key = fixed.clone();
                    key["pos"] = json!(pos);
                    key["progress"] = json!(round(*progress, 10000.0));
                    let sample = Sample { fixed, clocks: vec![], smooth: vec![(pos, 0.25), (vec![*progress], 0.0005)] };
                    ("cart", *id, sample, key)
                }
                Objective::Flag { id, pos, team, status, carrier, returns_in, points } => {
                    let carrier = carrier.and_then(|p| entity_of.get(&p.0).copied()).unwrap_or(0);
                    let fixed = json!({
                        "team": to_json!(team),
                        "status": to_json!(status),
                        "carrier": carrier,
                        "points": points,
                    });
                    // A carried flag is where its carrier is; the viewer puts it there.
                    let pos = if carrier == 0 { relative(*pos) } else { Vec::new() };
                    let returns = returns_in.map(|secs| Clock::new(secs, -1.0));
                    let mut key = fixed.clone();
                    key["pos"] = if pos.is_empty() { Value::Null } else { json!(pos) };
                    key["returnsIn"] = returns.map_or(Value::Null, Clock::json);
                    let sample = Sample { fixed, clocks: vec![(returns, CLOCK_SLACK)], smooth: vec![(pos, 0.25)] };
                    ("flag", *id, sample, key)
                }
                _ => continue,
            };
            seen.push((kind, id));
            let next = self.tracks.len();
            let i = *self.index.entry((kind, id)).or_insert(next);
            if i == next {
                self.tracks.push((kind, id, Keys::default()));
            }
            self.tracks[i].2.offer(tick, sample, interval, || key);
        }
        for (kind, id, keys) in &mut self.tracks {
            if !seen.contains(&(*kind, *id)) {
                keys.gone(tick);
            }
        }
    }

    fn add_round(&mut self, s: &Snapshot, tick: u32, interval: f64) {
        let round_time = s.round_time.map(|secs| {
            let running = to_json!(&s.round) == json!("running");
            Clock::new(secs, if running { 1.0 } else { 0.0 })
        });
        // `mp_timelimit` has no paused flag, and comes rounded: whether it counts is told by how
        // far it moved since its last key, once it no longer keeps to the rate it had.
        let time_left = s.time_left.map(|secs| {
            let rate = match self.time_left {
                Some((at, value, rate))
                    if (value + rate * f64::from(tick - at) * interval - secs).abs() <= TIME_LEFT_SLACK =>
                {
                    return Clock::new(secs, rate);
                }
                Some((at, value, _)) if tick > at => {
                    let moved = (secs - value).abs() / (f64::from(tick - at) * interval);
                    if moved < 0.5 { 0.0 } else { -1.0 }
                }
                _ => -1.0,
            };
            self.time_left = Some((tick, secs, rate));
            Clock::new(secs, rate)
        });
        if time_left.is_none() {
            self.time_left = None;
        }
        let timers: Vec<Clock> =
            s.timers.iter().map(|t| Clock::new(t.remaining, if t.paused { 0.0 } else { -1.0 })).collect();
        let stopwatch = s.stopwatch.as_ref().map(|w| Clock::new(w.time, if w.paused { 0.0 } else { -1.0 }));

        let fixed = json!({
            "round": to_json!(&s.round),
            "score": [s.score.red, s.score.blue],
            "captures": s.captures.as_ref().map(|c| json!([c.red, c.blue])),
            "points": s.points.as_ref().map(|p| json!([p.red, p.blue, p.max])),
            "winLimit": s.win_limit,
            "timers": s.timers.iter().map(|t| json!({ "team": to_json!(&t.team), "setup": t.setup })).collect::<Vec<_>>(),
            "stopwatch": s.stopwatch.as_ref().map(|w| json!({
                "attackers": to_json!(&w.attackers),
                "setting": w.setting,
                "state": to_json!(&w.state),
                "points": w.points,
                "inHud": w.in_hud,
            })),
        });
        let mut clocks = vec![(round_time, CLOCK_SLACK), (time_left, TIME_LEFT_SLACK), (stopwatch, CLOCK_SLACK)];
        clocks.extend(timers.iter().map(|t| (Some(*t), CLOCK_SLACK)));

        let key = || {
            let mut key = fixed.clone();
            key["roundTime"] = round_time.map_or(Value::Null, Clock::json);
            key["timeLeft"] = time_left.map_or(Value::Null, Clock::json);
            if let Some(w) = stopwatch {
                key["stopwatch"]["time"] = w.json();
            }
            for (i, t) in timers.iter().enumerate() {
                key["timers"][i]["time"] = t.json();
            }
            key
        };
        let sample = Sample { fixed: fixed.clone(), clocks, smooth: vec![] };
        self.round.offer(tick, sample, interval, key);
    }

    /// The keys as the metadata carries them.
    pub fn json(self) -> Value {
        let tracks: Vec<Value> = self
            .tracks
            .into_iter()
            .map(|(kind, id, keys)| json!({ "kind": kind, "id": id, "keys": keys.keys }))
            .collect();
        json!({ "step": OBJECTIVE_STEP, "round": self.round.keys, "tracks": tracks })
    }
}
