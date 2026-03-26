function ensureCloudReady() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('云开发未初始化')
  }
}

async function callCalendarCrud(action, payload = {}) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'calendarCrud',
    data: {
      action,
      payload,
    },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '日历服务异常')
  }
  return result.data
}

function getCurrentDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

async function listEventsByRange(startDate, endDate) {
  const data = await callCalendarCrud('listEventsByRange', { startDate, endDate })
  return Array.isArray(data && data.list) ? data.list : []
}

async function upsertEvent(payload) {
  const data = await callCalendarCrud('upsertEvent', {
    id: payload.id || '',
    title: payload.title,
    startDate: payload.startDate,
    endDate: payload.endDate,
    color: payload.color,
  })
  return data && data.item ? data.item : null
}

async function deleteEvent(id) {
  await callCalendarCrud('deleteEvent', { id })
}

async function createShareToken(calendarName) {
  const data = await callCalendarCrud('createShareToken', { calendarName })
  return {
    token: data && data.token ? data.token : '',
    calendarName: data && data.calendarName ? data.calendarName : '',
  }
}

async function listEventsForShareByRange(token, startDate, endDate) {
  const data = await callCalendarCrud('listEventsForShareByRange', {
    token,
    startDate,
    endDate,
  })
  return {
    calendarName: data && data.calendarName ? data.calendarName : '',
    list: Array.isArray(data && data.list) ? data.list : [],
  }
}

async function listViewedShares() {
  const data = await callCalendarCrud('listViewedShares')
  return Array.isArray(data && data.list) ? data.list : []
}

async function upsertViewedShare(token, calendarName = '') {
  const data = await callCalendarCrud('upsertViewedShare', {
    token,
    calendarName,
  })
  return data || { ok: true }
}

async function removeViewedShare(token) {
  await callCalendarCrud('removeViewedShare', { token })
}

module.exports = {
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
}
