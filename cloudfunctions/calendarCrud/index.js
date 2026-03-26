const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const EVENTS_COLLECTION = 'calendar_events'
const SHARE_COLLECTION = 'calendar_share'
const VIEWED_SHARE_COLLECTION = 'calendar_viewed_share'

const DAILY_EVENT_LIMIT = 5
const PAGE_SIZE = 100
const MAX_RANGE_DAYS = 370

function normalizeTitle(title) {
  return String(title || '').trim()
}

function normalizeCalendarName(name) {
  return String(name || '').trim()
}

function normalizeColor(color) {
  return String(color || '').trim()
}

function ensureDateString(dateStr, fieldName = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`${fieldName} 格式不正确，应为 YYYY-MM-DD`)
  }
  const date = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} 不是有效日期`)
  }
}

function ensureDateRange(startDate, endDate) {
  ensureDateString(startDate, 'startDate')
  ensureDateString(endDate, 'endDate')
  if (startDate > endDate) {
    throw new Error('开始日期不能晚于结束日期')
  }
}

function toDateString(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateRangeToList(startDate, endDate) {
  const out = []
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  let cursor = start
  while (cursor.getTime() <= end.getTime()) {
    out.push(toDateString(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    if (out.length > MAX_RANGE_DAYS) {
      throw new Error('日期区间过长，请缩小范围')
    }
  }
  return out
}

function eventCoversDate(item, dateStr) {
  return item.startDate <= dateStr && item.endDate >= dateStr
}

function toEventDTO(item, ownerToken = '') {
  return {
    id: item._id,
    title: item.title || '',
    startDate: item.startDate,
    endDate: item.endDate,
    color: item.color || '',
    createdAt: Number(item.createdAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    ownerToken,
  }
}

async function getOwnedEventById(id, openid) {
  if (!id) return null
  const res = await db.collection(EVENTS_COLLECTION).where({ _id: id, openid }).limit(1).get()
  const list = Array.isArray(res.data) ? res.data : []
  return list.length ? list[0] : null
}

async function listEventsByOpenidAndRange(openid, startDate, endDate) {
  const out = []
  let page = 0
  while (true) {
    const res = await db
      .collection(EVENTS_COLLECTION)
      .where({
        openid,
        startDate: _.lte(endDate),
        endDate: _.gte(startDate),
      })
      .orderBy('createdAt', 'asc')
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .get()

    const rows = Array.isArray(res.data) ? res.data : []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
    page += 1
  }
  return out
}

async function assertDailyLimit(openid, startDate, endDate, excludeEventId = '') {
  const days = dateRangeToList(startDate, endDate)
  const existing = await listEventsByOpenidAndRange(openid, startDate, endDate)
  const filtered = excludeEventId
    ? existing.filter((item) => item._id !== excludeEventId)
    : existing

  for (const day of days) {
    let count = 0
    for (const item of filtered) {
      if (eventCoversDate(item, day)) {
        count += 1
      }
      if (count >= DAILY_EVENT_LIMIT) {
        throw new Error(`${day} 当天日程已达上限（最多 ${DAILY_EVENT_LIMIT} 条）`)
      }
    }
  }
}

async function listEventsByRange(payload, openid) {
  const startDate = String(payload.startDate || '').trim()
  const endDate = String(payload.endDate || '').trim()
  ensureDateRange(startDate, endDate)

  const list = await listEventsByOpenidAndRange(openid, startDate, endDate)
  return { list: list.map((item) => toEventDTO(item)) }
}

async function upsertEvent(payload, openid) {
  const id = String(payload.id || '').trim()
  const title = normalizeTitle(payload.title)
  const startDate = String(payload.startDate || '').trim()
  const endDate = String(payload.endDate || '').trim()
  const color = normalizeColor(payload.color)

  if (!title) {
    throw new Error('日程不能为空')
  }
  if (title.length > 40) {
    throw new Error('日程标题不能超过40个字符')
  }
  ensureDateRange(startDate, endDate)
  if (!color) {
    throw new Error('请选择日程颜色')
  }

  if (id) {
    const existing = await getOwnedEventById(id, openid)
    if (!existing) {
      throw new Error('日程不存在或无权限编辑')
    }
    await assertDailyLimit(openid, startDate, endDate, id)

    const now = Date.now()
    await db.collection(EVENTS_COLLECTION).doc(id).update({
      data: {
        title,
        startDate,
        endDate,
        color,
        updatedAt: now,
      },
    })
    const saved = await getOwnedEventById(id, openid)
    return { item: toEventDTO(saved) }
  }

  await assertDailyLimit(openid, startDate, endDate)

  const now = Date.now()
  const addRes = await db.collection(EVENTS_COLLECTION).add({
    data: {
      openid,
      title,
      startDate,
      endDate,
      color,
      createdAt: now,
      updatedAt: now,
    },
  })

  const saved = await getOwnedEventById(addRes._id, openid)
  return { item: toEventDTO(saved) }
}

async function deleteEvent(payload, openid) {
  const id = String(payload.id || '').trim()
  if (!id) {
    throw new Error('日程不存在')
  }
  const existing = await getOwnedEventById(id, openid)
  if (!existing) {
    throw new Error('日程不存在或无权限删除')
  }
  await db.collection(EVENTS_COLLECTION).doc(id).remove()
  return { ok: true }
}

function generateShareToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 12; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}

async function getShareDocByToken(token) {
  const clean = String(token || '').trim()
  if (!clean) {
    throw new Error('分享链接无效')
  }
  const res = await db.collection(SHARE_COLLECTION).where({ token: clean }).limit(1).get()
  const list = Array.isArray(res.data) ? res.data : []
  if (!list.length) {
    throw new Error('分享链接无效或已失效')
  }
  return list[0]
}

async function createShareToken(payload, openid) {
  const calendarName = normalizeCalendarName(payload.calendarName)
  if (!calendarName) {
    throw new Error('日历名称不能为空')
  }
  if (calendarName.length > 30) {
    throw new Error('日历名称不能超过30个字符')
  }

  const existingRes = await db
    .collection(SHARE_COLLECTION)
    .where({ ownerOpenid: openid })
    .limit(1)
    .get()
  const existing = Array.isArray(existingRes.data) ? existingRes.data : []

  const now = Date.now()
  if (existing.length) {
    const doc = existing[0]
    await db.collection(SHARE_COLLECTION).doc(doc._id).update({
      data: {
        calendarName,
        updatedAt: now,
      },
    })
    return {
      token: doc.token,
      calendarName,
    }
  }

  let token = ''
  for (let i = 0; i < 6; i += 1) {
    token = generateShareToken()
    const res = await db.collection(SHARE_COLLECTION).where({ token }).limit(1).get()
    if (!Array.isArray(res.data) || !res.data.length) {
      break
    }
    token = ''
  }
  if (!token) {
    throw new Error('生成分享链接失败，请稍后再试')
  }

  await db.collection(SHARE_COLLECTION).add({
    data: {
      ownerOpenid: openid,
      token,
      calendarName,
      createdAt: now,
      updatedAt: now,
    },
  })

  return {
    token,
    calendarName,
  }
}

async function listEventsForShareByRange(payload) {
  const token = String(payload.token || '').trim()
  const startDate = String(payload.startDate || '').trim()
  const endDate = String(payload.endDate || '').trim()
  ensureDateRange(startDate, endDate)

  const shareDoc = await getShareDocByToken(token)
  const ownerOpenid = shareDoc.ownerOpenid
  const events = await listEventsByOpenidAndRange(ownerOpenid, startDate, endDate)

  return {
    calendarName: shareDoc.calendarName || '',
    list: events.map((item) => toEventDTO(item, token)),
  }
}

async function listViewedShares(openid) {
  const res = await db
    .collection(VIEWED_SHARE_COLLECTION)
    .where({ viewerOpenid: openid })
    .orderBy('updatedAt', 'desc')
    .limit(20)
    .get()

  const list = (res.data || []).map((item) => ({
    token: item.token,
    calendarName: item.calendarName || '',
    updatedAt: Number(item.updatedAt || 0),
  }))

  return { list }
}

async function upsertViewedShare(payload, openid) {
  const token = String(payload.token || '').trim()
  if (!token) {
    throw new Error('token 不能为空')
  }

  const shareDoc = await getShareDocByToken(token)
  const calendarName = normalizeCalendarName(payload.calendarName) || normalizeCalendarName(shareDoc.calendarName)
  const now = Date.now()

  const existingRes = await db
    .collection(VIEWED_SHARE_COLLECTION)
    .where({ viewerOpenid: openid, token })
    .limit(1)
    .get()
  const existing = Array.isArray(existingRes.data) ? existingRes.data : []

  if (existing.length) {
    await db.collection(VIEWED_SHARE_COLLECTION).doc(existing[0]._id).update({
      data: {
        calendarName,
        updatedAt: now,
      },
    })
  } else {
    await db.collection(VIEWED_SHARE_COLLECTION).add({
      data: {
        viewerOpenid: openid,
        token,
        calendarName,
        createdAt: now,
        updatedAt: now,
      },
    })
  }

  return {
    ok: true,
    calendarName,
  }
}

async function removeViewedShare(payload, openid) {
  const token = String(payload.token || '').trim()
  if (!token) {
    throw new Error('token 不能为空')
  }

  const res = await db
    .collection(VIEWED_SHARE_COLLECTION)
    .where({ viewerOpenid: openid, token })
    .get()
  const list = Array.isArray(res.data) ? res.data : []
  for (const item of list) {
    await db.collection(VIEWED_SHARE_COLLECTION).doc(item._id).remove()
  }
  return { ok: true }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  try {
    if (!OPENID) {
      throw new Error('用户信息缺失')
    }

    const action = event.action
    const payload = event.payload || {}

    let data = null
    switch (action) {
      case 'listEventsByRange':
        data = await listEventsByRange(payload, OPENID)
        break
      case 'upsertEvent':
        data = await upsertEvent(payload, OPENID)
        break
      case 'deleteEvent':
        data = await deleteEvent(payload, OPENID)
        break
      case 'createShareToken':
        data = await createShareToken(payload, OPENID)
        break
      case 'listEventsForShareByRange':
        data = await listEventsForShareByRange(payload)
        break
      case 'listViewedShares':
        data = await listViewedShares(OPENID)
        break
      case 'upsertViewedShare':
        data = await upsertViewedShare(payload, OPENID)
        break
      case 'removeViewedShare':
        data = await removeViewedShare(payload, OPENID)
        break
      default:
        throw new Error('不支持的 action')
    }

    return {
      success: true,
      data,
    }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '日历云函数执行失败',
    }
  }
}
