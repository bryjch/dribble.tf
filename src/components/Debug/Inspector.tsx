import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  ConditionFlag,
  MedigunKind,
  Resist,
  UberedKind,
} from '@components/Analyse/Data/StreamEvents'
import { ClassIcon } from '@components/UI/ClassIcon'
import {
  useViewmodelDebug,
  ViewmodelClip,
  ViewmodelRigInfo,
} from '@components/Scene/viewmodelDebug'
import { HEALTH_MAP } from '@constants/mappings'
import { updateSettingsOptionAction } from '@zus/actions'
import { useStore } from '@zus/store'
import { cn } from '@utils/styling'

import { createBonesOverlay } from './BonesOverlay'
import { Btn, Explain, Group, Note, Prop, Scrub, Select, Tag, TextInput, ink } from './controls'
import {
  CONDITIONS,
  CONDITION_GROUPS,
  UBERS,
  classPatch,
  className,
  holdWeapon,
  setUber,
  teamHex,
  useCatalog,
  usePovId,
} from './edit'
import { CatalogItem, KNOWN_BROKEN, SLOT_ORDER } from './items'
import {
  ALL_CONDITIONS,
  CLASS_ORDER,
  DebugBuilding,
  DebugPlayer,
  DebugProjectile,
  MEDIGUN_ITEMS,
  PROJECTILE_TYPES,
  Team,
  UBERED_KINDS,
  Vec3,
} from './scenario'
import {
  floorUnder,
  pointAtViewCenter,
  updateBuilding,
  updatePlayer,
  updateProjectile,
  useDebug,
  viewPlayer,
} from './session'

const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]')

const TeamButtons = ({ team, onChange }: { team: Team; onChange: (team: Team) => void }) => (
  <>
    <Btn active={team === 'red'} onClick={() => onChange('red')}>
      RED
    </Btn>
    <Btn active={team === 'blue'} onClick={() => onChange('blue')}>
      BLU
    </Btn>
  </>
)

const Place = ({ pos, onChange }: { pos: Vec3; onChange: (pos: Vec3) => void }) => (
  <>
    <div className="grid grid-cols-3 gap-1">
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <Scrub
          key={axis}
          label={axis}
          value={pos[i]}
          step={4}
          onChange={v => onChange(pos.map((o, j) => (j === i ? v : o)) as Vec3)}
        />
      ))}
    </div>
    <div className="mt-1 flex gap-1">
      <Btn
        onClick={() => {
          const p = pointAtViewCenter()
          if (p) onChange(p)
        }}
        title="Where the middle of the screen meets the map"
      >
        to view
      </Btn>
      <Btn
        onClick={() => {
          const p = floorUnder(pos)
          if (p) onChange(p)
        }}
        title="Onto the floor under it"
      >
        to floor
      </Btn>
    </div>
  </>
)

// ─── Player ─────────────────────────────────────────────────────────────────────

/**
 * What the player is under: one condition or one medigun charge, from one list grouped by what
 * the viewer draws for it. Picking one replaces the rest.
 */
