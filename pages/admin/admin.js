const {
  listFeideeConfig,
  updateFeideeConfig,
  deleteFeideeConfig,
} = require('../../utils/budget-storage')

Page({
  data: {
    // 飞笛配置列表
    feideeConfigs: [],
    // 状态
    loading: true,
    saving: false,
    // 添加飞笛配置弹窗
    showFeideePopup: false,
    editingFeideeId: '',
    feideeUserId: '',
    feideeAuthorization: '',
    feideeAccountIds: '',
    feideeTradingEntity: '',
  },

  async onLoad() {
    await this.loadAllData()
  },

  async loadAllData() {
    try {
      const feideeConfigs = await listFeideeConfig()
      this.setData({
        feideeConfigs,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({
        title: err.message || '加载失败',
        icon: 'none'
      })
    }
  },

  // 飞笛配置管理
  onOpenFeideePopup(e) {
    const { id } = e.currentTarget.dataset
    if (id) {
      // 编辑模式
      const item = this.data.feideeConfigs.find(c => c.id === id)
      if (item) {
        this.setData({
          showFeideePopup: true,
          editingFeideeId: id,
          feideeUserId: item.userId,
          feideeAuthorization: item.authorization,
          feideeAccountIds: item.accountIds,
          feideeTradingEntity: item.tradingEntity || ''
        })
        return
      }
    }
    // 新增模式
    this.setData({
      showFeideePopup: true,
      editingFeideeId: '',
      feideeUserId: '',
      feideeAuthorization: '',
      feideeAccountIds: '',
      feideeTradingEntity: ''
    })
  },

  onCloseFeideePopup() {
    this.setData({ showFeideePopup: false })
  },

  onFeideeUserIdInput(e) {
    this.setData({ feideeUserId: e.detail.value })
  },

  onFeideeAuthorizationInput(e) {
    this.setData({ feideeAuthorization: e.detail.value })
  },

  onFeideeAccountIdsInput(e) {
    this.setData({ feideeAccountIds: e.detail.value })
  },

  onFeideeTradingEntityInput(e) {
    this.setData({ feideeTradingEntity: e.detail.value })
  },

  async onSaveFeideeConfig() {
    const { feideeUserId, feideeAuthorization, feideeAccountIds, feideeTradingEntity, editingFeideeId, saving } = this.data
    if (saving) return

    const userId = feideeUserId.trim()
    if (!userId) {
      wx.showToast({ title: '请输入用户标识', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    try {
      await updateFeideeConfig(userId, feideeAuthorization.trim(), feideeAccountIds.trim(), feideeTradingEntity.trim())
      await this.loadAllData()
      this.setData({ showFeideePopup: false })
      wx.showToast({ title: '保存成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
    this.setData({ saving: false })
  },

  async onDeleteFeideeConfig(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.feideeConfigs.find(c => c.id === id)
    if (!item) return

    wx.showModal({
      title: '删除确认',
      content: `确定要删除用户 "${item.userId}" 的配置吗？`,
      confirmColor: '#d06d7f',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteFeideeConfig(id)
          this.setData({
            feideeConfigs: this.data.feideeConfigs.filter(c => c.id !== id)
          })
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '管理后台',
      path: '/pages/admin/admin'
    }
  },

  noop() {}
})
