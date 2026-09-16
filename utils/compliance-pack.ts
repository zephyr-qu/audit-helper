import { uid } from './id';
import type { KeywordGroup, Level, LevelAction, Settings } from './types';

/**
 * 内置合规规则包：依据《BOSS直聘招聘行为管理规范》(2023-12 版) 的违规细则整理。
 * 仅用于本地自查提示，不涉及任何平台接口调用。
 */
export interface PackGroup {
  name: string;
  /** 对应档位：6 种处置动作之一 */
  level: LevelAction;
  /** 官方条款依据 */
  clause: string;
  /** 处理建议 */
  advice: string;
  keywords: string[];
  /** 关键词按正则解释（用于手机号、微信变体等） */
  useRegex?: boolean;
}

/** 默认档位：与 6 种处置动作一一对应 */
export const PACK_LEVELS: Level[] = [
  { id: 'lv_reject', name: '建议驳回', color: '#ef4444', style: 'auto', action: 'reject' },
  { id: 'lv_revise', name: '退回修改', color: '#f97316', style: 'auto', action: 'revise' },
  { id: 'lv_verify', name: '人工核实', color: '#f59e0b', style: 'auto', action: 'verify' },
  { id: 'lv_qualify', name: '补充资质', color: '#3b82f6', style: 'auto', action: 'qualify' },
  { id: 'lv_warn', name: '教育警示', color: '#8b5cf6', style: 'auto', action: 'warn' },
  { id: 'lv_hint', name: '仅作提示', color: '#10b981', style: 'auto', action: 'hint' },
];

const LEVEL_ID_BY_ACTION: Record<LevelAction, string> = {
  reject: 'lv_reject',
  revise: 'lv_revise',
  verify: 'lv_verify',
  qualify: 'lv_qualify',
  warn: 'lv_warn',
  hint: 'lv_hint',
};

