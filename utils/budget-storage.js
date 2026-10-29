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
    parentCategoryName: payload.parentCategoryName,
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
    parentCategoryName: payload.parentCategoryName,
    name: payload.name,
    totalAmount: Number(payload.totalAmount),
  })
}

async function renameParentCategory(monthKey, oldName, nextName) {
  return callBudgetCrud('renameParentCategory', {
    monthKey,
    oldName,
    nextName,
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

async function getPublicBudgetConfig() {
  const data = await callBudgetCrud('getPublicBudgetConfig', {})
  return data || {}
}

async function fetchFeideeTransactions(startDate, endDate, categoryFilter) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'feideeTransactions',
    data: { startDate, endDate, categoryFilter },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '获取飞笛交易明细失败')
  }
  return result.data || { totalAmount: 0, list: [] }
}

async function fetchFeideeCategoryExpense(startDate, endDate) {
  ensureCloudReady()
  const res = await wx.cloud.callFunction({
    name: 'feideeCategoryExpense',
    data: { startDate, endDate },
  })
  const result = res && res.result ? res.result : {}
  if (!result.success) {
    throw new Error(result.message || '获取分类支出失败')
  }
  return result.data || { totalAmount: 0, sections: [] }
}

async function copyBudgetFromMonth(sourceMonthKey, targetMonthKey) {
  const data = await callBudgetCrud('copyFromMonth', {
    sourceMonthKey,
    targetMonthKey,
  })
  return data || { created: 0, skipped: 0 }
}

module.exports = {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  renameParentCategory,
  deleteBudgetItem,
  mergeBudgetItemsFromOcr,
  syncBudgetFromFeidee,
  isAdmin,
  getFeideeConfig,
  listFeideeConfig,
  updateFeideeConfig,
  deleteFeideeConfig,
  getPublicBudgetConfig,
  fetchFeideeTransactions,
  fetchFeideeCategoryExpense,
  copyBudgetFromMonth,
}
