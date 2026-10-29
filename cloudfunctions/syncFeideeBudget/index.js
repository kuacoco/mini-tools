const cloud = require('wx-server-sdk')
const request = require('request')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = 'budget_config'
const BUDGET_COLLECTION = 'budget_items'
const _ = db.command
const ADMIN_OPENID = 'o5Qxn17JK9Rx0v22YCXWvhVF4zwg'

/**
 * 从云数据库获取飞笛配置
 * 根据用户 openid 查找对应的配置
 */
async function getFeideeConfig(userId) {
  const res = await db
    .collection(CONFIG_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    return null
  }
  return res.data[0]
}

/** 北京时间相对 UTC 的偏移（毫秒） */
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 根据月份 key 计算起止时间戳（按北京时间当月 1 日 00:00 ～ 当月最后一日 23:59:59.999）
 * 云函数默认运行在 UTC，本地调试为本机时区，此处显式按北京时间计算，保证本地/云端结果一致
 */
function getMonthTimeRange(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const start = Date.UTC(year, month - 1, 1) - BEIJING_UTC_OFFSET_MS
  const end = Date.UTC(year, month, 0, 23, 59, 59, 999) - BEIJING_UTC_OFFSET_MS
  return {
    start_time: start,
    end_time: end,
  }
}

/**
 * 调用飞笛 API 获取分类支出数据
 */
function fetchFeideeData(config, timeRange) {
  return new Promise((resolve, reject) => {
    request.post({
      url: 'https://yun.feidee.net/cab-query-ws/v2/statistics/rollup-groups',
      headers: {
        'Content-Type': 'application/json',
        'authorization': config.authorization,
        'trading-entity': config.tradingEntity,
        'minor-version': '2',
        'user-agent': 'MyMoney/13.2.40 (Apple/iPhone17,2; iOS/26.3.1; AppStore)',
        'device': JSON.stringify({
          locale: 'zh-Hans-CN',
          time_zone: 'Asia/Shanghai',
          platform: 'iPhone',
          product_name: 'MyMoney',
          product_version: '13.2.40'
        }),
      },
      json: true,
      body: {
        group: { group_by: 'CATEGORY_SECOND', show_all: true },
        query: {
          account_ids: config.accountIds ? config.accountIds.split(',').map(s => s.trim()) : [],
          start_time: timeRange.start_time,
          end_time: timeRange.end_time,
          category_types: ['Expense'],
        },
        sort: { order_by: 'DESC', sort_by: 'EXPENSE' },
        measures: ['EXPENSE'],
      },
    }, (err, response, body) => {
      if (err) {
        reject(new Error(`飞笛 API 请求失败：${err.message}`))
        return
      }
      if (!response || response.statusCode !== 200) {
        reject(new Error(`飞笛 API 请求失败：${response?.statusCode || 'unknown error'}`))
        return
      }
      resolve((body && body.data) || [])
    })
  })
}

/**
 * 解析飞笛返回数据，提取分类和金额
 */
function parseFeideeData(data) {
  const records = []

  for (const parent of data || []) {
    for (const child of parent.children || []) {
      const expense = child.metric_data?.find((m) => m.key === 'EXPENSE')
      const amount = Number(expense?.value)
      if (!expense || !Number.isFinite(amount) || amount <= 0) continue

      records.push({
        category: child.group_name,
        categoryId: child.group_id || '',
        parentCategoryId: parent.group_id || '',
        parentCategoryName: parent.group_name || '',
        amount,
      })
    }
  }

  return records
}

