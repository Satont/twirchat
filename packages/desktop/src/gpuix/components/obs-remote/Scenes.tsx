import { useState } from 'react'

import type {
  ObsRemoteCommand,
  ObsRemoteSnapshot,
  ObsSceneItem,
} from '../../../services/obs-remote'
import type { ObsRemoteConnection } from '../../backend/obs-remote'
import { useTheme } from '../../theme-context'
import { ActionButton, FormInput } from '../ui/Form'
import { Text } from '../ui/Text'
import { Choice, Section } from './Controls'
import { Preview } from './Preview'

interface ScenesProps {
  snapshot: ObsRemoteSnapshot
  connection: ObsRemoteConnection
  active: boolean
  run: (command: ObsRemoteCommand) => void
  disabled: boolean
}

const THUMBNAILS_PER_PAGE = 6

function PageButtons({
  page,
  last,
  select,
}: {
  page: number
  last: number
  select: (page: number) => void
}) {
  if (!last) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
      <ActionButton disabled={page === 0} onClick={() => select(page - 1)}>
        Previous
      </ActionButton>
      <ActionButton disabled={page === last} onClick={() => select(page + 1)}>
        Next
      </ActionButton>
    </div>
  )
}

function RenameScene({ name, run }: { name: string; run: ScenesProps['run'] }) {
  const [draft, setDraft] = useState(name)
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
      <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
        <FormInput value={draft} onChange={setDraft} />
      </div>
      <ActionButton
        disabled={!draft.trim() || draft === name}
        onClick={() => run({ kind: 'rename-scene', scene: name, name: draft.trim() })}
      >
        Rename
      </ActionButton>
    </div>
  )
}