export const BOSS_AUDIT_PACK: PackGroup[] = [
  {
    name: '色情低俗',
    level: 'reject',
    clause: '5.2',
    advice: '删除涉黄、擦边、陪侍类描述，此类职位禁止发布',
    keywords: [
      '陪酒',
      '陪睡',
      '陪侍',
      '有偿陪侍',
      '外围',
      '招嫖',
      '卖淫',
      '性交易',
      '裸照',
      '大尺度',
      '擦边',
      '情趣内衣',
      '色情',
      '情色',
      '露骨',
      '三围',
      '贴身服务',
      '私密服务',
      '上门服务',
      '花场',
      '涉黄',
      '成人内容',
    ],
  },
  {
    name: '赌博彩票',
    level: 'reject',
    clause: '5.3',
    advice: '赌场、博彩、网络彩票相关职位一律不予发布',
    keywords: [
      '荷官',
      '发牌员',
      '赌场',
      '博彩',
      '菠菜',
      '六合彩',
      '网络彩票',
      '彩票代理',
      '棋牌代理',
      '真人视讯',
      '体育投注',
      '捕鱼机',
      '投注',
    ],
  },
  {
    name: '诈骗刷单',
    level: 'reject',
    clause: '5.7',
    advice: '删除刷单、垫付、返现、投资入股等表述，属诈骗类违规',
    keywords: [
      '刷单',
      '垫付',
      '返现',
      '返利',
      '杀猪盘',
      '套路贷',
      '整容贷',
      '美容贷',
      '投资入股',
      '高额回报',
      '稳赚不赔',
      '点赞赚钱',
      '试玩赚钱',
      '看广告赚钱',
      '打字赚钱',
      '配音赚钱',
      '任务赚钱',
      '兼职赚钱',
      '日结任务',
      '导师带单',
      '无需经验即可入职',
    ],
  },
  {
    name: '网络灰产',
    level: 'reject',
    clause: '5.9.3 / 5.17',
    advice: '涉及账号、卡证买卖或代收代付的职位属灰产，禁止发布',
    keywords: [
      '跑分',
      '四件套',
      '银行卡出租',
      '出租银行卡',
      '手机卡出租',
      '租借银行卡',
      '身份证出租',
      '微信号出租',
      '账号出租',
      '刷脸认证',
      '代收款',
      '代充值',
      '虚拟账号交易',
      '买量',
      '刷好评',
      '删差评',
      '代骂',
      '催收',
      '暴力催收',
    ],
  },
  {
    name: '违法业务',
    level: 'reject',
    clause: '5.16 / 5.17',
    advice: '删除代孕、资质挂靠、征信修复、虚拟货币、代考代写等违法业务信息',
    keywords: [
      '代孕',
      '捐卵',
      '性别筛选',
      '资质挂靠',
      '挂靠证书',
      '代考',
      '代写论文',
      '征信修复',
      '征信包装',
      '停息挂账',
      '虚拟货币',
      '虚拟币',
      '洗钱',
      '水军',
      '信用卡套现',
      '积分兑换',
      'AB贷',
      '保本保收益',
      '贩卖简历',
      '账号买卖',
      '买卖公职',
      '枪支',
      '军火',
      '毒品',
      '传销',
      '拉人头',
      '团队计酬',
      '分销返佣',
    ],
  },
  {
    name: '收费押金',
    level: 'verify',
    clause: '5.13',
    advice: '不得以任何名义向求职者收费（押金、培训费、服装费、体检费、中介费等）',
    keywords: [
      '押金',
      '保证金',
      '入职费',
      '培训费',
      '学费',
      '服装费',
      '材料费',
      '体检费',
      '住宿费',
      '被褥费',
      '工牌费',
      '办卡费',
      '服务费',
      '介绍费',
      '中介费',
      '派遣费',
      '返费',
      '加盟费',
      '加盟',
      '合伙人',
      '入职交钱',
      '租车',
      '贷款买车',
      '押金退还',
    ],
  },
  {
    name: '就业歧视',
    level: 'revise',
    clause: '5.14',
    advice: '删除性别、地域、年龄、婚育等与岗位无关的限制条件',
    keywords: [
      '限男性',
      '限女性',
      '仅限男性',
      '仅限女性',
      '不招女性',
      '不招男性',
      '限本地',
      '本地户口',
      '仅限本市',
      '不招外地',
      '限汉族',
      '不招少数民族',
      '未婚',
      '已育',
      '已生育',
      '已婚已育优先',
      '形象气质佳',
      '身高要求',
      '35岁以下',
      '30岁以下',
      '年龄不超过',
    ],
  },
  {
    name: '薪资合规',
    level: 'revise',
    clause: '5.12',
    advice: '禁止无底薪、薪资面议或明显虚高的薪资描述',
    keywords: [
      '无底薪',
      '零底薪',
      '试用期不发工资',
      '押工资',
      '压一个月工资',
      '扣工资',
      '薪资面议',
      '工资面议',
      '面聊薪资',
      '日结过万',
      '月入十万',
      '轻松过万',
      '高薪日结',
    ],
  },
  {
    name: '联系方式',
    level: 'revise',
    clause: '5.9.1 / 5.18',
    advice: '删除微信、手机号、QQ、邮箱等联系方式，改用平台内沟通工具',
    useRegex: true,
    keywords: [
      '(1[3-9]\\d)\\s?-?\\s?(\\d{4})\\s?-?\\s?(\\d{4})',
      '(微信|微 ?信|薇信|威信|vx|wx|weixin|wechat|加 ?[vV微]|➕ ?[vV])',
      '(QQ|扣扣|企鹅号)',
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.(com|cn|net|org|edu)',
    ],
  },
  {
    name: '广告引流',
    level: 'revise',
    clause: '5.18',
    advice: '删除寻求合作、代理招商、私聊引流等非招聘内容',
    keywords: [
      '寻求合作',
      '招商',
      '招募代理',
      '推广返佣',
      '推荐奖励',
      '拉新奖励',
      '私域',
      '加粉',
      '加群',
      '进群',
      '私聊',
      '扫码',
      '加我',
      '引流',
      '点击链接',
    ],
  },
  {
    name: '用工手续',
    level: 'verify',
    clause: '5.11 / 5.15',
    advice: '不得约定不签合同、不缴社保，或扣押证件、要求担保抵押',
    keywords: [
      '不交社保',
      '不缴社保',
      '不缴公积金',
      '无五险一金',
      '不签合同',
      '劳务协议代替',
      '扣押身份证',
      '押身份证',
      '需要担保',
      '抵押',
      '离职退款',
    ],
  },
  {
    name: '工时加班',
    level: 'warn',
    clause: '5.15.3',
    advice: '不得发布超出法定工时、侵害休息权的岗位要求',
    keywords: ['996', '007', '大小周', '单休', '无休', '两班倒', '通宵', '超时加班', '无节假日'],
  },
  {
    name: '不实招聘',
    level: 'verify',
    clause: '5.20 / 5.21',
    advice: '不得以引流为目的发布长期挂靠或不真实的职位信息',
    keywords: [
      '常年招聘',
      '长期招人',
      '大量招',
      '公司直招',
      '内推保过',
      '包入职',
      '包录取',
      '保过',
      '稳定出工',
    ],
  },
  {
    name: '代招中介',
    level: 'qualify',
    clause: '5.28 / 5.29',
    advice: '除总分公司外不支持代招；人力资源服务机构需具备许可证',
    keywords: ['代招', '代招聘', '第三方代招', '劳务派遣', '人力资源服务', '外包派遣', '派遣工'],
  },
  {
    name: '受限行业',
    level: 'qualify',
    clause: '5.29.2',
    advice: '按摩、KTV、保险、网约车等属资质管控行业，需核实资质材料',
    keywords: [
      '按摩',
      '足疗',
      '足浴',
      '洗浴',
      '桑拿',
      'spa',
      '会所',
      '夜总会',
      'KTV',
      '酒吧',
      '棋牌室',
      '网约车',
      '货运',
      '保安',
      '保险代理',
      '月子中心',
    ],
  },
  {
    name: '风险职位',
    level: 'verify',
    clause: '5.32 ~ 5.35',
    advice: '该类职位风险较高，需人工确认资质与业务模式',
    keywords: [
      '网络兼职',
      '手机兼职',
      '宝妈兼职',
      '学生兼职',
      '在家兼职',
      '手工活',
      '打字员',
      '兼职模特',
      '陪玩',
      '游戏陪玩',
      '陪聊',
      '哄睡',
      '上门家教',
      '家教',
      '直销',
      '试睡员',
      '体验官',
      '探店',
      '驻外',
      '出海',
      '远洋',
      '出国劳务',
      '境外工作',
      '假扮',
      '酒托',
      '医托',
      '婚托',
      '医疗试验',
    ],
  },
  {
    name: '招生培训',
    level: 'hint',
    clause: '5.31',
    advice: '以招聘为名开展招生培训的职位风险较高，需确认是否收费',
    keywords: [
      '学徒',
      '免费培训',
      '先培训后上岗',
      '包教包会',
      '包分配',
      '推荐就业',
      '考证班',
      '考证',
      '包就业',
      '零基础培训',
    ],
  },
];

