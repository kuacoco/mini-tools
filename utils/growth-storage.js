async function callGrowthCrud(action, payload = {}) {
  if (!wx.cloud?.callFunction) throw new Error('云开发未初始化，请重新打开小程序')
  let timer
  let res
  try {
    res = await Promise.race([
      wx.cloud.callFunction({ name: 'growthCrud', data: { action, payload } }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('请求超时')), 15000) }),
    ])
  } catch (_) {
    throw new Error('暂时无法连接成长记录服务，请检查网络后重试')
  } finally { clearTimeout(timer) }
  if (!res.result?.success) throw new Error(res.result?.message || '成长记录服务暂不可用')
  return res.result.data
}
async function listProfiles() { return (await callGrowthCrud('listProfiles')).list || [] }
async function listRecords(childId) {
  let cursor = '', list = []
  do {
    const result = await callGrowthCrud('listRecords', { childId, cursor })
    list = list.concat(result.list || [])
    if (result.cursor && result.cursor === cursor) throw new Error('记录读取未完成，请重试')
    cursor = result.cursor || ''
  } while (cursor)
  return list
}
module.exports = {
  listProfiles, listRecords,
  saveProfile: payload => callGrowthCrud('saveProfile', payload),
  saveRecord: payload => callGrowthCrud('saveRecord', payload),
  deleteRecord: payload => callGrowthCrud('deleteRecord', payload),
}
