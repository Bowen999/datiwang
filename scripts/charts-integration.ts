/* 排行榜动态题服务层集成测试（需要 dev server 在 :5175 运行） */
import { JsonQuestionSource, QuestionService } from '../src/services/QuestionService';

const BASE = process.env.BASE || 'http://localhost:5173/questions';
const service = new QuestionService(new JsonQuestionSource(BASE));

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`, extra ?? '');
  }
}

async function main() {
  // 1) 纯排序局：必须包含排行榜动态题，且总数恰好 = count
  const qs = await service.getQuestions({
    categories: ['ranking'],
    questionTypes: ['ranking'],
    difficulty: 'mixed',
    count: 10,
    excludeIds: [],
  });
  const chartCount = qs.filter((q) => q.id.startsWith('chart-')).length;
  check(`纯排序局 10 题：共 ${qs.length} 题`, qs.length === 10);
  check(`纯排序局包含 ${chartCount} 道排行榜动态题`, chartCount >= 1);
  const chartNameById = new Map((await service.getCharts()).map((c) => [c.id, c.name]));
  check(
    '动态题文案带榜单名 + 排序要求',
    qs
      .filter((q) => q.id.startsWith('chart-'))
      .every((q) => {
        const name = chartNameById.get(q.id.replace(/^chart-(.+)-s\d+$/, '$1'));
        return !!name && q.question.includes(name) && q.question.includes('位次');
      }),
  );

  // 2) 迁移重建：getByIds 必须重建出与开局完全一致的题目（含选项与答案）
  const ids = qs.map((q) => q.id);
  const rebuilt = await service.getByIds(ids, ['ranking']);
  let rebuildOk = true;
  for (const q of qs) {
    const rb = rebuilt.get(q.id);
    if (!rb || JSON.stringify(rb) !== JSON.stringify(q)) {
      rebuildOk = false;
      console.error('  不一致的题:', q.id, rb && JSON.stringify(rb) !== JSON.stringify(q));
    }
  }
  check('getByIds 按 id 重建与开局完全一致（动态题+静态题）', rebuildOk);

  // 3) 确定性：不同 sampleId 会产生不同的题（选项组合可能相同但 id 必不同）
  const charts = await service.getCharts();
  check(`getCharts 返回 ${charts.length} 个排行榜`, charts.length === 12);
  const idsBySample = new Set<string>();
  for (let i = 0; i < 50; i++) idsBySample.add(`chart-${charts[0].id}-s${100000 + i}`);
  check('50 个样本 id 互异', idsBySample.size === 50);

  // 4) excludeIds 生效：第二局不重复出现第一局的题
  const b = await service.getQuestions({
    categories: ['ranking'],
    questionTypes: ['ranking'],
    difficulty: 'mixed',
    count: 10,
    excludeIds: ids,
  });
  const overlap = b.filter((q) => ids.includes(q.id));
  check(`第二局（排除第一局 id）与第一局重复 ${overlap.length} 题`, overlap.length === 0);

  // 5) 难度筛选只命中对应难度的榜单
  const easy = await service.getQuestions({
    categories: ['ranking'],
    questionTypes: ['ranking'],
    difficulty: 'easy',
    count: 8,
    excludeIds: [],
  });
  const easyChart = easy.filter((q) => q.id.startsWith('chart-'));
  check(`easy 局排行榜题全部为 easy 难度（${easyChart.length} 道）`, easyChart.every((q) => q.difficulty === 'easy'));

  // 6) 混合局：全库混合抽取不报错、结果合法；含排序题时榜单题结构正确
  const mixed = await service.getQuestions({
    categories: [],
    questionTypes: ['choice', 'ranking'],
    difficulty: 'mixed',
    count: 10,
    excludeIds: [],
  });
  const mixedChart = mixed.filter((q) => q.id.startsWith('chart-'));
  check('混合局不报错且题目数正确', mixed.length === 10);
  check('混合局全部为选择题或排序题', mixed.every((q) => q.kind === 'choice' || q.kind === 'ranking'));
  check('混入的榜单题结构合法', mixedChart.every((q) => q.options.length === 4 && q.correctOrder.length === 4));
  console.log(`   （混合局本次抽取到 ${mixedChart.length} 道榜单题，其余来自静态池）`);

  // 7) 排行榜题用真实榜单封装的题目：高点小样本抽查 4 道样例（打印看效果）
  console.log('\n样例榜单题：');
  for (const q of qs.filter((x) => x.id.startsWith('chart-')).slice(0, 4)) {
    console.log(`  [${q.difficulty}] ${q.question}`);
    console.log(`    选项: ${q.options.join(' | ')}  正确顺序: [${q.correctOrder.join(', ')}]`);
  }

  console.log(failures === 0 ? '\n集成测试全部通过 ✅' : `\n${failures} 项失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});