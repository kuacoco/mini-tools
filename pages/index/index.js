// index.js
Page({
  data: {
    toolList: [
      {
        id: 'budget',
        title: '预算看板',
        desc: '按自然月追踪预算使用进度，支持快速录入',
        path: '/pages/budget/budget',
      },
      {
        id: 'location',
        title: '定位拾取(gcj02)',
        desc: '获取当前所在位置的经纬度并支持复制',
        path: '/pages/location/location',
      },
    ],
  },

  onToolTap(e) {
    const path = e.currentTarget.dataset.path
    if (path) {
      wx.navigateTo({ url: path })
    }
  },
})
