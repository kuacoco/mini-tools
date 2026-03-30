/**
 * 分类语义色：少女系清新 pastel（低饱和、偏亮），关键词越靠前越优先匹配
 */
const SEMANTIC_CATEGORY_BG = [
  { k: ['公共交通', '公交', '地铁', '打车', '出租', '高铁', '火车', '机票'], bg: '#d8f5fc' },
  { k: ['私家车', '油费', '停车', '高速', '保养', '车险', '过路费'], bg: '#e8eaf4' },
  { k: ['水果', '零食', '饮料', '奶茶'], bg: '#fce7f3' },
  { k: ['早午晚餐', '早餐', '午餐', '晚餐', '外卖', '食堂', '快餐'], bg: '#ffe4cc' },
  { k: ['买菜', '生鲜', '超市', '菜场'], bg: '#dff7e8' },
  { k: ['软件服务', '软件', '订阅', '会员', '云存储', 'iCloud'], bg: '#ede9fe' },
  { k: ['数码装备', '数码', '电子', '手机', '电脑', '相机'], bg: '#dbeafe' },
  { k: ['虫虫'], bg: '#fff5fa' },
  { k: ['宠物', '猫', '狗'], bg: '#fbcfe8' },
  { k: ['日常用品', '日用', '家居', '百货'], bg: '#f5f0eb' },
  { k: ['医疗', '药', '医院', '挂号'], bg: '#ffe4e6' },
  { k: ['娱乐', '游戏', '电影', 'K歌'], bg: '#fae8ff' },
  { k: ['服装', '鞋', '服饰'], bg: '#ffeef2' },
  { k: ['住房', '房租', '水电', '物业', '燃气'], bg: '#fef3c7' },
  { k: ['教育', '书', '培训', '课程', '学费'], bg: '#e0e7ff' },
  { k: ['旅行', '酒店', '民宿', '门票'], bg: '#e0f2fe' },
  { k: ['通讯', '话费', '流量', '宽带'], bg: '#e8f4ff' },
  { k: ['理财', '基金', '股票'], bg: '#fef9c3' },
  // 一级分类
  { k: ['食品酒水'], bg: '#ffe4cc' },
  { k: ['行车交通'], bg: '#d8f5fc' },
  { k: ['居家物业'], bg: '#fef3c7' },
  { k: ['学习进修'], bg: '#e0e7ff' },
  { k: ['休闲娱乐'], bg: '#fae8ff' },
  { k: ['医疗保健'], bg: '#ffe4e6' },
  { k: ['人情往来'], bg: '#fce7f3' },
  { k: ['交流通讯'], bg: '#e8f4ff' },
  { k: ['衣服饰品'], bg: '#ffeef2' },
  { k: ['金融保险'], bg: '#fef9c3' },
  { k: ['其他杂项'], bg: '#f5f0eb' },
]

/** 无语义命中或冲突时：同系少女 pastel，色相错开、同屏不重复 */
const FALLBACK_PASTEL_BG = [
  '#ffd8e8',
  '#ffe4d6',
  '#e8f5e8',
  '#e0f4ff',
  '#f3e8ff',
  '#fce7f3',
  '#fef3c7',
  '#e0e7ff',
  '#dff7e8',
  '#ffe8d6',
  '#e8eaf4',
  '#ffeef2',
  '#d8f5fc',
  '#fae8ff',
  '#fef9c3',
  '#ede9fe',
]

function hashString(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

function semanticBgForCategoryName(name) {
  const n = String(name || '')
  for (const rule of SEMANTIC_CATEGORY_BG) {
    if (rule.k.some((kw) => n.includes(kw))) {
      return rule.bg
    }
  }
  return null
}

function pickUniqueCategoryBg(name, used) {
  const preferred = semanticBgForCategoryName(name)
  const tryOrder = []
  if (preferred) tryOrder.push(preferred)

  const start = hashString(name) % FALLBACK_PASTEL_BG.length
  for (let i = 0; i < FALLBACK_PASTEL_BG.length; i += 1) {
    tryOrder.push(FALLBACK_PASTEL_BG[(start + i) % FALLBACK_PASTEL_BG.length])
  }

  for (const color of tryOrder) {
    if (!used.has(color)) {
      used.add(color)
      return color
    }
  }

  const hue = hashString(name) % 360
  const c = `hsl(${hue} 52% 92%)`
  used.add(c)
  return c
}

function categoryInitial(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const ch = s[0]
  if (/[a-z]/i.test(ch)) return ch.toUpperCase()
  return ch
}

module.exports = {
  pickUniqueCategoryBg,
  categoryInitial,
}