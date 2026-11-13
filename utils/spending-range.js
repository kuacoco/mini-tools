// 两个支出页面共用的原生日期区间交互。
function createRangeHandlers(loadMethod, showToast) {
  return {
    onStartDateChange(e) {
      this.onRangeDateChange('startDate', e)
    },
    onEndDateChange(e) {
      this.onRangeDateChange('endDate', e)
    },
    onRangeDateChange(field, e) {
      const value = e?.detail?.value
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || value === this.data[field]) return
      const startDate = field === 'startDate' ? value : this.data.startDate
      const endDate = field === 'endDate' ? value : this.data.endDate
      if (startDate > endDate) {
        showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
        return
      }
      this.resetCollapsed()
      this.setData({ quickType: 'range', startDate, endDate, monthValue: startDate.slice(0, 7) })
      this[loadMethod]()
    },
  }
}

function isFullMonth(startDate, endDate) {
  const [year, month] = String(startDate).split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return startDate === `${String(startDate).slice(0, 7)}-01`
    && endDate === `${String(startDate).slice(0, 7)}-${lastDay}`
}

module.exports = { createRangeHandlers, isFullMonth }
