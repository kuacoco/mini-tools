const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COURSES_COLLECTION = 'course_records'
const CHECKINS_COLLECTION = 'checkin_logs'

function normalizeName(name) {
  return String(name || '').trim()
}

function ensureMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('monthKey 格式不正确')
  }
}

function ensureDateString(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('date 格式不正确，应为 YYYY-MM-DD')
  }
}

function getCurrentDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function getOwnedDocById(collection, id, openid) {
  if (!id) return null
  const res = await db.collection(collection).where({ _id: id, openid }).limit(1).get()
  const list = Array.isArray(res.data) ? res.data : []
  return list.length ? list[0] : null
}

async function listCourses(openid) {
  const res = await db
    .collection(COURSES_COLLECTION)
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .get()
  const list = (res.data || []).map((item) => ({
    id: item._id,
    courseName: item.courseName,
    totalClasses: Number(item.totalClasses || 0),
    usedClasses: Number(item.usedClasses || 0),
    createdAt: item.createdAt || 0,
    updatedAt: item.updatedAt || 0,
  }))
  return { list }
}

async function addCourse(payload, openid) {
  const courseName = normalizeName(payload.courseName)
  const totalClasses = Number(payload.totalClasses)
  if (!courseName) {
    throw new Error('课程名称不能为空')
  }
  if (!totalClasses || totalClasses <= 0 || !Number.isInteger(totalClasses)) {
    throw new Error('课时数应为正整数')
  }

  const now = Date.now()
  const createData = {
    openid,
    courseName,
    totalClasses,
    usedClasses: 0,
    createdAt: now,
    updatedAt: now,
  }
  const addRes = await db.collection(COURSES_COLLECTION).add({ data: createData })
  return {
    item: {
      id: addRes._id,
      courseName,
      totalClasses,
      usedClasses: 0,
      createdAt: now,
      updatedAt: now,
    },
  }
}

async function updateCourse(payload, openid) {
  const id = payload.id
  const courseName = normalizeName(payload.courseName)
  const totalClasses = Number(payload.totalClasses)
  if (!id) {
    throw new Error('课程不存在')
  }
  if (!courseName) {
    throw new Error('课程名称不能为空')
  }
  if (!totalClasses || totalClasses <= 0 || !Number.isInteger(totalClasses)) {
    throw new Error('课时数应为正整数')
  }

  const doc = await getOwnedDocById(COURSES_COLLECTION, id, openid)
  if (!doc) throw new Error('课程不存在')

  const now = Date.now()
  await db.collection(COURSES_COLLECTION).doc(id).update({
    data: {
      courseName,
      totalClasses,
      updatedAt: now,
    },
  })
  const updated = await getOwnedDocById(COURSES_COLLECTION, id, openid)
  return {
    item: {
      id: updated._id,
      courseName: updated.courseName,
      totalClasses: Number(updated.totalClasses || 0),
      usedClasses: Number(updated.usedClasses || 0),
      createdAt: updated.createdAt || now,
      updatedAt: updated.updatedAt || now,
    },
  }
}

async function deleteCourse(payload, openid) {
  const id = payload.id
  if (!id) throw new Error('课程不存在')

  const doc = await getOwnedDocById(COURSES_COLLECTION, id, openid)
  if (!doc) throw new Error('课程不存在')

  // 删除课程时同时删除该课程的所有打卡记录
  const checkinsRes = await db
    .collection(CHECKINS_COLLECTION)
    .where({ courseId: id, openid })
    .get()
  const checkins = checkinsRes.data || []
  for (const checkin of checkins) {
    await db.collection(CHECKINS_COLLECTION).doc(checkin._id).remove()
  }

  await db.collection(COURSES_COLLECTION).doc(id).remove()
  return { ok: true }
}

