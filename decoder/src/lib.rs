//! dribble.tf's demo decoder.
//!
//! Runs a `.dem` through stvtf (the extractor stv.tf uses for live matches) and packs what the
//! viewer reads into typed arrays, in the layout `src/components/Analyse/Data/` expects:
//!
//! - per player, every tick: position (x, y, z) and view angles (pitch, yaw), fixed point;
//! - per player, every few ticks: health, class and team, connected, über, heal target;
//! - per player, every 4 ticks: conditions (burning, cloaked, …), medigun/über state and the
//!   weapon in hand;
//! - per player, every 32 ticks: their scoreboard line (points, kills, deaths, assists, damage,
//!   healing) and ping;
//! - per player, the ticks they fired on (bullets, a new projectile, flames, a clip going down);
//! - per projectile, only while it exists: position and rotation, every tick;
//! - per building, only while it exists: where it is and its state, every 4 ticks;
//! - objectives and the round state, as keys where they change (`objectives.rs`).
//!
//! Snapshots never become JSON: there is one a tick, and as JSON a 14-minute demo is 360 MB.
//! Only the metadata and the events the viewer uses go out as JSON.
//!
//! Positions are Source world coordinates, as the game has them (format 2; format 1 made them
//! relative to the world's minimum corner). Ticks here count from 1 at the first snapshot, like
//! a live match's in the viewer.
//!
//! The browser calls the `extern "C"` functions at the bottom; see `src/libs/decoder/decoder.js`.

mod objectives;

use std::collections::HashMap;

use serde_json::{Value, json};
use stvtf::Line;
use stvtf::output::{
    Building, BuildingKind, Class, MedigunKind, PlayerId, Position, ProjectileKind, Resist, Snapshot, Team,
    Ubered,
};

/// The layout of the arrays and metadata below; the viewer refuses a decoder of another format.
const FORMAT: u32 = 4;

/// Fixed-point scales, as the viewer decodes them (it reads them from the metadata).
const POSITION_SCALE: f64 = 1024.0;
const ANGLE_SCALE: f64 = 256.0;

/// Sparse arrays keep one value per `1 << n` ticks; the metadata's `sampling` says which.
const HEALTH_SPARSE: u32 = 2;
const META_SPARSE: u32 = 6;
const FLAG_SPARSE: u32 = 4;
const STATUS_SPARSE: u32 = 2;
const BUILDING_SPARSE: u32 = 2;
const SCORE_SPARSE: u32 = 5;

/// Values per sample of a player's `score`: points, kills, deaths, assists, damage, healing, ping.
const SCORE_STRIDE: usize = 7;

/// The player conditions kept, one bit each in this order; `StreamEvents.ts` has the same list.
/// Each is any of TF2's conditions named, or starting with a name ending in `*`.
const CONDITIONS: &[(&str, &[&str])] = &[
    ("burning", &["Burning", "BurningPyro"]),
    ("jarate", &["Urine"]),
    ("milk", &["MadMilk"]),
    ("bleeding", &["Bleeding"]),
    ("marked", &["MarkedForDeath*"]),
    ("cloaked", &["Stealthed", "StealthedBlink"]),
    ("disguised", &["Disguised"]),
    ("crits", &["CritBoosted*"]),
    ("minicrits", &["OffensiveBuff", "EnergyBuff"]),
    ("defense", &["DefensiveBuff", "DefenseBuffNoCritBlock", "DefenseBuffHigh"]),
    ("regen", &["RegenOnDamageBuff"]),
    ("speed", &["SpeedBoost"]),
    ("stunned", &["Stunned"]),
    ("overhealed", &["HealthOverHealed"]),
    ("blastJumping", &["BlastJumping"]),
    ("zoomed", &["Zoomed"]),
    ("taunting", &["Taunting"]),
    ("ubered", &["Invulnerable*"]),
    ("bonk", &["Phase"]),
];

/// Values per building sample: x, y, z, yaw, aim, health | max << 16, level | flags << 8, target.
const BUILDING_SAMPLE: usize = 8;

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
    conditions: u32,
    charge: u16,
    /// The item definition index in hand plus one; 0 for none.
    weapon: u16,
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
    conditions: Vec<u32>,
    charge: Vec<u16>,
    weapon: Vec<u16>,
    /// SCORE_STRIDE values per sample.
    score: Vec<u32>,
    /// Ticks they fired on, in the order found (sorted and merged at the end).
    shots: Vec<u32>,
    /// The weapon and its clip in the last snapshot, to see the clip go down.
    last_clip: Option<(i64, i64)>,
    /// The sample of the last snapshot, if the player was in it.
    last: Option<Sample>,
}

