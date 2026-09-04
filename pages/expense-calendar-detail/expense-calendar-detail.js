const { fetchFeideeTransactions } = require('../../utils/budget-storage')
const { formatAmount } = require('../../utils/amount-expression')
const { isPrivilegedUser } = require('../../utils/privileged-user')

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function formatDateTitle(date) {
  const [year, month, day] = String(date).split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function formatTransactionTime(timestamp) {
  const date = new Date(Number(timestamp || 0))
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

Page({
  data: {
    date: '',
    dateTitle: '',
    totalAmountText: '0',
    transactions: [],
    isLoading: false,
    loadError: '',
  },

  onLoad(options) {
    const date = options && options.date ? String(options.date) : ''
    if (!isValidDate(date)) {
      wx.showToast({ title: '日期参数无效', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 300)
      return
    }
    this.setData({ date, dateTitle: formatDateTitle(date) })
  },

  async onShow() {
    if (!this.data.date) return
    const allowed = await isPrivilegedUser()
    if (!allowed) {
      wx.showToast({ title: '暂无此工具的使用权限', icon: 'none' })
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 450)
      return
    }
    this.loadDayTransactions()
  },

  async loadDayTransactions() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    const { date } = this.data
    this.setData({ isLoading: true, loadError: '', transactions: [], totalAmountText: '0' })

    try {
      const result = await fetchFeideeTransactions(date, date)
      if (requestId !== this._requestId) return
      const rawTransactions = Array.isArray(result && result.list) ? result.list : []
      const transactions = rawTransactions.map((item, index) => ({
        ...item,
        rowKey: `${item.id || 'transaction'}-${index}`,
        amountText: formatAmount(item.amount),
        timeText: formatTransactionTime(item.transaction_time),
        isLast: index === rawTransactions.length - 1,
      }))
      this.setData({
        transactions,
        totalAmountText: formatAmount(result && result.totalAmount),
      })
    } catch (err) {
      if (requestId !== this._requestId) return
      this.setData({ loadError: err && err.message ? err.message : '当天消费明细加载失败' })
    } finally {
      if (requestId === this._requestId) this.setData({ isLoading: false })
    }
  },
})
