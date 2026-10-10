// 课程头像、进度条与日历点颜色（与列表顺序一致，最多 10 门课）
// main 用于数据标记，light 用于轨道，avatar 用于更有层次的课程头像。
const COLOR_PALETTE = [
  { main: '#f07891', light: '#ffe6ec', avatar: 'linear-gradient(145deg, #ff91a6, #e85f7d)' },
  { main: '#f5b83f', light: '#fff4cf', avatar: 'linear-gradient(145deg, #ffd05f, #eea128)' },
  { main: '#56a7ea', light: '#e1f1ff', avatar: 'linear-gradient(145deg, #71bcf5, #3f91d5)' },
  { main: '#9276f2', light: '#eee9ff', avatar: 'linear-gradient(145deg, #a88cff, #8063e4)' },
  { main: '#22cdb6', light: '#d8faf4', avatar: 'linear-gradient(145deg, #35e0c8, #20b8a4)' },
  { main: '#d85c8c', light: '#fbe3ed', avatar: 'linear-gradient(145deg, #ec78a4, #be4777)' },
  { main: '#58bc78', light: '#e1f7e7', avatar: 'linear-gradient(145deg, #6fd68b, #43a963)' },
  { main: '#b178df', light: '#f3e7fc', avatar: 'linear-gradient(145deg, #c68df0, #965dc5)' },
  { main: '#42b6c2', light: '#ddf7f8', avatar: 'linear-gradient(145deg, #5acbd3, #329ca8)' },
  { main: '#657de5', light: '#e8ecff', avatar: 'linear-gradient(145deg, #7f96f5, #5067ce)' },
]

const DEFAULT_CHECKIN_DOT_BG =
  'linear-gradient(145deg, #bca6ff 0%, #8067dc 100%)'

module.exports = {
  COLOR_PALETTE,
  DEFAULT_CHECKIN_DOT_BG,
}
