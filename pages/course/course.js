const {
  getCurrentMonthKey,
  getCurrentDateString,
  listCourses,
  addCourse,
  updateCourse,
  deleteCourse,
  checkin,
  removeCheckin,
  getMonthCheckins,
  listCoursesForShare,
  getMonthCheckinsForShare,
  createShareToken,
  listViewedShares,
  upsertViewedShare,
  removeViewedShare,
} = require('../../utils/course-storage')
const { COLOR_PALETTE } = require('../../utils/course-palette')
const {
  WEEKDAYS,
  getMonthLabel,
  getOffsetMonthKey,
  generateMonthPickerItems,
  findMonthPickerIndex,
  buildCourseMonthCalendar,
} = require('../../utils/course-calendar')

const SWIPE_EDIT_WIDTH = 82
const SWIPE_DELETE_WIDTH = 82
const SWIPE_OPEN_THRESHOLD = 38
const POPUP_ANIMATION_MS = 240
const MAX_RECENT_SHARE_RECORDS = 8
/** 仅本地：是否已设置过「分享展示名称」（含留空确认） */
const SHARE_DISPLAY_STORAGE_KEY = 'course_share_display_v1'

function readShareDisplayFromStorage() {
  try {
    const raw = wx.getStorageSync(SHARE_DISPLAY_STORAGE_KEY)
    if (raw && typeof raw === 'object' && raw.configured === true) {
      return { configured: true, nick: String(raw.nick || '').trim() }
    }
  } catch (err) {
    // ignore
  }
  return { configured: false, nick: '' }
}

function writeShareDisplayToStorage(nick) {
  try {
    wx.setStorageSync(SHARE_DISPLAY_STORAGE_KEY, {
      configured: true,
      nick: String(nick || '').trim(),
    })
  } catch (err) {
    // ignore
  }
}

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatViewerTitle(nickName) {
  const clean = String(nickName || '').trim()
  if (!clean) return 'TA的消课记录'
  return `${clean}的消课记录`
}

