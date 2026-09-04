const PRIVILEGED_OPENID = 'o5Qxn17JK9Rx0v22YCXWvhVF4zwg'

async function isPrivilegedUser() {
  if (!wx.cloud || !wx.cloud.callFunction) return false

  try {
    const res = await wx.cloud.callFunction({
      name: 'budgetCrud',
      data: { action: 'getOpenId', payload: {} },
    })
    const result = res && res.result ? res.result : {}
    const openId =
      result.success && result.data && result.data.openId
        ? String(result.data.openId)
        : ''
    return openId === PRIVILEGED_OPENID
  } catch (err) {
    return false
  }
}

module.exports = {
  PRIVILEGED_OPENID,
  isPrivilegedUser,
}
