import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('../../src/core/cli.ts', import.meta.url))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mockolla-cli-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** The environment without MOCKOLLA_* from the machine running the tests. */
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('MOCKOLLA_') && k !== 'OLLAMA_HOST'),
  )

function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: dir, env: { ...cleanEnv(), NO_COLOR: '1' } },
      (e, out, err) =>
        resolve({
          code: e ? ((e as { code?: number }).code ?? 1) : 0,
          out: String(out),
          err: String(err),
        }),
    )
  })
}

describe('the CLI', () => {
  it('prints help, version and presets', async () => {
    const help = await run('--help')
    expect(help.code).toBe(0)
    expect(help.out).toContain('elecmockolla serve')
    expect((await run('--version')).out.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    const presets = await run('presets')
    expect(presets.out).toContain('instant')
    expect(presets.out).toContain('demo')
  })

  it('writes .env and rules.json with init, once', async () => {
    const first = await run('init')
    expect(first.code).toBe(0)
    expect(existsSync(path.join(dir, '.env'))).toBe(true)
    expect(existsSync(path.join(dir, 'rules.json'))).toBe(true)
    expect((await run('init')).out).toContain('Nothing to do')
  })

  it('checks the settings and rules, and fails on a broken rules file', async () => {
    await run('init')
    const ok = await run('check')
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('OK')
    writeFileSync(path.join(dir, 'rules.json'), '{"rules": "not a list"}')
    const bad = await run('check')
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('rules error')
  })

  it('rejects an unknown command and a bad upstream', async () => {
    expect((await run('fly')).code).toBe(1)
    const bad = await run('serve', '--mode', 'proxy', '--upstream', 'ftp://x')
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('--upstream')
  })

  it('serves on the port it is given and logs each request as JSON', async () => {
    let child: ChildProcess | undefined
    try {
      child = spawn(
        process.execPath,
        [CLI, 'serve', '--port', '0', '--preset', 'instant', '--json'],
        { cwd: dir, env: { ...cleanEnv(), NO_COLOR: '1' } },
      )
      let out = ''
      child.stdout?.on('data', (d) => {
        out += String(d)
      })
      const url = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no listening line in: ${out}`)), 10_000)
        const check = () => {
          const m = /listening\s+(http:\/\/\S+)/.exec(out)
          if (m?.[1]) {
            clearTimeout(t)
            resolve(m[1])
          } else setTimeout(check, 50)
        }
        check()
      })
      const r = await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', prompt: '/echo from the cli', stream: false }),
      })
      expect(((await r.json()) as { response: string }).response).toBe('from the cli')
      for (let i = 0; i < 50 && !out.includes('"path":"/api/generate"'); i++)
        await new Promise((res) => setTimeout(res, 50))
      const line = out.split('\n').find((l) => l.includes('"path":"/api/generate"'))
      expect(JSON.parse(line ?? '{}')).toMatchObject({ status: 200, model: 'm' })
    } finally {
      // Wait for it to exit: Windows keeps the temp folder busy while it runs.
      if (child && child.exitCode === null) {
        const exited = new Promise((res) => child?.once('exit', res))
        child.kill()
        await exited
      }
    }
  })
})
