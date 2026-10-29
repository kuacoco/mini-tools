const {
  getCurrentMonthKey,
  getMonthBudgetList,
  addBudgetItem,
  updateUsedAmount,
  updateBudgetItem,
  renameParentCategory,
  deleteBudgetItem,
  mergeBudgetItemsFromOcr,
  syncBudgetFromFeidee,
  copyBudgetFromMonth,
  getPublicBudgetConfig,
} = require('../../utils/budget-storage')
const { formatAmount } = require('../../utils/amount-expression')
const {
  getMonthLabel,
  getOffsetMonthKey,
  generateMonthPickerItems,
  findMonthPickerIndex,
} = require('../../utils/course-calendar')

const COLOR_PALETTE = [
  { main: '#f4a7b9', light: '#fde7ed' },
  { main: '#f5b97f', light: '#fff0e2' },
  { main: '#8ec5a4', light: '#e3f3ea' },
  { main: '#8fb6f9', light: '#e7efff' },
  { main: '#bba3f2', light: '#f1ecfe' },
  { main: '#7fcad1', light: '#e3f6f7' },
]

function summarizeBudgetList(list, monthKey) {
  let totalBudget = 0
  let totalUsed = 0
  ;(list || []).forEach((item) => {
    totalBudget += Number(item.totalAmount || 0)
    totalUsed += Number(item.usedAmount || 0)
  })
  const remain = totalBudget - totalUsed
  return {
    monthKey,
    monthLabel: getMonthLabel(monthKey),
    totalBudgetText: formatAmount(totalBudget),
    totalUsedText: formatAmount(totalUsed),
    remainText: formatAmount(remain),
  }
}

function buildBudgetGroups(list) {
  const groupMap = new Map()
  ;(list || []).forEach((item) => {
    const parentName = String(item.parentCategoryName || '').trim()
    if (!parentName) return
    const key = `name:${parentName}`
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        name: parentName,
        sourceName: item.parentCategorySourceName || '',
        items: [],
        totalAmount: 0,
        usedAmount: 0,
      })
    }
    const group = groupMap.get(key)
    if (!group.sourceName && item.parentCategorySourceName) {
      group.sourceName = item.parentCategorySourceName
    }
    group.items.push(item)
    group.totalAmount += Number(item.totalAmount || 0)
    group.usedAmount += Number(item.usedAmount || 0)
  })

  return Array.from(groupMap.values()).map((group, index) => {
    const remain = group.totalAmount - group.usedAmount
    const rawPercent =
      group.totalAmount <= 0 ? 0 : (group.usedAmount / group.totalAmount) * 100
    const percent = Math.max(0, Math.min(100, rawPercent))
    const color = COLOR_PALETTE[index % COLOR_PALETTE.length]
    return {
      ...group,
      totalText: formatAmount(group.totalAmount),
      usedText: formatAmount(group.usedAmount),
      remainText: formatAmount(remain),
      percentText: `${Math.round(rawPercent)}%`,
      barWidth: `${percent}%`,
      barColor: color.main,
      trackColor: color.light,
      isOver: remain < 0,
    }
  })
}