impl PlayerSeries {
    fn write(&mut self, tick: u32, s: &Sample, pos: Option<Position>, pitch: f64, yaw: f64) {
        let t = tick as usize;
        if let Some(pos) = pos {
            put(&mut self.position, t * 3, 3);
            for i in 0..3 {
                self.position[t * 3 + i] = fixed(pos[i], POSITION_SCALE);
            }
        }
        put(&mut self.angles, t * 2, 2);
        self.angles[t * 2] = fixed(pitch, ANGLE_SCALE);
        self.angles[t * 2 + 1] = fixed(yaw, ANGLE_SCALE);
        set(&mut self.health, t >> HEALTH_SPARSE, s.health);
        set(&mut self.meta, t >> META_SPARSE, s.meta);
        set(&mut self.connected, t >> FLAG_SPARSE, 1);
        set(&mut self.uber, t >> FLAG_SPARSE, s.uber);
        set(&mut self.heal_target, t >> FLAG_SPARSE, s.heal_target);
        set(&mut self.conditions, t >> STATUS_SPARSE, s.conditions);
        set(&mut self.charge, t >> STATUS_SPARSE, s.charge);
        set(&mut self.weapon, t >> STATUS_SPARSE, s.weapon);
    }

    /// Records a snapshot's sample, filling the ticks since the last one: in between when the
    /// player moved there, held when they jumped (a respawn, a teleport) or the gap is long.
    fn add(&mut self, s: Sample) {
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
                    self.write(tick, &p, Some(pos), lerp(p.pitch, s.pitch, f), lerp_angle(p.yaw, s.yaw, f));
                } else {
                    self.write(tick, &p, p.pos, p.pitch, p.yaw);
                }
            }
        }
        self.write(s.tick, &s, s.pos, s.pitch, s.yaw);
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
    /// Fixed point from `start`: 3 a tick (x, y, z), and 1 a tick (yaw).
    position: Vec<u32>,
    rotation: Vec<u32>,
}

impl Track {
    fn push(&mut self, pos: Position, yaw: f64) {
        for i in 0..3 {
            self.position.push(fixed(pos[i], POSITION_SCALE));
        }
        // stvtf gives a projectile's yaw only.
        self.rotation.push(fixed(yaw, ANGLE_SCALE));
    }