function packToGroup(pack: PackGroup, id: string): KeywordGroup {
  return {
    id,
    name: pack.name,
    levelId: LEVEL_ID_BY_ACTION[pack.level],
    enabled: true,
    keywords: [...pack.keywords],
    useRegex: pack.useRegex,
    clause: pack.clause,
    advice: pack.advice,
  };
}

/** 规则包默认分组（首次安装即为这套配置） */
export function buildPackGroups(): KeywordGroup[] {
  return BOSS_AUDIT_PACK.map((pack) => packToGroup(pack, uid('g')));
}

function ensurePackLevels(levels: Level[]): Level[] {
  const existing = new Set(levels.map((level) => level.id));
  const missing = PACK_LEVELS.filter((level) => !existing.has(level.id)).map((level) => ({
    ...level,
  }));
  return missing.length > 0 ? [...levels, ...missing] : levels;
}

/**
 * 应用规则包（覆盖式）：档位统一为 6 种处置档位，
 * 同名分组的内容被规则包覆盖，其余自定义分组保留。
 */
export function applyCompliancePack(settings: Settings): Settings {
  const groups: KeywordGroup[] = [...settings.groups];

  for (const pack of BOSS_AUDIT_PACK) {
    const existingIndex = groups.findIndex((group) => group.name === pack.name);
    if (existingIndex >= 0) {
      groups[existingIndex] = packToGroup(pack, groups[existingIndex]!.id);
    } else {
      groups.push(packToGroup(pack, uid('g')));
    }
  }

  const levelIds = new Set(PACK_LEVELS.map((level) => level.id));
  const normalized = groups.map((group) =>
    levelIds.has(group.levelId) ? group : { ...group, levelId: LEVEL_ID_BY_ACTION.verify },
  );

  return {
    ...settings,
    levels: PACK_LEVELS.map((level) => ({ ...level })),
    groups: normalized,
  };
}

/**
 * 合并式升级规则包：只补充新增的分组与关键词，
 * 不覆盖用户改过的档位名、分组名、已删除的词组开关等自定义内容。
 */
export function mergeCompliancePack(settings: Settings): Settings {
  const groups: KeywordGroup[] = [...settings.groups];

  for (const pack of BOSS_AUDIT_PACK) {
    const index = groups.findIndex((group) => group.name === pack.name);
    if (index < 0) {
      groups.push(packToGroup(pack, uid('g')));
      continue;
    }
    const current = groups[index]!;
    const merged = new Set(current.keywords);
    for (const keyword of pack.keywords) merged.add(keyword);
    groups[index] = {
      ...current,
      keywords: [...merged],
      useRegex: current.useRegex ?? pack.useRegex,
      clause: current.clause || pack.clause,
      advice: current.advice || pack.advice,
    };
  }

  const levelIds = new Set(settings.levels.map((level) => level.id));
  const groupsNormalized = groups.map((group) =>
    levelIds.has(group.levelId) ? group : { ...group, levelId: settings.levels[0]?.id ?? 'lv_warn' },
  );

  return {
    ...settings,
    levels: ensurePackLevels(settings.levels),
    groups: groupsNormalized,
  };
}

/** 最初的模板示例分组，v1 数据迁移时清理掉 */
export const LEGACY_SAMPLE_GROUP_IDS = ['g_violation', 'g_sensitive', 'g_ad'];
