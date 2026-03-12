function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getCurrentDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ensureCloudReady() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('云开发未初始化')
  }
}

async function callCourseCrud(action, payload = {}) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'courseCrud',
    data: {
      action,
      payload,
    },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '课程服务异常')
  }
  return result.data
}

async function listCourses() {
  const data = await callCourseCrud('listCourses')
  return Array.isArray(data && data.list) ? data.list : []
}

async function addCourse(payload) {
  const data = await callCourseCrud('addCourse', {
    courseName: payload.courseName,
    totalClasses: Number(payload.totalClasses),
  })
  return data ? data.item : null
}

async function updateCourse(payload) {
  const data = await callCourseCrud('updateCourse', {
    id: payload.id,
    courseName: payload.courseName,
    totalClasses: Number(payload.totalClasses),
  })
  return data ? data.item : null
}

async function deleteCourse(id) {
  await callCourseCrud('deleteCourse', { id })
}

async function checkin(payload) {
  const data = await callCourseCrud('checkin', {
    courseId: payload.courseId,
    date: payload.date,
    note: payload.note || '',
  })
  return data || { isUpdate: false }
}

async function removeCheckin(checkinId) {
  await callCourseCrud('removeCheckin', { checkinId })
}

async function getCheckinLogs(courseId, monthKey) {
  const data = await callCourseCrud('getCheckinLogs', {
    courseId,
    monthKey,
  })
  return Array.isArray(data && data.list) ? data.list : []
}

async function getMonthCheckins(monthKey) {
  const data = await callCourseCrud('getMonthCheckins', { monthKey })
  return data && data.checkins ? data.checkins : {}
}

module.exports = {
  getCurrentMonthKey,
  getCurrentDateString,
  listCourses,
  addCourse,
  updateCourse,
  deleteCourse,
  checkin,
  removeCheckin,
  getCheckinLogs,
  getMonthCheckins,
}