async function checkin(payload, openid) {
  const courseId = payload.courseId
  let checkinDate = payload.date
  const note = String(payload.note || '').trim()

  if (!courseId) {
    throw new Error('课程不存在')
  }
  // 如果没有指定日期，默认今天
  if (!checkinDate) {
    checkinDate = getCurrentDateString()
  }
  ensureDateString(checkinDate)

  const course = await getOwnedDocById(COURSES_COLLECTION, courseId, openid)
  if (!course) throw new Error('课程不存在')

  const usedClasses = Number(course.usedClasses || 0)
  const totalClasses = Number(course.totalClasses || 0)

  // 检查是否已打卡
  const existingRes = await db
    .collection(CHECKINS_COLLECTION)
    .where({ courseId, openid, checkinDate })
    .limit(1)
    .get()
  const existingList = existingRes.data || []

  const now = Date.now()
  let isUpdate = false

  if (existingList.length > 0) {
    // 已打卡，更新备注
    const existing = existingList[0]
    await db.collection(CHECKINS_COLLECTION).doc(existing._id).update({
      data: {
        note,
        updatedAt: now,
      },
    })
    isUpdate = true
  } else {
    // 新增打卡
    if (usedClasses >= totalClasses) {
      throw new Error('课时已用完，无法打卡')
    }
    await db.collection(CHECKINS_COLLECTION).add({
      data: {
        openid,
        courseId,
        checkinDate,
        checkinTimestamp: now,
        note,
        createdAt: now,
      },
    })
    // 增加已用课时
    await db.collection(COURSES_COLLECTION).doc(courseId).update({
      data: {
        usedClasses: usedClasses + 1,
        updatedAt: now,
      },
    })
  }

  // 返回更新后的课程信息
  const updatedCourse = await getOwnedDocById(COURSES_COLLECTION, courseId, openid)
  return {
    item: {
      id: updatedCourse._id,
      courseName: updatedCourse.courseName,
      totalClasses: Number(updatedCourse.totalClasses || 0),
      usedClasses: Number(updatedCourse.usedClasses || 0),
      createdAt: updatedCourse.createdAt || now,
      updatedAt: updatedCourse.updatedAt || now,
    },
    isUpdate,
  }
}

async function removeCheckin(payload, openid) {
  const checkinId = payload.checkinId
  if (!checkinId) {
    throw new Error('打卡记录不存在')
  }

  const checkin = await getOwnedDocById(CHECKINS_COLLECTION, checkinId, openid)
  if (!checkin) throw new Error('打卡记录不存在')

  const courseId = checkin.courseId
  const course = await getOwnedDocById(COURSES_COLLECTION, courseId, openid)
  if (!course) throw new Error('课程不存在')

  // 删除打卡记录
  await db.collection(CHECKINS_COLLECTION).doc(checkinId).remove()

  // 减少已用课时
  const usedClasses = Number(course.usedClasses || 0)
  const now = Date.now()
  await db.collection(COURSES_COLLECTION).doc(courseId).update({
    data: {
      usedClasses: Math.max(0, usedClasses - 1),
      updatedAt: now,
    },
  })

  return { ok: true, courseId }
}

async function getCheckinLogs(payload, openid) {
  const courseId = payload.courseId
  const monthKey = payload.monthKey
  if (!courseId) throw new Error('课程不存在')
  if (monthKey) ensureMonthKey(monthKey)

  const course = await getOwnedDocById(COURSES_COLLECTION, courseId, openid)
  if (!course) throw new Error('课程不存在')

  let query = { courseId, openid }

  if (monthKey) {
    // 匹配该月份的日期
    query.checkinDate = db.RegExp({
      regexp: `^${monthKey}`,
      options: 'i',
    })
  }

  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where(query)
    .orderBy('checkinDate', 'desc')
    .get()

  const list = (res.data || []).map((item) => ({
    id: item._id,
    courseId: item.courseId,
    checkinDate: item.checkinDate,
    checkinTimestamp: item.checkinTimestamp,
    note: item.note || '',
    createdAt: item.createdAt || 0,
  }))

  return { list }
}

async function getMonthCheckins(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)

  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({
      openid,
      checkinDate: db.RegExp({
        regexp: `^${monthKey}`,
        options: 'i',
      }),
    })
    .get()

  // 按课程ID分组
  const checkinsMap = {}
  for (const item of (res.data || [])) {
    const courseId = item.courseId
    if (!checkinsMap[courseId]) {
      checkinsMap[courseId] = []
    }
    checkinsMap[courseId].push({
      id: item._id,
      checkinDate: item.checkinDate,
      checkinTimestamp: item.checkinTimestamp,
      note: item.note || '',
    })
  }

  return { checkins: checkinsMap }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const action = event.action
    const payload = event.payload || {}
    if (!OPENID) throw new Error('用户信息缺失')

    let data = null
    switch (action) {
      case 'listCourses':
        data = await listCourses(OPENID)
        break
      case 'addCourse':
        data = await addCourse(payload, OPENID)
        break
      case 'updateCourse':
        data = await updateCourse(payload, OPENID)
        break
      case 'deleteCourse':
        data = await deleteCourse(payload, OPENID)
        break
      case 'checkin':
        data = await checkin(payload, OPENID)
        break
      case 'removeCheckin':
        data = await removeCheckin(payload, OPENID)
        break
      case 'getCheckinLogs':
        data = await getCheckinLogs(payload, OPENID)
        break
      case 'getMonthCheckins':
        data = await getMonthCheckins(payload, OPENID)
        break
      default:
        throw new Error('不支持的 action')
    }
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '课程云函数执行失败',
    }
  }
}