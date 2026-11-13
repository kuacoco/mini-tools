const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const owner = 'o5Qxn17JK9Rx0v22YCXWvhVF4zwg'
const plain = (value) => JSON.parse(JSON.stringify(value))

class October29 extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 29, 12])) }
}

function loadPage(relative, overrides = {}, wxOverrides = {}, DateClass = October29) {
  const file = path.join(root, relative)
  const localRequire = createRequire(file)
  let page
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: (name) => overrides[name] || localRequire(name),
    Page: (value) => { page = value },
    wx: { showLoading() {}, hideLoading() {}, showToast() {}, showModal() {}, ...wxOverrides },
    Date: DateClass, console, setTimeout, clearTimeout,
  }, { filename: relative })
  page.data = plain(page.data)
  page.setData = (data) => Object.assign(page.data, data)
  return page
}

function budgetPage(storage, wxOverrides, DateClass) {
  return loadPage('pages/budget/budget.js', {
    '../../utils/budget-storage': {
      getCurrentMonthKey: () => '2026-10',
      syncBudgetFromFeidee: async () => ({}),
      ...storage,
    },
  }, wxOverrides, DateClass)
}

test('预算汇总和日均金额使用实际余额，历史月份不显示当月提示', async () => {
  const queried = []
  const page = budgetPage({
    getMonthBudgetList: async (month) => {
      queried.push(month)
      return month === '2026-10' ? [
        { id: 'a', name: '早午晚餐', parentCategoryName: '食品酒水', totalAmount: 1000, usedAmount: 700 },
        { id: 'b', name: '公交', parentCategoryName: '交通', totalAmount: 500, usedAmount: 200 },
      ] : []
    },
  })
  await page.onLoad()
  assert.deepEqual(queried, ['2026-09', '2026-10', '2026-11'])
  assert.equal(page.data.summarySwipe[1].totalBudgetText, '1500')
  assert.equal(page.data.summarySwipe[1].totalUsedText, '900')
  assert.equal(page.data.summarySwipe[1].remainText, '600')
  assert.equal(page.data.foodCategoryAvgWithTodayText, '100')
  assert.equal(page.data.foodCategoryAvgWithoutTodayText, '150')
  assert.equal(page.data.pageReady, true)
  page.data.monthKey = '2026-09'
  await page.refreshBudgetList()
  assert.equal(page.data.showDailyTip, false)
  assert.equal(page.data.foodCategoryAvgWithTodayText, '--')
})

test('月末的从明日日均金额显示占位，超支金额保持负值', async () => {
  class October31 extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 9, 31, 12])) }
  }
  const page = budgetPage({ getMonthBudgetList: async () => [
    { id: 'a', name: '早午晚餐', parentCategoryName: '自定义餐饮', parentCategorySourceName: '食品酒水', totalAmount: 100, usedAmount: 120 },
  ] }, {}, October31)
  page.data.monthKey = '2026-10'
  await page.refreshBudgetList()
  assert.equal(page.data.foodCategoryAvgWithTodayText, '-20')
  assert.equal(page.data.foodCategoryAvgWithoutTodayText, '--')
})

test('预算看板初次加载先同步再读取，返回时不刷新，手动同步失败后仍读取已保存数据', async () => {
  const calls = []
  let finishSync
  const page = budgetPage({
    syncBudgetFromFeidee: (month) => {
      calls.push(`同步 ${month}`)
      return new Promise((resolve, reject) => { finishSync = { resolve, reject } })
    },
    getMonthBudgetList: async (month) => {
      calls.push(`读取 ${month}`)
      return []
    },
  }, { showToast: ({ title }) => calls.push(title) })
  const firstLoad = page.onLoad()
  assert.deepEqual(calls, ['同步 2026-10'])
  assert.equal(page.data.pageReady, false)
  finishSync.resolve({})
  await firstLoad
  const returnToPage = page.onShow?.()
  assert.deepEqual(calls, ['同步 2026-10', '读取 2026-09', '读取 2026-10', '读取 2026-11'])
  await returnToPage

  page.data.monthKey = '2026-09'
  const manualSync = page.startFeideeSync()
  assert.equal(calls.at(-1), '同步 2026-09')
  finishSync.reject(new Error('同步失败'))
  await manualSync
  assert.deepEqual(calls.slice(4), ['同步 2026-09', '读取 2026-08', '读取 2026-09', '读取 2026-10', '同步失败'])
})

