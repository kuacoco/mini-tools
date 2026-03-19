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
} = require('../../utils/course-storage')

// 课程头像/进度条颜色（最多支持10种课程时保持区分度）
const COLOR_PALETTE = [
  { main: '#2dd4bf', light: '#ccfbf1' }, // 青绿
  { main: '#a78bfa', light: '#ede9fe' }, // 紫
  { main: '#f472b6', light: '#fce7f3' }, // 粉
  { main: '#67e8f9', light: '#cffafe' }, // 青蓝
  { main: '#c084fc', light: '#f5f3ff' }, // 淡紫
  { main: '#fb923c', light: '#ffedd5' }, // 橙
  { main: '#34d399', light: '#dcfce7' }, // 绿
  { main: '#60a5fa', light: '#dbeafe' }, // 蓝
  { main: '#f43f5e', light: '#ffe4e6' }, // 玫红
  { main: '#f59e0b', light: '#fff7ed' }, // 金橙
]

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  return `${year}年${Number(month)}月`
}

function getOffsetMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1 + offset, 1)
  return getCurrentMonthKey(date)
}

function generateCalendarDays(year, month, checkinDates = [], selectedDate = '') {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const daysInMonth = lastDay.getDate()
  const startWeekday = firstDay.getDay()

  const today = new Date()
  const todayStr = getCurrentDateString(today)

  const checkinSet = new Set(checkinDates)
  const days = []

  // 上月天数
  const prevMonth = new Date(year, month - 1, 0)
  const prevMonthDays = prevMonth.getDate()
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i
    const dateStr = `${year}-${String(month - 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      day: d,
      date: dateStr,
      isCurrentMonth: false,
      isToday: false,
      isSelected: dateStr === selectedDate,
      hasCheckin: false,
    })
  }

  // 当月天数
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isToday = dateStr === todayStr
    days.push({
      day: d,
      date: dateStr,
      isCurrentMonth: true,
      isToday,
      isSelected: dateStr === selectedDate,
      hasCheckin: checkinSet.has(dateStr),
    })
  }

  // 下月天数，补齐到42天（6行）
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    days.push({
      day: d,
      date: dateStr,
      isCurrentMonth: false,
      isToday: false,
      isSelected: dateStr === selectedDate,
      hasCheckin: false,
    })
  }

  return days
}

const SWIPE_EDIT_WIDTH = 82
const SWIPE_DELETE_WIDTH = 82
const SWIPE_OPEN_THRESHOLD = 38
const POPUP_ANIMATION_MS = 240

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return ''
  const [, month, day] = dateStr.split('-')
  return `${Number(month)}月${Number(day)}日`
}

// 生成月份选择器数据（当前年份前后各2年）
function generateMonthPickerItems(currentMonthKey) {
  const [year, month] = currentMonthKey.split('-').map(Number)
  const items = []
  const currentYear = new Date().getFullYear()

  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${y}-${String(m).padStart(2, '0')}`
      items.push({
        monthKey,
        label: `${y}年${m}月`,
      })
    }
  }
  return items
}

function findMonthPickerIndex(items, currentMonthKey) {
  return items.findIndex(item => item.monthKey === currentMonthKey)
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
    calendarDays: [],
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
    navTitle: '消课记录',
  },

  async onLoad(options) {
    const monthKey = getCurrentMonthKey()
    const today = getCurrentDateString()
    const todayDisplay = formatDateDisplay(today)
    const monthPickerItems = generateMonthPickerItems(monthKey)
    const currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)

    const shareToken = (options && options.shareToken) ? String(options.shareToken).trim() : ''
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
      navTitle: isViewerMode ? 'TA的消课记录' : '消课记录',
    })

    await this.loadMonthData(monthKey)
  },

  onUnload() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
  },

  async onShow() {
    this.setData({ todayDateString: getCurrentDateString() })
    await this.loadMonthData(this.data.currentMonthKey)
  },

  async loadMonthData(monthKey) {
    const [year, month] = monthKey.split('-')
    const { selectedDate, isViewerMode, shareToken } = this.data

    let checkinsMap = {}
    let list = []
    if (isViewerMode && shareToken) {
      try {
        checkinsMap = await getMonthCheckinsForShare(shareToken, monthKey)
      } catch (err) {
        wx.showToast({ title: '分享链接无效或已失效', icon: 'none' })
        return
      }
      try {
        list = await listCoursesForShare(shareToken)
      } catch (err) {
        wx.showToast({ title: '分享链接无效或已失效', icon: 'none' })
        return
      }
    } else {
      try {
        checkinsMap = await getMonthCheckins(monthKey)
      } catch (err) {
        // ignore
      }
      try {
        list = await listCourses()
      } catch (err) {
        // ignore
      }
    }

    // 收集所有打卡日期
    const allCheckinDates = []
    for (const checks of Object.values(checkinsMap)) {
      for (const c of checks) {
        if (c.checkinDate) {
          allCheckinDates.push(c.checkinDate)
        }
      }
    }

    const calendarDays = generateCalendarDays(
      Number(year),
      Number(month),
      allCheckinDates,
      selectedDate
    )

    // 按创建时间升序排序（旧课在前，便于颜色稳定）
    list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))

    // 统计每个课程在当月的打卡次数
    const checkinCountMap = {}
    for (const courseId of Object.keys(checkinsMap)) {
      checkinCountMap[courseId] = (checkinsMap[courseId] || []).length
    }

    const decorated = list.map((item, index) => {
      const total = Number(item.totalClasses || 0)
      const used = Number(item.usedClasses || 0)
      const displayUsed = used
      const rawPercent = total <= 0 ? 0 : (displayUsed / total) * 100
      const percent = Math.max(0, Math.min(100, rawPercent))
      const remain = total - displayUsed
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length]

      // 检查当天是否已打卡
      const monthChecks = checkinsMap[item.id] || []
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

    this.setData({
      calendarDays,
      courseList: decorated,
    })
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

  onSelectDate(e) {
    const { date } = e.currentTarget.dataset
    if (!date) return

    vibrateLight()
    const dateDisplay = formatDateDisplay(date)
    this.setData({ selectedDate: date, selectedDateDisplay: dateDisplay })

    // 刷新课程打卡状态
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

  // 直接使用小程序自带转发（右上角···转发），在分享时按需生成 token
  // 注意：不能使用 async，否则框架拿到的是 Promise 不会当分享配置用，需用 promise 字段做异步
  onShareAppMessage() {
    if (this.data.isViewerMode) {
      return { title: '消课记录', path: '/pages/course/course' }
    }
    const that = this
    const getPath = (token) => token
      ? `/pages/course/course?shareToken=${encodeURIComponent(token)}`
      : '/pages/course/course'
    const promise = (async () => {
      let token = that.data.thisShareToken
      if (!token) {
        try {
          token = await createShareToken()
          if (token) that.setData({ thisShareToken: token })
          return { title: '我的消课记录', path: getPath(token) }
        } catch (err) {
          wx.showToast({ title: '分享生成失败', icon: 'none' })
          return { title: '我的消课记录', path: '/pages/course/course' }
        }
      }
      return { title: '我的消课记录', path: getPath(token) }
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

    vibrateLight()
    this.setData({
      selectedDate: today,
      selectedDateDisplay: todayDisplay,
      currentMonthKey: monthKey,
      currentMonthLabel: getMonthLabel(monthKey),
    })
    this.loadMonthData(monthKey)
  },
})