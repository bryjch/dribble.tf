import { useEffect, useState } from 'react'

import type { BuildingKind } from '@components/Analyse/Data/StreamEvents'
import { FaTrashIcon } from '@components/Misc/Icons'
import { ClassIcon } from '@components/UI/ClassIcon'
import { useInstance } from '@zus/store'
import { builtMapNames } from '@utils/derivedMap'
import { cn } from '@utils/styling'

import { Btn, Explain, Group, ink, Note, Prop, Select } from './controls'
import {
  CONDITIONS,
  UBERS,
  addPlayer,
  className,
  removePlayer,
  teamHex,
  teamLabel,
  usePovId,
} from './edit'
import { PRESETS, buildPreset } from './presets'
import {
  CLASS_ORDER,
  PROJECTILE_TYPES,
  ProjectileType,
  Team,
  Vec3,
  emptyScenario,
  newBuilding,
  newProjectile,
  nextObjectId,
  normalizeScenario,
} from './scenario'
import {
  Selection,
  lookAt,
  mapAnchor,
  moveToMap,
  pointAtViewCenter,
  select,
  setScenario,
  shareUrl,
  updateScenario,
  useDebug,
  viewPlayer,
} from './session'

const PROJECTILE_LABELS: Record<ProjectileType, string> = {
  rocket: 'rocket',
  pipebomb: 'pipe',
  stickybomb: 'sticky',
  healingBolt: 'crossbow bolt',
}
/** Units a second each flies at, roughly as in TF2. */
const SPEEDS: Record<ProjectileType, number> = {
  rocket: 1100,
  pipebomb: 1200,
  stickybomb: 900,
  healingBolt: 2400,
}

const isSelected = (selected: Selection, kind: string, id: number) =>
  selected?.kind === kind && selected.id === id

/** Where new things go: the middle of the screen on the map, else near the last player. */
const here = (): Vec3 => {
  const point = pointAtViewCenter()
  if (point) return point
  const last = useDebug.getState().scenario.players.slice(-1)[0]
  return last ? [last.pos[0], last.pos[1] + 120, last.pos[2]] : [0, 0, 0]
}

const Row = ({
  selected,
  onClick,
  team,
  children,
  onRemove,
}: {
  selected: boolean
  onClick: () => void
  team: string
  children: React.ReactNode
  onRemove: () => void
}) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={event => event.key === 'Enter' && onClick()}
    className={cn(
      'group flex cursor-pointer items-center gap-1 rounded-[2px] px-1 py-[1px]',
      selected ? 'bg-[#e8b54a]/25' : 'hover:bg-white/5'
    )}
  >
    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: teamHex(team) }} />
    {children}
    <button
      type="button"
      title="Remove"
      aria-label="Remove"
      onClick={event => {
        event.stopPropagation()
        onRemove()
      }}
      className={cn(
        'flex w-3 shrink-0 justify-center opacity-0 hover:text-[#ff5b6b] focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
        ink.muted
      )}
    >
      <FaTrashIcon className="h-2.5 w-2.5" />
    </button>
  </div>
)

