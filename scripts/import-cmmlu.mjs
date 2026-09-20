/**
 * CMMLU 题库导入脚本
 * 用法: node scripts/import-cmmlu.mjs <cmmlu仓库路径>
 * 数据来源: https://github.com/haonan-li/CMMLU （研究用途数据集，商用前请确认许可）
 * 将选定科目转换为本项目的题目格式，追加到对应分类 JSON（无解析、难度按科目级别设定）。
 */
import fs from 'node:fs';
import path from 'node:path';

const CMMLU_DIR = process.argv[2] ?? '/tmp/cmmlu';
const OUT_DIR = new URL('../public/questions/', import.meta.url).pathname;

/** 科目 → [目标分类, 难度] */
const SUBJECT_MAP = {
  chinese_history: ['cnhistory', 'hard'],
  world_history: ['history', 'medium'],
  arts: ['history', 'medium'],
  ethnology: ['history', 'medium'],
  ancient_chinese: ['poetry', 'hard'],
  chinese_literature: ['literature', 'medium'],
  modern_chinese: ['literature', 'easy'],
  chinese_food_culture: ['food', 'easy'],
  food_science: ['food', 'hard'],
  high_school_geography: ['geography', 'medium'],
  astronomy: ['science', 'hard'],
  chinese_civil_service_exam: ['general', 'medium'],
  global_facts: ['general', 'medium'],
  chinese_driving_rule: ['general', 'easy'],
  nutrition: ['general', 'easy'],
  sports_science: ['general', 'medium'],
};

const MAX_PER_SUBJECT = 60;
const MAX_Q_LEN = 60;
const MAX_OPT_LEN = 24;
/** 依赖上下文（材料/图表/节选）或组合式选项的题目直接丢弃 */
const BAD_QUESTION = /材料|阅读|下图|如图|见图|据图|右图|下表|表中|上述|该诗|这首诗|引文|节选|这段|某校|某班|某市|某省|某国|某企业/;
const BAD_OPTION = /①|②|③|④|都对|都错|以上皆|以上均|A和B|B和C/;

/** 极简 CSV 解析（支持双引号包裹字段） */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normalize = (s) => s.replace(/[\s，。？！、：；“”「」（）()?!.,:;'"…—-]/g, '');

let grandTotal = 0;
const report = [];

for (const [subject, [category, difficulty]] of Object.entries(SUBJECT_MAP)) {
  const csvPath = path.join(CMMLU_DIR, 'data/test', `${subject}.csv`);
  if (!fs.existsSync(csvPath)) { report.push(`${subject}: 文件不存在，跳过`); continue; }
  const outPath = path.join(OUT_DIR, `${category}.json`);
  const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const seen = new Set(existing.map((q) => normalize(q.question)));
  let maxId = Math.max(...existing.map((q) => parseInt(q.id.split('-')[1], 10)));

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).slice(1);
  const added = [];
  for (const row of rows) {
    if (added.length >= MAX_PER_SUBJECT) break;
    const [, question, a, b, c, d, answer] = row;
    const options = [a, b, c, d].map((s) => (s ?? '').trim());
    const q = (question ?? '').trim();
    const idx = 'ABCD'.indexOf((answer ?? '').trim());
    if (!q || idx < 0 || options.some((o) => !o)) continue;
    if (q.length > MAX_Q_LEN || options.some((o) => o.length > MAX_OPT_LEN)) continue;
    if (BAD_QUESTION.test(q) || options.some((o) => BAD_OPTION.test(o))) continue;
    const key = normalize(q);
    if (seen.has(key)) continue;
    seen.add(key);
    maxId += 1;
    added.push({
      id: `${category}-${String(maxId).padStart(3, '0')}`,
      category,
      difficulty,
      question: q,
      options,
      correctAnswer: idx,
    });
  }
  fs.writeFileSync(outPath, JSON.stringify([...existing, ...added], null, 2) + '\n');
  grandTotal += added.length;
  report.push(`${subject} → ${category}: +${added.length} (共 ${existing.length + added.length})`);
}

console.log(report.join('\n'));
console.log(`\n共导入 ${grandTotal} 题`);
