//! dribble.tf's demo decoder.
//!
//! Runs a `.dem` through stvtf (the extractor stv.tf uses for live matches) and packs what the
//! viewer reads into typed arrays, in the layout `src/components/Analyse/Data/` expects:
//!
//! - per player, every tick: position and view angles, fixed point;
//! - per player, every few ticks: health, class and team, connected, über, heal target;
//! - per projectile, only while it exists: position and rotation, every tick.
//!
//! Snapshots never become JSON: there is one a tick, and as JSON a 14-minute demo is 360 MB.
//! Only the metadata and the events the viewer uses go out as JSON.
//!
//! Ticks here count from 1 at the first snapshot, like a live match's in the viewer.
//!
//! The browser calls the `extern "C"` functions at the bottom; see `src/libs/decoder/decoder.js`.

use std::collections::HashMap;

use serde_json::{Value, json};
use stvtf::Line;
use stvtf::output::{Class, PlayerId, Position, ProjectileKind, Snapshot, Team};

/// Fixed-point scales, as `PositionEncoding.ts` decodes them.
const POSITION_SCALE: f64 = 1024.0;
const ANGLE_SCALE: f64 = 256.0;

/// Sparse caches keep one value per `1 << n` ticks, as the viewer's caches are built.
const HEALTH_SPARSE: u32 = 2;
const META_SPARSE: u32 = 6;
const FLAG_SPARSE: u32 = 4;

/// A snapshot every frame the demo has; STV demos mostly record every tick.
const SNAPSHOT_HZ: f32 = 67.0;
/// Snapshots further apart than this are not interpolated across.
const MAX_INTERP_GAP: u32 = 33;
/// Moving further than this between two snapshots is a respawn or a teleport, not movement.
const TELEPORT_DISTANCE: f64 = 512.0;

/// The events the viewer reads from a demo; the rest stay in stvtf.
const EVENTS: &[&str] = &["kill", "chat", "server_text", "uber", "round_win", "round_start"];

// ─── Per player ─────────────────────────────────────────────────────────────────

/// What a snapshot says about one player.
#[derive(Clone, Copy)]
struct Sample {
    tick: u32,
    pos: Option<Position>,
    pitch: f64,
    yaw: f64,
    health: u16,
    meta: u8,
    uber: u16,
    heal_target: u16,
}

#[derive(Default)]
struct PlayerSeries {
    user_id: u16,
    entity_id: u32,
    name: String,
    steam_id: String,
    team: Option<Team>,
    position: Vec<u32>,
    angles: Vec<u32>,
    health: Vec<u16>,
    meta: Vec<u8>,
    connected: Vec<u8>,
    uber: Vec<u16>,
    heal_target: Vec<u16>,
    /// The sample of the last snapshot, if the player was in it.
    last: Option<Sample>,
}

impl PlayerSeries {
    fn write(&mut self, tick: u32, s: &Sample, pos: Option<Position>, pitch: f64, yaw: f64, origin: Position) {
        let t = tick as usize;
        if let Some(pos) = pos {
            put(&mut self.position, t * 3, 3);
            for i in 0..3 {
                self.position[t * 3 + i] = fixed(pos[i] - origin[i], POSITION_SCALE);
            }
        }
        put(&mut self.angles, t * 3, 3);
        self.angles[t * 3] = fixed(pitch, ANGLE_SCALE);
        self.angles[t * 3 + 1] = fixed(yaw, ANGLE_SCALE);
        set(&mut self.health, t >> HEALTH_SPARSE, s.health);
        set(&mut self.meta, t >> META_SPARSE, s.meta);
        set(&mut self.connected, t >> FLAG_SPARSE, 1);
        set(&mut self.uber, t >> FLAG_SPARSE, s.uber);
        set(&mut self.heal_target, t >> FLAG_SPARSE, s.heal_target);
    }