    fn add(&mut self, tick: u32, pos: Position, yaw: f64) {
        let gap = tick - self.last_tick;
        for t in self.last_tick + 1..tick {
            let f = f64::from(t - self.last_tick) / f64::from(gap);
            let (a, b) = (self.last_pos, pos);
            let at = [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
            self.push(at, lerp_angle(self.last_yaw, yaw, f));
        }
        self.push(pos, yaw);
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

// ─── Per building ───────────────────────────────────────────────────────────────

/// One building from when it is put down to when it goes (destroyed, picked up, removed). It
/// keeps one sample per `1 << BUILDING_SPARSE` ticks, the first of each such span it was seen in.
struct BuildingTrack {
    entity_id: u32,
    kind: u32,
    team: u32,
    builder: u32,
    first_bucket: u32,
    last_bucket: u32,
    samples: Vec<u32>,
}

fn building_kind(kind: BuildingKind) -> u32 {
    match kind {
        BuildingKind::Sentry => 1,
        BuildingKind::Dispenser => 2,
        BuildingKind::Teleporter => 3,
        _ => 0,
    }
}

/// A building's sample (see BUILDING_SAMPLE); `target` is the targeted player's entity.
fn building_sample(b: &Building, target: u32) -> [u32; BUILDING_SAMPLE] {
    let flag = |on: bool, bit: u32| if on { 1 << bit } else { 0 };
    let flags = flag(b.sapped, 0)
        | flag(b.building.unwrap_or(false), 1)
        | flag(b.mini.unwrap_or(false), 2)
        | flag(b.entrance.unwrap_or(false), 3)
        | flag(b.aim.is_some(), 4)
        | flag(b.attacking.unwrap_or(false), 5);
    [
        fixed(b.pos[0], POSITION_SCALE),
        fixed(b.pos[1], POSITION_SCALE),
        fixed(b.pos[2], POSITION_SCALE),
        fixed(b.yaw, ANGLE_SCALE),
        fixed(b.aim.unwrap_or(0.0), ANGLE_SCALE),
        u32::from(b.hp) | (u32::from(b.max_hp) << 16),
        u32::from(b.level) | (flags << 8),
        target,
    ]
}

// ─── Per player, what a snapshot says ───────────────────────────────────────────

fn conditions_mask(conds: &[stvtf::output::Condition]) -> u32 {
    let mut mask = 0;
    for cond in conds {
        let name = cond.name();
        for (bit, (_, names)) in CONDITIONS.iter().enumerate() {
            let hit = names.iter().any(|n| match n.strip_suffix('*') {
                Some(prefix) => name.starts_with(prefix),
                None => name == *n,
            });
            if hit {
                mask |= 1 << bit;
            }
        }
    }
    mask
}

/// The medigun charge state packed as `StreamEvents.ts` unpacks it: bits 0-2 the charge a
/// player is under, 4-6 a medic's medigun, 7 releasing, 8-9 the vaccinator's resistance.
fn charge_bits(ubered: Option<Ubered>, medigun: Option<&stvtf::output::Medigun>) -> u16 {
    let under = match ubered {
        None => 0,
        Some(Ubered::Uber) => 1,
        Some(Ubered::Kritz) => 2,
        Some(Ubered::Quickfix) => 3,
        Some(Ubered::VaccinatorBullet) => 4,
        Some(Ubered::VaccinatorBlast) => 5,
        Some(Ubered::VaccinatorFire) => 6,
    };
    let Some(m) = medigun else { return under };
    let kind = match m.kind {
        MedigunKind::Medigun => 1,
        MedigunKind::Kritzkrieg => 2,
        MedigunKind::Quickfix => 3,
        MedigunKind::Vaccinator => 4,
    };
    let resist = match m.resist {
        None => 0,
        Some(Resist::Bullet) => 1,
        Some(Resist::Blast) => 2,
        Some(Resist::Fire) => 3,
    };
    under | (kind << 4) | (u16::from(m.releasing) << 7) | (resist << 8)
}

// ─── The decode ─────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Decoder {
    /// The server tick of the first snapshot; ticks count from 1 there.
    base: Option<u32>,
    last_tick: u32,
    world: Option<(Position, Position)>,
    tick_interval: Option<f64>,
    slots: HashMap<u16, usize>,
    players: Vec<PlayerSeries>,
    active: HashMap<u32, Track>,
    /// Every projectile in the last snapshot, of any kind, to see new ones fired.
    in_flight: HashMap<u32, std::mem::Discriminant<ProjectileKind>>,
    tracks: Vec<Track>,
    active_buildings: HashMap<u32, BuildingTrack>,
    buildings: Vec<BuildingTrack>,
    objectives: objectives::Objectives,
    /// Events with their server tick, made local at the end (some come before any snapshot).
    events: Vec<(u32, Value)>,
}

impl Decoder {
    fn line(&mut self, line: Line) {
        match line {
            Line::Server(s) => self.tick_interval = Some(s.tick_interval),
            Line::World(w) => {
                if self.world.is_none() {
                    self.world = Some((w.min, w.max));
                }
            }
            Line::Snapshot(s) => self.snapshot(&s),
            Line::Shot(shot) => {
                if let (Some(player), Some(base)) = (shot.player, self.base) {
                    if shot.tick >= base {
                        let tick = self.local(shot.tick);
                        let slot = self.slot(player);
                        self.players[slot].shots.push(tick);
                    }
                }
            }
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
            // Firing shows as flames, or the clip going down with the same weapon in hand.
            let clip = p.weapon.as_ref().and_then(|w| w.clip.map(|c| (w.item, c)));
            let clip_dropped = matches!(
                (series.last_clip, clip),
                (Some((item, before)), Some((now_item, now))) if item == now_item && now < before
            );
            if p.alive && (p.flames.is_some() || clip_dropped) {
                series.shots.push(tick);
            }
            series.last_clip = clip;
            // The scoreboard line as stv.tf shows it: the server's points, kills and deaths, and
            // assists, damage and healing counted from events (stvtf, like logs.tf).
            let at = (tick >> SCORE_SPARSE) as usize * SCORE_STRIDE;
            put(&mut series.score, at, SCORE_STRIDE);
            if let Some(score) = &p.score {
                let line = [score.points, score.kills, score.deaths, score.assists, score.damage, score.healing];
                for (i, value) in line.into_iter().enumerate() {
                    series.score[at + i] = u32::try_from(value.max(0)).unwrap_or(u32::MAX);
                }
            }
            series.score[at + 6] = u32::from(p.ping);
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
                    conditions: conditions_mask(&p.conds),
                    charge: charge_bits(p.ubered, p.medigun.as_ref()),
                    weapon: p.weapon.as_ref().and_then(|w| u16::try_from(w.item + 1).ok()).unwrap_or(0),
                },
            );
        }
        // Gone from the snapshot: disconnected, so nothing to fill towards when they return.
        for (slot, was_seen) in seen.iter().enumerate() {
            if !was_seen {
                self.players[slot].last = None;
            }
        }

        // A projectile not in the last snapshot was just fired by its owner.
        let mut in_flight = HashMap::with_capacity(s.projectiles.len());
        for p in &s.projectiles {
            let kind = std::mem::discriminant(&p.kind);
            if self.in_flight.get(&p.id) != Some(&kind) {
                if let Some(owner) = p.owner {
                    let slot = self.slot(owner);
                    self.players[slot].shots.push(tick);
                }
            }
            in_flight.insert(p.id, kind);
        }
        self.in_flight = in_flight;

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
                    track.add(tick, p.pos, p.yaw);
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
            track.push(p.pos, p.yaw);
            self.active.insert(p.id, track);
        }
        let gone: Vec<u32> = self.active.keys().copied().filter(|id| !alive.contains(id)).collect();
        for id in gone {
            if let Some(track) = self.active.remove(&id) {
                self.tracks.push(track);
            }
        }

