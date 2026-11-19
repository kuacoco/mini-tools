const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const model = require('../utils/growth-model')
const reference = require('../utils/growth-reference.js')
const { createService, dateValue, numberValue } = require('../cloudfunctions/growthCrud/service')
const plain = value => JSON.parse(JSON.stringify(value))

test('官方分位数节点精度、男女数据、插值与0–18岁边界', () => {
  assert.deepEqual(model.referenceAt('boy', 'height', 0), reference.series.length.boy[0].slice(1))
  for (const sex of ['boy', 'girl']) for (const metric of ['height', 'weight']) {
    for (const month of [0, .25, 12, 23.99, 24, 36, 120, 216]) {
      const band = model.referenceAt(sex, metric, month)
      assert.ok(band && band[0] < band[1] && band[1] < band[2])
    }
    assert.equal(model.referenceAt(sex, metric, 216.01), null)
    assert.equal(model.referenceAt(sex, metric, -1), null)
  }
  const rows = reference.series.height.girl, a = rows[0], b = rows[1]
  assert.deepEqual(model.referenceAt('girl', 'height', (a[0] + b[0]) / 2), a.slice(1).map((v, i) => v + (b[i + 1] - v) * .5))
  assert.notDeepEqual(model.referenceAt('boy', 'height', 144), model.referenceAt('girl', 'height', 144))
  assert.equal(model.referenceAt('unknown', 'height', 12), null)
})

test('日期与月龄按日历计算，涵盖月底、闰日和无效日期', () => {
  assert.equal(model.parseDate('2026-02-30'), null)
  assert.equal(model.ageMonths('2024-01-31', '2024-02-29'), 1)
  assert.equal(model.ageMonths('2024-02-29', '2026-02-28'), 24)
  assert.equal(model.ageMonths('2022-03-08', '2026-03-08'), 48)
  assert.equal(model.ageMonths('2022-03-08', '2022-03-07'), null)
  assert.equal(model.ageLabel(0), '未满1个月')
  assert.equal(model.ageLabel(50), '4岁2个月')
  assert.throws(() => dateValue('2026-02-30'))
  assert.throws(() => numberValue('12.34', .5, 250, '体重'))
  assert.throws(() => numberValue('', .5, 250, '体重'))
})

test('曲线按年龄排序，完整呈现带外值，两岁处参考分段且不外推', () => {
  const child = { birthday: '2020-01-01', sex: 'boy' }
  const rows = [{ id: 'b', date: '2025-01-01', height: 245, weight: 80 }, { id: 'a', date: '2021-01-01', height: 70, weight: 9 }]
  const chart = model.makeChart(child, rows, 'height', 'all')
  assert.equal(chart.segments.length, 2)
  assert.ok(chart.segments[0].at(-1).x < 24)
  assert.equal(chart.segments[1][0].x, 24)
  assert.ok(chart.maxY >= 245)
  assert.deepEqual(chart.points.map(p => p.id), ['a', 'b'])
  assert.equal(model.referencePosition(child, rows[0], 'height'), '高于参考带')
  const recent = model.makeChart(child, rows, 'height', 'recent')
  assert.equal(recent.omittedCount, 1)
  const timeline = model.timeline(rows, child)
  assert.equal(timeline[0].id, 'b')
  assert.match(timeline[0].changeText, /\+175 cm/)
})

function memoryDatabase() {
  let tables = { growth_profiles: {}, growth_measurements: {} }
  const command = { lt: value => ({ lt: value }) }
  function collection(name) {
    let conditions = {}, order = [], max = Infinity
    const query = {
      where(value) { conditions = value; return query },
      orderBy(key, direction) { order.push([key, direction]); return query },
      limit(value) { max = value; return query },
      async get() {
        let rows = Object.values(tables[name]).filter(row => Object.entries(conditions).every(([key, value]) => value && typeof value === 'object' ? row[key] < value.lt : row[key] === value))
        rows.sort((a, b) => { for (const [key, dir] of order) { if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1) } return 0 })
        return { data: plain(rows.slice(0, max)) }
      },
      async count() { return { total: (await query.get()).data.length } },
      doc(id) { return {
        async get() { if (!tables[name][id]) throw new Error('document not exist'); return { data: plain(tables[name][id]) } },
        async set({ data }) { tables[name][id] = { ...plain(data), _id: id } },
        async update({ data }) { Object.assign(tables[name][id], plain(data)) },
        async remove() { delete tables[name][id] },
      } },
    }
    return query
  }
  const db = { command, collection, async runTransaction(fn) { const snapshot = plain(tables); try { return await fn(db) } catch (e) { tables = snapshot; throw e } } }
  return db
}

