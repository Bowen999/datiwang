#!/usr/bin/env node
/* 给中国文学题库按题干关键词打 topic 标签（三国/红楼梦/水浒/西游/说岳/杨家将），供抽题分层用。
 * 用法：node scripts/tag-topics.mjs　可重复运行：命中即写入/覆盖 topic，未命中的题保持原样。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../public/questions/chinese-literature.json', import.meta.url));

// 先命中先得；只看题干，选项里出现的人名不算
const TOPIC_RULES = [
  ['三国', /三国|曹操|刘备|诸葛|孔明|关羽|关公|云长|张飞|赵云|赤壁|孙权|周瑜|吕布|司马懿|董卓|貂蝉|桃园结义|官渡|夷陵|马超|黄忠|魏延|姜维|曹丕|曹植|鲁肃|吕蒙|陆逊|庞统|徐庶|袁绍|刘禅|阿斗|五虎上将|卧龙|凤雏|蜀汉|东吴|孙策|典韦|许褚|夏侯|荀彧|郭嘉|华佗|草船借箭|空城计|单刀赴会|过五关|华容道|长坂坡|隆中对|出师表|七擒孟获|祁山|赤兔|桃园|髀肉|望梅止渴|煮酒论|三顾茅庐|苦肉计|连环计|借东风|白帝城|乐不思蜀|刮骨疗毒|白衣渡江|水淹七军|走麦城|铜雀|鸡肋|得陇望蜀|才高八斗|势如破竹|七步诗/],
  ['红楼梦', /红楼|宝玉|黛玉|宝钗|王熙凤|凤姐|大观园|贾母|刘姥姥|贾府|荣国府|宁国府|金陵十二钗|晴雯|袭人|探春|湘云|妙玉|曹雪芹|石头记|贾政|贾琏|平儿|香菱|迎春|惜春|元春|秦可卿|李纨|巧姐/],
  ['水浒', /水浒|宋江|武松|林冲|李逵|鲁智深|梁山|吴用|晁盖|施耐庵|高俅|西门庆|潘金莲|武大郎|燕青|卢俊义|花荣|杨志|时迁|孙二娘|扈三娘|一百零八将|及时雨|黑旋风|生辰纲/],
  ['西游', /西游|孙悟空|唐僧|猪八戒|沙僧|沙和尚|白骨精|吴承恩|花果山|齐天大圣|紧箍|金箍|牛魔王|红孩儿|铁扇公主|芭蕉扇|火焰山|女儿国|白龙马|唐三藏|弼马温|蟠桃/],
  ['说岳', /^(?!.*满江红)(?=.*(说岳|岳飞|岳云|牛皋|秦桧|金兀术|兀术|精忠|岳家军|风波亭|岳母))/],
  ['杨家将', /杨家将|杨业|杨令公|杨六郎|杨延昭|穆桂英|佘太君|杨宗保|杨门女将|杨继业|天波府|潘仁美/],
];

const raw = readFileSync(FILE, 'utf8');
const questions = JSON.parse(raw);
const serialize = (arr) => JSON.stringify(arr, null, 2) + '\n';

// 序列化格式与现有文件不一致时直接退出，避免把整个文件的格式差异写进 diff
if (serialize(questions) !== raw) {
  console.error('chinese-literature.json 的格式与 JSON.stringify(arr, null, 2) 不一致，已中止。');
  process.exit(1);
}

const withTopic = (q, topic) => {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(q)) {
    if (k === 'topic') continue;
    out[k] = v;
    if (k === 'difficulty') {
      out.topic = topic;
      placed = true;
    }
  }
  if (!placed) out.topic = topic;
  return out;
};

const hits = new Map();
const tagged = questions.map((q) => {
  const rule = TOPIC_RULES.find(([, re]) => re.test(q.question));
  if (!rule) return q;
  const [topic] = rule;
  hits.set(topic, [...(hits.get(topic) ?? []), q]);
  return withTopic(q, topic);
});

for (const [topic] of TOPIC_RULES) {
  const list = hits.get(topic) ?? [];
  console.log(`\n[${topic}] ${list.length} 题`);
  for (const q of list) console.log(`  ${q.id}  ${q.question.replace(/\s+/g, ' ').slice(0, 44)}`);
}
console.log(`\n共命中 ${[...hits.values()].reduce((n, l) => n + l.length, 0)} / ${questions.length} 题`);

const out = serialize(tagged);
if (out === raw) {
  console.log('文件无变化');
} else {
  writeFileSync(FILE, out);
  console.log('已写入 chinese-literature.json');
}