const TeamPlayers = ({ team }: { team: Team }) => {
  const players = useDebug(s => s.scenario.players)
  const selected = useDebug(s => s.selected)
  const povId = usePovId()
  const [adding, setAdding] = useState(false)
  const mine = players.filter(p => p.team === team)
  return (
    <div className="mb-1">
      <div
        className={cn(
          'flex items-center justify-between text-[10px] uppercase tracking-wider',
          ink.faint
        )}
      >
        <span style={{ color: teamHex(team) }}>
          {teamLabel(team)} {mine.length}
        </span>
        <button
          type="button"
          className="px-1 hover:text-white"
          onClick={() => setAdding(!adding)}
          title={`Add a ${teamLabel(team)} player`}
        >
          {adding ? '−' : '+'}
        </button>
      </div>
      {adding && (
        <div className="mb-1 flex gap-[2px]">
          {CLASS_ORDER.map(id => (
            <button
              key={id}
              type="button"
              title={`Add a ${teamLabel(team)} ${className(id)}`}
              onClick={() => {
                addPlayer(team, id)
                setAdding(false)
              }}
              className="rounded-[2px] p-[1px] opacity-60 hover:bg-white/10 hover:opacity-100"
            >
              <ClassIcon classId={id} size={16} />
            </button>
          ))}
        </div>
      )}
      {mine.map(p => (
        <Row
          key={p.id}
          team={p.team}
          selected={isSelected(selected, 'player', p.id)}
          onClick={() => {
            select({ kind: 'player', id: p.id })
            void viewPlayer(p.id)
          }}
          onRemove={() => removePlayer(p.id)}
        >
          <ClassIcon classId={p.classId} size={13} />
          <span
            className={cn('min-w-0 flex-1 truncate', p.health <= 0 && 'line-through opacity-60')}
          >
            {p.name}
          </span>
          {p.ubered && (
            <span className="text-[#ff5b6b]" title={UBERS[p.ubered].label}>
              {UBERS[p.ubered].short}
            </span>
          )}
          {p.conditions.slice(0, 3).map(flag => (
            <span
              key={flag}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              title={CONDITIONS[flag].label}
              style={{ background: CONDITIONS[flag].color }}
            />
          ))}
          {povId === p.id && (
            <span className="text-[#57d68d]" title="In their POV">
              ◉
            </span>
          )}
          <span className={cn('w-7 text-right tabular-nums', ink.muted)}>{p.health}</span>
        </Row>
      ))}
    </div>
  )
}

/** The + in a section's title bar, with how many it has. */
const AddButton = ({
  count,
  open,
  onClick,
  title,
}: {
  count: number
  open: boolean
  onClick: () => void
  title: string
}) => (
  <span className={cn('flex items-center gap-1.5 text-[10px]', ink.faint)}>
    {count > 0 && <span className="tabular-nums">{count}</span>}
    <button type="button" className="px-1 hover:text-white" onClick={onClick} title={title}>
      {open ? '−' : '+'}
    </button>
  </span>
)

/** The team new objects go to, shared by the projectile and building pickers. */
const TeamPick = ({ team, onChange }: { team: Team; onChange: (team: Team) => void }) => (
  <>
    <Btn active={team === 'red'} onClick={() => onChange('red')}>
      RED
    </Btn>
    <Btn active={team === 'blue'} onClick={() => onChange('blue')}>
      BLU
    </Btn>
  </>
)