test('点击预算项打开所选月份对应的二级账单，未关联分类时提示', async () => {
  const urls = []
  const messages = []
  const page = budgetPage({
    getMonthBudgetList: async (month) => month === '2024-02' ? [
      { id: 'linked', categoryId: 'food+drink', name: '餐饮 & 饮品' },
      { id: 'unlinked', name: '其他预算' },
    ] : [],
  }, {
    navigateTo: ({ url }) => urls.push(url),
    showToast: ({ title }) => messages.push(title),
  })
  page.data.monthKey = '2024-02'
  await page.refreshBudgetList()
  page.onBudgetTap({ currentTarget: { dataset: { id: 'unlinked' } } })
  assert.deepEqual(messages, ['该预算项未关联账单分类'])
  assert.equal(urls.length, 0)
  page.onBudgetTap({ currentTarget: { dataset: { id: 'linked' } } })
  const url = new URL(urls[0], 'https://example.test')
  assert.equal(url.pathname, '/pages/feidee-bill/feidee-bill')
  const params = Object.fromEntries(url.search.slice(1).split('&').map((pair) => pair.split('=')))
  const bill = loadPage('pages/feidee-bill/feidee-bill.js')
  bill.onLoad(params)
  assert.equal(bill.data.startDate, '2024-02-01')
  assert.equal(bill.data.endDate, '2024-02-29')
  assert.equal(bill.data.categoryName, '餐饮 & 饮品')
  assert.deepEqual(plain(bill.data.categoryFilter), { group_key: 'CATEGORY_SECOND', group_id: 'food+drink' })
})

test('删除预算：五项默认不选，手动选择生效，固定弹窗月份且不重复删除', async () => {
  const calls = []
  const names = ['烟酒茶', '早午晚餐', '水果零食', '买菜', '软件服务', '公交', '购物']
  const page = budgetPage({
    getMonthBudgetList: async () => names.map((name, index) => ({ id: String(index), name })),
    deleteBudgetItem: async (month, id) => calls.push([month, id]),
  })
  page.data.monthKey = '2026-10'
  await page.confirmClearBudgetItems()
  assert.deepEqual(plain(page.data.deleteBudgetItems.filter((item) => item.checked).map((item) => item.name)), ['公交', '购物'])
  assert.equal(calls.length, 0)
  page.onDeleteBudgetSelectionChange({ detail: { value: [] } })
  await page.onConfirmDeleteBudgetItems()
  assert.equal(calls.length, 0)
  page.onDeleteBudgetSelectionChange({ detail: { value: ['0', '6'] } })
  page.data.monthKey = '2026-11'
  await Promise.all([page.onConfirmDeleteBudgetItems(), page.onConfirmDeleteBudgetItems()])
  assert.deepEqual(calls, [['2026-10', '0'], ['2026-10', '6']])
  assert.equal(page.data.showDeletePopup, false)
})

test('删除中途失败：剔除已删项，保留剩余选择以便重试', async () => {
  let fail = true
  const calls = []
  const page = budgetPage({
    getMonthBudgetList: async () => ['公交', '购物'].map((name, index) => ({ id: String(index), name })),
    deleteBudgetItem: async (month, id) => {
      if (fail && id === '1') throw new Error('网络失败')
      calls.push(id)
    },
  })
  page.data.monthKey = '2026-10'
  await page.confirmClearBudgetItems()
  await page.onConfirmDeleteBudgetItems()
  assert.deepEqual(plain(page.data.deleteBudgetItems.map((item) => item.id)), ['1'])
  assert.equal(page.data.deleteSelectedCount, 1)
  assert.equal(page.clearingBudgetItems, false)
  fail = false
  await page.onConfirmDeleteBudgetItems()
  assert.deepEqual(calls, ['0', '1'])
})

