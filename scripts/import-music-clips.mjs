/**
 * 音乐题素材导入：从 Apple iTunes 公开试听 API 拉取 30 秒预览片段，截取 13 秒并统一响度。
 * 用法: node scripts/import-music-clips.mjs        （需要 ffmpeg）
 * 输出: public/questions/audio/*.mp3 + public/questions/music.json
 * 仅供朋友间内部娱乐使用，请勿公开分发或商用。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = new URL('../public/questions/audio/', import.meta.url).pathname;
const MUSIC_JSON = new URL('../public/questions/music.json', import.meta.url).pathname;
const TMP_DIR = '/tmp/music-import';

// 本脚本会整体重写 music.json（只含下面 42 首）。放量之后的新歌由 import-music-hits.mjs 追加，
// 一旦 music.json 里已有 hit-* 题目就拒绝运行，免得把它们覆盖掉。
if (fs.existsSync(MUSIC_JSON) && fs.readFileSync(MUSIC_JSON, 'utf8').includes('/hit-') && !process.argv.includes('--force')) {
  console.error('music.json 已包含 import-music-hits.mjs 导入的题目，本脚本会将其覆盖，已中止（确需重来请加 --force）。');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const STORES = ['TW', 'HK', 'US', 'CN', 'JP'];
const CLIP_SS = 2;   // 跳过试听开头 2 秒
const CLIP_LEN = 13; // 截取 13 秒

// ---------------- 猜歌名：热门华语流行（含周杰伦 8 首） ----------------
const SONGS = [
  { title: '晴天', titleT: '晴天', artist: '周杰伦', artistT: '周杰倫', difficulty: 'easy',
    distractors: ['七里香', '不能说的秘密', '蒲公英的约定'], explain: '收录于周杰伦 2003 年专辑《叶惠美》。' },
  { title: '七里香', titleT: '七里香', artist: '周杰伦', artistT: '周杰倫', difficulty: 'easy',
    distractors: ['晴天', '园游会', '借口'], explain: '周杰伦 2004 年同名专辑主打歌，方文山作词。' },
  { title: '青花瓷', titleT: '青花瓷', artist: '周杰伦', artistT: '周杰倫', difficulty: 'medium',
    distractors: ['东风破', '发如雪', '菊花台'], explain: '收录于 2007 年专辑《我很忙》，中国风代表作。' },
  { title: '稻香', titleT: '稻香', artist: '周杰伦', artistT: '周杰倫', difficulty: 'easy',
    distractors: ['听妈妈的话', '蜗牛', '彩虹'], explain: '收录于 2008 年专辑《魔杰座》，为汶川地震创作的励志歌。' },
  { title: '告白气球', titleT: '告白氣球', artist: '周杰伦', artistT: '周杰倫', difficulty: 'easy',
    distractors: ['简单爱', '甜甜的', '星晴'], explain: '收录于 2016 年专辑《周杰伦的床边故事》。' },
  { title: '双截棍', titleT: '雙截棍', artist: '周杰伦', artistT: '周杰倫', difficulty: 'medium',
    distractors: ['霍元甲', '忍者', '龙拳'], explain: '收录于 2001 年专辑《范特西》，让周杰伦一炮而红。' },
  { title: '夜曲', titleT: '夜曲', artist: '周杰伦', artistT: '周杰倫', difficulty: 'medium',
    distractors: ['以父之名', '止战之殇', '夜的第七章'], explain: '2005 年专辑《十一月的萧邦》主打歌。' },
  { title: '听妈妈的话', titleT: '聽媽媽的話', artist: '周杰伦', artistT: '周杰倫', difficulty: 'easy',
    distractors: ['稻香', '听爸爸的话', '外婆'], explain: '收录于 2006 年专辑《依然范特西》。' },
  { title: '江南', titleT: '江南', artist: '林俊杰', artistT: '林俊傑', difficulty: 'easy',
    distractors: ['曹操', '一千年以后', '小酒窝'], explain: '林俊杰 2004 年专辑《第二天堂》主打歌。' },
  { title: '十年', titleT: '十年', artist: '陈奕迅', artistT: '陳奕迅', difficulty: 'easy',
    distractors: ['爱情转移', '好久不见', '富士山下'], explain: '陈奕迅 2003 年《黑·白·灰》专辑曲目，国语经典。' },
  { title: '光年之外', titleT: '光年之外', artist: '邓紫棋', artistT: '鄧紫棋', difficulty: 'easy',
    distractors: ['泡沫', '倒数', '来自天堂的魔鬼'], explain: '邓紫棋 2016 年为电影《太空旅客》演唱的中文主题曲。' },
  { title: '演员', titleT: '演員', artist: '薛之谦', artistT: '薛之謙', difficulty: 'medium',
    distractors: ['丑八怪', '绅士', '刚刚好'], explain: '薛之谦 2015 年复出后的代表作。' },
  { title: '唯一', titleT: '唯一', artist: '王力宏', artistT: '王力宏', difficulty: 'medium',
    distractors: ['大城小爱', '改变自己', '爱的就是你'], explain: '王力宏 2001 年同名专辑主打歌。' },
  { title: '日不落', titleT: '日不落', artist: '蔡依林', artistT: '蔡依林', difficulty: 'easy',
    distractors: ['舞娘', '说爱你', '倒带'], explain: '蔡依林 2007 年专辑《特务J》曲目，翻唱自英文歌《Sunshine in the Rain》。' },
  { title: '倔强', titleT: '倔強', artist: '五月天', artistT: '五月天', difficulty: 'easy',
    distractors: ['知足', '突然好想你', '温柔'], explain: '五月天 2004 年专辑《神的孩子都在跳舞》曲目。' },
  { title: '遇见', titleT: '遇見', artist: '孙燕姿', artistT: '孫燕姿', difficulty: 'easy',
    distractors: ['绿光', '开始懂了', '我怀念的'], explain: '孙燕姿演唱，电影《向左走·向右走》主题曲。' },
  { title: '小幸运', titleT: '小幸運', artist: '田馥甄', artistT: '田馥甄', difficulty: 'easy',
    distractors: ['你就不要想起我', '魔鬼中的天使', '寂寞寂寞就好'], explain: '田馥甄演唱，2015 年电影《我的少女时代》主题曲。' },
  { title: '李白', titleT: '李白', artist: '李荣浩', artistT: '李榮浩', difficulty: 'medium',
    distractors: ['模特', '年少有为', '戒烟'], explain: '李荣浩 2013 年专辑《模特》曲目。' },
  { title: '隐形的翅膀', titleT: '隱形的翅膀', artist: '张韶涵', artistT: '張韶涵', difficulty: 'easy',
    distractors: ['淋雨一直走', '欧若拉', '梦里花'], explain: '张韶涵 2006 年专辑《潘朵拉》曲目，励志金曲。' },
  { title: '勇气', titleT: '勇氣', artist: '梁静茹', artistT: '梁靜茹', difficulty: 'easy',
    distractors: ['可惜不是你', '宁夏', '暖暖'], explain: '梁静茹 2000 年同名专辑主打歌。' },
];

// ---------------- 猜曲风：11 种曲风 × 2 首真实歌曲（刻意避开大热门单曲） ----------------
const GENRES = [
  {
    genre: '民谣', difficulty: 'easy',
    explain: '木吉他为主的编配、叙事性歌词、朴素的人声，是民谣的标志。',
    distractors: ['摇滚', '嘻哈说唱', '爵士'],
    tracks: [
      { title: '理想三旬', titleT: '理想三旬', artist: '陈鸿宇', artistT: '陳鴻宇' },
      { title: '盗将行', titleT: '盜將行', artist: '花粥', artistT: '花粥' },
    ],
  },
  {
    genre: '摇滚', difficulty: 'easy',
    explain: '电吉他失真音墙 + 强烈的鼓点 + 充满力量感的人声，是摇滚的典型特征。',
    distractors: ['民谣', '电子舞曲', '重金属'],
    tracks: [
      { title: '夜空中最亮的星', titleT: '夜空中最亮的星', artist: '逃跑计划', artistT: '逃跑計劃' },
      { title: '你要跳舞吗', titleT: '你要跳舞嗎', artist: '新裤子', artistT: '新褲子' },
    ],
  },
  {
    genre: '嘻哈说唱', difficulty: 'easy',
    explain: '以节奏化的念唱（rap）为主，配器服务于鼓点和贝斯律动。',
    distractors: ['R&B（节奏布鲁斯）', '电子舞曲', '摇滚'],
    tracks: [
      { title: '收敛水', titleT: '收斂水', artist: '蛋堡', artistT: '蛋堡' },
      { title: 'Coco Elva Tia', titleT: 'Coco Elva Tia', artist: '马思唯', artistT: 'Masiwei' },
    ],
  },
  {
    genre: '电子舞曲', difficulty: 'easy',
    explain: '合成器音色 + 机械化的四四拍律动，为舞池和耳机而生的电子声响。',
    distractors: ['嘻哈说唱', '摇滚', '民谣'],
    tracks: [
      { title: 'China-X', titleT: 'China-X', artist: '徐梦圆', artistT: '徐夢圓' },
      { title: 'Sing Me to Sleep', titleT: 'Sing Me to Sleep', artist: 'Alan Walker', artistT: 'Alan Walker' },
    ],
  },
  {
    genre: '爵士', difficulty: 'medium',
    explain: '摇摆的节奏、即兴感十足的旋律、松弛的唱腔， brass 与钢琴是常客。',
    distractors: ['布鲁斯', 'R&B（节奏布鲁斯）', '乡村音乐'],
    tracks: [
      { title: 'Garota de Ipanema', titleT: 'Garota de Ipanema', artist: '小野丽莎', artistT: '小野麗莎' },
      { title: "Can't Take My Eyes Off You", titleT: "Can't Take My Eyes Off You", artist: '王若琳', artistT: '王若琳' },
    ],
  },
  {
    genre: '布鲁斯', difficulty: 'hard',
    explain: '12 小节和声套路 + 蓝音（降三、降七音）+ 呼应式吉他，忧伤又慵懒。',
    distractors: ['爵士', '摇滚', '乡村音乐'],
    tracks: [
      { title: 'The Thrill Is Gone', titleT: 'The Thrill Is Gone', artist: 'B.B. King', artistT: 'B.B. King' },
      { title: 'Boom Boom', titleT: 'Boom Boom', artist: 'John Lee Hooker', artistT: 'John Lee Hooker' },
    ],
  },
  {
    genre: '乡村音乐', difficulty: 'medium',
    explain: '木吉他扫弦、叙事歌词、明朗的乡土旋律，偶尔点缀小提琴或班卓琴。',
    distractors: ['民谣', '布鲁斯', '摇滚'],
    tracks: [
      { title: 'Take Me Home, Country Roads', titleT: 'Take Me Home, Country Roads', artist: 'John Denver', artistT: 'John Denver' },
      { title: 'Jolene', titleT: 'Jolene', artist: 'Dolly Parton', artistT: 'Dolly Parton' },
    ],
  },
  {
    genre: 'R&B（节奏布鲁斯）', difficulty: 'medium',
    explain: '丝滑的转音、律动贝斯与鼓机节拍，人声是绝对主角。',
    distractors: ['嘻哈说唱', '爵士', '布鲁斯'],
    tracks: [
      { title: '爱爱爱', titleT: '愛愛愛', artist: '方大同', artistT: '方大同' },
      { title: '普通朋友', titleT: '普通朋友', artist: '陶喆', artistT: '陶喆' },
    ],
  },
  {
    genre: '重金属', difficulty: 'easy',
    explain: '厚重失真的吉他 riff、密集的双踩鼓点、撕裂或高亢的嘶吼唱腔。',
    distractors: ['摇滚', '电子舞曲', '嘻哈说唱'],
    tracks: [
      { title: 'Nothing Else Matters', titleT: 'Nothing Else Matters', artist: 'Metallica', artistT: 'Metallica' },
      { title: '梦回唐朝', titleT: '夢回唐朝', artist: '唐朝乐队', artistT: '唐朝樂隊' },
    ],
  },
  {
    genre: '雷鬼', difficulty: 'medium',
    explain: '反拍的吉他/键盘断奏（skank）+ 慵懒绕开正拍的贝斯，牙买加阳光味。',
    distractors: ['嘻哈说唱', 'R&B（节奏布鲁斯）', '民谣'],
    tracks: [
      { title: 'Three Little Birds', titleT: 'Three Little Birds', artist: 'Bob Marley', artistT: 'Bob Marley & The Wailers' },
      { title: '一朵花', titleT: '一朵花', artist: 'Matzka', artistT: 'Matzka' },
    ],
  },
  {
    genre: '古风', difficulty: 'easy',
    explain: '五声音阶旋律 + 民乐音色（古筝、笛子、琵琶），歌词多典故意象。',
    distractors: ['民谣', '爵士', '电子舞曲'],
    tracks: [
      { title: '倾尽天下', titleT: '傾盡天下', artist: '河图', artistT: '河圖' },
      { title: '锦鲤抄', titleT: '錦鯉抄', artist: '银临', artistT: '銀臨' },
    ],
  },
];

// ---------------- 搜索 / 下载 / 转码 ----------------
const BAD_TRACK = /\blive\b|cover|instrumental|karaoke|remix|piano version|钢琴|伴奏|演唱会/i;

const norm = (s) => (s ?? '').replace(/[\s·・'’'\-_.()（）]/g, '').toLowerCase();
const hasAlias = (name, ...aliases) => aliases.some((a) => a && norm(name).includes(norm(a)));

async function searchTrack(t) {
  const queries = [...new Set([`${t.artist} ${t.title}`, `${t.artistT} ${t.titleT}`, `${t.title} ${t.artist}`, t.titleT, t.title])];
  for (const store of STORES) {
    for (const q of queries) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&country=${store}&limit=10`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const pool = (data.results ?? []).filter((r) => r.previewUrl && !BAD_TRACK.test(r.trackName));
      const hit =
        pool.find((r) => hasAlias(r.trackName, t.title, t.titleT) && hasAlias(r.artistName, t.artist, t.artistT)) ??
        pool.find((r) => hasAlias(r.trackName, t.title, t.titleT));
      if (hit) return { hit, store };
    }
  }
  return null;
}

function trimToMp3(srcPath, outPath) {
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(CLIP_SS), '-t', String(CLIP_LEN), '-i', srcPath,
    '-af', `afade=t=in:st=0:d=0.3,afade=t=out:st=${CLIP_LEN - 2}:d=2,loudnorm=I=-16:TP=-1.5`,
    '-codec:a', 'libmp3lame', '-b:a', '112k', outPath,
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function produce(file, t) {
  const found = await searchTrack(t);
  if (!found) return { ok: false, file, want: `${t.artist}《${t.title}》` };
  const src = path.join(TMP_DIR, `${file}.m4a`);
  const res = await fetch(found.hit.previewUrl);
  if (!res.ok) return { ok: false, file, want: `${t.artist}《${t.title}》`, note: 'preview 下载失败' };
  fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  const out = path.join(OUT_DIR, `${file}.mp3`);
  trimToMp3(src, out);
  fs.unlinkSync(src);
  const kb = Math.round(fs.statSync(out).size / 1024);
  return { ok: true, file, want: `${t.artist}《${t.title}》`, got: `${found.hit.artistName}《${found.hit.trackName}》`, store: found.store, kb };
}

// ---------------- 主流程 ----------------
const questions = [];
const failures = [];
const report = [];

for (const [i, s] of SONGS.entries()) {
  const file = `song-${String(i + 1).padStart(2, '0')}`;
  const r = await produce(file, s);
  report.push(r);
  if (!r.ok) { failures.push(r); continue; }
  questions.push({
    id: `music-${String(questions.length + 1).padStart(3, '0')}`,
    category: 'music',
    difficulty: s.difficulty,
    topic: '猜歌名',
    question: '仔细听这段歌曲，它的歌名是？',
    audio: `/questions/audio/${file}.mp3`,
    audioCredit: `《${s.title}》${s.artist} · Apple iTunes 试听片段`,
    options: [s.title, ...s.distractors],
    correctAnswer: 0,
    explanation: s.explain,
  });
  await sleep(150);
}

for (const g of GENRES) {
  for (const t of g.tracks) {
    const n = questions.filter((q) => q.topic === '猜曲风').length + 1;
    const file = `genre-${String(n).padStart(2, '0')}`;
    const r = await produce(file, t);
    report.push(r);
    if (!r.ok) { failures.push(r); continue; }
    questions.push({
      id: `music-${String(questions.length + 1).padStart(3, '0')}`,
      category: 'music',
      difficulty: g.difficulty,
      topic: '猜曲风',
      question: '仔细听这段歌曲，它属于哪种曲风？',
      audio: `/questions/audio/${file}.mp3`,
      audioCredit: `《${t.title}》${t.artist} · Apple iTunes 试听片段`,
      options: [g.genre, ...g.distractors],
      correctAnswer: 0,
      explanation: g.explain,
    });
    await sleep(150);
  }
}

fs.writeFileSync(MUSIC_JSON, JSON.stringify(questions, null, 2) + '\n');

for (const r of report) {
  console.log(r.ok ? `✅ ${r.file}  想要 ${r.want}  →  实得 ${r.got} [${r.store}] ${r.kb}KB` : `❌ ${r.file}  未找到 ${r.want} ${r.note ?? ''}`);
}
console.log(`\n成功 ${report.filter((r) => r.ok).length} / ${report.length}，music.json 共 ${questions.length} 题`);
if (failures.length) console.log('失败条目需手动调整后重跑（脚本可重复执行，会覆盖重来）');
