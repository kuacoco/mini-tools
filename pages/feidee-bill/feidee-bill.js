const { fetchFeideeTransactions } = require('../../utils/budget-storage')
const { formatAmount } = require('../../utils/amount-expression')
const { pickUniqueCategoryBg, categoryInitial } = require('../../utils/category-color')

function calcMonthRange(date = new Date()) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const mm = String(m).padStart(2, '0')
  const lastDay = new Date(y, m, 0).getDate()
  const dd = String(lastDay).padStart(2, '0')
  return {
    startDate: `${y}-${mm}-01`,
    endDate: `${y}-${mm}-${dd}`,
  }
}

function getMonthValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getMonthLabel(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number)
  if (!year || !month) return ''
  return `${year}年${month}月`
}

function calcMonthRangeByValue(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue || ''))) {
    return calcMonthRange()
  }
  const [year, month] = monthValue.split('-').map(Number)
  return calcMonthRange(new Date(year, month - 1, 1))
}

function getOffsetMonthValue(monthValue, offset) {
  const source = /^\d{4}-\d{2}$/.test(String(monthValue || ''))
    ? monthValue
    : getMonthValue()
  const [year, month] = source.split('-').map(Number)
  return getMonthValue(new Date(year, month - 1 + offset, 1))
}

function formatTransactionDate(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const weekday = weekdays[d.getDay()]
  return `${month}-${day} 周${weekday}`
}

function buildCategorySections(list, collapsedMap) {
  const map = new Map()
  for (const item of list || []) {
    const name = String(item.category || '未分类').trim() || '未分类'
    const key = name
    const amount = Number(item.amount || 0)
    if (!map.has(key)) {
      map.set(key, { key, name, total: 0, items: [] })
    }
    const section = map.get(key)
    section.total += amount
    section.items.push(item)
  }

  const usedColors = new Set()
  const sections = Array.from(map.values())
    .map((s) => ({
      ...s,
      totalText: formatAmount(s.total),
      count: (s.items || []).length,
      catInitial: categoryInitial(s.name),
      catIconBg: pickUniqueCategoryBg(s.name, usedColors),
      items: (s.items || []).slice().sort((a, b) => Number(b.transaction_time || 0) - Number(a.transaction_time || 0)),
      collapsed: Boolean(collapsedMap && collapsedMap[s.key]),
    }))
    .sort((a, b) => b.total - a.total)

  return sections
}

const { isPrivilegedUser } = require('../../utils/privileged-user')

Page({
  data: {
    isPrivileged: false,
    isLoading: false,

    monthValue: '',
    monthLabel: '',
    startDate: '',
    endDate: '',

    totalAmount: 0,
    totalAmountText: '0',

    sections: [],
    rawTransactions: [],
    collapsedMap: {},

    // 分类过滤模式
    categoryFilter: null,
    categoryName: '',
    pageReady: false,
  },

  resetCollapsed() {
    this.setData({ collapsedMap: {} })
  },

  onLoad(options) {
    const { startDate, endDate, categoryId, categoryName } = options || {}

    // 如果从分类支出页跳转，使用传入的参数
    if (startDate && endDate && categoryId) {
      const filter = {
        group_key: 'CATEGORY_SECOND',
        group_id: categoryId,
      }

      this.setData({
        monthValue: String(startDate).slice(0, 7),
        monthLabel: getMonthLabel(String(startDate).slice(0, 7)),
        startDate,
        endDate,
        categoryFilter: filter,
        categoryName: categoryName ? decodeURIComponent(categoryName) : '',
      })
    } else {
      const monthValue = getMonthValue()
      const currentMonthRange = calcMonthRangeByValue(monthValue)
      this.setData({
        monthValue,
        monthLabel: getMonthLabel(monthValue),
        startDate: currentMonthRange.startDate,
        endDate: currentMonthRange.endDate,
        categoryFilter: null,
        categoryName: '',
      })
    }
  },

  async onShow() {
    try {
      await this.checkFeaturePermission()
      if (!this.data.isPrivileged) {
        wx.showToast({ title: '暂无使用权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 500)
        return
      }
      await this.loadTransactions()
    } finally {
      if (!this.data.pageReady) this.setData({ pageReady: true })
    }
  },

  async checkFeaturePermission() {
    try {
      const ok = await isPrivilegedUser()
      this.setData({ isPrivileged: Boolean(ok) })
    } catch (err) {
      this.setData({ isPrivileged: false })
    }
  },

  async loadTransactions() {
    if (this.data.isLoading) return
    const { startDate, endDate, categoryFilter } = this.data
    if (!startDate || !endDate) return

    this.setData({ isLoading: true, sections: [] })
    try {
      const res = await fetchFeideeTransactions(startDate, endDate, categoryFilter)
      const rawList = Array.isArray(res?.list) ? res.list : []

      const decorated = rawList.map((item) => ({
        ...item,
        amountText: formatAmount(item.amount || 0),
        dateText: formatTransactionDate(item.transaction_time),
      }))

      const totalAmount = Number(res?.totalAmount || 0)

      // 如果是分类过滤模式，不按分类分组，直接显示交易列表
      if (categoryFilter) {
        this.setData({
          sections: [],
          rawTransactions: decorated,
          totalAmount,
          totalAmountText: formatAmount(totalAmount),
        })
      } else {
        this.setData({
          sections: buildCategorySections(decorated, this.data.collapsedMap),
          rawTransactions: [],
          totalAmount,
          totalAmountText: formatAmount(totalAmount),
        })
      }
    } catch (err) {
      wx.showToast({ title: err?.message || '查询失败', icon: 'none' })
      this.setData({ sections: [], rawTransactions: [], totalAmount: 0, totalAmountText: '0' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  switchMonthByOffset(offset) {
    const monthValue = getOffsetMonthValue(this.data.monthValue, offset)
    const { startDate, endDate } = calcMonthRangeByValue(monthValue)
    this.resetCollapsed()
    this.setData({
      monthValue,
      monthLabel: getMonthLabel(monthValue),
      startDate,
      endDate,
    })
    this.loadTransactions()
  },

  onPrevMonth() {
    this.switchMonthByOffset(-1)
  },

  onNextMonth() {
    this.switchMonthByOffset(1)
  },

  onToggleCategory(e) {
    const key = e?.currentTarget?.dataset?.key
    if (!key) return
    const prev = this.data.collapsedMap || {}
    const next = { ...prev, [key]: !prev[key] }
    const nextSections = (this.data.sections || []).map((s) =>
      s.key === key ? { ...s, collapsed: Boolean(next[key]) } : s,
    )
    this.setData({ collapsedMap: next, sections: nextSections })
  },

  onClearCategoryFilter() {
    this.setData({ categoryFilter: null, categoryName: '' })
    this.loadTransactions()
  },
})
