const cloud = require('wx-server-sdk')
const tencentcloud = require('tencentcloud-sdk-nodejs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function parseAmountText(input) {
  if (!input) return null
  const value = Number(String(input).replace(/,/g, ''))
  if (Number.isNaN(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function shouldSkipLine(line) {
  const text = String(line || '').trim()
  if (!text) return true
  const keywords = [
    '分类支出',
    '支出',
    '预算',
    '汇总',
    '账单',
    '系列图',
    '饼图',
    '总计',
    '本月',
  ]
  return keywords.some((keyword) => text.includes(keyword))
}

function isLikelyBudgetCategory(input) {
  const text = String(input || '').trim()
  if (!text) return false
  if (text.length > 24) return false

  // 常见状态栏/日期片段噪声：08:04、2.1~2.28、5GA 等
  if (/^\d{1,2}:\d{2}$/.test(text)) return false
  if (/^\d+([./-]\d+){0,3}(~\d+([./-]\d+){0,3})?$/.test(text)) return false
  if (/^[A-Z0-9]{2,6}$/.test(text)) return false
  if (/^(5g|4g|wifi|lte|volte)/i.test(text)) return false

  const cleaned = text.replace(/[^\u4e00-\u9fa5A-Za-z]/g, '')
  if (!cleaned) return false
  if (cleaned.length < 2) return false

  const hasChinese = /[\u4e00-\u9fa5]/.test(cleaned)
  if (hasChinese) return true

  // 英文分类仅接受纯字母，避免把状态码/缩写误识别成分类
  if (/^[a-z]{3,20}$/i.test(cleaned) && cleaned !== cleaned.toUpperCase()) {
    return true
  }
  return false
}

function parseRecordsFromLines(lines) {
  const records = []
  let pendingCategory = ''
  for (const raw of lines) {
    const line = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!line || shouldSkipLine(line)) continue

    const onlyAmountMatch = line.match(/^([\d,]+(?:\.\d{1,2})?)$/)
    if (onlyAmountMatch && pendingCategory) {
      const amount = parseAmountText(onlyAmountMatch[1])
      if (amount !== null) {
        records.push({ category: pendingCategory, amount })
      }
      pendingCategory = ''
      continue
    }

    const tokenRegex = /([\d,]+(?:\.\d{1,2})?)(%?)/g
    const tokens = []
    let tokenMatch = tokenRegex.exec(line)
    while (tokenMatch) {
      tokens.push({
        raw: tokenMatch[1],
        isPercent: tokenMatch[2] === '%',
        index: tokenMatch.index,
      })
      tokenMatch = tokenRegex.exec(line)
    }

    const amountToken = [...tokens]
      .reverse()
      .find((token) => !token.isPercent)
    if (amountToken) {
      const amount = parseAmountText(amountToken.raw)
      const leftText = line.slice(0, amountToken.index).replace(/\d[\d,.%]*\s*$/, '').trim()
      const category = leftText || pendingCategory
      if (category && amount !== null) {
        if (isLikelyBudgetCategory(category)) {
          records.push({ category, amount })
        }
        pendingCategory = ''
        continue
      }
    }

    if (
      /[\u4e00-\u9fa5A-Za-z]/.test(line) &&
      !line.includes('%') &&
      isLikelyBudgetCategory(line)
    ) {
      pendingCategory = line
    }
  }
  return records
}

function dedupeRecords(records) {
  const map = new Map()
  records.forEach((item) => {
    if (!isLikelyBudgetCategory(item.category)) return
    const key = String(item.category || '')
      .trim()
      .toLowerCase()
    if (!key) return
    if (!map.has(key)) {
      map.set(key, {
        category: String(item.category).trim(),
        amount: Number(item.amount || 0),
      })
      return
    }
    const old = map.get(key)
    old.amount = Number((old.amount + Number(item.amount || 0)).toFixed(2))
    map.set(key, old)
  })
  return Array.from(map.values()).filter((item) => item.amount > 0)
}

async function requestOcrLines(fileID) {
  if (!fileID) throw new Error('缺少 fileID')
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) {
    throw new Error('OCR 凭证未配置，请检查环境变量')
  }
  const region = process.env.OCR_REGION || 'ap-beijing'
  const tempRes = await cloud.getTempFileURL({
    fileList: [fileID],
  })
  const fileInfo =
    tempRes && Array.isArray(tempRes.fileList) ? tempRes.fileList[0] : null
  if (!fileInfo || !fileInfo.tempFileURL) {
    throw new Error('云存储文件读取失败')
  }

  const OcrClient = tencentcloud.ocr.v20181119.Client
  const client = new OcrClient({
    credential: { secretId, secretKey },
    region,
    profile: {
      httpProfile: {
        endpoint: 'ocr.tencentcloudapi.com',
      },
    },
  })

  const resp = await client.GeneralAccurateOCR({
    ImageUrl: fileInfo.tempFileURL,
  })
  const detections = Array.isArray(resp.TextDetections)
    ? resp.TextDetections
    : []
  return detections
    .map((item) => String(item.DetectedText || '').trim())
    .filter(Boolean)
}

exports.main = async (event) => {
  try {
    const fileID = event.fileID
    const lines = await requestOcrLines(fileID)
    const records = dedupeRecords(parseRecordsFromLines(lines))

    // 识别完成后删除云存储中的该图片，避免长期占用空间
    if (fileID) {
      cloud.deleteFile({ fileList: [fileID] }).catch(() => { })
    }

    return {
      success: true,
      data: {
        records,
        rawLineCount: lines.length,
      },
    }
  } catch (err) {
    return {
      success: false,
      message: err && err.message ? err.message : 'OCR识别失败',
    }
  }
}
