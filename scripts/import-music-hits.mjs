/**
 * 听歌猜猜放量：按 scripts/music-hits.txt 的歌单，从 Apple iTunes 公开试听 API 拉取 30 秒预览，
 * 截取 13 秒、统一响度、压成 64kbps 单声道，并把题目追加到 music.json。
 *
 * 可重复执行：music.json 里已有（按 audioCredit 判断）的歌会跳过，只处理新增的；已有题目不会被改动。
 * 用法: node scripts/import-music-hits.mjs [--limit N]
 *   --limit N  只处理歌单里前 N 首还没导入的歌（试跑用）
 * 依赖: ffmpeg（可用环境变量 FFMPEG 指定路径）、devDependency opencc-js（繁简转换，匹配 iTunes 繁体曲名）
 * 输出: public/questions/audio/hit-*.mp3 + public/questions/music.json
 * 仅供朋友间内部娱乐使用，请勿公开分发或商用。
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const OUT_DIR = new URL('../public/questions/audio/', import.meta.url).pathname;
const MUSIC_JSON = new URL('../public/questions/music.json', import.meta.url).pathname;
const HITS_TXT = new URL('./music-hits.txt', import.meta.url).pathname;
const TMP_DIR = '/tmp/music-import';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
// 搜索接口按出口 IP 限流，本机 IP 被限时可设 SEARCH_VIA=<ssh 主机名>，让搜索请求经该主机的 curl 发出（试听音频仍直接下载）
const SEARCH_VIA = process.env.SEARCH_VIA;
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const CLIP_SS = 2;   // 跳过试听开头 2 秒
const CLIP_LEN = 13; // 截取 13 秒
const SEARCH_GAP_MS = Number(process.env.SEARCH_GAP_MS || 2500); // iTunes 搜索接口约每分钟 20 次，超了会 403，保持间隔
const CREDIT_SUFFIX = ' · Apple iTunes 试听片段';
const TOPICS = new Set(['华语8090', '港台流行', '华语流行', '热歌榜', '00年代金曲', '10年代金曲']);
const DIFF = { e: 'easy', m: 'medium', h: 'hard' };
const LABEL = { 热歌榜: '热门歌曲', '10年代金曲': '热门歌曲' };

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Apple 的曲名/歌手名常用「妳祗姊昇蒨」这类字形，标点也不统一，比较前统一掉
const VARIANTS = { 妳: '你', 祗: '只', 祇: '只', 姊: '姐', 蒨: '倩', 昇: '升', '℃': '°c' };
const norm = (s) =>
  t2s(s ?? '').replace(/[妳祗祇姊蒨昇℃]/g, (c) => VARIANTS[c]).replace(/[\s·・'’\-_.,，、()（）[\]?？!！*~～:：]/g, '').toLowerCase();
const creditOf = (e) => `《${e.title}》${e.artist}${CREDIT_SUFFIX}`;

// ---------------- 解析歌单 ----------------
function parseHits(text) {
  const entries = [];
  let topic = null;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      topic = sec[1];
      if (!TOPICS.has(topic)) throw new Error(`music-hits.txt:${i + 1} 未知分区 [${topic}]`);
      continue;
    }
    const m = /^(\S+) ([MFG]): (.+)$/.exec(line);
    if (!m || !topic) throw new Error(`music-hits.txt:${i + 1} 格式不对: ${line}`);
    for (const item of m[3].split(' | ')) {
      const [title, d, year, ...fact] = item.split('/');
      if (!title || !DIFF[d]) throw new Error(`music-hits.txt:${i + 1} 歌曲条目不对: ${item}`);
      entries.push({
        topic, artist: m[1], g: m[2], title: title.trim(), d,
        year: year ? Number(year) : undefined,
        fact: fact.join('/').trim() || undefined,
      });
    }
  }
  return entries;
}

// ---------------- 搜索 / 下载 / 转码 ----------------
// iTunes 返回繁体，过滤前先转简体；曲名和专辑名都要查（现场专辑里的曲名可能不带 live 字样）
const BAD_TRACK = /live|现场|演唱会|concert|cover|翻唱|instrumental|karaoke|伴奏|伴唱|纯音乐|演奏|配乐|钢琴|piano|remix|\bdj\b|demo|铃声|acoustic|unplugged|乡[摇谣]|摇滚版|重生版|好声音|\d\.\dx|trance|混音|新版|重遇版|未眠版|春晚版/i;
const BAD_ALBUM = /live|现场|演唱会|concert|巡回|remix|karaoke|伴奏|钢琴|piano|翻唱|cover/i;

/** 去掉括号后缀的简体曲名，如「同桌的你 (95年红星版)」→「同桌的你」 */
const baseName = (trackName) => t2s(trackName).replace(/[（(][^）)]*[）)]/g, '').trim();

