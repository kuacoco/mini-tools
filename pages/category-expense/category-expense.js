const { createRangeHandlers } = require('../../utils/spending-range')
const { fetchFeideeCategoryExpense } = require('../../utils/budget-storage')
const { getCurrentDateString } = require('../../utils/course-storage')
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

function formatAmount(amount) {
  const n = Number(amount) || 0
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function buildSections(rawSections, collapsedMap) {
  const usedColors = new Set()
  return (rawSections || []).map((parent) => {
    const catIconBg = pickUniqueCategoryBg(parent.group_name, usedColors)
    return {
      ...parent,
      catIconBg,
      catInitial: categoryInitial(parent.group_name),
      collapsed: Boolean(collapsedMap && collapsedMap[parent.group_id]),
    }
  })
}

const { isPrivilegedUser } = require('../../utils/privileged-user')

Page({
  ...createRangeHandlers('loadCategoryExpense', (options) => wx.showToast(options)),
  data: {
    headerKicker: 'CATEGORY SPENDING',
    isPrivileged: false,
    isLoading: false,

    quickType: 'month',
    monthLabel: '',
    startDate: '',
    endDate: '',

    totalAmount: 0,
    totalAmountText: '0',

    sections: [],
    collapsedMap: {},
    pageReady: false,
  },

  resetCollapsed() {
    this.setData({ collapsedMap: {} })
  },

  async onLoad() {
    try {
      const { startDate, endDate } = calcMonthRange()
      this.setData({
        quickType: 'month',
        startDate,
        endDate,
      })

      await this.checkFeaturePermission()
      if (!this.data.isPrivileged) {
        wx.showToast({ title: '暂无使用权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 500)
        return
      }
      await this.loadCategoryExpense()
    } finally {
      this.setData({ pageReady: true })
    }
  },

  async onShow() {
    // 数据已在 onLoad 中加载，这里不再重复加载
  },

  async checkFeaturePermission() {
    try {
      const ok = await isPrivilegedUser()
      this.setData({ isPrivileged: Boolean(ok) })
    } catch (err) {
      this.setData({ isPrivileged: false })
    }
  },

  async loadCategoryExpense() {
    const { startDate, endDate } = this.data
    if (!startDate || !endDate) return

    const requestId = this._requestId = (this._requestId || 0) + 1
    this.setData({ isLoading: true, sections: [] })
    try {
      const res = await fetchFeideeCategoryExpense(startDate, endDate)
      if (requestId !== this._requestId) return
      const rawSections = Array.isArray(res?.sections) ? res.sections : []
      const totalAmount = Number(res?.totalAmount || 0)

      this.setData({
        sections: buildSections(rawSections, this.data.collapsedMap),
        totalAmount,
        totalAmountText: formatAmount(totalAmount),
      })
    } catch (err) {
      if (requestId !== this._requestId) return
      wx.showToast({ title: err?.message || '查询失败', icon: 'none' })
      this.setData({ sections: [], totalAmount: 0, totalAmountText: '0' })
    } finally {
      if (requestId === this._requestId) this.setData({ isLoading: false })
    }
  },

  onQuickToday() {
    if (this.data.quickType === 'today') return
    const today = getCurrentDateString()
    this.resetCollapsed()
    this.setData({ quickType: 'today', startDate: today, endDate: today })
    this.loadCategoryExpense()
  },

  onQuickMonth() {
    if (this.data.quickType === 'month') return
    const { startDate, endDate } = calcMonthRange()
    this.resetCollapsed()
    this.setData({ quickType: 'month', startDate, endDate })
    this.loadCategoryExpense()
  },

  onPagePrevMonth() {
    const { startDate, endDate } = calcShiftedMonthRangeFromDateString(
      this.data.startDate,
      -1
    )
    this.resetCollapsed()
    this.setData({
      quickType: 'custom',
      monthLabel: `${startDate.slice(0, 4)}年${Number(startDate.slice(5, 7))}月`,
      startDate,
      endDate,
    })
    this.loadCategoryExpense()
  },

  onPageNextMonth() {
    const { startDate, endDate } = calcShiftedMonthRangeFromDateString(
      this.data.startDate,
      1
    )
    this.resetCollapsed()
    this.setData({
      quickType: 'custom',
      monthLabel: `${startDate.slice(0, 4)}年${Number(startDate.slice(5, 7))}月`,
      startDate,
      endDate,
    })
    this.loadCategoryExpense()
  },

  onToggleCategory(e) {
    const groupId = e?.currentTarget?.dataset?.groupId
    if (!groupId) return
    const prev = this.data.collapsedMap || {}
    const next = { ...prev, [groupId]: !prev[groupId] }
    const nextSections = (this.data.sections || []).map((s) =>
      s.group_id === groupId ? { ...s, collapsed: Boolean(next[groupId]) } : s,
    )
    this.setData({ collapsedMap: next, sections: nextSections })
  },

  onChildTap(e) {
    const { groupid, groupname } = e?.currentTarget?.dataset || {}
    if (!groupid) return

    const { startDate, endDate } = this.data
    const url = `/pages/feidee-bill/feidee-bill?startDate=${startDate}&endDate=${endDate}&categoryId=${encodeURIComponent(groupid)}&categoryName=${encodeURIComponent(groupname || '')}`
    wx.navigateTo({ url })
  },
})
