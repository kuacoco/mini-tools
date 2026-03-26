const {
  getCurrentDateString,
  getCurrentMonthKey,
  listEventsByRange,
  upsertEvent,
  deleteEvent,
  createShareToken,
  listEventsForShareByRange,
  listViewedShares,
  upsertViewedShare,
  removeViewedShare,
} = require('../../utils/qing-calendar-storage')

const SHARE_NAME_STORAGE_KEY = 'qing_calendar_share_name_v1'
const CALENDAR_VISIBILITY_STORAGE_KEY = 'qing_calendar_visibility_v1'
const INITIAL_PREV_MONTHS = 3
const INITIAL_NEXT_MONTHS = 5
const LOAD_CHUNK_MONTHS = 4
const POPUP_ANIMATION_MS = 220
const EDGE_LOAD_THROTTLE_MS = 320

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

const COLOR_PALETTE = [
  '#E97E7E',
  '#EE8D6C',
  '#F39E63',
  '#F6B35E',
  '#F2C65F',
  '#E5CD66',
  '#D2C96A',
  '#B9C66E',
  '#9FC474',
  '#86BF7D',
  '#72BA8A',
  '#67B69B',
  '#64B3AB',
  '#69AFC0',
  '#75A9D1',
  '#869FDC',
  '#9A95DA',
  '#B58DD2',
]

function readShareNameConfig() {
  try {
    const raw = wx.getStorageSync(SHARE_NAME_STORAGE_KEY)
    if (raw && typeof raw === 'object' && raw.configured === true) {
      const name = String(raw.name || '').trim()
      return {
        configured: true,
        name,
      }
    }
  } catch (err) {
    // ignore
  }
  return {
    configured: false,
    name: '',
  }
}

function writeShareNameConfig(name) {
  try {
    wx.setStorageSync(SHARE_NAME_STORAGE_KEY, {
      configured: true,
      name: String(name || '').trim(),
    })
  } catch (err) {
    // ignore
  }
}

function readCalendarVisibilityConfig() {
  try {
    const raw = wx.getStorageSync(CALENDAR_VISIBILITY_STORAGE_KEY)
    if (raw && typeof raw === 'object') {
      const myCalendarVisible = typeof raw.myCalendarVisible === 'boolean'
        ? raw.myCalendarVisible
        : true
      const shareVisibility = {}
      if (raw.shareVisibility && typeof raw.shareVisibility === 'object') {
        Object.keys(raw.shareVisibility).forEach((token) => {
          const clean = String(token || '').trim()
          if (!clean) return
          shareVisibility[clean] = !!raw.shareVisibility[token]
        })
      }
      return {
        myCalendarVisible,
        shareVisibility,
      }
    }
  } catch (err) {
    // ignore
  }
  return {
    myCalendarVisible: true,
    shareVisibility: {},
  }
}

function writeCalendarVisibilityConfig(config) {
  const input = config && typeof config === 'object' ? config : {}
  const shareVisibilityInput = input.shareVisibility && typeof input.shareVisibility === 'object'
    ? input.shareVisibility
    : {}
  const shareVisibility = {}
  Object.keys(shareVisibilityInput).forEach((token) => {
    const clean = String(token || '').trim()
    if (!clean) return
    shareVisibility[clean] = !!shareVisibilityInput[token]
  })

  try {
    wx.setStorageSync(CALENDAR_VISIBILITY_STORAGE_KEY, {
      myCalendarVisible: typeof input.myCalendarVisible === 'boolean' ? input.myCalendarVisible : true,
      shareVisibility,
    })
  } catch (err) {
    // ignore
  }
}

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function getMonthKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  return `${year}年${Number(month)}月`
}

function getMonthStartDate(monthKey) {
  return `${monthKey}-01`
}

function getMonthEndDate(monthKey) {
  const [year, month] = monthKey.split('-')
  const end = new Date(Number(year), Number(month), 0)
  return formatDateString(end)
}

function getOffsetMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1 + offset, 1)
  return getMonthKeyFromDate(date)
}