test('首页权限与随手记卡片顺序保持不变', async () => {
  let allowed = false
  let destination
  const page = loadPage('pages/index/index.js', {
    '../../utils/privileged-user': { isPrivilegedUser: async () => allowed },
  }, { navigateTo: ({ url }) => { destination = url } })
  await page.onShow()
  assert.equal(page.data.toolList.length, 3)
  allowed = true
  await page.onShow()
  assert.deepEqual(plain(page.data.toolGroups[0].items.map((item) => item.title)), ['预算看板', '消费账单', '分类支出', '消费日历'])
  for (const item of page.data.toolList) {
    page.onToolTap({ currentTarget: { dataset: { path: item.path } } })
    assert.equal(destination, item.path)
  }
  allowed = false
  await page.onShow()
  assert.equal(page.data.toolGroups.length, 1)
})

function loadCloud(name, context, database, overrides = {}) {
  const file = path.join(root, 'cloudfunctions', name, 'index.js')
  const cloud = { init() {}, database: () => database, getWXContext: () => context }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports, require: (module) => module === 'wx-server-sdk' ? cloud : overrides[module] || {},
    console: { log() {}, error() {} },
  }, { filename: file })
  return exports
}

test('云端权限仍有效：管理接口拒绝其他用户，废弃接口不可调用', async () => {
  let reads = 0
  const context = { OPENID: 'other' }
  const database = { command: {}, collection() { reads++; throw new Error('不应读取数据库') } }
  const admin = loadCloud('adminCrud', context, database)
  assert.equal((await admin.main({ action: 'listFeideeConfig' })).success, false)
  assert.equal(reads, 0)
  context.OPENID = owner
  for (const action of ['getFeideeConfig', 'checkPermission', 'listWhitelist', 'updateSystemConfig']) {
    assert.match((await admin.main({ action })).message, /不支持/)
  }
  const budget = loadCloud('budgetCrud', context, database)
  for (const action of ['mergeFromOcr', 'getPublicBudgetConfig', 'incrementSubscribe', 'updateUsedAmount']) {
    assert.match((await budget.main({ action })).message, /不支持/)
  }
})

test('同步仅允许固定账号从看板调用，不接受定时或批量同步', async () => {
  let reads = 0
  const context = { OPENID: owner, SOURCE: 'wx_trigger' }
  const database = { command: {}, collection() {
    reads++
    return { where() { return this }, limit() { return this }, get: async () => ({ data: [] }) }
  } }
  const sync = loadCloud('syncFeideeBudget', context, database)
  assert.equal((await sync.main({})).success, false)
  context.SOURCE = ''
  assert.equal((await sync.main({ action: 'syncAll' })).success, false)
  context.OPENID = 'other'
  assert.equal((await sync.main({ monthKey: '2026-10' })).success, false)
  assert.equal(reads, 0)
  context.OPENID = owner
  assert.match((await sync.main({ monthKey: '2026-10' })).message, /未配置/)
  assert.equal(reads, 1)
})

test('同步为已有零支出预算补上分类 ID，只为有支出的分类新增预算', async () => {
  const updated = []
  const added = []
  const database = {
    collection(name) {
      return {
        where() { return this },
        limit() { return this },
        async get() {
          return { data: name === 'budget_config' ? [{}] : [
            { _id: 'budget', name: '公交', parentCategoryName: '交通', usedAmount: 15 },
          ] }
        },
        doc(id) {
          return { async update({ data }) { updated.push({ id, ...data }) } }
        },
        async add({ data }) { added.push(data) },
      }
    },
  }
  const request = {
    post(options, callback) {
      const child = (group_id, group_name, value) => ({
        group_id, group_name, metric_data: [{ key: 'EXPENSE', value }],
      })
      callback(null, { statusCode: 200 }, {
        data: [{
          group_id: 'transport',
          group_name: '交通',
          children: [child('bus', '公交', 0), child('taxi', '打车', 0), child('metro', '地铁', 5)],
        }],
      })
    },
  }
  const sync = loadCloud('syncFeideeBudget', { OPENID: owner }, database, { request })
  const result = await sync.main({ monthKey: '2026-10' })
  assert.equal(result.success, true)
  assert.deepEqual(updated.map(({ id, categoryId, usedAmount }) => [id, categoryId, usedAmount]), [
    ['budget', 'bus', 0],
  ])
  assert.deepEqual(added.map(({ categoryId }) => categoryId), ['metro'])
})

