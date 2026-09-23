import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { MockConfig, RulesFile } from '../shared/types.ts'
import { applyEnv, defaultConfig, parseEnv, serializeEnv } from './config.ts'
import { defaultRules, parseRules } from './rules.ts'

/** Writes through a temp file, so a crash mid-save never leaves half a file. */
export function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

/** Rules from disk, or the built-in defaults when the file does not exist. Throws RulesError when invalid. */
export function loadRules(file: string): RulesFile {
  return existsSync(file) ? parseRules(readFileSync(file, 'utf8')) : defaultRules()
}

export const rulesToJson = (rules: RulesFile): string => `${JSON.stringify(rules, null, 2)}\n`

export function saveRules(file: string, rules: RulesFile): void {
  writeAtomic(file, rulesToJson(rules))
}

export function saveEnv(file: string, config: MockConfig): void {
  writeAtomic(file, serializeEnv(config, readText(file)))
}

/** Creates .env and rules.json with defaults where missing. Returns the files it wrote. */
export function initFiles(envPath: string, rulesPath: string, force = false): string[] {
  const written: string[] = []
  if (force || !existsSync(envPath)) {
    saveEnv(envPath, defaultConfig())
    written.push(envPath)
  }
  if (force || !existsSync(rulesPath)) {
    saveRules(rulesPath, defaultRules())
    written.push(rulesPath)
  }
  return written
}

export interface LoadedConfig {
  config: MockConfig
  envPath: string
  envExists: boolean
  /** Absolute path of the rules file. */
  rulesPath: string
}

/** defaults < .env file < process.env (< CLI flags, applied by the caller). */
export function loadConfig(envPath: string, processEnv: NodeJS.ProcessEnv = {}): LoadedConfig {
  const abs = path.resolve(envPath)
  const envExists = existsSync(abs)
  const fileEnv = envExists ? parseEnv(readFileSync(abs, 'utf8')) : {}
  // Only MOCKOLLA_* from the environment: a machine that also runs the real
  // Ollama often has OLLAMA_HOST set, and that must not move the mock.
  const ours = Object.fromEntries(
    Object.entries(processEnv).filter(([k]) => k.startsWith('MOCKOLLA_')),
  )
  const config = applyEnv(applyEnv(defaultConfig(), fileEnv), ours)
  return {
    config,
    envPath: abs,
    envExists,
    rulesPath: path.resolve(path.dirname(abs), config.rulesPath),
  }
}
