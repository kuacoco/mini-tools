const {
  getCurrentDateString,
  getCurrentMonthKey,
  listEventsByRange,
  upsertEvent,
  deleteEvent,
  createShareToken,
  getMyShareInfo,
  listEventsForShareByRange,
  listViewedShares,
  upsertViewedShare,
  setViewedShareVisibility,
  removeViewedShare,
} = require('../../utils/qing-calendar-storage')

const INITIAL_PREV_MONTHS = 3
const INITIAL_NEXT_MONTHS = 5
const LOAD_CHUNK_MONTHS = 4
const POPUP_ANIMATION_MS = 220
const EDGE_LOAD_THROTTLE_MS = 320
const DAY_EVENT_SWIPE_ACTION_TOTAL_WIDTH_RPX = 160
const DAY_EVENT_SWIPE_OPEN_THRESHOLD_RPX = 50
const DEFAULT_SHARE_NAME = 'TA的日历'
const DEFAULT_SHARE_ICON_TEXT = '享'
const MAX_UPLOAD_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_COMPRESSED_IMAGE_SIZE = 500 * 1024

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

function isCloudFileId(value) {
  return String(value || '').startsWith('cloud://')
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''))
}

function rpxToPx(rpx) {
  let windowWidth = 375
  if (typeof wx !== 'undefined') {
    if (wx.getWindowInfo) {
      windowWidth = Number(wx.getWindowInfo().windowWidth || 375)
    } else if (wx.getSystemInfoSync) {
      windowWidth = Number(wx.getSystemInfoSync().windowWidth || 375)
    }
  }
  return (Number(rpx) * windowWidth) / 750
}

function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: (res) => resolve(Number(res.size || 0)),
      fail: (err) => reject(err),
    })
  })
}

function downloadTempFile(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        const tempFilePath = res && res.tempFilePath ? String(res.tempFilePath) : ''
        if (!tempFilePath) {
          reject(new Error('下载头像失败'))
          return
        }
        resolve(tempFilePath)
      },
      fail: (err) => reject(err),
    })
  })
}

function compressImage(filePath, quality) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (res) => {
        const tempFilePath = res && res.tempFilePath ? String(res.tempFilePath) : ''
        resolve(tempFilePath || filePath)
      },
      fail: (err) => reject(err),
    })
  })
}

async function compressImageToLimit(filePath) {
  let currentPath = filePath
  const qualityQueue = [80, 70, 60, 50, 40]
  for (const quality of qualityQueue) {
    currentPath = await compressImage(currentPath, quality)
    const size = await getFileSize(currentPath)
    if (size <= MAX_COMPRESSED_IMAGE_SIZE) {
      return currentPath
    }
  }
  throw new Error('头像压缩后仍超过 500KB，请更换图片')
}

