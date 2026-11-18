const reference = require('./growth-reference.json')

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

function ageMonths(birthday, date) {
  const birth = parseDate(birthday)
  const measured = parseDate(date)
  if (!birth || !measured || measured < birth) return null
  const [y, m, d] = birthday.split('-').map(Number)
  let months = (measured.getUTCFullYear() - y) * 12 + measured.getUTCMonth() - (m - 1)
  const anniversary = (offset) => {
    const first = new Date(Date.UTC(y, m - 1 + offset, 1))
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))
  }
  if (measured.getTime() < anniversary(months)) months -= 1
  return months + (measured.getTime() - anniversary(months)) / (anniversary(months + 1) - anniversary(months))
}

function ageLabel(months) {
  if (months === null || !Number.isFinite(months)) return ''
  const whole = Math.floor(months + 1e-8)
  if (whole < 1) return '未满1个月'
  return whole < 12 ? `${whole}个月` : `${Math.floor(whole / 12)}岁${whole % 12 ? `${whole % 12}个月` : ''}`
}

function interpolate(rows, months) {
  if (!rows || months < rows[0][0] || months > rows[rows.length - 1][0]) return null
  let right = rows.findIndex(row => row[0] >= months)
  if (right === 0) return rows[0].slice(1)
  const a = rows[right - 1], b = rows[right]
  const t = (months - a[0]) / (b[0] - a[0])
  return a.slice(1).map((v, i) => v + (b[i + 1] - v) * t)
}

function referenceAt(sex, metric, months) {
  if (!['boy', 'girl'].includes(sex) || !['height', 'weight'].includes(metric) || months === null || !Number.isFinite(months) || months < 0 || months > 216) return null
  const key = months < 24 ? (metric === 'height' ? 'length' : 'infantWeight') : metric
  return interpolate(reference.series[key][sex], months)
}

function referencePosition(child, record, metric) {
  if (!record) return '尚无记录'
  const band = referenceAt(child.sex, metric, ageMonths(child.birthday, record.date))
  if (!band) return '参考范围为0–18岁'
  return record[metric] < band[0] ? '低于参考带' : record[metric] > band[2] ? '高于参考带' : '在参考带内'
}

function numberText(value) { return Number(value).toFixed(1).replace(/\.0$/, '') }
function deltaText(value) { return `${value > 0 ? '+' : ''}${numberText(value)}` }

function timeline(records, child) {
  const ascending = records.slice().sort((a, b) => a.date.localeCompare(b.date))
  return ascending.map((record, i) => {
    const prev = ascending[i - 1]
    const months = ageMonths(child.birthday, record.date)
    return { ...record, year: record.date.slice(0, 4), shortDate: record.date.slice(5).replace('-', '.'), ageText: ageLabel(months),
      heightText: numberText(record.height), weightText: numberText(record.weight),
      changeText: prev ? `较上次  身高 ${deltaText(record.height - prev.height)} cm · 体重 ${deltaText(record.weight - prev.weight)} kg` : '成长故事，从这一笔开始',
    }
  }).reverse().map((record, i, rows) => ({ ...record, showYear: i === 0 || rows[i - 1].year !== record.year }))
}

function makeChart(child, records, metric, range = 'recent') {
  const withAge = records.map(r => ({ ...r, age: ageMonths(child.birthday, r.date) })).filter(r => r.age !== null && r.age <= 216).sort((a, b) => a.age - b.age)
  const focus = withAge.length ? withAge[withAge.length - 1].age : Math.min(216, ageMonths(child.birthday, new Date().toISOString().slice(0, 10)) || 0)
  let minX = 0, maxX = 216
  if (range !== 'all') {
    if (focus < 24) { minX = 0; maxX = 24 }
    else if (focus < 72) { minX = 24; maxX = 72 }
    else if (focus < 144) { minX = 72; maxX = 144 }
    else { minX = 144; maxX = 216 }
  }
  const segments = []
  // Keep recumbent-length and standing-height reference segments separate at age 2.
  for (const [start, end] of [[minX, Math.min(maxX, 23.999)], [Math.max(minX, 24), maxX]]) {
    if (end < start) continue
    const knots = []
    for (let x = start; x < end; x += (maxX - minX) / 108) {
      const values = referenceAt(child.sex, metric, x)
      if (values) knots.push({ x, low: values[0], median: values[1], high: values[2] })
    }
    const values = referenceAt(child.sex, metric, end)
    if (values) knots.push({ x: end, low: values[0], median: values[1], high: values[2] })
    if (knots.length) segments.push(knots)
  }
  const points = withAge.filter(r => r.age >= minX && r.age <= maxX).map(r => ({ x: r.age, y: Number(r[metric]), date: r.date, id: r.id, ageText: ageLabel(r.age) }))
  const values = segments.flatMap(s => s.flatMap(k => [k.low, k.high])).concat(points.map(p => p.y))
  const lo = Math.min(...values), hi = Math.max(...values)
  const step = Math.max(metric === 'height' ? 5 : 1, Math.ceil((hi - lo) / 5 / (metric === 'height' ? 5 : 1)) * (metric === 'height' ? 5 : 1))
  const minY = Math.max(0, Math.floor((lo - step * .3) / step) * step)
  const maxY = Math.ceil((hi + step * .3) / step) * step
  return { segments, points, minX, maxX, minY, maxY, metric, unit: metric === 'height' ? 'cm' : 'kg',
    rangeText: `${minX / 12}–${maxX / 12}岁`, omittedCount: records.length - points.length }
}

module.exports = { parseDate, ageMonths, ageLabel, referenceAt, referencePosition, numberText, timeline, makeChart }
