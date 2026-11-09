import { createPCRE2, FLAGS, PCRE2MatchError, type PCRE2Regex } from 'pcre2-wasm'

import { t } from './i18n'

// One engine survives hot reloads. Handles are resolved on use so LRU eviction never
// invalidates a compiled filter retained by a chat pane.
declare global {
  var __chatPcre2: ReturnType<typeof createRuntime> | undefined
}
async function createRuntime() {
  return { engine: await createPCRE2(), cache: new Map<string, PCRE2Regex>() }
}
const state = await (globalThis.__chatPcre2 ??= createRuntime())
const LIMITS = '(*LIMIT_MATCH=10000)(*LIMIT_DEPTH=100)(*LIMIT_HEAP=512)'
function options(subject: string) {
  // PCRE2 restarts its counter at each unanchored starting position. Scale the
  // per-start allowance down for long subjects to bound total interpreter work.
  return {
    matchLimit: Math.max(100, Math.min(10000, Math.floor(100000 / Math.max(1, subject.length)))),
    depthLimit: 100,
  }
}

export class RuleRegex {
  constructor(
    readonly source: string,
    readonly insensitive = false,
  ) {
    if (source.length > 512) throw new Error(t('commands.rule.regexTooLong'))
    this.handle()
  }

  private handle(): PCRE2Regex {
    const key = `${this.insensitive ? 'i' : ''}:${this.source}`
    let handle = state.cache.get(key)
    if (handle) state.cache.delete(key)
    else {
      handle = state.engine.compile(
        LIMITS + this.source,
        FLAGS.UCP | (this.insensitive ? FLAGS.CASELESS : 0),
      )
    }
    state.cache.set(key, handle)
    if (state.cache.size > 128) {
      const oldest = state.cache.keys().next().value!
      state.cache.get(oldest)!.destroy()
      state.cache.delete(oldest)
    }
    return handle
  }

  exec(subject: string): (string | undefined)[] | null {
    try {
      const match = this.handle().match(subject.slice(0, 8192), options(subject))
      return match ? [match.match, ...match.groups.map((value) => value ?? undefined)] : null
    } catch (error) {
      if (error instanceof PCRE2MatchError) return null
      throw error
    }
  }

  test(subject: string): boolean {
    return this.exec(subject) !== null
  }

  matchAll(subject: string): { index: number; text: string }[] {
    const matches: { index: number; text: string }[] = []
    try {
      for (const match of this.handle().matchAllIterator(
        subject.slice(0, 8192),
        options(subject),
      )) {
        if (matches.length === 256) return []
        matches.push({ index: match.index, text: match.match })
      }
      return matches
    } catch (error) {
      // Never apply a partial replacement when the engine exhausts its budget.
      if (error instanceof PCRE2MatchError) return []
      throw error
    }
  }
}

export function compileRuleRegex(pattern: string, insensitive: boolean): RuleRegex {
  return new RuleRegex(pattern, insensitive)
}