        self.add_buildings(s, tick, &entity_of);
        let interval = self.tick_interval.unwrap_or(f64::from(stvtf::DEFAULT_TICK_INTERVAL));
        self.objectives.add(s, tick, interval, &entity_of);
    }

    fn add_buildings(&mut self, s: &Snapshot, tick: u32, entity_of: &HashMap<u16, u32>) {
        let bucket = tick >> BUILDING_SPARSE;
        let max_gap = MAX_INTERP_GAP >> BUILDING_SPARSE;
        let entity = |id: Option<PlayerId>| id.and_then(|p| entity_of.get(&p.0).copied()).unwrap_or(0);
        let mut seen = Vec::with_capacity(s.buildings.len());
        for b in &s.buildings {
            let kind = building_kind(b.kind);
            if kind == 0 {
                continue;
            }
            seen.push(b.id);
            let sample = building_sample(b, entity(b.target.flatten()));
            let continues = self
                .active_buildings
                .get(&b.id)
                .is_some_and(|t| t.kind == kind && bucket - t.last_bucket <= max_gap);
            if !continues {
                if let Some(old) = self.active_buildings.remove(&b.id) {
                    self.buildings.push(old);
                }
                self.active_buildings.insert(
                    b.id,
                    BuildingTrack {
                        entity_id: b.id,
                        kind,
                        team: u32::from(team_id(b.team)),
                        builder: entity(b.builder),
                        first_bucket: bucket,
                        last_bucket: bucket,
                        samples: sample.to_vec(),
                    },
                );
                continue;
            }
            let Some(track) = self.active_buildings.get_mut(&b.id) else { continue };
            // The first sample of each span is kept; a span skipped holds the one before.
            while track.last_bucket < bucket {
                let last = track.samples.len() - BUILDING_SAMPLE;
                if track.last_bucket + 1 == bucket {
                    track.samples.extend_from_slice(&sample);
                } else {
                    track.samples.extend_from_within(last..);
                }
                track.last_bucket += 1;
            }
        }
        let gone: Vec<u32> = self.active_buildings.keys().copied().filter(|id| !seen.contains(id)).collect();
        for id in gone {
            if let Some(track) = self.active_buildings.remove(&id) {
                self.buildings.push(track);
            }
        }
    }

    fn finish(mut self, header: &stvtf::demo::Header) -> Decoded {
        self.tracks.extend(self.active.drain().map(|(_, t)| t));
        self.tracks.sort_by_key(|t| t.start);
        self.buildings.extend(self.active_buildings.drain().map(|(_, t)| t));
        self.buildings.sort_by_key(|t| t.first_bucket);

        let ticks = self.last_tick + 1;
        let t = ticks as usize;
        let sparse_len = |n: u32| ((t - 1) >> n) + 1;

        let mut buffers = Vec::new();
        let mut players = Vec::new();
        for (slot, mut p) in self.players.into_iter().enumerate() {
            p.position.resize(t * 3, 0);
            p.angles.resize(t * 2, 0);
            p.health.resize(sparse_len(HEALTH_SPARSE), 0);
            p.meta.resize(sparse_len(META_SPARSE), 0);
            p.connected.resize(sparse_len(FLAG_SPARSE), 0);
            p.uber.resize(sparse_len(FLAG_SPARSE), 0);
            p.heal_target.resize(sparse_len(FLAG_SPARSE), 0);
            p.conditions.resize(sparse_len(STATUS_SPARSE), 0);
            p.charge.resize(sparse_len(STATUS_SPARSE), 0);
            p.weapon.resize(sparse_len(STATUS_SPARSE), 0);
            p.score.resize(sparse_len(SCORE_SPARSE) * SCORE_STRIDE, 0);
            let shots = merge_shots(p.shots, ticks);
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
                Buffer::U32(p.conditions),
                Buffer::U16(p.charge),
                Buffer::U16(p.weapon),
                Buffer::U32(shots),
                Buffer::U32(p.score),
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

        let mut building_table = Vec::with_capacity(self.buildings.len() * 6);
        let mut building_samples = Vec::new();
        for b in self.buildings {
            let spans = b.last_bucket - b.first_bucket + 1;
            building_table.extend([b.entity_id, b.kind, b.team, b.builder, b.first_bucket, spans]);
            building_samples.extend(b.samples);
        }
        let building_count = building_table.len() / 6;
        buffers.extend([Buffer::U32(building_table), Buffer::U32(building_samples)]);

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
            "format": FORMAT,
            "ticks": ticks,
            "intervalPerTick": self.tick_interval.unwrap_or(f64::from(stvtf::DEFAULT_TICK_INTERVAL)),
            "positionScale": POSITION_SCALE,
            "angleScale": ANGLE_SCALE,
            "world": { "boundaryMin": vector(min), "boundaryMax": vector(max) },
            "players": players,
            "playerBuffers": PLAYER_BUFFERS,
            "conditionFlags": CONDITIONS.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
            "sampling": {
                "health": HEALTH_SPARSE,
                "meta": META_SPARSE,
                "connected": FLAG_SPARSE,
                "uber": FLAG_SPARSE,
                "healTarget": FLAG_SPARSE,
                "conditions": STATUS_SPARSE,
                "charge": STATUS_SPARSE,
                "weapon": STATUS_SPARSE,
                "score": SCORE_SPARSE,
            },
            "projectileCount": projectile_count,
            "buildingCount": building_count,
            "buildingSparse": BUILDING_SPARSE,
            "objectives": self.objectives.json(),
            "events": events,
        });
        Decoded { meta: meta.to_string(), buffers }
    }
}

