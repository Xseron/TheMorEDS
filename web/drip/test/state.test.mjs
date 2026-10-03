import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openState } from '../state.mjs'

test('served addresses survive a reopen', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'drip-')), 'state.json')
  const first = openState(path)
  assert.equal(first.has('A'), false)
  first.add('A', 'sig-a', new Date('2026-10-04T10:00:00Z'))
  const again = openState(path)
  assert.equal(again.has('A'), true)
  assert.equal(again.has('B'), false)
  assert.equal(again.size, 1)
  assert.equal(again.drips, 1)
})
