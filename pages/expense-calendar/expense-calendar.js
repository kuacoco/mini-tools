const { fetchFeideeTransactions } = require('../../utils/budget-storage')
const { formatAmount } = require('../../utils/amount-expression')
const { isPrivilegedUser } = require('../../utils/privileged-user')

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function getMonthMeta(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  return {
    year,
    month,
    startDate: `${monthKey}-01`,
    endDate: `${monthKey}-${pad2(daysInMonth)}`,
    firstWeekday: firstDay.getDay(),
    daysInMonth,
  }
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey).split('-')
  return `${year}年${Number(month)}月`
}

function getDateKey(timestamp) {
  const date = new Date(Number(timestamp || 0))
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function getSpendMap(transactions) {
  const map = {}
  for (const item of transactions || []) {
    const dateKey = getDateKey(item.transaction_time)
    if (!dateKey) continue
    map[dateKey] = (map[dateKey] || 0) + Number(item.amount || 0)
  }
  return map
}

function getIntensity(amount, maxAmount) {
  if (amount <= 0 || maxAmount <= 0) return 0
  const ratio = amount / maxAmount
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function buildCalendarCells(monthKey, spendMap) {
  const { year, month, firstWeekday, daysInMonth } = getMonthMeta(monthKey)
  const amounts = Object.keys(spendMap || {}).map((key) => Number(spendMap[key] || 0))
  const maxAmount = amounts.length ? Math.max(...amounts) : 0
  const today = getDateKey(Date.now())
  const cells = []

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: `placeholder-start-${i}`, isPlaceholder: true })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`
    const amount = Number((spendMap && spendMap[date]) || 0)
    cells.push({
      key: date,
      date,
      day,
      amount,
      amountText: formatAmount(amount),
      intensity: getIntensity(amount, maxAmount),
      isToday: date === today,
      isPlaceholder: false,
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `placeholder-end-${cells.length}`, isPlaceholder: true })
  }

  return cells.map((cell, index) => ({
    ...cell,
    isWeekEnd: (index + 1) % 7 === 0,
  }))
}

function buildCalendarRows(monthKey, spendMap) {
  const cells = buildCalendarCells(monthKey, spendMap)
  const rows = []
  for (let index = 0; index < cells.length; index += 7) {
    rows.push({
      rowKey: `${monthKey}-${index / 7}`,
      cells: cells.slice(index, index + 7),
    })
  }
  return rows
}

function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ''))
}

Page({
  data: {
    weekDays: WEEK_DAYS,
    monthKey: getMonthKey(),
    monthLabel: '',
    monthTotalText: '0',
    activeDays: 0,
    calendarRows: [],
    isLoading: false,
    loadError: '',
  },

  onLoad() {
    const monthKey = getMonthKey()
    this.setData({
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      calendarRows: buildCalendarRows(monthKey, {}),
    })
  },

  async onShow() {
    const allowed = await isPrivilegedUser()
    if (!allowed) {
      wx.showToast({ title: '暂无此工具的使用权限', icon: 'none' })
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 450)
      return
    }
    if (this._hasLoadedMonth) return
    this._hasLoadedMonth = true
    this.loadMonthTransactions()
  },

  async loadMonthTransactions() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    const { monthKey } = this.data
    if (!isMonthKey(monthKey)) return

    this.setData({
      isLoading: true,
      loadError: '',
      monthTotalText: '0',
      activeDays: 0,
      calendarRows: buildCalendarRows(monthKey, {}),
    })

    try {
      const { startDate, endDate } = getMonthMeta(monthKey)
      const result = await fetchFeideeTransactions(startDate, endDate)
      if (requestId !== this._requestId) return
      const spendMap = getSpendMap(result && result.list)
      const total = Number(result && result.totalAmount ? result.totalAmount : 0)
      const activeDays = Object.keys(spendMap).filter((date) => Number(spendMap[date] || 0) > 0).length
      this.setData({
        monthTotalText: formatAmount(total),
        activeDays,
        calendarRows: buildCalendarRows(monthKey, spendMap),
      })
    } catch (err) {
      if (requestId !== this._requestId) return
      this.setData({ loadError: err && err.message ? err.message : '本月消费数据加载失败' })
    } finally {
      if (requestId === this._requestId) this.setData({ isLoading: false })
    }
  },

  onMonthChange(e) {
    const monthKey = e && e.detail ? e.detail.value : ''
    if (!isMonthKey(monthKey) || monthKey === this.data.monthKey) return
    this.setData({ monthKey, monthLabel: formatMonthLabel(monthKey) })
    this.loadMonthTransactions()
  },

  onTapDay(e) {
    const date = e && e.currentTarget ? e.currentTarget.dataset.date : ''
    if (!date) return
    wx.navigateTo({
      url: `/pages/expense-calendar-detail/expense-calendar-detail?date=${date}`,
    })
  },
})
