const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'budget_items'

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
      case 'getOpenId':
        data = { openId: OPENID }
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