/**
 * 规范化名称（用于去重匹配）
 */
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(
      /[\s`~!@#$%^&*()_\-+={[}\]|\\:;"'<,>.?/，。！？、：;（）【】《》""''·]+/g,
      ''
    )
}

/**
 * 合并预算项数据
 */
async function mergeBudgetItems(monthKey, openid, records) {
  if (!records.length) {
    return { created: 0, updated: 0, skipped: 0 }
  }

  // 同一父分类下合并同名二级分类，优先使用飞笛分类 ID 作为稳定键。
  const mergedMap = new Map()
  for (const record of records) {
    const category = String(record.category || '').trim()
    const normalizedName = normalizeName(category)
    const parentCategoryName = String(record.parentCategoryName || '').trim()
    const parentNormalizedName = normalizeName(parentCategoryName)
    const amount = Number(record.amount)
    if (!normalizedName || !parentNormalizedName || Number.isNaN(amount) || amount < 0) continue
    const mergeKey = record.categoryId
      ? `id:${record.categoryId}`
      : `name:${parentNormalizedName}:${normalizedName}`

    if (!mergedMap.has(mergeKey)) {
      mergedMap.set(mergeKey, {
        category,
        categoryId: record.categoryId || '',
        parentCategoryId: record.parentCategoryId || '',
        parentCategoryName,
        amount,
      })
    } else {
      const old = mergedMap.get(mergeKey)
      old.amount = Number((old.amount + amount).toFixed(2))
      mergedMap.set(mergeKey, old)
    }
  }

  const cleanRecords = Array.from(mergedMap.values())
  if (!cleanRecords.length) {
    return { created: 0, updated: 0, skipped: records.length }
  }

  // 查询已存在的预算项
  const existingRes = await db
    .collection(BUDGET_COLLECTION)
    .where({ openid, monthKey })
    .get()
  const existingList = existingRes.data || []
  const existingByCategoryId = new Map()
  const existingByCompositeName = new Map()
  const parentDisplayNameById = new Map()
  for (const doc of existingList) {
    const nameKey = doc.nameNormalized || normalizeName(doc.name)
    const parentNameKey =
      doc.parentCategoryNameNormalized || normalizeName(doc.parentCategoryName)
    if (doc.categoryId) existingByCategoryId.set(doc.categoryId, doc)
    if (nameKey && parentNameKey) {
      existingByCompositeName.set(`${parentNameKey}:${nameKey}`, doc)
    }
    if (doc.parentCategoryId && doc.parentCategoryName) {
      parentDisplayNameById.set(doc.parentCategoryId, doc.parentCategoryName)
    }
  }

  let created = 0
  let updated = 0
  let skipped = 0
  const now = Date.now()

  for (const item of cleanRecords) {
    const normalizedName = normalizeName(item.category)
    const sourceParentNormalized = normalizeName(item.parentCategoryName)
    const existingDoc =
      (item.categoryId && existingByCategoryId.get(item.categoryId)) ||
      existingByCompositeName.get(`${sourceParentNormalized}:${normalizedName}`)
    const parentCategoryName =
      parentDisplayNameById.get(item.parentCategoryId) || item.parentCategoryName
    const parentCategoryNameNormalized = normalizeName(parentCategoryName)

    if (existingDoc) {
      // 更新已使用额度；已经建立的自定义名称不被后续同步覆盖。
      await db
        .collection(BUDGET_COLLECTION)
        .doc(existingDoc._id)
        .update({
          data: {
            usedAmount: item.amount,
            categoryId: existingDoc.categoryId || item.categoryId,
            parentCategoryId:
              existingDoc.parentCategoryId || item.parentCategoryId,
            parentCategorySourceName:
              existingDoc.parentCategorySourceName || item.parentCategoryName,
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

    // 新增预算项
    await db.collection(BUDGET_COLLECTION).add({
      data: {
        openid,
        monthKey,
        name: item.category,
        nameNormalized: normalizedName,
        categoryId: item.categoryId,
        parentCategoryId: item.parentCategoryId,
        parentCategoryName,
        parentCategoryNameNormalized,
        parentCategorySourceName: item.parentCategoryName,
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

/**
 * 同步单个用户数据
 */
async function syncUserMonth(openid, monthKey) {
  const config = await getFeideeConfig(openid)
  if (!config) {
    return { success: false, message: '未配置飞笛账号' }
  }

  const timeRange = getMonthTimeRange(monthKey)
  const feideeData = await fetchFeideeData(config, timeRange)
  const records = parseFeideeData(feideeData)

  if (!records.length) {
    return { success: true, data: { created: 0, updated: 0, skipped: 0 } }
  }

  const stats = await mergeBudgetItems(monthKey, openid, records)
  return { success: true, data: stats }
}

/**
 * 用户手动触发：同步当前用户
 */
async function handleUserTrigger(openid, monthKey) {
  if (openid !== ADMIN_OPENID) throw new Error('暂无使用权限')

  return await syncUserMonth(openid, monthKey)
}

exports.main = async (event = {}) => {
  const ctx = cloud.getWXContext()
  const { OPENID, SOURCE } = ctx

  console.log('syncFeideeBudget invoke info:', JSON.stringify({
    source: SOURCE,
    openidSuffix: OPENID ? OPENID.slice(-8) : '',
    event,
  }))

  try {
    if (SOURCE === 'wx_trigger' || event.action) {
      throw new Error('仅支持预算看板手动同步')
    }

    // 用户手动触发
    const { monthKey } = event
    if (!OPENID) throw new Error('用户信息缺失')
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error('monthKey 格式不正确')
    }

    const result = await handleUserTrigger(OPENID, monthKey)
    if (!result.success) throw new Error(result.message || '同步失败')
    return { success: true, data: result.data }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '飞笛同步失败',
    }
  }
}
