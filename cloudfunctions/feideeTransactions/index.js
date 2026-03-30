const cloud = require('wx-server-sdk')
const request = require('request')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = 'budget_config'
const WHITELIST_COLLECTION = 'budget_whitelist'

/** 北京时间相对 UTC 的偏移（毫秒） */
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function isValidYmd(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))
}

function getDayStartMs(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number)
  return Date.UTC(year, month - 1, day) - BEIJING_UTC_OFFSET_MS
}

function getDayTimeRange(ymd) {
  const start = getDayStartMs(ymd)
  const end = start + DAY_MS - 1
  return { start_time: start, end_time: end }
}

function getDateRangeTimeRange(startDate, endDate) {
  return {
    start_time: getDayStartMs(startDate),
    end_time: getDayTimeRange(endDate).end_time,
  }
}

function msToYmd(ms) {
  const d = new Date(Number(ms) + BEIJING_UTC_OFFSET_MS)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function listDateStringsBetween(startDate, endDate) {
  const days = []
  const startMs = getDayStartMs(startDate)
  const endMs = getDayStartMs(endDate)
  for (let cur = startMs; cur <= endMs; cur += DAY_MS) {
    days.push(msToYmd(cur))
  }
  return days
}

function normalizeAccountIds(accountIdsRaw) {
  if (!accountIdsRaw) return []
  return String(accountIdsRaw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function checkWhitelistPermission(openid) {
  const res = await db
    .collection(WHITELIST_COLLECTION)
    .where({ openid })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) {
    throw new Error('该功能仅限白名单用户使用')
  }
}

async function getFeideeConfig(userId) {
  const res = await db
    .collection(CONFIG_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  if (!res.data || res.data.length === 0) return null
  return res.data[0]
}

function buildCommonHeaders(config) {
  return {
    'Content-Type': 'application/json',
    authorization: config.authorization,
    'trading-entity': config.tradingEntity,
    'minor-version': '2',
    'user-agent': 'MyMoney/13.2.41 (Apple/iPhone17,2; iOS/26.3.1; AppStore)',
    device: JSON.stringify({
      locale: 'zh-Hans-CN',
      time_zone: 'Asia/Shanghai',
      device_id: 'feideeTransactions-device',
      platform: 'iPhone',
      model: 'iPhone17,2',
      os_version: '26.3.1',
      product_version: '13.2.41',
      product_name: 'MyMoney',
    }),
  }
}

function fetchTransactionsPage(config, { start_time, end_time, account_ids, sort, group_filter, page_offset, page_size }) {
  const body = {
    query: {
      start_time,
      end_time,
      account_ids,
    },
    sort,
    page: {
      page_offset,
      page_size,
    },
  }

  if (group_filter) {
    body.group_filter = group_filter
  }

  return new Promise((resolve, reject) => {
    request.post(
      {
        url: 'https://yun.feidee.net/cab-query-ws/v2/statistics/transactions',
        headers: buildCommonHeaders(config),
        json: true,
        body,
      },
      (err, response, respBody) => {
        if (err) {
          reject(new Error(`飞笛 API 请求失败：${err.message}`))
          return
        }
        if (!response || response.statusCode !== 200) {
          reject(new Error(`飞笛 API 请求失败：${response?.statusCode || 'unknown error'}`))
          return
        }
        resolve(respBody || {})
      }
    )
  })
}

async function fetchAllTransactionsByQuery(config, { query, group_filter, page_size = 100, maxPages = 200 }) {
  const { start_time, end_time, account_ids } = query
  const records = []
  let offset = 0
  let pages = 0
  // 与接口 page_size 保持一致；通常每页 20~100 条，这里用 100 并在服务端聚合
  while (pages < maxPages) {
    const resp = await fetchTransactionsPage(config, {
      start_time,
      end_time,
      account_ids,
      group_filter,
      sort: { order_by: 'DESC', sort_by: 'ACCOUNT_TIME' },
      page_offset: offset,
      page_size,
    })
    const pageData = Array.isArray(resp.data) ? resp.data : []
    records.push(...pageData)
    const hasMore = Boolean(resp.paging && resp.paging.has_more)
    if (!hasMore || pageData.length === 0) break
    offset += page_size
    pages += 1
  }
  return records
}

function normalizeTransaction(record) {
  if (record?.business_type && record.business_type !== 'Expense') return null
  const id = String(record.id || '')
  const transactionTime = Number(record.transaction_time || 0)
  const expenseAmount = record.expense !== undefined ? Number(record.expense) : Number(record.amount)
  const amount = Number.isNaN(expenseAmount) ? 0 : Number(expenseAmount)
  if (amount <= 0) return null

  return {
    id,
    transaction_time: transactionTime,
    remark: String(record.remark || ''),
    category: record.category?.name ? String(record.category.name) : '',
    from_account: record.from_account?.name ? String(record.from_account.name) : '',
    amount,
  }
}

async function fetchTransactions(config, { startDate, endDate, categoryFilter }) {
  const accountIds = normalizeAccountIds(config.accountIds)
  const dateRange = getDateRangeTimeRange(startDate, endDate)

  // 如果指定了分类过滤，使用 group_filter 按分类查询
  if (categoryFilter && categoryFilter.group_key && categoryFilter.group_id) {
    const records = await fetchAllTransactionsByQuery(config, {
      query: {
        start_time: dateRange.start_time,
        end_time: dateRange.end_time,
        account_ids: accountIds,
        category_types: ['Expense'],
      },
      group_filter: categoryFilter,
    })
    return records
  }

  // 先尝试：只用 query 时间范围（不依赖 group_filter），以减少请求次数
  try {
    const records = await fetchAllTransactionsByQuery(config, {
      query: {
        start_time: dateRange.start_time,
        end_time: dateRange.end_time,
        account_ids: accountIds,
      },
      group_filter: null,
    })
    return records
  } catch (err) {
    // 兜底：若接口强依赖 group_filter，就按天循环请求并聚合
    const days = listDateStringsBetween(startDate, endDate)
    const map = new Map()
    for (const day of days) {
      const dayRange = getDayTimeRange(day)
      const group_filter = { group_key: 'TIME_DATE', group_id: day.replace(/-/g, '') }
      const records = await fetchAllTransactionsByQuery(config, {
        query: {
          start_time: dayRange.start_time,
          end_time: dayRange.end_time,
          account_ids: accountIds,
        },
        group_filter,
      })
      for (const rec of records) {
        const normalized = normalizeTransaction(rec)
        if (!normalized || !normalized.id) continue
        map.set(normalized.id, rec)
      }
    }
    return Array.from(map.values())
  }
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  const { OPENID } = ctx

  try {
    const { startDate, endDate, categoryFilter } = event || {}
    if (!OPENID) throw new Error('用户信息缺失')
    if (!isValidYmd(startDate) || !isValidYmd(endDate)) {
      throw new Error('日期格式不正确，应为 YYYY-MM-DD')
    }
    if (String(startDate) > String(endDate)) {
      throw new Error('开始日期不能晚于结束日期')
    }

    await checkWhitelistPermission(OPENID)

    const config = await getFeideeConfig(OPENID)
    if (!config || !config.authorization || !config.tradingEntity) {
      return { success: false, message: '未配置飞笛账号' }
    }

    const rawRecords = await fetchTransactions(config, { startDate, endDate, categoryFilter })
    const list = rawRecords
      .map(normalizeTransaction)
      .filter(Boolean)
      .filter((item) => item.id)
      .sort((a, b) => b.transaction_time - a.transaction_time)

    const totalAmount = list.reduce((sum, item) => sum + Number(item.amount || 0), 0)

    return {
      success: true,
      data: {
        totalAmount: Number(totalAmount.toFixed(2)),
        list,
      },
    }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '飞笛交易明细查询失败',
    }
  }
}