    /// Records a snapshot's sample, filling the ticks since the last one: in between when the
    /// player moved there, held when they jumped (a respawn, a teleport) or the gap is long.
    fn add(&mut self, s: Sample, origin: Position) {
        if let Some(p) = self.last {
            let gap = s.tick.saturating_sub(p.tick);
            let smooth = gap <= MAX_INTERP_GAP
                && (p.health > 0) == (s.health > 0)
                && match (p.pos, s.pos) {
                    (Some(a), Some(b)) => distance(a, b) < TELEPORT_DISTANCE,
                    _ => false,
                };
            for tick in p.tick + 1..s.tick {
                let f = f64::from(tick - p.tick) / f64::from(gap);
                if smooth {
                    let (a, b) = (p.pos.unwrap_or_default(), s.pos.unwrap_or_default());
                    let pos = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
                    self.write(tick, &p, Some(pos), lerp(p.pitch, s.pitch, f), lerp_angle(p.yaw, s.yaw, f), origin);
                } else {
                    self.write(tick, &p, p.pos, p.pitch, p.yaw, origin);
                }
            }
        }
        self.write(s.tick, &s, s.pos, s.pitch, s.yaw, origin);
        self.last = Some(s);
    }
}

// ─── Per projectile ─────────────────────────────────────────────────────────────

/// One projectile from when it appears to when it goes. stvtf names projectiles by entity
/// index, which the game reuses, so a new kind or a gap starts a new track.
struct Track {
    entity_id: u32,
    kind: u32,
    team: u32,
    start: u32,
    last_tick: u32,
    last_pos: Position,
    last_yaw: f64,
    /// Fixed point, 3 a tick from `start`.
    position: Vec<u32>,
    rotation: Vec<u32>,
}

impl Track {
    fn push(&mut self, pos: Position, yaw: f64, origin: Position) {
        for i in 0..3 {
            self.position.push(fixed(pos[i] - origin[i], POSITION_SCALE));
        }
        // Pitch, yaw, roll, as the parser2 caches have it; stvtf gives the yaw only.
        self.rotation.extend([0, fixed(yaw, ANGLE_SCALE), 0]);
    }

    fn add(&mut self, tick: u32, pos: Position, yaw: f64, origin: Position) {
        let gap = tick - self.last_tick;
        for t in self.last_tick + 1..tick {
            let f = f64::from(t - self.last_tick) / f64::from(gap);
            let (a, b) = (self.last_pos, pos);
            let at = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
            self.push(at, lerp_angle(self.last_yaw, yaw, f), origin);
        }
        self.push(pos, yaw, origin);
        self.last_tick = tick;
        self.last_pos = pos;
        self.last_yaw = yaw;
    }
}

/// The viewer's projectile types (`ProjectileTypeMap`); those it has no model for are left out.
fn projectile_type(kind: ProjectileKind) -> Option<u32> {
    match kind {
        ProjectileKind::Rocket | ProjectileKind::EnergyBall => Some(1),
        ProjectileKind::Pipe | ProjectileKind::LooseCannon => Some(2),
        ProjectileKind::Sticky => Some(3),
        ProjectileKind::HealingArrow => Some(4),
        _ => None,
    }
}

// ─── The decode ─────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Decoder {
    /// The server tick of the first snapshot; ticks count from 1 there.
    base: Option<u32>,
    last_tick: u32,
    origin: Position,
    world: Option<(Position, Position)>,
    tick_interval: Option<f64>,
    slots: HashMap<u16, usize>,
    players: Vec<PlayerSeries>,
    active: HashMap<u32, Track>,
    tracks: Vec<Track>,
    /// Events with their server tick, made local at the end (some come before any snapshot).
    events: Vec<(u32, Value)>,
}

impl Decoder {
    fn line(&mut self, line: Line) {
        match line {
            Line::Server(s) => self.tick_interval = Some(s.tick_interval),
            Line::World(w) => {
                if self.world.is_none() {
                    self.origin = w.min;
                    self.world = Some((w.min, w.max));
                }
            }
            Line::Snapshot(s) => self.snapshot(&s),
            other => {
                let Some(tick) = other.tick() else { return };
                let Ok(value) = serde_json::to_value(&other) else { return };
                if value.get("type").and_then(Value::as_str).is_some_and(|t| EVENTS.contains(&t)) {
                    self.events.push((tick, value));
                }
            }
        }
    }

    fn local(&self, server_tick: u32) -> u32 {
        let base = self.base.unwrap_or(server_tick);
        server_tick.saturating_sub(base) + 1
    }

    fn slot(&mut self, id: PlayerId) -> usize {
        let next = self.players.len();
        let slot = *self.slots.entry(id.0).or_insert(next);
        if slot == next {
            self.players.push(PlayerSeries { user_id: id.0, ..PlayerSeries::default() });
        }
        slot
    }