/** 曲名是否就是这首歌：去括号后完全一致；≥3 字的歌名再允许「歌名 - 版本」这类分隔符后缀。单字/双字歌名不放宽，免得《爱》匹配到《爱你》 */
const titleOk = (trackName, title) => {
  const name = baseName(trackName);
  if (norm(name) === norm(title)) return true;
  const lower = name.toLowerCase();
  const ti = title.toLowerCase();
  return norm(title).length >= 3 && lower.startsWith(ti) && /^\s*[-—:：]/.test(lower.slice(ti.length));
};

const FETCH_TIMEOUT_MS = 20000; // Node 的 fetch 默认几乎不超时，连接卡住会干等好几分钟

const BACKOFF_MS = [3000, 10000, 30000, 60000];

async function fetchRetry(url, read) {
  for (const wait of BACKOFF_MS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) return await read(res);
      if (res.status !== 403 && res.status !== 429 && res.status < 500) return null;
    } catch { /* 超时/网络抖动，走重试 */ }
    await sleep(wait);
  }
  return null;
}

const curlViaSsh = (url) =>
  new Promise((resolve, reject) => {
    const args = ['-o', 'BatchMode=yes', '-o', 'ControlMaster=auto', '-o', 'ControlPath=/tmp/music-ssh-%C', '-o', 'ControlPersist=120',
      SEARCH_VIA, `curl -s -m 20 '${url.replaceAll("'", '%27')}'`]; // 撇号要转义，否则会破坏这里的单引号
    execFile('ssh', args, { maxBuffer: 8e6, timeout: 30000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

async function fetchJsonVia(url) {
  for (const wait of BACKOFF_MS) {
    try {
      return JSON.parse(await curlViaSsh(url));
    } catch { /* 被限流时返回的不是 JSON，走重试 */ }
    await sleep(wait);
  }
  return null;
}

const fetchJson = (url) => (SEARCH_VIA ? fetchJsonVia(url) : fetchRetry(url, (res) => res.json()));
const fetchBuf = (url) => fetchRetry(url, async (res) => Buffer.from(await res.arrayBuffer()));

const artistOk = (artist, name) => {
  const a = norm(artist);
  // 合唱署名（「陈昇 & 刘佳慧」「A feat. B」）先拆开，短名字（如 en、陈升）按片段完全相等来比，防止误配
  const parts = name.split(/[&＆,，、/]|\bfeat\.?|\bwith\b/i).map(norm).filter(Boolean);
  if (a.length < 3) return parts.includes(a);
  return norm(name).includes(a) || parts.some((p) => p.length >= 3 && a.includes(p));
};

async function searchTrack(e) {
  // TW 与 HK 目录基本相同、CN 区搜不到华语歌，所以只试：TW 繁体 → TW 简体 → HK 繁体，最多 3 次请求
  const trad = s2t(`${e.artist} ${e.title}`);
  const simp = `${e.artist} ${e.title}`;
  const attempts = [['TW', trad], ...(simp !== trad ? [['TW', simp]] : []), ['HK', trad]];
  for (const [store, q] of attempts) {
    const data = await fetchJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&country=${store}&limit=15`,
    );
    await sleep(SEARCH_GAP_MS);
    const pool = (data?.results ?? []).filter(
      (r) => r.previewUrl && r.trackTimeMillis > 60000 && !BAD_TRACK.test(t2s(r.trackName).replace(e.title, '')) &&
        !BAD_ALBUM.test(t2s(r.collectionName ?? '')) && titleOk(r.trackName, e.title) && artistOk(e.artist, r.artistName),
    );
    if (!pool.length) continue;
    // 曲名（去括号后）完全一致的优先；iTunes 的最早发行年份可作为年份自检
    const hit = pool.find((r) => norm(baseName(r.trackName)) === norm(e.title)) ?? pool[0];
    const years = pool.map((r) => Number((r.releaseDate ?? '').slice(0, 4))).filter(Boolean);
    return { hit, store, appleYear: years.length ? Math.min(...years) : undefined };
  }
  return null;
}

function trimToMp3(srcPath, outPath) {
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(CLIP_SS), '-t', String(CLIP_LEN), '-i', srcPath,
    '-af', `afade=t=in:st=0:d=0.3,afade=t=out:st=${CLIP_LEN - 2}:d=2,loudnorm=I=-16:TP=-1.5`,
    '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', outPath,
  ]);
}

async function produce(e, file) {
  const found = await searchTrack(e);
  if (!found) return { ok: false, note: '未找到' };
  const buf = await fetchBuf(found.hit.previewUrl);
  if (!buf) return { ok: false, note: 'preview 下载失败' };
  const src = path.join(TMP_DIR, `${file}.m4a`);
  fs.writeFileSync(src, buf);
  const out = path.join(OUT_DIR, `${file}.mp3`);
  trimToMp3(src, out);
  fs.unlinkSync(src);
  return {
    ok: true, kb: Math.round(fs.statSync(out).size / 1024), store: found.store, appleYear: found.appleYear,
    got: `${t2s(found.hit.artistName)}《${t2s(found.hit.trackName)}》 ${t2s(found.hit.collectionName ?? '')}`,
  };
}

// ---------------- 出题 ----------------
const hash = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
};
const rngOf = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = (arr, rnd) => arr.map((v) => [rnd(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const pickN = (arr, n, rnd) => shuffled(arr, rnd).slice(0, n);
const uniqBy = (arr, key) => [...new Map(arr.map((v) => [key(v), v])).values()];

function buildQuestion(e, ctx, year) {
  const rnd = rngOf(hash(`${e.artist}${e.title}`));
  const { all } = ctx;
  const sameTopic = all.filter((x) => x.topic === e.topic);
  const label = LABEL[e.topic] ?? '经典歌曲';
  const yearNote = year ? `${year} 年发行的` : '';
  const fact = e.fact ? e.fact : '';

  // 约 1/4 的歌改问歌手：同 topic 里至少有 3 位不同的同性别（或同为组合）歌手才出，且干扰项歌手不能唱过同名歌
  const wantArtistQ = hash(`${e.artist}${e.title}!`) % 4 === 0;
  if (wantArtistQ) {
    const sameTitleArtists = new Set(all.filter((x) => norm(x.title) === norm(e.title)).map((x) => x.artist));
    const cands = uniqBy(
      sameTopic.filter((x) => x.artist !== e.artist && x.g === e.g && !sameTitleArtists.has(x.artist)),
      (x) => x.artist,
    );
    if (cands.length >= 3) {
      return {
        difficulty: DIFF[e.d] === 'easy' ? 'medium' : DIFF[e.d],
        question: '仔细听这段歌曲，演唱者是谁？',
        options: [e.artist, ...pickN(cands, 3, rnd).map((x) => x.artist)],
        explanation: `这首《${e.title}》由${e.artist}演唱${year ? `（${year} 年）` : ''}。${fact}`,
      };
    }
  }

  // 猜歌名：优先放 1 首同歌手的其他歌当干扰项，其余从同 topic 里补；标题互相包含的不放一起，避免有歧义
  const clash = (a, b) => norm(a).includes(norm(b)) || norm(b).includes(norm(a));
  const usable = (x) => !clash(x.title, e.title);
  const sameArtist = uniqBy(all.filter((x) => x.artist === e.artist && usable(x)), (x) => x.title);
  const others = uniqBy(sameTopic.filter((x) => x.artist !== e.artist && usable(x)), (x) => x.title);
  const dis = [];
  for (const x of [...pickN(sameArtist, 1, rnd), ...shuffled(others, rnd)]) {
    if (dis.length === 3) break;
    if (!dis.some((d) => clash(d.title, x.title))) dis.push(x);
  }
  if (dis.length < 3) return null;
  return {
    difficulty: DIFF[e.d],
    question: '仔细听这段歌曲，它的歌名是？',
    options: [e.title, ...dis.map((x) => x.title)],
    explanation: `《${e.title}》是${e.artist}${yearNote ? ` ${yearNote}` : '的'}${label}。${fact}`,
  };
}

// ---------------- 主流程 ----------------
const all = parseHits(fs.readFileSync(HITS_TXT, 'utf8'));
const existing = fs.existsSync(MUSIC_JSON) ? JSON.parse(fs.readFileSync(MUSIC_JSON, 'utf8')) : [];
const doneCredits = new Set(existing.map((q) => q.audioCredit));
const usedFiles = new Set(existing.map((q) => Number(/\/hit-(\d+)\.mp3$/.exec(q.audio ?? '')?.[1] ?? 0)));
const takeFileNo = () => {
  let n = 1;
  while (usedFiles.has(n)) n++;
  usedFiles.add(n);
  return n;
};
let nextId = Math.max(0, ...existing.map((q) => Number(/^music-(\d+)$/.exec(q.id)?.[1] ?? 0))) + 1;

// 已确认查不到的歌记在临时目录里，重启时不再重复查；--retry-failed 强制重查
const FAILED_FILE = path.join(TMP_DIR, 'failed.json');
const knownFailed = new Set(
  process.argv.includes('--retry-failed') || !fs.existsSync(FAILED_FILE) ? [] : JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8')),
);
const todo = all.filter((e) => !doneCredits.has(creditOf(e)) && !knownFailed.has(creditOf(e)));
console.log(`歌单 ${all.length} 首，已导入 ${all.length - todo.length} 首，待处理 ${Math.min(todo.length, LIMIT)} 首`);

const questions = [];
const failed = [];
// 出题只依赖歌单本身，所以每成功一首就出题，并定期落盘：中途被打断也不会留下没有题目的孤儿音频
const flush = () => fs.writeFileSync(MUSIC_JSON, JSON.stringify([...existing, ...questions], null, 2) + '\n');
for (const e of todo.slice(0, LIMIT)) {
  const no = takeFileNo();
  const file = `hit-${String(no).padStart(3, '0')}`;
  const want = `${e.artist}《${e.title}》`;
  const t0 = Date.now();
  const r = await produce(e, file);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok) {
    usedFiles.delete(no);
    failed.push(`${want} ${r.note}`);
    if (r.note === '未找到') knownFailed.add(creditOf(e));
    fs.writeFileSync(FAILED_FILE, JSON.stringify([...knownFailed]));
    console.log(`❌ ${want}  ${r.note} (${secs}s)`);
    continue;
  }
  // 歌单年份比 iTunes 最早发行年份还晚，说明我记错了：宁可不写年份
  const conflict = e.year && r.appleYear && r.appleYear < e.year;
  const built = buildQuestion(e, { all }, conflict ? undefined : e.year);
  if (!built) {
    usedFiles.delete(no);
    failed.push(`${want} 同 topic 可用干扰项不足`);
    console.log(`❌ ${want}  同 topic 可用干扰项不足`);
    continue;
  }
  console.log(`✅ ${want} → ${r.got} [${r.store}] ${r.kb}KB (${secs}s)${conflict ? `  ⚠️ 年份冲突：歌单 ${e.year}，iTunes 最早 ${r.appleYear}，已不写年份` : ''}`);
  questions.push({
    id: `music-${String(nextId++).padStart(3, '0')}`,
    category: 'music',
    difficulty: built.difficulty,
    topic: e.topic,
    question: built.question,
    audio: `/questions/audio/${file}.mp3`,
    audioCredit: creditOf(e),
    options: built.options,
    correctAnswer: 0,
    explanation: built.explanation,
  });
  if (questions.length % 10 === 0) flush();
}
flush();

const byTopic = {};
for (const q of questions) byTopic[q.topic] = (byTopic[q.topic] ?? 0) + 1;
console.log(`\n新增 ${questions.length} 题 ${JSON.stringify(byTopic)}；失败 ${failed.length} 首；music.json 共 ${existing.length + questions.length} 题`);
if (failed.length) fs.writeFileSync(path.join(TMP_DIR, 'failed.txt'), failed.join('\n') + '\n');
