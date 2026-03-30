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
      device_id: 'feideeCategoryExpense-device',
      platform: 'iPhone',
      model: 'iPhone17,2',
      os_version: '26.3.1',
      product_version: '13.2.41',
      product_name: 'MyMoney',
    }),
  }
}

function fetchCategoryExpense(config, { start_time, end_time, account_ids }) {
  return new Promise((resolve, reject) => {
    request.post(
      {
        url: 'https://yun.feidee.net/cab-query-ws/v2/statistics/rollup-groups',
        headers: buildCommonHeaders(config),
        json: true,
        body: {
          group: { group_by: 'CATEGORY_SECOND', show_all: true },
          query: {
            account_ids,
            start_time,
            end_time,
            category_types: ['Expense'],
          },
          sort: { order_by: 'DESC', sort_by: 'EXPENSE' },
          measures: ['EXPENSE'],
        },
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

function buildSections(rawData) {
  const data = Array.isArray(rawData) ? rawData : []
  let totalAmount = 0

  const sections = data
    .filter((parent) => {
      const parentExpense = parent.metric_data?.find((m) => m.key === 'EXPENSE')
      return parentExpense && Number(parentExpense.value) > 0
    })
    .map((parent) => {
      const parentExpense = parent.metric_data.find((m) => m.key === 'EXPENSE')
      const parentAmount = Number(parentExpense?.value || 0)
      totalAmount += parentAmount

      const children = (parent.children || [])
        .filter((child) => {
          const childExpense = child.metric_data?.find((m) => m.key === 'EXPENSE')
          return childExpense && Number(childExpense.value) > 0
        })
        .map((child) => {
          const childExpense = child.metric_data.find((m) => m.key === 'EXPENSE')
          const childAmount = Number(childExpense?.value || 0)
          return {
            group_id: child.group_id,
            group_name: child.group_name,
            expense: childAmount,
            expenseText: formatAmount(childAmount),
            icon: child.icon || null,
          }
        })
        .sort((a, b) => b.expense - a.expense)

      return {
        group_id: parent.group_id,
        group_name: parent.group_name,
        total: parentAmount,
        totalText: formatAmount(parentAmount),
        icon: parent.icon || null,
        children,
        collapsed: false,
      }
    })
    .sort((a, b) => b.total - a.total)

  return { totalAmount, sections }
}

function formatAmount(amount) {
  const n = Number(amount) || 0
  return n.toFixed(2).replace(/\.?0+$/, '')
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  const { OPENID } = ctx

  try {
    const { startDate, endDate } = event || {}
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

    const accountIds = normalizeAccountIds(config.accountIds)
    const timeRange = getDateRangeTimeRange(startDate, endDate)

    const resp = await fetchCategoryExpense(config, {
      start_time: timeRange.start_time,
      end_time: timeRange.end_time,
      account_ids: accountIds,
    })

    const { totalAmount, sections } = buildSections(resp.data)

    return {
      success: true,
      data: {
        totalAmount: Number(totalAmount.toFixed(2)),
        totalAmountText: formatAmount(totalAmount),
        sections,
      },
    }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '飞笛分类支出查询失败',
    }
  }
}