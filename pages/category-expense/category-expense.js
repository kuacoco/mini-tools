const { checkWhitelist, fetchFeideeCategoryExpense } = require('../../utils/budget-storage')
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

Page({
  data: {
    isWhitelisted: false,
    isLoading: false,

    quickType: 'month',
    startDate: '',
    endDate: '',

    totalAmount: 0,
    totalAmountText: '0',

    sections: [],
    collapsedMap: {},
  },

  resetCollapsed() {
    this.setData({ collapsedMap: {} })
  },

  onLoad() {
    const { startDate, endDate } = calcMonthRange()
    this.setData({
      quickType: 'month',
      startDate,
      endDate,
    })
  },

  async onShow() {
    await this.checkWhitelistPermission()
    if (!this.data.isWhitelisted) {
      wx.showToast({ title: '该功能仅限白名单用户使用', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 500)
      return
    }
    await this.loadCategoryExpense()
  },

  async checkWhitelistPermission() {
    try {
      const ok = await checkWhitelist()
      this.setData({ isWhitelisted: Boolean(ok) })
    } catch (err) {
      this.setData({ isWhitelisted: false })
    }
  },

  async loadCategoryExpense() {
    if (this.data.isLoading) return
    const { startDate, endDate } = this.data
    if (!startDate || !endDate) return

    this.setData({ isLoading: true, sections: [] })
    try {
      const res = await fetchFeideeCategoryExpense(startDate, endDate)
      const rawSections = Array.isArray(res?.sections) ? res.sections : []
      const totalAmount = Number(res?.totalAmount || 0)

      this.setData({
        sections: buildSections(rawSections, this.data.collapsedMap),
        totalAmount,
        totalAmountText: formatAmount(totalAmount),
      })
    } catch (err) {
      wx.showToast({ title: err?.message || '查询失败', icon: 'none' })
      this.setData({ sections: [], totalAmount: 0, totalAmountText: '0' })
    } finally {
      this.setData({ isLoading: false })
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
    this.loadCategoryExpense()
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
})