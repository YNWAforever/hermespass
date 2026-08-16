/**
 * Marketing copy for the Chinese site, authored in Simplified Chinese.
 * Traditional Chinese is generated at render time via OpenCC conversion.
 */

export type ZhSection =
  | {
      kind: "cards";
      eyebrow: string;
      title: string;
      description?: string;
      items: Array<{ title: string; body: string }>;
    }
  | {
      kind: "compare";
      eyebrow: string;
      title: string;
      description?: string;
      beforeLabel: string;
      afterLabel: string;
      items: Array<{ title: string; before: string; after: string }>;
    }
  | {
      kind: "steps";
      eyebrow: string;
      title: string;
      description?: string;
      items: Array<{ title: string; body: string }>;
    }
  | {
      kind: "table";
      eyebrow: string;
      title: string;
      description?: string;
      columns: string[];
      rows: string[][];
    }
  | {
      kind: "faq";
      eyebrow: string;
      title: string;
      description?: string;
      items: Array<{ q: string; a: string }>;
    }
  | {
      kind: "stats";
      items: Array<{ label: string; value: string }>;
    }
  | {
      kind: "code";
      eyebrow: string;
      title: string;
      description?: string;
      code: string;
    }
  | {
      kind: "plans";
      eyebrow: string;
      title: string;
      description?: string;
      items: Array<{
        name: string;
        price: string;
        blurb: string;
        features: string[];
        highlight?: boolean;
      }>;
    };

export type ZhPageContent = {
  meta: { title: string; description: string };
  hero: { eyebrow: string; title: string; description: string };
  sections: ZhSection[];
  cta?: { title: string; description: string };
};

export const ZH_UI = {
  brandTagline: "AI 智能体的数字护照与合规基础设施：可验证身份、实时授权、可证明审计。",
  nav: [
    { slug: "product", label: "产品" },
    { slug: "use-cases", label: "应用场景" },
    { slug: "benefits", label: "核心价值" },
    { slug: "industries", label: "行业方案" },
    { slug: "compliance-standards", label: "合规标准" },
    { slug: "security", label: "信任中心" },
    { slug: "roi-calculator", label: "ROI 试算" },
    { slug: "faq", label: "常见问题" },
    { slug: "pricing", label: "价格" },
  ],
  demo: "在线演示",
  bookBriefing: "预约技术简报",
  toggleNav: "切换导航",
  footerPlatform: "平台",
  footerCompany: "公司",
  footerStandards: "我们遵循的标准",
  standards: [
    "W3C 可验证凭证 2.0（Verifiable Credentials）",
    "W3C 去中心化标识符（DID）",
    "IMDA 生成式 AI 治理框架",
    "HKMA GenA.I. 沙盒",
  ],
  footerNote: "HermesPass。在线演示中展示的产品界面使用模拟数据。",
  defaultCta: {
    title: "看看 KYA 如何管住你的智能体",
    description: "30 分钟技术简报：护照签发、网关策略、支出管控，以及监管机构会索取的审计导出。",
  },
  ctaPrimary: "预约技术简报",
  ctaSecondary: "浏览在线演示",
  languageLabel: "语言",
} as const;

const CTA_DEFAULT = ZH_UI.defaultCta;