const Projectiles = ({ adding, onAdded }: { adding: boolean; onAdded: () => void }) => {
  const projectiles = useDebug(s => s.scenario.projectiles)
  const selected = useDebug(s => s.selected)
  const [team, setTeam] = useState<Team>('red')
  const [flying, setFlying] = useState(false)

  const add = (type: ProjectileType) => {
    const id = nextObjectId(useDebug.getState().scenario, 100)
    const pos = here()
    const lob = type === 'pipebomb' || type === 'stickybomb'
    const speed = SPEEDS[type]
    updateScenario(s => ({
      ...s,
      projectiles: [
        ...s.projectiles,
        newProjectile({
          id,
          type,
          team,
          pos: flying ? [pos[0], pos[1] - 500, pos[2] + 60] : [pos[0], pos[1], pos[2] + 8],
          yaw: 90,
          vel: flying ? [0, speed, lob ? 400 : 0] : [0, 0, 0],
          gravity: flying && lob,
          life: flying ? Math.round((1000 / speed) * 66) : 66,
        }),
      ],
    }))
    select({ kind: 'projectile', id })
    onAdded()
  }

  return (
    <>
      {adding && (
        <div className="mb-1.5 space-y-1">
          <div className="flex flex-wrap gap-1">
            <TeamPick team={team} onChange={setTeam} />
            <span className="w-1" />
            <Btn active={!flying} onClick={() => setFlying(false)}>
              at rest
            </Btn>
            <Btn
              active={flying}
              onClick={() => setFlying(true)}
              title="Crosses the middle of the screen, again and again"
            >
              flying
            </Btn>
          </div>
          <div className="flex flex-wrap gap-1">
            {PROJECTILE_TYPES.map(type => (
              <Btn key={type} onClick={() => add(type)} title="Place at the middle of the screen">
                + {PROJECTILE_LABELS[type]}
              </Btn>
            ))}
          </div>
          <Explain>
            Placed where the middle of the screen meets the map. Arrows, flares and the rest
            aren&apos;t read from demos yet, so the viewer doesn&apos;t draw them.
          </Explain>
        </div>
      )}
      {projectiles.map(p => (
        <Row
          key={p.id}
          team={p.team}
          selected={isSelected(selected, 'projectile', p.id)}
          onClick={() => {
            select({ kind: 'projectile', id: p.id })
            void lookAt(p.pos)
          }}
          onRemove={() => {
            updateScenario(s => ({ ...s, projectiles: s.projectiles.filter(q => q.id !== p.id) }))
            if (isSelected(selected, 'projectile', p.id)) select(null)
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {PROJECTILE_LABELS[p.type]}
            {p.vel.some(v => v !== 0) && <span className={ink.faint}> flying</span>}
          </span>
        </Row>
      ))}
      {!adding && projectiles.length === 0 && <Note>none</Note>}
    </>
  )
}

const BUILDING_KINDS: BuildingKind[] = ['sentry', 'dispenser', 'teleporter']

const Buildings = ({ adding, onAdded }: { adding: boolean; onAdded: () => void }) => {
  const buildings = useDebug(s => s.scenario.buildings)
  const selected = useDebug(s => s.selected)
  const [team, setTeam] = useState<Team>('red')

  const add = (kind: BuildingKind) => {
    const id = nextObjectId(useDebug.getState().scenario, 100)
    updateScenario(s => ({
      ...s,
      buildings: [
        ...s.buildings,
        newBuilding({
          id,
          kind,
          team,
          pos: here(),
          yaw: team === 'red' ? 90 : -90,
          sweep: kind === 'sentry',
        }),
      ],
    }))
    select({ kind: 'building', id })
    onAdded()
  }

  return (
    <>
      {adding && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          <TeamPick team={team} onChange={setTeam} />
          <span className="w-1" />
          {BUILDING_KINDS.map(kind => (
            <Btn key={kind} onClick={() => add(kind)} title="Place at the middle of the screen">
              + {kind}
            </Btn>
          ))}
        </div>
      )}
      {buildings.map(b => (
        <Row
          key={b.id}
          team={b.team}
          selected={isSelected(selected, 'building', b.id)}
          onClick={() => {
            select({ kind: 'building', id: b.id })
            void lookAt(b.pos)
          }}
          onRemove={() => {
            updateScenario(s => ({ ...s, buildings: s.buildings.filter(q => q.id !== b.id) }))
            if (isSelected(selected, 'building', b.id)) select(null)
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {b.mini ? 'mini-sentry' : `${b.kind} ${b.level}`}
            <span className={ink.faint}>
              {b.kind === 'teleporter' ? (b.entrance ? ' entrance' : ' exit') : ''}
              {b.sapped ? ' sapped' : ''}
              {b.constructing ? ' building' : ''}
            </span>
          </span>
        </Row>
      ))}
      {!adding && buildings.length === 0 && <Note>none</Note>}
    </>
  )
}

const SceneSettings = () => {
  const scenario = useDebug(s => s.scenario)
  const status = useDebug(s => s.status)
  const match = useInstance(s => s.match)
  const [maps, setMaps] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [json, setJson] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  useEffect(() => {
    builtMapNames().then(setMaps)
  }, [])

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1400)
    } catch {
      window.prompt('Copy this:', text)
    }
  }
  const load = async (id: string) => {
    const next =
      id === 'empty'
        ? emptyScenario(scenario.map)
        : buildPreset(id, await mapAnchor(scenario.map), scenario.map)
    if (!next) return
    select(null)
    void setScenario(next)
  }

  return (
    <>
      {status && <Note>{status}</Note>}
      {match && match.kind !== 'debug' && (
        <div className="flex items-center justify-between gap-1">
          <Note tone="warn">A {match.kind} is open in place of the scene.</Note>
          <Btn onClick={() => void setScenario(scenario)}>back</Btn>
        </div>
      )}
      <Prop label="map">
        <Select
          className="min-w-0 flex-1"
          value={scenario.map}
          label="Map"
          options={(maps.includes(scenario.map) ? maps : [scenario.map, ...maps]).map(map => ({
            value: map,
            label: map,
          }))}
          onChange={async map => setScenario(await moveToMap(useDebug.getState().scenario, map))}
        />
      </Prop>
      <Prop label="load" top>
        <div className="grid w-full grid-cols-2 gap-1">
          {[...PRESETS, { id: 'empty', label: 'Empty', description: 'Nothing: an empty map' }].map(
            preset => (
              <Btn
                key={preset.id}
                title={preset.description}
                onClick={() => void load(preset.id)}
                className="truncate whitespace-nowrap text-left"
              >
                {preset.label}
              </Btn>
            )
          )}
        </div>
      </Prop>
      <Explain>
        Loading replaces everything in the scene; everything moves with the map, to where play
        happens on it.
      </Explain>
      <Prop label="share">
        <Btn
          onClick={() => void copy(shareUrl(), 'link')}
          title="This scene, its tick (paused or not) and the POV or camera"
        >
          {copied === 'link' ? 'copied' : 'copy link'}
        </Btn>
        <Btn
          active={json != null}
          onClick={() => setJson(json == null ? JSON.stringify(scenario, null, 2) : null)}
        >
          edit json
        </Btn>
      </Prop>
      {json != null && (
        <>
          <textarea
            className="mt-1 h-48 w-full rounded-[2px] bg-white/[0.06] p-1 text-[10px] outline-none focus:bg-white/10"
            spellCheck={false}
            value={json}
            onChange={event => {
              setJson(event.target.value)
              setJsonError(null)
            }}
          />
          <Explain>
            Kills, chat and über pops go in &quot;events&quot;, e.g.{' '}
            {'{"type":"kill","tick":200,"killer":1,"victim":7,"weapon":"tf_projectile_rocket"}'}
          </Explain>
          {jsonError && <Note tone="bad">{jsonError}</Note>}
          <div className="flex justify-end gap-1">
            <Btn onClick={() => void copy(json, 'json')}>
              {copied === 'json' ? 'copied' : 'copy'}
            </Btn>
            <Btn
              active
              onClick={() => {
                try {
                  void setScenario(normalizeScenario(JSON.parse(json)))
                  setJson(null)
                } catch (error) {
                  setJsonError(error instanceof Error ? error.message : String(error))
                }
              }}
            >
              apply
            </Btn>
          </div>
        </>
      )}
    </>
  )
}