/// Each player's typed arrays, in order; the metadata lists them as `playerBuffers`.
const PLAYER_BUFFERS: &[&str] = &[
    "position",
    "viewAngles",
    "health",
    "meta",
    "connected",
    "uber",
    "healTarget",
    "conditions",
    "charge",
    "weapon",
    "shots",
    "score",
];

/// One shot is often seen more than once (the bullets, the clip, the projectile, a tick or two
/// apart), and flames every tick; shots closer than this to the last one kept are merged.
const SHOT_MERGE_TICKS: u32 = 3;

/// The ticks a player fired on, sorted, within the demo, and merged (SHOT_MERGE_TICKS).
fn merge_shots(mut shots: Vec<u32>, ticks: u32) -> Vec<u32> {
    shots.sort_unstable();
    let mut out: Vec<u32> = Vec::with_capacity(shots.len());
    for tick in shots.into_iter().filter(|&t| t >= 1 && t < ticks) {
        if out.last().is_none_or(|&last| tick - last > SHOT_MERGE_TICKS) {
            out.push(tick);
        }
    }
    out
}

/// A decoded demo: its metadata as JSON, and its typed arrays: each player's (`PLAYER_BUFFERS`),
/// then the projectile tracks, their positions and rotations, then the building tracks
/// (entity id, kind, team, builder entity, first span, spans) and their samples.
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
