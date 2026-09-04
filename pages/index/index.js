const { isPrivilegedUser } = require('../../utils/privileged-user')

const SPENDING_CALENDAR_TOOL = {
  id: 'spending-calendar',
  title: '消费日历',
  desc: '以月历查看每日消费，点按日期查看流水',
  path: '/pages/expense-calendar/expense-calendar',
}

const BASE_TOOL_LIST = [
  {
    id: 'budget',
    title: '预算看板',
    desc: '按自然月追踪预算使用进度，支持快速录入',
    path: '/pages/budget/budget',
  },
  {
    id: 'course',
    title: '消课记录',
    desc: '记录兴趣班上课打卡，查看剩余课时',
    path: '/pages/course/course',
  },
  {
    id: 'qing-calendar',
    title: '青青日历',
    desc: '无限滚动月历展示，多日程管理与共享查看',
    path: '/pages/qing-calendar/qing-calendar',
  },
  {
    id: 'location',
    title: '定位拾取(gcj02)',
    desc: '获取当前所在位置的经纬度并支持复制',
    path: '/pages/location/location',
  },
]

Page({
  data: {
    toolList: BASE_TOOL_LIST,
  },

  async onShow() {
    const privileged = await isPrivilegedUser()
    const toolList = privileged
      ? [SPENDING_CALENDAR_TOOL, ...BASE_TOOL_LIST]
      : BASE_TOOL_LIST
    this.setData({ toolList })
  },

  onToolTap(e) {
    const path = e.currentTarget.dataset.path
    if (path) {
      wx.navigateTo({ url: path })
    }
  },

  onShareAppMessage() {
    return {
      title: '实用小工具',
      path: '/pages/index/index',
    }
  },
})
