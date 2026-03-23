const { getCurrentDateString, getCurrentMonthKey } = require('./course-storage')
const { COLOR_PALETTE, DEFAULT_CHECKIN_DOT_BG } = require('./course-palette')

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

function generateCalendarDays(
  year,
  month,
  checkinDates = [],
  selectedDate = '',
  dateToDotStyle = {},
  defaultDotBg = DEFAULT_CHECKIN_DOT_BG
) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const daysInMonth = lastDay.getDate()
  const startWeekday = firstDay.getDay()

  const today = new Date()
  const todayStr = getCurrentDateString(today)

  const checkinSet = new Set(checkinDates)
  const days = []

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
      checkinDotStyle: '',
    })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isToday = dateStr === todayStr
    const hasCheckin = checkinSet.has(dateStr)
    days.push({
      day: d,
      date: dateStr,
      isCurrentMonth: true,
      isToday,
      isSelected: dateStr === selectedDate,
      hasCheckin,
      checkinDotStyle: hasCheckin ? (dateToDotStyle[dateStr] || defaultDotBg) : '',
    })
  }

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
      checkinDotStyle: '',
    })
  }

  return days
}

function generateMonthPickerItems(currentMonthKey) {
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

/**
 * 根据当月打卡数据生成消课列表页某一月的日历格子（含多课程打卡点颜色）
 */
function buildCourseMonthCalendar(monthKey, checkinsMap, listSorted, selectedDate) {
  const courseIdToPaletteIndex = {}
  listSorted.forEach((c, i) => {
    courseIdToPaletteIndex[c.id] = i
  })

  const dateToDotStyle = {}
  const dateToCourseIds = {}
  for (const [courseId, checks] of Object.entries(checkinsMap)) {
    for (const c of checks) {
      const d = c.checkinDate
      if (!d) continue
      if (!dateToCourseIds[d]) dateToCourseIds[d] = new Set()
      dateToCourseIds[d].add(courseId)
    }
  }
  for (const [dateStr, idSet] of Object.entries(dateToCourseIds)) {
    if (idSet.size >= 2) {
      dateToDotStyle[dateStr] = DEFAULT_CHECKIN_DOT_BG
    } else {
      const onlyId = [...idSet][0]
      const idx = courseIdToPaletteIndex[onlyId]
      if (idx === undefined) {
        dateToDotStyle[dateStr] = DEFAULT_CHECKIN_DOT_BG
      } else {
        const col = COLOR_PALETTE[idx % COLOR_PALETTE.length]
        dateToDotStyle[dateStr] = `linear-gradient(145deg, ${col.light} 0%, ${col.main} 100%)`
      }
    }
  }

  const allCheckinDates = []
  for (const checks of Object.values(checkinsMap)) {
    for (const c of checks) {
      if (c.checkinDate) allCheckinDates.push(c.checkinDate)
    }
  }

  const [year, month] = monthKey.split('-')
  return generateCalendarDays(
    Number(year),
    Number(month),
    allCheckinDates,
    selectedDate,
    dateToDotStyle,
    DEFAULT_CHECKIN_DOT_BG
  )
}

module.exports = {
  WEEKDAYS,
  getMonthLabel,
  getOffsetMonthKey,
  generateCalendarDays,
  generateMonthPickerItems,
  findMonthPickerIndex,
  buildCourseMonthCalendar,
}
