const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_COLLECTION = 'budget_config'
const WHITELIST_COLLECTION = 'budget_whitelist'
const ADMIN_OPENID = 'o5Qxn17JK9Rx0v22YCXWvhVF4zwg'

async function checkPermission(openid) {
  if (openid !== ADMIN_OPENID) {
    throw new Error('无管理权限')
  }
}

async function getFeideeConfig(payload) {
  const { userId } = payload || {}
  if (!userId) {
    return {}
  }
  try {
    const res = await db.collection(CONFIG_COLLECTION)
      .where({ userId })
      .limit(1)
      .get()
    const list = res.data || []
    return list.length > 0 ? list[0] : {}
  } catch (err) {
    return {}
  }
}

async function listFeideeConfig() {
  const res = await db.collection(CONFIG_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .get()
  return {
    list: (res.data || []).map(item => ({
      id: item._id,
      userId: item.userId || '',
      authorization: item.authorization || '',
      accountIds: item.accountIds || '',
      tradingEntity: item.tradingEntity || '',
      createdAt: item.createdAt || 0,
      updatedAt: item.updatedAt || 0
    }))
  }
}

async function updateFeideeConfig(payload) {
  const { userId, authorization, accountIds, tradingEntity } = payload
  if (!userId) {
    throw new Error('用户标识不能为空')
  }
  const now = Date.now()
  const data = {
    userId,
    authorization: String(authorization || '').trim(),
    accountIds: String(accountIds || '').trim(),
    tradingEntity: String(tradingEntity || '').trim(),
    updatedAt: now
  }

  // 查找是否已存在该用户的配置
  const existRes = await db.collection(CONFIG_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  const existList = existRes.data || []

  if (existList.length > 0) {
    await db.collection(CONFIG_COLLECTION)
      .doc(existList[0]._id)
      .update({ data })
  } else {
    data.createdAt = now
    await db.collection(CONFIG_COLLECTION).add({ data })
  }

  return { ok: true }
}

async function deleteFeideeConfig(payload) {
  const { id } = payload
  if (!id) {
    throw new Error('配置ID不能为空')
  }
  await db.collection(CONFIG_COLLECTION).doc(id).remove()
  return { ok: true }
}

async function checkAdminPermission(openid) {
  return { isAdmin: openid === ADMIN_OPENID }
}

async function listWhitelist() {
  const res = await db.collection(WHITELIST_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get()
  const list = (res.data || []).map(item => ({
    id: item._id,
    openid: item.openid,
    nickname: item.nickname || '',
    createdAt: item.createdAt || 0
  }))
  return { list }
}

async function addWhitelist(payload, openid) {
  const targetOpenid = String(payload.openid || '').trim()
  const nickname = String(payload.nickname || '').trim()
  if (!targetOpenid) {
    throw new Error('openid 不能为空')
  }
  // 检查是否已存在
  const existRes = await db.collection(WHITELIST_COLLECTION)
    .where({ openid: targetOpenid })
    .limit(1)
    .get()
  if (existRes.data && existRes.data.length > 0) {
    throw new Error('该用户已在白名单中')
  }
  const now = Date.now()
  const addRes = await db.collection(WHITELIST_COLLECTION).add({
    data: {
      openid: targetOpenid,
      nickname,
      createdAt: now,
      createdBy: openid
    }
  })
  return { id: addRes._id, openid: targetOpenid, nickname, createdAt: now }
}

async function removeWhitelist(payload) {
  const id = payload.id
  if (!id) {
    throw new Error('id 不能为空')
  }
  await db.collection(WHITELIST_COLLECTION).doc(id).remove()
  return { ok: true }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { action, payload } = event

  try {
    let data = null
    switch (action) {
      case 'checkPermission':
        data = await checkAdminPermission(OPENID)
        break
      case 'getFeideeConfig':
        await checkPermission(OPENID)
        data = await getFeideeConfig(payload || {})
        break
      case 'listFeideeConfig':
        await checkPermission(OPENID)
        data = await listFeideeConfig()
        break
      case 'updateFeideeConfig':
        await checkPermission(OPENID)
        data = await updateFeideeConfig(payload || {})
        break
      case 'deleteFeideeConfig':
        await checkPermission(OPENID)
        data = await deleteFeideeConfig(payload || {})
        break
      case 'listWhitelist':
        await checkPermission(OPENID)
        data = await listWhitelist()
        break
      case 'addWhitelist':
        await checkPermission(OPENID)
        data = await addWhitelist(payload || {}, OPENID)
        break
      case 'removeWhitelist':
        await checkPermission(OPENID)
        data = await removeWhitelist(payload || {})
        break
      default:
        throw new Error('不支持的 action')
    }

    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : '管理操作执行失败'
    }
  }
}