/** The scene: what's in it (players by team, projectiles, buildings) and the scene itself. */
export const SceneWindowBody = () => {
  const projectiles = useDebug(s => s.scenario.projectiles.length)
  const buildings = useDebug(s => s.scenario.buildings.length)
  const [adding, setAdding] = useState<'projectile' | 'building' | null>(null)
  const toggle = (what: 'projectile' | 'building') => setAdding(adding === what ? null : what)
  return (
    <>
      <Group title="Players">
        <TeamPlayers team="red" />
        <TeamPlayers team="blue" />
      </Group>
      <Group
        title="Projectiles"
        startFolded={projectiles === 0}
        forceOpen={adding === 'projectile'}
        right={
          <AddButton
            count={projectiles}
            open={adding === 'projectile'}
            onClick={() => toggle('projectile')}
            title="Add a projectile"
          />
        }
      >
        <Projectiles adding={adding === 'projectile'} onAdded={() => setAdding(null)} />
      </Group>
      <Group
        title="Buildings"
        startFolded={buildings === 0}
        forceOpen={adding === 'building'}
        right={
          <AddButton
            count={buildings}
            open={adding === 'building'}
            onClick={() => toggle('building')}
            title="Add a building"
          />
        }
      >
        <Buildings adding={adding === 'building'} onAdded={() => setAdding(null)} />
      </Group>
      <Group title="Scene">
        <SceneSettings />
      </Group>
    </>
  )
}