function uploadShareIconToCloud(filePath) {
  if (!wx.cloud || !wx.cloud.uploadFile) {
    throw new Error('云开发未初始化')
  }
  const extMatch = String(filePath || '').match(/\.[a-zA-Z0-9]+$/)
  const ext = extMatch ? extMatch[0] : '.jpg'
  const cloudPath = `calendar-share-icons/${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
  })
}

async function processShareIconForSave(iconValue) {
  const raw = String(iconValue || '').trim()
  if (!raw) return ''
  if (isCloudFileId(raw)) return raw

  let localPath = raw
  if (isHttpUrl(localPath)) {
    localPath = await downloadTempFile(localPath)
  }

  const rawSize = await getFileSize(localPath)
  if (rawSize > MAX_UPLOAD_IMAGE_SIZE) {
    throw new Error('头像原图不能超过 10MB')
  }

  const compressedPath = await compressImageToLimit(localPath)
  const uploadRes = await uploadShareIconToCloud(compressedPath)
  const fileID = uploadRes && uploadRes.fileID ? String(uploadRes.fileID) : ''
  if (!fileID) {
    throw new Error('头像上传失败，请重试')
  }
  return fileID
}

function normalizeIncomingShareRecords(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((row) => {
      const token = row && row.token ? String(row.token).trim() : ''
      if (!token) return null
      const calendarName = row && row.calendarName
        ? String(row.calendarName).trim()
        : DEFAULT_SHARE_NAME
      const calendarIcon = row && row.calendarIcon ? String(row.calendarIcon).trim() : ''
      const visible = row && typeof row.visible === 'boolean' ? row.visible : true
      return {
        token,
        calendarName,
        displayTitle: calendarName || DEFAULT_SHARE_NAME,
        calendarIcon,
        iconText: DEFAULT_SHARE_ICON_TEXT,
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

    showShareInfoPopup: false,
    shareInfoNameInput: '',
    shareInfoIcon: '',
    shareInfoIconText: DEFAULT_SHARE_ICON_TEXT,
    thisShareCalendarName: '',
    thisShareCalendarIcon: '',
    thisShareToken: '',
  },

  async onLoad(options) {
    const today = getCurrentDateString()
    const monthKey = getCurrentMonthKey()
    const monthKeys = buildMonthWindow(monthKey, INITIAL_PREV_MONTHS, INITIAL_NEXT_MONTHS)

    const incomingToken = options && options.shareToken ? String(options.shareToken).trim() : ''

    this._myEvents = []
    this._shareEventsByToken = {}
    this._dateEventMap = {}
    this._isRangeLoading = false
    this._isPrepending = false
    this._isAppending = false
    this._topLoadTs = 0
    this._bottomLoadTs = 0
    this._incomingToken = incomingToken

    this.setData({
      todayDateString: today,
      selectedDate: today,
      selectedDateDisplay: formatDateDisplay(today),
      loadedMonthKeys: monthKeys,
      myCalendarVisible: true,
    })

    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage'],
      })
    }

    if (!incomingToken) {
      await this.syncMyShareInfoFromCloud({ openWhenIncomplete: true })
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

  async bootstrapShareRecords() {
    let records = []
    try {
      records = await listViewedShares()
    } catch (err) {
      records = []
    }

    if (this._incomingToken) {
      try {
        await upsertViewedShare(this._incomingToken)
      } catch (err) {
        wx.showToast({ title: err.message || '共享日历无效', icon: 'none' })
      }
      try {
        records = await listViewedShares()
      } catch (err) {
        // ignore
      }
    }

    const normalized = normalizeIncomingShareRecords(records)

    this.setData({ shareRecords: normalized })
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
          calendarIcon: '',
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
          calendarIcon: record.calendarIcon || '',
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
          calendarIcon: item.calendarIcon,
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
            calendarName: String(data.calendarName || '').trim() || DEFAULT_SHARE_NAME,
            calendarIcon: String(data.calendarIcon || '').trim(),
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
    const remoteIconMap = {}

    shareResults.forEach((res) => {
      if (res.ok) {
        shareEventsByToken[res.token] = res.list || []
        if (res.calendarName) {
          remoteNameMap[res.token] = res.calendarName
        }
        remoteIconMap[res.token] = res.calendarIcon || ''
      } else {
        invalidTokens.push(res.token)
      }
    })

    let shareRecords = this.data.shareRecords || []

    if (Object.keys(remoteNameMap).length || Object.keys(remoteIconMap).length) {
      shareRecords = shareRecords.map((item) => {
        const nextName = remoteNameMap[item.token]
        const nextIcon = remoteIconMap[item.token]
        const sameName = !nextName || nextName === item.calendarName
        const sameIcon = typeof nextIcon === 'undefined' || nextIcon === item.calendarIcon
        if (sameName && sameIcon) return item
        return {
          ...item,
          calendarName: nextName || item.calendarName || DEFAULT_SHARE_NAME,
          displayTitle: nextName || item.displayTitle || DEFAULT_SHARE_NAME,
          calendarIcon: typeof nextIcon === 'undefined' ? (item.calendarIcon || '') : nextIcon,
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
    const targetId = `month-${monthKey}`
    this.setData({ scrollIntoViewId: '', scrollWithAnimation: !!animated }, () => {
      this.setData({ scrollIntoViewId: targetId })
    })
  },

  onTapDay(e) {
    const date = e.currentTarget.dataset.date
    if (!date) return
    vibrateLight()
    this.rebuildMonthSections(date)
    this.openDayPopup(date)
  },

  openDayPopup(date) {
    const list = (this._dateEventMap[date] || []).map((item, index) => ({
      ...item,
      rowKey: `${String(item.token || 'self')}::${String(item.id || '')}::${index}`,
      rangeText: formatEventRange(item.startDate, item.endDate),
      canEdit: !!item.isOwner,
      shareCalendarName: item.isOwner
        ? ''
        : (String(item.calendarName || '').trim() || DEFAULT_SHARE_NAME),
      shareCalendarIcon: item.isOwner ? '' : String(item.calendarIcon || '').trim(),
      shareCalendarIconText: DEFAULT_SHARE_ICON_TEXT,
      offsetX: 0,
    }))

    if (this.dayPopupTimer) clearTimeout(this.dayPopupTimer)
    this.dayEventSwipeState = null
    this.setData({
      showDayPopup: true,
      dayPopupClosing: false,
      dayPopupDate: date,
      dayPopupDateLabel: formatDayPopupTitle(date),
      dayPopupEvents: list,
    })
  },

  onCloseDayPopup() {
    if (!this.data.showDayPopup) return
    if (this.dayPopupTimer) clearTimeout(this.dayPopupTimer)
    this.setData({ dayPopupClosing: true })
    this.dayPopupTimer = setTimeout(() => {
      this.dayEventSwipeState = null
      this.setData({
        showDayPopup: false,
        dayPopupClosing: false,
        dayPopupEvents: [],
      })
    }, POPUP_ANIMATION_MS)
  },

  onOpenAddPopup() {
    this.openEventPopup('add', null, this.data.selectedDate || this.data.todayDateString)
  },

  onOpenAddFromDay() {
    const date = this.data.dayPopupDate || this.data.selectedDate || this.data.todayDateString
    this.openEventPopup('add', null, date)
  },

  onEditEventFromDay(e) {
    const rowKey = String(e.currentTarget.dataset.rowKey || '')
    if (!rowKey) return
    const target = (this.data.dayPopupEvents || []).find((item) => item.rowKey === rowKey)
    if (!target || !target.isOwner) return
    this.resetDayEventOffsets()
    this.openEventPopup('edit', target, target.startDate)
  },

  onDeleteEventFromDay(e) {
    const rowKey = String(e.currentTarget.dataset.rowKey || '')
    if (!rowKey) return
    const target = (this.data.dayPopupEvents || []).find((item) => item.rowKey === rowKey)
    if (!target || !target.isOwner) return
    this.resetDayEventOffsets()

    wx.showModal({
      title: '删除日程',
      content: '确认删除这个日程吗？',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteEvent(target.id)
          await this.refreshCalendarData()
          this.openDayPopup(this.data.dayPopupDate || this.data.selectedDate)
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  getDayEventOffset(rowKey) {
    const item = (this.data.dayPopupEvents || []).find((eventItem) => eventItem.rowKey === rowKey)
    return item ? Number(item.offsetX || 0) : 0
  },

  updateDayEventOffset(rowKey, offsetX) {
    const nextList = (this.data.dayPopupEvents || []).map((item) => {
      if (item.rowKey === rowKey) return { ...item, offsetX }
      if (item.offsetX !== 0) return { ...item, offsetX: 0 }
      return item
    })
    this.setData({ dayPopupEvents: nextList })
  },

  resetDayEventOffsets() {
    const list = this.data.dayPopupEvents || []
    if (!list.some((item) => Number(item.offsetX || 0) !== 0)) return
    const nextList = list.map((item) => ({ ...item, offsetX: 0 }))
    this.setData({ dayPopupEvents: nextList })
  },

  getDayEventSwipeMetrics() {
    return {
      actionTotalWidthPx: rpxToPx(DAY_EVENT_SWIPE_ACTION_TOTAL_WIDTH_RPX),
      openThresholdPx: rpxToPx(DAY_EVENT_SWIPE_OPEN_THRESHOLD_RPX),
    }
  },

  onDayEventTouchStart(e) {
    const rowKey = String(e.currentTarget.dataset.rowKey || '')
    if (!rowKey) return
    const target = (this.data.dayPopupEvents || []).find((item) => item.rowKey === rowKey)
    if (!target || !target.canEdit) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.dayEventSwipeState = {
      rowKey,
      startX: touch.pageX,
      startY: touch.pageY,
      initialOffset: this.getDayEventOffset(rowKey),
      moving: false,
    }
  },

  onDayEventTouchMove(e) {
    if (!this.dayEventSwipeState) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const dx = touch.pageX - this.dayEventSwipeState.startX
    const dy = touch.pageY - this.dayEventSwipeState.startY
    if (!this.dayEventSwipeState.moving) {
      if (Math.abs(dx) <= 4 || Math.abs(dx) < Math.abs(dy)) return
      this.dayEventSwipeState.moving = true
    }
    const { actionTotalWidthPx } = this.getDayEventSwipeMetrics()
    let next = this.dayEventSwipeState.initialOffset + dx
    if (next > 0) next = 0
    if (next < -actionTotalWidthPx) next = -actionTotalWidthPx
    this.updateDayEventOffset(this.dayEventSwipeState.rowKey, next)
  },

  onDayEventTouchEnd() {
    if (!this.dayEventSwipeState) return
    const rowKey = this.dayEventSwipeState.rowKey
    const offset = this.getDayEventOffset(rowKey)
    const { actionTotalWidthPx, openThresholdPx } = this.getDayEventSwipeMetrics()
    let finalOffset = 0
    if (offset < -openThresholdPx) finalOffset = -actionTotalWidthPx
    this.updateDayEventOffset(rowKey, finalOffset)
    this.dayEventSwipeState = null
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
    await this.refreshCalendarData()
  },

  async onToggleShareVisibility(e) {
    const token = e.currentTarget.dataset.token
    if (!token) return
    const current = this.data.shareRecords || []
    const next = current.map((item) => {
      if (item.token !== token) return item
      return {
        ...item,
        visible: !item.visible,
      }
    })
    const toggled = next.find((item) => item.token === token)
    if (!toggled) return
    this.setData({ shareRecords: next })
    try {
      await setViewedShareVisibility(token, toggled.visible)
      await this.refreshCalendarData()
    } catch (err) {
      this.setData({ shareRecords: current })
      wx.showToast({ title: err.message || '更新显示状态失败', icon: 'none' })
    }
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
        await this.refreshCalendarData()
      },
    })
  },

  async syncMyShareInfoFromCloud(options = {}) {
    const input = options && typeof options === 'object' ? options : {}
    try {
      const remote = await getMyShareInfo()
      const remoteToken = remote && remote.token ? String(remote.token).trim() : ''
      const remoteName = remote && remote.calendarName ? String(remote.calendarName).trim() : ''
      const remoteIcon = remote && remote.calendarIcon ? String(remote.calendarIcon).trim() : ''
      const shouldOpen = !!input.openWhenIncomplete && (!remoteName || !remoteIcon)
      this.setData({
        thisShareToken: remoteToken || this.data.thisShareToken || '',
        thisShareCalendarName: remoteName,
        thisShareCalendarIcon: remoteIcon,
        shareInfoNameInput: remoteName,
        shareInfoIcon: remoteIcon,
        ...(shouldOpen ? { showShareInfoPopup: true } : {}),
      })
    } catch (err) {
      if (input.showErrorToast) {
        wx.showToast({ title: err.message || '读取分享信息失败', icon: 'none' })
      }
    }
  },

  async onOpenShareInfoPopup() {
    this.setData({
      showShareInfoPopup: true,
      shareInfoNameInput: this.data.thisShareCalendarName || '',
      shareInfoIcon: this.data.thisShareCalendarIcon || '',
    })
    await this.syncMyShareInfoFromCloud({ showErrorToast: true })
  },

  onShareInfoNameInput(e) {
    this.setData({ shareInfoNameInput: e.detail.value })
  },

  onCancelShareInfoPopup() {
    this.setData({ showShareInfoPopup: false })
  },

  onChooseAvatarForShare(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl ? String(e.detail.avatarUrl).trim() : ''
    if (!avatarUrl) {
      wx.showToast({ title: '获取头像失败，请重试', icon: 'none' })
      return
    }
    this.setData({
      shareInfoIcon: avatarUrl,
    })
  },

  async onConfirmShareInfoPopup() {
    if (this._isSavingShareInfo) return
    const calendarName = String(this.data.shareInfoNameInput || '').trim()
    const calendarIconRaw = String(this.data.shareInfoIcon || '').trim()
    this._isSavingShareInfo = true
    try {
      const calendarIcon = await processShareIconForSave(calendarIconRaw)
      const data = await createShareToken(calendarName, calendarIcon)
      const token = data && data.token ? String(data.token) : ''
      this.setData({
        thisShareToken: token || this.data.thisShareToken || '',
        thisShareCalendarName: calendarName,
        thisShareCalendarIcon: calendarIcon,
        shareInfoIcon: calendarIcon,
        showShareInfoPopup: false,
      })
      wx.showToast({ title: '分享信息已保存', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存分享信息失败', icon: 'none' })
    } finally {
      this._isSavingShareInfo = false
    }
  },

  buildSharePath(token) {
    if (!token) return '/pages/qing-calendar/qing-calendar'
    return `/pages/qing-calendar/qing-calendar?shareToken=${encodeURIComponent(token)}`
  },

  onShareAppMessage() {
    const configuredName = String(this.data.thisShareCalendarName || '').trim()

    const promise = (async () => {
      try {
        const data = await createShareToken()
        const token = data && data.token ? data.token : ''
        const calendarName = data && data.calendarName
          ? String(data.calendarName).trim()
          : (configuredName || DEFAULT_SHARE_NAME)
        if (token) {
          this.setData({
            thisShareToken: token,
          })
        }
        return {
          title: calendarName || DEFAULT_SHARE_NAME,
          path: this.buildSharePath(token),
        }
      } catch (err) {
        wx.showToast({ title: err.message || '分享生成失败', icon: 'none' })
        return {
          title: configuredName || DEFAULT_SHARE_NAME,
          path: '/pages/qing-calendar/qing-calendar',
        }
      }
    })()

    return {
      title: configuredName || DEFAULT_SHARE_NAME,
      path: '/pages/qing-calendar/qing-calendar',
      promise,
    }
  },

  noop() { },
})
