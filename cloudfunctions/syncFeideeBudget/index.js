const cloud = require('wx-server-sdk')
const request = require('request')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = 'budget_config'
const WHITELIST_COLLECTION = 'budget_whitelist'
const BUDGET_COLLECTION = 'budget_items'
const _ = db.command
const ADMIN_OPENID = 'o5Qxn17JK9Rx0v22YCXWvhVF4zwg'

/**
 * 获取所有白名单用户
 */
async function getAllWhitelistUsers() {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .get()
  return (res.data || []).map(item => item.openid)
}

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
        group: { group_by: 'CATEGORY_FIRST', show_all: true },
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
  return (data || [])
    .filter((item) => {
      const expense = item.metric_data?.find((m) => m.key === 'EXPENSE')
      return expense && expense.value !== '0.00'
    })
    .map((item) => {
      const expense = item.metric_data.find((m) => m.key === 'EXPENSE')
      return {
        category: item.group_name,
        amount: Number(expense.value),
      }
    })
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

  // 合并同名分类
  const mergedMap = new Map()
  for (const record of records) {
    const category = String(record.category || '').trim()
    const normalizedName = normalizeName(category)
    const amount = Number(record.amount)
    if (!normalizedName || Number.isNaN(amount) || amount < 0) continue

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

  // 查询已存在的预算项
  const existingRes = await db
    .collection(BUDGET_COLLECTION)
    .where({ openid, monthKey })
    .get()
  const existingList = existingRes.data || []
  const existingMap = new Map()
  for (const doc of existingList) {
    const key = doc.nameNormalized || normalizeName(doc.name)
    if (!key || existingMap.has(key)) continue
    existingMap.set(key, doc)
  }

  let created = 0
  let updated = 0
  let skipped = 0
  const now = Date.now()

  for (const item of cleanRecords) {
    const normalizedName = normalizeName(item.category)
    const existingDoc = existingMap.get(normalizedName)

    if (existingDoc) {
      // 更新已使用额度
      await db
        .collection(BUDGET_COLLECTION)
        .doc(existingDoc._id)
        .update({
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

    // 新增预算项
    await db.collection(BUDGET_COLLECTION).add({
      data: {
        openid,
        monthKey,
        name: item.category,
        nameNormalized: normalizedName,
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
 * 发送订阅消息通知
 */
async function sendSyncNotification(openid, status, stats, errorMessage) {
  const templateId = '4y6KFyJZRdinp_2g6qrNK3bdKWwrGs9VFrrUHbRJNb0'
  const now = new Date()
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  let resultText = ''
  let remarkText = ''

  if (status === 'success') {
    resultText = '同步成功'
    remarkText = `新增${stats?.created || 0}项，更新${stats?.updated || 0}项`
  } else if (status === 'skipped') {
    resultText = '跳过同步'
    remarkText = errorMessage || '未配置飞笛账号'
  } else {
    resultText = '同步失败'
    remarkText = errorMessage || '未知错误'
  }

  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      page: '/pages/budget/budget',
      templateId: templateId,
      data: {
        thing1: { value: '飞笛预算同步' },
        phrase2: { value: resultText },
        time3: { value: timeStr },
        thing6: { value: remarkText.slice(0, 20) }
      }
    })
    console.log(`通知发送成功: ${openid.slice(-8)}`)
    // 发送成功后消费订阅次数
    await consumeSubscribeCount(openid)
  } catch (err) {
    console.error(`通知发送失败: ${openid.slice(-8)}`, err.message)
  }
}

/**
 * 消费订阅次数
 */
async function consumeSubscribeCount(openid) {
  try {
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
      console.log(`订阅次数不足: ${openid.slice(-8)}`)
      return { count: 0, consumed: false }
    }
    await db.collection(WHITELIST_COLLECTION).doc(doc._id).update({
      data: {
        subscribeCount: _.inc(-1),
        updatedAt: Date.now(),
      },
    })
    console.log(`订阅次数已消费: ${openid.slice(-8)}, 剩余 ${currentCount - 1}`)
    return { count: currentCount - 1, consumed: true }
  } catch (err) {
    console.error(`消费订阅次数失败: ${openid.slice(-8)}`, err.message)
    return { count: 0, consumed: false }
  }
}

/**
 * 定时触发：同步所有白名单用户
 */
async function handleTimerTrigger() {
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const users = await getAllWhitelistUsers()
  const results = {
    total: users.length,
    success: 0,
    failed: 0,
    skipped: 0,
    details: []
  }

  for (const openid of users) {
    try {
      const result = await syncUserMonth(openid, monthKey)
      if (result.success) {
        results.success += 1
        results.details.push({
          openid: openid.slice(-8),
          status: 'success',
          stats: result.data
        })
        // 发送成功通知
        await sendSyncNotification(openid, 'success', result.data)
      } else {
        results.skipped += 1
        results.details.push({
          openid: openid.slice(-8),
          status: 'skipped',
          message: result.message
        })
        // 发送跳过通知
        await sendSyncNotification(openid, 'skipped', null, result.message)
      }
    } catch (err) {
      results.failed += 1
      results.details.push({
        openid: openid.slice(-8),
        status: 'failed',
        message: err.message
      })
      // 发送失败通知
      await sendSyncNotification(openid, 'failed', null, err.message)
    }
  }

  console.log('定时同步完成:', JSON.stringify(results))
  return results
}

/**
 * 用户手动触发：同步当前用户
 */
async function handleUserTrigger(openid, monthKey) {
  // 检查白名单权限
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    throw new Error('该功能仅限白名单用户使用')
  }

  return await syncUserMonth(openid, monthKey)
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  const { OPENID, SOURCE } = ctx

  console.log('syncFeideeBudget invoke info:', JSON.stringify({
    source: SOURCE,
    openidSuffix: OPENID ? OPENID.slice(-8) : '',
    event,
  }))

  try {
    if (SOURCE === 'wx_trigger') {
      console.log('syncFeideeBudget timer trigger detected')
      const results = await handleTimerTrigger()
      return { success: true, data: results }
    }

    // 管理员手动触发同步所有用户
    if (event.action === 'syncAll') {
      // 检查管理员权限
      if (OPENID !== ADMIN_OPENID) {
        throw new Error('无权限执行此操作')
      }
      const results = await handleTimerTrigger()
      return { success: true, data: results }
    }

    // 用户手动触发
    const { monthKey } = event
    if (!OPENID) throw new Error('用户信息缺失')
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error('monthKey 格式不正确')
    }

    const result = await handleUserTrigger(OPENID, monthKey)
    return { success: true, data: result.data }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '飞笛同步失败',
    }
  }
}