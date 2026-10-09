const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'budget_items'
const CONFIG_COLLECTION = 'budget_config'
const WHITELIST_COLLECTION = 'budget_whitelist'
const _ = db.command
const DAILY_FOOD_BUDGET_CONFIG_KEY = 'dailyFoodBudget'
const DEFAULT_DAILY_FOOD_BUDGET = 50
const OCR_PARENT_CATEGORY_NAME = '图片导入'

function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(
      /[\s`~!@#$%^&*()_\-+={[}\]|\\:;"'<,>.?/，。！？、：；（）【】《》“”‘’·]+/g,
      ''
    )
}

function normalizeAmount(value) {
  const num = Number(value)
  if (Number.isNaN(num) || num < 0) return null
  return Number(num.toFixed(2))
}

function ensureMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('monthKey 格式不正确')
  }
}

async function getOwnedDocById(id, openid) {
  if (!id) return null
  const res = await db.collection(COLLECTION).where({ _id: id, openid }).limit(1).get()
  const list = Array.isArray(res.data) ? res.data : []
  return list.length ? list[0] : null
}

async function listByMonth({ monthKey }, openid) {
  ensureMonthKey(monthKey)
  const res = await db
    .collection(COLLECTION)
    .where({ openid, monthKey })
    .orderBy('createdAt', 'asc')
    .get()
  const list = (res.data || []).map((item) => ({
    id: item._id,
    name: item.name,
    categoryId: item.categoryId || '',
    parentCategoryId: item.parentCategoryId || '',
    parentCategoryName: item.parentCategoryName || '',
    parentCategorySourceName: item.parentCategorySourceName || '',
    totalAmount: Number(item.totalAmount || 0),
    usedAmount: Number(item.usedAmount || 0),
    createdAt: item.createdAt || 0,
    updatedAt: item.updatedAt || 0,
  }))
  return { list }
}

async function upsertItem(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)
  const name = String(payload.name || '').trim()
  const parentCategoryName = String(payload.parentCategoryName || '').trim()
  const normalized = normalizeName(name)
  const parentNormalized = normalizeName(parentCategoryName)
  const totalAmount = normalizeAmount(payload.totalAmount)
  if (!name || !normalized) {
    throw new Error('预算项名称不能为空')
  }
  if (!parentCategoryName || !parentNormalized) {
    throw new Error('一级分类名称不能为空')
  }
  if (totalAmount === null || totalAmount < 0) {
    throw new Error('预算金额不合法')
  }

  const used = normalizeAmount(payload.usedAmount)
  const now = Date.now()
  const monthRes = await db.collection(COLLECTION).where({ openid, monthKey }).get()
  const monthList = monthRes.data || []
  const matchedParent = monthList.find(
    (item) =>
      normalizeName(item.parentCategoryName) === parentNormalized &&
      item.parentCategoryId
  )
  const parentCategoryId = matchedParent ? matchedParent.parentCategoryId : ''
  const parentCategorySourceName = matchedParent
    ? matchedParent.parentCategorySourceName || ''
    : ''
  if (payload.id) {
    const doc = await getOwnedDocById(payload.id, openid)
    if (!doc) throw new Error('预算项不存在')
    await db.collection(COLLECTION).doc(payload.id).update({
      data: {
        name,
        nameNormalized: normalized,
        parentCategoryId,
        parentCategoryName,
        parentCategoryNameNormalized: parentNormalized,
        totalAmount,
        updatedAt: now,
      },
    })
    const item = await getOwnedDocById(payload.id, openid)
    return {
      item: {
        id: item._id,
        name: item.name,
        categoryId: item.categoryId || '',
        parentCategoryId: item.parentCategoryId || '',
        parentCategoryName: item.parentCategoryName || '',
        parentCategorySourceName: item.parentCategorySourceName || '',
        totalAmount: Number(item.totalAmount || 0),
        usedAmount: Number(item.usedAmount || 0),
        createdAt: item.createdAt || now,
        updatedAt: item.updatedAt || now,
      },
    }
  }

  const createData = {
    openid,
    monthKey,
    name,
    nameNormalized: normalized,
    categoryId: '',
    parentCategoryId,
    parentCategoryName,
    parentCategoryNameNormalized: parentNormalized,
    parentCategorySourceName,
    totalAmount,
    usedAmount: used === null ? 0 : used,
    createdAt: now,
    updatedAt: now,
  }
  const addRes = await db.collection(COLLECTION).add({ data: createData })
  return {
    item: {
      id: addRes._id,
      name,
      categoryId: '',
      parentCategoryId,
      parentCategoryName,
      parentCategorySourceName,
      totalAmount: createData.totalAmount,
      usedAmount: createData.usedAmount,
      createdAt: now,
      updatedAt: now,
    },
  }
}

async function renameParentCategory(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)
  const oldName = String(payload.oldName || '').trim()
  const nextName = String(payload.nextName || '').trim()
  const nextNormalized = normalizeName(nextName)
  if (!nextName || !nextNormalized) {
    throw new Error('一级分类名称不能为空')
  }

  const res = await db.collection(COLLECTION).where({ openid, monthKey }).get()
  const oldNormalized = normalizeName(oldName)
  const conflict =
    nextNormalized !== oldNormalized &&
    (res.data || []).some(
      (item) => normalizeName(item.parentCategoryName) === nextNormalized
    )
  if (conflict) throw new Error('一级分类名称已存在')
  const matched = (res.data || []).filter(
    (item) => normalizeName(item.parentCategoryName) === oldNormalized
  )
  if (!matched.length) throw new Error('一级分类不存在')

  const now = Date.now()
  for (const item of matched) {
    await db.collection(COLLECTION).doc(item._id).update({
      data: {
        parentCategoryName: nextName,
        parentCategoryNameNormalized: nextNormalized,
        updatedAt: now,
      },
    })
  }
  return { updated: matched.length }
}

async function updateUsedAmount(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)
  const id = payload.id
  const usedAmount = normalizeAmount(payload.usedAmount)
  if (!id || usedAmount === null) {
    throw new Error('已使用金额不合法')
  }
  const doc = await getOwnedDocById(id, openid)
  if (!doc || doc.monthKey !== monthKey) throw new Error('预算项不存在')
  await db.collection(COLLECTION).doc(id).update({
    data: {
      usedAmount,
      updatedAt: Date.now(),
    },
  })
  return { ok: true }
}

async function deleteItem(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)
  const id = payload.id
  if (!id) throw new Error('预算项不存在')
  const doc = await getOwnedDocById(id, openid)
  if (!doc || doc.monthKey !== monthKey) throw new Error('预算项不存在')
  await db.collection(COLLECTION).doc(id).remove()
  return { ok: true }
}

async function mergeFromOcr(payload, openid) {
  const monthKey = payload.monthKey
  ensureMonthKey(monthKey)
  const records = Array.isArray(payload.records) ? payload.records : []
  if (!records.length) {
    return { created: 0, updated: 0, skipped: 0 }
  }
  const mergedMap = new Map()
  for (const record of records) {
    const category = String(record.category || '').trim()
    const normalizedName = normalizeName(category)
    const amount = normalizeAmount(record.amount)
    if (!normalizedName || amount === null) continue
    if (!mergedMap.has(normalizedName)) {
      mergedMap.set(normalizedName, { category, amount })
    } else {
      const old = mergedMap.get(normalizedName)
      old.amount = Number((old.amount + amount).toFixed(2))
      mergedMap.set(normalizedName, old)
    }
  }

  const cleanRecords = Array.from(mergedMap.values())
  if (!cleanRecords.length) {
    return { created: 0, updated: 0, skipped: records.length }
  }

  const existingRes = await db
    .collection(COLLECTION)
    .where({ openid, monthKey })
    .get()
  const existingList = existingRes.data || []
  const existingMap = new Map()
  for (const doc of existingList) {
    const key = `${normalizeName(doc.parentCategoryName)}:${doc.nameNormalized || normalizeName(doc.name)}`
    if (!key || existingMap.has(key)) continue
    existingMap.set(key, doc)
  }

  let created = 0
  let updated = 0
  let skipped = 0
  const now = Date.now()
  const parentCategoryNameNormalized = normalizeName(OCR_PARENT_CATEGORY_NAME)
  for (const item of cleanRecords) {
    const normalizedName = normalizeName(item.category)
    const existingDoc = existingMap.get(
      `${parentCategoryNameNormalized}:${normalizedName}`
    )
    if (existingDoc) {
      await db.collection(COLLECTION).doc(existingDoc._id).update({
        data: {
          usedAmount: item.amount,
          updatedAt: now,
        },
      })
      updated += 1
      continue
    }
    if (item.amount < 0) {
      skipped += 1
      continue
    }
    await db.collection(COLLECTION).add({
      data: {
        openid,
        monthKey,
        name: item.category,
        nameNormalized: normalizedName,
        categoryId: '',
        parentCategoryId: '',
        parentCategoryName: OCR_PARENT_CATEGORY_NAME,
        parentCategoryNameNormalized,
        parentCategorySourceName: '',
        totalAmount: item.amount,
        usedAmount: item.amount,
        createdAt: now,
        updatedAt: now,
      },
    })
    created += 1
  }

  skipped += Math.max(0, records.length - cleanRecords.length)
  return { created, updated, skipped }
}

async function checkWhitelist(openid) {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  return { isWhitelisted: res.data && res.data.length > 0 }
}

/**
 * 增加订阅次数（用户同意订阅后调用）
 */
async function incrementSubscribe(openid) {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    throw new Error('用户不在白名单中')
  }
  const doc = res.data[0]
  await db.collection(WHITELIST_COLLECTION).doc(doc._id).update({
    data: {
      subscribeCount: _.inc(1),
      updatedAt: Date.now(),
    },
  })
  return { ok: true }
}

/**
 * 消费订阅次数（发送通知成功后调用）
 * 返回剩余次数
 */
async function consumeSubscribe(openid) {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    return { count: 0, consumed: false }
  }
  const doc = res.data[0]
  const currentCount = Number(doc.subscribeCount || 0)
  if (currentCount <= 0) {
    return { count: 0, consumed: false }
  }
  await db.collection(WHITELIST_COLLECTION).doc(doc._id).update({
    data: {
      subscribeCount: _.inc(-1),
      updatedAt: Date.now(),
    },
  })
  return { count: currentCount - 1, consumed: true }
}

/**
 * 获取订阅次数
 */
async function getSubscribeCount(openid) {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    return { count: 0 }
  }
  return { count: Number(res.data[0].subscribeCount || 0) }
}

async function getPublicBudgetConfig() {
  const res = await db
    .collection(CONFIG_COLLECTION)
    .where({ configKey: DAILY_FOOD_BUDGET_CONFIG_KEY })
    .limit(1)
    .get()
  const doc = res.data && res.data.length > 0 ? res.data[0] : null
  return {
    dailyFoodBudget: doc ? Number(doc.value || 0) : DEFAULT_DAILY_FOOD_BUDGET,
  }
}

async function copyFromMonth(payload, openid) {
  const { sourceMonthKey, targetMonthKey } = payload
  ensureMonthKey(sourceMonthKey)
  ensureMonthKey(targetMonthKey)

  // 1. 获取源月份预算项（按 createdAt asc 排序，与列表显示顺序一致）
  const sourceRes = await db
    .collection(COLLECTION)
    .where({ openid, monthKey: sourceMonthKey })
    .orderBy('createdAt', 'asc')
    .get()
  const sourceList = sourceRes.data || []

  if (!sourceList.length) {
    return { created: 0, skipped: 0 }
  }

  // 2. 获取目标月份已有预算项（用于排重）
  const targetRes = await db
    .collection(COLLECTION)
    .where({ openid, monthKey: targetMonthKey })
    .get()
  const targetMap = new Map()
  for (const doc of targetRes.data || []) {
    const key = doc.categoryId
      ? `id:${doc.categoryId}`
      : `name:${normalizeName(doc.parentCategoryName)}:${doc.nameNormalized || normalizeName(doc.name)}`
    if (key) targetMap.set(key, doc)
  }

  // 3. 批量插入（跳过已存在，保持顺序一致）
  let created = 0
  let skipped = 0
  const baseTime = Date.now()

  for (const src of sourceList) {
    const normalizedName = src.nameNormalized || normalizeName(src.name)
    const sourceKey = src.categoryId
      ? `id:${src.categoryId}`
      : `name:${normalizeName(src.parentCategoryName)}:${normalizedName}`
    if (targetMap.has(sourceKey)) {
      skipped += 1
      continue
    }
    // 使用递增时间戳保持顺序：第1项时间戳最小，排在最前
    const createdAt = baseTime + created
    await db.collection(COLLECTION).add({
      data: {
        openid,
        monthKey: targetMonthKey,
        name: src.name,
        nameNormalized: normalizedName,
        categoryId: src.categoryId || '',
        parentCategoryId: src.parentCategoryId || '',
        parentCategoryName: src.parentCategoryName || '',
        parentCategoryNameNormalized:
          src.parentCategoryNameNormalized || normalizeName(src.parentCategoryName),
        parentCategorySourceName: src.parentCategorySourceName || '',
        totalAmount: Number(src.totalAmount || 0),
        usedAmount: 0,
        createdAt,
        updatedAt: createdAt,
      },
    })
    created += 1
  }

  return { created, skipped }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const action = event.action
    const payload = event.payload || {}
    if (!OPENID) throw new Error('用户信息缺失')

    let data = null
    switch (action) {
      case 'listByMonth':
        data = await listByMonth(payload, OPENID)
        break
      case 'upsertItem':
        data = await upsertItem(payload, OPENID)
        break
      case 'updateUsedAmount':
        data = await updateUsedAmount(payload, OPENID)
        break
      case 'renameParentCategory':
        data = await renameParentCategory(payload, OPENID)
        break
      case 'deleteItem':
        data = await deleteItem(payload, OPENID)
        break
      case 'mergeFromOcr':
        data = await mergeFromOcr(payload, OPENID)
        break
      case 'getOpenId':
        data = { openId: OPENID }
        break
      case 'checkWhitelist':
        data = await checkWhitelist(OPENID)
        break
      case 'incrementSubscribe':
        data = await incrementSubscribe(OPENID)
        break
      case 'consumeSubscribe':
        data = await consumeSubscribe(OPENID)
        break
      case 'getSubscribeCount':
        data = await getSubscribeCount(OPENID)
        break
      case 'getPublicBudgetConfig':
        data = await getPublicBudgetConfig()
        break
      case 'copyFromMonth':
        data = await copyFromMonth(payload, OPENID)
        break
      default:
        throw new Error('不支持的 action')
    }
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '预算云函数执行失败',
    }
  }
}
