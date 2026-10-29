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
    '../../utils/budget-storage': { getCurrentMonthKey: () => '2026-10', ...storage },
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
  page.data.monthKey = '2026-10'
  await page.onShow()
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

function loadCloud(name, context, database) {
  const file = path.join(root, 'cloudfunctions', name, 'index.js')
  const cloud = { init() {}, database: () => database, getWXContext: () => context }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    exports, require: (module) => module === 'wx-server-sdk' ? cloud : {},
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
  for (const action of ['mergeFromOcr', 'getPublicBudgetConfig', 'incrementSubscribe']) {
    assert.match((await budget.main({ action })).message, /不支持/)
  }
})

test('同步仅允许固定账号手动调用，不接受定时或批量同步', async () => {
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