test('消费账单快捷时段、跨年翻月和分类筛选保持一致', async () => {
  const queries = []
  const page = loadPage('pages/feidee-bill/feidee-bill.js', {
    '../../utils/course-storage': { getCurrentDateString: () => '2026-10-29' },
    '../../utils/budget-storage': { fetchFeideeTransactions: async (...args) => {
      queries.push(plain(args))
      return { list: [], totalAmount: 0 }
    } },
  })
  page.onLoad({ startDate: '2026-10-29', endDate: '2026-10-29', categoryId: 'food', categoryName: '餐饮' })
  assert.equal(page.data.quickType, 'today')
  page.onQuickMonth()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(queries.at(-1), ['2026-10-01', '2026-10-31', { group_key: 'CATEGORY_SECOND', group_id: 'food' }])
  assert.equal(page.data.quickType, 'month')
  page.onQuickToday()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(queries.at(-1).slice(0, 2), ['2026-10-29', '2026-10-29'])
  page.onLoad({ startDate: '2026-01-01', endDate: '2026-01-31', categoryId: 'food' })
  page.onPagePrevMonth()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.monthLabel, '2025年12月')
  assert.equal(page.data.quickType, 'custom')
  assert.deepEqual(queries.at(-1).slice(0, 2), ['2025-12-01', '2025-12-31'])
  page.onPageNextMonth()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.monthLabel, '2026年1月')
  page.onClearCategoryFilter()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(queries.at(-1)[2], null)
})

for (const [name, api, load] of [
  ['category-expense', 'fetchFeideeCategoryExpense', 'loadCategoryExpense'],
  ['feidee-bill', 'fetchFeideeTransactions', 'loadTransactions'],
]) {
  test(`${name} 自定义区间校验、翻月及连续选择时保留最新查询`, async () => {
    const requests = []
    const toasts = []
    const page = loadPage(`pages/${name}/${name}.js`, {
      '../../utils/budget-storage': { [api]: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) },
    }, { showToast: ({ title }) => toasts.push(title) })
    page.setData({ startDate: '2026-10-01', endDate: '2026-10-31', monthValue: '2026-10', collapsedMap: { food: true } })
    if (name === 'feidee-bill') page.data.categoryFilter = { group_id: 'food' }
    page.onStartDateChange({ detail: { value: '2026-09-15' } })
    assert.equal(page.data.quickType, 'range')
    assert.deepEqual(plain(page.data.collapsedMap), {})
    page.onEndDateChange({ detail: { value: '2026-10-20' } })
    assert.equal(requests.length, 2)
    assert.deepEqual(plain(requests[1].args.slice(0, 2)), ['2026-09-15', '2026-10-20'])
    if (name === 'feidee-bill') assert.equal(requests[1].args[2].group_id, 'food')
    requests[1].resolve({ totalAmount: 20 })
    await new Promise(resolve => setImmediate(resolve))
    requests[0].resolve({ totalAmount: 999 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(page.data.totalAmount, 20)
    assert.equal(page.data.isLoading, false)
    page.onStartDateChange({ detail: { value: '2026-11-01' } })
    assert.equal(page.data.startDate, '2026-09-15')
    assert.equal(toasts.at(-1), '开始日期不能晚于结束日期')
    assert.equal(requests.length, 2)
    page.onPageNextMonth()
    assert.equal(page.data.startDate, '2026-10-01')
    assert.equal(page.data.endDate, '2026-10-31')
    assert.equal(page.data.monthLabel, '2026年10月')
    requests[2].resolve({ totalAmount: 30 })
    await new Promise(resolve => setImmediate(resolve))
  })
}
