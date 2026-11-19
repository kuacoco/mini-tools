const crypto = require('crypto')
const PROFILES = 'growth_profiles'
const RECORDS = 'growth_measurements'

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error('请选择有效日期')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('请选择有效日期')
  return value
}
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }
function numberValue(value, min, max, label) {
  if (!/^\d+(\.\d)?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${label}请输入${min}–${max}之间的数值，最多一位小数`)
  return Number(value)
}
function safeProfile(doc) { return { id: doc._id, name: doc.name, birthday: doc.birthday, sex: doc.sex, locked: Boolean(doc.locked), revision: doc.revision } }
function safeRecord(doc) { return { id: doc._id, date: doc.date, height: doc.height, weight: doc.weight, note: doc.note || '', revision: doc.revision } }
function recordId(openid, childId, date) { return crypto.createHash('sha256').update(`${openid}:${childId}:${date}`).digest('hex') }

function createService(db) {
  async function ownedProfile(id, openid) {
    if (!id || typeof id !== 'string') throw new Error('请先选择孩子')
    const res = await db.collection(PROFILES).where({ _id: id, openid }).limit(1).get()
    if (!res.data.length) throw new Error('孩子档案不存在或无权访问')
    return res.data[0]
  }
  async function ownedRecord(id, openid, childId) {
    const res = await db.collection(RECORDS).where({ _id: id, openid, childId }).limit(1).get()
    if (!res.data.length) throw new Error('记录不存在或无权访问')
    return res.data[0]
  }
  return async function execute(action, payload, openid) {
    if (!openid) throw new Error('请先登录小程序')
    switch (action) {
      case 'listProfiles': {
        const res = await db.collection(PROFILES).where({ openid }).orderBy('createdAt', 'asc').limit(100).get()
        return { list: res.data.map(safeProfile) }
      }
      case 'saveProfile': {
        const name = String(payload.name || '').trim()
        if (!name || name.length > 20) throw new Error('昵称请填写1–20个字')
        const birthday = dateValue(payload.birthday)
        if (birthday > today()) throw new Error('出生日期不能晚于今天')
        if (!['boy', 'girl'].includes(payload.sex)) throw new Error('请选择用于参考曲线的性别')
        const old = payload.id ? await ownedProfile(payload.id, openid) : null
        if (!old) {
          const count = await db.collection(PROFILES).where({ openid }).count()
          if (count.total >= 20) throw new Error('最多可建立20个孩子档案')
        }
        // Birthday and sex are locked after a first measurement to preserve reference interpretation.
        if (old && (old.birthday !== birthday || old.sex !== payload.sex)) {
          const count = await db.collection(RECORDS).where({ openid, childId: old._id }).count()
          if (count.total) throw new Error('已有成长记录，出生日期和性别不可修改；仍可修改昵称')
        }
        const id = old ? old._id : String(payload.requestId || '')
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('请求标识无效，请重新打开表单')
        await db.runTransaction(async tx => {
          const ref = tx.collection(PROFILES).doc(id)
          let current
          try { current = (await ref.get()).data } catch (error) {
            if (!String(error.errMsg || error.message).match(/not exist|not found|不存在/i)) throw error
          }
          if (current && current.openid !== openid) throw new Error('无权修改此档案')
          if (current?.locked && (current.birthday !== birthday || current.sex !== payload.sex)) throw new Error('已有成长记录，出生日期和性别不可修改；仍可修改昵称')
          if (old && (!current || current.revision !== payload.revision)) throw new Error('档案已更新，请刷新后重试')
          // Idempotent create request: a retry returns the originally created profile.
          if (!old && current) return
          await ref.set({ data: { openid, name, birthday, sex: payload.sex, revision: (current?.revision || 0) + 1, locked: Boolean(current?.locked), createdAt: current?.createdAt || Date.now(), updatedAt: Date.now() } })
        })
        return { item: safeProfile(await ownedProfile(id, openid)) }
      }
      case 'listRecords': {
        await ownedProfile(payload.childId, openid)
        const where = { openid, childId: payload.childId }
        if (payload.cursor) where.date = db.command.lt(dateValue(payload.cursor))
        const res = await db.collection(RECORDS).where(where).orderBy('date', 'desc').limit(100).get()
        return { list: res.data.map(safeRecord), cursor: res.data.length === 100 ? res.data[99].date : '' }
      }
      case 'saveRecord': {
        const child = await ownedProfile(payload.childId, openid)
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(payload.requestId || ''))) throw new Error('请求标识无效，请重新打开表单')
        const date = dateValue(payload.date)
        if (date < child.birthday || date > today()) throw new Error('测量日期须在出生日期与今天之间')
        const [birthYear, birthMonth, birthDay] = child.birthday.split('-').map(Number)
        const lastDay = new Date(Date.UTC(birthYear + 18, birthMonth, 0)).getUTCDate()
        const eighteenthBirthday = `${birthYear + 18}-${String(birthMonth).padStart(2, '0')}-${String(Math.min(birthDay, lastDay)).padStart(2, '0')}`
        if (date > eighteenthBirthday) throw new Error('本模块记录范围为出生至18周岁')
        const height = numberValue(payload.height, 20, 250, '身高')
        const weight = numberValue(payload.weight, 0.5, 250, '体重')
        const note = String(payload.note || '').trim()
        if (note.length > 100) throw new Error('备注最多100个字')
        const id = recordId(openid, child._id, date)
        const retry = await db.collection(RECORDS).where({ _id: id, openid, childId: child._id }).limit(1).get()
        if (retry.data[0]?.requestId === payload.requestId && retry.data[0].revision === Number(payload.revision || 0) + 1) return { item: safeRecord(retry.data[0]) }
        const old = payload.id ? await ownedRecord(payload.id, openid, child._id) : null
        await db.runTransaction(async tx => {
          const childRef = tx.collection(PROFILES).doc(child._id)
          const currentChild = (await childRef.get()).data
          if (!currentChild || currentChild.openid !== openid || currentChild.revision !== child.revision) throw new Error('档案已更新，请刷新后重试')
          if (!currentChild.locked) await childRef.update({ data: { locked: true } })
          const target = tx.collection(RECORDS).doc(id)
          let current
          try { current = (await target.get()).data } catch (error) {
            if (!String(error.errMsg || error.message).match(/not exist|not found|不存在/i)) throw error
          }
          if (current && (!old || old._id !== id)) {
            // Same request retried after a connection loss is safe, but a new same-day record is not silently overwritten.
            if (current.requestId === payload.requestId && current.openid === openid) return
            throw new Error('当天已有记录，请在时间线中编辑')
          }
          if (current && current.openid === openid && current.requestId === payload.requestId && current.revision === Number(payload.revision || 0) + 1) return
          if (old) {
            const original = old._id === id ? current : (await tx.collection(RECORDS).doc(old._id).get()).data
            if (!original || original.openid !== openid || original.revision !== payload.revision) throw new Error('记录已更新，请刷新后重试')
            if (old._id !== id) await tx.collection(RECORDS).doc(old._id).remove()
          }
          await target.set({ data: { openid, childId: child._id, date, height, weight, note, requestId: payload.requestId, revision: (old?.revision || 0) + 1, createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() } })
        })
        return { item: safeRecord(await ownedRecord(id, openid, child._id)) }
      }
      case 'deleteRecord': {
        await ownedProfile(payload.childId, openid)
        const old = await ownedRecord(payload.id, openid, payload.childId)
        await db.runTransaction(async tx => {
          const ref = tx.collection(RECORDS).doc(old._id)
          const current = (await ref.get()).data
          if (!current || current.openid !== openid || current.revision !== payload.revision) throw new Error('记录已更新，请刷新后重试')
          await ref.remove()
        })
        return { deleted: true }
      }
      default: throw new Error('不支持的操作')
    }
  }
}
module.exports = { createService, dateValue, numberValue, recordId }