const StatusPicker = ({ player }: { player: DebugPlayer }) => {
  const value = player.ubered ? `charge:${player.ubered}` : (player.conditions[0] ?? 'none')
  const meta = player.ubered
    ? UBERS[player.ubered]
    : player.conditions[0]
      ? CONDITIONS[player.conditions[0]]
      : null
  const mark = (shows: string) =>
    shows === 'none' ? '  (no change)' : shows === 'badge' ? '  (badge)' : ''
  const options = [
    { value: 'none', label: 'none', group: '' },
    ...UBERED_KINDS.map(kind => ({
      value: `charge:${kind}`,
      label: `${UBERS[kind].label}${mark(UBERS[kind].shows)}`,
      group: 'Medigun charge',
    })),
    ...CONDITION_GROUPS.flatMap(({ shows, label: group }) =>
      ALL_CONDITIONS.filter(flag => CONDITIONS[flag].shows === shows).map(flag => ({
        value: flag as string,
        label: `${CONDITIONS[flag].label}${mark(shows)}`,
        group,
      }))
    ),
  ]
  const extra = [
    ...(player.ubered ? player.conditions : player.conditions.slice(1)).map(
      flag => CONDITIONS[flag].label
    ),
  ]
  const pick = (next: string) => {
    if (next.startsWith('charge:')) {
      updatePlayer(player.id, { conditions: [] })
      setUber(player, next.slice('charge:'.length) as UberedKind)
    } else {
      updatePlayer(player.id, {
        ubered: null,
        conditions: next === 'none' ? [] : [next as ConditionFlag],
      })
    }
  }
  return (
    <>
      <div className="flex items-center gap-1">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{
            background: meta ? meta.color : 'transparent',
            boxShadow: meta ? undefined : 'inset 0 0 0 1px rgba(255,255,255,0.25)',
          }}
        />
        <Select
          className="min-w-0 flex-1"
          value={value}
          options={options}
          label="Condition"
          title={meta?.how}
          onChange={pick}
        />
        {meta?.shows === 'none' && (
          <Tag tone="warn" title={meta.how}>
            no change
          </Tag>
        )}
        {extra.length > 0 && <Tag title={`Also ${extra.join(', ')}`}>+{extra.length}</Tag>}
      </div>
      {meta && <Explain tone={meta.shows === 'none' ? 'warn' : undefined}>{meta.how}</Explain>}
      {extra.length > 0 && (
        <Explain>
          Also {extra.join(', ')} (from a preset or link); picking one replaces them.
        </Explain>
      )}
    </>
  )
}

/** A medic's medigun: its kind, releasing, the Vaccinator's resistance, charge, heal target. */
const Medigun = ({ player }: { player: DebugPlayer }) => {
  const players = useDebug(s => s.scenario.players)
  const set = (patch: Partial<DebugPlayer>) => updatePlayer(player.id, patch)
  const medigun = player.medigun ?? {
    kind: 'medigun' as MedigunKind,
    releasing: false,
    resist: null,
  }
  return (
    <>
      {player.classId === 5 && (
        <>
          <Prop label="medigun">
            <Select
              value={medigun.kind}
              label="Medigun"
              options={(Object.keys(MEDIGUN_ITEMS) as MedigunKind[]).map(kind => ({
                value: kind,
                label: kind,
              }))}
              onChange={kind => set({ medigun: { ...medigun, kind }, weapon: MEDIGUN_ITEMS[kind] })}
            />
            <Btn
              active={medigun.releasing}
              onClick={() => set({ medigun: { ...medigun, releasing: !medigun.releasing } })}
            >
              releasing
            </Btn>
          </Prop>
          {medigun.kind === 'vaccinator' && (
            <Prop label="resist">
              {(['bullet', 'blast', 'fire'] as Resist[]).map(resist => (
                <Btn
                  key={resist}
                  active={medigun.resist === resist}
                  onClick={() => set({ medigun: { ...medigun, resist } })}
                >
                  {resist}
                </Btn>
              ))}
            </Prop>
          )}
          <Prop label="charge %">
            <Scrub
              label="%"
              value={player.charge}
              min={0}
              max={100}
              onChange={charge => set({ charge })}
            />
          </Prop>
          <Prop label="heals">
            <Select
              className="flex-1"
              value={player.healTarget ?? -1}
              label="Heal target"
              options={[
                { value: -1, label: 'nobody' },
                ...players
                  .filter(p => p.id !== player.id)
                  .map(p => ({ value: p.id, label: p.name })),
              ]}
              onChange={id => set({ healTarget: id < 0 ? null : id })}
            />
          </Prop>
        </>
      )}
    </>
  )
}

/**
 * The weapons the class can hold, filtered by slot, one per model (reskins and festives look the
 * same in hand). Weapons with no viewmodel built are left out unless they are known to be broken
 * (or in hand). [ and ] step through the list.
 */