    fn snapshot(&mut self, s: &Snapshot) {
        let base = *self.base.get_or_insert(s.tick);
        // A tick from before the first snapshot (a restart): nothing to place it on.
        if s.tick < base {
            return;
        }
        let tick = self.local(s.tick);
        if tick <= self.last_tick {
            return;
        }
        self.last_tick = tick;
        let origin = self.origin;

        let entity_of: HashMap<u16, u32> = s.players.iter().map(|p| (p.id.0, p.ent)).collect();
        let mut seen = vec![false; self.players.len()];
        for p in &s.players {
            let slot = self.slot(p.id);
            if slot >= seen.len() {
                seen.resize(slot + 1, false);
            }
            seen[slot] = true;
            let series = &mut self.players[slot];
            series.entity_id = p.ent;
            series.name.clone_from(&p.name);
            series.steam_id.clone_from(&p.steamid);
            series.team = Some(p.team);
            let heal_target = p
                .medigun
                .as_ref()
                .and_then(|m| m.target)
                .and_then(|t| entity_of.get(&t.0))
                .map_or(0, |&e| e as u16);
            series.add(
                Sample {
                    tick,
                    pos: p.pos,
                    pitch: p.pitch.unwrap_or(0.0),
                    yaw: p.yaw.unwrap_or(0.0),
                    health: if p.alive { p.hp.max(1) } else { 0 },
                    meta: class_id(p.class) | (team_id(p.team) << 4),
                    uber: if p.class == Class::Medic { u16::from(p.uber) } else { 0 },
                    heal_target,
                },
                origin,
            );
        }
        // Gone from the snapshot: disconnected, so nothing to fill towards when they return.
        for (slot, was_seen) in seen.iter().enumerate() {
            if !was_seen {
                self.players[slot].last = None;
            }
        }

        let mut alive = Vec::with_capacity(s.projectiles.len());
        for p in &s.projectiles {
            let Some(kind) = projectile_type(p.kind) else { continue };
            alive.push(p.id);
            let continues = self
                .active
                .get(&p.id)
                .is_some_and(|t| t.kind == kind && tick - t.last_tick <= MAX_INTERP_GAP);
            if continues {
                if let Some(track) = self.active.get_mut(&p.id) {
                    track.add(tick, p.pos, p.yaw, origin);
                }
                continue;
            }
            if let Some(old) = self.active.remove(&p.id) {
                self.tracks.push(old);
            }
            let mut track = Track {
                entity_id: p.id,
                kind,
                team: u32::from(team_id(p.team)),
                start: tick,
                last_tick: tick,
                last_pos: p.pos,
                last_yaw: p.yaw,
                position: Vec::new(),
                rotation: Vec::new(),
            };
            track.push(p.pos, p.yaw, origin);
            self.active.insert(p.id, track);
        }
        let gone: Vec<u32> = self.active.keys().copied().filter(|id| !alive.contains(id)).collect();
        for id in gone {
            if let Some(track) = self.active.remove(&id) {
                self.tracks.push(track);
            }
        }
    }

