import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize } from 'svgo'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'assets-src', 'illustrations')
const markSrc = join(root, 'assets-src', 'mark.png')
const markSvgSrc = join(root, 'assets-src', 'mark.svg')
const outDir = join(root, 'public', 'img')

const LILAC = '#ede7f7'
const VIOLET_HUE = 263
// верхняя граница светлого серого: #f8f8f7 (светлота 0.9706) — тот же серый, что был фоном government.svg
const GREY_MAX_L = 0.975
// светлые серые здесь поверхности (лист, стойка), а не пятно: они остаются белыми
const GREY_TARGET = {
  'step-sign.svg': '#ffffff',
  'step-verify.svg': '#ffffff',
}
// эти файлы только сжимаем: фон, цвета и серые остаются как в исходнике
const AS_IS = new Set(['government.svg'])
// белые детали поверх этих серых (строки текста, подпись, прорези) красим в сиреневый, иначе на белом пропадут
const WHITE_DETAIL_TARGET = { 'step-sign.svg': LILAC, 'step-verify.svg': LILAC }
const EDGE = 0.01 // допуск касания края холста, доля от размера

const kb = n => (n / 1024).toFixed(1).padStart(6) + ' KB'

// Цвета

function parseColor(value) {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v === 'white') return [255, 255, 255]
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255

function classify(hex) {
  const rgb = parseColor(hex)
  if (!rgb) return null
  const { h, s, l } = toHsl(rgb)
  if (s >= 0.3 && h >= 200 && h <= 250 && chroma(rgb) >= 0.05) return 'blue'
  if (s < 0.1 && l >= 0.85 && l <= GREY_MAX_L) return 'grey'
  return null
}

const COLOR_ATTR = /((?:fill|stroke|stop-color|flood-color|lighting-color)\s*[=:]\s*["']?\s*)(#[0-9a-f]{3}(?:[0-9a-f]{3})?)(?![0-9a-f])/gi

function recolor(svg, greyTarget = LILAC) {
  const stats = { blue: 0, grey: 0 }
  const out = svg.replace(COLOR_ATTR, (whole, prefix, hex) => {
    const kind = classify(hex)
    if (!kind) return whole
    stats[kind]++
    if (kind === 'grey') return prefix + greyTarget
    const { s, l } = toHsl(parseColor(hex))
    return prefix + fromHsl(VIOLET_HUE, s, l)
  })
  return { svg: out, stats }
}

// Фон

const ELEMENT = /<defs\b[\s\S]*?<\/defs>|<[a-zA-Z][^>]*\/>/g

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

// Рамка по всем координатам пути, контрольные точки включены: для касания края хватает.
// Recraft отдаёт только абсолютные M, L, C, Z.
function pathBox(d) {
  if (!/^[MLCHVZ\d\s.,eE+-]*$/.test(d)) return null
  const xs = []
  const ys = []
  for (const [, cmd, args] of d.matchAll(/([MLCHVZ])([^MLCHVZ]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    if (cmd === 'H') xs.push(...n)
    else if (cmd === 'V') ys.push(...n)
    else for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]) }
  }
  if (!xs.length || !ys.length) return null
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

function shapeBox(tag) {
  if (tag.startsWith('<path')) return pathBox(attr(tag, 'd') ?? '')
  if (tag.startsWith('<rect')) {
    const x0 = Number(attr(tag, 'x') ?? 0)
    const y0 = Number(attr(tag, 'y') ?? 0)
    return { x0, y0, x1: x0 + Number(attr(tag, 'width')), y1: y0 + Number(attr(tag, 'height')) }
  }
  return null
}

// Белый элемент, целиком лежащий в рамке более раннего серого, считаем деталью на серой поверхности
function liftWhiteDetails(svg, target) {
  const greys = []
  let count = 0
  const out = svg.replace(ELEMENT, el => {
    if (el.startsWith('<defs')) return el
    const fill = attr(el, 'fill')
    const rgb = parseColor(fill)
    const box = rgb && shapeBox(el)
    if (!box) return el
    if (classify(fill) === 'grey') {
      greys.push(box)
      return el
    }
    const white = toHsl(rgb).l >= 0.99 && chroma(rgb) < 0.03
    const inside = g => box.x0 >= g.x0 && box.y0 >= g.y0 && box.x1 <= g.x1 && box.y1 <= g.y1
    if (!white || !greys.some(inside)) return el
    count++
    return el.replace(/fill="[^"]*"/, `fill="${target}"`)
  })
  return { svg: out, count }
}

// Recraft кладёт слои друг на друга: внизу сплошной слой цвета контура, поверх куски
// белого фона с вырезом по силуэту. Если просто убрать белые куски, контурный слой
// закроет весь холст. Поэтому белый кусок превращается в ластик: всё, что нарисовано
// под ним, получает маску «холст минус этот кусок». Картинка на белом остаётся прежней.
function removeBackground(svg) {
  const open = /<svg\b[^>]*>/.exec(svg)
  const vb = open && /viewBox\s*=\s*"([^"]+)"/.exec(open[0])
  if (!vb) return { svg, removed: 0, masked: 0, warning: 'нет viewBox' }
  const [vx, vy, vw, vh] = vb[1].trim().split(/[\s,]+/).map(Number)
  const body = svg.slice(open.index + open[0].length, svg.lastIndexOf('</svg>'))
  const elements = body.match(ELEMENT) ?? []
  if (body.replace(ELEMENT, '').trim()) {
    return { svg, removed: 0, masked: 0, warning: 'вложенные группы, разбор фона пропущен' }
  }

  const touches = b => b.x0 <= vx + vw * EDGE || b.y0 <= vy + vh * EDGE
    || b.x1 >= vx + vw * (1 - EDGE) || b.y1 >= vy + vh * (1 - EDGE)
  const covers = b => b.x0 <= vx + vw * EDGE && b.y0 <= vy + vh * EDGE
    && b.x1 >= vx + vw * (1 - EDGE) && b.y1 >= vy + vh * (1 - EDGE)

  let seenShape = false
  let masks = ''
  let acc = []
  let removed = 0
  let masked = 0
  for (const el of elements) {
    const rgb = el.startsWith('<defs') ? null : parseColor(attr(el, 'fill'))
    const box = rgb && shapeBox(el)
    const first = !seenShape
    if (rgb) seenShape = true
    let bg = false
    if (box) {
      const { l } = toHsl(rgb)
      // первый элемент на весь холст: светло-серый тоже фон; дальше только почти белое у края
      bg = chroma(rgb) < 0.03 && ((first && covers(box) && l > 0.85) || (l >= 0.95 && touches(box)))
    }
    if (!bg) {
      acc.push(el)
      continue
    }
    removed++
    if (!acc.length) continue
    masked++
    const id = `bg${masked}`
    masks += `<mask id="${id}" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}">`
      + `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#fff"/>`
      + `${el.replace(/fill="[^"]*"/, 'fill="#000"')}</mask>`
    acc = [`<g mask="url(#${id})">${acc.join('')}</g>`]
  }
  if (!removed) return { svg, removed, masked, warning: 'фон не найден' }

  const head = svg.slice(0, open.index + open[0].length)
  return { svg: `${head}${masks ? `<defs>${masks}</defs>` : ''}${acc.join('')}</svg>`, removed, masked }
}

