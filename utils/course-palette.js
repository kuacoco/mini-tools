// 课程头像/进度条/日历点颜色（与列表顺序一致，最多 10 门课）
const COLOR_PALETTE = [
  { main: '#2dd4bf', light: '#ccfbf1' },
  { main: '#a78bfa', light: '#ede9fe' },
  { main: '#f472b6', light: '#fce7f3' },
  { main: '#67e8f9', light: '#cffafe' },
  { main: '#c084fc', light: '#f5f3ff' },
  { main: '#fb923c', light: '#ffedd5' },
  { main: '#34d399', light: '#dcfce7' },
  { main: '#60a5fa', light: '#dbeafe' },
  { main: '#f43f5e', light: '#ffe4e6' },
  { main: '#f59e0b', light: '#fff7ed' },
]

const DEFAULT_CHECKIN_DOT_BG =
  'linear-gradient(145deg, #f9a8d4 0%, #f472b6 100%)'

module.exports = {
  COLOR_PALETTE,
  DEFAULT_CHECKIN_DOT_BG,
}
