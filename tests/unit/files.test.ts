import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig, parseEnv } from '../../src/core/config.ts'
import {
  initFiles,
  loadRecordings,
  loadRules,
  saveEnv,
  saveRecordings,
  saveRules,
  writeAtomic,
} from '../../src/core/files.ts'
import { defaultRules, RulesError } from '../../src/core/rules.ts'
import type { Recording } from '../../src/shared/types.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockolla-files-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const at = (name: string) => path.join(dir, name)

describe('files on disk', () => {
  it('writes atomically, creating the folder and leaving no temp file', () => {
    writeAtomic(at('sub/deeper/a.txt'), 'one')
    writeAtomic(at('sub/deeper/a.txt'), 'two')
    expect(readFileSync(at('sub/deeper/a.txt'), 'utf8')).toBe('two')
    expect(readdirSync(at('sub/deeper'))).toEqual(['a.txt'])
  })

  it('creates .env and rules.json once, and overwrites only with force', () => {
    expect(initFiles(at('.env'), at('rules.json'))).toHaveLength(2)
    writeFileSync(at('rules.json'), JSON.stringify({ ...defaultRules(), rules: [] }))
    expect(initFiles(at('.env'), at('rules.json'))).toEqual([])
    expect(loadRules(at('rules.json')).rules).toEqual([])
    expect(initFiles(at('.env'), at('rules.json'), true)).toHaveLength(2)
    expect(loadRules(at('rules.json')).rules.length).toBe(defaultRules().rules.length)
  })

  it('keeps variables in .env it does not manage', () => {
    writeFileSync(at('.env'), '# my notes\nMY_OWN=keep me\nOTHER_TOOL_KEY=1\nMOCKOLLA_PORT=1\n')
    saveEnv(at('.env'), { ...defaultConfig(), port: 11500 })
    const env = parseEnv(readFileSync(at('.env'), 'utf8'))
    expect(env).toMatchObject({ MY_OWN: 'keep me', OTHER_TOOL_KEY: '1', MOCKOLLA_PORT: '11500' })
  })

  it('uses the built-in rules and no recordings when the files are missing', () => {
    expect(loadRules(at('none.json')).rules.length).toBe(defaultRules().rules.length)
    expect(loadRecordings(at('none.json'))).toEqual([])
  })

  it('saves and loads rules and recordings as they were', () => {
    const rules = { ...defaultRules(), rules: defaultRules().rules.slice(0, 3) }
    saveRules(at('r.json'), rules)
    expect(loadRules(at('r.json')).rules.map((r) => r.id)).toEqual(rules.rules.map((r) => r.id))

    const rec: Recording = {
      id: 'abc',
      model: 'llama3.2:3b',
      api: 'chat',
      prompt: 'hi',
      conversation: 'hi',
      chunks: ['he', 'llo'],
      thinking: [],
      toolCalls: [],
      ttftMs: 120,
      tps: 30,
      recordedAt: '2026-01-01T00:00:00.000Z',
      source: 'http://127.0.0.1:11434/v1',
    }
    saveRecordings(at('rec.json'), [rec])
    expect(loadRecordings(at('rec.json'))).toEqual([rec])
  })

  it('refuses a broken rules file instead of replacing it', () => {
    writeFileSync(at('bad.json'), '{ not json')
    expect(() => loadRules(at('bad.json'))).toThrow(RulesError)
    expect(readFileSync(at('bad.json'), 'utf8')).toBe('{ not json')
  })
})
