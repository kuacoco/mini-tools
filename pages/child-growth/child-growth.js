const storage = require('../../utils/growth-storage')
const { getCurrentDateString } = require('../../utils/course-storage')
const { parseDate, ageMonths, ageLabel, numberText, timeline, makeChart, referencePosition } = require('../../utils/growth-model')
const newRequestId = () => `growth_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`

Page({
  data: {
    pageReady: false, loading: true, error: '', profiles: [], activeChild: null,
    records: [], timeline: [], visibleCount: 20, metric: 'height', range: 'recent', chart: null,
    latest: null, sheet: '', saving: false, formError: '', dirty: false,
    today: '', profileForm: { name: '', birthday: '', sex: 'boy' },
    recordForm: { date: '', height: '', weight: '', note: '' }, editingProfile: false, profileLocked: false,
  },
  onLoad() {
    this.setData({ today: getCurrentDateString() })
    this.refresh()
  },
  async refresh() {
    const version = this._refreshVersion = (this._refreshVersion || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const profiles = await storage.listProfiles()
      if (version !== this._refreshVersion) return
      this.setData({ profiles })
      const active = profiles.find(p => p.id === this.data.activeChild?.id) || profiles[0]
      if (active) await this.selectChild(active)
      else this.setData({ activeChild: null, records: [], timeline: [], chart: null })
    } catch (err) {
      if (version === this._refreshVersion) this.setData({ error: err.message || '档案读取失败，请重试' })
    } finally {
      if (version === this._refreshVersion) this.setData({ loading: false, pageReady: true })
    }
  },
  async selectChild(profile) {
    const version = this._recordsVersion = (this._recordsVersion || 0) + 1
    const child = { ...profile, initial: profile.name.slice(0, 1), ageText: ageLabel(ageMonths(profile.birthday, this.data.today)), sexText: profile.sex === 'boy' ? '男孩' : '女孩' }
    this.setData({ activeChild: child, loading: true, error: '', records: [], timeline: [], latest: null, chart: null, visibleCount: 20, range: 'recent' })
    try {
      const records = await storage.listRecords(profile.id)
      if (version !== this._recordsVersion) return
      this.updateRecords(records)
    } catch (err) {
      if (version === this._recordsVersion) this.setData({ error: err.message || '成长记录读取失败，请重试' })
    } finally {
      if (version === this._recordsVersion) this.setData({ loading: false })
    }
  },
  updateRecords(records) {
    const rows = timeline(records, this.data.activeChild)
    const latest = rows[0] ? { ...rows[0], heightPosition: referencePosition(this.data.activeChild, rows[0], 'height'), weightPosition: referencePosition(this.data.activeChild, rows[0], 'weight') } : null
    this.setData({ records, timeline: rows, latest, chart: makeChart(this.data.activeChild, records, this.data.metric, this.data.range) })
  },
  onSelectChild(e) {
    if (this.data.saving) return
    const child = this.data.profiles.find(p => p.id === e.currentTarget.dataset.id)
    if (child && child.id !== this.data.activeChild?.id) this.selectChild(child)
  },
  onRetry() { this.refresh() },
  onMetric(e) {
    const metric = e.currentTarget.dataset.metric
    if (!['height', 'weight'].includes(metric)) return
    this.setData({ metric, chart: makeChart(this.data.activeChild, this.data.records, metric, this.data.range) })
  },
  onRange(e) {
    const range = e.currentTarget.dataset.range
    this.setData({ range, chart: makeChart(this.data.activeChild, this.data.records, this.data.metric, range) })
  },
  onMore() { this.setData({ visibleCount: this.data.visibleCount + 20 }) },
  onAddChild() {
    this.setData({ sheet: 'profile', editingProfile: false, profileLocked: false, dirty: false, formError: '', profileForm: { name: '', birthday: '', sex: 'boy', requestId: newRequestId() } })
  },
  onEditChild() {
    if (!this.data.activeChild || this.data.loading || this.data.error) return
    this.setData({ sheet: 'profile', editingProfile: true, profileLocked: Boolean(this.data.activeChild.locked) || this.data.records.length > 0, dirty: false, formError: '', profileForm: { ...this.data.activeChild } })
  },
  onProfileInput(e) {
    this.setData({ 'profileForm.name': e.detail.value, dirty: true, formError: '' })
  },
  onBirthday(e) {
    if (this.data.profileLocked) return
    this.setData({ 'profileForm.birthday': e.detail.value, dirty: true, formError: '' })
  },
  onSex(e) {
    if (this.data.profileLocked) return
    this.setData({ 'profileForm.sex': e.currentTarget.dataset.sex, dirty: true, formError: '' })
  },
  async onSaveProfile() {
    if (this.data.saving) return
    const form = this.data.profileForm
    if (!form.name.trim() || !parseDate(form.birthday) || form.birthday > this.data.today) {
      this.setData({ formError: '请填写昵称，并选择不晚于今天的出生日期' }); return
    }
    this.setData({ saving: true, formError: '' })
    try {
      const result = await storage.saveProfile(form)
      const profiles = this.data.profiles.filter(p => p.id !== result.item.id).concat(result.item)
      this.setData({ profiles, sheet: '', dirty: false })
      await this.selectChild(result.item)
      wx.showToast({ title: '档案已保存', icon: 'success' })
    } catch (err) { this.setData({ formError: err.message || '档案保存失败，请重试' }) }
    finally { this.setData({ saving: false }) }
  },
  onAddRecord() {
    if (!this.data.activeChild || this.data.loading || this.data.error) return
    this.setData({ sheet: 'record', dirty: false, formError: '', recordForm: { date: this.data.today, height: '', weight: '', note: '', requestId: newRequestId() } })
  },
  onEditRecord(e) {
    const record = this.data.records.find(r => r.id === e.currentTarget.dataset.id)
    if (!record || this.data.loading) return
    this.setData({ sheet: 'record', dirty: false, formError: '', recordForm: { ...record, height: String(record.height), weight: String(record.weight), requestId: newRequestId() } })
  },
  onRecordInput(e) {
    const field = e.currentTarget.dataset.field
    if (!['height', 'weight', 'note'].includes(field)) return
    this.setData({ [`recordForm.${field}`]: e.detail.value, 'recordForm.requestId': newRequestId(), dirty: true, formError: '' })
  },
  onRecordDate(e) { this.setData({ 'recordForm.date': e.detail.value, 'recordForm.requestId': newRequestId(), dirty: true, formError: '' }) },
  onStep(e) {
    const { field, step } = e.currentTarget.dataset
    const current = this.data.recordForm[field]
    if (!['height', 'weight'].includes(field) || current === '' || !Number.isFinite(Number(current))) return
    const min = field === 'height' ? 20 : .5
    const next = Math.round((Number(current) + Number(step)) * 10) / 10
    if (next < min || next > 250) return
    this.setData({ [`recordForm.${field}`]: numberText(next), 'recordForm.requestId': newRequestId(), dirty: true, formError: '' })
  },
  async onSaveRecord() {
    if (this.data.saving) return
    const form = this.data.recordForm, child = this.data.activeChild
    const months = ageMonths(child.birthday, form.date)
    const validNumber = (value, min) => /^\d+(\.\d)?$/.test(value) && Number(value) >= min && Number(value) <= 250
    let error = ''
    if (!parseDate(form.date) || months === null || months > 216 || form.date > this.data.today) error = '测量日期须在出生至18周岁之间，且不能晚于今天'
    else if (!validNumber(form.height, 20)) error = '身高请输入20–250 cm，最多一位小数'
    else if (!validNumber(form.weight, .5)) error = '体重请输入0.5–250 kg，最多一位小数'
    else if (this.data.records.some(r => r.date === form.date && r.id !== form.id)) error = '当天已有记录，请在时间线中编辑'
    if (error) { this.setData({ formError: error }); return }
    this.setData({ saving: true, formError: '' })
    try {
      const result = await storage.saveRecord({ ...form, childId: child.id })
      this.setData({ 'activeChild.locked': true, profiles: this.data.profiles.map(p => p.id === child.id ? { ...p, locked: true } : p) })
      this.updateRecords(this.data.records.filter(r => r.id !== form.id && r.id !== result.item.id).concat(result.item))
      this.setData({ sheet: '', dirty: false })
      wx.showToast({ title: '成长已记录', icon: 'success' })
    } catch (err) { this.setData({ formError: err.message || '保存失败，内容已保留，请重试' }) }
    finally { this.setData({ saving: false }) }
  },
  async onDeleteRecord() {
    if (this.data.saving || !this.data.recordForm.id) return
    const form = this.data.recordForm
    const choice = await wx.showModal({ title: '删除这次记录？', content: `${form.date} 的身高体重记录将被删除，无法撤销。`, confirmText: '删除记录', confirmColor: '#B65F65', cancelText: '保留' })
    if (!choice.confirm) return
    this.setData({ saving: true, formError: '' })
    try {
      await storage.deleteRecord({ id: form.id, childId: this.data.activeChild.id, revision: form.revision })
      this.updateRecords(this.data.records.filter(r => r.id !== form.id))
      this.setData({ sheet: '', dirty: false })
      wx.showToast({ title: '记录已删除', icon: 'success' })
    } catch (err) { this.setData({ formError: err.message || '删除失败，请重试' }) }
    finally { this.setData({ saving: false }) }
  },
  async onCloseSheet() {
    if (this.data.saving) return
    if (this.data.dirty) {
      const result = await wx.showModal({ title: '放弃本次填写？', content: '尚未保存的内容会丢失。', cancelText: '继续填写', confirmText: '放弃填写' })
      if (!result.confirm) return
    }
    this.setData({ sheet: '', dirty: false, formError: '' })
  },
  onSource() { this.setData({ sheet: 'source', dirty: false }) },
  onCopySource() { wx.setClipboardData({ data: 'https://www.cdc.gov/growthcharts/cdc-data-files.htm' }) },
  stopTap() {},
})
