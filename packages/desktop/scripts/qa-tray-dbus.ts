import assert from 'node:assert/strict'

import { assertGuiQaEnvironment } from '../src/services/gui-qa'

export async function privateTrayBus(
  destination: string,
  path: string,
  method: string,
  args: string[] = [],
): Promise<string> {
  assertGuiQaEnvironment()
  assert(process.env.TWIRCHAT_QA_DBUS === '1', 'Tray QA requires the private --dbus session.')
  const child = Bun.spawn(
    [
      '/usr/bin/gdbus',
      'call',
      '--session',
      '--dest',
      destination,
      '--object-path',
      path,
      '--method',
      method,
      '--',
      ...args,
    ],
    { stdout: 'pipe', stderr: 'pipe', timeout: 5000 },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  assert.equal(code, 0, `Private D-Bus call failed: ${stderr}`)
  return stdout
}

export async function privateTrayNames(): Promise<string[]> {
  const result = await privateTrayBus(
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus.ListNames',
  )
  return [...result.matchAll(/'([^']+)'/g)].flatMap((match) => (match[1] ? [match[1]] : []))
}

export async function privateTrayMenu(item: string): Promise<{ path: string; layout: string }> {
  const property = await privateTrayBus(
    item,
    '/StatusNotifierItem',
    'org.freedesktop.DBus.Properties.Get',
    ['org.kde.StatusNotifierItem', 'Menu'],
  )
  const path = property.match(/'(\/[^']*)'/)?.[1]
  assert(path, 'SNI exports its native menu path.')
  const layout = await privateTrayBus(item, path, 'com.canonical.dbusmenu.GetLayout', [
    '0',
    '-1',
    '[]',
  ])
  return { path, layout }
}

export async function clickPrivateTrayMenu(item: string, label: string): Promise<void> {
  const { path, layout } = await privateTrayMenu(item)
  const entry = [...layout.matchAll(/\((\d+),\s*\{([^}]*)\}/g)].find((match) =>
    match[2]?.includes(`'label': <'${label}'>`),
  )
  const id = entry?.[1]
  assert(id, `The native menu exposes ${label}.`)
  await privateTrayBus(item, path, 'com.canonical.dbusmenu.Event', [id, 'clicked', '<0>', '0'])
}
