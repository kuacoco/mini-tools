const {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  deleteBudgetItem,
  mergeBudgetItemsFromOcr,
} = require('../../utils/budget-storage')
const { formatAmount } = require('../../utils/amount-expression')

const COLOR_PALETTE = [
  { main: '#f4a7b9', light: '#fde7ed' },
  { main: '#f5b97f', light: '#fff0e2' },
  { main: '#8ec5a4', light: '#e3f3ea' },
  { main: '#8fb6f9', light: '#e7efff' },
  { main: '#bba3f2', light: '#f1ecfe' },
  { main: '#7fcad1', light: '#e3f6f7' },
]

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  return `${year}年${Number(month)}月`
}

function getOffsetMonthKey(monthKey, offset) {
  const [year, month] = monthKey.split('-')
  const date = new Date(Number(year), Number(month) - 1 + offset, 1)
  return getCurrentMonthKey(date)
}

const SWIPE_EDIT_WIDTH = 82
const SWIPE_DELETE_WIDTH = 82
const SWIPE_OPEN_THRESHOLD = 38
const POPUP_ANIMATION_MS = 240
const FAB_MENU_ANIMATION_MS = 180

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

function chooseOneImage() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file =
          res &&
            Array.isArray(res.tempFiles) &&
            res.tempFiles.length > 0
            ? res.tempFiles[0]
            : null
        if (!file || !file.tempFilePath) {
          reject(new Error('未选择图片'))
          return
        }
        resolve(file.tempFilePath)
      },
      fail: (err) => reject(err),
    })
  })
}

function uploadImageToCloud(tempFilePath) {
  const extMatch = tempFilePath.match(/\.[a-zA-Z0-9]+$/)
  const ext = extMatch ? extMatch[0] : '.jpg'
  const cloudPath = `budget-import/${Date.now()}_${Math.floor(
    Math.random() * 10000
  )}${ext}`
  return wx.cloud.uploadFile({
    cloudPath,
    filePath: tempFilePath,
  })
}