// Сжатие

function compress(svg) {
  return optimize(svg, {
    multipass: true,
    // в svgo 4 removeViewBox не входит в preset-default, viewBox остаётся
    plugins: ['preset-default', 'removeDimensions'],
  }).data
}

// Только svgo: холст, фон и цвета остаются как в исходнике
function publishAsIs(src, name) {
  const raw = readFileSync(src, 'utf8')
  const out = compress(raw)
  writeFileSync(join(outDir, name), out)
  return { before: Buffer.byteLength(raw), after: Buffer.byteLength(out) }
}

// Знак: svg публикуется как есть (цвета выбирает автор). Растровый знак 128 px и favicon 16/32/48 берутся из assets-src/mark.png через Pillow
const MARK_PY = `
import sys
from PIL import Image
src, png, ico = sys.argv[1:4]
im = Image.open(src).convert('RGB')
im.resize((128, 128), Image.LANCZOS).save(png, optimize=True)
im.convert('RGBA').save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
`

function buildMark() {
  if (existsSync(markSvgSrc)) {
    const { before, after } = publishAsIs(markSvgSrc, 'mark.svg')
    console.log(`mark.svg ${kb(before)} -> ${kb(after)}  как в исходнике`)
  }
  if (!existsSync(markSrc)) return console.warn('! assets-src/mark.png не найден, знак пропущен')
  const png = join(outDir, 'mark.png')
  const ico = join(root, 'public', 'favicon.ico')
  for (const py of ['python', 'python3', 'py']) {
    try {
      execFileSync(py, ['-c', MARK_PY, markSrc, png, ico], { stdio: 'pipe' })
      console.log(`mark.png ${kb(statSync(markSrc).size)} -> ${kb(statSync(png).size)}, favicon.ico ${kb(statSync(ico).size)}`)
      return
    } catch { /* пробуем следующий интерпретатор */ }
  }
  console.warn('! Python с Pillow не найден, знак и favicon не обновлены')
}

// Запуск

mkdirSync(outDir, { recursive: true })
let totalBefore = 0
let totalAfter = 0
let failed = false

const files = readdirSync(srcDir).filter(f => f.endsWith('.svg')).sort()
for (const file of files) {
  try {
    const raw = readFileSync(join(srcDir, file), 'utf8')
    if (AS_IS.has(file)) {
      const { before, after } = publishAsIs(join(srcDir, file), file)
      totalBefore += before
      totalAfter += after
      console.log(`${file.padEnd(18)} ${kb(before)} -> ${kb(after)}  как в исходнике`)
      continue
    }
    const clean = raw.replace(/<\?xml[^>]*\?>/, '').replace(/<metadata\b[\s\S]*?<\/metadata>/, '')
    const lifted = WHITE_DETAIL_TARGET[file] ? liftWhiteDetails(clean, WHITE_DETAIL_TARGET[file]) : { svg: clean, count: 0 }
    const bg = removeBackground(lifted.svg)
    if (bg.warning) console.warn(`! ${file}: ${bg.warning}`)
    const { svg, stats } = recolor(bg.svg, GREY_TARGET[file])
    const out = compress(svg)
    writeFileSync(join(outDir, file), out)
    const before = Buffer.byteLength(raw)
    const after = Buffer.byteLength(out)
    totalBefore += before
    totalAfter += after
    console.log(`${file.padEnd(18)} ${kb(before)} -> ${kb(after)}  фон: ${bg.removed} (масок ${bg.masked})  синий: ${stats.blue}  серый: ${stats.grey}${lifted.count ? `  белых деталей: ${lifted.count}` : ''}`)
  } catch (e) {
    failed = true
    console.error(`! ${file}: ${e.message}`)
  }
}
console.log(`${'итого'.padEnd(18)} ${kb(totalBefore)} -> ${kb(totalAfter)}`)

buildMark()
if (failed) process.exitCode = 1
