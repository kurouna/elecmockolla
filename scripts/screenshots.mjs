// Saves a screenshot of every page into docs/screenshots (or the folder given).
// Uses its own settings folder, so your .env and rules.json are not touched.
// English by default; MOCKOLLA_LANG=ja for Japanese shots.
// Run `npm run build` first.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import electron from 'electron'

const out = path.resolve(process.argv[2] ?? 'docs/screenshots')
const home = mkdtempSync(path.join(tmpdir(), 'mockolla-shots-'))
const env = {
  ...process.env,
  MOCKOLLA_HOME: home,
  MOCKOLLA_CAPTURE: out,
  // A free port and the demo speed, so shots are reproducible and never clash with Ollama.
  MOCKOLLA_PORT: process.env.MOCKOLLA_PORT ?? '11439',
  MOCKOLLA_TTFT_MS: '600',
  MOCKOLLA_TPS: '18',
  MOCKOLLA_NUM_PARALLEL: process.env.MOCKOLLA_NUM_PARALLEL ?? '4',
  MOCKOLLA_SEED: '42',
  MOCKOLLA_LANG: process.env.MOCKOLLA_LANG ?? 'en',
}
const child = spawn(String(electron), ['.'], { env, stdio: 'inherit' })
child.on('exit', (code) => {
  console.log(`screenshots in ${out}`)
  process.exit(code ?? 0)
})
