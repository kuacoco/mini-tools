const cloud = require('wx-server-sdk')
const { createService } = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const execute = createService(cloud.database())
exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    return { success: true, data: await execute(event.action, event.payload || {}, OPENID) }
  } catch (err) {
    // Infrastructure details are kept out of responses; validation errors are user-facing.
    const message = err.errCode || err.code ? '成长记录服务暂不可用，请稍后重试' : err.message || '操作失败，请重试'
    return { success: false, message }
  }
}