function SourceItem({
  item,
  run,
  disabled,
  depth = 0,
}: {
  item: ObsSceneItem
  run: ScenesProps['run']
  disabled: boolean
  depth?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: depth ? 12 : 0 }}>
      <ActionButton
        testId={`obs-source-${item.scene}-${item.id}`}
        disabled={disabled}
        primary={item.enabled}
        onClick={() =>
          run({ kind: 'scene-item', scene: item.scene, id: item.id, enabled: !item.enabled })
        }
      >
        {`${item.enabled ? '●' : '○'} ${item.name}`}
      </ActionButton>
      {item.children.map((child) => (
        <SourceItem
          key={`${child.scene}-${child.id}`}
          item={child}
          run={run}
          disabled={disabled}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

export function Scenes({ snapshot, connection, active, run, disabled }: ScenesProps) {
  const [editing, setEditing] = useState(false)
  const [thumbnails, setThumbnails] = useState(false)
  const [page, setPage] = useState(0)
  const [sourceView, setSourceView] = useState<'program' | 'preview' | 'hidden'>('hidden')
  const [switchName, setSwitchName] = useState('')
  const [switchPage, setSwitchPage] = useState(0)
  const theme = useTheme()
  const selected = snapshot.studioMode ? snapshot.previewScene : snapshot.programScene
  const sourceScene =
    snapshot.studioMode && sourceView === 'preview' ? selected : snapshot.programScene
  const current = snapshot.scenes.find((scene) => scene.name === sourceScene)
  const scenes = snapshot.scenes
    .filter((scene) => editing || !scene.name.includes('(hidden)'))
    .toReversed()
  const showThumbnails = thumbnails && !editing
  const lastPage = Math.max(0, Math.ceil(scenes.length / THUMBNAILS_PER_PAGE) - 1)
  const currentPage = Math.min(page, lastPage)
  const displayed = showThumbnails
    ? scenes.slice(currentPage * THUMBNAILS_PER_PAGE, (currentPage + 1) * THUMBNAILS_PER_PAGE)
    : scenes
  const switchScenes = snapshot.scenes.filter(({ name }) => name.includes('(switch)'))
  const switchScene = switchScenes.find(({ name }) => name === switchName)
  const lastSwitchPage = Math.max(
    0,
    Math.ceil((switchScene?.items.length ?? 0) / THUMBNAILS_PER_PAGE) - 1,
  )
  const currentSwitchPage = Math.min(switchPage, lastSwitchPage)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
      <Section
        title="Scenes"
        action={
          <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
            <ActionButton
              onClick={() => {
                setThumbnails(!thumbnails)
                setPage(0)
              }}
              disabled={editing}
            >
              {thumbnails ? 'List' : 'Thumbnails'}
            </ActionButton>
            <ActionButton onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Edit'}
            </ActionButton>
          </div>
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            maxHeight: 230,
            overflowY: 'scroll',
          }}
        >
          {displayed.map((scene) =>
            editing ? (
              <RenameScene key={scene.name} name={scene.name} run={run} />
            ) : (
              <div key={scene.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {showThumbnails ? (
                  <Preview
                    connection={connection}
                    source={scene.name}
                    active={active}
                    width={120}
                    thumbnail
                  />
                ) : null}
                <ActionButton
                  testId={`obs-scene-${scene.name}`}
                  disabled={disabled}
                  primary={scene.name === selected}
                  danger={scene.name === snapshot.programScene}
                  onClick={() =>
                    run({ kind: snapshot.studioMode ? 'preview' : 'program', scene: scene.name })
                  }
                >
                  {`${scene.name === snapshot.programScene ? 'PROGRAM · ' : scene.name === snapshot.previewScene && snapshot.studioMode ? 'PREVIEW · ' : ''}${scene.name}`}
                </ActionButton>
              </div>
            ),
          )}
        </div>
        {showThumbnails ? (
          <PageButtons page={currentPage} last={lastPage} select={setPage} />
        ) : null}
      </Section>
      <Section
        title="Sources"
        action={
          <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
            {snapshot.studioMode && sourceView !== 'hidden' ? (
              <ActionButton
                onClick={() => setSourceView(sourceView === 'program' ? 'preview' : 'program')}
              >
                {sourceView === 'program' ? 'Show preview' : 'Show program'}
              </ActionButton>
            ) : null}
            <ActionButton
              testId="obs-toggle-sources"
              onClick={() => setSourceView(sourceView === 'hidden' ? 'preview' : 'hidden')}
            >
              {sourceView === 'hidden' ? 'Show' : 'Hide'}
            </ActionButton>
          </div>
        }
      >
        {sourceView !== 'hidden' ? (
          <>
            <Text style={{ color: theme.text2, fontSize: 11 }}>{sourceScene || 'No scene'}</Text>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                maxHeight: 230,
                overflowY: 'scroll',
              }}
            >
              {current?.items.map((item) => (
                <SourceItem
                  key={`${item.scene}-${item.id}`}
                  item={item}
                  run={run}
                  disabled={disabled}
                />
              ))}
              {!current?.items.length ? (
                <Text style={{ color: theme.text2, fontSize: 12 }}>No sources in this scene.</Text>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>
      {switchScenes.length ? (
        <Section
          title="Source switcher"
          action={
            switchScene ? (
              <ActionButton onClick={() => setSwitchName('')}>Hide</ActionButton>
            ) : undefined
          }
        >
          <Choice
            label="Scene"
            value={switchScene?.name ?? ''}
            values={switchScenes.map(({ name }) => name)}
            onChange={(name) => {
              setSwitchName(name)
              setSwitchPage(0)
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {switchScene?.items
              .slice(
                currentSwitchPage * THUMBNAILS_PER_PAGE,
                (currentSwitchPage + 1) * THUMBNAILS_PER_PAGE,
              )
              .map((item) => (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Preview
                    key={item.name}
                    connection={connection}
                    source={item.name}
                    active={active}
                    width={120}
                    thumbnail
                  />
                  <ActionButton
                    disabled={disabled}
                    primary={item.enabled}
                    onClick={() => run({ kind: 'switch-source', scene: item.scene, id: item.id })}
                  >
                    {item.name}
                  </ActionButton>
                </div>
              ))}
          </div>
          <PageButtons page={currentSwitchPage} last={lastSwitchPage} select={setSwitchPage} />
        </Section>
      ) : null}
    </div>
  )
}