export const ZH_PAGES: Record<string, ZhPageContent> = {
  index: {
    meta: {
      title: "HermesPass — 面向企业 AI 智能体的 KYA 数字护照与合规基础设施",
      description:
        "HermesPass 为每一个企业 AI 智能体签发可验证数字护照，提供实时策略网关、受限支付额度与防篡改审计链。",
    },
    hero: {
      eyebrow: "KNOW YOUR AGENT",
      title: "让每一个 AI 智能体都拥有可验证的数字护照",
      description:
        "企业正把采购、客服、投放与数据访问交给自主智能体。HermesPass 提供身份、授权与审计三层基础设施：谁的智能体、被允许做什么、实际做了什么，全部可以被证明。",
    },
    sections: [
      {
        kind: "stats",
        items: [
          { label: "签发即生效的护照", value: "< 60 秒" },
          { label: "网关策略判定延迟", value: "毫秒级" },
          { label: "审计链条完整性", value: "可独立验证" },
          { label: "受管辖区参照", value: "IMDA · HKMA" },
        ],
      },
      {
        kind: "cards",
        eyebrow: "四大支柱",
        title: "从身份到证据的完整闭环",
        description: "HermesPass 不是又一个日志系统，而是智能体行动前后的控制平面。",
        items: [
          {
            title: "智能体护照",
            body: "每个智能体拥有独立 DID 与 W3C 可验证凭证，载明归属主体、业务角色、风险等级与被授权的工具范围，密码学签名、可被第三方独立验证。",
          },
          {
            title: "策略网关",
            body: "每一次工具调用在执行前先经策略校验，返回 ALLOW / DENY / HOLD。高影响操作自动升级至指定人工复核，形成有据可查的授权记录。",
          },
          {
            title: "受限钱包",
            body: "智能体通过虚拟卡交易，支持单笔、每日与每月上限，以及商户类别白名单，让自主执行不等于无边界花钱。",
          },
          {
            title: "审计链",
            body: "所有事件写入防篡改哈希链，任何改动都会破坏链条。一键导出监管机构可直接受理的证据包。",
          },
        ],
      },
      {
        kind: "steps",
        eyebrow: "运作方式",
        title: "四步接入现有智能体",
        items: [
          {
            title: "01 · 登记",
            body: "登记智能体、业务归属人与用途，系统生成 DID 与签名凭证。",
          },
          {
            title: "02 · 授权",
            body: "定义工具范围、数据边界、支出上限与需人工审批的触发条件。",
          },
          {
            title: "03 · 执行",
            body: "智能体调用工具时经由网关，实时判定放行、拒绝或转人工。",
          },
          {
            title: "04 · 举证",
            body: "行为、判定与人工授权全部上链留痕，随时导出审计报告。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  product: {
    meta: {
      title: "产品 — HermesPass KYA 控制平面",
      description: "了解 HermesPass 的智能体护照、策略网关、受限钱包与防篡改审计链如何协同运作。",
    },
    hero: {
      eyebrow: "产品",
      title: "AI 智能体的控制平面",
      description:
        "身份、授权、支付与证据四个模块共用同一套策略与同一条审计链，避免治理工具彼此割裂。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "模块",
        title: "四个模块，一套事实来源",
        items: [
          {
            title: "护照中心",
            body: "签发、轮换、暂停与吊销智能体凭证；护照卡片直观展示 DID、风险等级、凭证状态与授权范围。",
          },
          {
            title: "策略网关",
            body: "以可读规则表达授权：允许的工具、对手方、金额门槛、时段与数据分级；命中即时生效。",
          },
          {
            title: "人工在环",
            body: "HOLD 状态进入审批抽屉，复核人可查看完整上下文并留下具名批准或驳回。",
          },
          {
            title: "受限钱包",
            body: "为每个智能体发放虚拟卡，设定上限与 MCC 白名单，超额自动拦截。",
          },
          {
            title: "审计链",
            body: "事件按序哈希串联，含上一区块哈希与签名，导出即包含完整性校验说明。",
          },
          {
            title: "导出与报表",
            body: "按时间范围、智能体或事件类型导出 CSV / JSON 证据包，供内审与监管使用。",
          },
        ],
      },
      {
        kind: "code",
        eyebrow: "审计区块",
        title: "防篡改的记录结构",
        description: "每条记录都与前一条绑定，任何后期修改都会导致链条校验失败。",
        code: `{
  "index": 10428,
  "timestamp": "2026-08-15T09:41:22Z",
  "agent_did": "did:web:hermespass.asia:agent:kinnso",
  "action": "purchase.execute",
  "decision": "HOLD → APPROVED",
  "approver": "ops.lead@customer.com",
  "payload_hash": "sha256:7f9c…a13d",
  "previous_hash": "sha256:1b04…9e77",
  "signature": "ed25519:MEUCIQD…"
}`,
      },
    ],
    cta: CTA_DEFAULT,
  },

  "use-cases": {
    meta: {
      title: "应用场景 — 六类可治理的智能体工作流",
      description:
        "自动采购、受限支出、数据访问、理赔初审、对外沟通与投放优化：HermesPass 如何把风险变成可控流程。",
    },
    hero: {
      eyebrow: "应用场景",
      title: "六类高价值、高风险的智能体工作流",
      description: "每个场景都有相同的问题：智能体已经能做，但企业无法证明它被允许做。",
    },
    sections: [
      {
        kind: "compare",
        eyebrow: "对照",
        title: "今天 vs. 使用 HermesPass",
        beforeLabel: "今天的风险",
        afterLabel: "使用 HermesPass",
        items: [
          {
            title: "自动采购",
            before: "智能体用共享账号下单，事后才发现供应商与金额不合规。",
            after: "下单前校验供应商白名单与金额门槛，超限转人工具名审批。",
          },
          {
            title: "受限支出",
            before: "一张公司卡被多个自动化流程共用，无法归因。",
            after: "每个智能体独立虚拟卡，含单笔/每日/每月上限与类别白名单。",
          },
          {
            title: "数据访问",
            before: "智能体持有过宽的 API 权限，敏感数据访问无从追溯。",
            after: "按数据分级授权，越界调用直接拒绝并留痕。",
          },
          {
            title: "理赔初审",
            before: "自动决定影响客户权益，缺少可复核的决策证据。",
            after: "高影响判定强制人工在环，审批人与理由写入审计链。",
          },
          {
            title: "对外沟通",
            before: "智能体代表公司发出邮件与消息，口径与授权难以核实。",
            after: "限定收件范围与模板，敏感对象触发 HOLD。",
          },
          {
            title: "投放优化",
            before: "预算调整由脚本自动执行，超支往往在月结时才被发现。",
            after: "预算变更受额度约束，异常幅度实时拦截。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  benefits: {
    meta: {
      title: "核心价值 — 为什么选择 HermesPass",
      description:
        "身份归因、运行时管控、财务边界与可导出证据：HermesPass 与 IAM、API 网关、日志平台的差异。",
    },
    hero: {
      eyebrow: "核心价值",
      title: "把「我们相信它没问题」变成「我们可以证明」",
      description: "治理不是让智能体变慢，而是让它可以被放心地放开。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "价值",
        title: "企业最关心的四件事",
        items: [
          {
            title: "身份归因",
            body: "任何一次行动都能追溯到具体智能体、其所属团队与责任人，而不是一个共享的服务账号。",
          },
          {
            title: "运行时管控",
            body: "策略在执行前生效，而非事后审阅；风险动作被拦截，而不是被记录。",
          },
          {
            title: "财务边界",
            body: "自主性与支出解耦，额度与类别白名单让最坏情况可预估。",
          },
          {
            title: "可导出证据",
            body: "面对监管与客户审计时，提供的是密码学可验证的链条，而不是导出的表格。",
          },
        ],
      },
      {
        kind: "table",
        eyebrow: "差异",
        title: "与既有方案的区别",
        columns: ["方案", "覆盖", "缺口"],
        rows: [
          ["传统 IAM", "人与服务账号身份", "无法表达智能体的用途、风险等级与工具范围"],
          ["API 网关", "流量与配额", "不理解业务授权、支出上限与人工审批"],
          ["可观测性 / 日志", "事后记录", "可被修改，且无法在执行前阻断"],
          ["自建治理", "贴合内部流程", "凭证标准、审计完整性与监管映射需长期维护"],
          ["HermesPass", "身份 + 授权 + 支付 + 证据", "统一控制平面，标准化且可对外验证"],
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  industries: {
    meta: {
      title: "行业方案 — 金融、保险、零售、广告与物流",
      description: "HermesPass 在受监管行业的落地方式，涵盖香港与新加坡的监管重点。",
    },
    hero: {
      eyebrow: "行业方案",
      title: "在受监管行业里放心使用智能体",
      description:
        "不同行业的风险语言不同，但要回答的问题一样：授权来自哪里、边界在哪里、证据在哪里。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "行业",
        title: "七个重点行业",
        items: [
          {
            title: "银行与资本市场",
            body: "对齐授权分级与职责分离要求，人工在环覆盖高影响操作，审计链支撑内控与外部检查。",
          },
          {
            title: "保险",
            body: "理赔与核保初审保留可复核证据，客户影响类决策强制具名审批。",
          },
          {
            title: "零售与电商",
            body: "自动补货与供应商下单受供应商白名单与金额门槛约束。",
          },
          {
            title: "广告科技",
            body: "预算与出价调整纳入额度管理，异常变更实时拦截。",
          },
          {
            title: "物流与供应链",
            body: "跨企业协作时，用可验证凭证证明对方智能体的身份与授权。",
          },
          {
            title: "专业服务",
            body: "客户资料访问按分级授权，出具工作底稿级别的行为证据。",
          },
          {
            title: "旅游与出行",
            body: "预订与退改由智能体执行，金额与供应商范围可控。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  solutions: {
    meta: {
      title: "解决方案 — 按团队角色落地 KYA",
      description: "面向风险与合规、安全、财务与工程团队的 HermesPass 落地路径。",
    },
    hero: {
      eyebrow: "解决方案",
      title: "四类团队，同一套控制平面",
      description: "治理落地的难点不在工具，而在于让各方看到自己需要的那一面。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "角色",
        title: "各团队获得什么",
        items: [
          {
            title: "风险与合规",
            body: "智能体清单、风险分级、审批记录与可导出证据包，直接对应监管问询。",
          },
          {
            title: "安全团队",
            body: "最小权限的工具范围、凭证轮换与吊销、越权调用的实时阻断。",
          },
          {
            title: "财务团队",
            body: "按智能体归集的支出、上限与类别白名单，月结前即可发现异常。",
          },
          {
            title: "工程团队",
            body: "网关式接入，不需要重写智能体逻辑；策略与凭证由平台维护。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  "compliance-standards": {
    meta: {
      title: "合规标准 — IMDA、HKMA 与 W3C 对齐",
      description:
        "HermesPass 如何映射到 IMDA 生成式 AI 治理框架、HKMA 相关指引与 W3C DID / 可验证凭证标准。",
    },
    hero: {
      eyebrow: "合规标准",
      title: "以公开标准为基础，而不是自定义黑箱",
      description: "身份与凭证遵循 W3C 标准；治理控制点对齐亚洲主要监管机构的关注重点。",
    },
    sections: [
      {
        kind: "table",
        eyebrow: "映射",
        title: "控制点与监管关注对照",
        columns: ["监管关注", "HermesPass 控制点"],
        rows: [
          ["问责与归属", "智能体 DID 与业务责任人绑定，行动可归因"],
          ["人工监督", "高影响操作强制人工在环，具名审批留痕"],
          ["透明与可解释", "策略以可读规则表达，判定理由随事件记录"],
          ["数据治理", "按数据分级限定访问范围，越界即拒绝"],
          ["记录保存", "防篡改哈希链与证据导出"],
          ["第三方验证", "W3C 可验证凭证可由外部独立校验"],
        ],
      },
      {
        kind: "cards",
        eyebrow: "标准",
        title: "我们遵循的规范",
        items: [
          {
            title: "W3C Verifiable Credentials 2.0",
            body: "智能体护照即为可验证凭证，包含签发方、主体、授权范围与有效期。",
          },
          {
            title: "W3C Decentralized Identifiers",
            body: "使用 did:web 标识智能体，便于跨组织解析与验证。",
          },
          {
            title: "IMDA 生成式 AI 治理框架",
            body: "对应问责、人工监督、透明度与事件管理等治理维度。",
          },
          {
            title: "HKMA GenA.I. 沙盒",
            body: "为在港金融机构的受控试点提供可举证的治理证据。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  security: {
    meta: {
      title: "信任中心 — 安全架构与哈希链审计",
      description: "HermesPass 的安全态势、合规文件清单，以及哈希链审计日志的公开说明。",
    },
    hero: {
      eyebrow: "信任中心",
      title: "我们如何保护你的智能体治理数据",
      description: "身份签发、运行时管控、最小权限与可验证审计构成我们的安全基线。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "安全态势",
        title: "四条基线",
        items: [
          {
            title: "身份签发",
            body: "基于 did:web 的标识与签名凭证，密钥可轮换、可吊销。",
          },
          {
            title: "运行时强制",
            body: "策略在网关层执行，绕过路径不被信任。",
          },
          {
            title: "最小权限",
            body: "工具范围、对手方与数据分级逐项授权，默认拒绝。",
          },
          {
            title: "可验证审计",
            body: "事件哈希串联并签名，导出内容可独立校验完整性。",
          },
        ],
      },
      {
        kind: "steps",
        eyebrow: "哈希链",
        title: "审计日志如何做到防篡改",
        items: [
          { title: "采集", body: "记录行动、上下文、策略判定与审批人。" },
          { title: "哈希", body: "对事件载荷计算 SHA-256 摘要。" },
          { title: "封链", body: "写入上一区块哈希并签名，形成顺序绑定。" },
          { title: "校验", body: "任意时点重算链条，发现改动即报错。" },
        ],
      },
      {
        kind: "cards",
        eyebrow: "文件",
        title: "评估阶段可提供的材料",
        items: [
          { title: "架构说明", body: "系统边界、数据流与部署形态说明。" },
          { title: "控制映射", body: "控制点与常见治理框架的对照表。" },
          { title: "子处理方清单", body: "涉及的基础设施与服务提供方摘要。" },
          {
            title: "漏洞报告",
            body: "如发现安全问题，请通过官方渠道联系我们，我们采用协同披露流程。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  faq: {
    meta: {
      title: "常见问题 — 智能体护照、人工审批与导出报表",
      description: "关于 HermesPass 护照签发、人工在环审批、审计导出与部署方式的常见问题。",
    },
    hero: {
      eyebrow: "常见问题",
      title: "关于 KYA 的常见疑问",
      description: "没有找到答案？预约一次技术简报，我们按你的架构逐条回答。",
    },
    sections: [
      {
        kind: "faq",
        eyebrow: "智能体护照",
        title: "护照与身份",
        items: [
          {
            q: "什么是智能体护照？",
            a: "它是一份 W3C 可验证凭证，声明智能体的 DID、归属主体、业务角色、风险等级与被授权的工具范围，由 HermesPass 签名，可被第三方独立验证。",
          },
          {
            q: "签发需要多久？",
            a: "登记信息与授权范围确认后即时签发，通常在一分钟内完成。",
          },
          {
            q: "凭证可以吊销吗？",
            a: "可以。支持暂停、轮换与吊销；吊销后网关立即拒绝该智能体的调用。",
          },
        ],
      },
      {
        kind: "faq",
        eyebrow: "人工在环",
        title: "审批流程",
        items: [
          {
            q: "什么情况会触发 HOLD？",
            a: "超出额度、命中敏感对手方或数据分级、超出授权工具范围，以及你自定义的高影响操作条件。",
          },
          {
            q: "审批记录包含什么？",
            a: "审批人身份、时间、看到的上下文、决定与理由，全部写入审计链。",
          },
          {
            q: "审批会拖慢业务吗？",
            a: "只有被判定为高影响的动作才需人工，其余在毫秒级放行。",
          },
        ],
      },
      {
        kind: "faq",
        eyebrow: "导出与报表",
        title: "审计与导出",
        items: [
          {
            q: "可以导出哪些内容？",
            a: "按时间范围、智能体或事件类型导出 CSV / JSON 证据包，包含哈希链校验信息。",
          },
          {
            q: "监管机构如何验证？",
            a: "导出包内含每个区块的哈希与签名，可离线重算链条以确认未被篡改。",
          },
          {
            q: "数据保留多久？",
            a: "保留期可按你的政策配置，默认满足常见的多年留存要求。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  pricing: {
    meta: {
      title: "价格 — HermesPass 方案与规模",
      description: "从试点到企业级部署的 HermesPass 方案与包含内容。",
    },
    hero: {
      eyebrow: "价格",
      title: "从试点开始，按治理范围扩展",
      description: "所有方案都包含护照签发、策略网关与审计链，差异在规模与支持深度。",
    },
    sections: [
      {
        kind: "plans",
        eyebrow: "方案",
        title: "选择适合的起点",
        items: [
          {
            name: "试点 Pilot",
            price: "按项目计费",
            blurb: "适合单一部门的受控试点。",
            features: [
              "最多 10 个智能体护照",
              "策略网关与人工审批",
              "审计链与基础导出",
              "邮件支持",
            ],
          },
          {
            name: "增长 Growth",
            price: "按智能体数量计费",
            blurb: "适合多团队推广阶段。",
            features: [
              "无上限护照签发",
              "受限钱包与支出管控",
              "自定义策略与审批路由",
              "SSO 与角色权限",
              "优先支持",
            ],
            highlight: true,
          },
          {
            name: "企业 Enterprise",
            price: "定制",
            blurb: "适合受监管环境与集团部署。",
            features: [
              "专属部署与数据驻留选项",
              "监管报表与证据包定制",
              "合规与安全评审支持",
              "SLA 与专属客户成功",
            ],
          },
        ],
      },
      {
        kind: "faq",
        eyebrow: "计费",
        title: "价格常见问题",
        items: [
          {
            q: "按什么计费？",
            a: "以受治理的智能体数量为主，结合事件量与所需支持等级。",
          },
          {
            q: "可以先做概念验证吗？",
            a: "可以。试点方案通常为期数周，覆盖一到两个真实工作流。",
          },
          {
            q: "支持本地或专属部署吗？",
            a: "企业方案支持专属部署与数据驻留安排。",
          },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },

  about: {
    meta: {
      title: "关于我们 — HermesPass 与 KYA 使命",
      description: "HermesPass 致力于为企业 AI 智能体建立可验证的身份与合规基础设施。",
    },
    hero: {
      eyebrow: "关于我们",
      title: "为智能体经济建立信任层",
      description:
        "过去二十年，企业为「认识你的客户」建立了完整体系。智能体时代需要同样成熟的「认识你的智能体」。",
    },
    sections: [
      {
        kind: "cards",
        eyebrow: "主张",
        title: "我们相信的三件事",
        items: [
          {
            title: "身份先于能力",
            body: "在讨论智能体能做什么之前，必须先能证明它是谁、属于谁。",
          },
          {
            title: "控制点必须在运行时",
            body: "事后日志无法阻止损失，策略必须在执行路径上生效。",
          },
          {
            title: "证据必须可被外部验证",
            body: "监管、客户与合作方需要的不是我们的说法，而是可校验的密码学证据。",
          },
        ],
      },
      {
        kind: "steps",
        eyebrow: "路线",
        title: "发展重点",
        items: [
          { title: "身份", body: "完善跨组织的智能体凭证解析与互认。" },
          { title: "支付", body: "扩展受限钱包的支付渠道与对账能力。" },
          { title: "监管", body: "持续跟进亚洲主要市场的治理要求更新。" },
        ],
      },
    ],
    cta: CTA_DEFAULT,
  },
};

export const ZH_ROI = {
  meta: {
    title: "ROI 试算 — HermesPass 治理收益评估",
    description: "估算 HermesPass 为企业节省的合规审查工时与可管控的智能体支出。",
  },
  hero: {
    eyebrow: "ROI 试算",
    title: "估算失控智能体的成本",
    description: "调整下列参数，看看 HermesPass 每年可以回收多少合规审查时间与超范围支出。",
  },
  inputs: {
    agents: {
      label: "智能体数量",
      suffix: " 个",
      description: "需要治理的智能体、副驾驶或自动化工作流。",
    },
    reviews: {
      label: "每个智能体每月合规审查次数",
      suffix: " 次",
      description: "新上线、范围变更、权限复核或事件跟进。",
    },
    hoursPerReview: {
      label: "单次审查平均耗时",
      suffix: " 小时",
      description: "风险、法务或安全团队投入的时间。",
    },
    hourlyRate: {
      label: "合规人员成本",
      prefix: "$",
      suffix: " / 小时",
      description: "审查人员的综合小时成本。",
    },
    monthlySpend: {
      label: "智能体每月发起的支出",
      prefix: "$",
      description: "采购、API、服务、投放等由智能体发起的总支出。",
    },
    outOfPolicy: {
      label: "超范围 / 未受管支出比例",
      suffix: "%",
      description: "错记、未审批、超预算或超出授权范围的比例。",
    },
  },
  results: {
    heading: "预计年度收益",
    timeSaved: { label: "节省的合规工时", hint: "由自动护照签发与策略前置校验释放的审查工时。" },
    labour: { label: "节省的人力成本", hint: "审查更短、可复用带来的直接节省。" },
    spend: { label: "支出治理价值", hint: "通过受限管控与审计拦截或追回的超范围支出。" },
    total: "预计年度总节省",
    assumptionsTitle: "模型假设",
    assumptions: [
      "接入 KYA 护照后，人工审查时间减少 80%",
      "通过受限管控，60% 的未受管支出被拦截或追回",
      "以上为估算值，实际收益取决于策略成熟度与智能体规模",
    ],
    hoursUnit: " 小时",
  },
  cta: {
    title: "获取定制商业论证",
    description: "把你的参数发给我们，我们会返回一份可提交董事会的治理差距、落地计划与 ROI 预测。",
  },
} as const;

export const ZH_CONTACT = {
  meta: {
    title: "联系我们 — 预约 HermesPass 技术简报",
    description: "预约 30 分钟技术简报，了解 KYA 如何在你的智能体环境中落地。",
  },
  hero: {
    eyebrow: "联系我们",
    title: "预约技术简报",
    description: "填写下方信息，我们会在一个工作日内联系你安排 30 分钟的技术演示。",
  },
  fields: {
    name: "姓名",
    email: "企业邮箱",
    company: "公司名称",
    role: "职位",
    agents: "预计需要治理的智能体数量",
    message: "你希望优先解决的问题",
  },
  submit: "提交预约",
  success: "已收到，我们会尽快与你联系。",
  errors: {
    required: "此项为必填",
    email: "请输入有效的企业邮箱",
  },
  aside: {
    title: "简报内容",
    items: [
      "护照签发与凭证验证演示",
      "策略网关与人工在环流程",
      "受限钱包与支出管控",
      "监管可用的审计导出",
    ],
  },
} as const;