const SWIPE_EDIT_WIDTH = 82
const SWIPE_DELETE_WIDTH = 82
const SWIPE_OPEN_THRESHOLD = 38
const POPUP_ANIMATION_MS = 240
const FAB_MENU_ANIMATION_MS = 180
const DEFAULT_DAILY_FOOD_BUDGET = 50

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
    monthPickerItems: [],
    currentPickerIndex: 0,
    budgetList: [],
    budgetGroups: [],
    /** 上月 / 当月 / 下月 汇总，供 summary-card 内 swiper 滑动 */
    summarySwipe: [],
    swiperSummaryIndex: 1,
    /** 月份切换时递增，用于重建 swiper，避免回弹二次动画 */
    summarySwiperKey: 0,
    /** 食品酒水每日预算提示 */
    showDailyTip: false,
    dailyFoodBudget: DEFAULT_DAILY_FOOD_BUDGET,
    dailyBudgetText: '0',
    dailyRemainText: '0',
    foodCategoryRemainText: '0',
    foodCategoryAvgWithTodayText: '--',
    foodCategoryAvgWithoutTodayText: '--',
    showFabMenu: false,
    fabMenuClosing: false,
    showAddPopup: false,
    addPopupClosing: false,
    addPopupMode: 'add',
    addPopupTitle: '新增预算',
    addParentName: '',
    addName: '',
    addTotalAmount: '',
    addAmountFormula: '',
    addKeyboardReset: 0,
    addInitialExpression: '0',
    editingBudgetId: '',
    showParentPopup: false,
    parentPopupClosing: false,
    editingParentOldName: '',
    editingParentName: '',
    showUsedPopup: false,
    usedPopupClosing: false,
    usedItemId: '',
    usedItemName: '',
    usedItemTotalText: '0',
    usedInput: '0',
    usedAmountFormula: '',
    usedKeyboardReset: 0,
    usedInitialExpression: '0',
    showCopyPopup: false,
    showDeletePopup: false,
    deleteBudgetItems: [],
    deleteSelectedCount: 0,
    deleteMonthKey: '',
    deleteMonthLabel: '',
    copyPopupClosing: false,
    copySourceMonthIndex: 0,
    pageReady: false,
  },

  onLoad() {
    const monthKey = getCurrentMonthKey()
    const monthPickerItems = generateMonthPickerItems(monthKey)
    let currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)
    if (currentPickerIndex < 0) currentPickerIndex = 0
    const prevKey = getOffsetMonthKey(monthKey, -1)
    const nextKey = getOffsetMonthKey(monthKey, 1)
    const placeholder = (k) => summarizeBudgetList([], k)
    this.setData({
      monthKey,
      monthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex,
      summarySwipe: [placeholder(prevKey), placeholder(monthKey), placeholder(nextKey)],
      swiperSummaryIndex: 1,
      summarySwiperKey: 0,
    })
    this._lastSummaryCenterMonthKey = monthKey
  },

  onUnload() {
    if (this.addPopupTimer) clearTimeout(this.addPopupTimer)
    if (this.usedPopupTimer) clearTimeout(this.usedPopupTimer)
    if (this.fabMenuTimer) clearTimeout(this.fabMenuTimer)
    if (this.copyPopupTimer) clearTimeout(this.copyPopupTimer)
    if (this.parentPopupTimer) clearTimeout(this.parentPopupTimer)
  },

  async onShow() {
    try {
      await this.loadBudgetTipConfig()
      await this.refreshBudgetList()

    } finally {
      if (!this.data.pageReady) this.setData({ pageReady: true })
    }
  },

  async loadBudgetTipConfig() {
    try {
      const config = await getPublicBudgetConfig()
      const dailyFoodBudget = Number(config && config.dailyFoodBudget)
      this.setData({
        dailyFoodBudget:
          Number.isFinite(dailyFoodBudget) && dailyFoodBudget >= 0
            ? dailyFoodBudget
            : DEFAULT_DAILY_FOOD_BUDGET,
      })
    } catch (err) {
      this.setData({ dailyFoodBudget: DEFAULT_DAILY_FOOD_BUDGET })
    }
  },

  async refreshBudgetList() {
    const { monthKey } = this.data
    const prevKey = getOffsetMonthKey(monthKey, -1)
    const nextKey = getOffsetMonthKey(monthKey, 1)
    let listPrev = []
    let listCurr = []
    let listNext = []
    try {
      ;[listPrev, listCurr, listNext] = await Promise.all([
        getMonthBudgetList(prevKey),
        getMonthBudgetList(monthKey),
        getMonthBudgetList(nextKey),
      ])
    } catch (err) {
      wx.showToast({ title: '预算数据加载失败', icon: 'none' })
      return
    }

    const summarySwipe = [
      summarizeBudgetList(listPrev, prevKey),
      summarizeBudgetList(listCurr, monthKey),
      summarizeBudgetList(listNext, nextKey),
    ]

    const decorated = listCurr.map((item, index) => {
      const total = Number(item.totalAmount || 0)
      const used = Number(item.usedAmount || 0)
      const rawPercent = total <= 0 ? 0 : (used / total) * 100
      const percent = Math.max(0, Math.min(100, rawPercent))
      const remain = total - used
      const color = COLOR_PALETTE[index % COLOR_PALETTE.length]
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

    const budgetGroups = buildBudgetGroups(decorated)
    const prevCenter = this._lastSummaryCenterMonthKey
    const monthChanged = prevCenter !== monthKey
    this._lastSummaryCenterMonthKey = monthKey

    // 计算食品酒水每日预算提示（仅当月显示）
    const isCurrentMonth = monthKey === getCurrentMonthKey()
    let showDailyTip = false
    let dailyBudgetText = '0'
    let dailyRemainText = '0'
    let foodCategoryRemainText = '0'
    let foodCategoryAvgWithTodayText = '--'
    let foodCategoryAvgWithoutTodayText = '--'
    if (isCurrentMonth) {
      const today = new Date()
      const dayOfMonth = today.getDate() // 今天是几号
      const daysInMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0
      ).getDate()
      const remainDaysWithToday = Math.max(0, daysInMonth - dayOfMonth + 1)
      const remainDaysWithoutToday = Math.max(0, daysInMonth - dayOfMonth)
      const dailyBudget = dayOfMonth * Number(this.data.dailyFoodBudget || 0) // 截止今天的食品酒水预算
      // 一级分类不单独存储，食品酒水额度由所属二级预算项汇总。
      const foodGroup = budgetGroups.find(
        (group) => group.sourceName === '食品酒水' || group.name === '食品酒水'
      )
      const foodUsed = foodGroup ? Number(foodGroup.usedAmount || 0) : 0
      const foodTotal = foodGroup ? Number(foodGroup.totalAmount || 0) : 0
      const dailyRemain = dailyBudget - foodUsed // 剩余额度
      const foodCategoryRemain = foodTotal - foodUsed
      showDailyTip = true
      dailyBudgetText = formatAmount(dailyBudget)
      dailyRemainText = formatAmount(dailyRemain)
      foodCategoryRemainText = formatAmount(foodCategoryRemain)
      foodCategoryAvgWithTodayText =
        remainDaysWithToday > 0
          ? formatAmount(foodCategoryRemain / remainDaysWithToday)
          : '--'
      foodCategoryAvgWithoutTodayText =
        remainDaysWithoutToday > 0
          ? formatAmount(foodCategoryRemain / remainDaysWithoutToday)
          : '--'
    }

    const patch = {
      budgetList: decorated,
      budgetGroups,
      monthLabel: getMonthLabel(monthKey),
      summarySwipe,
      swiperSummaryIndex: 1,
      showDailyTip,
      dailyBudgetText,
      dailyRemainText,
      foodCategoryRemainText,
      foodCategoryAvgWithTodayText,
      foodCategoryAvgWithoutTodayText,
    }
    if (monthChanged) {
      patch.summarySwiperKey = (this.data.summarySwiperKey || 0) + 1
    }
    this.setData(patch)
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
      addPopupTitle: '新增预算',
      addParentName: '',
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
    if (this.data.showParentPopup) {
      this.closeParentPopup()
      return
    }
    if (this.data.showAddPopup) {
      this.closeAddPopup()
    }
    if (this.data.showCopyPopup) {
      this.closeCopyPopup()
    }
  },

  onAddNameInput(e) {
    this.setData({ addName: e.detail.value })
  },

  onAddParentNameInput(e) {
    this.setData({ addParentName: e.detail.value })
  },

  async onSaveBudgetItem() {
    vibrateLight()
    const mode = this.data.addPopupMode
    const parentCategoryName = (this.data.addParentName || '').trim()
    const name = (this.data.addName || '').trim()
    const total = Number(this.data.addTotalAmount)
    if (!parentCategoryName) {
      wx.showToast({ title: '请输入一级分类', icon: 'none' })
      return
    }
    if (!name) {
      wx.showToast({ title: '请输入预算名称', icon: 'none' })
      return
    }
    if (isNaN(total) || total < 0) {
      wx.showToast({ title: '请输入有效预算金额', icon: 'none' })
      return
    }
    try {
      if (mode === 'edit' && this.data.editingBudgetId) {
        await updateBudgetItem(this.data.monthKey, this.data.editingBudgetId, {
          parentCategoryName,
          name,
          totalAmount: Number(total.toFixed(2)),
        })
      } else {
        await addBudgetItem(this.data.monthKey, {
          parentCategoryName,
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
      addParentName: item.parentCategoryName,
      addName: item.name,
      addTotalAmount: addInitial,
      addAmountFormula: '',
      addKeyboardReset: Date.now(),
      addInitialExpression: addInitial,
      editingBudgetId: id,
    })
    this.resetAllOffsets()
  },

  onEditParentCategory(e) {
    const { key } = e.currentTarget.dataset
    const group = this.data.budgetGroups.find((item) => item.key === key)
    if (!group) return
    if (this.parentPopupTimer) clearTimeout(this.parentPopupTimer)
    this.setData({
      showParentPopup: true,
      parentPopupClosing: false,
      editingParentOldName: group.name,
      editingParentName: group.name,
    })
  },

  onParentNameInput(e) {
    this.setData({ editingParentName: e.detail.value })
  },

  async onSaveParentCategory() {
    const nextName = String(this.data.editingParentName || '').trim()
    if (!nextName) {
      wx.showToast({ title: '请输入一级分类名称', icon: 'none' })
      return
    }
    try {
      const result = await renameParentCategory(
        this.data.monthKey,
        this.data.editingParentOldName,
        nextName
      )
      this.closeParentPopup()
      await this.refreshBudgetList()
      wx.showToast({ title: `已更新${result.updated || 0}项`, icon: 'success' })
    } catch (err) {
      wx.showToast({ title: err.message || '更新失败', icon: 'none' })
    }
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

  onClearBudgetItems() {
    this.closeFabMenu({ afterClose: () => this.confirmClearBudgetItems() })
  },

  async confirmClearBudgetItems() {
    if (this.clearingBudgetItems) return
    this.clearingBudgetItems = true
    const monthKey = this.data.monthKey
    const preservedNames = new Set(['烟酒茶', '早午晚餐', '水果零食', '买菜', '软件服务'])
    try {
      wx.showLoading({ title: '正在获取预算', mask: true })
      const list = await getMonthBudgetList(monthKey)
      if (!list.length) {
        wx.showToast({ title: '当前月份没有预算项', icon: 'none' })
        return
      }
      const items = list.map((item) => ({
        ...item,
        checked: !preservedNames.has(String(item.name || '').trim()),
      }))
      this.setData({
        showDeletePopup: true,
        deleteMonthKey: monthKey,
        deleteMonthLabel: getMonthLabel(monthKey),
        deleteBudgetItems: items,
        deleteSelectedCount: items.filter((item) => item.checked).length,
      })
    } catch (err) {
      wx.showToast({ title: '获取预算失败，请稍后重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.clearingBudgetItems = false
    }
  },

  onDeleteBudgetSelectionChange(e) {
    if (this.clearingBudgetItems) return
    const selected = new Set(e.detail.value)
    const items = this.data.deleteBudgetItems.map((item) => ({
      ...item,
      checked: selected.has(item.id),
    }))
    this.setData({
      deleteBudgetItems: items,
      deleteSelectedCount: items.filter((item) => item.checked).length,
    })
  },

  onCloseDeletePopup() {
    if (this.clearingBudgetItems) return
    this.setData({ showDeletePopup: false, deleteBudgetItems: [], deleteSelectedCount: 0 })
  },

  async onConfirmDeleteBudgetItems() {
    if (this.clearingBudgetItems) return
    const targets = (this.data.deleteBudgetItems || []).filter((item) => item.checked)
    if (!targets.length) return
    this.clearingBudgetItems = true
    const monthKey = this.data.deleteMonthKey
    let deleted = 0
    try {
      wx.showLoading({ title: '正在删除预算', mask: true })
      for (const item of targets) {
        await deleteBudgetItem(monthKey, item.id)
        deleted += 1
      }
      this.setData({ showDeletePopup: false, deleteBudgetItems: [], deleteSelectedCount: 0 })
      wx.hideLoading()
      await this.refreshBudgetList()
      wx.showToast({ title: `已删除 ${deleted} 项`, icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      const remaining = this.data.deleteBudgetItems.filter(
        (item) => !targets.slice(0, deleted).some((target) => target.id === item.id)
      )
      this.setData({
        deleteBudgetItems: remaining,
        deleteSelectedCount: remaining.filter((item) => item.checked).length,
      })
      try {
        await this.refreshBudgetList()
      } catch (refreshError) {
        console.error('刷新预算失败', refreshError)
      }
      wx.showModal({
        title: '删除未完成',
        content: `已删除 ${deleted} 项，请检查剩余预算项后重试。`,
        showCancel: false,
      })
    } finally {
      this.clearingBudgetItems = false
    }
  },

  onImportBudgetByImage() {
    this.closeFabMenu({
      afterClose: () => this.startImageImport(),
    })
  },

  onSyncFromFeidee() {
    this.closeFabMenu({
      afterClose: () => this.startFeideeSync(),
    })
  },

  onGoToAdmin() {
    this.closeFabMenu({
      afterClose: () => {
        wx.navigateTo({ url: '/pages/admin/admin' })
      },
    })
  },

  async startFeideeSync(options = {}) {
    const { auto = false } = options
    if (!wx.cloud || !wx.cloud.callFunction) {
      wx.showToast({ title: '请先启用云开发', icon: 'none' })
      return false
    }
    wx.showLoading({ title: '同步中...', mask: !auto })
    try {
      const stats = await syncBudgetFromFeidee(this.data.monthKey)
      await this.refreshBudgetList()
      wx.hideLoading()
      wx.showToast({
        title: `更新${stats.updated || 0}项 新增${stats.created || 0}项`,
        icon: 'none',
      })
      return true
    } catch (err) {
      wx.hideLoading()
      const message = err && err.message ? err.message : '同步失败，请重试'
      wx.showToast({ title: message, icon: 'none' })
      return false
    }
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
        nextData.addPopupTitle = '新增预算'
        nextData.addParentName = ''
        nextData.addName = ''
        nextData.addTotalAmount = '0'
        nextData.addAmountFormula = ''
        nextData.editingBudgetId = ''
      }
      this.setData(nextData)
    }, POPUP_ANIMATION_MS)
  },

  closeParentPopup() {
    if (!this.data.showParentPopup) return
    if (this.parentPopupTimer) clearTimeout(this.parentPopupTimer)
    this.setData({ parentPopupClosing: true })
    this.parentPopupTimer = setTimeout(() => {
      this.setData({
        showParentPopup: false,
        parentPopupClosing: false,
        editingParentOldName: '',
        editingParentName: '',
      })
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

  onOpenCopyPopup() {
    this.closeFabMenu({
      afterClose: () => this.openCopyPopup(),
    })
  },

  openCopyPopup() {
    if (this.copyPopupTimer) clearTimeout(this.copyPopupTimer)
    // 默认选中上月
    const prevKey = getOffsetMonthKey(this.data.monthKey, -1)
    let sourceIndex = findMonthPickerIndex(this.data.monthPickerItems, prevKey)
    if (sourceIndex < 0) sourceIndex = 0
    this.setData({
      showCopyPopup: true,
      copyPopupClosing: false,
      copySourceMonthIndex: sourceIndex,
    })
  },

  onSelectCopySourceMonth(e) {
    const idx = Number(e.detail.value)
    this.setData({ copySourceMonthIndex: idx })
  },

  async onConfirmCopy() {
    vibrateLight()
    const sourceItem = this.data.monthPickerItems[this.data.copySourceMonthIndex]
    if (!sourceItem) {
      wx.showToast({ title: '请选择源月份', icon: 'none' })
      return
    }
    const sourceMonthKey = sourceItem.monthKey
    const targetMonthKey = this.data.monthKey
    if (sourceMonthKey === targetMonthKey) {
      wx.showToast({ title: '不能复制到同月份', icon: 'none' })
      return
    }
    wx.showLoading({ title: '复制中...', mask: true })
    try {
      const stats = await copyBudgetFromMonth(sourceMonthKey, targetMonthKey)
      await this.refreshBudgetList()
      wx.hideLoading()
      wx.showToast({
        title: `新增${stats.created || 0}项 跳过${stats.skipped || 0}项`,
        icon: 'none',
      })
    } catch (err) {
      wx.hideLoading()
      console.error('复制预算失败:', err)
      wx.showToast({ title: err.message || '复制失败，请重试', icon: 'none' })
      return
    }
    this.closeCopyPopup()
  },

  closeCopyPopup(options = {}) {
    if (!this.data.showCopyPopup) return
    if (this.copyPopupTimer) clearTimeout(this.copyPopupTimer)
    this.setData({ copyPopupClosing: true })
    this.copyPopupTimer = setTimeout(() => {
      this.setData({
        showCopyPopup: false,
        copyPopupClosing: false,
      })
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
    this.setData({
      budgetList: nextList,
      budgetGroups: buildBudgetGroups(nextList),
    })
  },

  resetAllOffsets() {
    const hasOffset = this.data.budgetList.some((item) => item.offsetX !== 0)
    if (!hasOffset) return
    const nextList = this.data.budgetList.map((item) => ({
      ...item,
      offsetX: 0,
    }))
    this.setData({
      budgetList: nextList,
      budgetGroups: buildBudgetGroups(nextList),
    })
  },

  noop() { },

  onSummarySwipePrev() {
    if (this.data.swiperSummaryIndex !== 1) return
    vibrateLight()
    this.setData({ swiperSummaryIndex: 0 })
  },

  onSummarySwipeNext() {
    if (this.data.swiperSummaryIndex !== 1) return
    vibrateLight()
    this.setData({ swiperSummaryIndex: 2 })
  },

  async onSummarySwiperChange(e) {
    const cur = e.detail.current
    this.setData({ swiperSummaryIndex: cur })
    if (cur === 1) return
    if (cur === 0) {
      await this.shiftSummaryMonth(-1)
    } else if (cur === 2) {
      await this.shiftSummaryMonth(1)
    }
  },

  async shiftSummaryMonth(delta) {
    this.resetAllOffsets()
    const monthKey = getOffsetMonthKey(this.data.monthKey, delta)
    const monthPickerItems = this.data.monthPickerItems.length
      ? this.data.monthPickerItems
      : generateMonthPickerItems(monthKey)
    let currentPickerIndex = findMonthPickerIndex(monthPickerItems, monthKey)
    if (currentPickerIndex < 0) currentPickerIndex = 0
    // 不要在这里 set swiperSummaryIndex: 1，否则会先播「滑回中间」再加载数据，出现二次动画。
    // 交给 refreshBudgetList 与 summarySwiperKey 一起重建 swiper，直接落在中间屏。
    this.setData({
      monthKey,
      monthLabel: getMonthLabel(monthKey),
      monthPickerItems,
      currentPickerIndex,
    })
    await this.refreshBudgetList()
  },

  async onSelectMonth(e) {
    const idx = Number(e.detail.value)
    const item = this.data.monthPickerItems[idx]
    if (!item) return
    vibrateLight()
    this.resetAllOffsets()
    this.setData({
      monthKey: item.monthKey,
      monthLabel: getMonthLabel(item.monthKey),
      currentPickerIndex: idx,
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
