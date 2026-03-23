const {
  getCurrentMonthKey,
  getCurrentDateString,
  listCourses,
  listCoursesForShare,
  getCheckinLogs,
  getCheckinLogsForShare,
} = require('../../utils/course-storage')
const { COLOR_PALETTE } = require('../../utils/course-palette')
const {
  WEEKDAYS,
  getMonthLabel,
  getOffsetMonthKey,
  generateCalendarDays,
  generateMonthPickerItems,
  findMonthPickerIndex,
} = require('../../utils/course-calendar')

function formatLogDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || ''
  const [y, m, d] = dateStr.split('-')
  return `${y}年${Number(m)}月${Number(d)}日`
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

function uniqueCheckinDates(logs) {
  const seen = new Set()
  const out = []
  for (const row of logs || []) {
    const d = row.checkinDate
    if (d && !seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

Page({
  data: {
    courseId: '',
    shareToken: '',
    isViewerMode: false,
    courseName: '',
    totalClasses: 0,
    usedClasses: 0,
    remainClasses: 0,
    percentText: '0%',
    barWidth: '0%',
    barColor: '#2dd4bf',
    trackColor: '#ccfbf1',
    firstChar: '',
    avatarColor: '#2dd4bf',
    checkinLogs: [],
    loadError: '',
    weekDays: WEEKDAYS,
    currentMonthKey: '',
    currentMonthLabel: '',
    currentPickerIndex: 0,
    monthPickerItems: [],
    selectedDate: '',
    selectedDateDisplay: '',
    todayDateString: '',
    calendarDaysSwipe: [[], [], []],
    swiperMonthIndex: 1,
    calendarSwiperKey: 0,
  },

  onLoad(options) {
    const courseId = options && options.id ? String(options.id).trim() : ''
    const shareToken = options && options.shareToken ? String(options.shareToken).trim() : ''
    const monthKey = getCurrentMonthKey()
    const today = getCurrentDateString()
    const monthPickerItems = generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)

    this.setData({
      courseId,
      shareToken,
      isViewerMode: !!shareToken,
      weekDays: WEEKDAYS,
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
      selectedDate: today,
      selectedDateDisplay: formatDateDisplay(today),
      todayDateString: today,
    })

    if (!courseId) {
      this.setData({ loadError: '缺少课程信息' })
      return
    }
    this.loadDetail()
  },

  onShow() {
    this.setData({ todayDateString: getCurrentDateString() })
    if (this.data.courseId && !this.data.loadError) {
      this.loadDetail()
    }
  },

  buildCalendarDays(checkinDateList, color, monthKey, selectedDateOverride) {
    const key = monthKey || this.data.currentMonthKey || getCurrentMonthKey()
    const selectedDate =
      selectedDateOverride !== undefined && selectedDateOverride !== null
        ? selectedDateOverride
        : this.data.selectedDate
    const [year, month] = key.split('-')
    const dotBg = `linear-gradient(145deg, ${color.light} 0%, ${color.main} 100%)`
    return generateCalendarDays(
      Number(year),
      Number(month),
      checkinDateList,
      selectedDate,
      {},
      dotBg
    )
  },

  assembleCalendarSwipe(centerMonthKey, selectedDateOverride, paletteColorOverride) {
    const dates = this._courseCheckinDateList || []
    const paletteColor = paletteColorOverride || { main: this.data.barColor, light: this.data.trackColor }
    const key = centerMonthKey || this.data.currentMonthKey || getCurrentMonthKey()
    const prevKey = getOffsetMonthKey(key, -1)
    const nextKey = getOffsetMonthKey(key, 1)
    const sel =
      selectedDateOverride !== undefined && selectedDateOverride !== null
        ? selectedDateOverride
        : this.data.selectedDate
    return {
      calendarDaysSwipe: [
        this.buildCalendarDays(dates, paletteColor, prevKey, sel),
        this.buildCalendarDays(dates, paletteColor, key, sel),
        this.buildCalendarDays(dates, paletteColor, nextKey, sel),
      ],
      swiperMonthIndex: 1,
    }
  },

  async loadDetail() {
    const { courseId, shareToken, isViewerMode } = this.data
    if (!courseId) return

    this._courseCheckinDateList = []

    let list = []
    try {
      if (isViewerMode && shareToken) {
        list = await listCoursesForShare(shareToken)
      } else {
        list = await listCourses()
      }
    } catch (err) {
      this.setData({
        loadError: (err && err.message) ? err.message : '加载失败',
      })
      return
    }

    list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    const course = list.find(c => c.id === courseId)
    if (!course) {
      this.setData({ loadError: '课程不存在或已删除' })
      return
    }

    const colorIndex = list.findIndex(c => c.id === courseId)
    const color = COLOR_PALETTE[Math.max(0, colorIndex) % COLOR_PALETTE.length]
    const total = Number(course.totalClasses || 0)
    const used = Number(course.usedClasses || 0)
    const rawPercent = total <= 0 ? 0 : (used / total) * 100
    const percent = Math.max(0, Math.min(100, rawPercent))
    const remain = Math.max(0, total - used)

    let logs = []
    try {
      if (isViewerMode && shareToken) {
        logs = await getCheckinLogsForShare(shareToken, courseId)
      } else {
        logs = await getCheckinLogs(courseId)
      }
    } catch (err) {
      logs = []
    }

    const checkinDateList = uniqueCheckinDates(logs)
    this._courseCheckinDateList = checkinDateList

    const checkinLogs = (logs || []).map((row) => ({
      id: row.id,
      displayDate: formatLogDate(row.checkinDate),
      note: (row.note || '').trim(),
    }))

    const paletteForCal = { main: color.main, light: color.light }
    const swipe = this.assembleCalendarSwipe(this.data.currentMonthKey, undefined, paletteForCal)

    const centerKey = this.data.currentMonthKey
    const monthChanged = this._lastCalendarCenterMonthKey !== centerKey
    this._lastCalendarCenterMonthKey = centerKey

    const patch = {
      loadError: '',
      courseName: course.courseName || '',
      totalClasses: total,
      usedClasses: used,
      remainClasses: remain,
      percentText: `${Math.round(rawPercent)}%`,
      barWidth: `${percent}%`,
      barColor: color.main,
      trackColor: color.light,
      firstChar: (course.courseName || '').charAt(0) || '课',
      avatarColor: color.main,
      checkinLogs,
      ...swipe,
    }
    if (monthChanged) {
      patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
    }
    this.setData(patch)
  },

  onPrevMonth() {
    const newKey = getOffsetMonthKey(this.data.currentMonthKey, -1)
    this.switchMonth(newKey)
  },

  onNextMonth() {
    const newKey = getOffsetMonthKey(this.data.currentMonthKey, 1)
    this.switchMonth(newKey)
  },

  switchMonth(monthKey) {
    if (this.data.loadError || !this.data.courseId) return
    vibrateLight()
    const monthPickerItems = this.data.monthPickerItems.length
      ? this.data.monthPickerItems
      : generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)
    const swipe = this.assembleCalendarSwipe(monthKey)
    const monthChanged = this._lastCalendarCenterMonthKey !== monthKey
    this._lastCalendarCenterMonthKey = monthKey
    const patch = {
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
      ...swipe,
    }
    if (monthChanged) {
      patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
    }
    this.setData(patch)
  },

  onSelectMonth(e) {
    if (this.data.loadError || !this.data.courseId) return
    const { value } = e.detail
    const item = this.data.monthPickerItems[value]
    if (!item) return
    vibrateLight()
    const monthKey = item.monthKey
    const swipe = this.assembleCalendarSwipe(monthKey)
    const monthChanged = this._lastCalendarCenterMonthKey !== monthKey
    this._lastCalendarCenterMonthKey = monthKey
    const patch = {
      currentPickerIndex: value,
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      ...swipe,
    }
    if (monthChanged) {
      patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
    }
    this.setData(patch)
  },

  onSelectDate(e) {
    if (this.data.loadError || !this.data.courseId) return
    const date = (e.detail && e.detail.date) || (e.currentTarget.dataset && e.currentTarget.dataset.date)
    if (!date) return
    vibrateLight()
    const monthKeyOfDate = date.slice(0, 7)
    if (monthKeyOfDate !== this.data.currentMonthKey) {
      const monthPickerItems = this.data.monthPickerItems.length
        ? this.data.monthPickerItems
        : generateMonthPickerItems(monthKeyOfDate)
      const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKeyOfDate)
      const swipe = this.assembleCalendarSwipe(monthKeyOfDate, date)
      const monthChanged = this._lastCalendarCenterMonthKey !== monthKeyOfDate
      this._lastCalendarCenterMonthKey = monthKeyOfDate
      const patch = {
        selectedDate: date,
        selectedDateDisplay: formatDateDisplay(date),
        currentMonthKey: monthKeyOfDate,
        currentMonthLabel: getMonthLabel(monthKeyOfDate),
        currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
        ...swipe,
      }
      if (monthChanged) {
        patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
      }
      this.setData(patch)
      return
    }
    const swipe = this.assembleCalendarSwipe(this.data.currentMonthKey, date)
    this.setData({
      selectedDate: date,
      selectedDateDisplay: formatDateDisplay(date),
      ...swipe,
    })
  },

  goToToday() {
    if (this.data.loadError || !this.data.courseId) return
    const today = getCurrentDateString()
    const monthKey = getCurrentMonthKey()
    const monthPickerItems = generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)
    vibrateLight()
    const swipe = this.assembleCalendarSwipe(monthKey, today)
    const monthChanged = this._lastCalendarCenterMonthKey !== monthKey
    this._lastCalendarCenterMonthKey = monthKey
    const patch = {
      selectedDate: today,
      selectedDateDisplay: formatDateDisplay(today),
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
      ...swipe,
    }
    if (monthChanged) {
      patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
    }
    this.setData(patch)
  },

  onBackToCourse() {
    wx.navigateBack({ delta: 1 })
  },
})
