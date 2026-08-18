const { checkWhitelist, fetchFeideeTransactions } = require('../../utils/budget-storage')
const { getCurrentDateString } = require('../../utils/course-storage')
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

function calcOffsetMonthRange(offset, baseDate = new Date()) {
  const y = baseDate.getFullYear()
  const m = baseDate.getMonth()
  return calcMonthRange(new Date(y, m + offset, 1))
}

function calcShiftedMonthRangeFromDateString(dateString, offset) {
  const source = String(dateString || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return calcOffsetMonthRange(offset)
  }
  const [year, month] = source.split('-').map(Number)
  return calcMonthRange(new Date(year, month - 1 + offset, 1))
}

function inferQuickTypeByRange(startDate, endDate, today) {
  const currentMonthRange = calcMonthRange()
  if (startDate === today && endDate === today) return 'today'
  if (
    startDate === currentMonthRange.startDate &&
    endDate === currentMonthRange.endDate
  ) {
    return 'month'
  }
  return 'custom'
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

Page({
  data: {
    isWhitelisted: false,
    isLoading: false,

    quickType: 'today',
    startDate: '',
    endDate: '',

    totalAmount: 0,
    totalAmountText: '0',

    sections: [],
    collapsedMap: {},

    // 分类过滤模式
    categoryFilter: null,
    categoryName: '',
  },

  resetCollapsed() {
    this.setData({ collapsedMap: {} })
  },

  onLoad(options) {
    const today = getCurrentDateString()
    const { startDate, endDate, categoryId, categoryName } = options || {}

    // 如果从分类支出页跳转，使用传入的参数
    if (startDate && endDate && categoryId) {
      const filter = {
        group_key: 'CATEGORY_SECOND',
        group_id: categoryId,
      }

      this.setData({
        quickType: inferQuickTypeByRange(startDate, endDate, today),
        startDate,
        endDate,
        categoryFilter: filter,
        categoryName: categoryName ? decodeURIComponent(categoryName) : '',
      })
    } else {
      this.setData({
        quickType: 'today',
        startDate: today,
        endDate: today,
        categoryFilter: null,
        categoryName: '',
      })
    }
  },

  async onShow() {
    await this.checkWhitelistPermission()
    if (!this.data.isWhitelisted) {
      wx.showToast({ title: '该功能仅限白名单用户使用', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    await this.loadTransactions()
  },

  async checkWhitelistPermission() {
    try {
      const ok = await checkWhitelist()
      this.setData({ isWhitelisted: Boolean(ok) })
    } catch (err) {
      this.setData({ isWhitelisted: false })
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

  onQuickToday() {
    if (this.data.quickType === 'today') return
    const today = getCurrentDateString()
    this.resetCollapsed()
    this.setData({ quickType: 'today', startDate: today, endDate: today, categoryFilter: null, categoryName: '' })
    this.loadTransactions()
  },

  onQuickMonth() {
    if (this.data.quickType === 'month') return
    const { startDate, endDate } = calcMonthRange()
    this.resetCollapsed()
    this.setData({ quickType: 'month', startDate, endDate, categoryFilter: null, categoryName: '' })
    this.loadTransactions()
  },

  onPagePrevMonth() {
    const { startDate, endDate } = calcShiftedMonthRangeFromDateString(
      this.data.startDate,
      -1
    )
    this.resetCollapsed()
    this.setData({
      quickType: 'custom',
      startDate,
      endDate,
    })
    this.loadTransactions()
  },

  onPageNextMonth() {
    const { startDate, endDate } = calcShiftedMonthRangeFromDateString(
      this.data.startDate,
      1
    )
    this.resetCollapsed()
    this.setData({
      quickType: 'custom',
      startDate,
      endDate,
    })
    this.loadTransactions()
  },

  onStartDateChange(e) {
    const nextStart = e?.detail?.value
    if (!nextStart || nextStart === this.data.startDate) return
    const endDate = this.data.endDate
    if (String(nextStart) > String(endDate)) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
      return
    }

    this.resetCollapsed()
    this.setData({ quickType: 'custom', startDate: nextStart })
    this.loadTransactions()
  },

  onEndDateChange(e) {
    const nextEnd = e?.detail?.value
    if (!nextEnd || nextEnd === this.data.endDate) return
    const startDate = this.data.startDate
    if (String(startDate) > String(nextEnd)) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' })
      return
    }

    this.resetCollapsed()
    this.setData({ quickType: 'custom', endDate: nextEnd })
    this.loadTransactions()
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
