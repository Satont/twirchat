import { expect, test } from 'bun:test'

import {
  clearChatTabHistory,
  createChatTabHistory,
  navigateChatTabHistory,
  visitChatTab,
} from '../src/gpuix/state/tab-history'

test('back/forward does not record navigation as a new visit', () => {
  const history = createChatTabHistory()
  for (const id of ['home', 'a', 'b']) history.visit(id)
  expect(history.navigate(-1, 'b', ['home', 'a', 'b'])).toBe('a')
  history.visit('a')
  expect(history.navigate(-1, 'a', ['home', 'a', 'b'])).toBe('home')
  history.visit('home')
  expect(history.navigate(1, 'home', ['home', 'a', 'b'])).toBe('a')
  history.visit('a')
  expect(history.navigate(1, 'a', ['home', 'a', 'b'])).toBe('b')
  expect(history.snapshot().entries).toEqual(['home', 'a', 'b'])
})
test('manual navigation truncates the forward branch and repeated current visits stay stable', () => {
  const history = createChatTabHistory()
  for (const id of ['a', 'b', 'c']) history.visit(id)
  history.navigate(-1, 'c', ['a', 'b', 'c', 'd'])
  history.visit('b')
  history.visit('b')
  history.visit('d')
  expect(history.snapshot().entries).toEqual(['a', 'b', 'd'])
  expect(history.navigate(1, 'd', ['a', 'b', 'c', 'd'])).toBeNull()
})
test('closed entries are pruned deterministically even when the cursor tab closes', () => {
  const back = createChatTabHistory()
  for (const id of ['a', 'b', 'c']) back.visit(id)
  back.navigate(-1, 'c', ['a', 'b', 'c'])
  back.visit('b')
  expect(back.navigate(-1, 'b', ['a', 'c'])).toBe('a')
  const forward = createChatTabHistory()
  for (const id of ['a', 'b', 'c']) forward.visit(id)
  forward.navigate(-1, 'c', ['a', 'b', 'c'])
  forward.visit('b')
  expect(forward.navigate(1, 'b', ['a', 'c'])).toBe('c')
})
test('history is bounded, has no edge wrap and isolates windows', () => {
  const history = createChatTabHistory(2)
  for (const id of ['a', 'b', 'c']) history.visit(id)
  expect(history.snapshot().entries).toEqual(['b', 'c'])
  expect(history.navigate(1, 'c', ['b', 'c'])).toBeNull()
  visitChatTab('a', 'one')
  visitChatTab('b', 'one')
  visitChatTab('c', 'two')
  expect(navigateChatTabHistory(-1, 'b', ['a', 'b'], 'one')).toBe('a')
  expect(navigateChatTabHistory(-1, 'c', ['a', 'b', 'c'], 'two')).toBeNull()
  clearChatTabHistory('one')
  clearChatTabHistory('two')
})