const WeaponBrowser = ({ player }: { player: DebugPlayer }) => {
  const catalog = useCatalog()
  const [slot, setSlot] = useState('all')
  const listRef = useRef<HTMLDivElement>(null)
  const all = catalog?.[player.classId] ?? []
  const slots = SLOT_ORDER.filter(s => all.some(item => item.slot === s && item.model))
  const items = useMemo(() => {
    const models = new Set<string>()
    return all.filter(item => {
      const inHand = item.id === player.weapon
      if (slot !== 'all' && item.slot !== slot) return false
      if (!item.model) return inHand || item.id in KNOWN_BROKEN
      if (models.has(item.model)) return inHand
      models.add(item.model)
      return true
    })
  }, [all, slot, player.weapon])
  const index = items.findIndex(item => item.id === player.weapon)
  const current = all.find(item => item.id === player.weapon)

  const step = (by: number) => {
    if (!items.length) return
    const from = index < 0 ? (by > 0 ? -1 : 0) : index
    holdWeapon(player, items[(((from + by) % items.length) + items.length) % items.length])
  }
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '[') stepRef.current(-1)
      else if (event.key === ']') stepRef.current(1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [player.weapon, slot])

  const row = (item: CatalogItem) => (
    <button
      key={item.id}
      type="button"
      data-current={item.id === player.weapon}
      onClick={() => holdWeapon(player, item)}
      title={item.broken ?? item.model ?? ''}
      className={cn(
        'flex w-full items-baseline gap-1.5 rounded-[2px] px-1 py-[1px] text-left',
        item.id === player.weapon ? 'bg-[#e8b54a]/25' : 'hover:bg-white/5',
        !item.model && ink.faint
      )}
    >
      <span className={cn('w-9 shrink-0 tabular-nums', ink.faint)}>{item.id}</span>
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {item.broken && <span className={item.model ? 'text-[#e8b54a]' : 'text-[#ff5b6b]'}>!</span>}
    </button>
  )

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {['all', ...slots].map(s => (
          <Btn key={s} active={slot === s} onClick={() => setSlot(s)}>
            {s}
          </Btn>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <Btn onClick={() => step(-1)} title="Previous ( [ )">
          ‹
        </Btn>
        <span className="min-w-0 flex-1 truncate text-center" title={current?.broken ?? undefined}>
          {current?.name ?? (player.weapon == null ? 'nothing in hand' : `#${player.weapon}`)}
        </span>
        {current?.broken && (
          <Tag tone={current.model ? 'warn' : 'bad'} title={current.broken}>
            {current.model ? 'broken' : 'not built'}
          </Tag>
        )}
        <span className={cn('tabular-nums', ink.faint)}>
          {index >= 0 ? index + 1 : '–'}/{items.length}
        </span>
        <Btn onClick={() => step(1)} title="Next ( ] )">
          ›
        </Btn>
      </div>
      {current?.broken && <Explain tone={current.model ? 'warn' : 'bad'}>{current.broken}</Explain>}
      <div ref={listRef} className="mt-1 max-h-44 overflow-y-auto">
        {!catalog && <Note>loading the viewmodel manifest …</Note>}
        {items.map((item, i) => (
          <div key={item.id}>
            {slot === 'all' && item.slot !== items[i - 1]?.slot && (
              <div
                className={cn(
                  'px-1 pt-1 text-[10px] uppercase tracking-wider first:pt-0',
                  ink.faint
                )}
              >
                {item.slot}
              </div>
            )}
            {row(item)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-end">
        <div
          className="w-36"
          title="Fires every this many ticks, so the fire animation loops (0: never)"
        >
          <Scrub
            label="fire every"
            value={player.fireEvery}
            min={0}
            max={6600}
            step={2}
            onChange={fireEvery => updatePlayer(player.id, { fireEvery })}
          />
        </div>
      </div>
    </>
  )
}

/** What the rig in hand is made of, as tags; the bones left at rest named in red. */
const RigReport = ({ rig }: { rig: ViewmodelRigInfo }) => (
  <div className="mt-1 space-y-1">
    <div className="flex flex-wrap gap-1">
      <Tag title={rig.weaponUrl}>{rig.key.split('-').slice(2, 3)[0]}</Tag>
      <Tag title={`Bones the weapon is skinned to`}>{rig.weaponBones} bones</Tag>
      {rig.unmatchedBones.length > 0 && (
        <Tag title={`Not on the arms, hung from an arm bone: ${rig.unmatchedBones.join(' ')}`}>
          {rig.unmatchedBones.length} off arms
        </Tag>
      )}
      <Tag tone={rig.strandedBones.length ? 'bad' : 'good'}>
        {rig.strandedBones.length ? `${rig.strandedBones.length} at rest` : 'rig ok'}
      </Tag>
      {rig.missingClips.length > 0 && (
        <Tag tone="warn" title={rig.missingClips.join(' ')}>
          {rig.missingClips.length} clips missing
        </Tag>
      )}
    </div>
    {rig.strandedBones.length > 0 && (
      <div className="text-[#ff5b6b]">{rig.strandedBones.join(' ')}</div>
    )}
    <Explain>
      Off arms: weapon bones the arms lack, hung from the arm bone they hang from. At rest: ones
      that hang from nothing on the arms, left at the weapon&apos;s rest pose while the hand moves.
      Clips: idle {rig.clips.idle.length}, draw {rig.clips.draw.length}, fire{' '}
      {rig.clips.fire.length}.
    </Explain>
  </div>
)

const ViewmodelTools = ({ player }: { player: DebugPlayer }) => {
  const povId = usePovId()
  const clip = useViewmodelDebug(s => s.clip)
  const bones = useViewmodelDebug(s => !!s.bones)
  const rig = useViewmodelDebug(s => s.rig)
  const enabled = useStore(s => s.settings.ui.viewmodel?.enabled !== false)
  if (povId !== player.id) {
    return (
      <div className="flex items-center gap-1">
        <Explain>Shown in their POV.</Explain>
        <Btn onClick={() => void viewPlayer(player.id)} title="The viewmodel shows in their POV">
          pov
        </Btn>
      </div>
    )
  }
  return (
    <>
      {!enabled && (
        <div className="flex items-center gap-1">
          <Note tone="warn">Weapons in POV are off in Settings.</Note>
          <Btn onClick={() => void updateSettingsOptionAction('ui.viewmodel.enabled', true)}>
            turn on
          </Btn>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {(['auto', 'idle', 'draw', 'fire'] as ViewmodelClip[]).map(c => (
          <Btn
            key={c}
            active={clip === c}
            onClick={() => useViewmodelDebug.setState({ clip: c })}
            title={
              c === 'auto'
                ? 'As a demo plays it: drawn when it comes out, fired on each shot'
                : `Loop the ${c} clip`
            }
          >
            {c}
          </Btn>
        ))}
        <Btn
          active={bones}
          onClick={() => useViewmodelDebug.setState({ bones: bones ? null : createBonesOverlay })}
          title="Green: the arms. Amber: weapon bones hung from an arm bone. Red: left at the weapon's rest pose."
        >
          bones
        </Btn>
      </div>
      {rig ? (
        <RigReport rig={rig} />
      ) : (
        <Explain short="empty hand">Nothing in hand (or still loading).</Explain>
      )}
    </>
  )
}

const PlayerInspector = ({ player }: { player: DebugPlayer }) => {
  const set = (patch: Partial<DebugPlayer>) => updatePlayer(player.id, patch)
  const maxHealth = HEALTH_MAP[player.classId] ?? 125
  // TF2's most overheal: half again, rounded down to 5 (a scout's 185, a heavy's 450).
  const overheal = Math.floor((maxHealth * 1.5) / 5) * 5
  return (
    <>
      <Group title="Player">
        <Prop label="name">
          <TextInput value={player.name} onChange={name => set({ name })} label="Name" />
        </Prop>
        <Prop label="team">
          <TeamButtons team={player.team} onChange={team => set({ team })} />
        </Prop>
        <Prop label="class">
          {CLASS_ORDER.map(id => (
            <button
              key={id}
              type="button"
              title={className(id)}
              onClick={() => set(classPatch(player, id))}
              className={cn(
                'rounded-[2px] p-[1px]',
                player.classId === id ? 'bg-[#e8b54a]' : 'opacity-50 hover:opacity-100'
              )}
            >
              <ClassIcon classId={id} size={15} />
            </button>
          ))}
        </Prop>
        <Prop label="health">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
            <div className="min-w-0 flex-1">
              <Scrub
                label="hp"
                value={player.health}
                min={0}
                max={999}
                onChange={health => set({ health })}
              />
            </div>
            {[
              { label: '0%', health: 0 },
              { label: '100%', health: maxHealth },
              { label: '150%', health: overheal },
            ].map(option => (
              <Btn
                key={option.label}
                active={player.health === option.health}
                onClick={() => set({ health: option.health })}
                title={`${option.health} hp`}
              >
                {option.label}
              </Btn>
            ))}
          </div>
        </Prop>
        <Prop label="condition">
          <div className="min-w-0 flex-1">
            <StatusPicker player={player} />
          </div>
        </Prop>
      </Group>
      {player.classId === 5 && (
        <Group title="Medigun">
          <Medigun player={player} />
        </Group>
      )}
      <Group title="Weapon">
        <WeaponBrowser player={player} />
      </Group>
      <Group title="Viewmodel">
        <ViewmodelTools player={player} />
      </Group>
      <Group title="Transform" startFolded>
        <Place pos={player.pos} onChange={pos => set({ pos })} />
        <div className="mt-1 grid grid-cols-3 gap-1">
          <Scrub
            label="pit"
            value={player.ang[0]}
            min={-89}
            max={89}
            onChange={v => set({ ang: [v, player.ang[1]] })}
          />
          <Scrub
            label="yaw"
            value={player.ang[1]}
            step={2}
            onChange={v => set({ ang: [player.ang[0], v] })}
          />
          <Scrub label="spin" value={player.spin} step={2} onChange={spin => set({ spin })} />
        </div>
      </Group>
    </>
  )
}

// ─── Objects ────────────────────────────────────────────────────────────────────

const ProjectileInspector = ({ projectile: p }: { projectile: DebugProjectile }) => {
  const set = (patch: Partial<DebugProjectile>) => updateProjectile(p.id, patch)
  const moving = p.vel.some(v => v !== 0)
  return (
    <>
      <Prop label="type">
        <Select
          value={p.type}
          options={PROJECTILE_TYPES.map(t => ({ value: t, label: t }))}
          onChange={type => set({ type })}
          label="Type"
        />
      </Prop>
      <Prop label="team">
        <TeamButtons team={p.team} onChange={team => set({ team })} />
      </Prop>
      <Group title="Place">
        <Place pos={p.pos} onChange={pos => set({ pos })} />
      </Group>
      <Group title="Flight">
        <div className="grid grid-cols-3 gap-1">
          {(['vx', 'vy', 'vz'] as const).map((axis, i) => (
            <Scrub
              key={axis}
              label={axis}
              value={p.vel[i]}
              step={20}
              onChange={v => set({ vel: p.vel.map((o, j) => (j === i ? v : o)) as Vec3 })}
            />
          ))}
        </div>
        {moving ? (
          <div className="mt-1 grid grid-cols-2 gap-1">
            <Scrub
              label="ticks"
              value={p.life}
              min={1}
              max={660}
              onChange={life => set({ life })}
            />
            <Btn active={p.gravity} onClick={() => set({ gravity: !p.gravity })}>
              gravity
            </Btn>
          </div>
        ) : (
          <div className="mt-1 w-24">
            <Scrub label="yaw" value={p.yaw} step={2} onChange={yaw => set({ yaw })} />
          </div>
        )}
        <Explain>
          {moving
            ? 'Flies for its ticks, is gone a moment (it explodes), then flies again.'
            : 'At rest. Give it a velocity to fly.'}
        </Explain>
      </Group>
    </>
  )
}

const BuildingInspector = ({ building: b }: { building: DebugBuilding }) => {
  const set = (patch: Partial<DebugBuilding>) => updateBuilding(b.id, patch)
  const engineers = useDebug(s => s.scenario.players).filter(p => p.classId === 9)
  return (
    <>
      <Prop label="kind">
        {(['sentry', 'dispenser', 'teleporter'] as const).map(kind => (
          <Btn
            key={kind}
            active={b.kind === kind}
            onClick={() => set({ kind, mini: kind === 'sentry' && b.mini })}
          >
            {kind}
          </Btn>
        ))}
      </Prop>
      <Prop label="team">
        <TeamButtons team={b.team} onChange={team => set({ team })} />
      </Prop>
      <Prop label="level">
        {[1, 2, 3].map(level => (
          <Btn
            key={level}
            active={!b.mini && b.level === level}
            onClick={() => set({ level, mini: false })}
          >
            {level}
          </Btn>
        ))}
        {b.kind === 'sentry' && (
          <Btn active={b.mini} onClick={() => set({ mini: !b.mini, level: 1 })}>
            mini
          </Btn>
        )}
      </Prop>
      <Prop label="state">
        <Btn active={b.sapped} onClick={() => set({ sapped: !b.sapped })}>
          sapped
        </Btn>
        <Btn active={b.constructing} onClick={() => set({ constructing: !b.constructing })}>
          being built
        </Btn>
        {b.kind === 'teleporter' && (
          <Btn active={b.entrance} onClick={() => set({ entrance: !b.entrance })}>
            entrance
          </Btn>
        )}
        {b.kind === 'sentry' && (
          <Btn active={b.sweep} onClick={() => set({ sweep: !b.sweep })}>
            sweeps
          </Btn>
        )}
        {b.kind === 'sentry' && (
          <Btn active={b.attacking} onClick={() => set({ attacking: !b.attacking })}>
            firing
          </Btn>
        )}
      </Prop>
      <Prop label="health">
        <div className="w-24">
          <Scrub
            label="%"
            value={b.health}
            min={1}
            max={100}
            onChange={health => set({ health })}
          />
        </div>
      </Prop>
      <Prop label="engineer">
        <Select
          value={b.builder || -1}
          label="Engineer"
          options={[
            { value: -1, label: 'nobody' },
            ...engineers.map(p => ({ value: p.id, label: p.name })),
          ]}
          onChange={id => set({ builder: id < 0 ? 0 : id })}
        />
      </Prop>
      <Group title="Place">
        <Place pos={b.pos} onChange={pos => set({ pos })} />
        <div className="mt-1 w-24">
          <Scrub label="yaw" value={b.yaw} step={2} onChange={yaw => set({ yaw })} />
        </div>
      </Group>
    </>
  )
}

// ─── Inspector ──────────────────────────────────────────────────────────────────

/** What the inspector is showing, for its window title. */
export const useInspected = () => {
  const scenario = useDebug(s => s.scenario)
  const selected = useDebug(s => s.selected)
  if (selected?.kind === 'player') return scenario.players.find(p => p.id === selected.id)
  if (selected?.kind === 'projectile') return scenario.projectiles.find(p => p.id === selected.id)
  if (selected?.kind === 'building') return scenario.buildings.find(b => b.id === selected.id)
  return undefined
}

export const inspectedTitle = (thing: ReturnType<typeof useInspected>) =>
  !thing
    ? 'Inspector'
    : 'name' in thing
      ? thing.name
      : 'kind' in thing
        ? `${thing.kind} ${thing.id}`
        : `${thing.type} ${thing.id}`

export const InspectorBody = () => {
  const selected = useDebug(s => s.selected)
  const thing = useInspected()
  if (!thing || !selected)
    return <Explain short="nothing selected">Pick a player or object in the Scene window.</Explain>
  if (selected.kind === 'player')
    return <PlayerInspector key={thing.id} player={thing as DebugPlayer} />
  if (selected.kind === 'projectile')
    return <ProjectileInspector key={thing.id} projectile={thing as DebugProjectile} />
  return <BuildingInspector key={thing.id} building={thing as DebugBuilding} />
}

export const InspectorTitle = () => {
  const thing = useInspected()
  return (
    <span className="flex items-center gap-1">
      {thing && 'team' in thing && (
        <span className="h-2 w-2 rounded-full" style={{ background: teamHex(thing.team) }} />
      )}
      Inspector{thing ? ` · ${inspectedTitle(thing)}` : ''}
    </span>
  )
}
