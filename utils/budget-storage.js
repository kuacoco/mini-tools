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

module.exports = {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  deleteBudgetItem,
  mergeBudgetItemsFromOcr,
}