    fn finish(mut self, header: &stvtf::demo::Header) -> Decoded {
        self.tracks.extend(self.active.drain().map(|(_, t)| t));
        self.tracks.sort_by_key(|t| t.start);

        let ticks = self.last_tick + 1;
        let t = ticks as usize;
        let sparse_len = |n: u32| ((t - 1) >> n) + 1;

        let mut buffers = Vec::new();
        let mut players = Vec::new();
        for (slot, mut p) in self.players.into_iter().enumerate() {
            p.position.resize(t * 3, 0);
            p.angles.resize(t * 3, 0);
            p.health.resize(sparse_len(HEALTH_SPARSE), 0);
            p.meta.resize(sparse_len(META_SPARSE), 0);
            p.connected.resize(sparse_len(FLAG_SPARSE), 0);
            p.uber.resize(sparse_len(FLAG_SPARSE), 0);
            p.heal_target.resize(sparse_len(FLAG_SPARSE), 0);
            players.push(json!({
                "id": slot,
                "entityId": p.entity_id,
                "userId": p.user_id,
                "steamId": p.steam_id,
                "name": p.name,
                "team": p.team.map_or("", team_name),
            }));
            buffers.extend([
                Buffer::U32(p.position),
                Buffer::U32(p.angles),
                Buffer::U16(p.health),
                Buffer::U8(p.meta),
                Buffer::U8(p.connected),
                Buffer::U16(p.uber),
                Buffer::U16(p.heal_target),
            ]);
        }

        let mut track_table = Vec::with_capacity(self.tracks.len() * 5);
        let mut positions = Vec::new();
        let mut rotations = Vec::new();
        for track in self.tracks {
            let length = (track.position.len() / 3) as u32;
            track_table.extend([track.entity_id, track.kind, track.team, track.start, length]);
            positions.extend(track.position);
            rotations.extend(track.rotation);
        }
        let projectile_count = track_table.len() / 5;
        buffers.extend([Buffer::U32(track_table), Buffer::U32(positions), Buffer::U32(rotations)]);

        let base = self.base;
        let local = |server: u32| -> u32 {
            let tick = server.saturating_sub(base.unwrap_or(server)) + 1;
            tick.min(ticks - 1).max(1)
        };
        let events: Vec<Value> = self
            .events
            .into_iter()
            .map(|(server, mut value)| {
                value["tick"] = json!(local(server));
                value
            })
            .collect();

        let (min, max) = self.world.unwrap_or_default();
        let vector = |v: Position| json!({ "x": v[0], "y": v[1], "z": v[2] });
        let meta = json!({
            "header": {
                "demo_type": "HL2DEMO",
                "version": 3,
                "protocol": header.protocol,
                "server": header.server,
                "nick": header.client,
                "map": header.map,
                "game": header.game,
                "duration": header.seconds,
                "ticks": header.ticks,
                "frames": header.frames,
                "signon": header.signon_bytes,
            },
            "ticks": ticks,
            "intervalPerTick": self.tick_interval.unwrap_or(f64::from(stvtf::DEFAULT_TICK_INTERVAL)),
            "positionScale": POSITION_SCALE,
            "angleScale": ANGLE_SCALE,
            "world": { "boundaryMin": vector(min), "boundaryMax": vector(max) },
            "players": players,
            "projectileCount": projectile_count,
            "events": events,
        });
        Decoded { meta: meta.to_string(), buffers }
    }
}

/// A decoded demo: its metadata as JSON, and its typed arrays in the order the metadata implies
/// (per player: position, angles, health, meta, connected, über, heal target; then the
/// projectile tracks, their positions and their rotations).
pub struct Decoded {
    pub meta: String,
    pub buffers: Vec<Buffer>,
}

pub enum Buffer {
    U32(Vec<u32>),
    U16(Vec<u16>),
    U8(Vec<u8>),
}

/// Decodes a demo, reporting progress (0 → 1) as it goes.
pub fn decode(bytes: &[u8], mut progress: impl FnMut(f32)) -> Result<Decoded, String> {
    let header = stvtf::demo::Header::parse(bytes).map_err(|e| e.to_string())?;
    let span = header.ticks.max(1) as f32;
    let mut decoder = Decoder::default();
    let mut reported = 0.0f32;
    stvtf::decode::demo_file(bytes, SNAPSHOT_HZ, &mut |line| {
        decoder.line(line);
        let done = decoder.last_tick as f32 / span;
        if done - reported >= 0.01 {
            reported = done;
            progress(done.min(1.0));
        }
    })
    .map_err(|e| e.to_string())?;
    if decoder.base.is_none() {
        return Err("The demo has no snapshots to show.".into());
    }
    Ok(decoder.finish(&header))
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

fn fixed(value: f64, scale: f64) -> u32 {
    if !value.is_finite() {
        return 0;
    }
    (value * scale).round() as i64 as i32 as u32
}

fn put<T: Default + Clone>(v: &mut Vec<T>, at: usize, n: usize) {
    if v.len() < at + n {
        v.resize(at + n, T::default());
    }
}

fn set<T: Default + Clone>(v: &mut Vec<T>, at: usize, value: T) {
    put(v, at, 1);
    v[at] = value;
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn lerp_angle(a: f64, b: f64, t: f64) -> f64 {
    a + ((((b - a) % 360.0) + 540.0) % 360.0 - 180.0) * t
}

fn distance(a: Position, b: Position) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

fn class_id(class: Class) -> u8 {
    match class {
        Class::Scout => 1,
        Class::Sniper => 2,
        Class::Soldier => 3,
        Class::Demoman => 4,
        Class::Medic => 5,
        Class::Heavy => 6,
        Class::Pyro => 7,
        Class::Spy => 8,
        Class::Engineer => 9,
        Class::Unknown => 0,
    }
}

fn team_id(team: Team) -> u8 {
    match team {
        Team::Spectator => 1,
        Team::Red => 2,
        Team::Blue => 3,
        Team::Unassigned => 0,
    }
}

fn team_name(team: Team) -> &'static str {
    match team {
        Team::Red => "red",
        Team::Blue => "blue",
        Team::Spectator => "spectator",
        Team::Unassigned => "",
    }
}

// ─── The browser's side ─────────────────────────────────────────────────────────
//
// A plain C ABI, so the module needs no generated glue: `alloc` a buffer, copy the demo in,
// `decode` it, then read `meta` and each buffer out of memory and drop the module.

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// Told how far the decode has got, 0 → 1.
    fn progress(fraction: f32);
}