function normalizeRecentShareRecords(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => {
      const token = item && item.token ? String(item.token).trim() : ''
      if (!token) return null
      const nickName = item && item.nickName ? String(item.nickName).trim() : ''
      const updatedAt = Number(item && item.updatedAt) || Date.now()
      const short = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-2)}` : token
      const displayTitle = nickName ? formatViewerTitle(nickName) : `访客记录 ${short} 的消课记录`
      return { token, nickName, displayTitle, updatedAt }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, MAX_RECENT_SHARE_RECORDS)
}

Page({
  data: {
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
    /** 月份切换时递增，用于强制重建 swiper，避免出现「滑到新月份后又滑回中间」的二次动画 */
    calendarSwiperKey: 0,
    courseList: [],
    showAddPopup: false,
    addPopupClosing: false,
    addPopupMode: 'add',
    addPopupTitle: '新增课程',
    addCourseName: '',
    addTotalClasses: 1,
    editingCourseId: '',
    isViewerMode: false,
    shareToken: '',
    thisShareToken: '',
    thisShareNickName: '',
    navTitle: '消课记录',
    showRecordDropdown: false,
    recentShareRecords: [],
    /** 进入页时未配置过分享展示名则弹窗；已写入 SHARE_DISPLAY_STORAGE_KEY 则不再弹 */
    showShareNickPopup: false,
    shareNickInputValue: '',
  },

  async onLoad(options) {
    const monthKey = getCurrentMonthKey()
    const today = getCurrentDateString()
    const todayDisplay = formatDateDisplay(today)
    const monthPickerItems = generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)

    const shareToken = (options && options.shareToken) ? String(options.shareToken).trim() : ''
    const shareNickName = (options && options.nickName) ? decodeURIComponent(String(options.nickName)).trim() : ''
    const isViewerMode = !!shareToken

    this.setData({
      selectedDate: today,
      selectedDateDisplay: todayDisplay,
      todayDateString: today,
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
      isViewerMode,
      shareToken,
      navTitle: isViewerMode ? formatViewerTitle(shareNickName) : '消课记录',
    })

    const records = await this.bootstrapRecentShareRecords(shareToken, shareNickName)
    if (isViewerMode && !shareNickName) {
      const hit = (records || []).find(item => item.token === shareToken)
      if (hit && hit.nickName) {
        this.setData({ navTitle: formatViewerTitle(hit.nickName) })
      }
    }

    await this.loadMonthData(monthKey)

    if (!isViewerMode) {
      const saved = readShareDisplayFromStorage()
      if (saved.configured) {
        this.setData({ thisShareNickName: saved.nick })
      } else {
        this.setData({
          showShareNickPopup: true,
          shareNickInputValue: '',
        })
      }
    }
  },

  onUnload() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
  },

  async onShow() {
    this.setData({ todayDateString: getCurrentDateString() })
    await this.loadMonthData(this.data.currentMonthKey)
  },

  async loadMonthData(monthKey) {
    const { selectedDate, isViewerMode, shareToken } = this.data
    const prevKey = getOffsetMonthKey(monthKey, -1)
    const nextKey = getOffsetMonthKey(monthKey, 1)

    let mapPrev = {}
    let mapCurr = {}
    let mapNext = {}
    let list = []

    if (isViewerMode && shareToken) {
      try {
        ;[mapPrev, mapCurr, mapNext] = await Promise.all([
          getMonthCheckinsForShare(shareToken, prevKey),
          getMonthCheckinsForShare(shareToken, monthKey),
          getMonthCheckinsForShare(shareToken, nextKey),
        ])
      } catch (err) {
        wx.showToast({ title: '分享链接无效或已失效', icon: 'none' })
        await this.removeRecentShareRecord(shareToken)
        this.setData({
          isViewerMode: false,
          shareToken: '',
          navTitle: '消课记录',
        })
        await this.loadMonthData(monthKey)
        return
      }
      try {
        list = await listCoursesForShare(shareToken)
      } catch (err) {
        wx.showToast({ title: '分享链接无效或已失效', icon: 'none' })
        await this.removeRecentShareRecord(shareToken)
        this.setData({
          isViewerMode: false,
          shareToken: '',
          navTitle: '消课记录',
        })
        await this.loadMonthData(monthKey)
        return
      }
    } else {
      ;[mapPrev, mapCurr, mapNext] = await Promise.all([
        getMonthCheckins(prevKey).catch(() => ({})),
        getMonthCheckins(monthKey).catch(() => ({})),
        getMonthCheckins(nextKey).catch(() => ({})),
      ])
      try {
        list = await listCourses()
      } catch (err) {
        // ignore
      }
    }

    list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))

    const calendarDaysSwipe = [
      buildCourseMonthCalendar(prevKey, mapPrev, list, selectedDate),
      buildCourseMonthCalendar(monthKey, mapCurr, list, selectedDate),
      buildCourseMonthCalendar(nextKey, mapNext, list, selectedDate),
    ]

    const decorated = list.map((item, index) => {
      const total = Number(item.totalClasses || 0)
      const used = Number(item.usedClasses || 0)
      const displayUsed = used
      const rawPercent = total <= 0 ? 0 : (displayUsed / total) * 100
      const percent = Math.max(0, Math.min(100, rawPercent))
      const remain = total - displayUsed
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length]

      const monthChecks = mapCurr[item.id] || []
      const checkedToday = monthChecks.some(c => c.checkinDate === selectedDate)

      return {
        ...item,
        usedClasses: displayUsed,
        percentText: `${Math.round(rawPercent)}%`,
        barWidth: `${percent}%`,
        barColor: color.main,
        trackColor: color.light,
        remainClasses: Math.max(0, remain),
        isEmpty: remain <= 0,
        offsetX: 0,
        firstChar: (item.courseName || '').charAt(0),
        avatarColor: color.main,
        checkedToday,
      }
    })

    const prevCenter = this._lastCalendarCenterMonthKey
    const monthChanged = prevCenter !== monthKey
    this._lastCalendarCenterMonthKey = monthKey

    const patch = {
      calendarDaysSwipe,
      swiperMonthIndex: 1,
      courseList: decorated,
    }
    if (monthChanged) {
      patch.calendarSwiperKey = (this.data.calendarSwiperKey || 0) + 1
    }
    this.setData(patch)
  },

  // 上个月
  onPrevMonth() {
    const newKey = getOffsetMonthKey(this.data.currentMonthKey, -1)
    this.switchMonth(newKey)
  },

  // 下个月
  onNextMonth() {
    const newKey = getOffsetMonthKey(this.data.currentMonthKey, 1)
    this.switchMonth(newKey)
  },

  switchMonth(monthKey) {
    vibrateLight()
    this.setData({
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
    })
    this.loadMonthData(monthKey)
  },

  // picker选择月份
  onSelectMonth(e) {
    const { value } = e.detail
    const item = this.data.monthPickerItems[value]
    if (!item) return
    vibrateLight()
    this.setData({
      currentPickerIndex: value,
      currentMonthKey: item.monthKey,
      currentMonthLabel: getMonthLabel(item.monthKey),
    })
    this.loadMonthData(item.monthKey)
  },

  async bootstrapRecentShareRecords(initialShareToken = '', initialNickName = '') {
    let records = []
    try {
      records = normalizeRecentShareRecords(await listViewedShares())
    } catch (err) {
      records = []
    }
    if (initialShareToken) {
      records = await this.upsertRecentShareRecord(records, initialShareToken, initialNickName)
    }
    this.setData({ recentShareRecords: records })
    return records
  },

  async upsertRecentShareRecord(records, token, nickName = '') {
    const clean = String(token || '').trim()
    if (!clean) return normalizeRecentShareRecords(records)
    const now = Date.now()
    const next = normalizeRecentShareRecords(records).filter(item => item.token !== clean)
    next.unshift({ token: clean, nickName: String(nickName || '').trim(), updatedAt: now })
    const normalized = next.slice(0, MAX_RECENT_SHARE_RECORDS)
    try {
      await upsertViewedShare(clean, nickName)
    } catch (err) {
      // ignore
    }
    return normalizeRecentShareRecords(normalized)
  },

  async persistRecentShareRecords(records) {
    const normalized = normalizeRecentShareRecords(records)
    this.setData({ recentShareRecords: normalized })
  },

  async removeRecentShareRecord(token) {
    const clean = String(token || '').trim()
    if (!clean) return
    const next = (this.data.recentShareRecords || []).filter(item => item.token !== clean)
    await this.persistRecentShareRecords(next)
    try {
      await removeViewedShare(clean)
    } catch (err) {
      // ignore
    }
  },

  onToggleRecordDropdown() {
    vibrateLight()
    this.setData({ showRecordDropdown: !this.data.showRecordDropdown })
  },

  onCloseRecordDropdown() {
    if (!this.data.showRecordDropdown) return
    this.setData({ showRecordDropdown: false })
  },

  async onSelectRecordOption(e) {
    const { type, token } = e.currentTarget.dataset
    if (type === 'self') {
      if (!this.data.isViewerMode) {
        this.setData({ showRecordDropdown: false })
        return
      }
      this.setData({
        isViewerMode: false,
        shareToken: '',
        navTitle: '消课记录',
        showRecordDropdown: false,
      })
      await this.loadMonthData(this.data.currentMonthKey)
      return
    }

    const clean = String(token || '').trim()
    if (!clean) return
    if (this.data.isViewerMode && this.data.shareToken === clean) {
      this.setData({ showRecordDropdown: false })
      return
    }

    const target = (this.data.recentShareRecords || []).find(item => item.token === clean) || null
    const nickName = target && target.nickName ? target.nickName : ''
    const nextRecords = await this.upsertRecentShareRecord(this.data.recentShareRecords || [], clean, nickName)
    await this.persistRecentShareRecords(nextRecords)
    this.setData({
      isViewerMode: true,
      shareToken: clean,
      navTitle: formatViewerTitle(nickName),
      showRecordDropdown: false,
    })
    await this.loadMonthData(this.data.currentMonthKey)
  },

  async onDeleteRecordOption(e) {
    const { token } = e.currentTarget.dataset
    const clean = String(token || '').trim()
    if (!clean) return
    await this.removeRecentShareRecord(clean)
    if (this.data.isViewerMode && this.data.shareToken === clean) {
      this.setData({
        isViewerMode: false,
        shareToken: '',
        navTitle: '消课记录',
      })
      await this.loadMonthData(this.data.currentMonthKey)
    }
  },

  onSelectDate(e) {
    const date = (e.detail && e.detail.date) || (e.currentTarget.dataset && e.currentTarget.dataset.date)
    if (!date) return

    vibrateLight()
    const dateDisplay = formatDateDisplay(date)
    const monthKeyOfDate = date.slice(0, 7)
    if (monthKeyOfDate !== this.data.currentMonthKey) {
      const monthPickerItems = this.data.monthPickerItems.length
        ? this.data.monthPickerItems
        : generateMonthPickerItems(monthKeyOfDate)
      const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKeyOfDate)
      this.setData({
        selectedDate: date,
        selectedDateDisplay: dateDisplay,
        currentMonthKey: monthKeyOfDate,
        currentMonthLabel: getMonthLabel(monthKeyOfDate),
        currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
      })
      this.loadMonthData(monthKeyOfDate)
      return
    }
    this.setData({ selectedDate: date, selectedDateDisplay: dateDisplay })
    this.loadMonthData(this.data.currentMonthKey)
  },

  onOpenAddPopup() {
    // 最多添加10种课程（后端也会做兜底校验）
    if (!this.data.isViewerMode && Array.isArray(this.data.courseList) && this.data.courseList.length >= 10) {
      wx.showToast({ title: '最多只能添加10种课程', icon: 'none' })
      return
    }
    this.openAddPopup()
  },

  openAddPopup() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    this.setData({
      showAddPopup: true,
      addPopupClosing: false,
      addPopupMode: 'add',
      addPopupTitle: '新增课程',
      addCourseName: '',
      addTotalClasses: 1,
      editingCourseId: '',
    })
  },

  onClosePopup() {
    if (this.data.showAddPopup) {
      this.closeAddPopup()
    }
  },

  onCourseNameInput(e) {
    this.setData({ addCourseName: e.detail.value })
  },

  onStepperMinus() {
    const current = Number(this.data.addTotalClasses)
    if (current > 1) {
      vibrateLight()
      this.setData({ addTotalClasses: current - 1 })
    }
  },

  onStepperPlus() {
    const current = Number(this.data.addTotalClasses)
    if (current < 999) {
      vibrateLight()
      this.setData({ addTotalClasses: current + 1 })
    }
  },

  onTotalClassesInput(e) {
    let val = e.detail.value
    val = val.replace(/[^0-9]/g, '')
    if (val === '') {
      val = 1
    } else {
      const num = parseInt(val, 10)
      if (num < 1) val = '1'
      else if (num > 999) val = '999'
      else val = String(num)
    }
    this.setData({ addTotalClasses: parseInt(val, 10) })
  },

  async onSaveCourse() {
    vibrateLight()
    const mode = this.data.addPopupMode
    const name = (this.data.addCourseName || '').trim()
    const total = parseInt(this.data.addTotalClasses, 10)

    if (!name) {
      wx.showToast({ title: '请输入课程名称', icon: 'none' })
      return
    }
    if (!total || total <= 0) {
      wx.showToast({ title: '请输入有效的课时数', icon: 'none' })
      return
    }

    try {
      if (mode === 'edit' && this.data.editingCourseId) {
        await updateCourse({
          id: this.data.editingCourseId,
          courseName: name,
          totalClasses: total,
        })
      } else {
        // 添加新课程：数量上限校验
        if (Array.isArray(this.data.courseList) && this.data.courseList.length >= 10) {
          wx.showToast({ title: '最多只能添加10种课程', icon: 'none' })
          return
        }
        await addCourse({
          courseName: name,
          totalClasses: total,
        })
      }
    } catch (err) {
      wx.showToast({ title: (err && err.message) ? err.message : '保存失败，请重试', icon: 'none' })
      return
    }

    this.closeAddPopup({ resetForm: true })
    await this.loadMonthData(this.data.currentMonthKey)
    wx.showToast({
      title: mode === 'edit' ? '已更新' : '已新增',
      icon: 'success',
    })
  },

  closeAddPopup(options = {}) {
    const { resetForm = true } = options
    if (!this.data.showAddPopup) return
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    this.setData({ addPopupClosing: true })
    this.addPopupTimer = setTimeout(() => {
      const nextData = {
        showAddPopup: false,
        addPopupClosing: false,
      }
      if (resetForm) {
        nextData.addPopupMode = 'add'
        nextData.addPopupTitle = '新增课程'
        nextData.addCourseName = ''
        nextData.addTotalClasses = 1
        nextData.editingCourseId = ''
      }
      this.setData(nextData)
    }, POPUP_ANIMATION_MS)
  },

  async onToggleCheckin(e) {
    if (this.data.isViewerMode) return
    const { id } = e.currentTarget.dataset
    const { currentMonthKey, selectedDate } = this.data

    const course = this.data.courseList.find(item => item.id === id)
    if (!course) return

    vibrateLight()

    try {
      if (course.checkedToday) {
        // 取消打卡 - 查找对应的 checkin 记录
        let checkinsMap = {}
        try {
          checkinsMap = await getMonthCheckins(currentMonthKey)
        } catch (err) {
          // ignore
        }

        const monthChecks = checkinsMap[id] || []
        const checkinRecord = monthChecks.find(c => c.checkinDate === selectedDate)

        if (checkinRecord && checkinRecord.id) {
          await removeCheckin(checkinRecord.id)
          wx.showToast({ title: '已取消打卡', icon: 'success' })
        }
      } else {
        // 打卡
        await checkin({
          courseId: id,
          date: selectedDate,
          note: '',
        })
        wx.showToast({ title: '打卡成功', icon: 'success' })
      }
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
      return
    }

    await this.loadMonthData(currentMonthKey)
  },

  onCourseTap(e) {
    const { id } = e.currentTarget.dataset
    const target = this.data.courseList.find(item => item.id === id)
    if (target && target.offsetX) {
      this.resetAllOffsets()
      return
    }
    if (!id) return
    const parts = [`id=${encodeURIComponent(id)}`]
    if (this.data.isViewerMode && this.data.shareToken) {
      parts.push(`shareToken=${encodeURIComponent(this.data.shareToken)}`)
      const nick = String(this.data.navTitle || '').replace(/的消课记录$/, '')
      if (nick && nick !== 'TA') {
        parts.push(`nickName=${encodeURIComponent(nick)}`)
      }
    }
    wx.navigateTo({
      url: `/pages/course-detail/course-detail?${parts.join('&')}`,
    })
  },

  onItemTouchStart(e) {
    if (this.data.isViewerMode) return
    const { id } = e.currentTarget.dataset
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.swipeState = {
      id,
      startX: touch.pageX,
      startY: touch.pageY,
      initialOffset: this.getItemOffset(id),
      moving: false,
    }
  },

  onItemTouchMove(e) {
    if (!this.swipeState) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const dx = touch.pageX - this.swipeState.startX
    const dy = touch.pageY - this.swipeState.startY
    if (!this.swipeState.moving) {
      if (Math.abs(dx) <= 4 || Math.abs(dx) < Math.abs(dy)) return
      this.swipeState.moving = true
    }
    let next = this.swipeState.initialOffset + dx
    if (next > SWIPE_EDIT_WIDTH) next = SWIPE_EDIT_WIDTH
    if (next < -SWIPE_DELETE_WIDTH) next = -SWIPE_DELETE_WIDTH
    this.updateItemOffset(this.swipeState.id, next)
  },

  onItemTouchEnd() {
    if (!this.swipeState) return
    const id = this.swipeState.id
    const offset = this.getItemOffset(id)
    let finalOffset = 0
    if (offset > SWIPE_OPEN_THRESHOLD) finalOffset = SWIPE_EDIT_WIDTH
    if (offset < -SWIPE_OPEN_THRESHOLD) finalOffset = -SWIPE_DELETE_WIDTH
    this.updateItemOffset(id, finalOffset)
    this.swipeState = null
  },

  async onEditCourseAction(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.courseList.find(course => course.id === id) || null
    if (!item) {
      wx.showToast({ title: '课程不存在', icon: 'none' })
      return
    }
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    this.setData({
      showAddPopup: true,
      addPopupClosing: false,
      addPopupMode: 'edit',
      addPopupTitle: '编辑课程',
      addCourseName: item.courseName,
      addTotalClasses: item.totalClasses,
      editingCourseId: id,
    })
    this.resetAllOffsets()
  },

  async onDeleteCourseAction(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '删除课程',
      content: '删除后该课程的所有打卡记录也将被清除，确认删除吗？',
      confirmColor: '#d06d7f',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteCourse(id)
        } catch (err) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          return
        }
        await this.loadMonthData(this.data.currentMonthKey)
        wx.showToast({ title: '已删除', icon: 'success' })
      },
    })
  },

  getItemOffset(id) {
    const item = this.data.courseList.find(course => course.id === id)
    return item ? Number(item.offsetX || 0) : 0
  },

  updateItemOffset(id, offsetX) {
    const nextList = this.data.courseList.map(item => {
      if (item.id === id) return { ...item, offsetX }
      if (item.offsetX !== 0) return { ...item, offsetX: 0 }
      return item
    })

    this.setData({ courseList: nextList })
  },

  resetAllOffsets() {
    const hasOffset = this.data.courseList.some(item => item.offsetX !== 0)
    if (!hasOffset) return

    const nextList = this.data.courseList.map(item => ({
      ...item,
      offsetX: 0,
    }))

    this.setData({ courseList: nextList })
  },

  noop() { },

  onShareNickInput(e) {
    this.setData({ shareNickInputValue: e.detail.value })
  },

  /** 仅写入本地，供分享链接使用；取消则下次进入仍会弹窗 */
  onConfirmShareNick() {
    const v = String(this.data.shareNickInputValue || '').trim()
    writeShareDisplayToStorage(v)
    this.setData({
      thisShareNickName: v,
      showShareNickPopup: false,
    })
  },

  onCancelShareNick() {
    this.setData({ showShareNickPopup: false })
  },

  // 分享展示名已在进入页时配置；此处仅用 data 拼路径，promise 仅用于异步 createShareToken（勿再弹窗）
  onShareAppMessage() {
    if (this.data.isViewerMode) {
      return { title: '消课记录', path: '/pages/course/course' }
    }
    const that = this
    const getPath = (token, nick) => {
      if (!token) return '/pages/course/course'
      const n = String(nick || '').trim()
      const q = n
        ? `shareToken=${encodeURIComponent(token)}&nickName=${encodeURIComponent(n)}`
        : `shareToken=${encodeURIComponent(token)}`
      return `/pages/course/course?${q}`
    }
    const myNickName = String(that.data.thisShareNickName || '').trim()
    const promise = (async () => {
      let token = that.data.thisShareToken
      if (!token) {
        try {
          token = await createShareToken(myNickName)
          if (token) that.setData({ thisShareToken: token })
          return { title: '我的消课记录', path: getPath(token, myNickName) }
        } catch (err) {
          wx.showToast({ title: '分享生成失败', icon: 'none' })
          return { title: '我的消课记录', path: '/pages/course/course' }
        }
      }
      return { title: '我的消课记录', path: getPath(token, myNickName) }
    })()
    return {
      title: '我的消课记录',
      path: '/pages/course/course',
      promise,
    }
  },

  // 回今天
  goToToday() {
    const today = getCurrentDateString()
    const todayDisplay = formatDateDisplay(today)
    const monthKey = getCurrentMonthKey()
    const monthPickerItems = this.data.monthPickerItems.length
      ? this.data.monthPickerItems
      : generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)

    vibrateLight()
    this.setData({
      selectedDate: today,
      selectedDateDisplay: todayDisplay,
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
      currentPickerIndex: currentPickerIndex >= 0 ? currentPickerIndex : 0,
    })
    this.loadMonthData(monthKey)
  },
})