// Обслуженные адреса переживают перезапуск; запись через временный файл, чтобы не оставить половину JSON
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export function openState(path) {
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const served = new Map(Object.entries(data.served ?? {}))
  let drips = Number(data.drips ?? served.size)

  function save() {
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify({ drips, served: Object.fromEntries(served) }, null, 2))
    renameSync(tmp, path)
  }

  return {
    has: a => served.has(a),
    add(a, signature, at = new Date()) {
      served.set(a, { signature, at: at.toISOString() })
      drips += 1
      save()
    },
    get size() { return served.size },
    get drips() { return drips },
  }
}
