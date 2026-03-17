function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function ensureCloudReady() {
  if (!wx.cloud || !wx.cloud.callFunction) {
    throw new Error('云开发未初始化')
  }
}

async function callBudgetCrud(action, payload = {}) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'budgetCrud',
    data: {
      action,
      payload,
    },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '预算服务异常')
  }
  return result.data
}

async function getMonthBudgetList(monthKey) {
  const data = await callBudgetCrud('listByMonth', { monthKey })
  return Array.isArray(data && data.list) ? data.list : []
}

async function addBudgetItem(monthKey, payload) {
  const data = await callBudgetCrud('upsertItem', {
    monthKey,
    name: payload.name,
    totalAmount: Number(payload.totalAmount),
    usedAmount: Number(payload.usedAmount || 0),
  })
  return data ? data.item : null
}

async function updateUsedAmount(monthKey, id, usedAmount) {
  await callBudgetCrud('updateUsedAmount', {
    monthKey,
    id,
    usedAmount: Number(usedAmount),
  })
}

async function updateBudgetItem(monthKey, id, payload) {
  await callBudgetCrud('upsertItem', {
    monthKey,
    id,
    name: payload.name,
    totalAmount: Number(payload.totalAmount),
  })
}

async function deleteBudgetItem(monthKey, id) {
  await callBudgetCrud('deleteItem', {
    monthKey,
    id,
  })
}

async function mergeBudgetItemsFromOcr(monthKey, records) {
  const data = await callBudgetCrud('mergeFromOcr', {
    monthKey,
    records,
  })
  return data || { created: 0, updated: 0, skipped: 0 }
}

async function syncBudgetFromFeidee(monthKey) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'syncFeideeBudget',
    data: { monthKey },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '飞笛同步服务异常')
  }
  return result.data || { created: 0, updated: 0, skipped: 0 }
}

async function checkWhitelist() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'budgetCrud',
    data: { action: 'checkWhitelist', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  return result.success && result.data && result.data.isWhitelisted === true
}

async function isAdmin() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'checkPermission', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  return result.success && result.data && result.data.isAdmin === true
}

async function getFeideeConfig(userId) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'getFeideeConfig', payload: { userId } },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '获取配置失败')
  }
  return result.data || {}
}

async function listFeideeConfig() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'listFeideeConfig', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '获取配置列表失败')
  }
  return result.data && Array.isArray(result.data.list) ? result.data.list : []
}

async function updateFeideeConfig(userId, authorization, accountIds, tradingEntity) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'updateFeideeConfig', payload: { userId, authorization, accountIds, tradingEntity } },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '更新配置失败')
  }
  return result.data
}

async function deleteFeideeConfig(id) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'deleteFeideeConfig', payload: { id } },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '删除配置失败')
  }
  return result.data
}

async function listWhitelist() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'listWhitelist', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '获取白名单失败')
  }
  return result.data && Array.isArray(result.data.list) ? result.data.list : []
}

async function addWhitelist(openid, nickname = '') {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'addWhitelist', payload: { openid, nickname } },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '添加白名单失败')
  }
  return result.data
}

async function removeWhitelist(id) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'adminCrud',
    data: { action: 'removeWhitelist', payload: { id } },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '删除白名单失败')
  }
  return result.data
}

async function incrementSubscribe() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'budgetCrud',
    data: { action: 'incrementSubscribe', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '增加订阅次数失败')
  }
  return result.data
}

async function getSubscribeCount() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'budgetCrud',
    data: { action: 'getSubscribeCount', payload: {} },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    return { count: 0 }
  }
  return result.data || { count: 0 }
}

async function syncAllFeideeUsers() {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'syncFeideeBudget',
    data: { action: 'syncAll' },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '同步失败')
  }
  return result.data
}

module.exports = {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  deleteBudgetItem,
  mergeBudgetItemsFromOcr,
  syncBudgetFromFeidee,
  checkWhitelist,
  isAdmin,
  getFeideeConfig,
  listFeideeConfig,
  updateFeideeConfig,
  deleteFeideeConfig,
  listWhitelist,
  addWhitelist,
  removeWhitelist,
  incrementSubscribe,
  getSubscribeCount,
  syncAllFeideeUsers,
}