function buildMonthWindow(centerMonthKey, prevCount, nextCount) {
  const out = []
  for (let i = prevCount; i >= 1; i -= 1) {
    out.push(getOffsetMonthKey(centerMonthKey, -i))
  }
  out.push(centerMonthKey)
  for (let i = 1; i <= nextCount; i += 1) {
    out.push(getOffsetMonthKey(centerMonthKey, i))
  }
  return out
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatDayPopupTitle(dateStr) {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function formatEventRange(startDate, endDate) {
  if (!startDate || !endDate) return ''
  if (startDate === endDate) return formatDateDisplay(startDate)
  return `${formatDateDisplay(startDate)} - ${formatDateDisplay(endDate)}`
}

function dateRangeToList(startDate, endDate, maxDays = 2200) {
  if (!startDate || !endDate || startDate > endDate) return []
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const out = []
  let cursor = start
  while (cursor.getTime() <= end.getTime()) {
    out.push(formatDateString(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    if (out.length > maxDays) break
  }
  return out
}

function maxDate(a, b) {
  return a > b ? a : b
}

function minDate(a, b) {
  return a < b ? a : b
}

function eventCoversDate(item, dateStr) {
  return item.startDate <= dateStr && item.endDate >= dateStr
}

function normalizeIncomingShareRecords(input, visibilityMap = {}) {
  if (!Array.isArray(input)) return []
  return input
    .map((row) => {
      const token = row && row.token ? String(row.token).trim() : ''
      if (!token) return null
      const calendarName = row && row.calendarName ? String(row.calendarName).trim() : ''
      const short = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-2)}` : token
      const displayTitle = calendarName || `共享日历 ${short}`
      const visibilityFromPrev = visibilityMap[token]
      const visible = typeof visibilityFromPrev === 'boolean'
        ? visibilityFromPrev
        : true
      return {
        token,
        calendarName,
        displayTitle,
        visible,
        updatedAt: Number(row && row.updatedAt) || Date.now(),
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
}

function createDayCells(monthKey, selectedDate, todayDate, dateEventMap) {
  const [year, month] = monthKey.split('-').map((v) => Number(v))
  const firstDay = new Date(year, month - 1, 1)
  const startWeekday = firstDay.getDay()
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells = []

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({
      key: `head-empty-${monthKey}-${i}`,
      day: '',
      date: '',
      isCurrentMonth: false,
      isPlaceholder: true,
      isToday: false,
      isSelected: false,
      displayEvents: [],
      moreCount: 0,
      totalCount: 0,
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day)
    const dateStr = formatDateString(date)
    const events = dateEventMap[dateStr] || []
    cells.push({
      key: dateStr,
      day,
      date: dateStr,
      isCurrentMonth: true,
      isPlaceholder: false,
      isToday: dateStr === todayDate,
      isSelected: dateStr === selectedDate,
      displayEvents: events.slice(0, 3),
      moreCount: Math.max(0, events.length - 3),
      totalCount: events.length,
    })
  }

  const remainder = cells.length % 7
  const tailCount = remainder === 0 ? 0 : 7 - remainder
  for (let i = 0; i < tailCount; i += 1) {
    cells.push({
      key: `tail-empty-${monthKey}-${i}`,
      day: '',
      date: '',
      isCurrentMonth: false,
      isPlaceholder: true,
      isToday: false,
      isSelected: false,
      displayEvents: [],
      moreCount: 0,
      totalCount: 0,
    })
  }

  return cells
}

Page({
  data: {
    weekDays: WEEK_DAYS,
    todayDateString: '',
    selectedDate: '',
    selectedDateDisplay: '',

    loadedMonthKeys: [],
    monthSections: [],
    rangeStartDate: '',
    rangeEndDate: '',

    scrollIntoViewId: '',
    scrollWithAnimation: false,

    showCalendarDropdown: false,
    myCalendarVisible: true,
    shareRecords: [],

    showDayPopup: false,
    dayPopupClosing: false,
    dayPopupDate: '',
    dayPopupDateLabel: '',
    dayPopupEvents: [],
    dayPopupLoading: false,

    showEventPopup: false,
    eventPopupClosing: false,
    eventPopupMode: 'add',
    eventPopupTitle: '新增日程',
    eventFormId: '',
    eventFormTitle: '',
    eventFormStartDate: '',
    eventFormEndDate: '',
    eventFormColor: COLOR_PALETTE[0],
    colorPalette: COLOR_PALETTE,
    isSavingEvent: false,

    showShareNamePopup: false,
    shareNameInput: '',
    thisCalendarName: '',
    thisShareToken: '',
  },

  async onLoad(options) {
    const today = getCurrentDateString()
    const monthKey = getCurrentMonthKey()
    const monthKeys = buildMonthWindow(monthKey, INITIAL_PREV_MONTHS, INITIAL_NEXT_MONTHS)

    const shareConfig = readShareNameConfig()
    const visibilityConfig = readCalendarVisibilityConfig()
    const incomingToken = options && options.shareToken ? String(options.shareToken).trim() : ''
    const incomingCalendarName = options && options.calendarName
      ? decodeURIComponent(String(options.calendarName)).trim()
      : ''

    this._myEvents = []
    this._shareEventsByToken = {}
    this._dateEventMap = {}
    this._isRangeLoading = false
    this._isPrepending = false
    this._isAppending = false
    this._topLoadTs = 0
    this._bottomLoadTs = 0
    this._incomingToken = incomingToken
    this._incomingCalendarName = incomingCalendarName
    this._visibilityConfig = visibilityConfig

    this.setData({
      todayDateString: today,
      selectedDate: today,
      selectedDateDisplay: formatDateDisplay(today),
      loadedMonthKeys: monthKeys,
      myCalendarVisible: visibilityConfig.myCalendarVisible,
      thisCalendarName: shareConfig.name,
      shareNameInput: shareConfig.name,
      showShareNamePopup: !shareConfig.configured,
    })

    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage'],
      })
    }

    await this.bootstrapShareRecords()
    await this.refreshCalendarData()
    this.scrollToMonth(monthKey, false)
  },

  onUnload() {
    if (this.dayPopupTimer) clearTimeout(this.dayPopupTimer)
    if (this.eventPopupTimer) clearTimeout(this.eventPopupTimer)
  },

  async onShow() {
    const today = getCurrentDateString()
    if (today !== this.data.todayDateString) {
      this.setData({ todayDateString: today })
      this.rebuildMonthSections(this.data.selectedDate)
    }
  },

  persistCalendarVisibility(options = {}) {
    const myCalendarVisible = typeof options.myCalendarVisible === 'boolean'
      ? options.myCalendarVisible
      : !!this.data.myCalendarVisible
    const shareRecords = Array.isArray(options.shareRecords)
      ? options.shareRecords
      : (this.data.shareRecords || [])
    const shareVisibility = {}
    shareRecords.forEach((item) => {
      const token = item && item.token ? String(item.token).trim() : ''
      if (!token) return
      shareVisibility[token] = !!item.visible
    })
    writeCalendarVisibilityConfig({
      myCalendarVisible,
      shareVisibility,
    })
  },

  async bootstrapShareRecords() {
    let records = []
    try {
      records = await listViewedShares()
    } catch (err) {
      records = []
    }

    if (this._incomingToken) {
      try {
        await upsertViewedShare(this._incomingToken, this._incomingCalendarName)
      } catch (err) {
        wx.showToast({ title: err.message || '共享日历无效', icon: 'none' })
      }
      try {
        records = await listViewedShares()
      } catch (err) {
        // ignore
      }
    }

    const visibilityMap = {
      ...(this._visibilityConfig && this._visibilityConfig.shareVisibility
        ? this._visibilityConfig.shareVisibility
        : {}),
    }
    ;(this.data.shareRecords || []).forEach((item) => {
      visibilityMap[item.token] = !!item.visible
    })

    const normalized = normalizeIncomingShareRecords(records, visibilityMap)

    this.setData({ shareRecords: normalized })
    this.persistCalendarVisibility({
      myCalendarVisible: this.data.myCalendarVisible,
      shareRecords: normalized,
    })
  },

  buildAggregatedDateEventMap(rangeStart, rangeEnd) {
    const dateMap = {}
    const allEvents = []

    if (this.data.myCalendarVisible) {
      for (const item of this._myEvents || []) {
        allEvents.push({
          id: item.id,
          title: item.title || '',
          startDate: item.startDate,
          endDate: item.endDate,
          color: item.color,
          isOwner: true,
          token: 'self',
          calendarName: '我的日历',
          sourceRank: 0,
          createdAt: Number(item.createdAt || 0),
        })
      }
    }

    const visibleShares = (this.data.shareRecords || []).filter((item) => item.visible)
    visibleShares.forEach((record, index) => {
      const rows = this._shareEventsByToken[record.token] || []
      rows.forEach((item) => {
        allEvents.push({
          id: item.id,
          title: item.title || '',
          startDate: item.startDate,
          endDate: item.endDate,
          color: item.color,
          isOwner: false,
          token: record.token,
          calendarName: record.calendarName || record.displayTitle,
          sourceRank: index + 1,
          createdAt: Number(item.createdAt || 0),
        })
      })
    })

    allEvents.sort((a, b) => {
      if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
      return String(a.id).localeCompare(String(b.id))
    })

    for (const item of allEvents) {
      if (!item.startDate || !item.endDate || item.startDate > item.endDate) continue
      const from = maxDate(item.startDate, rangeStart)
      const to = minDate(item.endDate, rangeEnd)
      if (from > to) continue

      const days = dateRangeToList(from, to)
      for (const day of days) {
        if (!dateMap[day]) dateMap[day] = []
        dateMap[day].push({
          id: item.id,
          title: item.title,
          color: item.color,
          isOwner: item.isOwner,
          token: item.token,
          calendarName: item.calendarName,
          startDate: item.startDate,
          endDate: item.endDate,
          createdAt: item.createdAt,
        })
      }
    }

    this._dateEventMap = dateMap
  },

  rebuildMonthSections(selectedDate) {
    const monthKeys = this.data.loadedMonthKeys || []
    if (!monthKeys.length) return

    const rangeStart = getMonthStartDate(monthKeys[0])
    const rangeEnd = getMonthEndDate(monthKeys[monthKeys.length - 1])

    this.buildAggregatedDateEventMap(rangeStart, rangeEnd)

    const sections = monthKeys.map((monthKey) => ({
      monthKey,
      label: getMonthLabel(monthKey),
      cells: createDayCells(
        monthKey,
        selectedDate || this.data.selectedDate,
        this.data.todayDateString,
        this._dateEventMap
      ),
    }))

    this.setData({
      monthSections: sections,
      selectedDate: selectedDate || this.data.selectedDate,
      selectedDateDisplay: formatDateDisplay(selectedDate || this.data.selectedDate),
      rangeStartDate: rangeStart,
      rangeEndDate: rangeEnd,
    })
  },

  async refreshCalendarData() {
    if (this._isRangeLoading) return

    const monthKeys = this.data.loadedMonthKeys || []
    if (!monthKeys.length) return

    const rangeStart = getMonthStartDate(monthKeys[0])
    const rangeEnd = getMonthEndDate(monthKeys[monthKeys.length - 1])

    this._isRangeLoading = true

    let myEvents = []
    try {
      myEvents = await listEventsByRange(rangeStart, rangeEnd)
    } catch (err) {
      wx.showToast({ title: err.message || '日程加载失败', icon: 'none' })
      this._isRangeLoading = false
      return
    }

    const visibleShares = (this.data.shareRecords || []).filter((item) => item.visible)
    const shareResults = await Promise.all(
      visibleShares.map(async (item) => {
        try {
          const data = await listEventsForShareByRange(item.token, rangeStart, rangeEnd)
          return {
            token: item.token,
            ok: true,
            list: data.list || [],
            calendarName: String(data.calendarName || '').trim(),
          }
        } catch (err) {
          return {
            token: item.token,
            ok: false,
            error: err,
          }
        }
      })
    )

    const shareEventsByToken = {}
    const invalidTokens = []
    const remoteNameMap = {}

    shareResults.forEach((res) => {
      if (res.ok) {
        shareEventsByToken[res.token] = res.list || []
        if (res.calendarName) {
          remoteNameMap[res.token] = res.calendarName
        }
      } else {
        invalidTokens.push(res.token)
      }
    })

    let shareRecords = this.data.shareRecords || []

    if (Object.keys(remoteNameMap).length) {
      shareRecords = shareRecords.map((item) => {
        const nextName = remoteNameMap[item.token]
        if (!nextName || nextName === item.calendarName) return item
        return {
          ...item,
          calendarName: nextName,
          displayTitle: nextName,
        }
      })
    }

    if (invalidTokens.length) {
      shareRecords = shareRecords.filter((item) => !invalidTokens.includes(item.token))
      for (const token of invalidTokens) {
        try {
          await removeViewedShare(token)
        } catch (err) {
          // ignore
        }
      }
      wx.showToast({ title: '已清理失效共享日历', icon: 'none' })
    }

    this._myEvents = myEvents
    this._shareEventsByToken = shareEventsByToken

    this.setData({ shareRecords })
    this.persistCalendarVisibility({
      myCalendarVisible: this.data.myCalendarVisible,
      shareRecords,
    })
    this.rebuildMonthSections(this.data.selectedDate)

    if (this.data.showDayPopup && this.data.dayPopupDate) {
      this.openDayPopup(this.data.dayPopupDate)
    }

    this._isRangeLoading = false
  },

  onReachCalendarTop() {
    const now = Date.now()
    if (now - this._topLoadTs < EDGE_LOAD_THROTTLE_MS) return
    this._topLoadTs = now
    this.loadMorePrevMonths()
  },

  onReachCalendarBottom() {
    const now = Date.now()
    if (now - this._bottomLoadTs < EDGE_LOAD_THROTTLE_MS) return
    this._bottomLoadTs = now
    this.loadMoreNextMonths()
  },

  async loadMorePrevMonths() {
    if (this._isPrepending) return
    this._isPrepending = true

    const oldKeys = this.data.loadedMonthKeys || []
    if (!oldKeys.length) {
      this._isPrepending = false
      return
    }

    const anchorMonth = oldKeys[0]
    const prepend = []
    for (let i = LOAD_CHUNK_MONTHS; i >= 1; i -= 1) {
      prepend.push(getOffsetMonthKey(anchorMonth, -i))
    }

    this.setData({ loadedMonthKeys: [...prepend, ...oldKeys] })
    await this.refreshCalendarData()
    if (wx.nextTick) {
      wx.nextTick(() => {
        this.scrollToMonth(anchorMonth, false)
      })
    } else {
      setTimeout(() => {
        this.scrollToMonth(anchorMonth, false)
      }, 16)
    }

    this._isPrepending = false
  },

  async loadMoreNextMonths() {
    if (this._isAppending) return
    this._isAppending = true

    const oldKeys = this.data.loadedMonthKeys || []
    if (!oldKeys.length) {
      this._isAppending = false
      return
    }

    const anchorMonth = oldKeys[oldKeys.length - 1]
    const append = []
    for (let i = 1; i <= LOAD_CHUNK_MONTHS; i += 1) {
      append.push(getOffsetMonthKey(anchorMonth, i))
    }

    this.setData({ loadedMonthKeys: [...oldKeys, ...append] })
    await this.refreshCalendarData()

    this._isAppending = false
  },

  async onGoToday() {
    const today = getCurrentDateString()
    const todayMonth = today.slice(0, 7)

    let monthKeys = this.data.loadedMonthKeys || []
    if (!monthKeys.includes(todayMonth)) {
      monthKeys = buildMonthWindow(todayMonth, INITIAL_PREV_MONTHS, INITIAL_NEXT_MONTHS)
      this.setData({ loadedMonthKeys: monthKeys })
      await this.refreshCalendarData()
    }

    vibrateLight()
    this.rebuildMonthSections(today)
    this.scrollToMonth(todayMonth, true)
  },

  scrollToMonth(monthKey, animated) {
    const id = `month-${monthKey}`
    this.setData({
      scrollWithAnimation: !!animated,
      scrollIntoViewId: '',
    })

    setTimeout(() => {
      this.setData({ scrollIntoViewId: id })
      setTimeout(() => {
        if (this.data.scrollIntoViewId === id) {
          this.setData({ scrollIntoViewId: '' })
        }
      }, animated ? 420 : 120)
    }, 30)
  },

  onTapDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    vibrateLight()
    this.rebuildMonthSections(date)
    this.openDayPopup(date)
  },

  async fetchAllEventsForDate(date) {
    const allEvents = []

    if (this.data.myCalendarVisible) {
      try {
        const ownList = await listEventsByRange(date, date)
        ownList.forEach((item) => {
          allEvents.push({
            id: item.id,
            title: item.title || '',
            startDate: item.startDate,
            endDate: item.endDate,
            color: item.color,
            isOwner: true,
            token: 'self',
            calendarName: '我的日历',
            sourceRank: 0,
            createdAt: Number(item.createdAt || 0),
          })
        })
      } catch (err) {
        // ignore
      }
    }

    const visibleShares = (this.data.shareRecords || []).filter((item) => item.visible)
    const shareResults = await Promise.all(
      visibleShares.map(async (share, index) => {
        try {
          const data = await listEventsForShareByRange(share.token, date, date)
          return {
            ok: true,
            token: share.token,
            sourceRank: index + 1,
            calendarName: String(data.calendarName || '').trim() || share.displayTitle,
            list: data.list || [],
          }
        } catch (err) {
          return {
            ok: false,
            token: share.token,
          }
        }
      })
    )

    const invalidTokens = []
    const renameMap = {}
    shareResults.forEach((res) => {
      if (!res.ok) {
        invalidTokens.push(res.token)
        return
      }
      renameMap[res.token] = res.calendarName
      res.list.forEach((item) => {
        allEvents.push({
          id: item.id,
          title: item.title || '',
          startDate: item.startDate,
          endDate: item.endDate,
          color: item.color,
          isOwner: false,
          token: res.token,
          calendarName: res.calendarName,
          sourceRank: res.sourceRank,
          createdAt: Number(item.createdAt || 0),
        })
      })
    })

    if (Object.keys(renameMap).length || invalidTokens.length) {
      let nextShares = this.data.shareRecords || []
      if (Object.keys(renameMap).length) {
        nextShares = nextShares.map((item) => {
          const name = renameMap[item.token]
          if (!name || name === item.calendarName) return item
          return {
            ...item,
            calendarName: name,
            displayTitle: name,
          }
        })
      }
      if (invalidTokens.length) {
        nextShares = nextShares.filter((item) => !invalidTokens.includes(item.token))
        for (const token of invalidTokens) {
          try {
            await removeViewedShare(token)
          } catch (err) {
            // ignore
          }
        }
        wx.showToast({ title: '已清理失效共享日历', icon: 'none' })
      }
      this.setData({ shareRecords: nextShares })
      this.persistCalendarVisibility({
        myCalendarVisible: this.data.myCalendarVisible,
        shareRecords: nextShares,
      })
    }

    allEvents.sort((a, b) => {
      if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
      return String(a.id).localeCompare(String(b.id))
    })

    return allEvents.map((item) => ({
      ...item,
      rangeText: formatEventRange(item.startDate, item.endDate),
      canEdit: !!item.isOwner,
    }))
  },

  async openDayPopup(date) {
    const list = (this._dateEventMap[date] || []).map((item) => ({
      ...item,
      rangeText: formatEventRange(item.startDate, item.endDate),
      canEdit: !!item.isOwner,
    }))

    if (this.dayPopupTimer) clearTimeout(this.dayPopupTimer)
    const requestId = Date.now()
    this._dayPopupReqId = requestId
    this.setData({
      showDayPopup: true,
      dayPopupClosing: false,
      dayPopupDate: date,
      dayPopupDateLabel: formatDayPopupTitle(date),
      dayPopupEvents: list,
      dayPopupLoading: true,
    })

    try {
      const remoteList = await this.fetchAllEventsForDate(date)
      if (this._dayPopupReqId !== requestId) return
      this.setData({
        dayPopupEvents: remoteList,
        dayPopupLoading: false,
      })
    } catch (err) {
      if (this._dayPopupReqId !== requestId) return
      this.setData({ dayPopupLoading: false })
      wx.showToast({ title: err.message || '加载当天日程失败', icon: 'none' })
    }
  },

  onCloseDayPopup() {
    if (!this.data.showDayPopup) return
    if (this.dayPopupTimer) clearTimeout(this.dayPopupTimer)
    this.setData({ dayPopupClosing: true })
    this.dayPopupTimer = setTimeout(() => {
      this.setData({
        showDayPopup: false,
        dayPopupClosing: false,
        dayPopupLoading: false,
      })
    }, POPUP_ANIMATION_MS)
  },

  onOpenAddPopup() {
    this.openEventPopup('add', null, this.data.selectedDate || this.data.todayDateString)
  },

  onOpenAddFromDay() {
    const date = this.data.dayPopupDate || this.data.selectedDate || this.data.todayDateString
    this.onCloseDayPopup()
    this.openEventPopup('add', null, date)
  },

  onEditEventFromDay(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const target = (this.data.dayPopupEvents || []).find((item) => item.id === id)
    if (!target || !target.isOwner) return
    this.openEventPopup('edit', target, target.startDate)
  },

  onDeleteEventFromDay(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const target = (this.data.dayPopupEvents || []).find((item) => item.id === id)
    if (!target || !target.isOwner) return

    wx.showModal({
      title: '删除日程',
      content: '确认删除这个日程吗？',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteEvent(id)
          await this.refreshCalendarData()
          this.openDayPopup(this.data.dayPopupDate || this.data.selectedDate)
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  openEventPopup(mode = 'add', eventItem = null, defaultDate = '') {
    const today = this.data.todayDateString || getCurrentDateString()
    const initDate = defaultDate || this.data.selectedDate || today
    if (this.eventPopupTimer) clearTimeout(this.eventPopupTimer)

    this.setData({
      showEventPopup: true,
      eventPopupClosing: false,
      eventPopupMode: mode,
      eventPopupTitle: mode === 'edit' ? '编辑日程' : '新增日程',
      eventFormId: eventItem ? eventItem.id : '',
      eventFormTitle: eventItem ? eventItem.title : '',
      eventFormStartDate: eventItem ? eventItem.startDate : initDate,
      eventFormEndDate: eventItem ? eventItem.endDate : initDate,
      eventFormColor: eventItem ? eventItem.color : COLOR_PALETTE[0],
    })
  },

  onCloseEventPopup() {
    if (!this.data.showEventPopup) return
    if (this.eventPopupTimer) clearTimeout(this.eventPopupTimer)
    this.setData({
      eventPopupClosing: true,
      isSavingEvent: false,
    })
    this.eventPopupTimer = setTimeout(() => {
      this.setData({
        showEventPopup: false,
        eventPopupClosing: false,
        isSavingEvent: false,
      })
    }, POPUP_ANIMATION_MS)
  },

  onEventTitleInput(e) {
    this.setData({ eventFormTitle: e.detail.value })
  },

  onPickEventStartDate(e) {
    const startDate = e.detail.value
    let endDate = this.data.eventFormEndDate
    if (!endDate || endDate < startDate) {
      endDate = startDate
    }
    this.setData({
      eventFormStartDate: startDate,
      eventFormEndDate: endDate,
    })
  },

  onPickEventEndDate(e) {
    const endDate = e.detail.value
    let startDate = this.data.eventFormStartDate
    if (!startDate || endDate < startDate) {
      startDate = endDate
    }
    this.setData({
      eventFormStartDate: startDate,
      eventFormEndDate: endDate,
    })
  },

  onPickEventColor(e) {
    const color = e.currentTarget.dataset.color
    if (!color) return
    vibrateLight()
    this.setData({ eventFormColor: color })
  },

  async assertClientDailyLimit(startDate, endDate, editingId = '') {
    const list = await listEventsByRange(startDate, endDate)
    const days = dateRangeToList(startDate, endDate, 380)

    for (const day of days) {
      let count = 0
      for (const item of list) {
        if (editingId && item.id === editingId) continue
        if (eventCoversDate(item, day)) {
          count += 1
        }
        if (count >= 5) {
          throw new Error(`${day} 当天最多只能添加 5 个日程`)
        }
      }
    }
  },

  async onSaveEvent() {
    if (this.data.isSavingEvent) return

    const id = String(this.data.eventFormId || '').trim()
    const title = String(this.data.eventFormTitle || '').trim()
    const startDate = String(this.data.eventFormStartDate || '').trim()
    const endDate = String(this.data.eventFormEndDate || '').trim()
    const color = String(this.data.eventFormColor || '').trim()

    if (!title) {
      wx.showToast({ title: '请输入日程', icon: 'none' })
      return
    }
    if (!startDate || !endDate) {
      wx.showToast({ title: '请选择日期区间', icon: 'none' })
      return
    }
    if (startDate > endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
      return
    }
    if (!color) {
      wx.showToast({ title: '请选择日程颜色', icon: 'none' })
      return
    }

    this.setData({ isSavingEvent: true })
    try {
      await this.assertClientDailyLimit(startDate, endDate, id)
      await upsertEvent({
        id,
        title,
        startDate,
        endDate,
        color,
      })
      await this.refreshCalendarData()
      this.rebuildMonthSections(this.data.selectedDate)
      this.onCloseEventPopup()
      wx.showToast({ title: id ? '已保存' : '已添加', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    } finally {
      this.setData({ isSavingEvent: false })
    }
  },

  onToggleCalendarDropdown() {
    vibrateLight()
    this.setData({ showCalendarDropdown: !this.data.showCalendarDropdown })
  },

  onCloseCalendarDropdown() {
    if (!this.data.showCalendarDropdown) return
    this.setData({ showCalendarDropdown: false })
  },

  async onToggleMyCalendarVisibility() {
    const nextVisible = !this.data.myCalendarVisible
    this.setData({ myCalendarVisible: nextVisible })
    this.persistCalendarVisibility({
      myCalendarVisible: nextVisible,
      shareRecords: this.data.shareRecords || [],
    })
    await this.refreshCalendarData()
  },

  async onToggleShareVisibility(e) {
    const token = e.currentTarget.dataset.token
    if (!token) return
    const next = (this.data.shareRecords || []).map((item) => {
      if (item.token !== token) return item
      return {
        ...item,
        visible: !item.visible,
      }
    })
    this.setData({ shareRecords: next })
    this.persistCalendarVisibility({
      myCalendarVisible: this.data.myCalendarVisible,
      shareRecords: next,
    })
    await this.refreshCalendarData()
  },

  async onDeleteShareRecord(e) {
    const token = e.currentTarget.dataset.token
    if (!token) return

    wx.showModal({
      title: '删除共享日历',
      content: '删除后将不再显示该共享日历，确认删除吗？',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await removeViewedShare(token)
        } catch (err) {
          // ignore
        }

        const next = (this.data.shareRecords || []).filter((item) => item.token !== token)
        this.setData({ shareRecords: next })
        this.persistCalendarVisibility({
          myCalendarVisible: this.data.myCalendarVisible,
          shareRecords: next,
        })
        await this.refreshCalendarData()
      },
    })
  },

  onOpenShareNamePopup() {
    this.setData({
      showShareNamePopup: true,
      shareNameInput: this.data.thisCalendarName || '',
    })
  },

  onShareNameInput(e) {
    this.setData({ shareNameInput: e.detail.value })
  },

  onCancelShareNamePopup() {
    this.setData({ showShareNamePopup: false })
  },

  onConfirmShareNamePopup() {
    const name = String(this.data.shareNameInput || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写日历名称', icon: 'none' })
      return
    }
    writeShareNameConfig(name)
    this.setData({
      thisCalendarName: name,
      showShareNamePopup: false,
    })
  },

  buildSharePath(token, calendarName) {
    if (!token) return '/pages/qing-calendar/qing-calendar'
    const q = [`shareToken=${encodeURIComponent(token)}`]
    if (calendarName) {
      q.push(`calendarName=${encodeURIComponent(calendarName)}`)
    }
    return `/pages/qing-calendar/qing-calendar?${q.join('&')}`
  },

  onShareAppMessage() {
    const configuredName = String(this.data.thisCalendarName || '').trim()
    if (!configuredName) {
      wx.showToast({ title: '请先填写日历名称', icon: 'none' })
      this.onOpenShareNamePopup()
      return {
        title: '青青日历',
        path: '/pages/qing-calendar/qing-calendar',
      }
    }

    const promise = (async () => {
      try {
        const data = await createShareToken(configuredName)
        const token = data && data.token ? data.token : ''
        const calendarName = data && data.calendarName ? data.calendarName : configuredName
        if (token) {
          this.setData({ thisShareToken: token })
        }
        return {
          title: calendarName || '青青日历',
          path: this.buildSharePath(token, calendarName),
        }
      } catch (err) {
        wx.showToast({ title: err.message || '分享生成失败', icon: 'none' })
        return {
          title: configuredName,
          path: '/pages/qing-calendar/qing-calendar',
        }
      }
    })()

    return {
      title: configuredName,
      path: '/pages/qing-calendar/qing-calendar',
      promise,
    }
  },

  noop() {},
})
