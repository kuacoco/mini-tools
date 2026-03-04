const STORAGE_KEY = 'budget_items_v1'

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function readAllBudgetData() {
  const data = wx.getStorageSync(STORAGE_KEY)
  if (!data || typeof data !== 'object') return {}
  return data
}

function writeAllBudgetData(data) {
  wx.setStorageSync(STORAGE_KEY, data)
}

function getMonthBudgetList(monthKey) {
  const allData = readAllBudgetData()
  const list = allData[monthKey]
  if (!Array.isArray(list)) return []
  return list
}

function addBudgetItem(monthKey, payload) {
  const allData = readAllBudgetData()
  const list = Array.isArray(allData[monthKey]) ? allData[monthKey] : []
  const newItem = {
    id: `b_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name: payload.name,
    totalAmount: Number(payload.totalAmount),
    usedAmount: 0,
    createdAt: Date.now(),
  }
  allData[monthKey] = [newItem, ...list]
  writeAllBudgetData(allData)
  return newItem
}

function updateUsedAmount(monthKey, id, usedAmount) {
  const allData = readAllBudgetData()
  const list = Array.isArray(allData[monthKey]) ? allData[monthKey] : []
  const nextList = list.map((item) => {
    if (item.id !== id) return item
    return {
      ...item,
      usedAmount: Number(usedAmount),
    }
  })
  allData[monthKey] = nextList
  writeAllBudgetData(allData)
}

function updateBudgetItem(monthKey, id, payload) {
  const allData = readAllBudgetData()
  const list = Array.isArray(allData[monthKey]) ? allData[monthKey] : []
  const nextList = list.map((item) => {
    if (item.id !== id) return item
    return {
      ...item,
      name: payload.name,
      totalAmount: Number(payload.totalAmount),
    }
  })
  allData[monthKey] = nextList
  writeAllBudgetData(allData)
}

function deleteBudgetItem(monthKey, id) {
  const allData = readAllBudgetData()
  const list = Array.isArray(allData[monthKey]) ? allData[monthKey] : []
  const nextList = list.filter((item) => item.id !== id)
  allData[monthKey] = nextList
  writeAllBudgetData(allData)
}

function getBudgetItem(monthKey, id) {
  const list = getMonthBudgetList(monthKey)
  return list.find((item) => item.id === id) || null
}

module.exports = {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  deleteBudgetItem,
  getBudgetItem,
}
