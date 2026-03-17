const { listFeideeConfig, updateFeideeConfig, deleteFeideeConfig, listWhitelist, addWhitelist, removeWhitelist, syncAllFeideeUsers } = require('../../utils/budget-storage')

Page({
  data: {
    // 飞笛配置列表
    feideeConfigs: [],
    // 白名单
    whitelist: [],
    // 状态
    loading: true,
    saving: false,
    syncing: false,
    // 添加飞笛配置弹窗
    showFeideePopup: false,
    editingFeideeId: '',
    feideeUserId: '',
    feideeAuthorization: '',
    feideeAccountIds: '',
    feideeTradingEntity: '',
    // 添加白名单弹窗
    showAddPopup: false,
    newOpenid: '',
    newNickname: ''
  },

  async onLoad() {
    await this.loadAllData()
  },

  async loadAllData() {
    try {
      const [feideeConfigs, whitelist] = await Promise.all([
        listFeideeConfig(),
        listWhitelist()
      ])
      this.setData({
        feideeConfigs,
        whitelist,
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

  // 白名单管理
  onOpenAddPopup() {
    this.setData({
      showAddPopup: true,
      newOpenid: '',
      newNickname: ''
    })
  },

  onCloseAddPopup() {
    this.setData({ showAddPopup: false })
  },

  onNewOpenidInput(e) {
    this.setData({ newOpenid: e.detail.value })
  },

  onNewNicknameInput(e) {
    this.setData({ newNickname: e.detail.value })
  },

  async onConfirmAdd() {
    const { newOpenid, newNickname } = this.data
    const openid = newOpenid.trim()
    if (!openid) {
      wx.showToast({ title: '请输入 OpenID', icon: 'none' })
      return
    }

    try {
      const item = await addWhitelist(openid, newNickname.trim())
      this.setData({
        showAddPopup: false,
        whitelist: [item, ...this.data.whitelist]
      })
      wx.showToast({ title: '添加成功', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    }
  },

  async onRemoveWhitelist(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.whitelist.find(w => w.id === id)
    if (!item) return

    wx.showModal({
      title: '删除确认',
      content: `确定要删除用户 "${item.nickname || item.openid}" 吗？`,
      confirmColor: '#d06d7f',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await removeWhitelist(id)
          this.setData({
            whitelist: this.data.whitelist.filter(w => w.id !== id)
          })
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        }
      }
    })
  },

  async onSyncAllUsers() {
    wx.showModal({
      title: '同步确认',
      content: '确定要同步所有白名单用户的飞笛数据吗？这将发送订阅消息通知用户。',
      success: async (res) => {
        if (!res.confirm) return

        this.setData({ syncing: true })
        wx.showLoading({ title: '同步中...', mask: true })

        try {
          const results = await syncAllFeideeUsers()
          wx.hideLoading()
          this.setData({ syncing: false })

          const { total, success, failed, skipped } = results
          wx.showModal({
            title: '同步完成',
            content: `总计: ${total} 用户\n成功: ${success}\n失败: ${failed}\n跳过: ${skipped}`,
            showCancel: false
          })
        } catch (err) {
          wx.hideLoading()
          this.setData({ syncing: false })
          wx.showToast({ title: err.message || '同步失败', icon: 'none' })
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