test('云端按OPENID隔离、同日去重、重试幂等、修订保护和删除完整流程', async () => {
  const db = memoryDatabase(), execute = createService(db)
  const profile = { name: '小满', birthday: '2020-01-01', sex: 'girl', requestId: 'child_request_001' }
  const child = (await execute('saveProfile', profile, 'owner')).item
  assert.equal((await execute('saveProfile', profile, 'owner')).item.id, child.id)
  assert.equal((await execute('listProfiles', {}, 'intruder')).list.length, 0)
  await assert.rejects(execute('listRecords', { childId: child.id }, 'intruder'), /无权访问/)
  const input = { childId: child.id, date: '2025-01-01', height: '100.1', weight: '15.5', requestId: 'record_request_001' }
  const first = (await execute('saveRecord', input, 'owner')).item
  assert.equal((await execute('saveRecord', input, 'owner')).item.id, first.id)
  assert.equal((await execute('listRecords', { childId: child.id }, 'owner')).list.length, 1)
  await assert.rejects(execute('saveRecord', { ...input, requestId: 'record_request_002' }, 'owner'), /当天已有记录/)
  await assert.rejects(execute('saveRecord', { ...input, id: first.id, revision: 1 }, 'intruder'), /无权访问/)
  await assert.rejects(execute('saveProfile', { ...child, birthday: '2020-02-01' }, 'owner'), /不可修改/)
  const edited = (await execute('saveRecord', { ...input, id: first.id, revision: first.revision, height: '101', requestId: 'record_request_003' }, 'owner')).item
  assert.equal(edited.revision, 2)
  await assert.rejects(execute('saveRecord', { ...input, id: first.id, revision: first.revision, requestId: 'record_request_004' }, 'owner'), /已更新/)
  const moved = (await execute('saveRecord', { ...input, date: '2025-01-02', id: edited.id, revision: 2, requestId: 'record_request_005' }, 'owner')).item
  assert.notEqual(moved.id, edited.id)
  const retryMove = await execute('saveRecord', { ...input, date: '2025-01-02', id: edited.id, revision: 2, requestId: 'record_request_005' }, 'owner')
  assert.equal(retryMove.item.id, moved.id)
  assert.equal((await execute('listRecords', { childId: child.id }, 'owner')).list.length, 1)
  await assert.rejects(execute('deleteRecord', { childId: child.id, id: moved.id, revision: 1 }, 'owner'), /已更新/)
  await execute('deleteRecord', { childId: child.id, id: moved.id, revision: moved.revision }, 'owner')
  assert.equal((await execute('listRecords', { childId: child.id }, 'owner')).list.length, 0)
  const locked = (await execute('listProfiles', {}, 'owner')).list[0]
  await assert.rejects(execute('saveProfile', { ...locked, sex: 'boy' }, 'owner'), /不可修改/)
})

function loadGrowthPage(storage) {
  const file = path.resolve(__dirname, '../pages/child-growth/child-growth.js'), localRequire = createRequire(file)
  let page
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) { page = value },
    require(name) { return name.includes('growth-storage') ? storage : name.includes('course-storage') ? { getCurrentDateString: () => '2026-11-18' } : localRequire(name) },
    wx: { showToast() {}, showModal: async () => ({ confirm: true }) }, Date, Math,
  })
  page.data = plain(page.data)
  page.setData = values => { for (const [path, value] of Object.entries(values)) { const keys = path.split('.'); let ref = page.data; while (keys.length > 1) ref = ref[keys.shift()]; ref[keys[0]] = value } }
  page.data.today = '2026-11-18'
  return page
}

test('快速切换孩子不串数据，记录保存失败保留输入，重复日期可见校验', async () => {
  const resolvers = {}
  const page = loadGrowthPage({ listRecords: id => new Promise(resolve => { resolvers[id] = resolve }), saveRecord: async () => { throw new Error('网络断开') } })
  const first = page.selectChild({ id: 'one', name: '一', birthday: '2020-01-01', sex: 'boy' })
  const second = page.selectChild({ id: 'two', name: '二', birthday: '2022-01-01', sex: 'girl' })
  resolvers.two([{ id: 'r', date: '2026-11-01', height: 100, weight: 16 }]); await second
  resolvers.one([{ id: 'old', date: '2026-11-01', height: 150, weight: 45 }]); await first
  assert.equal(page.data.activeChild.id, 'two')
  assert.equal(page.data.records[0].id, 'r')
  page.onAddRecord()
  page.data.recordForm.height = '102.5'; page.data.recordForm.weight = '16.5'
  await page.onSaveRecord()
  assert.equal(page.data.formError, '网络断开')
  assert.equal(page.data.recordForm.height, '102.5')
  assert.equal(page.data.sheet, 'record')
  page.data.recordForm.date = '2026-11-01'
  await page.onSaveRecord()
  assert.match(page.data.formError, /当天已有记录/)
})

test('成长模型及参考数据可由仅加载JS模块的小程序式加载器导入', () => {
  const cache = new Map()
  function miniRequire(file) {
    const resolved = file.endsWith('.js') ? file : `${file}.js`
    if (cache.has(resolved)) return cache.get(resolved).exports
    const module = { exports: {} }
    cache.set(resolved, module)
    vm.runInNewContext(fs.readFileSync(resolved, 'utf8'), {
      module, exports: module.exports, Date,
      require: request => miniRequire(path.resolve(path.dirname(resolved), request)),
    }, { filename: resolved })
    return module.exports
  }
  const miniModel = miniRequire(path.resolve(__dirname, '../utils/growth-model.js'))
  const band = miniModel.referenceAt('girl', 'height', 48)
  assert.ok(band && band[0] < band[1] && band[1] < band[2])
})