#[cfg(not(target_arch = "wasm32"))]
unsafe fn progress(_fraction: f32) {}

static RESULT: std::sync::Mutex<Option<Result<Decoded, String>>> = std::sync::Mutex::new(None);

fn with_result<T>(f: impl FnOnce(&Option<Result<Decoded, String>>) -> T) -> T {
    f(&RESULT.lock().unwrap_or_else(std::sync::PoisonError::into_inner))
}

/// Room for `len` bytes, for the caller to fill and hand to `decode`.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Decodes the `len` bytes at `ptr` (from `alloc`, which this frees). 1 when it worked; 0 and
/// the error in `meta` when not.
///
/// # Safety
/// `ptr` must be from `alloc(len)`, filled with `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn decode_demo(ptr: *mut u8, len: usize) -> u32 {
    // SAFETY: as the caller promises, `ptr` is `alloc(len)`'s and holds `len` bytes.
    let bytes = unsafe { Vec::from_raw_parts(ptr, len, len) };
    // SAFETY: the import takes a plain number.
    let result = decode(&bytes, |f| unsafe { progress(f) });
    drop(bytes);
    let ok = u32::from(result.is_ok());
    *RESULT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(result);
    ok
}

/// The metadata (or the error) as UTF-8 JSON: where it starts…
#[unsafe(no_mangle)]
pub extern "C" fn meta_ptr() -> *const u8 {
    with_result(|r| match r {
        Some(Ok(d)) => d.meta.as_ptr(),
        Some(Err(e)) => e.as_ptr(),
        None => std::ptr::null(),
    })
}

/// …and its length in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn meta_len() -> usize {
    with_result(|r| match r {
        Some(Ok(d)) => d.meta.len(),
        Some(Err(e)) => e.len(),
        None => 0,
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn buffer_count() -> usize {
    with_result(|r| match r {
        Some(Ok(d)) => d.buffers.len(),
        _ => 0,
    })
}

/// Buffer `i`'s element width in bytes: 4, 2 or 1.
#[unsafe(no_mangle)]
pub extern "C" fn buffer_width(i: usize) -> usize {
    buffer(i, |b| match b {
        Buffer::U32(_) => 4,
        Buffer::U16(_) => 2,
        Buffer::U8(_) => 1,
    })
}

/// Where buffer `i` starts in memory.
#[unsafe(no_mangle)]
pub extern "C" fn buffer_ptr(i: usize) -> usize {
    buffer(i, |b| match b {
        Buffer::U32(v) => v.as_ptr() as usize,
        Buffer::U16(v) => v.as_ptr() as usize,
        Buffer::U8(v) => v.as_ptr() as usize,
    })
}

/// Buffer `i`'s length in elements.
#[unsafe(no_mangle)]
pub extern "C" fn buffer_len(i: usize) -> usize {
    buffer(i, |b| match b {
        Buffer::U32(v) => v.len(),
        Buffer::U16(v) => v.len(),
        Buffer::U8(v) => v.len(),
    })
}

fn buffer<T: Default>(i: usize, f: impl FnOnce(&Buffer) -> T) -> T {
    with_result(|r| match r {
        Some(Ok(d)) => d.buffers.get(i).map(f).unwrap_or_default(),
        _ => T::default(),
    })
}