Page({
  data: {
    monthKey: '',
    monthLabel: '',
    budgetList: [],
    totalBudgetText: '0',
    totalUsedText: '0',
    remainText: '0',
    showFabMenu: false,
    fabMenuClosing: false,
    showAddPopup: false,
    addPopupClosing: false,
    addPopupMode: 'add',
    addPopupTitle: '新增预算项',
    addName: '',
    addTotalAmount: '',
    addAmountFormula: '',
    addKeyboardReset: 0,
    addInitialExpression: '0',
    editingBudgetId: '',
    showUsedPopup: false,
    usedPopupClosing: false,
    usedItemId: '',
    usedItemName: '',
    usedItemTotalText: '0',
    usedInput: '0',
    usedAmountFormula: '',
    usedKeyboardReset: 0,
    usedInitialExpression: '0',
  },

  onLoad() {
    const monthKey = getCurrentMonthKey()
    this.setData({
      monthKey,
      monthLabel: getMonthLabel(monthKey),
    })
  },

  onUnload() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    if (this.usedPopupTimer) clearTimeout(this.usedPopupTimer)
    if (this.fabMenuTimer) clearTimeout(this.fabMenuTimer)
  },

  async onShow() {
    await this.refreshBudgetList()
  },

  async refreshBudgetList() {
    const { monthKey } = this.data
    let list = []
    try {
      list = await getMonthBudgetList(monthKey)
    } catch (err) {
      wx.showToast({ title: '预算数据加载失败', icon: 'none' })
      return
    }
    let totalBudget = 0
    let totalUsed = 0
    const decorated = list.map((item, index) => {
      const total = Number(item.totalAmount || 0)
      const used = Number(item.usedAmount || 0)
      const rawPercent = total <= 0 ? 0 : (used / total) * 100
      const percent = Math.max(0, Math.min(100, rawPercent))
      const remain = total - used
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length]
      totalBudget += total
      totalUsed += used
      return {
        ...item,
        usedText: formatAmount(used),
        totalText: formatAmount(total),
        remainText: formatAmount(remain),
        percentText: `${Math.round(rawPercent)}%`,
        barWidth: `${percent}%`,
        barColor: color.main,
        trackColor: color.light,
        isOver: remain < 0,
        offsetX: 0,
      }
    })

    const remain = totalBudget - totalUsed
    this.setData({
      budgetList: decorated,
      totalBudgetText: formatAmount(totalBudget),
      totalUsedText: formatAmount(totalUsed),
      remainText: formatAmount(remain),
    })
  },

  onToggleFabMenu() {
    if (this.data.showFabMenu && !this.data.fabMenuClosing) {
      this.closeFabMenu()
      return
    }
    if (this.fabMenuTimer) clearTimeout(this.fabMenuTimer)
    this.setData({
      showFabMenu: true,
      fabMenuClosing: false,
    })
  },

  closeFabMenu(options = {}) {
    const { afterClose } = options
    if (!this.data.showFabMenu) {
      if (typeof afterClose === 'function') afterClose()
      return
    }
    if (this.fabMenuTimer) clearTimeout(this.fabMenuTimer)
    this.setData({ fabMenuClosing: true })
    this.fabMenuTimer = setTimeout(() => {
      this.setData({
        showFabMenu: false,
        fabMenuClosing: false,
      })
      if (typeof afterClose === 'function') afterClose()
    }, FAB_MENU_ANIMATION_MS)
  },

  onOpenAddPopup() {
    this.closeFabMenu({
      afterClose: () => this.openAddPopup(),
    })
  },

  openAddPopup() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    this.setData({
      showAddPopup: true,
      addPopupClosing: false,
      addPopupMode: 'add',
      addPopupTitle: '新增预算项',
      addName: '',
      addTotalAmount: '0',
      addAmountFormula: '',
      addKeyboardReset: Date.now(),
      addInitialExpression: '0',
      editingBudgetId: '',
    })
  },

  onBudgetTap(e) {
    const id = e.currentTarget.dataset.id
    const { budgetList } = this.data
    const target = budgetList.find((item) => item.id === id)
    if (target && target.offsetX) {
      this.resetAllOffsets()
      return
    }
    const item = target || null
    if (!item) {
      wx.showToast({ title: '预算项不存在', icon: 'none' })
      return
    }
    if (this.usedPopupTimer) clearTimeout(this.usedPopupTimer)
    const usedInitial = formatAmount(item.usedAmount)
    this.setData({
      showUsedPopup: true,
      usedPopupClosing: false,
      usedItemId: id,
      usedItemName: item.name,
      usedItemTotalText: formatAmount(item.totalAmount),
      usedInput: usedInitial,
      usedAmountFormula: '',
      usedKeyboardReset: Date.now(),
      usedInitialExpression: usedInitial,
    })
  },

  onClosePopup() {
    if (this.data.showFabMenu) {
      this.closeFabMenu()
      return
    }
    if (this.data.showUsedPopup) {
      this.closeUsedPopup()
      return
    }
    if (this.data.showAddPopup) {
      this.closeAddPopup()
    }
  },

  onAddNameInput(e) {
    this.setData({ addName: e.detail.value })
  },

  async onSaveBudgetItem() {
    vibrateLight()
    const mode = this.data.addPopupMode
    const name = (this.data.addName || '').trim()
    const total = Number(this.data.addTotalAmount)
    if (!name) {
      wx.showToast({ title: '请输入预算名称', icon: 'none' })
      return
    }
    if (!total || total <= 0) {
      wx.showToast({ title: '请输入有效预算金额', icon: 'none' })
      return
    }
    try {
      if (mode === 'edit' && this.data.editingBudgetId) {
        await updateBudgetItem(this.data.monthKey, this.data.editingBudgetId, {
          name,
          totalAmount: Number(total.toFixed(2)),
        })
      } else {
        await addBudgetItem(this.data.monthKey, {
          name,
          totalAmount: Number(total.toFixed(2)),
        })
      }
    } catch (err) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    this.closeAddPopup({
      resetForm: true,
    })
    await this.refreshBudgetList()
    wx.showToast({
      title: mode === 'edit' ? '已更新' : '已新增',
      icon: 'success',
    })
  },

  onAddKeyboardChange(e) {
    const { valueText, formulaText } = e.detail
    this.setData({
      addTotalAmount: valueText,
      addAmountFormula: formulaText,
    })
  },

  onUsedKeyboardChange(e) {
    const { valueText, formulaText } = e.detail
    this.setData({
      usedInput: valueText,
      usedAmountFormula: formulaText,
    })
  },

  async onSaveUsedAmount() {
    vibrateLight()
    const value = Number(this.data.usedInput)
    if (Number.isNaN(value) || value < 0) {
      wx.showToast({ title: '金额格式不正确', icon: 'none' })
      return
    }
    try {
      await updateUsedAmount(
        this.data.monthKey,
        this.data.usedItemId,
        Number(value.toFixed(2))
      )
    } catch (err) {
      wx.showToast({ title: '更新失败，请重试', icon: 'none' })
      return
    }
    this.closeUsedPopup({ resetForm: true })
    await this.refreshBudgetList()
    wx.showToast({ title: '已更新', icon: 'success' })
  },

  onItemTouchStart(e) {
    const { id } = e.currentTarget.dataset
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.swipeState = {
      id,
      startX: touch.pageX,
      startY: touch.pageY,
      initialOffset: this.getItemOffset(id),
      moving: false,
    }
  },

  onItemTouchMove(e) {
    if (!this.swipeState) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const dx = touch.pageX - this.swipeState.startX
    const dy = touch.pageY - this.swipeState.startY
    if (!this.swipeState.moving) {
      if (Math.abs(dx) <= 4 || Math.abs(dx) < Math.abs(dy)) return
      this.swipeState.moving = true
    }
    let next = this.swipeState.initialOffset + dx
    if (next > SWIPE_EDIT_WIDTH) next = SWIPE_EDIT_WIDTH
    if (next < -SWIPE_DELETE_WIDTH) next = -SWIPE_DELETE_WIDTH
    this.updateItemOffset(this.swipeState.id, next)
  },

  onItemTouchEnd() {
    if (!this.swipeState) return
    const id = this.swipeState.id
    const offset = this.getItemOffset(id)
    let finalOffset = 0
    if (offset > SWIPE_OPEN_THRESHOLD) finalOffset = SWIPE_EDIT_WIDTH
    if (offset < -SWIPE_OPEN_THRESHOLD) finalOffset = -SWIPE_DELETE_WIDTH
    this.updateItemOffset(id, finalOffset)
    this.swipeState = null
  },

  onEditBudgetAction(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.budgetList.find((budget) => budget.id === id) || null
    if (!item) {
      wx.showToast({ title: '预算项不存在', icon: 'none' })
      return
    }
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    const addInitial = formatAmount(item.totalAmount)
    this.setData({
      showAddPopup: true,
      addPopupClosing: false,
      addPopupMode: 'edit',
      addPopupTitle: '编辑预算项',
      addName: item.name,
      addTotalAmount: addInitial,
      addAmountFormula: '',
      addKeyboardReset: Date.now(),
      addInitialExpression: addInitial,
      editingBudgetId: id,
    })
    this.resetAllOffsets()
  },

  onDeleteBudgetAction(e) {
    const { id } = e.currentTarget.dataset
    wx.showModal({
      title: '删除预算项',
      content: '删除后不可恢复，确认删除吗？',
      confirmColor: '#d06d7f',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await deleteBudgetItem(this.data.monthKey, id)
        } catch (err) {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
          return
        }
        await this.refreshBudgetList()
        wx.showToast({ title: '已删除', icon: 'success' })
      },
    })
  },

  onImportBudgetByImage() {
    this.closeFabMenu({
      afterClose: () => this.startImageImport(),
    })
  },

  async startImageImport() {
    if (!wx.cloud || !wx.cloud.uploadFile || !wx.cloud.callFunction) {
      wx.showToast({ title: '请先启用云开发', icon: 'none' })
      return
    }
    let hideLoading = false
    const closeLoading = () => {
      if (!hideLoading) return
      wx.hideLoading()
      hideLoading = false
    }
    try {
      const tempFilePath = await chooseOneImage()
      wx.showLoading({ title: '识别中...', mask: true })
      hideLoading = true
      const uploadRes = await uploadImageToCloud(tempFilePath)
      const fileID = uploadRes && uploadRes.fileID
      if (!fileID) {
        throw new Error('图片上传失败')
      }
      const ocrRes = await wx.cloud.callFunction({
        name: 'ocrBudgetImport',
        data: { fileID },
      })
      const ocrResult = ocrRes && ocrRes.result ? ocrRes.result : {}
      if (!ocrResult.success) {
        throw new Error(ocrResult.message || '图片识别失败')
      }
      const records =
        ocrResult.data && Array.isArray(ocrResult.data.records)
          ? ocrResult.data.records
          : []
      if (!records.length) {
        throw new Error('未识别到分类金额')
      }
      const stats = await mergeBudgetItemsFromOcr(this.data.monthKey, records)
      await this.refreshBudgetList()
      closeLoading()
      wx.showToast({
        title: `更新${stats.updated || 0}项 新增${stats.created || 0}项`,
        icon: 'none',
      })
    } catch (err) {
      const message =
        err && err.errMsg && err.errMsg.includes('cancel')
          ? ''
          : err && err.message
            ? err.message
            : '导入失败，请重试'
      if (message) {
        closeLoading()
        wx.showToast({ title: message, icon: 'none' })
      }
      return
    }
    closeLoading()
  },

  closeAddPopup(options = {}) {
    const { resetForm = true } = options
    if (!this.data.showAddPopup) return
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    this.setData({ addPopupClosing: true })
    this.addPopupTimer = setTimeout(() => {
      const nextData = {
        showAddPopup: false,
        addPopupClosing: false,
      }
      if (resetForm) {
        nextData.addPopupMode = 'add'
        nextData.addPopupTitle = '新增预算项'
        nextData.addName = ''
        nextData.addTotalAmount = '0'
        nextData.addAmountFormula = ''
        nextData.editingBudgetId = ''
      }
      this.setData(nextData)
    }, POPUP_ANIMATION_MS)
  },

  closeUsedPopup(options = {}) {
    const { resetForm = true } = options
    if (!this.data.showUsedPopup) return
    if (this.usedPopupTimer) clearTimeout(this.usedPopupTimer)
    this.setData({ usedPopupClosing: true })
    this.usedPopupTimer = setTimeout(() => {
      const nextData = {
        showUsedPopup: false,
        usedPopupClosing: false,
      }
      if (resetForm) {
        nextData.usedItemId = ''
        nextData.usedItemName = ''
        nextData.usedItemTotalText = '0'
        nextData.usedInput = '0'
        nextData.usedAmountFormula = ''
      }
      this.setData(nextData)
    }, POPUP_ANIMATION_MS)
  },

  getItemOffset(id) {
    const item = this.data.budgetList.find((budget) => budget.id === id)
    return item ? Number(item.offsetX || 0) : 0
  },

  updateItemOffset(id, offsetX) {
    const nextList = this.data.budgetList.map((item) => {
      if (item.id === id) return { ...item, offsetX }
      if (item.offsetX !== 0) return { ...item, offsetX: 0 }
      return item
    })
    this.setData({ budgetList: nextList })
  },

  resetAllOffsets() {
    const hasOffset = this.data.budgetList.some((item) => item.offsetX !== 0)
    if (!hasOffset) return
    const nextList = this.data.budgetList.map((item) => ({
      ...item,
      offsetX: 0,
    }))
    this.setData({ budgetList: nextList })
  },

  noop() { },

  async onPrevMonth() {
    this.resetAllOffsets()
    const monthKey = getOffsetMonthKey(this.data.monthKey, -1)
    this.setData({
      monthKey,
      monthLabel: getMonthLabel(monthKey),
    })
    await this.refreshBudgetList()
  },

  async onNextMonth() {
    this.resetAllOffsets()
    const monthKey = getOffsetMonthKey(this.data.monthKey, 1)
    this.setData({
      monthKey,
      monthLabel: getMonthLabel(monthKey),
    })
    await this.refreshBudgetList()
  },

  onShareAppMessage() {
    return {
      title: '预算看板',
      path: '/pages/budget/budget',
    }
  },
})
